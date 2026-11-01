/**
 * HOW TO PLAY EXPLAINER — deterministic bot-match capture, rendered natively
 * at 16:9 and 9:16 from the same simulation.
 *
 *   node scripts/capture-explainer.mjs check                      replay a match in two page loads and compare state
 *   node scripts/capture-explainer.mjs mine <matchId> [seconds]   record per-tick trajectories + mechanic events
 *   node scripts/capture-explainer.mjs audition <auditions.json> [parallel]   try staged takes from a mined moment
 *   node scripts/capture-explainer.mjs render <shots.json> [shotId,...]   encode shots (both aspects as listed)
 *
 * WHY IT REPLAYS. A shot is chosen after the fact from a mined event log, so
 * the match is simulated once to find the moment and again to film it. That
 * only works if a fresh page load reproduces the match exactly, so:
 *   - Math.random is a seeded generator from the first script on the page,
 *     reseeded from (match seed, match tick) before every step, which also
 *     isolates the simulation from any render-time draws;
 *   - the real-time loop is stopped and loop.tick pinned before the match
 *     starts, so tick-phase logic (bot strategy intervals) lines up;
 *   - the game's own canvas render is suppressed while stepping; each shot
 *     renders through its own camera, after the step, at its own size.
 * `check` proves the property before anything is filmed.
 *
 * Nothing here writes athlete transforms (Law 1). Staged shots only hold an
 * input (brace) or place and launch the ball, the same as a serve.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'captures', 'explainer');
const MINE_DIR = path.join(OUT, 'mine');
const SHOT_DIR = path.join(OUT, 'shots');
// XP_PORT_OFFSET lets several captures run side by side.
const PORT_OFFSET = parseInt(process.env.XP_PORT_OFFSET ?? '0', 10);
const VITE_PORT = 5195 + PORT_OFFSET * 2;
const FRAME_PORT = 5196 + PORT_OFFSET * 2;
const MATCH_START_TICK = 100000;

// Bot pairings filmed for the explainer. Seeds are arbitrary but fixed.
export const MATCHES = {
  m_medium: {
    seed: 1101, ball: 'medium',
    home: { variant: 'masculine', color: 0xD90429, headwear: 'wrestler_bands', difficulty: 'hard', agg: 0.85 },
    away: { variant: 'feminine', color: 0x1D4ED8, headwear: 'wicket_grill', difficulty: 'hard', agg: 0.85 },
  },
  m_small: {
    seed: 2203, ball: 'small',
    home: { variant: 'classic', color: 0xFFD000, headwear: 'sensor_visor', difficulty: 'hard', agg: 0.85 },
    away: { variant: 'masculine', color: 0x8B5CF6, headwear: 'ouendan_knot', difficulty: 'hard', agg: 0.85 },
  },
  m_large: {
    seed: 3307, ball: 'large',
    home: { variant: 'feminine', color: 0x10E56A, headwear: 'couture_wrap', difficulty: 'hard', agg: 0.85 },
    away: { variant: 'classic', color: 0xFF6B00, headwear: 'broadcaster_mic', difficulty: 'hard', agg: 0.85 },
  },
  m_medium2: {
    seed: 4409, ball: 'medium',
    home: { variant: 'classic', color: 0x00E5FF, headwear: 'terrace_visor', difficulty: 'hard', agg: 0.9 },
    away: { variant: 'masculine', color: 0xF8FAFC, headwear: 'rigger_band', difficulty: 'hard', agg: 0.9 },
  },
  m_medium3: {
    seed: 5501, ball: 'medium',
    home: { variant: 'feminine', color: 0xFFD000, headwear: 'cursor_cap', difficulty: 'hard', agg: 0.9 },
    away: { variant: 'classic', color: 0x8B5CF6, headwear: 'manager_cap', difficulty: 'hard', agg: 0.9 },
  },
  m_medium4: {
    seed: 8807, ball: 'medium',
    home: { variant: 'masculine', color: 0xD90429, headwear: 'wrestler_bands', difficulty: 'hard', agg: 0.95 },
    away: { variant: 'masculine', color: 0x1D4ED8, headwear: 'wicket_grill', difficulty: 'hard', agg: 0.95 },
  },
  m_medium5: {
    seed: 9901, ball: 'medium',
    home: { variant: 'classic', color: 0x10E56A, headwear: 'ouendan_knot', difficulty: 'hard', agg: 0.9 },
    away: { variant: 'feminine', color: 0xFF6B00, headwear: 'sensor_visor', difficulty: 'hard', agg: 0.9 },
  },
  m_large2: {
    seed: 6607, ball: 'large',
    home: { variant: 'masculine', color: 0xD90429, headwear: 'wrestler_bands', difficulty: 'hard', agg: 0.9 },
    away: { variant: 'feminine', color: 0x1D4ED8, headwear: 'wicket_grill', difficulty: 'hard', agg: 0.9 },
  },
  m_small2: {
    seed: 7703, ball: 'small',
    home: { variant: 'feminine', color: 0xD90429, headwear: 'couture_wrap', difficulty: 'hard', agg: 0.9 },
    away: { variant: 'classic', color: 0x1D4ED8, headwear: 'cursor_cap', difficulty: 'hard', agg: 0.9 },
  },
};

// Seeded Math.random, installed before any page script runs. requestAnimationFrame
// is held too, so the game never runs in real time: menu-phase physics and
// animation would otherwise carry into the match and differ between loads.
const INIT_SCRIPT = `(() => {
  window.requestAnimationFrame = () => 0;
  window.cancelAnimationFrame = () => {};
  let s = 0x9E3779B9 >>> 0;
  Math.random = function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  window.__reseed = (seed) => { s = seed >>> 0; };
})();`;

// In-page capture library. Serialized into the page as a string.
function installLibrary(startTick) {
  const vb = window.__vb;
  const r = vb.renderer;
  const realRender = r.render.bind(r);
  let suppress = false;
  r.render = (scene, cam) => {
    if (suppress && r.getRenderTarget() === null) return;
    realRender(scene, cam);
  };
  const KIND = { 0: 'none', 1: 'volley', 2: 'spike', 3: 'kick' };
  const T = vb.THREE;
  const cam = new T.PerspectiveCamera(50, 16 / 9, 0.1, 2000);
  const sky = vb.scene.getObjectByName('celestial-skybox');
  let seed = 1;
  let ballId = 'medium';
  let prev = null;
  let forced = null;
  const relTick = () => vb.loop.tick - startTick;
  const activeBall = () => vb.allBalls.find((b) => b.id === ballId) || vb.allBalls[0];

  function setupMatch(spec) {
    vb.loop.stop();
    seed = spec.seed;
    ballId = spec.ball;
    vb.loop.tick = startTick;
    window.__reseed(spec.seed);
    const cfg = (side, team, id) => ({
      id, name: `${team} bot`, team, variant: side.variant, cameraMode: 'chase', type: 'ai',
      difficulty: side.difficulty, aggressiveness: side.agg, primaryColor: side.color, headwear: side.headwear,
    });
    vb.startMatch([cfg(spec.home, 'home', 'p1'), cfg(spec.away, 'away', 'p2')], { ball: spec.ball, duration: 300, arena: 'court' });
    if (vb.skipFlyover) vb.skipFlyover();
    vb.athletes[0]?.setHeadwear?.(spec.home.headwear);
    vb.athletes[1]?.setHeadwear?.(spec.away.headwear);
    vb.matchState.countdownTicksRemaining = 0;
    vb.matchState.isCountingDown = false;
    vb.loop.stop();
    vb.loop.tick = startTick;
    if (vb.scoreboards?.group) vb.scoreboards.group.visible = true;
    if (vb.hustleBoards?.group) vb.hustleBoards.group.visible = true;
    suppress = true;
    prev = null;
    forced = null;
  }

  // Staged inputs: hold brace on one athlete's slot for a tick range.
  function forceBrace(athlete, from, to) {
    const slot = vb.getInputSlot(athlete);
    let held = slot.braceHeld;
    Object.defineProperty(slot, 'braceHeld', {
      configurable: true,
      get() { const t = relTick(); return (t >= from && t < to) ? true : held; },
      set(v) { held = v; },
    });
    forced = { athlete, from, to };
  }

  // Staged inputs: drive one athlete's input slot like a player would, for a
  // tick window. Movement heads for `target` (world x,z) and stops there; the
  // body faces `aimYaw`; jump/spike/volley press on the listed ticks. Outside
  // the window the bot's own writes pass through untouched.
  function puppet(spec) {
    const slot = vb.getInputSlot(spec.athlete);
    const body = vb.athletes[spec.athlete].motor.body;
    const on = () => { const t = relTick(); return t >= spec.from && t < spec.to; };
    const move = new T.Vector3();
    const presses = { jumpQueued: spec.jump ?? [], spikeQueued: spec.spike ?? [], volleyQueued: spec.volley ?? [] };
    const override = (key, value) => {
      let held = slot[key];
      Object.defineProperty(slot, key, {
        configurable: true,
        get() { return on() ? value() : held; },
        set(v) { held = v; },
      });
    };
    override('moveWorld', () => {
      if (!spec.target) return move.set(0, 0, 0);
      const p = body.translation();
      const dx = spec.target[0] - p.x, dz = spec.target[1] - p.z, d = Math.hypot(dx, dz);
      if (d < 0.15) return move.set(0, 0, 0);
      const k = Math.min(1, d / 1.5) / d;
      return move.set(dx * k, 0, dz * k);
    });
    override('sprintHeld', () => !!spec.sprint);
    // The bot's own dive, cut and slide calls stay off while the puppet drives.
    override('diveQueued', () => false);
    override('cutQueued', () => false);
    override('slideHeld', () => false);
    override('hasAim', () => true);
    override('aimYaw', () => spec.aimYaw);
    override('cameraYaw', () => spec.aimYaw);
    for (const [key, ticks] of Object.entries(presses)) {
      let held = slot[key];
      Object.defineProperty(slot, key, {
        configurable: true,
        get() { return on() ? ticks.includes(relTick()) : held; },
        set(v) { held = v; },
      });
    }
  }

  function launchBall(p, v) {
    const b = activeBall();
    b.body.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
    b.body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    // A placement is not travel: move the hoop-crossing tracker with the ball,
    // or a jump across a ring's plane scores a phantom goal and flips ends.
    const tracker = vb.matchState.ballTrackers?.get(b.collider.handle);
    if (tracker) {
      tracker.prevX = p[0]; tracker.prevY = p[1]; tracker.prevZ = p[2];
      if (Math.abs(p[0]) > vb.tuning.match.hoopRearmX) { tracker.armedN = true; tracker.armedS = true; }
    }
  }

  function stepOne() {
    window.__reseed((Math.imul(seed, 2654435761) ^ Math.imul(relTick() + 1, 40503)) >>> 0);
    vb.stepDeterministicFrame(1 / 60);
  }

  const r3 = (v) => Math.round(v * 1000) / 1000;
  function sample() {
    const b = activeBall().body;
    const bp = b.translation(), bv = b.linvel();
    const out = { t: relTick(), b: [r3(bp.x), r3(bp.y), r3(bp.z), r3(bv.x), r3(bv.y), r3(bv.z)], a: [], ev: [] };
    const ms = vb.matchState;
    vb.athletes.forEach((a, i) => {
      const p = a.motor.body.translation(), v = a.motor.body.linvel();
      out.a.push([r3(p.x), r3(p.y), r3(p.z), r3(v.x), r3(v.z), r3(a.animTarget?.yaw ?? 0), r3(a.tracker.weight)]);
      const st = a.strikeState, ac = a.actionState;
      const cur = {
        resolved: st.resolvedCount, press: st.lastStrikeTick, dive: ac.lastDiveTick, cut: ac.lastCutTick,
        jump: a.motor.lastJumpTick, slide: ac.slideTime, brace: ac.braceMix, weight: a.tracker.weight, tackle: a._lastTackleTick ?? null,
      };
      const p0 = prev?.a[i];
      if (p0) {
        if (cur.resolved !== p0.resolved) out.ev.push({ k: 'strike', who: i, kind: KIND[st.lastStrikeKind], q: r3(st.lastContactQuality), v: r3(st.lastLaunchSpeed) });
        if (cur.dive !== p0.dive) out.ev.push({ k: 'dive', who: i });
        if (cur.cut !== p0.cut) out.ev.push({ k: 'cut', who: i, speed: r3(Math.hypot(v.x, v.z)) });
        if (cur.jump !== p0.jump) out.ev.push({ k: 'jump', who: i });
        if (cur.slide === 1 && p0.slide !== 1) out.ev.push({ k: 'slide', who: i, speed: r3(Math.hypot(v.x, v.z)) });
        if (cur.tackle !== p0.tackle) out.ev.push({ k: 'tackle', who: i });
        if (cur.weight < 0.3 && p0.weight >= 0.3) out.ev.push({ k: 'knockdown', who: i });
        if (cur.weight >= 0.95 && p0.weight < 0.95) out.ev.push({ k: 'standup', who: i });
      }
      (out._a ||= []).push(cur);
    });
    if (prev && (ms.scoreHome !== prev.sh || ms.scoreAway !== prev.sa)) {
      out.ev.push({ k: 'goal', home: ms.scoreHome, away: ms.scoreAway, target: ms.targetGoal });
    }
    prev = { t: out.t, a: out._a, sh: ms.scoreHome, sa: ms.scoreAway };
    delete out._a;
    if (out.ev.length === 0) delete out.ev;
    return out;
  }

  // Steps n ticks; returns per-tick samples when record is set. A recorded run
  // after unrecorded steps first re-samples, so events diff against now.
  function step(n, record) {
    const rows = [];
    if (record && prev?.t !== relTick()) sample();
    for (let i = 0; i < n; i++) {
      stepOne();
      if (record) rows.push(sample());
    }
    return rows;
  }

  function hash() {
    let h = 2166136261 >>> 0;
    const mix = (x) => { const s = x.toFixed(5); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; };
    for (const a of vb.athletes) {
      const p = a.motor.body.translation(); mix(p.x); mix(p.y); mix(p.z);
      for (const body of Object.values(a.ragdoll?.bodies ?? {})) { const q = body.translation?.(); if (q) { mix(q.x); mix(q.y); mix(q.z); } }
    }
    for (const b of vb.allBalls) { const p = b.body.translation(); mix(p.x); mix(p.y); mix(p.z); }
    mix(vb.matchState.scoreHome); mix(vb.matchState.scoreAway);
    return { tick: relTick(), hash: h.toString(16), score: [vb.matchState.scoreHome, vb.matchState.scoreAway] };
  }

  // Render the current state through a shot camera at w x h and post the frame.
  async function shoot(c, w, h, url) {
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    cam.fov = c.f; cam.aspect = w / h;
    cam.position.set(c.p[0], c.p[1], c.p[2]);
    cam.up.set(0, 1, 0);
    cam.lookAt(c.l[0], c.l[1], c.l[2]);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    if (sky) sky.position.copy(cam.position);
    r.shadowMap.needsUpdate = true;
    realRender(vb.scene, cam);
    const blob = await new Promise((res) => r.domElement.toBlob(res, 'image/jpeg', 0.93));
    await fetch(url, { method: 'POST', body: blob });
  }

  window.__xp = { setupMatch, step, hash, shoot, forceBrace, puppet, launchBall, relTick };
}

async function boot(viewport) {
  const vite = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.js'), logLevel: 'warn', server: { port: VITE_PORT, strictPort: true } });
  await vite.listen();
  const browser = await chromium.launch({
    headless: true,
    args: ['--force_high_performance_gpu', '--use-gl=angle', '--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist',
      '--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const newPage = async () => {
    const page = await (await browser.newContext({ viewport, deviceScaleFactor: 1 })).newPage();
    page.setDefaultTimeout(0);
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.addInitScript(INIT_SCRIPT);
    await page.goto(`http://localhost:${VITE_PORT}/Valleyball-Versus/`, { waitUntil: 'load', timeout: 120000 });
    // Timer polling: the default polls on animation frames, which are held.
    await page.waitForFunction(() => window.__vb?.startMatch && window.__vb?.stepDeterministicFrame && window.__vb.athletes?.length >= 2,
      null, { timeout: 120000, polling: 250 });
    await page.waitForTimeout(3000);
    await page.addStyleTag({ content: '#hud,#controls-card,#splitscreen-divider,.lil-gui,#main-menu-root,#title-screen,#loading-screen,#camera-toast{display:none!important}' });
    await page.evaluate(`(${installLibrary.toString()})(${MATCH_START_TICK})`);
    return page;
  };
  return { vite, browser, newPage, close: async () => { await browser.close(); await vite.close(); } };
}

async function cmdCheck() {
  const ticks = 3600;
  const results = [];
  const env = await boot({ width: 1280, height: 720 });
  try {
    for (const [label, viewport] of [['run A 1280x720', null], ['run B fresh page', null]]) {
      const page = await env.newPage();
      if (label.includes('B')) await page.setViewportSize({ width: 720, height: 1280 });
      await page.evaluate((spec) => window.__xp.setupMatch(spec), MATCHES.m_medium);
      const t0 = Date.now();
      const marks = [];
      for (let done = 0; done < ticks; done += 600) {
        await page.evaluate(() => window.__xp.step(600, false));
        marks.push(await page.evaluate(() => window.__xp.hash()));
      }
      results.push({ label, marks, tps: Math.round(ticks / ((Date.now() - t0) / 1000)) });
      await page.context().close();
    }
  } finally { await env.close(); }
  for (const r of results) console.log(`${r.label}: ${r.tps} ticks/s | ${r.marks.map((m) => `${m.tick}:${m.hash}`).join(' ')} | score ${r.marks.at(-1).score}`);
  const same = results[0].marks.every((m, i) => m.hash === results[1].marks[i].hash);
  console.log(same ? 'DETERMINISTIC: every checkpoint matches' : 'DIVERGED: checkpoints differ');
  process.exitCode = same ? 0 : 1;
}

async function cmdMine(matchId, seconds) {
  const spec = MATCHES[matchId];
  if (!spec) throw new Error(`unknown match ${matchId}`);
  fs.mkdirSync(MINE_DIR, { recursive: true });
  const env = await boot({ width: 1280, height: 720 });
  const rows = [];
  try {
    const page = await env.newPage();
    await page.evaluate((s) => window.__xp.setupMatch(s), spec);
    const total = seconds * 60;
    const t0 = Date.now();
    for (let done = 0; done < total; done += 600) {
      rows.push(...await page.evaluate((n) => window.__xp.step(n, true), Math.min(600, total - done)));
      if ((done / 600) % 5 === 0) console.log(`[mine ${matchId}] ${((done + 600) / 60).toFixed(0)} s simulated (${Math.round((done + 600) / ((Date.now() - t0) / 1000))} ticks/s)`);
    }
    rows.push({ final: await page.evaluate(() => window.__xp.hash()) });
  } finally { await env.close(); }
  const file = path.join(MINE_DIR, `${matchId}.json`);
  fs.writeFileSync(file, JSON.stringify({ matchId, spec, rows }));
  const counts = {};
  for (const r of rows) for (const e of r.ev ?? []) counts[e.k] = (counts[e.k] ?? 0) + 1;
  console.log(`[mine ${matchId}] wrote ${path.relative(ROOT, file)} | events ${JSON.stringify(counts)}`);
}

/**
 * auditions.json: [{ id, match, launch: { tick, p, v }, brace?: { athlete, from, to }, steps }]
 * Each audition replays its match to the launch tick in a fresh page, applies
 * the staging, and records what follows. Rendering a winning take later with
 * the same stage reproduces it exactly.
 */
async function cmdAudition(file, parallel) {
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dir = path.join(OUT, 'audition');
  fs.mkdirSync(dir, { recursive: true });
  const env = await boot({ width: 640, height: 360 });
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const a = list[next++];
      const page = await env.newPage();
      await page.evaluate((s) => window.__xp.setupMatch(s), MATCHES[a.match]);
      if (a.brace) await page.evaluate((b) => window.__xp.forceBrace(b.athlete, b.from, b.to), a.brace);
      if (a.puppet) await page.evaluate((p) => window.__xp.puppet(p), a.puppet);
      for (let t = 0; t < a.launch.tick - 1;) {
        const n = Math.min(600, a.launch.tick - 1 - t);
        await page.evaluate((k) => window.__xp.step(k, false), n);
        t += n;
      }
      await page.evaluate((l) => window.__xp.launchBall(l.p, l.v), a.launch);
      const rows = await page.evaluate((n) => window.__xp.step(n, true), a.steps ?? 240);
      await page.context().close();
      fs.writeFileSync(path.join(dir, `${a.id}.json`), JSON.stringify({ audition: a, rows }));
      const ev = rows.flatMap((r) => (r.ev ?? []).map((e) => `${e.k}${e.kind ? ':' + e.kind : ''}${e.who !== undefined ? '@' + e.who : ''}+${r.t - a.launch.tick}`));
      console.log(`[audition] ${a.id}: ${ev.join(' ') || '(nothing)'}`);
    }
  };
  try { await Promise.all(Array.from({ length: parallel }, worker)); } finally { await env.close(); }
}

/** One ffmpeg per shot; frames arrive as JPEG POSTs routed by shot key. */
function startFrameServer() {
  const sinks = new Map();
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Private-Network': 'true',
  };
  const server = http.createServer((req, res) => {
    // A JPEG body is not a CORS-simple request, so the page preflights first.
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const key = decodeURIComponent(req.url.slice(1));
    const sink = sinks.get(key);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (sink?.still) fs.writeFileSync(sink.still, Buffer.concat(chunks));
      else if (sink) sink.stdin.write(Buffer.concat(chunks));
      res.writeHead(200, cors);
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(FRAME_PORT, '127.0.0.1', () => resolve({
    open(key, outFile) {
      if (outFile.endsWith('.jpg')) { sinks.set(key, { still: outFile }); return; }
      const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', '60', '-i', 'pipe:0',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '60', outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
      sinks.set(key, ff);
    },
    close(key) {
      const ff = sinks.get(key); sinks.delete(key);
      if (ff.still) return Promise.resolve();
      return new Promise((res) => { ff.on('close', res); ff.stdin.end(); });
    },
    stop() { return new Promise((res) => server.close(res)); },
  })));
}

/**
 * shots.json: { shots: [{ id, match, w, h, start, end, cams: [{p,l,f} per frame], stage? }] }
 * Shots of one match replay together in tick order; a staged shot replays its
 * match on its own, since staging changes everything after it.
 */
async function cmdRender(shotsFile, only, groupFilter) {
  const plan = JSON.parse(fs.readFileSync(shotsFile, 'utf8'));
  let shots = plan.shots;
  if (only) shots = shots.filter((s) => only.includes(s.id));
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const groups = [];
  for (const s of shots) {
    const key = s.stage ? `${s.match}#${s.stageKey}` : s.match;
    if (groupFilter && !groupFilter.includes(key)) continue;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push(g = { key, match: s.match, shots: [] });
    g.shots.push(s);
  }
  for (const s of shots) if (s.out) fs.mkdirSync(path.dirname(s.out), { recursive: true });
  const frames = await startFrameServer();
  const env = await boot({ width: 1280, height: 720 });
  try {
    for (const g of groups) {
      const page = await env.newPage();
      await page.evaluate((s) => window.__xp.setupMatch(s), MATCHES[g.match]);
      const order = [...g.shots].sort((a, b) => a.start - b.start);
      const lastTick = Math.max(...order.map((s) => s.end));
      const t0 = Date.now();
      for (const s of order) if (s.stage?.brace) await page.evaluate((b) => window.__xp.forceBrace(b.athlete, b.from, b.to), s.stage.brace);
      for (const s of order) if (s.stage?.puppet) await page.evaluate((p) => window.__xp.puppet(p), s.stage.puppet);
      let tick = 0;
      const open = new Set();
      while (tick < lastTick) {
        const starting = order.filter((s) => s.start === tick + 1);
        for (const s of starting) { frames.open(s.id, s.out ?? path.join(SHOT_DIR, `${s.id}.mp4`)); open.add(s); }
        const launch = order.find((s) => s.stage?.launch && s.stage.launch.tick === tick + 1);
        if (launch) await page.evaluate((l) => window.__xp.launchBall(l.p, l.v), launch.stage.launch);
        const active = order.filter((s) => tick + 1 >= s.start && tick + 1 <= s.end);
        if (active.length === 0) {
          // Fast-forward in batches, stopping before every shot start AND every
          // staged ball placement: a placement only applies at a loop top where
          // tick + 1 is its tick, and a batch that steps past it skips it.
          const next = Math.min(
            ...order.filter((s) => s.start > tick + 1).map((s) => s.start),
            ...order.filter((s) => s.stage?.launch?.tick > tick + 1).map((s) => s.stage.launch.tick),
            lastTick + 1,
          );
          const n = Math.max(1, Math.min(600, next - 1 - tick));
          await page.evaluate((k) => window.__xp.step(k, false), n);
          tick += n;
          continue;
        }
        await page.evaluate(async ({ shots, frameUrl }) => {
          window.__xp.step(1, false);
          for (const s of shots) await window.__xp.shoot(s.c, s.w, s.h, `${frameUrl}/${encodeURIComponent(s.id)}`);
        }, { shots: active.map((s) => ({ id: s.id, w: s.w, h: s.h, c: s.cams[tick + 1 - s.start] })), frameUrl: `http://127.0.0.1:${FRAME_PORT}` });
        tick += 1;
        for (const s of active.filter((x) => x.end === tick)) { await frames.close(s.id); open.delete(s); console.log(`[render] ${s.id} done (${((Date.now() - t0) / 1000).toFixed(0)} s)`); }
      }
      await page.context().close();
    }
  } finally {
    await env.close();
    await frames.stop();
  }
}

const [cmd, ...args] = process.argv.slice(2);
const run = {
  check: () => cmdCheck(),
  mine: () => cmdMine(args[0], parseFloat(args[1] ?? '300')),
  audition: () => cmdAudition(args[0], parseInt(args[1] ?? '4', 10)),
  render: () => cmdRender(args[0], args[1] && args[1] !== '-' ? args[1].split(',') : null, args[2]?.split(',')),
}[cmd];
if (!run) {
  console.log('usage: capture-explainer.mjs check | mine <matchId> [seconds] | audition <auditions.json> [parallel] | render <shots.json> [ids]');
  process.exit(1);
}
run().catch((err) => { console.error(err); process.exit(1); });
