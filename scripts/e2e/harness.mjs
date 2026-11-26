/**
 * Shared Playwright scenario harness, gamepad RPC helpers, tick/state
 * synchronization, and screenshot capture utilities for E2E Tiers 1 to 4.
 */

import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import { installAudioInspectionHook } from './audioHook.mjs';
import { installVirtualGamepadMock } from './gamepadMock.mjs';

const FLAG_PREFIX = '-'.repeat(2);

export const DEFAULT_PORT = 5185;
export const BOOT_TIMEOUT_MS = 240_000;
export const CHROMIUM_ARGS = [
  'use-gl=angle',
  'use-angle=swiftshader',
  'enable-unsafe-swiftshader',
  'ignore-gpu-blocklist',
].map((flag) => FLAG_PREFIX + flag);

export class Refusal extends Error {}
export class RunFailure extends Error {}

export function assert(condition, message) {
  if (!condition) {
    throw new RunFailure(message);
  }
}

export function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

export function buildAppUrl(port, query = '') {
  const base = `http://localhost:${port}/Valleyball-Versus/`;
  if (!query) return base;
  return base + (query.startsWith('?') ? query : `?${query}`);
}

export async function waitForBoot(page, timeout = BOOT_TIMEOUT_MS) {
  await page.waitForFunction(
    () => {
      const vb = window.__vb;
      if (!vb || !vb.loop || vb.loop.tick <= 0) return false;
      const loading = document.getElementById('loading-screen');
      if (loading && getComputedStyle(loading).display !== 'none') return false;
      return true;
    },
    null,
    { timeout },
  );
}

export async function runStep(label, fn) {
  try {
    return await fn();
  } catch (err) {
    const msg = `[${label}] ${err?.message || String(err)}`;
    if (err instanceof Refusal) throw new Refusal(msg);
    if (err instanceof RunFailure) throw new RunFailure(msg);
    const wrapped = new Error(msg);
    wrapped.cause = err;
    throw wrapped;
  }
}

async function readLiveLoopSnapshot(page) {
  return page.evaluate(() => {
    const vb = window.__vb;
    const ov = document.getElementById('controller-disconnect-overlay');
    return {
      tick: vb?.loop?.tick ?? null,
      paused: vb?.loop ? Boolean(vb.loop.paused) : null,
      gameState: vb?.getGameState?.() ?? null,
      isCountingDown: vb?.matchState ? Boolean(vb.matchState.isCountingDown) : null,
      countdownTicksRemaining: vb?.matchState?.countdownTicksRemaining ?? null,
      disconnectOpen: Boolean(ov && getComputedStyle(ov).display !== 'none'),
    };
  }).catch(() => ({
    tick: null,
    paused: null,
    gameState: null,
    isCountingDown: null,
    countdownTicksRemaining: null,
    disconnectOpen: null,
  }));
}

export async function withIsolatedScenario(browser, url, optionsOrFn, maybeFn) {
  const options = typeof optionsOrFn === 'function' ? {} : (optionsOrFn || {});
  const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
  if (typeof fn !== 'function') {
    throw new TypeError('withIsolatedScenario requires a scenario callback function');
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const errors = [];

  try {
    await context.addInitScript(installVirtualGamepadMock);
    await context.addInitScript(installAudioInspectionHook);
    if (options.initLocalStorage && typeof options.initLocalStorage === 'object') {
      await context.addInitScript((entries) => {
        if (window.sessionStorage.getItem('__vb_e2e_seeded')) return;
        window.sessionStorage.setItem('__vb_e2e_seeded', '1');
        for (const [k, v] of Object.entries(entries)) {
          window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        }
      }, options.initLocalStorage);
    }

    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(`console.error: ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      errors.push(`pageerror: ${err?.message || String(err)}`);
    });

    await page.goto(url, { waitUntil: 'commit', timeout: BOOT_TIMEOUT_MS });
    if (!options.skipWaitForBoot) {
      await waitForBoot(page, options.bootTimeoutMs || BOOT_TIMEOUT_MS);
    }

    const result = await fn({ page, context, errors });
    if (!options.allowErrors && errors.length > 0) {
      throw new RunFailure(`Uncaught browser error(s):\n  ${errors.join('\n  ')}`);
    }
    return result;
  } catch (err) {
    if (!options.allowErrors && errors.length > 0 && !(err instanceof RunFailure && err.message.startsWith('Uncaught browser error(s):'))) {
      const suffix = `\nCaptured browser error(s):\n  ${errors.join('\n  ')}`;
      const msg = `${err?.message || String(err)}${suffix}`;
      if (err instanceof Refusal) throw new Refusal(msg);
      throw new RunFailure(msg);
    }
    throw err;
  } finally {
    await context.close().catch(() => {});
  }
}

export async function padConnect(page, index, opts = {}) {
  await page.evaluate(
    ([idx, o]) => {
      window.__vbE2EPads.connect(idx, o);
    },
    [index, opts],
  );
}

export async function padWake(page, index, buttons = [0], opts = {}) {
  await page.evaluate(
    ([idx, btns, o]) => {
      window.__vbE2EPads.wake(idx, btns, o);
    },
    [index, buttons, opts],
  );
}

export async function padDisconnect(page, index, opts = {}) {
  await page.evaluate(
    ([idx, o]) => {
      window.__vbE2EPads.disconnect(idx, o);
    },
    [index, opts],
  );
}

export async function padSwap(page, index, newId, opts = {}) {
  await page.evaluate(
    ([idx, id, o]) => {
      window.__vbE2EPads.swapPad(idx, id, o);
    },
    [index, newId, opts],
  );
}

export async function padSetButtons(page, index, pressedList = [], triggerValues = {}) {
  await page.evaluate(
    ([idx, btns, trig]) => {
      window.__vbE2EPads.setButtons(idx, btns, trig);
    },
    [index, pressedList, triggerValues],
  );
}

export async function padSetAxes(page, index, axes = [0, 0, 0, 0]) {
  await page.evaluate(
    ([idx, ax]) => {
      window.__vbE2EPads.setAxes(idx, ax);
    },
    [index, axes],
  );
}

async function waitForTickOrRaf(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const loop = window.__vb?.loop;
    if (loop && !loop.paused && loop._running !== false) {
      const startTick = loop.tick ?? 0;
      const check = () => {
        const cur = window.__vb?.loop;
        if (!cur || cur.paused || cur._running === false || (cur.tick ?? 0) >= startTick + 2) {
          resolve();
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

export async function padPress(page, index, btnIdx, holdMs = 140, releaseMs = 80) {
  await page.evaluate(
    ([idx, btn]) => {
      window.__vbE2EPads.setButton(idx, btn, true, 1);
    },
    [index, btnIdx],
  );
  await Promise.all([
    page.waitForTimeout(holdMs),
    waitForTickOrRaf(page),
  ]);
  await page.evaluate(
    ([idx, btn]) => {
      window.__vbE2EPads.setButton(idx, btn, false, 0);
    },
    [index, btnIdx],
  );
  await Promise.all([
    page.waitForTimeout(releaseMs),
    waitForTickOrRaf(page),
  ]);
}

export async function waitForTicks(page, deltaTicks = 8, timeout = 45_000) {
  const startTick = await page.evaluate(() => window.__vb?.loop?.tick ?? 0);
  try {
    await page.waitForFunction(
      (target) => (window.__vb?.loop?.tick ?? 0) >= target,
      startTick + deltaTicks,
      { timeout },
    );
  } catch (err) {
    const snap = await readLiveLoopSnapshot(page);
    throw new RunFailure(`waitForTicks(${deltaTicks}) failed: ${err?.message || String(err)} | snapshot=${JSON.stringify(snap)}`);
  }
}

export async function waitForGameState(page, expectedState, timeout = 30_000) {
  await page.waitForFunction(
    (s) => window.__vb?.getGameState?.() === s,
    expectedState,
    { timeout },
  );
}

export async function waitForCountdownDone(page, timeout = 90_000) {
  const startMs = Date.now();
  let lastTick = null;
  let lastTickChangeAt = startMs;
  while (true) {
    const snap = await readLiveLoopSnapshot(page);
    if (snap.isCountingDown === false && snap.countdownTicksRemaining !== null) {
      return;
    }
    if (snap.paused === true) {
      throw new RunFailure(`Loop paused unexpectedly during countdown: ${JSON.stringify(snap)}`);
    }
    const now = Date.now();
    if (snap.tick !== null && snap.tick !== lastTick) {
      lastTick = snap.tick;
      lastTickChangeAt = now;
    } else if (now - lastTickChangeAt >= 10_000) {
      throw new RunFailure(`Loop tick stalled for 10000ms during countdown: ${JSON.stringify(snap)}`);
    }
    if (now - startMs >= timeout) {
      throw new RunFailure(`waitForCountdownDone timed out after ${timeout}ms: ${JSON.stringify(snap)}`);
    }
    await page.waitForTimeout(150);
  }
}

export async function skipFlyover(page, timeout = 20_000) {
  const gs = await page.evaluate(() => window.__vb?.getGameState?.());
  if (gs === 'flyover') {
    const skipBtn = page.locator('#btn-skip-flyover');
    if (await skipBtn.isVisible().catch(() => false)) {
      await skipBtn.click();
    } else {
      await page.keyboard.press('Space');
    }
  }
  await waitForGameState(page, 'match', timeout);
}

export async function driveMatchToVictory(page, { homeScore = 1, awayScore = 0 } = {}) {
  await waitForCountdownDone(page, 90_000);
  await page.evaluate(
    ([h, a]) => {
      const ms = window.__vb.matchState;
      ms.scoreHome = h;
      ms.scoreAway = a;
      ms.ticksRemaining = 2;
    },
    [homeScore, awayScore],
  );
  await page.waitForFunction(
    () => {
      const ov = document.getElementById('victory-overlay');
      return ov && getComputedStyle(ov).display === 'flex' && Boolean(window.__vb?.lastMatchResult);
    },
    null,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(850);
}

export async function captureScreenshot(page, outDir, filename) {
  if (!outDir) return null;
  await mkdir(outDir, { recursive: true });
  const fullPath = path.join(outDir, filename);
  await page.screenshot({ path: fullPath });
  return fullPath;
}
