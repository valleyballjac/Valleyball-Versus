/**
 * ============================================================================
 * MODULE: src/core/replay.js
 * ============================================================================
 * ROLE:
 *   Compact, deterministic `.vbreplay` match recording and playback codec.
 *   Packs 60 Hz per-slot world-space locomotion, camera/aim yaws (exact Float32),
 *   held flags, and queued actions into fixed-size 18-byte slots (36 bytes/tick
 *   for 1v1, 72 bytes/tick for 2v2), serialized into a self-contained binary
 *   `.vbreplay` container with gzip compression (~100 to 180 KB per 5-min match).
 *
 * FRAME PHASE:
 *   - `ReplayRecorder.recordSlot` / `commitTick`: called inside 60 Hz
 *     `fixedUpdate` with zero per-tick heap allocations.
 *   - `ReplayPlayer.readTick`: called inside 60 Hz `fixedUpdate` to feed
 *     recorded inputs back into athletes identically regardless of camera view.
 *   - `encodeReplayBinary` / `decodeReplayBinary`: called asynchronously at
 *     match end or replay load (outside the tick loop).
 *
 * ARCHITECTURAL INVARIANTS:
 *   - Law 6 (Determinism & No Wall Clocks): Never calls `Date.now()`,
 *     `performance.now()`, or `Math.random()`. Callers pass metadata timestamps
 *     and uint32 seeds from outside `src/core/`.
 *   - Zero Hot-Loop Allocation: Recording writes directly into a pre-allocated
 *     `Uint8Array`; playback unpacks into pre-allocated slot buffers in place.
 * ============================================================================
 */

export const REPLAY_MAGIC = Object.freeze([0x56, 0x42, 0x52, 0x50]); // "VBRP"
export const REPLAY_FORMAT_VERSION = 2;
export const REPLAY_HEADER_PREFIX_BYTES = 16;
export const REPLAY_BYTES_PER_SLOT = 18;
export const REPLAY_MAX_PLAYERS = 4;

export const REPLAY_COMPRESSION = Object.freeze({
  NONE: 0,
  GZIP: 1,
});

export const REPLAY_HELD_BITS = Object.freeze({
  SPRINT: 1 << 0,
  SLIDE: 1 << 1,
  BRACE: 1 << 2,
  HAS_AIM: 1 << 3,
  FACING_CAMERA: 1 << 4,
});

export const REPLAY_QUEUED_BITS = Object.freeze({
  JUMP: 1 << 0,
  DIVE: 1 << 1,
  CUT: 1 << 2,
  VOLLEY: 1 << 3,
  SPIKE: 1 << 4,
});

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Pre-allocated 16-byte scratch view for zero-allocation Float32 packing/unpacking
const _f32ScratchBuf = new ArrayBuffer(16);
const _f32ScratchView = new DataView(_f32ScratchBuf);
const _f32ScratchBytes = new Uint8Array(_f32ScratchBuf);

/**
 * Packs one athlete's resolved 60 Hz input into 18 bytes at `byteOffset`.
 * Full Float32 precision eliminates steering quantization drift across full
 * 5-minute matches while staying zero-allocation in the 60 Hz tick loop.
 *
 * Layout (18 bytes):
 *   [0..3]   moveWorldX (Float32LE)
 *   [4..7]   moveWorldZ (Float32LE)
 *   [8..11]  cameraYaw  (Float32LE)
 *   [12..15] aimYaw     (Float32LE, valid when HAS_AIM bit set)
 *   [16]     heldFlags  (REPLAY_HELD_BITS)
 *   [17]     queuedFlags (REPLAY_QUEUED_BITS)
 */
export function packReplaySlot(
  outBytes,
  byteOffset,
  inputSnapshot,
  {
    jumpQueued = false,
    diveQueued = false,
    cutQueued = false,
    volleyQueued = false,
    spikeQueued = false,
    facingFollowsCamera = false,
  } = {},
) {
  const mw = inputSnapshot?.moveWorld;
  const mwx = Number.isFinite(mw?.x) ? mw.x : 0;
  const mwz = Number.isFinite(mw?.z) ? mw.z : 0;
  const camYaw = Number.isFinite(inputSnapshot?.cameraYaw) ? inputSnapshot.cameraYaw : 0;
  const hasAim = Boolean(inputSnapshot?.hasAim);
  const aimYaw = hasAim && Number.isFinite(inputSnapshot?.aimYaw) ? inputSnapshot.aimYaw : 0;

  _f32ScratchView.setFloat32(0, mwx, true);
  _f32ScratchView.setFloat32(4, mwz, true);
  _f32ScratchView.setFloat32(8, camYaw, true);
  _f32ScratchView.setFloat32(12, aimYaw, true);
  for (let b = 0; b < 16; b++) outBytes[byteOffset + b] = _f32ScratchBytes[b];

  let held = 0;
  if (inputSnapshot?.sprintHeld) held |= REPLAY_HELD_BITS.SPRINT;
  if (inputSnapshot?.slideHeld) held |= REPLAY_HELD_BITS.SLIDE;
  if (inputSnapshot?.braceHeld) held |= REPLAY_HELD_BITS.BRACE;
  if (hasAim) held |= REPLAY_HELD_BITS.HAS_AIM;
  if (facingFollowsCamera) held |= REPLAY_HELD_BITS.FACING_CAMERA;
  outBytes[byteOffset + 16] = held;

  let queued = 0;
  if (jumpQueued) queued |= REPLAY_QUEUED_BITS.JUMP;
  if (diveQueued) queued |= REPLAY_QUEUED_BITS.DIVE;
  if (cutQueued) queued |= REPLAY_QUEUED_BITS.CUT;
  if (volleyQueued) queued |= REPLAY_QUEUED_BITS.VOLLEY;
  if (spikeQueued) queued |= REPLAY_QUEUED_BITS.SPIKE;
  outBytes[byteOffset + 17] = queued;
}

/**
 * Unpacks one athlete's 18-byte replay slot into `outFrame` in place.
 * Zero heap allocations when `outFrame` is reused.
 */
export function unpackReplaySlot(inBytes, byteOffset, outFrame) {
  for (let b = 0; b < 16; b++) _f32ScratchBytes[b] = inBytes[byteOffset + b];
  const moveWorldX = _f32ScratchView.getFloat32(0, true);
  const moveWorldZ = _f32ScratchView.getFloat32(4, true);
  const cameraYaw = _f32ScratchView.getFloat32(8, true);
  const aimYaw = _f32ScratchView.getFloat32(12, true);
  const held = inBytes[byteOffset + 16];
  const queued = inBytes[byteOffset + 17];

  const snap = outFrame.inputSnapshot;
  snap.moveWorld.x = moveWorldX;
  snap.moveWorld.y = 0;
  snap.moveWorld.z = moveWorldZ;
  snap.moveX = moveWorldX;
  snap.moveZ = moveWorldZ;
  snap.cameraYaw = cameraYaw;
  snap.hasAim = Boolean(held & REPLAY_HELD_BITS.HAS_AIM);
  snap.aimYaw = snap.hasAim ? aimYaw : 0;
  snap.sprintHeld = Boolean(held & REPLAY_HELD_BITS.SPRINT);
  snap.slideHeld = Boolean(held & REPLAY_HELD_BITS.SLIDE);
  snap.braceHeld = Boolean(held & REPLAY_HELD_BITS.BRACE);

  outFrame.facingFollowsCamera = Boolean(held & REPLAY_HELD_BITS.FACING_CAMERA);
  outFrame.jumpQueued = Boolean(queued & REPLAY_QUEUED_BITS.JUMP);
  outFrame.diveQueued = Boolean(queued & REPLAY_QUEUED_BITS.DIVE);
  outFrame.cutQueued = Boolean(queued & REPLAY_QUEUED_BITS.CUT);
  outFrame.volleyQueued = Boolean(queued & REPLAY_QUEUED_BITS.VOLLEY);
  outFrame.spikeQueued = Boolean(queued & REPLAY_QUEUED_BITS.SPIKE);
  return outFrame;
}

/**
 * Creates a reusable unpacked replay slot container matching the shape expected
 * by `athlete.prePhysicsUpdate`.
 */
export function createReplaySlotFrame() {
  return {
    inputSnapshot: {
      moveX: 0,
      moveZ: 0,
      sprintHeld: false,
      slideHeld: false,
      braceHeld: false,
      moveWorld: { x: 0, y: 0, z: 0 },
      lookX: 0,
      lookY: 0,
      hasAim: false,
      aimYaw: 0,
      cameraYaw: 0,
    },
    jumpQueued: false,
    diveQueued: false,
    cutQueued: false,
    volleyQueued: false,
    spikeQueued: false,
    facingFollowsCamera: false,
  };
}

/**
 * Zero-allocation in-tick recorder for a single match.
 * Pre-allocates enough frame capacity for regulation + 3 minutes of overtime
 * and grows cleanly if an extended overtime exceeds initial capacity.
 */
export class ReplayRecorder {
  /**
   * @param {object} meta Match header metadata (seed, players, ball, durationSeconds, etc.).
   * @param {number} [initialCapacityTicks] Pre-allocated tick capacity.
   */
  constructor(meta, initialCapacityTicks = null) {
    const playerCount = clamp(Number(meta?.playerCount) || 2, 1, REPLAY_MAX_PLAYERS);
    const defaultTicks = Math.max(600, Math.ceil(((Number(meta?.durationSeconds) || 300) + 180) * 60));
    this.playerCount = playerCount;
    this.strideBytes = playerCount * REPLAY_BYTES_PER_SLOT;
    this.capacityTicks = Math.max(60, initialCapacityTicks || defaultTicks);
    this.buffer = new Uint8Array(this.capacityTicks * this.strideBytes);
    this.frameCount = 0;
    this.active = true;
    this.meta = {
      version: REPLAY_FORMAT_VERSION,
      format: 'vbreplay',
      ...meta,
      playerCount,
      goals: Array.isArray(meta?.goals) ? [...meta.goals] : [],
      overtimeDecisions: Array.isArray(meta?.overtimeDecisions) ? [...meta.overtimeDecisions] : [],
      summary: null,
    };
  }

  /** Ensures capacity for at least one more tick. Only reallocates on very long overtimes. */
  ensureTickCapacity() {
    if (this.frameCount < this.capacityTicks) return;
    const nextCapacity = Math.ceil(this.capacityTicks * 1.5);
    const nextBuf = new Uint8Array(nextCapacity * this.strideBytes);
    nextBuf.set(this.buffer);
    this.buffer = nextBuf;
    this.capacityTicks = nextCapacity;
  }

  /**
   * Records one player slot for the current tick (must call `commitTick()` once
   * all slots for the tick have been written).
   */
  recordSlot(slotIndex, inputSnapshot, flags) {
    if (!this.active || slotIndex < 0 || slotIndex >= this.playerCount) return;
    this.ensureTickCapacity();
    const offset = this.frameCount * this.strideBytes + slotIndex * REPLAY_BYTES_PER_SLOT;
    packReplaySlot(this.buffer, offset, inputSnapshot, flags);
  }

  /** Advances the recorded frame pointer by 1 tick. */
  commitTick() {
    if (!this.active) return;
    this.ensureTickCapacity();
    this.frameCount += 1;
  }

  /** Appends a goal timestamp marker for instant highlight discovery. */
  recordGoal({ scoredFor, goal, scoreHome, scoreAway, scorerSlot = null, assistSlot = null }) {
    if (!this.active) return;
    this.meta.goals.push({
      frame: this.frameCount,
      scoredFor,
      goal,
      scoreHome,
      scoreAway,
      scorerSlot,
      assistSlot,
    });
  }

  /** Records an overtime agreement so overtime replays branch identically. */
  recordOvertime({ format, durationSeconds, positionMode, dropPos = null, spawns = null }) {
    if (!this.active) return;
    this.meta.overtimeDecisions.push({
      frame: this.frameCount,
      format,
      durationSeconds,
      positionMode,
      dropPos,
      spawns: Array.isArray(spawns)
        ? spawns.map((s) => ({
            pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z },
            facingYaw: s.facingYaw,
            cameraAzimuth: s.cameraAzimuth,
          }))
        : null,
    });
  }

  /** Seals the recording and returns a compact plain payload `{ meta, frames }`. */
  finalize(summary = {}) {
    this.active = false;
    this.meta.summary = {
      ...summary,
      totalFrames: this.frameCount,
      totalGoals: this.meta.goals.length,
    };
    const frames = this.buffer.slice(0, this.frameCount * this.strideBytes);
    return {
      meta: this.meta,
      frames,
    };
  }
}

/**
 * Deterministic cursor over a decoded replay's packed frame stream.
 * Reuses pre-allocated slot objects so playback allocates zero bytes per tick.
 */
export class ReplayPlayer {
  constructor(replay) {
    if (!replay || !replay.meta || !(replay.frames instanceof Uint8Array)) {
      throw new Error('ReplayPlayer requires a decoded replay object { meta, frames }');
    }
    this.meta = replay.meta;
    this.frames = replay.frames;
    this.playerCount = clamp(Number(replay.meta.playerCount) || 2, 1, REPLAY_MAX_PLAYERS);
    this.strideBytes = this.playerCount * REPLAY_BYTES_PER_SLOT;
    this.totalFrames = Math.floor(this.frames.byteLength / this.strideBytes);
    this.cursor = 0;
    this.slots = Array.from({ length: REPLAY_MAX_PLAYERS }, () => createReplaySlotFrame());
  }

  get isComplete() {
    return this.cursor >= this.totalFrames;
  }

  reset() {
    this.cursor = 0;
  }

  /**
   * Unpacks the current tick into `this.slots` and advances `this.cursor`.
   * Returns `this.slots` or `null` once all frames have been consumed.
   */
  readNextTick() {
    if (this.cursor >= this.totalFrames) return null;
    const tickBase = this.cursor * this.strideBytes;
    for (let i = 0; i < this.playerCount; i++) {
      unpackReplaySlot(this.frames, tickBase + i * REPLAY_BYTES_PER_SLOT, this.slots[i]);
    }
    this.cursor += 1;
    return this.slots;
  }

  /** Returns any overtime decision scheduled for the current frame index. */
  getOvertimeDecisionAt(frameIndex) {
    const list = this.meta.overtimeDecisions;
    if (!Array.isArray(list)) return null;
    for (let i = 0; i < list.length; i++) {
      if (list[i].frame === frameIndex) return list[i];
    }
    return null;
  }
}

async function gzipCompress(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const ab = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(ab);
}

async function gzipDecompress(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream("gzip") is unavailable in this environment');
  }
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const ab = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Encodes `{ meta, frames }` into a self-contained `.vbreplay` Uint8Array.
 * Uses native gzip compression when supported and smaller than raw frames.
 *
 * @param {{ meta: object, frames: Uint8Array }} replay
 * @param {{ compress?: boolean }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function encodeReplayBinary(replay, { compress = true } = {}) {
  const version = Number(replay?.meta?.version) === 3 ? 3 : REPLAY_FORMAT_VERSION;
  const playerCount = clamp(Number(replay?.meta?.playerCount) || 2, 1, REPLAY_MAX_PLAYERS);
  const strideBytes = version === 3
    ? Math.max(1, Number(replay?.strideBytes) || 516)
    : playerCount * REPLAY_BYTES_PER_SLOT;
  const rawFrames = replay.frames instanceof Uint8Array ? replay.frames : new Uint8Array(replay.frames || 0);
  const frameCount = Math.floor(rawFrames.byteLength / strideBytes);
  const headerBytes = textEncoder.encode(JSON.stringify(replay.meta));

  let payload = rawFrames;
  let compression = REPLAY_COMPRESSION.NONE;
  if (compress && rawFrames.byteLength > 0) {
    try {
      const zipped = await gzipCompress(rawFrames);
      if (zipped && zipped.byteLength < rawFrames.byteLength) {
        payload = zipped;
        compression = REPLAY_COMPRESSION.GZIP;
      }
    } catch {
      // Fall back to uncompressed frames if stream compression is unavailable.
    }
  }

  const totalBytes = REPLAY_HEADER_PREFIX_BYTES + headerBytes.byteLength + payload.byteLength;
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);

  out[0] = REPLAY_MAGIC[0];
  out[1] = REPLAY_MAGIC[1];
  out[2] = REPLAY_MAGIC[2];
  out[3] = REPLAY_MAGIC[3];
  out[4] = version;
  out[5] = compression;
  if (version === 3) {
    view.setUint16(6, strideBytes, true);
  } else {
    out[6] = strideBytes;
    out[7] = 0;
  }
  view.setUint32(8, headerBytes.byteLength, true);
  view.setUint32(12, frameCount, true);

  out.set(headerBytes, REPLAY_HEADER_PREFIX_BYTES);
  out.set(payload, REPLAY_HEADER_PREFIX_BYTES + headerBytes.byteLength);
  return out;
}

/**
 * Synchronously parses just the JSON header of a `.vbreplay` binary without
 * decompressing the frame stream (useful for listing/mining match highlight libraries).
 *
 * @param {Uint8Array} bytes
 * @returns {{ version: number, compression: number, strideBytes: number, frameCount: number, headerLength: number, meta: object }}
 */
export function inspectReplayHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < REPLAY_HEADER_PREFIX_BYTES) {
    throw new Error('Invalid .vbreplay file: truncated header');
  }
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== REPLAY_MAGIC[i]) {
      throw new Error('Invalid .vbreplay file: bad magic bytes');
    }
  }
  const version = bytes[4];
  if (version !== REPLAY_FORMAT_VERSION && version !== 3) {
    throw new Error(`Unsupported .vbreplay version: ${version}`);
  }
  const compression = bytes[5];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const strideBytes = version === 3 ? view.getUint16(6, true) : bytes[6];
  const headerLength = view.getUint32(8, true);
  const frameCount = view.getUint32(12, true);

  const headerEnd = REPLAY_HEADER_PREFIX_BYTES + headerLength;
  if (headerEnd > bytes.byteLength) {
    throw new Error('Invalid .vbreplay file: header exceeds file length');
  }
  const meta = JSON.parse(textDecoder.decode(bytes.subarray(REPLAY_HEADER_PREFIX_BYTES, headerEnd)));
  return { version, compression, strideBytes, frameCount, headerLength, meta };
}

/**
 * Decodes a `.vbreplay` binary buffer into `{ meta, frames, frameCount, strideBytes }`.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ meta: object, frames: Uint8Array, frameCount: number, strideBytes: number }>}
 */
export async function decodeReplayBinary(bytes) {
  const info = inspectReplayHeader(bytes);
  const payload = bytes.subarray(REPLAY_HEADER_PREFIX_BYTES + info.headerLength);
  let frames;
  if (info.compression === REPLAY_COMPRESSION.GZIP) {
    frames = await gzipDecompress(payload);
  } else if (info.compression === REPLAY_COMPRESSION.NONE) {
    frames = payload.slice();
  } else {
    throw new Error(`Unsupported .vbreplay compression mode: ${info.compression}`);
  }

  const expectedBytes = info.frameCount * info.strideBytes;
  if (frames.byteLength !== expectedBytes) {
    throw new Error(
      `Corrupt .vbreplay frame payload: expected ${expectedBytes} bytes, got ${frames.byteLength}`,
    );
  }
  return {
    meta: info.meta,
    frames,
    frameCount: info.frameCount,
    strideBytes: info.strideBytes,
  };
}
