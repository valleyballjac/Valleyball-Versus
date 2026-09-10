import * as THREE from 'three';

import { TUNING } from '../config/tuning.js';
import { Interpolated } from '../core/Interpolated.js';
import { RAPIER, getWorld, BALL_GROUPS, ENVIRONMENT_RAY_GROUPS } from './physics.js';
import { applyClampedLinearDamping, applyClampedAngularDamping } from './damping.js';

/**
 * THE BALL. One body, created at boot, never destroyed, never pooled.
 *
 * WHAT IT IS ALLOWED TO DO TO ITSELF, and what it is not.
 *
 * LAW 1 — physics owns momentum. Nothing in this file writes the ball's
 * velocity or position during play. The only writes are in resetBall, which is
 * a SPAWN EVENT of exactly the same class as the athlete's respawn and the
 * out-of-bounds watchdog: consumed inside fixedUpdate, at the spawn-event slot,
 * unreachable from anywhere else. That is the one setTranslation this step adds
 * to the census, and it lives in one named function so it stays countable.
 *
 * LAW 3 — every gram of resistance goes through the clamped helpers in
 * damping.js. Rapier's own solver-damping setters are not used here, and their
 * names are deliberately not written in this file either, so the ban stays
 * checkable with one grep: a hit in ball.js should mean a violation, never a
 * comment about one.
 *
 * LAW 4 (GF-2.0) — there is no "in play" flag, no "served" boolean, no ball
 * state machine. What this module carries is a recorded tick, a recorded key
 * and three floats, all of the same class as motor.lastJumpTick. Nothing
 * anywhere branches on which state the ball is in, because it does not have
 * one.
 *
 * LESSON 15 — contact forces are INSTRUMENTED here and mapped to nothing. The
 * ball never costs the athlete tracking weight in G2. The numbers exist so the
 * thresholds a later step needs are measured rather than guessed.
 *
 * DIRECTORY RULE (src/sim/): nothing here names a wall-clock or scheduler API.
 * The clock is `tick`.
 */

/** Scratch for the resistance impulses. Reused; never escapes a call. */
const _linvel = new THREE.Vector3();
const _angvel = new THREE.Vector3();
/** Scratch for the spawn point, so a reset allocates nothing. */
const _spawn = new THREE.Vector3();
/** Scratch for the height probe. The Ray is built once, lazily, because RAPIER
 *  is not initialised at module-eval time. */
const _rayOrigin = { x: 0, y: 0, z: 0 };
const _rayDir = { x: 0, y: -1, z: 0 };
let _heightRay = null;

/** How far down the height probe looks before giving up. Metres. */
const HEIGHT_PROBE_REACH = 60;

/**
 * Texture loader and cache for custom ball skins and emissive maps.
 *
 * AWAITED BEFORE THE LOOP STARTS, which is the whole reason it is a promise and
 * not a fire-and-forget load. A texture that arrives on some later frame would
 * arrive on a DIFFERENT frame in each run, and two anchored captures would then
 * disagree about a picture while agreeing about the simulation — a LAW 6 failure
 * with an innocent cause, which is the worst kind to debug. Resolved before tick
 * 0, it is either on or off for the entire run.
 */
const _textureLoader = new THREE.TextureLoader();
const _textureCache = new Map();

async function loadTexture(url) {
  if (!url) return null;
  if (_textureCache.has(url)) return _textureCache.get(url);
  const promise = (async () => {
    try {
      const texture = await _textureLoader.loadAsync(url);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      console.log(`[ball] loaded texture ${url}`);
      return texture;
    } catch (e) {
      console.log(`[ball] failed to load texture ${url}:`, e?.message || e);
      return null;
    }
  })();
  _textureCache.set(url, promise);
  return promise;
}

/**
 * Fallbacks for a ball built from a partial spec. Every field TUNING.balls
 * authors overrides one of these; nothing here is a second copy of a tuned
 * number, it is what an unspecified ball would be.
 */
const BALL_DEFAULTS = {
  id: 'ball',
  label: 'Ball',
  radius: 0.20,
  density: 0.025,
  friction: 0.8,
  restitution: 0.88,
  linearDrag: 0.015,
  angularDrag: 0.04,
  spawn: { x: 0, y: 3.0, z: 2.5 },
  colorA: 0xf2f0e6,
  colorB: 0x2f6f9f,
  textureUrl: null,
  emissiveUrl: null,
};

/**
 * Two-tone vertex colours so SPIN IS VISIBLE.
 *
 * A single-colour sphere rotating is a single-colour sphere: the ball could be
 * spinning at 40 rad/s off a limb and the picture would be identical to a dead
 * ball resting. Since angular velocity is a thing G4 will tune by eye, the ball
 * has to show it. Vertex colours rather than a texture keeps it to zero asset
 * files, and splitting on the local X sign gives two hemispheres whose seam
 * sweeps visibly under any spin axis but the one it lies on.
 *
 * With three balls in the bowl the colours are also the ONLY way to tell them
 * apart at a glance from the chase camera, so each spec authors its own pair.
 *
 * @param {THREE.SphereGeometry} geometry
 * @param {number} colorA hex, the +X hemisphere
 * @param {number} colorB hex, the -X hemisphere
 */
function paintHemispheres(geometry, colorA, colorB) {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const light = new THREE.Color(colorA);
  const dark = new THREE.Color(colorB);
  for (let i = 0; i < position.count; i += 1) {
    const c = position.getX(i) >= 0 ? light : dark;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Builds the ball and puts its mesh in the scene.
 *
 * ASYNC because of the optional skin, and awaited in boot before the loop
 * starts — see loadOptionalSkin for why that ordering is a determinism
 * requirement rather than a convenience.
 *
 * @param {THREE.Scene} scene
 * @param {object} [options] one entry of TUNING.balls; anything absent falls
 *        back to BALL_DEFAULTS
 * @returns {Promise<object>} the ball handle; see the return literal
 */
export async function createBall(scene, options = {}) {
  const world = getWorld();
  const {
    id, label, radius, density, friction, restitution, spawn,
    linearDrag, angularDrag, colorA, colorB,
    textureUrl, emissiveUrl,
  } = { ...BALL_DEFAULTS, ...options };
  // Shared by every ball, and deliberately not per-spec: the threshold is a
  // property of what the instrumentation should bother reporting, not of any
  // one ball.
  const { eventThreshold } = TUNING.ball;

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      // LAW 6 — a sleeping ball would miss the first contact after a rest, and
      // whether it had gone to sleep would depend on how long the frame before
      // it took. Determinism first; the cost is one body always integrating.
      .setCanSleep(false)
      // A 40 cm ball at spike speed still crosses its own diameter inside one
      // 60 Hz step, which is the textbook tunnelling case: without CCD it will
      // eventually pass through the bowl floor and fall to the kill plane. The
      // bigger ball buys margin here but does not remove the need.
      .setCcdEnabled(true),
  );

  const collider = world.createCollider(
    RAPIER.ColliderDesc.ball(radius)
      // LESSON 12 — TUNING authors density in g/cm3 because that is the unit a
      // human can sanity-check ("water is 1.0"); Rapier wants kg/m3. The x1000
      // conversion is here, once, and the boot log below corroborates it: at
      // 0.025 g/cm3 and r 0.20 the ball must weigh 0.84 kg. If that line ever
      // prints 0.00084 or 838, the x1000 has been applied twice or not at all.
      .setDensity(density * 1000)
      .setFriction(friction)
      .setRestitution(restitution)
      // THE COMBINE RULE IS A CODE CONSTANT, NOT A KNOB, and it has to be Max.
      // Rapier's default is Average, and both surfaces the ball ever hits carry
      // restitution 0 — the arena trimesh and the limb capsules. Averaged, a
      // ball authored at 0.8 bounces like a 0.4 ball and every hour spent
      // tuning restitution afterwards is spent tuning the wrong number. Max
      // means the ball's own bounciness wins against dead surfaces, which is
      // the only reading under which TUNING.ball.restitution means what it says.
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setCollisionGroups(BALL_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(eventThreshold),
    body,
  );

  // 32 x 24 rather than 24 x 16: at 40 cm across the silhouette is now big
  // enough on screen that the coarser sphere read as faceted while spinning.
  // Segment count scales with radius so the 1.5 m ball is not visibly faceted
  // next to the 0.4 m one — a fixed 32x24 is generous on the small ball and
  // coarse on the large. Clamped at both ends so it stays a sphere and never
  // becomes a budget problem.
  const segmentsU = Math.max(24, Math.min(64, Math.round(32 * (radius / 0.2) ** 0.5)));
  const segmentsV = Math.max(16, Math.min(48, Math.round(segmentsU * 0.75)));
  const geometry = new THREE.SphereGeometry(radius, segmentsU, segmentsV);
  const diffuseMap = await loadTexture(textureUrl);
  const emissiveMap = await loadTexture(emissiveUrl);
  // The painted hemispheres are the fallback, and they are still built when a
  // skin is present — they cost nothing, and a texture that fails to decode
  // leaves the colours underneath rather than a white ball.
  paintHemispheres(geometry, colorA, colorB);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      map: diffuseMap,
      emissiveMap: emissiveMap,
      emissive: emissiveMap ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
      emissiveIntensity: emissiveMap ? 1.0 : 0.0,
      // Vertex colours multiply the map, so with a skin on they would tint it
      // down one side. On only when there is no skin to tint.
      vertexColors: !diffuseMap,
      // Rubber: matte enough to kill the plastic sheen, with a trace of specular
      // so the curvature still reads under the key light.
      roughness: 0.4,
      metalness: 0.05,
      wireframe: TUNING.debug.showBallWireframe,
    }),
  );
  mesh.name = `ball-${id}`;
  // THE DEPTH CUE. Height and distance are the same picture from a chase camera
  // until the shadow separates them; catching a lobbed ball is guesswork without
  // it. It casts and does not receive — nothing else casts onto it.
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.position.set(spawn.x, spawn.y, spawn.z);
  scene.add(mesh);

  // LESSON 12, CORROBORATED RATHER THAN ASSERTED. The expected mass is computed
  // here from the authored density and radius; the actual is whatever Rapier
  // derived from the collider. Printing BOTH is the point — a x1000 applied
  // twice, or a radius that did not reach the collider, shows up as two numbers
  // that disagree instead of one number nobody checks.
  const expectedMass = density * 1000 * ((4 / 3) * Math.PI * radius ** 3);
  const actualMass = body.mass();
  console.log(
    `[ball:${id}] ${label} — mass ${actualMass.toFixed(3)} kg ` +
      `(expected ${expectedMass.toFixed(3)} kg from ${density} g/cm3 at r ${radius} m), ` +
      `restitution ${restitution} combine Max, friction ${friction}, ` +
      `drag ${linearDrag}/${angularDrag}, spawn (${spawn.x}, ${spawn.y}, ${spawn.z}), ` +
      `${segmentsU}x${segmentsV} segments, CCD on, sleep off`,
  );
  if (Math.abs(actualMass - expectedMass) > 1e-3) {
    console.error(
      `[ball:${id}] mass disagrees with the authored density: Rapier says ` +
        `${actualMass.toFixed(4)} kg, the g/cm3 -> kg/m3 conversion says ` +
        `${expectedMass.toFixed(4)} kg.`,
    );
  }

  return {
    id,
    label,
    body,
    collider,
    mesh,
    interpolated: new Interpolated(mesh),
    radius,
    /** THIS ball's spawn point. resetBall reads it from here, not from TUNING,
     *  so three balls cannot end up stacked on one authored position. */
    spawn: { x: spawn.x, y: spawn.y, z: spawn.z },
    /** Per-ball drag gains, read by applyBallResistance. */
    linearDrag,
    angularDrag,
    /** The spec this ball was built from, so the live surface tunables can be
     *  pushed to the collider when the GUI moves them. */
    spec: options,
    /** Last values actually written to the collider. Same pattern as the
     *  motor's appliedFriction/appliedRestitution: compared before writing so a
     *  slider nobody touched costs nothing per step. */
    appliedFriction: friction,
    appliedRestitution: restitution,
    /** Tick of the last spawn event. -Infinity means "never reset". */
    lastResetTick: -Infinity,
    /** Tick of the last limb contact. -Infinity means "never touched". */
    lastTouchTick: -Infinity,
    /** Rig key of the last limb contact, or '' for none. NOT a state. */
    lastTouchKey: '',
    /** Force of that contact, in newtons. */
    lastTouchForce: 0,
    /** Largest limb contact force seen this session. The calibration number. */
    peakTouchForce: 0,
    /**
     * Times the ball has been reported in contact with the MOTOR collider.
     * This must stay 0 for the life of the process: the sphere is filtered out
     * of the ball's interaction word, so a single event here means the filter
     * has been broken and the athlete is bulldozing the ball with an invisible
     * half-metre sphere. main.js asserts on it once a second.
     */
    motorContactCount: 0,
  };
}

/**
 * THE SPAWN EVENT. The only writer of the ball's position or velocity.
 *
 * Callable from fixedUpdate and nowhere else — it teleports a body, which is
 * the one thing gameplay is never allowed to do. Both prev and curr are reset
 * on the interpolation so the render does not streak the ball across the bowl
 * on its way back to the spawn point.
 *
 * @param {object} ball
 * @param {number} tick
 * @param {{ x: number, y: number, z: number }|null} [targetPos=null]
 */
export function resetBall(ball, tick, targetPos = null) {
  if (targetPos) {
    ball.spawn.x = targetPos.x;
    ball.spawn.y = targetPos.y;
    ball.spawn.z = targetPos.z;
  }
  // THE BALL'S OWN spawn, carried on the handle.
  _spawn.set(ball.spawn.x, ball.spawn.y, ball.spawn.z);

  ball.body.setTranslation({ x: _spawn.x, y: _spawn.y, z: _spawn.z }, true);
  ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  ball.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  ball.interpolated.reset(_spawn);

  ball.lastResetTick = tick;
}

/**
 * Computes a non-colliding randomized drop position at Goal height (y = 10.0m)
 * within the court pitch bounds.
 *
 * LAW 6 — Determinism: When isDeterministic is true (e.g. during an anchored
 * capture run), the generator uses a seeded Mulberry32 PRNG keyed on tick and
 * ball index. In live play, it introduces spontaneous random variation across
 * non-overlapping court sectors so the balls never spawn inside each other.
 *
 * @param {number} ballIndex
 * @param {number} totalBalls
 * @param {number} [tick=0]
 * @param {boolean} [isDeterministic=false]
 * @returns {{ x: number, y: number, z: number }}
 */
export function getCourtBallDropSpawn(ballIndex, totalBalls = 3, tick = 0, isDeterministic = false) {
  const {
    ballDropHeightY = 10.0,
    pitchBoundsX = 16.0,
    pitchBoundsZ = 30.0,
    pitchMarginX = 2.0,
    pitchMarginZ = 4.0,
  } = (TUNING.match || {});

  const maxX = Math.max(2.0, pitchBoundsX - pitchMarginX); // e.g. 14.0 m
  const maxZ = Math.max(4.0, pitchBoundsZ - pitchMarginZ); // e.g. 26.0 m

  // Partition the court's longitudinal Z span into totalBalls non-overlapping sectors
  const zSpan = 2 * maxZ;
  const count = Math.max(1, totalBalls);
  const sectorSize = zSpan / count;
  const sectorMinZ = -maxZ + ballIndex * sectorSize;

  let rX, rZ;
  if (isDeterministic) {
    const seed = (Math.imul(tick + 1, 198491317) ^ Math.imul(ballIndex + 1, 6542989)) >>> 0;
    let t = (seed + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    rX = ((t ^ (t >>> 14)) >>> 0) / 4294967296;

    t = (t + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    rZ = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  } else {
    rX = Math.random();
    rZ = Math.random();
  }

  // Margin inside the sector so balls don't drop on sector boundaries
  const padZ = 1.5;
  const innerSpanZ = Math.max(0.5, sectorSize - 2 * padZ);
  const z = (sectorMinZ + padZ) + rZ * innerSpanZ;
  const x = -maxX + rX * (2 * maxX);

  return {
    x: Math.round(x * 100) / 100,
    y: ballDropHeightY,
    z: Math.round(z * 100) / 100,
  };
}

/**
 * Air drag and spin decay, LAW 3 — through the clamped helpers and nothing else.
 *
 * The relative velocity handed in is the ABSOLUTE velocity here, and that is
 * correct for this body and only this body: the tracker passes a relative
 * velocity because the character is chasing a moving target and damping its
 * absolute motion would brake it against its own locomotion. The ball is
 * chasing nothing. Still air is its target, and still air is zero.
 *
 * The gains are deliberately small. A volleyball crossing a court loses a
 * little pace over twenty metres, not over two; drag large enough to feel in a
 * short room reads as the ball moving through syrup.
 *
 * @param {object} ball
 * @param {number} dt the constant timestep
 */
export function applyBallResistance(ball, dt) {
  // THE LIVE SURFACE TUNABLES, pushed here for the same reason the motor pushes
  // its own inside updateMotor: every physics mutation belongs inside the fixed
  // step. Without this the GUI's friction and restitution sliders move a number
  // that the collider never reads — they looked live and were not, which is
  // exactly the "worse than no slider" failure the panel's own doc-block warns
  // about. Guarded on change, so an untouched slider costs one comparison.
  const spec = ball.spec || {};
  if (spec.friction !== undefined && spec.friction !== ball.appliedFriction) {
    ball.appliedFriction = spec.friction;
    ball.collider.setFriction(ball.appliedFriction);
  }
  if (spec.restitution !== undefined && spec.restitution !== ball.appliedRestitution) {
    ball.appliedRestitution = spec.restitution;
    ball.collider.setRestitution(ball.appliedRestitution);
  }
  // The drag gains are read straight off the spec too, so those sliders are live
  // without a collider write at all.
  const linearDrag = spec.linearDrag !== undefined ? spec.linearDrag : ball.linearDrag;
  const angularDrag = spec.angularDrag !== undefined ? spec.angularDrag : ball.angularDrag;

  const linear = ball.body.linvel();
  _linvel.set(linear.x, linear.y, linear.z);
  const speed = _linvel.length();
  if (speed > 0) {
    // Quadratic-ish: drag rises with speed, so a served ball sheds pace and a
    // rolling one is barely touched. The clamp guarantees it can only ever
    // reach zero, never push through it, whatever the gain is set to.
    applyClampedLinearDamping(
      ball.body,
      linearDrag * speed * speed * ball.body.mass() * dt,
      _linvel,
      dt,
    );
  }

  const angular = ball.body.angvel();
  _angvel.set(angular.x, angular.y, angular.z);
  if (_angvel.lengthSq() > 0) {
    applyClampedAngularDamping(ball.body, angularDrag * dt, _angvel, dt);
  }
}

/**
 * Records a contact the drain callback found on the ball.
 *
 * LESSON 15 — this MEASURES and maps to nothing. The force never becomes a
 * tracking-weight cost in G2; it becomes a number in the HUD and in the probe,
 * so the thresholds G4 needs are read off real play instead of invented.
 *
 * Environment contacts are deliberately dropped: the ball hits the bowl
 * constantly and a "last touch" that says "floor" forty times a second tells
 * nobody anything.
 *
 * @param {object} ball
 * @param {number} otherHandle the collider handle that is not the ball's
 * @param {string|undefined} rigKeyForHandle rig key if that handle is a limb
 * @param {number} motorHandle the sphere's collider handle
 * @param {number} force total contact force magnitude, newtons
 * @param {number} tick
 */
export function noteBallContact(ball, otherHandle, rigKeyForHandle, motorHandle, force, tick) {
  if (otherHandle === motorHandle) {
    // Not a warning in itself — the assert in main.js owns the alarm, because a
    // console.error here would fire once per contact per step and drown the log
    // it is trying to make legible.
    ball.motorContactCount += 1;
    return;
  }

  if (!rigKeyForHandle) return;

  ball.lastTouchKey = rigKeyForHandle;
  ball.lastTouchTick = tick;
  ball.lastTouchForce = force;
  if (force > ball.peakTouchForce) ball.peakTouchForce = force;
}

/**
 * Body -> interpolation, after the world has stepped. Same contract and same
 * slot as syncMotorSnapshot.
 *
 * @param {object} ball
 */
export function syncBallSnapshot(ball) {
  const t = ball.body.translation();
  const r = ball.body.rotation();
  ball.interpolated.currPos.set(t.x, t.y, t.z);
  ball.interpolated.currQuat.set(r.x, r.y, r.z, r.w);
}

/**
 * A read-only snapshot for the console probe. Plain numbers only — never the
 * body, for the same reason the athlete's probe returns numbers: a rigid-body
 * handle on the console is a way to write velocity into the sim from outside
 * every law in the project.
 *
 * LESSON 22 — this READS the body. It recomputes nothing the simulation
 * already knows.
 *
 * @param {object} ball
 * @returns {object}
 */
export function ballProbe(ball) {
  const t = ball.body.translation();
  const v = ball.body.linvel();
  const w = ball.body.angvel();

  // One ray, straight down, environment-only so it cannot be stopped by the
  // athlete's own calf. Height is measured to the ball's SURFACE, so a ball at
  // rest on flat floor reads its own radius and not zero.
  _rayOrigin.x = t.x;
  _rayOrigin.y = t.y;
  _rayOrigin.z = t.z;
  if (!_heightRay) _heightRay = new RAPIER.Ray(_rayOrigin, _rayDir);
  _heightRay.origin = _rayOrigin;
  const hit = getWorld().castRay(
    _heightRay,
    HEIGHT_PROBE_REACH,
    true,
    undefined,
    ENVIRONMENT_RAY_GROUPS,
  );

  return {
    id: ball.id,
    label: ball.label,
    radius: ball.radius,
    x: +t.x.toFixed(3),
    y: +t.y.toFixed(3),
    z: +t.z.toFixed(3),
    speed: +Math.hypot(v.x, v.y, v.z).toFixed(3),
    spin: +Math.hypot(w.x, w.y, w.z).toFixed(3),
    heightAboveFloor: hit ? +hit.timeOfImpact.toFixed(3) : NaN,
    mass: +ball.body.mass().toFixed(4),
    lastTouchKey: ball.lastTouchKey || '',
    lastTouchTick: ball.lastTouchTick,
    lastTouchForce: +ball.lastTouchForce.toFixed(2),
    peakTouchForce: +ball.peakTouchForce.toFixed(2),
    motorContactCount: ball.motorContactCount,
    lastResetTick: ball.lastResetTick,
  };
}
