/**
 * COLLISION COVERAGE AUDIT — static terrain-collider coverage gate.
 *
 * Verifies that every point of visual walkable terrain (the corner polygons
 * VIS_Corner_*, the inner/outer field, the stream beds, the goal mounds, and
 * the outer-field perimeter wall) is backed by an active Rapier COL_ collider,
 * and that no point of the enclosed court footprint is a downward "hole"
 * through which a dropped entity would fall into the void.
 *
 * Two rules, both raycast-based against the exact COL_ world the game builds
 * (COL_Court with FIX_INTERNAL_EDGES + inverted-triangle filtering, plus
 * COL_Barriers and COL_Goals):
 *
 *   Rule 1 — Downward hole sweep. A downward ray from y = +80 must strike a
 *            solid collider above the out-of-bounds kill plane for every
 *            sample point across the full court footprint (and a denser sweep
 *            of the four corner platforms). A miss, or a hit below the kill
 *            plane, is a hole: a point where a dropped entity would fall into
 *            the void.
 *
 *   Rule 2 — Visual walkable coverage. Every sample point where a VIS
 *            standing-surface mesh is present must have a COL_ collider within
 *            BACKING_TOLERANCE metres, either below (the walkable floor) or
 *            above (a glass-bottom corner cap). A point with no collider
 *            within tolerance on either side is an uncovered visual-only
 *            surface: the v0.3.2 "VIS lacked an underlying COL collider" class
 *            of bug, where a ball or player reads a surface the physics body
 *            does not.
 *
 *   Rule 3 — Corner fan certification. The four corner wedges (VIS_Corner_*)
 *            are standing surfaces backed by a SLOPED RADIAL FAN in
 *            COL_Barriers: 16 up-facing triangles per quadrant, rim vertices
 *            at y = 11.00 rising to a shared apex at y = 13.00 at the outer
 *            corner (v10.7/v10.11 geometry). Each quadrant must carry the fan
 *            (present, up-facing, rim-to-apex continuous, nothing vertical in
 *            the fan band), and the topmost solid surface under every fan
 *            point must BE the fan surface: the ~10.5 m court rim below means
 *            fall-through, a surface above means a phantom obstruction. The
 *            2.5 m backing tolerance of Rule 2 alone accepts the court rim as
 *            "backing" for the sloped fan, so this rule certifies the fan
 *            itself against the pristine arena.glb.
 *
 * Exit contract: exit code 0 when the court passes all three rules, 1
 * otherwise. Writes audit_collision_coverage_report.json next to the package
 * root.
 *
 * Run: npm run audit:coverage
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildWorld, surfaceY } from './test_ball_roll.mjs';
import {
  buildVisStandingWorld,
  buildFanWorld,
  cornerCapWinding,
  cornerCapRestCheck,
} from './corner_cap_gate.mjs';

// ═══ CONSTANTS ═══

/** Out-of-bounds kill plane (references/court_spec.md). Anything at or below
 * this is the void, not "above floor level". */
const KILL_FLOOR_Y = -5.0;

/** Vertical tolerance (m) for Rule 2: a VIS surface is "backed" if a COL
 * collider sits within this distance below or above it. Calibrated against the
 * fixed arena, where the flat VIS_Corner render surface (y = 11.67) sits above
 * a sloped fan collider spanning 11.0 to 13.0 m, a legitimate gap of up to
 * ~1.35 m near the apex. */
const BACKING_TOLERANCE_M = 2.5;

/** Ray search depth (m) for the backing test on each side of a VIS surface. */
const BACKING_SEARCH_M = 3.0;

/** Full-court sweep spacing (m). */
const GRID_STEP = 1.0;

/** Dense corner-platform sweep spacing (m). */
const CORNER_STEP = 0.5;

/** Corner-platform footprint: a single quadrant (mirrored across all four). */
const CORNER_X_MIN = 15.0;
const CORNER_X_MAX = 25.0;
const CORNER_Z_MIN = 45.0;
const CORNER_Z_MAX = 60.0;

/** Court footprint extent (full enclosed glass boundary |x|<=25, |z|<=60). */
const COURT_X = 25.0;
const COURT_Z = 60.0;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ═══ HELPERS ═══

function range(a, b, step) {
  const out = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Downward surface Y at (x, z) in a world, from y0, limited to `max` metres. */
function castDown(world, x, y0, z, max) {
  const ray = new RAPIER.Ray({ x, y: y0, z }, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(ray, max, true);
  if (!hit) return null;
  const toi = hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
  return y0 - toi;
}

/** Upward surface Y at (x, z) in a world, from y0, limited to `max` metres. */
function castUp(world, x, y0, z, max) {
  const ray = new RAPIER.Ray({ x, y: y0, z }, { x: 0, y: 1, z: 0 });
  const hit = world.castRay(ray, max, true);
  if (!hit) return null;
  const toi = hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
  return y0 + toi;
}

// ═══ AUDIT ═══

async function main() {
  await RAPIER.init();
  const { probe, meshes } = await buildWorld();
  const { world: visWorld, tris: visTris } = await buildVisStandingWorld();
  const { world: fanWorld, tris: fanTris } = await buildFanWorld();

  // ── Rule 1: downward hole sweep ──
  const holes = [];
  const sweep1 = [];
  for (const x of range(-COURT_X, COURT_X, GRID_STEP)) {
    for (const z of range(-COURT_Z, COURT_Z, GRID_STEP)) sweep1.push([x, z]);
  }
  // dense corner platforms (all four quadrants)
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    for (const x of range(CORNER_X_MIN, CORNER_X_MAX, CORNER_STEP)) {
      for (const z of range(CORNER_Z_MIN, CORNER_Z_MAX, CORNER_STEP)) {
        sweep1.push([sx * x, sz * z]);
      }
    }
  }

  for (const [x, z] of sweep1) {
    const y = surfaceY(probe, x, z);
    if (y === null || y < KILL_FLOOR_Y) holes.push({ x, z, y });
  }

  // ── Rule 2: visual walkable coverage ──
  const uncovered = [];
  let visPoints = 0;
  let worstGap = 0;
  let worstPoint = null;
  for (const x of range(-COURT_X, COURT_X, GRID_STEP)) {
    for (const z of range(-COURT_Z, COURT_Z, GRID_STEP)) {
      const visY = castDown(visWorld, x, 80, z, 200);
      if (visY === null) continue;
      visPoints++;
      const below = castDown(probe, x, visY + 0.3, z, BACKING_SEARCH_M);
      const above = castUp(probe, x, visY - 0.3, z, BACKING_SEARCH_M);
      let gap = Infinity;
      if (below !== null) gap = Math.min(gap, visY - below);
      if (above !== null) gap = Math.min(gap, above - visY);
      if (gap > worstGap) {
        worstGap = gap;
        worstPoint = { x, z, visY, below, above, gap };
      }
      if (gap > BACKING_TOLERANCE_M) {
        uncovered.push({ x, z, visY: +visY.toFixed(3), below, above, gapM: gap === Infinity ? null : +gap.toFixed(3) });
      }
    }
  }

  // ── Rule 3: corner fan certification ──
  const winding = cornerCapWinding(meshes);
  const capRest = cornerCapRestCheck(probe, fanWorld);
  const capFailures = [...winding.failures, ...capRest.failures];

  const passes = holes.length === 0 && uncovered.length === 0 && capFailures.length === 0;

  // ── report ──
  const report = {
    pass: passes,
    arena: 'public/models/arena.glb',
    killFloorY: KILL_FLOOR_Y,
    backingToleranceM: BACKING_TOLERANCE_M,
    rule1DownwardHoles: {
      pass: holes.length === 0,
      samples: sweep1.length,
      holes: holes.length,
      worst: holes.slice(0, 16),
    },
    rule2VisCoverage: {
      pass: uncovered.length === 0,
      visStandingTris: visTris,
      visSamplePoints: visPoints,
      uncovered: uncovered.length,
      worstGapM: worstGap === Infinity ? null : +worstGap.toFixed(3),
      worstPoint,
      samples: uncovered.slice(0, 16),
    },
    rule3CornerFans: {
      pass: capFailures.length === 0,
      fanTris,
      winding: {
        upPerQuadrant: winding.upPerQuadrant,
        downFacing: winding.downFacing,
        verticalInBand: winding.verticalInBand,
      },
      restChecks: {
        sampled: capRest.checked,
        failures: capRest.failures.length,
      },
      failures: capFailures.slice(0, 32),
    },
  };

  const outPath = path.join(ROOT, 'audit_collision_coverage_report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`court-footprint hole sweep: ${sweep1.length} rays, ${holes.length} holes`);
  console.log(`visual-walkable coverage: ${visPoints} points, ${uncovered.length} uncovered, worst gap ${worstGap === Infinity ? 'inf' : worstGap.toFixed(3)} m`);
  console.log(`corner-fan certification: ${fanTris} fan tris, ${capRest.checked} rest checks, ${winding.downFacing} down-facing, ${winding.verticalInBand} vertical-in-band, ${capFailures.length} failures`);
  console.log(passes ? 'AUDIT PASS — coverage holds' : 'AUDIT FAIL — see report');
  console.log(`report: ${outPath}`);

  probe.free();
  visWorld.free();
  fanWorld.free();
  process.exitCode = passes ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});