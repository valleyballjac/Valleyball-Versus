/**
 * Regression tests for render performance defaults, 3-tier HUD presets
 * (Minimal / Clean Broadcast, Standard default, Rookie / Live Room),
 * localStorage persistence, deterministic clean override, controlsOverlay,
 * settingsModal, inGameMenu sync, terrain-conformal rainbow `ballDropRing`,
 * shared ragdoll materials, and shadow-free headwear.
 *
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { TUNING } from '../src/config/tuning.js';
import {
  CLEAN_HUD_PREFS,
  STANDARD_HUD_PREFS,
  ROOKIE_HUD_PREFS,
  DEFAULT_HUD_PREFS,
  getHudPrefs,
  setHudPrefs,
  setCleanBroadcastHud,
  isCleanBroadcastHud,
  applyHudPreset,
  getActiveHudPresetId,
  resetHudPrefs,
  subscribeHudPrefs,
} from '../src/config/hudConfig.js';
import { createBallDropRings, evaluateHeightRainbowColor } from '../src/visuals/ballDropRing.js';
import { createSetupBallPreview } from '../src/visuals/setupBallPreview.js';
import { mergeStaticGroupByMaterial } from '../src/sim/meshBatcher.js';
import { soundManager } from '../src/audio/soundManager.js';
import { createRagdollVisuals, updateAthletePalette, disposeRagdollVisuals } from '../src/sim/ragdoll.js';
import { buildHeadwear } from '../src/sim/cosmeticsBuilders.js';
import { getCourtFloorY } from '../src/ai/courtHeightmap.js';

function createMockDom() {
  const byId = new Map();
  const makeEl = (tag = 'div') => {
    const classes = new Set();
    const el = {
      tagName: String(tag).toUpperCase(),
      _id: '',
      get id() { return this._id; },
      set id(v) {
        if (this._id) byId.delete(this._id);
        this._id = String(v || '');
        if (this._id) byId.set(this._id, this);
      },
      style: {},
      dataset: {},
      children: [],
      options: [],
      hidden: false,
      textContent: '',
      _innerHTML: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(v) {
        this._innerHTML = String(v || '');
        this.children.length = 0;
        this.options.length = 0;
      },
      value: '',
      selectedIndex: 0,
      className: '',
      classList: {
        add(c) { classes.add(c); },
        remove(c) { classes.delete(c); },
        toggle(c, force) {
          if (force === undefined) {
            if (classes.has(c)) { classes.delete(c); return false; }
            classes.add(c);
            return true;
          }
          if (force) classes.add(c);
          else classes.delete(c);
          return Boolean(force);
        },
        contains(c) { return classes.has(c); },
      },
      appendChild(child) {
        this.children.push(child);
        if (child && child.tagName === 'OPTION') {
          this.options.push(child);
        }
        return child;
      },
      append(...nodes) {
        for (const n of nodes) this.appendChild(n);
      },
      querySelector(sel) {
        if (sel && sel.startsWith('#')) {
          return byId.get(sel.slice(1)) || null;
        }
        return null;
      },
      scrollIntoView() {},
      click() {
        if (typeof this.onclick === 'function') this.onclick();
      },
      dispatchEvent(ev) {
        const type = ev?.type || '';
        if (type === 'input' && typeof this.oninput === 'function') this.oninput({ target: this });
        if (type === 'change' && typeof this.onchange === 'function') this.onchange({ target: this });
        return true;
      },
    };
    return el;
  };
  const body = makeEl('body');
  const document = {
    body,
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => byId.get(id) || null,
  };
  return { document, makeEl, byId };
}

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      writes.push([k, v]);
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
  };
}

test('hudConfig ships Standard defaults, 3 presets, and clean broadcast reset preserving graphicsPreset', () => {
  resetHudPrefs();
  const prefs = getHudPrefs();
  assert.equal(DEFAULT_HUD_PREFS, STANDARD_HUD_PREFS);
  assert.equal(prefs.scorebugMode, 'splitscreen');
  assert.equal(prefs.ballDropRing, true);
  assert.equal(prefs.strikeRangeGuide, false);
  assert.equal(prefs.orientationCues, true);
  assert.equal(prefs.controlsOverlay, false);
  assert.equal(prefs.graphicsPreset, 'balanced');
  assert.equal(getActiveHudPresetId(), 'standard');
  assert.equal(isCleanBroadcastHud(), false);
  assert.equal(TUNING.controlsHud.userEnabled, false);
  assert.deepEqual(DEFAULT_HUD_PREFS, {
    scorebugMode: 'splitscreen',
    ballDropRing: true,
    strikeRangeGuide: false,
    orientationCues: true,
    controlsOverlay: false,
    graphicsPreset: 'balanced',
  });

  let events = 0;
  const unsub = subscribeHudPrefs(() => { events++; });
  try {
    // Rookie / Live Room preset turns on always scorebug, guides, and persistent controls overlay
    applyHudPreset('rookie');
    assert.deepEqual({ ...getHudPrefs() }, { ...ROOKIE_HUD_PREFS });
    assert.equal(getActiveHudPresetId(), 'rookie');
    assert.equal(TUNING.controlsHud.userEnabled, true);
    assert.equal(events, 1);

    // Partial toggle moves active preset to 'custom'
    setHudPrefs({ strikeRangeGuide: false, graphicsPreset: 'low' });
    assert.equal(getActiveHudPresetId(), 'custom');
    assert.equal(getHudPrefs().graphicsPreset, 'low');
    assert.equal(events, 2);

    // Invalid values are ignored without mutating or notifying
    setHudPrefs({ scorebugMode: 'invalid_mode', ballDropRing: 'yes', controlsOverlay: 'yes', graphicsPreset: 'potato' });
    assert.equal(getHudPrefs().scorebugMode, 'always');
    assert.equal(getHudPrefs().controlsOverlay, true);
    assert.equal(getHudPrefs().graphicsPreset, 'low');
    assert.equal(events, 2);

    // Minimal preset preserves graphicsPreset and clears all HUD/overlay flags
    applyHudPreset('minimal');
    assert.equal(getActiveHudPresetId(), 'minimal');
    assert.equal(isCleanBroadcastHud(), true);
    assert.equal(getHudPrefs().controlsOverlay, false);
    assert.equal(getHudPrefs().graphicsPreset, 'low');
    assert.equal(TUNING.controlsHud.userEnabled, false);

    // Clean broadcast reset turns off all overlays while keeping graphics preset intact
    applyHudPreset('rookie');
    setCleanBroadcastHud();
    assert.equal(isCleanBroadcastHud(), true);
    assert.deepEqual({ ...getHudPrefs() }, { ...CLEAN_HUD_PREFS, graphicsPreset: 'low' });
    assert.equal(TUNING.controlsHud.userEnabled, false);
  } finally {
    unsub();
    resetHudPrefs();
  }
});

test('evaluateHeightRainbowColor maps terrain height smoothly across canonical 8-stop spectrum', () => {
  const cTurf = evaluateHeightRainbowColor(0.0, new THREE.Color());
  const cMid = evaluateHeightRainbowColor(3.2, new THREE.Color());
  const cHigh = evaluateHeightRainbowColor(11.0, new THREE.Color());

  assert.equal(cTurf.getHex(), 0xff2a42, 'Ground level should be Signal Red');
  assert.equal(cMid.getHex(), 0x10e56a, 'Jump-strike height should be Turf Emerald');
  assert.equal(cHigh.getHex(), 0xe000b8, 'Hoop-apex height should be Magenta');
});

test('createBallDropRings conforms to terrain without clipping, stays constant on turf, and drives strike guide', () => {
  resetHudPrefs();
  const scene = new THREE.Scene();
  const rings = createBallDropRings(scene);

  // Place ball on sloped Valley Court bank (x = 12, z = 20) so vertices span changing terrain elevation
  const slopeFloorY = getCourtFloorY(12, 20);
  const airborneBall = {
    radius: 0.5,
    mesh: { visible: true, position: new THREE.Vector3(12, slopeFloorY + 2.5, 20) },
  };
  const groundedBall = {
    radius: 0.5,
    mesh: { visible: true, position: new THREE.Vector3(4, getCourtFloorY(4, 0) + 0.50, 0) },
  };
  const nearAthlete = {
    isEnabled: true,
    team: 'home',
    primaryColor: 0xd90429,
    strikeState: { assistRadius: 0.45 },
    motor: { mesh: { position: new THREE.Vector3(11.2, slopeFloorY + 0.5, 20) } },
  };
  const farAthlete = {
    isEnabled: true,
    team: 'away',
    primaryColor: 0x1d4ed8,
    strikeState: { assistRadius: 0.45 },
    motor: { mesh: { position: new THREE.Vector3(-12, getCourtFloorY(-12, -20) + 0.5, -20) } },
  };

  try {
    // 1. Standard default enables ballDropRing; Minimal / Clean Broadcast hides completely
    rings.update({ gameState: 'match', balls: [airborneBall], athletes: [nearAthlete, farAthlete] });
    assert.equal(rings.group.visible, true);
    setCleanBroadcastHud();
    rings.update({ gameState: 'match', balls: [airborneBall], athletes: [nearAthlete, farAthlete] });
    assert.equal(rings.group.visible, false);

    // 2. Enabled in Match -> conforms per-vertex to sloped court floor (never flat, never casts shadow)
    setHudPrefs({ ballDropRing: true });
    rings.update({ gameState: 'match', balls: [airborneBall], athletes: [nearAthlete, farAthlete] });
    assert.equal(rings.group.visible, true);
    assert.equal(rings.entries[0].pivot.visible, true);
    assert.equal(rings.entries[0].outerMesh.castShadow, false);
    assert.equal(rings.entries[0].outerMesh.receiveShadow, false);

    const posAttr = rings.entries[0].outerGeo.attributes.position;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let v = 0; v < posAttr.count; v++) {
      const vx = posAttr.getX(v);
      const vy = posAttr.getY(v);
      const vz = posAttr.getZ(v);
      const expectedY = getCourtFloorY(vx, vz) + 0.085;
      assert.ok(Math.abs(vy - expectedY) < 1e-4, `Vertex ${v} must hug court floor + 0.085m`);
      if (vy < minY) minY = vy;
      if (vy > maxY) maxY = vy;
    }
    assert.ok(maxY - minY > 0.05, 'Sloped terrain ring vertices should follow elevation variation instead of staying flat');

    // 2b. Outer corner & perimeter coverage (|x| > 24, |z| > 55): ring stays visible and clamps inside glass
    const cornerBall = {
      radius: 0.5,
      mesh: { visible: true, position: new THREE.Vector3(24.5, 14.0, -58.0) },
    };
    rings.update({ gameState: 'match', balls: [cornerBall], athletes: [nearAthlete] });
    assert.equal(rings.entries[0].pivot.visible, true, 'Ball on outer corner ramp must keep rainbow halo visible');
    const cAttr = rings.entries[0].outerGeo.attributes.position;
    for (let v = 0; v < cAttr.count; v++) {
      assert.ok(Math.abs(cAttr.getX(v)) <= 24.89, 'Ring X clamps inside sideline glass');
      assert.ok(Math.abs(cAttr.getZ(v)) <= 59.89, 'Ring Z clamps inside end glass');
    }

    // 3. Constant presence: grounded/bouncing balls KEEP their halo visible (zero bounce flash)
    rings.update({ gameState: 'practice', balls: [airborneBall, groundedBall], athletes: [nearAthlete] });
    assert.equal(rings.entries[0].pivot.visible, true, 'Airborne ball 0 keeps rainbow halo');
    assert.equal(rings.entries[1].pivot.visible, true, 'Grounded ball 1 keeps rainbow halo without flashing off');

    // 4. Optional Strike Range Guide: fades in only near ball, invisible when > 6.5m away
    setHudPrefs({ strikeRangeGuide: true });
    rings.update({ gameState: 'match', balls: [airborneBall], athletes: [nearAthlete, farAthlete] });
    assert.equal(rings.reachEntries[0].mesh.visible, true, 'Athlete near ball shows strike reach guide');
    assert.equal(rings.reachEntries[1].mesh.visible, false, 'Athlete > 6.5m away hides strike reach guide');
    assert.ok(rings.reachEntries[0].mat.opacity >= 0.5, 'In-reach athlete guide brightens crisply on overlap');

    // 5. Hidden in menu / victory camera
    rings.update({ gameState: 'menu', balls: [airborneBall], athletes: [nearAthlete] });
    assert.equal(rings.group.visible, false);
  } finally {
    rings.dispose();
    resetHudPrefs();
  }
});

test('createRagdollVisuals shares PBR materials and headwear skips shadow pass', () => {
  const makeBody = () => ({
    translation: () => ({ x: 0, y: 1, z: 0 }),
    rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
  });
  const keys = [
    ['head', 'ball', 0.12, 0],
    ['chest', 'ball', 0.16, 0],
    ['spine', 'capsule', 0.11, 0.10],
    ['pelvis', 'ball', 0.14, 0],
    ['upperArmL', 'capsule', 0.06, 0.14],
    ['upperArmR', 'capsule', 0.06, 0.14],
    ['foreArmL', 'capsule', 0.05, 0.13],
    ['foreArmR', 'capsule', 0.05, 0.13],
    ['handL', 'capsule', 0.05, 0.06],
    ['handR', 'capsule', 0.05, 0.06],
    ['thighL', 'capsule', 0.08, 0.18],
    ['thighR', 'capsule', 0.08, 0.18],
    ['calfL', 'capsule', 0.06, 0.18],
    ['calfR', 'capsule', 0.06, 0.18],
    ['footL', 'capsule', 0.06, 0.09],
    ['footR', 'capsule', 0.06, 0.09],
  ];
  const rig = new Map();
  for (const [key, shape, radius, halfHeight] of keys) {
    rig.set(key, {
      key,
      shape,
      radius,
      halfHeight,
      entry: { group: key === 'chest' || key === 'spine' || key === 'pelvis' ? 'torso' : 'limb' },
      body: makeBody(),
    });
  }

  const group = createRagdollVisuals(rig, { team: 'home', headwear: 'none', primaryColor: 0xd90429 });
  const solidMaterials = new Set();
  let jointShadowCasters = 0;

  for (const item of rig.values()) {
    item.solidMesh.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      solidMaterials.add(obj.material);
      if (obj.material.userData?.colorRole === 'joint' && obj.castShadow) {
        jointShadowCasters++;
      }
    });
  }

  assert.equal(solidMaterials.size, 4, `Expected 4 shared solid materials per athlete, got ${solidMaterials.size}`);
  assert.equal(jointShadowCasters, 0, 'Tiny nested limb joints and wrist cuffs should not cast shadows');

  // Headwear pieces must not cast shadows (cuts shadow draw calls by ~55%)
  const cap = buildHeadwear('manager_cap', { radius: 0.125, primaryColor: 0xd90429 });
  let headwearShadowCasters = 0;
  cap.traverse((obj) => { if (obj.isMesh && obj.castShadow) headwearShadowCasters++; });
  assert.equal(headwearShadowCasters, 0, 'Headwear sub-meshes should never cast shadows');

  // Recoloring updates shared primary material cleanly
  updateAthletePalette({ rig, group, team: 'away' }, { team: 'away', primaryColor: 0x00e5ff });
  assert.equal(rig.get('handL').solidMesh.children[0].material.color.getHex(), 0x00e5ff);

  disposeRagdollVisuals(group);
});

test('Lean render defaults ship with balanced 1-tower shadows, 1.25 DPR, tightened maxFrameTime, and half-res jumbotrons', () => {
  assert.equal(TUNING.render.shadowQuality, 'balanced');
  assert.equal(TUNING.render.pixelRatioPreset, '1.25');
  assert.ok(TUNING.loop.maxFrameTime <= 0.08, 'maxFrameTime should prevent multi-tick catch-up spirals');
  assert.equal(TUNING.scoreboard.endCanvasWidth, 512);
  assert.equal(TUNING.scoreboard.endCanvasHeight, 256);
  assert.equal(TUNING.scoreboard.sideCanvasWidth, 1024);
  assert.equal(TUNING.scoreboard.sideCanvasHeight, 256);
  assert.equal(TUNING.hustleBoard.canvasWidth, 512);
  assert.equal(TUNING.hustleBoard.canvasHeight, 320);
});

test('createSetupBallPreview displays exact selected ball or 3-ball orbital carousel for random and restores scale on hide', () => {
  const scene = new THREE.Scene();
  const preview = createSetupBallPreview(scene);
  const mockBalls = [
    { id: 'small', radius: 0.20, mesh: new THREE.Mesh() },
    { id: 'medium', radius: 0.50, mesh: new THREE.Mesh() },
    { id: 'large', radius: 0.75, mesh: new THREE.Mesh() },
  ];

  preview.setSelection({ visible: true, mode: 'match', ballChoice: 'large' });
  preview.update(0.1, mockBalls);
  assert.equal(mockBalls[0].mesh.visible, false);
  assert.equal(mockBalls[1].mesh.visible, false);
  assert.equal(mockBalls[2].mesh.visible, true);

  preview.setSelection({ visible: true, mode: 'match', ballChoice: 'random' });
  preview.update(0.25, mockBalls);
  assert.equal(mockBalls[0].mesh.visible, true);
  assert.equal(mockBalls[1].mesh.visible, true);
  assert.equal(mockBalls[2].mesh.visible, true);
  const d01 = mockBalls[0].mesh.position.distanceTo(mockBalls[1].mesh.position);
  assert.ok(d01 > 0.5, 'Random orbital carousel must space the 3 balls apart');

  preview.hide(mockBalls);
  for (const b of mockBalls) {
    assert.equal(b.mesh.visible, false);
    assert.equal(b.mesh.scale.x, 1);
    assert.equal(b.mesh.scale.y, 1);
    assert.equal(b.mesh.scale.z, 1);
  }
  preview.dispose();
});

test('soundManager.playGlassImpact rate-limits rolling glass contacts to <= 2/sec and softens rolling volume', () => {
  const prevCtx = soundManager.ctx;
  const prevEnsure = soundManager.ensureRunning;
  const prevPlayPool = soundManager.playSampleFromPool;
  const prevLastGlass = soundManager.lastGlassTime;
  const played = [];
  let fakeTime = 10.0;

  try {
    soundManager.ctx = { get currentTime() { return fakeTime; } };
    soundManager.lastGlassTime = 0;
    soundManager.ensureRunning = () => true;
    soundManager.playSampleFromPool = (_k, _p, vol) => { played.push({ t: fakeTime, vol }); };

    // Simulate 20 rapid rolling hits over 1.0 second (every 50ms)
    soundManager.playGlassImpact(8.0, null, false); // initial fresh slap at t=10.0
    for (let i = 1; i <= 20; i++) {
      fakeTime = 10.0 + i * 0.05;
      soundManager.playGlassImpact(8.0, null, true);
    }

    assert.equal(played.length, 2, `Expected at most 2 glass impacts in 1s (initial slap + 1 soft roll), got ${played.length}`);
    assert.ok(played[1].vol < played[0].vol * 0.55, 'Rolling glass audio should be significantly softer than initial impact');
    assert.ok(played[1].t - played[0].t >= 0.74, 'Rolling glass re-trigger must respect >= 0.75s cooldown');
  } finally {
    soundManager.ctx = prevCtx;
    soundManager.ensureRunning = prevEnsure;
    soundManager.playSampleFromPool = prevPlayPool;
    soundManager.lastGlassTime = prevLastGlass;
  }
});

test('mergeStaticGroupByMaterial preserves vertex color attributes (e.g. purple arena corner wedges)', () => {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x60349a, vertexColors: true });

  const makeCorner = (x) => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = 1.0;
      colors[i * 3 + 1] = 1.0;
      colors[i * 3 + 2] = 1.0;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, 0);
    return mesh;
  };

  group.add(makeCorner(-10), makeCorner(10));
  const stats = mergeStaticGroupByMaterial(group);
  assert.equal(stats.beforeDraws, 2);
  assert.equal(stats.afterDraws, 1);

  const merged = group.children.find((c) => c.isMesh);
  assert.ok(merged, 'Merged mesh must exist');
  assert.ok(merged.geometry.attributes.color, 'Merged mesh must preserve vertex color attribute when material.vertexColors is true');
  assert.equal(merged.geometry.attributes.color.getX(0), 1.0);

  merged.geometry.dispose();
  mat.dispose();
});

test('hudConfig persists explicit false booleans and controlsOverlay across reload, and handles throwing localStorage', async () => {
  const prevWindow = globalThis.window;
  const storage = createMemoryStorage();
  try {
    globalThis.window = { location: { search: '' }, localStorage: storage };
    const mod1 = await import(`../src/config/hudConfig.js?persist1=${Date.now()}`);
    mod1.setHudPrefs({
      scorebugMode: 'off',
      ballDropRing: false,
      orientationCues: false,
      strikeRangeGuide: false,
      controlsOverlay: false,
    });
    const saved = JSON.parse(storage.getItem('valleyball_hud_prefs_v1'));
    assert.equal(saved.ballDropRing, false);
    assert.equal(saved.orientationCues, false);
    assert.equal(saved.controlsOverlay, false);
    assert.equal(saved.scorebugMode, 'off');

    // Reload module with Standard defaults: saved false booleans must override Standard true defaults
    const mod2 = await import(`../src/config/hudConfig.js?persist2=${Date.now()}`);
    assert.equal(mod2.getHudPrefs().ballDropRing, false);
    assert.equal(mod2.getHudPrefs().orientationCues, false);
    assert.equal(mod2.getHudPrefs().scorebugMode, 'off');
    assert.equal(mod2.getHudPrefs().controlsOverlay, false);
    assert.equal(TUNING.controlsHud.userEnabled, false);

    // Rookie controlsOverlay: true persists across reload and syncs TUNING.controlsHud.userEnabled
    mod2.applyHudPreset('rookie');
    assert.equal(JSON.parse(storage.getItem('valleyball_hud_prefs_v1')).controlsOverlay, true);
    const mod3 = await import(`../src/config/hudConfig.js?persist3=${Date.now()}`);
    assert.equal(mod3.getHudPrefs().controlsOverlay, true);
    assert.equal(mod3.getActiveHudPresetId(), 'rookie');
    assert.equal(TUNING.controlsHud.userEnabled, true);

    // Sandboxed iframe where accessing window.localStorage getter throws must not crash
    globalThis.window = {
      location: { search: '' },
      get localStorage() {
        throw new Error('SecurityError');
      },
    };
    const mod4 = await import(`../src/config/hudConfig.js?persist4=${Date.now()}`);
    assert.equal(mod4.getHudPrefs().scorebugMode, 'splitscreen');
    assert.equal(TUNING.controlsHud.userEnabled, false);
    mod4.applyHudPreset('rookie');
    assert.equal(mod4.getHudPrefs().controlsOverlay, true);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    resetHudPrefs();
  }
});

test('isDeterministicRun forces CLEAN_HUD_PREFS and blocks localStorage read/write for captureTick, fixture, and stateTrace', async () => {
  const prevWindow = globalThis.window;
  try {
    for (const query of ['?captureTick=300', '?fixture=serve', '?stateTrace=1']) {
      const storage = createMemoryStorage({
        valleyball_hud_prefs_v1: JSON.stringify(ROOKIE_HUD_PREFS),
      });
      globalThis.window = { location: { search: query }, localStorage: storage };
      const mod = await import(`../src/config/hudConfig.js?det=${encodeURIComponent(query)}_${Date.now()}`);
      assert.equal(mod.getHudPrefs().scorebugMode, 'off', `${query} must force scorebugMode off`);
      assert.equal(mod.getHudPrefs().ballDropRing, false, `${query} must force ballDropRing false`);
      assert.equal(mod.getHudPrefs().orientationCues, false, `${query} must force orientationCues false`);
      assert.equal(mod.getHudPrefs().strikeRangeGuide, false, `${query} must force strikeRangeGuide false`);
      assert.equal(mod.getHudPrefs().controlsOverlay, false, `${query} must force controlsOverlay false`);
      assert.equal(mod.isCleanBroadcastHud(), true, `${query} must report clean broadcast HUD`);
      assert.equal(TUNING.controlsHud.userEnabled, false, `${query} must force controlsHud.userEnabled false`);

      mod.resetHudPrefs();
      assert.equal(mod.getHudPrefs().ballDropRing, false, `${query} resetHudPrefs stays clean`);
      assert.equal(storage.writes.length, 0, `${query} must not write localStorage`);
    }
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    resetHudPrefs();
  }
});

test('controlsOverlay preserves kickoff countdown when controlsOverlay is false and stays visible under Rookie preset', async () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const { document, makeEl } = createMockDom();
  const rootEl = makeEl('div');
  rootEl.id = 'controls-overlay';
  document.body.appendChild(rootEl);

  const snapshot = [
    { human: false, available: false, device: 'keyboard', keyset: 0, standard: true, held: 0, pulse: 0 },
    { human: false, available: false, device: 'keyboard', keyset: 0, standard: true, held: 0, pulse: 0 },
    { human: false, available: false, device: 'keyboard', keyset: 0, standard: true, held: 0, pulse: 0 },
    { human: false, available: false, device: 'keyboard', keyset: 0, standard: true, held: 0, pulse: 0 },
  ];

  try {
    globalThis.window = { location: { search: '' }, localStorage: createMemoryStorage() };
    globalThis.document = document;
    resetHudPrefs();
    const overlay = await import(`../src/ui/controlsOverlay.js?test=${Date.now()}`);
    overlay.initControlsOverlay();

    // Standard preset: controlsOverlay === false, visible ONLY during kickoff countdown
    overlay.updateControlsOverlay(snapshot, 'match', false, false, false, true, false);
    assert.equal(rootEl.hidden, false, 'Countdown keeps controls overlay visible when controlsOverlay is false');

    overlay.updateControlsOverlay(snapshot, 'match', false, false, false, false, false);
    assert.equal(rootEl.hidden, true, 'After countdown controls overlay hides when controlsOverlay is false');

    // Rookie preset enables persistent controls overlay even after countdown ends
    applyHudPreset('rookie');
    overlay.updateControlsOverlay(snapshot, 'match', false, false, false, false, false);
    assert.equal(rootEl.hidden, false, 'Rookie preset keeps controls overlay visible during live match');

    // Opening menu hides overlay; Minimal preset turns persistent overlay back off
    overlay.updateControlsOverlay(snapshot, 'match', true, false, false, false, false);
    assert.equal(rootEl.hidden, true, 'Menu open hides controls overlay');

    applyHudPreset('minimal');
    overlay.updateControlsOverlay(snapshot, 'match', false, false, false, false, false);
    assert.equal(rootEl.hidden, true, 'Minimal preset keeps controls overlay hidden');
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    resetHudPrefs();
  }
});

test('settingsModal fixes controlsOverlay initial selection, Left/Right nav toggling, and 1-click 3-tier HUD presets', async () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevEvent = globalThis.Event;
  const { document, makeEl } = createMockDom();
  const root = makeEl('div');
  const storage = createMemoryStorage();
  const renderCalls = [];

  try {
    globalThis.Event = class MockEvent { constructor(type) { this.type = type; } };
    globalThis.window = {
      location: { search: '' },
      localStorage: storage,
    };
    globalThis.document = document;

    const settingsMod = await import(`../src/features/ui/mainMenu/settingsModal.js?settings=${Date.now()}`);

    // Start in Rookie so controlsOverlay === true before building modal (tests :227 fix)
    applyHudPreset('rookie');
    const modalEl = settingsMod.buildMainMenuSettingsModal(root, [{ cameraMode: 'chase' }], {
      onRenderSettingsChange: (s) => renderCalls.push(s),
    });

    const findOverlayButtons = () => {
      const box = modalEl.children[0];
      const all = [];
      const walk = (n) => {
        all.push(n);
        if (n.children) n.children.forEach(walk);
      };
      walk(box);
      const hiddenBtn = all.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Hidden (Default)');
      const visibleBtn = all.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Visible');
      return { hiddenBtn, visibleBtn };
    };

    const { hiddenBtn, visibleBtn } = findOverlayButtons();
    assert.equal(visibleBtn.style.background, '#2563eb', 'Visible button must be highlighted when controlsOverlay is true');
    assert.notEqual(hiddenBtn.style.background, '#2563eb', 'Hidden button must not be highlighted when controlsOverlay is true');

    // Focus starts on hudPresetRow (index 1 on Tab 0: [tabBar, hudPresetRow, overlayRow, ...]); move down 1 step to overlayRow
    modalEl._updateFocusUI();
    modalEl._moveFocus(1);

    // Left toggles true -> false (catches :599 bug)
    modalEl._handleLeft();
    assert.equal(getHudPrefs().controlsOverlay, false);
    assert.equal(TUNING.controlsHud.userEnabled, false);
    assert.equal(JSON.parse(storage.getItem('valleyball_hud_prefs_v1')).controlsOverlay, false);
    assert.equal(hiddenBtn.style.background, '#2563eb');
    assert.equal(document.getElementById('settings-hud-preset-badge').textContent, 'Custom');

    // Right toggles false -> true (catches :604 bug)
    modalEl._handleRight();
    assert.equal(getHudPrefs().controlsOverlay, true);
    assert.equal(TUNING.controlsHud.userEnabled, true);
    assert.equal(visibleBtn.style.background, '#2563eb');

    // Action toggles true -> false (catches :609 bug)
    modalEl._handleAction();
    assert.equal(getHudPrefs().controlsOverlay, false);
    assert.equal(hiddenBtn.style.background, '#2563eb');

    // 1-click Minimal & Standard preset buttons
    document.getElementById('btn-hud-preset-minimal').click();
    assert.equal(getActiveHudPresetId(), 'minimal');
    assert.equal(isCleanBroadcastHud(), true);
    assert.equal(document.getElementById('settings-hud-preset-badge').textContent, 'Minimal');

    document.getElementById('btn-hud-preset-standard').click();
    assert.equal(getActiveHudPresetId(), 'standard');
    assert.equal(getHudPrefs().scorebugMode, 'splitscreen');
    assert.equal(getHudPrefs().ballDropRing, true);
    assert.equal(getHudPrefs().orientationCues, true);
    assert.equal(getHudPrefs().controlsOverlay, false);
    assert.equal(document.getElementById('settings-hud-preset-badge').textContent, 'Standard');
    assert.ok(renderCalls.length >= 4);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    if (prevEvent === undefined) delete globalThis.Event;
    else globalThis.Event = prevEvent;
    resetHudPrefs();
  }
});

test('inGameMenu is ultra-lean (starts focused on Resume, zero graphics rows) and Main Menu Graphics tab keeps Rookie overlay on DPR change', async () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const { document } = createMockDom();
  const renderCalls = [];

  try {
    const storage = createMemoryStorage();
    globalThis.window = {
      location: { search: '' },
      localStorage: storage,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    globalThis.document = document;

    const root = document.createElement('div');
    document.body.appendChild(root);
    const settingsMod = await import(`../src/features/ui/mainMenu/settingsModal.js?gfxTab=${Date.now()}`);
    const inGameMod = await import(`../src/ui/inGameMenu.js?ingame=${Date.now()}`);

    applyHudPreset('rookie');
    const settingsEl = settingsMod.buildMainMenuSettingsModal(root, [{ cameraMode: 'chase' }], {
      onRenderSettingsChange: (s) => renderCalls.push(s),
    });
    inGameMod.initInGameMenu({
      onRenderSettingsChange: (s) => renderCalls.push(s),
    });

    assert.equal(document.getElementById('ingame-hud-preset-badge').textContent, 'Rookie');

    // Switch Main Menu Settings to Tab 1 (Graphics) and click 1.0x (Fast): must preserve Rookie controlsOverlay
    document.getElementById('settings-tab-graphics').click();
    const gfxBtns = [];
    const walk = (n) => {
      if (n.tagName === 'BUTTON') gfxBtns.push(n);
      if (n.children) n.children.forEach(walk);
    };
    walk(settingsEl);
    const dprBtn = gfxBtns.find((b) => b.textContent === '1.0x (Fast)');
    assert.ok(dprBtn, '1.0x (Fast) button exists under Main Menu Settings Graphics tab');
    dprBtn.click();
    assert.equal(getHudPrefs().controlsOverlay, true, 'Changing DPR in Graphics tab must not disable Rookie controls overlay');

    // Ultra-lean In-Game Pause Menu omits DPR/Shadow rows and starts focused on RESUME GAME
    const overlayEl = document.getElementById('ingame-menu-overlay');
    const inGameBtns = [];
    const walkInGame = (n) => {
      if (n.tagName === 'BUTTON') inGameBtns.push(n);
      if (n.children) n.children.forEach(walkInGame);
    };
    walkInGame(overlayEl);
    assert.equal(inGameBtns.some((b) => b.textContent === '1.0x (Fast)'), false, 'Graphics DPR buttons removed from inGameMenu');

    // 1-click Minimal preset in-game disables controlsOverlay and updates badge
    document.getElementById('btn-ingame-hud-preset-minimal').click();
    assert.equal(getHudPrefs().controlsOverlay, false);
    assert.equal(renderCalls.at(-1).showControlsOverlay, false);
    assert.equal(document.getElementById('ingame-hud-preset-badge').textContent, 'Minimal');
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    resetHudPrefs();
  }
});

test('Regression Bug 3: Main Menu Settings Graphics tab syncs DPR/shadow highlights from TUNING.render and inGameMenu HUD preset clicks do not clobber them', async () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevSetInterval = globalThis.setInterval;
  const prevClearInterval = globalThis.clearInterval;
  const prevDpr = TUNING.render.pixelRatioPreset;
  const prevShadow = TUNING.render.shadowQuality;
  const { document } = createMockDom();
  const renderCalls = [];

  try {
    globalThis.window = {
      location: { search: '' },
      localStorage: createMemoryStorage(),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    globalThis.document = document;
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => {};

    const root = document.createElement('div');
    document.body.appendChild(root);
    const settingsMod = await import(`../src/features/ui/mainMenu/settingsModal.js?settingsSync=${Date.now()}`);
    const inGameMod = await import(`../src/ui/inGameMenu.js?ingameSync=${Date.now()}`);
    TUNING.render.pixelRatioPreset = '1.25';
    TUNING.render.shadowQuality = 'balanced';
    const settingsEl = settingsMod.buildMainMenuSettingsModal(root, [{ cameraMode: 'chase' }], {
      onRenderSettingsChange: (s) => renderCalls.push(s),
    });
    inGameMod.initInGameMenu({
      onRenderSettingsChange: (s) => {
        renderCalls.push(s);
        if (s.pixelRatioPreset) TUNING.render.pixelRatioPreset = s.pixelRatioPreset;
        if (s.shadowQuality) TUNING.render.shadowQuality = s.shadowQuality;
      },
    });

    // Simulate external Low (Fast): DPR 1.0 + Shadows off, then open Main Menu Settings Graphics tab
    TUNING.render.pixelRatioPreset = '1.0';
    TUNING.render.shadowQuality = 'off';
    settingsMod.showMainMenuSettingsModal();
    document.getElementById('settings-tab-graphics').click();

    const gfxPanel = document.getElementById('settings-panel-graphics') || settingsEl;
    const allBtns = [];
    const walk = (n) => {
      if (n.tagName === 'BUTTON') allBtns.push(n);
      if (n.children) n.children.forEach(walk);
    };
    walk(gfxPanel);

    const lowDprBtn = allBtns.find((b) => b.textContent === '1.0x (Fast)');
    const balDprBtn = allBtns.find((b) => b.textContent === '1.25x (Balanced)');
    const offShadowBtn = allBtns.find((b) => b.textContent === 'Off');
    const balShadowBtn = allBtns.find((b) => b.textContent === 'Balanced (1 Tower)');

    assert.equal(lowDprBtn.style.background, '#2563eb', 'Graphics tab highlights synced 1.0x DPR button');
    assert.notEqual(balDprBtn.style.background, '#2563eb', 'Graphics tab clears stale 1.25x DPR highlight');
    assert.equal(offShadowBtn.style.background, '#2563eb', 'Graphics tab highlights synced Off shadow button');
    assert.notEqual(balShadowBtn.style.background, '#2563eb', 'Graphics tab clears stale Balanced shadow highlight');
    settingsMod.hideMainMenuSettingsModal();

    // Opening inGameMenu focuses RESUME GAME at index 0, and clicking Rookie HUD preset preserves Low DPR/Shadow
    inGameMod.showInGameMenu();
    const resumeBtn = document.getElementById('btn-ingame-resume');
    assert.equal(resumeBtn.dataset.focused, 'true', 'showInGameMenu focuses RESUME GAME first');
    document.getElementById('btn-ingame-hud-preset-rookie').click();
    const lastCall = renderCalls.at(-1);
    assert.deepEqual(lastCall, { showControlsOverlay: true }, 'HUD preset click only sends showControlsOverlay');
    assert.equal(TUNING.render.pixelRatioPreset, '1.0', 'HUD preset click preserves Low 1.0 DPR');
    assert.equal(TUNING.render.shadowQuality, 'off', 'HUD preset click preserves Off shadows');
    inGameMod.hideInGameMenu();
  } finally {
    TUNING.render.pixelRatioPreset = prevDpr;
    TUNING.render.shadowQuality = prevShadow;
    globalThis.setInterval = prevSetInterval;
    globalThis.clearInterval = prevClearInterval;
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    resetHudPrefs();
  }
});
