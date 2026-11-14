/**
 * ============================================================================
 * MODULE: src/core/Interpolated.js
 * ============================================================================
 * ROLE:
 *   Decouples 60 Hz deterministic simulation transforms from arbitrary-refresh
 *   (60 Hz / 144 Hz / 165 Hz / 240 Hz+) Three.js rendering.
 *
 * FRAME PHASE:
 *   - `savePrevious()`: Called by `Loop` immediately before each 60 Hz `fixedUpdate`.
 *   - `currPos` / `currQuat`: Written by simulation (`fixedUpdate`) at the end of a tick.
 *   - `apply(alpha)`: Called during `render(alpha)` to slerp/lerp `prev -> curr`
 *     onto the visual `THREE.Object3D`.
 *
 * ARCHITECTURAL INVARIANTS:
 *   - Law 5 / Law 6 (Simulation-Render Separation): Rendering only ever reads
 *     `prevPos`/`currPos` and `prevQuat`/`currQuat`. Visual values never feed
 *     back into simulation state.
 *   - Zero Heap Allocation: All vectors and quaternions are allocated once in
 *     the constructor and mutated in place.
 * ============================================================================
 */

import * as THREE from 'three';

export class Interpolated {
  /** @param {THREE.Object3D} object3D Visual scene node owned by this wrapper. */
  constructor(object3D) {
    this.object3D = object3D;

    // Simulation-owned state for the latest completed 60 Hz tick.
    this.currPos = new THREE.Vector3().copy(object3D.position);
    this.currQuat = new THREE.Quaternion().copy(object3D.quaternion);

    // Loop-owned snapshot of the preceding 60 Hz tick.
    this.prevPos = this.currPos.clone();
    this.prevQuat = this.currQuat.clone();
  }

  /** Copies `curr -> prev`. Invoked by `Loop` immediately before each fixed step. */
  savePrevious() {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  /**
   * Render-only transform interpolation (`prev -> curr` by `alpha` in `[0, 1)`).
   * Writes directly into `this.object3D.position` and `this.object3D.quaternion`
   * without mutating `currPos` or `currQuat`.
   *
   * @param {number} alpha Fractional tick remainder in `[0, 1)`.
   */
  apply(alpha) {
    this.object3D.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.object3D.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
  }

  /**
   * Instantaneous teleport/respawn reset. Snaps both `curr` and `prev` to the
   * target transform so the next render frame does not streak across the court.
   *
   * @param {THREE.Vector3|{x:number,y:number,z:number}} position World position (m).
   * @param {THREE.Quaternion|{x:number,y:number,z:number,w:number}} [quaternion] World rotation.
   */
  reset(position, quaternion) {
    this.currPos.copy(position);
    this.prevPos.copy(position);

    if (quaternion) {
      this.currQuat.copy(quaternion);
      this.prevQuat.copy(quaternion);
    }
  }
}
