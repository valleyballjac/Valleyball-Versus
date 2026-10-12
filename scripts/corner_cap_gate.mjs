/**
 * CORNER FAN GATE — shared verification + mutation for the sloped corner
 * fans of the Valley Court (the colliders backing the purple VIS_Corner
 * wedges).
 *
 * History: the v0.3.2 corner fall-through bug came from the corner surface
 * being missing or wound downward. The v10.8 fix over-corrected with a
 * vertical curtain + flat 13 m shelf; v10.11 (commit d306df6) restored the
 * original v10.7 geometry: a SLOPED RADIAL FAN per corner. This gate asserts
 * that sloped geometry. A downward-wound or missing fan reads as a hole or an
 * invisible wall: Rapier trimeshes are one-sided for raycasts, so an entity
 * crossing the ~11 m terrain rim either falls through or is stopped dead.
 *
 * Geometry (measured, arena v10.11 / COL_Barriers, 900 tris):
 *   - COL_Court is the terrain only; its rim tops out at ~10.96 m.
 *   - COL_Barriers carries four corner fans, 16 up-facing triangles each:
 *     every fan triangle has two rim vertices at y = 11.00 and shares the
 *     apex vertex at y = 13.00 at the outer corner (|x| = 25, |z| = 60), so
 *     every centroid sits at exactly y = 11.67 with ny in [0.48, 0.98].
 *     Fan footprint: |x| <= 25, |z| in [37.5, 60].
 *   - VIS_Corner_* is render-only (flat y = 11.67); the fan is the walkable
 *     surface, rising continuously from the rim to the apex. There is no
 *     flat cap and no vertical curtain.
 *
 * This module exposes (a) the fan-triangle predicate and quadrant naming,
 * (b) a mutation that removes or inverts a quadrant's fan for the
 * negative-control harness, (c) a fan-only raycast world built from the
 * PRISTINE arena.glb (so mutants still have an expected surface to fail
 * against) plus the VIS standing-surface world for coverage audits, and
 * (d) the certification checks the audit and drop gates share: winding
 * (16-ish up-facing sloped tris per quadrant, rim-to-apex span, nothing
 * inverted or vertical in the fan band) and rest height (the topmost solid
 * surface under every fan point must BE the fan surface, within tolerance:
 * not the ~10.5 m rim below it, not a phantom obstruction above it).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toTrimeshArrays } from '../src/sim/arena.js';

// ═══ FAN GEOMETRY CONSTANTS (measured, arena v10.11) ═══

/** Fan triangles have centroid y exactly (11 + 11 + 13) / 3 = 11.67. The
 * band excludes the sill skirts (centroid <= 10.92), the wall-top landing at
 * 12.33, and anything else sharing the corner footprint. */
export const FAN_CENTROID_MIN_Y = 11.5;
export const FAN_CENTROID_MAX_Y = 11.85;

/** Fan triangle vertex span: rim vertices at y = 11.00, apex at y = 13.00.
 * A candidate outside this span is not a rim-to-apex slope triangle. */
export const FAN_VERT_MIN_Y = 10.9;
export const FAN_VERT_MAX_Y = 13.1;

/** A genuine fan triangle must touch the rim (a vertex at <= FAN_RIM_MAX_Y)
 * and reach the apex (a vertex at >= FAN_APEX_MIN_Y): the slope must be
 * continuous from the 11 m rim to the 13 m corner, with no step. */
export const FAN_RIM_MAX_Y = 11.2;
export const FAN_APEX_MIN_Y = 12.8;

/** Minimum upward normal component for a fan triangle. Measured range is
 * 0.48..0.98 (steepest at the arc ends). Anything with |ny| <= 0.4 inside
 * the fan band is a vertical face: a resurrected curtain, which is exactly
 * the invisible wall this gate must reject. */
export const FAN_MIN_NY = 0.4;

/** v10.7/v10.11 carry exactly 16 fan triangles per quadrant. The gate
 * demands at least this many so a legitimate re-mesh (denser fan) passes
 * while a stripped or partial fan fails. */
export const FAN_MIN_TRIS_PER_QUADRANT = 12;
export const FAN_TRIS_PER_QUADRANT = 16;

/** Fan footprint (single quadrant, mirrored). Inset from the glass walls so
 * downward rays never clip the wall tops at |x| = 25 / |z| = 60. */
export const FAN_X_MIN = 1.0;
export const FAN_X_MAX = 24.5;
export const FAN_Z_MIN = 38.0;
export const FAN_Z_MAX = 59.5;

/** Centroid |z| at or beyond which a COL_Barriers triangle is inside a
 * corner region (the raw fan bbox starts at |z| = 37.5). */
export const FAN_REGION_Z = 37.0;

/** Rest-check tolerances (m). The topmost solid surface under a fan point
 * must match the fan surface: below it by more than REST_BELOW_TOL means the
 * fan is gone (entity rests on the ~10.5 m rim = fall-through class); above
 * it by more than REST_ABOVE_TOL means a phantom obstruction covers the fan. */
export const REST_BELOW_TOL = 0.25;
export const REST_ABOVE_TOL = 0.6;

/** VIS meshes that represent standing/walkable terrain (horizontal surfaces a
 * ball or player would stand on), as distinct from the vertical glass walls. */
const STANDING_VIS = /^VIS_(Corner_|Inner_Field_|Outer_Field_|Stream_|SM_Goal_)/;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ═══ TRIANGLE MATH ═══

const _edgeAB = { x: 0, y: 0, z: 0 };
const _edgeAC = { x: 0, y: 0, z: 0 };

/** Normalised surfacing normal Y for triangle (a, b, c); +1 = upward winding,
 * -1 = downward (inverted) winding, 0 = vertical face. */
function upwardComponent(ax, ay, az, bx, by, bz, cx, cy, cz) {
  _edgeAB.x = bx - ax; _edgeAB.y = by - ay; _edgeAB.z = bz - az;
  _edgeAC.x = cx - ax; _edgeAC.y = cy - ay; _edgeAC.z = cz - az;
  const nx = _edgeAB.y * _edgeAC.z - _edgeAB.z * _edgeAC.y;
  const ny = _edgeAB.z * _edgeAC.x - _edgeAB.x * _edgeAC.z;
  const nz = _edgeAB.x * _edgeAC.y - _edgeAB.y * _edgeAC.x;
  const len = Math.hypot(nx, ny, nz);
  return len === 0 ? 0 : ny / len;
}

/** Quadrant label from a fan triangle centroid. Compass naming, N = -z (the
 * hoops are at z = -40 = North): NE = +x,-z, SE = +x,+z, NW = -x,-z,
 * SW = -x,+z. */
export function capQuadrantOf(avgX, avgZ) {
  const ns = avgZ >= 0 ? 'S' : 'N';
  const ew = avgX >= 0 ? 'E' : 'W';
  return ns + ew;
}

/** Per-triangle measurements used by every fan predicate. */
function triStats(vertices, i, j, k) {
  const ax = vertices[i * 3], ay = vertices[i * 3 + 1], az = vertices[i * 3 + 2];
  const bx = vertices[j * 3], by = vertices[j * 3 + 1], bz = vertices[j * 3 + 2];
  const cx = vertices[k * 3], cy = vertices[k * 3 + 1], cz = vertices[k * 3 + 2];
  return {
    avgX: (ax + bx + cx) / 3,
    avgY: (ay + by + cy) / 3,
    avgZ: (az + bz + cz) / 3,
    minY: Math.min(ay, by, cy),
    maxY: Math.max(ay, by, cy),
    ny: upwardComponent(ax, ay, az, bx, by, bz, cx, cy, cz),
  };
}

/** Is this a corner-fan candidate triangle (footprint + centroid band +
 * rim-to-apex vertex span), regardless of winding? */
function inFanBand(avgX, avgY, avgZ, minY, maxY) {
  if (Math.abs(avgZ) < FAN_REGION_Z) return false;
  if (Math.abs(avgX) > 25.5) return false;
  if (avgY < FAN_CENTROID_MIN_Y || avgY > FAN_CENTROID_MAX_Y) return false;
  if (minY < FAN_VERT_MIN_Y || maxY > FAN_VERT_MAX_Y) return false;
  return true;
}

/** Is triangle an up-facing fan tile in the target quadrant (the predicate
 * mutateCap removes or inverts)? */
function isFanTriangle(avgX, avgY, avgZ, minY, maxY, ny, quadrant) {
  if (!inFanBand(avgX, avgY, avgZ, minY, maxY)) return false;
  if (ny <= FAN_MIN_NY) return false; // must be an up-facing slope tile
  return quadrant === 'all' || capQuadrantOf(avgX, avgZ) === quadrant;
}

// ═══ RAYCAST / WORLDS ═══

/** Downward surface Y at (x, z) in a world, from y0. Returns null on a miss. */
export function castDown(world, x, y0, z) {
  const ray = new RAPIER.Ray({ x, y: y0, z }, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(ray, 200, true);
  if (!hit) return null;
  const toi = hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
  return y0 - toi;
}

async function parseArenaGltf() {
  const modelPath = path.join(ROOT, 'public', 'models', 'arena.glb');
  const glb = fs.readFileSync(modelPath);
  const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
  gltf.scene.updateMatrixWorld(true);
  return gltf;
}

/** Build a static raycast world from the VIS standing meshes so their
 * world-space surfaces can be sampled by the same raycast helper (used by
 * the coverage audit's Rule 2). */
export async function buildVisStandingWorld() {
  const gltf = await parseArenaGltf();
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

/** Build a static raycast world containing ONLY the corner fan triangles,
 * extracted from the PRISTINE arena.glb on disk. Deliberately independent of
 * any mutated mesh arrays: this is the expected sloped surface that mutant
 * worlds (fan removed / inverted) are graded against, so a mutation can never
 * erase its own yardstick. */
export async function buildFanWorld() {
  const gltf = await parseArenaGltf();
  const world = new RAPIER.World({ x: 0, y: -12, z: 0 });
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  let tris = 0;
  gltf.scene.traverse((o) => {
    if (!o.isMesh || o.name !== 'COL_Barriers') return;
    const geom = o.geometry.clone();
    geom.applyMatrix4(o.matrixWorld);
    const { vertices, indices } = toTrimeshArrays(geom, { filterInverted: false });
    geom.dispose();
    const kept = [];
    for (let t = 0; t < indices.length; t += 3) {
      const i = indices[t], j = indices[t + 1], k = indices[t + 2];
      const s = triStats(vertices, i, j, k);
      if (isFanTriangle(s.avgX, s.avgY, s.avgZ, s.minY, s.maxY, s.ny, 'all')) kept.push(i, j, k);
    }
    if (!kept.length) return;
    tris += kept.length / 3;
    world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, Uint32Array.from(kept)), body);
  });
  world.step();
  return { world, tris };
}

/** Enumerate the fan-backed corner standing points across all four quadrants:
 * every footprint sample whose pristine fan surface exists. These are the
 * points a crossing athlete or rolling ball must find solid, sloped ground
 * on; the sample step defaults to 0.5 m. */
export function cornerCapStandingPoints(fanWorld, step = 0.5) {
  const points = [];
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      for (let x = FAN_X_MIN; x <= FAN_X_MAX + 1e-9; x += step) {
        for (let z = FAN_Z_MIN; z <= FAN_Z_MAX + 1e-9; z += step) {
          const px = sx * x;
          const pz = sz * z;
          const fanY = castDown(fanWorld, px, 80, pz);
          if (fanY !== null) points.push({ x: px, z: pz, fanY });
        }
      }
    }
  }
  return points;
}

// ═══ MUTATION (negative control) ═══

/**
 * Returns a copy of the extracted arena mesh arrays with a quadrant's corner
 * fan either removed (mode 'remove') or wound downward (mode 'invert'), so
 * the certification gates can be proven to REJECT a missing or inverted
 * sloped corner. `meshes` is the array returned by buildWorld; only
 * COL_Barriers is touched.
 *
 * @param {Array<{name,vertices,indices,isCourtSurface}>} meshes
 * @param {{mode:'remove'|'invert', quadrant:string}|null} mutate
 */
export function mutateCap(meshes, mutate) {
  if (!mutate) return meshes;
  const quadrant = mutate.quadrant || 'all';
  return meshes.map((m) => {
    if (m.name !== 'COL_Barriers') return m;
    const { vertices, indices } = m;
    const kept = [];
    for (let t = 0; t < indices.length; t += 3) {
      const i = indices[t], j = indices[t + 1], k = indices[t + 2];
      const s = triStats(vertices, i, j, k);
      if (isFanTriangle(s.avgX, s.avgY, s.avgZ, s.minY, s.maxY, s.ny, quadrant)) {
        if (mutate.mode === 'remove') continue;             // drop the fan tile
        if (mutate.mode === 'invert') { kept.push(i, k, j); continue } // flip winding
      }
      kept.push(i, j, k);
    }
    return { ...m, indices: Uint32Array.from(kept) };
  });
}

// ═══ CERTIFICATION CHECKS ═══

/**
 * Winding/slope check on the extracted COL_Barriers triangles: each quadrant
 * must carry a full up-facing fan (>= FAN_MIN_TRIS_PER_QUADRANT triangles)
 * spanning rim (vertex <= 11.2 m) to apex (vertex >= 12.8 m), with nothing
 * inverted and nothing vertical inside the fan band (a vertical face there is
 * a resurrected curtain = invisible wall). Returns a failure list (empty =
 * pass).
 */
export function cornerCapWinding(meshes) {
  const failures = [];
  const upPerQuadrant = { NE: 0, NW: 0, SE: 0, SW: 0 };
  const apexPerQuadrant = { NE: false, NW: false, SE: false, SW: false };
  const rimPerQuadrant = { NE: false, NW: false, SE: false, SW: false };
  let downFacing = 0;
  let verticalInBand = 0;
  for (const m of meshes) {
    if (m.name !== 'COL_Barriers') continue;
    const { vertices, indices } = m;
    for (let t = 0; t < indices.length; t += 3) {
      const s = triStats(vertices, indices[t], indices[t + 1], indices[t + 2]);
      if (!inFanBand(s.avgX, s.avgY, s.avgZ, s.minY, s.maxY)) continue;
      const q = capQuadrantOf(s.avgX, s.avgZ);
      if (s.ny < -FAN_MIN_NY) {
        downFacing++;
        if (downFacing <= 8) {
          failures.push({ kind: 'inverted-fan', quadrant: q, x: +s.avgX.toFixed(2), z: +s.avgZ.toFixed(2), ny: +s.ny.toFixed(2) });
        }
      } else if (s.ny > FAN_MIN_NY) {
        upPerQuadrant[q]++;
        if (s.maxY >= FAN_APEX_MIN_Y) apexPerQuadrant[q] = true;
        if (s.minY <= FAN_RIM_MAX_Y) rimPerQuadrant[q] = true;
      } else {
        verticalInBand++;
        if (verticalInBand <= 8) {
          failures.push({ kind: 'vertical-in-fan-band', quadrant: q, x: +s.avgX.toFixed(2), z: +s.avgZ.toFixed(2), ny: +s.ny.toFixed(2) });
        }
      }
    }
  }
  for (const q of ['NE', 'NW', 'SE', 'SW']) {
    if (upPerQuadrant[q] < FAN_MIN_TRIS_PER_QUADRANT) {
      failures.push({ kind: 'missing-fan', quadrant: q, upTiles: upPerQuadrant[q], minRequired: FAN_MIN_TRIS_PER_QUADRANT });
    }
    if (upPerQuadrant[q] > 0 && !apexPerQuadrant[q]) {
      failures.push({ kind: 'fan-never-reaches-apex', quadrant: q });
    }
    if (upPerQuadrant[q] > 0 && !rimPerQuadrant[q]) {
      failures.push({ kind: 'fan-never-touches-rim', quadrant: q });
    }
  }
  return { failures, upPerQuadrant, downFacing, verticalInBand };
}

/**
 * Rest-height check on the sloped fan: under every pristine fan point the
 * topmost solid surface of the terrain world must BE the fan surface
 * (within REST_BELOW_TOL / REST_ABOVE_TOL). A missing fan returns the ~10.5 m
 * court rim below (fall-through class); a phantom cap or curtain returns a
 * surface above. `fanWorld` is the pristine fan-only world (buildFanWorld);
 * `probe` is the terrain world under test.
 */
export function cornerCapRestCheck(probe, fanWorld, step = 0.5) {
  const failures = [];
  const standing = cornerCapStandingPoints(fanWorld, step);
  for (const { x, z, fanY } of standing) {
    const surfY = castDown(probe, x, 80, z);
    if (surfY === null) {
      failures.push({ kind: 'hole-under-fan', x: +x.toFixed(2), z: +z.toFixed(2), fanY: +fanY.toFixed(2), surfaceY: null });
    } else if (surfY < fanY - REST_BELOW_TOL) {
      failures.push({ kind: 'surface-below-fan', x: +x.toFixed(2), z: +z.toFixed(2), fanY: +fanY.toFixed(2), surfaceY: +surfY.toFixed(2) });
    } else if (surfY > fanY + REST_ABOVE_TOL) {
      failures.push({ kind: 'obstruction-above-fan', x: +x.toFixed(2), z: +z.toFixed(2), fanY: +fanY.toFixed(2), surfaceY: +surfY.toFixed(2) });
    }
  }
  return { failures, checked: standing.length, step };
}
