import * as THREE from 'three';

/**
 * LAW L3 — THE CLAMPED DAMPING HELPERS. One linear, one angular, both here.
 *
 * Rapier's built-in damping setters crash the WASM build, and their names are
 * kept out of this codebase entirely so the ban greps clean. Every braking or
 * resistance impulse in the tracker goes through one of these two functions and
 * through nothing else.
 *
 * THE CLAMP. The applied impulse points exactly opposite the velocity it is
 * given and has magnitude min(requested, maximum), where `maximum` is the
 * impulse that brings that velocity exactly to zero. It can therefore cancel
 * motion and can never reverse it. A PD derivative term that overshoots zero is
 * not damping, it is a spring with the sign flipped, and it is what turns a
 * tracked character into a strobing blur on the first frame the gains are a
 * little too high.
 *
 * THE VELOCITY IS RELATIVE. Callers hand in (bodyVelocity - targetVelocity),
 * not the body's absolute velocity. Damping the absolute velocity would brake
 * the character against its own locomotion: the sphere carries it forward at
 * 9 m/s, the tracker sees 9 m/s of "error" and spends every step fighting it.
 * A character that tracks a moving target must be free to move WITH it.
 *
 * The canonical form divides by dt and multiplies by dt again; the two cancel.
 * That is deliberate, kept in the shape the law states, and sound only because
 * dt is a genuine constant.
 *
 * DIRECTORY RULE (src/sim/): nothing here names a wall-clock or scheduler API.
 */

/** Below this there is no meaningful direction left to oppose. */
const MIN_SPEED = 1e-6;

const _dir = new THREE.Vector3();
const _impulse = { x: 0, y: 0, z: 0 };

/**
 * The angular inertia used to size the angular clamp.
 *
 * Rapier reports the principal inertia as a diagonal in the body's principal
 * frame. The exact inertia about an arbitrary axis needs that frame's rotation
 * composed with the body's; the SMALLEST principal component is a lower bound
 * on it for every axis. Using the lower bound makes `maximum` conservative, so
 * the clamp may under-damp slightly but can never, for any axis or any
 * orientation, produce an impulse large enough to reverse the spin. Given the
 * choice between a touch of residual wobble and a character that flips sign and
 * explodes, this takes the wobble.
 *
 * @param {object} body
 * @returns {number}
 */
function conservativeInertia(body) {
  const inertia = body.principalInertia();
  return Math.min(inertia.x, inertia.y, inertia.z);
}

/**
 * Linear clamped damping. THE single implementation.
 *
 * @param {object} body
 * @param {number} requestedImpulse magnitude, already scaled by dt by the caller
 * @param {THREE.Vector3} relativeVelocity body velocity MINUS target velocity
 * @param {number} dt the constant timestep
 */
export function applyClampedLinearDamping(body, requestedImpulse, relativeVelocity, dt) {
  if (!(requestedImpulse > 0)) return;

  const speed = relativeVelocity.length();
  if (speed <= MIN_SPEED) return;

  // The impulse that would land this relative velocity exactly on zero.
  const maximum = body.mass() * speed;

  _dir.copy(relativeVelocity).multiplyScalar(-Math.min(requestedImpulse, maximum) / (speed * dt));

  _impulse.x = _dir.x * dt;
  _impulse.y = _dir.y * dt;
  _impulse.z = _dir.z * dt;
  body.applyImpulse(_impulse, true);
}

/**
 * Angular clamped damping. THE single implementation.
 *
 * @param {object} body
 * @param {number} requestedImpulse magnitude, already scaled by dt by the caller
 * @param {THREE.Vector3} relativeAngvel body angular velocity MINUS target's
 * @param {number} dt the constant timestep
 */
export function applyClampedAngularDamping(body, requestedImpulse, relativeAngvel, dt) {
  if (!(requestedImpulse > 0)) return;

  const speed = relativeAngvel.length();
  if (speed <= MIN_SPEED) return;

  const maximum = conservativeInertia(body) * speed;

  _dir.copy(relativeAngvel).multiplyScalar(-Math.min(requestedImpulse, maximum) / (speed * dt));

  _impulse.x = _dir.x * dt;
  _impulse.y = _dir.y * dt;
  _impulse.z = _dir.z * dt;
  body.applyTorqueImpulse(_impulse, true);
}
