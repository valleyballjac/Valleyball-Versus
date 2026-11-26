/**
 * Unit tests for M3B onboarding polish, practice drill selection, default match ball,
 * practice HUD placement and copy, stale assist copy removal, unified P1-P4 kit colors,
 * colorblind-safe swatch contrast warning, and gamepad audio unlock.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { TUNING } from '../src/config/tuning.js';
import {
  ASSIST_OPTIONS,
  MATCH_BALL_OPTIONS,
  PRACTICE_DRILL_OPTIONS,
  PLAYER_SLOT_COLORS,
  getPlayerSlotTheme,
  renderViewportBadgeHtml,
  checkSwatchContrast,
  readableOnDark,
} from '../src/features/ui/mainMenu/constants.js';
import { updatePracticeHud, hidePracticeHud } from '../src/ui/practiceHud.js';
import { viewportManager } from '../src/features/camera/viewportManager.js';
import { state as menuState } from '../src/features/ui/mainMenu/state.js';
import {
  buildPlayerSetupScreen,
  playerSetup,
  setPlayerColor,
  setPlayerTeam,
  getSelectedMatchBall,
  setSelectedMatchBall,
  getSelectedPracticeDrill,
  setSelectedPracticeDrill,
  getPlayerConfigs,
  getPlayerFocusRow,
  getBtnNext,
  getBtnStartMatch,
  setCurrentSetupMode,
  setSetupPage,
  setMatchFormat,
  cancelMatchCountdown,
} from '../src/features/ui/mainMenu/playerSetup.js';
import {
  setMenuNavigationContext,
  startMenuGamepadPolling,
  stopSetupGamepadPolling,
} from '../src/features/ui/mainMenu/menuNavigation.js';
import {
  buildControllerAssignmentScreen,
  showControllerAssignment,
  hideControllerAssignment,
  pollAssignmentGamepads,
} from '../src/features/ui/mainMenu/controllerAssignment.js';
import { createMenuPadTracker } from '../src/input/menuPads.js';
import { soundManager } from '../src/audio/soundManager.js';

function makePad(index, pressedIdxOrList = -1, id = `Mock Pad ${index}`) {
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
    axes: [0, 0, 0, 0],
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
      style: { display: '' },
      dataset: {},
      children,
      disabled: false,
      title: '',
      value: '',
      offsetWidth: 0,
      parentNode: null,
      classList,
      _attrs: attrs,
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
        _innerHTML = '';
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
      setAttribute(name, val) {
        attrs.set(String(name), String(val));
      },
      getAttribute(name) {
        return attrs.get(String(name)) ?? null;
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
        const visit = (node, depth) => {
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
            if (!directOnly || depth === 0) {
              visit(ch, depth + 1);
            }
          }
        };
        visit(el, 0);
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
  const prevSetTimeout = globalThis.setTimeout;
  const prevClearTimeout = globalThis.clearTimeout;
  const prevRAF = globalThis.requestAnimationFrame;

  const dom = makeMockDom();
  const windowListeners = new Map();
  let pads = initialPads;
  const intervals = new Map();
  let nextIntervalId = 1;
  const timeouts = new Map();
  let nextTimeoutId = 1;

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
  globalThis.setTimeout = (fn) => {
    const id = nextTimeoutId++;
    timeouts.set(id, fn);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    timeouts.delete(id);
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
    restore() {
      stopSetupGamepadPolling();
      hideControllerAssignment();
      cancelMatchCountdown();
      hidePracticeHud();
      intervals.clear();
      timeouts.clear();
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
      globalThis.setTimeout = prevSetTimeout;
      globalThis.clearTimeout = prevClearTimeout;
      if (prevRAF === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = prevRAF;
    },
  };
}

test('Feature 14 & 15: drillBox visible, Row 7-9 practice nav, drill launch arg, and medium default Match Ball', () => {
  const env = installTestEnv([]);
  const practiceCalls = [];
  const matchCalls = [];

  try {
    // Fresh default Match Ball must be 'medium' and MATCH_BALL_OPTIONS marks MEDIUM BALL [Default]
    assert.equal(getSelectedMatchBall(), 'medium', 'Fresh default selectedMatchBall must be medium');
    const randomOpt = MATCH_BALL_OPTIONS.find((o) => o.id === 'random');
    const mediumOpt = MATCH_BALL_OPTIONS.find((o) => o.id === 'medium');
    assert.equal(randomOpt.desc.includes('[Default]'), false, 'Random ball must no longer be marked [Default]');
    assert.ok(mediumOpt.desc.includes('[Default]'), 'Medium ball must be marked [Default]');

    const rootEl = env.dom.document.createElement('div');
    rootEl.id = 'main-menu-root';
    env.dom.body.appendChild(rootEl);
    menuState.rootEl = rootEl;
    menuState.titleScreenEl = env.dom.document.createElement('div');
    menuState.titleScreenEl.style.display = 'none';

    buildPlayerSetupScreen(rootEl, {
      onStartPractice: (cfg, ball, drill) => practiceCalls.push({ cfg, ball, drill }),
      onStartMatch: (cfgs, rules) => matchCalls.push({ cfgs, rules }),
    }, {
      showTitleScreen: () => {},
      hidePlayerSetup: () => { playerSetup.playerSetupEl.style.display = 'none'; },
    });

    setMenuNavigationContext({ playerSetup });
    startMenuGamepadPolling();

    // Enter Practice Mode
    setCurrentSetupMode('practice');
    setSelectedPracticeDrill('sandbox');
    setSelectedMatchBall('medium');
    playerSetup.playerSetupEl.style.display = 'flex';
    getPlayerFocusRow()[0] = 6;
    env.windowMock._updateSetupPage();

    const drillBox = env.dom.document.getElementById('practice-drill-selector-box');
    const ballBox = env.dom.document.getElementById('match-ball-selector-box');
    assert.ok(drillBox, 'drillBox must exist');
    assert.equal(drillBox.style.display, 'flex', 'drillBox must be visible in practice mode');

    // Keyboard Down from Row 6 -> Row 7 (drillBox) -> Right cycles to newcomer_drill
    env.dispatchKey('ArrowDown');
    assert.equal(getPlayerFocusRow()[0], 7, 'ArrowDown from Row 6 moves focus to Row 7 (drillBox)');
    assert.ok(drillBox.querySelector(':scope > .ctrl-focus-pill'), 'Row 7 applies controller focus pill on drillBox');

    env.dispatchKey('ArrowRight');
    assert.equal(getSelectedPracticeDrill(), 'newcomer_drill', 'ArrowRight on Row 7 selects newcomer_drill');
    assert.ok(getBtnStartMatch().textContent.includes('NEWCOMER CHECKLIST'), 'Start button updates to selected untimed checklist label');

    // Re-running _updateSetupPage must NOT reset selectedPracticeDrill back to sandbox
    env.windowMock._updateSetupPage();
    assert.equal(getSelectedPracticeDrill(), 'newcomer_drill', '_updateSetupPage must preserve selectedPracticeDrill');

    // Keyboard Down from Row 7 -> Row 8 (ballBox) -> Row 9 (Action Row)
    env.dispatchKey('ArrowDown');
    assert.equal(getPlayerFocusRow()[0], 8, 'ArrowDown from Row 7 moves focus to Row 8 (ballBox)');
    assert.ok(ballBox.querySelector(':scope > .ctrl-focus-pill'), 'Row 8 applies controller focus pill on ballBox');

    env.dispatchKey('ArrowDown');
    assert.equal(getPlayerFocusRow()[0], 9, 'ArrowDown from Row 8 moves focus to Row 9 (Action Row)');
    assert.ok(getBtnStartMatch().querySelector(':scope > .ctrl-focus-pill'), 'Row 9 applies controller focus pill on Start button');

    // Launching Practice passes newcomer_drill into onStartPractice without resetting to sandbox
    env.dispatchKey('Enter');
    assert.equal(practiceCalls.length, 1, 'Enter on Row 9 launches practice');
    assert.equal(practiceCalls[0].drill, 'newcomer_drill', 'onStartPractice receives selected newcomer_drill');
    assert.equal(getSelectedPracticeDrill(), 'newcomer_drill', 'launchMatchNow preserves selectedPracticeDrill');

    // Match fallback when selectedMatchBall === 'all' must fall back to 'medium', never 'random'
    setCurrentSetupMode('match');
    setMatchFormat('1v1');
    setSetupPage(2);
    setSelectedMatchBall('all');
    playerSetup.launchMatchNow();
    assert.equal(matchCalls.length, 1, 'Match launched');
    assert.equal(matchCalls[0].rules.ball, 'medium', 'Practice all ball choice falls back to medium in match mode');
  } finally {
    env.restore();
  }
});

test('Feature 16 & 17: practiceHud KEY B / SELECT copy, top-right offset, and stale copy removal', () => {
  const env = installTestEnv([]);
  try {
    // Feature 16: PRACTICE_DRILL_OPTIONS[0].desc and practiceHud render KEY B / SELECT and clear #hud (top:10px; left:12px)
    assert.ok(
      PRACTICE_DRILL_OPTIONS[0].desc.includes('Key B / Select'),
      'Sandbox drill description specifies Key B / Select',
    );
    assert.equal(
      PRACTICE_DRILL_OPTIONS[0].desc.includes('Press B / Select'),
      false,
      'Sandbox drill description removes ambiguous B / Select',
    );

    updatePracticeHud({ gameState: 'practice', isMenuOpen: false });
    const hudEl = env.dom.document.getElementById('practice-mode-hud');
    assert.ok(hudEl, 'practice-mode-hud element created');
    assert.ok(hudEl.innerHTML.includes('KEY B / SELECT'), 'practiceHud renders KEY B / SELECT');
    assert.equal(hudEl.style.cssText.includes('left: 14px'), false, 'practiceHud must not sit at left: 14px over #hud');
    assert.ok(hudEl.style.cssText.includes('right: 14px'), 'practiceHud positions at right: 14px clear of #hud');

    // Feature 17: tuning.js and constants.js remove v0.2.2 and 360 right-stick aim steering copy
    const stdTuning = TUNING.strike.assistPresets.standard;
    const casTuning = TUNING.strike.assistPresets.casual;
    const stdOpt = ASSIST_OPTIONS.find((o) => o.id === 'standard');
    const casOpt = ASSIST_OPTIONS.find((o) => o.id === 'casual');

    assert.equal(stdTuning.desc.includes('v0.2.2'), false, 'TUNING standard desc removes v0.2.2');
    assert.equal(stdOpt.desc.includes('v0.2.2'), false, 'ASSIST_OPTIONS standard desc removes v0.2.2');
    assert.equal(casTuning.desc.includes('aim steering'), false, 'TUNING casual desc removes aim steering');
    assert.equal(casOpt.desc.includes('aim steering'), false, 'ASSIST_OPTIONS casual desc removes aim steering');
    assert.equal(stdTuning.desc, stdOpt.desc, 'TUNING and ASSIST_OPTIONS standard desc match');
    assert.equal(casTuning.desc, casOpt.desc, 'TUNING and ASSIST_OPTIONS casual desc match');
  } finally {
    env.restore();
  }
});

test('Feature 18a: Unified P1-P4 kit colors on slot themes, viewport badges, controllerAssignment, and #camera-toast', () => {
  const env = installTestEnv([makePad(0), makePad(1)]);
  const prevGetGameState = viewportManager.getGameState;
  const prevGetAthletes = viewportManager.getAthletes;
  const prevGetHumanSlots = viewportManager.getActiveHumanSlots;
  const prevSplitscreen = TUNING.camera.splitscreen;

  try {
    // 1. Default slot themes use Home Red / Away Blue instead of Cyan/Coral
    const p1Default = getPlayerSlotTheme(0);
    const p2Default = getPlayerSlotTheme(1);
    const p3Default = getPlayerSlotTheme(2);
    const p4Default = getPlayerSlotTheme(3);
    assert.equal(PLAYER_SLOT_COLORS[0].name, 'Red', 'P1 default theme matches Home Red');
    assert.equal(PLAYER_SLOT_COLORS[1].name, 'Blue', 'P2 default theme matches Away Blue');
    assert.equal(p1Default.hex, p3Default.hex, 'P1 and P3 share Home Red kit hue');
    assert.equal(p2Default.hex, p4Default.hex, 'P2 and P4 share Away Blue kit hue');

    // 2. Teammates sharing a chosen kit color keep distinct P1 vs P3 slot labels on viewport badges
    const greenHex = 0x15803d;
    const p1BadgeHtml = renderViewportBadgeHtml(0, [0, 1, 2, 3], 'match', greenHex);
    const p3BadgeHtml = renderViewportBadgeHtml(2, [0, 1, 2, 3], 'match', greenHex);
    const readableGreen = readableOnDark(greenHex);
    assert.ok(p1BadgeHtml.includes(readableGreen), 'P1 badge uses readable chosen Green kit color');
    assert.ok(p3BadgeHtml.includes(readableGreen), 'P3 badge uses readable chosen Green kit color');
    assert.ok(p1BadgeHtml.includes('P1') && p1BadgeHtml.includes('TOP-LEFT SCREEN'), 'P1 badge keeps P1 + TOP-LEFT label');
    assert.ok(p3BadgeHtml.includes('P3') && p3BadgeHtml.includes('BOT-LEFT SCREEN'), 'P3 badge keeps P3 + BOT-LEFT label');
    assert.notEqual(p1BadgeHtml, p3BadgeHtml, 'P1 and P3 badges remain visually distinct');

    // 3. playerSetup live kit color sync across P1/P3 badges and controllerAssignment cards
    const rootEl = env.dom.document.createElement('div');
    rootEl.id = 'main-menu-root';
    env.dom.body.appendChild(rootEl);
    menuState.rootEl = rootEl;
    menuState.titleScreenEl = env.dom.document.createElement('div');
    menuState.titleScreenEl.style.display = 'none';

    buildPlayerSetupScreen(rootEl, {}, { showTitleScreen: () => {}, hidePlayerSetup: () => {} });
    buildControllerAssignmentScreen(rootEl, { onProceed: () => {}, onQuickStart: () => {}, onBack: () => {} });

    setCurrentSetupMode('match');
    setMatchFormat('2v2');
    setSetupPage(1);
    const cfgs = getPlayerConfigs();
    [0, 1, 2, 3].forEach((i) => { cfgs[i].type = 'human'; });
    cfgs[0].team = 'home';
    cfgs[1].team = 'away';
    cfgs[2].team = 'home';
    cfgs[3].team = 'away';
    setPlayerColor(0, 0x15803d);

    const vp1 = env.dom.document.getElementById('viewport-badge-p1');
    const vp3 = env.dom.document.getElementById('viewport-badge-p3');
    assert.ok(vp1.innerHTML.includes(readableGreen) && vp1.innerHTML.includes('P1'), 'P1 viewport badge updates to Green kit');
    assert.ok(vp3.innerHTML.includes(readableGreen) && vp3.innerHTML.includes('P3'), 'P3 teammate badge updates to Green kit');

    showControllerAssignment('2v2');
    const t1Col = env.dom.document.getElementById('col-team1');
    const t1Slots = env.dom.document.getElementById('team1-slots-container');
    assert.equal(t1Col.style.borderTop, `4px solid ${readableGreen}`, 'Controller Assignment Team 1 column uses chosen kit color');
    assert.ok(t1Slots.innerHTML.includes(readableGreen), 'Controller Assignment P1/P3 slot cards use chosen kit color');

    // 4. #camera-toast uses athlete's actual chosen primaryColor (readable), never hardcoded #ef4444 / #3b82f6
    TUNING.camera.splitscreen = true;
    viewportManager.getGameState = () => 'match';
    viewportManager.getAthletes = () => [
      { team: 'home', primaryColor: 0x0f172a },
      { team: 'away', primaryColor: 0xffd60a },
    ];
    viewportManager.getActiveHumanSlots = () => [0, 1];

    viewportManager.showCameraNotification(0, 'chase');
    const toastEl = env.dom.document.getElementById('camera-toast');
    const expectedP1Hex = getPlayerSlotTheme(0, 0x0f172a).hex;
    assert.ok(toastEl.innerHTML.includes(expectedP1Hex), 'P1 camera toast uses readable Black kit color');
    assert.equal(toastEl.innerHTML.includes('#ef4444'), false, 'P1 camera toast does not hardcode #ef4444');

    viewportManager.showCameraNotification(1, 'tactical');
    const expectedP2Hex = getPlayerSlotTheme(1, 0xffd60a).hex;
    assert.ok(toastEl.innerHTML.includes(expectedP2Hex), 'P2 camera toast uses Yellow kit color');
    assert.equal(toastEl.innerHTML.includes('#3b82f6'), false, 'P2 camera toast does not hardcode #3b82f6');
  } finally {
    viewportManager.getGameState = prevGetGameState;
    viewportManager.getAthletes = prevGetAthletes;
    viewportManager.getActiveHumanSlots = prevGetHumanSlots;
    TUNING.camera.splitscreen = prevSplitscreen;
    env.restore();
  }
});

test('Feature 18b: Colorblind-safe checkSwatchContrast and non-blocking #swatch-contrast-warning UI', () => {
  const env = installTestEnv([]);
  try {
    // 1. Unit contract for checkSwatchContrast
    assert.equal(checkSwatchContrast('#d90429', '#1d4ed8').ok, true, 'Default Red vs Blue passes contrast check');
    assert.equal(checkSwatchContrast('#d90429', '#ffd60a').ok, true, 'Red vs Yellow passes contrast check');
    assert.equal(checkSwatchContrast('#d90429', '#15803d').ok, false, 'Red vs Green warns for CVD confusion');
    assert.equal(checkSwatchContrast('#1d4ed8', '#8b5cf6').ok, false, 'Blue vs Purple warns for low separation');
    assert.equal(checkSwatchContrast('#f8fafc', '#ffd60a').ok, false, 'White vs Yellow warns for bright-on-bright');
    assert.equal(checkSwatchContrast('#0f172a', '#0f172a').ok, false, 'Identical colors warn');

    // 2. Non-blocking warning banner in playerSetup
    const rootEl = env.dom.document.createElement('div');
    rootEl.id = 'main-menu-root';
    env.dom.body.appendChild(rootEl);
    menuState.rootEl = rootEl;

    buildPlayerSetupScreen(rootEl, {}, { showTitleScreen: () => {}, hidePlayerSetup: () => {} });
    setCurrentSetupMode('match');
    setMatchFormat('1v1');
    setSetupPage(1);
    setPlayerTeam(0, 'home');
    setPlayerColor(0, 0xd90429);
    setPlayerColor(1, 0x15803d);

    const warnEl = env.dom.document.getElementById('swatch-contrast-warning');
    assert.ok(warnEl, 'swatch-contrast-warning element exists');
    assert.equal(warnEl.getAttribute('role'), 'status', 'Warning uses polite status role');
    assert.equal(warnEl.style.display, 'flex', 'Warning becomes visible for Red vs Green');
    assert.ok(warnEl.textContent.includes('RED') && warnEl.textContent.includes('GREEN'), 'Warning names both conflicting kit colors');
    assert.equal(getBtnNext().disabled, false, 'Contrast warning must never block Next button');

    // Advancing to Page 2 remains unblocked
    getBtnNext().click();
    assert.equal(playerSetup.setupPage, 2, 'User can still advance to Page 2 while warning is active');

    // Switching back to high-contrast Blue clears the warning
    setSetupPage(1);
    setPlayerColor(1, 0x1d4ed8);
    assert.equal(warnEl.style.display, 'none', 'Warning hides when contrast returns to safe Red vs Blue');
  } finally {
    env.restore();
  }
});

test('Feature 18c: Gamepad audio unlock triggers on first press without spamming or throwing if unlock absent', () => {
  const env = installTestEnv([]);
  const prevUnlock = soundManager.unlock;
  const prevUnlocked = soundManager.unlocked;

  try {
    const rootEl = env.dom.document.createElement('div');
    rootEl.id = 'main-menu-root';
    env.dom.body.appendChild(rootEl);
    menuState.rootEl = rootEl;
    menuState.titleScreenEl = env.dom.document.createElement('div');
    menuState.titleScreenEl.style.display = 'none';

    buildPlayerSetupScreen(rootEl, {}, { showTitleScreen: () => {}, hidePlayerSetup: () => {} });
    buildControllerAssignmentScreen(rootEl, { onProceed: () => {}, onQuickStart: () => {}, onBack: () => {} });

    let unlockCalls = 0;
    soundManager.unlocked = false;
    soundManager.unlock = () => {
      unlockCalls++;
      soundManager.unlocked = true;
      return true;
    };

    // 1. menuNavigation gamepad polling
    setMenuNavigationContext({ playerSetup });
    setCurrentSetupMode('practice');
    playerSetup.playerSetupEl.style.display = 'flex';
    startMenuGamepadPolling();

    // Idle pad -> no unlock call
    env.setPads([makePad(0, -1)]);
    env.runIntervals();
    assert.equal(unlockCalls, 0, 'Idle gamepad poll does not call soundManager.unlock');

    // First button press -> calls unlock once
    env.setPads([makePad(0, 14)]);
    env.runIntervals();
    assert.equal(unlockCalls, 1, 'First gamepad press calls soundManager.unlock once');

    // Held / subsequent presses after unlocked -> no repeat calls
    env.setPads([makePad(0, 14)]);
    env.runIntervals();
    env.setPads([makePad(0, 15)]);
    env.runIntervals();
    assert.equal(unlockCalls, 1, 'Held or already-unlocked presses do not spam unlock');

    // 2. pollAssignmentGamepads also unlocks on first press and tolerates missing soundManager.unlock
    stopSetupGamepadPolling();
    playerSetup.playerSetupEl.style.display = 'none';
    showControllerAssignment('1v1');
    const tracker = createMenuPadTracker();
    tracker.reset();

    unlockCalls = 0;
    soundManager.unlocked = false;
    const p0Idle = makePad(0, -1);
    tracker.update([p0Idle]);
    pollAssignmentGamepads([p0Idle], tracker);
    assert.equal(unlockCalls, 0, 'Assignment idle poll does not call unlock');

    const p0Press = makePad(0, 13);
    tracker.update([p0Press]);
    pollAssignmentGamepads([p0Press], tracker);
    assert.equal(unlockCalls, 1, 'Assignment first press calls unlock once');

    // Missing soundManager.unlock must not throw
    soundManager.unlocked = false;
    soundManager.unlock = undefined;
    const p0Release = makePad(0, -1);
    const p0Press2 = makePad(0, 12);
    tracker.update([p0Release]);
    tracker.update([p0Press2]);
    assert.doesNotThrow(() => {
      pollAssignmentGamepads([p0Press2], tracker);
    }, 'Optional chaining prevents throw when soundManager.unlock is absent');
  } finally {
    soundManager.unlock = prevUnlock;
    soundManager.unlocked = prevUnlocked;
    env.restore();
  }
});

test('viewportManager parity: applyViewportSize DPR scaling and showCameraNotification in 2P/4P practice', () => {
  const env = installTestEnv([]);
  const prevRenderer = viewportManager.renderer;
  const prevGetGameState = viewportManager.getGameState;
  const prevGetAthletes = viewportManager.getAthletes;
  const prevGetHumanSlots = viewportManager.getActiveHumanSlots;
  const prevSplitscreen = TUNING.camera.splitscreen;
  const prevPixelRatioPreset = TUNING.render.pixelRatioPreset;
  const prevCamModes = viewportManager.playerCameras.map((pc) => pc.mode);
  const prevCamAspects = viewportManager.playerCameras.map((pc) => pc.camera.aspect);

  try {
    let lastPixelRatio = null;
    let lastSize = null;
    viewportManager.renderer = {
      setPixelRatio(r) { lastPixelRatio = r; },
      setSize(w, h) { lastSize = { w, h }; },
    };
    env.windowMock.devicePixelRatio = 2;
    TUNING.camera.splitscreen = true;
    viewportManager.playerCameras.forEach((pc) => { pc.mode = 'chase'; });

    let curHumanSlots = [0, 1];
    let curAthletes = [
      { team: 'home', primaryColor: 0xd90429 },
      { team: 'away', primaryColor: 0x1d4ed8 },
    ];
    viewportManager.getGameState = () => 'practice';
    viewportManager.getAthletes = () => curAthletes;
    viewportManager.getActiveHumanSlots = () => curHumanSlots;

    // 1. 2P practice DPR scaling ('1.25' -> 1.0, '1.0' -> 0.85)
    TUNING.render.pixelRatioPreset = '1.25';
    viewportManager.applyViewportSize();
    assert.equal(lastPixelRatio, 1.0, '2P practice balanced preset caps DPR at 1.0');
    assert.deepEqual(lastSize, { w: 1280, h: 720 });
    assert.ok(Math.abs(viewportManager.playerCameras[0].camera.aspect - (640 / 720)) < 1e-5, '2P practice sets half-width aspect');

    TUNING.render.pixelRatioPreset = '1.0';
    viewportManager.applyViewportSize();
    assert.equal(lastPixelRatio, 0.85, '2P practice low preset scales DPR to 0.85');

    // 2. 4P practice quad DPR scaling ('1.25' -> 0.85, 'native' -> 1.0)
    curHumanSlots = [0, 1, 2, 3];
    curAthletes = [
      { team: 'home', primaryColor: 0xd90429 },
      { team: 'away', primaryColor: 0x1d4ed8 },
      { team: 'home', primaryColor: 0xd90429 },
      { team: 'away', primaryColor: 0x1d4ed8 },
    ];
    TUNING.render.pixelRatioPreset = '1.25';
    viewportManager.applyViewportSize();
    assert.equal(lastPixelRatio, 0.85, '4P practice quad balanced preset caps DPR at 0.85');

    TUNING.render.pixelRatioPreset = 'native';
    viewportManager.applyViewportSize();
    assert.equal(lastPixelRatio, 1.0, '4P practice quad native preset caps DPR at 1.0');

    // 3. showCameraNotification in 2P practice (Px prefix + 25% / 75%)
    curHumanSlots = [0, 1];
    curAthletes = curAthletes.slice(0, 2);
    viewportManager.showCameraNotification(0, 'chase');
    const toast = env.dom.document.getElementById('camera-toast');
    assert.ok(toast.innerHTML.includes('P1'), '2P practice camera toast includes P1 prefix');
    assert.equal(toast.style.left, '25%', '2P practice P1 camera toast anchors at 25%');
    assert.equal(toast.style.top, '', '2P practice P1 camera toast clears top offset');

    viewportManager.showCameraNotification(1, 'tactical');
    assert.ok(toast.innerHTML.includes('P2'), '2P practice camera toast includes P2 prefix');
    assert.equal(toast.style.left, '75%', '2P practice P2 camera toast anchors at 75%');
    assert.equal(toast.style.top, '', '2P practice P2 camera toast clears top offset');

    // 4. showCameraNotification in 4P practice quad (Px prefix + 25%/75% and 8%/58%)
    curHumanSlots = [0, 1, 2, 3];
    curAthletes = [
      { team: 'home', primaryColor: 0xd90429 },
      { team: 'away', primaryColor: 0x1d4ed8 },
      { team: 'home', primaryColor: 0xd90429 },
      { team: 'away', primaryColor: 0x1d4ed8 },
    ];
    const expectedQuad = [
      { slot: 0, label: 'P1', left: '25%', top: '8%' },
      { slot: 1, label: 'P2', left: '75%', top: '8%' },
      { slot: 2, label: 'P3', left: '25%', top: '58%' },
      { slot: 3, label: 'P4', left: '75%', top: '58%' },
    ];
    for (const q of expectedQuad) {
      viewportManager.showCameraNotification(q.slot, 'chase');
      assert.ok(toast.innerHTML.includes(q.label), `4P practice camera toast includes ${q.label}`);
      assert.equal(toast.style.left, q.left, `4P practice ${q.label} camera toast left=${q.left}`);
      assert.equal(toast.style.top, q.top, `4P practice ${q.label} camera toast top=${q.top}`);
    }
  } finally {
    viewportManager.renderer = prevRenderer;
    viewportManager.getGameState = prevGetGameState;
    viewportManager.getAthletes = prevGetAthletes;
    viewportManager.getActiveHumanSlots = prevGetHumanSlots;
    TUNING.camera.splitscreen = prevSplitscreen;
    TUNING.render.pixelRatioPreset = prevPixelRatioPreset;
    viewportManager.playerCameras.forEach((pc, idx) => {
      pc.mode = prevCamModes[idx];
      pc.camera.aspect = prevCamAspects[idx];
    });
    env.restore();
  }
});

test('Regression Bug 7: cycleArenaCameraView treats sports mode as shared fullscreen view before cycling', () => {
  const env = installTestEnv([]);
  const prevRenderer = viewportManager.renderer;
  const prevGetGameState = viewportManager.getGameState;
  const prevGetAthletes = viewportManager.getAthletes;
  const prevGetHumanSlots = viewportManager.getActiveHumanSlots;
  const prevSplitscreen = TUNING.camera.splitscreen;
  const prevCamModes = viewportManager.playerCameras.map((pc) => pc.mode);

  try {
    viewportManager.renderer = {
      setPixelRatio() {},
      setSize() {},
    };
    TUNING.camera.splitscreen = true;
    viewportManager.getGameState = () => 'match';
    viewportManager.getAthletes = () => [
      { isEnabled: true, team: 'home', primaryColor: 0xd90429 },
      { isEnabled: true, team: 'away', primaryColor: 0x1d4ed8 },
    ];
    viewportManager.getActiveHumanSlots = () => [0, 1];

    // Both players start in shared 'sports' camera mode
    viewportManager.playerCameras[0].setMode('sports', false);
    viewportManager.playerCameras[1].setMode('sports', false);

    // Cycling forward (+1) from shared 'sports' must cycle both slots to 'broadcast', not force 'tactical' splitscreen
    viewportManager.cycleArenaCameraView(0, 1);
    assert.equal(viewportManager.playerCameras[0].mode, 'broadcast', 'P1 cycles from shared sports to broadcast');
    assert.equal(viewportManager.playerCameras[1].mode, 'broadcast', 'P2 stays synced on shared broadcast');

    // Cycling backward (-1) from 'broadcast' moves P1 to 'tactical' and leaves shared view for P2
    viewportManager.cycleArenaCameraView(0, -1);
    assert.equal(viewportManager.playerCameras[0].mode, 'tactical', 'P1 cycles back to tactical');
    assert.notEqual(viewportManager.playerCameras[1].mode, 'broadcast', 'P2 leaves shared broadcast');
  } finally {
    viewportManager.renderer = prevRenderer;
    viewportManager.getGameState = prevGetGameState;
    viewportManager.getAthletes = prevGetAthletes;
    viewportManager.getActiveHumanSlots = prevGetHumanSlots;
    TUNING.camera.splitscreen = prevSplitscreen;
    viewportManager.playerCameras.forEach((pc, idx) => {
      pc.mode = prevCamModes[idx];
    });
    env.restore();
  }
});
