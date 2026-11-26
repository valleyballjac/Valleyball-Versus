/**
 * ============================================================================
 * MODULE: src/features/match/replayManager.js
 * ============================================================================
 * ROLE:
 *   Silent `.vbreplay` match recording and Broadcast Director playback manager
 *   for playtests and tournaments. Live matches record v3 World-State Pose
 *   Keyframes (30 Hz ball + 16-part athlete ragdoll transforms + scoreboard
 *   state), eliminating replay desync permanently and enabling instant < 1 ms
 *   timeline scrubbing, live drag preview, and smooth continuous rewind.
 *   Also decodes legacy v2 input-stream replays seamlessly.
 *
 * FRAME PHASE:
 *   - `recordPoseTick` / `recordSlot` / `commitTick`: invoked inside 60 Hz
 *     `fixedUpdate` (zero hot-loop allocations).
 *   - `advancePosePlayback`: invoked inside `render()` for smooth 60-165 FPS
 *     pose interpolation without stepping Rapier physics.
 *   - `beginMatchRecording` / `finishMatchRecording`: match start/end only.
 * ============================================================================
 */

import {
  ReplayRecorder,
  ReplayPlayer,
  encodeReplayBinary,
  decodeReplayBinary,
} from '../../core/replay.js';
import {
  PoseReplayRecorder,
  PoseReplayPlayer,
  REPLAY_POSE_FORMAT_VERSION,
} from '../../core/replayPose.js';
import { createFixtureRandom } from './matchFixture.js';

const APP_VERSION = '0.4.2';
const MAX_MEMORY_REPLAYS = 5;
export const REPLAY_SPEEDS = Object.freeze([-4, -2, -1, 0.1, 0.25, 0.5, 1, 2, 4]);
export const REPLAY_CAMERA_HEIGHT_MIN = -8;
export const REPLAY_CAMERA_HEIGHT_MAX = 24;
export const REPLAY_CAMERAS = Object.freeze([
  'broadcast',
  'sports',
  'tactical',
  'chase',
  'thirdPerson',
  'firstPerson',
  'free',
]);

let activeRecorder = null;
let activePlayer = null;
let currentPlaybackPrep = null;
let currentPlaybackRecord = null;
let lastSavedReplay = null; // { filename, bytes, meta, savedPath }
const recentReplays = [];

let playbackSpeed = 1;
let playbackPaused = false;
let playbackAccumulator = 0;
let playbackCameraPreset = 'broadcast';
let playbackSeeking = false;
let playbackFollowSlot = 0;
let playbackCameraHeightOffset = 0;
let replayOrbitYawOffset = 0;
let lastPlayerCameras = null;

const _playbackStatus = {
  active: false,
  isPose: false,
  cursor: 0,
  totalFrames: 0,
  speed: 1,
  paused: false,
  seeking: false,
  cameraPreset: 'broadcast',
  cameraHeightOffset: 0,
  followSlot: 0,
  goals: [],
  meta: null,
};

function syncPlayerCameraHeightOffsets(playerCameras, offset) {
  const cams = playerCameras || lastPlayerCameras;
  if (!Array.isArray(cams)) return;
  if (playerCameras) lastPlayerCameras = playerCameras;
  for (let i = 0; i < cams.length; i++) {
    if (cams[i]) cams[i].heightOffset = offset;
  }
}

/** Generates a uint32 seed for a lobby match when no fixture seed is present. */
export function generateMatchSeed(explicitSeed = null) {
  if (Number.isInteger(explicitSeed) && explicitSeed >= 0) {
    return explicitSeed >>> 0;
  }
  return (Math.floor(Math.random() * 0xffffffff) ^ (Date.now() >>> 0)) >>> 0;
}

/** Creates a deterministic PRNG for match setup (stream heads, random ball, bots). */
export function createMatchRandom(seed) {
  return createFixtureRandom(seed >>> 0);
}

/** Formats a safe, sortable `.vbreplay` filename from match metadata. */
export function buildReplayFilename(meta, summary = {}) {
  const rawDate = (meta?.recordedAt || new Date().toISOString())
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const mode = meta?.mode === '2v2' ? '2v2' : '1v1';
  const ball = String(meta?.ball || 'medium').replace(/[^a-z0-9]/gi, '');
  const sh = Number.isFinite(summary.scoreHome) ? summary.scoreHome : 0;
  const sa = Number.isFinite(summary.scoreAway) ? summary.scoreAway : 0;
  return `vb_${rawDate}_${mode}_${ball}_${sh}-${sa}.vbreplay`;
}

function sanitizePlayersForHeader(configs, count, athletes = []) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const cfg = configs?.[i] || {};
    const ath = athletes?.[i] || null;
    out.push({
      slot: i,
      team: cfg.team || ath?.team || (i % 2 === 0 ? 'home' : 'away'),
      type: cfg.type === 'ai' ? 'ai' : 'human',
      displayName: cfg.displayName || cfg.name || `P${i + 1}`,
      variant: cfg.variant || ath?.variant || 'classic',
      primaryColor: cfg.primaryColor ?? ath?.primaryColor ?? (i % 2 === 0 ? 0xd90429 : 0x1d4ed8),
      headwear: cfg.headwear ?? ath?.headwear ?? null,
      cameraMode: cfg.cameraMode || 'chase',
      difficulty: cfg.difficulty || 'medium',
      aggressiveness: cfg.aggressiveness ?? 0.6,
      assistPreset: ath?.assistPreset || 'standard',
    });
  }
  return out;
}

function alignFollowCameraToAthlete(slot, athletes, playerCameras, snap = false) {
  const ath = athletes?.[slot];
  const pc = playerCameras?.[slot];
  if (!ath || !pc) return;
  const yaw = ath.animTarget?.yaw;
  if (!Number.isFinite(yaw)) return;
  const targetAz = yaw + Math.PI + replayOrbitYawOffset;
  if (snap || playbackCameraPreset === 'firstPerson') {
    if (snap) {
      pc.azimuth = targetAz;
      pc.resetSmoothing?.();
    } else {
      let d = (targetAz - pc.azimuth) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      pc.azimuth += d * 0.22;
    }
  }
}

export const replayManager = {
  /** True while replay playback (v3 world-state pose or legacy v2 input) is active. */
  isPlayingBack() {
    return activePlayer !== null;
  },

  /** True when active playback is a v3 World-State Pose replay (zero Rapier stepping). */
  isPosePlayback() {
    return activePlayer instanceof PoseReplayPlayer;
  },

  /** True while a live match is being recorded. */
  isRecording() {
    return activeRecorder !== null && activeRecorder.active;
  },

  /** Starts a fresh silent recording for a match (defaults to v3 world-state pose). */
  beginMatchRecording({
    seed,
    configs,
    athletes = [],
    playerCount = 2,
    ball = 'medium',
    durationSeconds = 300,
    arena = 'court',
    initialDrop = null,
    initialSpawns = null,
    fixtureId = null,
    recordingMode = 'pose',
  }) {
    if (activePlayer) return null;
    const count = playerCount >= 4 ? 4 : 2;
    const players = sanitizePlayersForHeader(configs, count, athletes);
    const humanCount = players.filter((p) => p.type === 'human').length;

    const meta = {
      appVersion: APP_VERSION,
      recordedAt: new Date().toISOString(),
      seed: seed >>> 0,
      fixtureId: fixtureId || null,
      mode: count >= 4 ? '2v2' : '1v1',
      playerCount: count,
      arena,
      ball,
      durationSeconds,
      humanCount,
      initialDrop: initialDrop ? { x: initialDrop.x, y: initialDrop.y, z: initialDrop.z } : null,
      initialSpawns: Array.isArray(initialSpawns)
        ? initialSpawns.map((s) => ({
            pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z },
            facingYaw: s.facingYaw,
            cameraAzimuth: s.cameraAzimuth,
          }))
        : null,
      players,
    };

    activeRecorder = recordingMode === 'input'
      ? new ReplayRecorder(meta)
      : new PoseReplayRecorder(meta);
    return activeRecorder;
  },

  /** Cancels any active recording (e.g., abandoned to title screen or practice). */
  cancelRecording() {
    activeRecorder = null;
  },

  /** Stops active replay playback and resets transport controls. */
  stopPlayback(playerCameras = null) {
    activePlayer = null;
    currentPlaybackPrep = null;
    currentPlaybackRecord = null;
    playbackSpeed = 1;
    playbackPaused = false;
    playbackAccumulator = 0;
    playbackCameraPreset = 'broadcast';
    playbackSeeking = false;
    playbackFollowSlot = 0;
    playbackCameraHeightOffset = 0;
    syncPlayerCameraHeightOffsets(playerCameras, 0);
  },

  /** True while deterministic legacy seek is executing silently. */
  isSeeking() {
    return playbackSeeking;
  },

  /** Sets replay playback speed (`-4 | -2 | -1 | 0.1 | 0.25 | 0.5 | 1 | 2 | 4`), external to frozen `Loop.js`. */
  setPlaybackSpeed(speed) {
    if (REPLAY_SPEEDS.includes(speed)) {
      if (speed < 0 && !(activePlayer instanceof PoseReplayPlayer)) {
        // Legacy v2 input-only replays cannot reverse continuously; keep forward speed
        return playbackSpeed;
      }
      playbackSpeed = speed;
      playbackAccumulator = 0;
    }
    return playbackSpeed;
  },

  getPlaybackSpeed() {
    return playbackSpeed;
  },

  cyclePlaybackSpeed(dir = 1) {
    const allowed = (activePlayer instanceof PoseReplayPlayer)
      ? REPLAY_SPEEDS
      : [0.1, 0.25, 0.5, 1, 2, 4];
    const idx = Math.max(0, allowed.indexOf(playbackSpeed));
    const next = Math.max(0, Math.min(allowed.length - 1, idx + (dir >= 0 ? 1 : -1)));
    playbackSpeed = allowed[next];
    playbackAccumulator = 0;
    return playbackSpeed;
  },

  /** Toggles / cycles slow-motion playback (`0.5x -> 0.25x -> 0.1x -> 1x`). */
  cycleSlowMo() {
    playbackPaused = false;
    if (activePlayer instanceof PoseReplayPlayer && activePlayer.cursor >= activePlayer.totalFrames - 1) {
      activePlayer.cursor = 0;
    }
    if (playbackSpeed === 0.5) playbackSpeed = 0.25;
    else if (playbackSpeed === 0.25) playbackSpeed = 0.1;
    else if (playbackSpeed === 0.1) playbackSpeed = 1;
    else playbackSpeed = 0.5;
    playbackAccumulator = 0;
    return playbackSpeed;
  },

  /** Orbits the followed player's replay camera (`chase`, `thirdPerson`, `firstPerson`) via mouse drag. */
  orbitFollowCamera(deltaYaw = 0, deltaPitch = 0, playerCameras = null) {
    const cams = playerCameras || lastPlayerCameras;
    const pc = cams?.[playbackFollowSlot] || cams?.[0];
    if (!pc) return;
    if (playbackCameraPreset === 'thirdPerson') {
      pc.manualAzimuthOffset = (pc.manualAzimuthOffset || 0) + deltaYaw;
      pc.manualPitchOffset = Math.max(-0.5, Math.min(0.95, (pc.manualPitchOffset || 0) + deltaPitch));
      pc.manualIdleTimer = -3.0;
    } else if (playbackCameraPreset === 'firstPerson') {
      replayOrbitYawOffset += deltaYaw;
      pc.azimuth = (pc.azimuth || 0) + deltaYaw;
      pc.pitch = Math.max(-1.1, Math.min(1.1, (pc.pitch || 0) + deltaPitch));
    } else {
      pc.azimuth = (pc.azimuth || 0) + deltaYaw;
      pc.pitch = Math.max(-0.35, Math.min(1.25, (pc.pitch ?? 0.35) + deltaPitch));
    }
  },

  /** Sets vertical crane height offset (meters) for tracked replay cameras. */
  setCameraHeightOffset(offsetMeters = 0, playerCameras = null) {
    const clamped = Math.max(
      REPLAY_CAMERA_HEIGHT_MIN,
      Math.min(REPLAY_CAMERA_HEIGHT_MAX, Number.isFinite(offsetMeters) ? offsetMeters : 0),
    );
    playbackCameraHeightOffset = Math.round(clamped * 20) / 20;
    syncPlayerCameraHeightOffsets(playerCameras, playbackCameraHeightOffset);
    return playbackCameraHeightOffset;
  },

  /** Adjusts vertical crane height offset by `deltaMeters` for tracked replay cameras. */
  adjustCameraHeightOffset(deltaMeters = 0, playerCameras = null) {
    return this.setCameraHeightOffset(playbackCameraHeightOffset + (Number(deltaMeters) || 0), playerCameras);
  },

  getCameraHeightOffset() {
    return playbackCameraHeightOffset;
  },

  /** Toggles / cycles continuous reverse playback (`-1x -> -2x -> -4x -> -1x`) on v3 pose replays. */
  cycleRewind() {
    if (!(activePlayer instanceof PoseReplayPlayer)) return playbackSpeed;
    playbackPaused = false;
    if (activePlayer.cursor <= 1) {
      activePlayer.cursor = activePlayer.totalFrames;
    }
    if (playbackSpeed === -1) playbackSpeed = -2;
    else if (playbackSpeed === -2) playbackSpeed = -4;
    else playbackSpeed = -1;
    playbackAccumulator = 0;
    return playbackSpeed;
  },

  /** Toggles / cycles fast-forward (`2x -> 4x -> 1x`). */
  cycleFastForward() {
    playbackPaused = false;
    if (activePlayer instanceof PoseReplayPlayer && activePlayer.cursor >= activePlayer.totalFrames - 1) {
      activePlayer.cursor = 0;
    }
    if (playbackSpeed === 2) playbackSpeed = 4;
    else if (playbackSpeed === 4) playbackSpeed = 1;
    else playbackSpeed = 2;
    playbackAccumulator = 0;
    return playbackSpeed;
  },

  setPlaybackPaused(paused) {
    playbackPaused = Boolean(paused);
    return playbackPaused;
  },

  togglePlaybackPaused() {
    if (playbackPaused && activePlayer instanceof PoseReplayPlayer) {
      if (playbackSpeed > 0 && activePlayer.cursor >= activePlayer.totalFrames - 0.5) {
        activePlayer.cursor = 0;
      } else if (playbackSpeed < 0 && activePlayer.cursor <= 0.5) {
        playbackSpeed = 1;
      }
    }
    playbackPaused = !playbackPaused;
    return playbackPaused;
  },

  isPlaybackPaused() {
    return playbackPaused;
  },

  setCameraPreset(preset) {
    if (REPLAY_CAMERAS.includes(preset)) {
      playbackCameraPreset = preset;
    }
    return playbackCameraPreset;
  },

  cycleCameraPreset(dir = 1) {
    const idx = Math.max(0, REPLAY_CAMERAS.indexOf(playbackCameraPreset));
    const next = (idx + (dir >= 0 ? 1 : -1) + REPLAY_CAMERAS.length) % REPLAY_CAMERAS.length;
    playbackCameraPreset = REPLAY_CAMERAS[next];
    return playbackCameraPreset;
  },

  getCameraPreset() {
    return playbackCameraPreset;
  },

  setFollowSlot(slotIdx) {
    const count = Math.max(2, activePlayer?.playerCount || 2);
    playbackFollowSlot = Math.max(0, Math.min(count - 1, slotIdx | 0));
    return playbackFollowSlot;
  },

  cycleFollowSlot(dir = 1) {
    const count = Math.max(2, activePlayer?.playerCount || 2);
    playbackFollowSlot = (playbackFollowSlot + (dir >= 0 ? 1 : -1) + count) % count;
    return playbackFollowSlot;
  },

  getFollowSlot() {
    return playbackFollowSlot;
  },

  /**
   * For legacy v2 input replays: computes how many 60 Hz physics steps to run.
   * For v3 pose replays: returns `0` because physics stepping is bypassed completely.
   */
  consumePlaybackSteps() {
    if (!activePlayer || playbackPaused || activePlayer instanceof PoseReplayPlayer) return 0;
    if (playbackSpeed <= 0) return 0;
    playbackAccumulator += playbackSpeed;
    const steps = Math.floor(playbackAccumulator + 1e-9);
    playbackAccumulator = Math.max(0, playbackAccumulator - steps);
    return steps;
  },

  /**
   * Advances and renders v3 World-State Pose playback inside `render(alpha)`.
   * Smoothly interpolates forward OR backward at any playback speed with zero
   * physics simulation and zero heap allocations.
   */
  advancePosePlayback(frameDelta, ctx = {}) {
    if (!(activePlayer instanceof PoseReplayPlayer)) return false;
    if (!playbackPaused && frameDelta > 0) {
      let next = activePlayer.cursor + frameDelta * 60 * playbackSpeed;
      if (playbackSpeed > 0 && next >= activePlayer.totalFrames) {
        next = activePlayer.totalFrames;
        playbackPaused = true;
      } else if (playbackSpeed < 0 && next <= 0) {
        next = 0;
        playbackPaused = true;
        playbackSpeed = 1;
      }
      activePlayer.cursor = next;
    }
    const ok = activePlayer.applyAtTick(activePlayer.cursor, ctx);
    if (ctx.playerCameras) syncPlayerCameraHeightOffsets(ctx.playerCameras, playbackCameraHeightOffset);
    if (ok && (playbackCameraPreset === 'firstPerson' || playbackCameraPreset === 'chase')) {
      alignFollowCameraToAthlete(playbackFollowSlot, ctx.athletes, ctx.playerCameras, false);
    }
    return ok;
  },

  /** Returns zero-allocation live playback transport status for the Broadcast Replay Dock. */
  getPlaybackStatus() {
    _playbackStatus.active = activePlayer !== null;
    _playbackStatus.isPose = activePlayer instanceof PoseReplayPlayer;
    _playbackStatus.cursor = activePlayer ? activePlayer.cursor : 0;
    _playbackStatus.totalFrames = activePlayer ? activePlayer.totalFrames : 0;
    _playbackStatus.speed = playbackSpeed;
    _playbackStatus.paused = playbackPaused;
    _playbackStatus.seeking = playbackSeeking;
    _playbackStatus.cameraPreset = playbackCameraPreset;
    _playbackStatus.cameraHeightOffset = playbackCameraHeightOffset;
    _playbackStatus.followSlot = playbackFollowSlot;
    _playbackStatus.goals = activePlayer?.meta?.goals || [];
    _playbackStatus.meta = activePlayer?.meta || null;
    return _playbackStatus;
  },

  /**
   * Switches active replay camera between Broadcast, Dynamic Sports, Tactical,
   * Chase, Ball-Track (3rd Person), 1st-Person POV, and Free Drone for `playbackFollowSlot`.
   */
  applyCameraPreset(preset, { cinematicCamera, playerCameras, spectatorCamera, athletes, syncPlayerCameraMode, applyViewportSize }) {
    const mode = this.setCameraPreset(preset);
    replayOrbitYawOffset = 0;
    if (playerCameras) syncPlayerCameraHeightOffsets(playerCameras, playbackCameraHeightOffset);
    const slot = playbackFollowSlot;
    if (mode === 'free') {
      cinematicCamera?.startFreeFly(playerCameras?.[slot]?.camera || playerCameras?.[0]?.camera || spectatorCamera);
    } else {
      cinematicCamera?.stopFreeFly();
      const targetCam = playerCameras?.[slot] || playerCameras?.[0];
      targetCam?.setMode(mode, false);
      if (mode === 'chase' || mode === 'firstPerson') {
        alignFollowCameraToAthlete(slot, athletes, playerCameras, true);
      } else {
        targetCam?.resetSmoothing?.();
      }
      syncPlayerCameraMode?.(slot, mode);
    }
    applyViewportSize?.();
    return mode;
  },

  /**
   * Switches which athlete (`0..3`) replay player-centric cameras follow.
   * When currently on a stadium-wide preset (`broadcast`, `sports`, `free`), automatically
   * switches to `chase` on that athlete so selecting P2/P3/P4 immediately shows their view.
   */
  applyFollowSlot(slotIdx, ctx = {}, { keepPreset = false } = {}) {
    const slot = this.setFollowSlot(slotIdx);
    const playerCentric = playbackCameraPreset === 'chase'
      || playbackCameraPreset === 'thirdPerson'
      || playbackCameraPreset === 'firstPerson'
      || playbackCameraPreset === 'tactical';
    const nextMode = (!keepPreset && !playerCentric) ? 'chase' : playbackCameraPreset;
    this.applyCameraPreset(nextMode, ctx);
    return slot;
  },

  /**
   * Instant < 0.2 ms random-access timeline seek for v3 World-State Pose replays,
   * with legacy deterministic re-simulation fallback for v2 input replays.
   */
  seekToFrame(targetFrame, ctx = {}) {
    if (!activePlayer) return false;
    const clamped = Math.max(0, Math.min(activePlayer.totalFrames, Number(targetFrame) || 0));

    if (activePlayer instanceof PoseReplayPlayer) {
      const prevCursor = activePlayer.cursor;
      activePlayer.applyAtTick(clamped, ctx);
      if (Math.abs(clamped - prevCursor) > 30) {
        const pc = ctx.playerCameras?.[playbackFollowSlot];
        if (playbackCameraPreset === 'chase' || playbackCameraPreset === 'firstPerson') {
          alignFollowCameraToAthlete(playbackFollowSlot, ctx.athletes, ctx.playerCameras, true);
        } else {
          pc?.resetSmoothing?.();
        }
      }
      return true;
    }

    if (!currentPlaybackPrep) return false;
    const { resetMatchForSeek, stepOneReplayTick } = ctx;
    if (typeof resetMatchForSeek !== 'function' || typeof stepOneReplayTick !== 'function') return false;
    const rounded = Math.round(clamped);
    const wasPaused = playbackPaused;
    playbackSeeking = true;
    playbackAccumulator = 0;
    try {
      activePlayer.reset();
      resetMatchForSeek(currentPlaybackPrep);
      for (let f = 0; f < rounded; f++) {
        stepOneReplayTick(f);
      }
    } finally {
      playbackSeeking = false;
      playbackPaused = wasPaused;
    }
    return true;
  },

  /**
   * Jumps to 3 seconds before the previous or next goal marker (or match start/end).
   */
  jumpToAdjacentGoal(dir = 1, ctx = {}) {
    if (!activePlayer) return false;
    const goals = activePlayer.meta?.goals || [];
    const cur = activePlayer.cursor;
    const LEAD_IN = 180; // 3 seconds before goal
    if (dir < 0) {
      let target = 0;
      for (let i = goals.length - 1; i >= 0; i--) {
        const gTarget = Math.max(0, (goals[i].frame || 0) - LEAD_IN);
        if (gTarget < cur - 45) {
          target = gTarget;
          break;
        }
      }
      return this.seekToFrame(target, ctx);
    }
    let target = activePlayer.totalFrames;
    for (let i = 0; i < goals.length; i++) {
      const gTarget = Math.max(0, (goals[i].frame || 0) - LEAD_IN);
      if (gTarget > cur + 45) {
        target = gTarget;
        break;
      }
    }
    return this.seekToFrame(target, ctx);
  },

  /** Records one 60 Hz match tick into a v3 PoseReplayRecorder (30 Hz keyframe capture, zero alloc). */
  recordPoseTick(ctx) {
    if (activeRecorder instanceof PoseReplayRecorder) {
      activeRecorder.recordTick(ctx);
    }
  },

  /** Legacy v2 input-slot recording hook (no-op when recording v3 poses). */
  recordSlot(slotIndex, inputSnapshot, flags) {
    if (activeRecorder instanceof ReplayRecorder) {
      activeRecorder.recordSlot(slotIndex, inputSnapshot, flags);
    }
  },

  /** Legacy v2 input-tick commit hook (no-op when recording v3 poses). */
  commitTick() {
    if (activeRecorder instanceof ReplayRecorder) {
      activeRecorder.commitTick();
    }
  },

  /** Logs a goal timestamp inside the current recording. */
  recordGoal(goalEvent) {
    if (activeRecorder) activeRecorder.recordGoal(goalEvent);
  },

  /** Logs an overtime agreement inside the current recording. */
  recordOvertime(decision) {
    if (activeRecorder) activeRecorder.recordOvertime(decision);
  },

  /** Reads the next legacy v2 playback tick (null for v3 pose replays or at end of replay). */
  readPlaybackTick() {
    if (!(activePlayer instanceof ReplayPlayer)) return null;
    return activePlayer.readNextTick();
  },

  /** Returns any overtime decision scheduled for the current playback frame. */
  getPlaybackOvertimeDecision() {
    if (!(activePlayer instanceof ReplayPlayer)) return null;
    return activePlayer.getOvertimeDecisionAt(activePlayer.cursor);
  },

  /**
   * Finalizes the active recording, gzip-encodes it into `.vbreplay` bytes,
   * caches it in memory, and auto-saves silently to disk in Electron desktop mode.
   */
  async finishMatchRecording(summary = {}) {
    if (!activeRecorder || !activeRecorder.active) return null;
    const rec = activeRecorder;
    activeRecorder = null;
    const payload = rec.finalize(summary);
    const filename = buildReplayFilename(payload.meta, summary);

    try {
      const bytes = await encodeReplayBinary(payload, { compress: true });
      let savedPath = null;
      if (typeof window !== 'undefined' && typeof window.desktopAPI?.saveReplay === 'function') {
        const res = await window.desktopAPI.saveReplay(filename, bytes);
        if (res?.ok) savedPath = res.path;
      }

      const record = { filename, bytes, byteLength: bytes.byteLength, meta: payload.meta, savedPath, userSaved: false };
      lastSavedReplay = record;
      recentReplays.unshift(record);
      if (recentReplays.length > MAX_MEMORY_REPLAYS) recentReplays.length = MAX_MEMORY_REPLAYS;

      const kb = (bytes.byteLength / 1024).toFixed(1);
      const goalCount = payload.meta.goals?.length || 0;
      const where = savedPath ? `saved -> ${savedPath}` : 'cached in memory (call window.__vb.downloadLastReplay())';
      console.log(`[replay] v${payload.meta.version} ${filename} (${kb} KB, ${payload.meta.summary?.totalFrames || 0} ticks, ${goalCount} goals) ${where}`);

      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('vb:replaysaved', { detail: { filename, byteLength: bytes.byteLength, savedPath, meta: payload.meta } }));
      }
      return record;
    } catch (err) {
      console.warn('[replay] encode failed:', err?.message || err);
      return null;
    }
  },

  /** Returns the most recently finished replay record `{ filename, bytes, meta, savedPath }`. */
  getLastReplay() {
    return lastSavedReplay;
  },

  /** Returns up to 5 recent replays recorded during this session. */
  getRecentReplays() {
    return recentReplays;
  },

  /** Triggers a browser file download for the currently playing or last recorded `.vbreplay`. */
  downloadLastReplay(record = currentPlaybackRecord || lastSavedReplay) {
    if (!record?.bytes) return false;
    record.userSaved = true;
    if (typeof document === 'undefined' || typeof Blob === 'undefined') return true;
    const blob = new Blob([record.bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = record.filename || 'match.vbreplay';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },

  /**
   * Decodes `.vbreplay` bytes (or accepts an already decoded `{ meta, frames }` object)
   * and arms `PoseReplayPlayer` (v3) or `ReplayPlayer` (legacy v2).
   */
  async preparePlayback(input) {
    const rawBytes = input instanceof Uint8Array
      ? input
      : (input?.bytes instanceof Uint8Array ? input.bytes : null);
    const decoded = rawBytes ? await decodeReplayBinary(rawBytes) : input;
    activeRecorder = null;
    const meta = decoded.meta || {};
    const isPose = Number(meta.version) === REPLAY_POSE_FORMAT_VERSION;
    activePlayer = isPose ? new PoseReplayPlayer(decoded) : new ReplayPlayer(decoded);

    currentPlaybackRecord = rawBytes
      ? {
          filename: input?.filename || buildReplayFilename(meta, meta.summary || {}),
          bytes: rawBytes,
          byteLength: rawBytes.byteLength,
          meta,
        }
      : lastSavedReplay;
    const count = meta.playerCount >= 4 ? 4 : 2;
    const configs = Array.from({ length: count }, (_, i) => {
      const p = meta.players?.[i] || {};
      return {
        id: `p${i + 1}`,
        team: p.team || (i % 2 === 0 ? 'home' : 'away'),
        type: 'human',
        displayName: p.displayName || `P${i + 1}`,
        variant: p.variant || 'classic',
        primaryColor: p.primaryColor ?? (i % 2 === 0 ? 0xd90429 : 0x1d4ed8),
        headwear: p.headwear ?? null,
        cameraMode: 'broadcast',
        difficulty: p.difficulty || 'medium',
        aggressiveness: p.aggressiveness ?? 0.6,
        assistPreset: p.assistPreset || 'standard',
      };
    });
    const prep = {
      decoded,
      meta,
      isPose,
      seed: (meta.seed ?? 0) >>> 0,
      initialDrop: meta.initialDrop || null,
      initialSpawns: Array.isArray(meta.initialSpawns) ? meta.initialSpawns : null,
      configs,
      rules: {
        ball: meta.ball || 'medium',
        duration: meta.durationSeconds || 300,
        arena: meta.arena || 'court',
        isReplay: true,
      },
    };
    currentPlaybackPrep = prep;
    playbackSpeed = 1;
    playbackPaused = false;
    playbackAccumulator = 0;
    playbackCameraPreset = 'broadcast';
    playbackSeeking = false;
    playbackFollowSlot = 0;
    playbackCameraHeightOffset = 0;
    syncPlayerCameraHeightOffsets(null, 0);
    return prep;
  },
};
