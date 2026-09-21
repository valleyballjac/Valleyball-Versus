import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { RAPIER, getWorld, ENVIRONMENT_RAY_GROUPS } from './physics.js';
import { createMotor, updateMotor, syncMotorSnapshot, horizontalSpeed } from './motor.js';
import {
  createAnimTarget,
  updateAnimTarget,
  resetAnimTarget,
  mountMatrix,
} from './animtarget.js';
import { createTracker, applyTracking, applyImpacts, queueKnockdown } from './tracker.js';
import {
  buildRagdoll,
  destroyRagdoll,
  detachMotorFromRagdoll,
  BONE_MAP,
} from './autorig.js';
import {
  createRagdollVisuals,
  disposeRagdollVisuals,
  saveRagdollPrevious,
  snapshotRagdoll,
  syncRagdollPose,
  applyRagdollVisibility,
  updateAthletePalette,
} from './ragdoll.js';
import { applyClampedLinearDamping } from './damping.js';
import { createWatchdogState, runWatchdog } from '../mechanics/watchdog.js';
import { createMountFollowerState, runMountFollower } from '../mechanics/mountFollower.js';
import { createActionState, runActions } from '../mechanics/actions.js';
import {
  createStrikeState,
  runStrikes,
  resolveStrikeContact,
  checkStrikeAssist,
  KIND_NAME,
} from '../mechanics/strikes.js';
import { soundManager } from '../audio/soundManager.js';

const _mount = new THREE.Matrix4();
const _limpVel = new THREE.Vector3();
const groupByKey = new Map(BONE_MAP.map((entry) => [entry.key, entry.group]));

function smoothstep01(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * Creates an encapsulated Athlete entity (motor, ragdoll, ghost, tracker, mechanics).
 *
 * @param {object} config
 * @param {string} config.id e.g. 'p1', 'p2'
 * @param {'home' | 'away'} config.team
 * @param {'masculine' | 'feminine' | 'classic'} config.variant
 * @param {{ x: number, y: number, z: number, yaw?: number }} config.spawn
 * @param {THREE.Scene} config.scene
 * @param {object} config.characterSkeleton
 * @param {THREE.Group} config.characterRoot
 * @param {object[]} config.clips
 */
export function createAthlete({
  id = 'p1',
  team = 'home',
  variant = 'masculine',
  primaryColor = null,
  colorOverride = null,
  spawn = { x: 0, y: 1.5, z: 0, yaw: 0 },
  scene,
  characterSkeleton,
  characterRoot,
  clips = [],
}) {
  const currentSpawn = { ...spawn };
  const athleteIndex = id === 'p2' || id === 1 ? 1 : 0;
  let initialYaw = spawn.yaw ?? 0;
  let currentTeam = team;
  let currentVariant = variant;
  let currentPrimaryColor = primaryColor;
  let currentColorOverride = colorOverride;

  // 1. Motor sphere
  const motor = createMotor();
  motor.body.setTranslation({ x: currentSpawn.x, y: currentSpawn.y, z: currentSpawn.z }, true);
  motor.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  motor.interpolated.reset(new THREE.Vector3(currentSpawn.x, currentSpawn.y, currentSpawn.z));
  detachMotorFromRagdoll(motor);
  scene.add(motor.mesh);
  motor.mesh.visible = !!TUNING.debug.showSphereWireframe;

  // 2. Mechanics state
  const watchdogState = createWatchdogState();
  const mountFollowerState = createMountFollowerState();
  const actionState = createActionState();
  const strikeState = createStrikeState();
  const tracker = createTracker();

  let groundedRun = 0;
  let wasGrounded = true;
  let lastFootstepSlot = -1;
  let lastResistanceScale = 1;
  let knockdownRequested = false;
  let respawnRequested = false;

  // 3. Ragdoll & Visuals
  const impactByHandle = new Map();
  const impactEvents = [];
  let ragdoll = null;
  let animTarget = null;

  const bindLocals = characterSkeleton
    ? characterSkeleton.bones.map((bone) => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
      }))
    : [];

  function restoreBindPose() {
    for (const entry of bindLocals) {
      entry.bone.position.copy(entry.position);
      entry.bone.quaternion.copy(entry.quaternion);
      entry.bone.scale.copy(entry.scale);
    }
    if (characterRoot) characterRoot.updateMatrixWorld(true);
  }

  function buildMountedRagdoll(targetYaw) {
    if (ragdoll) {
      destroyRagdoll(ragdoll);
      disposeRagdollVisuals(ragdoll.group);
      ragdoll = null;
    }

    restoreBindPose();
    mountMatrix(motor, targetYaw, _mount);
    const built = buildRagdoll(characterSkeleton, characterRoot, _mount, athleteIndex);

    built.group = createRagdollVisuals(built.rig, {
      team: currentTeam,
      variant: currentVariant,
      primaryColor: currentPrimaryColor,
      colorOverride: currentColorOverride,
    });
    built.characterRoot = characterRoot;
    built.team = currentTeam;
    built.variant = currentVariant;
    built.primaryColor = currentPrimaryColor;
    built.colorOverride = currentColorOverride;

    scene.add(built.group);
    ragdoll = built;
    applyRagdollVisibility(ragdoll, characterRoot);

    impactByHandle.clear();
    for (const [key, item] of ragdoll.rig) {
      item.collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      item.collider.setContactForceEventThreshold(1.0);
      impactByHandle.set(item.collider.handle, { key, group: groupByKey.get(key) });
    }

    animTarget = createAnimTarget(characterRoot, clips, ragdoll.rig);
    animTarget.yaw = targetYaw;
    animTarget.targetYaw = targetYaw;
    animTarget.momentumYaw = targetYaw;

    const initialGrounded = motor.grounded && motor.body.translation().y <= 1.5;
    if (!initialGrounded) {
      animTarget.airborneMix = 1.0;
      animTarget.jumpPhase = TUNING.jump.apexHold;
    } else {
      animTarget.airborneMix = 0.0;
      animTarget.jumpPhase = 0;
    }

    updateAnimTarget(
      animTarget, motor, ragdoll.rig, targetYaw, false, NaN, initialGrounded, 1 / TUNING.loop.fixedHz, null,
    );
    resetAnimTarget(animTarget);

  }

  buildMountedRagdoll(initialYaw);

  function driveAttenuation() {
    return tracker.weight * tracker.weight;
  }

  function knockdownDrag() {
    const resistanceScale =
      1 +
      TUNING.motor.downedDragBoost *
        smoothstep01((TUNING.impact.dragOnset - tracker.weight) / TUNING.impact.dragOnset);
    lastResistanceScale = resistanceScale;
    return resistanceScale;
  }

  function advanceGroundedDebounce() {
    groundedRun = motor.grounded ? groundedRun + 1 : 0;
    return groundedRun >= TUNING.jump.groundedDebounceTicks;
  }

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

  function buildGhostInputs(actions, strikes, inputSnapshot, facingFollowsCamera) {
    return {
      recoveryWeight: tracker.weight,
      steerInput: Math.hypot(inputSnapshot.moveWorld.x, inputSnapshot.moveWorld.z),
      slideMix: actions.slideMix,
      diveMix: actions.diveMix,
      slidePhase: actions.slidePhase,
      divePhase: actions.divePhase,
      strikeMix: strikes.strikeMix,
      strikePhase: strikes.strikePhase,
      strikeKind: strikes.strikeKind,
      strikeSide: strikes.strikeSide,
      facingFollowsCamera,
      hasAim: inputSnapshot.hasAim || false,
      aimYaw: inputSnapshot.aimYaw || 0,
      moveWorldX: inputSnapshot.moveWorld.x,
      moveWorldZ: inputSnapshot.moveWorld.z,
    };
  }

  function isTumbling(actions) {
    return (
      actions.diveStunned ||
      (ragdoll &&
        tracker.weight < TUNING.impact.mountRecoverBelow &&
        Math.hypot(
          ragdoll.rig.get('pelvis').body.linvel().x,
          ragdoll.rig.get('pelvis').body.linvel().z,
        ) > 2.0)
    );
  }

  const athlete = {
    id,
    get team() { return currentTeam; },
    set team(val) { currentTeam = val; },
    get variant() { return currentVariant; },
    set variant(val) { currentVariant = val; },
    get primaryColor() { return currentPrimaryColor; },
    set primaryColor(val) { currentPrimaryColor = val; },
    get colorOverride() { return currentColorOverride; },
    set colorOverride(val) { currentColorOverride = val; },
    motor,
    get ragdoll() { return ragdoll; },
    get animTarget() { return animTarget; },
    tracker,
    watchdogState,
    mountFollowerState,
    actionState,
    strikeState,
    impactByHandle,
    impactEvents,

    ownsCollider(handle) {
      if (motor.collider.handle === handle) return { isMotor: true, key: 'motor' };
      const rigHit = impactByHandle.get(handle);
      if (rigHit) return { isMotor: false, key: rigHit.key, group: rigHit.group };
      return null;
    },

    requestRespawn() {
      respawnRequested = true;
    },

    requestKnockdown() {
      knockdownRequested = true;
    },

    refreshVisuals() {
      if (ragdoll) {
        updateAthletePalette(ragdoll, {
          team: currentTeam,
          variant: currentVariant,
          primaryColor: currentPrimaryColor,
          colorOverride: currentColorOverride,
        });
      }
    },

    setTeamAndVariant(newTeam, newVariant, newColors = null) {
      if (newTeam) currentTeam = newTeam;
      if (newVariant) currentVariant = newVariant;
      if (newColors?.primaryColor !== undefined) currentPrimaryColor = newColors.primaryColor;
      if (newColors?.colorOverride !== undefined) currentColorOverride = newColors.colorOverride;
      athlete.refreshVisuals();
    },

    teleportTo(pos, yaw = 0) {
      currentSpawn.x = pos.x;
      currentSpawn.y = pos.y;
      currentSpawn.z = pos.z;
      currentSpawn.yaw = yaw;

      motor.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
      motor.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      motor.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      motor.interpolated.reset(new THREE.Vector3(pos.x, pos.y, pos.z));

      buildMountedRagdoll(yaw);
    },

    /**
     * Pre-physics mechanics update (steps 1 through 10).
     */
    prePhysicsUpdate({
      dt,
      tick,
      inputSnapshot,
      jumpQueued,
      diveQueued,
      volleyQueued,
      spikeQueued,
      balls,
      arenaPreset,
      facingFollowsCamera,
    }) {
      if (respawnRequested) {
        respawnRequested = false;
        buildMountedRagdoll(animTarget ? animTarget.yaw : (currentSpawn.yaw || 0));
      }

      // Out-of-bounds watchdog
      const motorY = motor.body.translation().y;
      const pelvis = ragdoll && ragdoll.rig.get('pelvis');
      const pelvisY = pelvis ? pelvis.body.translation().y : Infinity;
      if (motorY < arenaPreset.killPlaneY || pelvisY < arenaPreset.killPlaneY) {
        athlete.teleportTo(currentSpawn, currentSpawn.yaw || 0);
      }

      // Mount recovery
      const pelvisFloorY = runMountFollower({
        state: mountFollowerState,
        motor,
        ragdoll,
        animTarget,
        tracker,
        tick,
        dt,
      });

      // Knockdown
      if (knockdownRequested) {
        knockdownRequested = false;
        queueKnockdown(tracker);
      }

      // Actions & Strikes
      const actions = runActions({
        state: actionState,
        motor,
        input: inputSnapshot,
        tracker,
        ragdoll,
        ghost: animTarget,
        diveQueued,
        jumpQueued,
        tick,
        dt,
      });

      const strikes = runStrikes({
        state: strikeState,
        input: inputSnapshot,
        motor,
        ghost: animTarget,
        balls,
        tick,
        dt,
        volleyQueued,
        spikeQueued,
      });

      // Save ragdoll previous
      saveRagdollPrevious(ragdoll);

      // Motor update
      const driveScale = driveAttenuation();
      const resistanceScale = knockdownDrag();
      const stableGrounded = advanceGroundedDebounce();
      applyLimpBrake(dt);

      const jumpTickBefore = motor.lastJumpTick;
      updateMotor(
        motor,
        inputSnapshot,
        actions.allowJump,
        dt,
        actions.actionCommitted ? 0 : driveScale,
        tick,
        resistanceScale * actions.actionResistance,
      );

      // Audio cues
      const liftoff = motor.lastJumpTick !== jumpTickBefore;
      if (liftoff) {
        soundManager.playAthleteAction('jump', motor.body.translation());
      }
      if (motor.grounded && !wasGrounded) {
        const vy = motor.body.linvel().y;
        if (vy < -0.4) {
          soundManager.playAthleteAction('land', motor.body.translation());
        }
      }
      wasGrounded = motor.grounded;

      if (actions.actionCommitted && actionState.slideTime === 1) {
        soundManager.playAthleteAction('slide', motor.body.translation());
      }

      const motorVel = motor.body.linvel();
      const speedH = Math.hypot(motorVel.x, motorVel.z);
      if (motor.grounded && !liftoff && actionState.slideTime === 0 && animTarget && speedH > 1.2) {
        const currentSlot = animTarget.locomotionPhase < 0.5 ? 0 : 1;
        if (currentSlot !== lastFootstepSlot) {
          lastFootstepSlot = currentSlot;
          soundManager.playFootstep(motor.body.translation());
        }
      }

      // Ghost update
      const ghostInputs = animTarget
        ? buildGhostInputs(actions, strikes, inputSnapshot, facingFollowsCamera)
        : null;

      if (ragdoll) {
        updateAnimTarget(
          animTarget,
          motor,
          ragdoll.rig,
          inputSnapshot.cameraYaw,
          liftoff,
          pelvisFloorY,
          stableGrounded,
          dt,
          ghostInputs,
        );
      }

      // Tracking forces
      applyTracking(tracker, ragdoll && ragdoll.rig, animTarget, motor, dt, isTumbling(actions));

      return { actions, strikes };
    },

    /**
     * Post-physics mechanics & snapshots (steps 12 through 13).
     */
    postPhysicsUpdate(tick, dt, balls, allAthletes = [], athleteIndex = 0) {
      let assistEvent = null;
      if (ragdoll) {
        applyImpacts(tracker, impactEvents, tick, dt);
        impactEvents.length = 0;

        // Strikes strictly evaluate and target the ball (LAW 1 fidelity)
        const assisted = checkStrikeAssist(strikeState, ragdoll, balls, tick);
        if (assisted) {
          const kind = KIND_NAME[strikeState.lastStrikeKind] || 'volley';
          const r = (balls && balls[0]?.radius) || 0.5;
          soundManager.playStrike(
            kind,
            strikeState.lastContactQuality,
            strikeState.lastLaunchSpeed,
            motor.body.translation(),
            r,
          );
          assistEvent = {
            kind: strikeState.lastStrikeKind,
            quality: strikeState.lastContactQuality,
            launchSpeed: strikeState.lastLaunchSpeed,
          };
        }
      }

      syncMotorSnapshot(motor);
      snapshotRagdoll(ragdoll);
      return assistEvent;
    },

    isDiving(currentTick = Infinity) {
      return !!(
        actionState.divePending ||
        (animTarget && animTarget.diveMix > 0.05) ||
        (Number.isFinite(currentTick) && (currentTick - actionState.lastDiveTick) <= 50)
      );
    },

    getStrikeStats() {
      const attempts = strikeState.resolvedCount + strikeState.whiffCount;
      return {
        hits: strikeState.resolvedCount,
        whiffs: strikeState.whiffCount,
        attempts,
        accuracy: attempts > 0 ? Math.round((strikeState.resolvedCount / attempts) * 100) : 0,
      };
    },

    get team() {
      return currentTeam;
    },

    get variant() {
      return currentVariant;
    },

    get strikeState() {
      return strikeState;
    },

    get actionState() {
      return actionState;
    },

    renderPose(alpha) {
      syncRagdollPose(ragdoll, alpha);
    },

    dispose() {
      if (ragdoll) {
        destroyRagdoll(ragdoll);
        disposeRagdollVisuals(ragdoll.group);
      }
      if (motor.mesh) {
        motor.mesh.removeFromParent();
        if (motor.mesh.geometry) motor.mesh.geometry.dispose();
        if (motor.mesh.material) motor.mesh.material.dispose();
      }
      const world = getWorld();
      if (world && motor.body) {
        world.removeRigidBody(motor.body);
      }
    },
  };

  return athlete;
}
