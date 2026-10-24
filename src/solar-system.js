/**
 * Scene construction for the solar system: WebGPU context (with Canvas
 * Context3D fallback), camera, lighting, skybox, the Sun and halo, all
 * planets, the Saturn ring, every moon, and the orbit guide rings.
 */

import {
    createAmbientLight,
    createCamera,
    createPointLight,
    createSphere,
    createTorus,
    createTexture,
    createContext as createContext3D,
} from '@ripl/3d';
import { createContext as createWebGPUContext } from '@ripl/webgpu';
import { createRenderer, createScene } from '@ripl/web';
import { buildCelestialData } from './data.js';
import { createTextureCanvas } from './textures.js';

const STARFIELD_RADIUS = 6000;
const SEED_BASE = 9773;

/**
 * Picks the GPU-backed context when available, otherwise the software
 * Canvas Context3D fallback. Both accept the same scene.
 *
 * @param {string} mountSelector - CSS selector of the mount element.
 * @returns {Promise<import('@ripl/core').Context>} The 3D context.
 */
async function negotiateContext(mountSelector) {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
        try {
            return await createWebGPUContext(mountSelector, { near: 0.05, far: 20000 });
        } catch (error) {
            console.warn('WebGPU context negotiation failed; falling back to Canvas 3D.', error);
        }
    }

    return createContext3D(mountSelector, { near: 0.05, far: 20000 });
}

/**
 * Builds one textured sphere mesh for a body.
 *
 * @param {object} record - Celestial record with radiusUnits/textureKind.
 * @returns {import('@ripl/3d').Sphere} The sphere element.
 */
function createBodyMesh(record) {
    const large = record.radiusUnits >= 4;
    return createSphere({
        radius: record.radiusUnits,
        segments: large ? 40 : 26,
        rings: large ? 20 : 14,
        id: record.id,
        material: {
            map: createTexture(createTextureCanvas(record.textureKind, SEED_BASE + record.id.length * 131)),
            color: '#ffffff',
        },
    });
}

/**
 * Builds a thin torus used as an orbital guide ring.
 *
 * @param {number} orbitRadius - Ring major radius in scene units.
 * @param {boolean} isMoonRing - Whether the ring belongs to a moon (thinner).
 * @returns {import('@ripl/3d').Torus} The torus element.
 */
function createOrbitRing(orbitRadius, isMoonRing) {
    return createTorus({
        radius: orbitRadius,
        tube: isMoonRing ? 0.05 : 0.12,
        radialSegments: 3,
        tubularSegments: isMoonRing ? 120 : 200,
        material: {
            color: isMoonRing ? '#7a95c8' : '#5f7fbf',
            opacity: isMoonRing ? 0.26 : 0.3,
            side: 'double',
        },
    });
}

/**
 * Builds the complete scene.
 *
 * @param {string} mountSelector - CSS selector of the mount element.
 * @returns {Promise<{ context: object, camera: object, scene: object,
 *                     renderer: object, bodies: Map<string, object>,
 *                     saturnRing: object, backend: string }>} Scene handles.
 */
export async function buildSolarSystem(mountSelector) {
    const [context, data] = await Promise.all([negotiateContext(mountSelector), Promise.resolve(buildCelestialData())]);
    const backend = context && context.constructor && context.constructor.name.toLowerCase().includes('webgpu')
        ? 'WebGPU'
        : 'Canvas 3D fallback';

    const camera = createCamera(context, {
        position: [0, 150, 520],
        target: [0, 0, 0],
        fov: 50,
        near: 0.05,
        far: 20000,
        interactions: true, // built-in orbit / zoom / pan
    });

    // The Sun is the only meaningful light source in the system.
    context.lights.add(createPointLight({
        position: [0, 0, 0],
        color: '#fff2cf',
        intensity: 1.1,
        distance: 0, // 0 = infinite range (no artificial falloff)
        decay: 0,
    }));
    context.lights.add(createAmbientLight({ intensity: 0.18, color: '#2c3a55' }));

    const scene = createScene(context);

    // Skybox: a huge sphere rendered from its inside, star texture mapped
    // over it, drawn first so everything else sits in front of it.
    const starCanvas = createTextureCanvas('starfield', SEED_BASE);
    scene.add(createSphere({
        radius: STARFIELD_RADIUS,
        segments: 48,
        rings: 24,
        id: 'skybox',
        material: { map: createTexture(starCanvas), color: '#ffffff', side: 'back' },
    }));

    const bodies = new Map();

    // ---- Planets, their orbit rings, moons and moon rings ----
    for (const planet of data.planets) {
        const mesh = createBodyMesh(planet);
        mesh.material = { ...mesh.material, };
        mesh.rotationX = planet.axialTiltRad;
        scene.add(createOrbitRing(planet.orbit.radiusUnits, false));
        scene.add(mesh);
        bodies.set(planet.id, { ...planet, element: mesh });

        for (const moon of planet.moons) {
            const moonMesh = createBodyMesh(moon);
            scene.add(createOrbitRing(moon.orbit.radiusUnits, true));
            scene.add(moonMesh);
            bodies.set(moon.id, { ...moon, element: moonMesh });
        }
    }

    // ---- Saturn's ring ----
    const saturn = bodies.get('saturn');
    const saturnRing = createTorus({
        radius: saturn.radiusUnits * 1.7, // spans ~1.35–2.05 planetary radii
        tube: saturn.radiusUnits * 0.35,
        radialSegments: 8,
        tubularSegments: 180,
        // NOTE: if the installed @ripl/3d torus defaults to the XY plane
        // instead of XZ, add `rotationZ: Math.PI / 2` here — one line.
        rotationX: 26.7 * Math.PI / 180, // Saturn's axial tilt
        material: { color: '#e6d3a3', opacity: 0.85, side: 'double' },
    });
    scene.add(saturnRing);

    // ---- The Sun: emissive core plus three translucent corona halos ----
    const sun = data.sun;
    const sunMesh = createBodyMesh(sun);
    sunMesh.material = {
        map: createTexture(createTextureCanvas('sun', SEED_BASE + 1)),
        color: '#ffffff',
        emissive: '#ff9a2e',
        emissiveIntensity: 1.6,
    };
    scene.add(sunMesh);
    bodies.set('sun', { ...sun, element: sunMesh });

    const haloSettings = [
        { radius: 14.4, opacity: 0.16, color: '#ff9a33' },
        { radius: 17.2, opacity: 0.08, color: '#ff8428' },
        { radius: 22.5, opacity: 0.045, color: '#ff6a1f' },
    ];
    for (const halo of haloSettings) {
        scene.add(createSphere({
            radius: halo.radius,
            segments: 32,
            rings: 16,
            id: `halo-${halo.radius}`,
            material: { color: halo.color, opacity: halo.opacity, side: 'double' },
        }));
    }

    const renderer = createRenderer(scene, { autoStart: true, autoStop: false });

    return {
        context, camera, scene, renderer, bodies, saturnRing, backend,
    };
}