import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { RAPIER, ENVIRONMENT_RAY_GROUPS } from '../sim/physics.js';
import { updateSportsCamera } from './sportsCamera.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Encapsulated Player Camera Rig.
 *
 * Supports independent viewports (for splitscreen) and single screen.
 * Handles free chase, ball tracking, sports broadcast, and tactical views.
 */
export class PlayerCamera {
  /**
   * @param {number} playerIndex 0 for P1, 1 for P2, etc.
   * @param {string} initialMode 'ball' | 'chase' | 'sports' | 'broadcast' | 'tactical'
   */
  constructor(playerIndex = 0, initialMode = 'chase') {
    this.playerIndex = playerIndex;
    this.mode = initialMode;

    this.camera = new THREE.PerspectiveCamera(
      TUNING.camera.fov,
      16 / 9,
      0.1,
      400,
    );

    // Initial heading: P1 faces North (behind South goal, yaw 0), P2 faces South (yaw PI)
    this.azimuth = playerIndex === 0 ? 0 : Math.PI;
    this.pitch = 0.35;
    this.currentDistance = TUNING.camera.radius;

    // Manual right-stick override state (used in ball mode)
    this.manualAzimuthOffset = 0;
    this.manualPitchOffset = 0;
    this.manualIdleTimer = 0;

    // Ball height smoother
    this.smoothedBallY = 1.5;

    // Internal scratch vectors
    this._target = new THREE.Vector3();
    this._smoothedTarget = new THREE.Vector3();
    this._smoothedTargetInit = false;
    this._offset = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._desiredPos = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();

    // Reusable Rapier ray
    this._rayFrom = { x: 0, y: 0, z: 0 };
    this._rayDir = { x: 0, y: 0, z: 0 };
    this._envRay = null;
  }

  /**
   * Resets smoothing state (e.g. on respawn/teleport).
   */
  resetSmoothing() {
    this._smoothedTargetInit = false;
  }

  /**
   * Cycles this player's camera mode.
   * In splitscreen mode, 'sports' and 'broadcast' are excluded as they require fullscreen framing.
   * @param {boolean} isSplitscreen
   */
  cycleMode(isSplitscreen = false) {
    const modes = isSplitscreen
      ? ['chase', 'ball', 'tactical']
      : ['chase', 'ball', 'sports', 'broadcast', 'tactical'];
    const current = modes.indexOf(this.mode);
    if (current === -1) {
      this.mode = 'chase';
    } else {
      this.mode = modes[(current + 1) % modes.length];
    }
    console.log(`[playerCamera P${this.playerIndex + 1}] mode -> ${this.mode}`);
    return this.mode;
  }

  /**
   * Sets this player's camera mode directly.
   * @param {'chase' | 'ball' | 'sports' | 'broadcast' | 'tactical'} newMode
   * @param {boolean} isSplitscreen
   */
  setMode(newMode, isSplitscreen = false) {
    if (isSplitscreen && (newMode === 'sports' || newMode === 'broadcast')) {
      newMode = 'chase';
    }
    const modes = ['chase', 'ball', 'sports', 'broadcast', 'tactical'];
    if (modes.includes(newMode)) {
      this.mode = newMode;
      console.log(`[playerCamera P${this.playerIndex + 1}] set mode -> ${this.mode}`);
    }
    return this.mode;
  }

  /**
   * Spherically computes camera offset & normalized direction from azimuth & pitch.
   */
  _computeArmDirection(radius, azimuth, pitch) {
    const cosPitch = Math.cos(pitch);
    this._offset.set(
      radius * cosPitch * Math.sin(azimuth),
      radius * Math.sin(pitch),
      radius * cosPitch * Math.cos(azimuth),
    );
    this._dir.copy(this._offset).divideScalar(radius || 1);
  }

  /**
   * Performs Rapier raycast against arena environment geometry to avoid wall/floor clipping.
   */
  _applySpringArm(world, tuning, desiredDist, frameDelta) {
    const isReset = !this._smoothedTargetInit;
    if (isReset) {
      this._smoothedTarget.copy(this._target);
      this._smoothedTargetInit = true;
    } else {
      this._smoothedTarget.lerp(
        this._target,
        1 - Math.exp(-20.0 * frameDelta),
      );
    }

    if (!this._envRay) {
      this._envRay = new RAPIER.Ray(this._rayFrom, this._rayDir);
    }
    this._rayFrom.x = this._smoothedTarget.x;
    this._rayFrom.y = this._smoothedTarget.y;
    this._rayFrom.z = this._smoothedTarget.z;

    this._rayDir.x = this._dir.x;
    this._rayDir.y = this._dir.y;
    this._rayDir.z = this._dir.z;

    const hit = world.castRay(
      this._envRay,
      desiredDist,
      true,
      undefined,
      ENVIRONMENT_RAY_GROUPS,
    );

    const obstructed = hit
      ? Math.max(tuning.minDistance, hit.timeOfImpact - tuning.collisionMargin)
      : desiredDist;

    // Smooth contraction and extension to eliminate single-frame raycast chatter
    if (isReset) {
      this.currentDistance = obstructed;
    } else if (obstructed < this.currentDistance) {
      const snapThreshold = 1.5;
      if (this.currentDistance - obstructed > snapThreshold) {
        // Large sudden cut (e.g. turning corner): snap closer immediately
        this.currentDistance = obstructed + 0.3;
      }
      this.currentDistance +=
        (obstructed - this.currentDistance) *
        (1 - Math.exp(-24.0 * frameDelta));
    } else {
      this.currentDistance +=
        (obstructed - this.currentDistance) *
        (1 - Math.exp(-tuning.restoreEase * frameDelta));
    }

    this.camera.position
      .copy(this._smoothedTarget)
      .addScaledVector(this._dir, this.currentDistance);
  }

  /**
   * Updates this camera rig for the current frame.
   *
   * @param {object} athlete The Athlete entity this camera follows
   * @param {object|null} activeBall Current match ball
   * @param {object} inputSlot Input slot containing { lookX, lookY }
   * @param {{ dx: number, dy: number }} mouseDeltas Mouse deltas (only applied to P1)
   * @param {object} world Rapier physics world
   * @param {number} frameDelta Delta seconds
   * @param {object[]} allAthletes All athletes (needed for sports camera)
   */
  update({
    athlete,
    activeBall = null,
    inputSlot = null,
    mouseDeltas = { dx: 0, dy: 0 },
    world,
    frameDelta = 0.016,
    allAthletes = [],
    attackingGoal = null,
  }) {
    if (!athlete || !athlete.motor || !athlete.motor.mesh) return;
    if (this.mode === 'custom' || this.mode === 'manual') return;
    const tuning = TUNING.camera;
    const targetMesh = athlete.motor.mesh;
    const ballPos = activeBall && activeBall.mesh ? activeBall.mesh.position : null;

    // 1. SPORTS CAMERA
    if (this.mode === 'sports') {
      updateSportsCamera(this.camera, allAthletes, activeBall, frameDelta);
      return;
    }

    // 2. BROADCAST SIDELINE CAMERA
    if (this.mode === 'broadcast') {
      const tv = tuning.broadcast;
      const playerZ = targetMesh.position.z;
      const lookY = inputSlot ? inputSlot.lookY : 0;
      const mouse = this.playerIndex === 0 ? mouseDeltas : { dx: 0, dy: 0 };
      this.manualPitchOffset += (lookY * tuning.orbitSpeed * frameDelta + mouse.dy / tuning.mousePixelsPerRadian) * 6.0;
      this.manualPitchOffset *= Math.exp(-4.0 * frameDelta);

      const leadZ = ballPos
        ? playerZ * (1 - tv.trackZWeight) + ballPos.z * tv.trackZWeight
        : playerZ;
      const clampedZ = Math.min(tv.maxZ, Math.max(tv.minZ, leadZ + this.manualPitchOffset));

      this._desiredPos.set(tv.sideX, tv.heightY, clampedZ);
      this.camera.position.lerp(
        this._desiredPos,
        1 - Math.exp(-tv.smoothEase * frameDelta),
      );

      this._target.copy(targetMesh.position);
      if (ballPos) {
        this._target.x = targetMesh.position.x * 0.6 + ballPos.x * 0.4;
        this._target.y =
          targetMesh.position.y * 0.7 +
          Math.min(3.0, ballPos.y) * 0.3 +
          0.5;
        this._target.z = targetMesh.position.z * 0.5 + ballPos.z * 0.5 + this.manualPitchOffset;
      }
      this._target.y = Math.max(1.0, this._target.y);
      this.camera.lookAt(this._target);
      return;
    }

    // 3. TACTICAL OVERHEAD CAMERA
    if (this.mode === 'tactical') {
      const top = tuning.tactical;
      const p = targetMesh.position;
      const lookX = inputSlot ? inputSlot.lookX : 0;
      const lookY = inputSlot ? inputSlot.lookY : 0;
      const mouse = this.playerIndex === 0 ? mouseDeltas : { dx: 0, dy: 0 };
      this.manualAzimuthOffset -= (lookX * tuning.orbitSpeed * frameDelta + mouse.dx / tuning.mousePixelsPerRadian) * 4.0;
      this.manualPitchOffset += (lookY * tuning.orbitSpeed * frameDelta + mouse.dy / tuning.mousePixelsPerRadian) * 4.0;
      this.manualAzimuthOffset *= Math.exp(-4.0 * frameDelta);
      this.manualPitchOffset *= Math.exp(-4.0 * frameDelta);

      this._desiredPos.set(p.x * 0.4 + this.manualAzimuthOffset, p.y + top.heightY, p.z + top.distanceZ + this.manualPitchOffset);
      this.camera.position.lerp(
        this._desiredPos,
        1 - Math.exp(-top.smoothEase * frameDelta),
      );

      this._target.copy(p);
      this._target.x += this.manualAzimuthOffset * 0.5;
      this._target.z += top.lookAheadZ + this.manualPitchOffset * 0.5;
      this._target.y = 1.0;
      this.camera.lookAt(this._target);
      return;
    }

    // 4. BALL-FOLLOWING CAMERA (Framing Athlete, Ball, and Attacking Goal Center)
    // 4. BALL-FOLLOWING CAMERA (Anchored to Athlete, Tracking Ball & Goal ahead)
    if (this.mode === 'ball') {
      const cam = tuning.ballCam;
      const hoopCenterY = TUNING.match?.hoopCenterY ?? 10.0;
      const hoopNorthZ = TUNING.match?.hoopNorthZ ?? -40.0;
      const hoopSouthZ = TUNING.match?.hoopSouthZ ?? 40.0;
      const defaultGoalZ = this.playerIndex === 0 ? hoopNorthZ : hoopSouthZ;
      const goalCenter = attackingGoal || { x: 0, y: hoopCenterY, z: defaultGoalZ };

      // 1. Spring Arm Anchor: ALWAYS physically anchored to the controlled athlete's torso
      const pAthlete = targetMesh.position;
      const athleteTorsoY = pAthlete.y + tuning.targetHeight;
      this._target.set(pAthlete.x, athleteTorsoY, pAthlete.z);

      let pBall = ballPos;
      if (pBall) {
        // Low-pass filter ball height to reject rapid bounce jitter
        this.smoothedBallY +=
          (pBall.y - this.smoothedBallY) *
          (1 - Math.exp(-10.0 * frameDelta));
      } else {
        this.smoothedBallY +=
          (athleteTorsoY - this.smoothedBallY) *
          (1 - Math.exp(-10.0 * frameDelta));
        pBall = { x: pAthlete.x, y: this.smoothedBallY, z: pAthlete.z + (this.playerIndex === 0 ? -6 : 6) };
      }

      // 2. Compute Direction Vector from Player to Ball / Attacking Goal
      const dxBall = pBall.x - pAthlete.x;
      const dzBall = pBall.z - pAthlete.z;
      const distBallXZ = Math.hypot(dxBall, dzBall);

      const dxGoal = goalCenter.x - pAthlete.x;
      const dzGoal = goalCenter.z - pAthlete.z;
      const distGoalXZ = Math.hypot(dxGoal, dzGoal);

      let dirX = dxBall;
      let dirZ = dzBall;
      if (distBallXZ < 0.8) {
        // Ball directly overhead or very close: blend toward attacking goal to prevent azimuth spin
        const goalWeight = THREE.MathUtils.clamp((0.8 - distBallXZ) / 0.8, 0, 1);
        dirX = dxBall * (1 - goalWeight) + (dxGoal / (distGoalXZ || 1)) * 0.8 * goalWeight;
        dirZ = dzBall * (1 - goalWeight) + (dzGoal / (distGoalXZ || 1)) * 0.8 * goalWeight;
      }
      const dirLen = Math.hypot(dirX, dirZ);
      if (dirLen > 1e-4) {
        dirX /= dirLen;
        dirZ /= dirLen;
      } else {
        dirX = 0;
        dirZ = this.playerIndex === 0 ? -1 : 1;
      }

      // Camera Azimuth: Position behind player, facing toward ball
      const targetAzimuth = Math.atan2(-dirX, -dirZ);

      // 3. Pitch & Elevation: Relaxed angle keeping player in lower third and ball above
      const dy = this.smoothedBallY - athleteTorsoY;
      const ballElevationAngle = Math.atan2(dy, Math.max(2.5, distBallXZ));
      const baseTargetPitch = THREE.MathUtils.clamp(
        0.20 - THREE.MathUtils.clamp(ballElevationAngle * 0.35, 0, 0.14),
        0.06,
        0.30,
      );

      // Smooth azimuth easing (shortest angle path)
      const easeAzimuth = 1 - Math.exp(-cam.smoothEase * frameDelta);
      let dAzimuth = (targetAzimuth - this.azimuth) % (Math.PI * 2);
      if (dAzimuth > Math.PI) dAzimuth -= Math.PI * 2;
      if (dAzimuth < -Math.PI) dAzimuth += Math.PI * 2;
      this.azimuth += dAzimuth * easeAzimuth;

      // Smooth pitch easing
      this.pitch +=
        (baseTargetPitch - this.pitch) *
        (1 - Math.exp(-cam.pitchEase * frameDelta));

      // Right stick manual override (nudge & snap-back)
      const lookX = inputSlot ? inputSlot.lookX : 0;
      const lookY = inputSlot ? inputSlot.lookY : 0;
      const mouse = this.playerIndex === 0 ? mouseDeltas : { dx: 0, dy: 0 };
      const hasManualInput =
        Math.hypot(lookX, lookY) > 0.08 ||
        Math.abs(mouse.dx) > 1 ||
        Math.abs(mouse.dy) > 1;

      if (hasManualInput) {
        this.manualAzimuthOffset -= lookX * tuning.orbitSpeed * frameDelta;
        this.manualAzimuthOffset -= mouse.dx / tuning.mousePixelsPerRadian;
        this.manualPitchOffset += lookY * tuning.orbitSpeed * frameDelta;
        this.manualPitchOffset += mouse.dy / tuning.mousePixelsPerRadian;
        this.manualIdleTimer = 0;
      } else {
        this.manualIdleTimer += frameDelta;
        if (this.manualIdleTimer > cam.manualReturnDelay) {
          const returnEase = 1 - Math.exp(-cam.manualReturnSpeed * frameDelta);
          this.manualAzimuthOffset += (0 - this.manualAzimuthOffset) * returnEase;
          this.manualPitchOffset += (0 - this.manualPitchOffset) * returnEase;
        }
      }

      // Combine automatic tracking with manual stick nudges
      const effAzimuth = this.azimuth + this.manualAzimuthOffset;
      let effPitch = this.pitch + this.manualPitchOffset;
      effPitch = Math.min(cam.maxPitch, Math.max(cam.minPitch, effPitch));

      // 4. Dynamic distance: gently expand when ball is far/high to keep everything framed
      const spanExpansion = Math.min(2.5, Math.max(0, (distBallXZ - 4.0) * 0.18) + Math.max(0, dy * 0.15));
      let desiredDistance = THREE.MathUtils.clamp(5.5 + spanExpansion, 5.2, 8.2);

      if (effPitch < 0) {
        const pullFraction = Math.max(
          0,
          Math.min(1, effPitch / cam.minPitch),
        );
        desiredDistance = THREE.MathUtils.lerp(
          desiredDistance,
          tuning.pullbackMinDistance,
          pullFraction,
        );
      }

      this._computeArmDirection(desiredDistance, effAzimuth, effPitch);
      if (world) this._applySpringArm(world, tuning, desiredDistance, frameDelta);

      // 5. Look-At Target: Look slightly forward over athlete's shoulder towards the ball
      // Ensures the athlete is reliably framed in lower-middle screen while tracking the ball
      const lookLead = Math.min(distBallXZ * 0.25, 3.5);
      const lookElevation = Math.min(Math.max(0, dy * 0.35), 3.0);
      this._lookTarget.set(
        this._smoothedTarget.x + dirX * lookLead,
        this._smoothedTarget.y + 0.4 + lookElevation,
        this._smoothedTarget.z + dirZ * lookLead,
      );
      this.camera.lookAt(this._lookTarget);
      return;
    }

    // 5. FREE CHASE CAMERA (Fallback & standard 3rd person)
    {
      const lookX = inputSlot ? inputSlot.lookX : 0;
      const lookY = inputSlot ? inputSlot.lookY : 0;
      const mouse = this.playerIndex === 0 ? mouseDeltas : { dx: 0, dy: 0 };

      this.azimuth -= lookX * tuning.orbitSpeed * frameDelta;
      this.azimuth -= mouse.dx / tuning.mousePixelsPerRadian;
      this.pitch += lookY * tuning.orbitSpeed * frameDelta;
      this.pitch += mouse.dy / tuning.mousePixelsPerRadian;
      this.pitch = Math.min(
        tuning.maxPitch,
        Math.max(tuning.minPitch, this.pitch),
      );

      this._target.copy(targetMesh.position);
      this._target.y += tuning.targetHeight;

      // Dynamic pull-back when pitching down/looking up into the sky
      let desiredDistance = tuning.radius;
      if (this.pitch < 0) {
        const pullFraction = Math.max(
          0,
          Math.min(1, this.pitch / tuning.minPitch),
        );
        desiredDistance = THREE.MathUtils.lerp(
          tuning.radius,
          tuning.pullbackMinDistance,
          pullFraction,
        );
        // Slightly elevate look target to prevent ground scraping
        this._target.y += 0.35 * pullFraction;
      }

      this._computeArmDirection(desiredDistance, this.azimuth, this.pitch);
      if (world) this._applySpringArm(world, tuning, desiredDistance, frameDelta);
      this.camera.lookAt(this._smoothedTarget);
    }
  }
}
