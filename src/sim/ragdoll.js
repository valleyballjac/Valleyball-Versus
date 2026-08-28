import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { Interpolated } from '../core/Interpolated.js';

/**
 * Physics -> pose sync, and the ragdoll's debug skin.
 *
 * This is the PERMANENT render path for the character: the skinned meshes are
 * posed FROM the bodies, never the other way round. Nothing in this file writes
 * to a body, a velocity or a force — it only reads transforms that fixedUpdate
 * has already snapshotted.
 *
 * DIRECTORY RULE (src/sim/): nothing here names a wall-clock or scheduler API.
 *
 * THE AGREEMENT IS THE PROOF. If the derivation in autorig.js is right, the
 * skinned mesh sits inside the wireframe capsules and stays there through the
 * entire flop. If it is wrong — a local-space read, a dropped 0.01, a decomposed
 * bind matrix — the mesh separates from the capsules immediately and obviously.
 * That is the whole reason both are drawn.
 */

/** Chosen so a limb reads as a limb rather than a faceted lozenge. */
const CAP_SEGMENTS = 6;
const RADIAL_SEGMENTS = 12;
const BALL_SEGMENTS = 16;
const BALL_RINGS = 12;

const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

const _bodyWorld = new THREE.Matrix4();
const _desired = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _parentInverse = new THREE.Matrix4();
const _bindBodyInverse = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();

/**
 * Wireframe capsules and balls at each body's derived shape, plus the
 * Interpolated wrapper that carries prev/curr for it.
 *
 * The debug mesh doubles as the interpolation target, so there is exactly one
 * interpolated transform per body rather than a visual copy that can drift out
 * of step with the one the bones read.
 *
 * @param {Map<string, object>} rig
 * @returns {THREE.Group}
 */
export function createRagdollVisuals(rig) {
  const group = new THREE.Group();
  group.name = 'ragdoll-colliders';

  for (const item of rig.values()) {
    const geometry =
      item.shape === 'ball'
        ? new THREE.SphereGeometry(item.radius, BALL_SEGMENTS, BALL_RINGS)
        : new THREE.CapsuleGeometry(item.radius, item.halfHeight * 2, CAP_SEGMENTS, RADIAL_SEGMENTS);

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: item.entry.group === 'torso' ? 0xffc46b : 0x8fd0ff,
        wireframe: true,
        transparent: true,
        opacity: 0.55,
      }),
    );
    mesh.name = `ragdoll-${item.key}`;
    // The capsules are placed by the sync every frame; leaving them in the
    // frustum-cull path would let a body that has flown off screen stop being
    // updated in some renderer configurations.
    mesh.frustumCulled = false;

    const translation = item.body.translation();
    const rotation = item.body.rotation();
    mesh.position.set(translation.x, translation.y, translation.z);
    mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

    item.mesh = mesh;
    item.interpolated = new Interpolated(mesh);

    group.add(mesh);
  }

  return group;
}

/** Frees the debug geometry when the ragdoll is torn down. */
export function disposeRagdollVisuals(group) {
  if (!group) return;
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.dispose();
    object.material.dispose();
  });
  group.removeFromParent();
}

/**
 * curr -> prev for every body. Called at the top of the ragdoll's fixed step,
 * mirroring what Loop does for its own registry — the ragdoll keeps its own
 * copies rather than joining that registry, so that a respawn does not have to
 * reach into the loop's internals to unregister sixteen entries.
 */
export function saveRagdollPrevious(state) {
  if (!state) return;
  for (const item of state.rig.values()) item.interpolated.savePrevious();
}

/** Writes the stepped body transforms into curr. Physics is already advanced. */
export function snapshotRagdoll(state) {
  if (!state) return;
  for (const item of state.rig.values()) {
    const translation = item.body.translation();
    const rotation = item.body.rotation();
    item.interpolated.currPos.set(translation.x, translation.y, translation.z);
    item.interpolated.currQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }
}

/**
 * The deterministic opening nudge, so the drop is a tumble rather than a rigid
 * T-pose belly-flop. A pure world-X torque impulse on the pelvis: one basis
 * direction and one TUNING scalar, so it is identical on every run.
 *
 * Called from inside fixedUpdate, on the step that spawns the ragdoll.
 */
export function applyTumble(state) {
  const pelvis = state.rig.get('pelvis');
  pelvis.body.applyTorqueImpulse({ x: TUNING.ragdoll.tumbleImpulse, y: 0, z: 0 }, true);
}

/**
 * Once-a-second guard against a joint or contact having produced a non-finite
 * transform. A NaN in one body propagates through the joint graph within a
 * handful of steps and then the whole character silently vanishes, so it is
 * worth naming the first body that goes bad.
 *
 * @returns {string | null} the offending key, or null
 */
export function findNonFinite(state) {
  if (!state) return null;
  for (const item of state.rig.values()) {
    const t = item.body.translation();
    const r = item.body.rotation();
    if (
      !Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.z) ||
      !Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.z) || !Number.isFinite(r.w)
    ) {
      return item.key;
    }
  }
  return null;
}

/**
 * DELIVERABLE 3 — pose the skeleton from the bodies.
 *
 * For each mapped bone, in scene-hierarchy order so parents are always solved
 * first:
 *
 *   desiredBoneWorld = interpolatedBodyWorld * inverse(bindBodyWorld) * bindBoneWorld
 *   boneLocal        = inverse(parentDesiredWorld) * desiredBoneWorld
 *
 * `parentDesiredWorld` is the REAL scene parent's world matrix, refreshed from
 * its own ancestors on this pass — not the RigMap parent's. The two differ: the
 * upper arms hang off unmapped clavicles, and the pelvis hangs off the armature
 * root that carries the 0.01 scale. Assuming the RigMap parent is the scene
 * parent puts both arms in the wrong place and drops the scale correction on the
 * pelvis, which is the 100x trap wearing a different hat.
 *
 * Unmapped bones (clavicles, Neck, fingers, toes, the *_End leaves) are never
 * written. They keep their bind locals and are carried along by whichever mapped
 * ancestor moved, which is exactly the desired behaviour.
 *
 * @param {object} state
 * @param {number} alpha in [0, 1)
 */
export function syncRagdollPose(state, alpha) {
  if (!state) return;

  for (const key of state.order) {
    const item = state.rig.get(key);

    // Interpolated body transform. Interpolated.apply writes it onto the debug
    // mesh; reading it back from there keeps the capsules and the bones reading
    // from one number rather than two that can disagree.
    item.interpolated.apply(alpha);
    _bodyWorld.compose(item.mesh.position, item.mesh.quaternion, UNIT_SCALE);

    _bindBodyInverse.copy(item.bindBodyWorld).invert();
    _desired.multiplyMatrices(_bodyWorld, _bindBodyInverse);
    _desired.multiply(item.bindBoneWorld);

    const parent = item.bone.parent;

    // Refresh the ancestor chain from locals. Mapped ancestors already have
    // their new locals from earlier in this loop; unmapped ones still hold bind
    // locals. Either way the result is this parent's world matrix as of now.
    parent.updateWorldMatrix(true, false);

    _parentInverse.copy(parent.matrixWorld).invert();
    _local.multiplyMatrices(_parentInverse, _desired);

    // Decomposed into the bone's own TRS because three drives skinning from
    // those. The scale that comes out is whatever the bind chain implies; it is
    // written through untouched rather than forced to 1.
    _local.decompose(item.bone.position, item.bone.quaternion, item.bone.scale);
    item.bone.updateMatrix();
    item.bone.matrixWorld.multiplyMatrices(parent.matrixWorld, item.bone.matrix);
  }

  // Unmapped descendants — fingers, toes, Neck, the End leaves — inherit from
  // the mapped bones that just moved.
  state.characterRoot.updateMatrixWorld(true);
}

/** Applies the debug/visibility toggles. Init- and GUI-time only. */
export function applyRagdollVisibility(state, characterRoot) {
  if (state && state.group) state.group.visible = TUNING.debug.showRagdollColliders;
  if (characterRoot) characterRoot.visible = TUNING.debug.showCharacterMesh;
}

export { UNIT_SCALE };
