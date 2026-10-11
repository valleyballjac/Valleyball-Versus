/**
 * Unit fixtures for the playtest telemetry reducer (spec: team/specs/auto-playtest.md,
 * "Test scripted event sequences for zero-hit drops, same-side repeats, opposing
 * hit, goal/end inversion, whiff exactly once, respawn reset, clock-censored
 * rally, height missing and buffer overflow").
 *
 * Pure reducer tests use hand-built serialized event streams. Recorder tests
 * exercise the preallocated pool + segment math end to end (the recorder is
 * zero-alloc per tick; the one-time pool at creation is excluded from that
 * claim - see scripts/checkTelemetry.mjs for the measured allocation harness).
 *
 * Run: npm run test  (node --test test/)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTelemetryRecorder,
  recordDrop,
  recordHit,
  recordWhiff,
  recordGoal,
  recordRespawn,
  recordClockEnd,
  advancePhase,
  sampleUphill,
  serializeEvents,
  reduceSportReport,
  buildTelemetryDoc,
  assertTelemetryReportable,
  skillCode,
  PARITY_NOTICE,
  SKILL,
} from '../src/sim/playtestTelemetry.js';
import { isCourtFloorSampleAvailable, getCourtFloorY } from '../src/ai/courtHeightmap.js';

// ── Hand-built serialized-event helpers (post-serialize string form) ──
const drop = (tick, phase = 0) => ({ type: 'drop', tick, phase });
const hit = (tick, side, { skill = 'medium', seg = null, phase = 0 } = {}) => ({
  type: 'hit', tick, phase, side, strikeType: 'volley', skill,
  goal: null, scoredFor: null, lastHitSide: null,
  x: 0, y: 0, z: 0, dirX: 0, dirZ: 0, quality: 1, seg,
});
const whiff = (tick, side, skill = 'easy') => ({
  type: 'whiff', tick, phase: 0, side, strikeType: null, skill,
  goal: null, scoredFor: null, lastHitSide: null,
  x: 0, y: 0, z: 0, dirX: 0, dirZ: 0, quality: 0, seg: null,
});
const goal = (tick, scoredFor, lastHitSide, goalId = 'N') => ({
  type: 'goal', tick, phase: 0, side: null, strikeType: null, skill: null,
  goal: goalId, scoredFor, lastHitSide,
  x: 0, y: 0, z: 0, dirX: 0, dirZ: 0, quality: 0, seg: null,
});
const respawn = (tick) => ({ type: 'respawn', tick, phase: 0, side: null, strikeType: null, skill: null, goal: null, scoredFor: null, lastHitSide: null, x: 0, y: 0, z: 0, dirX: 0, dirZ: 0, quality: 0, seg: null });
const clockEnd = (tick) => ({ type: 'clockEnd', tick, phase: 0, side: null, strikeType: null, skill: null, goal: null, scoredFor: null, lastHitSide: null, x: 0, y: 0, z: 0, dirX: 0, dirZ: 0, quality: 0, seg: null });
// Fixtures for the PUBLIC reducer must supply VERIFIED court metadata: the
// exported reduceSportReport fails closed without courtLoaded === true.
const META = { durationTicks: 600, courtLoaded: true };
const META_UNVERIFIED = { durationTicks: 600 }; // no courtLoaded: must fail closed
const META_OK = { ...META, courtLoaded: true };

/** A point on the baked heightmap (scan finds one; center is expected). */
function onCourtPoint() {
  for (const x of [0, 1, 2, 5]) {
    for (const z of [0, 1, 2, 5, 10]) {
      if (isCourtFloorSampleAvailable(x, z)) return { x, z };
    }
  }
  throw new Error('no on-court heightmap sample found');
}

/** An off-court point where the heightmap has no sample. */
function offCourtPoint() {
  for (const x of [500, 1000, 5000]) {
    if (!isCourtFloorSampleAvailable(x, 0)) return { x, z: 0 };
  }
  throw new Error('expected off-court samples to be unavailable');
}

test('empty stream: zero denominators yield null, not 0%', () => {
  const r = reduceSportReport([], META);
  assert.equal(r.parity, PARITY_NOTICE);
  assert.equal(r.summary.phases.total, 0);
  assert.equal(r.summary.rally.median, null);
  assert.equal(r.summary.rally.mean, null);
  assert.equal(r.summary.rally.p10, null);
  assert.equal(r.summary.rally.p90, null);
  assert.equal(r.summary.touches.possessions, 0);
  assert.equal(r.summary.touches.touchesPerPossessionMean, null);
  assert.equal(r.summary.touches.contestedShare, null);
  assert.equal(r.summary.goals.perMinute, 0); // 0 goals over real exposure is 0, not null
  assert.equal(reduceSportReport([], { courtLoaded: true }).summary.goals.perMinute, null); // no exposure: null
  assert.equal(r.summary.whiffs.whiffRate, null);
  assert.equal(r.summary.whiffs.bySkill.hard.whiffRate, null);
  assert.equal(r.summary.uphill.positiveGainShare, null);
});

test('zero-hit drop: dead phase, censored at clock, no rally', () => {
  const r = reduceSportReport([drop(0), clockEnd(600)], META).summary;
  assert.equal(r.phases.total, 1);
  assert.equal(r.phases.dead, 1);
  assert.equal(r.phases.completed, 0);
  assert.equal(r.phases.censored, 1);
  assert.equal(r.rally.count, 0);
  assert.equal(r.phases.longestDeadIntervalTicks, 600);
});

test('same-side repeats: one possession, three touches, not contested', () => {
  const r = reduceSportReport([
    drop(0), hit(10, 'home'), hit(20, 'home'), hit(30, 'home'), goal(40, 'home', 'home'),
  ], META).summary;
  assert.equal(r.touches.totalStrikes, 3);
  assert.equal(r.touches.possessions, 1);
  assert.deepEqual(r.touches.possessionTouches, [3]);
  assert.equal(r.touches.touchesPerPossessionMean, 3);
  assert.equal(r.touches.sameSideTouchShare, 0.6667);
  assert.equal(r.phases.contested, 0);
  assert.equal(r.touches.contestedShare, 0);
  assert.equal(r.goals.home, 1);
  assert.equal(r.goals.ownGoalsHome, 0);
  assert.equal(r.phases.completed, 1);
  assert.deepEqual(r.rally.durationsTicks, [40]);
});

test('opposing hits: three possessions, contested rally', () => {
  const r = reduceSportReport([
    drop(0), hit(10, 'home'), hit(20, 'away'), hit(30, 'home'), goal(40, 'home', 'home'),
  ], META).summary;
  assert.equal(r.touches.possessions, 3);
  assert.deepEqual(r.touches.possessionTouches, [1, 1, 1]);
  assert.equal(r.phases.contested, 1);
  assert.equal(r.touches.contestedShare, 1);
});

test('goal/end inversion: own goal attributed to last hitter side', () => {
  const r = reduceSportReport([
    drop(0), hit(10, 'home'), goal(20, 'away', 'home'),
  ], META).summary;
  assert.equal(r.goals.away, 1);
  assert.equal(r.goals.home, 0);
  assert.equal(r.goals.ownGoalsHome, 1);
  assert.equal(r.goals.ownGoalsAway, 0);
  assert.equal(r.goals.afterZeroStrikes, 0);
});

test('goal after zero strikes stays visible', () => {
  const r = reduceSportReport([drop(0), goal(5, 'home', null)], META).summary;
  assert.equal(r.goals.afterZeroStrikes, 1);
  assert.equal(r.phases.dead, 1);
});

test('whiff counted exactly once; rate = whiffs / (landed + whiffs)', () => {
  const r = reduceSportReport([
    drop(0), whiff(10, 'home', 'easy'), hit(20, 'home', { skill: 'easy' }), goal(30, 'home', 'home'),
  ], META).summary;
  assert.equal(r.whiffs.whiffs, 1);
  assert.equal(r.whiffs.resolvedAttempts, 2);
  assert.equal(r.whiffs.whiffRate, 0.5);
  assert.deepEqual(r.whiffs.bySkill.easy, { whiffs: 1, resolved: 2, whiffRate: 0.5 });
  assert.equal(r.whiffs.bySkill.hard.resolved, 0);
  assert.equal(r.whiffs.bySkill.hard.whiffRate, null);
});

test('respawn resets phase and possession tracking', () => {
  const r = reduceSportReport([
    drop(0), hit(10, 'home'), respawn(20), drop(21), hit(30, 'away'), clockEnd(600),
  ], META).summary;
  assert.equal(r.phases.total, 2);
  assert.equal(r.phases.completed, 1); // respawn-ended phase with a hit
  assert.equal(r.phases.censored, 1);   // clock-ended phase
  assert.equal(r.touches.possessions, 2); // one per phase, sides never merge
  assert.equal(r.phases.contested, 0);
  assert.deepEqual(r.rally.durationsTicks, [20]);
});

test('clock-censored rally excluded from durations but counted as exposure', () => {
  const r = reduceSportReport([
    drop(0), hit(10, 'home'), hit(500, 'away'), clockEnd(600),
  ], META).summary;
  assert.equal(r.rally.count, 0);
  assert.equal(r.phases.censored, 1);
  assert.equal(r.phases.completed, 0);
});

test('rally cadence math: median, p10, p90, histogram bins', () => {
  // Four completed rallies of durations 10, 20, 30, 40.
  const events = [];
  let t = 0;
  for (const d of [10, 20, 30, 40]) {
    events.push(drop(t));
    events.push(hit(t + 1, 'home'));
    events.push(goal(t + d, 'home', 'home'));
    t += d + 1;
  }
  const r = reduceSportReport(events, { durationTicks: t, courtLoaded: true }).summary;
  assert.deepEqual(r.rally.durationsTicks, [10, 20, 30, 40]);
  assert.equal(r.rally.median, 25);
  assert.equal(r.rally.p10, 10);
  assert.equal(r.rally.p90, 40);
  assert.equal(r.rally.mean, 25);
  const b0 = r.rally.histogram.find((b) => b.from === 0 && b.to === 30);
  const b1 = r.rally.histogram.find((b) => b.from === 30 && b.to === 60);
  assert.equal(b0.count, 2);
  assert.equal(b1.count, 2);
});

test('longest dead interval spans leading, interior and trailing gaps', () => {
  const r = reduceSportReport([drop(0), hit(100, 'home'), clockEnd(600)], META).summary;
  // leading gap 0..99 = 99 ticks, trailing 600-100 = 500 ticks
  assert.equal(r.phases.longestDeadIntervalTicks, 500);
});

test('missing height samples: unavailable, never treated as zero gain', () => {
  const seg = { side: 'home', strikeTick: 10, targetGoal: 'N', uphillGain: 0, progress: 0, unavailable: 5, samples: 0 };
  const r = reduceSportReport([
    drop(0), hit(10, 'home', { seg }), clockEnd(600),
  ], META).summary;
  assert.equal(r.uphill.struckPossessions, 1);
  assert.equal(r.uphill.unavailableSegments, 1);
  assert.equal(r.uphill.unavailableSamples, 5);
  assert.equal(r.uphill.gainTotalMeters, 0);
  assert.equal(r.uphill.positiveGainShare, null); // no available segment
});

test('uphill gain and progress aggregate over available segments; negative gain clamped at the boundary', () => {
  const segA = { side: 'home', strikeTick: 10, targetGoal: 'N', uphillGain: 1.5, progress: 3, unavailable: 0, samples: 20 };
  const segB = { side: 'away', strikeTick: 30, targetGoal: 'S', uphillGain: -0.5, progress: 2, unavailable: 0, samples: 10 };
  const r = reduceSportReport([
    drop(0), hit(10, 'home', { seg: segA }), hit(30, 'away', { seg: segB }), clockEnd(600),
  ], META).summary;
  assert.equal(r.uphill.struckPossessions, 2);
  // segB's negative (hand-built) gain is CLAMPED to 0 at the reducer boundary:
  // a descent can never subtract from the aggregate rise. 1.5 + 0 = 1.5.
  assert.equal(r.uphill.gainTotalMeters, 1.5);
  assert.equal(r.uphill.positiveGainShare, 0.5); // segB clamped to 0: not positive
  assert.equal(r.uphill.progressTotalMeters, 5);
});

test('reducer boundary: a solely negative gain yields 0 total, 0 positive share', () => {
  const seg = { side: 'home', strikeTick: 10, targetGoal: 'N', uphillGain: -2, progress: 1, unavailable: 0, samples: 5 };
  const r = reduceSportReport([drop(0), hit(10, 'home', { seg }), clockEnd(600)], META).summary;
  assert.equal(r.uphill.gainTotalMeters, 0);
  assert.equal(r.uphill.positiveGainShare, 0);
  assert.equal(r.uphill.unavailableSegments, 0); // available, just clamped
});

// ── Recorder-level fixtures ──

test('buffer overflow flags the run invalid and fails the doc closed', () => {
  const tel = createTelemetryRecorder({ capacity: 2 });
  recordDrop(tel, 0);
  recordHit(tel, 10, 'home', 'volley', 'easy', 0, 1, 5, 0, -1, 1, 'N');
  recordWhiff(tel, 20, 'away', 'hard', 0, 1, -5); // overflow here
  assert.equal(tel.count, 2);
  assert.equal(tel.overflow, true);
  // Overflowed runs must never produce report bytes, even from a loaded court.
  assert.throws(() => buildTelemetryDoc(tel, META_OK), /overflow/i);
});

test('fail closed: fallback court (courtLoaded !== true) produces no doc', () => {
  const build = () => {
    const tel = createTelemetryRecorder({ capacity: 16 });
    recordDrop(tel, 0);
    recordClockEnd(tel, 600, 0, 10); // explicit real endpoint, never a default
    return tel;
  };
  assert.throws(() => assertTelemetryReportable(false, build()), /fallback|court/i);
  assert.throws(() => assertTelemetryReportable(undefined, build()), /fallback|court/i);
  assert.throws(() => buildTelemetryDoc(build(), META_UNVERIFIED), /fallback|court/i); // no courtLoaded flag
  assert.doesNotThrow(() => assertTelemetryReportable(true, build()));
});

test('fail closed: the EXPORTED reducer itself refuses unverified or overflowed metadata', () => {
  const events = [drop(0), clockEnd(600)];
  // Direct public-reducer use without verified court metadata must throw.
  assert.throws(() => reduceSportReport(events, META_UNVERIFIED), /fallback|court/i);
  assert.throws(() => reduceSportReport(events, { durationTicks: 600, courtLoaded: false }), /fallback|court/i);
  // Overflowed stream must throw even with a verified court.
  assert.throws(
    () => reduceSportReport(events, { durationTicks: 600, courtLoaded: true, eventOverflow: true }),
    /overflow/i,
  );
  // Verified, non-overflowed metadata passes.
  assert.doesNotThrow(() => reduceSportReport(events, META));
});

test('recordClockEnd requires an actual finite endpoint (no (0,0) default)', () => {
  const tel = createTelemetryRecorder({ capacity: 16 });
  recordDrop(tel, 0);
  assert.throws(() => recordClockEnd(tel, 600), /endpoint/i);
  assert.throws(() => recordClockEnd(tel, 600, NaN, 5), /endpoint/i);
  assert.throws(() => recordClockEnd(tel, 600, 1, undefined), /endpoint/i);
  assert.equal(tel.count, 1); // nothing recorded by the rejected calls
  assert.doesNotThrow(() => recordClockEnd(tel, 600, 2, -7));
  const ev = serializeEvents(tel).find((e) => e.type === 'clockEnd');
  assert.equal(ev.x, 2);
  assert.equal(ev.z, -7);
});

test('recorder round-trip: labels, skill mapping, phase advance on goal', () => {
  const tel = createTelemetryRecorder({ capacity: 64 });
  recordDrop(tel, 0);
  recordHit(tel, 10, 'home', 'spike', 'hard', 1, 2, 3, 0, -1, 0.9, 'N');
  recordWhiff(tel, 15, 'away', 'easy', 2, 1, -4);
  recordGoal(tel, 20, 'N', 'home');
  advancePhase(tel);
  recordDrop(tel, 21);
  recordClockEnd(tel, 600, 3, -8); // explicit endpoint (required; no defaults)
  const events = serializeEvents(tel);
  assert.deepEqual(events.map((e) => e.type), ['drop', 'hit', 'whiff', 'goal', 'drop', 'clockEnd']);
  const h = events[1];
  assert.equal(h.side, 'home');
  assert.equal(h.strikeType, 'spike');
  assert.equal(h.skill, 'hard');
  assert.equal(h.quality, 0.9);
  assert.equal(events[2].skill, 'easy');
  assert.equal(events[3].scoredFor, 'home');
  assert.equal(events[3].lastHitSide, 'home');
  assert.equal(events[4].phase, 1);
  assert.equal(skillCode('medium'), SKILL.MEDIUM);
});

test('height unavailable off-court: segment records unavailable samples, not zeros', () => {
  const off = offCourtPoint();
  const tel = createTelemetryRecorder({ capacity: 64 });
  recordDrop(tel, 0);
  recordHit(tel, 10, 'home', 'volley', 'medium', off.x, 1, off.z, 1, 0, 1, 'N');
  sampleUphill(tel, off.x, off.z);
  sampleUphill(tel, off.x, off.z);
  recordClockEnd(tel, 600, off.x, off.z);
  const events = serializeEvents(tel);
  const closing = events.find((e) => e.seg);
  assert.ok(closing, 'clockEnd should carry the closed segment');
  assert.equal(closing.seg.samples, 0);
  assert.equal(closing.seg.unavailable, 2);
  assert.equal(closing.seg.originUnavailable, true); // strike origin is off-court too
});

test('strike origin off-court: segment flagged, real samples cannot fabricate a rise', () => {
  const off = offCourtPoint();
  const on = onCourtPoint();
  const tel = createTelemetryRecorder({ capacity: 64 });
  recordDrop(tel, 0);
  // Strike from OFF the heightmap, then sample ON it. Without the origin
  // availability check, the clamped edge value at the origin could invent a
  // rise (or a fall) against real on-court samples.
  recordHit(tel, 10, 'home', 'volley', 'medium', off.x, 1, off.z, 0, -1, 1, 'N');
  sampleUphill(tel, on.x, on.z);
  sampleUphill(tel, on.x, on.z);
  recordClockEnd(tel, 600, on.x, on.z);
  const closing = serializeEvents(tel).find((e) => e.seg);
  assert.equal(closing.seg.originUnavailable, true);
  assert.equal(closing.seg.samples, 2);
  assert.equal(closing.seg.uphillGain, 0); // suppressed, not fabricated
  // Reducer must count it as unavailable, never as a zero/positive gain.
  const r = reduceSportReport(serializeEvents(tel), META).summary;
  assert.equal(r.uphill.struckPossessions, 1);
  assert.equal(r.uphill.unavailableSegments, 1);
  assert.equal(r.uphill.positiveGainShare, null);
});

test('clock-end segment closes at the ACTUAL endpoint, not (0,0)', () => {
  // Start on the x=0 axis so the north-hoop direction is exactly (0,-1):
  // progress math is then exact, no normalization rounding in the fixture.
  const start = { x: 0, z: 10 };
  assert.ok(isCourtFloorSampleAvailable(start.x, start.z), 'fixture point must be on-court');
  const tel = createTelemetryRecorder({ capacity: 64 });
  recordDrop(tel, 0);
  recordHit(tel, 10, 'home', 'volley', 'medium', start.x, 1, start.z, 0, -1, 1, 'N');
  sampleUphill(tel, start.x, start.z);
  // Ball ends at (0, -5): progress toward the north hoop is
  // (0-0)*0 + (-5-10)*(-1) = 15. Closing at the (0,0) default would give 10.
  recordClockEnd(tel, 600, 0, -5);
  const closing = serializeEvents(tel).find((e) => e.type === 'clockEnd' && e.seg);
  assert.ok(closing, 'clockEnd should carry the closed segment');
  assert.equal(closing.seg.progress, 15);
  assert.equal(closing.x, 0);
  assert.equal(closing.z, -5);
});

test('uphill gain is clamped to >= 0 (a descent is never a negative rise)', () => {
  // Find two on-court points where the floor drops from origin to sample.
  let hi = null;
  let lo = null;
  outer: for (let xi = -20; xi <= 20; xi += 2) {
    for (let zi = -30; zi <= 30; zi += 2) {
      if (!isCourtFloorSampleAvailable(xi, zi)) continue;
      const fy = getCourtFloorY(xi, zi);
      if (hi === null || fy > getCourtFloorY(hi.x, hi.z)) hi = { x: xi, z: zi };
      if (lo === null || fy < getCourtFloorY(lo.x, lo.z)) lo = { x: xi, z: zi };
      if (hi && lo && getCourtFloorY(hi.x, hi.z) > getCourtFloorY(lo.x, lo.z) + 0.01) break outer;
    }
  }
  assert.ok(hi && lo && getCourtFloorY(hi.x, hi.z) > getCourtFloorY(lo.x, lo.z) + 0.01,
    'expected a downhill origin->sample pair on the sloped court');
  const tel = createTelemetryRecorder({ capacity: 64 });
  recordDrop(tel, 0);
  recordHit(tel, 10, 'home', 'volley', 'medium', hi.x, 1, hi.z, 0, -1, 1, 'N');
  sampleUphill(tel, lo.x, lo.z); // floor BELOW the strike origin
  recordClockEnd(tel, 600, lo.x, lo.z);
  const closing = serializeEvents(tel).find((e) => e.seg);
  assert.ok(closing.seg.samples >= 1);
  assert.equal(closing.seg.originUnavailable, false);
  assert.equal(closing.seg.uphillGain, 0); // clamped: never negative
});

test('buildTelemetryDoc is deterministic: identical inputs, identical JSON', () => {
  const build = () => {
    const tel = createTelemetryRecorder({ capacity: 64 });
    recordDrop(tel, 0);
    recordHit(tel, 10, 'home', 'volley', 'medium', 1, 2, 3, 0, -1, 0.5, 'N');
    recordGoal(tel, 50, 'N', 'home');
    advancePhase(tel);
    recordDrop(tel, 51);
    recordClockEnd(tel, 600, -2, 4); // explicit endpoint (required; no defaults)
    return JSON.stringify(buildTelemetryDoc(tel, { ...META_OK, seedA: 42, seedB: 137, ballId: 'medium' }));
  };
  assert.equal(build(), build());
});
