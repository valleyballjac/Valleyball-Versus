import fs from 'fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// Node lacks FileReader; GLTFExporter uses it for GLB assembly.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      Promise.resolve(blob.arrayBuffer()).then((buf) => {
        this.result = buf;
        if (this.onloadend) this.onloadend();
      });
    }
    readAsDataURL(blob) {
      Promise.resolve(blob.arrayBuffer()).then((buf) => {
        const u8 = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
        this.result = 'data:application/octet-stream;base64,' + Buffer.from(bin, 'binary').toString('base64');
        if (this.onloadend) this.onloadend();
      });
    }
  };
}

const GLB_IN = process.argv[2];
const GLB_OUT = process.argv[3];

function toAB(path) {
  const b = fs.readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

function signature(mesh) {
  if (!mesh || !mesh.geometry) return 'none';
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const idx = g.index;
  let h = 2166136261 >>> 0;
  const mix = (n) => { h ^= n; h = Math.imul(h, 16777619) >>> 0; };
  if (pos) for (let i = 0; i < pos.array.length; i++) {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, pos.array[i], true);
    mix(dv.getUint32(0, true));
  }
  if (idx) for (let i = 0; i < idx.array.length; i++) mix(idx.array[i] >>> 0);
  return (h >>> 0).toString(16);
}

function loadGLB(ab) {
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}
function exportGLB(gltf) {
  return new Promise((res, rej) => new GLTFExporter().parse(gltf.scene, res, rej, { binary: true }));
}

(async () => {
  const gltf = await loadGLB(toAB(GLB_IN));
  const before = {};
  gltf.scene.traverse((o) => {
    if (o.isMesh) before[o.name] = signature(o);
  });

  let colBarriers = null;
  gltf.scene.traverse((o) => { if (o.isMesh && o.name === 'COL_Barriers') colBarriers = o; });
  if (!colBarriers) { console.error('COL_Barriers not found'); process.exit(1); }

  const g = colBarriers.geometry;
  const pos = g.getAttribute('position');
  const P = pos.array;
  const idx = g.index;
  const I = idx.array;

  // Identify chamfer triangles: y band [13,18] at ~45 degrees.
  // (y in [12.5,18.5] AND face angle in [40,50].)
  const isChamfer = (t) => {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ax = P[a*3], ay = P[a*3+1], az = P[a*3+2];
    const bx = P[b*3], by = P[b*3+1], bz = P[b*3+2];
    const cx = P[c*3], cy = P[c*3+1], cz = P[c*3+2];
    const ymin = Math.min(ay, by, cy), ymax = Math.max(ay, by, cy);
    if (!(ymin >= 12.5 && ymax <= 18.5)) return false;
    const ex = bx-ax, ey = by-ay, ez = bz-az;
    const fx = cx-ax, fy = cy-ay, fz = cz-az;
    const nx = ey*fz - ez*fy, ny = ez*fx - ex*fz, nz = ex*fy - ey*fx;
    const L = Math.hypot(nx, ny, nz) || 1;
    const ang = Math.acos(Math.min(1, Math.abs(ny) / L)) * 180 / Math.PI;
    if (!(ang >= 40 && ang <= 50)) return false;
    // Restrict to the BACK chamfer band (z = +-60..65, behind the goal):
    // centroid |z| >= 55 AND |x| < 20. The side chamfer (|x|>=25, |z|<55) and
    // corner chamfer (|x|>=25 AND |z|>=55) actually seal the corner approach
    // below y=18 and must be left in place.
    const gx = (ax + bx + cx) / 3;
    const gz = (az + bz + cz) / 3;
    return Math.abs(gx) < 20 && Math.abs(gz) >= 55;
  };

  const keep = [];
  let deleted = 0;
  for (let t = 0; t < I.length; t += 3) {
    if (isChamfer(t)) { deleted++; continue; }
    keep.push(I[t], I[t + 1], I[t + 2]);
  }
  console.log('chamfer triangles deleted:', deleted);

  // New vertical double-sided seal wall at z=+-60, valley rim up to y=38.
  const baseV = P.length / 3;
  const newVerts = [
    [0, 11, -60], [25, 13, -60], [-25, 13, -60], [25, 38, -60], [-25, 38, -60],
    [0, 11, 60], [25, 13, 60], [-25, 13, 60], [25, 38, 60], [-25, 38, 60],
  ];
  const flat = [];
  for (const v of newVerts) flat.push(v[0], v[1], v[2]);
  const newPos = new Float32Array(P.length + flat.length);
  newPos.set(P, 0);
  newPos.set(flat, P.length);

  const T = (a, b, c) => [baseV + a, baseV + b, baseV + c];
  // N(z=-60): B=0,A=1,C=2,D=3,E=4. S(z=60): B=5,A=6,C=7,D=8,E=9.
  const tris = [
    // N front (+z normal) + back
    T(0,1,3), T(0,3,4), T(0,4,2),
    T(0,3,1), T(0,4,3), T(0,2,4),
    // S front (-z normal) + back
    T(5,8,6), T(5,9,8), T(5,7,9),
    T(5,6,8), T(5,8,9), T(5,9,7),
  ];
  const newIdx = new I.constructor(keep.length + tris.length * 3);
  newIdx.set(keep, 0);
  let o = keep.length;
  for (const t of tris) { newIdx[o++] = t[0]; newIdx[o++] = t[1]; newIdx[o++] = t[2]; }

  g.setAttribute('position', new THREE.BufferAttribute(newPos, 3, false));
  g.setIndex(new THREE.BufferAttribute(newIdx, 1));

  for (const k of ['uv', 'color', 'color_1', 'tangent', 'normal']) {
    if (g.getAttribute(k)) g.deleteAttribute(k);
  }

  console.log('COL_Barriers verts', baseV, '->', newPos.length / 3, 'tris', I.length/3, '->', newIdx.length / 3);

  const result = await exportGLB(gltf);
  fs.writeFileSync(GLB_OUT, Buffer.from(result));
  console.log('wrote', GLB_OUT, fs.statSync(GLB_OUT).size, 'bytes (input', fs.statSync(GLB_IN).size, 'bytes)');

  // Verify ONLY COL_Barriers changed.
  const gltf2 = await loadGLB(toAB(GLB_OUT));
  let changed = [];
  gltf2.scene.traverse((o) => {
    if (o.isMesh && before[o.name] !== undefined && o.name !== 'COL_Barriers') {
      if (signature(o) !== before[o.name]) changed.push(o.name);
    }
  });
  console.log('unexpectedly-changed meshes:', changed.length ? changed : 'none');
  let cb2 = null;
  gltf2.scene.traverse((o) => { if (o.isMesh && o.name === 'COL_Barriers') cb2 = o; });
  console.log('COL_Barriers verts now:', cb2.geometry.getAttribute('position').count, 'tris:', cb2.geometry.index.count / 3);
})().catch((e) => { console.error(e); process.exit(1); });