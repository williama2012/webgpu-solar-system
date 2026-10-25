/**
 * Smoke test for the pure source modules (plan §12/§13): runs under Node with
 * no DOM/WebGPU, so it is importable in a headless CI environment.
 *
 * Checkpoint C coverage:
 *   - Kepler solver basics + residual
 *   - planet periodicity (t and t+T within 1e-3*a) and radial bounds [a(1-e), a(1+e)]
 *   - period consistency: every moon period re-derived from (mu, a) vs the
 *     shipped table, within 2%; plus the §5.1 anchor distances in km
 *   - retrograde: Triton-type record's scene z-velocity sign opposite a prograde twin
 *   - matrices: rotations orthonormal, multiply associativity sanity,
 *     perspective x view maps a known forward point (w > 0, |ndcZ| < 1)
 *   - §4 committed scale table reproduced within 0.01 u at defaults (p=0.5, S=40)
 *
 * The applySceneScale section (plan §13) is added to this file once
 * src/solar-system.js exists (write-order checkpoint E); run again there and at K.
 */
import { PLANET_RECORDS, MOON_RECORDS, DISTANCE_POWER_DEFAULT } from '../src/constants.js';
import {
  createPerspectiveMatrix,
  createLookAtViewMatrix,
  multiplyMatrices,
  translationMatrix4,
  rotationAroundX,
  rotationAroundY,
  rotationAroundZ,
  composeBodyModel,
  lengthOfVector3,
  normalizeVector,
  projectWorldToScreen,
} from '../src/math.js';
import {
  planetOrbitRadiusSceneUnits,
  bodyDisplayRadiusSceneUnits,
  moonOrbitRadiusSceneUnits,
  solveKeplerEquation,
  computePlanetPosition,
} from '../src/orbital-mechanics.js';

const SECONDS_PER_DAY = 86400;

const failures = [];
let checkCount = 0;

/**
 * Record one named assertion.
 *
 * @param {boolean} condition - must be true.
 * @param {string} label - human-readable description of the check.
 */
function check(condition, label) {
  checkCount += 1;
  if (!condition) {
    failures.push(label);
  }
}

/**
 * Degrees to radians (local helper).
 *
 * @param {number} degrees - angle in degrees.
 * @returns {number} radians.
 */
function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Build the scene record shape solar-system.js will use (elements + displayOrbitDistance).
 *
 * @param {{ aAU: number, radiusKm: number, inclinationDeg: number, ascendingNodeDeg: number, pericenterLongitudeDeg: number, meanAnomaly0Deg: number, eccentricity: number, periodDays: number }} record - planet data record.
 * @returns {object} scene-ready planet record.
 */
function buildPlanetSceneRecord(record) {
  return {
    name: record.name,
    elements: {
      iRad: toRadians(record.inclinationDeg),
      omegaRadOmega: toRadians(record.ascendingNodeDeg),
      pericenterLongitudeRad: toRadians(record.pericenterLongitudeDeg),
      meanAnomaly0: toRadians(record.meanAnomaly0Deg),
      eccentricity: record.eccentricity,
      periodSeconds: record.periodDays * SECONDS_PER_DAY,
    },
    displayOrbitDistance: planetOrbitRadiusSceneUnits(record, DISTANCE_POWER_DEFAULT),
  };
}

function keplerSolverBasics() {
  const eccentricities = [0, 0.2056, 0.9];
  for (const eccentricityValue of eccentricities) {
    check(Math.abs(solveKeplerEquation(0, eccentricityValue)) <= 1e-12, `Kepler solveKepler(0, e=${eccentricityValue}) ~= 0`);
    check(Math.abs(solveKeplerEquation(Math.PI, eccentricityValue) - Math.PI) <= 1e-6, `Kepler solveKepler(pi, e=${eccentricityValue}) ~= pi`);
  }
  const residualCases = [
    { m: 0.3, eccentricity: 0.9 },
    { m: 2.1, eccentricity: 0.2056 },
    { m: 5.5, eccentricity: 0.9 },
    { m: 4.7, eccentricity: 0.0 },
  ];
  for (const caseItem of residualCases) {
    const anomalyValue = solveKeplerEquation(caseItem.m, caseItem.eccentricity);
    const wrappedM = (((caseItem.m % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    const residualMagnitude = Math.abs(anomalyValue - caseItem.eccentricity * Math.sin(anomalyValue) - wrappedM);
    check(residualMagnitude <= 1e-6, `Kepler residual |E - e*sinE - M| for M=${caseItem.m}, e=${caseItem.eccentricity} is ${residualMagnitude.toExponential(2)}`);
  }
}

function periodicityAndRadialBounds() {
  for (const planetRecord of PLANET_RECORDS) {
    const sceneRecord = buildPlanetSceneRecord(planetRecord);
    const semiMajorAxis = sceneRecord.displayOrbitDistance;
    const periodSeconds = sceneRecord.elements.periodSeconds;
    const probeTime = 123456;
    const firstPosition = computePlanetPosition(sceneRecord, probeTime);
    const wrappedPosition = computePlanetPosition(sceneRecord, probeTime + periodSeconds);
    const maxComponentDifference = Math.max(
      Math.abs(firstPosition.x - wrappedPosition.x),
      Math.abs(firstPosition.y - wrappedPosition.y),
      Math.abs(firstPosition.z - wrappedPosition.z),
    );
    check(maxComponentDifference <= 0.001 * semiMajorAxis, `${planetRecord.name}: position at t and t+T agree within 1e-3*a (diff ${maxComponentDifference.toExponential(2)} u)`);
    for (const timeFraction of [0, 0.25, 0.5, 0.75]) {
      const samplePosition = computePlanetPosition(sceneRecord, timeFraction * periodSeconds);
      const radialDistance = lengthOfVector3(samplePosition);
      const eccentricityValue = planetRecord.eccentricity;
      check(
        radialDistance >= semiMajorAxis * (1 - eccentricityValue) * 0.999999 && radialDistance <= semiMajorAxis * (1 + eccentricityValue) * 1.000001,
        `${planetRecord.name}: radius ${radialDistance.toFixed(4)} u within [a(1-e), a(1+e)] at t=${timeFraction}T`,
      );
    }
  }
}

function moonPeriodConsistency() {
  const parentByName = new Map(PLANET_RECORDS.map((planetRecord) => [planetRecord.name, planetRecord]));
  for (const moonRecord of MOON_RECORDS) {
    const parentRecord = parentByName.get(moonRecord.parentName);
    const orbitRadiusKm = moonRecord.aMmkm * 1e6;
    const keplerPeriodDays = (2 * Math.PI * Math.sqrt(Math.pow(orbitRadiusKm, 3) / parentRecord.gravitationalParameterKm3PerS2)) / SECONDS_PER_DAY;
    const relativeError = (keplerPeriodDays - moonRecord.periodDays) / moonRecord.periodDays;
    check(
      Math.abs(relativeError) <= 0.02,
      `${moonRecord.name}: Kepler T from (mu, a=${orbitRadiusKm.toFixed(1)} km) is ${keplerPeriodDays.toFixed(3)} d vs table ${moonRecord.periodDays} d (rel ${(100 * relativeError).toFixed(2)}%)`,
    );
  }
  const europaRecord = MOON_RECORDS.find((item) => item.name === 'Europa');
  check(Math.abs(europaRecord.aMmkm * 1e6 - 671034) <= 0.5, 'Europa anchor: aMmkm equals 671,034 km (the known-bad 383,300 km would differ)');
  const jupiterRecord = parentByName.get('Jupiter');
  const europaKeplerDays = (2 * Math.PI * Math.sqrt(Math.pow(671034, 3) / jupiterRecord.gravitationalParameterKm3PerS2)) / SECONDS_PER_DAY;
  check(Math.abs(europaKeplerDays - 3.551) / 3.551 <= 0.02, `Europa: Kepler T(a=671,034 km) about Jupiter is ${europaKeplerDays.toFixed(3)} d ~= 3.551 d`);
  const tritonRecord = MOON_RECORDS.find((item) => item.name === 'Triton');
  check(Math.abs(tritonRecord.aMmkm * 1e6 - 354759) <= 0.5, 'Triton anchor: aMmkm equals 354,759 km (the known-bad 347,124 km would differ)');
}

function retrogradeVelocitySign() {
  // Triton-type record built the committed §5.3 way: same period as the
  // Triton table row, degenerate elements e = Omega = omega = M0 = 0 so the
  // prograde/retrograde z traces are exact time mirrors (z(t) =
  // +a*sin(i)*sin(n*t) vs -a*sin(i)*sin(n*t)); i must be nonzero for the
  // z axis to move at all (a flat orbit has z-velocity identically 0), so
  // the test supplies 20 deg where the Triton row stores 0.
  const tritonRecord = MOON_RECORDS.find((item) => item.name === 'Triton');
  const sharedElements = {
    iRad: toRadians(20),
    omegaRadOmega: 0,
    pericenterLongitudeRad: 0,
    meanAnomaly0: 0,
    eccentricity: 0,
    periodSeconds: tritonRecord.periodDays * SECONDS_PER_DAY,
  };
  const displayDistance = 4.84;
  const progradeRecord = { elements: sharedElements, displayOrbitDistance: displayDistance, isRetrograde: false };
  const retrogradeRecord = { elements: sharedElements, displayOrbitDistance: displayDistance, isRetrograde: true };
  const startTime = 1e5;
  const stepSeconds = 1;
  const progradeBefore = computePlanetPosition(progradeRecord, startTime);
  const progradeAfter = computePlanetPosition(progradeRecord, startTime + stepSeconds);
  const retrogradeBefore = computePlanetPosition(retrogradeRecord, startTime);
  const retrogradeAfter = computePlanetPosition(retrogradeRecord, startTime + stepSeconds);
  const progradeZVelocity = (progradeAfter.z - progradeBefore.z) / stepSeconds;
  const retrogradeZVelocity = (retrogradeAfter.z - retrogradeBefore.z) / stepSeconds;
  check(progradeZVelocity !== 0 && progradeZVelocity * retrogradeZVelocity < 0, `retrograde: scene z-velocity signs opposite (prograde ${progradeZVelocity.toExponential(2)}, retrograde ${retrogradeZVelocity.toExponential(2)})`);
}

function matrixSanity() {
  const rotationConstructors = [rotationAroundX, rotationAroundY, rotationAroundZ];
  const testAngles = [0.3, -0.7, 1.9];
  for (const constructFunction of rotationConstructors) {
    for (const angleValue of testAngles) {
      const matrixValue = constructFunction(angleValue);
      for (let columnIndex = 0; columnIndex < 3; columnIndex += 1) {
        for (let otherColumnIndex = columnIndex; otherColumnIndex < 3; otherColumnIndex += 1) {
          const dotProductValue = matrixValue[columnIndex * 4] * matrixValue[otherColumnIndex * 4] + matrixValue[columnIndex * 4 + 1] * matrixValue[otherColumnIndex * 4 + 1] + matrixValue[columnIndex * 4 + 2] * matrixValue[otherColumnIndex * 4 + 2];
          const expectedDot = columnIndex === otherColumnIndex ? 1 : 0;
          check(Math.abs(dotProductValue - expectedDot) <= 0.00001, `rotation[${constructFunction.name}](${angleValue}) column dot c${columnIndex}.c${otherColumnIndex} ~= ${expectedDot}`);
        }
      }
    }
  }
  const scaleRadius = 5;
  const modelMatrix = composeBodyModel({ x: 1, y: 2, z: 3 }, 0.4, 0.9, scaleRadius);
  for (let columnIndex = 0; columnIndex < 3; columnIndex += 1) {
    const columnVectorA = { x: modelMatrix[columnIndex * 4], y: modelMatrix[columnIndex * 4 + 1], z: modelMatrix[columnIndex * 4 + 2] };
    check(Math.abs(lengthOfVector3(columnVectorA) - scaleRadius) <= 0.001, `composeBodyModel column ${columnIndex} length ~= scale ${scaleRadius}`);
  }
  const rotationXValue = rotationAroundX(0.4);
  const rotationYValue = rotationAroundY(0.7);
  const translationValue = translationMatrix4({ x: 5, y: -2, z: 3 });
  let maxAssociationDifference = 0;
  const leftAssociation = multiplyMatrices(multiplyMatrices(rotationXValue, rotationYValue), translationValue);
  const rightAssociation = multiplyMatrices(rotationXValue, multiplyMatrices(rotationYValue, translationValue));
  for (let entryIndex = 0; entryIndex < 16; entryIndex += 1) {
    maxAssociationDifference = Math.max(maxAssociationDifference, Math.abs(leftAssociation[entryIndex] - rightAssociation[entryIndex]));
  }
  check(maxAssociationDifference <= 0.0001, `multiplyMatrices associativity |((A*B)*C) - A*(B*C)|inf ~= 0 (max ${maxAssociationDifference.toExponential(2)})`);

  const eyePosition = { x: 0, y: 96, z: -180 };
  const targetPosition = { x: 0, y: 0, z: 0 };
  const upVectorValue = { x: 0, y: 1, z: 0 };
  const viewMatrix = createLookAtViewMatrix(eyePosition, targetPosition, upVectorValue);
  const projectionMatrix = createPerspectiveMatrix(toRadians(60), 16 / 9, 0.1, 4000);
  const viewProjectionMatrix = multiplyMatrices(projectionMatrix, viewMatrix);
  const forwardDirection = normalizeVector({ x: targetPosition.x - eyePosition.x, y: targetPosition.y - eyePosition.y, z: targetPosition.z - eyePosition.z });
  const forwardPoint = { x: eyePosition.x + 100 * forwardDirection.x, y: eyePosition.y + 100 * forwardDirection.y, z: eyePosition.z + 100 * forwardDirection.z };
  const clipDepth = viewProjectionMatrix[3] * forwardPoint.x + viewProjectionMatrix[7] * forwardPoint.y + viewProjectionMatrix[11] * forwardPoint.z + viewProjectionMatrix[15];
  const clipZTerm = viewProjectionMatrix[2] * forwardPoint.x + viewProjectionMatrix[6] * forwardPoint.y + viewProjectionMatrix[10] * forwardPoint.z + viewProjectionMatrix[14];
  check(clipDepth > 0, `perspective x view: forward point w = ${clipDepth.toFixed(3)} > 0`);
  check(Math.abs(clipZTerm / clipDepth) < 1, `perspective x view: forward point |ndcZ| = ${Math.abs(clipZTerm / clipDepth).toFixed(4)} < 1`);
  const centerProjection = projectWorldToScreen(forwardPoint, viewProjectionMatrix, 1600, 900);
  check(!centerProjection.isBehindCamera && Math.abs(centerProjection.xPixels - 800) <= 0.5 && Math.abs(centerProjection.yPixels - 450) <= 0.5, `perspective x view: forward point projects to screen center (${centerProjection.xPixels.toFixed(1)}, ${centerProjection.yPixels.toFixed(1)})`);
  const cameraRight = { x: viewMatrix[0], y: viewMatrix[4], z: viewMatrix[8] };
  const cameraUp = { x: viewMatrix[1], y: viewMatrix[5], z: viewMatrix[9] };
  const rightOffsetPoint = { x: forwardPoint.x + 30 * cameraRight.x, y: forwardPoint.y + 30 * cameraRight.y, z: forwardPoint.z + 30 * cameraRight.z };
  const upOffsetPoint = { x: forwardPoint.x + 30 * cameraUp.x, y: forwardPoint.y + 30 * cameraUp.y, z: forwardPoint.z + 30 * cameraUp.z };
  const rightProjection = projectWorldToScreen(rightOffsetPoint, viewProjectionMatrix, 1600, 900);
  const upProjection = projectWorldToScreen(upOffsetPoint, viewProjectionMatrix, 1600, 900);
  check(!rightProjection.isBehindCamera && rightProjection.xPixels > 800, `perspective x view: right-offset point projects right of center (${rightProjection.xPixels.toFixed(1)})`);
  check(!upProjection.isBehindCamera && upProjection.yPixels < 450, `perspective x view: up-offset point projects above center (${upProjection.yPixels.toFixed(1)})`);
  const behindPoint = { x: eyePosition.x - 100 * forwardDirection.x, y: eyePosition.y - 100 * forwardDirection.y, z: eyePosition.z - 100 * forwardDirection.z };
  check(projectWorldToScreen(behindPoint, viewProjectionMatrix, 1600, 900).isBehindCamera, 'perspective x view: point behind the camera is rejected (w <= 0)');
}

function scaleTable() {
  const committedPlanetValues = {
    Mercury: { d: 12.44, rdisp: 0.098 },
    Venus: { d: 17.01, rdisp: 0.242 },
    Earth: { d: 20.0, rdisp: 0.255 },
    Mars: { d: 24.69, rdisp: 0.136 },
    Jupiter: { d: 45.62, rdisp: 2.796 },
    Saturn: { d: 61.81, rdisp: 2.329 },
    Uranus: { d: 87.61, rdisp: 1.014 },
    // The §4 table prints 109.66 u but the committed formula D = K*a^p at
    // a = 30.07 AU gives 109.672 u (and §3's own "Neptune at 109.7 u"
    // supports that); anchor on the formula value, flagging the one-time
    // 0.012 u deviation here.
    Neptune: { d: 109.672, rdisp: 0.985 },
  };
  for (const planetRecord of PLANET_RECORDS) {
    const committedValues = committedPlanetValues[planetRecord.name];
    const computedDistance = planetOrbitRadiusSceneUnits(planetRecord, DISTANCE_POWER_DEFAULT);
    const computedRadius = bodyDisplayRadiusSceneUnits(planetRecord, 40);
    check(Math.abs(computedDistance - committedValues.d) <= 0.01, `${planetRecord.name}: D ${computedDistance.toFixed(3)} u ~= committed ${committedValues.d}`);
    check(Math.abs(computedRadius - committedValues.rdisp) <= 0.01, `${planetRecord.name}: R_disp ${computedRadius.toFixed(4)} u ~= committed ${committedValues.rdisp}`);
  }
  const committedMoonValues = {
    Moon: { d: 5.12, rdisp: 0.069 },
    Phobos: { d: 0.383, rdisp: 0.00044 },
    Deimos: { d: 0.723, rdisp: 0.0003 },
    Io: { d: 5.47, rdisp: 0.073 },
    Europa: { d: 7.56, rdisp: 0.062 },
    Ganymede: { d: 10.49, rdisp: 0.105 },
    Callisto: { d: 15.57, rdisp: 0.096 },
    Rhea: { d: 6.39, rdisp: 0.031 },
    Titan: { d: 11.51, rdisp: 0.103 },
    Titania: { d: 5.59, rdisp: 0.032 },
    Oberon: { d: 6.86, rdisp: 0.03 },
    Triton: { d: 4.84, rdisp: 0.083 },
  };
  const parentByName = new Map(PLANET_RECORDS.map((planetRecord) => [planetRecord.name, planetRecord]));
  for (const moonRecord of MOON_RECORDS) {
    const committedValues = committedMoonValues[moonRecord.name];
    const parentRecord = parentByName.get(moonRecord.parentName);
    const computedDistance = moonOrbitRadiusSceneUnits(moonRecord, parentRecord, 40);
    const computedRadius = bodyDisplayRadiusSceneUnits(moonRecord, 40);
    check(Math.abs(computedDistance - committedValues.d) <= 0.01, `${moonRecord.name}: d ${computedDistance.toFixed(3)} u ~= committed ${committedValues.d}`);
    check(Math.abs(computedRadius - committedValues.rdisp) <= 0.001, `${moonRecord.name}: R_disp ${computedRadius.toFixed(4)} u ~= committed ${committedValues.rdisp} (3-sig-fig table tolerance)`);
  }
}

keplerSolverBasics();
periodicityAndRadialBounds();
moonPeriodConsistency();
retrogradeVelocitySign();
matrixSanity();
scaleTable();

if (failures.length > 0) {
  for (const failureItem of failures) {
    console.error(`FAIL: ${failureItem}`);
  }
  console.error(`${checkCount} checks, ${failures.length} failed`);
  process.exit(1);
}
console.log(`smoke-test OK - ${checkCount} checks passed (Kepler, periodicity, periods, retrograde, matrices, §4 scale table)`);