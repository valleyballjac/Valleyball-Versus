/**
 * @module botSteering
 * @description Reynolds velocity-space locomotion steering, slope drift compensation, and approach geometry for AI bots.
 *
 * - **Role**: Translates tactical target positions and desired shot vectors from `botController.js` into
 *   synthetic analog stick inputs (`moveWorld`, `moveX`, `moveZ`, `sprintHeld`, `aimYaw`) on the athlete's `inputSlot`.
 * - **Frame Phase**: Fixed 60 Hz simulation step (AI decision phase, prior to motor force application).
 * - **Active Architectural Laws**:
 *   - **LAW 1 (Single Physics Writer)**: Never mutates Rapier rigid bodies directly; writes exclusively to `inputSlot`.
 *   - **LAW 6 (Determinism & Zero Allocations)**: All vector math uses module-scoped `_scratch*` `THREE.Vector3`
 *     instances so per-tick steering allocates 0 heap objects.
 */

import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';

// Pre-allocated module-scoped scratch vectors for zero-allocation hot path (LAW 6)
const scratchDir = new THREE.Vector3();
const _scratchToTarget = new THREE.Vector3();
const _scratchVDesired = new THREE.Vector3();
const _scratchFSteer = new THREE.Vector3();
const _scratchArcTarget = new THREE.Vector3();
const _scratchShotDir = new THREE.Vector3();
const _scratchApproachTarget = new THREE.Vector3();

/**
 * Steers the bot toward a target position in world space using Reynolds velocity-space steering.
 * Comprehends the sphere motor's rolling inertia, lateral drift compensation, and valley floor slope.
 * 
 * @param {Object} inputSlot - The input slot to write synthetic input to
 * @param {Object} currentPos - Current position { x, y, z }
 * @param {Object} targetPos - Desired target position { x, y, z }
 * @param {Object} options - { sprint, arrive, arriveRadius, maxSpeed, minDrive, currentVel, decelFactor, aimYaw, facePos }
 */
export function steerToward(inputSlot, currentPos, targetPos, options = {}) {
    const sprint = options.sprint ?? false;
    const arrive = options.arrive ?? false;
    const arriveRadius = options.arriveRadius ?? 1.0;
    const maxSpeed = options.maxSpeed ?? 1.0;
    const minDrive = options.minDrive ?? 0.0;
    const currentVel = options.currentVel;

    // Compute direction vector in XZ plane, ignore Y
    _scratchToTarget.set(targetPos.x - currentPos.x, 0, targetPos.z - currentPos.z);
    const distance = _scratchToTarget.length();
    
    if (distance < 0.15 && minDrive <= 0) {
        inputSlot.moveWorld.set(0, 0, 0);
        inputSlot.moveX = 0;
        inputSlot.moveZ = 0;
        inputSlot.sprintHeld = false;
        if (options.aimYaw !== undefined) {
            inputSlot.aimYaw = options.aimYaw;
            inputSlot.cameraYaw = options.aimYaw;
            inputSlot.hasAim = true;
        } else if (options.facePos) {
            const yaw = computeAimYaw(currentPos, options.facePos);
            inputSlot.aimYaw = yaw;
            inputSlot.cameraYaw = yaw;
            inputSlot.hasAim = true;
        }
        return;
    }

    if (distance < 1e-4) {
        return;
    }

    // Normalized direction toward target
    scratchDir.copy(_scratchToTarget).divideScalar(distance);
    const dirX = scratchDir.x;
    const dirZ = scratchDir.z;

    // ═══ NATURAL FORWARD-FACING LOCOMOTION YAW ═══
    // Blend actual horizontal velocity with desired path tangent when running so the
    // 2D locomotion blend-space stays in the forward run/sprint sector instead of
    // backpedaling or side-skidding from counter-steering damping forces.
    const facing = TUNING.ai.facing;
    let travelYaw = Math.atan2(dirX, dirZ);
    let hSpeed = 0;
    if (currentVel) {
        hSpeed = Math.hypot(currentVel.x, currentVel.z);
        if (hSpeed > facing.velocityBlendMinSpeed) {
            const vnx = currentVel.x / hSpeed;
            const vnz = currentVel.z / hSpeed;
            const velDotDir = vnx * dirX + vnz * dirZ;
            if (velDotDir > facing.velocityBlendMinDot) {
                const w = facing.velocityBlendWeight;
                const bx = vnx * w + dirX * (1 - w);
                const bz = vnz * w + dirZ * (1 - w);
                if (bx * bx + bz * bz > 1e-4) {
                    travelYaw = Math.atan2(bx, bz);
                }
            }
        }
    }

    let wantedYaw = travelYaw;
    if (options.aimYaw !== undefined || options.facePos) {
        const explicitYaw = options.aimYaw !== undefined
            ? options.aimYaw
            : computeAimYaw(currentPos, options.facePos);
        const alignCos = Math.sin(explicitYaw) * Math.sin(travelYaw) + Math.cos(explicitYaw) * Math.cos(travelYaw);
        // Lock to explicit aimYaw when within strike preparation range, moving at
        // controlled speed, or when explicit aim is close to the travel heading.
        // Never sprint long-distance across the court facing backward against travel!
        if (distance <= facing.aimLockDistance || hSpeed <= facing.aimLockMaxSpeed || alignCos >= facing.aimLockMinCos) {
            wantedYaw = explicitYaw;
        }
    }
    inputSlot.aimYaw = wantedYaw;
    inputSlot.cameraYaw = wantedYaw;
    inputSlot.hasAim = true;

    let speedScale = maxSpeed * (options.decelFactor ?? 1.0);
    const brakeZone = Math.max(arriveRadius * 1.55, 0.95);
    const allowBrake = arrive;
    const effectiveMinDrive = (allowBrake && distance < brakeZone) ? 0.0 : minDrive;
    if (arrive && distance < arriveRadius) {
        speedScale *= Math.max(0.32, distance / arriveRadius);
    }
    if (effectiveMinDrive > 0) {
        speedScale = Math.max(effectiveMinDrive, speedScale);
    }

    // Target terminal velocity in m/s (flat sprint ~6.0 m/s, run ~4.2 m/s; downhill slopes reach 9-10 m/s)
    const topMps = sprint ? 6.0 : 4.2;
    const targetVel = options.targetVel;
    const vTargetAlong = targetVel ? Math.max(0, targetVel.x * dirX + targetVel.z * dirZ) : 0;
    let desiredSpeedMps = speedScale * topMps;

    // Real physical motor braking acceleration: `brakeTorque = 4` -> `a_brake = 5.45 m/s^2`.
    // Reversing stick with `sprintHeld = false` triggers `reversalBiteTime = 0.25s` (~20 m/s^2 plant-and-stop).
    let vToward = 0;
    let vClosing = 0;
    let realStopDist = 0;
    if (currentVel) {
        vToward = currentVel.x * dirX + currentVel.z * dirZ;
        vClosing = Math.max(0, vToward - vTargetAlong);
        realStopDist = (vClosing * vClosing) / (2.0 * 5.45);
    }
    const dynamicBrakeZone = Math.max(brakeZone, Math.min(7.5, realStopDist * 1.12));

    if (allowBrake && distance < dynamicBrakeZone) {
        // Relative-velocity kinematic stopping envelope matched to real motor brakeTorque (5.45 m/s^2)
        const brakeEnvelopeMps = Math.sqrt(2.0 * 5.6 * Math.max(0, distance - 0.08)) + vTargetAlong;
        desiredSpeedMps = Math.min(desiredSpeedMps, brakeEnvelopeMps);
        if (distance < arriveRadius) {
            speedScale = Math.min(speedScale, Math.max(0.28, desiredSpeedMps / topMps));
        }
    }
    _scratchVDesired.copy(scratchDir).multiplyScalar(desiredSpeedMps);

    // ═══ REYNOLDS VELOCITY-SPACE STEERING & REAL-PHYSICS PLANT-AND-BRAKE ═══
    if (currentVel) {
        const vx = currentVel.x;
        const vz = currentVel.z;
        const vLatX = vx - vToward * dirX;
        const vLatZ = vz - vToward * dirZ;
        const vLat = Math.hypot(vLatX, vLatZ);

        // HOT APPROACH PLANT-BRAKE: Coming down slopes at 7-10 m/s inside real stopping distance,
        // actively counter-steer opposite velocity with `sprintHeld = false` so `reversalBiteTime` (0.25s)
        // plants the athlete in ~1.5m instead of sailing 4-5m past the ball!
        if (allowBrake && distance < dynamicBrakeZone && vClosing > 3.0 && vToward > desiredSpeedMps + 1.35) {
            const spd = Math.hypot(vx, vz) || 1.0;
            const revScale = Math.min(0.85, 0.45 + (vToward - desiredSpeedMps) * 0.12);
            inputSlot.moveWorld.set((-vx / spd) * revScale, 0, (-vz / spd) * revScale);
            inputSlot.moveX = inputSlot.moveWorld.x;
            inputSlot.moveZ = inputSlot.moveWorld.z;
            inputSlot.sprintHeld = false;
            return;
        }

        // MODERATE OVERSPEED COAST-BRAKE: Release stick so `brakeTorque = 4` (5.45 m/s^2) lands cleanly on pocket
        if (allowBrake && distance < dynamicBrakeZone && vToward > desiredSpeedMps + 0.35 && vLat < 1.35) {
            inputSlot.moveWorld.set(0, 0, 0);
            inputSlot.moveX = 0;
            inputSlot.moveZ = 0;
            inputSlot.sprintHeld = false;
            return;
        }

        const currentSpeedSq = vx * vx + vz * vz;
        if (currentSpeedSq > 0.04) {
            const deltaVx = _scratchVDesired.x - vx;
            const deltaVz = _scratchVDesired.z - vz;

            // Stronger counter-steering damping when braking laterally or hot inside the arrive zone
            const kDamp = (allowBrake && distance < dynamicBrakeZone && (vLat >= 0.90 || vToward > desiredSpeedMps + 0.20)) ? 0.78 : 0.46;
            _scratchFSteer.set(
                _scratchVDesired.x + deltaVx * kDamp,
                0,
                _scratchVDesired.z + deltaVz * kDamp
            );

            const fLen = _scratchFSteer.length();
            if (fLen > 1e-4) {
                scratchDir.copy(_scratchFSteer).divideScalar(fLen);
            }
        }
    }

    // ═══ VALLEY TERRAIN & SPHERE MOTOR SLOPE COMPENSATION ═══
    // On the inclined court (|Z| > 10m), gravity pulls downhill toward Z = 0 with a = 2.4-3.5 m/s^2.
    // When driving uphill or across the slope, apply uphill banking to cancel gravity drift!
    const az = Math.abs(currentPos.z);
    let steepUphill = false;
    if (az > 10.0) {
        const slopeSign = Math.sign(currentPos.z); // +1 on South slope, -1 on North slope
        const slopeGrade = 0.3375 * Math.pow((az - 10.0) / 40.0, 0.35);

        // Moving uphill: boost drive torque so the sphere doesn't stall against gravity,
        // without overriding kinematic pocket braking when already closing fast.
        const movingUphill = (scratchDir.z * slopeSign) > 0;
        if (movingUphill) {
            if (allowBrake && distance < brakeZone) {
                if (distance > 0.16 && vToward < desiredSpeedMps * 0.85) {
                    speedScale = Math.max(speedScale, Math.min(0.85, 0.50 + slopeGrade * 0.65));
                }
            } else {
                speedScale = Math.max(speedScale, Math.min(1.0, 0.85 + slopeGrade * 0.45));
            }
        }

        // Traversing laterally across slope: bank uphill to cancel downhill gravity drift
        const movingLateral = Math.abs(scratchDir.x) > 0.3;
        if (movingLateral) {
            const uphillBank = slopeGrade * 0.35;
            scratchDir.z += slopeSign * uphillBank;
            scratchDir.normalize();
        }

        steepUphill = !(allowBrake && distance < arriveRadius) && az > 15.0 && (scratchDir.z * slopeSign) > 0;
    }

    scratchDir.multiplyScalar(Math.min(1.0, speedScale));

    inputSlot.moveWorld.copy(scratchDir);
    inputSlot.moveX = scratchDir.x;
    inputSlot.moveZ = scratchDir.z;
    inputSlot.sprintHeld = (sprint && !(allowBrake && distance < 0.55)) || steepUphill;
}

/**
 * Steers the bot in a wide, collision-safe lateral arc around the ball when caught on
 * the wrong side so the live 16-body ragdoll limbs never clip or kick the ball backward
 * toward our own defending hoop.
 */
export function steerGoalSideArc(inputSlot, selfPos, ballPos, defendGoalPos, options = {}) {
    const signZ = Math.sign(ballPos.z - defendGoalPos.z) || 1; // direction from defend goal to ball
    const ballRadius = options.ballRadius ?? 0.50;
    const clearLat = 1.45 + ballRadius * 0.90;
    const behindDist = 1.05 + ballRadius * 0.65;
    const safeClearR = 1.15 + ballRadius;

    // Pick the side the athlete is already on unless that side clips the glass wall
    let sideSign = (selfPos.x >= ballPos.x) ? 1 : -1;
    if (Math.abs(ballPos.x + sideSign * clearLat) > 15.2) {
        sideSign = -sideSign;
    }
    const lateralFlareX = Math.max(-15.0, Math.min(15.0, ballPos.x + sideSign * clearLat));

    // If directly on the attacking side of the ball within limb-clip distance, step laterally
    // clear of the ball FIRST before dropping back behind it so we never bump it toward our own goal.
    const dxToBall = selfPos.x - ballPos.x;
    const dzToBall = selfPos.z - ballPos.z;
    const distToBall = Math.hypot(dxToBall, dzToBall);
    const aheadOfBall = (dzToBall * signZ) > -0.15;
    const targetZ = (aheadOfBall && Math.abs(dxToBall) < safeClearR && distToBall < safeClearR + 0.8)
        ? (selfPos.z - signZ * 0.25)
        : (ballPos.z - signZ * behindDist);

    _scratchArcTarget.set(lateralFlareX, 0, Math.max(-46.0, Math.min(46.0, targetZ)));
    steerToward(inputSlot, selfPos, _scratchArcTarget, {
        sprint: (options.sprint ?? true) && distToBall > (1.8 + ballRadius),
        arrive: false,
        maxSpeed: options.maxSpeed ?? 1.0,
        minDrive: 0.82,
        currentVel: options.currentVel,
    });
}

/**
 * Steers the athlete along a curved approach arc that lines up with the shot vector toward the goal.
 *
 * **Why**: Arriving with horizontal velocity already tangent to the intended shot ray prevents
 * sideways momentum from carrying the ragdoll past the ball during the 8–42 tick strike windup.
 *
 * @param {Object} inputSlot - Synthetic input slot mutated in-place
 * @param {{x: number, y: number, z: number}} selfPos - Current athlete position in meters (`m`)
 * @param {{x: number, y: number, z: number}} selfVel - Current athlete velocity in `m/s`
 * @param {{x: number, y: number, z: number}} ballPos - Target ball/intercept position in meters (`m`)
 * @param {{x: number, y: number, z: number}} attackTargetPos - Intended offensive target in meters (`m`)
 * @param {{x: number, y: number, z: number}} defendGoalPos - Defending hoop position in meters (`m`)
 * @param {Object} [options={}] - `{ sprint, runwayOffset (m), pocketDist (m), arriveRadius (m), decelFactor, maxSpeed }`
 */
export function steerGoalAlignedApproach(inputSlot, selfPos, selfVel, ballPos, attackTargetPos, defendGoalPos, options = {}) {
    // Shot direction from ball to attack target in XZ plane
    _scratchShotDir.set(attackTargetPos.x - ballPos.x, 0, attackTargetPos.z - ballPos.z).normalize();
    if (_scratchShotDir.lengthSq() === 0) {
        const signZ = attackTargetPos.z >= 0 ? 1 : -1;
        _scratchShotDir.set(0, 0, signZ);
    }

    // Normal vector perpendicular to shot direction in XZ plane
    const perpX = -_scratchShotDir.z;
    const perpZ = _scratchShotDir.x;

    // Vector from ball to self
    const toAthX = selfPos.x - ballPos.x;
    const toAthZ = selfPos.z - ballPos.z;

    // Dot products:
    // axial: positive = athlete is ahead of ball (toward target), negative = behind ball
    const axialDist = toAthX * _scratchShotDir.x + toAthZ * _scratchShotDir.z;
    const lateralDist = toAthX * perpX + toAthZ * perpZ;

    const aimYaw = Math.atan2(_scratchShotDir.x, _scratchShotDir.z);
    const runwayOffset = options.runwayOffset ?? 1.5;
    const ballRadius = options.ballRadius ?? 0.50;

    // CASE 1: Ahead of ball (between ball and target). Curve wide around the ball to get behind it
    // without live ragdoll limbs clipping the ball backward.
    if (axialDist > 0.20) {
        const clearLat = 1.45 + ballRadius * 0.90;
        const behindOff = 1.00 + ballRadius * 0.65;
        let sideSign = lateralDist >= 0 ? 1 : -1;
        const candX = ballPos.x - _scratchShotDir.x * behindOff + perpX * sideSign * clearLat;
        if (Math.abs(candX) > 15.2) sideSign = -sideSign;
        const stepOutOnly = Math.abs(lateralDist) < (0.95 + ballRadius) && axialDist < (1.2 + ballRadius);
        const axialTarget = stepOutOnly ? Math.max(0.0, axialDist - 0.30) : -behindOff;
        _scratchApproachTarget.set(
            Math.max(-15.0, Math.min(15.0, ballPos.x + _scratchShotDir.x * axialTarget + perpX * sideSign * clearLat)),
            0,
            Math.max(-46.0, Math.min(46.0, ballPos.z + _scratchShotDir.z * axialTarget + perpZ * sideSign * clearLat))
        );
        const distToBallNow = Math.hypot(toAthX, toAthZ);
        steerToward(inputSlot, selfPos, _scratchApproachTarget, {
            sprint: distToBallNow > (1.8 + ballRadius),
            arrive: false,
            maxSpeed: options.maxSpeed ?? 1.0,
            minDrive: 0.82,
            currentVel: selfVel,
        });
        return;
    }

    // CASE 2: Behind ball but offset laterally (approaching from the flank).
    // Curve into the runway entry pocket behind the ball so approach lines up co-linearly with shot.
    if (Math.abs(lateralDist) > 0.65 && axialDist > -runwayOffset * 1.5) {
        const sideSign = Math.sign(lateralDist) || 1;
        _scratchApproachTarget.set(
            ballPos.x - _scratchShotDir.x * runwayOffset + perpX * sideSign * 0.35,
            0,
            ballPos.z - _scratchShotDir.z * runwayOffset + perpZ * sideSign * 0.35
        );
        steerToward(inputSlot, selfPos, _scratchApproachTarget, {
            sprint: options.sprint ?? true,
            arrive: false,
            maxSpeed: options.maxSpeed ?? 1.0,
            minDrive: 0.80,
            currentVel: selfVel,
        });
        return;
    }

    // CASE 3: Inside runway corridor behind ball.
    // Within 6.5m, engage relative-velocity speed-aware braking so even a 9.5 m/s downhill
    // approach drops out of sprint in time, restores 100% turn authority, and plants right in the pocket!
    const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.z - selfPos.z);
    const pocketDist = options.pocketDist ?? (0.30 + ballRadius * 0.55);
    const arriveRadius = options.arriveRadius ?? 0.65;
    const sprintCutoff = options.sprintCutoff ?? 1.85;
    if (distToBall < 6.5) {
        _scratchApproachTarget.set(
            ballPos.x - _scratchShotDir.x * pocketDist,
            0,
            ballPos.z - _scratchShotDir.z * pocketDist
        );
        const distToPocket = Math.hypot(_scratchApproachTarget.x - selfPos.x, _scratchApproachTarget.z - selfPos.z);
        steerToward(inputSlot, selfPos, _scratchApproachTarget, {
            sprint: (options.sprint ?? true) && distToPocket > Math.max(sprintCutoff, 2.4),
            arrive: true,
            arriveRadius: Math.max(arriveRadius, 0.55),
            maxSpeed: (options.maxSpeed ?? 1.0) * 0.98,
            minDrive: 0.0,
            aimYaw: distToBall < 3.4 ? aimYaw : undefined,
            currentVel: selfVel,
            targetVel: options.ballVel,
        });
    } else {
        // Fast approach: close corridor targeting anatomical pocket
        _scratchApproachTarget.set(
            ballPos.x - _scratchShotDir.x * (pocketDist + 0.08),
            0,
            ballPos.z - _scratchShotDir.z * (pocketDist + 0.08)
        );
        steerToward(inputSlot, selfPos, _scratchApproachTarget, {
            sprint: options.sprint ?? true,
            arrive: true,
            arriveRadius: 0.85,
            maxSpeed: options.maxSpeed ?? 1.0,
            minDrive: 0.86,
            currentVel: selfVel,
            targetVel: options.ballVel,
        });
    }
}

/**
 * Computes the horizontal yaw angle in radians (`rad`) to face `targetPos` from `ownPos`.
 *
 * @param {{x: number, y: number, z: number}} ownPos - Origin position in meters (`m`)
 * @param {{x: number, y: number, z: number}} targetPos - Target position in meters (`m`)
 * @returns {number} World yaw angle in radians (`atan2(dx, dz)`)
 */
export function computeAimYaw(ownPos, targetPos) {
    const dx = targetPos.x - ownPos.x;
    const dz = targetPos.z - ownPos.z;
    return Math.atan2(dx, dz);
}

/**
 * Stops all bot movement by zeroing locomotion axes and sprint/slide holds on `inputSlot`.
 *
 * @param {Object} inputSlot - Synthetic input slot to zero out
 */
export function steerIdle(inputSlot) {
    inputSlot.moveX = 0;
    inputSlot.moveZ = 0;
    if (inputSlot.moveWorld) {
        inputSlot.moveWorld.set(0, 0, 0);
    }
    inputSlot.sprintHeld = false;
    inputSlot.slideHeld = false;
}

/**
 * Evaluates whether the bot should execute a Cut maneuver (KeyV / RB) to plant-and-redirect.
 *
 * Checks:
 * 1. Current horizontal speed is high (> 3.0 m/s).
 * 2. Desired direction sharply diverges from current velocity (angle > 75 degrees, or dot < 0.25).
 * 3. Or when descending steep slopes (> 2.8 m/s downhill) and needing to reverse or cut laterally.
 *
 * @param {THREE.Vector3|{x: number, y: number, z: number}} currentVel
 * @param {THREE.Vector3|{x: number, y: number, z: number}} desiredDir
 * @param {Object} [options] - { minSpeed, minAngleDeg, isDownhill }
 * @returns {boolean}
 */
export function shouldExecuteCut(currentVel, desiredDir, options = {}) {
    if (!currentVel || !desiredDir) return false;
    const hSpeed = Math.hypot(currentVel.x, currentVel.z);
    const minSpeed = options.minSpeed ?? 3.0;
    if (hSpeed < minSpeed) return false;

    const dirLen = Math.hypot(desiredDir.x, desiredDir.z);
    if (dirLen < 0.1) return false;

    const vNormX = currentVel.x / hSpeed;
    const vNormZ = currentVel.z / hSpeed;
    const dNormX = desiredDir.x / dirLen;
    const dNormZ = desiredDir.z / dirLen;

    const alignment = vNormX * dNormX + vNormZ * dNormZ;

    // Dot product < 0.25 corresponds to angle > ~75 degrees (sharp redirect / reversal)
    if (alignment < 0.25) {
        return true;
    }

    // Downhill slope descent check: lower threshold if sliding downhill fast
    if (options.isDownhill && hSpeed > 2.8 && alignment < 0.5) {
        return true;
    }

    return false;
}
