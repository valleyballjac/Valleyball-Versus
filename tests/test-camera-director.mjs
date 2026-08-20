/**
 * Offline verification of camera-director.js against a mock THREE.
 * Focus: the spherical conventions (which must match THREE.Spherical exactly,
 * or the camera and the movement basis disagree), polar clamping, the framing
 * solver, mode blending, and the rule that a self-panning rig must not drag the
 * movement basis around with it.
 */
import {
  createCameraDirector, CAMERA_MODES, DEFAULT_CAMERA_TUNING,
  sphericalToCartesian, shortestAngle, approachAngle,
  ease, lerpFactor, distanceToFit, boundingSphere,
} from './camera-director.js';
import { cameraBasisFromYaw } from './athlete-input.js';

let pass = 0, fail = 0;
const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const DEG = Math.PI / 180;
const T = DEFAULT_CAMERA_TUNING;

/* --- Mock THREE ---------------------------------------------------------- */
class V3m {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
}
function makeCam(kind) {
  return {
    isOrthographicCamera: kind === 'ortho',
    isPerspectiveCamera: kind === 'persp',
    position: new V3m(), fov: 50, aspect: 1.6,
    left: 0, right: 0, top: 0, bottom: 0,
    lookedAt: null, projUpdates: 0,
    lookAt(x, y, z) { this.lookedAt = { x, y, z }; },
    updateProjectionMatrix() { this.projUpdates++; },
  };
}
const THREE = {
  MathUtils: { lerp: (a, b, t) => a + (b - a) * t },
  PerspectiveCamera: class { constructor(fov, aspect, near, far) {
    Object.assign(this, makeCam('persp'), { fov, aspect, near, far }); } },
  OrthographicCamera: class { constructor(l, r, t2, b, near, far) {
    Object.assign(this, makeCam('ortho'), { left: l, right: r, top: t2, bottom: b, near, far }); } },
};

const P = (x = 0, y = 0.45, z = 0) => ({ x, y, z });
function makeDirector(opts = {}) {
  return createCameraDirector(Object.assign({ THREE, aspect: 16 / 9 }, opts));
}
function run(d, seconds, ctx, dt = 1 / 60) {
  let s;
  for (let t = 0; t < seconds; t += dt) s = d.update(dt, typeof ctx === 'function' ? ctx(t) : ctx);
  return s;
}

// ---------------------------------------------------------------------------
console.log('\n1. Spherical conventions match THREE.Spherical');
{
  // THREE: theta = atan2(x, z); phi = acos(y / r). Getting either backwards
  // silently rotates the movement basis 90° against the camera.
  const o = sphericalToCartesian(10, Math.PI / 2, 0);
  check('theta = 0 points down +Z', approx(o.x, 0, 1e-9) && approx(o.z, 10, 1e-9),
    JSON.stringify(o));
  const q = sphericalToCartesian(10, Math.PI / 2, Math.PI / 2);
  check('theta = 90° points down +X', approx(q.x, 10, 1e-9) && approx(q.z, 0, 1e-9),
    JSON.stringify(q));
  const up = sphericalToCartesian(10, 0, 0);
  check('phi = 0 is straight up', approx(up.y, 10, 1e-9), JSON.stringify(up));
  const horizon = sphericalToCartesian(10, Math.PI / 2, 1.1);
  check('phi = 90° is on the horizon', approx(horizon.y, 0, 1e-9));
}
// ---------------------------------------------------------------------------
console.log('\n2. Angle helpers');
{
  check('shortest angle takes the short way round',
    approx(shortestAngle(3.0, -3.0), (2 * Math.PI - 6.0), 1e-9),
    `${shortestAngle(3.0, -3.0)}`);
  check('and is zero for identical angles', approx(shortestAngle(1.2, 1.2), 0));
  check('and is signed', shortestAngle(0, 1) > 0 && shortestAngle(0, -1) < 0);
  check('a full turn is the same angle', approx(shortestAngle(0.4, 0.4 + 2 * Math.PI), 0, 1e-9));
}
{
  check('approachAngle lands exactly when within a step',
    approx(approachAngle(1.0, 1.05, 0.5), 1.05));
  check('and steps toward otherwise', approx(approachAngle(1.0, 2.0, 0.25), 1.25));
  check('crossing PI wraps the short way',
    Math.abs(shortestAngle(approachAngle(3.1, -3.1, 0.05), -3.1)) < Math.abs(shortestAngle(3.1, -3.1)));
  // Converges rather than oscillating: the classic bug is overshoot at the wrap.
  let a = 0;
  for (let i = 0; i < 400; i++) a = approachAngle(a, -3.0, 0.05);
  check('repeated approach converges', Math.abs(shortestAngle(a, -3.0)) < 1e-9, `${a}`);
}
{
  check('ease is a smoothstep', approx(ease(0), 0) && approx(ease(1), 1) && approx(ease(0.5), 0.5));
  check('and is clamped outside 0..1', ease(-3) === 0 && ease(9) === 1);
  check('with zero slope at both ends',
    ease(0.02) < 0.02 && ease(0.98) > 0.98, `${ease(0.02)} / ${ease(0.98)}`);
}
{
  // Frame-rate independence: the same elapsed time must close the same fraction
  // of the gap however it is subdivided, or the camera stiffens on fast machines.
  const rate = 10;
  let a = 0, b = 0;
  for (let i = 0; i < 60; i++) a += (1 - a) * lerpFactor(rate, 1 / 60);
  for (let i = 0; i < 240; i++) b += (1 - b) * lerpFactor(rate, 1 / 240);
  check('lerpFactor is frame-rate independent', Math.abs(a - b) < 1e-3,
    `60Hz→${a.toFixed(5)} 240Hz→${b.toFixed(5)}`);
  check('a zero timestep moves nothing', lerpFactor(rate, 0) === 0);
}

// ---------------------------------------------------------------------------
console.log('\n3. Framing maths');
{
  const d = distanceToFit(3, 50, 16 / 9, 1);
  const halfV = Math.tan(50 * DEG / 2) * d;
  check('at the solved distance the subject exactly fills the vertical FOV',
    approx(halfV, 3, 1e-6), `${halfV.toFixed(4)}`);
  check('a wider subject needs more distance', distanceToFit(6, 50, 16 / 9) > d);
  check('a wider lens needs less', distanceToFit(3, 70, 16 / 9, 1) < d);
  check('a tall window is bound by the HORIZONTAL fov instead',
    distanceToFit(3, 50, 0.5, 1) > d, `${distanceToFit(3, 50, 0.5, 1).toFixed(2)} vs ${d.toFixed(2)}`);
  check('margin pushes it further back', distanceToFit(3, 50, 16 / 9, 1.5) > d);
  check('a degenerate subject still returns a finite distance',
    Number.isFinite(distanceToFit(0, 50, 16 / 9)));
}
{
  const s = boundingSphere([{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]);
  check('bounding sphere centres between two points', approx(s.centre.x, 0));
  check('and its radius contains them both', approx(s.radius, 2));
  const one = boundingSphere([{ x: 5, y: 1, z: -3 }]);
  check('a single point has zero radius', one.radius === 0 && one.centre.x === 5);
  check('an empty set is handled', boundingSphere([]).radius === 0);
  check('and so are null entries', boundingSphere([null, { x: 2, y: 0, z: 0 }]).centre.x === 2);
}

// ---------------------------------------------------------------------------
console.log('\n4. Projection: perspective is the default');
{
  const d = makeDirector();
  check('the camera is perspective on load', !!d.camera.isPerspectiveCamera);
  check('and NOT orthographic', !d.camera.isOrthographicCamera);
  check('the tuning agrees', DEFAULT_CAMERA_TUNING.orthographic === false);
  check('fov comes from the tuning', d.camera.fov === T.fov);
}
{
  const d = makeDirector({ tuning: { orthographic: true } });
  check('orthographic is still available as an option', !!d.camera.isOrthographicCamera);
  const half = T.orthoZoom;
  check('and is sized from the aspect', approx(d.camera.right, half * (16 / 9)));
}
{
  const d = makeDirector();
  d.update(1 / 60, { player: P(), speed: 0 });
  const before = { ...d.camera.position };
  d.tuning.orthographic = true;
  const cam = d.rebuild();
  check('rebuilding swaps projection', !!cam.isOrthographicCamera);
  check('and carries the position across, so the view does not jump',
    approx(cam.position.x, before.x) && approx(cam.position.z, before.z));
}
{
  const d = makeDirector();
  d.setAspect(0.5);
  check('resizing updates a perspective camera', approx(d.camera.aspect, 0.5));
  const o = makeDirector({ tuning: { orthographic: true } });
  o.setAspect(3);
  check('and reframes an orthographic one', approx(o.camera.right, T.orthoZoom * 3));
}

// ---------------------------------------------------------------------------
console.log('\n5. Modes and cycling');
{
  const d = makeDirector();
  check('there are four modes', CAMERA_MODES.length === 4, `${CAMERA_MODES.length}`);
  check('every mode has a unique id',
    new Set(CAMERA_MODES.map((m) => m.id)).size === CAMERA_MODES.length);
  check('every mode has a label and a blurb',
    CAMERA_MODES.every((m) => m.label && m.blurb));
  check('every mode solves', CAMERA_MODES.every((m) => typeof m.solve === 'function'));
  check('the action cam is first', d.mode.id === 'action', d.mode.id);
}
{
  const seen = [];
  const d = makeDirector({ onModeChange: (m) => seen.push(m.id) });
  for (let i = 0; i < CAMERA_MODES.length; i++) d.cycle(1);
  check('cycling forward visits every mode and wraps',
    seen.join(',') === 'arena,rally,broadcast,action', seen.join(','));
  check('and lands back where it started', d.mode.id === 'action');
}
{
  const seen = [];
  const d = makeDirector({ onModeChange: (m) => seen.push(m.id) });
  d.cycle(-1);
  check('cycling backward wraps to the last mode', seen[0] === 'broadcast', seen[0]);
  d.cycle(-1);
  check('and keeps going backward', d.mode.id === 'rally', d.mode.id);
}
{
  const d = makeDirector();
  check('setMode by id works', d.setMode('broadcast') && d.mode.id === 'broadcast');
  check('setting the current mode is a no-op', d.setMode('broadcast') === false);
  check('an unknown id is refused', d.setMode('nope') === false);
  check('and leaves the mode alone', d.mode.id === 'broadcast');
}
{
  // Per-mode orbit state must survive a round trip, or every cycle resets the
  // view you just set up.
  const d = makeDirector();
  d.update(1 / 60, { player: P(), speed: 0 });
  d.look(0.7, 0.2);
  const theta = d.orbit.theta;
  d.cycle(1); d.cycle(1); d.cycle(1); d.cycle(1);
  check('each mode remembers its own orbit', approx(d.orbit.theta, theta), `${d.orbit.theta}`);
}

// ---------------------------------------------------------------------------
console.log('\n6. Free look and the polar clamp (the gimbal-lock guard)');
{
  const d = makeDirector();
  d.update(1 / 60, { player: P(), speed: 0 });
  const before = d.orbit.theta;
  d.look(0.3, 0);
  check('looking right decreases theta, so the world swings left',
    d.orbit.theta < before, `${d.orbit.theta} vs ${before}`);
  check('and it is 1:1 with the input', approx(d.orbit.theta, before - 0.3));
}
{
  // Slam it at both poles for a long time; phi must never reach 0 or PI, where
  // azimuth stops meaning anything and the view rolls.
  const d = makeDirector();
  d.update(1 / 60, { player: P(), speed: 0 });
  for (let i = 0; i < 500; i++) d.look(0, -1);
  check('polar is clamped near the zenith',
    approx(d.orbit.phi, T.minPolarDeg * DEG), `${(d.orbit.phi / DEG).toFixed(2)}°`);
  check('and never reaches the pole itself', d.orbit.phi > 0.01);
  for (let i = 0; i < 500; i++) d.look(0, 1);
  check('polar is clamped near the horizon',
    approx(d.orbit.phi, T.maxPolarDeg * DEG), `${(d.orbit.phi / DEG).toFixed(2)}°`);
  check('and never reaches the far pole', d.orbit.phi < Math.PI - 0.01);
}
{
  // Azimuth must NOT be clamped — it has to wrap freely.
  const d = makeDirector();
  d.update(1 / 60, { player: P(), speed: 0 });
  for (let i = 0; i < 2000; i++) d.look(0.05, 0);
  check('azimuth wraps without limit', Math.abs(d.orbit.theta) > 20, `${d.orbit.theta.toFixed(2)}`);
  const s = d.update(1 / 60, { player: P(), speed: 0 });
  check('and the reported azimuth is still normalised to 0..360',
    s.azimuthDeg >= 0 && s.azimuthDeg < 360, `${s.azimuthDeg}`);
}
{
  const d = makeDirector({ tuning: { invertY: true } });
  d.update(1 / 60, { player: P(), speed: 0 });
  const a = d.orbit.phi;
  d.look(0, 0.2);
  const inverted = d.orbit.phi - a;
  const d2 = makeDirector();
  d2.update(1 / 60, { player: P(), speed: 0 });
  const b = d2.orbit.phi;
  d2.look(0, 0.2);
  check('invertY flips the pitch direction', Math.sign(inverted) === -Math.sign(d2.orbit.phi - b));
}
{
  const d = makeDirector();
  d.setMode('broadcast');
  d.update(1 / 60, { player: P(), speed: 0 });
  const before = d.orbit.theta;
  check('a fixed rig refuses free look', d.look(1.0, 1.0) === false);
  check('and its orbit is untouched', approx(d.orbit.theta, before));
}
{
  const d = makeDirector();
  d.update(1 / 60, { player: P(), speed: 0 });
  const r0 = d.orbit.radius;
  d.zoom(-0.3);
  check('zooming in shortens the orbit', d.orbit.radius < r0);
  for (let i = 0; i < 100; i++) d.zoom(-1);
  check('and is clamped so it cannot pass through the athlete', d.orbit.radius >= 2.0);
  for (let i = 0; i < 100; i++) d.zoom(1);
  check('and clamped at the far end too', d.orbit.radius <= 60);
}

// ---------------------------------------------------------------------------
console.log('\n7. Auto-recentre');
{
  // Moving, no look input: the camera should drift behind the direction of travel.
  const d = makeDirector();
  const ctx = { player: P(), speed: 8, travelYaw: 0 };   // running toward +Z
  run(d, 4.0, ctx);
  const behind = Math.PI;                                 // camera sits at -Z
  check('the camera drifts behind the direction of travel',
    Math.abs(shortestAngle(d.orbit.theta, behind)) < 0.05,
    `${(d.orbit.theta / DEG).toFixed(1)}° vs ${(behind / DEG).toFixed(1)}°`);
}
{
  // Standing still: leave the view alone. Nudging the camera while the player
  // is reading the field is the camera taking control away for no reason.
  const d = makeDirector();
  run(d, 0.5, { player: P(), speed: 0 });
  d.look(1.2, 0);
  const theta = d.orbit.theta;
  run(d, 4.0, { player: P(), speed: 0, travelYaw: 0 });
  check('but not while standing still', approx(d.orbit.theta, theta, 1e-9),
    `${d.orbit.theta} vs ${theta}`);
}
{
  const d = makeDirector();
  run(d, 0.5, { player: P(), speed: 8, travelYaw: 0 });
  d.look(1.0, 0);
  const theta = d.orbit.theta;
  const s = run(d, T.recentreDelay * 0.5, { player: P(), speed: 8, travelYaw: 0 });
  check('the recentre waits out its delay after you let go', approx(d.orbit.theta, theta));
  check('and reports that it is not recentring yet', !s.recentring);
  const s2 = run(d, 1.0, { player: P(), speed: 8, travelYaw: 0 });
  check('then engages', s2.recentring && !approx(d.orbit.theta, theta));
}
{
  const d = makeDirector({ tuning: { autoRecentre: false } });
  run(d, 0.5, { player: P(), speed: 8, travelYaw: 0 });
  d.look(1.0, 0);
  const theta = d.orbit.theta;
  run(d, 5.0, { player: P(), speed: 8, travelYaw: 0 });
  check('auto-recentre can be turned off entirely', approx(d.orbit.theta, theta));
}
{
  const d = makeDirector();
  d.setMode('arena');
  run(d, 0.5, { player: P(), speed: 8, travelYaw: 0 });
  d.look(1.0, 0);
  const theta = d.orbit.theta;
  run(d, 5.0, { player: P(), speed: 8, travelYaw: 0 });
  check('the arena cam never recentres — a stable basis is its whole point',
    approx(d.orbit.theta, theta), `${d.orbit.theta} vs ${theta}`);
}

// ---------------------------------------------------------------------------
console.log('\n8. Following and blending');
{
  const d = makeDirector();
  const s = d.update(1 / 60, { player: P(0, 0.45, 0), speed: 0 });
  const c = d.camera.position;
  check('the first frame places the camera exactly, with no fly-in',
    Math.hypot(c.x, c.y, c.z) > 1, JSON.stringify(c));
  check('and it is looking at the athlete', !!d.camera.lookedAt);
  const dist = Math.hypot(c.x - d.camera.lookedAt.x, c.y - d.camera.lookedAt.y, c.z - d.camera.lookedAt.z);
  check('at the rig\'s orbit radius', approx(dist, s.radius, 1e-6), `${dist.toFixed(3)}`);
}
{
  // Follow the athlete across the map and stay a fixed distance behind.
  const d = makeDirector();
  let x = 0;
  run(d, 6, () => { x += 0.05; return { player: P(x, 0.45, 0), speed: 3, travelYaw: Math.PI / 2 }; });
  const c = d.camera.position;
  check('the camera keeps up with a moving athlete',
    Math.hypot(c.x - x, c.z) < d.orbit.radius + 3,
    `player x=${x.toFixed(2)} camera x=${c.x.toFixed(2)}`);
}
{
  const d = makeDirector();
  run(d, 1.0, { player: P(), speed: 0 });
  const before = { ...d.camera.position };
  d.setMode('broadcast');
  const s = d.update(1 / 60, { player: P(), speed: 0 });
  const after = d.camera.position;
  check('a mode switch starts a blend', s.blending && s.blend < 1, `${s.blend}`);
  check('and does NOT teleport the camera',
    Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) < 3.0,
    `moved ${Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z).toFixed(2)} m in one frame`);
  const s2 = run(d, T.blendTime + 0.2, { player: P(), speed: 0 });
  check('the blend completes', !s2.blending && s2.blend === 1);
}
{
  // A raw distance cap is the wrong test: arena→broadcast is a genuine 40 m
  // move, and covering it in 0.6 s is FAST but not a jump. What distinguishes a
  // teleport from a fast fly is the SHAPE of the step profile — a smoothstep
  // starts at zero velocity and peaks at 1.5× its mean. A discontinuity shows
  // up as a spike against that envelope, at any distance.
  let worstFirst = 0, worstRatio = 0, firstPair = '', ratioPair = '';
  for (const from of CAMERA_MODES) {
    for (const to of CAMERA_MODES) {
      if (from.id === to.id) continue;
      const d = makeDirector({ mode: from.id });
      const ctx = { player: P(3, 0.45, -2), ball: { x: -6, y: 2, z: 5 }, speed: 0 };
      run(d, 1.0, ctx);
      d.setMode(to.id);
      const steps = [];
      let prev = { ...d.camera.position };
      while (d.state.blend < 1) {
        d.update(1 / 60, ctx);
        const c = d.camera.position;
        steps.push(Math.hypot(c.x - prev.x, c.y - prev.y, c.z - prev.z));
        prev = { ...c };
      }
      const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
      const ratio = Math.max(...steps) / Math.max(1e-9, mean);
      if (steps[0] > worstFirst) { worstFirst = steps[0]; firstPair = `${from.id}→${to.id}`; }
      if (ratio > worstRatio) { worstRatio = ratio; ratioPair = `${from.id}→${to.id}`; }
    }
  }
  check('no transition moves on its first frame — it eases out of rest',
    worstFirst < 0.05, `worst ${worstFirst.toFixed(4)} m on ${firstPair}`);
  check('and every transition stays inside the smoothstep envelope',
    worstRatio < 1.75, `peak/mean ${worstRatio.toFixed(3)} on ${ratioPair}`);
}
{
  const d = makeDirector();
  run(d, 1.0, { player: P(), speed: 0 });
  d.setMode('arena');
  d.snap();
  const s = d.update(1 / 60, { player: P(), speed: 0 });
  check('snap() drops the camera straight onto the rig', !s.blending);
  const c = d.camera.position, t = d.camera.lookedAt;
  check('exactly at the orbit radius',
    approx(Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z), s.radius, 1e-6));
}

// ---------------------------------------------------------------------------
console.log('\n9. The movement basis (the part that breaks controls if it is wrong)');
{
  const d = makeDirector();
  run(d, 0.5, { player: P(), speed: 0 });
  const before = d.basisYaw;
  d.look(0.8, 0);
  const s = d.update(1 / 60, { player: P(), speed: 0 });
  check('orbiting rotates the movement basis with the camera',
    Math.abs(shortestAngle(before, s.basisYaw)) > 0.5,
    `${before.toFixed(3)} → ${s.basisYaw.toFixed(3)}`);
  check('and it tracks free look exactly, with no lag',
    approx(s.basisYaw, d.orbit.theta, 1e-9), `${s.basisYaw} vs ${d.orbit.theta}`);
}
{
  // A broadcast rig pans a long way as the play moves. Its basis must not.
  const d = makeDirector({ mode: 'broadcast' });
  const yaws = [];
  for (let i = 0; i < 240; i++) {
    const x = -16 + i * 0.13;
    yaws.push(d.update(1 / 60, { player: P(x, 0.45, 0), ball: { x: x + 4, y: 1, z: 3 }, speed: 6 }).basisYaw);
  }
  const spread = Math.max(...yaws) - Math.min(...yaws);
  check('a panning broadcast rig does NOT drag the basis with it',
    spread < 1e-9, `${(spread / DEG).toFixed(2)}° of swing`);
  // …but the camera itself really is panning, or the test proves nothing.
  const t = d.camera.lookedAt;
  check('while the camera genuinely re-aims across the play', Math.abs(t.x) > 4, `${t.x.toFixed(2)}`);
}
{
  // The rally rig aims itself, so its basis is rate-limited.
  const d = makeDirector({ mode: 'rally' });
  const ctx = { player: P(), ball: { x: 0, y: 1, z: 6 }, speed: 4 };
  run(d, 1.0, ctx);
  const before = d.state.basisYaw;
  // Ball teleports to the far side: the rig wants to swing 180° instantly.
  let worst = 0, prev = before;
  for (let i = 0; i < 60; i++) {
    const s = d.update(1 / 60, { player: P(), ball: { x: 0, y: 1, z: -6 }, speed: 4 });
    worst = Math.max(worst, Math.abs(shortestAngle(prev, s.basisYaw)));
    prev = s.basisYaw;
  }
  check('a self-aiming rig turns at a capped rate',
    worst <= T.autoAimRate / 60 + 1e-9, `${(worst * 60 / DEG).toFixed(1)}°/s`);
  check('but it does keep turning', Math.abs(shortestAngle(before, prev)) > 0.5);
}
{
  // Across a blend the basis has to ride the same curve as the camera, or for
  // half a second the controls point somewhere the camera isn't.
  const d = makeDirector({ mode: 'action' });
  const ctx = { player: P(), ball: { x: 4, y: 1, z: 4 }, speed: 0 };
  run(d, 1.0, ctx);
  d.look(2.4, 0);                       // put the two rigs far apart
  run(d, 0.2, ctx);
  const start = d.state.basisYaw;
  d.setMode('arena');
  let maxStep = 0, prev = start, samples = 0;
  for (let i = 0; i < 60; i++) {
    const s = d.update(1 / 60, ctx);
    maxStep = Math.max(maxStep, Math.abs(shortestAngle(prev, s.basisYaw)));
    prev = s.basisYaw; samples++;
  }
  check('the basis eases across a mode change rather than snapping',
    maxStep < 0.12, `worst step ${(maxStep / DEG).toFixed(2)}°`);
  check('and arrives at the new rig', Math.abs(shortestAngle(prev, d.orbit.theta)) < 1e-6);
  void samples;
}

// ---------------------------------------------------------------------------
console.log('\n10. Rally cam actually frames both subjects');
{
  const d = makeDirector({ mode: 'rally' });
  const near = { player: P(), ball: { x: 0, y: 0.5, z: 2 }, speed: 0 };
  const far = { player: P(), ball: { x: 0, y: 6, z: 22 }, speed: 0 };
  const a = run(d, 2.0, near).radius;
  const b = run(d, 2.0, far).radius;
  check('it pulls back when the ball is far away', b > a + 3, `${a.toFixed(1)} → ${b.toFixed(1)}`);
  check('and stays within its clamps', b <= 34 && a >= 6.5);
}
{
  // The real check: are both subjects inside the frustum? Decomposed PER AXIS,
  // because the vertical FOV is the tight one on a wide window — comparing a
  // single cone angle against max(halfV, halfH) would pass a shot that has
  // already slid off the top of the screen.
  const d = makeDirector({ mode: 'rally' });
  // -Infinity, not 0: seeded at 0 this could only ever report "exactly on the
  // edge", and the assertion below could never fail whatever the camera did.
  let worstH = -Infinity, worstV = -Infinity, tightest = Infinity;
  for (const aspect of [16 / 9, 4 / 3, 0.6]) {
    for (const ball of [
      { x: 0, y: 0.5, z: 4 }, { x: 8, y: 3, z: 8 }, { x: -12, y: 1, z: -6 },
      { x: 0, y: 9, z: 1 }, { x: 14, y: 0.3, z: -14 }, { x: -3, y: 14, z: 2 },
    ]) {
      const ctx = { player: P(), ball, speed: 0, aspect };
      const s = run(d, 3.0, ctx);
      const cam = d.camera.position, t = d.camera.lookedAt;
      // Camera basis: forward, then right and up as three.js builds them.
      const f = { x: t.x - cam.x, y: t.y - cam.y, z: t.z - cam.z };
      const fl = Math.hypot(f.x, f.y, f.z); f.x /= fl; f.y /= fl; f.z /= fl;
      const r = { x: f.z, y: 0, z: -f.x };                    // f × worldUp
      const rl = Math.hypot(r.x, r.z) || 1; r.x /= rl; r.z /= rl;
      const u = {                                             // r × f
        x: r.z * f.y, y: r.x * f.z - r.z * f.x, z: -r.x * f.y,
      };
      const halfV = s.fov * DEG / 2;
      const halfH = Math.atan(Math.tan(halfV) * aspect);
      for (const p of [{ x: 0, y: 1.45, z: 0 }, ball]) {
        const v = { x: p.x - cam.x, y: p.y - cam.y, z: p.z - cam.z };
        const depth = v.x * f.x + v.y * f.y + v.z * f.z;
        const ah = Math.atan2(Math.abs(v.x * r.x + v.z * r.z), depth);
        const av = Math.atan2(Math.abs(v.x * u.x + v.y * u.y + v.z * u.z), depth);
        worstH = Math.max(worstH, ah - halfH);
        worstV = Math.max(worstV, av - halfV);
        tightest = Math.min(tightest, halfV - av, halfH - ah);
      }
    }
  }
  check('athlete and ball stay inside the frustum HORIZONTALLY, at every aspect',
    worstH < 0, `worst overshoot ${(worstH / DEG).toFixed(2)}°`);
  check('and vertically, which is the tight axis on a wide window',
    worstV < 0, `worst overshoot ${(worstV / DEG).toFixed(2)}°`);
  // And not so far back that the framing is meaningless — a camera in the next
  // county trivially passes a "both in frame" test.
  check('without simply retreating until everything fits',
    tightest < 12 * DEG, `${(tightest / DEG).toFixed(2)}° of unused margin at the tightest`);
}
{
  const d = makeDirector({ mode: 'rally' });
  const s = run(d, 2.0, { player: P(), ball: { x: 0, y: 1, z: 8 }, speed: 0 });
  // Camera behind the athlete means the ball is beyond the athlete from here.
  const cam = d.camera.position;
  const toPlayer = Math.hypot(cam.x - 0, cam.z - 0);
  const toBall = Math.hypot(cam.x - 0, cam.z - 8);
  check('the rig sits behind the athlete, with the ball beyond', toBall > toPlayer,
    `player ${toPlayer.toFixed(1)} m, ball ${toBall.toFixed(1)} m`);
  void s;
}
{
  const d = makeDirector({ mode: 'rally' });
  const s = run(d, 2.0, { player: P(), speed: 0 });     // no ball at all
  check('with no ball it degrades to framing the athlete alone',
    Number.isFinite(s.radius) && s.radius > 0, `${s.radius}`);
}

// ---------------------------------------------------------------------------
console.log('\n11. Robustness');
{
  const d = makeDirector();
  let threw = false;
  try {
    for (let i = 0; i < 4000; i++) {
      if (i % 401 === 0) d.cycle(i % 802 === 0 ? -1 : 1);
      d.look(Math.sin(i) * 0.3, Math.cos(i * 0.7) * 0.2);
      d.zoom(Math.sin(i * 0.3) * 0.05);
      d.update(1 / 60, {
        player: P(Math.sin(i / 50) * 20, 0.45 + (i % 30) * 0.1, Math.cos(i / 37) * 20),
        ball: { x: Math.cos(i / 13) * 25, y: (i % 90) * 0.12, z: Math.sin(i / 17) * 25 },
        speed: (i % 12), travelYaw: i * 0.01, aspect: 0.4 + (i % 40) * 0.1,
      });
    }
  } catch (e) { threw = true; console.log('   threw:', e.message); }
  check('4000 chaotic frames across every mode never throw', !threw);
  const c = d.camera.position;
  check('and the camera stays finite',
    Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z), JSON.stringify(c));
  check('polar never escaped its clamp',
    d.orbit.phi >= T.minPolarDeg * DEG - 1e-9 && d.orbit.phi <= T.maxPolarDeg * DEG + 1e-9);
  check('and the basis is a real angle', Number.isFinite(d.basisYaw));
}
{
  const d = makeDirector();
  let threw = false;
  try {
    d.update(1 / 60, { player: P() });                       // no ball, no speed
    d.update(0, { player: P(), speed: 0 });                  // zero timestep
    d.update(1 / 60, { player: P(), ball: null, speed: 0 });
    d.update(0.5, { player: P(), speed: 0 });                // a huge frame
  } catch (e) { threw = true; console.log('   threw:', e.message); }
  check('missing ball, zero dt and long frames are all tolerated', !threw);
}
{
  const d = makeDirector();
  run(d, 1.0, { player: P(9, 3, -4), speed: 5, travelYaw: 1 });
  d.look(3, 0.5);
  d.zoom(0.4);
  d.cycle(1);
  d.reset();
  check('reset returns every orbit to its home', approx(d.orbit.radius, d.mode.home.radius));
  check('and clears the free-look offset', d.orbit.lookTheta === 0);
  const s = d.update(1 / 60, { player: P(9, 3, -4), speed: 0 });
  check('and the next frame snaps rather than flying in', !s.blending);
}

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
