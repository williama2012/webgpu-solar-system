/**
 * Matrix + vector helpers, column-major Float32Array(16) mat4s and plain
 * {x,y,z} vectors (plan §6). Pure module - Node-importable.
 */

/**
 * Dot product of two 3D vectors.
 *
 * @param {{ x: number, y: number, z: number }} first - left vector.
 * @param {{ x: number, y: number, z: number }} second - right vector.
 * @returns {number} dot result.
 */
function dotVectors3(first, second) {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

/**
 * Cross product of two 3D vectors (right-handed).
 *
 * @param {{ x: number, y: number, z: number }} first - left vector.
 * @param {{ x: number, y: number, z: number }} second - right vector.
 * @returns {{ x: number, y: number, z: number }} cross result (new object).
 */
function crossVectors3(first, second) {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  };
}

/**
 * 4x4 identity matrix.
 *
 * @returns {Float32Array} column-major Float32Array(16).
 */
export function createIdentityMatrix() {
  const result = new Float32Array(16);
  result[0] = 1;
  result[5] = 1;
  result[10] = 1;
  result[15] = 1;
  return result;
}

/**
 * Matrix product: result = left x right (column-major, so right applies to a
 * vector first).
 *
 * @param {Float32Array} left - left factor.
 * @param {Float32Array} right - right factor.
 * @returns {Float32Array} new 16-element product matrix.
 */
export function multiplyMatrices(left, right) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let total = 0;
      for (let k = 0; k < 4; k += 1) {
        total += left[k * 4 + row] * right[column * 4 + k];
      }
      out[column * 4 + row] = total;
    }
  }
  return out;
}

/**
 * Perspective projection (column-major, symmetric clip, right-handed view
 * space with the camera looking down -Z_view) for an fov measured
 * vertically. Clip form: c_z = A*z_view + B, c_w = -z_view with
 * A = (f+n)/(n-f), B = 2fn/(n-f); this maps the near plane to ndcZ = -1,
 * the far plane to ndcZ = +1 and keeps w > 0 for every in-front point.
 * Committed defaults: near 0.1, far 4000.
 *
 * @param {number} fieldOfViewYRadians - vertical fov in radians.
 * @param {number} aspectRatio - width / height (0 allowed -> degenerate but safe).
 * @param {number} nearDistance - near clip distance.
 * @param {number} farDistance - far clip distance.
 * @returns {Float32Array} 16-element projection matrix.
 */
export function createPerspectiveMatrix(fieldOfViewYRadians, aspectRatio, nearDistance, farDistance) {
  const tanHalfFov = Math.tan(fieldOfViewYRadians / 2);
  const out = new Float32Array(16);
  out[0] = 1 / (aspectRatio * tanHalfFov);
  out[5] = 1 / tanHalfFov;
  out[10] = (farDistance + nearDistance) / (nearDistance - farDistance);
  out[14] = 2 * farDistance * nearDistance / (nearDistance - farDistance);
  out[11] = -1;
  return out;
}

/**
 * Build the world -> view matrix directly from eye/target/up (no inverse
 * taken; plan §6).
 *
 * @param {{ x: number, y: number, z: number }} eyePosition - camera position.
 * @param {{ x: number, y: number, z: number }} targetPosition - look-at point.
 * @param {{ x: number, y: number, z: number }} upVector - world up hint.
 * @returns {Float32Array} 16-element view matrix.
 */
export function createLookAtViewMatrix(eyePosition, targetPosition, upVector) {
  let forward = normalizeVector(subtractVectors3(eyePosition, targetPosition));
  if (lengthOfVector3(forward) === 0) {
    forward = { x: 0, y: 1, z: 0 };
  }
  const rightVector = normalizeVector(crossVectors3(upVector, forward));
  const upResult = crossVectors3(forward, rightVector);
  const out = new Float32Array(16);
  out[0] = rightVector.x;
  out[4] = rightVector.y;
  out[8] = rightVector.z;
  out[1] = upResult.x;
  out[5] = upResult.y;
  out[9] = upResult.z;
  out[2] = forward.x;
  out[6] = forward.y;
  out[10] = forward.z;
  out[3] = -dotVectors3(rightVector, eyePosition);
  out[7] = -dotVectors3(upResult, eyePosition);
  out[11] = -dotVectors3(forward, eyePosition);
  out[15] = 1;
  return out;
}

/**
 * 4x4 translation matrix.
 *
 * @param {{ x: number, y: number, z: number }} position - translation vector.
 * @returns {Float32Array} 16-element matrix.
 */
export function translationMatrix4(position) {
  const out = createIdentityMatrix();
  out[12] = position.x;
  out[13] = position.y;
  out[14] = position.z;
  return out;
}

/**
 * Rotation around world X by the given radians (column-major).
 *
 * @param {number} angleRadians - rotation angle.
 * @returns {Float32Array} 16-element matrix.
 */
export function rotationAroundX(angleRadians) {
  const c = Math.cos(angleRadians);
  const s = Math.sin(angleRadians);
  const out = createIdentityMatrix();
  out[5] = c;
  out[6] = s;
  out[9] = -s;
  out[10] = c;
  return out;
}

/**
 * Rotation around world Y by the given radians (column-major).
 *
 * @param {number} angleRadians - rotation angle.
 * @returns {Float32Array} 16-element matrix.
 */
export function rotationAroundY(angleRadians) {
  const c = Math.cos(angleRadians);
  const s = Math.sin(angleRadians);
  const out = createIdentityMatrix();
  out[0] = c;
  out[2] = s;
  out[8] = -s;
  out[10] = c;
  return out;
}

/**
 * Rotation around world Z by the given radians (column-major).
 *
 * @param {number} angleRadians - rotation angle.
 * @returns {Float32Array} 16-element matrix.
 */
export function rotationAroundZ(angleRadians) {
  const c = Math.cos(angleRadians);
  const s = Math.sin(angleRadians);
  const out = createIdentityMatrix();
  out[0] = c;
  out[1] = -s;
  out[4] = s;
  out[5] = c;
  return out;
}

/**
 * Committed body model matrix (plan §6/§8.3): T x Rz(tilt) x Ry(spin) x S.
 * Uranus's sideways tilt comes from Rz before the Ry spin term.
 *
 * @param {{ x: number, y: number, z: number }} position - world position of the body centre.
 * @param {number} tiltRadians - axial tilt about Z.
 * @param {number} spinRadians - rotation about Y (sign carries retrograde).
 * @param {number} displayRadius - uniform display radius in scene units.
 * @returns {Float32Array} 16-element model matrix.
 */
export function composeBodyModel(position, tiltRadians, spinRadians, displayRadius) {
  const scaleMatrix = createIdentityMatrix();
  scaleMatrix[0] = displayRadius;
  scaleMatrix[5] = displayRadius;
  scaleMatrix[10] = displayRadius;
  const tiltedSpin = multiplyMatrices(rotationAroundZ(tiltRadians), multiplyMatrices(rotationAroundY(spinRadians), scaleMatrix));
  return multiplyMatrices(translationMatrix4(position), tiltedSpin);
}

/**
 * Add two 3D vectors component-wise.
 *
 * @param {{ x: number, y: number, z: number }} first - left vector.
 * @param {{ x: number, y: number, z: number }} second - right vector.
 * @returns {{ x: number, y: number, z: number }} sum (new object).
 */
export function addVectors3(first, second) {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

/**
 * Subtract two 3D vectors component-wise.
 *
 * @param {{ x: number, y: number, z: number }} first - left vector.
 * @param {{ x: number, y: number, z: number }} second - right vector.
 * @returns {{ x: number, y: number, z: number }} difference (new object).
 */
export function subtractVectors3(first, second) {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

/**
 * Scale a 3D vector by a scalar.
 *
 * @param {{ x: number, y: number, z: number }} value - input vector.
 * @param {number} factor - scalar multiplier.
 * @returns {{ x: number, y: number, z: number }} scaled vector (new object).
 */
export function scaleVector3(value, factor) {
  return { x: value.x * factor, y: value.y * factor, z: value.z * factor };
}

/**
 * Euclidean length of a 3D vector.
 *
 * @param {{ x: number, y: number, z: number }} value - input vector.
 * @returns {number} length.
 */
export function lengthOfVector3(value) {
  return Math.sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
}

/**
 * Normalize a 3D vector (returns {0,0,0} for zero input).
 *
 * @param {{ x: number, y: number, z: number }} value - input vector.
 * @returns {{ x: number, y: number, z: number }} unit vector (new object).
 */
export function normalizeVector(value) {
  const length = lengthOfVector3(value);
  if (length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

/**
 * Project a world position through the committed view-projection matrix into
 * screen pixels (plan §6). NDC -> px; w <= 0 is rejected via isBehindCamera.
 *
 * @param {{ x: number, y: number, z: number }} worldPosition - scene point.
 * @param {Float32Array} viewProjectionMatrix - 16-element VP matrix.
 * @param {number} viewportWidth - CSS pixel width.
 * @param {number} viewportHeight - CSS pixel height.
 * @returns {{ xPixels: number, yPixels: number, isBehindCamera: boolean }}
 */
export function projectWorldToScreen(worldPosition, viewProjectionMatrix, viewportWidth, viewportHeight) {
  const clipX = worldPosition.x;
  const clipY = worldPosition.y;
  const clipZ = worldPosition.z;
  const clipW = 1;
  const x =
    viewProjectionMatrix[0] * clipX + viewProjectionMatrix[4] * clipY + viewProjectionMatrix[8] * clipZ + viewProjectionMatrix[12] * clipW;
  const y =
    viewProjectionMatrix[1] * clipX + viewProjectionMatrix[5] * clipY + viewProjectionMatrix[9] * clipZ + viewProjectionMatrix[13] * clipW;
  const w =
    viewProjectionMatrix[3] * clipX + viewProjectionMatrix[7] * clipY + viewProjectionMatrix[11] * clipZ + viewProjectionMatrix[15] * clipW;
  if (!Number.isFinite(w) || w <= 0.000001) {
    return { xPixels: -9999, yPixels: -9999, isBehindCamera: true };
  }
  const ndcX = x / w;
  const ndcY = y / w;
  const xPixels = (ndcX * 0.5 + 0.5) * viewportWidth;
  const yPixels = (1 - (ndcY * 0.5 + 0.5)) * viewportHeight;
  return { xPixels, yPixels, isBehindCamera: false };
}
