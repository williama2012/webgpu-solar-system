/**
 * Camera focus/follow controller. Wraps the ripl camera: flies to a chosen
 * body with an eased tween, then keeps following it (re-anchoring target
 * and position each frame) while the user stays free to orbit, zoom and
 * pan through the built-in interactions.
 */

import { addVectors } from './orbit.js';

const APPROACH_DIRECTION = normalizeVector([0.42, 0.34, 1]);
const FLIGHT_DURATION_SECONDS = 1.5;

/**
 * Normalizes a 3D vector.
 *
 * @param {[number, number, number]} vector - Input vector.
 * @returns {[number, number, number]} Unit vector.
 */
function normalizeVector(vector) {
    const length = Math.hypot(vector[0], vector[1], vector[2]);
    return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * Linear interpolation between two 3D vectors.
 *
 * @param {[number, number, number]} from - Start vector.
 * @param {[number, number, number]} to - End vector.
 * @param {number} t - Blend factor in [0, 1].
 * @returns {[number, number, number]} Interpolated vector.
 */
function lerpVectors(from, to, t) {
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
}

/**
 * Classic ease-in-out cubic.
 *
 * @param {number} t - Normalized time in [0, 1].
 * @returns {number} Eased value.
 */
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 1, 3) / 2;
}

export class CameraController {
    /**
     * @param {{ camera: object, bodies: Map<string, object> }} parameters -
     *   The ripl camera and the body record map (keyed by body id).
     */
    constructor({ camera, bodies }) {
        this.camera = camera;
        this.bodies = bodies;
        this.followedBody = bodies.get('sun');
        this.flight = null;
    }

    /**
     * Returns the standard camera distance for one body.
     *
     * @param {object} body - Body record.
     * @returns {number} Focus distance in scene units.
     */
    focusDistance(body) {
        return body.isSun ? 70 : Math.max(body.radiusUnits * 9, 3.5);
    }

    /**
     * Starts a fly-to flight for one body (or the Sun).
     *
     * @param {string} bodyId - Id of the body to focus on.
     * @returns {void}
     */
    focusOnBody(bodyId) {
        const body = this.bodies.get(bodyId);
        if (!body) {
            return;
        }
        this.flight = {
            body,
            startPosition: [...this.camera.position],
            startTarget: [...this.camera.target],
            elapsed: 0,
        };
    }

    /**
     * Advances flight/follow state once per frame.
     *
     * @param {number} deltaSeconds - Frame delta time in seconds.
     * @returns {void}
     */
    update(deltaSeconds) {
        if (this.flight) {
            const flight = this.flight;
            flight.elapsed += deltaSeconds;
            const liveTarget = [...flight.body.worldPosition];
            const livePosition = addVectors(liveTarget,
                APPROACH_DIRECTION.map((component) => component * this.focusDistance(flight.body)));
            const t = Math.min(1, flight.elapsed / FLIGHT_DURATION_SECONDS);
            const eased = easeInOutCubic(t);
            this.camera.position = lerpVectors(flight.startPosition, livePosition, eased);
            this.camera.target = lerpVectors(flight.startTarget, liveTarget, eased);
            if (t >= 1) {
                this.flight = null;
                this.followedBody = flight.body;
            }
        } else if (this.followedBody) {
            // Keep the exact user-chosen camera offset while the followed
            // body moves, so orbit/zoom keep working while it is tracked.
            const bodyPosition = this.followedBody.worldPosition;
            const offset = [
                this.camera.position[0] - this.camera.target[0],
                this.camera.position[1] - this.camera.target[1],
                this.camera.position[2] - this.camera.target[2],
            ];
            this.camera.target = [...bodyPosition];
            this.camera.position = addVectors(bodyPosition, offset);
        }
    }
}