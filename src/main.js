import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { TUNING } from './config/tuning.js';
import { Loop } from './core/Loop.js';
import {
  initPhysics, stepPhysics, getWorld, drainContactForces, RAPIER,
  ENVIRONMENT_RAY_GROUPS, logCollisionMatrix,
} from './sim/physics.js';
import { createArena, activeArenaType, activeArenaPreset } from './sim/arena.js';
import {
  createBall, applyBallResistance, noteBallContact, syncBallSnapshot, ballProbe,
} from './sim/ball.js';
import { createMotor, updateMotor, syncMotorSnapshot, horizontalSpeed } from './sim/motor.js';
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
import {
  buildRagdoll, destroyRagdoll, detachMotorFromRagdoll, BONE_MAP, resolveBoneByName,
} from './sim/autorig.js';
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
import {
  input, initInput, sampleInput, consumeJump, consumeDive, consumeVolley, consumeSpike,
} from './input.js';
import { createWatchdogState, runWatchdog } from './mechanics/watchdog.js';
import { createMountFollowerState, runMountFollower } from './mechanics/mountFollower.js';
import { createActionState, runActions } from './mechanics/actions.js';
import {
  createStrikeState, runStrikes, resolveStrikeContact, strikeProbe,
} from './mechanics/strikes.js';
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
 * The collision group layout lives in sim/physics.js, because the motor's ground
 * fan needs the same filter word and motor.js cannot import this file. The
 * arena stamps its own membership now that arena.js is no longer frozen, so this
 * file imports only the RAY word it casts with.
 */

/**
 * The spring arm's environment probe. Allocation-free, built lazily because
 * RAPIER is not initialised at module-eval time.
 *
 * IT USED TO BE SHARED with the mount follower's two casts, with these two
 * objects rewritten in place before each. That was safe only because every
 * caller happened to set all six fields first — not a property anyone could
 * check. The mount follower owns its own now (mechanics/mountFollower.js), at
 * the cost of one Ray object for the life of the process.
 */
let _envRay = null;
const _rayFrom = { x: 0, y: 0, z: 0 };
const _rayDir = { x: 0, y: 0, z: 0 };

/** Consecutive ticks the ground fan has reported contact. Mechanics counter. */
let groundedRun = 0;
/** Scratch for the limp brake's relative velocity. */
const _limpVel = new THREE.Vector3();
/** Slack on the weight-sum assertion, for the easings' floating-point residue. */
const WEIGHT_SUM_TOLERANCE = 1e-3;

/**
 * Served straight out of public/. Not a tunable: it is the asset's identity.
 *
 * THE NAME IS THE ROLE NOW, NOT THE ASSET'S HISTORY. This file was shipped as
 * YBOT30Animations.glb and renamed to character.glb once it stopped being a
 * candidate and became the character — the same bytes under a name that will
 * still be true after the next clip is added to it. The two predecessors that
 * had been sitting unloaded in public/models were deleted at the same time, so
 * "character.glb" is unambiguous again: there is exactly one of them, and it is
 * the thirty-clip asset described below.
 *
 * ITS CONTENT REPLACES the fifteen-clip predecessor, which in turn replaced the
 * original. It is not a different character, and this is not a re-rig. Parsed
 * accessor-for-accessor against its predecessor,
 * the skin joint list (65 joints, "mixamorig:" prefix, Hips root, same order),
 * every joint's local translation / rotation / scale, all 65 inverse bind
 * matrices, both SkinnedMeshes — Alpha_Joints and Alpha_Surface, POSITION,
 * NORMAL, UV, JOINTS_0, WEIGHTS_0 and indices — and the armature root
 * "Master Actor" (+90 degrees X, scale 0.01) are BYTE-IDENTICAL: max absolute
 * difference 0.0 on every accessor. Same exporter, Khronos glTF Blender I/O.
 *
 * That is why the switch is safe, and it is the same reason the last one was:
 * the auto-rigger derives every collider from the bind pose, and a bind pose
 * that cannot move cannot move the colliders. BONE_MAP needs no edit, the
 * masses and capsule radii cannot have moved, and the L5 axis derivation
 * answers the same question about the same armature.
 *
 * THE 15 CLIPS ALREADY SHIPPING ARE BYTE-IDENTICAL TOO, under the same names,
 * so every measured clip window in TUNING — jump.clipStart/End, standUp's
 * window, action.diveClipStart/End, the slide window — stays valid without
 * re-measurement.
 *
 * IT ADDS EXACTLY FIFTEEN CLIPS: Walk Backwards, Jog Backwards, Stop Walking,
 * Backwards Right Move, Backwards Left Move, Idle Kick Right, Idle Kick Left,
 * Idle Low Kick Left, Idle Low Kick Right, Bash Hit Right, Bash Hit Left,
 * Running Jump Kick Right, Idle Two Hand Volley, Standing Spike Left and
 * Standing Spike Right. Two of them are registered: "Walk Backwards" on the
 * walk ring and "Jog Backwards" on the run ring, named in TUNING.blend2d's
 * per-ring node tables, which together retire the backpedal placeholder. The
 * other thirteen are present, listed by the clip inventory logged in
 * loadCharacter, and referenced by nothing.
 *
 * BOTH PREDECESSOR ASSETS WERE DELETED IN G3.5. They had sat in public/models
 * unloaded since the swap, surviving five deletion orders because nothing ever
 * broke by leaving them there. Nothing loads them and nothing names them.
 *
 * A NOTE FOR THE NEXT CENSUS: G3.5's zombie grep included "character.glb"
 * because that WAS one of the deleted predecessors. After the rename that
 * string means the LIVE asset, so grepping for it proves nothing. Grep the
 * other two deleted names instead — the rider module under src/sim/ and the
 * fifteen-clip GLB — and they are zero. The shipped name of this file survives
 * on two comment lines in this block, deliberately: it is the only record of
 * where the asset came from, and no code path names it.
 */
const CHARACTER_URL = import.meta.env.BASE_URL + 'models/character.glb';
/** OPTIONAL. Absent today; extra clips beyond the character asset go here. */
const ACTIONS_URL = import.meta.env.BASE_URL + 'models/actions.glb';

/** Scratch for the mount transform. Built fresh on every spawn. */
const _mount = new THREE.Matrix4();
/**
 * Scratch for the athlete's boot-time placement onto the arena's spawn point.
 * The watchdog's own respawn point moved to mechanics/watchdog.js with it; this
 * is used exactly once, in boot(), before the loop starts.
 */
const _bootSpawnPoint = new THREE.Vector3();

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
 * THE PER-ATHLETE MECHANICS STATE, one object per mechanic.
 *
 * These were eight module-level `let`s and three scratch vectors in this file
 * until G3.5. They are the same values with the same lifetimes — created once,
 * never reset by a respawn — but they belong to a factory now, because G5
 * instantiates N athletes and a module-level slide clock is one clock for all
 * of them. Nothing outside this file reaches them; the HUD reads them here.
 */
const watchdogState = createWatchdogState();
const mountFollowerState = createMountFollowerState();
const actionState = createActionState();
const strikeState = createStrikeState();

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
    // BACKSPACE, NOT R (G4). `R` became the spike, and a debug teleport should
    // not be one slip of a finger away from a gameplay verb. The hotkey moved
    // rather than the strike, because the strike is the thing a player's hand
    // has to find without looking.
    if (isHotkey(event, 'Backspace')) requestRagdollSpawn();
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

// SHADOWS, for depth. A ball in flight over a curved floor is impossible to
// place by eye without one — height and distance look identical from a chase
// camera, which is exactly the judgement a player has to make to get under it.
//
// Deterministic: a shadow map is a function of the same transforms the colour
// pass reads, so two runs at the same tick produce the same map and the anchored
// pair still compares. It costs a second depth pass over the casters, which is
// why the caster list is kept to the ball rather than switched on scene-wide.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d12);

scene.add(new THREE.AxesHelper(2));

const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(8, 14, 10);
// The shadow camera is an orthographic box in LIGHT space and has to contain
// everything that should cast. Sized to the bowl's floor radius with margin: at
// 2048 over 80 m that is about 4 cm per texel, which resolves a 40 cm ball
// cleanly. normalBias rather than a large depth bias, because a sphere's
// grazing angles are where acne shows and normalBias is the term that fixes it
// without detaching the shadow from the ball at contact.
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -40;
keyLight.shadow.camera.right = 40;
keyLight.shadow.camera.top = 40;
keyLight.shadow.camera.bottom = -40;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 120;
keyLight.shadow.bias = -0.0005;
keyLight.shadow.normalBias = 0.02;
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
const hudBackNode = document.getElementById('hud-backnode');
const hudLocalVel = document.getElementById('hud-localvel');
const hudSprint = document.getElementById('hud-sprint');
const hudAirborne = document.getElementById('hud-airborne');
const hudImpact = document.getElementById('hud-impact');
const hudStandUp = document.getElementById('hud-standup');
const hudBall = document.getElementById('hud-ball');
const hudBallTouch = document.getElementById('hud-balltouch');
const hudBallPeak = document.getElementById('hud-ballpeak');
const hudStrike = document.getElementById('hud-strike');
const hudStrikeHit = document.getElementById('hud-strikehit');
const hudStrikeRate = document.getElementById('hud-strikerate');
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
  // THE TWO BACK NODES, BY NAME. The row above gives the direction tent's B
  // weight, which is the same number whatever clip a back node happens to hold —
  // so on its own it cannot tell an authored backpedal from the forward-walk
  // stand-in, nor the walk ring's clip from the run ring's. Each ring now owns
  // its own back node, so each is printed with the weight that charges it:
  // walk first, then run. Both names are READ off the nodes the ring
  // construction built (Lesson 22) — nothing here reconstructs which clip
  // TUNING asked for, which is the whole point, because a fallback would make
  // those two answers differ and only the node knows the truth.
  hudBackNode.textContent = animTarget
    ? `${animTarget.weights.walkB.toFixed(2)} ${animTarget.nodes.walk.b.name} / ` +
      `${animTarget.weights.runB.toFixed(2)} ${animTarget.nodes.run.b.name}`
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
  const diveReady =
    Math.max(0, TUNING.action.diveCooldownTicks - (loop.tick - actionState.lastDiveTick));
  hudAction.textContent = `${actionState.slideTime} / ${actionState.divePending ? 'DIVE' : '—'} / cd ${
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

  // THE BALL ROWS, read through the ball's own probe (LESSON 22 — the readout
  // reads; it does not keep a second copy of the arithmetic). `h` is the
  // distance from the ball's CENTRE down to the arena, so a ball at rest on
  // flat floor reads its own radius rather than zero — which is what makes
  // "0.00 / 0.105" a meaningful thing to see in a capture.
  if (ball) {
    const b = ballProbe(ball);
    hudBall.textContent = `${b.label}  ${b.speed.toFixed(2)} m/s / ${
      Number.isFinite(b.heightAboveFloor) ? b.heightAboveFloor.toFixed(3) : '—'
    } m`;
    // Ticks, not seconds: the HUD may not name a wall clock any more than the
    // simulation may.
    // The MOST RECENT touch across all three, so a hit on any ball shows up
    // rather than only the primary's.
    let latest = null;
    for (const other of balls) {
      if (other.lastTouchKey && (!latest || other.lastTouchTick > latest.lastTouchTick)) {
        latest = other;
      }
    }
    hudBallTouch.textContent = latest
      ? `${latest.id}:${latest.lastTouchKey} @${latest.lastTouchTick} ${latest.lastTouchForce.toFixed(1)} N`
      : '—';
    // The right-hand number is the spec's evidence and must read 0 forever. It
    // is the total ACROSS ALL THREE balls, not the primary's: one sphere
    // ploughing through one ball is the failure, whichever ball it is.
    let motorContacts = 0;
    let peakAcross = 0;
    for (const other of balls) {
      motorContacts += other.motorContactCount;
      if (other.peakTouchForce > peakAcross) peakAcross = other.peakTouchForce;
    }
    hudBallPeak.textContent = `${peakAcross.toFixed(1)} N / ${motorContacts}`;
  } else {
    hudBall.textContent = '—';
    hudBallTouch.textContent = '—';
    hudBallPeak.textContent = '—';
  }

  // THE STRIKE ROWS, read through the strike's own probe (LESSON 22 — the
  // readout reads). `w` is the window: ticks since the press, and whether that
  // number is inside the row's open/close. It is the one number that explains a
  // whiff, because a whiff is always either "too early", "too late", or "the
  // hand never got there".
  const st = strikeProbe(strikeState);
  const row = st.kind === 'spike' ? TUNING.strike.spike : TUNING.strike.volley;
  const since = loop.tick - st.lastStrikeTick;
  const open = Number.isFinite(since) && since >= row.windowOpen && since <= row.windowClose;
  hudStrike.textContent = st.lastStrikeTick === -Infinity
    ? '—'
    : `${st.kind}${st.kind === 'spike' ? (st.side >= 0 ? ' R' : ' L') : ''} ` +
      `ph ${st.phase.toFixed(2)} mix ${st.mix.toFixed(2)} ` +
      `w ${Number.isFinite(since) ? since : '—'}${open ? ' OPEN' : ''}`;
  hudStrikeHit.textContent = st.lastContactKey
    ? `${st.lastContactKey} @${st.lastContactTick} q ${st.lastContactQuality.toFixed(2)} ` +
      `${st.lastContactForce.toFixed(0)} N -> ${st.lastLaunchSpeed.toFixed(1)} m/s`
    : '—';
  hudStrikeRate.textContent = `${st.resolvedCount} / ${st.whiffCount}` +
    (Number.isFinite(st.hitRate) ? `  (${(st.hitRate * 100).toFixed(0)}%)` : '');
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

let motor = null;

/** The invisible clip-playing rig, and the PD tracker that chases it. */
let animTarget = null;

/**
 * THE BALL FIXTURE. Three of them, created at boot in TUNING.balls order,
 * never destroyed, never pooled.
 *
 * `ball` is balls[1] — the 1 m medium — and exists so the HUD and the probe
 * have one primary to report without three copies of every row. It is an ALIAS,
 * not a special case: nothing in the simulation treats it differently, and
 * every per-step call below iterates the array.
 */
let balls = [];
let ball = null;
/** collider handle -> ball, so the drain callback can name which one was hit. */
const ballByHandle = new Map();

/**
 * THE ACTIVE ARENA'S PRESET, resolved once at boot and read everywhere after.
 *
 * Everything that differs between the bowl and the court — where the athlete
 * lands, where the balls drop, how far down "out of the world" is — comes from
 * here rather than from a branch on the arena's name. Nothing in the simulation
 * asks "am I on the court"; it asks the preset for a number.
 */
let arenaPreset = null;

/**
 * The tick `?captureTick=N` armed, or null in a normal run.
 *
 * READ from initCapture's own return value rather than re-parsed from the URL,
 * so there is one authority on whether a run is armed and it is the capture
 * module. The ragdoll's spawn seam lives inside capture.js and calls back into
 * main.js; the ball cannot get a second callback without editing capture.js,
 * which is frozen — so it reads the armed tick here and gates on it itself.
 */
let armedCaptureTick = null;
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
  // ghostInputs is null here on purpose: this is the seeding call against a
  // freshly built state, and the mechanics have not run for this tick yet.
  updateAnimTarget(
    animTarget, motor, ragdoll.rig, input.cameraYaw, false, NaN, true, loop.fixedDt, null,
  );
  resetAnimTarget(animTarget);

  // ONCE PER SESSION, not once per respawn. The answer is a property of the
  // asset and the armature, neither of which R can change, and thirty lines on
  // every press of R would bury the log the readout exists to be read from.
  if (!l5ResidualLogged) {
    l5ResidualLogged = true;
    logL5Residuals(animTarget);
  }

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
 * ═══ THE ORCHESTRATOR'S OWN HELPERS ═══
 *
 * Seven blocks that used to sit inline in `fixedUpdate`, lifted into named
 * functions in G3.5 so the ordering contract is the whole of that function's
 * body. They did NOT move to `src/mechanics/` and they were not meant to: they
 * are not mechanics an athlete owns, they are the orchestrator's own arithmetic
 * and its once-a-second alarms. A module per paragraph is how a god file
 * becomes a god package. They stayed in this file, out of that function.
 *
 * Every one is the same code in the same order with the same comments. The only
 * edits are the ones a function boundary forces: a `return` where the value
 * used to fall through, and `dt`/`tick` as parameters where they were in scope.
 */

// DRIVE ATTENUATION. tracker.weight squared: a stumbling athlete steers, a
// downed one does not. RULING 6.1 — this scales torque, never velocity.
function driveAttenuation() {
  return tracker.weight * tracker.weight;
}

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
function knockdownDrag() {
  const resistanceScale =
    1 +
    TUNING.motor.downedDragBoost *
      smoothstep01((TUNING.impact.dragOnset - tracker.weight) / TUNING.impact.dragOnset);
  lastResistanceScale = resistanceScale;
  return resistanceScale;
}

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
function advanceGroundedDebounce() {
  groundedRun = motor.grounded ? groundedRun + 1 : 0;
  const stableGrounded = groundedRun >= TUNING.jump.groundedDebounceTicks;
  return stableGrounded;
}

// ── THE LIMP BRAKE ──
//
// While the character is fully limp the tracker's own damping is scaled by
// the weight and is therefore switched off at exactly the moment the body is
// sliding across the floor on pure momentum — which is why a dive landing
// skated like ice. This brakes the ragdoll bodies directly, ramped in over
// the last tenth of the weight range so nothing steps, and routed through the
// one L3 clamped helper so it can only cancel motion, never reverse it.
function applyLimpBrake(dt) {
  if (ragdoll && tracker.weight < TUNING.ragdoll.limpBrakeBelow) {
    const limpness = 1 - tracker.weight / TUNING.ragdoll.limpBrakeBelow;
    const request = TUNING.ragdoll.limpBrake * limpness * dt;
    for (const item of ragdoll.rig.values()) {
      const v = item.body.linvel();
      _limpVel.set(v.x, 0, v.z);
      applyClampedLinearDamping(item.body, request * _limpVel.length(), _limpVel, dt);
    }
  }
}

// ONE OBJECT, ONE HANDOFF (G3.5). main.js used to poke the ghost's fields by
// name from three places inside fixedUpdate — a write channel with no signature
// and nothing to grep for. Same fields, same semantics, SAME ORDER; they travel
// as an argument now and `readGhostInputs` is where they land. G4 appends four
// more after the six, and the order below is the order they are read in.
function buildGhostInputs(actions, strikes) {
  return {
    // THE RECOVERY CLOCK, handed over the same way slideMix is. The ghost drives
    // the stand-up take off this and not off the pelvis: a scrub anchored to the
    // body cannot haul the body, because the body only moves by being hauled
    // toward the scrub. See advanceStandUp.
    recoveryWeight: tracker.weight,
    // Stick magnitude, for the coasting facing check. Handed over rather than
    // read, so the ghost still touches no input of its own.
    steerInput: Math.hypot(input.moveWorld.x, input.moveWorld.z),
    slideMix: actions.slideMix,
    diveMix: actions.diveMix,
    slidePhase: actions.slidePhase,
    divePhase: actions.divePhase,
    // The strike's share and scrub, plus the two recorded values that pick
    // which of its three clips carries the share.
    strikeMix: strikes.strikeMix,
    strikePhase: strikes.strikePhase,
    strikeKind: strikes.strikeKind,
    strikeSide: strikes.strikeSide,
  };
}

// THE RECOVERY RAMP IS HELD OFF for two reasons, and they go in through the
// same door because the tracker only has one. A limp body still sliding fast
// has not finished falling; and a dive has just been paid for, and the stun
// is the price. The second is a tick comparison, not a state — the recorded
// expiry is the same class of thing as lastDiveTick beside it.
function isTumbling(actions) {
  return actions.diveStunned || (ragdoll &&
    tracker.weight < TUNING.impact.mountRecoverBelow &&
    Math.hypot(ragdoll.rig.get('pelvis').body.linvel().x, ragdoll.rig.get('pelvis').body.linvel().z) > 2.0);
}

// Impacts are read from the step just taken and spent on the SAME tick, so a
// hit and its cost are never a frame apart. The queue auto-drains at the next
// step, so anything not taken here is gone — an impact belongs to its tick.
function drainImpacts(tick, dt) {
  if (ragdoll) {
    impactEvents.length = 0;
    drainContactForces((handle1, handle2, totalForce) => {
      // A NOTE ON THE `if (ragdoll)` THIS SITS INSIDE: for the handful of ticks
      // between boot and the first spawn there is no ragdoll, so the queue is
      // not drained and any ball contact in that window is discarded with it.
      // That window contains only ball-vs-arena contacts, which this branch
      // ignores anyway, and the alternative is restructuring fixedUpdate around
      // the ball — which the fence forbids and the fixture does not need.
      //
      // THE BALL'S CONTACTS ARE RECORDED AND NEVER SPENT (LESSON 15). A ball
      // event is instrumentation in G2: it names the limb, stamps the tick and
      // keeps the peak force, and it does NOT enter impactEvents, so it can
      // never cost the athlete tracking weight. Mapping force to weight is a
      // calibration decision and the numbers to calibrate against are what this
      // step is collecting.
      // Which ball, if either handle is one. A ball-vs-ball contact resolves to
      // the first handle's ball and finds no rig key on the second, so it is
      // recorded as "not a limb touch" and correctly changes nothing.
      const hitBall = ballByHandle.get(handle1) || ballByHandle.get(handle2);
      if (hitBall) {
        const other = handle1 === hitBall.collider.handle ? handle2 : handle1;
        const limb = impactByHandle.get(other);
        noteBallContact(hitBall, other, limb && limb.key, motor.collider.handle, totalForce, tick);
        // AND THE STRIKE GETS ITS LOOK AT THE SAME CONTACT. noteBallContact
        // records that something touched the ball; this asks whether that touch
        // was INTENT — a qualifying limb, inside an open window — and if it was,
        // puts one impulse on the ball. Most contacts are not, and it returns
        // without doing anything, which is the diving dig and every incidental
        // knock continuing to work exactly as G2 left them.
        resolveStrikeContact(strikeState, hitBall, limb && limb.key, totalForce, tick);
        return;
      }

      // The sphere is not in the ragdoll's collision set at all (Task 4.1), so
      // the permanent mount contact cannot appear here — measured across four
      // calibration regimes, zero ragdoll-vs-sphere events. No exclusion needed.
      const hit = impactByHandle.get(handle1) || impactByHandle.get(handle2);
      if (hit) impactEvents.push({ key: hit.key, group: hit.group, force: totalForce });
    });
    applyImpacts(tracker, impactEvents, tick, dt);
  }
}

// Once a second. A non-finite transform propagates through the joint graph in
// a few steps and then the character disappears with no other symptom, so the
// first body to go bad is worth naming.
function assertInvariants(tick) {
  if (balls.length && tick % TUNING.loop.fixedHz === 0) {
    for (const b of balls) {
    // THE SPEC, ASSERTED. The sphere is filtered out of the ball's interaction
    // word, so this counter can only leave zero if that filter has been broken —
    // at which point the athlete is knocking the ball with an invisible
    // half-metre sphere centred on his hips instead of with his shins, which is
    // the exact failure the designer's spec exists to prevent. console.error
    // rather than a warning, because the determinism script fails the pair on
    // an error and this must not be able to ship quietly.
      if (b.motorContactCount !== 0) {
        console.error(
          `[ball:${b.id}] motorContactCount is ${b.motorContactCount} at tick ${tick} — the ` +
            `sphere is colliding with the ball. MOTOR_GROUPS / BALL_GROUPS filtering is broken.`,
        );
      }

      const bt = b.body.translation();
      const bv = b.body.linvel();
      if (!Number.isFinite(bt.x + bt.y + bt.z + bv.x + bv.y + bv.z)) {
        console.error(`[ball:${b.id}] non-finite transform or velocity at tick ${tick}`);
      }
    }
  }

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
 * THE SIMULATION, AND NOTHING BUT ITS ORDER.
 *
 * Sees only the constant timestep and the integer tick. After G3.5 the body of
 * this function IS the ordering contract below: one call per numbered step, in
 * order, and nothing else. Every mechanic it sequences lives in a module or in
 * a named helper above, and the reason is that G4 adds strikes — more
 * mechanics than any step so far — and a seven-hundred-line fixedUpdate is
 * where an ordering bug goes to hide.
 *
 * ORDER. Task 3's save/step/snapshot bracket is preserved exactly: curr goes to
 * prev BEFORE anything moves, and curr is rewritten AFTER the world steps. Task
 * 4 inserts the target and the tracker between the motor and the step, because
 * both only apply forces and every force has to land before the one
 * stepPhysics() that consumes them.
 *
 * THE ORDERING, in full, because several steps only work in this order:
 *
 *   1. respawn        — creates bodies/colliders/joints; must precede any read
 *                       of the rig.
 *   2. watchdogs      — SPAWN EVENTS, in mechanics/watchdog.js. The athlete's
 *                       kill plane and the balls' own, plus the serve and the
 *                       armed-run seed. Reads body positions only.
 *   3. mount recovery — SPAWN EVENT, in mechanics/mountFollower.js. Must run
 *                       BEFORE the ghost updates, so the ghost's mount and its
 *                       mountSlack easing see the snapped sphere on the SAME
 *                       step. Run after, and the ghost spends a step reaching
 *                       for where the sphere used to be and the stand-up starts
 *                       with a backward lurch. Returns the pelvis floor height,
 *                       cast once and used twice.
 *   4. knockdown      — consumes the T flag onto this tick.
 *   5. consumes       — clears the queued jump and dive whether or not they fire.
 *   5b. actions       — mechanics/actions.js. The slide and the dive: the
 *                       clocks, the latches, the two scales updateMotor takes
 *                       and the four numbers the ghost is handed. Runs before
 *                       the motor because the motor is given its output.
 *   6. saveRagdollPrevious — curr -> prev BEFORE anything moves.
 *   7. updateMotor    — applies drive/brake/jump forces; may set lastJumpTick.
 *                       The drive attenuation, the knockdown drag, the grounded
 *                       debounce and the limp brake are its preparation.
 *   7b. ball resistance — clamped air drag and spin decay, before the step so
 *                       it lands in the same one.
 *   8. liftoff edge   — read from lastJumpTick CHANGING across step 7, and the
 *                       ghostInputs object built from it and from step 5b.
 *   9. updateAnimTarget — the ghost, which consumes that edge, the latched
 *                       camera yaw and ghostInputs.
 *  10. applyTracking  — PD forces toward the ghost.
 *  11. stepPhysics    — the ONE world step; every force above lands in it.
 *  12. impacts        — drained from the step just taken, spent on this tick.
 *                       Ball contacts are RECORDED here and spent on nothing.
 *  13. snapshots      — curr rewritten AFTER the world moved, motor then ball.
 *  14. asserts        — once a second, on what the step just produced.
 *
 * THE setTranslation CENSUS, in one place because LAW 1 is counted rather than
 * argued. FOUR PLAY-CODE SITES, all of them spawn events consumed on a tick
 * boundary and none of them reachable from input:
 *
 *   1. spawnRagdoll        — this file, step 1 (through autorig's builders)
 *   2. the out-of-bounds watchdog — mechanics/watchdog.js, step 2
 *   3. the mount follower  — mechanics/mountFollower.js, step 3
 *   4. resetBall           — sim/ball.js, called from step 2
 *
 * And the CONSTRUCTION-CLASS exceptions, which are not play code and cannot be
 * reached once the loop is running: the three `RigidBodyDesc` builders in
 * motor.js, autorig.js and ball.js, and the athlete's boot-time placement onto
 * the active arena's spawn point in `boot()`.
 *
 * @param {number} dt
 * @param {number} tick
 */
function fixedUpdate(dt, tick) {
  if (!motor) return;

  // 1 — RESPAWN. The only place bodies, colliders and joints are created. The
  // flag comes from a keypress, the capture seam or the watchdog; either way it
  // is consumed on a tick boundary.
  if (respawnRequested) {
    respawnRequested = false;
    spawnRagdoll();
  }

  // 2 — THE WATCHDOGS. The flag is RETURNED rather than assigned from inside the
  // module, so the variable that decides whether a body gets built has one writer.
  if (runWatchdog({
    state: watchdogState, motor, ragdoll, balls, arenaPreset, armedCaptureTick, tick,
  })) {
    respawnRequested = true;
  }

  // 3 — MOUNT RECOVERY, and the floor probe it casts on the way. pelvisFloorY was
  // a module-level `let` written here and read at step 9; a local now.
  const pelvisFloorY = runMountFollower({
    state: mountFollowerState, motor, ragdoll, animTarget, tracker, tick, dt,
  });

  // 4 — KNOCKDOWN.
  if (knockdownRequested) {
    knockdownRequested = false;
    queueKnockdown(tracker);
  }

  // 5 — Consumed exactly once per step, and cleared whether or not they fire.
  const jumpQueued = consumeJump();
  const diveQueued = consumeDive();

  // 5b — THE ACTION STATES, and the strikes beside them. The two strike presses
  // are consumed in the argument list: still once per step, still cleared
  // whether or not they fire, and the consume sits where the value is used.
  const actions = runActions({
    state: actionState, motor, input, tracker, ragdoll, ghost: animTarget,
    diveQueued, jumpQueued, tick, dt,
  });
  const strikes = runStrikes({
    state: strikeState, input, motor, ghost: animTarget, balls, tick, dt,
    volleyQueued: consumeVolley(), spikeQueued: consumeSpike(),
  });

  // 6 — THE BRACKET OPENS. See the contract above.
  saveRagdollPrevious(ragdoll);

  // 7 — THE MOTOR, and the four numbers that prepare it.
  const driveScale = driveAttenuation();
  const resistanceScale = knockdownDrag();
  const stableGrounded = advanceGroundedDebounce();
  applyLimpBrake(dt);

  // THE LIFTOFF EDGE. motor.js is frozen and reports nothing, so the fact that
  // a jump fired is read from its own lastJumpTick CHANGING across the call —
  // the cooldown path already had to record that tick, so nothing new is
  // stored. This is a mechanics edge of the same class as padJumpWasDown, and
  // it latches a float rather than raising a state flag (RULING GF-2.0).
  const jumpTickBefore = motor.lastJumpTick;
  updateMotor(
    motor,
    input,
    // THE JUMP THE ACTIONS ALLOW, not the raw press: a slide swallows it and a
    // dive locks it out. Identical to jumpQueued whenever neither is running.
    actions.allowJump,
    dt,
    actions.actionCommitted ? 0 : driveScale,
    tick,
    resistanceScale * actions.actionResistance,
  );

  // 7b — Air drag and spin decay, beside the motor's own resistance and for the
  // same reason: every force must land in the ONE stepPhysics() below. LAW 3 — the
  // gains go through the clamped helpers, never through a Rapier damping setter.
  for (const b of balls) applyBallResistance(b, dt);

  // 8 — THE LIFTOFF EDGE, and the ghost's inputs for this step.
  const liftoff = motor.lastJumpTick !== jumpTickBefore;
  const ghostInputs = animTarget ? buildGhostInputs(actions, strikes) : null;

  // 9 — THE GHOST.
  if (ragdoll) {
    updateAnimTarget(
      animTarget, motor, ragdoll.rig, input.cameraYaw, liftoff, pelvisFloorY,
      stableGrounded, dt, ghostInputs,
    );
  }

  // 10 — TRACKING.
  applyTracking(tracker, ragdoll && ragdoll.rig, animTarget, motor, dt, isTumbling(actions));

  // 11 — THE ONE WORLD STEP.
  stepPhysics();

  // 12 — IMPACTS.
  drainImpacts(tick, dt);

  // 13 — SNAPSHOTS.
  syncMotorSnapshot(motor);
  // Same slot, same contract: body -> curr, AFTER the world moved.
  for (const b of balls) syncBallSnapshot(b);
  snapshotRagdoll(ragdoll);

  // 14 — THE ONCE-A-SECOND ALARMS.
  assertInvariants(tick);
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
  // LESSON 23 — ONE APPLY SITE. Walk the registry; never apply an Interpolated
  // by name.
  //
  // This used to be a hand-written list — the motor, and then a `for` over the
  // balls — and the ball was missing from it for a whole step. The body fell,
  // bounced and rolled through every session of interactive play while the mesh
  // sat at its spawn point, and NO automated capture could see it, because
  // captureAnchored walks `loop.interpolated` and applies alpha to every
  // registered entry. Two consumers, two lists, and the gate only checked one.
  //
  // There is one consumer now, and it is the same walk the capture does, so
  // registering an Interpolated IS the whole contract. Adding an entity to the
  // scene can no longer half-add it.
  const registry = loop.interpolated;
  for (let i = 0; i < registry.length; i += 1) registry[i].apply(alpha);
  // The ragdoll keeps its own interpolation OUTSIDE that registry by design —
  // sixteen bodies posed through the skeleton rather than as loose transforms —
  // so it is posed explicitly here, exactly as captureAnchored calls
  // poseCharacter(1) for it separately. Mirroring that split is deliberate.
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

  logClipInventory();
}

/**
 * EVERY CLIP-NAME FIELD IN TUNING, READ OUT OF TUNING.
 *
 * Lesson 22 — a readout READS, it never recomputes. Retyping the registered
 * names into the inventory below would produce a table that goes on agreeing
 * with itself after somebody edits TUNING, which is worse than having no table
 * at all. Every field is reached by walking the same objects the blend space
 * walks: TUNING.anim.blend.idleClip, every string in TUNING.blend2d including
 * the per-direction ring tables, and every key ending in "Clip" on TUNING.jump,
 * TUNING.standUp and TUNING.action. Add a clip field to any of those and it
 * appears here without this function being touched.
 *
 * Keyed by LOWERCASED clip name, because findClip in animtarget.js resolves
 * case-insensitively and a readout that is stricter than the resolver would
 * report a registered clip as unreferenced.
 *
 * @returns {Map<string, {name: string, paths: string[]}>} lowercased clip name
 *          -> the name as TUNING actually spells it, and the fields naming it
 */
function tuningClipFields() {
  const fields = new Map();
  const add = (path, value) => {
    if (typeof value !== 'string' || value === '') return;
    const key = value.toLowerCase();
    const entry = fields.get(key);
    // The authored spelling is kept, not the lowercased key: the warning at the
    // bottom of the inventory quotes this back at whoever has to go and find the
    // field, and "crash" does not appear in tuning.js — 'Crash' does.
    if (entry) entry.paths.push(path);
    else fields.set(key, { name: value, paths: [path] });
  };

  add('anim.blend.idleClip', TUNING.anim.blend.idleClip);

  for (const [key, value] of Object.entries(TUNING.blend2d)) {
    if (typeof value === 'string') {
      add(`blend2d.${key}`, value);
    } else if (value && typeof value === 'object') {
      for (const [dir, name] of Object.entries(value)) add(`blend2d.${key}.${dir}`, name);
    }
  }

  for (const group of ['jump', 'standUp', 'action']) {
    for (const [key, value] of Object.entries(TUNING[group])) {
      if (key.endsWith('Clip')) add(`${group}.${key}`, value);
    }
  }

  return fields;
}

/** The L5 residual readout is a load-time proof, not a per-respawn one. */
let l5ResidualLogged = false;

/**
 * LAW L5 — THE PER-CLIP ROOT-MOTION RESIDUAL, MEASURED FOR EVERY CLIP.
 *
 * The strip in animtarget.js pins the two ARMATURE-LOCAL axes that are
 * world-horizontal back to their bind values on every step and keeps the third.
 * WHICH two those are is derived at construction from the armature itself
 * (hipsAxisRoles) and published on the target state. This reads those axes off
 * the state rather than assuming them, so a re-export that reorients the
 * armature moves the readout WITH the strip instead of against it — which is
 * the whole reason the derivation exists. Lesson 22 again: readouts read.
 *
 * For every clip in the asset set it walks the Hips position track and reports
 * two numbers, both in world metres, both the largest value reached over the
 * clip, both measured from the bind hips:
 *
 *   UNSTRIPPED — how far the hips travel horizontally AS AUTHORED. This is the
 *     number that says "this clip carries root motion", and several of the new
 *     clips carry metres of it: Running Jump Kick Right and the two spikes walk
 *     the athlete across the court if nothing removes it.
 *   STRIPPED — the same measurement with the strip's own two axes pinned to
 *     bind. This is what the ghost actually does, and IT MUST READ 0.0000 m.
 *
 * A non-zero stripped residual means the derived axes do not cover the axes the
 * clip animates: the strip would be pinning the wrong pair and the ghost would
 * walk out from under the sphere, which is locomotion coming from the animation
 * instead of from input. That is a stop condition and a report, not something
 * to patch here — the strip is not this file's to edit.
 *
 * Nothing in here touches the target. The tracks are sampled straight out of
 * the clips, the mixer is never advanced, no bone is written, and the world
 * matrix is only read. Running it changes no simulation state.
 */
function logL5Residuals(target) {
  const hips = target.hips;
  if (!hips.parent) {
    console.warn('[L5] the ghost hips have no parent — residual not measured');
    return;
  }
  // Composed by updateAnimTarget immediately above this call: mount * armature.
  // The mount is a yaw and a translation, so it cannot change a horizontal
  // length, and both points below go through the same matrix anyway.
  const toWorld = hips.parent.matrixWorld;

  const axisA = target.hipsAxisA;
  const axisB = target.hipsAxisB;
  const axisUp = target.hipsUpAxis;

  // The bind hips, rebuilt from the three published components rather than read
  // off the live bone — the bone has been posed by the update call above.
  const bindLocal = new THREE.Vector3();
  bindLocal[axisA] = target.hipsBindA;
  bindLocal[axisB] = target.hipsBindB;
  bindLocal[axisUp] = target.hipsBindUp;
  const bindWorld = bindLocal.clone().applyMatrix4(toWorld);

  const sample = new THREE.Vector3();
  const world = new THREE.Vector3();
  const horizontal = () => Math.hypot(world.x - bindWorld.x, world.z - bindWorld.z);

  console.log(
    `[L5] root-motion residual, per clip. Armature-local ${axisA}/${axisB} pinned as ` +
      `horizontal, ${axisUp} kept as vertical. STRIPPED MUST READ 0.0000 m on every clip.`,
  );

  // Resolved the same way every other bone lookup in the project is, so a
  // sanitized "mixamorigHips" and a raw "mixamorig:Hips" both land — memoised
  // because resolveBoneByName reindexes the skeleton on every call and thirty
  // clips of 195 tracks would ask it the same question thousands of times.
  const isHipsNode = new Map();
  const nodeIsHips = (nodeName) => {
    let answer = isHipsNode.get(nodeName);
    if (answer === undefined) {
      answer = resolveBoneByName(target.skeleton, nodeName) === hips;
      isHipsNode.set(nodeName, answer);
    }
    return answer;
  };

  const width = Math.max(4, ...target.clips.map((clip) => clip.name.length));
  for (const clip of target.clips) {
    let track = null;
    for (const candidate of clip.tracks) {
      const dot = candidate.name.lastIndexOf('.');
      if (dot < 0 || candidate.name.slice(dot + 1) !== 'position') continue;
      if (!nodeIsHips(candidate.name.slice(0, dot))) continue;
      track = candidate;
      break;
    }

    if (!track) {
      console.log(`[L5] ${clip.name.padEnd(width)}  no hips position track — nothing to strip`);
      continue;
    }

    let unstripped = 0;
    let stripped = 0;
    for (let i = 0; i + 2 < track.values.length; i += 3) {
      sample.set(track.values[i], track.values[i + 1], track.values[i + 2]);
      world.copy(sample).applyMatrix4(toWorld);
      unstripped = Math.max(unstripped, horizontal());
      sample[axisA] = bindLocal[axisA];
      sample[axisB] = bindLocal[axisB];
      world.copy(sample).applyMatrix4(toWorld);
      stripped = Math.max(stripped, horizontal());
    }

    console.log(
      `[L5] ${clip.name.padEnd(width)}  unstripped ${unstripped.toFixed(4).padStart(8)} m   ` +
        `stripped ${stripped.toFixed(4).padStart(8)} m`,
    );
  }
}

/**
 * THE CLIP INVENTORY — every clip in the asset set, once, at load.
 *
 * Informational, and deliberately so. AN UNREFERENCED CLIP IS NOT AN ERROR: the
 * 30-animation asset ships the whole strike and transition inventory long
 * before anything registers any of it, so a readout that treated "present but
 * unused" as a fault would cry wolf for the rest of the phase.
 *
 * What it is actually for is the mirror question — a TUNING field naming a clip
 * the asset does NOT have. That case is silent at runtime by design: the back
 * node falls back to the forward walk and the action nodes fall back to a held
 * airborne pose rather than throwing, which is the right behaviour and also the
 * reason a typo in a clip name can survive a play session unnoticed. Those are
 * warned about by name below.
 */
function logClipInventory() {
  const fields = tuningClipFields();
  const rows = characterClips.map((clip) => ({
    name: clip.name,
    duration: clip.duration,
    tracks: clip.tracks.length,
    referencedBy: (fields.get(clip.name.toLowerCase()) || { paths: [] }).paths,
  }));

  const width = Math.max(4, ...rows.map((row) => row.name.length));
  console.log(
    `[clips] ${'clip'.padEnd(width)}  ${'dur (s)'.padStart(7)}  ${'tracks'.padStart(6)}  referenced by`,
  );
  for (const row of rows) {
    console.log(
      `[clips] ${row.name.padEnd(width)}  ${row.duration.toFixed(3).padStart(7)}  ` +
        `${String(row.tracks).padStart(6)}  ${row.referencedBy.join(', ') || '—'}`,
    );
  }

  const referenced = rows.filter((row) => row.referencedBy.length).length;
  console.log(
    `[clips] ${rows.length} clips in the asset set: ${referenced} referenced by a TUNING ` +
      `clip-name field, ${rows.length - referenced} unreferenced (not an error).`,
  );

  const present = new Set(rows.map((row) => row.name.toLowerCase()));
  for (const [key, entry] of fields) {
    if (present.has(key)) continue;
    console.warn(
      `[clips] TUNING names "${entry.name}" at ${entry.paths.join(', ')} and the asset set ` +
        `has no such clip. That field falls back rather than throwing, so it is silent at runtime.`,
    );
  }
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

  // AWAITED — the court is a GLB and the loop must not start on an empty world.
  // arena.js now owns adding the group, stamping ENVIRONMENT_GROUPS on its own
  // colliders and setting receiveShadow, all of which used to be done from here
  // with a comment explaining that arena.js was frozen. It is not any more, so
  // the stamps have moved next to the things they describe.
  arenaPreset = activeArenaPreset();
  console.log(`[arena] active type "${activeArenaType()}"`);
  const arena = await createArena(scene);

  // The words are derived in physics.js and the table is computed from them, so
  // the "no" in the motor/ball cell is evidence rather than a caption.
  logCollisionMatrix();

  motor = createMotor();
  // THE ATHLETE'S LANDING POINT, from the active preset.
  //
  // CONSTRUCTION, not gameplay: this runs in boot, before loop.start(), on a
  // body nothing has stepped yet. motor.js authors its own spawn from
  // TUNING.motor.spawnY and motor.js is frozen, so the arena's choice is applied
  // here instead. It does NOT join the play-code setTranslation census for the
  // same reason the RigidBodyDesc builders do not: it cannot be reached once the
  // loop is running.
  motor.body.setTranslation(
    { x: arenaPreset.spawn.x, y: arenaPreset.spawn.y, z: arenaPreset.spawn.z },
    true,
  );
  motor.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  motor.interpolated.reset(
    _bootSpawnPoint.set(arenaPreset.spawn.x, arenaPreset.spawn.y, arenaPreset.spawn.z),
  );
  // Construction-time, next to the collider it edits: the character rides the
  // sphere through tracking forces, not through contact, and its legs straddle
  // the ball by construction. See detachMotorFromRagdoll.
  detachMotorFromRagdoll(motor);
  scene.add(motor.mesh);
  motor.mesh.visible = TUNING.debug.showSphereWireframe;

  loop.register(motor.interpolated);

  // THE BALL joins the interpolation registry on exactly the terms the sphere
  // does — one Interpolated, registered once, snapshotted after the world step.
  // The before/after count is logged because "did the ball actually get
  // registered" is otherwise invisible until something renders at the wrong
  // alpha and nobody can say when it started.
  const registryBefore = loop.interpolated.length;
  // BUILT ONE AT A TIME, IN ARRAY ORDER, and awaited — both halves matter for
  // LAW 6.
  //
  // Awaited, because the optional skin must resolve before the loop starts: a
  // texture landing on a different frame in each run would make an anchored pair
  // differ over a picture rather than over the simulation.
  //
  // Sequential rather than Promise.all, because Rapier hands out body handles in
  // creation order and the solver walks bodies in handle order. With Promise.all
  // the three constructors interleave at their await points, and the creation
  // order would then depend on how fast a texture fetch resolved — which is not
  // a thing the simulation may depend on. A for-of loop makes the order a
  // property of the code instead of a property of the network.
  for (let i = 0; i < TUNING.balls.length; i += 1) {
    const spec = TUNING.balls[i];
    // The spawn comes from the ARENA, matched by index; everything else is the
    // ball's own. A preset with fewer spawns than balls falls back to the ball
    // defaults rather than stacking them all on one point.
    const spawn = arenaPreset.ballSpawns[i];
    const built = await createBall(scene, spawn ? { ...spec, spawn } : spec);
    balls.push(built);
    ballByHandle.set(built.collider.handle, built);
    loop.register(built.interpolated);
  }
  // The 1 m ball is the primary the HUD reports; see the declaration.
  ball = balls[1] || balls[0] || null;
  console.log(
    `[ball] ${balls.length} balls (${balls.map((b) => b.id).join(', ')}); ` +
      `interpolation registry ${registryBefore} -> ${loop.interpolated.length}; ` +
      `HUD primary "${ball ? ball.label : 'none'}"`,
  );

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

  armedCaptureTick = initCapture({
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
      // READ from the ball bodies; recomputes nothing the simulation knows.
      // `ball` is the primary (the 1 m medium); `balls` is all three, in the
      // order TUNING.balls authored them.
      ball: ball ? ballProbe(ball) : null,
      // READ from the strike state; the quality is the number the resolver
      // computed, never a second evaluation of the curve (LESSON 22).
      strike: strikeProbe(strikeState),
      balls: balls.map(ballProbe),
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
    onShowBallWireframeChange: (wireframe) => {
      for (const b of balls) b.mesh.material.wireframe = wireframe;
    },
    onCameraChange: applyCameraTuning,
    onRagdollVisibilityChange: () => applyRagdollVisibility(ragdoll, characterRoot),
    clipNames: characterClips.map((clip) => clip.name),
    tracker,
  });

  setHudVisible(TUNING.debug.showHud);

  // The arena logs its own construction now — one line for the bowl, three for
  // the court — because only arena.js knows which one it built.

  loop.start();
}

boot().catch((error) => {
  console.error('[boot] failed', error);
});
