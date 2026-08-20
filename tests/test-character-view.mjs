/**
 * Offline verification of character-view.js — the visible character.
 *
 * The three things worth proving without a browser: the clip POLICY (what plays
 * when), the bone write-back ALGEBRA (the one place physics still drives the
 * mesh), and that the transform tracking cannot desync from the physics.
 */
import {
  createCharacterView, visualClipForState, CLIP_STANDINS, DEFAULT_VIEW_TUNING,
} from './character-view.js';
import { BONE_TO_BODY } from './clip-retarget.js';
import { qMul, qConj, qNormalize, qFromAxisAngle, qAngleBetween } from './rig-math.js';
import { DUMMY_PARTS } from './dummy-rig.js';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};
const DEG = 180 / Math.PI;

/* --- The smallest THREE that this module actually uses ------------------- */
class Q {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; }
  copy(q) { return this.set(q.x, q.y, q.z, q.w); }
  clone() { return new Q(this.x, this.y, this.z, this.w); }
  invert() { const c = qConj(this); return this.set(c.x, c.y, c.z, c.w); }
  premultiply(q) { const r = qMul(q, this); return this.set(r.x, r.y, r.z, r.w); }
  multiply(q) { const r = qMul(this, q); return this.set(r.x, r.y, r.z, r.w); }
}
class Obj {
  constructor(name = '') {
    this.name = name; this.children = []; this.parent = null; this.visible = true;
    this.quaternion = new Q();
    this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    this.scale = { x: 1, y: 1, z: 1, setScalar(v) { this.x = this.y = this.z = v; } };
  }
  add(o) { o.parent = this; this.children.push(o); return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); return this; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
  updateMatrixWorld() {}
  getWorldQuaternion(out) {
    const w = this.parent ? this.parent.getWorldQuaternion(new Q()) : new Q();
    const r = qMul(w, this.quaternion);
    return out ? out.set(r.x, r.y, r.z, r.w) : new Q(r.x, r.y, r.z, r.w);
  }
}
const mixerCalls = [];
const THREE = {
  Group: Obj, Quaternion: Q,
  LoopOnce: 2200, LoopRepeat: 2201,
  AnimationMixer: class {
    constructor(root) { this.root = root; this._actions = new Map(); }
    clipAction(clip) {
      if (!this._actions.has(clip.name)) {
        this._actions.set(clip.name, {
          name: clip.name, time: 0, timeScale: 1, paused: false, enabled: true,
          weight: 1, _playing: false,
          reset() { this.time = 0; return this; },
          play() { this._playing = true; return this; },
          stop() { this._playing = false; return this; },
          fadeIn() { return this; },
          crossFadeTo() { return this; },
          setLoop() { return this; },
        });
      }
      return this._actions.get(clip.name);
    }
    update(dt) { mixerCalls.push(dt); }
  },
};

const bone = (name, parent, rotation) => {
  const b = new Obj(name);
  b.isBone = true;
  if (rotation) b.quaternion.copy(rotation);
  if (parent) parent.add(b);
  return b;
};

function makeGltf(opts = {}) {
  const scene = new Obj('root');
  const pelvis = bone('pelvis', scene, opts.pelvisRot);
  const spine1 = bone('spine_01', pelvis);
  const spine2 = bone('spine_02', spine1);
  const spine3 = bone('spine_03', spine2, opts.spineRot);
  bone('Head', bone('neck_01', spine3));
  const clav = bone('clavicle_l', spine3, opts.clavRot);
  const ua = bone('upperarm_l', clav, opts.armRot);
  bone('hand_l', bone('lowerarm_l', ua));
  const clavR = bone('clavicle_r', spine3);
  const uaR = bone('upperarm_r', clavR);
  bone('hand_r', bone('lowerarm_r', uaR));
  for (const side of ['l', 'r']) {
    const t = bone(`thigh_${side}`, pelvis);
    bone(`foot_${side}`, bone(`calf_${side}`, t));
  }
  const mesh = new Obj('body');
  mesh.isSkinnedMesh = true; mesh.isMesh = true;
  scene.add(mesh);
  return {
    scene,
    animations: (opts.clips || ['idle', 'run', 'sprint', 'slide', 'spike', 'Slide_Start'])
      .map((n) => ({ name: n, duration: 1 })),
  };
}
const RESOLVED = {
  idle: 'idle', run: 'run', sprint: 'sprint', slide: 'slide',
  spike: 'spike', slideStart: 'Slide_Start',
};
const makeView = (opts = {}) => createCharacterView({
  THREE, gltf: makeGltf(opts), resolved: opts.resolved || RESOLVED, tuning: { ...(opts.tuning || {}) },
});

// ---------------------------------------------------------------------------
console.log('\n1. The visual clip policy');
{
  const v = visualClipForState;
  check('standing still is idle', v({ speed: 0 }).clip === 'idle');
  check('a jog is walk', v({ speed: 2 }).clip === 'walk');
  check('a run is run', v({ speed: 6 }).clip === 'run');
  check('a sprint is sprint', v({ speed: 10 }).clip === 'sprint');
  check('airborne beats speed', v({ speed: 10, grounded: false }).clip === 'jumpAir');

  check('a slide plays the slide clip', v({ action: 'sliding' }).clip === 'slide');
  check('a dive plays the dive clip', v({ action: 'diving' }).clip === 'dive');
  check('and so does the skid it becomes', v({ action: 'skidding' }).clip === 'dive');

  /* THE DIFFERENCE FROM THE PHYSICS POLICY, which is the reason there are two.
     `clipForState` keeps the procedural pose for a slide because it drives the
     rig's TARGETS; this one plays the clip because it drives what you SEE. */
  check('a knockdown is simulated, never played',
    v({ action: 'knocked' }).mode === 'ragdoll' && v({ action: 'knocked' }).clip === null);
  check('and so is getting up', v({ action: 'recovering' }).mode === 'ragdoll');

  check('a spike plays the spike', v({ hitting: true, hitPhase: 'active', hitKind: 'spike' }).clip === 'spike');
  check('a volley plays the volley', v({ hitting: true, hitPhase: 'active', hitKind: 'volley' }).clip === 'volley');
  check('a swing is its own mode, so it can be scrubbed',
    v({ hitting: true, hitPhase: 'windup', hitKind: 'spike' }).mode === 'hit');
  check('an idle hit phase is not a swing',
    v({ hitting: true, hitPhase: 'idle', speed: 6 }).clip === 'run');
  check('NEGATIVE CONTROL: a swing beats locomotion at the same speed',
    v({ hitting: true, hitPhase: 'active', hitKind: 'spike', speed: 6 }).clip === 'spike');
  check('but a slide beats a swing — you cannot swing out of one anyway',
    v({ action: 'sliding', hitting: true, hitPhase: 'active' }).clip === 'slide');
}

// ---------------------------------------------------------------------------
console.log('\n2. Stand-ins for the clips that do not exist yet');
{
  const view = makeView();
  check('a real clip is used directly', view.play('run') && view.state.clip === 'run');
  check('and is not flagged as a stand-in', !view.standins.includes('run'));

  check('dive falls back to the slide entry', view.play('dive') && view.state.clip === 'Slide_Start',
    view.state.clip);
  check('and IS flagged, so nobody debugs it as a bug', view.standins.includes('dive'),
    view.standins.join(','));

  check('volley falls back to the spike', view.play('volley') && view.state.clip === 'spike');
  check('flagged too', view.standins.includes('volley'));
  check('walk falls back to run', view.play('walk') && view.state.clip === 'run');

  check('a logical clip with no clip and no stand-in simply does not play',
    view.play('knockdown') === false);
  check('and leaves the previous one alone', view.state.clip === 'run', view.state.clip);

  // With a full set, nothing is a stand-in.
  const full = makeView({
    clips: ['idle', 'walk', 'run', 'sprint', 'dive', 'slide', 'volley', 'spike'],
    resolved: { idle: 'idle', walk: 'walk', run: 'run', sprint: 'sprint',
      dive: 'dive', slide: 'slide', volley: 'volley', spike: 'spike' },
  });
  full.play('dive'); full.play('volley'); full.play('walk');
  check('NEGATIVE CONTROL: a complete file uses no stand-ins at all',
    full.standins.length === 0, full.standins.join(','));
}

// ---------------------------------------------------------------------------
console.log('\n3. The bone write-back — the one place physics drives the mesh');
{
  /* THE ASSUMPTION IT RESTS ON, asserted rather than trusted: the rig's bodies
     are built axis-aligned at bind, so a body's CURRENT rotation is already its
     delta from bind. If a part were ever authored pre-rotated this would be
     silently wrong, and the symptom would be a ragdoll with a permanently
     twisted limb. */
  const preRotated = DUMMY_PARTS.filter((p) => p.rotation && qAngleBetween(p.rotation, { x: 0, y: 0, z: 0, w: 1 }) > 1e-9);
  check('every rig body is axis-aligned at bind', preRotated.length === 0,
    preRotated.map((p) => p.id).join(','));

  // A rig stub whose bodies report known rotations.
  const rotations = new Map();
  const rig = {
    part: (id) => (rotations.has(id) ? { body: { rotation: () => rotations.get(id) } } : null),
  };

  const view = makeView({ spineRot: qFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.3) });

  // IDENTITY: bodies at their bind rotation must leave the bones exactly where
  // the file put them. This is the check that catches a formula right only up
  // to a constant — the same class of bug that bit the torque path.
  for (const body of Object.values(BONE_TO_BODY)) rotations.set(body, { x: 0, y: 0, z: 0, w: 1 });
  const before = new Map([...view.bones].map(([n, b]) => [n, b.quaternion.clone()]));
  view.writeBonesFromRig(rig);
  let worst = 0;
  for (const [n, q] of before) {
    const b = view.bones.get(n);
    worst = Math.max(worst, qAngleBetween(b.quaternion, q));
  }
  check('bodies at bind leave every bone untouched', worst < 1e-9,
    `${(worst * DEG).toFixed(6)}°`);

  // A ROTATION ON ONE BODY lands on that bone, in world, at full magnitude.
  view.restoreBindLocal();
  const spin = qFromAxisAngle({ x: 0, y: 0, z: 1 }, 0.7);
  rotations.set('thigh_l', spin);
  view.writeBonesFromRig(rig);
  const thigh = view.bones.get('thigh_l');
  const worldNow = thigh.getWorldQuaternion(new Q());
  const bindW = view.bindWorld.get('thigh_l');
  const applied = qNormalize(qMul(worldNow, qConj(bindW)));
  check('a body rotation reaches its bone, in WORLD, exactly',
    qAngleBetween(applied, spin) < 1e-6, `${(qAngleBetween(applied, spin) * DEG).toFixed(4)}°`);
  check('and does not disturb a sibling',
    qAngleBetween(view.bones.get('thigh_r').quaternion, before.get('thigh_r')) < 1e-9);

  /* THE PARENT DIVISION. Rotating a PARENT body must not double-count on the
     child: the child's own world rotation should follow the parent, and its
     LOCAL rotation should stay put. Getting this wrong is how a ragdoll ends up
     with an arm that bends twice as far as the shoulder did. */
  view.restoreBindLocal();
  rotations.set('thigh_l', { x: 0, y: 0, z: 0, w: 1 });
  rotations.set('chest', qFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.5));
  rotations.set('upperarm_l', qFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.5));
  view.writeBonesFromRig(rig);
  const armLocal = view.bones.get('upperarm_l').quaternion.clone();
  view.restoreBindLocal();
  rotations.set('chest', { x: 0, y: 0, z: 0, w: 1 });
  view.writeBonesFromRig(rig);
  const armLocalNoChest = view.bones.get('upperarm_l').quaternion.clone();
  check('a parent body rotating changes the child\'s LOCAL rotation',
    qAngleBetween(armLocal, armLocalNoChest) > 0.1,
    `${(qAngleBetween(armLocal, armLocalNoChest) * DEG).toFixed(1)}°`);

  check('a rig with no matching bodies writes nothing',
    view.writeBonesFromRig({ part: () => null }) === false);
  check('and a null rig is tolerated', view.writeBonesFromRig(null) === false);
}

// ---------------------------------------------------------------------------
console.log('\n4. Tracking the physics: position, yaw and the hip drop');
{
  const view = makeView({ tuning: { yawRate: 1e6, liftRate: 1e6 } });
  view.update(1 / 60, { position: { x: 3, y: 1.5, z: -2 }, facingAngle: 0, lift: 0, speed: 0 });
  check('the model sits exactly on the sphere\'s contact point',
    view.root.position.x === 3 && view.root.position.z === -2
    && Math.abs(view.root.position.y - 1.5) < 1e-6,
    JSON.stringify(view.root.position));

  view.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, facingAngle: 1.2, lift: 0, speed: 0 });
  check('and takes the controller\'s facing', Math.abs(view.root.rotation.y - 1.2) < 1e-3,
    `${view.root.rotation.y}`);

  /* THE CONVENTION, spelled out, because a 180° error here is the single most
     likely bug in the whole integration and this project has already shipped
     one. The controller's `facingAngle` φ means the direction (sin φ, cos φ);
     a rotation of φ about +Y carries the model's authored forward (+Z) to
     exactly (sin φ, 0, cos φ). So the correct yaw offset is ZERO, and the
     check is that the two agree at an angle where being wrong is obvious. */
  const fwd = (yawY) => ({ x: Math.sin(yawY), z: Math.cos(yawY) });
  for (const phi of [0, Math.PI / 2, 2.4, -1.1]) {
    const v2 = makeView({ tuning: { yawRate: 1e6 } });
    v2.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, facingAngle: phi, speed: 0 });
    const got = fwd(v2.root.rotation.y);
    const want = { x: Math.sin(phi), z: Math.cos(phi) };
    check(`the model's forward matches the controller's heading at ${phi.toFixed(2)} rad`,
      Math.abs(got.x - want.x) < 1e-3 && Math.abs(got.z - want.z) < 1e-3,
      `(${got.x.toFixed(3)}, ${got.z.toFixed(3)}) vs (${want.x.toFixed(3)}, ${want.z.toFixed(3)})`);
  }
  check('NEGATIVE CONTROL: the default yaw offset really is zero, not a fudge',
    DEFAULT_VIEW_TUNING.yawOffsetDeg === 0);

  // THE HOVER FIX, on the model. A negative lift pulls it DOWN.
  view.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, facingAngle: 0, lift: -0.7, speed: 0 });
  check('a posture drop pulls the model toward the floor',
    Math.abs(view.root.position.y + 0.7) < 1e-6, `${view.root.position.y}`);
  view.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, facingAngle: 0, lift: 0, speed: 0 });
  check('and it comes back up', Math.abs(view.root.position.y) < 1e-6);

  // The lift is FILTERED, not snapped — a step makes a dive look like the
  // character fell through the floor for a frame.
  const slow = makeView({ tuning: { liftRate: 6.5, yawRate: 1e6 } });
  slow.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, lift: 0, speed: 0 });
  slow.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, lift: -1, speed: 0 });
  check('the drop is eased rather than snapped',
    slow.root.position.y < 0 && slow.root.position.y > -0.5,
    `${slow.root.position.y.toFixed(3)} after one frame`);

  // Yaw takes the SHORT way round, or the model spins a full turn at the seam.
  const yaw = makeView({ tuning: { yawRate: 1e6 } });
  yaw.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, facingAngle: 3.0, speed: 0 });
  yaw.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, facingAngle: -3.0, speed: 0 });
  const d = Math.abs(Math.atan2(Math.sin(yaw.root.rotation.y + 3.0), Math.cos(yaw.root.rotation.y + 3.0)));
  check('yaw wraps the short way across ±π', d < 1e-3, `${yaw.root.rotation.y.toFixed(3)}`);

  // The yaw offset exists so a model authored facing −Z needs no re-export.
  const flipped = makeView({ tuning: { yawOffsetDeg: 180, yawRate: 1e6 } });
  flipped.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, facingAngle: 0, speed: 0 });
  check('a 180° yaw offset turns the model around',
    Math.abs(Math.abs(flipped.root.rotation.y) - Math.PI) < 1e-3,
    `${flipped.root.rotation.y}`);
}
{
  // The mixer must advance on clip frames and NOT while the ragdoll owns the
  // bones — an advancing mixer would fight the write-back every frame.
  const view = makeView();
  const rig = { part: () => ({ body: { rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }) } }) };
  mixerCalls.length = 0;
  view.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, speed: 6, action: 'none' });
  check('a locomotion frame advances the mixer', mixerCalls.length === 1 && mixerCalls[0] > 0);

  mixerCalls.length = 0;
  view.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, action: 'knocked', rig });
  check('a knocked frame does not — the ragdoll owns the bones',
    mixerCalls.length === 0, `${mixerCalls.length} mixer updates`);
  check('and the view says so', view.state.mode === 'ragdoll');

  mixerCalls.length = 0;
  view.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, speed: 6, action: 'none' });
  check('and it resumes on the way back up', mixerCalls.length === 1);
  check('the mode goes back to clip', view.state.mode === 'clip');
}
{
  // A swing is SCRUBBED from the action machine's clock, not played freely.
  const view = makeView();
  const at = (progress) => {
    view.update(1 / 60, {
      position: { x: 0, y: 0, z: 0 }, speed: 0,
      hitting: true, hitPhase: 'active', hitKind: 'spike', hitProgress: progress,
    });
    return view.mixer._actions.get('spike').time;
  };
  check('progress 0 is the first frame of the swing', Math.abs(at(0)) < 1e-9);
  check('progress 0.5 is halfway through it', Math.abs(at(0.5) - 0.5) < 1e-9, `${at(0.5)}`);
  check('progress 1 is the end', Math.abs(at(1) - 1) < 1e-9);
  check('and it is clamped, not extrapolated', Math.abs(at(4) - 1) < 1e-9 && Math.abs(at(-2)) < 1e-9);
}

// ---------------------------------------------------------------------------
console.log('\n5. Robustness');
{
  const view = makeView();
  view.update();
  view.update(0, {});
  check('missing arguments are tolerated', Number.isFinite(view.root.position.y));
  check('visibility is switchable', (view.visible = false) === false && view.root.visible === false);
  view.visible = true;
  check('and back', view.root.visible === true);

  let threw = false;
  try { createCharacterView({ THREE, gltf: {}, resolved: {} }); } catch (e) { threw = true; }
  check('a file with no scene is refused loudly rather than half-loaded', threw);

  const v2 = makeView();
  const parent = new Obj('scene');
  parent.add(v2.root);
  v2.dispose();
  check('disposing detaches it from the scene', parent.children.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
