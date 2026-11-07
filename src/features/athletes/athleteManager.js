import { TUNING } from '../../config/tuning.js';
import { createAthlete } from '../../sim/athlete.js';
import { resetStrikeState } from '../../mechanics/strikes.js';

/**
 * Computes stream-head spawn positions, athlete facing yaws, and camera azimuths
 * so every athlete spawns on the stream head OPPOSITE their active target goal,
 * facing inward toward the valley court and their target goal.
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
 * stream head spawning, 3D lobby staging, and per-tick physics updates.
 *
 * Supports 1v1 (2 athletes) and 2v2 (4 athletes) with zero GC allocation
 * on the 60Hz fixed update path.
 */
class AthleteManager {
  constructor() {
    /** @type {import('../../sim/athlete.js').createAthlete[]} */
    this.athletes = [];
    this.scene = null;
    this.characterSkeleton = null;
    this.characterRoot = null;
    this.clips = [];
    this.activeCount = 2;

    // Pre-allocated empty input fallback to prevent allocations
    this._defaultInput = Object.freeze({
      moveX: 0,
      moveZ: 0,
      jump: false,
      dive: false,
      volley: false,
      spike: false,
      sprint: false,
      hasAim: false,
      aimYaw: 0,
    });
  }

  /**
   * Initializes the manager with Three.js scene and loaded skeleton/clips.
   */
  init({ scene, characterSkeleton, characterRoot, clips }) {
    this.scene = scene;
    this.characterSkeleton = characterSkeleton;
    this.characterRoot = characterRoot;
    this.clips = clips;
  }

  /**
   * Ensures the athlete array has at least `count` athletes instantiated.
   * Enables the first `count` athletes and disables any remaining.
   *
   * @param {number} count 1 (practice), 2 (1v1 match), or 4 (2v2 match)
   * @param {Array<object>} configs Player configuration objects
   */
  ensureRoster(count = 2, configs = []) {
    this.activeCount = count;

    while (this.athletes.length < count) {
      const idx = this.athletes.length;
      const slotConfig = configs[idx] || (TUNING.players && TUNING.players[idx]) || {};
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
        spawn: { x: 0, y: 1.5, z: 0, yaw: 0 },
        scene: this.scene,
        characterSkeleton: this.characterSkeleton,
        characterRoot: this.characterRoot,
        clips: this.clips,
      });

      this.athletes.push(athlete);
    }

    // Apply enabled states
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
   * Returns all active athlete instances.
   */
  getAthletes() {
    return this.athletes;
  }

  /**
   * Returns a specific athlete by slot index.
   */
  getAthlete(index = 0) {
    return this.athletes[index] || null;
  }

  /**
   * Applies configuration to a specific athlete slot.
   */
  applyConfig(slotIndex, config) {
    const athlete = this.athletes[slotIndex];
    if (!athlete || !config) return;
    const team = config.team || athlete.team;
    const variant = config.variant || athlete.variant;
    athlete.setTeamAndVariant(team, variant, { primaryColor: config.primaryColor });
    if (config.headwear !== undefined && athlete.headwear !== config.headwear) athlete.setHeadwear(config.headwear);
    if (config.assistPreset && athlete.setAssistPreset) {
      athlete.setAssistPreset(config.assistPreset);
    }
  }

  /**
   * Teleports athletes to designated stream head spawns opposite their target goal.
   * Follows Rulebook Section 3.2.
   *
   * @param {'match' | 'practice'} mode
   * @param {string} targetGoal 'N' | 'S'
   * @param {function} randomFn
   */
  teleportToMatchSpawns(mode = 'match', targetGoal = 'N', randomFn = () => 0) {
    const configs = this.athletes.map((a) => ({ team: a?.team }));
    const spawns = computeStreamHeadSpawns({
      configs,
      athleteCount: Math.min(this.activeCount, this.athletes.length),
      targetGoal,
      randomFn,
    });
    for (let i = 0; i < spawns.length; i++) {
      if (this.athletes[i]) {
        this.athletes[i].teleportTo(spawns[i].pos, spawns[i].facingYaw);
      }
    }
    return spawns;
  }

  /**
   * Positions athlete at center court for practice sandbox drill.
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
   * @param {'practice' | 'match' | 'match2v2'} mode
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
   * Executes pre-physics step updates for all active athletes.
   * Zero heap allocations.
   *
   * @param {number} tick
   * @param {number} dt
   * @param {Array<object>} inputSlots
   */
  updatePrePhysics(tick, dt, inputSlots = []) {
    for (let i = 0; i < this.athletes.length; i++) {
      const athlete = this.athletes[i];
      if (!athlete.isEnabled) continue;
      const input = inputSlots[i] || this._defaultInput;
      athlete.prePhysicsUpdate(input, tick, dt);
    }
  }

  /**
   * Executes post-physics step updates for all active athletes.
   *
   * @param {number} tick
   * @param {number} dt
   * @param {Array<object>} balls
   * @returns {Array<object>} assist events produced this tick
   */
  updatePostPhysics(tick, dt, balls = []) {
    const assistEvents = [];
    for (let i = 0; i < this.athletes.length; i++) {
      const athlete = this.athletes[i];
      if (!athlete.isEnabled) continue;
      const assist = athlete.postPhysicsUpdate(tick, dt, balls, this.athletes, i);
      if (assist) assistEvents.push(assist);
    }
    return assistEvents;
  }

  /**
   * Interpolates visual meshes between physics solver states for smooth rendering.
   *
   * @param {number} alpha
   */
  renderPoses(alpha) {
    for (let i = 0; i < this.athletes.length; i++) {
      const athlete = this.athletes[i];
      if (athlete.isEnabled) {
        athlete.renderPose(alpha);
      }
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
