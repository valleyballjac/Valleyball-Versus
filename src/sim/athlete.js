/**
 * MODULE HEADER — src/sim/athlete.js
 *
 * Role: Encapsulates a single Athlete entity (`createAthlete`) combining its
 *   locomotion sphere motor, 16-body ragdoll, kinematic ghost target, PD tracker,
 *   mount follower, defensive actions, and strike system.
 * Frame Phase: Fixed-step pre-physics (`prePhysicsUpdate`), post-physics
 *   (`postPhysicsUpdate`, `resolveAthletePairSeparation`), and render frame
 *   (`renderPose`, `refreshVisuals`).
 * Active Architectural Laws:
 *   - LAW L1 (Physics Owns Momentum): Locomotion and tracking apply forces/impulses
 *     only; no kinematic velocity overrides during active play.
 *   - LAW 4 (Zero Hot-Loop Allocations): Reuses per-athlete scratch structures
 *     (`_ghostInputs`, `_prePhysicsResult`, `_sepImpulse`) every tick.
 *   - LAW L6 (Determinism): Fixed-step updates run in deterministic athlete order.
 */

import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { RAPIER, getWorld } from './physics.js';
import { createMotor, updateMotor, syncMotorSnapshot } from './motor.js';
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
  setAthleteHeadwear,
} from './ragdoll.js';
import { applyClampedLinearDamping } from './damping.js';
import { createMountFollowerState, runMountFollower } from '../mechanics/mountFollower.js';
import { createActionState, runActions } from '../mechanics/actions.js';
import {
  createStrikeState,
  runStrikes,
  checkStrikeAssist,
  applyStrikeAssistPreset,
  KIND_NAME,
} from '../mechanics/strikes.js';
import { soundManager } from '../audio/soundManager.js';

const _mount = new THREE.Matrix4();
const _limpVel = new THREE.Vector3();
const _sepImpulse = { x: 0, y: 0, z: 0 };
const groupByKey = new Map(BONE_MAP.map((entry) => [entry.key, entry.group]));
const _skeletonBindCache = new WeakMap();

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
  athleteIndex: athleteIndexProp = null,
  team = 'home',
  variant = 'masculine',
  primaryColor = null,
  colorOverride = null,
  headwear = 'manager_cap',
  spawn = { x: 0, y: 1.5, z: 0, yaw: 0 },
  assistPreset = 'standard',
  scene,
  characterSkeleton,
  characterRoot,
  clips = [],
}) {
  const currentSpawn = { ...spawn };
  const athleteIndex = typeof athleteIndexProp === 'number'
    ? athleteIndexProp
    : (typeof id === 'number' ? id : (parseInt(String(id).replace('p', ''), 10) - 1 || 0));
  let initialYaw = spawn.yaw ?? 0;
  let currentTeam = team;
  let currentVariant = variant;
  let currentPrimaryColor = primaryColor;
  let currentColorOverride = colorOverride;
  let currentHeadwear = headwear ?? 'manager_cap';

  // 1. Motor sphere
  const motor = createMotor();
  motor.body.setTranslation({ x: currentSpawn.x, y: currentSpawn.y, z: currentSpawn.z }, true);
  motor.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  motor.interpolated.reset(new THREE.Vector3(currentSpawn.x, currentSpawn.y, currentSpawn.z));
  detachMotorFromRagdoll(motor);
  scene.add(motor.mesh);
  motor.mesh.visible = !!TUNING.debug.showSphereWireframe;

  // 2. Mechanics state
  const mountFollowerState = createMountFollowerState();
  const actionState = createActionState();
  const strikeState = createStrikeState();
  applyStrikeAssistPreset(strikeState, assistPreset);
  const tracker = createTracker();

  let groundedRun = 0;
  let wasGrounded = true;
  let lastFootstepSlot = -1;
  let lastResistanceScale = 1;
  let knockdownRequested = false;
  let respawnRequested = false;
  let offMountStuckTicks = 0;

  // 3. Ragdoll & Visuals
  const impactByHandle = new Map();
  const impactEvents = [];
  let ragdoll = null;
  let animTarget = null;

  if (characterSkeleton && !_skeletonBindCache.has(characterSkeleton)) {
    _skeletonBindCache.set(
      characterSkeleton,
      characterSkeleton.bones.map((bone) => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
      })),
    );
  }
  const bindLocals = characterSkeleton ? (_skeletonBindCache.get(characterSkeleton) || []) : [];

  function restoreBindPose() {
    for (const entry of bindLocals) {
      entry.bone.position.copy(entry.position);
      entry.bone.quaternion.copy(entry.quaternion);
      entry.bone.scale.copy(entry.scale);
      entry.bone.updateMatrix();
    }
    if (characterRoot) characterRoot.updateMatrixWorld(true);
  }

  function buildMountedRagdoll(targetYaw, idlePhase = 0) {
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
      headwear: currentHeadwear,
    });
    built.characterRoot = characterRoot;
    built.team = currentTeam;
    built.variant = currentVariant;
    built.primaryColor = currentPrimaryColor;
    built.colorOverride = currentColorOverride;
    built.headwear = currentHeadwear;

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
    if (idlePhase > 0 && animTarget.nodes?.idle?.action) {
      const idleDur = animTarget.nodes.idle.duration || 1;
      animTarget.nodes.idle.action.time = (((idlePhase % 1) + 1) % 1) * idleDur;
    }

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

  const _ghostInputs = {
    recoveryWeight: 1,
    steerInput: 0,
    slideMix: 0,
    diveMix: 0,
    braceMix: 0,
    slidePhase: 0,
    divePhase: 0,
    strikeMix: 0,
    strikePhase: 0,
    strikeKind: 0,
    strikeSide: 0,
    facingFollowsCamera: false,
    hasAim: false,
    aimYaw: 0,
    moveWorldX: 0,
    moveWorldZ: 0,
  };
  const _prePhysicsResult = { actions: null, strikes: null };

  function buildGhostInputs(actions, strikes, inputSnapshot, facingFollowsCamera) {
    _ghostInputs.recoveryWeight = tracker.weight;
    _ghostInputs.steerInput = Math.hypot(inputSnapshot.moveWorld.x, inputSnapshot.moveWorld.z);
    _ghostInputs.slideMix = actions.slideMix;
    _ghostInputs.diveMix = actions.diveMix;
    _ghostInputs.braceMix = actions.braceMix;
    _ghostInputs.slidePhase = actions.slidePhase;
    _ghostInputs.divePhase = actions.divePhase;
    _ghostInputs.strikeMix = strikes.strikeMix;
    _ghostInputs.strikePhase = strikes.strikePhase;
    _ghostInputs.strikeKind = strikes.strikeKind;
    _ghostInputs.strikeSide = strikes.strikeSide;
    _ghostInputs.facingFollowsCamera = facingFollowsCamera;
    _ghostInputs.hasAim = inputSnapshot.hasAim || false;
    _ghostInputs.aimYaw = inputSnapshot.aimYaw || 0;
    _ghostInputs.moveWorldX = inputSnapshot.moveWorld.x;
    _ghostInputs.moveWorldZ = inputSnapshot.moveWorld.z;
    return _ghostInputs;
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
    mountFollowerState,
    actionState,
    strikeState,
    get assistPreset() { return strikeState.assistPreset; },
    setAssistPreset(presetKey) {
      applyStrikeAssistPreset(strikeState, presetKey);
    },
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

    get headwear() {
      return currentHeadwear;
    },

    setHeadwear(headwearId) {
      currentHeadwear = headwearId;
      if (ragdoll) {
        setAthleteHeadwear(ragdoll, headwearId, {
          team: currentTeam,
          variant: currentVariant,
          primaryColor: currentPrimaryColor,
          colorOverride: currentColorOverride,
        });
      }
      return currentHeadwear;
    },

    setTeamAndVariant(newTeam, newVariant, newColors = null) {
      if (newTeam) currentTeam = newTeam;
      if (newVariant) currentVariant = newVariant;
      if (newColors?.primaryColor !== undefined) currentPrimaryColor = newColors.primaryColor;
      if (newColors?.colorOverride !== undefined) currentColorOverride = newColors.colorOverride;
      athlete.refreshVisuals();
    },

    teleportTo(pos, yaw = 0, idlePhase = 0) {
      currentSpawn.x = pos.x;
      currentSpawn.y = pos.y;
      currentSpawn.z = pos.z;
      currentSpawn.yaw = yaw;

      motor.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
      motor.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      motor.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      motor.interpolated.reset(new THREE.Vector3(pos.x, pos.y, pos.z));

      buildMountedRagdoll(yaw, idlePhase);
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
      cutQueued = false,
      volleyQueued,
      spikeQueued,
      balls,
      arenaPreset,
      facingFollowsCamera,
      targetGoalZ = null,
    }) {
      if (Number.isFinite(targetGoalZ)) {
        strikeState.targetGoalZ = targetGoalZ;
      }
      if (respawnRequested) {
        respawnRequested = false;
        buildMountedRagdoll(animTarget ? animTarget.yaw : (currentSpawn.yaw || 0));
      }

      // Out-of-bounds & unrecoverable off-mount watchdog
      const mPos = motor.body.translation();
      const motorY = mPos.y;
      const pelvis = ragdoll && ragdoll.rig.get('pelvis');
      const pPos = pelvis ? pelvis.body.translation() : null;
      const pelvisY = pPos ? pPos.y : Infinity;
      const motorFinite = Number.isFinite(mPos.x + mPos.y + mPos.z);
      const pelvisFinite = !pPos || Number.isFinite(pPos.x + pPos.y + pPos.z);
      if (!motorFinite || motorY < arenaPreset.killPlaneY || pelvisY < arenaPreset.killPlaneY) {
        offMountStuckTicks = 0;
        athlete.teleportTo(currentSpawn, currentSpawn.yaw || 0);
      } else if (pPos && (!pelvisFinite || pelvisY > 45)) {
        offMountStuckTicks = 0;
        buildMountedRagdoll(animTarget ? animTarget.yaw : (currentSpawn.yaw || 0));
      } else if (pPos && tracker.offMount > 0.85) {
        const pVel = pelvis.body.linvel();
        if (Math.abs(pVel.y) < 1.2) {
          offMountStuckTicks += 1;
          if (offMountStuckTicks > 100) {
            offMountStuckTicks = 0;
            buildMountedRagdoll(animTarget ? animTarget.yaw : (currentSpawn.yaw || 0));
          }
        }
      } else {
        offMountStuckTicks = 0;
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
        cutQueued,
        balls,
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

      if (actions.cutFired) {
        soundManager.playAthleteAction('cut', motor.body.translation());
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

      _prePhysicsResult.actions = actions;
      _prePhysicsResult.strikes = strikes;
      return _prePhysicsResult;
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

      // Soft ground-plane motor-to-motor anti-stacking across multi-athlete modes (2-4 players)
      if (athlete.isEnabled && motor?.body && allAthletes && allAthletes.length > 1) {
        const p1 = motor.body.translation();
        const v1 = motor.body.linvel();
        const sliding1 = actionState.slideTime > 0;
        for (let j = athleteIndex + 1; j < allAthletes.length; j++) {
          const other = allAthletes[j];
          if (!other || !other.isEnabled || !other.motor?.body) continue;
          const p2 = other.motor.body.translation();
          if (Math.abs(p2.y - p1.y) > 1.6) continue;
          const dx = p2.x - p1.x;
          const dz = p2.z - p1.z;
          const dist = Math.hypot(dx, dz);
          const minSep = (sliding1 || (other.actionState && other.actionState.slideTime > 0)) ? 0.55 : 0.90;
          if (dist >= minSep) continue;
          let nx, nz;
          if (dist > 1e-4) {
            nx = dx / dist;
            nz = dz / dist;
          } else {
            const angle = athleteIndex * 1.57079632679 + j * 0.78539816339;
            nx = Math.cos(angle);
            nz = Math.sin(angle);
          }
          const v2 = other.motor.body.linvel();
          const vRel = (v1.x - v2.x) * nx + (v1.z - v2.z) * nz;
          const imp = Math.min(2.2, (minSep - dist) * 32.0 * dt + Math.max(0, vRel) * 0.45);
          if (imp > 1e-4) {
            _sepImpulse.x = -nx * imp;
            _sepImpulse.z = -nz * imp;
            motor.body.applyImpulse(_sepImpulse, true);
            _sepImpulse.x = nx * imp;
            _sepImpulse.z = nz * imp;
            other.motor.body.applyImpulse(_sepImpulse, true);
          }
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

    renderPose(alpha) {
      syncRagdollPose(ragdoll, alpha);
    },

    setEnabled(enabled) {
      if (motor?.body) motor.body.setEnabled(enabled);
      if (ragdoll?.rig) {
        for (const item of ragdoll.rig.values()) item.body.setEnabled(enabled);
      }
      if (ragdoll?.group) ragdoll.group.visible = enabled;
      if (motor?.mesh) motor.mesh.visible = enabled && !!TUNING.debug.showSphereWireframe;
      this._enabled = !!enabled;
    },

    setHeadVisible(visible) {
      if (ragdoll?.rig) {
        const headItem = ragdoll.rig.get('head');
        if (headItem?.mesh) {
          headItem.mesh.visible = !!visible;
        }
      }
    },

    get isEnabled() {
      return this._enabled !== false;
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
