/**
 * WebGPU Solar System — bootstrap and frame loop (plan §6/§9/§10/§15).
 *
 * Owns scene state, camera, renderer and HUD wiring; the pure modules do:
 *  - solar-system.js: Kepler/orbital truth, model matrices, scale recompute;
 *  - camera-controls.js: OrbitCamera input model + view/projection matrices;
 *  - renderer.js: WebGPU device, pipelines, one render pass per frame;
 *  - textures.js: painted surface canvases;
 *  - ui.js: labels, factoid card, time/jump/scale/fps HUD.
 *
 * Run: `npm start` → http://localhost:8080 (WebGPU: latest Chrome/Edge).
 */
import { applySceneScale, computeBodyModelMatrices, computeWorldPositions, createSolarSystem } from './solar-system.js';
import { OrbitCamera } from './camera-controls.js';
import { SolarSystemRenderer } from './renderer.js';
import { generateAllCanvases } from './textures.js';
import { multiplyMatrices, projectWorldToScreen } from './math.js';
import { MOON_LABEL_COLOR, MOON_RECORDS, PLANET_RECORDS } from './constants.js';
import {
  createFactoidPopup,
  createFpsReadout,
  createJumpToGrid,
  createLabelLayer,
  createTimeControls,
  createScalePanel,
  hideFactoidCard,
  showFactoidCard,
  showUnsupportedOverlay,
  setLabelSelection,
  updateLabels,
} from './ui.js';

/** One frame of simulation advance is clamped to this (seconds; tab switches, §6). */
const MAX_FRAME_DELTA_SECONDS = 0.05;

/** Pick slack: candidate if |click−center| ≤ max(screenRadiusPx·1.4, 12) px (§9.5). */
const PICK_SLACK_FACTOR = 1.4;
const MIN_PICK_RADIUS_PX = 12;

/** Occluder slots in the §7 global buffer: float 24 + 4 per slot (x,y,z,radius). */
const OCCLUDER_FIRST_FLOAT = 24;
const FLOATS_PER_OCCLUDER = 4;

/** Fixed occluder count — slots 0..8 = sun+planets, slot 9 a zero pad (§7). */
const OCCLUDER_COUNT_FIXED = 10;

/**
 * Bootstrap the app: unsupported-overlay check → renderer init → scene →
 * camera/UI wiring → frame loop. Fatal device errors land on the overlay (§14).
 */
async function bootstrap() {
  const canvasElement = document.getElementById('viewport');
  const overlayElement = document.getElementById('unsupported-overlay');
  if (typeof navigator.gpu !== 'object' || navigator.gpu === null) {
    showUnsupportedOverlay(overlayElement, false);
    return;
  }

  /** Report a fatal WebGPU error on the #unsupported-overlay card. */
  function reportFatalError(message) {
    const titleElement = document.getElementById('overlay-title');
    if (titleElement) titleElement.textContent = message;
    showUnsupportedOverlay(overlayElement, false);
  }

  /** Orbit-line definitions for the renderer (color = label hex; kind drives §7 alpha). */
  const orbitDefinitions = [
    ...PLANET_RECORDS.map((record) => ({ name: record.name, kind: 'planet', color: record.labelColor })),
    ...MOON_RECORDS.map((record) => ({ name: record.name, kind: 'moon', color: MOON_LABEL_COLOR })),
  ];

  // Wiring order (plan §6): initialize → createSolarSystem → registerBodies.
  const renderer = new SolarSystemRenderer(canvasElement);
  const surfaceRecords = [{ textureKey: 'sun' }, ...PLANET_RECORDS, ...MOON_RECORDS];
  await renderer.initialize({ canvases: generateAllCanvases(surfaceRecords), orbitDefinitions, onFatalError: reportFatalError });

  const bodies = createSolarSystem(renderer.textureMap, (orbitLineUpdates) => renderer.writeOrbitVertices(orbitLineUpdates));
  renderer.registerBodies(bodies);

  const camera = new OrbitCamera(bodies);

  // Simulation state (§2: time multiplier starts at the far-left 1× chip).
  let simTimeSeconds = 0;
  let timeScaleMultiplier = 1;
  let paused = false;
  /** One persistent 128-float buffer; filled per frame with the §7 layout. */
  const globalUniformsData = new Float32Array(128);
  /** Occluder slots in fixed order: slot 0 sun, slots 1..8 planets (match occluderIndex). */
  const occluderBodies = [bodies[0], ...bodies.filter((body) => body.kind === 'planet')];

  function selectBody(bodyName) {
    camera.requestFocus(bodyName);
    setLabelSelection(bodyName);
    showFactoidCard(bodyName);
    jumpToGridApi.setFocusedBodyName(bodyName);
  }

  /** Deselect: close popup, release focus (free-mode origin lerp resumes). */
  function deselectAll() {
    camera.releaseFocus();
    setLabelSelection(null);
    hideFactoidCard();
    jumpToGridApi.setFocusedBodyName(null);
  }

  /**
   * No-drag click picking (§9.5): project every body center, accept if within
   * max(screenRadiusPx·1.4, 12) px, pick the smallest normalized excess.
   * @param {number} clientX - event.clientX from OrbitCamera's single-click callback.
   * @param {number} clientY - event.clientY (same).
   */
  function pickAt(clientX, clientY) {
    const bounds = canvasElement.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const clickX = clientX - bounds.left;
    const clickY = clientY - bounds.top;
    const aspectRatio = bounds.width / bounds.height;
    const projectionMatrix = camera.getProjectionMatrix(aspectRatio);
    const viewProjection = multiplyMatrices(projectionMatrix, camera.getViewMatrix());
    const tanHalfFovY = 1 / projectionMatrix[5];
    const worldPositions = computeWorldPositions(simTimeSeconds);
    let bestName = null;
    let bestExcess = Infinity;
    for (const body of bodies) {
      const positionArray = worldPositions.get(body.name);
      const worldPosition = { x: positionArray[0], y: positionArray[1], z: positionArray[2] };
      const projected = projectWorldToScreen(worldPosition, viewProjection, bounds.width, bounds.height);
      if (projected.isBehindCamera) continue;
      const distancePx = Math.hypot(clickX - projected.xPixels, clickY - projected.yPixels);
      const screenRadiusPx = (body.displayRadius * (bounds.height / 2)) / (tanHalfFovY * camera.getDistanceTo(worldPosition));
      if (distancePx <= Math.max(screenRadiusPx * PICK_SLACK_FACTOR, MIN_PICK_RADIUS_PX)) {
        const excess = (distancePx - screenRadiusPx) / screenRadiusPx;
        if (excess < bestExcess) { bestExcess = excess; bestName = body.name; }
      }
    }
    if (bestName !== null) selectBody(bestName); else deselectAll();
  }

  camera.attachDomElement(canvasElement, pickAt);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') deselectAll();
  });

  // HUD wiring (plan §10 DOM ids).
  const jumpToGridApi = createJumpToGrid(document.getElementById('jump-to-grid'), (bodyName) => {
    if (bodyName === null) deselectAll(); else selectBody(bodyName);
  });
  createLabelLayer(document.getElementById('label-layer'), bodies, (bodyName) => selectBody(bodyName));
  createFactoidPopup(document.getElementById('factoid-popup'), deselectAll);
  createTimeControls(document.getElementById('time-controls'), {
    getTimeScaleMultiplier: () => timeScaleMultiplier,
    setTimeScaleMultiplier: (value) => { timeScaleMultiplier = value; },
    isPaused: () => paused,
    setPaused: (value) => { paused = value; },
  });
  createScalePanel(document.getElementById('scale-controls'), (values) => applySceneScale(values));
  const fpsReadout = createFpsReadout(document.getElementById('fps-readout'));

  /** Match the canvas backing store to CSS size × devicePixelRatio (renderer rebuilds depth on change, §7). */
  function fitCanvas() {
    const devicePixelRatio = window.devicePixelRatio || 1;
    const bounds = canvasElement.getBoundingClientRect();
    canvasElement.width = Math.max(1, Math.round(bounds.width * devicePixelRatio));
    canvasElement.height = Math.max(1, Math.round(bounds.height * devicePixelRatio));
  }
  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  let lastTimestampMs = performance.now();

  /** One frame: advance sim, recompute scene, fill §7 globals, one render pass. */
  function frameLoop(timestampMs) {
    const rawDeltaMs = timestampMs - lastTimestampMs;
    lastTimestampMs = timestampMs;
    const deltaSeconds = Math.min(Math.max(rawDeltaMs / 1000, 0), MAX_FRAME_DELTA_SECONDS);
    if (!paused) simTimeSeconds += deltaSeconds * timeScaleMultiplier;

    const worldPositions = computeWorldPositions(simTimeSeconds);
    const modelMatrices = computeBodyModelMatrices(worldPositions, simTimeSeconds);
    camera.update(deltaSeconds, worldPositions);

    const aspectRatio = canvasElement.width / canvasElement.height;
    const viewMatrix = camera.getViewMatrix();
    const projectionMatrix = camera.getProjectionMatrix(aspectRatio);
    const viewProjection = multiplyMatrices(projectionMatrix, viewMatrix);
    const cameraBasis = camera.getCameraBasis();

    // §7 global buffer (offsets mirror renderer.js GLOBAL_FLOAT_OFFSETS).
    const g = globalUniformsData;
    g[0] = cameraBasis.position.x; g[1] = cameraBasis.position.y; g[2] = cameraBasis.position.z; g[3] = 1;
    g[4] = simTimeSeconds;
    g[8] = cameraBasis.forward.x; g[9] = cameraBasis.forward.y; g[10] = cameraBasis.forward.z; g[11] = 0;
    g[12] = cameraBasis.right.x; g[13] = cameraBasis.right.y; g[14] = cameraBasis.right.z; g[15] = 0;
    g[16] = cameraBasis.up.x; g[17] = cameraBasis.up.y; g[18] = cameraBasis.up.z; g[19] = 0;
    g[20] = OCCLUDER_COUNT_FIXED;
    for (let i = 0; i < occluderBodies.length; i += 1) {
      const positionArray = worldPositions.get(occluderBodies[i].name);
      const base = OCCLUDER_FIRST_FLOAT + FLOATS_PER_OCCLUDER * i;
      g[base] = positionArray[0]; g[base + 1] = positionArray[1]; g[base + 2] = positionArray[2];
      g[base + 3] = occluderBodies[i].displayRadius;
    }
    const sunPositionArray = worldPositions.get(bodies[0].name);
    g[88] = sunPositionArray[0]; g[89] = sunPositionArray[1]; g[90] = sunPositionArray[2];
    g[91] = bodies[0].displayRadius; // coronaCenter w = live Sun displayRadius
    g[92] = 1 / projectionMatrix[0]; // tanX (projection matrix P[0] = 1/tanX)
    g[93] = 1 / projectionMatrix[5]; // tanY
    g[94] = aspectRatio;
    g[95] = 0;
    g.set(viewProjection, 96); // floats 96..111: P·V (right factor applies first)

    const bodyDrawList = [];
    const orbitDrawList = [];
    for (const body of bodies) {
      const entry = modelMatrices.get(body.name);
      bodyDrawList.push({ modelMatrix: entry.modelMatrix, bindGroup: renderer.bodyBindGroups.get(body.name) });
      if (body.kind !== 'sun') orbitDrawList.push({ modelMatrix: entry.orbitWorldMatrix, bindGroup: renderer.orbitBindGroups.get(body.name) });
    }
    const saturnEntry = modelMatrices.get('Saturn');
    const ringDraw = saturnEntry ? { modelMatrix: saturnEntry.modelMatrix } : null;

    renderer.renderFrame({ globalUniformsData, bodyDrawList, orbitDrawList, ringDraw });

    updateLabels(worldPositions, camera, simTimeSeconds);
    fpsReadout.report(rawDeltaMs);
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);
}

bootstrap().catch((error) => {
  console.error('Startup failed:', error);
});
