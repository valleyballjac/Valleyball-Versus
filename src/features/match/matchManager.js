import { TUNING } from '../../config/tuning.js';
import { createMatchState, updateScoring } from '../../mechanics/scoring.js';

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

export function getTeamGroupForSlot(slotIndex = 0) {
  return TEAM_GROUPS[slotIndex % 2 === 0 ? 0 : 1];
}

/**
 * Returns active player slot indices grouped by team rather than alternating:
 * - 1 player (Practice): [0]
 * - 2 players (1v1): [0, 1] (Team 1: P1, Team 2: P2)
 * - 4 players (2v2): [0, 2, 1, 3] (Team 1: P1, P3 | Team 2: P2, P4)
 */
export function getTeamOrderedSlots(activeCount = 4) {
  if (activeCount <= 1) return [0];
  if (activeCount === 2) return [0, 1];
  return [0, 2, 1, 3].filter((s) => s < activeCount);
}

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
 * 2. Collective Team Aggregates (`report.teams.home`, `report.teams.away`, `report.teams.team1`, `report.teams.team2`)
 *    with each team's member `.players` grouped inside their team.
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
    const enabledAthletes = Array.isArray(athletes) ? athletes.filter((a) => a && a.isEnabled !== false).length : 0;
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
    const hits = raw.hits !== undefined ? raw.hits : (strike.hits || 0);
    const whiffs = raw.whiffs !== undefined ? raw.whiffs : (strike.whiffs || 0);
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
    activeCount: count,
    is2v2: count >= 4,
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
 * Manages match lifecycle, scoring rules, countdown clock,
 * practice drills, flyover cutscenes, and match transitions.
 */
class MatchManager {
  constructor() {
    /** @type {import('../../mechanics/scoring.js').createMatchState} */
    this.matchState = createMatchState();
    this.callbacks = {
      onGoalScored: null,
      onMatchOver: null,
      onCountdownTick: null,
      onCountdownEnd: null,
      onFlyoverStart: null,
      onFlyoverEnd: null,
    };
    this._wasCountingDown = false;
  }

  /**
   * Initializes the manager with event callbacks.
   */
  init(callbacks = {}) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Returns current match state.
   */
  getState() {
    return this.matchState;
  }

  /**
   * Starts a 1v1 or 2v2 competitive match.
   *
   * @param {Array<object>} configs Player configuration array
   * @param {object} rules Match rules (duration, ball, arena)
   */
  startMatch(configs, rules = {}) {
    const duration = rules.durationSeconds || rules.duration || TUNING.match.durationSeconds || 300;
    TUNING.match.durationSeconds = duration;
    TUNING.match.mode = 'match';

    this.matchState.mode = 'match';
    this.matchState.matchOver = false;
    this.matchState.scoreHome = 0;
    this.matchState.scoreAway = 0;
    this.matchState.celebrationTicks = 0;
    this.matchState.targetGoal = 'north';
    this.matchState.matchDurationTicks = duration * TUNING.loop.fixedHz;
    this.matchState.matchTicksRemaining = this.matchState.matchDurationTicks;
    this.matchState.isCountingDown = true;
    this.matchState.countdownTicksRemaining = TUNING.match.countdownSeconds * TUNING.loop.fixedHz;

    this._wasCountingDown = true;

    if (this.callbacks.onFlyoverStart) {
      this.callbacks.onFlyoverStart(configs, rules);
    }
  }

  /**
   * Skips flyover cutscene and transitions directly to countdown.
   */
  skipFlyover() {
    this.matchState.mode = 'match';
    TUNING.match.mode = 'match';
    this.matchState.isCountingDown = true;
    this.matchState.countdownTicksRemaining = TUNING.match.countdownSeconds * TUNING.loop.fixedHz;

    if (this.callbacks.onFlyoverEnd) {
      this.callbacks.onFlyoverEnd();
    }
  }

  /**
   * Starts a practice sandbox session.
   */
  startPractice(playerConfig, rules = {}) {
    TUNING.match.mode = 'practice';
    this.matchState.mode = 'practice';
    this.matchState.matchOver = false;
    this.matchState.isCountingDown = false;
    this.matchState.countdownTicksRemaining = 0;
    this.matchState.celebrationTicks = 0;
    this.matchState.scoreHome = 0;
    this.matchState.scoreAway = 0;
    this.matchState.matchTicksRemaining = 0;
    this._wasCountingDown = false;
  }

  /**
   * Advances match scoring and clock logic per fixed step.
   * Zero heap allocations.
   *
   * @param {number} tick Current engine tick
   * @param {number} dt Fixed timestep
   * @param {Array<object>} balls Active physics balls
   * @returns {object} Updated match state
   */
  update(tick, dt, balls = []) {
    updateScoring(this.matchState, balls, tick);

    // Track countdown transition
    if (this._wasCountingDown && !this.matchState.isCountingDown) {
      this._wasCountingDown = false;
      if (this.callbacks.onCountdownEnd) {
        this.callbacks.onCountdownEnd();
      }
    }

    // Check match completion
    if (this.matchState.mode === 'match' && this.matchState.matchOver) {
      if (this.callbacks.onMatchOver) {
        this.callbacks.onMatchOver(this.matchState);
      }
    }

    return this.matchState;
  }

  /**
   * Resets match state for title screen.
   */
  resetForTitle() {
    TUNING.match.mode = 'practice';
    this.matchState.mode = 'practice';
    this.matchState.matchOver = false;
    this.matchState.isCountingDown = false;
    this.matchState.countdownTicksRemaining = 0;
    this.matchState.celebrationTicks = 0;
    this.matchState.scoreHome = 0;
    this.matchState.scoreAway = 0;
    this._wasCountingDown = false;
  }
}

export const matchManager = new MatchManager();
export { MatchManager };
