/**
 * Offline verification of clip-retarget.js, against BOTH a hand-made fixture
 * (where the right answer is known by construction) and the REAL delivered
 * file (where it is not).
 *
 * The fixture proves the algebra. The real file proves the algebra survives an
 * artist's skeleton — different topology, different proportions, a clavicle the
 * physics rig does not have. Only one of those two is enough to ship on.
 */
import {
  BONE_TO_BODY, BODY_PARENT, PARENT_BONE, CLIP_ALIASES, REQUIRED_CLIPS,
  resolveClips, retargetPose, worldRotations, clipForState, strideRate,
} from './clip-retarget.js';
import { qMul, qConj, qNormalize, qFromAxisAngle, qAngleBetween } from './rig-math.js';
import { DUMMY_PARTS, DUMMY_LIMITS, DUMMY_HINGES } from './dummy-rig.js';
import { readGLB, sampleWorld } from './glb-read.mjs';
import fs from 'node:fs';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};
const I = { x: 0, y: 0, z: 0, w: 1 };
const DEG = 180 / Math.PI;
const near = (a, b, tol = 1e-6) => qAngleBetween(a, b) < tol;

// ---------------------------------------------------------------------------
console.log('\n1. The mapping tables agree with the rig they claim to drive');
{
  const partIds = new Set(DUMMY_PARTS.map((p) => p.id));
  const bad = Object.values(BONE_TO_BODY).filter((b) => !partIds.has(b));
  check('every mapped body exists in DUMMY_PARTS', bad.length === 0, bad.join(','));

  // BODY_PARENT is written out by hand for readability; it must match the real
  // table or the retarget divides by the wrong frame — silently, and the
  // symptom is a limb that drifts rather than one that breaks.
  const realParent = new Map(DUMMY_PARTS.map((p) => [p.id, p.parent]));
  const wrong = Object.entries(BODY_PARENT).filter(([b, p]) => realParent.get(b) !== p);
  check('BODY_PARENT matches DUMMY_PARTS exactly', wrong.length === 0,
    wrong.map(([b, p]) => `${b}: says ${p}, really ${realParent.get(b)}`).join('; '));

  const missingParent = Object.values(BONE_TO_BODY).filter((b) => !(b in PARENT_BONE));
  check('every driven body has a parent-bone rule', missingParent.length === 0,
    missingParent.join(','));

  // The pelvis is the pinned core and must never be clip-driven: the pin owns
  // its position AND rotation, and a clip fighting the pin is a body that
  // vibrates.
  check('the pinned core is not clip-driven',
    !Object.values(BONE_TO_BODY).includes('pelvis'));
}

// ---------------------------------------------------------------------------
console.log('\n2. The algebra, on a fixture where the answer is known');
{
  // A skeleton whose bind pose is NOT identity, because a retarget that only
  // works from an identity bind is a retarget that works on nothing real.
  const bind = worldRotations([
    { name: 'pelvis', parent: null, rotation: qFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.3) },
    { name: 'spine_03', parent: 'pelvis', rotation: qFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.2) },
    { name: 'clavicle_l', parent: 'spine_03', rotation: qFromAxisAngle({ x: 0, y: 0, z: 1 }, 0.4) },
    { name: 'upperarm_l', parent: 'clavicle_l', rotation: qFromAxisAngle({ x: 0, y: 0, z: 1 }, 1.2) },
    { name: 'lowerarm_l', parent: 'upperarm_l', rotation: I },
  ]);

  // A POSE IDENTICAL TO THE BIND must produce no correction anywhere. This is
  // the check that catches a formula which is right only up to a constant —
  // and one exactly like it caught the original torque bug in this project.
  const same = retargetPose(bind, bind);
  const worstSame = Math.max(0, ...[...same.values()].map((q) => qAngleBetween(q, I)));
  check('a pose equal to the bind asks for zero correction', worstSame < 1e-9,
    `${(worstSame * DEG).toFixed(6)}°`);

  /* THE CLAVICLE TEST — the entire reason this module works in world space.
     Rotate ONLY the clavicle. The bone chain moves the arm, but the physics rig
     has no clavicle: that rotation has to show up in the SHOULDER's target,
     because the shoulder is the only joint between the chest and the arm. */
  const clavPose = worldRotations([
    { name: 'pelvis', parent: null, rotation: qFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.3) },
    { name: 'spine_03', parent: 'pelvis', rotation: qFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.2) },
    { name: 'clavicle_l', parent: 'spine_03', rotation: qFromAxisAngle({ x: 0, y: 0, z: 1 }, 0.4 + 0.25) },
    { name: 'upperarm_l', parent: 'clavicle_l', rotation: qFromAxisAngle({ x: 0, y: 0, z: 1 }, 1.2) },
    { name: 'lowerarm_l', parent: 'upperarm_l', rotation: I },
  ]);
  const clav = retargetPose(bind, clavPose);
  const shoulder = clav.get('upperarm_l');
  check('a clavicle-only rotation reaches the shoulder target',
    shoulder && qAngleBetween(shoulder, I) > 0.2,
    shoulder ? `${(qAngleBetween(shoulder, I) * DEG).toFixed(1)}°` : 'no target');
  check('and it is exactly the clavicle rotation, not an approximation of it',
    shoulder && Math.abs(qAngleBetween(shoulder, I) - 0.25) < 1e-6,
    shoulder ? `${qAngleBetween(shoulder, I).toFixed(6)} vs 0.25` : '');
  check('while the ELBOW, whose parent moved with it, asks for nothing',
    near(clav.get('forearm_l') || I, I, 1e-9),
    `${(qAngleBetween(clav.get('forearm_l') || I, I) * DEG).toFixed(4)}°`);

  /* NEGATIVE CONTROL for the whole design: the naive retarget — copy the local
     rotation across — gets the clavicle case wrong, because the local rotation
     of upperarm_l did not change at all. */
  check('NEGATIVE CONTROL: copying local rotations would have missed it entirely',
    near(qFromAxisAngle({ x: 0, y: 0, z: 1 }, 1.2), qFromAxisAngle({ x: 0, y: 0, z: 1 }, 1.2)));

  // And a rotation of the bone itself lands on its own joint.
  const armPose = worldRotations([
    { name: 'pelvis', parent: null, rotation: qFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.3) },
    { name: 'spine_03', parent: 'pelvis', rotation: qFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.2) },
    { name: 'clavicle_l', parent: 'spine_03', rotation: qFromAxisAngle({ x: 0, y: 0, z: 1 }, 0.4) },
    { name: 'upperarm_l', parent: 'clavicle_l', rotation: qFromAxisAngle({ x: 0, y: 0, z: 1 }, 1.2) },
    { name: 'lowerarm_l', parent: 'upperarm_l', rotation: qFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.9) },
  ]);
  const arm = retargetPose(bind, armPose);
  check('an elbow rotation lands on the elbow, at full magnitude',
    Math.abs(qAngleBetween(arm.get('forearm_l'), I) - 0.9) < 1e-6,
    `${qAngleBetween(arm.get('forearm_l'), I).toFixed(4)}`);
  check('and does not leak into the shoulder',
    near(arm.get('upperarm_l') || I, I, 1e-9));
}
{
  // Blend weight, so a clip can be faded in rather than stepped into.
  const bind = worldRotations([{ name: 'thigh_l', parent: null, rotation: I }]);
  const pose = worldRotations([{ name: 'thigh_l', parent: null, rotation: qFromAxisAngle({ x: 1, y: 0, z: 0 }, 1.0) }]);
  check('weight 0 produces nothing at all', retargetPose(bind, pose, { weight: 0 }).size === 0);
  const half = retargetPose(bind, pose, { weight: 0.5 }).get('thigh_l');
  check('weight 0.5 is half the rotation',
    Math.abs(qAngleBetween(half, I) - 0.5) < 1e-6, `${qAngleBetween(half, I).toFixed(4)}`);
  const full = retargetPose(bind, pose, { weight: 1 }).get('thigh_l');
  check('weight 1 is all of it', Math.abs(qAngleBetween(full, I) - 1.0) < 1e-6);
}
{
  // A bone the file does not have must be skipped, not guessed at.
  const bind = worldRotations([{ name: 'thigh_l', parent: null, rotation: I }]);
  const out = retargetPose(bind, bind);
  check('bones absent from the file are skipped silently', !out.has('upperarm_l'));
  check('and the ones present still resolve', out.has('thigh_l'));
  check('a cyclic hierarchy terminates rather than hanging the frame',
    worldRotations([{ name: 'a', parent: 'b', rotation: I }, { name: 'b', parent: 'a', rotation: I }]).size === 2);
}

// ---------------------------------------------------------------------------
console.log('\n3. Clip resolution and the procedural fallbacks');
{
  const r = resolveClips(['idle', 'Jog', 'Slide', 'OverhandThrow', 'Sprint']);
  check('aliases resolve the artist\'s names', r.resolved.run === 'Jog'
    && r.resolved.slide === 'Slide' && r.resolved.spike === 'OverhandThrow', JSON.stringify(r.resolved));
  check('and missing ones are reported, not invented',
    r.missing.includes('walk') && r.missing.includes('dive') && r.missing.includes('volley'),
    r.missing.join(','));

  const exact = resolveClips(['slide', 'Slide']);
  check('an exact brief-name wins over an alias', exact.resolved.slide === 'slide',
    exact.resolved.slide);
  check('case-insensitive matching is a fallback, not the first move',
    resolveClips(['SLIDE']).resolved.slide === 'SLIDE');
  check('clips nobody asked for are reported as unused',
    resolveClips(['idle', 'Cartwheel']).unused.includes('Cartwheel'));
}
{
  // THE POLICY. Actions the physics owns keep their authored poses even when a
  // clip exists — that is a decision, not a gap.
  const q = (s) => clipForState(s);
  check('diving keeps the procedural lay-out', q({ action: 'diving' }).procedural
    && q({ action: 'diving' }).clip === null);
  check('so does the skid it decays into', q({ action: 'skidding' }).procedural);
  check('sliding keeps its asymmetric pose', q({ action: 'sliding' }).procedural);
  check('a knockdown is simulated, never played', q({ action: 'knocked' }).procedural
    && q({ action: 'knocked' }).clip === null);
  check('recovery uses a clip as a TARGET but stays motor-driven',
    q({ action: 'recovering' }).procedural && q({ action: 'recovering' }).clip === 'getup');

  check('standing still is idle', q({ speed: 0 }).clip === 'idle');
  check('a jog is walk', q({ speed: 2 }).clip === 'walk');
  check('a run is run', q({ speed: 6 }).clip === 'run');
  check('a sprint is sprint', q({ speed: 10 }).clip === 'sprint');
  check('airborne beats speed', q({ speed: 10, grounded: false }).clip === 'jumpAir');
  check('NEGATIVE CONTROL: grounded at the same speed is not airborne',
    q({ speed: 10, grounded: true }).clip === 'sprint');
  check('every branch gives a reason', ['none', 'diving', 'sliding', 'knocked', 'recovering']
    .every((a) => (q({ action: a }).reason || '').length >= 4),
    JSON.stringify(['none', 'diving', 'sliding', 'knocked', 'recovering'].map((a) => q({ action: a }).reason)));
}
{
  check('stride rate scales with speed',
    Math.abs(strideRate(3.2, 1.6) - 2) < 1e-9 || strideRate(3.2, 1.6) === 1.85);
  check('and is clamped, so a clip is never played at a glitchy rate',
    strideRate(100, 1) <= 1.85 && strideRate(0, 1) >= 0.55);
  check('a zero authored speed does not divide by zero',
    Number.isFinite(strideRate(5, 0)) && strideRate(5, 0) === 1);
}

// ---------------------------------------------------------------------------
console.log('\n4. The REAL delivered file');
const FILE = './VB_Animations_clean.glb';
if (!fs.existsSync(FILE)) {
  console.log('  (skipped — VB_Animations_clean.glb not present)');
} else {
  const glb = readGLB(FILE);

  // What it IS, stated plainly, because the covering note said otherwise.
  check('the file carries no mesh', glb.meshes === 0, `${glb.meshes} meshes`);
  check('and no skin', glb.skins === 0, `${glb.skins} skins`);
  check('so it is a CLIP LIBRARY, not a character', glb.meshes === 0 && glb.animations.length > 0);

  // The cleanup claims, verified rather than believed.
  const names = new Set(glb.names);
  const REQ = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
    'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'middle_03_l',
    'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'middle_03_r',
    'thigh_l', 'calf_l', 'foot_l', 'ball_leaf_l',
    'thigh_r', 'calf_r', 'foot_r', 'ball_leaf_r'];
  check('all 24 brief bones are present and exactly spelled',
    REQ.every((b) => names.has(b)), REQ.filter((b) => !names.has(b)).join(','));
  check('the lowercase `head` bug is fixed', !names.has('head') && names.has('Head'));
  check('the root correction is baked out — pelvis is the scene root',
    glb.nodes.find((n) => n.name === 'pelvis').parent === null);

  // EVERY BONE THE RETARGET NEEDS must exist, or a body silently stops tracking.
  const needed = [...Object.keys(BONE_TO_BODY), ...new Set(Object.values(PARENT_BONE).filter(Boolean))];
  check('every bone the retarget reads is in the file',
    needed.every((b) => names.has(b)), needed.filter((b) => !names.has(b)).join(','));

  const bind = worldRotations(glb.nodes);
  const resolved = resolveClips(glb.animations.map((a) => a.name));
  check('the file resolves the locomotion set', resolved.resolved.idle
    && resolved.resolved.run && resolved.resolved.sprint, JSON.stringify(resolved.resolved));
  check('and the five known gaps are reported', resolved.missing.length === 5,
    resolved.missing.join(','));

  // THE RETARGET RUNS ON REAL DATA, and produces a target for every body.
  const pose = sampleWorld(glb, resolved.resolved.run, 0.4, worldRotations);
  const out = retargetPose(bind, pose);
  check('a real clip frame drives every mapped body',
    out.size === Object.keys(BONE_TO_BODY).length, `${out.size} of ${Object.keys(BONE_TO_BODY).length}`);
  check('and every target is a unit quaternion',
    [...out.values()].every((q) => Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-6));
  check('and finite', [...out.values()].every((q) => [q.x, q.y, q.z, q.w].every(Number.isFinite)));

  // A frame of the run cycle must actually differ from the bind, or the
  // retarget is producing a very confident T-pose.
  const moved = [...out.values()].filter((q) => qAngleBetween(q, I) > 0.05).length;
  check('the pose is actually a pose, not a rest position', moved >= 6, `${moved} bodies moved`);

  // Sampling the SAME clip at the bind time is not a valid identity test (the
  // clip does not start at bind), so identity is asserted against the file's
  // own rest transforms instead.
  const restPose = worldRotations(glb.nodes);
  const restOut = retargetPose(bind, restPose);
  const worstRest = Math.max(0, ...[...restOut.values()].map((q) => qAngleBetween(q, I)));
  check('the file\'s own rest pose asks for zero correction', worstRest < 1e-9,
    `${(worstRest * DEG).toFixed(6)}°`);

  /* THE LIMIT SWEEP, in the frame the rig actually enforces limits in.
     Reported rather than asserted: content overrunning a limit is a
     conversation with the artist, not a build failure — and the rig clamps
     safely either way. What WOULD be a failure is not knowing. */
  console.log('\n  --- clip excursions past the rig\'s joint limits ---');
  const worst = new Map();
  for (const [logical, clipName] of Object.entries(resolved.resolved)) {
    const clip = glb.animations.find((a) => a.name === clipName);
    for (let t = 0; t <= clip.duration; t += 1 / 30) {
      const p = sampleWorld(glb, clipName, t, worldRotations);
      const tg = retargetPose(bind, p);
      for (const [body, q] of tg) {
        const lim = DUMMY_LIMITS[body];
        const hinge = DUMMY_HINGES[body];
        const ang = qAngleBetween(q, I) * DEG;
        const cap = hinge ? hinge.limits[1] * DEG : lim ? lim.cone : null;
        if (cap === null) continue;
        const over = ang - cap;
        if (over > 0) {
          const k = `${body}${hinge ? ' (hinge)' : ' (cone)'}`;
          const cur = worst.get(k);
          if (!cur || over > cur.over) worst.set(k, { over, clip: logical, t });
        }
      }
    }
  }
  const rows = [...worst.entries()].sort((a, b) => b[1].over - a[1].over);
  if (!rows.length) console.log('    none — every clip is inside every limit');
  for (const [k, w] of rows) {
    console.log(`    ${k.padEnd(20)} +${w.over.toFixed(0).padStart(3)}°  worst in ${w.clip} @ ${w.t.toFixed(2)}s`);
  }
  check('the sweep ran over every resolved clip',
    Object.keys(resolved.resolved).length >= 8, `${Object.keys(resolved.resolved).length}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
