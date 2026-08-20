/**
 * glb-read.mjs — minimal GLB reader, enough to get a skeleton and sampled clip
 * poses out of a file without three.js. Exists so the retarget can be tested
 * against the REAL delivered asset offline, rather than against a hand-made
 * fixture that agrees with whatever the code happens to do.
 */
import fs from 'node:fs';

const COMP = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array, 5122: Int16Array };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function readGLB(path) {
  const buf = fs.readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${path} is not a GLB`);
  let off = 12; const chunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    chunks.push({ type: buf.toString('ascii', off + 4, off + 8), data: buf.subarray(off + 8, off + 8 + len) });
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  const json = JSON.parse(chunks.find((c) => c.type === 'JSON').data.toString('utf8'));
  const binChunk = chunks.find((c) => c.type.startsWith('BIN'));
  const bin = binChunk ? binChunk.data : null;

  const accessor = (i) => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const Arr = COMP[a.componentType];
    const n = NUM[a.type];
    const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const view = new Arr(bin.buffer, bin.byteOffset + start, a.count * n);
    const out = [];
    for (let k = 0; k < a.count; k++) out.push(n === 1 ? view[k] : Array.from(view.subarray(k * n, k * n + n)));
    return out;
  };

  const names = json.nodes.map((n) => n.name);
  const parent = new Map();
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => parent.set(names[c], names[i])));

  /** Local rest transforms, as `worldRotations` wants them. */
  const nodes = json.nodes.map((n, i) => ({
    name: names[i],
    parent: parent.get(names[i]) || null,
    rotation: n.rotation
      ? { x: n.rotation[0], y: n.rotation[1], z: n.rotation[2], w: n.rotation[3] }
      : { x: 0, y: 0, z: 0, w: 1 },
    translation: n.translation || [0, 0, 0],
  }));

  const animations = (json.animations || []).map((a) => {
    const tracks = new Map();
    let duration = 0;
    for (const ch of a.channels) {
      if (ch.target.path !== 'rotation') continue;
      const s = a.samplers[ch.sampler];
      const times = accessor(s.input);
      const vals = accessor(s.output);
      duration = Math.max(duration, times[times.length - 1] || 0);
      tracks.set(names[ch.target.node], { times, vals });
    }
    return { name: a.name, duration, tracks };
  });

  return {
    json, nodes, names, animations,
    meshes: (json.meshes || []).length,
    skins: (json.skins || []).length,
    materials: (json.materials || []).length,
  };
}

/** Nearest-key sample (no slerp): enough to check frames and limits. */
export function sampleClip(glb, clipName, t) {
  const clip = glb.animations.find((a) => a.name === clipName);
  if (!clip) return null;
  const out = new Map();
  for (const [bone, tr] of clip.tracks) {
    let k = 0;
    while (k < tr.times.length - 1 && tr.times[k + 1] <= t) k++;
    const v = tr.vals[k];
    out.set(bone, { x: v[0], y: v[1], z: v[2], w: v[3] });
  }
  return out;
}

/** Local rotations at time t, composed to world using the file's hierarchy. */
export function sampleWorld(glb, clipName, t, worldRotations) {
  const local = sampleClip(glb, clipName, t);
  if (!local) return null;
  const nodes = glb.nodes.map((n) => ({
    name: n.name, parent: n.parent,
    rotation: local.get(n.name) || n.rotation,
  }));
  return worldRotations(nodes);
}
