import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { TUNING } from '../config/tuning.js';
import {
  RAPIER,
  getWorld,
  ENVIRONMENT_GROUPS,
  ENVIRONMENT_ATHLETE_GROUPS,
  ENVIRONMENT_BALL_GROUPS,
} from './physics.js';
import { mergeStaticGroupByMaterial, mergeLineSegmentsList } from './meshBatcher.js';

/**
 * MODULE HEADER — src/sim/arena.js
 *
 * Role: Loads the authored Valleyball court GLB (`loadCourtArena`, `createArena`),
 *   normalizes court/barrier materials, extracts non-degenerate triangle meshes
 *   (`toTrimeshArrays`), builds static Rapier trimesh colliders in deterministic
 *   order, and maps collider handles to semantic surface types (`getArenaColliderType`).
 * Frame Phase: Boot / initialization only (`createArena`).
 * Active Architectural Laws:
 *   - DERIVATION FROM VISUALS: Every court collider is derived from the authored
 *     mesh geometry baked through its world transform.
 *   - LAW 6 (Determinism): Collider creation order is deterministic and independent
 *     of debug visualization flags (`?showColliders=1`).
 */
const arenaColliderTypes = new Map();

/**
 * DEBUG: ?showColliders=1 renders the authored collision proxies as colored
 * wireframes instead of hiding them, so the terrain hand-off can be eyeballed
 * against the visual mesh. Boundary=cyan, court=green, goal=orange. Off by
 * default and never active headless, so determinism (LAW 6) is untouched.
 */
function wantColliderWireframes() {
  if (typeof location === 'undefined' || !location.search) return false;
  return /(?:^|[?&])showColliders=1(?:&|$)/.test(location.search);
}
const SHOW_COLLIDERS = wantColliderWireframes();

function colliderDebugColor(owner) {
  if (owner.includes('Barrier') || owner.includes('Boundary')) return 0x00ffff; // cyan
  if (owner.includes('Goal') || owner.includes('Hoop')) return 0xffa500; // orange
  return 0x00ff00; // green — court / anything else
}

/**
 * Returns the semantic surface type of an arena collider ('court', 'boundary', 'goal')
 * @param {number} handle Rapier collider handle
 * @returns {'court'|'boundary'|'goal'|null}
 */
export function getArenaColliderType(handle) {
  return arenaColliderTypes.get(handle) || null;
}



/**
 * Twice the area below which a triangle is treated as having no surface at all.
 *
 * Structural, not tunable — it separates "is a triangle" from "is three points
 * that happen to be collinear", which is a property of floating point, not of
 * how the game feels. It sits here with SOLVER_ITERATIONS and MIN_ANGULAR_SPEED
 * rather than in TUNING for the same reason those do: a slider on it could only
 * ever break the collider.
 */
const DEGENERATE_CROSS_LENGTH = 1e-10;

const _triA = new THREE.Vector3();
const _triB = new THREE.Vector3();
const _triC = new THREE.Vector3();
const _edgeAB = new THREE.Vector3();
const _edgeAC = new THREE.Vector3();

/**
 * Extracts the vertex and index arrays a Rapier trimesh wants, filtering out
 * zero-area degenerate triangles and (when `options.filterInverted` is set)
 * downward-facing floor triangles before Rapier builds its BVH.
 *
 * Zero-area triangles have no well-defined normal and produce contradictory
 * contact planes in Rapier's solver; filtering them in JS before Rapier sees
 * the index buffer keeps ball and motor rolling contacts clean without using
 * `FIX_INTERNAL_EDGES` (which merges vertices and breaks collision).
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {{ filterInverted?: boolean, maxInvertedY?: number }} [options]
 * @returns {{ vertices: Float32Array, indices: Uint32Array, degenerateCount: number, invertedCount: number }}
 */
export function toTrimeshArrays(geometry, options = {}) {
  const position = geometry.getAttribute('position');
  const vertices =
    position.array instanceof Float32Array
      ? position.array
      : Float32Array.from(position.array);

  let source;
  if (geometry.index) {
    source =
      geometry.index.array instanceof Uint32Array
        ? geometry.index.array
        : Uint32Array.from(geometry.index.array);
  } else {
    source = new Uint32Array(position.count);
    for (let i = 0; i < source.length; i++) source[i] = i;
  }

  // Keep only triangles that enclose actual area. |AB x AC| is twice the area,
  // and the comparison is written so that a NaN coordinate fails the test and
  // the triangle is dropped, rather than passing it to the solver.
  const filterInverted = options.filterInverted ?? false;
  const maxInvertedY = options.maxInvertedY ?? 4.0;

  const kept = [];
  let degenerateCount = 0;
  let invertedCount = 0;

  for (let t = 0; t < source.length; t += 3) {
    const i = source[t];
    const j = source[t + 1];
    const k = source[t + 2];

    _triA.fromArray(vertices, i * 3);
    _triB.fromArray(vertices, j * 3);
    _triC.fromArray(vertices, k * 3);

    _edgeAB.subVectors(_triB, _triA);
    _edgeAC.subVectors(_triC, _triA);

    const cross = _edgeAB.cross(_edgeAC);
    const len = cross.length();

    if (len <= DEGENERATE_CROSS_LENGTH) {
      degenerateCount++;
      continue;
    }

    // Inverted floor triangles (faces with downward normal on playing floor)
    // from mirrored instances or inverted face winding in Blender.
    if (filterInverted) {
      const ny = cross.y / len;
      const midY = (_triA.y + _triB.y + _triC.y) / 3;
      if (ny < -0.1 && midY < maxInvertedY) {
        invertedCount++;
        continue;
      }
    }

    kept.push(i, j, k);
  }

  const indices = Uint32Array.from(kept);

  return {
    vertices,
    indices,
    degenerateCount,
    invertedCount,
  };
}

/**
 * Prime uniform grid dimensions for the clean manifold `COL_Court` trimesh.
 * Replaces the 60,744-triangle organic glTF terrain (19,145 micro-slivers) AND
 * avoids Rapier 0.19.3's HeightField missing swept-CCD bug (which allowed small
 * balls and fast capsules to tunnel through the floor). Prime counts keep exact
 * 0.5 m / 1.0 m coordinates off grid seams while yielding ~20k clean, zero-sliver
 * welded triangles with full swept-CCD support.
 */
const COURT_HEIGHTFIELD_ROWS = 479; // Z axis (-60..+60, ~0.25 m O(1) athlete/ray floor)
const COURT_HEIGHTFIELD_COLS = 199; // X axis (-25..+25, ~0.25 m O(1) athlete/ray floor)
const COURT_TRIMESH_ROWS = 163;     // Z axis (-60..+60, ~0.74 m swept-CCD ball floor)
const COURT_TRIMESH_COLS = 67;      // X axis (-25..+25, ~0.75 m swept-CCD ball floor)
const COURT_RIM_COLLAR_MAX_Y = 10.95; // Below the 11.00..13.00 m COL_Barriers corner fan
const COURT_EXTERIOR_VOID_Y = -90.0;  // Strictly finite & below KILL_FLOOR_Y (-5 m)

/**
 * Invisible upper stadium containment above the y = 38.0 m top of `COL_Barriers`.
 * Walls align flush with the outer vertical glass faces (|x| = 30.0, |z| = 65.0)
 * from y = 37.5 to y = 96.5 m, capped by a sky lid at y = 95.0 m (strictly above
 * the y = 80.0 m downward audit ray origin and strictly outside the ±25/±60 court).
 */
const UPPER_WALL_OUTER_X = 30.0;
const UPPER_WALL_OUTER_Z = 65.0;
const UPPER_WALL_MIN_Y = 37.5;
const UPPER_WALL_MAX_Y = 96.5;
const UPPER_WALL_HALF_T = 0.5;
const UPPER_CEILING_Y = 95.0;
const UPPER_CEILING_HALF_H = 1.0;

// High-resolution 0.25 m visual terrain elevation grid built directly from all
// rendered floor/turf/circle/corner meshes at arena load time. Used by diegetic
// ground guides (`ballDropRing`) so rings conform tightly to 100% of the visual
// stadium surface (including outer grassy slopes, scoring circles, and 13 m corner
// ramps) with ~1 cm worst-case error and zero raycasts.
const VIS_GRID_NX = 200; // 0.25 m step over [-25, 25]
const VIS_GRID_NZ = 480; // 0.25 m step over [-60, 60]
const VIS_MIN_X = -25.0;
const VIS_MAX_X = 25.0;
const VIS_MIN_Z = -60.0;
const VIS_MAX_Z = 60.0;
const VIS_INV_DX = VIS_GRID_NX / (VIS_MAX_X - VIS_MIN_X);
const VIS_INV_DZ = VIS_GRID_NZ / (VIS_MAX_Z - VIS_MIN_Z);
const VIS_DX = (VIS_MAX_X - VIS_MIN_X) / VIS_GRID_NX;
const VIS_DZ = (VIS_MAX_Z - VIS_MIN_Z) / VIS_GRID_NZ;
const VIS_STRIDE = VIS_GRID_NX + 1;

let visualTerrainGrid = null;

function isVisualFloorMesh(owner, meshName, isGlassMesh) {
  if (isGlassMesh) return false;
  const a = owner || '';
  const b = meshName || '';
  if (a.startsWith('COL') || b.startsWith('COL')) return false;
  for (const token of ['Boundary', 'Barrier', 'Side Wall', 'Side_Wall', 'Upper', 'Goal', 'Hoop']) {
    if (a.includes(token) || b.includes(token)) return false;
  }
  return true;
}

function rasterizeMeshIntoVisualGrid(grid, geometry, matrixWorld) {
  const posAttr = geometry?.getAttribute?.('position');
  if (!posAttr || posAttr.count < 3) return;

  const indexAttr = geometry.index;
  const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3);
  const idxArr = indexAttr ? indexAttr.array : null;

  for (let t = 0; t < triCount; t++) {
    const i0 = idxArr ? idxArr[t * 3] : t * 3;
    const i1 = idxArr ? idxArr[t * 3 + 1] : t * 3 + 1;
    const i2 = idxArr ? idxArr[t * 3 + 2] : t * 3 + 2;

    _triA.fromBufferAttribute(posAttr, i0).applyMatrix4(matrixWorld);
    _triB.fromBufferAttribute(posAttr, i1).applyMatrix4(matrixWorld);
    _triC.fromBufferAttribute(posAttr, i2).applyMatrix4(matrixWorld);

    const ax = _triA.x;
    const ay = _triA.y;
    const az = _triA.z;
    const bx = _triB.x;
    const by = _triB.y;
    const bz = _triB.z;
    const cx = _triC.x;
    const cy = _triC.y;
    const cz = _triC.z;

    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-10) continue;
    const invDet = 1 / det;

    const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - VIS_MIN_X) * VIS_INV_DX));
    const x1 = Math.min(VIS_GRID_NX, Math.ceil((Math.max(ax, bx, cx) - VIS_MIN_X) * VIS_INV_DX));
    const z0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - VIS_MIN_Z) * VIS_INV_DZ));
    const z1 = Math.min(VIS_GRID_NZ, Math.ceil((Math.max(az, bz, cz) - VIS_MIN_Z) * VIS_INV_DZ));

    for (let iz = z0; iz <= z1; iz++) {
      const gz = VIS_MIN_Z + iz * VIS_DZ;
      const row = iz * VIS_STRIDE;
      for (let ix = x0; ix <= x1; ix++) {
        const gx = VIS_MIN_X + ix * VIS_DX;
        const w1 = ((bz - cz) * (gx - cx) + (cx - bx) * (gz - cz)) * invDet;
        const w2 = ((cz - az) * (gx - cx) + (ax - cx) * (gz - cz)) * invDet;
        const w3 = 1 - w1 - w2;
        if (w1 >= -1e-4 && w2 >= -1e-4 && w3 >= -1e-4) {
          const y = w1 * ay + w2 * by + w3 * cy;
          if (y > grid[row + ix]) grid[row + ix] = y;
        }
      }
    }
  }
}

function finalizeVisualGrid(grid) {
  let remaining = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === -Infinity) remaining++;
  }
  for (let pass = 0; pass < 4 && remaining > 0; pass++) {
    const snap = new Float32Array(grid);
    remaining = 0;
    for (let iz = 0; iz <= VIS_GRID_NZ; iz++) {
      const row = iz * VIS_STRIDE;
      for (let ix = 0; ix <= VIS_GRID_NX; ix++) {
        const idx = row + ix;
        if (snap[idx] > -Infinity) continue;
        let sum = 0;
        let cnt = 0;
        for (let dz = -1; dz <= 1; dz++) {
          const nz = iz + dz;
          if (nz < 0 || nz > VIS_GRID_NZ) continue;
          const nrow = nz * VIS_STRIDE;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = ix + dx;
            if (nx < 0 || nx > VIS_GRID_NX) continue;
            const v = snap[nrow + nx];
            if (v > -Infinity) {
              sum += v;
              cnt++;
            }
          }
        }
        if (cnt > 0) grid[idx] = sum / cnt;
        else remaining++;
      }
    }
  }
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === -Infinity) grid[i] = 0;
  }
  return grid;
}

/**
 * Samples the exact rendered visual terrain surface height Y (meters) at `(x, z)`
 * across the entire 50 m × 120 m stadium (inner field, grassy outer walls,
 * scoring circles, pick mounds, stream beds, and 13 m corner ramps).
 *
 * Uses C²-continuous uniform cubic B-spline interpolation over the 0.25 m visual
 * terrain grid (zero heap allocations, zero cell-boundary sawtooth ripples) so
 * surface-projected halos wrap smoothly over steep curved upper embankments.
 * Returns `null` before `loadCourtArena` has completed (e.g., headless unit tests).
 *
 * @param {number} x
 * @param {number} z
 * @returns {number|null}
 */
export function getVisualTerrainY(x, z) {
  if (!visualTerrainGrid) return null;
  const fxRaw = Math.max(0, Math.min(VIS_GRID_NX, (x - VIS_MIN_X) * VIS_INV_DX));
  const fzRaw = Math.max(0, Math.min(VIS_GRID_NZ, (z - VIS_MIN_Z) * VIS_INV_DZ));
  const ix1 = Math.min(VIS_GRID_NX - 1, Math.floor(fxRaw));
  const iz1 = Math.min(VIS_GRID_NZ - 1, Math.floor(fzRaw));
  const tx = fxRaw - ix1;
  const tz = fzRaw - iz1;

  // Uniform cubic B-spline basis weights (strictly non-negative, sum = 1, C² smooth)
  const tx2 = tx * tx;
  const tx3 = tx2 * tx;
  const omtX = 1 - tx;
  const wx0 = (omtX * omtX * omtX) * (1 / 6);
  const wx1 = (3 * tx3 - 6 * tx2 + 4) * (1 / 6);
  const wx2 = (-3 * tx3 + 3 * tx2 + 3 * tx + 1) * (1 / 6);
  const wx3 = tx3 * (1 / 6);

  const tz2 = tz * tz;
  const tz3 = tz2 * tz;
  const omtZ = 1 - tz;
  const wz0 = (omtZ * omtZ * omtZ) * (1 / 6);
  const wz1 = (3 * tz3 - 6 * tz2 + 4) * (1 / 6);
  const wz2 = (-3 * tz3 + 3 * tz2 + 3 * tz + 1) * (1 / 6);
  const wz3 = tz3 * (1 / 6);

  const ix0 = ix1 > 0 ? ix1 - 1 : 0;
  const ix2 = ix1 + 1;
  const ix3 = ix1 + 2 <= VIS_GRID_NX ? ix1 + 2 : VIS_GRID_NX;

  const iz0 = iz1 > 0 ? iz1 - 1 : 0;
  const iz2 = iz1 + 1;
  const iz3 = iz1 + 2 <= VIS_GRID_NZ ? iz1 + 2 : VIS_GRID_NZ;

  const r0 = iz0 * VIS_STRIDE;
  const r1 = iz1 * VIS_STRIDE;
  const r2 = iz2 * VIS_STRIDE;
  const r3 = iz3 * VIS_STRIDE;

  const h0 = visualTerrainGrid[r0 + ix0] * wx0 + visualTerrainGrid[r0 + ix1] * wx1 + visualTerrainGrid[r0 + ix2] * wx2 + visualTerrainGrid[r0 + ix3] * wx3;
  const h1 = visualTerrainGrid[r1 + ix0] * wx0 + visualTerrainGrid[r1 + ix1] * wx1 + visualTerrainGrid[r1 + ix2] * wx2 + visualTerrainGrid[r1 + ix3] * wx3;
  const h2 = visualTerrainGrid[r2 + ix0] * wx0 + visualTerrainGrid[r2 + ix1] * wx1 + visualTerrainGrid[r2 + ix2] * wx2 + visualTerrainGrid[r2 + ix3] * wx3;
  const h3 = visualTerrainGrid[r3 + ix0] * wx0 + visualTerrainGrid[r3 + ix1] * wx1 + visualTerrainGrid[r3 + ix2] * wx2 + visualTerrainGrid[r3 + ix3] * wx3;

  return h0 * wz0 + h1 * wz1 + h2 * wz2 + h3 * wz3;
}

/**
 * Samples the C²-smooth visual terrain height Y and exact analytical unit surface
 * normal `(nx, ny, nz)` into a caller-supplied scratch object (zero heap allocations).
 * Returns `false` if `visualTerrainGrid` is not yet initialized.
 *
 * @param {number} x
 * @param {number} z
 * @param {{ y: number, nx: number, ny: number, nz: number }} out
 * @returns {boolean}
 */
export function getVisualTerrainSurface(x, z, out) {
  if (!visualTerrainGrid) return false;
  const fxRaw = Math.max(0, Math.min(VIS_GRID_NX, (x - VIS_MIN_X) * VIS_INV_DX));
  const fzRaw = Math.max(0, Math.min(VIS_GRID_NZ, (z - VIS_MIN_Z) * VIS_INV_DZ));
  const ix1 = Math.min(VIS_GRID_NX - 1, Math.floor(fxRaw));
  const iz1 = Math.min(VIS_GRID_NZ - 1, Math.floor(fzRaw));
  const tx = fxRaw - ix1;
  const tz = fzRaw - iz1;

  const tx2 = tx * tx;
  const tx3 = tx2 * tx;
  const omtX = 1 - tx;
  const wx0 = (omtX * omtX * omtX) * (1 / 6);
  const wx1 = (3 * tx3 - 6 * tx2 + 4) * (1 / 6);
  const wx2 = (-3 * tx3 + 3 * tx2 + 3 * tx + 1) * (1 / 6);
  const wx3 = tx3 * (1 / 6);

  // Exact derivatives of cubic B-spline basis (scaled by VIS_INV_DX = 1 / cellSize)
  const dwx0 = -0.5 * omtX * omtX * VIS_INV_DX;
  const dwx1 = (1.5 * tx2 - 2 * tx) * VIS_INV_DX;
  const dwx2 = (-1.5 * tx2 + tx + 0.5) * VIS_INV_DX;
  const dwx3 = 0.5 * tx2 * VIS_INV_DX;

  const tz2 = tz * tz;
  const tz3 = tz2 * tz;
  const omtZ = 1 - tz;
  const wz0 = (omtZ * omtZ * omtZ) * (1 / 6);
  const wz1 = (3 * tz3 - 6 * tz2 + 4) * (1 / 6);
  const wz2 = (-3 * tz3 + 3 * tz2 + 3 * tz + 1) * (1 / 6);
  const wz3 = tz3 * (1 / 6);

  const dwz0 = -0.5 * omtZ * omtZ * VIS_INV_DZ;
  const dwz1 = (1.5 * tz2 - 2 * tz) * VIS_INV_DZ;
  const dwz2 = (-1.5 * tz2 + tz + 0.5) * VIS_INV_DZ;
  const dwz3 = 0.5 * tz2 * VIS_INV_DZ;

  const ix0 = ix1 > 0 ? ix1 - 1 : 0;
  const ix2 = ix1 + 1;
  const ix3 = ix1 + 2 <= VIS_GRID_NX ? ix1 + 2 : VIS_GRID_NX;

  const iz0 = iz1 > 0 ? iz1 - 1 : 0;
  const iz2 = iz1 + 1;
  const iz3 = iz1 + 2 <= VIS_GRID_NZ ? iz1 + 2 : VIS_GRID_NZ;

  const r0 = iz0 * VIS_STRIDE;
  const r1 = iz1 * VIS_STRIDE;
  const r2 = iz2 * VIS_STRIDE;
  const r3 = iz3 * VIS_STRIDE;

  const g00 = visualTerrainGrid[r0 + ix0], g01 = visualTerrainGrid[r0 + ix1], g02 = visualTerrainGrid[r0 + ix2], g03 = visualTerrainGrid[r0 + ix3];
  const g10 = visualTerrainGrid[r1 + ix0], g11 = visualTerrainGrid[r1 + ix1], g12 = visualTerrainGrid[r1 + ix2], g13 = visualTerrainGrid[r1 + ix3];
  const g20 = visualTerrainGrid[r2 + ix0], g21 = visualTerrainGrid[r2 + ix1], g22 = visualTerrainGrid[r2 + ix2], g23 = visualTerrainGrid[r2 + ix3];
  const g30 = visualTerrainGrid[r3 + ix0], g31 = visualTerrainGrid[r3 + ix1], g32 = visualTerrainGrid[r3 + ix2], g33 = visualTerrainGrid[r3 + ix3];

  const h0 = g00 * wx0 + g01 * wx1 + g02 * wx2 + g03 * wx3;
  const h1 = g10 * wx0 + g11 * wx1 + g12 * wx2 + g13 * wx3;
  const h2 = g20 * wx0 + g21 * wx1 + g22 * wx2 + g23 * wx3;
  const h3 = g30 * wx0 + g31 * wx1 + g32 * wx2 + g33 * wx3;

  const d0 = g00 * dwx0 + g01 * dwx1 + g02 * dwx2 + g03 * dwx3;
  const d1 = g10 * dwx0 + g11 * dwx1 + g12 * dwx2 + g13 * dwx3;
  const d2 = g20 * dwx0 + g21 * dwx1 + g22 * dwx2 + g23 * dwx3;
  const d3 = g30 * dwx0 + g31 * dwx1 + g32 * dwx2 + g33 * dwx3;

  const y = h0 * wz0 + h1 * wz1 + h2 * wz2 + h3 * wz3;
  const dhdx = d0 * wz0 + d1 * wz1 + d2 * wz2 + d3 * wz3;
  const dhdz = h0 * dwz0 + h1 * dwz1 + h2 * dwz2 + h3 * dwz3;

  const invLen = 1 / Math.hypot(-dhdx, 1, -dhdz);
  out.y = y;
  out.nx = -dhdx * invLen;
  out.ny = invLen;
  out.nz = -dhdz * invLen;
  return true;
}

/**
 * Deterministically resamples a single-sheet terrain mesh (`COL_Court`) onto a
 * clean, zero-sliver manifold trimesh via exact 2D XZ barycentric projection.
 *
 * Replaces the 60,744-triangle organic trimesh (19,145 micro-slivers and 788
 * non-manifold seams) while retaining full Rapier swept-CCD support for small
 * balls and fast ragdoll capsules (unlike Rapier 0.19.3 HeightField colliders).
 * Exterior corner pockets outside the 1-cell rim collar emit zero triangles so
 * corner-fan negative controls remain strictly enforced.
 *
 * @param {Float32Array} vertices
 * @param {Uint32Array} indices
 * @param {{ nrows?: number, ncols?: number }} [options]
 * @returns {{ vertices: Float32Array, indices: Uint32Array, nrows: number, ncols: number } | null}
 */
export function rasterizeCourtTrimesh(vertices, indices, options = {}) {
  if (!vertices || !indices || indices.length < 3000) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const z = vertices[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  if (!(spanX > 1 && spanZ > 1)) return null;

  const nrows = options.nrows ?? COURT_TRIMESH_ROWS;
  const ncols = options.ncols ?? COURT_TRIMESH_COLS;
  const stride = nrows + 1;
  const gridCount = (ncols + 1) * stride;
  const heights = new Float32Array(gridCount);
  heights.fill(-Infinity);

  const invDx = ncols / spanX;
  const invDz = nrows / spanZ;
  const dx = spanX / ncols;
  const dz = spanZ / nrows;

  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t] * 3;
    const ib = indices[t + 1] * 3;
    const ic = indices[t + 2] * 3;

    const ax = vertices[ia];
    const ay = vertices[ia + 1];
    const az = vertices[ia + 2];
    const bx = vertices[ib];
    const by = vertices[ib + 1];
    const bz = vertices[ib + 2];
    const cx = vertices[ic];
    const cy = vertices[ic + 1];
    const cz = vertices[ic + 2];

    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-10) continue;
    const invDet = 1 / det;

    const c0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) * invDx));
    const c1 = Math.min(ncols, Math.ceil((Math.max(ax, bx, cx) - minX) * invDx));
    const r0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) * invDz));
    const r1 = Math.min(nrows, Math.ceil((Math.max(az, bz, cz) - minZ) * invDz));

    for (let c = c0; c <= c1; c++) {
      const gx = minX + c * dx;
      const base = c * stride;
      for (let r = r0; r <= r1; r++) {
        const gz = minZ + r * dz;
        const w1 = ((bz - cz) * (gx - cx) + (cx - bx) * (gz - cz)) * invDet;
        const w2 = ((cz - az) * (gx - cx) + (ax - cx) * (gz - cz)) * invDet;
        const w3 = 1 - w1 - w2;
        if (w1 >= -1e-4 && w2 >= -1e-4 && w3 >= -1e-4) {
          const y = w1 * ay + w2 * by + w3 * cy;
          if (y > heights[base + r]) heights[base + r] = y;
        }
      }
    }
  }

  // Seal the 1-cell curved rim collar directly beneath the 11.00 m COL_Barriers
  // corner fan lip so balls transitioning onto the fan never see an open seam,
  // while emitting ZERO triangles in the exterior corner pockets.
  const filled = new Uint8Array(gridCount);
  for (let i = 0; i < gridCount; i++) {
    if (heights[i] > -Infinity) filled[i] = 1;
  }

  const valid = new Uint8Array(gridCount);
  let validCount = 0;
  for (let c = 0; c <= ncols; c++) {
    const base = c * stride;
    for (let r = 0; r <= nrows; r++) {
      const idx = base + r;
      if (filled[idx]) {
        valid[idx] = 1;
        validCount++;
        continue;
      }
      let minNeighbor = Infinity;
      for (let dc = -1; dc <= 1; dc++) {
        const nc = c + dc;
        if (nc < 0 || nc > ncols) continue;
        const nbase = nc * stride;
        for (let dr = -1; dr <= 1; dr++) {
          const nr = r + dr;
          if (nr < 0 || nr > nrows) continue;
          const nidx = nbase + nr;
          if (filled[nidx] && heights[nidx] < minNeighbor) {
            minNeighbor = heights[nidx];
          }
        }
      }
      if (minNeighbor < Infinity) {
        heights[idx] = Math.min(minNeighbor, COURT_RIM_COLLAR_MAX_Y);
        valid[idx] = 1;
        validCount++;
      }
    }
  }

  if (validCount < 3) return null;

  const indexMap = new Int32Array(gridCount);
  indexMap.fill(-1);
  const outVertices = new Float32Array(validCount * 3);
  let vCursor = 0;
  for (let c = 0; c <= ncols; c++) {
    const gx = minX + c * dx;
    const base = c * stride;
    for (let r = 0; r <= nrows; r++) {
      const idx = base + r;
      if (!valid[idx]) continue;
      indexMap[idx] = vCursor;
      const o = vCursor * 3;
      outVertices[o] = gx;
      outVertices[o + 1] = heights[idx];
      outVertices[o + 2] = minZ + r * dz;
      vCursor++;
    }
  }

  const triList = [];
  for (let c = 0; c < ncols; c++) {
    const base0 = c * stride;
    const base1 = (c + 1) * stride;
    for (let r = 0; r < nrows; r++) {
      const g00 = base0 + r;
      const g10 = base1 + r;
      const g01 = base0 + r + 1;
      const g11 = base1 + r + 1;
      const i00 = indexMap[g00];
      const i10 = indexMap[g10];
      const i01 = indexMap[g01];
      const i11 = indexMap[g11];
      const count = (i00 >= 0 ? 1 : 0) + (i10 >= 0 ? 1 : 0) + (i01 >= 0 ? 1 : 0) + (i11 >= 0 ? 1 : 0);
      if (count < 3) continue;

      if (count === 4) {
        // Split along the flatter diagonal so curved slopes & banks stay smooth (CCW +Y up)
        if (Math.abs(heights[g00] - heights[g11]) <= Math.abs(heights[g10] - heights[g01])) {
          triList.push(i00, i01, i11, i00, i11, i10);
        } else {
          triList.push(i00, i01, i10, i10, i01, i11);
        }
      } else if (i00 >= 0 && i01 >= 0 && i10 >= 0) {
        triList.push(i00, i01, i10);
      } else if (i10 >= 0 && i01 >= 0 && i11 >= 0) {
        triList.push(i10, i01, i11);
      } else if (i00 >= 0 && i01 >= 0 && i11 >= 0) {
        triList.push(i00, i01, i11);
      } else if (i00 >= 0 && i11 >= 0 && i10 >= 0) {
        triList.push(i00, i11, i10);
      }
    }
  }

  if (triList.length < 3) return null;

  return {
    vertices: outVertices,
    indices: Uint32Array.from(triList),
    nrows,
    ncols,
  };
}

/**
 * Deterministically rasterizes `COL_Court` onto an O(1) 0.25 m heightfield grid
 * used for athlete motors, lower ragdolls, and downward raycasts (keeping 4-athlete
 * 2v2 `world.step()` at ~2.4 ms with 1.1 mm surface accuracy). Balls collide instead
 * with the clean manifold trimesh below so they receive full Rapier swept-CCD.
 */
export function rasterizeCourtHeightfield(vertices, indices, options = {}) {
  if (!vertices || !indices || indices.length < 3000) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const z = vertices[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  if (!(spanX > 1 && spanZ > 1)) return null;

  const nrows = options.nrows ?? COURT_HEIGHTFIELD_ROWS;
  const ncols = options.ncols ?? COURT_HEIGHTFIELD_COLS;
  const stride = nrows + 1;
  const heights = new Float32Array((ncols + 1) * stride);
  heights.fill(-Infinity);

  const invDx = ncols / spanX;
  const invDz = nrows / spanZ;
  const dx = spanX / ncols;
  const dz = spanZ / nrows;

  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t] * 3;
    const ib = indices[t + 1] * 3;
    const ic = indices[t + 2] * 3;

    const ax = vertices[ia];
    const ay = vertices[ia + 1];
    const az = vertices[ia + 2];
    const bx = vertices[ib];
    const by = vertices[ib + 1];
    const bz = vertices[ib + 2];
    const cx = vertices[ic];
    const cy = vertices[ic + 1];
    const cz = vertices[ic + 2];

    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-10) continue;
    const invDet = 1 / det;

    const c0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) * invDx));
    const c1 = Math.min(ncols, Math.ceil((Math.max(ax, bx, cx) - minX) * invDx));
    const r0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) * invDz));
    const r1 = Math.min(nrows, Math.ceil((Math.max(az, bz, cz) - minZ) * invDz));

    for (let c = c0; c <= c1; c++) {
      const gx = minX + c * dx;
      const base = c * stride;
      for (let r = r0; r <= r1; r++) {
        const gz = minZ + r * dz;
        const w1 = ((bz - cz) * (gx - cx) + (cx - bx) * (gz - cz)) * invDet;
        const w2 = ((cz - az) * (gx - cx) + (ax - cx) * (gz - cz)) * invDet;
        const w3 = 1 - w1 - w2;
        if (w1 >= -1e-4 && w2 >= -1e-4 && w3 >= -1e-4) {
          const y = w1 * ay + w2 * by + w3 * cy;
          if (y > heights[base + r]) heights[base + r] = y;
        }
      }
    }
  }

  const filled = new Uint8Array(heights.length);
  for (let i = 0; i < heights.length; i++) {
    if (heights[i] > -Infinity) filled[i] = 1;
  }
  for (let c = 0; c <= ncols; c++) {
    const base = c * stride;
    for (let r = 0; r <= nrows; r++) {
      const idx = base + r;
      if (filled[idx]) continue;
      let minNeighbor = Infinity;
      for (let dc = -1; dc <= 1; dc++) {
        const nc = c + dc;
        if (nc < 0 || nc > ncols) continue;
        const nbase = nc * stride;
        for (let dr = -1; dr <= 1; dr++) {
          const nr = r + dr;
          if (nr < 0 || nr > nrows) continue;
          const nidx = nbase + nr;
          if (filled[nidx] && heights[nidx] < minNeighbor) {
            minNeighbor = heights[nidx];
          }
        }
      }
      heights[idx] =
        minNeighbor < Infinity
          ? Math.min(minNeighbor, COURT_RIM_COLLAR_MAX_Y)
          : COURT_EXTERIOR_VOID_Y;
    }
  }

  return {
    nrows,
    ncols,
    heights,
    scale: { x: spanX, y: 1.0, z: spanZ },
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
  };
}

/**
 * Builds a Rapier `ColliderDesc.heightfield` for O(1) athlete/ray court collision.
 */
export function createCourtHeightfieldColliderDesc(rapier, vertices, indices, precomputed = null) {
  const hf = precomputed || rasterizeCourtHeightfield(vertices, indices);
  if (!hf || typeof rapier?.ColliderDesc?.heightfield !== 'function') return null;
  const flags = rapier.HeightFieldFlags ? rapier.HeightFieldFlags.FIX_INTERNAL_EDGES : 0;
  const desc = flags
    ? rapier.ColliderDesc.heightfield(hf.nrows, hf.ncols, hf.heights, hf.scale, flags)
    : rapier.ColliderDesc.heightfield(hf.nrows, hf.ncols, hf.heights, hf.scale);
  if (Math.abs(hf.cx) > 1e-6 || Math.abs(hf.cz) > 1e-6) {
    desc.translation = { x: hf.cx, y: 0, z: hf.cz };
  }
  return desc;
}

/**
 * Builds a clean zero-sliver Rapier `ColliderDesc.trimesh` with `FIX_INTERNAL_EDGES`
 * from precomputed resampled court data or directly from `COL_Court` buffers.
 *
 * @param {object} rapier
 * @param {Float32Array} vertices
 * @param {Uint32Array} indices
 * @param {object|null} [precomputed=null]
 * @returns {object|null}
 */
export function createCourtTrimeshColliderDesc(rapier, vertices, indices, precomputed = null) {
  const mesh = precomputed || rasterizeCourtTrimesh(vertices, indices);
  if (!mesh || typeof rapier?.ColliderDesc?.trimesh !== 'function') return null;
  const flags = rapier.TriMeshFlags ? rapier.TriMeshFlags.FIX_INTERNAL_EDGES : 0;
  return flags
    ? rapier.ColliderDesc.trimesh(mesh.vertices, mesh.indices, flags)
    : rapier.ColliderDesc.trimesh(mesh.vertices, mesh.indices);
}

/**
 * Builds a vertical under-lip skirt collider directly beneath the 11.00 m curved
 * rim edges of the four purple corner fans in `COL_Barriers` (dropping 2.0 m down
 * to y = 9.00 m, buried beneath the ~10.62 m outer turf). Seals the ~0.38 m step
 * between `COL_Court` and the corner fan rim so even a 0.20 m small ball struck
 * directly at the lip can never squeeze underneath a purple corner into the void.
 *
 * Emits skirts ONLY from present upward-facing corner fan triangles so negative
 * control mutants (removed/inverted fan) remain strictly unaffected.
 *
 * @param {object} rapier
 * @param {Float32Array} vertices
 * @param {Uint32Array} indices
 * @returns {object|null}
 */
export function createCornerFanRimSkirtDesc(rapier, vertices, indices) {
  if (!vertices || !indices || indices.length < 3 || typeof rapier?.ColliderDesc?.trimesh !== 'function') {
    return null;
  }
  const skirtVerts = [];
  const skirtIndices = [];

  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t] * 3;
    const ib = indices[t + 1] * 3;
    const ic = indices[t + 2] * 3;
    const pts = [
      [vertices[ia], vertices[ia + 1], vertices[ia + 2]],
      [vertices[ib], vertices[ib + 1], vertices[ib + 2]],
      [vertices[ic], vertices[ic + 1], vertices[ic + 2]],
    ];
    const avgY = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
    const avgZ = (pts[0][2] + pts[1][2] + pts[2][2]) / 3;
    if (avgY < 11.5 || avgY > 11.85 || Math.abs(avgZ) < 37.0) continue;

    // Require upward-facing fan triangle (same predicate as corner_cap_gate.mjs)
    const abx = pts[1][0] - pts[0][0], aby = pts[1][1] - pts[0][1], abz = pts[1][2] - pts[0][2];
    const acx = pts[2][0] - pts[0][0], acy = pts[2][1] - pts[0][1], acz = pts[2][2] - pts[0][2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-8 || ny / len <= 0.4) continue;

    // Identify the 2 rim vertices (y in [10.9, 11.2]) and 1 apex vertex (y >= 12.8)
    const rim = [];
    let hasApex = false;
    for (const p of pts) {
      if (p[1] >= 12.8 && p[1] <= 13.1) hasApex = true;
      else if (p[1] >= 10.9 && p[1] <= 11.2) rim.push(p);
    }
    if (!hasApex || rim.length !== 2) continue;

    const [a, b] = rim;
    const base = skirtVerts.length / 3;
    skirtVerts.push(
      a[0], a[1], a[2],
      b[0], b[1], b[2],
      a[0], a[1] - 2.0, a[2],
      b[0], b[1] - 2.0, b[2],
    );
    skirtIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  if (skirtIndices.length === 0) return null;
  return rapier.ColliderDesc.trimesh(Float32Array.from(skirtVerts), Uint32Array.from(skirtIndices));
}

/**
 * Attaches 4 invisible upper containment wall cuboids (y = 37.5..96.5 m flush with
 * the outer vertical glass at |x| = 30.0, |z| = 65.0) plus a sky ceiling cap at
 * y = 95.0 m so high-arc skyballs rebound cleanly into play instead of sailing over
 * the open y = 38.0 m stadium glass rim into the void.
 *
 * @param {object} rapier
 * @param {object} world
 * @param {object} body
 * @param {{ collisionGroups?: number, friction?: number, restitution?: number, registerType?: boolean }} [options]
 * @returns {object[]} created colliders
 */
export function attachUpperStadiumContainment(rapier, world, body, options = {}) {
  const halfH = (UPPER_WALL_MAX_Y - UPPER_WALL_MIN_Y) * 0.5;
  const midY = (UPPER_WALL_MIN_Y + UPPER_WALL_MAX_Y) * 0.5;
  const wallSpanX = UPPER_WALL_OUTER_X + UPPER_WALL_HALF_T * 2;
  const wallSpanZ = UPPER_WALL_OUTER_Z + UPPER_WALL_HALF_T * 2;

  const specs = [
    // East (+X) and West (-X) upper glass extensions
    { hx: UPPER_WALL_HALF_T, hy: halfH, hz: wallSpanZ, x: UPPER_WALL_OUTER_X + UPPER_WALL_HALF_T, y: midY, z: 0 },
    { hx: UPPER_WALL_HALF_T, hy: halfH, hz: wallSpanZ, x: -(UPPER_WALL_OUTER_X + UPPER_WALL_HALF_T), y: midY, z: 0 },
    // South (+Z) and North (-Z) upper glass extensions
    { hx: wallSpanX, hy: halfH, hz: UPPER_WALL_HALF_T, x: 0, y: midY, z: UPPER_WALL_OUTER_Z + UPPER_WALL_HALF_T },
    { hx: wallSpanX, hy: halfH, hz: UPPER_WALL_HALF_T, x: 0, y: midY, z: -(UPPER_WALL_OUTER_Z + UPPER_WALL_HALF_T) },
    // Sky ceiling lid (bottom face at y = 95.0 m, well above y = 80.0 m audit raycasts)
    { hx: wallSpanX, hy: UPPER_CEILING_HALF_H, hz: wallSpanZ, x: 0, y: UPPER_CEILING_Y + UPPER_CEILING_HALF_H, z: 0 },
  ];

  const created = [];
  for (const s of specs) {
    const desc = rapier.ColliderDesc.cuboid(s.hx, s.hy, s.hz);
    desc.translation = { x: s.x, y: s.y, z: s.z };
    if (options.friction !== undefined) desc.setFriction(options.friction);
    if (options.restitution !== undefined) desc.setRestitution(options.restitution);
    if (options.collisionGroups !== undefined) desc.setCollisionGroups(options.collisionGroups);
    const collider = world.createCollider(desc, body);
    if (options.registerType) {
      arenaColliderTypes.set(collider.handle, 'boundary');
    }
    created.push(collider);
  }
  return created;
}

/**
 * Names as the ARTIST wrote them, recovered from what the loader produced.
 *
 * Two things mangle them on the way in. GLTFLoader sanitises for property
 * binding, so "Back Boundary N.001" arrives as "Back_Boundary_N001"; and a node
 * whose mesh has more than one primitive becomes a GROUP with the node's name
 * and CHILD meshes named after the mesh — so "Scoring Circle N" arrives as a
 * group containing "Circle039" and "Circle039_1". Matching on the mesh's own
 * name therefore misses exactly the multi-material pieces, which in this asset
 * is most of the interesting ones.
 *
 * @param {string} name
 * @returns {string} underscores and runs of whitespace folded to single spaces
 */
function readableName(name) {
  return String(name || '').replace(/[_\s]+/g, ' ').trim();
}

/**
 * The artist's node this mesh belongs to: the highest ancestor below the loaded
 * root, or the mesh itself if it is already that child.
 *
 * @param {THREE.Object3D} object
 * @param {THREE.Object3D} root
 * @returns {THREE.Object3D}
 */
function ownerNode(object, root) {
  let node = object;
  while (node.parent && node.parent !== root) node = node.parent;
  return node;
}

/**
 * Returns true if this mesh is visual-only scenery (dense circle rims or raised
 * chalk line meshes) that should be excluded from Rapier physics colliders.
 *
 * @param {THREE.Object3D} object
 * @returns {boolean}
 */
function isRenderOnly(object) {
  // Dense circle rims: visuals only
  if (object.name === 'Circle039_1' || object.name === 'Circle186_1') return true;

  // 5cm raised line ridges: keep visuals, exclude from physics colliders
  if (object.isMesh) {
    const mats = Array.isArray(object.material) ? object.material : [object.material];
    if (mats.some((m) => m && m.name && m.name.includes('Lines'))) return true;
  }

  return false;
}

/**
 * Normalises authored Blender glTF materials so default metalness (1.0 in glTF)
 * does not render court surfaces as reflective plastic under key lighting.
 *
 * @param {THREE.Material} material
 */
function normaliseCourtMaterial(material, hintName = '') {
  if (!material || !material.isMeshStandardMaterial) return;

  // Standardize chalk lines to canonical arena chalk white (#F5F5F7)
  if (material.name && (material.name.includes('Lines') || material.name.includes('Chalk'))) {
    material.color.set(0xF5F5F7);
    material.roughness = 0.9;
    material.metalness = 0.0;
    return;
  }

  // Translucent perimeter glass barriers: lightweight unlit pane (eliminates
  // 5-light PBR shading and shadow-map sampling across fullscreen transparent walls)
  const isBarrierGlass = material.transparent || material.name === 'M_Barrier Glass' || material.name?.includes('Barrier');
  if (isBarrierGlass) {
    const config = TUNING.arena?.barrier || {};
    const fastGlass = new THREE.MeshBasicMaterial({
      color: material.color ? material.color.clone() : 0xbae6fd,
      transparent: true,
      opacity: config.opacity ?? 0.08,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    fastGlass.name = material.name || 'M_Barrier Glass';
    return fastGlass;
  }

  // Stream / water channels: very subtle hydro-matte, eliminating distracting glare and hotspots
  if (material.name && (material.name.includes('Stream') || material.name.includes('Water'))) {
    material.roughness = 0.65;
    material.metalness = 0.02;
    return;
  }

  // Colored athletic court zones: sealed satin composite finish
  if (
    material.name &&
    (material.name.includes('Center') ||
      material.name.includes('Pick') ||
      material.name.includes('Scoring') ||
      material.name.includes('Corner'))
  ) {
    material.roughness = 0.68;
    material.metalness = 0.03;
    return;
  }

  // Main playing turf: clean athletic synthetic turf with subtle directional slope roll-off
  if (material.name && (material.name.includes('Field') || material.name.includes('Turf'))) {
    material.roughness = 0.78;
    material.metalness = 0.02;
    return;
  }

  // Goal hoops / hardware: anodized athletic satin metal
  if (
    (material.name && (material.name.includes('Goal') || material.name.includes('Hoop'))) ||
    /Goal|Hoop/i.test(hintName)
  ) {
    material.roughness = 0.35;
    material.metalness = 0.50;
    return;
  }

  material.metalness = Math.min(material.metalness ?? 0, 0.04);
  material.roughness = Math.max(material.roughness ?? 1, 0.80);
  // The glass barriers are authored alphaMode BLEND. Leave them transparent,
  // but stop them writing depth or they punch holes in everything behind.
  // Render FrontSide to eliminate 50% transparent pixel overdraw across large bounds.
  if (material.transparent) {
    material.depthWrite = false;
    material.side = THREE.FrontSide;
  }
}

/**
 * Attaches a chalk-width pink outline along glass pane edges, chamfers, and angle intersections.
 *
 * @param {THREE.Mesh} object
 * @param {string} owner
 * @param {THREE.Material[]} materials
 */
function attachBarrierEdgeOutlines(object, owner, materials, collectedLines = null) {
  const isBarrier =
    owner.includes('Barrier') ||
    owner.includes('Boundary') ||
    materials.some((m) => m && (m.name === 'M_Barrier Glass' || m.name?.includes('Barrier')));
  if (!isBarrier || !object.geometry) return;

  const config = TUNING.arena?.barrier || {};
  const edgeGeo = new THREE.EdgesGeometry(object.geometry, config.edgeAngle ?? 25);
  const lineMat = new THREE.LineBasicMaterial({
    color: config.edgeColor ?? 0xEC4899,
    transparent: true,
    opacity: config.edgeOpacity ?? 0.90,
    depthWrite: false,
  });
  const edgeLines = new THREE.LineSegments(edgeGeo, lineMat);
  edgeLines.name = `${owner}_pink_edges`;
  object.add(edgeLines);
  if (collectedLines) collectedLines.push(edgeLines);
}

/**
 * Loads the authored court and derives its colliders from the meshes it draws.
 *
 * ONE FIXED BODY, MANY COLLIDERS. The alternative — merging forty meshes into a
 * single geometry — was rejected: eleven of the court's nodes are mirrored
 * instances (negative determinant), and merging them into one buffer flips
 * their winding, so the merged render mesh would be inside-out exactly where
 * the collider was fine. Kept as separate colliders on one static body, each
 * baked through its own mesh's world matrix, the question never arises. three.js
 * flips the front face per object for negative determinants on its own.
 *
 * @param {THREE.Scene} scene
 * @returns {Promise<object>} the arena handle
 */
async function loadCourtArena(scene) {
  const url = TUNING.arena.modelUrl;
  const gltf = await new GLTFLoader().loadAsync(url);

  const group = gltf.scene;
  group.name = 'arena-court';
  // Every world matrix below is read off this, so it is computed ONCE here and
  // before anything measures anything — the same discipline loadCharacter uses.
  group.updateMatrixWorld(true);

  const world = getWorld();
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  const colliders = [];
  // The world extent of what was actually handed to Rapier, accumulated from the
  // BAKED vertex buffers rather than from the scene graph. If the bake is wrong
  // this is the line that says so — a collider set whose bounds do not match the
  // asset's is the difference between a floor and a hole.
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  /** owner node name -> triangles contributed, so the log reads in the artist's
   *  vocabulary rather than in Blender's primitive numbering. */
  const collidable = new Map();
  const scenery = new Set();
  let triangleCount = 0;
  let degenerateCount = 0;
  let invertedCount = 0;

  // Check if the asset provides dedicated collision proxies (prefixed with COL)
  let hasDedicatedColliders = false;
  group.traverse((object) => {
    if (object.isMesh) {
      const owner = readableName(ownerNode(object, group).name);
      if (owner.startsWith('COL')) hasDedicatedColliders = true;
    }
  });

  // Build exact 0.25 m visual terrain surface elevation grid for turf guides
  const visGrid = new Float32Array((VIS_GRID_NZ + 1) * VIS_STRIDE);
  visGrid.fill(-Infinity);
  let hasVisualFloorSamples = false;
  const collectedBarrierLines = [];

  // Traversal order is the glTF node order, which is fixed by the file — so the
  // colliders are created in the same order on every run. LAW 6 does not care
  // what the order IS, only that it cannot change between two runs.
  group.traverse((object) => {
    if (!object.isMesh) return;

    const owner = readableName(ownerNode(object, group).name) || readableName(object.name);
    const isColliderProxy = owner.startsWith('COL');

    if (hasDedicatedColliders) {
      if (isColliderProxy) {
        if (SHOW_COLLIDERS) {
          // Debug view: render the collision proxy as a colored wireframe laid
          // over the scene (depthTest off so it reads through the visual floor).
          object.material = new THREE.MeshBasicMaterial({
            color: colliderDebugColor(owner),
            wireframe: true,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
            depthWrite: false,
          });
          object.renderOrder = 1000;
          object.visible = true;
        } else {
          // Dedicated collision geometry: invisible in the render pass
          object.visible = false;
        }
      } else {
        // Visual mesh: normalise materials, render with shadows, skip physics collision
        object.castShadow = false;
        object.frustumCulled = true;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        let isGlassMesh = false;
        const hintName = `${owner?.name || ''} ${object?.name || ''}`;
        for (let mi = 0; mi < materials.length; mi++) {
          const replacement = normaliseCourtMaterial(materials[mi], hintName);
          if (replacement) {
            isGlassMesh = true;
            if (Array.isArray(object.material)) {
              object.material[mi] = replacement;
            } else {
              object.material = replacement;
            }
            materials[mi] = replacement;
          }
        }
        const isFloorReceiver = !isGlassMesh && isVisualFloorMesh(owner, object.name, isGlassMesh) && !materials.some((m) => m?.name?.includes('Lines'));
        object.receiveShadow = isFloorReceiver;
        if (isVisualFloorMesh(owner, object.name, isGlassMesh)) {
          rasterizeMeshIntoVisualGrid(visGrid, object.geometry, object.matrixWorld);
          hasVisualFloorSamples = true;
        }
        attachBarrierEdgeOutlines(object, owner, materials, collectedBarrierLines);
        scenery.add(owner);
        return;
      }
    } else {
      // Visuals first, and for every mesh including the scenery.
      object.receiveShadow = true;
      object.castShadow = false;
      object.frustumCulled = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const hintName = `${owner?.name || ''} ${object?.name || ''}`;
      for (const material of materials) normaliseCourtMaterial(material, hintName);
      if (isVisualFloorMesh(owner, object.name, false)) {
        rasterizeMeshIntoVisualGrid(visGrid, object.geometry, object.matrixWorld);
        hasVisualFloorSamples = true;
      }

      if (isRenderOnly(object, group)) {
        attachBarrierEdgeOutlines(object, owner, materials);
        scenery.add(owner);
        return;
      }
    }

    // BAKED INTO WORLD SPACE. The clone is essential: applyMatrix4 mutates, and
    // the geometry being mutated is the one the renderer is about to draw.
    const baked = object.geometry.clone();
    baked.applyMatrix4(object.matrixWorld);

    const isCourtSurface = isColliderProxy || !hasDedicatedColliders;
    const {
      vertices,
      indices,
      degenerateCount: dropped,
      invertedCount: droppedInverted = 0,
    } = toTrimeshArrays(baked, {
      filterInverted: isCourtSurface,
      maxInvertedY: 4.0,
    });
    baked.dispose();

    if (indices.length === 0) {
      scenery.add(`${owner} (no non-degenerate triangles)`);
      return;
    }

    for (let v = 0; v < vertices.length; v += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = vertices[v + axis];
        if (value < bounds.min[axis]) bounds.min[axis] = value;
        if (value > bounds.max[axis]) bounds.max[axis] = value;
      }
    }

    // SPLIT-MASK COURT FLOOR ARCHITECTURE:
    //   1. Athletes (4 motors + 64 ragdoll capsules) & raycasts use the O(1) 0.25 m
    //      HeightField (`ENVIRONMENT_ATHLETE_GROUPS`), keeping 2v2 `world.step()` at
    //      ~2.4 ms mean / ~3.6 ms p95 with 1.1 mm surface accuracy.
    //   2. Balls use the clean zero-sliver manifold trimesh (`ENVIRONMENT_BALL_GROUPS`)
    //      so every ball (including 0.20 m small balls at 50 m/s) gets full Rapier
    //      swept-CCD with 0 floor tunnels and 0 BVH load from ragdoll capsules.
    const isCourtFloor = owner === 'COL_Court' || owner === 'COL Court';
    let arenaType = 'court';
    if (owner.includes('Barrier') || owner.includes('Boundary')) arenaType = 'boundary';
    else if (owner.includes('Goal') || owner.includes('Hoop')) arenaType = 'goal';
    else if (owner.includes('Court')) arenaType = 'court';

    if (isCourtFloor) {
      const hfDesc = createCourtHeightfieldColliderDesc(RAPIER, vertices, indices);
      const ballMeshDesc = createCourtTrimeshColliderDesc(RAPIER, vertices, indices);
      if (hfDesc && ballMeshDesc) {
        const hfCollider = world.createCollider(hfDesc, body);
        hfCollider.setCollisionGroups(ENVIRONMENT_ATHLETE_GROUPS);
        colliders.push(hfCollider);
        arenaColliderTypes.set(hfCollider.handle, 'court');

        const ballCollider = world.createCollider(ballMeshDesc, body);
        ballCollider.setCollisionGroups(ENVIRONMENT_BALL_GROUPS);
        colliders.push(ballCollider);
        arenaColliderTypes.set(ballCollider.handle, 'court');
      } else {
        const fallback = RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
        const collider = world.createCollider(fallback, body);
        collider.setCollisionGroups(ENVIRONMENT_GROUPS);
        colliders.push(collider);
        arenaColliderTypes.set(collider.handle, 'court');
      }
    } else {
      // Keep COL_Barriers (glass walls + purple corner fans) and COL_Goals two-sided
      // without FIX_INTERNAL_EDGES: FIX_INTERNAL_EDGES drops contacts along open boundary
      // edges (such as the y = 11.00 m curved purple corner lip), letting fast or small
      // balls slip beneath the corner fans into the void.
      const desc = RAPIER.ColliderDesc.trimesh(vertices, indices);
      const collider = world.createCollider(desc, body);
      collider.setCollisionGroups(ENVIRONMENT_GROUPS);
      colliders.push(collider);
      arenaColliderTypes.set(collider.handle, arenaType);

      if (arenaType === 'boundary') {
        const skirtDesc = createCornerFanRimSkirtDesc(RAPIER, vertices, indices);
        if (skirtDesc) {
          const skirtCol = world.createCollider(skirtDesc, body);
          skirtCol.setCollisionGroups(ENVIRONMENT_GROUPS);
          colliders.push(skirtCol);
          arenaColliderTypes.set(skirtCol.handle, 'boundary');
        }
      }
    }

    collidable.set(owner, (collidable.get(owner) || 0) + indices.length / 3);
    triangleCount += indices.length / 3;
    degenerateCount += dropped;
    invertedCount += droppedInverted;
  });

  // Seal the open sky above y = 38.0 m COL_Barriers walls so high-arc balls stay in play
  const upperColliders = attachUpperStadiumContainment(RAPIER, world, body, {
    collisionGroups: ENVIRONMENT_GROUPS,
    registerType: true,
  });
  for (const uc of upperColliders) colliders.push(uc);

  if (hasVisualFloorSamples) {
    visualTerrainGrid = finalizeVisualGrid(visGrid);
  }

  // Merge all barrier pink edge LineSegments into a single draw call and batch
  // static visual meshes by material (colliders are already built above; zero physics change).
  if (collectedBarrierLines.length > 1) {
    const sharedLineMat = collectedBarrierLines[0].material;
    const mergedLines = mergeLineSegmentsList(collectedBarrierLines, sharedLineMat, 'arena_barrier_pink_edges');
    if (mergedLines) {
      for (const seg of collectedBarrierLines) {
        seg.removeFromParent();
        seg.geometry?.dispose();
        if (seg.material && seg.material !== sharedLineMat) seg.material.dispose();
      }
      group.add(mergedLines);
    }
  }
  const batchStats = mergeStaticGroupByMaterial(group, {
    filter: (mesh) => {
      const owner = readableName(ownerNode(mesh, group).name) || readableName(mesh.name);
      return !owner.startsWith('COL');
    },
  });
  console.log(`[arena] static visual batching: ${batchStats.beforeDraws} -> ${batchStats.afterDraws} draw calls`);

  scene.add(group);

  console.log(
    `[arena] court "${url}": ${colliders.length} trimesh colliders on one fixed body, ` +
      `${triangleCount} triangles (${degenerateCount} degenerate, ${invertedCount} inverted removed)`,
  );
  const byName = [...collidable.entries()].sort((a, b) => b[1] - a[1]);
  console.log(
    `[arena] collidable nodes (${byName.length}): ` +
      byName.map(([name, tris]) => `${name} ${tris}`).join(', '),
  );
  console.log(
    `[arena] render-only (${scenery.size}): ${[...scenery].join(', ') || 'none'}`,
  );
  const fixed3 = (n) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a');
  console.log(
    `[arena] collider world bounds: x ${fixed3(bounds.min[0])}..${fixed3(bounds.max[0])}, ` +
      `y ${fixed3(bounds.min[1])}..${fixed3(bounds.max[1])}, ` +
      `z ${fixed3(bounds.min[2])}..${fixed3(bounds.max[2])}`,
  );

  return {
    type: 'court',
    group,
    geometry: null,
    body,
    colliders,
    collider: colliders[0],
    triangleCount,
    degenerateCount,
  };
}

/**
 * The active arena type. Valley Court is the authentic arena.
 *
 * @returns {'court'}
 */
export function activeArenaType() {
  return 'court';
}

/** The active arena's preset block. @returns {object} */
export function activeArenaPreset() {
  return TUNING.arena.court;
}

/**
 * Builds the Valley Court arena and puts it in the scene.
 *
 * @param {THREE.Scene} scene
 * @returns {Promise<object>} the arena handle
 */
export async function createArena(scene) {
  return loadCourtArena(scene);
}
