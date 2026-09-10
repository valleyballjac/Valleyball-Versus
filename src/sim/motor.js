import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { Interpolated } from '../core/Interpolated.js';
import { RAPIER, getWorld, ENVIRONMENT_RAY_GROUPS } from './physics.js';

/**
 * The Sphere Motor.
 *
 * LAW L1 — physics owns momentum. The root is a dynamic sphere driven only by
 * torque and force. Nothing here writes a velocity or a position onto the body
 * during play. There is no kinematic override anywhere in this file.
 *
 * LAW L3 — no explicit damping. Rapier's built-in damping setters are never
 * called anywhere (they crash the WASM build), and their names are kept out of
 * this file entirely so the ban is checkable with a plain grep. All resistance
 * goes through applyClampedDamping below, the single implementation of the clamp.
 *
 * DIRECTORY RULE (src/sim/): nothing here names a wall-clock or scheduler API.
 * The only time this file knows about is the constant dt it is handed.
 */

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const STRAIGHT_DOWN = { x: 0, y: -1, z: 0 };

/** Below this the angular velocity has no meaningful direction to oppose. */
const MIN_ANGULAR_SPEED = 1e-6;
/** Below this the stick is at rest; used to decide braking, not to scale drive. */
const MIN_INPUT = 1e-4;

const _axis = new THREE.Vector3();
const _angvel = new THREE.Vector3();
const _torque = new THREE.Vector3();
const _impulse = { x: 0, y: 0, z: 0 };

// The Ray keeps references to these, so the fan mutates them in place rather
// than allocating a ray per cast per step. Built lazily: this module is
// imported before RAPIER.init() has been awaited.
const _rayOrigin = { x: 0, y: 0, z: 0 };
let _ray = null;

let _cachedRingCount = -1;
let _ringCos = null;
let _ringSin = null;
let _lastHitRingIndex = -1;

function getRingOffsets(ringCount) {
  if (ringCount !== _cachedRingCount) {
    _cachedRingCount = ringCount;
    _ringCos = new Float32Array(ringCount);
    _ringSin = new Float32Array(ringCount);
    for (let i = 0; i < ringCount; i++) {
      const angle = (i / ringCount) * Math.PI * 2;
      _ringCos[i] = Math.cos(angle);
      _ringSin[i] = Math.sin(angle);
    }
  }
  return { cos: _ringCos, sin: _ringSin };
}

/**
 * The angular inertia of the root, about any axis.
 *
 * The root is a uniform ball, so I = 2/5 · m · r² exactly — no need for an
 * inertia-tensor query, and no dependence on an API whose shape varies between
 * Rapier releases. `radius` is the construction-time value; it is marked
 * display-only in the panel precisely because the collider is not rebuilt.
 *
 * @param {object} body
 * @returns {number}
 */
function angularInertia(body) {
  const radius = TUNING.motor.radius;
  return 0.4 * body.mass() * radius * radius;
}

/**
 * LAW L3 — the Damping-Impulse Clamp. THE single implementation. Every braking
 * or resistance site in this codebase calls this and nothing else.
 *
 * The applied impulse points exactly opposite the angular velocity and has
 * magnitude min(requested, maximum), where `maximum` is the impulse that brings
 * the current angular speed exactly to zero. It can therefore cancel motion and
 * can never reverse it — which is what stops the ball jittering backwards as it
 * settles.
 *
 * The canonical form divides by dt and the caller multiplies by dt again; the
 * two cancel. That is deliberate rather than sloppy: it keeps the expression in
 * the shape the law states, and it is only sound because dt is a genuine
 * constant. On a variable timestep the clamp would be unsound and the character
 * would explode on slow frames.
 *
 * @param {object} body
 * @param {number} requestedImpulse magnitude, already scaled by dt by the caller
 * @param {number} dt the constant timestep
 */
export function applyClampedDamping(body, requestedImpulse, dt) {
  if (!(requestedImpulse > 0)) return;

  const angular = body.angvel();
  const speed = Math.hypot(angular.x, angular.y, angular.z);
  if (speed <= MIN_ANGULAR_SPEED) return;

  // The impulse that would land the speed exactly on zero.
  const maximum = angularInertia(body) * speed;

  _angvel.set(angular.x, angular.y, angular.z);
  _torque.set(0, 0, 0);
  _torque.addScaledVector(_angvel, -Math.min(requestedImpulse, maximum) / (speed * dt));

  _impulse.x = _torque.x * dt;
  _impulse.y = _torque.y * dt;
  _impulse.z = _torque.z * dt;
  body.applyTorqueImpulse(_impulse, true);
}

/**
 * LAW 6 — the grounded check is a distance-based ray FAN, never a single centre
 * ray, and grounded is decided by hit DISTANCE rather than by a hit existing.
 *
 * One ray from the body centre plus a ring of rays offset by the sphere radius,
 * all pointing straight down, all excluding the sphere's own body. The ring is
 * what keeps the flag true on the bowl's curved wall, where a centre ray alone
 * would start reporting nothing as the contact point slides off-centre.
 *
 * @param {object} body
 * @param {number} radius
 * @returns {boolean}
 */
function castGroundFan(body, radius) {
  const world = getWorld();
  if (!_ray) _ray = new RAPIER.Ray(_rayOrigin, STRAIGHT_DOWN);

  const origin = body.translation();
  const reach = radius + TUNING.motor.groundedEpsilon;
  const ringCount = Math.max(0, Math.round(TUNING.motor.groundRayCount));

  // 1 — Centre ray: on flat ground or gentle slopes, this hits immediately and early-exits.
  _rayOrigin.x = origin.x;
  _rayOrigin.y = origin.y;
  _rayOrigin.z = origin.z;
  const centerHit = world.castRay(
    _ray, reach, true, undefined, ENVIRONMENT_RAY_GROUPS, undefined, body,
  );
  if (centerHit && centerHit.timeOfImpact <= reach) {
    _lastHitRingIndex = -1;
    return true;
  }

  if (ringCount <= 0) return false;

  const { cos, sin } = getRingOffsets(ringCount);

  // 2 — Temporal coherence: if a perimeter ray hit on the previous step (e.g. while
  // rolling along a slope or mound), test that ray first before checking the rest.
  if (_lastHitRingIndex >= 0 && _lastHitRingIndex < ringCount) {
    _rayOrigin.x = origin.x + cos[_lastHitRingIndex] * radius;
    _rayOrigin.y = origin.y;
    _rayOrigin.z = origin.z + sin[_lastHitRingIndex] * radius;
    const hit = world.castRay(
      _ray, reach, true, undefined, ENVIRONMENT_RAY_GROUPS, undefined, body,
    );
    if (hit && hit.timeOfImpact <= reach) return true;
  }

  // 3 — Check remaining ring rays
  for (let i = 0; i < ringCount; i++) {
    if (i === _lastHitRingIndex) continue;

    _rayOrigin.x = origin.x + cos[i] * radius;
    _rayOrigin.y = origin.y;
    _rayOrigin.z = origin.z + sin[i] * radius;

    const hit = world.castRay(
      _ray, reach, true, undefined, ENVIRONMENT_RAY_GROUPS, undefined, body,
    );

    if (hit && hit.timeOfImpact <= reach) {
      _lastHitRingIndex = i;
      return true;
    }
  }

  _lastHitRingIndex = -1;
  return false;
}

/**
 * Builds the root sphere and its debug wireframe.
 * @returns {{ body: object, collider: object, mesh: THREE.Mesh, interpolated: Interpolated, radius: number, grounded: boolean }}
 */
export function createMotor() {
  const world = getWorld();
  const { radius, density, friction, restitution, spawnY } = TUNING.motor;

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, spawnY, 0)
      // LAW 6 — a sleeping root ignores the first input after a rest.
      .setCanSleep(false),
  );

  const collider = world.createCollider(
    RAPIER.ColliderDesc.ball(radius)
      .setDensity(density)
      .setFriction(friction)
      .setRestitution(restitution),
    body,
  );

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x8fd0ff, wireframe: true }),
  );
  mesh.name = 'motor-sphere';
  mesh.position.set(0, spawnY, 0);

  return {
    body,
    collider,
    mesh,
    interpolated: new Interpolated(mesh),
    radius,
    grounded: false,
    // MECHANICS state, not character state (L4): the tick a jump last fired, so
    // the cooldown can be measured against the canonical clock. -Infinity means
    // "never", so the first jump of a run always fires.
    lastJumpTick: -Infinity,
    appliedFriction: friction,
    appliedRestitution: restitution,
  };
}

/**
 * Pushes the live surface tunables onto the collider. Called from inside
 * fixedUpdate so that every physics mutation stays inside the fixed step, and
 * only when a value actually changed.
 */
function syncSurfaceTuning(motor) {
  if (motor.appliedFriction !== TUNING.motor.friction) {
    motor.appliedFriction = TUNING.motor.friction;
    motor.collider.setFriction(motor.appliedFriction);
  }
  if (motor.appliedRestitution !== TUNING.motor.restitution) {
    motor.appliedRestitution = TUNING.motor.restitution;
    motor.collider.setRestitution(motor.appliedRestitution);
  }
}

/**
 * One fixed step of the motor. Applies forces only — the world is stepped by
 * the caller, immediately after this returns.
 *
 * @param {ReturnType<typeof createMotor>} motor
 * @param {import('../input.js').input} input the latched frame snapshot
 * @param {boolean} jumpQueued already consumed by the caller
 * @param {number} dt the constant timestep
 * @param {number} [driveScale=1] RULING 6.1 — driveScale attenuates input
 *        authority as the character loses tracking. It scales torque, never
 *        velocity (L1).
 * @param {number} [tick=0] the canonical clock, for the jump cooldown. L6 —
 *        the cooldown is counted in ticks, never in milliseconds.
 * @param {number} [resistanceScale=1] GF-1 Part 4A — multiplies the REQUESTED
 *        braking and rolling-resistance impulses. It does not introduce a
 *        damping mechanism: both impulses still go through the one L3 clamp
 *        below, which caps them at a full cancellation of the spin, so however
 *        large this grows it can only stop the ball sooner and can never
 *        reverse it.
 */
export function updateMotor(motor, input, jumpQueued, dt, driveScale = 1, tick = 0, resistanceScale = 1) {
  const body = motor.body;

  // addForce accumulates until reset, so the fall force from the previous step
  // must not survive into this one.
  body.resetForces(true);
  body.resetTorques(true);

  syncSurfaceTuning(motor);

  // 1 — GROUNDED
  motor.grounded = castGroundFan(body, motor.radius);

  // 2 — DRIVE
  const direction = input.moveWorld;
  const inputMagnitude = Math.hypot(direction.x, direction.z);

  if (inputMagnitude > MIN_INPUT) {
    _axis.crossVectors(WORLD_UP, direction).normalize();

    const angular = body.angvel();
    const alongAxis = angular.x * _axis.x + angular.y * _axis.y + angular.z * _axis.z;

    // THE GOVERNOR NOW HAS TWO CEILINGS. Sprint held gives the full
    // maxAngularSpeed; sprint released gives the spin that rolls at run speed,
    // which for a ball rolling without slipping is simply v / r.
    //
    // The MECHANISM is unchanged and that is the point: the governor STARVES
    // the motor rather than clamping the velocity. Once the spin along the
    // drive axis is already at the ceiling, this step simply adds no torque.
    // Nothing here ever writes a velocity, and releasing sprint at full speed
    // therefore does NOT snap the character back to run speed — the existing
    // rolling resistance decays the surplus over a second or so, which is what
    // a runner easing off actually looks like. That decay is intended, not an
    // omission.
    const effectiveMax = input.sprintHeld
      ? TUNING.motor.maxAngularSpeed
      : TUNING.blend2d.runSpeed / TUNING.motor.radius;

    if (alongAxis < effectiveMax) {
      const control = motor.grounded ? 1 : TUNING.motor.airControlMultiplier;
      const magnitude = TUNING.motor.driveTorque * inputMagnitude * control * driveScale * dt;

      _impulse.x = _axis.x * magnitude;
      _impulse.y = _axis.y * magnitude;
      _impulse.z = _axis.z * magnitude;
      body.applyTorqueImpulse(_impulse, true);
    }
  }

  // 3 — RESISTANCE. Both sites go through the one clamp, and resistanceScale
  // multiplies the REQUESTED impulse on the way in — no second mechanism, no
  // banned setter, and the clamp still bounds the result.
  if (motor.grounded && inputMagnitude <= MIN_INPUT) {
    applyClampedDamping(body, TUNING.motor.brakeTorque * resistanceScale * dt, dt);
  }
  applyClampedDamping(body, TUNING.motor.rollingResistance * resistanceScale * dt, dt);

  // 4 — JUMP, with a cooldown counted in TICKS (L6).
  //
  // jumpQueued has already been consumed by the caller whether or not the jump
  // fires here. That is deliberate: buffering the press until the cooldown
  // expires would make a jump happen at a moment the player did not ask for
  // one, which reads as input lag rather than as a cooldown.
  if (jumpQueued && motor.grounded && tick - motor.lastJumpTick >= TUNING.jump.cooldownTicks) {
    motor.lastJumpTick = tick;
    _impulse.x = 0;
    _impulse.y = TUNING.jump.impulse;
    _impulse.z = 0;
    body.applyImpulse(_impulse, true);
  }

  const linear = body.linvel();
  if (!motor.grounded && linear.y < 0) {
    // Extra downward force so the descent is fast with no float. gravityY is
    // negative, so this product is already downward.
    const extra = (TUNING.jump.fallGravityMultiplier - 1) * TUNING.physics.gravityY * body.mass();
    _impulse.x = 0;
    _impulse.y = extra;
    _impulse.z = 0;
    body.addForce(_impulse, true);
  }
}

/**
 * THE DIVE IMPULSE — the one addition to this file in Task 7.
 *
 * An input-driven force, exactly like the jump above it and legal on the same
 * grounds (LAW L1 bans writing velocity or position during play; applying an
 * impulse is what the motor is for). The two magnitudes are ABSOLUTE impulses
 * in N·s, not accelerations — the same convention as TUNING.jump.impulse, and
 * deliberately not scaled by mass, so that changing the ball's density changes
 * how far a dive carries exactly as it changes how high a jump goes.
 *
 * The caller owns the direction, the cooldown and the crash. This applies one
 * impulse and knows nothing else.
 *
 * @param {ReturnType<typeof createMotor>} motor
 * @param {THREE.Vector3} direction horizontal, already normalised by the caller
 */
export function applyDiveImpulse(motor, direction) {
  _impulse.x = direction.x * TUNING.action.diveImpulseForward;
  _impulse.y = TUNING.action.diveImpulseUp;
  _impulse.z = direction.z * TUNING.action.diveImpulseForward;
  motor.body.applyImpulse(_impulse, true);
}

/**
 * Snapshots the stepped body into the interpolation contract. The loop has
 * already moved curr into prev, so this writes the new curr and nothing else.
 *
 * Rotation is snapshotted as well as translation: without it the debug
 * wireframe cannot show roll, which is the whole reason it exists.
 */
export function syncMotorSnapshot(motor) {
  const translation = motor.body.translation();
  motor.interpolated.currPos.set(translation.x, translation.y, translation.z);

  const rotation = motor.body.rotation();
  motor.interpolated.currQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
}

/** Horizontal speed in m/s, for the HUD. */
export function horizontalSpeed(motor) {
  const linear = motor.body.linvel();
  return Math.hypot(linear.x, linear.z);
}
