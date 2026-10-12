/**
 * ATHLETE + BALL CORNER TRAVERSAL — the sloped corner fan must be a usable
 * surface, not just a present one. Two independent traversals per quadrant:
 *
 *   A. Production athlete sprint. A real createAthlete (motor sphere + PD
 *      ragdoll, production physics world stamped with the arena colliders)
 *      spawns in the outer field on the radial line to the corner apex, 7.5 m
 *      before the 11 m rim, and sprints straight at the corner for 120 ticks.
 *      Certified on the clean arena:
 *        - advance: radial progress toward the apex >= MIN_PROGRESS_M (a
 *          vertical curtain at the rim reads as a stall);
 *        - climb: max motor Y >= FAN_CLIMB_MIN_Y (it rode up the sloped fan;
 *          the outer field and rim terrain never reach this height);
 *        - no fall-through: motor Y stays within MOTOR_CLEARANCE_M of the
 *          raycast terrain under it every tick and never crosses the kill
 *          plane (the v0.3.2 bug);
 *        - no teleport: tick-to-tick motor travel <= MAX_STEP_M (the watchdog
 *          rescue reads as a large jump);
 *        - limb calm: every ragdoll body's angular speed stays under
 *          LIMB_ANGVEL_MAX (a fan that snags or launches reads as flailing).
 *
 *   B. Ball roll. A regulation ball (density 4.2, friction 0.35, restitution
 *      0.88, CCD on) rolls at BALL_SPEED toward the apex from 8 m out and
 *      must ride up the wedge:
 *        - max center Y >= BALL_FAN_MIN_Y (it got onto the sloped fan);
 *        - no punch-through: minY never crosses the kill plane and the rest
 *          is on verified terrain;
 *        - no artificial deflection: before entering the fan footprint the
 *          lateral offset from the straight spawn->apex line stays under
 *          LATERAL_MAX_M (nothing invisible is steering the ball).
 *
 * Thresholds are calibrated against the clean arena with margin (see report
 * JSON for the measured values). Exit 0 = pass, 1 = fail.
 * Run: npm run test:traversal
 */

import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initPhysics, getWorld, stepPhysics, ENVIRONMENT_GROUPS } from '../src/sim/physics.js';
import { activeArenaPreset } from '../src/sim/arena.js';
import { createAthlete } from '../src/sim/athlete.js';
import { buildWorld, surfaceY } from './test_ball_roll.mjs';
import { FAN_REGION_Z } from './corner_cap_gate.mjs';

const DT = 1 / 60;
const KILL_FLOOR_Y = -5.0;

/** Corner geometry, measured (see corner_cap_gate.mjs header): the fan rim
 * vertex nearest the corner sits at (±24.5, 11.0, ±59.5) and the shared apex
 * at (±25, 13.0, ±60). Traversals run along that radial line. */
const RIM_Y = 11.0;
const CORNERS = [
  { name: 'NE', sx: 1, sz: -1 },
  { name: 'NW', sx: -1, sz: -1 },
  { name: 'SE', sx: 1, sz: 1 },
  { name: 'SW', sx: -1, sz: 1 },
].map((c) => ({
  ...c,
  rim: { x: c.sx * 24.5, z: c.sz * 59.5 },
  apex: { x: c.sx * 25, z: c.sz * 60 },
}));

/** Is (x, z) inside a corner fan region (the |z| band the fans live in)? */
function pointInFanFootprint(x, z) {
  return Math.abs(z) >= FAN_REGION_Z && Math.abs(x) <= 25.5;
}

// ── Athlete traversal calibration ──
const ATHLETE_TICKS = 120;          // 2 s of sprint.
const SPAWN_BACKOFF_M = 7.5;        // spawn this far before the rim point.
const MIN_PROGRESS_M = 4.0;         // radial advance toward the apex.
const FAN_CLIMB_MIN_Y = 12.0;       // motor center Y proving fan ascent.
const MOTOR_CLEARANCE_M = 0.6;      // motor may not sink below terrain.
const MAX_STEP_M = 0.75;            // per-tick travel; watchdog teleports exceed this.
/** Limb-flail ceiling is measured, not guessed: a flat-ground sprint baseline
 * runs first and the corner ceiling is baseline max angvel x this margin.
 * Sprint PD tracking legitimately spins limbs near ~110 rad/s; a fan that
 * snags or launches an athlete reads far above the baseline. A single-tick
 * pop above the soft ceiling is contact noise (a foot clip on the apex);
 * flail is a SUSTAINED exceedance (FLAIL_STREAK_TICKS in a row) or any
 * single tick over the hard ceiling (baseline x LIMB_ANGVEL_HARD), which is
 * what a solver explosion looks like. */
const LIMB_ANGVEL_MARGIN = 1.35;
const LIMB_ANGVEL_HARD = 2.5;
const FLAIL_STREAK_TICKS = 6;       // 0.1 s sustained over the soft ceiling.

// ── Ball traversal calibration ──
const BALL_TICKS = 240;
const BALL_RADIUS = 0.5;
const BALL_SPEED = 4.0;             // m/s toward the apex (a hard roll).
const BALL_BACKOFF_M = 8.0;
const BALL_FAN_MIN_Y = 11.8;        // center Y proving the ball rode the wedge.
const LATERAL_MAX_M = 1.2;          // max off-line drift before the footprint.
const REST_SURFACE_TOL = 0.45;      // rest must sit on verified terrain.

/** Input slot mirroring createInputSlot's shape (inputRouter is browser-bound,
 * so the field set is replicated here; headlessSim.js does the same). */
function makeSlot() {
  return {
    moveX: 0, moveZ: 0,
    moveWorld: new THREE.Vector3(),
    sprintHeld: false, slideHeld: false,
    jumpQueued: false, diveQueued: false,
    cutQueued: false,
    volleyQueued: false, spikeQueued: false,
    ballResetQueued: false,
    lookX: 0, lookY: 0,
    hasAim: false, aimYaw: 0, cameraYaw: 0,
  };
}

function unitToApex(corner) {
  const dx = corner.apex.x - corner.rim.x;
  const dz = corner.apex.z - corner.rim.z;
  const len = Math.hypot(dx, dz);
  return { x: dx / len, z: dz / len };
}

/** Lateral (perpendicular) offset of (x, z) from the line through `from`
 * along unit (dx, dz). */
function lateralOffset(x, z, from, dx, dz) {
  const rx = x - from.x;
  const rz = z - from.z;
  return Math.abs(rx * dz - rz * dx);
}

async function loadCharacter() {
  const buf = readFileSync(new URL('../public/models/character.glb', import.meta.url));
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
  const skinned = [];
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  gltf.scene.updateMatrixWorld(true);
  return { characterRoot: gltf.scene, characterSkeleton: skinned[0].skeleton, clips: gltf.animations };
}

/** Baseline: production athlete sprint on flat open-field terrain, far from
 * any corner. The limb angvel ceiling is calibrated from this (sprint PD
 * tracking legitimately spins limbs fast; flail = corner run significantly
 * above baseline). Returns the same stats shape as runAthleteTraversal. */
function runBaselineSprint(athlete, probe) {
  let maxY = -Infinity;
  let minY = Infinity;
  let maxStep = 0;
  let maxAngvel = 0;
  let prev = athlete.motor.body.translation();
  const slot = makeSlot();
  slot.moveWorld.set(0, 0, 1); // straight down the sideline, +z.
  slot.sprintHeld = true;
  const arenaPreset = activeArenaPreset();
  for (let tick = 0; tick < ATHLETE_TICKS; tick++) {
    athlete.prePhysicsUpdate({
      dt: DT, tick,
      inputSnapshot: slot,
      jumpQueued: false, diveQueued: false, cutQueued: false,
      volleyQueued: false, spikeQueued: false,
      balls: [], arenaPreset, targetGoalZ: 0, facingFollowsCamera: false,
    });
    stepPhysics();
    athlete.postPhysicsUpdate(tick, DT, [], [athlete], 0);
    const p = athlete.motor.body.translation();
    const step = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
    if (step > maxStep) maxStep = step;
    if (p.y > maxY) maxY = p.y;
    if (p.y < minY) minY = p.y;
    for (const item of athlete.ragdoll.rig.values()) {
      const av = item.body.angvel();
      const mag = Math.hypot(av.x, av.y, av.z);
      if (mag > maxAngvel) maxAngvel = mag;
    }
    prev = { x: p.x, y: p.y, z: p.z };
  }
  return { maxAngvel, maxStep, maxY, minY };
}

/** Part A: production athlete sprint through one corner. */
function runAthleteTraversal(athlete, probe, corner, dir, ceilings) {
  const apex = corner.apex;
  const spawn = athlete.motor.body.translation();
  const d0 = Math.hypot(spawn.x - apex.x, spawn.z - apex.z);

  let maxY = spawn.y;
  let minY = spawn.y;
  let maxStep = 0;
  let maxAngvel = 0;
  let clearanceFail = null;
  const angvelSeries = [];
  let prev = { ...spawn };

  const slot = makeSlot();
  slot.moveWorld.set(dir.x, 0, dir.z);
  slot.sprintHeld = true;
  const arenaPreset = activeArenaPreset();

  for (let tick = 0; tick < ATHLETE_TICKS; tick++) {
    athlete.prePhysicsUpdate({
      dt: DT, tick,
      inputSnapshot: slot,
      jumpQueued: false, diveQueued: false, cutQueued: false,
      volleyQueued: false, spikeQueued: false,
      balls: [], arenaPreset, targetGoalZ: 0, facingFollowsCamera: false,
    });
    stepPhysics();
    athlete.postPhysicsUpdate(tick, DT, [], [athlete], 0);

    const p = athlete.motor.body.translation();
    const step = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
    if (step > maxStep) maxStep = step;
    if (p.y > maxY) maxY = p.y;
    if (p.y < minY) minY = p.y;

    const terrain = surfaceY(probe, p.x, p.z);
    if (terrain !== null && p.y < terrain - MOTOR_CLEARANCE_M && !clearanceFail) {
      clearanceFail = { tick, x: +p.x.toFixed(2), z: +p.z.toFixed(2), motorY: +p.y.toFixed(2), terrain: +terrain.toFixed(2) };
    }

    let tickMax = 0;
    for (const item of athlete.ragdoll.rig.values()) {
      const av = item.body.angvel();
      const mag = Math.hypot(av.x, av.y, av.z);
      if (mag > maxAngvel) maxAngvel = mag;
      if (mag > tickMax) tickMax = mag;
    }
    angvelSeries.push(+tickMax.toFixed(1));
    prev = { x: p.x, y: p.y, z: p.z };
  }

  const end = athlete.motor.body.translation();
  const dEnd = Math.hypot(end.x - apex.x, end.z - apex.z);
  const progress = d0 - dEnd;

  const failures = [];
  if (progress < MIN_PROGRESS_M) failures.push(`stalled: radial progress ${progress.toFixed(2)} m < ${MIN_PROGRESS_M} m (blocked at the rim?)`);
  if (maxY < FAN_CLIMB_MIN_Y) failures.push(`no fan ascent: max motor Y ${maxY.toFixed(2)} < ${FAN_CLIMB_MIN_Y}`);
  if (minY < KILL_FLOOR_Y) failures.push(`fell through the world: min motor Y ${minY.toFixed(2)}`);
  if (clearanceFail) failures.push(`sank below terrain at tick ${clearanceFail.tick}: ${JSON.stringify(clearanceFail)}`);
  if (maxStep > MAX_STEP_M) failures.push(`teleport-sized step: ${maxStep.toFixed(2)} m > ${MAX_STEP_M} m`);
  let overStreak = 0;
  let maxOverStreak = 0;
  for (const v of angvelSeries) {
    if (v > ceilings.soft) { overStreak++; if (overStreak > maxOverStreak) maxOverStreak = overStreak; }
    else overStreak = 0;
  }
  if (maxOverStreak >= FLAIL_STREAK_TICKS) {
    failures.push(`sustained limb flail: ${maxOverStreak} consecutive ticks over ceiling ${ceilings.soft.toFixed(1)} rad/s (baseline x ${LIMB_ANGVEL_MARGIN})`);
  }
  if (maxAngvel > ceilings.hard) {
    failures.push(`solver-explosion limb spin: max angvel ${maxAngvel.toFixed(1)} rad/s > hard ceiling ${ceilings.hard.toFixed(1)} (baseline x ${LIMB_ANGVEL_HARD})`);
  }

  return {
    corner: corner.name,
    spawn: { x: +spawn.x.toFixed(2), y: +spawn.y.toFixed(2), z: +spawn.z.toFixed(2) },
    end: { x: +end.x.toFixed(2), y: +end.y.toFixed(2), z: +end.z.toFixed(2) },
    progressM: +progress.toFixed(2),
    maxMotorY: +maxY.toFixed(2),
    minMotorY: +minY.toFixed(2),
    maxStepM: +maxStep.toFixed(3),
    maxLimbAngvel: +maxAngvel.toFixed(1),
    maxOverCeilingStreak: maxOverStreak,
    angvelSeries,
    endInFootprint: pointInFanFootprint(end.x, end.z),
    failures,
  };
}

/** Part B: ball roll through one corner, in the plain gate world. */
function runBallTraversal(sim, probe, corner, dir) {
  const apex = corner.apex;
  const sx = corner.rim.x - dir.x * BALL_BACKOFF_M;
  const sz = corner.rim.z - dir.z * BALL_BACKOFF_M;
  const sy = surfaceY(probe, sx, sz);
  if (sy === null) return { corner: corner.name, failures: [`no terrain at ball spawn (${sx.toFixed(1)}, ${sz.toFixed(1)})`] };

  const body = sim.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true)
      .setLinearDamping(0.01).setAngularDamping(0.015));
  sim.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS).setDensity(4.2).setFriction(0.35).setRestitution(0.88),
    body);
  body.setTranslation({ x: sx, y: sy + BALL_RADIUS + 0.05, z: sz }, true);
  body.setLinvel({ x: dir.x * BALL_SPEED, y: 0, z: dir.z * BALL_SPEED }, true);

  let maxY = body.translation().y;
  let minY = maxY;
  let maxLateral = 0;
  let enteredFootprint = false;
  for (let t = 0; t < BALL_TICKS; t++) {
    sim.step();
    const p = body.translation();
    if (p.y > maxY) maxY = p.y;
    if (p.y < minY) minY = p.y;
    if (!enteredFootprint && pointInFanFootprint(p.x, p.z)) enteredFootprint = true;
    if (!enteredFootprint) {
      const off = lateralOffset(p.x, p.z, { x: sx, z: sz }, dir.x, dir.z);
      if (off > maxLateral) maxLateral = off;
    }
  }
  const rest = body.translation();
  const restBase = rest.y - BALL_RADIUS;
  const terrainAtRest = surfaceY(probe, rest.x, rest.z);
  sim.removeRigidBody(body);

  const failures = [];
  if (maxY < BALL_FAN_MIN_Y) failures.push(`ball never rode the wedge: max center Y ${maxY.toFixed(2)} < ${BALL_FAN_MIN_Y} (rim is ${RIM_Y})`);
  if (minY < KILL_FLOOR_Y) failures.push(`ball fell through the world: minY ${minY.toFixed(2)}`);
  if (terrainAtRest === null || restBase < terrainAtRest - REST_SURFACE_TOL) {
    failures.push(`ball not resting on terrain: restBase ${restBase.toFixed(2)} vs terrain ${terrainAtRest === null ? 'null' : terrainAtRest.toFixed(2)}`);
  }
  if (maxLateral > LATERAL_MAX_M) failures.push(`artificial deflection before the fan: lateral ${maxLateral.toFixed(2)} m > ${LATERAL_MAX_M} m`);

  return {
    corner: corner.name,
    spawn: { x: +sx.toFixed(2), y: +(sy + BALL_RADIUS).toFixed(2), z: +sz.toFixed(2) },
    rest: { x: +rest.x.toFixed(2), y: +rest.y.toFixed(2), z: +rest.z.toFixed(2) },
    maxCenterY: +maxY.toFixed(2),
    minCenterY: +minY.toFixed(2),
    maxLateralBeforeFootprintM: +maxLateral.toFixed(3),
    failures,
  };
}

async function main() {
  const { probe, meshes, sim } = await buildWorld();

  // Production world for the athlete: initPhysics + the stamped arena,
  // mirroring loadCourtArena's collider path exactly (Law 10 flags,
  // ENVIRONMENT_GROUPS, fixed body).
  await initPhysics(DT);
  const world = getWorld();
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const mesh of meshes) {
    const desc = mesh.isCourtSurface
      ? RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      : RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices);
    const collider = world.createCollider(desc, groundBody);
    collider.setCollisionGroups(ENVIRONMENT_GROUPS);
  }

  const scene = new THREE.Scene();
  const character = await loadCharacter();

  // Flat-ground sprint baseline for the limb-flail ceiling.
  const baseX = 18, baseZ = -20;
  const baseY = surfaceY(probe, baseX, baseZ);
  if (baseY === null) throw new Error('no terrain at baseline spawn');
  const baseAthlete = createAthlete({
    id: 'p1', athleteIndex: 0, team: 'home',
    spawn: { x: baseX, y: baseY + 0.9, z: baseZ, yaw: 0 },
    scene, ...character,
  });
  const baseline = runBaselineSprint(baseAthlete, probe);
  baseAthlete.setEnabled(false);
  const ceilings = {
    soft: baseline.maxAngvel * LIMB_ANGVEL_MARGIN,
    hard: baseline.maxAngvel * LIMB_ANGVEL_HARD,
  };
  console.log(`baseline sprint: maxAngvel ${baseline.maxAngvel.toFixed(1)} rad/s, maxStep ${baseline.maxStep.toFixed(3)} m -> limb ceilings soft ${ceilings.soft.toFixed(1)} / hard ${ceilings.hard.toFixed(1)} rad/s`);

  const athleteResults = [];
  const ballResults = [];

  for (const corner of CORNERS) {
    const dir = unitToApex(corner);

    // A: athlete sprint.
    const sx = corner.rim.x - dir.x * SPAWN_BACKOFF_M;
    const sz = corner.rim.z - dir.z * SPAWN_BACKOFF_M;
    const sy = surfaceY(probe, sx, sz);
    if (sy === null) {
      athleteResults.push({ corner: corner.name, failures: [`no terrain at athlete spawn (${sx.toFixed(1)}, ${sz.toFixed(1)})`] });
    } else {
      const athlete = createAthlete({
        id: 'p1', athleteIndex: 0, team: 'home',
        spawn: { x: sx, y: sy + 0.9, z: sz, yaw: Math.atan2(dir.x, dir.z) },
        scene, ...character,
      });
      athleteResults.push(runAthleteTraversal(athlete, probe, corner, dir, ceilings));
      athlete.setEnabled(false);
    }

    // B: ball roll.
    ballResults.push(runBallTraversal(sim, probe, corner, dir));
  }

  const failures = athleteResults.flatMap((r) => r.failures).length + ballResults.flatMap((r) => r.failures).length;
  const pass = failures === 0;
  const report = {
    pass,
    arena: 'public/models/arena.glb',
    athlete: { ticks: ATHLETE_TICKS, minProgressM: MIN_PROGRESS_M, fanClimbMinY: FAN_CLIMB_MIN_Y, limbCeilingSoftRadS: +ceilings.soft.toFixed(1), limbCeilingHardRadS: +ceilings.hard.toFixed(1), flailStreakTicks: FLAIL_STREAK_TICKS, baselineMaxAngvel: +baseline.maxAngvel.toFixed(1), results: athleteResults },
    ball: { ticks: BALL_TICKS, speed: BALL_SPEED, fanMinY: BALL_FAN_MIN_Y, lateralMaxM: LATERAL_MAX_M, results: ballResults },
    failures,
  };
  const outPath = new URL('../test_athlete_corner_traversal_report.json', import.meta.url);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  for (const r of athleteResults) {
    console.log(`athlete ${r.corner}: progress ${r.progressM} m, maxMotorY ${r.maxMotorY}, maxStep ${r.maxStepM} m, maxAngvel ${r.maxLimbAngvel} (streak over soft ceiling: ${r.maxOverCeilingStreak}), end ${JSON.stringify(r.end)} ${r.failures.length ? 'FAIL: ' + r.failures.join('; ') : 'pass'}`);
  }
  for (const r of ballResults) {
    console.log(`ball    ${r.corner}: maxCenterY ${r.maxCenterY}, lateral ${r.maxLateralBeforeFootprintM} m, rest ${JSON.stringify(r.rest)} ${r.failures.length ? 'FAIL: ' + r.failures.join('; ') : 'pass'}`);
  }
  console.log(pass ? 'TRAVERSAL PASS — athletes and balls ride the corner fan' : `TRAVERSAL FAIL — ${failures} failures`);
  console.log(`report: ${outPath}`);

  probe.free();
  sim.free();
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
