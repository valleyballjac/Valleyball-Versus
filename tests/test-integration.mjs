/**
 * End-to-end integration of the puppet-and-ball stack against a mock Rapier,
 * running the exact per-frame sequence the demo uses:
 *
 *
 * The point is the seams: that stick input reaches the ball as world-space
 * motion, that the puppet's transform is derived only from the ball, that a
 * knockdown actually locks input and zeroes momentum, and that control comes
 * back afterwards.
 */
import { createAthleteController, computeDiveImpulse, DEFAULT_TUNING } from './athlete-controller.js';
import { createAthleteActions, DEFAULT_ACTION_TUNING } from './athlete-actions.js';
import {
  createAthleteStamina, DEFAULT_STAMINA_TUNING, inclineDrainRate,
} from './athlete-stamina.js';
import {
  createGameBall, computeHitImpulse, evaluateReach, reachOptions, contactPoint,
  DEFAULT_BALL_TUNING, DEFAULT_HIT_TUNING,
} from './game-ball.js';
import { createAthleteInput, cameraBasisFromYaw, writeCameraBasis } from './athlete-input.js';
import { createCameraDirector, shortestAngle } from './camera-director.js';

let pass = 0, fail = 0;
const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const T = DEFAULT_TUNING;
const AC = DEFAULT_ACTION_TUNING;
const BL = DEFAULT_BALL_TUNING;
const HT = DEFAULT_HIT_TUNING;
const DT = 1 / 60;
// deliberately real enough to read back: an audit that cannot see where the
// camera ended up cannot tell a working rig from a dead one.
const THREE = {
  LoopOnce: 2200, LoopRepeat: 2201,
  MathUtils: { lerp: (a, b, t) => a + (b - a) * t },
  PerspectiveCamera: class {
    constructor(fov, aspect) {
      Object.assign(this, { fov, aspect, isPerspectiveCamera: true, lookedAt: null });
      this.position = {
        x: 0, y: 0, z: 0,
        set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
        copy(v) { return this.set(v.x, v.y, v.z); },
      };
    }
    lookAt(x, y, z) { this.lookedAt = { x, y, z }; }
    updateProjectionMatrix() {}
  },
  OrthographicCamera: class {
    constructor() {
      this.isOrthographicCamera = true;
      this.position = { x: 0, y: 0, z: 0, set() { return this; }, copy() { return this; } };
    }
    lookAt() {} updateProjectionMatrix() {}
  },
};
const ISO = cameraBasisFromYaw(45 * Math.PI / 180);

const G_WORLD = 0x0001, G_PROP = 0x0002, G_ATHLETE = 0x0004;
const GROUPS_ATHLETE = (G_ATHLETE << 16) | (G_WORLD | G_PROP);
const RAY_FILTER = (0xFFFF << 16) | (G_WORLD | G_PROP);

const clip = (name, duration) => ({ name, duration });

/* --- Mock Rapier: flat ground, semi-implicit integration ----------------- */
function makeWorld(groundHeightAt = () => 0) {
  const bodies = [];
  const rayCalls = [];
  const RAPIER = {
    Ray: class { constructor(o, d) { this.origin = { ...o }; this.dir = { ...d }; } },
    RigidBodyDesc: {
      dynamic: () => {
        const d = { _t: { x: 0, y: 0, z: 0 } };
        d.setTranslation = (x, y, z) => { d._t = { x, y, z }; return d; };
        d.lockRotations = () => d; d.setLinearDamping = () => d; d.setCanSleep = () => d;
        d.setAngularDamping = () => d;
        return d;
      },
    },
    ColliderDesc: {
      ball: (r) => {
        const c = { shape: 'ball', r, mass: 1, groups: null };
        c.setMass = (m) => { c.mass = m; return c; };
        c.friction = 1;
        c.setFriction = (f) => { c.friction = f; return c; };
        c.setRestitution = () => c;
        c.setCollisionGroups = (g) => { c.groups = g; return c; };
        return c;
      },
    },
  };
  const world = {
    gravity: { x: 0, y: -T.worldGravity, z: 0 },
    createRigidBody(d) {
      const b = {
        _t: { ...d._t }, _v: { x: 0, y: 0, z: 0 }, _f: { x: 0, y: 0, z: 0 },
        _tq: { x: 0, y: 0, z: 0 }, _w: { x: 0, y: 0, z: 0 },
        _m: 1, _g: 1, radius: 0, friction: 1,
        translation() { return this._t; }, linvel() { return this._v; },
        mass() { return this._m; },
        addForce(f) { this._f.x += f.x; this._f.y += f.y; this._f.z += f.z; },
        resetForces() { this._f = { x: 0, y: 0, z: 0 }; },
        addTorque(t) { this._tq.x += t.x; this._tq.y += t.y; this._tq.z += t.z; },
        resetTorques() { this._tq = { x: 0, y: 0, z: 0 }; },
        angvel() { return this._w; },
        setAngvel(w) { this._w = { ...w }; },
        setLinvel(v) { this._v = { ...v }; },
        setTranslation(t) { this._t = { ...t }; },
        setGravityScale(s) { this._g = s; },
        // RECORDED, not swallowed. Damping is half of a surface profile, and a
        // no-op setter lets "the slide dropped the damping" pass on nothing.
        damping: null,
        setLinearDamping(d) { this.damping = d; }, setAngularDamping() {},
        rotation() { return { x: 0, y: 0, z: 0, w: 1 }; },
        applyImpulse(i) {
          const m = this._m || 1;
          this._v.x += i.x / m; this._v.y += i.y / m; this._v.z += i.z / m;
        },
      };
      bodies.push(b); return b;
    },
    createCollider(desc, body) {
      body._m = desc.mass; body.radius = desc.r;
      body.friction = desc.friction === undefined ? 1 : desc.friction;
      return desc;
    },
    removeCollider() {},
    castRayAndGetNormal(ray, maxToi, solid, flags, groups) {
      rayCalls.push({ groups });
      const { x, z } = ray.origin;
      const gy = groundHeightAt(x, z);
      const toi = ray.origin.y - gy;
      if (toi < 0 || toi > maxToi) return null;
      // Real normal from the height field gradient: n = (-dh/dx, 1, -dh/dz).
      // Returning a hardcoded up-vector here would make every slope test a lie.
      const e = 0.05;
      const gx = (groundHeightAt(x + e, z) - groundHeightAt(x - e, z)) / (2 * e);
      const gz = (groundHeightAt(x, z + e) - groundHeightAt(x, z - e)) / (2 * e);
      const len = Math.hypot(-gx, 1, -gz);
      return { timeOfImpact: toi, normal: { x: -gx / len, y: 1 / len, z: -gz / len } };
    },
    step() {
      for (const b of bodies) {
        const m = b._m || 1;
        const floor = groundHeightAt(b._t.x, b._t.z) + (b.radius || 0);
        const grounded = b._t.y <= floor + 1e-3;

        // --- Rolling contact -------------------------------------------
        // Torque only moves the body through FRICTION at the contact patch.
        // A mock that integrated torque straight into velocity would report a
        // working controller no matter how wrong the roll axis or the friction
        // ceiling were — the two things the whole locomotion model rests on.
        const tqh = Math.hypot(b._tq.x, b._tq.z);
        if (grounded && b.radius > 0 && tqh > 1e-9) {
          const r = b.radius;
          const I = 0.4 * m * r * r;
          // Spin axis a -> travel direction d = a x up.
          const ax = b._tq.x / tqh, az = b._tq.z / tqh;
          const dx = -az, dz = ax;
          // Ideal rolling force, then clamped by what friction can transmit.
          let f = (tqh / r) * (m * r * r) / (I + m * r * r);
          const fMax = (b.friction || 0) * m * (-this.gravity.y);
          if (f > fMax) f = fMax;
          b._v.x += (f * dx / m) * DT;
          b._v.z += (f * dz / m) * DT;
          const spin = ((tqh - f * r) / I) * DT;
          b._w.x += ax * spin; b._w.z += az * spin;
        }
        // Spin tracks travel while rolling, so state.slip reads honestly.
        if (grounded && b.radius > 0) {
          const sp = Math.hypot(b._v.x, b._v.z);
          if (sp > 1e-6) {
            const w = sp / b.radius;
            b._w.x = (b._v.z / sp) * w; b._w.z = (-b._v.x / sp) * w;
          }
        }

        // --- Along-slope gravity ----------------------------------------
        // The controller no longer applies uphill/downhill multipliers; it
        // relies on the solver resolving the contact so gravity acts along the
        // surface. A mock that only pushes gravity down and then clamps to the
        // floor cannot show that, and would let "slopes come free from rolling"
        // pass untested. So the mock resolves it too.
        if (grounded && b.radius > 0) {
          const e = 0.05;
          const gx = (groundHeightAt(b._t.x + e, b._t.z) - groundHeightAt(b._t.x - e, b._t.z)) / (2 * e);
          const gz = (groundHeightAt(b._t.x, b._t.z + e) - groundHeightAt(b._t.x, b._t.z - e)) / (2 * e);
          const len = Math.hypot(-gx, 1, -gz);
          const n = { x: -gx / len, y: 1 / len, z: -gz / len };
          const g = -this.gravity.y * b._g;
          // Gravity minus its component along the normal = the along-slope part.
          b._v.x += (-g * n.y * n.x) * DT * -1;
          b._v.z += (-g * n.y * n.z) * DT * -1;
        }

        b._v.x += (b._f.x / m) * DT;
        b._v.y += (b._f.y / m + this.gravity.y * b._g) * DT;
        b._v.z += (b._f.z / m) * DT;
        b._t.x += b._v.x * DT; b._t.y += b._v.y * DT; b._t.z += b._v.z * DT;
        if (b._t.y < floor) { b._t.y = floor; if (b._v.y < 0) b._v.y = 0; }
      }
    },
  };
  return { RAPIER, world, rayCalls };
}


/** Assemble the stack the way demo-shell.html does. */
function makeGame(groundHeightAt, padRef = { pad: null }, staminaTuning) {
  const { RAPIER, world, rayCalls } = makeWorld(groundHeightAt);
  const SPAWN = { x: 0, y: T.radius, z: 0 };

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(SPAWN.x, SPAWN.y, SPAWN.z)
      .lockRotations().setLinearDamping(T.linearDamping).setCanSleep(false));
  const collider = world.createCollider(
    RAPIER.ColliderDesc.ball(T.radius).setMass(T.mass)
      .setFriction(T.friction).setCollisionGroups(GROUPS_ATHLETE), body);

  const controller = createAthleteController({
    RAPIER, world, body, collider, tuning: {}, probeFilterGroups: RAY_FILTER });

  const keys = new Set();
  const mouse = { dx: 0, dy: 0 };
  const input = createAthleteInput({ getGamepads: () => [padRef.pad], keys, mouse });

  // The camera is part of the loop now, not decoration: it publishes the yaw
  // the movement basis is built from, so a bug here steers the athlete.
  const director = createCameraDirector({
    THREE, aspect: 16 / 9, mode: 'action', homeTheta: 45 * Math.PI / 180,
  });
  const basis = cameraBasisFromYaw(45 * Math.PI / 180);
  let useDirectorBasis = false;

  const ball = createGameBall(RAPIER, world, {}, { x: 0, y: 5, z: 2 }, (0x0002 << 16) | 0xFFFF);
  const ballBody = ball.body;

  const transitions = [];
  const dives = [];
  const denials = [];
  /* WHERE A DIVE WOULD GO, latched in the input phase. `controller.dive()` is
     called from the transition hook, which has no input in scope — the demo
     solves it the same way, and a harness that solved it differently would not
     be testing the demo. */
  const diveAim = { x: 0, z: 0 };
  /* THE RESOURCE LAYER, wired exactly as demo-shell.html wires it — built
     first, handed to the action machine, stepped on the fixed clock after it.
     Most sections here are about physics rather than economy, so the default
     for this harness is a very deep tank: a locomotion test that fails because
     the athlete got tired is a test failing for the wrong reason. Sections that
     are about stamina pass their own tuning. */
  const stamina = createAthleteStamina({
    tuning: Object.assign({ max: 100000, start: 100000 }, staminaTuning || {}),
    onDenied: (kind) => denials.push(kind),
  });
  const actions = createAthleteActions({
    stamina,
    onTransition: (to, from, why) => {
      transitions.push({ to, from, why });
      // Exactly as the demo does it: the launch impulse fires from the
      // transition hook, on the step the state flips.
      if (to === 'diving') dives.push(controller.dive(diveAim));
    },
  });

  // The puppet: position + yaw only, exactly as the demo does it.
  const puppet = { x: 0, y: 0, z: 0, yaw: 0 };
  let facing = 0;

  function knockDown(reason) {
    const v = body.linvel();
    body.setLinvel({ x: 0, y: v.y, z: 0 }, true);
    body.resetForces(true);
    actions.knockDown(reason || 'manual');
  }

  const hits = [];
  function resolveHit(kind) {
    const p = body.translation();
    const contact = contactPoint(p, T.radius, HT);
    const bp = ballBody.translation();
    const reach = evaluateReach(contact, bp, controller.state.facingAngle, reachOptions(kind, HT));
    if (!reach.inReach) return false;
    const r = computeHitImpulse({
      kind,
      facingAngle: controller.state.facingAngle,
      heightAboveGround: p.y - T.radius,
      ballVelocity: ballBody.linvel(),
      playerVelocity: body.linvel(),
      ballMass: ballBody.mass(),
      tuning: HT,
    });
    ballBody.applyImpulse(r.impulse, true);
    hits.push({ kind, deltaV: r.deltaV, elevation: r.elevationDeg });
    return true;
  }

  /** Put the ball on the FLOOR in front of the athlete — where it really ends up. */
  function placeBallOnFloor(distance = 1.0) {
    const p = body.translation();
    const f = controller.state.facingAngle;
    ballBody.setTranslation({
      x: p.x + Math.sin(f) * distance,
      y: BL.radius,
      z: p.z + Math.cos(f) * distance,
    }, true);
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Put the ball right where a swing can reach it. */
  function placeBallInReach(dy = 0.2) {
    const p = body.translation();
    const c = contactPoint(p, T.radius, HT);
    const f = controller.state.facingAngle;
    ballBody.setTranslation({
      x: c.x + Math.sin(f) * 0.9, y: c.y + dy, z: c.z + Math.cos(f) * 0.9,
    }, true);
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  function frame(overrides) {
    // Default to the frozen ISO basis so every pre-existing test keeps its
    // fixed reference frame; opt in to the live one where it is the subject.
    if (useDirectorBasis) writeCameraBasis(basis, director.basisYaw);
    else writeCameraBasis(basis, 45 * Math.PI / 180);
    const inp = input.sample(basis);
    diveAim.x = inp.moveX; diveAim.z = inp.moveZ;
    if (inp.camNextPressed) director.cycle(1);
    if (inp.camPrevPressed) director.cycle(-1);
    if (inp.mouseLookX || inp.mouseLookY) {
      director.look(inp.mouseLookX * 0.0026, inp.mouseLookY * 0.0026);
    }
    // `frozen`, not `movementLocked` — the demo makes the same distinction, and
    // for the same reason: a dive now locks movement, and refusing the debug
    // knockdown mid-dive would be refusing it exactly when it is wanted.
    if (inp.knockPressed && !actions.physics.frozen) knockDown('debug');

    const v0 = body.linvel();
    const speed0 = Math.hypot(v0.x, v0.z);

    actions.update(DT, Object.assign({
      grounded: controller.state.grounded,
      speed: speed0,
      slideHeld: inp.slideHeld,
      slidePressed: inp.slidePressed,
      divePressed: inp.divePressed,
      volleyPressed: inp.volleyPressed,
      spikePressed: inp.spikePressed,
      // Jump bails you out of a slide, and the machine has to see the press
      // BEFORE the controller does — exactly as demo-shell.html orders it.
      jumpPressed: inp.jumpPressed,
    }, overrides || {}));

    /* THE THREE CONTINUOUS DRAINS, mirroring the demo step for step. This
       harness exists to catch wiring the module tests cannot see, so it has to
       wire the same things in the same order — a harness that bills stamina
       differently from the page is testing a game nobody is playing. */
    const wantSprint = !actions.movementLocked && !actions.physics.passive && inp.sprint;
    const sprinting = wantSprint && stamina.canAfford('sprint');
    if (sprinting) stamina.drain('sprint', DT);

    const climbCost = inclineDrainRate({
      climbRate: controller.state.climbRate,
      slopeDeg: controller.state.slopeAngleDeg,
      grounded: controller.state.grounded,
      tuning: stamina.tuning,
    });
    if (climbCost > 0) stamina.drain('incline', DT, climbCost);

    /* THE JUMP HOLD — only while the boost is actually being granted: button
       down, rising, airborne. Billing on `jumpHeld` alone would charge for a
       button pressed while walking. Mirrors demo-shell.html exactly. */
    const boosting = !!inp.jumpHeld && !controller.state.grounded
      && controller.state.verticalVelocity > 0.05;
    if (boosting) stamina.drain('jumpHold', DT);

    const atRest = inp.magnitude <= stamina.tuning.restInputEpsilon
      && speed0 <= stamina.tuning.restSpeed;
    stamina.update(DT, { draining: actions.physics.passive, atRest });

    if (actions.contactOpen && resolveHit(actions.hit.kind)) actions.reportHitConnected();

    const locked = actions.movementLocked;
    const canJump = stamina.canAfford('jump');
    // A refused press has to say why — mirrors demo-shell.html.
    if (inp.jumpPressed && !canJump && !locked && !actions.physics.passive) {
      stamina.deny('jump');
    }
    const jumped = controller.update(DT, {
      moveX: locked ? 0 : inp.moveX,
      moveZ: locked ? 0 : inp.moveZ,
      magnitude: locked ? 0 : inp.magnitude * actions.hitThrottle,
      // The trigger being held is a REQUEST; an exhausted athlete's request is
      // refused. Decided once, above, and read here.
      sprint: sprinting,
      // Priced now: affordability is the gate, and it refuses while exhausted.
      jumpPressed: (locked || actions.physics.passive || !canJump) ? false : inp.jumpPressed,
      jumpHeld: !locked && inp.jumpHeld && stamina.canAfford('jumpHold'),
      /* READ the three flags, do not derive them. This harness used to compute
         `slide: passive && !diving`, mirroring what the demo did — and both were
         correct only while there were exactly two passive states. The skid made
         a third, and the derivation would have handed the controller a SLIDE
         (steerable, its own drag, its own posture) for every skid. */
      slide: actions.physics.sliding,
      dive: actions.physics.diving,
      skid: actions.physics.skidding,
      frozen: actions.physics.frozen,
    });
    // CHARGED ON THE RETURN VALUE. A press is buffered and may be consumed
    // frames later inside the coyote window, or expire unused; billing at press
    // time charges for jumps that never happened.
    if (jumped) stamina.spend('jump');
    world.step();

    const p = body.translation(), v = body.linvel();
    const speed = Math.hypot(v.x, v.z);
    if (!locked && speed > 0.25) {
      const target = Math.atan2(v.x, v.z);
      let d = target - facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      facing += d * Math.min(1, DT * 14);
    }
    puppet.x = p.x; puppet.y = p.y - T.radius; puppet.z = p.z; puppet.yaw = facing;


    const bp2 = ballBody.translation();
    director.update(DT, {
      player: { x: p.x, y: p.y - T.radius, z: p.z },
      ball: { x: bp2.x, y: bp2.y, z: bp2.z },
      speed,
      travelYaw: speed > 0.6 ? Math.atan2(v.x, v.z) : undefined,
      aspect: 16 / 9,
    });
    // `jumped` is reported because counting jumps from the OUTSIDE — "was
    // grounded, now rising" — under-counts exactly when jumping is cheap: a
    // spamming athlete is airborne on most frames, so the grounded edge is
    // missed and a free jump measures as fewer jumps than an expensive one.
    return { speed, locked, jumped };
  }

  const run = (seconds) => { let last; for (let i = 0; i < Math.round(seconds / DT); i++) last = frame(); return last; };

  return { world, body, collider, controller, input, actions, keys, stamina, denials,
    puppet, frame, run, knockDown, rayCalls, transitions, dives,
    director, mouse, basis,
    orbitCamera() { useDirectorBasis = true; },
    ballBody, ball, hits, placeBallInReach, placeBallOnFloor,
    get facing() { return facing; } };
}

function pad(o = {}) {
  const buttons = new Array(16).fill(0).map(() => ({ pressed: false, value: 0 }));
  for (const [i, v] of Object.entries(o.buttons || {})) {
    buttons[i] = typeof v === 'number' ? { pressed: v > 0.5, value: v } : { pressed: !!v, value: v ? 1 : 0 };
  }
  return { id: 'mock', connected: true, axes: o.axes || [0, 0, 0, 0], buttons };
}

// ---------------------------------------------------------------------------
console.log('\n1. The stack assembles and settles');
{
  const g = makeGame();
  g.run(1.0);
  check('ball is grounded after settling', g.controller.state.grounded);
  check('ball rests at radius above the ground',
    approx(g.body.translation().y, T.radius, 0.02), `y=${g.body.translation().y.toFixed(4)}`);
}

// ---------------------------------------------------------------------------
console.log('\n2. Keyboard drives the ball through the fixed camera basis');
{
  const g = makeGame();
  g.run(0.3);
  g.keys.add('KeyW');
  g.run(1.5);
  const p = g.body.translation();
  check('the ball actually moved', Math.hypot(p.x, p.z) > 2, `(${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
  // Screen-up on a 45° iso camera is into -X/-Z.
  check('W travels along the camera-forward axis',
    p.x < 0 && p.z < 0, `(${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
}
{
  const g = makeGame();
  g.keys.add('KeyD');
  g.run(1.5);
  const p = g.body.translation();
  check('D travels along camera-right', p.x > 0 && p.z < 0, `(${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
}
{
  const g = makeGame();
  g.keys.add('KeyW');
  g.run(1.5);
  const facingDir = { x: Math.sin(g.facing), z: Math.cos(g.facing) };
  const v = g.body.linvel();
  const dot = (facingDir.x * v.x + facingDir.z * v.z) / (Math.hypot(v.x, v.z) || 1);
  check('the puppet faces the direction the ball is travelling', dot > 0.95, `dot=${dot.toFixed(4)}`);
}

// ---------------------------------------------------------------------------
console.log('\n3. Gamepad drives it too, with analog throttle');
{
  const ref = { pad: pad({ axes: [0, -1] }) };
  const g = makeGame(undefined, ref);
  g.run(1.5);
  check('full stick reaches run speed', g.controller.state.groundSpeed > 4,
    `${g.controller.state.groundSpeed.toFixed(2)} m/s`);
}
{
  const full = { pad: pad({ axes: [0, -1] }) };
  const half = { pad: pad({ axes: [0, -0.55] }) };
  const a = makeGame(undefined, full); a.run(2.5);
  const b = makeGame(undefined, half); b.run(2.5);
  check('half stick settles at a lower speed than full',
    b.controller.state.groundSpeed < a.controller.state.groundSpeed * 0.85,
    `half=${b.controller.state.groundSpeed.toFixed(2)} full=${a.controller.state.groundSpeed.toFixed(2)}`);
  check('half stick still moves', b.controller.state.groundSpeed > 0.5,
    `${b.controller.state.groundSpeed.toFixed(2)}`);
}
{
  const ref = { pad: pad({ axes: [0, -1], buttons: { 6: 1.0 } }) };   // LT = sprint
  const g = makeGame(undefined, ref);
  g.run(2.5);
  check('LEFT trigger sprints past run speed', g.controller.state.groundSpeed > T.walkSpeed + 0.5,
    `${g.controller.state.groundSpeed.toFixed(2)} m/s`);
}
{
  // RT is the slide, and must not double as sprint.
  const ref = { pad: pad({ axes: [0, -1], buttons: { 7: 1.0 } }) };
  const g = makeGame(undefined, ref);
  g.run(2.5);
  check('RIGHT trigger does not sprint', g.controller.state.groundSpeed <= T.walkSpeed + 0.5,
    `${g.controller.state.groundSpeed.toFixed(2)} m/s`);
}
{
  const ref = { pad: pad({ axes: [0, -0.1] }) };   // inside the deadzone
  const g = makeGame(undefined, ref);
  g.run(1.0);
  check('stick drift does not creep the character',
    g.controller.state.groundSpeed < 0.05, `${g.controller.state.groundSpeed.toFixed(4)} m/s`);
}

// ---------------------------------------------------------------------------
console.log('\n4. The puppet is purely derived from the ball');
{
  const g = makeGame();
  g.keys.add('KeyW');
  g.run(1.2);
  const p = g.body.translation();
  check('puppet X/Z equal the ball exactly', approx(g.puppet.x, p.x, 1e-12) && approx(g.puppet.z, p.z, 1e-12));
  check('puppet stands on the ball\'s base', approx(g.puppet.y, p.y - T.radius, 1e-12),
    `puppet.y=${g.puppet.y.toFixed(4)}`);
  check('puppet feet sit on the ground', Math.abs(g.puppet.y) < 0.02, `${g.puppet.y.toFixed(4)}`);
  check('puppet yaw is the tracked facing angle', approx(g.puppet.yaw, g.facing, 1e-12));
}

// ---------------------------------------------------------------------------
console.log('\n5. Momentum still behaves after the pivot');
{
  const g = makeGame();
  g.keys.add('KeyW'); g.keys.add('ShiftLeft');
  g.run(3.0);
  const top = g.controller.state.groundSpeed;
  check('reaches sprint speed', top > T.sprintSpeed * 0.85, `${top.toFixed(2)} m/s`);

  g.keys.delete('KeyW'); g.keys.delete('ShiftLeft');
  const start = { ...g.body.translation() };     // copy: translation() is live
  let t = 0;
  while (g.controller.state.groundSpeed > 0.3 && t < 5) { g.frame(); t += DT; }
  const end = { ...g.body.translation() };
  const coast = Math.hypot(end.x - start.x, end.z - start.z);
  check('releasing input coasts, it does not stop dead', coast > 2.5, `coasted ${coast.toFixed(2)} m`);
  check('and takes real time to shed', t > 0.5, `${t.toFixed(2)} s`);
  console.log(`       → coasted ${coast.toFixed(2)} m over ${t.toFixed(2)} s from ${top.toFixed(2)} m/s`);
}
{
  // Uphill must be slower than flat, through the whole stack.
  const flat = makeGame(() => 0);
  const hill = makeGame((x, z) => Math.max(0, -z * 0.45));   // rises toward -Z, which is where W goes
  flat.keys.add('KeyW'); hill.keys.add('KeyW');
  flat.run(3.0); hill.run(3.0);
  check('the harness actually reports a slope (guards the test itself)',
    hill.controller.state.slopeAngleDeg > 5,
    `slope=${hill.controller.state.slopeAngleDeg.toFixed(1)}deg`);
  check('climbing is slower than running on the flat',
    hill.controller.state.groundSpeed < flat.controller.state.groundSpeed * 0.95,
    `hill=${hill.controller.state.groundSpeed.toFixed(2)} flat=${flat.controller.state.groundSpeed.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
console.log('\n6. Keyframed knockdown across the whole stack');
{
  const g = makeGame();
  g.keys.add('KeyW'); g.keys.add('ShiftLeft');
  g.run(2.5);
  check('sprinting before the knockdown', g.controller.state.groundSpeed > 4,
    `${g.controller.state.groundSpeed.toFixed(2)} m/s`);

  g.knockDown('test');
  check('momentum is zeroed on impact', Math.hypot(g.body.linvel().x, g.body.linvel().z) < 1e-9);
  check('movement is locked immediately', g.actions.movementLocked);
  g.frame();

  const at = { ...g.body.translation() };
  g.run(0.5);
  const drift = Math.hypot(g.body.translation().x - at.x, g.body.translation().z - at.z);
  check('held input cannot move the character while down', drift < 0.05, `drifted ${drift.toFixed(4)} m`);

  g.run(AC.knockdownTime + AC.recoverTime + 0.3);
  check('control is returned', !g.actions.movementLocked, `state=${g.actions.state}`);
  g.run(1.0);
  check('and it runs again with input still held', g.controller.state.groundSpeed > 2,
    `${g.controller.state.groundSpeed.toFixed(2)} m/s`);
}
{
  const ref = { pad: pad({ buttons: { 8: true } }) };   // BACK held
  const g = makeGame(undefined, ref);
  g.run(0.2);
  check('gamepad BACK triggers the debug knockdown', g.actions.movementLocked);
  g.run(AC.knockdownTime + AC.recoverTime + 0.5);
  check('holding it does not trap the character', !g.actions.movementLocked, g.actions.state);
}

// ---------------------------------------------------------------------------
console.log('\n6b. Sliding, end to end');
{
  // Downhill toward -Z, which is where W travels on a 45deg iso camera.
  const hill = (x, z) => Math.max(0, z * 0.5);
  const g = makeGame(hill);
  g.keys.add('KeyW'); g.keys.add('ShiftLeft');
  g.run(2.0);
  const entry = g.controller.state.groundSpeed;
  check('built enough speed to slide', entry > AC.slideMinEntrySpeed, `${entry.toFixed(2)} m/s`);

  g.keys.add('KeyC');
  g.run(0.2);
  check('holding slide enters the sliding state', g.actions.sliding, g.actions.state);
  /* THE SLIDE'S PROFILE REACHES THE COLLIDER, through the whole stack: key →
     input → action machine → player state → controller → Rapier handle. This is
     the check that would have caught the reported "slide does nothing" — the
     value written was right, and the combine rule threw it away. That half is
     asserted in test-athlete-controller; this half asserts the write happens at
     all, from a keypress. */
  check('the collider dropped to the slide profile',
    Math.abs(g.collider.friction - T.slideFriction) < 1e-9,
    `friction=${g.collider.friction}, expected ${T.slideFriction}`);
  check('and the slide profile is genuinely frictionless', T.slideFriction === 0);
  check('the body damping dropped with it',
    g.body.damping === T.slideDamping && T.slideDamping <= T.linearDamping,
    `${g.body.damping}`);
  check('controller reports sliding', g.controller.state.sliding);
  check('and names the mode', g.controller.state.surface === 'slide',
    g.controller.state.surface);

  // Releasing restores BOTH, or the athlete walks around on ice afterwards.
  g.keys.delete('KeyC');
  g.run(1.0);
  check('releasing the slide restores traction',
    Math.abs(g.collider.friction - T.friction) < 1e-9, `${g.collider.friction}`);
  check('and restores the damping',
    g.body.damping === T.linearDamping, `${g.body.damping}`);
}
{
  // Slide downhill: gravity must keep you alive past the wipeout threshold.
  const g = makeGame((x, z) => Math.max(0, z * 0.6));
  g.keys.add('KeyW'); g.keys.add('ShiftLeft');
  g.run(2.0);
  g.keys.add('KeyC');
  g.run(1.5);
  check('a downhill slide survives past the grace window', g.actions.sliding, g.actions.state);
  check('and keeps real speed', g.controller.state.groundSpeed > AC.slideMinSpeed,
    `${g.controller.state.groundSpeed.toFixed(2)} m/s`);
}
{
  // Slide on the flat: with no drive and no slope, you must eventually wipe out.
  const g = makeGame(() => 0);
  g.keys.add('KeyW'); g.keys.add('ShiftLeft');
  g.run(2.0);
  g.keys.delete('KeyW'); g.keys.delete('ShiftLeft');
  g.keys.add('KeyC');
  let t = 0;
  while (!g.actions.movementLocked && t < 12) { g.frame(); t += DT; }
  check('a slide on flat ground eventually wipes out', g.actions.movementLocked, `after ${t.toFixed(2)}s`);
  check('it resolves by LOSING MOMENTUM, not by hitting the time cap',
    /momentum|stand/.test(g.actions.reason), g.actions.reason);
  check('and resolves well inside the time cap', t < AC.slideMaxTime - 0.5, `${t.toFixed(2)}s of ${AC.slideMaxTime}s`);
  console.log(`       -> flat slide lasted ${t.toFixed(2)}s before wiping out`);
}
{
  // The controller must not drive while sliding, or the risk is meaningless.
  const g = makeGame(() => 0);
  g.keys.add('KeyW'); g.keys.add('ShiftLeft');
  g.run(2.0);
  g.keys.add('KeyC');
  g.run(0.3);
  const before = g.controller.state.groundSpeed;
  g.run(0.6);
  check('holding forward cannot accelerate out of a slide',
    g.controller.state.groundSpeed <= before + 0.01,
    `${before.toFixed(2)} -> ${g.controller.state.groundSpeed.toFixed(2)} m/s`);
}
{
  // Slide drag must be far gentler than the normal brake, or it is just stopping.
  const flat = () => 0;
  const a = makeGame(flat); a.keys.add('KeyW'); a.keys.add('ShiftLeft'); a.run(2.2);
  const b = makeGame(flat); b.keys.add('KeyW'); b.keys.add('ShiftLeft'); b.run(2.2);
  const v0 = a.controller.state.groundSpeed;

  a.keys.delete('KeyW'); a.keys.delete('ShiftLeft');          // normal braking
  b.keys.delete('KeyW'); b.keys.delete('ShiftLeft'); b.keys.add('KeyC');  // sliding
  a.run(0.8); b.run(0.8);
  check('a slide keeps far more speed than braking would',
    b.controller.state.groundSpeed > a.controller.state.groundSpeed + 1,
    `slide=${b.controller.state.groundSpeed.toFixed(2)} brake=${a.controller.state.groundSpeed.toFixed(2)} from ${v0.toFixed(2)}`);
}
{
  const g = makeGame(() => 0);
  g.keys.add('KeyW'); g.keys.add('ShiftLeft');
  g.run(2.0);
  g.keys.add('KeyC');
  g.run(0.1);
  g.keys.delete('KeyC');                       // release inside the commit window
  g.run(AC.slideCommitTime - 0.2);
  check('releasing inside the commit window keeps you sliding', g.actions.sliding, g.actions.state);
}
{
  // Standing still and mashing slide must never knock you down.
  const g = makeGame(() => 0);
  g.run(0.5);
  let knocked = false;
  for (let i = 0; i < 400; i++) {
    if (i % 2 === 0) g.keys.add('KeyC'); else g.keys.delete('KeyC');
    g.frame();
    if (g.actions.movementLocked) knocked = true;
  }
  check('mashing slide at a standstill never knocks you down', !knocked);
  check('and never enters a slide', !g.actions.sliding);
}
{
  // Friction must be restored when the slide ends, or you stay slippery forever.
  const g = makeGame((x, z) => Math.max(0, z * 0.6));
  g.keys.add('KeyW'); g.keys.add('ShiftLeft');
  g.run(2.0);
  g.keys.add('KeyC');
  g.run(AC.slideCommitTime + 0.2);
  g.keys.delete('KeyC');
  g.run(0.4);
  check('leaving the slide restores normal friction',
    Math.abs(g.collider.friction - T.friction) < 1e-9, `friction=${g.collider.friction}`);
}

// ---------------------------------------------------------------------------
console.log('\n6c. Hitting the ball, end to end');
{
  const g = makeGame(() => 0);
  g.run(0.5);
  g.placeBallInReach();
  g.keys.add('KeyJ');                       // volley
  g.run(AC.hitWindup + AC.hitActive + 0.1);
  check('a volley in reach connects', g.hits.length === 1, `${g.hits.length} hits`);
  check('and the swing is marked as connected', g.actions.hit.connected || !g.actions.hitting);
  const bv = g.ballBody.linvel();
  check('the ball is sent upward', bv.y > 1, `vy=${bv.y.toFixed(2)}`);
  check('and forward', Math.hypot(bv.x, bv.z) > 1, `horiz=${Math.hypot(bv.x, bv.z).toFixed(2)}`);
}
{
  const g = makeGame(() => 0);
  g.run(0.5);
  // Ball far away — this must be a whiff.
  g.ballBody.setTranslation({ x: 40, y: 1, z: 40 }, true);
  g.keys.add('KeyJ');
  g.run(AC.hitWindup + AC.hitActive + 0.1);
  check('a swing at nothing does not touch the ball', g.hits.length === 0);
  check('and is still swinging through its longer whiff recovery', g.actions.hitting,
    g.actions.hit.phase);
}
{
  // Committed swing: a whiff must cost more time than a connection.
  const hitG = makeGame(() => 0);
  hitG.run(0.5); hitG.placeBallInReach(); hitG.keys.add('KeyJ');
  let hitFrames = 0;
  hitG.frame();
  while (hitG.actions.hitting && hitFrames < 600) { hitG.frame(); hitFrames++; }

  const missG = makeGame(() => 0);
  missG.run(0.5);
  missG.ballBody.setTranslation({ x: 40, y: 1, z: 40 }, true);
  missG.keys.add('KeyJ');
  let missFrames = 0;
  missG.frame();
  while (missG.actions.hitting && missFrames < 600) { missG.frame(); missFrames++; }
  check('whiffing costs more recovery than connecting', missFrames > hitFrames + 5,
    `hit=${(hitFrames / 60).toFixed(2)}s whiff=${(missFrames / 60).toFixed(2)}s`);
}
{
  // Swinging must throttle movement, which is what makes the commitment real.
  const g = makeGame(() => 0);
  g.keys.add('KeyW');
  g.run(2.5);
  const cruising = g.controller.state.targetSpeed;
  g.keys.add('KeyJ');
  g.frame();
  check('a swing throttles the movement target', g.controller.state.targetSpeed < cruising * 0.7,
    `${cruising.toFixed(2)} → ${g.controller.state.targetSpeed.toFixed(2)} m/s`);
}
{
  // The spike must steepen with height — the whole reason for the scaling.
  const low = makeGame(() => 0);
  low.run(0.5); low.placeBallInReach(); low.keys.add('KeyK');
  low.run(AC.hitWindup + AC.hitActive + 0.1);

  const high = makeGame(() => 0);
  high.run(0.5);
  high.body.setTranslation({ x: 0, y: T.radius + HT.spikeApexHeight, z: 0 }, true);
  high.placeBallInReach();
  high.keys.add('KeyK');
  high.run(AC.hitWindup + AC.hitActive + 0.1);

  check('both spikes connected', low.hits.length === 1 && high.hits.length === 1,
    `${low.hits.length} / ${high.hits.length}`);
  check('a spike from height is steeper than one from the ground',
    high.hits[0].elevation < low.hits[0].elevation - 10,
    `ground=${low.hits[0].elevation.toFixed(1)}° apex=${high.hits[0].elevation.toFixed(1)}°`);
  check('the ground-level spike is not driven into the floor',
    low.hits[0].deltaV.y > -4, `vy=${low.hits[0].deltaV.y.toFixed(2)}`);
  check('the apex spike drives downward', high.hits[0].deltaV.y < -4,
    `vy=${high.hits[0].deltaV.y.toFixed(2)}`);
}
{
  // A running hit must beat a standing one, through the whole stack.
  const still = makeGame(() => 0);
  still.run(0.5); still.placeBallInReach(); still.keys.add('KeyJ');
  still.run(AC.hitWindup + AC.hitActive + 0.1);

  const running = makeGame(() => 0);
  running.keys.add('KeyW'); running.keys.add('ShiftLeft');
  running.run(2.5);
  running.placeBallInReach();
  running.keys.add('KeyJ');
  running.run(AC.hitWindup + AC.hitActive + 0.1);

  check('both connected', still.hits.length === 1 && running.hits.length === 1);
  const a = Math.hypot(still.hits[0].deltaV.x, still.hits[0].deltaV.z);
  const b = Math.hypot(running.hits[0].deltaV.x, running.hits[0].deltaV.z);
  check('a running volley carries more than a standing one', b > a + 0.5,
    `standing=${a.toFixed(2)} running=${b.toFixed(2)} m/s`);
}
{
  /* REVERSED, deliberately. A dive used to be able to dig; it now refuses,
     because being able to swing out of a commitment turns the commitment into a
     free dash with a hitbox attached. Asserted through the whole stack rather
     than only in the action machine, because "the hit was refused" and "the
     swing fired but the ball was out of reach" look identical from the
     hit count alone — hence the second assertion. */
  const g = makeGame(() => 0);
  g.run(0.5);
  g.actions.tryDive(true);
  g.placeBallInReach();
  g.keys.add('KeyJ');
  g.run(AC.hitWindup + AC.hitActive + 0.1);
  check('a dive refuses the swing outright', g.hits.length === 0, `${g.hits.length}`);
  check('and no swing was ever started', !g.actions.hitting, g.actions.hit.phase);

  // NEGATIVE CONTROL: the ball really was reachable, so the refusal above is the
  // lockout and not a geometry accident.
  const h = makeGame(() => 0);
  h.run(0.5);
  h.placeBallInReach();
  h.keys.add('KeyJ');
  h.run(AC.hitWindup + AC.hitActive + 0.1);
  check('NEGATIVE CONTROL: the same ball is hit standing up', h.hits.length === 1,
    `${h.hits.length}`);
}
{
  const g = makeGame(() => 0);
  g.run(0.5);
  g.placeBallInReach();
  g.knockDown('smashed');
  g.keys.add('KeyJ');
  g.run(0.5);
  check('you cannot hit while knocked down', g.hits.length === 0);
}
{
  // One swing must not hit the ball repeatedly across the contact window.
  const g = makeGame(() => 0);
  g.run(0.5);
  g.keys.add('KeyJ');
  for (let i = 0; i < Math.round((AC.hitWindup + AC.hitActive + 0.3) / DT); i++) {
    g.placeBallInReach();          // keep it permanently reachable
    g.frame();
  }
  check('a single swing connects exactly once', g.hits.length === 1, `${g.hits.length} hits`);
}
{
  // Holding the button must not machine-gun the ball.
  const g = makeGame(() => 0);
  g.keys.add('KeyJ');
  for (let i = 0; i < 300; i++) { g.placeBallInReach(); g.frame(); }
  check('holding the hit button does not spam contacts', g.hits.length <= 1,
    `${g.hits.length} hits in 5 s of holding`);
}
{
  // The ball must never be treated as ground.
  const g = makeGame(() => 0);
  g.run(0.5);
  const p = g.body.translation();
  g.ballBody.setTranslation({ x: p.x, y: p.y - T.radius - BL.radius, z: p.z }, true);
  g.run(0.3);
  check('standing on the ball is impossible — probes ignore it',
    g.rayCalls.every((r) => r.groups === RAY_FILTER));
}

// ---------------------------------------------------------------------------
console.log('\n6d. The ball where it REALLY ends up: lying on the floor');
{
  // The bug this exists to prevent: contact is measured at chest height, so a
  // settled ball is ~0.88 m below it. A reach window that stops short makes the
  // ball permanently unhittable once it stops bouncing — which reads as "the
  // hit button does nothing".
  const g = makeGame(() => 0);
  g.run(0.5);
  g.placeBallOnFloor();
  g.keys.add('KeyJ');
  g.run(AC.hitWindup + AC.hitActive + 0.1);
  check('a ball lying on the floor CAN be dug with the volley', g.hits.length === 1,
    `${g.hits.length} hits`);
  const bv = g.ballBody.linvel();
  check('and it gets lifted off the deck', bv.y > 2, `vy=${bv.y.toFixed(2)}`);
}
{
  const g = makeGame(() => 0);
  g.run(0.5);
  g.placeBallOnFloor();
  g.keys.add('KeyK');                       // spike
  g.run(AC.hitWindup + AC.hitActive + 0.1);
  // A sphere has no notion of "above", so a floor ball IS spikeable now. What
  // stops it being a free kill is the angle ramp: struck from the deck the
  // spike leaves almost flat, so it drives down the court rather than into it.
  check('a floor ball CAN be spiked under the spherical zone',
    g.hits.length === 1, `${g.hits.length} hits`);
  const bv = g.ballBody.linvel();
  const launchAngle = Math.atan2(bv.y, Math.hypot(bv.x, bv.z)) * 180 / Math.PI;
  check('but it comes off nearly flat, not driven into the deck',
    launchAngle > -20 && launchAngle < 20, `${launchAngle.toFixed(1)}°`);
}
{
  // Walk up to a resting ball from a distance and dig it, with no teleporting.
  const g = makeGame(() => 0);
  g.ballBody.setTranslation({ x: 0, y: BL.radius, z: -3.0 }, true);
  g.ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  g.keys.add('KeyW');                       // travels into -X/-Z on the iso basis
  g.run(2.0);
  g.keys.delete('KeyW');
  g.run(0.4);
  // Put it just in front of wherever the athlete actually ended up.
  g.placeBallOnFloor(1.2);
  g.keys.add('KeyJ');
  g.run(AC.hitWindup + AC.hitActive + 0.1);
  check('digging works after running up to the ball', g.hits.length === 1, `${g.hits.length}`);
}

// ---------------------------------------------------------------------------
console.log('\n6f. Diving, end to end');
{
  const g = makeGame(() => 0);
  g.run(0.5);
  const start = { ...g.body.translation() };
  g.keys.add('KeyL');                          // dive
  g.frame();
  check('pressing dive enters the diving state', g.actions.diving, g.actions.state);
  check('and fires exactly one launch impulse', g.dives.length === 1, `${g.dives.length}`);
  check('the controller is on the ballistic profile', g.controller.state.diving);
  g.keys.delete('KeyL');

  // Track the arc rather than only the endpoint — a "dive" that never leaves
  // the deck would still move you forward.
  let peak = 0;
  for (let i = 0; i < 120; i++) {
    g.frame();
    peak = Math.max(peak, g.body.translation().y - T.radius);
    if (!g.actions.diving) break;
  }
  const end = g.body.translation();
  const travelled = Math.hypot(end.x - start.x, end.z - start.z);
  /* A DIVE IS A SKID. The old assertion wanted a quarter-metre of air, which is
     what made the character look like it was flying — and because the puppet's
     core is welded to the sphere, the whole body went up with it. What matters
     now is that it stays low AND covers ground, which is a harder thing to get
     right than either alone: the distance has to come from the skid rather than
     from hang time. */
  check('it stays low — this is a slide, not a swan dive',
    peak < 0.25, `peak ${peak.toFixed(3)} m`);
  check('and still covers real distance, from the skid', travelled > 2.5,
    `${travelled.toFixed(2)} m`);
  /* THE RESOLUTION CHANGED, and this is where it is recorded. A dive used to
     end in a knockdown, which zeroed the velocity — the athlete arrived at the
     end of the lunge and simply stopped, as though the floor had grabbed them.
     It now decays into a skid that keeps every bit of the remaining momentum,
     and the penalty is the lockout rather than the faceplant. */
  check('the dive resolves into a skid, not a stop', g.actions.state === 'skidding',
    g.actions.state);
  check('which is the penalty — movement is still locked', g.actions.movementLocked);
  const vAtSkid = Math.hypot(g.body.linvel().x, g.body.linvel().z);
  check('and it arrives there carrying real speed', vAtSkid > AC.skidExitSpeed + 1,
    `${vAtSkid.toFixed(2)} m/s`);

  // The skid then has to actually END, on speed, with the athlete on their feet
  // — and it has to have travelled further doing it.
  const skidStart = { ...g.body.translation() };
  for (let i = 0; i < 600 && g.actions.state === 'skidding'; i++) g.frame();
  const skidEnd = g.body.translation();
  const coasted = Math.hypot(skidEnd.x - skidStart.x, skidEnd.z - skidStart.z);
  check('the skid coasts on what the dive left it', coasted > 0.8, `${coasted.toFixed(2)} m`);
  /* AND THEN THEY GO DOWN. The skid stopped a dive feeling like a wall; ending
     it standing up made the dive free. The momentum is still yours to spend and
     the LANDING is the price — see `skidEndsInKnockdown`. */
  check('the skid resolves into a knockdown, not a stand-up',
    g.actions.state === 'knocked', `${g.actions.state}/${g.actions.reason}`);
  check('by losing the momentum, not by running out of clock',
    /dive landed/.test(g.actions.reason), g.actions.reason);
  for (let i = 0; i < 2000 && g.actions.movementLocked; i++) g.frame({ puppetSettled: true });
  check('and they do get back on their feet eventually',
    g.actions.state === 'none' && !g.actions.movementLocked, g.actions.state);
}
{
  // Holding a direction mid-dive must do nothing. If it steers, the dive stops
  // being a commitment and becomes a fast, free dash.
  const straight = makeGame(() => 0);
  straight.run(0.5);
  straight.keys.add('KeyL'); straight.frame(); straight.keys.delete('KeyL');
  const s0 = { ...straight.body.translation() };
  straight.run(0.45);
  const s1 = straight.body.translation();

  const steered = makeGame(() => 0);
  steered.run(0.5);
  steered.keys.add('KeyL'); steered.frame(); steered.keys.delete('KeyL');
  steered.keys.add('KeyD');                     // full lateral stick
  const t0 = { ...steered.body.translation() };
  steered.run(0.45);
  const t1 = steered.body.translation();

  const drift = Math.hypot((t1.x - t0.x) - (s1.x - s0.x), (t1.z - t0.z) - (s1.z - s0.z));
  check('steering input does not bend the dive', drift < 0.05, `${drift.toFixed(4)} m of drift`);
}
{
  // A run-up must pay off, or nobody sprints into a dive.
  const still = makeGame(() => 0);
  still.run(0.5);
  still.keys.add('KeyL'); still.frame();
  const standing = still.dives[0].launchSpeed;

  const running = makeGame(() => 0);
  running.keys.add('KeyW'); running.keys.add('ShiftLeft');
  running.run(2.0);
  running.keys.add('KeyL'); running.frame();
  const sprinting = running.dives[0].launchSpeed;
  check('diving out of a sprint launches harder than from a standstill',
    sprinting > standing + 1.5,
    `${sprinting.toFixed(2)} vs ${standing.toFixed(2)} m/s`);
}
{
  /* The desperation dig is gone with the same decision as above: the dive is a
     commitment. What is checked here now is that the refusal is CLEAN — the
     press is not buffered into a swing that fires the instant the skid ends,
     which would restore the exploit with a delay on it. */
  const g = makeGame(() => 0);
  g.run(0.5);
  g.keys.add('KeyL'); g.frame(); g.keys.delete('KeyL');
  g.placeBallInReach(0.1);
  g.keys.add('KeyJ');
  g.run(AC.hitWindup + AC.hitActive + 0.05);
  check('a dive cannot reach the ball', g.hits.length === 0, `${g.hits.length} hits`);
  g.keys.delete('KeyJ');
  for (let i = 0; i < 900 && g.actions.movementLocked; i++) g.frame();
  check('and the refused press is not queued up for when they stand',
    !g.actions.hitting && g.hits.length === 0, `${g.hits.length} hits, ${g.actions.hit.phase}`);
}
{
  // Mashing dive must never produce a second launch mid-flight.
  const g = makeGame(() => 0);
  g.run(0.5);
  for (let i = 0; i < 200; i++) {
    if (i % 3 === 0) g.keys.add('KeyL'); else g.keys.delete('KeyL');
    g.frame();
  }
  const relaunches = g.transitions.filter((t) => t.to === 'diving').length;
  check('mashing dive never double-launches mid-flight',
    relaunches === g.dives.length, `${relaunches} entries vs ${g.dives.length} impulses`);
  check('and every entry came from the ground or a slide',
    g.transitions.filter((t) => t.to === 'diving' && t.from === 'knocked').length === 0);
}

// ---------------------------------------------------------------------------
console.log('\n6e. Button presses survive frames that run zero physics steps');
{
  // A frame whose accumulator has not reached a full step runs the physics loop
  // ZERO times. On a 144 Hz display that is most frames, and an edge-triggered
  // press read inline on such a frame is silently dropped. This models it by
  // stepping the harness with sub-step frames.
  const g = makeGame(() => 0);
  g.run(0.5);
  g.placeBallOnFloor();

  // Frame at 1/144 s: not enough for a 1/60 s step on its own.
  let latched = 0;
  const pending = { volley: false };
  let accumulator = 0;
  const FRAME = 1 / 144;
  g.keys.add('KeyJ');
  for (let i = 0; i < 60; i++) {
    const inp = g.input.sample(ISO);
    if (inp.volleyPressed) { pending.volley = true; latched++; }
    accumulator += FRAME;
    while (accumulator >= DT) {
      if (pending.volley) { pending.volley = false; g.actions.tryHit('volley'); }
      accumulator -= DT;
    }
  }
  check('the press is latched even on a sub-step frame', latched === 1, `${latched}`);
  check('and still reaches the action machine', g.actions.hitting || g.actions.hit.phase !== 'idle',
    g.actions.hit.phase);
}
{
  // Same shape, but reading inline the way the OLD code did — proves the bug is
  // real rather than theoretical.
  let deliveredInline = 0, deliveredLatched = 0;
  for (const mode of ['inline', 'latched']) {
    const g = makeGame(() => 0);
    let accumulator = 0, pending = false;
    const FRAME = 1 / 144;
    g.keys.add('KeyJ');
    for (let i = 0; i < 40; i++) {
      const inp = g.input.sample(ISO);
      if (mode === 'latched' && inp.volleyPressed) pending = true;
      let press = mode === 'inline' ? inp.volleyPressed : pending;
      accumulator += FRAME;
      let steps = 0;
      while (accumulator >= DT) {
        if (press) { if (mode === 'inline') deliveredInline++; else deliveredLatched++; press = false; pending = false; }
        accumulator -= DT; steps++;
      }
    }
  }
  check('reading presses inline DROPS them on sub-step frames', deliveredInline === 0,
    `inline delivered ${deliveredInline}`);
  check('latching delivers the press exactly once', deliveredLatched === 1,
    `latched delivered ${deliveredLatched}`);
}

// ---------------------------------------------------------------------------
console.log('\n6g. The camera actually steers the athlete');
{
  // The whole reason the basis is recomputed per frame. With the camera at its
  // default yaw, W goes one way; orbit 90° and the SAME key must go 90° round.
  const a = makeGame(() => 0);
  a.orbitCamera();
  a.keys.add('KeyW');
  a.run(1.2);
  const va = a.body.linvel();
  const yawA = Math.atan2(va.x, va.z);

  const b = makeGame(() => 0);
  b.orbitCamera();
  b.run(0.3);
  b.director.look(Math.PI / 2, 0);      // orbit a quarter turn
  b.run(0.1);
  b.keys.add('KeyW');
  b.run(1.2);
  const vb = b.body.linvel();
  const yawB = Math.atan2(vb.x, vb.z);

  check('orbiting the camera rotates where "forward" goes',
    Math.abs(Math.abs(shortestAngle(yawA, yawB)) - Math.PI / 2) < 0.12,
    `${((yawB - yawA) * 180 / Math.PI).toFixed(1)}° apart, want 90°`);
  check('and the athlete still moves at full speed', Math.hypot(vb.x, vb.z) > 4,
    `${Math.hypot(vb.x, vb.z).toFixed(2)} m/s`);
}
{
  // Stick-up must always be AWAY from the camera. Checked at many yaws,
  // because a sign error shows up at some angles and not others.
  let worst = 0;
  for (const yaw of [0, 0.7, 1.6, 2.9, -1.1, -2.6]) {
    const g = makeGame(() => 0);
    g.orbitCamera();
    g.run(0.3);
    g.director.look(g.director.orbit.theta - yaw, 0);   // drive theta to `yaw`
    g.run(0.1);
    g.keys.add('KeyW');
    g.run(1.2);
    const v = g.body.linvel();
    const cam = g.director.camera.position;
    const p = g.body.translation();
    // Direction from camera to athlete, flattened. Moving forward must have a
    // positive component along it.
    const away = { x: p.x - cam.x, z: p.z - cam.z };
    const al = Math.hypot(away.x, away.z) || 1;
    const dot = (v.x * away.x + v.z * away.z) / (al * (Math.hypot(v.x, v.z) || 1));
    worst = Math.min(worst === 0 ? dot : worst, dot);
  }
  check('stick-up moves AWAY from the camera at every yaw', worst > 0.9,
    `worst alignment ${worst.toFixed(3)}`);
}
{
  // Mouse look through the real input path, not by poking the director.
  const g = makeGame(() => 0);
  g.orbitCamera();
  g.run(0.5);
  const before = g.director.orbit.theta;
  for (let i = 0; i < 30; i++) { g.mouse.dx += 12; g.frame(); }
  check('mouse deltas reach the camera through input.sample',
    Math.abs(g.director.orbit.theta - before) > 0.5,
    `${(g.director.orbit.theta - before).toFixed(3)} rad`);
  check('and the accumulator is drained, so motion is never counted twice',
    g.mouse.dx === 0 && g.mouse.dy === 0);
}
{
  // Cycling with the keyboard, end to end, and the basis must not jolt.
  const g = makeGame(() => 0);
  g.orbitCamera();
  g.keys.add('KeyW');
  g.run(1.5);
  const modes = [g.director.mode.id];
  let worstStep = 0, prev = g.director.basisYaw;
  for (let c = 0; c < 4; c++) {
    g.keys.add('KeyE'); g.frame(); g.keys.delete('KeyE');
    for (let i = 0; i < 60; i++) {
      g.frame();
      worstStep = Math.max(worstStep, Math.abs(shortestAngle(prev, g.director.basisYaw)));
      prev = g.director.basisYaw;
    }
    modes.push(g.director.mode.id);
  }
  check('E cycles through every camera and wraps',
    modes.join(',') === 'action,arena,rally,broadcast,action', modes.join(','));
  check('and the movement basis never jolts across a switch',
    worstStep < 0.12, `worst ${(worstStep * 180 / Math.PI).toFixed(2)}° in one frame`);
  const v = g.body.linvel();
  check('the athlete kept running throughout', Math.hypot(v.x, v.z) > 3,
    `${Math.hypot(v.x, v.z).toFixed(2)} m/s`);
}
{
  // A held key through a mode change must not send the athlete somewhere wild.
  // The camera swings a long way; the athlete's heading should follow smoothly.
  const g = makeGame(() => 0);
  g.orbitCamera();
  g.keys.add('KeyW'); g.keys.add('ShiftLeft');
  g.run(2.0);
  g.director.setMode('broadcast');
  let worstTurn = 0, prev = Math.atan2(g.body.linvel().x, g.body.linvel().z);
  for (let i = 0; i < 90; i++) {
    g.frame();
    const v = g.body.linvel();
    if (Math.hypot(v.x, v.z) < 0.5) continue;
    const yaw = Math.atan2(v.x, v.z);
    worstTurn = Math.max(worstTurn, Math.abs(shortestAngle(prev, yaw)));
    prev = yaw;
  }
  check('a held direction key survives a camera change without a lurch',
    worstTurn < 0.09, `worst ${(worstTurn * 180 / Math.PI).toFixed(2)}° in one frame`);
}
{
  // The broadcast rig pans hard as the play moves; the controls must not.
  const g = makeGame(() => 0);
  g.orbitCamera();
  g.director.setMode('broadcast');
  g.run(1.0);
  const yaws = [];
  g.keys.add('KeyW'); g.keys.add('ShiftLeft');
  for (let i = 0; i < 300; i++) { g.frame(); yaws.push(g.director.basisYaw); }
  const spread = Math.max(...yaws) - Math.min(...yaws);
  check('running across a panning broadcast rig never rotates the controls',
    spread < 1e-9, `${(spread * 180 / Math.PI).toFixed(2)}° of drift`);
}

// ---------------------------------------------------------------------------
console.log('\n7. Ray filtering and long-session stability');
{
  const g = makeGame();
  g.rayCalls.length = 0;
  g.frame();
  check('ground probes carry the world/prop filter',
    g.rayCalls.length > 0 && g.rayCalls.every((r) => r.groups === RAY_FILTER),
    `${g.rayCalls.filter((r) => r.groups !== RAY_FILTER).length} unfiltered`);
}
{
  const ref = { pad: null };
  const g = makeGame((x, z) => Math.max(0, Math.sin(z * 0.25) * 0.5), ref);
  let bad = 0, stuck = 0, lockedRun = 0;
  const badly = (v) => !isFinite(v);
  for (let i = 0; i < 3000; i++) {
    ref.pad = pad({
      axes: [Math.sin(i / 47), Math.cos(i / 61)],
      buttons: {
        0: i % 211 < 10,            // jump
        1: i % 331 === 0,           // volley
        2: i % 617 === 0,           // dive
        3: i % 419 === 0,           // spike
        6: i % 300 < 140 ? 1 : 0,   // LT sprint
        7: i % 190 < 90 ? 1 : 0,    // RT slide
        8: i % 1301 === 0,          // BACK debug knockdown
      },
    });
    g.frame();
    const p = g.body.translation(), v = g.body.linvel();
    if (badly(p.x) || badly(p.y) || badly(p.z) || badly(v.x) || badly(v.y) || badly(v.z)) bad++;
    if (badly(g.puppet.x) || badly(g.puppet.yaw)) bad++;
    if (g.actions.movementLocked) { lockedRun++; if (lockedRun > 60 * 8) stuck++; } else lockedRun = 0;
  }
  check('3000 frames of chaotic gamepad input stay finite', bad === 0, `${bad} non-finite`);
  check('never gets permanently stuck in a knockdown', stuck === 0);
  check('character has not escaped the map',
    Math.abs(g.body.translation().x) < 500 && Math.abs(g.body.translation().z) < 500,
    `(${g.body.translation().x.toFixed(1)}, ${g.body.translation().z.toFixed(1)})`);
}

// ---------------------------------------------------------------------------
console.log('\nY. Yaw conventions: the +PI that fixed three bugs at once');
{
  /* THE BUG. Two conventions for one quantity, converted between by doing
     nothing — which put the dive impulse, the hit volumes and the puppet's
     visual facing all exactly 180° out, while movement stayed correct.

       `basisYaw` is the camera's ORBIT AZIMUTH: where the camera SITS, measured
       from the player. `cameraBasisFromYaw` builds forward as (−sin θ, −cos θ),
       because away from the camera is the negation of the direction to it.
       Movement consumes those VECTORS and was never wrong.

       `facingAngle` is a heading where φ means the direction (sin φ, cos φ).
       The dive impulse, the hit reach and the puppet's yaw all consume it.

     This test spans both modules because the bug lived in neither — each was
     self-consistent, and the mistake was in the handoff. */
  const facingDir = (phi) => ({ x: Math.sin(phi), z: Math.cos(phi) });
  const aimFromBasis = (theta) => theta + Math.PI;

  let worst = 1;
  for (let theta = -Math.PI; theta <= Math.PI; theta += 0.21) {
    const basis = cameraBasisFromYaw(theta);
    const d = facingDir(aimFromBasis(theta));
    worst = Math.min(worst, d.x * basis.forwardX + d.z * basis.forwardZ);
  }
  check('facing = basisYaw + PI points where the camera LOOKS, at every azimuth',
    worst > 0.9999, `worst dot ${worst.toFixed(4)}`);

  // The negative control IS the old code. Without it, "+PI is correct" could be
  // true of any offset that happens to work at the default camera angle.
  let worstOld = -1;   // seeking the BEST dot the old handoff ever achieved
  for (let theta = -Math.PI; theta <= Math.PI; theta += 0.21) {
    const basis = cameraBasisFromYaw(theta);
    const d = facingDir(theta);
    worstOld = Math.max(worstOld, d.x * basis.forwardX + d.z * basis.forwardZ);
  }
  check('and the old handoff pointed the athlete straight AT the camera',
    worstOld < -0.9999, `best dot ${worstOld.toFixed(4)}`);
}
{
  // And the consequence, on the two things that consume facingAngle.
  const T2 = DEFAULT_TUNING;
  for (const theta of [0, 1.1, -2.4, Math.PI]) {
    const basis = cameraBasisFromYaw(theta);
    const facing = theta + Math.PI;
    const dive = computeDiveImpulse({
      facingAngle: facing, velocity: { x: 0, y: 0, z: 0 }, mass: 78, tuning: T2,
    });
    const dot = dive.direction.x * basis.forwardX + dive.direction.z * basis.forwardZ;
    check(`a dive at camera azimuth ${theta.toFixed(1)} fires into the court`,
      dot > 0.999, `dot ${dot.toFixed(3)}`);
  }
}
{
  // The puppet's visual yaw comes from the same angle, so it agrees for free —
  // which is the point of fixing the handoff rather than negating the actions.
  // The dummy is authored facing +Z, and pinCore rotates it about Y by
  // facingAngle, so its forward is (sin φ, cos φ): the same convention.
  const theta = 0.8;
  const basis = cameraBasisFromYaw(theta);
  const phi = theta + Math.PI;
  const bodyForward = { x: Math.sin(phi), z: Math.cos(phi) };
  check('and the body faces the same way the dive fires',
    bodyForward.x * basis.forwardX + bodyForward.z * basis.forwardZ > 0.999);
}
{
  // PRESERVING THE MOVEMENT. The whole risk of this change was breaking the
  // stick, which was already correct. Movement consumes the basis VECTORS and
  // never touches facingAngle, so it must be untouched — asserted rather than
  // assumed.
  const cases = [
    ['stick up', 0, 1], ['stick down', 0, -1],
    ['stick right', 1, 0], ['stick left', -1, 0],
  ];
  let bad = 0;
  for (const theta of [0, 0.7, -1.9, 3.0]) {
    const basis = cameraBasisFromYaw(theta);
    for (const [, sx, sy] of cases) {
      // What the input module does with a stick reading, verbatim.
      const wx = basis.rightX * sx + basis.forwardX * sy;
      const wz = basis.rightZ * sx + basis.forwardZ * sy;
      // Stick up must move away from the camera; right must be 90° clockwise of it.
      const fwd = sy * (wx * basis.forwardX + wz * basis.forwardZ);
      const rgt = sx * (wx * basis.rightX + wz * basis.rightZ);
      if (sy !== 0 && fwd < 0.999) bad++;
      if (sx !== 0 && rgt < 0.999) bad++;
    }
  }
  check('the movement basis is untouched by the facing fix', bad === 0, `${bad} bad cases`);
}

// ---------------------------------------------------------------------------
console.log('\nS. Friction, damping and the lockout, end to end');
{
  /* GRAVITY DOWN A RAMP. The complaint was that a slide did nothing — and one
     half of "nothing" is that it did not accelerate downhill. On a slope the
     controller adds an explicit along-slope term while sliding, and the
     frictionless contact stops the sphere converting that into spin instead of
     travel. Asserted as a comparison against the same slope NOT sliding, so it
     cannot pass on gravity alone. */
  const slope = (x, z) => Math.max(0, z * 0.6);      // downhill toward -Z

  const rolling = makeGame(slope);
  rolling.keys.add('KeyW'); rolling.keys.add('ShiftLeft');
  rolling.run(2.0);
  const rollSpeed = rolling.controller.state.groundSpeed;

  const sliding = makeGame(slope);
  sliding.keys.add('KeyW'); sliding.keys.add('ShiftLeft');
  sliding.run(2.0);
  sliding.keys.add('KeyC');
  sliding.run(0.1);
  check('the slide engaged', sliding.actions.sliding, sliding.actions.state);
  const z0 = sliding.body.translation().z;
  sliding.run(1.0);
  const z1 = sliding.body.translation().z;
  check('gravity keeps pulling a slide down the ramp', z1 < z0 - 1.0,
    `${(z0 - z1).toFixed(2)} m of descent`);
  check('and it holds speed rather than scrubbing to a halt',
    sliding.controller.state.groundSpeed > AC.slideMinSpeed,
    `${sliding.controller.state.groundSpeed.toFixed(2)} vs rolling ${rollSpeed.toFixed(2)} m/s`);
}
{
  /* COASTING ON THE FLAT. A slide with no drive and near-zero friction should
     lose speed slowly — much more slowly than simply letting go of the stick,
     which is what "it should coast" means in numbers. */
  const coast = makeGame(() => 0);
  coast.keys.add('KeyW'); coast.keys.add('ShiftLeft');
  coast.run(2.0);
  const v0 = coast.controller.state.groundSpeed;
  coast.keys.add('KeyC');
  coast.run(1.0);
  const slid = coast.controller.state.groundSpeed;

  const letGo = makeGame(() => 0);
  letGo.keys.add('KeyW'); letGo.keys.add('ShiftLeft');
  letGo.run(2.0);
  letGo.keys.delete('KeyW'); letGo.keys.delete('ShiftLeft');
  letGo.run(1.0);
  const braked = letGo.controller.state.groundSpeed;

  check('a slide keeps far more of its speed than letting go does',
    slid > braked + 1.5, `slide ${slid.toFixed(2)} vs brake ${braked.toFixed(2)} m/s (from ${v0.toFixed(2)})`);
}
{
  /* THE LOCKOUT, measured where it matters: the TORQUE on the body. Checking
     `movementLocked` only proves the flag; checking the torque proves the flag
     is wired to something. Full stick held throughout. */
  const g = makeGame(() => 0);
  g.run(0.5);
  g.keys.add('KeyL'); g.frame(); g.keys.delete('KeyL');
  g.keys.add('KeyW'); g.keys.add('KeyD'); g.keys.add('ShiftLeft');

  /* Sampled against the CONTROLLER's record of the mode it just ran under, not
     against the action machine's current state. The step that ends the skid
     transitions to 'none' inside `actions.update` and then legitimately drives
     on the very same step — reading `actions.state` after the frame would
     attribute that first frame of running to the skid. */
  let maxTorque = 0, sawDive = false, sawSkid = false, frames = 0;
  for (let i = 0; i < 600 && g.actions.movementLocked; i++) {
    g.frame();
    const cs = g.controller.state;
    if (cs.diving) sawDive = true;
    if (cs.skidding) sawSkid = true;
    if (cs.diving || cs.skidding) {
      frames++;
      maxTorque = Math.max(maxTorque, Math.abs(cs.torque));
    }
  }
  check('the committed window lasted a real amount of time', frames > 30, `${frames} frames`);
  check('the run passed through both committed states', sawDive && sawSkid);
  check('no drive torque reaches the sphere while diving or skidding',
    maxTorque < 1e-9, `${maxTorque.toFixed(4)} N·m`);
  check('and it ends with the athlete standing', g.actions.state === 'none', g.actions.state);

  // NEGATIVE CONTROL: the same stick, not committed, produces plenty of torque.
  const free = makeGame(() => 0);
  free.keys.add('KeyW'); free.keys.add('KeyD'); free.keys.add('ShiftLeft');
  free.run(0.5);
  check('NEGATIVE CONTROL: the same input drives hard when not committed',
    Math.abs(free.controller.state.torque) > 1, `${free.controller.state.torque.toFixed(1)} N·m`);
}
{
  /* THE SURFACE FOLLOWS THE STATE, all the way to the collider handle, across
     a whole dive → skid → stand cycle. This is the wiring the module tests
     cannot see. */
  const g = makeGame(() => 0);
  g.run(0.5);
  check('standing on the normal profile', g.controller.state.surface === 'normal');
  g.keys.add('KeyL'); g.frame(); g.keys.delete('KeyL');
  check('the dive switches the contact', g.controller.state.surface === 'dive'
    && Math.abs(g.collider.friction - T.diveFriction) < 1e-9, `${g.collider.friction}`);
  while (g.actions.state === 'diving') g.frame();
  check('the skid inherits it unchanged', g.controller.state.surface === 'skid'
    && Math.abs(g.collider.friction - T.diveFriction) < 1e-9, `${g.collider.friction}`);
  check('and the damping never came back mid-skid',
    g.body.damping === T.skidDamping, `${g.body.damping}`);
  for (let i = 0; i < 900 && g.actions.state === 'skidding'; i++) g.frame();
  g.run(0.1);
  check('standing up restores traction and damping',
    Math.abs(g.collider.friction - T.friction) < 1e-9 && g.body.damping === T.linearDamping,
    `${g.collider.friction} / ${g.body.damping}`);
}

// ---------------------------------------------------------------------------
console.log('\nT. Stamina, end to end');
const ST = DEFAULT_STAMINA_TUNING;
const ST_ACT = DEFAULT_ACTION_TUNING;
{
  /* THE COSTS REACH THE TANK THROUGH THE KEYBOARD, not through a direct call.
     `tryDive()` charging correctly is a module test; what this asserts is that
     the key the player actually presses ends up debiting the meter. */
  const g = makeGame(() => 0, { pad: null }, { max: 100, start: 100 });
  g.run(0.5);
  check('a resting athlete is at full stamina', g.stamina.value === 100, `${g.stamina.value}`);

  g.keys.add('KeyL'); g.frame(); g.keys.delete('KeyL');
  check('pressing dive debits the dive cost',
    Math.abs(g.stamina.value - (100 - ST.diveCost)) < 1e-9, `${g.stamina.value}`);
  check('and the dive actually happened', g.actions.diving, g.actions.state);
}
{
  const g = makeGame(() => 0, { pad: null }, { max: 100, start: 100 });
  g.run(0.5);
  g.keys.add('KeyJ'); g.frame(); g.keys.delete('KeyJ');
  check('pressing volley debits the hit cost',
    Math.abs(g.stamina.value - (100 - ST.hitCost)) < 1e-9, `${g.stamina.value}`);
  check('and the swing actually started', g.actions.hitting, g.actions.hit.phase);
}
{
  /* NO REGENERATION WHILE COMMITTED. The demo passes `draining` from
     `physics.passive`, so this is really a check that the two modules agree
     about which states are passive — the exact class of wiring the unit suites
     cannot see. */
  const g = makeGame(() => 0, { pad: null }, { max: 100, start: 50, regenDelay: 0 });
  g.keys.add('KeyL'); g.frame(); g.keys.delete('KeyL');
  const atLaunch = g.stamina.value;
  let low = atLaunch;
  for (let i = 0; i < 400 && g.actions.movementLocked; i++) {
    g.frame();
    low = Math.min(low, g.stamina.value);
    if (g.stamina.value > atLaunch + 1e-9) {
      check('NEGATIVE CONTROL should not fire: regen during the committed window', false,
        `${g.stamina.value} > ${atLaunch}`);
      break;
    }
  }
  check('nothing regenerates through the dive and skid',
    Math.abs(low - atLaunch) < 1e-9, `${low} vs ${atLaunch}`);
  g.run(1.5);
  check('and it resumes once the athlete is standing', g.stamina.value > atLaunch,
    `${g.stamina.value}`);
}
{
  /* A SLIDE DRAINS, AND RUNNING DRY ENDS IT — with the trigger held down the
     whole time, which is the only version of this worth asserting. */
  const g = makeGame(() => 0, { pad: null },
    { max: 100, start: 40, slideDrain: 40, slideMinReserve: 10 });
  g.keys.add('KeyW'); g.keys.add('ShiftLeft');
  g.run(2.0);
  const before = g.stamina.value;
  g.keys.add('KeyC');
  g.run(0.2);
  check('holding slide enters the state', g.actions.sliding, g.actions.state);
  check('and it is draining', g.stamina.value < before - 5, `${g.stamina.value} from ${before}`);

  let frames = 0;
  while (g.actions.sliding && frames < 1200) { g.frame(); frames++; }
  check('running dry ends the slide with the trigger still held',
    !g.actions.sliding, g.actions.state);
  check('and the reason says stamina, not the clock', /stamina/.test(g.actions.reason),
    g.actions.reason);
  check('the tank is empty and the penalty is running', g.stamina.exhausted);
}
{
  /* THE LOCKOUT, through the keyboard. An exhausted athlete presses every
     button and nothing happens — and then, crucially, it starts working again.
     A lockout with no exit is indistinguishable from a crash. */
  const g = makeGame(() => 0, { pad: null }, { max: 100, start: 100 });
  g.run(0.5);
  // `reset(0)` empties the tank but deliberately does NOT arm the penalty —
  // resetting is a debug action, not a punishment — so drain into it, before
  // stepping a frame that would otherwise start regenerating.
  g.stamina.reset(0);
  g.stamina.drain('slide', 1);
  check('the tank is empty and the penalty is armed',
    g.stamina.value === 0 && g.stamina.exhausted, `${g.stamina.value}`);
  g.frame();
  check('and a frame of regeneration cannot lift it', g.stamina.value === 0,
    `${g.stamina.value}`);

  g.keys.add('KeyL'); g.frame(); g.keys.delete('KeyL');
  check('dive does nothing while exhausted', !g.actions.diving, g.actions.state);
  g.keys.add('KeyJ'); g.frame(); g.keys.delete('KeyJ');
  check('nor does a swing', !g.actions.hitting, g.actions.hit.phase);
  g.keys.add('KeyW'); g.keys.add('ShiftLeft'); g.keys.add('KeyC');
  g.run(1.0);
  check('nor does slide', !g.actions.sliding, g.actions.state);
  check('and every refusal was attributed to stamina', g.denials.length >= 2,
    g.denials.join(','));
  check('NEGATIVE CONTROL: the athlete can still RUN while exhausted — '
    + 'this is a resource, not a stun',
    g.controller.state.groundSpeed > 1, `${g.controller.state.groundSpeed.toFixed(2)} m/s`);

  /* STANDING STILL IS WHAT PAYS NOW. Recovery is two rates and the fast one
     needs the stick released AND the athlete stopped, so the keys come off
     BEFORE the wait — holding W here would trickle at `regenMoving` and this
     would look like broken regeneration rather than the design. */
  g.keys.delete('KeyC'); g.keys.delete('KeyW'); g.keys.delete('ShiftLeft');
  g.run(12.0);
  check('the tank refills once the penalty is over, given time at rest',
    g.stamina.value > ST.diveCost, `${g.stamina.value.toFixed(1)}`);
  g.keys.add('KeyL'); g.frame(); g.keys.delete('KeyL');
  check('and diving works again', g.actions.diving, g.actions.state);
}
{
  // Long-session sanity: the meter must stay inside its own bounds under the
  // same chaotic input the rest of this file uses.
  const g = makeGame(() => 0, { pad: null }, { max: 100, start: 100 });
  const ALL = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyL', 'KeyJ', 'KeyK', 'Space', 'ShiftLeft'];
  let seed = 99, bad = 0;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 3000; i++) {
    for (const k of ALL) { if (rnd() < 0.08) (rnd() < 0.5 ? g.keys.add(k) : g.keys.delete(k)); }
    g.frame();
    const v = g.stamina.value;
    if (!(Number.isFinite(v) && v >= 0 && v <= 100)) bad++;
  }
  check('3000 chaotic frames keep the meter inside its bounds', bad === 0, `${bad} violations`);
  check('and the athlete is not permanently stuck', g.actions.state !== 'sliding'
    || g.actions.stateTime < DEFAULT_ACTION_TUNING.slideMaxTime + 1, g.actions.state);
}

// ---------------------------------------------------------------------------
console.log('\nU. Live tuning: the bug that made every debug slider inert');
{
  /* THE FAILURE THIS EXISTS TO CATCH. Every factory used to do

         const T = Object.assign({}, DEFAULTS, tuning);

     which builds a snapshot. The factory then read that snapshot forever, so
     editing the object a slider is bound to changed nothing — silently, with no
     error, and looking identical to a control that works. Six modules had it.

     This is the property that has to hold instead: mutate the object AFTER
     construction, and the next step must see it. Asserted per factory, because
     one module getting it right says nothing about the others. */
  const tune = {};
  const a = createAthleteActions({ tuning: tune });
  check('the action machine filled in its defaults',
    tune.diveRequiresGround === true && tune.slideMinEntrySpeed > 0,
    JSON.stringify(Object.keys(tune).length));
  check('a mid-air dive is refused to begin with', a.tryDive(false) === false);
  tune.diveRequiresGround = false;                 // ← what the toggle does
  check('flipping the flag on the caller\'s object reaches the machine',
    a.tryDive(false) === true, a.state);

  const st = { max: 100, start: 100 };
  const s = createAthleteStamina({ tuning: st });
  check('the stamina module filled in its defaults', st.diveCost > 0);
  st.diveCost = 90;
  s.spend('dive');
  check('an edited cost is charged immediately', Math.abs(s.value - 10) < 1e-9, `${s.value}`);

  const ct = {};
  const g = makeGame(() => 0);
  check('the controller filled in its defaults', g.controller.tuning.friction > 0);
  g.controller.tuning.walkSpeed = 2.0;
  g.keys.add('KeyW');
  g.run(2.5);
  check('an edited walk speed is obeyed by the live controller',
    g.controller.state.targetSpeed < 2.5, `${g.controller.state.targetSpeed.toFixed(2)} m/s`);
  void ct;

  const it = {};
  const inp = createAthleteInput({ getGamepads: () => [], keys: new Set(), mouse: { dx: 0, dy: 0 } });
  check('the input module filled in its defaults', inp.tuning.deadzone > 0);
  void it;
}
{
  /* THE MIDAIR DIVE TOGGLE, end to end — the reported symptom. Jump, then press
     dive in the air, with the flag off and then on. */
  const blocked = makeGame(() => 0);
  blocked.run(0.5);
  blocked.keys.add('Space'); blocked.frame(); blocked.keys.delete('Space');
  blocked.run(0.25);
  check('the athlete is genuinely airborne', !blocked.controller.state.grounded);
  blocked.keys.add('KeyL'); blocked.frame(); blocked.keys.delete('KeyL');
  check('with the gate on, a midair dive is refused', !blocked.actions.diving,
    blocked.actions.state);

  const allowed = makeGame(() => 0);
  allowed.run(0.5);
  // Exactly what the debug toggle does: write the flag on the tuning object.
  allowed.actions.tuning.diveRequiresGround = false;
  allowed.keys.add('Space'); allowed.frame(); allowed.keys.delete('Space');
  allowed.run(0.25);
  check('still airborne', !allowed.controller.state.grounded);
  allowed.keys.add('KeyL'); allowed.frame(); allowed.keys.delete('KeyL');
  check('with the toggle on, the midair dive fires', allowed.actions.diving,
    allowed.actions.state);
  check('and the impulse actually reached the body', allowed.dives.length === 1,
    `${allowed.dives.length}`);
}

// ---------------------------------------------------------------------------
console.log('\nV. Sprint, climbing, and the harder penalties');
{
  /* SPRINT DRAINS, and running does not. The comparison is the assertion: two
     identical athletes, one holding the sprint trigger. */
  const jog = makeGame(() => 0, { pad: null }, { max: 100, start: 100 });
  jog.keys.add('KeyW');
  jog.run(3.0);

  const sprint = makeGame(() => 0, { pad: null }, { max: 100, start: 100 });
  sprint.keys.add('KeyW'); sprint.keys.add('ShiftLeft');
  sprint.run(3.0);

  check('sprinting drains the tank', sprint.stamina.value < 100 - ST.sprintDrain * 2,
    `${sprint.stamina.value.toFixed(1)}`);
  check('NEGATIVE CONTROL: jogging the same three seconds does not',
    jog.stamina.value > sprint.stamina.value + 10,
    `jog ${jog.stamina.value.toFixed(1)} vs sprint ${sprint.stamina.value.toFixed(1)}`);

  // And an exhausted athlete cannot sprint — but can still run.
  sprint.stamina.reset(0);
  sprint.stamina.drain('slide', 1);
  sprint.run(0.2);
  check('an exhausted athlete is not sprinting', !sprint.controller.state.targetSpeed
    || sprint.controller.state.targetSpeed <= T.walkSpeed + 1e-6,
    `${sprint.controller.state.targetSpeed.toFixed(2)} m/s target`);
  sprint.run(1.5);
  check('but they are still moving — a resource, not a stun',
    sprint.controller.state.groundSpeed > 1,
    `${sprint.controller.state.groundSpeed.toFixed(2)} m/s`);
}
{
  /* THE INCLINE TAX, on a real ramp, through the whole stack. Same input, same
     duration, flat versus steep. */
  const flat = makeGame(() => 0, { pad: null }, { max: 100, start: 100 });
  flat.keys.add('KeyW');
  flat.run(3.0);

  // Rises toward -Z, which is where W travels on the 45° iso camera basis.
  const hill = makeGame((x, z) => Math.max(0, -z * 0.6), { pad: null },
    { max: 100, start: 100 });
  hill.keys.add('KeyW');
  hill.run(3.0);

  check('the athlete actually climbed', hill.controller.state.climbRate > 0.2,
    `${hill.controller.state.climbRate.toFixed(2)} m/s up`);
  check('climbing costs stamina', hill.stamina.value < flat.stamina.value - 5,
    `hill ${hill.stamina.value.toFixed(1)} vs flat ${flat.stamina.value.toFixed(1)}`);
  check('NEGATIVE CONTROL: the flat run barely moved the meter',
    flat.stamina.value > 90, `${flat.stamina.value.toFixed(1)}`);
}
{
  /* REGEN IS NOW TWO RATES, and the gap has to survive the whole stack —
     including the demo's definition of "at rest" as no stick AND no speed. */
  const moving = makeGame(() => 0, { pad: null },
    { max: 100, start: 20, regenDelay: 0 });
  moving.keys.add('KeyW');
  moving.run(3.0);

  const still = makeGame(() => 0, { pad: null }, { max: 100, start: 20, regenDelay: 0 });
  still.run(3.0);

  check('standing still recovers at the fast rate',
    still.stamina.value > 20 + ST.regen * 2, `${still.stamina.value.toFixed(1)}`);
  check('moving recovers much more slowly',
    moving.stamina.value < still.stamina.value - 8,
    `moving ${moving.stamina.value.toFixed(1)} vs still ${still.stamina.value.toFixed(1)}`);
  check('but it does recover — the trickle is not zero',
    moving.stamina.value > 20.5, `${moving.stamina.value.toFixed(1)}`);
}
{
  /* A DIVE NOW ENDS ON THE FLOOR. It keeps every metre the launch bought, and
     then the landing is the price. */
  const g = makeGame(() => 0);
  g.run(0.5);
  g.keys.add('KeyL'); g.frame(); g.keys.delete('KeyL');
  check('the dive launched', g.actions.diving);
  for (let i = 0; i < 900 && (g.actions.diving || g.actions.skidding); i++) g.frame();
  check('the skid resolves into a knockdown, not a stand-up',
    g.actions.state === 'knocked', `${g.actions.state}/${g.actions.reason}`);
  check('and the athlete is on the floor as a ragdoll',
    g.actions.physics.puppet === 'ragdoll' && g.actions.physics.frozen);
  for (let i = 0; i < 2000 && g.actions.movementLocked; i++) {
    g.frame({ puppetSettled: true });
  }
  check('they do get up again', g.actions.state === 'none', g.actions.state);
}
{
  /* THE SLIDE STALL, end to end: hold the trigger until the momentum is gone
     and you go down. Then the jump escape, on the same setup. */
  const stall = makeGame(() => 0);
  stall.keys.add('KeyW'); stall.keys.add('ShiftLeft');
  stall.run(2.0);
  stall.keys.add('KeyC');
  // A FRAME, before reading `sliding`. The key was added a microsecond ago and
  // nothing has stepped yet, so `while (sliding)` would exit on its first test
  // and the whole check would pass or fail on an empty loop.
  stall.frame();
  check('the slide is running before the trigger is held down', stall.actions.sliding,
    stall.actions.state);
  stall.keys.delete('KeyW'); stall.keys.delete('ShiftLeft');
  for (let i = 0; i < 1200 && stall.actions.sliding; i++) stall.frame();
  check('holding a slide until the momentum is gone drops you',
    stall.actions.state === 'knocked', `${stall.actions.state}/${stall.actions.reason}`);
  check('and the trigger was still held the whole time — this is not a release',
    stall.keys.has('KeyC'));
}
{
  /* THE STALL FLOOR SPECIFICALLY, isolated from the graded wipeout rule that
     sits above it. With `slideMinSpeed` and the grace window tuned out of the
     way, the floor is the only thing that can fire — so if the reason names the
     halt, it was the floor that fired and not its older neighbour.

     Editing `actions.tuning` mid-run is itself the point: that object is the one
     the machine reads, which is exactly what the copied-tuning bug broke. */
  const g = makeGame(() => 0);
  g.actions.tuning.slideMinSpeed = 0;      // never wipe out on the graded rule
  g.actions.tuning.slideGraceTime = 99;    // and never arm it either
  /* And lift the hard cap out of the way too. On flat ground a slide bleeds
     10.8 -> 0.6 m/s in 6.4 s against a 6.0 s cap, so the CLOCK would resolve it
     first and this would measure the timeout instead of the floor. (In normal
     play the graded `slideMinSpeed` rule fires at ~5.1 s, comfortably inside the
     cap — this is only about isolating the floor.) */
  g.actions.tuning.slideMaxTime = 60;
  g.keys.add('KeyW'); g.keys.add('ShiftLeft');
  g.run(2.0);
  g.keys.add('KeyC');
  g.frame();
  check('the slide started with both neighbours disabled', g.actions.sliding,
    g.actions.state);
  g.keys.delete('KeyW'); g.keys.delete('ShiftLeft');
  for (let i = 0; i < 2000 && g.actions.sliding; i++) g.frame();
  check('the stall floor alone still puts them down',
    g.actions.state === 'knocked' && /halt/.test(g.actions.reason),
    `${g.actions.state}/${g.actions.reason}`);
  check('and it fired at a genuinely low speed',
    g.controller.state.groundSpeed <= ST_ACT.slideStallSpeed + 0.2,
    `${g.controller.state.groundSpeed.toFixed(2)} m/s`);
}
{
  /* THE RE-ARM. Holding the trigger normally means "keep sliding", which would
     also mean jumping out of a slide re-entered one the moment you landed —
     making the escape hatch useless at exactly the moment it matters. */
  const g = makeGame(() => 0);
  g.keys.add('KeyW'); g.keys.add('ShiftLeft');
  g.run(2.0);
  g.keys.add('KeyC');
  g.frame();
  check('sliding', g.actions.sliding, g.actions.state);
  g.keys.add('Space'); g.frame(); g.keys.delete('Space');
  check('the jump got them out', g.actions.state === 'none', g.actions.state);
  // Land, still holding the trigger, still moving fast enough to slide.
  for (let i = 0; i < 240 && !g.controller.state.grounded; i++) g.frame();
  g.run(0.3);
  check('back on the ground', g.controller.state.grounded);
  check('and holding the trigger has NOT put them straight back into a slide',
    !g.actions.sliding, `${g.actions.state}/${g.actions.reason}`);

  // NEGATIVE CONTROL: releasing and re-pressing does slide again, so the re-arm
  // is a re-press rule and not a lockout.
  g.keys.delete('KeyC');
  g.frame();
  g.keys.add('KeyC');
  g.run(0.2);
  check('NEGATIVE CONTROL: releasing and re-pressing slides again',
    g.actions.sliding, `${g.actions.state} at ${g.controller.state.groundSpeed.toFixed(2)} m/s`);

  const bail = makeGame(() => 0);
  bail.keys.add('KeyW'); bail.keys.add('ShiftLeft');
  bail.run(2.0);
  bail.keys.add('KeyC');
  bail.run(0.2);
  check('the slide is running', bail.actions.sliding, bail.actions.state);
  bail.keys.add('Space');
  bail.frame();
  bail.keys.delete('Space');
  check('jump gets you out of it cleanly',
    bail.actions.state === 'none' && !bail.actions.movementLocked,
    `${bail.actions.state}/${bail.actions.reason}`);
  // Read on the LAUNCH step. A frame later gravity has already eaten some of it,
  // and "did the jump fire" becomes a question about the fall instead.
  check('and the jump itself actually fired — the slide did not swallow it',
    bail.body.linvel().y > 3, `vy=${bail.body.linvel().y.toFixed(2)}`);
  check('holding the trigger does not instantly re-enter the slide',
    !bail.actions.sliding, bail.actions.state);
}
{
  /* THE DIVE FIRES WHERE THE STICK IS POINTING. Two athletes, identical except
     for which way they are holding the stick when they press dive. */
  const dirOf = (keys) => {
    const g = makeGame(() => 0);
    g.run(0.5);
    for (const k of keys) g.keys.add(k);
    g.frame();                            // let the stick register
    g.keys.add('KeyL'); g.frame();
    return g.dives.length ? g.dives[0] : null;
  };
  const w = dirOf(['KeyW']);
  const s = dirOf(['KeyS']);
  check('both dives fired', w && s);
  if (w && s) {
    const dot = w.direction.x * s.direction.x + w.direction.z * s.direction.z;
    check('holding opposite directions dives opposite ways', dot < -0.9,
      `dot=${dot.toFixed(3)}`);
    check('and both attribute themselves to the stick',
      w.source === 'input' && s.source === 'input', `${w.source}/${s.source}`);
  }
  const neutral = dirOf([]);
  check('with no stick and no speed it falls back to facing',
    neutral && neutral.source === 'facing', neutral && neutral.source);
}

// ---------------------------------------------------------------------------
console.log('\nW. Jump stamina, end to end');
{
  const g = makeGame(() => 0, { pad: null }, { max: 100, start: 100 });
  g.run(0.5);
  g.keys.add('Space'); g.frame(); g.keys.delete('Space');
  check('the jump fired', g.body.linvel().y > 3, `vy=${g.body.linvel().y.toFixed(2)}`);
  check('and it was billed exactly once',
    Math.abs(g.stamina.value - (100 - ST.jumpCost)) < 1e-9, `${g.stamina.value}`);
}
{
  /* HELD vs TAPPED. Holding buys altitude (`jumpCutMul`), so holding costs
     more. Both halves matter: the tap must NOT pay the hold. */
  const tap = makeGame(() => 0, { pad: null }, { max: 100, start: 100, regenDelay: 9 });
  tap.run(0.5);
  tap.keys.add('Space'); tap.frame(); tap.keys.delete('Space');
  tap.run(0.5);

  const held = makeGame(() => 0, { pad: null }, { max: 100, start: 100, regenDelay: 9 });
  held.run(0.5);
  held.keys.add('Space');
  held.run(0.5);
  held.keys.delete('Space');

  check('holding the jump costs more than tapping it',
    held.stamina.value < tap.stamina.value - 1,
    `held ${held.stamina.value.toFixed(1)} vs tap ${tap.stamina.value.toFixed(1)}`);
  check('and a tap pays the flat cost and nothing else',
    Math.abs(tap.stamina.value - (100 - ST.jumpCost)) < 1e-9,
    `${tap.stamina.value.toFixed(2)}`);
  check('NEGATIVE CONTROL: holding the button while GROUNDED costs nothing extra',
    (() => {
      const w = makeGame(() => 0, { pad: null }, { max: 100, start: 100, regenDelay: 9 });
      w.run(0.5);
      // Never released, so the buffered press is consumed once and the athlete
      // is grounded for the rest — no boost is being granted.
      w.keys.add('Space');
      w.run(0.05);
      const afterFirst = w.stamina.value;
      w.run(2.5);
      return w.stamina.value >= afterFirst - ST.jumpCost - 1;
    })());
}
{
  /* AN EXHAUSTED ATHLETE CANNOT JUMP — and can still walk, because exhaustion
     is a resource state and not a stun. */
  const g = makeGame(() => 0, { pad: null }, { max: 100, start: 100 });
  g.run(0.5);
  g.stamina.reset(0);
  g.stamina.drain('slide', 1);
  const y0 = g.body.translation().y;
  g.keys.add('Space');
  g.run(0.3);
  check('an exhausted jump does not fire',
    g.body.linvel().y <= 0.6 && Math.abs(g.body.translation().y - y0) < 0.2,
    `vy=${g.body.linvel().y.toFixed(2)}`);
  check('and the refusal was attributed to stamina', g.denials.includes('jump'),
    g.denials.join(','));
  g.keys.delete('Space');

  // Recovers, then jumps.
  g.run(14.0);
  check('the tank refills at rest', g.stamina.value > ST.jumpCost,
    `${g.stamina.value.toFixed(1)}`);
  g.keys.add('Space'); g.frame(); g.keys.delete('Space');
  check('NEGATIVE CONTROL: with stamina back, the same press jumps',
    g.body.linvel().y > 3, `vy=${g.body.linvel().y.toFixed(2)}`);
}
{
  /* SPAM IS BOUNDED BY THE TANK — measured against an athlete with a free jump
     over the identical 15 seconds, not against `100 / jumpCost`. That
     arithmetic ignores regeneration, and over fifteen seconds of standing still
     regeneration funds most of the difference; the comparison is the only form
     of this claim that cannot be confounded by it. */
  const spam = (tuning) => {
    const g = makeGame(() => 0, { pad: null }, tuning);
    let jumps = 0;
    for (let i = 0; i < 900; i++) {
      if (i % 4 === 0) g.keys.add('Space'); else g.keys.delete('Space');
      if (g.frame().jumped) jumps++;
    }
    return { jumps, left: g.stamina.value };
  };
  const priced = spam({ max: 100, start: 100 });
  const free = spam({ max: 100, start: 100, jumpCost: 0, jumpHoldDrain: 0 });
  check('a free jump can be spammed', free.jumps > 25, `${free.jumps}`);
  check('pricing it cuts that down hard', priced.jumps < free.jumps * 0.6,
    `${priced.jumps} priced vs ${free.jumps} free`);
  check('but several still get through — a budget, not a ban', priced.jumps >= 3,
    `${priced.jumps}`);
  check('and the meter never left its bounds',
    priced.left >= 0 && priced.left <= 100, `${priced.left}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
