import { TUNING } from '../../config/tuning.js';
import { createAthlete } from '../../sim/athlete.js';

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
  }

  /**
   * Teleports athletes to designated stream head spawns for match kickoff.
   * Follows Rulebook Section 3.2.
   *
   * @param {'match' | 'practice'} mode
   */
  teleportToMatchSpawns(mode = 'match') {
    const heads = TUNING.match?.streamHeads || {
      sw: { x: -8.0, y: 0.0, z: -25.0 },
      se: { x: 8.0, y: 0.0, z: -25.0 },
      nw: { x: -8.0, y: 0.0, z: 25.0 },
      ne: { x: 8.0, y: 0.0, z: 25.0 },
    };

    if (this.activeCount >= 4) {
      // 2v2 Match: SW & SE for Home (yaw 0), NW & NE for Away (yaw Math.PI)
      if (this.athletes[0]) this.athletes[0].teleportTo({ x: heads.sw.x, y: heads.sw.y + 7.5, z: heads.sw.z }, 0);
      if (this.athletes[1]) this.athletes[1].teleportTo({ x: heads.se.x, y: heads.se.y + 7.5, z: heads.se.z }, 0);
      if (this.athletes[2]) this.athletes[2].teleportTo({ x: heads.nw.x, y: heads.nw.y + 7.5, z: heads.nw.z }, Math.PI);
      if (this.athletes[3]) this.athletes[3].teleportTo({ x: heads.ne.x, y: heads.ne.y + 7.5, z: heads.ne.z }, Math.PI);
    } else {
      // 1v1 Match: SW for Home, NE for Away
      const p1Head = heads.sw;
      const p2Head = heads.ne;
      if (this.athletes[0]) this.athletes[0].teleportTo({ x: p1Head.x, y: p1Head.y + 7.5, z: p1Head.z }, 0);
      if (this.athletes[1]) this.athletes[1].teleportTo({ x: p2Head.x, y: p2Head.y + 7.5, z: p2Head.z }, Math.PI);
    }
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
   *
   * @param {'practice' | 'match' | 'match2v2'} mode
   */
  stageForLobby(mode = 'match') {
    if (mode === 'practice') {
      this.ensureRoster(1);
      if (this.athletes[0]) {
        this.athletes[0].setEnabled(true);
        this.athletes[0].teleportTo({ x: 1.45, y: 0.50, z: 0.2 }, -Math.PI * 0.35);
      }
      for (let i = 1; i < this.athletes.length; i++) {
        this.athletes[i].setEnabled(false);
      }
    } else if (mode === 'match2v2') {
      this.ensureRoster(4);
      // 2 Home athletes on Left (-X), 2 Away athletes on Right (+X)
      if (this.athletes[0]) {
        this.athletes[0].setEnabled(true);
        this.athletes[0].teleportTo({ x: -4.2, y: 0.50, z: -1.2 }, Math.PI * 0.35);
      }
      if (this.athletes[1]) {
        this.athletes[1].setEnabled(true);
        this.athletes[1].teleportTo({ x: -2.8, y: 0.50, z: 1.2 }, Math.PI * 0.45);
      }
      if (this.athletes[2]) {
        this.athletes[2].setEnabled(true);
        this.athletes[2].teleportTo({ x: 4.2, y: 0.50, z: -1.2 }, -Math.PI * 0.35);
      }
      if (this.athletes[3]) {
        this.athletes[3].setEnabled(true);
        this.athletes[3].teleportTo({ x: 2.8, y: 0.50, z: 1.2 }, -Math.PI * 0.45);
      }
    } else {
      // Standard 1v1 match setup
      this.ensureRoster(2);
      if (this.athletes[0]) {
        this.athletes[0].setEnabled(true);
        this.athletes[0].teleportTo({ x: -3.2, y: 0.50, z: 0.0 }, Math.PI * 0.40);
      }
      if (this.athletes[1]) {
        this.athletes[1].setEnabled(true);
        this.athletes[1].teleportTo({ x: 3.2, y: 0.50, z: 0.0 }, -Math.PI * 0.40);
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
    const heads = TUNING.match?.streamHeads || {
      sw: { x: -8.0, y: 0.0, z: -25.0 },
      ne: { x: 8.0, y: 0.0, z: 25.0 },
    };
    if (this.athletes[0]) {
      this.athletes[0].setEnabled(true);
      this.athletes[0].teleportTo(heads.sw, 0);
    }
    if (this.athletes[1]) {
      this.athletes[1].setEnabled(true);
      this.athletes[1].teleportTo(heads.ne, Math.PI);
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
   * Resets strike and whiff stats for all athletes.
   */
  resetStats() {
    for (const a of this.athletes) {
      if (a.strikeState) {
        a.strikeState.resolvedCount = 0;
        a.strikeState.whiffCount = 0;
      }
    }
  }
}

export const athleteManager = new AthleteManager();
export { AthleteManager };
