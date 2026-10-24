/**
 * Entry point: boots the scene, wires the camera controller, HUD, pointer
 * picking and the per-frame simulation loop.
 */

import { buildSolarSystem } from './solar-system.js';
import { CameraController } from './camera.js';
import { buildUi } from './ui.js';
import { addVectors, computeOrbitPosition, computeSpinRotation } from './orbit.js';

let simDays = 0;
let lastTimestampMs = 0;

function failStartup() {
    const failure = document.getElementById('boot-failure');
    failure.hidden = false;
}

const app = await buildSolarSystem('.mount-element');
const { context, camera, bodies, saturnRing, backend } = app;
document.getElementById('render-note').textContent =
    `Renderer: ${backend} · Drag to orbit, scroll to zoom.`;

const controller = new CameraController({ camera, bodies });
const ui = buildUi({
    bodies,
    onJump: (bodyId) => {
        controller.focusOnBody(bodyId);
        const body = bodies.get(bodyId);
        ui.showFactoid(body);
    },
    onSelect: (body) => {
        controller.focusOnBody(body.id);
        ui.showFactoid(body);
        ui.markJumpActive(body.id);
    },
    setRenderNote: () => {},
});
ui.markJumpActive('sun');

// ---- Pointer picking: click a body to select it ----
const mountElement = document.querySelector('.mount-element');
let pointerDownX = 0;
let pointerDownY = 0;
mountElement.addEventListener('pointerdown', (event) => {
    pointerDownX = event.clientX;
    pointerDownY = event.clientY;
});
mountElement.addEventListener('pointerup', (event) => {
    const moved = Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY);
    if (moved > 6) { // it was a drag, not a click
        return;
    }
    const rect = mountElement.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    let closestHit = null;
    for (const body of bodies.values()) {
        const distance = body.element.raycastDistance(pointerX, pointerY);
        if (distance !== null && distance !== undefined && (!closestHit || distance < closestHit.distance)) {
            closestHit = { body, distance };
        }
    }
    if (closestHit) {
        ui.onSelectRef?.(); // no-op guard; selection is handled below
        controller.focusOnBody(closestHit.body.id);
        ui.showFactoid(closestHit.body);
        ui.markJumpActive(closestHit.body.id);
    }
});

window.addEventListener('error', failStartup);
const bootTimer = window.setTimeout(() => {
    if (!window.__solarSystemBooted) {
        failStartup();
    }
}, 4000);

function frame(nowMs) {
    const deltaSeconds = Math.min(0.1, (nowMs - lastTimestampMs) / 1000);
    lastTimestampMs = nowMs;
    if (!ui.isPaused()) {
        simDays += deltaSeconds * ui.getDaysPerSecond();
    }

    // Sun spin.
    const sun = bodies.get('sun');
    sun.element.rotationY = computeSpinRotation(simDays, sun.spinPeriodDays);

    // Planets: orbit position + spin.
    for (const planet of bodies.values()) {
        if (!planet.orbit || planet.parent) {
            continue;
        }
        const position = computeOrbitPosition(planet.orbit, simDays);
        planet.worldPosition = position;
        planet.element.x = position[0];
        planet.element.y = position[1];
        planet.element.z = position[2];
        planet.element.rotationY = computeSpinRotation(simDays, planet.spinPeriodDays);
    }

    // Moons: revolve around their moving parent.
    for (const body of bodies.values()) {
        if (!body.parent) {
            continue;
        }
        const parent = bodies.get(body.parent);
        const local = computeOrbitPosition(body.orbit, simDays);
        const position = addVectors(parent.worldPosition, local);
        body.worldPosition = position;
        body.element.x = position[0];
        body.element.y = position[1];
        body.element.z = position[2];
    }

    // Saturn's ring follows the planet.
    const saturn = bodies.get('saturn');
    saturnRing.x = saturn.worldPosition[0];
    saturnRing.y = saturn.worldPosition[1];
    saturnRing.z = saturn.worldPosition[2];

    controller.update(deltaSeconds);
    ui.updateOverlays(context);
    ui.updateClock(simDays);
    window.requestAnimationFrame(frame);
}

window.requestAnimationFrame((firstMs) => {
    lastTimestampMs = firstMs;
    window.requestAnimationFrame(frame);
});

window.__solarSystemBooted = true;
window.clearTimeout(bootTimer);