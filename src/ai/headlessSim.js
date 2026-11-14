/**
 * @module headlessSim
 * @description High-speed headless Rapier 3D match simulation for AI evolutionary training and playtest telemetry.
 *
 * - **Role**: Runs deterministic 60 Hz 1v1 bot matches against the real `arena.glb` `COL_*` trimeshes
 *   using simplified sphere motors and real strike/block/slide/dive/hoop-crossing mechanics at ~100x real-time speed.
 * - **Frame Phase**: Standalone fixed-timestep (`DT = 1/60s`) simulation loop (`stepHeadlessMatch`).
 * - **Active Architectural Laws**:
 *   - **LAW 1 (Single Physics Writer)**: Bots write only to synthetic `inputSlot`s; `applyMotorForces` and
 *     `resolveStrikes` apply impulses to Rapier bodies prior to `world.step()`.
 *   - **LAW 6 (Determinism & Zero Allocations)**: All timing uses integer `tick` counters and seeded PRNGs;
 *     hot-path motor respawn and telemetry hooks allocate 0 per-tick heap objects.
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
import { toTrimeshArrays } from '../sim/arena.js';
import { getCourtFloorY } from './botPerception.js';
import {
  createTelemetryRecorder,
  recordDrop,
  advancePhase,
  recordHit,
  recordWhiff,
  recordGoal,
  recordRespawn,
  recordClockEnd,
  sampleUphill,
} from '../sim/playtestTelemetry.js';

let cachedCollisionMeshes = null;

// ═══ CONSTANTS ═══
const DT = 1 / 60;
const MOTOR_RADIUS = 0.5;
const MOTOR_MASS = 2.618;   // 4/3 * π * 0.5³ * density 2.0
const MAX_SPEED = 5.85;     // m/s horizontal sprint cap (aligned with measured motor.js flat sprint ~5.8-6.04 m/s)
const RUN_SPEED = 4.5;      // m/s non-sprint run cap (aligned with TUNING.blend2d.runSpeed)
const MOTOR_FORCE = 38.0;   // Tuned to reach MAX_SPEED smoothly on flat ground
const BRAKE_DECEL = 12.0;   // m/s² braking deceleration
const JUMP_IMPULSE = 7.0;
const JUMP_COOLDOWN = 90;   // ticks
const AIR_CONTROL = 0.15;

// Collision groups matching src/sim/physics.js:
// motor x ball = NO (motor sphere ignores the ball; torso/limb proxy touches it)
const ENV_GROUPS = (0x0001 << 16) | 0x001F;
const RAGDOLL_GROUPS = (0x0002 << 16) | 0x0011;
const MOTOR_GROUPS = (0x0008 << 16) | 0x0009;
const BALL_GROUPS = (0x0010 << 16) | 0x0017;

const BALL_RADIUS = 0.50;   // Medium ball
const BALL_DENSITY = 0.0042; // g/cm³; converted to kg/m³ (* 1000) when passed to Rapier
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

  if (!cachedCollisionMeshes) {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const modelPath = path.resolve(__dirname, '../../public/models/arena.glb');
      const glbBuffer = fs.readFileSync(modelPath);
      const arrayBuffer = glbBuffer.buffer.slice(glbBuffer.byteOffset, glbBuffer.byteOffset + glbBuffer.byteLength);

      await new Promise((resolve) => {
        new GLTFLoader().parse(arrayBuffer, '', (gltf) => {
          gltf.scene.updateMatrixWorld(true);
          const meshes = [];
          gltf.scene.traverse((obj) => {
            if (obj.isMesh && obj.name && obj.name.startsWith('COL_')) {
              const geom = obj.geometry.clone();
              geom.applyMatrix4(obj.matrixWorld);
              const isCourtSurface = obj.name === 'COL_Court';
              const { vertices, indices } = toTrimeshArrays(geom, {
                filterInverted: isCourtSurface,
                maxInvertedY: 4.0,
              });
              geom.dispose();
              if (indices && indices.length > 0) {
                meshes.push({
                  name: obj.name,
                  vertices,
                  indices,
                  fixInternalEdges: isCourtSurface,
                });
              }
            }
          });
          if (meshes.length > 0) {
            cachedCollisionMeshes = meshes;
          }
          resolve();
        });
      });
    } catch (e) {
      console.warn('[headlessSim] Note: arena.glb collision meshes not loaded, using cuboid ground', e);
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
    sprintHeld: false, slideHeld: false, braceHeld: false,
    jumpQueued: false, diveQueued: false,
    cutQueued: false,
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
  slot.sprintHeld = false; slot.slideHeld = false; slot.braceHeld = false;
  slot.jumpQueued = false; slot.diveQueued = false;
  slot.cutQueued = false;
  slot.volleyQueued = false; slot.spikeQueued = false;
  slot.ballResetQueued = false;
  slot.hasAim = false; slot.aimYaw = 0; slot.cameraYaw = 0;
}

/**
 * Create a mock athlete that matches the interface the bot perception reads.
 */
function createMockAthlete(motorBody, id = 'p1', team = 'home', assistPreset = 'standard') {
  const preset = TUNING.strike?.assistPresets?.[assistPreset] || TUNING.strike?.assistPresets?.standard || {
    id: 'standard',
    assistRadius: 0.45,
    assistWindowTicks: 6,
    aimMagnetism: 0.0,
  };
  return {
    id,
    team,
    isEnabled: true,
    motor: {
      body: motorBody,
      grounded: true,
    },
    tracker: {
      weight: 1.0,
    },
    animTarget: {
      yaw: team === 'home' ? Math.PI : 0,
    },
    actionState: {
      slideTime: 0,
      slideNeedsRelease: false,
      slideLowSpeedTicks: 0,
      braceMix: 0,
      divePending: false,
      lastDiveTick: -Infinity,
      diveStunUntil: -Infinity,
      lastCutTick: -Infinity,
      lastInterceptDiveTick: -Infinity,
      interceptDiveContactTick: -Infinity,
    },
    strikeState: {
      assistPreset: preset.id,
      assistRadius: preset.assistRadius,
      assistWindowTicks: preset.assistWindowTicks,
      aimMagnetism: preset.aimMagnetism,
      lastEastKind: 0,
    },
    _knockdownUntil: -Infinity,
  };
}

/**
 * True when initHeadless() loaded the real arena.glb collision trimeshes.
 * Playtest telemetry must not be collected on the cuboid fallback court.
 */
export function isHeadlessCourtLoaded() {
  return !!(cachedCollisionMeshes && cachedCollisionMeshes.length > 0);
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

  // Court surface & barrier colliders: real 3D valley trimeshes or fallback cuboids
  if (cachedCollisionMeshes && cachedCollisionMeshes.length > 0) {
    for (const m of cachedCollisionMeshes) {
      const flags = m.fixInternalEdges ? RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES : 0;
      const desc = flags
        ? RAPIER.ColliderDesc.trimesh(m.vertices, m.indices, flags)
        : RAPIER.ColliderDesc.trimesh(m.vertices, m.indices);
      if (m.name.includes('Court')) {
        desc.setFriction(0.3).setRestitution(0.75);
      } else if (m.name.includes('Barrier') || m.name.includes('Boundary')) {
        desc.setFriction(0.2).setRestitution(0.6);
      } else if (m.name.includes('Goal')) {
        desc.setFriction(0.3).setRestitution(0.8);
      }
      desc.setCollisionGroups(ENV_GROUPS);
      world.createCollider(desc, groundBody);
    }
  } else {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(ARENA_HALF_X, 0.5, ARENA_HALF_Z)
        .setTranslation(0, -0.5, 0)
        .setFriction(1.0)
        .setRestitution(0.0)
        .setCollisionGroups(ENV_GROUPS),
      groundBody,
    );
    // Court perimeter barriers fallback
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 12.0, COURT_WALL_Z)
        .setTranslation(-COURT_WALL_X, 10.0, 0)
        .setRestitution(0.6)
        .setFriction(0.2)
        .setCollisionGroups(ENV_GROUPS),
      groundBody,
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 12.0, COURT_WALL_Z)
        .setTranslation(COURT_WALL_X, 10.0, 0)
        .setRestitution(0.6)
        .setFriction(0.2)
        .setCollisionGroups(ENV_GROUPS),
      groundBody,
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(COURT_WALL_X, 12.0, 0.5)
        .setTranslation(0, 10.0, -COURT_WALL_Z)
        .setRestitution(0.6)
        .setFriction(0.2)
        .setCollisionGroups(ENV_GROUPS),
      groundBody,
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(COURT_WALL_X, 12.0, 0.5)
        .setTranslation(0, 10.0, COURT_WALL_Z)
        .setRestitution(0.6)
        .setFriction(0.2)
        .setCollisionGroups(ENV_GROUPS),
      groundBody,
    );
  }

  // ═══ MOTOR SPHERES ═══
  // Matching src/sim/physics.js: the 0.50m motor sphere uses MOTOR_GROUPS (ignores ball),
  // while a concentric 0.18m core proxy uses RAGDOLL_GROUPS so body-ball contact only occurs
  // at true ragdoll width (0.18m) without ever protruding below the rolling 0.50m sphere.
  const spawnYA = getCourtFloorY(-3.0, 20) + MOTOR_RADIUS + 0.3;
  const motorBodyA = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(-3.0, spawnYA, 20)
      .setLinearDamping(0.5),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(MOTOR_RADIUS)
      .setDensity(2.0)
      .setFriction(1.0)
      .setRestitution(0.0)
      .setCollisionGroups(MOTOR_GROUPS),
    motorBodyA,
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(0.18)
      .setDensity(0.0)
      .setFriction(0.2)
      .setRestitution(0.15)
      .setCollisionGroups(RAGDOLL_GROUPS),
    motorBodyA,
  );

  const spawnYB = getCourtFloorY(3.0, -20) + MOTOR_RADIUS + 0.3;
  const motorBodyB = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(3.0, spawnYB, -20)
      .setLinearDamping(0.5),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(MOTOR_RADIUS)
      .setDensity(2.0)
      .setFriction(1.0)
      .setRestitution(0.0)
      .setCollisionGroups(MOTOR_GROUPS),
    motorBodyB,
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(0.18)
      .setDensity(0.0)
      .setFriction(0.2)
      .setRestitution(0.15)
      .setCollisionGroups(RAGDOLL_GROUPS),
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
      .setDensity(ballDensity * 1000) // LESSON 12: g/cm³ -> kg/m³ (2.199 kg regulation mass)
      .setFriction(ballCfg.friction || 0.8)
      .setRestitution(ballRestitution)
      .setCollisionGroups(BALL_GROUPS),
    ballBody,
  );

  // ═══ MOCK ATHLETES ═══
  const assistPreset = opts.assistPreset || 'standard';
  const athleteA = createMockAthlete(motorBodyA, 'p1', 'home', assistPreset);
  const athleteB = createMockAthlete(motorBodyB, 'p2', 'away', assistPreset);

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

  // Telemetry recorder: preallocated event pool + scalar segment state. The
  // pool is a one-time setup allocation; per-tick hook writes allocate
  // nothing. FAIL CLOSED: no recorder at all on the cuboid fallback court, so
  // no report-producing path can even see telemetry from a fallback match.
  const courtLoaded = !!(cachedCollisionMeshes && cachedCollisionMeshes.length > 0);
  const telemetry = (opts.telemetry === false || !courtLoaded)
    ? null
    : createTelemetryRecorder({ capacity: opts.telemetryCapacity });
  if (telemetry) recordDrop(telemetry, 0);

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
    defensiveBlocks: { home: 0, away: 0 },
    slides: { home: 0, away: 0 },
    slideTackles: { home: 0, away: 0 },
    tick: 0,
    maxTicks: matchTicks,
    telemetry,
    // True only when the real arena.glb collision trimeshes loaded. Telemetry
    // consumers must fail closed on false (cuboid fallback is not reportable,
    // and no recorder is created above when this is false).
    courtLoaded,
    activeBalls: [ballObj],
  };
}

/**
 * Apply simplified motor forces, slide mechanics, and braceMix easing.
 */
function applyMotorForces(match, body, slot, athlete, side, dt) {
  const grounded = athlete.motor.grounded;
  const as = athlete.actionState;

  // Recover tracker weight after knockdown / dive stun
  if (match.tick < athlete._knockdownUntil) {
    athlete.tracker.weight = 0.15;
  } else if (athlete.tracker.weight < 1.0) {
    athlete.tracker.weight = Math.min(1.0, athlete.tracker.weight + 0.85 * dt);
  }

  // Ease braceMix (Block pose share, zero movement penalty)
  const braceEase = 1 - Math.exp(-(TUNING.action?.poseEase ?? 10.0) * dt);
  as.braceMix += ((slot.braceHeld ? 1.0 : 0.0) - as.braceMix) * braceEase;

  // Slide mechanics (matching src/mechanics/actions.js)
  if (!slot.slideHeld) as.slideNeedsRelease = false;
  if (slot.jumpQueued && as.slideTime > 0) {
    // Jump-cancel out of a slide: returns to feet carrying all built momentum without jumping
    as.slideTime = 0;
    as.slideNeedsRelease = true;
    slot.jumpQueued = false;
  }

  const vel0 = body.linvel();
  const speedNow = Math.hypot(vel0.x, vel0.z);
  const minSlideSpeed = TUNING.action?.minSlideSpeed ?? 4.0;
  const minSlideTicks = TUNING.action?.minSlideTicks ?? 15;

  const startingSlide =
    as.slideTime === 0 &&
    !as.slideNeedsRelease &&
    slot.slideHeld &&
    grounded &&
    speedNow > minSlideSpeed;

  if (startingSlide) {
    as.slideTime = 1;
    match.slides[side] = (match.slides[side] || 0) + 1;
  } else if (as.slideTime > 0) {
    as.slideTime += 1;
  }

  if (as.slideTime > 0) {
    const committed = as.slideTime <= minSlideTicks;
    if (!committed && !slot.slideHeld) {
      as.slideTime = 0;
      as.slideLowSpeedTicks = 0;
    } else if (slot.slideHeld && speedNow < (TUNING.action?.knockdownSpeed ?? 0.6)) {
      as.slideLowSpeedTicks = (as.slideLowSpeedTicks || 0) + 1;
      if (as.slideLowSpeedTicks >= (TUNING.action?.slideGraceTicks ?? 15)) {
        as.slideTime = 0;
        as.slideNeedsRelease = true;
        as.slideLowSpeedTicks = 0;
        athlete._knockdownUntil = match.tick + 55;
      }
    } else if (speedNow < (TUNING.action?.stopSpeed ?? 0.2)) {
      as.slideTime = 0;
      as.slideNeedsRelease = true;
      as.slideLowSpeedTicks = 0;
    } else {
      as.slideLowSpeedTicks = 0;
    }
  }

  const sliding = as.slideTime > 0;
  as.sliding = sliding;
  const driveScale = sliding ? 0.0 : (athlete.tracker.weight * athlete.tracker.weight);
  const move = slot.moveWorld;
  const hasMoveInput = move.x * move.x + move.z * move.z > 0.001;
  const airMul = grounded ? 1.0 : AIR_CONTROL;

  if (sliding && grounded) {
    // While sliding: steering is committed; downhill slopes accelerate past flat sprint cap
    if (vel0.y < -0.15 && speedNow > 0.5) {
      const downhillBoost = Math.min(9.5, Math.abs(vel0.y) * 3.8);
      const nx = vel0.x / speedNow;
      const nz = vel0.z / speedNow;
      body.applyImpulse({ x: nx * downhillBoost * dt, y: 0, z: nz * downhillBoost * dt }, true);
    } else if (speedNow > 0.1) {
      const flatSlideDecel = 1.6 * dt;
      const scale = Math.max(0, 1.0 - flatSlideDecel / speedNow);
      const m = body.mass();
      body.applyImpulse({ x: vel0.x * (scale - 1.0) * m, y: 0, z: vel0.z * (scale - 1.0) * m }, true);
    }
    const velS = body.linvel();
    const hSpeedS = Math.hypot(velS.x, velS.z);
    if (hSpeedS > 7.8) {
      const scale = 7.8 / hSpeedS;
      const m = body.mass();
      body.applyImpulse({ x: velS.x * (scale - 1.0) * m, y: 0, z: velS.z * (scale - 1.0) * m }, true);
    }
    return;
  }

  if (hasMoveInput && driveScale > 0.05) {
    const len = Math.sqrt(move.x * move.x + move.z * move.z);
    const nx = move.x / len;
    const nz = move.z / len;
    const force = MOTOR_FORCE * airMul * driveScale;

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

  // Speed cap with sprint governor
  const maxSpeed = slot.sprintHeld ? MAX_SPEED : RUN_SPEED;
  const vel = body.linvel();
  const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (hSpeed > maxSpeed) {
    const scale = maxSpeed / hSpeed;
    body.setLinvel({ x: vel.x * scale, y: vel.y, z: vel.z * scale }, true);
  }
}

/**
 * Latch a strike press and start the animation windup timer (matching `src/mechanics/strikes.js:eastKind`).
 */
function queueStrikeIfPressed(match, strikeState, slot, motorBody, athlete) {
  const pressed = slot.volleyQueued || slot.spikeQueued;
  if (!pressed) return;

  const since = match.tick - strikeState.pressTick;
  if (since < (TUNING.strike?.pressCooldownTicks ?? 20)) return; // press cooldown

  const mPos = motorBody.translation();
  const bPos = match.ballBody.translation();
  const distXZ = Math.hypot(bPos.x - mPos.x, bPos.z - mPos.z);
  const contextRadius = TUNING.strike?.contextRadius ?? 4.0;
  const relY = bPos.y - (mPos.y + 0.467); // match real game pelvis height ~0.967m

  let kind = 'volley';
  let sweetTick = TUNING.strike?.volley?.sweetTick ?? 15;
  let windowOpen = TUNING.strike?.volley?.windowOpen ?? 12;
  let windowClose = TUNING.strike?.volley?.windowClose ?? 30;

  if (slot.spikeQueued) {
    kind = 'spike';
    sweetTick = TUNING.strike?.spike?.sweetTick ?? 42;
    windowOpen = TUNING.strike?.spike?.windowOpen ?? 30;
    windowClose = TUNING.strike?.spike?.windowClose ?? 54;
  } else {
    // Exact `eastKind()` parity (`src/mechanics/strikes.js:439-463`)
    let eastCode = 1; // KIND_VOLLEY
    if (distXZ <= contextRadius) {
      const kickBelowHips = TUNING.strike?.kickBelowHips ?? -0.10;
      const kickHysteresis = TUNING.strike?.kickHysteresis ?? 0.05;
      const lastEast = athlete?.strikeState?.lastEastKind ?? 0;
      const inBand = Math.abs(relY - kickBelowHips) <= kickHysteresis;
      if (inBand && lastEast !== 0) {
        eastCode = lastEast;
      } else {
        eastCode = relY < kickBelowHips ? 3 : 1;
      }
    }
    if (athlete?.strikeState) athlete.strikeState.lastEastKind = eastCode;
    if (eastCode === 3) {
      kind = 'kick';
      sweetTick = TUNING.strike?.kick?.sweetTick ?? 8;
      windowOpen = TUNING.strike?.kick?.windowOpen ?? 8;
      windowClose = TUNING.strike?.kick?.windowClose ?? 17;
    }
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
 * Resolve active physical strikes inside their timing window matching `src/mechanics/strikes.js`
 * (`ball.radius + 0.08 + assistRadius` strictly within `±assistWindowTicks` around `sweetTick`).
 */
function resolveStrikes(match, strikeState, motorBody, athlete, side) {
  if (strikeState.pressTick < 0) return false;
  if (strikeState.resolvedTick === strikeState.pressTick) return false;

  const elapsed = match.tick - strikeState.pressTick;
  if (elapsed >= strikeState.windowOpen && elapsed <= strikeState.windowClose) {
    const mPos = motorBody.translation();
    const bPos = match.ballBody.translation();
    const kind = strikeState.pendingKind;
    const yaw = strikeState.aimYaw;
    const dirX = Math.sin(yaw);
    const dirZ = Math.cos(yaw);

    // Real-ragdoll measured limb offsets (`probe_whiff_and_hoop` on Rapier); sliding halves reach via `strikePart` blend
    const slideDilution = (athlete?.actionState?.slideTime > 0) ? 0.5 : 1.0;
    const baseLimbForward = kind === 'spike' ? 0.90 : (kind === 'kick' ? 0.34 : 0.48);
    const limbForward = baseLimbForward * slideDilution;
    const limbX = mPos.x + dirX * limbForward;
    const limbZ = mPos.z + dirZ * limbForward;
    const limbY = kind === 'kick' ? (mPos.y - 0.16) : (kind === 'spike' ? (mPos.y + 0.82) : (mPos.y + 0.58));

    const dist = Math.hypot(bPos.x - limbX, bPos.y - limbY, bPos.z - limbZ);

    const assistRadius = athlete?.strikeState?.assistRadius ?? 0.45;
    const assistWindowTicks = athlete?.strikeState?.assistWindowTicks ?? 6;
    const inAssistSweetBand = Math.abs(elapsed - strikeState.sweetTick) <= assistWindowTicks;
    const activeAssist = inAssistSweetBand ? assistRadius : 0.0;
    const reach = (match.ballObj.radius + 0.08 + activeAssist) * slideDilution;
    if (dist <= reach) {
      strikeState.resolvedTick = strikeState.pressTick;
      const strikeCfg = STRIKE[kind] || STRIKE.volley;
      const elevRad = (strikeCfg.elevDeg * Math.PI) / 180;
      const err = Math.abs(elapsed - strikeState.sweetTick);
      const q = err <= 5 ? 1.0 : (err >= 12 ? 0.35 : 1.0 - ((err - 5) / 7) * 0.65);

      const speed = strikeCfg.speed * q;
      const hSpeed = speed * Math.cos(elevRad);
      const vSpeed = speed * Math.sin(elevRad);
      const bMass = match.ballBody.mass();

      // Match `src/mechanics/strikes.js:808` verbatim: additive impulse on `ballBody` (obeys LAW 1)!
      match.ballBody.applyImpulse({
        x: dirX * hSpeed * bMass,
        y: vSpeed * bMass,
        z: dirZ * hSpeed * bMass,
      }, true);

      // Record hit event on match for fitness tracker
      if (!match.lastHits) match.lastHits = [];
      match.lastHits.push({
        side,
        kind,
        quality: q,
        tick: match.tick,
        dirX, dirZ,
        pos: { x: bPos.x, y: bPos.y, z: bPos.z },
      });

      if (match.telemetry) {
        recordHit(
          match.telemetry,
          match.tick,
          side,
          kind,
          side === 'home' ? match.botA.difficulty : match.botB.difficulty,
          bPos.x, bPos.y, bPos.z,
          dirX, dirZ, q,
          match.matchState.targetGoal,
        );
      }

      // Track diving hits if athlete dove recently
      if (athlete._lastDiveTick && (match.tick - athlete._lastDiveTick) <= 50) {
        if (!match.divingHits) match.divingHits = { home: 0, away: 0 };
        match.divingHits[side]++;
      }
      return true;
    }
  }

  if (elapsed > strikeState.windowClose && strikeState.resolvedTick !== strikeState.pressTick) {
    // Whiff!
    if (!match.whiffs) match.whiffs = { home: 0, away: 0 };
    match.whiffs[side]++;
    strikeState.resolvedTick = strikeState.pressTick;
    if (match.telemetry) {
      recordWhiff(
        match.telemetry,
        match.tick,
        side,
        side === 'home' ? match.botA.difficulty : match.botB.difficulty,
        match.ballPrev.x, match.ballPrev.y, match.ballPrev.z,
      );
    }
  }
  return false;
}

/**
 * Resolve active Block (braceHeld) redirect matching resolveBraceRedirect in src/mechanics/strikes.js.
 */
function resolveHeadlessBraceRedirect(match, strikeState, slot, athlete, motorBody, side) {
  const braceMix = athlete.actionState?.braceMix ?? 0;
  if (braceMix <= 0.2) return false;
  if (match.ballObj.lastBraceRedirectTick === match.tick) return false;
  // Minimum 15-tick cooldown per athlete so one block doesn't re-trigger on consecutive frames
  if (athlete._lastBraceContactTick && (match.tick - athlete._lastBraceContactTick) < 15) return false;

  const mPos = motorBody.translation();
  const bPos = match.ballBody.translation();
  const yaw = athlete.animTarget?.yaw ?? 0;
  const blockX = mPos.x + Math.sin(yaw) * 0.34;
  const blockY = mPos.y + 0.85;
  const blockZ = mPos.z + Math.cos(yaw) * 0.34;

  const dist = Math.hypot(bPos.x - blockX, bPos.y - blockY, bPos.z - blockZ);
  if (dist > 0.42 + match.ballObj.radius) return false;

  const vel = match.ballBody.linvel();
  const inbound = Math.hypot(vel.x, vel.y, vel.z);
  const b = TUNING.action || {};
  const minSpeed = b.braceMinRedirectSpeed ?? 1.5;
  if (inbound < minSpeed) return false;

  const outbound = Math.min(inbound, b.braceMaxRedirectSpeed ?? 22.0) * (b.braceRedirectScale ?? 0.95);
  const elevRad = ((b.braceRedirectUpDeg ?? 25.0) * Math.PI) / 180;
  const horiz = Math.cos(elevRad);
  const dirX = Math.sin(yaw) * horiz;
  const dirY = Math.sin(elevRad);
  const dirZ = Math.cos(yaw) * horiz;

  const bMass = match.ballBody.mass();
  match.ballBody.applyImpulse({
    x: (dirX * outbound - vel.x) * bMass,
    y: (dirY * outbound - vel.y) * bMass,
    z: (dirZ * outbound - vel.z) * bMass,
  }, true);

  match.ballObj.lastBraceRedirectTick = match.tick;
  athlete._lastBraceContactTick = match.tick;
  match.defensiveBlocks[side] = (match.defensiveBlocks[side] || 0) + 1;

  if (athlete._lastDiveTick && (match.tick - athlete._lastDiveTick) <= 50) {
    match.divingHits[side] = (match.divingHits[side] || 0) + 1;
  }
  return true;
}

/**
 * Resolve physical Slide-Tackle knockdowns between athletes matching resolveAthleteCollision.
 */
function resolveHeadlessSlideTackles(match) {
  const { athleteA, athleteB, motorBodyA, motorBodyB, tick } = match;
  const p1 = motorBodyA.translation();
  const p2 = motorBodyB.translation();
  if (Math.abs(p1.y - p2.y) > 1.4) return;
  const distXZ = Math.hypot(p2.x - p1.x, p2.z - p1.z);
  if (distXZ > 1.08) return;

  const slidingA = athleteA.actionState.slideTime > 0;
  const slidingB = athleteB.actionState.slideTime > 0;
  if (!slidingA && !slidingB) return;

  const lastTackle = match._lastTackleTick ?? -999;
  if (tick - lastTackle <= (TUNING.action?.slideTackleCooldownTicks ?? 15)) return;

  const v1 = motorBodyA.linvel();
  const v2 = motorBodyB.linvel();
  const speed1 = Math.hypot(v1.x, v1.z);
  const speed2 = Math.hypot(v2.x, v2.z);
  const minTackleSpeed = TUNING.action?.slideTackleMinSpeed ?? 5.5;

  if (slidingA && !slidingB && speed1 > minTackleSpeed) {
    match._lastTackleTick = tick;
    athleteB._knockdownUntil = tick + 70;
    athleteB.tracker.weight = 0.12;
    motorBodyB.applyImpulse({ x: v1.x * 0.45, y: 0, z: v1.z * 0.45 }, true);
    motorBodyA.applyImpulse({ x: -v1.x * 0.12, y: 0, z: -v1.z * 0.12 }, true);
    match.slideTackles.home = (match.slideTackles.home || 0) + 1;
  } else if (slidingB && !slidingA && speed2 > minTackleSpeed) {
    match._lastTackleTick = tick;
    athleteA._knockdownUntil = tick + 70;
    athleteA.tracker.weight = 0.12;
    motorBodyA.applyImpulse({ x: v2.x * 0.45, y: 0, z: v2.z * 0.45 }, true);
    motorBodyB.applyImpulse({ x: -v2.x * 0.12, y: 0, z: -v2.z * 0.12 }, true);
    match.slideTackles.away = (match.slideTackles.away || 0) + 1;
  }
}

/**
 * Check if ball scored through a hoop.
 */
function checkScoring(match) {
  const pos = match.ballBody.translation();
  const prev = match.ballPrev;

  // ═══ TELEMETRY: sample uphill floor height for the active strike-segment.
  // Reuses the translation() this function already performs; the hook itself
  // allocates nothing (see src/sim/playtestTelemetry.js). ═══
  if (match.telemetry) sampleUphill(match.telemetry, pos.x, pos.z);

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

  if (match.telemetry) {
    recordGoal(match.telemetry, match.tick, goalId, scoredForHome ? 'home' : 'away');
    advancePhase(match.telemetry);
    recordDrop(match.telemetry, match.tick);
  }
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

    if (match.telemetry) {
      recordRespawn(match.telemetry, match.tick, pos.x, pos.y, pos.z);
      advancePhase(match.telemetry);
      recordDrop(match.telemetry, match.tick);
    }
  }
}

/**
 * Check if a motor is grounded (relative to 3D court floor).
 */
function updateGrounded(athlete, motorBody) {
  const p = motorBody.translation();
  const floorY = getCourtFloorY(p.x, p.z);
  athlete.motor.grounded = (p.y - floorY) < (MOTOR_RADIUS + 0.25);
}

/**
 * Update facing yaw from explicit aimYaw or velocity direction.
 */
function updateFacing(athlete, motorBody, slot) {
  if (slot && slot.hasAim) {
    const curr = athlete.animTarget.yaw || 0;
    const diff = Math.atan2(Math.sin(slot.aimYaw - curr), Math.cos(slot.aimYaw - curr));
    athlete.animTarget.yaw = Math.atan2(Math.sin(curr + diff * 0.22), Math.cos(curr + diff * 0.22));
    return;
  }
  const vel = motorBody.linvel();
  const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (hSpeed > 0.5) {
    athlete.animTarget.yaw = Math.atan2(vel.x, vel.z);
  }
}

/** Respawn one motor sphere if it left the arena. Event-rate, not tick-rate. */
function respawnMotorIfOutOfBounds(mb, spawnZ) {
  const p = mb.translation();
  if (p.y < KILL_PLANE_Y || Math.abs(p.x) > ARENA_HALF_X || Math.abs(p.z) > ARENA_HALF_Z) {
    const spawnY = getCourtFloorY(0, spawnZ) + MOTOR_RADIUS + 0.3;
    mb.setTranslation({ x: 0, y: spawnY, z: spawnZ }, true);
    mb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    mb.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

/**
 * Step the simulation one tick.
 */
export function stepHeadlessMatch(match) {
  match.tick++;

  const { botA, botB, athleteA, athleteB, slotA, slotB, matchState } = match;
  const balls = match.activeBalls;

  // Clear action queues (keep movement from last tick)
  slotA.jumpQueued = false; slotA.diveQueued = false; slotA.cutQueued = false;
  slotA.volleyQueued = false; slotA.spikeQueued = false;
  slotB.jumpQueued = false; slotB.diveQueued = false; slotB.cutQueued = false;
  slotB.volleyQueued = false; slotB.spikeQueued = false;

  // ═══ BOT DECISIONS ═══
  updateBot(botA, athleteA, athleteB, balls, matchState, slotA, match.tick, DT);
  updateBot(botB, athleteB, athleteA, balls, matchState, slotB, match.tick, DT);

  // ═══ MOTOR FORCES, SLIDE & BRACE MIX ═══
  applyMotorForces(match, match.motorBodyA, slotA, athleteA, 'home', DT);
  applyMotorForces(match, match.motorBodyB, slotB, athleteB, 'away', DT);
  resolveHeadlessSlideTackles(match);

  // ═══ CUTS (Stage 3 Athletic Redirects) ═══
  if (slotA.cutQueued && athleteA.motor.grounded && athleteA.actionState.slideTime === 0) {
    if (!match.cuts) match.cuts = { home: 0, away: 0 };
    match.cuts.home++;
    const dirX = slotA.moveWorld ? slotA.moveWorld.x : 0;
    const dirZ = slotA.moveWorld ? slotA.moveWorld.z : 0;
    const len = Math.hypot(dirX, dirZ) || 1.0;
    const lv = match.motorBodyA.linvel();
    const mass = match.motorBodyA.mass();
    match.motorBodyA.applyImpulse({
      x: -lv.x * mass * 0.95 + (dirX / len) * 4.5,
      y: 0.2,
      z: -lv.z * mass * 0.95 + (dirZ / len) * 4.5,
    }, true);
  }
  if (slotB.cutQueued && athleteB.motor.grounded && athleteB.actionState.slideTime === 0) {
    if (!match.cuts) match.cuts = { home: 0, away: 0 };
    match.cuts.away++;
    const dirX = slotB.moveWorld ? slotB.moveWorld.x : 0;
    const dirZ = slotB.moveWorld ? slotB.moveWorld.z : 0;
    const len = Math.hypot(dirX, dirZ) || 1.0;
    const lv = match.motorBodyB.linvel();
    const mass = match.motorBodyB.mass();
    match.motorBodyB.applyImpulse({
      x: -lv.x * mass * 0.95 + (dirX / len) * 4.5,
      y: 0.2,
      z: -lv.z * mass * 0.95 + (dirZ / len) * 4.5,
    }, true);
  }

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

  // ═══ DIVES (Standard & Brace-Dive Intercept GF-2.1) ═══
  if (slotA.diveQueued && athleteA.motor.grounded) {
    if (!match.dives) match.dives = { home: 0, away: 0 };
    match.dives.home++;
    const dirX = slotA.moveWorld ? slotA.moveWorld.x : 0;
    const dirZ = slotA.moveWorld ? slotA.moveWorld.z : 0;
    const len = Math.hypot(dirX, dirZ) || 1.0;
    const fwdImp = slotA.braceHeld ? (TUNING.action?.interceptDiveForwardImpulse ?? 6.0) : 4.8;
    const upImp = slotA.braceHeld ? (TUNING.action?.interceptDiveUpImpulse ?? 2.8) : 3.8;
    match.motorBodyA.applyImpulse({
      x: (dirX / len) * fwdImp,
      y: upImp,
      z: (dirZ / len) * fwdImp,
    }, true);
    athleteA._lastDiveTick = match.tick;
    athleteA.actionState.lastDiveTick = match.tick;
    athleteA._knockdownUntil = match.tick + 55;
  }
  if (slotB.diveQueued && athleteB.motor.grounded) {
    if (!match.dives) match.dives = { home: 0, away: 0 };
    match.dives.away++;
    const dirX = slotB.moveWorld ? slotB.moveWorld.x : 0;
    const dirZ = slotB.moveWorld ? slotB.moveWorld.z : 0;
    const len = Math.hypot(dirX, dirZ) || 1.0;
    const fwdImp = slotB.braceHeld ? (TUNING.action?.interceptDiveForwardImpulse ?? 6.0) : 4.8;
    const upImp = slotB.braceHeld ? (TUNING.action?.interceptDiveUpImpulse ?? 2.8) : 3.8;
    match.motorBodyB.applyImpulse({
      x: (dirX / len) * fwdImp,
      y: upImp,
      z: (dirZ / len) * fwdImp,
    }, true);
    athleteB._lastDiveTick = match.tick;
    athleteB.actionState.lastDiveTick = match.tick;
    athleteB._knockdownUntil = match.tick + 55;
  }

  // ═══ STRIKES & ACTIVE BLOCK (BRACE) REDIRECTS ═══
  queueStrikeIfPressed(match, match.strikeA, slotA, match.motorBodyA, athleteA);
  queueStrikeIfPressed(match, match.strikeB, slotB, match.motorBodyB, athleteB);

  const struckA = resolveStrikes(match, match.strikeA, match.motorBodyA, athleteA, 'home');
  const struckB = resolveStrikes(match, match.strikeB, match.motorBodyB, athleteB, 'away');

  if (!struckA) resolveHeadlessBraceRedirect(match, match.strikeA, slotA, athleteA, match.motorBodyA, 'home');
  if (!struckB) resolveHeadlessBraceRedirect(match, match.strikeB, slotB, athleteB, match.motorBodyB, 'away');

  // ═══ PHYSICS STEP ═══
  match.world.step();

  // ═══ POST-STEP ═══
  updateGrounded(athleteA, match.motorBodyA);
  updateGrounded(athleteB, match.motorBodyB);
  updateFacing(athleteA, match.motorBodyA, slotA);
  updateFacing(athleteB, match.motorBodyB, slotB);

  checkScoring(match);
  checkBallRespawn(match);

  // Motor respawn if out of bounds (unrolled: the old for-of over nested
  // array literals allocated on every tick; this form allocates nothing
  // until an actual out-of-bounds respawn fires).
  respawnMotorIfOutOfBounds(match.motorBodyA, 20);
  respawnMotorIfOutOfBounds(match.motorBodyB, -20);

  // Match clock
  matchState.ticksRemaining--;
  if (matchState.ticksRemaining <= 0) {
    matchState.matchOver = true;
    if (match.telemetry) {
      // Close the final segment at the ball's ACTUAL clock-end position.
      // Zero-alloc: checkScoring already ran this tick (post-step) and cached
      // the current ball position in match.ballPrev; no telemetry-only Rapier
      // translation() wrapper is created inside the fixed tick.
      recordClockEnd(match.telemetry, match.tick, match.ballPrev.x, match.ballPrev.z);
    }
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
