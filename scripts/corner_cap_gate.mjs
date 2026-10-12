/**
 * CORNER CAP GATE — shared verification + mutation for the corner glass-bottom
 * caps of the Valley Court.
 *
 * The v0.3.2 corner fall-through bug came from the horizontal glass-bottom cap
 * (the standing floor of each corner shelf) being missing or wound downward.
 * Rapier trimeshes are one-sided, so a downward-wound cap reads as a hole and
 * any entity crossing the terrain rim (~11 m) falls to it instead of landing
 * on the intended 13 m shelf.
 *
 * Geometry (measured, arena v10.9):
 *   - COL_Court is the terrain rim only: x[-25,25] y[0,11] z[-60,60].
 *   - COL_Barriers carries the four corner caps: flat horizontal triangles at
 *     avg y = 13.0 with +Y winding, 32 per quadrant, out to |x|=25 / |z|=60.
 *   - VIS_Corner_* spans x[0,25] z[37.5,60] y[11,13]; only its outer diagonal
 *     wedge (y >= 12.5) is a standing surface backed by the cap. Inner points
 *     are the sloped terrace backed by the COL_Court rim.
 *
 * This module exposes (a) the cap-triangle predicate and quadrant naming, (b)
 * a mutation that removes or inverts a quadrant's cap for the negative-control
 * harness, (c) a VIS standing-surface raycast world so callers can find the
 * cap-backed sample points, and (d) the certification checks the audit and
 * drop gates share: winding (no downward-facing cap, one cap fan per quadrant)
 * and rest height (every VIS corner standing surface in the cap band must be
 * backed by a cap at the intended height, not the lower rim).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toTrimeshArrays } from '../src/sim/arena.js';

// ═══ CAP GEOMETRY CONSTANTS ═══

/** Cap-band triangle height (m): a nearly-flat horizontal triangle with its
 * three vertices at avg y inside this band is a cap tile. The 13 m caps sit at
 * exactly 13.0; the vertical curtains around them have near-horizontal normals
 * and are excluded by the winding test below. */
export const CAP_BAND_MIN_Y = 12.5;
export const CAP_BAND_MAX_Y = 13.6;

/** Intended corner shelf surface height (m). A dropped entity spawned HERE
 * (not at the "highest remaining collider") reads a missing cap as a fall to
 * the ~11 m rim instead of a pass. */
export const CAP_HEIGHT_M = 13.0;

/** Minimum entity rest base (m) the cap must hold: ball/player must come to
 * rest on the 13 m shelf, not fall through to the ~11 m terrain rim. */
export const CAP_REST_MIN_Y = 12.8;

/** Corner shelf sampling footprint (single quadrant, mirrored); the cap wedge
 * plus the full outer boundary |x|<=25, |z|<=60. */
export const CAP_X_MIN = 15.0;
export const CAP_X_MAX = 25.0;
export const CAP_Z_MIN = 45.0;
export const CAP_Z_MAX = 60.0;

/** A VIS corner standing surface at or above this height is cap-backed (the
 * top of the purple wedge), as opposed to the sloped terrace below. */
export const CAP_VIS_MIN_Y = 12.5;

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

/** Quadrant label from a cap triangle centroid. N = -z (matches VIS_Corner
 * naming and the headless sim's compass: the hoops are at z = -40 = North). */
export function capQuadrantOf(avgX, avgZ) {
  // Compass naming, N = -z (hoops at z = -40 = North): NE = +x,-z, SE = +x,+z,
  // NW = -x,-z, SW = -x,+z. Order is N/S first, then E/W.
  const ns = avgZ >= 0 ? 'S' : 'N';
  const ew = avgX >= 0 ? 'E' : 'W';
  return ns + ew;
}

/** Is triangle (a,b,c) a corner cap tile in the target quadrant? */
function isCapTriangle(avgX, avgY, avgZ, ny, quadrant) {
  if (avgY < CAP_BAND_MIN_Y || avgY > CAP_BAND_MAX_Y) return false;
  if (ny < 0.9) return false; // must be a flat upward horizontal tile
  return quadrant === 'all' || capQuadrantOf(avgX, avgZ) === quadrant;
}

// ═══ RAYCAST / VIS WORLD ═══

/** Downward surface Y at (x, z) in a world, from y0. Returns null on a miss. */
export function castDown(world, x, y0, z) {
  const ray = new RAPIER.Ray({ x, y: y0, z }, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(ray, 200, true);
  if (!hit) return null;
  const toi = hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
  return y0 - toi;
}

/** Build a static raycast world from the VIS standing meshes so their
 * world-space surfaces can be sampled by the same raycast helper. This is the
 * source of truth for which corner points ARE standing cap surfaces (VIS at
 * y >= CAP_VIS_MIN_Y), independent of whether the physical cap is present. */
export async function buildVisStandingWorld() {
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

/** Enumerate the cap-backed corner standing points across all four quadrants:
 * every sample in the corner footprint whose VIS corner surface sits at
 * y >= CAP_VIS_MIN_Y. These are the points that MUST be held by the 13 m cap;
 * a point absent here is the sloped terrace, legitimately rim-backed. */
export function cornerCapStandingPoints(visWorld, step = 0.5) {
  const points = [];
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      for (let x = CAP_X_MIN; x <= CAP_X_MAX + 1e-9; x += step) {
        for (let z = CAP_Z_MIN; z <= CAP_Z_MAX + 1e-9; z += step) {
          const px = sx * x;
          const pz = sz * z;
          const visY = castDown(visWorld, px, 80, pz);
          if (visY !== null && visY >= CAP_VIS_MIN_Y) points.push({ x: px, z: pz, visY });
        }
      }
    }
  }
  return points;
}

// ═══ MUTATION (negative control) ═══

/**
 * Returns a copy of the extracted arena mesh arrays with a quadrant's corner
 * cap either removed (mode 'remove') or wound downward (mode 'invert'), so the
 * certification gates can be proven to REJECT a missing or inverted shelf.
 * `meshes` is the array returned by buildWorld; only COL_Barriers is touched.
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
      const ax = vertices[i * 3], ay = vertices[i * 3 + 1], az = vertices[i * 3 + 2];
      const bx = vertices[j * 3], by = vertices[j * 3 + 1], bz = vertices[j * 3 + 2];
      const cx = vertices[k * 3], cy = vertices[k * 3 + 1], cz = vertices[k * 3 + 2];
      const avgX = (ax + bx + cx) / 3;
      const avgY = (ay + by + cy) / 3;
      const avgZ = (az + bz + cz) / 3;
      const ny = upwardComponent(ax, ay, az, bx, by, bz, cx, cy, cz);
      if (isCapTriangle(avgX, avgY, avgZ, ny, quadrant)) {
        if (mutate.mode === 'remove') continue;       // drop the cap tile
        if (mutate.mode === 'invert') { kept.push(i, k, j); continue; } // flip winding
      }
      kept.push(i, j, k);
    }
    return { ...m, indices: Uint32Array.from(kept) };
  });
}

// ═══ CERTIFICATION CHECKS ═══

/**
 * Winding check on the extracted COL_Barriers triangles: every corner cap tile
 * must be wound upward, and each of the four quadrants must carry its full cap
 * fan. Returns a failure list (empty = pass).
 */
export function cornerCapWinding(meshes) {
  const failures = [];
  const upPerQuadrant = { NE: 0, NW: 0, SE: 0, SW: 0 };
  let downFacing = 0;
  for (const m of meshes) {
    if (m.name !== 'COL_Barriers') continue;
    const { vertices, indices } = m;
    for (let t = 0; t < indices.length; t += 3) {
      const i = indices[t], j = indices[t + 1], k = indices[t + 2];
      const ax = vertices[i * 3], ay = vertices[i * 3 + 1], az = vertices[i * 3 + 2];
      const bx = vertices[j * 3], by = vertices[j * 3 + 1], bz = vertices[j * 3 + 2];
      const cx = vertices[k * 3], cy = vertices[k * 3 + 1], cz = vertices[k * 3 + 2];
      const avgX = (ax + bx + cx) / 3;
      const avgY = (ay + by + cy) / 3;
      const avgZ = (az + bz + cz) / 3;
      if (avgY < CAP_BAND_MIN_Y || avgY > CAP_BAND_MAX_Y) continue;
      const ny = upwardComponent(ax, ay, az, bx, by, bz, cx, cy, cz);
      if (ny < -0.5) {
        downFacing++;
        if (downFacing <= 8) {
          failures.push({ kind: 'inverted-cap', quadrant: capQuadrantOf(avgX, avgZ), x: +avgX.toFixed(2), z: +avgZ.toFixed(2), ny: +ny.toFixed(2) });
        }
      } else if (ny > 0.9) {
        const q = capQuadrantOf(avgX, avgZ);
        upPerQuadrant[q]++;
      }
    }
  }
  for (const q of ['NE', 'NW', 'SE', 'SW']) {
    if (upPerQuadrant[q] === 0) {
      failures.push({ kind: 'missing-cap', quadrant: q, upTiles: 0 });
    }
  }
  return { failures, upPerQuadrant, downFacing };
}

/**
 * Rest-height check: every VIS corner standing surface in the cap band (y >=
 * CAP_VIS_MIN_Y) must be backed by a solid collider at the cap height
 * (>= CAP_REST_MIN_Y) directly below. A missing or inverted cap returns the
 * terrain rim (~11 m) instead, which is a failure. `visWorld` is the
 * raycast-only world of VIS standing meshes; `probe` is the terrain world.
 */
export function cornerCapRestCheck(probe, visWorld, step = 0.5) {
  const failures = [];
  const standing = cornerCapStandingPoints(visWorld, step);
  for (const { x, z, visY } of standing) {
    const capY = castDown(probe, x, 80, z);
    if (capY === null || capY < CAP_REST_MIN_Y) {
      failures.push({
        kind: 'cap-not-resting',
        x: +x.toFixed(2),
        z: +z.toFixed(2),
        visY: +visY.toFixed(2),
        surfaceY: capY === null ? null : +capY.toFixed(2),
      });
    }
  }
  return { failures, checked: standing.length, step };
}