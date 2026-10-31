import fs from 'fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// Node lacks FileReader; GLTFExporter uses it for buffer/GLB assembly.
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
  const g = mesh.geometry;
  const pos = g.getAttribute('position').array;
  const idx = g.index ? g.index.array : null;
  let h = 2166136261 >>> 0;
  const mix = (n) => { h ^= n; h = Math.imul(h, 16777619) >>> 0; };
  for (let i = 0; i < pos.length; i++) {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, pos[i], true);
    mix(dv.getUint32(0, true));
  }
  if (idx) for (let i = 0; i < idx.length; i++) mix(idx[i] >>> 0);
  return (h >>> 0).toString(16);
}

async function loadGLB(ab) {
  const loader = new GLTFLoader();
  return new Promise((res, rej) => loader.parse(ab, '', res, rej));
}

function exportGLB(gltf) {
  const exporter = new GLTFExporter();
  return new Promise((res, rej) => {
    exporter.parse(gltf.scene, (r) => res(r), (e) => rej(e), { binary: true });
  });
}

function stats(gltf) {
  let meshes = 0, tris = 0;
  const imgs = new Set();
  const mats = new Set();
  gltf.scene.traverse((o) => {
    if (o.isMesh) { meshes++; tris += o.geometry.index ? o.geometry.index.count / 3 : 0; }
  });
  // count images/materials via parser refs
  const p = gltf.parser;
  const json = p && p.json;
  return {
    meshes, tris,
    images: json && json.images ? json.images.length : '?',
    materials: json && json.materials ? json.materials.length : '?',
    textures: json && json.textures ? json.textures.length : '?',
    accessors: json && json.accessors ? json.accessors.length : '?',
  };
}

(async () => {
  const gltf = await loadGLB(toAB(GLB_IN));

  let colCourt = null, colGoals = null, colBarriers = null, visField = null;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === 'COL_Court') colCourt = o;
    if (o.name === 'COL_Goals') colGoals = o;
    if (o.name === 'COL_Barriers') colBarriers = o;
    if (o.name === 'VIS_Inner_Field_Organic') visField = o;
  });
  if (!colBarriers) { console.error('COL_Barriers not found'); process.exit(1); }

  const sigCourt = signature(colCourt);
  const sigGoals = signature(colGoals);
  const sigVisField = signature(visField);
  console.log('before stats:', JSON.stringify(stats(gltf)));

  const g = colBarriers.geometry;
  const posAttr = g.getAttribute('position');
  const posArr = posAttr.array;
  const idxArr = g.index.array;
  const baseV = posArr.length / posAttr.itemSize;

  const newVerts = [
    [-25, 6, -60], [25, 6, -60], [25, 13, -60], [0, 11, -60], [-25, 13, -60],
    [25, 6, 60], [-25, 6, 60], [-25, 13, 60], [0, 11, 60], [25, 13, 60],
  ];
  const flat = [];
  for (const v of newVerts) flat.push(v[0], v[1], v[2]);

  const newPos = new Float32Array(posArr.length + flat.length);
  newPos.set(posArr, 0);
  newPos.set(flat, posArr.length);

  const T = (a, b, c) => [baseV + a, baseV + b, baseV + c];
  const tris = [
    T(0, 1, 2), T(0, 2, 3), T(0, 3, 4),
    T(0, 2, 1), T(0, 3, 2), T(0, 4, 3),
    T(5, 6, 7), T(5, 7, 8), T(5, 8, 9),
    T(5, 7, 6), T(5, 8, 7), T(5, 9, 8),
  ];
  const flatIdx = [];
  for (const t of tris) flatIdx.push(t[0], t[1], t[2]);

  const newIdx = new (idxArr.constructor)(idxArr.length + flatIdx.length);
  newIdx.set(idxArr, 0);
  newIdx.set(flatIdx, idxArr.length);

  g.setAttribute('position', new THREE.BufferAttribute(newPos, posAttr.itemSize, false));
  g.setIndex(new THREE.BufferAttribute(newIdx, 1));

  // drop unused per-vertex attributes (uv, vertex colors) that no longer match vertex count
  for (const k of ['uv', 'color', 'color_1', 'tangent']) {
    if (g.getAttribute(k)) { g.deleteAttribute(k); console.log('  dropped attr', k); }
  }
  if (g.getAttribute('normal')) g.deleteAttribute('normal');
  g.computeVertexNormals();

  console.log('COL_Barriers verts', baseV, '->', g.getAttribute('position').count,
    'tris', idxArr.length / 3, '->', g.index.count / 3);

  const result = await exportGLB(gltf);
  fs.writeFileSync(GLB_OUT, Buffer.from(result));
  console.log('wrote', GLB_OUT, fs.statSync(GLB_OUT).size, 'bytes');

  const gltf2 = await loadGLB(toAB(GLB_OUT));
  let cc2 = null, cg2 = null, cb2 = null, vf2 = null;
  gltf2.scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === 'COL_Court') cc2 = o;
    if (o.name === 'COL_Goals') cg2 = o;
    if (o.name === 'COL_Barriers') cb2 = o;
    if (o.name === 'VIS_Inner_Field_Organic') vf2 = o;
  });
  console.log('--- verify ---');
  console.log('COL_Court unchanged:', signature(cc2) === sigCourt);
  console.log('COL_Goals unchanged:', signature(cg2) === sigGoals);
  console.log('VIS_Inner_Field_Organic unchanged:', signature(vf2) === sigVisField);
  console.log('COL_Barriers verts now:', cb2.geometry.getAttribute('position').count,
    'tris now:', cb2.geometry.index.count / 3);
  console.log('after stats:', JSON.stringify(stats(gltf2)));
})().catch((e) => { console.error(e); process.exit(1); });