/**
 * PRE-MATCH SETUP HEADWEAR CYCLER TEST (t_a81b0b79).
 *
 *   node scripts/test_setup_headwear.mjs
 *   VITE_PORT=5211 node scripts/test_setup_headwear.mjs   (port override)
 *
 * Drives the real page in headless Chromium (SwiftShader) through the actual
 * menu flow: title screen -> PLAY MATCH (1v1) -> controller assignment ->
 * player setup page 1. It asserts the acceptance criteria of the headwear
 * setup card:
 *
 *   1. Row placement. #row-headwear-p1 / #row-headwear-p2 exist on page 1 and
 *      sit between the team color row and the physique row in document order.
 *   2. Canon defaults. P1 (red swatch) boots on GRIDIRON HORNS and P2 (blue
 *      swatch) on WICKETKEEPER HELMET.
 *   3. Full cycle. Clicking the cycler's next button walks all eleven labels
 *      in SERIES_1 playtest order and wraps cleanly.
 *   4. Live 3D staging. After every cycle step the preview athlete's
 *      `headwear` matches the selected id and the head's render-only
 *      headwearSlot holds exactly one child named headwear-<id> (zero for
 *      'none'). No accumulation, no orphans.
 *   5. Swatch auto-default. Clicking each of the ten team color swatches on
 *      P1 sets that color's canon athlete piece label.
 *   6. Keyboard navigation. With focus on the headwear row (set by clicking
 *      the cycler), ArrowLeft / ArrowRight step the label.
 *   7. No runtime exceptions. Any pageerror or console.error fails the run.
 *
 * Expected values are stated here independently on purpose: the test must not
 * import them from the modules under test, or a rename would silently pass.
 *
 * ONE-TIME SETUP: npx playwright install chromium  (same as determinism).
 * Exit code is SET, never forced.
 */

import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.VITE_PORT ? parseInt(process.env.VITE_PORT, 10) : 5211;
const BOOT_TIMEOUT_MS = 240_000;

const CHROMIUM_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

/** The eleven playtest ids and their setup labels, in cycle order. */
const EXPECTED_CYCLE = [
  ['manager_cap', 'MANAGER CLASSIC CAP'],
  ['sensor_visor', 'SENSOR VISOR'],
  ['wicket_grill', 'WICKETKEEPER HELMET'],
  ['wrestler_bands', 'GRIDIRON HORNS'],
  ['terrace_visor', 'TERRACE MONTERA'],
  ['couture_wrap', 'SILK ROAD DIADEM'],
  ['rigger_band', 'WAYFINDER CORD'],
  ['broadcaster_mic', 'STADIUM HEADSET'],
  ['cursor_cap', 'WINGED COURIER CAP'],
  ['ouendan_knot', 'BLEACHER HACHIMAKI'],
  ['none', 'NONE'],
];

/** Swatch title attribute -> canon athlete piece label. */
const EXPECTED_CANON = [
  ['Red', 'GRIDIRON HORNS'],
  ['Blue', 'WICKETKEEPER HELMET'],
  ['Yellow', 'STADIUM HEADSET'],
  ['Green', 'TERRACE MONTERA'],
  ['Purple', 'SILK ROAD DIADEM'],
  ['Orange', 'WINGED COURIER CAP'],
  ['Teal', 'WAYFINDER CORD'],
  ['Pink', 'BLEACHER HACHIMAKI'],
  ['White', 'MANAGER CLASSIC CAP'],
  ['Black', 'SENSOR VISOR'],
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

  console.log(`[setup-headwear] port ${PORT}, headless SwiftShader, menu flow\n`);

  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

    await page.goto(`http://localhost:${PORT}/`, {
      waitUntil: 'commit',
      timeout: BOOT_TIMEOUT_MS,
    });
    await page.waitForFunction(() => (window.__vb?.loop?.tick ?? 0) > 0, null, { timeout: BOOT_TIMEOUT_MS });

    // Title screen -> match flow.
    await page.waitForSelector('#btn-play-match', { state: 'visible', timeout: 60_000 });
    await page.evaluate(() => document.getElementById('btn-play-match').click());
    await page.waitForSelector('#assignment-btn-proceed', { state: 'visible', timeout: 30_000 });
    await page.evaluate(() => document.getElementById('assignment-btn-proceed').click());

    // Player setup page 1 must show both headwear rows.
    await page.waitForSelector('#row-headwear-p1', { state: 'visible', timeout: 30_000 });
    await page.waitForSelector('#row-headwear-p2', { state: 'visible', timeout: 30_000 });
    console.log('[setup-headwear] setup page 1 reached, headwear rows visible\n');

    // 1. Row placement: team color < headwear < physique in document order.
    const placement = await page.evaluate(() => {
      const order = (a, b) => {
        const elA = document.getElementById(a);
        const elB = document.getElementById(b);
        if (!elA || !elB) return null;
        // eslint-disable-next-line no-bitwise
        return !!(elA.compareDocumentPosition(elB) & Node.DOCUMENT_POSITION_FOLLOWING);
      };
      return {
        p1ColorBeforeHeadwear: order('row-team-color-p1', 'row-headwear-p1'),
        p1HeadwearBeforePhysique: order('row-headwear-p1', 'row-physique-p1'),
        p2ColorBeforeHeadwear: order('row-team-color-p2', 'row-headwear-p2'),
        p2HeadwearBeforePhysique: order('row-headwear-p2', 'row-physique-p2'),
      };
    });
    check(placement.p1ColorBeforeHeadwear === true, 'P1 headwear row sits after team color row');
    check(placement.p1HeadwearBeforePhysique === true, 'P1 headwear row sits before physique row');
    check(placement.p2ColorBeforeHeadwear === true, 'P2 headwear row sits after team color row');
    check(placement.p2HeadwearBeforePhysique === true, 'P2 headwear row sits before physique row');

    const readLabel = (p) => page.evaluate((pi) => (
      document.getElementById(`label-headwear-p${pi + 1}`)?.textContent?.trim() ?? null
    ), p);

    const readAthlete = (p) => page.evaluate((pi) => {
      const a = window.__vb?.athletes?.[pi];
      if (!a) return null;
      const head = a.ragdoll?.rig?.get ? a.ragdoll.rig.get('head') : null;
      const slot = head?.headwearSlot ?? null;
      return {
        headwear: a.headwear,
        childCount: slot ? slot.children.length : -1,
        childNames: slot ? slot.children.map((c) => c.name) : [],
      };
    }, p);

    const clickCycle = (p, dir) => page.evaluate(([pi, d]) => {
      const row = document.getElementById(`row-headwear-p${pi + 1}`);
      const buttons = row.querySelectorAll('button');
      // buttons[0] = prev '<', buttons[1] = next '>'
      const btn = d > 0 ? buttons[buttons.length - 1] : buttons[0];
      btn.click();
    }, [p, dir]);

    const clickSwatch = (p, title) => page.evaluate(([pi, t]) => {
      const row = document.getElementById(`row-team-color-p${pi + 1}`);
      const btn = Array.from(row.querySelectorAll('button')).find((b) => b.title === t);
      if (!btn) return false;
      btn.click();
      return true;
    }, [p, title]);

    // 2. Canon boot defaults.
    check((await readLabel(0)) === 'GRIDIRON HORNS', `P1 boots on canon red piece (got ${await readLabel(0)})`);
    check((await readLabel(1)) === 'WICKETKEEPER HELMET', `P2 boots on canon blue piece (got ${await readLabel(1)})`);

    // Boot athlete staging matches the config defaults.
    const bootP1 = await readAthlete(0);
    check(bootP1?.headwear === 'wrestler_bands' && bootP1?.childCount === 1 && bootP1?.childNames[0] === 'headwear-wrestler_bands',
      `P1 preview athlete mounts wrestler_bands as sole slot child (got ${JSON.stringify(bootP1)})`);

    // 3 + 4. Full eleven-step cycle on P1 with 3D staging checks each step.
    const startIdx = EXPECTED_CYCLE.findIndex(([, label]) => label === 'GRIDIRON HORNS');
    let cycleOk = true;
    let stagingOk = true;
    for (let step = 1; step <= EXPECTED_CYCLE.length; step++) {
      await clickCycle(0, +1);
      const [id, label] = EXPECTED_CYCLE[(startIdx + step) % EXPECTED_CYCLE.length];
      const got = await readLabel(0);
      if (got !== label) {
        console.log(`    cycle step ${step}: expected ${label}, got ${got}`);
        cycleOk = false;
      }
      const ath = await readAthlete(0);
      const expectChildren = id === 'none' ? 0 : 1;
      const expectName = id === 'none' ? [] : [`headwear-${id}`];
      if (ath?.headwear !== id || ath?.childCount !== expectChildren || JSON.stringify(ath?.childNames) !== JSON.stringify(expectName)) {
        console.log(`    cycle step ${step} (${id}): athlete state ${JSON.stringify(ath)}`);
        stagingOk = false;
      }
    }
    check(cycleOk, 'P1 cycler walks all eleven labels in order and wraps');
    check(stagingOk, 'P1 preview athlete headwear slot tracks every cycle step (sole child, no orphans)');
    check((await readLabel(0)) === 'GRIDIRON HORNS', 'P1 label wraps back to start after eleven steps');

    // 5. Swatch auto-default across all ten colors on P1.
    let canonOk = true;
    for (const [title, label] of EXPECTED_CANON) {
      const clicked = await clickSwatch(0, title);
      if (!clicked) {
        console.log(`    swatch ${title}: button not found`);
        canonOk = false;
        continue;
      }
      const got = await readLabel(0);
      if (got !== label) {
        console.log(`    swatch ${title}: expected ${label}, got ${got}`);
        canonOk = false;
      }
    }
    check(canonOk, 'every P1 swatch click auto-defaults headwear to the canon piece');

    // Restore P1 to red so the keyboard step starts from a known state.
    await clickSwatch(0, 'Red');

    // 6. Keyboard navigation: the cycler click above left focus on the color
    // row, so click the headwear next button once to move focus to the
    // headwear row, then arrow left/right.
    await clickCycle(0, +1); // -> SENSOR? no: red canon start + 1
    const afterClick = await readLabel(0);
    await page.keyboard.press('ArrowRight');
    const afterRight = await readLabel(0);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    const afterLefts = await readLabel(0);
    const labels = EXPECTED_CYCLE.map(([, l]) => l);
    const iClick = labels.indexOf(afterClick);
    check(afterRight === labels[(iClick + 1) % labels.length], `ArrowRight advances the focused headwear cycler (${afterClick} -> ${afterRight})`);
    check(afterLefts === labels[(iClick + 1 + labels.length - 2) % labels.length], `ArrowLeft steps the cycler back (${afterRight} -> ${afterLefts})`);

    // 7. No runtime problems across the whole session.
    check(problems.length === 0, `no console.error / pageerror (got ${problems.length})`);
    if (problems.length) console.log(problems.join('\n'));
  } finally {
    await browser.close();
    await server.close();
  }

  console.log('');
  if (failures.length) {
    console.log(`SETUP HEADWEAR: FAIL (${failures.length} check(s))`);
    process.exitCode = 1;
  } else {
    console.log('SETUP HEADWEAR: PASS');
    process.exitCode = 0;
  }
}

main().catch((error) => {
  console.error(error instanceof Refusal ? `[setup-headwear] REFUSED: ${error.message}` : error);
  process.exitCode = 1;
});
