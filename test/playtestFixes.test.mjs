/**
 * Permanent regression tests for the v0.4.0 playtest and 2v2 fixes:
 *   1. Stream-head match & rematch spawning opposite each athlete's target goal
 *      (including swapped Home/Away teams, end flips, and 4-player non-overlap).
 *   2. PlayerCamera spawn orientation (`chase`, `firstPerson`, `tactical`) with
 *      zero 180-degree inversion or hardcoded South-attacking tilt.
 *   3. InputRouter menu/flyover isolation (`sampleAllInputs(..., false)` and
 *      `clearGameplayInputQueues()`).
 *   4. Off-mount anti-gravity damping suppression (`computeOffMount` & `applyTracking`)
 *      plus non-collider 3D Target Goal Indicators (`createGoalIndicators`).
 *   5. Team vs. Individual Player model (`TEAM_GROUPS`, `buildMatchStatsReport`).
 *   6. Anti-head & limb shaking fix: inertia-scaled angular PD spring in `applyTracking`
 *      and 4-tick `[1, 2, 2, 1]/6` render-side buzz filter in `snapshotRagdoll`.
 *
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { TUNING } from '../src/config/tuning.js';
import { Interpolated } from '../src/core/Interpolated.js';
import { computeStreamHeadSpawns } from '../src/features/athletes/athleteManager.js';
import { PlayerCamera } from '../src/visuals/playerCamera.js';
import {
  sampleAllInputs,
  clearGameplayInputQueues,
  getInputSlot,
  consumeCameraCyclePlayer,
  consumeCameraCycleArena,
  consumeAthleteJump,
  setExplicitDeviceMappings,
  getAssignedSlotForPad,
} from '../src/input/inputRouter.js';
import {
  setMenuNavigationContext,
  startMenuGamepadPolling,
  stopSetupGamepadPolling,
} from '../src/features/ui/mainMenu/menuNavigation.js';
import { state as menuState } from '../src/features/ui/mainMenu/state.js';
import { createTracker, computeOffMount, applyTracking } from '../src/sim/tracker.js';
import { snapshotRagdoll } from '../src/sim/ragdoll.js';
import { createGoalIndicators } from '../src/visuals/goalIndicators.js';
import {
  TEAM_GROUPS,
  getTeamGroupForSlot,
  getTeamOrderedSlots,
  createPlayerMatchStats,
  resetPlayerMatchStats,
  buildMatchStatsReport,
} from '../src/features/match/matchManager.js';
import { createBotController, updateBot } from '../src/ai/botController.js';
import { sampleTrajectoryAtTick, createPerception, buildPerception, getCourtFloorY } from '../src/ai/botPerception.js';
import { steerToward } from '../src/ai/botSteering.js';

const _dir = new THREE.Vector3();

test('computeStreamHeadSpawns places athletes on stream heads opposite their target goal', () => {
  const configs = [
    { team: 'home' },
    { team: 'away' },
  ];

  // Kickoff / Rematch (`targetGoal = 'N'`): Home targets North (-40) -> spawns South (+39.96);
  // Away targets South (+40) -> spawns North (-39.96).
  const spawnsN = computeStreamHeadSpawns({
    configs,
    athleteCount: 2,
    targetGoal: 'N',
    randomFn: () => 0.1,
  });
  assert.equal(spawnsN.length, 2);
  assert.ok(spawnsN[0].pos.z > 39.0, `Home should spawn on South stream head, got z=${spawnsN[0].pos.z}`);
  assert.ok(spawnsN[1].pos.z < -39.0, `Away should spawn on North stream head, got z=${spawnsN[1].pos.z}`);
  assert.ok(spawnsN[0].pos.y > 8.2 && spawnsN[0].pos.y < 8.6, `Stream-head spawn Y should rest near 8.34m, got y=${spawnsN[0].pos.y}`);
  assert.equal(spawnsN[0].facingYaw, Math.PI, 'South-spawning athlete faces North (-Z -> yaw = PI)');
  assert.equal(spawnsN[0].cameraAzimuth, 0, 'South-spawning PlayerCamera looks North (-Z -> azimuth = 0)');
  assert.equal(spawnsN[1].facingYaw, 0, 'North-spawning athlete faces South (+Z -> yaw = 0)');
  assert.equal(spawnsN[1].cameraAzimuth, Math.PI, 'North-spawning PlayerCamera looks South (+Z -> azimuth = PI)');

  // Swapped lobby teams: P1 chose Away, P2 chose Home
  const swappedSpawns = computeStreamHeadSpawns({
    configs: [{ team: 'away' }, { team: 'home' }],
    athleteCount: 2,
    targetGoal: 'N',
    randomFn: () => 0.1,
  });
  assert.ok(swappedSpawns[0].pos.z < -39.0, 'P1 (Away) spawns North opposite South target goal');
  assert.ok(swappedSpawns[1].pos.z > 39.0, 'P2 (Home) spawns South opposite North target goal');

  // Inverted targetGoal = 'S': Home targets South -> spawns North; Away targets North -> spawns South
  const spawnsS = computeStreamHeadSpawns({
    configs,
    athleteCount: 2,
    targetGoal: 'S',
    randomFn: () => 0.1,
  });
  assert.ok(spawnsS[0].pos.z < -39.0, 'When targetGoal=S, Home spawns on North stream head');
  assert.ok(spawnsS[1].pos.z > 39.0, 'When targetGoal=S, Away spawns on South stream head');

  // 4-player mode assigns 4 distinct non-overlapping stream heads
  const spawns4 = computeStreamHeadSpawns({
    configs: [
      { team: 'home' },
      { team: 'away' },
      { team: 'home' },
      { team: 'away' },
    ],
    athleteCount: 4,
    targetGoal: 'N',
    randomFn: () => 0.25,
  });
  assert.equal(spawns4.length, 4);
  const keys = new Set(spawns4.map((s) => `${s.pos.x.toFixed(2)},${s.pos.z.toFixed(2)}`));
  assert.equal(keys.size, 4, 'All 4 athletes must receive distinct stream heads');
});

function makeMockAthlete(x, y, z) {
  const pos = new THREE.Vector3(x, y, z);
  return {
    motor: {
      mesh: { position: pos },
      interpolated: { position: pos },
      body: {
        translation: () => ({ x, y, z }),
        linvel: () => ({ x: 0, y: 0, z: 0 }),
      },
    },
    getHeadWorldPosition: (out) => out.set(x, y + 1.15, z),
  };
}

test('PlayerCamera spawns pointing toward each player target goal across chase, firstPerson, and tactical', () => {
  const southAthlete = makeMockAthlete(-12.78, 8.34, 39.96);
  const northAthlete = makeMockAthlete(12.78, 8.34, -39.96);
  const northGoal = { x: 0, y: 10.0, z: -40.0 };
  const southGoal = { x: 0, y: 10.0, z: 40.0 };

  for (const mode of ['chase', 'firstPerson', 'tactical']) {
    // Player on South stream head attacking North (-Z)
    const camP1 = new PlayerCamera(0, mode);
    camP1.setMode(mode, false);
    camP1.azimuth = 0;
    camP1.resetSmoothing();
    camP1.update({
      athlete: southAthlete,
      activeBall: null,
      inputSlot: null,
      mouseDeltas: { dx: 0, dy: 0 },
      world: null,
      frameDelta: 1 / 60,
      allAthletes: [southAthlete, northAthlete],
      attackingGoal: northGoal,
    });
    camP1.camera.getWorldDirection(_dir);
    assert.ok(_dir.z < -0.55, `South->North ${mode} camera must look toward -Z, got dir.z=${_dir.z}`);
    if (mode === 'tactical') {
      assert.ok(camP1.camera.position.z > southAthlete.motor.interpolated.position.z, 'Tactical camera for North-attacker sits behind (+Z) the athlete');
    }

    // Player on North stream head attacking South (+Z)
    const camP2 = new PlayerCamera(1, mode);
    camP2.setMode(mode, false);
    camP2.azimuth = Math.PI;
    camP2.resetSmoothing();
    camP2.update({
      athlete: northAthlete,
      activeBall: null,
      inputSlot: null,
      mouseDeltas: { dx: 0, dy: 0 },
      world: null,
      frameDelta: 1 / 60,
      allAthletes: [southAthlete, northAthlete],
      attackingGoal: southGoal,
    });
    camP2.camera.getWorldDirection(_dir);
    assert.ok(_dir.z > 0.55, `North->South ${mode} camera must look toward +Z, got dir.z=${_dir.z}`);
    if (mode === 'tactical') {
      assert.ok(camP2.camera.position.z < northAthlete.motor.interpolated.position.z, 'Tactical camera for South-attacker sits behind (-Z) the athlete');
    }
  }
});

test('inputRouter blocks menu/flyover pad presses from queueing camera cycles or jumps', () => {
  const prevNavigator = globalThis.navigator;
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  // Press A (jump = 0), D-pad Up (cameraCycleArena = 12), and D-pad Right (cameraCyclePlayer = 15)
  buttons[0].pressed = true;
  buttons[12].pressed = true;
  buttons[15].pressed = true;

  const fakePad = {
    index: 0,
    id: 'Xbox Test Pad',
    connected: true,
    axes: [0, 0, 0, 0],
    buttons,
  };

  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => [fakePad] },
    configurable: true,
  });

  try {
    clearGameplayInputQueues();
    const cam = new THREE.PerspectiveCamera();

    // 1. Sample while menu / flyover is active (isGameplayActive = false)
    sampleAllInputs([cam, cam], 2, 'match', [], false);
    assert.equal(consumeCameraCyclePlayer(0), 0);
    assert.equal(consumeCameraCycleArena(0), 0);
    assert.equal(getInputSlot(0).jumpQueued, false);

    // 2. Transition immediately to live gameplay while buttons are STILL held down:
    //    latched padPrevStates must prevent phantom rising-edge camera cycles on Frame 1!
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.equal(consumeCameraCyclePlayer(0), 0, 'Held D-pad Right from menu must not cycle camera on Frame 1');
    assert.equal(consumeCameraCycleArena(0), 0, 'Held D-pad Up from menu must not cycle arena camera on Frame 1');
    assert.equal(consumeAthleteJump(0), false, 'Held A button from menu/skipFlyover must not jump on Frame 1');

    // 3. Fresh release + press during live gameplay DOES queue cleanly, and clearGameplayInputQueues resets it
    buttons[15].pressed = false;
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    buttons[15].pressed = true;
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    assert.equal(consumeCameraCyclePlayer(0), 1);

    buttons[15].pressed = false;
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    buttons[15].pressed = true;
    sampleAllInputs([cam, cam], 2, 'match', [], true);
    clearGameplayInputQueues();
    assert.equal(consumeCameraCyclePlayer(0), 0);
  } finally {
    if (prevNavigator === undefined) {
      delete globalThis.navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        value: prevNavigator,
        configurable: true,
      });
    }
  }
});

test('computeOffMount and applyTracking release airborne anti-gravity damping when detached from motor', () => {
  const armDampings = [];
  const makeBody = (pos, vel = { x: 0, y: 0, z: 0 }, recordArm = false) => ({
    translation: () => pos,
    linvel: () => vel,
    angvel: () => ({ x: 0, y: 0, z: 0 }),
    rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    mass: () => 5,
    applyImpulse: () => {},
    applyTorqueImpulse: () => {},
    setLinearDamping: (v) => { if (recordArm) armDampings.push(v); },
    setAngularDamping: () => {},
  });

  const motor = {
    body: makeBody({ x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: 0 }),
  };

  // Healthy standing pelvis (0.42m above sphere center) -> offMount === 0
  const healthyRig = new Map([
    ['pelvis', { group: 'core', body: makeBody({ x: 0, y: 0.92, z: 0 }) }],
    ['handL', { group: 'extremity', body: makeBody({ x: -0.4, y: 1.0, z: 0 }, { x: 0, y: 0, z: 0 }, true) }],
  ]);
  assert.equal(computeOffMount(healthyRig, motor), 0);

  // Detached pelvis blasted 3.5m into the air above grounded motor -> offMount === 1
  const detachedRig = new Map([
    ['pelvis', { group: 'core', body: makeBody({ x: 0, y: 4.0, z: 0 }, { x: 0, y: -5, z: 0 }) }],
    ['handL', { group: 'extremity', body: makeBody({ x: -0.4, y: 4.1, z: 0 }, { x: 0, y: -5, z: 0 }, true) }],
  ]);
  assert.equal(computeOffMount(detachedRig, motor), 1);

  const tracker = createTracker();
  tracker.weight = 0.6;
  const animTarget = {
    standUpNeed: 0,
    divePhase: 0,
    targets: new Map(),
  };
  applyTracking(tracker, detachedRig, animTarget, motor, 1 / 60, false);

  assert.equal(tracker.offMount, 1);
  assert.ok(tracker.weight < 0.6, 'Off-mount tracking drains weight instead of ramping recovery prematurely');
  assert.ok(
    Math.abs(armDampings[armDampings.length - 1] - 1.5) < 1e-6,
    `Off-mount arm linear damping must drop to fallen floor (1.5), got ${armDampings[armDampings.length - 1]}`,
  );
});

test('createGoalIndicators tints North and South non-collider planes to each attacking team color', () => {
  const scene = new THREE.Scene();
  const indicators = createGoalIndicators(scene);
  const northRoot = indicators.group.getObjectByName('goal-indicator-north');
  const southRoot = indicators.group.getObjectByName('goal-indicator-south');
  const northPlane = northRoot.children[0].children[0];
  const southPlane = southRoot.children[0].children[0];

  assert.equal(northRoot.children.length, 1, 'No overhead arrow/cone mesh above North hoop');
  assert.equal(southRoot.children.length, 1, 'No overhead arrow/cone mesh above South hoop');
  assert.equal(northPlane.material.map, null, 'In-goal plane uses clean untextured fill');
  assert.equal(southPlane.material.map, null, 'In-goal plane uses clean untextured fill');

  const prevHome = TUNING.teams.home.primaryColor;
  const prevAway = TUNING.teams.away.primaryColor;
  TUNING.teams.home.primaryColor = 0xd90429; // Crimson Red
  TUNING.teams.away.primaryColor = 0x1d4ed8; // Royal Blue

  try {
    indicators.update({
      gameState: 'match',
      matchState: { targetGoal: 'N', celebrationTicks: 0, events: [] },
      tick: 60,
    });
    assert.equal(indicators.group.visible, true);
    assert.equal(northPlane.material.color.getHex(), 0xd90429, 'North hoop glows Home Red when targetGoal=N');
    assert.equal(southPlane.material.color.getHex(), 0x1d4ed8, 'South hoop glows Away Blue when targetGoal=N');

    // Goal scored -> targetGoal flips to 'S'
    indicators.update({
      gameState: 'match',
      matchState: { targetGoal: 'S', celebrationTicks: 120, events: [{ goal: 'N' }] },
      tick: 120,
    });
    assert.equal(northPlane.material.color.getHex(), 0x1d4ed8, 'North hoop swaps to Away Blue when targetGoal=S');
    assert.equal(southPlane.material.color.getHex(), 0xd90429, 'South hoop swaps to Home Red when targetGoal=S');
  } finally {
    TUNING.teams.home.primaryColor = prevHome;
    TUNING.teams.away.primaryColor = prevAway;
  }
});

test('Team vs Individual Player model groups players by team and computes both collective and individual stats', () => {
  // 1. Canonical team grouping
  assert.deepEqual(TEAM_GROUPS[0].playerSlots, [0, 2]);
  assert.deepEqual(TEAM_GROUPS[1].playerSlots, [1, 3]);
  assert.deepEqual(getTeamOrderedSlots(1), [0]);
  assert.deepEqual(getTeamOrderedSlots(2), [0, 1]);
  assert.deepEqual(getTeamOrderedSlots(4), [0, 2, 1, 3]);

  assert.equal(getTeamGroupForSlot(0).id, 'team1');
  assert.equal(getTeamGroupForSlot(2).id, 'team1');
  assert.equal(getTeamGroupForSlot(1).id, 'team2');
  assert.equal(getTeamGroupForSlot(3).id, 'team2');

  // 2. Per-player match stats lifecycle
  const stats = [0, 1, 2, 3].map((i) => createPlayerMatchStats(i));
  stats[0].goals = 2;
  stats[0].assists = 1;
  stats[0].defensiveBlocks = 3;
  stats[0].totalTouches = 14;
  stats[0].sweetSpotHits = 4;
  stats[0].spikes = 2;
  stats[0].dives = 5;
  stats[0].divingHits = 2;

  stats[2].goals = 1;
  stats[2].assists = 2;
  stats[2].defensiveBlocks = 1;
  stats[2].totalTouches = 11;
  stats[2].sweetSpotHits = 3;
  stats[2].spikes = 4;
  stats[2].dives = 2;
  stats[2].divingHits = 1;

  stats[1].goals = 1;
  stats[1].assists = 0;
  stats[1].defensiveBlocks = 2;
  stats[1].totalTouches = 9;
  stats[1].sweetSpotHits = 1;

  stats[3].goals = 0;
  stats[3].assists = 1;
  stats[3].defensiveBlocks = 4;
  stats[3].totalTouches = 8;
  stats[3].sweetSpotHits = 2;

  const mockAthletes = [
    { getStrikeStats: () => ({ hits: 8, whiffs: 2 }) },  // P1: 80%
    { getStrikeStats: () => ({ hits: 5, whiffs: 5 }) },  // P2: 50%
    { getStrikeStats: () => ({ hits: 6, whiffs: 4 }) },  // P3: 60% -> Team 1 combined: 14H / 6W = 70%
    { getStrikeStats: () => ({ hits: 3, whiffs: 7 }) },  // P4: 30% -> Team 2 combined: 8H / 12W = 40%
  ];

  const configs = [
    { id: 'p1', team: 'home', primaryColor: 0xd90429, type: 'human' },
    { id: 'p2', team: 'away', primaryColor: 0x1d4ed8, type: 'human' },
    { id: 'p3', team: 'home', primaryColor: 0xd90429, type: 'human' },
    { id: 'p4', team: 'away', primaryColor: 0x1d4ed8, type: 'ai', difficulty: 'hard' },
  ];

  const report = buildMatchStatsReport({
    match: { scoreHome: 3, scoreAway: 1 },
    athleteMatchStats: stats,
    athletes: mockAthletes,
    playerConfigs: configs,
    activeCount: 4,
  });

  assert.equal(report.is2v2, true);
  assert.equal(report.players.length, 4);
  assert.deepEqual(
    [...report.teams.team1.players, ...report.teams.team2.players].map((p) => p.shortLabel),
    ['P1', 'P3', 'P2', 'P4'],
    'Team 1 (P1, P3) and Team 2 (P2, P4) group teammates together',
  );

  // Collective Team 1 (Home) aggregate stats
  const home = report.teams.home;
  assert.equal(home.goals, 3);
  assert.equal(home.playerGoals, 3);
  assert.equal(home.assists, 3);
  assert.equal(home.defensiveBlocks, 4);
  assert.equal(home.hits, 14);
  assert.equal(home.whiffs, 6);
  assert.equal(home.accuracy, 70);
  assert.equal(home.totalTouches, 25);
  assert.equal(home.sweetSpotHits, 7);
  assert.equal(home.spikes, 6);
  assert.equal(home.dives, 7);
  assert.equal(home.divingHits, 3);

  // Individual Player stats within Team 1
  assert.equal(home.players.length, 2);
  assert.equal(home.players[0].shortLabel, 'P1');
  assert.equal(home.players[0].goals, 2);
  assert.equal(home.players[0].assists, 1);
  assert.equal(home.players[0].defensiveBlocks, 3);
  assert.equal(home.players[0].accuracy, 80);
  assert.equal(home.players[1].shortLabel, 'P3');
  assert.equal(home.players[1].goals, 1);
  assert.equal(home.players[1].assists, 2);
  assert.equal(home.players[1].defensiveBlocks, 1);
  assert.equal(home.players[1].accuracy, 60);

  // Collective Team 2 (Away) aggregate stats
  const away = report.teams.away;
  assert.equal(away.goals, 1);
  assert.equal(away.playerGoals, 1);
  assert.equal(away.assists, 1);
  assert.equal(away.defensiveBlocks, 6);
  assert.equal(away.hits, 8);
  assert.equal(away.whiffs, 12);
  assert.equal(away.accuracy, 40);
  assert.equal(away.totalTouches, 17);

  // Resetting player stats zeroes all counters while preserving slot/team identity
  resetPlayerMatchStats(stats[2], 2);
  assert.equal(stats[2].goals, 0);
  assert.equal(stats[2].assists, 0);
  assert.equal(stats[2].defensiveBlocks, 0);
  assert.equal(stats[2].totalTouches, 0);
  assert.equal(stats[2].slotIndex, 2);
  assert.equal(stats[2].teamGroupId, 'team1');
});

test('Anti-head and limb shaking fix scales angular impulse by principal inertia and filters 2-tick/3-tick buzz', () => {
  // 1. Inertia-scaled angular PD spring in applyTracking
  const appliedTorques = {};
  const makeBody = (key, inertiaY) => ({
    translation: () => ({ x: 0, y: 1.0, z: 0 }),
    linvel: () => ({ x: 0, y: 0, z: 0 }),
    angvel: () => ({ x: 0, y: 0, z: 0 }),
    rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    mass: () => 2.0,
    principalInertia: () => ({ x: inertiaY, y: inertiaY, z: inertiaY }),
    principalInertiaLocalFrame: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    applyImpulse: () => {},
    applyTorqueImpulse: (imp) => {
      appliedTorques[key] = Math.hypot(imp.x, imp.y, imp.z);
    },
    setLinearDamping: () => {},
    setAngularDamping: () => {},
  });

  const pelvisInertia = TUNING.tracking.angularRefInertia; // 0.0793
  const headInertia = pelvisInertia * 0.05; // 5% of pelvis inertia
  const rig = new Map([
    ['pelvis', { group: 'torso', body: makeBody('pelvis', pelvisInertia) }],
    ['head', { group: 'head', body: makeBody('head', headInertia) }],
  ]);
  const motor = { body: makeBody('motor', pelvisInertia) };
  const targetQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.35);
  const animTarget = {
    standUpNeed: 0,
    standUpProgress: 0,
    divePhase: 0,
    diveMix: 0,
    slideMix: 0,
    targets: new Map([
      ['pelvis', { currPos: new THREE.Vector3(0, 1, 0), currQuat: targetQuat, vel: new THREE.Vector3(), angvel: new THREE.Vector3() }],
      ['head', { currPos: new THREE.Vector3(0, 1, 0), currQuat: targetQuat, vel: new THREE.Vector3(), angvel: new THREE.Vector3() }],
    ]),
  };

  const tracker = createTracker();
  tracker.weight = 1.0;
  applyTracking(tracker, rig, animTarget, motor, 1 / 60, false);

  assert.ok(appliedTorques.pelvis > 0, 'Pelvis receives reference angular torque impulse');
  assert.ok(appliedTorques.head > 0, 'Head receives scaled angular torque impulse');
  // Head groupStiffness is 0.8, inertiaScale is 0.05 -> head torque must be ~20x smaller than pelvis
  const ratio = appliedTorques.head / appliedTorques.pelvis;
  assert.ok(
    ratio < 0.06 && ratio > 0.03,
    `Head angular impulse should be scaled down by inertia ratio (~0.04..0.05), got ${ratio.toFixed(4)}`,
  );

  // 2. Render-side 4-tick [1, 2, 2, 1]/6 buzz filter in snapshotRagdoll
  let simX = 0;
  let simAngle = 0;
  const qTemp = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const obj3D = new THREE.Object3D();
  const item = {
    body: {
      translation: () => ({ x: simX, y: 1.5, z: 0 }),
      rotation: () => {
        qTemp.setFromAxisAngle(yAxis, simAngle);
        return { x: qTemp.x, y: qTemp.y, z: qTemp.z, w: qTemp.w };
      },
    },
    interpolated: new Interpolated(obj3D),
    buzzFilter: {
      head: 0,
      px: new Float64Array(4),
      py: new Float64Array(4).fill(1.5),
      pz: new Float64Array(4),
      qx: new Float64Array(4),
      qy: new Float64Array(4),
      qz: new Float64Array(4),
      qw: new Float64Array(4).fill(1),
    },
  };
  const state = { rig: new Map([['head', item]]) };

  // Feed a pure 2-tick alternating buzz (+0.1, -0.1, +0.1, -0.1) — [1, 2, 2, 1]/6 has an exact zero at period 2!
  for (const val of [0.1, -0.1, 0.1, -0.1]) {
    simX = val;
    simAngle = val;
    snapshotRagdoll(state);
  }
  assert.ok(
    Math.abs(item.interpolated.currPos.x) < 1e-12,
    `4-tick [1,2,2,1]/6 filter must zero out 2-tick position buzz, got ${item.interpolated.currPos.x}`,
  );
  assert.ok(
    Math.abs(item.interpolated.currQuat.y) < 1e-6,
    `4-tick [1,2,2,1]/6 filter must zero out 2-tick angular buzz, got ${item.interpolated.currQuat.y}`,
  );

  // Feed a pure 3-tick buzz (+0.12, -0.06, -0.06, +0.12) — [1, 2, 2, 1]/6 also has an exact zero at period 3!
  for (const val of [0.12, -0.06, -0.06, 0.12]) {
    simX = val;
    simAngle = val;
    snapshotRagdoll(state);
  }
  assert.ok(
    Math.abs(item.interpolated.currPos.x) < 1e-12,
    `4-tick [1,2,2,1]/6 filter must zero out 3-tick position buzz, got ${item.interpolated.currPos.x}`,
  );
  assert.ok(
    Math.abs(item.interpolated.currQuat.y) < 1e-4,
    `4-tick [1,2,2,1]/6 filter must zero out 3-tick angular buzz, got ${item.interpolated.currQuat.y}`,
  );
});

test('v0.4.0 AI aligns strike horizons (8/15/42), kinematic arrival braking, and 2v2 role coordination', () => {
  // 1. Verify TUNING.strike sweetTicks are 8 (kick), 15 (volley), 42 (spike)
  assert.equal(TUNING.strike.kick.sweetTick, 8);
  assert.equal(TUNING.strike.volley.sweetTick, 15);
  assert.equal(TUNING.strike.spike.sweetTick, 42);

  // 2. Verify sampleTrajectoryAtTick interpolates terrain-bounced trajectory nodes accurately
  // Home attacks North (z = -40) and defends South (z = +40), so goal-side is z_self > z_ball.
  const floorAtSelf = getCourtFloorY(0, 10);
  const ownAthlete = {
    id: 'p1',
    team: 'home',
    slotIndex: 0,
    isEnabled: true,
    motor: {
      grounded: true,
      body: {
        translation: () => ({ x: 0, y: floorAtSelf + 0.5, z: 10 }),
        linvel: () => ({ x: 0, y: 0, z: 0 }),
      },
    },
    tracker: { weight: 1.0 },
    animTarget: { yaw: Math.PI },
  };
  const oppAthlete = {
    id: 'p2',
    team: 'away',
    slotIndex: 1,
    isEnabled: true,
    motor: {
      grounded: true,
      body: {
        translation: () => ({ x: 0, y: getCourtFloorY(0, -25) + 0.5, z: -25 }),
        linvel: () => ({ x: 0, y: 0, z: 0 }),
      },
    },
    tracker: { weight: 1.0 },
    animTarget: { yaw: 0 },
  };
  const activeBalls = [{
    radius: 0.5,
    body: {
      // At t=15 ticks (0.25s), ball travels from z = 8.25 at vz = +4.0 to z = 9.25 (distXZ = 0.75m in front of self at z = 10)
      translation: () => ({ x: 0, y: floorAtSelf + 1.4, z: 8.25 }),
      linvel: () => ({ x: 0, y: 1.5, z: 4.0 }),
    },
  }];
  const matchState = {
    targetGoal: 'N',
    scoreHome: 0,
    scoreAway: 0,
    ticksRemaining: 9000,
    isCountingDown: false,
    matchOver: false,
  };

  const perception = createPerception();
  buildPerception(ownAthlete, oppAthlete, activeBalls, matchState, 100, perception);
  const outPos = new THREE.Vector3();
  const outVel = new THREE.Vector3();
  sampleTrajectoryAtTick(perception.trajectory, 15, outPos, outVel);
  assert.ok(outPos.z > 8.8 && outPos.z < 9.7, `15-tick trajectory sample Z should advance ~1.0m to ~9.25, got ${outPos.z}`);

  // 3. Verify kinematic arrival braking zeroes moveWorld when hurtling past stopping envelope
  const slot = {
    moveWorld: new THREE.Vector3(),
    moveX: 0,
    moveZ: 0,
    aimYaw: 0,
    cameraYaw: 0,
    hasAim: false,
    sprintHeld: false,
  };
  steerToward(
    slot,
    new THREE.Vector3(0, 0.5, 0),
    new THREE.Vector3(0, 0.5, 0.65), // 0.65m from target inside arriveRadius
    {
      arrive: true,
      arriveRadius: 1.2,
      currentVel: { x: 0, y: 0, z: 6.5 }, // closing at 6.5 m/s (stopping envelope at 0.65m is ~3.0m/s)
    },
  );
  assert.equal(slot.moveWorld.length(), 0, 'Kinematic arrival brake must zero moveWorld to engage ground brake');

  // 4. Verify 15-tick volley triggers when ball is entering the 15-tick sweet-spot window
  const bot = createBotController({ difficulty: 'hard', slotIndex: 0, seed: 42, aggressiveness: 0.6 });
  const inputSlot = {
    moveWorld: new THREE.Vector3(),
    moveX: 0,
    moveZ: 0,
    aimYaw: 0,
    cameraYaw: 0,
    hasAim: false,
    jumpQueued: false,
    sprintHeld: false,
    kickQueued: false,
    volleyQueued: false,
    spikeQueued: false,
    diveQueued: false,
    cutQueued: false,
    braceHeld: false,
  };
  updateBot(bot, ownAthlete, oppAthlete, activeBalls, matchState, inputSlot, 120, 1 / 60);
  assert.equal(inputSlot.volleyQueued, true, 'Hard bot must queue volley at 15-tick sweet-spot horizon');
});

test('Menu gamepad polling navigates Character Selection (Page 1) and Match Setup (Page 2) with object device mappings', () => {
  const prevNavigator = globalThis.navigator;
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevSetInterval = globalThis.setInterval;
  const prevClearInterval = globalThis.clearInterval;

  let pollTickFn = null;
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const fakePad = {
    index: 0,
    id: 'Xbox Wireless Controller',
    connected: true,
    axes: [0, 0, 0, 0],
    buttons,
  };

  const pressButton = (btnIdx) => {
    buttons[btnIdx].pressed = true;
    buttons[btnIdx].value = 1;
    pollTickFn();
    buttons[btnIdx].pressed = false;
    buttons[btnIdx].value = 0;
    pollTickFn();
  };

  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => [fakePad] },
    configurable: true,
  });
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    _updateSetupPage: () => {},
  };
  globalThis.document = {
    getElementById: () => null,
  };
  globalThis.setInterval = (fn) => {
    pollTickFn = fn;
    return 1234;
  };
  globalThis.clearInterval = () => {
    pollTickFn = null;
  };

  try {
    menuState.rootEl = { style: { display: 'flex' } };
    menuState.titleScreenEl = { style: { display: 'none' } };
    menuState.controllerAssignmentEl = { style: { display: 'none' } };

    // Simulate proceedToSetup() from controllerAssignment.js which stores a plain object `{ 0: ... }`
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, name: 'Gamepad 1', id: fakePad.id },
    });

    const cycledOptions = [];
    let matchBallCycles = 0;
    let durationCycles = 0;
    let readyToggles = 0;
    let launched = false;

    const mockPlayerSetup = {
      playerSetupEl: { style: { display: 'flex' } },
      currentSetupMode: 'match',
      setupPage: 1,
      focusedColumn: 0,
      playerFocusRow: [4, 2, 2, 2],
      screen1ActionCol: 1,
      matchRulesFocusRow: 0,
      matchRulesActionCol: 2,
      matchCountdownActive: false,
      playerReadyState: [false, true, true, true],
      playerConfigs: [
        { type: 'human', difficulty: 'medium' },
        { type: 'ai', difficulty: 'medium' },
      ],
      btnStartMatch: {
        disabled: true,
        click: () => { launched = true; },
      },
      btnBack: { click: () => {} },
      getActiveMatchPlayerCount: () => 2,
      isVersusLobby: () => false,
      updateInputBadgesUI: () => {},
      updateFocusUI: () => {},
      updateReadyUI: () => {},
      cycleOption: (col, row, dir) => {
        cycledOptions.push({ col, row, dir });
      },
      cycleMatchBall: (dir) => { matchBallCycles += dir; },
      cycleMatchDuration: (dir) => { durationCycles += dir; },
      cycleArena: () => {},
      togglePlayerReady: (slotIdx) => {
        readyToggles++;
        mockPlayerSetup.playerReadyState[slotIdx] = !mockPlayerSetup.playerReadyState[slotIdx];
        mockPlayerSetup.btnStartMatch.disabled = !mockPlayerSetup.playerReadyState[slotIdx];
      },
      launchMatchNow: () => { launched = true; },
    };

    setMenuNavigationContext({ playerSetup: mockPlayerSetup });
    startMenuGamepadPolling();
    assert.equal(typeof pollTickFn, 'function', 'Gamepad polling loop must register');

    // 1. Page 1 (Character Selection): D-pad Right (15) on Row 4 (Hat) cycles P1's Hat
    pressButton(15);
    assert.deepEqual(cycledOptions[0], { col: 0, row: 4, dir: 1 }, 'D-pad Right on Page 1 cycles P1 Hat (row 4)');

    // 2. Page 1: D-pad Down (13) moves P1 from Row 4 (Hat) to Row 5 (Build), and A (0) cycles P1 Build
    pressButton(13);
    assert.equal(mockPlayerSetup.playerFocusRow[0], 5, 'D-pad Down moves P1 focus from Hat (4) to Build (5)');
    pressButton(0);
    assert.deepEqual(cycledOptions[1], { col: 0, row: 5, dir: 1 }, 'A button on Page 1 cycles P1 Build (row 5)');

    // 3. Page 1: RB (5) switches focus to AI P2 (col 1) and D-pad Right (15) cycles AI difficulty (row 2)
    pressButton(5);
    assert.equal(mockPlayerSetup.focusedColumn, 1, 'RB switches active column from P1 (0) to AI P2 (1)');
    pressButton(15);
    assert.deepEqual(cycledOptions[2], { col: 1, row: 2, dir: 1 }, 'D-pad Right on AI P2 cycles AI difficulty (row 2)');

    // 4. Page 1: Start (9) advances to Page 2 (Match Setup / Rules)
    pressButton(9);
    assert.equal(mockPlayerSetup.setupPage, 2, 'Start on Page 1 advances to Page 2 (Match Setup)');

    // 5. Page 2 (Match Setup): D-pad Right (15) cycles Match Ball, D-pad Down (13) moves to Duration and cycles it
    pressButton(15);
    assert.equal(matchBallCycles, 1, 'D-pad Right on Page 2 Row 0 cycles Match Ball');
    pressButton(13);
    assert.equal(mockPlayerSetup.matchRulesFocusRow, 1, 'D-pad Down on Page 2 moves focus to Match Duration (row 1)');
    pressButton(15);
    assert.equal(durationCycles, 1, 'D-pad Right on Page 2 Row 1 cycles Match Duration');

    // 6. Page 2: X (2) toggles P1 Ready, and Start (9) launches the match
    pressButton(2);
    assert.equal(readyToggles, 1, 'X button on Page 2 toggles P1 Ready');
    assert.equal(mockPlayerSetup.playerReadyState[0], true);
    pressButton(9);
    assert.equal(launched, true, 'Start button on Page 2 launches match once Ready');

    // 7. Also verify that if a solo human slot was left on default Keyboard mapping and a pad is used in the lobby,
    //    the pad auto-binds to slot 0 and drives both the lobby and gameplay.
    mockPlayerSetup.setupPage = 1;
    setExplicitDeviceMappings({
      0: { type: 'keyboard', keyId: 'kb1', name: 'Keyboard 1 (WASD)' },
    });
    assert.equal(getAssignedSlotForPad(0), -1);
    pressButton(15);
    assert.equal(getAssignedSlotForPad(0), 0, 'Unassigned pad driving keyboard-mapped P1 auto-binds to slot 0');
  } finally {
    stopSetupGamepadPolling();
    setExplicitDeviceMappings(null);
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
