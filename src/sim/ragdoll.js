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
/**
 * Visual palette and styling for the Capsule Athlete.
 */
function getAthleteColors() {
  const p = TUNING.athlete?.palette || {
    homePrimary: 0xd90429,
    awayPrimary: 0x1d4ed8,
    bodyGrey: 0x383b42,
    jointGrey: 0x22242a,
    awayBody: 0xffffff,
    awayJoint: 0xd0d5dd,
    roughness: 0.82,
    metalness: 0.04,
  };
  const isHome = TUNING.athlete?.team !== 'away';
  return {
    primary: isHome ? p.homePrimary : p.awayPrimary,
    bodyGrey: isHome ? (p.bodyGrey ?? 0x383b42) : (p.awayBody ?? 0xffffff),
    jointGrey: isHome ? (p.jointGrey ?? 0x22242a) : (p.awayJoint ?? 0xd0d5dd),
    roughness: p.roughness ?? 0.82,
    metalness: p.metalness ?? 0.04,
  };
}

/**
 * Generates an authentic old-style curved baseball cap visor geometry.
 * Curves seamlessly from the crown rim with downward curl at temples and downward rake.
 */
function createCurvedBaseballVisorGeo(radius, crownRadius, phiRim, thetaMax = Math.PI * 0.38, billLength = null, thickness = null) {
  const L0 = billLength ?? (radius * 0.68);
  const thick = thickness ?? (radius * 0.035);
  const pitch = 0.26; // ~15 deg downward slope
  const curl = radius * 0.10; // classic downward curl at sides

  const yRim = crownRadius * Math.cos(phiRim);
  const rRim = crownRadius * Math.sin(phiRim);

  const uSteps = 24;
  const tSteps = 12;
  const positions = [];
  const indices = [];

  function getPoint(u, tNorm, layer) {
    const theta = u * thetaMax;
    const profile = Math.max(0, Math.cos(u * Math.PI * 0.5));

    // Base point on rim circle
    const bx = rRim * Math.sin(theta);
    const bz = -rRim * Math.cos(theta);
    const by = yRim;

    let x, y, z;
    if (tNorm <= 0) {
      // Penetrate slightly inside the crown to ensure seamless union
      x = bx * 0.96;
      z = bz * 0.96;
      y = by + (layer === 'top' ? thick * 0.5 : -thick * 0.5);
    } else {
      const Lt = L0 * Math.pow(profile, 0.72) * tNorm;
      const dirX = Math.sin(theta * 0.70);
      const dirZ = -Math.cos(theta * 0.70);
      x = bx + dirX * Lt * Math.cos(pitch);
      z = bz + dirZ * Lt * Math.cos(pitch);
      const yCurl = -curl * (u * u) * tNorm;
      const yPitch = -Lt * Math.sin(pitch);
      const yOffset = layer === 'top' ? thick * 0.5 : -thick * 0.5;
      y = by + yPitch + yCurl + yOffset;
    }
    return [x, y, z];
  }

  // Top surface grid
  const topStart = 0;
  for (let j = 0; j <= tSteps; j++) {
    const tNorm = j === 0 ? -0.15 : j / tSteps;
    for (let i = 0; i <= uSteps; i++) {
      const u = (i / uSteps) * 2 - 1;
      const [x, y, z] = getPoint(u, tNorm, 'top');
      positions.push(x, y, z);
    }
  }

  // Bottom surface grid
  const bottomStart = positions.length / 3;
  for (let j = 0; j <= tSteps; j++) {
    const tNorm = j === 0 ? -0.15 : j / tSteps;
    for (let i = 0; i <= uSteps; i++) {
      const u = (i / uSteps) * 2 - 1;
      const [x, y, z] = getPoint(u, tNorm, 'bottom');
      positions.push(x, y, z);
    }
  }

  const rowLen = uSteps + 1;
  // Top indices (facing up)
  for (let j = 0; j < tSteps; j++) {
    for (let i = 0; i < uSteps; i++) {
      const a = topStart + j * rowLen + i;
      const b = a + 1;
      const c = a + rowLen;
      const d = c + 1;
      indices.push(a, d, b);
      indices.push(a, c, d);
    }
  }
  // Bottom indices (facing down)
  for (let j = 0; j < tSteps; j++) {
    for (let i = 0; i < uSteps; i++) {
      const a = bottomStart + j * rowLen + i;
      const b = a + 1;
      const c = a + rowLen;
      const d = c + 1;
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }
  // Outer rim skirt (j = tSteps)
  for (let i = 0; i < uSteps; i++) {
    const topIdx = topStart + tSteps * rowLen + i;
    const botIdx = bottomStart + tSteps * rowLen + i;
    indices.push(topIdx, topIdx + 1, botIdx + 1);
    indices.push(topIdx, botIdx + 1, botIdx);
  }
  // Inner rim skirt (j = 0)
  for (let i = 0; i < uSteps; i++) {
    const topIdx = topStart + i;
    const botIdx = bottomStart + i;
    indices.push(topIdx, botIdx + 1, topIdx + 1);
    indices.push(topIdx, botIdx, botIdx + 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds the solid PBR Capsule Athlete component for a single physical body.
 */
function createSolidAthletePart(item, colors) {
  const solidGroup = new THREE.Group();
  solidGroup.name = `solid-${item.key}`;

  const { key, shape, radius, halfHeight } = item;

  // 1. HEAD
  if (key === 'head') {
    // Head Sphere - Flat Matte Grey
    const headGeo = new THREE.SphereGeometry(radius, 32, 24);
    const headMat = new THREE.MeshStandardMaterial({
      color: colors.bodyGrey,
      roughness: colors.roughness,
      metalness: colors.metalness,
    });
    headMat.userData.colorRole = 'bodyGrey';
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.castShadow = true;
    headMesh.receiveShadow = true;
    solidGroup.add(headMesh);

    // 2. ATHLETIC BASEBALL CAP (in Team Primary Color)
    // Sits naturally on the upper 1/3 of the skull with an authentic curved brim.
    const crownRadius = radius * 1.03;
    const phiRim = Math.PI * 0.36; // covers upper ~1/3 of head dome down to high brow
    const capMat = new THREE.MeshStandardMaterial({
      color: colors.primary,
      roughness: 0.65,
      metalness: 0.05,
    });
    capMat.userData.colorRole = 'primary';

    const buttonMat = new THREE.MeshStandardMaterial({
      color: colors.jointGrey,
      roughness: 0.85,
      metalness: 0.05,
    });
    buttonMat.userData.colorRole = 'joint';

    // Unified cap group with subtle athletic backward tilt so the brow remains clear
    const capGroup = new THREE.Group();
    capGroup.name = 'athletic-cap';
    capGroup.position.set(0, radius * 0.02, 0);
    capGroup.rotation.x = 0.06;

    // Cap crown dome (for baseball cap)
    const crownGeo = new THREE.SphereGeometry(crownRadius, 32, 16, 0, Math.PI * 2, 0, phiRim);
    const crownMesh = new THREE.Mesh(crownGeo, capMat);
    crownMesh.name = 'cap-crown';
    crownMesh.castShadow = true;
    capGroup.add(crownMesh);

    // Open-top sports visor headband (for feminine visor)
    const phiBandStart = phiRim * 0.60;
    const phiBandLength = phiRim * 0.40;
    const bandGeo = new THREE.SphereGeometry(crownRadius, 32, 10, 0, Math.PI * 2, phiBandStart, phiBandLength);
    const bandMesh = new THREE.Mesh(bandGeo, capMat);
    bandMesh.name = 'visor-band';
    bandMesh.visible = false;
    bandMesh.castShadow = true;
    capGroup.add(bandMesh);

    // Curved visor bill (seamlessly fused to rim, shared by cap and visor)
    const visorGeo = createCurvedBaseballVisorGeo(radius, crownRadius, phiRim, Math.PI * 0.38, radius * 0.68, radius * 0.035);
    const visorMesh = new THREE.Mesh(visorGeo, capMat);
    visorMesh.name = 'cap-bill';
    visorMesh.castShadow = true;
    capGroup.add(visorMesh);

    // Top cap squatchee (button, hidden on visor)
    const buttonGeo = new THREE.CylinderGeometry(radius * 0.08, radius * 0.08, radius * 0.03, 16);
    const buttonMesh = new THREE.Mesh(buttonGeo, buttonMat);
    buttonMesh.name = 'cap-button';
    buttonMesh.position.set(0, crownRadius * 1.008, 0);
    buttonMesh.castShadow = true;
    capGroup.add(buttonMesh);

    // Back strap accent (local +Z = Back)
    const strapGeo = new THREE.CylinderGeometry(radius * 0.20, radius * 0.20, radius * 0.035, 12);
    const strapMesh = new THREE.Mesh(strapGeo, buttonMat);
    strapMesh.name = 'cap-strap';
    strapMesh.position.set(0, crownRadius * Math.cos(phiRim) * 0.95, crownRadius * Math.sin(phiRim) * 0.98);
    strapMesh.rotation.x = Math.PI / 2 + 0.12;
    capGroup.add(strapMesh);

    solidGroup.add(capGroup);
    return solidGroup;
  }

  // 2. CLUB HANDS (handL, handR)
  if (key === 'handL' || key === 'handR') {
    // Heavy striking club head in Team Primary color
    const clubHeight = Math.max(radius * 0.6, halfHeight * 2);
    const clubGeo = new THREE.CapsuleGeometry(radius, clubHeight, 16, 20);
    const clubMat = new THREE.MeshStandardMaterial({
      color: colors.primary,
      roughness: 0.6,
      metalness: 0.06,
    });
    clubMat.userData.colorRole = 'primary';
    const clubMesh = new THREE.Mesh(clubGeo, clubMat);
    clubMesh.castShadow = true;
    clubMesh.receiveShadow = true;
    solidGroup.add(clubMesh);

    // Wrist cuff accent in dark matte graphite
    const cuffGeo = new THREE.CylinderGeometry(radius * 0.95, radius * 0.95, radius * 0.32, 16);
    const cuffMat = new THREE.MeshStandardMaterial({
      color: colors.jointGrey,
      roughness: 0.85,
      metalness: 0.05,
    });
    cuffMat.userData.colorRole = 'joint';
    const cuff = new THREE.Mesh(cuffGeo, cuffMat);
    cuff.position.set(0, halfHeight > 0 ? halfHeight * 0.75 : radius * 0.4, 0);
    cuff.castShadow = true;
    solidGroup.add(cuff);

    return solidGroup;
  }

  // 3. FLATTER CAPSULE FOOTWEAR (footL, footR)
  if (key === 'footL' || key === 'footR') {
    // Pure capsule foot in team primary color, flattened along vertical Z axis.
    // Preserves the iconic Capsule Athlete aesthetic while providing a sleek, sporty, low-profile stance.
    const footMat = new THREE.MeshStandardMaterial({
      color: colors.primary,
      roughness: 0.65,
      metalness: 0.06,
    });
    footMat.userData.colorRole = 'primary';

    const footGeo = new THREE.CapsuleGeometry(radius, halfHeight * 2, 16, 24);
    const footMesh = new THREE.Mesh(footGeo, footMat);
    // Scaled for a sleek, compact athletic foot: slightly shrunk (0.80, 0.88, 0.50)
    footMesh.scale.set(0.80, 0.88, 0.50);
    // Shift forward along +Y by halfHeight * 0.45 so the heel sits naturally under the leg
    // and eliminates heavy rear clipping with the calf from third-person chase camera view.
    footMesh.position.set(0, halfHeight * 0.45, 0);
    footMesh.castShadow = true;
    footMesh.receiveShadow = true;
    solidGroup.add(footMesh);

    return solidGroup;
  }

  // 4. ALL OTHER BODY SEGMENTS (chest, spine, pelvis, upperArmL/R, foreArmL/R, thighL/R, calfL/R)
  // Uniform flat matte athletic grey
  const bodyGeo = shape === 'ball'
    ? new THREE.SphereGeometry(radius, 24, 18)
    : new THREE.CapsuleGeometry(radius, halfHeight * 2, 12, 24);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: colors.bodyGrey,
    roughness: colors.roughness,
    metalness: colors.metalness,
  });
  bodyMat.userData.colorRole = 'bodyGrey';
  const mainMesh = new THREE.Mesh(bodyGeo, bodyMat);
  mainMesh.castShadow = true;
  mainMesh.receiveShadow = true;
  solidGroup.add(mainMesh);

  // Subtle dark matte graphite connector spheres at limb joints (proximal joint, +Y)
  if (['upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'thighL', 'thighR', 'calfL', 'calfR'].includes(key)) {
    const jointGeo = new THREE.SphereGeometry(radius * 0.98, 16, 12);
    const jointMat = new THREE.MeshStandardMaterial({
      color: colors.jointGrey,
      roughness: 0.85,
      metalness: 0.05,
    });
    jointMat.userData.colorRole = 'joint';
    const jointMesh = new THREE.Mesh(jointGeo, jointMat);
    jointMesh.position.set(0, halfHeight, 0);
    jointMesh.castShadow = true;
    solidGroup.add(jointMesh);
  }

  // NOTE: All chest badges, torso indicators, and neon stripes completely omitted per user request.
  return solidGroup;
}

/**
 * Creates the Capsule Athlete visual hierarchy: solid PBR mannequin plus
 * optional debug wireframes, wrapped in an Interpolated per body.
 *
 * @param {Map<string, object>} rig
 * @returns {THREE.Group}
 */
export function createRagdollVisuals(rig) {
  const group = new THREE.Group();
  group.name = 'ragdoll-visuals';
  const colors = getAthleteColors();

  for (const item of rig.values()) {
    const bodyGroup = new THREE.Group();
    bodyGroup.name = `athlete-body-${item.key}`;
    bodyGroup.frustumCulled = false;

    // 1. Solid stylized Capsule Athlete part
    const solidMesh = createSolidAthletePart(item, colors);
    solidMesh.visible = TUNING.debug.showCapsuleAthlete !== false;
    bodyGroup.add(solidMesh);
    item.solidMesh = solidMesh;

    // 2. Debug wireframe mesh (hidden by default)
    const wireGeo =
      item.shape === 'ball'
        ? new THREE.SphereGeometry(item.radius, BALL_SEGMENTS, BALL_RINGS)
        : new THREE.CapsuleGeometry(item.radius, item.halfHeight * 2, CAP_SEGMENTS, RADIAL_SEGMENTS);

    const wireMesh = new THREE.Mesh(
      wireGeo,
      new THREE.MeshBasicMaterial({
        color: item.entry.group === 'torso' ? 0xffc46b : 0x8fd0ff,
        wireframe: true,
        transparent: true,
        opacity: 0.55,
      }),
    );
    wireMesh.name = `ragdoll-wire-${item.key}`;
    wireMesh.frustumCulled = false;
    wireMesh.visible = !!TUNING.debug.showRagdollColliders;
    bodyGroup.add(wireMesh);
    item.wireMesh = wireMesh;

    const translation = item.body.translation();
    const rotation = item.body.rotation();
    bodyGroup.position.set(translation.x, translation.y, translation.z);
    bodyGroup.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

    item.mesh = bodyGroup;
    item.interpolated = new Interpolated(bodyGroup);

    group.add(bodyGroup);
  }

  updateAthleteVariant({ rig });

  return group;
}

/** Frees all athlete geometries and materials when the ragdoll is torn down. */
export function disposeRagdollVisuals(group) {
  if (!group) return;
  group.traverse((object) => {
    if (!object.isMesh) return;
    if (object.geometry) object.geometry.dispose();
    if (Array.isArray(object.material)) {
      object.material.forEach((m) => m.dispose());
    } else if (object.material) {
      object.material.dispose();
    }
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

/**
 * Creates an athletic ponytail mesh anchored through the rear of the open-top visor / cap arch.
 * Features a team-colored hair tie and five smooth flowing segments.
 */
function createPonytailGroup(radius, colors) {
  const ponyGroup = new THREE.Group();
  ponyGroup.name = 'athlete-ponytail';

  // Hair tie band at the top/rear open arch of the visor
  const bandGeo = new THREE.TorusGeometry(0.020, 0.007, 12, 24);
  const bandMat = new THREE.MeshStandardMaterial({
    color: colors.primary,
    roughness: 0.5,
    metalness: 0.1,
  });
  bandMat.userData.colorRole = 'primary';
  const bandMesh = new THREE.Mesh(bandGeo, bandMat);
  bandMesh.position.set(0, radius * 0.48, radius * 0.82);
  bandMesh.rotation.x = Math.PI * 0.36;
  bandMesh.castShadow = true;
  ponyGroup.add(bandMesh);

  // Flowing ponytail curve in natural athletic dark graphite
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x24272e,
    roughness: 0.85,
    metalness: 0.05,
  });
  hairMat.userData.colorRole = 'hair';

  // 5 smooth tapered segments cascading gracefully down the back of head and neck
  const p1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.05, 12, 16), hairMat);
  p1.position.set(0, radius * 0.44, radius * 0.96);
  p1.rotation.x = Math.PI * 0.42;
  p1.castShadow = true;
  ponyGroup.add(p1);

  const p2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.07, 12, 16), hairMat);
  p2.position.set(0, radius * 0.28, radius * 1.08);
  p2.rotation.x = Math.PI * 0.26;
  p2.castShadow = true;
  ponyGroup.add(p2);

  const p3 = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.08, 12, 16), hairMat);
  p3.position.set(0, radius * 0.06, radius * 1.12);
  p3.rotation.x = 0.02;
  p3.castShadow = true;
  ponyGroup.add(p3);

  const p4 = new THREE.Mesh(new THREE.CapsuleGeometry(0.010, 0.07, 12, 16), hairMat);
  p4.position.set(0, -radius * 0.14, radius * 1.10);
  p4.rotation.x = -Math.PI * 0.10;
  p4.castShadow = true;
  ponyGroup.add(p4);

  const p5 = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.08, 12, 16), hairMat);
  p5.position.set(0, -radius * 0.32, radius * 1.05);
  p5.rotation.x = -Math.PI * 0.08;
  p5.castShadow = true;
  ponyGroup.add(p5);

  return ponyGroup;
}

/**
 * Updates athlete body silhouette proportions and hairstyles according to TUNING.athlete.variant.
 * Options:
 * - 'masculine': Athletic V-Taper (enlarged chest intersecting shoulders, tapered waist spine, standard pelvis)
 * - 'feminine': Athletic Feminine (open-top sports visor, compact chest & hips, slender waist, sleeker limbs, shorter stance, ponytail)
 * - 'classic': Original 1:1:1 unscaled capsule athlete
 */
export function updateAthleteVariant(state) {
  if (!state || !state.rig) return;
  const variant = TUNING.athlete.variant ?? 'masculine';
  const colors = getAthleteColors();

  const pelvis = state.rig.get('pelvis');
  const spine = state.rig.get('spine');
  const chest = state.rig.get('chest');
  const head = state.rig.get('head');

  // Reset all part scales and offsets to default 1, 1, 1 and (0,0,0)
  for (const item of state.rig.values()) {
    if (item.solidMesh) {
      item.solidMesh.scale.set(1, 1, 1);
      item.solidMesh.position.set(0, 0, 0);
    }
  }
  const footL = state.rig.get('footL');
  const footR = state.rig.get('footR');
  if (footL?.solidMesh) {
    footL.solidMesh.scale.set(0.76, 0.84, 0.48);
    footL.solidMesh.position.set(0, footL.halfHeight * 0.45, 0);
  }
  if (footR?.solidMesh) {
    footR.solidMesh.scale.set(0.76, 0.84, 0.48);
    footR.solidMesh.position.set(0, footR.halfHeight * 0.45, 0);
  }

  // Headwear controls (baseball cap vs open-top sports visor)
  if (head?.solidMesh) {
    const crown = head.solidMesh.getObjectByName('cap-crown');
    const button = head.solidMesh.getObjectByName('cap-button');
    const band = head.solidMesh.getObjectByName('visor-band');
    const oldPony = head.solidMesh.getObjectByName('athlete-ponytail');
    if (oldPony) {
      oldPony.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      head.solidMesh.remove(oldPony);
    }

    if (variant === 'feminine') {
      // Cut off the top of the hat and transform into an athletic open-top visor!
      if (crown) crown.visible = false;
      if (button) button.visible = false;
      if (band) band.visible = true;
      const ponyGroup = createPonytailGroup(head.radius, colors);
      head.solidMesh.add(ponyGroup);
    } else {
      // Standard baseball cap dome
      if (crown) crown.visible = true;
      if (button) button.visible = true;
      if (band) band.visible = false;
    }
  }

  const limbKeys = ['upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'thighL', 'thighR', 'calfL', 'calfR'];
  const handKeys = ['handL', 'handR'];

  if (variant === 'masculine') {
    // ATHLETIC V-TAPER (Masculine / Heroic):
    // Large chest sphere intersecting shoulders like hips intersect legs
    if (chest?.solidMesh) chest.solidMesh.scale.set(1.50, 1.30, 1.50);
    // Tapered waist
    if (spine?.solidMesh) spine.solidMesh.scale.set(0.75, 0.85, 0.75);
    // Pelvis anchor
    if (pelvis?.solidMesh) pelvis.solidMesh.scale.set(1.0, 1.0, 1.0);
  } else if (variant === 'feminine') {
    // ATHLETIC FEMININE v2:
    // Smaller compact chest sphere
    if (chest?.solidMesh) {
      chest.solidMesh.scale.set(0.96, 0.90, 0.92);
      chest.solidMesh.position.set(0, -0.055, 0);
    }
    // Slender athletic waist
    if (spine?.solidMesh) {
      spine.solidMesh.scale.set(0.60, 0.74, 0.60);
      spine.solidMesh.position.set(0, -0.035, 0);
    }
    // Petite lower torso sphere (tapered hips without bulky bulge)
    if (pelvis?.solidMesh) {
      pelvis.solidMesh.scale.set(1.02, 0.86, 0.86);
      pelvis.solidMesh.position.set(0, -0.015, 0);
    }
    // Slightly more petite head and slightly shorter athletic stance
    if (head?.solidMesh) {
      head.solidMesh.scale.set(0.92, 0.92, 0.92);
      head.solidMesh.position.set(0, -0.070, 0);
    }
    // Sleeker limbs slightly shortened along Y
    for (const k of limbKeys) {
      const part = state.rig.get(k);
      if (part?.solidMesh) part.solidMesh.scale.set(0.78, 0.94, 0.78);
    }
    // Refined hands
    for (const k of handKeys) {
      const part = state.rig.get(k);
      if (part?.solidMesh) part.solidMesh.scale.set(0.80, 0.80, 0.80);
    }
  }
}

/**
 * Updates live material colors when the team palette changes.
 */
export function updateAthletePalette(state) {
  if (!state || !state.rig) return;
  updateAthleteVariant(state);
  const colors = getAthleteColors();
  for (const item of state.rig.values()) {
    if (!item.solidMesh) continue;
    item.solidMesh.traverse((child) => {
      if (child.isMesh && child.material && child.material.userData && child.material.userData.colorRole) {
        const role = child.material.userData.colorRole;
        if (role === 'primary') {
          child.material.color.setHex(colors.primary);
        } else if (role === 'bodyGrey') {
          child.material.color.setHex(colors.bodyGrey);
        } else if (role === 'joint') {
          child.material.color.setHex(colors.jointGrey);
        } else if (role === 'hair') {
          child.material.color.setHex(0x24272e);
        } else if (role === 'visor') {
          child.material.color.setHex(colors.primary);
          child.material.emissive.setHex(colors.primary);
          child.material.emissiveIntensity = 0.6;
        }
      }
    });
  }
}

/** Applies the athlete and debug visibility toggles. Init- and GUI-time only. */
export function applyRagdollVisibility(state, characterRoot) {
  if (state && state.rig) {
    const showAthlete = TUNING.debug.showCapsuleAthlete !== false;
    const showWire = !!TUNING.debug.showRagdollColliders;
    for (const item of state.rig.values()) {
      if (item.solidMesh) item.solidMesh.visible = showAthlete;
      if (item.wireMesh) item.wireMesh.visible = showWire;
    }
    if (state.group) state.group.visible = showAthlete || showWire;
  }
  if (characterRoot) characterRoot.visible = !!TUNING.debug.showCharacterMesh;
}

export { UNIT_SCALE };
