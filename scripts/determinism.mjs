/**
 * THE DETERMINISM PAIR, AUTOMATED.
 *
 *   npm run determinism                    two runs at tick 300, in the BOWL
 *   npm run determinism -- --tick 600      two runs at tick 600
 *   npm run determinism -- --runs 3        three runs
 *   npm run determinism -- --arena court   the authored court instead
 *
 * THE ANCHOR IS THE BOWL, and the default says so out loud rather than
 * inheriting it. TUNING.arena.type selects what a human gets when they open the
 * page, and it is 'court' — but the regression test must not move worlds
 * because the designer changed which one they are playing in. Every pair
 * measured to date was measured in the bowl; the bowl is the baseline, and the
 * script pins it with ?arena=bowl. Pass --arena court to test the court too,
 * which is a different measurement and not a substitute for this one.
 *
 * It starts the Vite dev server itself (so the capture middleware is present),
 * drives headless Chromium at `?captureTick=N` once per run, waits for the
 * capture POST to come back 200 — which is the signal the PNG is on disk, since
 * the plugin writes the file before it responds — copies the result aside, and
 * hashes every copy. Identical hashes, exit 0. Anything else, exit 1.
 *
 * ONE-TIME SETUP:  npx playwright install chromium
 * (The browser binary is not an npm dependency and is not vendored. If Chromium
 * was installed by a different Playwright version than the one in
 * devDependencies, re-run that command after `npm install` — Playwright pins an
 * exact browser revision and will say so if they disagree.)
 *
 * WHAT THIS SCRIPT IS NOT
 *
 * It is not a comparison against the manual protocol. Headless here renders
 * through SwiftShader; a hand-run pair in a desktop browser renders through the
 * laptop's GPU. Rasterisation differs between them, so a SwiftShader hash is NOT
 * expected to equal a GPU hash and a mismatch across those two worlds is not a
 * bug. Each pair is compared against ITSELF. What LAW 6 claims — that the
 * simulation is a pure function of the tick — is what this measures, on one
 * renderer at a time.
 *
 * It also does not touch the harness. `core/Loop.js`, `core/Interpolated.js`,
 * `debug/capture.js` and `vite-plugin-capture.js` are frozen; this script drives
 * them from outside through the URL parameter they were given for exactly this.
 */

import { createHash } from 'node:crypto';
import { copyFile, readFile, stat } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5173;
const RUN_TIMEOUT_MS = 60_000;

/**
 * The renderer flags. WebGL in headless Chromium needs ANGLE pointed at
 * SwiftShader or the context never comes up and every capture is a blank PNG
 * that hashes consistently and proves nothing.
 */
const CHROMIUM_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

function parseArgs(argv) {
  const args = { tick: 300, runs: 2, arena: 'bowl' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--arena') {
      const value = argv[i + 1];
      if (value !== 'court' && value !== 'bowl') {
        fail(`--arena expects "court" or "bowl", got "${value}"`);
      }
      args.arena = value;
      i += 1;
      continue;
    }
    if (flag !== '--tick' && flag !== '--runs') continue;
    const value = Number(argv[i + 1]);
    if (!Number.isInteger(value) || value < (flag === '--runs' ? 2 : 0)) {
      fail(`${flag} expects an integer${flag === '--runs' ? ' of at least 2' : ' of at least 0'}, got "${argv[i + 1]}"`);
    }
    args[flag.slice(2)] = value;
    i += 1;
  }
  return args;
}

/**
 * A refusal, as distinct from a crash. Thrown rather than exiting, because
 * NOTHING in this script calls process.exit() any more — see the tail.
 */
class Refusal extends Error {}

/**
 * A run that went wrong for a reason we anticipated — a timeout, a missing
 * file, an assert firing on the page. It gets its message printed and no stack,
 * because the stack of a thrown-on-purpose Error is noise that buries the one
 * line the reader needs.
 */
class RunFailure extends Error {}

function fail(message) {
  throw new Refusal(message);
}

/**
 * The capture plugin writes relative to the Vite server root, so the port is not
 * negotiable: moving to another port would still work, but a second dev server
 * already serving this project would be writing into the same captures/ folder
 * and the two would race over auto_t<N>.png. Refuse instead.
 */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(1000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
  });
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * One run: a fresh browser, a fresh page, one anchored capture.
 *
 * The page's console is forwarded verbatim. An `error` level message or a
 * pageerror fails the run and therefore the pair — the once-a-second asserts in
 * main.js (the weight audit, the strafe-sign and flail violations) report
 * through console.error, and a pair that stayed byte-identical while an
 * invariant was screaming would be a pass that means nothing.
 */
async function runOnce(letter, tick, arena) {
  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const problems = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    page.on('console', (message) => {
      const level = message.type();
      console.log(`[page ${letter}] ${level === 'log' ? '' : `${level}: `}${message.text()}`);
      if (level === 'error') problems.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      console.log(`[page ${letter}] pageerror: ${error.message}`);
      problems.push(`pageerror: ${error.message}`);
    });

    const startedAt = Date.now();
    const captured = page.waitForResponse(
      (response) =>
        response.url().includes('/__capture') &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      { timeout: RUN_TIMEOUT_MS },
    );

    await page.goto(`http://localhost:${PORT}/?captureTick=${tick}&arena=${arena}`, {
      waitUntil: 'commit',
      timeout: RUN_TIMEOUT_MS,
    });

    try {
      await captured;
    } catch {
      throw new RunFailure(
        `run ${letter}: no successful POST /__capture within ${RUN_TIMEOUT_MS / 1000}s. ` +
          `The page either never reached tick ${tick} or never got a WebGL context.`,
      );
    }

    const source = path.join(ROOT, 'captures', `auto_t${tick}.png`);
    const info = await stat(source).catch(() => null);
    if (!info) throw new RunFailure(`run ${letter}: the endpoint answered 200 but ${source} is not there`);
    // Guards against hashing a leftover from an earlier session if the write
    // ever silently no-ops: the file must have been written by THIS run.
    if (info.mtimeMs < startedAt) {
      throw new RunFailure(`run ${letter}: ${path.basename(source)} predates this run — stale capture`);
    }

    const destination = path.join(ROOT, 'captures', `auto_${arena}_t${tick}_run${letter}.png`);
    await copyFile(source, destination);

    if (problems.length) {
      throw new RunFailure(`run ${letter} reported ${problems.length} page problem(s):\n  ${problems.join('\n  ')}`);
    }

    const bytes = await readFile(destination);
    return { letter, file: path.relative(ROOT, destination), hash: sha256(bytes), bytes: bytes.length };
  } finally {
    await browser.close();
  }
}

async function main() {
  const { tick, runs, arena } = parseArgs(process.argv.slice(2));

  if (await portInUse(PORT)) {
    fail(
      `port ${PORT} is already in use. Stop the running dev server and try again — ` +
        `this script starts its own, and two servers on one project would race over ` +
        `captures/auto_t${tick}.png.`,
    );
  }

  const letters = Array.from({ length: runs }, (_, i) => String.fromCharCode(65 + i));
  console.log(
    `[determinism] arena ${arena}, tick ${tick}, ${runs} runs (${letters.join(', ')}), ` +
      `headless SwiftShader\n`,
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
      console.log(`[determinism] run ${letter} —`);
      results.push(await runOnce(letter, tick, arena));
      console.log('');
    }
  } finally {
    // Always, on every path. The tail below then lets the process end on its
    // own, which is the whole point of not calling process.exit().
    await server.close().catch(() => {});
  }

  const width = Math.max(...results.map((r) => r.file.length));
  console.log(`${'run'.padEnd(4)}${'file'.padEnd(width + 2)}${'sha256'.padEnd(66)}bytes`);
  for (const r of results) {
    console.log(`${r.letter.padEnd(4)}${r.file.padEnd(width + 2)}${r.hash.padEnd(66)}${r.bytes}`);
  }

  const identical = results.every((r) => r.hash === results[0].hash);
  console.log(`\nDETERMINISM PAIR: ${identical ? 'PASS' : 'FAIL'}\n`);
  return identical ? 0 : 1;
}

/**
 * WHY NOTHING HERE CALLS process.exit().
 *
 * It used to, on the success path, and on Windows that produced
 * `[process exited with code 4294967295]` after a clean PASS — 0xFFFFFFFF, the
 * unsigned face of -1, which is what you get when the process is torn down
 * rather than ended. process.exit() is immediate and unconditional: Vite's
 * esbuild service is a live child process, and killing the parent out from
 * under it leaves the OS to report the death rather than the exit code.
 *
 * A harness whose PASS looks like a crash is a harness nobody can put in CI, so
 * the exit code is now SET and never forced. `main()` returns 0 or 1, that lands
 * in process.exitCode, the event loop drains — server.close() has already
 * resolved by then — and node exits on its own with the code we asked for.
 */
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof Refusal) {
      // Nothing was measured, so there is no pair to report on.
      console.error(`\n[determinism] ${error.message}\n`);
    } else if (error instanceof RunFailure) {
      console.error(`\n[determinism] ${error.message}`);
      console.error('\nDETERMINISM PAIR: FAIL\n');
    } else {
      console.error(`\n[determinism] unexpected: ${error.stack || error.message}`);
      console.error('\nDETERMINISM PAIR: FAIL\n');
    }
    process.exitCode = 1;
  });
