/**
 * Solar-system scene model: body records with the committed display scale
 * (§4), world positions at a simulation time, per-frame model matrices,
 * orbit-line geometry, and scale-slider recomputation (not per frame).
 *
 * Scene frame: right-handed, Y-up, X–Z = ecliptic plane; Sun at origin.
 */
import { composeBodyModel, multiplyMatrices, rotationAroundX, rotationAroundZ, translationMatrix4 } from './math.js';
import {
  bodyDisplayRadiusSceneUnits,
  computeMoonPosition,
  computeOrbitEllipseLocalVertices,
  computePlanetPosition,
  computeSpinAngle,
  moonOrbitRadiusSceneUnits,
  planetOrbitRadiusSceneUnits,
} from './orbital-mechanics.js';
import {
  DISTANCE_POWER_DEFAULT,
  MOON_LABEL_COLOR,
  MOON_RECORDS,
  PLANET_RECORDS,
  SECONDS_PER_DAY,
  SUN_DISPLAY_RADIUS_DEFAULT,
  SUN_RECORD,
  PLANET_SIZE_MULTIPLIER_DEFAULT,
} from './constants.js';

/** Orbit-line resolution committed in plan §7: 256 segments per orbit (21 orbits). */
const ORBIT_LINE_SEGMENT_COUNT = 256;

/**
 * Z-up ecliptic → Y-up scene remap as a column-major mat4: scene = (x, z, -y).
 * Same remap orbital-mechanics.perifocalToScene applies after rotZ(Ω)·rotX(i)·rotZ(ω).
 */
const ECLIPTIC_TO_SCENE_REMAP = new Float32Array([
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
]);

/** Scene built by createSolarSystem; null until creation. */
let scene = null;

/**
 * Degrees → radians (data records store angles in degrees).
 *
 * @param {number} degrees - angle in degrees.
 * @returns {number} angle in radians.
 */
function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

/**
 * Build the scene record for one planet (elements + committed display scale).
 *
 * @param {{ name: string, aAU: number, radiusKm: number, eccentricity: number, inclinationDeg: number, ascendingNodeDeg: number, pericenterLongitudeDeg: number, meanAnomaly0Deg: number, periodDays: number, spinHours: number, axialTiltDeg: number, labelColor: string, textureKey: string }} record - constants.js planet data record.
 * @param {number} occluderSlot - analytic shadow slot (Sun = 0, planets 1..8).
 * @returns {object} scene-ready planet body record.
 */
function buildPlanetBody(record, occluderSlot) {
  return {
    name: record.name,
    kind: 'planet',
    radiusKm: record.radiusKm,
    displayRadius: bodyDisplayRadiusSceneUnits(record, PLANET_SIZE_MULTIPLIER_DEFAULT),
    elements: {
      aAU: record.aAU,
      eccentricity: record.eccentricity,
      iRad: toRadians(record.inclinationDeg),
      omegaRadOmega: toRadians(record.ascendingNodeDeg),
      pericenterLongitudeRad: toRadians(record.pericenterLongitudeDeg),
      meanAnomaly0: toRadians(record.meanAnomaly0Deg),
      periodSeconds: record.periodDays * SECONDS_PER_DAY,
    },
    displayOrbitDistance: planetOrbitRadiusSceneUnits(record, DISTANCE_POWER_DEFAULT),
    spin: { secondsPerRotation: record.spinHours * 3600, tiltRadians: toRadians(record.axialTiltDeg) },
    textureName: record.textureKey,
    labelColor: record.labelColor,
    occluderIndex: occluderSlot,
  };
}

/**
 * Build the scene record for one moon. Moons have no committed e/Ω/ω/M0 data:
 * degenerate elements (e = Ω = ω = M0 = 0) with the committed inclination, and a
 * tidally-locked spin (period = orbital period; negative for retrograde Triton).
 *
 * @param {{ name: string, parentName: string, radiusKm: number, aMmkm: number, periodDays: number, inclinationDeg: number, textureKey: string, isRetrograde?: boolean }} moonRecord - constants.js moon data record.
 * @param {{ name: string, radiusKm: number }} parentRecord - parent planet's data record (radius for the 1.8× floor).
 * @returns {object} scene-ready moon body record.
 */
function buildMoonBody(moonRecord, parentRecord) {
  const periodSeconds = moonRecord.periodDays * SECONDS_PER_DAY;
  return {
    name: moonRecord.name,
    kind: 'moon',
    parentName: moonRecord.parentName,
    radiusKm: moonRecord.radiusKm,
    displayRadius: bodyDisplayRadiusSceneUnits(moonRecord, PLANET_SIZE_MULTIPLIER_DEFAULT),
    elements: {
      aMmkm: moonRecord.aMmkm,
      eccentricity: 0,
      iRad: toRadians(moonRecord.inclinationDeg),
      omegaRadOmega: 0,
      pericenterLongitudeRad: 0,
      meanAnomaly0: 0,
      periodSeconds,
    },
    displayOrbitDistance: moonOrbitRadiusSceneUnits(moonRecord, parentRecord, PLANET_SIZE_MULTIPLIER_DEFAULT),
    spin: { secondsPerRotation: (moonRecord.isRetrograde ? -1 : 1) * periodSeconds, tiltRadians: 0 },
    textureName: moonRecord.textureKey,
    labelColor: MOON_LABEL_COLOR,
    isRetrograde: moonRecord.isRetrograde,
  };
}

/**
 * Orbit-plane orientation matrix (no translation, no spin): the same rotZ(Ω)·rotX(i)·
 * rotZ(ω) chain perifocalToScene uses, with ω = ϖ − Ω, then remapped to Y-up scene.
 *
 * @param {{ iRad: number, omegaRadOmega: number, pericenterLongitudeRad: number }} elements - scene body elements (radians).
 * @returns {Float32Array} 4×4 column-major orientation matrix.
 */
function planeOrientationMatrix(elements) {
  const argumentOfPericenter = elements.pericenterLongitudeRad - elements.omegaRadOmega;
  return multiplyMatrices(
    ECLIPTIC_TO_SCENE_REMAP,
    multiplyMatrices(
      rotationAroundZ(elements.omegaRadOmega),
      multiplyMatrices(rotationAroundX(elements.iRad), rotationAroundZ(argumentOfPericenter)),
    ),
  );
}

/**
 * Recompute every orbit line's local XZ vertex loop (21 orbits) and hand the new
 * Float32Arrays to the renderer via the rebuild callback.
 *
 * @returns {void}
 */
function rebuildOrbitVertexBuffers() {
  if (!scene || !scene.onOrbitRebuild) return;
  const orbitLineUpdates = [];
  for (const body of scene.bodies) {
    if (!body.elements) continue; // Sun has no orbit line.
    const vertices = computeOrbitEllipseLocalVertices({ aDisplayUnits: body.displayOrbitDistance, eccentricity: body.elements.eccentricity }, ORBIT_LINE_SEGMENT_COUNT);
    orbitLineUpdates.push({ name: body.name, vertices });
  }
  scene.onOrbitRebuild(orbitLineUpdates);
}

/**
 * Build the solar-system scene from committed constants + texture map. Stores the
 * scene for computeWorldPositions / computeBodyModelMatrices / applySceneScale.
 *
 * @param {Record<string, object>} textureMap - textureKey → GPUTexture as produced by textures.js (kept on the scene for the renderer).
 * @param {function(Array<{ name: string, vertices: Float32Array }>) | undefined} onOrbitRebuild - callback into the renderer; receives one {name, vertices} entry per orbit line after every scale recompute (and once at creation) so GPU orbit buffers can be (re)built.
 * @returns {Array<object>} the scene's bodies array ([Sun, 8 planets, 13 moons]); occluderIndex slots 0..9 are Sun, Mercury…Neptune — slot 9 is reserved for the shader's radius-0 padding entry.
 */
export function createSolarSystem(textureMap, onOrbitRebuild) {
  const bodies = [];

  const sunBody = {
    name: SUN_RECORD.name,
    kind: 'sun',
    radiusKm: SUN_RECORD.radiusKm,
    displayRadius: SUN_DISPLAY_RADIUS_DEFAULT,
    spin: { secondsPerRotation: 0, tiltRadians: 0 }, // no committed solar spin; drawn static
    textureName: SUN_RECORD.textureKey,
    labelColor: SUN_RECORD.labelColor,
    occluderIndex: 0,
  };
  bodies.push(sunBody);

  PLANET_RECORDS.forEach((planetRecord, planetIndex) => {
    bodies.push(buildPlanetBody(planetRecord, planetIndex + 1));
  });

  MOON_RECORDS.forEach((moonRecord) => {
    const parentRecord = PLANET_RECORDS.find((planet) => planet.name === moonRecord.parentName);
    if (!parentRecord) throw new Error(`No planet named '${moonRecord.parentName}' for moon '${moonRecord.name}'.`);
    bodies.push(buildMoonBody(moonRecord, parentRecord));
  });

  scene = { bodies, textureMap, onOrbitRebuild };
  rebuildOrbitVertexBuffers();
  return bodies;
}

/**
 * Scene positions of every body at simTimeSeconds: Sun at origin; planets via
 * Kepler (compressed display distance, true period); moons = parent position +
 * degenerate-orbit offset (retrograde Triton via negative mean motion).
 *
 * @param {number} simTimeSeconds - simulation elapsed time.
 * @returns {Map<string, [number, number, number]>} name → scene [x, y, z] for all bodies.
 */
export function computeWorldPositions(simTimeSeconds) {
  if (!scene) throw new Error('computeWorldPositions before createSolarSystem.');
  const positions = new Map();
  for (const body of scene.bodies) {
    if (body.kind === 'sun') {
      positions.set(body.name, [0, 0, 0]);
      continue;
    }
    let worldPosition;
    if (body.kind === 'planet') {
      worldPosition = computePlanetPosition(body, simTimeSeconds);
    } else {
      const parentScenePosition = positions.get(body.parentName);
      worldPosition = computeMoonPosition(body, { x: parentScenePosition[0], y: parentScenePosition[1], z: parentScenePosition[2] }, simTimeSeconds);
    }
    positions.set(body.name, [worldPosition.x, worldPosition.y, worldPosition.z]);
  }
  return positions;
}

/**
 * Per-body visual model matrix (§8.3: T·Rz(tilt)·Ry(spin)·S) and per-orbit world
 * matrix (planet: orientation only, focus at Sun; moon: parent translation × its
 * plane orientation — never a spin term on orbit lines).
 *
 * @param {Map<string, [number, number, number]>} worldPositions - from computeWorldPositions.
 * @param {number} simTimeSeconds - simulation elapsed time (spin angle source).
 * @returns {Map<string, { modelMatrix: Float32Array, orbitWorldMatrix: Float32Array | null }>} one entry per body; orbitWorldMatrix is null for the Sun.
 */
export function computeBodyModelMatrices(worldPositions, simTimeSeconds) {
  if (!scene) throw new Error('computeBodyModelMatrices before createSolarSystem.');
  const matrices = new Map();
  for (const body of scene.bodies) {
    const worldPositionArray = worldPositions.get(body.name);
    const worldPosition = { x: worldPositionArray[0], y: worldPositionArray[1], z: worldPositionArray[2] };
    const spinRadians = computeSpinAngle(body.spin.secondsPerRotation, Boolean(body.isRetrograde), simTimeSeconds);
    const modelMatrix = composeBodyModel(worldPosition, body.spin.tiltRadians, spinRadians, body.displayRadius);

    let orbitWorldMatrix = null;
    if (body.kind !== 'sun') {
      const orientation = planeOrientationMatrix(body.elements);
      orbitWorldMatrix = body.kind === 'planet' ? orientation : multiplyMatrices(translationMatrix4(worldPosition), orientation);
      // NOTE: moons are built with Ω = 0, so the chain reduces to remap × rotX(i) — same as the position code.
    }

    matrices.set(body.name, { modelMatrix, orbitWorldMatrix });
  }
  return matrices;
}

/**
 * Scale recompute entry point (plan §4): mutate all display radii/distances for
 * the new slider values, then rebuild every orbit-line buffer through the
 * renderer callback — this runs on slider change, never per frame.
 *
 * @param {{ planetSizeMultiplier: number, sunDisplayRadius: number, distancePower: number }} scaleSettings - current slider values (S, sun radius u, planet D = K·a^p exponent p).
 * @returns {void}
 */
export function applySceneScale({ planetSizeMultiplier, sunDisplayRadius, distancePower }) {
  if (!scene) throw new Error('applySceneScale before createSolarSystem.');

  for (const body of scene.bodies) {
    if (body.kind === 'sun') {
      body.displayRadius = sunDisplayRadius;
    } else {
      body.displayRadius = bodyDisplayRadiusSceneUnits(body, planetSizeMultiplier);
    }
  }

  for (const body of scene.bodies) {
    if (body.kind === 'planet') {
      body.displayOrbitDistance = planetOrbitRadiusSceneUnits({ aAU: body.elements.aAU }, distancePower);
    } else if (body.kind === 'moon') {
      const parentBody = scene.bodies.find((otherBody) => otherBody.name === body.parentName);
      body.displayOrbitDistance = moonOrbitRadiusSceneUnits({ aMmkm: body.elements.aMmkm }, { radiusKm: parentBody.radiusKm }, planetSizeMultiplier);
    }
  }

  rebuildOrbitVertexBuffers();
}
