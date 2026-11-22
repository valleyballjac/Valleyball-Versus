/**
 * Regression tests for Stage 2 AI Style Differentiation, Kinematic Braking, and Goal-Side Perception.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  createBotController,
  computeDynamicAggressiveness,
  updateBot,
  STRATEGY,
} from '../src/ai/botController.js';
import { steerToward, steerGoalSideArc } from '../src/ai/botSteering.js';
import { buildPerception, createPerception } from '../src/ai/botPerception.js';

function makeMockSlot() {
  return {
    moveX: 0,
    moveZ: 0,
    moveWorld: new THREE.Vector3(),
    sprintHeld: false,
    slideHeld: false,
    braceHeld: false,
    jumpQueued: false,
    diveQueued: false,
    cutQueued: false,
    volleyQueued: false,
    spikeQueued: false,
    aimYaw: 0,
    cameraYaw: 0,
    hasAim: false,
  };
}

function makeMockAthlete({ x, y = 1.0, z, vx = 0, vy = 0, vz = 0, team = 'home', slotIndex = 0 }) {
  return {
    slotIndex,
    team,
    isEnabled: true,
    motor: {
      grounded: true,
      body: {
        translation: () => ({ x, y, z }),
        linvel: () => ({ x: vx, y: vy, z: vz }),
      },
    },
    tracker: { weight: 1.0 },
    actionState: { sliding: false, slideTime: 0, braceMix: 0 },
    strikeState: { assistRadius: 0.45, lastEastKind: 0 },
    animTarget: { yaw: 0, targets: null },
  };
}

function makeMockBall({ x, y = 1.0, z, vx = 0, vy = 0, vz = 0, radius = 0.5, id = 'medium' }) {
  return {
    id,
    radius,
    body: {
      translation: () => ({ x, y, z }),
      linvel: () => ({ x: vx, y: vy, z: vz }),
    },
  };
}

test('computeDynamicAggressiveness keeps DEF < BAL < AGG < ALL strictly separated even when trailing', () => {
  const styles = [0.25, 0.60, 0.80, 1.00];
  const trailingMatch = { scoreHome: 0, scoreAway: 3, ticksRemaining: 600 };
  const leadingMatch = { scoreHome: 3, scoreAway: 0, ticksRemaining: 600 };
  const perception = { hoops: { isHome: true } };

  const trailingVals = styles.map((agg) =>
    computeDynamicAggressiveness(createBotController({ aggressiveness: agg }), trailingMatch, perception),
  );
  const leadingVals = styles.map((agg) =>
    computeDynamicAggressiveness(createBotController({ aggressiveness: agg }), leadingMatch, perception),
  );

  for (let i = 0; i < styles.length - 1; i++) {
    assert.ok(trailingVals[i] < trailingVals[i + 1], `trailing monotonic failed: ${trailingVals}`);
    assert.ok(leadingVals[i] < leadingVals[i + 1], `leading monotonic failed: ${leadingVals}`);
  }
  // DEF trailing must still stay strictly below BAL leading (no style inversion!)
  assert.ok(trailingVals[0] < leadingVals[1], `DEF trailing (${trailingVals[0]}) overlapped BAL leading (${leadingVals[1]})`);
});

test('steerToward brakes or counter-brakes when closing too fast on an arrive pocket', () => {
  // Moderate overspeed: releases stick cleanly to coast-brake (`brakeTorque = 4`)
  const coastSlot = makeMockSlot();
  steerToward(
    coastSlot,
    { x: 0, y: 0.5, z: 0 },
    { x: 0, y: 0.5, z: 0.85 },
    {
      sprint: false,
      arrive: true,
      arriveRadius: 0.90,
      maxSpeed: 1.0,
      minDrive: 0.0,
      currentVel: { x: 0, y: 0, z: 3.6 },
    },
  );
  assert.equal(coastSlot.moveX, 0);
  assert.equal(coastSlot.moveZ, 0);
  assert.equal(coastSlot.sprintHeld, false);

  // Hot downhill overspeed (8.5 m/s inside stopping distance): drops sprint & actively counter-brakes (`moveZ < -0.4`)
  const plantSlot = makeMockSlot();
  steerToward(
    plantSlot,
    { x: 0, y: 0.5, z: 0 },
    { x: 0, y: 0.5, z: 2.2 },
    {
      sprint: true,
      arrive: true,
      arriveRadius: 0.70,
      maxSpeed: 1.0,
      minDrive: 0.60,
      currentVel: { x: 0, y: 0, z: 8.5 },
    },
  );
  assert.ok(plantSlot.moveZ < -0.4, `Expected active counter-brake moveZ < -0.4, got ${plantSlot.moveZ}`);
  assert.equal(plantSlot.sprintHeld, false);
});

test('buildPerception allows attacking-third wing cross strikes while guarding own-goal third', () => {
  const matchState = { targetGoal: 'N', isCountingDown: false, matchOver: false };

  // Attacking third wing cross: ball at (8, 1.5, -38), home athlete slightly ahead at (10, 1.5, -41)
  const wingAth = makeMockAthlete({ x: 10, y: 5.5, z: -41, team: 'home', slotIndex: 0 });
  const oppAth = makeMockAthlete({ x: -8, y: 5.5, z: -30, team: 'away', slotIndex: 1 });
  const wingBall = makeMockBall({ x: 8, y: 5.8, z: -38 });
  const pWing = buildPerception(wingAth, oppAth, [wingBall], matchState, 100, createPerception());
  assert.equal(pWing.goalSide.isGoalSide, true, 'wing cross angle in attacking third should be strike-eligible');

  // Defending third wrong side: home defends South (+40); athlete at z = +26 behind ball at z = +30 (facing own hoop!)
  const ownAth = makeMockAthlete({ x: 2, y: 3.5, z: 26, team: 'home', slotIndex: 0 });
  const ownBall = makeMockBall({ x: 2, y: 4.0, z: 30 });
  const pOwn = buildPerception(ownAth, oppAth, [ownBall], matchState, 100, createPerception());
  assert.equal(pOwn.goalSide.isGoalSide, false, 'wrong-side position in own defending third must remain blocked');
});

test('DEF style drops to DEFEND while ALL style presses forward in the same midfield threat scenario', () => {
  const matchState = {
    mode: 'match',
    targetGoal: 'N',
    scoreHome: 0,
    scoreAway: 0,
    ticksRemaining: 10000,
    isCountingDown: false,
    matchOver: false,
  };
  const selfAth = makeMockAthlete({ x: 0, y: 1.5, z: 14, team: 'home', slotIndex: 0 });
  const oppAth = makeMockAthlete({ x: 1.0, y: 1.5, z: 7.5, team: 'away', slotIndex: 1 });
  const ball = makeMockBall({ x: 0.8, y: 1.5, z: 8.2, vx: 0, vy: 0, vz: 2.2 });

  const defBot = createBotController({ difficulty: 'hard', slotIndex: 0, seed: 7, aggressiveness: 0.25 });
  const allBot = createBotController({ difficulty: 'hard', slotIndex: 0, seed: 7, aggressiveness: 1.00 });

  updateBot(defBot, selfAth, oppAth, [ball], matchState, makeMockSlot(), 60, 1 / 60);
  updateBot(allBot, selfAth, oppAth, [ball], matchState, makeMockSlot(), 60, 1 / 60);

  assert.equal(defBot.strategy, STRATEGY.DEFEND, 'DEF bot should drop to DEFEND on midfield opponent threat');
  assert.notEqual(allBot.strategy, STRATEGY.DEFEND, 'ALL bot should press aggressively instead of retreating');
});

test('wrong-side retreating bot never holds braceHeld or swings backward toward defending goal', () => {
  const matchState = {
    mode: 'match',
    targetGoal: 'N',
    scoreHome: 0,
    scoreAway: 0,
    ticksRemaining: 10000,
    isCountingDown: false,
    matchOver: false,
  };
  // Home attacks North (-40), defends South (+40).
  // Athlete at z = -10 is AHEAD of the ball at z = -8.6 (wrong side!) while ball rolls South (+3 m/s).
  // Athlete facing yaw = 0 (+Z = straight toward defending South hoop!).
  const selfAth = makeMockAthlete({ x: 0.2, y: 1.0, z: -10.0, vx: 0, vy: 0, vz: 3.0, team: 'home', slotIndex: 0 });
  selfAth.animTarget.yaw = 0;
  const oppAth = makeMockAthlete({ x: -8, y: 1.0, z: 12, team: 'away', slotIndex: 1 });
  const ball = makeMockBall({ x: 0.2, y: 1.0, z: -8.6, vx: 0, vy: 0, vz: 3.0 });

  const bot = createBotController({ difficulty: 'hard', slotIndex: 0, seed: 11, aggressiveness: 0.80 });
  const slot = makeMockSlot();
  updateBot(bot, selfAth, oppAth, [ball], matchState, slot, 120, 1 / 60);

  assert.equal(slot.braceHeld, false, 'Wrong-side retreating bot facing defending goal must NEVER hold braceHeld');
  assert.equal(slot.volleyQueued, false, 'Wrong-side bot must never queue a volley from ahead of the ball');
  assert.equal(slot.spikeQueued, false, 'Wrong-side bot must never queue a spike from ahead of the ball');
});

test('steerToward still brakes inside arrive zone even with nonzero minDrive, and steerGoalSideArc steps laterally clear', () => {
  const brakeSlot = makeMockSlot();
  steerToward(
    brakeSlot,
    { x: 0, y: 0.5, z: 0 },
    { x: 0, y: 0.5, z: 0.70 },
    {
      sprint: true,
      arrive: true,
      arriveRadius: 0.80,
      maxSpeed: 1.0,
      minDrive: 0.60, // Previously disabled allowBrake completely!
      currentVel: { x: 0, y: 0, z: 5.5 },
    },
  );
  assert.ok(brakeSlot.moveZ <= 0, `Expected coast or counter-brake (moveZ <= 0), got ${brakeSlot.moveZ}`);
  assert.equal(brakeSlot.sprintHeld, false);

  // Directly ahead of a Large ball (radius 0.75m): must step laterally clear instead of driving backward through the ball!
  const arcSlot = makeMockSlot();
  steerGoalSideArc(
    arcSlot,
    { x: 0.2, y: 0.5, z: -1.2 },
    { x: 0.0, y: 0.5, z: 0.0 },
    { x: 0.0, y: 0.5, z: 40.0 },
    { ballRadius: 0.75, currentVel: { x: 0, y: 0, z: 0 } },
  );
  assert.ok(Math.abs(arcSlot.moveX) > 0.75, `Expected strong lateral clearance around ball, got moveX=${arcSlot.moveX.toFixed(2)}`);
});
