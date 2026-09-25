import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { TUNING, assetUrl } from './config/tuning.js';
import { Loop } from './core/Loop.js';
import {
  initPhysics, stepPhysics, getWorld, drainContactForces, RAPIER,
  ENVIRONMENT_RAY_GROUPS, logCollisionMatrix,
} from './sim/physics.js';
import { createArena, activeArenaType, activeArenaPreset, getArenaColliderType } from './sim/arena.js';
import {
  createBall, resetBall, getCourtBallDropSpawn, applyBallResistance, noteBallContact, syncBallSnapshot, ballProbe,
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
  updateAthletePalette,
  updateAthleteVariant,
} from './sim/ragdoll.js';
import { applyClampedLinearDamping } from './sim/damping.js';
import { createAthlete } from './sim/athlete.js';
import { athleteManager } from './features/athletes/athleteManager.js';
import { matchManager } from './features/match/matchManager.js';
import {
  initInputRouter,
  sampleAllInputs,
  getInputSlot,
  consumeAthleteJump,
  consumeAthleteDive,
  consumeAthleteCut,
  consumeAthleteVolley,
  consumeAthleteSpike,
  consumeAthleteBallReset,
  consumeCameraCycle,
  consumeMenuToggle,
  getMouseDeltas,
  getControllerAssignments,
  exitGamePointerLock,
  triggerHaptic,
} from './input/inputRouter.js';
import { updateSportsCamera } from './visuals/sportsCamera.js';
import { createBotController, updateBot } from './ai/botController.js';
import { PlayerCamera } from './visuals/playerCamera.js';
import { CinematicCamera } from './visuals/cinematicCamera.js';
import { createTurfParticleSystem, getPitchSurfaceColor } from './visuals/turfParticles.js';
import { createGoalCelebrationSystem } from './visuals/goalCelebration.js';
import { initVictoryScreen, showVictoryScreen, hideVictoryScreen, showPracticeSummary } from './ui/victoryScreen.js';
import { initCountdownOverlay, updateCountdownOverlay, resetCountdownOverlay } from './ui/countdownOverlay.js';
import { initInGameMenu, toggleInGameMenu, hideInGameMenu, updateInGameMenuBanner, isInGameMenuOpen } from './ui/inGameMenu.js';
import {
  initMainMenu,
  initMobileNotice,
  showTitleScreen,
  showPlayerSetup,
  hideMainMenu,
  isMainMenuActive,
  showFlyoverOverlay,
  hideFlyoverOverlay,
  showMainMenuSettingsModal,
  getPlayerConfigs,
  getSelectedMatchBall,
  getColorName,
} from './features/ui/mainMenu/index.js';
import { createMountFollowerState, runMountFollower } from './mechanics/mountFollower.js';
import { createActionState, runActions } from './mechanics/actions.js';
import {
  createStrikeState, runStrikes, resolveStrikeContact, strikeProbe, checkStrikeAssist,
  KIND_NAME,
} from './mechanics/strikes.js';
import { createMatchState, updateScoring, matchProbe } from './mechanics/scoring.js';
import { createScoreboards, updateScoreboards } from './visuals/scoreboards.js';
import { createHustleBoards, updateHustleBoards } from './visuals/hustleBoards.js';
import { displayCoordinator } from './visuals/displayCoordinator.js';
import { soundManager } from './audio/soundManager.js';
import { createGui } from './debug/gui.js';
import { initCapture } from './debug/capture.js';
import { initStateTrace } from './debug/stateTrace.js';
import { readFixture, applyFixtureServes, fixtureParksBall } from './debug/fixture.js';

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
const _zeroVector = new THREE.Vector3(0, 0, 0);

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
/** Previous grounded state, for landing sound detection. */
let wasGrounded = true;
let lastFootstepSlot = -1;
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
const CHARACTER_URL = assetUrl('models/character.glb');
/** OPTIONAL. Absent today; extra clips beyond the character asset go here. */
const ACTIONS_URL = assetUrl('models/actions.glb');

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
    if (isHotkey(event, 'KeyT')) {
      for (const a of athletes) a.requestKnockdown();
    }
    // "Shift+H" or F3 — TOGGLE DEVELOPER TELEMETRY HUD
    if (isHotkey(event, 'F3') || (isHotkey(event, 'KeyH') && event.shiftKey)) {
      TUNING.debug.showHud = !TUNING.debug.showHud;
      setHudVisible(TUNING.debug.showHud);
    }
    // "1" — TOGGLE TEAM JERSEY (Home <-> Away) for P1
    if (isHotkey(event, 'Digit1')) {
      const p = TUNING.players[0] || TUNING.athlete;
      p.team = p.team === 'home' ? 'away' : 'home';
      TUNING.athlete.team = p.team;
      if (athletes[0]) athletes[0].setTeamAndVariant(p.team, null);
      if (guiInstance) guiInstance.controllersRecursive().forEach((c) => c.updateDisplay());
    }
    // "2" — CYCLE SILHOUETTE VARIANT (masculine -> feminine -> classic) for P1
    if (isHotkey(event, 'Digit2')) {
      const p = TUNING.players[0] || TUNING.athlete;
      const variants = ['masculine', 'feminine', 'classic'];
      const nextIdx = (variants.indexOf(p.variant) + 1) % variants.length;
      p.variant = variants[nextIdx];
      TUNING.athlete.variant = variants[nextIdx];
      if (athletes[0]) athletes[0].setTeamAndVariant(null, p.variant);
      if (guiInstance) guiInstance.controllersRecursive().forEach((c) => c.updateDisplay());
    }
    // "9" — TOGGLE TEAM JERSEY (Home <-> Away) for P2
    if (isHotkey(event, 'Digit9')) {
      if (TUNING.players[1]) {
        TUNING.players[1].team = TUNING.players[1].team === 'home' ? 'away' : 'home';
        if (athletes[1]) athletes[1].setTeamAndVariant(TUNING.players[1].team, null);
        if (guiInstance) guiInstance.controllersRecursive().forEach((c) => c.updateDisplay());
      }
    }
    // "0" — CYCLE SILHOUETTE VARIANT for P2
    if (isHotkey(event, 'Digit0')) {
      if (TUNING.players[1]) {
        const variants = ['masculine', 'feminine', 'classic'];
        const nextIdx = (variants.indexOf(TUNING.players[1].variant) + 1) % variants.length;
        TUNING.players[1].variant = variants[nextIdx];
        if (athletes[1]) athletes[1].setTeamAndVariant(null, TUNING.players[1].variant);
        if (guiInstance) guiInstance.controllersRecursive().forEach((c) => c.updateDisplay());
      }
    }
    // "V" — TOGGLE SPLITSCREEN MODE (Shift+V or F8 to avoid conflict with P1 Cut 'KeyV')
    if (isHotkey(event, 'F8') || (isHotkey(event, 'KeyV') && event.shiftKey)) {
      TUNING.camera.splitscreen = !TUNING.camera.splitscreen;
      applyViewportSize();
      if (guiInstance) guiInstance.controllersRecursive().forEach((c) => c.updateDisplay());
    }
    // Skip flyover cutscene with Space, Enter, or Escape
    if (gameState === 'flyover' && (isHotkey(event, 'Space') || isHotkey(event, 'Enter') || isHotkey(event, 'Escape'))) {
      skipFlyover();
      return;
    }
    // "Escape" — TOGGLE IN-GAME SETTINGS & PAUSE MENU (continuous play clock)
    if (isHotkey(event, 'Escape')) {
      if (gameState === 'menu') {
        showTitleScreen();
      } else {
        toggleInGameMenu(playerCameras[0]?.mode, playerCameras[1]?.mode);
      }
    }
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
renderer.shadowMap.type = THREE.PCFShadowMap;
// splitscreen optimization: disable autoUpdate so we don't re-render 4 shadow maps
// for every viewport pass. We flag needsUpdate once per frame before rendering.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d12);

// scene.add(new THREE.AxesHelper(2));

// 4-CORNER STADIUM FLOODLIGHT RIG
// 4 high towers positioned outside the court corners aimed down at the arena.
// Produces 4 soft, distinct shadows fanning out under the ball and athlete,
// converging at ground contact to give clear depth and spatial cues.
const stadiumTowers = [
  { name: 'NE', pos: [32, 28, -50], intensity: 0.85 },
  { name: 'NW', pos: [-32, 28, -50], intensity: 0.85 },
  { name: 'SE', pos: [32, 28, 50], intensity: 0.85 },
  { name: 'SW', pos: [-32, 28, 50], intensity: 0.85 }
];

const stadiumLights = [];
for (const tower of stadiumTowers) {
  const light = new THREE.DirectionalLight(0xffffff, tower.intensity);
  light.position.set(...tower.pos);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.left = -45;
  light.shadow.camera.right = 45;
  light.shadow.camera.top = 45;
  light.shadow.camera.bottom = -45;
  light.shadow.camera.near = 1.0;
  light.shadow.camera.far = 130;
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;
  scene.add(light);
  stadiumLights.push(light);
}

scene.add(new THREE.AmbientLight(0x8fb4d6, 0.45));

/**
 * PLAYER CAMERAS — independent rigs for splitscreen and single screen.
 */
const playerCameras = [
  new PlayerCamera(0, TUNING.players[0]?.cameraMode || 'chase'),
  new PlayerCamera(1, TUNING.players[1]?.cameraMode || 'chase'),
];
const turfParticles = createTurfParticleSystem(scene);
const goalCelebration = createGoalCelebrationSystem(scene);

const _pitchRayOrigin = { x: 0, y: 0, z: 0 };
const _pitchRayDown = { x: 0, y: -1, z: 0 };
let _pitchRay = null;

function queryPitchSurfaceY(x, z, refY = 1.0) {
  const world = getWorld();
  if (!world) return Math.max(0, refY - 0.5);
  if (!_pitchRay) _pitchRay = new RAPIER.Ray(_pitchRayOrigin, _pitchRayDown);
  _pitchRayOrigin.x = x;
  _pitchRayOrigin.y = Math.max(refY + 1.5, 2.0);
  _pitchRayOrigin.z = z;
  const hit = world.castRay(
    _pitchRay, 5.0, true, undefined, ENVIRONMENT_RAY_GROUPS,
  );
  if (hit) {
    return _pitchRayOrigin.y - hit.timeOfImpact;
  }
  return Math.max(0, refY - 0.5);
}
const camera = playerCameras[0].camera;
const cameraRig = playerCameras[0]; // backward compatibility for debug capture & telemetry

const spectatorCamera = new THREE.PerspectiveCamera(
  TUNING.camera.fov,
  window.innerWidth / window.innerHeight,
  TUNING.camera.near,
  TUNING.camera.far,
);

const cinematicCamera = new CinematicCamera();
let gameState = 'menu'; // 'menu' | 'flyover' | 'match' | 'practice'
let victoryCameraActive = false;

const _camTarget = new THREE.Vector3();
const _camOffset = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _camDesired = new THREE.Vector3();

function cycleCameraMode(playerIndex = 0) {
  const pc = playerCameras[playerIndex] || playerCameras[0];
  const isSplitscreen = (gameState === 'match') && !!TUNING.camera.splitscreen && athletes.length >= 2;
  const mode = pc.cycleMode(isSplitscreen);
  if (TUNING.players[playerIndex]) TUNING.players[playerIndex].cameraMode = mode;
  if (playerIndex === 0) TUNING.camera.mode = mode;
  applyViewportSize();
}

/** Applied at boot and from the GUI. Never from the render pass. */
function applyCameraTuning() {
  for (const pc of playerCameras) {
    pc.camera.fov = TUNING.camera.fov;
    pc.camera.updateProjectionMatrix();
  }
  cinematicCamera.camera.fov = TUNING.camera.fov;
  cinematicCamera.camera.updateProjectionMatrix();
  spectatorCamera.fov = TUNING.camera.fov;
  spectatorCamera.updateProjectionMatrix();
}

/**
 * Sizes the renderer and the camera projection to the window.
 */
function applyViewportSize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  let ratio = Math.min(window.devicePixelRatio || 1, MAX_LIVE_PIXEL_RATIO);
  const preset = TUNING.render?.pixelRatioPreset;
  if (preset === '1.0') {
    ratio = 1.0;
  } else if (preset === '1.25') {
    ratio = Math.min(1.25, window.devicePixelRatio || 1);
  } else if (preset === 'native') {
    ratio = Math.min(window.devicePixelRatio || 1, MAX_LIVE_PIXEL_RATIO);
  }

  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height);

  cinematicCamera.camera.aspect = width / height;
  cinematicCamera.camera.updateProjectionMatrix();

  spectatorCamera.aspect = width / height;
  spectatorCamera.updateProjectionMatrix();

  const p1CamMode = playerCameras[0]?.mode;
  const p2CamMode = playerCameras[1]?.mode;
  const isSharedCam = (p1CamMode === 'broadcast' && p2CamMode === 'broadcast') ||
                      (p1CamMode === 'sports' && p2CamMode === 'sports');
  const isSplitscreen = (gameState === 'match') && !!TUNING.camera.splitscreen && athletes.length >= 2 && !isSharedCam;

  // Broadcast and Sports cameras are full-screen only: if in individual splitscreen, revert them to chase
  if (isSplitscreen) {
    if (playerCameras[0] && (playerCameras[0].mode === 'sports' || playerCameras[0].mode === 'broadcast')) {
      playerCameras[0].mode = 'chase';
      if (TUNING.players[0]) TUNING.players[0].cameraMode = 'chase';
    }
    if (playerCameras[1] && (playerCameras[1].mode === 'sports' || playerCameras[1].mode === 'broadcast')) {
      playerCameras[1].mode = 'chase';
      if (TUNING.players[1]) TUNING.players[1].cameraMode = 'chase';
    }
  }

  const aspect = isSplitscreen ? (width / 2) / height : width / height;

  playerCameras[0].camera.aspect = aspect;
  playerCameras[0].camera.updateProjectionMatrix();
  playerCameras[1].camera.aspect = aspect;
  playerCameras[1].camera.updateProjectionMatrix();
}

function applyShadowSettings() {
  const quality = TUNING.render?.shadowQuality || 'high';
  if (quality === 'off') {
    renderer.shadowMap.enabled = false;
    for (const light of stadiumLights) {
      light.castShadow = false;
    }
  } else if (quality === 'balanced') {
    renderer.shadowMap.enabled = true;
    if (stadiumLights.length > 0) {
      stadiumLights[0].castShadow = true;
    }
    for (let i = 1; i < stadiumLights.length; i++) {
      stadiumLights[i].castShadow = false;
    }
  } else {
    // 'high' - all 4 towers cast shadows
    renderer.shadowMap.enabled = true;
    for (const light of stadiumLights) {
      light.castShadow = true;
    }
  }
  renderer.shadowMap.needsUpdate = true;
}
applyShadowSettings();

function applyRenderSettings(settings = {}) {
  if (settings.pixelRatioPreset) {
    if (!TUNING.render) TUNING.render = {};
    TUNING.render.pixelRatioPreset = settings.pixelRatioPreset;
    applyViewportSize();
  }
  if (settings.shadowQuality) {
    if (!TUNING.render) TUNING.render = {};
    TUNING.render.shadowQuality = settings.shadowQuality;
    applyShadowSettings();
  }
  if (settings.showControlsOverlay !== undefined) {
    const controlsCard = document.getElementById('controls-card');
    if (controlsCard) {
      controlsCard.style.display = settings.showControlsOverlay ? 'flex' : 'none';
    }
  }
  if (settings.showTuningGui !== undefined && guiInstance) {
    if (settings.showTuningGui) {
      guiInstance.show();
    } else {
      guiInstance.hide();
    }
  }
  if (guiInstance) {
    guiInstance.controllersRecursive().forEach((c) => c.updateDisplay());
  }
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
const hudCamMode = document.getElementById('hud-cammode');
const hudScore = document.getElementById('hud-score');
const hudDrag = document.getElementById('hud-drag');
const hudLoco = document.getElementById('hud-loco');
const hudArm = document.getElementById('hud-arm');
const hudAction = document.getElementById('hud-action');
const hudShares = document.getElementById('hud-shares');

/** Init- and GUI-time only. Never called from the render pass. */
function setHudVisible(visible) {
  hud.style.display = visible ? '' : 'none';
}

/**
 * @param {object|null} match this frame's matchProbe snapshot, or null before
 *   the match state exists.
 */
function updateHud(match) {
  if (!TUNING.debug.showHud) return;

  const a0 = athletes[0];
  const mtr = a0 ? a0.motor : motor;
  const trk = a0 ? a0.tracker : tracker;
  const tgt = a0 ? a0.animTarget : animTarget;
  const act = a0 ? a0.actionState : actionState;
  const stk = a0 ? a0.strikeState : strikeState;

  hudTick.textContent = String(loop.tick);
  hudAlpha.textContent = loop.alpha.toFixed(2);
  hudSteps.textContent = String(loop.stepsThisFrame);
  hudFrameTime.textContent = `${loop.frameTimeMs.toFixed(2)} ms`;
  hudDisplayHz.textContent = `${loop.displayHz.toFixed(1)} Hz`;
  hudDrift.textContent = `${loop.driftMs.toFixed(1)} ms`;
  hudSpeed.textContent = mtr ? `${horizontalSpeed(mtr).toFixed(2)} m/s` : '—';
  hudGrounded.textContent = mtr ? String(mtr.grounded) : '—';
  hudWeight.textContent = trk ? trk.weight.toFixed(2) : '—';
  hudAnimSpeed.textContent = tgt ? tgt.smoothedSpeed.toFixed(2) : '—';
  hudBlend.textContent = tgt
    ? `${tgt.gait.idle.toFixed(2)} ${tgt.gait.walk.toFixed(2)} ` +
      `${tgt.gait.run.toFixed(2)} ${tgt.gait.sprint.toFixed(2)}`
    : '—';
  hudDirection.textContent = tgt
    ? tgt.direction.map((d) => d.toFixed(2)).join(' ')
    : '—';
  hudBackNode.textContent = tgt
    ? `${tgt.weights.walkB.toFixed(2)} ${tgt.nodes.walk.b.name} / ` +
      `${tgt.weights.runB.toFixed(2)} ${tgt.nodes.run.b.name}`
    : '—';
  hudLocalVel.textContent = tgt
    ? `${tgt.localVelX.toFixed(2)} / ${tgt.localVelZ.toFixed(2)}`
    : '—';
  hudSprint.textContent = getInputSlot(0).sprintHeld ? 'SPRINT' : '—';
  hudAirborne.textContent = tgt
    ? `${tgt.airborneMix.toFixed(2)} / ${tgt.jumpPhase.toFixed(2)} / ${tgt.jumpClipMix.toFixed(2)}`
    : '—';
  hudDrag.textContent = lastResistanceScale.toFixed(2);
  hudArm.textContent =
    `${cameraRig.currentDistance.toFixed(3)} / ${cameraRig.azimuth.toFixed(2)} / ${cameraRig.pitch.toFixed(2)}`;

  const diveReady = act
    ? Math.max(0, TUNING.action.diveCooldownTicks - (loop.tick - act.lastDiveTick))
    : 0;
  hudAction.textContent = act
    ? `${act.slideTime} / ${act.divePending ? 'DIVE' : '—'} / cd ${Number.isFinite(diveReady) ? Math.round(diveReady) : 0}`
    : '—';

  if (tgt) {
    const sh = tgt.shares;
    hudShares.textContent =
      `${sh.stand.toFixed(2)} ${sh.action.toFixed(2)} ${sh.air.toFixed(2)} ${sh.loco.toFixed(2)}`;
  } else {
    hudShares.textContent = '—';
  }
  hudLoco.textContent = tgt
    ? tgt.shares.loco < 0.005
      ? '0.00'
      : tgt.shares.loco.toFixed(2)
    : '—';

  const age = trk ? loop.tick - trk.lastImpactTick : Infinity;
  hudImpact.textContent =
    trk && trk.lastImpactKey && age <= TUNING.impact.hudHoldTicks
      ? `${trk.lastImpactKey} ${Math.round(trk.lastImpactExcess)}`
      : '—';

  hudStandUp.textContent = tgt
    ? `${tgt.standUpNeed.toFixed(2)} / ${tgt.standUpProgress.toFixed(2)} / ${tgt.pelvisDownness.toFixed(2)}`
    : '—';

  if (ball) {
    const b = ballProbe(ball);
    hudBall.textContent = `${b.label}  ${b.speed.toFixed(2)} m/s / ${
      Number.isFinite(b.heightAboveFloor) ? b.heightAboveFloor.toFixed(3) : '—'
    } m`;
    let latest = null;
    for (const other of balls) {
      if (other.lastTouchKey && (!latest || other.lastTouchTick > latest.lastTouchTick)) {
        latest = other;
      }
    }
    hudBallTouch.textContent = latest
      ? `${latest.id}:${latest.lastTouchKey} @${latest.lastTouchTick} ${latest.lastTouchForce.toFixed(1)} N`
      : '—';
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

  const st = stk ? strikeProbe(stk) : strikeProbe(strikeState);
  const row = st.kind === 'spike'
    ? TUNING.strike.spike
    : (st.kind === 'kick' ? TUNING.strike.kick : TUNING.strike.volley);
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
  const attempts = st.attempts || (st.resolvedCount + st.whiffCount);
  const assisted = st.assistedCount || 0;
  const assistTag = assisted > 0 ? ` (${assisted} assisted)` : '';
  hudStrikeRate.textContent = `${st.resolvedCount}${assistTag} / ${attempts}` +
    (Number.isFinite(st.hitRate) ? `  (${(st.hitRate * 100).toFixed(0)}%)` : '');

  // Guarded rather than assumed: the span is new, and a stale index.html should
  // cost the mode readout and nothing else.
  if (hudCamMode) hudCamMode.textContent = `${TUNING.camera.mode.toUpperCase()} [Tab / D-Pad]`;

  // THE FLOATING SCORE LINE STAYS, and stays exactly as gated as it already
  // was. setHudVisible() hides the whole #hud block, so switching the HUD off
  // for a clean diegetic view already takes this line with it — there is
  // nothing to remove, and removing it would cost the debug readout its clock.
  if (hudScore && match) {
    const m = match;
    const mins = Math.floor(m.ticksRemaining / 3600);
    const secs = Math.floor((m.ticksRemaining % 3600) / 60);
    const clock = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    hudScore.textContent =
      `${m.scoreHome} - ${m.scoreAway}  ->goal ${m.targetGoal}  ` +
      `${m.mode === 'match' ? clock : 'practice'}${m.matchOver ? '  FULL TIME' : ''}`;
  }

  const ctrlVal = document.getElementById('controls-assignment-val');
  if (ctrlVal) {
    const assignments = getControllerAssignments(athletes.length, TUNING.match.mode);
    if (TUNING.match.mode === 'match') {
      ctrlVal.textContent = `P1: ${assignments.p1}  |  P2: ${assignments.p2}`;
    } else {
      ctrlVal.textContent = `P1: ${assignments.p1}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

let athletes = [];
/**
 * BOT CONTROLLERS — one per AI-controlled slot. Empty means all human.
 * Created by handleStartMatch when a player is configured as 'ai'.
 */
let botControllers = [];
/** Which input slot indices are bot-controlled (passed to sampleAllInputs). */
let activeBotSlots = [];
const athleteMatchStats = [
  { totalTouches: 0, sweetSpotHits: 0, spikes: 0, dives: 0, divingHits: 0, defensiveBlocks: 0, ownCircleTouches: 0, oppCircleTouches: 0 },
  { totalTouches: 0, sweetSpotHits: 0, spikes: 0, dives: 0, divingHits: 0, defensiveBlocks: 0, ownCircleTouches: 0, oppCircleTouches: 0 },
];
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
let allBalls = [];
let currentMatchBallType = 'random';

function setActiveMatchBall(typeOrIndex = 'random') {
  if (allBalls.length === 0) return null;

  if (typeOrIndex === 'all') {
    for (const b of allBalls) {
      b.mesh.visible = true;
      b.body.setEnabled(true);
    }
    balls = [...allBalls];
    ball = allBalls[1] || allBalls[0];
    console.log('[ball] active ball set to ALL 3 BALLS [SANDBOX]');
    return ball;
  }

  let chosenIdx = 1; // default medium
  if (typeof typeOrIndex === 'number') {
    chosenIdx = Math.abs(typeOrIndex) % allBalls.length;
  } else if (typeOrIndex === 'small') {
    chosenIdx = 0;
  } else if (typeOrIndex === 'medium') {
    chosenIdx = 1;
  } else if (typeOrIndex === 'large') {
    chosenIdx = 2;
  } else {
    // 'random'
    chosenIdx = Math.floor(Math.random() * allBalls.length);
  }

  for (let i = 0; i < allBalls.length; i++) {
    const b = allBalls[i];
    if (i === chosenIdx) {
      b.mesh.visible = true;
      b.body.setEnabled(true);
    } else {
      b.mesh.visible = false;
      b.body.setTranslation({ x: 0, y: -200, z: 0 }, true);
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.body.setEnabled(false);
    }
  }

  const chosenBall = allBalls[chosenIdx];
  balls = [chosenBall];
  ball = chosenBall;
  console.log(`[ball] active match ball set to ${chosenBall.label} (index ${chosenIdx})`);
  return chosenBall;
}
/** The match: score, target end and clock. Created in boot, one per session. */
let matchState = null;
/**
 * THE FOUR BOUNDARY SCOREBOARDS. Render-side only: no body, no collider, no
 * entry in loop.interpolated. Built in boot after the arena, so its measured
 * wall positions are already on screen when the boards mount to them.
 */
let scoreboards = null;
let hustleBoards = null;
export const practiceStats = {
  goals: 0,
  hits: 0,
  whiffs: 0,
  sweetSpots: 0,
  spikes: 0,
  dives: 0,
  divingHits: 0,
  defensiveBlocks: 0,
  totalTouches: 0,
};
let practiceSessionTicks = 0;
let selectedPracticeBallType = 'all';
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
/** Harness-only ball fixture (?balls=, ?serve=), read at boot for armed runs. See debug/fixture.js. */
let captureFixture = null;
const tracker = createTracker();

/** gltf.animations, kept so the GUI can offer the clip list. */
let characterClips = [];

/** The loaded glTF scene and its one shared skeleton. Null if the load failed. */
let characterRoot = null;
let characterSkeleton = null;

/** The live ragdoll, or null. Rebuilt wholesale on every spawn. */
let ragdoll = null;

/** The lil-gui instance, for live display sync. */
let guiInstance = null;

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
    item.collider.setContactForceEventThreshold(1.0);
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
    // IS THE CAMERA BEHIND HIM? The ghost needs to know, because "face the
    // camera when you stop" is right under a chase shot and turns the athlete
    // to face the stands under a sideline one. It comes through HERE rather
    // than sim/ reading TUNING.camera, for the same reason everything else
    // does: the fixed step may not read render state.
    //
    // LISTED POSITIVELY, so a mode added later and forgotten gets the fixed-shot
    // behaviour — facing its own travel heading, which is wrong in no camera —
    // rather than silently inheriting camera-relative facing, which is wrong in
    // every camera but these two.
    facingFollowsCamera:
      TUNING.camera.mode === 'chase' || TUNING.camera.mode === 'ball',
    hasAim: input.hasAim || false,
    aimYaw: input.aimYaw || 0,
    moveWorldX: input.moveWorld ? input.moveWorld.x : 0,
    moveWorldZ: input.moveWorld ? input.moveWorld.z : 0,
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
  drainContactForces((handle1, handle2, totalForce) => {
    const hitBall = ballByHandle.get(handle1) || ballByHandle.get(handle2);
    if (hitBall) {
      const other = handle1 === hitBall.collider.handle ? handle2 : handle1;
      let athleteHit = null;
      let hitInfo = null;
      for (const a of athletes) {
        const hit = a.ownsCollider(other);
        if (hit) {
          athleteHit = a;
          hitInfo = hit;
          break;
        }
      }

      if (athleteHit) {
        const limbKey = hitInfo.isMotor ? null : hitInfo.key;
        noteBallContact(hitBall, other, limbKey, athleteHit.motor.collider.handle, totalForce, tick);
        const didStrike = resolveStrikeContact(athleteHit.strikeState, hitBall, limbKey, totalForce, tick);
        const ballPos = hitBall.body.translation();

        // Track live match & practice statistics
        const athleteIdx = athletes.indexOf(athleteHit);
        if (athleteIdx >= 0) {
          // Touch cooldown: only allow a touch to register once every 0.25 seconds (15 ticks at 60Hz)
          const touchCooldownTicks = Math.round(0.25 * TUNING.loop.fixedHz);
          const lastTouch = athleteHit._lastTouchTick ?? -999;
          const isNewTouch = (tick - lastTouch) >= touchCooldownTicks;

          if (isNewTouch) {
            athleteHit._lastTouchTick = tick;
            if (athleteMatchStats[athleteIdx] && gameState === 'match') {
              athleteMatchStats[athleteIdx].totalTouches++;

              const distToSouthCircle = Math.hypot(ballPos.x, ballPos.z - 40.0);
              const distToNorthCircle = Math.hypot(ballPos.x, ballPos.z - (-40.0));
              const isHome = (TUNING.players[athleteIdx]?.team || (athleteIdx === 0 ? 'home' : 'away')) === 'home';
              const homeAttacksNorth = matchState?.targetGoal === 'N';
              const athleteAttacksNorth = isHome ? homeAttacksNorth : !homeAttacksNorth;
              const inAttackingCircle = athleteAttacksNorth ? (distToNorthCircle <= 11.5) : (distToSouthCircle <= 11.5);
              const inDefensiveCircle = athleteAttacksNorth ? (distToSouthCircle <= 11.5) : (distToNorthCircle <= 11.5);

              if (inDefensiveCircle) athleteMatchStats[athleteIdx].ownCircleTouches++;
              if (inAttackingCircle) athleteMatchStats[athleteIdx].oppCircleTouches++;
            } else if (athleteIdx === 0 && gameState === 'practice') {
              practiceStats.totalTouches++;
            }
          }

          // Diving hit / save detection (on any contact while diving)
          if (athleteHit.isDiving && athleteHit.isDiving(tick)) {
            const lastDivingHit = athleteHit._lastDivingHitTick ?? -999;
            if ((tick - lastDivingHit) >= touchCooldownTicks) {
              athleteHit._lastDivingHitTick = tick;
              if (gameState === 'match' && athleteMatchStats[athleteIdx]) {
                athleteMatchStats[athleteIdx].divingHits++;
              } else if (athleteIdx === 0 && gameState === 'practice') {
                practiceStats.divingHits++;
              }
            }
          }

          if (didStrike && athleteHit.strikeState) {
            const quality = athleteHit.strikeState.lastContactQuality;
            const kind = athleteHit.strikeState.lastStrikeKind;

            if (gameState === 'match' && athleteMatchStats[athleteIdx]) {
              if (quality >= 0.80) {
                athleteMatchStats[athleteIdx].sweetSpotHits++;
              }
              if (kind === 2) {
                athleteMatchStats[athleteIdx].spikes++;
              }
            } else if (athleteIdx === 0 && gameState === 'practice') {
              if (quality >= 0.80) {
                practiceStats.sweetSpots++;
              }
              if (kind === 2) {
                practiceStats.spikes++;
              }
            }
          }
        }

        if (didStrike) {
          const kind = KIND_NAME[athleteHit.strikeState.lastStrikeKind] || 'volley';
          const quality = athleteHit.strikeState.lastContactQuality || 0.5;
          const isSpike = (kind === 'spike');
          const isSweetSpot = (quality >= 0.75);

          soundManager.playStrike(kind, quality, athleteHit.strikeState.lastLaunchSpeed, ballPos, hitBall.radius || 0.5);
          if (isSweetSpot || isSpike) {
            soundManager.playSweetSpotPop(ballPos, isSpike);
          }

          // Camera juice: FOV lens punch and softened micro-screenshake scaled by strike impact
          // Routine volleys, kicks, and underhand touches have ZERO trauma (no screenshake)
          let fovPunch = -0.6;
          let trauma = 0.0;
          if (isSpike) {
            fovPunch = TUNING.camera.fovPunch?.strikePunch ?? -2.5;
            trauma = 0.22;
          } else if (isSweetSpot) {
            fovPunch = -1.5;
            trauma = 0.12;
          }

          if (athleteIdx >= 0 && playerCameras[athleteIdx]) {
            playerCameras[athleteIdx].punchFov(fovPunch);
            if (trauma > 0) playerCameras[athleteIdx].addTrauma(trauma);
          } else {
            for (const pc of playerCameras) {
              pc.punchFov(fovPunch);
              if (trauma > 0) pc.addTrauma(trauma);
            }
          }

          // Non-abrasive juice 1: Dual-tier warm gold ball emissive bloom pulse
          hitBall._emissiveFlash = isSpike ? 2.5 : (isSweetSpot ? 1.5 : 0.6);
        } else {
          const vel = hitBall.body.linvel();
          const speed = Math.hypot(vel.x, vel.y, vel.z);

          soundManager.playPlayerBallImpact(speed, ballPos, hitBall.radius || 0.5);

          // High-speed ball impact knockdown
          const mass = typeof hitBall.body.mass === 'function' ? hitBall.body.mass() : 2.2;
          const momentum = speed * mass;
          const isTorsoOrHead = limbKey === 'chest' || limbKey === 'head' || limbKey === 'spine' || limbKey === 'pelvis';
          if (isTorsoOrHead && (speed > 14.0 || momentum > 32.0)) {
            queueKnockdown(athleteHit.tracker, 0.18);
            soundManager.playAthleteAction('land', athleteHit.motor.body.translation());
            for (const pc of playerCameras) {
              pc.addTrauma(0.24);
            }
            if (athleteIdx >= 0) {
              triggerHaptic(athleteIdx, {
                weakMagnitude: TUNING.input?.haptics?.knockdownWeak ?? 0.35,
                strongMagnitude: TUNING.input?.haptics?.knockdownStrong ?? 0.15,
                duration: TUNING.input?.haptics?.knockdownDuration ?? 80,
              });
            }
          }
        }
      } else {
        // Ball bounced against the environment (boundary wall, goal hoop, or court floor)
        const vel = hitBall.body.linvel();
        const speed = Math.hypot(vel.x, vel.y, vel.z);
        const arenaType = getArenaColliderType(other);
        const ballPos = hitBall.body.translation();

        if (arenaType === 'goal') {
          soundManager.playHoopClank(speed, ballPos);
        } else if (arenaType === 'boundary' && ballPos.y >= 13.0) {
          soundManager.playGlassImpact(speed, ballPos);
        } else {
          const wasInAir = (tick - (hitBall._lastGroundTick || 0)) > 10;
          hitBall._lastGroundTick = tick;

          const vyAbs = Math.abs(vel.y);
          const isBounceImpact = (wasInAir && (vyAbs > 0.35 || speed > 1.2)) || vyAbs >= 0.60;

          if (isBounceImpact && (tick - (hitBall._lastBounceTick || 0)) > 8) {
            hitBall._lastBounceTick = tick;
            const isRiver = Math.abs(ballPos.x) < 2.5;
            const bounceSpeed = Math.max(vyAbs, speed * 0.45);
            soundManager.playBallBounce(
              hitBall.radius || 0.5,
              bounceSpeed,
              isRiver ? 'river' : 'court',
              ballPos,
            );
          }
        }
      }
      return;
    }

    // Athlete-to-athlete direct collision check
    let athlete1 = null;
    let hit1 = null;
    let athlete2 = null;
    let hit2 = null;
    for (const a of athletes) {
      const h1 = a.ownsCollider(handle1);
      if (h1) { athlete1 = a; hit1 = h1; }
      const h2 = a.ownsCollider(handle2);
      if (h2) { athlete2 = a; hit2 = h2; }
    }
    if (athlete1 && athlete2 && athlete1 !== athlete2) {
      handleAthleteCollision(athlete1, athlete2, hit1, hit2, totalForce, tick);
    }

    // Body impacts (athlete vs world or athlete vs athlete)
    for (const a of athletes) {
      const hit = a.impactByHandle.get(handle1) || a.impactByHandle.get(handle2);
      if (hit) {
        const isSliding = a.actionState && a.actionState.slideTime > 0;
        if (!isSliding && totalForce >= TUNING.impact.eventThreshold) {
          a.impactEvents.push({ key: hit.key, group: hit.group, force: totalForce });
        }
      }
    }
  });

  for (const a of athletes) {
    applyImpacts(a.tracker, a.impactEvents, tick, dt);
    a.impactEvents.length = 0;
  }
}

/**
 * Handles physical reactions and slide-tackle knockdowns when two athletes collide.
 *
 * GROUND-PLANE PHYSICS ONLY:
 * All impulses are strictly horizontal (y = 0.0) so athletes stay grounded on the pitch
 * rather than launching or bouncing into the air.
 */
function handleAthleteCollision(a1, a2, hit1, hit2, totalForce, tick) {
  if (!a1 || !a2 || !a1.motor?.body || !a2.motor?.body) return;

  const idx1 = athletes.indexOf(a1);
  const idx2 = athletes.indexOf(a2);

  const isA1Sliding = a1.actionState && a1.actionState.slideTime > 0;
  const isA2Sliding = a2.actionState && a2.actionState.slideTime > 0;

  // 1. SLIDE TACKLE: Slider sweeps victim's lower limbs along the turf; victim trips and collapses
  if (isA1Sliding && !isA2Sliding) {
    const speed1 = horizontalSpeed(a1.motor);
    if (speed1 > 5.5 && (tick - (a1._lastTackleTick || 0)) > 15) {
      a1._lastTackleTick = tick;
      // Complete limp collapse on the turf
      queueKnockdown(a2.tracker, 0.0);
      const v1 = a1.motor.body.linvel();

      // Victim swept along the turf (y = 0.0, no vertical catapult)
      a2.motor.body.applyImpulse({ x: v1.x * 0.45, y: 0.0, z: v1.z * 0.45 }, true);

      // Physically kick the victim's hit leg forward in the ragdoll solver
      const victimLimbKey = (hit2 && !hit2.isMotor && hit2.key) || 'shinL';
      const victimLimbGroup = (hit2 && !hit2.isMotor && hit2.group) || 'legs';
      if (a2.impactEvents) {
        a2.impactEvents.push({ key: victimLimbKey, group: victimLimbGroup, force: 16.0 });
      }

      // Slider retains forward momentum and cuts through along the turf (y = 0.0)
      a1.motor.body.applyImpulse({ x: -v1.x * 0.12, y: 0.0, z: -v1.z * 0.12 }, true);

      const p1 = a1.motor.body.translation();
      const p2 = a2.motor.body.translation();
      const midPos = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5, z: (p1.z + p2.z) * 0.5 };
      soundManager.playAthleteAction('slide', midPos);
      soundManager.playBodyCollision(1.0, midPos);
      for (const pc of playerCameras) pc.addTrauma(0.22);
      if (idx1 >= 0) {
        triggerHaptic(idx1, {
          weakMagnitude: TUNING.input?.haptics?.tackleWeak ?? 0.35,
          strongMagnitude: TUNING.input?.haptics?.tackleStrong ?? 0.15,
          duration: TUNING.input?.haptics?.tackleDuration ?? 80,
        });
      }
      if (idx2 >= 0) {
        triggerHaptic(idx2, {
          weakMagnitude: TUNING.input?.haptics?.tackleWeak ?? 0.35,
          strongMagnitude: TUNING.input?.haptics?.tackleStrong ?? 0.15,
          duration: TUNING.input?.haptics?.tackleDuration ?? 80,
        });
      }
      return;
    }
  } else if (isA2Sliding && !isA1Sliding) {
    const speed2 = horizontalSpeed(a2.motor);
    if (speed2 > 5.5 && (tick - (a2._lastTackleTick || 0)) > 15) {
      a2._lastTackleTick = tick;
      // Complete limp collapse on the turf
      queueKnockdown(a1.tracker, 0.0);
      const v2 = a2.motor.body.linvel();

      // Victim swept along the turf (y = 0.0, no vertical catapult)
      a1.motor.body.applyImpulse({ x: v2.x * 0.45, y: 0.0, z: v2.z * 0.45 }, true);

      // Physically kick the victim's hit leg forward in the ragdoll solver
      const victimLimbKey = (hit1 && !hit1.isMotor && hit1.key) || 'shinL';
      const victimLimbGroup = (hit1 && !hit1.isMotor && hit1.group) || 'legs';
      if (a1.impactEvents) {
        a1.impactEvents.push({ key: victimLimbKey, group: victimLimbGroup, force: 16.0 });
      }

      // Slider retains forward momentum and cuts through along the turf (y = 0.0)
      a2.motor.body.applyImpulse({ x: -v2.x * 0.12, y: 0.0, z: -v2.z * 0.12 }, true);

      const p1 = a1.motor.body.translation();
      const p2 = a2.motor.body.translation();
      const midPos = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5, z: (p1.z + p2.z) * 0.5 };
      soundManager.playAthleteAction('slide', midPos);
      soundManager.playBodyCollision(1.0, midPos);
      for (const pc of playerCameras) pc.addTrauma(0.22);
      if (idx1 >= 0) {
        triggerHaptic(idx1, {
          weakMagnitude: TUNING.input?.haptics?.tackleWeak ?? 0.35,
          strongMagnitude: TUNING.input?.haptics?.tackleStrong ?? 0.15,
          duration: TUNING.input?.haptics?.tackleDuration ?? 80,
        });
      }
      if (idx2 >= 0) {
        triggerHaptic(idx2, {
          weakMagnitude: TUNING.input?.haptics?.tackleWeak ?? 0.35,
          strongMagnitude: TUNING.input?.haptics?.tackleStrong ?? 0.15,
          duration: TUNING.input?.haptics?.tackleDuration ?? 80,
        });
      }
      return;
    }
  } else if (isA1Sliding && isA2Sliding) {
    // Both sliding: head-on clash on the turf
    if ((tick - (a1._lastTackleTick || 0)) > 15) {
      a1._lastTackleTick = tick;
      a2._lastTackleTick = tick;
      queueKnockdown(a1.tracker, 0.0);
      queueKnockdown(a2.tracker, 0.0);
      const v1 = a1.motor.body.linvel();
      const v2 = a2.motor.body.linvel();
      // Ground-plane mutual absorption (y = 0.0, no airborne launch)
      a1.motor.body.applyImpulse({ x: -v1.x * 0.6, y: 0.0, z: -v1.z * 0.6 }, true);
      a2.motor.body.applyImpulse({ x: -v2.x * 0.6, y: 0.0, z: -v2.z * 0.6 }, true);

      const p1 = a1.motor.body.translation();
      const p2 = a2.motor.body.translation();
      const midPos = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5, z: (p1.z + p2.z) * 0.5 };
      soundManager.playBodyCollision(1.0, midPos);
      for (const pc of playerCameras) pc.addTrauma(0.26);
      if (idx1 >= 0) {
        triggerHaptic(idx1, {
          weakMagnitude: (TUNING.input?.haptics?.tackleWeak ?? 0.35) * 1.1,
          strongMagnitude: (TUNING.input?.haptics?.tackleStrong ?? 0.15) * 1.2,
          duration: 90,
        });
      }
      if (idx2 >= 0) {
        triggerHaptic(idx2, {
          weakMagnitude: (TUNING.input?.haptics?.tackleWeak ?? 0.35) * 1.1,
          strongMagnitude: (TUNING.input?.haptics?.tackleStrong ?? 0.15) * 1.2,
          duration: 90,
        });
      }
      return;
    }
  }

  // 2. ATHLETE JOSTLING / BODY BUMPS (When non-sliding athletes bump or run into each other)
  if ((tick - (a1._lastCollideTick || 0)) > 6) {
    a1._lastCollideTick = tick;
    a2._lastCollideTick = tick;

    const p1 = a1.motor.body.translation();
    const p2 = a2.motor.body.translation();
    let dx = p2.x - p1.x;
    let dz = p2.z - p1.z;
    let dist = Math.hypot(dx, dz);
    if (dist < 1e-4) {
      dx = 0;
      dz = 1;
      dist = 1;
    }
    const nx = dx / dist;
    const nz = dz / dist;

    const v1 = a1.motor.body.linvel();
    const v2 = a2.motor.body.linvel();
    // Relative velocity along collision normal (positive = approaching each other)
    const vRel = (v1.x - v2.x) * nx + (v1.z - v2.z) * nz;

    // Ground-plane soft separation: zero vertical impulse (y = 0.0)
    // Non-penetration push only if approaching or overlapping motor spheres (diameter = 1.0m)
    const approachImpulse = Math.max(0, vRel) * 2.8;
    const overlap = Math.max(0, 1.05 - dist);
    const overlapImpulse = overlap * 4.5;
    const impulseMag = Math.min(5.0, approachImpulse + overlapImpulse);

    if (impulseMag > 0.05) {
      if (impulseMag > 1.2) {
        for (const pc of playerCameras) pc.addTrauma(Math.min(0.14, impulseMag * 0.035));
        if (idx1 >= 0) {
          triggerHaptic(idx1, {
            weakMagnitude: TUNING.input?.haptics?.collisionWeak ?? 0.25,
            strongMagnitude: TUNING.input?.haptics?.collisionStrong ?? 0.10,
            duration: TUNING.input?.haptics?.collisionDuration ?? 60,
          });
        }
        if (idx2 >= 0) {
          triggerHaptic(idx2, {
            weakMagnitude: TUNING.input?.haptics?.collisionWeak ?? 0.25,
            strongMagnitude: TUNING.input?.haptics?.collisionStrong ?? 0.10,
            duration: TUNING.input?.haptics?.collisionDuration ?? 60,
          });
        }
      }
      // Pure ground plane impulse: NEVER launch athletes into the air (y = 0.0)
      a1.motor.body.applyImpulse({ x: -nx * impulseMag, y: 0.0, z: -nz * impulseMag }, true);
      a2.motor.body.applyImpulse({ x: nx * impulseMag, y: 0.0, z: nz * impulseMag }, true);

      // Stagger ragdoll limbs / chest with realistic physical force
      const k1 = (hit1 && !hit1.isMotor && hit1.key) || 'chest';
      const g1 = (hit1 && !hit1.isMotor && hit1.group) || 'torso';
      const k2 = (hit2 && !hit2.isMotor && hit2.key) || 'chest';
      const g2 = (hit2 && !hit2.isMotor && hit2.group) || 'torso';

      if (a1.impactEvents) a1.impactEvents.push({ key: k1, group: g1, force: impulseMag * 3.5 });
      if (a2.impactEvents) a2.impactEvents.push({ key: k2, group: g2, force: impulseMag * 3.5 });

      const midPos = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5, z: (p1.z + p2.z) * 0.5 };
      soundManager.playBodyCollision(Math.max(0.2, Math.min(1.0, vRel / 4.0)), midPos);
    }
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
  if (athletes.length === 0) return;

  // 1 — RESPAWN REQUESTS
  if (respawnRequested) {
    respawnRequested = false;
    for (let i = 0; i < athletes.length; i++) {
      if (i > 0 && (gameState === 'practice' || armedCaptureTick !== null)) continue;
      athletes[i].requestRespawn();
    }
  }

  // 2 — BALL WATCHDOG & SERVE (B / Start or fall out of bounds)
  const serveQueued = consumeAthleteBallReset(0);
  const armedBallSpawn = armedCaptureTick !== null && tick === TUNING.ball.captureSpawnTick;
  const isDeterministic = armedCaptureTick !== null;

  for (let i = 0; i < balls.length; i += 1) {
    const b = balls[i];
    if (captureFixture && fixtureParksBall(captureFixture, i)) continue;
    const belowWorld = b.body.translation().y < arenaPreset.killPlaneY;
    if (serveQueued || armedBallSpawn || belowWorld) {
      const dropPos = getCourtBallDropSpawn(i, balls.length, tick, isDeterministic);
      resetBall(b, tick, dropPos);
      if (belowWorld && !serveQueued && !armedBallSpawn) {
        console.log(`[ball:${b.id}] out of bounds — reset at tick ${tick}`);
      }
    }
  }

  if (captureFixture) applyFixtureServes(captureFixture, tick, balls, resetBall);

  // ─── AI BOT DECISION & SYNTHETIC INPUT EXECUTION ───
  for (const bc of botControllers) {
    const botAthlete = athletes[bc.slotIndex];
    const opponentIdx = bc.slotIndex === 0 ? 1 : 0;
    const opponent = athletes[opponentIdx] || null;
    const botSlot = getInputSlot(bc.slotIndex);
    updateBot(bc, botAthlete, opponent, balls, matchState, botSlot, tick, dt);
  }

  // 3 to 10 — ATHLETE PRE-PHYSICS MECHANICS (Drive, Jump, Slide, Dive, Strikes, Ghost, Tracking)
  const isCountingDown = (gameState === 'match') && !!(matchState && matchState.isCountingDown);
  const isAthleteHeld = isCountingDown || (gameState === 'menu') || (gameState === 'flyover');
  const isBallHeld = (gameState === 'match' && isCountingDown) || (gameState === 'flyover');
  const hoopNorthZ = TUNING.match?.hoopNorthZ ?? -40.0;
  const hoopSouthZ = TUNING.match?.hoopSouthZ ?? 40.0;
  const p1IsHome = (TUNING.players?.[0]?.team || 'home') === 'home';
  const p1AttacksNorth = p1IsHome ? (matchState?.targetGoal === 'N') : (matchState?.targetGoal === 'S');
  const targetGoalZ_P1 = p1AttacksNorth ? hoopNorthZ : hoopSouthZ;
  const targetGoalZ_P2 = p1AttacksNorth ? hoopSouthZ : hoopNorthZ;

  for (let i = 0; i < athletes.length; i++) {
    if (gameState === 'practice' && i > 0) continue;
    const athlete = athletes[i];
    let inputSnapshot = getInputSlot(i);
    let jumpQueued = consumeAthleteJump(i);
    let diveQueued = consumeAthleteDive(i);
    let cutQueued = consumeAthleteCut(i);
    let volleyQueued = consumeAthleteVolley(i);
    let spikeQueued = consumeAthleteSpike(i);

    if (isAthleteHeld) {
      inputSnapshot = {
        ...inputSnapshot,
        moveX: 0,
        moveZ: 0,
        sprintHeld: false,
        slideHeld: false,
        moveWorld: _zeroVector,
      };
      jumpQueued = false;
      diveQueued = false;
      cutQueued = false;
      volleyQueued = false;
      spikeQueued = false;
    }

    const preResult = athlete.prePhysicsUpdate({
      dt,
      tick,
      inputSnapshot,
      jumpQueued,
      diveQueued,
      cutQueued,
      volleyQueued,
      spikeQueued,
      balls,
      arenaPreset,
      targetGoalZ: (i === 0 ? targetGoalZ_P1 : targetGoalZ_P2),
      facingFollowsCamera:
        !isAthleteHeld && !activeBotSlots.includes(i) && (playerCameras[i]?.mode === 'chase' || playerCameras[i]?.mode === 'ball'),
    });

    if (preResult?.actions) {
      const act = preResult.actions;
      const pos = athlete.motor?.body ? athlete.motor.body.translation() : null;

      // 1. Dive launch juice & turf puff
      if (act.lastDiveTick === tick && pos) {
        if (gameState === 'match' && athleteMatchStats[i]) {
          athleteMatchStats[i].dives++;
        } else if (gameState === 'practice' && i === 0) {
          practiceStats.dives++;
        }
        if (playerCameras[i]) {
          playerCameras[i].punchFov(TUNING.camera.fovPunch?.divePunch ?? -1.2);
          playerCameras[i].addTrauma(0.14);
        }

        const vel = athlete.motor?.body ? athlete.motor.body.linvel() : null;
        let kickX = 0;
        let kickZ = 0;
        if (vel) {
          const len = Math.hypot(vel.x, vel.z);
          if (len > 1e-4) {
            kickX = -vel.x / len;
            kickZ = -vel.z / len;
          }
        }
        const plantX = pos.x + kickX * 0.45;
        const plantZ = pos.z + kickZ * 0.45;
        const plantY = queryPitchSurfaceY(plantX, plantZ, pos.y);
        const plantPos = { x: plantX, y: plantY, z: plantZ };
        const plantCol = getPitchSurfaceColor(plantPos, activeArenaType());

        turfParticles.spawnTurfPuff({
          position: plantPos,
          direction: vel,
          speed: 5.5,
          count: 5,
          surfaceColor: plantCol,
          trailOffset: 0,
        });
      }

      // 2. Cut action: pronounced directional turf spray kicking backward from plant foot
      if (act.cutFired && pos) {
        const vel = athlete.motor?.body ? athlete.motor.body.linvel() : null;
        const cutDir = act.cutDir || vel;
        let kickX = 0;
        let kickZ = 0;
        if (cutDir) {
          const len = Math.hypot(cutDir.x, cutDir.z);
          if (len > 1e-4) {
            kickX = -cutDir.x / len;
            kickZ = -cutDir.z / len;
          }
        }
        const plantX = pos.x + kickX * 0.32;
        const plantZ = pos.z + kickZ * 0.32;
        const plantY = queryPitchSurfaceY(plantX, plantZ, pos.y);
        const plantPos = { x: plantX, y: plantY, z: plantZ };
        const plantCol = getPitchSurfaceColor(plantPos, activeArenaType());

        turfParticles.spawnCutSpray({
          position: plantPos,
          cutDir: cutDir,
          speed: 7.5,
          count: 10,
          surfaceColor: plantCol,
          trailOffset: 0,
        });
      }

      // 3. Slide continuous turf spray (satisfying lateral spray & increased particle count)
      if (act.sliding && athlete.motor?.body && pos) {
        const vel = athlete.motor.body.linvel();
        const spd = Math.hypot(vel.x, vel.z);
        if (spd > 2.0 && (tick % 3 === 0)) {
          let kickX = 0;
          let kickZ = 0;
          if (spd > 1e-4) {
            kickX = -vel.x / spd;
            kickZ = -vel.z / spd;
          }
          const plantX = pos.x + kickX * 0.40;
          const plantZ = pos.z + kickZ * 0.40;
          const plantY = queryPitchSurfaceY(plantX, plantZ, pos.y);
          const plantPos = { x: plantX, y: plantY, z: plantZ };
          const plantCol = getPitchSurfaceColor(plantPos, activeArenaType());

          turfParticles.spawnTurfPuff({
            position: plantPos,
            direction: vel,
            speed: spd * 0.85,
            count: 5,
            surfaceColor: plantCol,
            trailOffset: 0,
            isSlide: true,
          });
        }
      }

      // 4. Locomotion turf kick: sparse, clean, and strictly 1 particle per puff at high speeds
      if (athlete.motor?.grounded && !act.sliding && athlete.motor?.body && pos) {
        const vel = athlete.motor.body.linvel();
        const spd = Math.hypot(vel.x, vel.z);
        if (spd > 3.2) {
          const isSprint = spd > 5.2;
          const cadence = isSprint ? 5 : 8;
          if (tick % cadence === 0) {
            let kickX = 0;
            let kickZ = 0;
            if (spd > 1e-4) {
              kickX = -vel.x / spd;
              kickZ = -vel.z / spd;
            }
            const plantX = pos.x + kickX * 0.35;
            const plantZ = pos.z + kickZ * 0.35;
            const plantY = queryPitchSurfaceY(plantX, plantZ, pos.y);
            const plantPos = { x: plantX, y: plantY, z: plantZ };
            const plantCol = getPitchSurfaceColor(plantPos, activeArenaType());
            const kickSpeed = spd * (isSprint ? 0.35 : 0.25);

            turfParticles.spawnTurfPuff({
              position: plantPos,
              direction: vel,
              speed: kickSpeed,
              count: 1,
              surfaceColor: plantCol,
              trailOffset: 0,
            });
          }
        }
      }
    }

    // Single-fire knockdown haptic feedback (slide exhaustion, crash, or hard impact)
    if (athlete.tracker?.knockdownQueued && !athlete._knockdownHapticPlayed) {
      athlete._knockdownHapticPlayed = true;
      triggerHaptic(i, {
        weakMagnitude: TUNING.input?.haptics?.knockdownWeak ?? 0.35,
        strongMagnitude: TUNING.input?.haptics?.knockdownStrong ?? 0.15,
        duration: TUNING.input?.haptics?.knockdownDuration ?? 80,
      });
    } else if (!athlete.tracker?.knockdownQueued) {
      athlete._knockdownHapticPlayed = false;
    }

    if (isAthleteHeld && athlete.motor?.body) {
      const lv = athlete.motor.body.linvel();
      athlete.motor.body.setLinvel({ x: 0, y: Math.min(lv.y, 0), z: 0 }, true);
    }
  }

  // 7b — Air drag and spin decay for balls
  for (const b of balls) applyBallResistance(b, dt);

  // 11 — THE ONE WORLD STEP
  stepPhysics();

  // If held during countdown or flyover, freeze balls at spawn
  if (isBallHeld) {
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b && b.body) {
        b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        if (gameState === 'match' && isCountingDown) {
          if (!b._preMatchSpawnPos) {
            b._preMatchSpawnPos = matchState?.preMatchSpawnPos || getCourtBallDropSpawn(i, balls.length, tick, false);
            if (matchState && !matchState.preMatchSpawnPos) {
              matchState.preMatchSpawnPos = b._preMatchSpawnPos;
            }
          }
          b.body.setTranslation(b._preMatchSpawnPos, true);
        } else {
          b._preMatchSpawnPos = null;
        }
      }
    }
  } else if (gameState === 'menu') {
    // Keep balls alive and bouncing dynamically across the arena floor during title screen
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b && b.body) {
        const pos = b.body.translation();
        const vel = b.body.linvel();
        const speedSq = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
        if (pos.y < 1.4 && speedSq < 6.0) {
          b.body.applyImpulse({
            x: (Math.random() - 0.5) * 4.0,
            y: 8.0 + Math.random() * 5.0,
            z: (Math.random() - 0.5) * 4.0,
          }, true);
        }
      }
    }
  }

  // 12 — IMPACTS
  drainImpacts(tick, dt);

  // 12b — SCORING
  if (matchState && (gameState === 'match' || gameState === 'practice')) {
    const goalsBefore = matchState.events.length;
    updateScoring(matchState, balls, tick);
    if (matchState.events.length > goalsBefore) {
      const lastGoal = matchState.events[matchState.events.length - 1];
      const hoopPos = {
        x: 0,
        y: TUNING.match.hoopCenterY,
        z: lastGoal.goal === 'N' ? TUNING.match.hoopNorthZ : TUNING.match.hoopSouthZ,
      };
      soundManager.playGoal(lastGoal.scoredFor, lastGoal.goal, hoopPos);
      goalCelebration.triggerGoal(lastGoal.scoredFor, hoopPos, { y: lastGoal.y, z: lastGoal.z });
      if (gameState === 'practice') {
        practiceStats.goals++;
      }
    }
    if (gameState === 'match') {
      if (matchState.matchOver && !matchState._buzzerPlayed) {
        matchState._buzzerPlayed = true;
        soundManager.playSample('arena_buzzer', 0.95, 1.0, null, soundManager.uiGain);
        const p1Strike = athletes[0]?.getStrikeStats() || { hits: 0, whiffs: 0, accuracy: 0 };
        const p2Strike = athletes[1]?.getStrikeStats() || { hits: 0, whiffs: 0, accuracy: 0 };

        // Post-match victory presentation camera & ceremony
        const homeScore = matchState.scoreHome || 0;
        const awayScore = matchState.scoreAway || 0;
        const winnerIdx = (awayScore > homeScore && athletes[1]) ? 1 : 0;
        const winnerAthlete = athletes[winnerIdx];
        const winnerPos = winnerAthlete?.motor?.body?.translation() || { x: 0, y: 0, z: 0 };
        cinematicCamera.startVictoryPresentation(new THREE.Vector3(winnerPos.x, winnerPos.y, winnerPos.z), 12.0);
        victoryCameraActive = true;

        setTimeout(() => {
          showVictoryScreen(
            matchProbe(matchState),
            { ...p1Strike, ...athleteMatchStats[0] },
            { ...p2Strike, ...athleteMatchStats[1] },
          );
        }, 1200);
      }
    }
  }

  if (gameState === 'practice') {
    practiceSessionTicks++;
  }

  // 13 — POST-PHYSICS (Snapshots, strike assist, and player combat)
  for (let i = 0; i < athletes.length; i++) {
    if (gameState === 'practice' && i > 0) continue;
    try {
      const assistEvent = athletes[i].postPhysicsUpdate(tick, dt, balls, athletes, i);
      if (assistEvent) {
        const athlete = athletes[i];
        const touchCooldownTicks = Math.round(0.25 * TUNING.loop.fixedHz);
        const lastTouch = athlete._lastTouchTick ?? -999;
        if ((tick - lastTouch) >= touchCooldownTicks) {
          athlete._lastTouchTick = tick;
          if (gameState === 'match' && athleteMatchStats[i]) {
            athleteMatchStats[i].totalTouches++;
          } else if (i === 0 && gameState === 'practice') {
            practiceStats.totalTouches++;
          }
        }

        if (athlete.isDiving && athlete.isDiving(tick)) {
          const lastDivingHit = athlete._lastDivingHitTick ?? -999;
          if ((tick - lastDivingHit) >= touchCooldownTicks) {
            athlete._lastDivingHitTick = tick;
            if (gameState === 'match' && athleteMatchStats[i]) {
              athleteMatchStats[i].divingHits++;
            } else if (i === 0 && gameState === 'practice') {
              practiceStats.divingHits++;
            }
          }
        }

        if (gameState === 'match' && athleteMatchStats[i]) {
          if (assistEvent.quality >= 0.80) {
            athleteMatchStats[i].sweetSpotHits++;
          }
          if (assistEvent.kind === 2) {
            athleteMatchStats[i].spikes++;
          }
        } else if (i === 0 && gameState === 'practice') {
          if (assistEvent.quality >= 0.80) {
            practiceStats.sweetSpots++;
          }
          if (assistEvent.kind === 2) {
            practiceStats.spikes++;
          }
        }
      }
    } catch (err) {
      console.error(`[main] Error in postPhysicsUpdate for athlete ${i}:`, err);
    }
  }
  for (const b of balls) syncBallSnapshot(b);

  // 14 — ASSERTS
  assertInvariants(tick);
}

/**
 * Updates all player cameras for the current frame.
 */
function updateCameras() {
  const world = getWorld();
  if (!world) return;

  const frameDelta = Math.min(loop.frameTimeMs / 1000, TUNING.loop.maxFrameTime);
  const activeBall = ball || (balls && balls[0]) || null;

  // Check per-player camera cycle triggers
  if (consumeCameraCycle(0)) {
    cycleCameraMode(0);
  }
  if (consumeCameraCycle(1)) {
    cycleCameraMode(1);
  }

  const hoopCenterY = TUNING.match?.hoopCenterY ?? 10.0;
  const hoopNorthZ = TUNING.match?.hoopNorthZ ?? -40.0;
  const hoopSouthZ = TUNING.match?.hoopSouthZ ?? 40.0;
  const p1IsHome = (TUNING.players?.[0]?.team || 'home') === 'home';
  const p1AttacksNorth = p1IsHome ? (matchState?.targetGoal === 'N') : (matchState?.targetGoal === 'S');
  const targetGoalZ_P1 = p1AttacksNorth ? hoopNorthZ : hoopSouthZ;
  const targetGoalZ_P2 = p1AttacksNorth ? hoopSouthZ : hoopNorthZ;
  const p1Goal = { x: 0, y: hoopCenterY, z: targetGoalZ_P1 };
  const p2Goal = { x: 0, y: hoopCenterY, z: targetGoalZ_P2 };

  // Update P1 camera
  if (athletes[0]) {
    playerCameras[0].update({
      athlete: athletes[0],
      activeBall,
      inputSlot: getInputSlot(0),
      mouseDeltas: getMouseDeltas(),
      world,
      frameDelta,
      allAthletes: athletes,
      attackingGoal: p1Goal,
    });
  }

  // Update P2 camera
  if (athletes[1]) {
    playerCameras[1].update({
      athlete: athletes[1],
      activeBall,
      inputSlot: getInputSlot(1),
      mouseDeltas: { dx: 0, dy: 0 },
      world,
      frameDelta,
      allAthletes: athletes,
      attackingGoal: p2Goal,
    });
  }

  // Update spectator sports camera for AI vs AI match
  if (activeBotSlots.length >= 2) {
    updateSportsCamera(spectatorCamera, athletes, activeBall, frameDelta);
  }
}
const updateSpringArm = updateCameras;

let renderFrameCount = 0;

/**
 * The render pass. Supports vertical splitscreen and single-viewport modes.
 *
 * @param {number} alpha
 */
function render(alpha) {
  renderFrameCount++;
  displayCoordinator.reset(1);

  const registry = loop.interpolated;
  for (let i = 0; i < registry.length; i += 1) registry[i].apply(alpha);

  for (let i = 0; i < athletes.length; i++) {
    const athlete = athletes[i];
    if (gameState === 'practice' && i > 0) {
      if (athlete.ragdoll?.group) athlete.ragdoll.group.visible = false;
      continue;
    }
    athlete.renderPose(alpha);
  }

  const frameDelta = Math.min(loop.frameTimeMs / 1000, TUNING.loop.maxFrameTime);
  turfParticles.update(frameDelta);
  goalCelebration.update(frameDelta);

  // Ball impact emissive pulse decay
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b._emissiveFlash > 0.001) {
      b._emissiveFlash *= Math.exp(-frameDelta * 14.0);
      if (b.mesh?.material) {
        if (!b.mesh.material.emissiveMap) {
          b.mesh.material.emissive.setHex(0xffe680);
        }
        b.mesh.material.emissiveIntensity = (b.mesh.material.emissiveMap ? 1.0 : 0.0) + b._emissiveFlash;
      }
    } else if (b._emissiveFlash !== undefined && b._emissiveFlash !== 0) {
      b._emissiveFlash = 0;
      if (b.mesh?.material) {
        if (!b.mesh.material.emissiveMap) {
          b.mesh.material.emissive.setHex(0x000000);
        }
        b.mesh.material.emissiveIntensity = b.mesh.material.emissiveMap ? 1.0 : 0.0;
      }
    }
  }

  const isKickoffActive = (gameState === 'match') && !!(matchState && matchState.isCountingDown) && !cinematicCamera.isComplete;
  const isVictoryActive = (gameState === 'match') && !!(matchState && matchState.matchOver) && victoryCameraActive;

  if (gameState === 'flyover') {
    cinematicCamera.update(frameDelta);
    // Check if connected gamepad pressed button 0 (A / Cross) to skip flyover
    const pads = (navigator.getGamepads ? navigator.getGamepads() : []) || [];
    for (const pad of pads) {
      if (pad && pad.buttons && pad.buttons[0]?.pressed) {
        skipFlyover();
        break;
      }
    }
    if (cinematicCamera.isComplete) {
      skipFlyover();
    }
  } else if (gameState === 'menu' || isKickoffActive || isVictoryActive) {
    if (isVictoryActive && athletes) {
      const homeScore = matchState ? (matchState.scoreHome || 0) : 0;
      const awayScore = matchState ? (matchState.scoreAway || 0) : 0;
      const winnerIdx = (awayScore > homeScore && athletes[1]) ? 1 : 0;
      const wt = athletes[winnerIdx]?.motor?.body?.translation();
      if (wt) cinematicCamera.winnerPos.set(wt.x, wt.y, wt.z);
    }
    cinematicCamera.update(frameDelta);
  } else {
    updateCameras();
  }

  if (consumeMenuToggle() && gameState !== 'menu' && gameState !== 'flyover' && !isInGameMenuOpen()) {
    toggleInGameMenu(playerCameras[0]?.mode, playerCameras[1]?.mode);
  }

  const match = matchState ? matchProbe(matchState) : null;

  const isPracticeActive = (gameState === 'practice');
  const a0Strike = athletes[0]?.getStrikeStats();
  if (a0Strike) {
    practiceStats.hits = a0Strike.hits;
    practiceStats.whiffs = a0Strike.whiffs;
  }

  const callScoreboards = () => updateScoreboards(scoreboards, match);
  const callHustleBoards = () => updateHustleBoards(
    hustleBoards,
    practiceStats,
    practiceSessionTicks / 60,
    isPracticeActive,
    matchState?.celebrationTicks || 0,
    match,
    athletes,
    athleteMatchStats,
  );

  // Alternate priority so scoreboards and hustle boards do not starve each other
  if (renderFrameCount % 2 === 0) {
    callScoreboards();
    callHustleBoards();
  } else {
    callHustleBoards();
    callScoreboards();
  }

  if (match) {
    if (gameState === 'match') {
      updateCountdownOverlay(match.countdownSecondsRemaining, match.isCountingDown, frameDelta);
    }
    updateInGameMenuBanner(match);
  }

  const p1CamMode = playerCameras[0]?.mode;
  const p2CamMode = playerCameras[1]?.mode;
  const isSharedCam = (p1CamMode === 'broadcast' && p2CamMode === 'broadcast') ||
                      (p1CamMode === 'sports' && p2CamMode === 'sports');
  const isSplitscreen = (gameState === 'match') && !!TUNING.camera.splitscreen && athletes.length >= 2 && !isSharedCam && !isKickoffActive && !isVictoryActive;
  const dividerEl = document.getElementById('splitscreen-divider');
  if (dividerEl) {
    dividerEl.style.display = isSplitscreen ? 'block' : 'none';
  }
  const width = window.innerWidth;
  const height = window.innerHeight;

  // Render stadium shadow maps once per frame across all viewports
  renderer.shadowMap.needsUpdate = true;

  if (gameState === 'menu' || gameState === 'flyover' || isKickoffActive || isVictoryActive) {
    cinematicCamera.camera.aspect = width / height;
    cinematicCamera.camera.updateProjectionMatrix();
    renderer.setViewport(0, 0, width, height);
    renderer.render(scene, cinematicCamera.camera);
  } else if (isSplitscreen) {
    const halfW = Math.floor(width / 2);

    renderer.setScissorTest(true);

    // Left Viewport (Player 1)
    playerCameras[0].camera.aspect = halfW / height;
    playerCameras[0].camera.updateProjectionMatrix();
    renderer.setViewport(0, 0, halfW, height);
    renderer.setScissor(0, 0, halfW, height);
    renderer.render(scene, playerCameras[0].camera);

    // Right Viewport (Player 2)
    playerCameras[1].camera.aspect = (width - halfW) / height;
    playerCameras[1].camera.updateProjectionMatrix();
    renderer.setViewport(halfW, 0, width - halfW, height);
    renderer.setScissor(halfW, 0, width - halfW, height);
    renderer.render(scene, playerCameras[1].camera);

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
  } else {
    // Single Viewport (Practice, 1 human vs AI, AI vs AI spectator, or shared camera)
    let activeRenderCamera = playerCameras[0].camera;
    if (activeBotSlots.length >= 2) {
      // AI vs AI spectator broadcast camera
      activeRenderCamera = spectatorCamera;
    } else if (activeBotSlots.length === 1 && athletes.length >= 2) {
      // Single human vs AI: ensure the camera renders the human player's viewport
      const humanSlot = activeBotSlots.includes(0) ? 1 : 0;
      activeRenderCamera = playerCameras[humanSlot].camera;
    }
    activeRenderCamera.aspect = width / height;
    activeRenderCamera.updateProjectionMatrix();
    renderer.setViewport(0, 0, width, height);
    renderer.render(scene, activeRenderCamera);
  }

  updateHud(match);
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
  if (!TUNING.anim?.loadOptionalActionsGlb) return;
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

function handleRematch() {
  if (!matchState) return;
  // 1. Reset match clock, countdown, and score
  matchState.scoreHome = 0;
  matchState.scoreAway = 0;
  matchState.ticksRemaining = TUNING.match.durationSeconds * TUNING.loop.fixedHz;
  matchState.countdownTicksRemaining = TUNING.match.countdownSeconds * TUNING.loop.fixedHz;
  matchState.isCountingDown = true;
  matchState.matchOver = false;
  matchState._buzzerPlayed = false;
  matchState.events.length = 0;

  // Reset athlete strike stats and extended match stats
  for (const a of athletes) {
    if (a.strikeState) {
      a.strikeState.resolvedCount = 0;
      a.strikeState.whiffCount = 0;
    }
  }
  for (const s of athleteMatchStats) {
    s.totalTouches = 0;
    s.sweetSpotHits = 0;
    s.spikes = 0;
    s.dives = 0;
    s.divingHits = 0;
    s.defensiveBlocks = 0;
    s.ownCircleTouches = 0;
    s.oppCircleTouches = 0;
  }

  // 2. Re-randomize stream heads matching assigned teams (Home -> South, Away -> North)
  if (athletes.length >= 2) {
    const southHead = Math.random() < 0.5 ? TUNING.match.streamHeads.sw : TUNING.match.streamHeads.se;
    const northHead = Math.random() < 0.5 ? TUNING.match.streamHeads.nw : TUNING.match.streamHeads.ne;
    const p1IsHome = TUNING.players?.[0]?.team === 'home';
    const p1Head = p1IsHome ? southHead : northHead;
    const p2Head = p1IsHome ? northHead : southHead;

    athletes[0].teleportTo({ x: p1Head.x, y: p1Head.y + 7.5, z: p1Head.z }, p1Head.yaw);
    athletes[1].teleportTo({ x: p2Head.x, y: p2Head.y + 7.5, z: p2Head.z }, p2Head.yaw);

    playerCameras[0].azimuth = p1Head.yaw;
    playerCameras[1].azimuth = p2Head.yaw;
    playerCameras[0].manualAzimuthOffset = 0;
    playerCameras[0].manualPitchOffset = 0;
    playerCameras[1].manualAzimuthOffset = 0;
    playerCameras[1].manualPitchOffset = 0;
    playerCameras[0].resetSmoothing();
    playerCameras[1].resetSmoothing();
  }

  // 3. Ensure match ball is refreshed (respecting random or specific selection)
  setActiveMatchBall(currentMatchBallType);
  if (balls.length > 0) {
    const dropPos = getCourtBallDropSpawn(0, 1, loop.tick, false);
    resetBall(balls[0], loop.tick, dropPos);
    balls[0]._preMatchSpawnPos = { x: dropPos.x, y: dropPos.y, z: dropPos.z };
    if (matchState) matchState.preMatchSpawnPos = balls[0]._preMatchSpawnPos;
  }

  resetCountdownOverlay();
  hideVictoryScreen();
  hideInGameMenu();
  victoryCameraActive = false;
  cinematicCamera.startKickoffRitual(TUNING.match.countdownSeconds || 4.0);
  console.log('[match] rematch started with kickoff ritual!');
}

function skipFlyover() {
  if (gameState !== 'flyover') return;
  gameState = 'match';
  hideFlyoverOverlay();

  matchManager.skipFlyover();
  matchState = matchManager.getState();
  resetCountdownOverlay();
  victoryCameraActive = false;

  // Standoff kickoff ritual framing athletes taking positions
  cinematicCamera.startKickoffRitual(TUNING.match.countdownSeconds || 4.0);

  playerCameras[0].resetSmoothing();
  playerCameras[1].resetSmoothing();
  applyViewportSize();
  console.log('[flyover] skipped -> kickoff ritual started');
}

function handleStartMatch(configs, matchRulesOrBall = {}) {
  let ballPreference = getSelectedMatchBall();
  let durationSeconds = 300;
  let arenaType = activeArenaType();

  if (typeof matchRulesOrBall === 'string') {
    ballPreference = matchRulesOrBall;
  } else if (matchRulesOrBall && typeof matchRulesOrBall === 'object') {
    if (matchRulesOrBall.ball) ballPreference = matchRulesOrBall.ball;
    if (matchRulesOrBall.duration) durationSeconds = matchRulesOrBall.duration;
    if (matchRulesOrBall.arena) arenaType = matchRulesOrBall.arena;
  }

  // Check arena reload requirement
  if (arenaType !== activeArenaType()) {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('pendingMatchSetup', JSON.stringify({
        configs,
        matchRules: { ball: ballPreference, duration: durationSeconds, arena: arenaType },
      }));
      const url = new URL(window.location.href);
      url.searchParams.set('arena', arenaType);
      url.searchParams.set('skipMenu', 'true');
      window.location.href = url.toString();
      return;
    }
  }

  hideMainMenu();

  for (const s of athleteMatchStats) {
    s.totalTouches = 0;
    s.sweetSpotHits = 0;
    s.spikes = 0;
    s.dives = 0;
    s.divingHits = 0;
    s.defensiveBlocks = 0;
    s.ownCircleTouches = 0;
    s.oppCircleTouches = 0;
  }

  // 1. Apply configurations
  if (configs && configs[0] && athletes[0]) {
    athletes[0].setTeamAndVariant(configs[0].team, configs[0].variant, { primaryColor: configs[0].primaryColor });
    playerCameras[0].setMode(configs[0].cameraMode);
    if (TUNING.players[0]) {
      TUNING.players[0].team = configs[0].team;
      TUNING.players[0].variant = configs[0].variant;
      TUNING.players[0].primaryColor = configs[0].primaryColor;
      TUNING.players[0].cameraMode = configs[0].cameraMode;
    }
  }
  if (configs && configs[1] && athletes[1]) {
    athletes[1].setTeamAndVariant(configs[1].team, configs[1].variant, { primaryColor: configs[1].primaryColor });
    playerCameras[1].setMode(configs[1].cameraMode);
    if (TUNING.players[1]) {
      TUNING.players[1].team = configs[1].team;
      TUNING.players[1].variant = configs[1].variant;
      TUNING.players[1].primaryColor = configs[1].primaryColor;
      TUNING.players[1].cameraMode = configs[1].cameraMode;
    }
  }

  // 2. Dynamic Scoreboard & Palette Colors matching player choices
  const homeIdx = configs && configs[0]?.team === 'home' ? 0 : 1;
  const awayIdx = 1 - homeIdx;
  const homeColor = configs?.[homeIdx]?.primaryColor ?? 0xd90429;
  const awayColor = configs?.[awayIdx]?.primaryColor ?? 0x1d4ed8;

  if (TUNING.athlete && TUNING.athlete.palette) {
    TUNING.athlete.palette.homePrimary = homeColor;
    TUNING.athlete.palette.awayPrimary = awayColor;
  }
  if (TUNING.teams) {
    if (TUNING.teams.home) {
      TUNING.teams.home.primaryColor = homeColor;
      TUNING.teams.home.name = `${getColorName(homeColor)} (Home)`;
    }
    if (TUNING.teams.away) {
      TUNING.teams.away.primaryColor = awayColor;
      TUNING.teams.away.name = `${getColorName(awayColor)} (Away)`;
    }
  }
  if (scoreboards) {
    updateScoreboards(scoreboards, matchState);
  }

  // 3. Select and configure match ball & duration
  currentMatchBallType = ballPreference;
  setActiveMatchBall(currentMatchBallType);

  matchManager.startMatch(configs, { durationSeconds, ballPreference, arenaType });
  matchState = matchManager.getState();
  matchState.targetGoal = 'N';
  matchState.lastScoredFor = null;
  matchState.lastGoalId = null;
  matchState.ticksRemaining = TUNING.match.durationSeconds * TUNING.loop.fixedHz;
  matchState.countdownTicksRemaining = TUNING.match.countdownSeconds * TUNING.loop.fixedHz;
  matchState.isCountingDown = true;
  matchState.matchOver = false;
  matchState._buzzerPlayed = false;
  matchState.events.length = 0;

  // Clear strike stats and visual turf particles
  athleteManager.resetStats();
  turfParticles.reset();
  goalCelebration.reset();

  // Position athletes at stream heads matching chosen team (Home -> South, Away -> North)
  if (athletes.length >= 2) {
    const southHead = Math.random() < 0.5 ? TUNING.match.streamHeads.sw : TUNING.match.streamHeads.se;
    const northHead = Math.random() < 0.5 ? TUNING.match.streamHeads.nw : TUNING.match.streamHeads.ne;

    const p1IsHome = configs && configs[0]?.team === 'home';
    const p1Head = p1IsHome ? southHead : northHead;
    const p2Head = p1IsHome ? northHead : southHead;

    athletes[0].teleportTo({ x: p1Head.x, y: p1Head.y + 7.5, z: p1Head.z }, p1Head.yaw);
    athletes[1].teleportTo({ x: p2Head.x, y: p2Head.y + 7.5, z: p2Head.z }, p2Head.yaw);

    playerCameras[0].azimuth = p1Head.yaw;
    playerCameras[1].azimuth = p2Head.yaw;
    playerCameras[0].manualAzimuthOffset = 0;
    playerCameras[0].manualPitchOffset = 0;
    playerCameras[1].manualAzimuthOffset = 0;
    playerCameras[1].manualPitchOffset = 0;
    playerCameras[0].resetSmoothing();
    playerCameras[1].resetSmoothing();
  }

  // Fresh match ball at 10m
  if (balls.length > 0) {
    const dropPos = getCourtBallDropSpawn(0, 1, loop.tick, false);
    resetBall(balls[0], loop.tick, dropPos);
    balls[0]._preMatchSpawnPos = { x: dropPos.x, y: dropPos.y, z: dropPos.z };
    if (matchState) matchState.preMatchSpawnPos = balls[0]._preMatchSpawnPos;
  }

  // ═══ AI BOT SETUP ═══
  botControllers = [];
  activeBotSlots = [];
  if (athletes.length > 0 && configs && configs.length > 0) {
    let hasHuman = false;
    for (let i = 0; i < athletes.length; i++) {
      const pConfig = configs[i];
      if (pConfig && pConfig.type === 'ai') {
        const bot = createBotController({
          difficulty: pConfig.difficulty || 'medium',
          slotIndex: i,
          aggressiveness: pConfig.aggressiveness ?? 0.60,
          seed: loop.tick + 42 + i,
        });
        botControllers.push(bot);
        activeBotSlots.push(i);
        console.log(`[ai] P${i + 1} bot created — difficulty: ${pConfig.difficulty}, aggressiveness: ${(pConfig.aggressiveness ?? 0.60).toFixed(2)}`);
      } else {
        hasHuman = true;
      }
    }

    // Fullscreen for single human vs AI, or AI vs AI
    if (activeBotSlots.length > 0) {
      if (!hasHuman) {
        TUNING.camera.splitscreen = false;
      } else if (configs[1]?.type === 'ai') {
        TUNING.camera.splitscreen = false;
      } else if (configs[0]?.type === 'ai') {
        TUNING.camera.splitscreen = false;
      }
    }
  }

  // Start 10s flyover cutscene
  gameState = 'flyover';
  cinematicCamera.startFlyover(10.0);
  const p1Color = configs?.[0]?.primaryColor ?? 0xd90429;
  const p2Color = configs?.[1]?.primaryColor ?? 0x1d4ed8;
  const p1TeamName = getColorName(p1Color).toUpperCase();
  const p2TeamName = getColorName(p2Color).toUpperCase();
  const p1Hex = '#' + p1Color.toString(16).padStart(6, '0');
  const p2Hex = '#' + p2Color.toString(16).padStart(6, '0');
  showFlyoverOverlay(p1TeamName, p2TeamName, p1Hex, p2Hex);
  applyViewportSize();
  console.log('[match] starting 10s flyover cutscene...');
}

function handleStartPractice(playerConfig = null, ballChoice = 'all') {
  hideMainMenu();
  hideInGameMenu();
  hideVictoryScreen();
  turfParticles.reset();
  goalCelebration.reset();
  victoryCameraActive = false;
  gameState = 'practice';
  TUNING.match.mode = 'practice';
  selectedPracticeBallType = ballChoice;

  // Reset practice drill stats
  practiceStats.goals = 0;
  practiceStats.hits = 0;
  practiceStats.whiffs = 0;
  practiceStats.sweetSpots = 0;
  practiceStats.spikes = 0;
  practiceStats.dives = 0;
  practiceStats.divingHits = 0;
  practiceStats.defensiveBlocks = 0;
  practiceStats.totalTouches = 0;
  practiceSessionTicks = 0;

  if (athletes[0]?.strikeState) {
    athletes[0].strikeState.resolvedCount = 0;
    athletes[0].strikeState.whiffCount = 0;
  }

  // 1. Apply customized solo athlete options
  if (playerConfig && athletes[0]) {
    athletes[0].setTeamAndVariant(playerConfig.team || 'home', playerConfig.variant || 'classic', { primaryColor: playerConfig.primaryColor });
    playerCameras[0].setMode(playerConfig.cameraMode || 'chase');
    if (TUNING.players[0]) {
      TUNING.players[0].team = playerConfig.team;
      TUNING.players[0].variant = playerConfig.variant;
      TUNING.players[0].primaryColor = playerConfig.primaryColor;
      TUNING.players[0].cameraMode = playerConfig.cameraMode;
    }
    TUNING.camera.mode = playerCameras[0].mode;
    const pColor = playerConfig.primaryColor ?? 0xd90429;
    if (TUNING.athlete?.palette) {
      TUNING.athlete.palette.homePrimary = pColor;
    }
    if (TUNING.teams?.home) {
      TUNING.teams.home.primaryColor = pColor;
    }
  }

  // 2. Hide extra athletes and position practice athlete at center
  athleteManager.ensureRoster(1);
  athleteManager.teleportToPracticeSpawn(arenaPreset);

  if (matchState) {
    matchState.mode = 'practice';
    matchState.scoreHome = 0;
    matchState.scoreAway = 0;
    matchState.targetGoal = 'N';
    matchState.celebrationTicks = 0;
    matchState.lastScoredFor = null;
    matchState.lastGoalId = null;
    matchState.isCountingDown = false;
    matchState.matchOver = false;
    matchState.events.length = 0;
  }

  // 3. Configure ball(s) according to user selection
  if (ballChoice === 'small') {
    for (let i = 0; i < allBalls.length; i++) {
      const b = allBalls[i];
      if (i === 0) {
        b.mesh.visible = true;
        b.body.setEnabled(true);
      } else {
        b.mesh.visible = false;
        b.body.setTranslation({ x: 0, y: -200, z: 0 }, true);
        b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.body.setEnabled(false);
      }
    }
    balls = [allBalls[0]];
    ball = allBalls[0];
  } else if (ballChoice === 'medium') {
    for (let i = 0; i < allBalls.length; i++) {
      const b = allBalls[i];
      if (i === 1) {
        b.mesh.visible = true;
        b.body.setEnabled(true);
      } else {
        b.mesh.visible = false;
        b.body.setTranslation({ x: 0, y: -200, z: 0 }, true);
        b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.body.setEnabled(false);
      }
    }
    balls = [allBalls[1]];
    ball = allBalls[1];
  } else if (ballChoice === 'large') {
    for (let i = 0; i < allBalls.length; i++) {
      const b = allBalls[i];
      if (i === 2) {
        b.mesh.visible = true;
        b.body.setEnabled(true);
      } else {
        b.mesh.visible = false;
        b.body.setTranslation({ x: 0, y: -200, z: 0 }, true);
        b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.body.setEnabled(false);
      }
    }
    balls = [allBalls[2]];
    ball = allBalls[2];
  } else {
    // 'all' / multi-ball sandbox default
    balls = [...allBalls];
    ball = allBalls[1] || allBalls[0] || null;
    for (const b of allBalls) {
      b.mesh.visible = true;
      b.body.setEnabled(true);
    }
  }

  // Drop P1 from above center court
  const isDeterministic = armedCaptureTick !== null; // read boot-local `urlParams` before: threw on every practice start since v0.2.0
  if (athletes[0]) {
    const spawnPos = (arenaPreset && arenaPreset.spawn) || { x: 0, y: 1.2, z: 0 };
    athletes[0].teleportTo({ x: spawnPos.x, y: 12.0, z: spawnPos.z }, 0);
    playerCameras[0].resetSmoothing();
  }

  // Drop balls
  for (let i = 0; i < balls.length; i++) {
    const dropPos = getCourtBallDropSpawn(i, balls.length, loop.tick, isDeterministic);
    resetBall(balls[i], loop.tick, dropPos);
  }

  applyViewportSize();
  console.log(`[practice] sandbox started with ball choice "${ballChoice}"`);
}

function handleFinishPractice() {
  hideInGameMenu();
  const a0Strike = athletes[0]?.getStrikeStats();
  if (a0Strike) {
    practiceStats.hits = a0Strike.hits;
    practiceStats.whiffs = a0Strike.whiffs;
  }
  showPracticeSummary(practiceStats, practiceSessionTicks / 60, {
    onPracticeAgain: () => {
      handleStartPractice(getPlayerConfigs()[0], selectedPracticeBallType);
    },
    onCustomize: () => {
      hideVictoryScreen();
      gameState = 'menu';
      showPlayerSetup('practice');
      applyViewportSize();
    },
    onMainMenu: returnToMainMenu,
  });
}

function launchMenuBalls() {
  setActiveMatchBall('all');
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b && b.body) {
      const angle = (i / Math.max(balls.length, 1)) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 3.0 + Math.random() * 4.0;
      b.body.setTranslation({
        x: Math.cos(angle) * dist,
        y: 6.0 + i * 2.0,
        z: Math.sin(angle) * dist,
      }, true);
      b.body.setLinvel({
        x: (Math.random() - 0.5) * 8.0,
        y: 2.0 + Math.random() * 4.0,
        z: (Math.random() - 0.5) * 8.0,
      }, true);
      b.body.setAngvel({
        x: (Math.random() - 0.5) * 4.0,
        y: (Math.random() - 0.5) * 4.0,
        z: (Math.random() - 0.5) * 4.0,
      }, true);
    }
  }
}

function returnToMainMenu() {
  exitGamePointerLock();
  hideInGameMenu();
  hideVictoryScreen();
  resetCountdownOverlay();
  hideFlyoverOverlay();

  // Clear AI bots
  botControllers = [];
  activeBotSlots = [];

  gameState = 'menu';
  TUNING.match.mode = 'match';

  // 1. Reset match state completely
  matchManager.resetForTitle();
  matchState = matchManager.getState();
  matchState.mode = 'menu';

  // 2. Reset practice drill stats
  practiceStats.goals = 0;
  practiceStats.hits = 0;
  practiceStats.whiffs = 0;
  practiceStats.sweetSpots = 0;
  practiceStats.spikes = 0;
  practiceStats.dives = 0;
  practiceStats.divingHits = 0;
  practiceStats.defensiveBlocks = 0;
  practiceStats.totalTouches = 0;
  practiceSessionTicks = 0;

  for (const s of athleteMatchStats) {
    s.totalTouches = 0;
    s.sweetSpotHits = 0;
    s.spikes = 0;
    s.dives = 0;
    s.divingHits = 0;
    s.defensiveBlocks = 0;
    s.ownCircleTouches = 0;
    s.oppCircleTouches = 0;
  }

  // 3. Reset athletes, physics velocities, trackers and knockdowns
  for (let i = 0; i < athletes.length; i++) {
    const a = athletes[i];
    if (!a) continue;
    if (a.strikeState) {
      a.strikeState.resolvedCount = 0;
      a.strikeState.whiffCount = 0;
      a.strikeState.lastResolvedStrikeTick = -999;
      a.strikeState.lastStrikeTick = -999;
      a.strikeState.strikePhase = 0;
      a.strikeState.strikeMix = 0;
    }
    if (a.actionState) {
      a.actionState.slideTime = 0;
      a.actionState.diveTime = 0;
      a.actionState.jumpPhase = 0;
    }
    if (a.tracker) {
      a.tracker.queuedKnockdown = false;
      a.tracker.queuedKnockdownTone = 0;
      a.tracker.blendWeight = 1.0;
      a.tracker.blendProgress = 1.0;
      a.tracker.toneAuthority = 1.0;
    }
    if (a.motor?.body) {
      a.motor.body.setEnabled(true);
      a.motor.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      a.motor.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    if (a.ragdoll?.rig) {
      for (const item of a.ragdoll.rig.values()) {
        item.body.setEnabled(true);
        item.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        item.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    if (a.ragdoll?.group) a.ragdoll.group.visible = true;
  }

  // 4. Teleport athletes to stream heads and restore visibility
  if (athletes.length >= 2) {
    athletes[0].teleportTo(TUNING.match.streamHeads.sw, 0);
    athletes[1].teleportTo(TUNING.match.streamHeads.ne, Math.PI);
  }

  // 5. Reset camera smoothing and manual stick/mouse offsets
  for (const pc of playerCameras) {
    pc.manualAzimuthOffset = 0;
    pc.manualPitchOffset = 0;
    pc.manualIdleTimer = 0;
    pc.resetSmoothing();
  }

  victoryCameraActive = false;
  cinematicCamera.startTitleOrbit();
  showTitleScreen();
  launchMenuBalls();
  applyViewportSize();
  console.log('[mainMenu] returned to title screen (all parameters reset cleanly)');
}

let currentSetupMode = 'match';
let setupAthleteYaw = [Math.PI * 0.40, -Math.PI * 0.40];

function handleEnterSetup(mode = 'match') {
  currentSetupMode = mode;
  // Move balls out of player preview viewport
  for (const b of allBalls) {
    if (b?.body) {
      b.body.setTranslation({ x: 0, y: -200, z: 0 }, true);
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  athleteManager.stageForLobby(mode);
  cinematicCamera.startSetupPreview();
  console.log(`[mainMenu] entered setup (${mode}) -> 3D athlete staging active`);
}

function handleExitSetup() {
  athleteManager.stageForTitle();
  launchMenuBalls();
  cinematicCamera.startTitleOrbit();
  console.log('[mainMenu] exited setup -> ambient title orbit');
}

function handlePlayerConfigChange(idx, config) {
  if (athletes[idx]) {
    athletes[idx].setTeamAndVariant(config.team, config.variant, { primaryColor: config.primaryColor });
    if (TUNING.players[idx]) {
      TUNING.players[idx].team = config.team;
      TUNING.players[idx].variant = config.variant;
      TUNING.players[idx].primaryColor = config.primaryColor;
      TUNING.players[idx].cameraMode = config.cameraMode;
    }
  }

  // Update TUNING palette live during setup as well
  const p1Team = TUNING.players[0]?.team || 'home';
  const homeIdx = p1Team === 'home' ? 0 : 1;
  const awayIdx = 1 - homeIdx;
  if (TUNING.athlete?.palette) {
    TUNING.athlete.palette.homePrimary = TUNING.players[homeIdx]?.primaryColor ?? 0xd90429;
    TUNING.athlete.palette.awayPrimary = TUNING.players[awayIdx]?.primaryColor ?? 0x1d4ed8;
  }
  if (scoreboards) {
    updateScoreboards(scoreboards, matchState);
  }
}

async function boot() {
  const loadingStatus = document.getElementById('loading-status');
  if (loadingStatus) loadingStatus.textContent = 'INITIALIZING ARENA & PHYSICS...';

  // Determine mode from URL query or TUNING first
  const urlParams = new URLSearchParams(window.location.search);
  const modeParam = urlParams.get('mode');
  if (modeParam === 'match' || modeParam === 'practice') {
    TUNING.match.mode = modeParam;
  }

  // THE MATCH STATE FIRST, before anything can score into it.
  matchState = matchManager.getState();
  matchState.mode = TUNING.match.mode;
  window.__matchState = matchState;
  await initPhysics(loop.fixedDt);

  arenaPreset = activeArenaPreset();
  console.log(`[arena] active type "${activeArenaType()}"`);
  const arena = await createArena(scene);

  scoreboards = createScoreboards(scene);
  window.__scoreboards = scoreboards;

  hustleBoards = createHustleBoards(scene);
  window.__hustleBoards = hustleBoards;

  soundManager.init(camera);
  window.__soundManager = soundManager;

  logCollisionMatrix();

  // Load character first so characterSkeleton & characterRoot are ready
  if (loadingStatus) loadingStatus.textContent = 'LOADING ATHLETE RIG & ANIMATIONS...';
  try {
    await loadCharacter();
  } catch (error) {
    console.error('[character] load failed; continuing without it', error);
  }

  // 1. CREATE ATHLETES (Both P1 and P2 created for lobby presentation and match play)
  if (loadingStatus) loadingStatus.textContent = 'SPAWNING ATHLETES & EQUIPMENT...';
  const p1Cfg = TUNING.players[0] || { team: 'home', variant: 'classic' };
  const p2Cfg = TUNING.players[1] || { team: 'away', variant: 'classic' };
  const p1Head = TUNING.match.streamHeads.sw;
  const p2Head = TUNING.match.streamHeads.ne;

  athleteManager.init({
    scene,
    characterSkeleton,
    characterRoot,
    clips: characterClips,
  });
  athletes = athleteManager.ensureRoster(2, TUNING.players);
  athletes[0].teleportTo(p1Head, p1Head.yaw);
  athletes[1].teleportTo(p2Head, p2Head.yaw);
  playerCameras[0].mode = p1Cfg.cameraMode || 'chase';
  playerCameras[1].mode = p2Cfg.cameraMode || 'chase';
  playerCameras[0].azimuth = p1Head.yaw;
  playerCameras[1].azimuth = p2Head.yaw;
  playerCameras[0].resetSmoothing();
  playerCameras[1].resetSmoothing();
  TUNING.camera.mode = playerCameras[0].mode;

  for (const a of athletes) {
    loop.register(a.motor.interpolated);
  }

  motor = athletes[0].motor;
  ragdoll = athletes[0].ragdoll;
  animTarget = athletes[0].animTarget;

  // 2. CREATE BALLS (Pre-create all 3 sizes: small, medium, large)
  const registryBefore = loop.interpolated.length;
  for (let i = 0; i < TUNING.balls.length; i += 1) {
    const spec = TUNING.balls[i];
    let spawn = arenaPreset.ballSpawns[i];
    if (activeArenaType() === 'court') {
      spawn = getCourtBallDropSpawn(i, TUNING.balls.length, 0, armedCaptureTick !== null);
    }
    const built = await createBall(scene, spawn ? { ...spec, spawn } : spec);
    allBalls.push(built);
    ballByHandle.set(built.collider.handle, built);
    loop.register(built.interpolated);
  }
  balls = [...allBalls];
  ball = allBalls[1] || allBalls[0] || null;
  console.log(
    `[ball] ${allBalls.length} balls (${allBalls.map((b) => b.id).join(', ')}); ` +
      `interpolation registry ${registryBefore} -> ${loop.interpolated.length}; ` +
      `HUD primary "${ball ? ball.label : 'none'}"`,
  );

  initInputRouter(canvas);
  loop.onFrame(() => sampleAllInputs([playerCameras[0].camera, playerCameras[1].camera], gameState === 'practice' ? 1 : athletes.length, TUNING.match.mode, activeBotSlots));

  applyViewportSize();
  applyCameraTuning();

  baselineCounts = worldCounts();
  console.log(
    `[ragdoll] baseline ${baselineCounts.bodies} bodies / ${baselineCounts.colliders} colliders / ` +
      `${baselineCounts.joints} joints`,
  );

  initCountdownOverlay();

  initVictoryScreen({
    onRematch: handleRematch,
    onPracticeMode: handleStartPractice,
    onMainMenu: returnToMainMenu,
  });

  initInGameMenu({
    onResume: () => {},
    onRematch: handleRematch,
    onPracticeMode: () => handleStartPractice(getPlayerConfigs()[0], selectedPracticeBallType),
    onFinishPractice: handleFinishPractice,
    onMainMenu: returnToMainMenu,
    onRenderSettingsChange: (settings) => {
      applyRenderSettings(settings);
    },
    onCameraChange: (playerIdx, mode) => {
      if (playerCameras[playerIdx]) {
        playerCameras[playerIdx].setMode(mode);
        if (TUNING.players[playerIdx]) {
          TUNING.players[playerIdx].cameraMode = mode;
        }
        if (playerIdx === 0) {
          TUNING.camera.mode = mode;
        }
      }
    },
    initialRenderSettings: {
      pixelRatioPreset: TUNING.render?.pixelRatioPreset || '1.25',
      shadowQuality: TUNING.render?.shadowQuality || 'high',
    },
  });

  applyShadowSettings();

  installRespawnHotkey();

  armedCaptureTick = initCapture({
    renderer,
    scene,
    camera,
    loop,
    restoreViewport: applyViewportSize,
    poseCharacter: (alpha) => {
      for (const a of athletes) a.renderPose(alpha);
      for (const pc of playerCameras) pc.resetSmoothing();
      updateSpringArm();
      renderer.shadowMap.needsUpdate = true;
    },
    requestRagdollSpawn,
  });

  // Phase 0: renderer-independent per-tick state hash, armed only by ?stateTrace=1.
  initStateTrace({ loop, getWorld, getAthletes: () => athletes });

  window.__vb = window.__vb || {};
  window.__vb.matchState = matchState;
  Object.defineProperty(window.__vb, 'balls', { get: () => balls, configurable: true });
  window.__vb.sound = soundManager;
  window.__soundManager = soundManager;
  window.__vb.tuning = TUNING;
  window.TUNING = TUNING;
  window.THREE = THREE;
  window.__vb.THREE = THREE;
  window.__vb.scene = scene;
  window.__vb.camera = camera;
  window.__vb.playerCameras = playerCameras;
  window.__vb.cameraRig = cameraRig;
  window.__vb.renderer = renderer;
  window.__vb.loop = loop;
  window.__vb.athletes = athletes;
  window.__vb.rematch = handleRematch;
  window.__vb.toggleInGameMenu = toggleInGameMenu;
  window.__vb.hideInGameMenu = hideInGameMenu;
  window.__vb.isInGameMenuOpen = isInGameMenuOpen;
  window.__vb.getInputSlot = getInputSlot;
  window.__vb.applyRenderSettings = applyRenderSettings;
  window.__vb.showMainMenu = showTitleScreen;
  window.__vb.showPlayerSetup = showPlayerSetup;
  window.__vb.startMatch = handleStartMatch;
  window.__vb.skipFlyover = skipFlyover;
  window.__vb.returnToMainMenu = returnToMainMenu;
  window.__vb.setActiveMatchBall = setActiveMatchBall;
  window.__vb.allBalls = allBalls;
  window.__vb.getGameState = () => gameState;
  window.__vb.cinematicCamera = cinematicCamera;
  window.__vb.getPlayerConfigs = getPlayerConfigs;
  window.__vb.athleteMatchStats = athleteMatchStats;
  window.__vb.showVictoryScreen = showVictoryScreen;
  window.__vb.showPracticeSummary = showPracticeSummary;
  window.__vb.hustleBoards = hustleBoards;
  window.__vb.updateHustleBoards = updateHustleBoards;
  window.__vb.displayCoordinator = displayCoordinator;
  window.__vb.practiceStats = practiceStats;
  window.__vb.finishPractice = handleFinishPractice;
  window.__vb.startPractice = handleStartPractice;
  Object.defineProperty(window.__vb, 'practiceSessionSeconds', {
    get: () => practiceSessionTicks / 60,
    configurable: true,
  });

  window.__vb.setTeamConfig = (teamId, options) => {
    if (!TUNING.teams || !TUNING.teams[teamId]) return;
    Object.assign(TUNING.teams[teamId], options);
    for (const a of athletes) {
      if (a.team === teamId) {
        a.refreshVisuals();
      }
    }
    if (guiInstance) guiInstance.controllersRecursive().forEach((c) => c.updateDisplay());
  };

  window.__vb.setPlayerConfig = (playerIndex, options) => {
    if (!TUNING.players || !TUNING.players[playerIndex]) return;
    Object.assign(TUNING.players[playerIndex], options);
    const a = athletes[playerIndex];
    if (a) {
      if (options.team) a.team = options.team;
      if (options.variant) a.variant = options.variant;
      if (options.primaryColor !== undefined) a.primaryColor = options.primaryColor;
      if (options.colorOverride !== undefined) a.colorOverride = options.colorOverride;
      a.refreshVisuals();
    }
    if (options.cameraMode && playerCameras[playerIndex]) {
      playerCameras[playerIndex].mode = options.cameraMode;
    }
    if (guiInstance) guiInstance.controllersRecursive().forEach((c) => c.updateDisplay());
  };

  window.__vb.setSplitscreen = (enabled) => {
    TUNING.camera.splitscreen = !!enabled;
    applyViewportSize();
    if (guiInstance) guiInstance.controllersRecursive().forEach((c) => c.updateDisplay());
  };

  Object.defineProperty(window.__vb, 'ragdoll', { get: () => athletes[0]?.ragdoll || ragdoll, configurable: true });
  Object.defineProperty(window.__vb, 'motor', { get: () => athletes[0]?.motor || motor, configurable: true });
  Object.defineProperty(window.__vb, 'animTarget', { get: () => athletes[0]?.animTarget || animTarget, configurable: true });
  window.__vb.updateAthletePalette = () => {
    for (const a of athletes) {
      if (a.ragdoll) a.refreshVisuals();
    }
  };
  window.__vb.updateAthleteVariant = () => {
    for (const a of athletes) {
      if (a.ragdoll) a.refreshVisuals();
    }
  };
  window.__vb.probe = (athleteIndex = 0) => {
    const a = athletes[athleteIndex] || athletes[0];
    if (!a || !a.ragdoll) return null;
    const r = a.ragdoll;
    const m = a.motor;
    const at = a.animTarget;
    const tr = a.tracker;
    const st = a.strikeState;
    const pelvis = r.rig.get('pelvis');
    const pv = pelvis.body.linvel();
    const pt = pelvis.body.translation();
    const mt = m.body.translation();
    const mv = m.body.linvel();
    return {
      tick: loop.tick,
      ball: ball ? ballProbe(ball) : null,
      strike: strikeProbe(st),
      match: matchState ? matchProbe(matchState) : null,
      balls: balls.map(ballProbe),
      athletesCount: athletes.length,
      pelvis: { x: pt.x, y: pt.y, z: pt.z, speed: Math.hypot(pv.x, pv.z) },
      motor: { x: mt.x, y: mt.y, z: mt.z, speed: Math.hypot(mv.x, mv.z) },
      weight: tr.weight,
      grounded: m.grounded,
      scorpion: (() => {
        const head = r.rig.get('head');
        const fL = r.rig.get('footL');
        const fR = r.rig.get('footR');
        if (!head || !fL || !fR) return null;
        const hy = head.body.translation().y;
        const fy = Math.max(fL.body.translation().y, fR.body.translation().y);
        return { footAboveHead: +(fy - hy).toFixed(3), headY: +hy.toFixed(3), footY: +fy.toFixed(3) };
      })(),
      tilt: pelvisTilt(pelvis.body.rotation()),
      targetTilt: (() => {
        const t = at && at.targets && at.targets.get('pelvis');
        return t ? pelvisTilt(t.currQuat) : NaN;
      })(),
      trackError: (() => {
        if (!at || !at.targets) return NaN;
        let sum = 0;
        let n = 0;
        for (const [k, item] of r.rig) {
          const t = at.targets.get(k);
          if (!t) continue;
          const b = item.body.translation();
          sum += Math.hypot(t.currPos.x - b.x, t.currPos.y - b.y, t.currPos.z - b.z);
          n += 1;
        }
        return n ? sum / n : NaN;
      })(),
      motorMass: m.body.mass(),
      motorVy: m.body.linvel().y,
      limbs: ['handL', 'handR', 'footL', 'footR'].map((k) => {
        const item = r.rig.get(k);
        if (!item) return 0;
        const v = item.body.linvel();
        return Math.hypot(v.x, v.y, v.z);
      }),
      yaw: at ? at.yaw : 0,
      targetYaw: at ? at.targetYaw : 0,
      momentumYaw: at ? at.momentumYaw : 0,
      standUpNeed: at ? at.standUpNeed : 0,
      standUpProgress: at ? at.standUpProgress : 0,
      pelvisDownness: at ? at.pelvisDownness : 0,
      slidePhase: at ? at.slidePhase : 0,
      divePhase: at ? at.divePhase : 0,
      shares: at ? { ...at.shares } : null,
    };
  };

  guiInstance = createGui({
    getMatchState: () => matchState,
    getScoreboards: () => scoreboards,
    onShowHudChange: setHudVisible,
    onShowSphereWireframeChange: (visible) => {
      for (const a of athletes) {
        if (a.motor && a.motor.mesh) a.motor.mesh.visible = visible;
      }
    },
    onShowBallWireframeChange: (wireframe) => {
      for (const b of balls) b.mesh.material.wireframe = wireframe;
    },
    onCameraChange: applyCameraTuning,
    onRagdollVisibilityChange: () => {
      if (athletes[0]) {
        athletes[0].setTeamAndVariant(TUNING.athlete.team, TUNING.athlete.variant);
      }
      for (const a of athletes) {
        if (a.ragdoll) {
          applyRagdollVisibility(a.ragdoll, characterRoot);
        }
      }
    },
    clipNames: characterClips.map((clip) => clip.name),
    tracker: athletes[0]?.tracker || tracker,
  });
  window.__vb.gui = guiInstance;
  guiInstance.hide();

  function hideLoadingScreen() {
    const el = document.getElementById('loading-screen');
    if (!el) return;
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    setTimeout(() => {
      el.style.display = 'none';
    }, 520);
  }

  setHudVisible(TUNING.debug.showHud);

  // Initialize and route Main Menu flow
  initMainMenu({
    onStartMatch: handleStartMatch,
    onStartPractice: handleStartPractice,
    onPlayerConfigChange: handlePlayerConfigChange,
    onOpenSettings: showMainMenuSettingsModal,
    onRenderSettingsChange: applyRenderSettings,
    onSkipFlyover: skipFlyover,
    onEnterSetup: handleEnterSetup,
    onExitSetup: handleExitSetup,
  });

  initMobileNotice();

  const pendingMatch = (typeof window !== 'undefined') ? sessionStorage.getItem('pendingMatchSetup') : null;
  if (pendingMatch) {
    sessionStorage.removeItem('pendingMatchSetup');
    try {
      const { configs: pendingConfigs, matchRules: pendingRules } = JSON.parse(pendingMatch);
      handleStartMatch(pendingConfigs, pendingRules);
      applyViewportSize();
      hideLoadingScreen();
      loop.start();
      return;
    } catch (e) {
      console.error('[boot] failed to restore pending match setup', e);
    }
  }

  const skipMenuParam = urlParams.get('skipMenu');
  const isCaptureRun = armedCaptureTick !== null || urlParams.has('captureTick');
  const shouldSkipMenu = skipMenuParam === 'true' || isCaptureRun;

  if (shouldSkipMenu) {
    if (isCaptureRun) {
      // Determinism regression test (LAW 6):
      // Must be byte-identical across runs. No random calls, pure function of tick.
      hideMainMenu();
      hideInGameMenu();
      hideVictoryScreen();
      gameState = 'practice';
      TUNING.match.mode = 'practice';
      renderer.shadowMap.autoUpdate = true;
      if (matchState) {
        matchState.mode = 'practice';
        matchState.isCountingDown = false;
      }
      if (athletes[0]) {
        athletes[0].teleportTo((arenaPreset && arenaPreset.spawn) || { x: 0, y: 1.2, z: 0 }, 0);
        playerCameras[0].resetSmoothing();
      }
      if (athletes[1]) {
        athletes[1].setEnabled(false);
      }
      captureFixture = readFixture();
      for (let i = 0; i < balls.length; i++) {
        const dropPos = getCourtBallDropSpawn(i, balls.length, 0, true);
        resetBall(balls[i], 0, dropPos);
        const parked = fixtureParksBall(captureFixture, i);
        balls[i].body.setEnabled(!parked);
        balls[i].mesh.visible = !parked;
      }
      applyViewportSize();
    } else if (TUNING.match.mode === 'practice') {
      handleStartPractice();
    } else {
      gameState = 'match';
      setActiveMatchBall('random');
      matchState.isCountingDown = true;
      matchState.countdownTicksRemaining = TUNING.match.countdownSeconds * TUNING.loop.fixedHz;
      resetCountdownOverlay();
      applyViewportSize();
    }
  } else {
    gameState = 'menu';
    cinematicCamera.startTitleOrbit();
    showTitleScreen();
    launchMenuBalls();
    applyViewportSize();
  }

  if (loadingStatus) loadingStatus.textContent = 'STARTING VALLEYBALL VERSUS...';
  hideLoadingScreen();
  loop.start();
}

boot().catch((error) => {
  console.error('[boot] failed', error);
  const loadingStatus = document.getElementById('loading-status');
  if (loadingStatus) {
    loadingStatus.textContent = 'BOOT FAILED: ' + (error?.message || error);
    loadingStatus.style.color = '#ef4444';
  }
});
