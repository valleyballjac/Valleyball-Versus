/**
 * probe-hit.mjs
 * ---------------------------------------------------------------------------
 * Runs the BUILT page against stubs with a Rapier mock that tracks positions
 * and impulses, then presses the hit key with the ball sitting where it really
 * ends up. Reports exactly which link in the chain breaks:
 *
 *   key event → input.sample → pending latch → actions.tryHit
 *   → contact window opens → reach test → applyImpulse
 *
 *   node probe-hit.mjs [path-to-built.html]
 */
import fs from 'node:fs';

const FILE = process.argv[2] || './valleyball-character-controller.html';
const html = fs.readFileSync(FILE, 'utf8');
let source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');

const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const trace = { impulses: [], rayCalls: 0, bodies: [] };

/* --- DOM ---------------------------------------------------------------- */
const listeners = {}, winListeners = {}, elements = new Map();
const makeEl = (id) => ({
  id, tagName: 'DIV', textContent: '', innerHTML: '', value: '', files: null,
  style: new Proxy({}, { get: (t, k) => t[k] ?? '', set: (t, k, v) => { t[k] = v; return true; } }),
  // Set-backed, and it has `toggle`. A stub missing a DOM method the page uses
  // does not report a missing method — it throws mid-frame and the probe dies
  // reporting nothing about the thing it was actually measuring.
  classList: (() => {
    const set = new Set();
    return {
      add(...c) { c.forEach((x) => set.add(x)); },
      remove(...c) { c.forEach((x) => set.delete(x)); },
      contains: (c) => set.has(c),
      toggle(c, force) {
        const on = force === undefined ? !set.has(c) : !!force;
        if (on) set.add(c); else set.delete(c);
        return on;
      },
    };
  })(),
  children: [], appendChild(c) { this.children.push(c); return c; }, remove() {},
  addEventListener(type, fn) { (listeners[id] ||= {})[type] = fn; },
  setAttribute() {}, getContext: () => ({}),
});
const document = {
  body: makeEl('body'), documentElement: makeEl('html'), activeElement: null,
  createElement: (t) => makeEl('el:' + t), createElementNS: (n, t) => makeEl('el:' + t),
  getElementById: (id) => (ids.has(id) ? (elements.get(id) || elements.set(id, makeEl(id)).get(id)) : null),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener(t, fn) { winListeners[t] = fn; },
};
let rafCb = null;
const globalWindow = {
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  // The page installs boot diagnostics in a classic script this probe does not
  // run; stub the two hooks the module calls so the probe stays focused on the
  // hit chain rather than on start-up reporting (audit-shell.mjs covers that).
  __boot: { stage: '', done: false, reported: false },
  __bootStage() {}, __bootFail() {},
  WebGL2RenderingContext: function () {},
  addEventListener(t, fn) { winListeners[t] = fn; }, removeEventListener() {},
  requestAnimationFrame(fn) { rafCb = fn; return 1; },
  setTimeout: () => 0, clearTimeout: () => {},
  navigator: { getGamepads: () => [] },
};

/* --- three.js (only what the shell touches) ------------------------------ */
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  setScalar(s) { this.x = this.y = this.z = s; return this; }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x ** 2 + this.y ** 2 + this.z ** 2; }
  normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  crossVectors(a, b) { this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; return this; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  applyQuaternion() { return this; }
}
class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; }
  copy(q) { return this.set(q.x, q.y, q.z, q.w); }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  setFromEuler() { return this; } setFromAxisAngle() { return this; }
}
class Obj3D {
  constructor() {
    this.position = new V3(); this.quaternion = new Quat(); this.scale = new V3(1, 1, 1);
    this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, copy() { return this; } };
    this.children = []; this.visible = true; this.castShadow = false; this.receiveShadow = false;
    // Real Object3D always carries this; the demo stores per-mesh debug state on it.
    this.userData = {};
    this.matrixWorld = { decompose() { return this; } };
  }
  add(...o) { this.children.push(...o); return this; }
  remove() { return this; }
  traverse(fn) { fn(this); this.children.forEach((c) => c.traverse && c.traverse(fn)); }
  lookAt() {} getWorldDirection(v) { return v.set(0, 0, -1); }
  updateProjectionMatrix() {} updateMatrixWorld() {} updateWorldMatrix() {}
}
class Geo { dispose() {} }
class Col { constructor(c) { this.value = c; } setHex(v) { this.value = v; return this; } set() { return this; } }
class Mat { constructor(o = {}) { Object.assign(this, o); this.color = new Col(o.color); } dispose() {} }
const THREE = {
  Vector2: class { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } },
  Vector3: V3, Quaternion: Quat, Euler: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
  Object3D: Obj3D, Group: Obj3D,
  // Skinning + matrices, for the physical puppet the page now builds at start-up.
  // This probe only cares about the hit chain, so these are the minimum that
  // lets the page reach it — audit-shell.mjs is where the rig is exercised.
  Bone: class extends Obj3D { constructor() { super(); this.isBone = true; } },
  SkinnedMesh: class extends Obj3D {
    constructor(g, m) { super(); this.geometry = g; this.material = m; this.isSkinnedMesh = true; }
    bind(sk) { this.skeleton = sk; }
  },
  Skeleton: class { constructor(b) { this.bones = b; } update() {} },
  // The hidden armature authors clips at start-up. This probe is about the hit
  // chain, so the animation stubs only need to let the page reach it —
  // audit-shell.mjs is where the tracking is actually exercised.
  QuaternionKeyframeTrack: class { constructor(n, t, v) { Object.assign(this, { name: n, times: t, values: v }); } },
  AnimationClip: class { constructor(n, d, t) { Object.assign(this, { name: n, duration: d, tracks: t }); } },
  LoopRepeat: 2201,
  BufferGeometry: class { constructor() { this.attributes = {}; } setAttribute(n, a) { this.attributes[n] = a; } computeVertexNormals() {} computeBoundingSphere() {} dispose() {} },
  Float32BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } },
  Uint16BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } },
  Matrix4: class {
    copy() { return this; } invert() { return this; }
    compose() { return this; } premultiply() { return this; } decompose() { return this; }
  },
  Mesh: class extends Obj3D { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isMesh = true; } },
  BoxGeometry: Geo, SphereGeometry: Geo, CapsuleGeometry: Geo, ConeGeometry: Geo,
  CylinderGeometry: Geo, PlaneGeometry: Geo, TorusGeometry: Geo, RingGeometry: Geo, CircleGeometry: Geo,
  MeshStandardMaterial: Mat, MeshBasicMaterial: Mat, Color: Col,
  AmbientLight: Obj3D, GridHelper: Obj3D,
  DirectionalLight: class extends Obj3D { constructor() { super(); this.shadow = { mapSize: { set() {} }, camera: {}, bias: 0 }; } },
  ArrowHelper: class extends Obj3D { setDirection() {} setLength() {} setColor() {} },
  AxesHelper: class extends Obj3D {
    constructor(size = 1) { super(); this.size = size; this.geometry = new Geo(); this.material = new Mat(); }
  },
  Scene: class extends Obj3D { constructor() { super(); this.background = null; this.fog = null; } },
  Fog: class {}, PerspectiveCamera: class extends Obj3D { constructor(f, a) { super(); this.fov = f; this.aspect = a; } },
  OrthographicCamera: class extends Obj3D { constructor(l, r, t, b) { super(); Object.assign(this, { left: l, right: r, top: t, bottom: b }); this.isOrthographicCamera = true; } },
  WebGLRenderer: class { constructor() { this.domElement = makeEl('canvas'); this.shadowMap = {}; } setPixelRatio() {} setSize() {} render() {} },
  Raycaster: class { setFromCamera() {} intersectObjects() { return []; } },
  Clock: class { getDelta() { return 1 / 60; } },
  AnimationMixer: class { clipAction() { const a = { setLoop: () => a, setEffectiveWeight: () => a, setEffectiveTimeScale: () => a, fadeIn: () => a, fadeOut: () => a, crossFadeTo: () => a, play: () => a, stop: () => a, reset: () => a, isRunning: () => false, getClip: () => ({}) }; return a; } update() {} stopAllAction() {} },
  MathUtils: { clamp: (v, a, b) => Math.min(Math.max(v, a), b), degToRad: (d) => d * Math.PI / 180, radToDeg: (r) => r * 180 / Math.PI, lerp: (a, b, t) => a + (b - a) * t },
  PCFSoftShadowMap: 2, LoopOnce: 2200, LoopRepeat: 2201,
};
class GLTFLoader { load() {} parse() {} }
class GUIStub {
  add(o, p) {
    const t = typeof (o ? o[p] : undefined);
    if (!['number', 'boolean', 'string', 'function'].includes(t)) return undefined;
    const c = { name: () => c, onChange: () => c, onFinishChange: () => c, listen: () => c, disable: () => c, updateDisplay: () => c };
    return c;
  }
  addFolder() { return new GUIStub(); }
  close() { return this; } destroy() { return this; } controllersRecursive() { return []; }
}

/* --- Rapier: real enough to place bodies and record impulses ------------- */
const GROUND_Y = 0;
function descStub() {
  const d = { _t: { x: 0, y: 0, z: 0 } };
  d.setTranslation = (x, y, z) => { d._t = { x, y, z }; return d; };
  ['setRotation', 'lockRotations', 'setLinearDamping', 'setAngularDamping', 'setCanSleep', 'setGravityScale']
    .forEach((k) => { d[k] = (v) => { d['_' + k] = v; return d; }; });
  return d;
}
function colStub(base) {
  const c = Object.assign({ mass: 1 }, base);
  ['setMass', 'setRestitution', 'setFriction', 'setCollisionGroups', 'setSolverGroups',
    'setRestitutionCombineRule', 'setFrictionCombineRule', 'setRotation', 'setTranslation']
    .forEach((k) => { c[k] = (v) => { c['_' + k] = v; if (k === 'setMass') c.mass = v; return c; }; });
  return c;
}
const RAPIER = {
  init: async () => {},
  CoefficientCombineRule: { Average: 0, Min: 1, Multiply: 2, Max: 3 },
  Ray: class { constructor(o, d) { this.origin = { ...o }; this.dir = { ...d }; } },
  RigidBodyType: { Dynamic: 0, Fixed: 1, KinematicPositionBased: 2 },
  MotorModel: { AccelerationBased: 0 },
  RigidBodyDesc: { dynamic: descStub, fixed: descStub, kinematicPositionBased: descStub },
  JointData: {
    spherical: (a1, a2) => ({ kind: 'spherical', a1, a2 }),
    revolute: (a1, a2, axis) => ({ kind: 'revolute', a1, a2, axis }),
  },
  ColliderDesc: {
    ball: (r) => colStub({ shape: 'ball', r }),
    capsule: (h, r) => colStub({ shape: 'capsule', h, r }),
    cuboid: (x, y, z) => colStub({ shape: 'cuboid', x, y, z }),
  },
  World: class {
    constructor(g) { this.gravity = g; this.timestep = 1 / 60; }
    createRigidBody(d) {
      const b = {
        _t: { ...d._t }, _v: { x: 0, y: 0, z: 0 }, _sleeping: false, _m: 1,
        _canSleep: d._setCanSleep !== false,
        translation() { return this._t; }, rotation() { return { x: 0, y: 0, z: 0, w: 1 }; },
        linvel() { return this._v; }, angvel() { return { x: 0, y: 0, z: 0 }; },
        mass() { return this._m; },
        addForce() {}, addTorque() {}, resetForces() {}, resetTorques() {},
        setLinvel(v) { this._v = { ...v }; }, setAngvel() {},
        setTranslation(t) { this._t = { ...t }; }, setRotation() {},
        setGravityScale() {}, setLinearDamping() {}, setAngularDamping() {},
        isSleeping() { return this._sleeping; }, wakeUp() { this._sleeping = false; },
        applyImpulse(i) { trace.impulses.push({ body: b, i: { ...i } }); },
        applyTorqueImpulse() {}, addTorque() {}, resetTorques() {},
        bodyType: () => 0, setBodyType() {},
        setNextKinematicTranslation(t) { this._t = { ...t }; },
        setNextKinematicRotation() {},
      };
      trace.bodies.push(b);
      return b;
    }
    createCollider(desc, body) {
      if (body) { body._m = desc.mass || 1; body._shape = desc.shape; body._r = desc.r; }
      return desc;
    }
    createImpulseJoint(params, b1, b2) {
      // Only the unit joints carry motors; see rapier-api.mjs. This probe cares
      // about the hit chain rather than the rig, but it must not model an API
      // the library does not have — that is what let a load-time crash through.
      const j = { params, b1, b2, type: () => params.kind };
      if (params.kind === 'revolute') {
        j.configureMotorModel = () => {};
        j.configureMotorPosition = () => {};
        j.setLimits = () => {};
      }
      return j;
    }
    removeImpulseJoint() {}
    removeRigidBody() {}
    removeCollider() {}
    castRay(ray) { trace.rayCalls++; const toi = ray.origin.y - GROUND_Y; return toi >= 0 ? { timeOfImpact: toi } : null; }
    castRayAndGetNormal(ray, maxToi) {
      trace.rayCalls++;
      const toi = ray.origin.y - GROUND_Y;
      if (toi < 0 || toi > maxToi) return null;
      return { timeOfImpact: toi, normal: { x: 0, y: 1, z: 0 } };
    }
    step() {}
  },
};

/* --- Run ---------------------------------------------------------------- */
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const quiet = { log() {}, warn() {}, error() {}, table() {} };
const fn = new AsyncFunction(
  'THREE', 'GLTFLoader', 'GUI', 'RAPIER', 'document', 'window', 'navigator',
  'requestAnimationFrame', 'setTimeout', 'clearTimeout', 'FileReader', 'console',
  source);

await fn(THREE, GLTFLoader, GUIStub, RAPIER, document, globalWindow, globalWindow.navigator,
  globalWindow.requestAnimationFrame, globalWindow.setTimeout, globalWindow.clearTimeout,
  class { readAsArrayBuffer() {} }, quiet);

const frame = (n = 1) => { for (let i = 0; i < n; i++) { const cb = rafCb; rafCb = null; if (cb) cb(0); } };

// Identify the athlete and the ball by their collider RADIUS, not by creation
// order. The page builds a 16-body puppet at start-up now, so "the last two
// bodies made" stopped meaning what it used to — and the probe reported a
// broken dive chain when the chain was fine and only the indices had moved.
const spheres = trace.bodies.filter((b) => b._shape === 'ball' && b._r);
const athlete = spheres.find((b) => Math.abs(b._r - 0.45) < 0.02);
const ball = spheres.find((b) => Math.abs(b._r - 0.24) < 0.05);
if (!athlete || !ball) {
  console.log(`\n\u2717 could not identify the athlete/ball bodies among ${trace.bodies.length} `
    + `(radii seen: ${spheres.map((b) => b._r).join(', ')})\n`);
  process.exit(1);
}

console.log('\n=== hit probe ===\n');
frame(10);

// Park the athlete on flat ground, and the ball on the deck just in front.
const PLAYER_R = 0.45, BALL_R = 0.24;   // matches DEFAULT_BALL_TUNING.radius
athlete._t = { x: 0, y: PLAYER_R, z: 0 };
athlete._v = { x: 0, y: 0, z: 0 };
ball._t = { x: 0, y: BALL_R, z: 1.0 };
ball._v = { x: 0, y: 0, z: 0 };
frame(3);

console.log(`athlete at (${athlete._t.x}, ${athlete._t.y}, ${athlete._t.z})`);
console.log(`ball    at (${ball._t.x}, ${ball._t.y}, ${ball._t.z})`);
console.log(`horizontal separation: ${Math.hypot(ball._t.x - athlete._t.x, ball._t.z - athlete._t.z).toFixed(2)} m\n`);

trace.impulses.length = 0;

// Press the volley key exactly as a player would.
const keydown = winListeners.keydown, keyup = winListeners.keyup;
if (!keydown) { console.log('✗ no keydown handler registered'); process.exit(1); }

/* REFILL BEFORE EVERY PRESS. This probe answers "can the swing reach the ball"
   and "does the dive chain end at applyImpulse" — geometry and plumbing. Now
   that actions cost stamina, a probe that sweeps dozens of presses drains the
   tank and every later measurement reports a refusal instead of a reach
   failure: the right answer to the wrong question, which is the most expensive
   kind of diagnostic output there is. Topping up keeps each measurement
   independent. `valleyball.stamina` is the console handle the page exposes. */
const vbProbe = globalWindow.valleyball;
const refill = () => { if (vbProbe && vbProbe.stamina) vbProbe.stamina.reset(); };
if (!vbProbe || !vbProbe.stamina) {
  console.log('note: no stamina handle on the page — presses are unmetered\n');
}
refill();

refill();
keydown({ code: 'KeyJ', preventDefault() {} });
frame(1);
keyup({ code: 'KeyJ' });
frame(40);      // well past windup + contact window

if (trace.impulses.length) {
  const i = trace.impulses[trace.impulses.length - 1].i;
  const mag = Math.hypot(i.x, i.y, i.z);
  console.log(`✓ VOLLEY CONNECTED — impulse (${i.x.toFixed(2)}, ${i.y.toFixed(2)}, ${i.z.toFixed(2)}), |J| = ${mag.toFixed(2)} N·s`);
} else {
  console.log('✗ VOLLEY DID NOT CONNECT — no impulse was applied to the ball');
}

/* PLACE THE BALL ALONG THE FACING, not along +Z.

   Every sweep below used to hardcode `z = d`, which was correct while the
   athlete faced +Z by default. It does not any more: facing comes from the
   camera now (`aimYaw = basisYaw + PI`), and the default 45° camera leaves the
   athlete looking at roughly -135°. A ball at +Z is therefore BEHIND them.

   The volley survived that because its arc is wide enough to swallow the error;
   the spike, at 150°, did not — and reported "spike does not connect at any
   height", which is a probe bug wearing a gameplay bug's clothes. Placing the
   ball where the athlete is actually looking is what the probe meant all along. */
const ahead = (d, y) => {
  const f = globalWindow.valleyball.controller.state.facingAngle;
  return { x: Math.sin(f) * d, y, z: Math.cos(f) * d };
};

// Sweep the separation, since "how close do I actually have to be" is the
// question that matters when hits feel like they don't work.
console.log('\n--- volley reach sweep (ball resting on the floor) ---');
for (const d of [0.5, 1.0, 1.5, 2.0, 2.3, 2.6, 3.0]) {
  athlete._t = { x: 0, y: PLAYER_R, z: 0 };
  ball._t = ahead(d, BALL_R);
  ball._v = { x: 0, y: 0, z: 0 };
  trace.impulses.length = 0;
  frame(2);
  refill();
  keydown({ code: 'KeyJ', preventDefault() {} });
  frame(1);
  keyup({ code: 'KeyJ' });
  frame(45);
  console.log(`  ${d.toFixed(1)} m  ${trace.impulses.length ? 'HIT' : 'miss'}`);
}

// And a height sweep at a comfortable distance.
console.log('\n--- height sweep at 1.2 m (volley / spike) ---');
for (const y of [BALL_R, 0.5, 0.9, 1.4, 2.0, 2.6, 3.2]) {
  const res = [];
  for (const [key, label] of [['KeyJ', 'volley'], ['KeyK', 'spike']]) {
    athlete._t = { x: 0, y: PLAYER_R, z: 0 };
    ball._t = ahead(1.2, y);
    ball._v = { x: 0, y: 0, z: 0 };
    trace.impulses.length = 0;
    frame(2);
    refill();
    keydown({ code: key, preventDefault() {} });
    frame(1);
    keyup({ code: key });
    frame(45);
    res.push(`${label}:${trace.impulses.length ? 'HIT ' : 'miss'}`);
  }
  console.log(`  ball y=${y.toFixed(2)}  ${res.join('  ')}`);
}

// And the spike, on a ball at chest height where it should be legal.
ball._t = ahead(1.0, 1.1);
trace.impulses.length = 0;
refill();
keydown({ code: 'KeyK', preventDefault() {} });
frame(1);
keyup({ code: 'KeyK' });
frame(40);
console.log(trace.impulses.length
  ? '✓ SPIKE CONNECTED on a chest-height ball'
  : '✗ SPIKE DID NOT CONNECT on a chest-height ball');

console.log(`\nball body canSleep: ${ball._canSleep}  (false means Rapier will never park it)`);

/* --- Dive: trace the same chain, but ending on the ATHLETE body ----------
   key event → pending latch → actions.tryDive → onTransition → controller.dive
   → applyImpulse. The mock does not integrate, so this proves the wiring and
   the impulse, not the arc — the arc is integrated in test-integration.mjs.
   ---------------------------------------------------------------------- */
console.log('\n--- dive chain ---');
athlete._t = { x: 0, y: PLAYER_R, z: 0 };
athlete._v = { x: 0, y: 0, z: 0 };
frame(5);
trace.impulses.length = 0;
refill();
keydown({ code: 'KeyL', preventDefault() {} });
frame(2);
keyup({ code: 'KeyL' });
frame(2);

const onAthlete = trace.impulses.filter((r) => r.body === athlete);
if (!onAthlete.length) {
  console.log('✗ DIVE APPLIED NO IMPULSE — the chain is broken before applyImpulse');
} else {
  const i = onAthlete[0].i;
  const m = athlete._m || 78;
  console.log(`✓ DIVE LAUNCHED — impulse (${i.x.toFixed(1)}, ${i.y.toFixed(1)}, ${i.z.toFixed(1)}) N·s`);
  console.log(`  Δv = (${(i.x / m).toFixed(2)}, ${(i.y / m).toFixed(2)}, ${(i.z / m).toFixed(2)}) m/s at mass ${m} kg`);
  console.log(`  impulses on the athlete this press: ${onAthlete.length}  (must be 1)`);
}

/* MASHING THE KEY MUST NOT STACK LAUNCHES — while COMMITTED.

   The bound has to be "while still diving or skidding", not "over the next 24
   frames". This mock does not integrate, so the athlete's speed stays at
   whatever was written and a dive resolves into a skid that ends on its very
   first step; twelve presses then span several complete, legitimate dives, and
   a flat count of 0 would only ever have passed because something else was
   refusing them. Counting inside the committed window is the invariant that
   actually means "you cannot chain a second dive out of the first". */
trace.impulses.length = 0;
const vbMash = globalWindow.valleyball;
let mashed = 0, whileCommitted = 0;
for (let k = 0; k < 12; k++) {
  const committed = !!(vbMash && vbMash.actions
    && (vbMash.actions.diving || vbMash.actions.skidding));
  const before = trace.impulses.filter((r) => r.body === athlete).length;
  refill();                              // isolate the state rule from the meter
  keydown({ code: 'KeyL', preventDefault() {} });
  frame(1);
  keyup({ code: 'KeyL' });
  frame(1);
  const after = trace.impulses.filter((r) => r.body === athlete).length;
  mashed += after - before;
  if (committed) whileCommitted += after - before;
}
console.log(`  12 more presses → ${whileCommitted} launched while still committed (must be 0)`);
console.log(`  (${mashed} launched in total, once the previous dive had resolved — expected)`);
console.log('');
