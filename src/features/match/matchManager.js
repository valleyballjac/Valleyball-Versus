import { TUNING } from '../../config/tuning.js';
import { createMatchState, updateScoring } from '../../mechanics/scoring.js';

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
