import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { applyClampedLinearDamping, applyClampedAngularDamping } from './damping.js';
import { ARM_CHAIN_DAMPED, LEG_BODIES } from './autorig.js';

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
    /** Damping authority the queued knockdown retains. See queueKnockdown. */
    knockdownTone: 0,
    /** Live floor under the damping term while down. Never scales the springs. */
    muscleTone: 0,
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

/**
 * The knockdown hook. Sets a flag; fixedUpdate consumes it. Nothing else writes
 * weight except the recovery ramp and the impact drain.
 *
 * MUSCLE TONE, and why it is a SECOND number rather than a floor on the first.
 *
 * The ask was: a dive crash should hand the body to the physics without it
 * exploding — "retain stiffness until ready for the knockdown recovery". The
 * obvious implementation is to drop the weight to 0.25 instead of 0. That was
 * measured and it does not work, for a structural reason:
 *
 *     crash floor | minPelvisY | peak standUpNeed | reads as
 *        0.00     |    0.131   |      0.853       | FULL COLLAPSE
 *        0.10     |    0.585   |      0.368       | heavy stumble
 *        0.25     |    0.857   |      0.087       | barely a wobble
 *
 * At 0.25 the character does not go down AT ALL, so the crash stops feeding the
 * knockdown chain — no stand-up, nothing for the mount follower to do. The
 * cause is that `weight` scales BOTH gains below: the springs by
 * weight^limpness and the damping linearly. The damping is exactly what stops
 * the limbs flailing apart, and it is also what holds the body off the floor.
 * One number cannot ask for one without the other.
 *
 * So the crash sets TWO things. `weight` goes to 0 — springs fully off, the
 * character genuinely falls. `muscleTone` is a floor under the DAMPING term
 * only, so the limbs keep a quarter of their resistance and arrive as a body
 * rather than as a shower of parts. Tone without control, which is what was
 * actually asked for and what a weight floor cannot express.
 *
 * min(), not assignment, on the weight: a knockdown must never RAISE it, or a
 * hit landing on an already-downed character would help it up.
 *
 * @param {object} tracker
 * @param {number} [tone=0] damping authority to retain while down, 0..1
 */
export function queueKnockdown(tracker, tone = 0) {
  // Two knockdowns queued before the next step is consumed — a dive crash and
  // an impact on the same tick — take the HARSHER of the two, which for tone
  // means the LIMPER. Reading the previous value only while a queue is already
  // pending is what keeps a stale one from a consumed knockdown out of the next.
  tracker.knockdownTone = tracker.knockdownQueued
    ? Math.min(tracker.knockdownTone, tone)
    : tone;
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
/**
 * ═══ SOLVER-SIDE DAMPING ON THE ARM CHAIN — THE ONE EXCEPTION TO LAW L3 ═══
 *
 * THE EXCEPTION IS THIS FUNCTION AND NOTHING ELSE: one function, two sites (the
 * arm chain, and the dive's leg parachute below it), four setter calls. IT MAY
 * NOT GROW BY A LINE. Anything else in the project that wants resistance goes
 * through the clamped helpers in damping.js.
 *
 * WHAT THE JITTER IS NOT. Every PD lever was measured against it and none of
 * them move it. With the animation FROZEN so the target velocity is exactly
 * zero, the hands still travel 0.094 m/s; dropping the extremity stiffness to
 * 0.1 leaves it at 0.094; turning the hand's spring fully OFF leaves it at
 * 0.094; turning EVERY spring in the ragdoll off leaves it at 0.094. Solver
 * iterations 16 -> 128 leave it at 0.094, and CCD off leaves it at 0.101. The
 * tracker is not causing this and cannot cure it: it is the arm hanging on its
 * joints, and the solver never quite settling the chain.
 *
 * WHY RAPIER'S OWN DAMPING AND NOT THE CLAMPED HELPERS. The helpers run before
 * world.step and damp the pre-step velocity relative to the target, so they
 * cannot touch what the solver injects during the step — raising their gains
 * fourfold moved the number under 3%. Rapier's damping is applied by the solver
 * itself, each substep, against absolute velocity. It is the only thing in the
 * box that reaches it. (And it does not crash this build; that claim in
 * physics.js was stale and is corrected there.)
 *
 * WHY IT IS SPEED-GATED. Damping cannot tell the buzz from the arm swing, so a
 * constant value buys a quieter idle by flattening the run:
 *
 *     constant   idle hands       walking arm swing
 *     none       0.098 / 0.123    1.01 / 1.02
 *     8 / 15     0.089 / 0.108    0.89 / 0.89
 *     25 / 40    0.070 / 0.088    0.70 / 0.71
 *
 * But the buzz is an IDLE complaint and the cost is a WALKING one, and those
 * never happen at the same time. Fading it out pays the cost only where there
 * is nothing to spend it on, which is what lets the value at rest be nearly
 * twenty times what a constant could afford:
 *
 *     gated 150   idle hands 0.029 / 0.035   walking arm swing 1.01 / 1.01
 *
 * That is 71% of the buzz gone with the run measurably untouched. The hands now
 * move slightly LESS than the idle clip asks (0.036 / 0.066) rather than more,
 * which is the right side of the trade for a complaint about standing still.
 *
 * @param {Map<string, object>} rig
 * @param {object} motor READ ONLY
 * @param {object} animTarget READ ONLY, for standUpNeed
 */
function applyArmDamping(rig, motor, animTarget) {
  const fade = Math.max(1e-3, TUNING.ragdoll.armDampingFadeSpeed);
  const v = motor.body.linvel();
  // Two ways to not be standing still: moving, or on the floor. A downed
  // athlete's arms should flop, and a get-up is a slow move the speed gate
  // would not catch, so the recovery signal takes the damping off as well.
  const moving = Math.min(1, Math.hypot(v.x, v.z) / fade);
  const down = animTarget ? animTarget.standUpNeed : 0;
  const still = (1 - moving) * (1 - down);

  for (const key of ARM_CHAIN_DAMPED) {
    const item = rig.get(key);
    if (!item) continue;
    item.body.setLinearDamping(TUNING.ragdoll.armLinearDamping * still);
    item.body.setAngularDamping(TUNING.ragdoll.armAngularDamping * still);
  }

  // THE DIVE'S LEG PARACHUTE. Same mechanism, different reason: the legs are
  // nearly boneless through a dive and would otherwise arrive at the floor with
  // every bit of the forward momentum they left with. Faded by diveMix so it is
  // present for exactly as long as the pose is, and zero at every other moment
  // — a damped leg during a run is a leg that does not swing.
  const dive = animTarget ? animTarget.diveMix : 0;
  for (const key of LEG_BODIES) {
    const item = rig.get(key);
    if (!item) continue;
    item.body.setLinearDamping(TUNING.ragdoll.diveLegLinearDamping * dive);
    item.body.setAngularDamping(TUNING.ragdoll.diveLegAngularDamping * dive);
  }
}

export function applyTracking(tracker, rig, animTarget, motor, dt, tumbling = false) {
  // Consume the knockdown first, so a press and its effect land on the same
  // tick regardless of when in the frame the key was struck.
  if (tracker.knockdownQueued) {
    tracker.knockdownQueued = false;
    // THE TONE IS THE FLOOR THE WEIGHT LANDS ON, not just the damping floor it
    // has always been. A dive that hits the floor should go LOOSE, not boneless
    // — the limbs tumble but the athlete is still faintly holding himself —
    // and that is the difference between weight 0 and weight 0.2. Every other
    // knockdown passes tone 0 and therefore lands on 0 exactly as before, so
    // the T key, the slide penalty and impact-driven falls are untouched.
    tracker.weight = tracker.knockdownTone;
    tracker.muscleTone = tracker.knockdownTone;
  }

  if (rig && motor) applyArmDamping(rig, motor, animTarget);
  if (rig && animTarget) applyGains(tracker, rig, animTarget, motor, dt);

  // Auto-recovery. A pure ramp: no threshold, no "is the character upright yet"
  // test, no state to leave. The stumble is what the physics does while this
  // number is climbing through the middle of its range.
  if (!tumbling) {
    tracker.weight = Math.min(1, Math.max(0, tracker.weight + TUNING.tracking.recoverPerSecond * dt));
  }
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
  // THE STAND-UP'S OWN AUTHORITY, floored into the stiffness.
  //
  // weight^5 is what makes a knockdown read as boneless, and it does that job.
  // But the get-up happens ENTIRELY inside the range where weight^5 is nothing:
  // traced tick by tick through a plain knockdown, kpScale was 0.0000 for the
  // first sixty ticks, 0.0024 at tick 60 and still only 0.10 at tick 126 — so
  // for the first two seconds the stand-up take played on the ghost with a
  // target pelvis 0.28 m above the body and no authority whatsoever to close
  // the gap. The athlete lay there and then popped upright at the end when the
  // springs finally arrived. That is "the stand-up animations are not playing",
  // and it is not fixable in animtarget.js: the scrub and the blend share were
  // already correct, measured, and had nothing to act through.
  //
  // Getting up is muscular effort, so the effort gets stiffness. need x
  // progress is zero standing (need 0), zero the instant he goes down (progress
  // rewinds to 0), and largest through the middle of the take — which is
  // exactly the window that had none. It is the same idea as muscleTone one
  // line down, applied to the spring instead of the damper.
  const standEffort = animTarget.standUpNeed * animTarget.standUpProgress;
  const kpScale = Math.max(
    Math.pow(weight, TUNING.tracking.limpness),
    standEffort * TUNING.standUp.authority,
  );
  // MUSCLE TONE floors the DAMPING and nothing else. Once the weight recovers
  // past the tone this is just `weight` again, so it needs no decay of its own
  // — it stops mattering the moment the character is stiffer than the floor.
  const kdScale = Math.max(weight, tracker.muscleTone);

  for (const [key, item] of rig) {
    const target = animTarget.targets.get(key);
    if (!target) continue;

    const body = item.body;
    const mass = body.mass();

    // PER-GROUP STIFFNESS, AND IT ONLY APPLIES WHILE HE IS LIMP.
    //
    // One multiplier on both PD terms, so a softer group is also a less damped
    // one — a limb that is loose but heavily damped moves like it is
    // underwater. A missing group reads as 1, so a new BONE_MAP entry behaves
    // exactly as it did before this existed rather than silently going limp.
    //
    // The multiplier is LERPED TO 1 BY WEIGHT. At weight 1 every group is
    // exactly 1.0 and nothing is softened at all, which is what a controlled
    // slide needs: the athlete is holding a rigid pose on purpose and his legs
    // should not be floppy while he does it. The softening is for a CRASH, and
    // a crash is exactly the case where weight is low. At the dive's landing
    // weight of 0.2 that leaves torso 1.0 against extremity 0.28 — a 3.6:1
    // spread, which is the differential this exists for.
    const group = TUNING.tracking.groupStiffness[item.group];
    let groupScale = group === undefined ? 1 : group + (1 - group) * weight;

    // THE DIVE'S DEAD LEGS. Six named bodies, not a group — `limb` and
    // `extremity` also hold the arms and hands, and the superman pose is held
    // BY the arms. Faded by diveMix so the legs let go over the same frames the
    // pose arrives, and restored the same way when it lets go.
    if (LEG_BODIES.has(key) && animTarget.diveMix > 0) {
      const dead = TUNING.action.diveLegStiffness;
      groupScale = groupScale + (dead - groupScale) * animTarget.diveMix;
    }

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

    // THE SPRING IS SCALED BY MASS, and that `* mass` is the jitter fix.
    //
    // Without it the same position error produced the same IMPULSE on every
    // body — so the same error moved a 0.762 kg hand fifteen times as fast as
    // the 11.451 kg pelvis. The heavy bodies were tracking; the light ones were
    // being flicked back and forth across their targets every step, which is
    // the buzz on the hands and feet. Scaling by mass makes the gain an
    // ACCELERATION, identical for every body, which is what a PD controller on
    // a multibody rig is supposed to be — and note the clamp below was already
    // mass-proportional, so the cap had the right instinct and the gain did
    // not.
    //
    // linearKp is re-seeded to 700 to keep the pelvis exactly where it was:
    // 700 * 11.451 = 8016, against the old flat 8000.
    _impulseVec
      .copy(_error)
      .multiplyScalar(TUNING.tracking.linearKp * mass * boost * kpScale * groupScale * dt);

    // The cap is on the IMPULSE, in units of the body's own mass, so a heavy
    // torso and a light hand are limited proportionally rather than the cap
    // meaning something different for each.
    // AND THE PELVIS GETS MORE OF IT WHILE SLIDING. A fast slide drags the
    // whole body along the floor; the cap binds before the pelvis servo can
    // hold station, and the body falls behind the sphere it is mounted on.
    // Pelvis only, slide only — nothing else's cap moves.
    const isSlidingPelvis = key === 'pelvis' && animTarget.slideMix > 0;
    const clampBoost = isSlidingPelvis ? (TUNING.action.slidePelvisClampBoost || 3.0) : 1.0;
    const maxLinear = TUNING.tracking.maxLinearImpulse * clampBoost * mass;
    if (_impulseVec.lengthSq() > maxLinear * maxLinear) _impulseVec.setLength(maxLinear);

    _impulse.x = _impulseVec.x;
    _impulse.y = _impulseVec.y;
    _impulse.z = _impulseVec.z;
    body.applyImpulse(_impulse, true);

    // ---- LINEAR DAMPING, against RELATIVE velocity ----
    _relVel.subVectors(_preLinvel, target.vel);
    applyClampedLinearDamping(
      body,
      _relVel.length() * TUNING.tracking.linearKd * boost * kdScale * groupScale * dt,
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

    const isFoot = key === 'footL' || key === 'footR';
    const angularKp = isFoot
      ? (TUNING.tracking.footAngularKp ?? 1500)
      : TUNING.tracking.angularKp;
    const angularKd = isFoot
      ? (TUNING.tracking.footAngularKd ?? 150)
      : TUNING.tracking.angularKd;
    const maxAngular = isFoot
      ? (TUNING.tracking.footMaxAngularImpulse ?? 0.35)
      : TUNING.tracking.maxAngularImpulse;

    const angle = 2 * Math.acos(Math.min(1, _errorQuat.w));
    if (angle > MIN_ANGLE) {
      const sin = Math.sqrt(Math.max(0, 1 - _errorQuat.w * _errorQuat.w));
      _axis.set(_errorQuat.x, _errorQuat.y, _errorQuat.z).divideScalar(sin);

      // Non-linear ligament stiffness ramp if foot begins to invert past natural range (~15-20 deg)
      const stiffnessMult = isFoot && angle > 0.25
        ? 1.0 + Math.pow((angle - 0.25) / 0.20, 2) * 5.0
        : 1.0;

      _impulseVec
        .copy(_axis)
        .multiplyScalar(angle * angularKp * stiffnessMult * kpScale * groupScale * dt);

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
      _relVel.length() * angularKd * kdScale * groupScale * dt,
      _relVel,
      dt,
    );
  }
}
