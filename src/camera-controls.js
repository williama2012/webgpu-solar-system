/**
 * OrbitCamera: orbit-target camera committed in plan §9 (rotations, zoom,
 * pan, focus-follow with exponential lerp) and the view/projection matrices
 * for the renderer (§6: fovY 60°, near 0.1, far 4000).
 *
 * Conventions:
 * - targetPosition / yawRadians / pitchRadians / distance are public state;
 *   update() eases them in place each frame; input handlers mutate yaw/pitch/
 *   distance/target directly on the fly (a drag shows up next matrix call).
 * - Free mode (no focus): the target eases back toward the origin, so an empty
 *   click or Esc releases focus AND slides the view home (§9.5).
 * - Focused mode: the target tracks the live world position of the focused
 *   body and the distance lerps toward requestFocus's target distance.
 */
import {
  addVectors3,
  createLookAtViewMatrix,
  createPerspectiveMatrix,
  lengthOfVector3,
  normalizeVector,
  scaleVector3,
  subtractVectors3,
} from './math.js';
import { INITIAL_CAMERA_DISTANCE, INITIAL_CAMERA_PITCH_DEG, INITIAL_CAMERA_TARGET, INITIAL_CAMERA_YAW_DEG } from './constants.js';

/** Vertical field of view for the projection matrix (committed: fovY = 60°). */
const FIELD_OF_VIEW_Y_RADIANS = (60 * Math.PI) / 180;

/** Near/far clipping committed in §6 (math.createPerspectiveMatrix). */
const NEAR_PLANE_DISTANCE = 0.1;
const FAR_PLANE_DISTANCE = 4000;

/** Pitch clamp: ±85° so the camera never crosses the pole (§9.1). */
const PITCH_LIMIT_RADIANS = (85 * Math.PI) / 180;

/** Wheel zoom clamps: distance stays inside [0.4, 600] scene units (§9.2). */
const MIN_ZOOM_DISTANCE = 0.4;
const MAX_ZOOM_DISTANCE = 600;

/** Rotation sensitivity: radians of orbit per pixel dragged (§9.1: ·0.01). */
const ROTATE_SENSITIVITY_RADIANS_PER_PIXEL = 0.01;

/** Wheel exponent: distance ×= exp(deltaY × 0.001) per §9.2. */
const WHEEL_ZOOM_EXPONENT = 0.001;

/** Pan speed: target moves distance·0.01 scene units per pixel dragged (§9.3). */
const PAN_SCALE_PER_PIXEL = 0.01;

/** Focus-follow lerp rate: factor 1−exp(−dt×5) per frame (§6/§9.4). */
const FOCUS_LERP_RATE_PER_SECOND = 5;

/** A pointer press counts as a click only if it moved less than this many px (§9.5). */
const CLICK_DRAG_THRESHOLD_PIXELS = 4;

/** Minimum focus distance so small bodies stay resolvable (max(×6, 1.5)). */
const MIN_FOCUS_DISTANCE = 1.5;

/** Sun gets an 8× display-radius framing instead of the body ×6 rule (§6). */
const SUN_FOCUS_RADIUS_FACTOR = 8;

/** Planet/moon focus frames at 6× display radius, floored by MIN_FOCUS_DISTANCE. */
const BODY_FOCUS_RADIUS_FACTOR = 6;

/**
 * World cross product a×b (local; math.js is committed without one).
 *
 * @param {{x:number,y:number,z:number}} left - first vector.
 * @param {{x:number,y:number,z:number}} right - second vector.
 * @returns {{x:number,y:number,z:number}} the raw cross product (caller normalizes).
 */
function crossVectors3(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

/**
 * Linearly interpolate a plain {x,y,z} toward destination by factor (0..1).
 *
 * @param {{x:number,y:number,z:number}} value - in/out vector, mutated in place.
 * @param {{x:number,y:number,z:number}} destination - target.
 * @param {number} factor - lerp amount (0 = stay, 1 = snap to destination).
 * @returns {void}
 */
function lerpVector3InPlace(value, destination, factor) {
  value.x += (destination.x - value.x) * factor;
  value.y += (destination.y - value.y) * factor;
  value.z += (destination.z - value.z) * factor;
}

/**
 * Clamp a scalar to [minimum, maximum].
 *
 * @param {number} value - input.
 * @param {number} minimum - low bound.
 * @param {number} maximum - high bound.
 * @returns {number} clamped value.
 */
function clampToRange(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Orbit-target camera (plan §6/§9). Owns pointer input on the canvas and the
 * yaw/pitch/distance/target state; main.js drives update() per frame.
 */
export class OrbitCamera {
  /**
   * Build the camera at the committed initial framing (§4: target origin,
   * distance 240, yaw 35°, pitch 18°).
   *
   * @param {Array<object>} bodiesArray - scene bodies returned by createSolarSystem
   *   (live reference; requestFocus reads displayRadius at call time so scale
   *   slider changes stay current).
   */
  constructor(bodiesArray) {
    /** Scene body lookup for requestFocus distances. @type {Map<string, object>} */
    this.bodiesByName = new Map(bodiesArray.map((body) => [body.name, body]));

    /** Orbit target in scene units; mutated in place by update() and pan. @type {{x:number,y:number,z:number}} */
    this.targetPosition = { x: INITIAL_CAMERA_TARGET.x, y: INITIAL_CAMERA_TARGET.y, z: INITIAL_CAMERA_TARGET.z };

    /** Orbit angle around the Y axis (radians). @type {number} */
    this.yawRadians = (INITIAL_CAMERA_YAW_DEG * Math.PI) / 180;

    /** Elevation above the ecliptic, clamped to ±85° (radians). @type {number} */
    this.pitchRadians = (INITIAL_CAMERA_PITCH_DEG * Math.PI) / 180;

    /** Camera distance from target in scene units. @type {number} */
    this.distance = INITIAL_CAMERA_DISTANCE;

    /** Focused body name, or null in free mode. @type {string|null} */
    this.focusBodyName = null;

    /** Target distance while focused (lerped toward each frame); null in free mode. @type {number|null} */
    this.distanceTarget = null;

    // Pointer bookkeeping (input handling only).
    /** Pointer id of the in-progress drag, or null. @type {number|null} */
    this.dragPointerId = null;
    /** Last client coords of the pressed pointer. @type {{x:number,y:number}} */
    this.lastClientPosition = { x: 0, y: 0 };
    /** Total pixels moved during the current drag (click vs drag, §9.5). @type {number} */
    this.dragTravelPixels = 0;
  }

  /**
   * Attach the committed input model to a canvas (§9): left-drag rotate,
   * wheel zoom, right/shift-left drag pan (pan cancels focus), and an
   * optional single-click callback for no-drag primary clicks (picking is
   * implemented in main.js; this just forwards the event).
   *
   * @param {HTMLCanvasElement} canvasElement - the render canvas to listen on.
   * @param {(clientX:number, clientY:number) => void} [onSingleClick] - optional no-drag click callback (primary button, no shift); receives client coords.
   * @returns {void}
   */
  attachDomElement(canvasElement, onSingleClick) {
    canvasElement.addEventListener('pointerdown', (event) => {
      if (event.button === 1) return; // middle-drag is not part of the model
      this.dragPointerId = event.pointerId;
      this.lastClientPosition = { x: event.clientX, y: event.clientY };
      this.dragTravelPixels = 0;
      canvasElement.setPointerCapture(event.pointerId);
    });

    canvasElement.addEventListener('pointermove', (event) => {
      if (this.dragPointerId === null || event.pointerId !== this.dragPointerId) return;
      const deltaClientX = event.clientX - this.lastClientPosition.x;
      const deltaClientY = event.clientY - this.lastClientPosition.y;
      this.lastClientPosition = { x: event.clientX, y: event.clientY };
      this.dragTravelPixels += Math.abs(deltaClientX) + Math.abs(deltaClientY);

      // Right button, or shift+primary → pan; everything else rotates (§9).
      const panning = (event.buttons & 2) !== 0 || ((event.buttons & 1) !== 0 && event.shiftKey);
      if (panning) {
        this.panByClientPixels(deltaClientX, deltaClientY);
      } else {
        this.rotateByClientPixels(deltaClientX, deltaClientY);
      }
    });

    const finishDrag = (event) => {
      if (this.dragPointerId === null || event.pointerId !== this.dragPointerId) return;
      const wasClick = this.dragTravelPixels < CLICK_DRAG_THRESHOLD_PIXELS && event.button === 0 && !event.shiftKey && typeof onSingleClick === 'function';
      canvasElement.releasePointerCapture(event.pointerId);
      this.dragPointerId = null;
      if (wasClick) onSingleClick(event.clientX, event.clientY);
    };

    canvasElement.addEventListener('pointerup', finishDrag);
    canvasElement.addEventListener('pointercancel', finishDrag);

    canvasElement.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault(); // never let the browser scroll/zoom the page
        this.zoomByWheelDelta(event.deltaY);
      },
      { passive: false },
    );

    canvasElement.addEventListener('contextmenu', (event) => event.preventDefault()); // right-drag pans, no menu
  }

  /**
   * Orbit the view: yaw += dx·0.01, pitch −= dy·0.01, pitch clamped ±85° (§9.1).
   *
   * @param {number} clientDeltaX - horizontal pixels dragged (screen x, right positive).
   * @param {number} clientDeltaY - vertical pixels dragged (screen y, down positive).
   * @returns {void}
   */
  rotateByClientPixels(clientDeltaX, clientDeltaY) {
    this.yawRadians += clientDeltaX * ROTATE_SENSITIVITY_RADIANS_PER_PIXEL;
    this.pitchRadians = clampToRange(this.pitchRadians - clientDeltaY * ROTATE_SENSITIVITY_RADIANS_PER_PIXEL, -PITCH_LIMIT_RADIANS, PITCH_LIMIT_RADIANS);
  }

  /**
   * Pan the target along camera right/up at distance·0.01 units per pixel (§9.3);
   * the first pan move cancels focus (free mode; §9.3).
   *
   * @param {number} clientDeltaX - horizontal pixels dragged.
   * @param {number} clientDeltaY - vertical pixels dragged.
   * @returns {void}
   */
  panByClientPixels(clientDeltaX, clientDeltaY) {
    if (this.focusBodyName !== null) this.releaseFocus(); // pan cancels focus
    const scale = this.distance * PAN_SCALE_PER_PIXEL;
    const cameraRight = this.computeCameraRight();
    const cameraUp = this.computeCameraUp(cameraRight);
    this.targetPosition = addVectors3(this.targetPosition, addVectors3(scaleVector3(cameraRight, -clientDeltaX * scale), scaleVector3(cameraUp, clientDeltaY * scale)));
  }

  /**
   * Wheel zoom: distance ×= exp(deltaY × 0.001), clamped [0.4, 600]; while
   * focused the tracking distance target stays in sync so focus follows the
   * wheel instead of fighting it (§9.2).
   *
   * @param {number} wheelDeltaY - raw event.deltaY (positive = scroll out).
   * @returns {void}
   */
  zoomByWheelDelta(wheelDeltaY) {
    this.distance = clampToRange(this.distance * Math.exp(wheelDeltaY * WHEEL_ZOOM_EXPONENT), MIN_ZOOM_DISTANCE, MAX_ZOOM_DISTANCE);
    if (this.focusBodyName !== null) this.distanceTarget = this.distance;
  }

  /**
   * Focus a body: sets focusBodyName and the tracked distance target —
   * max(displayRadius×6, 1.5) for planets/moons, sunDisplayRadius×8 for the Sun (§6).
   * The view eases in; nothing snaps.
   *
   * @param {string} bodyName - scene body name (Sun … Triton).
   * @returns {void}
   */
  requestFocus(bodyName) {
    const body = this.bodiesByName.get(bodyName);
    if (!body) return; // unknown name: stay where we are
    this.focusBodyName = bodyName;
    this.distanceTarget = body.kind === 'sun' ? body.displayRadius * SUN_FOCUS_RADIUS_FACTOR : Math.max(body.displayRadius * BODY_FOCUS_RADIUS_FACTOR, MIN_FOCUS_DISTANCE);
  }

  /**
   * Release focus (Esc / empty click / label close): free mode resumes and the
   * target eases home toward the origin via update().
   *
   * @returns {void}
   */
  releaseFocus() {
    this.focusBodyName = null;
    this.distanceTarget = null;
  }

  /**
   * Per-frame camera step (§6): focused → lerp target to the body's live world
   * position and distance toward distanceTarget with factor 1−exp(−dt×5);
   * free mode → target lerps to the origin.
   *
   * @param {number} deltaTimeSeconds - clamped frame delta (main.js clamps to ≤0.05).
   * @param {Map<string, [number, number, number]>} worldPositions - scene positions of ALL bodies this frame (focused name must be present).
   * @returns {void}
   */
  update(deltaTimeSeconds, worldPositions) {
    const lerpFactor = 1 - Math.exp(-deltaTimeSeconds * FOCUS_LERP_RATE_PER_SECOND);
    if (this.focusBodyName !== null) {
      const livePosition = worldPositions.get(this.focusBodyName);
      lerpVector3InPlace(this.targetPosition, { x: livePosition[0], y: livePosition[1], z: livePosition[2] }, lerpFactor);
      if (this.distanceTarget !== null) this.distance += (this.distanceTarget - this.distance) * lerpFactor;
    } else {
      lerpVector3InPlace(this.targetPosition, { x: 0, y: 0, z: 0 }, lerpFactor);
    }
  }

  /**
   * World→view matrix for the renderer (§6 math.createLookAtViewMatrix).
   * Recomputes the eye from live orbit state first, so a drag made between
   * RAFs is already visible in this frame's matrix.
   *
   * @returns {Float32Array} column-major 4×4 view matrix.
   */
  getViewMatrix() {
    const eyePosition = this.computeEyePosition();
    return createLookAtViewMatrix(eyePosition, this.targetPosition, { x: 0, y: 1, z: 0 });
  }

  /**
   * Perspective projection (fovY 60°, near 0.1, far 4000 — committed §6).
   *
   * @param {number} aspectRatio - viewport width / height in CSS pixels.
   * @returns {Float32Array} column-major 4×4 projection matrix.
   */
  getProjectionMatrix(aspectRatio) {
    return createPerspectiveMatrix(FIELD_OF_VIEW_Y_RADIANS, aspectRatio, NEAR_PLANE_DISTANCE, FAR_PLANE_DISTANCE);
  }

  /**
   * Distance from the camera eye to a scene point — used for label LOD and
   * picking screen-radius (§6, §9.5).
   *
   * @param {{x:number,y:number,z:number}} point - scene position.
   * @returns {number} Euclidean distance in scene units.
   */
  getDistanceTo(point) {
    return lengthOfVector3(subtractVectors3(this.computeEyePosition(), point));
  }

  /**
   * Camera basis for the global uniform buffer: eye position + normalized
   * forward/right/up (§7 global layout [32..79]).
   *
   * @returns {{position:{x:number,y:number,z:number}, forward:{x:number,y:number,z:number}, right:{x:number,y:number,z:number}, up:{x:number,y:number,z:number}}}
   */
  getCameraBasis() {
    const forward = this.computeViewDirection();
    const cameraRight = normalizeVector(crossVectors3({ x: 0, y: 1, z: 0 }, forward));
    return { position: this.computeEyePosition(), forward, right: cameraRight, up: normalizeVector(crossVectors3(forward, cameraRight)) };
  }

  /**
   * Eye position from orbit state: target + distance · offsetDir where
   * offsetDir = (cos(pitch)·sin(yaw), sin(pitch), cos(pitch)·cos(yaw)).
   *
   * @returns {{x:number,y:number,z:number}} scene position of the eye.
   */
  computeEyePosition() {
    const reachHorizontal = this.distance * Math.cos(this.pitchRadians);
    return {
      x: this.targetPosition.x + reachHorizontal * Math.sin(this.yawRadians),
      y: this.targetPosition.y + this.distance * Math.sin(this.pitchRadians),
      z: this.targetPosition.z + reachHorizontal * Math.cos(this.pitchRadians),
    };
  }

  /**
   * Normalized eye→target direction.
   *
   * @returns {{x:number,y:number,z:number}} unit forward vector.
   */
  computeViewDirection() {
    return normalizeVector(subtractVectors3(this.targetPosition, this.computeEyePosition()));
  }

  /**
   * Camera right axis: cross(worldUp, forward), normalized; |pitch| < 85° keeps it finite.
   *
   * @returns {{x:number,y:number,z:number}} unit right vector.
   */
  computeCameraRight() {
    return normalizeVector(crossVectors3({ x: 0, y: 1, z: 0 }, this.computeViewDirection()));
  }

  /**
   * Camera up axis: cross(forward, cameraRight), normalized.
   *
   * @param {{x:number,y:number,z:number}} cameraRight - the right vector to pair (recomputed here so callers can't pass a stale one).
   * @returns {{x:number,y:number,z:number}} unit up vector.
   */
  computeCameraUp(cameraRight) {
    return normalizeVector(crossVectors3(this.computeViewDirection(), cameraRight));
  }
}
