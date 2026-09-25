import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';

// Pre-allocate scratch vectors for deterministic math (Rule 6)
const scratchDir = new THREE.Vector3();
const _scratchToTarget = new THREE.Vector3();
const _scratchVDesired = new THREE.Vector3();
const _scratchFSteer = new THREE.Vector3();
const _scratchArcTarget = new THREE.Vector3();
const _scratchRunwayPoint = new THREE.Vector3();
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

    // Apply facing / aim alignment if specified
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

    // Compute direction vector in XZ plane, ignore Y
    _scratchToTarget.set(targetPos.x - currentPos.x, 0, targetPos.z - currentPos.z);
    const distance = _scratchToTarget.length();
    
    if (distance < 0.15 && minDrive <= 0) {
        inputSlot.moveWorld.set(0, 0, 0);
        inputSlot.moveX = 0;
        inputSlot.moveZ = 0;
        inputSlot.sprintHeld = false;
        return;
    }

    if (distance < 1e-4) {
        return;
    }

    // Normalized direction toward target
    scratchDir.copy(_scratchToTarget).divideScalar(distance);

    let speedScale = maxSpeed * (options.decelFactor ?? 1.0);
    if (arrive && distance < arriveRadius) {
        speedScale *= Math.max(0.35, distance / arriveRadius);
    }
    if (minDrive > 0) {
        speedScale = Math.max(minDrive, speedScale);
    }

    // Target terminal velocity in m/s (sprint: ~6.0 m/s, run: ~4.2 m/s)
    const topMps = sprint ? 6.0 : 4.2;
    const desiredSpeedMps = speedScale * topMps;
    _scratchVDesired.copy(scratchDir).multiplyScalar(desiredSpeedMps);

    // ═══ REYNOLDS VELOCITY-SPACE STEERING ═══
    // F_steer = v_desired - v_current.
    // When the rolling sphere is sliding sideways or fast in the wrong direction,
    // apply counter-torque to kill unwanted drift and snap onto the target trajectory.
    if (currentVel) {
        const vx = currentVel.x;
        const vz = currentVel.z;
        const currentSpeedSq = vx * vx + vz * vz;
        if (currentSpeedSq > 0.04) {
            const deltaVx = _scratchVDesired.x - vx;
            const deltaVz = _scratchVDesired.z - vz;

            // Blend desired direction with counter-steering damping force (damping gain = 0.40)
            const kDamp = 0.40;
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

        // Moving uphill: boost drive torque so the sphere doesn't stall against gravity
        const movingUphill = (scratchDir.z * slopeSign) > 0;
        if (movingUphill) {
            speedScale = Math.max(speedScale, Math.min(1.0, 0.85 + slopeGrade * 0.45));
        }

        // Traversing laterally across slope: bank uphill to cancel downhill gravity drift
        const movingLateral = Math.abs(scratchDir.x) > 0.3;
        if (movingLateral) {
            const uphillBank = slopeGrade * 0.35;
            scratchDir.z += slopeSign * uphillBank;
            scratchDir.normalize();
        }

        steepUphill = az > 15.0 && (scratchDir.z * slopeSign) > 0;
    }

    scratchDir.multiplyScalar(Math.min(1.0, speedScale));

    inputSlot.moveWorld.copy(scratchDir);
    inputSlot.moveX = scratchDir.x;
    inputSlot.moveZ = scratchDir.z;
    inputSlot.sprintHeld = sprint || steepUphill;
}

/**
 * Steers the bot in a tight lateral arc around the ball when caught on the wrong side.
 * Tight and responsive to avoid wild detours to the arena walls.
 */
export function steerGoalSideArc(inputSlot, selfPos, ballPos, defendGoalPos, options = {}) {
    const signZ = Math.sign(ballPos.z - defendGoalPos.z) || 1; // direction from defend goal to ball
    // Target a tight waypoint behind the ball on the defending side with compact lateral clearance
    const lateralOffset = (selfPos.x >= ballPos.x) ? 1.2 : -1.2;
    const lateralFlareX = Math.max(-15.0, Math.min(15.0, ballPos.x + lateralOffset));
    const behindZ = ballPos.z - signZ * 0.9;
    
    _scratchArcTarget.set(lateralFlareX, 0, behindZ);
    steerToward(inputSlot, selfPos, _scratchArcTarget, {
        sprint: options.sprint ?? true,
        arrive: false,
        maxSpeed: options.maxSpeed ?? 1.0,
        minDrive: 0.85,
        currentVel: options.currentVel,
    });
}

/**
 * Steers the athlete along a curved approach arc that lines up with the shot vector toward the goal.
 * Ensures the athlete's velocity is already tangent to the shot direction upon arrival.
 * 
 * @param {Object} inputSlot
 * @param {Object} selfPos - Current position { x, y, z }
 * @param {Object} selfVel - Current velocity { x, y, z }
 * @param {Object} ballPos - Target or ball position { x, y, z }
 * @param {Object} attackTargetPos - Intended destination for this stage (e.g. stream head or goal)
 * @param {Object} defendGoalPos - Defending goal position for goal-side safety
 * @param {Object} options - { sprint, runwayOffset, decelFactor, maxSpeed }
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

    // CASE 1: Ahead of ball (between ball and target). Curve smoothly to behind the ball.
    if (axialDist > 0.25) {
        const sideSign = lateralDist >= 0 ? 1 : -1;
        _scratchApproachTarget.set(
            ballPos.x - _scratchShotDir.x * 0.9 + perpX * sideSign * 1.3,
            0,
            ballPos.z - _scratchShotDir.z * 0.9 + perpZ * sideSign * 1.3
        );
        steerToward(inputSlot, selfPos, _scratchApproachTarget, {
            sprint: true,
            arrive: false,
            maxSpeed: options.maxSpeed ?? 1.0,
            minDrive: 0.85,
            aimYaw,
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
            aimYaw,
            currentVel: selfVel,
        });
        return;
    }

    // CASE 3: Inside runway corridor behind ball — DRIVE FORWARD THROUGH THE BALL!
    _scratchApproachTarget.set(
        ballPos.x + _scratchShotDir.x * 1.2,
        0,
        ballPos.z + _scratchShotDir.z * 1.2
    );

    steerToward(inputSlot, selfPos, _scratchApproachTarget, {
        sprint: options.sprint ?? true,
        arrive: false,
        maxSpeed: options.maxSpeed ?? 1.0,
        minDrive: 0.90,
        aimYaw,
        currentVel: selfVel,
    });
}

/**
 * Legacy alias for backwards compatibility with multi-stage attack executors.
 */
export function steerStageRunway(inputSlot, selfPos, ballPos, attackTargetPos, defendGoalPos, options = {}) {
    return steerGoalAlignedApproach(inputSlot, selfPos, options.currentVel, ballPos, attackTargetPos, defendGoalPos, options);
}

/**
 * Computes the yaw angle to face the target position.
 * 
 * @param {Object} ownPos - Current position { x, y, z }
 * @param {Object} targetPos - Target position { x, y, z }
 * @returns {number} Yaw angle in radians
 */
export function computeAimYaw(ownPos, targetPos) {
    const dx = targetPos.x - ownPos.x;
    const dz = targetPos.z - ownPos.z;
    return Math.atan2(dx, dz);
}

/**
 * Computes the yaw angle to shoot toward a goal hoop located in the X = 0 plane.
 * 
 * Because the hoop apertures sit in the X = 0 plane, testHoopCrossing requires
 * the ball trajectory to cross from one side of X = 0 to the other with non-zero dx.
 * If the athlete is near X = 0, aiming directly at (0, Z_hoop) results in dx ≈ 0,
 * which cannot register a goal.
 * 
 * This function calculates a target point that guarantees a clean crossing through
 * the hoop aperture disc (radius ~4.667m at Z = ±40.0, Y = 10.0).
 * 
 * @param {Object} ownPos - Current position { x, y, z }
 * @param {Object} goalPos - Goal position { x: 0, y: 10, z: ±40 }
 * @param {number} lateralOffset - Entry offset across X = 0 (default 1.2m)
 * @returns {number} Yaw angle in radians
 */
export function computeGoalAimYaw(ownPos, goalPos) {
    let dx = -ownPos.x;
    const dz = goalPos.z - ownPos.z;
    if (Math.abs(ownPos.x) < 0.25) {
        dx = ownPos.x >= 0 ? -0.8 : 0.8;
    }
    return Math.atan2(dx, dz);
}

/**
 * Computes precision aim yaw from a stream head position across X = 0 directly into
 * the hoop aperture disc.
 * 
 * @param {Object} ownPos - Current position { x, y, z }
 * @param {Object} goalPos - Goal position { x: 0, y: 10, z: ±40 }
 * @returns {number} Yaw angle in radians
 */
export function computeStreamHeadAimYaw(ownPos, goalPos) {
    const dx = -ownPos.x;
    const dz = goalPos.z - ownPos.z;
    return Math.atan2(dx, dz);
}

/**
 * Computes tactical aim yaw: clears wide along the flanks when in the defending
 * danger zone (to eliminate own goals), and aims directly at the attack hoop
 * when in midfield or offensive court.
 * 
 * @param {Object} ownPos - Current position { x, y, z }
 * @param {Object} attackGoalPos - Opponent hoop position { x: 0, y: 10, z: ±40 }
 * @param {Object} defendGoalPos - Own hoop position { x: 0, y: 10, z: ∓40 }
 * @returns {number} Yaw angle in radians
 */
export function computeClearanceAimYaw(ownPos, attackGoalPos, defendGoalPos) {
    const distToDefendZ = Math.abs(ownPos.z - defendGoalPos.z);
    if (distToDefendZ <= 15.0) {
        // DEFENSIVE FLANK CLEARANCE:
        // Clear wide down the sideline into the opponent's corner (|X| >= 8.0m).
        // NEVER aim across the center line (X = 0) near the defending goal mouth.
        const clearX = ownPos.x >= 0 ? Math.max(8.0, ownPos.x + 1.5) : Math.min(-8.0, ownPos.x - 1.5);
        const clearZ = attackGoalPos.z * 0.85;
        const dx = clearX - ownPos.x;
        const dz = clearZ - ownPos.z;
        return Math.atan2(dx, dz);
    }
    // Stream head finish zone: clean aperture piercing
    if (Math.abs(ownPos.z - attackGoalPos.z) <= 12.0 && Math.abs(ownPos.x) >= 6.0) {
        return computeStreamHeadAimYaw(ownPos, attackGoalPos);
    }
    // Offensive shooting range: aim directly at the attack hoop
    return computeGoalAimYaw(ownPos, attackGoalPos);
}

/**
 * Stops all bot movement by zeroing the input slot.
 * 
 * @param {Object} inputSlot - The input slot to zero out
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
 * Evaluates whether the bot should execute a Cut maneuver (KeyV / LB) to plant-and-redirect.
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
