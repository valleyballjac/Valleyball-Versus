import GUI from 'lil-gui';
import { TUNING, resetTuning, tuningJson } from '../config/tuning.js';

/**
 * The tuning panel.
 *
 * One folder per top-level key of TUNING, mirroring its structure exactly.
 *
 * Construction-time values are rendered as disabled, display-only controllers.
 * A slider that appears to work and does not is worse than no slider — you lose
 * an hour before you suspect the control rather than the physics.
 *
 * There is deliberately NO localStorage persistence. A silently restored tuning
 * set means two machines running the same commit behave differently and nobody
 * knows why. Saving is explicit — the copy button — or it does not happen.
 */

/** Marks a controller as read-until-reload. */
function locked(controller, why) {
  return controller.name(`${controller._name} (${why})`).disable();
}

/**
 * @param {object} handlers
 * @param {(visible: boolean) => void} handlers.onShowHudChange
 * @param {(visible: boolean) => void} handlers.onShowSphereWireframeChange
 * @param {() => void} handlers.onCameraChange
 * @param {() => void} handlers.onRagdollVisibilityChange
 * @param {string[]} handlers.clipNames the loaded gltf.animations names
 * @param {object} handlers.tracker read for the display-only weight readout
 * @returns {GUI}
 */
export function createGui({
  onShowHudChange,
  onShowSphereWireframeChange,
  onCameraChange,
  onRagdollVisibilityChange,
  clipNames = [],
  tracker,
}) {
  const gui = new GUI({ title: 'VALLEYBALL / TUNING' });

  const loop = gui.addFolder('loop');
  // The loop binds fixedHz once at construction; changing the timestep at
  // runtime destroys determinism, so this must never be editable.
  locked(loop.add(TUNING.loop, 'fixedHz'), 'locked');
  loop.add(TUNING.loop, 'maxFrameTime', 0.05, 1, 0.01).name('maxFrameTime (s)');

  const debug = gui.addFolder('debug');
  debug.add(TUNING.debug, 'showHud').onChange(onShowHudChange);
  debug.add(TUNING.debug, 'showRagdollColliders').onChange(onRagdollVisibilityChange);
  debug.add(TUNING.debug, 'showCharacterMesh').onChange(onRagdollVisibilityChange);
  debug.add(TUNING.debug, 'showSphereWireframe').onChange(onShowSphereWireframeChange);

  const physics = gui.addFolder('physics');
  physics.add(TUNING.physics, 'gravityY', -60, -1, 0.5);

  const arena = gui.addFolder('arena');
  // The bowl geometry and its trimesh collider are built once at boot.
  locked(arena.add(TUNING.arena, 'floorRadius'), 'reload');
  locked(arena.add(TUNING.arena, 'rimRadius'), 'reload');
  locked(arena.add(TUNING.arena, 'rimHeight'), 'reload');
  locked(arena.add(TUNING.arena, 'profilePoints'), 'reload');
  locked(arena.add(TUNING.arena, 'latheSegments'), 'reload');
  locked(arena.add(TUNING.arena, 'wallCurvePower'), 'reload');
  locked(arena.add(TUNING.arena, 'lipInset'), 'reload');
  locked(arena.add(TUNING.arena, 'lipHeight'), 'reload');
  locked(arena.add(TUNING.arena, 'lipPoints'), 'reload');
  arena.add(TUNING.arena, 'killPlaneY', -200, 20, 0.5);

  const motor = gui.addFolder('motor');
  // radius and density size the ball collider at construction.
  locked(motor.add(TUNING.motor, 'radius'), 'reload');
  locked(motor.add(TUNING.motor, 'density'), 'reload');
  locked(motor.add(TUNING.motor, 'spawnY'), 'reload');
  motor.add(TUNING.motor, 'friction', 0, 4, 0.05);
  motor.add(TUNING.motor, 'restitution', 0, 1, 0.01);
  motor.add(TUNING.motor, 'driveTorque', 0, 40, 0.1);
  motor.add(TUNING.motor, 'maxAngularSpeed', 1, 120, 1);
  motor.add(TUNING.motor, 'brakeTorque', 0, 60, 0.1);
  motor.add(TUNING.motor, 'rollingResistance', 0, 8, 0.01);
  motor.add(TUNING.motor, 'airControlMultiplier', 0, 1, 0.01);
  motor.add(TUNING.motor, 'groundRayCount', 0, 24, 1);
  motor.add(TUNING.motor, 'groundedEpsilon', 0, 1, 0.01);
  motor.add(TUNING.motor, 'stickDeadzone', 0, 0.6, 0.01);

  // The ragdoll is derived once per R-spawn, exactly as the arena is built once
  // at boot. Nothing here rebuilds a live rig, so every control is marked
  // "next R" rather than left looking live.
  const ragdoll = gui.addFolder('ragdoll (applies on next R-spawn)');
  locked(ragdoll.add(TUNING.ragdoll, 'spawnHeight'), 'next R');
  locked(ragdoll.add(TUNING.ragdoll, 'tumbleImpulse'), 'next R');
  locked(ragdoll.add(TUNING.ragdoll, 'captureSpawnTick'), 'next R');
  locked(ragdoll.add(TUNING.ragdoll, 'lengthFit'), 'next R');

  const ragdollRadius = ragdoll.addFolder('radiusRatio (x character height)');
  for (const group of Object.keys(TUNING.ragdoll.radiusRatio)) {
    locked(ragdollRadius.add(TUNING.ragdoll.radiusRatio, group), 'next R');
  }

  const ragdollDensity = ragdoll.addFolder('density');
  for (const group of Object.keys(TUNING.ragdoll.density)) {
    locked(ragdollDensity.add(TUNING.ragdoll.density, group), 'next R');
  }

  const anim = gui.addFolder('anim');
  // 'auto' is the blend space; any clip name pins that clip at weight 1. Built
  // from the clips the asset actually contains, so a typo cannot select a clip
  // that is not there.
  anim.add(TUNING.anim, 'override', ['auto', ...clipNames]);
  anim.add(TUNING.anim, 'timeScale', 0, 3, 0.05);

  const blend = anim.addFolder('blend');
  locked(blend.add(TUNING.anim.blend, 'idleClip'), 'reload');
  locked(blend.add(TUNING.anim.blend, 'jogClip'), 'reload');
  locked(blend.add(TUNING.anim.blend, 'sprintClip'), 'reload');
  blend.add(TUNING.anim.blend, 'idleSpeed', 0, 5, 0.1);
  blend.add(TUNING.anim.blend, 'jogSpeed', 0.5, 15, 0.1);
  blend.add(TUNING.anim.blend, 'sprintSpeed', 1, 25, 0.1);
  blend.add(TUNING.anim.blend, 'speedSmoothing', 0.5, 30, 0.5);
  blend.add(TUNING.anim.blend, 'weightEase', 0.5, 30, 0.5);

  const stride = anim.addFolder('stride');
  stride.add(TUNING.anim.stride, 'enabled');
  stride.add(TUNING.anim.stride, 'jogNominal', 0.5, 15, 0.1);
  stride.add(TUNING.anim.stride, 'sprintNominal', 1, 25, 0.1);
  stride.add(TUNING.anim.stride, 'min', 0.1, 1, 0.05);
  stride.add(TUNING.anim.stride, 'max', 1, 4, 0.05);

  const tracking = gui.addFolder('tracking');
  // LAW L4 — the weight is simulation state with exactly two writers (the
  // recovery ramp and the T hook). A slider here would be a third, competing
  // with both, so it is a read-only readout that follows the sim.
  if (tracker) {
    locked(tracking.add(tracker, 'weight', 0, 1).listen(), 'live, T to knock down');
  }
  locked(tracking.add(TUNING.tracking, 'startWeight'), 'next R');
  tracking.add(TUNING.tracking, 'linearKp', 0, 400, 1);
  tracking.add(TUNING.tracking, 'linearKd', 0, 60, 0.5);
  tracking.add(TUNING.tracking, 'angularKp', 0, 300, 1);
  tracking.add(TUNING.tracking, 'angularKd', 0, 40, 0.5);
  tracking.add(TUNING.tracking, 'pelvisBoost', 1, 20, 0.1);
  tracking.add(TUNING.tracking, 'maxLinearImpulse', 0, 8, 0.05);
  tracking.add(TUNING.tracking, 'maxAngularImpulse', 0, 4, 0.05);
  tracking.add(TUNING.tracking, 'recoverPerSecond', 0, 4, 0.05);
  tracking.add(TUNING.tracking, 'maxMountDistance', 0.1, 3, 0.05);

  const jump = gui.addFolder('jump');
  jump.add(TUNING.jump, 'impulse', 0, 30, 0.1);
  jump.add(TUNING.jump, 'fallGravityMultiplier', 1, 6, 0.05);

  const visual = gui.addFolder('visual');
  visual.add(TUNING.visual, 'turnLerpSpeed', 0.5, 40, 0.5);
  visual.add(TUNING.visual, 'turnSpeedThreshold', 0, 3, 0.01);
  locked(visual.add(TUNING.visual, 'boxWidth'), 'reload');
  locked(visual.add(TUNING.visual, 'boxHeight'), 'reload');
  locked(visual.add(TUNING.visual, 'boxDepth'), 'reload');

  const cameraFolder = gui.addFolder('camera');
  cameraFolder.add(TUNING.camera, 'x', -60, 60, 0.5).onChange(onCameraChange);
  cameraFolder.add(TUNING.camera, 'y', 1, 80, 0.5).onChange(onCameraChange);
  cameraFolder.add(TUNING.camera, 'z', -60, 60, 0.5).onChange(onCameraChange);
  cameraFolder.add(TUNING.camera, 'fov', 20, 110, 1).onChange(onCameraChange);
  cameraFolder.add(TUNING.camera, 'follow');

  const actions = {
    async copyTuningJson() {
      const json = tuningJson();
      try {
        await navigator.clipboard.writeText(json);
        console.log('[tuning] copied to clipboard');
      } catch (error) {
        // Clipboard access is refused outside a secure context or without focus.
        // Falling back to the console still gets the numbers off the machine.
        console.warn('[tuning] clipboard unavailable, logging instead:', String(error));
        console.log(json);
      }
    },
    resetToDefaults() {
      resetTuning();
      gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
      onShowHudChange(TUNING.debug.showHud);
      onShowSphereWireframeChange(TUNING.debug.showSphereWireframe);
      onCameraChange();
    },
  };

  gui.add(actions, 'copyTuningJson').name('Copy TUNING JSON');
  gui.add(actions, 'resetToDefaults').name('Reset to defaults');

  return gui;
}
