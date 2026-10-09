/**
 * PLAYTEST TELEMETRY — zero-allocation event capture + a pure sport-metrics
 * reducer for headless auto-playtests.
 *
 * This module is the sport report behind the rebuild's auto-playtest harness.
 * It has two halves with different discipline:
 *
 *   1. RECORDER (in-tick). A fixed-size, preallocated pool of scalar event
 *      slots. `sampleUphill` and every `record*` helper write primitives into
 *      the next slot in place. No arrays, objects, closures, or THREE.Vector3
 *      are allocated on the simulation's hot path. Overflow is flagged, never
 *      thrown.
 *
 *   2. REDUCER (post-match). `serializeEvents` and `reduceSportReport` run once
 *      after the match, when allocation is free, and turn the raw event stream
 *      into the structured sport report. The reducer is a pure function of its
 *      inputs, so it is unit-testable on hand-built event fixtures.
 *
 * PARITY DISCLAIMER (mirrors the notice in headlessSim.js):
 *   This is a HEADLESS BOT PROXY, not the visual client's full motor, ghost or
 *   ragdoll simulation. Its numbers are diagnostic only. They cannot certify
 *   Law 1 parity, and they do not measure human play. Human playtests remain
 *   the final authority for feel.
 */

import { getCourtFloorY, isCourtFloorSampleAvailable } from '../ai/courtHeightmap.js';

export const PARITY_NOTICE =
  'HEADLESS BOT PROXY. Diagnostic numbers only. Not Law 1 parity, not a measure of human play.';

/**
 * Event type codes. Numeric in the pool for zero-alloc writes; decoded to
 * strings only during serialization.
 */
export const EV = {
  DROP: 0,
  HIT: 1,
  WHIFF: 2,
  GOAL: 3,
  RESPAWN: 4,
  CLOCK_END: 5,
};

/** Side codes. */
export const SIDE = { NONE: 0, HOME: 1, AWAY: 2 };

/** Strike-kind codes (matches headlessSim strike kinds: volley / spike / kick). */
export const STRIKE = { NONE: 0, VOLLEY: 1, SPIKE: 2, KICK: 3 };

/** Bot skill codes (the botController supports easy / medium / hard). */
export const SKILL = { NONE: 0, EASY: 1, MEDIUM: 2, HARD: 3 };

/** Goal-hoop codes. */
export const GOAL = { NONE: 0, NORTH: 1, SOUTH: 2 };

/** Decoders (shared by serializer and reducer). */
const EV_LABEL = ['drop', 'hit', 'whiff', 'goal', 'respawn', 'clockEnd'];
const SIDE_LABEL = { 0: null, 1: 'home', 2: 'away' };
const STRIKE_LABEL = { 0: null, 1: 'volley', 2: 'spike', 3: 'kick' };
const SKILL_LABEL = { 0: null, 1: 'easy', 2: 'medium', 3: 'hard' };
const GOAL_LABEL = { 0: null, 1: 'N', 2: 'S' };

export function skillCode(difficulty) {
  if (difficulty === 'easy') return SKILL.EASY;
  if (difficulty === 'medium') return SKILL.MEDIUM;
  if (difficulty === 'hard') return SKILL.HARD;
  return SKILL.NONE;
}

function sideCode(side) {
  if (side === 'home') return SIDE.HOME;
  if (side === 'away') return SIDE.AWAY;
  return SIDE.NONE;
}

function strikeCode(kind) {
  if (kind === 'volley') return STRIKE.VOLLEY;
  if (kind === 'spike') return STRIKE.SPIKE;
  if (kind === 'kick') return STRIKE.KICK;
  return STRIKE.NONE;
}

function goalCode(goalId) {
  if (goalId === 'N') return GOAL.NORTH;
  if (goalId === 'S') return GOAL.SOUTH;
  return GOAL.NONE;
}

/** Hoop z-positions. Keep in one place so direction math is auditable. */
export const HOOP_Z = { N: -40, S: 40 };

/** Quantize a float for stable, cross-process-identical digests. */
function q(n) {
  if (!Number.isFinite(n)) return 0;
  const v = Math.round(n * 10000) / 10000;
  return v === 0 ? 0 : v; // normalize -0 to 0
}

/**
 * One preallocated event slot. Every field is a primitive so writes in the
 * tick path never allocate. `seg*` fields hold the strike-segment (uphill)
 * summary finalized when this event closes a segment.
 */
function createEventSlot() {
  return {
    type: 0,
    tick: 0,
    phase: 0,
    side: 0,
    strikeType: 0,
    skill: 0,
    goal: 0,
    scoredFor: 0,
    lastHitSide: 0,
    x: 0, y: 0, z: 0,
    dirX: 0, dirZ: 0,
    quality: 0,
    segSide: 0,
    segStrikeTick: 0,
    segTargetGoal: 0,
    segUphillGain: 0,
    segProgress: 0,
    segUnavailable: 0,
    segSamples: 0,
  };
}

/**
 * Create a recorder with a fixed-capacity event pool and the scalar state for
 * phase + strike-segment tracking. All state is primitives; nothing here grows.
 */
export function createTelemetryRecorder({ capacity = 16384 } = {}) {
  const events = new Array(capacity);
  for (let i = 0; i < capacity; i++) events[i] = createEventSlot();
  return {
    events,
    capacity,
    count: 0,
    overflow: false,
    // phase state
    phaseIndex: 0,
    phaseStartTick: 0,
    lastHitSide: SIDE.NONE,
    // strike-segment (uphill) state
    segActive: false,
    segSide: SIDE.NONE,
    segStrikeTick: 0,
    segStrikeFloorY: 0,
    segTargetGoal: GOAL.NONE,
    segStartX: 0,
    segStartZ: 0,
    segDirX: 0,
    segDirZ: 0,
    segMaxFloorY: -Infinity,
    segSamples: 0,
    segUnavailable: 0,
  };
}

/** Reserve the next slot, writing type/tick/phase. Returns the slot or null on overflow. */
function nextSlot(tel, type, tick) {
  if (tel.overflow || tel.count >= tel.capacity) {
    tel.overflow = true;
    return null;
  }
  const e = tel.events[tel.count++];
  e.type = type;
  e.tick = tick;
  e.phase = tel.phaseIndex;
  e.side = SIDE.NONE;
  e.strikeType = STRIKE.NONE;
  e.skill = SKILL.NONE;
  e.goal = GOAL.NONE;
  e.scoredFor = SIDE.NONE;
  e.lastHitSide = SIDE.NONE;
  e.x = 0; e.y = 0; e.z = 0;
  e.dirX = 0; e.dirZ = 0;
  e.quality = 0;
  e.segSide = SIDE.NONE;
  e.segStrikeTick = 0;
  e.segTargetGoal = GOAL.NONE;
  e.segUphillGain = 0;
  e.segProgress = 0;
  e.segUnavailable = 0;
  e.segSamples = 0;
  return e;
}

/** Finalize the active strike-segment (if any) into a closing event slot. */
function closeSegmentInto(tel, e, finalX, finalZ) {
  if (!tel.segActive) return;
  if (tel.segSamples > 0) {
    e.segUphillGain = q(tel.segMaxFloorY - tel.segStrikeFloorY);
  } else {
    e.segUphillGain = 0;
  }
  // Signed horizontal travel toward the attacking hoop captured at strike time.
  e.segProgress = q((finalX - tel.segStartX) * tel.segDirX + (finalZ - tel.segStartZ) * tel.segDirZ);
  e.segSide = tel.segSide;
  e.segStrikeTick = tel.segStrikeTick;
  e.segTargetGoal = tel.segTargetGoal;
  e.segUnavailable = tel.segUnavailable;
  e.segSamples = tel.segSamples;
  tel.segActive = false;
}

/** Start a strike-segment at a landed strike. Direction is captured BEFORE any goal switch. */
function openSegment(tel, side, tick, x, z, targetGoalCode) {
  tel.segActive = true;
  tel.segSide = side;
  tel.segStrikeTick = tick;
  tel.segTargetGoal = targetGoalCode;
  tel.segStrikeFloorY = getCourtFloorY(x, z);
  tel.segStartX = x;
  tel.segStartZ = z;
  tel.segMaxFloorY = -Infinity;
  tel.segSamples = 0;
  tel.segUnavailable = 0;
  const gz = targetGoalCode === GOAL.NORTH ? HOOP_Z.N : (targetGoalCode === GOAL.SOUTH ? HOOP_Z.S : 0);
  const dx = 0 - x; // hoop center x = 0
  const dz = gz - z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    tel.segDirX = 0;
    tel.segDirZ = 0;
  } else {
    tel.segDirX = dx / len;
    tel.segDirZ = dz / len;
  }
}

/** Per-tick floor sampling for the active segment. Called once per tick after the physics step. */
export function sampleUphill(tel, x, z) {
  if (!tel.segActive) return;
  if (isCourtFloorSampleAvailable(x, z)) {
    const fy = getCourtFloorY(x, z);
    if (fy > tel.segMaxFloorY) tel.segMaxFloorY = fy;
    tel.segSamples += 1;
  } else {
    tel.segUnavailable += 1;
  }
}

/** Initial drop (phase 0) and every goal/respawn re-drop (a new phase). */
export function recordDrop(tel, tick) {
  const e = nextSlot(tel, EV.DROP, tick);
  if (!e) return;
  tel.phaseStartTick = tick;
}

/**
 * Advance to the next phase after a goal/respawn closes the current one.
 * Called between the goal/respawn event and its re-drop, so the new drop and
 * everything after it carry the next phase label.
 */
export function advancePhase(tel) {
  tel.phaseIndex += 1;
  tel.lastHitSide = SIDE.NONE;
}

/** A landed strike. Closes the prior segment, records the hit, opens the new segment. */
export function recordHit(tel, tick, side, kind, skill, x, y, z, dirX, dirZ, quality, targetGoal) {
  const e = nextSlot(tel, EV.HIT, tick);
  if (!e) return;
  closeSegmentInto(tel, e, x, z);
  e.side = sideCode(side);
  e.strikeType = strikeCode(kind);
  e.skill = skillCode(skill);
  e.x = q(x); e.y = q(y); e.z = q(z);
  e.dirX = q(dirX); e.dirZ = q(dirZ);
  e.quality = q(quality);
  // Possession bookkeeping is derived by the reducer from the hit sequence, so
  // only the per-phase last-hit side needs to be remembered here.
  tel.lastHitSide = e.side;
  openSegment(tel, e.side, tick, x, z, goalCode(targetGoal));
}

/** An expired strike window (whiff). No new segment; the prior segment stays open. */
export function recordWhiff(tel, tick, side, skill, x, y, z) {
  const e = nextSlot(tel, EV.WHIFF, tick);
  if (!e) return;
  e.side = sideCode(side);
  e.skill = skillCode(skill);
  e.x = q(x); e.y = q(y); e.z = q(z);
}

/** A goal. Closes the phase's final segment and stamps the per-phase last-hit side. */
export function recordGoal(tel, tick, goalId, scoredFor) {
  const e = nextSlot(tel, EV.GOAL, tick);
  if (!e) return;
  const gz = goalId === 'N' ? HOOP_Z.N : HOOP_Z.S;
  closeSegmentInto(tel, e, 0, gz);
  e.goal = goalCode(goalId);
  e.scoredFor = sideCode(scoredFor);
  e.lastHitSide = tel.lastHitSide;
}

/** Kill-plane / out-of-bounds respawn. Closes the final segment; no goal. */
export function recordRespawn(tel, tick, x, y, z) {
  const e = nextSlot(tel, EV.RESPAWN, tick);
  if (!e) return;
  closeSegmentInto(tel, e, x, z);
  e.x = q(x); e.y = q(y); e.z = q(z);
}

/** Match-clock end. Closes the final phase's segment. */
export function recordClockEnd(tel, tick) {
  const e = nextSlot(tel, EV.CLOCK_END, tick);
  if (!e) return;
  closeSegmentInto(tel, e, 0, 0);
}

/**
 * Serialize the raw pool into plain JSON-safe event objects with string enums.
 * Runs once, post-match, where allocation is free.
 */
export function serializeEvents(tel) {
  const out = new Array(tel.count);
  for (let i = 0; i < tel.count; i++) {
    const s = tel.events[i];
    out[i] = {
      type: EV_LABEL[s.type] || 'unknown',
      tick: s.tick,
      phase: s.phase,
      side: SIDE_LABEL[s.side] ?? null,
      strikeType: s.strikeType ? STRIKE_LABEL[s.strikeType] : null,
      skill: s.skill ? SKILL_LABEL[s.skill] : null,
      goal: s.goal ? GOAL_LABEL[s.goal] : null,
      scoredFor: s.scoredFor ? SIDE_LABEL[s.scoredFor] : null,
      lastHitSide: s.lastHitSide ? SIDE_LABEL[s.lastHitSide] : null,
      x: s.x, y: s.y, z: s.z,
      dirX: s.dirX, dirZ: s.dirZ,
      quality: s.quality,
      seg: s.segSide
        ? {
            side: SIDE_LABEL[s.segSide],
            strikeTick: s.segStrikeTick,
            targetGoal: GOAL_LABEL[s.segTargetGoal],
            uphillGain: s.segUphillGain,
            progress: s.segProgress,
            unavailable: s.segUnavailable,
            samples: s.segSamples,
          }
        : null,
    };
  }
  return out;
}

function median(sortedInts) {
  if (!sortedInts.length) return null;
  const mid = sortedInts.length >> 1;
  if (sortedInts.length % 2 === 0) return (sortedInts[mid - 1] + sortedInts[mid]) / 2;
  return sortedInts[mid];
}

function percentile(sortedInts, p) {
  if (!sortedInts.length) return null;
  const idx = Math.min(sortedInts.length - 1, Math.floor((p / 100) * sortedInts.length));
  return sortedInts[idx];
}

/** Default duration histogram edges in ticks. Overridable via meta.histogramEdges. */
const DEFAULT_EDGES = [0, 30, 60, 120, 240, 480, 960];

function histogram(sortedValues, edges) {
  const bins = [];
  for (let i = 0; i < edges.length - 1; i++) bins.push({ from: edges[i], to: edges[i + 1], count: 0 });
  bins.push({ from: edges[edges.length - 1], to: null, count: 0 }); // overflow bin
  for (const v of sortedValues) {
    let placed = false;
    for (let i = 0; i < edges.length - 1; i++) {
      if (v >= edges[i] && v < edges[i + 1]) { bins[i].count += 1; placed = true; break; }
    }
    if (!placed) bins[bins.length - 1].count += 1;
  }
  return bins;
}

/**
 * The pure sport-metrics reducer. Given a serialized event stream and match
 * metadata, it returns the sport report with stable key order (so two runs can
 * be compared by a wholesale JSON digest).
 *
 * @param {Array} events  serialized event objects (strings + numbers)
 * @param {object} meta   { durationTicks, ballId, homeSkill, awaySkill, seedA, seedB, histogramEdges }
 */
export function reduceSportReport(events, meta = {}) {
  const edges = meta.histogramEdges || DEFAULT_EDGES;

  // ── Phase parsing ──
  const phases = [];
  let cur = null;
  for (const ev of events) {
    if (ev.type === 'drop') {
      cur = { startTick: ev.tick, endTick: null, endType: null, hits: [], goal: null };
      phases.push(cur);
    } else if (ev.type === 'hit') {
      if (cur) cur.hits.push(ev);
    } else if (ev.type === 'goal') {
      if (cur) { cur.endTick = ev.tick; cur.endType = 'goal'; cur.goal = ev; cur = null; }
    } else if (ev.type === 'respawn') {
      if (cur) { cur.endTick = ev.tick; cur.endType = 'respawn'; cur = null; }
    } else if (ev.type === 'clockEnd') {
      if (cur) { cur.endTick = ev.tick; cur.endType = 'clock'; cur = null; }
    }
  }

  // ── Rally cadence ──
  const completed = phases.filter((p) => p.hits.length > 0 && p.endType !== 'clock');
  const censored = phases.filter((p) => p.endType === 'clock');
  const dead = phases.filter((p) => p.hits.length === 0);
  const durations = completed.map((p) => p.endTick - p.startTick).sort((a, b) => a - b);
  const sumDur = durations.reduce((a, b) => a + b, 0);

  // Longest dead interval: max consecutive ticks with no landed strike, across
  // the whole match (leading gap from tick 0, gaps between hits, trailing gap).
  const hitTicks = phases.flatMap((p) => p.hits.map((h) => h.tick)).sort((a, b) => a - b);
  let longestDead = 0;
  let prev = 0;
  for (const t of hitTicks) {
    const gap = t - prev - 1;
    if (gap > longestDead) longestDead = gap;
    prev = t;
  }
  const trailingGap = (meta.durationTicks || 0) - prev;
  if (trailingGap > longestDead) longestDead = trailingGap;

  // ── Touches / possession ──
  let totalStrikes = 0;
  let possessions = 0;
  let contestedCount = 0;
  let activeCount = 0; // phases with >= 1 hit
  const possessionTouches = [];
  for (const p of phases) {
    if (p.hits.length === 0) continue;
    activeCount += 1;
    const sides = new Set(p.hits.map((h) => h.side));
    if (sides.size > 1) contestedCount += 1;
    let runSide = null;
    let runLen = 0;
    for (const h of p.hits) {
      totalStrikes += 1;
      if (h.side === runSide) {
        runLen += 1;
      } else {
        if (runSide !== null) possessionTouches.push(runLen);
        runSide = h.side;
        runLen = 1;
        possessions += 1;
      }
    }
    if (runSide !== null) possessionTouches.push(runLen);
  }

  // ── Goals ──
  let goalsHome = 0;
  let goalsAway = 0;
  let goalsAfterZeroStrikes = 0;
  let ownGoalsHome = 0;
  let ownGoalsAway = 0;
  for (const ev of events) {
    if (ev.type !== 'goal') continue;
    if (ev.scoredFor === 'home') goalsHome += 1; else if (ev.scoredFor === 'away') goalsAway += 1;
    if (!ev.lastHitSide) goalsAfterZeroStrikes += 1;
    else if (ev.lastHitSide !== ev.scoredFor) {
      // The last hitter's side conceded an own goal (put the ball in its own hoop).
      if (ev.lastHitSide === 'home') ownGoalsHome += 1;
      else if (ev.lastHitSide === 'away') ownGoalsAway += 1;
    }
  }
  const goalsTotal = goalsHome + goalsAway;
  const playsMinutes = meta.durationTicks ? meta.durationTicks / 3600 : 0;

  // ── Uphill progression ──
  let struckPossessions = 0;
  let gainTotal = 0;
  let gainPositiveCount = 0;
  let gainAvailable = 0;
  let progressTotal = 0;
  let unavailableSegments = 0;
  let unavailableSamples = 0;
  for (const ev of events) {
    if (!ev.seg) continue;
    struckPossessions += 1;
    progressTotal += ev.seg.progress || 0;
    unavailableSamples += ev.seg.unavailable || 0;
    if (ev.seg.samples > 0) {
      gainTotal += ev.seg.uphillGain || 0;
      gainAvailable += 1;
      if ((ev.seg.uphillGain || 0) > 0) gainPositiveCount += 1;
    } else {
      unavailableSegments += 1;
    }
  }

  // ── Whiffs ──
  let resolvedAttempts = 0;
  let whiffs = 0;
  const bySkill = { easy: { whiffs: 0, resolved: 0 }, medium: { whiffs: 0, resolved: 0 }, hard: { whiffs: 0, resolved: 0 } };
  for (const ev of events) {
    if (ev.type === 'hit') {
      resolvedAttempts += 1;
    } else if (ev.type === 'whiff') {
      whiffs += 1;
      resolvedAttempts += 1; // resolved = landed + whiffs (spec denominator)
      if (ev.skill && bySkill[ev.skill]) bySkill[ev.skill].whiffs += 1;
    }
    if ((ev.type === 'hit' || ev.type === 'whiff') && ev.skill && bySkill[ev.skill]) {
      bySkill[ev.skill].resolved += 1;
    }
  }
  // Spec: zero denominators yield null (reported upstream as insufficient_data),
  // never a fake 0%.
  const rateFor = (w, r) => (r > 0 ? q(w / r) : null);

  return {
    version: 1,
    parity: PARITY_NOTICE,
    meta: {
      durationTicks: meta.durationTicks || 0,
      ballId: meta.ballId || null,
      homeSkill: meta.homeSkill || null,
      awaySkill: meta.awaySkill || null,
      seedA: meta.seedA ?? null,
      seedB: meta.seedB ?? null,
      eventOverflow: !!meta.eventOverflow,
    },
    summary: {
      phases: {
        total: phases.length,
        completed: completed.length,
        censored: censored.length,
        dead: dead.length,
        contested: contestedCount,
        longestDeadIntervalTicks: longestDead,
      },
      rally: {
        durationsTicks: durations,
        count: durations.length,
        median: durations.length ? q(median(durations)) : null,
        p10: percentile(durations, 10),
        p90: percentile(durations, 90),
        mean: durations.length ? q(sumDur / durations.length) : null,
        histogram: histogram(durations, edges),
      },
      touches: {
        totalStrikes,
        possessions,
        possessionTouches,
        touchesPerPossessionMean: possessions ? q(totalStrikes / possessions) : null,
        contestedShare: activeCount ? q(contestedCount / activeCount) : null,
        sameSideTouchShare: totalStrikes ? q((totalStrikes - possessions) / totalStrikes) : null,
      },
      goals: {
        home: goalsHome,
        away: goalsAway,
        total: goalsTotal,
        perMinute: playsMinutes ? q(goalsTotal / playsMinutes) : null,
        afterZeroStrikes: goalsAfterZeroStrikes,
        ownGoalsHome,
        ownGoalsAway,
      },
      uphill: {
        struckPossessions,
        gainTotalMeters: q(gainTotal),
        positiveGainShare: gainAvailable ? q(gainPositiveCount / gainAvailable) : null,
        progressTotalMeters: q(progressTotal),
        unavailableSegments,
        unavailableSamples,
      },
      whiffs: {
        resolvedAttempts,
        whiffs,
        whiffRate: rateFor(whiffs, resolvedAttempts),
        bySkill: {
          easy: { whiffs: bySkill.easy.whiffs, resolved: bySkill.easy.resolved, whiffRate: rateFor(bySkill.easy.whiffs, bySkill.easy.resolved) },
          medium: { whiffs: bySkill.medium.whiffs, resolved: bySkill.medium.resolved, whiffRate: rateFor(bySkill.medium.whiffs, bySkill.medium.resolved) },
          hard: { whiffs: bySkill.hard.whiffs, resolved: bySkill.hard.resolved, whiffRate: rateFor(bySkill.hard.whiffs, bySkill.hard.resolved) },
        },
      },
    },
  };
}

/**
 * The full deterministic telemetry document for a finished match: metadata,
 * the sport report, and the bounded event stream. Stable key order, so two
 * runs can be compared byte-for-byte (after JSON.stringify).
 */
export function buildTelemetryDoc(tel, meta = {}) {
  const events = serializeEvents(tel);
  const metaFull = {
    ...meta,
    eventOverflow: tel.overflow,
  };
  const report = reduceSportReport(events, metaFull);
  return {
    schemaVersion: 1,
    parity: PARITY_NOTICE,
    meta: metaFull,
    report,
    events,
  };
}