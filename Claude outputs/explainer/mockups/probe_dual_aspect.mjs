// Throwaway probe: render the same deterministic sim tick at 1080x1920 and
// 1920x1080 with hand-placed cameras, to source backgrounds for card mock-ups.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = 'C:/Users/portt/Dev/Valleyball/Valleyball-Versus-AI';
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

const { createServer } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')).href);
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'node_modules/playwright/index.mjs')).href);

const PORT = 5193;
const vite = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.js'),
  logLevel: 'warn',
  server: { port: PORT, strictPort: true },
});
await vite.listen();

const browser = await chromium.launch({
  headless: true,
  args: [
    '--force_high_performance_gpu', '--use-gl=angle', '--use-angle=d3d11',
    '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--no-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1920,1080',
  ],
});
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
page.setDefaultTimeout(600000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`http://localhost:${PORT}/Valleyball-Versus/`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(5000);

const renderer = await page.evaluate(async () => {
  const s = document.createElement('style');
  s.textContent = '#hud,#controls-card,#splitscreen-divider,.lil-gui,#main-menu-root,#title-screen,#loading-screen,#camera-toast{display:none!important}';
  document.head.appendChild(s);
  const vb = window.__vb;
  vb.startMatch([
    { id: 'p1', name: 'Home Bot', team: 'home', variant: 'masculine', cameraMode: 'chase', type: 'ai', difficulty: 'hard', aggressiveness: 0.95, primaryColor: 0xD90429, headwear: 'wrestler_bands' },
    { id: 'p2', name: 'Away Bot', team: 'away', variant: 'feminine', cameraMode: 'chase', type: 'ai', difficulty: 'hard', aggressiveness: 0.95, primaryColor: 0x1D4ED8, headwear: 'wicket_grill' },
  ], { ball: 'medium', duration: 300, arena: 'court' });
  if (vb.skipFlyover) vb.skipFlyover();
  vb.athletes[0]?.setHeadwear?.('wrestler_bands');
  vb.athletes[1]?.setHeadwear?.('wicket_grill');
  if (vb.matchState) { vb.matchState.countdownTicksRemaining = 0; vb.matchState.isCountingDown = false; }
  await new Promise((r) => setTimeout(r, 2500));
  vb.loop.stop();
  const gl = vb.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('[probe] renderer:', renderer);

// Install the dual-aspect shooter in the page.
await page.evaluate(() => {
  const vb = window.__vb;
  const T = vb.THREE;
  const floorY = (x, z) => 1.0 + 0.0045 * z * z + 0.004 * x * x;
  const pickBall = () => vb.allBalls.find((b) => b.mesh?.visible !== false && b.id === 'medium') || vb.allBalls[0];

  function render(cam, w, h) {
    const r = vb.renderer;
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const sky = vb.scene.getObjectByName('celestial-skybox');
    if (sky) sky.position.copy(cam.position);
    r.shadowMap.needsUpdate = true;
    r.render(vb.scene, cam);
    return r.domElement.toDataURL('image/jpeg', 0.93);
  }

  function actionCam(portrait) {
    const ball = pickBall();
    const bp = ball.body.translation();
    let ap = null; let bd = Infinity;
    for (const a of vb.athletes) {
      const p = a.motor.body.translation();
      const d = Math.hypot(p.x - bp.x, p.z - bp.z);
      if (d < bd) { bd = d; ap = p; }
    }
    const tx = (bp.x + ap.x) / 2; const tz = (bp.z + ap.z) / 2;
    const ty = (bp.y + ap.y) / 2 + 0.4;
    // Sit between the action and midcourt, off to one side, looking toward the near ring.
    let dz = tz > 0 ? -1 : 1; let dx = tx > 0 ? -0.55 : 0.55;
    const n = Math.hypot(dx, dz); dx /= n; dz /= n;
    const dist = (portrait ? 5.5 : 7.0) + (portrait ? 0.4 : 0.5) * Math.min(bd, 8);
    const cx = tx + dx * dist; const cz = tz + dz * dist;
    const cy = Math.max(ty + (portrait ? 1.0 : 1.5), floorY(cx, cz) + 1.2);
    const cam = new T.PerspectiveCamera(portrait ? 58 : 44, 1, 0.1, 2000);
    cam.position.set(cx, cy, cz);
    // Compose for the card layout: portrait lifts the subject above the lower
    // card; landscape pushes it right of the lower-left card.
    const fwd = new T.Vector3(tx - cx, 0, tz - cz).normalize();
    const right = new T.Vector3().crossVectors(fwd, new T.Vector3(0, 1, 0)).normalize();
    const side = portrait ? 0 : -1.1;
    cam.lookAt(tx + right.x * side, ty - (portrait ? 1.3 : 0.5), tz + right.z * side);
    return { cam, sep: bd, ballY: bp.y };
  }

  function hoopCam(portrait) {
    const cam = new T.PerspectiveCamera(portrait ? 62 : 48, 1, 0.1, 2000);
    if (portrait) { cam.position.set(13, 10.2, -27); cam.lookAt(0, 11.2, -39.2); }
    else { cam.position.set(16, 10.5, -27); cam.lookAt(0, 9.8, -40); }
    return cam;
  }

  window.__probe = {
    step(n) { for (let i = 0; i < n; i++) vb.stepDeterministicFrame(1 / 60); return vb.loop.tick; },
    sep() {
      const bp = pickBall().body.translation();
      let bd = Infinity;
      for (const a of vb.athletes) { const p = a.motor.body.translation(); bd = Math.min(bd, Math.hypot(p.x - bp.x, p.z - bp.z)); }
      return bd;
    },
    shootAction() {
      const p = actionCam(true); const l = actionCam(false);
      return { tick: vb.loop.tick, sep: p.sep, ballY: p.ballY, portrait: render(p.cam, 1080, 1920), landscape: render(l.cam, 1920, 1080) };
    },
    shootHoop() {
      return { portrait: render(hoopCam(true), 1080, 1920), landscape: render(hoopCam(false), 1920, 1080) };
    },
  };
});

const save = (name, dataUrl) => fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));

await page.evaluate(() => window.__probe.step(240));
const hoop = await page.evaluate(() => window.__probe.shootHoop());
save('hoop_9x16.jpg', hoop.portrait);
save('hoop_16x9.jpg', hoop.landscape);

let shots = 0; let lastShot = -999;
for (let k = 0; k < 160 && shots < 12; k++) {
  const tick = await page.evaluate(() => window.__probe.step(20));
  const sep = await page.evaluate(() => window.__probe.sep());
  if (sep > 2.6 || tick - lastShot < 90) continue;
  lastShot = tick;
  const s = await page.evaluate(() => window.__probe.shootAction());
  const tag = String(shots).padStart(2, '0');
  save(`act_${tag}_9x16.jpg`, s.portrait);
  save(`act_${tag}_16x9.jpg`, s.landscape);
  console.log(`[probe] ${tag} tick ${s.tick} sep ${s.sep.toFixed(2)} m ballY ${s.ballY.toFixed(2)}`);
  shots++;
}

await browser.close();
await vite.close();
console.log('[probe] done');
