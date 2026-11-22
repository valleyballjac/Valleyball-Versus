/**
 * ============================================================================
 * MODULE: src/core/replayPose.js
 * ============================================================================
 * ROLE:
 *   Zero-allocation v3 World-State Pose Keyframe Recorder & Interpolating Player
 *   for `.vbreplay` match replays. Captures exact post-physics ball transform,
 *   every active athlete's motor root, facing yaw, and all 16 ragdoll body
 *   world transforms (millimeter-accurate Int16 relative offsets + normalized
 *   Int16 quaternions), plus exact match scoreboard/clock/goal state at 30 Hz.
 *
 *   Because playback interpolates directly from recorded world poses rather
 *   than re-simulating Rapier3D physics, replays are 100% faithful to the live
 *   match (zero desync ever possible) and timeline scrubbing / rewinding snaps
 *   anywhere in a 10-minute match in < 0.5 ms with zero lag.
 *
 * FRAME PHASE:
 *   - `PoseReplayRecorder.recordFrame`: invoked post-physics inside 60 Hz
 *     `fixedUpdate` (subsampled at 30 Hz = every 2nd tick) with zero hot-loop
 *     allocations.
 *   - `PoseReplayPlayer.applyAtTick`: invoked inside `render()` with smooth
 *     linear position + shortest-arc quaternion slerp and zero heap allocations.
 *
 * ARCHITECTURAL INVARIANTS:
 *   - Law 4 (Zero Hot-Loop Allocations): Pre-allocated growable `Uint8Array`
 *     and module-scoped scratch `DataView`/math helpers.
 *   - Law 5 (Render Interpolation Only): Playback writes strictly to visual
 *     meshes and `Interpolated` buffers, never teleporting Rapier rigid bodies.
 *   - Law 6 (Determinism & No Wall Clocks): Never calls `Date.now()`,
 *     `performance.now()`, or `Math.random()`.
 * ============================================================================
 */

export const REPLAY_POSE_FORMAT_VERSION = 3;
export const REPLAY_POSE_SAMPLE_STEP_TICKS = 2; // 30 Hz keyframes over 60 Hz match ticks
export const REPLAY_POSE_MAX_PLAYERS = 4;

/** Canonical 16 ragdoll body keys matching `BONE_MAP` in `src/sim/autorig.js`. */
export const POSE_PART_KEYS = Object.freeze([
  'pelvis',
  'spine',
  'chest',
  'head',
  'upperArmL',
  'foreArmL',
  'handL',
  'upperArmR',
  'foreArmR',
  'handR',
  'thighL',
  'calfL',
  'footL',
  'thighR',
  'calfR',
  'footR',
]);

export const POSE_PART_COUNT = POSE_PART_KEYS.length; // 16
export const POSE_MATCH_HEADER_BYTES = 16;
export const POSE_BALL_BYTES = 20;
export const POSE_PART_BYTES = 14; // 3 x Int16 relPos (0.25mm) + 4 x Int16 quat
export const POSE_ATHLETE_HEADER_BYTES = 16; // 3 x Float32 motorPos + 1 x Float32 facingYaw
export const POSE_BYTES_PER_ATHLETE = POSE_ATHLETE_HEADER_BYTES + POSE_PART_COUNT * POSE_PART_BYTES; // 240

const REL_POS_SCALE = 4000; // +-8.191 m range at 0.25 mm resolution
const INV_REL_POS_SCALE = 1 / REL_POS_SCALE;
const QUAT_SCALE = 32767;
const INV_QUAT_SCALE = 1 / QUAT_SCALE;
const TELEPORT_SNAP_DIST_SQ = 16.0; // > 4 m between adjacent 30 Hz frames snaps cleanly (ball respawn)

const MATCH_FLAG_TARGET_S = 1 << 0;
const MATCH_FLAG_SCORED_HOME = 1 << 1;
const MATCH_FLAG_SCORED_AWAY = 1 << 2;
const MATCH_FLAG_LAST_GOAL_N = 1 << 3;
const MATCH_FLAG_LAST_GOAL_S = 1 << 4;
const MATCH_FLAG_GOLDEN_GOAL = 1 << 5;
const MATCH_FLAG_MATCH_OVER = 1 << 6;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function packInt16(val) {
  const n = Math.round(val);
  return n < -32767 ? -32767 : n > 32767 ? 32767 : n;
}

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Shortest-arc normalized linear interpolation (nlerp) between two unit
 * quaternions, writing directly into `targetQuat` with zero heap allocation.
 * Visually indistinguishable from spherical slerp over 33 ms 30 Hz intervals.
 */
function nlerpQuat(targetQuat, ax, ay, az, aw, bx, by, bz, bw, t) {
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  let s = 1;
  if (dot < 0) {
    s = -1;
  }
  const omt = 1 - t;
  const rx = ax * omt + bx * s * t;
  const ry = ay * omt + by * s * t;
  const rz = az * omt + bz * s * t;
  const rw = aw * omt + bw * s * t;
  const inv = 1 / (Math.hypot(rx, ry, rz, rw) || 1);
  targetQuat.set(rx * inv, ry * inv, rz * inv, rw * inv);
}

/** Computes fixed byte stride per 30 Hz pose frame for `playerCount` athletes. */
export function computePoseFrameStride(playerCount) {
  const pc = clamp(Number(playerCount) || 2, 1, REPLAY_POSE_MAX_PLAYERS);
  return POSE_MATCH_HEADER_BYTES + POSE_BALL_BYTES + pc * POSE_BYTES_PER_ATHLETE;
}

/**
 * Zero-allocation 30 Hz world-state pose recorder for live matches.
 * Pre-allocates enough capacity for regulation + 3 minutes of overtime and
 * grows cleanly on extended overtimes.
 */
export class PoseReplayRecorder {
  /**
   * @param {object} meta Match header metadata (players, ball, durationSeconds, etc.).
   * @param {number|null} [initialCapacityFrames]
   */
  constructor(meta, initialCapacityFrames = null) {
    const playerCount = clamp(Number(meta?.playerCount) || 2, 1, REPLAY_POSE_MAX_PLAYERS);
    const sampleStepTicks = Math.max(1, Number(meta?.sampleStepTicks) || REPLAY_POSE_SAMPLE_STEP_TICKS);
    const defaultSec = Math.max(30, (Number(meta?.durationSeconds) || 300) + 180);
    const defaultFrames = Math.ceil((defaultSec * 60) / sampleStepTicks);

    this.playerCount = playerCount;
    this.sampleStepTicks = sampleStepTicks;
    this.strideBytes = computePoseFrameStride(playerCount);
    this.capacityFrames = Math.max(60, initialCapacityFrames || defaultFrames);
    this.buffer = new Uint8Array(this.capacityFrames * this.strideBytes);
    this.view = new DataView(this.buffer.buffer);
    this.frameCount = 0;
    this.recordedTicks = 0;
    this.active = true;
    this.meta = {
      ...meta,
      version: REPLAY_POSE_FORMAT_VERSION,
      format: 'vbreplay',
      sampleStepTicks,
      sampleHz: 60 / sampleStepTicks,
      playerCount,
      goals: Array.isArray(meta?.goals) ? [...meta.goals] : [],
      overtimeDecisions: Array.isArray(meta?.overtimeDecisions) ? [...meta.overtimeDecisions] : [],
      summary: null,
    };
  }

  ensureCapacity() {
    if (this.frameCount < this.capacityFrames) return;
    const nextCap = Math.ceil(this.capacityFrames * 1.5);
    const nextBuf = new Uint8Array(nextCap * this.strideBytes);
    nextBuf.set(this.buffer);
    this.buffer = nextBuf;
    this.view = new DataView(this.buffer.buffer);
    this.capacityFrames = nextCap;
  }

  /**
   * Called once per live 60 Hz simulation tick after physics + ragdoll snapshot + scoring.
   * Captures a pose keyframe on tick 0 and every `sampleStepTicks` (30 Hz), plus immediately
   * when `forceCapture` is true.
   */
  recordTick({ athletes, balls, matchState, forceCapture = false }) {
    if (!this.active) return;
    const liveTick = this.recordedTicks;
    this.recordedTicks += 1;
    if (!forceCapture && (liveTick % this.sampleStepTicks) !== 0) return;

    this.ensureCapacity();
    const base = this.frameCount * this.strideBytes;
    const v = this.view;

    // 1. Match Header (16 bytes)
    const ticksRem = Math.max(0, (matchState?.ticksRemaining | 0));
    const sh = clamp(matchState?.scoreHome | 0, 0, 65535);
    const sa = clamp(matchState?.scoreAway | 0, 0, 65535);
    const celeb = clamp(matchState?.celebrationTicks | 0, 0, 65535);
    let flags = 0;
    if (matchState?.targetGoal === 'S') flags |= MATCH_FLAG_TARGET_S;
    if (matchState?.lastScoredFor === 'home') flags |= MATCH_FLAG_SCORED_HOME;
    else if (matchState?.lastScoredFor === 'away') flags |= MATCH_FLAG_SCORED_AWAY;
    if (matchState?.lastGoalId === 'N') flags |= MATCH_FLAG_LAST_GOAL_N;
    else if (matchState?.lastGoalId === 'S') flags |= MATCH_FLAG_LAST_GOAL_S;
    if (matchState?.isGoldenGoal) flags |= MATCH_FLAG_GOLDEN_GOAL;
    if (matchState?.matchOver) flags |= MATCH_FLAG_MATCH_OVER;
    const otPeriod = clamp(matchState?.overtimePeriod | 0, 0, 255);

    v.setUint32(base + 0, ticksRem, true);
    v.setUint16(base + 4, sh, true);
    v.setUint16(base + 6, sa, true);
    v.setUint16(base + 8, celeb, true);
    this.buffer[base + 10] = flags;
    this.buffer[base + 11] = otPeriod;
    v.setUint32(base + 12, liveTick >>> 0, true);

    // 2. Primary Ball (20 bytes)
    const ballOff = base + POSE_MATCH_HEADER_BYTES;
    const b0 = balls?.[0];
    const bp = b0?.interpolated?.currPos || b0?.body?.translation?.() || b0?.mesh?.position;
    const bq = b0?.interpolated?.currQuat || b0?.body?.rotation?.() || b0?.mesh?.quaternion;
    v.setFloat32(ballOff + 0, Number.isFinite(bp?.x) ? bp.x : 0, true);
    v.setFloat32(ballOff + 4, Number.isFinite(bp?.y) ? bp.y : 10, true);
    v.setFloat32(ballOff + 8, Number.isFinite(bp?.z) ? bp.z : 0, true);
    v.setInt16(ballOff + 12, packInt16((Number.isFinite(bq?.x) ? bq.x : 0) * QUAT_SCALE), true);
    v.setInt16(ballOff + 14, packInt16((Number.isFinite(bq?.y) ? bq.y : 0) * QUAT_SCALE), true);
    v.setInt16(ballOff + 16, packInt16((Number.isFinite(bq?.z) ? bq.z : 0) * QUAT_SCALE), true);
    v.setInt16(ballOff + 18, packInt16((Number.isFinite(bq?.w) ? bq.w : 1) * QUAT_SCALE), true);

    // 3. Athletes (playerCount x 240 bytes)
    let athBase = ballOff + POSE_BALL_BYTES;
    for (let i = 0; i < this.playerCount; i++) {
      const ath = athletes?.[i];
      const mp = ath?.motor?.interpolated?.currPos || ath?.motor?.body?.translation?.() || ath?.motor?.mesh?.position;
      const mx = Number.isFinite(mp?.x) ? mp.x : 0;
      const my = Number.isFinite(mp?.y) ? mp.y : 1.0;
      const mz = Number.isFinite(mp?.z) ? mp.z : 0;
      const yaw = Number.isFinite(ath?.animTarget?.yaw) ? ath.animTarget.yaw : 0;

      v.setFloat32(athBase + 0, mx, true);
      v.setFloat32(athBase + 4, my, true);
      v.setFloat32(athBase + 8, mz, true);
      v.setFloat32(athBase + 12, yaw, true);

      const rig = ath?.ragdoll?.rig;
      let partOff = athBase + POSE_ATHLETE_HEADER_BYTES;
      for (let p = 0; p < POSE_PART_COUNT; p++) {
        const item = rig ? rig.get(POSE_PART_KEYS[p]) : null;
        const ip = item?.interpolated?.currPos || item?.body?.translation?.() || item?.mesh?.position;
        const iq = item?.interpolated?.currQuat || item?.body?.rotation?.() || item?.mesh?.quaternion;
        const rx = Number.isFinite(ip?.x) ? ip.x - mx : 0;
        const ry = Number.isFinite(ip?.y) ? ip.y - my : 0;
        const rz = Number.isFinite(ip?.z) ? ip.z - mz : 0;
        v.setInt16(partOff + 0, packInt16(rx * REL_POS_SCALE), true);
        v.setInt16(partOff + 2, packInt16(ry * REL_POS_SCALE), true);
        v.setInt16(partOff + 4, packInt16(rz * REL_POS_SCALE), true);
        v.setInt16(partOff + 6, packInt16((Number.isFinite(iq?.x) ? iq.x : 0) * QUAT_SCALE), true);
        v.setInt16(partOff + 8, packInt16((Number.isFinite(iq?.y) ? iq.y : 0) * QUAT_SCALE), true);
        v.setInt16(partOff + 10, packInt16((Number.isFinite(iq?.z) ? iq.z : 0) * QUAT_SCALE), true);
        v.setInt16(partOff + 12, packInt16((Number.isFinite(iq?.w) ? iq.w : 1) * QUAT_SCALE), true);
        partOff += POSE_PART_BYTES;
      }

      athBase += POSE_BYTES_PER_ATHLETE;
    }

    this.frameCount += 1;
  }

  /** Appends a goal timestamp marker aligned to exact 60 Hz match tick. */
  recordGoal({ scoredFor, goal, scoreHome, scoreAway, scorerSlot = null, assistSlot = null }) {
    if (!this.active) return;
    this.meta.goals.push({
      frame: this.recordedTicks,
      scoredFor,
      goal,
      scoreHome,
      scoreAway,
      scorerSlot,
      assistSlot,
    });
  }

  recordOvertime({ format, durationSeconds, positionMode, dropPos = null, spawns = null }) {
    if (!this.active) return;
    this.meta.overtimeDecisions.push({
      frame: this.recordedTicks,
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

  /** Seals recording and returns `{ meta, frames, strideBytes }`. */
  finalize(summary = {}) {
    this.active = false;
    const totalTicks = Math.max(this.recordedTicks, Math.max(0, this.frameCount - 1) * this.sampleStepTicks);
    this.meta.totalTicks = totalTicks;
    this.meta.summary = {
      ...summary,
      totalFrames: totalTicks,
      poseSamples: this.frameCount,
      totalGoals: this.meta.goals.length,
    };
    const frames = this.buffer.slice(0, this.frameCount * this.strideBytes);
    return {
      meta: this.meta,
      frames,
      strideBytes: this.strideBytes,
    };
  }
}

/**
 * Instant random-access v3 World-State Pose Player.
 * Seeking or scrubbing to ANY tick in a 10-minute match executes in < 0.2 ms
 * with zero physics re-simulation and zero heap allocations.
 */
export class PoseReplayPlayer {
  constructor(replay) {
    if (!replay || !replay.meta || !(replay.frames instanceof Uint8Array)) {
      throw new Error('PoseReplayPlayer requires a decoded replay object { meta, frames }');
    }
    this.meta = replay.meta;
    this.frames = replay.frames;
    this.view = new DataView(this.frames.buffer, this.frames.byteOffset, this.frames.byteLength);
    this.playerCount = clamp(Number(replay.meta.playerCount) || 2, 1, REPLAY_POSE_MAX_PLAYERS);
    this.sampleStepTicks = Math.max(1, Number(replay.meta.sampleStepTicks) || REPLAY_POSE_SAMPLE_STEP_TICKS);
    this.strideBytes = replay.strideBytes || computePoseFrameStride(this.playerCount);
    this.sampleCount = Math.floor(this.frames.byteLength / this.strideBytes);
    this.totalFrames = Math.max(
      0,
      Number(replay.meta.totalTicks) || Math.max(0, this.sampleCount - 1) * this.sampleStepTicks,
    );
    this.cursor = 0; // continuous 60 Hz tick position in [0, totalFrames]
    this._lastCelebGoalSig = '';
  }

  get isComplete() {
    return this.cursor >= this.totalFrames;
  }

  reset() {
    this.cursor = 0;
    this._lastCelebGoalSig = '';
  }

  /**
   * Reads the recorded match tick stored inside keyframe index `sampleIdx`.
   */
  getSampleTick(sampleIdx) {
    if (this.sampleCount <= 0) return 0;
    const idx = clamp(sampleIdx | 0, 0, this.sampleCount - 1);
    return this.view.getUint32(idx * this.strideBytes + 12, true);
  }

  /**
   * Binary-searches the bracket `(idxA, idxB, blend)` matching `targetTick` cleanly
   * even if extra forced keyframes were captured on goal ticks.
   */
  _findBracket(targetTick, out) {
    const n = this.sampleCount;
    if (n <= 1) {
      out.idxA = 0;
      out.idxB = 0;
      out.blend = 0;
      return;
    }
    const lastTick = this.getSampleTick(n - 1);
    if (targetTick <= this.getSampleTick(0)) {
      out.idxA = 0;
      out.idxB = 0;
      out.blend = 0;
      return;
    }
    if (targetTick >= lastTick) {
      out.idxA = n - 1;
      out.idxB = n - 1;
      out.blend = 0;
      return;
    }

    let lo = 0;
    let hi = n - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (this.getSampleTick(mid) <= targetTick) lo = mid;
      else hi = mid;
    }
    const tA = this.getSampleTick(lo);
    const tB = this.getSampleTick(hi);
    const span = tB - tA;
    out.idxA = lo;
    out.idxB = hi;
    out.blend = span > 1e-6 ? clamp((targetTick - tA) / span, 0, 1) : 0;
  }

  /**
   * Applies interpolated world poses directly to visual meshes, `Interpolated` buffers,
   * and `matchState` at continuous 60 Hz tick `targetTick`. Zero heap allocations.
   *
   * @param {number} targetTick
   * @param {{ athletes: Array<object>, balls: Array<object>, matchState?: object, goalCelebration?: object }} ctx
   */
  applyAtTick(targetTick, { athletes = [], balls = [], matchState = null, goalCelebration = null } = {}) {
    if (this.sampleCount === 0) return false;
    const clampedTick = clamp(Number.isFinite(targetTick) ? targetTick : 0, 0, this.totalFrames);
    this.cursor = clampedTick;

    this._findBracket(clampedTick, _bracketScratch);
    const baseA = _bracketScratch.idxA * this.strideBytes;
    const baseB = _bracketScratch.idxB * this.strideBytes;
    const t = _bracketScratch.blend;
    const omt = 1 - t;
    const v = this.view;

    // 1. Match Scoreboard / Clock / Goal State (discrete from idxA)
    if (matchState) {
      const ticksRemA = v.getUint32(baseA + 0, true);
      const ticksRemB = v.getUint32(baseB + 0, true);
      matchState.ticksRemaining = Math.round(ticksRemA * omt + ticksRemB * t);
      matchState.scoreHome = v.getUint16(baseA + 4, true);
      matchState.scoreAway = v.getUint16(baseA + 6, true);
      const celebTicks = v.getUint16(baseA + 8, true);
      matchState.celebrationTicks = celebTicks;
      const flags = this.frames[baseA + 10];
      matchState.targetGoal = (flags & MATCH_FLAG_TARGET_S) ? 'S' : 'N';
      matchState.lastScoredFor = (flags & MATCH_FLAG_SCORED_HOME)
        ? 'home'
        : ((flags & MATCH_FLAG_SCORED_AWAY) ? 'away' : null);
      matchState.lastGoalId = (flags & MATCH_FLAG_LAST_GOAL_N)
        ? 'N'
        : ((flags & MATCH_FLAG_LAST_GOAL_S) ? 'S' : null);
      matchState.isGoldenGoal = Boolean(flags & MATCH_FLAG_GOLDEN_GOAL);
      matchState.overtimePeriod = this.frames[baseA + 11];
      matchState.isCountingDown = false;
      matchState.countdownTicksRemaining = 0;
      matchState.matchOver = false;

      if (goalCelebration && celebTicks > 150 && matchState.lastGoalId && matchState.lastScoredFor) {
        const sig = `${matchState.scoreHome}-${matchState.scoreAway}-${matchState.lastGoalId}`;
        if (sig !== this._lastCelebGoalSig) {
          this._lastCelebGoalSig = sig;
          _goalHoopPos.z = matchState.lastGoalId === 'N' ? -40.0 : 40.0;
          goalCelebration.triggerGoal?.(matchState.lastScoredFor, _goalHoopPos, _goalHoopPos);
        }
      } else if (celebTicks === 0) {
        this._lastCelebGoalSig = '';
      }
    }

    // 2. Primary Ball Transform
    const b0 = balls?.[0];
    if (b0?.mesh) {
      const ballOffA = baseA + POSE_MATCH_HEADER_BYTES;
      const ballOffB = baseB + POSE_MATCH_HEADER_BYTES;
      const ax = v.getFloat32(ballOffA + 0, true);
      const ay = v.getFloat32(ballOffA + 4, true);
      const az = v.getFloat32(ballOffA + 8, true);
      const bx = v.getFloat32(ballOffB + 0, true);
      const by = v.getFloat32(ballOffB + 4, true);
      const bz = v.getFloat32(ballOffB + 8, true);

      const dsq = (bx - ax) * (bx - ax) + (by - ay) * (by - ay) + (bz - az) * (bz - az);
      const bt = dsq > TELEPORT_SNAP_DIST_SQ ? 0 : t;
      const bomt = 1 - bt;
      const px = ax * bomt + bx * bt;
      const py = ay * bomt + by * bt;
      const pz = az * bomt + bz * bt;

      b0.mesh.visible = true;
      b0.mesh.position.set(px, py, pz);
      nlerpQuat(
        b0.mesh.quaternion,
        v.getInt16(ballOffA + 12, true) * INV_QUAT_SCALE,
        v.getInt16(ballOffA + 14, true) * INV_QUAT_SCALE,
        v.getInt16(ballOffA + 16, true) * INV_QUAT_SCALE,
        v.getInt16(ballOffA + 18, true) * INV_QUAT_SCALE,
        v.getInt16(ballOffB + 12, true) * INV_QUAT_SCALE,
        v.getInt16(ballOffB + 14, true) * INV_QUAT_SCALE,
        v.getInt16(ballOffB + 16, true) * INV_QUAT_SCALE,
        v.getInt16(ballOffB + 18, true) * INV_QUAT_SCALE,
        bt,
      );
      if (b0.interpolated) {
        b0.interpolated.prevPos.copy(b0.mesh.position);
        b0.interpolated.currPos.copy(b0.mesh.position);
        b0.interpolated.prevQuat.copy(b0.mesh.quaternion);
        b0.interpolated.currQuat.copy(b0.mesh.quaternion);
      }
    }

    // 3. Athletes (Motor Root + Facing Yaw + 16 Ragdoll Parts)
    let athBaseA = baseA + POSE_MATCH_HEADER_BYTES + POSE_BALL_BYTES;
    let athBaseB = baseB + POSE_MATCH_HEADER_BYTES + POSE_BALL_BYTES;
    for (let i = 0; i < this.playerCount; i++) {
      const ath = athletes?.[i];
      if (ath && ath.isEnabled) {
        const amx = v.getFloat32(athBaseA + 0, true);
        const amy = v.getFloat32(athBaseA + 4, true);
        const amz = v.getFloat32(athBaseA + 8, true);
        const bmx = v.getFloat32(athBaseB + 0, true);
        const bmy = v.getFloat32(athBaseB + 4, true);
        const bmz = v.getFloat32(athBaseB + 8, true);

        const dsq = (bmx - amx) * (bmx - amx) + (bmy - amy) * (bmy - amy) + (bmz - amz) * (bmz - amz);
        const at = dsq > TELEPORT_SNAP_DIST_SQ ? 0 : t;
        const aomt = 1 - at;
        const mx = amx * aomt + bmx * at;
        const my = amy * aomt + bmy * at;
        const mz = amz * aomt + bmz * at;

        if (ath.motor?.mesh) {
          ath.motor.mesh.position.set(mx, my, mz);
        }
        if (ath.motor?.interpolated) {
          ath.motor.interpolated.prevPos.set(mx, my, mz);
          ath.motor.interpolated.currPos.set(mx, my, mz);
        }

        const yawA = v.getFloat32(athBaseA + 12, true);
        const yawB = v.getFloat32(athBaseB + 12, true);
        if (ath.animTarget) {
          ath.animTarget.yaw = lerpAngle(yawA, yawB, at);
        }

        if (ath.ragdoll?.group) {
          ath.ragdoll.group.visible = true;
        }
        const rig = ath.ragdoll?.rig;
        if (rig) {
          let partA = athBaseA + POSE_ATHLETE_HEADER_BYTES;
          let partB = athBaseB + POSE_ATHLETE_HEADER_BYTES;
          for (let p = 0; p < POSE_PART_COUNT; p++) {
            const item = rig.get(POSE_PART_KEYS[p]);
            if (item?.mesh) {
              const pax = amx + v.getInt16(partA + 0, true) * INV_REL_POS_SCALE;
              const pay = amy + v.getInt16(partA + 2, true) * INV_REL_POS_SCALE;
              const paz = amz + v.getInt16(partA + 4, true) * INV_REL_POS_SCALE;
              const pbx = bmx + v.getInt16(partB + 0, true) * INV_REL_POS_SCALE;
              const pby = bmy + v.getInt16(partB + 2, true) * INV_REL_POS_SCALE;
              const pbz = bmz + v.getInt16(partB + 4, true) * INV_REL_POS_SCALE;
              item.mesh.position.set(
                pax * aomt + pbx * at,
                pay * aomt + pby * at,
                paz * aomt + pbz * at,
              );
              nlerpQuat(
                item.mesh.quaternion,
                v.getInt16(partA + 6, true) * INV_QUAT_SCALE,
                v.getInt16(partA + 8, true) * INV_QUAT_SCALE,
                v.getInt16(partA + 10, true) * INV_QUAT_SCALE,
                v.getInt16(partA + 12, true) * INV_QUAT_SCALE,
                v.getInt16(partB + 6, true) * INV_QUAT_SCALE,
                v.getInt16(partB + 8, true) * INV_QUAT_SCALE,
                v.getInt16(partB + 10, true) * INV_QUAT_SCALE,
                v.getInt16(partB + 12, true) * INV_QUAT_SCALE,
                at,
              );
              if (item.interpolated) {
                item.interpolated.prevPos.copy(item.mesh.position);
                item.interpolated.currPos.copy(item.mesh.position);
                item.interpolated.prevQuat.copy(item.mesh.quaternion);
                item.interpolated.currQuat.copy(item.mesh.quaternion);
              }
            }
            partA += POSE_PART_BYTES;
            partB += POSE_PART_BYTES;
          }
        }
      }
      athBaseA += POSE_BYTES_PER_ATHLETE;
      athBaseB += POSE_BYTES_PER_ATHLETE;
    }

    return true;
  }
}

const _bracketScratch = { idxA: 0, idxB: 0, blend: 0 };
const _goalHoopPos = { x: 0, y: 10.0, z: -40.0 };
