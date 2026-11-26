/**
 * Requirement-driven opaque-box Playwright E2E runner for Valleyball Versus
 * v0.4.2.2 Live-Room UX and Smash-Level Controller Drop-In (Tiers 1 to 4).
 *
 * Sets process.exitCode rather than forcing immediate termination so Vite's
 * esbuild child process drains cleanly on Windows.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

import { installAudioInspectionHook } from './e2e/audioHook.mjs';
import { installVirtualGamepadMock } from './e2e/gamepadMock.mjs';
import {
  CHROMIUM_ARGS,
  DEFAULT_PORT,
  portInUse,
  Refusal,
  RunFailure,
} from './e2e/harness.mjs';
import { runE2ETiers } from './e2e/tiers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLAG_PREFIX = '-'.repeat(2);

export function parseArgs(argv) {
  const envPort = process.env.VITE_PORT ? parseInt(process.env.VITE_PORT, 10) : DEFAULT_PORT;
  const args = {
    tier: 'all',
    port: Number.isInteger(envPort) && envPort > 0 ? envPort : DEFAULT_PORT,
    outDir: path.join(ROOT, 'captures', 'e2e_live_room'),
    jsonPath: null,
    selfTest: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith(FLAG_PREFIX)) {
      throw new Refusal(`Unexpected positional argument: ${raw}`);
    }
    const flag = raw.slice(2);
    if (flag === 'self-test') {
      args.selfTest = true;
      continue;
    }
    const val = argv[i + 1];
    if (val === undefined || val.startsWith(FLAG_PREFIX)) {
      throw new Refusal(`Missing value for option ${flag}`);
    }
    i += 1;
    if (flag === 'tier') {
      if (!['1', '2', '3', '4', 'all'].includes(val)) {
        throw new Refusal(`Invalid tier "${val}". Expected 1, 2, 3, 4, or all`);
      }
      args.tier = val;
    } else if (flag === 'port') {
      const p = Number(val);
      if (!Number.isInteger(p) || p <= 0 || p > 65535) {
        throw new Refusal(`Invalid port "${val}". Expected integer 1..65535`);
      }
      args.port = p;
    } else if (flag === 'out-dir') {
      args.outDir = path.isAbsolute(val) ? val : path.resolve(ROOT, val);
    } else if (flag === 'json') {
      args.jsonPath = path.isAbsolute(val) ? val : path.resolve(ROOT, val);
    } else {
      throw new Refusal(`Unknown option: ${flag}`);
    }
  }
  return args;
}

function assertSelf(cond, msg) {
  if (!cond) throw new Error(msg);
}

function extractCommentsAndStrings(source) {
  const segments = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const start = i;
      i += 2;
      while (i < n && source[i] !== '\n') i += 1;
      segments.push({ kind: 'comment', text: source.slice(start, i) });
      continue;
    }
    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i = Math.min(n, i + 2);
      segments.push({ kind: 'comment', text: source.slice(start, i) });
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch;
      const start = i;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      segments.push({ kind: 'string', text: source.slice(start, i) });
      continue;
    }
    i += 1;
  }
  return segments;
}

async function runStaticAudit() {
  const e2eDir = path.join(ROOT, 'scripts', 'e2e');
  const entries = await readdir(e2eDir);
  const files = [
    path.join(ROOT, 'scripts', 'e2e_live_room.mjs'),
    ...entries.filter((f) => f.endsWith('.mjs')).map((f) => path.join(e2eDir, f)),
  ];

  const doubleHyphen = '-'.repeat(2);
  const exitCallRe = new RegExp('\\bprocess' + '\\.exit\\s*\\(');
  const srcImportRe = new RegExp('(?:from|import)\\s*\\(?\\s*[\'"][^\'"]*\\/src\\/');
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const rel = path.relative(ROOT, file);

    assertSelf(!/[\u2014\u2013]/.test(content), `Banned dash found in ${rel}`);
    assertSelf(!content.includes(doubleHyphen), `Double hyphen found in ${rel}`);
    assertSelf(!exitCallRe.test(content), `Forbidden forced exit call found in ${rel}`);
    assertSelf(!srcImportRe.test(content), `Forbidden src/ import found in ${rel}`);

    const bangChar = String.fromCharCode(33);
    const segments = extractCommentsAndStrings(content);
    for (const seg of segments) {
      assertSelf(!seg.text.includes(bangChar), `Banned exclamation mark found in ${seg.kind} in ${rel}: ${seg.text.slice(0, 80)}`);
      assertSelf(!seg.text.includes(doubleHyphen), `Banned double hyphen found in ${seg.kind} in ${rel}`);
    }
  }
  return files.length;
}

async function runSelfTest() {
  console.log('[e2e self-test] Running browser-free checks...');

  // 1. CLI argument parsing checks
  const parsed = parseArgs([`${FLAG_PREFIX}tier`, '2', `${FLAG_PREFIX}port`, '5199', `${FLAG_PREFIX}out-dir`, 'captures/custom', `${FLAG_PREFIX}json`, 'captures/report.json']);
  assertSelf(parsed.tier === '2' && parsed.port === 5199, 'CLI parseArgs failed for tier/port');
  assertSelf(parsed.outDir.endsWith(path.join('captures', 'custom')), 'CLI parseArgs failed for out-dir');
  assertSelf(parsed.jsonPath.endsWith(path.join('captures', 'report.json')), 'CLI parseArgs failed for json');

  let badTierThrew = false;
  try {
    parseArgs([`${FLAG_PREFIX}tier`, '9']);
  } catch (e) {
    badTierThrew = e instanceof Refusal;
  }
  assertSelf(badTierThrew, 'Expected invalid tier to throw Refusal');

  // 2. Virtual Gamepad Mock checks
  const listeners = new Map();
  class FakeEvent {
    constructor(type) {
      this.type = type;
    }
  }
  function FakeNavigator() {}
  FakeNavigator.prototype.getGamepads = () => [];
  const fakeNav = new FakeNavigator();
  const fakeWin = {
    Event: FakeEvent,
    Navigator: FakeNavigator,
    navigator: fakeNav,
    performance: { now: () => 1234 },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(evt) {
      const list = listeners.get(evt.type) || [];
      for (const fn of list) fn(evt);
      return true;
    },
  };

  const eventsSeen = [];
  fakeWin.addEventListener('gamepadconnected', (e) => eventsSeen.push({ type: 'connected', id: e.gamepad?.id, idx: e.gamepad?.index }));
  fakeWin.addEventListener('gamepaddisconnected', (e) => eventsSeen.push({ type: 'disconnected', id: e.gamepad?.id, idx: e.gamepad?.index }));

  const padsApi = installVirtualGamepadMock(fakeWin, fakeNav);
  const initialList = Array.from(fakeNav.getGamepads());
  assertSelf(initialList.length === 4 && initialList.every((p) => p === null), 'Expected 4 null slots initially');

  padsApi.connect(0, { id: 'Pad-One' });
  padsApi.wake(1, [0, 9], { id: 'Dormant-Two' });
  const snap1 = fakeNav.getGamepads();
  assertSelf(snap1[0]?.id === 'Pad-One' && snap1[1]?.buttons[0]?.pressed === true && snap1[1]?.buttons[9]?.pressed === true, 'Expected wake() to expose pressed buttons on first poll');
  assertSelf(eventsSeen.length === 2 && eventsSeen[1].type === 'connected' && eventsSeen[1].id === 'Dormant-Two', 'Expected Event.gamepad property on gamepadconnected');

  padsApi.swapPad(1, 'Spare-Three', { buttons: [2] });
  assertSelf(fakeNav.getGamepads()[1]?.id === 'Spare-Three' && fakeNav.getGamepads()[1]?.buttons[2]?.pressed === true, 'Expected swapPad() to update id and held buttons');

  padsApi.setAxes(0, [0.5, -0.75, 0.1, 0]);
  assertSelf(fakeNav.getGamepads()[0].axes[1] === -0.75, 'Expected setAxes() to update pad axes');

  await fakeNav.getGamepads()[0].vibrationActuator.playEffect('dual-rumble', { strongMagnitude: 0.6 });
  assertSelf(padsApi.getHapticsLog().length === 1, 'Expected haptics playEffect to log entry');

  padsApi.disconnect(0);
  assertSelf(fakeNav.getGamepads()[0] === null, 'Expected disconnect() to clear slot');

  // 3. AudioContext inspection hook checks
  class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this._listeners = [];
    }
    addEventListener(type, fn) {
      if (type === 'statechange') this._listeners.push(fn);
    }
    async resume() {
      this.state = 'running';
      for (const fn of this._listeners) fn();
    }
  }
  const fakeAudioWin = { AudioContext: FakeAudioContext, webkitAudioContext: FakeAudioContext };
  const audioApi = installAudioInspectionHook(fakeAudioWin);
  const ctx = new fakeAudioWin.AudioContext();
  assertSelf(audioApi.snapshot().initialStates[0] === 'suspended' && audioApi.snapshot().resumeCalls === 0, 'Expected initial suspended AudioContext snapshot');
  await ctx.resume();
  const audioSnap = audioApi.snapshot();
  assertSelf(audioSnap.resumeCalls === 1 && audioSnap.currentStates[0] === 'running' && audioSnap.stateHistory[0].length === 2, 'Expected AudioContext hook to record resumeCalls and state transition');

  const audioApiSecond = installAudioInspectionHook(fakeAudioWin);
  assertSelf(audioApiSecond === audioApi, 'Expected second installAudioInspectionHook call to return existing api');
  const ctx2 = new fakeAudioWin.AudioContext();
  await ctx2.resume();
  const audioSnapAfterReinstall = fakeAudioWin.__vbE2EAudio.snapshot();
  assertSelf(
    audioSnapAfterReinstall.contextCount === 2 && audioSnapAfterReinstall.resumeCalls === 2,
    'Expected idempotent reinstall to preserve tracking for subsequent AudioContext instances',
  );

  // 4. portInUse refusal probe check
  const busyServer = net.createServer();
  await new Promise((resolve) => busyServer.listen(0, '127.0.0.1', resolve));
  const testPort = busyServer.address().port;
  try {
    const busy = await portInUse(testPort);
    assertSelf(busy === true, 'Expected portInUse to return true while port is bound');
  } finally {
    await new Promise((resolve) => busyServer.close(resolve));
  }
  const freed = await portInUse(testPort);
  assertSelf(freed === false, 'Expected portInUse to return false after server closes');

  // 5. Static invariant audit across all E2E files
  const auditedCount = await runStaticAudit();
  console.log(`[e2e self-test] PASS (cli, gamepadMock, audioHook, portInUse, staticAudit=${auditedCount} files)`);
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    return runSelfTest();
  }

  if (await portInUse(args.port)) {
    throw new Refusal(`Port ${args.port} is already in use. Stop the existing server or choose another port.`);
  }

  let server;
  let browser;
  const results = [];

  try {
    server = await createServer({
      root: ROOT,
      configFile: path.join(ROOT, 'vite.config.js'),
      logLevel: 'warn',
      server: { port: args.port, strictPort: true },
    });
    await server.listen();

    browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    const tierResults = await runE2ETiers({
      browser,
      port: args.port,
      tierFilter: args.tier,
      outDir: args.outDir,
    });
    results.push(...tierResults);
  } finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;
  console.log(`\n[e2e] Summary: ${passedCount}/${results.length} passed, ${failedCount} failed`);

  if (args.jsonPath) {
    await mkdir(path.dirname(args.jsonPath), { recursive: true });
    await writeFile(
      args.jsonPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          port: args.port,
          tier: args.tier,
          outDir: args.outDir,
          passedCount,
          failedCount,
          results,
        },
        null,
        2,
      ),
    );
  }

  return failedCount === 0 ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      if (err instanceof Refusal) {
        console.error(`\n[e2e] Refused: ${err.message}\n`);
      } else if (err instanceof RunFailure) {
        console.error(`\n[e2e] Failure: ${err.message}\n`);
      } else {
        console.error(`\n[e2e] Unexpected error: ${err?.stack || err?.message || String(err)}\n`);
      }
      process.exitCode = 1;
    });
}
