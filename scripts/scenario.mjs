/**
 * THE SCENARIO HARNESS — determinism for mechanics the capture run cannot see.
 *
 *   npm run scenario                      the `strike` scenario, two runs
 *   npm run scenario -- --name actions    the slide/dive/knockdown scenario
 *   npm run scenario -- --runs 3          three runs
 *   npm run scenario -- --arena court     in the authored court
 *   npm run scenario -- --trace           print the full state at each anchor
 *
 * WHY THIS EXISTS, WHICH IS THE WHOLE POINT.
 *
 * `npm run determinism` boots the page, runs 300 ticks with no input, and
 * halts. It never touches a gamepad, so it never slides, never dives, never
 * gets knocked down and NEVER STRIKES. Every mechanic a player actually
 * operates is invisible to it. G3.5 moved three of those mechanics between
 * files with the pair passing throughout, and G4 adds a fourth that puts an
 * impulse on a ball — none of which the pair can see.
 *
 * This drives a FIXED input script and compares the simulation state at
 * anchored ticks. It is the input path's regression test, and it is a different
 * measurement from the determinism pair, not a substitute for it.
 *
 * ═══ THE MECHANISM, WRITTEN DOWN SO IT IS NEVER LOST ═══
 *
 * LAW 6 says the simulation is a pure function of the tick FOR A RUN WITH NO
 * INPUT. With input it is a function of (tick, per-FRAME input snapshot):
 * `sampleInput` latches once per rendered frame, and `Loop` then drains however
 * many fixed steps the accumulator holds. A slow headless frame runs five steps
 * against one snapshot and a fast one runs two, so "press at tick 200" lands on
 * a different tick every run and the harness diverges from ITSELF.
 *
 * The first version of this tool did exactly that and reported a false failure.
 *
 * `Loop._onFrame(now)` takes its timestamp as the rAF ARGUMENT. Replacing
 * `requestAnimationFrame` from outside the page with one that feeds a counter
 * advancing by exactly 1000/60 ms makes the accumulator take exactly one fixed
 * step per frame. Tick and frame go 1:1, the pad can be written as a function
 * of the frame index, and injected input becomes a pure function of the tick.
 *
 * Nothing in the project changes. This replaces a browser API from outside, in
 * the same way the gamepad shim does, and the frozen harness files are untouched.
 *
 * ONE-TIME SETUP:  npx playwright install chromium
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5174;
const RUN_TIMEOUT_MS = 300_000;

/** SwiftShader, for the same reason the determinism script needs it. */
const CHROMIUM_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

/**
 * THE SCENARIOS. Each is a pure function from the frame index to a pad state,
 * plus the ticks to compare at.
 *
 * `script` runs INSIDE the page. It may not close over anything out here — it
 * is serialised and injected — so every constant it needs is inlined.
 */
const SCENARIOS = {
  /**
   * G4's gate. Serve the balls to a known place, walk up, volley, then spike.
   *
   * The anchors are chosen to bracket what could break: one before any press,
   * one inside the volley's window, one after the volley has resolved and the
   * ball is away, and one late enough that the spike has resolved too. A
   * divergence anywhere shows up at the first anchor after it.
   */
  strike: {
    anchors: [100, 120, 160, 220],
    // EVERY TICK IN HERE IS MEASURED, AND THE FIRST THREE ATTEMPTS MISSED FOR
    // THREE DIFFERENT REASONS. All three are worth keeping written down.
    //
    // 1. Both strikes are ABOVE-HEAD actions — the volley's hands finish 0.18 m
    //    over the head — so NEITHER CAN REACH A BALL RESTING ON THE FLOOR. A
    //    scripted contact has to meet a ball in the air.
    // 2. The sphere carries a long way after the stick is released, which is the
    //    design goal and not a bug, so "walk to the ball and stop" overshoots.
    //    He strikes ON THE MOVE, which is the harder case and the honest one.
    // 3. THE PROBE WAS MEASURING THE WRONG WORLD. It passed no `?arena=`, so it
    //    ran in the COURT (TUNING.arena.type) while this harness pins `bowl` —
    //    different ball spawns (z 3.0 against 3.5) and a different athlete drop
    //    (y 1.5 against 3.0). Every tick below was re-derived in the bowl.
    //
    // Measured in the BOWL: the serve at 76 puts the middle ball at (0, 4.49,
    // 3.50); it falls to centre 2.35 by tick 114, which is hand height for a
    // ball of radius 0.5. The athlete is closest at that moment — 0.45 m — so
    // the volley is pressed at 87 to put its measured sweet tick (28) on 115.
    //
    // THE PRESSES ARE RANGES, NOT EXACT TICKS, and that is required rather than
    // defensive. The shim reads the tick once per frame; the pinned clock's
    // float accumulation means an occasional frame runs two steps, so a single
    // tick value can be skipped. `tick === 75` silently never fired and the ball
    // was never served — three retimings were computed against a ball that was
    // still doing its boot bounce.
    //
    // The spike at 150 is a DELIBERATE WHIFF: one athlete drifting at 0.027
    // m/tick cannot get back under a second serve in time, and a scenario that
    // only ever connects cannot regress the whiff path, which §6.3 wants anyway.
    script: `(tick, pad, set, key) => {
      pad.axes = tick >= 26 && tick < 84 ? [0, 1, 0, 0] : [0, 0, 0, 0];
      if (tick >= 76 && tick <= 78) key('KeyB');   // serve
      set(1, tick >= 87 && tick < 93);             // East  — the volley, sweet on 115
      set(3, tick >= 150 && tick < 156);           // North — the spike, a deliberate miss
    }`,
  },
  /**
   * G3.5's scenario, kept because it is the regression test for the slide, the
   * dive and the knockdown, and because a harness with one scenario tends to
   * grow a second one badly.
   */
  actions: {
    anchors: [124, 132, 220, 420],
    // The slide, the JUMP-CANCEL, the RE-ENTRY LOCKOUT, a fresh slide after a
    // release, the dive, the dive's jump lockout, and the knockdown.
    //
    // THE JUMP IS AT 125, NINE TICKS INTO THE SLIDE, AND THAT IS THE WHOLE POINT.
    // An earlier version pressed it at 150, by which time 34 ticks of slide
    // resistance had already dropped the athlete under minSlideSpeed (4.0 m/s) —
    // so the slide could not have re-entered whether the lockout existed or not,
    // and the scenario proved nothing about it. Cancelling while he is still fast
    // is the only case that distinguishes the two.
    //
    //   124  sliding, still above the re-entry gate
    //   132  seven ticks after the cancel, TRIGGER STILL DOWN -> must be 0
    //   220  released at 200 and re-pressed at 210 -> a fresh slide is running
    //   420  after the dive, its jump lockout, and the knockdown
    //
    // `allowJump` and `slideNeedsRelease` are only reachable from a scripted
    // press, so this is the only automated coverage either one has.
    script: `(tick, pad, set, key) => {
      pad.axes = tick >= 36 ? [0, -1, 0, 0] : [0, 0, 0, 0];
      set(6, tick >= 36 && tick < 116);      // sprint
      // Slide, cancelled at 125 and held DOWN to 200 — it must not come back.
      // Released for ten ticks, then pressed again: that one must start.
      set(7, (tick >= 116 && tick < 200) || (tick >= 210 && tick < 232));
      set(2, tick >= 236 && tick < 242);     // dive
      // ONE set() PER BUTTON PER FRAME. It is an assignment, not an OR, so two
      // calls on the same index silently leave the LAST one — which cancelled
      // the mid-slide jump entirely the first time this scenario had two of
      // them, and the run passed while testing nothing.
      set(0, (tick >= 125 && tick < 131)     // South — jump, EARLY in the slide
          || (tick >= 250 && tick < 256));   // South again — locked out by the dive
      if (tick >= 316 && tick <= 318) key('KeyT');   // knockdown
    }`,
  },
};

class Refusal extends Error {}
class RunFailure extends Error {}
const fail = (message) => { throw new Refusal(message); };
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function parseArgs(argv) {
  const args = { name: 'strike', runs: 2, arena: 'bowl', trace: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--trace') { args.trace = true; continue; }
    const value = argv[i + 1];
    if (flag === '--name') {
      if (!SCENARIOS[value]) fail(`--name expects one of ${Object.keys(SCENARIOS).join(', ')}, got "${value}"`);
      args.name = value;
    } else if (flag === '--arena') {
      if (value !== 'court' && value !== 'bowl') fail(`--arena expects "court" or "bowl", got "${value}"`);
      args.arena = value;
    } else if (flag === '--runs') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 2) fail(`--runs expects an integer of at least 2, got "${value}"`);
      args.runs = n;
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
 * Installed before any page script runs. See the header for why the rAF
 * replacement is the load-bearing part.
 */
function shim({ scriptSource }) {
  const pad = {
    id: 'scenario', index: 0, connected: true, mapping: 'standard',
    timestamp: 0, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  navigator.getGamepads = () => [pad];

  // eslint-disable-next-line no-new-func
  const script = new Function(`return (${scriptSource});`)();
  const realRaf = window.requestAnimationFrame.bind(window);
  const STEP_MS = 1000 / 60;
  let clock = 0;

  const set = (i, on) => { pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; };
  const key = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));

  // THE SCRIPT IS KEYED ON THE LOOP'S OWN TICK, NOT ON A FRAME COUNT.
  //
  // A frame counter starting at page load is NOT a stable clock: the loop does
  // not start until boot finishes — a GLB parse, an auto-rig, an optional
  // texture — so the offset between "frames since load" and "ticks" depends on
  // how long that took. Two harnesses driving the same script disagreed by two
  // ticks on which limb made contact, and the only difference between them was
  // the viewport, i.e. how fast the first frames rendered.
  //
  // Reading the tick the loop published on the previous frame is a constant
  // offset of exactly one, whatever the boot cost. Once the loop IS running the
  // pinned rAF clock guarantees one tick per frame, so this is stable — which
  // the frame count only appeared to be.
  window.requestAnimationFrame = (cb) => realRaf(() => {
    clock += STEP_MS;
    pad.timestamp = clock;
    const el = document.getElementById('hud-tick');
    const tick = el ? Number(el.textContent) || 0 : 0;
    // The pad is written BEFORE the frame runs, because sampleInput latches at
    // the top of it. Written after, every press would land one tick late.
    script(tick, pad, set, key);
    cb(clock);
  });
}

/** Everything compared between runs. Rounded, because the comparison is exact. */
function readState() {
  const p = window.__vb.probe();
  const g = (id) => document.getElementById(id).textContent;
  const r = (n) => (typeof n === 'number' && Number.isFinite(n) ? +n.toFixed(6) : n);
  return {
    tick: p.tick,
    weight: r(p.weight),
    grounded: p.grounded,
    motor: [r(p.motor.x), r(p.motor.y), r(p.motor.z), r(p.motor.speed)],
    pelvis: [r(p.pelvis.x), r(p.pelvis.y), r(p.pelvis.z), r(p.pelvis.speed)],
    tilt: r(p.tilt),
    targetTilt: r(p.targetTilt),
    // THE BALLS ARE THE POINT of the strike scenario: an impulse that differed
    // between runs by one ULP would show here and nowhere else.
    balls: p.balls.map((b) => [r(b.x), r(b.y), r(b.z), r(b.speed), r(b.spin)]),
    strike: p.strike,
    hud: {
      action: g('hud-action'), blend: g('hud-blend'), shares: g('hud-shares'),
      standup: g('hud-standup'), airborne: g('hud-airborne'), weight: g('hud-weight'),
      strike: g('hud-strike'), strikeHit: g('hud-strikehit'), strikeRate: g('hud-strikerate'),
    },
  };
}

async function runOnce(letter, scenario, arena, tick) {
  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const problems = [];
  const strikeLog = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => {
      const text = m.text();
      if (text.startsWith('[strike]')) strikeLog.push(text);
      if (m.type() === 'error') problems.push(`console.error: ${text}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.addInitScript(shim, { scriptSource: scenario.script });

    const captured = page.waitForResponse(
      (r) => r.url().includes('/__capture') && r.request().method() === 'POST' && r.status() === 200,
      { timeout: RUN_TIMEOUT_MS },
    );
    await page.goto(`http://localhost:${PORT}/?captureTick=${tick}&arena=${arena}`, {
      waitUntil: 'commit', timeout: RUN_TIMEOUT_MS,
    });
    try {
      await captured;
    } catch {
      throw new RunFailure(`run ${letter} @${tick}: no capture within ${RUN_TIMEOUT_MS / 1000}s`);
    }
    // The halt re-renders once; let it land before the DOM is read.
    await page.waitForTimeout(300);

    const state = await page.evaluate(readState);
    const png = await readFile(path.join(ROOT, 'captures', `auto_t${tick}.png`));
    if (problems.length) {
      throw new RunFailure(`run ${letter} @${tick} reported ${problems.length} page problem(s):\n  ${problems.join('\n  ')}`);
    }
    return { state, png: sha256(png), strikeLog };
  } finally {
    await browser.close();
  }
}

function compare(runs, anchors, trace) {
  let ok = true;
  console.log(`${'tick'.padStart(6)}  ${'png'.padEnd(18)} state`);
  for (const tick of anchors) {
    const first = runs[0][tick];
    const samePng = runs.every((r) => r[tick].png === first.png);
    const sameState = runs.every((r) => JSON.stringify(r[tick].state) === JSON.stringify(first.state));
    ok = ok && samePng && sameState;
    console.log(
      `${String(tick).padStart(6)}  ${first.png.slice(0, 16).padEnd(18)}` +
        `${samePng ? 'png MATCH' : 'png DIFFER'}  ${sameState ? 'state MATCH' : 'state DIFFER'}`,
    );
    if (!sameState) {
      for (const key of Object.keys(first.state)) {
        for (let i = 1; i < runs.length; i += 1) {
          const a = JSON.stringify(first.state[key]);
          const b = JSON.stringify(runs[i][tick].state[key]);
          if (a !== b) console.log(`          DIFF ${key}\n            A ${a}\n            ${String.fromCharCode(65 + i)} ${b}`);
        }
      }
    }
    if (trace) console.log(`          ${JSON.stringify(first.state)}`);
  }
  return ok;
}

async function main() {
  const { name, runs, arena, trace } = parseArgs(process.argv.slice(2));
  const scenario = SCENARIOS[name];

  if (await portInUse(PORT)) {
    fail(`port ${PORT} is already in use. Stop whatever is on it and try again.`);
  }

  const letters = Array.from({ length: runs }, (_, i) => String.fromCharCode(65 + i));
  console.log(
    `[scenario] "${name}", arena ${arena}, ${runs} runs (${letters.join(', ')}), ` +
      `anchors ${scenario.anchors.join(', ')}, headless SwiftShader with the frame clock pinned\n`,
  );

  let server;
  try {
    server = await createServer({
      root: ROOT,
      configFile: path.join(ROOT, 'vite.config.js'),
      logLevel: 'warn',
      server: { port: PORT, strictPort: true },
    });
    await server.listen();
  } catch (error) {
    fail(`could not start the Vite dev server: ${error.message}`);
  }

  const results = [];
  try {
    for (const letter of letters) {
      const byTick = {};
      for (const tick of scenario.anchors) {
        process.stdout.write(`[scenario] run ${letter} @${tick} … `);
        byTick[tick] = await runOnce(letter, scenario, arena, tick);
        console.log('done');
      }
      results.push(byTick);
    }
  } finally {
    await server.close().catch(() => {});
  }

  console.log('');
  const identical = compare(results, scenario.anchors, trace);

  // The strike log from the deepest anchor of run A — the §6.5 calibration
  // lines, which are only produced by a run that actually struck something.
  const deepest = scenario.anchors[scenario.anchors.length - 1];
  const log = results[0][deepest].strikeLog;
  if (log.length) {
    console.log('\nresolved strikes in run A:');
    for (const line of log) console.log(`  ${line}`);
  }

  console.log(`\nSELF-CONSISTENCY: ${identical ? 'PASS' : 'FAIL'}\n`);
  return identical ? 0 : 1;
}

/** Nothing calls process.exit(), for the reason spelled out in determinism.mjs. */
main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    if (error instanceof Refusal) {
      console.error(`\n[scenario] ${error.message}\n`);
    } else if (error instanceof RunFailure) {
      console.error(`\n[scenario] ${error.message}`);
      console.error('\nSELF-CONSISTENCY: FAIL\n');
    } else {
      console.error(`\n[scenario] unexpected: ${error.stack || error.message}`);
      console.error('\nSELF-CONSISTENCY: FAIL\n');
    }
    process.exitCode = 1;
  });
