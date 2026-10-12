/**
 * BOUNDARY DROP / FALL-THROUGH GATE — dynamic corner + perimeter coverage test.
 *
 * Spawns a regulation ball and a player-representative capsule ON TOP of the
 * four corner platforms and along the perimeter edges of the enclosed court,
 * steps the Rapier simulation with movement input for several seconds, and
 * asserts that no entity clips through or falls into the void: every entity's
 * Y must remain above the out-of-bounds kill plane for the whole run.
 *
 * This is the mechanism-agnostic regression guard for the v0.3.2 corner
 * fall-through bug. It does not care WHY a surface lets an entity through
 * (missing collider, inverted one-sided winding, seam gap): it drops moving
 * bodies onto the platform and fails if any of them leaves the void floor.
 *
 * Exit contract: exit code 0 when every spawn stays above the floor, 1 if any
 * entity falls through. Writes test_boundary_drops_report.json next to the
 * package root.
 *
 * Run: npm run test:drops
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildWorld, surfaceY } from './test_ball_roll.mjs';

// ═══ CONSTANTS ═══

const DT = 1 / 60;

/** Out-of-bounds kill plane (references/court_spec.md). "Above floor level"
 * for this test means never dropping to or below this line. */
const KILL_FLOOR_Y = -5.0;

/** Simulation length per spawn (ticks at 60 Hz). */
const TICKS = 240; // 4 s

// Ball (matches scripts/test_ball_roll.mjs createBall).
const BALL_RADIUS = 0.5;
const BALL_DENSITY = 4.2;
const BALL_FRICTION = 0.35;
const BALL_RESTITUTION = 0.88;

// Player representative: a standing capsule of the athlete height (no joints,
// just the dynamic root shape that must never fall through).
const PLAYER_HALF_HEIGHT = 0.5;
const PLAYER_RADIUS = 0.35;
const PLAYER_DENSITY = 1.0;
const PLAYER_FRICTION = 0.5;
const PLAYER_RESTITUTION = 0.3;

const SPAWN_GAP = 0.02; // clearance above the surface at spawn.

// Movement input: initial horizontal speed (m/s) plus a sustained forward
// acceleration (m/s^2) toward the outer corner, so each entity traverses the
// platform and presses against the rim/curtain/cap seams.
const LAUNCH_SPEED = 3.0;
const WALK_ACCEL = 1.5;

// Corner-platform footprint (single quadrant; mirrored across all four).
const CORNER_X_MIN = 15.0;
const CORNER_X_MAX = 24.0;
const CORNER_Z_MIN = 45.0;
const CORNER_Z_MAX = 59.0;

// Perimeter edges.
const COURT_X = 24.0;
const COURT_Z = 58.0;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ═══ HELPERS ═══

function range(a, b, step) {
  const out = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Spawn a dynamic body of `kind` ('ball' or 'player') at (x, y, z) with an
 * initial horizontal velocity toward the corner quadrant (sx, sz). */
function spawnEntity(sim, kind, x, y, z, sx, sz) {
  const body = sim.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(0.01)
      .setAngularDamping(0.015),
  );
  const cd =
    kind === 'ball'
      ? RAPIER.ColliderDesc.ball(BALL_RADIUS)
          .setDensity(BALL_DENSITY)
          .setFriction(BALL_FRICTION)
          .setRestitution(BALL_RESTITUTION)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      : RAPIER.ColliderDesc.capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS)
          .setDensity(PLAYER_DENSITY)
          .setFriction(PLAYER_FRICTION)
          .setRestitution(PLAYER_RESTITUTION);
  sim.createCollider(cd, body);
  body.setTranslation({ x, y, z }, true);
  const inv = Math.SQRT1_2; // diagonal unit toward (sx, sz)
  body.setLinvel({ x: sx * LAUNCH_SPEED * inv, y: 0, z: sz * LAUNCH_SPEED * inv }, true);
  return body;
}

/** Step the sim for `ticks`, applying a sustained horizontal walk force toward
 * (sx, sz) to the player (a ball coasts on its initial velocity). Tracks the
 * minimum Y reached. `probe` is the terrain-only raycast world. */
function runSpawn(probe, sim, kind, x, z) {
  const surf = surfaceY(probe, x, z);
  if (surf === null) return { skipped: true, reason: 'no-surface', x, z };

  const sx = x >= 0 ? 1 : -1;
  const sz = z >= 0 ? 1 : -1;
  const lift = kind === 'ball' ? BALL_RADIUS : PLAYER_HALF_HEIGHT + PLAYER_RADIUS;
  const body = spawnEntity(sim, kind, x, surf + lift + SPAWN_GAP, z, sx, sz);

  const mass = body.mass();
  const inv = Math.SQRT1_2;
  let minY = body.translation().y;
  let minYFound = true;

  for (let t = 0; t < TICKS; t++) {
    if (kind === 'player' && mass > 0) {
      const f = mass * WALK_ACCEL;
      body.addForce({ x: sx * f * inv, y: 0, z: sz * f * inv }, true);
    }
    sim.step();
    const y = body.translation().y;
    if (y < minY) minY = y;
  }

  const finalY = body.translation().y;
  sim.removeRigidBody(body);
  return { skipped: false, minY, finalY, spawnSurfaceY: surf, fellOut: minY < KILL_FLOOR_Y };
}

// ═══ TEST ═══

async function main() {
  await RAPIER.init();
  const { sim, probe } = await buildWorld();

  const spawns = [];
  // four corner platforms, dense grid
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    for (const x of range(CORNER_X_MIN, CORNER_X_MAX, 1.0)) {
      for (const z of range(CORNER_Z_MIN, CORNER_Z_MAX, 1.0)) {
        spawns.push({ x: sx * x, z: sz * z, region: 'corner' });
      }
    }
  }
  // perimeter edges: long sides (x = +/- COURT_X) and back ends (z = +/- COURT_Z)
  for (const x of [COURT_X, -COURT_X]) {
    for (const z of range(-(COURT_Z - 2), COURT_Z - 2, 3.0)) spawns.push({ x, z, region: 'perimeter' });
  }
  for (const z of [COURT_Z, -COURT_Z]) {
    for (const x of range(-(COURT_X - 2), COURT_X - 2, 3.0)) spawns.push({ x, z, region: 'perimeter' });
  }

  const results = [];
  let falls = 0;
  for (const { x, z, region } of spawns) {
    const ball = runSpawn(probe, sim, 'ball', x, z);
    const player = runSpawn(probe, sim, 'player', x, z);
    for (const [kind, r] of [['ball', ball], ['player', player]]) {
      results.push({ x, z, region, kind, ...r });
      if (!r.skipped && r.fellOut) falls++;
    }
  }

  const pass = falls === 0;
  const report = {
    pass,
    arena: 'public/models/arena.glb',
    killFloorY: KILL_FLOOR_Y,
    ticksPerSpawn: TICKS,
    spawnPoints: spawns.length,
    entities: results.length,
    fallThroughs: falls,
    worst: results
      .filter((r) => !r.skipped)
      .sort((a, b) => a.minY - b.minY)
      .slice(0, 16)
      .map((r) => ({ x: r.x, z: r.z, region: r.region, kind: r.kind, minY: +r.minY.toFixed(2), spawnSurfaceY: +r.spawnSurfaceY.toFixed(2) })),
  };

  const outPath = path.join(ROOT, 'test_boundary_drops_report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`spawned ${results.length} entities across ${spawns.length} points, ${falls} fell out of bounds`);
  console.log(pass ? 'DROP TEST PASS — no entity fell through' : 'DROP TEST FAIL — see report');
  console.log(`report: ${outPath}`);

  sim.free();
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});