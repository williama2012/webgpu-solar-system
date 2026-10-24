/**
 * Analytic orbital kinematics. Planetary orbits are nearly circular
 * (eccentricity ≤ 0.24), so a circular Kepler orbit at the mean distance is
 * an accurate and cheap model: angle = 2π · t / T, exactly matching each
 * body's real orbital period — no integrator required.
 */

export const TWO_PI = Math.PI * 2;

/**
 * Computes a body's world-space position at a given simulation time.
 *
 * @param {{ radiusUnits: number, periodDays: number, phaseRad: number,
 *           inclinationRad: number, nodeRad: number }} orbit - Visual orbit record.
 * @param {number} simDays - Simulation time elapsed in days (J2000 epoch).
 * @returns {[number, number, number]} World position [x, y, z] in scene units.
 */
export function computeOrbitPosition(orbit, simDays) {
    const angle = TWO_PI * (simDays / orbit.periodDays) + orbit.phaseRad;
    const planeX = orbit.radiusUnits * Math.cos(angle);
    const planeZ = orbit.radiusUnits * Math.sin(angle);

    // Rotate by the longitude of ascending node (around the world up-axis),
    // then tilt the orbital plane by its inclination.
    const nodeCos = Math.cos(orbit.nodeRad);
    const nodeSin = Math.sin(orbit.nodeRad);
    const nodeX = planeX * nodeCos - planeZ * nodeSin;
    const nodeZ = planeX * nodeSin + planeZ * nodeCos;
    const tiltCos = Math.cos(orbit.inclinationRad);

    return [nodeX, -nodeZ * Math.sin(orbit.inclinationRad), nodeZ * tiltCos];
}

/**
 * Computes the cumulative body spin (axial rotation) angle.
 *
 * @param {number} simDays - Simulation time in days.
 * @param {number} rotationPeriodDays - Sidereal rotation period; a negative
 *   value (Venus, Uranus) automatically reverses the spin direction.
 * @returns {number} Rotation angle in radians.
 */
export function computeSpinRotation(simDays, rotationPeriodDays) {
    return TWO_PI * simDays / rotationPeriodDays;
}

/**
 * Adds two 3D vectors.
 *
 * @param {[number, number, number]} left - First vector.
 * @param {[number, number, number]} right - Second vector.
 * @returns {[number, number, number]} Sum vector.
 */
export function addVectors(left, right) {
    return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}