import * as THREE from 'three';

import { TUNING } from '../config/tuning.js';
import { applyDiveImpulse, horizontalSpeed } from '../sim/motor.js';
import { queueKnockdown } from '../sim/tracker.js';

/**
 * THE ACTION STATES — the slide and the dive.
 *
 * Lifted out of `fixedUpdate` whole in G3.5. Not a threshold, not a tunable and
 * not an order changed: the three blocks this file is made of ran in exactly
 * this sequence inside `fixedUpdate`, and they run in exactly this sequence
 * here. The comments came with them, at full length, because the reasoning in
 * them is the record of four mechanics that were built wrong first — the slide
 * timer that knocked down every fast slide, the dive that went limp on liftoff,
 * the linear dive ramp that landed the pose a third of the way through the
 * flight, and the `tracker.weight > 0.5` early-out that ended every dive before
 * it touched the floor.
 *
 * WHAT MOVED, AND WHAT IT COST. Three fragments of `fixedUpdate` that were
 * separated by a hundred lines of unrelated work are adjacent now:
 *
 *   1. the slide and dive mechanics themselves;
 *   2. the commitment flag and the skid resistance, which `updateMotor` takes;
 *   3. the ratchets that scrub the slide and dive clips.
 *
 * Between (1) and (2) `fixedUpdate` saved the ragdoll's previous transforms,
 * computed the drive and drag scales, ran the grounded debounce and applied the
 * limp brake. None of those touch the motor body, the slide clock or the dive
 * latch, so reading `motor.body.linvel().y` here rather than there is the same
 * read of the same number — and the determinism gate for this step is what
 * says so, not this comment.
 *
 * LAW 4 (GF-2.0) — THERE IS NO ACTION STATE MACHINE HERE. `slideTime` is a tick
 * count, `divePending` is a latch the cooldown bounds, `lastDiveTick` and
 * `diveStunUntil` are recorded ticks of exactly the same class as
 * `motor.lastJumpTick`. Nothing branches on "which phase of a slide are we in";
 * the phases are floats that ratchet.
 *
 * LAW 3 — NOTHING HERE DAMPS ANYTHING. The slide's braking is a MULTIPLIER on
 * the impulses `updateMotor` already applies through the clamped helpers. This
 * file names no Rapier damping setter, and it names none in a comment either,
 * so a grep hit in `mechanics/` means a violation rather than a mention.
 *
 * THE DIRECTORY RULE APPLIES HERE TOO (src/mechanics/): nothing in this file
 * names a wall clock or a scheduler. The clock is `tick`.
 */

/**
 * How far the stick has to be pushed for the dive to take its heading from the
 * stick rather than from the camera. A code constant, not a feel number: below
 * this the stick is not pointing anywhere.
 */
const DIVE_INPUT_DEADZONE = 0.3;

/**
 * THE TWO ACTIONS, as mechanics accumulators and latches (RULING GF-2.0).
 *
 * None of these is a character state and nothing branches on "which action are
 * we in": they are a tick counter, a latch and a recorded tick, of exactly the
 * same class as jumpQueued and motor.lastJumpTick. Both actions resolve into
 * the ONE blend weight through queueKnockdown — there is no second way to be
 * knocked down and no separate recovery path for either.
 */

/**
 * The action clocks and latches for ONE athlete.
 *
 * Created at boot and held by the caller — never a module-level singleton,
 * because G5 instantiates N athletes and a shared slide clock would mean two
 * players sliding on one timer.
 *
 * @returns {object}
 */
export function createActionState() {
  return {
    /** Ticks since the current slide began; 0 means no slide is running. */
    slideTime: 0,
    /**
     * THE RE-ENTRY LOCKOUT. Latched when a slide ends while the trigger is STILL
     * DOWN; cleared only when the trigger comes up.
     *
     * IT DESCRIBES THE BUTTON, NOT THE ATHLETE, and that is what keeps it on the
     * right side of LAW 4. It is the same class of thing as `padJumpWasDown` in
     * input.js and `prevGrounded` two lines below: an edge-tracker for a signal
     * that has no edges of its own once it is held. Nothing branches on it to
     * decide what the character is doing — it only answers "has this press
     * already been spent".
     *
     * WITHOUT IT the cancel does not hold. `startingSlide` is evaluated every
     * step, so a cancelled slide re-enters on the very next tick while the
     * trigger is down and the athlete is still above minSlideSpeed — which was
     * measured, not guessed: the first version of the jump-cancel only appeared
     * to work because 34 ticks of slide resistance had already dropped him under
     * the 4.0 m/s gate before the jump landed.
     */
    slideNeedsRelease: false,
    /** True between a dive firing and its crash. Consumed by the grounded edge. */
    divePending: false,
    /** Ticks of the last dive, for the cooldown. -Infinity means "never". */
    lastDiveTick: -Infinity,
    /** Tick the dive's stun expires on. The recovery ramp is held off until then. */
    diveStunUntil: -Infinity,
    /** For the dive's crash: grounded on the previous step. Mechanics edge. */
    prevGrounded: true,
    /** Scratch for the dive direction. */
    diveDir: new THREE.Vector3(),
  };
}

/**
 * One step of both action states.
 *
 * @param {object} args
 * @param {ReturnType<typeof createActionState>} args.state
 * @param {object} args.motor
 * @param {object} args.input the latched input snapshot
 * @param {object} args.tracker knocked down through queueKnockdown, never read for state
 * @param {object|null} args.ragdoll READ for the pelvis's own speed
 * @param {object|null} args.ghost the anim target; READ for the four accumulators, never written
 * @param {boolean} args.diveQueued the consumed dive press, consumed by the caller
 * @param {boolean} args.jumpQueued the consumed jump press — READ ONLY here, and
 *   passed on unchanged to updateMotor, which is what actually fires the jump
 * @param {number} args.tick
 * @param {number} args.dt
 * @returns {object} what fixedUpdate hands on: the two scales updateMotor takes,
 *   the stun flag the recovery ramp reads, and the four ghost inputs
 */
export function runActions({
  state, motor, input, tracker, ragdoll, ghost, diveQueued, jumpQueued, tick, dt,
}) {
  // Raised by the launch edge, consumed by the dive ratchet at the bottom. A
  // local, so it cannot survive the step — which is what the `if (animTarget)`
  // guard on the old inline poke amounted to.
  let divePhaseRestart = false;

  // The four ghost accumulators, or null when there is no ghost to advance —
  // which is only the handful of ticks between boot and the first spawn.
  let slideMix = null;
  let diveMix = null;
  let slidePhase = null;
  let divePhase = null;

  // ═══ THE SLIDE ═══
  //
  // No motor code at all: the slide is expressed entirely through the two scale
  // parameters updateMotor already takes. driveScale 0 kills steering, and
  // slideResistance MULTIPLIES the existing braking path, so the sphere coasts
  // and bleeds speed through the same L3-clamped helper as every other braking
  // impulse. Nothing new damps anything.
  const speedNow = horizontalSpeed(motor);

  // ═══ THE JUMP AGAINST THE TWO COMMITMENTS ═══
  //
  // A jump does not compose with a slide or a dive; it RESOLVES against them,
  // and which way it resolves is different for each:
  //
  //   sliding  — the slide ends and the jump is SWALLOWED. He comes back up onto
  //              his feet carrying the speed the slide built, and does not leave
  //              the ground. The slide's exit is the point, not a launch.
  //   diving   — the jump does nothing at all. A dive is a committed arc and a
  //              belly skid is its price; being able to hop out of either would
  //              make the commitment free.
  //   neither  — untouched. `allowJump` is `jumpQueued`, and `updateMotor` sees
  //              exactly what it always saw.
  //
  // NOTHING WRITES VELOCITY HERE (LAW 1). "Returns to his feet carrying the
  // momentum" is not something this has to perform — the sphere already holds
  // the speed, and ending the slide is what stops slideResistance multiplying
  // the braking and hands driveScale back. The mechanic is the removal of two
  // multipliers, not an impulse.
  //
  // `allowJump` IS NOT A STATE (LAW 4). It is a local computed from a press and
  // two clocks, consumed by `updateMotor` on the same tick and gone. Nothing
  // stores it, nothing branches on it a step later.
  // THE LOCKOUT CLEARS ON RELEASE AND NOWHERE ELSE. First, so a release and a
  // press on the same tick — which a gamepad cannot produce but a keyboard
  // repeat can — resolves as a release.
  if (!input.slideHeld) state.slideNeedsRelease = false;

  let allowJump = jumpQueued;
  if (jumpQueued) {
    if (state.slideTime > 0) {
      state.slideTime = 0;              // cancel the slide back onto his feet
      state.slideNeedsRelease = true;   // and it stays cancelled until he lets go
      allowJump = false;                // swallow the jump — he does not launch
    } else if (state.divePending) {
      allowJump = false;                // no jumping out of a dive or its skid
    }
  }

  // A SLIDE IS A PRESS, NOT A HELD STATE. `slideNeedsRelease` is what makes that
  // true: every way a slide can end while the trigger is down sets it, and only
  // lifting the trigger clears it, so one pull of the trigger buys exactly one
  // slide. `!jumpQueued` is gone from this test because it was doing the
  // lockout's job for exactly one tick and doing it badly.
  const startingSlide =
    state.slideTime === 0 &&
    !state.slideNeedsRelease &&
    input.slideHeld &&
    motor.grounded &&
    speedNow > TUNING.action.minSlideSpeed;

  if (startingSlide) state.slideTime = 1;
  else if (state.slideTime > 0) state.slideTime += 1;

  if (state.slideTime > 0) {
    // COMMITTED BRIEFLY. For minSlideTicks the slide runs whether or not the
    // button is still down, so a tap is a real slide instead of a flicker.
    const committed = state.slideTime <= TUNING.action.minSlideTicks;

    // TWO WAYS OUT, AND NO TIMER. There used to be a third — slideTime past
    // maxSlideTicks called queueKnockdown — and it was the dominant one: 45
    // ticks is 0.75 s, which a slide entered at 5 m/s never survives, so every
    // fast slide ended on the floor and (with the button still held) rolled
    // straight into a second slide that was knocked down as well. Traced at
    // 5.38 m/s with weight dropping 1.00 -> 0.01 on the cutoff tick.
    //
    // A slide is now ended by the player letting go, or by running out of
    // momentum. Neither costs weight. How LONG a slide lasts is decided by
    // slideResistance bleeding speed down to stopSpeed — a physical answer to
    // a physical question, and a slider if it wants shortening.
    if (!committed && !input.slideHeld) {
      // Released after the commitment window: control returns, weight intact.
      state.slideTime = 0;
    } else if (input.slideHeld && speedNow < TUNING.action.knockdownSpeed) {
      // RODE IT INTO THE GROUND. Still holding the button with the momentum
      // spent: the commitment is what is being paid for, so this resolves into
      // the ordinary knockdown chain — same weight, same drag, same stand-up.
      //
      // NOT the old maxSlideTicks timer wearing a new hat. That fired on a
      // clock and cut a 5 m/s slide off mid-flight; this fires on the athlete
      // having nothing left, which is a thing the player can see coming and
      // avoid by letting go. Releasing above knockdownSpeed always costs
      // nothing, at any point past minSlideTicks.
      state.slideTime = 0;
      state.slideNeedsRelease = true;
      queueKnockdown(tracker);
    } else if (speedNow < TUNING.action.stopSpeed) {
      // SLID TO A STOP WITH THE BUTTON ALREADY RELEASED (inside the commitment
      // window, or the frame after a release). Ends the slide and nothing else.
      //
      // THE LOCKOUT IS SET HERE TOO, and it costs nothing when the trigger is
      // already up: the release clause at the top of this function clears it on
      // the same tick it would be read. It matters only for the case the comment
      // above calls "inside the commitment window" — trigger still down, speed
      // spent — where without it the athlete would chatter into a new slide the
      // instant he crept back over minSlideSpeed.
      state.slideTime = 0;
      state.slideNeedsRelease = true;
    }
  }
  const sliding = state.slideTime > 0;

  // ═══ THE DIVE ═══
  // JUMP-DIVE PROHIBITION: A dive cannot fire if a jump is queued on the same tick,
  // or if the athlete has recently jumped and is still in the liftoff window (~0.4s / 25 ticks).
  // Likewise, if a dive fires, any jump on this tick is immediately swallowed.
  const jumpLockout = (tick - motor.lastJumpTick) < 25;
  if (diveQueued && motor.grounded && !jumpQueued && !jumpLockout && tick - state.lastDiveTick >= TUNING.action.diveCooldownTicks) {
    allowJump = false;
    const magnitude = Math.hypot(input.moveWorld.x, input.moveWorld.z);
    if (magnitude > DIVE_INPUT_DEADZONE) {
      state.diveDir.set(input.moveWorld.x / magnitude, 0, input.moveWorld.z / magnitude);
    } else {
      // NO STICK: DIVE WHERE HE IS LOOKING, not where the camera is. Under the
      // chase camera the two agree, so this changes nothing there. Under a
      // sideline shot the camera's heading points across the court, and a
      // standing dive threw the athlete at the stands. The ghost's yaw is the
      // direction his body is actually pointing, which is the only reading that
      // is right under every camera.
      const defaultYaw = ghost ? ghost.yaw : input.cameraYaw;
      state.diveDir.set(Math.sin(defaultYaw), 0, Math.cos(defaultYaw));
    }
    applyDiveImpulse(motor, state.diveDir);

    // THE DIVE NO LONGER GOES LIMP ON LIFTOFF, and nothing writes velocity into
    // the sixteen ragdoll bodies any more.
    //
    // Both of those were the same idea — hand the body to the physics and let
    // it fly — and the idea was wrong twice over. At weight 0 the athlete has
    // no pose to hold, so the superman collapsed into a ball the moment he left
    // the ground and the whole point of having a dive clip was lost; and with
    // the tracker off, the only way to make the body follow the sphere was to
    // push each limb by hand, which is the motor's job done sixteen times in a
    // place the laws do not cover.
    //
    // Weight stays where it is. The tracker carries the whole athlete along the
    // mount, rigid, in the pose the ghost is holding — the dive is a POSE the
    // player commits to, not a loss of control — and he stays that way through
    // the flight and the skid. The collapse still happens; it happens at the
    // END, where the momentum runs out, and that is the only place it happens.
    state.divePending = true;
    state.lastDiveTick = tick;
    // The one place the dive scrub is re-seeded, on the edge that starts one —
    // the same treatment startingSlide gives slidePhase.
    // THE DIVE PHASE IS RE-SEEDED HERE and advanced below, which used to be a
    // poke into the ghost from a hundred and eighty lines above the ratchet
    // that reads it. Same tick, same value, one function.
    divePhaseRestart = true;
    const _lv = motor.body.linvel();
    console.log(
      `[dive] launched at tick ${tick} — sphere ${speedNow.toFixed(2)} m/s horizontal, ` +
        `vy ${_lv.y.toFixed(2)} m/s after the impulse (mass ${motor.body.mass().toFixed(3)} kg)`,
    );
  }

  // THE GROUNDED DIVE IS A SLIDE. Same shape, same exit, one number apart.
  //
  // Once he is back on the floor with the dive latch still up, the momentum is
  // the mechanic: driveScale is dead, the slide's resistance bleeds the speed,
  // and the ghost holds the dive pose while it happens. Riding it down to
  // knockdownSpeed is what finally puts him on the floor — the same condition
  // as the held slide, the same tunable, and the muscle tone the crash was
  // always meant to land with.
  //
  // THE GATE READS THE ATHLETE, NOT THE SPHERE, and it has to. In a slide the
  // two are one number; in a dive he is prone and extended ahead of the mount,
  // the tracker's linear impulse is clamped, and the sphere is being braked by
  // rollingResistance AND (stick neutral, mid-dive) brakeTorque while the body
  // is braked only by its own colliders on the floor. Measured: sphere 10.7
  // m/s^2 against pelvis 7.1, and reading the sphere collapsed him at 3.9 m/s —
  // a limp tumble in the middle of a skid that was still going. Reading the
  // pelvis is the same class of query as motor.grounded: sim state, read never
  // written, and it is the number the sentence "he ran out of momentum" is
  // actually about.
  const diveSkidding = state.divePending && motor.grounded;
  const divePelvis = ragdoll && ragdoll.rig.get('pelvis');
  let athleteSpeed = speedNow;
  if (divePelvis) {
    const v = divePelvis.body.linvel();
    athleteSpeed = Math.hypot(v.x, v.z);
  }

  // THE LANDING IS THE EDGE, and it is the only place the dive costs weight.
  //
  // Rigid all the way down — that is what holds the superman against gravity —
  // and loose the instant he touches, which is what lets him tumble instead of
  // skidding like a board. crashMuscleTone is now the weight he lands ON rather
  // than a damping floor over zero, so "loose" and "boneless" are different
  // states of the same number and the dive gets the first one.
  if (state.divePending && motor.grounded && !state.prevGrounded &&
      tick - state.lastDiveTick >= TUNING.action.diveLatchMinTicks) {
    queueKnockdown(tracker, TUNING.action.crashMuscleTone);
    // THE STUN STARTS HERE, on the same edge and nowhere else. A recorded tick,
    // of exactly the same class as lastDiveTick and motor.lastJumpTick — not a
    // state, and nothing branches on "are we stunned", it only gates the ramp.
    state.diveStunUntil = tick + TUNING.action.diveStunTicks;
  }

  // And the pose lets go once the momentum is spent. NO second knockdown here:
  // he is already down. This only hands the tier back to the stand-up.
  if (diveSkidding && tick - state.lastDiveTick >= TUNING.action.diveLatchMinTicks &&
      athleteSpeed < TUNING.action.knockdownSpeed) {
    state.divePending = false;
  }

  // THE COOLDOWN IS THE ONLY OTHER WAY OUT, and it is a backstop rather than a
  // mechanic: a dive that somehow never reaches the floor — off the bowl rim,
  // wedged, launched at the sky — must not hold the pose forever.
  //
  // The `tracker.weight > 0.5` early-out that used to sit here is GONE. It read
  // "he is back on his feet, the dive is over", which was true while the dive
  // began with a knockdown; now that weight stays high through the whole dive
  // it would fire on the first tick past diveLatchMinTicks and end every dive
  // before it landed. The skid's own speed test replaces it.
  if (state.divePending && tick - state.lastDiveTick >= TUNING.action.diveCooldownTicks) {
    state.divePending = false;
  }
  state.prevGrounded = motor.grounded;

  // STEERING IS DEAD THROUGH BOTH ACTIONS. A slide and a dive are commitments:
  // once either is running the stick stops turning the athlete, which is what
  // makes committing to one a decision rather than a free extra move.
  //
  // THE BRAKING IS GROUNDED-ONLY, and the difference matters. The slide's
  // resistance MULTIPLIES the knockdown drag rather than replacing it, so a
  // slide that ends in a knockdown gets both. Applying it to a dive still in
  // the air would bleed the leap itself — the flight is the mechanic — so the
  // dive only picks it up once it is back on the floor, where it is a skid and
  // wants exactly the slide's braking.
  const actionCommitted = sliding || state.divePending;
  // SLOPE-AWARE SLIDE DRAG. See the note at slideSlopeRef: the drag is a near
  // constant deceleration, so whether a slope carries the athlete is decided by
  // one comparison, and thinning it while he descends is what lets gravity win
  // there without lengthening the slide on the flat. vy is the sphere's own
  // vertical velocity — sim state, read never written.
  const _slideVy = motor.body.linvel().y;
  const slopeFactor = Math.min(
    TUNING.action.slideSlopeMax,
    Math.max(
      TUNING.action.slideSlopeMin,
      1 + _slideVy / Math.max(1e-3, TUNING.action.slideSlopeRef),
    ),
  );
  const actionResistance = sliding
    ? TUNING.action.slideResistance * slopeFactor
    : diveSkidding
      ? TUNING.action.diveResistance
      : 1;

  // The two action poses, eased at one rate. main.js owns the mechanics; the
  // ghost owns only how much of the pose each one is.
  if (ghost) {
    const ease = 1 - Math.exp(-TUNING.action.poseEase * dt);
    // READ from the ghost, advanced here, handed BACK through ghostInputs. The
    // accumulators still live on the ghost — which is what makes a respawn
    // reset them, since createAnimTarget builds a fresh state with all four at
    // zero. Moving them onto the action state would have quietly kept a slide
    // phase alive across a respawn, and that is a behaviour change.
    slideMix = ghost.slideMix;
    diveMix = ghost.diveMix;
    slidePhase = ghost.slidePhase;
    divePhase = ghost.divePhase;
    slideMix += ((sliding ? 1 : 0) - slideMix) * ease;
    diveMix += ((state.divePending ? 1 : 0) - diveMix) * ease;
    // Phases for real action clips, from the same tick accumulators. A fallback
    // node ignores these and holds the apex pose instead.
    // THE SLIDE PHASE IS A RATCHET WITH A HOLD POINT, not a fraction of a
    // timer — the timer is gone, and a clip scrubbed 0..1 stood the athlete
    // back up while the button was still down. It climbs to slideHoldPhase and
    // stays there for as long as the slide runs; once the slide ends it climbs
    // on to 1 so the take's own recovery plays out under the crossfade.
    //
    // Monotone, and it resets to 0 only where every other one-shot does: at
    // the start of the next slide. This is the same shape as the jump's
    // hold-point ratchet (RULING GF-3.3) and, like it, no boolean of character
    // state exists and nothing branches on which phase of a slide we are in.
    const slideRate = sliding ? TUNING.action.slideEntryRate : TUNING.action.slideExitRate;
    const slideCeiling = sliding ? TUNING.action.slideHoldPhase : 1;
    if (startingSlide) slidePhase = 0;
    slidePhase = Math.min(slideCeiling, slidePhase + slideRate * dt);
    // THE DIVE PHASE IS A HOLD-POINT RATCHET, exactly like the slide's above
    // and the jump's before it. Airborne it climbs to diveHoldPhase — the
    // soaring superman — and stays; on contact it runs on to 1 and the landing
    // plays out under the skid. A linear ramp over a fixed tick count reached
    // the landing pose a third of the way through the flight and dropped the
    // athlete on his face for the rest of it.
    if (divePhaseRestart) divePhase = 0;
    const diveRate = diveSkidding ? TUNING.action.diveLandRate : TUNING.action.diveTakeoffRate;
    const diveCeiling = diveSkidding ? 1 : TUNING.action.diveHoldPhase;
    divePhase = Math.min(diveCeiling, divePhase + diveRate * dt);
  }
  // THE STUN, READ AS A TICK COMPARISON. Set on the landing edge above and
  // nowhere else; the recovery ramp is the only thing that reads it, and it
  // reads it as "not yet expired" rather than as a state anything branches on.
  const diveStunned = tick < state.diveStunUntil;

  return {
    /** The jump the motor may actually fire — swallowed by a slide, locked by a dive. */
    allowJump,
    sliding,
    diveSkidding,
    diveStunned,
    /** updateMotor's driveScale is zeroed by this, not multiplied. */
    actionCommitted,
    /** MULTIPLIES the knockdown drag; it never replaces it. */
    actionResistance,
    /** The ghost's four action inputs, or null before the first spawn. */
    slideMix,
    diveMix,
    slidePhase,
    divePhase,
  };
}
