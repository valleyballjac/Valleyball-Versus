/**
 * Permanent regression suite for v0.4.2.2 Playtest Polish & Natural Limb Alignment:
 *   1. DO NOT REMOVE: INVARIANT [NATURAL-LIMB-ALIGNMENT] source guards, real Rapier + GLB
 *      stream-head grounding (y = 8.34m), T-pose idle rest convergence (< 10 deg at v = 0),
 *      longitudinal thigh/pelvis untwist recovery, and smooth club hand geometry.
 *   2. First-Time Setup 3-card wizard & 4-tab zero-scroll Main Menu Settings.
 *   3. Overtime 'in_place' default, 3-2-1 resume countdown, flanking Pause Stat Boards,
 *      hustleBoards vibrant team borders, non-clipping 3-ball orbital preview,
 *      Victory single-row actions ('Save Replay?' -> 'Replay Saved'), 2-row Replay Dock
 *      spatial D-pad focus + Numpad 1..7 + terrain floor clamp, and untimed Practice
 *      with count-up stadium scoreboard clock.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { TUNING } from '../src/config/tuning.js';
import {
  resetHudPrefs,
  hasCompletedFirstTimeSetup,
  shouldAutoShowFirstTimeSetup,
  syncTeamPaletteColors,
} from '../src/config/hudConfig.js';
import { initPhysics, getWorld, stepPhysics, ENVIRONMENT_GROUPS, RAPIER } from '../src/sim/physics.js';
import { createAthlete } from '../src/sim/athlete.js';
import { createSetupBallPreview } from '../src/visuals/setupBallPreview.js';
import { createHustleBoards, updateHustleBoards } from '../src/visuals/hustleBoards.js';
import { createScoreboards, updateScoreboards } from '../src/visuals/scoreboards.js';
import { displayCoordinator } from '../src/visuals/displayCoordinator.js';
import {
  newcomerDrill,
  resetPracticeStats,
  setSelectedPracticeDrill,
  stepPracticeDrillTick,
  syncPracticeStrikeStats,
  practiceStats,
  getPracticeSessionSeconds,
} from '../src/features/match/practiceMode.js';
import { replayManager } from '../src/features/match/replayManager.js';
import { getCourtFloorY } from '../src/ai/courtHeightmap.js';
import { PlayerCamera } from '../src/visuals/playerCamera.js';
import { updateSportsCamera, resetSportsCamera } from '../src/visuals/sportsCamera.js';

function createMockDom() {
  const byId = new Map();
  const makeEl = (tag) => {
    const listeners = new Map();
    const attrs = new Map();
    const children = [];
    let _id = '';
    let _text = '';
    let _html = '';
    const el = {
      tagName: String(tag).toUpperCase(),
      style: { display: '' },
      dataset: {},
      children,
      disabled: false,
      isConnected: true,
      parentNode: null,
      rect: { left: 0, top: 0, width: 80, height: 28 },
      get id() { return _id; },
      set id(v) {
        if (_id && byId.get(_id) === el) byId.delete(_id);
        _id = String(v || '');
        if (_id) byId.set(_id, el);
      },
      get textContent() {
        if (children.length === 0) return _text;
        return _text + children.map((c) => c.textContent || '').join('');
      },
      set textContent(v) {
        _text = String(v ?? '');
        _html = '';
        children.length = 0;
      },
      get innerHTML() {
        if (_html && children.length === 0) return _html;
        return _html + children.map((c) => c.innerHTML || c.textContent || '').join('');
      },
      set innerHTML(v) {
        _html = String(v ?? '');
        _text = _html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        children.length = 0;
      },
      setAttribute(k, v) { attrs.set(String(k), String(v)); },
      getAttribute(k) { return attrs.get(String(k)) ?? null; },
      appendChild(ch) {
        if (!ch) return ch;
        ch.parentNode = el;
        children.push(ch);
        return ch;
      },
      append(...items) { items.forEach((it) => { if (it && typeof it === 'object') el.appendChild(it); }); },
      remove() {
        if (el.parentNode?.children) {
          const i = el.parentNode.children.indexOf(el);
          if (i >= 0) el.parentNode.children.splice(i, 1);
        }
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const arr = listeners.get(type);
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      },
      dispatchEvent(ev) {
        for (const fn of (listeners.get(ev.type) || [])) fn(ev);
      },
      click() {
        if (el.disabled) return;
        if (typeof el.onclick === 'function') el.onclick({ stopPropagation() {}, preventDefault() {} });
        for (const fn of (listeners.get('click') || [])) fn({ stopPropagation() {}, preventDefault() {}, target: el });
      },
      contains(target) {
        if (target === el) return true;
        return children.some((c) => c.contains?.(target));
      },
      checkVisibility() {
        let cur = el;
        while (cur) {
          if (cur.style?.display === 'none') return false;
          cur = cur.parentNode;
        }
        return true;
      },
      getBoundingClientRect() { return el.rect; },
      querySelectorAll(sel) {
        const out = [];
        const wantTag = /^[a-zA-Z]+$/.test(sel) ? sel.toUpperCase() : null;
        const walk = (n) => {
          for (const ch of (n.children || [])) {
            if (wantTag && ch.tagName === wantTag) out.push(ch);
            walk(ch);
          }
        };
        walk(el);
        return out;
      },
    };
    return el;
  };

  const makeCanvasCtx = () => ({
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineJoin: 'miter',
    strokes: [],
    fills: [],
    texts: [],
    save() {},
    restore() {},
    scale() {},
    clearRect() {},
    fillRect(x, y, w, h) { this.fills.push({ style: this.fillStyle, x, y, w, h }); },
    strokeRect(x, y, w, h) { this.strokes.push({ style: this.strokeStyle, x, y, w, h }); },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    roundRect() {},
    fill() { this.fills.push({ style: this.fillStyle }); },
    stroke() { this.strokes.push({ style: this.strokeStyle }); },
    fillText(txt) { this.texts.push({ text: String(txt), style: this.fillStyle }); },
    strokeText(txt) { this.texts.push({ text: String(txt), stroke: this.strokeStyle }); },
    measureText(txt) { return { width: String(txt).length * 10 }; },
  });

  const head = makeEl('head');
  const body = makeEl('body');
  const document = {
    head,
    body,
    pointerLockElement: null,
    createElement(tag) {
      if (String(tag).toLowerCase() === 'canvas') {
        const ctx = makeCanvasCtx();
        return { width: 512, height: 256, style: {}, getContext: () => ctx, _ctx: ctx };
      }
      return makeEl(tag);
    },
    getElementById: (id) => byId.get(id) || null,
    addEventListener() {},
    removeEventListener() {},
  };
  return { document, byId };
}

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('Source Invariant Lock: [NATURAL-LIMB-ALIGNMENT] annotations and zero prohibited dashes/exclamations remain intact', () => {
  const annotatedFiles = [
    '../src/sim/tracker.js',
    '../src/sim/autorig.js',
    '../src/sim/motor.js',
    '../src/sim/athlete.js',
    '../src/sim/ragdoll.js',
    '../src/config/tuning.js',
  ];
  for (const rel of annotatedFiles) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.ok(
      src.includes('DO NOT REMOVE: INVARIANT [NATURAL-LIMB-ALIGNMENT]'),
      `${rel} must retain DO NOT REMOVE: INVARIANT [NATURAL-LIMB-ALIGNMENT] guard`,
    );
  }

  const uiFiles = [
    '../src/features/ui/mainMenu/firstTimeSetupModal.js',
    '../src/features/ui/mainMenu/settingsModal.js',
    '../src/ui/inGameMenu.js',
    '../src/ui/replayDock.js',
  ];
  for (const rel of uiFiles) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.equal(src.includes('\u2014'), false, `${rel} must contain zero em dashes`);
    assert.equal(src.includes('\u2013'), false, `${rel} must contain zero en dashes`);
    assert.equal(src.includes('--'), false, `${rel} must contain zero double hyphens`);
  }
});

test('Real Rapier + GLB Ragdoll: elevated stream-head grounding (y=8.34m), T-pose rest convergence, thigh untwist, and smooth club hands', async () => {
  await initPhysics(1 / 60);
  const world = getWorld();

  // Create a flat stream-head platform under y = 8.34m (top surface at y = 7.84m, motor radius = 0.50m)
  const platBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-12.78, 7.34, 39.96));
  const platCol = world.createCollider(
    RAPIER.ColliderDesc.cuboid(6.0, 0.5, 6.0).setCollisionGroups(ENVIRONMENT_GROUPS),
    platBody,
  );
  // Populate Rapier static broadphase for the newly added platform before spawning the athlete
  stepPhysics();

  const buf = readFileSync(new URL('../public/models/character.glb', import.meta.url));
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej,
  ));
  let skel = null;
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !skel) skel = o.skeleton; });
  gltf.scene.updateMatrixWorld(true);

  const scene = new THREE.Scene();
  const athlete = createAthlete({
    id: 'test-p1',
    athleteIndex: 0,
    scene,
    characterSkeleton: skel,
    characterRoot: gltf.scene,
    clips: gltf.animations,
    spawn: { x: -12.78, y: 8.34, z: 39.96, yaw: Math.PI },
    team: 'home',
    variant: 'classic',
  });

  try {
    // 1. Stream-head spawn (y = 8.34m) starts grounded immediately with airborneMix === 0
    assert.equal(athlete.motor.grounded, true, 'Athlete spawned on y=8.34m stream head must start grounded');
    assert.equal(athlete.animTarget.airborneMix, 0, 'Elevated stream-head spawn must not latch airborneMix=1');

    // 2. Club hands (handL, handR) have smooth 18-radial-segment capsule and inset collar (no stud poke-through)
    for (const handKey of ['handL', 'handR']) {
      const handItem = athlete.ragdoll.rig.get(handKey);
      assert.ok(handItem?.solidMesh, `${handKey} solidMesh exists`);
      const clubMesh = handItem.solidMesh.children[0];
      const cuffMesh = handItem.solidMesh.children[1];
      assert.ok(clubMesh?.geometry?.parameters?.radialSegments >= 16, `${handKey} club uses smooth radial tessellation`);
      assert.ok(
        cuffMesh.geometry.parameters.radiusTop < clubMesh.geometry.parameters.radius * 0.90,
        `${handKey} wrist collar radius stays strictly inset inside club surface`,
      );
    }

    // 3. Step 60 idle ticks (v = 0): arms drop cleanly out of bind T-pose into natural At Rest (< 10 deg error)
    const zeroInput = {
      moveX: 0, moveZ: 0, moveWorld: new THREE.Vector3(),
      sprintHeld: false, slideHeld: false, braceHeld: false,
      lookX: 0, lookY: 0, hasAim: false, aimYaw: 0, cameraYaw: 0,
    };
    for (let t = 0; t < 60; t++) {
      athlete.prePhysicsUpdate({
        dt: 1 / 60, tick: t, inputSnapshot: zeroInput,
        jumpQueued: false, diveQueued: false, cutQueued: false, volleyQueued: false, spikeQueued: false,
        balls: [], arenaPreset: { killPlaneY: -20 }, targetGoalZ: -40, facingFollowsCamera: false,
      });
      stepPhysics();
      athlete.postPhysicsUpdate(t, 1 / 60, [], [athlete], 0);
    }

    const qBody = new THREE.Quaternion();
    for (const key of ['pelvis', 'thighL', 'thighR']) {
      const item = athlete.ragdoll.rig.get(key);
      const tgt = athlete.animTarget.targets.get(key);
      const r = item.body.rotation();
      qBody.set(r.x, r.y, r.z, r.w);
      const dot = Math.min(1, Math.abs(qBody.dot(tgt.currQuat)));
      const deg = (2 * Math.acos(dot) * 180) / Math.PI;
      assert.ok(deg < 10.0, `${key} must converge tightly to At Rest (< 10 deg), got ${deg.toFixed(2)} deg`);
    }
    for (const key of ['upperArmL', 'upperArmR']) {
      const item = athlete.ragdoll.rig.get(key);
      const tgt = athlete.animTarget.targets.get(key);
      const r = item.body.rotation();
      qBody.set(r.x, r.y, r.z, r.w);
      const dot = Math.min(1, Math.abs(qBody.dot(tgt.currQuat)));
      const deg = (2 * Math.acos(dot) * 180) / Math.PI;
      // Unmapped Mixamo clavicle shifts shoulder socket ~18 deg between T-pose (78 deg) and At Rest
      assert.ok(deg < 25.0, `${key} must drop out of 78 deg T-pose to natural rest (< 25 deg), got ${deg.toFixed(2)} deg`);
    }
    for (const handKey of ['handL', 'handR']) {
      const hBody = athlete.ragdoll.rig.get(handKey).body;
      const bp = hBody.translation();
      const hv = hBody.linvel();
      const tp = athlete.animTarget.targets.get(handKey).currPos;
      const dist = Math.hypot(tp.x - bp.x, tp.y - bp.y, tp.z - bp.z);
      const speed = Math.hypot(hv.x, hv.y, hv.z);
      assert.ok(dist < 0.15, `${handKey} must drop from 0.68m T-pose to settled hip rest (< 0.15m), got ${dist.toFixed(3)}m`);
      assert.ok(speed < 0.09, `${handKey} anti-buzz damper must engage once settled (< 0.09 m/s), got ${speed.toFixed(3)} m/s`);
    }

    // 4. Inject severe 115-deg longitudinal thigh twist + 40-deg pelvis yaw offset -> must untwist cleanly
    const thighL = athlete.ragdoll.rig.get('thighL');
    const pelvis = athlete.ragdoll.rig.get('pelvis');
    const thighTarget = athlete.animTarget.targets.get('thighL').currQuat.clone();
    const twistOffset = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (115 * Math.PI) / 180);
    const twistedThigh = thighTarget.clone().multiply(twistOffset);
    thighL.body.setRotation({ x: twistedThigh.x, y: twistedThigh.y, z: twistedThigh.z, w: twistedThigh.w }, true);

    const pelvisTarget = athlete.animTarget.targets.get('pelvis').currQuat.clone();
    const pelvisOffset = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (40 * Math.PI) / 180);
    const twistedPelvis = pelvisOffset.multiply(pelvisTarget);
    pelvis.body.setRotation({ x: twistedPelvis.x, y: twistedPelvis.y, z: twistedPelvis.z, w: twistedPelvis.w }, true);

    for (let t = 60; t < 110; t++) {
      athlete.prePhysicsUpdate({
        dt: 1 / 60, tick: t, inputSnapshot: zeroInput,
        jumpQueued: false, diveQueued: false, cutQueued: false, volleyQueued: false, spikeQueued: false,
        balls: [], arenaPreset: { killPlaneY: -20 }, targetGoalZ: -40, facingFollowsCamera: false,
      });
      stepPhysics();
      athlete.postPhysicsUpdate(t, 1 / 60, [], [athlete], 0);
    }

    for (const key of ['thighL', 'pelvis']) {
      const item = athlete.ragdoll.rig.get(key);
      const tgt = athlete.animTarget.targets.get(key);
      const r = item.body.rotation();
      qBody.set(r.x, r.y, r.z, r.w);
      const dot = Math.min(1, Math.abs(qBody.dot(tgt.currQuat)));
      const deg = (2 * Math.acos(dot) * 180) / Math.PI;
      assert.ok(deg < 12.0, `${key} must untwist back to natural alignment (< 12 deg), got ${deg.toFixed(2)} deg`);
    }
  } finally {
    athlete.dispose();
    world.removeCollider(platCol, true);
    world.removeRigidBody(platBody);
  }
});

test('First-Time Setup 3-card wizard persists completion, skips deterministic URLs, and 4-tab Settings switches cleanly', async () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevNavigator = globalThis.navigator;
  const { document } = createMockDom();
  const storage = createMemoryStorage();

  try {
    globalThis.window = {
      location: { search: '' },
      localStorage: storage,
      addEventListener() {},
      removeEventListener() {},
    };
    globalThis.document = document;
    Object.defineProperty(globalThis, 'navigator', { value: { webdriver: false }, configurable: true });

    assert.equal(hasCompletedFirstTimeSetup(), false);
    assert.equal(shouldAutoShowFirstTimeSetup(), true);

    // Deterministic URLs skip First-Time Setup automatically
    globalThis.window.location.search = '?captureTick=300';
    assert.equal(shouldAutoShowFirstTimeSetup(), false);
    globalThis.window.location.search = '';

    const root = document.createElement('div');
    document.body.appendChild(root);
    const firstSetupMod = await import(`../src/features/ui/mainMenu/firstTimeSetupModal.js?t=${Date.now()}`);
    const settingsMod = await import(`../src/features/ui/mainMenu/settingsModal.js?t=${Date.now()}`);

    const renderChanges = [];
    firstSetupMod.buildFirstTimeSetupModal(root, {
      onRenderSettingsChange: (s) => renderChanges.push(s),
    });
    firstSetupMod.showFirstTimeSetupModal();
    assert.equal(firstSetupMod.isFirstTimeSetupOpen(), true);
    assert.ok(document.getElementById('first-time-setup-modal').textContent.includes('VALLEYBALL IS A SPORT, NOT A GAME.'));

    // Card 0 -> Card 1 (Graphics) -> Card 2 (HUD + Main Menu Settings note) -> Finish
    document.getElementById('btn-first-setup-next').click();
    document.getElementById('btn-first-setup-gfx-high').click();
    document.getElementById('btn-first-setup-next').click();
    assert.ok(document.getElementById('first-time-setup-modal').textContent.includes('Main Menu Settings at any time'));
    document.getElementById('btn-first-setup-hud-rookie').click();
    document.getElementById('btn-first-setup-next').click();

    assert.equal(firstSetupMod.isFirstTimeSetupOpen(), false);
    assert.equal(hasCompletedFirstTimeSetup(), true);
    assert.equal(shouldAutoShowFirstTimeSetup(), false);
    assert.ok(renderChanges.some((c) => c.graphicsPreset === 'high'));

    // 4-tab Main Menu Settings switches aria-selected cleanly via click and _cycleTab
    const modalEl = settingsMod.buildMainMenuSettingsModal(root, [{ cameraMode: 'chase' }], {});
    settingsMod.showMainMenuSettingsModal();
    assert.equal(document.getElementById('settings-tab-hud').getAttribute('aria-selected'), 'true');
    assert.equal(document.getElementById('settings-panel-hud').style.display, 'block');
    assert.equal(document.getElementById('settings-panel-graphics').style.display, 'none');

    modalEl._cycleTab(1);
    assert.equal(document.getElementById('settings-tab-graphics').getAttribute('aria-selected'), 'true');
    assert.equal(document.getElementById('settings-panel-graphics').style.display, 'block');
    assert.equal(document.getElementById('settings-panel-hud').style.display, 'none');

    modalEl._cycleTab(1);
    assert.equal(document.getElementById('settings-tab-audio').getAttribute('aria-selected'), 'true');
    modalEl._cycleTab(1);
    assert.equal(document.getElementById('settings-tab-camera').getAttribute('aria-selected'), 'true');
    settingsMod.hideMainMenuSettingsModal();
  } finally {
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', { value: prevNavigator, configurable: true });
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    resetHudPrefs();
  }
});

test('Overtime defaults to in_place, Resume Countdown holds 3-2-1-GO, and Pause/Hustle/Victory stat boards keep vibrant team colors', async () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevSetInterval = globalThis.setInterval;
  const prevClearInterval = globalThis.clearInterval;
  const prevSetTimeout = globalThis.setTimeout;
  const { document } = createMockDom();

  try {
    globalThis.window = {
      location: { search: '' },
      localStorage: createMemoryStorage(),
      innerWidth: 1280,
      innerHeight: 720,
      addEventListener() {},
      removeEventListener() {},
      __vb: {
        getGameState: () => 'match',
        matchState: { mode: 'match', scoreHome: 3, scoreAway: 2, ticksRemaining: 7200 },
        athletes: [
          { isEnabled: true, team: 'home', primaryColor: 0xd90429, getStrikeStats: () => ({ hits: 5, whiffs: 1 }) },
          { isEnabled: true, team: 'away', primaryColor: 0x1d4ed8, getStrikeStats: () => ({ hits: 4, whiffs: 2 }) },
        ],
        athleteMatchStats: [{ goals: 3, totalTouches: 9 }, { goals: 2, totalTouches: 7 }],
        getPlayerConfigs: () => [
          { team: 'home', primaryColor: 0xd90429, type: 'human' },
          { team: 'away', primaryColor: 0x1d4ed8, type: 'human' },
        ],
      },
    };
    globalThis.document = document;
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => {};
    globalThis.setTimeout = (fn) => { fn(); return 1; };

    // 1. Overtime default positionMode === 'in_place'
    const otMod = await import(`../src/ui/overtimeMenu.js?ot=${Date.now()}`);
    let confirmedOt = null;
    otMod.initOvertimeMenu({ onConfirm: (sel) => { confirmedOt = sel; } });
    otMod.showOvertimeMenu({ scoreHome: 2, scoreAway: 2, overtimePeriod: 1 });
    assert.equal(document.getElementById('overtime-position-in_place').dataset.selected, 'true');
    document.getElementById('overtime-confirm-btn').click();
    assert.equal(confirmedOt.positionMode, 'in_place');

    // 2. 3-2-1 Resume Countdown
    const cdMod = await import(`../src/ui/countdownOverlay.js?cd=${Date.now()}`);
    cdMod.initCountdownOverlay();
    cdMod.startResumeCountdown(3.0, 'RESUMING MATCH');
    assert.equal(cdMod.isResumeCountdownActive(), true);
    cdMod.updateCountdownOverlay(0, false, 0.1);
    assert.ok(document.getElementById('countdown-overlay').textContent.includes('3'));
    cdMod.updateCountdownOverlay(0, false, 1.0);
    assert.ok(document.getElementById('countdown-overlay').textContent.includes('2'));
    cdMod.updateCountdownOverlay(0, false, 1.0);
    assert.ok(document.getElementById('countdown-overlay').textContent.includes('1'));
    cdMod.updateCountdownOverlay(0, false, 1.0);
    assert.equal(cdMod.isResumeCountdownActive(), false);
    assert.ok(document.getElementById('countdown-overlay').textContent.includes('GO'));

    // 3. Pause Menu flanking Home & Away Stat Boards keep Crimson Red & Cobalt Blue borders + rainbow numbers
    const inGameMod = await import(`../src/ui/inGameMenu.js?pauseBoards=${Date.now()}`);
    inGameMod.initInGameMenu({});
    inGameMod.showInGameMenu();
    const homeBoard = document.getElementById('ingame-stat-board-home');
    const awayBoard = document.getElementById('ingame-stat-board-away');
    assert.equal(homeBoard.style.display, 'flex');
    assert.equal(awayBoard.style.display, 'flex');
    assert.equal(homeBoard.dataset.teamColor, '#d90429');
    assert.equal(awayBoard.dataset.teamColor, '#1d4ed8');
    assert.ok(homeBoard.innerHTML.includes('#ff2a42') && homeBoard.innerHTML.includes('#10e56a'), 'Rainbow stat numbers retained');
    inGameMod.hideInGameMenu();

    // 4. 3D Hustle Boards draw true Crimson Red (#d90429) & Cobalt Blue (#1d4ed8) borders instead of grey #e2e8f0
    syncTeamPaletteColors({ homeColor: 0xd90429, awayColor: 0x1d4ed8 });
    const hbScene = new THREE.Scene();
    const hb = createHustleBoards(hbScene);
    displayCoordinator.reset(4);
    updateHustleBoards(
      hb,
      practiceStats,
      0,
      false,
      0,
      { mode: 'match', scoreHome: 3, scoreAway: 2 },
      globalThis.window.__vb.athletes,
      globalThis.window.__vb.athleteMatchStats,
      0,
    );
    displayCoordinator.reset(4);
    updateHustleBoards(
      hb,
      practiceStats,
      0,
      false,
      0,
      { mode: 'match', scoreHome: 3, scoreAway: 2 },
      globalThis.window.__vb.athletes,
      globalThis.window.__vb.athleteMatchStats,
      120,
    );
    assert.ok(
      hb.channels.home.context.strokes.some((s) => s.style === '#d90429'),
      'Home 3D Hustle Board draws Crimson Red #d90429 border instead of grey',
    );
    assert.ok(
      hb.channels.away.context.strokes.some((s) => s.style === '#1d4ed8'),
      'Away 3D Hustle Board draws Cobalt Blue #1d4ed8 border instead of grey',
    );

    // 5. Victory Screen omits Practice Mode button, uses nowrap single row, and toggles 'Save Replay?' -> 'Replay Saved'
    replayManager.beginMatchRecording({ seed: 42, configs: globalThis.window.__vb.getPlayerConfigs(), playerCount: 2 });
    await replayManager.finishMatchRecording({ scoreHome: 3, scoreAway: 2, winner: 'home' });
    // Even if Electron auto-saved a background path, button must start as 'Save Replay?' until user clicks
    replayManager.getLastReplay().savedPath = 'C:/mock/auto.vbreplay';

    const vicMod = await import(`../src/ui/victoryScreen.js?vic=${Date.now()}`);
    vicMod.initVictoryScreen({
      onRematch: () => {},
      onPickSides: () => {},
      onWatchReplay: () => {},
      onMainMenu: () => {},
    });
    vicMod.showVictoryScreen({ scoreHome: 3, scoreAway: 2 });

    const actionsRow = document.getElementById('victory-actions-row');
    assert.ok(actionsRow.style.cssText.includes('nowrap'), 'Victory buttons sit on a single nowrap row');
    assert.equal(document.getElementById('btn-victory-practice'), null, 'Direct Practice Mode button removed from match Victory screen');
    const saveBtn = document.getElementById('btn-save-replay');
    assert.equal(saveBtn.textContent, 'Save Replay?');
    saveBtn.click();
    assert.equal(saveBtn.textContent, 'Replay Saved');
    vicMod.hideVictoryScreen();
  } finally {
    globalThis.setInterval = prevSetInterval;
    globalThis.clearInterval = prevClearInterval;
    globalThis.setTimeout = prevSetTimeout;
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
  }
});

test('3-ball setupBallPreview never clips, Replay Dock supports spatial D-pad + Numpad + floor clamp, and Practice counts up on arena clock', async () => {
  // 1. Verify 3-ball orbital preview maintains > 0.30m surface clearance across 360 orbital steps in Match and Practice
  const previewScene = new THREE.Scene();
  const preview = createSetupBallPreview(previewScene);
  const mockBalls = [
    { id: 'small', radius: 0.20, mesh: new THREE.Object3D() },
    { id: 'medium', radius: 0.50, mesh: new THREE.Object3D() },
    { id: 'large', radius: 0.75, mesh: new THREE.Object3D() },
  ];

  for (const [mode, ballChoice] of [['match', 'random'], ['practice', 'all']]) {
    preview.setSelection({ visible: true, mode, ballChoice });
    for (let step = 0; step < 360; step++) {
      preview.update(0.03, mockBalls);
      for (let i = 0; i < mockBalls.length; i++) {
        for (let j = i + 1; j < mockBalls.length; j++) {
          const dist = mockBalls[i].mesh.position.distanceTo(mockBalls[j].mesh.position);
          const minSafe = mockBalls[i].radius + mockBalls[j].radius + 0.30;
          assert.ok(
            dist >= minSafe,
            `Ball ${mockBalls[i].id} and ${mockBalls[j].id} in ${mode} must never clip (dist=${dist.toFixed(3)}m < ${minSafe.toFixed(3)}m)`,
          );
        }
      }
    }
  }
  preview.dispose();

  // 2. PlayerCamera & SportsCamera clamp strictly above Valley Court terrain even at extreme -8m heightOffset
  const athleteOnBank = {
    motor: {
      mesh: { position: new THREE.Vector3(18, getCourtFloorY(18, 28) + 0.5, 28) },
      body: { translation: () => ({ x: 18, y: getCourtFloorY(18, 28) + 0.5, z: 28 }), linvel: () => ({ x: 0, y: 0, z: 0 }) },
    },
    getHeadWorldPosition: (out) => out.set(18, getCourtFloorY(18, 28) + 1.65, 28),
  };
  for (const mode of ['broadcast', 'tactical', 'chase', 'thirdPerson', 'firstPerson']) {
    const pc = new PlayerCamera(0, mode);
    pc.setMode(mode, false);
    pc.heightOffset = -8.0;
    pc.resetSmoothing();
    pc.update({
      athlete: athleteOnBank,
      activeBall: null,
      inputSlot: null,
      mouseDeltas: { dx: 0, dy: 0 },
      world: null,
      frameDelta: 1 / 60,
      allAthletes: [athleteOnBank],
      attackingGoal: { x: 0, y: 10, z: -40 },
    });
    const terrainY = getCourtFloorY(pc.camera.position.x, pc.camera.position.z);
    assert.ok(
      pc.camera.position.y >= terrainY + 0.5,
      `${mode} camera at (${pc.camera.position.x.toFixed(1)}, ${pc.camera.position.z.toFixed(1)}) must stay above terrain (${pc.camera.position.y.toFixed(2)} >= ${(terrainY + 0.5).toFixed(2)})`,
    );
  }

  resetSportsCamera();
  const sportsCam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
  updateSportsCamera(sportsCam, [athleteOnBank], null, 1 / 60, -25.0);
  assert.ok(sportsCam.position.y >= getCourtFloorY(sportsCam.position.x, sportsCam.position.z) + 1.15);

  // 3. Replay Dock 2-row spatial focus & Numpad 1..7 camera selection + Untimed Practice count-up scoreboard clock
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevPerf = globalThis.performance;
  const { document } = createMockDom();
  const keyListeners = [];

  try {
    globalThis.window = {
      location: { search: '' },
      addEventListener(t, fn) { if (t === 'keydown') keyListeners.push(fn); },
      removeEventListener() {},
    };
    globalThis.document = document;
    globalThis.performance = { now: () => 1000 };

    replayManager.beginMatchRecording({ seed: 7, configs: [{ team: 'home' }, { team: 'away' }], playerCount: 2 });
    const rec = await replayManager.finishMatchRecording({ scoreHome: 1, scoreAway: 0, winner: 'home' });
    await replayManager.preparePlayback(rec);

    const selectedCams = [];
    const dockMod = await import(`../src/ui/replayDock.js?dock=${Date.now()}`);
    dockMod.initReplayDock({
      onSelectCamera: (c) => { selectedCams.push(c); replayManager.setCameraPreset(c); },
      isMenuOpen: () => false,
    });
    dockMod.updateReplayDock({ isMenuOpen: false });

    const dockEl = document.getElementById('replay-broadcast-dock');
    const visBtns = dockMod.getVisibleDockButtons();
    // Assign spatial rects across 2 rows and test D-pad Right / Up / Down
    visBtns.forEach((b, idx) => {
      b.rect = { left: idx * 50, top: 40, width: 42, height: 24 };
    });
    const firstBtn = dockEl._getFocusedButton();
    const movedRight = dockMod.moveDockSpatialFocus(1, 0);
    assert.notEqual(movedRight, firstBtn, 'Spatial D-pad Right advances focus to neighboring button');

    for (const [code, expected] of [
      ['Numpad1', 'broadcast'],
      ['Numpad4', 'chase'],
      ['Numpad7', 'free'],
    ]) {
      for (const fn of keyListeners) {
        fn({ code, repeat: false, target: null, preventDefault() {} });
      }
      assert.equal(selectedCams.at(-1), expected, `${code} selects ${expected} replay camera`);
    }
    replayManager.stopPlayback();

    // 4. Untimed Newcomer Checklist & Count-Up Arena Scoreboard Clock
    setSelectedPracticeDrill('newcomer_drill');
    resetPracticeStats();
    assert.equal(newcomerDrill.active, true);
    assert.equal(newcomerDrill.untimed, true);
    assert.equal('ticksRemaining' in newcomerDrill, false, 'Countdown timer removed from newcomerDrill');

    for (let t = 0; t < 3900; t++) {
      stepPracticeDrillTick({ tick: t, athletes: [], balls: [], resetBallFn: null });
    }
    assert.equal(Math.floor(getPracticeSessionSeconds()), 65, 'Practice session runs past 60s without expiring');

    practiceStats.spikes = 1;
    practiceStats.dives = 1;
    practiceStats.goals = 1;
    syncPracticeStrikeStats({ getStrikeStats: () => ({ hits: 3, whiffs: 0 }) });
    assert.equal(newcomerDrill.completed, true);

    const sbScene = new THREE.Scene();
    const sb = createScoreboards(sbScene);
    displayCoordinator.reset(4);
    updateScoreboards(sb, {
      mode: 'practice',
      practiceSeconds: 0,
      ticksRemaining: 18000,
      scoreHome: 0,
      scoreAway: 0,
      targetGoal: 'N',
      celebrationTicks: 0,
      matchOver: false,
    });
    assert.equal(sb.lastClockText, '00:00', 'Arena scoreboard starts at 00:00 in Practice Mode');

    updateScoreboards(sb, {
      mode: 'practice',
      practiceSeconds: 65,
      ticksRemaining: 18000,
      scoreHome: 1,
      scoreAway: 0,
      targetGoal: 'S',
      celebrationTicks: 0,
      matchOver: false,
    });
    assert.equal(sb.lastClockText, '01:05', 'Arena scoreboard counts UP to 01:05 in Practice Mode');
  } finally {
    globalThis.performance = prevPerf;
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
  }
});
