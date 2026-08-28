import * as THREE from 'three';

/**
 * The interpolation contract.
 *
 * Every object whose transform is produced by the simulation renders through
 * this class. Nothing else may write to `object3D.position` or
 * `object3D.quaternion` in the render path.
 *
 * LAW 5, in its sterile form: the simulation writes `currPos` / `currQuat`; the
 * loop snapshots them into `prevPos` / `prevQuat` before each step; rendering
 * only ever reads them. No visual value is ever fed back into a simulation
 * value.
 */
export class Interpolated {
  /** @param {THREE.Object3D} object3D */
  constructor(object3D) {
    this.object3D = object3D;

    // Simulation-owned. Written by fixedUpdate, read by apply().
    this.currPos = new THREE.Vector3().copy(object3D.position);
    this.currQuat = new THREE.Quaternion().copy(object3D.quaternion);

    // Loop-owned snapshot of the previous step.
    this.prevPos = this.currPos.clone();
    this.prevQuat = this.currQuat.clone();
  }

  /** curr -> prev. Called by Loop immediately before every fixed step. */
  savePrevious() {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  /**
   * Render only. Lerps/slerps prev -> curr onto the Object3D.
   *
   * This never mutates currPos or currQuat: `lerpVectors` and
   * `slerpQuaternions` write into the receiver, which is the Object3D's own
   * transform, and read prev/curr as operands.
   *
   * @param {number} alpha in [0, 1)
   */
  apply(alpha) {
    this.object3D.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.object3D.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
  }

  /**
   * Teleport. Sets curr AND prev, so the next render has nothing to interpolate
   * across and the object does not streak over the arena for one frame.
   *
   * Simulation-side only — a respawn is a simulation event, never a render one.
   *
   * @param {THREE.Vector3} position
   * @param {THREE.Quaternion} [quaternion]
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
