import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { Interpolated } from '../core/Interpolated.js';
import { RAPIER, getWorld, RAGDOLL_GROUPS, MOTOR_GROUPS } from './physics.js';

/**
 * The Auto-Rigger.
 *
 * DERIVATION OVER AUTHORING. The only authored things in this file are the
 * BONE_MAP table below and the ratios it reads out of TUNING. There is not a
 * single position, size or transform literal anywhere else — every number that
 * reaches Rapier is measured off the skeleton at bind pose, in WORLD space.
 *
 * DIRECTORY RULE (src/sim/): nothing here names a wall-clock or scheduler API.
 *
 * THE SCALE TRAP. The armature root carries a 0.01 uniform scale (the rig is
 * authored in centimetres). Every geometric quantity in this file therefore
 * comes from getWorldPosition() or matrixWorld — never from a bone's local
 * .position. A local-space rigger silently builds a 100x oversized ragdoll that
 * looks plausible in the console and absurd on screen. The bind matrices this
 * module exports are stored as full Matrix4s and are never decomposed on the
 * assumption of unit scale: they legitimately contain that 0.01.
 *
 * LAW L1: this ragdoll owns no locomotion momentum. Nothing here reads input.
 * LAW L3: no damping setter is called, and none is named, anywhere in this file.
 * LAW L6: every body gets .setCanSleep(false).
 */

/** The skeleton contract. A file that does not satisfy this is not our asset. */
const EXPECTED_JOINT_COUNT = 65;

/**
 * THE AUTHORED CONTRACT — the only table in the project that names a bone.
 *
 * `end` is EXPLICIT on every entry. A "first child" heuristic is not merely
 * fragile here, it is wrong: mixamorig:Hips has three children (Spine,
 * LeftUpLeg, RightUpLeg) and whichever one the exporter happened to write first
 * would silently become the pelvis segment.
 *
 * REVOLUTE AXES ARE AUTHORED, NOT DERIVED, and that is a property of this rig
 * rather than a shortcut. The usual derivation — cross product of the two
 * adjacent segment directions — needs those segments to be non-collinear. In a
 * T-pose the upper arm and forearm lie along the same line, and so do the thigh
 * and calf, so the cross product is the zero vector at every elbow and knee by
 * construction. The axes below are world-space directions at bind pose.
 *
 * If a hinge bends the wrong way in the drop test, flip the sign in THIS TABLE.
 * Never in the code that reads it.
 */
export const BONE_MAP = [
  { key: 'pelvis',    bone: 'mixamorig:Hips',         end: 'mixamorig:Spine',              parent: null,        shape: 'capsule', group: 'torso',     joint: null,        axis: null,       limits: null },
  { key: 'spine',     bone: 'mixamorig:Spine',        end: 'mixamorig:Spine2',             parent: 'pelvis',    shape: 'capsule', group: 'torso',     joint: 'spherical', axis: null,       limits: null },
  { key: 'chest',     bone: 'mixamorig:Spine2',       end: 'mixamorig:Neck',               parent: 'spine',     shape: 'capsule', group: 'torso',     joint: 'spherical', axis: null,       limits: null },
  { key: 'head',      bone: 'mixamorig:Head',         end: 'mixamorig:HeadTop_End',        parent: 'chest',     shape: 'ball',    group: 'head',      joint: 'spherical', axis: null,       limits: null },

  { key: 'upperArmL', bone: 'mixamorig:LeftArm',      end: 'mixamorig:LeftForeArm',        parent: 'chest',     shape: 'capsule', group: 'limb',      joint: 'spherical', axis: null,       limits: null },
  { key: 'foreArmL',  bone: 'mixamorig:LeftForeArm',  end: 'mixamorig:LeftHand',           parent: 'upperArmL', shape: 'capsule', group: 'limb',      joint: 'revolute',  axis: [0, -1, 0], limits: 'elbow' },
  { key: 'handL',     bone: 'mixamorig:LeftHand',     end: 'mixamorig:LeftHandMiddle1',    parent: 'foreArmL',  shape: 'capsule', group: 'extremity', joint: 'spherical', axis: null,       limits: null },

  { key: 'upperArmR', bone: 'mixamorig:RightArm',     end: 'mixamorig:RightForeArm',       parent: 'chest',     shape: 'capsule', group: 'limb',      joint: 'spherical', axis: null,       limits: null },
  { key: 'foreArmR',  bone: 'mixamorig:RightForeArm', end: 'mixamorig:RightHand',          parent: 'upperArmR', shape: 'capsule', group: 'limb',      joint: 'revolute',  axis: [0, 1, 0],  limits: 'elbow' },
  { key: 'handR',     bone: 'mixamorig:RightHand',    end: 'mixamorig:RightHandMiddle1',   parent: 'foreArmR',  shape: 'capsule', group: 'extremity', joint: 'spherical', axis: null,       limits: null },

  { key: 'thighL',    bone: 'mixamorig:LeftUpLeg',    end: 'mixamorig:LeftLeg',            parent: 'pelvis',    shape: 'capsule', group: 'limb',      joint: 'spherical', axis: null,       limits: null },
  { key: 'calfL',     bone: 'mixamorig:LeftLeg',      end: 'mixamorig:LeftFoot',           parent: 'thighL',    shape: 'capsule', group: 'limb',      joint: 'revolute',  axis: [1, 0, 0],  limits: 'knee' },
  { key: 'footL',     bone: 'mixamorig:LeftFoot',     end: 'mixamorig:LeftToeBase',        parent: 'calfL',     shape: 'capsule', group: 'extremity', joint: 'universal', axis: [0, -1, 0], limits: null     },

  { key: 'thighR',    bone: 'mixamorig:RightUpLeg',   end: 'mixamorig:RightLeg',           parent: 'pelvis',    shape: 'capsule', group: 'limb',      joint: 'spherical', axis: null,       limits: null },
  { key: 'calfR',     bone: 'mixamorig:RightLeg',     end: 'mixamorig:RightFoot',          parent: 'thighR',    shape: 'capsule', group: 'limb',      joint: 'revolute',  axis: [1, 0, 0],  limits: 'knee' },
  { key: 'footR',     bone: 'mixamorig:RightFoot',    end: 'mixamorig:RightToeBase',       parent: 'calfR',     shape: 'capsule', group: 'extremity', joint: 'universal', axis: [0, -1, 0], limits: null     },
];

/**
 * The bone the character height is measured DOWN from. Named here rather than
 * inlined at the measurement site so every bone name in the project lives in
 * this file.
 */
const HEIGHT_TOP_BONE = 'mixamorig:HeadTop_End';

/**
 * ═══ THIS ASSET'S "Left" IS THE ATHLETE'S RIGHT ═══
 *
 * The character faces +Z and the bone named `mixamorig:LeftHand` sits at
 * x = +0.7378 — the +X side. For anyone facing +Z in a Y-up right-handed space,
 * `up × forward = (1, 0, 0)`, so +X IS their right (face north, east is on your
 * right). The bones named Left are therefore on the body's RIGHT, and the ones
 * named Right on its LEFT. The clips inherit it: `Standing Spike Left` and
 * `Idle Low Kick Left` both drive the `Left`-named bones, so they swing the
 * limb the player sees on the athlete's right.
 *
 * MEASURED TWICE, ANATOMICALLY, so the facing does not rest on a convention:
 *   - `LeftToeBase - LeftFoot` = (0.027, 0, 1.000). Toes are in front of ankles.
 *   - Both thumbs sit at z +0.009 against pinkies at z -0.109. Mixamo's T-pose
 *     is palms-down — the thumb-to-pinky spread lying along Z confirms it — and
 *     palms-down with the arms out puts BOTH thumbs forward.
 * Both say forward is +Z, independently of any bone's name.
 *
 * FOUND BY: the designer reporting that strikes played the wrong side, with the
 * side maths verified correct at every step. The geometry said "ball on the
 * right", the recorded side said +1, and +1 selected the clip named Right,
 * which swings the limb on the left.
 *
 * THE TRAP THIS LEAVES, and why the two helpers below both exist rather than
 * one flip at the clip: `sideAgreement` maps a contact's rig key back to a side.
 * Flipping only the clip selection would leave that mapping using the asset's
 * naming, so a chosen +1 and a contacting `footR` would agree with each other
 * and disagree with the screen — a metric reporting 100% while the animation is
 * visibly backwards. Both directions of the translation go through here.
 *
 * If the asset is ever re-exported unmirrored, this is the one line to change,
 * and the readouts below will say so.
 */
export const SIDE_NAMES_MIRRORED = true;

/**
 * A body side (+1 right, -1 left) → the rig/clip suffix that limb is named with.
 *
 * @param {number} side +1 the athlete's right, -1 his left
 * @returns {'L'|'R'}
 */
export function rigSuffixForBodySide(side) {
  const wantRight = side >= 0;
  return (SIDE_NAMES_MIRRORED ? !wantRight : wantRight) ? 'R' : 'L';
}

/**
 * A rig key (`handL`, `footR`, …) → the side of the BODY that limb is on.
 *
 * The inverse of `rigSuffixForBodySide`, and the reason it is a named function
 * rather than `key.endsWith('L') ? -1 : 1` at the call site.
 *
 * @param {string} key
 * @returns {number} +1 the athlete's right, -1 his left
 */
export function bodySideForRigKey(key) {
  const namedRight = key.endsWith('R');
  const onRight = SIDE_NAMES_MIRRORED ? !namedRight : namedRight;
  return onRight ? 1 : -1;
}

/**
 * Ragdoll colliders share one interaction group so they collide with the world
 * but never with each other — self-collision at these joint limits produces a
 * shivering knot rather than a flop.
 *
 * THE WORDS THEMSELVES NOW LIVE IN physics.js, which is the single source for
 * every group bit. They were defined here while this file was the only one that
 * needed them; the ball needs them too, and two files each declaring 0x0004
 * from memory is exactly how a filter drifts. Nothing about the ragdoll's or
 * the sphere's membership changed in the move.
 */

/**
 * Takes the sphere out of the ragdoll's collision set.
 *
 * THE MOUNT IS A FORCE ATTACHMENT, NOT A CONTACT. The character stands with its
 * feet at the bottom of the ball, which puts the ball squarely between its
 * shins — the legs pass through it by construction. Left colliding, a 73 kg
 * character interpenetrates a 1.05 kg sphere and punts it out from under
 * itself on the first step; measured, the "stationary" mount was drifting at
 * 0.24 m/s with the sphere being shoved around underneath.
 *
 * The sphere keeps colliding with the arena, which is what carries the
 * locomotion. Only the character-to-sphere pair is switched off.
 *
 * Construction-time, called once at boot alongside the colliders it edits.
 * motor.js is frozen for this task, so the group is applied from outside rather
 * than at the sphere's creation.
 */
export function detachMotorFromRagdoll(motor) {
  motor.collider.setCollisionGroups(MOTOR_GROUPS);
}

/**
 * TUNING.ragdoll.density is authored in g/cm3; Rapier wants kg/m3. This is the
 * conversion, not a tunable.
 *
 * The seeded values — torso 1.2, limb 1.0, head 0.9, extremity 0.8 — are the
 * textbook g/cm3 densities of the corresponding tissue, and water is 1.0 in
 * those units and 1000 in Rapier's. Handing them to Rapier raw makes this
 * 1.75 m character weigh 73 GRAMS. Converted, it weighs 73.0 kg, which is what
 * a 1.75 m adult weighs.
 *
 * The seeded tumbleImpulse corroborates the reading independently: 0.5 on the
 * raw-density pelvis is 6305 rad/s, a thousand revolutions a second. On the
 * converted pelvis it is 6.3 rad/s — one lazy revolution a second, which is
 * what "a small initial tumble" means.
 */
const DENSITY_G_PER_CM3_TO_KG_PER_M3 = 1000;

/**
 * The bodies that get solver-side damping, applied per step in tracker.js.
 * Hands and forearms are the ones that buzz; the upper arms are included
 * because damping a chain only at its tip leaves the segment above it free to
 * drive the tip from the other end.
 */
/**
 * The six bodies that go limp while the dive pose is up. Deliberately NOT the
 * `limb`/`extremity` groups, which also contain the arms and hands — the
 * superman is held by the arms and would collapse with them.
 */
export const LEG_BODIES = new Set([
  'thighL', 'thighR', 'calfL', 'calfR', 'footL', 'footR',
]);

export const ARM_CHAIN_DAMPED = new Set([
  'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'handL', 'handR',
]);

/** Local axis a capsule body is built along. Rapier capsules are Y-aligned. */
const BODY_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Reference direction used to complete a segment's orientation basis, and the
 * fallback for segments that happen to run along it.
 */
const FRAME_REFERENCE = new THREE.Vector3(0, 0, 1);
const FRAME_FALLBACK = new THREE.Vector3(1, 0, 0);
/** cos of the angle at which the reference is too close to the segment to use. */
const FRAME_PARALLEL_LIMIT = 0.99;

const _start = new THREE.Vector3();
const _end = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _anchor = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _inverse = new THREE.Matrix4();
const _scratch = new THREE.Vector3();
const _frameX = new THREE.Vector3();
const _frameZ = new THREE.Vector3();
const _frame = new THREE.Matrix4();
const _spawnMatrix = new THREE.Matrix4();
const _spawnPos = new THREE.Vector3();
const _spawnQuat = new THREE.Quaternion();
const _spawnScale = new THREE.Vector3();
const _spawnRotation = new THREE.Quaternion();

/**
 * Every bone in the skeleton, indexed under BOTH the name it has in the loaded
 * scene and the name it has in the glTF file.
 *
 * THE COLON PROBLEM. The asset names every joint `mixamorig:Hips` and friends —
 * that is what is in the file, and it is what BONE_MAP above is written in,
 * because the authored contract should speak the asset's own vocabulary. But
 * three's GLTFLoader runs every node name through
 * THREE.PropertyBinding.sanitizeNodeName, which strips the characters that are
 * reserved in animation binding paths — `.`, `:`, `[`, `]` and `/`. By the time
 * the skeleton reaches us, `mixamorig:Hips` is `mixamorigHips`.
 *
 * Rewriting the table to the stripped spelling would work today and would be
 * wrong: it would bake one loader's escaping rule into the one file that is
 * supposed to describe the ASSET, and it would silently stop matching if that
 * rule ever changed. So the table keeps the real names and the lookup applies
 * the same transform three does, accepting either spelling.
 *
 * @param {THREE.Skeleton} skeleton
 * @returns {Map<string, THREE.Bone>}
 */
function indexBones(skeleton) {
  const byName = new Map();
  for (const bone of skeleton.bones) {
    byName.set(bone.name, bone);
    const sanitised = THREE.PropertyBinding.sanitizeNodeName(bone.name);
    if (!byName.has(sanitised)) byName.set(sanitised, bone);
  }
  return byName;
}

/**
 * Resolves an authored BONE_MAP name against the index, trying the name as
 * written and then as the loader would have rewritten it.
 * @returns {THREE.Bone | undefined}
 */
function resolveBone(byName, authoredName) {
  return (
    byName.get(authoredName) ||
    byName.get(THREE.PropertyBinding.sanitizeNodeName(authoredName))
  );
}

/**
 * Skeleton-level convenience wrapper around the index + resolver, for callers
 * that hold a skeleton rather than a prebuilt name map — the animation target's
 * clone, in particular.
 * @param {THREE.Skeleton} skeleton
 * @param {string} authoredName a BONE_MAP name, in the asset's own spelling
 * @returns {THREE.Bone | undefined}
 */
export function resolveBoneByName(skeleton, authoredName) {
  return resolveBone(indexBones(skeleton), authoredName);
}

/**
 * DELIVERABLE 1 — the skeleton audit.
 *
 * Prints every bone with its parent, its world head position and its world
 * distance to each child, then asserts the contract. A mismatch THROWS with the
 * exact names that are missing alongside what the file actually contains,
 * because the failure mode this guards against — a typo'd bone name silently
 * producing a 14-body ragdoll with one limb absent — is otherwise very hard to
 * see and very easy to ship.
 *
 * @param {THREE.Skeleton} skeleton
 * @returns {Map<string, THREE.Bone>} the name index, reused by the rigger
 */
export function auditSkeleton(skeleton) {
  const byName = indexBones(skeleton);
  const rows = [];

  for (const bone of skeleton.bones) {
    bone.getWorldPosition(_scratch);
    const head = _scratch.clone();

    const children = bone.children
      .filter((child) => child.isBone)
      .map((child) => `${child.name}: ${child.getWorldPosition(_scratch).distanceTo(head).toFixed(4)}`);

    rows.push({
      bone: bone.name,
      parent: bone.parent && bone.parent.isBone ? bone.parent.name : `(${bone.parent ? bone.parent.name : 'none'})`,
      x: Number(head.x.toFixed(4)),
      y: Number(head.y.toFixed(4)),
      z: Number(head.z.toFixed(4)),
      childDistances: children.length ? children.join('  |  ') : '(leaf)',
    });
  }

  console.table(rows);

  const problems = [];

  if (skeleton.bones.length !== EXPECTED_JOINT_COUNT) {
    problems.push(
      `joint count is ${skeleton.bones.length}, expected ${EXPECTED_JOINT_COUNT}`,
    );
  }

  const missing = [];
  for (const entry of BONE_MAP) {
    if (!resolveBone(byName, entry.bone)) missing.push(`${entry.key}.bone -> ${entry.bone}`);
    if (!resolveBone(byName, entry.end)) missing.push(`${entry.key}.end  -> ${entry.end}`);
  }
  if (missing.length) {
    problems.push(`BONE_MAP names not present in the skeleton:\n    ${missing.join('\n    ')}`);
  }

  if (problems.length) {
    throw new Error(
      `[autorig] SKELETON CONTRACT VIOLATED\n  ${problems.join('\n  ')}\n` +
        `  the file contains these ${skeleton.bones.length} bones:\n    ` +
        skeleton.bones.map((b) => b.name).join('\n    '),
    );
  }

  console.log(
    `[autorig] skeleton contract satisfied: ${skeleton.bones.length} joints, ` +
      `all ${BONE_MAP.length * 2} BONE_MAP names resolved`,
  );

  return byName;
}

/**
 * The character's bind height, MEASURED: the top-of-head bone down to the lowest
 * bone in the skeleton.
 *
 * Collider radii are scaled from this rather than from segment length, and the
 * difference is not cosmetic. The pelvis segment (Hips->Spine) is about 0.10 m
 * long on this rig; a radius derived from it would give the character a 2 cm
 * waist wrapped around a 40 cm thigh.
 *
 * @param {THREE.Skeleton} skeleton
 * @param {Map<string, THREE.Bone>} byName
 * @returns {number} metres
 */
export function measureCharacterHeight(skeleton, byName) {
  const top = resolveBone(byName, HEIGHT_TOP_BONE).getWorldPosition(_scratch).y;

  let lowest = Infinity;
  for (const bone of skeleton.bones) {
    const y = bone.getWorldPosition(_scratch).y;
    if (y < lowest) lowest = y;
  }

  return top - lowest;
}

/**
 * A body orientation whose local +Y is the segment direction, built from an
 * EXPLICIT orthonormal basis rather than from a shortest-arc rotation.
 *
 * THE ANTIPARALLEL TRAP. The obvious implementation is
 * Quaternion.setFromUnitVectors(+Y, direction). It is correct for most
 * segments and quietly catastrophic for the legs. Thighs and calves point
 * almost exactly along -Y, which is the antiparallel degenerate case: there is
 * no unique shortest arc from +Y to -Y, so three picks an arbitrary
 * perpendicular, and the pick swings wildly for inputs a fraction of a degree
 * apart. Measured on this rig, the thigh and calf — collinear to within a
 * tenth of a degree — came out with bind orientations 79 degrees apart.
 *
 * A capsule is rotationally symmetric, so nothing looks wrong. The damage is at
 * the joints: a revolute axis is expressed in the parent's local frame, and the
 * hinge's zero angle is the bodies' relative orientation at creation. Random
 * roll therefore means the authored [0, limit] range no longer starts at the
 * straight-leg pose, and the knee is free to hyperextend.
 *
 * Building the basis explicitly makes the frame a continuous function of the
 * segment direction, so collinear segments get identical orientations and the
 * hinge's zero really is the bind pose.
 */
function segmentOrientation(direction, out) {
  const reference =
    Math.abs(direction.dot(FRAME_REFERENCE)) > FRAME_PARALLEL_LIMIT
      ? FRAME_FALLBACK
      : FRAME_REFERENCE;

  _frameX.crossVectors(reference, direction).normalize();
  _frameZ.crossVectors(_frameX, direction).normalize();

  _frame.makeBasis(_frameX, direction, _frameZ);
  return out.setFromRotationMatrix(_frame);
}

/**
 * Builds one body + collider for a BONE_MAP entry, from world-space bind
 * measurements only.
 *
 * @returns {{ body: object, collider: object, length: number, radius: number,
 *             halfHeight: number, shape: string, bindBodyWorld: THREE.Matrix4 }}
 */
function buildSegment(entry, byName, characterHeight, spawn) {
  const world = getWorld();

  resolveBone(byName, entry.bone).getWorldPosition(_start);
  resolveBone(byName, entry.end).getWorldPosition(_end);

  const length = _start.distanceTo(_end);
  _mid.addVectors(_start, _end).multiplyScalar(0.5);

  // Local +Y of the body is the segment direction. A zero-length segment would
  // make this undefined; the audit cannot catch that, so it is caught here.
  _dir.subVectors(_end, _start);
  if (!(length > 0)) {
    throw new Error(
      `[autorig] segment "${entry.key}" has zero length: ` +
        `${entry.bone} and ${entry.end} occupy the same world position`,
    );
  }
  _dir.divideScalar(length);
  segmentOrientation(_dir, _quat);

  const radius = TUNING.ragdoll.radiusRatio[entry.group] * characterHeight;
  const halfHeight = (length / 2) * TUNING.ragdoll.lengthFit;

  // THE BIND POSE OF THE BODY, in bind space — deliberately WITHOUT the spawn
  // offset, so that it pairs with bindBoneWorld which is also unoffset. The
  // sync then reads
  //     bodyWorld * inverse(bindBodyWorld) * bindBoneWorld
  // and at t = 0 the offset that placed the body in the air is exactly what
  // survives, carrying the mesh up with the capsules instead of leaving it
  // standing on the floor.
  const bindBodyWorld = new THREE.Matrix4().compose(_mid, _quat, new THREE.Vector3(1, 1, 1));

  // The body's placed transform is the spawn transform applied to its BIND
  // transform. Composing matrices rather than adding an offset lets the spawn
  // carry a yaw as well as a position, which is what mounting on the sphere
  // needs — and it keeps bindBodyWorld above in bind space, unmoved, which is
  // what the tracker's target formula depends on.
  _spawnMatrix.multiplyMatrices(spawn, bindBodyWorld);
  _spawnMatrix.decompose(_spawnPos, _spawnQuat, _spawnScale);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(_spawnPos.x, _spawnPos.y, _spawnPos.z)
      .setRotation({ x: _spawnQuat.x, y: _spawnQuat.y, z: _spawnQuat.z, w: _spawnQuat.w })
      // LAW 6 — a sleeping ragdoll body wakes late and pops.
      .setCanSleep(false)
      // CONTINUOUS COLLISION, because the arena is a trimesh and a trimesh is a
      // surface with no thickness. Falling from the seeded spawn height the
      // character arrives at about 15 m/s, which at a 60 Hz step is 26 cm of
      // travel between solver frames — several times the radius of a hand or a
      // foot. Those small bodies pass straight through the floor, and the
      // ragdoll then never settles: measured without this, limbs sat 0.7 m under
      // the bowl and the mean body speed was still 1.0 m/s after fifteen
      // seconds, with the solver fighting to extrude them forever. The onset is
      // purely a speed threshold — a drop from 1 m settles cleanly, a drop from
      // 2 m does not.
      .setCcdEnabled(true),
  );


  // A capsule shorter than it is wide is degenerate: Rapier will take it, and
  // the contact manifold it generates is garbage. The torso segments on this rig
  // are genuinely shorter than their radius, so this is the normal path for
  // them, not an error path.
  const useBall = entry.shape === 'ball' || radius >= halfHeight;

  const desc = useBall
    ? RAPIER.ColliderDesc.ball(radius)
    : RAPIER.ColliderDesc.capsule(halfHeight, radius);

  desc.setDensity(TUNING.ragdoll.density[entry.group] * DENSITY_G_PER_CM3_TO_KG_PER_M3);
  desc.setCollisionGroups(RAGDOLL_GROUPS);
  // Explicit rather than inherited. These ran on Rapier's defaults from Task 3
  // until now; see the TUNING comments for why restitution was never the cause
  // of the landing bounce and friction was the cause of the skid.
  // RESTITUTION, per group. The torso gets a little bounce and everything else
  // gets none: a rigid chest arriving on the floor at the end of a dive should
  // rebound rather than stop dead, and that rebound is what whips the (now
  // limp) legs down instead of letting them settle in a heap. A missing group
  // falls back to the flat value, so a new BONE_MAP entry cannot silently
  // become bouncy.
  const groupRestitution = TUNING.ragdoll.restitutionByGroup[entry.group];
  desc.setRestitution(
    groupRestitution === undefined ? TUNING.ragdoll.restitution : groupRestitution,
  );
  desc.setFriction(TUNING.ragdoll.friction);

  const collider = world.createCollider(desc, body);

  return {
    body,
    collider,
    length,
    radius,
    halfHeight: useBall ? 0 : halfHeight,
    shape: useBall ? 'ball' : 'capsule',
    bindBodyWorld,
  };
}

/**
 * Joins a child segment to its parent, anchored at the CHILD's head — which is
 * the anatomical joint centre, and is a world point both bodies can convert into
 * their own local frames.
 */
function buildJoint(entry, rig, byName, spawn) {
  const world = getWorld();
  const child = rig.get(entry.key);
  const parent = rig.get(entry.parent);

  resolveBone(byName, entry.bone).getWorldPosition(_anchor);
  _anchor.applyMatrix4(spawn);

  // The spawn's rotation alone, for turning the authored bind-space hinge axis
  // into the frame the spawned bodies actually occupy.
  _spawnMatrix.copy(spawn);
  _spawnMatrix.decompose(_spawnPos, _spawnRotation, _spawnScale);

  // The world anchor expressed in each body's local frame. Reading it back out
  // of the live body transform (rather than recomputing from bind) keeps this
  // correct even though the bodies were created at the spawn offset.
  const local1 = worldPointToBodyLocal(parent.body, _anchor, _scratch).clone();
  const local2 = worldPointToBodyLocal(child.body, _anchor, _scratch).clone();

  let params;
  if (entry.joint === 'universal') {
    // A UNIVERSAL JOINT: two swings, no twist.
    //
    // The ankle was spherical and unlimited, and it used all three degrees of
    // freedom — measured through a jump landing, 145 degrees from bind. A
    // spherical joint CANNOT be limited in this build: setLimits does not exist
    // on one, tested directly against 0.19.3, it throws.
    //
    // A revolute ankle fixes the twisting completely and costs far too much:
    // one angular DOF cannot reach a foot pose the animation authored in three,
    // and the measured foot placement error went from 5 mm to 12 cm. That is
    // feet planted visibly in the wrong place on every stride.
    //
    // The generic joint is the middle: lock ONLY the rotation about the shin,
    // which is the twist — the axis passed here is the limb's long axis at
    // bind, and AngX in the mask is rotation about that axis (verified against
    // this build: with axis +X, locking AngX blocks a torque about X and leaves
    // the other two free). The foot keeps both swings and can still be placed;
    // it can no longer spin about the leg, which is the snap.
    _axis.fromArray(entry.axis).applyQuaternion(_spawnRotation).normalize();
    const axis1 = worldDirToBodyLocal(parent.body, _axis, _scratch).clone();
    const locked =
      RAPIER.JointAxesMask.LinX |
      RAPIER.JointAxesMask.LinY |
      RAPIER.JointAxesMask.LinZ |
      RAPIER.JointAxesMask.AngX;
    params = RAPIER.JointData.generic(local1, local2, axis1, locked);
  } else if (entry.joint === 'revolute') {
    // The authored axis is a world-space direction AT BIND. The bodies are at
    // spawn * bind, so the axis has to travel the same way before being read
    // into a body frame; otherwise a rig mounted with any yaw gets hinges
    // pointing somewhere the table never said.
    _axis.fromArray(entry.axis).applyQuaternion(_spawnRotation).normalize();

    const axis1 = worldDirToBodyLocal(parent.body, _axis, _scratch).clone();

    params = RAPIER.JointData.revolute(local1, local2, axis1);
  } else {
    params = RAPIER.JointData.spherical(local1, local2);
  }

  const joint = world.createImpulseJoint(params, parent.body, child.body, true);

  // LIMITS ARE SET ON THE JOINT, NOT ON THE DESCRIPTOR. Setting
  // JointData.limitsEnabled / JointData.limits looks like the natural way and
  // is silently ignored by this build: read back immediately after creation,
  // limitsEnabled() is false and the range is the full +/- FLT_MAX. Every hinge
  // was unconstrained. setLimits() on the created joint does take.
  if (entry.joint === 'revolute') {
    const limits = TUNING.ragdoll.limits[entry.limits];
    joint.setLimits(limits[0], limits[1]);
  }

  return joint;
}

/** World point -> body local. */
function worldPointToBodyLocal(body, point, out) {
  const t = body.translation();
  const r = body.rotation();
  _inverse.makeRotationFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)).invert();
  return out.set(point.x - t.x, point.y - t.y, point.z - t.z).applyMatrix4(_inverse);
}

/** World direction -> body local (no translation). */
function worldDirToBodyLocal(body, dir, out) {
  const r = body.rotation();
  _inverse.makeRotationFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)).invert();
  return out.copy(dir).applyMatrix4(_inverse).normalize();
}

/**
 * DELIVERABLE 2 — derive the whole ragdoll.
 *
 * @param {THREE.Skeleton} skeleton
 * @param {THREE.Object3D} characterRoot the loaded glTF scene, already
 *        updateMatrixWorld(true)'d by the caller
 * @returns {{ rig: Map<string, object>, joints: object[], characterHeight: number,
 *             order: string[] }}
 */
export function buildRagdoll(skeleton, characterRoot, spawnTransform) {
  const byName = auditSkeleton(skeleton);
  const characterHeight = measureCharacterHeight(skeleton, byName);

  // WHERE THE RIG IS PLACED, as a full transform rather than a height.
  //
  // Task 3 dropped the ragdoll from spawnHeight onto the bowl; Task 4 spawns it
  // already mounted on the sphere, which needs a yaw as well as a position. A
  // matrix covers both, and the free-drop case is just the matrix that happens
  // to be a translation. Callers that pass nothing keep the Task 3 behaviour
  // exactly.
  const spawn =
    spawnTransform ||
    new THREE.Matrix4().makeTranslation(0, TUNING.ragdoll.spawnHeight, 0);

  const rig = new Map();
  const summary = [];

  for (const entry of BONE_MAP) {
    const segment = buildSegment(entry, byName, characterHeight, spawn);
    const bone = resolveBone(byName, entry.bone);

    rig.set(entry.key, {
      key: entry.key,
      entry,
      // Lifted out of `entry` because the tracker reads it every step for the
      // per-group stiffness, and a nested lookup there is easy to get wrong —
      // it was, and the map silently did nothing for every body.
      group: entry.group,
      body: segment.body,
      collider: segment.collider,
      bone,
      // Full matrices. They contain the armature's 0.01 scale and that is
      // correct — the sync divides it back out through the parent chain. Never
      // "fix" these by decomposing and dropping the scale.
      bindBoneWorld: bone.matrixWorld.clone(),
      bindBodyWorld: segment.bindBodyWorld,
      shape: segment.shape,
      radius: segment.radius,
      halfHeight: segment.halfHeight,
      length: segment.length,
      interpolated: null,
      mesh: null,
    });

    summary.push({
      key: entry.key,
      group: entry.group,
      segment_m: Number(segment.length.toFixed(4)),
      shape: segment.shape,
      radius_m: Number(segment.radius.toFixed(4)),
      halfHeight_m: Number(segment.halfHeight.toFixed(4)),
      joint: entry.joint || '(root)',
    });
  }

  const joints = [];
  for (const entry of BONE_MAP) {
    if (!entry.parent) continue;
    joints.push(buildJoint(entry, rig, byName, spawn));
  }

  console.table(summary);
  console.log(
    `[autorig] derived ${rig.size} bodies and ${joints.length} joints; ` +
      `measured character height ${characterHeight.toFixed(4)} m`,
  );

  return { rig, joints, characterHeight, order: hierarchyOrder(rig) };
}

/**
 * Mapped keys sorted parents-first by their depth in the REAL scene graph.
 *
 * Deliberately not BONE_MAP order and deliberately not RigMap-parent order: the
 * sync has to write bone locals against whatever the scene parent actually is,
 * and for the upper arms that is an unmapped clavicle.
 */
function hierarchyOrder(rig) {
  const depth = (bone) => {
    let d = 0;
    for (let node = bone.parent; node; node = node.parent) d++;
    return d;
  };
  return [...rig.values()]
    .sort((a, b) => depth(a.bone) - depth(b.bone))
    .map((e) => e.key);
}

/**
 * Tears the ragdoll down completely: joints first, then bodies (which takes
 * their colliders with them). Called before every respawn, so that spamming R
 * returns the world's body/collider/joint counts to exactly the baseline the
 * sphere-motor scene had on its own.
 */
export function destroyRagdoll(state) {
  if (!state) return;
  const world = getWorld();

  for (const joint of state.joints) world.removeImpulseJoint(joint, false);
  state.joints.length = 0;

  for (const item of state.rig.values()) {
    // removeRigidBody also removes every collider attached to it.
    world.removeRigidBody(item.body);
  }
  state.rig.clear();
}

