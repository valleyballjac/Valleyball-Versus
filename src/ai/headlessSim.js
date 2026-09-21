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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from '../config/tuning.js';
import { createBotController, updateBot } from './botController.js';
import { testHoopCrossing } from '../mechanics/scoring.js';
import { getCourtFloorY } from './botPerception.js';

let cachedCourtMesh = null;

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

// Strike launch velocities (from TUNING.strike)
const STRIKE = {
  volley: { speed: 24.5, elevDeg: 46 },
  spike:  { speed: 22.0, elevDeg: -18 },
  kick:   { speed: 14.5, elevDeg: 55 },
};

const KILL_PLANE_Y = -15;
const ARENA_HALF_X = 50;
const ARENA_HALF_Z = 60;
const COURT_WALL_X = 18.0;
const COURT_WALL_Z = 48.0;

// ═══ SCRATCH VECTORS ═══
const _v1 = new THREE.Vector3();
const _moveWorld = new THREE.Vector3();

/**
 * Initialize Rapier WASM and load arena collision geometry.
 */
export async function initHeadless() {
  await RAPIER.init();

  if (!cachedCourtMesh) {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const modelPath = path.resolve(__dirname, '../../public/models/arena.glb');
      const glbBuffer = fs.readFileSync(modelPath);
      const arrayBuffer = glbBuffer.buffer.slice(glbBuffer.byteOffset, glbBuffer.byteOffset + glbBuffer.byteLength);

      await new Promise((resolve) => {
        new GLTFLoader().parse(arrayBuffer, '', (gltf) => {
          let courtObj = null;
          gltf.scene.traverse((obj) => {
            if (obj.name === 'COL_Court') courtObj = obj;
          });
          if (courtObj) {
            const geom = courtObj.geometry.clone();
            geom.applyMatrix4(courtObj.matrixWorld);
            const pos = geom.attributes.position;
            const vertices = new Float32Array(pos.array);
            let indices;
            if (geom.index) {
              indices = new Uint32Array(geom.index.array);
            } else {
              indices = new Uint32Array(pos.count);
              for (let i = 0; i < pos.count; i++) indices[i] = i;
            }
            cachedCourtMesh = { vertices, indices };
          }
          resolve();
        });
      });
    } catch (e) {
      console.warn('[headlessSim] Note: arena.glb court mesh not loaded, using cuboid ground', e);
    }
  }

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
function createMockAthlete(motorBody, id = 'p1', team = 'home') {
  return {
    id,
    team,
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

  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  // Court surface collider: real 3D valley trimesh or fallback cuboid
  if (cachedCourtMesh) {
    const desc = RAPIER.ColliderDesc.trimesh(cachedCourtMesh.vertices, cachedCourtMesh.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(0.3)
      .setRestitution(0.75);
    world.createCollider(desc, groundBody);
  } else {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(ARENA_HALF_X, 0.5, ARENA_HALF_Z)
        .setTranslation(0, -0.5, 0)
        .setFriction(1.0)
        .setRestitution(0.0),
      groundBody,
    );
  }

  // Court perimeter barriers (matching arena bowl/court walls)
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.5, 12.0, COURT_WALL_Z)
      .setTranslation(-COURT_WALL_X, 10.0, 0)
      .setRestitution(0.6)
      .setFriction(0.2),
    groundBody,
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.5, 12.0, COURT_WALL_Z)
      .setTranslation(COURT_WALL_X, 10.0, 0)
      .setRestitution(0.6)
      .setFriction(0.2),
    groundBody,
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(COURT_WALL_X, 12.0, 0.5)
      .setTranslation(0, 10.0, -COURT_WALL_Z)
      .setRestitution(0.6)
      .setFriction(0.2),
    groundBody,
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(COURT_WALL_X, 12.0, 0.5)
      .setTranslation(0, 10.0, COURT_WALL_Z)
      .setRestitution(0.6)
      .setFriction(0.2),
    groundBody,
  );

  // ═══ MOTOR SPHERES ═══
  const spawnYA = getCourtFloorY(20) + MOTOR_RADIUS + 0.3;
  const motorBodyA = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(-3.0, spawnYA, 20)
      .setLinearDamping(0.5),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(MOTOR_RADIUS)
      .setDensity(2.0)
      .setFriction(1.0)
      .setRestitution(0.0),
    motorBodyA,
  );

  const spawnYB = getCourtFloorY(-20) + MOTOR_RADIUS + 0.3;
  const motorBodyB = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(3.0, spawnYB, -20)
      .setLinearDamping(0.5),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(MOTOR_RADIUS)
      .setDensity(2.0)
      .setFriction(1.0)
      .setRestitution(0.0),
    motorBodyB,
  );

  const ballType = opts.ballType || 'medium';
  const ballCfg = (TUNING.balls && TUNING.balls.find((b) => b.id === ballType)) || {
    id: 'medium',
    label: 'Medium (1.0m)',
    radius: 0.50,
    density: 0.0042,
    friction: 0.8,
    restitution: 0.88,
    linearDrag: 0.012,
  };
  const ballRadius = opts.ballRadius || ballCfg.radius || 0.50;
  const ballDensity = ballCfg.density || 0.0042;
  const ballRestitution = ballCfg.restitution || 0.88;
  const ballDrag = ballCfg.linearDrag || 0.012;

  // ═══ BALL ═══
  const ballBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(1.5, 10, 0)
      .setLinearDamping(ballDrag)
      .setAngularDamping(0.8),
  );
  const ballCollider = world.createCollider(
    RAPIER.ColliderDesc.ball(ballRadius)
      .setDensity(ballDensity)
      .setFriction(ballCfg.friction || 0.8)
      .setRestitution(ballRestitution),
    ballBody,
  );

  // ═══ MOCK ATHLETES ═══
  const athleteA = createMockAthlete(motorBodyA, 'p1', 'home');
  const athleteB = createMockAthlete(motorBodyB, 'p2', 'away');

  // ═══ INPUT SLOTS ═══
  const slotA = createInputSlot();
  const slotB = createInputSlot();

  // ═══ BOT CONTROLLERS ═══
  const botA = createBotController({
    difficulty: opts.homeDiff || 'hard',
    slotIndex: 0,
    seed: seedA,
    aggressiveness: opts.aggressivenessA ?? 0.60,
  });
  const botB = createBotController({
    difficulty: opts.awayDiff || 'hard',
    slotIndex: 1,
    seed: seedB,
    aggressiveness: opts.aggressivenessB ?? 0.60,
  });

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
  const ballPrev = { x: 1.5, y: 10, z: 0 };
  const ballArmed = { N: true, S: true };

  // Jump cooldowns
  const jumpState = {
    lastJumpTickA: -Infinity,
    lastJumpTickB: -Infinity,
  };

  // Physical strike states (matching animation windup timing)
  const strikeA = {
    pendingKind: null,
    pressTick: -Infinity,
    sweetTick: 0,
    windowOpen: 0,
    windowClose: 0,
    resolvedTick: -Infinity,
    aimYaw: 0,
  };
  const strikeB = {
    pendingKind: null,
    pressTick: -Infinity,
    sweetTick: 0,
    windowOpen: 0,
    windowClose: 0,
    resolvedTick: -Infinity,
    aimYaw: 0,
  };

  // Per-tick ball object matching the interface perception expects
  const ballObj = {
    body: ballBody,
    collider: ballCollider,
    radius: ballRadius,
    mass: ballBody.mass(),
    id: ballCfg.id,
    label: ballCfg.label,
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
    strikeA, strikeB,
    lastHits: [],
    whiffs: { home: 0, away: 0 },
    dives: { home: 0, away: 0 },
    divingHits: { home: 0, away: 0 },
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

  // Speed cap with sprint governor (sprint = 6 m/s, jog = 4 m/s)
  const maxSpeed = slot.sprintHeld ? MAX_SPEED : 4.0;
  const vel = body.linvel();
  const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (hSpeed > maxSpeed) {
    const scale = maxSpeed / hSpeed;
    body.setLinvel({ x: vel.x * scale, y: vel.y, z: vel.z * scale }, true);
  }
}

/**
 * Latch a strike press and start the animation windup timer.
 */
function queueStrikeIfPressed(match, strikeState, slot, motorBody) {
  const pressed = slot.volleyQueued || slot.spikeQueued;
  if (!pressed) return;

  const since = match.tick - strikeState.pressTick;
  if (since < 20) return; // press cooldown

  const mPos = motorBody.translation();
  const bPos = match.ballBody.translation();
  const relY = bPos.y - (mPos.y + 0.45); // match real game pelvis height ~0.95m

  let kind = 'volley';
  let sweetTick = 20;
  let windowOpen = 12;
  let windowClose = 30;

  if (slot.spikeQueued) {
    kind = 'spike';
    sweetTick = 42;
    windowOpen = 30;
    windowClose = 54;
  } else if (relY < -0.10) {
    // East button contextual kick for low balls
    kind = 'kick';
    sweetTick = 14;
    windowOpen = 8;
    windowClose = 17;
  }

  strikeState.pendingKind = kind;
  strikeState.pressTick = match.tick;
  strikeState.sweetTick = sweetTick;
  strikeState.windowOpen = windowOpen;
  strikeState.windowClose = windowClose;
  strikeState.resolvedTick = -Infinity;
  strikeState.aimYaw = slot.hasAim ? slot.aimYaw : (motorBody.linvel().z < 0 ? Math.PI : 0);

  // Consume queue flags
  slot.volleyQueued = false;
  slot.spikeQueued = false;
}

/**
 * Resolve active physical strikes inside their timing window.
 */
function resolveStrikes(match, strikeState, motorBody, side) {
  if (strikeState.pressTick < 0) return;
  if (strikeState.resolvedTick === strikeState.pressTick) return;

  const elapsed = match.tick - strikeState.pressTick;
  if (elapsed >= strikeState.windowOpen && elapsed <= strikeState.windowClose) {
    const mPos = motorBody.translation();
    const bPos = match.ballBody.translation();
    const limbY = strikeState.pendingKind === 'kick' ? (mPos.y + 0.2) : (strikeState.pendingKind === 'spike' ? (mPos.y + 1.4) : (mPos.y + 1.0));
    const dx = bPos.x - mPos.x;
    const dy = bPos.y - limbY;
    const dz = bPos.z - mPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Physical strike reach: limb reach + ball radius + proximity assist
    const reach = 0.95 + match.ballObj.radius + 0.45;
    if (dist <= reach) {
      strikeState.resolvedTick = strikeState.pressTick;
      const strikeCfg = STRIKE[strikeState.pendingKind] || STRIKE.volley;
      const elevRad = (strikeCfg.elevDeg * Math.PI) / 180;
      const err = Math.abs(elapsed - strikeState.sweetTick);
      const q = err <= 4 ? 1.0 : (err >= 12 ? 0.35 : 1.0 - ((err - 4) / 8) * 0.65);

      const speed = strikeCfg.speed * q;
      const hSpeed = speed * Math.cos(elevRad);
      const vSpeed = speed * Math.sin(elevRad);

      const yaw = strikeState.aimYaw;
      const dirX = Math.sin(yaw);
      const dirZ = Math.cos(yaw);

      match.ballBody.setLinvel({
        x: dirX * hSpeed,
        y: vSpeed,
        z: dirZ * hSpeed,
      }, true);

      // Record hit event on match for fitness tracker
      if (!match.lastHits) match.lastHits = [];
      match.lastHits.push({
        side,
        kind: strikeState.pendingKind,
        quality: q,
        tick: match.tick,
        dirX, dirZ,
        pos: { x: bPos.x, y: bPos.y, z: bPos.z },
      });

      // Track diving hits if athlete dove recently
      const athlete = side === 'home' ? match.athleteA : match.athleteB;
      if (athlete._lastDiveTick && (match.tick - athlete._lastDiveTick) <= 50) {
        if (!match.divingHits) match.divingHits = { home: 0, away: 0 };
        match.divingHits[side]++;
      }
      return;
    }
  }

  if (elapsed > strikeState.windowClose && strikeState.resolvedTick !== strikeState.pressTick) {
    // Whiff!
    if (!match.whiffs) match.whiffs = { home: 0, away: 0 };
    match.whiffs[side]++;
    strikeState.resolvedTick = strikeState.pressTick;
  }
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
      return;
    }
  }

  if (match.ballArmed.S) {
    const hit = testHoopCrossing(prev, pos, HOOP_SOUTH_Z, HOOP_CENTER_Y, HOOP_RADIUS);
    if (hit.hit) {
      match.ballArmed.S = false;
      recordHeadlessGoal(match, 'S');
      return;
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

  // Re-drop ball at court center from ceiling after goal celebration
  const dropX = ((match.tick * 5) % 9) - 4;
  match.ballBody.setTranslation({ x: dropX, y: 10, z: 0 }, true);
  match.ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  match.ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  match.ballPrev.x = dropX; match.ballPrev.y = 10; match.ballPrev.z = 0;
  match.ballArmed.N = true; match.ballArmed.S = true;
}

/**
 * Respawn ball at center if below kill plane or out of bounds.
 */
function checkBallRespawn(match) {
  const pos = match.ballBody.translation();
  if (pos.y < KILL_PLANE_Y || Math.abs(pos.x) > ARENA_HALF_X || Math.abs(pos.z) > ARENA_HALF_Z) {
    const respawnX = ((match.tick * 7) % 9) - 4;
    match.ballBody.setTranslation({ x: respawnX, y: 10, z: 0 }, true);
    match.ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    match.ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    match.ballPrev.x = respawnX; match.ballPrev.y = 10; match.ballPrev.z = 0;
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

  // ═══ DIVES ═══
  if (slotA.diveQueued && athleteA.motor.grounded) {
    if (!match.dives) match.dives = { home: 0, away: 0 };
    match.dives.home++;
    const dirX = slotA.moveWorld ? slotA.moveWorld.x : 0;
    const dirZ = slotA.moveWorld ? slotA.moveWorld.z : 0;
    const len = Math.hypot(dirX, dirZ) || 1.0;
    match.motorBodyA.applyImpulse({
      x: (dirX / len) * 4.8,
      y: 3.8,
      z: (dirZ / len) * 4.8,
    }, true);
    athleteA._lastDiveTick = match.tick;
  }
  if (slotB.diveQueued && athleteB.motor.grounded) {
    if (!match.dives) match.dives = { home: 0, away: 0 };
    match.dives.away++;
    const dirX = slotB.moveWorld ? slotB.moveWorld.x : 0;
    const dirZ = slotB.moveWorld ? slotB.moveWorld.z : 0;
    const len = Math.hypot(dirX, dirZ) || 1.0;
    match.motorBodyB.applyImpulse({
      x: (dirX / len) * 4.8,
      y: 3.8,
      z: (dirZ / len) * 4.8,
    }, true);
    athleteB._lastDiveTick = match.tick;
  }

  // ═══ STRIKES ═══
  queueStrikeIfPressed(match, match.strikeA, slotA, match.motorBodyA);
  queueStrikeIfPressed(match, match.strikeB, slotB, match.motorBodyB);

  resolveStrikes(match, match.strikeA, match.motorBodyA, 'home');
  resolveStrikes(match, match.strikeB, match.motorBodyB, 'away');

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
