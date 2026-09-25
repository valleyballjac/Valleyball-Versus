/**
 * Fitness scoring module for Valleyball AI evolutionary parameter optimization.
 * Accumulates per-tick statistics during headless matches and computes a final fitness score.
 */

/**
 * Creates a new fitness accumulator for the given side.
 * @param {'home'|'away'} side The side the AI is playing on.
 * @returns {object} The accumulator object.
 */
export function createFitnessAccumulator(side) {
  return {
    side,
    ticks: 0,
    ticksNearBall: 0,
    ticksInAttackingHalf: 0,
    ticksFacingPlay: 0,
    strikeAttempts: 0,
    strikesLanded: 0,
    sweetSpotHits: 0,
    totalQuality: 0,
    onTargetShots: 0,
    defensiveBlocks: 0,
    divingHits: 0,
    divesAttempted: 0,
    cutsAttempted: 0,
    hoopBlocks: 0,
    oppCircleTouches: 0,
    ownCircleTouches: 0,
    whiffs: 0,
    totalDistanceToBall: 0,
    ticksRecovering: 0,
  };
}

/**
 * Accumulates statistics for a single tick.
 *
 * Reads from the headless match object which has:
 *   motorBodyA, motorBodyB  — Rapier rigid bodies
 *   slotA, slotB            — input slots
 *   ballBody                — Rapier rigid body for the ball
 *   matchState              — { targetGoal: 'N'|'S', ... }
 *   lastHits                — array of strikes that connected
 *   whiffs                  — whiff counts
 *
 * @param {object} acc   The fitness accumulator.
 * @param {object} match The headless match object.
 */
export function accumulateTick(acc, match) {
  const isHome = acc.side === 'home';
  const motorBody = isHome ? match.motorBodyA : match.motorBodyB;
  const slot = isHome ? match.slotA : match.slotB;
  const athlete = isHome ? match.athleteA : match.athleteB;

  if (!motorBody || !match.ballBody) return;

  const pos = motorBody.translation();
  const ballPos = match.ballBody.translation();
  const ballVel = match.ballBody.linvel();

  const dx = pos.x - ballPos.x;
  const dy = pos.y - ballPos.y;
  const dz = pos.z - ballPos.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  acc.ticks++;
  acc.totalDistanceToBall += distance;

  // Proximity tracking — within 5m of ball
  if (distance < 5.0) {
    acc.ticksNearBall++;
  }

  // Territorial control — are we in the attacking half?
  const targetGoal = match.matchState?.targetGoal || 'N';
  const targetZ = (isHome ? (targetGoal === 'N' ? -40 : 40) : (targetGoal === 'N' ? 40 : -40));
  const defendZ = -targetZ;

  const inAttackingHalf = (targetZ < 0) ? (pos.z < 0) : (pos.z > 0);
  if (inAttackingHalf) {
    acc.ticksInAttackingHalf++;
  }

  // Facing alignment: reward athlete facing toward the play / ball
  const facingYaw = athlete.animTarget?.yaw ?? 0;
  const toBallYaw = Math.atan2(ballPos.x - pos.x, ballPos.z - pos.z);
  const yawDiff = Math.abs(Math.atan2(Math.sin(facingYaw - toBallYaw), Math.cos(facingYaw - toBallYaw)));
  if (yawDiff < 1.0) {
    acc.ticksFacingPlay++;
  }

  // Defensive blocking tracking: ball was heading to our goal and was intercepted
  const ballHeadingToOurGoal = (defendZ < 0) ? (ballVel.z < -3.0) : (ballVel.z > 3.0);
  if (ballHeadingToOurGoal && distance < 2.5) {
    acc.defensiveBlocks++;
  }

  // Strike attempts
  if (slot.volleyQueued || slot.spikeQueued) {
    acc.strikeAttempts++;
  }

  // Dive attempts tracking
  if (match.dives) {
    acc.divesAttempted = match.dives[acc.side] || 0;
  }
  if (match.divingHits) {
    acc.divingHits = match.divingHits[acc.side] || 0;
  }
  if (match.sweetSpotHits) {
    acc.sweetSpotHits = match.sweetSpotHits[acc.side] || 0;
  }
  if (match.oppCircleTouches) {
    acc.oppCircleTouches = match.oppCircleTouches[acc.side] || 0;
  }
  if (match.ownCircleTouches) {
    acc.ownCircleTouches = match.ownCircleTouches[acc.side] || 0;
  }

  // Cuts and hoop blocks from bot stats
  const bot = isHome ? match.botA : match.botB;
  if (bot && bot.stats) {
    acc.cutsAttempted = bot.stats.cutCount || 0;
    acc.hoopBlocks = bot.stats.hoopBlocks || 0;
  }

  // Drain hits that landed this tick for our side
  if (match.lastHits && match.lastHits.length > 0) {
    for (let i = match.lastHits.length - 1; i >= 0; i--) {
      const h = match.lastHits[i];
      if (h.tick === match.tick && h.side === acc.side) {
        acc.strikesLanded++;
        acc.totalQuality += h.quality;

        if (h.quality >= 0.85) {
          acc.sweetSpotHits++;
        }

        // Check if on-target toward attack goal
        const shotHeadingToTarget = (targetZ < 0) ? (h.dirZ < -0.3) : (h.dirZ > 0.3);
        if (shotHeadingToTarget) {
          acc.onTargetShots++;
        }

        // Scoring circle proximity (within 16m key area of either hoop)
        const hitPos = h.pos || ballPos;
        const distToAttackGoal = Math.hypot(hitPos.x, hitPos.z - targetZ);
        if (distToAttackGoal <= 16.0) {
          acc.oppCircleTouches++;
        }
        const distToDefendGoal = Math.hypot(hitPos.x, hitPos.z - defendZ);
        if (distToDefendGoal <= 16.0) {
          acc.ownCircleTouches++;
        }
      }
    }
  }

  // Sync whiffs
  if (match.whiffs) {
    acc.whiffs = match.whiffs[acc.side] || 0;
  }
}

/**
 * Computes the final fitness score based on accumulated statistics.
 *
 * @param {object} acc        The accumulated statistics.
 * @param {object} matchState The final match state containing scores.
 * @returns {{ fitness: number, breakdown: object }} The fitness score and its components.
 */
export function computeFitness(acc, matchState) {
  const isHome = acc.side === 'home';
  const goalsScored = isHome ? (matchState.scoreHome || 0) : (matchState.scoreAway || 0);
  const goalsConceded = isHome ? (matchState.scoreAway || 0) : (matchState.scoreHome || 0);

  const scoreGoals = goalsScored * 150.0;
  const scoreConceded = goalsConceded * -75.0;
  const scoreLanded = acc.strikesLanded * 25.0;
  const scoreSweet = acc.sweetSpotHits * 20.0;
  const scoreQuality = acc.totalQuality * 15.0;
  const scoreOnTarget = acc.onTargetShots * 30.0;
  const scoreDivingHits = acc.divingHits * 60.0; // High reward for clutch diving saves
  const scoreWhiffedDives = Math.max(0, acc.divesAttempted - acc.divingHits) * -25.0; // Penalty for wasted belly-flops
  const scoreOppCircle = acc.oppCircleTouches * 15.0;
  const scoreOwnCircle = acc.ownCircleTouches * 10.0;
  const scoreDefBlocks = Math.min(20, acc.defensiveBlocks) * 2.0;
  const scoreHoopBlocks = (acc.hoopBlocks || 0) * 45.0; // Reward for rim defense swats
  const scoreCuts = Math.min(20, acc.cutsAttempted || 0) * 3.0; // Reward for athletic plant-and-redirect agility
  const scoreFacing = acc.ticksFacingPlay * 0.01;
  const scoreWhiffs = acc.whiffs * -15.0;
  const scoreProximity = acc.ticksNearBall * 0.01;
  const scoreTerritory = acc.ticksInAttackingHalf * 0.005;

  const avgDistance = acc.ticks > 0 ? acc.totalDistanceToBall / acc.ticks : 0;
  const scoreAvgDist = avgDistance * -0.05;

  const fitness = scoreGoals + scoreConceded + scoreLanded + scoreSweet + scoreQuality +
                  scoreOnTarget + scoreDivingHits + scoreWhiffedDives + scoreOppCircle +
                  scoreOwnCircle + scoreDefBlocks + scoreHoopBlocks + scoreCuts +
                  scoreFacing + scoreWhiffs + scoreProximity + scoreTerritory + scoreAvgDist;

  return {
    fitness: Math.max(0, fitness),
    breakdown: {
      goals: goalsScored,
      conceded: goalsConceded,
      strikesLanded: acc.strikesLanded,
      sweetSpotHits: acc.sweetSpotHits,
      qualityScore: scoreQuality,
      onTarget: acc.onTargetShots,
      divingHits: acc.divingHits,
      divesAttempted: acc.divesAttempted,
      cutsAttempted: acc.cutsAttempted,
      hoopBlocks: acc.hoopBlocks,
      oppCircleTouches: acc.oppCircleTouches,
      ownCircleTouches: acc.ownCircleTouches,
      whiffs: acc.whiffs,
      proximity: scoreProximity,
      territory: scoreTerritory,
      avgDist: avgDistance,
    },
  };
}
