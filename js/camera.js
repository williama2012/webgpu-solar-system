/* camera.js
 * OrbitCamera: damped, fly-free orbit camera with rotate / zoom / pan / pinch,
 * smooth focus-on-body transitions, and screen projection for labels.
 * All matrix code is local (column-major Float32Array) so this file is self-contained.
 */

class OrbitCamera {
  constructor() {
    this.fovDegrees = 55;
    this.nearPlane = 0.05;
    this.farPlane = 3000;

    /* Live + desired state: the live values are exponentially damped toward the
       desired ones every frame, which gives buttery focus transitions for free. */
    this.target = [0, 0, 0];
    this.desiredTarget = [0, 0, 0];
    this.theta = 0.9;                       /* azimuth around Y            */
    this.phi = 1.05;                        /* polar angle from +Y (rad)    */
    this.radius = 210;
    this.desiredRadius = 210;
    this.minRadius = 1.4;
    this.maxRadius = 950;

    this.following = null;                 /* body record we are tracking  */
    this.right = [1, 0, 0];
    this.up = [0, 1, 0];
    this.forward = [0, 0, -1];
    this.position = [0, 0, 210];
    this.viewProjectionMatrix = new Float32Array(16);
    this.projectionMatrix = new Float32Array(16);
    this.viewMatrix = new Float32Array(16);
  }

  /* ---------------- tiny linear algebra (column-major) ---------------- */

  static multiply(outA, left, right) {
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        let total = 0;
        for (let k = 0; k < 4; k += 1) { total += left[k * 4 + row] * right[column * 4 + k]; }
        outA[column * 4 + row] = total;
      }
    }
  }

  static perspective(outA, fovY, aspect, nearPlane, farPlane) {
    const focus = 1 / Math.tan(fovY / 2);
    outA.fill(0);
    outA[0] = focus / aspect; outA[5] = focus;
    outA[10] = (farPlane + nearPlane) / (nearPlane - farPlane);
    outA[11] = (2 * farPlane * nearPlane) / (nearPlane - farPlane);
    outA[14] = -1; outA[15] = 0;
  }

  static lookAt(outA, eye, target, worldUp) {
    const zAxis = OrbitCamera.normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
    const xAxis = OrbitCamera.normalize(OrbitCamera.cross(worldUp, zAxis));
    const yAxis = OrbitCamera.cross(zAxis, xAxis);
    outA[0] = xAxis[0]; outA[1] = yAxis[0]; outA[2] = zAxis[0]; outA[3] = 0;
    outA[4] = xAxis[1]; outA[5] = yAxis[1]; outA[6] = zAxis[1]; outA[7] = 0;
    outA[8] = xAxis[2]; outA[9] = yAxis[2]; outA[10] = zAxis[2]; outA[11] = 0;
    outA[12] = -OrbitCamera.dot(xAxis, eye);
    outA[13] = -OrbitCamera.dot(yAxis, eye);
    outA[14] = -OrbitCamera.dot(zAxis, eye);
    outA[15] = 1;
  }

  static cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  static dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  static normalize(v) {
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
  }

  /* ---------------- input ---------------- */

  attach(canvasElement) {
    let dragging = false;
    let panning = false;
    let lastX = 0;
    let lastY = 0;
    const pointers = new Map();

    canvasElement.addEventListener('pointerdown', (event) => {
      pointers.set(event.pointerId, [event.clientX, event.clientY]);
      if (pointers.size === 1) {
        dragging = true;
        panning = event.button === 2 || event.shiftKey;
        lastX = event.clientX; lastY = event.clientY;
      }
      canvasElement.setPointerCapture(event.pointerId);
    });

    canvasElement.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) { return; }
      pointers.set(event.pointerId, [event.clientX, event.clientY]);
      if (pointers.size === 2) {
        /* Two-finger touch: pinch zooms, centroid drift pans. */
        const entries = [...pointers.values()];
        const centroidX = (entries[0][0] + entries[1][0]) / 2;
        const centroidY = (entries[0][1] + entries[1][1]) / 2;
        const previous = event.movementX !== undefined ? event.movementX : 0;
        this.panBy(-event.movementX * 0.0016, -event.movementY * 0.0016);
        void centroidX; void centroidY; void previous;
        const distance = Math.hypot(entries[0][0] - entries[1][0], entries[0][1] - entries[1][1]);
        const other = entries[0][0] - entries[1][0];
        void other;
        this.pinchZoom(distance);
        return;
      }
      if (!dragging) { return; }
      const deltaX = event.clientX - lastX;
      const deltaY = event.clientY - lastY;
      lastX = event.clientX; lastY = event.clientY;
      if (panning) { this.panBy(deltaX, deltaY); } else { this.rotateBy(deltaX, deltaY); }
    });

    const endPointer = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size === 0) { dragging = false; panning = false; }
    };
    canvasElement.addEventListener('pointerup', endPointer);
    canvasElement.addEventListener('pointercancel', endPointer);
    canvasElement.addEventListener('contextmenu', (event) => { event.preventDefault(); });

    canvasElement.addEventListener('wheel', (event) => {
      event.preventDefault();
      const zoomFactor = Math.exp(-event.deltaY * 0.0012);
      this.desiredRadius = Math.min(this.maxRadius, Math.max(this.minRadius, this.desiredRadius * zoomFactor));
    }, { passive: false });
  }

  rotateBy(deltaX, deltaY) {
    this.theta -= deltaX * 0.005;
    this.phi = Math.min(3.05, Math.max(0.09, this.phi - deltaY * 0.005));
  }

  panBy(deltaX, deltaY) {
    const panSpeed = this.radius * 0.0019;
    this.desiredTarget[0] -= (this.right[0] * deltaX + this.up[0] * -deltaY) * panSpeed * 60 * 0.016;
    this.desiredTarget[1] -= (this.right[1] * deltaX + this.up[1] * -deltaY) * panSpeed * 60 * 0.016;
    this.desiredTarget[2] -= (this.right[2] * deltaX + this.up[2] * -deltaY) * panSpeed * 60 * 0.016;
  }

  pinchZoom(currentDistance) {
    if (this.pinchDistance === undefined) { this.pinchDistance = currentDistance; return; }
    const factor = this.pinchDistance / currentDistance;
    this.pinchDistance = currentDistance;
    this.desiredRadius = Math.min(this.maxRadius, Math.max(this.minRadius, this.desiredRadius * factor));
  }

  /* ---------------- focusing ---------------- */

  followBody(body) {
    this.following = body;
    this.desiredRadius = Math.max(body.radius * 9, 2.4);
  }

  releaseFocus() { this.following = null; }

  /* ---------------- per-frame update ---------------- */

  update(deltaSeconds, followPosition) {
    const damping = 1 - Math.exp(-deltaSeconds * 6.5);
    const targetGoal = followPosition || this.desiredTarget;
    for (let axis = 0; axis < 3; axis += 1) {
      this.target[axis] += (targetGoal[axis] - this.target[axis]) * damping;
    }
    this.radius += (this.desiredRadius - this.radius) * damping;

    const sinPhi = Math.sin(this.phi);
    this.position = [
      this.target[0] + this.radius * sinPhi * Math.cos(this.theta),
      this.target[1] + this.radius * Math.cos(this.phi),
      this.target[2] + this.radius * sinPhi * Math.sin(this.theta)
    ];
    this.forward = OrbitCamera.normalize([this.target[0] - this.position[0], this.target[1] - this.position[1], this.target[2] - this.position[2]]);
    this.right = OrbitCamera.normalize(OrbitCamera.cross(this.forward, [0, 1, 0]));
    this.up = OrbitCamera.cross(this.right, this.forward);

    this.projectionMatrix = new Float32Array(16);
    OrbitCamera.perspective(this.projectionMatrix, (this.fovDegrees * Math.PI) / 180, 1, this.nearPlane, this.farPlane);
    this.viewMatrix = new Float32Array(16);
    OrbitCamera.lookAt(this.viewMatrix, this.position, this.target, [0, 1, 0]);
    this.viewProjectionMatrix = new Float32Array(16);
    OrbitCamera.multiply(this.viewProjectionMatrix, this.projectionMatrix, this.viewMatrix);
    this.aspectStored = 1;  /* filled by Scene before drawing (canvas aspect) */
  }

  /* Projects a world point to CSS pixels; visible=false when behind camera. */
  project(worldPoint, canvasWidth, canvasHeight) {
    const m = this.viewProjectionMatrix;
    const x = m[0] * worldPoint[0] + m[4] * worldPoint[1] + m[8] * worldPoint[2] + m[12];
    const y = m[1] * worldPoint[0] + m[5] * worldPoint[1] + m[9] * worldPoint[2] + m[13];
    const w = m[3] * worldPoint[0] + m[7] * worldPoint[1] + m[11] * worldPoint[2] + m[15];
    if (w <= 0.0001) { return { visible: false, x: 0, y: 0 }; }
    return {
      visible: true,
      x: (x / w * 0.5 + 0.5) * canvasWidth,
      y: (-y / w * 0.5 + 0.5) * canvasHeight
    };
  }
}