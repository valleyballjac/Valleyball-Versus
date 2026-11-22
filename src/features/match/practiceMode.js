/**
 * Module: features/match/practiceMode
 * Role: Practice sandbox, 60s Newcomer Drill, Ball Feeder, Sparring Bot, and Local Warmup
 *   state, 1-button self-toss ball summoning, telemetry accumulator, and non-persistent guide overrides.
 * Frame Phase: Fixed Update (60 Hz tick increment, feeder lobs, drill progress) and UI Transition.
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Single authority for `practiceStats`, `practiceSessionTicks`,
 *     `selectedPracticeBallType`, `selectedPracticeDrill`, and `newcomerDrill`.
 *   - LAW 6 (Deterministic Match): All drill timings and feeder cadences use integer 60 Hz ticks.
 */

import { getHudPrefs, setHudPrefs } from '../../config/hudConfig.js';

/**
 * Live telemetry counters for Practice mode.
 * Exposed on `window.__vb.practiceStats` and read by `hustleBoards.js`, `inGameMenu.js`, `practiceHud.js`, and `victoryScreen.js`.
 */
export const practiceStats = {
  goals: 0,
  hits: 0,
  whiffs: 0,
  sweetSpots: 0,
  spikes: 0,
  dives: 0,
  divingHits: 0,
  defensiveBlocks: 0,
  totalTouches: 0,
};

export const newcomerDrill = {
  active: false,
  durationTicks: 3600, // 60 seconds at 60 Hz
  ticksRemaining: 3600,
  volleyTarget: 3,
  spikeTarget: 1,
  diveTarget: 1,
  goalTarget: 1,
  volleysDone: 0,
  spikesDone: 0,
  divesDone: 0,
  goalsDone: 0,
  completed: false,
  completedAtSeconds: null,
};

const FEEDER_INTERVAL_TICKS = 270; // 4.5s at 60 Hz
const _tossPos = { x: 0, y: 0, z: 0 };
const _tossVel = { x: 0, y: 0, z: 0 };

let practiceSessionTicks = 0;
let selectedPracticeBallType = 'all';
let selectedPracticeDrill = 'sandbox';
let savedHudBeforeDrill = null;
let feederShotCount = 0;

/**
 * Resets all practice telemetry counters, drill state, and session ticks to zero.
 *
 * @param {object|null} [athlete0=null] Optional P1 athlete instance whose strike counters should also be cleared
 */
export function resetPracticeStats(athlete0 = null) {
  practiceStats.goals = 0;
  practiceStats.hits = 0;
  practiceStats.whiffs = 0;
  practiceStats.sweetSpots = 0;
  practiceStats.spikes = 0;
  practiceStats.dives = 0;
  practiceStats.divingHits = 0;
  practiceStats.defensiveBlocks = 0;
  practiceStats.totalTouches = 0;
  practiceSessionTicks = 0;
  feederShotCount = 0;

  newcomerDrill.active = selectedPracticeDrill === 'newcomer_drill';
  newcomerDrill.ticksRemaining = newcomerDrill.durationTicks;
  newcomerDrill.volleysDone = 0;
  newcomerDrill.spikesDone = 0;
  newcomerDrill.divesDone = 0;
  newcomerDrill.goalsDone = 0;
  newcomerDrill.completed = false;
  newcomerDrill.completedAtSeconds = null;

  if (athlete0?.strikeState) {
    athlete0.strikeState.resolvedCount = 0;
    athlete0.strikeState.whiffCount = 0;
  }
}

/**
 * Enables Rainbow Ball Halo + Strike-Range Guide temporarily during the 60s Newcomer Drill
 * without overwriting the user's saved `localStorage` HUD preferences.
 */
export function applyPracticeHudOverrides(drillMode = selectedPracticeDrill) {
  restorePracticeHudOverrides();
  if (drillMode === 'newcomer_drill') {
    const cur = getHudPrefs();
    savedHudBeforeDrill = {
      ballDropRing: cur.ballDropRing,
      strikeRangeGuide: cur.strikeRangeGuide,
    };
    setHudPrefs({ ballDropRing: true, strikeRangeGuide: true }, { persist: false });
  }
}

/**
 * Restores the user's pre-drill HUD guide flags cleanly when leaving Practice Mode.
 */
export function restorePracticeHudOverrides() {
  if (!savedHudBeforeDrill) return;
  const prev = savedHudBeforeDrill;
  savedHudBeforeDrill = null;
  setHudPrefs(prev, { persist: false });
}

/**
 * Synchronizes `practiceStats.hits` and `practiceStats.whiffs` from P1's strike state
 * and updates 60s Newcomer Drill completion progress.
 *
 * @param {object|null} athlete0
 */
export function syncPracticeStrikeStats(athlete0) {
  const strike = athlete0?.getStrikeStats?.();
  if (strike) {
    practiceStats.hits = strike.hits;
    practiceStats.whiffs = strike.whiffs;
  }
  if (newcomerDrill.active) {
    newcomerDrill.volleysDone = Math.min(newcomerDrill.volleyTarget, practiceStats.hits || 0);
    newcomerDrill.spikesDone = Math.min(newcomerDrill.spikeTarget, practiceStats.spikes || 0);
    newcomerDrill.divesDone = Math.min(newcomerDrill.diveTarget, practiceStats.dives || 0);
    newcomerDrill.goalsDone = Math.min(newcomerDrill.goalTarget, practiceStats.goals || 0);
    if (
      !newcomerDrill.completed &&
      newcomerDrill.volleysDone >= newcomerDrill.volleyTarget &&
      newcomerDrill.spikesDone >= newcomerDrill.spikeTarget &&
      newcomerDrill.divesDone >= newcomerDrill.diveTarget &&
      newcomerDrill.goalsDone >= newcomerDrill.goalTarget
    ) {
      newcomerDrill.completed = true;
      newcomerDrill.completedAtSeconds = +(practiceSessionTicks / 60).toFixed(1);
    }
  }
}

/**
 * 1-Button Ball Summon & Self-Toss (`B` key or Gamepad Select/Back in Practice Mode).
 * Places the nearest active ball 2.15 m directly in front of the athlete at shoulder/lob height
 * with a gentle upward toss so the player can immediately rehearse Volleys, Kicks, or Jump-Spikes.
 *
 * @param {object|null} athlete
 * @param {Array<object>} balls
 * @param {number} tick
 * @param {(ball: object, tick: number, pos: object, vel?: object) => void} resetBallFn
 * @returns {boolean} true if a ball was summoned
 */
export function summonPracticeBall(athlete, balls, tick, resetBallFn) {
  if (!athlete?.motor?.body || !Array.isArray(balls) || balls.length === 0 || typeof resetBallFn !== 'function') {
    return false;
  }
  const pos = athlete.motor.body.translation();
  const yaw = Number.isFinite(athlete.animTarget?.yaw) ? athlete.animTarget.yaw : 0;

  let targetBall = null;
  let bestDistSq = Infinity;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (!b?.body || (typeof b.body.isEnabled === 'function' && !b.body.isEnabled())) continue;
    const bt = b.body.translation();
    const dx = bt.x - pos.x;
    const dz = bt.z - pos.z;
    const dSq = dx * dx + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      targetBall = b;
    }
  }
  if (!targetBall) return false;

  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  _tossPos.x = Math.max(-14.0, Math.min(14.0, pos.x + fwdX * 2.15));
  _tossPos.y = Math.max(1.8, pos.y + 2.15);
  _tossPos.z = Math.max(-38.0, Math.min(38.0, pos.z + fwdZ * 2.15));
  _tossVel.x = fwdX * 0.45;
  _tossVel.y = 3.4;
  _tossVel.z = fwdZ * 0.45;

  resetBallFn(targetBall, tick, _tossPos, _tossVel);
  return true;
}

/**
 * Advances practice drill timers by 1 tick (60 Hz) and fires Ball Feeder lobs when enabled.
 */
export function stepPracticeDrillTick({ tick, athletes, balls, resetBallFn }) {
  practiceSessionTicks += 1;
  if (newcomerDrill.active) {
    newcomerDrill.ticksRemaining = Math.max(0, newcomerDrill.durationTicks - practiceSessionTicks);
  }
  if (selectedPracticeDrill === 'ball_feeder' && practiceSessionTicks > 30 && practiceSessionTicks % FEEDER_INTERVAL_TICKS === 0) {
    const p1 = athletes?.[0];
    if (p1?.motor?.body && balls?.length > 0 && typeof resetBallFn === 'function') {
      const targetBall = balls[feederShotCount % balls.length];
      feederShotCount += 1;
      if (targetBall?.body) {
        const p = p1.motor.body.translation();
        const sideSign = (feederShotCount % 2 === 0) ? 1 : -1;
        const launchX = sideSign * 4.5;
        const launchZ = p.z > 0 ? Math.max(-18.0, p.z - 12.0) : Math.min(18.0, p.z + 12.0);
        const launchY = Math.max(3.6, p.y + 2.4);
        const flightTime = 1.25;
        _tossPos.x = launchX;
        _tossPos.y = launchY;
        _tossPos.z = launchZ;
        _tossVel.x = Math.max(-9.0, Math.min(9.0, (p.x - launchX) / flightTime));
        _tossVel.y = 6.2;
        _tossVel.z = Math.max(-11.0, Math.min(11.0, (p.z - launchZ) / flightTime));
        resetBallFn(targetBall, tick, _tossPos, _tossVel);
      }
    }
  }
  return practiceSessionTicks;
}

/**
 * Configures athlete roster, cameras, and optional sparring AI for the selected practice drill mode.
 * Extracted from `main.js` to keep practice session orchestration modular.
 */
export function configurePracticeRoster({
  playerConfig,
  drillMode,
  athleteManager,
  athletes,
  playerCameras,
  arenaPreset,
  createBotController,
  syncPlayerCameraMode,
  onApplyPlayerTuning,
  connectedPadCount = 0,
}) {
  const mode = drillMode || 'sandbox';
  setSelectedPracticeDrill(mode);

  const botControllers = [];
  const activeBotSlots = [];
  let activeCount = 1;

  if (mode === 'sparring_bot') {
    activeCount = 2;
  } else if (mode === 'local_warmup') {
    activeCount = Math.max(2, Math.min(4, connectedPadCount || 2));
  }

  athleteManager.ensureRoster(activeCount);
  athleteManager.teleportToPracticeSpawn(arenaPreset);

  if (playerConfig && athletes[0]) {
    athletes[0].setTeamAndVariant(playerConfig.team || 'home', playerConfig.variant || 'classic', {
      primaryColor: playerConfig.primaryColor,
    });
    if (playerConfig.headwear !== undefined && athletes[0].headwear !== playerConfig.headwear) {
      athletes[0].setHeadwear(playerConfig.headwear);
    }
    playerCameras[0]?.setMode(playerConfig.cameraMode || 'chase', false);
    syncPlayerCameraMode?.(0, playerCameras[0]?.mode || 'chase');
  }

  let splitscreen = false;
  const spawnPos = (arenaPreset && arenaPreset.spawn) || { x: 0, y: 1.5, z: 0 };
  if (mode === 'sparring_bot' && athletes[0] && athletes[1]) {
    athletes[0].teleportTo({ x: 0, y: Math.max(1.5, spawnPos.y), z: 10 }, Math.PI);
    athletes[1].setTeamAndVariant('away', 'classic', { primaryColor: 0x1d4ed8 });
    athletes[1].teleportTo({ x: 0, y: Math.max(1.5, spawnPos.y), z: -10 }, 0);
    const sparringBot = createBotController({
      difficulty: 'medium',
      slotIndex: 1,
      aggressiveness: 0.60,
      seed: 4242,
    });
    botControllers.push(sparringBot);
    activeBotSlots.push(1);
  } else if (mode === 'local_warmup') {
    const offsets = [
      { x: -3.5, z: 6, yaw: Math.PI, team: 'home', color: 0xd90429 },
      { x: 3.5, z: -6, yaw: 0, team: 'away', color: 0x1d4ed8 },
      { x: 3.5, z: 6, yaw: Math.PI, team: 'home', color: 0xfbb417 },
      { x: -3.5, z: -6, yaw: 0, team: 'away', color: 0xa855f7 },
    ];
    for (let i = 0; i < activeCount; i++) {
      if (!athletes[i]) continue;
      const o = offsets[i];
      if (i > 0) athletes[i].setTeamAndVariant(o.team, 'classic', { primaryColor: o.color });
      athletes[i].teleportTo({ x: o.x, y: Math.max(1.5, spawnPos.y), z: o.z }, o.yaw);
      if (playerCameras[i]) {
        playerCameras[i].setMode('chase', false);
        playerCameras[i].azimuth = o.yaw === 0 ? Math.PI : 0;
        playerCameras[i].manualAzimuthOffset = 0;
        playerCameras[i].manualPitchOffset = 0;
        playerCameras[i].resetSmoothing();
      }
    }
    splitscreen = activeCount >= 2;
  } else if (athletes[0]) {
    athletes[0].teleportTo({ x: spawnPos.x, y: Math.max(1.5, spawnPos.y), z: spawnPos.z }, Math.PI);
    if (playerCameras[0]) {
      playerCameras[0].azimuth = 0;
      playerCameras[0].manualAzimuthOffset = 0;
      playerCameras[0].manualPitchOffset = 0;
      playerCameras[0].resetSmoothing();
    }
  }

  onApplyPlayerTuning?.(playerConfig, splitscreen);
  return { botControllers, activeBotSlots, activeCount, splitscreen };
}

export function incrementPracticeSessionTicks() {
  practiceSessionTicks += 1;
  return practiceSessionTicks;
}

export function getPracticeSessionTicks() {
  return practiceSessionTicks;
}

export function getPracticeSessionSeconds() {
  return practiceSessionTicks / 60;
}

export function getSelectedPracticeBallType() {
  return selectedPracticeBallType;
}

export function setSelectedPracticeBallType(choice) {
  selectedPracticeBallType = choice || 'all';
}

export function getSelectedPracticeDrill() {
  return selectedPracticeDrill;
}

export function setSelectedPracticeDrill(mode) {
  selectedPracticeDrill = mode || 'sandbox';
}
