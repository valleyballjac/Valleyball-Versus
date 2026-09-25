/**
 * THE TRACE HARNESS — every tick compared, in one page load per run.
 *
 *   npm run trace                               idle run, court, to tick 300, 2 runs
 *   npm run trace -- --name strike              a scripted scenario (see scripts/scenarios.mjs)
 *   npm run trace -- --name all                 every scenario in turn
 *   npm run trace -- --record                   write baselines/trace_<name>.json
 *   npm run trace -- --baseline                 compare against baselines/trace_<name>.json
 *   npm run trace -- --probe 10                 print a probe snapshot every 10 ticks (run A)
 *
 * WHY IT EXISTS (Phase 0 of the rebuild plan):
 *
 * - determinism.mjs and scenario.mjs compare PNGs at a handful of anchor ticks.
 *   A PNG hash is renderer-bound — SwiftShader here, a GPU on the laptop — so a
 *   cloud run and a laptop run can never be compared with each other. This
 *   harness compares the STATE TRACE (src/debug/stateTrace.js): a digest of
 *   every rigid body and every athlete's ghost, on every tick.
 * - scenario.mjs loads the page once per anchor per run (8 loads for 4 anchors).
 *   This loads it once per run, runs to the end tick, and reads the whole trace.
 * - A scenario that stopped touching the ball still passed scenario.mjs, because
 *   agreement between two runs is necessary and nowhere near sufficient. Every
 *   scenario here declares EXPECTATIONS — log lines that must appear inside a
 *   tick window — and fails if its mechanic did not actually happen.
 *
 * The input shim (pinned rAF clock, scripted gamepad, tick-keyed script) is the
 * one proven in scenario.mjs and carries its lessons unchanged: presses are
 * ranges, one set() per button per frame, the script is keyed on the loop tick.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

import { SCENARIOS } from './scenarios.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.VITE_PORT ? parseInt(process.env.VITE_PORT, 10) : 5182;
const RUN_TIMEOUT_MS = 180_000;
const BASELINE_DIR = path.join(ROOT, 'baselines');

const CHROMIUM_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

class Refusal extends Error {}
class RunFailure extends Error {}
const fail = (message) => { throw new Refusal(message); };

function parseArgs(argv) {
  const args = { name: 'idle', runs: 2, arena: 'court', record: false, baseline: false, probe: 0, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--record') { args.record = true; continue; }
    if (flag === '--baseline') { args.baseline = true; continue; }
    if (flag === '--quiet') { args.quiet = true; continue; }
    if (flag === '--facts') { args.facts = true; continue; }
    const value = argv[i + 1];
    if (flag === '--adhoc') {
      // A throwaway scenario from the command line, for measuring: JSON with
      // end, script, query, expect. Registered under the name "adhoc".
      SCENARIOS.adhoc = JSON.parse(value);
      args.name = 'adhoc';
    } else if (flag === '--name') {
      if (value !== 'all' && !SCENARIOS[value]) fail(`--name expects all or one of ${Object.keys(SCENARIOS).join(', ')}, got "${value}"`);
      args.name = value;
    } else if (flag === '--arena') {
      args.arena = value;
    } else if (flag === '--runs') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) fail(`--runs expects a positive integer, got "${value}"`);
      args.runs = n;
    } else if (flag === '--probe') {
      args.probe = Number(value) || 0;
    } else {
      continue;
    }
    i += 1;
  }
  return args;
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(1000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
  });
}

/**
 * Installed before any page script runs. The pinned rAF clock and the scripted
 * pad are scenario.mjs's; the log tap and the probe recorder are new.
 */
function shim({ scriptSource, probeEvery }) {
  const pad = {
    id: 'scenario', index: 0, connected: true, mapping: 'standard',
    timestamp: 0, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  navigator.getGamepads = () => [pad];

  // eslint-disable-next-line no-new-func
  const script = new Function(`return (${scriptSource});`)();
  const realRaf = window.requestAnimationFrame.bind(window);
  // A hair over 1/60 s so float rounding can never leave the accumulator one
  // ulp short of fixedDt (which made a frame take 0 steps and the next take 2).
  // The surplus is 1e-9 s per frame: one extra step every ~16 million frames.
  const STEP_MS = 1000 / 60 + 1e-6;
  let clock = 0;

  const set = (i, on) => { pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; };
  const key = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));

  // THE LOG TAP. Every bracketed console line is recorded with the tick it was
  // printed on, so a scenario can assert "a volley resolved between 110 and 130".
  const events = [];
  window.__vbEvents = events;
  for (const level of ['log', 'info', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...parts) => {
      const first = parts[0];
      if (typeof first === 'string' && first.startsWith('[')) {
        const tick = window.__vb && window.__vb.loop ? window.__vb.loop.tick : -1;
        events.push({ tick, text: parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ') });
      }
      original(...parts);
    };
  }

  // THE PROBE RECORDER — registered on the loop as soon as it exists, which is
  // before its first step because loop.start() is what first calls rAF.
  const probes = [];
  window.__vbProbes = probes;
  let registered = false;

  // THE FACTS RECORDER — a compact row per tick for athlete 0, read-only, so
  // expectations can be predicates ("sliding in [116, 124]", "weight < 0.3 after
  // the knockdown") rather than hopes that some log line happened.
  const facts = [];
  window.__vbFacts = facts;
  // Steps the Loop took on each of its frames. The harness is only valid if
  // this is exactly 1 on every frame after the first: then tick == frame and
  // scripted input is a pure function of the tick.
  const pacing = [];
  window.__vbPacing = pacing;

  // ONLY THE LOOP'S FRAME ADVANCES THE PINNED CLOCK. Other modules run their
  // own rAF loops now (visuals/brandBall.js spins the title ball; toasts), and
  // when every callback advanced the clock the Loop saw ~33 ms per frame, took
  // two steps per frame, and the script skipped ticks and ran several times per
  // tick. Foreign callbacks get the current clock and never drive the script.
  const isLoopFrame = (cb) => cb && /_onFrame/.test(cb.name || '');
  const foreignRaf = (cb) => realRaf(() => cb(clock));
  window.requestAnimationFrame = (cb) => (!isLoopFrame(cb) ? foreignRaf(cb) : realRaf(() => {
    if (!registered && window.__vb && window.__vb.loop) {
      registered = true;
      window.__vb.loop.onTick((tick) => {
        const a = window.__vb.athletes && window.__vb.athletes[0];
        if (!a) return;
        const g = a.animTarget || {};
        const st = a.strikeState || {};
        const ac = a.actionState || {};
        const mb = a.motor && a.motor.body;
        const v = mb ? mb.linvel() : { x: 0, y: 0, z: 0 };
        const t = mb ? mb.translation() : { x: 0, y: 0, z: 0 };
        const r = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n);
        facts.push({
          tick,
          x: r(t.x), y: r(t.y), z: r(t.z),
          speed: r(Math.hypot(v.x, v.z)), vy: r(v.y),
          grounded: !!(a.motor && a.motor.grounded),
          weight: r(a.tracker ? a.tracker.weight : 1),
          slideTime: ac.slideTime || 0,
          divePending: !!ac.divePending,
          standUpNeed: r(g.standUpNeed || 0),
          slideNeedsRelease: !!ac.slideNeedsRelease,
          lastDiveTick: Number.isFinite(ac.lastDiveTick) ? ac.lastDiveTick : null,
          lastStrikeTick: Number.isFinite(st.lastStrikeTick) ? st.lastStrikeTick : null,
          strikeKind: st.lastStrikeKind ?? null,
          contactTick: Number.isFinite(st.lastContactTick) ? st.lastContactTick : null,
          contactKey: st.lastContactKey || '',
          resolved: st.resolvedCount || 0,
          whiffs: st.whiffCount || 0,
        });
      });
      if (probeEvery > 0) {
        window.__vb.loop.onTick((tick) => {
          if (tick % probeEvery !== 0) return;
          const p = window.__vb.probe();
          if (!p) return;
          const r = (n) => (typeof n === 'number' ? +n.toFixed(3) : n);
          probes.push({
            tick,
            motor: [r(p.motor.x), r(p.motor.y), r(p.motor.z), r(p.motor.speed)],
            weight: r(p.weight),
            grounded: p.grounded,
            yaw: r(p.yaw),
            pelvis: [r(p.pelvis.x), r(p.pelvis.y), r(p.pelvis.z)],
            balls: p.balls.map((b) => [r(b.x), r(b.y), r(b.z), r(b.speed)]),
            strike: { attempts: p.strike.attempts, kind: p.strike.kind, resolved: p.strike.resolvedCount, whiff: p.strike.whiffCount, contact: p.strike.lastContactKey, q: p.strike.lastContactQuality },
          });
        });
      }
    }
    clock += STEP_MS;
    pad.timestamp = clock;
    // THE LOOP'S OWN TICK, published on the previous frame. This used to read
    // the #hud-tick element — which stops updating when TUNING.debug.showHud is
    // off (the release default since Sep 6), so every scripted press was keyed
    // on tick 0 and never fired. The scenarios passed while testing nothing.
    const tick = window.__vb && window.__vb.loop ? window.__vb.loop.tick : 0;
    script(tick, pad, set, key);
    cb(clock);
    if (window.__vb && window.__vb.loop && window.__vb.loop._running) pacing.push(window.__vb.loop.stepsThisFrame);
  }));
}

async function runOnce(browser, scenario, arena, probeEvery) {
  const problems = [];
  // Small viewport: the live render is pure overhead here (the anchored capture
  // pins its own 1280x720), and SwiftShader cost scales with pixels.
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  try {
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.addInitScript(shim, { scriptSource: scenario.script, probeEvery });
    const captured = page.waitForResponse(
      (r) => r.url().includes('/__capture') && r.request().method() === 'POST' && r.status() === 200,
      { timeout: RUN_TIMEOUT_MS },
    );
    await page.goto(`http://localhost:${PORT}/?captureTick=${scenario.end}&arena=${arena}&stateTrace=1${scenario.query ? `&${scenario.query}` : ''}`, {
      waitUntil: 'commit', timeout: RUN_TIMEOUT_MS,
    });
    try {
      await captured;
    } catch {
      throw new RunFailure(`no capture within ${RUN_TIMEOUT_MS / 1000}s`);
    }
    await page.waitForTimeout(200);
    const out = await page.evaluate(() => ({
      trace: window.__vbTrace || null,
      events: window.__vbEvents || [],
      probes: window.__vbProbes || [],
      facts: window.__vbFacts || [],
      pacing: window.__vbPacing || [],
    }));
    if (!out.trace) throw new RunFailure('page did not arm the state trace (is ?stateTrace=1 wired in main.js?)');
    if (problems.length) {
      throw new RunFailure(`page reported ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    }
    return out;
  } finally {
    await page.close();
  }
}

/** Row i of a run as one comparable string: world hash + every athlete hash. */
function rowKey(trace, i) {
  return `${trace.world[i].toString(16).padStart(8, '0')}:${trace.athletes[i].map((h) => h.toString(16).padStart(8, '0')).join(',')}`;
}

/** First tick where two traces differ, or null. */
function firstDivergence(a, b) {
  const n = Math.min(a.ticks.length, b.ticks.length);
  for (let i = 0; i < n; i++) {
    if (a.ticks[i] !== b.ticks[i]) return { tick: a.ticks[i], reason: `tick sequence differs (${a.ticks[i]} vs ${b.ticks[i]})` };
    if (rowKey(a, i) !== rowKey(b, i)) return { tick: a.ticks[i], reason: `${rowKey(a, i)} vs ${rowKey(b, i)}` };
  }
  if (a.ticks.length !== b.ticks.length) return { tick: a.ticks[n] ?? b.ticks[n], reason: `length ${a.ticks.length} vs ${b.ticks.length}` };
  return null;
}

/** One digest of the whole trace — the number a report quotes. */
function traceDigest(trace) {
  let h = 0x811c9dc5;
  for (let i = 0; i < trace.ticks.length; i++) {
    const s = rowKey(trace, i);
    for (let c = 0; c < s.length; c++) { h ^= s.charCodeAt(c); h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Expectations: each { match, from, to, min?, max?, label } — the count of
 * event lines whose text includes `match` inside [from, to] must be within
 * [min ?? 1, max ?? Infinity]. max: 0 asserts something did NOT happen.
 */
function checkExpectations(expect, events, facts) {
  const results = [];
  for (const e of expect || []) {
    const min = e.min ?? 1;
    const max = e.max ?? Infinity;
    let count = 0;
    let first = null;
    if (e.log) {
      const hits = events.filter((ev) => ev.tick >= e.from && ev.tick <= e.to && ev.text.includes(e.log));
      count = hits.length;
      first = hits[0] ? `@${hits[0].tick}: ${hits[0].text}` : null;
    } else if (e.when) {
      // eslint-disable-next-line no-new-func
      const pred = new Function(`return (${e.when});`)();
      const rows = facts.filter((f) => f.tick >= e.from && f.tick <= e.to);
      const hits = rows.filter((f) => pred(f));
      count = hits.length;
      if (e.all) {
        const ok = rows.length > 0 && hits.length === rows.length;
        const bad = rows.find((f) => !pred(f));
        results.push({ ...e, ok, count, first: bad ? `first miss @${bad.tick}: ${JSON.stringify(bad)}` : null });
        continue;
      }
      first = hits[0] ? `@${hits[0].tick}: ${JSON.stringify(hits[0])}` : null;
    }
    results.push({ ...e, ok: count >= min && count <= max, count, first });
  }
  return results;
}

async function runScenario(browser, name, args) {
  const scenario = SCENARIOS[name];
  const runs = [];
  for (let r = 0; r < args.runs; r++) {
    const letter = String.fromCharCode(65 + r);
    process.stdout.write(`[trace] ${name} run ${letter} → tick ${scenario.end} … `);
    const t0 = Date.now();
    runs.push(await runOnce(browser, scenario, args.arena, r === 0 ? args.probe : 0));
    console.log(`${runs[r].trace.ticks.length} ticks, ${runs[r].trace.bodies} bodies, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }

  let ok = true;
  const a = runs[0];
  // HARNESS SELF-CHECK: one step per loop frame, or the script is not keyed on ticks.
  for (let r = 0; r < runs.length; r++) {
    const bad = runs[r].pacing.slice(1).filter((n) => n !== 1).length;
    if (bad) { ok = false; console.log(`  FAIL pacing — run ${String.fromCharCode(65 + r)} had ${bad} loop frame(s) that did not take exactly one step`); }
  }
  const digest = traceDigest(a.trace);
  for (let r = 1; r < runs.length; r++) {
    const d = firstDivergence(a.trace, runs[r].trace);
    if (d) { ok = false; console.log(`  DIVERGED run A vs ${String.fromCharCode(65 + r)} at tick ${d.tick}: ${d.reason}`); }
  }
  if (ok && runs.length > 1) console.log(`  self-consistency: ${runs.length} runs identical on all ${a.trace.ticks.length} ticks (digest ${digest})`);

  const checks = checkExpectations(scenario.expect, a.events, a.facts);
  for (const c of checks) {
    ok = ok && c.ok;
    const where = c.first ? `  ${c.first.slice(0, 150)}` : '';
    console.log(`  ${c.ok ? 'OK  ' : 'FAIL'} ${c.label} — ${c.count}${c.all ? ' (all)' : ''} in [${c.from}, ${c.to}]${where}`);
  }

  const file = path.join(BASELINE_DIR, `trace_${args.arena}_${name}.json`);
  const record = {
    scenario: name, arena: args.arena, end: scenario.end, digest,
    bodies: a.trace.bodies,
    rows: a.trace.ticks.map((t, i) => [t, rowKey(a.trace, i)]),
  };
  if (args.record) {
    await mkdir(BASELINE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(record) + '\n');
    console.log(`  recorded ${path.relative(ROOT, file)} (digest ${digest})`);
  }
  if (args.baseline) {
    let base;
    try { base = JSON.parse(await readFile(file, 'utf8')); } catch { fail(`no baseline at ${path.relative(ROOT, file)} — run with --record first`); }
    const baseTrace = { ticks: base.rows.map((r) => r[0]), world: [], athletes: [] };
    const cmp = record.rows.findIndex((row, i) => !base.rows[i] || base.rows[i][0] !== row[0] || base.rows[i][1] !== row[1]);
    if (cmp === -1 && base.rows.length === record.rows.length) {
      console.log(`  baseline: MATCH (${base.digest})`);
    } else {
      ok = false;
      const at = cmp === -1 ? record.rows.length : cmp;
      console.log(`  baseline: DIFFER at tick ${record.rows[at]?.[0] ?? baseTrace.ticks[at]} (now ${record.rows[at]?.[1]}, baseline ${base.rows[at]?.[1]})`);
    }
  }

  if (args.facts) {
    const every = args.probe || 5;
    console.log('  facts (run A):');
    for (const f of a.facts) if (f.tick % every === 0) console.log(`    ${JSON.stringify(f)}`);
  }
  if (args.probe && !args.facts && a.probes.length) {
    console.log('  probes (run A):');
    for (const p of a.probes) console.log(`    ${JSON.stringify(p)}`);
  }
  if (!args.quiet && !ok) {
    console.log('  events (run A):');
    for (const e of a.events) if (!e.text.startsWith('[stateTrace]')) console.log(`    @${e.tick} ${e.text.slice(0, 140)}`);
  }
  return { name, ok, digest };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const names = args.name === 'all' ? Object.keys(SCENARIOS) : [args.name];
  if (await portInUse(PORT)) fail(`port ${PORT} is already in use.`);

  let server;
  try {
    server = await createServer({
      root: ROOT, configFile: path.join(ROOT, 'vite.config.js'), logLevel: 'error',
      server: { port: PORT, strictPort: true },
    });
    await server.listen();
  } catch (error) {
    fail(`could not start the Vite dev server: ${error.message}`);
  }

  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const results = [];
  try {
    for (const name of names) results.push(await runScenario(browser, name, args));
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }

  console.log('');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(12)} ${r.digest}`);
  const allOk = results.every((r) => r.ok);
  console.log(`\nTRACE: ${allOk ? 'PASS' : 'FAIL'}\n`);
  return allOk ? 0 : 1;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error(error instanceof Refusal || error instanceof RunFailure ? `\n[trace] ${error.message}\n` : `\n[trace] unexpected: ${error.stack || error.message}\n`);
    console.error('TRACE: FAIL\n');
    process.exitCode = 1;
  });
