import { TUNING } from '../config/tuning.js';

/**
 * SCORING — the goal hoops, the target end, and the match clock.
 *
 * A goal is a BALL CENTRE crossing the x = 0 plane inside a hoop's aperture.
 * That is a segment-vs-disc test between the ball's previous tick position and
 * its current one, which is the only formulation that survives a spiked ball:
 * at 22 m/s a ball moves 0.37 m per tick, so a test that asked "is the ball
 * inside the hoop right now" would miss the frame it was inside on roughly
 * every other shot. Nothing here is a trigger volume and nothing polls.
 *
 * LAW 1 — NOTHING HERE TOUCHES THE BALL. It reads translations and writes
 * integers. A goal does not stop, freeze, teleport or re-serve the ball; it
 * scores and the ball carries on with whatever momentum it had, which is what
 * makes the rebound goal below a real thing that can happen rather than a
 * special case somebody has to write.
 *
 * LAW 6 — no wall clock. The match clock is a tick counter, decremented once
 * per fixed step, so it runs at the same rate on every machine and pauses with
 * the simulation rather than with the frame rate.
 *
 * THE DIRECTORY RULE (src/mechanics/): no scheduler is named here. The clock is
 * `tick`, and the match clock is ticks.
 */

/** North and south, as the goal ids appear in the events and the HUD. */
const GOAL_N = 'N';
const GOAL_S = 'S';

/** The goal at the other end. One place, so no call site spells the flip out. */
function oppositeGoal(goalId) {
  return goalId === GOAL_N ? GOAL_S : GOAL_N;
}

/**
 * @returns {object} the match state for ONE match. Held by the caller, never a
 *   module singleton — the same reason the strike state is not one.
 */
export function createMatchState() {
  return {
    mode: TUNING.match.mode,
    scoreHome: 0,
    scoreAway: 0,
    /** 'N' | 'S'. The goal the home player is currently attacking. */
    targetGoal: GOAL_N,
    /** Remaining match ticks. 60 per second, counted down in the fixed step. */
    ticksRemaining: TUNING.match.durationSeconds * 60,
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
  const miss = { hit: false, entrySide: 0, y: 0, z: 0 };

  // STRICT ON ONE SIDE, INCLUSIVE ON THE OTHER, so a ball that lands exactly on
  // x = 0 is counted as having crossed once and not again on the way out.
  const crosses = (pPrev.x < 0 && pCurr.x >= 0) || (pPrev.x > 0 && pCurr.x <= 0);
  if (!crosses) return miss;

  const dx = pCurr.x - pPrev.x;
  if (Math.abs(dx) < 1e-6) return miss;

  const alpha = -pPrev.x / dx;
  const yInt = pPrev.y + alpha * (pCurr.y - pPrev.y);
  const zInt = pPrev.z + alpha * (pCurr.z - pPrev.z);

  const dy = yInt - hoopY;
  const dz = zInt - hoopZ;
  if (dy * dy + dz * dz > radius * radius) return miss;

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

  if (state.mode === 'match' && !state.matchOver && state.ticksRemaining > 0) {
    state.ticksRemaining -= 1;
    if (state.ticksRemaining === 0) {
      state.matchOver = true;
      console.log(`[match] FULL TIME — home ${state.scoreHome} - ${state.scoreAway} away`);
    }
  }

  const { hoopRadius, hoopCenterY, hoopNorthZ, hoopSouthZ, hoopRearmX } = TUNING.match;

  for (const b of balls) {
    const handle = b.collider.handle;
    const pos = b.body.translation();
    let tracker = state.ballTrackers.get(handle);

    if (!tracker) {
      // FIRST SIGHTING: record where it is and score nothing. There is no
      // previous position to draw a segment from, and inventing one at the
      // origin would fire a goal on the tick a ball spawns.
      state.ballTrackers.set(handle, {
        prevX: pos.x, prevY: pos.y, prevZ: pos.z, armedN: true, armedS: true,
      });
      continue;
    }

    const pPrev = { x: tracker.prevX, y: tracker.prevY, z: tracker.prevZ };

    // ═══ THE ARMING LATCH ═══
    //
    // A hoop is disarmed by scoring and re-armed ONLY by the ball getting clear
    // of the plane. That is the whole anti-jitter rule, and it has to be
    // distance rather than direction.
    //
    // WHY NOT "a repeat needs the opposite entry side": because alternating
    // sides is EXACTLY what jitter is. A ball resting in the goal mouth rocks
    // east, west, east, west across x = 0, and every one of those crossings
    // enters from the opposite side to the last — so a direction test scores
    // every single one of them. It permits precisely the pattern it is meant
    // to stop.
    //
    // AND THE BALL REALLY DOES REST THERE. Measured off the asset: the aperture
    // is centred at y 10.000 with a radius of 4.667, so it spans y 5.33 to
    // 14.67 — while the floor at the goal mouth sits at y 9.83. The bottom of
    // the ring is four and a half metres BELOW the ground. A ball rolling
    // gently across the goal line is inside the scoring disc, not under it.
    //
    // Distance re-arming costs nothing a real goal needs: a shot that goes
    // through and rebounds off the back wall travels metres clear before it
    // returns, so it re-arms and scores again, which is the rule.
    if (Math.abs(pos.x) > hoopRearmX) {
      tracker.armedN = true;
      tracker.armedS = true;
    }

    if (tracker.armedN) {
      const hitN = testHoopCrossing(pPrev, pos, hoopNorthZ, hoopCenterY, hoopRadius);
      if (hitN.hit) {
        tracker.armedN = false;
        recordGoal(state, GOAL_N, hitN, tick);
      }
    }
    if (tracker.armedS) {
      const hitS = testHoopCrossing(pPrev, pos, hoopSouthZ, hoopCenterY, hoopRadius);
      if (hitS.hit) {
        tracker.armedS = false;
        recordGoal(state, GOAL_S, hitS, tick);
      }
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
  const scoredForHome = state.targetGoal === goalId;
  if (scoredForHome) state.scoreHome += 1;
  else state.scoreAway += 1;

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
  return {
    mode: state.mode,
    scoreHome: state.scoreHome,
    scoreAway: state.scoreAway,
    targetGoal: state.targetGoal,
    ticksRemaining: state.ticksRemaining,
    matchOver: state.matchOver,
    celebrationTicks: state.celebrationTicks,
    lastScoredFor: state.lastScoredFor,
    lastGoalId: state.lastGoalId,
    goals: state.events.length,
  };
}
