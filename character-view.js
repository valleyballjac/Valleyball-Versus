/**
 * character-view.js
 * ---------------------------------------------------------------------------
 * The VISIBLE character: a skinned `.glb`, an AnimationMixer, and the small
 * amount of arithmetic that keeps it standing on the invisible physics sphere.
 *
 * WHAT CHANGED, AND WHY IT IS SAFE
 *
 * Until now the thing you could see WAS the physics — fifteen rigid bodies
 * welded to fifteen primitives. That is the most honest debug view there is and
 * it is why the controller could be tuned at all. It is also programmer art.
 *
 * So the visible layer is now an animated model and the physics rig keeps
 * running underneath it, invisible, unchanged. Nothing in this file touches a
 * rigid body, a joint motor, the action state machine or the stamina economy.
 * It reads three numbers a frame — position, yaw, and the posture lift — and
 * picks a clip. If it were deleted the game would still play; you just could
 * not see anyone.
 *
 * The procedural dummy is still there and one toggle away, which matters more
 * than it sounds: when the physics does something strange, the question is
 * always "what are the BODIES doing", and an animated mesh cannot answer it.
 *
 * THE ONE PLACE PHYSICS STILL DRIVES THE MESH
 *
 * A knockdown. There is no knockdown clip and there should not be one — the
 * whole point is that the athlete lands differently every time depending on how
 * they fell. So for `knocked` and `recovering` the bones are written from the
 * rig's bodies instead of from a clip. That is the `ragdoll` mode below, and it
 * is the only bone write-back in the file.
 */

import { qMul, qNormalize, adoptTuning } from './rig-math.js';
import { BONE_TO_BODY } from './clip-retarget.js';

export const DEFAULT_VIEW_TUNING = {
  /** Extra yaw applied to the model, in degrees. The rig is authored facing +Z;
      a model authored facing −Z needs 180 here rather than a rebuilt asset. */
  yawOffsetDeg: 0,
  /** Uniform scale, if the delivered model is not in metres after all. */
  scale: 1,
  /** Seconds to cross-fade between clips. Long enough to hide a pop, short
      enough that a dive does not start with a quarter-second of running. */
  fade: 0.15,
  /** Clip playback is scaled to real speed so the feet do not skate. */
  strideMatch: true,
  walkAuthoredFor: 1.45,
  runAuthoredFor: 6.40,
  sprintAuthoredFor: 10.8,
  /** How fast the visual yaw chases the controller's facing, rad/s. The
      controller already slews its facing; this is a second, gentler filter so a
      camera-relative snap does not read as the model teleporting. */
  yawRate: 18,
  /** Blend the model's height toward the posture lift at this rate, m/s.
      Snapping it makes a dive look like the character fell through the floor
      for one frame. */
  liftRate: 6.5,
};

/**
 * THE VISUAL CLIP POLICY — separate from `clipForState` in clip-retarget.js,
 * and deliberately so. That one decides what drives the PHYSICS RIG's joint
 * targets, where the authored dive and slide poses beat any clip. This one
 * decides what the player SEES, where a real clip beats a procedural pose every
 * time. Two consumers, two policies, two sets of tests.
 */
export function visualClipForState(s = {}, thresholds = {}) {
  const walkAt = thresholds.walkAt === undefined ? 0.6 : thresholds.walkAt;
  const runAt = thresholds.runAt === undefined ? 3.4 : thresholds.runAt;
  const sprintAt = thresholds.sprintAt === undefined ? 8.0 : thresholds.sprintAt;
  const action = s.action || 'none';
  const speed = s.speed || 0;

  // A knockdown is SIMULATED. No clip exists and none should — the athlete
  // lands differently every time, which is the entire appeal.
  if (action === 'knocked') return { clip: null, mode: 'ragdoll', reason: 'knocked down' };
  if (action === 'recovering') return { clip: null, mode: 'ragdoll', reason: 'getting up' };

  if (action === 'diving' || action === 'skidding') {
    return { clip: 'dive', mode: 'clip', reason: 'dive' };
  }
  if (action === 'sliding') return { clip: 'slide', mode: 'clip', reason: 'slide' };

  /* A SWING TAKES THE WHOLE BODY. Layering it additively over a run would be
     nicer in a game with an animation stack; here it would need an authored
     upper-body mask that does not exist, and a volleyball hit is a whole-body
     action anyway — the movement throttle (`hitMovePenalty`) already assumes
     you have planted to swing. */
  if (s.hitting && s.hitPhase !== 'idle') {
    return { clip: s.hitKind === 'spike' ? 'spike' : 'volley', mode: 'hit', reason: 'swinging' };
  }
  if (s.grounded === false) return { clip: 'jumpAir', mode: 'clip', reason: 'airborne' };
  if (speed >= sprintAt) return { clip: 'sprint', mode: 'clip', reason: 'sprinting' };
  if (speed >= runAt) return { clip: 'run', mode: 'clip', reason: 'running' };
  if (speed >= walkAt) return { clip: 'walk', mode: 'clip', reason: 'walking' };
  return { clip: 'idle', mode: 'clip', reason: 'idle' };
}

/**
 * STAND-INS for clips the delivered file does not have yet.
 *
 * Named and listed rather than quietly substituted, because a stand-in that
 * nobody knows about is indistinguishable from a bug — someone eventually
 * files "the volley animation looks like a spike" and it takes an afternoon to
 * discover it IS a spike. The view reports which of these are live.
 *
 * `dive → slideStart` is the least-wrong body-going-down motion available.
 * `volley → spike` is frankly wrong — a volley is underhand and a spike is
 * overhand — and is here only so the button does something visible. Both
 * disappear the moment the real clips arrive.
 */
export const CLIP_STANDINS = {
  dive: ['slideStart', 'slide'],
  volley: ['spike'],
  walk: ['run'],
  jump: ['jumpAir'],
};

/**
 * @param {object} p
 * @param {object} p.THREE
 * @param {object} p.gltf     a parsed glTF: {scene, animations}
 * @param {object} p.resolved logical clip name → clip name in the file
 * @param {object} [p.tuning]
 */
export function createCharacterView({ THREE, gltf, resolved, tuning }) {
  // ADOPTED, not copied — see `adoptTuning`. Every slider in the Character
  // folder edits this object while the model is on screen.
  const T = adoptTuning(tuning, DEFAULT_VIEW_TUNING);
  const root = new THREE.Group();
  root.name = 'character-view';

  const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
  if (!model) throw new Error('the file has no scene');
  model.scale.setScalar(T.scale);
  root.add(model);

  /* SHADOWS ON, FRUSTUM CULLING OFF for the skinned meshes. A skinned mesh's
     bounding volume is computed from the BIND pose; a character laid out flat
     in a dive reaches well outside it and vanishes at the screen edge. This is
     the standard fix and it costs one draw call's worth of nothing. */
  const skinned = [];
  model.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      if (o.isSkinnedMesh) skinned.push(o);
    }
  });

  const bones = new Map();
  model.traverse((o) => { if (o.isBone || o.name) bones.set(o.name, o); });

  /* BIND-POSE WORLD ROTATIONS, captured before any clip has played.
     A mixer that has run once leaves the bones wherever the last frame put
     them; a bind snapshot taken then is a snapshot of an arbitrary pose, and it
     shows up later as a permanent lean nobody can source. This project has
     already paid for that exact bug once. */
  model.updateMatrixWorld(true);
  const bindWorld = new Map();
  const bindLocal = new Map();
  {
    const q = new THREE.Quaternion();
    for (const [name, obj] of bones) {
      obj.getWorldQuaternion(q);
      bindWorld.set(name, { x: q.x, y: q.y, z: q.z, w: q.w });
      bindLocal.set(name, obj.quaternion.clone());
    }
  }

  const mixer = new THREE.AnimationMixer(model);
  const clips = new Map((gltf.animations || []).map((c) => [c.name, c]));
  const actions = new Map();
  const state = {
    clip: null, logical: null, mode: 'clip', standins: [],
    lift: T.liftRate > 0 ? null : 0, yaw: 0, ragdoll: false,
  };

  /** Resolve a logical name through the file, then through the stand-ins. */
  function pick(logical) {
    if (!logical) return null;
    const direct = resolved && resolved[logical];
    if (direct && clips.has(direct)) return { name: direct, standin: null };
    for (const alt of CLIP_STANDINS[logical] || []) {
      const sub = resolved && resolved[alt];
      if (sub && clips.has(sub)) return { name: sub, standin: alt };
    }
    return null;
  }

  function actionFor(name) {
    if (!actions.has(name)) {
      const a = mixer.clipAction(clips.get(name));
      a.enabled = true;
      actions.set(name, a);
    }
    return actions.get(name);
  }

  /**
   * Cross-fade to a logical clip.
   * @returns {boolean} whether anything is playing
   */
  function play(logical, opt = {}) {
    const hit = pick(logical);
    if (!hit) return false;
    if (state.clip !== hit.name) {
      const next = actionFor(hit.name);
      next.reset();
      next.setLoop(opt.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = opt.loop === false;
      next.play();
      const prev = state.clip ? actions.get(state.clip) : null;
      if (prev && prev !== next) prev.crossFadeTo(next, T.fade, false);
      else next.fadeIn(T.fade);
      state.clip = hit.name;
      state.logical = logical;
      if (hit.standin && !state.standins.includes(logical)) state.standins.push(logical);
    }
    const a = actions.get(state.clip);
    if (a) a.timeScale = opt.rate === undefined ? 1 : opt.rate;
    return true;
  }

  /** Stop every action — used when the ragdoll takes the bones over. */
  function stopAll() {
    for (const a of actions.values()) a.stop();
    state.clip = null;
    state.logical = null;
  }

  /**
   * Write the physics rig's body rotations onto the bones.
   *
   * The ONLY bone write-back in this file, and it runs only while the athlete
   * is on the floor. Same frame algebra as the retarget, in reverse:
   *
   *     D_body   = bodyNow ∘ bodyBind⁻¹          what physics did to this part
   *     world    = D_body ∘ bindWorld(bone)      where the bone should now be
   *     local    = parentWorld⁻¹ ∘ world         what three.js wants
   *
   * The rig's bodies are built axis-aligned at bind, so `bodyBind` is identity
   * and `D_body` is simply the body's current rotation. That is an assumption
   * about `DUMMY_PARTS`, and it is asserted in the test suite rather than
   * trusted here.
   */
  function writeBonesFromRig(rig) {
    if (!rig) return false;
    let wrote = 0;
    const tmp = new THREE.Quaternion();
    const parentInv = new THREE.Quaternion();
    for (const [boneName, bodyId] of Object.entries(BONE_TO_BODY)) {
      const bone = bones.get(boneName);
      const part = rig.part(bodyId);
      if (!bone || !part || !part.body) continue;
      const r = part.body.rotation();
      const bind = bindWorld.get(boneName);
      if (!bind) continue;
      const world = qNormalize(qMul({ x: r.x, y: r.y, z: r.z, w: r.w }, bind));
      if (bone.parent) {
        bone.parent.getWorldQuaternion(parentInv);
        parentInv.invert();
        tmp.set(world.x, world.y, world.z, world.w).premultiply(parentInv);
        bone.quaternion.copy(tmp);
      } else {
        bone.quaternion.set(world.x, world.y, world.z, world.w);
      }
      wrote++;
    }
    return wrote > 0;
  }

  /** Put every bone back where the file said, before handing control to a clip. */
  function restoreBindLocal() {
    for (const [name, q] of bindLocal) {
      const b = bones.get(name);
      if (b) b.quaternion.copy(q);
    }
  }

  /**
   * One rendered frame.
   *
   * @param {number} dt
   * @param {object} s
   * @param {{x,y,z}} s.position  the sphere's contact point — the FLOOR under it
   * @param {number} s.facingAngle
   * @param {number} s.lift       metres the hips should sit above the floor
   * @param {number} s.speed
   * @param {string} s.action
   * @param {boolean} s.grounded
   * @param {object} [s.rig]      needed only while knocked down
   */
  function update(dt, s = {}) {
    const want = visualClipForState(s);
    state.mode = want.mode;

    if (want.mode === 'ragdoll') {
      if (!state.ragdoll) { stopAll(); state.ragdoll = true; }
      writeBonesFromRig(s.rig);
    } else if (want.mode === 'hit') {
      /* ONE CLOCK, NOT TWO. The action machine already owns windup → active →
         recover and decides when contact is live; the clip is SCRUBBED to that
         progress rather than played at its own rate. Two clocks for one event
         drift, and the failure is silent and horrible — the arm finishes
         swinging while the contact window is still open, or the window opens
         with the arm still back. This project made that rule for the
         procedural swing and it applies just as hard to an authored one. */
      if (state.ragdoll) { restoreBindLocal(); state.ragdoll = false; }
      if (play(want.clip, { loop: false, rate: 0 })) {
        const a = actions.get(state.clip);
        const clip = clips.get(state.clip);
        if (a && clip) {
          a.paused = false;
          a.time = Math.max(0, Math.min(1, s.hitProgress || 0)) * clip.duration;
        }
        mixer.update(0);          // apply the scrub without advancing anything
      } else {
        mixer.update(dt);
      }
    } else {
      if (state.ragdoll) { restoreBindLocal(); state.ragdoll = false; }
      let rate = 1;
      if (T.strideMatch) {
        const authored = want.clip === 'sprint' ? T.sprintAuthoredFor
          : want.clip === 'run' ? T.runAuthoredFor
            : want.clip === 'walk' ? T.walkAuthoredFor : 0;
        if (authored > 0) {
          rate = Math.max(0.55, Math.min(1.85, (s.speed || 0) / authored));
        }
      }
      play(want.clip, { rate });
      mixer.update(dt);
    }

    // --- Position, yaw and the posture lift -------------------------------
    // `position` is the FLOOR under the sphere, and the model's own origin is
    // between its feet - so the two line up with no offset when standing.
    // Authored clips already contain their own root translation. If we also apply
    // the procedural rig's height drop, the character falls through the floor.
    const p = s.position || { x: 0, y: 0, z: 0 };
    const wantLift = state.mode === 'ragdoll' ? (s.lift === undefined ? 0 : s.lift) : 0;
    
    if (state.lift === null) state.lift = wantLift;
    else {
      const k = 1 - Math.exp(-(T.liftRate || 6.5) * Math.max(dt, 1e-4));
      state.lift += (wantLift - state.lift) * k;
    }
    root.position.set(p.x, p.y + state.lift, p.z);

    const wantYaw = (s.facingAngle || 0) + T.yawOffsetDeg * Math.PI / 180;
    let d = wantYaw - state.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));     // shortest way round
    state.yaw += d * Math.min(1, (T.yawRate || 18) * Math.max(dt, 1e-4));
    root.rotation.set(0, state.yaw, 0);
    return state;
  }

  function dispose() {
    if (root.parent) root.parent.remove(root);
    model.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    actions.clear();
  }

  return {
    tuning: T, root, model, mixer, state, bones, bindWorld,
    play, stopAll, update, dispose, writeBonesFromRig, restoreBindLocal,
    get visible() { return root.visible; },
    set visible(v) { root.visible = !!v; },
    get clipNames() { return [...clips.keys()]; },
    get skinnedCount() { return skinned.length; },
    /** Logical clips currently being covered by a stand-in. */
    get standins() { return state.standins.slice(); },
  };
}
