/**
 * Regression tests for the v0.4.2.1 tournament-hardening pass:
 *   1. `TUNING.action.interceptDiveWindowTicks` is defined (28 ticks) so Brace+Dive saves avoid whiff stun.
 *   2. `buildMatchStatsReport` respects `activeCount: 2` when 2v2 -> 1v1 drops disabled athletes.
 *   3. `MatchManager.resetMatchState()` produces finite `dropState.spawnPosition` coordinates.
 *   4. `overtimeMenu.js` and `mobileNotice.js` contain zero em dashes or en dashes.
 *   5. `readableOnDark()` lifts dark team colors (e.g. Blue #1D4ED8, Red #D90429) to >= 4.5:1 WCAG AA on #0e141e.
 *   6. `initMobileNotice()` suppresses on Electron desktop, active gamepads, and wide touchscreens.
 *
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TUNING } from '../src/config/tuning.js';
import { buildMatchStatsReport, MatchManager } from '../src/features/match/matchManager.js';
import { readableOnDark } from '../src/ui/victoryScreen.js';
import { initMobileNotice } from '../src/features/ui/mainMenu/mobileNotice.js';

function relLuminance(hex) {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  const rgb = [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  const lin = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(hexA, hexB) {
  const l1 = relLuminance(hexA);
  const l2 = relLuminance(hexB);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test('TUNING.action.interceptDiveWindowTicks is a finite positive integer', () => {
  assert.equal(Number.isFinite(TUNING.action.interceptDiveWindowTicks), true);
  assert.equal(TUNING.action.interceptDiveWindowTicks, 28);
});

test('buildMatchStatsReport honors 2 enabled athletes when 4 total slots exist (2v2 -> 1v1)', () => {
  const athletes = [
    { isEnabled: true, team: 'home', getStrikeStats: () => ({ hits: 4, whiffs: 1, accuracy: 80 }) },
    { isEnabled: true, team: 'away', getStrikeStats: () => ({ hits: 3, whiffs: 2, accuracy: 60 }) },
    { isEnabled: false, team: 'home', getStrikeStats: () => ({ hits: 0, whiffs: 0, accuracy: 0 }) },
    { isEnabled: false, team: 'away', getStrikeStats: () => ({ hits: 0, whiffs: 0, accuracy: 0 }) },
  ];
  const enabledCount = Math.max(2, athletes.filter((a) => a && a.isEnabled !== false).length);
  const report = buildMatchStatsReport({
    match: { scoreHome: 2, scoreAway: 1 },
    athletes,
    playerConfigs: [{ team: 'home' }, { team: 'away' }, { team: 'home' }, { team: 'away' }],
    activeCount: enabledCount,
  });

  assert.equal(report.activeCount, 2);
  assert.equal(report.format, '1v1');
  assert.equal(report.is2v2, false);
  assert.equal(report.players.length, 2);
});

test('MatchManager.resetMatchState initializes finite dropState.spawnPosition', () => {
  const mm = new MatchManager();
  const st = mm.resetMatchState({ mode: 'match' });
  assert.equal(Number.isFinite(st.dropState?.spawnPosition?.x), true);
  assert.equal(Number.isFinite(st.dropState?.spawnPosition?.y), true);
  assert.equal(Number.isFinite(st.dropState?.spawnPosition?.z), true);
});

test('overtimeMenu.js and mobileNotice.js contain zero em dashes or en dashes', () => {
  for (const relPath of ['../src/ui/overtimeMenu.js', '../src/features/ui/mainMenu/mobileNotice.js']) {
    const text = readFileSync(new URL(relPath, import.meta.url), 'utf8');
    assert.equal(text.includes('\u2014'), false, `${relPath} must not contain em dash (U+2014)`);
    assert.equal(text.includes('\u2013'), false, `${relPath} must not contain en dash (U+2013)`);
  }
});

test('readableOnDark guarantees >= 4.5:1 WCAG AA contrast for dark team colors on Victory card', () => {
  for (const hex of ['#0f172a', '#1d4ed8', '#d90429', '#15803d', '#8b5cf6']) {
    const safe = readableOnDark(hex, '#0e141e');
    const ratio = contrast(safe, '#0e141e');
    assert.ok(ratio >= 4.5, `Expected ${hex} -> ${safe} to have >= 4.5:1 contrast, got ${ratio.toFixed(2)}`);
  }
});

test('initMobileNotice skips desktop Electron, connected gamepads, and wide touchscreen laptops', () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevNavigator = globalThis.navigator;
  const prevSession = globalThis.sessionStorage;

  try {
    let appended = 0;
    globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
    globalThis.document = {
      createElement: () => ({ style: {}, querySelector: () => null }),
      body: { appendChild: () => { appended++; } },
    };

    // 1. Desktop Electron suppresses notice
    globalThis.window = { desktopAPI: { isDesktop: true }, innerWidth: 1920, ontouchstart: true };
    Object.defineProperty(globalThis, 'navigator', {
      value: { maxTouchPoints: 10, userAgent: 'Mozilla/5.0 (Windows NT 10.0)', getGamepads: () => [] },
      configurable: true,
    });
    initMobileNotice();
    assert.equal(appended, 0);

    // 2. Wide touchscreen desktop browser suppresses notice
    globalThis.window = { innerWidth: 1600, ontouchstart: true };
    initMobileNotice();
    assert.equal(appended, 0);

    // 3. Connected gamepad suppresses notice even on small viewport
    globalThis.window = { innerWidth: 640, ontouchstart: true };
    Object.defineProperty(globalThis, 'navigator', {
      value: { maxTouchPoints: 5, userAgent: 'Mozilla/5.0', getGamepads: () => [{ connected: true }] },
      configurable: true,
    });
    initMobileNotice();
    assert.equal(appended, 0);

    // 4. Actual mobile phone without gamepad shows notice
    Object.defineProperty(globalThis, 'navigator', {
      value: { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (iPhone)', getGamepads: () => [] },
      configurable: true,
    });
    initMobileNotice();
    assert.equal(appended, 1);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', { value: prevNavigator, configurable: true });
    if (prevSession === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = prevSession;
  }
});
