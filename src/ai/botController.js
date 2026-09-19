import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { buildPerception, projectBallPosition } from './botPerception.js';
import { steerToward, steerIdle, computeAimYaw } from './botSteering.js';

/**
 * AI BOT CONTROLLER — the brain of the Valleyball AI opponent.
 *
 * Drives synthetic input into an athlete's input slot, making it
 * indistinguishable from a human controller. The bot reads world state
 * through the perception layer and writes to the same moveWorld / action
 * queues that a gamepad would.
 *
 * LAW 6 — All timing in integer ticks. No Date.now(), no Math.random().
 * LAW 1 — Never writes physics state directly; only writes input.
 *
 * ARCHITECTURE:
 *   Perception → Strategy → Tactics → Actuation
 *   - Perception: built fresh each tick from world state
 *   - Strategy: high-level goal re-evaluated every ~6 ticks
 *   - Tactics: per-tick intercept + action decisions
 *   - Actuation: writes to the input slot
 */

// ═══ STRATEGY STATES ═══
const STRATEGY = {
  CHASE:    0,  // Ball is far, sprint toward intercept
  POSITION: 1,  // Ball approaching, maneuver to optimal strike position
  STRIKE:   2,  // Ball in range, attempt a hit
  RECOVER:  3,  // Knocked down, wait for recovery
  DEFEND:   4,  // Ball heading toward own goal, intercept defensively
};

// ═══ DIFFICULTY PRESETS ═══
// Read from TUNING.ai at runtime; these are the defaults used if TUNING.ai
// is not yet populated.
const DIFFICULTY_DEFAULTS = {
  easy: {
    reactionDelayTicks: 18,
    aimAccuracy: 0.4,
    interceptLeadFactor: 0.5,
    strikeTimingJitter: 8,
    sprintUsage: 0.3,
    diveAccuracy: 0.3,
    spikeAccuracy: 0.3,
    defensiveAwareness: 0.2,
    strategyUpdateInterval: 12,
  },
  medium: {
    reactionDelayTicks: 8,
    aimAccuracy: 0.7,
    interceptLeadFactor: 0.8,
    strikeTimingJitter: 4,
    sprintUsage: 0.7,
    diveAccuracy: 0.6,
    spikeAccuracy: 0.6,
    defensiveAwareness: 0.6,
    strategyUpdateInterval: 8,
  },
  hard: {
    reactionDelayTicks: 2,
    aimAccuracy: 0.95,
    interceptLeadFactor: 1.0,
    strikeTimingJitter: 1,
    sprintUsage: 1.0,
    diveAccuracy: 0.9,
    spikeAccuracy: 0.9,
    defensiveAwareness: 0.9,
    strategyUpdateInterval: 6,
  },
};

// ═══ SCRATCH VECTORS (allocation-free hot path) ═══
const _interceptTarget = new THREE.Vector3();
const _defenseTarget = new THREE.Vector3();
const _strikeDir = new THREE.Vector3();
const _toGoal = new THREE.Vector3();
const _toBall = new THREE.Vector3();

// ═══ SEEDED PRNG (LAW 6 determinism) ═══
// Simple but sufficient for jitter and probabilistic decisions.
function createSeededRNG(seed) {
  let s = seed | 0 || 1;
  return function next() {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296);
  };
}

/**
 * Creates a new bot controller state object.
 *
 * @param {object} config
 * @param {string} config.difficulty 'easy' | 'medium' | 'hard'
 * @param {number} config.slotIndex  input slot index this bot controls (default 1)
 * @param {number} config.seed       deterministic RNG seed
 * @returns {object} bot state
 */
export function createBotController({
  difficulty = 'medium',
  slotIndex = 1,
  seed = 42,
} = {}) {
  return {
    difficulty,
    slotIndex,
    rng: createSeededRNG(seed),

    // Strategy
    strategy: STRATEGY.CHASE,
    lastStrategyTick: -Infinity,

    // Reaction delay buffer: perception is delayed by reactionDelayTicks
    perceptionBuffer: [],
    delayedPerception: null,

    // Tactical state
    lastStrikeTick: -Infinity,
    strikeCooldownTicks: 30,  // min ticks between strike attempts
    lastJumpTick: -Infinity,
    jumpCooldownTicks: 90,    // match player jump cooldown

    // Statistics
    stats: {
      strikeAttempts: 0,
      chaseTime: 0,
      positionTime: 0,
      defendTime: 0,
      recoverTime: 0,
    },

    // Override params for training — when set, these replace TUNING.ai values
    overrideParams: null,
  };
}

/**
 * Gets the difficulty parameters, reading from TUNING.ai if available.
 * Training overrides take priority.
 */
function getDifficultyParams(bot) {
  // Training override takes priority
  if (bot.overrideParams) return bot.overrideParams;

  const level = bot.difficulty;
  const tuningAi = TUNING.ai;
  if (tuningAi && tuningAi[level]) {
    return tuningAi[level];
  }
  return DIFFICULTY_DEFAULTS[level] || DIFFICULTY_DEFAULTS.medium;
}

/**
 * Selects the strategy based on the current perception.
 */
function selectStrategy(bot, perception, params) {
  // RECOVER: always takes priority when knocked down
  if (perception.self.isRecovering) {
    return STRATEGY.RECOVER;
  }

  const distToBall = _toBall
    .set(perception.ball.position.x, 0, perception.ball.position.z)
    .sub(_interceptTarget.set(perception.self.position.x, 0, perception.self.position.z))
    .length();

  // STRIKE: ball is very close and at a hittable height
  const ballRelativeHeight = perception.ball.position.y - perception.self.position.y;
  const strikeRange = params.strikeRange ?? 2.5;
  if (distToBall < strikeRange && ballRelativeHeight > (params.strikeHeightMin ?? -0.5) && ballRelativeHeight < (params.strikeHeightMax ?? 3.0)) {
    return STRATEGY.STRIKE;
  }

  // DEFEND: ball heading toward own goal with significant threat
  if (perception.threat > params.defensiveAwareness * 0.7) {
    // Only defend if ball is closer to our goal than we are
    const ballToGoalDist = _toBall
      .set(perception.ball.position.x, 0, perception.ball.position.z)
      .sub(_defenseTarget.set(perception.hoops.defendGoalPos.x, 0, perception.hoops.defendGoalPos.z))
      .length();
    const selfToGoalDist = _interceptTarget
      .set(perception.self.position.x, 0, perception.self.position.z)
      .sub(_defenseTarget.set(perception.hoops.defendGoalPos.x, 0, perception.hoops.defendGoalPos.z))
      .length();

    if (ballToGoalDist < selfToGoalDist + 5) {
      return STRATEGY.DEFEND;
    }
  }

  // POSITION: ball is reachable and approaching, get into position
  if (perception.ballIntercept.reachable && distToBall < (params.chaseToPositionDist ?? 12)) {
    return STRATEGY.POSITION;
  }

  // CHASE: default — go get the ball
  return STRATEGY.CHASE;
}

/**
 * Updates the bot for one fixed tick. Call BEFORE athlete.prePhysicsUpdate.
 *
 * @param {object} bot        bot state from createBotController
 * @param {object} athlete    the athlete entity this bot controls
 * @param {object} opponent   the opponent athlete entity (may be null)
 * @param {object[]} balls    active match balls array
 * @param {object} matchState match state from scoring.js
 * @param {object} inputSlot  the input slot to write to
 * @param {number} tick       current simulation tick
 * @param {number} dt         fixed timestep (1/60)
 */
export function updateBot(bot, athlete, opponent, balls, matchState, inputSlot, tick, dt) {
  if (!athlete || !balls || balls.length === 0) {
    steerIdle(inputSlot);
    return;
  }

  // Don't act during countdown
  if (matchState && matchState.isCountingDown) {
    steerIdle(inputSlot);
    return;
  }

  // Don't act if match is over
  if (matchState && matchState.matchOver) {
    steerIdle(inputSlot);
    return;
  }

  const params = getDifficultyParams(bot);

  // ═══ PERCEPTION (with reaction delay) ═══
  const freshPerception = buildPerception(athlete, opponent, balls, matchState, tick);

  // Buffer perception for reaction delay
  bot.perceptionBuffer.push({ tick, perception: freshPerception });

  // Find the perception from reactionDelayTicks ago
  const delayedTick = tick - params.reactionDelayTicks;
  while (bot.perceptionBuffer.length > 1 && bot.perceptionBuffer[0].tick < delayedTick) {
    bot.perceptionBuffer.shift();
  }
  // Use the oldest buffered perception that's at least reactionDelayTicks old
  const usePerception = bot.perceptionBuffer[0].tick <= delayedTick
    ? bot.perceptionBuffer[0].perception
    : freshPerception;  // fallback if buffer not deep enough yet

  bot.delayedPerception = usePerception;

  // Limit buffer size to avoid memory growth
  while (bot.perceptionBuffer.length > params.reactionDelayTicks + 5) {
    bot.perceptionBuffer.shift();
  }

  // ═══ STRATEGY (re-evaluate periodically) ═══
  const stratInterval = params.strategyUpdateInterval || 8;
  if (tick - bot.lastStrategyTick >= stratInterval) {
    bot.strategy = selectStrategy(bot, usePerception, params);
    bot.lastStrategyTick = tick;
  }

  // ═══ TACTICS & ACTUATION ═══
  switch (bot.strategy) {
    case STRATEGY.CHASE:
      executeChase(bot, usePerception, params, inputSlot, tick);
      bot.stats.chaseTime++;
      break;

    case STRATEGY.POSITION:
      executePosition(bot, usePerception, params, inputSlot, tick);
      bot.stats.positionTime++;
      break;

    case STRATEGY.STRIKE:
      executeStrike(bot, usePerception, freshPerception, params, inputSlot, tick);
      break;

    case STRATEGY.DEFEND:
      executeDefend(bot, usePerception, params, inputSlot, tick);
      bot.stats.defendTime++;
      break;

    case STRATEGY.RECOVER:
      executeRecover(bot, usePerception, params, inputSlot, tick);
      bot.stats.recoverTime++;
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TACTICAL EXECUTORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CHASE: Sprint toward the ball's predicted intercept point.
 */
function executeChase(bot, perception, params, slot, tick) {
  // Use intercept point if reachable, otherwise go directly to ball
  const target = perception.ballIntercept.reachable
    ? perception.ballIntercept.position
    : perception.ball.position;

  _interceptTarget.set(target.x, 0, target.z);

  // Lead the intercept based on difficulty
  const leadFactor = params.interceptLeadFactor;
  if (leadFactor < 1.0 && perception.ballIntercept.reachable) {
    // Interpolate between ball position and intercept position
    _interceptTarget.lerp(
      _toBall.set(perception.ball.position.x, 0, perception.ball.position.z),
      1.0 - leadFactor,
    );
  }

  const shouldSprint = bot.rng() < params.sprintUsage;
  steerToward(slot, perception.self.position, _interceptTarget, {
    sprint: shouldSprint,
    arriveRadius: params.arriveRadiusChase ?? 2.0,
  });

  // Compute aim yaw toward the attack goal for potential strikes
  slot.aimYaw = computeAimYaw(perception.self.position, perception.hoops.attackGoalPos);
  slot.hasAim = true;
  slot.cameraYaw = slot.aimYaw;
}

/**
 * POSITION: Maneuver to optimal striking position relative to the ball.
 */
function executePosition(bot, perception, params, slot, tick) {
  // Ideal position: between ball and attack goal, slightly behind the ball
  const ballPos = perception.ball.position;
  const goalPos = perception.hoops.attackGoalPos;

  // Direction from ball to goal
  _toGoal.set(goalPos.x - ballPos.x, 0, goalPos.z - ballPos.z).normalize();

  // Position ourselves behind the ball (relative to goal direction)
  // so strikes go toward the goal
  const posOffset = params.positionOffset ?? 1.5;
  _interceptTarget.set(
    ballPos.x - _toGoal.x * posOffset,
    0,
    ballPos.z - _toGoal.z * posOffset,
  );

  // If the ball is coming down, position under the intercept point
  if (perception.ball.velocity.y < -1.0 && perception.ballIntercept.reachable) {
    _interceptTarget.set(
      perception.ballIntercept.position.x,
      0,
      perception.ballIntercept.position.z,
    );
  }

  steerToward(slot, perception.self.position, _interceptTarget, {
    sprint: false,
    arriveRadius: params.arriveRadiusPosition ?? 1.0,
  });

  // Aim toward goal
  slot.aimYaw = computeAimYaw(perception.self.position, goalPos);
  slot.hasAim = true;
  slot.cameraYaw = slot.aimYaw;
}

/**
 * STRIKE: Ball is in range — decide and execute an action.
 */
function executeStrike(bot, perception, freshPerception, params, slot, tick) {
  const ballPos = freshPerception.ball.position;  // Use FRESH perception for strikes
  const selfPos = freshPerception.self.position;
  const goalPos = perception.hoops.attackGoalPos;

  // Ball height relative to pelvis (approximate pelvis at selfPos.y + 0.9)
  const pelvisY = selfPos.y + 0.9;
  const ballRelHeight = ballPos.y - pelvisY;

  // Distance to ball (XZ plane)
  const distXZ = Math.sqrt(
    (ballPos.x - selfPos.x) ** 2 + (ballPos.z - selfPos.z) ** 2,
  );

  // Keep steering toward ball even while striking
  _interceptTarget.set(ballPos.x, 0, ballPos.z);
  steerToward(slot, selfPos, _interceptTarget, {
    sprint: false,
    arriveRadius: params.arriveRadiusStrike ?? 0.5,
  });

  // Aim toward attack goal
  slot.aimYaw = computeAimYaw(selfPos, goalPos);
  slot.hasAim = true;
  slot.cameraYaw = slot.aimYaw;

  // Don't try to strike if on cooldown
  if (tick - bot.lastStrikeTick < bot.strikeCooldownTicks) return;

  // ═══ ACTION SELECTION ═══
  // Spike: ball is above head height and we're on the ground
  if (ballRelHeight > 1.0 && ballRelHeight < 3.5 && distXZ < 2.0) {
    if (bot.rng() < params.spikeAccuracy) {
      slot.spikeQueued = true;
      bot.lastStrikeTick = tick;
      bot.stats.strikeAttempts++;
    }
  }
  // Volley: ball is around chest/head height
  else if (ballRelHeight > -0.1 && ballRelHeight <= 1.0 && distXZ < 2.0) {
    if (bot.rng() < params.aimAccuracy) {
      slot.volleyQueued = true;
      bot.lastStrikeTick = tick;
      bot.stats.strikeAttempts++;
    }
  }
  // Kick: ball is below pelvis
  else if (ballRelHeight < -0.1 && ballRelHeight > -1.0 && distXZ < 1.5) {
    if (bot.rng() < params.aimAccuracy) {
      slot.volleyQueued = true;  // East button — contextual kick based on ball height
      bot.lastStrikeTick = tick;
      bot.stats.strikeAttempts++;
    }
  }

  // Jump to reach high balls
  if (ballRelHeight > (params.jumpHeightThreshold ?? 2.0) && distXZ < 3.0 && freshPerception.self.grounded) {
    if (tick - bot.lastJumpTick >= bot.jumpCooldownTicks) {
      slot.jumpQueued = true;
      bot.lastJumpTick = tick;
    }
  }

  // Dive to reach far balls
  const diveMin = params.diveDistMin ?? 3.0;
  const diveMax = params.diveDistMax ?? 6.0;
  if (distXZ > diveMin && distXZ < diveMax && freshPerception.self.grounded) {
    const ballApproaching = freshPerception.ball.velocity.y < -2.0;
    if (ballApproaching && bot.rng() < params.diveAccuracy * 0.3) {
      slot.diveQueued = true;
    }
  }
}

/**
 * DEFEND: Ball heading toward own goal — intercept defensively.
 */
function executeDefend(bot, perception, params, slot, tick) {
  const defendPos = perception.hoops.defendGoalPos;
  const ballPos = perception.ball.position;

  // Position between ball and own goal, biased by defenseDepth
  const depth = params.defenseDepth ?? 0.5;
  _defenseTarget.set(
    ballPos.x * (1 - depth) + defendPos.x * depth,
    0,
    ballPos.z * (1 - depth) + defendPos.z * depth,
  );

  // Bias toward the ball's predicted path
  if (perception.ballIntercept.reachable) {
    _defenseTarget.lerp(
      _interceptTarget.set(
        perception.ballIntercept.position.x, 0,
        perception.ballIntercept.position.z,
      ),
      0.6,
    );
  }

  steerToward(slot, perception.self.position, _defenseTarget, {
    sprint: true,
    arriveRadius: 2.0,
  });

  // Aim AWAY from own goal (toward opponent's side)
  slot.aimYaw = computeAimYaw(perception.self.position, perception.hoops.attackGoalPos);
  slot.hasAim = true;
  slot.cameraYaw = slot.aimYaw;

  // If ball is close enough, try to volley it away
  const distToBall = Math.sqrt(
    (ballPos.x - perception.self.position.x) ** 2 +
    (ballPos.z - perception.self.position.z) ** 2,
  );
  if (distToBall < 2.5 && tick - bot.lastStrikeTick >= bot.strikeCooldownTicks) {
    const ballRelHeight = ballPos.y - (perception.self.position.y + 0.9);
    if (ballRelHeight > -0.5 && ballRelHeight < 2.0) {
      slot.volleyQueued = true;
      bot.lastStrikeTick = tick;
      bot.stats.strikeAttempts++;
    }
  }
}

/**
 * RECOVER: Knocked down — clear input and wait for the recovery ramp.
 */
function executeRecover(bot, perception, params, slot, tick) {
  steerIdle(slot);
}
