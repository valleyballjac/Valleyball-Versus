import { TUNING } from '../config/tuning.js';

/**
 * MODULE HEADER — src/mechanics/scoring.js
 *
 * Role: Evaluates segment-vs-disc goal hoop crossings (`testHoopCrossing`),
 *   updates match scores, target-goal flips, and tick-based countdown/match
 *   clocks (`createMatchState`, `updateScoring`, `resetScoringState`).
 * Frame Phase: Fixed-step post-physics (`updateScoring`, called after `stepPhysics`).
 * Active Architectural Laws:
 *   - LAW 1 (Physics Owns Momentum): Scoring reads ball positions and never
 *     modifies ball velocity or position; balls pass through hoops unimpeded.
 *   - LAW 4 (Zero Hot-Loop Allocations): Reuses module-scoped `_missResult` and
 *     `_pPrev` scratch objects during per-tick hoop crossing checks.
 *   - LAW 6 (Determinism): Match and celebration clocks count fixed ticks (`tick`),
 *     never wall-clock seconds.
 */

/** North and south, as the goal ids appear in the events and the HUD. */
const GOAL_N = 'N';
const GOAL_S = 'S';

/**
 * Maximum single-tick travel squared (3.0 m per 1/60 s = 180 m/s) accepted as
 * a physical trajectory. Longer single-tick segments are teleport/reset chords
 * and must re-anchor the tracker instead of scoring a phantom goal.
 */
const MAX_GOAL_TICK_DIST_SQ = 9.0;

/**
 * Minimum valid crossing height Y (m) inside the hoop aperture. Measured terrain
 * floor under both hoop apertures (x = 0, |z| = 35..45) is 6.459..9.455 m, so
 * any crossing below 6.0 m is strictly subterranean and never a legal goal.
 */
const HOOP_MIN_VALID_Y = 6.0;

const _missResult = Object.freeze({ hit: false, entrySide: 0, y: 0, z: 0 });
const _pPrev = { x: 0, y: 0, z: 0 };
const _hitScratch = { hit: true, entrySide: 0, y: 0, z: 0 };
const _singleBallScratch = [null];

/**
 * Classifies whether the ENTIRE ball volume is strictly clear of the x = 0
 * goal plane: -1 (entirely West, x <= -r), +1 (entirely East, x >= +r),
 * or 0 (straddling x = 0).
 */
function ballClearedSide(x, radius) {
  if (x <= -radius) return -1;
  if (x >= radius) return 1;
  return 0;
}

/** The goal at the other end. One place, so no call site spells the flip out. */
function oppositeGoal(goalId) {
  return goalId === GOAL_N ? GOAL_S : GOAL_N;
}

/**
 * Records the most recent and previous touching athlete slot per team on a ball
 * for goal-scorer and assist attribution (zero hot-loop allocations once initialized).
 */
export function recordBallTeamTouch(ball, teamId, athleteSlot) {
  if (!ball || (teamId !== 'home' && teamId !== 'away') || !Number.isInteger(athleteSlot)) return;
  if (!ball._lastTouchByTeam) ball._lastTouchByTeam = { home: null, away: null };
  if (!ball._prevTouchByTeam) ball._prevTouchByTeam = { home: null, away: null };
  if (ball._lastTouchByTeam[teamId] !== null && ball._lastTouchByTeam[teamId] !== athleteSlot) {
    ball._prevTouchByTeam[teamId] = ball._lastTouchByTeam[teamId];
  }
  ball._lastTouchByTeam[teamId] = athleteSlot;
}

/**
 * @returns {object} the match state for ONE match. Held by the caller, never a
 *   module singleton — the same reason the strike state is not one.
 */
export function createMatchState() {
  const countdownSec = TUNING.match?.countdownSeconds !== undefined ? TUNING.match.countdownSeconds : 5;
  return {
    mode: TUNING.match.mode,
    scoreHome: 0,
    scoreAway: 0,
    /** 'N' | 'S'. The goal the home player is currently attacking. */
    targetGoal: GOAL_N,
    /** Remaining match ticks. 60 per second, counted down in the fixed step. */
    ticksRemaining: (TUNING.match?.durationSeconds || 300) * 60,
    /** Pre-match countdown ticks (5s). Clock is held at 5:00 while this counts down. */
    countdownTicksRemaining: countdownSec * 60,
    isCountingDown: TUNING.match?.mode === 'match' && countdownSec > 0,
    matchOver: false,
    /**
     * TICKS LEFT ON THE GOAL CELEBRATION, counted down in the fixed step.
     *
     * It lives here rather than in the renderer for one reason: the scoreboards
     * flash for a fixed number of TICKS, not for a fixed number of seconds off
     * a wall clock, so the flash is the same length on a 60 Hz panel and on a
     * 144 Hz one, and an anchored capture of tick N shows the same frame twice.
     * The renderer READS this (LESSON 22); nothing outside recordGoal sets it.
     */
    celebrationTicks: 0,
    /** 'home' | 'away' | null — who the last goal went to, for the banner. */
    lastScoredFor: null,
    /** The goal id the last goal went through, for the banner. */
    lastGoalId: null,
    /**
     * Per ball, by collider handle: where it was last tick, and whether each
     * hoop is ARMED for it. See updateScoring for what arming means.
     */
    ballTrackers: new Map(),
    /** Every goal, in order. The designer's record of what actually happened. */
    events: [],
  };
}

/**
 * Does the segment from pPrev to pCurr pass through a hoop's aperture?
 *
 * The hoops are rings in the x = 0 plane, so the test is: find where the
 * segment crosses x = 0, and ask whether that point is inside the disc.
 *
 * @param {{x: number, y: number, z: number}} pPrev
 * @param {{x: number, y: number, z: number}} pCurr
 * @param {number} hoopZ
 * @param {number} hoopY
 * @param {number} radius aperture radius, measured off the asset
 * @returns {{hit: boolean, entrySide: number, y: number, z: number}}
 */
export function testHoopCrossing(pPrev, pCurr, hoopZ, hoopY, radius) {
  // STRICT ON ONE SIDE, INCLUSIVE ON THE OTHER, so a ball that lands exactly on
  // x = 0 is counted as having crossed once and not again on the way out.
  const crosses = (pPrev.x < 0 && pCurr.x >= 0) || (pPrev.x > 0 && pCurr.x <= 0);
  if (!crosses) return _missResult;

  const dx = pCurr.x - pPrev.x;
  if (Math.abs(dx) < 1e-6) return _missResult;

  const alpha = -pPrev.x / dx;
  const yInt = pPrev.y + alpha * (pCurr.y - pPrev.y);
  const zInt = pPrev.z + alpha * (pCurr.z - pPrev.z);

  const dy = yInt - hoopY;
  const dz = zInt - hoopZ;
  if (dy * dy + dz * dz > radius * radius) return _missResult;

  // +1 arriving from the east (+x), -1 from the west. Recorded for the log; the
  // arming latch below is what actually gates a repeat.
  return { hit: true, entrySide: pPrev.x > 0 ? 1 : -1, y: yInt, z: zInt };
}

/**
 * One fixed tick of scoring and the match clock.
 *
 * Call it AFTER the world step, so pPrev and pCurr are consecutive post-step
 * positions and the segment between them is the path the ball actually took.
 *
 * @param {object} state
 * @param {object[]} balls
 * @param {number} tick
 */
export function updateScoring(state, balls, tick) {
  // THE CELEBRATION COUNTDOWN, FIRST — so a goal recorded further down this
  // same tick gets its full span rather than one tick less.
  if (state.celebrationTicks > 0) state.celebrationTicks -= 1;

  if (!state.mode) {
    state.mode = TUNING.match?.mode || 'match';
  }

  // Capture live-play eligibility BEFORE clock transitions so countdown ticks
  // and post-buzzer victory/overtime ticks can never score phantom goals, while
  // a genuine buzzer-beater on the final live tick still counts.
  const canScore = state.mode === 'practice' || (!state.isCountingDown && !state.matchOver);

  if (state.mode === 'match' && !state.matchOver) {
    if (state.isCountingDown) {
      if (state.countdownTicksRemaining > 0) {
        state.countdownTicksRemaining -= 1;
        if (state.countdownTicksRemaining === 0) {
          state.isCountingDown = false;
          console.log('[match] Countdown finished — PLAY CLOCK RUNNING!');
        }
      } else {
        state.isCountingDown = false;
      }
    } else if (state.ticksRemaining > 0) {
      state.ticksRemaining -= 1;
      if (state.ticksRemaining === 0) {
        state.matchOver = true;
        console.log(`[match] FULL TIME — home ${state.scoreHome} - ${state.scoreAway} away`);
      }
    }
  }

  const { hoopRadius, hoopCenterY, hoopNorthZ, hoopSouthZ } = TUNING.match;

  // Regulation matches ALWAYS use strictly 1 active match ball (multi-ball 3-ball
  // play is exclusive to Practice Sandbox).
  let evalBalls = balls;
  if (state.mode === 'match' && balls.length > 1) {
    _singleBallScratch[0] = balls[0];
    evalBalls = _singleBallScratch;
  }

  for (const b of evalBalls) {
    const handle = b.collider.handle;
    const pos = b.body.translation();
    const ballRadius = (typeof b.radius === 'number' && b.radius > 0) ? b.radius : 0.5;
    let tracker = state.ballTrackers.get(handle);

    if (!tracker) {
      // FIRST SIGHTING: record where it is and score nothing. There is no
      // previous position to draw a segment from, and inventing one at the
      // origin would fire a goal on the tick a ball spawns.
      state.ballTrackers.set(handle, {
        prevX: pos.x, prevY: pos.y, prevZ: pos.z,
        clearedSide: ballClearedSide(pos.x, ballRadius),
        pendingGoal: null,
        pendingFromSide: 0,
        pendingY: 0,
        pendingZ: 0,
        lastResetEpoch: b.resetEpoch || 0,
      });
      continue;
    }

    // TELEPORT / RESET CHORD GUARD: re-anchor without scoring whenever the ball
    // was explicitly reset, jumped an unphysical distance in one tick, or is non-finite.
    const curEpoch = b.resetEpoch || 0;
    const ddx = pos.x - tracker.prevX;
    const ddy = pos.y - tracker.prevY;
    const ddz = pos.z - tracker.prevZ;
    const stepDistSq = ddx * ddx + ddy * ddy + ddz * ddz;
    if (
      tracker.lastResetEpoch !== curEpoch ||
      stepDistSq > MAX_GOAL_TICK_DIST_SQ ||
      !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)
    ) {
      tracker.prevX = pos.x;
      tracker.prevY = pos.y;
      tracker.prevZ = pos.z;
      tracker.clearedSide = Number.isFinite(pos.x) ? ballClearedSide(pos.x, ballRadius) : 0;
      tracker.pendingGoal = null;
      tracker.pendingFromSide = 0;
      tracker.lastResetEpoch = curEpoch;
      continue;
    }

    _pPrev.x = tracker.prevX;
    _pPrev.y = tracker.prevY;
    _pPrev.z = tracker.prevZ;
    const pPrev = _pPrev;

    // ═══ FULL BALL-CLEARANCE GOAL RULE ═══
    //
    // A goal registers ONLY once the ENTIRE ball crosses the x = 0 hoop plane
    // (`|pos.x| >= ballRadius`) through a hoop aperture:
    //   1. When the ball's center crosses x = 0 inside a hoop aperture from its
    //      last fully cleared side (`clearedSide`), latch `pendingGoal`.
    //   2. If a defender swats a partially-crossed ball back before the whole
    //      sphere clears x = 0, `pendingGoal` clears cleanly (goal-line save).
    //   3. The instant the entire ball clears the opposite side (`currClearedSide
    //      === -pendingFromSide`), the goal scores and `clearedSide` flips to
    //      that new side immediately.
    //   4. Because `clearedSide` flips immediately upon full clearance, swatting
    //      (unthreading) a scored ball completely back through the hoop ALWAYS
    //      registers the responding goal with zero artificial re-arm distance,
    //      while a slow ball resting/rocking across x = 0 never reaches `|x| >= R`
    //      and can never double-score.
    if (canScore && tracker.clearedSide !== 0) {
      const hitN = testHoopCrossing(pPrev, pos, hoopNorthZ, hoopCenterY, hoopRadius);
      if (hitN.hit && hitN.y >= HOOP_MIN_VALID_Y) {
        if (hitN.entrySide === tracker.clearedSide) {
          tracker.pendingGoal = GOAL_N;
          tracker.pendingFromSide = tracker.clearedSide;
          tracker.pendingY = hitN.y;
          tracker.pendingZ = hitN.z;
        } else {
          tracker.pendingGoal = null;
          tracker.pendingFromSide = 0;
        }
      } else {
        const hitS = testHoopCrossing(pPrev, pos, hoopSouthZ, hoopCenterY, hoopRadius);
        if (hitS.hit && hitS.y >= HOOP_MIN_VALID_Y) {
          if (hitS.entrySide === tracker.clearedSide) {
            tracker.pendingGoal = GOAL_S;
            tracker.pendingFromSide = tracker.clearedSide;
            tracker.pendingY = hitS.y;
            tracker.pendingZ = hitS.z;
          } else {
            tracker.pendingGoal = null;
            tracker.pendingFromSide = 0;
          }
        }
      }
    } else if (!canScore) {
      tracker.pendingGoal = null;
      tracker.pendingFromSide = 0;
    }

    const currClearedSide = ballClearedSide(pos.x, ballRadius);
    if (tracker.pendingGoal !== null && tracker.pendingFromSide !== 0 && pos.x * tracker.pendingFromSide > 0) {
      // Ball center retreated back onto its entry side before full clearance (including after touching x = 0).
      tracker.pendingGoal = null;
      tracker.pendingFromSide = 0;
    }
    if (currClearedSide !== 0) {
      if (
        canScore &&
        tracker.pendingGoal !== null &&
        tracker.pendingFromSide !== 0 &&
        currClearedSide === -tracker.pendingFromSide
      ) {
        const targetHoopZ = tracker.pendingGoal === GOAL_N ? hoopNorthZ : hoopSouthZ;
        const maxOffset = hoopRadius + ballRadius + 1.0;
        if (Math.abs(pos.z - targetHoopZ) <= maxOffset && Math.abs(pos.y - hoopCenterY) <= maxOffset) {
          _hitScratch.entrySide = tracker.pendingFromSide;
          _hitScratch.y = tracker.pendingY;
          _hitScratch.z = tracker.pendingZ;
          recordGoal(state, tracker.pendingGoal, _hitScratch, tick);
        }
      }
      tracker.clearedSide = currClearedSide;
      tracker.pendingGoal = null;
      tracker.pendingFromSide = 0;
    }

    tracker.prevX = pos.x;
    tracker.prevY = pos.y;
    tracker.prevZ = pos.z;
  }
}

/**
 * A goal went in. Score it and switch ends.
 *
 * THE FLIP IS UNCONDITIONAL: after any goal, the target becomes the goal at the
 * OTHER end, so the player now defends the one just scored on. That is the rule
 * as written, and it is one line rather than one per branch — the two branches
 * differ in which counter goes up and in nothing else.
 *
 * @param {object} state
 * @param {string} goalId
 * @param {object} hitInfo
 * @param {number} tick
 */
function recordGoal(state, goalId, hitInfo, tick) {
  // Whichever team is currently attacking this goal gets the point.
  // state.targetGoal tracks the goal currently attacked by Home.
  const scoredForHome = (state.targetGoal === goalId);
  if (scoredForHome) state.scoreHome += 1;
  else state.scoreAway += 1;

  // Unconditional end flip: after any goal, target becomes the goal at the other end.
  state.targetGoal = oppositeGoal(state.targetGoal);

  // ARM THE CELEBRATION. A tick count, read by the scoreboards.
  state.celebrationTicks = TUNING.match.celebrationTicks;
  state.lastScoredFor = scoredForHome ? 'home' : 'away';
  state.lastGoalId = goalId;

  const event = {
    tick,
    goal: goalId,
    scoredFor: scoredForHome ? 'home' : 'away',
    newTarget: state.targetGoal,
    entrySide: hitInfo.entrySide,
    y: +hitInfo.y.toFixed(2),
    z: +hitInfo.z.toFixed(2),
  };
  state.events.push(event);

  console.log(
    `[GOAL] goal ${goalId} for ${event.scoredFor.toUpperCase()} ` +
      `(entered from ${hitInfo.entrySide > 0 ? 'east' : 'west'} at y ${event.y}, z ${event.z}) — ` +
      `score ${state.scoreHome} - ${state.scoreAway}, now attacking goal ${state.targetGoal}, tick ${tick}`,
  );
}

/** A read-only snapshot for the HUD and the console probe. LESSON 22 — a read. */
export function matchProbe(state) {
  const cdSec = Math.ceil(state.countdownTicksRemaining / 60);
  return {
    mode: state.mode,
    scoreHome: state.scoreHome,
    scoreAway: state.scoreAway,
    targetGoal: state.targetGoal,
    ticksRemaining: state.ticksRemaining,
    countdownTicksRemaining: state.countdownTicksRemaining,
    countdownSecondsRemaining: cdSec,
    isCountingDown: !!state.isCountingDown,
    matchOver: state.matchOver,
    celebrationTicks: state.celebrationTicks,
    lastScoredFor: state.lastScoredFor,
    lastGoalId: state.lastGoalId,
    goals: state.events.length,
  };
}
