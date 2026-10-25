/**
 * Orbital mechanics for the solar-system scene (plan §8): Kepler solver,
 * heliocentric-ecliptic orientation, spin angles, orbit-line vertices and
 * the committed §4 display-scale formulas. Pure module - Node-importable.
 */
import {
  PLANET_DISTANCE_SCALE_K,
  MOON_DISTANCE_SCALE_M,
  MOON_DISTANCE_POWER_Q,
  MOON_MIN_SEPARATION_FRACTION,
} from './constants.js';

const TWO_PI = 2 * Math.PI;

/**
 * Wrap an angle into [0, 2π).
 *
 * @param {number} radians - any real angle.
 * @returns {number} wrapped angle.
 */
function wrapToTwoPi(radians) {
  return ((radians % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Committed scene-scale: planet display distance D(a_AU) = K · a_AU^p (plan §4).
 *
 * @param {{ aAU: number }} record - planet data record.
 * @param {number} distancePower - slider exponent p (0.4..0.8, default 0.5).
 * @returns {number} display orbital radius in scene units.
 */
export function planetOrbitRadiusSceneUnits(record, distancePower) {
  return PLANET_DISTANCE_SCALE_K * Math.pow(record.aAU, distancePower);
}

/**
 * Committed scene-scale: shared display radius R_disp = (R_km / 1e6) · S for
 * every body (plan §4). Relative sizes stay exact under the size slider.
 *
 * @param {{ radiusKm: number }} record - body data record.
 * @param {number} sizeMultiplier - single shared multiplier S (10..300).
 * @returns {number} display radius in scene units.
 */
export function bodyDisplayRadiusSceneUnits(record, sizeMultiplier) {
  return (record.radiusKm / 1e6) * sizeMultiplier;
}

/**
 * Committed scene-scale: moon display distance d = M · a_mMkm^q with floor
 * 1.8 × parent display radius (plan §4).
 *
 * @param {{ aMmkm: number }} moonRecord - moon data record.
 * @param {{ radiusKm: number }} parentRecord - parent planet data record.
 * @param {number} sizeMultiplier - shared multiplier S for the floor term.
 * @returns {number} display orbital radius in scene units.
 */
export function moonOrbitRadiusSceneUnits(moonRecord, parentRecord, sizeMultiplier) {
  const powerLawDistance = MOON_DISTANCE_SCALE_M * Math.pow(moonRecord.aMmkm, MOON_DISTANCE_POWER_Q);
  const parentFloor = MOON_MIN_SEPARATION_FRACTION * bodyDisplayRadiusSceneUnits(parentRecord, sizeMultiplier);
  return Math.max(powerLawDistance, parentFloor);
}

/**
 * Solve Kepler's equation E - e·sinE = M by Newton-Raphson (plan §8.1):
 * start E = M, max 8 iterations, tolerance 1e-7.
 *
 * @param {number} meanAnomaly - M in radians (any range).
 * @param {number} eccentricity - orbital eccentricity e.
 * @returns {number} eccentric anomaly E in radians.
 */
export function solveKeplerEquation(meanAnomaly, eccentricity) {
  const m = wrapToTwoPi(meanAnomaly);
  let eke = m;
  for (let iterationIndex = 0; iterationIndex < 8; iterationIndex += 1) {
    const delta = (eke - eccentricity * Math.sin(eke) - m) / (1 - eccentricity * Math.cos(eke));
    eke -= delta;
    if (Math.abs(delta) <= 1e-7) {
      break;
    }
  }
  return eke;
}

/**
 * Rotate a vector about Z by the given radians.
 *
 * @param {{ x: number, y: number, z: number }} value - input vector.
 * @param {number} angleRadians - rotation angle.
 * @returns {{ x: number, y: number, z: number }} rotated vector (new object).
 */
function rotateVectorAroundZ(value, angleRadians) {
  const c = Math.cos(angleRadians);
  const s = Math.sin(angleRadians);
  return { x: c * value.x - s * value.y, y: s * value.x + c * value.y, z: value.z };
}

/**
 * Rotate a vector about X by the given radians.
 *
 * @param {{ x: number, y: number, z: number }} value - input vector.
 * @param {number} angleRadians - rotation angle.
 * @returns {{ x: number, y: number, z: number }} rotated vector (new object).
 */
function rotateVectorAroundX(value, angleRadians) {
  const c = Math.cos(angleRadians);
  const s = Math.sin(angleRadians);
  return { x: value.x, y: c * value.y + s * value.z, z: -s * value.y + c * value.z };
}

/**
 * Map a perifocal position through the committed orientation chain
 * p_ecl = rotZ(Ω)·rotX(i)·rotZ(ω) (plan §8.2), then remap Z-up ecliptic to
 * Y-up scene: scenePos = (x, z, -y).
 *
 * @param {{ x: number, y: number, z: number }} perifocalPosition - perifocal-frame point.
 * @param {number} inclinationRadians - i in radians.
 * @param {number} ascendingNodeRadians - Ω in radians.
 * @param {number} argumentOfPericenterRadians - ω = ϖ − Ω in radians.
 * @returns {{ x: number, y: number, z: number }} scene-frame position (new object).
 */
function perifocalToScene(perifocalPosition, inclinationRadians, ascendingNodeRadians, argumentOfPericenterRadians) {
  const rotatedToEcliptic = rotateVectorAroundZ(rotateVectorAroundX(rotateVectorAroundZ(perifocalPosition, argumentOfPericenterRadians), inclinationRadians), ascendingNodeRadians);
  return { x: rotatedToEcliptic.x, y: rotatedToEcliptic.z, z: -rotatedToEcliptic.y };
}

/**
 * Scene position of a planet (or any orbiting record) at simTimeSeconds.
 * Uses the compressed display distance as semi-major axis (§8.1: shape real,
 * size compressed) with the true period T for mean motion; retrograde
 * records orbit via negative mean motion.
 *
 * @param {{
 *   elements: { iRad: number, omegaRadOmega: number, pericenterLongitudeRad: number, meanAnomaly0: number, eccentricity: number, periodSeconds: number },
 *   displayOrbitDistance: number,
 *   isRetrograde?: boolean
 * }} record - solar-system body record (enriched fields).
 * @param {number} simTimeSeconds - simulation elapsed time.
 * @returns {{ x: number, y: number, z: number }} scene position (relative to the focus).
 */
export function computeOrbitalPosition(record, simTimeSeconds) {
  const { elements, displayOrbitDistance } = record;
  const directionSign = record.isRetrograde ? -1 : 1;
  const meanAnomaly = wrapToTwoPi(elements.meanAnomaly0 + directionSign * TWO_PI * (simTimeSeconds / elements.periodSeconds));
  const eccentricAnomaly = solveKeplerEquation(meanAnomaly, elements.eccentricity);
  const radiusFromFocus = displayOrbitDistance * (1 - elements.eccentricity * Math.cos(eccentricAnomaly));
  const trueAnomalyHalfTangent = Math.sqrt((1 + elements.eccentricity) / (1 - elements.eccentricity)) * Math.tan(eccentricAnomaly / 2);
  const trueAnomaly = 2 * Math.atan(trueAnomalyHalfTangent);
  const perifocalPosition = {
    x: radiusFromFocus * Math.cos(trueAnomaly),
    y: radiusFromFocus * Math.sin(trueAnomaly),
    z: 0,
  };
  const argumentOfPericenterRadians = elements.pericenterLongitudeRad - elements.omegaRadOmega;
  return perifocalToScene(perifocalPosition, elements.iRad, elements.omegaRadOmega, argumentOfPericenterRadians);
}

/**
 * Scene position of a planet record at simTimeSeconds (plan §6 signature).
 *
 * @param {{
 *   elements: { iRad: number, omegaRadOmega: number, pericenterLongitudeRad: number, meanAnomaly0: number, eccentricity: number, periodSeconds: number },
 *   displayOrbitDistance: number
 * }} planetRecord - solar-system planet body record.
 * @param {number} simTimeSeconds - simulation elapsed time.
 * @returns {{ x: number, y: number, z: number }} scene position relative to the Sun.
 */
export function computePlanetPosition(planetRecord, simTimeSeconds) {
  return computeOrbitalPosition(planetRecord, simTimeSeconds);
}

/**
 * Scene position of a moon at simTimeSeconds: same machinery as planets but
 * around its parent's compressed display distance (plan §8.2); result is
 * added to parentScenePosition.
 *
 * @param {{
 *   elements: { iRad: number, omegaRadOmega: number, pericenterLongitudeRad: number, meanAnomaly0: number, eccentricity: number, periodSeconds: number },
 *   displayOrbitDistance: number,
 *   isRetrograde?: boolean
 * }} moonRecord - solar-system moon body record.
 * @param {{ x: number, y: number, z: number }} parentScenePosition - parent's live scene position.
 * @param {number} simTimeSeconds - simulation elapsed time.
 * @returns {{ x: number, y: number, z: number }} absolute scene position of the moon.
 */
export function computeMoonPosition(moonRecord, parentScenePosition, simTimeSeconds) {
  const offset = computeOrbitalPosition(moonRecord, simTimeSeconds);
  return { x: parentScenePosition.x + offset.x, y: parentScenePosition.y + offset.y, z: parentScenePosition.z + offset.z };
}

/**
 * Visual spin angle (plan §8.3): 2π·t / secondsPerRotation; the sign of the
 * period carries retrograde (Venus/Uranus), with an explicit flag fallback.
 *
 * @param {number} secondsPerRotation - rotation period in simulation seconds.
 * @param {boolean} [retrograde] - true when the record stores a positive period but spins backwards.
 * @param {number} simTimeSeconds - simulation elapsed time.
 * @returns {number} spin angle in radians.
 */
export function computeSpinAngle(secondsPerRotation, retrograde, simTimeSeconds) {
  const signedPeriod = retrograde && secondsPerRotation > 0 ? -secondsPerRotation : secondsPerRotation;
  if (signedPeriod === 0) {
    return 0;
  }
  return TWO_PI * (simTimeSeconds / signedPeriod);
}

/**
 * Local orbit-line vertices in the XZ plane, centered on the focus with the
 * pericenter offset c = a·e (plan §8.2): x = -c + a·cosθ, z = b·sinθ,
 * b = a√(1-e²). Closed loop of segmentsCount+1 vertices; the per-orbit
 * world matrix adds parent translation and plane orientation.
 *
 * @param {{ aDisplayUnits: number, eccentricity: number }} ellipseElements - compressed semi-major axis + true e.
 * @param {number} segmentsCount - loop segments (>= 3).
 * @returns {Float32Array} packed xyz triplets (length = 3·(segmentsCount+1)).
 */
export function computeOrbitEllipseLocalVertices(ellipseElements, segmentsCount) {
  const { aDisplayUnits, eccentricity } = ellipseElements;
  const semiMinorAxis = aDisplayUnits * Math.sqrt(1 - eccentricity * eccentricity);
  const pericenterOffset = aDisplayUnits * eccentricity;
  const vertices = new Float32Array((segmentsCount + 1) * 3);
  for (let vertexIndex = 0; vertexIndex <= segmentsCount; vertexIndex += 1) {
    const angle = (vertexIndex / segmentsCount) * TWO_PI;
    vertices[vertexIndex * 3] = -pericenterOffset + aDisplayUnits * Math.cos(angle);
    vertices[vertexIndex * 3 + 1] = 0;
    vertices[vertexIndex * 3 + 2] = semiMinorAxis * Math.sin(angle);
  }
  return vertices;
}
