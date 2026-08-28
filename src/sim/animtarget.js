import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { TUNING } from '../config/tuning.js';
import { BONE_MAP, resolveBoneByName } from './autorig.js';

/**
 * THE ANIMATION TARGET.
 *
 * A second, invisible copy of the character that plays the LOCOMOTION BLEND
 * SPACE. It is never
 * rendered and never appears in a capture; its only product is, per fixed step,
 * a world-space target transform for each of the sixteen physics bodies. The
 * tracker then drives the real bodies toward those transforms with forces.
 *
 * The separation is the whole point of the architecture. The animation is
 * allowed to be a perfect, unphysical thing that never stumbles; the physics is
 * allowed to be a real thing that does. Nothing writes a pose onto a body, and
 * nothing writes a force onto the target.
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
const _targetWeights = { idle: 0, jog: 0, sprint: 0 };
const _standQuat = new THREE.Quaternion();
const _standAxis = new THREE.Vector3();
const _mountPos = new THREE.Vector3();

/** The literal that means "run the blend space" rather than pin a clip. */
const AUTO = 'auto';
/** Below this combined gait weight there is no cycle worth advancing. */
const MIN_GAIT_WEIGHT = 1e-4;

/** Signed shortest way round from `from` to `to`, in (-PI, PI]. Same rule the
 *  retired passenger box used, moved here with the mount yaw it belonged to. */
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
    // LAW L5 — the bind-pose horizontal root translation, restored every step.
    hipsBindX: hips.position.x,
    hipsBindZ: hips.position.z,
    mixer: new THREE.AnimationMixer(root),
    // The three blend nodes, all playing at all times.
    nodes: null,
    // The pinned single action when TUNING.anim.override is not 'auto'.
    overrideAction: null,
    overrideName: null,
    /** Eased copy of the sphere's horizontal speed. Debug readout + blend input. */
    smoothedSpeed: 0,
    /** Applied weights, eased toward the tent below. Read by the HUD. */
    weights: { idle: 0, jog: 0, sprint: 0 },
    /** ONE locomotion phase in [0,1), shared by jog and sprint. */
    locomotionPhase: 0,
    // THE STAND-UP, as two continuous signals and one scrub. No latch, no flag.
    standUpNeed: 0,
    standUpProgress: 0,
    faceUpMix: 0,
    standUpNodes: null,
    yaw: 0,
    targetYaw: 0,
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

  buildBlendNodes(state);
  return state;
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
 * Builds the three blend actions. All three are played once, here, and never
 * stopped — the blend is entirely a matter of their weights.
 *
 * WHY NOT crossFadeTo / fadeIn / fadeOut. Those schedule an interpolant against
 * the MIXER'S OWN accumulated time and mutate the action's weight from inside
 * mixer.update. That makes the weight a function of how many times update has
 * been called with what deltas — which is fine in a render-clock game and fatal
 * here, because a fade in flight is hidden state that no longer follows from the
 * tick alone, and the anchored capture stops being reproducible. The eased
 * weights computed below ARE the crossfade, they live in our state, and they are
 * a pure function of the sphere's speed history.
 *
 * jog and sprint get timeScale 0 deliberately. Their times are driven from the
 * shared locomotion phase further down; leaving the mixer free to advance them
 * as well would mean two authorities on the same number, and the one that wrote
 * last would win by accident rather than by design.
 */
function buildBlendNodes(state) {
  const { idleClip, jogClip, sprintClip } = TUNING.anim.blend;

  const make = (name, timeScale) => {
    const clip = findClip(state, name);
    if (!clip) {
      throw new Error(
        `[animtarget] blend clip "${name}" is not in the asset; available: ` +
          state.clips.map((c) => c.name).join(', '),
      );
    }
    const action = state.mixer.clipAction(clip);
    action.reset();
    action.time = 0;
    action.timeScale = timeScale;
    action.setEffectiveWeight(0);
    action.play();
    return { action, duration: clip.duration, name: clip.name };
  };

  state.nodes = {
    // Idle free-runs on the mixer: it is not part of the gait cycle and has no
    // phase to keep.
    idle: make(idleClip, 1),
    jog: make(jogClip, 0),
    sprint: make(sprintClip, 0),
  };

  // The two stand-up clips join on the same terms as jog and sprint: timeScale
  // 0, sampled from a scrub we own. Their scrub is standUpProgress.
  state.standUpNodes = {
    faceDown: make(TUNING.standUp.faceDownClip, 0),
    faceUp: make(TUNING.standUp.faceUpClip, 0),
  };

  console.log(
    `[animtarget] blend space: ${state.nodes.idle.name} (${state.nodes.idle.duration.toFixed(2)}s) / ` +
      `${state.nodes.jog.name} (${state.nodes.jog.duration.toFixed(2)}s) / ` +
      `${state.nodes.sprint.name} (${state.nodes.sprint.duration.toFixed(2)}s)`,
  );
}

/** Exponential ease, expressed against the constant dt so it is rate-correct. */
function ease(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/**
 * The tent. Below jogSpeed the weight splits between idle and jog; between
 * jogSpeed and sprintSpeed it splits between jog and sprint; above sprintSpeed
 * sprint owns everything. The three always sum to 1.
 */
function tentWeights(speed, out) {
  const { idleSpeed, jogSpeed, sprintSpeed } = TUNING.anim.blend;

  if (speed <= idleSpeed) {
    out.idle = 1; out.jog = 0; out.sprint = 0;
  } else if (speed < jogSpeed) {
    const t = (speed - idleSpeed) / (jogSpeed - idleSpeed);
    out.idle = 1 - t; out.jog = t; out.sprint = 0;
  } else if (speed < sprintSpeed) {
    const t = (speed - jogSpeed) / (sprintSpeed - jogSpeed);
    out.idle = 0; out.jog = 1 - t; out.sprint = t;
  } else {
    out.idle = 0; out.jog = 0; out.sprint = 1;
  }
  return out;
}

/**
 * THE STAND-UP, as two continuous signals and a self-closing feedback loop.
 *
 * There is no "am I down" boolean and nothing to enter or leave. Two numbers are
 * read off the pelvis body every step and everything follows from them:
 *
 *   standUpNeed — how far the pelvis is below standing height, 0..1, eased.
 *   faceUpMix   — which way the pelvis is facing, 0..1, smoothed through a band
 *                 so that a body lying on its side does not flicker between the
 *                 two clips.
 *
 * THE FLOOR APPROXIMATION. Height is the pelvis's world y, not its height above
 * the surface beneath it. The bowl floor is y = 0 across the whole flat centre,
 * which is where a knocked-down character almost always ends up, and on the wall
 * the same formula reads slightly LOW — it says "more down than you are", which
 * errs toward standing up, which is the harmless direction. Sampling the true
 * arena height under the pelvis would mean a raycast per step to fix a case that
 * resolves itself.
 *
 * THE FEEDBACK LOOP, which is the whole design and is deliberately circular:
 *
 *   progress = max(progress + minRate * dt, 1 - standUpNeed)
 *
 * The ghost plays the stand-up clip slightly AHEAD of the body. The PD tracker
 * hauls the body up along the clip's arc; as the body rises, standUpNeed falls;
 * as need falls, `1 - need` pushes progress further along the clip; the clip
 * pulls the body higher still. The loop closes itself and the character stands.
 *
 * minRate is what stops it deadlocking. A body pinned under something, or simply
 * slow, would otherwise sit at progress 0 with need 1 forever, because progress
 * is driven by a rise that is not happening. The floor rate means the clip
 * always advances, so the ghost always reaches for the finished pose, and the
 * worst case is that the tracker keeps trying rather than that it stops.
 */
function advanceStandUp(state, rig, dt) {
  const tuning = TUNING.standUp;
  const pelvis = rig && rig.get('pelvis');

  if (!pelvis) {
    state.standUpNeed = 0;
    state.standUpProgress = 0;
    return;
  }

  const translation = pelvis.body.translation();
  const rawNeed = Math.min(1, Math.max(0, 1 - translation.y / tuning.pelvisStandHeight));
  state.standUpNeed = ease(state.standUpNeed, rawNeed, tuning.ease, dt);

  // Which way up. The pelvis body's local +Z against world up.
  const rotation = pelvis.body.rotation();
  _standQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
  _standAxis.set(0, 0, 1).applyQuaternion(_standQuat);
  const faceUpness = _standAxis.dot(WORLD_UP);

  const band = Math.max(1e-3, tuning.faceBlendBand);
  const rawMix = Math.min(1, Math.max(0, (faceUpness + band) / (2 * band)));
  state.faceUpMix = ease(state.faceUpMix, rawMix, tuning.ease, dt);

  // THE SCRUB, in two directions, blended rather than branched.
  //
  //   advanced — the feedback loop: at least minRate, faster as the body rises.
  //   retired  — rewinding toward the start of the clip.
  //
  // A pure `max(progress + minRate*dt, 1 - need)` cannot rewind: standing
  // upright makes `1 - need` equal 1 and pins progress there forever, so the
  // SECOND knockdown would start at the end of the stand-up clip and the
  // character would never get up again. Measured before this was fixed —
  // progress sat oscillating at 0.98 with the character on its feet.
  //
  // `k` is how far down the character is, measured against the same mountSlack
  // the mount blend uses: 1 while down, 0 while standing. Blending the two
  // candidates by it gives the advance when it is needed and the rewind when it
  // is not, with no branch and nothing latched.
  const advanced = Math.max(state.standUpProgress + tuning.minRate * dt, 1 - state.standUpNeed);
  const retired = Math.max(0, state.standUpProgress - tuning.minRate * dt * 2);
  const k = Math.min(1, state.standUpNeed / Math.max(1e-3, tuning.mountSlack));

  state.standUpProgress = Math.min(1, retired + (advanced - retired) * k);
}

/**
 * Advances the blend space one fixed step: speed in, weights and phase out.
 *
 * THE SINGLE LOCOMOTION PHASE is the reason this is not just three weighted
 * actions. Jog and sprint are two recordings of the same gait at different
 * rates. Blended out of phase — left foot forward in one, right foot forward in
 * the other — they average to a pose with the legs together and straight, and
 * the PD tracker will chase that faithfully, so the character glides through the
 * crossfade with no legs. One phase drives both, so the same foot is forward in
 * both clips at every instant and the average is still a running pose.
 */
function advanceBlend(state, motor, dt) {
  const blend = TUNING.anim.blend;

  // 1 — SPEED IN, eased. Read-only on the motor.
  const linear = motor.body.linvel();
  const raw = Math.hypot(linear.x, linear.z);
  state.smoothedSpeed = ease(state.smoothedSpeed, raw, blend.speedSmoothing, dt);

  // 2 — TARGET WEIGHTS.
  tentWeights(state.smoothedSpeed, _targetWeights);

  // 3 — APPLIED WEIGHTS, eased toward the target.
  const w = state.weights;
  w.idle = ease(w.idle, _targetWeights.idle, blend.weightEase, dt);
  w.jog = ease(w.jog, _targetWeights.jog, blend.weightEase, dt);
  w.sprint = ease(w.sprint, _targetWeights.sprint, blend.weightEase, dt);

  // 4 — PHASE. Cycles per second is the weight-blended reciprocal duration over
  // the two gait clips; idle has no cycle and is excluded. The gait weight is
  // renormalised over jog+sprint so that at low speed, where idle owns most of
  // the weight, the legs still turn over at the jog rate rather than crawling.
  const gait = w.jog + w.sprint;
  let cyclesPerSecond = 0;
  let nominal = 0;

  if (gait > MIN_GAIT_WEIGHT) {
    const jogShare = w.jog / gait;
    const sprintShare = w.sprint / gait;
    cyclesPerSecond =
      jogShare / state.nodes.jog.duration + sprintShare / state.nodes.sprint.duration;
    nominal = jogShare * TUNING.anim.stride.jogNominal + sprintShare * TUNING.anim.stride.sprintNominal;
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
 * Applies TUNING.anim.override. 'auto' means the blend space; anything else
 * pins that one clip at weight 1, which is the Task 4 single-clip behaviour.
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
      const node = [state.nodes.idle, state.nodes.jog, state.nodes.sprint].find(
        (n) => n.name === wanted,
      );
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
          state.overrideAction.time = 0;
          state.overrideAction.play();
        }
      }
    }
  }

  if (state.overrideName === AUTO) return false;

  // Pinned: the named action owns all the weight, the rest own none.
  for (const node of [state.nodes.idle, state.nodes.jog, state.nodes.sprint]) {
    node.action.setEffectiveWeight(node.action === state.overrideAction ? 1 : 0);
  }
  if (state.overrideAction) {
    state.overrideAction.setEffectiveWeight(1);
    state.overrideAction.timeScale = TUNING.anim.timeScale;
  }
  return true;
}

/** Where the target rig stands: sphere centre, dropped by the sphere radius so
 *  the feet sit at the bottom of the ball. */
export function mountMatrix(motor, yaw, out) {
  const translation = motor.body.translation();
  _mountQuat.setFromAxisAngle(WORLD_UP, yaw);
  _pos.set(translation.x, translation.y - motor.radius, translation.z);
  return out.compose(_pos, _mountQuat, _unitScale);
}

/** The mount yaw the character should be facing, eased at the fixed rate. */
export function advanceMountYaw(state, motor, dt) {
  const linear = motor.body.linvel();
  const speed = Math.hypot(linear.x, linear.z);

  if (speed > TUNING.visual.turnSpeedThreshold) {
    state.targetYaw = Math.atan2(linear.x, linear.z);
  }

  const blend = 1 - Math.exp(-TUNING.visual.turnLerpSpeed * dt);
  state.yaw += shortestAngleDelta(state.yaw, state.targetYaw) * blend;
  return state.yaw;
}

/**
 * One fixed step of the target: advance the clip, strip the root motion, plant
 * the rig on the sphere, and derive a world target transform per body.
 *
 * @param {object} state
 * @param {object} motor the sphere motor (READ ONLY — nothing here touches it)
 * @param {Map<string, object>} rig the RigMap, for its captured bind matrices
 * @param {number} dt the constant timestep
 */
export function updateAnimTarget(state, motor, rig, dt) {
  if (!state) return;

  // Speed in, weights and phase out. Pure function of sim state and the tick.
  advanceBlend(state, motor, dt);
  advanceStandUp(state, rig, dt);

  const pinned = applyOverride(state);
  if (!pinned) {
    // THE OVERLAY TAKES ITS WEIGHT FROM THE LOCOMOTION GROUP, so the four
    // actions still sum to 1. There is no separate "stand-up mode" competing
    // with locomotion — standUpNeed is simply how much of the total pose is the
    // stand-up clip, and it is a continuous number.
    const locomotion = 1 - state.standUpNeed;

    state.nodes.idle.action.setEffectiveWeight(state.weights.idle * locomotion);
    state.nodes.jog.action.setEffectiveWeight(state.weights.jog * locomotion);
    state.nodes.sprint.action.setEffectiveWeight(state.weights.sprint * locomotion);
    state.nodes.idle.action.timeScale = TUNING.anim.timeScale;

    state.standUpNodes.faceUp.action.setEffectiveWeight(state.standUpNeed * state.faceUpMix);
    state.standUpNodes.faceDown.action.setEffectiveWeight(state.standUpNeed * (1 - state.faceUpMix));
  } else {
    state.standUpNodes.faceUp.action.setEffectiveWeight(0);
    state.standUpNodes.faceDown.action.setEffectiveWeight(0);
  }

  // THE ONE MIXER ADVANCE IN THE PROJECT. Constant dt, inside fixedUpdate,
  // exactly once per step. Idle needs it — that action free-runs.
  state.mixer.update(dt);

  // JOG AND SPRINT TIMES ARE OVERWRITTEN AFTER THE UPDATE, DELIBERATELY.
  //
  // Both carry timeScale 0, so mixer.update does not advance them; it samples
  // them at whatever time was last written here, and this write sets the time
  // the NEXT sample will use. The pose therefore trails the phase by exactly one
  // fixed step, uniformly, for both clips — which is invisible and, more to the
  // point, identical on every run.
  //
  // Writing the times BEFORE the update instead would have the mixer advance
  // from them and sample somewhere we did not choose, putting two authorities on
  // one number. This way the phase is the only authority.
  if (!pinned) {
    state.nodes.jog.action.time = state.locomotionPhase * state.nodes.jog.duration;
    state.nodes.sprint.action.time = state.locomotionPhase * state.nodes.sprint.duration;
    // Same mechanism, different scrub: the stand-up clips are sampled at the
    // progress the feedback loop above produced.
    state.standUpNodes.faceUp.action.time =
      state.standUpProgress * state.standUpNodes.faceUp.duration;
    state.standUpNodes.faceDown.action.time =
      state.standUpProgress * state.standUpNodes.faceDown.duration;
  }

  // LAW L5 — NO ROOT MOTION. Mixamo bakes forward travel into the Hips track;
  // played back as authored, the target would walk out from under the sphere and
  // the tracker would drag the character with it, which is locomotion coming
  // from the animation instead of from input. The horizontal components go back
  // to bind every step. The animated Y is KEPT: that is the vertical bob of the
  // gait, it averages to nothing, and without it the walk looks glued down.
  state.hips.position.x = state.hipsBindX;
  state.hips.position.z = state.hipsBindZ;

  // mount ∘ armature-local. With the clone root at mount * bindRootLocal, a
  // bone standing in bind pose has targetBoneWorld = mount * bindBoneWorld, so
  // the formula below collapses to targetBodyWorld = mount * bindBodyWorld —
  // exactly where autorig placed that body when it spawned at the same mount.
  const yaw = advanceMountYaw(state, motor, dt);
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
  if (pelvis && state.standUpNeed > TUNING.standUp.mountSlack) {
    const blend = Math.min(
      1,
      (state.standUpNeed - TUNING.standUp.mountSlack) / (1 - TUNING.standUp.mountSlack),
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
