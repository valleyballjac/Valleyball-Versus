#!/usr/bin/env node
/**
 * TELEMETRY VERIFICATION HARNESS (evidence script, not the batch CLI)
 *
 * Proves the acceptance criteria of the auto-playtest telemetry card:
 *   1. Two INDEPENDENT PROCESSES with the same seed produce digest-identical
 *      telemetry documents (incl. a first-census snapshot of ball/motor state
 *      after tick 1 and the strict court-load flag). The digest child FAILS
 *      CLOSED (nonzero exit, ok:false, no digest) on the cuboid fallback or
 *      an event-pool overflow; no report bytes are emitted in that case.
 *   2. Telemetry ON vs OFF leaves goals / whiffs / landed hits identical.
 *   3. PER-TICK ALLOCATION is MEASURED with V8 heap sampling
 *      (inspector HeapProfiler.startSampling), over a window that EXCLUDES
 *      one-time match/pool setup, plus GC counts and ticks/sec for context.
 *      What is asserted: telemetry-attributed per-tick allocation is ~0 over
 *      the OFF baseline. What is NOT claimed: whole-fixed-tick zero
 *      allocation. Pre-existing engine paths (Rapier translation()/linvel()
 *      wrappers, impulse vector literals, baseline hit/goal event arrays)
 *      still allocate every tick; removing those requires physics-binding
 *      changes and is reported below as an explicit UNMET CONSTRAINT.
 *      Run with --expose-gc for the controlled heap baseline:
 *        node --expose-gc scripts/checkTelemetry.mjs
 *
 * HEADLESS BOT PROXY. Diagnostic numbers only. Not Law 1 parity, not a
 * measure of human play. Human playtests remain the final authority.
 *
 * The batch CLI / baseline worktree orchestration is Card 2 (Teal).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PerformanceObserver } from 'node:perf_hooks';
import inspector from 'node:inspector';
import {
  initHeadless, createHeadlessMatch, runHeadlessMatch, stepHeadlessMatch,
  destroyHeadlessMatch, isHeadlessCourtLoaded,
} from '../src/ai/headlessSim.js';
import { buildTelemetryDoc, PARITY_NOTICE } from '../src/sim/playtestTelemetry.js';
import { TUNING } from '../src/config/tuning.js';

const SEED_A = 4242;
const SEED_B = 1337;
const DURATION_SEC = 60;
const HOME_DIFF = 'hard';
const AWAY_DIFF = 'medium';
const BALL = 'medium';

/** V8 allocation-sampling granularity (bytes) for the per-tick measurement. */
const SAMPLING_INTERVAL_BYTES = 256;
/** Tolerance for the ON-OFF per-tick allocation delta: sampling noise floor. */
const PER_TICK_DELTA_TOLERANCE_BYTES = 64;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const q6 = (n) => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null);

function makeMatch(telemetry) {
  return createHeadlessMatch(TUNING.ai[HOME_DIFF], TUNING.ai[AWAY_DIFF], {
    matchTicks: DURATION_SEC * 60,
    seedA: SEED_A,
    seedB: SEED_B,
    homeDiff: HOME_DIFF,
    awayDiff: AWAY_DIFF,
    ballType: BALL,
    aggressivenessA: 0.60,
    aggressivenessB: 0.60,
    telemetry,
  });
}

/** Run one match; return invariants + doc (telemetry on) or counters (off). */
function runOnce(telemetry) {
  const match = makeMatch(telemetry);
  const courtLoaded = match.courtLoaded === true;
  // First census: state snapshot after exactly one tick (determinism evidence).
  stepHeadlessMatch(match);
  const bp = match.ballBody.translation();
  const ma = match.motorBodyA.translation();
  const mb = match.motorBodyB.translation();
  const census = {
    tick: match.tick,
    ball: [q6(bp.x), q6(bp.y), q6(bp.z)],
    motorA: [q6(ma.x), q6(ma.y), q6(ma.z)],
    motorB: [q6(mb.x), q6(mb.y), q6(mb.z)],
  };
  runHeadlessMatch(match);
  const counters = {
    scoreHome: match.matchState.scoreHome,
    scoreAway: match.matchState.scoreAway,
    goalEvents: match.matchState.events.length,
    hits: (match.lastHits || []).length,
    whiffsHome: match.whiffs ? match.whiffs.home : 0,
    whiffsAway: match.whiffs ? match.whiffs.away : 0,
  };
  // FAIL CLOSED: on the cuboid fallback no recorder exists (match.telemetry is
  // null), so no doc is built here; report paths must treat that as an error.
  let doc = null;
  if (telemetry && match.telemetry) {
    doc = buildTelemetryDoc(match.telemetry, {
      durationTicks: DURATION_SEC * 60,
      ballId: BALL,
      homeSkill: HOME_DIFF,
      awaySkill: AWAY_DIFF,
      seedA: SEED_A,
      seedB: SEED_B,
      aggressiveness: 0.60,
      courtLoaded,
      firstCensus: census,
    });
  }
  destroyHeadlessMatch(match);
  return { courtLoaded, census, counters, doc };
}

/**
 * Measure total JS heap bytes allocated while `fn` runs, via V8 heap
 * sampling. This measures ALLOCATION (bytes requested), not GC events and
 * not retained heap: the right instrument for a per-tick allocation claim.
 * Repeatable: the match is deterministic, the sampling interval is fixed,
 * and the estimate converges (tens of thousands of samples per run).
 */
async function measureAllocatedBytes(fn) {
  const session = new inspector.Session();
  session.connect();
  const post = (method, params) => new Promise((resolve, reject) => {
    session.post(method, params, (err, res) => (err ? reject(err) : resolve(res)));
  });
  await post('HeapProfiler.enable');
  await post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL_BYTES });
  let result;
  try {
    result = fn();
  } finally {
    // stopSampling below even if fn threw
  }
  const { profile } = await post('HeapProfiler.stopSampling');
  await post('HeapProfiler.disable');
  session.disconnect();
  let allocatedBytes = 0;
  const stack = [profile.head];
  while (stack.length > 0) {
    const node = stack.pop();
    allocatedBytes += node.selfSize || 0;
    const children = node.children || [];
    for (let i = 0; i < children.length; i++) stack.push(children[i]);
  }
  return { result, allocatedBytes };
}

/**
 * Timed + allocation-sampled run. Match creation (incl. the ONE-TIME
 * telemetry pool) happens BEFORE the sampling window opens, so the measured
 * bytes/tick reflect only the fixed-tick loop.
 */
async function runMeasured(telemetry) {
  const match = makeMatch(telemetry);
  let gcCount = 0;
  let gcPauseMs = 0;
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) { gcCount += 1; gcPauseMs += e.duration; }
  });
  obs.observe({ entryTypes: ['gc'] });
  if (typeof global.gc === 'function') global.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = process.hrtime.bigint();
  const { allocatedBytes } = await measureAllocatedBytes(() => runHeadlessMatch(match));
  const t1 = process.hrtime.bigint();
  const heapAfter = process.memoryUsage().heapUsed;
  obs.disconnect();
  const ticks = match.tick;
  destroyHeadlessMatch(match);
  return {
    ticks,
    ticksPerSec: Math.round(ticks / (Number(t1 - t0) / 1e9)),
    gcCount,
    gcPauseMs: Math.round(gcPauseMs * 10) / 10,
    heapDeltaKB: Math.round((heapAfter - heapBefore) / 1024),
    allocBytesTotal: allocatedBytes,
    allocBytesPerTick: ticks > 0 ? allocatedBytes / ticks : 0,
    peakRssKB: Math.round(process.memoryUsage().rss / 1024),
  };
}

// ── digest-only child mode (FAILS CLOSED on fallback / overflow) ──
if (process.argv.includes('--digest')) {
  await initHeadless();
  const courtLoaded = isHeadlessCourtLoaded();
  try {
    if (!courtLoaded) {
      throw new Error('fail closed: cuboid fallback court is not reportable (courtLoaded=false)');
    }
    const { doc } = runOnce(true);
    // runOnce builds the doc through buildTelemetryDoc, which itself throws
    // on fallback (courtLoaded !== true) or event-pool overflow. A null doc
    // here means the recorder was never created: also fail closed.
    if (!doc) throw new Error('fail closed: no telemetry doc produced (recorder disabled)');
    const json = JSON.stringify(doc);
    process.stdout.write(JSON.stringify({
      ok: true,
      parity: PARITY_NOTICE,
      courtLoaded,
      digest: sha256(json),
      docBytes: json.length,
      events: doc.events.length,
      overflow: doc.meta.eventOverflow,
      census: doc.meta.firstCensus,
      reportDigest: sha256(JSON.stringify(doc.report)),
    }) + '\n');
    process.exit(0);
  } catch (err) {
    process.stdout.write(JSON.stringify({
      ok: false,
      parity: PARITY_NOTICE,
      courtLoaded,
      error: String((err && err.message) || err),
    }) + '\n');
    process.exit(1);
  }
}

// ── main evidence mode ──
let failed = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!cond) failed += 1;
};

await initHeadless();

// 0. Strict court load: fail closed on the cuboid fallback.
const courtLoaded = isHeadlessCourtLoaded();
ok('strict court load (arena.glb trimeshes, no cuboid fallback)', courtLoaded);
if (!courtLoaded) {
  console.error('ABORT: telemetry must not be collected on the fallback court.');
  process.exit(1);
}

// 1. Two independent processes, same seed -> identical digests + first census.
console.log('\n-- two-process digest check (same seed, independent node processes) --');
const child = () => {
  const scriptPath = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  let stdout = '';
  let exitCode = 0;
  try {
    stdout = execFileSync(process.execPath, [scriptPath, '--digest'], { encoding: 'utf8' });
  } catch (e) {
    stdout = (e && e.stdout) || '';
    exitCode = e && typeof e.status === 'number' ? e.status : 1;
  }
  let parsed = null;
  try {
    const lines = stdout.trim().split('\n');
    parsed = JSON.parse(lines[lines.length - 1]);
  } catch { /* handled below */ }
  if (!parsed) {
    return { ok: false, error: `digest child produced no parsable JSON (exit=${exitCode})` };
  }
  return parsed;
};
const c1 = child();
const c2 = child();
ok('digest children report ok (fail-closed guard passed)',
  c1.ok === true && c2.ok === true,
  c1.ok ? (c2.ok ? '' : `child2: ${c2.error}`) : `child1: ${c1.error}`);
ok('digest wrapper carries the exact parity notice',
  c1.parity === PARITY_NOTICE && c2.parity === PARITY_NOTICE);
ok('process digests identical', c1.ok === true && c2.ok === true && c1.digest === c2.digest,
  c1.digest ? c1.digest.slice(0, 16) + '...' : '');
ok('report digests identical', c1.ok === true && c2.ok === true && c1.reportDigest === c2.reportDigest);
ok('first-census identical', JSON.stringify(c1.census) === JSON.stringify(c2.census),
  JSON.stringify(c1.census ? c1.census.ball : null));
ok('no event overflow', c1.ok === true && c1.overflow === false, `events=${c1.events}`);

// 2. Telemetry ON vs OFF: match invariants unchanged.
console.log('\n-- telemetry on/off invariance (same seed, same process) --');
const on = runOnce(true);
const off = runOnce(false);
ok('counters identical (score/goals/hits/whiffs)',
  JSON.stringify(on.counters) === JSON.stringify(off.counters),
  JSON.stringify(on.counters));

// 3. Per-tick allocation measurement (spec: measured, never assumed).
//    Method: V8 heap sampling over the tick loop only (match creation and
//    the one-time telemetry pool are outside the window). GC counts and heap
//    deltas are printed as context only; they are NOT the allocation proof.
console.log('\n-- measured per-tick allocation (V8 heap sampling, telemetry OFF vs ON) --');
const mOff = await runMeasured(false);
const mOn = await runMeasured(true);
const fmt = (m) => `${Math.round(m.allocBytesPerTick)} B/tick (total ${(m.allocBytesTotal / 1048576).toFixed(2)}MB over ${m.ticks} ticks)`;
console.log(`  OFF: ${mOff.ticksPerSec} ticks/s  alloc=${fmt(mOff)}  gc=${mOff.gcCount} (${mOff.gcPauseMs}ms)  heapDelta=${mOff.heapDeltaKB}KB  peakRss=${mOff.peakRssKB}KB`);
console.log(`  ON : ${mOn.ticksPerSec} ticks/s  alloc=${fmt(mOn)}  gc=${mOn.gcCount} (${mOn.gcPauseMs}ms)  heapDelta=${mOn.heapDeltaKB}KB  peakRss=${mOn.peakRssKB}KB`);
const perTickDelta = mOn.allocBytesPerTick - mOff.allocBytesPerTick;
const tolerance = Math.max(PER_TICK_DELTA_TOLERANCE_BYTES, mOff.allocBytesPerTick * 0.02);
console.log(`  telemetry-attributed per-tick delta: ${Math.round(perTickDelta)} B/tick (tolerance ${Math.round(tolerance)} B/tick; one-time pool excluded from window)`);
ok('baseline fixed tick allocation is measured, not assumed',
  mOff.allocBytesPerTick > 0, `${Math.round(mOff.allocBytesPerTick)} B/tick pre-existing`);
ok('telemetry adds no measurable per-tick allocation over baseline',
  perTickDelta <= tolerance, `off=${Math.round(mOff.allocBytesPerTick)} on=${Math.round(mOn.allocBytesPerTick)} B/tick`);
ok('telemetry tick throughput within 10% of baseline',
  mOn.ticksPerSec >= mOff.ticksPerSec * 0.9 || mOff.ticksPerSec === 0,
  `off=${mOff.ticksPerSec} on=${mOn.ticksPerSec}`);
// Explicit unmet-constraint notice (QA defect 1): do NOT mark whole-tick zero
// allocation as passed. It is not attained and would require physics-binding
// changes (scratch-vector reuse across Rapier wrappers, event-array redesign).
console.log('  UNMET CONSTRAINT (surfaced to John/Jac, not marked passed): whole-fixed-tick');
console.log('  ZERO allocation is NOT attained. Pre-existing engine paths (Rapier');
console.log('  translation()/linvel() wrappers, impulse literals, baseline event arrays)');
console.log(`  allocate ~${Math.round(mOff.allocBytesPerTick)} B/tick WITHOUT telemetry. The recorder itself adds`);
console.log('  ~0 B/tick (measured above) plus a one-time pool at match creation.');

console.log(`\n${failed === 0 ? 'CHECK RESULT: PASS' : `CHECK RESULT: FAIL (${failed})`}`);
console.log(PARITY_NOTICE);
process.exit(failed === 0 ? 0 : 1);
