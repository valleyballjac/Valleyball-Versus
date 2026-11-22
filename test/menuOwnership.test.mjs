/**
 * Regression tests for Stage 3 Multi-Controller Menu Ownership & Practice Mode Overhaul.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { state } from '../src/features/ui/mainMenu/state.js';
import {
  setMenuNavigationContext,
  startMenuGamepadPolling,
  stopSetupGamepadPolling,
} from '../src/features/ui/mainMenu/menuNavigation.js';
import {
  setExplicitDeviceMappings,
  getExplicitDeviceMappings,
  getAssignedSlotForPad,
  syncExplicitMappingsWithConfigs,
  sampleAllInputs,
  getInputSlot,
} from '../src/input/inputRouter.js';
import { moveScreen1Row } from '../src/features/ui/mainMenu/menuNavigation.js';
import {
  practiceStats,
  newcomerDrill,
  resetPracticeStats,
  setSelectedPracticeDrill,
  syncPracticeStrikeStats,
  summonPracticeBall,
  stepPracticeDrillTick,
  applyPracticeHudOverrides,
  restorePracticeHudOverrides,
} from '../src/features/match/practiceMode.js';
import { getHudPrefs, resetHudPrefs } from '../src/config/hudConfig.js';

function makePad(index, pressedIdx = -1) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: i === pressedIdx,
    value: i === pressedIdx ? 1 : 0,
  }));
  return {
    index,
    id: `Mock Pad ${index}`,
    connected: true,
    axes: [0, 0, 0, 0],
    buttons,
  };
}

test('Title Screen Dynamic Lobby Host lets Pad 2 claim host and navigate even with Pad 0 idle', () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevNavigator = globalThis.navigator;
  const prevSetInterval = globalThis.setInterval;
  const prevClearInterval = globalThis.clearInterval;

  let pollFn = null;
  let pads = [makePad(0), makePad(2)];
  let clickedBtn = -1;

  try {
    globalThis.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    globalThis.document = { getElementById: () => null };
    Object.defineProperty(globalThis, 'navigator', {
      value: { getGamepads: () => pads },
      configurable: true,
    });
    globalThis.setInterval = (fn) => { pollFn = fn; return 99; };
    globalThis.clearInterval = () => {};

    state.rootEl = { style: { display: 'flex' } };
    state.titleScreenEl = { style: { display: 'flex' } };
    state.controllerAssignmentEl = null;
    state.lobbyHostPadIndex = null;
    state.titleFocusIndex = 1;
    const btns = [0, 1, 2].map((i) => ({
      style: {},
      dataset: {},
      classList: { remove: () => {}, add: () => {} },
      focus: () => {},
      click: () => { clickedBtn = i; },
    }));
    state.titleButtons = btns;

    setMenuNavigationContext({
      getTitleButtons: () => btns,
      getTitleFocusIndex: () => state.titleFocusIndex,
      playerSetup: { playerSetupEl: { style: { display: 'none' } } },
    });

    startMenuGamepadPolling();
    assert.equal(typeof pollFn, 'function');

    // Pad 2 presses D-Pad Down (13) while Pad 0 is idle -> claims Lobby Host and moves focus 1 -> 2
    pads = [makePad(0), makePad(2, 13)];
    pollFn();
    assert.equal(state.lobbyHostPadIndex, 2);
    assert.equal(state.titleFocusIndex, 2);

    // Release, then Pad 2 presses A (0) -> activates button 2
    pads = [makePad(0), makePad(2)];
    pollFn();
    pads = [makePad(0), makePad(2, 0)];
    pollFn();
    assert.equal(clickedBtn, 2);
  } finally {
    stopSetupGamepadPolling();
    state.rootEl = null;
    state.titleScreenEl = null;
    state.lobbyHostPadIndex = null;
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', { value: prevNavigator, configurable: true });
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    globalThis.setInterval = prevSetInterval;
    globalThis.clearInterval = prevClearInterval;
  }
});

test('P2 cannot kick room back or jump pages, and unassigned Pad 2 cannot hijack P1 when Pad 0 is mapped', () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevNavigator = globalThis.navigator;
  const prevSetInterval = globalThis.setInterval;
  const prevClearInterval = globalThis.clearInterval;

  let pollFn = null;
  let pads = [makePad(0), makePad(1), makePad(2)];
  let backClicked = 0;
  const cycled = [];

  try {
    globalThis.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      _updateSetupPage: () => {},
    };
    globalThis.document = { getElementById: () => null };
    Object.defineProperty(globalThis, 'navigator', {
      value: { getGamepads: () => pads },
      configurable: true,
    });
    globalThis.setInterval = (fn) => { pollFn = fn; return 101; };
    globalThis.clearInterval = () => {};

    state.rootEl = { style: { display: 'flex' } };
    state.titleScreenEl = { style: { display: 'none' } };
    state.controllerAssignmentEl = null;

    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, name: 'Pad 1' },
      1: { type: 'gamepad', padIndex: 1, name: 'Pad 2' },
    });

    const ps = {
      playerSetupEl: { style: { display: 'flex' } },
      currentSetupMode: 'match',
      setupPage: 1,
      focusedColumn: 0,
      playerFocusRow: [2, 2, 2, 2],
      screen1ActionCol: 1,
      matchRulesFocusRow: 0,
      matchRulesActionCol: 1,
      matchCountdownActive: false,
      playerReadyState: [false, false, true, true],
      playerConfigs: [{ type: 'human' }, { type: 'human' }],
      btnBack: { click: () => { backClicked += 1; } },
      btnStartMatch: { disabled: true, click: () => {} },
      getActiveMatchPlayerCount: () => 2,
      isVersusLobby: () => true,
      updateInputBadgesUI: () => {},
      updateFocusUI: () => {},
      updateReadyUI: () => {},
      pulsePlayerCard: () => {},
      cycleOption: (col, row, dir) => cycled.push({ col, row, dir }),
      togglePlayerReady: (slotIdx) => { ps.playerReadyState[slotIdx] = !ps.playerReadyState[slotIdx]; },
    };

    setMenuNavigationContext({ playerSetup: ps });
    startMenuGamepadPolling();

    // Unassigned Pad 2 presses D-Pad Right (15) -> must be ignored completely!
    pads = [makePad(0), makePad(1), makePad(2, 15)];
    pollFn();
    assert.equal(cycled.length, 0, 'Unassigned Pad 2 must not edit P1 or P2');

    // Release
    pads = [makePad(0), makePad(1), makePad(2)];
    pollFn();

    // P2 (Pad 1) presses B (1) on Page 1 -> must NOT click btnBack!
    pads = [makePad(0), makePad(1, 1), makePad(2)];
    pollFn();
    assert.equal(backClicked, 0, 'P2 pressing B on Page 1 must never exit the room');

    // Release, then P2 presses Start (9) on Page 1 -> toggles P2 ready, stays on Page 1!
    pads = [makePad(0), makePad(1), makePad(2)];
    pollFn();
    pads = [makePad(0), makePad(1, 9), makePad(2)];
    pollFn();
    assert.equal(ps.setupPage, 1, 'P2 pressing Start on Page 1 must not yank P1 to Page 2');
    assert.equal(ps.playerReadyState[1], true, 'P2 pressing Start on Page 1 toggles P2 Ready');

    // Advance to Page 2 via P1 (Pad 0) Start (9)
    pads = [makePad(0), makePad(1), makePad(2)];
    pollFn();
    pads = [makePad(0, 9), makePad(1), makePad(2)];
    pollFn();
    assert.equal(ps.setupPage, 2, 'Host P1 Start advances to Page 2');

    // On Page 2, P2 presses B (1) twice: first un-readies P2, second stays on Page 2 (never kicks P1 back!)
    pads = [makePad(0), makePad(1), makePad(2)];
    pollFn();
    pads = [makePad(0), makePad(1, 1), makePad(2)];
    pollFn();
    assert.equal(ps.playerReadyState[1], false);
    assert.equal(ps.setupPage, 2);

    pads = [makePad(0), makePad(1), makePad(2)];
    pollFn();
    pads = [makePad(0), makePad(1, 1), makePad(2)];
    pollFn();
    assert.equal(ps.setupPage, 2, 'P2 pressing B on Page 2 when unready must not yank Host back to Page 1');
  } finally {
    stopSetupGamepadPolling();
    setExplicitDeviceMappings(null);
    state.rootEl = null;
    state.titleScreenEl = null;
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', { value: prevNavigator, configurable: true });
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    globalThis.setInterval = prevSetInterval;
    globalThis.clearInterval = prevClearInterval;
  }
});

test('Practice Mode self-toss, 60s Newcomer Drill completion, and temporary HUD overrides work cleanly', () => {
  resetHudPrefs();
  assert.equal(getHudPrefs().ballDropRing, false);
  assert.equal(getHudPrefs().strikeRangeGuide, false);

  setSelectedPracticeDrill('newcomer_drill');
  resetPracticeStats();
  applyPracticeHudOverrides('newcomer_drill');

  assert.equal(getHudPrefs().ballDropRing, true, 'Newcomer drill enables Rainbow Halo temporarily');
  assert.equal(getHudPrefs().strikeRangeGuide, true, 'Newcomer drill enables Strike Guide temporarily');

  // Test 1-button Ball Summon & Self-Toss right in front of facing athlete
  let lastToss = null;
  const mockAthlete = {
    motor: { body: { translation: () => ({ x: 2, y: 1.0, z: 5 }) } },
    animTarget: { yaw: 0 }, // facing +Z
    getStrikeStats: () => ({ hits: 3, whiffs: 1 }),
  };
  const mockBall = {
    body: { isEnabled: () => true, translation: () => ({ x: -10, y: 1, z: -10 }) },
  };
  const ok = summonPracticeBall(mockAthlete, [mockBall], 120, (_b, _t, pos, vel) => {
    lastToss = { pos: { ...pos }, vel: { ...vel } };
  });
  assert.equal(ok, true);
  assert.ok(lastToss.pos.z > 7.0 && lastToss.pos.y > 3.0, 'Self-toss places ball ahead and at lob height');
  assert.ok(lastToss.vel.y > 3.0, 'Self-toss imparts gentle upward toss velocity');

  // Complete all 4 Newcomer Drill milestones
  practiceStats.spikes = 1;
  practiceStats.dives = 1;
  practiceStats.goals = 1;
  stepPracticeDrillTick({ tick: 120, athletes: [mockAthlete], balls: [mockBall], resetBallFn: () => {} });
  syncPracticeStrikeStats(mockAthlete);
  assert.equal(newcomerDrill.completed, true, 'All 4 milestones complete the 60s Newcomer Drill');

  // Leaving Practice restores user HUD prefs cleanly
  restorePracticeHudOverrides();
  assert.equal(getHudPrefs().ballDropRing, false);
  assert.equal(getHudPrefs().strikeRangeGuide, false);
  setSelectedPracticeDrill('sandbox');
});

test('P1 pressing Y on AI P2 never steals P1 gamepad, P2 skips Row 6 CTRL, and syncExplicitMappingsWithConfigs enforces 1:1 parity', () => {
  // 1. Pre-match mapping integrity: strips AI slots, deduplicates stolen pads, and keeps valid human owners intact
  setExplicitDeviceMappings({
    0: { type: 'gamepad', padIndex: 0, name: 'Gamepad 1' },
    1: { type: 'gamepad', padIndex: 0, name: 'Gamepad 1 (duplicate!)' }, // corrupt duplicate
    2: { type: 'gamepad', padIndex: 2, name: 'Gamepad 3' }, // slot 2 is AI!
  });
  syncExplicitMappingsWithConfigs(
    [{ type: 'human' }, { type: 'human' }, { type: 'ai' }, { type: 'ai' }],
    4,
  );
  const synced = getExplicitDeviceMappings();
  assert.equal(synced[0]?.type, 'gamepad');
  assert.equal(synced[0]?.padIndex, 0, 'P1 keeps Pad 0');
  assert.notEqual(synced[1]?.padIndex, 0, 'P2 must never share Pad 0 with P1');
  assert.equal(synced[2], undefined, 'AI slot 2 mapping must be cleared');
  assert.equal(getAssignedSlotForPad(0), 0);

  // 2. Human player scrolling down from Row 5 (Assist) skips Row 6 (CTRL) directly to Row 8 (Action Bar)
  const mockPs = {
    playerFocusRow: [5, 5, 2, 2],
    playerConfigs: [{ type: 'human' }, { type: 'human' }, { type: 'ai' }, { type: 'ai' }],
    focusedColumn: 1,
    screen1ActionCol: 0,
    updateFocusUI: () => {},
  };
  setMenuNavigationContext({ playerSetup: mockPs });
  moveScreen1Row(1, 1, 1);
  assert.equal(mockPs.playerFocusRow[1], 8, 'Human P2 scrolling down past Assist skips Row 6 CTRL so they cannot self-wipe to AI');
  moveScreen1Row(1, -1, 1);
  assert.equal(mockPs.playerFocusRow[1], 5, 'Human P2 scrolling up from Row 8 skips Row 6 CTRL cleanly back to Row 5');

  setExplicitDeviceMappings(null);
});

test('Priority 1 regression: 2-gamepad Match 1 routes BOTH Pad 0 -> P1 and Pad 1 -> P2 under mode="match"', () => {
  const prevNavigator = globalThis.navigator;
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  try {
    const pad0 = makePad(0);
    pad0.axes = [0.85, 0, 0, 0];
    const pad1 = makePad(1);
    pad1.axes = [-0.9, 0, 0, 0];

    Object.defineProperty(globalThis, 'navigator', {
      value: { getGamepads: () => [pad0, pad1] },
      configurable: true,
    });
    globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
    globalThis.document = { getElementById: () => null, pointerLockElement: null };

    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, name: 'Pad 1' },
      1: { type: 'gamepad', padIndex: 1, name: 'Pad 2' },
    });

    // Camera facing -Z (identity quaternion)
    const mockCam = {
      getWorldDirection(v) { v.set(0, 0, -1); return v; },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    };

    sampleAllInputs([mockCam, mockCam], 2, 'match', []);
    const p1 = getInputSlot(0);
    const p2 = getInputSlot(1);
    assert.ok(p1.moveWorld.length() > 0.5, 'P1 must receive Pad 0 stick movement on Match 1');
    assert.ok(p2.moveWorld.length() > 0.5, 'P2 must receive Pad 1 stick movement on Match 1 (not dropped by stale practice mode!)');
  } finally {
    setExplicitDeviceMappings(null);
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', { value: prevNavigator, configurable: true });
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
  }
});

test('Pressing A on Setup option rows advances focus down WITHOUT cycling or resetting options (Page 1, Page 2, Practice)', () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevNavigator = globalThis.navigator;
  const prevSetInterval = globalThis.setInterval;
  const prevClearInterval = globalThis.clearInterval;

  let pollFn = null;
  let pads = [makePad(0)];
  const mutations = [];

  try {
    globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, _updateSetupPage: () => {} };
    globalThis.document = { getElementById: () => null };
    Object.defineProperty(globalThis, 'navigator', {
      value: { getGamepads: () => pads },
      configurable: true,
    });
    globalThis.setInterval = (fn) => { pollFn = fn; return 202; };
    globalThis.clearInterval = () => {};

    state.rootEl = { style: { display: 'flex' } };
    state.titleScreenEl = { style: { display: 'none' } };
    state.controllerAssignmentEl = null;
    setExplicitDeviceMappings({ 0: { type: 'gamepad', padIndex: 0, name: 'Pad 1' } });

    const ps = {
      playerSetupEl: { style: { display: 'flex' } },
      currentSetupMode: 'match',
      setupPage: 1,
      focusedColumn: 0,
      playerFocusRow: [2, 2, 2, 2],
      screen1ActionCol: 1,
      matchRulesFocusRow: 0,
      matchRulesActionCol: 1,
      practiceActionCol: 1,
      matchCountdownActive: false,
      playerReadyState: [false, false, true, true],
      playerConfigs: [{ type: 'human' }, { type: 'human' }],
      btnBack: { click: () => {} },
      btnStartMatch: { disabled: false, click: () => {} },
      getActiveMatchPlayerCount: () => 2,
      isVersusLobby: () => true,
      updateInputBadgesUI: () => {},
      updateFocusUI: () => {},
      updateReadyUI: () => {},
      pulsePlayerCard: () => {},
      cycleOption: (...args) => mutations.push(['cycleOption', ...args]),
      cycleMatchBall: (...args) => mutations.push(['cycleMatchBall', ...args]),
      cycleMatchDuration: (...args) => mutations.push(['cycleMatchDuration', ...args]),
      togglePlayerReady: () => {},
      launchMatchNow: () => {},
    };

    setMenuNavigationContext({ playerSetup: ps });
    startMenuGamepadPolling();

    // Match Page 1: Row 2 -> pressing A advances to Row 3 without mutating option!
    pads = [makePad(0, 0)];
    pollFn();
    assert.equal(ps.playerFocusRow[0], 3, 'Pressing A on Page 1 Row 2 advances focus to Row 3');
    assert.equal(mutations.length, 0, 'Pressing A on Page 1 option row must never cycle/reset options');

    // Release -> Match Page 2: Row 0 (Match Ball) -> pressing A advances to Row 1 (Duration) without changing ball!
    pads = [makePad(0)];
    pollFn();
    ps.setupPage = 2;
    ps.matchRulesFocusRow = 0;
    pads = [makePad(0, 0)];
    pollFn();
    assert.equal(ps.matchRulesFocusRow, 1, 'Pressing A on Page 2 Match Ball advances focus to Duration');
    assert.equal(mutations.length, 0, 'Pressing A on Page 2 option row must never cycle ball/duration');

    // Release -> Practice Free Sandbox: Row 7 (Ball) -> pressing A advances to Row 8 (Action Bar) without changing ball!
    pads = [makePad(0)];
    pollFn();
    ps.currentSetupMode = 'practice';
    ps.playerFocusRow[0] = 7;
    pads = [makePad(0, 0)];
    pollFn();
    assert.equal(ps.playerFocusRow[0], 8, 'Pressing A on Practice Ball row advances focus to Action Bar');
    assert.equal(mutations.length, 0, 'Pressing A on Practice option row must never cycle options');
  } finally {
    stopSetupGamepadPolling();
    setExplicitDeviceMappings(null);
    state.rootEl = null;
    state.titleScreenEl = null;
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', { value: prevNavigator, configurable: true });
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    globalThis.setInterval = prevSetInterval;
    globalThis.clearInterval = prevClearInterval;
  }
});
