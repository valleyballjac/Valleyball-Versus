/**
 * @module main
 * Top-level application orchestrator for Valleyball Versus AI:
 * scene/renderer boot, fixed-timestep simulation loop sequencing,
 * multi-athlete match/overtime/practice lifecycle, and debug probe wiring.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { TUNING, assetUrl } from './config/tuning.js';
import { getHudPrefs, setHudPrefs, setCleanBroadcastHud } from './config/hudConfig.js';
import { getCourtFloorY, isCourtFloorSampleAvailable } from './ai/courtHeightmap.js';
import { getHeadwearLabel } from './config/cosmetics.js';
import { Loop } from './core/Loop.js';
import { WorldSnapshotRingBuffer, packInputFrame, unpackInputFrame } from './core/snapshot.js';
import {
  initPhysics, stepPhysics, getWorld, drainContactForces, RAPIER,
  ENVIRONMENT_RAY_GROUPS, logCollisionMatrix,
} from './sim/physics.js';
import { createArena, activeArenaType, activeArenaPreset, getArenaColliderType } from './sim/arena.js';
import {
  createBall, resetBall, getCourtBallDropSpawn, applyBallResistance, noteBallContact, syncBallSnapshot, ballProbe,
} from './sim/ball.js';
import {
  weightAudit,
  strafeSignViolation,
  flailViolation,
} from './sim/animtarget.js';
import { applyImpacts, queueKnockdown } from './sim/tracker.js';
import {
  findNonFinite,
  applyRagdollVisibility,
} from './sim/ragdoll.js';
import { athleteManager, computeStreamHeadSpawns } from './features/athletes/athleteManager.js';
import { resolveAthleteCollision } from './features/athletes/athleteCollisions.js';
import {
  viewportManager,
  showCameraNotification,
  showHeadwearToast,
} from './features/camera/viewportManager.js';
import {
  matchManager,
  createPlayerMatchStats,
  resetPlayerMatchStats,
  buildMatchStatsReport,
} from './features/match/matchManager.js';
import {
  practiceStats,
  newcomerDrill,
  resetPracticeStats,
  syncPracticeStrikeStats,
  stepPracticeDrillTick,
  summonPracticeBall,
  configurePracticeRoster,
  applyPracticeHudOverrides,
  restorePracticeHudOverrides,
  getPracticeSessionSeconds,
  getSelectedPracticeBallType,
  setSelectedPracticeBallType,
  getSelectedPracticeDrill,
} from './features/match/practiceMode.js';
import {
  readFixtureFromSearch, fixtureMatchSetup, createFixtureRandom, fixtureBotSeed, resultSide, buildMatchResult,
} from './features/match/matchFixture.js';
import { replayManager, generateMatchSeed, createMatchRandom } from './features/match/replayManager.js';
import {
  initInputRouter,
  sampleAllInputs,
  clearGameplayInputQueues,
  getControlsSnapshot,
  getInputSlot,
  consumeAthleteJump,
  consumeAthleteDive,
  consumeAthleteCut,
  consumeAthleteVolley,
  consumeAthleteSpike,
  consumeAthleteBallReset,
  consumeCameraCyclePlayer,
  consumeCameraCycleArena,
  consumeMenuToggle,
  consumeMenuToggleOwner,
  getMouseDeltas,
  getMouseSlot,
  getCameraCycleHint,
  exitGamePointerLock,
  triggerHaptic,
  setExplicitDeviceMappings,
  assignDefaultDeviceForSlot,
  syncExplicitMappingsWithConfigs,
} from './input/inputRouter.js';
import { createMenuPadTracker, MENU_PAD } from './input/menuPads.js';
import { updateSportsCamera } from './visuals/sportsCamera.js';
import { createBotController, updateBot } from './ai/botController.js';
import { createTurfParticleSystem, getPitchSurfaceColor } from './visuals/turfParticles.js';
import { createGoalCelebrationSystem } from './visuals/goalCelebration.js';
import { createGoalIndicators } from './visuals/goalIndicators.js';
import { createBallDropRings } from './visuals/ballDropRing.js';
import { createSetupBallPreview } from './visuals/setupBallPreview.js';
import { warmupSceneShaders } from './visuals/shaderWarmup.js';
import { setHudVisible, updateHud } from './ui/hudOverlay.js';
import { initMatchReadabilityHud, updateMatchReadabilityHud } from './ui/matchReadabilityHud.js';
import { initOvertimeMenu, showOvertimeMenu, hideOvertimeMenu, isOvertimeMenuOpen } from './ui/overtimeMenu.js';
import { initVictoryScreen, showVictoryScreen, hideVictoryScreen, showPracticeSummary, isVictoryScreenVisible } from './ui/victoryScreen.js';
import { initControlsOverlay, updateControlsOverlay, setControlsOverlayEnabled, hideControlsOverlay } from './ui/controlsOverlay.js';
import { logClipInventory } from './debug/clipInventory.js';
import { initCountdownOverlay, updateCountdownOverlay, resetCountdownOverlay } from './ui/countdownOverlay.js';
import { initInGameMenu, toggleInGameMenu, hideInGameMenu, updateInGameMenuBanner, isInGameMenuOpen } from './ui/inGameMenu.js';
import { updatePracticeHud, hidePracticeHud } from './ui/practiceHud.js';
import { initReplayDock, updateReplayDock, resetReplayDockState, sampleFreeDroneInput } from './ui/replayDock.js';
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
import {
  resolveStrikeContact, resolveBraceRedirect, strikeProbe, KIND_NAME,
} from './mechanics/strikes.js';
import { updateScoring, matchProbe, recordBallTeamTouch } from './mechanics/scoring.js';
import { createScoreboards, updateScoreboards, loadDisplayFont } from './visuals/scoreboards.js';
import { createHustleBoards, updateHustleBoards } from './visuals/hustleBoards.js';
import { displayCoordinator } from './visuals/displayCoordinator.js';
import { initCelestialSkybox } from './visuals/skybox.js';
import { soundManager } from './audio/soundManager.js';
import { createGui } from './debug/gui.js';
import { installHotkeys } from './debug/hotkeys.js';
import { initCapture } from './debug/capture.js';
import { initStateTrace } from './debug/stateTrace.js';
import { readFixture, applyFixtureServes, fixtureParksBall } from './debug/fixture.js';

export { showCameraNotification, showHeadwearToast, practiceStats };

const _zeroVector = new THREE.Vector3(0, 0, 0);

/** Slack on the weight-sum assertion, for the easings' floating-point residue. */
const WEIGHT_SUM_TOLERANCE = 1e-3;

/** Served straight out of public/. The 30-clip character asset. */
const CHARACTER_URL = assetUrl('models/character.glb');

// Degrees between the pelvis body's own up axis and world up.
const _tiltQuat = new THREE.Quaternion();
const _tiltAxis = new THREE.Vector3();
const pelvisTilt = (q) => {
  _tiltQuat.set(q.x, q.y, q.z, q.w);
  _tiltAxis.set(0, 1, 0).applyQuaternion(_tiltQuat);
  return (Math.acos(Math.max(-1, Math.min(1, _tiltAxis.y))) * 180) / Math.PI;
};

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const canvas = document.getElementById('viewport');
const _bootSearch = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const _needsDrawingBuffer = Boolean(
  _bootSearch && (
    _bootSearch.has('captureTick') ||
    _bootSearch.has('capture') ||
    _bootSearch.has('fixture') ||
    _bootSearch.has('stateTrace')
  ),
);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  // Enabled only for headless/manual capture modes; leaving false in live play
  // allows fast swapchain flips without a per-frame full-screen MSAA backbuffer copy.
  preserveDrawingBuffer: _needsDrawingBuffer,
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
initCelestialSkybox(scene);

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

const ambientLight = new THREE.AmbientLight(0x8fb4d6, 0.20);
const hemisphereLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.05);
scene.add(ambientLight, hemisphereLight);

/**
 * PLAYER & CINEMATIC CAMERAS — owned by viewportManager.
 */
const { playerCameras, spectatorCamera, cinematicCamera } = viewportManager;

const turfParticles = createTurfParticleSystem(scene);
const goalCelebration = createGoalCelebrationSystem(scene);
const goalIndicators = createGoalIndicators(scene);
const ballDropRings = createBallDropRings(scene);
const setupBallPreview = createSetupBallPreview(scene);

const _pitchRayOrigin = { x: 0, y: 0, z: 0 };
const _pitchRayDown = { x: 0, y: -1, z: 0 };
let _pitchRay = null;

function queryPitchSurfaceY(x, z, refY = 1.0) {
  if (activeArenaType() === 'court' && isCourtFloorSampleAvailable(x, z)) {
    return getCourtFloorY(x, z);
  }
  const world = getWorld();
  if (!world) return Math.max(0, refY - 0.5);
  if (!_pitchRay) _pitchRay = new RAPIER.Ray(_pitchRayOrigin, _pitchRayDown);
  _pitchRayOrigin.x = x; _pitchRayOrigin.y = Math.max(refY + 1.5, 2.0); _pitchRayOrigin.z = z;
  const hit = world.castRay(_pitchRay, 5.0, true, undefined, ENVIRONMENT_RAY_GROUPS);
  return hit ? _pitchRayOrigin.y - hit.timeOfImpact : Math.max(0, refY - 0.5);
}

const camera = playerCameras[0].camera;
const cameraRig = playerCameras[0]; // backward compatibility for debug capture & telemetry

const flyoverPads = createMenuPadTracker();
let gameState = 'menu'; // 'menu' | 'flyover' | 'match' | 'overtime_menu' | 'practice'
let victoryCameraActive = false;
let victoryScreenTimer = null;

let athletes = [];
/**
 * Mutable holder for the lil-gui headwear dropdowns ({ p1, p2, p3, p4 }). Owned here so
 * the headwear hotkeys and the gui panel read and write the same live state.
 */
const headwearControls = { p1: 'manager_cap', p2: 'manager_cap', p3: 'manager_cap', p4: 'manager_cap' };
let botControllers = [];
let activeBotSlots = [];
const athleteMatchStats = [0, 1, 2, 3].map((i) => createPlayerMatchStats(i));
let activeFixture = null;
let fixtureRandom = null;
let currentMatchSeed = 0;
let currentMatchRandom = null;
let fixtureFlyoverEndTick = -1;
let lastMatchConfigs = null;
let lastMatchSpawns = null;
let balls = [];
let allBalls = [];
let currentMatchBallType = 'random';
let matchState = null;
let scoreboards = null;
let hustleBoards = null;
let ball = null;
const ballByHandle = new Map();
let arenaPreset = null;
let armedCaptureTick = null;
let captureFixture = null;
let characterClips = [];
let characterRoot = null;
let characterSkeleton = null;
let guiInstance = null;
let respawnRequested = false;
let baselineCounts = null;

function getActiveHumanSlots() {
  return viewportManager.getActiveHumanSlots();
}

viewportManager.init({
  renderer,
  scene,
  stadiumLights,
  ambientLight,
  hemisphereLight,
  turfParticles,
  getActiveBotSlots: () => activeBotSlots,
  getAthletes: () => athletes,
  getGameState: () => gameState,
  onControlsOverlayChange: (visible) => {
    setControlsOverlayEnabled(visible);
    if (!visible) hideControlsOverlay();
  },
  getGuiInstance: () => guiInstance,
});

function ensureAthletesRegistered(count, configs) {
  athletes = athleteManager.ensureRoster(count, configs);
  for (const a of athletes) {
    if (a?.motor?.interpolated && !loop.interpolated.includes(a.motor.interpolated)) {
      loop.register(a.motor.interpolated);
    }
  }
  return athletes;
}

const syncPlayerCameraMode = (playerIndex, mode) => viewportManager.syncPlayerCameraMode(playerIndex, mode);
const leaveSharedCameraForOtherSlot = (changedPlayerIndex) => viewportManager.leaveSharedCameraForOtherSlot(changedPlayerIndex);
const cyclePlayerCameraView = (playerIndex = 0, delta = 1) => viewportManager.cyclePlayerCameraView(playerIndex, delta);
const cycleArenaCameraView = (playerIndex = 0, delta = 1) => viewportManager.cycleArenaCameraView(playerIndex, delta);
const applyCameraTuning = () => viewportManager.applyCameraTuning();
const applyViewportSize = () => viewportManager.applyViewportSize();
const applyShadowSettings = () => viewportManager.applyShadowSettings();
applyShadowSettings();
const applyRenderSettings = (settings = {}) => viewportManager.applyRenderSettings(settings);

function setActiveMatchBall(typeOrIndex = 'random', randomFn = Math.random, allowMultiBall = false) {
  if (allBalls.length === 0) return null;

  if (typeOrIndex === 'all' && allowMultiBall) {
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
    chosenIdx = Math.floor(randomFn() * allBalls.length);
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

// Impacts are read from the step just taken and spent on the SAME tick, so a
// hit and its cost are never a frame apart. The queue auto-drains at the next
// step, so anything not taken here is gone — an impact belongs to its tick.
function drainImpacts(tick, dt) {
  if (gameState === 'menu' || gameState === 'flyover') { drainContactForces(() => {}); return; }
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

        // AGILE BRACE ACTIVE REDIRECT (GF-2.1). A held brace turns ball contact
        // into a block: inbound energy is absorbed and the exit is redirected
        // forward along the athlete's facing. Fires only when no strike resolved
        // on this same contact, so a swing and a block never double-apply. When a
        // redirect lands inside the intercept-dive window it marks that dive as
        // "connected", so the whiff recovery in actions.js is skipped.
        const athleteIdx = athletes.indexOf(athleteHit);
        if (!didStrike) {
          const braceMix = athleteHit.actionState ? athleteHit.actionState.braceMix : 0;
          if (braceMix > 0.2) {
            const facingYaw = athleteHit.animTarget ? athleteHit.animTarget.yaw : 0;
            if (resolveBraceRedirect(hitBall, braceMix, facingYaw, tick)) {
              const as = athleteHit.actionState;
              if (Number.isFinite(as.lastInterceptDiveTick) &&
                  tick - as.lastInterceptDiveTick <= TUNING.action.interceptDiveWindowTicks) {
                as.interceptDiveContactTick = as.lastInterceptDiveTick;
              }
              if (athleteIdx >= 0 && gameState === 'match' && athleteMatchStats[athleteIdx]) {
                athleteMatchStats[athleteIdx].defensiveBlocks++;
              } else if (athleteIdx === 0 && gameState === 'practice') {
                practiceStats.defensiveBlocks++;
              }
            }
          }
        }

        const ballPos = hitBall.body.translation();

        // Track live match & practice statistics
        if (athleteIdx >= 0) {
          // Touch cooldown: only allow a touch to register once every 0.25 seconds (15 ticks at 60Hz)
          const touchCooldownTicks = Math.round(0.25 * TUNING.loop.fixedHz);
          const lastTouch = athleteHit._lastTouchTick ?? -999;
          const isNewTouch = (tick - lastTouch) >= touchCooldownTicks;

          if (isNewTouch) {
            athleteHit._lastTouchTick = tick;
            const teamId = TUNING.players[athleteIdx]?.team || (athleteIdx % 2 === 0 ? 'home' : 'away');
            recordBallTeamTouch(hitBall, teamId, athleteIdx);

            if (athleteMatchStats[athleteIdx] && gameState === 'match') {
              athleteMatchStats[athleteIdx].totalTouches++;

              const distToSouthCircle = Math.hypot(ballPos.x, ballPos.z - 40.0);
              const distToNorthCircle = Math.hypot(ballPos.x, ballPos.z - (-40.0));
              const isHome = teamId === 'home';
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
          if (isTorsoOrHead && (speed > TUNING.impact.ballKnockdownSpeed || momentum > TUNING.impact.ballKnockdownMomentum)) {
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
          const wasOffGlass = (tick - (hitBall._lastGlassContactTick || 0)) > 12;
          hitBall._lastGlassContactTick = tick;
          const sincePlay = tick - (hitBall._lastGlassPlayTick || -999);
          if ((wasOffGlass && sincePlay >= 18) || (!wasOffGlass && sincePlay >= 42 && totalForce > 14)) {
            hitBall._lastGlassPlayTick = tick;
            soundManager.playGlassImpact(speed, ballPos, !wasOffGlass);
          }
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
      resolveAthleteCollision({
        a1: athlete1,
        a2: athlete2,
        hit1,
        hit2,
        tick,
        athletes,
        playerCameras,
      });
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

// Once a second. A non-finite transform propagates through the joint graph in
// a few steps and then the character disappears with no other symptom, so the
// first body to go bad is worth naming.
function assertInvariants(tick) {
  if (balls.length && tick % TUNING.loop.fixedHz === 0) {
    for (const b of balls) {
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

  if (tick % TUNING.loop.fixedHz === 0) {
    for (const a of athletes) {
      if (!a?.isEnabled || !a.ragdoll || !a.animTarget) continue;
      const bad = findNonFinite(a.ragdoll);
      if (bad) console.error(`[ragdoll] non-finite transform on "${bad}" at tick ${tick}`);

      const audit = weightAudit(a.animTarget);
      if (Math.abs(audit.shares - 1) > WEIGHT_SUM_TOLERANCE ||
          Math.abs(audit.targets - 1) > WEIGHT_SUM_TOLERANCE) {
        console.error(
          `[animtarget] weight partition broken at tick ${tick}: ` +
            `shares ${audit.shares.toFixed(5)}, targets ${audit.targets.toFixed(5)}`,
        );
      }

      const strafe = strafeSignViolation(a.animTarget);
      if (strafe) console.error(`[animtarget] strafe sign wrong at tick ${tick}: ${strafe}`);

      const flail = flailViolation(a.animTarget);
      if (flail !== null) {
        console.error(
          `[animtarget] flail at tick ${tick}: airborneMix ${a.animTarget.airborneMix.toFixed(2)} ` +
            `but locomotion weight is ${flail.toFixed(3)}`,
        );
      }
    }
  }
}

function getWinningAthlete() {
  const homeScore = matchState?.scoreHome || 0;
  const awayScore = matchState?.scoreAway || 0;
  const winningTeam = awayScore > homeScore ? 'away' : 'home';
  return athletes.find((a) => a?.isEnabled && a.team === winningTeam) || athletes[0] || null;
}

function finishMatchAndReport(tick) {
  if (!matchState || matchState._buzzerPlayed) return;
  hideControlsOverlay();
  hideOvertimeMenu();
  matchState.matchOver = true;
  matchState._buzzerPlayed = true;
  soundManager.playSample('arena_buzzer', 0.95, 1.0, null, soundManager.uiGain);

  const slotStats = athletes.map((ath, idx) => ({
    ...(ath?.getStrikeStats() || { hits: 0, whiffs: 0, accuracy: 0 }),
    ...(athleteMatchStats[idx] || {}),
  }));
  const statsReport = buildMatchStatsReport({
    match: matchProbe(matchState),
    athletes,
    athleteMatchStats,
    playerConfigs: lastMatchConfigs || TUNING.players,
    activeCount: Math.max(2, athletes.filter((a) => a && a.isEnabled !== false).length),
  });
  window.__vb.lastMatchStatsReport = statsReport;

  if (replayManager.isPlayingBack()) {
    replayManager.setPlaybackPaused(true);
    return;
  }

  const winnerAthlete = getWinningAthlete();
  const winnerPos = winnerAthlete?.motor?.body?.translation() || { x: 0, y: 0, z: 0 };
  cinematicCamera.startVictoryPresentation(new THREE.Vector3(winnerPos.x, winnerPos.y, winnerPos.z), 12.0);
  victoryCameraActive = true;

  if (victoryScreenTimer) clearTimeout(victoryScreenTimer);
  victoryScreenTimer = setTimeout(() => {
    victoryScreenTimer = null;
    if (replayManager.isPlayingBack() || gameState === 'menu') return;
    showVictoryScreen(matchProbe(matchState), slotStats[0], slotStats[1], statsReport);
  }, 1200);

  reportMatchResult(tick, slotStats, statsReport);
  const sh = matchState?.scoreHome || 0; const sa = matchState?.scoreAway || 0;
  const winner = sh > sa ? 'home' : (sa > sh ? 'away' : 'draw');
  if (replayManager.isRecording()) replayManager.recordPoseTick({ athletes, balls, matchState, forceCapture: true });
  replayManager.finishMatchRecording({ scoreHome: sh, scoreAway: sa, winner });
  cinematicCamera.stopFreeFly(); resetReplayDockState();
}

/**
 * Fixed-timestep simulation step (60 Hz).
 *
 * @param {number} dt
 * @param {number} tick
 */
function fixedUpdate(dt, tick) {
  if (athletes.length === 0 || gameState === 'overtime_menu') return;
  if (replayManager.isPosePlayback() && gameState === 'match') return;
  if (replayManager.isPlayingBack() && gameState === 'match' && !(matchState && matchState.isCountingDown)) {
    const steps = replayManager.consumePlaybackSteps();
    for (let s = 0; s < steps; s++) {
      if (!replayManager.isPlayingBack() || matchState?.matchOver) break;
      stepSimulationTick(dt, tick + s);
    }
    return;
  }
  stepSimulationTick(dt, tick);
}

function stepSimulationTick(dt, tick) {
  if (athletes.length === 0 || gameState === 'overtime_menu') return;
  const isSeekingReplay = replayManager.isSeeking();

  // 0 — A fixture's flyover ends on a tick, so its countdown starts on the same
  // tick every run, however the frames happened to fall.
  if (gameState === 'flyover' && fixtureFlyoverEndTick >= 0 && tick >= fixtureFlyoverEndTick) {
    skipFlyover();
  }

  // 1 — RESPAWN REQUESTS
  if (respawnRequested) {
    respawnRequested = false;
    for (let i = 0; i < athletes.length; i++) {
      if ((i > 0 && armedCaptureTick !== null) || !athletes[i]?.isEnabled) continue;
      athletes[i].requestRespawn();
    }
  }

  // 2 — BALL WATCHDOG & SERVE (B / Select self-toss in Practice, or out of bounds)
  let practiceTossTriggered = false;
  if (gameState === 'practice') {
    for (let i = 0; i < athletes.length; i++) {
      if (athletes[i]?.isEnabled && consumeAthleteBallReset(i)) {
        summonPracticeBall(athletes[i], balls, tick, resetBall);
        practiceTossTriggered = true;
      }
    }
  } else {
    consumeAthleteBallReset(0);
  }
  const armedBallSpawn = armedCaptureTick !== null && tick === TUNING.ball.captureSpawnTick;
  const isPlayingReplay = replayManager.isPlayingBack();
  const isDeterministic = armedCaptureTick !== null || activeFixture !== null || replayManager.isRecording() || isPlayingReplay;

  for (let i = 0; i < balls.length; i += 1) {
    const b = balls[i];
    if (!b?.body || (typeof b.body.isEnabled === 'function' && !b.body.isEnabled())) continue;
    if (captureFixture && fixtureParksBall(captureFixture, i)) continue;
    const bp = b.body.translation();
    const outOfBounds = !Number.isFinite(bp.y) || bp.y < arenaPreset.killPlaneY || Math.abs(bp.x) > 33 || Math.abs(bp.z) > 68;
    if (armedBallSpawn || outOfBounds) {
      resetBall(b, tick, getCourtBallDropSpawn(i, balls.length, tick, isDeterministic));
      if (outOfBounds && !practiceTossTriggered && !armedBallSpawn) {
        console.log(`[ball:${b.id}] out of bounds (${bp.x?.toFixed?.(1)}, ${bp.y?.toFixed?.(1)}, ${bp.z?.toFixed?.(1)}) - reset at tick ${tick}`);
      }
    }
  }

  if (captureFixture) applyFixtureServes(captureFixture, tick, balls, resetBall);

  // ─── AI BOT DECISION & SYNTHETIC INPUT EXECUTION ───
  if (!isPlayingReplay) {
    for (const bc of botControllers) {
      const botAthlete = athletes[bc.slotIndex];
      const opponentIdx = bc.slotIndex % 2 === 0 ? 1 : 0;
      const opponent = athletes[opponentIdx] || null;
      const botSlot = getInputSlot(bc.slotIndex);
      updateBot(bc, botAthlete, opponent, balls, matchState, botSlot, tick, dt, athletes);
    }
  }

  // 3 to 10 — ATHLETE PRE-PHYSICS MECHANICS (Drive, Jump, Slide, Dive, Strikes, Ghost, Tracking)
  const isCountingDown = (gameState === 'match') && !!(matchState && matchState.isCountingDown);
  const isAthleteHeld = isCountingDown || (gameState === 'menu') || (gameState === 'flyover');
  const isBallHeld = (gameState === 'match' && isCountingDown) || (gameState === 'flyover');
  const hoopNorthZ = TUNING.match?.hoopNorthZ ?? -40.0;
  const hoopSouthZ = TUNING.match?.hoopSouthZ ?? 40.0;
  const replaySlots = (isPlayingReplay && gameState === 'match' && !isAthleteHeld) ? replayManager.readPlaybackTick() : null;
  const recordLiveTick = !isPlayingReplay && gameState === 'match' && !isAthleteHeld && replayManager.isRecording();

  for (let i = 0; i < athletes.length; i++) {
    const athlete = athletes[i];
    if (!athlete?.isEnabled) continue;
    const athTeam = athlete.team || TUNING.players?.[i]?.team || (i % 2 === 0 ? 'home' : 'away');
    const athAttacksNorth = (athTeam === 'home') ? (matchState?.targetGoal === 'N') : (matchState?.targetGoal === 'S');
    const athTargetGoalZ = athAttacksNorth ? hoopNorthZ : hoopSouthZ;
    let inputSnapshot = getInputSlot(i);
    let jumpQueued = consumeAthleteJump(i);
    let diveQueued = consumeAthleteDive(i);
    let cutQueued = consumeAthleteCut(i);
    let volleyQueued = consumeAthleteVolley(i);
    let spikeQueued = consumeAthleteSpike(i);
    let facingFollowsCamera = !isAthleteHeld && !activeBotSlots.includes(i) && (playerCameras[i]?.mode === 'chase' || playerCameras[i]?.mode === 'ball' || playerCameras[i]?.mode === 'thirdPerson' || playerCameras[i]?.mode === 'firstPerson');

    if (replaySlots && replaySlots[i]) {
      const rf = replaySlots[i];
      inputSnapshot = rf.inputSnapshot;
      jumpQueued = rf.jumpQueued;
      diveQueued = rf.diveQueued;
      cutQueued = rf.cutQueued;
      volleyQueued = rf.volleyQueued;
      spikeQueued = rf.spikeQueued;
      facingFollowsCamera = rf.facingFollowsCamera;
    } else if (isAthleteHeld) {
      inputSnapshot = {
        ...inputSnapshot,
        moveX: 0,
        moveZ: 0,
        sprintHeld: false,
        slideHeld: false,
        braceHeld: false,
        moveWorld: _zeroVector,
      };
      jumpQueued = false;
      diveQueued = false;
      cutQueued = false;
      volleyQueued = false;
      spikeQueued = false;
    } else if (recordLiveTick) {
      replayManager.recordSlot(i, inputSnapshot, {
        jumpQueued, diveQueued, cutQueued, volleyQueued, spikeQueued, facingFollowsCamera,
      });
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
      targetGoalZ: athTargetGoalZ,
      facingFollowsCamera,
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

      // 3. Slide continuous turf spray
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

      // 4. Locomotion turf kick
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

    // Single-fire knockdown haptic feedback
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
  if (recordLiveTick) replayManager.commitTick();

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
            b._preMatchSpawnPos = matchState?.preMatchSpawnPos || getCourtBallDropSpawn(i, balls.length, tick, activeFixture !== null);
            if (matchState && !matchState.preMatchSpawnPos) {
              matchState.preMatchSpawnPos = b._preMatchSpawnPos;
            }
          }
          b.body.setTranslation(b._preMatchSpawnPos, true);
        } else if (gameState !== 'flyover') {
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

  // 12b — SCORING & OVERTIME
  let scoredThisTick = false;
  if (matchState && (gameState === 'match' || gameState === 'practice')) {
    const goalsBefore = matchState.events.length;
    if (matchState.isGoldenGoal && !matchState.matchOver) {
      matchState.ticksRemaining = Math.max(matchState.ticksRemaining || 600, 600);
    }
    updateScoring(matchState, balls, tick);
    if (matchState.events.length > goalsBefore) {
      scoredThisTick = true;
      const lastGoal = matchState.events[matchState.events.length - 1];
      const hoopPos = {
        x: 0,
        y: TUNING.match.hoopCenterY,
        z: lastGoal.goal === 'N' ? TUNING.match.hoopNorthZ : TUNING.match.hoopSouthZ,
      };
      if (!isSeekingReplay) {
        soundManager.playGoal(lastGoal.scoredFor, lastGoal.goal, hoopPos);
        goalCelebration.triggerGoal(lastGoal.scoredFor, hoopPos, { y: lastGoal.y, z: lastGoal.z });
      }
      if (gameState === 'practice') {
        practiceStats.goals++;
      } else if (gameState === 'match') {
        const scoringBall = balls[0];
        const scoredTeam = lastGoal.scoredFor;
        let scorerSlot = null;
        let assistSlot = null;
        if (scoringBall?._lastTouchByTeam) {
          scorerSlot = scoringBall._lastTouchByTeam[scoredTeam] ?? null;
          assistSlot = scoringBall._prevTouchByTeam?.[scoredTeam] ?? null;
          if (scorerSlot !== null && athleteMatchStats[scorerSlot]) {
            athleteMatchStats[scorerSlot].goals = (athleteMatchStats[scorerSlot].goals || 0) + 1;
          }
          if (assistSlot !== null && assistSlot !== scorerSlot && athleteMatchStats[assistSlot]) {
            athleteMatchStats[assistSlot].assists = (athleteMatchStats[assistSlot].assists || 0) + 1;
          }
          scoringBall._lastTouchByTeam = { home: null, away: null };
          scoringBall._prevTouchByTeam = { home: null, away: null };
        }
        replayManager.recordGoal({
          scoredFor: scoredTeam, goal: lastGoal.goal, scoreHome: matchState.scoreHome, scoreAway: matchState.scoreAway, scorerSlot, assistSlot,
        });
        // Golden Goal sudden death: first goal immediately wins the match!
        if (matchState.isGoldenGoal) {
          matchState.matchOver = true;
        }
      }
    }
    if (gameState === 'match' && matchState.matchOver && !matchState._buzzerPlayed) {
      const isTied = (matchState.scoreHome || 0) === (matchState.scoreAway || 0);
      if (isTied && !matchState._agreedDraw) {
        const replayOt = isPlayingReplay ? replayManager.getPlaybackOvertimeDecision() : null;
        if (replayOt) {
          matchState.matchOver = false;
          applyOvertimeAgreement(replayOt);
        } else if (isPlayingReplay) {
          matchState._agreedDraw = true;
          finishMatchAndReport(tick);
        } else if (activeFixture) {
          const otRule = activeFixture.overtime || 'draw';
          if (otRule === 'golden_goal' || otRule === 'timed') {
            matchState.matchOver = false;
            applyOvertimeAgreement({
              format: otRule,
              durationSeconds: activeFixture.overtimeDurationSeconds || 120,
              positionMode: 'respawn',
            });
          } else {
            matchState._agreedDraw = true;
            finishMatchAndReport(tick);
          }
        } else {
          // Interactive match ended regulation or timed overtime in a tie -> open Overtime Menu
          matchState.matchOver = false;
          soundManager.playSample('arena_buzzer', 0.95, 1.0, null, soundManager.uiGain);
          hideControlsOverlay();
          hideInGameMenu();
          exitGamePointerLock();
          gameState = 'overtime_menu';
          showOvertimeMenu({
            scoreHome: matchState.scoreHome || 0,
            scoreAway: matchState.scoreAway || 0,
            overtimePeriod: (matchState.overtimePeriod || 0) + 1,
          });
        }
      } else {
        finishMatchAndReport(tick);
      }
    }
  }

  if (gameState === 'practice') {
    stepPracticeDrillTick({ tick, athletes, balls, resetBallFn: resetBall });
  }

  // 13 — POST-PHYSICS (Snapshots, strike assist, and player combat)
  for (let i = 0; i < athletes.length; i++) {
    if (!athletes[i]?.isEnabled) continue;
    try {
      const assistEvent = athletes[i].postPhysicsUpdate(tick, dt, balls, athletes, i);
      if (assistEvent) {
        const athlete = athletes[i];
        const touchCooldownTicks = Math.round(0.25 * TUNING.loop.fixedHz);
        const lastTouch = athlete._lastTouchTick ?? -999;
        if ((tick - lastTouch) >= touchCooldownTicks) {
          athlete._lastTouchTick = tick;
          recordBallTeamTouch(balls[0], TUNING.players[i]?.team || (i % 2 === 0 ? 'home' : 'away'), i);
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
  if (recordLiveTick) {
    Object.assign(_poseTickArgs, { athletes, balls, matchState, forceCapture: scoredThisTick });
    replayManager.recordPoseTick(_poseTickArgs);
  }
  assertInvariants(tick);
}
const _poseTickArgs = { athletes: null, balls: null, matchState: null, forceCapture: false };
const _posePlayArgs = { athletes: null, balls: null, matchState: null, goalCelebration: null, playerCameras: null };

const NO_MOUSE_DELTAS = Object.freeze({ dx: 0, dy: 0 });
const _athGoalScratch = { x: 0, y: 10.0, z: -40.0 };
const _camUpdateArgs = {
  athlete: null, activeBall: null, inputSlot: null, mouseDeltas: NO_MOUSE_DELTAS,
  world: null, frameDelta: 0, allAthletes: null, attackingGoal: _athGoalScratch,
};
const _goalIndArgs = { gameState: 'menu', matchState: null, tick: 0 };
const _ballDropRingArgs = { gameState: 'menu', balls: null, athletes: null, isVictoryActive: false };
const _renderSceneArgs = {
  gameState: 'menu', matchState: null, victoryCameraActive: false,
  athletes: null, humanSlots: null, stepsThisFrame: 0, replayFollowSlot: -1,
};
const _readabilityHudArgs = {
  gameState: 'menu', isVictoryActive: false, isMenuOpen: false,
  match: null, practiceStats: null, athletes: null, balls: null,
  viewportLayout: null, isSplitscreen: false, tick: 0,
};
const _hudArgs = { match: null, athletes: null, ball: null, balls: null, loop: null, cameraRig: null };

/**
 * Updates all player cameras for the current frame.
 */
function updateCameras() {
  const world = getWorld();
  if (!world) return;

  const frameDelta = Math.min(loop.frameTimeMs / 1000, TUNING.loop.maxFrameTime);
  const activeBall = ball || (balls && balls[0]) || null;

  for (let i = 0; i < athletes.length; i++) {
    const pDelta = consumeCameraCyclePlayer(i);
    if (pDelta !== 0) {
      cyclePlayerCameraView(i, pDelta);
    }
    const aDelta = consumeCameraCycleArena(i);
    if (aDelta !== 0) {
      cycleArenaCameraView(i, aDelta);
    }
  }

  const hoopCenterY = TUNING.match?.hoopCenterY ?? 10.0;
  const hoopNorthZ = TUNING.match?.hoopNorthZ ?? -40.0;
  const hoopSouthZ = TUNING.match?.hoopSouthZ ?? 40.0;
  const mouseSlot = getMouseSlot();

  _camUpdateArgs.activeBall = activeBall;
  _camUpdateArgs.world = world;
  _camUpdateArgs.frameDelta = frameDelta;
  _camUpdateArgs.allAthletes = athletes;

  for (let i = 0; i < athletes.length; i++) {
    const athlete = athletes[i];
    if (!athlete?.isEnabled || !playerCameras[i]) continue;
    const athTeam = athlete.team || TUNING.players?.[i]?.team || (i % 2 === 0 ? 'home' : 'away');
    const athAttacksNorth = (athTeam === 'home') ? (matchState?.targetGoal === 'N') : (matchState?.targetGoal === 'S');
    _athGoalScratch.y = hoopCenterY;
    _athGoalScratch.z = athAttacksNorth ? hoopNorthZ : hoopSouthZ;
    _camUpdateArgs.athlete = athlete;
    _camUpdateArgs.inputSlot = getInputSlot(i);
    _camUpdateArgs.mouseDeltas = mouseSlot === i ? getMouseDeltas() : NO_MOUSE_DELTAS;
    playerCameras[i].update(_camUpdateArgs);
  }

  if (getActiveHumanSlots().length === 0) {
    updateSportsCamera(spectatorCamera, athletes, activeBall, frameDelta);
  }
}
const updateSpringArm = updateCameras;

let renderFrameCount = 0;

/**
 * The render pass. Supports single-viewport, 2-way splitscreen, and 4-way quad splitscreen modes.
 *
 * @param {number} alpha
 */
function render(alpha) {
  renderFrameCount++;
  displayCoordinator.reset(1);

  const frameDelta = Math.min(loop.frameTimeMs / 1000, TUNING.loop.maxFrameTime);
  if (replayManager.isPosePlayback() && gameState === 'match') {
    Object.assign(_posePlayArgs, { athletes, balls, matchState, goalCelebration, playerCameras });
    replayManager.advancePosePlayback(frameDelta, _posePlayArgs);
  } else {
    const registry = loop.interpolated; for (let i = 0; i < registry.length; i += 1) registry[i].apply(alpha);
    for (let i = 0; i < athletes.length; i++) {
      const athlete = athletes[i];
      if (!athlete?.isEnabled) { if (athlete?.ragdoll?.group) athlete.ragdoll.group.visible = false; continue; }
      athlete.renderPose(alpha);
    }
  }
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

  // Pause simulation while menu is open during live match, practice, or replay playback
  // so players and broadcasters can change settings without bots or clock advancing.
  loop.paused = isInGameMenuOpen() && (
    replayManager.isPlayingBack() || gameState === 'match' || gameState === 'practice'
  );

  const isVictoryActive = (gameState === 'match') && !!(matchState && matchState.matchOver) && victoryCameraActive;

  if (gameState === 'flyover') {
    cinematicCamera.update(frameDelta);
    const pads = (navigator.getGamepads ? navigator.getGamepads() : []) || [];
    flyoverPads.update(pads);
    for (const pad of pads) {
      if (pad && (flyoverPads.pressed(pad) & (MENU_PAD.a | MENU_PAD.start))) {
        skipFlyover();
        break;
      }
    }
    if (cinematicCamera.isComplete && fixtureFlyoverEndTick < 0) {
      skipFlyover();
    }
  } else if (gameState === 'menu' || isVictoryActive) {
    if (isVictoryActive && athletes) {
      const winnerAthlete = getWinningAthlete();
      const wt = winnerAthlete?.motor?.body?.translation();
      if (wt) cinematicCamera.winnerPos.set(wt.x, wt.y, wt.z);
    }
    cinematicCamera.update(frameDelta);
    if (gameState === 'menu') setupBallPreview.update(frameDelta, allBalls);
  } else if (cinematicCamera.mode === 'free') {
    if (!isInGameMenuOpen()) cinematicCamera.updateFreeFly(frameDelta, sampleFreeDroneInput());
  } else if (gameState !== 'overtime_menu') {
    updateCameras();
  }

  if (consumeMenuToggle() && gameState !== 'menu' && gameState !== 'flyover' && gameState !== 'overtime_menu' && !isInGameMenuOpen()) {
    toggleInGameMenu(consumeMenuToggleOwner());
  }

  const match = matchState ? matchProbe(matchState) : null;
  if (match && matchState) {
    match.isGoldenGoal = Boolean(matchState.isGoldenGoal);
    match.overtimeMode = matchState.overtimeMode || null;
    match.overtimePeriod = matchState.overtimePeriod || 0;
  }

  const isPracticeActive = (gameState === 'practice');
  syncPracticeStrikeStats(athletes[0]);

  const celebTicks = matchState?.celebrationTicks || 0;
  // Alternate priority so scoreboards and hustle boards do not starve each other (zero per-frame closures)
  if (renderFrameCount % 2 === 0) {
    updateScoreboards(scoreboards, match);
    updateHustleBoards(hustleBoards, practiceStats, getPracticeSessionSeconds(), isPracticeActive, celebTicks, match, athletes, athleteMatchStats, loop.tick);
  } else {
    updateHustleBoards(hustleBoards, practiceStats, getPracticeSessionSeconds(), isPracticeActive, celebTicks, match, athletes, athleteMatchStats, loop.tick);
    updateScoreboards(scoreboards, match);
  }

  if (match) {
    if (gameState === 'match') {
      updateCountdownOverlay(match.countdownSecondsRemaining, match.isCountingDown, frameDelta);
    }
    updateInGameMenuBanner(match);
  }

  _goalIndArgs.gameState = gameState;
  _goalIndArgs.matchState = matchState;
  _goalIndArgs.tick = loop.tick;
  goalIndicators.update(_goalIndArgs);

  _ballDropRingArgs.gameState = gameState;
  _ballDropRingArgs.balls = balls;
  _ballDropRingArgs.athletes = athletes;
  _ballDropRingArgs.isVictoryActive = isVictoryActive;
  ballDropRings.update(_ballDropRingArgs);

  const humanSlots = getActiveHumanSlots();
  _renderSceneArgs.gameState = gameState === 'overtime_menu' ? 'match' : gameState;
  _renderSceneArgs.matchState = matchState;
  _renderSceneArgs.victoryCameraActive = victoryCameraActive;
  _renderSceneArgs.athletes = athletes;
  _renderSceneArgs.humanSlots = humanSlots;
  _renderSceneArgs.stepsThisFrame = replayManager.isPosePlayback() ? 1 : loop.stepsThisFrame;
  _renderSceneArgs.replayFollowSlot = replayManager.isPlayingBack() ? replayManager.getFollowSlot() : -1;
  viewportManager.renderScene(_renderSceneArgs);

  _readabilityHudArgs.gameState = gameState;
  _readabilityHudArgs.isVictoryActive = isVictoryActive;
  _readabilityHudArgs.isMenuOpen = isInGameMenuOpen() || isMainMenuActive() || isOvertimeMenuOpen();
  _readabilityHudArgs.match = match;
  _readabilityHudArgs.practiceStats = practiceStats;
  _readabilityHudArgs.athletes = athletes;
  _readabilityHudArgs.balls = balls;
  _readabilityHudArgs.viewportLayout = viewportManager.lastViewportLayout;
  _readabilityHudArgs.isSplitscreen = viewportManager.lastIsSplitscreen;
  _readabilityHudArgs.tick = loop.tick;
  updateMatchReadabilityHud(_readabilityHudArgs);
  updatePracticeHud({ gameState, isMenuOpen: _readabilityHudArgs.isMenuOpen });
  updateReplayDock({ isMenuOpen: _readabilityHudArgs.isMenuOpen });

  _hudArgs.match = match;
  _hudArgs.athletes = athletes;
  _hudArgs.ball = ball;
  _hudArgs.balls = balls;
  _hudArgs.loop = loop;
  _hudArgs.cameraRig = cameraRig;
  updateHud(_hudArgs);
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

  scene.add(characterRoot);
  console.log(
    `[character] loaded ${CHARACTER_URL}: ${characterSkeleton.bones.length} joints, ` +
      `${gltf.animations.length} clips present and untouched in this task`,
  );

  logClipInventory(characterClips);
}

function spawnMatchAthletesAndCameras(configs, targetGoal = 'N', randomFn = Math.random, presetSpawns = null) {
  if (athletes.length < 2) return null;
  const count = Math.min(athletes.length, Math.max(2, configs?.length || 2));
  const spawns = (Array.isArray(presetSpawns) && presetSpawns.length >= count)
    ? presetSpawns
    : computeStreamHeadSpawns({ configs: configs || TUNING.players, athleteCount: count, targetGoal, randomFn });
  lastMatchSpawns = spawns;
  for (let i = 0; i < count; i++) {
    athletes[i].teleportTo(spawns[i].pos, spawns[i].facingYaw);
    if (playerCameras[i]) {
      playerCameras[i].azimuth = spawns[i].cameraAzimuth;
      playerCameras[i].manualAzimuthOffset = 0;
      playerCameras[i].manualPitchOffset = 0;
      playerCameras[i].manualIdleTimer = 0;
      playerCameras[i].resetSmoothing();
    }
  }
  return spawns;
}

/**
 * Applies a tied-match overtime decision from the Overtime Agreement Menu or a URL fixture.
 * @param {{ format: 'draw' | 'golden_goal' | 'timed', durationSeconds?: number, positionMode?: 'in_place' | 'respawn' }} agreement
 */
function applyOvertimeAgreement({ format, durationSeconds = 120, positionMode = 'in_place', dropPos: presetDrop = null, spawns: presetSpawns = null } = {}) {
  hideOvertimeMenu();
  if (format === 'draw') {
    gameState = 'match';
    if (matchState) matchState._agreedDraw = true;
    finishMatchAndReport(loop.tick);
    return;
  }

  matchManager.startOvertime({ format, durationSeconds, positionMode });
  matchState = matchManager.getState();
  gameState = 'match';
  victoryCameraActive = false;

  let dropPos = null;
  let otSpawns = null;
  if (positionMode === 'respawn') {
    clearGameplayInputQueues();
    otSpawns = spawnMatchAthletesAndCameras(lastMatchConfigs || TUNING.players, matchState.targetGoal, fixtureRandom || currentMatchRandom || Math.random, presetSpawns);
    if (balls.length > 0) {
      dropPos = presetDrop || getCourtBallDropSpawn(0, 1, loop.tick, activeFixture !== null || replayManager.isRecording() || replayManager.isPlayingBack());
      resetBall(balls[0], loop.tick, dropPos);
      balls[0]._preMatchSpawnPos = { x: dropPos.x, y: dropPos.y, z: dropPos.z };
      matchState.preMatchSpawnPos = balls[0]._preMatchSpawnPos;
    }
    resetCountdownOverlay();
    cinematicCamera.startKickoffRitual(TUNING.match.countdownSeconds || 4.0);
  } else {
    matchState.isCountingDown = false;
    matchState.countdownTicksRemaining = 0;
  }
  replayManager.recordOvertime({ format, durationSeconds, positionMode, dropPos, spawns: otSpawns });

  if (scoreboards) {
    updateScoreboards(scoreboards, matchProbe(matchState));
  }
  applyViewportSize();
  updateCameras();
  console.log(`[overtime] started (${format}, ${positionMode})`);
}

function handleRematch() {
  if (!matchState) return;
  clearGameplayInputQueues();
  hideOvertimeMenu();

  matchManager.rematch(lastMatchConfigs || TUNING.players);
  matchState = matchManager.getState();
  gameState = 'match';

  // Reset athlete strike/action/tracker stats, particles, celebrations, and extended match stats
  athleteManager.resetStats();
  turfParticles.reset();
  goalCelebration.reset();
  athleteMatchStats.forEach((s, idx) => resetPlayerMatchStats(s, idx));

  // Spawn athletes on the stream heads opposite their target goals
  restorePracticeHudOverrides();
  hidePracticeHud();
  cinematicCamera.stopFreeFly();
  resetReplayDockState();
  replayManager.stopPlayback();
  currentMatchSeed = generateMatchSeed();
  currentMatchRandom = createMatchRandom(currentMatchSeed);
  spawnMatchAthletesAndCameras(lastMatchConfigs || TUNING.players, matchState.targetGoal, currentMatchRandom);

  // Ensure match ball is refreshed (respecting random or specific selection)
  setActiveMatchBall(currentMatchBallType, currentMatchRandom);
  if (balls.length > 0) {
    const dropPos = getCourtBallDropSpawn(0, 1, loop.tick, true);
    resetBall(balls[0], loop.tick, dropPos);
    balls[0]._preMatchSpawnPos = { x: dropPos.x, y: dropPos.y, z: dropPos.z };
    if (matchState) matchState.preMatchSpawnPos = balls[0]._preMatchSpawnPos;
  }
  replayManager.beginMatchRecording({
    seed: currentMatchSeed, configs: lastMatchConfigs || TUNING.players, athletes, playerCount: athletes.length,
    ball: balls[0]?.id || currentMatchBallType, durationSeconds: TUNING.match.durationSeconds || 300,
    arena: activeArenaType(), initialDrop: balls[0]?._preMatchSpawnPos, initialSpawns: lastMatchSpawns,
  });

  if (scoreboards) {
    updateScoreboards(scoreboards, matchProbe(matchState));
  }
  resetCountdownOverlay();
  hideVictoryScreen();
  hideInGameMenu();
  victoryCameraActive = false;
  cinematicCamera.startKickoffRitual(TUNING.match.countdownSeconds || 4.0);
  applyViewportSize();
  updateCameras();
  console.log('[match] rematch started with kickoff ritual!');
}

function skipFlyover() {
  if (gameState !== 'flyover') return;
  clearGameplayInputQueues();
  gameState = 'match';
  fixtureFlyoverEndTick = -1;
  hideFlyoverOverlay();
  if (lastMatchSpawns) spawnMatchAthletesAndCameras(lastMatchConfigs || TUNING.players, matchState?.targetGoal || 'N', currentMatchRandom || Math.random, lastMatchSpawns);
  if (balls.length > 0 && balls[0]._preMatchSpawnPos) resetBall(balls[0], loop.tick, balls[0]._preMatchSpawnPos);

  matchManager.skipFlyover();
  matchState = matchManager.getState();
  resetCountdownOverlay();
  victoryCameraActive = false;

  // Standoff kickoff ritual framing athletes taking positions
  cinematicCamera.startKickoffRitual(TUNING.match.countdownSeconds || 4.0);

  for (const pc of playerCameras) pc.resetSmoothing();
  applyViewportSize();
  updateCameras();
  console.log('[flyover] skipped -> kickoff ritual started');
}

/**
 * Starts the match a ?fixture= names, straight past the menus. A human side
 * with a named device gets it mapped; an 'auto' side keeps the router's
 * default routing. The fixture's assist rule goes on ALL active athletes after
 * setup, so no side can carry a different one.
 */
function startFixtureMatch(fixture) {
  activeFixture = fixture;
  fixtureRandom = createFixtureRandom(fixture.seed);
  window.__vb.fixture = fixture;

  const { configs, rules, devices } = fixtureMatchSetup(fixture, fixtureRandom);
  if (devices) {
    setExplicitDeviceMappings(devices.mappings);
    for (const slot of devices.autoSlots) assignDefaultDeviceForSlot(slot);
  }
  handleStartMatch(configs, { ...rules, fixture });
  for (const a of athletes) a.setAssistPreset?.(fixture.assist);

  console.log(
    `[fixture] ${fixture.id} (seed ${fixture.seed}, ${fixture.mode || '1v1'}): ${fixture.home.name} [${fixture.home.controller}] vs ` +
      `${fixture.away.name} [${fixture.away.controller}], ${rules.ball} ball, ${fixture.durationSeconds}s, ${fixture.assist}`,
  );
  if (!fixture.flyover) skipFlyover();
}

/**
 * Files the one result a finished match reports: on window.__vb.lastMatchResult,
 * as a `vb:matchover` window event, and in the console. Lobby matches report
 * too (fixtureId null), so a tournament played from the lobby still leaves a
 * record. Clears the fixture, so a rematch is never filed under it.
 * @param {number} tick the tick the match ended on
 * @param {object[]} slotStats strike and match stats, by athlete slot
 * @param {object} [statsReport] optional aggregate stats report
 */
function reportMatchResult(tick, slotStats, statsReport = null) {
  const sideKeys = ['home', 'away', 'home2', 'away2'];
  const slotCount = (lastMatchConfigs && lastMatchConfigs.length >= 4) ? 4 : 2;
  const sides = { home: null, away: null };
  for (let i = 0; i < slotCount; i++) {
    const config = lastMatchConfigs?.[i];
    const key = i < 2 ? (config?.team || sideKeys[i]) : sideKeys[i];
    const fixtureSide = activeFixture ? activeFixture[key] : null;
    sides[key] = resultSide(config, slotStats[i], fixtureSide?.device ?? null);
  }
  const result = buildMatchResult({
    fixture: activeFixture,
    matchState,
    sides,
    ball: balls[0]?.id ?? currentMatchBallType,
    durationSeconds: TUNING.match.durationSeconds,
    endedTick: tick,
  });
  if (statsReport) result.statsReport = statsReport;
  activeFixture = null;
  fixtureRandom = null;

  window.__vb.lastMatchResult = result;
  console.log(`[match] result ${JSON.stringify(result)}`);
  window.dispatchEvent(new CustomEvent('vb:matchover', { detail: result }));
}

function handleStartMatch(configs, matchRulesOrBall = {}) {
  let ballPreference = getSelectedMatchBall();
  let durationSeconds = 300;
  let arenaType = activeArenaType();

  if (typeof matchRulesOrBall === 'string') ballPreference = matchRulesOrBall;
  else if (matchRulesOrBall && typeof matchRulesOrBall === 'object') {
    if (matchRulesOrBall.ball) ballPreference = matchRulesOrBall.ball;
    if (matchRulesOrBall.duration) durationSeconds = matchRulesOrBall.duration;
    if (matchRulesOrBall.arena) arenaType = matchRulesOrBall.arena;
  }
  if (ballPreference === 'all') ballPreference = 'random';

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

  hideMainMenu(); if (victoryScreenTimer) { clearTimeout(victoryScreenTimer); victoryScreenTimer = null; }
  TUNING.match.mode = 'match';
  setupBallPreview.hide(allBalls);
  hideOvertimeMenu();
  restorePracticeHudOverrides();
  hidePracticeHud();
  cinematicCamera.stopFreeFly(); clearGameplayInputQueues();
  if (!matchRulesOrBall?.isReplay) { lastMatchConfigs = configs; resetReplayDockState(); }
  // Only startFixtureMatch passes its fixture. Any other start (the lobby, a
  // fixture abandoned to the menu and replayed) is not that fixture's match.
  if (!matchRulesOrBall?.fixture) {
    activeFixture = null;
    fixtureRandom = null;
  }
  if (!matchRulesOrBall?.isReplay) replayManager.stopPlayback();
  currentMatchSeed = generateMatchSeed(matchRulesOrBall?.seed ?? activeFixture?.seed);
  currentMatchRandom = fixtureRandom || createMatchRandom(currentMatchSeed);

  athleteMatchStats.forEach((s, idx) => resetPlayerMatchStats(s, idx));

  // 0. AI BOT & SPLITSCREEN TOPOLOGY SETUP (resolved BEFORE setting camera modes)
  const matchCount = (configs && configs.length >= 4) ? 4 : 2;
  syncExplicitMappingsWithConfigs(configs, matchCount);
  ensureAthletesRegistered(matchCount, configs);
  botControllers = [];
  activeBotSlots = [];
  if (athletes.length > 0 && configs && configs.length > 0) {
    let humanCount = 0;
    for (let i = 0; i < athletes.length; i++) {
      const pConfig = configs[i];
      if (pConfig && pConfig.type === 'ai') {
        const bot = createBotController({
          difficulty: pConfig.difficulty || 'medium',
          slotIndex: i,
          aggressiveness: pConfig.aggressiveness ?? 0.60,
          seed: activeFixture ? fixtureBotSeed(activeFixture, i) : ((currentMatchSeed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0),
        });
        botControllers.push(bot);
        activeBotSlots.push(i);
        console.log(`[ai] P${i + 1} bot created — difficulty: ${pConfig.difficulty}, aggressiveness: ${(pConfig.aggressiveness ?? 0.60).toFixed(2)}`);
      } else {
        humanCount++;
      }
    }

    // Decided fresh every match: fullscreen for <= 1 human or replay, splitscreen for 2+ live humans.
    TUNING.camera.splitscreen = (!matchRulesOrBall?.isReplay && humanCount >= 2) || !!TUNING.camera.forceQuadSplitscreen;
  }

  // Honor shared fullscreen Broadcast / Sports if chosen by any human player in multiplayer
  const humanRequestedBroadcast = athletes.some(
    (_, i) => !activeBotSlots.includes(i) && (configs?.[i]?.cameraMode === 'broadcast' || configs?.[i]?.cameraMode === 'sports'),
  );
  const sharedStartMode = (TUNING.camera.splitscreen && humanRequestedBroadcast)
    ? (configs?.find((c, i) => !activeBotSlots.includes(i) && (c?.cameraMode === 'broadcast' || c?.cameraMode === 'sports'))?.cameraMode || 'broadcast')
    : null;

  // 1. Apply configurations across all active athletes (2 in 1v1, 4 in 2v2)
  for (let i = 0; i < athletes.length; i++) {
    const cfg = configs?.[i];
    const ath = athletes[i];
    if (!cfg || !ath) continue;
    ath.setTeamAndVariant(cfg.team, cfg.variant, { primaryColor: cfg.primaryColor });
    if (cfg.headwear !== undefined && ath.headwear !== cfg.headwear) ath.setHeadwear(cfg.headwear);
    const camMode = sharedStartMode || cfg.cameraMode || 'chase';
    playerCameras[i]?.setMode(camMode, false);
    const tp = TUNING.players[i];
    if (tp) {
      tp.team = cfg.team;
      tp.variant = cfg.variant;
      tp.primaryColor = cfg.primaryColor;
      tp.headwear = cfg.headwear;
    }
    syncPlayerCameraMode(i, playerCameras[i]?.mode || camMode);
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
      TUNING.teams.home.name = configs?.[homeIdx]?.displayName || `${getColorName(homeColor)} (Home)`;
    }
    if (TUNING.teams.away) {
      TUNING.teams.away.primaryColor = awayColor;
      TUNING.teams.away.name = configs?.[awayIdx]?.displayName || `${getColorName(awayColor)} (Away)`;
    }
  }
  if (scoreboards) {
    updateScoreboards(scoreboards, matchState);
  }

  // 3. Select and configure match ball & duration
  currentMatchBallType = ballPreference;
  setActiveMatchBall(currentMatchBallType, currentMatchRandom);

  matchManager.startMatch(configs, { durationSeconds, ballPreference, arenaType });
  matchState = matchManager.getState();

  // Clear strike stats and visual turf particles
  athleteManager.resetStats();
  turfParticles.reset();
  goalCelebration.reset();

  // Position athletes on stream heads opposite their target goals
  spawnMatchAthletesAndCameras(configs, matchState.targetGoal, currentMatchRandom, matchRulesOrBall?.initialSpawns || null);

  // Fresh match ball at 10m
  if (balls.length > 0) {
    const dropPos = matchRulesOrBall?.initialDrop || getCourtBallDropSpawn(0, 1, loop.tick, true);
    resetBall(balls[0], loop.tick, dropPos);
    balls[0]._preMatchSpawnPos = { x: dropPos.x, y: dropPos.y, z: dropPos.z };
    if (matchState) matchState.preMatchSpawnPos = balls[0]._preMatchSpawnPos;
  }
  if (!matchRulesOrBall?.isReplay) {
    replayManager.beginMatchRecording({
      seed: currentMatchSeed, configs, athletes, playerCount: matchCount,
      ball: balls[0]?.id || currentMatchBallType, durationSeconds, arena: arenaType,
      initialDrop: balls[0]?._preMatchSpawnPos, initialSpawns: lastMatchSpawns, fixtureId: activeFixture?.id || null,
    });
  }

  // Start the flyover cutscene
  gameState = 'flyover';
  cinematicCamera.startFlyover(TUNING.match.flyoverSeconds);
  fixtureFlyoverEndTick = activeFixture
    ? loop.tick + Math.round(TUNING.match.flyoverSeconds * TUNING.loop.fixedHz)
    : -1;
  flyoverPads.reset();
  const p1Color = configs?.[0]?.primaryColor ?? 0xd90429;
  const p2Color = configs?.[1]?.primaryColor ?? 0x1d4ed8;
  const p1TeamName = (configs?.[0]?.displayName || getColorName(p1Color)).toUpperCase();
  const p2TeamName = (configs?.[1]?.displayName || getColorName(p2Color)).toUpperCase();
  const p1Hex = '#' + p1Color.toString(16).padStart(6, '0');
  const p2Hex = '#' + p2Color.toString(16).padStart(6, '0');
  showFlyoverOverlay(p1TeamName, p2TeamName, p1Hex, p2Hex, {
    is2v2: matchCount >= 4,
    team1Roster: matchCount >= 4 ? 'TEAM 1 (P1 & P3)' : 'TEAM 1 (P1)',
    team2Roster: matchCount >= 4 ? 'TEAM 2 (P2 & P4)' : 'TEAM 2 (P2)',
  });
  applyViewportSize();
  console.log('[match] starting 10s flyover cutscene...');
}

/** Who practises after a match: the human's own player (P2 when they played Team 2 vs AI). */
function practicePlayerConfig() {
  const configs = getPlayerConfigs();
  return configs.find((c) => c && c.type === 'human') || configs[0];
}

function handleStartPractice(playerConfig = null, ballChoice = 'all', drillMode = getSelectedPracticeDrill()) {
  hideMainMenu(); setupBallPreview.hide(allBalls); hideInGameMenu(); hideVictoryScreen(); hideOvertimeMenu();
  replayManager.cancelRecording(); replayManager.stopPlayback(); resetReplayDockState();
  cinematicCamera.stopFreeFly(); clearGameplayInputQueues();
  turfParticles.reset(); goalCelebration.reset(); victoryCameraActive = false;
  gameState = 'practice';
  setSelectedPracticeBallType(ballChoice);
  const padCount = typeof navigator?.getGamepads === 'function' ? Array.from(navigator.getGamepads()).filter((p) => p?.connected).length : 0;
  const roster = configurePracticeRoster({
    playerConfig, drillMode, athleteManager, athletes, playerCameras, arenaPreset, createBotController, syncPlayerCameraMode, connectedPadCount: padCount,
    onApplyPlayerTuning: (cfg, split) => {
      TUNING.camera.splitscreen = split;
      if (!cfg) return;
      if (TUNING.players[0]) Object.assign(TUNING.players[0], { team: cfg.team, variant: cfg.variant, primaryColor: cfg.primaryColor, headwear: cfg.headwear });
      const c = cfg.primaryColor ?? 0xd90429;
      if (TUNING.athlete?.palette) TUNING.athlete.palette.homePrimary = c;
      if (TUNING.teams?.home) TUNING.teams.home.primaryColor = c;
    },
  });
  botControllers = roster.botControllers;
  activeBotSlots = roster.activeBotSlots;
  resetPracticeStats(athletes[0]);
  applyPracticeHudOverrides(drillMode);
  matchManager.startPractice(playerConfig, ballChoice);
  matchState = matchManager.getState();
  setActiveMatchBall(ballChoice, Math.random, true);
  const isDeterministic = armedCaptureTick !== null;
  for (let i = 0; i < balls.length; i++) resetBall(balls[i], loop.tick, getCourtBallDropSpawn(i, balls.length, loop.tick, isDeterministic));
  applyViewportSize();
  console.log(`[practice] "${drillMode}" started with ball choice "${ballChoice}"`);
}

function handleFinishPractice() {
  hideInGameMenu(); hidePracticeHud(); restorePracticeHudOverrides();
  syncPracticeStrikeStats(athletes[0]);
  showPracticeSummary(practiceStats, getPracticeSessionSeconds(), {
    onPracticeAgain: () => handleStartPractice(practicePlayerConfig(), getSelectedPracticeBallType(), getSelectedPracticeDrill()),
    onCustomize: () => { hideVictoryScreen(); gameState = 'menu'; showPlayerSetup('practice'); applyViewportSize(); },
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
  loop.paused = false;
  replayManager.cancelRecording();
  replayManager.stopPlayback();
  exitGamePointerLock();
  if (victoryScreenTimer) { clearTimeout(victoryScreenTimer); victoryScreenTimer = null; }
  hideInGameMenu(); hideVictoryScreen(); hideOvertimeMenu();
  resetCountdownOverlay(); hideFlyoverOverlay();

  // Clear AI bots
  botControllers = [];
  activeBotSlots = [];

  gameState = 'menu';
  TUNING.match.mode = 'match';

  // 1. Reset match state completely
  matchManager.resetForTitle();
  matchState = matchManager.getState();
  matchState.mode = 'menu';

  // 2. Reset practice drill stats & replay/camera states
  restorePracticeHudOverrides(); hidePracticeHud();
  cinematicCamera.stopFreeFly(); resetReplayDockState();
  resetPracticeStats();
  athleteMatchStats.forEach((s, idx) => resetPlayerMatchStats(s, idx));

  // 3. Reset athletes, physics velocities, trackers and knockdowns
  athleteManager.resetStats();
  for (let i = 0; i < athletes.length; i++) {
    const a = athletes[i];
    if (!a) continue;
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

  // 4. Stage active title athletes on stream heads and disable extra 2v2 slots
  athleteManager.stageForTitle();
  if (athletes.length >= 2) {
    athletes[0].teleportTo(TUNING.match.streamHeads.sw, Math.PI);
    athletes[1].teleportTo(TUNING.match.streamHeads.ne, 0);
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

function handleEnterSetup(mode = 'match') {
  for (const b of allBalls) {
    if (b?.mesh) b.mesh.visible = false;
    if (b?.body) { b.body.setTranslation({ x: 0, y: -200, z: 0 }, true); b.body.setLinvel({ x: 0, y: 0, z: 0 }, true); b.body.setEnabled(false); }
  }
  const setupCfgs = getPlayerConfigs();
  const count = mode === 'match2v2' ? 4 : 2;
  ensureAthletesRegistered(count, setupCfgs);
  athleteManager.stageForLobby(mode);
  for (let i = 0; i < count; i++) { if (setupCfgs[i]) handlePlayerConfigChange(i, setupCfgs[i]); }
  cinematicCamera.startSetupPreview();
  console.log(`[mainMenu] entered setup (${mode}) -> 3D athlete staging active`);
}

function handleExitSetup() {
  setupBallPreview.hide(allBalls);
  athleteManager.stageForTitle();
  launchMenuBalls();
  cinematicCamera.startTitleOrbit();
  console.log('[mainMenu] exited setup -> ambient title orbit');
}

function handlePlayerConfigChange(idx, config) {
  if (athletes[idx]) {
    athletes[idx].setTeamAndVariant(config.team, config.variant, { primaryColor: config.primaryColor });
    if (config.headwear !== undefined && athletes[idx].headwear !== config.headwear) athletes[idx].setHeadwear(config.headwear);
    if (TUNING.players[idx]) {
      TUNING.players[idx].team = config.team;
      TUNING.players[idx].variant = config.variant;
      TUNING.players[idx].primaryColor = config.primaryColor;
      TUNING.players[idx].headwear = config.headwear;
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
  const [arena] = await Promise.all([createArena(scene), loadDisplayFont()]); // boards bake text into canvases

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
  athletes[0].teleportTo(p1Head, Math.PI);
  athletes[1].teleportTo(p2Head, 0);
  playerCameras[0].mode = p1Cfg.cameraMode || 'chase';
  playerCameras[1].mode = p2Cfg.cameraMode || 'chase';
  playerCameras[0].azimuth = 0;
  playerCameras[1].azimuth = Math.PI;
  playerCameras[0].resetSmoothing();
  playerCameras[1].resetSmoothing();
  TUNING.camera.mode = playerCameras[0].mode;

  for (const a of athletes) {
    loop.register(a.motor.interpolated);
  }

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
  initControlsOverlay();
  initMatchReadabilityHud();
  const _playerCameraList = playerCameras.map((pc) => pc.camera);
  loop.onFrame(() => {
    const isGameplayActive = (gameState === 'match' || gameState === 'practice')
      && !isInGameMenuOpen()
      && !isMainMenuActive()
      && !isVictoryScreenVisible()
      && !isOvertimeMenuOpen();
    sampleAllInputs(_playerCameraList, gameState === 'practice' ? 1 : athletes.length, gameState === 'practice' ? 'practice' : 'match', activeBotSlots, isGameplayActive);
    updateControlsOverlay(getControlsSnapshot(), gameState, isInGameMenuOpen(), isVictoryScreenVisible(), !!matchState?.matchOver, !!matchState?.isCountingDown, isMainMenuActive());
  });

  applyViewportSize();
  applyCameraTuning();

  baselineCounts = worldCounts();
  console.log(
    `[ragdoll] baseline ${baselineCounts.bodies} bodies / ${baselineCounts.colliders} colliders / ` +
      `${baselineCounts.joints} joints`,
  );

  initCountdownOverlay();
  initOvertimeMenu({
    onConfirm: applyOvertimeAgreement,
  });

  initVictoryScreen({
    onRematch: handleRematch,
    onWatchReplay: () => window.__vb.playReplay(),
    onPracticeMode: () => handleStartPractice(practicePlayerConfig(), getSelectedPracticeBallType()),
    onMainMenu: returnToMainMenu,
  });

  initInGameMenu({
    onResume: () => {},
    onOpen: hideControlsOverlay,
    onRematch: handleRematch,
    onPracticeMode: () => handleStartPractice(practicePlayerConfig(), getSelectedPracticeBallType()),
    onFinishPractice: handleFinishPractice,
    onMainMenu: returnToMainMenu,
    onRenderSettingsChange: (settings) => {
      applyRenderSettings(settings);
    },
    onCameraChange: (playerIdx, mode) => {
      if (playerCameras[playerIdx]) {
        playerCameras[playerIdx].setMode(mode, false);
        syncPlayerCameraMode(playerIdx, mode);
        if ((mode === 'broadcast' || mode === 'sports') && TUNING.camera.splitscreen) {
          for (const s of getActiveHumanSlots()) {
            if (s === playerIdx) continue;
            playerCameras[s]?.setMode(mode, false);
            syncPlayerCameraMode(s, mode);
          }
        } else if (mode !== 'broadcast' && mode !== 'sports') {
          leaveSharedCameraForOtherSlot(playerIdx);
        }
        // Re-run the splitscreen camera rules now, e.g. entering or leaving a shared Broadcast view.
        applyViewportSize();
      }
    },
    getCameraRows: () => {
      return [0, 1, 2, 3].map((i) => {
        const present = gameState === 'practice' ? i === 0 : (i < athletes.length && !!athletes[i]?.isEnabled);
        const cfg = TUNING.players[i] || {};
        const teamNum = (i === 0 || i === 2) ? 1 : 2;
        const side = gameState === 'practice' ? '' : ` · TEAM ${teamNum} (${cfg.team === 'away' ? 'AWAY' : 'HOME'})`;
        return {
          // AI players have no camera anyone sees
          visible: present && !activeBotSlots.includes(i),
          label: `P${i + 1} · ${getColorName(cfg.primaryColor).toUpperCase()}${side}`,
          hint: getCameraCycleHint(i),
          mode: playerCameras[i]?.mode || 'chase',
          // Broadcast is available anytime as a shared fullscreen view
          allowBroadcast: true,
        };
      });
    },
    initialRenderSettings: {
      pixelRatioPreset: TUNING.render?.pixelRatioPreset || '1.25',
      shadowQuality: TUNING.render?.shadowQuality || 'balanced',
    },
  });

  applyShadowSettings();

  installHotkeys({
    getAthletes: () => athletes,
    getGameState: () => gameState,
    getGui: () => guiInstance,
    headwearControls,
    isReplayPlaying: () => replayManager.isPlayingBack(),
    onRequestRespawn: requestRagdollSpawn,
    onHudToggle: setHudVisible,
    onSplitscreenToggle: applyViewportSize,
    onSkipFlyover: skipFlyover,
    onToggleInGameMenu: toggleInGameMenu,
    onShowHeadwearToast: showHeadwearToast,
  });

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
  window.__soundManager = soundManager;
  window.TUNING = TUNING;
  window.THREE = THREE;
  Object.defineProperty(window.__vb, 'balls', { get: () => balls, configurable: true });
  Object.defineProperty(window.__vb, 'practiceSessionSeconds', { get: () => getPracticeSessionSeconds(), configurable: true });
  Object.assign(window.__vb, {
    matchState, sound: soundManager, tuning: TUNING, THREE, scene, camera, playerCameras, cameraRig,
    renderer, loop, athletes, rematch: handleRematch, toggleInGameMenu, hideInGameMenu, isInGameMenuOpen,
    overtimeMenu: { show: showOvertimeMenu, hide: hideOvertimeMenu, isOpen: isOvertimeMenuOpen, applyAgreement: applyOvertimeAgreement },
    getInputSlot, applyRenderSettings, getHudPrefs, setHudPrefs,
    setCleanBroadcast: () => { setCleanBroadcastHud(); applyRenderSettings({ showControlsOverlay: false }); },
    showMainMenu: showTitleScreen, showPlayerSetup, startMatch: handleStartMatch, skipFlyover, returnToMainMenu,
    setActiveMatchBall, allBalls, getGameState: () => gameState, cinematicCamera, getPlayerConfigs,
    athleteMatchStats, showVictoryScreen, showPracticeSummary, hustleBoards, updateHustleBoards,
    displayCoordinator, practiceStats, finishPractice: handleFinishPractice, startPractice: handleStartPractice,
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

  window.__vb.setForceQuadSplitscreen = (enabled) => {
    TUNING.camera.splitscreen = true;
    TUNING.camera.forceQuadSplitscreen = !!enabled;
    applyViewportSize();
    if (guiInstance) guiInstance.controllersRecursive().forEach((c) => c.updateDisplay());
  };

  window.__vb.snapshotRing = new WorldSnapshotRingBuffer(360);
  window.__vb.packInputFrame = packInputFrame; window.__vb.unpackInputFrame = unpackInputFrame;
  const syncPoseArgs = () => Object.assign(_posePlayArgs, { athletes, balls, matchState, goalCelebration, playerCameras });
  const replayCamCtx = () => ({ cinematicCamera, playerCameras, spectatorCamera, athletes, syncPlayerCameraMode, applyViewportSize });
  const selectReplayCamera = (preset) => replayManager.applyCameraPreset(preset, replayCamCtx());
  const selectReplayFollowSlot = (slotIdx) => replayManager.applyFollowSlot(slotIdx, replayCamCtx());
  const seekReplayToFrame = (targetFrame) => replayManager.seekToFrame(targetFrame, {
    ...syncPoseArgs(),
    resetMatchForSeek: (prep) => {
      hideVictoryScreen(); victoryCameraActive = false; gameState = 'match';
      matchManager.startMatch(prep.configs, { durationSeconds: prep.rules.duration, ballPreference: prep.rules.ball, arenaType: prep.rules.arena });
      matchState = matchManager.getState(); matchState.isCountingDown = false; matchState.countdownTicksRemaining = 0;
      athleteManager.resetStats(); turfParticles.reset(); goalCelebration.reset();
      athleteMatchStats.forEach((s, idx) => resetPlayerMatchStats(s, idx));
      spawnMatchAthletesAndCameras(prep.configs, matchState.targetGoal, createMatchRandom(prep.seed), prep.initialSpawns);
      if (balls.length > 0 && prep.initialDrop) resetBall(balls[0], 0, prep.initialDrop);
    },
    stepOneReplayTick: (f) => stepSimulationTick(loop.fixedDt, f),
  });
  const jumpReplayGoal = (dir) => replayManager.jumpToAdjacentGoal(dir, syncPoseArgs());
  const playReplayInput = async (input = replayManager.getLastReplay()) => {
    const prep = await replayManager.preparePlayback(input); resetReplayDockState();
    handleStartMatch(prep.configs, { ...prep.rules, seed: prep.seed, initialDrop: prep.initialDrop, initialSpawns: prep.initialSpawns });
    for (let i = 0; i < athletes.length; i++) athletes[i]?.setAssistPreset?.(prep.configs[i]?.assistPreset || 'standard');
    skipFlyover(); if (prep.isPose && matchState) { matchState.isCountingDown = false; matchState.countdownTicksRemaining = 0; seekReplayToFrame(0); }
    return prep.meta;
  };
  initReplayDock({
    onSeek: seekReplayToFrame, onJumpGoal: jumpReplayGoal, onSelectCamera: selectReplayCamera, onSelectFollowSlot: selectReplayFollowSlot,
    onLoadReplayFile: (bytes, filename) => playReplayInput({ bytes, filename }),
    onExitReplay: () => { replayManager.stopPlayback(); cinematicCamera.stopFreeFly(); resetReplayDockState(); returnToMainMenu(); },
    onCleanFootage: (hidden) => { if (hidden) applyRenderSettings({ showControlsOverlay: false }); },
    onFreeLookDelta: (dy, dp) => cinematicCamera.rotateFreeLook(dy, dp), onFreeFovDelta: (df) => cinematicCamera.adjustFreeFov(df),
    onAdjustHeight: (delta, reset = false) => (cinematicCamera.mode === 'free' ? (reset ? cinematicCamera.setFreeHeight(12) : cinematicCamera.nudgeFreeHeight(delta)) : (reset ? replayManager.setCameraHeightOffset(0, playerCameras) : replayManager.adjustCameraHeightOffset(delta, playerCameras))),
    getCameraHeight: () => (cinematicCamera.mode === 'free' ? cinematicCamera.getFreeHeight() : replayManager.getCameraHeightOffset()),
    isMenuOpen: () => isInGameMenuOpen() || isMainMenuActive() || isOvertimeMenuOpen(),
  });
  Object.assign(window.__vb, {
    replay: replayManager, newcomerDrill, seekReplay: seekReplayToFrame, jumpReplayGoal, selectReplayCamera, selectReplayFollowSlot,
    getLastReplay: () => replayManager.getLastReplay(), downloadLastReplay: () => replayManager.downloadLastReplay(), playReplay: playReplayInput,
    updateAthletePalette: () => { for (const a of athletes) if (a.ragdoll) a.refreshVisuals(); },
    updateAthleteVariant: () => { for (const a of athletes) if (a.ragdoll) a.refreshVisuals(); },
  });
  Object.defineProperty(window.__vb, 'ragdoll', { get: () => athletes[0]?.ragdoll || null, configurable: true });
  Object.defineProperty(window.__vb, 'motor', { get: () => athletes[0]?.motor || null, configurable: true });
  Object.defineProperty(window.__vb, 'animTarget', { get: () => athletes[0]?.animTarget || null, configurable: true });
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
    getAthletes: () => athletes,
    onResetMatch: () => matchManager.resetMatchState(matchState),
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
    tracker: athletes[0]?.tracker || null,
    headwearControls,
    onHeadwearChange: (playerIndex, headwearId) => {
      const a = athletes[playerIndex];
      if (!a) return;
      a.setHeadwear(headwearId);
      showHeadwearToast(getHeadwearLabel(headwearId));
    },
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
    onBallPreviewChange: (opts) => (opts?.visible ? setupBallPreview.setSelection(opts) : setupBallPreview.hide(allBalls)),
  });

  initMobileNotice();
  warmupSceneShaders({ renderer, scene, camera, turfParticles, goalCelebration, ballDropRings });

  // A ?fixture= match skips the menus entirely. A malformed one stops the boot
  // loudly: a broadcast or a tournament must never quietly fall back to the
  // title screen or to defaults.
  const fixtureRead = readFixtureFromSearch(window.location.search);
  if (fixtureRead.errors.length > 0) {
    window.__vb.fixtureError = fixtureRead.errors;
    throw new Error(`invalid fixture: ${fixtureRead.errors.join('; ')}`);
  }
  if (fixtureRead.fixture) {
    startFixtureMatch(fixtureRead.fixture);
    applyViewportSize();
    hideLoadingScreen();
    loop.start();
    return;
  }

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
