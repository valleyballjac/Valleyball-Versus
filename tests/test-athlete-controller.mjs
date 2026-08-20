/**
 * Offline verification of athlete-controller.js against a mock Rapier.
 * Checks the parts that are easy to get subtly wrong: slope sign conventions,
 * accel-vs-brake selection, asymmetric gravity, force reset, jump gating.
 */
import {
  createAthleteController, computeDiveImpulse, DEFAULT_TUNING,
  torqueForAccel, maxRollAccel, rollAxis, athleteColliderDesc,
} from './athlete-controller.js';

let pass = 0, fail = 0;
const approx = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

// --- Mocks -----------------------------------------------------------------
const RAPIER = {
  Ray: class { constructor(o, d) { this.origin = { ...o }; this.dir = { ...d }; } },
};

function makeRig(normal /* or null for airborne */, filterGroups) {
  const hit = normal ? { timeOfImpact: 0.45, normal } : null;
  const world = {
    hit,
    seenFilterGroups: undefined,
    castRayAndGetNormal(ray, maxToi, solid, flags, groups) {
      this.seenFilterGroups = groups;
      return this.hit;
    },
    removeCollider() {},
    createCollider() { return {}; },
  };
  const body = {
    t: { x: 0, y: 1, z: 0 },
    v: { x: 0, y: 0, z: 0 },
    f: { x: 0, y: 0, z: 0 },
    t3: { x: 0, y: 0, z: 0 },       // accumulated torque
    w: { x: 0, y: 0, z: 0 },        // angular velocity
    g: 1,
    forceResets: 0, torqueResets: 0,
    translation() { return this.t; },
    linvel() { return this.v; },
    setLinvel(v) { this.v = { ...v }; },
    addForce(f) { this.f.x += f.x; this.f.y += f.y; this.f.z += f.z; },
    addTorque(t) { this.t3.x += t.x; this.t3.y += t.y; this.t3.z += t.z; },
    resetTorques() { this.t3 = { x: 0, y: 0, z: 0 }; this.torqueResets++; },
    angvel() { return this.w; },
    setAngvel(w) { this.w = { ...w }; },
    // Faithful to Rapier: an impulse is a velocity change of impulse / mass.
    applyImpulse(i) {
      const m = this.mass();
      this.v = { x: this.v.x + i.x / m, y: this.v.y + i.y / m, z: this.v.z + i.z / m };
    },
    resetForces() { this.f = { x: 0, y: 0, z: 0 }; this.forceResets++; },
    setGravityScale(s) { this.g = s; },
    mass() { return 78; },
    setTranslation(t) { this.t = { ...t }; },
    // Damping is half of a surface profile, so the mock has to be able to
    // receive it — without this the controller's guard skips the write and a
    // test asserting "damping dropped for the slide" passes on a no-op.
    damping: null,
    dampingWrites: 0,
    setLinearDamping(d) { this.damping = d; this.dampingWrites++; },
  };
  const collider = {
    friction: null,
    frictionWrites: 0,
    setFriction(f) { this.friction = f; this.frictionWrites++; },
  };
  const ctrl = createAthleteController({
    RAPIER, world, body, collider, tuning: {}, probeFilterGroups: filterGroups,
  });
  return { world, body, collider, ctrl };
}

const noInput = { moveX: 0, moveZ: 0, sprint: false, jumpPressed: false, jumpHeld: false };
const FLAT = { x: 0, y: 1, z: 0 };
const V0 = { x: 0, y: 0, z: 0 };
// Ramp rotated -θ about X rises toward +Z, so its normal tilts toward -Z.
const rampNormal = (deg) => {
  const a = deg * Math.PI / 180;
  return { x: 0, y: Math.cos(a), z: -Math.sin(a) };
};
const T = DEFAULT_TUNING;

/* The two exit thresholds live in the ACTION machine, not here, but the range
   integrals below have to stop where the state machine actually stops. Imported
   as constants rather than re-derived so a change over there fails this file
   rather than silently shifting the expected distances. */
import { DEFAULT_ACTION_TUNING } from './athlete-actions.js';
const ACT_SKID_EXIT = DEFAULT_ACTION_TUNING.skidExitSpeed;
const SLIDE_MIN = DEFAULT_ACTION_TUNING.slideMinSpeed;

// ---------------------------------------------------------------------------
console.log('\n1. Ground detection & slope readout');
{
  const { ctrl } = makeRig(FLAT);
  ctrl.update(1 / 60, noInput);
  check('flat ground detected', ctrl.state.grounded);
  check('flat slope reads ~0°', approx(ctrl.state.slopeAngleDeg, 0, 0.01), `got ${ctrl.state.slopeAngleDeg}`);
}
{
  const { ctrl } = makeRig(rampNormal(20));
  ctrl.update(1 / 60, noInput);
  check('20° ramp reads 20°', approx(ctrl.state.slopeAngleDeg, 20, 0.01), `got ${ctrl.state.slopeAngleDeg}`);
  check('20° is traversable (< 48° default)', ctrl.state.traversable);
}
{
  const { ctrl } = makeRig(rampNormal(60));
  ctrl.update(1 / 60, noInput);
  check('60° flagged NOT traversable', !ctrl.state.traversable);
}
{
  const { ctrl } = makeRig(null);
  ctrl.update(1 / 60, noInput);
  check('no ray hit → airborne', !ctrl.state.grounded);
}

// ---------------------------------------------------------------------------
console.log('\n2. Slope direction sign convention (the easiest thing to get backwards)');
{
  // Ramp rises toward +Z. Moving +Z is UPHILL. The grade no longer scales the
  // drive — a rolling sphere handles that itself — but the READOUT still has to
  // be right, because gameplay and the HUD consume it.
  const { ctrl } = makeRig(rampNormal(20));
  ctrl.update(1 / 60, { ...noInput, moveX: 0, moveZ: 1 });
  check('moving +Z on a +Z-rising ramp reads as uphill', ctrl.state.slopeAlignment < 0,
    `alignment=${ctrl.state.slopeAlignment.toFixed(3)}`);
}
{
  const { ctrl } = makeRig(rampNormal(20));
  ctrl.update(1 / 60, { ...noInput, moveX: 0, moveZ: -1 });
  check('moving -Z on the same ramp reads as downhill', ctrl.state.slopeAlignment > 0,
    `alignment=${ctrl.state.slopeAlignment.toFixed(3)}`);
}
{
  const { ctrl } = makeRig(rampNormal(30));
  ctrl.update(1 / 60, { ...noInput, moveX: 1, moveZ: 0 });
  check('crossing the slope sideways reads as neutral',
    Math.abs(ctrl.state.slopeAlignment) < 0.02, `${ctrl.state.slopeAlignment.toFixed(4)}`);
}
{
  // The multiplier block is GONE. Its absence is the point: it reproduced,
  // badly, what the solver already does to a rolling ball.
  const { ctrl } = makeRig(rampNormal(20));
  ctrl.update(1 / 60, { ...noInput, moveZ: 1 });
  check('no speed multiplier survives in the state', ctrl.state.speedMul === undefined);
  check('and no accel multiplier either', ctrl.state.accelMul === undefined);
  check('nor in the tuning', T.uphillSpeedPenalty === undefined && T.downhillSpeedBonus === undefined);
}

// ---------------------------------------------------------------------------
console.log('\n3. Torque drive — momentum by rolling');
{
  const { body, ctrl } = makeRig(FLAT);
  body.v = { x: 0, y: 0, z: 0 };
  ctrl.update(1 / 60, { ...noInput, moveZ: 1, sprint: true });
  // Rolling toward +Z means spinning about +X. Getting this axis backwards
  // drives the athlete straight into reverse, and it is a one-character bug.
  check('driving +Z spins about +X', body.t3.x > 0 && Math.abs(body.t3.z) < 1e-9,
    `torque=(${body.t3.x.toFixed(1)}, ${body.t3.y.toFixed(1)}, ${body.t3.z.toFixed(1)})`);
  check('and drives no linear force at all — this is torque now',
    Math.abs(ctrl.state.lastForce.z) < 1e-9, `fz=${ctrl.state.lastForce.z}`);
  check('accelerating is not flagged as braking', !ctrl.state.braking);
}
{
  const { body, ctrl } = makeRig(FLAT);
  ctrl.update(1 / 60, { ...noInput, moveX: 1 });
  check('driving +X spins about -Z', body.t3.z < 0 && Math.abs(body.t3.x) < 1e-9,
    `torque=(${body.t3.x.toFixed(1)}, ${body.t3.y.toFixed(1)}, ${body.t3.z.toFixed(1)})`);
}
{
  // Every rolling axis must be horizontal. A vertical component would spin the
  // ball on the spot instead of moving it.
  let bad = 0;
  for (let deg = 0; deg < 360; deg += 11) {
    const r = rollAxis(Math.sin(deg * Math.PI / 180), Math.cos(deg * Math.PI / 180));
    if (Math.abs(r.y) > 1e-12) bad++;
    if (Math.abs(Math.hypot(r.x, r.z) - 1) > 1e-12) bad++;
  }
  check('the roll axis is horizontal and unit at every heading', bad === 0, `${bad}`);
}
{
  const { body, ctrl } = makeRig(FLAT);
  body.v = { x: 0, y: 0, z: T.sprintSpeed };
  ctrl.update(1 / 60, noInput);
  check('releasing input flags braking', ctrl.state.braking);
  check('brake torque opposes the roll', body.t3.x < 0, `tx=${body.t3.x.toFixed(1)}`);
  check('and is a smaller budget than driving', T.brakeTorque < T.driveTorque);
}
{
  // The ceiling is a law, not a setting. No input, no tuning and no gain may
  // produce more torque than the contact patch can transmit.
  const { body, ctrl } = makeRig(FLAT);
  let worst = 0;
  for (const speed of [0, 2, 6, 10.8, 20]) {
    for (const sprint of [false, true]) {
      body.v = { x: 0, y: 0, z: speed };
      ctrl.update(1 / 60, { ...noInput, moveZ: 1, sprint });
      worst = Math.max(worst, Math.hypot(body.t3.x, body.t3.y, body.t3.z));
    }
  }
  const ceiling = torqueForAccel(78, T.radius, maxRollAccel(T.friction, T.worldGravity));
  check('applied torque never exceeds the friction ceiling',
    worst <= ceiling + 1e-6, `${worst.toFixed(1)} vs ${ceiling.toFixed(1)} N·m`);
  check('and the ceiling is reported for the HUD',
    approx(ctrl.state.torqueCeiling, ceiling, 1e-6), `${ctrl.state.torqueCeiling.toFixed(1)}`);
}
{
  // tau = 7/5 m r a. The 7/5 is the part an obvious implementation drops, and
  // dropping it under-drives by 40%.
  check('torque for an acceleration carries the 7/5 rolling factor',
    approx(torqueForAccel(78, 0.45, 10), 1.4 * 78 * 0.45 * 10, 1e-9));
  check('the ceiling is mu*g', approx(maxRollAccel(1.05, 9.81), 10.3005, 1e-4));
  check('and today\'s friction really does give ~10 m/s²',
    maxRollAccel(T.friction, T.worldGravity) > 9 && maxRollAccel(T.friction, T.worldGravity) < 12,
    `${maxRollAccel(T.friction, T.worldGravity).toFixed(2)} m/s²`);
}
{
  // A ROLLING integrator, not a linear one: torque spins the ball up, friction
  // at the contact converts spin into travel, and slip is what is left over.
  // This is the only test that can tell "the numbers are right" from "the model
  // is right", and every headline figure in the plan comes out of it.
  function rollSim(input, seconds, tuning) {
    const { body, ctrl } = makeRig(FLAT);
    Object.assign(ctrl.tuning, tuning || {});
    const dt = 1 / 240;
    const m = 78, r = ctrl.tuning.radius;
    const I = 0.4 * m * r * r;   // solid sphere
    const mu = ctrl.tuning.friction, g = ctrl.tuning.worldGravity;
    let t = 0, dist = 0, maxSlip = 0;
    while (t < seconds) {
      ctrl.update(dt, input);
      const tau = body.t3.x;                       // rolling in +Z, spin about +X
      // Contact friction solves for the force that removes slip, capped by mu*N.
      const slipV = body.w.x * r - body.v.z;
      let f = (m * tau * r - I * m * slipV / Math.max(dt, 1e-9) * 0) / (I + m * r * r);
      f = (tau / r) * (m * r * r) / (I + m * r * r);
      const fMax = mu * m * g;
      if (Math.abs(f) > fMax) f = Math.sign(f) * fMax;
      body.v.z += (f / m) * dt;
      body.w.x += ((tau - f * r) / I) * dt;
      dist += body.v.z * dt;
      maxSlip = Math.max(maxSlip, Math.abs(body.w.x * r - body.v.z));
      t += dt;
      if (input.stopAt && body.v.z >= input.stopAt) break;
    }
    return { t, dist, v: body.v.z, spin: body.w.x, maxSlip };
  }

  const sprint = rollSim({ ...noInput, moveZ: 1, sprint: true, stopAt: T.sprintSpeed - 0.05 }, 6);
  check('a torque-driven sprint reaches top speed in about a second',
    sprint.t > 0.6 && sprint.t < 2.2, `${sprint.t.toFixed(2)} s`);
  // Longer than it was, and that is the point of the softer response gain: the
  // acceleration now tapers toward top speed instead of running at the friction
  // ceiling until it arrives, so the last few m/s take real distance to gather.
  check('over a run-up you can see', sprint.dist > 3 && sprint.dist < 20,
    `${sprint.dist.toFixed(2)} m`);
  check('rolling without slipping: spin*r tracks travel',
    sprint.maxSlip < 0.6, `worst slip ${sprint.maxSlip.toFixed(3)} m/s`);
  console.log(`       → 0 → ${sprint.v.toFixed(1)} m/s in ${sprint.t.toFixed(2)} s over ${sprint.dist.toFixed(2)} m`);

  // The ceiling has to BITE. Halve the friction and everything must get slower;
  // if it does not, the model is not actually friction-limited.
  const slippery = rollSim({ ...noInput, moveZ: 1, sprint: true, stopAt: T.sprintSpeed - 0.05 }, 12,
    { friction: T.friction * 0.4 });
  check('less friction means a slower sprint', slippery.t > sprint.t * 1.6,
    `${slippery.t.toFixed(2)} s vs ${sprint.t.toFixed(2)} s`);
  console.log(`       → at 40% friction: ${slippery.t.toFixed(2)} s`);
}
{
  // Coasting: no input, no torque, so nothing but rolling resistance slows it.
  const { body, ctrl } = makeRig(FLAT);
  body.v = { x: 0, y: 0, z: T.sprintSpeed };
  body.w = { x: T.sprintSpeed / T.radius, y: 0, z: 0 };
  ctrl.update(1 / 60, { ...noInput, moveZ: 1, sprint: true });
  check('rolling AT target speed applies almost no torque',
    Math.hypot(body.t3.x, body.t3.z) < torqueForAccel(78, T.radius, 1),
    `${Math.hypot(body.t3.x, body.t3.z).toFixed(1)} N·m`);
  check('and the slip readout confirms it is truly rolling',
    ctrl.state.slip < 0.01, `${ctrl.state.slip.toFixed(4)} m/s`);
  check('and momentum is now conservation, not a brake value',
    T.angularDamping > 0 && T.angularDamping < 1, `angularDamping=${T.angularDamping}`);
}
{
  const { body, ctrl } = makeRig(null);        // airborne
  body.v = { x: 0, y: -2, z: 0 };
  ctrl.update(1 / 60, { ...noInput, moveZ: 1, sprint: true });
  const air = Math.hypot(body.t3.x, body.t3.z);
  const ground = (() => {
    const g = makeRig(FLAT);
    g.ctrl.update(1 / 60, { ...noInput, moveZ: 1, sprint: true });
    return Math.hypot(g.body.t3.x, g.body.t3.z);
  })();
  check('airborne torque is a fraction of grounded torque',
    air <= ground * T.airTorqueMul + 1e-6, `${air.toFixed(1)} vs ${ground.toFixed(1)} N·m`);
}
{
  const { body, ctrl } = makeRig(FLAT);
  body.v = { x: 0, y: 0, z: 4 };
  ctrl.update(1 / 60, { ...noInput, frozen: true });
  check('a knocked athlete stops spinning outright',
    body.w.x === 0 && body.w.y === 0 && body.w.z === 0, JSON.stringify(body.w));
  check('and sheds its speed', ctrl.state.lastForce.z < 0);
}

// ---------------------------------------------------------------------------
console.log('\n4. Gravity: the anti-float system');
{
  const { body, ctrl } = makeRig(null);
  body.v = { x: 0, y: 4, z: 0 };
  ctrl.update(1 / 60, { ...noInput, jumpHeld: true });
  check('rising with jump held → light gravity', approx(ctrl.state.gravityScale, T.riseGravityMul),
    `got ${ctrl.state.gravityScale}`);
}
{
  const { body, ctrl } = makeRig(null);
  body.v = { x: 0, y: 4, z: 0 };
  ctrl.update(1 / 60, { ...noInput, jumpHeld: false });
  check('rising after release → jump-cut gravity', approx(ctrl.state.gravityScale, T.riseGravityMul * T.jumpCutMul),
    `got ${ctrl.state.gravityScale}`);
}
{
  const { body, ctrl } = makeRig(null);
  body.v = { x: 0, y: -4, z: 0 };
  ctrl.update(1 / 60, { ...noInput, jumpHeld: true });
  check('falling → heavy gravity', approx(ctrl.state.gravityScale, T.fallGravityMul), `got ${ctrl.state.gravityScale}`);
  check('fall gravity strictly heavier than rise (no float)', T.fallGravityMul > T.riseGravityMul);
}
{
  const { body, ctrl } = makeRig(null);
  body.v = { x: 0, y: -200, z: 0 };
  ctrl.update(1 / 60, noInput);
  check('terminal velocity clamps the fall', approx(body.v.y, -T.terminalVelocity), `got ${body.v.y}`);
}
{
  // Apex timing: with these defaults the fall must be quicker than the rise.
  const g = T.worldGravity;
  const riseT = T.jumpSpeed / (g * T.riseGravityMul);
  const apex = (T.jumpSpeed ** 2) / (2 * g * T.riseGravityMul);
  const fallT = Math.sqrt((2 * apex) / (g * T.fallGravityMul));
  check('fall is faster than rise', fallT < riseT, `rise=${riseT.toFixed(3)}s fall=${fallT.toFixed(3)}s`);
  console.log(`       → apex ${apex.toFixed(2)}m, rise ${riseT.toFixed(2)}s, fall ${fallT.toFixed(2)}s, airtime ${(riseT + fallT).toFixed(2)}s`);
}

// ---------------------------------------------------------------------------
console.log('\n5. Jump gating, coyote time & buffering');
{
  const { ctrl } = makeRig(FLAT);
  const jumped = ctrl.update(1 / 60, { ...noInput, jumpPressed: true, jumpHeld: true });
  check('jump fires when grounded', jumped === true);
}
{
  const { ctrl } = makeRig(null);
  const jumped = ctrl.update(1 / 60, { ...noInput, jumpPressed: true, jumpHeld: true });
  check('jump refused in mid-air (no coyote credit)', jumped === false);
}
{
  // Grounded, then airborne within coyote window → jump still allowed.
  const rig = makeRig(FLAT);
  rig.ctrl.update(1 / 60, noInput);           // banks coyote time
  rig.world.hit = null;                        // stepped off a ledge
  const jumped = rig.ctrl.update(1 / 60, { ...noInput, jumpPressed: true, jumpHeld: true });
  check('coyote time allows a late jump', jumped === true);
}
{
  // Press jump while airborne, land within the buffer window → jump fires.
  const rig = makeRig(null);
  rig.ctrl.update(1 / 60, { ...noInput, jumpPressed: true });   // buffered, refused
  rig.world.hit = { timeOfImpact: 0.45, normal: FLAT };          // landed
  const jumped = rig.ctrl.update(1 / 60, noInput);               // no new press
  check('jump buffer fires on landing', jumped === true);
}
{
  const { body, ctrl } = makeRig(FLAT);
  ctrl.update(1 / 60, { ...noInput, jumpPressed: true, jumpHeld: true });
  check('jump sets upward velocity', approx(body.v.y, T.jumpSpeed), `got ${body.v.y}`);
}

// ---------------------------------------------------------------------------
console.log('\n6. Force hygiene (Rapier accumulates forces until reset)');
{
  const { body, ctrl } = makeRig(FLAT);
  for (let i = 0; i < 40; i++) ctrl.update(1 / 60, { ...noInput, moveZ: 1, sprint: true });
  check('resetForces called every update', body.forceResets === 40, `got ${body.forceResets}`);
  const mag = Math.hypot(body.f.x, body.f.y, body.f.z) / 78;
  check('force does not compound across steps', mag < T.groundStick + 10,
    `accumulated ${mag.toFixed(1)} m/s²`);
  // Torque accumulates exactly the same way and needs exactly the same reset.
  // Rapier keeps user torque until it is cleared, so a missing resetTorques
  // spins the athlete up without limit — the same bug as forces, in the axis
  // that now carries all the locomotion.
  check('resetTorques called every update too', body.torqueResets === 40, `got ${body.torqueResets}`);
  const tq = Math.hypot(body.t3.x, body.t3.y, body.t3.z);
  const ceiling = torqueForAccel(78, T.radius, maxRollAccel(T.friction, T.worldGravity));
  check('and torque does not compound either', tq <= ceiling + 1e-6,
    `accumulated ${tq.toFixed(1)} N·m vs ceiling ${ceiling.toFixed(1)}`);
}
{
  const { ctrl } = makeRig(FLAT);
  ctrl.update(1 / 60, noInput);
  check('ground stick pulls down while grounded', ctrl.state.lastForce.y < 0, `fy=${ctrl.state.lastForce.y.toFixed(1)}`);
}
{
  const { ctrl } = makeRig(null);
  ctrl.update(1 / 60, noInput);
  check('no ground stick while airborne', approx(ctrl.state.lastForce.y, 0), `fy=${ctrl.state.lastForce.y}`);
}

// ---------------------------------------------------------------------------
console.log('\n7a. Analog throttle (gamepad stick pressure)');
{
  const { ctrl } = makeRig(FLAT);
  ctrl.update(1 / 60, { ...noInput, moveZ: 1, sprint: true });
  const full = ctrl.state.targetSpeed;
  const { ctrl: c2 } = makeRig(FLAT);
  c2.update(1 / 60, { ...noInput, moveZ: 1, sprint: true, magnitude: 0.5 });
  check('half stick pressure halves the target speed',
    approx(c2.state.targetSpeed, full * 0.5, 1e-9),
    `${c2.state.targetSpeed.toFixed(3)} vs ${(full * 0.5).toFixed(3)}`);
}
{
  const { ctrl } = makeRig(FLAT);
  ctrl.update(1 / 60, { ...noInput, moveZ: 1, magnitude: 0 });
  check('zero magnitude means no target speed', approx(ctrl.state.targetSpeed, 0, 1e-9));
}
{
  const { ctrl } = makeRig(FLAT);
  ctrl.update(1 / 60, { ...noInput, moveZ: 1, magnitude: 4 });
  const { ctrl: c2 } = makeRig(FLAT);
  c2.update(1 / 60, { ...noInput, moveZ: 1 });
  check('over-range magnitude is clamped to full speed',
    approx(ctrl.state.targetSpeed, c2.state.targetSpeed, 1e-9));
}
{
  const { ctrl } = makeRig(FLAT);
  ctrl.update(1 / 60, { ...noInput, moveZ: 1, sprint: true });
  const withoutMag = ctrl.state.targetSpeed;
  check('omitting magnitude behaves exactly as before (keyboard unaffected)',
    approx(withoutMag, T.sprintSpeed, 1e-9), `${withoutMag}`);
}

// ---------------------------------------------------------------------------
console.log('\n7b. Ground probe filtering (so a ragdoll limb is never "ground")');
{
  const { world, ctrl } = makeRig(FLAT, 0xFFFF0003);
  ctrl.update(1 / 60, noInput);
  check('probe filter groups are passed to the raycast',
    world.seenFilterGroups === 0xFFFF0003, `got ${world.seenFilterGroups}`);
}
{
  const { world, ctrl } = makeRig(FLAT);
  ctrl.update(1 / 60, noInput);
  check('filter is undefined when not configured', world.seenFilterGroups === undefined);
}

// ---------------------------------------------------------------------------
console.log('\n7. Too-steep slopes lose traction');
{
  const { body, ctrl } = makeRig(rampNormal(70));
  ctrl.update(1 / 60, { ...noInput, moveZ: 1, sprint: true });
  const steep = Math.hypot(body.t3.x, body.t3.z);
  const flat = (() => {
    const g = makeRig(FLAT);
    g.ctrl.update(1 / 60, { ...noInput, moveZ: 1, sprint: true });
    return Math.hypot(g.body.t3.x, g.body.t3.z);
  })();
  check('almost no drive TORQUE on a 70° face', steep < flat * 0.2,
    `${steep.toFixed(1)} vs ${flat.toFixed(1)} N·m`);
  check('and the face is flagged untraversable', !ctrl.state.traversable);
}

// ---------------------------------------------------------------------------
console.log('\n8. Dive: one committed impulse, then ballistics');
{
  // Pure maths first — no engine, no rig.
  const r = computeDiveImpulse({ facingAngle: 0, velocity: V0, mass: 78 });
  check('a standing dive launches straight along facing',
    approx(r.deltaV.z, T.diveSpeed) && approx(r.deltaV.x, 0),
    `Δv=(${r.deltaV.x.toFixed(2)}, ${r.deltaV.z.toFixed(2)})`);
  check('with the authored lift', approx(r.deltaV.y, T.diveLift), `${r.deltaV.y}`);
  check('impulse is Δv scaled by mass', approx(r.impulse.z, T.diveSpeed * 78, 1e-6));
  check('and the launch speed is reported', approx(r.launchSpeed, T.diveSpeed));
}
{
  const facing = Math.PI / 2;                       // pointing at +X
  const r = computeDiveImpulse({ facingAngle: facing, velocity: V0, mass: 78 });
  check('with no stick and no speed, the dive follows facing',
    approx(r.deltaV.x, T.diveSpeed) && approx(r.deltaV.z, 0, 1e-6),
    `Δv=(${r.deltaV.x.toFixed(2)}, ${r.deltaV.z.toFixed(2)})`);
  check('and says so', r.source === 'facing', r.source);
}
{
  /* --- WHERE THE DIVE GOES: three sources, strict priority ----------------
     The stick wins, because a dive is a REACTION and facing is slewed — bound
     to facing, a dive fired at where you were looking a moment ago, which is
     exactly wrong for the one action you press when there is no time. */
  const stick = computeDiveImpulse({
    facingAngle: 0,                                  // body pointing at +Z
    inputX: 1, inputZ: 0,                            // stick pushing at +X
    velocity: { x: 0, y: 0, z: 6 },                  // and travelling at +Z
    mass: 78,
  });
  check('the stick beats both facing and velocity',
    stick.source === 'input' && approx(stick.direction.x, 1)
    && approx(stick.direction.z, 0), `${stick.source} ${JSON.stringify(stick.direction)}`);
  check('NEGATIVE CONTROL: it really is a different direction from facing',
    Math.abs(stick.direction.z - Math.cos(0)) > 0.9);

  // Diagonal stick, so a normalisation bug cannot hide behind an axis.
  const diag = computeDiveImpulse({
    facingAngle: 0, inputX: 3, inputZ: 3, velocity: V0, mass: 78 });
  const inv = Math.SQRT1_2;
  check('a diagonal stick is normalised, not scaled',
    approx(diag.direction.x, inv) && approx(diag.direction.z, inv),
    JSON.stringify(diag.direction));
  check('so the launch speed does not depend on stick magnitude',
    approx(diag.launchSpeed, T.diveSpeed), `${diag.launchSpeed}`);

  // Stick neutral → velocity. "Keep going, but commit."
  const vel = computeDiveImpulse({
    facingAngle: Math.PI, inputX: 0, inputZ: 0,
    velocity: { x: 5, y: 0, z: 0 }, mass: 78 });
  check('a neutral stick falls back to velocity',
    vel.source === 'velocity' && approx(vel.direction.x, 1),
    `${vel.source} ${JSON.stringify(vel.direction)}`);
  check('NEGATIVE CONTROL: which is not the facing it was given',
    Math.abs(vel.direction.x - Math.sin(Math.PI)) > 0.9);

  // Below both thresholds → facing, so the button is never dead.
  const dead = computeDiveImpulse({
    facingAngle: 0,
    inputX: T.diveInputDeadzone * 0.5, inputZ: 0,
    velocity: { x: T.diveVelocityFloor * 0.5, y: 0, z: 0 }, mass: 78 });
  check('a twitching stick and a crawl both fall through to facing',
    dead.source === 'facing' && approx(dead.direction.z, 1),
    `${dead.source} ${JSON.stringify(dead.direction)}`);
  check('and the impulse is never zero, whatever the inputs',
    Math.hypot(dead.impulse.x, dead.impulse.z) > 1);

  // The thresholds themselves, at their exact boundaries.
  const justOver = computeDiveImpulse({
    facingAngle: 0, inputX: T.diveInputDeadzone + 1e-6, inputZ: 0,
    velocity: V0, mass: 78 });
  check('the deadzone is a real boundary', justOver.source === 'input', justOver.source);
  check('and it sits above the input module\'s own, so a resting stick cannot aim',
    T.diveInputDeadzone > 0.1, `${T.diveInputDeadzone}`);
}
{
  // A sprinting dive must go further than a standing one — that is the entire
  // reason to keep any of the incoming velocity.
  const still = computeDiveImpulse({ facingAngle: 0, velocity: V0, mass: 78 });
  const running = computeDiveImpulse({
    facingAngle: 0, velocity: { x: 0, y: 0, z: T.sprintSpeed }, mass: 78 });
  check('diving out of a sprint launches faster than from a standstill',
    running.launchSpeed > still.launchSpeed + 2,
    `${running.launchSpeed.toFixed(2)} vs ${still.launchSpeed.toFixed(2)} m/s`);
  check('but nowhere near the naive sum, so it cannot be stacked',
    running.launchSpeed < T.diveSpeed + T.sprintSpeed - 1,
    `${running.launchSpeed.toFixed(2)} vs naive ${(T.diveSpeed + T.sprintSpeed).toFixed(2)}`);
  check('exactly diveCancel of the run-up is discarded',
    approx(running.launchSpeed, T.sprintSpeed * (1 - T.diveCancel) + T.diveSpeed));
}
{
  // Vertical is a REPLACEMENT, so the arc does not depend on which frame of a
  // fall you happened to press in.
  const rising = computeDiveImpulse({ facingAngle: 0, velocity: { x: 0, y: 4, z: 0 }, mass: 78 });
  const falling = computeDiveImpulse({ facingAngle: 0, velocity: { x: 0, y: -9, z: 0 }, mass: 78 });
  check('lift replaces vertical velocity rather than adding to it',
    approx(rising.deltaV.y, T.diveLift - 4) && approx(falling.deltaV.y, T.diveLift + 9),
    `${rising.deltaV.y.toFixed(2)} / ${falling.deltaV.y.toFixed(2)}`);
}
{
  const { body, ctrl } = makeRig(FLAT);
  ctrl.update(1 / 60, { ...noInput, moveZ: 1 });     // face +Z
  const before = { ...body.v };
  const r = ctrl.dive();
  // FLAT. A dive is a skid, not a swan dive: nearly all of the impulse is
  // horizontal, and the vertical component only has to unstick the sphere from
  // the deck so it can skate instead of plough.
  check('dive() applies the impulse to the body, almost entirely horizontally',
    body.v.z > before.z + T.diveSpeed * 0.5 && body.v.y > 0 && body.v.y < 1.2,
    `v=(${body.v.x.toFixed(2)}, ${body.v.y.toFixed(2)}, ${body.v.z.toFixed(2)})`);
  check('and the launch is at least ten times more forward than upward',
    Math.abs(body.v.z) > Math.abs(body.v.y) * 10,
    `${(Math.abs(body.v.z) / Math.max(1e-6, Math.abs(body.v.y))).toFixed(1)}:1`);
  check('and reports what it did', r.launchSpeed > 0 && ctrl.state.lastDive === r);
  check('grounded is cleared immediately, before the next probe', !ctrl.state.grounded);
}
{
  // A dive is unsteerable. Full sideways stick must produce no lateral force.
  const { ctrl } = makeRig(FLAT);
  ctrl.update(1 / 60, { ...noInput, moveZ: 1, dive: false });
  ctrl.dive();
  ctrl.update(1 / 60, { ...noInput, moveX: 1, magnitude: 1, dive: true });
  const lateral = Math.abs(ctrl.state.lastForce.x) / 78;
  check('no steering authority mid-dive', lateral < 0.05, `${lateral.toFixed(3)} m/s²`);
  check('and no drive either — only drag opposing travel',
    ctrl.state.braking && ctrl.state.diving);
}
{
  /* RETIRED INVARIANT, recorded rather than deleted: "a dive sheds speed much
     slower than a slide". That was correct while the dive was BALLISTIC — it
     spent its length in the air where drag barely applied, so a heavy drag term
     would have killed the lunge on landing. The dive is now a grounded skid, so
     the two numbers are directly comparable for the first time and the old
     ordering is about a situation that no longer exists.

     What matters now: a dive is a COMMITTED lunge — it leaves faster and stops
     sooner. A slide is a movement tool that carries. Asserting the distances
     rather than the drags, because the distance is the thing the player feels. */
  const { body, ctrl } = makeRig(FLAT);
  body.v = { x: 0, y: 0, z: 10 };
  ctrl.update(1 / 60, { ...noInput, dive: true });
  const diveDecel = -ctrl.state.lastForce.z / 78;
  body.v = { x: 0, y: 0, z: 10 };
  ctrl.update(1 / 60, { ...noInput, slide: true });
  const slideDecel = -ctrl.state.lastForce.z / 78;
  check('dive drag matches its tuning', approx(diveDecel, T.diveDrag, 0.01));
  check('slide drag matches its tuning', approx(slideDecel, T.slideDrag, 0.01));

  /* The friction multipliers are gone; each mode names an ABSOLUTE coefficient
     now (see SURFACE PROFILES), so the range integrates from that directly.
     A dive's distance is dive-then-skid, and both legs run the same drag, so the
     two integrate as one. */
  const range = (v0, drag, mu, vEnd = 0) =>
    (v0 * v0 - vEnd * vEnd) / (2 * (mu * T.worldGravity + drag));
  const diveRange = range(T.diveSpeed, T.diveDrag, T.diveFriction, ACT_SKID_EXIT);
  const slideRange = range(T.sprintSpeed, T.slideDrag, T.slideFriction, SLIDE_MIN);
  check('a dive leaves faster than a sprinting slide', T.diveSpeed > T.sprintSpeed);
  check('and lands a committed distance rather than a flight',
    diveRange > 3 && diveRange < 12, `${diveRange.toFixed(1)} m`);
  check('while a slide carries further, because it is a way of moving',
    slideRange > diveRange, `slide ${slideRange.toFixed(1)} m vs dive ${diveRange.toFixed(1)} m`);
}
{
  // Gravity while diving must be its own, lighter pair — under the anti-float
  // jump values the arc collapses to a stumble.
  const { body, ctrl } = makeRig(null);              // airborne
  body.v = { x: 0, y: 2, z: 8 };
  ctrl.update(1 / 60, { ...noInput, dive: true });
  check('rising in a dive uses the light dive gravity',
    approx(body.g, T.diveRiseGravityMul), `${body.g}`);
  check('which is lighter than a jump-cut rise',
    T.diveRiseGravityMul < T.riseGravityMul * T.jumpCutMul);
  body.v = { x: 0, y: -2, z: 8 };
  ctrl.update(1 / 60, { ...noInput, dive: true });
  check('falling uses the dive fall gravity', approx(body.g, T.diveFallGravityMul), `${body.g}`);
  check('and it is still lighter than a normal fall',
    T.diveFallGravityMul < T.fallGravityMul);
}
{
  // The arc has to last long enough to be a dive. Integrated from the tuning:
  // rise to apex under diveRise, fall back under diveFall.
  const g = T.worldGravity;
  const rise = T.diveLift / (g * T.diveRiseGravityMul);
  const apex = 0.5 * T.diveLift * rise;
  const fall = Math.sqrt(2 * apex / (g * T.diveFallGravityMul));
  const airTime = rise + fall;
  // A dive should barely leave the ground — it is a slide. The old test wanted
  // 0.35 s of air time, which is a swan dive, and it is what made the character
  // look like it was flying.
  check('the dive barely leaves the ground', airTime < 0.20, `${airTime.toFixed(3)} s`);
  check('but it does unstick, so the sphere can skate rather than plough',
    airTime > 0.02, `${airTime.toFixed(3)} s`);

  /* THE RANGE COMES FROM THE SKID, not from the arc. With the collider's
     friction cut to `diveFriction` the sphere keeps its speed across the court
     and bleeds it slowly, so the distance is set by deceleration rather than by
     hang time. Integrated from the same numbers the controller uses:
     a = μ·g, plus the explicit drag, from launch down to the stand-up speed. */
  const decel = T.diveFriction * T.worldGravity + T.diveDrag;
  const skid = (T.diveSpeed * T.diveSpeed - ACT_SKID_EXIT * ACT_SKID_EXIT) / (2 * decel);
  check('and the skid covers a defensive dive, not a flight across the map',
    skid > 3 && skid < 12, `${skid.toFixed(1)} m at ${decel.toFixed(2)} m/s²`);
  check('which is far further than the arc alone would carry it',
    skid > T.diveSpeed * airTime * 3,
    `skid ${skid.toFixed(1)} m vs airborne ${(T.diveSpeed * airTime).toFixed(2)} m`);
  /* And the deceleration must not CHANGE at the dive→skid boundary. That
     discontinuity — full speed, then a wall — is the whole reported complaint,
     and matching the two drags is the fix. */
  const skidDecel = T.skidFriction * T.worldGravity + T.skidDrag;
  check('the skid decelerates exactly like the dive it came from',
    approx(skidDecel, decel, 1e-9),
    `dive ${decel.toFixed(3)} vs skid ${skidDecel.toFixed(3)} m/s²`);
}
{
  const { ctrl } = makeRig(FLAT);
  // Dive outranks slide when a host reports both on the same step.
  ctrl.update(1 / 60, { ...noInput, slide: true, dive: true });
  check('dive wins over slide', ctrl.state.diving && !ctrl.state.sliding);
}
{
  const { body, ctrl } = makeRig(FLAT);
  ctrl.update(1 / 60, { ...noInput });
  const vBefore = body.v.y;
  ctrl.update(1 / 60, { ...noInput, dive: true, jumpPressed: true, jumpHeld: true });
  check('you cannot jump out of a dive', body.v.y <= vBefore + 0.01,
    `vy=${body.v.y.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
console.log('\n12. Strafing — facing decoupled from travel');
{
  /* The athlete should keep their chest to the net and step sideways. Movement
     is IDENTICAL in both modes; only the visual yaw is decoupled, which is why
     "strafing" is not a separate movement mode — it is what lateral input
     already did, finally looking like it. */
  const { body, ctrl } = makeRig(FLAT);
  body.v = { x: 6, y: 0, z: 0 };                     // travelling due +X
  for (let i = 0; i < 60; i++) ctrl.update(1 / 60, { ...noInput, moveX: 1, aimYaw: 0 });
  check('in aim mode the body keeps facing the aim heading',
    Math.abs(ctrl.state.facingAngle) < 0.05,
    `${(ctrl.state.facingAngle * 180 / Math.PI).toFixed(1)}°`);
  check('and reports that it is strafing', ctrl.state.strafing);

  // Negative control: without the aim heading it must turn to follow travel,
  // or the test above passes for a rig that simply never turns.
  const t = makeRig(FLAT);
  t.body.v = { x: 6, y: 0, z: 0 };
  for (let i = 0; i < 60; i++) t.ctrl.update(1 / 60, { ...noInput, moveX: 1 });
  check('without an aim heading it turns to face travel',
    Math.abs(t.ctrl.state.facingAngle - Math.PI / 2) < 0.1,
    `${(t.ctrl.state.facingAngle * 180 / Math.PI).toFixed(1)}°`);
  check('and does not claim to be strafing', !t.ctrl.state.strafing);
}
{
  // Running straight at the aim heading is not strafing, even in aim mode.
  const { body, ctrl } = makeRig(FLAT);
  body.v = { x: 0, y: 0, z: 6 };
  for (let i = 0; i < 30; i++) ctrl.update(1 / 60, { ...noInput, moveZ: 1, aimYaw: 0 });
  check('running toward the aim heading is not a strafe', !ctrl.state.strafing);
}
{
  // The aim heading must win while airborne and while diving too — an athlete
  // who breaks their stance to look where they are sliding is the thing this
  // mode exists to stop.
  const { body, ctrl } = makeRig(null);
  body.v = { x: 8, y: -2, z: 0 };
  for (let i = 0; i < 40; i++) ctrl.update(1 / 60, { ...noInput, aimYaw: 0.9, dive: true });
  check('and it holds through a dive, in the air', Math.abs(ctrl.state.facingAngle - 0.9) < 0.05,
    `${ctrl.state.facingAngle.toFixed(3)}`);
}
{
  // Explicit mode switch, since it is a tuning value a host may set either way.
  const { body, ctrl } = makeRig(FLAT, undefined);
  ctrl.tuning.facingMode = 'travel';
  body.v = { x: 6, y: 0, z: 0 };
  for (let i = 0; i < 60; i++) ctrl.update(1 / 60, { ...noInput, moveX: 1, aimYaw: 0 });
  check("'travel' mode ignores the aim heading entirely",
    Math.abs(ctrl.state.facingAngle - Math.PI / 2) < 0.1,
    `${(ctrl.state.facingAngle * 180 / Math.PI).toFixed(1)}°`);
}

// ---------------------------------------------------------------------------
console.log('\n12b. Climb rate: the number the incline tax is billed against');
{
  /* GEOMETRIC, not `linvel().y`. Raw vertical velocity spikes on every landing,
     lip and ground-stick correction; billing stamina against it would make the
     meter twitch on flat ground. This is the along-slope component of travel:
     how much of where you are going is actually up the hill. */
  const uphill = (deg, v) => {
    const { body, ctrl } = makeRig(rampNormal(deg));
    body.v = v;
    ctrl.update(1 / 60, { ...noInput });
    return ctrl.state.climbRate;
  };
  // Ramps built by `rampNormal` rise toward +Z, so +Z is uphill.
  const climb = uphill(30, { x: 0, y: 0, z: 6 });
  check('running straight up a 30° ramp climbs at v·sinθ',
    approx(climb, 6 * Math.sin(30 * Math.PI / 180), 0.02), `${climb.toFixed(3)} m/s`);
  check('running straight down it is negative',
    uphill(30, { x: 0, y: 0, z: -6 }) < -1, `${uphill(30, { x: 0, y: 0, z: -6 }).toFixed(2)}`);
  check('TRAVERSING it costs nothing — this is the whole reason it is not '
    + 'a function of the slope angle',
    approx(uphill(30, { x: 6, y: 0, z: 0 }), 0, 1e-6),
    `${uphill(30, { x: 6, y: 0, z: 0 })}`);
  check('flat ground never climbs', approx(uphill(0, { x: 0, y: 0, z: 6 }), 0, 1e-9));
  check('a steeper ramp at the same speed climbs faster',
    uphill(40, { x: 0, y: 0, z: 6 }) > uphill(20, { x: 0, y: 0, z: 6 }) + 1);

  // NEGATIVE CONTROL for the "not raw vy" claim: a body with a big vertical
  // velocity but no horizontal travel reports no climbing at all.
  const spike = uphill(30, { x: 0, y: 9, z: 0 });
  check('NEGATIVE CONTROL: a vertical spike is not a climb', approx(spike, 0, 1e-6),
    `${spike}`);

  // And nothing is owed in mid-air.
  const { body: ab, ctrl: ac } = makeRig(null);
  ab.v = { x: 0, y: 6, z: 6 };
  ac.update(1 / 60, { ...noInput });
  check('airborne reports no climb', ac.state.climbRate === 0, `${ac.state.climbRate}`);
}

// ---------------------------------------------------------------------------
console.log('\n13. Surface profiles: friction and damping');
{
  /* FOUR MODES, ONE WRITER. Each mode names an absolute friction and an
     absolute linear damping; they are pushed on the step the mode CHANGES and
     on no other step. There used to be two writers racing here — this section
     is the reason the second one is gone. */
  const { body, collider, ctrl } = makeRig(FLAT);

  ctrl.update(1 / 60, { ...noInput });
  check('normal running uses full traction',
    approx(ctrl.state.contactFriction, T.friction) && approx(collider.friction, T.friction),
    `state ${ctrl.state.contactFriction}, collider ${collider.friction}`);
  check('and the normal damping', approx(body.damping, T.linearDamping), `${body.damping}`);
  check('the mode is reported by name', ctrl.state.surface === 'normal', ctrl.state.surface);

  ctrl.update(1 / 60, { ...noInput, slide: true });
  check('a slide is frictionless, exactly as asked',
    collider.friction === T.slideFriction && T.slideFriction === 0,
    `${collider.friction}`);
  check('and its damping is dropped to the slide value',
    approx(body.damping, T.slideDamping) && T.slideDamping < T.linearDamping,
    `${body.damping}`);

  ctrl.update(1 / 60, { ...noInput, dive: true });
  check('a dive uses the dive profile',
    approx(collider.friction, T.diveFriction), `${collider.friction}`);
  const fw = collider.frictionWrites, dw = body.dampingWrites;
  for (let i = 0; i < 20; i++) ctrl.update(1 / 60, { ...noInput, dive: true });
  check('and neither is re-written while the mode holds',
    collider.frictionWrites === fw && body.dampingWrites === dw,
    `${collider.frictionWrites - fw} friction, ${body.dampingWrites - dw} damping writes`);

  /* THE BOUNDARY THE PLAYER FEELS. A dive that decays into a skid must not
     change the contact underneath it — same friction, same damping, so the only
     thing that changed is which state the machine is in. */
  ctrl.update(1 / 60, { ...noInput, skid: true });
  check('the skid keeps the dive\'s contact',
    approx(collider.friction, T.diveFriction) && approx(body.damping, T.diveDamping),
    `${collider.friction} / ${body.damping}`);
  check('and reports itself as its own mode', ctrl.state.surface === 'skid', ctrl.state.surface);
  check('the skid is passive: no drive torque at all',
    Math.hypot(body.t3.x, body.t3.y, body.t3.z) < 1e-9);

  ctrl.update(1 / 60, { ...noInput });
  check('and traction comes back afterwards',
    approx(ctrl.state.contactFriction, T.friction) && approx(body.damping, T.linearDamping),
    `${collider.friction} / ${body.damping}`);

  /* THE MEMO'S ONE HAZARD: a value edited while its mode is already active.
     `refreshSurface()` is the escape hatch the debug UI calls. */
  ctrl.update(1 / 60, { ...noInput, slide: true });
  ctrl.tuning.slideFriction = 0.4;
  ctrl.update(1 / 60, { ...noInput, slide: true });
  check('NEGATIVE CONTROL: a live edit does not reach the collider on its own',
    collider.friction === 0, `${collider.friction}`);
  ctrl.refreshSurface();
  ctrl.update(1 / 60, { ...noInput, slide: true });
  check('but refreshSurface() re-pushes it', approx(collider.friction, 0.4), `${collider.friction}`);
  ctrl.tuning.slideFriction = T.slideFriction;
}
{
  /* THE COMBINE RULE, which is the other half of every number above.

     Rapier resolves a contact between two colliders with different rules by
     taking the higher-priority one, Max > Multiply > Min > Average. Under Max
     the coefficient is max(athlete, court) — which the athlete can only RAISE,
     so every "slippery" profile above was silently a no-op against a court at
     0.9. This assertion is the regression guard for that entire bug. */
  const seen = {};
  const desc = {
    setFriction(v) { seen.friction = v; return this; },
    setRestitution() { return this; },
    setMass() { return this; },
    setFrictionCombineRule(r) { seen.rule = r; return this; },
  };
  const RAPIER2 = {
    ColliderDesc: { ball: () => desc },
    CoefficientCombineRule: { Average: 0, Min: 1, Multiply: 2, Max: 3 },
  };
  const built = athleteColliderDesc(RAPIER2, T);
  check('the athlete combines friction with MIN, so it can go slicker than the court',
    seen.rule === RAPIER2.CoefficientCombineRule.Min, `rule=${seen.rule}`);
  check('NEGATIVE CONTROL: it is specifically not Max, which made the slide inert',
    seen.rule !== RAPIER2.CoefficientCombineRule.Max);
  check('and it still asks for the tuned coefficient',
    approx(seen.friction, T.friction) && built === desc);
  /* And the arithmetic that follows from Min: min(slide, court) is the slide
     value for any court worth standing on, whereas max() would have been the
     court's — the exact inversion that hid the mechanic. */
  const court = 0.9;
  check('under Min a sliding athlete actually gets the slide coefficient',
    Math.min(T.slideFriction, court) === T.slideFriction);
  check('NEGATIVE CONTROL: under Max they would have got the court\'s instead',
    Math.max(T.slideFriction, court) === court);
}

// ---------------------------------------------------------------------------
console.log('\n14. Momentum, not a velocity servo');
{
  /* The distinction the response gain decides. At a high gain the acceleration
     saturates the friction ceiling until top speed arrives and then stops dead,
     which is a velocity servo wearing a torque costume. At a low one it tapers
     as the gap closes. Measured as: does the applied torque FALL as the athlete
     approaches target speed? */
  const { body, ctrl } = makeRig(FLAT);
  const at = (v) => {
    body.v = { x: 0, y: 0, z: v };
    body.w = { x: v / T.radius, y: 0, z: 0 };
    ctrl.update(1 / 60, { ...noInput, moveZ: 1 });
    return Math.abs(body.t3.x);
  };
  const early = at(1), late = at(T.walkSpeed - 0.4);
  check('torque tapers as the athlete approaches target speed', late < early * 0.6,
    `${early.toFixed(0)} → ${late.toFixed(0)} N·m`);
  check('and it never exceeds what the contact can transmit',
    early <= ctrl.state.torqueCeiling + 1e-6);
}

// ---------------------------------------------------------------------------
console.log('\n15. Planting the feet on a slope');
/** The torque that exactly cancels gravity along a slope, for a rolling sphere. */
const holdNeeded = (deg) => 78 * T.radius * T.worldGravity * Math.sin(deg * Math.PI / 180);
{
  /* FRICTION CANNOT DO THIS. A ball on an incline rolls, and it rolls whatever
     the friction is — friction converts sliding into rolling, it does not stop
     the descent. A perfectly rough slope still accelerates a rolling sphere at
     g·sinθ·5/7. What holds a standing athlete is a continuous effort exactly
     cancelling gravity along the slope, which is what stanceHold applies. */

  for (const deg of [5, 10, 20]) {
    const { ctrl } = makeRig(rampNormal(deg));
    ctrl.update(1 / 60, noInput);
    check(`a ${deg}° rise is held exactly`,
      approx(ctrl.state.stanceHold, holdNeeded(deg), 0.05),
      `${ctrl.state.stanceHold.toFixed(1)} vs ${holdNeeded(deg).toFixed(1)} N·m`);
  }

  // Above the fade band the athlete is simply sliding, which is the point: a
  // gentle rise is restful, a ramp is something you fight.
  const steep = makeRig(rampNormal(T.stanceFadeSlope + 2));
  steep.ctrl.update(1 / 60, noInput);
  check('a ramp past the fade angle gets no hold at all',
    steep.ctrl.state.stanceHold === 0, `${steep.ctrl.state.stanceHold}`);

  const mid = makeRig(rampNormal((T.stanceMaxSlope + T.stanceFadeSlope) / 2));
  mid.ctrl.update(1 / 60, noInput);
  const midNeed = holdNeeded((T.stanceMaxSlope + T.stanceFadeSlope) / 2);
  check('and the band between them is a graded struggle, not a cliff',
    mid.ctrl.state.stanceHold > midNeed * 0.2 && mid.ctrl.state.stanceHold < midNeed * 0.8,
    `${mid.ctrl.state.stanceHold.toFixed(1)} of ${midNeed.toFixed(1)} N·m`);
}
{
  // It holds a STANCE, not a descent: any input, or any real speed, releases it.
  const { body, ctrl } = makeRig(rampNormal(12));
  ctrl.update(1 / 60, { ...noInput, moveZ: 1 });
  check('asking to move releases the hold immediately', ctrl.state.stanceHold === 0);

  const moving = makeRig(rampNormal(12));
  moving.body.v = { x: 0, y: 0, z: T.stanceMaxSpeed + 1 };
  moving.ctrl.update(1 / 60, noInput);
  check('and so does already being underway', moving.ctrl.state.stanceHold === 0);

  const slow = makeRig(rampNormal(12));
  slow.body.v = { x: 0, y: 0, z: T.stanceMaxSpeed * 0.5 };
  slow.ctrl.update(1 / 60, noInput);
  check('while a slow drift is still partly held',
    slow.ctrl.state.stanceHold > 0 && slow.ctrl.state.stanceHold < holdNeeded(12),
    `${slow.ctrl.state.stanceHold.toFixed(1)}`);

  const air = makeRig(null);
  air.ctrl.update(1 / 60, noInput);
  check('there is nothing to plant against in the air', air.ctrl.state.stanceHold === 0);

  const sliding = makeRig(rampNormal(12));
  sliding.ctrl.update(1 / 60, { ...noInput, slide: true });
  check('and a slide is a deliberate descent, so it is not held',
    sliding.ctrl.state.stanceHold === 0);
  void body;
}
{
  // The hold must push UPHILL. Pointing it the other way would accelerate the
  // athlete down the slope, which reads as "the hold is too weak".
  const { body, ctrl } = makeRig(rampNormal(15));   // rises toward +Z
  ctrl.update(1 / 60, noInput);
  // Uphill is +Z, so rolling uphill spins about +X.
  check('the holding torque points uphill', body.t3.x > 0,
    `torque=(${body.t3.x.toFixed(1)}, ${body.t3.y.toFixed(1)}, ${body.t3.z.toFixed(1)})`);

  const off = makeRig(rampNormal(15));
  off.ctrl.tuning.stanceHold = 0;
  off.ctrl.update(1 / 60, noInput);
  check('and 0 turns the whole feature off', off.ctrl.state.stanceHold === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
