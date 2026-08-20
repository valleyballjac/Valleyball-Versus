/**
 * Offline verification of dummy-rig.js against a mock Rapier.
 *
 * What this CAN check: the body plan's arithmetic (nothing overlaps at spawn),
 * joint construction and limits, the swing-twist clamp, the accumulator reset,
 * mass ratios, the gait, live tuning, and the coupled-chain stability of the
 * gains.
 *
 * What it CANNOT check: whether fourteen joints settle or oscillate in the real
 * solver. That needs Rapier. Stated here rather than implied, because a green
 * suite should not read as a stability guarantee.
 */
import {
  createDummyRig, DEFAULT_DUMMY_TUNING, DEFAULT_GAIT, DUMMY_PARTS, DUMMY_HINGES,
  DUMMY_LIMITS, DUMMY_TORSO, DUMMY_CORE, DUMMY_MODES,
  GAIN_GROUPS, GROUP_OF, SWING_POSES, ARM_FWD, LEG_FWD, POSTURES,
  gaitTargets, gaitRate, spawnOverlaps, partAABB, planDummyMass, swingTargets,
} from './dummy-rig.js';
import {
  qMul, qConj, qFromAxisAngle, qRotate, qToRotationVector,
  qSwingTwist, swingAngle, twistAngle, qAngleBetween, qSlerp, qNormalize,
} from './rig-math.js';
import { makeJointStub, motorCallsOn } from './rapier-api.mjs';

let pass = 0, fail = 0;
const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const DEG = Math.PI / 180;
const X = { x: 1, y: 0, z: 0 }, Y = { x: 0, y: 1, z: 0 }, Z = { x: 0, y: 0, z: 1 };
/** acos guard: float error can push a unit component a hair past 1. */
const clampT = (v) => Math.min(1, Math.max(-1, v));

/* --- Mock Rapier, built from the verified surface ------------------------- */
const BodyType = { Dynamic: 0, KinematicPositionBased: 2 };

function makeRapier() {
  const created = { bodies: [], colliders: [], joints: [] };

  const desc = (type) => {
    const d = { _type: type, _t: { x: 0, y: 0, z: 0 } };
    d.setTranslation = (x, y, z) => { d._t = { x, y, z }; return d; };
    for (const k of ['setRotation', 'setLinearDamping', 'setAngularDamping', 'setCanSleep']) {
      d[k] = (v) => { d['_' + k] = v; return d; };
    }
    return d;
  };
  const col = (shape, dims) => {
    const c = { shape, dims, mass: 1, nFriction: 0 };
    c.setMass = (m) => { c.mass = m; return c; };
    c.setFriction = (f) => { c.friction = f; c.nFriction++; return c; };
    c.setFrictionCombineRule = (r) => { c.rule = r; return c; };
    for (const k of ['setRestitution', 'setCollisionGroups', 'setRotation', 'setTranslation']) {
      c[k] = (v) => { c['_' + k] = v; return c; };
    }
    return c;
  };

  const RAPIER = {
    RigidBodyType: BodyType,
    MotorModel: { AccelerationBased: 1 },
    CoefficientCombineRule: { Average: 0, Min: 1, Multiply: 2, Max: 3 },
    RigidBodyDesc: {
      dynamic: () => desc(BodyType.Dynamic),
      kinematicPositionBased: () => desc(BodyType.KinematicPositionBased),
    },
    ColliderDesc: {
      capsule: (hh, r) => col('capsule', { hh, r }),
      cylinder: (hh, r) => col('cylinder', { hh, r }),
      ball: (r) => col('ball', { r }),
      cuboid: (x, y, z) => col('cuboid', { x, y, z }),
    },
    JointData: {
      spherical: (a1, a2) => ({ kind: 'spherical', a1: { ...a1 }, a2: { ...a2 } }),
      revolute: (a1, a2, axis) => ({ kind: 'revolute', a1: { ...a1 }, a2: { ...a2 }, axis: { ...axis } }),
    },
  };

  const world = {
    createRigidBody(d) {
      const b = {
        _type: d._type,
        _t: { ...d._t }, _r: { x: 0, y: 0, z: 0, w: 1 },
        _v: { x: 0, y: 0, z: 0 }, _w: { x: 0, y: 0, z: 0 },
        // Rapier's accumulators are PERSISTENT — whatever is added stays applied
        // until cleared. The mock models that faithfully; swallowing it would
        // make a rig that never resets look identical to one that does.
        _torque: { x: 0, y: 0, z: 0 }, _force: { x: 0, y: 0, z: 0 },
        _resets: 0,
        translation() { return this._t; }, rotation() { return this._r; },
        linvel() { return this._v; }, angvel() { return this._w; },
        bodyType() { return this._type; },
        setBodyType(t) { this._type = t; },
        setTranslation(t) { this._t = { ...t }; },
        setRotation(q) { this._r = { ...q }; },
        setLinvel(v) { this._v = { ...v }; },
        setAngvel(w) { this._w = { ...w }; },
        setNextKinematicTranslation(t) { this._t = { ...t }; },
        setNextKinematicRotation(q) { this._r = { ...q }; },
        addTorque(t) { this._torque.x += t.x; this._torque.y += t.y; this._torque.z += t.z; },
        addForce(f) { this._force.x += f.x; this._force.y += f.y; this._force.z += f.z; },
        resetTorques() { this._torque = { x: 0, y: 0, z: 0 }; this._resets++; },
        resetForces() { this._force = { x: 0, y: 0, z: 0 }; },
        applyTorqueImpulse(t) {
          this._imp = this._imp || { x: 0, y: 0, z: 0 };
          this._imp.x += t.x; this._imp.y += t.y; this._imp.z += t.z;
        },
        applyImpulse(i) { this._v.x += i.x; this._v.y += i.y; this._v.z += i.z; },
      };
      created.bodies.push(b);
      return b;
    },
    createCollider(d, body) { created.colliders.push({ d, body }); return d; },
    createImpulseJoint(params, b1, b2) {
      const j = makeJointStub(params.kind);
      j._kind = params.kind; j.params = params; j.b1 = b1; j.b2 = b2;
      created.joints.push(j);
      return j;
    },
    removeRigidBody(b) { const i = created.bodies.indexOf(b); if (i >= 0) created.bodies.splice(i, 1); },
    removeImpulseJoint(j) { const i = created.joints.indexOf(j); if (i >= 0) created.joints.splice(i, 1); },
  };
  return { RAPIER, world, created };
}

/* --- A THREE stub with just enough to build meshes ------------------------ */
class V3 {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  setScalar(v) { return this.set(v, v, v); }
}
class Q4 {
  constructor() { Object.assign(this, { x: 0, y: 0, z: 0, w: 1 }); }
  set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; }
}
class Obj {
  constructor() {
    this.children = []; this.position = new V3(); this.quaternion = new Q4();
    this.scale = new V3(1, 1, 1); this.visible = true; this.name = '';
  }
  add(...o) { this.children.push(...o); return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); return this; }
}
class Geo { constructor(...a) { this.args = a; this.disposed = false; } dispose() { this.disposed = true; } }
const THREE = {
  Group: Obj,
  Mesh: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
  BoxGeometry: Geo, SphereGeometry: Geo, CapsuleGeometry: Geo, CylinderGeometry: Geo,
};

/** The rig's own inertia function, so the test cannot drift from it. */
const partInertiaOf = (rig, part) => rig.partInertia(part);

function makeRig(opts = {}) {
  const { RAPIER, world, created } = makeRapier();
  const rig = createDummyRig({
    RAPIER, world, THREE: opts.noThree ? null : THREE,
    tuning: opts.tuning, spawn: opts.spawn, collisionGroups: opts.groups,
  });
  return { rig, created, world, RAPIER };
}

// ---------------------------------------------------------------------------
console.log('\n1. The body plan');
{
  check('every part except the root has a parent',
    DUMMY_PARTS.filter((p) => !p.parent).length === 1);
  check('and parents always come before their children',
    DUMMY_PARTS.every((p, i) => !p.parent
      || DUMMY_PARTS.findIndex((q) => q.id === p.parent) < i));

  const ids = DUMMY_PARTS.map((p) => p.id);
  check('ids are unique', new Set(ids).size === ids.length);
  check('and every parent names a real part',
    DUMMY_PARTS.every((p) => !p.parent || ids.includes(p.parent)));

  // Left and right must be exact mirrors, or the dummy walks with a limp that
  // looks exactly like a physics bug.
  const mirrored = DUMMY_PARTS.filter((p) => p.id.endsWith('_l'));
  check('left and right are mirrored in x', mirrored.every((l) => {
    const r = DUMMY_PARTS.find((p) => p.id === l.id.slice(0, -2) + '_r');
    return r && approx(r.centre[0], -l.centre[0], 1e-9)
      && approx(r.centre[1], l.centre[1], 1e-9) && approx(r.centre[2], l.centre[2], 1e-9)
      && approx(r.mass, l.mass, 1e-9);
  }));

  // Segments have to reach between their own joints, or the dummy is drawn with
  // gaps and the colliders do not cover the body they stand for.
  const gaps = [];
  for (const p of DUMMY_PARTS) {
    if (!p.parent || p.kind !== 'limb') continue;
    const top = p.centre[1] + p.length / 2;
    if (Math.abs(top - p.joint[1]) > 0.02) gaps.push(`${p.id} ${(top - p.joint[1]).toFixed(3)}`);
  }
  check('each limb segment starts at its own joint', gaps.length === 0, gaps.join(', '));

  const top = Math.max(...DUMMY_PARTS.map((p) => partAABB(p).max[1]));
  const bottom = Math.min(...DUMMY_PARTS.map((p) => partAABB(p).min[1]));
  check('the dummy is roughly human height', top - bottom > 1.5 && top - bottom < 2.0,
    `${(top - bottom).toFixed(3)} m`);
  check('and its feet are on the floor, not through it', bottom > -0.01 && bottom < 0.05,
    `${bottom.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
console.log('\n2. Nothing overlaps at spawn');
{
  /* Two colliders born inside each other are a separating impulse the size of
     the penetration on frame one — the classic ragdoll that explodes the
     instant it appears. Joint-linked pairs are exempt because their contacts
     are switched off; everything else has to be clear by arithmetic. */
  const ov = spawnOverlaps();
  check('no pair that can collide starts inside another', ov.length === 0,
    ov.map((o) => `${o.a}/${o.b} ${o.depth.toFixed(3)}`).join(', '));

  // Negative control: the check has to be capable of failing, or "0 overlaps"
  // means nothing at all.
  const tucked = DUMMY_PARTS.map((p) => (/arm|hand/.test(p.id)
    ? { ...p, centre: [p.centre[0] * 0.5, p.centre[1], p.centre[2]] } : p));
  check('and tucking the arms into the torso is detected',
    spawnOverlaps(tucked).length > 0);

  // Adjacent parts SHOULD overlap — a thigh's top is inside the pelvis, which is
  // what a hip looks like. If they did not, the joint would be holding two
  // shapes apart across a visible gap.
  const hip = partAABB(DUMMY_PARTS.find((p) => p.id === 'thigh_l'));
  const pelvis = partAABB(DUMMY_PARTS.find((p) => p.id === 'pelvis'));
  check('adjacent parts DO overlap, which is why their contacts are filtered',
    hip.max[1] > pelvis.min[1]);
}

// ---------------------------------------------------------------------------
console.log('\n3. Construction');
{
  const { rig, created } = makeRig();
  check('one body per part', created.bodies.length === DUMMY_PARTS.length);
  check('one collider each', created.colliders.length === DUMMY_PARTS.length);
  check('and a joint for every part except the root',
    created.joints.length === DUMMY_PARTS.length - 1, `${created.joints.length}`);

  check('the core spawns kinematic so it cannot tip',
    rig.order.filter((p) => p.isCore)
      .every((p) => p.body.bodyType() === BodyType.KinematicPositionBased));
  check('and every limb is dynamic',
    rig.order.filter((p) => !p.isCore)
      .every((p) => p.body.bodyType() === BodyType.Dynamic));

  check('every body starts identity-rotated — that is what makes anchors pure '
    + 'translations', rig.order.every((p) => approx(p.body.rotation().w, 1)));

  // The anchor invariant: both anchors must resolve to the SAME world point, or
  // the joint yanks the two bodies together on the first step.
  const bad = [];
  for (const part of rig.order) {
    if (!part.joint) continue;
    const parent = rig.part(part.parentId);
    const a1 = part.joint.params.a1, a2 = part.joint.params.a2;
    for (const k of ['x', 'y', 'z']) {
      const w1 = parent.body.translation()[k] + a1[k];
      const w2 = part.body.translation()[k] + a2[k];
      if (Math.abs(w1 - w2) > 1e-9) bad.push(`${part.id}.${k}`);
    }
  }
  check('both anchors of every joint land on the same world point',
    bad.length === 0, bad.join(', '));

  check('one mesh per body, and that is the whole visual pipeline',
    rig.order.every((p) => p.mesh) && rig.group.children.length === DUMMY_PARTS.length);
  check('meshes start on their bodies', rig.order.every((p) =>
    approx(p.mesh.position.y, p.body.translation().y, 1e-9)));
}
{
  const { rig } = makeRig({ noThree: true });
  check('and the rig still builds headless, with no THREE at all',
    rig.order.length === DUMMY_PARTS.length && rig.group === null);
}

// ---------------------------------------------------------------------------
console.log('\n4. Joints: hinges where anatomy says hinge');
{
  const { rig, created } = makeRig();
  const hinges = rig.order.filter((p) => p.jointKind === 'revolute');
  check('exactly four hinges — two knees, two elbows', hinges.length === 4,
    hinges.map((h) => h.id).join(', '));
  check('and they are the knees and elbows',
    hinges.map((h) => h.id).sort().join(',') === 'calf_l,calf_r,forearm_l,forearm_r');
  check('everything else is a ball joint',
    rig.order.filter((p) => p.joint && p.jointKind !== 'revolute')
      .every((p) => p.jointKind === 'spherical'));

  // NATIVE limits, which is the one thing the engine will enforce for us.
  const limitCalls = created.joints.filter((j) => j._kind === 'revolute')
    .map((j) => j._calls.filter((c) => c.name === 'setLimits').pop());
  check('every hinge asks the engine for hard limits',
    limitCalls.length === 4 && limitCalls.every(Boolean));
  check('and neither a knee nor an elbow may bend backwards',
    limitCalls.every((c) => c.args[0] >= 0),
    JSON.stringify(limitCalls.map((c) => c.args)));
  check('while still bending far enough to run',
    limitCalls.every((c) => c.args[1] > 2.0));

  // The regression that shipped a blank page: a motor call on a joint type that
  // has none. In Chrome that is a TypeError at load.
  const badMotor = created.joints.filter((j) => j._kind !== 'revolute' && motorCallsOn(j).length);
  check('no motor is configured on a joint type that has none', badMotor.length === 0);
  check('but the hinges DO get motors',
    created.joints.filter((j) => j._kind === 'revolute')
      .every((j) => motorCallsOn(j).length > 0));

  const overlap = Object.keys(DUMMY_LIMITS).filter((k) => DUMMY_HINGES[k]);
  check('no joint is limited twice', overlap.length === 0, overlap.join(', '));
  const unlimited = rig.order.filter((p) => p.joint && p.jointKind === 'spherical' && !p.limit);
  check('and every ball joint has a cone', unlimited.length === 0,
    unlimited.map((p) => p.id).join(', '));
}

// ---------------------------------------------------------------------------
console.log('\n5. Adjacent limbs ignore each other');
{
  /* Adjacent parts overlap BY DESIGN. If they are also allowed to collide, the
     solver pushes them apart every frame while the joint holds them together —
     two constraints fighting over one pair, which is a buzz you can see and is
     indistinguishable from bad gains.

     `setContactsEnabled(false)` is per PAIR, not global: it disables contacts
     between the two bodies THIS joint links and nothing else, so non-adjacent
     self-collision still works. Collision groups cannot express this — there
     are 16 membership bits and 14 pairs to exclude. */
  const { rig, created } = makeRig();
  const off = created.joints.filter((j) =>
    j._calls.some((c) => c.name === 'setContactsEnabled' && c.args[0] === false));
  check('every joint disables contacts between the pair it links',
    off.length === created.joints.length, `${off.length}/${created.joints.length}`);
  check('and the rig reports how many', rig.state.contactsDisabled === created.joints.length);

  // It must be exactly the connected pairs — a global switch would also stop an
  // arm hitting the chest, which is a collision you want.
  const linkedPairs = new Set();
  for (const p of DUMMY_PARTS) if (p.parent) linkedPairs.add(`${p.parent}|${p.id}`);
  check('exactly the connected pairs, no more', linkedPairs.size === off.length);
}

// ---------------------------------------------------------------------------
console.log('\n6. The accumulator — the bug that made the limbs wild');
{
  /* Rapier's addForce and addTorque write to a PERSISTENT accumulator: whatever
     is added stays applied on every subsequent step until it is cleared. A rig
     that adds a fresh correction each step and never clears therefore applies
     the running SUM of every correction it has ever computed. After a second
     that is sixty times what any gain asked for, and no tuning can rescue it.

     It also explains why only the LIMBS went wild: a pinned core is kinematic,
     and kinematic bodies ignore forces entirely. */
  const { rig } = makeRig();
  const arm = rig.part('upperarm_l');
  arm.body.setRotation(qFromAxisAngle(Z, 0.5));    // a constant error to correct

  const series = [];
  for (let i = 0; i < 40; i++) {
    rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, facingAngle: 0, want: 'pinned' });
    const t = arm.body._torque;
    series.push(Math.hypot(t.x, t.y, t.z));
  }
  const first = series[0], last = series[series.length - 1];
  check('a constant error produces a CONSTANT torque, not a growing one',
    approx(last, first, first * 0.02), `${first.toFixed(3)} → ${last.toFixed(3)} N·m`);
  let rising = 0;
  for (let i = 1; i < series.length; i++) if (series[i] > series[i - 1] * 1.001) rising++;
  check('and it does not rise on step after step', rising < 4, `${rising}/39 steps rose`);
  check('the reset really is being called', arm.body._resets >= 40);

  // Negative control on the MODEL, not the code: if the accumulator were not
  // cleared, this is what it would look like. Without this, the assertions
  // above could be passing because nothing is being applied at all.
  let acc = 0; const runaway = [];
  for (let i = 0; i < 40; i++) { acc += first; runaway.push(acc); }
  check('an unreset accumulator would have grown 40x over the same window',
    runaway[39] > first * 35);
  check('so the flat series above is a real result, not an absence of torque',
    first > 1e-6, `${first.toExponential(2)}`);
}
{
  // Forces too — the recovery lift uses addForce, and an unreset one launches
  // the pelvis into orbit rather than standing it up.
  const { rig } = makeRig();
  rig.setMode('ragdoll');
  rig.setMode('recover');
  const pelvis = rig.part('pelvis');
  const mags = [];
  for (let i = 0; i < 20; i++) {
    rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, facingAngle: 0 });
    const f = pelvis.body._force;
    mags.push(Math.hypot(f.x, f.y, f.z));
  }
  check('the recovery force is per-step too, not cumulative',
    approx(mags[19], mags[0], Math.max(1e-9, mags[0] * 0.02)),
    `${mags[0].toFixed(1)} → ${mags[19].toFixed(1)} N`);
}

// ---------------------------------------------------------------------------
console.log('\n7. Limits hold');
{
  // gravityComp off, so the only torque in play is the limit's. With it on, a
  // limb inside its range still gets a (correct) holding torque, and the
  // assertion below would be measuring the wrong thing.
  const { rig } = makeRig({ tuning: { gravityComp: 0 } });
  const arm = rig.part('upperarm_l');
  const cone = arm.limit.cone;

  rig.setMode('ragdoll');                     // no tracking gain at all
  arm.body.setRotation(qFromAxisAngle(Z, 2.9));   // ~166°, far past the cone
  arm.body._torque = { x: 0, y: 0, z: 0 };
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 } });
  const t = arm.body._torque;
  check('a limb past its limit is pushed back even in ragdoll',
    Math.hypot(t.x, t.y, t.z) > 1e-3, `|τ| = ${Math.hypot(t.x, t.y, t.z).toExponential(2)}`);
  check('and the rig reports the violation', rig.state.limitViolations > 0);

  arm.body.setRotation(qFromAxisAngle(Z, 0.2));
  arm.body._torque = { x: 0, y: 0, z: 0 };
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 } });
  const u = arm.body._torque;
  check('and inside its range it contributes nothing at all',
    Math.hypot(u.x, u.y, u.z) < 1e-9 && rig.state.limitViolations === 0);

  // Targets are clamped too. An illegal target sets the tracking torque and the
  // limit torque fighting for as long as the pose stands.
  rig.setMode('pinned');
  rig.setPose(new Map([['upperarm_l', qFromAxisAngle(Z, 3.0)]]));
  const rest = rig.part('upperarm_l').restQ;
  check('an out-of-range target is clamped before it is ever requested',
    swingAngle(qSwingTwist(rest, arm.limit.axis).swing) <= cone + 1e-6,
    `${(swingAngle(qSwingTwist(rest, arm.limit.axis).swing) / DEG).toFixed(1)}°`);

  const off = makeRig({ tuning: { limitsEnabled: false } }).rig;
  off.setPose(new Map([['upperarm_l', qFromAxisAngle(Z, 3.0)]]));
  check('and the switch genuinely turns that off',
    swingAngle(qSwingTwist(off.part('upperarm_l').restQ, arm.limit.axis).swing) > cone);
}
{
  // Hinge targets project onto the joint's own axis and clamp to its range: a
  // revolute motor takes ONE number and cannot express anything else.
  const { rig } = makeRig();
  rig.setPose(new Map([['calf_l', qFromAxisAngle(X, 0.8)]]));
  check('a knee target becomes a scalar angle about its own axis',
    approx(rig.part('calf_l').restAngle, 0.8, 1e-9), `${rig.part('calf_l').restAngle}`);

  rig.setPose(new Map([['calf_l', qFromAxisAngle(X, -1.2)]]));
  check('and a knee asked to bend backwards is clamped to straight',
    approx(rig.part('calf_l').restAngle, DUMMY_HINGES.calf_l.limits[0], 1e-9),
    `${rig.part('calf_l').restAngle}`);

  rig.setPose(new Map([['forearm_l', qFromAxisAngle({ x: -1, y: 0, z: 0 }, 0.9)]]));
  check('an elbow flexes on positive, the same way round as the other arm',
    approx(rig.part('forearm_l').restAngle, 0.9, 1e-9));
}

// ---------------------------------------------------------------------------
console.log('\n8. The gait');
{
  /* No file, no clip, no track names, no bind pose. If the legs are not moving
     it is because this function returned nothing — one place to look. */
  const t0 = gaitTargets(0, 5);
  check('the gait targets every jointed part',
    t0.size === DUMMY_PARTS.length - 1, `${t0.size} of ${DUMMY_PARTS.length - 1}`);
  check('and every target is a unit quaternion',
    [...t0.values()].every((q) => approx(Math.hypot(q.x, q.y, q.z, q.w), 1, 1e-9)));

  const a = gaitTargets(0.5, 5), b = gaitTargets(2.5, 5);
  let moved = 0;
  for (const [id, q] of a) if (qAngleBetween(q, b.get(id)) > 1e-3) moved++;
  check('the pose changes as the phase advances', moved > 6, `${moved} joints moved`);

  // Left and right must be a half-cycle apart, or the dummy hops.
  const half = gaitTargets(Math.PI, 5);
  check('left at phase 0 equals right at phase π',
    qAngleBetween(t0.get('thigh_l'), half.get('thigh_r')) < 1e-9);

  // Amplitude scales with speed, so a standing dummy stands.
  const still = gaitTargets(1.0, 0);
  check('a stationary dummy barely moves its legs',
    qAngleBetween(still.get('thigh_l'), { x: 0, y: 0, z: 0, w: 1 }) < 0.02);
  check('but it still breathes, rather than freezing solid',
    gaitRate(0) > 0);

  // The knee may only ever FLEX. Asking for extension would set the motor and
  // the joint stop pulling against each other for the whole cycle.
  let worstKnee = 0;
  for (let p = 0; p < 6.3; p += 0.05) {
    for (const side of ['l', 'r']) {
      const rv = qToRotationVector(gaitTargets(p, 6).get(`calf_${side}`));
      worstKnee = Math.min(worstKnee, rv.x * DUMMY_HINGES[`calf_${side}`].axis.x);
    }
  }
  check('across the whole cycle the knee never asks to bend backwards',
    worstKnee >= -1e-9, `worst ${worstKnee.toFixed(4)} rad`);

  let worstElbow = 0;
  for (let p = 0; p < 6.3; p += 0.05) {
    for (const side of ['l', 'r']) {
      const rv = qToRotationVector(gaitTargets(p, 6).get(`forearm_${side}`));
      worstElbow = Math.min(worstElbow, rv.x * DUMMY_HINGES[`forearm_${side}`].axis.x);
    }
  }
  check('nor the elbow', worstElbow >= -1e-9, `worst ${worstElbow.toFixed(4)} rad`);

  // Every target must be inside its own cone, or the gait fights the limits for
  // the whole cycle rather than only at the extremes.
  const outside = [];
  for (let p = 0; p < 6.3; p += 0.1) {
    const targets = gaitTargets(p, 8);       // faster than runSpeed: full amplitude
    for (const [id, q] of targets) {
      const lim = DUMMY_LIMITS[id];
      if (!lim) continue;
      const part = DUMMY_PARTS.find((x) => x.id === id);
      const len = Math.hypot(...part.axis) || 1;
      const axis = { x: part.axis[0] / len, y: part.axis[1] / len, z: part.axis[2] / len };
      const st = qSwingTwist(q, axis);
      if (swingAngle(st.swing) > lim.cone * DEG + 1e-9
        || twistAngle(st.twist, axis) > lim.twist[1] * DEG + 1e-9
        || twistAngle(st.twist, axis) < lim.twist[0] * DEG - 1e-9) outside.push(`${id}@${p.toFixed(1)}`);
    }
  }
  check('and no gait target ever leaves its own cone',
    outside.length === 0, outside.slice(0, 4).join(', '));

  check('the cadence is stride-matched to real speed',
    gaitRate(6) > gaitRate(3) && gaitRate(3) > gaitRate(0));
}
{
  const { rig } = makeRig();
  const before = rig.order.map((p) => `${p.restQ.x},${p.restQ.y},${p.restQ.z},${p.restQ.w}`).join('|');
  for (let i = 0; i < 30; i++) rig.animate(1 / 60, 5);
  const after = rig.order.map((p) => `${p.restQ.x},${p.restQ.y},${p.restQ.z},${p.restQ.w}`).join('|');
  check('animate() advances the phase and re-targets the rig', before !== after);
  check('and it reports how many joints it reached',
    rig.state.trackedJoints === DUMMY_PARTS.length - 1);
  check('the phase stays wrapped, so it cannot drift to infinity',
    rig.state.phase >= 0 && rig.state.phase < 2 * Math.PI);
}

// ---------------------------------------------------------------------------
console.log('\n9. Muscle tuning is live');
{
  // gravityComp off: this section measures the TRACKING gain, and the holding
  // torque is a second, correct contribution that would drown the signal.
  const tuning = Object.assign({}, DEFAULT_DUMMY_TUNING, { gravityComp: 0 });
  const { rig } = makeRig({ tuning });
  check("the rig adopts the caller's tuning object rather than copying it",
    rig.tuning === tuning);

  const arm = rig.part('upperarm_l');
  arm.body.setRotation(qFromAxisAngle(Z, 0.15));
  const measure = () => {
    rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, want: 'pinned' });
    const t = arm.body._torque;
    return Math.hypot(t.x, t.y, t.z);
  };
  const base = measure();
  tuning.muscleGain = 2;
  check('the master stiffness multiplier reaches the solver live',
    measure() > base * 1.6);
  tuning.muscleGain = 0;
  check('and zero really does go limp', measure() < base * 0.05);
  tuning.muscleGain = 1;

  arm.body.setRotation({ x: 0, y: 0, z: 0, w: 1 });
  arm.body.setAngvel({ x: 0, y: 0, z: 1 });
  const d1 = measure();
  arm.body.setAngvel({ x: 0, y: 0, z: 1 });
  tuning.muscleDamping = 1.7;
  const d17 = measure();
  check('the master damping multiplier is live as well', d17 > d1 * 1.5);

  arm.body.setAngvel({ x: 0, y: 0, z: 1 });
  tuning.muscleDamping = 8;
  const d8 = measure();
  check('but it is clamped at the integrator ceiling rather than allowed to diverge',
    d8 < d17 * 2 && rig.state.gainsClamped > 0);
  tuning.muscleDamping = 1;
}
{
  const D = DEFAULT_DUMMY_TUNING;
  for (const name of ['spine', 'hip', 'leg', 'arm', 'grip', 'recover', 'limit', 'swing']) {
    const k = D[name + 'Stiffness'], c = D[name + 'Damping'];
    check(`${name} gains are at least critically damped`, c >= 2 * Math.sqrt(k) * 0.9,
      `c=${c}, 2√k=${(2 * Math.sqrt(k)).toFixed(1)}`);
  }
  // Every gain must sit under the integrator ceilings, or a slider silently
  // stops meaning what it says the moment it is used.
  for (const name of ['spine', 'hip', 'leg', 'arm', 'grip', 'swing']) {
    check(`${name} gains are inside the integrator ceilings`,
      D[name + 'Stiffness'] <= D.stiffnessStepLimit * 3600 + 1e-9
      && D[name + 'Damping'] <= D.dampingStepLimit * 60 + 1e-9,
      `k=${D[name + 'Stiffness']} c=${D[name + 'Damping']}`);
  }
  // The point of grouping them: a stance needs stiff legs and loose arms.
  check('hips and legs are much stiffer than the arms',
    D.hipStiffness > D.armStiffness * 2 && D.legStiffness > D.armStiffness * 2);
  check('and the swing is stiffer still, or a hit has no power',
    D.swingStiffness > D.hipStiffness);
}
{
  /* THE CHAIN, which is what actually bounds the gains. One link is a textbook
     second-order system; three coupled links driven by explicit Euler with the
     reaction torque applied upstream is a different problem, and it is the one
     the rig has. */
  const { rig } = makeRig();
  const chain = ['upperarm_l', 'forearm_l', 'hand_l'].map((id) => rig.part(id));
  const D = DEFAULT_DUMMY_TUNING;

  const run = (k0, c0, clamped = true, dt = 1 / 60, steps = 600) => {
    const k = clamped ? Math.min(k0, D.stiffnessStepLimit / (dt * dt)) : k0;
    const c = clamped ? Math.min(c0, D.dampingStepLimit / dt) : c0;
    const I = chain.map((p) => {
      const s = p.spec, m = p.mass;
      if (s.kind === 'box') return m * (s.size[0] ** 2 + s.size[1] ** 2) / 12;
      return m * (3 * s.radius ** 2 + s.length ** 2) / 12;
    });
    const th = [0.6, 0.6, 0.6], om = [0, 0, 0];
    let worst = 0.6;
    for (let step = 0; step < steps; step++) {
      const tau = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        const pt = i === 0 ? 0 : th[i - 1], pw = i === 0 ? 0 : om[i - 1];
        const t = I[i] * (k * (pt - th[i]) - c * (om[i] - pw));
        tau[i] += t;
        if (i > 0) tau[i - 1] -= t;
      }
      for (let i = 0; i < 3; i++) {
        om[i] += (tau[i] / I[i]) * dt; th[i] += om[i] * dt;
        worst = Math.max(worst, Math.abs(th[i]));
      }
    }
    return { worst, settled: th.every((v) => Math.abs(v) < 0.02), finite: th.every(Number.isFinite) };
  };

  const shipped = run(D.armStiffness, D.armDamping);
  check('the shipped gains settle the whole arm chain',
    shipped.finite && shipped.settled, `peak ${shipped.worst.toFixed(3)}`);
  check('without the chain amplifying the initial error', shipped.worst < 0.75);

  const tripled = run(D.swingStiffness, D.swingDamping);
  check('and the SWING gains — the stiffest the arm ever gets — hold together',
    tripled.finite && tripled.worst < 2, `peak ${tripled.worst.toFixed(3)}`);
  check('as does 3x master gain on top of the swing',
    run(D.swingStiffness * 3, D.swingDamping * 3).worst < 2);

  /* NaN-SAFE. A diverging run overflows to Infinity and then to NaN, and
     `NaN > 2` is false — so the obvious spelling of "this should blow up"
     quietly asserts the opposite. Ask whether it stayed BOUNDED instead. */
  const bounded = (r) => r.finite && r.worst < 2;
  check('without the ceilings, the swing gains x3 tear the chain apart',
    !bounded(run(D.swingStiffness * 3, D.swingDamping * 3, false)));
  check('and it is the DAMPING that does it, not the stiffness',
    !bounded(run(D.armStiffness, D.armDamping * 8, false))
    && bounded(run(D.armStiffness * 8, D.armDamping, false)),
    `k×8 peak ${run(D.armStiffness * 8, D.armDamping, false).worst.toFixed(2)}, `
    + `c×8 peak ${run(D.armStiffness, D.armDamping * 8, false).worst}`);
  check('the boundary is where the model says it is — c·dt ≈ 0.85',
    bounded(run(D.armStiffness, 0.84 * 60, false))
    && !bounded(run(D.armStiffness, 1.10 * 60, false)));
}

// ---------------------------------------------------------------------------
console.log('\n9b. Muscle groups and posture');
{
  // Every jointed part must belong to exactly one group, or a joint silently
  // gets the default gain and nothing says so.
  const jointed = DUMMY_PARTS.filter((p) => p.parent).map((p) => p.id);
  const ungrouped = jointed.filter((id) => !GROUP_OF[id]);
  check('every jointed part is in a muscle group', ungrouped.length === 0, ungrouped.join(', '));
  const all = Object.values(GAIN_GROUPS).flat();
  check('and in exactly one', new Set(all).size === all.length);
  check('the groups cover the joints and nothing else',
    all.length === jointed.length && all.every((id) => jointed.includes(id)));
}
{
  const { rig } = makeRig();
  const k = (id) => rig.part(id).gains.stiffness;
  check('hips are stiffer than arms', k('thigh_l') > k('upperarm_l') * 2,
    `${k('thigh_l')} vs ${k('upperarm_l')}`);
  check('knees are stiffer than arms', k('calf_l') > k('upperarm_l') * 2);
  check('the spine is the stiffest of the resting groups',
    k('chest') >= k('thigh_l'));
  check('left and right get identical strength',
    k('thigh_l') === k('thigh_r') && k('upperarm_l') === k('upperarm_r'));

  // The masters still multiply the groups.
  const t2 = Object.assign({}, DEFAULT_DUMMY_TUNING, { muscleGain: 2 });
  const r2 = makeRig({ tuning: t2 }).rig;
  check('the master multiplier scales every group',
    approx(r2.part('thigh_l').gains.stiffness, k('thigh_l') * 2, 1e-9)
    && approx(r2.part('upperarm_l').gains.stiffness, k('upperarm_l') * 2, 1e-9));
}
{
  // POSTURE. spineUpright 1 must hold the torso square against a gait that is
  // actively trying to roll it.
  const { rig } = makeRig();
  const gaitChest = gaitTargets(1.2, 8).get('chest');
  check('the gait really does roll the chest at speed',
    qAngleBetween(gaitChest, { x: 0, y: 0, z: 0, w: 1 }) > 0.02,
    'the test below would be vacuous otherwise');

  rig.state.phase = 1.2;
  rig.animate(0, 8);                                  // dt 0: phase stays put
  check('but with spineUpright at 1 the chest target is square',
    qAngleBetween(rig.part('chest').restQ, { x: 0, y: 0, z: 0, w: 1 }) < 1e-6,
    `${qAngleBetween(rig.part('chest').restQ, { x: 0, y: 0, z: 0, w: 1 }).toFixed(4)} rad`);

  const loose = makeRig({ tuning: { spineUpright: 0 } }).rig;
  loose.state.phase = 1.2;
  loose.animate(0, 8);
  check('and at 0 the gait comes back through',
    qAngleBetween(loose.part('chest').restQ, { x: 0, y: 0, z: 0, w: 1 }) > 0.02);

  const half = makeRig({ tuning: { spineUpright: 0.5 } }).rig;
  half.state.phase = 1.2;
  half.animate(0, 8);
  const a0 = qAngleBetween(loose.part('chest').restQ, { x: 0, y: 0, z: 0, w: 1 });
  const a5 = qAngleBetween(half.part('chest').restQ, { x: 0, y: 0, z: 0, w: 1 });
  check('and it blends in between rather than switching', a5 > 1e-6 && a5 < a0 * 0.75,
    `${a5.toFixed(4)} vs ${a0.toFixed(4)}`);

  // The legs must be untouched by the posture pass.
  check('posture does not touch the legs',
    qAngleBetween(rig.part('thigh_l').restQ, loose.part('thigh_l').restQ) < 1e-9);
}

// ---------------------------------------------------------------------------
console.log('\n9c. Procedural hits');
{
  // The keyposes have to be reachable. A target outside a cone is silently
  // clamped, and then the arm stops somewhere nobody chose for reasons nothing
  // reports — which is exactly what a 100° shoulder cone did to the overhand.
  const armAxis = { x: 0, y: -1, z: 0 };
  const bad = [];
  for (const [kind, pose] of Object.entries(SWING_POSES)) {
    for (const key of ['windup', 'contact', 'follow']) {
      const p = pose[key];
      const sw = swingAngle(qSwingTwist(qFromAxisAngle(ARM_FWD, p.shoulder), armAxis).swing);
      if (sw > DUMMY_LIMITS.upperarm_l.cone * DEG + 1e-9) bad.push(`${kind}.${key} shoulder`);
      const rv = qToRotationVector(qFromAxisAngle(ARM_FWD, p.elbow));
      const el = rv.x * DUMMY_HINGES.forearm_l.axis.x;
      const lim = DUMMY_HINGES.forearm_l.limits;
      if (el < lim[0] - 1e-9 || el > lim[1] + 1e-9) bad.push(`${kind}.${key} elbow`);
    }
  }
  check('every swing keypose is inside the joint limits', bad.length === 0, bad.join(', '));
  check('and the overhand really does go overhead',
    SWING_POSES.spike.windup.shoulder > 2.2,
    `${SWING_POSES.spike.windup.shoulder} rad`);
  check('which the shoulder cone has to allow',
    DUMMY_LIMITS.upperarm_l.cone * DEG > SWING_POSES.spike.windup.shoulder,
    `cone ${DUMMY_LIMITS.upperarm_l.cone}°`);
}
{
  // The weight curve is the whole blend mechanism: on through windup, held
  // through contact, faded through recovery. Nothing else switches.
  check('idle is a no-op', swingTargets('volley', 'idle', 0.5).weight === 0);
  check('an unknown shot is refused rather than throwing',
    swingTargets('headbutt', 'active', 0.5).weight === 0);
  check('the override ramps on through windup',
    swingTargets('volley', 'windup', 0).weight === 0
    && swingTargets('volley', 'windup', 1).weight === 1);
  check('holds through contact',
    swingTargets('volley', 'active', 0).weight === 1
    && swingTargets('volley', 'active', 1).weight === 1);
  check('and fades to nothing by the end of recovery',
    swingTargets('volley', 'recover', 1).weight === 0);
  check('the weight never leaves 0..1', (() => {
    for (const ph of ['windup', 'active', 'recover']) {
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const w = swingTargets('spike', ph, t).weight;
        if (!(w >= 0 && w <= 1)) return false;
      }
    }
    return true;
  })());

  // Continuity across the phase joins. A jump here is a visible snap.
  for (const kind of ['volley', 'spike']) {
    const a = swingTargets(kind, 'windup', 1), b = swingTargets(kind, 'active', 0);
    check(`${kind}: windup hands off to contact without a jump`,
      approx(a.shoulder, b.shoulder, 1e-9) && approx(a.elbow, b.elbow, 1e-9));
    const c = swingTargets(kind, 'active', 1), d = swingTargets(kind, 'recover', 0);
    check(`${kind}: contact hands off to recovery without a jump`,
      approx(c.shoulder, d.shoulder, 1e-9) && approx(c.elbow, d.elbow, 1e-9));
  }

  // Shape: the underhand comes from behind and finishes high; the overhand
  // starts high and finishes low. If these ever invert, the shots have swapped.
  check('the underhand starts behind the body',
    SWING_POSES.volley.windup.shoulder < 0);
  check('and swings forward and up through contact',
    SWING_POSES.volley.contact.shoulder > 0
    && SWING_POSES.volley.follow.shoulder > SWING_POSES.volley.contact.shoulder);
  check('the overhand starts high',
    SWING_POSES.spike.windup.shoulder > SWING_POSES.spike.contact.shoulder);
  check('and slams downward',
    SWING_POSES.spike.follow.shoulder < SWING_POSES.spike.contact.shoulder * 0.5);
  check('with the elbow snapping straight into contact',
    SWING_POSES.spike.contact.elbow < SWING_POSES.spike.windup.elbow * 0.2);

  check('a dig uses both arms', SWING_POSES.volley.both === true);
  check('a spike uses one', SWING_POSES.spike.both === false);
  check('and the off arm still lifts a little for balance',
    swingTargets('spike', 'active', 0.5).offShoulder > 0);
}
{
  const { rig } = makeRig();
  const restK = rig.part('upperarm_r').gains.stiffness;
  const restTarget = { ...rig.part('upperarm_r').restQ };

  check('nothing is hitting to begin with', rig.isHitting === false);
  rig.setSwing({ kind: 'spike', phase: 'active', progress: 0.8 });
  check('setSwing raises isHitting', rig.isHitting === true);
  rig.animate(1 / 60, 0);
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, want: 'pinned' });

  check('the swinging arm leaves its resting target',
    qAngleBetween(rig.part('upperarm_r').restQ, restTarget) > 0.5);
  check('and hardens', rig.part('upperarm_r').gains.stiffness > restK * 2,
    `${restK} → ${rig.part('upperarm_r').gains.stiffness}`);
  check('the OFF arm firms up only a little',
    rig.part('upperarm_l').gains.stiffness < restK * 2
    && rig.part('upperarm_l').gains.stiffness < rig.part('upperarm_r').gains.stiffness * 0.4,
    `off ${rig.part('upperarm_l').gains.stiffness.toFixed(0)} vs `
    + `swinging ${rig.part('upperarm_r').gains.stiffness.toFixed(0)}, rest ${restK}`);
  check('and the legs are not stiffened by a hit — that would lock the stance',
    approx(rig.part('thigh_l').gains.stiffness, DEFAULT_DUMMY_TUNING.hipStiffness));

  rig.setSwing(null);
  rig.animate(1 / 60, 0);
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, want: 'pinned' });
  check('clearing the swing lowers isHitting', rig.isHitting === false);
  check('the arm returns to its resting strength',
    approx(rig.part('upperarm_r').gains.stiffness, restK, 1e-9));
  check('and to its resting target',
    qAngleBetween(rig.part('upperarm_r').restQ, restTarget) < 1e-6);
}
{
  // A hit must never override a knockdown. You cannot spike while face down.
  const { rig } = makeRig();
  rig.setSwing({ kind: 'spike', phase: 'active', progress: 0.5 });
  rig.setMode('ragdoll');
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 } });
  check('a swing does not stiffen a ragdolled arm',
    rig.part('upperarm_r').gains.stiffness === DEFAULT_DUMMY_TUNING.ragdollStiffness);
}
{
  // The whole swing, frame by frame, must stay legal and finite.
  const { rig } = makeRig();
  let bad = 0;
  for (const kind of ['volley', 'spike']) {
    for (const phase of ['windup', 'active', 'recover']) {
      for (let t = 0; t <= 1; t += 0.05) {
        rig.setSwing({ kind, phase, progress: t });
        rig.animate(1 / 60, 4);
        rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, want: 'pinned' });
        for (const p of rig.order) {
          if (!p.joint) continue;
          if (!Number.isFinite(p.restQ.w) || !Number.isFinite(p.gains.stiffness)) bad++;
        }
      }
    }
  }
  check('every frame of every swing stays finite', bad === 0, `${bad} bad values`);
  check('and the rig never reported a limit violation during a legal swing',
    rig.state.limitViolations === 0);
}
{
  // Which arm spikes is a knob, and it has to actually move.
  const left = makeRig({ tuning: { spikeArm: 'l' } }).rig;
  left.setSwing({ kind: 'spike', phase: 'active', progress: 0.8 });
  left.animate(1 / 60, 0);
  left.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, want: 'pinned' });
  check('spikeArm selects which shoulder is driven',
    left.part('upperarm_l').gains.stiffness > left.part('upperarm_r').gains.stiffness);
}
{
  // Slerp, which the posture and swing blends both stand on.
  const a = qFromAxisAngle(Z, 0.4), b = qFromAxisAngle(Z, 1.2);
  check('slerp hits both ends exactly',
    qAngleBetween(qSlerp(a, b, 0), a) < 1e-12 && qAngleBetween(qSlerp(a, b, 1), b) < 1e-12);
  check('and the midpoint is halfway',
    approx(qAngleBetween(a, qSlerp(a, b, 0.5)), 0.4, 1e-9));
  // Shortest arc: a and −a are the same rotation, and interpolating toward the
  // negated one must not travel the long way round through the body.
  const negB = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  check('it takes the short way round even when a sign is flipped',
    qAngleBetween(qSlerp(a, negB, 0.5), qSlerp(a, b, 0.5)) < 1e-9);
  check('and stays a unit quaternion throughout', (() => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const q = qSlerp(a, b, t);
      if (!approx(Math.hypot(q.x, q.y, q.z, q.w), 1, 1e-9)) return false;
    }
    return true;
  })());
  const near = qFromAxisAngle(Z, 0.4000001);
  check('near-parallel inputs do not divide by zero',
    Number.isFinite(qSlerp(a, near, 0.5).w));
}

// ---------------------------------------------------------------------------
console.log('\n9d. Strength: can the motors actually lift the body?');
{
  /* THE ARITHMETIC THAT EXPLAINED THE LIMPNESS. For each joint, compare the
     torque the rig can deliver against the gravity moment of everything hanging
     below it. If available < required, the limb cannot be raised at all, and no
     amount of stiffness fixes it — stiffness sets how hard it TRIES, the cap
     sets how hard it CAN. */
  const { rig } = makeRig({ tuning: { gravityComp: 0 } });
  const dt = 1 / 60;
  const D = DEFAULT_DUMMY_TUNING;
  const kids = {};
  for (const p of DUMMY_PARTS) if (p.parent) (kids[p.parent] ||= []).push(p.id);
  const subtree = (id) => [id, ...(kids[id] || []).flatMap(subtree)];

  const weak = [];
  for (const part of rig.order) {
    if (!part.joint) continue;
    const available = Math.min(partInertiaOf(rig, part) * (D.torqueStepLimit / dt), D.maxTorque);
    // Worst case is the subtree held out horizontally — a leg raised to the
    // side, an arm reaching. That is the pose the character has to be able to
    // hold, not the one where everything hangs conveniently straight down.
    let moment = 0;
    for (const id of subtree(part.id)) {
      const q = DUMMY_PARTS.find((x) => x.id === id);
      moment += q.mass * Math.hypot(q.centre[0] - part.spec.joint[0],
        q.centre[1] - part.spec.joint[1], q.centre[2] - part.spec.joint[2]);
    }
    const required = moment * 9.81;
    if (available < required) weak.push(`${part.id} ${available.toFixed(1)}<${required.toFixed(1)}`);
  }
  check('every joint can lift its own subtree held horizontally',
    weak.length === 0, weak.join(', '));

  // The inertia must be about the JOINT. Using the centre-of-mass value
  // delivered between a third and a quarter of the commanded acceleration on
  // every joint in the rig, which is precisely what "limp" looks like.
  for (const id of ['head', 'thigh_l', 'upperarm_l']) {
    const part = rig.part(id);
    const spec = part.spec;
    const d = Math.hypot(spec.joint[0] - spec.centre[0], spec.joint[1] - spec.centre[1],
      spec.joint[2] - spec.centre[2]);
    const Icm = spec.kind === 'ball' ? 0.4 * part.mass * spec.radius ** 2
      : spec.kind === 'box' ? part.mass * (spec.size[0] ** 2 + spec.size[1] ** 2) / 12
        : part.mass * (3 * spec.radius ** 2 + spec.length ** 2) / 12;
    check(`${id} inertia is about the joint, not the centre of mass`,
      approx(partInertiaOf(rig, part), Icm + part.mass * d * d, 1e-9),
      `${partInertiaOf(rig, part).toFixed(4)} vs I_cm ${Icm.toFixed(4)}`);
  }
  check('which is a large correction, not a rounding one', (() => {
    const part = rig.part('thigh_l');
    const spec = part.spec;
    const Icm = part.mass * (3 * spec.radius ** 2 + spec.length ** 2) / 12;
    return partInertiaOf(rig, part) > Icm * 3;
  })());
}
{
  // The two caps are different things and must be counted separately, because
  // "it will not lift" and "it is unstable" want opposite adjustments.
  const { rig } = makeRig({ tuning: { gravityComp: 0, maxTorque: 0.05 } });
  const arm = rig.part('upperarm_l');
  arm.body.setRotation(qFromAxisAngle(Z, 1.0));
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, want: 'pinned' });
  check('a tiny maxTorque binds and is reported as a STRENGTH cap',
    rig.state.strengthCapped > 0);
  const t = arm.body._torque;
  check('and the applied torque really is limited to it',
    Math.hypot(t.x, t.y, t.z) <= 0.05 + 1e-9,
    `${Math.hypot(t.x, t.y, t.z).toFixed(4)} N·m`);

  const strong = makeRig({ tuning: { gravityComp: 0, maxTorque: 10000 } }).rig;
  strong.part('upperarm_l').body.setRotation(qFromAxisAngle(Z, 1.0));
  strong.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, want: 'pinned' });
  check('a generous one does not bind at all', strong.state.strengthCapped === 0);
  // The saturation is now GENEROUS on purpose — it was the binding constraint on
  // every joint and that is what made the character limp. It should only engage
  // on a genuinely extreme error, which is what it is for.
  check('and the stability saturation no longer binds at ordinary errors',
    strong.state.stepCapped === 0);
  const wild = makeRig({ tuning: { gravityComp: 0, maxTorque: 10000 } }).rig;
  wild.part('upperarm_l').body.setRotation(qFromAxisAngle(Z, 3.0));
  wild.part('upperarm_l').body.setAngvel({ x: 0, y: 0, z: 200 });
  wild.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, want: 'pinned' });
  check('but it still catches a genuinely wild one', wild.state.stepCapped > 0);
  check('0 disables the strength cap entirely',
    makeRig({ tuning: { maxTorque: 0 } }).rig.state.strengthCapped === 0);
}

// ---------------------------------------------------------------------------
console.log('\n9e. Gravity feed-forward');
{
  /* A PD can only hold a limb against gravity by carrying a standing error.
     Cancelling gravity's moment removes the error rather than out-muscling it. */
  const { rig } = makeRig();
  const arm = rig.part('upperarm_l');
  arm.body._torque = { x: 0, y: 0, z: 0 };
  rig.gravityCompensation();
  const t = arm.body._torque;
  check('a hanging limb needs no holding torque — gravity has no moment there',
    Math.hypot(t.x, t.y, t.z) < 1e-9, `${Math.hypot(t.x, t.y, t.z).toExponential(2)}`);

  // Now hold the arm out horizontally: that is where gravity bites.
  arm.body.setRotation(qFromAxisAngle(Z, Math.PI / 2));
  arm.body.setTranslation({ x: 0.245 + 0.14, y: 1.40, z: 0 });
  rig.part('forearm_l').body.setTranslation({ x: 0.245 + 0.41, y: 1.40, z: 0 });
  rig.part('hand_l').body.setTranslation({ x: 0.245 + 0.615, y: 1.40, z: 0 });
  arm.body._torque = { x: 0, y: 0, z: 0 };
  rig.gravityCompensation();
  const t2 = arm.body._torque;
  const mag = Math.hypot(t2.x, t2.y, t2.z);
  check('but a limb held out sideways gets a real holding torque', mag > 1,
    `${mag.toFixed(2)} N·m`);
  // It has to push UP, i.e. oppose gravity. Arm out along +x, gravity −y, so
  // the gravity moment is about −z and the compensation must be about +z.
  check('and it pushes against gravity, not with it', t2.z > 0,
    `(${t2.x.toFixed(2)}, ${t2.y.toFixed(2)}, ${t2.z.toFixed(2)})`);

  /* MAGNITUDE, checked where the arithmetic is unambiguous. The upper arm's
     total is NOT just its own subtree moment: it also carries the elbow's
     equal-and-opposite reaction, exactly as a real shoulder does. So check the
     closed form at the WRIST, which has no child to react against it, and then
     check the third-law bookkeeping separately. */
  const wrist = rig.part('hand_l');
  const wt = wrist.body._torque;
  const wmag = Math.hypot(wt.x, wt.y, wt.z);
  // Hand COM at x 0.860, wrist joint at 0.860 − 0.075 (its own offset, rotated
  // by identity since the hand was not turned) — so the lever is vertical and
  // the moment comes out of the horizontal displacement alone.
  const hand = rig.part('hand_l');
  const jx = hand.body.translation().x + hand.jointOffset.x;
  const expectWrist = hand.mass * 9.81 * Math.abs(hand.body.translation().x - jx);
  check('the wrist torque matches the closed form exactly',
    approx(wmag, expectWrist, Math.max(1e-9, expectWrist * 0.01)),
    `${wmag.toFixed(3)} vs ${expectWrist.toFixed(3)}`);

  // And the shoulder equals its own subtree moment minus the elbow's reaction.
  const elbow = rig.part('forearm_l').body._torque;
  const M = 4.1;
  const comX = (2.3 * (0.245 + 0.14) + 1.3 * (0.245 + 0.41) + 0.5 * (0.245 + 0.615)) / M;
  const own = M * 9.81 * (comX - 0.245);
  check('and the shoulder carries its own moment minus the elbow reaction',
    approx(t2.z, own - elbow.z, 0.02),
    `${t2.z.toFixed(3)} vs ${(own - elbow.z).toFixed(3)}`);
}
{
  // It must scale, switch off, and never survive a knockdown.
  const half = makeRig({ tuning: { gravityComp: 0.5 } }).rig;
  const full = makeRig({ tuning: { gravityComp: 1 } }).rig;
  const bend = (r) => {
    r.part('thigh_l').body.setRotation(qFromAxisAngle(X, 1.2));
    r.part('thigh_l').body._torque = { x: 0, y: 0, z: 0 };
    r.part('calf_l').body.setTranslation({ x: 0.10, y: 0.55, z: 0.35 });
    r.part('foot_l').body.setTranslation({ x: 0.10, y: 0.40, z: 0.55 });
    r.gravityCompensation();
    const t = r.part('thigh_l').body._torque;
    return Math.hypot(t.x, t.y, t.z);
  };
  const h = bend(half), f = bend(full);
  check('half compensation is half the torque', approx(h, f * 0.5, f * 0.02),
    `${h.toFixed(2)} vs ${f.toFixed(2)}`);
  check('and 0 turns it off completely',
    bend(makeRig({ tuning: { gravityComp: 0 } }).rig) < 1e-9);

  const down = makeRig().rig;
  down.setMode('ragdoll');
  check('a ragdoll gets NO compensation — a knockdown must fall, not float',
    bend(down) < 1e-9);

  const limp = makeRig({ tuning: { muscleGain: 0 } }).rig;
  check('and neither does a character with the muscles turned off', bend(limp) < 1e-9);
}
{
  // Newton's third law: the parent carries the reaction, unless it is kinematic.
  const { rig } = makeRig();
  rig.setMode('ragdoll'); rig.setMode('pinned');
  rig.part('forearm_l').body.setTranslation({ x: 0.6, y: 0.99, z: 0 });
  for (const p of rig.order) p.body._torque = { x: 0, y: 0, z: 0 };
  rig.gravityCompensation();
  const child = rig.part('forearm_l').body._torque;
  const parent = rig.part('upperarm_l').body._torque;
  check('the elbow reaction reaches the upper arm',
    Math.hypot(parent.x, parent.y, parent.z) > 1e-9);
  check('and the compensation reports its worst torque',
    rig.state.gravityTorque > 0);
  void child;
}
{
  /* AND THE WIRING. Everything above calls gravityCompensation() by hand, which
     proves the maths and says nothing about whether update() ever runs it — the
     same gap that let a swing pass its unit tests while the page never fed it. */
  const { rig } = makeRig();
  rig.part('upperarm_l').body.setRotation(qFromAxisAngle(Z, Math.PI / 2));
  rig.part('upperarm_l').body.setTranslation({ x: 0.5, y: 1.40, z: 0 });
  rig.part('forearm_l').body.setTranslation({ x: 0.8, y: 1.40, z: 0 });
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, want: 'pinned' });
  check('update() runs the gravity compensation, not just the caller',
    rig.state.gravityTorque > 0, `${rig.state.gravityTorque}`);

  const off = makeRig({ tuning: { gravityComp: 0 } }).rig;
  off.part('upperarm_l').body.setRotation(qFromAxisAngle(Z, Math.PI / 2));
  off.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, want: 'pinned' });
  check('and reports nothing when it is switched off', off.state.gravityTorque === 0);
}
{
  // The upright stabiliser has the same wiring risk.
  const { rig } = makeRig();
  rig.setMode('ragdoll');
  rig.part('pelvis').body.setRotation(qFromAxisAngle(Z, 0.6));
  for (const p of rig.order) p.body._torque = { x: 0, y: 0, z: 0 };
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 } });
  const t = rig.part('pelvis').body._torque;
  check('update() runs the upright stabiliser too', t.z < -1e-3,
    `(${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)})`);
}

// ---------------------------------------------------------------------------
console.log('\n9f. The upright stabiliser');
{
  /* THE PUPPET STRING. It does nothing while the core is pinned — a kinematic
     body ignores torque — which is not a bug but is worth asserting, because it
     is the difference between "the stabiliser is holding him up" and "the pin
     is". */
  const { rig } = makeRig();
  const pelvis = rig.part('pelvis');
  pelvis.body.setRotation(qFromAxisAngle(Z, 0.6));
  pelvis.body._torque = { x: 0, y: 0, z: 0 };
  rig.upright();
  check('pinned, the stabiliser contributes nothing — the pin is what holds him',
    Math.hypot(pelvis.body._torque.x, pelvis.body._torque.y, pelvis.body._torque.z) < 1e-9);

  rig.setMode('ragdoll');
  pelvis.body.setRotation(qFromAxisAngle(Z, 0.6));
  pelvis.body._torque = { x: 0, y: 0, z: 0 };
  rig.upright();
  const t = pelvis.body._torque;
  check('dynamic, it pulls the torso back toward vertical',
    Math.hypot(t.x, t.y, t.z) > 1e-3, `${Math.hypot(t.x, t.y, t.z).toFixed(2)} N·m`);

  /* DIRECTION IS THE WHOLE THING. Tilted about +Z by 0.6, the body's up has
     rotated toward −X, so the correction must be about −Z to bring it back.
     Getting this backwards pushes the torso further over and reads exactly like
     a stabiliser that is merely too weak — which is how the same sign error sat
     unnoticed in the recovery path. */
  check('in the direction that rights it, not the one that tips it', t.z < 0,
    `(${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)})`);

  pelvis.body.setRotation(qFromAxisAngle(X, 0.6));
  pelvis.body._torque = { x: 0, y: 0, z: 0 };
  rig.upright();
  check('and the same on the other axis', rig.part('pelvis').body._torque.x < 0);

  pelvis.body.setRotation({ x: 0, y: 0, z: 0, w: 1 });
  pelvis.body._torque = { x: 0, y: 0, z: 0 };
  rig.upright();
  check('an already-upright torso is left alone',
    Math.hypot(pelvis.body._torque.x, pelvis.body._torque.z) < 1e-9);
  check('and the error is reported', approx(rig.state.uprightError, 0, 1e-9));

  const off = makeRig({ tuning: { uprightStiffness: 0 } }).rig;
  off.setMode('ragdoll');
  off.part('pelvis').body.setRotation(qFromAxisAngle(Z, 0.6));
  off.part('pelvis').body._torque = { x: 0, y: 0, z: 0 };
  off.upright();
  check('0 stiffness disables it', Math.hypot(off.part('pelvis').body._torque.z) < 1e-9);
}
{
  // Cutting the strings must actually cut them, live.
  const tuning = Object.assign({}, DEFAULT_DUMMY_TUNING);
  const { rig } = makeRig({ tuning });
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, want: 'pinned' });
  check('pinned by default', rig.part('pelvis').body.bodyType() === BodyType.KinematicPositionBased);
  tuning.corePinned = false;
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 } });
  check('and the toggle cuts them mid-session',
    rig.part('pelvis').body.bodyType() === BodyType.Dynamic);
  const p = rig.part('pelvis').body.translation();
  rig.update(1 / 60, { spherePos: { x: 9, y: 0.45, z: 0 } });
  check('an unpinned core is no longer teleported to the sphere',
    approx(rig.part('pelvis').body.translation().x, p.x, 1e-9));
  tuning.corePinned = true;
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 } });
  check('and putting them back re-pins it',
    rig.part('pelvis').body.bodyType() === BodyType.KinematicPositionBased);
}
{
  // The neck is its own group and the stiffest thing on the character.
  const { rig } = makeRig();
  check('the neck has its own muscle group', GROUP_OF.head === 'neck');
  check('and is stiffer than the spine it extends',
    rig.part('head').gains.stiffness > rig.part('chest').gains.stiffness);
  check('its target is square, not wherever the gait left it',
    qAngleBetween(rig.part('head').restQ, { x: 0, y: 0, z: 0, w: 1 }) < 1e-9);
}

// ---------------------------------------------------------------------------
console.log('\n9g. Postures: the athletic slide');
{
  /* THE POSE HAS TO BE REACHABLE. A target outside a joint's cone or hinge range
     is silently clamped, and the limb then stops somewhere nobody chose for
     reasons nothing reports — which is exactly what a 100° shoulder cone did to
     the overhand swing. Every posture angle is checked against its own joint. */
  const T = DEFAULT_DUMMY_TUNING;
  const axisOf = (id) => {
    const p = DUMMY_PARTS.find((x) => x.id === id);
    const l = Math.hypot(...p.axis) || 1;
    return { x: p.axis[0] / l, y: p.axis[1] / l, z: p.axis[2] / l };
  };

  const bad = [];
  for (const name of Object.keys(POSTURES)) {
    for (const [id, q] of POSTURES[name].joints(T)) {
      const hinge = DUMMY_HINGES[id];
      if (hinge) {
        const rv = qToRotationVector(q);
        const a = rv.x * hinge.axis.x + rv.y * hinge.axis.y + rv.z * hinge.axis.z;
        if (a < hinge.limits[0] - 1e-9 || a > hinge.limits[1] + 1e-9) {
          bad.push(`${name}.${id} hinge ${a.toFixed(2)} outside [${hinge.limits}]`);
        }
      }
      const lim = DUMMY_LIMITS[id];
      if (lim) {
        const st = qSwingTwist(q, axisOf(id));
        if (swingAngle(st.swing) > lim.cone * DEG + 1e-9) {
          bad.push(`${name}.${id} swing ${(swingAngle(st.swing) / DEG).toFixed(0)}° > ${lim.cone}°`);
        }
        const tw = twistAngle(st.twist, axisOf(id)) / DEG;
        if (tw < lim.twist[0] - 1e-6 || tw > lim.twist[1] + 1e-6) {
          bad.push(`${name}.${id} twist ${tw.toFixed(0)}° outside [${lim.twist}]`);
        }
      }
    }
  }
  check('every posture angle is inside its joint limits', bad.length === 0, bad.join('; '));
}
{
  // THE ASYMMETRY IS THE FEATURE. A body tilted back as one rigid piece reads as
  // a mannequin toppling; what makes it athletic is the two legs doing different
  // jobs. Assert they actually differ, or the pose is the thing it replaced.
  const T = DEFAULT_DUMMY_TUNING;
  const j = POSTURES.slide.joints(T);
  const lead = T.slideLeadLeg, tuck = lead === 'l' ? 'r' : 'l';

  check('the two hips are at different angles',
    qAngleBetween(j.get(`thigh_${lead}`), j.get(`thigh_${tuck}`)) > 0.3,
    `${(qAngleBetween(j.get(`thigh_${lead}`), j.get(`thigh_${tuck}`)) / DEG).toFixed(0)}° apart`);
  check('and the two knees are too',
    qAngleBetween(j.get(`calf_${lead}`), j.get(`calf_${tuck}`)) > 0.8);

  // Directions, not just difference: the lead leg goes OUT, the tucked one folds.
  const hipFlex = (id) => {
    const rv = qToRotationVector(j.get(id));
    return rv.x * LEG_FWD.x + rv.y * LEG_FWD.y + rv.z * LEG_FWD.z;
  };
  check('both hips flex FORWARD, not backward',
    hipFlex(`thigh_${lead}`) > 0 && hipFlex(`thigh_${tuck}`) > 0,
    `${hipFlex(`thigh_${lead}`).toFixed(2)} / ${hipFlex(`thigh_${tuck}`).toFixed(2)}`);
  check('the leading hip is the further forward of the two',
    hipFlex(`thigh_${lead}`) > hipFlex(`thigh_${tuck}`));
  check('and matches the tuning',
    approx(hipFlex(`thigh_${lead}`), T.slideLeadHip * DEG, 1e-6));

  const kneeBend = (id) => {
    const rv = qToRotationVector(j.get(id));
    return rv.x * DUMMY_HINGES[id].axis.x;
  };
  check('the leading knee is locked straight',
    approx(kneeBend(`calf_${lead}`), 0, 1e-9), `${kneeBend(`calf_${lead}`)}`);
  check('while the tucked knee is heavily folded',
    kneeBend(`calf_${tuck}`) > 85 * DEG, `${(kneeBend(`calf_${tuck}`) / DEG).toFixed(0)}°`);

  // ARMS thrown BACK, and mirrored so they open rather than both going one way.
  const armBack = (id) => {
    const rv = qToRotationVector(j.get(id));
    return -(rv.x * ARM_FWD.x + rv.y * ARM_FWD.y + rv.z * ARM_FWD.z);
  };
  check('both arms are thrown backward', armBack('upperarm_l') > 0 && armBack('upperarm_r') > 0,
    `${(armBack('upperarm_l') / DEG).toFixed(0)}° / ${(armBack('upperarm_r') / DEG).toFixed(0)}°`);
  const outL = qRotate(j.get('upperarm_l'), { x: 0, y: -1, z: 0 });
  const outR = qRotate(j.get('upperarm_r'), { x: 0, y: -1, z: 0 });
  check('and they open outward, mirrored rather than both to one side',
    outL.x > 0.05 && outR.x < -0.05,
    `left x ${outL.x.toFixed(2)}, right x ${outR.x.toFixed(2)}`);

  // Swapping the leading leg has to actually swap it.
  const swapped = POSTURES.slide.joints({ ...T, slideLeadLeg: 'r' });
  check('slideLeadLeg swaps which leg leads',
    qAngleBetween(swapped.get('thigh_r'), j.get(`thigh_${lead}`)) < 1e-9);
}
{
  // THE TORSO. Backward, and the sign is the thing most likely to be wrong.
  check('the slide leans the chest BACK, the dive tips it forward',
    POSTURES.slide.lean < 0 && POSTURES.dive.lean > 0);

  const { rig } = makeRig();
  rig.setSlide(1, 1);                                  // dt 1 s: fully committed
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, facingAngle: 0, want: 'pinned' });
  const up = qRotate(rig.part('chest').body.rotation(), { x: 0, y: 1, z: 0 });
  check('and the pinned torso really is tipped backward',
    up.z < -0.5, `chest up = (${up.x.toFixed(2)}, ${up.y.toFixed(2)}, ${up.z.toFixed(2)})`);
  check('by about the angle asked for',
    Math.abs(Math.acos(clampT(up.y)) / DEG - DEFAULT_DUMMY_TUNING.slideLean) < 3,
    `${(Math.acos(clampT(up.y)) / DEG).toFixed(1)}°`);

  // The hips drop to the posture's FLOOR, in metres above the deck.
  const pelvisY = rig.part('pelvis').body.translation().y;
  check('the hips drop toward the deck rather than rising',
    pelvisY < 0.45 + DEFAULT_DUMMY_TUNING.coreLift - 0.05, `${pelvisY.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
console.log('\nP1b. The authored-clip layer sits UNDER the postures');
{
  /* THE PROPERTY THE WHOLE INTEGRATION RESTS ON. An authored clip supplies the
     BASE pose; the postures and the swing compose on top of it. If the clip
     layer ran last it would overwrite them, and the dive lay-out, the slide's
     asymmetric tuck and both swings — all of which are authored in code and
     tuned against the motors — would silently stop happening the moment a file
     was dropped on the page. */
  const clipQ = qFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.8);
  const pose = new Map([['thigh_l', clipQ], ['upperarm_l', clipQ], ['calf_r', clipQ]]);

  const plain = makeRig().rig;
  plain.setClipPose(pose, 1);
  const base = plain.composeTargets(0, DEFAULT_GAIT);
  check('with nothing else active, the clip owns the target',
    qAngleBetween(base.get('thigh_l'), clipQ) < 1e-9,
    `${(qAngleBetween(base.get('thigh_l'), clipQ) * 180 / Math.PI).toFixed(3)}°`);

  // Now a posture on top: the SLIDE moves the thighs, and it must win.
  const slid = makeRig().rig;
  slid.setClipPose(pose, 1);
  slid.setSlide(1, 1);
  const withPosture = slid.composeTargets(0, DEFAULT_GAIT);
  check('a posture overrides the clip on the joints it owns',
    qAngleBetween(withPosture.get('thigh_l'), clipQ) > 0.3,
    `${(qAngleBetween(withPosture.get('thigh_l'), clipQ) * 180 / Math.PI).toFixed(1)}° from the clip`);
  check('NEGATIVE CONTROL: without the posture, the same joint is the clip\'s',
    qAngleBetween(base.get('thigh_l'), clipQ) < 1e-9);

  // And a swing on top of that: the arms belong to the shot.
  const swung = makeRig().rig;
  swung.setClipPose(pose, 1);
  swung.setSwing({ kind: 'spike', phase: 'active', progress: 0.5 });
  const withSwing = swung.composeTargets(0, DEFAULT_GAIT);
  check('a swing overrides the clip on the arm it uses',
    qAngleBetween(withSwing.get('upperarm_l'), clipQ) > 0.3,
    `${(qAngleBetween(withSwing.get('upperarm_l'), clipQ) * 180 / Math.PI).toFixed(1)}°`);
  check('but a joint neither of them touches is still the clip\'s',
    qAngleBetween(withSwing.get('calf_r'), clipQ) < 1e-9,
    `${(qAngleBetween(withSwing.get('calf_r'), clipQ) * 180 / Math.PI).toFixed(3)}°`);

  // Weight 0 and a null pose both mean "procedural only", exactly.
  const off = makeRig().rig;
  const sig = (r) => [...r.composeTargets(0, DEFAULT_GAIT).entries()]
    .map(([k, q]) => `${k}:${q.x.toFixed(9)},${q.y.toFixed(9)},${q.z.toFixed(9)},${q.w.toFixed(9)}`).join('|');
  const clean = sig(off);
  off.setClipPose(pose, 0);
  check('clip weight 0 leaves the procedural targets bit-identical', sig(off) === clean);
  off.setClipPose(null, 1);
  check('and so does a null pose', sig(off) === clean);
  off.setClipPose(new Map(), 1);
  check('and an empty one', sig(off) === clean);
  off.setClipPose(pose, 1);
  check('NEGATIVE CONTROL: a real pose at full weight DOES change them',
    sig(off) !== clean);
}

// ---------------------------------------------------------------------------
console.log('\nP2. The hover: pelvis height is an absolute floor, not a lean');
{
  /* THE BUG THIS REPLACED. The lift used to be

         lift = coreLift * (1 - liftDrop * |sin(lean)|)

     so it was COUPLED to the lean angle. A slide leans 45°, |sin| = 0.71, and a
     0.34 drop worked out to 0.76 x standing height — the athlete slid along at
     three-quarters of full height, on nothing. It is now a straight
     interpolation toward an absolute floor in metres, and the lean does not
     enter into it. */
  const DT2 = DEFAULT_DUMMY_TUNING;
  const GROUND = 0.45;
  const pin = (rig) => rig.update(1 / 60,
    { spherePos: { x: 0, y: GROUND, z: 0 }, facingAngle: 0, want: 'pinned' });

  const stand = makeRig().rig;
  pin(stand);
  check('standing, the pin commands full height',
    approx(stand.state.coreLiftNow, DT2.coreLift, 1e-9), `${stand.state.coreLiftNow}`);

  const slid = makeRig().rig;
  slid.setSlide(1, 1);
  pin(slid);
  check('a committed slide commands the slide floor exactly',
    approx(slid.state.coreLiftNow, DT2.slideLiftFloor, 1e-9),
    `${slid.state.coreLiftNow} vs ${DT2.slideLiftFloor}`);

  const dove = makeRig().rig;
  dove.setDive(1, 1);
  pin(dove);
  check('a committed dive commands the dive floor exactly',
    approx(dove.state.coreLiftNow, DT2.diveLiftFloor, 1e-9),
    `${dove.state.coreLiftNow} vs ${DT2.diveLiftFloor}`);

  check('and a dive goes lower than a slide — one leg is folded under a slide',
    DT2.diveLiftFloor < DT2.slideLiftFloor);
  check('both are a small fraction of standing height, which is the whole fix',
    DT2.diveLiftFloor < DT2.coreLift * 0.25 && DT2.slideLiftFloor < DT2.coreLift * 0.4,
    `${DT2.diveLiftFloor} / ${DT2.slideLiftFloor} vs ${DT2.coreLift}`);

  // NEGATIVE CONTROL for the decoupling: change the LEAN and the height must
  // not move. Under the old formula this was the whole problem.
  const leanA = makeRig({ tuning: { slideLean: 20 } }).rig;
  leanA.setSlide(1, 1); pin(leanA);
  const leanB = makeRig({ tuning: { slideLean: 75 } }).rig;
  leanB.setSlide(1, 1); pin(leanB);
  check('NEGATIVE CONTROL: the lean angle no longer moves the body up or down',
    approx(leanA.state.coreLiftNow, leanB.state.coreLiftNow, 1e-9),
    `${leanA.state.coreLiftNow} vs ${leanB.state.coreLiftNow}`);

  // And the actual pelvis follows the command down to the deck.
  const abovePin = dove.part('pelvis').body.translation().y - GROUND;
  check('the pelvis really ends up near the floor in a dive',
    abovePin < 0.35, `${abovePin.toFixed(3)} m above the deck`);
  check('NEGATIVE CONTROL: standing, it is nowhere near',
    stand.part('pelvis').body.translation().y - GROUND > DT2.coreLift * 0.8,
    `${(stand.part('pelvis').body.translation().y - GROUND).toFixed(3)}`);

  // Partial weight interpolates rather than snapping — the body sinks in.
  // Stepped a few frames rather than one big dt: the weight slews at
  // `slideLeanRate`, so a single huge step lands at either end and proves
  // nothing about the middle.
  const half = makeRig().rig;
  for (let i = 0; i < 4; i++) half.setSlide(1, 1 / 60);
  pin(half);
  const w = half.state.posture.slide;
  check('a partly-committed slide is partly dropped',
    w > 0.05 && w < 0.95
    && half.state.coreLiftNow < DT2.coreLift - 1e-6
    && half.state.coreLiftNow > DT2.slideLiftFloor + 1e-6,
    `weight ${w.toFixed(2)} -> lift ${half.state.coreLiftNow.toFixed(3)}`);

  // Two postures at once must not stack their drops through the floor.
  const both = makeRig().rig;
  both.setDive(1, 1); both.setSlide(1, 1);
  pin(both);
  check('blending both postures never drives the pelvis below the lowest floor',
    both.state.coreLiftNow >= Math.min(DT2.diveLiftFloor, DT2.slideLiftFloor) - 1e-9,
    `${both.state.coreLiftNow}`);
}
{
  // RESTORATION. Letting go must put everything back, and fast.
  const { rig } = makeRig();
  const restThighL = { ...rig.part('thigh_l').restQ };

  rig.setSlide(1, 1);
  rig.animate(1 / 60, 0);
  check('the slide moves the leading hip well off its resting target',
    qAngleBetween(rig.part('thigh_l').restQ, restThighL) > 0.8);

  // Three frames is the budget: the brief asked for an immediate revert, and a
  // genuinely instantaneous target change lurches a PD rig.
  for (let i = 0; i < 3; i++) { rig.setSlide(0, 1 / 60); rig.animate(1 / 60, 0); }
  check('and releasing it reverts within about three frames',
    rig.state.slide < 0.05, `${rig.state.slide.toFixed(3)}`);
  check('with the joint targets back where they started',
    qAngleBetween(rig.part('thigh_l').restQ, restThighL) < 0.05,
    `${qAngleBetween(rig.part('thigh_l').restQ, restThighL).toFixed(3)} rad`);
  check('and the torso upright again', Math.abs(rig.state.slide) < 0.05);

  // It must come ON more gently than it goes off, or the fold looks snapped.
  check('the release is faster than the entry',
    POSTURES.slide.releaseRate > POSTURES.slide.rate);
}
{
  // Postures must not stack. The action machine guarantees exclusivity, but the
  // maths has to be well-defined either way — a body half-diving and half-sliding
  // should not end up leaning a meaningless average.
  const { rig } = makeRig();
  rig.setDive(1, 1);
  rig.setSlide(1, 1);
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, facingAngle: 0, want: 'pinned' });
  check('both postures at once stays finite rather than exploding',
    Number.isFinite(rig.part('chest').body.rotation().w));
  check('and every joint target survives it',
    rig.order.filter((p) => p.joint).every((p) => Number.isFinite(p.restQ.w)));
}
{
  // A posture stands the upright stabiliser down: two controllers pulling
  // opposite ways on one torso is the definition of stiff.
  const { rig } = makeRig();
  rig.setMode('ragdoll');
  const measure = () => {
    rig.part('pelvis').body.setRotation(qFromAxisAngle(Z, 0.6));
    rig.part('pelvis').body._torque = { x: 0, y: 0, z: 0 };
    rig.upright();
    const t = rig.part('pelvis').body._torque;
    return Math.hypot(t.x, t.y, t.z);
  };
  const free = measure();
  rig.setSlide(1, 1);
  const held = measure();
  check('the stabiliser stands down while a posture is commanding a lean',
    held < free * 0.1, `${free.toFixed(1)} → ${held.toFixed(1)} N·m`);
  rig.setSlide(0, 1);
  check('and comes back when the posture releases',
    approx(measure(), free, free * 0.02));
}

// ---------------------------------------------------------------------------
console.log('\n10. Mass, feet and rails');
{
  const plan = planDummyMass(DUMMY_PARTS, 10);
  check('the torso outweighs the heaviest limb by the asked-for ratio',
    approx(plan.ratioAfter, 10, 1e-6), `${plan.ratioAfter.toFixed(3)}`);
  check('and it was not already there', plan.ratioBefore < 10);
  check('limbs are untouched — ball contact must not change',
    DUMMY_PARTS.filter((p) => !DUMMY_TORSO.includes(p.id))
      .every((p) => approx(plan.massOf(p), p.mass)));
  check('mass is only ever added, never removed', plan.totalAfter >= plan.totalBefore);
  check('ratio 0 disables it exactly', planDummyMass(DUMMY_PARTS, 0).scale === 1);

  const { rig } = makeRig();
  check('the built rig carries the scaled masses',
    approx(rig.mass, rig.massPlan.totalAfter, 1e-9));
}
{
  const { rig, created } = makeRig();
  const footCols = created.colliders.filter((c) => c.d.rule !== undefined);
  check('the feet ask for the Min friction rule', footCols.length === 2);
  check('so the floor cannot override a slippery foot',
    footCols.every((c) => c.d.rule === 1));

  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, moving: false });
  check('a still dummy has grippy feet',
    approx(rig.state.footFriction, DEFAULT_DUMMY_TUNING.footFrictionPlanted));
  const foot = rig.part('foot_l');
  const writes = foot.collider.nFriction;
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, moving: true });
  check('and a moving one has slippery ones',
    approx(rig.state.footFriction, DEFAULT_DUMMY_TUNING.footFrictionMoving));
  check('the change reaches the collider, not just the state object',
    approx(foot.collider.friction, DEFAULT_DUMMY_TUNING.footFrictionMoving));
  const after = foot.collider.nFriction;
  for (let i = 0; i < 20; i++) rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, moving: true });
  check('but it is not re-written every frame', foot.collider.nFriction === after);
  check('and it did change exactly once on the transition', after === writes + 1);

  check('hands keep normal friction',
    approx(rig.part('hand_l').collider.friction, DEFAULT_DUMMY_TUNING.friction));
}
{
  const { rig } = makeRig({ tuning: { limbMaxSpin: 5, limbMaxSpeed: 4 } });
  const arm = rig.part('upperarm_l');
  arm.body.setAngvel({ x: 0, y: 0, z: 90 });
  arm.body.setLinvel({ x: 40, y: 0, z: 0 });
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 } });
  const w = arm.body.angvel(), v = arm.body.linvel();
  check('limb spin is capped', approx(Math.hypot(w.x, w.y, w.z), 5, 1e-6));
  check('limb speed is capped', approx(Math.hypot(v.x, v.y, v.z), 4, 1e-6));
  check('capping shortens the vector without turning it', w.z > 0 && v.x > 0);
  check('and the cap is reported', rig.state.capped >= 2);

  const un = makeRig({ tuning: { limbMaxSpin: 0, limbMaxSpeed: 0 } }).rig;
  un.part('upperarm_l').body.setAngvel({ x: 0, y: 0, z: 90 });
  un.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 } });
  check('0 disables the caps entirely', approx(un.part('upperarm_l').body.angvel().z, 90));
}

// ---------------------------------------------------------------------------
console.log('\n11. Modes, sync and teardown');
{
  const { rig } = makeRig();
  check('it starts pinned', rig.mode === 'pinned');
  for (const m of DUMMY_MODES) rig.setMode(m);
  check('every mode is reachable', rig.mode === DUMMY_MODES[DUMMY_MODES.length - 1]);
  check('an unknown mode is refused rather than throwing', rig.setMode('banana') === false);

  rig.setMode('ragdoll');
  check('ragdoll makes the core dynamic',
    rig.order.filter((p) => p.isCore).every((p) => p.body.bodyType() === BodyType.Dynamic));
  rig.setMode('pinned');
  check('and pinning makes it kinematic again',
    rig.order.filter((p) => p.isCore)
      .every((p) => p.body.bodyType() === BodyType.KinematicPositionBased));

  // The pin has to carry the core to the sphere, or the dummy stands somewhere
  // other than where the game thinks it is.
  rig.update(1 / 60, { spherePos: { x: 3, y: 0.45, z: -2 }, facingAngle: 0, want: 'pinned' });
  const t = rig.part('pelvis').body.translation();
  check('the pinned core follows the locomotion sphere',
    approx(t.x, 3, 1e-6) && approx(t.z, -2, 1e-6), `${t.x}, ${t.z}`);
  check('and stands the pelvis at the configured lift',
    approx(t.y, 0.45 + DEFAULT_DUMMY_TUNING.coreLift, 1e-6), `${t.y}`);

  // Facing has to rotate the core, or the dummy moon-walks.
  rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, facingAngle: Math.PI / 2, want: 'pinned' });
  const r = rig.part('chest').body.rotation();
  check('and turning the athlete turns the core',
    approx(qAngleBetween(r, qFromAxisAngle(Y, Math.PI / 2)), 0, 1e-6));
}
{
  const { rig } = makeRig();
  const arm = rig.part('upperarm_l');
  arm.body.setTranslation({ x: 5, y: 6, z: 7 });
  arm.body.setRotation(qFromAxisAngle(Z, 1));
  rig.sync();
  check('sync welds the mesh to the body', approx(arm.mesh.position.x, 5)
    && approx(arm.mesh.position.y, 6) && approx(arm.mesh.position.z, 7));
  check('rotation too', approx(arm.mesh.quaternion.z, Math.sin(0.5), 1e-9));
}
{
  const { rig, created } = makeRig();
  rig.part('upperarm_l').body.setTranslation({ x: 9, y: 9, z: 9 });
  rig.part('upperarm_l').body.setAngvel({ x: 1, y: 2, z: 3 });
  rig.reset();
  const p = rig.part('upperarm_l');
  check('reset puts every body back on its authored stance',
    approx(p.body.translation().y, p.restCentre.y, 1e-9));
  check('with the velocities cleared', approx(p.body.angvel().x, 0));
  check('and the targets back to standing', approx(p.restQ.w, 1));

  const before = created.bodies.length;
  rig.destroy();
  check('destroy releases every body', created.bodies.length === before - DUMMY_PARTS.length);
  check('and every joint', created.joints.length === 0);
}
{
  const { rig } = makeRig();
  let threw = false;
  try {
    for (let i = 0; i < 3000; i++) {
      const mode = DUMMY_MODES[i % 3];
      rig.animate(1 / 60, (i % 120) * 0.1);
      rig.update(1 / 60, {
        spherePos: { x: Math.sin(i * 0.01) * 4, y: 0.45, z: 0 },
        facingAngle: i * 0.01, want: mode, moving: i % 2 === 0,
      });
      rig.sync();
    }
  } catch (e) { threw = true; console.log('   threw:', e.message); }
  check('3000 frames across every mode never throw', !threw);
  check('and every body stays finite',
    rig.order.every((p) => Number.isFinite(p.body.translation().y)
      && Number.isFinite(p.body.rotation().w)));
  check('every target stays a unit quaternion',
    rig.order.filter((p) => p.joint).every((p) =>
      approx(Math.hypot(p.restQ.x, p.restQ.y, p.restQ.z, p.restQ.w), 1, 1e-6)));
  check('and zero and long timesteps are tolerated', (() => {
    try {
      rig.update(0, { spherePos: { x: 0, y: 0.45, z: 0 } });
      rig.update(5, { spherePos: { x: 0, y: 0.45, z: 0 } });
      return rig.order.every((p) => Number.isFinite(p.body.rotation().w));
    } catch (e) { return false; }
  })());
}

// ---------------------------------------------------------------------------
console.log('\n12. Actions are forces, not poses');
{
  const { rig } = makeRig();
  check('a volley swings the left arm', rig.swing('l', 'volley'));
  const upper = rig.part('upperarm_l').body._imp;
  check('by applying a torque impulse, so it does not linger in the accumulator',
    upper && Math.abs(upper.x) > 0);
  check('and it reaches down the chain to the hand',
    rig.part('hand_l').body._imp && Math.abs(rig.part('hand_l').body._imp.x) > 0);
  check('with the shoulder driven hardest',
    Math.abs(upper.x) > Math.abs(rig.part('hand_l').body._imp.x));

  const before = rig.part('upperarm_r').body._imp
    ? rig.part('upperarm_r').body._imp.x : 0;
  rig.swing('r', 'spike');
  check('a spike swings the opposite way to a volley',
    Math.sign(rig.part('upperarm_r').body._imp.x - before) === -Math.sign(upper.x));

  check('an unknown side is refused rather than throwing', rig.swing('q', 'volley') === false);
  check('bracing pushes both arms out', rig.brace());
  check('an impulse can be aimed at any single body', rig.impulse('head', { x: 1, y: 0, z: 0 }));
  check('and an unknown body is refused', rig.impulse('tail', { x: 1, y: 0, z: 0 }) === false);
}

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
console.log('NOTE: solver stability with 14 joints is NOT covered here — that needs');
console.log('      real Rapier. A green suite is not a stability claim.\n');
process.exit(fail ? 1 : 0);
