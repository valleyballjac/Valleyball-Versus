/**
 * Regression tests for Stage 4 Broadcast Replay Suite (Free-Fly Caster Drone,
 * Speed / Pause Transport outside frozen Loop.js, Deterministic Seek, and Overtime Spawns).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ReplayRecorder,
  encodeReplayBinary,
  decodeReplayBinary,
  inspectReplayHeader,
} from '../src/core/replay.js';
import {
  PoseReplayRecorder,
  PoseReplayPlayer,
  POSE_PART_KEYS,
  REPLAY_POSE_FORMAT_VERSION,
} from '../src/core/replayPose.js';
import { replayManager, REPLAY_CAMERAS, REPLAY_SPEEDS } from '../src/features/match/replayManager.js';
import { recordBallTeamTouch } from '../src/mechanics/scoring.js';
import { describeGoalScorer } from '../src/ui/replayDock.js';
import * as THREE from 'three';
import { CinematicCamera } from '../src/visuals/cinematicCamera.js';

test('ReplayRecorder.recordOvertime preserves exact spawns through binary v2 encode/decode', async () => {
  const rec = new ReplayRecorder({
    seed: 12345,
    mode: '1v1',
    playerCount: 2,
    ball: 'medium',
    durationSeconds: 180,
  });
  rec.recordSlot(0, { moveX: 0.5, moveZ: -0.25, aimYaw: 1.2, cameraYaw: 1.2 });
  rec.recordSlot(1, { moveX: -0.5, moveZ: 0.25, aimYaw: -1.2, cameraYaw: -1.2 });
  rec.commitTick();

  const otSpawns = [
    { pos: { x: -10.5, y: 2.1, z: 34.0 }, facingYaw: Math.PI, cameraAzimuth: 0 },
    { pos: { x: 10.5, y: 2.1, z: -34.0 }, facingYaw: 0, cameraAzimuth: Math.PI },
  ];
  rec.recordOvertime({
    format: 'golden_goal',
    durationSeconds: 120,
    positionMode: 'respawn',
    dropPos: { x: 0, y: 10, z: 0 },
    spawns: otSpawns,
  });

  const payload = rec.finalize({ scoreHome: 1, scoreAway: 1, winner: 'home' });
  const bytes = await encodeReplayBinary(payload, { compress: true });
  const decoded = await decodeReplayBinary(bytes);

  assert.equal(decoded.meta.overtimeDecisions.length, 1);
  assert.deepEqual(decoded.meta.overtimeDecisions[0].spawns, otSpawns);
});

test('replayManager playback speeds (0.25x..4x), pause, and deterministic seekToFrame work accurately', async () => {
  const rec = new ReplayRecorder({
    seed: 777,
    mode: '1v1',
    playerCount: 2,
    ball: 'medium',
    durationSeconds: 60,
  });
  for (let i = 0; i < 60; i++) {
    rec.recordSlot(0, { moveX: 0, moveZ: 1, aimYaw: 0, cameraYaw: 0 });
    rec.recordSlot(1, { moveX: 0, moveZ: -1, aimYaw: 0, cameraYaw: 0 });
    rec.commitTick();
  }
  rec.recordGoal({ scoredFor: 'home', goal: 'N', scoreHome: 1, scoreAway: 0 });
  const payload = rec.finalize({ scoreHome: 1, scoreAway: 0, winner: 'home' });

  await replayManager.preparePlayback(payload);
  assert.equal(replayManager.isPlayingBack(), true);

  // 1x = 1 step per tick
  assert.equal(replayManager.consumePlaybackSteps(), 1);

  // 0.25x = 1 step every 4 ticks
  replayManager.setPlaybackSpeed(0.25);
  const steps25 = [0, 1, 2, 3].map(() => replayManager.consumePlaybackSteps());
  assert.deepEqual(steps25, [0, 0, 0, 1]);

  // 0.5x = 1 step every 2 ticks
  replayManager.setPlaybackSpeed(0.5);
  const steps50 = [0, 1, 2, 3].map(() => replayManager.consumePlaybackSteps());
  assert.deepEqual(steps50, [0, 1, 0, 1]);

  // 4x = 4 steps per tick
  replayManager.setPlaybackSpeed(4);
  assert.equal(replayManager.consumePlaybackSteps(), 4);

  // Paused = 0 steps
  replayManager.setPlaybackPaused(true);
  assert.equal(replayManager.consumePlaybackSteps(), 0);

  // Deterministic seekToFrame resets to tick 0 and steps exact target frames silently
  let resets = 0;
  let stepped = 0;
  let wasSeekingInsideStep = false;
  const ok = replayManager.seekToFrame(25, {
    resetMatchForSeek: () => { resets += 1; },
    stepOneReplayTick: () => {
      wasSeekingInsideStep = replayManager.isSeeking();
      replayManager.readPlaybackTick();
      stepped += 1;
    },
  });
  assert.equal(ok, true);
  assert.equal(resets, 1);
  assert.equal(stepped, 25);
  assert.equal(wasSeekingInsideStep, true);
  assert.equal(replayManager.isSeeking(), false);
  assert.equal(replayManager.getPlaybackStatus().cursor, 25);

  replayManager.stopPlayback();
  assert.equal(replayManager.isPlayingBack(), false);
});

test('CinematicCamera Free-Fly Caster Drone moves smoothly, zooms FOV, and stays clamped inside stadium', () => {
  const cam = new CinematicCamera();
  cam.startFreeFly();
  assert.equal(cam.mode, 'free');

  const startPos = cam.camera.position.clone();
  for (let i = 0; i < 30; i++) {
    cam.updateFreeFly(1 / 60, { moveForward: 1, moveUp: 0.5, fast: true });
  }
  assert.ok(cam.camera.position.distanceTo(startPos) > 2.0, 'Free drone must fly forward smoothly');

  // Extreme altitude/lateral drive clamps cleanly inside stadium envelope
  for (let i = 0; i < 600; i++) {
    cam.updateFreeFly(1 / 60, { moveRight: 1, moveUp: 1, fast: true });
  }
  assert.ok(Math.abs(cam.camera.position.x) <= 28.501);
  assert.ok(cam.camera.position.y >= 0.999 && cam.camera.position.y <= 54.001);
  assert.ok(Math.abs(cam.camera.position.z) <= 62.001);

  cam.adjustFreeFov(-20);
  assert.equal(cam.freeFov, 42);
  cam.adjustFreeFov(-50);
  assert.equal(cam.freeFov, 32, 'FOV lower bound clamped at 32 deg');
  cam.adjustFreeFov(200);
  assert.equal(cam.freeFov, 92, 'FOV upper bound clamped at 92 deg');

  cam.stopFreeFly();
  assert.equal(cam.mode, 'idle');
});

test('Director Suite supports all 7 camera presets and P1..P4 athlete targeting with auto-chase switch', async () => {
  assert.deepEqual(REPLAY_CAMERAS, [
    'broadcast',
    'sports',
    'tactical',
    'chase',
    'thirdPerson',
    'firstPerson',
    'free',
  ]);

  const rec = new ReplayRecorder({
    seed: 901,
    mode: '2v2',
    playerCount: 4,
    ball: 'medium',
    durationSeconds: 60,
  });
  for (let s = 0; s < 4; s++) {
    rec.recordSlot(s, { moveX: 0, moveZ: 0, aimYaw: 0, cameraYaw: 0 });
  }
  rec.commitTick();
  const payload = rec.finalize({ scoreHome: 0, scoreAway: 0, winner: 'draw' });
  await replayManager.preparePlayback(payload);

  const synced = [];
  const camModes = [null, null, null, null];
  const mockPlayerCams = [0, 1, 2, 3].map((i) => ({
    camera: { id: `cam${i}` },
    setMode(m) { camModes[i] = m; },
    resetSmoothing() {},
  }));
  const ctx = {
    cinematicCamera: { startFreeFly() {}, stopFreeFly() {} },
    playerCameras: mockPlayerCams,
    syncPlayerCameraMode: (slot, mode) => synced.push({ slot, mode }),
    applyViewportSize: () => {},
  };

  // Starting in broadcast on slot 0 -> selecting P2 (slot 1) auto-switches to chase on slot 1!
  assert.equal(replayManager.getCameraPreset(), 'broadcast');
  assert.equal(replayManager.getFollowSlot(), 0);
  replayManager.applyFollowSlot(1, ctx);
  assert.equal(replayManager.getFollowSlot(), 1);
  assert.equal(replayManager.getCameraPreset(), 'chase');
  assert.equal(camModes[1], 'chase');

  // Switching to 1st-Person POV targets slot 1, then cycling slot -> slot 2 stays in 1st-Person POV!
  replayManager.applyCameraPreset('firstPerson', ctx);
  assert.equal(camModes[1], 'firstPerson');
  const nextSlot = replayManager.cycleFollowSlot(1);
  assert.equal(nextSlot, 2);
  replayManager.applyFollowSlot(nextSlot, ctx);
  assert.equal(replayManager.getCameraPreset(), 'firstPerson');
  assert.equal(camModes[2], 'firstPerson');
  assert.equal(synced.at(-1).slot, 2);
  assert.equal(synced.at(-1).mode, 'firstPerson');

  // Cycle camera preset wraps cleanly across all 7 modes
  replayManager.setCameraPreset('free');
  assert.equal(replayManager.cycleCameraPreset(1), 'broadcast');
  assert.equal(replayManager.cycleCameraPreset(-1), 'free');

  replayManager.stopPlayback();
});

test('v3 World-State Pose Replay round-trips ball, 16 ragdoll parts, scores, instant seek, and continuous rewind cleanly', async () => {
  const makeMockAthlete = (startX) => {
    const rig = new Map();
    for (const key of POSE_PART_KEYS) {
      rig.set(key, {
        mesh: { position: new THREE.Vector3(startX, 1.0, 0), quaternion: new THREE.Quaternion() },
        interpolated: {
          prevPos: new THREE.Vector3(startX, 1.0, 0),
          currPos: new THREE.Vector3(startX, 1.0, 0),
          prevQuat: new THREE.Quaternion(),
          currQuat: new THREE.Quaternion(),
        },
      });
    }
    return {
      isEnabled: true,
      motor: {
        mesh: { position: new THREE.Vector3(startX, 1.0, 0) },
        interpolated: { prevPos: new THREE.Vector3(startX, 1.0, 0), currPos: new THREE.Vector3(startX, 1.0, 0) },
      },
      animTarget: { yaw: 0 },
      ragdoll: { rig, group: { visible: true } },
    };
  };

  const makeMockBall = () => ({
    mesh: { visible: true, position: new THREE.Vector3(0, 10, 0), quaternion: new THREE.Quaternion() },
    interpolated: {
      prevPos: new THREE.Vector3(0, 10, 0),
      currPos: new THREE.Vector3(0, 10, 0),
      prevQuat: new THREE.Quaternion(),
      currQuat: new THREE.Quaternion(),
    },
  });

  const athletes = [makeMockAthlete(-10), makeMockAthlete(10)];
  const balls = [makeMockBall()];
  const matchState = {
    ticksRemaining: 18000,
    scoreHome: 0,
    scoreAway: 0,
    targetGoal: 'N',
    celebrationTicks: 0,
    lastScoredFor: null,
    lastGoalId: null,
    isGoldenGoal: false,
    overtimePeriod: 0,
    matchOver: false,
  };

  const recorder = new PoseReplayRecorder({
    seed: 2026,
    mode: '1v1',
    playerCount: 2,
    ball: 'medium',
    durationSeconds: 300,
  });

  // Record 120 ticks (2 seconds) with continuous motion + a goal at tick 60
  for (let t = 0; t < 120; t++) {
    matchState.ticksRemaining = 18000 - t;
    balls[0].interpolated.currPos.set(t * 0.25 - 10, 5 + Math.sin(t * 0.1), -t * 0.3);
    balls[0].interpolated.currQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t * 0.08);
    athletes[0].motor.interpolated.currPos.set(-10 + t * 0.15, 1.0, t * 0.2);
    athletes[0].animTarget.yaw = t * 0.02;
    athletes[0].ragdoll.rig.get('head').interpolated.currPos.set(-10 + t * 0.15, 2.55, t * 0.2 + 0.12);
    athletes[1].motor.interpolated.currPos.set(10 - t * 0.1, 1.0, -t * 0.15);

    if (t === 60) {
      matchState.scoreHome = 1;
      matchState.targetGoal = 'S';
      matchState.celebrationTicks = 180;
      matchState.lastScoredFor = 'home';
      matchState.lastGoalId = 'N';
      recorder.recordGoal({ scoredFor: 'home', goal: 'N', scoreHome: 1, scoreAway: 0 });
    }
    recorder.recordTick({ athletes, balls, matchState, forceCapture: t === 60 });
  }

  const finalized = recorder.finalize({ scoreHome: 1, scoreAway: 0, winner: 'home' });
  const bytes = await encodeReplayBinary(finalized, { compress: true });
  const header = inspectReplayHeader(bytes);
  assert.equal(header.version, REPLAY_POSE_FORMAT_VERSION);
  assert.equal(header.strideBytes, 516);

  const decoded = await decodeReplayBinary(bytes);
  await replayManager.preparePlayback({ bytes, filename: 'test_v3.vbreplay' });
  assert.equal(replayManager.isPosePlayback(), true);
  assert.equal(replayManager.consumePlaybackSteps(), 0, 'v3 pose playback must bypass Rapier physics stepping');

  // Instant seek to tick 60 -> exact ball pos, athlete head pos, and 1-0 scoreboard!
  const pbAthletes = [makeMockAthlete(0), makeMockAthlete(0)];
  const pbBalls = [makeMockBall()];
  const pbMatch = { ...matchState, scoreHome: 0, scoreAway: 0, targetGoal: 'N' };
  const ctx = { athletes: pbAthletes, balls: pbBalls, matchState: pbMatch };

  assert.equal(replayManager.seekToFrame(60, ctx), true);
  assert.equal(pbMatch.scoreHome, 1);
  assert.equal(pbMatch.targetGoal, 'S');
  assert.ok(Math.abs(pbBalls[0].mesh.position.x - (60 * 0.25 - 10)) < 0.002);
  assert.ok(Math.abs(pbAthletes[0].ragdoll.rig.get('head').mesh.position.y - 2.55) < 0.002);

  // Instant seek back to tick 10 (before goal!) -> 0-0 score and exact interpolated tick-10 position!
  assert.equal(replayManager.seekToFrame(10, ctx), true);
  assert.equal(pbMatch.scoreHome, 0);
  assert.equal(pbMatch.targetGoal, 'N');
  assert.ok(Math.abs(pbBalls[0].mesh.position.x - (10 * 0.25 - 10)) < 0.002);

  // Continuous Rewind (-1x -> -2x -> -4x) and Fast-Forward (2x -> 4x -> 1x)
  replayManager.seekToFrame(80, ctx);
  assert.equal(replayManager.cycleRewind(), -1);
  assert.equal(replayManager.cycleRewind(), -2);
  replayManager.advancePosePlayback(0.5, ctx); // 0.5s at -2x = -60 ticks -> cursor = 20!
  assert.ok(Math.abs(replayManager.getPlaybackStatus().cursor - 20) < 0.5, 'Continuous rewind must scrub smoothly backwards');

  assert.equal(replayManager.cycleFastForward(), 2);
  assert.equal(replayManager.cycleFastForward(), 4);
  assert.equal(replayManager.cycleFastForward(), 1);

  // Dedicated Slow-Mo cycle (0.5x -> 0.25x -> 0.1x -> 1x) & smooth 0.1x progression
  assert.ok(REPLAY_SPEEDS.includes(0.1), 'REPLAY_SPEEDS must include 0.1x ultra slow-mo');
  assert.equal(replayManager.cycleSlowMo(), 0.5);
  assert.equal(replayManager.cycleSlowMo(), 0.25);
  assert.equal(replayManager.cycleSlowMo(), 0.1);
  replayManager.seekToFrame(20, ctx);
  replayManager.advancePosePlayback(1.0, ctx); // 1.0s at 0.1x = +6 ticks -> cursor = 26
  assert.ok(Math.abs(replayManager.getPlaybackStatus().cursor - 26) < 0.2, '0.1x slow-mo must advance smoothly at 1/10th speed');
  assert.equal(replayManager.cycleSlowMo(), 1);

  replayManager.stopPlayback();
});

test('Replay Director camera height movement (+ / -), clamping, and reset work across tracked and Free Drone cameras', () => {
  const mockCams = [{ heightOffset: 0 }, { heightOffset: 0 }];
  assert.equal(replayManager.getCameraHeightOffset(), 0);

  assert.equal(replayManager.adjustCameraHeightOffset(3.5, mockCams), 3.5);
  assert.equal(mockCams[0].heightOffset, 3.5);
  assert.equal(mockCams[1].heightOffset, 3.5);

  // Upper and lower clamping bounds (-8m to +24m)
  assert.equal(replayManager.adjustCameraHeightOffset(100, mockCams), 24);
  assert.equal(mockCams[0].heightOffset, 24);
  assert.equal(replayManager.adjustCameraHeightOffset(-100, mockCams), -8);
  assert.equal(mockCams[1].heightOffset, -8);

  // Exiting replay resets height offset strictly back to 0 so live matches are unaffected
  replayManager.stopPlayback(mockCams);
  assert.equal(replayManager.getCameraHeightOffset(), 0);
  assert.equal(mockCams[0].heightOffset, 0);
  assert.equal(mockCams[1].heightOffset, 0);

  // Free Drone height nudge and clamp
  const drone = new CinematicCamera();
  drone.startFreeFly();
  drone.setFreeHeight(12);
  assert.equal(drone.getFreeHeight(), 12);
  assert.equal(drone.nudgeFreeHeight(2.5), 14.5);
  assert.equal(drone.nudgeFreeHeight(-100), 1.0);
  assert.equal(drone.nudgeFreeHeight(200), 54.0);
});

test('Goal scorer attribution records touches cleanly and formats scorer/assist/kit colors for Replay Director', () => {
  const mockBall = {};
  recordBallTeamTouch(mockBall, 'home', 0);
  recordBallTeamTouch(mockBall, 'home', 0); // duplicate same-player touch must not overwrite assist
  assert.equal(mockBall._lastTouchByTeam.home, 0);
  assert.equal(mockBall._prevTouchByTeam.home, null);

  recordBallTeamTouch(mockBall, 'home', 2); // teammate touch -> slot 0 becomes assist!
  assert.equal(mockBall._lastTouchByTeam.home, 2);
  assert.equal(mockBall._prevTouchByTeam.home, 0);

  const meta = {
    playerCount: 4,
    players: [
      { slot: 0, team: 'home', displayName: 'P1', primaryColor: 0xd90429 },
      { slot: 1, team: 'away', displayName: 'P2', primaryColor: 0xffffff },
      { slot: 2, team: 'home', displayName: 'P3', primaryColor: 0xf59e0b },
      { slot: 3, team: 'away', displayName: 'P4', primaryColor: 0x1d4ed8 },
    ],
  };

  const homeGoal = describeGoalScorer(
    { scoredFor: 'home', goal: 'N', scoreHome: 2, scoreAway: 1, scorerSlot: 2, assistSlot: 0 },
    meta,
  );
  assert.equal(homeGoal.shortTag, 'P3');
  assert.equal(homeGoal.fullLabel, 'P3 (HOME)');
  assert.equal(homeGoal.assistTag, 'P1');
  assert.equal(homeGoal.colorHex, '#f59e0b');
  assert.equal(homeGoal.scoreLabel, '2-1');
  assert.equal(homeGoal.hoopLabel, 'North Hoop');

  // Bright/white kit automatically selects dark contrast label ink
  const whiteKitGoal = describeGoalScorer(
    { scoredFor: 'away', goal: 'S', scoreHome: 2, scoreAway: 2, scorerSlot: 1, assistSlot: null },
    meta,
  );
  assert.equal(whiteKitGoal.shortTag, 'P2');
  assert.equal(whiteKitGoal.fullLabel, 'P2 (AWAY)');
  assert.equal(whiteKitGoal.colorHex, '#ffffff');
  assert.equal(whiteKitGoal.textHex, '#090d16');

  // Unattributed / own-goal fallback shows team cleanly
  const unattributed = describeGoalScorer(
    { scoredFor: 'away', goal: 'S', scoreHome: 2, scoreAway: 3, scorerSlot: null, assistSlot: null },
    meta,
  );
  assert.equal(unattributed.shortTag, 'AWAY');
  assert.equal(unattributed.fullLabel, 'AWAY TEAM');
});
