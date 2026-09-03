import GUI from 'lil-gui';
import { TUNING, resetTuning, tuningJson } from '../config/tuning.js';
import { activeArenaType, activeArenaPreset } from '../sim/arena.js';

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
 * @param {(visible: boolean) => void} handlers.onShowBallWireframeChange
 * @param {() => void} handlers.onCameraChange
 * @param {() => void} handlers.onRagdollVisibilityChange
 * @param {string[]} handlers.clipNames the loaded gltf.animations names
 * @param {object} handlers.tracker read for the display-only weight readout
 * @returns {GUI}
 */
export function createGui({
  onShowHudChange,
  onShowSphereWireframeChange,
  onShowBallWireframeChange,
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
  debug.add(TUNING.debug, 'showBallWireframe').onChange(onShowBallWireframeChange);

  const physics = gui.addFolder('physics');
  physics.add(TUNING.physics, 'gravityY', -60, -1, 0.5);

  const arena = gui.addFolder('arena');
  // The bowl geometry and its trimesh collider are built once at boot.
  // WHICH ARENA IS RUNNING, and it is display-only on purpose. The selection is
  // read once at boot: the geometry, the colliders and every spawn point are
  // built from it, so a live toggle here would report a world that is not the
  // one on screen. Switch with ?arena=court / ?arena=bowl and reload.
  locked(arena.add({ active: activeArenaType() }, 'active'), 'reload, ?arena=');
  locked(arena.add(TUNING.arena, 'type'), 'reload');
  locked(arena.add(TUNING.arena, 'modelUrl'), 'reload');

  // The kill plane belongs to the ACTIVE preset, so that is the one exposed —
  // editing the other arena's number from here would look live and do nothing.
  const preset = activeArenaPreset();
  arena.add(preset, 'killPlaneY', -200, 20, 0.5);

  // Where the three balls drop in THIS arena, matched to TUNING.balls by index.
  const spawns = arena.addFolder('ball spawns (reload)');
  preset.ballSpawns.forEach((point, index) => {
    const which = spawns.addFolder(`${index}: ${TUNING.balls[index] ? TUNING.balls[index].label : index}`);
    locked(which.add(point, 'x'), 'reload');
    locked(which.add(point, 'y'), 'reload');
    locked(which.add(point, 'z'), 'reload');
    which.close();
  });
  spawns.close();

  const athlete = arena.addFolder('athlete spawn (reload)');
  locked(athlete.add(preset.spawn, 'x'), 'reload');
  locked(athlete.add(preset.spawn, 'y'), 'reload');
  locked(athlete.add(preset.spawn, 'z'), 'reload');
  athlete.close();

  const bowl = arena.addFolder('bowl geometry (reload)');
  for (const key of [
    'floorRadius', 'rimRadius', 'rimHeight', 'profilePoints',
    'latheSegments', 'wallCurvePower', 'lipInset', 'lipHeight', 'lipPoints',
  ]) {
    locked(bowl.add(TUNING.arena.bowl, key), 'reload');
  }
  bowl.close();

  // THE BALL FIXTURE — one folder for the shared settings, then one per ball,
  // built by walking TUNING.balls rather than by hand. Add a fourth ball to the
  // array and its folder appears; there is no second list here to forget to
  // update.
  //
  // Radius, density and the spawn point are reload-only for the same reason the
  // motor's are: the collider is sized once at boot and the body is placed once.
  // Friction, restitution and the drag gains are live. The restitution COMBINE
  // RULE is deliberately absent — it is Max in code and not a feel number.
  const ballCommon = gui.addFolder('ball (shared)');
  locked(ballCommon.add(TUNING.ball, 'eventThreshold'), 'reload');
  locked(ballCommon.add(TUNING.ball, 'captureSpawnTick'), 'reload');

  for (const spec of TUNING.balls) {
    const folder = gui.addFolder(`ball: ${spec.label}`);
    locked(folder.add(spec, 'radius'), 'reload');
    locked(folder.add(spec, 'density'), 'reload');
    folder.add(spec, 'friction', 0, 4, 0.05);
    folder.add(spec, 'restitution', 0, 1, 0.01);
    folder.add(spec, 'linearDrag', 0, 0.5, 0.005);
    folder.add(spec, 'angularDrag', 0, 2, 0.01);
    // No spawn here: where a ball drops belongs to the ARENA, not the ball, and
    // it is exposed under the arena folder with the preset it came from.
    folder.close();
  }

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
  motor.add(TUNING.motor, 'downedDragBoost', 0, 200, 1);

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

  const blend = anim.addFolder('blend (idle + easing)');
  locked(blend.add(TUNING.anim.blend, 'idleClip'), 'reload');
  blend.add(TUNING.anim.blend, 'speedSmoothing', 0.5, 30, 0.5);
  blend.add(TUNING.anim.blend, 'weightEase', 0.5, 30, 0.5);

  const stride = anim.addFolder('stride');
  stride.add(TUNING.anim.stride, 'enabled');
  // The per-ring nominal speed is the ring's own blend2d speed — see tuning.js.
  stride.add(TUNING.anim.stride, 'min', 0.1, 1, 0.05);
  stride.add(TUNING.anim.stride, 'max', 1, 4, 0.05);

  // THE 2D BLEND SPACE. The three ring speeds are live; the clip names are read
  // once when the actions are built, which happens on every R-spawn.
  const blend2d = gui.addFolder('blend2d');
  blend2d.add(TUNING.blend2d, 'walkSpeed', 0.2, 10, 0.1);
  blend2d.add(TUNING.blend2d, 'runSpeed', 0.5, 18, 0.1);
  blend2d.add(TUNING.blend2d, 'sprintSpeed', 1, 25, 0.1);
  for (const ring of ['walkClips', 'runClips']) {
    const folder = blend2d.addFolder(ring);
    for (const slot of Object.keys(TUNING.blend2d[ring])) {
      locked(folder.add(TUNING.blend2d[ring], slot), 'next R');
    }
  }
  locked(blend2d.add(TUNING.blend2d, 'sprintClip'), 'next R');

  const facing = gui.addFolder('facing');
  facing.add(TUNING.facing, 'ease', 0.5, 40, 0.5);

  const impact = gui.addFolder('impact');
  impact.add(TUNING.impact, 'forceThreshold', 0, 80000, 100);
  impact.add(TUNING.impact, 'scale', 0, 0.01, 0.0001);
  impact.add(TUNING.impact, 'dragOnset', 0.01, 1, 0.01);
  impact.add(TUNING.impact, 'mountRecoverBelow', 0, 0.5, 0.01);
  impact.add(TUNING.impact, 'mountSnapEpsilon', 0.01, 2, 0.01);

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
  jump.add(TUNING.jump, 'airEaseIn', 0.5, 60, 0.5);
  jump.add(TUNING.jump, 'airEaseOut', 0.5, 40, 0.5);
  jump.add(TUNING.jump, 'inPlaceBelow', 0, 8, 0.1);
  jump.add(TUNING.jump, 'runAbove', 0.1, 12, 0.1);
  jump.add(TUNING.jump, 'landRate', 0.1, 10, 0.05).name('landRate (landing tail)');
  jump.add(TUNING.jump, 'cooldownTicks', 0, 180, 1).name('cooldownTicks (60 = 1 s)');
  jump.add(TUNING.jump, 'takeoffRate', 0.1, 8, 0.05).name('takeoffRate (to the hold)');
  jump.add(TUNING.jump, 'apexHold', 0, 1, 0.01).name('apexHold (the held frame)');
  jump.add(TUNING.jump, 'clipStart', 0, 1, 0.01);
  jump.add(TUNING.jump, 'clipEnd', 0, 1, 0.01);
  locked(jump.add(TUNING.jump, 'standingClip'), 'next R');
  locked(jump.add(TUNING.jump, 'runningClip'), 'next R');

  const visual = gui.addFolder('visual');
  locked(visual.add(TUNING.visual, 'boxWidth'), 'reload');
  locked(visual.add(TUNING.visual, 'boxHeight'), 'reload');
  locked(visual.add(TUNING.visual, 'boxDepth'), 'reload');

  const cameraFolder = gui.addFolder('camera (spring arm)');
  cameraFolder.add(TUNING.camera, 'fov', 20, 110, 1).onChange(onCameraChange);
  cameraFolder.add(TUNING.camera, 'radius', 2, 30, 0.1);
  cameraFolder.add(TUNING.camera, 'targetHeight', 0, 4, 0.05);
  cameraFolder.add(TUNING.camera, 'orbitSpeed', 0, 10, 0.1);
  cameraFolder.add(TUNING.camera, 'mousePixelsPerRadian', 50, 2000, 10);
  cameraFolder.add(TUNING.camera, 'minPitch', -1.5, 1.5, 0.01);
  cameraFolder.add(TUNING.camera, 'maxPitch', 0, 1.55, 0.01);
  cameraFolder.add(TUNING.camera, 'collisionMargin', 0, 3, 0.05);
  cameraFolder.add(TUNING.camera, 'minDistance', 0.5, 12, 0.1);
  cameraFolder.add(TUNING.camera, 'restoreEase', 0.2, 20, 0.1);

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
