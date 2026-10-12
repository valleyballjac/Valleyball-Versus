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
 * Exit contract: exit code 0 when the court passes both rules, 1 otherwise.
 * Writes audit_collision_coverage_report.json next to the package root.
 *
 * Run: npm run audit:coverage
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { toTrimeshArrays } from '../src/sim/arena.js';
import { buildWorld, surfaceY } from './test_ball_roll.mjs';

// ═══ CONSTANTS ═══

/** Out-of-bounds kill plane (references/court_spec.md). Anything at or below
 * this is the void, not "above floor level". */
const KILL_FLOOR_Y = -5.0;

/** Vertical tolerance (m) for Rule 2: a VIS surface is "backed" if a COL
 * collider sits within this distance below or above it. Calibrated against the
 * fixed arena, where the corner purple wedge legitimately spans a ~2 m gap
 * between the ~11 m court rim (below) and the 13 m glass-bottom cap (above). */
const BACKING_TOLERANCE_M = 2.5;

/** Ray search depth (m) for the backing test on each side of a VIS surface. */
const BACKING_SEARCH_M = 3.0;

/** Full-court sweep spacing (m). */
const GRID_STEP = 1.0;

/** Dense corner-platform sweep spacing (m). */
const CORNER_STEP = 0.5;

/** Corner-platform footprint: a single quadrant (mirrored across all four). */
const CORNER_X_MIN = 15.0;
const CORNER_X_MAX = 24.0;
const CORNER_Z_MIN = 45.0;
const CORNER_Z_MAX = 59.0;

/** Court footprint extent. */
const COURT_X = 24.0;
const COURT_Z = 58.0;

/** VIS meshes that represent standing/walkable terrain (horizontal surfaces a
 * ball or player would stand on), as distinct from the vertical glass walls
 * (VIS_Back_Boundary, VIS_Lower_Side_Wall, VIS_Upper_*) whose perimeter
 * integrity is certified by scripts/test_ball_roll.mjs entrapment scenarios. */
const STANDING_VIS = /^VIS_(Corner_|Inner_Field_|Outer_Field_|Stream_|SM_Goal_)/;

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

/** Build a static raycast world from the VIS standing meshes so their
 * world-space surfaces can be sampled by the same raycast helper. */
async function buildVisStandingWorld() {
  const modelPath = path.join(ROOT, 'public', 'models', 'arena.glb');
  const glb = fs.readFileSync(modelPath);
  const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
  gltf.scene.updateMatrixWorld(true);

  const world = new RAPIER.World({ x: 0, y: -12, z: 0 });
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  let tris = 0;
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !STANDING_VIS.test(o.name)) return;
    const geom = o.geometry.clone();
    geom.applyMatrix4(o.matrixWorld);
    const { vertices, indices } = toTrimeshArrays(geom, { filterInverted: false });
    geom.dispose();
    if (!indices.length) return;
    tris += indices.length / 3;
    world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices), body);
  });
  world.step();
  return { world, tris };
}

// ═══ AUDIT ═══

async function main() {
  await RAPIER.init();
  const { probe } = await buildWorld();
  const { world: visWorld, tris: visTris } = await buildVisStandingWorld();

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

  const passes = holes.length === 0 && uncovered.length === 0;

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
  };

  const outPath = path.join(ROOT, 'audit_collision_coverage_report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`court-footprint hole sweep: ${sweep1.length} rays, ${holes.length} holes`);
  console.log(`visual-walkable coverage: ${visPoints} points, ${uncovered.length} uncovered, worst gap ${worstGap === Infinity ? 'inf' : worstGap.toFixed(3)} m`);
  console.log(passes ? 'AUDIT PASS — coverage holds' : 'AUDIT FAIL — see report');
  console.log(`report: ${outPath}`);

  probe.free();
  visWorld.free();
  process.exitCode = passes ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});