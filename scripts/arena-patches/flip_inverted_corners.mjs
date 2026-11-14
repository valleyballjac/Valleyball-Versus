import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) { Promise.resolve(blob.arrayBuffer()).then((buf) => { this.result = buf; if (this.onloadend) this.onloadend(); }); }
    readAsDataURL(blob) { Promise.resolve(blob.arrayBuffer()).then((buf) => { const u8 = new Uint8Array(buf); let bin = ''; for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]); this.result = 'data:application/octet-stream;base64,' + Buffer.from(bin, 'binary').toString('base64'); if (this.onloadend) this.onloadend(); }); }
  };
}

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const IN = path.join(ROOT, 'public', 'models', 'arena.glb');
const DO_FLIP = process.argv.includes('--flip');

function toAB(p) { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
function load(ab) { return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej)); }
function exportGLB(gltf) { return new Promise((res, rej) => new GLTFExporter().parse(gltf.scene, (r) => res(r), (e) => rej(e), { binary: true })); }

function signature(mesh) {
  const g = mesh.geometry, p = g.getAttribute('position'), i = g.index;
  let h = 2166136261 >>> 0; const m = (n) => { h ^= n; h = Math.imul(h, 16777619) >>> 0; };
  for (let x = 0; x < p.array.length; x++) { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, p.array[x], true); m(d.getUint32(0, true)); }
  if (i) for (let x = 0; x < i.array.length; x++) m(i.array[x] >>> 0);
  return (h >>> 0).toString(16);
}

const gltf = await load(toAB(IN));
let colBarriers = null, colCourt = null, colGoals = null;
gltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  if (o.name === 'COL_Barriers') colBarriers = o;
  if (o.name === 'COL_Court') colCourt = o;
  if (o.name === 'COL_Goals') colGoals = o;
});
if (!colBarriers || !colCourt || !colGoals) { console.error('missing meshes'); process.exit(1); }

const sigCourt = signature(colCourt), sigGoals = signature(colGoals);

const g = colBarriers.geometry;
const pos = g.getAttribute('position');
const idx = g.index;
const tcount = idx.count / 3;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _n = new THREE.Vector3();

// classify every triangle: normal, centroid, corner quadrant
const inverted = []; // { t, ny, cxx, cyy, czz, corner }
const cornerTotals = { NE: 0, NW: 0, SE: 0, SW: 0 };
const allFloor = [];
for (let t = 0; t < tcount; t++) {
  _a.fromBufferAttribute(pos, idx.getX(t * 3));
  _b.fromBufferAttribute(pos, idx.getY(t * 3));
  _c.fromBufferAttribute(pos, idx.getZ(t * 3));
  _ab.subVectors(_b, _a); _ac.subVectors(_c, _a); _n.crossVectors(_ab, _ac);
  const len = _n.length(); _n.divideScalar(len || 1);
  const cx = (_a.x + _b.x + _c.x) / 3;
  const cy = (_a.y + _b.y + _c.y) / 3;
  const cz = (_a.z + _b.z + _c.z) / 3;
  const corner = (cx < 0 ? (cz < 0 ? 'NW' : 'SW') : (cz < 0 ? 'NE' : 'SE'));
  // floor/ramp triangles: centroid y in [10,14] with meaningful vertical component
  if (cy >= 10.0 && cy <= 14.0 && Math.abs(_n.y) > 0.05) {
    allFloor.push({ t, corner, ny: _n.y, cx, cy, cz });
    cornerTotals[corner]++;
  }
  if (cy >= 10.0 && cy <= 14.0 && _n.y < -0.05) {
    inverted.push({ t, corner, ny: _n.y, cx, cy, cz });
  }
}

console.log('COL_Barriers total tris:', tcount);
console.log('floor/ramp tris (cy 10..14, |ny|>0.05) per corner:', JSON.stringify(cornerTotals));
console.log('inverted (ny < -0.05) count:', inverted.length, '(expect 64)');
const byCorner = {};
for (const iv of inverted) byCorner[iv.corner] = (byCorner[iv.corner] || 0) + 1;
console.log('inverted by corner:', JSON.stringify(byCorner), '(expect NW:32, SE:32)');

// sanity: centroid y of inverted triangles
const ys = inverted.map((iv) => iv.cy);
console.log('inverted centroid y range:', Math.min(...ys).toFixed(3), '..', Math.max(...ys).toFixed(3));

if (!DO_FLIP) { process.exit(0); }

// verify the exact expected partition before mutating
if (inverted.length !== 64) { console.error('UNEXPECTED inverted count, abort'); process.exit(1); }
if (byCorner.NW !== 32 || byCorner.SE !== 32) { console.error('UNEXPECTED corner partition, abort'); process.exit(1); }

// flip winding: swap index 1 and index 2 for each inverted triangle
for (const iv of inverted) {
  const i1 = idx.getY(iv.t * 3);
  const i2 = idx.getZ(iv.t * 3);
  idx.setY(iv.t * 3, i2);
  idx.setZ(iv.t * 3, i1);
}
idx.needsUpdate = true;
g.computeVertexNormals();

const result = await exportGLB(gltf);
fs.copyFileSync(IN, path.join(ROOT, '_arena_pre_flip.glb'));
fs.writeFileSync(IN, Buffer.from(result));
console.log('wrote', IN, fs.statSync(IN).size, 'bytes');

// verify post-flip
const gltf2 = await load(toAB(IN));
let cb2 = null, cc2 = null, cg2 = null;
gltf2.scene.traverse((o) => { if (!o.isMesh) return; if (o.name === 'COL_Barriers') cb2 = o; if (o.name === 'COL_Court') cc2 = o; if (o.name === 'COL_Goals') cg2 = o; });
console.log('--- verify ---');
console.log('COL_Court unchanged:', signature(cc2) === sigCourt);
console.log('COL_Goals unchanged:', signature(cg2) === sigGoals);

const g2 = cb2.geometry, pos2 = g2.getAttribute('position'), idx2 = g2.index;
const _a2 = new THREE.Vector3(), _b2 = new THREE.Vector3(), _c2 = new THREE.Vector3();
const _ab2 = new THREE.Vector3(), _ac2 = new THREE.Vector3(), _n2 = new THREE.Vector3();
const tcount2 = idx2.count / 3;
let remainingInverted = 0;
const remainingByCorner = { NE: 0, NW: 0, SE: 0, SW: 0 };
const cornerNyMin = { NE: 1, NW: 1, SE: 1, SW: 1 };
for (let t = 0; t < tcount2; t++) {
  _a2.fromBufferAttribute(pos2, idx2.getX(t * 3));
  _b2.fromBufferAttribute(pos2, idx2.getY(t * 3));
  _c2.fromBufferAttribute(pos2, idx2.getZ(t * 3));
  _ab2.subVectors(_b2, _a2); _ac2.subVectors(_c2, _a2); _n2.crossVectors(_ab2, _ac2);
  const len2 = _n2.length(); _n2.divideScalar(len2 || 1);
  const cx = (_a2.x + _b2.x + _c2.x) / 3;
  const cy = (_a2.y + _b2.y + _c2.y) / 3;
  const cz = (_a2.z + _b2.z + _c2.z) / 3;
  if (cy < 10.0 || cy > 14.0) continue;
  if (Math.abs(_n2.y) <= 0.05) continue; // vertical wall, ignore
  const corner = (cx < 0 ? (cz < 0 ? 'NW' : 'SW') : (cz < 0 ? 'NE' : 'SE'));
  cornerNyMin[corner] = Math.min(cornerNyMin[corner], _n2.y);
  if (_n2.y < -0.05) { remainingInverted++; remainingByCorner[corner]++; }
}
console.log('remaining inverted floor tris:', remainingInverted, '(expect 0)');
console.log('remaining by corner:', JSON.stringify(remainingByCorner));
console.log('min ny per corner (floor/ramp):', JSON.stringify(cornerNyMin), '(all expect > 0)');