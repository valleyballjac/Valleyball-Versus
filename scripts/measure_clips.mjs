/**
 * CONTACT-FRAME MEASUREMENT for strike clips — offline forward kinematics
 * straight out of the GLB. No page, no physics, no project code.
 *
 * Committed on RULING G4.1 §10.1: this is the third clip family it has measured
 * (volley + spike in G4, the four kicks in G4.1, the spike per side after) and
 * it will measure the next one. Run it before authoring any strike window.
 *
 *     node scripts/measure_clips.mjs                 # every registered clip
 *     node scripts/measure_clips.mjs --fine kick     # + per-tick table
 *
 * ---------------------------------------------------------------------------
 * THE CONTACT RULE (G4.1 RULING §10.1 — the standing rule for every clip)
 *
 *   Among frames at or below (a low strike) / at or above (a high strike) the
 *   target height, keep those whose SIGNED forward velocity is at least 50% of
 *   that clip's peak forward velocity. The contact frame is the furthest reach
 *   among them.
 *
 * SIGNED, not speed: the low kick's fastest frame is 6.94 m/s at f 0.914, which
 * is the foot whipping BACK on the recovery. Speed magnitude selects it; signed
 * forward velocity rejects it. RELATIVE to the clip's own peak, so one rule
 * serves a 35-tick low kick and a 90-tick full kick without a second constant.
 *
 * WHY THE RULE EXISTS. G4 authored the volley at the argmax of hand height —
 * the top of the arc, where the hand has already stopped. A near-stationary
 * limb produces a contact force under Rapier's event threshold, so the strike
 * deflected the ball physically and never resolved: the HUD counted an attempt
 * and no hit. Taken literally ("maximum reach"), the G4.1 spec would have
 * selected the low kick's tick 20 — the apex, foot reversing — and reproduced
 * that bug exactly. QUALIFY_FRACTION is the guard, and it is NOT a TUNING
 * number: it belongs to the measurement, not to the game.
 *
 * WINDOWS (RULING §10.2). windowOpen and windowClose are the first and last
 * qualified tick of the contiguous run containing the contact frame — not
 * sweetTick ± N. Frames whose contact force cannot raise an event are not a
 * window.
 *
 * ---------------------------------------------------------------------------
 * THE L5 STRIP is applied exactly as animtarget.js applies it: the hips'
 * horizontal translation is pinned back to its bind value each frame and the
 * vertical is kept. In this rig the hips bone carries the root motion, so
 * pinning its horizontal IS the root strip. Every position below is from the
 * stripped pose — the pose the engine renders and the tracker drives toward.
 *
 * FORWARD is taken ONCE from the bind pose, not per frame from the twisting
 * pelvis: the athlete's facing in the engine comes from the motor's yaw, not
 * from the clip.
 *
 * AND IT IS TAKEN FROM THE TOES, not from the shoulder line, because a bone's
 * NAME cannot be trusted for handedness in this asset — the bones called Left
 * sit on the body's right (see SIDE_NAMES_MIRRORED in sim/autorig.js). Toes are
 * in front of ankles in every biped rig, which is a fact about feet rather than
 * about labels. Corroborated by the thumbs: Mixamo's T-pose is palms-down, so
 * both thumbs point forward, and they agree with the toes here.
 *
 * THIS WAS WRONG UNTIL THE SIDE BUG WAS FOUND. The script derived
 * `forward = up x right` from the shoulder line, and the correct relation is
 * `right x up` — for a person, forward = right x up, equivalently
 * right = up x forward. On THIS asset the two mistakes cancelled, because the
 * shoulder line it called "right" was actually the body's left, so every
 * forward, reach and contact number it has ever reported is correct. The
 * lateral column's sign was not, and on an unmirrored asset the whole thing
 * would have measured backwards. Both halves are fixed below.
 *
 * BONE NAMES. The exported rig spells them `mixamorigHips`, without the colon
 * that BONE_MAP carries; both spellings resolve here, as autorig does.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Fraction of a clip's peak forward velocity a frame must carry to qualify. */
const QUALIFY_FRACTION = 0.5;
/** Mean per-bone distance from the bind pose, under which a frame IS the bind pose. */
const BIND_EPS = 0.02;

const GLB = new URL('../public/models/character.glb', import.meta.url);

// ---------------------------------------------------------------------------
// WHAT GETS MEASURED.
//
// `limb`   the tracked bones, L and R. The take's own side is chosen by which
//          one actually moves — named, not assumed, because a clip called
//          "Left" can mean either the kicking limb or the direction.
// `side`   'auto'   pick the limb that travels furthest (a one-sided take)
//          'both'   report both limbs (a two-handed take)
// `facing` 'low'    the limb rises to meet a ball at or below the target
//          'high'   the limb comes down onto a ball at or above the target
// `elevationDeg` the row's own launch elevation. The gate is on the limb's
//          velocity ALONG that direction, not on forward alone — see dvel.
// `targets` the ball-CENTRE heights the contact is derived against, in metres.
//          A ball at rest has its centre at its own radius; the fixture carries
//          three (0.20 / 0.50 / 0.75).
// ---------------------------------------------------------------------------
const RESTING = [['small 0.4m', 0.20], ['medium 1.0m', 0.50], ['large 1.5m', 0.75]];
// The standing spike's hand ceiling is 1.60 m (measured), so an overhead target
// above that is not a ball this clip can meet. `null` means no height gate at
// all — the pure per-side comparison RULING §10.4 asks for.
const OVERHEAD = [['chest-high', 1.20], ['shoulder-high', 1.40], ['top of reach', 1.55], ['no height gate', null]];

const CLIPS = [
  // The control. Its answer is already known from G4 (clipStart 0.10), so a
  // change in this line means the method moved, not the asset.
  { name: 'Idle Two Hand Volley', limb: 'hand', side: 'both', facing: 'high', targets: OVERHEAD, elevationDeg: 55, control: true },

  { name: 'Idle Low Kick Left',   limb: 'foot', side: 'auto', facing: 'low',  targets: RESTING, elevationDeg: 50 },
  { name: 'Idle Low Kick Right',  limb: 'foot', side: 'auto', facing: 'low',  targets: RESTING, elevationDeg: 50 },
  { name: 'Idle Kick Left',       limb: 'foot', side: 'auto', facing: 'low',  targets: RESTING, elevationDeg: 50 },
  { name: 'Idle Kick Right',      limb: 'foot', side: 'auto', facing: 'low',  targets: RESTING, elevationDeg: 50 },

  { name: 'Standing Spike Left',  limb: 'hand', side: 'auto', facing: 'high', targets: OVERHEAD, elevationDeg: -18 },
  { name: 'Standing Spike Right', limb: 'hand', side: 'auto', facing: 'high', targets: OVERHEAD, elevationDeg: -18 },
];

const BONES = {
  foot: { L: 'mixamorig:LeftFoot', R: 'mixamorig:RightFoot' },
  hand: { L: 'mixamorig:LeftHand', R: 'mixamorig:RightHand' },
};

// ---------------------------------------------------------------------------

const buf = readFileSync(GLB);
const gltf = await new Promise((res, rej) => new GLTFLoader().parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));

const skinned = [];
gltf.scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
const skeleton = skinned[0].skeleton;
const root = gltf.scene;
const byName = new Map(skeleton.bones.map((b) => [b.name, b]));
const bone = (n) => {
  const b = byName.get(n) || byName.get(n.replace(':', ''));
  if (!b) throw new Error(`[measure] the rig has no bone ${n}`);
  return b;
};

const HIPS = bone('mixamorig:Hips');

root.updateMatrixWorld(true);
const _v = new THREE.Vector3();
const bindWorld = new Map();
for (const b of skeleton.bones) bindWorld.set(b.name, b.getWorldPosition(new THREE.Vector3()));
const bindHips = bindWorld.get(HIPS.name).clone();

let floorY = Infinity;
for (const p of bindWorld.values()) if (p.y < floorY) floorY = p.y;

const UP = new THREE.Vector3(0, 1, 0);

// FORWARD, anatomically: the toe is in front of the ankle. No name is trusted.
const FORWARD = new THREE.Vector3()
  .subVectors(bindWorld.get(bone('mixamorig:LeftToeBase').name), bindWorld.get(bone('mixamorig:LeftFoot').name));
FORWARD.y = 0;
FORWARD.normalize();
// RIGHT = up x forward. Face north with up overhead and east is on your right;
// `up x (0,0,1) = (1,0,0)` says the same thing in coordinates.
const right = new THREE.Vector3().crossVectors(UP, FORWARD).normalize();

// The corroboration, printed rather than assumed: in a palms-down T-pose both
// thumbs point forward. If this ever disagrees with the toes, the rig changed
// and every number below is suspect.
const thumbForward = bindWorld.get(bone('mixamorig:LeftHandThumb3').name).z
  > bindWorld.get(bone('mixamorig:LeftHandPinky3').name).z ? 1 : -1;
// And which way the NAMES run, so the reader can see it rather than infer it.
const namedLeftOnRight = bindWorld.get(bone('mixamorig:LeftHand').name).clone()
  .sub(bindWorld.get(bone('mixamorig:Hips').name)).dot(right) > 0;

const mixer = new THREE.AnimationMixer(root);

/** World position with the hips' horizontal pinned to bind — the L5 strip. */
function stripped(b, hipsNow) {
  b.getWorldPosition(_v);
  return new THREE.Vector3(_v.x - hipsNow.x + bindHips.x, _v.y, _v.z - hipsNow.z + bindHips.z);
}

function measure(spec) {
  const clip = gltf.animations.find((a) => a.name === spec.name);
  if (!clip) throw new Error(`[measure] no clip named ${spec.name}`);
  const action = mixer.clipAction(clip);
  mixer.stopAllAction();
  action.reset().play();

  const elev = (spec.elevationDeg ?? 0) * Math.PI / 180;
  const driveF = Math.cos(elev);
  const driveY = Math.sin(elev);

  const N = Math.round(clip.duration * 60);      // one sample per 60 Hz tick
  const step = clip.duration / N;
  const L = bone(BONES[spec.limb].L);
  const R = bone(BONES[spec.limb].R);
  const rows = [];

  for (let i = 0; i <= N; i += 1) {
    const t = Math.min(i * step, clip.duration - 1e-6);
    action.time = t;
    mixer.setTime(t);
    root.updateMatrixWorld(true);
    const hipsNow = HIPS.getWorldPosition(new THREE.Vector3());
    const hips = new THREE.Vector3(bindHips.x, hipsNow.y, bindHips.z);
    const row = { i, f: i / N, hips, L: stripped(L, hipsNow), R: stripped(R, hipsNow) };
    let dev = 0;
    for (const b of skeleton.bones) {
      b.getWorldPosition(_v);
      const bw = bindWorld.get(b.name);
      dev += Math.hypot(_v.x - hipsNow.x + bindHips.x - bw.x, _v.y - bw.y, _v.z - hipsNow.z + bindHips.z - bw.z);
    }
    row.dev = dev / skeleton.bones.length;
    rows.push(row);
  }

  for (const r of rows) {
    for (const s of ['L', 'R']) {
      const p = r[s];
      const d = new THREE.Vector3(p.x - r.hips.x, 0, p.z - r.hips.z);
      r[`y${s}`] = p.y - floorY;
      r[`fwd${s}`] = d.dot(FORWARD);
      r[`lat${s}`] = d.dot(right);
    }
  }
  // THE ANIMATED RANGE, found before any derivative is taken. A bind-pose frame
  // is not a frame the strike plays (clipStart/clipEnd trim them), and the snap
  // out of the bind pose is a one-tick jump of the entire rig: differencing
  // across it reported the volley's hand at 34 m/s. The central difference is
  // clamped to [head, tail], so the first animated frame gets a one-sided
  // derivative instead of a fictitious one.
  let head = 0;
  while (head < N && rows[head].dev < BIND_EPS) head += 1;
  let tail = N;
  while (tail > head && rows[tail].dev < BIND_EPS) tail -= 1;

  for (let i = 0; i <= N; i += 1) {
    const lo = Math.max(i <= tail && i >= head ? head : 0, i - 1);
    const hi = Math.min(i <= tail && i >= head ? tail : N, i + 1);
    const span = (hi - lo) * step;
    for (const s of ['L', 'R']) {
      rows[i][`spd${s}`] = rows[lo][s].distanceTo(rows[hi][s]) / span;
      rows[i][`fvel${s}`] = (rows[hi][`fwd${s}`] - rows[lo][`fwd${s}`]) / span;
      rows[i][`vvel${s}`] = (rows[hi][`y${s}`] - rows[lo][`y${s}`]) / span;
      // THE DRIVE COMPONENT: the limb's velocity along the direction this row
      // launches the ball (forward, pitched by the row's elevationDeg). This is
      // the generalisation of RULING §10.1's forward gate. Forward alone is
      // right for a kick, which drives forward and up; it is WRONG for a spike,
      // which drives forward and DOWN — a spiking hand at the contact frame is
      // travelling mostly downward, so a forward-only gate reads it as stopped.
      rows[i][`dvel${s}`] = rows[i][`fvel${s}`] * driveF + rows[i][`vvel${s}`] * driveY;
    }
  }
  return { clip, N, rows, head, tail };
}

/** The contact frame and the qualified span, per RULING §10.1 / §10.2. */
function contact(all, N, s, target, facing, head, tail) {
  // BIND FRAMES ARE EXCLUDED FROM EVERY DERIVATION. clipStart/clipEnd trim them
  // in the engine, so they are frames the strike never plays; worse, the snap
  // out of the bind pose into the first animated frame is a one-tick jump of
  // the whole rig, and differentiating across it reported the volley's hand at
  // 34 m/s. Measuring a frame the engine does not play is measuring nothing.
  const rows = all.filter((r) => r.i >= head && r.i <= tail);
  const peakFvel = Math.max(...rows.map((r) => r[`dvel${s}`]));
  const gate = QUALIFY_FRACTION * peakFvel;
  const inHeight = (r) => (target === null ? true : (facing === 'low' ? r[`y${s}`] <= target + 1e-9 : r[`y${s}`] >= target - 1e-9));
  // THE HEIGHT GATE PICKS THE CONTACT FRAME; THE VELOCITY GATE BOUNDS THE
  // WINDOW. They are different questions. "Which frame meets a ball at this
  // height" is geometry and depends on the ball. "Which ticks can deliver a
  // contact that raises an event at all" is the clip's own property, and it is
  // what a window is for — a foot 0.05 m above a ball's centre still strikes
  // the ball, so bounding the span by the height gate would close the window
  // while the limb is still out there and swinging.
  const driving = (r) => r[`dvel${s}`] >= gate;
  const qualifies = (r) => inHeight(r) && driving(r);

  const literal = rows.filter(inHeight).reduce((a, b) => (!a || b[`fwd${s}`] > a[`fwd${s}`] ? b : a), null);
  const pool = rows.filter(qualifies);
  if (!pool.length) return { peakFvel, gate, literal, best: null };

  const best = pool.reduce((a, b) => (b[`fwd${s}`] > a[`fwd${s}`] ? b : a));
  // The SPAN is the contiguous run of qualified frames containing the contact
  // frame, not the min/max over all qualified frames: a clip can qualify twice.
  const run = (test) => {
    let a = best.i;
    while (a > head && test(all[a - 1])) a -= 1;
    let b = best.i;
    while (b < tail && test(all[b + 1])) b += 1;
    return [a, b];
  };
  const [open, close] = run(driving);
  // The looser bound, reported beside it: the last tick before the limb
  // REVERSES. Between `close` and `reverseClose` the limb is still out in front
  // and still moving forward, just under half its peak — frames that will
  // physically touch a ball whether or not the window is open for them.
  const [openFwd, closeFwd] = run((r) => r[`dvel${s}`] > 0);
  return { peakFvel, gate, literal, best, open, close, openFwd, closeFwd };
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const fineFor = args.includes('--fine') ? (args[args.indexOf('--fine') + 1] || '') : null;

console.log(`floor (lowest bind-pose bone) y = ${floorY.toFixed(4)} m`);
console.log(`forward (bind, from the toes) = (${FORWARD.x.toFixed(3)}, ${FORWARD.y.toFixed(3)}, ${FORWARD.z.toFixed(3)})` +
  `  [thumbs agree: ${(thumbForward > 0) === (FORWARD.z > 0) ? 'yes' : 'NO — the rig changed'}]`);
console.log(`right (up x forward) = (${right.x.toFixed(3)}, ${right.y.toFixed(3)}, ${right.z.toFixed(3)})`);
console.log(`the bone named LeftHand is on the athlete's ${namedLeftOnRight ? 'RIGHT — this asset\'s side names are MIRRORED' : 'LEFT'}`);
console.log('  (so a clip named "Left" swings the limb the player sees on the right; "lat" below is signed toward the athlete\'s real right)');
console.log(`bind pelvis ${(bindHips.y - floorY).toFixed(4)} m above the floor`);
console.log(`contact rule: forward velocity >= ${(QUALIFY_FRACTION * 100).toFixed(0)}% of the clip's peak, furthest reach among those`);

for (const spec of CLIPS) {
  const { clip, N, rows, head, tail } = measure(spec);
  console.log(`\n${'='.repeat(78)}`);
  console.log(`=== ${spec.name}   ${clip.duration.toFixed(4)} s = ${(clip.duration * 60).toFixed(1)} ticks   ${spec.control ? '[CONTROL]' : ''}`);

  const travel = (s) => Math.max(...rows.map((r) => r[`y${s}`])) - rows[0][`y${s}`];
  const sides = spec.side === 'both' ? ['L', 'R'] : [travel('L') >= travel('R') ? 'L' : 'R'];
  console.log(`  limb: ${spec.limb}  travel L ${travel('L').toFixed(3)} m / R ${travel('R').toFixed(3)} m  -> tracking ${sides.join(' and ')}`);

  console.log(`  bind deviation: head ${rows[0].dev.toFixed(4)} m  tail ${rows[N].dev.toFixed(4)} m  (a bind frame reads 0.0000)`);
  console.log(`  bind frames: ${head} at the head -> clipStart >= ${(head / N).toFixed(3)};  ${N - tail} at the tail -> clipEnd <= ${(tail / N).toFixed(3)}`);

  for (const s of sides) {
    console.log(`  --- ${spec.limb}${s} ---`);
    console.log(`      profile per 5% (f | tick | height | forward reach | lateral | speed | forward vel):`);
    for (let pct = 0; pct <= 100; pct += 5) {
      const r = rows[Math.min(N, Math.round((pct / 100) * N))];
      console.log(`        ${(pct / 100).toFixed(2)}  t${String(r.i).padStart(3)}  y ${r[`y${s}`].toFixed(3)}  fwd ${r[`fwd${s}`] >= 0 ? ' ' : ''}${r[`fwd${s}`].toFixed(3)}  lat ${r[`lat${s}`] >= 0 ? ' ' : ''}${r[`lat${s}`].toFixed(3)}  spd ${r[`spd${s}`].toFixed(2)}  fvel ${r[`fvel${s}`] >= 0 ? ' ' : ''}${r[`fvel${s}`].toFixed(2)}`);
    }
    const played = rows.filter((r) => r.i >= head && r.i <= tail);
    const peakSpd = played.reduce((a, b) => (b[`spd${s}`] > a[`spd${s}`] ? b : a));
    const peakFwd = played.reduce((a, b) => (b[`fwd${s}`] > a[`fwd${s}`] ? b : a));
    console.log(`      ceiling ${Math.max(...played.map((r) => r[`y${s}`])).toFixed(3)} m   peak speed ${peakSpd[`spd${s}`].toFixed(2)} m/s at tick ${peakSpd.i} (fwd vel ${peakSpd[`fvel${s}`].toFixed(2)})   peak reach ${peakFwd[`fwd${s}`].toFixed(3)} m at tick ${peakFwd.i}`);

    for (const [label, target] of spec.targets) {
      const c = contact(rows, N, s, target, spec.facing, head, tail);
      const at = (r) => `f=${r.f.toFixed(3)} tick ${String(r.i).padStart(2)}  fwd ${r[`fwd${s}`] >= 0 ? ' ' : ''}${r[`fwd${s}`].toFixed(3)} m  y ${r[`y${s}`].toFixed(3)} m  spd ${r[`spd${s}`].toFixed(2)}  fwdVel ${r[`fvel${s}`] >= 0 ? ' ' : ''}${r[`fvel${s}`].toFixed(2)}  vertVel ${r[`vvel${s}`] >= 0 ? ' ' : ''}${r[`vvel${s}`].toFixed(2)}  DRIVE ${r[`dvel${s}`] >= 0 ? ' ' : ''}${r[`dvel${s}`].toFixed(2)} m/s`;
      const where = target === null ? 'any height' : `centre ${target.toFixed(2)} m, ${spec.facing}`;
      console.log(`      ${label} (${where}) — drive gate ${c.gate.toFixed(2)} m/s (50% of peak drive ${c.peakFvel.toFixed(2)}):`);
      if (!c.literal) { console.log('        no frame at the target height at all'); continue; }
      const trap = c.literal[`dvel${s}`] < c.gate;
      console.log(`        literal max reach : ${at(c.literal)}${trap ? '   <-- NOT DRIVING: the G4 volley trap' : ''}`);
      if (!c.best) { console.log('        qualified         : NONE — no frame is both at the target height and driving'); continue; }
      const climb = c.best.f / (c.best.i / 60);
      console.log(`        qualified         : ${at(c.best)}`);
      console.log(`        ->  holdPoint ${c.best.f.toFixed(3)}   window [${c.open}, ${c.best.i}, ${c.close}]   climbRate ${climb.toFixed(2)} (1x)`);
      console.log(`        span at the gate  : [${c.open}, ${c.close}]   span while still driving forward at all: [${c.openFwd}, ${c.closeFwd}]`);
    }

    if (fineFor && spec.name.toLowerCase().includes(fineFor.toLowerCase())) {
      console.log('      per tick:');
      for (const r of rows) {
        console.log(`        t${String(r.i).padStart(3)}  f=${r.f.toFixed(3)}  y ${r[`y${s}`].toFixed(3)}  fwd ${r[`fwd${s}`] >= 0 ? ' ' : ''}${r[`fwd${s}`].toFixed(3)}  spd ${r[`spd${s}`].toFixed(2)}  fvel ${r[`fvel${s}`] >= 0 ? ' ' : ''}${r[`fvel${s}`].toFixed(2)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// MIRROR CHECK — is an L/R pair two performances, or one and its reflection?
//
// It decides whether a row needs per-side timing fields. Compare each pair
// track by track after swapping Left/Right in the track names and negating the
// mirror axis (position x; quaternion y and z). Scale tracks are skipped —
// they are uniform +1 and negating x on them is meaningless, which was worth
// finding out, because it read as a 2.000 residual on every pair.
// ---------------------------------------------------------------------------
const CHAINS = [
  ['arms', /Shoulder|Arm|ForeArm|Hand/],
  ['legs', /UpLeg|Leg|Foot|Toe/],
  ['spine', /Hips|Spine|Neck|Head/],
];
const swapSide = (n) => n.replace(/Left|Right/g, (m) => (m === 'Left' ? 'Right' : 'Left'));

function mirrorDiff(a, b) {
  const other = new Map(b.tracks.map((t) => [t.name, t]));
  const byChain = new Map(CHAINS.map(([n]) => [n, 0]));
  let worst = 0;
  let worstName = '';
  let compared = 0;
  let unmatched = 0;
  for (const t of a.tracks) {
    if (t.name.endsWith('.scale')) continue;
    const o = other.get(swapSide(t.name));
    if (!o || o.values.length !== t.values.length) { unmatched += 1; continue; }
    compared += 1;
    const isQuat = t.name.endsWith('.quaternion');
    const stride = isQuat ? 4 : 3;
    for (let i = 0; i < t.values.length; i += stride) {
      for (let c = 0; c < stride; c += 1) {
        const flip = isQuat ? ((c === 1 || c === 2) ? -1 : 1) : (c === 0 ? -1 : 1);
        const d = Math.abs(t.values[i + c] * flip - o.values[i + c]);
        if (d > worst) { worst = d; worstName = t.name; }
        for (const [n, re] of CHAINS) if (re.test(t.name) && d > byChain.get(n)) byChain.set(n, d);
      }
    }
  }
  return { worst, worstName, compared, unmatched, byChain };
}

const PAIRS = [
  ['Idle Low Kick Left', 'Idle Low Kick Right'],
  ['Idle Kick Left', 'Idle Kick Right'],
  ['Standing Spike Left', 'Standing Spike Right'],
  ['Bash Hit Left', 'Bash Hit Right'],
];

console.log(`\n${'='.repeat(78)}`);
console.log('=== MIRROR CHECK — one take reflected, or two takes?');
for (const [x, y] of PAIRS) {
  const A = gltf.animations.find((a) => a.name === x);
  const B = gltf.animations.find((a) => a.name === y);
  if (!A || !B) continue;
  const m = mirrorDiff(A, B);
  console.log(`  ${x}  vs  ${y}`);
  console.log(`    ${m.compared} tracks compared, ${m.unmatched} unmatched; worst residual ${m.worst.toExponential(3)} on ${m.worstName}`);
  console.log(`    by chain: ${[...m.byChain].map(([n, v]) => `${n} ${v.toExponential(2)}`).join('   ')}`);
}
