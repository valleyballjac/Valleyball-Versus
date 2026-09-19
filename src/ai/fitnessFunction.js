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
    strikeAttempts: 0,
    strikesLanded: 0,
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
 *
 * @param {object} acc   The fitness accumulator.
 * @param {object} match The headless match object.
 */
export function accumulateTick(acc, match) {
  const isHome = acc.side === 'home';
  const motorBody = isHome ? match.motorBodyA : match.motorBodyB;
  const slot = isHome ? match.slotA : match.slotB;

  if (!motorBody || !match.ballBody) return;

  const pos = motorBody.translation();
  const ballPos = match.ballBody.translation();

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
  // Home attacks the targetGoal direction: 'N' means attack z<0, 'S' means attack z>0
  // Away attacks opposite.
  const targetGoal = match.matchState?.targetGoal || 'N';
  let inAttackingHalf = false;
  if (isHome) {
    // Home attacks targetGoal
    inAttackingHalf = targetGoal === 'N' ? pos.z < 0 : pos.z > 0;
  } else {
    // Away attacks opposite of targetGoal
    inAttackingHalf = targetGoal === 'N' ? pos.z > 0 : pos.z < 0;
  }
  if (inAttackingHalf) {
    acc.ticksInAttackingHalf++;
  }

  // Strike attempts and landings
  if (slot.volleyQueued || slot.spikeQueued) {
    acc.strikeAttempts++;
    if (distance < 2.5) {
      acc.strikesLanded++;
    }
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

  const scoreGoals = goalsScored * 100.0;
  const scoreConceded = goalsConceded * -50.0;
  const scoreProximity = acc.ticksNearBall * 0.01;
  const scoreTerritory = acc.ticksInAttackingHalf * 0.005;
  const scoreStrikes = acc.strikeAttempts * 2.0;
  const scoreLanded = acc.strikesLanded * 5.0;
  const avgDistance = acc.ticks > 0 ? acc.totalDistanceToBall / acc.ticks : 0;
  const scoreAvgDist = avgDistance * -0.1;
  const scoreRecovery = acc.ticksRecovering * -0.02;

  const fitness = scoreGoals + scoreConceded + scoreProximity + scoreTerritory +
                  scoreStrikes + scoreLanded + scoreAvgDist + scoreRecovery;

  return {
    fitness,
    breakdown: {
      goals: goalsScored,
      conceded: goalsConceded,
      proximity: scoreProximity,
      territory: scoreTerritory,
      strikes: scoreStrikes + scoreLanded,
      avgDist: avgDistance,
    },
  };
}
