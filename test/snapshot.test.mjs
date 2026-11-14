import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INPUT_FRAME_BYTES,
  WORLD_SNAPSHOT_FLOATS,
  packInputFrame,
  unpackInputFrame,
  captureWorldSnapshot,
  WorldSnapshotRingBuffer,
} from '../src/core/snapshot.js';

test('packInputFrame and unpackInputFrame round-trip 4 player slots accurately', () => {
  const inputSlots = [
    {
      moveX: -0.75,
      moveZ: 1.0,
      camForward: { x: 0, y: 0, z: -1 },
      camRight: { x: 1, y: 0, z: 0 },
      sprint: true,
      slide: false,
      brace: false,
      jumpQueued: true,
      diveQueued: false,
      cutQueued: true,
      volleyQueued: false,
      spikeQueued: false,
    },
    {
      moveX: 0.5,
      moveZ: -0.25,
      camForward: { x: 1, y: 0, z: 0 },
      camRight: { x: 0, y: 0, z: 1 },
      sprint: false,
      slide: true,
      brace: true,
      jumpQueued: false,
      diveQueued: true,
      cutQueued: false,
      volleyQueued: true,
      spikeQueued: true,
    },
    null,
    null,
  ];

  const buf = new Uint8Array(INPUT_FRAME_BYTES);
  packInputFrame(inputSlots, buf, 0);
  const unpacked = unpackInputFrame(buf, 0);

  assert.equal(unpacked.length, 4);
  assert.ok(Math.abs(unpacked[0].moveX - -0.75) < 0.015);
  assert.ok(Math.abs(unpacked[0].moveZ - 1.0) < 0.01);
  assert.equal(unpacked[0].sprint, true);
  assert.equal(unpacked[0].jumpQueued, true);
  assert.equal(unpacked[0].cutQueued, true);
  assert.equal(unpacked[0].volleyQueued, false);

  assert.ok(Math.abs(unpacked[1].moveX - 0.5) < 0.015);
  assert.ok(Math.abs(unpacked[1].moveZ - -0.25) < 0.015);
  assert.ok(Math.abs(unpacked[1].camForward.x - 1.0) < 0.001);
  assert.equal(unpacked[1].slide, true);
  assert.equal(unpacked[1].brace, true);
  assert.equal(unpacked[1].diveQueued, true);
  assert.equal(unpacked[1].volleyQueued, true);
  assert.equal(unpacked[1].spikeQueued, true);

  assert.equal(unpacked[2].moveX, 0);
  assert.equal(unpacked[2].sprint, false);
});

test('WorldSnapshotRingBuffer captures and retrieves circular snapshots without allocation', () => {
  const ring = new WorldSnapshotRingBuffer(4);
  const fakeBall = {
    body: {
      isEnabled: () => true,
      translation: () => ({ x: 1.5, y: 4.25, z: -12.0 }),
      linvel: () => ({ x: 0, y: -3.0, z: 8.5 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    },
  };

  for (let t = 10; t < 16; t++) {
    ring.push({
      tick: t,
      matchState: {
        ticksRemaining: 1000 - t,
        scoreHome: 2,
        scoreAway: 3,
        targetGoal: 'S',
        isOvertime: true,
        isGoldenGoal: true,
      },
      balls: [fakeBall],
      activeBallIdx: 0,
      athletes: [],
    });
  }

  assert.equal(ring.count, 4);
  const latest = ring.getSnapshotTicksAgo(0);
  assert.equal(latest.length, WORLD_SNAPSHOT_FLOATS);
  assert.equal(latest[0], 15); // tick 15
  assert.equal(latest[2], 2);  // scoreHome
  assert.equal(latest[3], 3);  // scoreAway
  assert.equal(latest[4], 1);  // targetGoal 'S'
  assert.equal(latest[7], 3);  // isOvertime | isGoldenGoal
  assert.equal(latest[8], 1);  // ball 0 enabled
  assert.equal(latest[9], 1.5); // ball 0 x

  const oldest = ring.getSnapshotTicksAgo(3);
  assert.equal(oldest[0], 12); // tick 12
  assert.equal(ring.getSnapshotTicksAgo(4), null);
});
