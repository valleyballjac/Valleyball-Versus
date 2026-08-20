/**
 * sweep-clips.mjs — run the ENGINE's own swing-twist decomposition over every
 * keyframe of every clip in a .glb, against the limits the rig actually
 * enforces. The delivered report used an approximation and said so; this uses
 * `qClampSwingTwist` from rig-math.js, which is the code that will do the
 * clamping at runtime, so the numbers are the ones that will really happen.
 */
import fs from 'node:fs';
import { qMul, qConj, qNormalize, qSwingTwist, swingAngle, twistAngle } from './rig-math.js';
import { DUMMY_LIMITS, DUMMY_HINGES } from './dummy-rig.js';

const buf = fs.readFileSync(process.argv[2]);
let off = 12; const chunks = [];
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  chunks.push({ type: buf.toString('ascii', off + 4, off + 8), data: buf.subarray(off + 8, off + 8 + len) });
  off += 8 + len + ((4 - (len % 4)) % 4);
}
const json = JSON.parse(chunks.find((c) => c.type === 'JSON').data.toString('utf8'));
const bin = chunks.find((c) => c.type.startsWith('BIN')).data;

const COMP = { 5126: [Float32Array, 4], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5121: [Uint8Array, 1], 5122: [Int16Array, 2] };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readAccessor(i) {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const [Arr, sz] = COMP[a.componentType];
  const n = NUM[a.type];
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  for (let k = 0; k < a.count; k++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push(new Arr(bin.buffer, bin.byteOffset + start + (k * n + c) * sz, 1)[0]);
    out.push(n === 1 ? row[0] : row);
  }
  return out;
}

const nodeName = json.nodes.map((n) => n.name);
const DEG = 180 / Math.PI;

/* Which bone carries each limited joint. The rig's bodies are named for the
   SEGMENT; the limit applies to that segment's rotation relative to its parent,
   which is exactly a bone's local rotation. */
const BONE_OF = {
  chest: 'spine_02', head: 'neck_01',
  upperarm_l: 'upperarm_l', upperarm_r: 'upperarm_r',
  hand_l: 'hand_l', hand_r: 'hand_r',
  thigh_l: 'thigh_l', thigh_r: 'thigh_r',
  foot_l: 'foot_l', foot_r: 'foot_r',
  forearm_l: 'lowerarm_l', forearm_r: 'lowerarm_r',
  calf_l: 'calf_l', calf_r: 'calf_r',
};
// Rest (bind) local rotations, from the node transforms.
const rest = new Map();
json.nodes.forEach((n, i) => {
  const r = n.rotation || [0, 0, 0, 1];
  rest.set(nodeName[i], { x: r[0], y: r[1], z: r[2], w: r[3] });
});

const worst = new Map();          // joint -> {deg, clip, t}
const note = (joint, deg, clip, t) => {
  const cur = worst.get(joint);
  if (!cur || deg > cur.deg) worst.set(joint, { deg, clip, t });
};

for (const anim of json.animations) {
  const byNode = new Map();
  for (const ch of anim.channels) {
    if (ch.target.path !== 'rotation') continue;
    const s = anim.samplers[ch.sampler];
    byNode.set(nodeName[ch.target.node], { times: readAccessor(s.input), vals: readAccessor(s.output) });
  }
  for (const [limitKey, bone] of Object.entries(BONE_OF)) {
    const track = byNode.get(bone);
    if (!track) continue;
    const r0 = rest.get(bone);
    for (let k = 0; k < track.vals.length; k++) {
      const v = track.vals[k];
      const q = qNormalize({ x: v[0], y: v[1], z: v[2], w: v[3] });
      // Rotation RELATIVE to the bind pose — the same quantity the rig limits.
      const d = qNormalize(qMul(q, qConj(r0)));
      const hinge = DUMMY_HINGES[limitKey];
      if (hinge) {
        // Signed rotation about the hinge axis.
        const ax = hinge.axis;
        const st = qSwingTwist(d, ax);
        let ang = twistAngle(st.twist, ax);
        const [lo, hi] = hinge.limits;
        const over = ang < lo ? (lo - ang) : ang > hi ? (ang - hi) : 0;
        if (over > 0) note(`${limitKey} (hinge)${ang < lo ? ' NEGATIVE' : ''}`, over * DEG, anim.name, track.times[k]);
      }
      const lim = DUMMY_LIMITS[limitKey];
      if (lim) {
        const st = qSwingTwist(d, { x: 0, y: 1, z: 0 });
        const sw = swingAngle(st.swing) * DEG;
        if (sw > lim.cone) note(`${limitKey} cone`, sw - lim.cone, anim.name, track.times[k]);
        const tw = twistAngle(st.twist, { x: 0, y: 1, z: 0 }) * DEG;
        const overTw = tw < lim.twist[0] ? lim.twist[0] - tw : tw > lim.twist[1] ? tw - lim.twist[1] : 0;
        if (overTw > 0) note(`${limitKey} twist`, overTw, anim.name, track.times[k]);
      }
    }
  }
}

console.log('=== worst excursion per limited joint (engine decomposition) ===');
const rows = [...worst.entries()].sort((a, b) => b[1].deg - a[1].deg);
if (!rows.length) console.log('  none — every clip is inside every limit');
for (const [j, w] of rows) {
  console.log(`  ${j.padEnd(24)} +${w.deg.toFixed(0).padStart(3)}°  worst in ${w.clip} @ ${w.t.toFixed(2)}s`);
}
