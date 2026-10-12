/**
 * BOUNDARY DROP / FALL-THROUGH GATE — dynamic corner + perimeter coverage test.
 *
 * Two complementary checks against the exact COL_ world the game builds:
 *
 *   1. Corner cap rest certification. For every VIS corner standing surface
 *      (the flat 13 m shelf top, y >= CAP_VIS_MIN_Y) across all four
 *      quadrants, a regulation ball and a player-representative capsule are
 *      dropped ONTO the intended cap height and must come to rest at the cap
 *      (bottom >= CAP_REST_MIN_Y). This is the mechanism-agnostic guard for
 *      the v0.3.2 corner fall-through bug: a missing or inverted cap leaves
 *      only the ~11 m terrain rim (or the void) below, so the entity rests
 *      below shelf height and the check fails. The spawn height is the
 *      INTENDED cap, never the highest remaining collider, so a missing cap
 *      cannot be masked by spawning on the rim. A point with no standing
 *      surface to rest on is a failure, not a skip.
 *
 *   2. Perimeter edge roll. Spawns along the inner court perimeter and moves
 *      each entity outward against the glass, asserting none falls below the
 *      out-of-bounds kill plane (the long-side sill / vertical-curtain
 *      entrapment regression). A missing court floor under a perimeter point
 *      is a failure, not a skip.
 *
 * Exit contract: exit code 0 when every corner entity rests at shelf height
 * and every perimeter entity stays above the kill plane, 1 otherwise. Writes
 * test_boundary_drops_report.json next to the package root.
 *
 * Run: npm run test:drops
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildWorld, surfaceY } from './test_ball_roll.mjs';
import {
  CAP_HEIGHT_M,
  CAP_REST_MIN_Y,
  buildVisStandingWorld,
  cornerCapStandingPoints,
} from './corner_cap_gate.mjs';

// ═══ CONSTANTS ═══

const DT = 1 / 60;

/** Out-of-bounds kill plane (references/court_spec.md). "Above floor level"
 * for the perimeter test means never dropping to or below this line. */
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

const SPAWN_GAP = 0.05; // clearance above the intended cap at spawn.

// Movement input for the perimeter roll: initial horizontal speed (m/s) plus a
// sustained forward acceleration (m/s^2) toward the outer wall, so each entity
// traverses the floor and presses against the rim/curtain/cap seams.
const LAUNCH_SPEED = 3.0;
const WALK_ACCEL = 1.5;

// Perimeter edges (inner facets, inset from the corner caps which are handled
// separately by the corner rest certification).
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

/** Create a dynamic body of `kind` ('ball' or 'player') at (x, y, z). When
 * `launch` is a signed quadrant pair the body starts moving toward (sx, sz);
 * otherwise it starts at rest (vertical drop). */
function spawnEntity(sim, kind, x, y, z, sx, sz, launch) {
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
  if (launch) {
    const inv = Math.SQRT1_2; // diagonal unit toward (sx, sz)
    body.setLinvel({ x: sx * LAUNCH_SPEED * inv, y: 0, z: sz * LAUNCH_SPEED * inv }, true);
  }
  return body;
}

/** Vertical bottom offset of a resting body (its center-to-bottom distance). */
function liftOf(kind) {
  return kind === 'ball' ? BALL_RADIUS : PLAYER_HALF_HEIGHT + PLAYER_RADIUS;
}

/** True geometric bottom Y of a resting body, orientation-aware. A capsule
 * tips onto its side on a flat cap (unstable upright equilibrium), so its
 * lowest point is center - radius - halfHeight*|axisY|: 13.0 on the cap
 * whether upright or lying flat. The ball is center - radius. */
function bottomOf(kind, body) {
  const p = body.translation();
  if (kind === 'ball') return p.y - BALL_RADIUS;
  const q = body.rotation();
  const axisY = 1 - 2 * (q.x * q.x + q.z * q.z); // world Y component of the local +Y axis
  return p.y - PLAYER_RADIUS - PLAYER_HALF_HEIGHT * Math.abs(axisY);
}

/**
 * Corner cap rest certification: spawn `kind` at the intended 13 m cap height
 * with no horizontal motion and require it to come to rest on the shelf
 * (bottom >= CAP_REST_MIN_Y). A missing/inverted cap drops it to the ~11 m rim
 * or the void, failing the check.
 */
function runCornerDrop(sim, kind, x, z) {
  const lift = liftOf(kind);
  const body = spawnEntity(sim, kind, x, CAP_HEIGHT_M + lift + SPAWN_GAP, z, 0, 0, false);
  let minY = body.translation().y;
  for (let t = 0; t < TICKS; t++) {
    sim.step();
    const y = body.translation().y;
    if (y < minY) minY = y;
  }
  const restBase = bottomOf(kind, body);
  sim.removeRigidBody(body);
  return {
    fellOut: minY < KILL_FLOOR_Y,
    restBase,
    capRest: restBase >= CAP_REST_MIN_Y,
  };
}

/**
 * Perimeter roll: spawn `kind` on the court floor at (x, z) and move it toward
 * the outer wall, asserting it never falls below the kill plane. A point with
 * no floor is a failure (missing surface), not a skip.
 */
function runPerimeterSpawn(probe, sim, kind, x, z) {
  const surf = surfaceY(probe, x, z);
  if (surf === null) {
    return { missingSurface: true, fellOut: true, minY: null, spawnSurfaceY: null };
  }
  const sx = x >= 0 ? 1 : -1;
  const sz = z >= 0 ? 1 : -1;
  const lift = liftOf(kind);
  const body = spawnEntity(sim, kind, x, surf + lift + SPAWN_GAP, z, sx, sz, true);

  const mass = body.mass();
  const inv = Math.SQRT1_2;
  let minY = body.translation().y;
  for (let t = 0; t < TICKS; t++) {
    if (kind === 'player' && mass > 0) {
      const f = mass * WALK_ACCEL;
      body.addForce({ x: sx * f * inv, y: 0, z: sz * f * inv }, true);
    }
    sim.step();
    const y = body.translation().y;
    if (y < minY) minY = y;
  }
  sim.removeRigidBody(body);
  return { missingSurface: false, fellOut: minY < KILL_FLOOR_Y, minY, spawnSurfaceY: surf };
}

// ═══ TEST ═══

async function main() {
  await RAPIER.init();
  const { sim, probe } = await buildWorld();
  const { world: visWorld } = await buildVisStandingWorld();

  const results = [];
  let failures = 0;

  // Corner cap rest certification: every cap-backed standing corner point,
  // all four quadrants, full footprint.
  const cornerPoints = cornerCapStandingPoints(visWorld, 1.0);
  for (const { x, z } of cornerPoints) {
    for (const kind of ['ball', 'player']) {
      const r = runCornerDrop(sim, kind, x, z);
      const fail = r.fellOut || !r.capRest;
      if (fail) failures++;
      results.push({ region: 'corner', x, z, kind, ...r, fail });
    }
  }

  // Perimeter edges: long sides (x = +/- COURT_X) and back ends (z = +/- COURT_Z).
  const perimSpawns = [];
  for (const x of [COURT_X, -COURT_X]) {
    for (const z of range(-(COURT_Z - 2), COURT_Z - 2, 3.0)) perimSpawns.push({ x, z });
  }
  for (const z of [COURT_Z, -COURT_Z]) {
    for (const x of range(-(COURT_X - 2), COURT_X - 2, 3.0)) perimSpawns.push({ x, z });
  }
  for (const { x, z } of perimSpawns) {
    for (const kind of ['ball', 'player']) {
      const r = runPerimeterSpawn(probe, sim, kind, x, z);
      const fail = r.fellOut || r.missingSurface;
      if (fail) failures++;
      results.push({ region: 'perimeter', x, z, kind, ...r, fail });
    }
  }

  const pass = failures === 0;
  const report = {
    pass,
    arena: 'public/models/arena.glb',
    killFloorY: KILL_FLOOR_Y,
    capHeightM: CAP_HEIGHT_M,
    capRestMinY: CAP_REST_MIN_Y,
    ticksPerSpawn: TICKS,
    cornerPoints: cornerPoints.length,
    entities: results.length,
    failures,
    worst: results
      .filter((r) => r.fail)
      .slice(0, 32)
      .map((r) => ({
        region: r.region,
        x: r.x,
        z: r.z,
        kind: r.kind,
        restBaseM: r.restBase == null ? null : +r.restBase.toFixed(2),
        minY: r.minY == null ? null : +r.minY.toFixed(2),
        missingSurface: !!r.missingSurface,
      })),
  };

  const outPath = path.join(ROOT, 'test_boundary_drops_report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`corner cap rest checks: ${cornerPoints.length} points x 2 entities`);
  console.log(`perimeter roll points: ${perimSpawns.length} x 2 entities`);
  console.log(`spawned ${results.length} entities, ${failures} failures`);
  console.log(pass ? 'DROP TEST PASS — every corner entity rested at shelf height' : 'DROP TEST FAIL — see report');
  console.log(`report: ${outPath}`);

  visWorld.free();
  sim.free();
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});