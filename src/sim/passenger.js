import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { Interpolated } from '../core/Interpolated.js';

/**
 * The placeholder box.
 *
 * A pure passenger: it reads the motor's state and writes only its own
 * transform. It never touches a body, a force or a velocity.
 *
 * Its yaw easing runs here, at the fixed rate, rather than in the render pass.
 * That is deliberate on two counts. The render pass may only write transforms
 * through Interpolated.apply(), so it cannot own a value that persists between
 * frames. And easing against the fixed timestep makes the turn identical at
 * every refresh rate instead of drifting with frame rate.
 *
 * DIRECTORY RULE (src/sim/): nothing here names a wall-clock or scheduler API.
 */

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TWO_PI = Math.PI * 2;

/** Signed shortest way round from `from` to `to`, in (-PI, PI]. */
function shortestAngleDelta(from, to) {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta <= -Math.PI) delta += TWO_PI;
  return delta;
}

/**
 * @returns {{ mesh: THREE.Mesh, interpolated: Interpolated, yaw: number, targetYaw: number }}
 */
export function createPassenger() {
  const { boxWidth, boxHeight, boxDepth } = TUNING.visual;

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth),
    new THREE.MeshStandardMaterial({ color: 0x4fa8e0, roughness: 0.5, metalness: 0.05 }),
  );
  mesh.name = 'passenger';
  mesh.position.set(0, TUNING.motor.spawnY, 0);

  return { mesh, interpolated: new Interpolated(mesh), yaw: 0, targetYaw: 0 };
}

/**
 * One fixed step of the passenger. Reads the motor's freshly snapshotted
 * position and its linear velocity; writes only its own curr transform.
 *
 * @param {ReturnType<typeof createPassenger>} passenger
 * @param {import('./motor.js').createMotor} motor
 * @param {number} dt the constant timestep
 */
export function updatePassenger(passenger, motor, dt) {
  const centre = motor.interpolated.currPos;

  // The box stands on the ground, not on the sphere's centre: lift it by half
  // its height and drop it by the sphere's radius.
  const lift = TUNING.visual.boxHeight / 2 - motor.radius;
  passenger.interpolated.currPos.set(centre.x, centre.y + lift, centre.z);

  const linear = motor.body.linvel();
  const speed = Math.hypot(linear.x, linear.z);

  // Below the threshold the velocity vector has no reliable direction left in
  // it, so the box keeps the heading it already had rather than spinning.
  if (speed > TUNING.visual.turnSpeedThreshold) {
    passenger.targetYaw = Math.atan2(linear.x, linear.z);
  }

  // Exponential ease. Expressed against dt so it is frame-rate independent, and
  // exact rather than the usual lerp approximation.
  const blend = 1 - Math.exp(-TUNING.visual.turnLerpSpeed * dt);
  passenger.yaw += shortestAngleDelta(passenger.yaw, passenger.targetYaw) * blend;

  passenger.interpolated.currQuat.setFromAxisAngle(WORLD_UP, passenger.yaw);
}
