import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  REPLAY_FORMAT_VERSION,
  REPLAY_COMPRESSION,
  REPLAY_BYTES_PER_SLOT,
  ReplayRecorder,
  ReplayPlayer,
  packReplaySlot,
  unpackReplaySlot,
  createReplaySlotFrame,
  encodeReplayBinary,
  decodeReplayBinary,
  inspectReplayHeader,
} from '../src/core/replay.js';
import {
  replayManager,
  buildReplayFilename,
  generateMatchSeed,
} from '../src/features/match/replayManager.js';
import {
  sampleAllInputs,
  setExplicitDeviceMappings,
  getExplicitDeviceMappings,
  getInputSlot,
  clearGameplayInputQueues,
} from '../src/input/inputRouter.js';

test('packReplaySlot and unpackReplaySlot round-trip world movement, yaws, held, and queued flags', () => {
  const buf = new Uint8Array(REPLAY_BYTES_PER_SLOT * 2);
  packReplaySlot(
    buf,
    0,
    {
      moveWorld: { x: -0.65, y: 0, z: 0.9 },
      cameraYaw: 1.75,
      aimYaw: -2.2,
      hasAim: true,
      sprintHeld: true,
      slideHeld: false,
      braceHeld: true,
    },
    {
      jumpQueued: true,
      diveQueued: false,
      cutQueued: true,
      volleyQueued: false,
      spikeQueued: true,
      facingFollowsCamera: true,
    },
  );
  packReplaySlot(
    buf,
    REPLAY_BYTES_PER_SLOT,
    {
      moveWorld: { x: 0.25, y: 0, z: -0.5 },
      cameraYaw: -0.8,
      aimYaw: 0,
      hasAim: false,
      sprintHeld: false,
      slideHeld: true,
      braceHeld: false,
    },
    {
      jumpQueued: false,
      diveQueued: true,
      cutQueued: false,
      volleyQueued: true,
      spikeQueued: false,
      facingFollowsCamera: false,
    },
  );

  const f0 = createReplaySlotFrame();
  const f1 = createReplaySlotFrame();
  unpackReplaySlot(buf, 0, f0);
  unpackReplaySlot(buf, REPLAY_BYTES_PER_SLOT, f1);

  assert.ok(Math.abs(f0.inputSnapshot.moveWorld.x - -0.65) < 0.015);
  assert.ok(Math.abs(f0.inputSnapshot.moveWorld.z - 0.9) < 0.015);
  assert.ok(Math.abs(f0.inputSnapshot.cameraYaw - 1.75) < 0.001);
  assert.equal(f0.inputSnapshot.hasAim, true);
  assert.ok(Math.abs(f0.inputSnapshot.aimYaw - -2.2) < 0.001);
  assert.equal(f0.inputSnapshot.sprintHeld, true);
  assert.equal(f0.inputSnapshot.slideHeld, false);
  assert.equal(f0.inputSnapshot.braceHeld, true);
  assert.equal(f0.facingFollowsCamera, true);
  assert.equal(f0.jumpQueued, true);
  assert.equal(f0.cutQueued, true);
  assert.equal(f0.spikeQueued, true);
  assert.equal(f0.diveQueued, false);

  assert.ok(Math.abs(f1.inputSnapshot.moveWorld.x - 0.25) < 0.015);
  assert.ok(Math.abs(f1.inputSnapshot.moveWorld.z - -0.5) < 0.015);
  assert.equal(f1.inputSnapshot.hasAim, false);
  assert.equal(f1.inputSnapshot.slideHeld, true);
  assert.equal(f1.facingFollowsCamera, false);
  assert.equal(f1.diveQueued, true);
  assert.equal(f1.volleyQueued, true);
});

test('.vbreplay binary container encodes, compresses, inspects header fast, and decodes identically', async () => {
  const recorder = new ReplayRecorder({
    appVersion: '0.4.1',
    recordedAt: '2026-11-18T19:00:00.000Z',
    seed: 20261227,
    mode: '2v2',
    playerCount: 4,
    arena: 'court',
    ball: 'medium',
    durationSeconds: 300,
    players: [
      { slot: 0, team: 'home', type: 'human', displayName: 'Jac' },
      { slot: 1, team: 'away', type: 'human', displayName: 'Alex' },
      { slot: 2, team: 'home', type: 'human', displayName: 'Sam' },
      { slot: 3, team: 'away', type: 'human', displayName: 'Riley' },
    ],
  }, 120);

  for (let t = 0; t < 180; t++) {
    for (let s = 0; s < 4; s++) {
      recorder.recordSlot(
        s,
        {
          moveWorld: { x: s % 2 === 0 ? 0.5 : -0.5, y: 0, z: t > 90 ? -1 : 1 },
          cameraYaw: s * 0.5,
          aimYaw: 0,
          hasAim: false,
          sprintHeld: t % 3 === 0,
          slideHeld: false,
          braceHeld: false,
        },
        {
          jumpQueued: t === 30 && s === 0,
          spikeQueued: t === 60 && s === 2,
          facingFollowsCamera: true,
        },
      );
    }
    if (t === 65) {
      recorder.recordGoal({ scoredFor: 'home', goal: 'N', scoreHome: 1, scoreAway: 0, scorerSlot: 2, assistSlot: 0 });
    }
    if (t === 150) {
      recorder.recordOvertime({ format: 'golden_goal', durationSeconds: 120, positionMode: 'respawn', dropPos: { x: 1, y: 10, z: -2 } });
    }
    recorder.commitTick();
  }

  const finalized = recorder.finalize({ scoreHome: 2, scoreAway: 1, winner: 'home' });
  const encodedCompressed = await encodeReplayBinary(finalized, { compress: true });
  const encodedRaw = await encodeReplayBinary(finalized, { compress: false });

  // Fast header inspection without full decode
  const info = inspectReplayHeader(encodedCompressed);
  assert.equal(info.version, REPLAY_FORMAT_VERSION);
  assert.equal(info.frameCount, 180);
  assert.equal(info.strideBytes, 4 * REPLAY_BYTES_PER_SLOT);
  assert.equal(info.meta.seed, 20261227);
  assert.equal(info.meta.goals.length, 1);
  assert.equal(info.meta.goals[0].frame, 65);
  assert.equal(info.meta.overtimeDecisions.length, 1);
  assert.equal(info.meta.summary.scoreHome, 2);

  // Compressed file should be significantly smaller than raw frame bytes when CompressionStream exists
  if (typeof CompressionStream === 'function') {
    assert.equal(info.compression, REPLAY_COMPRESSION.GZIP);
    assert.ok(encodedCompressed.byteLength < encodedRaw.byteLength);
  }

  // Round-trip decode & ReplayPlayer cursor verification
  const decoded = await decodeReplayBinary(encodedCompressed);
  assert.equal(decoded.frameCount, 180);
  assert.deepEqual(decoded.frames, finalized.frames);

  const player = new ReplayPlayer(decoded);
  let sawJump = false;
  let sawSpike = false;
  for (let t = 0; t < 180; t++) {
    const ot = player.getOvertimeDecisionAt(t);
    if (t === 150) assert.equal(ot?.format, 'golden_goal');
    const slots = player.readNextTick();
    assert.ok(slots);
    if (t === 30 && slots[0].jumpQueued) sawJump = true;
    if (t === 60 && slots[2].spikeQueued) sawSpike = true;
  }
  assert.equal(sawJump, true);
  assert.equal(sawSpike, true);
  assert.equal(player.isComplete, true);
  assert.equal(player.readNextTick(), null);

  // Corrupt magic rejected loudly
  const bad = encodedRaw.slice();
  bad[0] = 0x00;
  assert.throws(() => inspectReplayHeader(bad), /bad magic/);
});

test('replayManager builds safe filenames and prepares playback cleanly', async () => {
  const seed = generateMatchSeed(12345);
  assert.equal(seed, 12345);

  const name = buildReplayFilename(
    { recordedAt: '2026-11-18T19:30:05.123Z', mode: '2v2', ball: 'medium' },
    { scoreHome: 4, scoreAway: 3 },
  );
  assert.match(name, /^[A-Za-z0-9._-]+\.vbreplay$/);
  assert.equal(name, 'vb_2026-11-18_19-30-05_2v2_medium_4-3.vbreplay');

  replayManager.beginMatchRecording({
    seed: 99,
    recordingMode: 'input',
    configs: [
      { team: 'home', type: 'human', displayName: 'Home' },
      { team: 'away', type: 'human', displayName: 'Away' },
    ],
    playerCount: 2,
    ball: 'medium',
    durationSeconds: 180,
    initialDrop: { x: 0, y: 10, z: 0 },
    initialSpawns: [
      { pos: { x: -12.5, y: 8.2, z: 39.5 }, facingYaw: 0.2, cameraAzimuth: 0.2 },
      { pos: { x: 12.5, y: 8.2, z: -39.5 }, facingYaw: -2.9, cameraAzimuth: -2.9 },
    ],
  });
  replayManager.recordSlot(0, { moveWorld: { x: 0, y: 0, z: -1 }, cameraYaw: 0 }, { jumpQueued: true });
  replayManager.recordSlot(1, { moveWorld: { x: 0, y: 0, z: 1 }, cameraYaw: Math.PI }, {});
  replayManager.commitTick();

  const saved = await replayManager.finishMatchRecording({ scoreHome: 1, scoreAway: 0, winner: 'home' });
  assert.ok(saved && saved.bytes instanceof Uint8Array);
  const prep = await replayManager.preparePlayback(saved.bytes);
  assert.equal(prep.seed, 99);
  assert.equal(prep.rules.ball, 'medium');
  assert.equal(prep.rules.isReplay, true);
  assert.equal(prep.initialSpawns?.length, 2);
  assert.equal(prep.initialSpawns[0].pos.x, -12.5);
  assert.equal(prep.initialSpawns[1].facingYaw, -2.9);
  assert.equal(replayManager.isPlayingBack(), true);
  const tick0 = replayManager.readPlaybackTick();
  assert.equal(tick0[0].jumpQueued, true);
  replayManager.stopPlayback();
  assert.equal(replayManager.isPlayingBack(), false);
});

test('inputRouter self-heals a USB-hub gamepad that reconnects at a different pad index', () => {
  const prevNavigator = globalThis.navigator;
  const makePad = (index, id, axisX = 0) => ({
    index,
    id,
    connected: true,
    axes: [axisX, 0, 0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
  });

  let activePads = [
    makePad(0, 'Xbox Controller A', 0),
    makePad(3, 'Xbox Controller B', 0.85), // Reconnected at index 3 instead of index 1
  ];
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => activePads },
    configurable: true,
  });

  try {
    clearGameplayInputQueues();
    setExplicitDeviceMappings({
      0: { type: 'gamepad', padIndex: 0, name: 'Gamepad 1', id: 'Xbox Controller A' },
      1: { type: 'gamepad', padIndex: 1, name: 'Gamepad 2', id: 'Xbox Controller B' },
    });
    const cam = new THREE.PerspectiveCamera();
    sampleAllInputs([cam, cam], 2, 'match', [], true);

    // P2 should automatically reclaim Pad 3 by hardware ID and read its stick X
    assert.equal(getExplicitDeviceMappings()[1].padIndex, 3);
    assert.ok(getInputSlot(1).moveX > 0.7, `Expected reconnected pad moveX > 0.7, got ${getInputSlot(1).moveX}`);
  } finally {
    setExplicitDeviceMappings(null);
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', { value: prevNavigator, configurable: true });
  }
});
