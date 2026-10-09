/**
 * Unit fixtures for the playtest telemetry reducer (spec: team/specs/auto-playtest.md,
 * "Test scripted event sequences for zero-hit drops, same-side repeats, opposing
 * hit, goal/end inversion, whiff exactly once, respawn reset, clock-censored
 * rally, height missing and buffer overflow").
 *
 * Pure reducer tests use hand-built serialized event streams. Recorder tests
 * exercise the zero-alloc pool + segment math end to end.
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
  skillCode,
  PARITY_NOTICE,
  SKILL,
} from '../src/sim/playtestTelemetry.js';
import { isCourtFloorSampleAvailable } from '../src/ai/courtHeightmap.js';

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
const META = { durationTicks: 600 };

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
  assert.equal(reduceSportReport([], {}).summary.goals.perMinute, null); // no exposure: null
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
  const r = reduceSportReport(events, { durationTicks: t }).summary;
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

test('uphill gain and progress aggregate over available segments', () => {
  const segA = { side: 'home', strikeTick: 10, targetGoal: 'N', uphillGain: 1.5, progress: 3, unavailable: 0, samples: 20 };
  const segB = { side: 'away', strikeTick: 30, targetGoal: 'S', uphillGain: -0.5, progress: 2, unavailable: 0, samples: 10 };
  const r = reduceSportReport([
    drop(0), hit(10, 'home', { seg: segA }), hit(30, 'away', { seg: segB }), clockEnd(600),
  ], META).summary;
  assert.equal(r.uphill.struckPossessions, 2);
  assert.equal(r.uphill.gainTotalMeters, 1);
  assert.equal(r.uphill.positiveGainShare, 0.5);
  assert.equal(r.uphill.progressTotalMeters, 5);
});

// ── Recorder-level fixtures ──

test('buffer overflow flags the run invalid instead of dropping silently', () => {
  const tel = createTelemetryRecorder({ capacity: 2 });
  recordDrop(tel, 0);
  recordHit(tel, 10, 'home', 'volley', 'easy', 0, 1, 5, 0, -1, 1, 'N');
  recordWhiff(tel, 20, 'away', 'hard', 0, 1, -5); // overflow here
  assert.equal(tel.count, 2);
  assert.equal(tel.overflow, true);
  const doc = buildTelemetryDoc(tel, META);
  assert.equal(doc.meta.eventOverflow, true);
  assert.equal(doc.report.meta.eventOverflow, true);
});

test('recorder round-trip: labels, skill mapping, phase advance on goal', () => {
  const tel = createTelemetryRecorder({ capacity: 64 });
  recordDrop(tel, 0);
  recordHit(tel, 10, 'home', 'spike', 'hard', 1, 2, 3, 0, -1, 0.9, 'N');
  recordWhiff(tel, 15, 'away', 'easy', 2, 1, -4);
  recordGoal(tel, 20, 'N', 'home');
  advancePhase(tel);
  recordDrop(tel, 21);
  recordClockEnd(tel, 600);
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
  // Find an off-court point where the baked heightmap has no sample.
  let offX = null;
  for (const x of [500, 1000, 5000]) {
    if (!isCourtFloorSampleAvailable(x, 0)) { offX = x; break; }
  }
  assert.ok(offX !== null, 'expected off-court samples to be unavailable');
  const tel = createTelemetryRecorder({ capacity: 64 });
  recordDrop(tel, 0);
  recordHit(tel, 10, 'home', 'volley', 'medium', offX, 1, 0, 1, 0, 1, 'N');
  sampleUphill(tel, offX, 0);
  sampleUphill(tel, offX, 0);
  recordClockEnd(tel, 600);
  const events = serializeEvents(tel);
  const closing = events.find((e) => e.seg);
  assert.ok(closing, 'clockEnd should carry the closed segment');
  assert.equal(closing.seg.samples, 0);
  assert.equal(closing.seg.unavailable, 2);
});

test('buildTelemetryDoc is deterministic: identical inputs, identical JSON', () => {
  const build = () => {
    const tel = createTelemetryRecorder({ capacity: 64 });
    recordDrop(tel, 0);
    recordHit(tel, 10, 'home', 'volley', 'medium', 1, 2, 3, 0, -1, 0.5, 'N');
    recordGoal(tel, 50, 'N', 'home');
    advancePhase(tel);
    recordDrop(tel, 51);
    recordClockEnd(tel, 600);
    return JSON.stringify(buildTelemetryDoc(tel, { ...META, seedA: 42, seedB: 137, ballId: 'medium' }));
  };
  assert.equal(build(), build());
});
