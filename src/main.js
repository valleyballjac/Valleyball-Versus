import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { TUNING } from './config/tuning.js';
import { Loop } from './core/Loop.js';
import {
  initPhysics, stepPhysics, getWorld, drainContactForces, RAPIER,
  ENVIRONMENT_MEMBERSHIP, ENVIRONMENT_RAY_GROUPS,
} from './sim/physics.js';
import { createArena } from './sim/arena.js';
import {
  createMotor, updateMotor, syncMotorSnapshot, horizontalSpeed, applyDiveImpulse,
} from './sim/motor.js';
import {
  createAnimTarget,
  updateAnimTarget,
  resetAnimTarget,
  mountMatrix,
  weightAudit,
  strafeSignViolation,
  flailViolation,
  clipResolvesOnSkeleton,
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
import { applyClampedLinearDamping } from './sim/damping.js';
import { input, initInput, sampleInput, consumeJump, consumeDive } from './input.js';
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

/** The axis the gamepad orbit's azimuth turns about. */
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * The collision group layout now lives in sim/physics.js, because the motor's
 * ground fan needs the same filter word and motor.js cannot import this file.
 * The arena's membership is still stamped on HERE — arena.js is frozen — which
 * is why the membership constant is imported rather than just the ray word.
 */

/** Reused ray + scratch for the two environment probes. Allocation-free. */
let _envRay = null;
const _rayFrom = { x: 0, y: 0, z: 0 };
const _rayDir = { x: 0, y: 0, z: 0 };
// The spring arm's own scratch lives beside the rig, further down.

/**
 * Mount-hold gates that are not feel knobs and must not become sliders.
 *
 * pelvisDownness past this means the pelvis is genuinely on the floor rather
 * than dipped; the speed gate means the drag has already done its work and the
 * ball is no longer travelling. Both are statements about when the hold is SAFE, not
 * about how it should feel, so they live here beside the ruling rather than in
 * TUNING where a slider would invite tuning an invariant. Both were relaxed for
 * Task 7 (0.8 -> 0.7, 0.2 -> 0.5) so the held window opens while the weight
 * gate is still open — see the measured table at the constraint itself.
 */
/**
 * How far the pelvis must have dropped before the sphere starts following it.
 *
 * EARLY, BUT ABOVE THE NOISE FLOOR. The follower is continuous and converges on
 * its own, so engaging while the character is still going down is what lets the
 * sphere travel WITH the body instead of chasing it afterwards — the old gates
 * waited for the body to be flat and stopped, which is precisely the moment the
 * sphere was furthest away.
 *
 * But not arbitrarily early. A character standing normally on the mount used to
 * sit at ~0.06 here, because the pelvis rests a little under the nominal
 * standing height — so a gate of 0.05 was BELOW the resting value and the
 * follower engaged during ordinary play whenever the weight dipped. Caught in
 * the determinism pair: the anchored capture logged the follower running at
 * tick 55 while the character was simply settling onto its mount at spawn.
 * That is the "unexplained movement" class of bug in miniature.
 *
 * The resting value is a clean 0 now that the measurement spans the reachable
 * range, so 0.25 has more margin than it was designed with, not less.
 *
 * IT READS pelvisDownness, NOT standUpNeed, and that distinction is the whole
 * reason the two exist separately. standUpNeed is now the tracker's recovery
 * ramp — and mount recovery's two conditions are supposed to be INDEPENDENT
 * evidence that tracking has failed. Pointing this gate at a weight-derived
 * number would make it "weight is low AND weight is low", which is one
 * condition wearing two hats. RULING GF-1.4 stands: this reads sim state only,
 * and it stays unreachable while tracking is healthy.
 */
const MOUNT_FOLLOW_STAND_NEED = 0.25;
/** How far above the pelvis the floor ray starts, and how far it reaches. */
const MOUNT_RAY_LIFT = 2.0;
const MOUNT_RAY_LENGTH = 20;
/** Tick of the last mount-hold log line, for the once-a-second throttle. */
let lastMountLogTick = -1e9;
/** Floor height under the pelvis this step, or NaN. Shared, cast once. */
let pelvisFloorY = NaN;
/** Consecutive ticks the ground fan has reported contact. Mechanics counter. */
let groundedRun = 0;
/** Scratch for the limp brake's relative velocity. */
const _limpVel = new THREE.Vector3();
/** Slack on the weight-sum assertion, for the easings' floating-point residue. */
const WEIGHT_SUM_TOLERANCE = 1e-3;
/** Below this the slide has run out of speed and ends on its own. */
// SLIDE_STOP_SPEED moved to TUNING.action.stopSpeed — it is a feel number and
// it was half of the early-knockdown complaint, so it belongs on a slider.
/** Stick magnitude past which the dive follows input rather than the facing. */
const DIVE_INPUT_DEADZONE = 0.3;

/**
 * Served straight out of public/. Not a tunable: it is the asset's identity.
 *
 * YBOT15Animations.glb REPLACED character.glb as the character asset. It is not
 * a different character: skeleton node names, skin joint list, inverse bind
 * matrices, mesh geometry, materials and the scene graph are byte-identical to
 * character.glb, as are all 13 clips it already carried. It adds exactly two —
 * "Running Dive" and "Slide Left" — which is why the switch is safe: the
 * auto-rigger derives every collider from the bind pose, and a bind pose that
 * cannot move cannot move the colliders. character.glb is kept on disk as the
 * predecessor; nothing loads it.
 */
const CHARACTER_URL = '/models/YBOT15Animations.glb';
/** OPTIONAL. Absent today; extra clips beyond the character asset go here. */
const ACTIONS_URL = '/models/actions.glb';

/** Scratch for the mount transform. Built fresh on every spawn. */
const _mount = new THREE.Matrix4();
/** Scratch for the watchdog respawn point. */
const _respawnPoint = new THREE.Vector3();
/** Scratch for the mount-recovery snap point. */
const _mountPoint = new THREE.Vector3();

// Degrees between the pelvis body's own up axis and world up. The armature is
// Z-up inside a Y-up root, so the spine runs along the body frame's +Y — see
// hipsAxisRoles in animtarget.js for where that fact is derived.
const _jBind = new Map();
const _jA = new THREE.Quaternion();
const _jB = new THREE.Quaternion();
const _jRel = new THREE.Quaternion();
const _jDelta = new THREE.Quaternion();
const _jAxis = new THREE.Vector3();
const _jVec = new THREE.Vector3();
const _tiltQuat = new THREE.Quaternion();
const _tiltAxis = new THREE.Vector3();
const pelvisTilt = (q) => {
  _tiltQuat.set(q.x, q.y, q.z, q.w);
  _tiltAxis.set(0, 1, 0).applyQuaternion(_tiltQuat);
  return (Math.acos(Math.max(-1, Math.min(1, _tiltAxis.y))) * 180) / Math.PI;
};

/** Set by "T", consumed at the top of the next fixed step. */
let knockdownRequested = false;

/**
 * THE TWO ACTIONS, as mechanics accumulators and latches (RULING GF-2.0).
 *
 * None of these is a character state and nothing branches on "which action are
 * we in": they are a tick counter, a latch and a recorded tick, of exactly the
 * same class as jumpQueued and motor.lastJumpTick. Both actions resolve into
 * the ONE blend weight through queueKnockdown — there is no second way to be
 * knocked down and no separate recovery path for either.
 */
/** Ticks since the current slide began; 0 means no slide is running. */
let slideTime = 0;
/** True between a dive firing and its crash. Consumed by the grounded edge. */
let divePending = false;
/** Ticks of the last dive, for the cooldown. -Infinity means "never". */
let lastDiveTick = -Infinity;
/** Tick the dive's stun expires on. The recovery ramp is held off until then. */
let diveStunUntil = -Infinity;
/** For the dive's crash: grounded on the previous step. Mechanics edge. */
let prevGrounded = true;
/** Scratch for the dive direction. */
const _diveDir = new THREE.Vector3();

/** Extra clips from the optional actions.glb, empty if it is not there. */
let actionClips = [];

/** Last computed resistance multiplier, for the HUD. Never fed back in. */
let lastResistanceScale = 1;

/**
 * Hermite smoothstep on [0, 1], clamped. Local because it is used in exactly
 * one place and a shared maths module for one curve is a module nobody reads.
 *
 * The reason the drag uses a smoothstep rather than a threshold is that a
 * threshold would be a state: the ball would behave one way on one side of a
 * number and another way on the other, and a weight hovering near it would
 * chatter between the two. A smoothstep has zero derivative at both ends, so
 * the drag arrives and leaves without a seam.
 */
function smoothstep01(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

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

/**
 * THE SPRING ARM — the one and only owner of the camera.
 *
 * OrbitControls is gone: import, instance, its target, its update, and the
 * follow function that used to shove that target around. Three things all
 * believed they owned the camera transform, and the order they ran in was the
 * only thing keeping them from fighting. Now there is one rig, three numbers,
 * and one place that turns them into a transform.
 *
 * All three are RENDER-SIDE state. The simulation never reads them; it reads
 * the camera's heading once per frame through input.cameraYaw and through
 * nothing else (LAW L6).
 */
const cameraRig = {
  // Seeded to reproduce roughly the old three-quarter view: behind the
  // character looking along +Z, tilted down.
  azimuth: 0,
  pitch: 0.62,
  // Seeded at radius so the first frame opens at the resting distance rather
  // than springing out from the character's chest.
  currentDistance: TUNING.camera.radius,
};

const _camTarget = new THREE.Vector3();
const _camOffset = new THREE.Vector3();
const _camDir = new THREE.Vector3();

/** Applied at boot and from the GUI. Never from the render pass. */
function applyCameraTuning() {
  camera.fov = TUNING.camera.fov;
  camera.updateProjectionMatrix();
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
const hudDirection = document.getElementById('hud-direction');
const hudLocalVel = document.getElementById('hud-localvel');
const hudSprint = document.getElementById('hud-sprint');
const hudAirborne = document.getElementById('hud-airborne');
const hudImpact = document.getElementById('hud-impact');
const hudStandUp = document.getElementById('hud-standup');
const hudDrag = document.getElementById('hud-drag');
const hudLoco = document.getElementById('hud-loco');
const hudArm = document.getElementById('hud-arm');
const hudAction = document.getElementById('hud-action');
const hudShares = document.getElementById('hud-shares');

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
    ? `${animTarget.gait.idle.toFixed(2)} ${animTarget.gait.walk.toFixed(2)} ` +
      `${animTarget.gait.run.toFixed(2)} ${animTarget.gait.sprint.toFixed(2)}`
    : '—';
  hudDirection.textContent = animTarget
    ? animTarget.direction.map((d) => d.toFixed(2)).join(' ')
    : '—';
  // Velocity in the character's OWN frame: +Z is where it is pointing, +X its
  // right. This is the number to watch while checking a strafe — a pure strafe
  // reads as vz near zero and vx at the ground speed.
  hudLocalVel.textContent = animTarget
    ? `${animTarget.localVelX.toFixed(2)} / ${animTarget.localVelZ.toFixed(2)}`
    : '—';
  // Input state, read straight off the latched frame snapshot.
  hudSprint.textContent = input.sprintHeld ? 'SPRINT' : '—';
  // air / phase / latched clip mix (1.00 = standing jump, 0.00 = running).
  hudAirborne.textContent = animTarget
    ? `${animTarget.airborneMix.toFixed(2)} / ${animTarget.jumpPhase.toFixed(2)} / ${animTarget.jumpClipMix.toFixed(2)}`
    : '—';
  hudDrag.textContent = lastResistanceScale.toFixed(2);
  // The spring arm: distance / azimuth / pitch. Criterion 2 watches the
  // distance return to exactly TUNING.camera.radius with no residue.
  hudArm.textContent =
    `${cameraRig.currentDistance.toFixed(3)} / ${cameraRig.azimuth.toFixed(2)} / ${cameraRig.pitch.toFixed(2)}`;

  // slideTime in ticks / divePending / dive cooldown remaining in ticks.
  const diveReady = Math.max(0, TUNING.action.diveCooldownTicks - (loop.tick - lastDiveTick));
  hudAction.textContent = `${slideTime} / ${divePending ? 'DIVE' : '—'} / cd ${
    Number.isFinite(diveReady) ? Math.round(diveReady) : 0
  }`;

  // The four override shares, in precedence order: stand-up, action, air, loco.
  // READ from the ghost, never recomputed here. This row used to carry its own
  // copy of the tier arithmetic, and when the tiers were reordered the copy was
  // left behind — it reported a held slide as 62% stand-up while the mixer was
  // giving the stand-up nothing at all.
  if (animTarget) {
    const sh = animTarget.shares;
    hudShares.textContent =
      `${sh.stand.toFixed(2)} ${sh.action.toFixed(2)} ${sh.air.toFixed(2)} ${sh.loco.toFixed(2)}`;
  } else {
    hudShares.textContent = '—';
  }
  // The locomotion group's share. Criterion 3 watches this go to ~0 in flight.
  hudLoco.textContent = animTarget
    ? animTarget.shares.loco < 0.005
      ? '0.00'
      : animTarget.shares.loco.toFixed(2)
    : '—';

  // Tick-stamped, so the fade is sim time. A wall-clock timer here would make
  // the HUD a function of frame pacing.
  const age = loop.tick - tracker.lastImpactTick;
  hudImpact.textContent =
    tracker.lastImpactKey && age <= TUNING.impact.hudHoldTicks
      ? `${tracker.lastImpactKey} ${Math.round(tracker.lastImpactExcess)}`
      : '—';

  hudStandUp.textContent = animTarget
    ? `${animTarget.standUpNeed.toFixed(2)} / ${animTarget.standUpProgress.toFixed(2)} / ${animTarget.pelvisDownness.toFixed(2)}`
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
  updateAnimTarget(animTarget, motor, ragdoll.rig, input.cameraYaw, false, NaN, true, loop.fixedDt);
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
 * THE ORDERING, in full, because several steps only work in this order:
 *
 *   1. respawn        — creates bodies/colliders/joints; must precede any read
 *                       of the rig.
 *   2. watchdog       — SPAWN EVENT. Reads body positions only.
 *   3. mount recovery — SPAWN EVENT. Must run BEFORE the ghost updates, so the
 *                       ghost's mount and its mountSlack easing see the snapped
 *                       sphere on the SAME step. Run after, and the ghost spends
 *                       a step reaching for where the sphere used to be and the
 *                       stand-up starts with a backward lurch.
 *   4. knockdown      — consumes the T flag onto this tick.
 *   5. jump consume   — clears the queued press whether or not it fires.
 *   6. saveRagdollPrevious — curr -> prev BEFORE anything moves.
 *   7. updateMotor    — applies drive/brake/jump forces; may set lastJumpTick.
 *   8. liftoff edge   — read from lastJumpTick CHANGING across step 7.
 *   9. updateAnimTarget — the ghost, which consumes that edge and the latched
 *                       camera yaw.
 *  10. applyTracking  — PD forces toward the ghost.
 *  11. stepPhysics    — the ONE world step; every force above lands in it.
 *  12. impacts        — drained from the step just taken, spent on this tick.
 *  13. snapshots      — curr rewritten AFTER the world moved.
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

  // ═══ THE MOUNT HOLD ═══
  //
  // RULING GF-1.4 — this is the third member of the sanctioned spawn-event
  // family (spawn, watchdog, mount hold). Conditions read only sim state; it is
  // unreachable while tracking is healthy; it must never gain a code path
  // driven by input or animation.
  //
  // WHY THIS IS A HELD CONSTRAINT AND NOT AN EVENT, which is the whole of the
  // redesign. It was written twice as an edge — "when these four things become
  // true, snap once" — and it never fired either time, for a reason that is
  // obvious in hindsight and was invisible in the code: the four gates are
  // driven by processes running at completely different rates, and their open
  // windows did not overlap. Measured in GF-2, on a sprint knockdown:
  //
  //     weight < gate      ticks   0..28     (recovery ramp, 0.3/s)
  //     standUpNeed > gate ticks  57..103    (pelvis ease, 6/s)
  //     sphere at rest     ticks  48..419    (the knockdown drag)
  //     separated          ticks  12..159
  //
  // Three of four held together for a 47-tick stretch and the fourth had closed
  // 29 ticks earlier. There is no edge to catch there. Asking instead "is the
  // character down RIGHT NOW, and if so put the ball under it" has no timing to
  // miss: it is a condition evaluated every step, and it re-asserts itself for
  // as long as the answer is yes.
  //
  // The consequence is the point. The sphere sits under the pelvis for the
  // ENTIRE down period, so when the ghost's mountSlack easing hands the mount
  // back and the stand-up plays, it pulls STRAIGHT UP — the character never
  // travels toward the sphere, because the sphere was never anywhere else.
  // THE FLOOR UNDER THE PELVIS, cast once per step and used twice: by the mount
  // hold for the sphere's height, and by the ghost's standUpNeed for the
  // character's height above the surface rather than above y = 0. One ray, in
  // the file that already owns the environment-only filter.
  pelvisFloorY = NaN;
  if (ragdoll) {
    const pelvisItem = ragdoll.rig.get('pelvis');
    if (pelvisItem) {
      const p = pelvisItem.body.translation();
      if (!_envRay) _envRay = new RAPIER.Ray(_rayFrom, _rayDir);
      _rayFrom.x = p.x; _rayFrom.y = p.y + MOUNT_RAY_LIFT; _rayFrom.z = p.z;
      _rayDir.x = 0; _rayDir.y = -1; _rayDir.z = 0;
      const probe = getWorld().castRay(
        _envRay, MOUNT_RAY_LENGTH, true, undefined, ENVIRONMENT_RAY_GROUPS,
      );
      if (probe) pelvisFloorY = _rayFrom.y - probe.timeOfImpact;
    }
  }

  if (motor && ragdoll && animTarget) {
    const pelvisItem = ragdoll.rig.get('pelvis');
    if (pelvisItem) {
      const pelvis = pelvisItem.body.translation();
      const sphere = motor.body.translation();

      // DETACHED: the character has lost its footing. One condition, evaluated
      // every step, with no edge to catch and no second mode. During healthy
      // play the weight sits at 1 and this is never true.
      const detached =
        tracker.weight < TUNING.impact.mountRecoverBelow &&
        animTarget.pelvisDownness > MOUNT_FOLLOW_STAND_NEED;

      const separation = Math.hypot(pelvis.x - sphere.x, pelvis.z - sphere.z);

      if (detached && separation > TUNING.impact.mountSnapEpsilon) {
        if (!Number.isFinite(pelvisFloorY)) {
          // Should be impossible inside the bowl. NEVER GUESS A Y.
          console.warn(
            `[mount] floor ray found nothing under the pelvis at tick ${tick}; follow skipped`,
          );
        } else {
          // ── THE STEP THE SPHERE TAKES THIS TICK ──
          //
          // Speed proportional to the gap and CAPPED. Close in it is an
          // exponential ease that settles without overshoot; far out it is a
          // constant-speed chase whose per-step displacement can never exceed
          // mountFollowSpeed * dt — about 0.2 m, which is what the ball covers
          // in one step at a sprint. That cap is the whole reason this is
          // smooth: the displacement is ordinary motion as far as the renderer
          // is concerned, so prev/curr interpolate it like any other movement.
          const gapX = pelvis.x - sphere.x;
          const gapZ = pelvis.z - sphere.z;
          const targetY = pelvisFloorY + TUNING.motor.radius;
          const gapY = targetY - sphere.y;

          const pull = Math.min(
            TUNING.impact.mountFollowSpeed,
            TUNING.impact.mountFollowRate * separation,
          );
          let move = Math.min(separation, pull * dt);

          // ── THE WALL CLAMP ──
          //
          // The sphere is being moved by fiat rather than by the solver, so
          // nothing stops it entering geometry on the way. A ray along the
          // step, environment-only, stops it short of anything in the path.
          // The bowl's interior is convex so a segment between two interior
          // points stays inside it and this rarely fires today — it is here for
          // the first obstacle that lands in the arena, and it costs one ray
          // only on the steps where the follower is actually moving.
          const invSep = 1 / separation;
          const dirX = gapX * invSep;
          const dirZ = gapZ * invSep;

          if (!_envRay) _envRay = new RAPIER.Ray(_rayFrom, _rayDir);
          _rayFrom.x = sphere.x; _rayFrom.y = sphere.y; _rayFrom.z = sphere.z;
          _rayDir.x = dirX; _rayDir.y = 0; _rayDir.z = dirZ;
          const reach = move + TUNING.motor.radius;
          const blocked = getWorld().castRay(
            _envRay, reach, true, undefined, ENVIRONMENT_RAY_GROUPS,
          );
          if (blocked) {
            move = Math.max(0, Math.min(move, blocked.timeOfImpact - TUNING.motor.radius));
          }

          // ── PLACE IT, AND LEAVE THE VELOCITY ALONE ──
          //
          // The velocity is deliberately NOT zeroed. Zeroing it was half of the
          // old glitch: it made the sphere stop dead while the ragdoll carried
          // on, so the two were forever being yanked back together. Left alone,
          // the sphere keeps its momentum and sheds it through the knockdown
          // drag on the ordinary clamped path, while this correction closes
          // whatever gap the drag has not. Two forces that agree, instead of a
          // teleport fighting a body.
          //
          // And NO motor.interpolated.reset(). That call is for a genuine
          // teleport — the watchdog — and calling it here every step was the
          // render stutter: it collapses prev onto curr, so the frame shows the
          // sphere at its new position with no interpolation, sixty times a
          // second. The loop already saved prev at the top of this frame and
          // syncMotorSnapshot writes curr after the step; a bounded displacement
          // between them is exactly what the interpolation contract is for.
          _mountPoint.set(
            sphere.x + dirX * move,
            sphere.y + gapY * Math.min(1, TUNING.impact.mountFollowRate * dt),
            sphere.z + dirZ * move,
          );
          motor.body.setTranslation(
            { x: _mountPoint.x, y: _mountPoint.y, z: _mountPoint.z },
            true,
          );

          if (tick - lastMountLogTick >= TUNING.loop.fixedHz) {
            lastMountLogTick = tick;
            console.log(
              `[mount] following pelvis (tick ${tick}, d=${separation.toFixed(3)}, ` +
                `step=${move.toFixed(3)} m)`,
            );
          }
        }
      }
    }
  }

  if (knockdownRequested) {
    knockdownRequested = false;
    queueKnockdown(tracker);
  }

  // Consumed exactly once per step, and cleared whether or not they fire.
  const jumpQueued = consumeJump();
  const diveQueued = consumeDive();

  // ═══ THE SLIDE ═══
  //
  // No motor code at all: the slide is expressed entirely through the two scale
  // parameters updateMotor already takes. driveScale 0 kills steering, and
  // slideResistance MULTIPLIES the existing braking path, so the sphere coasts
  // and bleeds speed through the same L3-clamped helper as every other braking
  // impulse. Nothing new damps anything.
  const speedNow = horizontalSpeed(motor);
  const startingSlide =
    slideTime === 0 &&
    input.slideHeld &&
    motor.grounded &&
    speedNow > TUNING.action.minSlideSpeed;

  if (startingSlide) slideTime = 1;
  else if (slideTime > 0) slideTime += 1;

  if (slideTime > 0) {
    // COMMITTED BRIEFLY. For minSlideTicks the slide runs whether or not the
    // button is still down, so a tap is a real slide instead of a flicker.
    const committed = slideTime <= TUNING.action.minSlideTicks;

    // TWO WAYS OUT, AND NO TIMER. There used to be a third — slideTime past
    // maxSlideTicks called queueKnockdown — and it was the dominant one: 45
    // ticks is 0.75 s, which a slide entered at 5 m/s never survives, so every
    // fast slide ended on the floor and (with the button still held) rolled
    // straight into a second slide that was knocked down as well. Traced at
    // 5.38 m/s with weight dropping 1.00 -> 0.01 on the cutoff tick.
    //
    // A slide is now ended by the player letting go, or by running out of
    // momentum. Neither costs weight. How LONG a slide lasts is decided by
    // slideResistance bleeding speed down to stopSpeed — a physical answer to
    // a physical question, and a slider if it wants shortening.
    if (!committed && !input.slideHeld) {
      // Released after the commitment window: control returns, weight intact.
      slideTime = 0;
    } else if (input.slideHeld && speedNow < TUNING.action.knockdownSpeed) {
      // RODE IT INTO THE GROUND. Still holding the button with the momentum
      // spent: the commitment is what is being paid for, so this resolves into
      // the ordinary knockdown chain — same weight, same drag, same stand-up.
      //
      // NOT the old maxSlideTicks timer wearing a new hat. That fired on a
      // clock and cut a 5 m/s slide off mid-flight; this fires on the athlete
      // having nothing left, which is a thing the player can see coming and
      // avoid by letting go. Releasing above knockdownSpeed always costs
      // nothing, at any point past minSlideTicks.
      slideTime = 0;
      queueKnockdown(tracker);
    } else if (speedNow < TUNING.action.stopSpeed) {
      // SLID TO A STOP WITH THE BUTTON ALREADY RELEASED (inside the commitment
      // window, or the frame after a release). Ends the slide and nothing else.
      slideTime = 0;
    }
  }
  const sliding = slideTime > 0;

  // ═══ THE DIVE ═══
  if (diveQueued && motor.grounded && tick - lastDiveTick >= TUNING.action.diveCooldownTicks) {
    const magnitude = Math.hypot(input.moveWorld.x, input.moveWorld.z);
    if (magnitude > DIVE_INPUT_DEADZONE) {
      _diveDir.set(input.moveWorld.x / magnitude, 0, input.moveWorld.z / magnitude);
    } else {
      _diveDir.set(Math.sin(input.cameraYaw), 0, Math.cos(input.cameraYaw));
    }
    applyDiveImpulse(motor, _diveDir);

    // THE DIVE NO LONGER GOES LIMP ON LIFTOFF, and nothing writes velocity into
    // the sixteen ragdoll bodies any more.
    //
    // Both of those were the same idea — hand the body to the physics and let
    // it fly — and the idea was wrong twice over. At weight 0 the athlete has
    // no pose to hold, so the superman collapsed into a ball the moment he left
    // the ground and the whole point of having a dive clip was lost; and with
    // the tracker off, the only way to make the body follow the sphere was to
    // push each limb by hand, which is the motor's job done sixteen times in a
    // place the laws do not cover.
    //
    // Weight stays where it is. The tracker carries the whole athlete along the
    // mount, rigid, in the pose the ghost is holding — the dive is a POSE the
    // player commits to, not a loss of control — and he stays that way through
    // the flight and the skid. The collapse still happens; it happens at the
    // END, where the momentum runs out, and that is the only place it happens.
    divePending = true;
    lastDiveTick = tick;
    // The one place the dive scrub is re-seeded, on the edge that starts one —
    // the same treatment startingSlide gives slidePhase.
    if (animTarget) animTarget.divePhase = 0;
    const _lv = motor.body.linvel();
    console.log(
      `[dive] launched at tick ${tick} — sphere ${speedNow.toFixed(2)} m/s horizontal, ` +
        `vy ${_lv.y.toFixed(2)} m/s after the impulse (mass ${motor.body.mass().toFixed(3)} kg)`,
    );
  }

  // THE GROUNDED DIVE IS A SLIDE. Same shape, same exit, one number apart.
  //
  // Once he is back on the floor with the dive latch still up, the momentum is
  // the mechanic: driveScale is dead, the slide's resistance bleeds the speed,
  // and the ghost holds the dive pose while it happens. Riding it down to
  // knockdownSpeed is what finally puts him on the floor — the same condition
  // as the held slide, the same tunable, and the muscle tone the crash was
  // always meant to land with.
  //
  // THE GATE READS THE ATHLETE, NOT THE SPHERE, and it has to. In a slide the
  // two are one number; in a dive he is prone and extended ahead of the mount,
  // the tracker's linear impulse is clamped, and the sphere is being braked by
  // rollingResistance AND (stick neutral, mid-dive) brakeTorque while the body
  // is braked only by its own colliders on the floor. Measured: sphere 10.7
  // m/s^2 against pelvis 7.1, and reading the sphere collapsed him at 3.9 m/s —
  // a limp tumble in the middle of a skid that was still going. Reading the
  // pelvis is the same class of query as motor.grounded: sim state, read never
  // written, and it is the number the sentence "he ran out of momentum" is
  // actually about.
  const diveSkidding = divePending && motor.grounded;
  const divePelvis = ragdoll && ragdoll.rig.get('pelvis');
  let athleteSpeed = speedNow;
  if (divePelvis) {
    const v = divePelvis.body.linvel();
    athleteSpeed = Math.hypot(v.x, v.z);
  }

  // THE LANDING IS THE EDGE, and it is the only place the dive costs weight.
  //
  // Rigid all the way down — that is what holds the superman against gravity —
  // and loose the instant he touches, which is what lets him tumble instead of
  // skidding like a board. crashMuscleTone is now the weight he lands ON rather
  // than a damping floor over zero, so "loose" and "boneless" are different
  // states of the same number and the dive gets the first one.
  if (divePending && motor.grounded && !prevGrounded &&
      tick - lastDiveTick >= TUNING.action.diveLatchMinTicks) {
    queueKnockdown(tracker, TUNING.action.crashMuscleTone);
    // THE STUN STARTS HERE, on the same edge and nowhere else. A recorded tick,
    // of exactly the same class as lastDiveTick and motor.lastJumpTick — not a
    // state, and nothing branches on "are we stunned", it only gates the ramp.
    diveStunUntil = tick + TUNING.action.diveStunTicks;
  }

  // And the pose lets go once the momentum is spent. NO second knockdown here:
  // he is already down. This only hands the tier back to the stand-up.
  if (diveSkidding && tick - lastDiveTick >= TUNING.action.diveLatchMinTicks &&
      athleteSpeed < TUNING.action.knockdownSpeed) {
    divePending = false;
  }

  // THE COOLDOWN IS THE ONLY OTHER WAY OUT, and it is a backstop rather than a
  // mechanic: a dive that somehow never reaches the floor — off the bowl rim,
  // wedged, launched at the sky — must not hold the pose forever.
  //
  // The `tracker.weight > 0.5` early-out that used to sit here is GONE. It read
  // "he is back on his feet, the dive is over", which was true while the dive
  // began with a knockdown; now that weight stays high through the whole dive
  // it would fire on the first tick past diveLatchMinTicks and end every dive
  // before it landed. The skid's own speed test replaces it.
  if (divePending && tick - lastDiveTick >= TUNING.action.diveCooldownTicks) {
    divePending = false;
  }
  prevGrounded = motor.grounded;

  // ORDER. Task 3's save/step/snapshot bracket is preserved exactly: curr goes
  // to prev BEFORE anything moves, and curr is rewritten AFTER the world steps.
  // Task 4 inserts the target and the tracker between the motor and the step,
  // because both only apply forces and every force has to land before the one
  // stepPhysics() that consumes them.
  saveRagdollPrevious(ragdoll);

  // DRIVE ATTENUATION. tracker.weight squared: a stumbling athlete steers, a
  // downed one does not. RULING 6.1 — this scales torque, never velocity.
  const driveScale = tracker.weight * tracker.weight;

  // THE KNOCKDOWN DRAG (GF-1 Part 4A). A sphere whose rider is face down on the
  // floor should not keep rolling as if nothing happened — the body is a
  // hundred and sixty pounds of dead weight ploughing along beside it. This is
  // that, as one multiplier on the braking impulses the motor already applies.
  //
  // NOT A THRESHOLD. The smoothstep is exactly 1 at weight >= dragOnset and
  // climbs from there as the weight craters, so clean play never feels it and a
  // weight hovering near the onset cannot chatter between two behaviours. And
  // because the multiplier lands on the REQUESTED impulse, which then goes
  // through the L3 clamp, a boost of forty cannot reverse the ball — it can
  // only bring it to a stop sooner.
  const resistanceScale =
    1 +
    TUNING.motor.downedDragBoost *
      smoothstep01((TUNING.impact.dragOnset - tracker.weight) / TUNING.impact.dragOnset);
  lastResistanceScale = resistanceScale;

  // ── THE GROUNDED DEBOUNCE ──
  //
  // motor.grounded is the raw ray fan and it can flash true for a single tick
  // when the sphere grazes a steep wall in mid-flight. That one tick was enough
  // to do real damage: airborneMix eases at 18/s, so a single frame of false
  // contact pulls it down by a quarter in one step, and with a jump queued it
  // also let a fresh liftoff register in mid-air and re-latch the clip mix.
  //
  // Asymmetric, deliberately. LEAVING the ground is believed immediately — the
  // character is airborne the instant the rays miss, and delaying that would
  // make jumps feel late. ARRIVING takes groundedDebounceTicks of agreement.
  // The physics still uses the raw flag; this is the animation's view only, so
  // nothing here can change what the motor does.
  groundedRun = motor.grounded ? groundedRun + 1 : 0;
  const stableGrounded = groundedRun >= TUNING.jump.groundedDebounceTicks;

  // ── THE LIMP BRAKE ──
  //
  // While the character is fully limp the tracker's own damping is scaled by
  // the weight and is therefore switched off at exactly the moment the body is
  // sliding across the floor on pure momentum — which is why a dive landing
  // skated like ice. This brakes the ragdoll bodies directly, ramped in over
  // the last tenth of the weight range so nothing steps, and routed through the
  // one L3 clamped helper so it can only cancel motion, never reverse it.
  if (ragdoll && tracker.weight < TUNING.ragdoll.limpBrakeBelow) {
    const limpness = 1 - tracker.weight / TUNING.ragdoll.limpBrakeBelow;
    const request = TUNING.ragdoll.limpBrake * limpness * dt;
    for (const item of ragdoll.rig.values()) {
      const v = item.body.linvel();
      _limpVel.set(v.x, 0, v.z);
      applyClampedLinearDamping(item.body, request * _limpVel.length(), _limpVel, dt);
    }
  }

  // THE LIFTOFF EDGE. motor.js is frozen and reports nothing, so the fact that
  // a jump fired is read from its own lastJumpTick CHANGING across the call —
  // the cooldown path already had to record that tick, so nothing new is
  // stored. This is a mechanics edge of the same class as padJumpWasDown, and
  // it latches a float rather than raising a state flag (RULING GF-2.0).
  const jumpTickBefore = motor.lastJumpTick;
  // STEERING IS DEAD THROUGH BOTH ACTIONS. A slide and a dive are commitments:
  // once either is running the stick stops turning the athlete, which is what
  // makes committing to one a decision rather than a free extra move.
  //
  // THE BRAKING IS GROUNDED-ONLY, and the difference matters. The slide's
  // resistance MULTIPLIES the knockdown drag rather than replacing it, so a
  // slide that ends in a knockdown gets both. Applying it to a dive still in
  // the air would bleed the leap itself — the flight is the mechanic — so the
  // dive only picks it up once it is back on the floor, where it is a skid and
  // wants exactly the slide's braking.
  const actionCommitted = sliding || divePending;
  // SLOPE-AWARE SLIDE DRAG. See the note at slideSlopeRef: the drag is a near
  // constant deceleration, so whether a slope carries the athlete is decided by
  // one comparison, and thinning it while he descends is what lets gravity win
  // there without lengthening the slide on the flat. vy is the sphere's own
  // vertical velocity — sim state, read never written.
  const _slideVy = motor.body.linvel().y;
  const slopeFactor = Math.min(
    TUNING.action.slideSlopeMax,
    Math.max(
      TUNING.action.slideSlopeMin,
      1 + _slideVy / Math.max(1e-3, TUNING.action.slideSlopeRef),
    ),
  );
  const actionResistance = sliding
    ? TUNING.action.slideResistance * slopeFactor
    : diveSkidding
      ? TUNING.action.diveResistance
      : 1;
  updateMotor(
    motor,
    input,
    jumpQueued,
    dt,
    actionCommitted ? 0 : driveScale,
    tick,
    resistanceScale * actionResistance,
  );

  // The two action poses, eased at one rate. main.js owns the mechanics; the
  // ghost owns only how much of the pose each one is.
  if (animTarget) {
    const ease = 1 - Math.exp(-TUNING.action.poseEase * dt);
    // THE RECOVERY CLOCK, handed over the same way slideMix is. The ghost drives
    // the stand-up take off this and not off the pelvis: a scrub anchored to the
    // body cannot haul the body, because the body only moves by being hauled
    // toward the scrub. See advanceStandUp.
    animTarget.recoveryWeight = tracker.weight;
    // Stick magnitude, for the coasting facing check. Handed over rather than
    // read, so the ghost still touches no input of its own.
    animTarget.steerInput = Math.hypot(input.moveWorld.x, input.moveWorld.z);
    animTarget.slideMix += ((sliding ? 1 : 0) - animTarget.slideMix) * ease;
    animTarget.diveMix += ((divePending ? 1 : 0) - animTarget.diveMix) * ease;
    // Phases for real action clips, from the same tick accumulators. A fallback
    // node ignores these and holds the apex pose instead.
    // THE SLIDE PHASE IS A RATCHET WITH A HOLD POINT, not a fraction of a
    // timer — the timer is gone, and a clip scrubbed 0..1 stood the athlete
    // back up while the button was still down. It climbs to slideHoldPhase and
    // stays there for as long as the slide runs; once the slide ends it climbs
    // on to 1 so the take's own recovery plays out under the crossfade.
    //
    // Monotone, and it resets to 0 only where every other one-shot does: at
    // the start of the next slide. This is the same shape as the jump's
    // hold-point ratchet (RULING GF-3.3) and, like it, no boolean of character
    // state exists and nothing branches on which phase of a slide we are in.
    const slideRate = sliding ? TUNING.action.slideEntryRate : TUNING.action.slideExitRate;
    const slideCeiling = sliding ? TUNING.action.slideHoldPhase : 1;
    if (startingSlide) animTarget.slidePhase = 0;
    animTarget.slidePhase = Math.min(slideCeiling, animTarget.slidePhase + slideRate * dt);
    // THE DIVE PHASE IS A HOLD-POINT RATCHET, exactly like the slide's above
    // and the jump's before it. Airborne it climbs to diveHoldPhase — the
    // soaring superman — and stays; on contact it runs on to 1 and the landing
    // plays out under the skid. A linear ramp over a fixed tick count reached
    // the landing pose a third of the way through the flight and dropped the
    // athlete on his face for the rest of it.
    const diveRate = diveSkidding ? TUNING.action.diveLandRate : TUNING.action.diveTakeoffRate;
    const diveCeiling = diveSkidding ? 1 : TUNING.action.diveHoldPhase;
    animTarget.divePhase = Math.min(diveCeiling, animTarget.divePhase + diveRate * dt);
  }
  const liftoff = motor.lastJumpTick !== jumpTickBefore;

  if (ragdoll) {
    updateAnimTarget(
      animTarget, motor, ragdoll.rig, input.cameraYaw, liftoff, pelvisFloorY, stableGrounded, dt,
    );
  }
  
  // THE RECOVERY RAMP IS HELD OFF for two reasons, and they go in through the
  // same door because the tracker only has one. A limp body still sliding fast
  // has not finished falling; and a dive has just been paid for, and the stun
  // is the price. The second is a tick comparison, not a state — the recorded
  // expiry is the same class of thing as lastDiveTick beside it.
  const diveStunned = tick < diveStunUntil;
  const isTumbling = diveStunned || (ragdoll &&
    tracker.weight < TUNING.impact.mountRecoverBelow &&
    Math.hypot(ragdoll.rig.get('pelvis').body.linvel().x, ragdoll.rig.get('pelvis').body.linvel().z) > 2.0);

  applyTracking(tracker, ragdoll && ragdoll.rig, animTarget, motor, dt, isTumbling);

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

    // CRITERION GF-2.5 — the shares and the blend targets must each partition
    // to exactly 1, in every regime. Checked once a second rather than every
    // step: these are invariants of the arithmetic, so if either is going to
    // break it breaks continuously.
    //
    // The APPLIED total is deliberately not asserted — see weightAudit. It is
    // logged instead, at the same cadence, so a real divergence is still
    // visible without a spawn's ease-in raising a false alarm.
    const audit = weightAudit(animTarget);
    if (Math.abs(audit.shares - 1) > WEIGHT_SUM_TOLERANCE ||
        Math.abs(audit.targets - 1) > WEIGHT_SUM_TOLERANCE) {
      console.error(
        `[animtarget] weight partition broken at tick ${tick}: ` +
          `shares ${audit.shares.toFixed(5)}, targets ${audit.targets.toFixed(5)}`,
      );
    }

    // THE STRAFE-SIGN ALARM (GF-3.1). A sign error here is invisible in every
    // number except which clip plays, and it cost a whole task to spot once.
    const strafe = strafeSignViolation(animTarget);
    if (strafe) console.error(`[animtarget] strafe sign wrong at tick ${tick}: ${strafe}`);

    // THE FLAIL ALARM (GF-3.3). Full airborne with the locomotion group still
    // audible means the run blend is driving the arms through the jump.
    const flail = flailViolation(animTarget);
    if (flail !== null) {
      console.error(
        `[animtarget] flail at tick ${tick}: airborneMix ${animTarget.airborneMix.toFixed(2)} ` +
          `but locomotion weight is ${flail.toFixed(3)}`,
      );
    }
  }
}

/**
 * THE SPRING ARM, once per rendered frame.
 *
 * Strictly render-side and read-only with respect to the simulation: it reads
 * the sphere's INTERPOLATED position and the latched input snapshot, and writes
 * the camera transform. Nothing here can influence a body, so the anchored
 * capture stays a pure function of the tick.
 *
 * THE INVARIANT, which is the point of the shape below: in the clear,
 * currentDistance converges to radius. Always. `obstructed` is radius whenever
 * the ray misses, and the ease has no other fixed point, so a stuck-close
 * camera is not a state this rig can represent — there is no residue to
 * accumulate and nothing to reset. The old rig could get stuck because its
 * distance was whatever OrbitControls and the follow had last left it at.
 */
function updateSpringArm() {
  if (!motor) return;
  const world = getWorld();
  if (!world) return;
  if (!_envRay) _envRay = new RAPIER.Ray(_rayFrom, _rayDir);

  const tuning = TUNING.camera;
  const frameDelta = Math.min(loop.frameTimeMs / 1000, TUNING.loop.maxFrameTime);

  // 1 — INPUT. Stick is a RATE (radians per second); mouse is a DISPLACEMENT
  // (pixels already travelled), so only the stick is scaled by frameDelta.
  // Scaling the mouse by it too would make a drag's throw depend on frame rate,
  // which is the classic mouse-sensitivity bug.
  cameraRig.azimuth -= input.lookX * tuning.orbitSpeed * frameDelta;
  cameraRig.azimuth -= input.mouseDX / tuning.mousePixelsPerRadian;
  cameraRig.pitch += input.lookY * tuning.orbitSpeed * frameDelta;
  cameraRig.pitch += input.mouseDY / tuning.mousePixelsPerRadian;
  cameraRig.pitch = Math.min(tuning.maxPitch, Math.max(tuning.minPitch, cameraRig.pitch));

  // 2 — TARGET. The interpolated sphere, lifted to the athlete's chest.
  _camTarget.copy(motor.mesh.position);
  _camTarget.y += tuning.targetHeight;

  // 3 — DESIRED. Spherical, so azimuth and pitch are the state and the offset
  // is derived — rather than the offset being the state and the angles being
  // recovered from it, which is what made the old rig's pitch clamp awkward.
  const cosPitch = Math.cos(cameraRig.pitch);
  _camOffset.set(
    tuning.radius * cosPitch * Math.sin(cameraRig.azimuth),
    tuning.radius * Math.sin(cameraRig.pitch),
    tuning.radius * cosPitch * Math.cos(cameraRig.azimuth),
  );
  _camDir.copy(_camOffset).normalize();

  // 4 — RAY, from the character outward. Environment-only, so it can never hit
  // the character's own sixteen bodies or the sphere.
  _rayFrom.x = _camTarget.x; _rayFrom.y = _camTarget.y; _rayFrom.z = _camTarget.z;
  _rayDir.x = _camDir.x; _rayDir.y = _camDir.y; _rayDir.z = _camDir.z;

  const hit = world.castRay(_envRay, tuning.radius, true, undefined, ENVIRONMENT_RAY_GROUPS);
  const obstructed = hit
    ? Math.max(tuning.minDistance, hit.timeOfImpact - tuning.collisionMargin)
    : tuning.radius;

  // 5 — SPRING. Shorten INSTANTLY: a camera that eases into its limit spends
  // those frames inside the wall, which is the artefact this exists to prevent.
  // Lengthen on the ease, because an instant restore is a visible jump the
  // moment the obstruction clears.
  if (obstructed < cameraRig.currentDistance) {
    cameraRig.currentDistance = obstructed;
  } else {
    cameraRig.currentDistance +=
      (obstructed - cameraRig.currentDistance) * (1 - Math.exp(-tuning.restoreEase * frameDelta));
  }

  // 6 — PLACE.
  camera.position.copy(_camTarget).addScaledVector(_camDir, cameraRig.currentDistance);
  camera.lookAt(_camTarget);
}

/**
 * The render pass. Strictly read-only with respect to simulation state.
 *
 * It writes exactly three things:
 *   1. position / quaternion on registered Object3Ds, only via apply();
 *   2. the camera transform, via the spring arm;
 *   3. HUD text, via textContent.
 *
 * @param {number} alpha
 */
function render(alpha) {
  if (motor) motor.interpolated.apply(alpha);
  syncRagdollPose(ragdoll, alpha);
  updateSpringArm();
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

  await loadActionClips();
  if (actionClips.length) characterClips = characterClips.concat(actionClips);

  scene.add(characterRoot);
  console.log(
    `[character] loaded ${CHARACTER_URL}: ${characterSkeleton.bones.length} joints, ` +
      `${gltf.animations.length} clips present and untouched in this task`,
  );
}

/**
 * THE OPTIONAL ACTION CLIPS.
 *
 * actions.glb is a place to drop FURTHER clips later without reauthoring the
 * character asset, and it does not exist today. The slide and dive now ship in
 * the character asset itself, so its absence is a normal condition, not an
 * error: the fetch failure is caught and logged at info level and the game
 * carries on with whatever the character asset provided.
 *
 * EVERY CLIP IS VALIDATED BEFORE IT IS REGISTERED. A clip whose tracks address
 * bones the ghost does not have is worse than no clip: the mixer binds the
 * tracks it can and silently drops the rest, so the character plays a half
 * animation with the unbound limbs sagging toward bind, and nothing anywhere
 * reports a problem. Checking first turns that into a named rejection.
 */
async function loadActionClips() {
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(ACTIONS_URL);
  } catch {
    console.log(
      `[actions] ${ACTIONS_URL} not present — the character asset is the only ` +
        `clip source. This is the normal configuration.`,
    );
    return;
  }

  const accepted = [];
  for (const clip of gltf.animations || []) {
    const check = clipResolvesOnSkeleton(clip, characterSkeleton);
    if (check.ok) {
      accepted.push(clip);
      console.log(`[actions] accepted "${clip.name}" (${clip.tracks.length} tracks)`);
    } else {
      console.warn(
        `[actions] REJECTED "${clip.name}" — ${check.missing.length} bone(s) do not ` +
          `resolve on the character: ${check.missing.slice(0, 6).join(', ')}`,
      );
    }
  }
  actionClips = accepted;
  console.log(
    `[actions] ${ACTIONS_URL}: ${accepted.length} of ${(gltf.animations || []).length} clips accepted`,
  );
}

async function boot() {
  await initPhysics(loop.fixedDt);

  const arena = createArena();
  scene.add(arena.group);
  // arena.js is frozen, so the environment's membership is stamped here, on the
  // collider it returns. Its FILTER half stays 0xffff, so every contact pair it
  // had before it had a group it still has — this changes what rays can select,
  // not what collides. See the layout comment above.
  arena.collider.setCollisionGroups((ENVIRONMENT_MEMBERSHIP << 16) | 0xffff);

  motor = createMotor();
  // Construction-time, next to the collider it edits: the character rides the
  // sphere through tracking forces, not through contact, and its legs straddle
  // the ball by construction. See detachMotorFromRagdoll.
  detachMotorFromRagdoll(motor);
  scene.add(motor.mesh);
  motor.mesh.visible = TUNING.debug.showSphereWireframe;

  loop.register(motor.interpolated);

  initInput(canvas);
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
    // THE CAMERA MUST BE RE-DERIVED AT THE CAPTURE'S ALPHA.
    //
    // captureAnchored pins alpha = 1 so no interpolation fraction reaches the
    // image — but it re-applies the POSES only, and the spring arm had already
    // run earlier in that frame from the sphere's position at the frame's own
    // alpha. So the bodies were pinned and the camera was not, and the camera
    // offset carried a frame-pacing-dependent remainder straight into the
    // pixels. Two runs agreed on every simulated number and still produced
    // different images.
    //
    // Re-running the arm here, after the poses are pinned, closes it: the
    // camera is derived from the same alpha = 1 state as everything else. A
    // latent hole since the spring arm replaced the static camera in GF-3 —
    // invisible until the gravity change moved the ball enough at the anchor
    // tick for the difference to show.
    poseCharacter: (alpha) => {
      syncRagdollPose(ragdoll, alpha);
      updateSpringArm();
    },
    requestRagdollSpawn,
  });

  // A READ-ONLY SNAPSHOT, for measuring the things the HUD cannot show.
  //
  // It returns plain numbers, never the bodies themselves: a console handle on
  // a rigid body is a way to write velocity into the sim from outside every law
  // in the project, and a determinism claim that anyone can quietly break from
  // a devtools prompt is not a claim. Reading is free; there is nothing here to
  // write through.
  //
  // It exists because the sphere's own brake hides the ragdoll's motion — after
  // a dive the sphere is being hauled by the mount follower AND braked by
  // rollingResistance, so HUD speed says "stopped" while the body is still
  // sliding. Tuning the skid without this is tuning by anecdote.
  window.__vb = window.__vb || {};
  window.__vb.probe = () => {
    if (!ragdoll) return null;
    const pelvis = ragdoll.rig.get('pelvis');
    const pv = pelvis.body.linvel();
    const pt = pelvis.body.translation();
    const mt = motor.body.translation();
    const mv = motor.body.linvel();
    return {
      tick: loop.tick,
      pelvis: { x: pt.x, y: pt.y, z: pt.z, speed: Math.hypot(pv.x, pv.z) },
      motor: { x: mt.x, y: mt.y, z: mt.z, speed: Math.hypot(mv.x, mv.z) },
      weight: tracker.weight,
      grounded: motor.grounded,
      // THE SCORPION METRIC. Height of the highest foot against the head, and
      // the thigh's angle from the pelvis. A foot above the head means the legs
      // have come over the back.
      scorpion: (() => {
        const head = ragdoll.rig.get('head');
        const fL = ragdoll.rig.get('footL');
        const fR = ragdoll.rig.get('footR');
        if (!head || !fL || !fR) return null;
        const hy = head.body.translation().y;
        const fy = Math.max(fL.body.translation().y, fR.body.translation().y);
        return { footAboveHead: +(fy - hy).toFixed(3), headY: +hy.toFixed(3), footY: +fy.toFixed(3) };
      })(),
      // Torso tilt from world up, body vs the pose it is being asked to hold.
      // The gap between these two IS the tracker's authority, in degrees.
      tilt: pelvisTilt(pelvis.body.rotation()),
      targetTilt: (() => {
        const t = animTarget && animTarget.targets && animTarget.targets.get('pelvis');
        return t ? pelvisTilt(t.currQuat) : NaN;
      })(),
      // Extremity motion, for the jitter measurement. A character standing
      // still should read ~0 on all four; anything else is the PD loop
      // oscillating against the joints rather than settling.
      // Mean distance from every body to the pose it is being asked to hold.
      // The number that must NOT get worse when the damping is raised.
      trackError: (() => {
        if (!animTarget || !animTarget.targets) return NaN;
        let sum = 0;
        let n = 0;
        for (const [k, item] of ragdoll.rig) {
          const t = animTarget.targets.get(k);
          if (!t) continue;
          const b = item.body.translation();
          sum += Math.hypot(t.currPos.x - b.x, t.currPos.y - b.y, t.currPos.z - b.z);
          n += 1;
        }
        return n ? sum / n : NaN;
      })(),
      motorMass: motor.body.mass(),
      motorVy: motor.body.linvel().y,
      // JOINT DEVIATION FROM BIND, per child body: the total relative angle
      // between the body and its parent measured against the bind pose, and
      // for hinges how much of it is OFF the hinge axis. Off-axis on a hinge is
      // the twist the joint is supposed to make impossible.
      joints: (() => {
        const out = {};
        for (const [k, item] of ragdoll.rig) {
          const parentKey = item.entry.parent;
          if (!parentKey) continue;
          const par = ragdoll.rig.get(parentKey);
          if (!par) continue;
          const qp = par.body.rotation();
          const qc = item.body.rotation();
          _jA.set(qp.x, qp.y, qp.z, qp.w).invert();
          _jB.set(qc.x, qc.y, qc.z, qc.w);
          _jRel.copy(_jA).multiply(_jB);
          // Cached OUTSIDE the rig entry. The probe must not write anything the
          // simulation can see, even a field nothing reads.
          if (!_jBind.has(k)) {
            _jBind.set(k, _jRel.clone());
            continue;
          }
          _jA.copy(_jBind.get(k)).invert();
          _jDelta.copy(_jA).multiply(_jRel);
          if (_jDelta.w < 0) _jDelta.set(-_jDelta.x, -_jDelta.y, -_jDelta.z, -_jDelta.w);
          const angle = 2 * Math.acos(Math.min(1, Math.abs(_jDelta.w)));
          let offAxis = angle;
          if (item.entry.axis) {
            _jAxis.fromArray(item.entry.axis).normalize();
            const sin = Math.sqrt(Math.max(0, 1 - _jDelta.w * _jDelta.w));
            if (sin > 1e-6) {
              _jVec.set(_jDelta.x, _jDelta.y, _jDelta.z).divideScalar(sin);
              const along = Math.abs(_jVec.dot(_jAxis));
              offAxis = angle * Math.sqrt(Math.max(0, 1 - along * along));
            }
          }
          // Signed angle about the authored hinge axis, so the limit's
          // direction can be checked rather than assumed.
          let signed = 0;
          if (item.entry.axis) {
            _jAxis.fromArray(item.entry.axis).normalize();
            const sin = Math.sqrt(Math.max(0, 1 - _jDelta.w * _jDelta.w));
            if (sin > 1e-6) {
              _jVec.set(_jDelta.x, _jDelta.y, _jDelta.z).divideScalar(sin);
              signed = angle * _jVec.dot(_jAxis);
            }
          }
          out[k] = [
            +((angle * 180) / Math.PI).toFixed(1),
            +((offAxis * 180) / Math.PI).toFixed(1),
            +((signed * 180) / Math.PI).toFixed(1),
          ];
        }
        return out;
      })(),
      // Mean tracking error per BONE GROUP. During a crash the core should be
      // holding its pose while the extremities let go; this is that, in metres.
      groupError: (() => {
        const acc = {};
        if (!animTarget || !animTarget.targets) return acc;
        for (const [k, item] of ragdoll.rig) {
          const t = animTarget.targets.get(k);
          if (!t) continue;
          const b = item.body.translation();
          const d = Math.hypot(t.currPos.x - b.x, t.currPos.y - b.y, t.currPos.z - b.z);
          const g = item.group;
          if (!acc[g]) acc[g] = [0, 0];
          acc[g][0] += d;
          acc[g][1] += 1;
        }
        for (const g of Object.keys(acc)) acc[g] = +(acc[g][0] / acc[g][1]).toFixed(4);
        return acc;
      })(),
      limbs: ['handL', 'handR', 'footL', 'footR'].map((k) => {
        const item = ragdoll.rig.get(k);
        if (!item) return 0;
        const v = item.body.linvel();
        return Math.hypot(v.x, v.y, v.z);
      }),
      // What the GHOST is asking those same four to do. Body speed far above
      // this is oscillation; body speed that matches it is the animation.
      limbTargets: ['handL', 'handR', 'footL', 'footR'].map((k) => {
        const t = animTarget && animTarget.targets && animTarget.targets.get(k);
        if (!t) return 0;
        return Math.hypot(t.vel.x, t.vel.y, t.vel.z);
      }),
      // THE GHOST'S OWN PELVIS, in world. The hip-drop work needs the target
      // height and the target's horizontal offset from the sphere separately:
      // a drop that lowers the ghost also raises pelvisDownness, which the
      // mount blend reads as a fall and slides the target off the sphere.
      ghostPelvis: (() => {
        const t = animTarget && animTarget.targets && animTarget.targets.get('pelvis');
        return t ? { x: t.currPos.x, y: t.currPos.y, z: t.currPos.z } : null;
      })(),
      yaw: animTarget ? animTarget.yaw : 0,
      targetYaw: animTarget ? animTarget.targetYaw : 0,
      momentumYaw: animTarget ? animTarget.momentumYaw : 0,
      standUpNeed: animTarget ? animTarget.standUpNeed : 0,
      standUpProgress: animTarget ? animTarget.standUpProgress : 0,
      pelvisDownness: animTarget ? animTarget.pelvisDownness : 0,
      faceUpMix: animTarget ? animTarget.faceUpMix : 0,
      slidePhase: animTarget ? animTarget.slidePhase : 0,
      divePhase: animTarget ? animTarget.divePhase : 0,
      shares: animTarget ? { ...animTarget.shares } : null,
    };
  };

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
