#!/usr/bin/env node
/**
 * TELEMETRY VERIFICATION HARNESS (evidence script, not the batch CLI)
 *
 * Proves the acceptance criteria of the auto-playtest telemetry card:
 *   1. Two INDEPENDENT PROCESSES with the same seed produce digest-identical
 *      telemetry documents (incl. a first-census snapshot of ball/motor state
 *      after tick 1 and the strict court-load flag).
 *   2. Telemetry ON vs OFF leaves goals / whiffs / landed hits identical.
 *   3. Allocation + GC pressure and ticks/sec are MEASURED for both configs
 *      (no unprofiled performance claims). Run with --expose-gc for the
 *      controlled heap baseline:
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
import {
  initHeadless, createHeadlessMatch, runHeadlessMatch, stepHeadlessMatch,
  destroyHeadlessMatch, isHeadlessCourtLoaded,
} from '../src/ai/headlessSim.js';
import { buildTelemetryDoc } from '../src/sim/playtestTelemetry.js';
import { TUNING } from '../src/config/tuning.js';

const SEED_A = 4242;
const SEED_B = 1337;
const DURATION_SEC = 60;
const HOME_DIFF = 'hard';
const AWAY_DIFF = 'medium';
const BALL = 'medium';

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

/** Timed + GC-observed run for the allocation/perf measurement. */
function runMeasured(telemetry) {
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
  runHeadlessMatch(match);
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
    peakRssKB: Math.round(process.memoryUsage().rss / 1024),
  };
}

// ── digest-only child mode ──
if (process.argv.includes('--digest')) {
  await initHeadless();
  const { doc, courtLoaded } = runOnce(true);
  const json = JSON.stringify(doc);
  process.stdout.write(JSON.stringify({
    courtLoaded,
    digest: sha256(json),
    docBytes: json.length,
    events: doc.events.length,
    overflow: doc.meta.eventOverflow,
    census: doc.meta.firstCensus,
    reportDigest: sha256(JSON.stringify(doc.report)),
  }) + '\n');
  process.exit(0);
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
const child = () => JSON.parse(execFileSync(process.execPath, [new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--digest'], { encoding: 'utf8' }));
const c1 = child();
const c2 = child();
ok('process digests identical', c1.digest === c2.digest, c1.digest.slice(0, 16) + '...');
ok('report digests identical', c1.reportDigest === c2.reportDigest);
ok('first-census identical', JSON.stringify(c1.census) === JSON.stringify(c2.census), JSON.stringify(c1.census.ball));
ok('no event overflow', c1.overflow === false, `events=${c1.events}`);

// 2. Telemetry ON vs OFF: match invariants unchanged.
console.log('\n-- telemetry on/off invariance (same seed, same process) --');
const on = runOnce(true);
const off = runOnce(false);
ok('counters identical (score/goals/hits/whiffs)',
  JSON.stringify(on.counters) === JSON.stringify(off.counters),
  JSON.stringify(on.counters));

// 3. Allocation / GC / timing measurement (spec: measured, never assumed).
console.log('\n-- measured allocation + perf (telemetry OFF vs ON) --');
const mOff = runMeasured(false);
const mOn = runMeasured(true);
console.log(`  OFF: ${mOff.ticksPerSec} ticks/s  gc=${mOff.gcCount} (${mOff.gcPauseMs}ms)  heapDelta=${mOff.heapDeltaKB}KB  peakRss=${mOff.peakRssKB}KB`);
console.log(`  ON : ${mOn.ticksPerSec} ticks/s  gc=${mOn.gcCount} (${mOn.gcPauseMs}ms)  heapDelta=${mOn.heapDeltaKB}KB  peakRss=${mOn.peakRssKB}KB`);
// The telemetry hook path itself must not add GC events; residual allocations
// are Rapier-internal wrappers (translation()/linvel() return fresh objects),
// which are isolated and measured here rather than silently ignored.
ok('telemetry adds no GC events over baseline', mOn.gcCount <= mOff.gcCount,
  `off=${mOff.gcCount} on=${mOn.gcCount}`);
ok('telemetry tick throughput within 10% of baseline',
  mOn.ticksPerSec >= mOff.ticksPerSec * 0.9 || mOff.ticksPerSec === 0,
  `off=${mOff.ticksPerSec} on=${mOn.ticksPerSec}`);

console.log(`\n${failed === 0 ? 'CHECK RESULT: PASS' : `CHECK RESULT: FAIL (${failed})`}`);
console.log('HEADLESS BOT PROXY. Diagnostic numbers only. Not Law 1 parity, not a measure of human play.');
process.exit(failed === 0 ? 0 : 1);
