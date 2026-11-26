/**
 * Tests for v0.4.2.2 Smash-Level Controller Drop-In, Hot-Swap, Disconnect Modal,
 * Walk-Up Join, Side Swap, and P2 to P4 Keyboard/Mouse Ready Unblock.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createMenuPadTracker, MENU_PAD } from '../src/input/menuPads.js';
import {
  setExplicitDeviceMappings,
  getExplicitDeviceMappings,
  getAssignedSlotForPad,
  sampleAllInputs,
  getInputSlot,
  getControlsSnapshot,
  clearGameplayInputQueues,
  getDisconnectedMappedSlots,
  getUnclaimedConnectedPads,
  reassignSlotToPad,
  reassignSlotToKeyboard,
  refreshDisconnectRouting,
  initInputRouter,
  clearDeviceMappingForSlot,
} from '../src/input/inputRouter.js';
import { state as menuState } from '../src/features/ui/mainMenu/state.js';
import {
  buildControllerAssignmentScreen,
  showControllerAssignment,
  hideControllerAssignment,
  pollAssignmentGamepads,
  swapSides,
  proceedToSetup,
  quickStartMatch,
} from '../src/features/ui/mainMenu/controllerAssignment.js';
import {
  setMenuNavigationContext,
  startMenuGamepadPolling,
  stopSetupGamepadPolling,
} from '../src/features/ui/mainMenu/menuNavigation.js';
import {
  buildPlayerSetupScreen,
  playerSetup,
  applyControllerAssignments,
  updateReadyUI,
  cancelMatchCountdown,
  getPlayerReadyState,
  getPlayerConfigs,
  getFocusedColumn,
  setFocusedColumn,
  setSetupPage,
  getSetupPage,
  getSelectedMatchBall,
  setSelectedMatchBall,
  setMatchFormat,
  setCurrentSetupMode,
  getMatchRulesFocusRow,
  getMatchRulesActionCol,
  getBtnStartMatch,
  getPlayerReadyButtons,
  toggleLobbySlotHumanAi,
  claimLobbySlotForPad,
} from '../src/features/ui/mainMenu/playerSetup.js';
import {
  initControllerDisconnectModal,
  showControllerDisconnectModal,
  hideControllerDisconnectModal,
  isDisconnectModalOpen,
} from '../src/ui/controllerDisconnectModal.js';

function makePad(index, pressedIdxOrList = -1, id = `Mock Pad ${index}`, axes = [0, 0, 0, 0]) {
  const pressedList = Array.isArray(pressedIdxOrList)
    ? pressedIdxOrList
    : (pressedIdxOrList >= 0 ? [pressedIdxOrList] : []);
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: pressedList.includes(i),
    value: pressedList.includes(i) ? 1 : 0,
  }));
  return {
    index,
    id,
    connected: true,
    mapping: 'standard',
    axes: [...axes],
    buttons,
  };
}

function makeMockDom() {
  const elementsById = new Map();

  function registerId(el, idVal) {
    if (idVal) elementsById.set(idVal, el);
  }

  function makeClassList(el) {
    const classes = new Set();
    return {
      _set: classes,
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (n) => classes.has(n),
      toggle: (n) => (classes.has(n) ? (classes.delete(n), false) : (classes.add(n), true)),
    };
  }

  function createNode(tagName = 'div') {
    const listeners = new Map();
    const attrs = new Map();
    const children = [];
    let _id = '';
    let _innerHTML = '';
    let _textContent = '';

    const el = {
      tagName: String(tagName).toUpperCase(),
      style: { display: '' },
      dataset: {},
      children,
      disabled: false,
      title: '',
      value: '',
      offsetWidth: 0,
      parentNode: null,
      get firstElementChild() { return children[0] || null; },
      get className() { return Array.from(el.classList._set).join(' '); },
      set className(val) {
        el.classList._set.clear();
        String(val || '').split(/\s+/).filter(Boolean).forEach((c) => el.classList._set.add(c));
      },
      get id() { return _id; },
      set id(val) {
        _id = String(val || '');
        if (_id) registerId(el, _id);
      },
      get textContent() {
        if (children.length === 0) return _textContent;
        return _textContent + children.map((c) => c.textContent || '').join('');
      },
      set textContent(val) {
        _textContent = String(val ?? '');
        children.length = 0;
      },
      get innerHTML() {
        if (_innerHTML && children.length === 0) return _innerHTML;
        return _innerHTML + children.map((c) => c.outerHTML || c.innerHTML || c.textContent || '').join('');
      },
      set innerHTML(html) {
        _innerHTML = String(html ?? '');
        _textContent = _innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        children.length = 0;
        const tagRegex = /<([a-zA-Z0-9]+)([^>]*)>/g;
        let m;
        while ((m = tagRegex.exec(_innerHTML)) !== null) {
          const child = createNode(m[1]);
          const attrText = m[2] || '';
          const idMatch = /\bid=["']([^"']+)["']/.exec(attrText);
          if (idMatch) child.id = idMatch[1];
          const dataRegex = /data-([a-zA-Z0-9-]+)=["']([^"']+)["']/g;
          let dm;
          while ((dm = dataRegex.exec(attrText)) !== null) {
            const camel = dm[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
            child.dataset[camel] = dm[2];
            child._attrs.set(`data-${dm[1]}`, dm[2]);
          }
          const classMatch = /\bclass=["']([^"']+)["']/.exec(attrText);
          if (classMatch) {
            classMatch[1].split(/\s+/).filter(Boolean).forEach((c) => child.classList.add(c));
          }
          children.push(child);
        }
      },
      _attrs: attrs,
      appendChild(child) {
        if (!child) return child;
        child.parentNode = el;
        children.push(child);
        return child;
      },
      removeChild(child) {
        const idx = children.indexOf(child);
        if (idx >= 0) children.splice(idx, 1);
        return child;
      },
      contains(target) {
        if (target === el) return true;
        return children.some((c) => c === target || c.contains?.(target));
      },
      append(...items) {
        for (const item of items) {
          if (item && typeof item === 'object') el.appendChild(item);
        }
      },
      remove() {
        if (el.parentNode && Array.isArray(el.parentNode.children)) {
          const idx = el.parentNode.children.indexOf(el);
          if (idx >= 0) el.parentNode.children.splice(idx, 1);
        }
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const list = listeners.get(type);
        if (!list) return;
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      },
      click() {
        if (el.disabled) return;
        if (typeof el.onclick === 'function') el.onclick({ stopPropagation: () => {} });
        const list = listeners.get('click') || [];
        for (const fn of list) fn({ stopPropagation: () => {}, target: el });
      },
      focus() {},
      closest() { return null; },
      querySelector(sel) {
        return el.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const results = [];
        const attrMatch = /^\[([a-zA-Z0-9-]+)=["']([^"']+)["']\]$/.exec(sel);
        const classMatch = /^(?::scope\s*>\s*)?\.([a-zA-Z0-9_-]+)$/.exec(sel);
        const directOnly = /^:scope\s*>/.test(sel);
        const visit = (node) => {
          for (const ch of node.children) {
            if (attrMatch) {
              const key = attrMatch[1];
              const camel = key.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
              if (ch._attrs?.get(key) === attrMatch[2] || ch.dataset?.[camel] === attrMatch[2]) {
                results.push(ch);
              }
            } else if (classMatch) {
              if (ch.classList?.contains(classMatch[1])) results.push(ch);
            }
            if (!directOnly) visit(ch);
          }
        };
        visit(el);
        return results;
      },
    };
    el.classList = makeClassList(el);
    return el;
  }

  const head = createNode('head');
  const body = createNode('body');
  const documentMock = {
    head,
    body,
    pointerLockElement: null,
    createElement: (tag) => createNode(tag),
    getElementById: (id) => elementsById.get(id) || null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  return { document: documentMock, elementsById, body };
}

function installTestEnv(initialPads = []) {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevNavigator = globalThis.navigator;
  const prevSetInterval = globalThis.setInterval;
  const prevClearInterval = globalThis.clearInterval;
  const prevRAF = globalThis.requestAnimationFrame;

  const dom = makeMockDom();
  const windowListeners = new Map();
  let pads = initialPads;
  const intervals = new Map();
  let nextIntervalId = 1;

  const windowMock = {
    location: { search: '', href: 'http://localhost/' },
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = windowListeners.get(type);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
    dispatchEvent(evt) {
      const list = windowListeners.get(evt.type) || [];
      for (const fn of [...list]) fn(evt);
    },
  };

  globalThis.window = windowMock;
  globalThis.document = dom.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => pads },
    configurable: true,
  });
  globalThis.setInterval = (fn) => {
    const id = nextIntervalId++;
    intervals.set(id, fn);
    return id;
  };
  globalThis.clearInterval = (id) => {
    intervals.delete(id);
  };
  globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };

  return {
    dom,
    windowMock,
    setPads(next) { pads = next; },
    runIntervals() {
      for (const fn of [...intervals.values()]) fn();
    },
    dispatchKey(code, extra = {}) {
      const evt = {
        type: 'keydown',
        code,
        repeat: false,
        shiftKey: false,
        target: null,
        preventDefault() {},
        ...extra,
      };
      for (const fn of [...(windowListeners.get('keydown') || [])]) fn(evt);
    },
    dispatchKeyUp(code) {
      const evt = { type: 'keyup', code, target: null };
      for (const fn of [...(windowListeners.get('keyup') || [])]) fn(evt);
    },
    restore() {
      stopSetupGamepadPolling();
      hideControllerDisconnectModal();
      hideControllerAssignment();
      cancelMatchCountdown();
      setExplicitDeviceMappings(null);
      clearGameplayInputQueues();
      menuState.rootEl = null;
      menuState.titleScreenEl = null;
      menuState.controllerAssignmentEl = null;
      menuState.lobbyHostPadIndex = null;
      if (prevNavigator === undefined) delete globalThis.navigator;
      else Object.defineProperty(globalThis, 'navigator', { value: prevNavigator, configurable: true });
      if (prevWindow === undefined) delete globalThis.window;
      else globalThis.window = prevWindow;
      if (prevDocument === undefined) delete globalThis.document;
      else globalThis.document = prevDocument;
      globalThis.setInterval = prevSetInterval;
      globalThis.clearInterval = prevClearInterval;
      if (prevRAF === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = prevRAF;
    },
  };
}

test('Suite 1: Dormant USB pad wake-press registers on first poll while reset() hold-suppression stays intact', () => {
  const prevNavigator = globalThis.navigator;
  let pads = [makePad(0, 0)]; // Pad 0 visible and holding A at reset(); Pad 1 dormant (absent)
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => pads },
    configurable: true,
  });

  try {
    const tracker = createMenuPadTracker();
    tracker.reset();

    // Poll 1: Pad 0 still holding A; Pad 1 wakes up with A pressed
    const pad0Held = makePad(0, 0);
    const pad1Woken = makePad(1, 0);
    tracker.update([pad0Held, pad1Woken]);
    assert.equal(tracker.pressed(pad0Held) & MENU_PAD.a, 0, 'Pad 0 held across reset() stays suppressed');
    assert.ok((tracker.pressed(pad1Woken) & MENU_PAD.a) !== 0, 'Dormant Pad 1 wake-press registers on Poll 1');

    // Poll 2: Pad 1 still holding A must not re-fire
    tracker.update([pad0Held, pad1Woken]);
    assert.equal(tracker.pressed(pad1Woken), 0, 'Held button on woken pad must not repeat');

    // Release Pad 0 then press A -> fires cleanly
    const pad0Released = makePad(0, -1);
    tracker.update([pad0Released, pad1Woken]);
    const pad0Repressed = makePad(0, 0);
    tracker.update([pad0Repressed, pad1Woken]);
    assert.ok((tracker.pressed(pad0Repressed) & MENU_PAD.a) !== 0, 'Pad 0 fires after release and re-press');

    // Disconnect Pad 1 then reconnect with X pressed -> fires X immediately
    tracker.update([pad0Released]);
    const pad1ReconnectedX = makePad(1, 2);
    tracker.update([pad0Released, pad1ReconnectedX]);
    assert.ok((tracker.pressed(pad1ReconnectedX) & MENU_PAD.x) !== 0, 'Reconnected pad registers X immediately');

    // Screen-transition reset() while Pad 1 is visible and holding A still suppresses A until release
    pads = [pad0Released, pad1Woken];
    tracker.reset();
    tracker.update([pad0Released, pad1Woken]);
    assert.equal(tracker.pressed(pad1Woken) & MENU_PAD.a, 0, 'Visible pad holding A across reset() stays suppressed');
  } finally {
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', { value: prevNavigator, configurable: true });
  }
});

test('Suite 2: Walk-up bench join (A/X/Y/Start), auto-promote 1-poll guard, Home/Away tags/swap, and Page 1 AI join', () => {
  const env = installTestEnv([]);
  let proceedCount = 0;
  let quickStartCount = 0;

  try {
    const rootEl = env.dom.document.createElement('div');
    rootEl.id = 'main-menu-root';
    env.dom.body.appendChild(rootEl);
    menuState.rootEl = rootEl;
    menuState.titleScreenEl = env.dom.document.createElement('div');
    menuState.titleScreenEl.style.display = 'flex';

    buildControllerAssignmentScreen(rootEl, {
      onProceed: () => { proceedCount++; },
      onQuickStart: () => { quickStartCount++; },
      onBack: () => {},
    });

    // 1. Open with 0 awake pads -> Keyboard 1 seated on Team 1; waking Pad 0 with A auto-promotes without leaving screen
    showControllerAssignment('2v2');
    assert.equal(menuState.titleScreenEl.style.display, 'none', 'showControllerAssignment hides titleScreenEl');
    const tracker = createMenuPadTracker();
    tracker.reset();

    const pad0WakeA = makePad(0, 0);
    env.setPads([pad0WakeA]);
    tracker.update([pad0WakeA]);
    pollAssignmentGamepads([pad0WakeA], tracker);
    assert.equal(proceedCount, 0, 'Auto-promoted wake press must not immediately call proceedToSetup');
    assert.equal(quickStartCount, 0, 'Auto-promoted wake press must not immediately call quickStartMatch');

    // 2. Seat Pad 0 on Team 1 and Pad 1 on Team 2 in 2v2, then wake Pad 2 & Pad 3 onto the Bench
    env.setPads([makePad(0), makePad(1)]);
    showControllerAssignment('2v2');
    const tracker2 = createMenuPadTracker();
    tracker2.reset();
    env.setPads([makePad(0), makePad(1), makePad(2), makePad(3)]);
    tracker2.update([makePad(0), makePad(1), makePad(2), makePad(3)]);
    pollAssignmentGamepads([makePad(0), makePad(1), makePad(2), makePad(3)], tracker2);

    // Check Home/Away tags, P1-P4 ownership badges, and "PRESS A / ANY BUTTON TO JOIN" copy
    const benchHtml = env.dom.document.getElementById('bench-slots-container').innerHTML;
    const team1Html = env.dom.document.getElementById('team1-slots-container').innerHTML;
    const team2Html = env.dom.document.getElementById('team2-slots-container').innerHTML;
    assert.ok(benchHtml.includes('PRESS A / ANY BUTTON TO JOIN'), 'Bench cards show Press A / Any Button to Join');
    assert.ok(team1Html.includes('HOME (SOUTH)') && team1Html.includes('P1'), 'Team 1 shows P1 and HOME (SOUTH)');
    assert.ok(team2Html.includes('AWAY (NORTH)') && team2Html.includes('P2'), 'Team 2 shows P2 and AWAY (NORTH)');

    // Non-host benched Pad 2 presses X (2) -> joins open slot on Team 1 (P3)
    const p2X = makePad(2, 2);
    tracker2.update([makePad(0), makePad(1), p2X, makePad(3)]);
    pollAssignmentGamepads([makePad(0), makePad(1), p2X, makePad(3)], tracker2);
    assert.ok(env.dom.document.getElementById('team1-slots-container').innerHTML.includes('Gamepad 3') ||
      env.dom.document.getElementById('team1-slots-container').innerHTML.includes('Mock Pad 2') ||
      env.dom.document.getElementById('team1-slots-container').innerHTML.includes('Pad 3'),
      'Benched Pad 2 pressing X joins open Team 1 seat');

    // Non-host benched Pad 3 presses Start (9) -> joins open slot on Team 2 (P4) without launching Quick Play
    const p3Start = makePad(3, 9);
    tracker2.update([makePad(0), makePad(1), makePad(2), p3Start]);
    pollAssignmentGamepads([makePad(0), makePad(1), makePad(2), p3Start], tracker2);
    assert.equal(quickStartCount, 0, 'Benched Pad 3 pressing Start joins open seat instead of launching');
    assert.ok(env.dom.document.getElementById('team2-slots-container').innerHTML.includes('Gamepad 4'),
      'Benched Pad 3 pressing Start joins open Team 2 seat');

    // Swap sides swaps Team 1 and Team 2
    swapSides();
    assert.ok(env.dom.document.getElementById('team1-slots-container').innerHTML.includes('Gamepad 2'),
      'swapSides moves Pad 1 (Gamepad 2) from Team 2 to Team 1');
    assert.ok(env.dom.document.getElementById('team2-slots-container').innerHTML.includes('Gamepad 1'),
      'swapSides moves Pad 0 (Gamepad 1) from Team 1 to Team 2');

    // 3. Keyboard-in-Team1 Host guard + Page 1 open AI slot join
    hideControllerAssignment();
    buildPlayerSetupScreen(rootEl, {}, { showTitleScreen: () => {}, hidePlayerSetup: () => {} });
    setCurrentSetupMode('match');
    setMatchFormat('1v1');
    setSetupPage(1);
    const cfgs = getPlayerConfigs();
    cfgs[0].type = 'human';
    cfgs[1].type = 'ai';
    setExplicitDeviceMappings({ 0: { type: 'gamepad', padIndex: 0, id: 'Mock Pad 0', name: 'Gamepad 1' } });
    setFocusedColumn(1);
    const setupEl = env.dom.document.getElementById('player-setup-screen');
    setupEl.style.display = 'flex';
    env.setPads([makePad(0), makePad(1)]);

    setMenuNavigationContext({ playerSetup });
    startMenuGamepadPolling();
    // Poll 1: unassigned Pad 1 presses Y (3) on Page 1 -> claims AI P2 slot without touching P1
    env.setPads([makePad(0), makePad(1, 3)]);
    env.runIntervals();
    assert.equal(cfgs[1].type, 'human', 'Unassigned Pad 1 pressing Y on Page 1 converts AI P2 to human');
    assert.equal(getAssignedSlotForPad(1), 1, 'Pad 1 bound to slot 1');
    assert.equal(getAssignedSlotForPad(0), 0, 'Pad 0 remains bound to slot 0');
    assert.equal(getFocusedColumn(), 0, 'P1 focus returns cleanly to slot 0 after AI slot claimed');
  } finally {
    env.restore();
  }
});

test('Suite 3: Spare-pad hot-swap (p.id !== m.id), same-ID port swap, and reassignSlotToPad', () => {
  const env = installTestEnv([]);
  try {
    clearGameplayInputQueues();
    const cam = new THREE.PerspectiveCamera();

    // 1. Same-ID port swap: Pad-B moves from index 1 to index 3
    const padA = makePad(0, -1, 'Pad-A', [0, 0, 0, 0]);
    const padBAt3 = makePad(3, -1, 'Pad-B', [0.85, 0, 0, 0]);
    env.setPads([padA, padBAt3]);
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: 'Pad-A', name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, id: 'Pad-B', name: 'Gamepad 2' },
    });
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.equal(getExplicitDeviceMappings()[1].padIndex, 3, 'Same-ID pad reclaims shifted padIndex 3');
    assert.ok(getInputSlot(1).moveX > 0.7, 'Reclaimed pad drives slot 1 stick');

    // 2. Spare-pad hot-swap at same padIndex when p.id !== m.id (held button latched on Frame 1)
    const padCAt1 = makePad(1, 0, 'Pad-C', [-0.9, 0, 0, 0]);
    env.setPads([padA, padCAt1]);
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: 'Pad-A', name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, id: 'Pad-B', name: 'Gamepad 2' },
    });
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.equal(getExplicitDeviceMappings()[1].id, 'Pad-C', 'Spare pad updates mapping hardware id');
    assert.equal(getInputSlot(1).jumpQueued, false, 'Held button at hot-swap time is latched on Frame 1');
    assert.ok(getInputSlot(1).moveX < -0.7, 'Spare pad drives slot 1 stick immediately');

    // 3. Explicit reassignSlotToPad while Pad-B is missing and Pad-D is unclaimed at index 2
    const padDAt2 = makePad(2, 0, 'Pad-D', [0.75, 0, 0, 0]);
    env.setPads([padA, padDAt2]);
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: 'Pad-A', name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, id: 'Pad-B', name: 'Gamepad 2' },
    });
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.equal(getUnclaimedConnectedPads().length, 1);
    assert.equal(getUnclaimedConnectedPads()[0].index, 2);

    reassignSlotToPad(1, 2);
    assert.equal(getExplicitDeviceMappings()[1].padIndex, 2);
    assert.equal(getExplicitDeviceMappings()[1].id, 'Pad-D');
    assert.equal(getExplicitDeviceMappings()[0].padIndex, 0, 'Slot 0 stays on Pad-A');
    assert.equal(getUnclaimedConnectedPads().length, 0, 'Reassigned pad is no longer unclaimed');
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.equal(getInputSlot(1).jumpQueued, false, 'Held button at reassignSlotToPad time stays latched on Frame 1');
    assert.ok(getInputSlot(1).moveX > 0.6, 'Reassigned Pad-D drives slot 1 stick');

    // 4. Validation and no-steal in reassignSlotToPad
    env.setPads([padA]);
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: 'Pad-A', name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, id: 'Pad-B', name: 'Gamepad 2' },
    });
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.equal(reassignSlotToPad(1, 99), false, 'Rejects disconnected padIndex 99');
    assert.equal(reassignSlotToPad(1, -1), false, 'Rejects negative padIndex');
    assert.equal(reassignSlotToPad(1, 0), false, 'Refuses stealing pad 0 claimed by slot 0');
    assert.equal(getExplicitDeviceMappings()[0].padIndex, 0, 'Slot 0 mapping remains intact');
    assert.equal(getExplicitDeviceMappings()[1].padIndex, 1, 'Slot 1 mapping remains untouched on failed reassign');

    // 5. No-duplicate validation in reassignSlotToKeyboard
    setExplicitDeviceMappings({
      0: { type: 'keyboard', keyId: 'kb1', name: 'Keyboard 1 (WASD)' },
      1: { type: 'gamepad', padIndex: 1, id: 'Pad-B', name: 'Gamepad 2' },
      2: { type: 'gamepad', padIndex: 0, id: 'Pad-A', name: 'Gamepad 1' },
      3: { type: 'keyboard', keyId: 'kb2', name: 'Secondary Keyboard (IJKL)' },
    });
    assert.equal(reassignSlotToKeyboard(1, 'kb1'), false, 'Rejects duplicate occupied kb1');
    assert.equal(reassignSlotToKeyboard(1, null), false, 'Rejects null fallback when both kb1 and kb2 are occupied');
    assert.equal(getExplicitDeviceMappings()[1].type, 'gamepad', 'Slot 1 remains gamepad on rejected keyboard reassign');
    assert.equal(getExplicitDeviceMappings()[1].padIndex, 1);
  } finally {
    env.restore();
  }
});

test('Suite 4: No silent keyboard fallback on mid-match mapped gamepad disconnect', () => {
  const env = installTestEnv([]);
  try {
    initInputRouter(env.windowMock);
    clearGameplayInputQueues();
    const cam = new THREE.PerspectiveCamera();
    const padA = makePad(0, -1, 'Pad-A');
    env.setPads([padA]); // Pad-B disconnected

    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: 'Pad-A', name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, id: 'Pad-B', name: 'Gamepad 2' },
    });

    // Simulate player pressing IJKL + Enter while Pad-B is disconnected
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    env.dispatchKey('KeyI');
    env.dispatchKey('Enter');
    sampleAllInputs([cam, cam], 2, 'match', [], true);

    assert.equal(getInputSlot(1).moveZ, 0, 'Disconnected gamepad slot must not silently read IJKL movement');
    assert.equal(getInputSlot(1).jumpQueued, false, 'Disconnected gamepad slot must not silently read Enter jump');
    assert.equal(getControlsSnapshot()[1].available, false, 'Controls snapshot flags disconnected slot unavailable');
    assert.equal(getControlsSnapshot()[1].device, 'gamepad', 'Controls snapshot keeps gamepad device type');
    assert.deepEqual([...getDisconnectedMappedSlots()], [1], 'Only slot 1 flagged as disconnected');

    // Explicit reassign to kb2 clears disconnect and enables IJKL / Enter
    env.dispatchKeyUp('KeyI');
    env.dispatchKeyUp('Enter');
    reassignSlotToKeyboard(1, 'kb2');
    assert.equal(getExplicitDeviceMappings()[1].type, 'keyboard');
    assert.equal(getExplicitDeviceMappings()[1].keyId, 'kb2');
    assert.equal(getDisconnectedMappedSlots().length, 0, 'Disconnect cleared after explicit keyboard reassign');

    env.dispatchKey('KeyI');
    env.dispatchKey('Enter');
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.ok(getInputSlot(1).moveZ > 0.5, 'Reassigned kb2 drives slot 1 movement');
    assert.equal(getInputSlot(1).jumpQueued, true, 'Reassigned kb2 drives slot 1 jump');
  } finally {
    env.restore();
  }
});

test('Suite 5: Mid-match disconnect modal actions, UI blocking, and unclaimed pad hot-swap', () => {
  const env = installTestEnv([]);
  let resumed = 0;
  let switchedToBotSlot = -1;
  let returnedToSetup = 0;

  try {
    clearGameplayInputQueues();
    const cam = new THREE.PerspectiveCamera();
    const padA = makePad(0, -1, 'Pad-A');
    const padC = makePad(2, -1, 'Pad-C');
    env.setPads([padA, padC]);

    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: 'Pad-A', name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, id: 'Pad-B', name: 'Gamepad 2' },
    });
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.deepEqual([...getDisconnectedMappedSlots()], [1]);

    initControllerDisconnectModal({
      onResume: () => { resumed++; },
      onSwitchToBot: (slotIdx) => {
        switchedToBotSlot = slotIdx;
        delete getExplicitDeviceMappings()[slotIdx];
      },
      onReturnToSetup: () => { returnedToSetup++; },
    });

    showControllerDisconnectModal([1]);
    assert.equal(isDisconnectModalOpen(), true);

    // While modal is open, sampleAllInputs blocks gameplay inputs and latches held buttons
    const padAWithJump = makePad(0, 0, 'Pad-A', [0.9, 0, 0, 0]);
    env.setPads([padAWithJump, padC]);
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.equal(getInputSlot(0).moveX, 0, 'Open disconnect modal zeroes gameplay stick');
    assert.equal(getInputSlot(0).jumpQueued, false, 'Open disconnect modal blocks jump queue');

    // Action 1: Original Pad-B reconnects -> Resume button appears, auto-focuses, and Enter resumes with gamepad preserved
    const padB = makePad(1, -1, 'Pad-B');
    env.setPads([padA, padB, padC]);
    env.runIntervals();
    const resumeBtn = env.dom.document.getElementById('disconnect-btn-resume');
    assert.ok(resumeBtn, 'Reconnect surfaces CONTROLLER RECONNECTED: RESUME MATCH button');
    assert.ok(resumeBtn.style.outline.includes('#00e5ff'), 'Reconnect auto-focuses disconnect-btn-resume');
    env.dispatchKey('Enter');
    assert.equal(resumed, 1, 'Pressing Enter immediately resumes after reconnect');
    assert.equal(getExplicitDeviceMappings()[1].type, 'gamepad', 'Reconnect Enter preserves gamepad mapping');
    assert.equal(isDisconnectModalOpen(), false);

    // Action 1b: Reconnect and press Pad A on reconnected Pad-B -> resumes with gamepad preserved
    env.setPads([padA, padC]);
    refreshDisconnectRouting();
    showControllerDisconnectModal([1]);
    env.setPads([padA, padB, padC]);
    env.runIntervals();
    env.setPads([padA, makePad(1, 0, 'Pad-B'), padC]);
    env.runIntervals();
    assert.equal(resumed, 2, 'Pressing Pad A immediately resumes after reconnect');
    assert.equal(getExplicitDeviceMappings()[1].type, 'gamepad', 'Reconnect Pad A preserves gamepad mapping');
    assert.equal(isDisconnectModalOpen(), false);

    // Action 2: Unclaimed Pad-C presses A in 50ms poll -> hot-swaps into slot 1 and resumes
    env.setPads([padA, padC]);
    refreshDisconnectRouting();
    showControllerDisconnectModal([1]);
    env.setPads([padA, makePad(2, 0, 'Pad-C')]);
    env.runIntervals();
    assert.equal(getExplicitDeviceMappings()[1].padIndex, 2, 'Pressing A on unclaimed Pad-C claims slot 1');
    assert.equal(resumed, 3);
    assert.equal(isDisconnectModalOpen(), false);

    // Action 3: Switch to Keyboard/Mouse
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: 'Pad-A', name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, id: 'Pad-B', name: 'Gamepad 2' },
    });
    env.setPads([padA]);
    refreshDisconnectRouting();
    showControllerDisconnectModal([1]);
    const kbBtn = env.dom.document.getElementById('disconnect-btn-kb2');
    assert.ok(kbBtn, 'Keyboard 2 switch option available');
    kbBtn.click();
    assert.equal(getExplicitDeviceMappings()[1].type, 'keyboard');
    assert.equal(resumed, 4);
    assert.equal(isDisconnectModalOpen(), false);

    // Action 4: Switch to AI Bot
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: 'Pad-A', name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, id: 'Pad-B', name: 'Gamepad 2' },
    });
    env.setPads([padA]);
    refreshDisconnectRouting();
    showControllerDisconnectModal([1]);
    env.dom.document.getElementById('disconnect-btn-ai').click();
    assert.equal(switchedToBotSlot, 1);
    assert.equal(resumed, 5);
    assert.equal(isDisconnectModalOpen(), false);

    // Action 5: Return to Setup
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: 'Pad-A', name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, id: 'Pad-B', name: 'Gamepad 2' },
    });
    env.setPads([padA]);
    refreshDisconnectRouting();
    showControllerDisconnectModal([1]);
    env.dom.document.getElementById('disconnect-btn-setup').click();
    assert.equal(returnedToSetup, 1);
    assert.equal(isDisconnectModalOpen(), false);
  } finally {
    env.restore();
  }
});

test('Suite 6: P2 to P4 keyboard/mouse Ready click unblock and device-accurate hints', () => {
  const env = installTestEnv([]);
  try {
    const rootEl = env.dom.document.createElement('div');
    rootEl.id = 'main-menu-root';
    env.dom.body.appendChild(rootEl);
    menuState.rootEl = rootEl;

    buildPlayerSetupScreen(rootEl, {}, { showTitleScreen: () => {}, hidePlayerSetup: () => {} });
    setCurrentSetupMode('match');
    setMatchFormat('2v2');
    setSetupPage(2);

    const cfgs = getPlayerConfigs();
    for (let i = 0; i < 4; i++) cfgs[i].type = 'human';
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, name: 'Gamepad 1' },
      1: { type: 'keyboard', keyId: 'kb1', name: 'Keyboard 1 (WASD)' },
      2: { type: 'keyboard', keyId: 'kb2', name: 'Secondary Keyboard (IJKL)' },
    });

    const readyState = getPlayerReadyState();
    readyState.fill(false);
    updateReadyUI();

    const btn1 = env.dom.document.getElementById('btn-ready-p1');
    const btn2 = env.dom.document.getElementById('btn-ready-p2');
    const btn3 = env.dom.document.getElementById('btn-ready-p3');
    const btn4 = env.dom.document.getElementById('btn-ready-p4');
    const strip = env.dom.document.getElementById('match-rules-ready-strip');

    assert.ok(btn1.innerHTML.includes('□/X READY'), 'P1 gamepad shows pad ready label');
    assert.ok(btn2.innerHTML.includes('SPACE / CLICK READY'), 'P2 kb1 shows SPACE / CLICK READY');
    assert.ok(btn3.innerHTML.includes('ENTER / CLICK READY'), 'P3 kb2 shows ENTER / CLICK READY');
    assert.ok(btn4.innerHTML.includes('CLICK READY') && !btn4.innerHTML.includes('ENTER /'), 'P4 unmapped human shows CLICK READY when kb1 and kb2 are claimed');
    assert.ok(!btn2.innerHTML.includes('□/X READY') && !btn3.innerHTML.includes('□/X READY'), 'Keyboard slots never show gamepad prompt');
    assert.ok(strip.innerHTML.includes('PRESS SPACE OR CLICK') && strip.innerHTML.includes('PRESS ENTER OR CLICK') && strip.innerHTML.includes('CLICK TO READY'), 'Ready strip shows accurate prompts without key collisions');

    // Click P2, P3, P4 Ready buttons -> all toggle true (no toast block)
    btn2.click();
    btn3.click();
    btn4.click();
    assert.equal(readyState[1], true, 'P2 keyboard slot Ready click succeeds');
    assert.equal(readyState[2], true, 'P3 keyboard slot Ready click succeeds');
    assert.equal(readyState[3], true, 'P4 unmapped keyboard slot Ready click succeeds');
    cancelMatchCountdown();

    // When P1 holds kb1 and P3 is unmapped human, P3 advertises ENTER / CLICK READY (never SPACE)
    readyState.fill(false);
    setExplicitDeviceMappings({
      0: { type: 'keyboard', keyId: 'kb1', name: 'Keyboard 1 (WASD)' },
      1: { type: 'gamepad', padIndex: 1, name: 'Gamepad 2' },
    });
    cfgs[0].type = 'human';
    cfgs[1].type = 'human';
    cfgs[2].type = 'human';
    cfgs[3].type = 'ai';
    updateReadyUI();
    assert.ok(btn3.innerHTML.includes('ENTER / CLICK READY'), 'Unmapped P3 uses free kb2 ENTER when P1 holds kb1');
    assert.ok(!btn3.innerHTML.includes('SPACE / CLICK READY'), 'Unmapped P3 must not advertise kb1 SPACE owned by P1');

    // Gamepad slot on P2 still blocks mouse Ready click and Page 2 keyboard keys never toggle Gamepad-owned slots
    for (let i = 0; i < 4; i++) cfgs[i].type = 'human';
    readyState.fill(false);
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, name: 'Gamepad 2' },
      2: { type: 'keyboard', keyId: 'kb1', name: 'Keyboard 1 (WASD)' },
    });
    updateReadyUI();
    btn2.click();
    assert.equal(readyState[1], false, 'P2 gamepad slot still requires own gamepad button');

    const setupEl = env.dom.document.getElementById('player-setup-screen');
    setupEl.style.display = 'flex';
    setMenuNavigationContext({ playerSetup });
    startMenuGamepadPolling();

    // P2=Gamepad1, P3=kb1, P4=unmapped -> Enter must target unmapped P4 and never toggle Gamepad P2
    env.dispatchKey('Enter');
    assert.equal(readyState[1], false, 'Enter must never toggle Gamepad-owned P2 Ready');
    assert.equal(readyState[3], true, 'Enter targets unmapped human P4');

    // Both P1 and P2 on Gamepads in 1v1 -> Space, Enter, KeyX, KeyR never toggle either Gamepad slot
    setMatchFormat('1v1');
    readyState.fill(false);
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, name: 'Gamepad 2' },
    });
    updateReadyUI();
    env.dispatchKey('Space');
    env.dispatchKey('Enter');
    env.dispatchKey('KeyX');
    env.dispatchKey('KeyR');
    assert.equal(readyState[0], false, 'Keyboard keys must never toggle Gamepad-owned P1 Ready');
    assert.equal(readyState[1], false, 'Keyboard keys must never toggle Gamepad-owned P2 Ready');

    // Restore 2v2 full explicit mappings: Space (kb1 -> P3) and Enter (kb2 -> P4) toggle only their own slot
    setMatchFormat('2v2');
    readyState.fill(false);
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, name: 'Gamepad 2' },
      2: { type: 'keyboard', keyId: 'kb1', name: 'Keyboard 1 (WASD)' },
      3: { type: 'keyboard', keyId: 'kb2', name: 'Secondary Keyboard (IJKL)' },
    });
    updateReadyUI();
    env.dispatchKey('Space');
    assert.equal(readyState[2], true, 'Space toggles kb1-owned P3 Ready');
    assert.equal(readyState[3], false, 'Space does not toggle kb2-owned P4');
    env.dispatchKey('Enter');
    assert.equal(readyState[3], true, 'Enter toggles kb2-owned P4 Ready');
  } finally {
    env.restore();
  }
});

test('Suite 7: Solo Away Host (team2[0]) retains Player Setup Page 1 and Page 2 controls while guest P2 stays locked when P1 is human', () => {
  const env = installTestEnv([makePad(0)]);
  let proceedArgs = null;

  try {
    const rootEl = env.dom.document.createElement('div');
    rootEl.id = 'main-menu-root';
    env.dom.body.appendChild(rootEl);
    menuState.rootEl = rootEl;
    menuState.titleScreenEl = env.dom.document.createElement('div');

    buildControllerAssignmentScreen(rootEl, {
      onProceed: (info) => { proceedArgs = info; },
      onQuickStart: () => {},
      onBack: () => {},
    });
    buildPlayerSetupScreen(rootEl, {}, { showTitleScreen: () => {}, hidePlayerSetup: () => {} });

    showControllerAssignment('1v1');
    swapSides();
    proceedToSetup();
    assert.ok(proceedArgs, 'Solo Away Host proceeds from Controller Assignment');

    setCurrentSetupMode('match');
    setMatchFormat('1v1');
    applyControllerAssignments(proceedArgs.assignments, 'match');
    setSetupPage(1);
    const setupEl = env.dom.document.getElementById('player-setup-screen');
    setupEl.style.display = 'flex';
    window._updateSetupPage();

    const cfgs = getPlayerConfigs();
    const ready = getPlayerReadyState();
    assert.equal(cfgs[0].type, 'ai', 'P1 is AI');
    assert.equal(cfgs[1].type, 'human', 'P2 is Solo Away Host human');

    setMenuNavigationContext({ playerSetup });
    startMenuGamepadPolling();

    // Page 1: Solo Away Host presses LB -> cycles focus to AI P1 and back to P2
    env.setPads([makePad(0, 4)]);
    env.runIntervals();
    assert.equal(getFocusedColumn(), 0, 'Solo Away Host LB cycles to AI P1 column');
    env.setPads([makePad(0)]);
    env.runIntervals();
    env.setPads([makePad(0, 5)]);
    env.runIntervals();
    assert.equal(getFocusedColumn(), 1, 'Solo Away Host RB cycles back to P2 column');
    env.setPads([makePad(0)]);
    env.runIntervals();

    // Page 1: Solo Away Host presses Start (9) -> advances to Page 2
    env.setPads([makePad(0, 9)]);
    env.runIntervals();
    assert.equal(getSetupPage(), 2, 'Solo Away Host Start advances Page 1 to Page 2');
    env.setPads([makePad(0)]);
    env.runIntervals();

    // Page 2: Solo Away Host presses D-Pad Right (15) -> changes Match Ball
    const ballBefore = getSelectedMatchBall();
    env.setPads([makePad(0, 15)]);
    env.runIntervals();
    assert.notEqual(getSelectedMatchBall(), ballBefore, 'Solo Away Host cycles Match Ball on Page 2');
    env.setPads([makePad(0)]);
    env.runIntervals();

    // Page 2: Solo Away Host presses X (2) -> toggles own P2 Ready
    ready[1] = false;
    env.setPads([makePad(0, 2)]);
    env.runIntervals();
    assert.equal(ready[1], true, 'Solo Away Host X toggles P2 Ready');
    cancelMatchCountdown();
    env.setPads([makePad(0)]);
    env.runIntervals();

    // Page 2: Solo Away Host presses B (1) -> returns to Page 1
    env.setPads([makePad(0, 1)]);
    env.runIntervals();
    assert.equal(getSetupPage(), 1, 'Solo Away Host B returns from Page 2 to Page 1');
    env.setPads([makePad(0)]);
    env.runIntervals();

    // Guest P2 when P1 IS human remains strictly blocked
    cfgs[0].type = 'human';
    cfgs[1].type = 'human';
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, name: 'Gamepad 2' },
    });
    env.setPads([makePad(0), makePad(1, 9)]);
    env.runIntervals();
    assert.equal(getSetupPage(), 1, 'Guest P2 pressing Start on Page 1 stays blocked when P1 is human');
  } finally {
    env.restore();
  }
});

test('Suite 8: Fresh Frame-1 disconnected gamepad and cross-match device transitions report accurate snapshot', async () => {
  const env = installTestEnv([]);
  try {
    const freshRouter = await import(`../src/input/inputRouter.js?fresh=${Date.now()}`);
    const cam = new THREE.PerspectiveCamera();

    // 1. Fresh module load: Pad 1 already disconnected on Frame 1
    freshRouter.setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: 'Pad-A', name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, id: 'Pad-B', name: 'Gamepad 2' },
    });
    env.setPads([makePad(0, -1, 'Pad-A')]);
    freshRouter.sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.equal(freshRouter.getControlsSnapshot()[1].device, 'gamepad', 'Fresh Frame-1 disconnect reports gamepad device');
    assert.equal(freshRouter.getControlsSnapshot()[1].available, false, 'Fresh Frame-1 disconnect reports unavailable');

    // 2. Cross-match switch: gamepad (disconnected) -> keyboard -> gamepad (disconnected)
    freshRouter.setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: 'Pad-A', name: 'Gamepad 1' },
      1: { type: 'keyboard', keyId: 'kb2', name: 'Secondary Keyboard (IJKL)' },
    });
    freshRouter.sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.equal(freshRouter.getControlsSnapshot()[1].device, 'keyboard', 'Switch to keyboard updates snapshot device immediately');
    assert.equal(freshRouter.getControlsSnapshot()[1].available, true, 'Keyboard slot reports available');

    freshRouter.setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: 'Pad-A', name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, id: 'Pad-B', name: 'Gamepad 2' },
    });
    freshRouter.sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.equal(freshRouter.getControlsSnapshot()[1].device, 'gamepad', 'Switch back to disconnected gamepad updates snapshot device immediately');
    assert.equal(freshRouter.getControlsSnapshot()[1].available, false, 'Disconnected gamepad reports unavailable');
  } finally {
    env.restore();
  }
});

test('Suite 9: Simultaneous [0, 1] disconnect with identical pad.id disambiguation and sequential recovery', async () => {
  const sameId = 'Xbox Wireless Controller (STANDARD GAMEPAD)';
  const pad0 = makePad(0, -1, sameId);
  const pad1 = makePad(1, -1, sameId);
  const env = installTestEnv([pad0, pad1]);
  let resumed = 0;

  try {
    const cam = new THREE.PerspectiveCamera();
    initInputRouter(env.windowMock);
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: sameId, name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 1, id: sameId, name: 'Gamepad 2' },
    });

    const modalMod = await import(`../src/ui/controllerDisconnectModal.js?suite9=${Date.now()}`);
    modalMod.initControllerDisconnectModal({
      onResume: () => { resumed++; },
      onSwitchToBot: () => {},
      onReturnToSetup: () => {},
    });

    // Disconnecting Pad 0 only flags slot [0] without confusing Pad 1 despite identical pad.id
    env.setPads([pad1]);
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.deepEqual([...getDisconnectedMappedSlots()], [0], 'Disconnecting Pad 0 only flags slot [0]');

    // Disconnecting both pads flags [0, 1]
    env.setPads([]);
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.deepEqual([...getDisconnectedMappedSlots()], [0, 1], 'Disconnecting both pads flags [0, 1]');

    modalMod.showControllerDisconnectModal([0, 1]);
    assert.equal(modalMod.isDisconnectModalOpen(), true);
    assert.equal(env.dom.document.getElementById('disconnect-slot-badge').textContent, 'P1 CONTROLLER DISCONNECTED');

    // Switching P1 to kb1 advances modal badge to P2 without closing
    env.dom.document.getElementById('disconnect-btn-kb1').click();
    assert.equal(modalMod.isDisconnectModalOpen(), true, 'Modal stays open while P2 remains disconnected');
    assert.equal(env.dom.document.getElementById('disconnect-slot-badge').textContent, 'P2 CONTROLLER DISCONNECTED');

    // Reconnecting Pad 1 surfaces resume button and resumes cleanly
    env.setPads([pad1]);
    refreshDisconnectRouting();
    env.runIntervals();
    const resumeBtn = env.dom.document.getElementById('disconnect-btn-resume');
    assert.ok(resumeBtn, 'Resume button appears once Pad 1 reconnects');
    resumeBtn.click();
    assert.equal(modalMod.isDisconnectModalOpen(), false, 'Modal closes on resume');
    assert.equal(resumed, 1, 'onResume fires after sequential recovery');
  } finally {
    env.restore();
  }
});

test('Regression Bug 5: Controller Assignment reconciles Pick Sides after disconnect/lobby edits and refreshes same-index hot-swap', () => {
  const pad0 = makePad(0, -1, 'Xbox Pad Alpha');
  const pad1 = makePad(1, -1, 'DualSense Beta');
  const pad2 = makePad(2, -1, 'Spare Pad Gamma');
  const env = installTestEnv([pad0, pad1]);

  try {
    const rootEl = env.dom.document.createElement('div');
    rootEl.id = 'main-menu-root';
    env.dom.body.appendChild(rootEl);
    menuState.rootEl = rootEl;
    menuState.titleScreenEl = env.dom.document.createElement('div');

    buildControllerAssignmentScreen(rootEl, { onProceed: () => {}, onQuickStart: () => {}, onBack: () => {} });
    buildPlayerSetupScreen(rootEl, {}, { showTitleScreen: () => {}, hidePlayerSetup: () => {} });

    // 1. Open assignment with Pad 0 & Pad 1, Quick Start to commit mappings
    showControllerAssignment('1v1');
    quickStartMatch();

    const t2 = env.dom.document.getElementById('team2-slots-container');
    const t1 = env.dom.document.getElementById('team1-slots-container');
    assert.equal(getExplicitDeviceMappings()[1].padIndex, 1);

    // 2. Simulate Disconnect Modal "Switch to Bot" on slot 1, then reopen Pick Sides
    clearDeviceMappingForSlot(1);
    getPlayerConfigs()[1].type = 'ai';
    showControllerAssignment('1v1', {}, { preserveExisting: true });
    assert.ok(t2.innerHTML.includes('AI ATHLETE (CPU BOT)'), 'Pick Sides shows AI Bot on P2 after Switch to Bot');
    assert.equal(t2.innerHTML.includes('PlayStation Controller'), false, 'Pick Sides removes stale P2 pad after Switch to Bot');

    // 3. Simulate Disconnect Modal "Assign Spare Pad 2" to slot 1 while Pad 1 unplugged, then reopen Pick Sides
    env.setPads([pad0, pad2]);
    getPlayerConfigs()[1].type = 'human';
    initInputRouter(env.windowMock);
    const cam = new THREE.PerspectiveCamera();
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.equal(reassignSlotToPad(1, 2), true);
    showControllerAssignment('1v1', {}, { preserveExisting: true });
    assert.ok(t2.innerHTML.includes('Gamepad 3'), 'Pick Sides seats Spare Pad 2 on P2');
    assert.equal(t2.innerHTML.includes('PlayStation Controller'), false, 'Pick Sides clears stale Pad 1 label');

    // 4. Simulate Page 1 lobby changes (claimLobbySlotForPad & toggleLobbySlotHumanAi) reflected back in Controller Assignment
    setCurrentSetupMode('match');
    setMatchFormat('1v1');
    toggleLobbySlotHumanAi(1);
    assert.equal(getPlayerConfigs()[1].type, 'ai');
    showControllerAssignment('1v1', {}, { preserveExisting: true });
    assert.ok(t2.innerHTML.includes('AI ATHLETE (CPU BOT)'), 'Controller Assignment reflects Page 1 toggle to AI');

    env.setPads([pad0, pad1]);
    claimLobbySlotForPad(1, pad1.id);
    showControllerAssignment('1v1', {}, { preserveExisting: true });
    assert.ok(t2.innerHTML.includes('PlayStation Controller (Pad 2)'), 'Controller Assignment reflects Page 1 claimLobbySlotForPad');

    // 5. Same-index hot-swap while Controller Assignment is open refreshes id, name, brand
    const switchPadAt1 = makePad(1, -1, 'Nintendo Switch Pro Controller (STANDARD GAMEPAD)');
    const tracker = createMenuPadTracker();
    tracker.update([pad0, switchPadAt1]);
    pollAssignmentGamepads([pad0, switchPadAt1], tracker);
    assert.ok(t2.innerHTML.includes('Switch Controller (Pad 2)'), 'Same-index hot-swap refreshes card to Switch Controller');
    assert.equal(t2.innerHTML.includes('PlayStation Controller (Pad 2)'), false, 'Same-index hot-swap clears old PlayStation label');
    assert.ok(t1.innerHTML.includes('Xbox Controller (Pad 1)'), 'P1 Xbox card stays intact');
  } finally {
    env.restore();
  }
});

test('Regression Bug 6: Solo Away Host Page 2 uses host focus pills and sole kb1 Arrow/Enter navigation without breaking 2-keyboard ownership', () => {
  const env = installTestEnv([]);
  try {
    const rootEl = env.dom.document.createElement('div');
    rootEl.id = 'main-menu-root';
    env.dom.body.appendChild(rootEl);
    menuState.rootEl = rootEl;
    menuState.titleScreenEl = env.dom.document.createElement('div');

    buildPlayerSetupScreen(rootEl, {}, { showTitleScreen: () => {}, hidePlayerSetup: () => {} });
    const setupEl = env.dom.document.getElementById('player-setup-screen');
    setupEl.style.display = 'flex';
    setCurrentSetupMode('match');
    setMatchFormat('1v1');

    const cfgs = getPlayerConfigs();
    cfgs[0].type = 'ai';
    cfgs[1].type = 'human';
    setExplicitDeviceMappings({
      1: { type: 'keyboard', keyId: 'kb1', name: 'Keyboard 1 (WASD)' },
    });

    setSetupPage(2);
    window._updateSetupPage();

    const ballBox = env.dom.document.getElementById('match-ball-selector-box');
    const durationBox = env.dom.document.getElementById('match-duration-selector-box');
    const [btnReadyP1, btnReadyP2] = getPlayerReadyButtons();
    const btnStart = getBtnStartMatch();
    const hasFocusPill = (el) => Boolean(el && el.children.some((c) => c.classList?.contains('ctrl-focus-pill')));

    // Row 0: ballBox shows P2 RULES, btnReadyP1 and btnReadyP2 have NO stuck focus pill
    assert.equal(getMatchRulesFocusRow(), 0);
    assert.ok(ballBox.innerHTML.includes('P2 RULES'), 'Solo Away Host ballBox uses P2 RULES pill');
    assert.equal(ballBox.innerHTML.includes('P1 RULES'), false, 'Solo Away Host ballBox must not show P1 RULES');
    assert.equal(hasFocusPill(btnReadyP1), false, 'AI btnReadyP1 has no focus pill');
    assert.equal(hasFocusPill(btnReadyP2), false, 'Host btnReadyP2 has no stuck duplicate focus pill on Row 0');

    setMenuNavigationContext({ playerSetup });
    startMenuGamepadPolling();

    // Sole kb1 ArrowDown moves Row 0 -> Row 1 (durationBox with P2 RULES) -> Row 2 (btnReadyP2)
    env.dispatchKey('ArrowDown');
    assert.equal(getMatchRulesFocusRow(), 1, 'Sole kb1 ArrowDown advances Page 2 Row 0 -> 1');
    assert.ok(durationBox.innerHTML.includes('P2 RULES'), 'Solo Away Host durationBox uses P2 RULES pill');
    assert.equal(hasFocusPill(btnReadyP2), false, 'Host btnReadyP2 has no stuck focus pill on Row 1');

    env.dispatchKey('ArrowDown');
    assert.equal(getMatchRulesFocusRow(), 2, 'Sole kb1 ArrowDown advances Page 2 Row 1 -> 2');
    assert.equal(getMatchRulesActionCol(), 1, 'Host default action col is 1 (host Ready button)');
    assert.equal(hasFocusPill(btnReadyP2), true, 'Host btnReadyP2 receives focus pill on Row 2 col 1');
    assert.equal(hasFocusPill(btnReadyP1), false, 'AI btnReadyP1 remains unfocused on Row 2');

    // Enter toggles Solo Away Host Ready on Row 2 col 1
    const ready = getPlayerReadyState();
    ready[1] = false;
    env.dispatchKey('Enter');
    assert.equal(ready[1], true, 'Sole kb1 Enter on Row 2 col 1 toggles Solo Away Host Ready');
    cancelMatchCountdown();

    // ArrowRight moves col 1 -> col 2 (Start Match) and clears btnReadyP2 pill
    env.dispatchKey('ArrowRight');
    assert.equal(getMatchRulesActionCol(), 2);
    assert.equal(hasFocusPill(btnReadyP2), false, 'Moving to Start Match clears btnReadyP2 focus pill');
    assert.equal(hasFocusPill(btnStart), true, 'Start Match receives P2 focus pill');

    // Verify 2-keyboard Page 2 ownership stays strict when both kb1 and kb2 are mapped
    cfgs[0].type = 'human';
    cfgs[1].type = 'human';
    setExplicitDeviceMappings({
      0: { type: 'keyboard', keyId: 'kb1', name: 'Keyboard 1 (WASD)' },
      1: { type: 'keyboard', keyId: 'kb2', name: 'Keyboard 2 (IJKL)' },
    });
    ready[0] = false;
    ready[1] = false;
    setSetupPage(2);
    window._updateSetupPage();
    env.dispatchKey('Enter');
    assert.equal(ready[1], true, '2-keyboard Enter toggles kb2-owned P2 Ready');
    assert.equal(ready[0], false, '2-keyboard Enter does not toggle kb1-owned P1 Ready');
  } finally {
    env.restore();
  }
});
