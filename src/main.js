import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { TUNING } from './config/tuning.js';
import { Loop } from './core/Loop.js';
import { initPhysics, stepPhysics, getWorld, drainContactForces, RAPIER } from './sim/physics.js';
import { createArena } from './sim/arena.js';
import { createMotor, updateMotor, syncMotorSnapshot, horizontalSpeed } from './sim/motor.js';
import {
  createAnimTarget,
  updateAnimTarget,
  resetAnimTarget,
  mountMatrix,
} from './sim/animtarget.js';
import { createTracker, applyTracking, applyImpacts, queueKnockdown } from './sim/tracker.js';
import { buildRagdoll, destroyRagdoll, detachMotorFromRagdoll, BONE_MAP } from './sim/autorig.js';
import {
  createRagdollVisuals,
  disposeRagdollVisuals,
  saveRagdollPrevious,
  snapshotRagdoll,
  syncRagdollPose,
  findNonFinite,
  applyRagdollVisibility,
} from './sim/ragdoll.js';
import { input, initInput, sampleInput, consumeJump } from './input.js';
import { createGui } from './debug/gui.js';
import { initCapture } from './debug/capture.js';

/**
 * Scene construction, wiring, and the render pass.
 *
 * There is no simulation logic in this file. fixedUpdate only sequences the
 * modules under src/sim/; every force, every step and every snapshot happens in
 * there.
 */

const MAX_LIVE_PIXEL_RATIO = 2;

/** Served straight out of public/. Not a tunable: it is the asset's identity. */
const CHARACTER_URL = '/models/character.glb';

/** Scratch for the mount transform. Built fresh on every spawn. */
const _mount = new THREE.Matrix4();
/** Scratch for the camera-follow delta and the watchdog respawn point. */
const _followDelta = new THREE.Vector3();
const _respawnPoint = new THREE.Vector3();

/** Set by "T", consumed at the top of the next fixed step. */
let knockdownRequested = false;

/** Shared guard: a hotkey must not fire while the user is typing in a tuning
 *  field, and auto-repeat must not fire it sixty times a second. */
function isHotkey(event, code) {
  if (event.code !== code || event.repeat) return false;
  const target = event.target;
  if (target && target.tagName) {
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
      return false;
    }
  }
  return true;
}

/**
 * "R" (re)spawns the ragdoll. Guarded against text entry so typing an R into a
 * tuning field does not drop a character on the arena, and against auto-repeat
 * so holding the key does not rebuild the rig sixty times a second.
 */
function installRespawnHotkey() {
  window.addEventListener('keydown', (event) => {
    if (isHotkey(event, 'KeyR')) requestRagdollSpawn();
    // "T" — THE KNOCKDOWN. The only writer of the blend weight besides the
    // recovery ramp. It queues a flag; fixedUpdate consumes it, so the weight
    // is never written from outside the fixed step.
    if (isHotkey(event, 'KeyT')) knockdownRequested = true;
  });
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const canvas = document.getElementById('viewport');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  // Without this the framebuffer may be cleared before a manual toDataURL reads
  // it, and every such capture comes back a valid, uniformly black PNG.
  preserveDrawingBuffer: true,
});

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d12);

scene.add(new THREE.AxesHelper(2));

const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(8, 14, 10);
scene.add(keyLight);
scene.add(new THREE.AmbientLight(0x8fb4d6, 0.55));

// Static three-quarter view. The camera is explicitly NOT simulation state and
// is NOT interpolated. There is no follow logic in this task.
const camera = new THREE.PerspectiveCamera(TUNING.camera.fov, 16 / 9, 0.1, 400);

const controls = new OrbitControls(camera, canvas);
// Damping would make the camera a function of real time, which is precisely the
// kind of hidden wall-clock dependency Step 1 exists to eliminate.
controls.enableDamping = false;

/** Applied at boot and from the GUI. Never from the render pass. */
function applyCameraTuning() {
  camera.fov = TUNING.camera.fov;
  camera.position.set(TUNING.camera.x, TUNING.camera.y, TUNING.camera.z);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();
}

/**
 * Sizes the renderer and the camera projection to the window. Called at boot,
 * on resize, and by the anchored capture to put things back afterwards. Never
 * called from the render pass.
 */
function applyViewportSize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_LIVE_PIXEL_RATIO));
  renderer.setSize(width, height);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', applyViewportSize);

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

const hud = document.getElementById('hud');
const hudTick = document.getElementById('hud-tick');
const hudAlpha = document.getElementById('hud-alpha');
const hudSteps = document.getElementById('hud-steps');
const hudFrameTime = document.getElementById('hud-frametime');
const hudDisplayHz = document.getElementById('hud-displayhz');
const hudDrift = document.getElementById('hud-drift');
const hudSpeed = document.getElementById('hud-speed');
const hudGrounded = document.getElementById('hud-grounded');
const hudWeight = document.getElementById('hud-weight');
const hudAnimSpeed = document.getElementById('hud-animspeed');
const hudBlend = document.getElementById('hud-blend');
const hudImpact = document.getElementById('hud-impact');
const hudStandUp = document.getElementById('hud-standup');

/** Init- and GUI-time only. Never called from the render pass. */
function setHudVisible(visible) {
  hud.style.display = visible ? '' : 'none';
}

function updateHud() {
  if (!TUNING.debug.showHud) return;

  hudTick.textContent = String(loop.tick);
  hudAlpha.textContent = loop.alpha.toFixed(2);
  hudSteps.textContent = String(loop.stepsThisFrame);
  hudFrameTime.textContent = `${loop.frameTimeMs.toFixed(2)} ms`;
  hudDisplayHz.textContent = `${loop.displayHz.toFixed(1)} Hz`;
  hudDrift.textContent = `${loop.driftMs.toFixed(1)} ms`;
  hudSpeed.textContent = motor ? `${horizontalSpeed(motor).toFixed(2)} m/s` : '—';
  hudGrounded.textContent = motor ? String(motor.grounded) : '—';
  hudWeight.textContent = tracker.weight.toFixed(2);
  hudAnimSpeed.textContent = animTarget ? animTarget.smoothedSpeed.toFixed(2) : '—';
  hudBlend.textContent = animTarget
    ? `${animTarget.weights.idle.toFixed(2)} ${animTarget.weights.jog.toFixed(2)} ${animTarget.weights.sprint.toFixed(2)}`
    : '—';

  // Tick-stamped, so the fade is sim time. A wall-clock timer here would make
  // the HUD a function of frame pacing.
  const age = loop.tick - tracker.lastImpactTick;
  hudImpact.textContent =
    tracker.lastImpactKey && age <= TUNING.impact.hudHoldTicks
      ? `${tracker.lastImpactKey} ${Math.round(tracker.lastImpactExcess)}`
      : '—';

  hudStandUp.textContent = animTarget
    ? `${animTarget.standUpNeed.toFixed(2)} / ${animTarget.standUpProgress.toFixed(2)} / ${animTarget.faceUpMix.toFixed(2)}`
    : '—';
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

let motor = null;

/** The invisible clip-playing rig, and the PD tracker that chases it. */
let animTarget = null;
const tracker = createTracker();

/** gltf.animations, kept so the GUI can offer the clip list. */
let characterClips = [];

/** The loaded glTF scene and its one shared skeleton. Null if the load failed. */
let characterRoot = null;
let characterSkeleton = null;

/** The live ragdoll, or null. Rebuilt wholesale on every spawn. */
let ragdoll = null;

/**
 * Set by the "R" key and by the capture seam; consumed at the top of the next
 * fixed step. Nothing spawns a body outside fixedUpdate.
 */
let respawnRequested = false;

/** Body/collider/joint counts before any ragdoll existed — the hygiene baseline. */
let baselineCounts = null;

/**
 * collider handle -> { key, group }, rebuilt on every spawn.
 *
 * Contact-force events name colliders, not bodies. This is how an event becomes
 * "the chest was hit" rather than "handle 27 was hit".
 */
const impactByHandle = new Map();
/** The group each rig key belongs to, read straight off the authored table. */
const groupByKey = new Map(BONE_MAP.map((entry) => [entry.key, entry.group]));
/** Reused per step so the drain allocates nothing. */
const impactEvents = [];

export function requestRagdollSpawn() {
  respawnRequested = true;
}

/** World object counts, for the respawn-hygiene check. */
function worldCounts() {
  const world = getWorld();
  return {
    bodies: world.bodies.len(),
    colliders: world.colliders.len(),
    joints: world.impulseJoints.len(),
  };
}

/**
 * Tears down any existing ragdoll and derives a fresh one. Physics mutation, so
 * this is only ever called from inside fixedUpdate.
 */
function spawnRagdoll() {
  if (!characterSkeleton) {
    console.warn('[ragdoll] no character loaded; R does nothing');
    return;
  }

  if (ragdoll) {
    destroyRagdoll(ragdoll);
    disposeRagdollVisuals(ragdoll.group);
    ragdoll = null;
  }

  // The rig is derived from the BIND pose, so the skeleton has to be back in it
  // before measuring. A respawn measured off the previous flop would compound
  // its own error every time R was pressed.
  restoreBindPose();

  // MOUNTED SPAWN. Task 3 dropped the ragdoll from spawnHeight; Task 4 spawns it
  // already standing on the sphere, so the tracker has something plausible to
  // hold from tick one instead of catching a body mid-fall. spawnHeight no
  // longer applies to this path — it stays in TUNING because the free-drop
  // derivation still reads it when no mount is supplied.
  mountMatrix(motor, animTarget ? animTarget.yaw : 0, _mount);

  const built = buildRagdoll(characterSkeleton, characterRoot, _mount);
  built.group = createRagdollVisuals(built.rig);
  built.characterRoot = characterRoot;

  scene.add(built.group);
  ragdoll = built;

  applyRagdollVisibility(ragdoll, characterRoot);

  // ARM THE COLLIDERS FOR CONTACT-FORCE EVENTS, and index them by handle.
  //
  // The eventThreshold is Rapier's own pre-filter: contacts below it never
  // become events, which keeps the per-step drain to the handful of contacts
  // that could possibly matter instead of every foot resting on the floor.
  impactByHandle.clear();
  for (const [key, item] of ragdoll.rig) {
    item.collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    item.collider.setContactForceEventThreshold(TUNING.impact.eventThreshold);
    impactByHandle.set(item.collider.handle, { key, group: groupByKey.get(key) });
  }

  // The target rig is rebuilt with the fresh RigMap and re-seeded, so the first
  // finite difference after a respawn is zero rather than a teleport-sized
  // velocity spike.
  animTarget = createAnimTarget(characterRoot, characterClips, ragdoll.rig);
  updateAnimTarget(animTarget, motor, ragdoll.rig, loop.fixedDt);
  resetAnimTarget(animTarget);

  const counts = worldCounts();
  console.log(
    `[ragdoll] spawned. world now ${counts.bodies} bodies / ${counts.colliders} colliders / ` +
      `${counts.joints} joints (baseline ${baselineCounts.bodies}/${baselineCounts.colliders}/${baselineCounts.joints})`,
  );
}

/**
 * Puts every bone back to the local transform it had at load. Captured once,
 * before anything posed the skeleton.
 */
let bindLocals = null;
function captureBindPose() {
  bindLocals = characterSkeleton.bones.map((bone) => ({
    bone,
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
    scale: bone.scale.clone(),
  }));
}
function restoreBindPose() {
  for (const entry of bindLocals) {
    entry.bone.position.copy(entry.position);
    entry.bone.quaternion.copy(entry.quaternion);
    entry.bone.scale.copy(entry.scale);
  }
  characterRoot.updateMatrixWorld(true);
}

/**
 * The simulation. Sees only the constant timestep and the integer tick.
 *
 * Order matters: forces are applied, then the world advances once, then the
 * result is snapshotted for interpolation.
 *
 * @param {number} dt
 * @param {number} tick
 */
function fixedUpdate(dt, tick) {
  if (!motor) return;

  // Spawning creates bodies, colliders and joints, so it belongs here and
  // nowhere else. The flag may have been set by a keypress or by the capture
  // seam; either way it is consumed on a tick boundary.
  if (respawnRequested) {
    respawnRequested = false;
    spawnRagdoll();
  }

  // THE OUT-OF-BOUNDS WATCHDOG.
  //
  // A respawn is a SPAWN EVENT, not gameplay. This is the one sanctioned use of
  // setTranslation/setLinvel outside construction, it is unreachable from input,
  // and it must never grow conditions that fire during normal play.
  //
  // It reads only body positions and the tick, so it is deterministic by
  // construction: the same run reaches the same y at the same tick and respawns
  // on the same tick. It lives here, beside the rest of the spawn plumbing,
  // rather than in motor.js, which stays frozen.
  if (motor) {
    const motorY = motor.body.translation().y;
    const pelvis = ragdoll && ragdoll.rig.get('pelvis');
    const pelvisY = pelvis ? pelvis.body.translation().y : Infinity;

    if (motorY < TUNING.arena.killPlaneY || pelvisY < TUNING.arena.killPlaneY) {
      _respawnPoint.set(0, TUNING.motor.spawnY, 0);

      motor.body.setTranslation({ x: _respawnPoint.x, y: _respawnPoint.y, z: _respawnPoint.z }, true);
      motor.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      motor.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      // prev AND curr, so the render does not streak the sphere across the bowl
      // for one frame on its way back to the middle.
      motor.interpolated.reset(_respawnPoint);

      // Consumed just below, on THIS tick, so the character is rebuilt at the
      // mount the sphere has already been moved to.
      respawnRequested = true;
      console.log(`[watchdog] out of bounds — respawned at tick ${tick}`);
    }
  }

  if (knockdownRequested) {
    knockdownRequested = false;
    queueKnockdown(tracker);
  }

  // Consumed exactly once per step, and cleared whether or not it fires.
  const jumpQueued = consumeJump();

  // ORDER. Task 3's save/step/snapshot bracket is preserved exactly: curr goes
  // to prev BEFORE anything moves, and curr is rewritten AFTER the world steps.
  // Task 4 inserts the target and the tracker between the motor and the step,
  // because both only apply forces and every force has to land before the one
  // stepPhysics() that consumes them.
  saveRagdollPrevious(ragdoll);

  // DRIVE ATTENUATION. tracker.weight squared: a stumbling athlete steers, a
  // downed one does not. RULING 6.1 — this scales torque, never velocity.
  const driveScale = tracker.weight * tracker.weight;

  updateMotor(motor, input, jumpQueued, dt, driveScale);
  if (ragdoll) updateAnimTarget(animTarget, motor, ragdoll.rig, dt);
  applyTracking(tracker, ragdoll && ragdoll.rig, animTarget, motor, dt);

  stepPhysics();

  // Impacts are read from the step just taken and spent on the SAME tick, so a
  // hit and its cost are never a frame apart. The queue auto-drains at the next
  // step, so anything not taken here is gone — an impact belongs to its tick.
  if (ragdoll) {
    impactEvents.length = 0;
    drainContactForces((handle1, handle2, totalForce) => {
      // The sphere is not in the ragdoll's collision set at all (Task 4.1), so
      // the permanent mount contact cannot appear here — measured across four
      // calibration regimes, zero ragdoll-vs-sphere events. No exclusion needed.
      const hit = impactByHandle.get(handle1) || impactByHandle.get(handle2);
      if (hit) impactEvents.push({ key: hit.key, group: hit.group, force: totalForce });
    });
    applyImpacts(tracker, impactEvents, tick, dt);
  }

  syncMotorSnapshot(motor);
  snapshotRagdoll(ragdoll);

  // Once a second. A non-finite transform propagates through the joint graph in
  // a few steps and then the character disappears with no other symptom, so the
  // first body to go bad is worth naming.
  if (ragdoll && tick % TUNING.loop.fixedHz === 0) {
    const bad = findNonFinite(ragdoll);
    if (bad) console.error(`[ragdoll] non-finite transform on "${bad}" at tick ${tick}`);
  }
}

/**
 * Moves the camera and its orbit target by the same delta, so the sphere stays
 * framed while the user's orbit offset — distance, azimuth, elevation — is left
 * exactly as they set it.
 *
 * STRICTLY READ-ONLY with respect to the simulation. It reads the sphere's
 * INTERPOLATED position, which is a render-side value, and writes only the
 * camera and the OrbitControls target. Nothing here can influence a body, so
 * the anchored capture stays a pure function of the tick: at a given tick the
 * sphere is where it is, and the camera is therefore where it is.
 */
function followSphere() {
  if (!TUNING.camera.follow || !motor) return;

  _followDelta.subVectors(motor.mesh.position, controls.target);
  controls.target.add(_followDelta);
  camera.position.add(_followDelta);
}

/**
 * The render pass. Strictly read-only with respect to simulation state.
 *
 * It writes exactly three things:
 *   1. position / quaternion on registered Object3Ds, only via apply();
 *   2. the camera transform, via OrbitControls.update();
 *   3. HUD text, via textContent.
 *
 * @param {number} alpha
 */
function render(alpha) {
  if (motor) motor.interpolated.apply(alpha);
  syncRagdollPose(ragdoll, alpha);
  followSphere();
  controls.update();
  renderer.render(scene, camera);
  updateHud();
}

const loop = new Loop({ fixedUpdate, render });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * Loads the character and audits its skeleton. The two SkinnedMeshes share ONE
 * skeleton, so the rig is derived from that skeleton once and posing it poses
 * both meshes.
 *
 * updateMatrixWorld(true) is called here, once, immediately after the load and
 * before anything measures anything. Every world-space read in autorig.js
 * depends on it, and the armature's 0.01 scale means a stale matrix does not
 * produce a small error, it produces a 100x one.
 */
async function loadCharacter() {
  const gltf = await new GLTFLoader().loadAsync(CHARACTER_URL);

  characterRoot = gltf.scene;
  characterRoot.updateMatrixWorld(true);

  let skinned = null;
  characterRoot.traverse((object) => {
    if (object.isSkinnedMesh && !skinned) skinned = object;
    if (object.isSkinnedMesh || object.isMesh) object.frustumCulled = false;
  });

  if (!skinned) throw new Error(`[character] ${CHARACTER_URL} contains no SkinnedMesh`);

  characterSkeleton = skinned.skeleton;
  characterClips = gltf.animations;
  captureBindPose();

  scene.add(characterRoot);
  console.log(
    `[character] loaded ${CHARACTER_URL}: ${characterSkeleton.bones.length} joints, ` +
      `${gltf.animations.length} clips present and untouched in this task`,
  );
}

async function boot() {
  await initPhysics(loop.fixedDt);

  const arena = createArena();
  scene.add(arena.group);

  motor = createMotor();
  // Construction-time, next to the collider it edits: the character rides the
  // sphere through tracking forces, not through contact, and its legs straddle
  // the ball by construction. See detachMotorFromRagdoll.
  detachMotorFromRagdoll(motor);
  scene.add(motor.mesh);
  motor.mesh.visible = TUNING.debug.showSphereWireframe;

  loop.register(motor.interpolated);

  initInput();
  // Sampled once per rendered frame, before that frame's steps drain, so every
  // step in the frame consumes an identical snapshot.
  loop.onFrame(() => sampleInput(camera));

  applyViewportSize();
  applyCameraTuning();

  // Baseline BEFORE any ragdoll exists: the arena body plus the motor body, and
  // their colliders. Spam-respawn has to come back to exactly this.
  baselineCounts = worldCounts();
  console.log(
    `[ragdoll] baseline ${baselineCounts.bodies} bodies / ${baselineCounts.colliders} colliders / ` +
      `${baselineCounts.joints} joints`,
  );

  // The character is optional scenery as far as the sphere motor is concerned.
  // If it fails to load, Task 2's scene must still run — so this is caught here
  // rather than allowed to take the whole boot down.
  try {
    await loadCharacter();
    // MOUNTED FROM THE START. Task 3 waited for R because the ragdoll had
    // nowhere to be; now it has a mount, so it takes it. R still respawns, at
    // that same mount.
    requestRagdollSpawn();
  } catch (error) {
    console.error('[character] load failed; the sphere motor scene continues without it', error);
  }

  installRespawnHotkey();

  initCapture({
    renderer,
    scene,
    camera,
    loop,
    restoreViewport: applyViewportSize,
    poseCharacter: (alpha) => syncRagdollPose(ragdoll, alpha),
    requestRagdollSpawn,
  });

  createGui({
    onShowHudChange: setHudVisible,
    onShowSphereWireframeChange: (visible) => {
      motor.mesh.visible = visible;
    },
    onCameraChange: applyCameraTuning,
    onRagdollVisibilityChange: () => applyRagdollVisibility(ragdoll, characterRoot),
    clipNames: characterClips.map((clip) => clip.name),
    tracker,
  });

  setHudVisible(TUNING.debug.showHud);

  console.log(
    `[arena] bowl built: ${arena.triangleCount} collider triangles ` +
      `(${arena.degenerateCount} degenerate lathe-pole triangles removed)`,
  );

  loop.start();
}

boot().catch((error) => {
  console.error('[boot] failed', error);
});
