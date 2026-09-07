import { TUNING } from '../config/tuning.js';
import { bodySideForRigKey, rigSuffixForBodySide } from '../sim/autorig.js';

/**
 * THE STRIKES — the volley, the spike and the kick: one mechanism, three rows.
 *
 * A strike is three things and only three (G4 §1):
 *
 *   1. A POSE OVERLAY — a hold-point ratchet over the strike clip, in the
 *      action tier, exactly the shape the jump, the slide and the dive already
 *      have (RULING GF-3.3). This file owns the ratchet; the ghost owns how
 *      much of the pose is showing.
 *   2. A TIMING WINDOW — a tick latch from the press. `tick - lastStrikeTick`
 *      inside `[windowOpen, windowClose]` is the whole of it.
 *   3. A CONTACT RESOLVER — a qualifying body part touching a ball inside that
 *      window puts one impulse on THE BALL.
 *
 * LAW 1 — PHYSICS OWNS MOMENTUM, AND A STRIKE PUSHES THE BALL. This file makes
 * exactly one impulse call and its receiver is a ball body. Nothing here writes
 * an impulse, a force, a velocity or a position on any athlete body, the sphere
 * included, and nothing here teleports anything. Recoil would be a torque on the
 * sphere through the ordinary input path, and it is not in G4.
 *
 * The census for that greps this directory for Rapier's two impulse setters and
 * must return ONE line. This paragraph is deliberately written without spelling
 * either name, so that it cannot answer its own grep — the same trap the G4
 * spec's first draft fell into, and the reason its census wording was replaced.
 *
 * LAW 4 (GF-2.0) — THERE IS NO STRIKE STATE. What this module carries is one
 * monotone ratchet and a set of recorded values, every one of them the same
 * class as `motor.lastJumpTick`: the tick of the last press, which kind it was,
 * which side, how that side was chosen, the aim it was thrown at, the kind East
 * last selected, the athlete's speed, the tick a contact resolved, and the tick
 * of the last strike that resolved. Nothing branches on "are we striking". The
 * window is a subtraction; the kind selects a ROW OF A TABLE, never a code
 * path. There is no striking flag and no can-strike predicate anywhere in the
 * project, and the census greps for those two names return nothing — including
 * from this comment, which is why neither is spelled here.
 *
 * G4.1 ADDS ONE ROW AND ONE RULE, and neither is an exception to that. The
 * kick is a third row of the same table. The East button is still ONE press
 * latch: what changed is that the row it selects is now read from the ball's
 * height at the press instead of being fixed, which is a recorded value from a
 * continuous query at an edge — precisely what the side already was. There is
 * no second latch, no per-kind code path, and no flag naming the kick, for the
 * same reason there is none naming the swing.
 *
 * LESSON 15 — THE RESOLVER DOES NOT GATE ON FORCE. Any contact of a qualifying
 * body inside the window resolves. The force is RECORDED per resolved strike so
 * a force floor can be set later from measurements rather than invented now —
 * which is exactly the mistake the ball's own instrumentation avoided in G2.
 *
 * LAW 3 — nothing here damps anything, and no damping setter is named in this
 * file, in code or in a comment, so a grep hit in `mechanics/` is a violation
 * rather than a mention.
 *
 * THE DIRECTORY RULE (src/mechanics/): nothing here names a wall clock or a
 * scheduler. The clock is `tick`.
 */

/** Radians per degree. The table authors elevation in degrees, humans read degrees. */
const DEG2RAD = Math.PI / 180;

/** Kind codes. A recorded value that selects a table row — never a state. */
const KIND_NONE = 0;
const KIND_VOLLEY = 1;
const KIND_SPIKE = 2;
const KIND_KICK = 3;

/** The name of a kind, for the logs and the probe. A lookup, not a branch. */
const KIND_NAME = { 0: '\u2014', 1: 'volley', 2: 'spike', 3: 'kick' };

/** Scratch for the impulse, so a strike allocates nothing. */
const _impulse = { x: 0, y: 0, z: 0 };

/**
 * Folds an angle into (-PI, PI]. Local rather than imported: `animtarget.js`
 * keeps its own and does not export it, and a shared maths module for one
 * three-line function is a module nobody reads.
 *
 * @param {number} a
 * @returns {number}
 */
function wrapAngle(a) {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/**
 * The strike clocks and latches for ONE athlete.
 *
 * Created at boot and held by the caller — never a module-level singleton,
 * because G5 instantiates N athletes and a shared strike clock would mean two
 * players swinging on one timer.
 *
 * @returns {object}
 */
export function createStrikeState() {
  return {
    /** Monotone ratchet 0..1. Resets to 0 only on a press. */
    strikePhase: 0,
    /** Tick of the last press. -Infinity means "never struck". */
    lastStrikeTick: -Infinity,
    /** 0 none, 1 volley, 2 spike. Recorded at the press; selects a table row. */
    lastStrikeKind: KIND_NONE,
    /** +1 right, -1 left. Recorded at the press, for the spike's two clips. */
    lastStrikeSide: 1,
    /**
     * THE AIM, LATCHED AT THE PRESS (RULING §9.5).
     *
     * A strike is a commitment, not a steerable projectile. Sampling the stick
     * inside the resolver would read it AFTER the world step, half a second
     * after the swing began, and would hand the shot to whatever the player's
     * thumb happened to be doing on the frame of contact. Latching it here puts
     * the aim in the same class as `lastStrikeSide` beside it and lets the
     * resolver read a recorded number instead of touching input at all.
     */
    lastAimYaw: 0,
    /** Tick of the last resolved contact. -Infinity means "never". */
    lastContactTick: -Infinity,
    /** Quality of that contact, 0..1, as the resolver computed it. */
    lastContactQuality: 0,
    /** Rig key that made it, or '' for none. */
    lastContactKey: '',
    /** Contact force in newtons — recorded, never gated on (LESSON 15). */
    lastContactForce: 0,
    /** The impulse direction and speed that left the racket, for the HUD. */
    lastLaunch: { x: 0, y: 0, z: 0 },
    lastLaunchSpeed: 0,
    /**
     * The `lastStrikeTick` of the most recent strike that resolved.
     *
     * This is how "has this strike already connected" is asked without a
     * boolean: it is a comparison of two recorded ticks. It gates the one
     * impulse per strike, it ends the ratchet's hold, and it is what the whiff
     * count tests against.
     */
    lastResolvedStrikeTick: -Infinity,
    /** How many strikes connected, and how many missed. The §6.6 numbers. */
    resolvedCount: 0,
    whiffCount: 0,
    /** The action-tier share this strike is asking for, 0..1. Eased. */
    strikeMix: 0,

    // ═══ G4.1 ═══ Four more recorded values and two counters. Every one of
    // them is the same class as the six above: a number written at an edge and
    // read later. None of them is a mode, and nothing branches on any of them
    // except to pick a row or a clip.

    /**
     * THE LAST KIND EAST CHOSE. It exists for exactly one reason: the
     * hysteresis band needs something to repeat. Without it, a ball bobbing
     * within `kickHysteresis` of the threshold flips between a volley and a
     * kick on consecutive presses, which is the worst available reading of an
     * ambiguous ball. KIND_NONE until the first East press.
     */
    lastEastKind: KIND_NONE,
    /** How the last side was chosen: 'projection', 'stick', 'last' or ''. */
    lastSideVia: '',
    /**
     * The athlete's own ground speed, recorded each step from the ghost's
     * smoothed velocity so the contact log can carry it (RULING §9.4). The
     * resolver runs after the world step and reads recorded values only — this
     * is one of them, and reading `motor` from in there would not be.
     */
    lastAthleteSpeed: 0,
    /**
     * SIDE AGREEMENT (§5b) — of resolved strikes on a SIDED row, how many were
     * made by a limb on the side chosen at the press. Two counters rather than
     * a ratio, so the probe divides once and nothing accumulates error.
     */
    sidedResolved: 0,
    sidedMatched: 0,
    /** One-shot guard for the climbRate check. Per athlete, never a module flag. */
    ratesChecked: false,
  };
}

/**
 * The table row for a recorded kind. A row, not a branch.
 *
 * @param {number} kind
 * @returns {object|null}
 */
function rowFor(kind) {
  if (kind === KIND_VOLLEY) return TUNING.strike.volley;
  if (kind === KIND_SPIKE) return TUNING.strike.spike;
  if (kind === KIND_KICK) return TUNING.strike.kick;
  return null;
}

/**
 * Every row in the table, for the checks that must walk all of them.
 *
 * @returns {[string, object][]}
 */
function allRows() {
  return [['volley', TUNING.strike.volley], ['spike', TUNING.strike.spike], ['kick', TUNING.strike.kick]];
}

/**
 * A row with two takes needs a side chosen; a row with one does not.
 *
 * Asked of the row rather than of the kind, so registering a fourth sided row
 * needs no edit here (RULING §9.2's lesson: a value that silently does nothing
 * is worse than one that is wrong).
 *
 * @param {object|null} row
 * @returns {boolean}
 */
function isSided(row) {
  return !!(row && row.clipLeft && row.clipRight);
}

/**
 * A DEAD RATCHET MUST NOT FAIL SILENTLY (RULING §9.2).
 *
 * A `climbRate` of zero, a negative, or a NaN leaves `strikePhase` pinned at 0
 * forever: the clip never scrubs, the strike is invisible, the window still
 * opens and closes, and every symptom points at the window. Once per athlete,
 * loudly, at the first step — not a throw, because a broken feel knob should
 * not take the game down mid-session, and not a silent clamp, because a
 * working-but-wrong strike is the one failure this project keeps paying for.
 *
 * @param {object} state
 */
function checkRates(state) {
  if (state.ratesChecked) return;
  state.ratesChecked = true;
  for (const [name, row] of allRows()) {
    for (const field of ['climbRate', 'completeRate']) {
      const v = row[field];
      if (!Number.isFinite(v) || v <= 0) {
        console.error(
          `[strike] TUNING.strike.${name}.${field} is ${v} — the ratchet cannot advance. ` +
            'The clip will never scrub and every strike of this kind is invisible.',
        );
      }
    }
  }
}

/**
 * The quality curve over timing error, in ticks.
 *
 * Flat 1.0 inside `qualityPerfectTicks`, flat at the floor beyond
 * `qualityZeroTicks`, linear between. THE FLOOR IS NOT ZERO and that is
 * deliberate: a contact that leaves the ball exactly where it was reads as a
 * bug rather than as a bad shot, and a player cannot learn timing from an
 * outcome that looks like a broken game.
 *
 * @param {number} errorTicks absolute timing error
 * @returns {number} 0..1
 */
function quality(errorTicks) {
  const { qualityPerfectTicks, qualityZeroTicks, qualityFloor } = TUNING.strike;
  if (errorTicks <= qualityPerfectTicks) return 1;
  if (errorTicks >= qualityZeroTicks) return qualityFloor;
  const t = (errorTicks - qualityPerfectTicks) / (qualityZeroTicks - qualityPerfectTicks);
  return 1 + (qualityFloor - 1) * t;
}

/**
 * The aim, computed once at the press.
 *
 * Facing yaw blended toward the stick's own heading by `aimStickWeight` scaled
 * by how far the stick is pushed. Neutral stick therefore aims exactly where
 * the athlete is looking, which after RULING GF-2 is the camera's yaw — so the
 * default shot goes where the player is pointing the camera, and leaning the
 * stick angles it off that by at most `aimStickWeight`.
 *
 * @param {object} input the latched input snapshot
 * @param {object|null} ghost the anim target, READ for its facing yaw
 * @returns {number} world yaw in radians
 */
function aimYaw(input, ghost) {
  const facing = ghost ? ghost.yaw : input.cameraYaw;
  const magnitude = Math.min(1, Math.hypot(input.moveWorld.x, input.moveWorld.z));
  if (magnitude <= 0) return facing;
  const stickYaw = Math.atan2(input.moveWorld.x, input.moveWorld.z);
  // Shortest way round, so a stick pointing just past due-behind does not swing
  // the aim the long way about.
  const delta = wrapAngle(stickYaw - facing);
  return wrapAngle(facing + delta * TUNING.strike.aimStickWeight * magnitude);
}

/**
 * THE NEAREST BALL, by XZ distance from a point. ONE helper, shared by the
 * height test and the side test (G4.1 §5.1) — they used to be the same three
 * lines written twice, which is how the two queries drift apart.
 *
 * Ties go to the earlier ball. Iteration order is the balls' creation order,
 * which LAW 6 already depends on being stable (see the note on TUNING.balls),
 * so two balls at exactly equal distance resolve the same way every run.
 *
 * @param {object[]} balls
 * @param {number} x
 * @param {number} z
 * @param {(ball: object) => {x: number, z: number}} [at] where to consider each
 *        ball to be — its current position by default, its PROJECTED position
 *        for the side test.
 * @returns {{ball: object, x: number, z: number, distance: number}|null}
 */
function nearestBall(balls, x, z, at) {
  let best = null;
  let bestDistance = Infinity;
  for (const ball of balls) {
    const p = at ? at(ball) : ball.body.translation();
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestDistance) {
      bestDistance = d;
      best = { ball, x: p.x, z: p.z, distance: d };
    }
  }
  return best;
}

/**
 * A 2D displacement, clamped to a maximum length. Scratch-free: it returns the
 * scale, and the caller multiplies.
 *
 * @param {number} x
 * @param {number} z
 * @param {number} limit
 * @returns {number} 1, or the factor that brings (x, z) onto the limit
 */
function clampScale(x, z, limit) {
  const length = Math.hypot(x, z);
  return length > limit && length > 0 ? limit / length : 1;
}

/**
 * The athlete's local +x offset to a world point, given his facing.
 *
 * +x is his right. The same rotation the G4 spike side used, kept identical so
 * the before/after `sideAgreement` numbers compare like with like.
 *
 * @param {number} dx world
 * @param {number} dz world
 * @param {number} yaw
 * @returns {number}
 */
function localRight(dx, dz, yaw) {
  return dx * Math.cos(yaw) - dz * Math.sin(yaw);
}

/**
 * THE PELVIS HEIGHT the East test measures the ball against.
 *
 * Read off the GHOST's pelvis target, which is one fixed step stale — the same
 * staleness as `smoothedVelX/Z` beside it and deliberate for the same reason:
 * every value a press reads is the world as it stood when the step began.
 *
 * The sphere's centre is the fallback and not the answer: it is roughly half a
 * metre below the pelvis, so the threshold would mean something different. The
 * fallback only runs on the handful of ticks before the first spawn, when there
 * is no ghost and no press can have been made either.
 *
 * @param {object|null} ghost
 * @param {object} motor
 * @returns {number} world y, metres
 */
function pelvisHeight(ghost, motor) {
  const target = ghost && ghost.targets && ghost.targets.get('pelvis');
  if (target) return target.currPos.y;
  return motor.body.translation().y;
}

/**
 * WHICH ROW EAST SELECTS — the whole of the contextual kick (G4.1 §5).
 *
 * The ball's centre height relative to the pelvis, compared against one
 * threshold, with a hysteresis band that repeats the last choice. It is a
 * recorded value from a continuous query at an edge, exactly what
 * `lastStrikeSide` already is; nothing here is a mode and nothing downstream
 * branches on it except to pick a row.
 *
 * The height test reads the ball's CURRENT position, not its projected one:
 * the question it answers is "which action starts now", and the athlete is
 * looking at the ball where it is. The SIDE test projects, because its question
 * is "where will the ball be when this contacts". Two questions, two queries.
 *
 * @param {object} state
 * @param {object|null} ghost
 * @param {object} motor
 * @param {object[]} balls
 * @returns {number} KIND_VOLLEY or KIND_KICK
 */
function eastKind(state, ghost, motor, balls) {
  const strike = TUNING.strike;
  const centre = motor.body.translation();
  const near = nearestBall(balls, centre.x, centre.z);

  // NO BALL IN REACH: East is a volley and the athlete swings at air. That is a
  // whiff, and a whiff is data — it is counted, and it is how the §6.6 rate
  // learns that the player is pressing at nothing.
  if (!near || near.distance > strike.contextRadius) {
    state.lastEastKind = KIND_VOLLEY;
    console.log(
      `[strike] east -> volley  no ball within ${strike.contextRadius.toFixed(2)} m` +
        `${near ? ` (nearest ${near.distance.toFixed(2)} m, ball:${near.ball.id})` : ' (no balls)'}`,
    );
    return KIND_VOLLEY;
  }

  const rel = near.ball.body.translation().y - pelvisHeight(ghost, motor);
  const inBand = Math.abs(rel - strike.kickBelowHips) <= strike.kickHysteresis;
  const repeat = inBand && state.lastEastKind !== KIND_NONE;
  const kind = repeat
    ? state.lastEastKind
    : (rel < strike.kickBelowHips ? KIND_KICK : KIND_VOLLEY);
  state.lastEastKind = kind;

  // ONE LINE PER EAST PRESS. This is the designer's tuning data for the
  // threshold (§5.5) — the number that says whether -0.10 is the right place
  // for it, read off real presses at real balls rather than off the bind pose.
  console.log(
    `[strike] east -> ${KIND_NAME[kind]}  ballY-pelvisY ${rel.toFixed(3)} m  ` +
      `threshold ${strike.kickBelowHips.toFixed(3)}  hyst ${repeat ? 'yes' : 'no'}  ` +
      `ball:${near.ball.id}`,
  );
  return kind;
}

/**
 * WHICH SIDE A SIDED ROW SWINGS FROM — predictive, shared, decided once (§5b).
 *
 * G4 sampled the ball's local x AT THE PRESS and playtesting found it picks the
 * wrong limb often: a ball crossing the chest is on the other side by
 * `sweetTick`, which is 14 ticks later for a kick and 42 for a spike, and a
 * centred ball flipped arbitrarily.
 *
 * So both the ball and the athlete are projected forward to the contact tick
 * and the question is asked THERE. This is a better estimate at the same
 * moment, not tracking: it is still one value recorded at the press edge, and
 * nothing re-evaluates it mid-swing. Re-evaluating would be a branch on a
 * moving signal — the thing GF-3.3 and LAW 4 both forbid — and would swap the
 * clip out from under a running ratchet.
 *
 * `vSmoothed` is the GHOST's smoothed velocity and not `motor.body.linvel()`
 * (RULING §9.5): they are different numbers, and the smoothed one is what every
 * other consumer of the athlete's velocity already reads. One step stale,
 * deliberately.
 *
 * BOTH displacements are clamped by the same `sideProjectClamp` (RULING §9.6).
 * A spike-speed ball must not be projected across the court, and a sprinting
 * athlete must not be assumed to cover 2.8 m in 42 ticks. `sideAgreement` is
 * the number that will say whether the clamp ever wants to be per-body.
 *
 * @param {object} state READ for lastAimYaw and lastStrikeSide, WRITES lastSideVia
 * @param {object} row the row being swung — its own sweetTick is the horizon
 * @param {object} input the latched input snapshot
 * @param {object} motor READ ONLY
 * @param {object|null} ghost READ for the smoothed velocity
 * @param {object[]} balls
 * @param {number} dt
 * @returns {number} +1 right, -1 left
 */
function chooseSide(state, row, input, motor, ghost, balls, dt) {
  const strike = TUNING.strike;
  const clamp = strike.sideProjectClamp;
  // THE HORIZON IS THE ROW'S OWN sweetTick, not a separate knob, because the
  // question is "where will the ball be when THIS strike contacts".
  const horizon = row.sweetTick * dt;

  // The athlete, projected. Clamped by the same number the ball is.
  const centre = motor.body.translation();
  const vx = ghost ? ghost.smoothedVelX : 0;
  const vz = ghost ? ghost.smoothedVelZ : 0;
  const athScale = clampScale(vx * horizon, vz * horizon, clamp);
  const athX = centre.x + vx * horizon * athScale;
  const athZ = centre.z + vz * horizon * athScale;

  // Every ball, projected. XZ only — lateral is the question and gravity has no
  // opinion about x.
  const projected = (ball) => {
    const p = ball.body.translation();
    const v = ball.body.linvel();
    const scale = clampScale(v.x * horizon, v.z * horizon, clamp);
    return { x: p.x + v.x * horizon * scale, z: p.z + v.z * horizon * scale };
  };

  // NEAREST BY PROJECTED DISTANCE: the ball you will meet, not the one beside
  // you now.
  const near = nearestBall(balls, athX, athZ, projected);
  if (!near) {
    state.lastSideVia = 'last';
    return state.lastStrikeSide;
  }

  const yaw = state.lastAimYaw;
  const now = near.ball.body.translation();
  const localNow = localRight(now.x - centre.x, now.z - centre.z, yaw);
  const localAt = localRight(near.x - athX, near.z - athZ, yaw);

  let side;
  let via;
  if (Math.abs(localAt) >= strike.sideDeadzone) {
    side = localAt < 0 ? -1 : 1;
    via = 'projection';
  } else {
    // CENTRED. The stick breaks the tie — the player leaning is the clearest
    // statement of intent available — and failing that the last side, which is
    // hysteresis and not a fixed default. A fixed default is what made a
    // centred ball always swing right.
    const stickLateral = localRight(input.moveWorld.x, input.moveWorld.z, yaw);
    if (Math.abs(stickLateral) > TUNING.motor.stickDeadzone) {
      side = stickLateral < 0 ? -1 : 1;
      via = 'stick';
    } else {
      side = state.lastStrikeSide;
      via = 'last';
    }
  }
  state.lastSideVia = via;

  // The side logged is the side of the BODY. The clip it selects is named the
  // other way round in this asset, so both are printed: a log that showed only
  // one of them is how the mirrored naming stayed invisible.
  console.log(
    `[strike] side ${side < 0 ? 'L' : 'R'} via ${via}  ` +
      `localX now ${localNow.toFixed(3)} m -> at contact ${localAt.toFixed(3)} m ` +
      `(dt ${row.sweetTick} ticks)  clip:${rigSuffixForBodySide(side)}  ball:${near.ball.id}`,
  );
  return side;
}

/**
 * One step of the strike mechanic. STEP 5b, beside the slide and the dive.
 *
 * It runs before the motor for the same reason they do: everything it produces
 * is consumed later in the step, and it must consume the press latches on the
 * tick they were queued so a press cannot survive into a later one and swing
 * twice.
 *
 * @param {object} args
 * @param {ReturnType<typeof createStrikeState>} args.state
 * @param {object} args.input the latched input snapshot
 * @param {object} args.motor READ ONLY, for the spike's side
 * @param {object|null} args.ghost the anim target, READ for facing yaw
 * @param {object[]} args.balls READ ONLY, for the spike's side
 * @param {boolean} args.volleyQueued the consumed press, consumed by the caller
 * @param {boolean} args.spikeQueued
 * @param {number} args.tick
 * @param {number} args.dt
 * @returns {object} the four numbers the ghost is handed
 */
export function runStrikes({ state, input, motor, ghost, balls, volleyQueued, spikeQueued, tick, dt }) {
  const strike = TUNING.strike;
  const since = tick - state.lastStrikeTick;

  // A dead ratchet, said out loud once, before anything can be blamed on the
  // window. See checkRates.
  checkRates(state);

  // THE ATHLETE'S OWN SPEED, recorded for the contact log (RULING §9.4). The
  // resolver runs after the world step and may only read recorded values, so it
  // has to be taken here, from the same smoothed velocity chooseSide projects.
  state.lastAthleteSpeed = ghost ? Math.hypot(ghost.smoothedVelX, ghost.smoothedVelZ) : 0;

  // ═══ THE PRESS ═══
  //
  // The volley wins a same-tick tie. Two face buttons pressed on one tick is a
  // fumble rather than an intent, and picking the gentler of the two is the
  // kinder reading of it.
  const pressed = volleyQueued || spikeQueued;
  if (pressed && since >= strike.pressCooldownTicks) {
    // A strike abandoned by a re-press inside its own window never had its
    // window close, so it would never be counted. Count it here, on the same
    // tick-comparison the window close uses, before the latch is overwritten.
    const openRow = rowFor(state.lastStrikeKind);
    if (openRow && since <= openRow.windowClose &&
        state.lastResolvedStrikeTick !== state.lastStrikeTick) {
      state.whiffCount += 1;
    }

    // EAST IS ONE LATCH AND TWO ROWS. The press is consumed the same way it
    // always was; `eastKind` decides which row it selects, from the ball's
    // height at this instant. North is still the spike, unconditionally.
    const wanted = volleyQueued ? eastKind(state, ghost, motor, balls) : KIND_SPIKE;

    state.lastStrikeTick = tick;
    state.lastStrikeKind = wanted;
    // ORDER IS LOAD-BEARING: the aim is latched BEFORE the side, because
    // `chooseSide` rotates into the facing frame and reads `lastAimYaw` to do
    // it. Latching the side first would rotate by the PREVIOUS strike's aim.
    state.lastAimYaw = aimYaw(input, ghost);
    const wantedRow = rowFor(wanted);
    state.lastStrikeSide = isSided(wantedRow)
      ? chooseSide(state, wantedRow, input, motor, ghost, balls, dt)
      : state.lastStrikeSide;
    // The ratchet re-seeds HERE and nowhere else — the same treatment
    // startingSlide gives slidePhase and the dive's launch gives divePhase.
    state.strikePhase = 0;
  }

  const row = rowFor(state.lastStrikeKind);
  const elapsed = tick - state.lastStrikeTick;

  // ═══ THE WHIFF ═══
  //
  // Counted on the single tick the window closes, and only when the strike that
  // opened it never resolved. Two recorded ticks compared; no flag is raised
  // and nothing is cleared.
  if (row && elapsed === row.windowClose + 1 &&
      state.lastResolvedStrikeTick !== state.lastStrikeTick) {
    state.whiffCount += 1;
  }

  // ═══ THE RATCHET ═══
  //
  // Monotone, hold-point, completes on an edge — the house pattern (RULING
  // GF-3.3), identical in shape to the jump's, the slide's and the dive's. It
  // climbs to holdPoint and STAYS there while the window is open, which is what
  // holds the athlete at full extension for the frames a ball could arrive in;
  // once the window closes or a contact resolves, it runs on to 1 and the
  // clip's own follow-through plays out under the crossfade.
  //
  // Both rates are authored at 1x — the animator's timing, measured rather than
  // invented. See the note above TUNING.strike.
  if (row) {
    const resolvedThisStrike = state.lastResolvedStrikeTick === state.lastStrikeTick;
    const holding = elapsed < row.windowClose && !resolvedThisStrike;
    const ceiling = holding ? row.holdPoint : 1;
    const rate = holding ? row.climbRate : row.completeRate;
    state.strikePhase = Math.min(ceiling, state.strikePhase + rate * dt);
  }

  // ═══ THE SHARE ═══
  //
  // Eased toward 1 while a strike is unfinished and toward 0 once it has
  // completed, at one rate — the same construction as slideMix and diveMix, so
  // the action tier combines three demands the way it already combines two.
  const striking = Number.isFinite(state.lastStrikeTick) && state.strikePhase < 1;
  const ease = 1 - Math.exp(-strike.mixEase * dt);
  state.strikeMix += ((striking ? 1 : 0) - state.strikeMix) * ease;

  return {
    strikeMix: state.strikeMix,
    strikePhase: state.strikePhase,
    strikeKind: state.lastStrikeKind,
    strikeSide: state.lastStrikeSide,
  };
}

/**
 * A ball-vs-limb contact, offered to the strike. STEP 12, from the impact drain.
 *
 * READS RECORDED VALUES ONLY — no `input`, no `motor`, no ghost. It runs after
 * `stepPhysics`, and a resolver that sampled live input there would be reading
 * the world half a step after the swing it is resolving. Everything it needs
 * was latched at the press.
 *
 * Returns quietly for every contact that is not a strike, which is most of
 * them: the limbs knock the balls about constantly and `noteBallContact` has
 * already recorded that. This adds INTENT on top, and only inside the window.
 *
 * @param {ReturnType<typeof createStrikeState>} state
 * @param {object} ball the ball that was hit
 * @param {string|undefined} rigKey the limb that hit it, if it was a limb
 * @param {number} force contact force magnitude, newtons
 * @param {number} tick
 * @returns {boolean} true if this contact became a strike
 */
export function resolveStrikeContact(state, ball, rigKey, force, tick) {
  const row = rowFor(state.lastStrikeKind);
  const elapsed = tick - state.lastStrikeTick;
  const windowOpen = !!row && elapsed >= row.windowOpen && elapsed <= row.windowClose;

  // ═══ EVERY LIMB TOUCH IS LOGGED, TAGGED ═══ (RULING §9.4)
  //
  // LESSON 15 says measure before you gate, and G4.1 is the first step whose
  // striking bodies are FEET: at an event threshold of 1 N they will scuff the
  // ball constantly just walking past it, and a kick-specific force floor —
  // expected later, deliberately not added now — has to be set from deliberate
  // kicks rather than from scuffs. That is only possible if the two are
  // distinguishable afterwards, so every touch carries the athlete's ground
  // speed, the ball's speed and whether a window was open. Filter on those.
  if (rigKey) {
    const v = ball.body.linvel();
    console.log(
      `[contact] ${rigKey} ${force.toFixed(1)} N  ball:${ball.id} ` +
        `ballSpeed ${Math.hypot(v.x, v.y, v.z).toFixed(2)} m/s  ` +
        `athleteSpeed ${state.lastAthleteSpeed.toFixed(2)} m/s  ` +
        `window ${windowOpen ? `open (${KIND_NAME[state.lastStrikeKind]}, +${elapsed})` : 'shut'}  ` +
        `tick ${tick}`,
    );
  }

  if (!row || !rigKey) return false;

  // Not a striking body: an incidental touch, already recorded by the ball.
  if (!row.bodies.includes(rigKey)) return false;

  // Outside the window: also incidental. The window is the whole gate.
  if (!windowOpen) return false;

  // ONE IMPULSE PER STRIKE. A two-hand volley reports two contacts on the same
  // tick and a spike often reports hand and forearm together; without this the
  // ball would take the impulse once per limb and leave at double speed.
  if (state.lastResolvedStrikeTick === state.lastStrikeTick) return false;

  const q = quality(Math.abs(elapsed - row.sweetTick));

  // MASS-NORMALISED, which is what makes one authored launch speed mean the
  // same thing on a 0.84 kg ball and a 3.9 kg one. Impulse is mass x speed, so
  // dividing it back out at the point of authoring is how "this shot leaves at
  // 14 m/s" survives the three-ball fixture and whatever G5 picks per round.
  const speed = row.launchSpeed * q;
  const elevation = row.elevationDeg * DEG2RAD;
  const horizontal = Math.cos(elevation);
  const dirX = Math.sin(state.lastAimYaw) * horizontal;
  const dirY = Math.sin(elevation);
  const dirZ = Math.cos(state.lastAimYaw) * horizontal;

  const magnitude = ball.body.mass() * speed;
  _impulse.x = dirX * magnitude;
  _impulse.y = dirY * magnitude;
  _impulse.z = dirZ * magnitude;

  // THE ONE IMPULSE THIS STEP ADDS TO THE PROJECT, and it lands on a ball.
  ball.body.applyImpulse(_impulse, true);

  state.lastResolvedStrikeTick = state.lastStrikeTick;
  state.lastContactTick = tick;
  state.lastContactQuality = q;
  state.lastContactKey = rigKey;
  state.lastContactForce = force;
  state.lastLaunch.x = dirX * speed;
  state.lastLaunch.y = dirY * speed;
  state.lastLaunch.z = dirZ * speed;
  state.lastLaunchSpeed = speed;
  state.resolvedCount += 1;

  // ═══ SIDE AGREEMENT ═══ (§5b)
  //
  // Did the limb that actually made contact belong to the side chosen at the
  // press? Counted only on SIDED rows, because an unsided row chose nothing and
  // averaging it in would dilute the number that is meant to prove the
  // projection. The limb's side is the last character of its rig key — every
  // sided body in BONE_MAP ends in L or R.
  let agreement = '';
  if (isSided(row)) {
    // THROUGH THE SAME TRANSLATION THE CLIP SELECTION USES. Reading the side
    // straight off the rig key's last letter was the naive inverse, and it made
    // this metric agree with itself: the asset's side names are mirrored, so a
    // chosen +1 selecting the clip named Right and a contact reported on the
    // R-named foot would both read as "right" and score 100% agreement while
    // the athlete visibly swung the other limb. The suffix test is spelled out
    // only in autorig.js, so a grep for it finds the one place that owns it.
    const contactSide = bodySideForRigKey(rigKey);
    const matched = contactSide === (state.lastStrikeSide < 0 ? -1 : 1);
    state.sidedResolved += 1;
    if (matched) state.sidedMatched += 1;
    agreement = ` side ${state.lastStrikeSide < 0 ? 'L' : 'R'} via ${state.lastSideVia}` +
      ` -> ${matched ? 'AGREE' : 'DISAGREE'}`;
  }

  // One line per resolved strike. This is the §6.5 calibration data: the force
  // column is what a force floor would eventually be set from, and it is being
  // collected precisely because nothing gates on it yet (LESSON 15).
  console.log(
    `[strike] ${KIND_NAME[state.lastStrikeKind]} ` +
      `q ${q.toFixed(3)} (err ${Math.abs(elapsed - row.sweetTick)} ticks) ` +
      `${rigKey} ${force.toFixed(1)} N -> ${speed.toFixed(2)} m/s ` +
      `ball:${ball.id} mass ${ball.body.mass().toFixed(3)} kg` +
      `${agreement} tick ${tick}`,
  );
  return true;
}

/**
 * A read-only snapshot for the console probe and the HUD.
 *
 * LESSON 22 — this READS. The quality it reports is the number the resolver
 * computed and stored, never a second evaluation of the curve.
 *
 * @param {ReturnType<typeof createStrikeState>} state
 * @returns {object}
 */
export function strikeProbe(state) {
  const attempts = state.resolvedCount + state.whiffCount;
  return {
    kind: KIND_NAME[state.lastStrikeKind],
    /** What East chose last time it was pressed — the contextual split, read. */
    eastKind: KIND_NAME[state.lastEastKind],
    phase: +state.strikePhase.toFixed(3),
    mix: +state.strikeMix.toFixed(3),
    side: state.lastStrikeSide,
    sideVia: state.lastSideVia,
    aimYaw: +state.lastAimYaw.toFixed(3),
    lastStrikeTick: state.lastStrikeTick,
    lastContactTick: state.lastContactTick,
    lastContactKey: state.lastContactKey || '',
    lastContactQuality: +state.lastContactQuality.toFixed(3),
    lastContactForce: +state.lastContactForce.toFixed(2),
    lastLaunchSpeed: +state.lastLaunchSpeed.toFixed(3),
    // THE LAUNCH VECTOR ITSELF, not just its magnitude. The scenario harness
    // compares this across runs: the ball's own velocity a few ticks later is a
    // strictly stronger check, but it is an inference — this is the number the
    // resolver actually handed to the impulse, and a gate reads better when it
    // compares the thing it is about.
    lastLaunch: {
      x: +state.lastLaunch.x.toFixed(6),
      y: +state.lastLaunch.y.toFixed(6),
      z: +state.lastLaunch.z.toFixed(6),
    },
    resolvedCount: state.resolvedCount,
    whiffCount: state.whiffCount,
    /** The §6.6 number: what fraction of swings connected. NaN before any. */
    hitRate: attempts > 0 ? +(state.resolvedCount / attempts).toFixed(3) : NaN,
    /**
     * THE §5b NUMBER: of resolved strikes on a sided row, the fraction whose
     * contacting limb was on the side chosen at the press. LESSON 22 — this
     * divides two counters the resolver kept; it does not re-derive a side.
     * NaN before any sided strike has resolved.
     */
    sideAgreement: state.sidedResolved > 0
      ? +(state.sidedMatched / state.sidedResolved).toFixed(3)
      : NaN,
    sidedResolved: state.sidedResolved,
  };
}
