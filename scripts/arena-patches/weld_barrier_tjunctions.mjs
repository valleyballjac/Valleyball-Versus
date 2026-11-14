/**
 * Welds every T-junction in COL_Barriers inside public/models/arena.glb.
 *
 * THE LEAK. The side glass top (|x| = 25, y = 13) is cut into 72 segments
 * per side, but the 45° chamfer above it starts with ONE 120 m edge,
 * (±25, 13, -60) -> (±25, 13, 60). The 71 glass-top vertices on each side
 * sit on that edge without being part of it, so after Rapier merges
 * duplicate vertices the seam is still an open boundary edge on both
 * sides. FIX_INTERNAL_EDGES (which every COL_ proxy gets, src/sim/arena.js)
 * drops contacts on open edges, and a ball crossing the glass plane within
 * ~0.2 m of y = 13 went straight through it.
 *
 * THE WELD. Each triangle edge that carries other vertices is split at
 * them: the triangle becomes a fan from its opposite vertex through every
 * vertex on the edge, wound the same way. No vertex moves and none is
 * added, so the surface is exactly the same shape; only the triangulation
 * changes, and the seam becomes a shared, internal edge. The same pass
 * closes the smaller T-junctions on the back-glass top seam, the chamfer
 * top corners and the hoop-notch verticals.
 *
 * THE PATCH. Only COL_Barriers' index buffer is rewritten. Every other
 * bufferView is copied byte for byte and only shifted, and the script
 * checks that after writing.
 *
 * Run:  node scripts/weld_barrier_tjunctions.mjs          (dry run, report only)
 *       node scripts/weld_barrier_tjunctions.mjs --write  (patch arena.glb in place)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GLB_PATH = path.join(ROOT, 'public', 'models', 'arena.glb');
const MESH_NAME = 'COL_Barriers';
const DO_WRITE = process.argv.includes('--write');

/** A vertex within this distance of an edge's open interior lies on it (m). */
const ON_EDGE_EPS = 1e-3;
/** Edge parameter margin that keeps the edge's own endpoints out. */
const END_MARGIN = 1e-4;
/** Positions this close are one physical point (m). */
const SAME_POINT_EPS = 1e-4;

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${file} is not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== CHUNK_JSON) throw new Error('first chunk is not JSON');
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binHeader = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHeader);
  if (buf.readUInt32LE(binHeader + 4) !== CHUNK_BIN) throw new Error('second chunk is not BIN');
  const bin = Buffer.from(buf.subarray(binHeader + 8, binHeader + 8 + binLen));
  return { json, bin };
}

function writeGlb(file, json, bin) {
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binBuf = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBuf.length, 0);
  jsonHead.writeUInt32LE(CHUNK_JSON, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binBuf.length, 0);
  binHead.writeUInt32LE(CHUNK_BIN, 4);
  fs.writeFileSync(file, Buffer.concat([header, jsonHead, jsonBuf, binHead, binBuf]));
}

function viewBytes(json, bin, viewIndex) {
  const view = json.bufferViews[viewIndex];
  const start = view.byteOffset || 0;
  return bin.subarray(start, start + view.byteLength);
}

/** The COL_Barriers primitive: its node, accessors, positions and indices. */
function findMesh(json, bin) {
  const node = json.nodes.find((n) => n.name === MESH_NAME);
  if (!node || node.mesh === undefined) throw new Error(`no ${MESH_NAME} node`);
  for (const key of ['matrix', 'translation', 'rotation', 'scale']) {
    if (node[key] !== undefined) throw new Error(`${MESH_NAME} has a node ${key}; the edge tolerance assumes identity`);
  }
  const primitives = json.meshes[node.mesh].primitives;
  if (primitives.length !== 1) throw new Error(`${MESH_NAME} has ${primitives.length} primitives, expected 1`);
  const prim = primitives[0];
  if ((prim.mode ?? 4) !== 4) throw new Error(`${MESH_NAME} is not a triangle list`);

  const posAcc = json.accessors[prim.attributes.POSITION];
  const posView = json.bufferViews[posAcc.bufferView];
  if (posAcc.componentType !== FLOAT || posAcc.type !== 'VEC3') throw new Error('POSITION is not float VEC3');
  const stride = posView.byteStride || 12;
  const posBytes = viewBytes(json, bin, posAcc.bufferView);
  const positions = new Float64Array(posAcc.count * 3);
  for (let v = 0; v < posAcc.count; v++) {
    const at = (posAcc.byteOffset || 0) + v * stride;
    for (let k = 0; k < 3; k++) positions[v * 3 + k] = posBytes.readFloatLE(at + k * 4);
  }

  const idxAcc = json.accessors[prim.indices];
  const idxBytes = viewBytes(json, bin, idxAcc.bufferView);
  const width = idxAcc.componentType === UNSIGNED_SHORT ? 2 : 4;
  const indices = [];
  for (let i = 0; i < idxAcc.count; i++) {
    const at = (idxAcc.byteOffset || 0) + i * width;
    indices.push(width === 2 ? idxBytes.readUInt16LE(at) : idxBytes.readUInt32LE(at));
  }
  const sharers = json.accessors.filter((a) => a.bufferView === idxAcc.bufferView).length;
  if (sharers !== 1) throw new Error('the index bufferView is shared with another accessor');
  return { prim, posAcc, idxAcc, positions, indices };
}

/** One vertex index per physical point, so a point is never inserted twice. */
function representatives(positions) {
  const reps = [];
  for (let v = 0; v < positions.length / 3; v++) {
    const dup = reps.some((r) =>
      Math.abs(positions[r * 3] - positions[v * 3]) < SAME_POINT_EPS &&
      Math.abs(positions[r * 3 + 1] - positions[v * 3 + 1]) < SAME_POINT_EPS &&
      Math.abs(positions[r * 3 + 2] - positions[v * 3 + 2]) < SAME_POINT_EPS);
    if (!dup) reps.push(v);
  }
  return reps;
}

/** Representative vertices strictly inside edge a->b, ordered from a. */
function verticesOnEdge(positions, reps, a, b) {
  const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
  const dx = positions[b * 3] - ax, dy = positions[b * 3 + 1] - ay, dz = positions[b * 3 + 2] - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-12) return [];
  const found = [];
  for (const r of reps) {
    const qx = positions[r * 3] - ax, qy = positions[r * 3 + 1] - ay, qz = positions[r * 3 + 2] - az;
    const s = (qx * dx + qy * dy + qz * dz) / len2;
    if (s <= END_MARGIN || s >= 1 - END_MARGIN) continue;
    if (Math.hypot(qx - s * dx, qy - s * dy, qz - s * dz) < ON_EDGE_EPS) found.push({ r, s });
  }
  found.sort((p, q) => p.s - q.s);
  return found.map((f) => f.r);
}

function triNormal(positions, a, b, c) {
  const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
  const vx = positions[c * 3] - positions[a * 3], vy = positions[c * 3 + 1] - positions[a * 3 + 1], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

const area = (n) => Math.hypot(n[0], n[1], n[2]) / 2;

/**
 * A needle: its three corners lie on one line to within ON_EDGE_EPS, so its
 * own third corner reads as a vertex "on" its longest edge. COL_Barriers has
 * two (at the y = 18 chamfer top, altitudes of a few µm). They have no
 * surface to weld and are left exactly as they are.
 */
function isNeedle(positions, a, b, c) {
  const cross = Math.hypot(...triNormal(positions, a, b, c));
  const len = (p, q) => Math.hypot(
    positions[q * 3] - positions[p * 3], positions[q * 3 + 1] - positions[p * 3 + 1], positions[q * 3 + 2] - positions[p * 3 + 2]);
  const longest = Math.max(len(a, b), len(b, c), len(c, a));
  return longest === 0 || cross / longest < ON_EDGE_EPS;
}

/**
 * Splits every triangle at the vertices on its edges, until none are left.
 * Triangles keep their order; a split one is replaced in place by its fan.
 */
function weld(positions, indices, reps) {
  const out = [];
  const splits = [];
  for (let t = 0; t < indices.length; t += 3) {
    const source = t / 3;
    if (isNeedle(positions, indices[t], indices[t + 1], indices[t + 2])) {
      out.push(indices[t], indices[t + 1], indices[t + 2]);
      continue;
    }
    const n0 = triNormal(positions, indices[t], indices[t + 1], indices[t + 2]);
    const pending = [[indices[t], indices[t + 1], indices[t + 2]]];
    while (pending.length) {
      const tri = pending.shift();
      let split = false;
      for (let e = 0; e < 3 && !split; e++) {
        const a = tri[e], b = tri[(e + 1) % 3], c = tri[(e + 2) % 3];
        const on = verticesOnEdge(positions, reps, a, b);
        if (on.length === 0) continue;
        const chain = [a, ...on, b];
        for (let n = 0; n < chain.length - 1; n++) pending.push([chain[n], chain[n + 1], c]);
        splits.push({ source, a, b, count: on.length });
        split = true;
      }
      if (split) continue;
      // A piece lies in its source's plane, so it must face the same way.
      const n = triNormal(positions, tri[0], tri[1], tri[2]);
      const cosine = (n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2]) / (Math.hypot(...n) * Math.hypot(...n0));
      if (!(cosine > 0.999)) throw new Error(`a piece of triangle ${source} does not face its source (cos ${cosine})`);
      out.push(tri[0], tri[1], tri[2]);
    }
  }
  return { indices: out, splits };
}

function countTJunctions(positions, indices, reps) {
  let count = 0;
  for (let t = 0; t < indices.length; t += 3) {
    if (isNeedle(positions, indices[t], indices[t + 1], indices[t + 2])) continue;
    for (let e = 0; e < 3; e++) count += verticesOnEdge(positions, reps, indices[t + e], indices[t + (e + 1) % 3]).length;
  }
  return count;
}

/** Total area and, per source triangle, that every piece faces the same way. */
function checkSameSurface(positions, before, after) {
  let areaBefore = 0, areaAfter = 0;
  for (let t = 0; t < before.length; t += 3) areaBefore += area(triNormal(positions, before[t], before[t + 1], before[t + 2]));
  for (let t = 0; t < after.length; t += 3) areaAfter += area(triNormal(positions, after[t], after[t + 1], after[t + 2]));
  if (Math.abs(areaAfter - areaBefore) > 1e-6 * areaBefore) throw new Error(`area changed: ${areaBefore} -> ${areaAfter}`);
  return { areaBefore, areaAfter };
}

const fmt = (positions, v) => `(${[0, 1, 2].map((k) => +positions[v * 3 + k].toFixed(3)).join(', ')})`;

const { json, bin } = readGlb(GLB_PATH);
const mesh = findMesh(json, bin);
const reps = representatives(mesh.positions);
const before = countTJunctions(mesh.positions, mesh.indices, reps);
const { indices: welded, splits } = weld(mesh.positions, mesh.indices, reps);
const after = countTJunctions(mesh.positions, welded, reps);
const surface = checkSameSurface(mesh.positions, mesh.indices, welded);

console.log(`${MESH_NAME}: ${mesh.indices.length / 3} triangles, ${mesh.posAcc.count} vertices, ${reps.length} distinct points`);
console.log(`T-junction vertices: ${before} before, ${after} after the weld`);
for (const s of splits.sort((p, q) => p.source - q.source)) {
  console.log(`  triangle ${s.source}: edge ${fmt(mesh.positions, s.a)} -> ${fmt(mesh.positions, s.b)} split at ${s.count} vertices`);
}
console.log(`triangles: ${mesh.indices.length / 3} -> ${welded.length / 3}; area ${surface.areaBefore.toFixed(3)} -> ${surface.areaAfter.toFixed(3)} m²`);
if (after !== 0) { console.error('T-junctions remain after the weld, abort'); process.exit(1); }

if (!DO_WRITE) {
  console.log('dry run; pass --write to patch', path.relative(ROOT, GLB_PATH));
  process.exit(0);
}

// Rebuild BIN: every bufferView in order, the index view replaced, each one
// 4-byte aligned. Only byteOffsets move.
const idxView = mesh.idxAcc.bufferView;
const width = mesh.posAcc.count > 0xffff ? 4 : 2;
const newIdx = Buffer.alloc(welded.length * width);
for (let i = 0; i < welded.length; i++) {
  if (width === 2) newIdx.writeUInt16LE(welded[i], i * 2);
  else newIdx.writeUInt32LE(welded[i], i * 4);
}
const oldViews = json.bufferViews.map((_, v) => Buffer.from(viewBytes(json, bin, v)));
const parts = [];
let offset = 0;
json.bufferViews.forEach((view, v) => {
  const bytes = v === idxView ? newIdx : oldViews[v];
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { parts.push(Buffer.alloc(pad, 0)); offset += pad; }
  view.byteOffset = offset;
  view.byteLength = bytes.length;
  parts.push(bytes);
  offset += bytes.length;
});
const newBin = Buffer.concat(parts);
json.buffers[0].byteLength = newBin.length;
mesh.idxAcc.count = welded.length;
mesh.idxAcc.componentType = width === 2 ? UNSIGNED_SHORT : UNSIGNED_INT;
delete mesh.idxAcc.byteOffset;
mesh.idxAcc.min = [Math.min(...welded)];
mesh.idxAcc.max = [Math.max(...welded)];

writeGlb(GLB_PATH, json, newBin);
console.log('wrote', path.relative(ROOT, GLB_PATH), fs.statSync(GLB_PATH).size, 'bytes');

// Verify: every other bufferView unchanged, and no T-junctions left.
const check = readGlb(GLB_PATH);
let changed = 0;
check.json.bufferViews.forEach((_, v) => {
  if (v === idxView) return;
  if (!viewBytes(check.json, check.bin, v).equals(oldViews[v])) changed++;
});
const reread = findMesh(check.json, check.bin);
const remaining = countTJunctions(reread.positions, reread.indices, representatives(reread.positions));
console.log(`--- verify --- other bufferViews changed: ${changed} (expect 0); ${MESH_NAME} triangles ${reread.indices.length / 3}, T-junctions ${remaining} (expect 0)`);
if (changed !== 0 || remaining !== 0) process.exit(1);
