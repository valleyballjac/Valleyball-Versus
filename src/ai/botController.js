import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import {
  buildPerception,
  createPerception,
  projectBallPosition,
  sampleTrajectoryAtTick,
  getCourtFloorY,
} from './botPerception.js';
import {
  steerToward,
  steerIdle,
  computeAimYaw,
  steerGoalSideArc,
  steerGoalAlignedApproach,
  shouldExecuteCut,
} from './botSteering.js';

/**
 * AI BOT CONTROLLER — v0.4.0 Unified Tactical, Ballistic & 2v2 Role Planner
 *
 * Drives synthetic input into an athlete's input slot, making it
 * indistinguishable from a human controller. The bot reads world state
 * through the perception layer and writes to the same moveWorld / action
 * queues that a gamepad would.
 *
 * LAW 6 — All timing in integer ticks. No Date.now(), no Math.random().
 * LAW 1 — Never writes physics state directly; only writes input.
 */

// ═══ STRATEGY STATES ═══
export const STRATEGY = {
  CHASE:              0,  // Ball is far, sprint toward intercept pocket
  POSITION:           1,  // Ball approaching, maneuver to optimal strike pocket
  STRIKE:             2,  // Active strike windup or immediate strike step-in
  RECOVER:            3,  // Knocked down, wait for recovery
  DEFEND:             4,  // Ball heading toward own goal, guard rim or clear
  STREAM_DRIBBLE:     5,  // Controlled advance up lateral stream channel
  MULTI_STAGE_ATTACK: 6,  // Coordinated multi-touch set, stream-head & finish
};

// ═══ ATTACK SEQUENCE DEFINITIONS ═══
export const ATTACK_STAGE = {
  NONE:           0,
  RETRIEVE:       1,
  STREAM_ADVANCE: 2,
  SETUP_POP:      3,
  AERIAL_FINISH:  4,
};

export const ATTACK_TYPE = {
  NONE:                   0,
  FAST_BREAK_2_STAGE:     2,
  STREAM_RUN_3_STAGE:     3,
  SET_AND_SPIKE_4_STAGE:  4,
};

// ═══ DIFFICULTY TUNING DEFAULTS (fallback if not in TUNING.ai) ═══
const DIFFICULTY_DEFAULTS = {
  easy: {
    reactionDelayTicks: 12,
    aimAccuracy: 0.50,
    interceptLeadFactor: 0.65,
    strikeTimingJitter: 4,
    sprintUsage: 0.50,
    diveAccuracy: 0.25,
    diveCooldownTicks: 260,
    spikeAccuracy: 0.40,
    defensiveAwareness: 0.35,
    strategyUpdateInterval: 10,
    positionOffset: 0.45,
    strikeRange: 2.1,
    strikeHeightMin: -0.5,
    strikeHeightMax: 3.2,
    chaseToPositionDist: 10.0,
    defenseDepth: 0.4,
    arriveRadiusChase: 1.2,
    arriveRadiusPosition: 0.7,
    arriveRadiusStrike: 0.3,
    jumpHeightThreshold: 2.0,
    diveDistMin: 1.8,
    diveDistMax: 4.2,
  },
  medium: {
    reactionDelayTicks: 6,
    aimAccuracy: 0.80,
    interceptLeadFactor: 0.88,
    strikeTimingJitter: 1,
    sprintUsage: 0.80,
    diveAccuracy: 0.55,
    diveCooldownTicks: 190,
    spikeAccuracy: 0.70,
    defensiveAwareness: 0.65,
    strategyUpdateInterval: 6,
    positionOffset: 0.35,
    strikeRange: 2.0,
    strikeHeightMin: -0.5,
    strikeHeightMax: 3.2,
    chaseToPositionDist: 11.0,
    defenseDepth: 0.45,
    arriveRadiusChase: 1.0,
    arriveRadiusPosition: 0.6,
    arriveRadiusStrike: 0.25,
    jumpHeightThreshold: 1.8,
    diveDistMin: 1.8,
    diveDistMax: 4.5,
  },
  hard: {
    reactionDelayTicks: 1,
    aimAccuracy: 0.96,
    interceptLeadFactor: 1.0,
    strikeTimingJitter: 0,
    sprintUsage: 0.95,
    diveAccuracy: 0.85,
    diveCooldownTicks: 150,
    spikeAccuracy: 0.90,
    defensiveAwareness: 0.90,
    strategyUpdateInterval: 4,
    positionOffset: 0.30,
    strikeRange: 2.0,
    strikeHeightMin: -0.5,
    strikeHeightMax: 3.2,
    chaseToPositionDist: 12.0,
    defenseDepth: 0.5,
    arriveRadiusChase: 0.9,
    arriveRadiusPosition: 0.5,
    arriveRadiusStrike: 0.2,
    jumpHeightThreshold: 1.7,
    diveDistMin: 1.75,
    diveDistMax: 4.7,
  },
};

// ═══ SCRATCH VECTORS (allocation-free hot path) ═══
const _interceptTarget = new THREE.Vector3();
const _defenseTarget = new THREE.Vector3();
const _playTarget = new THREE.Vector3();
const _toBall = new THREE.Vector3();
const _ballAtSweet = new THREE.Vector3();
const _velAtSweet = new THREE.Vector3();
const _ballAtSpike = new THREE.Vector3();
const _velAtSpike = new THREE.Vector3();

const HOOP_CENTER_Y = 10.0;
const HOOP_RADIUS = 4.667;
const HOOP_Z_OFFSETS = [-3.3, -2.2, -1.1, 0.0, 1.1, 2.2, 3.3];

function wrapAngle(a) {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

// ═══ SEEDED PRNG (LAW 6 determinism) ═══
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

    // Tactical & Strike Synchronization State
    lastStrikeTick: -Infinity,
    lastStrikeKind: 'volley',
    lastStrikeSweetTick: 15,
    lastStrikeAimYaw: NaN,      // aim held through the open swing window
    strikeCooldownTicks: 24,
    lastDiveTick: -Infinity,
    lastJumpTick: -Infinity,
    jumpCooldownTicks: 90,
    pendingJumpTick: -Infinity, // scheduled jump during 42-tick spike windup
    pendingSpikeTick: -Infinity,
    lastCutTick: -Infinity,
    cutCooldownTicks: 70,
    lastSlideTick: -Infinity,
    slideStartTick: -Infinity,
    slideUntilTick: -Infinity,
    slideMode: 'none',
    selfSetUntilTick: -Infinity,
    teammatePos: null,
    hasActiveTeammate: false,

    // Statistics
    stats: {
      strikeAttempts: 0,
      chaseTime: 0,
      positionTime: 0,
      defendTime: 0,
      recoverTime: 0,
      cutCount: 0,
      hoopBlocks: 0,
      slides: 0,
      slideTackles: 0,
    },

    overrideParams: null,
  };
}

export function setBotDifficulty(bot, difficulty) {
  if (bot && DIFFICULTY_DEFAULTS[difficulty]) {
    bot.difficulty = difficulty;
  }
}

export function setBotAggressiveness(bot, aggressiveness) {
  if (bot && Number.isFinite(aggressiveness)) {
    bot.baseAggressiveness = Math.max(0.1, Math.min(1.0, aggressiveness));
    bot.currentAggressiveness = bot.baseAggressiveness;
  }
}

/**
 * Computes dynamic in-match aggressiveness based on score differential and time remaining.
 */
export function computeDynamicAggressiveness(bot, matchState, perception) {
  if (!matchState) return bot.baseAggressiveness ?? 0.60;

  const isHome = perception?.hoops?.isHome ?? false;
  const myScore = isHome ? (matchState.scoreHome || 0) : (matchState.scoreAway || 0);
  const oppScore = isHome ? (matchState.scoreAway || 0) : (matchState.scoreHome || 0);
  const scoreDelta = myScore - oppScore;

  let mod = 0;
  if (scoreDelta < 0) {
    mod += -scoreDelta * 0.12;
    if (matchState.ticksRemaining <= 3600 && matchState.ticksRemaining > 0) {
      const timeFactor = 1.0 - (matchState.ticksRemaining / 3600);
      mod += timeFactor * 0.15;
    }
  } else if (scoreDelta > 0) {
    mod -= scoreDelta * 0.08;
  }

  return Math.max(0.10, Math.min(1.0, (bot.baseAggressiveness ?? 0.60) + mod));
}

export function getDifficultyParams(bot) {
  if (bot.overrideParams) return bot.overrideParams;
  const level = bot.difficulty;
  const tuningAi = TUNING.ai;
  if (tuningAi && tuningAi[level]) {
    return tuningAi[level];
  }
  return DIFFICULTY_DEFAULTS[level] || DIFFICULTY_DEFAULTS.medium;
}

// ═══════════════════════════════════════════════════════════════════════════
// EAST-BUTTON CONTEXTUAL STRIKE SYNCHRONIZATION & BALLISTIC HOOP SOLVER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mirrors `eastKind()` in `src/mechanics/strikes.js:439-463` verbatim so the bot knows
 * with 100% certainty whether pressing `volleyQueued` (East button) on THIS tick will
 * latch `KIND_VOLLEY` (15-tick hands/forearms) or `KIND_KICK` (8-tick feet/calves).
 */
function predictEastKindAtPress(athlete, selfPos, ballPos) {
  const strikeCfg = TUNING.strike;
  const contextRadius = strikeCfg?.contextRadius ?? 4.0;
  const distXZ = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);
  if (distXZ > contextRadius) {
    return 'volley';
  }

  const pelvisTarget = athlete?.animTarget?.targets?.get?.('pelvis');
  const pelvisY = pelvisTarget ? pelvisTarget.currPos.y : (selfPos.y + 0.467);
  const rel = ballPos.y - pelvisY;
  const kickBelowHips = strikeCfg?.kickBelowHips ?? -0.10;
  const kickHysteresis = strikeCfg?.kickHysteresis ?? 0.05;
  const lastEastKind = athlete?.strikeState?.lastEastKind ?? 0; // 0=NONE, 1=VOLLEY, 3=KICK
  const inBand = Math.abs(rel - kickBelowHips) <= kickHysteresis;
  if (inBand && lastEastKind !== 0) {
    return lastEastKind === 3 ? 'kick' : 'volley';
  }
  return rel < kickBelowHips ? 'kick' : 'volley';
}

/**
 * Computes the exact `aimYaw` needed so `strikes.js:808`'s additive impulse
 * (`v_exit = v_ball + vH_raw * [sin(yaw), cos(yaw)]`) cancels the ball's transverse
 * velocity and launches the ball straight along the horizontal ray `fromPos -> targetPos`.
 */
function computeCompensatedAimAndSpeed(fromPos, targetX, targetZ, vHRaw, ballVel) {
  const dx = targetX - fromPos.x;
  const dz = targetZ - fromPos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4) {
    return { yaw: 0, effVH: vHRaw * 0.91 };
  }
  const ux = dx / dist;
  const uz = dz / dist;
  if (!ballVel) {
    return { yaw: Math.atan2(ux, uz), effVH: vHRaw * 0.91 };
  }
  const vbx = ballVel.x || 0;
  const vbz = ballVel.z || 0;
  const vAlong = vbx * ux + vbz * uz;
  const vPerpX = vbx - vAlong * ux;
  const vPerpZ = vbz - vAlong * uz;
  const vPerpMag = Math.hypot(vPerpX, vPerpZ);
  const maxCancel = vHRaw * 0.84;
  const cancelScale = vPerpMag > maxCancel && vPerpMag > 1e-4 ? (maxCancel / vPerpMag) : 1.0;
  const dvPerpX = -vPerpX * cancelScale;
  const dvPerpZ = -vPerpZ * cancelScale;
  const dvFwd = Math.sqrt(Math.max(1.0, vHRaw * vHRaw - (dvPerpX * dvPerpX + dvPerpZ * dvPerpZ)));
  const dvX = dvPerpX + ux * dvFwd;
  const dvZ = dvPerpZ + uz * dvFwd;
  const effVH = Math.max(4.5, (vAlong + dvFwd) * 0.91);
  return { yaw: Math.atan2(dvX, dvZ), effVH };
}

/**
 * Evaluates all three offensive playbooks from a given contact position and strike kind:
 *   1. Direct / 1-Bounce / Side-Wall-Bank Ballistic Hoop Shot across the X = 0 aperture (Y = 10, Z = ±40, R = 4.667m)
 *   2. 2-Touch Set & Finish (or Cross-Court 2v2 Teammate Pass) into an elevated scoring pocket
 *   3. Wing Transition Doctrine (breaking midfield ping-pong by routing deep touches up the open wing)
 *
 * Writes the chosen 3D aim target into `outTarget` and returns the optimal world `aimYaw` in radians.
 */
function solveOffensiveAimAndTarget(
  bot,
  contactPos,
  kind,
  perception,
  params,
  outTarget = _playTarget,
  contactBallVel = null,
  applyJitter = false
) {
  const attackGoalPos = perception.hoops.attackGoalPos;
  const defendGoalPos = perception.hoops.defendGoalPos;
  const oppPos = perception.opponent.position;
  const bVel = contactBallVel || perception.ball.velocity;
  const signAttackZ = Math.sign(attackGoalPos.z - defendGoalPos.z) || -1;
  const distToGoalZ = Math.abs(attackGoalPos.z - contactPos.z);
  const absX = Math.abs(contactPos.x);
  const dist3DHoop = Math.hypot(contactPos.x, attackGoalPos.z - contactPos.z);
  const isEasy = bot.difficulty === 'easy';
  const isHard = bot.difficulty === 'hard';

  // Exact `TUNING.strike` launch speeds & angles (`strikes.js:808` applies additive impulse onto `bVel`)
  const speed = kind === 'spike' ? 22.0 : (kind === 'kick' ? 14.5 : 24.5);
  const elevDeg = kind === 'spike' ? -18.0 : (kind === 'kick' ? 55.0 : 46.0);
  const elevRad = (elevDeg * Math.PI) / 180;
  const vHRaw = speed * Math.cos(elevRad);
  const vYRaw = speed * Math.sin(elevRad);
  const effVY = ((bVel ? (bVel.y || 0) * 0.55 : 0) + vYRaw) * 0.95;
  const gravityY = Math.abs(TUNING?.physics?.gravityY ?? -12.0);

  // ═══ PLAYBOOK 1: RANGE- & ANGLE-AWARE BALLISTIC HOOP SHOT ACROSS X = 0 ═══
  // The goal hoops sit in the X = 0 plane facing East/West (`±X`) with a 0.333m rim tube at Z = ±35.33 / ±44.67m.
  // At long range (`distToGoalZ > 26m`), Volleys plunge downward at ~39° through the upper half of the ring,
  // so `|X| >= 1.35m` clears the rim cleanly; closer flatter shots require `max(1.5, distToGoalZ * 0.11)`.
  const minLateralXForVolley = distToGoalZ > 26.0 ? 1.35 : Math.max(1.5, distToGoalZ * 0.11);
  const canKickReachHoop = kind === 'kick' && dist3DHoop <= 15.8 && absX >= Math.max(1.2, distToGoalZ * 0.13);
  const canSpikeReachHoop = kind === 'spike' && distToGoalZ <= 35.0 && absX >= Math.max(1.15, distToGoalZ * 0.09);
  const canVolleyHaveAngle = kind === 'volley' && absX >= minLateralXForVolley && distToGoalZ <= 46.5;

  if (canKickReachHoop || canSpikeReachHoop || canVolleyHaveAngle) {
    const crossTargetX = 0.0;
    let bestHoopZ = attackGoalPos.z;
    let bestHoopErr = Infinity;
    let bestYDirect = HOOP_CENTER_Y;
    let bestYaw = 0;

    const offsetsCount = isEasy ? 1 : HOOP_Z_OFFSETS.length;
    for (let i = 0; i < offsetsCount; i++) {
      const zOff = isEasy ? 0.0 : HOOP_Z_OFFSETS[i];
      const candZ = attackGoalPos.z + zOff;
      const dx = crossTargetX - contactPos.x;
      const dz = candZ - contactPos.z;
      const distXZ = Math.hypot(dx, dz);
      if (distXZ < 1.0) continue;

      const comp = computeCompensatedAimAndSpeed(contactPos, crossTargetX, candZ, vHRaw, bVel);
      const tCross = distXZ / comp.effVH;
      const yDirect = contactPos.y + effVY * tCross - 0.5 * gravityY * tCross * tCross;
      // If yDirect hits the rising goal plateau/mound (Y ~ 4.5..9.8m), a 1-bounce skip enters the hoop!
      const effectiveY = (kind === 'spike' && yDirect < 7.5 && distXZ <= 30.0)
        ? 9.4
        : ((yDirect < 5.8 && yDirect >= 1.5 && distXZ <= 38.0) ? 8.6 : yDirect);
      const radialErrDirect = Math.hypot(effectiveY - HOOP_CENTER_Y, zOff * 0.85);

      if (radialErrDirect < bestHoopErr) {
        bestHoopErr = radialErrDirect;
        bestHoopZ = candZ;
        bestYDirect = effectiveY;
        bestYaw = comp.yaw;
      }
    }

    // Strict top-bar check (`14.67m` aperture top minus ball clearance = `14.15m`):
    // Mid-close `24.5 m/s` Volleys (`11m..29m`) peak at `Y = 15.5m..19.2m` and fly over the hoop!
    const volleyOvershootsTopBar = (kind === 'volley') && (bestYDirect > 14.15 || bestYDirect < 5.4);
    if (!volleyOvershootsTopBar) {
      outTarget.set(crossTargetX, HOOP_CENTER_Y, bestHoopZ);
      return applyAimJitterAndSafety(bot, contactPos, bestYaw, defendGoalPos, attackGoalPos, params, applyJitter);
    }

    // 1B: Close plateau slice (`distToGoalZ <= 8.5m, absX >= 2.0m`): cross near-rim early on the rising arc!
    if (kind === 'volley' && absX >= 2.0 && distToGoalZ <= 8.5) {
      const nearRimZ = attackGoalPos.z - signAttackZ * 2.8;
      const compNear = computeCompensatedAimAndSpeed(contactPos, 0.0, nearRimZ, vHRaw, bVel);
      const tNear = Math.hypot(contactPos.x, nearRimZ - contactPos.z) / compNear.effVH;
      const yNear = contactPos.y + effVY * tNear - 0.5 * gravityY * tNear * tNear;
      if (yNear <= 14.15 && yNear >= 5.6) {
        outTarget.set(0.0, HOOP_CENTER_Y, nearRimZ);
        return applyAimJitterAndSafety(bot, contactPos, compNear.yaw, defendGoalPos, attackGoalPos, params, applyJitter);
      }
    }

    // 1C: 1-Wall Side-Bank Shot (`distToGoalZ = 9.5..30m, absX >= 2.8m`):
    // When a direct Volley would soar over the `14.67m` bar (`bestYDirect > 14.15m`), bank off the `X = ±16.0m`
    // side wall (`0.88` restitution)! Stretching the path to `28.5m..42.5m` brings the ball down onto its descending
    // arc (`Y = 8.5m..13.8m`) entering `(X = 0, Z = ±40)` at a wide 45° angle!
    if (!isEasy && kind === 'volley' && absX >= 2.8 && distToGoalZ >= 9.5 && distToGoalZ <= 30.0) {
      const wallSign = contactPos.x >= 0 ? 1 : -1;
      const wallX = wallSign * 16.0;
      const leg1X = 16.0 - absX;
      const leg2X = 16.0 / 0.88;
      const fracToWall = leg1X / (leg1X + leg2X);
      const wallZ = contactPos.z + (attackGoalPos.z - contactPos.z) * fracToWall;
      const d1 = Math.hypot(leg1X, wallZ - contactPos.z);
      const d2 = Math.hypot(16.0, attackGoalPos.z - wallZ);
      const totalBankDist = d1 + d2 / 0.88;
      if (totalBankDist >= 28.5 && totalBankDist <= 42.5) {
        const compBank = computeCompensatedAimAndSpeed(contactPos, wallX, wallZ, vHRaw, bVel);
        const tBank = totalBankDist / compBank.effVH;
        const yBank = contactPos.y + effVY * tBank - 0.5 * gravityY * tBank * tBank;
        if (yBank >= 6.2 && yBank <= 14.0) {
          outTarget.set(wallX, HOOP_CENTER_Y, wallZ);
          return applyAimJitterAndSafety(bot, contactPos, compBank.yaw, defendGoalPos, attackGoalPos, params, applyJitter);
        }
      }
    }
  }

  // Close-range dead-center finish (`|X| < 1.6m, distToGoalZ <= 9.5m`):
  // Angle across X = 0 inside the hoop radius so `testHoopCrossing` registers a clean crossing!
  if (distToGoalZ <= 9.5 && (kind !== 'volley' || absX >= 1.2)) {
    const crossDir = contactPos.x >= 0 ? -1 : 1;
    const tx = crossDir * 1.6;
    outTarget.set(tx, HOOP_CENTER_Y, attackGoalPos.z);
    const compClose = computeCompensatedAimAndSpeed(contactPos, tx, attackGoalPos.z, vHRaw, bVel);
    return applyAimJitterAndSafety(bot, contactPos, compClose.yaw, defendGoalPos, attackGoalPos, params, applyJitter);
  }

  // ═══ PLAYBOOK 2: 2v2 TEAMMATE PASS OR 2-TOUCH SELF-SET INTO FLANK STREAM HEAD ═══
  // 2A: If an active 2v2 teammate is in an advanced flank / stream-head position, pass to them!
  if (!isEasy && bot.hasActiveTeammate && bot.teammatePos) {
    const mate = bot.teammatePos;
    const mateDistToGoalZ = Math.abs(attackGoalPos.z - mate.z);
    const mateOnFlank = Math.abs(mate.x) >= 3.5;
    const mateAhead = mateDistToGoalZ < distToGoalZ + 4.5 && mateDistToGoalZ <= 34.0;
    const distToMate = Math.hypot(mate.x - contactPos.x, mate.z - contactPos.z);
    const maxPassDist = kind === 'kick' ? 16.5 : 32.0;
    if (mateOnFlank && mateAhead && distToMate >= 4.5 && distToMate <= maxPassDist) {
      const passX = Math.max(-12.5, Math.min(12.5, mate.x));
      const passZ = Math.max(-38.0, Math.min(38.0, mate.z + signAttackZ * 3.0));
      outTarget.set(passX, getCourtFloorY(passX, passZ) + 1.6, passZ);
      const compPass = computeCompensatedAimAndSpeed(contactPos, passX, passZ, vHRaw, bVel);
      return applyAimJitterAndSafety(bot, contactPos, compPass.yaw, defendGoalPos, attackGoalPos, params, applyJitter);
    }
  }

  // 2B: Purposeful Kick Self-Set (+55° loft, ~11-14m horizontal carry, +5.9m vertical pop):
  // Loft diagonally toward the attacking stream-head scoring pocket (`X = ±8.5..11.0m, Z = ±36..39m`)!
  if (kind === 'kick') {
    const preferredFlankSign = chooseOpenFlankSign(contactPos, oppPos, bot, defendGoalPos);
    const setX = preferredFlankSign * (distToGoalZ <= 22.0 ? 8.5 : 10.5);
    const carryZ = Math.min(14.5, Math.max(9.5, distToGoalZ * 0.65));
    const setZ = Math.max(-39.0, Math.min(39.0, contactPos.z + signAttackZ * carryZ));
    outTarget.set(setX, getCourtFloorY(setX, setZ) + 2.2, setZ);
    const compSet = computeCompensatedAimAndSpeed(contactPos, setX, setZ, vHRaw, bVel);
    return applyAimJitterAndSafety(bot, contactPos, compSet.yaw, defendGoalPos, attackGoalPos, params, applyJitter);
  }

  // ═══ PLAYBOOK 3: WING TRANSITION & FLANK SETUP DOCTRINE ═══
  // Route deep or narrow-angle balls onto the wide-angle attacking stream head (`X = ±10.5..12.2m`)
  // where the East-West hoop presents its full 9.33m aperture for a high-percentage 2nd-touch Kick/Spike/Volley!
  const flankSign = chooseOpenFlankSign(contactPos, oppPos, bot, defendGoalPos);
  if (distToGoalZ <= 42.0) {
    const setupX = flankSign * (isHard ? 11.2 : 9.8);
    const setupZ = attackGoalPos.z - signAttackZ * 2.5;
    outTarget.set(setupX, getCourtFloorY(setupX, setupZ) + 1.8, setupZ);
    const compSetup = computeCompensatedAimAndSpeed(contactPos, setupX, setupZ, vHRaw, bVel);
    return applyAimJitterAndSafety(bot, contactPos, compSetup.yaw, defendGoalPos, attackGoalPos, params, applyJitter);
  }

  const wingX = flankSign * (isHard ? 11.2 : 9.8);
  const advanceZ = Math.max(-32.0, Math.min(32.0, contactPos.z + signAttackZ * 34.0));
  outTarget.set(wingX, getCourtFloorY(wingX, advanceZ) + 1.5, advanceZ);
  const compWing = computeCompensatedAimAndSpeed(contactPos, wingX, advanceZ, vHRaw, bVel);
  return applyAimJitterAndSafety(bot, contactPos, compWing.yaw, defendGoalPos, attackGoalPos, params, applyJitter);
}

/**
 * Picks the lateral stream flank (-1 West vs +1 East) with the most open space away from the opponent.
 */
function chooseOpenFlankSign(contactPos, oppPos, bot, defendGoalPos = null) {
  // Never cross X = 0 when clearing from our own defending third (prevents accidental own-goal crossings!)
  if (defendGoalPos && Math.abs(contactPos.z - defendGoalPos.z) <= 22.0) {
    return contactPos.x >= 0 ? 1 : -1;
  }
  if (bot.hasActiveTeammate && bot.teammatePos && Math.abs(bot.teammatePos.x) >= 4.0) {
    return Math.sign(bot.teammatePos.x);
  }
  if (Math.abs(contactPos.x) >= 2.0) {
    return Math.sign(contactPos.x);
  }
  if (oppPos && Math.abs(oppPos.x) >= 1.5) {
    return -Math.sign(oppPos.x);
  }
  return (bot.slotIndex % 2 === 0) ? 1 : -1;
}

/**
 * Applies optional press-time difficulty aim jitter and enforces a hard anti-own-goal safety clamp.
 * `applyJitter` is ONLY true on the actual strike press edge so locomotion pocket steering is rock-steady!
 */
function applyAimJitterAndSafety(bot, fromPos, baseYaw, defendGoalPos, attackGoalPos, params, applyJitter = false) {
  let yaw = baseYaw;

  if (applyJitter) {
    const accuracy = params.aimAccuracy ?? 0.80;
    const maxJitterRad = (1.0 - accuracy) * 0.24;
    if (maxJitterRad > 0.004) {
      const jitter = (bot.rng() - 0.5) * 2.0 * maxJitterRad;
      yaw = wrapAngle(yaw + jitter);
    }
  }

  // Hard anti-own-goal safety guard: never aim toward our defending hoop!
  const toDefX = defendGoalPos.x - fromPos.x;
  const toDefZ = defendGoalPos.z - fromPos.z;
  const toDefLen = Math.hypot(toDefX, toDefZ) || 1.0;
  const dirX = Math.sin(yaw);
  const dirZ = Math.cos(yaw);
  const dotDefend = (dirX * toDefX + dirZ * toDefZ) / toDefLen;

  const distFromDefendZ = Math.abs(fromPos.z - defendGoalPos.z);
  const crossesCenterInDefendZone = distFromDefendZ <= 22.0 && Math.abs(fromPos.x) >= 0.8 && (dirX * fromPos.x) < -0.15;

  if (dotDefend > 0.08 || crossesCenterInDefendZone) {
    // Redirect upcourt along the same-side lateral stream channel
    const safeSignX = fromPos.x >= 0 ? 1 : -1;
    const safeTargetX = safeSignX * 11.8;
    const safeTargetZ = attackGoalPos.z;
    yaw = Math.atan2(safeTargetX - fromPos.x, safeTargetZ - fromPos.z);
  }

  return wrapAngle(yaw);
}

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGY SELECTION
// ═══════════════════════════════════════════════════════════════════════════

function selectStrategy(bot, perception, params, tick) {
  if (perception.self.isRecovering) {
    bot.attackStage = ATTACK_STAGE.NONE;
    bot.attackType = ATTACK_TYPE.NONE;
    return STRATEGY.RECOVER;
  }

  // Keep driving through the ball while a strike animation window is actively open
  const openWindowClose = TUNING.strike?.[bot.lastStrikeKind]?.windowClose ?? 30;
  const elapsedStrike = tick - bot.lastStrikeTick;
  if (elapsedStrike >= 0 && elapsedStrike <= openWindowClose && perception.goalSide.isGoalSide) {
    return STRATEGY.STRIKE;
  }

  const agg = bot.currentAggressiveness ?? 0.60;
  const defAware = params.defensiveAwareness ?? 0.65;
  const defendGoalPos = perception.hoops.defendGoalPos;
  const ballPos = perception.ball.position;
  const selfPos = perception.self.position;

  const toDefZ = defendGoalPos.z - ballPos.z;
  const ballMovingToDef = (perception.ball.velocity.z * Math.sign(toDefZ)) > 0.8;
  const inOurDefendingHalf = defendGoalPos.z > 0 ? ballPos.z > 6.0 : ballPos.z < -6.0;
  const inOurDefendingThird = defendGoalPos.z > 0 ? ballPos.z > 16.0 : ballPos.z < -16.0;
  const opponentHasFirstTouch = perception.trajectory?.firstTouchBy === 'opponent';
  const weHaveFirstTouch = perception.trajectory?.firstTouchBy === 'self' || (perception.trajectory?.possessionWindow ?? 0) > 0.10;
  const distBallToDefendZ = Math.abs(defendGoalPos.z - ballPos.z);
  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);

  // Defensive threshold modulated by Style (DEF retreats early, AGG presses high)
  const threatThreshold = Math.max(0.30, defAware * (0.80 - agg * 0.45));
  const oppDangerous = opponentHasFirstTouch && !weHaveFirstTouch && (
    (inOurDefendingHalf && ballMovingToDef) ||
    distBallToDefendZ <= (22.0 - agg * 6.0) ||
    perception.threat > threatThreshold
  );
  const imminentGoalThreat = ballMovingToDef && inOurDefendingThird && distBallToDefendZ <= 24.0 && perception.ball.speed > 4.0;

  if (!weHaveFirstTouch && (oppDangerous || imminentGoalThreat || (perception.threat > 0.72 && inOurDefendingThird))) {
    return STRATEGY.DEFEND;
  }

  const isGoalSide = perception.goalSide.isGoalSide;
  const ballRelY = ballPos.y - selfPos.y;
  const strikeRange = (params.strikeRange ?? 2.0) + (agg - 0.5) * 0.5;

  if (isGoalSide && distToBall <= strikeRange && ballRelY >= -0.55 && ballRelY <= 3.3) {
    return STRATEGY.STRIKE;
  }

  // Controlled stream advance when in lateral stream lane with open space ahead
  const oppDistToBall = Math.hypot(ballPos.x - perception.opponent.position.x, ballPos.z - perception.opponent.position.z);
  if (isGoalSide && distToBall <= 4.5 && perception.stream.isInStreamLane &&
      !perception.stream.isFinishingZone && oppDistToBall > 7.5 && perception.ball.speed <= 4.5 &&
      bot.difficulty !== 'easy' && agg >= 0.45) {
    return STRATEGY.STREAM_DRIBBLE;
  }

  if (distToBall < (params.chaseToPositionDist ?? 11.0)) {
    return STRATEGY.POSITION;
  }

  return STRATEGY.CHASE;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PER-TICK BOT UPDATE
// ═══════════════════════════════════════════════════════════════════════════

export function updateBot(bot, athlete, opponent, balls, matchState, inputSlot, tick, dt, allAthletes = null) {
  if (inputSlot) {
    inputSlot.cutQueued = false;
    inputSlot.braceHeld = false;
    inputSlot.slideHeld = false;
  }
  if (!athlete || !balls || balls.length === 0) {
    steerIdle(inputSlot);
    return;
  }

  if (matchState && (matchState.isCountingDown || matchState.matchOver)) {
    steerIdle(inputSlot);
    return;
  }

  // ═══ 2v2 TEAMMATE & NEAREST OPPONENT DISCOVERY ═══
  let teammate = null;
  bot.hasActiveTeammate = false;
  bot.teammatePos = null;

  if (Array.isArray(allAthletes) && allAthletes.length > 2) {
    const myTeam = athlete.team || (athlete.slotIndex % 2 === 0 ? 'home' : 'away');
    const bPos = balls[0]?.body?.translation?.();
    let bestOppDist = Infinity;
    for (let i = 0; i < allAthletes.length; i++) {
      const other = allAthletes[i];
      if (!other || other === athlete || !other.isEnabled) continue;
      const otherTeam = other.team || (other.slotIndex % 2 === 0 ? 'home' : 'away');
      if (otherTeam === myTeam) {
        teammate = other;
      } else if (bPos && other.motor?.body) {
        const op = other.motor.body.translation();
        const d = Math.hypot(op.x - bPos.x, op.z - bPos.z);
        if (d < bestOppDist) {
          bestOppDist = d;
          opponent = other;
        }
      }
    }
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
    bot.currentAggressiveness = computeDynamicAggressiveness(bot, matchState, freshPerception);

    const delayedTick = tick - (params.reactionDelayTicks ?? 4);
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

  // ═══ 2v2 DYNAMIC ROLE ARBITRATION (ON-BALL vs OFF-BALL FINISHER / RIM ANCHOR) ═══
  if (teammate && teammate.motor?.body && !usePerception.self.isRecovering) {
    const mateBusy = teammate.knockdownState?.active || teammate.diveState?.active;
    if (!mateBusy) {
      const matePos = teammate.motor.body.translation();
      bot.hasActiveTeammate = true;
      bot.teammatePos = matePos;

      const ballPos = usePerception.ball.position;
      const selfPos = usePerception.self.position;
      const attackGoalPos = usePerception.hoops.attackGoalPos;
      const defendGoalPos = usePerception.hoops.defendGoalPos;
      const signAttackZ = Math.sign(attackGoalPos.z - defendGoalPos.z) || -1;

      const myDist = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);
      const mateDist = Math.hypot(ballPos.x - matePos.x, ballPos.z - matePos.z);
      const myAgg = bot.currentAggressiveness ?? 0.60;
      const mateGoalSide = (signAttackZ * (ballPos.z - matePos.z)) >= -0.25;

      // Effective pursuit priority score (lower = higher priority to take on-ball role)
      const myPursuitCost = myDist - myAgg * 1.4 + (usePerception.goalSide.isGoalSide ? 0.0 : 2.2);
      const matePursuitCost = mateDist - 0.60 * 1.4 + (mateGoalSide ? 0.0 : 2.2);

      if (matePursuitCost + 1.15 < myPursuitCost && myDist > 2.4) {
        // Teammate is Primary On-Ball -> Assume Off-Ball Support Role weighted by Style (DEF/BAL/AGG)
        const inAttackingPhase = (usePerception.threat < 0.32 && myAgg >= 0.50) ||
          (myAgg >= 0.80 && usePerception.threat < 0.55);

        if (inAttackingPhase) {
          // OFF-BALL FINISHER: Push up the opposite flank stream channel / stream head for a cross-court pass!
          const flankX = matePos.x >= 0 ? -10.5 : 10.5;
          const finishZ = Math.max(-35.5, Math.min(35.5, ballPos.z + signAttackZ * (8.0 + myAgg * 8.0)));
          _defenseTarget.set(flankX, 0, finishZ);
        } else {
          // DEFENSIVE RIM ANCHOR: Guard the ball-side face of our defending hoop plateau
          const defSign = Math.sign(defendGoalPos.z) || 1;
          const anchorX = Math.max(-4.2, Math.min(4.2, ballPos.x * 0.38));
          const anchorZ = defSign * 34.0;
          _defenseTarget.set(anchorX, 0, anchorZ);
        }

        const distToRolePos = Math.hypot(_defenseTarget.x - selfPos.x, _defenseTarget.z - selfPos.z);
        steerToward(inputSlot, selfPos, _defenseTarget, {
          sprint: distToRolePos > 4.5,
          arrive: true,
          arriveRadius: 1.4,
          maxSpeed: usePerception.ballPhysicsProfile.maxApproachSpeed,
          decelFactor: usePerception.ballPhysicsProfile.decelFactor,
          facePos: distToRolePos <= 2.2 ? ballPos : undefined,
          currentVel: usePerception.self.velocity,
        });
        if (distToRolePos <= 2.2) {
          inputSlot.aimYaw = computeAimYaw(selfPos, ballPos);
          inputSlot.hasAim = true;
          inputSlot.cameraYaw = inputSlot.aimYaw;
        }
        updateTacticalSlideAndBlock(bot, athlete, freshPerception, params, inputSlot, tick);
        evaluatePredictiveStrikes(bot, athlete, freshPerception, params, inputSlot, tick);
        return;
      }
    }
  }

  // ═══ STRATEGY SELECTION ═══
  const stratInterval = params.strategyUpdateInterval || 6;
  if (tick - bot.lastStrategyTick >= stratInterval) {
    bot.strategy = selectStrategy(bot, usePerception, params, tick);
    bot.lastStrategyTick = tick;
  }

  // ═══ TACTICAL LOCOMOTION & POSITIONING ═══
  // If a strike windup is currently open, step directly into the predicted sweet-spot contact point!
  const openWindowClose = TUNING.strike?.[bot.lastStrikeKind]?.windowClose ?? 30;
  const elapsedStrike = tick - bot.lastStrikeTick;
  if (elapsedStrike >= 0 && elapsedStrike <= openWindowClose && !freshPerception.self.isRecovering) {
    executeActiveWindupStepIn(bot, freshPerception, params, inputSlot, elapsedStrike);
  } else {
    switch (bot.strategy) {
      case STRATEGY.CHASE:
        executeChase(bot, usePerception, freshPerception, params, inputSlot, tick);
        bot.stats.chaseTime++;
        break;

      case STRATEGY.POSITION:
        executePosition(bot, usePerception, freshPerception, params, inputSlot, tick);
        bot.stats.positionTime++;
        break;

      case STRATEGY.STREAM_DRIBBLE:
        executeStreamDribble(bot, usePerception, freshPerception, params, inputSlot, tick);
        bot.stats.dribbleTime = (bot.stats.dribbleTime || 0) + 1;
        break;

      case STRATEGY.MULTI_STAGE_ATTACK:
      case STRATEGY.STRIKE:
        executeStrikeApproach(bot, usePerception, freshPerception, params, inputSlot, tick);
        break;

      case STRATEGY.DEFEND:
        executeDefend(bot, usePerception, freshPerception, params, inputSlot, tick);
        bot.stats.defendTime++;
        break;

      case STRATEGY.RECOVER:
        executeRecover(bot, usePerception, params, inputSlot, tick);
        bot.stats.recoverTime++;
        break;
    }
  }

  // ═══ 4-MODE SLIDE, SLIDE-CANCEL, SLIDE-TACKLE & PROACTIVE BLOCK CONTROLLER ═══
  updateTacticalSlideAndBlock(bot, athlete, freshPerception, params, inputSlot, tick);

  // ═══ PREDICTIVE STRIKE, JUMP-SPIKE, BLOCK, BRACE & DIVE ARBITRATION ═══
  evaluatePredictiveStrikes(bot, athlete, freshPerception, params, inputSlot, tick);
}

// ═══════════════════════════════════════════════════════════════════════════
// TACTICAL LOCOMOTION EXECUTORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * During an active strike windup (between pressTick and sweetTick), steer the athlete
 * directly into the real-ragdoll limb-contact pocket behind the predicted sweet-tick ball position.
 */
function executeActiveWindupStepIn(bot, freshPerception, params, slot, elapsedStrike) {
  const selfPos = freshPerception.self.position;
  const selfVel = freshPerception.self.velocity;
  const profile = freshPerception.ballPhysicsProfile;
  const ballRadius = freshPerception.ball.radius || 0.5;
  const sweetTick = bot.lastStrikeSweetTick || 15;
  const remTicks = Math.max(0, sweetTick - elapsedStrike);

  sampleTrajectoryAtTick(freshPerception.trajectory, remTicks, _ballAtSweet);

  // Real-ragdoll anatomical stand-off distance (measured tick-by-tick off Rapier in `probe_whiff_and_hoop`):
  //   Spike (+42t): `handL/R` extends `0.90m` forward (`dyAboveMotor = +0.82m`)
  //   Volley (+15t): `handL/R` & `foreArmL/R` extend `0.48m` forward (`dyAboveMotor = +0.58m`)
  //   Kick (+8..11t): `calfL/R` & `footL/R` sweep `0.22..0.42m` forward (`dyAboveMotor = -0.16m`)
  let standoffDist;
  if (bot.lastStrikeKind === 'spike') {
    standoffDist = 0.78 + ballRadius * 0.25;
  } else if (bot.lastStrikeKind === 'kick') {
    standoffDist = 0.24 + ballRadius * 0.45;
  } else {
    standoffDist = 0.34 + ballRadius * 0.45;
  }

  const aimYaw = Number.isFinite(bot.lastStrikeAimYaw)
    ? bot.lastStrikeAimYaw
    : computeAimYaw(selfPos, freshPerception.hoops.attackGoalPos);
  const shotDirX = Math.sin(aimYaw);
  const shotDirZ = Math.cos(aimYaw);

  _interceptTarget.set(
    _ballAtSweet.x - shotDirX * standoffDist,
    0,
    _ballAtSweet.z - shotDirZ * standoffDist
  );

  const distToSweet = Math.hypot(_interceptTarget.x - selfPos.x, _interceptTarget.z - selfPos.z);
  steerToward(slot, selfPos, _interceptTarget, {
    sprint: distToSweet > 0.35,
    arrive: true,
    arriveRadius: 0.30,
    maxSpeed: profile.maxApproachSpeed,
    decelFactor: profile.decelFactor,
    minDrive: distToSweet > 0.14 ? 0.72 : 0.0,
    aimYaw,
    currentVel: selfVel,
  });

  slot.aimYaw = aimYaw;
  slot.cameraYaw = aimYaw;
  slot.hasAim = true;
}

/**
 * CHASE: Pursue the ball's earliest reachable trajectory node along a goal-aligned corridor.
 */
function executeChase(bot, perception, freshPerception, params, slot, tick) {
  const selfPos = perception.self.position;
  const selfVel = perception.self.velocity;
  const ballPos = perception.ball.position;
  const defendGoalPos = perception.hoops.defendGoalPos;
  const profile = perception.ballPhysicsProfile;

  if (!perception.goalSide.isGoalSide) {
    steerGoalSideArc(slot, selfPos, ballPos, defendGoalPos, {
      sprint: true,
      maxSpeed: profile.maxApproachSpeed,
      currentVel: selfVel,
    });
    if (tick - bot.lastCutTick >= bot.cutCooldownTicks &&
        shouldExecuteCut(selfVel, slot.moveWorld, { minSpeed: 2.8, isDownhill: perception.terrain?.isDownhillFacing })) {
      slot.cutQueued = true;
      bot.lastCutTick = tick;
      bot.stats.cutCount = (bot.stats.cutCount || 0) + 1;
    }
    return;
  }

  const intercept = perception.ballIntercept.position;
  const targetX = Math.max(-15.2, Math.min(15.2, intercept.x));
  const targetZ = Math.max(-46.0, Math.min(46.0, intercept.z));

  // Determine the intended offensive target from the intercept point so the approach lines up with our shot!
  solveOffensiveAimAndTarget(bot, intercept, 'volley', perception, params, _playTarget);
  const toPlayX = _playTarget.x - targetX;
  const toPlayZ = _playTarget.z - targetZ;
  const toPlayLen = Math.hypot(toPlayX, toPlayZ) || 1.0;
  const shotDirX = toPlayX / toPlayLen;
  const shotDirZ = toPlayZ / toPlayLen;

  const ballRadius = perception.ball.radius || 0.5;
  const pocketDist = 0.30 + ballRadius * 0.55;
  const posOffset = (params.positionOffset ?? 0.30) + (ballRadius - 0.5) * 0.20;

  _interceptTarget.set(
    targetX - shotDirX * pocketDist,
    0,
    targetZ - shotDirZ * pocketDist
  );

  const leadFactor = params.interceptLeadFactor ?? 1.0;
  if (leadFactor < 1.0) {
    _interceptTarget.lerp(
      _toBall.set(ballPos.x, 0, ballPos.z),
      1.0 - leadFactor,
    );
  }

  const agg = bot.currentAggressiveness ?? 0.60;
  const distToTarget = Math.hypot(_interceptTarget.x - selfPos.x, _interceptTarget.z - selfPos.z);
  const shouldSprint = (agg >= 0.45) || (distToTarget > 1.6 && (bot.rng() < (params.sprintUsage ?? 0.80)));
  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);

  if (distToBall < 6.5 && perception.goalSide.isGoalSide) {
    steerGoalAlignedApproach(slot, selfPos, selfVel, intercept, _playTarget, defendGoalPos, {
      sprint: shouldSprint,
      maxSpeed: profile.maxApproachSpeed,
      decelFactor: profile.decelFactor,
      runwayOffset: posOffset + 0.45,
      pocketDist,
    });
  } else {
    steerToward(slot, selfPos, _interceptTarget, {
      sprint: shouldSprint,
      arrive: true,
      arriveRadius: 1.0,
      maxSpeed: profile.maxApproachSpeed,
      decelFactor: profile.decelFactor,
      minDrive: distToTarget > 1.2 ? 0.65 : 0.0,
      currentVel: selfVel,
    });
  }

  if (tick - bot.lastCutTick >= bot.cutCooldownTicks &&
      shouldExecuteCut(selfVel, slot.moveWorld, { minSpeed: 3.1, isDownhill: perception.terrain?.isDownhillFacing })) {
    slot.cutQueued = true;
    bot.lastCutTick = tick;
    bot.stats.cutCount = (bot.stats.cutCount || 0) + 1;
  }
}

/**
 * POSITION: Settle into the hitting pocket behind the ball's intercept point, aligned with the chosen play target.
 */
function executePosition(bot, perception, freshPerception, params, slot, tick) {
  const selfPos = perception.self.position;
  const selfVel = perception.self.velocity;
  const ballPos = perception.ball.position;
  const defendGoalPos = perception.hoops.defendGoalPos;
  const profile = perception.ballPhysicsProfile;
  const agg = bot.currentAggressiveness ?? 0.60;

  if (!perception.goalSide.isGoalSide) {
    steerGoalSideArc(slot, selfPos, ballPos, defendGoalPos, {
      sprint: true,
      maxSpeed: profile.maxApproachSpeed,
      currentVel: selfVel,
    });
    if (tick - bot.lastCutTick >= bot.cutCooldownTicks &&
        shouldExecuteCut(selfVel, slot.moveWorld, { minSpeed: 2.8, isDownhill: perception.terrain?.isDownhillFacing })) {
      slot.cutQueued = true;
      bot.lastCutTick = tick;
      bot.stats.cutCount = (bot.stats.cutCount || 0) + 1;
    }
    return;
  }

  // Use short-horizon trajectory sample (12 ticks) when ball is close so we track bounces accurately
  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);
  const trackPos = distToBall <= 3.5
    ? sampleTrajectoryAtTick(freshPerception.trajectory, Math.min(15, freshPerception.ballIntercept.ticksToArrive), _ballAtSweet)
    : perception.ballIntercept.position;

  const isLow = (ballPos.y - selfPos.y) < 0.367;
  const plannedAimYaw = solveOffensiveAimAndTarget(bot, trackPos, isLow ? 'kick' : 'volley', perception, params, _playTarget);
  const ballRadius = perception.ball.radius || 0.5;
  const pocketDist = 0.30 + ballRadius * 0.55;
  const posOffset = (params.positionOffset ?? 0.30) + (ballRadius - 0.5) * 0.20;
  const shouldSprint = (agg >= 0.50 && distToBall > 1.1) || distToBall > 1.8;

  steerGoalAlignedApproach(slot, selfPos, selfVel, trackPos, _playTarget, defendGoalPos, {
    sprint: shouldSprint,
    maxSpeed: profile.maxApproachSpeed,
    decelFactor: profile.decelFactor,
    runwayOffset: posOffset + 0.42,
    pocketDist,
  });

  if (distToBall < TUNING.ai.facing.strikeAimRadius) {
    slot.aimYaw = plannedAimYaw;
    slot.hasAim = true;
    slot.cameraYaw = plannedAimYaw;
  }

  if (tick - bot.lastCutTick >= bot.cutCooldownTicks &&
      shouldExecuteCut(selfVel, slot.moveWorld, { minSpeed: 3.0, isDownhill: perception.terrain?.isDownhillFacing })) {
    slot.cutQueued = true;
    bot.lastCutTick = tick;
    bot.stats.cutCount = (bot.stats.cutCount || 0) + 1;
  }
}

/**
 * STREAM_DRIBBLE: Advance behind the ball up the lateral stream channel toward the stream head.
 */
function executeStreamDribble(bot, perception, freshPerception, params, slot, tick) {
  const selfPos = perception.self.position;
  const ballPos = perception.ball.position;
  const defendGoalPos = perception.hoops.defendGoalPos;
  const attackHead = perception.stream.attackStreamHead;
  const profile = perception.ballPhysicsProfile;
  const ballRadius = perception.ball.radius || 0.5;

  if (!perception.goalSide.isGoalSide) {
    steerGoalSideArc(slot, selfPos, ballPos, defendGoalPos, {
      sprint: true,
      maxSpeed: profile.maxApproachSpeed,
      currentVel: perception.self.velocity,
    });
    return;
  }

  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);
  steerGoalAlignedApproach(slot, selfPos, perception.self.velocity, ballPos, attackHead, defendGoalPos, {
    sprint: distToBall > 1.15,
    maxSpeed: profile.maxApproachSpeed,
    decelFactor: profile.decelFactor,
    runwayOffset: 0.55,
    pocketDist: 0.30 + ballRadius * 0.55,
  });

  if (distToBall <= TUNING.ai.facing.strikeAimRadius) {
    slot.aimYaw = computeAimYaw(selfPos, attackHead);
    slot.hasAim = true;
    slot.cameraYaw = slot.aimYaw;
  }
}

/**
 * STRIKE APPROACH: Close-range step-in behind the ball toward our solved offensive play target.
 */
function executeStrikeApproach(bot, perception, freshPerception, params, slot, tick) {
  const selfPos = freshPerception.self.position;
  const selfVel = freshPerception.self.velocity;
  const ballPos = freshPerception.ball.position;
  const defendGoalPos = perception.hoops.defendGoalPos;
  const profile = freshPerception.ballPhysicsProfile;

  if (!freshPerception.goalSide.isGoalSide) {
    steerGoalSideArc(slot, selfPos, ballPos, defendGoalPos, {
      sprint: true,
      maxSpeed: profile.maxApproachSpeed,
      currentVel: selfVel,
    });
    return;
  }

  const isLow = (ballPos.y - selfPos.y) < 0.367;
  const lookAheadTicks = isLow ? (TUNING.strike?.kick?.sweetTick ?? 8) : (TUNING.strike?.volley?.sweetTick ?? 15);
  sampleTrajectoryAtTick(freshPerception.trajectory, lookAheadTicks, _ballAtSweet);

  const plannedAimYaw = solveOffensiveAimAndTarget(bot, _ballAtSweet, isLow ? 'kick' : 'volley', freshPerception, params, _playTarget);
  const shotDirX = Math.sin(plannedAimYaw);
  const shotDirZ = Math.cos(plannedAimYaw);
  const ballRadius = freshPerception.ball.radius || 0.5;
  const standoffDist = 0.30 + ballRadius * 0.55;

  // Step directly into the real-ragdoll limb-reach pocket behind the sweet-tick ball position
  _interceptTarget.set(
    _ballAtSweet.x - shotDirX * standoffDist,
    0,
    _ballAtSweet.z - shotDirZ * standoffDist
  );

  const distToPocket = Math.hypot(_interceptTarget.x - selfPos.x, _interceptTarget.z - selfPos.z);
  steerToward(slot, selfPos, _interceptTarget, {
    sprint: distToPocket > 0.45,
    arrive: true,
    arriveRadius: 0.32,
    maxSpeed: profile.maxApproachSpeed,
    decelFactor: profile.decelFactor,
    minDrive: distToPocket > 0.16 ? 0.68 : 0.0,
    aimYaw: plannedAimYaw,
    currentVel: selfVel,
  });

  slot.aimYaw = plannedAimYaw;
  slot.cameraYaw = plannedAimYaw;
  slot.hasAim = true;
}

/**
 * DEFEND: Clear reachable balls downhill/upcourt, or station on the ball-side face of the
 * defending goal plateau (|Z| = 33.5..36.5m, |X| = 1.5..4.5m) to block shots entering the X = 0 hoop.
 */
function executeDefend(bot, perception, freshPerception, params, slot, tick) {
  const defendPos = perception.hoops.defendGoalPos;
  const ballPos = perception.ball.position;
  const intercept = perception.ballIntercept.position;
  const selfPos = perception.self.position;
  const selfVel = perception.self.velocity;
  const agg = bot.currentAggressiveness ?? 0.60;
  const profile = perception.ballPhysicsProfile;
  const isGoalSide = perception.goalSide.isGoalSide;

  const ticksToArrive = perception.ballIntercept.ticksToArrive;
  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);
  const oppHasFirstTouch = perception.trajectory?.firstTouchBy === 'opponent';
  const hasClearanceChance = !oppHasFirstTouch && isGoalSide && (distToBall <= 14.0 || ticksToArrive <= 45 || agg >= 0.55);

  if (hasClearanceChance) {
    const isLow = (ballPos.y - selfPos.y) < 0.367;
    const clearanceYaw = solveOffensiveAimAndTarget(bot, intercept, isLow ? 'kick' : 'volley', perception, params, _playTarget);
    const dirX = Math.sin(clearanceYaw);
    const dirZ = Math.cos(clearanceYaw);
    const ballRadius = perception.ball.radius || 0.5;
    const posOffset = 0.30 + ballRadius * 0.55;

    _defenseTarget.set(
      intercept.x - dirX * posOffset,
      0,
      intercept.z - dirZ * posOffset
    );

    const distToTarget = Math.hypot(_defenseTarget.x - selfPos.x, _defenseTarget.z - selfPos.z);
    steerToward(slot, selfPos, _defenseTarget, {
      sprint: (agg >= 0.45) || distToTarget > 1.1,
      arrive: true,
      arriveRadius: 0.40,
      maxSpeed: profile.maxApproachSpeed,
      decelFactor: profile.decelFactor,
      minDrive: distToTarget > 0.5 ? 0.65 : 0.0,
      aimYaw: distToBall <= TUNING.ai.facing.clearanceAimRadius ? clearanceYaw : undefined,
      currentVel: selfVel,
    });

    if (distToBall <= TUNING.ai.facing.clearanceAimRadius) {
      slot.aimYaw = clearanceYaw;
      slot.hasAim = true;
      slot.cameraYaw = clearanceYaw;
    }
  } else {
    // HOOP APERTURE RIM GUARD:
    // Because the hoop lies in the X = 0 plane at Z = ±40m (radius 4.667m, Z ∈ [35.3, 44.7]),
    // shots must cross X = 0 from the ball's X side. Station on the ball-side face of the elevated
    // goal plateau (|Z| = 33.5..36.5m, X = sign(ball.x) * 1.8..4.2m) to swat or block shots!
    const signDefZ = Math.sign(defendPos.z) || 1;
    const ballSideSignX = Math.abs(ballPos.x) > 0.5 ? Math.sign(ballPos.x) : 1;
    const rimX = Math.max(-4.5, Math.min(4.5, ballSideSignX * Math.max(1.8, Math.abs(ballPos.x) * 0.38)));
    const rimZ = signDefZ * 35.0;
    const rimY = getCourtFloorY(rimX, rimZ);
    _defenseTarget.set(rimX, rimY, rimZ);

    const distToTarget = Math.hypot(_defenseTarget.x - selfPos.x, _defenseTarget.z - selfPos.z);
    steerToward(slot, selfPos, _defenseTarget, {
      sprint: distToTarget > 2.2,
      arrive: true,
      arriveRadius: 1.0,
      maxSpeed: profile.maxApproachSpeed,
      minDrive: 0.0,
      facePos: distToTarget <= TUNING.ai.facing.blockFaceRadius ? ballPos : undefined,
      currentVel: selfVel,
    });

    if (tick - bot.lastCutTick >= bot.cutCooldownTicks) {
      const az = Math.abs(selfPos.z);
      if (az >= 30.0 && distToTarget <= 2.5 && shouldExecuteCut(selfVel, slot.moveWorld, { minSpeed: 2.2, isDownhill: true })) {
        slot.cutQueued = true;
        bot.lastCutTick = tick;
        bot.stats.cutCount = (bot.stats.cutCount || 0) + 1;
      }
    }
  }
}

function executeRecover(bot, perception, params, slot, tick) {
  steerIdle(slot);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4-MODE TACTICAL SLIDE, SLIDE-CANCEL, SLIDE-TACKLE & SLIDING BLOCK CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Manages the 4 tactical uses of Slide (`slideHeld` / RT / C) and Jump-Cancel:
 *   1. Safe Slide-Cancel Guard: Taps `jumpQueued = true` (which cancels a slide back onto the
 *      athlete's feet at full speed without consuming a jump!) before speed decays near the 4.0 m/s
 *      knockdown threshold or when arriving at the strike pocket.
 *   2. Downhill Momentum Surfing: Slides down valley / stream-head slopes (`driveScale = 0`,
 *      `slopeFactor = 0.35`) to accelerate past the flat sprint cap up to ~7.5 m/s, then jump-cancels.
 *   3. Slide-Tackle Knockdowns (`speed > 5.5 m/s`): Sweeps through an opponent ball-handler within
 *      1.0..3.1m to knock them down (`resolveAthleteCollision`).
 *   4. High-Speed Sliding Block (`slideHeld + braceHeld`): Slides into an imminent bounce or shot lane
 *      (1.5..3.4m away) with Block active (`resolveBraceRedirect` 25° pop) instead of suffering a 3s dive stun.
 */
function updateTacticalSlideAndBlock(bot, athlete, freshPerception, params, slot, tick) {
  if (freshPerception.self.isRecovering) {
    slot.slideHeld = false;
    bot.slideUntilTick = -Infinity;
    bot.slideMode = 'none';
    return;
  }

  const selfPos = freshPerception.self.position;
  const selfVel = freshPerception.self.velocity;
  const ballPos = freshPerception.ball.position;
  const oppPos = freshPerception.opponent.position;
  const speedXZ = Math.hypot(selfVel.x, selfVel.z);
  const liveDistXZ = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);
  const distToOpp = Math.hypot(oppPos.x - selfPos.x, oppPos.z - selfPos.z);
  const oppDistToBall = Math.hypot(ballPos.x - oppPos.x, ballPos.z - oppPos.z);
  const agg = bot.currentAggressiveness ?? 0.60;
  const isActionSliding = Boolean(athlete?.actionState?.sliding);
  const isBotSliding = isActionSliding || (tick < bot.slideUntilTick);

  // ═══ 1. SAFE SLIDE-CANCEL & EXIT GUARD ═══
  if (isBotSliding) {
    const slideDuration = tick - bot.slideStartTick;
    const minCommittedTicks = TUNING.action?.minSlideTicks ?? 15;
    const dangerLowSpeed = speedXZ < 4.40; // well above 4.0 m/s knockdown threshold
    const arrivedAtPocket = bot.slideMode === 'surf' && liveDistXZ <= 5.8;
    const finishedBurst = tick >= bot.slideUntilTick || slideDuration >= 20;

    if (dangerLowSpeed || arrivedAtPocket || finishedBurst) {
      slot.slideHeld = false;
      bot.slideUntilTick = -Infinity;
      bot.slideMode = 'none';
      // In actions.js:295, releasing slideHeld after minSlideTicks (15) exits the slide cleanly.
      // Only tap jumpQueued if we must emergency-cancel INSIDE the 15-tick commitment window!
      if (isActionSliding && slideDuration < minCommittedTicks) {
        slot.jumpQueued = true;
      }
      return;
    }

    // Continue active slide commitment
    slot.slideHeld = true;
    if (bot.slideMode === 'block') {
      slot.braceHeld = true;
    }
    return;
  }

  if (!freshPerception.self.grounded) return;
  const slideCooldown = bot.difficulty === 'hard' ? 85 : (bot.difficulty === 'medium' ? 110 : 150);
  if (tick - bot.lastSlideTick < slideCooldown) return;

  // ═══ 2. MODE A: PHYSICAL SLIDE-TACKLE KNOCKDOWN (speed > 5.5 m/s) ═══
  // Sweeps an upright opponent who has ball priority within 0.95..2.95m ahead of our velocity vector!
  const oppKnockedDown = Boolean(freshPerception.opponent?.isKnockedDown);
  const tackleSkillChance = bot.difficulty === 'easy' ? 0.30 : (0.55 + agg * 0.40);
  if (speedXZ >= 5.54 && !oppKnockedDown && distToOpp >= 0.92 && distToOpp <= 2.95 &&
      oppDistToBall <= 2.6 && liveDistXZ >= oppDistToBall) {
    const toOppX = (oppPos.x - selfPos.x) / distToOpp;
    const toOppZ = (oppPos.z - selfPos.z) / distToOpp;
    const velDirX = selfVel.x / speedXZ;
    const velDirZ = selfVel.z / speedXZ;
    const dotVelOpp = velDirX * toOppX + velDirZ * toOppZ;

    if (dotVelOpp >= 0.80 && bot.rng() < tackleSkillChance) {
      slot.slideHeld = true;
      slot.moveWorld.set(toOppX, 0, toOppZ);
      slot.moveX = toOppX;
      slot.moveZ = toOppZ;
      bot.lastSlideTick = tick;
      bot.slideStartTick = tick;
      bot.slideUntilTick = tick + 15;
      bot.slideMode = 'tackle';
      bot.stats.slides = (bot.stats.slides || 0) + 1;
      bot.stats.slideTackles = (bot.stats.slideTackles || 0) + 1;
      return;
    }
  }

  // ═══ 3. MODE B: HIGH-SPEED DEFENSIVE SLIDING BLOCK (slideHeld + braceHeld) ═══
  // Replaces desperate open-court dives! When an imminent bounce or fast shot in a defensive
  // situation cannot be reached upright in time, slide into the ball path with Block active!
  const defendGoalPos = freshPerception.hoops.defendGoalPos;
  const ballVel = freshPerception.ball.velocity;
  const velTowardDef = ballVel.z * Math.sign(defendGoalPos.z);
  const hasImminentBounce = freshPerception.trajectory?.hasBounce &&
    !freshPerception.ball?.isGrounded &&
    freshPerception.trajectory.ticksToNextBounce >= 5 &&
    freshPerception.trajectory.ticksToNextBounce <= 16;
  const cannotReachUpright = !freshPerception.trajectory?.canReachBeforeBounceSelf &&
    freshPerception.ballIntercept.ticksToArrive > (freshPerception.trajectory?.ticksToNextBounce ?? 15) + 4;
  const isDefensiveEmergency = cannotReachUpright && (freshPerception.threat > 0.28 || velTowardDef > 2.5);

  if (speedXZ >= 4.45 && hasImminentBounce && isDefensiveEmergency && liveDistXZ >= 1.85 && liveDistXZ <= 3.55) {
    const targetPos = freshPerception.trajectory.nextBouncePos;
    const toTargX = targetPos.x - selfPos.x;
    const toTargZ = targetPos.z - selfPos.z;
    const distTarg = Math.hypot(toTargX, toTargZ) || 1.0;
    const velDirX = selfVel.x / speedXZ;
    const velDirZ = selfVel.z / speedXZ;
    const dotVelTarg = (velDirX * toTargX + velDirZ * toTargZ) / distTarg;

    if (dotVelTarg >= 0.80 && distTarg >= 1.80 && distTarg <= 3.45) {
      slot.slideHeld = true;
      slot.braceHeld = true;
      const aimYaw = solveOffensiveAimAndTarget(bot, targetPos, 'volley', freshPerception, params, _playTarget);
      slot.aimYaw = aimYaw;
      slot.cameraYaw = aimYaw;
      slot.hasAim = true;
      bot.lastSlideTick = tick;
      bot.slideStartTick = tick;
      bot.slideUntilTick = tick + 15;
      bot.slideMode = 'block';
      bot.stats.slides = (bot.stats.slides || 0) + 1;
      return;
    }
  }

  // ═══ 4. MODE C: LONG-RANGE DOWNHILL MOMENTUM SURFING ('surf') ═══
  // When rotating down the valley slopes with >= 8.0m to the ball, slide for 15 ticks
  // to uncap downhill acceleration (up to 7.8 m/s), then release back onto feet with >= 5m left to steer!
  const isDescendingSlope = selfVel.y < -0.28 &&
    (Boolean(freshPerception.terrain?.isDownhillFacing) || (freshPerception.terrain?.slopeGradient ?? 0) > 0.13);
  if (speedXZ >= 4.45 && isDescendingSlope && liveDistXZ >= 8.0) {
    const moveLen = Math.hypot(slot.moveWorld.x, slot.moveWorld.z);
    if (moveLen > 0.5) {
      const dotMoveVel = (slot.moveWorld.x * selfVel.x + slot.moveWorld.z * selfVel.z) / (moveLen * speedXZ);
      if (dotMoveVel >= 0.86) {
        slot.slideHeld = true;
        bot.lastSlideTick = tick;
        bot.slideStartTick = tick;
        bot.slideUntilTick = tick + 15;
        bot.slideMode = 'surf';
        bot.stats.slides = (bot.stats.slides || 0) + 1;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PREDICTIVE STRIKE, JUMP-SPIKE, BLOCK, BRACE & DIVE ARBITRATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluates exact 3D ragdoll limb-to-ball strike-window predictions synchronized with `src/mechanics/strikes.js`:
 *   - Kick:   sweetTick = 8,  window = [8..17]   (East button when `eastKind()` selects Kick at press)
 *   - Volley: sweetTick = 15, window = [12..30]  (East button when `eastKind()` selects Volley at press)
 *   - Spike:  sweetTick = 42, window = [30..54]  (North button; standing or scheduled jump at T+22)
 * Also arbitrates defensive Block (`braceHeld`), Jump-Block (`jumpQueued + braceHeld`),
 * Point-Blank Fast-Shot Block-Traps (`resolveBraceRedirect` +25° pop), and Brace-Dive Intercepts.
 */
function evaluatePredictiveStrikes(bot, athlete, freshPerception, params, slot, tick) {
  if (freshPerception.self.isRecovering) return;

  const ballPos = freshPerception.ball.position;
  const ballVel = freshPerception.ball.velocity;
  const selfPos = freshPerception.self.position;
  const selfVel = freshPerception.self.velocity;
  const goalPos = freshPerception.hoops.attackGoalPos;
  const defendGoalPos = freshPerception.hoops.defendGoalPos;
  const ballRadius = freshPerception.ball.radius || 0.5;
  const assistRadius = athlete?.strikeState?.assistRadius ?? 0.45;
  const agg = bot.currentAggressiveness ?? 0.60;

  const liveDistXZ = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);
  const ballRelAthYNow = ballPos.y - selfPos.y;
  const distToGoalZ = Math.abs(goalPos.z - selfPos.z);
  const distToDefendZ = Math.abs(selfPos.z - defendGoalPos.z);
  const oppPos = freshPerception.opponent.position;
  const oppDistToBall = Math.hypot(ballPos.x - oppPos.x, ballPos.z - oppPos.z);

  // Defending rim guard context (within 13m of defending hoop Z, on or near goal plateau)
  const isDefendingRim = distToDefendZ <= 13.0 && Math.abs(selfPos.z) >= 27.5 &&
    (freshPerception.threat > 0.16 || (ballVel.z * Math.sign(defendGoalPos.z)) > 0.8);

  // Hold locked strike aim yaw while an active strike swing window is still open
  const activeWindowClose = TUNING.strike?.[bot.lastStrikeKind]?.windowClose ?? 30;
  const isStrikeWindowActive = (tick - bot.lastStrikeTick) <= activeWindowClose;
  if (isStrikeWindowActive && Number.isFinite(bot.lastStrikeAimYaw)) {
    slot.aimYaw = bot.lastStrikeAimYaw;
    slot.cameraYaw = bot.lastStrikeAimYaw;
    slot.hasAim = true;
  }

  // Execute scheduled jump during a 42-tick spike windup so jump height (+1.67m over 20 ticks) aligns with sweetTick = 42!
  if (bot.pendingJumpTick > 0 && tick >= bot.pendingJumpTick) {
    if (freshPerception.self.grounded && (tick - bot.lastJumpTick >= bot.jumpCooldownTicks)) {
      slot.jumpQueued = true;
      bot.lastJumpTick = tick;
    }
    bot.pendingJumpTick = -Infinity;
  }

  // ═══ DISCIPLINED DEFENSIVE BLOCK (`braceHeld`) & JUMP-BLOCK DOCTRINE ═══
  // CRITICAL REAL-GAME RULE (`src/main.js:1448` + `src/sim/animtarget.js:1665`):
  // Holding `braceHeld` keeps `braceMix` near 1.0 (taking ~10 ticks to decay below 0.2). If `braceMix > 0.2`
  // when preparing an offensive strike, any torso/arm brush triggers `resolveBraceRedirect` BEFORE `windowOpen`
  // or `checkStrikeAssist`, popping the ball away and turning the strike into a whiff!
  // Therefore, ONLY hold `braceHeld` in genuine defensive / body-blocking situations — NEVER during clean offensive step-ins!
  if (!isStrikeWindowActive) {
    const dotBallTowardSelf = ((selfPos.x - ballPos.x) * ballVel.x + (selfPos.z - ballPos.z) * ballVel.z) / Math.max(0.1, liveDistXZ);
    const signDefendZ = Math.sign(defendGoalPos.z) || 1;
    const isBodyBlockingOpponent = !freshPerception.trajectory.weHavePriority &&
      oppDistToBall <= 1.45 && liveDistXZ <= 2.3 && oppDistToBall + 0.35 < liveDistXZ;
    const isWrongSideRetreat = !freshPerception.goalSide.isGoalSide &&
      liveDistXZ <= 2.2 && (ballVel.z * signDefendZ) > 0.8;

    if (isDefendingRim || isBodyBlockingOpponent || isWrongSideRetreat) {
      slot.braceHeld = true;
      if (freshPerception.goalSide.isGoalSide) {
        const blockYaw = solveOffensiveAimAndTarget(bot, selfPos, 'volley', freshPerception, params, _playTarget);
        if (liveDistXZ <= (TUNING.ai.facing?.strikeAimRadius ?? 3.8) || freshPerception.self.speedXZ < 2.2) {
          slot.aimYaw = blockYaw;
          slot.cameraYaw = blockYaw;
          slot.hasAim = true;
        }
      }

      // JUMP-BLOCK AT THE RIM / OPPONENT POINT-BLANK STUFF:
      const canJumpBlock = freshPerception.self.grounded && (tick - bot.lastJumpTick >= bot.jumpCooldownTicks);
      if (canJumpBlock && liveDistXZ <= 3.1 && ballRelAthYNow >= 1.35 && ballRelAthYNow <= 3.15 &&
          (isDefendingRim || (oppDistToBall <= 1.85 && dotBallTowardSelf >= 3.5))) {
        slot.jumpQueued = true;
        bot.lastJumpTick = tick;
        bot.stats.hoopBlocks = (bot.stats.hoopBlocks || 0) + 1;
      }
    }

    // POINT-BLANK FAST-SHOT BLOCK-TRAP (`>= 11.5 m/s` impacting within 4 ticks, faster than any 8/12-tick window):
    if (dotBallTowardSelf >= 11.5 && liveDistXZ <= 1.45) {
      sampleTrajectoryAtTick(freshPerception.trajectory, 4, _ballAtSweet);
      const distAt4 = Math.hypot(_ballAtSweet.x - (selfPos.x + selfVel.x * 0.067), _ballAtSweet.z - (selfPos.z + selfVel.z * 0.067));
      if (distAt4 <= 0.42 + ballRadius) {
        slot.braceHeld = true;
        const trapYaw = solveOffensiveAimAndTarget(bot, selfPos, 'kick', freshPerception, params, _playTarget);
        slot.aimYaw = trapYaw;
        slot.cameraYaw = trapYaw;
        slot.hasAim = true;
        bot.selfSetUntilTick = tick + 60;
        return;
      }
    }
  }

  // Respect open strike window & `TUNING.strike.pressCooldownTicks` (20) so we never cancel or drop a press
  const strikeCooldownTicks = Math.max(activeWindowClose + 2, (TUNING.strike?.pressCooldownTicks ?? 20));
  if (tick - bot.lastStrikeTick < strikeCooldownTicks) return;

  // ═══ ZERO-TOLERANCE OWN-GOAL & SLIDE-BLEND GUARD ═══
  if (!freshPerception.goalSide.isGoalSide) return;
  // Never press a strike while `actionState.sliding` is active (`animtarget.js:1665` cuts `strikePart` in half!)
  const isSlidingNow = Boolean(athlete?.actionState?.sliding);
  if (isSlidingNow) return;

  // Concede strike swing (keep braceHeld active!) if opponent is already on top of the ball with priority
  const oppHasPriority = !isDefendingRim &&
    freshPerception.trajectory.firstTouchBy === 'opponent' &&
    oppDistToBall < 1.10 &&
    liveDistXZ > oppDistToBall + 0.35;
  if (oppHasPriority) return;

  // Timing jitter (Easy = ±4 ticks, Medium = ±1 tick, Hard = 0 ticks)
  const jitterMax = params.strikeTimingJitter ?? 0;
  const timingOffset = jitterMax > 0 ? Math.round((bot.rng() - 0.5) * 2.0 * jitterMax) : 0;
  const isDiving = (tick - bot.lastDiveTick) <= 36;
  const selfSpeedNow = Math.hypot(selfVel.x, selfVel.z);

  // Exact 3D limb-to-ball strike threshold matching `checkStrikeAssist` (`ballRadius + 0.08 + assistRadius`)
  // with a tight safety margin so swings connect reliably in the real 3D ragdoll world!
  const effectiveLimbHitRadius = ballRadius + 0.05 + assistRadius * 0.84;

  // Helper closure (inlined arithmetic, zero allocation): forward-integrates the rolling sphere motor
  // including BOTH longitudinal torque acceleration (4.0 m/s²) AND transverse velocity drift (counter-braked at 3.8 m/s²).
  // Prevents swinging while sprinting sideways past the ball!

  // ═══ 1. CANDIDATE: STANDING OR JUMP-SPIKE (sweetTick = 42, window = [30..54]) ═══
  // Measured off Rapier (`probe_whiff_and_hoop`):
  //   Grounded Standing Spike at +42t (`phase = 0.641`): `handL/R` is at `fwd = 0.90m, floor + 1.32m` (`motor.y + 0.82m`).
  //   Delayed 12-tick Hop-Spike (`pendingJumpTick = tick + 30`, 12t = 0.20s air -> +1.07m): `limbY = floor + 2.39m`.
  //   Delayed 18-tick Jump-Spike (`pendingJumpTick = tick + 24`, 18t = 0.30s air -> +1.46m): `limbY = floor + 2.78m`.
  const spikeSweet = Math.max(30, (TUNING.strike?.spike?.sweetTick ?? 42) + timingOffset);
  const noBounceBeforeSpike = !freshPerception.trajectory?.hasBounce ||
    freshPerception.trajectory.ticksToNextBounce >= (spikeSweet + 1);
  if (!isDiving && noBounceBeforeSpike && !freshPerception.ball.isGrounded && selfSpeedNow <= 5.0) {
    sampleTrajectoryAtTick(freshPerception.trajectory, 15, _ballAtSweet);
    const floorAt15 = getCourtFloorY(_ballAtSweet.x, _ballAtSweet.z);
    const distAt15 = Math.hypot(_ballAtSweet.x - (selfPos.x + selfVel.x * 0.25), _ballAtSweet.z - (selfPos.z + selfVel.z * 0.25));
    const arrivesInVolleyWindowFirst = distAt15 <= 1.15 && (_ballAtSweet.y - floorAt15) <= 2.15;

    if (!arrivesInVolleyWindowFirst) {
      sampleTrajectoryAtTick(freshPerception.trajectory, spikeSweet, _ballAtSpike, _velAtSpike);
      const ballHorizSpeedAtSpike = Math.hypot(_velAtSpike.x, _velAtSpike.z);
      const futureFloorY = getCourtFloorY(_ballAtSpike.x, _ballAtSpike.z);
      const futureBallAboveFloor = _ballAtSpike.y - futureFloorY;

      if (ballHorizSpeedAtSpike <= 7.2 && futureBallAboveFloor >= 1.10 && futureBallAboveFloor <= 3.30) {
        const aimYaw = solveOffensiveAimAndTarget(bot, _ballAtSpike, 'spike', freshPerception, params, _playTarget, _velAtSpike, false);
        const aimDirX = Math.sin(aimYaw);
        const aimDirZ = Math.cos(aimYaw);

        const spikeStandoff = 0.78 + ballRadius * 0.25;
        const targetSelfXAt42 = _ballAtSpike.x - aimDirX * spikeStandoff;
        const targetSelfZAt42 = _ballAtSpike.z - aimDirZ * spikeStandoff;

        const toTargetX = targetSelfXAt42 - selfPos.x;
        const toTargetZ = targetSelfZAt42 - selfPos.z;
        const distNowToPocketXZ = Math.hypot(toTargetX, toTargetZ);
        const dtS = spikeSweet * (1 / 60);
        let selfAt42X = selfPos.x;
        let selfAt42Z = selfPos.z;
        if (distNowToPocketXZ > 0.03) {
          const ux = toTargetX / distNowToPocketXZ;
          const uz = toTargetZ / distNowToPocketXZ;
          const vAlong = selfVel.x * ux + selfVel.z * uz;
          const vPerpX = selfVel.x - vAlong * ux;
          const vPerpZ = selfVel.z - vAlong * uz;
          const vPerp = Math.hypot(vPerpX, vPerpZ);
          const sAlong = Math.min(distNowToPocketXZ, Math.max(vAlong * dtS - 0.5 * 3.5 * dtS * dtS, Math.min(5.2 * dtS, vAlong * dtS + 0.5 * 4.0 * dtS * dtS)));
          const remPerp = Math.max(0, vPerp - 3.8 * dtS);
          const sPerpScale = vPerp > 1e-4 ? ((vPerp + remPerp) * 0.5 * dtS) / vPerp : 0;
          selfAt42X = selfPos.x + ux * sAlong + vPerpX * sPerpScale;
          selfAt42Z = selfPos.z + uz * sAlong + vPerpZ * sPerpScale;
        } else {
          const remSpd = Math.max(0, selfSpeedNow - 3.6 * dtS);
          const brkScale = selfSpeedNow > 1e-4 ? ((selfSpeedNow + remSpd) * 0.5 * dtS) / selfSpeedNow : 0;
          selfAt42X = selfPos.x + selfVel.x * brkScale;
          selfAt42Z = selfPos.z + selfVel.z * brkScale;
        }

        let jumpDelayTicks = -1;
        let spikeLimbHeightAboveFloor = 1.32;
        if (futureBallAboveFloor > 1.85) {
          const wantHighJump = futureBallAboveFloor > 2.55;
          const candDelay = wantHighJump ? 24 : 30;
          if (freshPerception.self.grounded && (tick + candDelay - bot.lastJumpTick >= bot.jumpCooldownTicks)) {
            jumpDelayTicks = candDelay;
            spikeLimbHeightAboveFloor = wantHighJump ? 2.78 : 2.39;
          }
        }

        const limbX = selfAt42X + aimDirX * 0.90;
        const limbZ = selfAt42Z + aimDirZ * 0.90;
        const limbY = futureFloorY + spikeLimbHeightAboveFloor;
        const dist3DLimbToBall = Math.hypot(_ballAtSpike.x - limbX, _ballAtSpike.y - limbY, _ballAtSpike.z - limbZ);

        const inSpikeZone = isDefendingRim || distToGoalZ <= 34.0 || (tick < bot.selfSetUntilTick);
        const oppCannotInterceptBeforeSpike = (freshPerception.trajectory?.earliestInterceptTickOpp ?? 480) > spikeSweet + 2;
        const selfSetBonus = (tick < bot.selfSetUntilTick) ? 0.25 : 0.0;
        const spikeSkillGate = Math.min(0.99, (params.spikeAccuracy ?? 0.70) * (0.88 + agg * 0.25) + selfSetBonus);

        if (inSpikeZone && oppCannotInterceptBeforeSpike &&
            distNowToPocketXZ <= 1.55 &&
            dist3DLimbToBall <= effectiveLimbHitRadius * 0.94 &&
            bot.rng() < spikeSkillGate) {
          const finalSpikeYaw = solveOffensiveAimAndTarget(bot, _ballAtSpike, 'spike', freshPerception, params, _playTarget, _velAtSpike, true);
          slot.spikeQueued = true;
          slot.braceHeld = false;
          slot.aimYaw = finalSpikeYaw;
          slot.cameraYaw = finalSpikeYaw;
          slot.hasAim = true;
          bot.lastStrikeTick = tick;
          bot.lastStrikeKind = 'spike';
          bot.lastStrikeSweetTick = spikeSweet;
          bot.lastStrikeAimYaw = finalSpikeYaw;
          bot.stats.strikeAttempts++;
          if (isDefendingRim) {
            bot.stats.hoopBlocks = (bot.stats.hoopBlocks || 0) + 1;
          }
          if (jumpDelayTicks > 0) {
            bot.pendingJumpTick = tick + jumpDelayTicks;
          }
          return;
        }
      }
    }
  }

  // ═══ 2. CANDIDATE: EAST BUTTON — EXACT `eastKind` VOLLEY (15t) vs KICK (8..11t) ═══
  // `predictEastKindAtPress` mirrors `strikes.js:eastKind()` verbatim (`contextRadius`, `kickBelowHips`,
  // `kickHysteresis`, `lastEastKind`) so we never press expecting a Volley and receive a Kick (or vice versa)!
  const eastKindNow = predictEastKindAtPress(athlete, selfPos, ballPos);

  if (eastKindNow === 'volley') {
    // PLATEAU KICK-DROP PATIENCE:
    // Inside `dist3DHoop = 8.5m..15.2m` with wide lateral angle (`|X| >= 2.0m`), a `24.5 m/s` Volley peaks
    // above the `14.67m` top bar unless banked, whereas a `14.5 m/s` Kick arcs dead through `Y = 10.0m`!
    // If the ball is just above `kickBelowHips` and actively dropping (`ballVel.y < -0.8 m/s`) so it will cross
    // into Kick height within ~7 ticks while remaining right in front of us, wait a moment to bury the Kick!
    const dist3DToAttackHoop = Math.hypot(ballPos.x, goalPos.z - ballPos.z);
    const pelvisTarget = athlete?.animTarget?.targets?.get?.('pelvis');
    const pelvisYNow = pelvisTarget ? pelvisTarget.currPos.y : (selfPos.y + 0.467);
    const relPelvisNow = ballPos.y - pelvisYNow;
    const shouldWaitForKickFinish = !isDefendingRim &&
      bot.difficulty !== 'easy' &&
      dist3DToAttackHoop >= 8.5 && dist3DToAttackHoop <= 15.2 &&
      Math.abs(ballPos.x) >= 2.0 &&
      relPelvisNow <= 0.34 &&
      ballVel.y < -0.8 &&
      liveDistXZ <= 1.6 &&
      oppDistToBall > 2.5;

    if (!shouldWaitForKickFinish) {
      // ── VOLLEY EVALUATION CENTERED ON `sweetTick = 15` (`assistWindowTicks = ±6`) ──
      // Measured off Rapier (`probe_whiff_and_hoop`):
      //   Grounded Volley (`+15t`, `phase = 0.483`): `handL/R` & `foreArmL/R` are at `fwd = 0.48m, floor + 1.08m`.
      //   6-tick Hop-Volley (`pendingJumpTick = tick + 6`, 9t = 0.15s air -> +0.87m): `limbY = floor + 1.95m`.
      //   Immediate Jump-Volley (`jumpQueued = true` at press, 15t = 0.25s air -> +1.30m): `limbY = floor + 2.38m`.
      const volleyBaseSweet = TUNING.strike?.volley?.sweetTick ?? 15;
      const volleySweet = Math.max(12, volleyBaseSweet + timingOffset);
      const canJumpNow = !isDiving && freshPerception.self.grounded && (tick - bot.lastJumpTick >= bot.jumpCooldownTicks);
      const volleyStandoff = 0.34 + ballRadius * 0.45;

      let bestVolleyDist3D = Infinity;
      let bestVolleyTick = volleySweet;
      let bestVolleyJumpMode = 0; // 0 = grounded/air, 1 = immediate jump, 2 = 6-tick delayed hop

      for (let offset = -2; offset <= 2; offset += 2) {
        const candTick = Math.max(12, volleySweet + offset);
        sampleTrajectoryAtTick(freshPerception.trajectory, candTick, _ballAtSweet, _velAtSpike);
        const aimYaw = solveOffensiveAimAndTarget(bot, _ballAtSweet, 'volley', freshPerception, params, _playTarget, _velAtSpike, false);
        const aimDirX = Math.sin(aimYaw);
        const aimDirZ = Math.cos(aimYaw);

        const pocketX = _ballAtSweet.x - aimDirX * volleyStandoff;
        const pocketZ = _ballAtSweet.z - aimDirZ * volleyStandoff;
        const toPocketX = pocketX - selfPos.x;
        const toPocketZ = pocketZ - selfPos.z;
        const distToPocket = Math.hypot(toPocketX, toPocketZ);
        if (distToPocket > 1.58) continue;

        const dtV = candTick * (1 / 60);
        let selfAtX = selfPos.x;
        let selfAtZ = selfPos.z;
        if (distToPocket > 0.03) {
          const ux = toPocketX / distToPocket;
          const uz = toPocketZ / distToPocket;
          const vAlong = selfVel.x * ux + selfVel.z * uz;
          const vPerpX = selfVel.x - vAlong * ux;
          const vPerpZ = selfVel.z - vAlong * uz;
          const vPerp = Math.hypot(vPerpX, vPerpZ);
          const sAlong = Math.min(distToPocket, Math.max(vAlong * dtV - 0.5 * 3.5 * dtV * dtV, Math.min(5.4 * dtV, vAlong * dtV + 0.5 * 4.2 * dtV * dtV)));
          const remPerp = Math.max(0, vPerp - 3.8 * dtV);
          const sPerpScale = vPerp > 1e-4 ? ((vPerp + remPerp) * 0.5 * dtV) / vPerp : 0;
          selfAtX = selfPos.x + ux * sAlong + vPerpX * sPerpScale;
          selfAtZ = selfPos.z + uz * sAlong + vPerpZ * sPerpScale;
        } else {
          const remSpd = Math.max(0, selfSpeedNow - 3.6 * dtV);
          const brkScale = selfSpeedNow > 1e-4 ? ((selfSpeedNow + remSpd) * 0.5 * dtV) / selfSpeedNow : 0;
          selfAtX = selfPos.x + selfVel.x * brkScale;
          selfAtZ = selfPos.z + selfVel.z * brkScale;
        }

        const selfFloor = getCourtFloorY(selfAtX, selfAtZ);
        const ballAboveFloor = _ballAtSweet.y - selfFloor;

        let limbY;
        let jumpMode = 0;
        if (!freshPerception.self.grounded) {
          const airBodyY = Math.max(selfFloor + 0.5, selfPos.y + selfVel.y * dtV - 6.0 * dtV * dtV);
          limbY = airBodyY + 0.58;
        } else if (canJumpNow && ballAboveFloor >= 2.16 && ballAboveFloor <= 3.15) {
          // Immediate jump (`7.0 / 1.047 = 6.685 m/s` upward velocity, `-12 m/s²` gravity -> `+1.30m` at 15t)
          const jumpGain = 6.685 * dtV - 6.0 * dtV * dtV;
          limbY = selfFloor + 1.08 + jumpGain;
          jumpMode = 1;
        } else if (canJumpNow && ballAboveFloor >= 1.56 && ballAboveFloor < 2.16) {
          // 6-tick delayed Hop-Volley (`candTick - 6` ticks airborne -> `+0.87m` lift -> `floor + 1.95m`)
          const hopDt = Math.max(0.08, (candTick - 6) * (1 / 60));
          const hopGain = 6.685 * hopDt - 6.0 * hopDt * hopDt;
          limbY = selfFloor + 1.08 + hopGain;
          jumpMode = 2;
        } else {
          limbY = selfFloor + 1.08;
        }

        const limbX = selfAtX + aimDirX * 0.48;
        const limbZ = selfAtZ + aimDirZ * 0.48;
        const dist3D = Math.hypot(_ballAtSweet.x - limbX, _ballAtSweet.y - limbY, _ballAtSweet.z - limbZ);

        if (dist3D < bestVolleyDist3D) {
          bestVolleyDist3D = dist3D;
          bestVolleyTick = candTick;
          bestVolleyJumpMode = jumpMode;
        }
      }

      if (liveDistXZ <= 3.3 && bestVolleyDist3D <= effectiveLimbHitRadius) {
        sampleTrajectoryAtTick(freshPerception.trajectory, bestVolleyTick, _ballAtSweet, _velAtSpike);
        const finalVolleyYaw = solveOffensiveAimAndTarget(bot, _ballAtSweet, 'volley', freshPerception, params, _playTarget, _velAtSpike, true);
        if (bestVolleyJumpMode === 1) {
          slot.jumpQueued = true;
          bot.lastJumpTick = tick;
        } else if (bestVolleyJumpMode === 2) {
          bot.pendingJumpTick = tick + 6;
        }
        slot.volleyQueued = true;
        slot.braceHeld = false;
        slot.aimYaw = finalVolleyYaw;
        slot.cameraYaw = finalVolleyYaw;
        slot.hasAim = true;
        bot.lastStrikeTick = tick;
        bot.lastStrikeKind = 'volley';
        bot.lastStrikeSweetTick = bestVolleyTick;
        bot.lastStrikeAimYaw = finalVolleyYaw;
        bot.stats.strikeAttempts++;
        if (isDefendingRim) {
          bot.stats.hoopBlocks = (bot.stats.hoopBlocks || 0) + 1;
        }
        return;
      }
    }
  } else {
    // ── KICK EVALUATION IN THE `[8..13]` PERFECT/ASSIST BAND (`calf/foot` at `fwd = 0.34m, floor + 0.34m`) ──
    const kickBaseSweet = (TUNING.strike?.kick?.sweetTick ?? 8) + 2; // center on +10t (inside q=1.0 [8..13] & assist [8..14])
    const kickSweet = Math.max(8, kickBaseSweet + Math.round(timingOffset * 0.5));
    const kickStandoff = 0.24 + ballRadius * 0.45;

    let bestKickDist3D = Infinity;
    let bestKickTick = kickSweet;

    for (let offset = -1; offset <= 1; offset += 1) {
      const candTick = Math.max(8, kickSweet + offset);
      sampleTrajectoryAtTick(freshPerception.trajectory, candTick, _ballAtSweet, _velAtSpike);
      const aimYaw = solveOffensiveAimAndTarget(bot, _ballAtSweet, 'kick', freshPerception, params, _playTarget, _velAtSpike, false);
      const aimDirX = Math.sin(aimYaw);
      const aimDirZ = Math.cos(aimYaw);

      const pocketX = _ballAtSweet.x - aimDirX * kickStandoff;
      const pocketZ = _ballAtSweet.z - aimDirZ * kickStandoff;
      const toPocketX = pocketX - selfPos.x;
      const toPocketZ = pocketZ - selfPos.z;
      const distToPocket = Math.hypot(toPocketX, toPocketZ);
      if (distToPocket > 0.95) continue;

      const dtK = candTick * (1 / 60);
      let selfAtX = selfPos.x;
      let selfAtZ = selfPos.z;
      if (distToPocket > 0.03) {
        const ux = toPocketX / distToPocket;
        const uz = toPocketZ / distToPocket;
        const vAlong = selfVel.x * ux + selfVel.z * uz;
        const vPerpX = selfVel.x - vAlong * ux;
        const vPerpZ = selfVel.z - vAlong * uz;
        const vPerp = Math.hypot(vPerpX, vPerpZ);
        const sAlong = Math.min(distToPocket, Math.max(vAlong * dtK - 0.5 * 3.5 * dtK * dtK, Math.min(5.2 * dtK, vAlong * dtK + 0.5 * 4.2 * dtK * dtK)));
        const remPerp = Math.max(0, vPerp - 3.8 * dtK);
        const sPerpScale = vPerp > 1e-4 ? ((vPerp + remPerp) * 0.5 * dtK) / vPerp : 0;
        selfAtX = selfPos.x + ux * sAlong + vPerpX * sPerpScale;
        selfAtZ = selfPos.z + uz * sAlong + vPerpZ * sPerpScale;
      } else {
        const remSpd = Math.max(0, selfSpeedNow - 3.6 * dtK);
        const brkScale = selfSpeedNow > 1e-4 ? ((selfSpeedNow + remSpd) * 0.5 * dtK) / selfSpeedNow : 0;
        selfAtX = selfPos.x + selfVel.x * brkScale;
        selfAtZ = selfPos.z + selfVel.z * brkScale;
      }
      const selfFloor = getCourtFloorY(selfAtX, selfAtZ);

      const limbX = selfAtX + aimDirX * 0.34;
      const limbZ = selfAtZ + aimDirZ * 0.34;
      const limbY = selfFloor + 0.34;
      const dist3D = Math.hypot(_ballAtSweet.x - limbX, _ballAtSweet.y - limbY, _ballAtSweet.z - limbZ);

      if (dist3D < bestKickDist3D) {
        bestKickDist3D = dist3D;
        bestKickTick = candTick;
      }
    }

    if (liveDistXZ <= 2.3 && bestKickDist3D <= effectiveLimbHitRadius) {
      sampleTrajectoryAtTick(freshPerception.trajectory, bestKickTick, _ballAtSweet, _velAtSpike);
      const finalKickYaw = solveOffensiveAimAndTarget(bot, _ballAtSweet, 'kick', freshPerception, params, _playTarget, _velAtSpike, true);
      slot.volleyQueued = true; // East button triggers Kick because `eastKindNow === 'kick'`
      slot.braceHeld = false;
      slot.aimYaw = finalKickYaw;
      slot.cameraYaw = finalKickYaw;
      slot.hasAim = true;
      bot.lastStrikeTick = tick;
      bot.lastStrikeKind = 'kick';
      bot.lastStrikeSweetTick = bestKickTick;
      bot.lastStrikeAimYaw = finalKickYaw;
      if (distToGoalZ > 15.6) {
        // Flag that we just popped a +55° Kick Self-Set onto the wing so we eagerly chase & finish it!
        bot.selfSetUntilTick = tick + 80;
      }
      bot.stats.strikeAttempts++;
      if (isDefendingRim) {
        bot.stats.hoopBlocks = (bot.stats.hoopBlocks || 0) + 1;
      }
      return;
    }
  }

  // ═══ 3. DISCIPLINED BRACE-DIVE INTERCEPT SAVES & RARE GOAL-MOUTH FINISHES ═══
  // Because diving inflicts a ~3.0s ragdoll + getup recovery penalty, open-court dives are
  // replaced by Sliding Blocks (`updateTacticalSlideAndBlock`). Dives are strictly reserved for:
  //   A. High-danger defensive goal-mouth saves (ALWAYS paired with `slot.braceHeld = true`
  //      to trigger the upright Brace-Dive Intercept Lunge in `actions.js:solveBraceDiveIntercept`!)
  //   B. Rare wide-open attacking goal-mouth finishes right in front of the opponent's hoop.
  const diveCooldown = params.diveCooldownTicks ?? 180;
  if (freshPerception.self.grounded && !isDiving && (tick - bot.lastDiveTick >= diveCooldown) && liveDistXZ >= 1.90) {
    const isDefSouth = defendGoalPos.z > 0;
    const hasBounce = freshPerception.trajectory.hasBounce && !freshPerception.ball.isGrounded;
    const bounceTicks = freshPerception.trajectory.ticksToNextBounce;

    sampleTrajectoryAtTick(freshPerception.trajectory, 14, _ballAtSweet);
    const targetDivePos = (hasBounce && bounceTicks >= 6 && bounceTicks <= 22)
      ? freshPerception.trajectory.nextBouncePos
      : _ballAtSweet;

    const landingX = targetDivePos.x;
    const landingZ = targetDivePos.z;
    const eventTicks = (hasBounce && bounceTicks >= 6 && bounceTicks <= 22) ? bounceTicks : 14;
    const cannotReachUprightInTime = !freshPerception.trajectory.canReachBeforeBounceSelf ||
      freshPerception.ballIntercept.ticksToArrive > eventTicks + 4;

    // Condition A: High-Danger Defensive Goal-Mouth Save (Brace-Dive Intercept)
    const inDefendingDangerZone = Math.abs(landingX) <= 9.2 && (
      isDefSouth ? (landingZ >= 21.0 && landingZ <= 42.0) : (landingZ <= -21.0 && landingZ >= -42.0)
    );
    const velTowardOurGoal = ballVel.z * Math.sign(defendGoalPos.z);
    const isHighDangerDefensiveSave = inDefendingDangerZone && cannotReachUprightInTime &&
      (freshPerception.threat > 0.36 || velTowardOurGoal > 3.2);

    // Condition B: Rare Wide-Open Attacking Goal-Mouth Finish
    const distLandingToAttackGoalZ = Math.abs(goalPos.z - landingZ);
    const isAttackingGoalMouthFinish = !inDefendingDangerZone &&
      hasBounce && (bounceTicks >= 6 && bounceTicks <= 14) &&
      distLandingToAttackGoalZ <= 10.5 && Math.abs(landingX) <= 7.5 &&
      oppDistToBall > 5.0 && cannotReachUprightInTime && agg >= 0.58;

    if (isHighDangerDefensiveSave || isAttackingGoalMouthFinish) {
      const distToDiveTarget = Math.hypot(landingX - selfPos.x, landingZ - selfPos.z);
      const diveMin = Math.max(1.90, params.diveDistMin ?? 1.90);
      const diveMax = Math.min(4.35, params.diveDistMax ?? 4.35);

      if (distToDiveTarget >= diveMin && distToDiveTarget <= diveMax) {
        const diveYaw = computeAimYaw(selfPos, targetDivePos);
        const diveDirX = Math.sin(diveYaw);
        const diveDirZ = Math.cos(diveYaw);
        const vecToDefend = freshPerception.hoops.vecToDefendGoal;
        const dotDiveDefend = diveDirX * vecToDefend.x + diveDirZ * vecToDefend.z;

        // When near our defending goal mouth, never dive backward into our own net
        if (!inDefendingDangerZone || dotDiveDefend <= 0.12) {
          const diveChance = Math.min(0.92, (params.diveAccuracy ?? 0.55) * (0.75 + agg * 0.30));
          if (bot.rng() < diveChance) {
            bot.lastDiveTick = tick;
            slot.diveQueued = true;
            // Always pair defensive dives with Block (`braceHeld = true`) to trigger Brace-Dive Intercept!
            if (isHighDangerDefensiveSave) {
              slot.braceHeld = true;
            }
            slot.aimYaw = diveYaw;
            slot.cameraYaw = diveYaw;
            slot.hasAim = true;
            slot.moveWorld.set(diveDirX, 0, diveDirZ);
            slot.moveX = diveDirX;
            slot.moveZ = diveDirZ;
          }
        }
      }
    }
  }
}
