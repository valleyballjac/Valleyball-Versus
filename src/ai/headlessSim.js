/**
 * HEADLESS MATCH SIMULATION — a minimal physics simulation for AI training.
 *
 * Creates a simplified Rapier physics world with motor spheres and a ball,
 * runs the bot controller against it, and tracks scoring. No Three.js
 * rendering, no ragdolls, no animation — just the physics that matter
 * for training: movement, ball trajectory, and scoring.
 *
 * The simplified motor uses direct force application capped at real game
 * speeds (6 m/s sprint), and strikes apply impulses matching the real
 * game's launch velocities. ~80% fidelity at 100x speed.
 *
 * LAW 6 — all timing in integer ticks, deterministic given the same seed.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from '../config/tuning.js';
import { createBotController, updateBot } from './botController.js';
import { testHoopCrossing } from '../mechanics/scoring.js';

// ═══ CONSTANTS ═══
const DT = 1 / 60;
const MOTOR_RADIUS = 0.5;
const MOTOR_MASS = 2.618;   // 4/3 * π * 0.5³ * density 2.0
const MAX_SPEED = 6.0;      // m/s horizontal sprint cap
const MOTOR_FORCE = 35.0;   // Tuned to reach MAX_SPEED in ~1s on flat ground
const BRAKE_DECEL = 12.0;   // m/s² braking deceleration
const JUMP_IMPULSE = 7.0;
const JUMP_COOLDOWN = 90;   // ticks
const AIR_CONTROL = 0.15;

const BALL_RADIUS = 0.50;   // Medium ball
const BALL_DENSITY = 0.0042;
const BALL_FRICTION = 0.8;
const BALL_RESTITUTION = 0.88;
const BALL_DRAG = 0.012;

// Hoop geometry from TUNING
const HOOP_RADIUS = 4.667;
const HOOP_CENTER_Y = 10.0;
const HOOP_NORTH_Z = -40.0;
const HOOP_SOUTH_Z = 40.0;
const HOOP_REARM_X = 1.2;

// Strike launch velocities (from TUNING.strikes)
const STRIKE = {
  volley: { speed: 14.0, elevDeg: 55 },
  spike:  { speed: 22.0, elevDeg: -18 },
  kick:   { speed: 10.0, elevDeg: 50 },
};

const KILL_PLANE_Y = -15;
const ARENA_HALF_X = 50;
const ARENA_HALF_Z = 60;

// ═══ SCRATCH VECTORS ═══
const _v1 = new THREE.Vector3();
const _moveWorld = new THREE.Vector3();

/**
 * Initialize Rapier WASM. Must be called once before creating matches.
 */
export async function initHeadless() {
  await RAPIER.init();
  return RAPIER;
}

/**
 * Create a new input slot matching the real game's interface.
 */
function createInputSlot() {
  return {
    moveX: 0, moveZ: 0,
    moveWorld: new THREE.Vector3(),
    sprintHeld: false, slideHeld: false,
    jumpQueued: false, diveQueued: false,
    volleyQueued: false, spikeQueued: false,
    ballResetQueued: false,
    lookX: 0, lookY: 0,
    hasAim: false, aimYaw: 0, cameraYaw: 0,
  };
}

/**
 * Reset an input slot to neutral.
 */
function clearSlot(slot) {
  slot.moveX = 0; slot.moveZ = 0;
  slot.moveWorld.set(0, 0, 0);
  slot.sprintHeld = false; slot.slideHeld = false;
  slot.jumpQueued = false; slot.diveQueued = false;
  slot.volleyQueued = false; slot.spikeQueued = false;
  slot.ballResetQueued = false;
  slot.hasAim = false; slot.aimYaw = 0; slot.cameraYaw = 0;
}

/**
 * Create a mock athlete that matches the interface the bot perception reads.
 */
function createMockAthlete(motorBody) {
  return {
    motor: {
      body: motorBody,
      grounded: true,
    },
    tracker: {
      weight: 1.0,
    },
    animTarget: {
      yaw: 0,
    },
    strikeState: null,
  };
}

/**
 * Create a headless match with two bots.
 *
 * @param {object} paramsA  bot parameters for player A (home, slot 0)
 * @param {object} paramsB  bot parameters for player B (away, slot 1)
 * @param {object} opts     { matchTicks, seedA, seedB }
 * @returns {object} match state
 */
export function createHeadlessMatch(paramsA, paramsB, opts = {}) {
  const matchTicks = opts.matchTicks || (120 * 60); // 2 minutes default
  const seedA = opts.seedA || 42;
  const seedB = opts.seedB || 137;

  // ═══ RAPIER WORLD ═══
  const world = new RAPIER.World({ x: 0, y: TUNING.physics.gravityY, z: 0 });

  // Ground plane (large flat cuboid)
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(ARENA_HALF_X, 0.5, ARENA_HALF_Z)
      .setTranslation(0, -0.5, 0)
      .setFriction(1.0)
      .setRestitution(0.0),
    groundBody,
  );

  // ═══ MOTOR SPHERES ═══
  const motorBodyA = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, MOTOR_RADIUS + 0.1, 20)
      .setLinearDamping(0.5),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(MOTOR_RADIUS)
      .setDensity(2.0)
      .setFriction(1.0)
      .setRestitution(0.0),
    motorBodyA,
  );

  const motorBodyB = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, MOTOR_RADIUS + 0.1, -20)
      .setLinearDamping(0.5),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(MOTOR_RADIUS)
      .setDensity(2.0)
      .setFriction(1.0)
      .setRestitution(0.0),
    motorBodyB,
  );

  // ═══ BALL ═══
  const ballBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 10, 0)
      .setLinearDamping(BALL_DRAG),
  );
  const ballCollider = world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS)
      .setDensity(BALL_DENSITY)
      .setFriction(BALL_FRICTION)
      .setRestitution(BALL_RESTITUTION),
    ballBody,
  );

  // ═══ MOCK ATHLETES ═══
  const athleteA = createMockAthlete(motorBodyA);
  const athleteB = createMockAthlete(motorBodyB);

  // ═══ INPUT SLOTS ═══
  const slotA = createInputSlot();
  const slotB = createInputSlot();

  // ═══ BOT CONTROLLERS ═══
  const botA = createBotController({ difficulty: 'hard', slotIndex: 0, seed: seedA });
  const botB = createBotController({ difficulty: 'hard', slotIndex: 1, seed: seedB });

  // Inject override params
  if (paramsA) botA.overrideParams = paramsA;
  if (paramsB) botB.overrideParams = paramsB;

  // ═══ MATCH STATE ═══
  const matchState = {
    scoreHome: 0,
    scoreAway: 0,
    targetGoal: 'N',
    ticksRemaining: matchTicks,
    isCountingDown: false,
    matchOver: false,
    events: [],
  };

  // Ball tracking for scoring
  const ballPrev = { x: 0, y: 10, z: 0 };
  const ballArmed = { N: true, S: true };

  // Jump cooldowns
  const jumpState = {
    lastJumpTickA: -Infinity,
    lastJumpTickB: -Infinity,
  };

  // Per-tick ball object matching the interface perception expects
  const ballObj = {
    body: ballBody,
    collider: ballCollider,
    radius: BALL_RADIUS,
    mass: ballBody.mass(),
    id: 'medium',
    label: 'Medium (1.0m)',
  };

  return {
    world,
    motorBodyA, motorBodyB,
    athleteA, athleteB,
    botA, botB,
    slotA, slotB,
    matchState,
    ballBody, ballCollider, ballObj,
    ballPrev, ballArmed,
    jumpState,
    tick: 0,
    maxTicks: matchTicks,
  };
}

/**
 * Apply simplified motor forces from an input slot to a motor body.
 */
function applyMotorForces(body, slot, grounded, dt) {
  const move = slot.moveWorld;
  const hasMoveInput = move.x * move.x + move.z * move.z > 0.001;
  const airMul = grounded ? 1.0 : AIR_CONTROL;

  if (hasMoveInput) {
    const len = Math.sqrt(move.x * move.x + move.z * move.z);
    const nx = move.x / len;
    const nz = move.z / len;
    const force = MOTOR_FORCE * airMul;

    body.applyImpulse({ x: nx * force * dt, y: 0, z: nz * force * dt }, true);
  } else if (grounded) {
    // Brake: decelerate toward zero
    const vel = body.linvel();
    const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (hSpeed > 0.1) {
      const decel = Math.min(BRAKE_DECEL * dt, hSpeed);
      const scale = 1.0 - decel / hSpeed;
      body.setLinvel({ x: vel.x * scale, y: vel.y, z: vel.z * scale }, true);
    }
  }

  // Speed cap
  const vel = body.linvel();
  const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (hSpeed > MAX_SPEED) {
    const scale = MAX_SPEED / hSpeed;
    body.setLinvel({ x: vel.x * scale, y: vel.y, z: vel.z * scale }, true);
  }
}

/**
 * Handle a strike action: if queued and ball is close, apply impulse to ball.
 */
function handleStrike(match, motorBody, slot, side) {
  const hasStrike = slot.volleyQueued || slot.spikeQueued;
  if (!hasStrike) return false;

  const mPos = motorBody.translation();
  const bPos = match.ballBody.translation();
  const dx = bPos.x - mPos.x;
  const dy = bPos.y - mPos.y;
  const dz = bPos.z - mPos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Consume the actions regardless of distance
  const wasSpike = slot.spikeQueued;
  slot.volleyQueued = false;
  slot.spikeQueued = false;

  // Only apply if close enough (proximity assist)
  if (dist > 2.5) return false;

  // Determine strike type
  const strike = wasSpike ? STRIKE.spike : STRIKE.volley;
  const elevRad = (strike.elevDeg * Math.PI) / 180;

  // Aim direction: toward the attack goal
  // Home (side='home') attacks N when targetGoal is 'N'
  // Away (side='away') attacks opposite of targetGoal
  let goalZ;
  if (side === 'home') {
    goalZ = match.matchState.targetGoal === 'N' ? HOOP_NORTH_Z : HOOP_SOUTH_Z;
  } else {
    goalZ = match.matchState.targetGoal === 'N' ? HOOP_SOUTH_Z : HOOP_NORTH_Z;
  }

  // Direction from motor to goal (XZ plane)
  const toGoalX = 0 - mPos.x;  // hoops at x=0
  const toGoalZ = goalZ - mPos.z;
  const toGoalLen = Math.sqrt(toGoalX * toGoalX + toGoalZ * toGoalZ) || 1;
  const dirX = toGoalX / toGoalLen;
  const dirZ = toGoalZ / toGoalLen;

  // Apply impulse to ball
  const hSpeed = strike.speed * Math.cos(elevRad);
  const vSpeed = strike.speed * Math.sin(elevRad);
  const mass = match.ballObj.mass || 2.2;

  match.ballBody.setLinvel({
    x: dirX * hSpeed,
    y: vSpeed,
    z: dirZ * hSpeed,
  }, true);

  return true;
}

/**
 * Check if ball scored through a hoop.
 */
function checkScoring(match) {
  const pos = match.ballBody.translation();
  const prev = match.ballPrev;

  // Re-arm hoops when ball is far from x=0
  if (Math.abs(pos.x) > HOOP_REARM_X) {
    match.ballArmed.N = true;
    match.ballArmed.S = true;
  }

  if (match.ballArmed.N) {
    const hit = testHoopCrossing(prev, pos, HOOP_NORTH_Z, HOOP_CENTER_Y, HOOP_RADIUS);
    if (hit.hit) {
      match.ballArmed.N = false;
      recordHeadlessGoal(match, 'N');
    }
  }

  if (match.ballArmed.S) {
    const hit = testHoopCrossing(prev, pos, HOOP_SOUTH_Z, HOOP_CENTER_Y, HOOP_RADIUS);
    if (hit.hit) {
      match.ballArmed.S = false;
      recordHeadlessGoal(match, 'S');
    }
  }

  // Update prev
  match.ballPrev.x = pos.x;
  match.ballPrev.y = pos.y;
  match.ballPrev.z = pos.z;
}

function recordHeadlessGoal(match, goalId) {
  const scoredForHome = match.matchState.targetGoal === goalId;
  if (scoredForHome) match.matchState.scoreHome += 1;
  else match.matchState.scoreAway += 1;

  // Flip target (unconditional end switch)
  match.matchState.targetGoal = goalId === 'N' ? 'S' : 'N';

  match.matchState.events.push({
    tick: match.tick,
    goal: goalId,
    scoredFor: scoredForHome ? 'home' : 'away',
  });
}

/**
 * Respawn ball at center if below kill plane or out of bounds.
 */
function checkBallRespawn(match) {
  const pos = match.ballBody.translation();
  if (pos.y < KILL_PLANE_Y || Math.abs(pos.x) > ARENA_HALF_X || Math.abs(pos.z) > ARENA_HALF_Z) {
    match.ballBody.setTranslation({ x: 0, y: 10, z: 0 }, true);
    match.ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    match.ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    match.ballPrev.x = 0; match.ballPrev.y = 10; match.ballPrev.z = 0;
    match.ballArmed.N = true; match.ballArmed.S = true;
  }
}

/**
 * Check if a motor is grounded (simplified: sphere touching ground).
 */
function updateGrounded(athlete, motorBody) {
  const y = motorBody.translation().y;
  athlete.motor.grounded = y < (MOTOR_RADIUS + 0.15);
}

/**
 * Update facing yaw from velocity direction.
 */
function updateFacing(athlete, motorBody) {
  const vel = motorBody.linvel();
  const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (hSpeed > 0.5) {
    athlete.animTarget.yaw = Math.atan2(vel.x, vel.z);
  }
}

/**
 * Step the simulation one tick.
 */
export function stepHeadlessMatch(match) {
  match.tick++;

  const { botA, botB, athleteA, athleteB, slotA, slotB, matchState, ballObj } = match;
  const balls = [ballObj];

  // Clear action queues (keep movement from last tick)
  slotA.jumpQueued = false; slotA.diveQueued = false;
  slotA.volleyQueued = false; slotA.spikeQueued = false;
  slotB.jumpQueued = false; slotB.diveQueued = false;
  slotB.volleyQueued = false; slotB.spikeQueued = false;

  // ═══ BOT DECISIONS ═══
  updateBot(botA, athleteA, athleteB, balls, matchState, slotA, match.tick, DT);
  updateBot(botB, athleteB, athleteA, balls, matchState, slotB, match.tick, DT);

  // ═══ MOTOR FORCES ═══
  applyMotorForces(match.motorBodyA, slotA, athleteA.motor.grounded, DT);
  applyMotorForces(match.motorBodyB, slotB, athleteB.motor.grounded, DT);

  // ═══ JUMPS ═══
  if (slotA.jumpQueued && athleteA.motor.grounded &&
      match.tick - match.jumpState.lastJumpTickA >= JUMP_COOLDOWN) {
    match.motorBodyA.applyImpulse({ x: 0, y: JUMP_IMPULSE, z: 0 }, true);
    match.jumpState.lastJumpTickA = match.tick;
  }
  if (slotB.jumpQueued && athleteB.motor.grounded &&
      match.tick - match.jumpState.lastJumpTickB >= JUMP_COOLDOWN) {
    match.motorBodyB.applyImpulse({ x: 0, y: JUMP_IMPULSE, z: 0 }, true);
    match.jumpState.lastJumpTickB = match.tick;
  }

  // ═══ STRIKES ═══
  handleStrike(match, match.motorBodyA, slotA, 'home');
  handleStrike(match, match.motorBodyB, slotB, 'away');

  // ═══ PHYSICS STEP ═══
  match.world.step();

  // ═══ POST-STEP ═══
  updateGrounded(athleteA, match.motorBodyA);
  updateGrounded(athleteB, match.motorBodyB);
  updateFacing(athleteA, match.motorBodyA);
  updateFacing(athleteB, match.motorBodyB);

  checkScoring(match);
  checkBallRespawn(match);

  // Motor respawn if out of bounds
  for (const [mb, spawnZ] of [[match.motorBodyA, 20], [match.motorBodyB, -20]]) {
    const p = mb.translation();
    if (p.y < KILL_PLANE_Y || Math.abs(p.x) > ARENA_HALF_X || Math.abs(p.z) > ARENA_HALF_Z) {
      mb.setTranslation({ x: 0, y: MOTOR_RADIUS + 0.1, z: spawnZ }, true);
      mb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      mb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  // Match clock
  matchState.ticksRemaining--;
  if (matchState.ticksRemaining <= 0) {
    matchState.matchOver = true;
  }
}

/**
 * Run a complete headless match.
 *
 * @param {object} match    from createHeadlessMatch
 * @param {Function} onTick optional per-tick callback for stats
 * @returns {object} matchState
 */
export function runHeadlessMatch(match, onTick = null) {
  while (!match.matchState.matchOver) {
    stepHeadlessMatch(match);
    if (onTick) onTick(match);
  }
  return match.matchState;
}

/**
 * Clean up all Rapier resources.
 */
export function destroyHeadlessMatch(match) {
  match.world.free();
  match.world = null;
}
