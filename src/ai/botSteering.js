import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';

// Pre-allocate scratch vectors for deterministic math (Rule 6)
const scratchDir = new THREE.Vector3();

/**
 * Steers the bot toward a target position in world space.
 * 
 * @param {Object} inputSlot - The input slot to write synthetic input to
 * @param {Object} currentPos - Current position { x, y, z }
 * @param {Object} targetPos - Desired target position { x, y, z }
 * @param {Object} options - { sprint, arriveRadius, maxSpeed }
 */
export function steerToward(inputSlot, currentPos, targetPos, options = {}) {
    const sprint = options.sprint ?? false;
    const arriveRadius = options.arriveRadius ?? 1.0;
    const maxSpeed = options.maxSpeed ?? 1.0;

    // Compute direction vector in XZ plane, ignore Y
    scratchDir.set(targetPos.x - currentPos.x, 0, targetPos.z - currentPos.z);
    
    const distance = scratchDir.length();
    
    if (distance < arriveRadius * 0.2) {
        inputSlot.moveWorld.set(0, 0, 0);
        inputSlot.moveX = 0;
        inputSlot.moveZ = 0;
        inputSlot.sprintHeld = false;
        return;
    }

    // Normalize
    scratchDir.divideScalar(distance);

    let magnitude = maxSpeed;
    if (distance < arriveRadius) {
        // Scale down magnitude smoothly for arrive behavior
        magnitude *= (distance / arriveRadius);
    }

    scratchDir.multiplyScalar(magnitude);

    inputSlot.moveWorld.copy(scratchDir);
    inputSlot.moveX = scratchDir.x;
    inputSlot.moveZ = scratchDir.z;

    inputSlot.sprintHeld = sprint && (distance > arriveRadius * 2);
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
