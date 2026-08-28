import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { applyClampedLinearDamping, applyClampedAngularDamping } from './damping.js';

/**
 * THE WORLD-SPACE PD TRACKER — and the one blend weight.
 *
 * LAW L2: bodies chase WORLD-SPACE target transforms. There is not a single
 * joint motor, joint-space muscle or local-frame servo anywhere in this file or
 * in this project. Each body is pulled toward where the animation says it should
 * be, in world coordinates, and the joints built in Task 3 are left to sort out
 * the consequences. That is what makes a stumble emerge instead of being
 * authored.
 *
 * LAW L4: ONE BLEND WEIGHT. `weight` below is a single float. 0 is the Task 3
 * ragdoll with every gain at zero; 1 is full tracking. Ragdoll, Impact, Stumble
 * and Tracking are REGIONS of that float, not states — there is no enum, no
 * switch, no mode variable, and nothing in this file branches on a character
 * state. The only branch on weight at all is an early-out at exactly zero, and
 * that is an optimisation: the gains are already zero there, so skipping the
 * loop changes nothing about what the character does.
 *
 * LAW L1: momentum stays with the sphere. Nothing here touches the motor body.
 * Knock the character down at a sprint and the sphere keeps every bit of its
 * speed, because the character was never what was carrying it.
 *
 * LAW L3: every damping impulse goes through damping.js, against RELATIVE
 * velocity. See that file for why.
 *
 * DIRECTORY RULE (src/sim/): nothing here names a wall-clock or scheduler API.
 */

/** Below this the error quaternion has no meaningful axis. */
const MIN_ANGLE = 1e-8;

const _error = new THREE.Vector3();
const _impulseVec = new THREE.Vector3();
const _impulse = { x: 0, y: 0, z: 0 };
const _relVel = new THREE.Vector3();
const _bodyQuatInverse = new THREE.Quaternion();
const _errorQuat = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _bodyQuat = new THREE.Quaternion();
const _preLinvel = new THREE.Vector3();
const _preAngvel = new THREE.Vector3();

export function createTracker() {
  return {
    /**
     * THE float. Seeded from TUNING, moved only by recovery and by the
     * knockdown hook. Everything else in the character's behaviour is a
     * consequence of its value.
     */
    weight: TUNING.tracking.startWeight,
    knockdownQueued: false,
    /** Debug readouts, written here and read by the HUD. Never fed back in. */
    mountDistance: 0,
    warnedMount: false,
    /** Last impact, for the HUD. Tick-stamped so it fades on sim time, not
     *  wall time — a wall-clock timer here would desync the anchored capture. */
    lastImpactKey: '',
    lastImpactExcess: 0,
    lastImpactTick: -1e9,
  };
}

/** The "T" hook. Sets a flag; fixedUpdate consumes it. Nothing else writes
 *  weight except the recovery ramp. */
export function queueKnockdown(tracker) {
  tracker.knockdownQueued = true;
}

/**
 * IMPACTS — the second writer of the one blend weight.
 *
 * LAW L4: this adds a WRITER, not a state. There is no "knocked down" flag and
 * nothing latches; a hit subtracts from the same float the recovery ramp adds
 * to, and everything the character does is a consequence of where that float
 * ends up. A hard hit outruns the ramp and the character goes down; a glancing
 * one does not and it stumbles.
 *
 * LAW L1: nothing here touches the sphere. An impact costs the CHARACTER its
 * balance; the sphere keeps every bit of its momentum.
 *
 * Events arrive already filtered to ragdoll colliders by the caller, with the
 * rig key attached — this function does not know what a collider handle is.
 *
 * @param {object} tracker
 * @param {Array<{key: string, group: string, force: number}>} events
 * @param {number} tick the canonical clock, for the HUD's fade
 * @param {number} dt the constant timestep
 */
export function applyImpacts(tracker, events, tick, dt) {
  if (!events || events.length === 0) return;

  for (const event of events) {
    const excess = Math.max(0, event.force - TUNING.impact.forceThreshold);
    if (excess <= 0) continue;

    const multiplier = TUNING.impact.multiplier[event.group];
    tracker.weight -= excess * TUNING.impact.scale * multiplier * dt;

    if (excess > tracker.lastImpactExcess || tick - tracker.lastImpactTick > TUNING.impact.hudHoldTicks) {
      tracker.lastImpactKey = event.key;
      tracker.lastImpactExcess = excess;
      tracker.lastImpactTick = tick;
    }
  }

  tracker.weight = Math.min(1, Math.max(0, tracker.weight));
}

/**
 * One fixed step of tracking. Applies forces only — the caller steps the world
 * immediately after this returns.
 *
 * @param {object} tracker
 * @param {Map<string, object>} rig the RigMap
 * @param {object} animTarget
 * @param {object} motor READ ONLY, for the mount-distance guard
 * @param {number} dt the constant timestep
 */
export function applyTracking(tracker, rig, animTarget, motor, dt) {
  // Consume the knockdown first, so a press and its effect land on the same
  // tick regardless of when in the frame the key was struck.
  if (tracker.knockdownQueued) {
    tracker.knockdownQueued = false;
    tracker.weight = 0;
  }

  if (rig && animTarget) applyGains(tracker, rig, animTarget, motor, dt);

  // Auto-recovery. A pure ramp: no threshold, no "is the character upright yet"
  // test, no state to leave. The stumble is what the physics does while this
  // number is climbing through the middle of its range.
  tracker.weight = Math.min(1, Math.max(0, tracker.weight + TUNING.tracking.recoverPerSecond * dt));
}

function applyGains(tracker, rig, animTarget, motor, dt) {
  const weight = tracker.weight;

  // Mount guard: how far the pelvis has drifted from the sphere it is riding.
  const pelvis = rig.get('pelvis');
  if (pelvis && motor) {
    const p = pelvis.body.translation();
    const s = motor.body.translation();
    tracker.mountDistance = Math.hypot(p.x - s.x, p.z - s.z);

    if (tracker.mountDistance > TUNING.tracking.maxMountDistance) {
      if (!tracker.warnedMount) {
        tracker.warnedMount = true;
        console.warn(
          `[tracker] pelvis is ${tracker.mountDistance.toFixed(3)} m from the sphere centre ` +
            `(limit ${TUNING.tracking.maxMountDistance}); the character has come off the mount`,
        );
      }
    } else {
      tracker.warnedMount = false;
    }
  }

  // At zero the gains below are all zero. Skipping is an optimisation, not a
  // mode: the character is the Task 3 ragdoll here because nothing is applied,
  // not because a branch decided it should be.
  if (weight <= 0) return;

  // kp scales with weight SQUARED and kd with weight. Squaring the stiffness
  // makes the low end of the range genuinely limp — a linear kp still fights
  // hard at 0.3 and the knockdown reads as sluggish rather than boneless —
  // while the linear kd keeps the damping ratio rising as the character firms
  // up, so the middle of the range settles instead of oscillating.
  const kpScale = Math.pow(weight, TUNING.tracking.limpness);
  const kdScale = weight;

  for (const [key, item] of rig) {
    const target = animTarget.targets.get(key);
    if (!target) continue;

    const body = item.body;
    const mass = body.mass();

    // THE INVERTED PENDULUM. The pelvis is the position servo that carries the
    // body; everything else is along for the ride and is held in place by the
    // joints plus its own much weaker servo. This is a MULTIPLIER on the same
    // path every other body takes — not a separate mechanism, not a special
    // case with its own code. Turn it to 1 and the pelvis is just another body.
    const boost = key === 'pelvis' ? TUNING.tracking.pelvisBoost : 1;

    // BOTH PD TERMS ARE EVALUATED FROM THE SAME PRE-IMPULSE STATE.
    //
    // Rapier's applyImpulse changes the velocity immediately, so reading
    // linvel() after the proportional impulse and damping THAT is not a PD
    // controller — it is a spring followed by a brake that undoes the spring on
    // the same tick. Measured: raising linearKd from 8 to 400 made the tracking
    // error sixty times WORSE, 0.010 m to 0.604 m, because the derivative term
    // was cancelling the proportional term's work before the world ever stepped
    // and gravity was left to win uncontested. Sampling first and applying
    // afterwards is what makes kd behave like damping instead of like a veto.
    const bodyPos = body.translation();
    const linvel = body.linvel();
    const rotation = body.rotation();
    const angvel = body.angvel();

    _preLinvel.set(linvel.x, linvel.y, linvel.z);
    _preAngvel.set(angvel.x, angvel.y, angvel.z);
    _bodyQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);

    // ---- LINEAR ----
    _error.set(
      target.currPos.x - bodyPos.x,
      target.currPos.y - bodyPos.y,
      target.currPos.z - bodyPos.z,
    );

    _impulseVec
      .copy(_error)
      .multiplyScalar(TUNING.tracking.linearKp * boost * kpScale * dt);

    // The cap is on the IMPULSE, in units of the body's own mass, so a heavy
    // torso and a light hand are limited proportionally rather than the cap
    // meaning something different for each.
    const maxLinear = TUNING.tracking.maxLinearImpulse * mass;
    if (_impulseVec.lengthSq() > maxLinear * maxLinear) _impulseVec.setLength(maxLinear);

    _impulse.x = _impulseVec.x;
    _impulse.y = _impulseVec.y;
    _impulse.z = _impulseVec.z;
    body.applyImpulse(_impulse, true);

    // ---- LINEAR DAMPING, against RELATIVE velocity ----
    _relVel.subVectors(_preLinvel, target.vel);
    applyClampedLinearDamping(
      body,
      _relVel.length() * TUNING.tracking.linearKd * boost * kdScale * dt,
      _relVel,
      dt,
    );

    // ---- ANGULAR ----
    _bodyQuatInverse.copy(_bodyQuat).invert();
    _errorQuat.copy(target.currQuat).multiply(_bodyQuatInverse);

    // THE SHORTEST ARC. q and -q are the same rotation, but their axis-angle
    // forms are the short way round and the long way round. Taking the long way
    // means a body a few degrees from its target is told to rotate almost a full
    // turn to get there, at full gain — the classic PD blow-up, and it appears
    // only intermittently, which makes it maddening to chase. Negating when
    // w < 0 picks the short arc every time.
    if (_errorQuat.w < 0) {
      _errorQuat.set(-_errorQuat.x, -_errorQuat.y, -_errorQuat.z, -_errorQuat.w);
    }

    const angle = 2 * Math.acos(Math.min(1, _errorQuat.w));
    if (angle > MIN_ANGLE) {
      const sin = Math.sqrt(Math.max(0, 1 - _errorQuat.w * _errorQuat.w));
      _axis.set(_errorQuat.x, _errorQuat.y, _errorQuat.z).divideScalar(sin);

      _impulseVec
        .copy(_axis)
        .multiplyScalar(angle * TUNING.tracking.angularKp * kpScale * dt);

      const maxAngular = TUNING.tracking.maxAngularImpulse;
      if (_impulseVec.lengthSq() > maxAngular * maxAngular) _impulseVec.setLength(maxAngular);

      _impulse.x = _impulseVec.x;
      _impulse.y = _impulseVec.y;
      _impulse.z = _impulseVec.z;
      body.applyTorqueImpulse(_impulse, true);
    }

    // ---- ANGULAR DAMPING, against RELATIVE angular velocity ----
    _relVel.subVectors(_preAngvel, target.angvel);
    applyClampedAngularDamping(
      body,
      _relVel.length() * TUNING.tracking.angularKd * kdScale * dt,
      _relVel,
      dt,
    );
  }
}
