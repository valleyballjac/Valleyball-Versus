/**
 * inspect-glb.mjs — read a .glb's JSON chunk and report what is ACTUALLY in it.
 * Deliberately dependency-free and deliberately blunt: the question this answers
 * is "can this file replace the dummy", and that question has to be settled
 * from the bytes rather than from a covering note.
 */
import fs from 'node:fs';
const FILE = process.argv[2];
const buf = fs.readFileSync(FILE);
if (buf.toString('ascii', 0, 4) !== 'glTF') { console.log('not a GLB'); process.exit(1); }
let off = 12; const chunks = [];
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
  off += 8 + len + ((4 - (len % 4)) % 4);
}
const json = JSON.parse(chunks.find((c) => c.type === 'JSON').data.toString('utf8'));
const bin = chunks.find((c) => c.type.startsWith('BIN'));
console.log('=== FILE ===');
console.log('generator :', json.asset && json.asset.generator);
console.log('version   :', json.asset && json.asset.version);
console.log('BIN chunk :', bin ? `${(bin.data.length / 1024).toFixed(0)} kB` : 'NONE');
console.log('buffers   :', (json.buffers || []).map((b) => b.uri || 'embedded').join(', ') || 'none');
console.log('images    :', (json.images || []).length, (json.images || []).map((i) => i.uri || 'embedded').join(','));
console.log('materials :', (json.materials || []).length);
console.log('meshes    :', (json.meshes || []).length);
console.log('skins     :', (json.skins || []).length);
console.log('nodes     :', (json.nodes || []).length);
console.log('animations:', (json.animations || []).length);

let tris = 0, hasSkinAttrs = false;
for (const m of json.meshes || []) {
  for (const p of m.primitives || []) {
    if (p.indices !== undefined) tris += Math.floor(json.accessors[p.indices].count / 3);
    else if (p.attributes.POSITION !== undefined) tris += Math.floor(json.accessors[p.attributes.POSITION].count / 3);
    if (p.attributes.JOINTS_0 !== undefined && p.attributes.WEIGHTS_0 !== undefined) hasSkinAttrs = true;
  }
}
console.log('triangles :', tris);
console.log('skin attrs:', hasSkinAttrs);

console.log('\n=== ANIMATIONS ===');
for (const a of json.animations || []) {
  let maxT = 0, tracks = a.channels.length;
  const paths = {};
  for (const ch of a.channels) {
    paths[ch.target.path] = (paths[ch.target.path] || 0) + 1;
    const acc = json.accessors[a.samplers[ch.sampler].input];
    if (acc.max) maxT = Math.max(maxT, acc.max[0]);
  }
  console.log(`  ${(a.name || '(unnamed)').padEnd(16)} ${maxT.toFixed(2)}s  ${String(tracks).padStart(3)} ch  ${JSON.stringify(paths)}`);
}
fs.writeFileSync('/tmp/glb.json', JSON.stringify(json));
