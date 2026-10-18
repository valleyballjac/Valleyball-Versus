/**
 * INTERACTIVE HEADWEAR SELECTOR TEST (Series 1 playtest cycle).
 *
 *   node scripts/test_headwear_selector.mjs
 *   VITE_PORT=5210 node scripts/test_headwear_selector.mjs   (port override)
 *
 * Drives the real page in headless Chromium (SwiftShader), the same renderer
 * world the determinism pair runs in. It starts its own Vite dev server and
 * boots `?skipMenu=true&mode=practice` so both athletes exist and the loop is
 * live before the first keypress.
 *
 * WHAT IT ASSERTS (hard failures):
 *   1. Eight-state cycling. Digit3 (P1) and Digit8 (P2) walk exactly the eight
 *      stated playtest ids in catalog order, wrapping cleanly, over two full
 *      P1 laps (16 presses): cap_forward, cap_backward, beanie, visor,
 *      headband, goggles, bucket_hat, none.
 *   2. Debug HUD route. The lil-gui "cosmetics (headwear)" P1/P2 dropdown
 *      controllers exist and every one of the eight ids can be set through
 *      them, landing on the athlete and syncing the shared holder.
 *   3. Sole-child scene-graph attachment. After every single change the head's
 *      render-only headwearSlot holds exactly one child named headwear-<id>,
 *      or zero children for 'none'. No accumulation, no orphans.
 *   4. Zero collider effects. world.colliders.len() is identical before and
 *      after the whole cycling session (headwear is render-only, Law 10).
 *   5. Render loop continuity. loop.tick advances monotonically throughout and
 *      gains at least 30 ticks (half a second at 60 Hz) across the session.
 *   6. No runtime exceptions. Any pageerror or console.error fails the run;
 *      this includes the once-a-second invariant audits in main.js.
 *
 * EVIDENCE (best effort, written to captures/headwear_selector/):
 *   idle, running (KeyW held), diving (requestKnockdown) and striking
 *   (volleyQueued via the input router slot) screenshots with headwear
 *   mounted, so the fit can be eyeballed in action poses.
 *
 * ONE-TIME SETUP: npx playwright install chromium  (same as determinism).
 * Exit code is SET, never forced (see determinism.mjs for why).
 */

import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.VITE_PORT ? parseInt(process.env.VITE_PORT, 10) : 5197;
const BOOT_TIMEOUT_MS = 240_000;
const EVIDENCE_DIR = path.join(ROOT, 'captures', 'headwear_selector');

const CHROMIUM_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

/** The eight stated playtest ids, in cycle order. Stated here independently on
 *  purpose: the test must not import its expectations from the module under
 *  test, or a rename would silently pass. */
const EXPECTED_IDS = [
  'cap_forward',
  'cap_backward',
  'beanie',
  'visor',
  'headband',
  'goggles',
  'bucket_hat',
  'none',
];

class Refusal extends Error {}

function fail(message) {
  throw new Refusal(message);
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

async function main() {
  if (await portInUse(PORT)) {
    fail(`port ${PORT} is already in use. Stop the other server or set VITE_PORT to a free port.`);
  }
  await mkdir(EVIDENCE_DIR, { recursive: true });

  const failures = [];
  const problems = [];
  const check = (ok, label) => {
    if (ok) {
      console.log(`  PASS  ${label}`);
    } else {
      console.log(`  FAIL  ${label}`);
      failures.push(label);
    }
  };

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

  console.log(`[headwear-selector] port ${PORT}, headless SwiftShader, practice mode\n`);

  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

    await page.goto(`http://localhost:${PORT}/?skipMenu=true&mode=practice`, {
      waitUntil: 'commit',
      timeout: BOOT_TIMEOUT_MS,
    });
    await page.waitForFunction(
      () => window.__vb?.loop?.tick > 0 && (window.__vb?.athletes?.length ?? 0) >= 2 && !!window.__vb?.gui,
      null,
      { timeout: BOOT_TIMEOUT_MS },
    );
    // Let the athletes settle on the court before touching cosmetics.
    await page.waitForFunction(() => window.__vb.loop.tick > 60, null, { timeout: 60_000 });
    console.log('[headwear-selector] boot complete, match loop live\n');

    // Stash the ids, labels and the two lil-gui dropdown controllers on window
    // so later evaluates can drive the real debug HUD route. Module URLs are
    // derived from the page's own main.js script tag so the dev-server base
    // (/Valleyball-Versus/) is honored and we get the SAME module instances
    // main.js imported, not a second copy.
    const guiFound = await page.evaluate(() => {
      const mainScript = [...document.querySelectorAll('script[type="module"][src]')]
        .find((s) => /\/main\.js(\?.*)?$/.test(s.src));
      const mainSrc = mainScript.src;
      const moduleUrl = (rel) => mainSrc.replace(/main\.js.*$/, rel);
      const walk = (gui, property) => {
        for (const c of gui.controllers) if (c.property === property) return c;
        for (const f of gui.folders) {
          const hit = walk(f, property);
          if (hit) return hit;
        }
        return null;
      };
      return import(moduleUrl('config/cosmetics.js')).then(({ SERIES_1_PLAYTEST_IDS, getHeadwearLabel }) => {
        const gui = window.__vb.gui;
        window.__hwTest = {
          ids: [...SERIES_1_PLAYTEST_IDS],
          labels: Object.fromEntries(SERIES_1_PLAYTEST_IDS.map((id) => [id, getHeadwearLabel(id)])),
          p1Ctrl: walk(gui, 'p1'),
          p2Ctrl: walk(gui, 'p2'),
          physicsUrl: moduleUrl('sim/physics.js'),
        };
        return !!(window.__hwTest.p1Ctrl && window.__hwTest.p2Ctrl);
      });
    });
    check(guiFound, 'debug HUD: lil-gui P1/P2 headwear dropdown controllers exist');

    const idsInPage = await page.evaluate(() => window.__hwTest.ids);
    const labelsInPage = await page.evaluate(() => window.__hwTest.labels);
    check(
      JSON.stringify(idsInPage) === JSON.stringify(EXPECTED_IDS),
      `selector exposes exactly the eight stated ids in order (got ${JSON.stringify(idsInPage)})`,
    );

    const readState = (playerIndex) => page.evaluate((pi) => {
      const vb = window.__vb;
      const a = vb.athletes[pi];
      if (!a) return null;
      const head = a.ragdoll?.rig?.get ? a.ragdoll.rig.get('head') : null;
      const slot = head?.headwearSlot ?? null;
      return {
        headwear: a.headwear,
        slotFound: !!slot,
        childCount: slot ? slot.children.length : -1,
        childNames: slot ? slot.children.map((c) => c.name) : [],
        holderValue: window.__hwTest[pi === 0 ? 'p1Ctrl' : 'p2Ctrl']?.object?.[pi === 0 ? 'p1' : 'p2'] ?? null,
        toastText: document.getElementById('headwear-toast')?.textContent ?? '',
        tick: vb.loop.tick,
      };
    }, playerIndex);

    const colliderCount = () => page.evaluate(async () => {
      const { getWorld } = await import(window.__hwTest.physicsUrl);
      return getWorld().colliders.len();
    });

    // The slot state a given id must produce: one child named headwear-<id>,
    // or an empty socket for 'none'.
    const slotOk = (state, id) => {
      if (!state.slotFound) return false;
      if (id === 'none') return state.childCount === 0;
      return state.childCount === 1 && state.childNames[0] === `headwear-${id}`;
    };

    const baseColliders = await colliderCount();
    const tickStart = (await readState(0)).tick;
    console.log(`[headwear-selector] baseline: ${baseColliders} colliders, tick ${tickStart}\n`);

    // ---- 1. Keyboard cycling, P1: two full laps (16 presses) ----
    console.log('[headwear-selector] phase 1: Digit3 keyboard cycling, P1, two laps');
    const initial = await readState(0);
    check(EXPECTED_IDS.includes(initial.headwear), `P1 boots on a playtest id (${initial.headwear})`);
    check(slotOk(initial, initial.headwear), 'P1 default mount is the sole child of headwearSlot');
    let startIdx = EXPECTED_IDS.indexOf(initial.headwear);
    let lastTick = initial.tick;
    let monotonic = true;
    let cycleOk = true;
    for (let press = 1; press <= 16; press += 1) {
      await page.keyboard.press('Digit3');
      const expected = EXPECTED_IDS[(startIdx + press) % 8];
      const st = await readState(0);
      if (st.tick < lastTick) monotonic = false;
      lastTick = st.tick;
      const stepOk = st.headwear === expected && slotOk(st, expected) && st.holderValue === expected;
      const toastOk = st.toastText.includes(labelsInPage[expected]);
      if (!stepOk) {
        cycleOk = false;
        console.log(`  press ${press}: expected ${expected}, got ${JSON.stringify(st)}`);
      }
      if (press === 1 || press === 8) {
        check(toastOk, `press ${press}: HUD toast shows the label for ${expected}`);
      }
    }
    check(cycleOk, 'Digit3 walked all eight ids twice, wrapping, sole child every step');
    check(monotonic, 'loop.tick never went backwards across 16 keypresses');

    // ---- 2. Keyboard cycling, P2: one lap ----
    console.log('[headwear-selector] phase 2: Digit8 keyboard cycling, P2, one lap');
    const p2Initial = await readState(1);
    check(p2Initial !== null && slotOk(p2Initial, p2Initial.headwear), 'P2 default mount is sole child');
    startIdx = EXPECTED_IDS.indexOf(p2Initial.headwear);
    let p2Ok = true;
    for (let press = 1; press <= 8; press += 1) {
      await page.keyboard.press('Digit8');
      const expected = EXPECTED_IDS[(startIdx + press) % 8];
      const st = await readState(1);
      if (!(st.headwear === expected && slotOk(st, expected) && st.holderValue === expected)) {
        p2Ok = false;
        console.log(`  press ${press}: expected ${expected}, got ${JSON.stringify(st)}`);
      }
    }
    check(p2Ok, 'Digit8 walked all eight ids on P2, sole child every step');

    // ---- 3. Debug HUD dropdown route, both players ----
    console.log('[headwear-selector] phase 3: lil-gui dropdown route, P1 and P2');
    for (const [pi, ctrlKey] of [[0, 'p1Ctrl'], [1, 'p2Ctrl']]) {
      let guiOk = true;
      for (const id of EXPECTED_IDS) {
        await page.evaluate(([ck, value]) => window.__hwTest[ck].setValue(value), [ctrlKey, id]);
        const st = await readState(pi);
        if (!(st.headwear === id && slotOk(st, id))) {
          guiOk = false;
          console.log(`  P${pi + 1} gui set ${id}: got ${JSON.stringify(st)}`);
        }
      }
      check(guiOk, `gui dropdown drove all eight ids onto P${pi + 1} with sole-child attachment`);
    }

    // ---- 4. Collider invariance ----
    const endColliders = await colliderCount();
    check(endColliders === baseColliders, `collider count unchanged (${baseColliders} -> ${endColliders}); headwear stays render-only`);

    // ---- 5. Render loop continuity ----
    await page.waitForTimeout(1200);
    const midTick = (await readState(0)).tick;
    check(midTick - tickStart >= 30, `render loop still ticking (gained ${midTick - tickStart} ticks over the session)`);

    // ---- 6. Evidence screenshots: idle, running, diving, striking ----
    console.log('[headwear-selector] phase 4: action-pose evidence screenshots');
    const setP1 = (id) => page.evaluate((value) => window.__hwTest.p1Ctrl.setValue(value), id);
    const shot = (name) => page.screenshot({ path: path.join(EVIDENCE_DIR, name) });

    await setP1('cap_forward');
    await page.waitForTimeout(300);
    await shot('01_idle_cap_forward.png');

    await setP1('bucket_hat');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(800);
    await shot('02_running_bucket_hat.png');
    await page.keyboard.up('KeyW');

    await setP1('beanie');
    await page.evaluate(() => window.__vb.athletes[0].requestKnockdown());
    await page.waitForTimeout(500);
    await shot('03_diving_beanie.png');
    await page.waitForTimeout(2500); // let the knockdown recover

    await setP1('cap_backward');
    // The swing is shorter than a screenshot round trip, so a fixed wait (or
    // even resolving on the live phase and then shooting) captures idle. Queue
    // the volley through the real input-router slot, and STOP THE LOOP inside
    // the polling predicate on the first frame the strike phase is live, so
    // the canvas holds the mid-swing pose while the screenshot is taken.
    let strikeCaught = false;
    for (let attempt = 0; attempt < 3 && !strikeCaught; attempt += 1) {
      await page.evaluate(() => { window.__vb.getInputSlot(0).volleyQueued = true; });
      strikeCaught = await page
        .waitForFunction(() => {
          const phase = window.__vb.probe(0)?.strike?.phase ?? 0;
          if (phase > 0.05) {
            window.__vb.loop.stop();
            return true;
          }
          return false;
        }, null, { timeout: 2500, polling: 'raf' })
        .then(() => true)
        .catch(() => false);
    }
    await shot('04_striking_cap_backward.png');
    await page.evaluate(() => window.__vb.loop.start());
    console.log(`  strike pose ${strikeCaught ? 'captured mid-swing (loop frozen on the live frame)' : 'NOT caught mid-swing (screenshot may show idle)'}`);
    check(strikeCaught, 'strike evidence captured while the swing was live');
    await setP1('goggles');
    await page.waitForTimeout(200);
    await shot('05_idle_goggles.png');
    console.log(`  evidence written to ${path.relative(ROOT, EVIDENCE_DIR)}`);

    const finalTick = (await readState(0)).tick;
    check(finalTick >= midTick, 'loop.tick monotonic to the end of the session');

    // ---- 7. No runtime exceptions anywhere above ----
    check(problems.length === 0, `zero runtime exceptions${problems.length ? `:\n    ${problems.join('\n    ')}` : ''}`);

    const passed = failures.length === 0;
    console.log(`\nHEADWEAR SELECTOR: ${passed ? 'PASS' : `FAIL (${failures.length} check(s))`}\n`);
    return passed ? 0 : 1;
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof Refusal) {
      console.error(`\n[headwear-selector] ${error.message}\n`);
    } else {
      console.error(`\n[headwear-selector] unexpected: ${error.stack || error.message}`);
      console.error('\nHEADWEAR SELECTOR: FAIL\n');
    }
    process.exitCode = 1;
  });
