import { buildCourt } from './court-geometry.js';
import { qMul, qConj, qNormalize, qRotate, qFromAxisAngle, qFromUnitVectors, qToRotationVector, qAngleBetween, qSlerp, qSwingTwist, twistAngle, swingAngle, qClampSwingTwist, trMul, trInverse, adoptTuning } from './rig-math.js';
import { DEFAULT_TUNING, torqueForAccel, maxRollAccel, rollAxis, createAthleteBody, athleteColliderDesc, computeDiveImpulse, createAthleteController } from './athlete-controller.js';
import { DEFAULT_STAMINA_TUNING, inclineDrainRate, createAthleteStamina } from './athlete-stamina.js';
import { DEFAULT_ACTION_TUNING, createAthleteActions } from './athlete-actions.js';
import { DEFAULT_INPUT_TUNING, BUTTONS, DEFAULT_BINDINGS, cameraBasisFromYaw, writeCameraBasis, applyDeadzone, createAthleteInput } from './athlete-input.js';
import { DEFAULT_BALL_TUNING, DEFAULT_HIT_TUNING, createGameBall, hitDirection, spikeAngleAt, evaluateReach, reachFailure, reachOptions, computeHitImpulse, contactPoint } from './game-ball.js';
import { DEFAULT_CAMERA_TUNING, sphericalToCartesian, shortestAngle, approachAngle, ease, lerpFactor, distanceToFit, boundingSphere, CAMERA_MODES, createCameraDirector } from './camera-director.js';
import { LAYER, groups, membershipOf, filterOf, canCollide, GROUPS_WORLD, GROUPS_BALL, GROUPS_ATHLETE, groupsPuppet, RAY_FILTER, ALL_GROUPS } from './collision-layers.js';
import { BONE_TO_BODY, BODY_PARENT, PARENT_BONE, CLIP_ALIASES, REQUIRED_CLIPS, resolveClips, retargetPose, worldRotations, clipForState, strideRate } from './clip-retarget.js';
import { DEFAULT_VIEW_TUNING, visualClipForState, CLIP_STANDINS, createCharacterView } from './character-view.js';
import { DUMMY_PARTS, DUMMY_CORE, DUMMY_TORSO, GAIN_GROUPS, GROUP_OF, DUMMY_PELVIS_Y, DUMMY_HINGES, DUMMY_LIMITS, DUMMY_MODES, DEFAULT_DUMMY_TUNING, partAABB, spawnOverlaps, planDummyMass, DEFAULT_GAIT, gaitTargets, ARM_FWD, SWING_POSES, LEG_FWD, POSTURES, swingTargets, gaitRate, createDummyRig } from './dummy-rig.js';
import * as THREE from 'three';
import { setupTuningGUI } from './tuning-gui.js';
import { createGameHud } from './game-hud.js';
import RAPIER from '@dimforge/rapier3d-compat';


// Each stage is announced BEFORE it runs, so whichever one hangs or throws is
// the one named in the diagnostic. Cheap, and it converts a blank screen into a
// sentence.
window.__bootStage('initialising the Rapier physics engine (WASM)');
await RAPIER.init();
window.__bootStage('building the scene');

const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 5;

const TUNING = Object.assign({}, DEFAULT_TUNING);
const INPUT_T = Object.assign({}, DEFAULT_INPUT_TUNING);
const ACT = Object.assign({}, DEFAULT_ACTION_TUNING);
const BALL = Object.assign({}, DEFAULT_BALL_TUNING);
const HIT = Object.assign({}, DEFAULT_HIT_TUNING);
const CAM = Object.assign({}, DEFAULT_CAMERA_TUNING);
const STAM = Object.assign({}, DEFAULT_STAMINA_TUNING);
const VIEW = Object.assign({}, DEFAULT_VIEW_TUNING);

/* Authored-clip settings. Declared HERE with the other tuning objects rather
   than beside the clip machinery further down, because the GUI is built before
   that point and a `const` read before its declaration is a temporal-dead-zone
   throw â€” which is a blank page. The audit caught exactly that. */
const CLIPS = {
  /** 0..1 how much of the authored pose shows through. 0 = pure procedural. */
  weight: 1.0,
  /** Match playback rate to real speed so the feet do not skate. */
  strideMatch: true,
  /** m/s each locomotion cycle was authored for. Editable: the artist tells us. */
  walkAuthoredFor: 1.45,
  runAuthoredFor: 6.40,
  sprintAuthoredFor: 10.8,
  /** Live readout, filled in on load. */
  status: 'no file loaded',
};
const DUM = Object.assign({}, DEFAULT_DUMMY_TUNING);
const GAIT = Object.assign({}, DEFAULT_GAIT);

/** Where the puppet sits relative to the ball, and how it's oriented. */
const PUPPET = {
  physical: true,      // drive the skeleton from Rapier bodies
  showRig: true,       // wireframes over the 16 collider bodies
  scale: 1.0,
  yawOffset: 0,        // radians; set to Ï€ if your model faces âˆ’Z
  yOffset: 0,          // fine-tune so the feet meet the ground
  showBall: true,      // the debug wireframe on the physics body
  // Two sets of axes drawn on top of each other: where the animation wants a
  // body pointing, and where it actually points. If they separate, tracking is
  // wrong â€” and the AXIS that separates says which one.
  showAxes: false,
  axesSize: 0.16,      // m
  // Self-collision, OFF. A 16-body ragdoll that collides with itself spends the
  // first frame resolving elbow-inside-ribs and the rest exploding, and it makes
  // a tracking bug and a clipping bug look identical. Kept as a switch so the
  // claim "it isn't self-collision" can be checked rather than asserted.
  selfCollide: false,
};

/* COLLISION LAYERS live in collision-layers.js â€” the bitmask arithmetic, the
   full interaction matrix and the reasoning are all documented there, and the
   matrix is asserted in the suite rather than eyeballed here.

   The headline change: the invisible locomotion sphere no longer touches the
   ball. It is a physics implementation detail with no mesh, so when it batted
   the ball around, the ball appeared to rebound off nothing half a metre from
   the character â€” a bug that looked like it was in the ball. Only the puppet's
   limbs may strike it now, which is also what makes a hit feel earned.

   GROUPS_WORLD / GROUPS_BALL / GROUPS_ATHLETE / RAY_FILTER are imported. */
const puppetGroups = () => groupsPuppet(PUPPET.selfCollide);

/* ===========================================================================
   RENDERER / SCENE
   =========================================================================== */
// Preflight WebGL rather than letting the constructor throw. THREE's own error
// is generic and lands in the console where nobody is looking; this one says
// what to do about it.
window.__bootStage('creating the WebGL context');
(function assertWebGL() {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') || probe.getContext('webgl');
  if (!gl) {
    window.__bootFail('WebGL is not available',
      'This page needs a WebGL context and the browser would not give one.\n\n' +
      'Usually one of:\n' +
      '  - hardware acceleration is off (Chrome: Settings > System)\n' +
      '  - the GPU is blocklisted (see chrome://gpu)\n' +
      '  - too many live WebGL contexts â€” try closing other tabs');
    throw new Error('WebGL unavailable');
  }
})();
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
scene.fog = new THREE.Fog(0x0d1117, 46, 110);

/* --- Camera ---------------------------------------------------------------
   Four rigs behind one director. Perspective by default; orthographic is still
   in the Camera folder because the flat iso read is genuinely useful for judging
   distance while tuning, but it is no longer what you get on load.
   ------------------------------------------------------------------------- */
const director = createCameraDirector({
  THREE,
  aspect: window.innerWidth / window.innerHeight,
  tuning: CAM,
  mode: 'action',
  homeTheta: 45 * Math.PI / 180,      // the old iso yaw, now just a default
  onModeChange: (m) => toast(`${m.label} â€” ${m.blurb}`),
});

// The movement basis is no longer a constant. It is rebuilt every frame from
// whatever yaw the active rig publishes, so "stick up" always means "away from
// the camera" â€” including halfway through an orbit or a mode change.
const cameraBasis = cameraBasisFromYaw(45 * Math.PI / 180);

scene.add(new THREE.AmbientLight(0xffffff, 0.42));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(18, 26, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;   sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0005;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x88aaff, 0.3);
fill.position.set(-14, 10, -16);
scene.add(fill);

/* ===========================================================================
   PHYSICS WORLD + COURSE
   =========================================================================== */
const world = new RAPIER.World({ x: 0, y: -TUNING.worldGravity, z: 0 });
world.timestep = FIXED_DT;

const surfaceMeshes = buildCourt(scene, world);

/* ===========================================================================
   THE INVISIBLE BALL â€” dynamic rigid body, rotations locked.
   It owns every bit of movement: velocity, momentum, slopes, jump.
   =========================================================================== */
const SPAWN = { x: 0, y: 2.0, z: -12 };
const { body: rootBody, collider: rootCollider } =
  createAthleteBody(RAPIER, world, TUNING, SPAWN);
rootCollider.setCollisionGroups(GROUPS_ATHLETE);

const controller = createAthleteController({
  RAPIER, world, body: rootBody, collider: rootCollider, tuning: TUNING,
  probeFilterGroups: RAY_FILTER,
});

/* --- Stamina --------------------------------------------------------------
   The resource layer, built BEFORE the action machine because the action
   machine takes it as a collaborator. It is the single place that can refuse a
   dive, a slide or a swing on affordability grounds; see the note on
   `createAthleteActions` for why the gate is not in the input listeners.
   ---------------------------------------------------------------------- */
const stamina = createAthleteStamina({
  tuning: STAM,
  onExhausted: () => toast('Exhausted'),
  // A refused action has to SAY something. An unexplained refusal is
  // indistinguishable from a broken button â€” which this project has already
  // shipped once, when the slide silently did nothing.
  onDenied: (kind) => toast(`Too tired to ${kind}`),
});

// The action machine owns slide/dive/knockdown state and lives entirely outside
// the visual layer, so every action works with no character model loaded.
const actions = createAthleteActions({
  tuning: ACT,
  stamina,
  onTransition: (to, from, why) => {
    if (to === 'knocked') toast(`Knocked down â€” ${why}`);
    else if (to === 'sliding') toast('Sliding');
    else if (to === 'diving') launchDive();
  },
});

/* --- Debug wireframe, welded to the physics body ------------------------- */
const ballDebug = new THREE.Group();
scene.add(ballDebug);

const ballWire = new THREE.Mesh(
  new THREE.SphereGeometry(TUNING.radius, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0x4ecdc4, wireframe: true, transparent: true, opacity: 0.55 })
);
// Named so the audit can find it and assert that it really does follow the
// body's ROTATION â€” the roll was always happening and was simply never drawn.
ballWire.name = 'sphere-wire';
ballDebug.add(ballWire);

// Velocity vector, so momentum is literally visible.
const velArrow = new THREE.ArrowHelper(
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 1, 0xffb14e, 0.22, 0.12);
ballDebug.add(velArrow);

// Facing marker â€” where the puppet is being told to point.
const faceArrow = new THREE.ArrowHelper(
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), TUNING.radius * 2.1, 0x1f6feb, 0.16, 0.1);
ballDebug.add(faceArrow);

// Contact marker â€” where the ground probe says the ball is touching.
const contactDot = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 8, 6),
  new THREE.MeshBasicMaterial({ color: 0xff6b5b })
);
scene.add(contactDot);

/* ===========================================================================
   THE PUPPET â€” a PHYSICAL character, not a decorated transform.

   The visual mesh is not parented to anything that moves. Every bone is placed
   from a Rapier body each frame, in world space, so what you see on screen is
   the simulation itself rather than a picture of it. The locomotion sphere
   still owns travel; the puppet's core is welded to it, and its limbs are free
   bodies on motorised joints.

   The holder groups below stay at IDENTITY while the rig is driving. That is
   load-bearing: the rig produces world transforms, and a translated or scaled
   node above the skeleton would apply itself twice. Scale and offsets are
   folded into the bind pose BEFORE the rig is fitted, which is why changing
   them re-fits rather than just moving the model.
   =========================================================================== */
/* ===========================================================================
   THE DUMMY
   ---------------------------------------------------------------------------
   Programmer art on purpose. Boxes, a sphere and capsules, one Rapier body
   each, welded one-to-one to the mesh you see.

   What used to sit here â€” a GLTF loader, a drag-and-drop veil, a skinned
   stand-in, a bind-pose snapshot, a bone-hierarchy walk, clip binding,
   retargeting and a world-to-local write-back â€” is gone. Every one of those was
   a place a frame could be wrong, and every one of them rendered as the same
   symptom: a limb flailing. There is no way to tell them apart by looking, so
   the only way to find out whether the PHYSICS is right is to delete them and
   see. The skinned path still exists in puppet-rig.js and its tests still pass;
   it is simply not in this page any more.

   `dummyRoot` stays at IDENTITY. That is load-bearing: the rig produces world
   transforms, so a translated or rotated node above it would apply itself twice
   and the character would travel double distance.
   =========================================================================== */
const dummyRoot = new THREE.Group();
/* VISIBLE UNTIL A CHARACTER ARRIVES, then hidden â€” not hidden from the start.
   A page built without a model (a fresh clone, CI, or anyone who has not been
   sent the .glb) must still show something; starting hidden would mean an empty
   court and no clue why. `adoptCharacter` is what puts the primitives away, and
   only once there is something to put them away FOR.

   `visible` on the GROUP rather than per-mesh: the axes helpers and the joint
   debug live under here too and should come and go with it. */
dummyRoot.visible = true;
/* Recorded, because it is an invariant worth asserting and it cannot be read
   back later: by the time anything inspects the page, the debug UI may have
   been exercised and the live value tells you nothing about what the player saw
   when the page opened. A build with no model must open showing SOMETHING. */
const BOOT_DUMMY_VISIBLE = dummyRoot.visible;
scene.add(dummyRoot);

const DUMMY_MAT = {
  core: new THREE.MeshStandardMaterial({ color: 0x3f6fb5, roughness: 0.75, metalness: 0.05 }),
  limb: new THREE.MeshStandardMaterial({ color: 0x5e9ae0, roughness: 0.7, metalness: 0.05 }),
  grip: new THREE.MeshStandardMaterial({ color: 0xffb14e, roughness: 0.6, metalness: 0.05 }),
};

let rig = null;

const modelMsgEl = document.getElementById('modelMsg');
const modelHintEl = document.getElementById('modelHint');
function msg(text) { if (modelMsgEl) modelMsgEl.innerHTML = text; }

/* --- Frame debugger ------------------------------------------------------
   Two AxesHelpers per body, drawn at the SAME point:

     solid, short   the Rapier body's live rotation
     faint, long    where the gait wants it

   Co-located deliberately. Separation is the error, and which axis separates
   says which term is wrong: a constant twist about one axis is a frame
   mismatch, a wobble is gain, a slow drift is the parent chain.
   ------------------------------------------------------------------------ */
const axesDebug = new THREE.Group();
axesDebug.name = 'frame-axes';
axesDebug.visible = false;
scene.add(axesDebug);

function clearAxesDebug() {
  while (axesDebug.children.length) {
    const c = axesDebug.children.pop();
    c.geometry && c.geometry.dispose();
    c.material && c.material.dispose();
    axesDebug.remove(c);
  }
}

function buildAxesDebug() {
  clearAxesDebug();
  for (const part of rig.order) {
    const live = new THREE.AxesHelper(1);
    live.material.depthTest = false;
    live.renderOrder = 3;
    live.userData = { id: part.id, role: 'body' };

    const want = new THREE.AxesHelper(1);
    want.material.depthTest = false;
    want.material.transparent = true;
    want.material.opacity = 0.45;
    want.renderOrder = 2;
    want.userData = { id: part.id, role: 'target' };

    axesDebug.add(live, want);
  }
  axesDebug.visible = PUPPET.showAxes;
}

function updateAxesDebug() {
  if (!axesDebug.visible || !rig) return;
  for (const helper of axesDebug.children) {
    const part = rig.part(helper.userData.id);
    if (!part) { helper.visible = false; continue; }
    const t = part.body.translation();
    helper.position.set(t.x, t.y, t.z);
    if (helper.userData.role === 'body') {
      const r = part.body.rotation();
      helper.quaternion.set(r.x, r.y, r.z, r.w);
      helper.scale.setScalar(PUPPET.axesSize);
      helper.visible = true;
    } else {
      const q = part.targetWorldQ;
      // No target (ragdoll, or the root) â€” hide it rather than leaving a stale
      // frame on screen implying it is being tracked.
      if (!q) { helper.visible = false; continue; }
      helper.quaternion.set(q.x, q.y, q.z, q.w);
      helper.scale.setScalar(PUPPET.axesSize * 1.55);
      helper.visible = true;
    }
  }
}

/**
 * Build (or rebuild) the dummy.
 *
 * Cheap enough to call on any structural change, because there is nothing to
 * load and nothing to fit: the body plan is a table.
 */
function buildDummy() {
  if (rig) { rig.destroy(); rig = null; }
  clearAxesDebug();

  const p = rootBody.translation();
  try {
    rig = createDummyRig({
      RAPIER, world, THREE,
      tuning: DUM,
      spawn: { x: p.x, y: p.y - TUNING.radius, z: p.z },
      collisionGroups: puppetGroups(),
      materials: DUMMY_MAT,
      // The LIVE world gravity, not a constant. The compensation has to match
      // what the solver is actually applying, or it under- or over-corrects the
      // moment someone touches the gravity slider.
      gravity: { x: 0, y: -TUNING.worldGravity, z: 0 },
    });
  } catch (err) {
    console.error('[athlete] dummy rig failed', err);
    msg(`<b>Dummy rig unavailable.</b> ${err.message}`);
    return;
  }
  dummyRoot.add(rig.group);
  buildAxesDebug();

  // Overlapping colliders at spawn are an impulse the size of the penetration
  // on frame one â€” the classic ragdoll that explodes on load. Checked rather
  // than asserted, and reported where it will actually be seen.
  const overlaps = spawnOverlaps();
  if (overlaps.length) {
    console.warn('[athlete] parts overlap at spawn:', overlaps);
  }

  const mp = rig.massPlan;
  console.log(`[athlete] dummy: ${rig.state.bodies} bodies, ${rig.state.joints} joints `
    + `(${rig.state.motorisedJoints} motorised hinges, ${rig.state.torqueJoints} torque-driven), `
    + `${rig.state.contactsDisabled} adjacent pairs with contacts off, `
    + `${overlaps.length} spawn overlaps`);
  console.log(`[athlete] mass: torso x${mp.scale.toFixed(2)} â†’ torso:heaviest-limb `
    + `${mp.ratioBefore.toFixed(2)}:1 â†’ ${mp.ratioAfter.toFixed(2)}:1, total `
    + `${mp.totalBefore.toFixed(1)} â†’ ${mp.totalAfter.toFixed(1)} kg`);

  msg(`<b>Procedural dummy</b> â€” ${rig.state.bodies} primitives, ${rig.state.joints} joints, `
    + `${rig.state.motorisedJoints} hinges with hard limits. No file, no skin, no bones: `
    + `every shape you can see is a rigid body.`);
}

/** Push the physics onto the meshes. Once per rendered frame, not per step. */
function syncDummy() {
  if (!rig) return;
  rig.sync();
  updateAxesDebug();
}


/* ===========================================================================
   INPUT
   =========================================================================== */
const keys = new Set();

/* --- Mouse look -----------------------------------------------------------
   Deltas accumulate here between samples rather than being read on demand,
   because mousemove fires on its own schedule: several events can land inside
   one animation frame, and a frame can pass with none at all. Reading "the
   latest delta" throws away everything but the last event of the burst.

   Pointer lock is OFF by default and opt-in. Grabbing the cursor the first time
   someone clicks the page also swallows their clicks on the tuning panel, which
   reads as the UI being broken.
   ------------------------------------------------------------------------ */
const MOUSE = { dx: 0, dy: 0, pointerLock: false, dragging: false };

const input = createAthleteInput({
  getGamepads: () => (navigator.getGamepads ? navigator.getGamepads() : []),
  keys, mouse: MOUSE, tuning: INPUT_T,
});

const canvas = renderer.domElement;
const locked = () => document.pointerLockElement === canvas;

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && MOUSE.pointerLock && !locked() && canvas.requestPointerLock) {
    canvas.requestPointerLock();
  }
  MOUSE.dragging = true;
});
window.addEventListener('mouseup', () => { MOUSE.dragging = false; });
window.addEventListener('mousemove', (e) => {
  // Drag-to-look when unlocked, free-look when locked. movementX/Y is the
  // right source either way: it survives the cursor hitting a screen edge,
  // which raw clientX differencing does not.
  if (!locked() && !MOUSE.dragging) return;
  MOUSE.dx += e.movementX || 0;
  MOUSE.dy += e.movementY || 0;
});
document.addEventListener('pointerlockchange', () => {
  if (!locked()) { MOUSE.dx = 0; MOUSE.dy = 0; MOUSE.dragging = false; }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  director.zoom(Math.sign(e.deltaY) * 0.12);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const typing = () => {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
};
window.addEventListener('keydown', (e) => {
  if (typing()) return;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyR') respawn();
  if (e.code === 'KeyB') serveBall();
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => input.clear());

// A pad reporting a non-"standard" mapping has different button indices, so the
// face buttons land somewhere else entirely â€” movement keeps working (the stick
// axes are usually right) while every action button silently does nothing.
let padWarning = false;
window.addEventListener('gamepadconnected', (e) => {
  const pad = e && e.gamepad;
  if (!pad) return;
  padWarning = pad.mapping !== 'standard';
  console.log(`[athlete] gamepad: ${pad.id} â€” mapping "${pad.mapping}", ` +
    `${pad.buttons.length} buttons, ${pad.axes.length} axes`);
  toast(padWarning
    ? `Pad reports a non-standard mapping â€” action buttons may be misbound`
    : `Gamepad ready: ${pad.id}`);
});
window.addEventListener('gamepaddisconnected', () => { padWarning = false; });

/* ===========================================================================
   THE GAME BALL

   One ball, not a pile of props. It is the thing the sport is about, so it gets
   its own collision bit and its own tuning â€” and crucially it is NOT in the
   ground-probe filter, so it can never be mistaken for terrain.
   =========================================================================== */
const ballEntity = createGameBall(
  RAPIER, world, BALL,
  { x: SPAWN.x, y: SPAWN.y + BALL.spawnHeight, z: SPAWN.z + 2 },
  GROUPS_BALL);
const ballBody = ballEntity.body;

const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(BALL.radius, 20, 14),
  new THREE.MeshStandardMaterial({ color: 0xffb14e, roughness: 0.55, metalness: 0.03 })
);
ballMesh.castShadow = true;
ballMesh.receiveShadow = true;
scene.add(ballMesh);

// Seam stripes, so spin is readable â€” a plain sphere gives no rotation cue.
for (const axis of ['x', 'y']) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(BALL.radius * 0.99, BALL.radius * 0.07, 6, 20),
    new THREE.MeshStandardMaterial({ color: 0x8a4b1a, roughness: 0.6 })
  );
  if (axis === 'x') ring.rotation.y = Math.PI / 2;
  else ring.rotation.x = Math.PI / 2;
  ballMesh.add(ring);
}

// A ground shadow marker. In a fixed isometric view a ball in the air is
// genuinely hard to locate; this tells you where it will come down.
const ballShadow = new THREE.Mesh(
  new THREE.RingGeometry(BALL.radius * 0.55, BALL.radius * 0.95, 20),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
);
ballShadow.rotation.x = -Math.PI / 2;
scene.add(ballShadow);

// Reach indicator: shows when the ball is close enough to actually hit.
const BASE_RING_RADIUS = HIT.volleyReach;
const reachRing = new THREE.Mesh(
  new THREE.RingGeometry(BASE_RING_RADIUS - 0.05, BASE_RING_RADIUS, 32),
  new THREE.MeshBasicMaterial({ color: 0x4ecdc4, transparent: true, opacity: 0.22, depthWrite: false })
);
reachRing.rotation.x = -Math.PI / 2;
scene.add(reachRing);

const ballRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

/* --- Hit-volume debug ----------------------------------------------------
   These are SPHERES now, because that is exactly what the reach test is: one
   3-D distance from the contact point, widened by the ball's radius. The old
   cylinders matched the old test (a horizontal radius plus a height window),
   and a debug volume that does not match its test is worse than none â€” it
   reports reachable where the code says no.

   The spike's 150Â° arc is drawn as a partial sphere via SphereGeometry's phi
   wedge, so the shape on screen IS the predicate. Unit radius, scaled at
   runtime; the wedge is rebuilt only when the arc actually changes.

   Three.js phi runs about +Y with phi = Ï€/2 pointing at +Z, and our facing
   convention has yaw 0 pointing at +Z too, so a wedge centred on Ï€/2 lines up
   under a plain rotation.y = facingAngle.
   ------------------------------------------------------------------------ */
function wedgeGeometry(arcDeg) {
  const arc = Math.min(360, Math.max(10, arcDeg || 360)) * Math.PI / 180;
  const full = arc >= Math.PI * 2 - 1e-6;
  return new THREE.SphereGeometry(
    1, full ? 24 : 18, 14,
    full ? 0 : Math.PI / 2 - arc / 2,
    full ? Math.PI * 2 : arc
  );
}

function makeVolume(color) {
  const m = new THREE.Mesh(
    wedgeGeometry(360),
    new THREE.MeshBasicMaterial({
      color, wireframe: true, transparent: true, opacity: 0.18, depthWrite: false,
    })
  );
  m.userData.arcDeg = 360;
  m.visible = false;
  scene.add(m);
  return m;
}
const volleyVolume = makeVolume(0x4ecdc4);
const spikeVolume = makeVolume(0xffb14e);

/**
 * Size and place a volume to exactly match its reach test.
 * `opts` is whatever reachOptions() returned, so the radius drawn is the same
 * expression evaluateReach() compares against: reach + ball radius.
 */
function fitVolume(mesh, contact, opts, live, facing) {
  if (mesh.userData.arcDeg !== opts.arcDeg) {
    mesh.geometry.dispose();
    mesh.geometry = wedgeGeometry(opts.arcDeg);
    mesh.userData.arcDeg = opts.arcDeg;
  }
  mesh.scale.setScalar(opts.reach + (opts.ballRadius || 0));
  mesh.position.set(contact.x, contact.y, contact.z);
  mesh.rotation.y = facing || 0;
  mesh.material.opacity = live ? 0.42 : 0.13;
}

// Impulse arrow: origin and direction of the force actually applied, held
// briefly after the hit so it can be read at normal speed.
const impulseArrow = new THREE.ArrowHelper(
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0x4ecdc4, 0.3, 0.18);
impulseArrow.visible = false;
scene.add(impulseArrow);

// Whiff marker: a line from the contact point to the ball it failed to reach.
const whiffArrow = new THREE.ArrowHelper(
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0xff6b5b, 0.2, 0.12);
whiffArrow.visible = false;
scene.add(whiffArrow);

// Dive marker: the launch vector of the impulse, drawn to the scale of the
// velocity change so a sprinting dive visibly reads longer than a standing one.
const diveArrow = new THREE.ArrowHelper(
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 1, 0xc46bff, 0.3, 0.16);
diveArrow.visible = false;
scene.add(diveArrow);

const DEBUG = {
  /* THE PRIMITIVES, off by default now that there is a character to look at.
     Not deleted, and the difference matters: when the physics does something
     strange the only question worth asking is "what are the BODIES doing", and
     an animated mesh cannot answer it. One toggle away, and it draws OVER the
     model so the two can be compared directly. */
  showDummy: false,
  showVolumes: true,
  showImpulse: true,
  arrowHold: 0.7,
  /** Bypass the ground gate on dives, so the mechanic can be tested in the air. */
  allowMidairDive: false,
};
let arrowUntil = -1, whiffUntil = -1, diveUntil = -1;
const tmpDir = new THREE.Vector3();

/**
 * Fire the dive. Driven from the action machine's transition hook, so the
 * impulse lands on the exact step the state flips â€” a step later and the dive
 * drag has already begun eating it.
 */
let lastDive = null;
/* THE STICK AT THE MOMENT OF THE PRESS, latched in the input phase.

   `launchDive` fires from the action machine's transition hook, which runs
   inside `actions.update()` â€” there is no `inp` in scope there, and reaching
   for one would mean either a global or a closure over a stale frame. The
   input phase writes the world-space stick direction here; the hook reads it a
   few microseconds later on the same step. */
const diveAim = { x: 0, z: 0 };
function launchDive() {
  const r = controller.dive(diveAim);
  lastDive = { speed: r.launchSpeed, lift: r.deltaV.y, at: elapsed, source: r.source };
  toast(`Dive â€” ${r.launchSpeed.toFixed(1)} m/s (${r.source})`);
  if (DEBUG.showImpulse) {
    const p = rootBody.translation();
    diveArrow.position.set(p.x, p.y, p.z);
    diveArrow.setDirection(
      tmpDir.set(r.deltaV.x, r.deltaV.y, r.deltaV.z).normalize());
    diveArrow.setLength(0.8 + r.launchSpeed * 0.11, 0.3, 0.16);
    diveArrow.visible = true;
    diveUntil = elapsed + DEBUG.arrowHold * 1.6;
  }
}

/**
 * Is the variable-height jump boost actually being GRANTED this step?
 *
 * The jump is one impulse plus a hold: `jumpCutMul` makes gravity heavier the
 * moment the button is released, so holding it genuinely buys altitude. That
 * hold is what the per-second drain pays for, and it is only real while all
 * three of these hold â€” button down, still rising, not on the ground. Billing
 * on `jumpHeld` alone would charge for a button pressed while walking.
 */
function jumpBoostActive(inp) {
  return !!inp.jumpHeld
    && !controller.state.grounded
    && controller.state.verticalVelocity > 0.05;
}

/** Put the ball above the athlete, at rest. */
function serveBall() {
  const p = rootBody.translation();
  ballBody.setTranslation({ x: p.x, y: p.y + BALL.spawnHeight, z: p.z }, true);
  ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

/** Drop it at the athlete's feet, just in front. */
function dropBall() {
  const p = rootBody.translation();
  const f = controller.state.facingAngle;
  ballBody.setTranslation({
    x: p.x + Math.sin(f) * 1.1,
    y: p.y + 0.6,
    z: p.z + Math.cos(f) * 1.1,
  }, true);
  ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

/**
 * Resolve a swing against the ball. Called only while the contact window is
 * open, so timing is decided by the action machine, not here.
 */
let lastHit = { kind: null, speed: 0, elevation: 0, at: -99 };
let lastMiss = null;
function resolveHit(kind, elapsed) {
  const p = rootBody.translation();
  const contact = contactPoint(p, TUNING.radius, HIT);
  const bp = ballBody.translation();
  const opts = reachOptions(kind, HIT, BALL.radius);
  const reach = evaluateReach(contact, bp, controller.state.facingAngle, opts);
  if (!reach.inReach) {
    // Show WHY, pointing at the ball that was missed.
    if (DEBUG.showImpulse) {
      tmpDir.set(bp.x - contact.x, bp.y - contact.y, bp.z - contact.z);
      const len = tmpDir.length();
      if (len > 0.01) {
        whiffArrow.position.set(contact.x, contact.y, contact.z);
        whiffArrow.setDirection(tmpDir.normalize());
        whiffArrow.setLength(len, 0.2, 0.12);
        whiffArrow.visible = true;
        whiffUntil = elapsed + DEBUG.arrowHold;
        lastMiss = reachFailure(reach, opts);
      }
    }
    return false;
  }

  // Height above the deck decides how steep a spike is.
  const groundY = groundHeightUnder(p);
  const heightAboveGround = (p.y - TUNING.radius) - groundY;

  const r = computeHitImpulse({
    kind,
    facingAngle: controller.state.facingAngle,
    heightAboveGround,
    ballVelocity: ballBody.linvel(),
    playerVelocity: rootBody.linvel(),
    ballMass: (ballBody.mass && ballBody.mass()) || BALL.mass,
    tuning: HIT,
  });
  ballBody.wakeUp && ballBody.wakeUp();
  ballBody.applyImpulse(r.impulse, true);

  if (DEBUG.showImpulse) {
    impulseArrow.position.set(contact.x, contact.y, contact.z);
    impulseArrow.setDirection(tmpDir.set(r.direction.x, r.direction.y, r.direction.z));
    impulseArrow.setLength(1.0 + Math.hypot(r.deltaV.x, r.deltaV.y, r.deltaV.z) * 0.09, 0.3, 0.18);
    impulseArrow.material && (impulseArrow.visible = true);
    impulseArrow.visible = true;
    arrowUntil = elapsed + DEBUG.arrowHold;
    whiffArrow.visible = false;
  }

  lastHit = {
    kind,
    speed: Math.hypot(r.deltaV.x, r.deltaV.y, r.deltaV.z),
    elevation: r.elevationDeg,
    at: elapsed,
  };
  return true;
}

/** Terrain height directly under a world point, ignoring the ball. */
function groundHeightUnder(p) {
  ballRay.origin.x = p.x; ballRay.origin.y = p.y + 0.5; ballRay.origin.z = p.z;
  ballRay.dir.x = 0; ballRay.dir.y = -1; ballRay.dir.z = 0;
  const hit = world.castRay(ballRay, 60, true, undefined, RAY_FILTER, rootCollider, rootBody);
  if (!hit) return 0;
  const toi = hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
  return (p.y + 0.5) - toi;
}

/* ===========================================================================
   KNOCKDOWN â€” pure keyframed sequence. No ragdoll, no colliders change.
   =========================================================================== */
// ONE facing angle, owned by the controller. The shell used to slew its own
// from velocity at PUPPET.turnRate while the controller slewed a different one
// from the stick at TUNING.turnRate â€” and the debug volumes, the reach ring and
// the HUD all read the shell's while the shot that actually fired read the
// controller's. A debug overlay that disagrees with its own predicate is worse
// than no overlay.
const facing = () => controller.state.facingAngle;

function knockDown(reason) {
  // Kill horizontal momentum outright: the sequence is authored, so residual
  // velocity would slide the character across the floor while it plays.
  rootBody.setLinvel({ x: 0, y: rootBody.linvel().y, z: 0 }, true);
  rootBody.resetForces(true);
  actions.knockDown(reason || 'manual');
}
/* `frozen`, NOT `movementLocked`. They used to be the same set. Now that a dive
   and a skid also lock movement â€” you committed, you do not get to steer â€” a
   `movementLocked` test here would refuse the debug knockdown key mid-dive,
   which is exactly the moment you most want to press it. */
const isKnocked = () => actions.physics.frozen;

function respawn() {
  controller.respawn(SPAWN);
  actions.reset();
  // A full tank. Respawning is not a punishment mechanic â€” falling off the map
  // and then being unable to move for another two seconds is two penalties for
  // one mistake, and the second one is invisible.
  stamina.reset();
}

/* ===========================================================================
   UI
   =========================================================================== */
const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

document.getElementById('knock').addEventListener('click', () => knockDown('manual'));
document.getElementById('respawn').addEventListener('click', respawn);
document.getElementById('serve').addEventListener('click', serveBall);
document.getElementById('dropBall').addEventListener('click', dropBall);

const reSurface = () => controller.refreshSurface();
const pending = { jump: false, slide: false, dive: false, volley: false, spike: false };
const gui = setupTuningGUI(
  { TUNING, INPUT_T, ACT, BALL, HIT, CAM, STAM, VIEW, DUM, GAIT, CLIPS, PUPPET, DEBUG, pending, ballDebug, contactDot, axesDebug, dummyRoot, getRig: () => rig, director, world, stamina, MOUSE, ballEntity, ballBody, getView: () => view },
  { serveBall, dropBall, buildDummy, launchDive, reSurface, toast, rebuildBall, knockDown, respawn, onResize },
  scene
);


function rebuildBall() {
  controller.rebuildCollider();
  controller.collider.setCollisionGroups(GROUPS_ATHLETE);
  ballWire.geometry.dispose();
  ballWire.geometry = new THREE.SphereGeometry(TUNING.radius, 16, 12);
}

const hud = createGameHud(document);

/* ===========================================================================
   AUTHORED CLIPS â€” an OPTIONAL base layer, loaded from a .glb
   ---------------------------------------------------------------------------
   THE SCOPE HERE IS DELIBERATELY SMALL, and the smallness is the feature.

   What used to live in this file was a full skinned path: a loader, a bind-pose
   snapshot, a bone-hierarchy walk, clip binding, retargeting, and a
   world-to-local write-back onto a SkinnedMesh. Every one of those was a place
   a frame could be wrong, and all of them rendered as the same symptom â€” a limb
   flailing â€” so it was deleted to find out whether the physics was right.

   This is the first half of it back, and only the first half. It reads bone
   rotations out of a clip and hands the rig a set of joint TARGETS. It binds no
   mesh, writes back to no bone, and touches no renderer state. The dummy you
   can see is still the physics, unchanged; the clips only change what the
   motors are aiming at.

   And it is OFF until a file is dropped. No file, no behaviour change â€” the
   procedural gait runs exactly as it did, which is what makes this safe to add
   to a controller that is already tuned.
   =========================================================================== */
/* The shadow armature: plain Object3Ds mirroring the file's bone hierarchy,
   driven by an AnimationMixer and read for world rotations. It is never added
   to the scene â€” nothing here is drawn. Keeping it out of `scene` is what stops
   it interacting with the camera bounds, the shadow map, or a traversal that
   expects everything under `scene` to be gameplay. */
const clipState = {
  loaded: false, root: null, mixer: null, action: null, current: null,
  bones: new Map(), bind: new Map(), clips: new Map(), resolved: {}, missing: [],
  time: 0,
};

/** The visible character, once a file with geometry has been loaded. */
let view = null;
let characterInfo = null;

function bakeBindRotations() {
  clipState.root.updateMatrixWorld(true);
  clipState.bind.clear();
  const q = new THREE.Quaternion();
  for (const [name, obj] of clipState.bones) {
    obj.getWorldQuaternion(q);
    clipState.bind.set(name, { x: q.x, y: q.y, z: q.z, w: q.w });
  }
}

function readWorldPose() {
  clipState.root.updateMatrixWorld(true);
  const out = new Map();
  const q = new THREE.Quaternion();
  for (const [name, obj] of clipState.bones) {
    obj.getWorldQuaternion(q);
    out.set(name, { x: q.x, y: q.y, z: q.z, w: q.w });
  }
  return out;
}

/**
 * Adopt a parsed glTF as the clip source.
 *
 * Takes the already-parsed object rather than a URL, because the page is opened
 * from `file://` as often as it is served, and a fetch of a sibling file is
 * blocked there. Dropping the file onto the window always works.
 */
function adoptClipSource(gltf) {
  // The bind pose has to be captured BEFORE any clip has ever played. A mixer
  // that has run once leaves the bones wherever the last frame put them, and a
  // bind snapshot taken then is a snapshot of an arbitrary pose â€” which shows
  // up later as a permanent lean nobody can source.
  clipState.root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
  if (!clipState.root) throw new Error('the file has no scene');
  clipState.bones.clear();
  clipState.root.traverse((o) => { if (o.name) clipState.bones.set(o.name, o); });
  bakeBindRotations();

  clipState.clips.clear();
  for (const c of gltf.animations || []) clipState.clips.set(c.name, c);
  const r = resolveClips([...clipState.clips.keys()]);
  clipState.resolved = r.resolved;
  clipState.missing = r.missing;

  clipState.mixer = new THREE.AnimationMixer(clipState.root);
  clipState.action = null;
  clipState.current = null;
  clipState.loaded = clipState.clips.size > 0;

  const meshes = [];
  clipState.root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) meshes.push(o); });
  CLIPS.status = `${clipState.clips.size} clips, ${clipState.bones.size} bones`
    + (meshes.length ? `, ${meshes.length} meshes` : ', NO MESH (clips only)')
    + (r.missing.length ? ` Â· missing: ${r.missing.join(', ')}` : ' Â· complete set');
  return { clips: clipState.clips.size, missing: r.missing, meshes: meshes.length };
}

/** Cross-fade to a logical clip, resolving it against what the file has. */
function playClip(logical, rate) {
  if (!clipState.loaded) return false;
  const name = clipState.resolved[logical];
  if (!name) return false;
  if (clipState.current !== name) {
    const next = clipState.mixer.clipAction(clipState.clips.get(name));
    next.reset().play();
    // A cross-fade rather than a cut: the rig is a spring, and stepping its
    // target between two poses rings every joint in the chain.
    if (clipState.action) clipState.action.crossFadeTo(next, 0.18, false);
    clipState.action = next;
    clipState.current = name;
  }
  if (clipState.action) clipState.action.timeScale = rate === undefined ? 1 : rate;
  return true;
}

/**
 * One step of the clip layer. Called from the fixed physics step, before the
 * rig updates, so the targets it writes are the ones this step's motors chase.
 */
function stepClips(dt, st, speed) {
  if (!clipState.loaded || !rig) { if (rig) rig.setClipPose(null, 0); return; }

  const want = clipForState({ action: st.action, speed, grounded: st.isGrounded });
  // PROCEDURAL WINS where the physics owns the pose â€” the dive lay-out, the
  // slide's asymmetric tuck, the knockdown. Handing the rig a null pose puts it
  // straight back on the authored-in-code targets for exactly those frames.
  if (want.procedural || !want.clip) { rig.setClipPose(null, 0); return; }

  let rate = 1;
  if (CLIPS.strideMatch) {
    const authored = want.clip === 'sprint' ? CLIPS.sprintAuthoredFor
      : want.clip === 'run' ? CLIPS.runAuthoredFor
        : want.clip === 'walk' ? CLIPS.walkAuthoredFor : 0;
    if (authored > 0) rate = strideRate(speed, authored);
  }
  if (!playClip(want.clip, rate)) { rig.setClipPose(null, 0); return; }

  clipState.mixer.update(dt);
  rig.setClipPose(retargetPose(clipState.bind, readWorldPose()), CLIPS.weight);
}

/* --- Getting a file in ---------------------------------------------------
   Dynamic import, so a page opened with no network (or with the CDN blocked)
   still boots and still plays â€” it simply cannot load clips. A static import
   would take the whole page down with it. */
let GLTFLoaderClass = null;
async function ensureLoader() {
  if (GLTFLoaderClass) return GLTFLoaderClass;
  const mod = await import('three/addons/loaders/GLTFLoader.js');
  GLTFLoaderClass = mod.GLTFLoader;
  return GLTFLoaderClass;
}

/**
 * Adopt a parsed glTF as the VISIBLE character.
 *
 * A file with geometry replaces the dummy; a file without one is a clip library
 * and leaves the dummy alone. Deciding by inspection rather than by filename is
 * the difference between a clear message and an afternoon: the last delivery
 * was named like a character and contained no mesh at all.
 */
function adoptCharacter(gltf, label) {
  if (view) { view.dispose(); view = null; }
  const r = resolveClips((gltf.animations || []).map((c) => c.name));
  view = createCharacterView({
    THREE, gltf, resolved: r.resolved, tuning: VIEW,
  });
  scene.add(view.root);
  // The primitives step aside, but stay one toggle away.
  dummyRoot.visible = !!DEBUG.showDummy;
  characterInfo = {
    label,
    clips: (gltf.animations || []).length,
    skinned: view.skinnedCount,
    missing: r.missing,
    standins: [],
  };
  return characterInfo;
}

async function loadFromArrayBuffer(buf, label) {
  try {
    const Loader = await ensureLoader();
    const loader = new Loader();
    const gltf = await new Promise((res, rej) => loader.parse(buf, '', res, rej));

    // WHAT IS ACTUALLY IN THE FILE decides what it is used for.
    let meshes = 0;
    const scn = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (scn) scn.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) meshes++; });

    if (meshes > 0) {
      const info = adoptCharacter(gltf, label);
      modelMsgEl.innerHTML = `<b>${label}</b> â€” ${info.skinned} skinned meshes, ${info.clips} clips`;
      modelHintEl.innerHTML = info.missing.length
        ? `No clip for: <b>${info.missing.join(', ')}</b> â€” stand-ins and procedural poses cover them.`
        : 'Full clip set resolved.';
      toast(`Character loaded â€” ${label}`);
    } else {
      const info = adoptClipSource(gltf);
      modelMsgEl.innerHTML = `<b>${label}</b> â€” ${info.clips} clips, <b>no mesh</b> (the dummy stays)`;
      modelHintEl.textContent = info.missing.length
        ? `Missing clips (procedural poses cover these): ${info.missing.join(', ')}`
        : 'Full clip set resolved.';
      toast(`Clips loaded â€” ${info.clips}`);
    }
  } catch (err) {
    CLIPS.status = `load failed: ${err && err.message}`;
    modelMsgEl.innerHTML = '<b>Could not load that file</b>';
    modelHintEl.textContent = String((err && err.message) || err);
    toast('Load failed');
    console.error('[athlete] glb load failed', err);
  }
}

/* The character, baked into the page at build time as a data URI. `null` in the
   source; `build.mjs` substitutes the real thing. A data URI is same-origin
   everywhere, so this works on a double-click with no server and no drag â€”
   which is the entire reason it is here. */
const EMBEDDED_CHARACTER = /* __EMBEDDED_CHARACTER__ */null;

/* AUTO-LOAD. The embedded copy first, then a sibling file for anyone serving
   the page and iterating on the asset without rebuilding. A sibling fetch fails
   silently under `file://` â€” that is expected, not an error. */
async function tryAutoLoad() {
  if (EMBEDDED_CHARACTER) {
    try {
      const res = await fetch(EMBEDDED_CHARACTER);
      await loadFromArrayBuffer(await res.arrayBuffer(), 'Valleyball Demo Player');
      return true;
    } catch (err) {
      console.warn('[athlete] embedded character failed to parse', err);
    }
  }
  for (const url of ['./player.glb', './Valleyball Demo Player_Male.glb']) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      await loadFromArrayBuffer(await res.arrayBuffer(), url.replace('./', ''));
      return true;
    } catch (err) { /* expected under file:// â€” keep the dummy and say nothing */ }
  }
  return false;
}

{
  const veil = document.getElementById('dropveil');
  const show = (on) => { if (veil) veil.className = on ? 'on' : ''; };
  window.addEventListener('dragover', (e) => { e.preventDefault(); show(true); });
  window.addEventListener('dragleave', () => show(false));
  window.addEventListener('drop', (e) => {
    e.preventDefault(); show(false);
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => loadFromArrayBuffer(fr.result, f.name);
    fr.readAsArrayBuffer(f);
  });
}

/* ===========================================================================
   LOOP
   =========================================================================== */
function onResize() {
  director.setAspect(window.innerWidth / window.innerHeight);
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
onResize();

// The stand-in is rigged immediately, so the page opens on a physically-driven
// character rather than on an invitation to go and find a model.
buildDummy();

const clock = new THREE.Clock();
let elapsed = 0;
let camState = director.state;
// One reach computation per frame, shared by ring, volumes and HUD.
const reach = { contact: { x: 0, y: 0, z: 0 }, volley: null, spike: null,
  volleyOpts: null, spikeOpts: null, groundY: 0 };
const tmpVec = new THREE.Vector3();
const FALL_LIMIT = -30;
let accumulator = 0;

/* ===========================================================================
   THE PLAYER STATE MACHINE
   ---------------------------------------------------------------------------
   One object, refreshed once per physics step, that answers every "what is the
   character doing right now" question the rest of the file used to answer by
   reaching into three different modules and combining booleans inline.

   Why it earns its place: `actions.physics.passive && !actions.physics.diving`
   appeared in four places and meant "sliding". Written out four times, it is
   four opportunities to get one of them wrong, and the fourth one will be
   written by someone who does not know about the other three. Naming it once
   makes adding a fifth state â€” stunned, blocking, serving â€” an edit in one
   place instead of a hunt.

   The AUTHORITY still lives in athlete-actions.js. This is a view, not a second
   source of truth; nothing here decides anything.
   =========================================================================== */
const player = {
  // --- Locomotion ---------------------------------------------------------
  isGrounded: false,
  isAirborne: false,
  speed: 0,
  facingAngle: 0,
  /** Travelling in a direction the body is not facing â€” i.e. strafing. */
  isStrafing: false,

  // --- Action states, mutually exclusive ----------------------------------
  action: 'none',        // 'none' | 'sliding' | 'diving' | 'skidding'
                         //        | 'knocked' | 'recovering'
  isSliding: false,
  isDiving: false,
  /** Coasting out of a dive: no input, low friction, waiting for the speed to go. */
  isSkidding: false,
  isKnocked: false,

  // --- Overlays, which ride alongside any of the above --------------------
  isHitting: false,
  hitKind: null,
  hitPhase: 'idle',

  // --- Resources ----------------------------------------------------------
  stamina: 0,
  /** 0..1 â€” what the bar's width wants, computed once rather than at each use. */
  staminaFraction: 1,
  /** The exhaustion penalty window is running: no regen, nothing affordable. */
  isExhausted: false,
  /** An action was refused for stamina reasons in the last fraction of a second. */
  staminaDenied: false,
  /** Sprinting AND paying for it. False when the trigger is held but unaffordable. */
  isSprinting: false,
  /** Climbing hard enough to be taxed for it, in points/s. 0 on the flat. */
  inclineDrain: 0,
  /** Points/s of recovery right now â€” 0 while blocked, slow while moving. */
  staminaRegen: 0,

  /** Movement input is ignored entirely â€” knocked down or getting up. */
  isLocked: false,
};

/**
 * Recompute the view. Called once per physics step, after the action machine
 * has decided but before anything consumes the result.
 */
function refreshPlayerState(speed, extra = {}) {
  const phys = actions.physics;
  player.isGrounded = controller.state.grounded;
  player.isAirborne = !controller.state.grounded;
  player.speed = speed;
  player.facingAngle = controller.state.facingAngle;
  player.isStrafing = !!controller.state.strafing;

  player.action = actions.state;
  /* READ, DO NOT DERIVE. These were once computed here as "passive but not
     diving", which was a correct definition of sliding for exactly as long as
     there were two passive states. The skid made it wrong â€” a skid would have
     been reported as a slide, and would have played the slide's posture and
     asked the controller for the slide's steering. The action machine publishes
     all three explicitly now; this just copies them. */
  player.isSliding = phys.sliding;
  player.isDiving = phys.diving;
  player.isSkidding = phys.skidding;
  player.isKnocked = phys.frozen;
  player.isLocked = actions.movementLocked;

  player.isHitting = actions.hitting;
  player.hitKind = actions.hit.kind;
  player.hitPhase = actions.hit.phase;

  // --- Resources ----------------------------------------------------------
  player.stamina = stamina.value;
  player.staminaFraction = stamina.fraction;
  player.isExhausted = stamina.exhausted;
  player.staminaDenied = stamina.denied;
  player.isSprinting = !!extra.sprinting;
  player.inclineDrain = extra.inclineDrain || 0;
  player.staminaRegen = stamina.regenRate;
  return player;
}

/* ===========================================================================
   THE FRAME
   ---------------------------------------------------------------------------
   Three phases with one job each, in the only order that is correct:

     readInput()    sample the devices, latch edge-triggered presses
     stepPhysics()  fixed-step: actions â†’ controller â†’ rig â†’ world.step()
     renderFrame()  read the settled physics and draw it

   The split is not cosmetic. Input is sampled on the RENDER frame because that
   is when devices are polled; physics runs on a FIXED step because a solver
   integrated at a variable rate behaves differently on different machines; and
   rendering happens once per frame because drawing a picture nobody sees is
   waste. Collapsing them puts one of the three on the wrong clock, and the
   symptom is always something that "works on my machine".
   =========================================================================== */

/**
 * PHASE 1 â€” INPUT.
 *
 * Reads the devices, resolves the stick against the live camera basis, and
 * latches the edge-triggered presses. Touches no physics.
 */
function readInput(dt) {
  // Rebuilt from the ACTIVE rig's published yaw every frame. This is the line
  // that keeps "stick up" meaning "away from the camera" once the camera can
  // orbit; skip it and the controls quietly rotate away from the view.
  writeCameraBasis(cameraBasis, director.basisYaw);
  const inp = input.sample(cameraBasis);

  if (inp.knockPressed && !isKnocked()) knockDown('debug key');
  if (inp.camNextPressed) director.cycle(1);
  if (inp.camPrevPressed) director.cycle(-1);

  // Free look. Stick and mouse are scaled differently on purpose: the stick is
  // a RATE, so it is multiplied by the frame time; the mouse is a DISPLACEMENT,
  // which is not. Treating them the same makes the mouse frame-rate dependent.
  if (inp.lookMagnitude > 0) {
    director.look(inp.lookX * CAM.padLookSpeed * dt, inp.lookY * CAM.padLookSpeed * dt);
  }
  if (inp.mouseLookX || inp.mouseLookY) {
    director.look(inp.mouseLookX * CAM.mouseLookSpeed, inp.mouseLookY * CAM.mouseLookSpeed);
  }

  /* LATCHED, not read inline. A frame whose accumulator has not reached a full
     step runs the physics loop ZERO times â€” on a 144 Hz display that is most
     frames â€” and any press read inline on such a frame is silently dropped.
     Latching holds it until a step actually consumes it. */
  if (inp.jumpPressed) pending.jump = true;
  if (inp.slidePressed) pending.slide = true;
  if (inp.divePressed) pending.dive = true;
  if (inp.volleyPressed) pending.volley = true;
  if (inp.spikePressed) pending.spike = true;

  /* WHERE A DIVE WOULD GO, sampled here rather than read at launch.
     `launchDive` fires from inside the action machine's transition hook, which
     has no input in scope. This is already world-space â€” `input.sample`
     resolved it against the camera basis â€” so it is the same vector the
     movement torque uses, which is what makes "I dive where I am pushing"
     literally true rather than approximately true. */
  diveAim.x = inp.moveX;
  diveAim.z = inp.moveZ;

  return inp;
}

/**
 * PHASE 2 â€” PHYSICS.
 *
 * Fixed step, up to MAX_SUBSTEPS per frame. Order inside a step is load-bearing
 * and is commented at each stage.
 */
function stepPhysics(inp) {
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
    const v0 = rootBody.linvel();
    const speed0 = Math.hypot(v0.x, v0.z);

    // 2a. ACTIONS decide the physics profile this step runs under, so they go
    //     first â€” everything below reads their verdict.
    actions.update(FIXED_DT, {
      grounded: controller.state.grounded,
      speed: speed0,
      slideHeld: inp.slideHeld,
      slidePressed: pending.slide,
      divePressed: pending.dive,
      volleyPressed: pending.volley,
      spikePressed: pending.spike,
      /* JUMP BAILS YOU OUT OF A SLIDE. The action machine has to see the press
         BEFORE the controller does, which is why it is passed here and not only
         below: on the step you jump out, the slide must already have ended, or
         the controller would still be running the passive profile and would
         swallow the jump it was given. */
      jumpPressed: pending.jump,
      // Recovery ends when the rig is actually standing, not when a timer says
      // so â€” a fixed duration cannot tell flat ground from a ditch.
      puppetSettled: rig ? rig.state.settled : true,
    });
    pending.slide = false; pending.dive = false;
    pending.volley = false; pending.spike = false;

    /* --- STAMINA ---------------------------------------------------------
       On the same fixed step as everything else, never on the render frame: a
       resource integrated at a variable rate drains at a different speed on a
       144 Hz display than on a 60 Hz one, which is a balance bug that only
       appears on other people's machines.

       Three continuous drains are billed here, all before `update()` so the
       regen delay they arm is seen on the same step:

         SPRINT   while the trigger is held AND affordable. Refused when
                  exhausted, which is what turns a sprint into a resource
                  rather than a button.
         INCLINE  proportional to the rate of ASCENT, not to the slope or the
                  speed alone â€” traversing a ramp sideways is free, going
                  straight up it is not. P = mÂ·gÂ·v_climb, so this is the honest
                  shape for "climbing is work".
         SLIDE    billed inside the action machine, which owns the slide's
                  clock; it is not repeated here.
       ------------------------------------------------------------------ */
    const cs = controller.state;
    /* Decided before the controller runs, and read by it â€” see `jumpPressed`.

       `deny` on a REFUSED PRESS, not merely on the query. `canAfford` is a
       question and asking it must not flash the bar; but a press that is thrown
       away has to say why, or an empty tank presents as a dead button. This is
       the same lesson the slide taught â€” an unexplained refusal is
       indistinguishable from a bug. */
    const canJump = stamina.canAfford('jump');
    // `actions.movementLocked`, not `st.isLocked`: `st` is not built until a
    // few lines below and reading it here is a temporal-dead-zone throw. Same
    // value, available now.
    if (pending.jump && !canJump && !actions.movementLocked && !actions.physics.passive) {
      stamina.deny('jump');
    }
    const wantSprint = !actions.movementLocked && !actions.physics.passive && inp.sprint;
    const sprinting = wantSprint && stamina.canAfford('sprint');
    if (sprinting) stamina.drain('sprint', FIXED_DT);

    const climbRate = inclineDrainRate({
      climbRate: cs.climbRate,
      slopeDeg: cs.slopeAngleDeg,
      grounded: cs.grounded,
      tuning: STAM,
    });
    if (climbRate > 0) stamina.drain('incline', FIXED_DT, climbRate);

    /* AT REST means no stick AND no speed, not merely no stick. Taken purely as
       "input is zero" it would pay the fast recovery rate to someone coasting
       across the court at 8 m/s with the trigger released, which is not what
       anyone means by resting. */
    /* THE JUMP HOLD, billed before `update()` like every other continuous
       drain so the regen delay it arms is seen on the same step. Only while the
       boost is actually being GRANTED: rising, button held, on this frame. A
       drain that ran through the fall would charge for a jump twice. */
    const boosting = jumpBoostActive(inp);
    if (boosting) stamina.drain('jumpHold', FIXED_DT);

    const atRest = inp.magnitude <= STAM.restInputEpsilon
      && speed0 <= STAM.restSpeed;
    stamina.update(FIXED_DT, { draining: actions.physics.passive, atRest });

    const st = refreshPlayerState(speed0, { sprinting, inclineDrain: climbRate });

    // 2b. HIT RESOLUTION. The action machine decides WHEN contact is live; this
    //     only decides whether the ball is actually there. A swing that finds
    //     nothing is a whiff, and the longer whiff recovery is the cost.
    if (actions.contactOpen && resolveHit(actions.hit.kind, elapsed)) {
      actions.reportHitConnected();
    }

    // 2c. LOCOMOTION. Torque on the invisible sphere â€” never a velocity set â€”
    //     so the athlete accelerates by rolling against the court's friction.
    const jumped = controller.update(FIXED_DT, {
      moveX: st.isLocked ? 0 : inp.moveX,
      moveZ: st.isLocked ? 0 : inp.moveZ,
      magnitude: st.isLocked ? 0 : inp.magnitude * actions.hitThrottle,
      // `st.isSprinting`, not `inp.sprint`: the trigger being held is a request,
      // and an exhausted athlete's request is refused. One decision, taken
      // above, read here â€” computing it twice is how the drain and the speed
      // end up disagreeing.
      sprint: st.isSprinting,
      /* JUMP IS PRICED NOW, and the gate is affordability rather than a second
         copy of the jump rules. `canAfford` refuses while exhausted, so an empty
         bar means the button does nothing â€” and `stamina.deny` flashes the bar
         so it says why instead of just failing. */
      jumpPressed: (st.isLocked || actions.physics.passive || !canJump)
        ? false : pending.jump,
      /* And the HOLD, which is what buys altitude (`jumpCutMul` makes gravity
         heavier the moment you let go). Cut it when the tank is empty and the
         jump simply tops out lower, which is a far better failure than the
         boost continuing for free. */
      jumpHeld: !st.isLocked && inp.jumpHeld && stamina.canAfford('jumpHold'),
      /* STRAFING, and the + PI that fixes three bugs at once.

         TWO CONVENTIONS FOR ONE QUANTITY, and converting between them by doing
         nothing is what put the dive, the hit volumes and the visual facing all
         exactly 180Â° out.

           `basisYaw` is the camera's ORBIT AZIMUTH â€” where the camera SITS,
           measured from the player. `cameraBasisFromYaw` therefore builds
           forward as (âˆ’sin Î¸, âˆ’cos Î¸): away from the camera is the NEGATION of
           the direction to it. Movement was always correct because it consumes
           those vectors.

           `facingAngle` is a heading in the controller's own convention, where
           Ï† means the direction (sin Ï†, cos Ï†).

         Setting Ï† = Î¸ points the athlete straight AT the camera. Verified: the
         dot product of the two is âˆ’1.00 at every azimuth, not just at the
         default one. Ï† = Î¸ + Ï€ gives +1.00 everywhere.

         Fixing it here rather than by negating the dive and hit vectors is
         deliberate. Those fire along `facingAngle`, and so does the puppet's
         yaw â€” negating only the actions would have produced a character diving
         correctly while facing backwards, and it would have broken 'travel'
         mode, where facing comes from velocity and was never wrong. */
      aimYaw: director.basisYaw + Math.PI,
      /* THREE distinct passive profiles, not one flag with adjectives:

           slide  steerable, scrubs speed, frictionless, you chose it and you
                  can end it
           dive   ballistic, unsteerable, one impulse then drag
           skid   what the dive decays into â€” same drag, same slick contact,
                  still no input, and it ends when the speed does

         Collapsing any two of them is what made the dive feel like a slide
         that happened to leave the ground, and what made the end of a dive feel
         like hitting a wall. */
      slide: st.isSliding,
      dive: st.isDiving,
      skid: st.isSkidding,
      frozen: st.isKnocked,
    });
    /* CHARGED ON THE RETURN VALUE, not on the press. `controller.update` returns
       true only on the step a jump ACTUALLY fired â€” the press is buffered and
       may be consumed several frames later inside the coyote window, or expire
       unused. Billing at press time would charge for jumps that never happened,
       which is the fastest way to make an economy feel arbitrary. Same rule as
       the dive: charge last, and only for what happened. */
    if (jumped) stamina.spend('jump');
    pending.jump = false;

    // 2d. THE RIG. Runs on the FIXED step with the solver: torques integrated
    //     at a variable rate change stiffness with frame rate, which is how a
    //     ragdoll that behaves on one machine explodes on another.
    if (rig) {
      const rp = rootBody.translation();

      /* A knocked-down athlete tracks NOTHING. Feeding targets to a ragdoll is a
         contradiction â€” the motors would haul a limp body back into a run cycle
         while it is supposed to be falling over. */
      /* THE CLIP LAYER, before the rig animates. It writes the BASE targets;
         `rig.animate` then composes the postures and the swing on top of them,
         which is what lets an authored run cycle and a procedural dive coexist.
         With no file loaded this is a single boolean and a null write. */
      stepClips(FIXED_DT, st, speed0);

      if (actions.physics.puppet !== 'ragdoll') {
        // The swing's clock belongs to the action machine, which already owns
        // windup â†’ active â†’ recover. The rig keeps none of its own, so the arms
        // and the contact window cannot drift apart.
        rig.setSwing(st.isHitting
          ? { kind: st.hitKind, phase: st.hitPhase, progress: actions.hitProgress }
          : null);
        rig.animate(FIXED_DT, speed0, GAIT);
      }

      rig.update(FIXED_DT, {
        // XYZ ONLY, plus yaw. The sphere is rolling â€” it is spinning about a
        // horizontal axis at speed/radius â€” and copying that rotation would
        // tumble the character head over heels down the court. The puppet takes
        // the sphere's POSITION and the controller's facing angle, and never
        // touches its pitch or roll.
        spherePos: { x: rp.x, y: rp.y - TUNING.radius, z: rp.z },
        facingAngle: st.facingAngle,
        want: actions.physics.puppet,
        /* POSTURES. A dive lays the whole body out face-down; a slide tips the
           chest back with one leg out straight and the other tucked under.
           Both are slewed inside the rig so the body folds into the shape and
           stands back up, rather than teleporting between two of them.

           Driven straight off the player state, so the pose cannot disagree with
           the physics profile the controller is running â€” they read the same
           booleans on the same step. */
        /* THE DIVE POSE OUTLIVES THE DIVE STATE. An athlete does not spring
           upright the instant the lunge "ends" and then travel four more metres
           standing up â€” they stay laid out and get up when they stop. So the
           laid-out posture is held for the dive AND the skid that follows it,
           and the rig's release slew starts only when the skid does. */
        dive: (st.isDiving || st.isSkidding) ? 1 : 0,
        slide: st.isSliding ? 1 : 0,
        // Feet go slippery on INPUT, not on speed. Waiting for speed means the
        // foot is loaded on the first stride and the last, which are the two
        // frames a plant is most likely to tear the rig apart.
        moving: (!st.isLocked && inp.magnitude > 0.02) || actions.physics.passive
          || speed0 > 1.2,
      });
    }

    // 2e. INTEGRATE.
    world.step();
    accumulator -= FIXED_DT;
    steps++;
  }
  // Bail out of a death spiral: if the accumulator is still full after the
  // substep cap, drop the backlog rather than falling further behind forever.
  if (steps === MAX_SUBSTEPS) accumulator = 0;
}

/**
 * PHASE 3 â€” RENDER.
 *
 * Reads settled physics and draws it. Writes nothing the solver will read.
 */
function renderFrame(dt) {
  const p = rootBody.translation();
  const v = rootBody.linvel();
  if (p.y < FALL_LIMIT) respawn();

  /* --- Debug ball: welded to the physics body ---------------------------
     POSITION AND ROTATION. The rotation sync was missing, which is why the
     sphere never appeared to roll â€” it has always been rolling (there are no
     angular locks, and the drive applies nothing but torque), but the wireframe
     was being placed with `position` alone, so it slid across the court like a
     decal. The mechanic was invisible rather than absent.

     Rapier and three.js both store quaternions (x, y, z, w) right-handed, so
     this is a component copy and not a conversion.

     The VISIBLE character deliberately ignores this rotation â€” it takes the
     sphere's position and the controller's yaw only. A body that copied a
     rolling sphere's orientation would tumble head over heels down the court.
     -------------------------------------------------------------------- */
  ballDebug.position.set(p.x, p.y, p.z);
  const rr = rootBody.rotation();
  ballWire.quaternion.set(rr.x, rr.y, rr.z, rr.w);
  const speed = Math.hypot(v.x, v.z);
  if (speed > 0.05) {
    tmpVec.set(v.x, 0, v.z).normalize();
    velArrow.setDirection(tmpVec);
    velArrow.setLength(Math.max(0.3, speed * 0.28), 0.18, 0.1);
    velArrow.visible = true;
  } else {
    velArrow.visible = false;
  }
  faceArrow.setDirection(tmpVec.set(Math.sin(facing()), 0, Math.cos(facing())));
  contactDot.visible = PUPPET.showBall && controller.state.grounded;
  contactDot.position.set(p.x, p.y - TUNING.radius, p.z);

  /* --- The puppet --------------------------------------------------------
     Synced once per RENDER frame rather than per physics step: the bodies have
     already been integrated, and re-deriving fifteen transforms for a picture
     nobody draws is wasted work at 144 Hz.

     `dummyRoot` stays at IDENTITY. It used to carry the athlete's position and
     yaw, which is exactly right when a model is being dragged around as
     decoration â€” and exactly wrong now, because the rig places every body in
     world space. Leaving those two lines in applied the transform twice and sent
     the character off at double distance.
     -------------------------------------------------------------------- */
  syncDummy();

  /* --- THE VISIBLE CHARACTER ---------------------------------------------
     Driven from the same three numbers the dummy is: the sphere's contact
     point, the controller's facing, and the rig's commanded hip height. Not
     from its own idea of any of them â€” one source of truth for where the
     athlete is, and the model is a consumer of it like everything else.

     `rig.state.coreLiftNow` is the height the PIN is currently commanding, and
     it is already interpolated from standing toward a posture's floor (see the
     hover fix). Handing it straight to the model is what makes the character
     drop into a slide instead of gliding above it â€” the same number, the same
     curve, so the primitives and the mesh cannot disagree. */
  if (view) {
    const vp = rootBody.translation();
    const commanded = rig ? rig.state.coreLiftNow : DUM.coreLift;
    view.update(dt, {
      position: { x: vp.x, y: vp.y - TUNING.radius, z: vp.z },
      facingAngle: player.facingAngle,
      // A DELTA, not the absolute height. The model's own origin is between its
      // feet, so it already stands correctly at 0; what the lift has to supply
      // is how far the posture has pulled the hips DOWN from standing.
      lift: Math.min(0, (commanded - DUM.coreLift)),
      speed: player.speed,
      action: player.action,
      grounded: player.isGrounded,
      // The swing, scrubbed from the action machine's clock rather than played
      // at the clip's own rate â€” see the note in character-view.js.
      hitting: player.isHitting,
      hitKind: player.hitKind,
      hitPhase: player.hitPhase,
      hitProgress: actions.hitProgress,
      rig,
    });
    if (characterInfo) characterInfo.standins = view.standins;
  }

  // --- Ball --------------------------------------------------------------
  const bp = ballBody.translation();
  if (bp.y < BALL.outOfBoundsY) serveBall();
  ballMesh.position.set(bp.x, bp.y, bp.z);
  /* RAPIER â†’ THREE QUATERNIONS. Both are (x, y, z, w) right-handed, so this is a
     component copy and NOT a conversion â€” no axis swap, no handedness flip, no
     reordering. It is worth stating because half the engines in the world store
     w first, and a w-first assumption here produces a ball that tumbles subtly
     wrongly in a way nobody can point at. */
  const br = ballBody.rotation();
  ballMesh.quaternion.set(br.x, br.y, br.z, br.w);

  // Shadow sits on the terrain under the ball, fading with height so you can
  // read how high it is at a glance.
  const shadowY = groundHeightUnder(bp);
  ballShadow.position.set(bp.x, shadowY + 0.02, bp.z);
  const airHeight = Math.max(0, bp.y - BALL.radius - shadowY);
  const shrink = 1 / (1 + airHeight * 0.28);
  ballShadow.scale.setScalar(Math.max(0.35, shrink));
  ballShadow.material.opacity = 0.38 * Math.max(0.15, shrink);

  // Reach is computed ONCE per frame and shared by the ring, the debug volumes
  // and the HUD. It used to be recomputed three times over, each with its own
  // ground raycast.
  reach.contact = contactPoint(p, TUNING.radius, HIT);
  reach.volleyOpts = reachOptions('volley', HIT, BALL.radius);
  reach.spikeOpts = reachOptions('spike', HIT, BALL.radius);
  reach.volley = evaluateReach(reach.contact, bp, facing(), reach.volleyOpts);
  reach.spike = evaluateReach(reach.contact, bp, facing(), reach.spikeOpts);
  reach.groundY = groundHeightUnder(p);

  // The ground ring is the sphere's footprint, not its radius: at the athlete's
  // feet the sphere has already narrowed, and drawing the full radius down there
  // would promise reach the test will not honour.
  const contactAbove = Math.max(0, reach.contact.y - reach.groundY);
  const volleyLimit = reach.volleyOpts.reach + reach.volleyOpts.ballRadius;
  const footprint = Math.sqrt(Math.max(0, volleyLimit * volleyLimit - contactAbove * contactAbove));
  reachRing.visible = footprint > 0.08;
  reachRing.position.set(p.x, reach.groundY + 0.03, p.z);
  reachRing.scale.setScalar(footprint / BASE_RING_RADIUS);
  reachRing.material.opacity = reach.volley.inReach ? 0.6 : 0.14;
  reachRing.material.color.setHex(reach.volley.inReach ? 0x4ecdc4 : 0x5a6478);

  // Debug volumes, sized to exactly match the reach tests above.
  volleyVolume.visible = spikeVolume.visible = DEBUG.showVolumes;
  if (DEBUG.showVolumes) {
    fitVolume(volleyVolume, reach.contact, reach.volleyOpts, reach.volley.inReach, facing());
    fitVolume(spikeVolume, reach.contact, reach.spikeOpts, reach.spike.inReach, facing());
  }

  // Hold the impulse / whiff arrows briefly so they're readable at speed.
  if (impulseArrow.visible && elapsed > arrowUntil) impulseArrow.visible = false;
  if (whiffArrow.visible && elapsed > whiffUntil) whiffArrow.visible = false;
  if (diveArrow.visible && elapsed > diveUntil) diveArrow.visible = false;

  // The ball must never be allowed to park itself. canSleep(false) covers it,
  // but nudge it awake near the athlete too, so a solver that decides otherwise
  // cannot leave a dead ball on the court.
  if (ballBody.isSleeping && ballBody.isSleeping() && reach.volley.distance < HIT.volleyReach * 2) {
    ballBody.wakeUp();
  }

  // --- Camera -----------------------------------------------------------
  // travelYaw is the direction of TRAVEL, not of facing: the auto-recentre
  // should settle behind where you are actually going, and those two differ for
  // the whole of a slide â€” and, now, for the whole of a strafe.
  const travelYaw = speed > 0.6 ? Math.atan2(v.x, v.z) : undefined;
  camState = director.update(dt, {
    player: { x: p.x, y: p.y - TUNING.radius, z: p.z },
    ball: { x: bp.x, y: bp.y, z: bp.z },
    speed,
    travelYaw,
    aspect: window.innerWidth / window.innerHeight,
  });

  
  renderer.render(scene, director.camera);
  hud.updateStaminaBar(player, STAM, stamina);
}

/** The whole frame, in the order the three clocks require. */
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.25);
  elapsed += dt;
  accumulator += dt;

  const inp = readInput(dt);
  stepPhysics(inp);
  renderFrame(dt);
}

/* A console handle. Not decoration: every question this build raises â€” is the
   target moving, is the mass ratio what I asked for, are the limbs filtered out
   of each other â€” is answerable from the devtools console with this, and none of
   them are answerable from a screenshot. */
window.valleyball = {
  get rig() { return rig; },
  get gait() { return GAIT; },
  get parts() { return DUMMY_PARTS; },
  spawnOverlaps,
  settings: { PUPPET, DUM, GAIT, CAM, TUNING, DEBUG, STAM, ACT },
  rebuild: buildDummy,
  /** The player state machine, live. `valleyball.player.isDiving` etc. */
  player,
  /** The collision masks the page is actually using, plus Rapier's own predicate. */
  layers: {
    world: GROUPS_WORLD, ball: GROUPS_BALL, athlete: GROUPS_ATHLETE,
    puppet: puppetGroups, ray: RAY_FILTER, LAYER, canCollide,
  },
  get controller() { return controller; },
  get camera() { return director; },
  get actions() { return actions; },
  /** The resource layer. `valleyball.stamina.reset(0)` to test exhaustion. */
  get stamina() { return stamina; },
  /** The visible character, once a .glb with geometry has loaded. */
  get view() { return view; },
  get character() { return characterInfo; },
  /** Feed a parsed glTF in from the console or a test, bypassing the loader. */
  adoptCharacter,
  get dummyVisible() { return dummyRoot.visible; },
  /** What the player saw on the first frame, before any UI was touched. */
  bootDummyVisible: BOOT_DUMMY_VISIBLE,
  set dummyVisible(v) { DEBUG.showDummy = !!v; dummyRoot.visible = !!v; },
  /** The authored-clip layer. `loaded:false` until a .glb is dropped on the page. */
  clips: {
    settings: CLIPS,
    get loaded() { return clipState.loaded; },
    get resolved() { return clipState.resolved; },
    get missing() { return clipState.missing; },
    get playing() { return clipState.current; },
    get bones() { return clipState.bones.size; },
    /** Feed a parsed glTF in from the console, for testing without a drag. */
    adopt: adoptClipSource,
    step: stepClips,
  },
  get body() { return rootBody; },
  axesDebug,
  puppetGroups,
  trackingError: () => (rig ? rig.trackingError() : null),
};

window.__boot.done = true;
document.getElementById('loading').style.display = 'none';
document.getElementById('ui').style.display = 'block';
document.getElementById('stamina').style.display = 'block';
document.getElementById('model').style.display = 'block';

/* Kick the character load AFTER the first frame is scheduled, so the page is
   interactive while a megabyte of mesh is parsed rather than blank during it.
   The dummy is already running underneath; the model simply appears. */
tryAutoLoad();

animate();
