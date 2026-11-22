/**
 * Regression tests for render performance defaults, optional OFF-by-default
 * readability HUD modules (`hudConfig`, terrain-conformal rainbow `ballDropRing`,
 * proximity-faded strike-range guide, clean broadcast reset, shared ragdoll materials,
 * and shadow-free headwear).
 *
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { TUNING } from '../src/config/tuning.js';
import {
  DEFAULT_HUD_PREFS,
  getHudPrefs,
  setHudPrefs,
  setCleanBroadcastHud,
  isCleanBroadcastHud,
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

test('hudConfig defaults every optional readability overlay to OFF and supports clean broadcast reset', () => {
  resetHudPrefs();
  const prefs = getHudPrefs();
  assert.equal(prefs.scorebugMode, 'off');
  assert.equal(prefs.ballDropRing, false);
  assert.equal(prefs.strikeRangeGuide, false);
  assert.equal(prefs.orientationCues, false);
  assert.equal(prefs.graphicsPreset, 'balanced');
  assert.equal(isCleanBroadcastHud(), true);
  assert.deepEqual(DEFAULT_HUD_PREFS, {
    scorebugMode: 'off',
    ballDropRing: false,
    strikeRangeGuide: false,
    orientationCues: false,
    graphicsPreset: 'balanced',
  });

  let events = 0;
  const unsub = subscribeHudPrefs(() => { events++; });
  try {
    setHudPrefs({ scorebugMode: 'splitscreen', ballDropRing: true, strikeRangeGuide: true, graphicsPreset: 'low' });
    assert.equal(getHudPrefs().scorebugMode, 'splitscreen');
    assert.equal(getHudPrefs().ballDropRing, true);
    assert.equal(getHudPrefs().strikeRangeGuide, true);
    assert.equal(getHudPrefs().graphicsPreset, 'low');
    assert.equal(isCleanBroadcastHud(), false);
    assert.equal(events, 1);

    // Invalid values are ignored without mutating or notifying
    setHudPrefs({ scorebugMode: 'invalid_mode', ballDropRing: 'yes', graphicsPreset: 'potato' });
    assert.equal(getHudPrefs().scorebugMode, 'splitscreen');
    assert.equal(getHudPrefs().ballDropRing, true);
    assert.equal(getHudPrefs().graphicsPreset, 'low');
    assert.equal(events, 1);

    // Clean broadcast reset turns off all overlays while keeping graphics preset intact
    setCleanBroadcastHud();
    assert.equal(isCleanBroadcastHud(), true);
    assert.equal(getHudPrefs().graphicsPreset, 'low');
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
    // 1. Default OFF -> stays completely hidden
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
