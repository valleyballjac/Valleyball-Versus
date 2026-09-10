import GUI from 'lil-gui';
import { TUNING, resetTuning, tuningJson } from '../config/tuning.js';
import { activeArenaType, activeArenaPreset } from '../sim/arena.js';
import { soundManager } from '../audio/soundManager.js';

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
  // Same reason as getMatchState: the boards are built after the GUI is.
  getScoreboards = () => null,
  clipNames = [],
  tracker,
  // A GETTER, not the object: the GUI is built during boot and the match state
  // may not exist yet at that moment. Capturing the value would capture null
  // for the life of the session.
  getMatchState = () => null,
}) {
  const gui = new GUI({ title: 'VALLEYBALL / TUNING' });

  const athleteFolder = gui.addFolder('ATHLETE / CUSTOMIZATION');
  athleteFolder
    .add(TUNING.athlete, 'variant', ['masculine', 'feminine', 'classic'])
    .name('silhouette [K]')
    .listen()
    .onChange(() => {
      onRagdollVisibilityChange();
    });
  athleteFolder
    .add(TUNING.athlete, 'team', ['home', 'away'])
    .name('team jersey [J]')
    .listen()
    .onChange(() => {
      onRagdollVisibilityChange();
    });
  athleteFolder.open();

  const loop = gui.addFolder('loop');
  // The loop binds fixedHz once at construction; changing the timestep at
  // runtime destroys determinism, so this must never be editable.
  locked(loop.add(TUNING.loop, 'fixedHz'), 'locked');
  loop.add(TUNING.loop, 'maxFrameTime', 0.05, 1, 0.01).name('maxFrameTime (s)');

  const debug = gui.addFolder('debug');
  debug.add(TUNING.debug, 'showHud').onChange(onShowHudChange);
  debug.add(TUNING.debug, 'showCapsuleAthlete').name('capsuleAthlete').onChange(onRagdollVisibilityChange);
  debug.add(TUNING.debug, 'showRagdollColliders').name('ragdollWireframe').onChange(onRagdollVisibilityChange);
  debug.add(TUNING.debug, 'showCharacterMesh').name('skinnedYBotMesh').onChange(onRagdollVisibilityChange);
  debug.add(TUNING.debug, 'showSphereWireframe').name('sphereMotorWireframe').onChange(onShowSphereWireframeChange);
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

  // THE ACTIONS. The dive impulses are the two the designer is actually
  // feeling for, and they were seeds in a table nobody could move without a
  // reload. Live, they are a five-second question instead of a five-minute one.
  const action = gui.addFolder('action');
  action.add(TUNING.action, 'diveImpulseForward', 0, 12, 0.1).name('dive forward (N.s)');
  action.add(TUNING.action, 'diveImpulseUp', 0, 8, 0.1).name('dive upward (N.s)');
  action.add(TUNING.action, 'diveCooldownTicks', 30, 300, 1).name('dive cooldown (ticks)');
  action.add(TUNING.action, 'slideResistance', 0.1, 3.0, 0.05).name('slide resistance');
  action.add(TUNING.action, 'knockdownSpeed', 0.5, 5.0, 0.1).name('knockdown speed');
  action.add(TUNING.action, 'crashMuscleTone', 0.0, 1.0, 0.05).name('crash muscle tone');

  // THE STRIKES. Clip names and windows are reload-or-next-R; everything else
  // is live, because the whole point of authoring the windows at 1x was to give
  // the designer a slider to move AFTER feeling 1x rather than a number decided
  // in a prompt.
  //
  // `sweetTick` and `climbRate` are the pair that must move together: climbRate
  // decides when the hand actually arrives, sweetTick decides when the game
  // thinks it arrived, and changing one without the other makes a perfectly
  // timed strike score badly. Both are here, adjacent, for that reason.
  const strike = gui.addFolder('strike');
  strike.add(TUNING.strike, 'pressCooldownTicks', 0, 120, 1);
  strike.add(TUNING.strike, 'qualityPerfectTicks', 0, 20, 1);
  strike.add(TUNING.strike, 'qualityZeroTicks', 1, 60, 1);
  strike.add(TUNING.strike, 'qualityFloor', 0, 1, 0.01);
  strike.add(TUNING.strike, 'aimStickWeight', 0, 1, 0.05);
  strike.add(TUNING.strike, 'mixEase', 0.5, 40, 0.5);
  strike.add(TUNING.strike, 'assistRadius', 0, 1.0, 0.02).name('assist radius (m)');
  strike.add(TUNING.strike, 'assistWindowTicks', 0, 15, 1).name('assist window (ticks)');
  strike.add(TUNING.strike, 'aimMagnetism', 0, 0.6, 0.05).name('target magnetism');
  for (const kind of ['volley', 'spike']) {
    const row = TUNING.strike[kind];
    const folder = strike.addFolder(kind);
    folder.add(row, 'launchSpeed', 0, 60, 0.5);
    folder.add(row, 'elevationDeg', -80, 80, 1);
    folder.add(row, 'climbRate', 0.05, 8, 0.01).name('climbRate (1x as authored)');
    folder.add(row, 'completeRate', 0.05, 8, 0.01);
    folder.add(row, 'holdPoint', 0, 1, 0.001);
    folder.add(row, 'sweetTick', 0, 120, 1).name('sweetTick (MEASURED)');
    folder.add(row, 'windowOpen', 0, 120, 1);
    folder.add(row, 'windowClose', 0, 180, 1);
    locked(folder.add(row, 'clipStart'), 'next R');
    locked(folder.add(row, 'clipEnd'), 'next R');
    if (kind === 'volley') locked(folder.add(row, 'clip'), 'next R');
    else {
      locked(folder.add(row, 'clipLeft'), 'next R');
      locked(folder.add(row, 'clipRight'), 'next R');
    }
  }

  const visual = gui.addFolder('visual');
  locked(visual.add(TUNING.visual, 'boxWidth'), 'reload');
  locked(visual.add(TUNING.visual, 'boxHeight'), 'reload');
  locked(visual.add(TUNING.visual, 'boxDepth'), 'reload');

  // THE MATCH. Mode is a TUNING value so it survives a reset the way everything
  // else does; the live state it drives is main.js's, reached through the
  // getter so this folder never holds a stale reference to it.
  const matchFolder = gui.addFolder('match');
  matchFolder
    .add(TUNING.match, 'mode', ['practice', 'match'])
    .name('match mode')
    .onChange((value) => {
      const match = getMatchState();
      if (match) match.mode = value;
    });
  matchFolder.add(TUNING.match, 'durationSeconds', 30, 900, 15).name('duration (s)');
  matchFolder.add(TUNING.match, 'hoopRearmX', 0.2, 5, 0.1).name('goal re-arm |x| (m)');
  matchFolder
    .add(TUNING.match, 'celebrationTicks', 0, 600, 15)
    .name('goal flash (ticks)');
  matchFolder
    .add(TUNING.scoreboard, 'flashTicks', 3, 60, 1)
    .name('flash half-cycle (ticks)');
  matchFolder
    .add({
      boards: TUNING.scoreboard.enabled,
    }, 'boards')
    .name('show scoreboards')
    .onChange((visible) => {
      const handle = getScoreboards();
      // VISIBILITY, not a rebuild. The boards own four canvases and four
      // textures; tearing them down and remaking them to hide them for a
      // screenshot would be four allocations for a boolean.
      if (handle) handle.group.visible = visible;
    });
  matchFolder
    .add({
      reset: () => {
        const match = getMatchState();
        if (!match) return;
        match.scoreHome = 0;
        match.scoreAway = 0;
        match.targetGoal = 'N';
        match.ticksRemaining = TUNING.match.durationSeconds * 60;
        match.matchOver = false;
        match.events.length = 0;
        // The celebration goes with it. Resetting mid-flash and leaving the
        // counter running means the boards celebrate a goal that no longer
        // exists in the events list.
        match.celebrationTicks = 0;
        match.lastScoredFor = null;
        match.lastGoalId = null;
        // The per-ball trackers go too. Leaving them would carry a disarmed
        // hoop across the reset and swallow the first goal of the next match.
        match.ballTrackers.clear();
        console.log('[match] score, clock and ball trackers reset');
      },
    }, 'reset')
    .name('reset score & state');

  const cameraFolder = gui.addFolder('camera (spring arm)');
  // .listen() because Tab and the d-pad change this behind the GUI's back; a
  // dropdown that shows the mode you are not in is worse than no dropdown.
  cameraFolder
    .add(TUNING.camera, 'mode', ['chase', 'ball', 'broadcast', 'tactical'])
    .name('viewing mode')
    .listen();
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

  // ═══ AUDIO ═══
  const audioFolder = gui.addFolder('audio & sfx');
  audioFolder.add(TUNING.audio, 'enabled').name('audio enabled').onChange(() => soundManager.updateTuning());
  audioFolder.add(TUNING.audio, 'masterVolume', 0, 1, 0.05).name('master volume').onChange(() => soundManager.updateTuning());
  audioFolder.add(TUNING.audio, 'sfxVolume', 0, 1, 0.05).name('sfx volume').onChange(() => soundManager.updateTuning());
  audioFolder.add(TUNING.audio, 'ambienceVolume', 0, 1, 0.05).name('ambience volume').onChange(() => soundManager.updateTuning());
  audioFolder.add(TUNING.audio, 'spatialAudio').name('spatial 3D audio');
  audioFolder.add({
    testBuzzer: () => soundManager.playGoal('home', 'N'),
  }, 'testBuzzer').name('test arena buzzer');
  audioFolder.add({
    testGlass: () => soundManager.playGlassImpact(8.0),
  }, 'testGlass').name('test backboard glass');
  audioFolder.add({
    testHoopClank: () => soundManager.playHoopClank(8.0),
  }, 'testHoopClank').name('test hoop steel clank');
  audioFolder.add({
    testVolleyGrunt: () => soundManager.playPlayerGrunt('volley', 0.9),
  }, 'testVolleyGrunt').name('test tennis volley grunt');
  audioFolder.add({
    testSpikeGrunt: () => soundManager.playPlayerGrunt('spike', 0.9),
  }, 'testSpikeGrunt').name('test tennis spike grunt');
  audioFolder.add({
    testKickKiai: () => soundManager.playPlayerGrunt('kick', 0.9),
  }, 'testKickKiai').name('test karate kick kiai');
  audioFolder.add({
    testBodyThud: () => soundManager.playPlayerBallImpact(6.0, null, 0.5),
  }, 'testBodyThud').name('test player body thud');
  audioFolder.add({
    testFootstep: () => soundManager.playFootstep(),
  }, 'testFootstep').name('test court footstep');
  audioFolder.add({
    testVolley: () => soundManager.playStrike('volley', 0.9, 14, null, 0.5),
  }, 'testVolley').name('test volley + grunt');
  audioFolder.add({
    testSpike: () => soundManager.playStrike('spike', 0.9, 20, null, 0.5),
  }, 'testSpike').name('test spike + grunt');
  audioFolder.add({
    testKick: () => soundManager.playStrike('kick', 0.9, 12, null, 0.5),
  }, 'testKick').name('test kick + kiai');
  audioFolder.add({
    testBounce: () => soundManager.playBallBounce(0.5, 8.0, 'court'),
  }, 'testBounce').name('test bounce (rubber med)');

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
      onRagdollVisibilityChange();
      onCameraChange();
    },
  };

  gui.add(actions, 'copyTuningJson').name('Copy TUNING JSON');
  gui.add(actions, 'resetToDefaults').name('Reset to defaults');

  // Start with tuning panel collapsed so screen is clean for gameplay
  gui.close();

  return gui;
}
