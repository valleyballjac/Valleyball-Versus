import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { buildPerception, createPerception, projectBallPosition, getCourtFloorY } from './botPerception.js';
import {
  steerToward,
  steerIdle,
  computeAimYaw,
  computeGoalAimYaw,
  computeClearanceAimYaw,
  steerGoalSideArc,
  computeStreamHeadAimYaw,
  steerStageRunway,
  steerGoalAlignedApproach,
  shouldExecuteCut,
} from './botSteering.js';

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
export const STRATEGY = {
  CHASE:              0,  // Ball is far, sprint toward intercept
  POSITION:           1,  // Ball approaching, maneuver to optimal strike position
  STRIKE:             2,  // Ball in range, attempt a hit
  RECOVER:            3,  // Knocked down, wait for recovery
  DEFEND:             4,  // Ball heading toward own goal, intercept defensively
  STREAM_DRIBBLE:     5,  // Ball is controlled, advance along stream toward head
  MULTI_STAGE_ATTACK: 6,  // Coordinated multi-stage attack (2, 3, or 4 stages)
};

// ═══ ATTACK SEQUENCE DEFINITIONS ═══
export const ATTACK_STAGE = {
  NONE:           0,
  RETRIEVE:       1, // Stage 1: align behind ball in basin/stream runway
  STREAM_ADVANCE: 2, // Stage 2: accelerate ball up the stream channel
  SETUP_POP:      3, // Stage 3: light pop/lob into the aperture pocket
  AERIAL_FINISH:  4, // Stage 4: jump-spike aerial finish into hoop
};

export const ATTACK_TYPE = {
  NONE:                   0,
  FAST_BREAK_2_STAGE:     2, // Direct drive from midfield into hoop
  STREAM_RUN_3_STAGE:     3, // Basin runway -> stream channel -> hoop apex
  SET_AND_SPIKE_4_STAGE:  4, // Basin -> stream -> pop lob -> aerial jump-spike
};

// ═══ DIFFICULTY TUNING DEFAULTS (fallback if not in TUNING.ai) ═══
const DIFFICULTY_DEFAULTS = {
  easy: {
    reactionDelayTicks: 16,
    aimAccuracy: 0.5,
    interceptLeadFactor: 0.6,
    strikeTimingJitter: 6,
    sprintUsage: 0.3,
    diveAccuracy: 0.3,
    spikeAccuracy: 0.3,
    defensiveAwareness: 0.3,
    strategyUpdateInterval: 12,
    positionOffset: 0.5,
    strikeRange: 2.0,
    strikeHeightMin: -0.5,
    strikeHeightMax: 3.0,
    chaseToPositionDist: 10.0,
    defenseDepth: 0.4,
    arriveRadiusChase: 1.5,
    arriveRadiusPosition: 0.8,
    arriveRadiusStrike: 0.4,
    jumpHeightThreshold: 2.0,
  },
  medium: {
    reactionDelayTicks: 8,
    aimAccuracy: 0.75,
    interceptLeadFactor: 0.85,
    strikeTimingJitter: 3,
    sprintUsage: 0.75,
    diveAccuracy: 0.6,
    spikeAccuracy: 0.65,
    defensiveAwareness: 0.6,
    strategyUpdateInterval: 8,
    positionOffset: 0.35,
    strikeRange: 2.0,
    strikeHeightMin: -0.5,
    strikeHeightMax: 3.2,
    chaseToPositionDist: 12.0,
    defenseDepth: 0.45,
    arriveRadiusChase: 1.0,
    arriveRadiusPosition: 0.6,
    arriveRadiusStrike: 0.3,
    jumpHeightThreshold: 1.8,
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
    positionOffset: 0.3,
    strikeRange: 2.0,
    strikeHeightMin: -0.5,
    strikeHeightMax: 3.2,
    chaseToPositionDist: 14.0,
    defenseDepth: 0.5,
    arriveRadiusChase: 0.8,
    arriveRadiusPosition: 0.5,
    arriveRadiusStrike: 0.25,
    jumpHeightThreshold: 1.7,
  },
};

// ═══ SCRATCH VECTORS (allocation-free hot path) ═══
const _interceptTarget = new THREE.Vector3();
const _defenseTarget = new THREE.Vector3();
const _strikeDir = new THREE.Vector3();
const _toGoal = new THREE.Vector3();
const _toBall = new THREE.Vector3();
const _projectedBall = new THREE.Vector3();
const _projectedAth = new THREE.Vector3();

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
  aggressiveness = 0.60,
} = {}) {
  return {
    difficulty,
    slotIndex,
    rng: createSeededRNG(seed),
    baseAggressiveness: aggressiveness,
    currentAggressiveness: aggressiveness,

    // Strategy
    strategy: STRATEGY.CHASE,
    lastStrategyTick: -Infinity,
    attackStage: ATTACK_STAGE.NONE,
    attackType: ATTACK_TYPE.NONE,
    stageStartTick: 0,
    lastPopTick: -Infinity,

    // Pre-allocated perception ring buffer for zero GC allocations and strict instance isolation
    perceptionPool: Array.from({ length: 32 }, () => ({
      tick: -1,
      perception: createPerception(),
    })),
    poolHead: 0,
    delayedPerception: null,

    // Tactical state
    lastStrikeTick: -Infinity,
    strikeCooldownTicks: 30,  // min ticks between strike attempts
    lastDiveTick: -Infinity,  // min cooldown between dive attempts
    lastJumpTick: -Infinity,
    jumpCooldownTicks: 90,    // match player jump cooldown
    pendingJumpTick: -Infinity, // for jump-spike synchronization
    lastCutTick: -Infinity,
    cutCooldownTicks: 70,     // min cooldown between athletic cuts (~1.16s)

    // Statistics
    stats: {
      strikeAttempts: 0,
      chaseTime: 0,
      positionTime: 0,
      defendTime: 0,
      recoverTime: 0,
      cutCount: 0,
      hoopBlocks: 0,
    },

    // Override params for training — when set, these replace TUNING.ai values
    overrideParams: null,
  };
}

/**
 * Computes dynamic in-match aggressiveness based on score differential and time remaining.
 * Trailing bots push forward and attack aggressively; leading bots play tighter defense.
 */
export function computeDynamicAggressiveness(bot, matchState, perception) {
  if (!matchState) return bot.baseAggressiveness ?? 0.60;

  const isHome = perception?.hoops?.isHome ?? false;
  const myScore = isHome ? (matchState.scoreHome || 0) : (matchState.scoreAway || 0);
  const oppScore = isHome ? (matchState.scoreAway || 0) : (matchState.scoreHome || 0);
  const scoreDelta = myScore - oppScore; // negative = trailing, positive = leading

  let mod = 0;
  if (scoreDelta < 0) {
    // Trailing: increase aggressiveness by +0.12 per goal down
    mod += -scoreDelta * 0.12;
    // Final minute urgency (<= 3600 ticks)
    if (matchState.ticksRemaining <= 3600 && matchState.ticksRemaining > 0) {
      const timeFactor = 1.0 - (matchState.ticksRemaining / 3600);
      mod += timeFactor * 0.15;
    }
  } else if (scoreDelta > 0) {
    // Leading: tighten defense by -0.10 per goal up
    mod -= scoreDelta * 0.10;
  }

  return Math.max(0.10, Math.min(1.0, (bot.baseAggressiveness ?? 0.60) + mod));
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
function selectStrategy(bot, perception, params, tick) {
  // RECOVER: always takes priority when knocked down
  if (perception.self.isRecovering) {
    bot.attackStage = ATTACK_STAGE.NONE;
    bot.attackType = ATTACK_TYPE.NONE;
    return STRATEGY.RECOVER;
  }

  const agg = bot.currentAggressiveness ?? 0.6;
  const defAware = params.defensiveAwareness ?? 0.6;
  const defendGoalPos = perception.hoops.defendGoalPos;
  const toDefZ = defendGoalPos.z - perception.ball.position.z;
  const ballMovingToDef = (perception.ball.velocity.z * Math.sign(toDefZ)) > 0.8;
  const inOurDefendingThird = defendGoalPos.z > 0 ? perception.ball.position.z > 14.0 : perception.ball.position.z < -14.0;
  const opponentHasBall = perception.trajectory && perception.trajectory.firstTouchBy === 'opponent';
  const weHavePossession = perception.trajectory && (perception.trajectory.firstTouchBy === 'self' || (perception.trajectory.possessionWindow ?? 0) > 0.15);

  const distBallToDefend = Math.abs(defendGoalPos.z - perception.ball.position.z);

  // Threat resistance scales directly with aggressiveness:
  // Aggressive bots (agg=0.9) demand high threat (0.75+) to retreat, whereas timid bots (agg=0.3) retreat earlier (0.45+)
  const threatThreshold = Math.max(0.40, defAware * (0.85 - agg * 0.45));
  const oppDangerous = opponentHasBall && !weHavePossession && (
    (inOurDefendingThird && ballMovingToDef) ||
    distBallToDefend <= 18.0 ||
    perception.threat > threatThreshold
  );

  const imminentGoalThreat = ballMovingToDef && inOurDefendingThird && distBallToDefend <= 22.0 && perception.ball.speed > 3.5;

  if (!weHavePossession && (oppDangerous || imminentGoalThreat || (perception.threat > 0.75 && inOurDefendingThird))) {
    bot.attackStage = ATTACK_STAGE.NONE;
    bot.attackType = ATTACK_TYPE.NONE;
    return STRATEGY.DEFEND;
  }

  const toBallX = perception.ball.position.x - perception.self.position.x;
  const toBallZ = perception.ball.position.z - perception.self.position.z;
  const distToBall = Math.hypot(toBallX, toBallZ);
  const isPositionedBehindBall = perception.goalSide.isGoalSide;

  // Active Multi-Stage Attack Continuation
  if (bot.strategy === STRATEGY.MULTI_STAGE_ATTACK && bot.attackStage !== ATTACK_STAGE.NONE) {
    if (tick - bot.stageStartTick < 360) {
      return STRATEGY.MULTI_STAGE_ATTACK;
    }
  }

  // STRIKE: ball is close, at a hittable height, and we are positioned behind it
  const ballRelativeHeight = perception.ball.position.y - perception.self.position.y;
  const strikeRange = (params.strikeRange ?? 2.0) + (agg - 0.5) * 0.8;
  const isFinishing = perception.stream.isFinishingZone || perception.stream.isAtStreamHead;
  const strikeDistLimit = isFinishing ? strikeRange : Math.min(strikeRange, 1.4 + agg * 0.8);
  if (isPositionedBehindBall && distToBall < strikeDistLimit && ballRelativeHeight > (params.strikeHeightMin ?? -0.5) && ballRelativeHeight < (params.strikeHeightMax ?? 3.4)) {
    bot.attackStage = ATTACK_STAGE.NONE;
    bot.attackType = ATTACK_TYPE.NONE;
    return STRATEGY.STRIKE;
  }

  // ═══ MULTI-STAGE ATTACK ARBITRATION ═══
  const possessionWindow = perception.trajectory?.possessionWindow ?? 1.5;
  const isHard = bot.difficulty === 'hard';
  const hasPossessionPriority = !opponentHasBall;

  if (isPositionedBehindBall && distToBall < 12.0 && hasPossessionPriority) {
    if (isHard || agg >= 0.6) {
      // High aggressiveness (>=0.75) heavily favors Fast Break 2-Stage attack for immediate direct strikes!
      if (agg >= 0.75) {
        if (possessionWindow >= 2.5 && !isFinishing && isHard && bot.rng() < 0.25) {
          bot.attackType = ATTACK_TYPE.SET_AND_SPIKE_4_STAGE;
        } else if (possessionWindow >= 1.5 && !isFinishing && bot.rng() < 0.25) {
          bot.attackType = ATTACK_TYPE.STREAM_RUN_3_STAGE;
        } else {
          bot.attackType = ATTACK_TYPE.FAST_BREAK_2_STAGE;
        }
        bot.attackStage = ATTACK_STAGE.RETRIEVE;
        bot.stageStartTick = tick;
        return STRATEGY.MULTI_STAGE_ATTACK;
      }

      // Hard AI: choose 2, 3, or 4 stages based on possession window & position
      if (possessionWindow >= 2.0 && !isFinishing) {
        bot.attackType = ATTACK_TYPE.SET_AND_SPIKE_4_STAGE;
        bot.attackStage = ATTACK_STAGE.RETRIEVE;
        bot.stageStartTick = tick;
        return STRATEGY.MULTI_STAGE_ATTACK;
      } else if (possessionWindow >= 0.8 && !isFinishing) {
        bot.attackType = ATTACK_TYPE.STREAM_RUN_3_STAGE;
        bot.attackStage = ATTACK_STAGE.RETRIEVE;
        bot.stageStartTick = tick;
        return STRATEGY.MULTI_STAGE_ATTACK;
      } else {
        bot.attackType = ATTACK_TYPE.FAST_BREAK_2_STAGE;
        bot.attackStage = ATTACK_STAGE.RETRIEVE;
        bot.stageStartTick = tick;
        return STRATEGY.MULTI_STAGE_ATTACK;
      }
    } else if (bot.difficulty === 'medium') {
      // Medium AI: uses 2 or 3 stage attacks
      if (possessionWindow >= 1.0 && !isFinishing) {
        bot.attackType = ATTACK_TYPE.STREAM_RUN_3_STAGE;
        bot.attackStage = ATTACK_STAGE.RETRIEVE;
        bot.stageStartTick = tick;
        return STRATEGY.MULTI_STAGE_ATTACK;
      } else {
        bot.attackType = ATTACK_TYPE.FAST_BREAK_2_STAGE;
        bot.attackStage = ATTACK_STAGE.RETRIEVE;
        bot.stageStartTick = tick;
        return STRATEGY.MULTI_STAGE_ATTACK;
      }
    }
  }

  // STREAM_DRIBBLE: Positioned behind ball, not an emergency, advancing upcourt along stream
  if (isPositionedBehindBall && distToBall < 6.5 && !isFinishing) {
    return STRATEGY.STREAM_DRIBBLE;
  }

  // POSITION: ball is in play and we can set up behind its landing spot
  if (distToBall < (params.chaseToPositionDist ?? 12.0)) {
    return STRATEGY.POSITION;
  }

  // CHASE: default — sprint toward the intercept pocket behind the ball
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
  if (inputSlot) inputSlot.cutQueued = false;
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

  // ═══ PERCEPTION (with reaction delay & zero GC allocation) ═══
  let freshPerception;
  let usePerception;

  if (bot.perceptionPool && bot.perceptionPool.length > 0) {
    const slotIdx = (bot.poolHead++) % bot.perceptionPool.length;
    const poolSlot = bot.perceptionPool[slotIdx];
    poolSlot.tick = tick;
    freshPerception = buildPerception(athlete, opponent, balls, matchState, tick, poolSlot.perception);

    // Dynamic aggressiveness modulation
    bot.currentAggressiveness = computeDynamicAggressiveness(bot, matchState, freshPerception);

    // Look back for perception matching tick - params.reactionDelayTicks
    const delayedTick = tick - params.reactionDelayTicks;
    let bestSlot = null;
    let bestDiff = Infinity;
    for (let i = 0; i < bot.perceptionPool.length; i++) {
      const s = bot.perceptionPool[i];
      if (s.tick >= 0 && s.tick <= delayedTick) {
        const diff = delayedTick - s.tick;
        if (diff < bestDiff) {
          bestDiff = diff;
          bestSlot = s;
        }
      }
    }
    usePerception = bestSlot ? bestSlot.perception : freshPerception;
  } else {
    freshPerception = buildPerception(athlete, opponent, balls, matchState, tick);
    bot.currentAggressiveness = computeDynamicAggressiveness(bot, matchState, freshPerception);
    usePerception = freshPerception;
  }

  bot.delayedPerception = usePerception;

  // ═══ STRATEGY (re-evaluate periodically) ═══
  const stratInterval = params.strategyUpdateInterval || 8;
  if (tick - bot.lastStrategyTick >= stratInterval) {
    bot.strategy = selectStrategy(bot, usePerception, params, tick);
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

    case STRATEGY.STREAM_DRIBBLE:
      executeStreamDribble(bot, usePerception, params, inputSlot, tick);
      bot.stats.dribbleTime = (bot.stats.dribbleTime || 0) + 1;
      break;

    case STRATEGY.MULTI_STAGE_ATTACK:
      executeMultiStageAttack(bot, usePerception, freshPerception, params, inputSlot, tick);
      bot.stats.attackTime = (bot.stats.attackTime || 0) + 1;
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

  // ═══ PREDICTIVE STRIKE & ACTION ARBITRATION ═══
  // Evaluated fresh every tick so animation wind-up timing hits the sweet spot!
  evaluatePredictiveStrikes(bot, freshPerception, params, inputSlot, tick);
}

// ═══════════════════════════════════════════════════════════════════════════
// TACTICAL EXECUTORS & PREDICTIVE STRIKES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CHASE: Sprint toward the ball's predicted intercept point.
 */
function executeChase(bot, perception, params, slot, tick) {
  const selfPos = perception.self.position;
  const selfVel = perception.self.velocity;
  const ballPos = perception.ball.position;
  const defendGoalPos = perception.hoops.defendGoalPos;
  const attackGoalPos = perception.hoops.attackGoalPos;
  const profile = perception.ballPhysicsProfile;

  // If athlete has slipped past the ball (wrong side), perform goal-side arc loop!
  if (!perception.goalSide.isGoalSide) {
    steerGoalSideArc(slot, selfPos, ballPos, defendGoalPos, {
      sprint: true,
      maxSpeed: profile.maxApproachSpeed,
      currentVel: selfVel,
    });
    slot.hasAim = false;
    if (tick - bot.lastCutTick >= bot.cutCooldownTicks &&
        shouldExecuteCut(selfVel, slot.moveWorld, { minSpeed: 2.8, isDownhill: perception.terrain?.isDownhillFacing })) {
      slot.cutQueued = true;
      bot.lastCutTick = tick;
      bot.stats.cutCount = (bot.stats.cutCount || 0) + 1;
    }
    return;
  }

  const intercept = perception.ballIntercept.position;
  const targetX = Math.max(-15.0, Math.min(15.0, intercept.x));
  const targetZ = Math.max(-46.0, Math.min(46.0, intercept.z));
  const vecToGoal = perception.hoops.vecToAttackGoal;
  const ballRadius = perception.ball.radius || 0.5;
  const posOffset = (params.positionOffset ?? 0.35) + (ballRadius - 0.5) * 0.35 + (profile.brakingDistance - 1.0) * 0.2;

  _interceptTarget.set(
    targetX - vecToGoal.x * posOffset,
    0,
    targetZ - vecToGoal.z * posOffset
  );

  const leadFactor = params.interceptLeadFactor ?? 1.0;
  if (leadFactor < 1.0) {
    _interceptTarget.lerp(
      _toBall.set(perception.ball.position.x, 0, perception.ball.position.z),
      1.0 - leadFactor,
    );
  }

  const agg = bot.currentAggressiveness ?? 0.6;
  const distToTarget = Math.hypot(_interceptTarget.x - selfPos.x, _interceptTarget.z - selfPos.z);
  const shouldSprint = (agg >= 0.5) || (distToTarget > (profile.brakingDistance * 1.3) && (bot.rng() < (params.sprintUsage ?? 0.8)));
  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);

  // If close to the ball and on goal side, curve into a goal-aligned approach runway!
  if (distToBall < 7.0 && perception.goalSide.isGoalSide) {
    steerGoalAlignedApproach(slot, selfPos, selfVel, ballPos, attackGoalPos, defendGoalPos, {
      sprint: shouldSprint,
      maxSpeed: profile.maxApproachSpeed,
      decelFactor: profile.decelFactor,
      runwayOffset: posOffset + 0.9,
    });
  } else {
    steerToward(slot, selfPos, _interceptTarget, {
      sprint: shouldSprint,
      arrive: false,
      maxSpeed: profile.maxApproachSpeed,
      decelFactor: profile.decelFactor,
      minDrive: 0.65,
      currentVel: selfVel,
    });
    slot.hasAim = false;
  }

  // Check cut execution when redirecting sharply toward intercept
  if (tick - bot.lastCutTick >= bot.cutCooldownTicks &&
      shouldExecuteCut(selfVel, slot.moveWorld, { minSpeed: 3.2, isDownhill: perception.terrain?.isDownhillFacing })) {
    slot.cutQueued = true;
    bot.lastCutTick = tick;
    bot.stats.cutCount = (bot.stats.cutCount || 0) + 1;
  }
}

/**
 * POSITION: Maneuver into the line-of-action BEHIND the ball facing the target goal.
 * Line of action: [Athlete] ----> [Ball Intercept] ----> [Attack Goal]
 */
function executePosition(bot, perception, params, slot, tick) {
  const selfPos = perception.self.position;
  const selfVel = perception.self.velocity;
  const ballPos = perception.ball.position;
  const defendGoalPos = perception.hoops.defendGoalPos;
  const attackGoalPos = perception.hoops.attackGoalPos;
  const vecToGoal = perception.hoops.vecToAttackGoal;
  const profile = perception.ballPhysicsProfile;
  const agg = bot.currentAggressiveness ?? 0.6;

  // Goal-side check: if caught on wrong side, loop back around
  if (!perception.goalSide.isGoalSide) {
    steerGoalSideArc(slot, selfPos, ballPos, defendGoalPos, {
      sprint: true,
      maxSpeed: profile.maxApproachSpeed,
      currentVel: selfVel,
    });
    slot.hasAim = false;
    if (tick - bot.lastCutTick >= bot.cutCooldownTicks &&
        shouldExecuteCut(selfVel, slot.moveWorld, { minSpeed: 2.8, isDownhill: perception.terrain?.isDownhillFacing })) {
      slot.cutQueued = true;
      bot.lastCutTick = tick;
      bot.stats.cutCount = (bot.stats.cutCount || 0) + 1;
    }
    return;
  }

  const intercept = perception.ballIntercept.position;
  const ballRadius = perception.ball.radius || 0.5;
  const posOffset = (params.positionOffset ?? 0.35) + (ballRadius - 0.5) * 0.35;
  
  _interceptTarget.set(
    intercept.x - vecToGoal.x * posOffset,
    0,
    intercept.z - vecToGoal.z * posOffset,
  );

  const distToTarget = Math.hypot(_interceptTarget.x - selfPos.x, _interceptTarget.z - selfPos.z);
  const shouldSprint = (agg >= 0.55) || (distToTarget > (profile.brakingDistance * 1.5) && (bot.rng() < (params.sprintUsage ?? 0.7)));
  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);

  if (distToBall < 6.0 && perception.goalSide.isGoalSide) {
    steerGoalAlignedApproach(slot, selfPos, selfVel, ballPos, attackGoalPos, defendGoalPos, {
      sprint: shouldSprint,
      maxSpeed: profile.maxApproachSpeed,
      decelFactor: profile.decelFactor,
      runwayOffset: posOffset + 0.8,
    });
    slot.aimYaw = computeClearanceAimYaw(selfPos, attackGoalPos, defendGoalPos);
    slot.hasAim = true;
    slot.cameraYaw = slot.aimYaw;
  } else {
    steerToward(slot, selfPos, _interceptTarget, {
      sprint: shouldSprint,
      arrive: false,
      maxSpeed: profile.maxApproachSpeed,
      decelFactor: profile.decelFactor,
      minDrive: 0.60,
      currentVel: selfVel,
    });
    slot.hasAim = false;
  }

  // Check cut execution when decelerating or turning into position pocket
  if (tick - bot.lastCutTick >= bot.cutCooldownTicks &&
      shouldExecuteCut(selfVel, slot.moveWorld, { minSpeed: 3.0, isDownhill: perception.terrain?.isDownhillFacing })) {
    slot.cutQueued = true;
    bot.lastCutTick = tick;
    bot.stats.cutCount = (bot.stats.cutCount || 0) + 1;
  }
}

/**
 * STREAM_DRIBBLE: Guides and dribbles the ball up the flank stream towards the stream head.
 * Maintains controlled body pacing behind the ball without wildly swatting it away.
 */
function executeStreamDribble(bot, perception, params, slot, tick) {
  const selfPos = perception.self.position;
  const ballPos = perception.ball.position;
  const defendGoalPos = perception.hoops.defendGoalPos;
  const attackGoalPos = perception.hoops.attackGoalPos;
  const attackHead = perception.stream.attackStreamHead;
  const profile = perception.ballPhysicsProfile;
  const nearestLaneX = perception.stream.nearestLaneX;
  const signZ = Math.sign(attackGoalPos.z - defendGoalPos.z) || 1;

  // If somehow caught in front of the ball, arc behind it first!
  if (!perception.goalSide.isGoalSide) {
    steerGoalSideArc(slot, selfPos, ballPos, defendGoalPos, {
      sprint: true,
      maxSpeed: profile.maxApproachSpeed,
    });
    slot.hasAim = false;
    return;
  }

  const ballRadius = perception.ball.radius || 0.5;
  const posOffset = 0.4 + ballRadius * 0.4;

  let targetX = ballPos.x;
  // If not yet centered in stream lane, angle slightly to push ball toward stream channel
  if (!perception.stream.isInStreamLane) {
    const laneDirX = Math.sign(nearestLaneX - ballPos.x);
    targetX = ballPos.x - laneDirX * 0.35;
  } else {
    // Already in stream channel: stay aligned with stream lane
    targetX = nearestLaneX;
  }

  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);
  const isCloseToBall = distToBall <= posOffset * 1.6;

  // When close, drive THROUGH the ball to physically push and shepherd it up the stream!
  // When further away, target the arrival pocket behind the ball.
  const targetZ = isCloseToBall
    ? ballPos.z + signZ * 0.75
    : ballPos.z - signZ * posOffset;
  _interceptTarget.set(targetX, 0, targetZ);

  const agg = bot.currentAggressiveness ?? 0.6;
  const isBallRunningAway = distToBall > 1.8;
  const shouldSprint = isBallRunningAway || (agg >= 0.5);

  steerToward(slot, selfPos, _interceptTarget, {
    sprint: shouldSprint,
    arrive: false,
    arriveRadius: 0.3,
    maxSpeed: profile.maxApproachSpeed * (isBallRunningAway ? 1.0 : 0.95),
    decelFactor: profile.decelFactor,
    minDrive: isCloseToBall ? 0.85 : 0.65,
    facePos: attackHead,
    currentVel: perception.self.velocity,
  });

  // Face toward the attacking stream head so athlete naturally pushes upcourt
  slot.aimYaw = computeAimYaw(selfPos, attackHead);
  slot.hasAim = true;
  slot.cameraYaw = slot.aimYaw;
}

/**
 * MULTI-STAGE ATTACK: Coordinates 2, 3, or 4-stage tactical attack sequences:
 * - Stage 1 (RETRIEVE): Curve along corridor runway behind the ball toward attack target.
 * - Stage 2 (STREAM_ADVANCE): Dribble and guide ball along flank stream to stream head.
 * - Stage 3 (SETUP_POP): Soft upward loft touch across X = 0 hanging ball into aperture zone.
 * - Stage 4 (AERIAL_FINISH): Synchronized jump-spike smashing downward through the hoop.
 */
function executeMultiStageAttack(bot, perception, freshPerception, params, slot, tick) {
  const selfPos = freshPerception.self.position;
  const ballPos = freshPerception.ball.position;
  const attackGoalPos = perception.hoops.attackGoalPos;
  const defendGoalPos = perception.hoops.defendGoalPos;
  const attackHead = perception.stream.attackStreamHead;
  const profile = freshPerception.ballPhysicsProfile;
  const signZ = Math.sign(attackGoalPos.z - defendGoalPos.z) || 1;
  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);
  const isGoalSide = freshPerception.goalSide.isGoalSide;

  // Goal-side safety: if caught on wrong side, arc safely around
  if (!isGoalSide) {
    steerGoalSideArc(slot, selfPos, ballPos, defendGoalPos, {
      sprint: true,
      maxSpeed: profile.maxApproachSpeed,
      currentVel: freshPerception.self.velocity,
    });
    slot.hasAim = false;
    return;
  }

  switch (bot.attackStage) {
    case ATTACK_STAGE.RETRIEVE: {
      const stageTarget = (bot.attackType === ATTACK_TYPE.FAST_BREAK_2_STAGE)
        ? attackGoalPos
        : attackHead;

      steerStageRunway(slot, selfPos, ballPos, stageTarget, defendGoalPos, {
        sprint: true,
        runwayOffset: 1.6,
        decelFactor: profile.decelFactor,
        maxSpeed: profile.maxApproachSpeed,
        currentVel: freshPerception.self.velocity,
      });

      const agg = bot.currentAggressiveness ?? 0.6;
      const strikeLimit = Math.min(profile.strikeReach, 1.4 + (agg - 0.5) * 0.8);
      if (distToBall <= strikeLimit && isGoalSide) {
        if (bot.attackType === ATTACK_TYPE.FAST_BREAK_2_STAGE || agg >= 0.85) {
          executeStrike(bot, perception, freshPerception, params, slot, tick);
        } else {
          bot.attackStage = ATTACK_STAGE.STREAM_ADVANCE;
          bot.stageStartTick = tick;
        }
      }
      break;
    }

    case ATTACK_STAGE.STREAM_ADVANCE: {
      executeStreamDribble(bot, perception, params, slot, tick);

      const distToHead = Math.hypot(ballPos.x - attackHead.x, ballPos.z - attackHead.z);
      const isFinishing = perception.stream.isFinishingZone || distToHead <= 6.5;

      if (isFinishing) {
        if (bot.attackType === ATTACK_TYPE.STREAM_RUN_3_STAGE) {
          executeStrike(bot, perception, freshPerception, params, slot, tick);
        } else if (bot.attackType === ATTACK_TYPE.SET_AND_SPIKE_4_STAGE) {
          bot.attackStage = ATTACK_STAGE.SETUP_POP;
          bot.stageStartTick = tick;
        }
      }
      break;
    }

    case ATTACK_STAGE.SETUP_POP: {
      const aimYaw = computeGoalAimYaw(selfPos, attackGoalPos);
      steerToward(slot, selfPos, ballPos, {
        sprint: false,
        arriveRadius: 0.3,
        maxSpeed: 0.85,
        minDrive: 0.65,
        aimYaw,
      });

      slot.aimYaw = aimYaw;
      slot.cameraYaw = aimYaw;
      slot.hasAim = true;

      // When ball is in touch range, pop it up!
      if (distToBall <= 1.6) {
        slot.volleyQueued = true; // Contextual kick / soft pop touch
        bot.lastStrikeTick = tick;
        bot.lastPopTick = tick;
        bot.lastStrikeKind = 'kick';
        bot.stats.strikeAttempts++;

        bot.attackStage = ATTACK_STAGE.AERIAL_FINISH;
        bot.stageStartTick = tick;
      }
      break;
    }

    case ATTACK_STAGE.AERIAL_FINISH: {
      const apexPos = perception.trajectory.hasApex
        ? perception.trajectory.nextApexPos
        : ballPos;

      const targetX = Math.max(-2.5, Math.min(2.5, apexPos.x));
      const targetZ = apexPos.z - signZ * 0.4;
      _interceptTarget.set(targetX, 0, targetZ);

      const distToApex = Math.hypot(_interceptTarget.x - selfPos.x, _interceptTarget.z - selfPos.z);
      const shouldSprint = distToApex > 0.8;

      const aimYaw = computeStreamHeadAimYaw(selfPos, attackGoalPos);
      steerToward(slot, selfPos, _interceptTarget, {
        sprint: shouldSprint,
        arriveRadius: 0.3,
        maxSpeed: 1.0,
        minDrive: 0.8,
        aimYaw,
      });

      slot.aimYaw = aimYaw;
      slot.cameraYaw = aimYaw;
      slot.hasAim = true;

      const ballHeightAboveFloor = ballPos.y - getCourtFloorY(ballPos.z);
      // Trigger jump when approaching ball in air
      if (distToBall <= 2.2 && ballHeightAboveFloor >= 1.5 && freshPerception.self.grounded) {
        if (tick - bot.lastJumpTick >= bot.jumpCooldownTicks) {
          slot.jumpPressed = true;
          slot.jumpQueued = true;
          bot.lastJumpTick = tick;
        }
      }

      // Smash spike downward when airborne or at peak!
      if (distToBall <= 2.2 && (ballHeightAboveFloor >= 1.4 || !freshPerception.self.grounded)) {
        if (tick - bot.lastStrikeTick >= 20) {
          slot.action2Pressed = true; // Spike
          slot.spikeQueued = true;
          bot.lastStrikeTick = tick;
          bot.lastStrikeKind = 'spike';
          bot.stats.strikeAttempts++;
        }
      }

      // If ball drops to ground or 90 ticks elapse, complete sequence
      if (ballPos.y < 1.2 || tick - bot.stageStartTick > 90) {
        bot.attackStage = ATTACK_STAGE.NONE;
        bot.attackType = ATTACK_TYPE.NONE;
      }
      break;
    }
  }
}

/**
 * STRIKE: Ball is in immediate range — steer forward through the ball toward the goal.
 */
function executeStrike(bot, perception, freshPerception, params, slot, tick) {
  const ballPos = freshPerception.ball.position;
  const selfPos = freshPerception.self.position;
  const goalPos = perception.hoops.attackGoalPos;
  const defendGoalPos = perception.hoops.defendGoalPos;
  const vecToGoal = perception.hoops.vecToAttackGoal;
  const profile = freshPerception.ballPhysicsProfile;

  // Drive forward THROUGH the ball toward the goal
  _interceptTarget.set(
    ballPos.x + vecToGoal.x * 0.6,
    0,
    ballPos.z + vecToGoal.z * 0.6
  );
  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);
  const shouldSprint = distToBall > 0.8 && (bot.rng() < (params.sprintUsage ?? 0.8));

  steerToward(slot, selfPos, _interceptTarget, {
    sprint: shouldSprint,
    arriveRadius: 0.3,
    maxSpeed: profile.maxApproachSpeed,
    minDrive: 0.8,
    facePos: goalPos,
    currentVel: freshPerception.self.velocity,
  });

  slot.aimYaw = computeClearanceAimYaw(selfPos, goalPos, defendGoalPos);
  slot.hasAim = true;
  slot.cameraYaw = slot.aimYaw;
}

/**
 * DEFEND: Utilize valley court topography.
 * When a clean clearance is ready, charge downhill with momentum towards the pocket behind the ball.
 * Otherwise, hold a disciplined defensive blocking position guarding the goal aperture.
 */
function executeDefend(bot, perception, params, slot, tick) {
  const defendPos = perception.hoops.defendGoalPos;
  const attackGoalPos = perception.hoops.attackGoalPos;
  const ballPos = perception.ball.position;
  const intercept = perception.ballIntercept.position;
  const vecToGoal = perception.hoops.vecToAttackGoal;
  const selfPos = perception.self.position;
  const selfVel = perception.self.velocity;
  const ballRadius = perception.ball.radius || 0.5;
  const agg = bot.currentAggressiveness ?? 0.6;
  const profile = perception.ballPhysicsProfile;
  const isGoalSide = perception.goalSide.isGoalSide;

  // Check if we have a clean, high-confidence clearance opportunity:
  // 1. Athlete must be goal-side (behind ball).
  // 2. Ball is arriving in <= 35 ticks and within reasonable distance.
  // 3. Opponent does NOT have first touch priority.
  // 4. High enough aggressiveness or close loose ball.
  const ticksToArrive = perception.ballIntercept.ticksToArrive;
  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);
  const oppHasFirstTouch = perception.trajectory && perception.trajectory.firstTouchBy === 'opponent';
  const hasClearanceChance = !oppHasFirstTouch && isGoalSide && (distToBall <= 16.0 || ticksToArrive <= 50 || agg >= 0.5);

  if (hasClearanceChance) {
    // Charge downhill with forward momentum towards the strike pocket behind the ball
    const posOffset = (params.positionOffset ?? 0.35) + (ballRadius - 0.5) * 0.35;
    _defenseTarget.set(
      intercept.x - vecToGoal.x * posOffset,
      0,
      intercept.z - vecToGoal.z * posOffset
    );

    const distToTarget = Math.hypot(_defenseTarget.x - selfPos.x, _defenseTarget.z - selfPos.z);
    const shouldSprint = (agg >= 0.5) || distToTarget > 1.5;

    steerToward(slot, selfPos, _defenseTarget, {
      sprint: shouldSprint,
      arrive: false,
      maxSpeed: profile.maxApproachSpeed,
      decelFactor: profile.decelFactor,
      minDrive: 0.75,
      facePos: attackGoalPos,
      currentVel: selfVel,
    });
    slot.aimYaw = computeClearanceAimYaw(selfPos, attackGoalPos, defendPos);
    slot.hasAim = true;
    slot.cameraYaw = slot.aimYaw;
  } else {
    // HOLD DEFENSIVE BLOCKING POSITION:
    // Stand strictly between the ball/opponent and defending goal aperture to guard the net!
    if (oppHasFirstTouch && perception.trajectory.defensiveBlockTarget.lengthSq() > 0) {
      _defenseTarget.copy(perception.trajectory.defensiveBlockTarget);
    } else {
      // HOOP APERTURE & MOUND DEFENSE:
      // Position on the goal mound rim (Z ≈ ±36.5m to ±38.0m, elevation Y ≈ 7.5m - 8.5m)
      // directly under the aperture mouth (Z = ±40.0m, Y = 10.0m) to swat any descending shot!
      const signDef = Math.sign(defendPos.z) || 1;
      const rimZ = signDef * 36.5;
      const rimX = Math.max(-4.5, Math.min(4.5, ballPos.x * 0.45));
      const rimY = getCourtFloorY(rimX, rimZ);
      _defenseTarget.set(rimX, rimY, rimZ);
    }

    const distToTarget = Math.hypot(_defenseTarget.x - selfPos.x, _defenseTarget.z - selfPos.z);
    const shouldSprint = distToTarget > 2.0;

    steerToward(slot, selfPos, _defenseTarget, {
      sprint: shouldSprint,
      arriveRadius: 0.8,
      maxSpeed: profile.maxApproachSpeed,
      minDrive: 0.5,
      facePos: ballPos, // Face the ball while blocking!
      currentVel: selfVel,
    });
    slot.aimYaw = computeClearanceAimYaw(selfPos, attackGoalPos, defendPos);
    slot.hasAim = true;
    slot.cameraYaw = slot.aimYaw;

    // Anchor at the rim with Cut: when sliding down the mound slope or stopping at the rim
    if (tick - bot.lastCutTick >= bot.cutCooldownTicks) {
      const az = Math.abs(selfPos.z);
      if (az >= 32.0 && distToTarget <= 2.5 && shouldExecuteCut(selfVel, slot.moveWorld, { minSpeed: 2.2, isDownhill: true })) {
        slot.cutQueued = true;
        bot.lastCutTick = tick;
        bot.stats.cutCount = (bot.stats.cutCount || 0) + 1;
      }
    }
  }
}

/**
 * RECOVER: Knocked down — zero input and wait for recovery.
 */
function executeRecover(bot, perception, params, slot, tick) {
  steerIdle(slot);
}

/**
 * PREDICTIVE STRIKE ARBITRATOR:
 * Anticipates ball arrival matching physical animation windups:
 *   - Spike: 42 ticks windup
 *   - Volley: 20 ticks windup
 *   - Kick: 14 ticks windup
 */
function evaluatePredictiveStrikes(bot, freshPerception, params, slot, tick) {
  if (freshPerception.self.isRecovering) return;

  // ═══ ZERO-TOLERANCE OWN-GOAL GUARD ═══
  // If facing within 80 degrees of defending goal, or if athlete is on the wrong side of the ball,
  // ALL strikes, volleys, kicks, and dives are strictly forbidden!
  if (freshPerception.goalSide.facingDefendGoal) return;
  if (!freshPerception.goalSide.isGoalSide) return;

  // Check scheduled jump for jump-spikes
  if (tick >= bot.pendingJumpTick && bot.pendingJumpTick > 0 && freshPerception.self.grounded) {
    if (tick - bot.lastJumpTick >= bot.jumpCooldownTicks) {
      slot.jumpQueued = true;
      bot.lastJumpTick = tick;
    }
    bot.pendingJumpTick = -Infinity;
  }

  // Obey strike cooldown & prevent cancelling our own active swing window!
  const agg = bot.currentAggressiveness ?? 0.6;
  const dynamicCooldown = Math.max(12, Math.round(28 - agg * 14));
  const activeWindowTicks = bot.lastStrikeKind === 'spike' ? 54 : (bot.lastStrikeKind === 'kick' ? 18 : 30);
  if (tick - bot.lastStrikeTick < Math.max(dynamicCooldown, activeWindowTicks)) return;

  const ballPos = freshPerception.ball.position;
  const ballVel = freshPerception.ball.velocity;
  const selfPos = freshPerception.self.position;
  const selfVel = freshPerception.self.velocity;
  const goalPos = freshPerception.hoops.attackGoalPos;
  const defendGoalPos = freshPerception.hoops.defendGoalPos;
  const profile = freshPerception.ballPhysicsProfile;

  // Stream & finishing context
  const isFinishing = freshPerception.stream.isFinishingZone || freshPerception.stream.isAtStreamHead;
  // Dribble climb suppresses strikes ONLY for low-to-moderate aggression (< 0.65).
  // High aggression bots (>= 0.65) actively seek out strikes and volleys up the channel!
  const inDribbleClimb = (agg < 0.65) && !isFinishing && (
    bot.strategy === STRATEGY.STREAM_DRIBBLE ||
    (bot.strategy === STRATEGY.MULTI_STAGE_ATTACK && bot.attackStage === ATTACK_STAGE.STREAM_ADVANCE)
  );

  // ═══ DYNAMIC ARRIVAL & REACH PREDICTION ═══
  const ticksToArrive = freshPerception.ballIntercept.ticksToArrive;
  const interceptPos = freshPerception.ballIntercept.position;
  const dtArrive = ticksToArrive * (1 / 60);
  const athFutureX = selfPos.x + selfVel.x * dtArrive;
  const athFutureZ = selfPos.z + selfVel.z * dtArrive;
  const distAtArrival = Math.hypot(interceptPos.x - athFutureX, interceptPos.z - athFutureZ);
  const arrivalRelY = interceptPos.y - selfPos.y;
  const aimAccuracy = params.aimAccuracy ?? 0.75;
  const distToGoalZ = Math.abs(goalPos.z - selfPos.z);
  const distToDefendZ = Math.abs(selfPos.z - defendGoalPos.z);

  // Ball-size adaptive reaches scaled by aggressiveness
  const strikeReach = profile.strikeReach;
  const kickReach = strikeReach * 0.85;
  const spikeReach = strikeReach * (1.05 + (agg - 0.5) * 0.25);
  const liveStrikeReach = strikeReach * (0.75 + (agg - 0.5) * 0.35);
  const liveSpikeReach = strikeReach * (0.80 + (agg - 0.5) * 0.30);

  // ═══ 1. CANDIDATE: SPIKE (Dominant aerial smash on high balls in attacking half / stream heads) ═══
  const ballRelAthY = ballPos.y - selfPos.y;
  const ballPeakY = freshPerception.ball.peakY ?? (ballPos.y + (ballVel.y > 0 ? (ballVel.y * ballVel.y) / (2 * 12.0) : 0));
  const isHighBall = ballRelAthY >= 0.55 || ballPeakY >= (selfPos.y + 1.2) || ballPos.y >= 2.0;

  // Finishing range spike eligibility:
  // Spikes angle -18° downward, so they can be attempted from finishing range (distToGoalZ <= 18.0m or stream head)
  // or aggressive bots from up to 22m out!
  // DEFENSIVE HOOP BLOCK: when guarding the defending rim aperture (|Z| >= 32m, distToDefendZ <= 10m),
  // high arc shots approaching the hoop mouth can be blocked/swatted down!
  const isDefendingRim = distToDefendZ <= 10.0 && Math.abs(selfPos.z) >= 32.0 && freshPerception.threat > 0.25;
  const maxSpikeDistZ = 16.0 + (agg - 0.5) * 12.0;
  const canSpikeHere = (distToDefendZ > 12.0 && (distToGoalZ <= maxSpikeDistZ || isFinishing)) || isDefendingRim;

  const liveDistXZ = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);
  const canSpikePrediction = canSpikeHere && isHighBall &&
    (ticksToArrive >= 16 && ticksToArrive <= 48) && distAtArrival <= spikeReach &&
    (arrivalRelY >= 0.6 && arrivalRelY <= 3.2);
  const canSpikeImmediate = canSpikeHere && isHighBall &&
    (liveDistXZ <= liveSpikeReach) && (ballRelAthY >= 0.55 && ballRelAthY <= 3.2);

  if (canSpikePrediction || canSpikeImmediate) {
    // If athlete is on the ground and ball is high:
    if (ballRelAthY > 1.1) {
      if (freshPerception.self.grounded) {
        if (tick - bot.lastJumpTick < bot.jumpCooldownTicks) {
          // Cannot jump to reach high ball; don't swing on ground and whiff
          return;
        }
        slot.jumpQueued = true;
        bot.lastJumpTick = tick;
        if (ticksToArrive > 24) return; // wait for jump elevation before starting arm swing
      } else if (ticksToArrive > 36) {
        // Airborne but ball is still too far away; wait for closer approach
        return;
      }
    }

    const spikeAccuracy = (params.spikeAccuracy ?? 0.85) * (0.8 + agg * 0.25);
    if (bot.rng() < spikeAccuracy) {
      slot.spikeQueued = true;
      bot.lastStrikeTick = tick;
      bot.lastStrikeKind = 'spike';
      bot.stats.strikeAttempts++;
      if (isDefendingRim) {
        bot.stats.hoopBlocks = (bot.stats.hoopBlocks || 0) + 1;
      }

      const aimYaw = isFinishing
        ? computeStreamHeadAimYaw(selfPos, goalPos)
        : computeClearanceAimYaw(selfPos, goalPos, defendGoalPos);
      slot.aimYaw = aimYaw;
      slot.cameraYaw = aimYaw;
      slot.hasAim = true;
      return;
    }
  }

  // ═══ 2. CANDIDATE: VOLLEY (elevates +46° at 24.5 m/s to score or clear) ═══
  const isVolleyReachable = arrivalRelY >= -0.2 && arrivalRelY <= 3.0;
  if (!inDribbleClimb && ticksToArrive >= 8 && ticksToArrive <= 26 && distAtArrival <= strikeReach && isVolleyReachable) {
    const isRocketingUp = freshPerception.ball.isRising && freshPerception.ball.velocity.y > 2.5 && ballRelAthY < 0.8;
    if (!isRocketingUp) {
      // Coordinate Jump-Volley when finishing from stream head or high ball
      if (ballRelAthY > 1.2) {
        if (freshPerception.self.grounded) {
          if (tick - bot.lastJumpTick < bot.jumpCooldownTicks) {
            return; // Cannot jump to reach high ball
          }
          slot.jumpQueued = true;
          bot.lastJumpTick = tick;
          if (ticksToArrive > 16) return; // wait to reach apex elevation
        }
      }

      if (bot.rng() < aimAccuracy) {
        slot.volleyQueued = true;
        bot.lastStrikeTick = tick;
        bot.lastStrikeKind = 'volley';
        bot.stats.strikeAttempts++;
        if (isDefendingRim) {
          bot.stats.hoopBlocks = (bot.stats.hoopBlocks || 0) + 1;
        }

        const aimYaw = isFinishing
          ? computeStreamHeadAimYaw(selfPos, goalPos)
          : computeClearanceAimYaw(selfPos, goalPos, defendGoalPos);
        slot.aimYaw = aimYaw;
        slot.cameraYaw = aimYaw;
        slot.hasAim = true;
        return;
      }
    }
  }

  // ═══ 3. CANDIDATE: KICK (East button contextual kick for low balls) ═══
  const isKickReachable = arrivalRelY <= 0.45 && arrivalRelY >= -0.6;
  if (!inDribbleClimb && ticksToArrive >= 8 && ticksToArrive <= 16 && distAtArrival <= kickReach && isKickReachable) {
    if (bot.rng() < aimAccuracy) {
      slot.volleyQueued = true; // East button triggers kick for low balls
      bot.lastStrikeTick = tick;
      bot.lastStrikeKind = 'kick';
      bot.stats.strikeAttempts++;

      const aimYaw = isFinishing
        ? computeStreamHeadAimYaw(selfPos, goalPos)
        : computeClearanceAimYaw(selfPos, goalPos, defendGoalPos);
      slot.aimYaw = aimYaw;
      slot.cameraYaw = aimYaw;
      slot.hasAim = true;
      return;
    }
  }

  // ═══ 4. INCOMING BALL INTERCEPT (Physics relative-velocity closest approach) ═══
  const rx = ballPos.x - selfPos.x;
  const ry = ballPos.y - (selfPos.y + 0.9);
  const rz = ballPos.z - selfPos.z;
  const vx = ballVel.x - selfVel.x;
  const vy = ballVel.y - selfVel.y;
  const vz = ballVel.z - selfVel.z;
  const vRelSq = vx * vx + vy * vy + vz * vz;

  if (!inDribbleClimb && vRelSq > 1.0) {
    const rDotV = rx * vx + ry * vy + rz * vz;
    if (rDotV < 0) { // closing in
      const tClose = -rDotV / vRelSq;
      if (tClose >= 0.08 && tClose <= 0.45) { // 5 to 27 ticks
        const minX = rx + vx * tClose;
        const minY = ry + vy * tClose;
        const minZ = rz + vz * tClose;
        const minDist = Math.hypot(minX, minY, minZ);

        if (minDist <= strikeReach && Math.abs(minY) <= 1.5) {
          if (bot.rng() < aimAccuracy) {
            slot.volleyQueued = true;
            bot.lastStrikeTick = tick;
            bot.stats.strikeAttempts++;
            const aimYaw = isFinishing
              ? computeStreamHeadAimYaw(selfPos, goalPos)
              : computeClearanceAimYaw(selfPos, goalPos, defendGoalPos);
            slot.aimYaw = aimYaw;
            slot.cameraYaw = aimYaw;
            slot.hasAim = true;
            return;
          }
        }
      }
    }
  }

  // ═══ 5. IMMEDIATE CLOSE-RANGE STRIKE ═══
  const isRocketingUp = freshPerception.ball.isRising && freshPerception.ball.velocity.y > 2.5 && ballRelAthY < 0.8;
  if (!isRocketingUp && liveDistXZ <= liveStrikeReach && ballRelAthY >= -0.4 && ballRelAthY <= 2.8) {
    if (!inDribbleClimb) {
      const isSpike = canSpikeHere && ballRelAthY >= 0.55;
      if (isSpike) {
        slot.spikeQueued = true;
        bot.lastStrikeKind = 'spike';
        if (freshPerception.self.grounded && ballRelAthY > 1.1 && (tick - bot.lastJumpTick >= bot.jumpCooldownTicks)) {
          slot.jumpQueued = true;
          bot.lastJumpTick = tick;
        }
      } else {
        slot.volleyQueued = true;
        bot.lastStrikeKind = 'volley';
        if (freshPerception.self.grounded && ballRelAthY > 1.4 && (tick - bot.lastJumpTick >= bot.jumpCooldownTicks)) {
          slot.jumpQueued = true;
          bot.lastJumpTick = tick;
        }
      }
      bot.lastStrikeTick = tick;
      bot.stats.strikeAttempts++;
      const aimYaw = isFinishing
        ? computeStreamHeadAimYaw(selfPos, goalPos)
        : computeClearanceAimYaw(selfPos, goalPos, defendGoalPos);
      slot.aimYaw = aimYaw;
      slot.cameraYaw = aimYaw;
      slot.hasAim = true;
      return;
    }
  }

  // ═══ 6. EMERGENCY DIVE SAVE (Strictly restricted to goal-line saves in defending mouth) ═══
  const diveCooldown = params.diveCooldownTicks ?? 180; // 3.0s cooldown
  if (freshPerception.self.grounded && !freshPerception.self.isRecovering && (tick - bot.lastDiveTick >= diveCooldown)) {
    const isDefSouth = defendGoalPos.z > 0;
    const landingX = freshPerception.ballIntercept.position.x;
    const landingZ = freshPerception.ballIntercept.position.z;

    // Must be in defending goal mouth (|X| <= 8m, near net)
    const inGoalMouth = Math.abs(landingX) <= 8.0 && (
      isDefSouth ? (landingZ >= 24.0 && landingZ <= 39.0) : (landingZ <= -24.0 && landingZ >= -39.0)
    );

    if (inGoalMouth && freshPerception.threat > 0.35 && !freshPerception.ballIntercept.reachable) {
      const interceptTicks = freshPerception.ballIntercept.ticksToArrive;
      // Ball must be hitting the floor imminently (6 to 22 ticks)
      if (interceptTicks >= 6 && interceptTicks <= 22) {
        const distToLanding = Math.hypot(landingX - selfPos.x, landingZ - selfPos.z);
        const diveMin = params.diveDistMin ?? 2.0;
        const diveMax = params.diveDistMax ?? 4.8;
        if (distToLanding >= diveMin && distToLanding <= diveMax) {
          const diveYaw = computeAimYaw(selfPos, freshPerception.ballIntercept.position);
          const diveDirX = Math.sin(diveYaw);
          const diveDirZ = Math.cos(diveYaw);
          const vecToDefend = freshPerception.hoops.vecToDefendGoal;
          const dotDiveDefend = diveDirX * vecToDefend.x + diveDirZ * vecToDefend.z;

          // Strictly diving away from or lateral to defending net (dot <= -0.25)
          if (dotDiveDefend <= -0.25) {
            const diveAccuracy = (params.diveAccuracy ?? 0.5) * (0.7 + (bot.currentAggressiveness ?? 0.6) * 0.3);
            if (bot.rng() < diveAccuracy) {
              bot.lastDiveTick = tick;
              slot.diveQueued = true;
              slot.aimYaw = diveYaw;
              slot.cameraYaw = diveYaw;
              slot.hasAim = true;
              slot.moveWorld.set(diveDirX, 0, diveDirZ);
              slot.moveX = slot.moveWorld.x;
              slot.moveZ = slot.moveWorld.z;
            }
          }
        }
      }
    }
  }
}
