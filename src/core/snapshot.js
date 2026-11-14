/**
 * ============================================================================
 * MODULE: src/core/snapshot.js
 * ============================================================================
 * ROLE:
 *   Zero-allocation binary/typed-array serialization for:
 *     1. `InputFrame` (6 bytes per player slot = 24 bytes/tick for 4 players):
 *        Powers compact `.vbreplay` deterministic match recordings (~40 KB per
 *        5-minute match) and 60 Hz LAN client-to-host input packets.
 *     2. `WorldSnapshot` & `WorldSnapshotRingBuffer`:
 *        Packs complete match, ball, and 4-athlete rigid-body/ragdoll states into
 *        a flat `Float32Array` buffer (~480 floats/tick). Powers Spectator-Only
 *        Instant Replays (rolling 5–8s ring buffer), Single-PC Dual-Monitor
 *        Spectator windows (Electron IPC), and Multi-PC LAN broadcasts.
 *
 * FRAME PHASE:
 *   Called inside `onTick` / `fixedUpdate` after physics steps complete, or by
 *   the Spectator/Replay renderer when scrubbing or streaming.
 *
 * ARCHITECTURAL INVARIANTS:
 *   - Law 5 / Law 6 (Simulation Integrity): Snapshot capture is strictly read-only.
 *     Applying a snapshot (`applyWorldSnapshotToVisuals`) is restricted to
 *     Spectator/Replay visual playback and NEVER mutates active live physics
 *     during a standard match (preserving Continuous Momentum).
 *   - Zero Heap Allocation: All encoders/decoders operate on pre-allocated
 *     `Uint8Array` / `Float32Array` buffers.
 * ============================================================================
 */

export const RAGDOLL_BODY_KEYS = Object.freeze([
  'pelvis', 'spine', 'chest', 'head',
  'upperArmL', 'foreArmL', 'handL',
  'upperArmR', 'foreArmR', 'handR',
  'thighL', 'calfL', 'footL',
  'thighR', 'calfR', 'footR',
]);

export const MAX_PLAYERS = 4;
export const MAX_BALLS = 3;
export const RAGDOLL_BODY_COUNT = RAGDOLL_BODY_KEYS.length; // 16 bodies

/**
 * Bitflags for held and edge-triggered (queued) actions in `InputFrame`.
 */
export const INPUT_BITS = Object.freeze({
  SPRINT: 1 << 0,
  SLIDE:  1 << 1,
  BRACE:  1 << 2,
  JUMP:   1 << 3,
  DIVE:   1 << 4,
  CUT:    1 << 5,
  VOLLEY: 1 << 6,
  SPIKE:  1 << 7,
});

/** Bytes per player slot in a packed `InputFrame`:
 *  [0] moveX (Int8, -127..127)
 *  [1] moveZ (Int8, -127..127)
 *  [2..3] camYaw (Int16LE, radians mapped from [-PI, PI] -> [-32767, 32767])
 *  [4] heldButtonsMask (Uint8)
 *  [5] queuedButtonsMask (Uint8)
 */
export const BYTES_PER_PLAYER_INPUT = 6;
export const INPUT_FRAME_BYTES = MAX_PLAYERS * BYTES_PER_PLAYER_INPUT; // 24 bytes/tick

/**
 * Float32 layout for a single `WorldSnapshot`:
 * - Header (8 floats):
 *   [0] tick
 *   [1] ticksRemaining
 *   [2] scoreHome
 *   [3] scoreAway
 *   [4] targetGoal (0 = 'N', 1 = 'S')
 *   [5] activeBallIdx
 *   [6] athleteCount
 *   [7] flags (bit 0 = isOvertime, bit 1 = isGoldenGoal)
 * - Balls (MAX_BALLS * 10 = 30 floats):
 *   per ball: [enabled, x, y, z, vx, vy, vz, qx, qy, qz] (qw reconstructed or 11 floats)
 *   We store 11 floats per ball: [enabled, x, y, z, vx, vy, vz, qx, qy, qz, qw] -> 33 floats
 * - Athletes (MAX_PLAYERS * (10 + RAGDOLL_BODY_COUNT * 7) = 4 * 122 = 488 floats):
 *   per athlete header (10 floats):
 *     [enabled, rootX, rootY, rootZ, vx, vy, vz, facingYaw, trackerWeight, strikePhase]
 *   per ragdoll body (16 * 7 = 112 floats):
 *     [px, py, pz, qx, qy, qz, qw]
 */
export const SNAPSHOT_HEADER_FLOATS = 8;
export const FLOATS_PER_BALL = 11;
export const FLOATS_PER_ATHLETE_HEADER = 10;
export const FLOATS_PER_RAGDOLL_BODY = 7;
export const FLOATS_PER_ATHLETE =
  FLOATS_PER_ATHLETE_HEADER + RAGDOLL_BODY_COUNT * FLOATS_PER_RAGDOLL_BODY; // 122 floats
export const WORLD_SNAPSHOT_FLOATS =
  SNAPSHOT_HEADER_FLOATS +
  MAX_BALLS * FLOATS_PER_BALL +
  MAX_PLAYERS * FLOATS_PER_ATHLETE; // 8 + 33 + 488 = 529 floats (2,116 bytes)

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Packs up to 4 player input slots for a single tick into `outBytes` at `byteOffset`.
 * Zero heap allocations.
 *
 * @param {Array<object>} slots Array of up to 4 input slot objects from `inputRouter`.
 * @param {Uint8Array} [outBytes] Target buffer (defaults to a new 24-byte `Uint8Array`).
 * @param {number} [byteOffset=0] Byte offset into `outBytes`.
 * @returns {Uint8Array} `outBytes`
 */
export function packInputFrame(slots, outBytes = new Uint8Array(INPUT_FRAME_BYTES), byteOffset = 0) {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const s = slots?.[i];
    const base = byteOffset + i * BYTES_PER_PLAYER_INPUT;
    if (!s) {
      outBytes[base] = 0;
      outBytes[base + 1] = 0;
      outBytes[base + 2] = 0;
      outBytes[base + 3] = 0;
      outBytes[base + 4] = 0;
      outBytes[base + 5] = 0;
      continue;
    }

    const mx = Math.round(clamp(s.moveX || 0, -1, 1) * 127);
    const mz = Math.round(clamp(s.moveZ || 0, -1, 1) * 127);
    outBytes[base] = mx & 0xff;
    outBytes[base + 1] = mz & 0xff;

    // Camera yaw derived from camForward XZ (default facing -Z -> yaw 0)
    const fx = s.camForward?.x ?? 0;
    const fz = s.camForward?.z ?? -1;
    const yaw = Math.atan2(fx, -fz); // [-PI, PI]
    const yawQuant = Math.round(clamp(yaw / Math.PI, -1, 1) * 32767);
    outBytes[base + 2] = yawQuant & 0xff;
    outBytes[base + 3] = (yawQuant >> 8) & 0xff;

    let held = 0;
    if (s.sprint) held |= INPUT_BITS.SPRINT;
    if (s.slide) held |= INPUT_BITS.SLIDE;
    if (s.brace) held |= INPUT_BITS.BRACE;

    let queued = 0;
    if (s.jumpQueued) queued |= INPUT_BITS.JUMP;
    if (s.diveQueued) queued |= INPUT_BITS.DIVE;
    if (s.cutQueued) queued |= INPUT_BITS.CUT;
    if (s.volleyQueued) queued |= INPUT_BITS.VOLLEY;
    if (s.spikeQueued) queued |= INPUT_BITS.SPIKE;

    outBytes[base + 4] = held;
    outBytes[base + 5] = queued;
  }
  return outBytes;
}

/**
 * Unpacks a 24-byte `InputFrame` from `inBytes` at `byteOffset` into `outSlots` in place.
 * Zero heap allocations when `outSlots` is provided.
 *
 * @param {Uint8Array} inBytes Source byte buffer.
 * @param {number} [byteOffset=0] Byte offset into `inBytes`.
 * @param {Array<object>} [outSlots] Pre-allocated array of 4 slot objects to mutate in place.
 * @returns {Array<object>} `outSlots`
 */
export function unpackInputFrame(inBytes, byteOffset = 0, outSlots = null) {
  const slots = outSlots || Array.from({ length: MAX_PLAYERS }, () => ({
    moveX: 0,
    moveZ: 0,
    camForward: { x: 0, y: 0, z: -1 },
    camRight: { x: 1, y: 0, z: 0 },
    sprint: false,
    slide: false,
    brace: false,
    jumpQueued: false,
    diveQueued: false,
    cutQueued: false,
    volleyQueued: false,
    spikeQueued: false,
  }));

  for (let i = 0; i < MAX_PLAYERS; i++) {
    const base = byteOffset + i * BYTES_PER_PLAYER_INPUT;
    const slot = slots[i];
    // Signed Int8 conversion
    const rawX = (inBytes[base] << 24) >> 24;
    const rawZ = (inBytes[base + 1] << 24) >> 24;
    slot.moveX = rawX / 127;
    slot.moveZ = rawZ / 127;

    // Signed Int16LE conversion
    const rawYaw = ((inBytes[base + 2] | (inBytes[base + 3] << 8)) << 16) >> 16;
    const yaw = (rawYaw / 32767) * Math.PI;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    slot.camForward.x = sinY;
    slot.camForward.y = 0;
    slot.camForward.z = -cosY;
    slot.camRight.x = cosY;
    slot.camRight.y = 0;
    slot.camRight.z = sinY;

    const held = inBytes[base + 4];
    const queued = inBytes[base + 5];
    slot.sprint = Boolean(held & INPUT_BITS.SPRINT);
    slot.slide = Boolean(held & INPUT_BITS.SLIDE);
    slot.brace = Boolean(held & INPUT_BITS.BRACE);
    slot.jumpQueued = Boolean(queued & INPUT_BITS.JUMP);
    slot.diveQueued = Boolean(queued & INPUT_BITS.DIVE);
    slot.cutQueued = Boolean(queued & INPUT_BITS.CUT);
    slot.volleyQueued = Boolean(queued & INPUT_BITS.VOLLEY);
    slot.spikeQueued = Boolean(queued & INPUT_BITS.SPIKE);
  }
  return slots;
}

/**
 * Captures the current simulation world state into a flat `Float32Array` (`outFloats`).
 * Zero heap allocations.
 *
 * @param {object} worldState
 * @param {number} worldState.tick
 * @param {object} [worldState.matchState]
 * @param {Array<object>} [worldState.balls]
 * @param {number} [worldState.activeBallIdx]
 * @param {Array<object>} [worldState.athletes]
 * @param {Float32Array} [outFloats] Target Float32Array of length >= `WORLD_SNAPSHOT_FLOATS`.
 * @param {number} [floatOffset=0] Offset into `outFloats`.
 * @returns {Float32Array} `outFloats`
 */
export function captureWorldSnapshot(
  { tick = 0, matchState = null, balls = [], activeBallIdx = 0, athletes = [] },
  outFloats = new Float32Array(WORLD_SNAPSHOT_FLOATS),
  floatOffset = 0,
) {
  let cursor = floatOffset;

  // 1. Header (8 floats)
  const flags = (matchState?.isOvertime ? 1 : 0) | (matchState?.isGoldenGoal ? 2 : 0);
  outFloats[cursor++] = tick;
  outFloats[cursor++] = matchState?.ticksRemaining ?? 0;
  outFloats[cursor++] = matchState?.scoreHome ?? 0;
  outFloats[cursor++] = matchState?.scoreAway ?? 0;
  outFloats[cursor++] = matchState?.targetGoal === 'S' ? 1 : 0;
  outFloats[cursor++] = activeBallIdx;
  outFloats[cursor++] = Math.min(athletes.length, MAX_PLAYERS);
  outFloats[cursor++] = flags;

  // 2. Balls (MAX_BALLS * 11 floats)
  for (let b = 0; b < MAX_BALLS; b++) {
    const ball = balls[b];
    const body = ball?.body;
    const enabled = body && (typeof body.isEnabled === 'function' ? body.isEnabled() : true);
    if (!ball || !body || !enabled) {
      for (let k = 0; k < FLOATS_PER_BALL; k++) outFloats[cursor++] = 0;
      continue;
    }
    const pos = body.translation();
    const vel = body.linvel();
    const rot = body.rotation();
    outFloats[cursor++] = 1;
    outFloats[cursor++] = pos.x;
    outFloats[cursor++] = pos.y;
    outFloats[cursor++] = pos.z;
    outFloats[cursor++] = vel.x;
    outFloats[cursor++] = vel.y;
    outFloats[cursor++] = vel.z;
    outFloats[cursor++] = rot.x;
    outFloats[cursor++] = rot.y;
    outFloats[cursor++] = rot.z;
    outFloats[cursor++] = rot.w;
  }

  // 3. Athletes (MAX_PLAYERS * 122 floats)
  for (let a = 0; a < MAX_PLAYERS; a++) {
    const athlete = athletes[a];
    const motorBody = athlete?.motor?.body;
    const enabled = athlete?.enabled !== false && Boolean(motorBody);
    if (!athlete || !enabled) {
      for (let k = 0; k < FLOATS_PER_ATHLETE; k++) outFloats[cursor++] = 0;
      continue;
    }
    const pos = motorBody.translation();
    const vel = motorBody.linvel();
    outFloats[cursor++] = 1;
    outFloats[cursor++] = pos.x;
    outFloats[cursor++] = pos.y;
    outFloats[cursor++] = pos.z;
    outFloats[cursor++] = vel.x;
    outFloats[cursor++] = vel.y;
    outFloats[cursor++] = vel.z;
    outFloats[cursor++] = athlete.animTarget?.facingYaw ?? 0;
    outFloats[cursor++] = athlete.tracker?.weight ?? 1;
    outFloats[cursor++] = athlete.strikeState?.phase ?? 0;

    const rig = athlete.ragdoll?.rig;
    for (let k = 0; k < RAGDOLL_BODY_COUNT; k++) {
      const item = rig?.get ? rig.get(RAGDOLL_BODY_KEYS[k]) : null;
      const rBody = item?.body;
      if (!rBody) {
        outFloats[cursor++] = pos.x;
        outFloats[cursor++] = pos.y;
        outFloats[cursor++] = pos.z;
        outFloats[cursor++] = 0;
        outFloats[cursor++] = 0;
        outFloats[cursor++] = 0;
        outFloats[cursor++] = 1;
      } else {
        const bp = rBody.translation();
        const br = rBody.rotation();
        outFloats[cursor++] = bp.x;
        outFloats[cursor++] = bp.y;
        outFloats[cursor++] = bp.z;
        outFloats[cursor++] = br.x;
        outFloats[cursor++] = br.y;
        outFloats[cursor++] = br.z;
        outFloats[cursor++] = br.w;
      }
    }
  }

  return outFloats;
}

/**
 * Pre-allocated fixed-capacity ring buffer of `WorldSnapshot` frames for
 * Spectator-Only Instant Replays (e.g., 360 ticks = 6.0 seconds at 60 Hz).
 * Zero allocations after construction.
 */
export class WorldSnapshotRingBuffer {
  /**
   * @param {number} [capacityTicks=360] Number of ticks retained in the circular buffer.
   */
  constructor(capacityTicks = 360) {
    this.capacity = capacityTicks;
    this.buffer = new Float32Array(capacityTicks * WORLD_SNAPSHOT_FLOATS);
    this.writeIndex = 0;
    this.count = 0;
  }

  /** Resets the ring buffer without reallocating memory. */
  clear() {
    this.writeIndex = 0;
    this.count = 0;
  }

  /**
   * Captures the current world state into the next slot of the circular buffer.
   * @param {object} worldState Passed to `captureWorldSnapshot`.
   */
  push(worldState) {
    const offset = this.writeIndex * WORLD_SNAPSHOT_FLOATS;
    captureWorldSnapshot(worldState, this.buffer, offset);
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /**
   * Returns a `Float32Array` subarray view for the snapshot `ticksAgo` before the
   * most recently pushed frame (`0` = latest frame, `count - 1` = oldest frame).
   * Returns `null` if out of range.
   *
   * @param {number} ticksAgo Integer in `[0, this.count - 1]`.
   * @returns {Float32Array|null}
   */
  getSnapshotTicksAgo(ticksAgo) {
    if (ticksAgo < 0 || ticksAgo >= this.count) return null;
    const slot = (this.writeIndex - 1 - ticksAgo + this.capacity * 2) % this.capacity;
    const start = slot * WORLD_SNAPSHOT_FLOATS;
    return this.buffer.subarray(start, start + WORLD_SNAPSHOT_FLOATS);
  }
}
