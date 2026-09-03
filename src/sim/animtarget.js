import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { TUNING } from '../config/tuning.js';
import { BONE_MAP, resolveBoneByName } from './autorig.js';

/**
 * THE ANIMATION TARGET.
 *
 * A second, invisible copy of the character that plays the LOCOMOTION BLEND
 * SPACE — now two-dimensional, plus an airborne overlay. It is never
 * rendered and never appears in a capture; its only product is, per fixed step,
 * a world-space target transform for each of the sixteen physics bodies. The
 * tracker then drives the real bodies toward those transforms with forces.
 *
 * The separation is the whole point of the architecture. The animation is
 * allowed to be a perfect, unphysical thing that never stumbles; the physics is
 * allowed to be a real thing that does. Nothing writes a pose onto a body, and
 * nothing writes a force onto the target.
 *
 * RULING GF-2.0 — THE SCOPE OF LAW 4, verbatim:
 *
 *   "Law 4 bans balance state machines. Mechanics-phase floats are legal and
 *   precedented (jumpQueued, locomotionPhase, standUpProgress): an edge may
 *   LATCH a float or start a monotone ratchet; no boolean of character state
 *   may exist and nothing may branch on 'which state we are in'."
 *
 * Everything the committed jump adds below is on the legal side of that line.
 * `jumpClipMix` is a float latched by an edge. `jumpPhase` is a monotone
 * ratchet reset by that same edge. `airborneMix` is a continuous ease. Nothing
 * asks which state the character is in, and there is no enum to ask about.
 *
 * DIRECTORY RULE (src/sim/): nothing here names a wall-clock or scheduler API.
 * LAW L6: the mixer is advanced by the CONSTANT dt from inside fixedUpdate and
 * by nothing else. An AnimationMixer ticked from the render clock would make the
 * pose a function of frame pacing, and the anchored capture would stop being
 * reproducible — which is the one thing Task 1 exists to guarantee.
 */

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TWO_PI = Math.PI * 2;

/** Below this the quaternion delta has no meaningful axis. */
const MIN_ANGLE = 1e-8;

const _bindBoneInverse = new THREE.Matrix4();
const _targetBody = new THREE.Matrix4();
const _basisX = new THREE.Vector3();
const _basisY = new THREE.Vector3();
const _basisZ = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _deltaQuat = new THREE.Quaternion();
const _mountQuat = new THREE.Quaternion();
const _rigidBasis = new THREE.Matrix4();
const _prevInverse = new THREE.Quaternion();
const _unitScale = new THREE.Vector3(1, 1, 1);
const _mount = new THREE.Matrix4();
const _standQuat = new THREE.Quaternion();
const _standAxis = new THREE.Vector3();
const _mountPos = new THREE.Vector3();

/** The literal that means "run the blend space" rather than pin a clip. */
const AUTO = 'auto';
/** Below this combined cycle weight there is no gait worth advancing. */
const MIN_GAIT_WEIGHT = 1e-4;
/** Guards the latch window's divide if the two speeds are set equal. */
const MIN_LATCH_SPAN = 1e-3;
/** Where the takeoff ratchet considers the character committed to the air. */
const AIRBORNE_THRESHOLD = 0.5;
/** Lateral speed below which local.x is noise and the strafe alarm stays quiet. */
const STRAFE_ASSERT_SPEED = 1;
/** How decisively one lateral node must lead before the alarm judges it. */
const STRAFE_ASSERT_MARGIN = 0.05;
/** The flail alarm's window: this airborne, this much locomotion is a bug. */
const FLAIL_ASSERT_AIR = 0.95;
const FLAIL_ASSERT_WEIGHT = 0.05;
/** Above this action demand the flail alarm stands down — see flailViolation. */
const FLAIL_ACTION_QUIET = 0.05;
/** The ring has four nodes, so each owns a quarter turn. */
const DIRECTION_SECTORS = 4;
const SECTOR_ANGLE = TWO_PI / DIRECTION_SECTORS;
/** Ring slots, in the order the angular tent walks them: forward, right, back,
 *  left. The node table and the tent both index by these and must not diverge. */
const DIR_F = 0;
const DIR_R = 1;
const DIR_B = 2;
const DIR_L = 3;

/** Scratch tents. Rebuilt every step; never read across steps. */
const _gait = { idle: 0, walk: 0, run: 0, sprint: 0 };
const _direction = [0, 0, 0, 0];

/** Signed shortest way round from `from` to `to`, in (-PI, PI]. Same rule the
 *  retired rider box used, moved here with the mount yaw it belonged to. */
/** Folds an angle into (-PI, PI]. */
function wrapAngle(a) {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

function shortestAngleDelta(from, to) {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta <= -Math.PI) delta += TWO_PI;
  return delta;
}

/**
 * Decomposes a target matrix into position and rotation ONLY.
 *
 * THE KNOWN-SCALE SHORTCUT. targetBodyWorld is built as
 * targetBoneWorld * inverse(bindBoneWorld) * bindBodyWorld. The first two
 * factors carry the armature's 0.01 and its reciprocal 100, so they cancel
 * analytically and the third is already unit-scale — the product is a rigid
 * transform on paper. In floating point it is a rigid transform plus a little
 * noise, and feeding that noise to Matrix4.decompose lets a scale of 0.9999
 * leak into a quaternion that is then normalised anyway.
 *
 * Because the scale is KNOWN to be 1, the basis columns can simply be
 * normalised and read as a rotation. That is cheaper than a general decompose
 * and it cannot be fooled by residue. It would be wrong on a matrix whose scale
 * is genuinely not 1 — which is exactly why this is documented rather than
 * hidden in a helper called `decompose`.
 */
function decomposeRigid(matrix, outPosition, outQuaternion) {
  const e = matrix.elements;

  outPosition.set(e[12], e[13], e[14]);

  _basisX.set(e[0], e[1], e[2]).normalize();
  _basisY.set(e[4], e[5], e[6]).normalize();
  _basisZ.set(e[8], e[9], e[10]).normalize();

  // A scratch of its own: the caller passes _targetBody in, and writing the
  // basis back into it mid-read would be a very quiet bug.
  _rigidBasis.makeBasis(_basisX, _basisY, _basisZ);
  outQuaternion.setFromRotationMatrix(_rigidBasis);
}

/**
 * WHICH TWO AXES OF THE HIPS' OWN FRAME ARE HORIZONTAL IN THE WORLD.
 *
 * L5 strips the horizontal root translation and keeps the vertical. That is a
 * statement about the WORLD, and the Hips track is authored in the armature's
 * frame, which is not the same frame: the exporter leaves a 90 degree X
 * rotation on the armature root to take the rig from Z-up to Y-up, so the
 * armature-local axis that points at the sky is Z, not Y.
 *
 * This was assumed rather than derived until the dive and slide arrived, and
 * the assumption was wrong in the way that hurts: the strip was pinning the
 * VERTICAL and keeping one horizontal axis. Measured on this asset, ghost hips
 * drift from the mount over one playback, unstripped -> stripped:
 *   Running Dive  4.367 -> 4.367 m     Slide Left     6.640 -> 6.640 m
 *   Walk Forward  0.057 -> 0.040 m     Standing Jump  0.130 -> 0.091 m
 * L5 was, in practice, not running. It went unnoticed for thirteen clips
 * because all thirteen are in-place cycles whose largest drift is 0.32 m.
 * With the axes derived, every one of the fifteen measures 0.0000 m.
 *
 * Deriving it costs one matrix at construction and cannot go stale, because a
 * re-export that changes the armature's orientation changes this answer with
 * it. The axis nearest world up is kept; the other two are pinned.
 *
 * @param {THREE.Object3D} hips
 * @param {THREE.Matrix4} rootLocal the clone root's own local matrix
 * @returns {{horizontal: [string, string], up: string}}
 */
function hipsAxisRoles(hips, rootLocal) {
  const toWorld = new THREE.Matrix4().identity();
  const chain = [];
  for (let o = hips.parent; o; o = o.parent) chain.push(o);
  // Root first, so each child's local composes on the right.
  for (const o of chain.reverse()) {
    toWorld.multiply(o.parent ? _axisScratch.compose(o.position, o.quaternion, o.scale) : rootLocal);
  }
  const names = ['x', 'y', 'z'];
  const vertical = names.map((_, i) =>
    Math.abs(
      _axisDir.set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0)
        .transformDirection(toWorld).y,
    ),
  );
  let up = 0;
  for (let i = 1; i < 3; i++) if (vertical[i] > vertical[up]) up = i;
  return {
    up: names[up],
    horizontal: names.filter((_, i) => i !== up),
  };
}

/** Scratch for hipsAxisRoles. Construction-time only. */
const _axisScratch = new THREE.Matrix4();
/** Scratch for hipsAxisRoles. Construction-time only. */
const _axisDir = new THREE.Vector3();

/**
 * Builds the invisible target rig.
 *
 * SkeletonUtils.clone is used rather than Object3D.clone because the latter
 * copies SkinnedMeshes that still point at the ORIGINAL skeleton — the clone
 * would pose the visible character, which is the opposite of what this is for.
 *
 * @param {THREE.Object3D} characterRoot the loaded, visible glTF scene
 * @param {THREE.AnimationClip[]} clips gltf.animations
 * @param {Map<string, object>} rig the RigMap from autorig
 */
export function createAnimTarget(characterRoot, clips, rig) {
  const root = cloneSkinned(characterRoot);
  root.name = 'anim-target';

  // Never rendered, never captured. The tracker reads its matrices directly, so
  // it does not need to be in the render path at all — but it DOES need to be
  // in the scene graph nowhere, and its matrices updated by hand.
  root.visible = false;

  let skeleton = null;
  root.traverse((object) => {
    if (object.isSkinnedMesh && !skeleton) skeleton = object.skeleton;
    if (object.isMesh) object.frustumCulled = false;
  });
  if (!skeleton) throw new Error('[animtarget] the clone has no SkinnedMesh');

  const hips = resolveBoneByName(skeleton, BONE_MAP[0].bone);
  if (!hips) throw new Error(`[animtarget] clone is missing ${BONE_MAP[0].bone}`);

  // THE ARMATURE'S OWN LOCAL TRANSFORM, kept so the mount can be composed ONTO
  // it rather than over it.
  //
  // The Blender exporter puts a -90 degree X rotation on the armature root to
  // take the rig from Z-up to Y-up, and the 0.01 cm-to-m scale sits there too.
  // Writing position/quaternion straight onto the clone root throws both away:
  // measured, the pelvis target landed at z = -1.048 instead of y = +0.997, the
  // whole target pose lying on its face 90 degrees out, and the tracker then
  // hauled the character apart trying to reach it.
  root.matrixAutoUpdate = false;
  const bindRootLocal = new THREE.Matrix4().compose(root.position, root.quaternion, root.scale);

  const state = {
    root,
    bindRootLocal,
    skeleton,
    clips,
    hips,
    // LAW L5 — the bind-pose HORIZONTAL root translation, restored every step.
    // Which two components those are is derived from the armature, not assumed;
    // see hipsAxisRoles. hipsUpAxis is the third and is never written.
    hipsAxisA: null,
    hipsAxisB: null,
    hipsUpAxis: null,
    hipsBindA: 0,
    /** The bind vertical, and the scale needed to lower it by metres. Only the
     *  dive writes this axis; see the drop at the L5 strip. */
    hipsBindUp: 0,
    hipsUnitsPerMetre: 100,
    hipsBindB: 0,
    mixer: new THREE.AnimationMixer(root),
    // Every node, all playing at all times. Built by buildBlendNodes.
    nodes: null,
    /** Unique cycle-node objects, for the one function that writes clip times. */
    cycleNodes: null,
    /** Every node in one flat list, for the override pin. */
    allNodes: null,
    /** The ring x direction CONTRIBUTIONS — one row per (ring, direction)
     *  cell. walkB and runB now point at SEPARATE nodes with separate clips;
     *  they are still separate rows because each is charged to its own ring's
     *  nominal speed by the stride sync. */
    contributions: null,
    // The pinned single action when TUNING.anim.override is not 'auto'.
    overrideAction: null,
    overrideName: null,
    /** Eased sphere velocity, in WORLD space. Smoothing the vector rather than
     *  the scalar keeps the heading as steady as the speed. */
    smoothedVelX: 0,
    smoothedVelZ: 0,
    /** |smoothedVel|. Debug readout + gait axis. */
    smoothedSpeed: 0,
    /** Velocity in the yaw frame. +Z forward, +X the character's RIGHT — see
     *  the convention comment at the rotation site. HUD. */
    localVelX: 0,
    localVelZ: 0,
    /** The two tents, kept for the HUD. gait sums to 1; direction sums to 1. */
    gait: { idle: 1, walk: 0, run: 0, sprint: 0 },
    direction: [1, 0, 0, 0],
    /** Applied weights per CONTRIBUTION id, eased toward the 2D product. */
    weights: null,
    targetWeights: null,
    /** ONE locomotion phase in [0,1), shared by every cycle node. */
    locomotionPhase: 0,
    // THE COMMITTED JUMP, as three mechanics floats. See RULING GF-2.0.
    /** Continuous ease toward grounded ? 0 : 1, asymmetric in and out. */
    airborneMix: 0,
    /** Monotone ratchet in [0,1]: where in the jump clip we are. */
    jumpPhase: 0,
    /** LATCHED at liftoff. 1 = the standing jump, 0 = the running one. */
    jumpClipMix: 1,
    // THE TWO ACTIONS. Continuous shares and continuous phases, set by main.js
    // from its own mechanics accumulators — no state enum, nothing branches on
    // which action is running.
    slideMix: 0,
    diveMix: 0,
    slidePhase: 0,
    divePhase: 0,
    /** True when an action's clip was missing and the held-apex pose stands in.
     *  Reported once at boot; not read per-step by anything. */
    slideIsFallback: false,
    diveIsFallback: false,
    /** Where the yaw is easing toward — the camera's heading. HUD. */
    // THE STAND-UP, as two continuous signals and one scrub. No latch, no flag.
    standUpNeed: 0,
    /** The physical pelvis-height measurement, 0..1 eased. Drives the mount
     *  blend and main.js's follower gate; deliberately NOT the clip's scrub. */
    pelvisDownness: 0,
    /** tracker.weight, written by main.js before updateAnimTarget. The ghost
     *  never reaches into the tracker; the number is handed to it. */
    recoveryWeight: 1,
    /** Last tick's recoveryWeight, so a collapse can be seen as a downward
     *  step. Only a collapse lowers the weight — recovery only raises it. */
    prevRecoveryWeight: 1,
    /** The four override shares, written by updateAnimTarget and read by the
     *  HUD and the weight audit. Never written anywhere else. */
    shares: { stand: 0, action: 0, air: 0, loco: 0 },
    standUpProgress: 0,
    faceUpMix: 0,
    yaw: 0,
    targetYaw: 0,
    /** The travel heading, HELD below facing.velocityFloor. NaN until the
     *  athlete has moved once, so a slide begun from a standstill seeds off the
     *  camera rather than pointing at world +Z. See advanceMountYaw. */
    momentumYaw: NaN,
    /** Stick magnitude, written by main.js. The ghost never reads input
     *  directly; the number is handed to it, like recoveryWeight. */
    steerInput: 0,
    /** How much of the facing has drifted onto the travel heading because the
     *  player let go. Eases in, drops to zero on any steering. */
    coastMix: 0,
    targets: new Map(),
    bones: new Map(),
    seeded: false,
  };

  for (const entry of BONE_MAP) {
    const bone = resolveBoneByName(skeleton, entry.bone);
    if (!bone) throw new Error(`[animtarget] clone is missing ${entry.bone}`);
    state.bones.set(entry.key, bone);
    state.targets.set(entry.key, {
      prevPos: new THREE.Vector3(),
      currPos: new THREE.Vector3(),
      prevQuat: new THREE.Quaternion(),
      currQuat: new THREE.Quaternion(),
      vel: new THREE.Vector3(),
      angvel: new THREE.Vector3(),
    });
  }

  const roles = hipsAxisRoles(hips, bindRootLocal);
  [state.hipsAxisA, state.hipsAxisB] = roles.horizontal;
  state.hipsUpAxis = roles.up;
  state.hipsBindA = hips.position[state.hipsAxisA];
  state.hipsBindUp = hips.position[state.hipsUpAxis];
  // Armature units per world metre. The exporter's 0.01 cm-to-m scale sits on
  // the armature node, so a drop authored in metres has to be converted before
  // it can be written into a bone's local translation.
  const armScale = hips.parent && hips.parent.scale ? Math.abs(hips.parent.scale.x) : 0.01;
  state.hipsUnitsPerMetre = armScale > 1e-6 ? 1 / armScale : 100;
  state.hipsBindB = hips.position[state.hipsAxisB];
  console.log(
    `[animtarget] L5 root strip: armature-local ${state.hipsAxisA}/${state.hipsAxisB} ` +
      `pinned as horizontal, ${state.hipsUpAxis} kept as vertical`,
  );

  buildBlendNodes(state);
  return state;
}

/**
 * Does every track in this clip address a bone that exists on the ghost?
 *
 * An AnimationClip carries track names of the form "<nodeName>.<property>".
 * three resolves those against the mixer's root by SANITIZED name, which is the
 * same colon-stripping the auto-rigger has to undo — GLTFLoader turns
 * "mixamorig:Hips" into "mixamorigHips", so a clip authored against the raw
 * Mixamo names and one authored against the loaded names must both resolve.
 *
 * Registering a clip whose tracks do NOT resolve is not a harmless no-op: the
 * mixer binds what it can and silently leaves the rest, so the character plays
 * a half-clip and the unbound bones fall back toward bind — a T-posed arm on an
 * otherwise fine animation, with no error anywhere. Checking up front is what
 * turns that into a log line naming the clip.
 *
 * @param {THREE.AnimationClip} clip
 * @param {THREE.Skeleton} skeleton
 * @returns {{ok: boolean, missing: string[]}}
 */
export function clipResolvesOnSkeleton(clip, skeleton) {
  const missing = [];
  for (const track of clip.tracks) {
    const nodeName = track.name.split('.')[0];
    if (!nodeName) continue;
    if (!resolveBoneByName(skeleton, nodeName)) missing.push(nodeName);
  }
  return { ok: missing.length === 0, missing: [...new Set(missing)] };
}

/**
 * Finds a clip by name, tolerating case.
 * @returns {THREE.AnimationClip | undefined}
 */
function findClip(state, name) {
  return (
    state.clips.find((c) => c.name === name) ||
    state.clips.find((c) => c.name.toLowerCase() === String(name).toLowerCase())
  );
}

/**
 * Builds every action in the blend space. All of them are played once, here,
 * and never stopped — the blend is entirely a matter of their weights.
 *
 * WHY NOT crossFadeTo / fadeIn / fadeOut. Those schedule an interpolant against
 * the MIXER'S OWN accumulated time and mutate the action's weight from inside
 * mixer.update. That makes the weight a function of how many times update has
 * been called with what deltas — which is fine in a render-clock game and fatal
 * here, because a fade in flight is hidden state that no longer follows from the
 * tick alone, and the anchored capture stops being reproducible. The eased
 * weights computed below ARE the crossfade, they live in our state, and they are
 * a pure function of the sphere's velocity history.
 *
 * EVERY CYCLE CLIP AND EVERY JUMP CLIP GETS timeScale 0. Their times are driven
 * from scrubs we own — the shared locomotion phase for the rings, the vertical
 * velocity for the jump, the stand-up feedback loop for the stand-ups — and
 * leaving the mixer free to advance them as well would mean two authorities on
 * the same number, with the one that wrote last winning by accident. Idle is the
 * single exception and free-runs: it has no cycle and no phase to keep.
 */
function buildBlendNodes(state) {
  const rings = TUNING.blend2d;

  const requireClip = (name) => {
    const clip = findClip(state, name);
    if (!clip) {
      throw new Error(
        `[animtarget] blend clip "${name}" is not in the asset; available: ` +
          state.clips.map((c) => c.name).join(', '),
      );
    }
    return clip;
  };

  const make = (id, clip, timeScale, reversed = false) => {
    const action = state.mixer.clipAction(clip);
    action.reset();
    action.timeScale = timeScale;
    action.setEffectiveWeight(0);
    action.play();
    return { id, action, duration: clip.duration, name: clip.name, reversed };
  };

  const idle = make('idle', requireClip(TUNING.anim.blend.idleClip), 1);

  const walkForward = requireClip(rings.walkClips.f);

  // THE TWO BACK NODES — one per ring, each playing its ring's own clip.
  //
  // THE PLACEHOLDER ERA IS OVER. The measured table below is kept anyway,
  // because it is the standing reason the FALLBACK a few lines down is played
  // forward rather than reversed, and that reason must not be rediscovered.
  //
  // Through Phase 2 the asset had no backpedal clip at all, so the back of both
  // rings stood in with the walk's own forward clip, and that stand-in used to
  // play at (1 - phase) on the reasoning that a walk run backwards is a
  // backpedal. Measured, that was the worse of the two wrongs: it is the ONLY
  // node whose time would run against the shared locomotionPhase, so at phase p
  // it sat at 1-p while every node it blends with sat at p. They agree only at
  // 0.5 and are maximally opposed at the ends, and averaging two clips at
  // opposite points of a gait cycle collapses the legs toward a straight-legged
  // pose:
  //
  //                        reversed (old)          forward (now)
  //     BACK-right(135)   corr -0.600, swing 0.068   corr +0.415, swing 0.121
  //     astern   (180)    corr -0.360, swing 0.124   corr -0.428, swing 0.119
  //     BACK-left (225)   corr -0.267, swing 0.202   corr -0.704, swing 0.194
  //
  // Swing amplitude at back-right nearly doubles and back-left's foot
  // correlation improves 2.6x; the cost is that back-right's feet move together
  // rather than alternating. Better on three of four.
  //
  // G1 retired that stand-in by naming "Walk Backwards", but it built ONE node
  // and handed the same object to both rings, so backing up at run speed was a
  // walk cadence stretched to fit. Each ring now names its own clip and gets its
  // own node.
  //
  // THE TWO NODES MUST BE DISTINCT OBJECTS, and so must their clips. three's
  // mixer caches one action per clip uuid: two nodes built on the same clip get
  // the same action, and therefore one time and one weight between them. That is
  // precisely what the stride sync's two nominals exist to avoid — walkB and
  // runB are charged to walkSpeed and runSpeed so the same gait turns over
  // faster at run speed — and it silently cannot work if the two nodes are one
  // action. It is also why the fallback CLONES rather than reusing walkForward.
  const makeBack = (id, ring, wanted) => {
    const clip = wanted ? findClip(state, wanted) : null;
    if (clip) return { node: make(id, clip, 0, false), fallback: false };
    const stand = walkForward.clone();
    stand.name = `${walkForward.name} (stand-in for ${ring} backpedal)`;
    return { node: make(id, stand, 0, false), fallback: true };
  };

  const walkBack = makeBack('walkB', 'walk', rings.walkClips.b);
  const runBack = makeBack('runB', 'run', rings.runClips.b);

  const walk = {
    f: make('walkF', walkForward, 0),
    r: make('walkR', requireClip(rings.walkClips.r), 0),
    b: walkBack.node,
    l: make('walkL', requireClip(rings.walkClips.l), 0),
  };

  const run = {
    f: make('runF', requireClip(rings.runClips.f), 0),
    r: make('runR', requireClip(rings.runClips.r), 0),
    b: runBack.node,
    l: make('runL', requireClip(rings.runClips.l), 0),
  };

  // The sprint ring is forward-only. See the CAP RULE in advanceBlend.
  const sprint = { f: make('sprintF', requireClip(rings.sprintClip), 0) };

  const jump = {
    standing: make('jumpStanding', requireClip(TUNING.jump.standingClip), 0),
    running: make('jumpRunning', requireClip(TUNING.jump.runningClip), 0),
  };

  // THE TWO ACTION NODES, with a fallback that costs nothing downstream.
  //
  // The original character asset had no slide and no dive; actions.glb is
  // optional and may not be there at all. Rather than branch on "is there a
  // clip" at every site that
  // touches an action, a missing clip becomes a node built on a CLONE of the
  // standing jump, whose time is pinned at apexHold — the held airborne pose.
  // Every share, every weight and every time write downstream is then identical
  // whether the art has arrived or not, and the only thing that knows the
  // difference is the boot log and the `isFallback` flag it reports from.
  //
  // The clone matters for the same reason the reversed back node needed one:
  // three's mixer caches one action per clip uuid, so a fallback sharing the
  // standing jump's clip would share its action, its time and its weight.
  const makeAction = (id, wanted) => {
    const clip = findClip(state, wanted);
    if (clip) return { node: make(id, clip, 0), fallback: false };
    const stand = requireClip(TUNING.jump.standingClip).clone();
    stand.name = `${wanted} (fallback: held ${TUNING.jump.standingClip})`;
    return { node: make(id, stand, 0), fallback: true };
  };

  const slideBuilt = makeAction('slide', TUNING.action.slideClip);
  const diveBuilt = makeAction('dive', TUNING.action.diveClip);
  const action = { slide: slideBuilt.node, dive: diveBuilt.node };
  state.slideIsFallback = slideBuilt.fallback;
  state.diveIsFallback = diveBuilt.fallback;

  // The two stand-up clips join on the same terms: timeScale 0, sampled from a
  // scrub we own. Their scrub is standUpProgress.
  const standUp = {
    faceDown: make('standDown', requireClip(TUNING.standUp.faceDownClip), 0),
    faceUp: make('standUp', requireClip(TUNING.standUp.faceUpClip), 0),
  };

  state.nodes = { idle, walk, run, sprint, jump, standUp, action };

  // THE CONTRIBUTION TABLE — one row per (ring, direction) cell. `nominalKey`
  // names the ring's authored ground speed in TUNING.blend2d, which is what the
  // stride sync divides by.
  //
  // walkB and runB were two rows over ONE node while the rings shared a back
  // clip: separate rows, separate nominals, so the same backpedal turned its
  // legs over faster at run speed. They now point at separate nodes playing
  // separate clips ("Walk Backwards" and "Jog Backwards"), and the two nominals
  // matter for the same reason as ever — each clip is scrubbed against the speed
  // its ring was authored at. The shape of this table did not change.
  state.contributions = [
    { id: 'walkF', node: walk.f, dir: DIR_F, ring: 'walk', nominalKey: 'walkSpeed' },
    { id: 'walkR', node: walk.r, dir: DIR_R, ring: 'walk', nominalKey: 'walkSpeed' },
    { id: 'walkB', node: walk.b, dir: DIR_B, ring: 'walk', nominalKey: 'walkSpeed' },
    { id: 'walkL', node: walk.l, dir: DIR_L, ring: 'walk', nominalKey: 'walkSpeed' },
    { id: 'runF', node: run.f, dir: DIR_F, ring: 'run', nominalKey: 'runSpeed' },
    { id: 'runR', node: run.r, dir: DIR_R, ring: 'run', nominalKey: 'runSpeed' },
    { id: 'runB', node: run.b, dir: DIR_B, ring: 'run', nominalKey: 'runSpeed' },
    { id: 'runL', node: run.l, dir: DIR_L, ring: 'run', nominalKey: 'runSpeed' },
    { id: 'sprintF', node: sprint.f, dir: DIR_F, ring: 'sprint', nominalKey: 'sprintSpeed' },
  ];

  // Every cycle node, and they are now all distinct: the walk and run rings own
  // separate back nodes, so this is nine objects rather than the eight it was
  // when one shared `back` stood in both rings. writeClipTimes iterates this
  // list and needs no change — it never knew how many there were.
  state.cycleNodes = [
    walk.f, walk.r, walk.b, walk.l,
    run.f, run.r, run.b, run.l,
    sprint.f,
  ];
  state.allNodes = [
    idle,
    ...state.cycleNodes,
    jump.standing,
    jump.running,
    standUp.faceDown,
    standUp.faceUp,
    action.slide,
    action.dive,
  ];

  state.weights = { idle: 0 };
  state.targetWeights = { idle: 0 };
  for (const c of state.contributions) {
    state.weights[c.id] = 0;
    state.targetWeights[c.id] = 0;
  }

  for (const [what, built] of [['slide', slideBuilt], ['dive', diveBuilt]]) {
    if (built.fallback) {
      console.warn(
        `[animtarget] no "${what === 'slide' ? TUNING.action.slideClip : TUNING.action.diveClip}" ` +
          `clip in the asset set — the ${what} falls back to the held airborne pose. ` +
          `Mechanics are unaffected; drop the clip into public/models/actions.glb to replace it.`,
      );
    }
  }

  const standIn = (built) => (built.fallback ? ' [STAND-IN]' : '');
  console.log(
    `[animtarget] 2D blend space: ${state.contributions.length} ring nodes + idle, ` +
      `${state.cycleNodes.length} distinct cycle nodes ` +
      `(walk back = "${walk.b.name}"${standIn(walkBack)}, ` +
      `run back = "${run.b.name}"${standIn(runBack)}), ` +
      `jump overlay ${jump.standing.name} / ${jump.running.name}`,
  );
}

/** Exponential ease, expressed against the constant dt so it is rate-correct. */
function ease(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/**
 * THE GAIT TENT — the speed axis, unchanged in shape from the 1D blend space
 * and simply given a fourth stop. Below walkSpeed the weight splits between
 * idle and walk, then walk/run, then run/sprint; above sprintSpeed the sprint
 * ring owns everything. The four always sum to 1.
 *
 * Idle's speed is 0 implicitly: it is the bottom of the axis by definition, and
 * a tunable "the speed at which standing still looks right" is not a real
 * quantity.
 */
function gaitWeights(speed, out) {
  const { walkSpeed, runSpeed, sprintSpeed } = TUNING.blend2d;

  out.idle = 0; out.walk = 0; out.run = 0; out.sprint = 0;

  if (speed <= 0) {
    out.idle = 1;
  } else if (speed < walkSpeed) {
    const t = speed / walkSpeed;
    out.idle = 1 - t; out.walk = t;
  } else if (speed < runSpeed) {
    const t = (speed - walkSpeed) / (runSpeed - walkSpeed);
    out.walk = 1 - t; out.run = t;
  } else if (speed < sprintSpeed) {
    const t = (speed - runSpeed) / (sprintSpeed - runSpeed);
    out.run = 1 - t; out.sprint = t;
  } else {
    out.sprint = 1;
  }
  return out;
}

/**
 * THE DIRECTION TENT — the angular axis. The same linear tent as the gait's,
 * wrapped onto a circle: the four ring slots sit at 0, PI/2, PI and 3PI/2, the
 * heading falls in one of four sectors, and the two slots bounding that sector
 * split the weight between them. Sums to 1 for every angle.
 *
 * THE WRAP IS THE WHOLE POINT. The modulo below is what makes the L-to-F sector
 * — the one that straddles the discontinuity in atan2 — behave exactly like the
 * other three. Without it a character turning through dead ahead from the left
 * would pass through a sector where no node has any weight, the pose would
 * collapse toward the bind, and it would happen at only one heading, which is
 * the kind of bug that gets blamed on the animation.
 *
 * @param {number} theta 0 = straight ahead, +PI/2 = the character's right
 */
function directionWeights(theta, out) {
  let t = theta / SECTOR_ANGLE;
  t = ((t % DIRECTION_SECTORS) + DIRECTION_SECTORS) % DIRECTION_SECTORS;

  const slot = Math.floor(t);
  const frac = t - slot;

  out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
  out[slot] = 1 - frac;
  out[(slot + 1) % DIRECTION_SECTORS] = frac;
  return out;
}

/**
 * HOW MUCH OF THE POSE THE STAND-UP TAKE IS CLAIMING ON ITS OWN ACCOUNT.
 *
 * 1 while the take is mid-play, ramping to 0 across the last releaseBand of
 * phase so the handback to standUpNeed is continuous rather than a step on the
 * frame the clip ends. At rest progress sits at 1 and this is 0, so it costs
 * nothing outside a get-up.
 *
 * It is a clamp on one float, not a phase of anything: nothing latches, nothing
 * branches on which part of a get-up we are in, and a second knockdown re-enters
 * it by the same arithmetic as the first (RULING GF-2.0).
 *
 * @param {object} state
 * @returns {number} 0..1
 */
function standUpHold(state) {
  const band = Math.max(1e-3, TUNING.standUp.releaseBand);
  return Math.min(1, Math.max(0, (1 - state.standUpProgress) / band));
}

/**
 * THE STAND-UP, as two continuous signals and a self-closing feedback loop.
 *
 * There is no "am I down" boolean and nothing to enter or leave. Three numbers
 * are read every step and everything follows from them:
 *
 *   standUpNeed    — how much RECOVERY is outstanding, 0..1, eased. Driven by
 *                    the tracker's weight, NOT by the pelvis. See the note on
 *                    the deadlock below.
 *   pelvisDownness — how far the pelvis is below standing height, 0..1, eased.
 *                    The physical measurement. It no longer drives the clip;
 *                    it drives the mount blend and main.js's follower gate,
 *                    which are the two things that genuinely want to know
 *                    where the body IS rather than how far along the recovery
 *                    is.
 *   faceUpMix      — which way the pelvis is facing, 0..1, smoothed through a
 *                    band so a body lying on its side does not flicker between
 *                    the two clips.
 *
 * THE FLOOR APPROXIMATION IS GONE (Task 7). Height used to be the pelvis's raw
 * world y, on the argument that the bowl floor is y = 0 across the flat centre
 * where a knocked-down character almost always ends up. That argument was
 * wrong about the case that mattered: ON THE BOWL WALL the pelvis is meters
 * above y = 0 while lying flat on the slope, so standUpNeed read near ZERO for
 * a character that was completely down. Measured — a sprint knockdown into the
 * wall never once crossed 0.7, so the mount hold could not engage there and the
 * character stood up beside its own sphere.
 *
 * The height is now measured against the surface actually beneath the pelvis.
 * main.js casts that ray (it already owns the environment-only filter) and
 * hands the result in, so this file stays free of physics imports and the whole
 * project pays for exactly one extra ray per step.
 *
 * A NEGATIVE floorY means the caller had no hit and is telling us so; the old
 * raw-y behaviour is the fallback, because a missing floor should degrade to
 * the previous approximation rather than to nonsense.
 *
 * THE DEADLOCK, and why the clip is no longer driven by the pelvis.
 *
 * Every previous version of this scrub was some form of
 *
 *   progress = f(pelvis height)
 *
 * and every one of them was circular in the bad direction: the ghost's pose is
 * what the tracker hauls the body toward, so a pose derived from where the body
 * already is has nothing to pull with. The clip sat near the floor waiting for
 * hips that were on the floor because the clip was holding them there. A lead
 * term papered over it — the pose was allowed a fixed distance ahead of the
 * body — but the anchor was still the body, so what actually stood the athlete
 * up was the weight ramp restoring the joint springs, not the take. Which is
 * exactly what "the stand-up animations are not playing" describes.
 *
 * THE RECOVERY IS THE CLOCK NOW. tracker.weight climbs on a pure ramp
 * (recoverPerSecond, no thresholds, nothing to do with height), so it is a
 * signal the clip can follow that the clip cannot influence. The circle is cut:
 *
 *   need     = 1 - weight, eased    (the blend share, so it crossfades)
 *   ceiling  = min(1, weight * recoverGain)   (RAW, so the reset is an edge)
 *   progress = min(ceiling, progress + minRate * dt)
 *
 * progress is a monotone forward ratchet at minRate — the take plays at its
 * authored speed — and recoverGain is what lets it FINISH well before the
 * weight does, so the pose is complete and waiting while the body catches up.
 * At recoverPerSecond 0.3 and recoverGain 3 the ceiling clears 1 about 1.1 s
 * into a 3.3 s recovery, and minRate 0.75 needs 1.33 s to walk the clip, so the
 * ratchet is what binds and the clip runs at roughly the speed it was authored.
 *
 * The reset is the same clamp read backwards: a knockdown puts weight at 0, so
 * the ceiling goes to 0 and carries progress to the front of the take. No edge,
 * no latch, no boolean of character state (RULING GF-2.0).
 */
function advanceStandUp(state, rig, floorY, dt) {
  const tuning = TUNING.standUp;
  const pelvis = rig && rig.get('pelvis');

  if (!pelvis) {
    state.standUpNeed = 0;
    state.pelvisDownness = 0;
    state.standUpProgress = 0;
    return;
  }

  // THE RECOVERY DEMAND, from the tracker's weight and nothing else. Written
  // onto the ghost by main.js before this runs, for the same reason slideMix
  // and diveMix are: main.js owns the mechanics, the ghost owns only how much
  // of each pose to show.
  const rawNeed = Math.min(1, Math.max(0, 1 - state.recoveryWeight));
  state.standUpNeed = ease(state.standUpNeed, rawNeed, tuning.ease, dt);

  // THE PHYSICAL MEASUREMENT, kept because the mount blend below and the
  // follower gate in main.js want where the body IS, not how far along the
  // recovery has come. Keeping them separate is also what stops mount recovery
  // from collapsing onto a single signal: its two conditions are meant to be
  // independent, and "weight is low" and "weight is low" is one condition.
  const translation = pelvis.body.translation();
  const height = Number.isFinite(floorY) ? translation.y - floorY : translation.y;
  // Normalised across the REACHABLE range, not against an implied zero the
  // pelvis never gets to: flat on the floor it measures ~0.13 m.
  const span = Math.max(1e-3, tuning.pelvisStandHeight - tuning.pelvisProneHeight);
  const rawDown = Math.min(1, Math.max(0, (tuning.pelvisStandHeight - height) / span));
  state.pelvisDownness = ease(state.pelvisDownness, rawDown, tuning.ease, dt);

  // Which way up. The pelvis body's local +Z against world up.
  const rotation = pelvis.body.rotation();
  _standQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
  _standAxis.set(0, 0, 1).applyQuaternion(_standQuat);
  const faceUpness = _standAxis.dot(WORLD_UP);

  const band = Math.max(1e-3, tuning.faceBlendBand);
  const rawMix = Math.min(1, Math.max(0, (faceUpness + band) / (2 * band)));
  state.faceUpMix = ease(state.faceUpMix, rawMix, tuning.ease, dt);

  // THE SCRUB. See the deadlock note above the function: the ceiling comes from
  // the recovery, which the clip cannot influence, and the ratchet is what
  // makes the take play at its authored speed rather than at the body's.
  //
  // RAW weight, not the eased need. The ease exists so the SHARE crossfades
  // instead of popping, and it is the wrong signal for the reset: the weight
  // rebounds off zero at recoverPerSecond immediately, so an eased need chasing
  // it never reached 1 and the ceiling never reached 0 — traced bottoming at
  // 0.49, which started every get-up half way through the take. The reset wants
  // the edge exactly as sharp as the knockdown that caused it.
  // THE COLLAPSE EDGE, and why the ceiling alone is no longer enough.
  //
  // The ceiling carries progress back to the front of the take when the weight
  // goes to zero — which worked while every knockdown landed on zero. A dive
  // now lands on crashMuscleTone instead, so the ceiling only falls to
  // 0.2 * 1.2 = 0.24 and the get-up would start a quarter of the way in, every
  // time, forever.
  //
  // Only a collapse ever LOWERS the weight; the recovery ramp only raises it.
  // So a downward step in one tick is a collapse by construction, whatever
  // depth it falls to, and that is the edge the take should re-seed on. It is
  // an edge starting a monotone ratchet from zero, which is the shape RULING
  // GF-2.0 explicitly allows; nothing latches and nothing branches on which
  // part of a get-up we are in.
  if (state.recoveryWeight < state.prevRecoveryWeight - tuning.collapseDrop) {
    state.standUpProgress = 0;
  }
  state.prevRecoveryWeight = state.recoveryWeight;

  const ceiling = Math.min(1, state.recoveryWeight * tuning.recoverGain);
  state.standUpProgress = Math.min(ceiling, state.standUpProgress + tuning.minRate * dt);
}

/**
 * Advances the 2D blend space one fixed step: velocity in, node weights and
 * phase out.
 *
 * THE SINGLE LOCOMOTION PHASE is the reason this is not just nine weighted
 * actions. Every ring clip is a recording of the same gait at a different speed
 * or heading. Blended out of phase — left foot forward in one, right foot
 * forward in another — they average to a pose with the legs together and
 * straight, and the PD tracker will chase that faithfully, so the character
 * glides through the crossfade with no legs. One phase drives all of them, so
 * the same foot is forward in every clip at every instant and the average is
 * still a running pose. That is what holds criterion 1's "phase-synced through
 * every F/R/B/L crossfade" together.
 *
 * @param {number} yaw the mount yaw ALREADY advanced this step
 */
function advanceBlend(state, motor, yaw, dt) {
  const blend = TUNING.anim.blend;

  // 1 — VELOCITY IN, eased as a VECTOR. Read-only on the motor. Smoothing the
  // vector rather than the scalar matters here in a way it did not in 1D: the
  // direction tent reads the heading, and an unsmoothed heading on a rolling
  // ball chatters through several sectors a second at walking pace.
  const linear = motor.body.linvel();
  state.smoothedVelX = ease(state.smoothedVelX, linear.x, blend.speedSmoothing, dt);
  state.smoothedVelZ = ease(state.smoothedVelZ, linear.z, blend.speedSmoothing, dt);
  state.smoothedSpeed = Math.hypot(state.smoothedVelX, state.smoothedVelZ);

  // 2 — INTO THE YAW FRAME.
  //
  // Convention: local.x > 0 = moving toward the character's RIGHT hand
  //             local.z > 0 = moving FORWARD (the facing direction)
  //
  // THE SIGN, which was wrong until GF-3 and is the whole of Part 1. The mount
  // is a rotation of `yaw` about world up, so world = Ry(yaw) * local and the
  // inverse rotation is Ry(-yaw); that part was always right, and it puts the
  // facing direction on +Z correctly. What it does NOT do is put the
  // character's right hand on +X.
  //
  // In a right-handed, Y-up frame whose +Z is forward, the right hand is -X.
  // Stand at the origin looking toward +Z with +Y up and you are facing out of
  // the screen at the viewer; your right hand is then on the viewer's left,
  // which is -X. So the raw inverse rotation hands back a frame with +X on the
  // character's LEFT, and the negation below is what makes the axis mean what
  // the convention above says it means.
  //
  // Measured before the fix: with the camera fixed and the stick pushed RIGHT,
  // local.x read -5.02 and the LEFT-strafe node took weight 0.98. The node
  // table's angles and the angular tent are correct and are NOT touched — the
  // error was entirely here, in what "+X" was taken to mean.
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  state.localVelX = -(cos * state.smoothedVelX - sin * state.smoothedVelZ);
  state.localVelZ = sin * state.smoothedVelX + cos * state.smoothedVelZ;

  const theta = Math.atan2(state.localVelX, state.localVelZ);

  // 3 — THE TWO TENTS.
  const g = gaitWeights(state.smoothedSpeed, _gait);
  const d = directionWeights(theta, _direction);
  state.gait.idle = g.idle;
  state.gait.walk = g.walk;
  state.gait.run = g.run;
  state.gait.sprint = g.sprint;
  state.direction[0] = d[0];
  state.direction[1] = d[1];
  state.direction[2] = d[2];
  state.direction[3] = d[3];

  // 4 — NODE WEIGHT = GAIT x DIRECTION, with THE CAP RULE.
  //
  // The sprint ring has a forward node and nothing else, because the asset has
  // no lateral sprint and faking one from a run strafe reads as a skid. So the
  // sprint gait weight is only spent on the sprint node to the extent the player
  // is actually going forward: the non-forward share, g.sprint * d[k] for every
  // k that is not F, is REASSIGNED to the RUN ring's node in the same direction.
  //
  // Two things fall out of that, both wanted. The weights still sum to exactly
  // 1, because nothing was dropped — it was moved. And a full-speed sideways
  // input never requests a lateral sprint: it plays the run strafe, which is the
  // fastest lateral clip that exists, and the character caps out there.
  const target = state.targetWeights;
  target.idle = g.idle;

  for (const c of state.contributions) {
    if (c.ring === 'sprint') {
      target[c.id] = g.sprint * d[DIR_F];
    } else if (c.ring === 'run') {
      target[c.id] = g.run * d[c.dir] + (c.dir === DIR_F ? 0 : g.sprint * d[c.dir]);
    } else {
      target[c.id] = g.walk * d[c.dir];
    }
  }

  // 5 — APPLIED WEIGHTS, eased toward the target. This is the crossfade, and it
  // runs AFTER the 2D computation so that one ease covers both axes at once.
  const w = state.weights;
  w.idle = ease(w.idle, target.idle, blend.weightEase, dt);
  for (const c of state.contributions) {
    w[c.id] = ease(w[c.id], target[c.id], blend.weightEase, dt);
  }

  // 6 — PHASE. Cycles per second is the weight-blended reciprocal duration over
  // every weighted CYCLE contribution — nine of them now, not two. Idle has no
  // cycle and is excluded, and the weights are renormalised over the cycle
  // contributions so that at low speed, where idle owns most of the total, the
  // legs still turn over at the walk rate rather than crawling.
  //
  // Summing over CONTRIBUTIONS rather than over nodes is what lets the shared
  // back node be charged to the walk ring's nominal in one term and the run
  // ring's in another. Summing over nodes would have to pick one, and the
  // backpedal's stride would then be wrong at one of the two speeds.
  let cycleWeight = 0;
  let cyclesPerSecond = 0;
  let nominal = 0;

  for (const c of state.contributions) {
    const weight = w[c.id];
    if (weight <= 0) continue;
    cycleWeight += weight;
    cyclesPerSecond += weight / c.node.duration;
    nominal += weight * TUNING.blend2d[c.nominalKey];
  }

  if (cycleWeight > MIN_GAIT_WEIGHT) {
    cyclesPerSecond /= cycleWeight;
    nominal /= cycleWeight;
  } else {
    cyclesPerSecond = 0;
    nominal = 0;
  }

  // STRIDE SYNC. Scale the turnover toward ground speed, clamped. With the root
  // motion stripped the feet cannot stop skating — the character is carried by a
  // sphere, not by its stride — but matching the rate to the speed is what makes
  // the skate read as a fast run rather than a moonwalk.
  if (TUNING.anim.stride.enabled && nominal > 0) {
    const ratio = state.smoothedSpeed / nominal;
    cyclesPerSecond *= Math.min(TUNING.anim.stride.max, Math.max(TUNING.anim.stride.min, ratio));
  }

  state.locomotionPhase =
    (state.locomotionPhase + dt * cyclesPerSecond * TUNING.anim.timeScale) % 1;
  if (state.locomotionPhase < 0) state.locomotionPhase += 1;
}

/**
 * THE COMMITTED JUMP — three mechanics floats, no character state.
 *
 * RULING GF-3.3, verbatim:
 *
 *   "The vertical-velocity scrub is removed. vy is noisy and non-monotone at
 *   the apex and on grounded flicker; animation time never again derives from
 *   it. Jump timing is tick-rate ratchets only."
 *
 * What that ruling costs and what it buys. It costs the property that the clip
 * tracked the real arc, so a very high jump and a very low one now play the
 * takeoff at the same rate. It buys a pose that cannot shiver: vy passes
 * through zero at the apex with contact noise riding on it, and any clip time
 * derived from it inherited that noise at exactly the moment the character is
 * most visible. The hold below replaces the arc-tracking with something better
 * suited to a jump anyway — one pose, held, for the whole airtime.
 *
 * The three floats, and why each is legal under RULING GF-2.0:
 *
 *   jumpClipMix — LATCHED by the liftoff edge from the horizontal speed at that
 *                 instant, untouched until the next liftoff. The arc is decided
 *                 the moment you leave the ground, so the pose should be too.
 *   airborneMix — a continuous ease, asymmetric: fast in so the pose commits
 *                 within a few ticks of leaving the ground, soft out so the
 *                 landing is a blend rather than a cut.
 *   jumpPhase   — a rate ratchet with a HOLD POINT. It rises to apexHold and
 *                 stops there for the whole airtime; that held frame IS the
 *                 airborne pose. On the ground it resumes to 1.0 through the
 *                 landing frames and stops again. It never wraps and never
 *                 exceeds 1.
 *
 * THE FALL WITH NO JUMP falls out of the arithmetic rather than needing a case.
 * Roll off the lip and no liftoff has reset the phase, so it is sitting at the
 * 1.0 the last landing left it at — and `min(phase + takeoffRate * dt,
 * apexHold)` clamps that straight DOWN to apexHold on the first airborne step.
 * The character enters the held airborne pose immediately, which is what a long
 * fall should look like, with no flag tracking whether this airtime had a jump.
 */
function advanceAirborne(state, motor, liftoff, grounded, dt) {
  const tuning = TUNING.jump;

  // 1 — THE LATCH. Horizontal speed at THIS instant picks the clip for the
  // whole flight. Below inPlaceBelow it is all standing jump, above runAbove
  // all running jump, linear between.
  if (liftoff) {
    const linear = motor.body.linvel();
    const speed = Math.hypot(linear.x, linear.z);
    const span = Math.max(MIN_LATCH_SPAN, tuning.runAbove - tuning.inPlaceBelow);
    const t = Math.min(1, Math.max(0, (speed - tuning.inPlaceBelow) / span));
    state.jumpClipMix = 1 - t;
    // The ratchet restarts here and only here, so a jump always opens on the
    // clip's first frame however the last one ended.
    state.jumpPhase = 0;
  }

  // 2 — THE OVERRIDE, eased asymmetrically. Selecting the rate by the target is
  // not a branch on character state: it is the statement that rising and
  // falling are different rates, which is what asymmetric easing means.
  // The DEBOUNCED contact flag, not the raw ray. A single-tick graze against a
  // wall in mid-flight used to pull this down by a quarter in one step.
  const target = grounded ? 0 : 1;
  const rate = target > state.airborneMix ? tuning.airEaseIn : tuning.airEaseOut;
  state.airborneMix = ease(state.airborneMix, target, rate, dt);

  // 3 — THE HOLD-POINT RATCHET.
  //
  // PRECEDENCE. The two rules overlap for the handful of ticks after touchdown
  // where the feet are down but airborneMix has not yet eased below the
  // threshold, and grounded is checked FIRST so the landing resumes on the
  // grounded EDGE as specified rather than eight ticks later. Checked the other
  // way round the landing frames would play under a weight that had already
  // half-decayed, and the landing is the half of the jump most worth seeing.
  //
  // Neither branch is a character state: one is the motor's own contact
  // measurement, the other a threshold on a continuous float.
  if (grounded) {
    state.jumpPhase = Math.min(state.jumpPhase + tuning.landRate * dt, 1);
  } else if (state.airborneMix > AIRBORNE_THRESHOLD) {
    state.jumpPhase = Math.min(state.jumpPhase + tuning.takeoffRate * dt, tuning.apexHold);
  }
}

/**
 * Applies TUNING.anim.override. 'auto' means the blend space; anything else
 * pins that one clip at weight 1, which is the Task 4 single-clip behaviour,
 * kept for debugging and for the L5 creep test.
 */
function applyOverride(state) {
  const wanted = TUNING.anim.override;

  if (state.overrideName !== wanted) {
    if (state.overrideAction) {
      state.overrideAction.setEffectiveWeight(0);
      state.overrideAction.stop();
      state.overrideAction = null;
    }
    state.overrideName = wanted;

    if (wanted !== AUTO) {
      const node = state.allNodes.find((n) => n.name === wanted);
      if (node) {
        // One of the blend clips: pin it in place rather than making a second
        // action on the same clip.
        state.overrideAction = node.action;
      } else {
        const clip = findClip(state, wanted);
        if (!clip) {
          console.warn(`[animtarget] no clip named "${wanted}"; falling back to auto`);
          state.overrideName = AUTO;
        } else {
          state.overrideAction = state.mixer.clipAction(clip);
          state.overrideAction.reset();
          state.overrideAction.play();
        }
      }
    }
  }

  if (state.overrideName === AUTO) return false;

  // Pinned: the named action owns all the weight, every other node owns none.
  for (const node of state.allNodes) {
    node.action.setEffectiveWeight(node.action === state.overrideAction ? 1 : 0);
  }
  if (state.overrideAction) {
    state.overrideAction.setEffectiveWeight(1);
    state.overrideAction.timeScale = TUNING.anim.timeScale;
  }
  return true;
}

/**
 * THE ONE FUNCTION THAT WRITES A CLIP TIME.
 *
 * Every action outside idle carries timeScale 0, so mixer.update does not
 * advance any of them: it samples each at whatever time was last written here,
 * and this write sets the time the NEXT sample will use. The pose therefore
 * trails its scrub by exactly one fixed step, uniformly, for every clip — which
 * is invisible and, more to the point, identical on every run.
 *
 * Called immediately AFTER mixer.update, deliberately. Writing the times before
 * it instead would have the mixer advance from them and sample somewhere we did
 * not choose, putting two authorities on one number. This way the scrubs are the
 * only authority, and there is exactly one place to look for a clip whose time
 * is wrong.
 */
function writeClipTimes(state) {
  // THE RINGS — one phase, read forwards by every node. The back nodes used to
  // read it backwards; see the measured table at their construction for why they
  // no longer do.
  for (const node of state.cycleNodes) {
    const phase = node.reversed ? 1 - state.locomotionPhase : state.locomotionPhase;
    node.action.time = phase * node.duration;
  }

  // THE JUMP — the arc, mapped into the usable window of each clip.
  const { clipStart, clipEnd } = TUNING.jump;
  const fraction = clipStart + state.jumpPhase * (clipEnd - clipStart);
  state.nodes.jump.standing.action.time = fraction * state.nodes.jump.standing.duration;
  state.nodes.jump.running.action.time = fraction * state.nodes.jump.running.duration;

  // THE ACTIONS. A real clip is scrubbed by the phase main.js derives from its
  // own tick accumulator, mapped into the clip's usable window exactly as the
  // jump is; a FALLBACK node is a clone of the standing jump and is pinned at
  // apexHold, which is the held airborne pose the report promises.
  const act = TUNING.action;
  const slideFraction =
    act.slideClipStart + state.slidePhase * (act.slideClipEnd - act.slideClipStart);
  const diveFraction =
    act.diveClipStart + state.divePhase * (act.diveClipEnd - act.diveClipStart);
  state.nodes.action.slide.action.time = state.slideIsFallback
    ? TUNING.jump.apexHold * state.nodes.action.slide.duration
    : slideFraction * state.nodes.action.slide.duration;
  state.nodes.action.dive.action.time = state.diveIsFallback
    ? TUNING.jump.apexHold * state.nodes.action.dive.duration
    : diveFraction * state.nodes.action.dive.duration;

  // THE STAND-UPS — the feedback loop's progress, mapped into the live window
  // of the take. Both Mixamo stand-ups open and close on a static hold, and
  // scrubbing across them spent nearly half the get-up on a frozen pose.
  const stand = TUNING.standUp;
  const standFraction =
    stand.clipStart + state.standUpProgress * (stand.clipEnd - stand.clipStart);
  state.nodes.standUp.faceUp.action.time =
    standFraction * state.nodes.standUp.faceUp.duration;
  state.nodes.standUp.faceDown.action.time =
    standFraction * state.nodes.standUp.faceDown.duration;
}

/** Where the target rig stands: sphere centre, dropped by the sphere radius so
 *  the feet sit at the bottom of the ball. */
export function mountMatrix(motor, yaw, out) {
  const translation = motor.body.translation();
  _mountQuat.setFromAxisAngle(WORLD_UP, yaw);
  _pos.set(translation.x, translation.y - motor.radius, translation.z);
  return out.compose(_pos, _mountQuat, _unitScale);
}

/**
 * THE MOUNT YAW — camera-locked in free roam, momentum-locked in an action.
 *
 * The camera's heading is the default: it is what lets a player strafe, and it
 * is always well defined. Two things move the target onto the heading of the
 * sphere's own velocity instead — a slide or a dive owning the pose, and
 * COASTING with the stick released — below velocityFloor there
 * is no heading to speak of, so the last one is HELD: a slide grinding to a
 * halt must not swing to whatever direction the final centimetre per second
 * happened to point.
 *
 * IT READS THE SMOOTHED VELOCITY, NOT THE RAW LINVEL. Contact jitter on a
 * rolling ball is several tenths of a m/s in a random direction — the same
 * noise anim.blend.speedSmoothing exists to absorb — and a heading taken off
 * the raw vector chatters at low speed, which the PD tracker would then chase
 * into the athlete's hips. The smoothed pair is one step old here, because yaw
 * is settled before advanceBlend rewrites it; at 60 Hz that is 16 ms of lag on
 * a number already eased at 6/s, and taking it in this order is what keeps the
 * blend's velocity frame consistent with the facing it is measured against.
 *
 * WHICH OF THE TWO, AND WHY IT IS A BLEND RATHER THAN A BRANCH.
 *
 * Momentum facing costs the strafe. With facing tied to velocity the athlete is
 * BY DEFINITION always running forward — local velocity is pure +Z whenever
 * there is any — so the 2D blend space's strafe and backpedal nodes can never
 * receive weight. Measured at full sprint with momentum facing everywhere: the
 * direction tent read F = 1.00 for forward, strafe left, strafe right, backpedal
 * AND diagonal, every one of them. Camera facing is what makes stick-left a
 * genuine left strafe, and it is the right default for free roam.
 *
 * But a slide or a dive is not free roam. Steering is already dead through both
 * — they are commitments — and an athlete sliding sideways while facing the
 * camera is not sliding, he is being dragged. Those are exactly the moves whose
 * facing should be the direction of travel.
 *
 * So the target is the ANGULAR LERP between the two, by how much of the pose an
 * action currently owns. slideMix and diveMix already ease in and out at
 * poseEase, so the facing changes hands over the same handful of frames the
 * pose does; branching on `slideMix > 0` instead would swing the target from
 * the camera to the travel heading in a single tick at the instant a slide
 * begins, and the tracker would put that step straight into the athlete's hips.
 * At mix 0 this is exactly cameraYaw and at mix 1 exactly the momentum heading,
 * so nothing is approximated at either end.
 *
 * Still an EASE on top, not an assignment, for the same reason as before: a
 * per-frame snap transmits every twitch straight into the pose.
 *
 * @param {object} state
 * @param {number} cameraYaw the value latched in the input snapshot this frame
 *        (LAW L6). Kept as the SEED for the very first step and for the held
 *        case at spawn, when there is no velocity to take a heading from.
 * @param {number} dt
 */
export function advanceMountYaw(state, cameraYaw, dt) {
  const vx = state.smoothedVelX;
  const vz = state.smoothedVelZ;
  const speed = Math.hypot(vx, vz);

  // Hold, do not snap. momentumYaw simply is not rewritten below the floor, so
  // a slide that runs out of speed keeps the heading it had rather than
  // swinging to wherever the last centimetre per second happened to point.
  if (speed >= TUNING.facing.velocityFloor) {
    state.momentumYaw = Math.atan2(vx, vz);
  } else if (!Number.isFinite(state.momentumYaw)) {
    state.momentumYaw = cameraYaw;
  }

  // COASTING. Steering is what makes camera facing worth having; with the stick
  // released there is nothing to strafe relative to, and an athlete carried
  // down a slope by gravity while still square to the camera walks backwards
  // down it. So with no input and real speed the facing eases onto the travel
  // heading, and any touch of the stick takes it straight back.
  //
  // The ramp is one-sided ON PURPOSE. Easing in over coastEase is what stops a
  // momentary release mid-strafe from starting a turn; dropping to zero the
  // instant the stick moves is what makes steering feel immediate. The yaw
  // itself is still eased at facing.ease, so even the instant drop reaches the
  // athlete as a turn rather than a snap.
  const steering = state.steerInput > TUNING.facing.steerDeadzone;
  const fast = speed > TUNING.facing.coastSpeed;
  state.coastMix = steering || !fast
    ? (steering ? 0 : ease(state.coastMix, 0, TUNING.facing.coastEase, dt))
    : ease(state.coastMix, 1, TUNING.facing.coastEase, dt);

  // Camera by default, travel while an action owns the pose or while coasting,
  // and the angular lerp between them across the frames either is changing.
  const actionMix = Math.min(1, state.slideMix + state.diveMix);
  const travelMix = Math.max(actionMix, state.coastMix);
  // Wrapped, because cameraYaw + delta can leave (-PI, PI] and a target angle
  // outside that range is a trap for anything that reads it without going
  // through shortestAngleDelta — a HUD, or the next person to use it.
  state.targetYaw = wrapAngle(
    cameraYaw + shortestAngleDelta(cameraYaw, state.momentumYaw) * travelMix,
  );

  const blend = 1 - Math.exp(-TUNING.facing.ease * dt);
  state.yaw += shortestAngleDelta(state.yaw, state.targetYaw) * blend;
  return state.yaw;
}

/**
 * COPIES THE MECHANICS' SIX NUMBERS ONTO THE GHOST. The only door they come in
 * through.
 *
 * WHY THIS FUNCTION EXISTS (G3.5). main.js used to assign these fields by name,
 * from three different places inside fixedUpdate, spread over two hundred
 * lines — `animTarget.recoveryWeight = ...`, `animTarget.slidePhase = ...` and
 * so on. That is a write channel with no signature: nothing declared it,
 * nothing type-checked it, and the only way to find out what main.js was
 * allowed to poke was to grep for the pattern and hope the grep was right. The
 * fields and their semantics are unchanged. What changed is that they arrive as
 * an argument and land here, so the ghost's input surface is a list you can
 * read in one screen.
 *
 * THE ORDER IS THE ORDER THEY WERE POKED IN, kept deliberately even though
 * these are six independent assignments to six independent fields. If a later
 * change makes one of them read another, the order it needs is already the one
 * that is here.
 *
 * `inputs` is null for the handful of ticks before the first spawn, and on the
 * seeding call `spawnRagdoll` makes against a freshly built state — which is
 * exactly when the old code's `if (animTarget)` guard did nothing either.
 *
 * @param {object} state
 * @param {object|null|undefined} inputs
 */
function readGhostInputs(state, inputs) {
  if (!inputs) return;
  state.recoveryWeight = inputs.recoveryWeight;
  state.steerInput = inputs.steerInput;
  state.slideMix = inputs.slideMix;
  state.diveMix = inputs.diveMix;
  state.slidePhase = inputs.slidePhase;
  state.divePhase = inputs.divePhase;
}

/**
 * One fixed step of the target: advance the clip, strip the root motion, plant
 * the rig on the sphere, and derive a world target transform per body.
 *
 * @param {object} state
 * @param {object} motor the sphere motor (READ ONLY — nothing here touches it)
 * @param {Map<string, object>} rig the RigMap, for its captured bind matrices
 * @param {number} dt the constant timestep
 * @param {object|null} [inputs] the mechanics' handoff — see readGhostInputs
 */
export function updateAnimTarget(
  state, motor, rig, cameraYaw, liftoff, floorY, grounded, dt, inputs,
) {
  if (!state) return;

  // THE MECHANICS' HANDOFF, FIRST AND IN ONE PLACE. Everything below reads
  // these six fields; nothing below writes them.
  readGhostInputs(state, inputs);

  // YAW FIRST. The 2D blend reads velocity IN THE YAW FRAME, so the facing has
  // to be settled for this step before the direction tent can be evaluated
  // against it. Yaw itself depends only on velocity and the stick, never on the
  // blend, so there is no circularity to break — only an order to get right.
  const yaw = advanceMountYaw(state, cameraYaw, dt);

  // Velocity in, weights and phase out. Pure functions of sim state and input.
  advanceBlend(state, motor, yaw, dt);
  advanceAirborne(state, motor, liftoff, grounded, dt);
  advanceStandUp(state, rig, floorY, dt);

  const pinned = applyOverride(state);
  if (!pinned) {
    // THE OVERLAYS TAKE THEIR SHARE FROM THE LOCOMOTION GROUP, so everything
    // playing still sums to 1. There is no "stand-up mode" or "jump mode"
    // competing with locomotion — each overlay is simply how much of the total
    // pose it is, and both are continuous numbers.
    //
    // ORDER: STAND-UP TAKES ITS SHARE FIRST, then the airborne overlay takes
    // its share of WHAT IS LEFT, and locomotion keeps the remainder. The order
    // only matters when both are non-zero, which is a character knocked down in
    // mid-air, and stand-up winning is the right call there: a body that is
    // limp and falling should read as limp, and the jump overlay's flight pose
    // is a controlled, braced one. Reverse the order and the airborne clip
    // would mask the collapse right at the moment the collapse is the news.
    // ═══ OVERRIDE PRECEDENCE, in one place ═══
    //
    //     slide/dive  >  standUp  >  airborne  >  locomotion
    //
    // Each override takes its share of WHAT IS LEFT after the ones above it,
    // so the shares multiply out in that order and still sum to exactly 1 — the
    // weight audit asserts this every second. Reading down: a committed slide
    // or dive is a pose the player ASKED for and outranks everything, including
    // the stand-up (see the note above the arithmetic — standUpNeed is a
    // height measurement and reads a deliberate slide as a fall); a character
    // being put on the floor outranks the airborne pose; and the airborne
    // override outranks locomotion, which is the flail fix — at airborneMix
    // near 1 the 2D blend contributes essentially nothing and the PD tracker
    // chases the jump pose alone.
    //
    // Slide and dive share one tier and cannot both be high: a slide needs
    // grounded and a dive clears the cooldown before it fires. They are summed
    // rather than nested so neither is arbitrarily senior to the other, and the
    // sum is clamped because two half-active actions must not exceed the tier.
    // THE ACTION TIER IS NOW SENIOR TO THE STAND-UP, swapped from the other
    // order. standUpNeed is a pelvis-height measurement and cannot tell a fall
    // from a deliberate low pose: a held slide puts the pelvis at 0.25 m, which
    // read as need 0.39, so 39% of the blend was a stand-up while the athlete
    // was sliding on purpose with full weight. Nothing was wrong with the
    // measurement — the tier order was asking it a question it cannot answer.
    //
    // Safe in the other direction because both action mixes are bounded and
    // decay on their own: slideMix follows slideTime, which ends on release or
    // stopSpeed, and diveMix follows a latch the cooldown bounds. Neither can
    // sit high over a real knockdown and hold the stand-up out, and as either
    // decays the stand-up takes the tier back continuously.
    const actionDemand = Math.min(1, state.slideMix + state.diveMix);
    const actionShare = actionDemand;
    const afterAction = 1 - actionDemand;

    // THE STAND-UP'S DEMAND IS NOT JUST standUpNeed ANY MORE.
    //
    // need is 1 - weight, so it was the RECOVERY RAMP deciding how much of the
    // take to show — while the take's scrub runs on its own clock. The two
    // finish seconds apart: measured, progress hit 1.000 while need was still
    // 0.60, which left the get-up sharing the pose with a walk cycle the whole
    // way through and put 40% of a locomotion pose on an athlete lying on the
    // floor. Taking the max with a term that is 1 while the take is playing
    // gives the clip the pose outright until it has actually finished, then
    // hands back to need for the tail.
    const standDemand = Math.max(state.standUpNeed, standUpHold(state));
    const standShare = afterAction * standDemand;
    const afterStand = afterAction * (1 - standDemand);

    const airShare = afterStand * state.airborneMix;
    const locomotion = afterStand * (1 - state.airborneMix);

    // PUBLISHED, because this arithmetic had three copies — here, weightAudit,
    // and the HUD row in main.js — and the HUD's copy was still on the old tier
    // order after the swap, reporting a slide as 62% stand-up when the mixer
    // was giving it 0%. A duplicated formula that disagrees with the mixer is
    // worse than no readout: it sends you looking for a bug in the blend. One
    // computation, two readers.
    state.shares.stand = standShare;
    state.shares.action = actionShare;
    state.shares.air = airShare;
    state.shares.loco = locomotion;

    state.nodes.idle.action.setEffectiveWeight(state.weights.idle * locomotion);
    state.nodes.idle.action.timeScale = TUNING.anim.timeScale;

    // Ring weights are accumulated per NODE before they are applied, because
    // the back node is fed by two contributions and setEffectiveWeight is a
    // write, not an add — applying them one at a time would silently drop the
    // walk ring's backpedal share whenever the run ring's was written second.
    for (const node of state.cycleNodes) node.pendingWeight = 0;
    for (const c of state.contributions) c.node.pendingWeight += state.weights[c.id];
    for (const node of state.cycleNodes) {
      node.action.setEffectiveWeight(node.pendingWeight * locomotion);
    }

    // The LATCHED mix, not a live one: 1 is the standing jump, 0 the running.
    state.nodes.jump.standing.action.setEffectiveWeight(airShare * state.jumpClipMix);
    state.nodes.jump.running.action.setEffectiveWeight(airShare * (1 - state.jumpClipMix));

    state.nodes.standUp.faceUp.action.setEffectiveWeight(standShare * state.faceUpMix);
    state.nodes.standUp.faceDown.action.setEffectiveWeight(standShare * (1 - state.faceUpMix));

    // Split the action tier between the two by their raw demand.
    const actionTotal = state.slideMix + state.diveMix;
    const slidePart = actionTotal > 0 ? state.slideMix / actionTotal : 0;
    state.nodes.action.slide.action.setEffectiveWeight(actionShare * slidePart);
    state.nodes.action.dive.action.setEffectiveWeight(actionShare * (1 - slidePart));
  }

  // THE ONE MIXER ADVANCE IN THE PROJECT. Constant dt, inside fixedUpdate,
  // exactly once per step. Idle needs it — that action free-runs.
  state.mixer.update(dt);

  // Every clip time in the project is written here, once, immediately after the
  // update. See writeClipTimes for why after and not before.
  if (!pinned) writeClipTimes(state);

  // LAW L5 — NO ROOT MOTION. Mixamo bakes travel into the Hips track; played
  // back as authored, the target would walk out from under the sphere and the
  // tracker would drag the character with it, which is locomotion coming from
  // the animation instead of from input. The two HORIZONTAL components go back
  // to bind every step. The vertical is KEPT: on the cycles that is the bob of
  // the gait, which averages to nothing and without which the walk looks glued
  // down; on the one-shots it is the authored body height, which is the whole
  // shape of a dive, a slide and a stand-up.
  //
  // The axis names come from hipsAxisRoles, because "horizontal" is a fact
  // about the armature's orientation and this rig is Z-up inside a Y-up root.
  state.hips.position[state.hipsAxisA] = state.hipsBindA;
  state.hips.position[state.hipsAxisB] = state.hipsBindB;

  // THE DIVE'S HIP DROP — the vertical axis, and ONLY during a dive.
  //
  // The float is not what it looks like. The take's own vertical is within 8 cm
  // of bind across the dive window (measured: the hips' local up ran -91.8 to
  // -102.0 against a bind of -99.8), so pinning this axis to bind — the obvious
  // reading of "strip the Y" — moves the athlete by almost nothing. What holds
  // him up is that bind height IS standing height: the ghost asks for a pelvis
  // 1.02 m above the floor while the athlete is horizontal, so a horizontal
  // athlete is suspended at hip height. There is no phase of "Running Dive"
  // that fixes it either — its hips only descend as it rolls, and that roll is
  // the scorpion. So the vertical is not stripped, it is LOWERED, faded by
  // diveMix so the drop arrives and leaves with the pose. The mount still
  // carries the arc, so the athlete flies exactly as far as the sphere's
  // impulse throws him — just at the height a diving body is at.
  //
  // THE SLIDE IS NOT TOUCHED, AND MUST NOT BE. "Slide Left" authors its own
  // descent — measured, it carries the hips from -90 to -25 in armature units
  // and puts the ghost's pelvis at 0.278 m with the body 4 mm behind, which is
  // a hip on the ground and not a hover. A slide-side drop was tried and
  // REVERTED: lowering the hips raises pelvisDownness, which the mount blend
  // below reads as "he has fallen over", so past mountSlack the ghost's
  // horizontal position eases off the sphere and onto the pelvis body. That is
  // what "slid sideways out of the sphere" was. The vertical and the mount are
  // coupled through that measurement, and the slide is the case where the
  // coupling bites. The (1 - slideMix) factor is what keeps them apart: the two
  // mixes are independent floats and diveMix takes 18 ticks to decay, so a
  // slide beginning inside that window would otherwise inherit a drop authored
  // for a different pose.
  //
  // THE SIGN. hipsBindUp is NEGATIVE on this armature — the bind is -99.8 for a
  // pelvis that stands at 0.998 m, because the exporter's +90 degree X rotation
  // makes armature-local -Z the way up. So a drop toward the floor is ADDED,
  // not subtracted, and a positive tunable always means "lower".
  //
  // It is an OFFSET, not an assignment. Writing `hipsBindUp + drop` would
  // REPLACE whatever the take authored on this axis; that is harmless for the
  // dive, whose window sits within 8 cm of bind, and it is exactly what made a
  // 0.10 m slide drop move the pelvis UP to 0.921 m. Adding is the form that
  // cannot destroy a take, so adding is the form that stays.
  const diveOnly = state.diveMix * (1 - Math.min(1, state.slideMix));
  if (diveOnly > 0) {
    state.hips.position[state.hipsUpAxis] +=
      TUNING.action.diveHipDrop * diveOnly * state.hipsUnitsPerMetre;
  }

  // mount ∘ armature-local. With the clone root at mount * bindRootLocal, a
  // bone standing in bind pose has targetBoneWorld = mount * bindBoneWorld, so
  // the formula below collapses to targetBodyWorld = mount * bindBodyWorld —
  // exactly where autorig placed that body when it spawned at the same mount.
  mountMatrix(motor, yaw, _mount);

  // A DOWNED ATHLETE GETS UP WHERE HE FELL. Past mountSlack the ghost's
  // horizontal position eases off the sphere and onto the pelvis body's own
  // position, so the stand-up plays under the body rather than dragging it
  // back to a sphere that has rolled away. As need falls the blend returns to
  // the sphere on its own — continuous in need, with nothing switching.
  //
  // Horizontal only. The vertical stays sphere-derived, which is what puts the
  // finished stand-up back on the mount.
  const pelvis = rig && rig.get('pelvis');
  // pelvisDownness, not standUpNeed: this is about where the body physically
  // is, which is the question the mount is asking.
  if (pelvis && state.pelvisDownness > TUNING.standUp.mountSlack) {
    const blend = Math.min(
      1,
      (state.pelvisDownness - TUNING.standUp.mountSlack) / (1 - TUNING.standUp.mountSlack),
    );
    const body = pelvis.body.translation();
    const e = _mount.elements;
    _mountPos.set(e[12], e[13], e[14]);
    e[12] = _mountPos.x + (body.x - _mountPos.x) * blend;
    e[14] = _mountPos.z + (body.z - _mountPos.z) * blend;
  }

  state.root.matrix.multiplyMatrices(_mount, state.bindRootLocal);

  state.root.updateMatrixWorld(true);

  for (const [key, target] of state.targets) {
    const item = rig.get(key);
    if (!item) continue;

    target.prevPos.copy(target.currPos);
    target.prevQuat.copy(target.currQuat);

    // targetBodyWorld = targetBoneWorld * inverse(bindBoneWorld) * bindBodyWorld
    //
    // The bind matrices are the ones autorig captured off the ORIGINAL rig. The
    // clone is the same asset with the same bind pose, so they are its bind too
    // — cloning does not change a local transform. Re-deriving them here would
    // be a second source of truth for the same numbers.
    _bindBoneInverse.copy(item.bindBoneWorld).invert();
    _targetBody.multiplyMatrices(state.bones.get(key).matrixWorld, _bindBoneInverse);
    _targetBody.multiply(item.bindBodyWorld);

    decomposeRigid(_targetBody, _pos, _quat);
    target.currPos.copy(_pos);
    // Keep the quaternion on the same hemisphere as the previous one, so the
    // finite difference below reads a small delta rather than the long way round.
    if (target.currQuat.dot(_quat) < 0) _quat.set(-_quat.x, -_quat.y, -_quat.z, -_quat.w);
    target.currQuat.copy(_quat);

    if (!state.seeded) {
      target.prevPos.copy(target.currPos);
      target.prevQuat.copy(target.currQuat);
    }

    // Finite-differenced target velocities. These are what the L3 clamp damps
    // AGAINST — the tracker damps (body - target), never the body alone.
    target.vel.subVectors(target.currPos, target.prevPos).divideScalar(dt);

    _prevInverse.copy(target.prevQuat).invert();
    _deltaQuat.copy(target.currQuat).multiply(_prevInverse);
    if (_deltaQuat.w < 0) _deltaQuat.set(-_deltaQuat.x, -_deltaQuat.y, -_deltaQuat.z, -_deltaQuat.w);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(_deltaQuat.w)));
    if (angle > MIN_ANGLE) {
      const sin = Math.sqrt(Math.max(0, 1 - _deltaQuat.w * _deltaQuat.w));
      target.angvel
        .set(_deltaQuat.x, _deltaQuat.y, _deltaQuat.z)
        .divideScalar(sin)
        .multiplyScalar(angle / dt);
    } else {
      target.angvel.set(0, 0, 0);
    }
  }

  state.seeded = true;
}

/**
 * THE STRAFE-SIGN ALARM (criterion GF-3.1).
 *
 * A sign error in the yaw rotation is invisible in every number except the one
 * nobody prints: the character strafes, the legs are phase-synced, the weights
 * sum to 1, and the wrong clip plays. It cost a whole task to notice. This
 * makes the next one loud.
 *
 * Only meaningful once there is real lateral motion, hence the 1 m/s gate —
 * below that local.x is noise and either node winning is fine.
 *
 * IT READS THE TARGET WEIGHTS, NOT THE APPLIED ONES. The applied weights are
 * eased at weightEase and therefore LAG local.x, which is instantaneous; swing
 * the camera fast enough and the lagging weights legitimately disagree with the
 * heading for a few ticks. Measured: one false alarm during a fast azimuth
 * sweep, R 0.109 against L 0.047 while local.x had already crossed to -1.16.
 * The targets are the tent product for THIS tick, so comparing against them
 * tests the arithmetic a sign regression would actually break, rather than
 * testing whether the crossfade has caught up yet.
 *
 * @returns {string | null} a description of the violation, or null
 */
export function strafeSignViolation(state) {
  if (!state || !state.targetWeights) return null;
  if (Math.abs(state.localVelX) <= STRAFE_ASSERT_SPEED) return null;

  // The lateral contributions, summed across both rings.
  const right = state.targetWeights.walkR + state.targetWeights.runR;
  const left = state.targetWeights.walkL + state.targetWeights.runL;
  if (Math.abs(right - left) < STRAFE_ASSERT_MARGIN) return null;

  const movingRight = state.localVelX > 0;
  const rightWins = right > left;
  if (movingRight === rightWins) return null;

  return (
    `local.x ${state.localVelX.toFixed(2)} (moving ${movingRight ? 'RIGHT' : 'LEFT'}) ` +
    `but the ${rightWins ? 'RIGHT' : 'LEFT'} strafe node is heavier ` +
    `(R ${right.toFixed(3)} / L ${left.toFixed(3)})`
  );
}

/**
 * THE FLAIL ALARM (criterion GF-3.3). While the airborne override is at full
 * strength the locomotion group must be silent; if it is not, the jump is being
 * driven by the run blend and the arms windmill.
 *
 * THE GATE IS 0.95, NOT THE SPECIFIED 0.9, AND IT HAS TO BE. The locomotion
 * group's share is (1 - airborneMix) by construction, so at airborneMix exactly
 * 0.9 the share is 0.1 — already double the 0.05 limit, with nothing wrong.
 * Seeded at 0.9 the alarm fires on the way through that band on EVERY jump:
 * measured, four times per running jump before this was corrected. The two
 * numbers as given are unsatisfiable together, so the gate moves to where
 * (1 - mix) is under the limit and the check means what it was meant to mean —
 * that locomotion is silent when it should be, rather than that the arithmetic
 * exists.
 *
 * @returns {number | null} the offending locomotion weight, or null
 */
export function flailViolation(state) {
  if (!state || state.airborneMix <= FLAIL_ASSERT_AIR) return null;
  // A slide or dive legitimately takes the tier ABOVE airborne, which leaves
  // the airborne share small while airborneMix is high. That is the precedence
  // working, not a flail, so the alarm stands down while an action is active.
  if (state.slideMix + state.diveMix > FLAIL_ACTION_QUIET) return null;
  let locomotion = state.nodes.idle.action.getEffectiveWeight();
  for (const node of state.cycleNodes) locomotion += node.action.getEffectiveWeight();
  return locomotion > FLAIL_ASSERT_WEIGHT ? locomotion : null;
}

/**
 * CRITERION GF-2.5 — the weight audit.
 *
 * Three numbers, and it matters which one is the invariant.
 *
 *   shares  — standShare + actionShare + airShare + locomotion. EXACTLY 1 by
 *             construction,
 *             always, in every regime. This is the real invariant: it is the
 *             partition that decides how much of the pose each group owns, and
 *             a group silently losing or double-counting its share shows up as
 *             a pose drifting toward bind and as nothing else.
 *   targets — the 2D blend's own tent product, idle plus all nine ring
 *             contributions. Also exactly 1, for the same kind of reason.
 *   applied — what the mixer is actually playing. This one is NOT always 1 and
 *             must not be asserted as though it were: every node's weight is
 *             eased toward its target independently, so during any transition —
 *             including the first second after a spawn, when they all start at
 *             zero — the sum lags below 1 and then converges. Asserting on it
 *             produced a false failure on the very first tick of the very first
 *             boot after this was written, which is a good argument for
 *             measuring the thing you actually mean.
 *
 * @returns {{shares: number, targets: number, applied: number}}
 */
export function weightAudit(state) {
  if (!state) return { shares: 1, targets: 1, applied: 1 };

  // Read, not recomputed. The audit's job is to catch the APPLIED weights
  // drifting from the shares the blend intended; recomputing the shares here
  // would only ever check this function against itself.
  const { stand: standShare, action: actionShare, air: airShare, loco: locomotion } = state.shares;

  let targets = state.targetWeights.idle;
  for (const c of state.contributions) targets += state.targetWeights[c.id];

  let applied = 0;
  for (const node of state.allNodes) applied += node.action.getEffectiveWeight();

  return { shares: standShare + actionShare + airShare + locomotion, targets, applied };
}

/**
 * Re-seeds prev = curr so the first step after a respawn does not read a huge
 * finite-differenced velocity from a target that just teleported to the mount.
 */
export function resetAnimTarget(state) {
  if (!state) return;
  state.seeded = false;
  for (const target of state.targets.values()) {
    target.vel.set(0, 0, 0);
    target.angvel.set(0, 0, 0);
  }
}
