/**
 * audit-shell.mjs
 * ---------------------------------------------------------------------------
 * Actually EXECUTES the built page against stubs for three.js, lil-gui, Rapier
 * and the DOM, then drives a few hundred frames of its animation loop.
 *
 * A syntax check proves the file parses. It does not prove the module reaches
 * its last line — a reference to a renamed constant, a missing element id, or a
 * lil-gui binding to a property that no longer exists all parse perfectly and
 * then throw at load, which shows up as a blank page.
 *
 * The stubs deliberately reproduce the FAILURE behaviour of the real libraries,
 * not just their success paths:
 *   - lil-gui's add() console.errors and returns undefined for a missing
 *     property, so the chained .name() throws exactly as it does in Chrome.
 *   - getElementById returns null for ids absent from the real markup, parsed
 *     out of the HTML rather than assumed.
 *
 *   node audit-shell.mjs [path-to-built.html]
 */
import fs from 'node:fs';
import { makeJointStub, motorCallsOn } from './rapier-api.mjs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const FILE = process.argv[2] || './valleyball-character-controller.html';
const html = fs.readFileSync(FILE, 'utf8');

const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('audit: no module script found'); process.exit(1); }
let source = scriptMatch[1];

// Real element ids, straight out of the markup.
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

const problems = [];
const mixerStats = { made: 0, updates: 0 };
const warn = (msg) => problems.push(msg);

/* ===========================================================================
   DOM
   =========================================================================== */
function makeEl(id) {
  const el = {
    id, tagName: 'DIV', textContent: '', innerHTML: '', value: '',
    style: new Proxy({}, { get: (t, k) => t[k] ?? '', set: (t, k, v) => { t[k] = v; return true; } }),
    /* A REAL classList, not a no-op quartet. `contains: () => false` is more
       permissive than the browser in the worst way: every "the element got the
       right class" assertion passes vacuously, and a HUD state that never
       reaches the DOM looks identical to one that does. Set-backed, so the
       audit can actually read what the page put there. */
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
        get length() { return set.size; },
        toString() { return [...set].join(' '); },
      };
    })(),
    dataset: {}, children: [], files: null,
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {},
    addEventListener(type, fn) { (listeners[id] ||= {})[type] = fn; },
    removeEventListener() {},
    setAttribute() {}, getAttribute: () => null,
    getContext: () => ({}),
    focus() {}, click() {},
    getBoundingClientRect: () => ({ width: 1280, height: 800, top: 0, left: 0 }),
  };
  return el;
}
const listeners = {};
const winListeners = {};
const elements = new Map();
// Every camera the page constructs, so the audit can check the one it renders
// with actually moves and never goes non-finite.
const cameras = [];
const rendered = [];
const scenes = [];
const worldRef = { instance: null };

const document = {
  body: makeEl('body'),
  documentElement: makeEl('html'),
  activeElement: null,
  createElement: (tag) => { const e = makeEl('created:' + tag); e.tagName = tag.toUpperCase(); return e; },
  createElementNS: (ns, tag) => document.createElement(tag),
  getElementById(id) {
    if (!ids.has(id)) { warn(`document.getElementById('${id}') — no such id in the markup (returns null)`); return null; }
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(t, fn) { winListeners[t] = fn; },
};

let rafCb = null;

/* A MONOTONIC FRAME CLOCK.
   Every section used to pick its own timestamp base — 9000 here, 20000 there,
   30000 in the next — and once one section ran past another's base, the page saw
   time move BACKWARDS. The loop's dt went negative, nothing integrated, and the
   check that followed reported "inert" about a rig that was working perfectly.
   Two hours of that is enough. One clock, only ever forwards. */
let auditClock = 0;
function drive(frames, stepMs = 16.6) {
  let ran = 0;
  for (let i = 0; i < frames && rafCb; i++) {
    const cb = rafCb;
    rafCb = null;
    auditClock += stepMs;
    cb(auditClock);
    ran++;
  }
  return ran;
}
const globalWindow = {
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2,
  addEventListener(t, fn) { winListeners[t] = fn; },
  removeEventListener() {},
  requestAnimationFrame(fn) { rafCb = fn; return 1; },
  cancelAnimationFrame() {},
  setTimeout: () => 0, clearTimeout: () => {},
  navigator: { getGamepads: () => [] },
  location: { href: 'http://localhost/', protocol: 'http:' },
};

/* ===========================================================================
   three.js
   =========================================================================== */
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  setScalar(s) { this.x = s; this.y = s; this.z = s; return this; }
  divideScalar(s) { return this.multiplyScalar(1 / (s || 1)); }
  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  applyAxisAngle() { return this; }
  setFromMatrixPosition() { return this; }
  toArray() { return [this.x, this.y, this.z]; }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x ** 2 + this.y ** 2 + this.z ** 2; }
  normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  crossVectors(a, b) {
    this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; return this;
  }
  applyQuaternion() { return this; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}
class V2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } }
class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; }
  copy(q) { Object.assign(this, { x: q.x, y: q.y, z: q.z, w: q.w }); return this; }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  setFromEuler() { return this; }
  setFromAxisAngle() { return this; }
  /* REAL, not stubs. The bone write-back is `local = parentWorld⁻¹ ∘ world`,
     and a `premultiply` that returns `this` unchanged makes that identity —
     which would let a broken write-back pass. A mock must never be more
     forgiving than the runtime; this file has learned that twice. */
  invert() { return this.set(-this.x, -this.y, -this.z, this.w); }
  multiply(q) { return this.set(
    this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y,
    this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x,
    this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w,
    this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z); }
  premultiply(q) { return this.set(
    q.w * this.x + q.x * this.w + q.y * this.z - q.z * this.y,
    q.w * this.y - q.x * this.z + q.y * this.w + q.z * this.x,
    q.w * this.z + q.x * this.y - q.y * this.x + q.z * this.w,
    q.w * this.w - q.x * this.x - q.y * this.y - q.z * this.z); }
}
class Obj3D {
  constructor() {
    this.position = new V3();
    this.rotation = { x: 0, y: 0, z: 0, order: 'XYZ',
      set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
      copy(e) { this.x = e.x; this.y = e.y; this.z = e.z; return this; } };
    this.quaternion = new Quat(); this.scale = new V3(1, 1, 1);
    this.children = []; this.visible = true; this.userData = {};
    this.castShadow = false; this.receiveShadow = false; this.frustumCulled = true;
    // A real Object3D exposes a decomposable matrixWorld, and the bind-pose
    // snapshot reads it on every bone.
    this.matrixWorld = new Mat4();
    this.parent = null;
  }
  add(...o) { for (const c of o) { c.parent = this; this.children.push(c); } return this; }
  remove() { return this; }
  traverse(fn) { fn(this); this.children.forEach((c) => c.traverse && c.traverse(fn)); }
  lookAt() {}
  getWorldDirection(v) { return v.set(0, 0, -1); }
  /* Composed up the parent chain for real. The character view's bone
     write-back divides by the parent's world rotation, and a stub returning
     identity here would make that division a no-op — which is precisely the
     bug the write-back's parent term exists to prevent, so the stub must not
     be more forgiving than the browser. */
  getWorldQuaternion(out) {
    const p = this.parent ? this.parent.getWorldQuaternion(new Quat()) : new Quat();
    const q = this.quaternion;
    const r = {
      x: p.w * q.x + p.x * q.w + p.y * q.z - p.z * q.y,
      y: p.w * q.y - p.x * q.z + p.y * q.w + p.z * q.x,
      z: p.w * q.z + p.x * q.y - p.y * q.x + p.z * q.w,
      w: p.w * q.w - p.x * q.x - p.y * q.y - p.z * q.z,
    };
    return out ? out.set(r.x, r.y, r.z, r.w) : new Quat(r.x, r.y, r.z, r.w);
  }
  // Composed for real, up the parent chain, so the bone write-back has a
  // truthful frame to convert against.
  updateMatrixWorld() { this.updateWorldMatrix(true, true); }
  updateWorldMatrix(updateParents, updateChildren) {
    if (updateParents && this.parent) this.parent.updateWorldMatrix(true, false);
    const local = new Mat4().compose(this.position, this.quaternion, this.scale);
    if (this.parent) this.matrixWorld.copy(this.parent.matrixWorld).multiply(local);
    else this.matrixWorld.copy(local);
    if (updateChildren) for (const c of this.children) c.updateWorldMatrix(false, true);
  }
  updateProjectionMatrix() {}
}

/* --- A real Matrix4 --------------------------------------------------------
   Not a stub. The bone write-back is world → parent-space → local, which is
   three matrix operations deep; a no-op `decompose` cannot distinguish a rig
   that drives the skeleton from one that does nothing, so the audit would have
   to take the feature on trust. Column-major, matching THREE.
   ------------------------------------------------------------------------- */
class Mat4 {
  constructor() { this.elements = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
  identity() { this.elements = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; return this; }
  copy(m) { this.elements = m.elements.slice(); return this; }
  clone() { return new Mat4().copy(this); }
  compose(p, q, s) {
    const { x, y, z, w } = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = s ? s.x : 1, sy = s ? s.y : 1, sz = s ? s.z : 1;
    this.elements = [
      (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
      (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
      (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
      p.x, p.y, p.z, 1,
    ];
    return this;
  }
  multiplyMatrices(a, b) {
    const ae = a.elements, be = b.elements, te = new Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        te[c * 4 + r] = ae[r] * be[c * 4] + ae[4 + r] * be[c * 4 + 1]
          + ae[8 + r] * be[c * 4 + 2] + ae[12 + r] * be[c * 4 + 3];
      }
    }
    this.elements = te; return this;
  }
  multiply(m) { return this.multiplyMatrices(this, m); }
  premultiply(m) { return this.multiplyMatrices(m, this); }
  invert() {
    // Affine inverse: transpose the (scaled) basis, then re-apply to the
    // translation. Enough for a transform hierarchy, and far less error-prone
    // than a general 4x4 cofactor expansion.
    const e = this.elements;
    const sx = Math.hypot(e[0], e[1], e[2]) || 1;
    const sy = Math.hypot(e[4], e[5], e[6]) || 1;
    const sz = Math.hypot(e[8], e[9], e[10]) || 1;
    const r = [
      e[0] / (sx * sx), e[4] / (sy * sy), e[8] / (sz * sz),
      e[1] / (sx * sx), e[5] / (sy * sy), e[9] / (sz * sz),
      e[2] / (sx * sx), e[6] / (sy * sy), e[10] / (sz * sz),
    ];
    const t = [e[12], e[13], e[14]];
    this.elements = [
      r[0], r[3], r[6], 0,
      r[1], r[4], r[7], 0,
      r[2], r[5], r[8], 0,
      -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]),
      -(r[3] * t[0] + r[4] * t[1] + r[5] * t[2]),
      -(r[6] * t[0] + r[7] * t[1] + r[8] * t[2]), 1,
    ];
    return this;
  }
  decompose(p, q, s) {
    const e = this.elements;
    let sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    const sz = Math.hypot(e[8], e[9], e[10]);
    const det = e[0] * (e[5] * e[10] - e[9] * e[6])
      - e[4] * (e[1] * e[10] - e[9] * e[2])
      + e[8] * (e[1] * e[6] - e[5] * e[2]);
    if (det < 0) sx = -sx;
    p.set(e[12], e[13], e[14]);
    if (s && s.set) s.set(sx, sy, sz);
    const m = [e[0] / (sx || 1), e[1] / (sx || 1), e[2] / (sx || 1),
      e[4] / (sy || 1), e[5] / (sy || 1), e[6] / (sy || 1),
      e[8] / (sz || 1), e[9] / (sz || 1), e[10] / (sz || 1)];
    const tr = m[0] + m[4] + m[8];
    let qx, qy, qz, qw;
    if (tr > 0) {
      const f = 0.5 / Math.sqrt(tr + 1.0);
      qw = 0.25 / f; qx = (m[5] - m[7]) * f; qy = (m[6] - m[2]) * f; qz = (m[1] - m[3]) * f;
    } else if (m[0] > m[4] && m[0] > m[8]) {
      const f = 2.0 * Math.sqrt(1.0 + m[0] - m[4] - m[8]);
      qw = (m[5] - m[7]) / f; qx = 0.25 * f; qy = (m[3] + m[1]) / f; qz = (m[6] + m[2]) / f;
    } else if (m[4] > m[8]) {
      const f = 2.0 * Math.sqrt(1.0 + m[4] - m[0] - m[8]);
      qw = (m[6] - m[2]) / f; qx = (m[3] + m[1]) / f; qy = 0.25 * f; qz = (m[7] + m[5]) / f;
    } else {
      const f = 2.0 * Math.sqrt(1.0 + m[8] - m[0] - m[4]);
      qw = (m[1] - m[3]) / f; qx = (m[6] + m[2]) / f; qy = (m[7] + m[5]) / f; qz = 0.25 * f;
    }
    if (q && q.set) q.set(qx, qy, qz, qw);
    return this;
  }
}

class Geometry { constructor() { this.attributes = {}; } dispose() {} }
class ColorStub {
  constructor(c) { this.value = c; }
  setHex(h) { this.value = h; return this; }
  set(c) { this.value = c; return this; }
  setRGB() { return this; }
  copy(c) { this.value = c.value; return this; }
}
class Material {
  constructor(o = {}) { Object.assign(this, o); this.color = new ColorStub(o.color); }
  dispose() {}
}
class Mesh extends Obj3D { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isMesh = true; } }
class ArrowHelper extends Obj3D {
  setDirection() {} setLength() {} setColor() {}
}
// A real AxesHelper is a LineSegments: it carries a geometry AND a material, and
// the page reaches into both (depthTest, transparent, opacity, renderOrder). A
// stub that is only an Object3D would let a page that throws on load pass.
class AxesHelper extends Obj3D {
  constructor(size = 1) {
    super();
    this.isLineSegments = true;
    this.size = size;
    this.geometry = new Geometry();
    this.material = new Material({ depthTest: true, transparent: false, opacity: 1 });
  }
}
class Camera extends Obj3D { constructor() { super(); this.isCamera = true; } }

const THREE = {
  Vector2: V2, Vector3: V3, Quaternion: Quat, Euler: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
  Object3D: Obj3D, Group: Obj3D, Mesh,
  // Skinning. These are new stubs for the physical puppet: the page now builds
  // a skinned stand-in character and drives its bones from Rapier bodies, so an
  // audit without them tests a page that cannot exist.
  Bone: class extends Obj3D { constructor() { super(); this.isBone = true; } },
  SkinnedMesh: class extends Mesh {
    constructor(g, m) { super(g, m); this.isSkinnedMesh = true; }
    bind(sk) { this.skeleton = sk; }
  },
  Skeleton: class { constructor(bones) { this.bones = bones; } update() {} },
  // Animation. The hidden armature plays real clips through a real mixer, so
  // the stubs have to hold enough state for the pose-target path to be
  // exercised rather than skipped.
  QuaternionKeyframeTrack: class {
    constructor(name, times, values) {
      Object.assign(this, { name, times, values });
      const bone = name.split('.')[0];
      if (!times.length || values.length !== times.length * 4) {
        throw new Error(`bad quaternion track "${name}": ${times.length} times vs ${values.length} values`);
      }
      this.boneName = bone;
    }
  },
  AnimationClip: class {
    constructor(name, duration, tracks) { Object.assign(this, { name, duration, tracks }); }
  },
  Float32BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; this.count = a.length / n; } },
  Uint16BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; this.count = a.length / n; } },
  BufferGeometry: class extends Geometry {
    setAttribute(n, a) { this.attributes[n] = a; return this; }
    computeVertexNormals() {} computeBoundingSphere() {}
  },
  Matrix4: Mat4,
  BoxGeometry: Geometry, SphereGeometry: Geometry, CapsuleGeometry: Geometry,
  ConeGeometry: Geometry, CylinderGeometry: Geometry, PlaneGeometry: Geometry,
  TorusGeometry: Geometry, RingGeometry: Geometry, CircleGeometry: Geometry,
  MeshStandardMaterial: Material, MeshBasicMaterial: Material,
  AmbientLight: Obj3D, DirectionalLight: class extends Obj3D {
    constructor() { super(); this.shadow = { mapSize: { set() {} }, camera: {}, bias: 0 }; }
  },
  GridHelper: Obj3D, ArrowHelper, AxesHelper,
  Scene: class extends Obj3D {
    constructor() { super(); this.background = null; this.fog = null; scenes.push(this); }
  },
  Color: ColorStub,
  Fog: class { constructor(...a) { this.a = a; } },
  PerspectiveCamera: class extends Camera {
    constructor(fov, aspect) {
      super(); this.fov = fov; this.aspect = aspect; this.isPerspectiveCamera = true;
      cameras.push(this);
    }
    lookAt(x, y, z) { this.lookedAt = { x, y, z }; }
  },
  OrthographicCamera: class extends Camera {
    constructor(l, r, t, b) {
      super(); Object.assign(this, { left: l, right: r, top: t, bottom: b });
      this.isOrthographicCamera = true; cameras.push(this);
    }
    lookAt(x, y, z) { this.lookedAt = { x, y, z }; }
  },
  WebGLRenderer: class {
    constructor() {
      this.domElement = makeEl('canvas');
      this.shadowMap = { enabled: false, type: null };
    }
    setPixelRatio() {} setSize() {} setAnimationLoop() {}
    render(scene, cam) { rendered.push(cam); }
  },
  Raycaster: class {
    setFromCamera() {} intersectObject() { return []; } intersectObjects() { return []; }
  },
  Clock: class { constructor() { this.t = 0; } getDelta() { return 1 / 60; } getElapsedTime() { return this.t; } },
  // A mixer that actually SAMPLES. Not a no-op: the whole active-ragdoll chain
  // runs clip → bone quaternion → motor target, and a mixer that writes nothing
  // makes every target identical, so the audit could not tell a working tracker
  // from a frozen one. Nearest-keyframe sampling is enough — the assertion is
  // that the pose changes over time, not that it interpolates prettily.
  AnimationMixer: class {
    constructor(root) {
      this.root = root; this._c = new Map(); this._t = 0;
      this._bones = new Map();
      root && root.traverse && root.traverse((o) => { if (o.name) this._bones.set(o.name, o); });
      mixerStats.made++;
    }
    clipAction(clip) {
      if (this._c.has(clip)) return this._c.get(clip);
      const a = {
        clip, weight: 0, timeScale: 1, running: false, enabled: true, clampWhenFinished: false,
        setLoop() { return a; },
        setEffectiveWeight(w) { a.weight = w; return a; },
        setEffectiveTimeScale(s) { a.timeScale = s; return a; },
        fadeIn() { a.weight = 1; return a; },
        fadeOut() { a.weight = 0; return a; },
        crossFadeTo(other) { a.weight = 0; other.weight = 1; return a; },
        play() { a.running = true; return a; },
        stop() { a.running = false; return a; },
        reset() { return a; },
        isRunning: () => a.running, getClip: () => clip,
      };
      this._c.set(clip, a); return a;
    }
    update(dt) {
      mixerStats.updates++;
      this._t += dt || 0;
      let best = null;
      for (const a of this._c.values()) if (a.running && a.weight > 0 && (!best || a.weight > best.weight)) best = a;
      if (!best || !best.clip || !best.clip.tracks) return;
      const dur = best.clip.duration || 1;
      const t = (this._t * best.timeScale) % dur;
      for (const track of best.clip.tracks) {
        const bone = this._bones.get(track.boneName);
        if (!bone || !track.times.length) continue;
        let k = 0;
        while (k < track.times.length - 1 && track.times[k + 1] <= t) k++;
        const o = k * 4;
        bone.quaternion.set(track.values[o], track.values[o + 1], track.values[o + 2], track.values[o + 3]);
      }
    }
    stopAllAction() { for (const a of this._c.values()) a.running = false; }
  },
  MathUtils: {
    clamp: (v, a, b) => Math.min(Math.max(v, a), b),
    degToRad: (d) => d * Math.PI / 180,
    radToDeg: (r) => r * 180 / Math.PI,
    lerp: (a, b, t) => a + (b - a) * t,
  },
  PCFSoftShadowMap: 2, LoopOnce: 2200, LoopRepeat: 2201, LoopPingPong: 2202,
  SRGBColorSpace: 'srgb', DoubleSide: 2, FrontSide: 0,
};

const gltfHooks = { onLoad: null, onError: null, urls: [] };
class GLTFLoader {
  load(url, onLoad, onProgress, onError) {
    gltfHooks.urls.push(url); gltfHooks.onLoad = onLoad; gltfHooks.onError = onError;
  }
  parse(data, p, onLoad, onError) { gltfHooks.onLoad = onLoad; gltfHooks.onError = onError; }
  setPath() { return this; }
}

/* ===========================================================================
   lil-gui — reproducing its FAILURE path, which is the whole point
   =========================================================================== */
const guiControllers = [];
const guiButtons = [];
class GUIStub {
  constructor() { this._children = []; }
  add(object, property) {
    const initial = object ? object[property] : undefined;
    const t = typeof initial;
    if (t !== 'number' && t !== 'boolean' && t !== 'string' && t !== 'function' && !Array.isArray(arguments[2])) {
      // Exactly what lil-gui does: complain, return undefined. The caller's
      // chained .name() then throws — which is the blank page.
      warn(`lil-gui add() on a property that does not exist: '${property}' (value: ${initial})`);
      return undefined;
    }
    const ctrl = {
      _object: object, _property: property, _handlers: [],
      name: () => ctrl,
      onChange(fn) { ctrl._handlers.push(fn); guiControllers.push(ctrl); return ctrl; },
      onFinishChange(fn) { ctrl._handlers.push(fn); guiControllers.push(ctrl); return ctrl; },
      listen: () => ctrl, disable: () => ctrl, enable: () => ctrl,
      min: () => ctrl, max: () => ctrl, step: () => ctrl, updateDisplay: () => ctrl,
    };
    if (t === 'function') guiButtons.push({ object, property });
    this._children.push(ctrl);
    return ctrl;
  }
  addColor(...a) { return this.add(...a); }
  addFolder() { const f = new GUIStub(); this._children.push(f); return f; }
  close() { return this; } open() { return this; } destroy() { return this; }
  controllersRecursive() { return this._children.filter((c) => c.updateDisplay); }
  title() { return this; }
}

/* ===========================================================================
   Rapier
   =========================================================================== */
const RAPIER = {
  init: async () => {},
  World: class {
    constructor(g) {
      this.gravity = g; this.timestep = 1 / 60;
      this.bodies = []; this.joints = [];
      worldRef.instance = this;
    }
    createRigidBody(d) {
      const b = {
        _t: { ...(d._t || { x: 0, y: 0, z: 0 }) }, _v: { x: 0, y: 0, z: 0 },
        _r: { x: 0, y: 0, z: 0, w: 1 }, _m: 1,
        translation() { return this._t; }, rotation() { return this._r; },
        linvel() { return this._v; },
        angvel() { return this._w || { x: 0, y: 0, z: 0 }; },
        mass() { return this._m; },
        // Rapier's force and torque accumulators are PERSISTENT: whatever you
        // add stays applied on every subsequent step until it is cleared. The
        // stub models that faithfully — swallowing the call, as it used to,
        // makes a rig that never resets look identical to one that does, which
        // is exactly the bug that made the limbs wild.
        _torque: { x: 0, y: 0, z: 0 }, _force: { x: 0, y: 0, z: 0 },
        _torqueHistory: [],
        addForce(f) { this._force.x += f.x; this._force.y += f.y; this._force.z += f.z; },
        addTorque(t) { this._torque.x += t.x; this._torque.y += t.y; this._torque.z += t.z; },
        resetForces() { this._force = { x: 0, y: 0, z: 0 }; },
        resetTorques() { this._torque = { x: 0, y: 0, z: 0 }; },
        setLinvel(v) { this._v = { ...v }; },
        setAngvel(w) { this._w = { ...w }; },
        setTranslation(t) { this._t = { ...t }; },
        setRotation(r) { this._r = { ...r }; },
        setGravityScale() {},
        // RECORDED, not swallowed — same reasoning as the force accumulators.
        // Linear damping is half of a surface profile, and a no-op setter makes
        // "the slide dropped the damping" indistinguishable from a page that
        // never wrote it.
        _damping: null, _dampingWrites: 0,
        setLinearDamping(d) { this._damping = d; this._dampingWrites++; },
        setAngularDamping() {},
        applyImpulse() {}, applyTorqueImpulse() {},
        _type: d._type === undefined ? 0 : d._type,
        bodyType() { return this._type; },
        setBodyType(t) { this._type = t; },
        setNextKinematicTranslation(t) { this._t = { ...t }; },
        setNextKinematicRotation(r) { this._r = { ...r }; },
      };
      this.bodies.push(b); return b;
    }
    createCollider(desc, body) { if (body) body._m = desc.mass || 1; return desc; }
    removeCollider() {}
    // Actually remove. A no-op here cannot distinguish a rig that tears itself
    // down on reload from one that leaks sixteen bodies and fifteen joints
    // every time a model is dropped in — which is a slow death over a session,
    // and invisible until the frame rate goes.
    removeRigidBody(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); }
    removeImpulseJoint(j) { const i = this.joints.indexOf(j); if (i >= 0) this.joints.splice(i, 1); }
    // Built from rapier-api.mjs, so each joint type exposes EXACTLY the methods
    // its real class has and nothing else. The previous stub handed a motor to
    // every joint including spherical ones, which have none — so the audit
    // passed a page that threw on load in Chrome. A mock more generous than the
    // library does not fail to catch bugs, it creates them.
    createImpulseJoint(params, b1, b2) {
      const j = makeJointStub(params.kind || 'spherical');
      j.params = params; j.b1 = b1; j.b2 = b2;
      this.joints.push(j);
      return j;
    }
    castRay() { return { timeOfImpact: 0.45 }; }
    castRayAndGetNormal() { return { timeOfImpact: 0.45, normal: { x: 0, y: 1, z: 0 } }; }
    // Record what each body would actually be integrated with this step. The
    // accumulator is deliberately NOT cleared here, because Rapier does not
    // clear it either — that is the property under test.
    step() {
      for (const b of this.bodies) {
        if (!b._torqueHistory) continue;
        b._torqueHistory.push(Math.hypot(b._torque.x, b._torque.y, b._torque.z));
        if (b._torqueHistory.length > 400) b._torqueHistory.shift();
      }
    }
  },
  Ray: class { constructor(o, d) { this.origin = { ...o }; this.dir = { ...d }; } },
  RigidBodyType: { Dynamic: 0, Fixed: 1, KinematicPositionBased: 2 },
  MotorModel: { AccelerationBased: 0, ForceBased: 1 },
  CoefficientCombineRule: { Average: 0, Min: 1, Multiply: 2, Max: 3 },
  RigidBodyDesc: {
    dynamic() { return descStub(0); },
    fixed() { return descStub(1); },
    kinematicPositionBased() { return descStub(2); },
  },
  ColliderDesc: {
    ball(r) { return colStub({ shape: 'ball', r }); },
    cuboid(x, y, z) { return colStub({ shape: 'cuboid', x, y, z }); },
    capsule(h, r) { return colStub({ shape: 'capsule', h, r }); },
  },
  // Tagged with their kind, so createImpulseJoint above can build a stub with
  // the right method set.
  JointData: {
    spherical: (a1, a2) => ({ kind: 'spherical', a1, a2 }),
    revolute: (a1, a2, axis) => ({ kind: 'revolute', a1, a2, axis }),
    generic: (a1, a2, axis, mask) => ({ kind: 'generic', a1, a2, axis, mask }),
    fixed: () => ({ kind: 'fixed' }),
  },
  JointAxesMask: { X: 1, Y: 2, Z: 4, AngX: 8, AngY: 16, AngZ: 32 },
};
function descStub(bodyType) {
  const d = { _t: { x: 0, y: 0, z: 0 }, _type: bodyType === undefined ? 0 : bodyType };
  const chain = ['setRotation', 'lockRotations', 'setLinearDamping', 'setAngularDamping',
    'setCanSleep', 'setAdditionalMass', 'setGravityScale', 'setCcdEnabled'];
  d.setTranslation = (x, y, z) => { d._t = { x, y, z }; return d; };
  for (const k of chain) d[k] = () => d;
  return d;
}
const colliderGroups = [];
function colStub(base) {
  const c = Object.assign({ mass: 1, friction: 0, groups: null }, base);
  c.setMass = (m) => { c.mass = m; return c; };
  c.setFriction = (f) => { c.friction = f; c._frictionWrites = (c._frictionWrites || 0) + 1; return c; };
  // Verified present on the real Collider — see rapier-api.mjs. Recorded, not
  // swallowed: the feet set Min so the floor cannot override a slippery foot,
  // and a mock that quietly accepts anything would hide it going missing.
  c.setFrictionCombineRule = (r) => { c.frictionRule = r; return c; };
  c.setRestitution = () => c; c.setDensity = () => c;
  c.setRotation = () => c; c.setTranslation = () => c;
  c.setCollisionGroups = (g) => { c.groups = g; colliderGroups.push(g); return c; };
  c.setSolverGroups = () => c; c.setSensor = () => c;
  return c;
}

/**
 * The smallest glTF `createCharacterView` will accept: a bone tree carrying the
 * names the write-back reads, one mesh so the page treats it as a character
 * rather than a clip library, and one clip.
 *
 * Built from the audit's own THREE stub, so the stub is exercised on the same
 * path the browser takes rather than bypassed by a hand-rolled object.
 */
function makeFakeGltf() {
  const mk = (name, parent) => {
    const o = new Obj3D();
    o.name = name; o.isBone = true;
    if (parent) parent.add(o);
    return o;
  };
  const scene = new Obj3D();
  scene.name = 'fake-root';
  const pelvis = mk('pelvis', scene);
  const s1 = mk('spine_01', pelvis);
  const s3 = mk('spine_03', mk('spine_02', s1));
  mk('Head', mk('neck_01', s3));
  for (const side of ['l', 'r']) {
    const ua = mk(`upperarm_${side}`, mk(`clavicle_${side}`, s3));
    mk(`hand_${side}`, mk(`lowerarm_${side}`, ua));
    mk(`foot_${side}`, mk(`calf_${side}`, mk(`thigh_${side}`, pelvis)));
  }
  const mesh = new Obj3D();
  mesh.name = 'fake-body'; mesh.isMesh = true; mesh.isSkinnedMesh = true;
  scene.add(mesh);
  return { scene, animations: [{ name: 'idle', duration: 1 }, { name: 'run', duration: 1 }] };
}

/* ===========================================================================
   Execute
   ---------------------------------------------------------------------------
   The CLASSIC scripts run first, exactly as the browser runs them. They carry
   the boot diagnostics, and skipping them meant the audit was testing a page
   that does not exist — the module half alone, with the error reporting the
   real page depends on simply absent.
   =========================================================================== */
/* PARSE IT AS A MODULE, WITH A REAL PARSER.
   The line check below catches the specific bug that shipped; this catches the
   CLASS. Everything after it runs the body through `new AsyncFunction`, which is
   a different grammar from a module: sloppy mode, no import/export, no
   import.meta. Anything legal in a function body but illegal in a module slips
   through it silently.

   `node --check` on a .mjs file is the same parse goal the browser uses, and it
   resolves nothing — bare specifiers like 'three' are fine. If this passes, the
   file parses.
   ------------------------------------------------------------------------- */
{
  const tmp = path.join(os.tmpdir(), `audit-parse-${process.pid}.mjs`);
  try {
    fs.writeFileSync(tmp, source);
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  } catch (e) {
    const out = String((e.stderr || '') + (e.stdout || '') || e.message);
    console.log('\n✗ THE PAGE WILL NOT PARSE — this is a blank screen in the browser:\n');
    for (const line of out.split('\n').slice(0, 12)) if (line.trim()) console.log(`   ${line}`);
    console.log('\nRESULT: WOULD NOT RUN');
    process.exit(1);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* the temp file is not load-bearing */ }
  }
}

/* AND THE SPECIFIC ONE, with a message that names the cause.
   This audit shipped a page that would not load, and the reason was here: it
   stripped EVERY `import` with a global regex before evaluating, including one
   left inside an inlined module by a build bug. The browser cannot do that —
   `import` inside a function body is a SyntaxError, "Unexpected token '{'", and
   a blank screen. So the harness was strictly more permissive than the runtime,
   which is the one thing a harness must never be. 969 green tests and a green
   audit did not see it.

   The fix is to reject exactly what the browser rejects, before rewriting
   anything: only the page's OWN top-level imports may be removed, and a module
   keyword anywhere below them is a hard failure. */
{
  const lines = source.split('\n');
  // The page's top-level imports are the leading run of import statements,
  // before any other code. Everything after that belongs to inlined modules.
  let firstCode = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')
      || t.startsWith('import ')) { firstCode = i + 1; continue; }
    break;
  }
  const stray = [];
  for (let i = firstCode; i < lines.length; i++) {
    if (/^\s*(import|export)\s/.test(lines[i])) stray.push(`line ${i + 1}: ${lines[i].trim()}`);
  }
  if (stray.length) {
    console.log('\n✗ THE PAGE WILL NOT PARSE — this is a blank screen in the browser:\n');
    console.log('   a module keyword survives inside the page body. `import` and `export`');
    console.log('   are illegal anywhere but the top level of a module script, and each');
    console.log('   inlined module lives inside an IIFE.\n');
    for (const l of stray.slice(0, 6)) console.log(`   ${l}`);
    console.log('\n   Chrome reports this as: Uncaught SyntaxError: Unexpected token \'{\'');
    console.log('\nRESULT: WOULD NOT RUN');
    process.exit(1);
  }
}

// Only now, and only the page's own top-level imports, rewritten to our stubs.
source = source
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

let fn;
try {
  fn = new AsyncFunction(
    'THREE', 'GLTFLoader', 'GUI', 'RAPIER',
    'document', 'window', 'navigator', 'requestAnimationFrame', 'setTimeout',
    'clearTimeout', 'FileReader', 'console',
    source
  );
} catch (e) {
  console.error('\n✗ PARSE ERROR:', e.message, '\n');
  process.exit(1);
}

// A FileReader that actually completes, so the drag-and-drop model path runs.
class FileReaderStub {
  readAsArrayBuffer() {
    this.result = new ArrayBuffer(8);
    if (this.onload) this.onload({ target: this });
  }
}
const fakeFile = { name: 'audit-character.glb', size: 8, type: 'model/gltf-binary' };
const quietConsole = { log() {}, warn() {}, error(...a) { warn('console.error: ' + a.map(String).join(' ').slice(0, 120)); }, table() {} };

const classicScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
for (const [i, body] of classicScripts.entries()) {
  try {
    // eslint-disable-next-line no-new-func
    // `location` is a real global in a browser, not a property the script has to
    // reach through `window`. The boot diagnostics read it to detect a file://
    // origin, and a scope without it throws before anything else runs.
    new Function('window', 'document', 'location', 'setTimeout', 'clearTimeout', 'console', body)(
      globalWindow, document, globalWindow.location,
      // The boot watchdog must not actually fire during an audit; capture it
      // instead so the timer can be inspected rather than waited on.
      (fn2, ms) => { globalWindow.__bootTimers = (globalWindow.__bootTimers || []).concat({ fn: fn2, ms }); return 0; },
      () => {}, quietConsole);
  } catch (e) {
    console.error(`\n✗ classic script #${i} threw during load: ${e.message}\n`);
    process.exit(1);
  }
}


let loadError = null;
try {
  await fn(
    THREE, GLTFLoader, GUIStub, RAPIER,
    document, globalWindow, globalWindow.navigator,
    globalWindow.requestAnimationFrame, globalWindow.setTimeout, globalWindow.clearTimeout,
    FileReaderStub, quietConsole
  );
} catch (e) {
  loadError = e;
}

console.log(`\n=== audit: ${path.basename(FILE)} ===\n`);

if (loadError) {
  console.log('✗ THE PAGE THROWS DURING LOAD — this is a blank screen in the browser:\n');
  console.log(`   ${loadError.constructor.name}: ${loadError.message}`);
  const line = (loadError.stack || '').split('\n')[1] || '';
  if (line) console.log(`   ${line.trim()}`);
  console.log('');
} else {
  console.log('✓ module reached its last line without throwing');
}

// Drive the animation loop, which is where per-frame errors surface.
let frameError = null;
let frames = 0;
if (!loadError && rafCb) {
  try {
    frames += drive(400);
  } catch (e) { frameError = e; }
  if (frameError) {
    console.log(`\n✗ THE ANIMATION LOOP THROWS after ${frames} frames:\n`);
    console.log(`   ${frameError.constructor.name}: ${frameError.message}`);
    const line = (frameError.stack || '').split('\n')[1] || '';
    if (line) console.log(`   ${line.trim()}`);
  } else {
    console.log(`✓ animation loop ran ${frames} frames cleanly`);
  }
} else if (!loadError) {
  console.log('⚠ no requestAnimationFrame callback registered — is animate() being called?');
}

// Exercise the registered event handlers; a bad one only fires on interaction.
if (!loadError) {
  const fired = [];
  for (const [id, types] of Object.entries(listeners)) {
    for (const [type, fn2] of Object.entries(types)) {
      try { fn2({ code: 'KeyC', clientX: 10, clientY: 10, preventDefault() {}, target: { files: null }, dataTransfer: null }); }
      catch (e) { fired.push(`#${id} ${type}: ${e.message}`); }
    }
  }
  for (const [type, fn2] of Object.entries(winListeners)) {
    try { fn2({ code: 'KeyC', clientX: 10, clientY: 10, preventDefault() {}, target: {}, dataTransfer: null }); }
    catch (e) { fired.push(`window ${type}: ${e.message}`); }
  }
  if (fired.length) {
    console.log('\n✗ event handlers that throw when triggered:');
    for (const f of fired) console.log(`   ${f}`);
  } else {
    console.log('✓ all registered event handlers survive being fired');
  }
}

// The GUI callbacks and the debug buttons never execute on load, so a
// blank-page bug can hide in any of them until the moment you use them.
//
// The GLTF path that used to be exercised here is gone with the loader: the
// dummy is procedural, so there is no file, no drag-and-drop and no parse to
// fail. That removed about a third of this section, which is the point.
if (!loadError && !frameError) {
  const deferred = [];

  // 3. Every GUI slider/toggle callback, at both ends of its range.
  for (const c of guiControllers) {
    for (const fn2 of c._handlers) {
      for (const v of [c._object[c._property], 0, 1]) {
        try { fn2(v); } catch (e) { deferred.push(`GUI onChange '${c._property}'(${v}): ${e.message}`); }
      }
    }
  }

  // 4. Every GUI button (knock down, respawn, flip, copy values…).
  for (const b of guiButtons) {
    try { b.object[b.property](); }
    catch (e) { deferred.push(`GUI button '${b.property}': ${e.message}`); }
  }

  // 5. Frames after all that poking, to catch state it left broken.
  try {
    drive(200);
  } catch (e) { deferred.push(`animation loop after interaction: ${e.message}`); }

  if (deferred.length) {
    console.log('\n✗ deferred paths that throw when exercised:');
    for (const d of [...new Set(deferred)]) console.log(`   ${d}`);
    process.exitCode = 1;
  } else {
    console.log('✓ every GUI callback and debug button survives being exercised');
  }
}

/* ---------------------------------------------------------------------------
   The camera, specifically. "The page loads" is not the same as "the camera
   works": a director that silently NaNs its orbit, never moves, or ignores the
   mode keys renders a page that is technically alive and completely unusable.
   -------------------------------------------------------------------------- */
if (!loadError && !frameError) {
  const camIssues = [];
  // Shares the one monotonic clock, so the camera section cannot rewind time
  // for whatever runs after it.
  const frames = (n) => drive(n);
  const key = (code, up) => {
    const fn = up ? winListeners.keyup : winListeners.keydown;
    if (fn) fn({ code, preventDefault() {} });
  };
  const active = () => rendered[rendered.length - 1];
  const snapshot = (c) => (c && c.position ? { x: c.position.x, y: c.position.y, z: c.position.z } : null);
  const moved = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : 0);

  frames(20);
  const cam0 = active();
  if (!cam0) camIssues.push('nothing was ever passed to renderer.render — no camera is being used');
  else if (!cam0.isPerspectiveCamera) {
    camIssues.push('the default camera is not a PerspectiveCamera');
  }

  // A camera that never moves is the failure mode a "does it throw" check misses.
  const before = snapshot(active());
  frames(60);
  const after = snapshot(active());
  if (before && after && moved(before, after) === 0 && !cameras.some((c) => c.lookedAt)) {
    camIssues.push('the camera never moves and never aims — is the director being updated?');
  }

  // Mode cycling through the keyboard path, end to end.
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    key('KeyE'); frames(2); key('KeyE', true);
    frames(45);
    const c = active();
    if (c && c.lookedAt) seen.add(`${c.lookedAt.x.toFixed(1)},${c.lookedAt.z.toFixed(1)}`);
  }
  if (seen.size < 2) camIssues.push('cycling cameras with E never changed where the camera aims');
  key('KeyQ'); frames(2); key('KeyQ', true); frames(30);

  // Free look and zoom through the real DOM handlers, including the malformed
  // events a stub will happily deliver — a wheel with no deltaY must not poison
  // the orbit with NaN, because clamp() cannot catch it.
  const canvasEvents = listeners.canvas || {};
  const lookBefore = snapshot(active());
  try {
    if (canvasEvents.mousedown) canvasEvents.mousedown({ button: 0, preventDefault() {} });
    for (let i = 0; i < 30; i++) {
      if (winListeners.mousemove) winListeners.mousemove({ movementX: 14, movementY: 3 });
      frames(1);
    }
    if (winListeners.mouseup) winListeners.mouseup({});
  } catch (e) { camIssues.push(`mouse look: ${e.message}`); }
  frames(30);
  if (lookBefore && moved(lookBefore, snapshot(active())) < 0.01) {
    camIssues.push('dragging the mouse did not move the camera — free look is not wired');
  }
  try {
    if (canvasEvents.wheel) {
      canvasEvents.wheel({ deltaY: 120, preventDefault() {} });
      canvasEvents.wheel({ preventDefault() {} });        // deliberately malformed
    }
    if (winListeners.pointerlockchange) winListeners.pointerlockchange({});
  } catch (e) { camIssues.push(`wheel/pointer lock: ${e.message}`); }
  frames(60);

  const c = active();
  const finite = c && c.position && ['x', 'y', 'z'].every((k) => Number.isFinite(c.position[k]));
  if (!finite) {
    camIssues.push(`camera position went non-finite: ${c && JSON.stringify(c.position)}`);
  }
  if (c && c.lookedAt && !['x', 'y', 'z'].every((k) => Number.isFinite(c.lookedAt[k]))) {
    camIssues.push(`camera aim went non-finite: ${JSON.stringify(c.lookedAt)}`);
  }

  if (camIssues.length) {
    console.log('\n✗ camera problems:');
    for (const m of [...new Set(camIssues)]) console.log(`   ${m}`);
    process.exitCode = 1;
  } else {
    console.log('✓ camera cycles, orbits, zooms and stays finite through all of it');
  }
}

/* --- The procedural dummy --------------------------------------------------
   "It loads" is not "the character is being driven". A rig that silently fails
   to build, or builds and never moves a mesh, produces a page that runs at 60
   fps showing a statue — and an audit that only checked for exceptions would
   call that a pass.

   This section is shorter than the one it replaced, and that is the headline
   result of the rewrite rather than an accident: there is no skin to bind, no
   bind pose to preserve, no clip to fail to resolve and no file to fail to
   parse, so there is nothing to check about any of them.
   ------------------------------------------------------------------------- */
if (!loadError && !frameError) {
  const rigIssues = [];
  const vb = globalWindow.valleyball;
  const rig = vb && vb.rig;

  if (!vb) rigIssues.push('no console handle on window.valleyball — nothing can be inspected');
  if (!rig) rigIssues.push('the dummy rig did not build at all');

  const bodyCount = worldRef.instance ? worldRef.instance.bodies.length : 0;
  const jointCount = worldRef.instance ? worldRef.instance.joints.length : 0;

  if (rig) {
    const parts = vb.parts || [];

    // --- One mesh per body, welded ---------------------------------------
    // The whole architecture in one assertion: every rigid body has exactly one
    // mesh and nothing else touches it. If this ever stops being true, the layer
    // the rewrite deleted has grown back.
    const meshed = rig.order.filter((p) => p.mesh);
    if (meshed.length !== rig.order.length) {
      rigIssues.push(`${rig.order.length - meshed.length} bodies have no mesh — `
        + 'the dummy is partly invisible');
    }
    let inScene = 0;
    scenes.forEach((sc) => sc.traverse((o) => { if (o.name === 'dummy') inScene++; }));
    if (!inScene) rigIssues.push('the dummy group was never added to the scene');

    // Skinning is GONE, and staying gone is the point of this build.
    let skinned = 0, bones = 0;
    scenes.forEach((sc) => sc.traverse((o) => {
      if (o.isSkinnedMesh) skinned++;
      if (o.isBone) bones++;
    }));
    if (skinned || bones) {
      rigIssues.push(`${skinned} skinned meshes and ${bones} bones are in the scene — `
        + 'the dummy is supposed to have neither');
    }

    // --- Structure ---------------------------------------------------------
    if (rig.order.length !== parts.length) {
      rigIssues.push(`${rig.order.length} bodies for ${parts.length} authored parts`);
    }
    if (rig.joints.length !== parts.length - 1) {
      rigIssues.push(`${rig.joints.length} joints for ${parts.length} parts — `
        + 'a tree needs exactly one fewer joint than it has nodes');
    }
    const hinged = rig.order.filter((p) => p.jointKind === 'revolute');
    if (hinged.length !== 4) {
      rigIssues.push(`${hinged.length} hinges — the two knees and two elbows should be revolute`);
    }
    const unlimited = rig.order.filter((p) => p.joint
      && p.jointKind === 'spherical' && !p.limit).map((p) => p.id);
    if (unlimited.length) {
      rigIssues.push(`${unlimited.length} ball joints have no cone limit `
        + `(${unlimited.slice(0, 4).join(', ')})`);
    }

    // --- Spawn overlap -----------------------------------------------------
    // Two colliders born inside each other are a separating impulse the size of
    // the penetration on frame one. That is the classic ragdoll that explodes
    // the instant it appears, and it is entirely avoidable by arithmetic.
    const overlaps = vb.spawnOverlaps ? vb.spawnOverlaps() : [];
    if (overlaps.length) {
      rigIssues.push(`${overlaps.length} pairs of colliding parts overlap at spawn `
        + `(${overlaps.slice(0, 3).map((o) => `${o.a}/${o.b}`).join(', ')})`);
    }

    // --- Adjacent-pair contact filtering -----------------------------------
    // Adjacent parts overlap BY DESIGN — a thigh's top is inside the pelvis,
    // that is what a hip looks like. If those pairs are allowed to collide the
    // solver pushes them apart every frame while the joint holds them together,
    // and two constraints fighting over one pair is a buzz you can see.
    if (rig.state.contactsDisabled !== rig.joints.length) {
      rigIssues.push(`${rig.state.contactsDisabled} of ${rig.joints.length} joints have `
        + 'contacts disabled — connected limbs will push each other apart');
    }

    // --- Live tuning -------------------------------------------------------
    if (rig.tuning !== vb.settings.DUM) {
      rigIssues.push('the rig copied its tuning instead of adopting it — '
        + 'every muscle slider in the GUI is inert');
    }

    // --- Mass --------------------------------------------------------------
    const mp = rig.massPlan;
    if (!mp || !(mp.ratioAfter >= 10 - 1e-6)) {
      rigIssues.push(`torso is only ${mp ? mp.ratioAfter.toFixed(2) : '?'}x the heaviest limb`);
    }

    // --- The gait and the swing --------------------------------------------
    // COMMANDED, not achieved. The stub world does not integrate, so no amount
    // of holding W will ever give this athlete velocity — a check that waits for
    // travel is waiting forever, and it spent an afternoon reporting "the dummy
    // is inert" about a rig that was working perfectly. What the audit CAN
    // establish is that the page drives the rig every frame, and that the rig
    // responds correctly when a speed is handed to it.
    const phaseBefore = rig.state.phase;
    drive(60);
    if (rig.state.phase === phaseBefore) {
      rigIssues.push('the gait phase never advanced — the page is not calling animate()');
    }

    const legs = () => rig.order.filter((p) => /thigh|calf/.test(p.id))
      .map((p) => `${p.restQ.x.toFixed(5)},${p.restQ.y.toFixed(5)},${p.restQ.z.toFixed(5)}`).join('|');
    const arms = () => rig.order.filter((p) => /upperarm|forearm/.test(p.id))
      .map((p) => `${p.restQ.x.toFixed(5)},${p.restQ.y.toFixed(5)},${p.restQ.z.toFixed(5)}`).join('|');

    const legsStill = legs();
    for (let i = 0; i < 20; i++) rig.animate(1 / 60, 6);
    if (legs() === legsStill) {
      rigIssues.push('the legs never moved at running speed — the gait is not reaching the rig');
    }
    if (!rig.state.trackedJoints) rigIssues.push('no joint received a target at all');
    if (rig.order.some((p) => !Number.isFinite(p.restQ.w))) {
      rigIssues.push('a joint target went non-finite');
    }

    // The spine is held square: that is the posture pass, and it has to survive
    // the gait trying to roll the torso underneath it.
    if (rig.tuning.spineUpright >= 1) {
      const chest = rig.part('chest');
      if (chest && Math.abs(chest.restQ.w) < 0.9999) {
        rigIssues.push('spineUpright is 1 but the chest target is not square — '
          + 'the posture override is not being applied');
      }
    }

    // THE SWING. Arms must leave the gait, the arm gain must harden, and both
    // must come back afterwards.
    // Baseline taken from an IDENTICAL call with no swing, so the only variable
    // between the two is the swing itself. Sampling it after a different speed
    // made the check pass whether or not the override existed — the arms moved
    // because the gait changed, and that read as a working swing.
    rig.setSwing(null);
    rig.animate(1 / 60, 0);
    const armsBefore = arms();
    const armGainRest = rig.part('upperarm_l').gains.stiffness;
    rig.setSwing({ kind: 'spike', phase: 'active', progress: 0.9 });
    rig.animate(1 / 60, 0);
    rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, facingAngle: 0, want: 'pinned' });
    if (!rig.isHitting) rigIssues.push('setSwing did not raise isHitting');
    if (arms() === armsBefore) {
      rigIssues.push('an overhand swing did not move the arm targets');
    }
    const armGainSwing = rig.part('upperarm_r').gains.stiffness;
    if (!(armGainSwing > armGainRest * 2)) {
      rigIssues.push(`the swinging arm did not stiffen (${armGainRest.toFixed(0)} → `
        + `${armGainSwing.toFixed(0)}) — the hit has no power behind it`);
    }
    // The legs must keep walking underneath, or you cannot dig while moving.
    const legsMid = legs();
    for (let i = 0; i < 10; i++) rig.animate(1 / 60, 6);
    if (legs() === legsMid) rigIssues.push('the legs stopped while swinging');

    rig.setSwing(null);
    rig.animate(1 / 60, 0);
    rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, facingAngle: 0, want: 'pinned' });
    if (rig.isHitting) rigIssues.push('isHitting stayed true after the swing was cleared');
    if (Math.abs(rig.part('upperarm_r').gains.stiffness - armGainRest) > 1e-6) {
      rigIssues.push('the arm gain did not return to rest after the swing');
    }

    // AND THE WIRING. Everything above drives the rig directly, which proves the
    // module works and says nothing about whether the PAGE ever calls it. Press
    // the actual hit key and watch for the rig noticing.
    let sawHit = false;
    if (winListeners.keydown) {
      winListeners.keydown({ code: 'KeyJ', preventDefault() {} });
      for (let i = 0; i < 8; i++) { drive(1); if (rig.isHitting) sawHit = true; }
      if (winListeners.keyup) winListeners.keyup({ code: 'KeyJ' });
      drive(60);                                   // let the swing finish
      if (!sawHit) {
        rigIssues.push('pressing the underhand key never reached the rig — the page '
          + 'is not feeding the action machine\'s swing state to the dummy');
      }
      if (rig.isHitting) rigIssues.push('the swing never ended — isHitting is stuck on');
    }

    // --- The accumulator ---------------------------------------------------
    // THE BUG THAT MADE THE LIMBS WILD. Rapier's addTorque writes to a
    // PERSISTENT accumulator, so a rig that adds a correction every step and
    // never clears it applies the running SUM of every correction it has ever
    // computed — sixty times the intended torque after one second.
    //
    // Driven DIRECTLY with a frozen target rather than through the page loop.
    // Through the loop the gait is sweeping the target underneath the sample, so
    // the torque changes for a perfectly innocent reason, and over a short window
    // that reads as monotonic growth — a false alarm indistinguishable from the
    // real fault. "Nothing else is changing" was true when this was written and
    // stopped being true the moment the character got muscles.
    const arm2 = rig.part('upperarm_l');
    if (arm2) {
      rig.setSwing(null);
      rig.setMode('pinned');
      const frozen = new Map(rig.order.filter((p) => p.joint).map((p) => [p.id, p.restQ]));
      arm2.body.setRotation({ x: 0, y: 0, z: 0.26, w: 0.966 });     // ~30° off
      /* ZERO IT FIRST. Without that, the accumulator is already carrying
         hundreds of N·m from the preceding run, in some arbitrary direction, and
         each new contribution is small and mostly perpendicular to it — so the
         MAGNITUDE barely moves and a relative test passes while the bug is
         present. Starting from zero makes every step's contribution collinear
         and the arithmetic exact: cleared, τ is constant; not cleared, τ is N
         times larger after N steps. */
      const step = () => {
        rig.setPose(frozen);
        rig.update(1 / 60, { spherePos: { x: 0, y: 0.45, z: 0 }, facingAngle: 0, want: 'pinned' });
        const t = arm2.body._torque;
        return Math.hypot(t.x, t.y, t.z);
      };
      arm2.body._torque = { x: 0, y: 0, z: 0 };
      const one = step();
      let many = one;
      for (let i = 0; i < 20; i++) many = step();
      if (!(one > 1e-9)) {
        rigIssues.push('no torque is being applied to a limb 30° off its target');
      } else if (many > one * 1.5) {
        rigIssues.push(`limb torque grew ${one.toFixed(2)} → ${many.toFixed(2)} N·m over 21 `
          + 'steps against a frozen target — the force accumulator is not being '
          + 'cleared, so every correction lands on top of the last');
      }
      // Leave the meshes where the bodies are: this block drove the rig outside
      // the page loop, and the sync check below would otherwise be reporting on
      // a frame that was never rendered.
      rig.sync();
    }

    // --- Meshes actually follow -------------------------------------------
    const off = rig.order.filter((p) => {
      if (!p.mesh) return false;
      const t = p.body.translation();
      return Math.hypot(p.mesh.position.x - t.x, p.mesh.position.y - t.y,
        p.mesh.position.z - t.z) > 1e-6;
    });
    if (off.length) {
      rigIssues.push(`${off.length} meshes are not on their body — sync() is not running`);
    }

    // --- Feet --------------------------------------------------------------
    const foot = rig.part('foot_l');
    if (foot && foot.collider && foot.collider.frictionRule === undefined) {
      rigIssues.push("the feet never set a friction combine rule — the floor's own "
        + 'friction will override them');
    }

    // --- Limits actually push ---------------------------------------------
    const arm = rig.part('upperarm_l');
    if (arm && arm.limit) {
      const mode = rig.mode;
      rig.setMode('ragdoll');
      // DERIVED from the joint's own cone, not hard-coded. This was a literal
      // 164°, which was comfortably outside the old 100° shoulder cone and
      // quietly inside the 165° one the overhand swing needed — so the check
      // stopped testing anything the moment the cone was widened, and said
      // nothing about it.
      const over = Math.min(Math.PI - 0.02, arm.limit.cone + 0.35);
      arm.body.setRotation({ x: 0, y: 0, z: Math.sin(over / 2), w: Math.cos(over / 2) });
      drive(3);
      if (!rig.state.limitViolations) {
        rigIssues.push('a shoulder rotated 164° reports no limit violation — '
          + 'the joint limits are not being enforced');
      }
      rig.setMode(mode);
    }

    // --- Rebuilding must not leak -----------------------------------------
    if (vb.rebuild) {
      const b0 = worldRef.instance ? worldRef.instance.bodies.length : 0;
      try { vb.rebuild(); vb.rebuild(); } catch (e) { rigIssues.push(`rebuild threw: ${e.message}`); }
      const b1 = worldRef.instance ? worldRef.instance.bodies.length : 0;
      if (b1 > b0) {
        rigIssues.push(`${b1 - b0} bodies survived two rebuilds — the rig is leaking`);
      }
    }
  }

  // --- Collision isolation ------------------------------------------------
  // The bug this guards was invisible: the locomotion sphere has no mesh, so
  // when it batted the volleyball around the ball appeared to rebound off
  // nothing. Assert the built page's actual masks, not the module's constants —
  // the module could be perfect and the page could still pass the wrong one.
  {
    const vbC = globalWindow.valleyball;
    const layers = vbC && vbC.layers;
    if (!layers) {
      rigIssues.push('no collision-layer handle exposed — the masks cannot be checked');
    } else {
      /* BOTH SIDES, checked separately. Rapier ANDs the two directions, so
         either mask alone is enough to keep them apart — which means a
         regression in one of them is INVISIBLE to the pair predicate while the
         other still holds the line. That is exactly what happened when this was
         first written: flipping the sphere's filter back to the buggy value
         changed nothing, because the ball's filter caught it. Both are asserted
         so neither can rot unnoticed. */
      if (layers.canCollide(layers.athlete, layers.ball)) {
        rigIssues.push('the locomotion sphere can still hit the ball — '
          + 'the ball will rebound off nothing beside the character');
      }
      if ((layers.athlete & 0xFFFF) & layers.LAYER.BALL) {
        rigIssues.push("the sphere's filter still lists the ball — currently harmless "
          + "because the ball's filter also excludes the sphere, but one edit from a bug");
      }
      if ((layers.ball & 0xFFFF) & layers.LAYER.ATHLETE) {
        rigIssues.push("the ball's filter still lists the locomotion sphere");
      }
      if (!layers.canCollide(layers.puppet(), layers.ball)) {
        rigIssues.push('the puppet cannot hit the ball — nothing can');
      }
      if (!layers.canCollide(layers.athlete, layers.world)
        || !layers.canCollide(layers.puppet(), layers.world)) {
        rigIssues.push('something fell through the court');
      }
      if (layers.canCollide(layers.puppet(), layers.athlete)) {
        rigIssues.push('the puppet collides with the sphere carrying it — it will jitter forever');
      }
      // And the mask the collider was actually GIVEN, not just the constant.
      const foot = rig.part('foot_l');
      if (foot && foot.collider && foot.collider.groups !== undefined
        && !layers.canCollide(foot.collider.groups, layers.ball)) {
        rigIssues.push('a puppet collider was built with a mask that cannot hit the ball');
      }
    }
  }

  // --- Facing vs the camera -----------------------------------------------
  // The bug that put the dive, the hit volumes and the visual facing all 180°
  // out. Checked at SEVERAL camera azimuths, because an offset that is wrong by
  // a constant still looks right at exactly one of them.
  {
    const vbF = globalWindow.valleyball;
    if (vbF && vbF.controller && vbF.camera) {
      const bad = [];
      for (let i = 0; i < 4; i++) {
        vbF.camera.cycle(1);
        drive(90);                      // let the facing slew settle
        const theta = vbF.camera.basisYaw;
        const phi = vbF.controller.state.facingAngle;
        // Camera forward is (−sin θ, −cos θ); body forward is (sin φ, cos φ).
        const dot = Math.sin(phi) * -Math.sin(theta) + Math.cos(phi) * -Math.cos(theta);
        if (dot < 0.9) bad.push(`${(theta * 57.3) | 0}°: dot ${dot.toFixed(2)}`);
      }
      if (bad.length) {
        rigIssues.push('the athlete is not facing where the camera looks '
          + `(${bad.join(', ')}) — the dive and the hit volumes fire that way too`);
      }
    }
  }

  // --- The sphere actually rolls ------------------------------------------
  // It always did — there are no angular locks and the drive applies nothing but
  // torque — but the debug wireframe was placed with `position` alone, so it slid
  // across the court like a decal and the mechanic looked absent.
  {
    const vbR = globalWindow.valleyball;
    if (vbR && vbR.body) {
      const before = { ...vbR.body.rotation() };
      if (winListeners.keydown) winListeners.keydown({ code: 'KeyW', preventDefault() {} });
      drive(60);
      if (winListeners.keyup) winListeners.keyup({ code: 'KeyW' });
      const after = vbR.body.rotation();
      const spun = Math.abs(after.x - before.x) + Math.abs(after.y - before.y)
        + Math.abs(after.z - before.z) + Math.abs(after.w - before.w);
      /* The stub world does not integrate, so the body cannot actually turn.
         What IS checkable is that torque reaches the BODY — and it has to be
         read off the body rather than off the controller's own readout, which
         reports the magnitude it computed rather than the vector it applied.
         Checking the readout passes even if the axis is multiplied by zero. */
      const applied = vbR.body._torque
        ? Math.hypot(vbR.body._torque.x, vbR.body._torque.y, vbR.body._torque.z) : 0;
      if (!(applied > 0)) {
        rigIssues.push('no drive torque reaches the locomotion sphere — it is not '
          + 'being asked to roll at all, so there is no momentum to gain');
      }
      // And no LINEAR force may be driving it: that would be the velocity-set
      // approach wearing a torque costume.
      const linear = vbR.body._force
        ? Math.hypot(vbR.body._force.x, vbR.body._force.z) : 0;
      if (linear > applied * 0.5) {
        rigIssues.push(`the sphere is being pushed horizontally (${linear.toFixed(0)} N) `
          + 'rather than rolled — momentum will not read as organic');
      }
      void spun;

      // And that the wireframe reads the body's rotation rather than ignoring it.
      let wire = null;
      scenes.forEach((sc) => sc.traverse((o) => {
        if (o.name === 'sphere-wire') wire = o;
      }));
      if (!wire) {
        rigIssues.push('no named sphere wireframe — cannot verify the roll is visible');
      } else {
        vbR.body.setRotation({ x: 0.3, y: 0, z: 0, w: 0.954 });
        drive(1);
        if (Math.abs(wire.quaternion.x - 0.3) > 1e-6) {
          rigIssues.push('the sphere wireframe ignores the body rotation — '
            + 'the roll is invisible, which is why it looks like it is not happening');
        }
      }
    }
  }

  /* --- The slide pose reaches the rig ---------------------------------------
     Everything in the unit suite drives the posture directly, which proves the
     POSE and says nothing about whether the PAGE ever asks for it. That exact
     gap has bitten twice now — once for the swing, once for the gait — so the
     slide is checked through the key that triggers it.
     ---------------------------------------------------------------------- */
  {
    /* `vb.rig` FRESH, not the `rig` captured at the top of this section: the
       rebuild-leak check above replaced it, and driving a destroyed rig reports
       "the page is not feeding isSliding" about a page that is doing it
       perfectly. Same trap the frame debugger hit. */
    const rigL = globalWindow.valleyball && globalWindow.valleyball.rig;
    let sawSlide = false, asymmetric = false;
    if (!rigL) rigIssues.push('the rig vanished before the slide check');
    else {
    if (winListeners.keydown) {
      /* SPEED HAS TO BE FAKED. A slide refuses to start below
         `slideMinEntrySpeed`, and the stub world does not integrate, so no
         amount of holding W will ever give this athlete velocity. Writing it
         onto the body directly is the only way to reach the state at all — and
         it is the state, not the acceleration, that this section is about. */
      const vb2 = globalWindow.valleyball;
      if (vb2 && vb2.body && vb2.body.setLinvel) {
        vb2.body.setLinvel({ x: 0, y: 0, z: 9 }, true);
      }
      winListeners.keydown({ code: 'KeyW', preventDefault() {} });
      drive(4);
      winListeners.keydown({ code: 'KeyC', preventDefault() {} });   // slide
      for (let i = 0; i < 40; i++) {
        drive(1);
        if (rigL.state.slide > 0.5) {
          sawSlide = true;
          /* ASYMMETRY, measured live rather than read off the table: the two
             legs must be doing different things, which is the entire point of
             the pose. A symmetric slide is the mannequin it replaced. */
          const l = rigL.part('thigh_l').restQ, r = rigL.part('thigh_r').restQ;
          const lk = rigL.part('calf_l').restAngle, rk = rigL.part('calf_r').restAngle;
          if (Math.abs(l.x - r.x) > 0.05 || Math.abs(lk - rk) > 0.3) asymmetric = true;
        }
      }
      if (winListeners.keyup) {
        winListeners.keyup({ code: 'KeyC' });
        winListeners.keyup({ code: 'KeyW' });
      }
    }
    if (!sawSlide) {
      rigIssues.push('holding the slide key never put the rig into the slide posture — '
        + 'the page is not feeding isSliding to the dummy');
    } else if (!asymmetric) {
      rigIssues.push('the slide pose is symmetric — both legs are doing the same thing, '
        + 'which is the mannequin the asymmetric pose was built to replace');
    }

    // And it must let go. "Immediately" in the brief means fast, not
    // instantaneous — an instant target change lurches a PD rig.
    drive(20);
    if (rigL.state.slide > 0.05) {
      rigIssues.push(`the slide posture did not release (${rigL.state.slide.toFixed(2)}) — `
        + 'the pose outlives the state that asked for it');
    }
    drive(120);
    }
  }

  // --- The player state machine -------------------------------------------
  {
    const vbS2 = globalWindow.valleyball;
    const ps = vbS2 && vbS2.player;
    if (!ps) {
      rigIssues.push('no player state object — the action booleans are still scattered');
    } else {
      for (const k of ['isGrounded', 'isDiving', 'isHitting', 'isSliding', 'isKnocked',
        'isStrafing', 'isLocked', 'action']) {
        if (ps[k] === undefined) rigIssues.push(`player state is missing ${k}`);
      }
      /* EXCLUSIVITY, checked DURING a dive. Asserting it while the player is
         standing still is asserting nothing: both flags are false and the
         implication holds vacuously. Trigger the dive and look. */
      if (winListeners.keydown) {
        winListeners.keydown({ code: 'KeyL', preventDefault() {} });   // dive
        let sawDive = false, overlapped = false;
        for (let i = 0; i < 30; i++) {
          drive(1);
          if (ps.isDiving) { sawDive = true; if (ps.isSliding) overlapped = true; }
        }
        if (winListeners.keyup) winListeners.keyup({ code: 'KeyL' });
        if (!sawDive) {
          rigIssues.push('pressing dive never reached the player state — the machine is not wired');
        } else if (overlapped) {
          rigIssues.push('the player was diving AND sliding at once — the states are not exclusive');
        }
        drive(120);                                  // let the dive resolve
      }
    }
  }

  /* --- The visible character -------------------------------------------------
     The audit has no GLTFLoader and no `fetch`, so the real model never loads
     here — which makes this the check for the FALLBACK, and the fallback is the
     one that has to be right for anyone who opens the page without an asset.
     A dummy hidden with nothing to replace it is an empty court and no clue why.

     Then a hand-built glTF is fed straight to `adoptCharacter`, exercising the
     swap, the toggle and the per-frame drive without a file.
     ---------------------------------------------------------------------- */
  {
    const vbV = globalWindow.valleyball;
    if (!vbV || typeof vbV.adoptCharacter !== 'function') {
      rigIssues.push('no adoptCharacter on the console handle — the character '
        + 'swap is unreachable and cannot be checked');
    } else {
      if (vbV.view) {
        rigIssues.push('a character view exists although no model was ever loaded');
      }
      /* AT BOOT, not now: the GUI exerciser above flips every boolean it can
         reach, so the live value has nothing to say about what the player saw
         on the first frame. A build with no model must open showing something. */
      if (vbV.bootDummyVisible !== true) {
        rigIssues.push('the procedural dummy is HIDDEN at boot with no character '
          + 'loaded — the page would open on an empty court');
      }

      // Build the smallest thing `createCharacterView` accepts, using the
      // page's own THREE so the stub is exercised rather than bypassed.
      const T3 = vbV.three || null;
      let built = null;
      try {
        built = vbV.adoptCharacter(makeFakeGltf(), 'audit-stub');
      } catch (err) {
        rigIssues.push(`adoptCharacter threw on a minimal glTF: ${err && err.message}`);
      }
      void T3;

      if (built) {
        if (!vbV.view) rigIssues.push('adoptCharacter returned but set no view');

        /* THE TOGGLE IS AUTHORITATIVE, BOTH WAYS. Adopting a character must not
           unconditionally hide the primitives — it must respect the debug
           setting, or turning them on and then loading a model would silently
           turn them off again mid-session. (The GUI exerciser above flips every
           boolean it can find, so the setting really is arbitrary by now — set
           it explicitly rather than assuming a default that no longer holds.) */
        vbV.dummyVisible = false;
        vbV.adoptCharacter(makeFakeGltf(), 'audit-stub-2');
        if (vbV.dummyVisible) {
          rigIssues.push('the procedural dummy is still visible after a character '
            + 'loaded with the toggle OFF — it should step aside');
        }
        vbV.dummyVisible = true;
        vbV.adoptCharacter(makeFakeGltf(), 'audit-stub-3');
        if (!vbV.dummyVisible) {
          rigIssues.push('loading a character turned the procedural dummy off '
            + 'although the toggle was ON — the debug view is not authoritative');
        }
        vbV.dummyVisible = false;

        // And the per-frame drive must actually move it.
        drive(30);
        const p0 = { x: vbV.view.root.position.x, z: vbV.view.root.position.z };
        if (vbV.body && vbV.body.setTranslation) {
          vbV.body.setTranslation({ x: 5, y: 1, z: -4 }, true);
        }
        drive(30);
        const p1 = vbV.view.root.position;
        if (Math.abs(p1.x - p0.x) < 1 || Math.abs(p1.z - p0.z) < 1) {
          rigIssues.push('the character does not follow the physics sphere — '
            + `moved to (${p1.x.toFixed(2)}, ${p1.z.toFixed(2)}) after the body went to (5, -4)`);
        }
        if (!Number.isFinite(p1.x) || !Number.isFinite(p1.y) || !Number.isFinite(p1.z)) {
          rigIssues.push('the character position went non-finite');
        }
        if (vbV.body && vbV.body.setTranslation) vbV.body.setTranslation({ x: 0, y: 1, z: 0 }, true);
        drive(60);
      }
    }
  }

  /* --- The authored-clip layer -----------------------------------------------
     TWO CLAIMS, and the first matters more than the second.

       1. With NO file loaded it changes NOTHING. This was added to a controller
          that is already tuned, and the whole safety argument is that the
          procedural path is untouched until a file arrives. An assertion is the
          only version of that claim worth having.
       2. With a pose pushed in, the rig's targets actually move.
     ---------------------------------------------------------------------- */
  {
    const vbC = globalWindow.valleyball;
    const rigC = vbC && vbC.rig;
    if (!rigC) {
      rigIssues.push('the rig vanished before the clip-layer check');
    } else if (typeof rigC.setClipPose !== 'function') {
      rigIssues.push('the rig has no setClipPose — the clip layer is not wired in');
    } else {
      vbC.actions.reset();
      if (vbC.body && vbC.body.setLinvel) vbC.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      drive(180);

      // The layer has to be REACHABLE, or its inertness is inertness for the
      // wrong reason — a step that was never wired in is also very quiet.
      if (!vbC.clips) {
        rigIssues.push('no clips handle on the console object — the clip layer '
          + 'is not reachable, so "it changes nothing" proves nothing');
      } else {
        if (vbC.clips.loaded) {
          rigIssues.push('the clip layer reports a file loaded when none was dropped');
        }
        if (typeof vbC.clips.step !== 'function') {
          rigIssues.push('the per-step clip hook is not exposed — it may not be called at all');
        }
        // Calling it with no file must be a no-op that does not throw.
        try {
          vbC.clips.step(1 / 60, vbC.player, 0);
        } catch (err) {
          rigIssues.push(`the clip step throws with no file loaded: ${err && err.message}`);
        }
      }

      // 1. INERT WITH NO FILE. Sample the composed targets over several frames
      // and require them to be bit-identical to a run with the layer explicitly
      // cleared — if a no-file frame differed at all, something is leaking.
      const sample = () => {
        const t = rigC.composeTargets(0, vbC.settings.GAIT);
        return [...t.entries()].map(([k, q]) => `${k}:${q.x.toFixed(9)},${q.y.toFixed(9)},${q.z.toFixed(9)},${q.w.toFixed(9)}`).join('|');
      };
      const before = sample();
      rigC.setClipPose(null, 0);
      const after = sample();
      if (before !== after) {
        rigIssues.push('the clip layer is not inert with no file loaded — the '
          + 'procedural targets changed, and nothing has been dropped on the page');
      }

      // 2. A POSE PUSHED IN REACHES THE TARGETS. Built by hand here rather than
      // from a file, because the audit has no filesystem — the retarget itself
      // is verified against the real .glb in test-clip-retarget.mjs.
      const pose = new Map([['upperarm_l', { x: 0.3826834, y: 0, z: 0, w: 0.9238795 }]]);
      rigC.setClipPose(pose, 1);
      const driven = rigC.composeTargets(0, vbC.settings.GAIT);
      const arm = driven.get('upperarm_l');
      const dot = arm ? Math.abs(arm.x * 0.3826834 + arm.w * 0.9238795) : 0;
      if (!arm || dot < 0.999) {
        rigIssues.push('a clip pose did not reach the rig\'s joint targets — '
          + 'the base layer is being overwritten by the gait');
      }
      // And at weight 0 it must fall straight back to procedural.
      rigC.setClipPose(pose, 0);
      if (sample() !== before) {
        rigIssues.push('clip weight 0 does not restore the procedural targets exactly');
      }
      rigC.setClipPose(null, 0);
      drive(60);
    }
  }

  /* --- The hover: does the body actually go down? ---------------------------
     The rig tests prove `postureLean` commands the right height. This proves
     the PAGE asks for the posture at all, and that the pin obeys — a pelvis
     that stays at standing height while the athlete "slides" is the reported
     symptom, and it is invisible to both module suites.
     ---------------------------------------------------------------------- */
  {
    const vbH = globalWindow.valleyball;
    const rigH = vbH && vbH.rig;
    if (!rigH) {
      rigIssues.push('the rig vanished before the hover check');
    } else if (rigH.state.coreLiftNow === undefined) {
      rigIssues.push('the rig does not publish coreLiftNow — the commanded pelvis '
        + 'height cannot be checked, only guessed at');
    } else {
      /* SETTLE FIRST. Earlier sections leave the athlete mid-dive, mid-skid or
         on the floor, and the posture blend persists for as long as the state
         does — so "standing height" measured here would be a dive's floor and
         the check would fail describing nothing. Reset, stop, and let the
         posture slew all the way back before reading anything. */
      vbH.actions.reset();
      if (vbH.body && vbH.body.setLinvel) vbH.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      if (winListeners.keyup) {
        for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyL', 'Space', 'ShiftLeft']) {
          winListeners.keyup({ code });
        }
      }
      drive(240);

      const standing = rigH.state.coreLiftNow;
      const full = vbH.settings.DUM.coreLift;
      if (Math.abs(standing - full) > 1e-6) {
        rigIssues.push(`standing, the pin commands ${standing.toFixed(3)} m rather than `
          + `the full ${full} m — something is dropping the body when it should not`);
      }

      // SLIDE, through the key, with the speed faked (the stub does not
      // integrate, so no amount of holding W produces velocity).
      let lowestSlide = Infinity;
      if (winListeners.keydown && vbH.body && vbH.body.setLinvel) {
        vbH.body.setLinvel({ x: 0, y: 0, z: 9 }, true);
        winListeners.keydown({ code: 'KeyW', preventDefault() {} });
        drive(3);
        winListeners.keydown({ code: 'KeyC', preventDefault() {} });
        for (let i = 0; i < 40; i++) {
          vbH.body.setLinvel({ x: 0, y: 0, z: 9 }, true);
          drive(1);
          const r = globalWindow.valleyball.rig;
          if (r && r.state.slide > 0.9) lowestSlide = Math.min(lowestSlide, r.state.coreLiftNow);
        }
        if (winListeners.keyup) { winListeners.keyup({ code: 'KeyC' }); winListeners.keyup({ code: 'KeyW' }); }
      }
      const slideFloor = vbH.settings.DUM.slideLiftFloor;
      if (!Number.isFinite(lowestSlide)) {
        rigIssues.push('the slide posture never reached full weight, so the hover '
          + 'could not be measured');
      } else if (Math.abs(lowestSlide - slideFloor) > 1e-6) {
        rigIssues.push(`a committed slide commands ${lowestSlide.toFixed(3)} m rather `
          + `than the ${slideFloor} m floor — the athlete is HOVERING`);
      } else if (!(lowestSlide < full * 0.5)) {
        rigIssues.push(`the slide floor (${slideFloor}) is not meaningfully below `
          + `standing height (${full}) — the fix is tuned out`);
      }

      /* And it comes back up. The slide above ends by STALLING — velocity is
         zeroed and the stall floor puts the athlete on the floor, which is
         correct and is also a knockdown, during which nothing is pinned at all.
         Reset out of it rather than waiting the knockdown plus recovery. */
      vbH.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      vbH.actions.reset();
      drive(180);
      const back = globalWindow.valleyball.rig.state.coreLiftNow;
      if (Math.abs(back - full) > 1e-3) {
        rigIssues.push(`standing height was not restored after the slide `
          + `(${back.toFixed(3)} of ${full}) — the athlete stays crouched`);
      }
      drive(200);
    }
  }

  /* --- Jump costs stamina, and an empty tank refuses it ---------------------- */
  {
    const vbJ = globalWindow.valleyball;
    const stamJ = vbJ && vbJ.stamina;
    if (stamJ && winListeners.keydown) {
      vbJ.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      vbJ.actions.reset();
      stamJ.reset();
      drive(60);
      const before = stamJ.value;
      winListeners.keydown({ code: 'Space', preventDefault() {} });
      drive(2);
      if (winListeners.keyup) winListeners.keyup({ code: 'Space' });
      drive(2);
      const spent = before - stamJ.value;
      const cost = vbJ.settings.STAM.jumpCost;
      if (spent < cost - 1e-6) {
        rigIssues.push(`a jump cost ${spent.toFixed(1)} rather than ${cost} — `
          + 'the jump is not billed, or is billed on the press instead of the launch');
      }
      /* And an empty tank refuses it, visibly.

         ZERO THE VELOCITY FIRST. The stub world does not integrate, so the
         7.3 m/s the legitimate jump above just wrote stays on the body forever
         — and reading it back here would report "an exhausted athlete jumped"
         about the jump that already happened, correctly, ten lines ago. */
      stamJ.reset(0);
      stamJ.drain('slide', 1);
      vbJ.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      drive(90);
      vbJ.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      const y0 = vbJ.body.translation().y;
      winListeners.keydown({ code: 'Space', preventDefault() {} });
      drive(4);
      if (winListeners.keyup) winListeners.keyup({ code: 'Space' });
      if (vbJ.body.linvel().y > 1 || vbJ.body.translation().y > y0 + 0.2) {
        rigIssues.push('an exhausted athlete still jumped — canJump does not consult '
          + 'the stamina pool');
      }
      if (!stamJ.denied) {
        rigIssues.push('a refused jump did not flash the bar — an empty tank presents '
          + 'as a dead button');
      }
      stamJ.reset();
      vbJ.actions.reset();
      drive(90);
    }
  }

  /* --- Live tuning, and the midair-dive toggle -------------------------------
     THE REPORTED SYMPTOM: "Allow midair dive" was checked and the dive still
     would not fire. Two causes, and this section guards both.

       1. The action machine COPIED its tuning at construction, so writing
          `ACT.diveRequiresGround = false` on the demo's object never reached
          the gate. Every ACT slider was inert the same way.
       2. Two GUI controls over one rule — this one, and "Ground required" in
          the Dive folder — with opposite polarity and no synchronisation.

     Checked by IDENTITY as well as by behaviour: if the module is holding the
     same object the GUI is bound to, no amount of later refactoring can
     reintroduce the snapshot without this failing.
     ---------------------------------------------------------------------- */
  {
    const vbT = globalWindow.valleyball;
    const set = vbT && vbT.settings;
    if (!set || !set.ACT || !set.TUNING || !set.STAM) {
      rigIssues.push('the console handle does not expose the tuning objects — '
        + 'liveness cannot be checked from here');
    } else {
      if (vbT.actions.tuning !== set.ACT) {
        rigIssues.push('the action machine is not holding the GUI\'s tuning object — '
          + 'every Slide/Dive/Skid slider is a snapshot and does nothing');
      }
      if (vbT.controller.tuning !== set.TUNING) {
        rigIssues.push('the controller is not holding the GUI\'s tuning object — '
          + 'every Movement/Slide/Dive slider is inert');
      }
      if (vbT.stamina && vbT.stamina.tuning !== set.STAM) {
        rigIssues.push('the stamina module is not holding the GUI\'s tuning object — '
          + 'the whole economy folder is inert');
      }

      // And the toggle itself, fired the way lil-gui fires it.
      const toggles = guiControllers.filter((c) => c._property === 'allowMidairDive');
      if (!toggles.length) {
        rigIssues.push('no "Allow midair dive" control is registered with an onChange');
      } else {
        /* FIRED ONE AT A TIME, not all together. Firing them as a group hides
           the exact bug this section exists for: with two controls over one
           rule, an inverted one is REPAIRED by the correct one running after
           it, and the group result looks fine. Each control has to be right on
           its own. */
        const fireOne = (c, v) => { c._object[c._property] = v; c._handlers.forEach((h) => h(v)); };
        const fire = (v) => { for (const c of toggles) fireOne(c, v); };
        for (const c of toggles) {
          fireOne(c, true);
          if (set.ACT.diveRequiresGround !== false) {
            rigIssues.push('a midair-dive control is wired with the WRONG POLARITY — '
              + 'turning it ON re-enabled the ground gate');
          }
          fireOne(c, false);
          if (set.ACT.diveRequiresGround !== true) {
            rigIssues.push('a midair-dive control is wired with the WRONG POLARITY — '
              + 'turning it OFF cleared the ground gate');
          }
        }
        fire(false);
        if (set.ACT.diveRequiresGround !== true) {
          rigIssues.push('turning the midair toggle OFF did not restore the ground gate');
        }
        const refused = vbT.actions.tryDive(false) === false;
        if (!refused) {
          rigIssues.push('NEGATIVE CONTROL FAILED: a midair dive was allowed with the gate on');
        }
        vbT.actions.reset();

        fire(true);
        if (set.ACT.diveRequiresGround !== false) {
          rigIssues.push('the midair toggle did not clear diveRequiresGround');
        } else if (vbT.actions.tryDive(false) !== true) {
          rigIssues.push('"Allow midair dive" is on, the flag is clear, and the dive is '
            + 'STILL refused — something else in the chain is gating on grounded');
        }
        // Both controls must agree afterwards, or the other folder shows a stale
        // value and whichever you touch last silently wins.
        const disagree = toggles.some((c) => c._object[c._property] !== true);
        if (disagree) {
          rigIssues.push('the two midair-dive controls disagree after one was changed');
        }
        fire(false);
        vbT.actions.reset();
        drive(60);
      }
    }
  }

  /* --- Stamina: the meter, the lockout, and the bar --------------------------
     Three things, and the third is the one no unit test can reach. A resource
     system whose arithmetic is perfect and whose bar never moves is, from the
     player's side, a game that randomly refuses inputs.
     ---------------------------------------------------------------------- */
  {
    const vbT = globalWindow.valleyball;
    const stam = vbT && vbT.stamina;
    const psT = vbT && vbT.player;
    const actT = vbT && vbT.actions;
    const bodyT = vbT && vbT.body;
    const fillEl = document.getElementById('staminaFill');
    const barEl = document.getElementById('stamina');
    const numEl = document.getElementById('staminaNum');

    if (!stam || !bodyT) {
      rigIssues.push('no stamina on the console handle — the resource layer is not wired');
    } else if (!fillEl || !barEl) {
      rigIssues.push('no #staminaFill / #stamina in the markup — the bar does not exist');
    } else {
      // Settle, so the tank is full and nothing is in flight.
      bodyT.setLinvel({ x: 0, y: 0, z: 0 }, true);
      stam.reset();
      drive(320);

      const widthAt = () => parseFloat(String(fillEl.style.width)) || 0;
      const full = widthAt();
      if (!(full > 99)) {
        rigIssues.push(`the stamina bar reads ${full}% on a full tank — `
          + 'the fill width is not being driven from the value');
      }

      /* THE COST REACHES THE METER, and the METER reaches the BAR. Both halves,
         because either one alone can be right while the other is broken. */
      const before = stam.value;
      if (winListeners.keydown) {
        winListeners.keydown({ code: 'KeyL', preventDefault() {} });
        drive(1);
        if (winListeners.keyup) winListeners.keyup({ code: 'KeyL' });
        drive(2);
      }
      if (!(stam.value < before - 1)) {
        rigIssues.push(`a dive did not debit the tank (${before} -> ${stam.value}) — `
          + 'the action machine has no stamina collaborator');
      } else if (!(widthAt() < full - 1)) {
        rigIssues.push(`the tank fell to ${stam.value.toFixed(0)} but the bar still `
          + `reads ${widthAt()}% — the fill width is not following the value`);
      }
      if (psT && Math.abs(psT.stamina - stam.value) > 1e-6) {
        rigIssues.push('player.stamina disagrees with the module — the view is stale');
      }

      // Let the dive/skid finish before testing the lockout.
      bodyT.setLinvel({ x: 0, y: 0, z: 0 }, true);
      drive(400);

      /* EXHAUSTION, through the page. Empty the tank, arm the penalty, then
         press everything and check that nothing happens — and, just as
         importantly, that the bar SAYS so. */
      stam.reset(0);
      stam.drain('slide', 1);
      drive(2);
      if (!stam.exhausted) {
        rigIssues.push('draining the tank to zero did not arm the exhaustion penalty');
      }
      if (!barEl.classList.contains('out')) {
        rigIssues.push('the stamina bar has no exhausted state in the DOM — '
          + 'the player is locked out with no way to see why');
      }
      if (numEl && !/s$/.test(String(numEl.textContent))) {
        rigIssues.push(`the exhausted readout shows "${numEl.textContent}" rather than a `
          + 'countdown — there is nothing telling the player how long to wait');
      }

      if (winListeners.keydown) {
        const stateBefore = actT ? actT.state : null;
        winListeners.keydown({ code: 'KeyL', preventDefault() {} });
        drive(2);
        if (winListeners.keyup) winListeners.keyup({ code: 'KeyL' });
        if (actT && actT.state !== stateBefore) {
          rigIssues.push(`an exhausted athlete still dove (${stateBefore} -> ${actT.state}) — `
            + 'the affordability gate is not reached from the button');
        }
        winListeners.keydown({ code: 'KeyJ', preventDefault() {} });
        drive(2);
        if (winListeners.keyup) winListeners.keyup({ code: 'KeyJ' });
        if (actT && actT.hitting) {
          rigIssues.push('an exhausted athlete still swung — the hit is not gated');
        }
      }

      // And it must RECOVER. A lockout with no exit is a crash with a nicer
      // colour scheme.
      drive(600);
      if (stam.exhausted) {
        rigIssues.push('the exhaustion penalty never ended');
      } else if (!(stam.value > 0)) {
        rigIssues.push('the tank never refilled after the penalty — regeneration is dead');
      } else if (!(widthAt() > 1)) {
        rigIssues.push('the tank refilled but the bar did not — the width is written once');
      }
      if (barEl.classList.contains('out')) {
        rigIssues.push('the bar is still showing the exhausted state after recovery');
      }
      stam.reset();
      drive(120);
    }
  }

  /* --- The dive skid, through the page --------------------------------------
     Three separate things have to line up for the reported "the dive stops
     dead" to be fixed, and only the page can show all three at once:

       1. the state machine hands the dive to a SKID rather than to a stop;
       2. the controller puts the sphere on a near-frictionless contact for it,
          and does not restore traction until the skid ends;
       3. the rig keeps the athlete LAID OUT for the whole of it, instead of
          springing upright and then travelling four more metres standing up.

     Velocity is written directly for the same reason as the slide check above:
     the stub world does not integrate, so the dive's impulse produces no speed
     and the skid would end on the step it started.
     ---------------------------------------------------------------------- */
  {
    const vbK = globalWindow.valleyball;
    const rigK = vbK && vbK.rig;
    const psK = vbK && vbK.player;
    const ctrlK = vbK && vbK.controller;
    const bodyK = vbK && vbK.body;
    if (!psK || !ctrlK || !bodyK) {
      rigIssues.push('the skid check could not reach player/controller/body on the handle');
    } else if (psK.isSkidding === undefined) {
      rigIssues.push('player state has no isSkidding — the dive still resolves into a stop');
    } else if (winListeners.keydown) {
      const fast = () => bodyK.setLinvel({ x: 0, y: 0, z: 9 }, true);
      /* SETTLE FIRST. The slide check above wrote 9 m/s onto the body and the
         stub world never integrates it away, so every block after it inherits a
         sprinting athlete — and this one would start already mid-skid and never
         observe the dive at all. Zero the speed, let whatever is in flight
         resolve, and only then press the button. */
      bodyK.setLinvel({ x: 0, y: 0, z: 0 }, true);
      drive(320);
      if (psK.action !== 'none') {
        rigIssues.push(`the machine would not return to rest before the skid check `
          + `(stuck in "${psK.action}")`);
      }

      fast();
      winListeners.keydown({ code: 'KeyL', preventDefault() {} });
      drive(1);
      if (winListeners.keyup) winListeners.keyup({ code: 'KeyL' });

      let sawSkid = false, lockedThroughout = true, slipperyThroughout = true;
      let posedThroughout = true, sawSlideDuringSkid = false;
      const surfaces = new Set();
      for (let i = 0; i < 260 && !(sawSkid && i > 200); i++) {
        fast();                       // nothing integrates; hold the speed up
        drive(1);
        surfaces.add(ctrlK.state.surface);
        if (psK.isSkidding) {
          sawSkid = true;
          if (!psK.isLocked) lockedThroughout = false;
          if (ctrlK.state.surface !== 'skid') slipperyThroughout = false;
          if (psK.isSliding) sawSlideDuringSkid = true;
          // The laid-out pose has to OUTLIVE the dive state. `rig.state.dive`
          // is the posture blend, and it slews, so this is checked once the
          // skid has been running a while rather than on its first frame.
          if (i > 60 && rigK && rigK.state.dive < 0.5) posedThroughout = false;
        }
      }

      if (!sawSkid) {
        rigIssues.push('a dive never reached the skid state on the page — '
          + 'the dive still ends in a stop or a knockdown');
      } else {
        if (!lockedThroughout) {
          rigIssues.push('movement was not locked during the skid — the dive is a free dash');
        }
        if (!slipperyThroughout) {
          rigIssues.push(`the skid ran on the "${ctrlK.state.surface}" surface profile — `
            + 'traction came back while the athlete was still coasting');
        }
        if (sawSlideDuringSkid) {
          rigIssues.push('the player was skidding AND sliding at once — '
            + 'isSliding is being derived from `passive` again');
        }
        if (rigK && !posedThroughout) {
          rigIssues.push('the rig stood up during the skid — '
            + 'the athlete is travelling several metres upright');
        }
        if (!surfaces.has('dive')) {
          rigIssues.push('the dive never switched the contact profile at all');
        }

        // And it must END, on speed, restoring both halves of the profile.
        bodyK.setLinvel({ x: 0, y: 0, z: 0 }, true);
        drive(90);
        if (psK.isSkidding) {
          rigIssues.push('the skid did not end once the speed was gone');
        } else if (ctrlK.state.surface !== 'normal') {
          rigIssues.push(`traction was not restored after the skid `
            + `(surface="${ctrlK.state.surface}") — the athlete is left on ice`);
        } else if (bodyK._damping !== null
          && Math.abs(bodyK._damping - ctrlK.tuning.linearDamping) > 1e-9) {
          rigIssues.push(`linear damping was not restored after the skid `
            + `(${bodyK._damping}) — only half the profile came back`);
        }
        drive(60);
      }
    }
  }

  // --- Frame debugger -----------------------------------------------------
  // `vb.rig` fresh, not the `rig` captured above: the rebuild test just replaced
  // it, and asserting against a destroyed rig is how you get a red line that
  // describes nothing real.
  const liveRig = vb && vb.rig;
  if (liveRig) {
    let axesRoot = null;
    scenes.forEach((sc) => sc.traverse((o) => { if (o.name === 'frame-axes') axesRoot = o; }));
    if (!axesRoot) {
      rigIssues.push('no frame-axes group — there is no way to see a frame mismatch');
    } else {
      if (axesRoot.children.length !== liveRig.order.length * 2) {
        rigIssues.push(`${axesRoot.children.length} axes helpers for `
          + `${liveRig.order.length} bodies — expected one live and one target frame each`);
      }
      if (axesRoot.visible) rigIssues.push('the frame debugger is on by default — it should be opt-in');
      vb.settings.PUPPET.showAxes = true;
      axesRoot.visible = true;
      drive(30);
      const live = axesRoot.children.filter((c) => c.userData.role === 'body');
      if (live.every((c) => c.position.x === 0 && c.position.y === 0 && c.position.z === 0)) {
        rigIssues.push('the frame helpers never moved off the origin');
      }
      if (!axesRoot.children.filter((c) => c.userData.role === 'target' && c.visible).length) {
        rigIssues.push('no target frame is being drawn — the rig is publishing no pose target');
      }
      vb.settings.PUPPET.showAxes = false;
      axesRoot.visible = false;
    }
  }

  if (rigIssues.length) {
    console.log('\n✗ procedural dummy:');
    for (const m of [...new Set(rigIssues)]) console.log(`   ${m}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ dummy: ${bodyCount} bodies / ${jointCount} joints, `
      + `${rig.state.motorisedJoints} hinges, ${rig.state.contactsDisabled} adjacent pairs filtered, `
      + '0 spawn overlaps, meshes welded to bodies');
    console.log('✓ the gait drives every joint target, and rebuilding does not leak');
    console.log('✓ swings move the arms, stiffen only the swinging one, and release cleanly');
    console.log('✓ the locomotion sphere is isolated from the ball, and player state is one object');
    console.log('✓ the athlete faces where the camera looks, and the sphere is driven by torque');
  }
}

/* --- The boot diagnostics themselves --------------------------------------
   A blank page that cannot say why it is blank is the bug this exists to stop,
   so the reporting path needs its own coverage. Untested error handling is how
   you end up debugging the debugger during an outage.
   ------------------------------------------------------------------------- */
if (!loadError && !frameError) {
  const bootIssues = [];
  if (!globalWindow.__boot) bootIssues.push('no boot diagnostics installed at all');
  else {
    if (globalWindow.__boot.done !== true) {
      bootIssues.push('the page never marked its boot complete — the loading overlay would stay up');
    }
    if (typeof globalWindow.__bootStage !== 'function') bootIssues.push('__bootStage missing');
    if (!(globalWindow.__bootTimers || []).length) {
      bootIssues.push('no watchdog timer was armed — a silent failure would report nothing');
    }
    // Fire the watchdog against a page that never finished, and check it speaks.
    const el = elements.get('loading');
    if (el) {
      const saved = { done: globalWindow.__boot.done, reported: globalWindow.__boot.reported };
      globalWindow.__boot.done = false; globalWindow.__boot.reported = false;
      el.innerHTML = '';
      try { (globalWindow.__bootTimers[0] || {}).fn(); } catch (e) { bootIssues.push(`watchdog threw: ${e.message}`); }
      if (!/Startup did not finish/.test(el.innerHTML)) {
        bootIssues.push('the watchdog fired but wrote no diagnostic into #loading');
      }
      globalWindow.__boot.done = saved.done; globalWindow.__boot.reported = saved.reported;
    }
    // And that a failed import is reported rather than swallowed.
    globalWindow.__boot.done = false; globalWindow.__boot.reported = false;
    const el2 = elements.get('loading');
    if (el2) {
      el2.innerHTML = '';
      const handler = winListeners.error;
      if (handler) handler({ target: { tagName: 'SCRIPT', src: 'https://unpkg.com/three@0.165.0/build/three.module.js' } });
      if (!/Could not load a library/.test(el2.innerHTML)) {
        bootIssues.push('a failed library fetch is not reported to the user');
      }
    }
  }
  if (bootIssues.length) {
    console.log('\n✗ boot diagnostics:');
    for (const b of bootIssues) console.log(`   ${b}`);
    process.exitCode = 1;
  } else {
    console.log('✓ boot diagnostics report failures instead of hanging on a dark screen');
  }
}

if (problems.length) {
  console.log('\n⚠ warnings:');
  for (const p of [...new Set(problems)]) console.log(`   ${p}`);
}

// The summary must not contradict the checks above it. A page whose rig throws
// still "loads" — the failure is caught and reported — so `fatal` alone printed
// a reassuring green line directly under a red one, and the green is the line
// people read.
const fatal = loadError || frameError;
const failed = fatal || process.exitCode === 1;
console.log(fatal ? '\nRESULT: WOULD NOT RUN\n'
  : failed ? '\nRESULT: loads, but checks above FAILED\n'
    : '\nRESULT: loads and runs\n');
process.exit(failed ? 1 : 0);
