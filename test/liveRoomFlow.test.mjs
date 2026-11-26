/**
 * Tests for v0.4.2.2 Milestone M3A:
 *   - Feature 10: Victory Pick Sides / Swap Controllers + Match Ball 'medium' fallback/reset
 *   - Feature 11: local_warmup & sparring_bot multi-pad, P2-P4 athletes, overlays, ballDropRing
 *   - Feature 12: Rematch actionState tick latch reset + motor.lastJumpTick reset
 *   - Feature 13: Gamepad AudioContext resume via soundManager.unlock() & inputRouter
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';

import {
  initMainMenu,
  openMatchPickSides,
  showPlayerSetup,
  hideMainMenu,
  getSelectedMatchBall,
} from '../src/features/ui/mainMenu/index.js';
import { openMatchPickSides as reExportedOpenMatchPickSides } from '../src/ui/mainMenu.js';
import { state as menuState } from '../src/features/ui/mainMenu/state.js';
import {
  swapSides,
  hideControllerAssignment,
  getControllerAssignmentMode,
} from '../src/features/ui/mainMenu/controllerAssignment.js';
import { stopSetupGamepadPolling } from '../src/features/ui/mainMenu/menuNavigation.js';
import { cancelMatchCountdown } from '../src/features/ui/mainMenu/playerSetup.js';
import {
  initVictoryScreen,
  showVictoryScreen,
  hideVictoryScreen,
  isVictoryScreenVisible,
} from '../src/ui/victoryScreen.js';
import { AthleteManager } from '../src/features/athletes/athleteManager.js';
import { configurePracticeRoster } from '../src/features/match/practiceMode.js';
import {
  initInputRouter,
  sampleAllInputs,
  getInputSlot,
  getControlsSnapshot,
  setExplicitDeviceMappings,
  getDisconnectedMappedSlots,
  clearGameplayInputQueues,
  getCameraCycleHint,
} from '../src/input/inputRouter.js';
import {
  initCountdownOverlay,
  updateCountdownOverlay,
  resetCountdownOverlay,
} from '../src/ui/countdownOverlay.js';
import { createBallDropRings } from '../src/visuals/ballDropRing.js';
import { getHudPrefs, setHudPrefs, resetHudPrefs } from '../src/config/hudConfig.js';
import { TUNING } from '../src/config/tuning.js';
import { createActionState, runActions } from '../src/mechanics/actions.js';
import { createTracker } from '../src/sim/tracker.js';
import { soundManager } from '../src/audio/soundManager.js';

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

  function makeClassList() {
    const classes = new Set();
    return {
      _set: classes,
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (n) => classes.has(n),
      toggle: (n) => (classes.has(n) ? (classes.delete(n), false) : (classes.add(n), true)),
    };
  }

  function makeStyle() {
    const store = { display: '' };
    return new Proxy(store, {
      set(target, prop, value) {
        if (prop === 'cssText') {
          const text = String(value || '');
          target.cssText = text;
          const disp = /(?:^|;)\s*display\s*:\s*([^;]+)/i.exec(text);
          if (disp) target.display = disp[1].trim();
          const fw = /(?:^|;)\s*flex-wrap\s*:\s*([^;]+)/i.exec(text);
          if (fw) target.flexWrap = fw[1].trim();
          return true;
        }
        target[prop] = value;
        return true;
      },
    });
  }

  function createNode(tagName = 'div') {
    const listeners = new Map();
    const attrs = new Map();
    const children = [];
    const classList = makeClassList();
    let _id = '';
    let _innerHTML = '';
    let _textContent = '';

    const el = {
      tagName: String(tagName).toUpperCase(),
      style: makeStyle(),
      dataset: {},
      children,
      disabled: false,
      hidden: false,
      title: '',
      value: '',
      offsetWidth: 0,
      parentNode: null,
      isConnected: true,
      classList,
      get firstElementChild() { return children[0] || null; },
      get className() { return Array.from(classList._set).join(' '); },
      set className(val) {
        classList._set.clear();
        String(val || '').split(/\s+/).filter(Boolean).forEach((c) => classList._set.add(c));
      },
      get id() { return _id; },
      set id(val) {
        if (_id && elementsById.get(_id) === el) elementsById.delete(_id);
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
      setAttribute(name, val) {
        const k = String(name);
        const v = String(val);
        if (k === 'id') {
          el.id = v;
          return;
        }
        attrs.set(k, v);
        if (k.startsWith('data-')) {
          const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
          el.dataset[camel] = v;
        }
      },
      getAttribute(name) {
        const k = String(name);
        if (k === 'id') return _id || null;
        return attrs.has(k) ? attrs.get(k) : null;
      },
      removeAttribute(name) {
        const k = String(name);
        if (k === 'id') {
          if (_id && elementsById.get(_id) === el) elementsById.delete(_id);
          _id = '';
          return;
        }
        attrs.delete(k);
        if (k.startsWith('data-')) {
          const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
          delete el.dataset[camel];
        }
      },
      hasAttribute(name) {
        const k = String(name);
        return k === 'id' ? Boolean(_id) : attrs.has(k);
      },
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
      dispatchEvent(evt) {
        const type = evt?.type;
        if (!type) return true;
        for (const fn of [...(listeners.get(type) || [])]) fn(evt);
        return true;
      },
      click() {
        if (el.disabled) return;
        if (typeof el.onclick === 'function') el.onclick({ stopPropagation: () => {} });
        const list = listeners.get('click') || [];
        for (const fn of list) fn({ stopPropagation: () => {}, target: el });
      },
      focus() {},
      scrollIntoView() {},
      closest() { return null; },
      querySelector(sel) {
        return el.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const results = [];
        const idMatch = /^#([a-zA-Z0-9_-]+)$/.exec(sel);
        const attrMatch = /^\[([a-zA-Z0-9-]+)=["']([^"']+)["']\]$/.exec(sel);
        const classMatch = /^(?::scope\s*>\s*)?\.([a-zA-Z0-9_-]+)$/.exec(sel);
        const directOnly = /^:scope\s*>/.test(sel);
        const visit = (node) => {
          for (const ch of node.children) {
            if (idMatch && ch.id === idMatch[1]) {
              results.push(ch);
            } else if (attrMatch) {
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
    return el;
  }

  const head = createNode('head');
  const body = createNode('body');
  const documentMock = {
    head,
    body,
    activeElement: null,
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
  const prevSession = globalThis.sessionStorage;
  const prevLocal = globalThis.localStorage;
  const prevSetInterval = globalThis.setInterval;
  const prevClearInterval = globalThis.clearInterval;
  const prevRAF = globalThis.requestAnimationFrame;

  const dom = makeMockDom();
  const windowListeners = new Map();
  let pads = initialPads;
  const intervals = new Map();
  let nextIntervalId = 1;
  const storageMap = new Map();
  const mockStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => { storageMap.set(k, String(v)); },
    removeItem: (k) => { storageMap.delete(k); },
    clear: () => { storageMap.clear(); },
  };

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
  globalThis.sessionStorage = mockStorage;
  globalThis.localStorage = mockStorage;
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
    restore() {
      stopSetupGamepadPolling();
      hideVictoryScreen();
      hideControllerAssignment();
      cancelMatchCountdown();
      resetCountdownOverlay();
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
      if (prevSession === undefined) delete globalThis.sessionStorage;
      else globalThis.sessionStorage = prevSession;
      if (prevLocal === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLocal;
      globalThis.setInterval = prevSetInterval;
      globalThis.clearInterval = prevClearInterval;
      if (prevRAF === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = prevRAF;
    },
  };
}

test('Feature 10: openMatchPickSides preserves seats, Match Ball defaults/falls back to medium, and Victory button works', () => {
  const env = installTestEnv([makePad(0), makePad(1)]);
  const prevNow = Date.now;
  let fakeNow = 10000;
  Date.now = () => fakeNow;

  const startedMatches = [];
  let pickSidesCalls = 0;

  try {
    assert.equal(
      reExportedOpenMatchPickSides,
      openMatchPickSides,
      'src/ui/mainMenu.js must re-export openMatchPickSides',
    );

    initMainMenu({
      onStartMatch: (configs, rules) => {
        startedMatches.push({ configs, rules });
      },
    });

    // 1. Entering Match Setup sets Match Ball to medium
    showPlayerSetup('match');
    assert.equal(getSelectedMatchBall(), 'medium', 'Match Setup defaults Match Ball to medium');

    // Verify mock DOM attribute and selector hardening on #swatch-contrast-warning
    const contrastWarning = env.dom.document.getElementById('swatch-contrast-warning');
    assert.ok(contrastWarning, 'Player setup creates #swatch-contrast-warning');
    assert.equal(contrastWarning.getAttribute('role'), 'status', 'contrastWarningEl sets role=status');
    assert.equal(contrastWarning.getAttribute('aria-live'), 'polite', 'contrastWarningEl sets aria-live=polite');
    assert.equal(contrastWarning.hasAttribute('role'), true);
    const scratchNode = env.dom.document.createElement('div');
    scratchNode.setAttribute('data-slot-index', '2');
    assert.equal(scratchNode.dataset.slotIndex, '2');
    assert.equal(scratchNode.hasAttribute('data-slot-index'), true);
    scratchNode.removeAttribute('data-slot-index');
    assert.equal(scratchNode.hasAttribute('data-slot-index'), false);
    assert.equal(scratchNode.dataset.slotIndex, undefined);
    const parentBox = env.dom.document.createElement('div');
    const directChild = env.dom.document.createElement('span');
    directChild.className = 'ctrl-focus-pill';
    const nestedChild = env.dom.document.createElement('span');
    nestedChild.className = 'ctrl-focus-pill';
    directChild.appendChild(nestedChild);
    parentBox.appendChild(directChild);
    assert.equal(parentBox.querySelectorAll(':scope > .ctrl-focus-pill').length, 1);
    assert.equal(parentBox.querySelectorAll('.ctrl-focus-pill').length, 2);

    // 2. Entering Practice Setup sets selectedMatchBall to 'all', then Quick Play falls back to 'medium'
    showPlayerSetup('practice');
    assert.equal(getSelectedMatchBall(), 'all', 'Practice Setup uses all ball option');
    hideMainMenu();
    openMatchPickSides('1v1');
    const caScreen = env.dom.document.getElementById('controller-assignment-screen');
    assert.equal(caScreen.style.display, 'flex', 'openMatchPickSides opens Controller Assignment');
    assert.equal(getControllerAssignmentMode(), '1v1', 'openMatchPickSides sets mode 1v1');

    // Swap sides on assignment screen, then Quick Play -> Match Ball falls back from 'all' to 'medium'
    swapSides();
    assert.ok(env.dom.document.getElementById('team1-slots-container').innerHTML.includes('Gamepad 2'));
    assert.ok(env.dom.document.getElementById('team2-slots-container').innerHTML.includes('Gamepad 1'));
    env.dom.document.getElementById('assignment-btn-quick-start').click();
    assert.equal(startedMatches.length, 1);
    assert.equal(startedMatches[0].rules.ball, 'medium', 'Quick Play fallback from practice all uses medium');
    assert.equal(getSelectedMatchBall(), 'medium');

    // 3. Re-opening via openMatchPickSides('2v2') preserves seated swapped controllers and switches to 2v2
    openMatchPickSides('2v2');
    assert.equal(caScreen.style.display, 'flex');
    assert.equal(getControllerAssignmentMode(), '2v2', 'openMatchPickSides switches to 2v2');
    assert.ok(
      env.dom.document.getElementById('team1-slots-container').innerHTML.includes('Gamepad 2'),
      'openMatchPickSides preserves swapped Gamepad 2 on Team 1',
    );
    assert.ok(
      env.dom.document.getElementById('team2-slots-container').innerHTML.includes('Gamepad 1'),
      'openMatchPickSides preserves swapped Gamepad 1 on Team 2',
    );
    hideMainMenu();

    // 4. Victory Screen Pick Sides button, flex-wrap, and keyboard nav
    initVictoryScreen({
      onRematch: () => {},
      onPickSides: () => { pickSidesCalls++; },
      onWatchReplay: null,
      onPracticeMode: () => {},
      onMainMenu: () => {},
    });

    showVictoryScreen(
      { scoreHome: 3, scoreAway: 1, goals: 4 },
      { hits: 5, whiffs: 1, accuracy: 83 },
      { hits: 2, whiffs: 4, accuracy: 33 },
    );
    assert.equal(isVictoryScreenVisible(), true);

    const pickBtn = env.dom.document.getElementById('btn-victory-pick-sides');
    assert.ok(pickBtn, 'Victory screen renders #btn-victory-pick-sides');
    assert.equal(pickBtn.textContent, 'PICK SIDES / SWAP CONTROLLERS');
    const btnRow = pickBtn.parentNode;
    assert.equal(btnRow.style.flexWrap, 'nowrap', 'Victory button row sits cleanly on a single nowrap row');
    assert.equal(btnRow.children[0].id, 'btn-rematch');
    assert.equal(btnRow.children[1].id, 'btn-victory-pick-sides', 'Pick Sides sits right after Rematch');

    // Keyboard navigation past 750ms debounce: ArrowRight moves from Rematch (0) to Pick Sides (1), Enter triggers it
    fakeNow += 1000;
    env.dispatchKey('ArrowRight');
    env.dispatchKey('Enter');
    assert.equal(pickSidesCalls, 1, 'ArrowRight + Enter from Rematch invokes onPickSides');
    assert.equal(isVictoryScreenVisible(), false, 'Invoking Pick Sides hides Victory overlay');
  } finally {
    Date.now = prevNow;
    env.restore();
  }
});

test('Feature 11: sparring_bot & local_warmup roster activation, multi-pad routing, splitscreen frames, and ballDropRing', () => {
  const env = installTestEnv([]);

  const makePracticeAthlete = (idx) => {
    const a = {
      id: `p${idx + 1}`,
      isEnabled: true,
      team: 'home',
      variant: 'classic',
      primaryColor: 0xd90429,
      headwear: 'none',
      motor: {
        lastJumpTick: 0,
        mesh: { position: new THREE.Vector3(0, 0.5, 0) },
      },
      strikeState: { assistRadius: 0.45 },
      actionState: {},
      tracker: {},
      impactEvents: [],
      setEnabled(v) { this.isEnabled = Boolean(v); },
      setTeamAndVariant(team, variant, colors) {
        this.team = team;
        this.variant = variant;
        if (colors?.primaryColor !== undefined) this.primaryColor = colors.primaryColor;
      },
      setHeadwear(hw) { this.headwear = hw; },
      teleportTo(pos) {
        this.motor.mesh.position.set(pos.x, pos.y, pos.z);
        // Mirror athlete.js: rebuild ragdoll bodies enabled, leaving this._enabled as-is
      },
    };
    return a;
  };

  try {
    // 1. AthleteManager.getEnabledCount & configurePracticeRoster for sparring_bot and local_warmup
    const mgr = new AthleteManager();
    for (let i = 0; i < 4; i++) mgr.athletes.push(makePracticeAthlete(i));
    let ensuredCount = 0;
    let resetStatsCalled = 0;
    mgr.ensureRoster = (count) => {
      ensuredCount = count;
      for (let i = 0; i < mgr.athletes.length; i++) {
        mgr.athletes[i].setEnabled(i < count);
      }
      return mgr.athletes;
    };
    const origResetStats = mgr.resetStats.bind(mgr);
    mgr.resetStats = () => {
      resetStatsCalled++;
      origResetStats();
    };

    const cameras = [0, 1, 2, 3].map(() => ({
      mode: 'chase',
      azimuth: 1.23,
      manualAzimuthOffset: 0.5,
      manualPitchOffset: 0.2,
      smoothingReset: 0,
      setMode(m) { this.mode = m; },
      resetSmoothing() { this.smoothingReset++; },
    }));

    const sparringResult = configurePracticeRoster({
      playerConfig: { team: 'home', variant: 'classic', primaryColor: 0xd90429, cameraMode: 'chase' },
      drillMode: 'sparring_bot',
      athleteManager: mgr,
      athletes: mgr.athletes,
      playerCameras: cameras,
      arenaPreset: { spawn: { x: 0, y: 1.5, z: 0 } },
      createBotController: (cfg) => cfg,
      syncPlayerCameraMode: () => {},
      onApplyPlayerTuning: () => {},
      connectedPadCount: 1,
      ensureRoster: (c) => mgr.ensureRoster(c),
    });

    assert.equal(ensuredCount, 2);
    assert.equal(resetStatsCalled, 1);
    assert.equal(sparringResult.activeCount, 2);
    assert.equal(sparringResult.splitscreen, false);
    assert.deepEqual(sparringResult.activeBotSlots, [1]);
    assert.equal(mgr.athletes[0].isEnabled, true);
    assert.equal(mgr.athletes[1].isEnabled, true, 'sparring_bot enables P2 bot after teleportToPracticeSpawn');
    assert.equal(mgr.athletes[2].isEnabled, false);
    assert.equal(mgr.getEnabledCount(), 2);
    assert.equal(cameras[0].azimuth, 0, 'sparring_bot resets P1 camera azimuth');
    assert.equal(cameras[0].manualAzimuthOffset, 0);

    const warmupResult = configurePracticeRoster({
      playerConfig: { team: 'home', variant: 'classic', primaryColor: 0xd90429, cameraMode: 'chase' },
      drillMode: 'local_warmup',
      athleteManager: mgr,
      athletes: mgr.athletes,
      playerCameras: cameras,
      arenaPreset: { spawn: { x: 0, y: 1.5, z: 0 } },
      createBotController: (cfg) => cfg,
      syncPlayerCameraMode: () => {},
      onApplyPlayerTuning: () => {},
      connectedPadCount: 4,
      ensureRoster: (c) => mgr.ensureRoster(c),
    });

    assert.equal(ensuredCount, 4);
    assert.equal(warmupResult.activeCount, 4);
    assert.equal(warmupResult.splitscreen, true);
    assert.equal(mgr.getEnabledCount(), 4, 'local_warmup with 4 pads enables all 4 athletes');
    for (let i = 0; i < 4; i++) {
      assert.equal(mgr.athletes[i].isEnabled, true, `Slot ${i} must be enabled in 4-pad local_warmup`);
    }

    // Solo sandbox drops enabled count back to 1
    configurePracticeRoster({
      playerConfig: { team: 'home', variant: 'classic', primaryColor: 0xd90429 },
      drillMode: 'sandbox',
      athleteManager: mgr,
      athletes: mgr.athletes,
      playerCameras: cameras,
      arenaPreset: { spawn: { x: 0, y: 1.5, z: 0 } },
      createBotController: (cfg) => cfg,
      syncPlayerCameraMode: () => {},
      onApplyPlayerTuning: () => {},
      connectedPadCount: 4,
    });
    assert.equal(mgr.getEnabledCount(), 1, 'sandbox leaves only P1 enabled');

    // 2. inputRouter multi-pad & keyboard routing in practice (ignoring stale explicitDeviceMappings)
    initInputRouter(env.windowMock);
    clearGameplayInputQueues();
    const cam = new THREE.PerspectiveCamera();
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: 'Stale-0', name: 'Gamepad 1' },
      1: { type: 'gamepad', padIndex: 9, id: 'Disconnected-9', name: 'Gamepad 10' },
    });

    const pads4 = [
      makePad(0, -1, 'Pad-0', [0.8, 0, 0, 0]),
      makePad(1, -1, 'Pad-1', [-0.8, 0, 0, 0]),
      makePad(2, -1, 'Pad-2', [0, 0.85, 0, 0]),
      makePad(3, -1, 'Pad-3', [0, -0.85, 0, 0]),
    ];
    env.setPads(pads4);
    sampleAllInputs([cam, cam, cam, cam], 4, 'practice', [], true);

    assert.ok(getInputSlot(0).moveX > 0.6, 'Practice Pad 0 drives P1');
    assert.ok(getInputSlot(1).moveX < -0.6, 'Practice Pad 1 drives P2');
    assert.ok(getInputSlot(2).moveZ < -0.6, 'Practice Pad 2 drives P3');
    assert.ok(getInputSlot(3).moveZ > 0.6, 'Practice Pad 3 drives P4');
    const snap = getControlsSnapshot();
    for (let i = 0; i < 4; i++) {
      assert.equal(snap[i].human, true, `uiSlots[${i}].human must be true in 4-player warmup`);
      assert.equal(snap[i].available, true, `uiSlots[${i}] must ignore stale disconnected match mappings in practice`);
    }
    assert.ok(getCameraCycleHint(1).includes('D-PAD'), 'Practice P2 pad exposes camera cycle hint');

    // 1 pad in 2-player local_warmup: P2 uses IJKL + Arrow-key look
    env.setPads([makePad(0, -1, 'Pad-0', [0, 0, 0, 0])]);
    sampleAllInputs([cam, cam], 2, 'practice', [], true);
    env.dispatchKey('KeyI');
    env.dispatchKey('ArrowRight');
    sampleAllInputs([cam, cam], 2, 'practice', [], true);
    assert.ok(getInputSlot(1).moveZ > 0.5, 'Practice P2 reads IJKL without gamepad');
    assert.ok(getInputSlot(1).lookX > 0.5, 'Practice P2 receives Arrow-key look');

    // sparring_bot (botSlots = [1]): Pad 0 drives P1, bot slot 1 stays skipped
    env.setPads([makePad(0, -1, 'Pad-0', [0.85, 0, 0, 0]), makePad(1, -1, 'Pad-1', [-0.9, 0, 0, 0])]);
    getInputSlot(1).moveX = 0;
    sampleAllInputs([cam, cam], 2, 'practice', [1], true);
    assert.ok(getInputSlot(0).moveX > 0.6, 'sparring_bot Pad 0 drives P1');
    assert.equal(getInputSlot(1).moveX, 0, 'sparring_bot leaves bot slot 1 untouched');

    // M1 match disconnect behavior remains intact when mode === 'match'
    env.setPads([makePad(0, -1, 'Stale-0')]);
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.deepEqual([...getDisconnectedMappedSlots()], [1], 'Match mode still flags disconnected mapped Pad 9 on slot 1');

    // 3. countdownOverlay splitscreen frames in practice (ignoring stale AI configs)
    const prevSplit = TUNING.camera.splitscreen;
    try {
      initCountdownOverlay();
      resetCountdownOverlay();
      const practiceAthletes = [0, 1, 2, 3].map((i) => ({
        isEnabled: true,
        team: i % 2 === 0 ? 'home' : 'away',
        primaryColor: i % 2 === 0 ? 0xd90429 : 0x1d4ed8,
      }));
      env.windowMock.__vb = {
        getGameState: () => 'practice',
        tuning: TUNING,
        athletes: practiceAthletes,
        getPlayerConfigs: () => [
          { type: 'human', team: 'home' },
          { type: 'human', team: 'away' },
          { type: 'ai', team: 'home' },
          { type: 'ai', team: 'away' },
        ],
      };
      TUNING.camera.splitscreen = true;
      updateCountdownOverlay(0, false, 0.016);
      const framesEl = env.dom.document.getElementById('splitscreen-viewport-frames');
      assert.equal(framesEl.style.display, 'block', 'local_warmup renders splitscreen frames');
      for (let i = 0; i < 4; i++) {
        assert.equal(framesEl.children[i].style.display, 'block', `Frame ${i} visible in 4-player warmup despite stale AI config`);
      }

      // 3-pad local_warmup hides the 4th unused quad frame when athletes[3].isEnabled === false
      practiceAthletes[3].isEnabled = false;
      updateCountdownOverlay(0, false, 0.016);
      assert.equal(framesEl.style.display, 'block', '3-pad local_warmup keeps splitscreen container visible');
      for (let i = 0; i < 3; i++) {
        assert.equal(framesEl.children[i].style.display, 'block', `Frame ${i} visible in 3-pad warmup`);
      }
      assert.equal(framesEl.children[3].style.display, 'none', '3-pad local_warmup hides unused 4th quad frame');

      // sparring_bot (splitscreen = false) hides splitscreen frames
      TUNING.camera.splitscreen = false;
      updateCountdownOverlay(0, false, 0.016);
      assert.equal(framesEl.style.display, 'none', 'sparring_bot hides splitscreen frames');
    } finally {
      TUNING.camera.splitscreen = prevSplit;
      delete env.windowMock.__vb;
    }

    // 4. ballDropRing shows strike-range guides for enabled P2-P4 in practice
    resetHudPrefs();
    setHudPrefs({ ballDropRing: true, strikeRangeGuide: true }, { persist: false });
    const rings = createBallDropRings(new THREE.Scene());
    const ball = {
      radius: 0.5,
      mesh: { visible: true, position: new THREE.Vector3(3.5, 1.5, -6.0) },
    };
    const ringAthletes = [
      { isEnabled: true, team: 'home', primaryColor: 0xd90429, strikeState: { assistRadius: 0.45 }, motor: { mesh: { position: new THREE.Vector3(-10, 0.5, 10) } } },
      { isEnabled: true, team: 'away', primaryColor: 0x1d4ed8, strikeState: { assistRadius: 0.45 }, motor: { mesh: { position: new THREE.Vector3(3.2, 0.5, -6.0) } } },
      { isEnabled: false, team: 'home', primaryColor: 0xfbb417, strikeState: { assistRadius: 0.45 }, motor: { mesh: { position: new THREE.Vector3(3.2, 0.5, -6.0) } } },
    ];
    rings.update({ gameState: 'practice', balls: [ball], athletes: ringAthletes });
    assert.equal(rings.reachEntries[1].mesh.visible, true, 'Enabled P2 near ball receives strike guide in practice');
    assert.equal(rings.reachEntries[2].mesh.visible, false, 'Disabled P3 stays hidden in practice');
    resetHudPrefs();
  } finally {
    env.restore();
  }
});

test('Feature 12: athleteManager.resetStats clears all actionState latches and motor.lastJumpTick for immediate rematch moves', () => {
  const mgr = new AthleteManager();
  const actionState = createActionState();
  // Dirty every latch from a high-tick previous match
  actionState.slideTime = 18;
  actionState.slideNeedsRelease = true;
  actionState.slideLowSpeedTicks = 9;
  actionState.divePending = true;
  actionState.lastDiveTick = 18000;
  actionState.diveStunUntil = 18090;
  actionState.prevGrounded = false;
  actionState.diveDir.set(1, 0, 0);
  actionState.lastCutTick = 18000;
  actionState.cleatAnchorUntil = 18020;
  actionState.cutDir.set(0, 0, 1);
  actionState.braceMix = 0.85;
  actionState.lastInterceptDiveTick = 18000;
  actionState.interceptDiveContactTick = 18005;
  actionState._result.sliding = true;
  actionState._result.cutFired = true;

  const motor = {
    grounded: true,
    lastJumpTick: 18000,
    groundNormal: { x: 0, y: 1, z: 0 },
    body: {
      translation: () => ({ x: 0, y: 0.5, z: 0 }),
      linvel: () => ({ x: 6.0, y: 0, z: 0 }),
      angvel: () => ({ x: 0, y: 0, z: 0 }),
      mass: () => 75,
      applyImpulse: () => {},
      applyTorqueImpulse: () => {},
    },
  };
  const tracker = createTracker();
  tracker.lastImpactKey = 'head';
  tracker.lastImpactExcess = 50;
  tracker.lastImpactTick = 18000;
  mgr.athletes.push(null); // verify null-entry guard
  mgr.athletes.push({ actionState, motor, tracker, impactEvents: [{ force: 10 }] });

  mgr.resetStats();

  assert.equal('slideCooldown' in actionState, false, 'Obsolete slideCooldown field must not be re-added');
  assert.equal(actionState.slideTime, 0);
  assert.equal(actionState.slideNeedsRelease, false);
  assert.equal(actionState.slideLowSpeedTicks, 0);
  assert.equal(actionState.divePending, false);
  assert.equal(actionState.lastDiveTick, -Infinity);
  assert.equal(actionState.diveStunUntil, -Infinity);
  assert.equal(actionState.prevGrounded, true);
  assert.equal(actionState.diveDir.lengthSq(), 0);
  assert.equal(actionState.lastCutTick, -Infinity);
  assert.equal(actionState.cleatAnchorUntil, -Infinity);
  assert.equal(actionState.cutDir.lengthSq(), 0);
  assert.equal(actionState.braceMix, 0);
  assert.equal(actionState.lastInterceptDiveTick, -Infinity);
  assert.equal(actionState.interceptDiveContactTick, -Infinity);
  assert.equal(actionState._result.sliding, false);
  assert.equal(actionState._result.cutFired, false);
  assert.equal(motor.lastJumpTick, -Infinity);
  assert.equal(tracker.lastImpactKey, '');
  assert.equal(tracker.lastImpactExcess, 0);
  assert.equal(tracker.lastImpactTick, -1e9);

  // Immediately run actions on tick 1 of a rematch -> slide, cut, and dive all fire cleanly
  const input = {
    slideHeld: true,
    braceHeld: false,
    moveWorld: new THREE.Vector3(1, 0, 0),
    cameraYaw: 0,
  };
  const slideOut = runActions({
    state: actionState,
    motor,
    input,
    tracker,
    ragdoll: null,
    ghost: null,
    diveQueued: false,
    jumpQueued: false,
    cutQueued: false,
    tick: 1,
    dt: 1 / 60,
  });
  assert.equal(slideOut.sliding, true, 'Rematch tick 1 slide starts immediately after resetStats');

  mgr.resetStats();
  const cutDiveOut = runActions({
    state: actionState,
    motor,
    input: { slideHeld: false, braceHeld: false, moveWorld: new THREE.Vector3(1, 0, 0), cameraYaw: 0 },
    tracker,
    ragdoll: null,
    ghost: null,
    diveQueued: true,
    jumpQueued: false,
    cutQueued: true,
    tick: 1,
    dt: 1 / 60,
  });
  assert.equal(cutDiveOut.cutFired, true, 'Rematch tick 1 cut fires immediately after resetStats');
  assert.equal(actionState.divePending, true, 'Rematch tick 1 dive fires immediately after resetStats');
});

test('Feature 13: soundManager.unlock guards concurrent/60Hz resume calls and inputRouter unlocks on gamepadconnected & button press', async () => {
  const env = installTestEnv([]);
  const prevCtx = soundManager.ctx;
  const prevUnlocked = soundManager.unlocked;
  const prevResuming = soundManager._resuming;
  const prevAmbienceStarted = soundManager.ambienceStarted;

  try {
    // 0. _resuming property exists and defaults to false
    assert.equal('_resuming' in soundManager, true, 'soundManager exposes _resuming guard flag');
    assert.equal(soundManager._resuming, false, 'soundManager._resuming initializes to false');

    // 1. Headless safety when ctx is null or missing resume()
    soundManager.ctx = null;
    soundManager.unlocked = false;
    assert.equal(soundManager.unlock(), false);
    assert.equal(soundManager.unlocked, false);

    soundManager.ctx = { state: 'suspended' };
    assert.equal(soundManager.unlock(), false, 'Missing ctx.resume returns false without throwing');
    assert.equal(soundManager._resuming, false);
    assert.equal(soundManager.unlocked, false);

    // Synchronous resume() returning non-thenable or throwing
    soundManager.ctx = {
      state: 'suspended',
      resume: () => { throw new Error('sync throw'); },
    };
    assert.equal(soundManager.unlock(), false, 'Throwing ctx.resume returns false');
    assert.equal(soundManager._resuming, false);
    assert.equal(soundManager.unlocked, false);

    soundManager.ctx = {
      state: 'suspended',
      resume: () => undefined,
    };
    assert.equal(soundManager.unlock(), false, 'Sync resume still suspended returns false');
    assert.equal(soundManager._resuming, false);
    assert.equal(soundManager.unlocked, false);

    soundManager.ctx = {
      state: 'suspended',
      resume: () => { soundManager.ctx.state = 'running'; },
    };
    assert.equal(soundManager.unlock(), true, 'Sync resume reaching running returns true');
    assert.equal(soundManager._resuming, false);
    assert.equal(soundManager.unlocked, true);
    soundManager.unlocked = false;

    // 2. Concurrent unlock() calls while resume() is pending invoke ctx.resume() exactly once
    let pendingCalls = 0;
    let resolvePending = null;
    soundManager.ctx = {
      state: 'suspended',
      resume: () => {
        pendingCalls++;
        return new Promise((resolve) => {
          resolvePending = () => {
            soundManager.ctx.state = 'running';
            resolve();
          };
        });
      },
    };
    assert.equal(soundManager.unlock(), false, 'Pending async resume returns false');
    assert.equal(soundManager._resuming, true, '_resuming is true while async resume is in flight');
    assert.equal(soundManager.unlock(), false);
    assert.equal(soundManager.unlock(), false);
    assert.equal(pendingCalls, 1, '3 concurrent unlock() calls invoke ctx.resume() exactly once');
    resolvePending();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(soundManager._resuming, false, '_resuming resets to false after fulfill');
    assert.equal(soundManager.unlocked, true, 'unlocked becomes true after resume fulfills');

    // 3. Rejected resume() clears _resuming so a subsequent retry succeeds cleanly
    let rejectCalls = 0;
    let rejectPending = null;
    soundManager.unlocked = false;
    soundManager.ctx = {
      state: 'suspended',
      resume: () => {
        rejectCalls++;
        return new Promise((_, reject) => {
          rejectPending = () => reject(new Error('Autoplay blocked'));
        });
      },
    };
    assert.equal(soundManager.unlock(), false);
    assert.equal(soundManager._resuming, true);
    rejectPending();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(soundManager._resuming, false, '_resuming resets to false after rejection');
    assert.equal(soundManager.unlocked, false);
    assert.equal(rejectCalls, 1);

    // Retry after rejection succeeds
    let retryCalls = 0;
    soundManager.ctx = {
      state: 'suspended',
      resume: () => {
        retryCalls++;
        soundManager.ctx.state = 'running';
        return Promise.resolve();
      },
    };
    soundManager.unlock();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(retryCalls, 1);
    assert.equal(soundManager._resuming, false);
    assert.equal(soundManager.unlocked, true, 'Retry succeeds after earlier rejection');

    // 3b. Async resume resolving while ctx.state stays suspended or ctx becomes null must not unlock
    let resolveStillSuspended = null;
    soundManager.unlocked = false;
    soundManager.ambienceStarted = false;
    soundManager.ctx = {
      state: 'suspended',
      resume: () => new Promise((resolve) => { resolveStillSuspended = resolve; }),
    };
    assert.equal(soundManager.unlock(), false);
    assert.equal(soundManager._resuming, true);
    resolveStillSuspended();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(soundManager._resuming, false, '_resuming resets when resume resolves still suspended');
    assert.equal(soundManager.unlocked, false, 'unlocked remains false when ctx.state is still suspended');
    assert.equal(soundManager.ambienceStarted, false, 'ambience stays off when ctx.state is still suspended');

    let resolveNullCtx = null;
    soundManager.ctx = {
      state: 'suspended',
      resume: () => new Promise((resolve) => { resolveNullCtx = resolve; }),
    };
    assert.equal(soundManager.unlock(), false);
    assert.equal(soundManager._resuming, true);
    soundManager.ctx = null;
    resolveNullCtx();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(soundManager._resuming, false, '_resuming resets when ctx becomes null mid-resume');
    assert.equal(soundManager.unlocked, false, 'unlocked remains false when ctx becomes null mid-resume');
    assert.equal(soundManager.ambienceStarted, false);

    // 4. 60 held-button frames in sampleAllInputs while ctx.resume() is pending invoke ctx.resume() once
    let heldResumeCalls = 0;
    let resolveHeld = null;
    soundManager.unlocked = false;
    soundManager._resuming = false;
    soundManager.ambienceStarted = false;
    soundManager.ctx = {
      state: 'suspended',
      resume: () => {
        heldResumeCalls++;
        return new Promise((resolve) => {
          resolveHeld = () => {
            soundManager.ctx.state = 'running';
            resolve();
          };
        });
      },
    };
    const freshRouter = await import(`../src/input/inputRouter.js?unlock=${Date.now()}`);
    freshRouter.initInputRouter(env.windowMock);

    const cam = new THREE.PerspectiveCamera();
    env.setPads([makePad(0, 0)]);
    for (let f = 0; f < 60; f++) {
      freshRouter.sampleAllInputs([cam], 1, 'match', [], true);
    }
    assert.equal(heldResumeCalls, 1, '60 held-button sampleAllInputs frames invoke ctx.resume() exactly once');
    assert.equal(soundManager._resuming, true);
    resolveHeld();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(soundManager._resuming, false);
    assert.equal(soundManager.unlocked, true);

    // 5. Blocked/menu branch with no buttons pressed does not unlock; button press & gamepadconnected unlock
    let resumeCalls = 0;
    soundManager.unlocked = false;
    soundManager.ctx = {
      state: 'suspended',
      resume: () => {
        resumeCalls++;
        soundManager.ctx.state = 'running';
        return Promise.resolve();
      },
    };

    env.setPads([makePad(0, -1)]);
    freshRouter.sampleAllInputs([cam], 1, 'match', [], false);
    assert.equal(resumeCalls, 0);

    env.setPads([makePad(0, 0)]);
    freshRouter.sampleAllInputs([cam], 1, 'match', [], false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(resumeCalls, 1, 'First button press in blocked/menu sampleAllInputs resumes AudioContext');
    assert.equal(soundManager.unlocked, true);

    soundManager.unlocked = false;
    soundManager.ctx.state = 'suspended';
    env.windowMock.dispatchEvent({ type: 'gamepadconnected', gamepad: makePad(0) });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(resumeCalls, 2, 'gamepadconnected triggers soundManager.unlock()');
    assert.equal(soundManager.unlocked, true);
  } finally {
    soundManager.ctx = prevCtx;
    soundManager.unlocked = prevUnlocked;
    soundManager._resuming = prevResuming;
    soundManager.ambienceStarted = prevAmbienceStarted;
    env.restore();
  }
});

test('openMatchPickSides(1v1) after 2v2 vacates P3 and P4 onto #bench-slots-container', () => {
  const env = installTestEnv([makePad(0), makePad(1), makePad(2), makePad(3)]);
  try {
    initMainMenu({ onStartMatch: () => {} });

    env.dom.document.getElementById('btn-play-match-2v2').click();
    assert.equal(getControllerAssignmentMode(), '2v2', '2v2 assignment opens with 4 seated pads');

    const t1 = env.dom.document.getElementById('team1-slots-container');
    const t2 = env.dom.document.getElementById('team2-slots-container');
    const bench = env.dom.document.getElementById('bench-slots-container');
    assert.ok(t1.innerHTML.includes('Gamepad 3'), '2v2 seats Gamepad 3 in P3');
    assert.ok(t2.innerHTML.includes('Gamepad 4'), '2v2 seats Gamepad 4 in P4');

    hideControllerAssignment();
    openMatchPickSides('1v1');
    assert.equal(getControllerAssignmentMode(), '1v1', 'openMatchPickSides switches mode to 1v1');
    assert.ok(t1.innerHTML.includes('Gamepad 1'), '1v1 keeps Gamepad 1 in P1');
    assert.ok(t1.innerHTML.includes('P3 SLOT'), '1v1 renders P3 inactive placeholder');
    assert.equal(t1.innerHTML.includes('Gamepad 3'), false, '1v1 vacates Gamepad 3 from Team 1');
    assert.ok(t2.innerHTML.includes('Gamepad 2'), '1v1 keeps Gamepad 2 in P2');
    assert.ok(t2.innerHTML.includes('P4 SLOT'), '1v1 renders P4 inactive placeholder');
    assert.equal(t2.innerHTML.includes('Gamepad 4'), false, '1v1 vacates Gamepad 4 from Team 2');
    assert.ok(bench.innerHTML.includes('Gamepad 3'), 'P3 Gamepad 3 moves onto #bench-slots-container');
    assert.ok(bench.innerHTML.includes('Gamepad 4'), 'P4 Gamepad 4 moves onto #bench-slots-container');
  } finally {
    env.restore();
  }
});

test('Regression Bugs 1, 2, 4: 1v1 after 4P warmup scopes enabled count, switchSlotToBot clears splitscreen, and shared Broadcast/Sports hides splitscreen frames', async () => {
  const env = installTestEnv([makePad(0)]);
  const prevSplit = TUNING.camera.splitscreen;

  try {
    // 1. Bug 1: 4P local_warmup followed by 1v1 ensureRoster(2) leaves athletes.length === 4 but getEnabledCount() === 2
    const mgr = new AthleteManager();
    for (let i = 0; i < 4; i++) {
      mgr.athletes.push({
        id: `p${i + 1}`,
        isEnabled: true,
        team: i % 2 === 0 ? 'home' : 'away',
        primaryColor: i % 2 === 0 ? 0xd90429 : 0x1d4ed8,
        setEnabled(v) { this.isEnabled = Boolean(v); },
      });
    }
    mgr.ensureRoster = (count) => {
      for (let i = 0; i < mgr.athletes.length; i++) {
        mgr.athletes[i].setEnabled(i < count);
      }
      return mgr.athletes;
    };

    mgr.ensureRoster(4);
    assert.equal(mgr.athletes.length, 4);
    assert.equal(mgr.getEnabledCount(), 4);

    mgr.ensureRoster(2);
    assert.equal(mgr.athletes.length, 4, 'ensureRoster(2) preserves 4-slot array');
    assert.equal(mgr.getEnabledCount(), 2, 'getEnabledCount() returns 2 for 1v1 after 4P warmup');

    initInputRouter(env.windowMock);
    const overlayRoot = env.dom.document.createElement('div');
    overlayRoot.id = 'controls-overlay';
    env.dom.body.appendChild(overlayRoot);
    const controlsMod = await import(`../src/ui/controlsOverlay.js?liveroom=${Date.now()}`);
    controlsMod.initControlsOverlay();
    setHudPrefs({ controlsOverlay: true }, { persist: false });
    const cam = new THREE.PerspectiveCamera();
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, id: 'Mock Pad 0', name: 'Gamepad 1' },
    });
    sampleAllInputs([cam, cam], mgr.getEnabledCount(), 'match', [1], true);
    const snap = getControlsSnapshot();
    assert.equal(snap[0].human, true, 'P1 is human in 1v1 match');
    assert.equal(snap[1].human, false, 'P2 bot is not human');
    assert.equal(snap[2].human, false, 'Disabled P3 slot must not become human after 4P warmup');
    assert.equal(snap[3].human, false, 'Disabled P4 slot must not become human after 4P warmup');

    controlsMod.updateControlsOverlay(snap, 'match', false, false, false, false, false);
    const strips = overlayRoot.querySelectorAll('.controls-strip');
    assert.equal(strips.length, 4, 'controlsOverlay builds 4 strips');
    const p3Strip = strips.find((s) => s.dataset.slot === '2');
    const p4Strip = strips.find((s) => s.dataset.slot === '3');
    assert.equal(p3Strip.hidden, true, 'P3 controls strip stays hidden in 1v1 match');
    assert.equal(p4Strip.hidden, true, 'P4 controls strip stays hidden in 1v1 match');

    // Verify src/main.js uses activeCount/getEnabledCount/syncMatchSplitscreen
    const mainSrc = fs.readFileSync(path.resolve('src/main.js'), 'utf8');
    assert.ok(mainSrc.includes('for (let i = 0; i < activeCount; i++)'), 'handleStartMatch scopes loop to activeCount');
    assert.ok(mainSrc.includes('sampleAllInputs(_playerCameraList, athleteManager.getEnabledCount(),'), 'loop.onFrame passes getEnabledCount() for match and practice');
    assert.ok(mainSrc.includes('playerCount: lastMatchConfigs?.length >= 4 ? 4 : 2,'), 'handleRematch uses active match slot count');
    assert.ok(mainSrc.includes('syncMatchSplitscreen(getActiveHumanSlots().length);'), 'switchSlotToBot recomputes splitscreen flag');

    // 2. Bug 4: Shared Broadcast or Sports camera hides #splitscreen-viewport-frames even when TUNING.camera.splitscreen is true
    const countdownMod = await import(`../src/ui/countdownOverlay.js?liveroom=${Date.now()}`);
    countdownMod.initCountdownOverlay();
    countdownMod.resetCountdownOverlay();
    const matchAthletes = [
      { isEnabled: true, team: 'home', primaryColor: 0xd90429 },
      { isEnabled: true, team: 'away', primaryColor: 0x1d4ed8 },
    ];
    const cams = [{ mode: 'broadcast' }, { mode: 'broadcast' }];
    env.windowMock.__vb = {
      getGameState: () => 'match',
      tuning: TUNING,
      athletes: matchAthletes,
      playerCameras: cams,
      getPlayerConfigs: () => [
        { type: 'human', team: 'home', primaryColor: 0xd90429 },
        { type: 'human', team: 'away', primaryColor: 0x1d4ed8 },
      ],
    };
    TUNING.camera.splitscreen = true;

    countdownMod.updateCountdownOverlay(0, false, 0.016);
    const framesEl = env.dom.document.getElementById('splitscreen-viewport-frames');
    assert.equal(framesEl.style.display, 'none', 'Shared Broadcast hides #splitscreen-viewport-frames');

    cams[0].mode = 'sports';
    cams[1].mode = 'sports';
    countdownMod.updateCountdownOverlay(0, false, 0.016);
    assert.equal(framesEl.style.display, 'none', 'Shared Sports hides #splitscreen-viewport-frames');

    cams[0].mode = 'chase';
    cams[1].mode = 'chase';
    countdownMod.updateCountdownOverlay(0, false, 0.016);
    assert.equal(framesEl.style.display, 'block', 'Returning to Chase restores #splitscreen-viewport-frames');

    // Also verify viewportManager.lastIsSplitscreen === false fallback when playerCameras is omitted
    env.windowMock.__vb = {
      getGameState: () => 'match',
      tuning: TUNING,
      athletes: matchAthletes,
      viewportManager: { lastIsSplitscreen: false },
      getPlayerConfigs: () => [
        { type: 'human', team: 'home', primaryColor: 0xd90429 },
        { type: 'human', team: 'away', primaryColor: 0x1d4ed8 },
      ],
    };
    countdownMod.updateCountdownOverlay(0, false, 0.016);
    assert.equal(framesEl.style.display, 'none', 'viewportManager.lastIsSplitscreen === false hides splitscreen frames when playerCameras omitted');
  } finally {
    TUNING.camera.splitscreen = prevSplit;
    delete env.windowMock.__vb;
    resetHudPrefs();
    env.restore();
  }
});
