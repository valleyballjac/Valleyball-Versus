/**
 * Module: features/match/practiceMode
 * Role: Solo practice sandbox telemetry accumulator, session tick counter, and practice ball selection state.
 * Frame Phase: Fixed Update (60 Hz tick increment and strike/touch stat recording) and UI Transition (reset / summary).
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Single authority for `practiceStats`, `practiceSessionTicks`, and `selectedPracticeBallType`.
 *   - LAW 6 (Deterministic Match): Practice session duration is measured in 60 Hz simulation ticks (`practiceSessionTicks / 60`).
 */

/**
 * Live telemetry counters for Solo Practice mode.
 * Exposed on `window.__vb.practiceStats` and read by `hustleBoards.js`, `inGameMenu.js`, and `victoryScreen.js`.
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

let practiceSessionTicks = 0;
let selectedPracticeBallType = 'all';

/**
 * Resets all solo practice telemetry counters and session ticks to zero.
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

  if (athlete0?.strikeState) {
    athlete0.strikeState.resolvedCount = 0;
    athlete0.strikeState.whiffCount = 0;
  }
}

/**
 * Synchronizes `practiceStats.hits` and `practiceStats.whiffs` from P1's strike state.
 *
 * @param {object|null} athlete0
 */
export function syncPracticeStrikeStats(athlete0) {
  const strike = athlete0?.getStrikeStats?.();
  if (strike) {
    practiceStats.hits = strike.hits;
    practiceStats.whiffs = strike.whiffs;
  }
}

/**
 * Increments the practice session tick counter by 1 (called once per 60 Hz step in practice mode).
 *
 * @returns {number} Updated tick count
 */
export function incrementPracticeSessionTicks() {
  practiceSessionTicks += 1;
  return practiceSessionTicks;
}

/**
 * Returns the elapsed practice session ticks.
 *
 * @returns {number}
 */
export function getPracticeSessionTicks() {
  return practiceSessionTicks;
}

/**
 * Returns the elapsed practice session time in seconds (`practiceSessionTicks / 60`).
 *
 * @returns {number}
 */
export function getPracticeSessionSeconds() {
  return practiceSessionTicks / 60;
}

/**
 * Returns the currently selected practice ball choice (`'all' | 'small' | 'medium' | 'large'`).
 *
 * @returns {string}
 */
export function getSelectedPracticeBallType() {
  return selectedPracticeBallType;
}

/**
 * Sets the selected practice ball choice.
 *
 * @param {string} choice
 */
export function setSelectedPracticeBallType(choice) {
  selectedPracticeBallType = choice || 'all';
}
