/* math.js
 * Minimal column-major vector / matrix toolkit.
 * mat4 storage is Float32Array(16) in column-major order — the native WebGPU layout.
 * All functions are pure and return fresh arrays so the code reads naturally.
 */

const MathLib = {
  /* ---------------- vector helpers ---------------- */

  add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
  subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
  scale(a, scalar) { return [a[0] * scalar, a[1] * scalar, a[2] * scalar]; },
  dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
  cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  },
  length(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); },
  normalize(a) {
    const invLength = 1 / MathLib.length(a);
    return [a[0] * invLength, a[1] * invLength, a[2] * invLength];
  },
  lerp(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ];
  },

  /* ---------------- mat4 (column-major) ---------------- */

  mat4Identity() {
    const result = new Float32Array(16);
    result[0] = 1; result[5] = 1; result[10] = 1; result[15] = 1;
    return result;
  },

  /** Returns a * b (column-major multiplication). */
  mat4Multiply(a, b) {
    const result = new Float32Array(16);
    for (let col = 0; col < 4; col += 1) {
      for (let row = 0; row < 4; row += 1) {
        let total = 0;
        for (let k = 0; k < 4; k += 1) {
          total += a[k * 4 + row] * b[col * 4 + k];
        }
        result[col * 4 + row] = total;
      }
    }
    return result;
  },

  mat4Translation(x, y, z) {
    const result = MathLib.mat4Identity();
    result[12] = x; result[13] = y; result[14] = z;
    return result;
  },

  mat4Scale(s) {
    const result = MathLib.mat4Identity();
    result[0] = s; result[5] = s; result[10] = s;
    return result;
  },

  rotationX(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const result = MathLib.mat4Identity();
    result[5] = c; result[6] = s; result[9] = -s; result[10] = c;
    return result;
  },

  rotationY(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const result = MathLib.mat4Identity();
    result[0] = c; result[2] = -s; result[8] = s; result[10] = c;
    return result;
  },

  rotationZ(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const result = MathLib.mat4Identity();
    result[0] = c; result[1] = s; result[4] = -s; result[5] = c;
    return result;
  },

  /**
   * Perspective projection.
   * fovY is in radians; aspect = width / height.
   */
  perspective(fovY, aspect, near, far) {
    const focal = 1 / Math.tan(fovY / 2);
    const result = new Float32Array(16);
    result[0] = focal / aspect;
    result[5] = focal;
    result[10] = (far + near) / (near - far);
    result[11] = (2 * far * near) / (near - far);
    result[14] = -1;
    return result;
  },

  /**
   * Look-at view matrix (classic gluLookAt layout, column-major).
   */
  lookAt(eye, target, up) {
    const zAxis = MathLib.normalize(MathLib.subtract(eye, target));
    const xAxis = MathLib.normalize(MathLib.cross(up, zAxis));
    const yAxis = MathLib.cross(zAxis, xAxis);
    const result = new Float32Array(16);
    result[0] = xAxis[0]; result[4] = xAxis[1]; result[8] = xAxis[2];
    result[1] = yAxis[0]; result[5] = yAxis[1]; result[9] = yAxis[2];
    result[2] = zAxis[0]; result[6] = zAxis[1]; result[10] = zAxis[2];
    result[3] = -MathLib.dot(xAxis, eye);
    result[7] = -MathLib.dot(yAxis, eye);
    result[11] = -MathLib.dot(zAxis, eye);
    result[15] = 1;
    return result;
  },

  /**
   * Extracts the normalized 3x3 rotation part (column-major, 9 floats)
   * from a model matrix. Safe when the matrix is rotation * uniform scale.
   */
  mat3FromModel(model) {
    const result = new Float32Array(9);
    for (let col = 0; col < 3; col += 1) {
      const x = model[col * 4], y = model[col * 4 + 1], z = model[col * 4 + 2];
      const inv = 1 / MathLib.length([x, y, z]);
      result[col * 3] = x * inv;
      result[col * 3 + 1] = y * inv;
      result[col * 3 + 2] = z * inv;
    }
    return result;
  },

  /** Transforms a world position by a mat4; returns [x, y, z, w]. */
  applyModel(model, position) {
    return [
      model[0] * position[0] + model[4] * position[1] + model[8] * position[2] + model[12],
      model[1] * position[0] + model[5] * position[1] + model[9] * position[2] + model[13],
      model[2] * position[0] + model[6] * position[1] + model[10] * position[2] + model[14],
      model[3] * position[0] + model[7] * position[1] + model[11] * position[2] + model[15]
    ];
  }
};
