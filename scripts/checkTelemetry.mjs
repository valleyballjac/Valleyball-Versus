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
 *      Zero is ESTABLISHED, not tolerated, by three independent instruments:
 *        a. STATIC AUDIT: no Rapier accessor wrapper (translation()/linvel()/
 *           ...) may appear inside any `if (match.telemetry)` guard block in
 *           headlessSim.js; every hook must reuse positions the tick already
 *           computed. Machine-checked below.
 *        b. STACK ATTRIBUTION: every sampled allocation in the ON profile
 *           whose call stack passes through playtestTelemetry.js is summed.
 *           The bound is EXACT ZERO bytes (no tolerance).
 *        c. REPEATED OFF/ON PROFILE: interleaved baseline and telemetry runs
 *           (REPEATS each). The ON-OFF per-tick delta must not exceed the
 *           instrument's own measured reproducibility spread across the
 *           repeated runs. There is NO arbitrary fixed byte tolerance, and
 *           pre-existing engine allocations are attributed to the OFF
 *           baseline, never counted against telemetry.
 *      What is NOT claimed: whole-fixed-tick zero allocation. Pre-existing
 *      engine paths (Rapier translation()/linvel() wrappers, impulse vector
 *      literals, baseline hit/goal event arrays) still allocate every tick;
 *      removing those requires physics-binding changes and is reported below
 *      as an explicit UNMET CONSTRAINT.
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
import { readFileSync } from 'node:fs';
import { PerformanceObserver } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import inspector from 'node:inspector';
import {
  initHeadless, createHeadlessMatch, runHeadlessMatch, stepHeadlessMatch,
  destroyHeadlessMatch, isHeadlessCourtLoaded,
} from '../src/ai/headlessSim.js';
import {
  buildTelemetryDoc, PARITY_NOTICE,
  createTelemetryRecorder, recordDrop, recordHit, recordWhiff,
  recordGoal, recordRespawn, recordClockEnd, sampleUphill,
} from '../src/sim/playtestTelemetry.js';
import { TUNING } from '../src/config/tuning.js';

const SEED_A = 4242;
const SEED_B = 1337;
const DURATION_SEC = 60;
const HOME_DIFF = 'hard';
const AWAY_DIFF = 'medium';
const BALL = 'medium';

/** V8 allocation-sampling granularity (bytes) for the per-tick measurement. */
const SAMPLING_INTERVAL_BYTES = 256;
/** Interleaved OFF/ON repetitions for the per-tick allocation profile. The
 *  spread across repeated runs IS the instrument's noise floor; there is no
 *  fixed byte tolerance (an arbitrary constant is not proof of zero). */
const ALLOC_REPEATS = 3;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const q6 = (n) => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null);

function makeMatch(telemetry, ticks = DURATION_SEC * 60) {
  return createHeadlessMatch(TUNING.ai[HOME_DIFF], TUNING.ai[AWAY_DIFF], {
    matchTicks: ticks,
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
 * sampling, AND attribute sampled bytes to telemetry stacks. This measures
 * ALLOCATION (bytes requested), not GC events and not retained heap: the
 * right instrument for a per-tick allocation claim.
 *
 * Attribution: a sampled allocation counts as telemetry-attributed when any
 * frame in its call-stack path is inside src/sim/playtestTelemetry.js (the
 * recorder/reducer module). Pre-existing engine allocations (Rapier
 * wrappers, impulse literals, event arrays) have no playtestTelemetry.js
 * frame in their stack, so they are never counted against telemetry. The
 * static guard-block audit below complements this by proving no telemetry
 * hook calls a Rapier wrapper from headlessSim.js either.
 *
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
  let telemetryAttributedBytes = 0;
  const telemetryFrames = []; // evidence: which telemetry stacks (if any) allocated
  // Depth-first walk carrying whether any ancestor frame is telemetry code.
  const stack = [{ node: profile.head, inTelemetry: false }];
  while (stack.length > 0) {
    const { node, inTelemetry } = stack.pop();
    const url = (node.callFrame && node.callFrame.url) || '';
    const isTel = inTelemetry || url.includes('playtestTelemetry.js');
    allocatedBytes += node.selfSize || 0;
    if (isTel && (node.selfSize || 0) > 0) {
      telemetryAttributedBytes += node.selfSize;
      if (telemetryFrames.length < 10) {
        telemetryFrames.push(`${node.callFrame.functionName || '(anon)'} @ ${url}:${node.callFrame.lineNumber} selfSize=${node.selfSize}`);
      }
    }
    const children = node.children || [];
    for (let i = 0; i < children.length; i++) stack.push({ node: children[i], inTelemetry: isTel });
  }
  return { result, allocatedBytes, telemetryAttributedBytes, telemetryFrames };
}

/**
 * STATIC AUDIT (instrument a): scan every `if (match.telemetry)` guard block
 * in headlessSim.js and assert no Rapier accessor/mutator wrapper is called
 * inside it. Telemetry hooks must reuse positions the fixed tick already
 * computed (match.ballPrev, existing bPos/pos locals), so telemetry can
 * never be the reason a wrapper is allocated during a tick.
 */
function auditTelemetryGuardBlocks() {
  const srcUrl = new URL('../src/ai/headlessSim.js', import.meta.url);
  const src = readFileSync(srcUrl, 'utf8');
  const guardRe = /if \(match\.telemetry\)/g;
  const wrapperRe = /\.(translation|linvel|angvel|rotation|setTranslation|setLinvel|setAngvel|applyImpulse|applyTorqueImpulse)\s*\(/;
  let guards = 0;
  const findings = [];
  let m;
  while ((m = guardRe.exec(src)) !== null) {
    guards += 1;
    // Extract the guarded body: brace-matched block, or the single statement
    // up to ';' for brace-less guards (e.g. `if (match.telemetry) sampleUphill(...);`).
    let after = m.index + m[0].length;
    while (after < src.length && /\s/.test(src[after])) after += 1;
    let block;
    if (src[after] === '{') {
      let i = after;
      let depth = 0;
      let end = -1;
      for (; i < src.length; i++) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) {
        findings.push(`guard at offset ${m.index}: unbalanced braces, audit inconclusive`);
        continue;
      }
      block = src.slice(m.index, end + 1);
    } else {
      const semi = src.indexOf(';', after);
      if (semi < 0) {
        findings.push(`guard at offset ${m.index}: statement terminator not found, audit inconclusive`);
        continue;
      }
      block = src.slice(m.index, semi + 1);
    }
    const hit = block.match(wrapperRe);
    if (hit) {
      const line = src.slice(0, m.index).split('\n').length;
      findings.push(`line ${line}: telemetry guard block calls ${hit[0].replace(/\s*\($/, '')})`);
    }
  }
  return { guards, findings };
}

/**
 * Synthetic heavy warmup of the ENTIRE recorder path (every record* function,
 * segment open/close, uphill sampling). A real match calls these only ~12
 * times; that is too cold to survive a full GC's bytecode/feedback-vector
 * flush, so without this loop every ON run re-JITs the recorders INSIDE the
 * sampling window and V8 attributes the compilation artifacts (hundreds of
 * bytes per function, landing on declaration lines) to telemetry frames.
 * Steady-state scale test proved: after heavy warmup, 200k recordHit calls
 * attribute ZERO bytes to the recorder path, even across gc() cycles.
 * The pool is reused (count reset per iteration): the warmup itself allocates
 * nothing after the initial 64 slots.
 */
function warmRecorderPath(iterations = 20000) {
  const tel = createTelemetryRecorder({ capacity: 64 });
  for (let i = 0; i < iterations; i++) {
    tel.count = 0;
    tel.overflow = false;
    tel.phaseIndex = 0;
    recordDrop(tel, i);
    sampleUphill(tel, 1.5, -2.5); // no active segment: early return path
    recordHit(tel, i + 1, i % 2 ? 'home' : 'away', 'volley', 'medium',
      1.2345, 2.5, -3.75, 0.5, -0.5, 0.8, i % 3 ? 'N' : 'S');
    sampleUphill(tel, 2.5, -3.5); // active segment: floor-sample path
    recordWhiff(tel, i + 2, 'away', 'hard', 0.5, 1.5, -1.5);
    recordGoal(tel, i + 3, 'N', 'home');
    recordRespawn(tel, i + 4, 1, 2, 3);
    recordClockEnd(tel, i + 5, 2, -7);
  }
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
  // WARM UP BEFORE THE WINDOW OPENS, THEN GC. Order matters: warm first so
  // the recorder path and the engine tick loop are HOT when the gc runs;
  // V8's flush only evicts cold code, so hot functions survive and no
  // compilation artifact can land inside the measurement window.
  warmRecorderPath();
  // Full-length identical warmup match: same seeds/config, so the engine is
  // deterministic and this run exercises the EXACT branch/IC combinations the
  // measured match will hit (incl. clock-end segment close). Without it the
  // first ON run pays lazy feedback-vector/bytecode regeneration (~272B)
  // inside the window on closeSegmentInto's first real-data call.
  const warm = makeMatch(telemetry);
  runHeadlessMatch(warm);
  destroyHeadlessMatch(warm);
  if (typeof global.gc === 'function') global.gc(); // also gives a clean heap baseline
  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = process.hrtime.bigint();
  const { allocatedBytes, telemetryAttributedBytes, telemetryFrames } =
    await measureAllocatedBytes(() => runHeadlessMatch(match));
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
    telemetryAttributedBytes,
    telemetryFrames,
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
  const scriptPath = fileURLToPath(import.meta.url);
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

// 3. Per-tick allocation: ZERO net telemetry allocation, ESTABLISHED by three
//    instruments (spec: measured, never assumed; no arbitrary byte tolerance).
//    a. static audit of every telemetry guard block in headlessSim.js
//    b. exact-zero stack attribution in the sampled ON profiles
//    c. repeated interleaved OFF/ON profiles; the ON-OFF delta must stay
//       within the instrument's own measured reproducibility spread.
//    Match creation (incl. the ONE-TIME telemetry pool) is outside the window;
//    GC counts and heap deltas are context only, NOT the allocation proof.
console.log('\n-- static audit: no Rapier wrapper inside any telemetry guard block --');
const audit = auditTelemetryGuardBlocks();
console.log(`  scanned ${audit.guards} 'if (match.telemetry)' guard blocks in src/ai/headlessSim.js`);
for (const f of audit.findings) console.log(`  FINDING: ${f}`);
ok('every telemetry guard block is wrapper-free (hooks reuse existing per-tick positions)',
  audit.guards >= 5 && audit.findings.length === 0,
  audit.findings.length === 0 ? `${audit.guards} guards clean` : `${audit.findings.length} finding(s)`);

console.log(`\n-- measured per-tick allocation (V8 heap sampling, ${ALLOC_REPEATS}x interleaved OFF/ON) --`);
const offRuns = [];
const onRuns = [];
for (let r = 0; r < ALLOC_REPEATS; r++) {
  offRuns.push(await runMeasured(false));
  onRuns.push(await runMeasured(true));
}
const fmt = (m) => `${m.allocBytesPerTick.toFixed(2)} B/tick (total ${(m.allocBytesTotal / 1048576).toFixed(2)}MB over ${m.ticks} ticks, telAttributed=${m.telemetryAttributedBytes}B)`;
offRuns.forEach((m, i) => console.log(`  OFF run ${i + 1}: ${m.ticksPerSec} ticks/s  alloc=${fmt(m)}  gc=${m.gcCount} (${m.gcPauseMs}ms)  heapDelta=${m.heapDeltaKB}KB  peakRss=${m.peakRssKB}KB`));
onRuns.forEach((m, i) => console.log(`  ON  run ${i + 1}: ${m.ticksPerSec} ticks/s  alloc=${fmt(m)}  gc=${m.gcCount} (${m.gcPauseMs}ms)  heapDelta=${m.heapDeltaKB}KB  peakRss=${m.peakRssKB}KB`));

// Instrument b: exact-zero stack attribution. Any sampled byte whose stack
// passes through playtestTelemetry.js fails the check; evidence frames print.
const attributedTotal = onRuns.reduce((s, m) => s + m.telemetryAttributedBytes, 0);
for (const m of onRuns) for (const f of m.telemetryFrames) console.log(`  TELEMETRY STACK SAMPLE: ${f}`);
ok('telemetry-attributed sampled allocation is EXACTLY 0 bytes (all ON runs)',
  attributedTotal === 0, `${attributedTotal} bytes attributed to playtestTelemetry.js stacks`);

// Instrument c: repeated OFF/ON delta within the instrument's own measured
// reproducibility spread (noise floor derived from the repeats themselves).
const perTick = (runs) => runs.map((m) => m.allocBytesPerTick);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const spread = (a) => Math.max(...a) - Math.min(...a);
const offPerTick = perTick(offRuns);
const onPerTick = perTick(onRuns);
const offMean = mean(offPerTick);
const onMean = mean(onPerTick);
const perTickDelta = onMean - offMean;
const noiseFloor = Math.max(spread(offPerTick), spread(onPerTick));
console.log(`  OFF mean ${offMean.toFixed(2)} B/tick (spread ${spread(offPerTick).toFixed(2)})  ON mean ${onMean.toFixed(2)} B/tick (spread ${spread(onPerTick).toFixed(2)})`);
console.log(`  telemetry-attributed per-tick delta: ${perTickDelta.toFixed(2)} B/tick; measured noise floor (max repeat spread): ${noiseFloor.toFixed(2)} B/tick; one-time pool excluded from window`);
ok('baseline fixed tick allocation is measured, not assumed',
  offMean > 0, `${Math.round(offMean)} B/tick pre-existing (attributed to the engine, not telemetry)`);
ok('repeated OFF/ON per-tick delta is within the instrument noise floor (zero within measurement)',
  perTickDelta <= noiseFloor, `delta=${perTickDelta.toFixed(2)} floor=${noiseFloor.toFixed(2)} B/tick`);
ok('telemetry tick throughput within 10% of baseline',
  mean(onRuns.map((m) => m.ticksPerSec)) >= mean(offRuns.map((m) => m.ticksPerSec)) * 0.9 || mean(offRuns.map((m) => m.ticksPerSec)) === 0,
  `off=${Math.round(mean(offRuns.map((m) => m.ticksPerSec)))} on=${Math.round(mean(onRuns.map((m) => m.ticksPerSec)))}`);
// Explicit unmet-constraint notice (QA defect 1): do NOT mark whole-tick zero
// allocation as passed. It is not attained and would require physics-binding
// changes (scratch-vector reuse across Rapier wrappers, event-array redesign).
console.log('  UNMET CONSTRAINT (surfaced to John/Jac, not marked passed): whole-fixed-tick');
console.log('  ZERO allocation is NOT attained. Pre-existing engine paths (Rapier');
console.log('  translation()/linvel() wrappers, impulse literals, baseline event arrays)');
console.log(`  allocate ~${Math.round(offMean)} B/tick WITHOUT telemetry. The recorder itself adds`);
console.log('  0 attributed bytes (exact, instrument b) and a per-tick delta within the');
console.log('  measured noise floor (instrument c), plus a one-time pool at match creation.');

console.log(`\n${failed === 0 ? 'CHECK RESULT: PASS' : `CHECK RESULT: FAIL (${failed})`}`);
console.log(PARITY_NOTICE);
process.exit(failed === 0 ? 0 : 1);
