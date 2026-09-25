/**
 * THE PROFILE — where a tick's time goes, headless.
 *
 *   npm run profile                         1 athlete (capture practice), locomotion script, 360 ticks
 *   npm run profile -- --mode match         2 athletes via ?skipMenu=true (a real match, countdown and all)
 *   npm run profile -- --ticks 600
 *
 * Two measurements, both from outside the page:
 *   1. Loop._fixedUpdate and Loop._render wrapped with performance.now(): mean,
 *      p50, p95 and max per tick / per frame.
 *   2. A V8 CPU profile over the same window (Chrome DevTools Protocol),
 *      aggregated by source file and by function, SELF time.
 *
 * CAVEAT, and it matters: this is headless Chromium on SwiftShader. JavaScript
 * and Rapier's WASM cost are representative of a desktop CPU of similar speed;
 * GPU work is not (SwiftShader rasterises on the CPU in another process, which
 * this profile does not see). Read render numbers as "JS cost of issuing the
 * frame", never as frame time on a real GPU. The laptop Chrome trace is the
 * render truth.
 */

import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5183;
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

function parseArgs(argv) {
  const a = { mode: 'practice', ticks: 360, width: 1280, height: 720 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode') a.mode = argv[++i];
    else if (argv[i] === '--ticks') a.ticks = Number(argv[++i]);
    else if (argv[i] === '--small') { a.width = 320; a.height = 180; }
  }
  return a;
}

function shim({ ticks }) {
  const realRaf = window.requestAnimationFrame.bind(window);
  const STEP_MS = 1000 / 60 + 1e-6;
  let clock = 0;
  const pad = { id: 'profile', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  navigator.getGamepads = () => [pad];
  const set = (i, on) => { pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; };
  const timing = { fixed: [], render: [], startTick: -1, done: false };
  window.__vbTiming = timing;
  let wrapped = false;
  const isLoopFrame = (cb) => cb && /_onFrame/.test(cb.name || '');
  window.requestAnimationFrame = (cb) => {
    if (!isLoopFrame(cb)) return realRaf(() => cb(clock));
    return realRaf(() => {
      const loop = window.__vb && window.__vb.loop;
      if (loop && !wrapped) {
        wrapped = true;
        const fu = loop._fixedUpdate;
        const rn = loop._render;
        loop._fixedUpdate = (dt, tick) => {
          const t0 = performance.now();
          fu(dt, tick);
          if (!timing.done) timing.fixed.push(performance.now() - t0);
        };
        loop._render = (alpha) => {
          const t0 = performance.now();
          rn(alpha);
          if (!timing.done) timing.render.push(performance.now() - t0);
        };
      }
      const tick = loop ? loop.tick : 0;
      // The locomotion script: walk, run, sprint, reverse, strafe, stop.
      let ax = [0, 0, 0, 0];
      if (tick >= 36 && tick < 90) ax = [0, -0.45, 0, 0];
      else if (tick >= 90 && tick < 230) ax = [0, -1, 0, 0];
      else if (tick >= 230 && tick < 290) ax = [0, 1, 0, 0];
      else if (tick >= 290 && tick < 340) ax = [1, 0, 0, 0];
      pad.axes = ax;
      set(6, tick >= 150 && tick < 230);
      if (timing.fixed.length >= ticks) timing.done = true;
      clock += STEP_MS;
      pad.timestamp = clock;
      cb(clock);
    });
  };
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  return { n: s.length, mean, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] ?? 0 };
};
const fmt = (st) => `n ${String(st.n).padStart(4)}  mean ${st.mean.toFixed(2).padStart(6)} ms  p50 ${st.p50.toFixed(2).padStart(6)}  p95 ${st.p95.toFixed(2).padStart(6)}  max ${st.max.toFixed(2).padStart(7)}`;

function aggregate(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    self.set(id, (self.get(id) || 0) + (dt[i] || 0));
  }
  const byFile = new Map();
  const byFn = new Map();
  let total = 0;
  for (const [id, us] of self) {
    const n = byId.get(id);
    const cf = n.callFrame;
    let file = cf.url ? cf.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') : `(${cf.functionName || 'native'})`;
    if (/rapier/.test(file)) file = '[rapier wasm/js]';
    else if (/node_modules\/\.vite\/deps\/three|\/three\//.test(file)) file = '[three.js]';
    else if (/wasm:\/\//.test(cf.url)) file = '[wasm]';
    total += us;
    byFile.set(file, (byFile.get(file) || 0) + us);
    const fnKey = `${cf.functionName || '(anon)'}  ${file}:${cf.lineNumber + 1}`;
    byFn.set(fnKey, (byFn.get(fnKey) || 0) + us);
  }
  const top = (m, k) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  return { total, files: top(byFile, 18), fns: top(byFn, 25) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inUse = await new Promise((r) => { const s = net.connect({ port: PORT, host: '127.0.0.1' }); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
  if (inUse) throw new Error(`port ${PORT} in use`);
  const server = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.js'), logLevel: 'error', server: { port: PORT, strictPort: true } });
  await server.listen();
  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: args.width, height: args.height } });
    await page.addInitScript(shim, { ticks: args.ticks });
    const url = args.mode === 'match'
      ? `http://localhost:${PORT}/Valleyball-Versus/?skipMenu=true&mode=match`
      : `http://localhost:${PORT}/Valleyball-Versus/?captureTick=${args.ticks + 40}&arena=court`;
    await page.goto(url, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__vb && window.__vb.loop && window.__vb.loop.tick > 30, null, { timeout: 180_000 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    await page.waitForFunction(() => window.__vbTiming.done, null, { timeout: 600_000, polling: 500 });
    const { profile } = await cdp.send('Profiler.stop');
    const timing = await page.evaluate(() => ({ fixed: window.__vbTiming.fixed, render: window.__vbTiming.render, athletes: window.__vb.athletes.filter((a) => a.motor && a.motor.body.isEnabled()).length, bodies: (() => { let n = 0; window.__vb.loop && 0; return n; })() }));
    const skip = 40; // boot, land, respawn
    const f = stats(timing.fixed.slice(skip));
    const r = stats(timing.render.slice(skip));
    console.log(`\n[profile] mode ${args.mode}, ${args.width}x${args.height}, active athletes ${timing.athletes}, ticks ${timing.fixed.length}`);
    console.log(`  fixedUpdate  ${fmt(f)}`);
    console.log(`  render       ${fmt(r)}`);
    const agg = aggregate(profile);
    console.log(`\n  CPU self time by file (sampled ${(agg.total / 1000).toFixed(0)} ms):`);
    for (const [k, us] of agg.files) console.log(`    ${(100 * us / agg.total).toFixed(1).padStart(5)}%  ${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`);
    console.log('\n  top functions (self):');
    for (const [k, us] of agg.fns) console.log(`    ${(100 * us / agg.total).toFixed(1).padStart(5)}%  ${k.slice(0, 120)}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
