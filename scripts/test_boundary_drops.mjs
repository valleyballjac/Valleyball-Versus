/**
 * BOUNDARY DROP / FALL-THROUGH GATE — dynamic corner + perimeter coverage test.
 *
 * Two complementary checks against the exact COL_ world the game builds:
 *
 *   1. Corner fan certification. The four corner wedges are backed by a
 *      SLOPED RADIAL FAN (COL_Barriers): rim at y = 11.00 rising to the
 *      13.00 m apex at the outer corner. Two halves, static and dynamic:
 *      (a) static rest check — under every fan point the topmost solid
 *      surface of the terrain world must BE the fan surface (a missing fan
 *      returns the ~10.5 m court rim below it, a phantom obstruction returns
 *      a surface above it); (b) dynamic drop — a regulation ball and a
 *      player-representative capsule are dropped onto the sloped fan at each
 *      standing point and must come to rest on verified terrain inside the
 *      enclosed court: downhill roll into the field is legitimate, but the
 *      resting bottom must not sit below the surface under it (fall-through
 *      into the void or an exit through the glass fails). The spawn height is
 *      the fan surface itself, never the highest remaining collider, so a
 *      missing fan cannot be masked at spawn.
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
  buildFanWorld,
  cornerCapStandingPoints,
  cornerCapRestCheck,
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

const SPAWN_GAP = 0.05; // clearance above the fan surface at spawn.

/** Rest-on-terrain tolerance (m): the resting bottom must not sit more than
 * this BELOW the raycast surface at the rest point. No upper bound: a ball
 * that rolls into the field can wedge against a stream bank or mound slope,
 * resting legitimately above the floor directly under it (measured up to
 * ~1.5 m on bank slopes). Fall-through reads as a rest metres below any
 * surface or an exit past the kill plane; phantom perches above the fan are
 * the static rest check's job. */
const REST_SURFACE_TOL_BELOW = 0.45;

/** Enclosed-court rest envelope: glass walls at |x| = 25, |z| = 60. */
const REST_ENVELOPE_X = 26.0;
const REST_ENVELOPE_Z = 61.0;

// Movement input for the perimeter roll: initial horizontal speed (m/s) plus a
// sustained forward acceleration (m/s^2) toward the outer wall, so each entity
// traverses the floor and presses against the rim/curtain/cap seams.
const LAUNCH_SPEED = 3.0;
const WALK_ACCEL = 1.5;

// Perimeter edges (inner facets, inset from the corner caps which are handled
// separately by the corner rest certification).
const COURT_X = 24.0;
const COURT_Z = 58.0;

// Back-boundary high-speed sweep (seals the vertical gap in the back wall at
// z = +-60 over the y in [6, 30] band that the COL_BackBoundary wall closes).
// Entities are fired horizontally at strike speed, straight into the wall at
// surface height, swept across the full back width. Containment = the entity
// never crosses the wall plane (|z| <= SWEEP_BREACH_Z) or falls into the void.
const SWEEP_SPEED = 24.0;       // m/s, hard-strike horizontal speed
const SWEEP_LAUNCH_INSET = 8.0; // spawn distance in from the wall plane (m)
const SWEEP_BREACH_Z = 60.6;    // |z| past the wall plane = tunnelled through

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
 * tips onto its side on the sloped fan (unstable upright equilibrium), so its
 * lowest point is center - radius - halfHeight*|axisY| whatever its rest
 * orientation. The ball is center - radius. */
function bottomOf(kind, body) {
  const p = body.translation();
  if (kind === 'ball') return p.y - BALL_RADIUS;
  const q = body.rotation();
  const axisY = 1 - 2 * (q.x * q.x + q.z * q.z); // world Y component of the local +Y axis
  return p.y - PLAYER_RADIUS - PLAYER_HALF_HEIGHT * Math.abs(axisY);
}

/**
 * Corner fan dynamic drop: spawn `kind` just above the sloped fan surface at
 * (x, z) with no horizontal motion. It must stay inside the enclosed court and
 * come to rest ON verified terrain: downhill roll from the fan into the field
 * is legitimate, but the resting bottom must match the topmost surface under
 * the rest point (a fall-through reads as a rest far below any surface or an
 * exit past the kill plane / glass envelope).
 */
function runCornerDrop(sim, probe, kind, x, z, fanY) {
  const lift = liftOf(kind);
  const body = spawnEntity(sim, kind, x, fanY + lift + SPAWN_GAP, z, 0, 0, false);
  let minY = body.translation().y;
  for (let t = 0; t < TICKS; t++) {
    sim.step();
    const y = body.translation().y;
    if (y < minY) minY = y;
  }
  const rest = body.translation();
  const restBase = bottomOf(kind, body);
  sim.removeRigidBody(body);
  const stayedInside =
    Math.abs(rest.x) <= REST_ENVELOPE_X && Math.abs(rest.z) <= REST_ENVELOPE_Z;
  const terrainAtRest = stayedInside ? surfaceY(probe, rest.x, rest.z) : null;
  const restedOnTerrain =
    terrainAtRest !== null && restBase >= terrainAtRest - REST_SURFACE_TOL_BELOW;
  return {
    fellOut: minY < KILL_FLOOR_Y || !stayedInside || !restedOnTerrain,
    restBase,
    minY,
    terrainAtRest,
    restX: +rest.x.toFixed(2),
    restZ: +rest.z.toFixed(2),
    fanRest: stayedInside && restedOnTerrain,
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

/**
 * Back-boundary high-speed sweep: fire `kind` horizontally at SWEEP_SPEED
 * toward wallZ (+-60) from SWEEP_LAUNCH_INSET inside the wall.
 * Assert it never breaches (|z| > SWEEP_BREACH_Z) or falls below the kill floor.
 */
function runBackBoundarySweep(sim, probe, kind, wallZ, x) {
  const dir = wallZ > 0 ? 1 : -1;
  const spawnZ = wallZ - dir * SWEEP_LAUNCH_INSET;
  const surf = surfaceY(probe, x, spawnZ);
  if (surf === null) {
    return { missingSurface: true, fellOut: true, maxAbsZ: null, minY: null };
  }
  const lift = liftOf(kind);
  const body = spawnEntity(sim, kind, x, surf + lift + SPAWN_GAP, spawnZ, 0, 0, false);
  body.setLinvel({ x: 0, y: 0, z: dir * SWEEP_SPEED }, true);
  let maxAbsZ = 0;
  let minY = body.translation().y;
  for (let t = 0; t < TICKS; t++) {
    sim.step();
    const p = body.translation();
    if (Math.abs(p.z) > maxAbsZ) maxAbsZ = Math.abs(p.z);
    if (p.y < minY) minY = p.y;
  }
  sim.removeRigidBody(body);
  const fellOut = maxAbsZ > SWEEP_BREACH_Z || minY < KILL_FLOOR_Y;
  return { missingSurface: false, fellOut, maxAbsZ: +maxAbsZ.toFixed(2), minY: +minY.toFixed(2) };
}

// ═══ TEST ═══

async function main() {
  await RAPIER.init();
  const { sim, probe } = await buildWorld();
  const { world: fanWorld } = await buildFanWorld();

  const results = [];
  let failures = 0;

  // Static fan rest certification: under every pristine fan point the topmost
  // solid surface must BE the fan (catches missing/inverted/obstructed fan
  // without depending on dynamics).
  const rest = cornerCapRestCheck(probe, fanWorld, 1.0);
  if (rest.failures.length > 0) failures += rest.failures.length;

  // Dynamic corner drops: every fan-backed standing point, all four
  // quadrants, full footprint.
  const cornerPoints = cornerCapStandingPoints(fanWorld, 1.0);
  for (const { x, z, fanY } of cornerPoints) {
    for (const kind of ['ball', 'player']) {
      const r = runCornerDrop(sim, probe, kind, x, z, fanY);
      const fail = r.fellOut || !r.fanRest;
      if (fail) failures++;
      results.push({ region: 'corner', x, z, kind, fanY: +fanY.toFixed(2), ...r, fail });
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

  // Back-boundary high-speed sweep: strike speed into both back walls across full width.
  const sweepXs = range(-24.0, 24.0, 3.0);
  for (const wallZ of [60.0, -60.0]) {
    for (const x of sweepXs) {
      for (const kind of ['ball', 'player']) {
        const r = runBackBoundarySweep(sim, probe, kind, wallZ, x);
        const fail = r.fellOut || r.missingSurface;
        if (fail) failures++;
        results.push({ region: 'back_boundary_sweep', wallZ, x, kind, ...r, fail });
      }
    }
  }

  const pass = failures === 0;
  const report = {
    pass,
    arena: 'public/models/arena.glb',
    killFloorY: KILL_FLOOR_Y,
    restSurfaceTolBelow: REST_SURFACE_TOL_BELOW,
    ticksPerSpawn: TICKS,
    staticRestCheck: {
      sampled: rest.checked,
      failures: rest.failures.slice(0, 16),
    },
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
        terrainAtRest: r.terrainAtRest == null ? null : +r.terrainAtRest.toFixed(2),
        restX: r.restX,
        restZ: r.restZ,
        missingSurface: !!r.missingSurface,
      })),
  };

  const outPath = path.join(ROOT, 'test_boundary_drops_report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`corner fan static rest checks: ${rest.checked} points, ${rest.failures.length} failures`);
  console.log(`corner fan dynamic drops: ${cornerPoints.length} points x 2 entities`);
  console.log(`perimeter roll points: ${perimSpawns.length} x 2 entities`);
  console.log(`back-boundary high-speed sweeps: ${sweepXs.length * 2} points x 2 entities`);
  console.log(`spawned ${results.length} entities, ${failures} failures`);
  console.log(pass ? 'DROP TEST PASS — corner fan holds, perimeter sealed' : 'DROP TEST FAIL — see report');
  console.log(`report: ${outPath}`);

  fanWorld.free();
  sim.free();
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});