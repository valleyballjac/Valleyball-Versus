/**
 * Module: features/athletes/athleteManager
 * Role: Roster lifecycle manager and stream-head spawn solver for 1v1 and 2v2 athletes.
 * Frame Phase: Setup / Transition (spawn, stage, config, reset). Per-tick physics runs directly on Athlete instances.
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Delegates physical state construction to `sim/athlete.js` (`createAthlete`).
 *   - LAW 6 (Deterministic Match): `computeStreamHeadSpawns` preserves exact PRNG draw order (South first, North second)
 *     so seeded `?fixture=` runs reproduce identical spawn coordinates and headings.
 */

import { TUNING } from '../../config/tuning.js';
import { createAthlete } from '../../sim/athlete.js';
import { resetStrikeState } from '../../mechanics/strikes.js';

/**
 * Computes stream-head spawn positions, athlete facing yaws, and camera azimuths
 * so every athlete spawns on the stream head OPPOSITE their active target goal,
 * facing inward toward the valley court and their target goal.
 *
 * Why: Rulebook Section 3.2 mandates that athletes begin at the stream heads opposite
 * the goal they are attacking, ensuring a full-court downhill approach into the valley.
 *
 * @param {object} [options]
 * @param {Array<object>} [options.configs=[]] Per-slot player configurations (`{ team }`)
 * @param {number} [options.athleteCount=2] Number of active athletes (1, 2, or 4)
 * @param {'N'|'S'} [options.targetGoal='N'] Current Home team target goal ('N' or 'S')
 * @param {object} [options.streamHeads] Map of `{ sw, se, nw, ne }` coordinates
 * @param {() => number} [options.randomFn=Math.random] Deterministic or standard PRNG
 * @returns {Array<{ pos: { x: number, y: number, z: number }, facingYaw: number, cameraAzimuth: number, targetGoal: 'N'|'S', side: 'north'|'south' }>}
 */
export function computeStreamHeadSpawns({
  configs = [],
  athleteCount = 2,
  targetGoal = 'N',
  streamHeads = TUNING.match?.streamHeads,
  randomFn = Math.random,
} = {}) {
  const heads = streamHeads || {
    sw: { x: -12.78, y: 8.24, z: 39.96 },
    se: { x: 12.78, y: 8.24, z: 39.96 },
    nw: { x: -12.78, y: 8.24, z: -39.96 },
    ne: { x: 12.78, y: 8.24, z: -39.96 },
  };
  // Preserve exact PRNG draw order (south draw first, north draw second) for deterministic ?fixture= runs
  const southPrimaryWest = randomFn() < 0.5;
  const northPrimaryWest = randomFn() < 0.5;
  const southOrder = southPrimaryWest ? [heads.sw, heads.se] : [heads.se, heads.sw];
  const northOrder = northPrimaryWest ? [heads.nw, heads.ne] : [heads.ne, heads.nw];
  let southUsed = 0;
  let northUsed = 0;

  const spawns = [];
  for (let i = 0; i < athleteCount; i++) {
    const team = configs?.[i]?.team || (i % 2 === 0 ? 'home' : 'away');
    const attacksNorth = team === 'home' ? targetGoal === 'N' : targetGoal === 'S';
    if (attacksNorth) {
      const head = southOrder[southUsed % southOrder.length];
      southUsed += 1;
      spawns.push({
        pos: { x: head.x, y: head.y + 0.1, z: head.z },
        facingYaw: Math.PI,
        cameraAzimuth: 0,
        targetGoal: 'N',
        side: 'south',
      });
    } else {
      const head = northOrder[northUsed % northOrder.length];
      northUsed += 1;
      spawns.push({
        pos: { x: head.x, y: head.y + 0.1, z: head.z },
        facingYaw: 0,
        cameraAzimuth: Math.PI,
        targetGoal: 'S',
        side: 'north',
      });
    }
  }
  return spawns;
}

/**
 * Manages the collection of active athletes, team assignments,
 * stream-head spawning, and 3D lobby staging.
 */
class AthleteManager {
  constructor() {
    /** @type {Array<ReturnType<typeof createAthlete>>} */
    this.athletes = [];
    this.scene = null;
    this.activeCount = 2;
    this._assets = {
      characterSkeleton: null,
      characterRoot: null,
      clips: [],
    };
  }

  /**
   * Initializes the manager with Three.js scene and loaded skeleton/clips.
   *
   * @param {object} params
   * @param {import('three').Scene} params.scene
   * @param {import('three').Skeleton} [params.characterSkeleton]
   * @param {import('three').Object3D} [params.characterRoot]
   * @param {Array<import('three').AnimationClip>} [params.clips]
   */
  init({ scene, characterSkeleton = null, characterRoot = null, clips = [] } = {}) {
    this.scene = scene;
    this._assets.characterSkeleton = characterSkeleton;
    this._assets.characterRoot = characterRoot;
    this._assets.clips = clips;
  }

  /**
   * Spawns a single athlete slot and adds it to the roster.
   *
   * @param {number} idx Slot index (0..3)
   * @param {object} [slotConfig={}] Slot configuration
   * @returns {ReturnType<typeof createAthlete>}
   */
  spawnAthlete(idx, slotConfig = {}) {
    const team = slotConfig.team || (idx % 2 === 0 ? 'home' : 'away');
    const variant = slotConfig.variant || 'classic';
    const primaryColor = slotConfig.primaryColor ?? (team === 'home' ? 0xd90429 : 0x1d4ed8);

    const athlete = createAthlete({
      id: `p${idx + 1}`,
      athleteIndex: idx,
      team,
      variant,
      primaryColor,
      headwear: slotConfig.headwear,
      assistPreset: slotConfig.assistPreset || 'standard',
      spawn: slotConfig.spawn || { x: 0, y: 1.5, z: 0, yaw: 0 },
      scene: this.scene,
      characterSkeleton: this._assets.characterSkeleton,
      characterRoot: this._assets.characterRoot,
      clips: this._assets.clips,
    });

    this.athletes[idx] = athlete;
    return athlete;
  }

  /**
   * Ensures the athlete array has at least `count` athletes instantiated.
   * Enables the first `count` athletes and disables any remaining.
   *
   * @param {number} [count=2] 1 (practice), 2 (1v1 match), or 4 (2v2 match)
   * @param {Array<object>} [configs=[]] Player configuration objects
   * @returns {Array<ReturnType<typeof createAthlete>>}
   */
  ensureRoster(count = 2, configs = []) {
    this.activeCount = count;

    while (this.athletes.length < count) {
      const idx = this.athletes.length;
      const slotConfig = configs[idx] || (TUNING.players && TUNING.players[idx]) || {};
      this.spawnAthlete(idx, slotConfig);
    }

    for (let i = 0; i < this.athletes.length; i++) {
      const shouldEnable = i < count;
      this.athletes[i].setEnabled(shouldEnable);
      if (shouldEnable && configs[i]) {
        this.applyConfig(i, configs[i]);
      }
    }

    return this.athletes;
  }

  /**
   * Alias for `ensureRoster` when spawning match athletes with configs.
   *
   * @param {number} [count=2]
   * @param {Array<object>} [configs=[]]
   * @returns {Array<ReturnType<typeof createAthlete>>}
   */
  spawnMatchAthletes(count = 2, configs = []) {
    return this.ensureRoster(count, configs);
  }

  /**
   * Returns all instantiated athlete instances.
   *
   * @returns {Array<ReturnType<typeof createAthlete>>}
   */
  getAthletes() {
    return this.athletes;
  }

  /**
   * Alias for `getAthletes()`.
   *
   * @returns {Array<ReturnType<typeof createAthlete>>}
   */
  getAll() {
    return this.athletes;
  }

  /**
   * Returns a specific athlete by slot index.
   *
   * @param {number} [index=0]
   * @returns {ReturnType<typeof createAthlete>|null}
   */
  getAthlete(index = 0) {
    return this.athletes[index] || null;
  }

  /**
   * Enables or disables all instantiated athletes.
   *
   * @param {boolean} enabled
   */
  setEnabledAll(enabled) {
    for (let i = 0; i < this.athletes.length; i++) {
      this.athletes[i]?.setEnabled(Boolean(enabled));
    }
  }

  /**
   * Disposes all instantiated athletes and clears the roster.
   */
  destroyAll() {
    for (let i = 0; i < this.athletes.length; i++) {
      this.athletes[i]?.dispose?.();
    }
    this.athletes.length = 0;
  }

  /**
   * Applies configuration to a specific athlete slot.
   *
   * @param {number} slotIndex
   * @param {object} config
   */
  applyConfig(slotIndex, config) {
    const athlete = this.athletes[slotIndex];
    if (!athlete || !config) return;
    const team = config.team || athlete.team;
    const variant = config.variant || athlete.variant;
    athlete.setTeamAndVariant(team, variant, { primaryColor: config.primaryColor });
    if (config.headwear !== undefined && athlete.headwear !== config.headwear) {
      athlete.setHeadwear(config.headwear);
    }
    if (config.assistPreset && athlete.setAssistPreset) {
      athlete.setAssistPreset(config.assistPreset);
    }
  }

  /**
   * Positions P1 at center court for practice sandbox drill and disables other slots.
   *
   * @param {object|null} [arenaPreset=null]
   */
  teleportToPracticeSpawn(arenaPreset = null) {
    const spawn = arenaPreset?.spawn || { x: 0, y: 1.2, z: 0 };
    if (this.athletes[0]) {
      this.athletes[0].teleportTo(spawn, 0);
      this.athletes[0].setEnabled(true);
    }
    for (let i = 1; i < this.athletes.length; i++) {
      this.athletes[i].setEnabled(false);
    }
  }

  /**
   * Stages athletes grounded at floor level on court for lobby preview.
   * Each character starts at a stratified random frame of the idle loop so
   * multiple preview athletes never sway in lockstep.
   *
   * @param {'practice' | 'match' | 'match2v2'} [mode='match']
   */
  stageForLobby(mode = 'match') {
    const randIdlePhase = (slot, total) => ((slot + 0.15 + Math.random() * 0.70) / total) % 1;
    if (mode === 'practice') {
      this.ensureRoster(1);
      if (this.athletes[0]) {
        this.athletes[0].setEnabled(true);
        this.athletes[0].teleportTo({ x: 0.45, y: 0.50, z: 0.35 }, -Math.PI * 0.18, Math.random());
      }
      for (let i = 1; i < this.athletes.length; i++) {
        this.athletes[i].setEnabled(false);
      }
    } else if (mode === 'match2v2') {
      this.ensureRoster(4);
      // Staged in the open center preview window: Team 1 (0, 2) on Left-Center, Team 2 (1, 3) on Right-Center
      if (this.athletes[0]) {
        this.athletes[0].setEnabled(true);
        this.athletes[0].teleportTo({ x: -0.84, y: 0.50, z: 0.20 }, Math.PI * 0.20, randIdlePhase(0, 4));
      }
      if (this.athletes[2]) {
        this.athletes[2].setEnabled(true);
        this.athletes[2].teleportTo({ x: -0.30, y: 0.50, z: -0.48 }, Math.PI * 0.16, randIdlePhase(1, 4));
      }
      if (this.athletes[1]) {
        this.athletes[1].setEnabled(true);
        this.athletes[1].teleportTo({ x: 0.30, y: 0.50, z: -0.48 }, -Math.PI * 0.16, randIdlePhase(2, 4));
      }
      if (this.athletes[3]) {
        this.athletes[3].setEnabled(true);
        this.athletes[3].teleportTo({ x: 0.84, y: 0.50, z: 0.20 }, -Math.PI * 0.20, randIdlePhase(3, 4));
      }
    } else {
      // Standard 1v1 match setup framed inside the open center preview window
      this.ensureRoster(2);
      if (this.athletes[0]) {
        this.athletes[0].setEnabled(true);
        this.athletes[0].teleportTo({ x: -0.95, y: 0.50, z: 0.15 }, Math.PI * 0.22, randIdlePhase(0, 2));
      }
      if (this.athletes[1]) {
        this.athletes[1].setEnabled(true);
        this.athletes[1].teleportTo({ x: 0.95, y: 0.50, z: 0.15 }, -Math.PI * 0.22, randIdlePhase(1, 2));
      }
      for (let i = 2; i < this.athletes.length; i++) {
        this.athletes[i].setEnabled(false);
      }
    }
  }

  /**
   * Resets all athletes to default Title ambient positions.
   */
  stageForTitle() {
    const randIdlePhase = (slot, total) => ((slot + 0.15 + Math.random() * 0.70) / total) % 1;
    const heads = TUNING.match?.streamHeads || {
      sw: { x: -8.0, y: 0.0, z: -25.0 },
      ne: { x: 8.0, y: 0.0, z: 25.0 },
    };
    if (this.athletes[0]) {
      this.athletes[0].setEnabled(true);
      this.athletes[0].teleportTo(heads.sw, 0, randIdlePhase(0, 2));
    }
    if (this.athletes[1]) {
      this.athletes[1].setEnabled(true);
      this.athletes[1].teleportTo(heads.ne, Math.PI, randIdlePhase(1, 2));
    }
    for (let i = 2; i < this.athletes.length; i++) {
      this.athletes[i].setEnabled(false);
    }
  }

  /**
   * Resets strike, action, and knockdown state for all athletes on kickoff/rematch.
   */
  resetStats() {
    for (const a of this.athletes) {
      if (a.strikeState) {
        resetStrikeState(a.strikeState);
        a.strikeState.resolvedCount = 0;
        a.strikeState.whiffCount = 0;
      }
      if (a.actionState) {
        a.actionState.slideTime = 0;
        a.actionState.divePending = false;
        a.actionState.diveStunUntil = -Infinity;
        a.actionState.cleatAnchorUntil = -Infinity;
        a.actionState.braceMix = 0;
      }
      if (a.tracker) {
        a.tracker.weight = TUNING.tracking.startWeight;
        a.tracker.knockdownQueued = false;
        a.tracker.knockdownTone = 0;
        a.tracker.muscleTone = 0;
        a.tracker.offMount = 0;
      }
      if (a.impactEvents) {
        a.impactEvents.length = 0;
      }
    }
  }
}

export const athleteManager = new AthleteManager();
export { AthleteManager };
