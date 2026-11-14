/**
 * ============================================================================
 * MODULE: src/features/match/matchManager.js
 * ============================================================================
 * ROLE:
 *   Authoritative match state lifecycle manager, team/slot grouping registry,
 *   per-athlete match stat tracker, and telemetry report builder.
 *
 * FRAME PHASE:
 *   Fixed Update (60 Hz match tick, goal scoring, overtime transitions) and
 *   Match Setup / Rematch / Reset transitions.
 *
 * ARCHITECTURAL INVARIANTS:
 *   - Law 1 (Single Authority): Single authority for resetting `matchState`
 *     (`resetMatchState`, `startMatch`, `rematch`, `startPractice`,
 *     `resetForTitle`, `startOvertime`) and aggregating `athleteMatchStats`.
 *   - Law 6 (Deterministic Match): All match clock and countdown transitions
 *     operate on deterministic 60 Hz tick counters (`ticksRemaining`,
 *     `celebrationTicks`).
 * ============================================================================
 */

import { TUNING } from '../../config/tuning.js';
import { createMatchState } from '../../mechanics/scoring.js';

/**
 * Canonical Team Groups: hard-written distinction between a Collective Team
 * (Team 1 on the Left, Team 2 on the Right) and its Individual Player slots.
 * - Team 1 owns slots [0, 2] (P1, P3)
 * - Team 2 owns slots [1, 3] (P2, P4)
 */
export const TEAM_GROUPS = Object.freeze([
  Object.freeze({
    groupIndex: 0,
    id: 'team1',
    label: 'TEAM 1',
    defaultKit: 'home',
    playerSlots: Object.freeze([0, 2]),
  }),
  Object.freeze({
    groupIndex: 1,
    id: 'team2',
    label: 'TEAM 2',
    defaultKit: 'away',
    playerSlots: Object.freeze([1, 3]),
  }),
]);

/**
 * Returns the canonical team group descriptor (`team1` or `team2`) for a player slot (`0..3`).
 * @param {number} [slotIndex=0]
 */
export function getTeamGroupForSlot(slotIndex = 0) {
  return TEAM_GROUPS[slotIndex % 2 === 0 ? 0 : 1];
}

/**
 * Returns active player slot indices grouped by team rather than alternating:
 * - 1 player (Practice): `[0]`
 * - 2 players (1v1): `[0, 1]` (Team 1: P1, Team 2: P2)
 * - 4 players (2v2): `[0, 2, 1, 3]` (Team 1: P1, P3 | Team 2: P2, P4)
 *
 * @param {number} [activeCount=4]
 * @returns {number[]}
 */
export function getTeamOrderedSlots(activeCount = 4) {
  if (activeCount <= 1) return [0];
  if (activeCount === 2) return [0, 1];
  return [0, 2, 1, 3].filter((s) => s < activeCount);
}

/**
 * Creates a fresh zeroed per-player match stat bucket for `slotIndex`.
 * @param {number} [slotIndex=0]
 */
export function createPlayerMatchStats(slotIndex = 0) {
  return {
    slotIndex,
    id: `p${slotIndex + 1}`,
    teamGroupId: slotIndex % 2 === 0 ? 'team1' : 'team2',
    goals: 0,
    assists: 0,
    totalTouches: 0,
    sweetSpotHits: 0,
    spikes: 0,
    dives: 0,
    divingHits: 0,
    defensiveBlocks: 0,
    ownCircleTouches: 0,
    oppCircleTouches: 0,
  };
}

/**
 * Resets an existing per-player match stat bucket in place without allocating.
 * @param {object} stats
 * @param {number} [slotIndex]
 */
export function resetPlayerMatchStats(stats, slotIndex = stats?.slotIndex ?? 0) {
  if (!stats) return;
  stats.slotIndex = slotIndex;
  stats.id = `p${slotIndex + 1}`;
  stats.teamGroupId = slotIndex % 2 === 0 ? 'team1' : 'team2';
  stats.goals = 0;
  stats.assists = 0;
  stats.totalTouches = 0;
  stats.sweetSpotHits = 0;
  stats.spikes = 0;
  stats.dives = 0;
  stats.divingHits = 0;
  stats.defensiveBlocks = 0;
  stats.ownCircleTouches = 0;
  stats.oppCircleTouches = 0;
}

/**
 * Builds a complete, structured Match Telemetry Report containing BOTH:
 * 1. Individual Player Stats (`report.players[0..N-1]`)
 * 2. Collective Team Aggregates (`report.teams.home`, `report.teams.away`,
 *    `report.teams.team1`, `report.teams.team2`) with each team's member
 *    `.players` grouped inside their team.
 *
 * @param {object} [params={}]
 * @param {object} [params.match={}]
 * @param {Array<object>} [params.athletes=[]]
 * @param {Array<object>} [params.athleteMatchStats=[]]
 * @param {Array<object>} [params.playerConfigs=[]]
 * @param {number|null} [params.activeCount=null]
 */
export function buildMatchStatsReport({
  match = {},
  athletes = [],
  athleteMatchStats = [],
  playerConfigs = [],
  activeCount = null,
} = {}) {
  let count = activeCount;
  if (!count) {
    const enabledAthletes = Array.isArray(athletes)
      ? athletes.filter((a) => a && a.isEnabled !== false).length
      : 0;
    if (enabledAthletes >= 4 || (Array.isArray(playerConfigs) && playerConfigs.length >= 4)) {
      count = 4;
    } else {
      count = 2;
    }
  }

  const homePrimary = TUNING.athlete?.palette?.homePrimary ?? 0xd90429;
  const awayPrimary = TUNING.athlete?.palette?.awayPrimary ?? 0x1d4ed8;

  const players = [];
  for (let i = 0; i < count; i++) {
    const ath = athletes?.[i] || null;
    const cfg = playerConfigs?.[i] || TUNING.players?.[i] || {};
    const raw = athleteMatchStats?.[i] || {};
    const strike = (ath && typeof ath.getStrikeStats === 'function' ? ath.getStrikeStats() : null) || {};

    const team = cfg.team || ath?.team || (i % 2 === 0 ? 'home' : 'away');
    const group = getTeamGroupForSlot(i);
    const primaryColor = cfg.primaryColor ?? (team === 'home' ? homePrimary : awayPrimary);
    const hits = raw.hits !== undefined ? raw.hits : (strike.hits ?? ath?.strikeState?.resolvedCount ?? 0);
    const whiffs = raw.whiffs !== undefined ? raw.whiffs : (strike.whiffs ?? ath?.strikeState?.whiffCount ?? 0);
    const accuracy = raw.accuracy !== undefined
      ? raw.accuracy
      : (hits + whiffs > 0 ? Math.round((hits / (hits + whiffs)) * 100) : 0);

    const teamScore = team === 'home' ? (match?.scoreHome || 0) : (match?.scoreAway || 0);
    const goals = raw.goals !== undefined ? raw.goals : (count <= 2 ? teamScore : 0);

    players.push({
      slotIndex: i,
      id: `p${i + 1}`,
      shortLabel: `P${i + 1}`,
      name: cfg.displayName || cfg.name || `Player ${i + 1}`,
      team,
      teamGroupId: group.id,
      teamGroupLabel: group.label,
      teamRole: i < 2 ? 1 : 2,
      type: cfg.type || 'human',
      difficulty: cfg.difficulty || 'medium',
      primaryColor,
      colorHex: '#' + primaryColor.toString(16).padStart(6, '0'),
      goals,
      assists: raw.assists || 0,
      hits,
      whiffs,
      accuracy,
      totalTouches: raw.totalTouches ?? (hits + whiffs),
      sweetSpotHits: raw.sweetSpotHits || 0,
      spikes: raw.spikes || 0,
      dives: raw.dives || 0,
      divingHits: raw.divingHits || 0,
      defensiveBlocks: raw.defensiveBlocks || 0,
      ownCircleTouches: raw.ownCircleTouches || 0,
      oppCircleTouches: raw.oppCircleTouches || 0,
    });
  }

  function aggregateTeam(teamId, groupSpec) {
    const teamPlayers = players.filter((p) => p.team === teamId);
    const fallbackColor = teamId === 'home' ? homePrimary : awayPrimary;
    const primaryColor = teamPlayers[0]?.primaryColor ?? fallbackColor;
    const colorHex = '#' + primaryColor.toString(16).padStart(6, '0');
    const teamScore = teamId === 'home' ? (match?.scoreHome || 0) : (match?.scoreAway || 0);
    const hits = teamPlayers.reduce((s, p) => s + p.hits, 0);
    const whiffs = teamPlayers.reduce((s, p) => s + p.whiffs, 0);
    const accuracy = hits + whiffs > 0 ? Math.round((hits / (hits + whiffs)) * 100) : 0;

    return {
      teamId,
      groupId: groupSpec.id,
      groupLabel: groupSpec.label,
      kitLabel: teamId === 'home' ? 'HOME' : 'AWAY',
      primaryColor,
      colorHex,
      goals: teamScore,
      playerGoals: teamPlayers.reduce((s, p) => s + p.goals, 0),
      assists: teamPlayers.reduce((s, p) => s + p.assists, 0),
      hits,
      whiffs,
      accuracy,
      totalTouches: teamPlayers.reduce((s, p) => s + p.totalTouches, 0),
      sweetSpotHits: teamPlayers.reduce((s, p) => s + p.sweetSpotHits, 0),
      spikes: teamPlayers.reduce((s, p) => s + p.spikes, 0),
      dives: teamPlayers.reduce((s, p) => s + p.dives, 0),
      divingHits: teamPlayers.reduce((s, p) => s + p.divingHits, 0),
      defensiveBlocks: teamPlayers.reduce((s, p) => s + p.defensiveBlocks, 0),
      ownCircleTouches: teamPlayers.reduce((s, p) => s + p.ownCircleTouches, 0),
      oppCircleTouches: teamPlayers.reduce((s, p) => s + p.oppCircleTouches, 0),
      playerSlots: teamPlayers.map((p) => p.slotIndex),
      players: teamPlayers,
    };
  }

  const team1Kit = players[0]?.team || 'home';
  const team2Kit = team1Kit === 'home' ? 'away' : 'home';
  const team1 = aggregateTeam(team1Kit, TEAM_GROUPS[0]);
  const team2 = aggregateTeam(team2Kit, TEAM_GROUPS[1]);
  const home = team1Kit === 'home' ? team1 : team2;
  const away = team1Kit === 'away' ? team1 : team2;

  return {
    format: count > 2 ? '2v2' : '1v1',
    activeCount: count,
    is2v2: count >= 4,
    scoreHome: match?.scoreHome ?? home.goals,
    scoreAway: match?.scoreAway ?? away.goals,
    players,
    teams: {
      home,
      away,
      team1,
      team2,
    },
  };
}

/**
 * Manages the Match / Practice state machine, pre-match countdown,
 * goal scoring, overtime transitions, and per-athlete match stats.
 */
class MatchManager {
  constructor() {
    this.matchState = createMatchState(TUNING);
    this.gameState = 'menu'; // 'menu' | 'flyover' | 'match' | 'practice' | 'victory' | 'overtime_menu'
    this.preMatchCountdownRemaining = 0; // seconds (float)

    // Per-athlete match stats (indexed 0 to 3)
    this.athleteMatchStats = [
      createPlayerMatchStats(0),
      createPlayerMatchStats(1),
      createPlayerMatchStats(2),
      createPlayerMatchStats(3),
    ];

    this.callbacks = {
      onGoalScored: null,
      onMatchEnd: null,
      onPreMatchCountdownDone: null,
    };
  }

  /**
   * Registers lifecycle callbacks for goal and match events.
   * @param {object} [cbs={}]
   */
  init(cbs = {}) {
    Object.assign(this.callbacks, cbs);
  }

  /** Returns the current authoritative `matchState` object. */
  getState() {
    return this.matchState;
  }

  /** Replaces or binds the authoritative `matchState` reference. */
  setState(stateObj) {
    if (stateObj) {
      this.matchState = stateObj;
    }
    return this.matchState;
  }

  /** Resets all 4 per-athlete match stat buckets to zero. */
  resetAthleteStats() {
    for (let i = 0; i < 4; i++) {
      resetPlayerMatchStats(this.athleteMatchStats[i], i);
    }
  }

  /**
   * Resets `this.matchState` fields cleanly in a single authoritative place.
   *
   * @param {object} [options={}]
   * @param {'match'|'practice'} [options.mode]
   * @param {number} [options.durationSeconds]
   * @param {'N'|'S'} [options.targetGoal='N']
   * @param {boolean} [options.isCountingDown=false]
   * @param {number} [options.countdownSeconds]
   */
  resetMatchState({
    mode = this.matchState.mode || 'match',
    durationSeconds = TUNING.match.durationSeconds,
    targetGoal = 'N',
    isCountingDown = false,
    countdownSeconds = TUNING.match?.countdownSeconds ?? 3,
  } = {}) {
    const fixedHz = TUNING.loop?.fixedHz || 60;
    this.matchState.mode = mode;
    this.matchState.scoreHome = 0;
    this.matchState.scoreAway = 0;
    this.matchState.targetGoal = targetGoal;
    this.matchState.ticksRemaining = Math.round((durationSeconds || 300) * fixedHz);
    this.matchState.matchOver = false;
    this.matchState.lastGoalId = null;
    this.matchState.lastScoredFor = null;
    this.matchState.celebrationTicks = 0;
    this.matchState.isCountingDown = Boolean(isCountingDown);
    this.matchState.countdownSecondsRemaining = isCountingDown ? Math.ceil(countdownSeconds) : 0;
    this.matchState.countdownTicksRemaining = isCountingDown ? Math.round(countdownSeconds * fixedHz) : 0;
    this.matchState._buzzerPlayed = false;
    this.matchState.overtimeMode = null;
    this.matchState.isGoldenGoal = false;
    this.matchState.overtimePeriod = 0;
    if (this.matchState.ballTrackers && typeof this.matchState.ballTrackers.clear === 'function') {
      this.matchState.ballTrackers.clear();
    }
    if (Array.isArray(this.matchState.events)) {
      this.matchState.events.length = 0;
    }
    this.matchState.dropState = {
      pending: false,
      countdownTicks: 0,
      spawnPosition: { ...TUNING.match.ballDropPosition },
    };
    return this.matchState;
  }

  /**
   * Starts a 1v1 or 2v2 match with optional pre-match countdown.
   */
  startMatch(configsOrOptions = {}, maybeOptions = {}) {
    const opts = Array.isArray(configsOrOptions) ? maybeOptions : (configsOrOptions || {});
    const durationSeconds = opts.durationSeconds ?? TUNING.match.durationSeconds;
    const countdownSeconds = opts.countdownSeconds ?? TUNING.match.countdownSeconds ?? 3;
    if (durationSeconds) {
      TUNING.match.durationSeconds = durationSeconds;
    }

    this.gameState = 'match';
    this.resetMatchState({
      mode: 'match',
      durationSeconds,
      targetGoal: 'N',
      isCountingDown: countdownSeconds > 0,
      countdownSeconds,
    });
    this.preMatchCountdownRemaining = Math.max(0, countdownSeconds);
    this.resetAthleteStats();
    return this.matchState;
  }

  /** Transitions from the pre-match flyover cutscene into the active match countdown. */
  skipFlyover() {
    const fixedHz = TUNING.loop?.fixedHz || 60;
    const countdownSeconds = TUNING.match?.countdownSeconds ?? 3;
    this.gameState = 'match';
    this.matchState.mode = 'match';
    this.preMatchCountdownRemaining = countdownSeconds;
    this.matchState.isCountingDown = true;
    this.matchState.countdownSecondsRemaining = Math.ceil(countdownSeconds);
    this.matchState.countdownTicksRemaining = Math.round(countdownSeconds * fixedHz);
    return this.matchState;
  }

  /** Resets match scores and timer for a rematch. */
  rematch(countdownSeconds = TUNING.match?.countdownSeconds ?? 3) {
    this.gameState = 'match';
    this.resetMatchState({
      mode: 'match',
      durationSeconds: TUNING.match.durationSeconds,
      targetGoal: 'N',
      isCountingDown: countdownSeconds > 0,
      countdownSeconds,
    });
    this.preMatchCountdownRemaining = Math.max(0, countdownSeconds);
    this.resetAthleteStats();
    return this.matchState;
  }

  /** Configures `matchState` for Overtime (`golden_goal`, `timed`, or `draw`). */
  startOvertime({ format = 'golden_goal', durationSeconds = 120 } = {}) {
    const fixedHz = TUNING.loop?.fixedHz || 60;
    this.matchState.overtimeMode = format;
    if (format === 'draw') {
      this.matchState.isGoldenGoal = false;
      this.matchState.matchOver = true;
      this.matchState.ticksRemaining = 0;
      this.gameState = 'victory';
      return;
    }

    this.gameState = 'match';
    this.matchState.overtimePeriod = (this.matchState.overtimePeriod || 0) + 1;
    this.matchState.matchOver = false;
    this.matchState.celebrationTicks = 0;

    if (format === 'golden_goal') {
      this.matchState.isGoldenGoal = true;
      this.matchState.ticksRemaining = 0;
    } else {
      this.matchState.isGoldenGoal = false;
      this.matchState.ticksRemaining = Math.max(60, Math.round((durationSeconds || 120) * fixedHz));
    }
  }

  /** Starts solo practice sandbox mode. */
  startPractice() {
    this.gameState = 'practice';
    this.resetMatchState({
      mode: 'practice',
      durationSeconds: TUNING.match.durationSeconds,
      targetGoal: 'N',
    });
    this.preMatchCountdownRemaining = 0;
    this.resetAthleteStats();
  }

  /** Resets to Title / Menu state. */
  resetForTitle() {
    this.gameState = 'menu';
    this.resetMatchState({
      mode: 'practice',
      durationSeconds: TUNING.match.durationSeconds,
      targetGoal: 'N',
    });
    this.preMatchCountdownRemaining = 0;
  }

  /** Compiles the current match telemetry report for HUD/HustleBoards/VictoryScreen. */
  getStatsReport({ athletes = [], playerConfigs = TUNING.players || [], activeCount } = {}) {
    return buildMatchStatsReport({
      match: this.matchState,
      athletes,
      athleteMatchStats: this.athleteMatchStats,
      playerConfigs,
      activeCount,
    });
  }
}

export const matchManager = new MatchManager();
export { MatchManager };
