#!/usr/bin/env node
/**
 * VALLEYBALL FIXTURE RUNNER — plays one fixture in the full game and prints its result.
 *
 * Loads the real game (not the headless training proxy) in GPU Chromium with
 * ?fixture=, lets the match play out in real time, and waits for the result
 * the page reports on `vb:matchover`. This is the league runner's unit of work.
 *
 * Usage:
 *   node scripts/play-fixture.mjs [fixture.json] [options]
 *
 * Options:
 *   --duration N    Override the fixture's durationSeconds (quick checks)
 *   --repeat N      Play it N times, each on a fresh page, and compare results
 *   --out FILE      Write the result JSON (an array when --repeat > 1)
 *   --url-only      Print the fixture URL and exit; for human matches, open it
 *                   on the machine the players use (npm run dev serves it)
 *   --headed        Show the browser window
 *
 * Bot-vs-bot fixtures only: a headless run has no one to hold a controller.
 * Default fixture: scripts/fixtures/example-bots.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { normalizeFixture, encodeFixtureParam } from '../src/features/match/matchFixture.js';
import { TUNING } from '../src/config/tuning.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE_PORT = 5185;
const BASE = '/Valleyball-Versus/';
const DEFAULT_FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'example-bots.json');
// Boot, asset load and the victory buzzer all sit outside the match clock.
const OVERHEAD_SECONDS = 120;

function parseArgs(argv) {
  const opts = { file: DEFAULT_FIXTURE, duration: null, repeat: 1, out: null, urlOnly: false, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const val = argv[i + 1];
    switch (arg) {
      case '--duration': opts.duration = parseInt(val, 10); i++; break;
      case '--repeat': opts.repeat = Math.max(1, parseInt(val, 10)); i++; break;
      case '--out': opts.out = path.resolve(val); i++; break;
      case '--url-only': opts.urlOnly = true; break;
      case '--headed': opts.headed = true; break;
      default:
        if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
        opts.file = path.resolve(arg);
    }
  }
  return opts;
}

function loadFixture(opts) {
  const input = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
  if (opts.duration !== null) input.durationSeconds = opts.duration;
  // The same rules the page applies, so a bad fixture fails here, not after boot.
  const { fixture, errors } = normalizeFixture(input);
  if (errors.length) throw new Error(`invalid fixture ${opts.file}:\n  ${errors.join('\n  ')}`);
  return { input, fixture };
}

function describe(result) {
  const { home, away, score, winner } = result;
  const verdict = winner === 'draw' ? 'draw' : `${result[winner].name} wins`;
  const goals = result.goals.map((g) => `${g.scoredFor[0].toUpperCase()}@${g.tick}`).join(' ') || 'none';
  return `${home.name} ${score.home} - ${score.away} ${away.name} (${verdict}); goals ${goals}; ended tick ${result.endedTick}`;
}

/**
 * What has to match for two runs of one fixture to count as the same match.
 * The touch and strike counts are in it because they diverge long before the
 * score does: a 0-0 twice proves nothing on its own.
 */
function signature(result) {
  return JSON.stringify({
    score: result.score,
    goals: result.goals,
    endedTick: result.endedTick,
    home: result.home.stats,
    away: result.away.stats,
  });
}

async function playOnce(page, url, timeoutMs) {
  const pageErrors = [];
  const onError = (err) => pageErrors.push(err.message);
  page.on('pageerror', onError);
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => {
      const status = document.getElementById('loading-status')?.textContent || '';
      return window.__vb?.lastMatchResult || window.__vb?.fixtureError || status.startsWith('BOOT FAILED');
    }, null, { timeout: timeoutMs, polling: 1000 });
    const outcome = await page.evaluate(() => ({
      result: window.__vb?.lastMatchResult || null,
      fixtureError: window.__vb?.fixtureError || null,
      status: document.getElementById('loading-status')?.textContent || '',
    }));
    if (!outcome.result) {
      const why = outcome.fixtureError ? outcome.fixtureError.join('; ') : outcome.status;
      throw new Error(`the page did not play the fixture: ${why}`);
    }
    return outcome.result;
  } finally {
    page.off('pageerror', onError);
    if (pageErrors.length) console.warn(`[fixture] page errors:\n  ${pageErrors.join('\n  ')}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { input, fixture } = loadFixture(opts);
  const url = `http://localhost:${VITE_PORT}${BASE}?fixture=${encodeFixtureParam(input)}`;

  if (opts.urlOnly) {
    console.log(url.replace(`:${VITE_PORT}`, ':5173'));
    return;
  }
  const humans = [fixture.home, fixture.away].filter((s) => s.controller === 'human');
  if (humans.length) {
    throw new Error('this fixture has a human side; open it with --url-only instead of playing it headless');
  }

  console.log(`[fixture] ${fixture.id} (seed ${fixture.seed}): ${fixture.home.name} vs ${fixture.away.name}, ` +
    `${fixture.durationSeconds}s, ${opts.repeat} run(s)`);

  const viteServer = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.js'),
    logLevel: 'warn',
    server: { port: VITE_PORT, strictPort: true },
  });
  await viteServer.listen();

  // Same launch as the clip harvest: new headless mode keeps hardware D3D11
  // rendering, and a headed window is throttled by Windows when unfocused.
  const browser = await chromium.launch({
    headless: !opts.headed,
    channel: 'chromium',
    args: [
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-gpu-rasterization',
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion',
      '--window-size=1920,1080',
    ],
  });

  const results = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const matchSeconds = (fixture.flyover ? TUNING.match.flyoverSeconds : 0)
      + TUNING.match.countdownSeconds + fixture.durationSeconds;
    const timeoutMs = (matchSeconds + OVERHEAD_SECONDS) * 1000;

    for (let run = 1; run <= opts.repeat; run++) {
      const started = Date.now();
      const result = await playOnce(page, url, timeoutMs);
      const took = ((Date.now() - started) / 1000).toFixed(0);
      console.log(`[fixture] run ${run}: ${describe(result)} [${took}s]`);
      results.push(result);
    }
  } finally {
    await browser.close();
    await viteServer.close();
  }

  if (opts.out) {
    fs.writeFileSync(opts.out, JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
    console.log(`[fixture] result written to ${opts.out}`);
  } else if (results.length === 1) {
    console.log(JSON.stringify(results[0], null, 2));
  }

  if (results.length > 1) {
    const first = signature(results[0]);
    const differing = results.map((r, i) => (signature(r) === first ? null : i + 1)).filter(Boolean);
    if (differing.length) {
      console.log(`[fixture] REPEAT DIFFERS: run(s) ${differing.join(', ')} did not match run 1`);
      process.exitCode = 1;
    } else {
      console.log(`[fixture] REPEAT IDENTICAL: all ${results.length} runs gave the same score, goal ticks and end tick`);
    }
  }
}

main().catch((err) => {
  console.error(`[fixture] ${err.message}`);
  process.exit(1);
});
