import GUI from 'lil-gui';
import { DEFAULT_DUMMY_TUNING } from './dummy-rig.js';
import * as THREE from 'three';

export function setupTuningGUI(config, callbacks, scene) {
  const { 
    TUNING, INPUT_T, ACT, BALL, HIT, CAM, STAM, VIEW, DUM, GAIT, CLIPS, PUPPET, DEBUG, pending,
    ballDebug, contactDot, axesDebug, dummyRoot, getRig, director, world, stamina, MOUSE, ballEntity, ballBody, getView
  } = config;
  const { serveBall, dropBall, buildDummy, launchDive, reSurface, toast, rebuildBall, knockDown, respawn, onResize } = callbacks;

  const gui = new GUI({ title: 'Tuning' });
  
  const fDebug = gui.addFolder('Debug view');
  fDebug.add(DEBUG, 'showVolumes').name('Show hit volumes');
  fDebug.add(DEBUG, 'showImpulse').name('Show impulse arrows');
  fDebug.add(DEBUG, 'arrowHold', 0.1, 3, 0.1).name('Arrow hold s');
  fDebug.add(PUPPET, 'showBall').name('Show physics ball').onChange((v) => { ballDebug.visible = v; contactDot.visible = v; });
  fDebug.add(PUPPET, 'showRig').name('Show dummy').onChange(() => { const r = getRig(); if (r) r.group.visible = PUPPET.showRig; });
  fDebug.add(PUPPET, 'showAxes').name('Show joint frames').onChange(() => { axesDebug.visible = PUPPET.showAxes; });
  fDebug.add(PUPPET, 'axesSize', 0.04, 0.6, 0.01).name('Frame axis size m');
  // Rebuilding the rig is the only way to change a collider's groups here, and
  // re-fitting is already the documented way to apply a structural change.
  // Non-adjacent self-collision. ADJACENT pairs are handled separately and are
  // always off â€” see setContactsEnabled in dummy-rig.js. This switch only decides
  // whether, say, a forearm can hit the chest.
  fDebug.add(DEBUG, 'showDummy').name('Show procedural dummy')
    .onChange((v) => { dummyRoot.visible = !!v; });
  fDebug.add(PUPPET, 'selfCollide').name('Self-collision (non-adjacent)')
    .onChange(() => buildDummy());
  /* MIDAIR DIVE â€” and the two bugs that made this toggle do nothing.
  
     1. THE ACTION MACHINE COPIED ITS TUNING. `Object.assign({}, DEFAULTS, ACT)`
        at construction meant the machine read a SNAPSHOT: this handler wrote
        `ACT.diveRequiresGround = false` on the demo's object and the gate never
        saw it. Every other ACT slider was inert for the same reason. Fixed at
        source with `adoptTuning`, and `build.mjs` now fails if the copying form
        comes back.
  
     2. TWO CONTROLS, OPPOSITE POLARITY, NO SYNC. The Dive folder also carried
        `ACT.diveRequiresGround` directly, labelled "Ground required". Two
        controls over one rule, in different folders, one of them inverted, and
        neither aware of the other â€” so even once (1) was fixed, whichever you
        touched last silently won and the other kept displaying a stale value.
        There is one control now, and the Dive folder mirrors THIS property
        (`.listen()` on both) rather than owning a second opinion.
  
     The controller's `dive()` never checked grounded itself â€” it clears the flag
     and applies the impulse regardless â€” so with the gate genuinely bypassed
     there is nothing else in the chain to unblock. */
  const midairDive = fDebug.add(DEBUG, 'allowMidairDive').name('Allow midair dive')
    .onChange((v) => { ACT.diveRequiresGround = !v; });
  // Push the initial state through once, so the flag and the checkbox agree at
  // boot rather than only after the first click.
  ACT.diveRequiresGround = !DEBUG.allowMidairDive;
  fDebug.add({ k: () => knockDown('manual') }, 'k').name('Knock down (P)');
  fDebug.add({ r: respawn }, 'r').name('Respawn (R)');
  
  const fCam = gui.addFolder('Camera');
  fCam.add({ c: () => director.cycle(1) }, 'c').name('Next camera (E / RB)');
  fCam.add({ c: () => director.cycle(-1) }, 'c').name('Previous camera (Q / LB)');
  fCam.add(CAM, 'fov', 20, 90, 1).name('Field of view Â°');
  fCam.add(CAM, 'orthographic').name('Orthographic (legacy)')
    .onChange(() => { director.rebuild(); onResize(); });
  fCam.add(CAM, 'orthoZoom', 3, 40, 0.5).name('Ortho zoom').onChange(onResize);
  fCam.add(CAM, 'positionLerp', 1, 30, 0.5).name('Follow smoothing');
  fCam.add(CAM, 'targetLerp', 1, 30, 0.5).name('Aim smoothing');
  fCam.add(CAM, 'blendTime', 0.05, 2, 0.05).name('Mode blend s');
  fCam.close();
  
  const fLook = gui.addFolder('Free look');
  fLook.add(CAM, 'padLookSpeed', 0.2, 8, 0.1).name('Stick speed rad/s');
  fLook.add(CAM, 'mouseLookSpeed', 0.0002, 0.012, 0.0002).name('Mouse sensitivity');
  fLook.add(CAM, 'invertY').name('Invert Y');
  fLook.add(CAM, 'minPolarDeg', 1, 45, 1).name('Highest angle Â°');
  fLook.add(CAM, 'maxPolarDeg', 45, 89, 1).name('Lowest angle Â°');
  fLook.add(CAM, 'autoRecentre').name('Auto-recentre');
  fLook.add(CAM, 'recentreDelay', 0, 5, 0.1).name('Recentre after s');
  fLook.add(CAM, 'recentreRate', 0.1, 8, 0.1).name('Recentre rate rad/s');
  fLook.add(CAM, 'recentreMinSpeed', 0, 8, 0.1).name('Recentre above m/s');
  fLook.add(CAM, 'autoAimRate', 0.2, 6, 0.1).name('Rig auto-aim rad/s');
  fLook.add(MOUSE, 'pointerLock').name('Pointer lock on click');
  fLook.close();
  
  const fPuppet = gui.addFolder('Dummy');
  fPuppet.add({ r: () => buildDummy() }, 'r').name('Rebuild dummy');
  fPuppet.add({ r: () => getRig() && getRig().reset({
    x: rootBody.translation().x,
    y: rootBody.translation().y - TUNING.radius,
    z: rootBody.translation().z,
  }) }, 'r').name('Snap back to stance');
  // Structural: the collider shape is chosen when the collider is created.
  fPuppet.add(DUM, 'limbShape', ['capsule', 'cylinder']).name('Limb collider shape')
    .onChange(() => buildDummy());
  /* STRAFING. 'aim' keeps the chest to the net and lets lateral input step the
     athlete sideways; 'travel' turns the body to follow its own velocity.
     Movement is identical under both â€” only the visual yaw is decoupled. */
  fPuppet.add(TUNING, 'facingMode', ['aim', 'travel']).name('Facing: aim = strafe');
  fPuppet.add(TUNING, 'aimTurnRate', 1, 30, 0.5).name('Aim turn rate');
  fPuppet.add(TUNING, 'turnRate', 1, 40, 0.5).name('Turn rate (travel mode)');
  fPuppet.add(TUNING, 'facingMinSpeed', 0, 3, 0.05).name('Face travel above m/s');
  
  const fMuscle = gui.addFolder('Muscle â€” limb strength');
  fMuscle.add(DUM, 'muscleGain', 0, 3, 0.01).name('â—† Master stiffness Ã—');
  fMuscle.add(DUM, 'muscleDamping', 0, 3, 0.01).name('â—† Master damping Ã—');
  fMuscle.add({ c: () => {
    for (const g of ['spine', 'hip', 'leg', 'arm', 'grip', 'recover', 'limit', 'swing']) {
      DUM[g + 'Damping'] = +(2 * Math.sqrt(DUM[g + 'Stiffness'])).toFixed(1);
    }
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  } }, 'c').name('Critically damp (c = 2âˆšk)');
  fMuscle.add({ r: () => {
    Object.assign(DUM, DEFAULT_DUMMY_TUNING);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  } }, 'r').name('Reset to defaults');
  // Per group. Stiff hips and legs carry the stance; the arms stay loose on
  // purpose, because an arm that resists being knocked about does not read as an
  // arm. The spine is nearly free while the athlete is upright â€” the core is
  // kinematic there â€” and matters the moment a knockdown makes it dynamic.
  /* STRENGTH FIRST, because it is what was actually wrong. Stiffness sets how
     hard a joint TRIES; these two set how hard it CAN. */
  fMuscle.add(DUM, 'maxTorque', 0, 1200, 5).name('â—† Max motor torque NÂ·m');
  fMuscle.add(DUM, 'gravityComp', 0, 1.5, 0.01).name('â—† Gravity compensation');
  fMuscle.add(DUM, 'torqueStepLimit', 0.25, 12, 0.05).name('Correction cap Ã—1/dt');
  fMuscle.add(DUM, 'spineStiffness', 0, 900, 5).name('Spine k');
  fMuscle.add(DUM, 'spineDamping', 0, 150, 0.5).name('Spine c');
  fMuscle.add(DUM, 'neckStiffness', 0, 1200, 5).name('Neck k (keep high)');
  fMuscle.add(DUM, 'neckDamping', 0, 200, 0.5).name('Neck c');
  fMuscle.add(DUM, 'hipStiffness', 0, 900, 5).name('Hip k');
  fMuscle.add(DUM, 'hipDamping', 0, 150, 0.5).name('Hip c');
  fMuscle.add(DUM, 'legStiffness', 0, 900, 5).name('Knee/ankle k');
  fMuscle.add(DUM, 'legDamping', 0, 150, 0.5).name('Knee/ankle c');
  fMuscle.add(DUM, 'armStiffness', 0, 600, 5).name('Arm k (keep low)');
  fMuscle.add(DUM, 'armDamping', 0, 120, 0.5).name('Arm c');
  fMuscle.add(DUM, 'gripStiffness', 0, 900, 5).name('Hand k');
  fMuscle.add(DUM, 'gripDamping', 0, 150, 0.5).name('Hand c');
  fMuscle.add(DUM, 'ragdollDamping', 0, 12, 0.1).name('Ragdoll joint damping');
  fMuscle.add(DUM, 'recoverStiffness', 0, 900, 5).name('Get-up k');
  fMuscle.add(DUM, 'recoverDamping', 0, 150, 0.5).name('Get-up c');
  // The two integrator ceilings. Raising these is how you get an explosion, so
  // they sit at the bottom of the folder with the numbers that produced them.
  // Measured on the real arm chain: damping diverges at cÂ·dt â‰ˆ 0.85, stiffness at
  // kÂ·dtÂ² â‰ˆ 0.39. Both ship below the cliff, not at it.
  fMuscle.add(DUM, 'stiffnessStepLimit', 0.02, 0.5, 0.01).name('Ceiling: k Ã—dtÂ²');
  fMuscle.add(DUM, 'dampingStepLimit', 0.05, 1.2, 0.01).name('Ceiling: c Ã—dt');
  
  /* The swing. Targets and stiffness, nothing else â€” no clip, no blend tree. The
     PHASES come from the action machine in the Hitting folder further down; these
     only shape what the arms do inside them. */
  const fSwing = gui.addFolder('Swing â€” procedural hits');
  fSwing.add(DUM, 'swingStiffness', 0, 800, 5).name('Swing k (hitting power)');
  fSwing.add(DUM, 'swingDamping', 0, 150, 0.5).name('Swing c');
  fSwing.add(DUM, 'swingFollowThrough', 0.05, 0.95, 0.01).name('Follow-through fraction');
  fSwing.add(DUM, 'spikeArm', ['l', 'r']).name('Spiking arm');
  fSwing.add({ v: () => { pending.volley = true; } }, 'v').name('Test underhand (J / B)');
  fSwing.add({ s: () => { pending.spike = true; } }, 's').name('Test overhand (K / Y)');
  
  /* The puppet string. It does nothing while the core is pinned â€” a kinematic
     body ignores torque â€” so cut the strings if you want to see it work. */
  const fUpright = gui.addFolder('Upright stabiliser â€” the puppet string');
  fUpright.add(DUM, 'corePinned').name('Torso welded to the ball');
  fUpright.add(DUM, 'uprightStiffness', 0, 600, 5).name('Upright k');
  fUpright.add(DUM, 'uprightDamping', 0, 120, 0.5).name('Upright c');
  fUpright.add(DUM, 'spineUpright', 0, 1, 0.01).name('Spine held square');
  
  const fLimits = gui.addFolder('Joint limits & stability');
  fLimits.add(DUM, 'limitsEnabled').name('Enforce joint limits');
  fLimits.add(DUM, 'limitStiffness', 0, 2000, 10).name('Limit k (the wall)');
  fLimits.add(DUM, 'limitDamping', 0, 200, 1).name('Limit c');
  fLimits.add(DUM, 'limbMaxSpin', 0, 60, 0.5).name('Max limb spin rad/s');
  fLimits.add(DUM, 'limbMaxSpeed', 0, 60, 0.5).name('Max limb speed m/s');
  fLimits.add(DUM, 'angularDamping', 0, 3, 0.01).name('Limb spin damping')
    .onFinishChange(() => buildDummy());
  fLimits.add(DUM, 'footFrictionMoving', 0, 1, 0.01).name('Foot friction â€” moving');
  fLimits.add(DUM, 'footFrictionPlanted', 0, 2, 0.01).name('Foot friction â€” planted');
  fLimits.add(DUM, 'friction', 0, 2, 0.01).name('Other limb friction')
    .onFinishChange(() => buildDummy());
  
  const fRig = gui.addFolder('Physics puppet');
  fRig.add(DUM, 'coreLift', 0.4, 1.6, 0.01).name('Pelvis above ball m');
  // Structural: masses are set when the collider is created, so this re-fits.
  fRig.add(DUM, 'coreMassRatio', 0, 30, 0.5).name('Torso : limb mass')
    .onFinishChange(() => buildDummy());
  fRig.add(DUM, 'uprightTorque', 0, 200, 1).name('Get-up torque');
  fRig.add(DUM, 'recoverSnapAngle', 2, 70, 1).name('Re-pin within Â°');
  fRig.add(DUM, 'swingTorque', 0, 600, 5).name('Swing torque NÂ·m');
  fRig.close();
  
  /* The gait. Not a clip â€” a function of phase and speed, so there is no file to
     load, no track name to resolve and no bind pose to subtract. If the legs are
     not moving it is because gaitTargets() returned nothing, which is one place to
     look rather than five. */
  const fGait = gui.addFolder('Gait');
  fGait.add(GAIT, 'runSpeed', 1, 14, 0.1).name('Full amplitude at m/s');
  fGait.add(GAIT, 'strideRate', 0.1, 2, 0.01).name('Cycles per metre');
  fGait.add(GAIT, 'minCadence', 0, 6, 0.05).name('Idle cadence rad/s');
  fGait.add(GAIT, 'hipSwing', 0, 1.4, 0.01).name('Hip swing rad');
  fGait.add(GAIT, 'kneeBase', 0, 1, 0.01).name('Standing knee bend rad');
  fGait.add(GAIT, 'kneeSwing', 0, 2.2, 0.01).name('Knee swing rad');
  fGait.add(GAIT, 'kneeLag', -2, 2, 0.01).name('Knee lag rad');
  fGait.add(GAIT, 'armSwing', 0, 1.4, 0.01).name('Arm swing rad');
  fGait.add(GAIT, 'elbowBase', 0, 1.5, 0.01).name('Elbow bend rad');
  fGait.add(GAIT, 'elbowSwing', 0, 1.5, 0.01).name('Elbow swing rad');
  fGait.add(GAIT, 'spineCounter', 0, 0.6, 0.01).name('Torso counter-rotation');
  fGait.add(GAIT, 'breathe', 0, 0.3, 0.005).name('Idle sway rad');
  fGait.close();
  
  const fMove = gui.addFolder('Movement â€” torque & momentum');
  // Lower = more momentum. At 13 the acceleration saturates the friction ceiling
  // until top speed arrives and then stops dead, which is a velocity servo wearing
  // a torque costume. At 4.5 it tapers.
  fMove.add(TUNING, 'responseGain', 0.5, 20, 0.1).name('Velocity tracking gain');
  fMove.add(TUNING, 'walkSpeed', 1, 14, 0.1).name('Run speed');
  fMove.add(TUNING, 'sprintSpeed', 1, 22, 0.1).name('Sprint speed');
  // Friction FIRST, because it is now the acceleration ceiling in disguise:
  // a_max = friction Ã— gravity, and no torque setting can exceed it.
  fMove.add(TUNING, 'friction', 0.05, 2.5, 0.01).name('Grip  (= accel ceiling)')
    .onFinishChange(rebuildBall);
  fMove.add(TUNING, 'driveTorque', 0, 1, 0.01).name('Drive budget Ã—ceiling');
  fMove.add(TUNING, 'brakeTorque', 0, 1, 0.01).name('Brake budget Ã—ceiling');
  fMove.add(TUNING, 'airTorqueMul', 0, 1, 0.01).name('Air torque Ã—');
  fMove.add(TUNING, 'angularDamping', 0, 2, 0.01).name('Rolling resistance')
    .onChange((v) => rootBody.setAngularDamping && rootBody.setAngularDamping(v));
  fMove.add(TUNING, 'linearDamping', 0, 2, 0.01).name('Linear damping').onChange((v) => rootBody.setLinearDamping(v));
  
  const fJump = gui.addFolder('Movement â€” gravity & jump');
  fJump.add(TUNING, 'worldGravity', 1, 30, 0.1).name('World gravity').onChange((v) => {
    world.gravity = { x: 0, y: -v, z: 0 };
    // The dummy's gravity feed-forward is computed from the world's gravity, so
    // it has to be rebuilt when that changes â€” otherwise the character silently
    // starts sagging (or floating) the moment this slider moves.
    buildDummy();
  });
  fJump.add(TUNING, 'riseGravityMul', 0.5, 5, 0.05).name('Rise gravity Ã—');
  fJump.add(TUNING, 'fallGravityMul', 0.5, 8, 0.05).name('Fall gravity Ã—');
  fJump.add(TUNING, 'jumpSpeed', 1, 16, 0.1).name('Jump speed');
  fJump.add(TUNING, 'coyoteTime', 0, 0.4, 0.01).name('Coyote time s');
  fJump.close();
  
  // Slopes have almost no tuning left: a rolling sphere climbs and descends
  // correctly on its own, and the multiplier block that used to approximate that
  // is gone. Only the traversability limit and the ground stick remain.
  /* PLANTING THE FEET. Friction cannot hold a rolling sphere on a hill â€” see the
     note in athlete-controller.js â€” so this is an explicit holding torque sized to
     the grade, which fades out between the two angles below. */
  const fStance = gui.addFolder('Stance â€” resting on slopes');
  fStance.add(TUNING, 'stanceHold', 0, 1.5, 0.01).name('Hold strength Ã—gravity');
  fStance.add(TUNING, 'stanceMaxSlope', 0, 45, 0.5).name('Rest freely below Â°');
  fStance.add(TUNING, 'stanceFadeSlope', 5, 60, 0.5).name('No hold above Â°');
  fStance.add(TUNING, 'stanceMaxSpeed', 0, 6, 0.05).name('Releases above m/s');
  
  const fSlope = gui.addFolder('Movement â€” slope');
  fSlope.add(TUNING, 'maxSlopeAngle', 10, 80, 1).name('Max slope Â°');
  fSlope.add(TUNING, 'groundStick', 0, 90, 1).name('Ground stick');
  fSlope.add(TUNING, 'slideGravityBoost', 0, 6, 0.05).name('Slide slope gravity Ã—');
  fSlope.close();
  
  const fSlide = gui.addFolder('Slide');
  /* THE FOUR SLIDE SPEEDS, together and in band order, because they only make
     sense as a set â€” see the block at the top of athlete-actions.js. The HUD
     reports it in red if an edit leaves them incoherent. */
  fSlide.add(ACT, 'slideStallSpeed', 0, 6, 0.05).name('1 Â· Stall floor m/s');
  fSlide.add(ACT, 'slideMinSpeed', 0, 12, 0.1).name('2 Â· KNOCKDOWN below m/s');
  fSlide.add(ACT, 'slideExitSpeed', 0, 12, 0.1).name('3 Â· Stand-up above m/s');
  fSlide.add(ACT, 'slideMinEntrySpeed', 0, 14, 0.1).name('4 Â· Min entry m/s');
  fSlide.add(ACT, 'slideCommitTime', 0, 2, 0.05).name('Commit window s');
  fSlide.add(ACT, 'slideGraceTime', 0, 2, 0.05).name('Grace window s');
  fSlide.add(ACT, 'slideMaxTime', 1, 20, 0.5).name('Max slide time s');
  fSlide.add(TUNING, 'slideDrag', 0, 12, 0.05).name('Surface drag m/sÂ²');
  fSlide.add(TUNING, 'slideSteerAccel', 0, 30, 0.5).name('Steering m/sÂ²');
  fSlide.add(TUNING, 'slideGravityBoost', 0, 6, 0.05).name('Slope gravity Ã—');
  fSlide.add(TUNING, 'slideGroundStickMul', 0, 2, 0.05).name('Ground stick Ã—');
  /* The surface profile is memoised by mode, so a value edited WHILE the mode is
     already active would not reach the collider until the mode next changed.
     `refreshSurface()` clears the memo; the next step re-pushes. */
  fSlide.add(TUNING, 'slideFriction', 0, 1.2, 0.005).name('Slide friction').onChange(reSurface);
  fSlide.add(TUNING, 'slideDamping', 0, 4, 0.01).name('Slide lin. damping').onChange(reSurface);
  fSlide.add(ACT, 'knockdownTime', 0.1, 6, 0.05).name('Knocked time s');
  fSlide.add(ACT, 'recoverTime', 0.1, 6, 0.05).name('Recover time s');
  
  /* THE SLIDE POSE. Asymmetric on purpose: a body tilted back as one rigid piece
     reads as a mannequin toppling, and no angle fixes that, because the problem is
     that both sides are doing the same thing. One leg takes the ground, the other
     folds out of the way, and the arms counterweight it. */
  const fSlidePose = gui.addFolder('Slide pose');
  fSlidePose.add(DUM, 'slideLean', 0, 80, 1).name('Chest back Â°');
  fSlidePose.add(DUM, 'slideLeadLeg', ['l', 'r']).name('Leading leg');
  fSlidePose.add(DUM, 'slideLeadHip', 0, 85, 1).name('Lead hip flexion Â°');
  fSlidePose.add(DUM, 'slideTuckHip', 0, 85, 1).name('Tucked hip flexion Â°');
  fSlidePose.add(DUM, 'slideTuckKnee', 0, 130, 1).name('Tucked knee bend Â°');
  fSlidePose.add(DUM, 'slideArmBack', 0, 90, 1).name('Arms back Â°');
  fSlidePose.add(DUM, 'slideArmOut', 0, 60, 1).name('Arms outward Â°');
  fSlidePose.add(DUM, 'slideLiftFloor', 0, 1.2, 0.01).name('Hip height m');
  /* THE TWO HEIGHTS THAT FIX THE HOVER, side by side and in METRES.
     `coreLift` is standing height; each posture's floor is where the pelvis ends
     up when that posture is at full weight. They used to be a fraction multiplied
     by |sin(lean)|, which meant tuning the lean angle silently moved the body up
     and down â€” see `postureLean`. */
  fSlidePose.add(DUM, 'diveLiftFloor', 0, 1.2, 0.01).name('Dive hip height m');
  fSlidePose.add(DUM, 'coreLift', 0.4, 1.6, 0.01).name('Standing hip height m');
  fSlidePose.add(DUM, 'diveLean', 0, 90, 1).name('Dive lean Â°');
  fSlidePose.close();
  
  const fDive = gui.addFolder('Dive');
  // A dive is a SKID, not a jump. The lift only unsticks the sphere; the distance
  // comes from the drag and the surface profile below.
  fDive.add(TUNING, 'diveSpeed', 0, 30, 0.5).name('Launch speed m/s');
  fDive.add(TUNING, 'diveLift', 0, 12, 0.1).name('Launch lift m/s');
  fDive.add(TUNING, 'diveCancel', 0, 1, 0.05).name('Cancel prior speed Ã—');
  // Range goes past the default (9.0). A slider whose maximum sits below the
  // value it is showing silently clamps the tuning the first time it is touched.
  fDive.add(TUNING, 'diveDrag', 0, 20, 0.05).name('Dive drag m/sÂ²');
  fDive.add(TUNING, 'diveFriction', 0, 1.2, 0.005).name('Dive friction').onChange(reSurface);
  fDive.add(TUNING, 'diveDamping', 0, 4, 0.01).name('Dive lin. damping').onChange(reSurface);
  fDive.add(TUNING, 'diveRiseGravityMul', 0.2, 5, 0.05).name('Gravity Ã— rising');
  fDive.add(TUNING, 'diveFallGravityMul', 0.2, 8, 0.05).name('Gravity Ã— falling');
  fDive.add(ACT, 'diveMinAirTime', 0, 1, 0.01).name('Min air before landing s');
  fDive.add(ACT, 'diveMaxAirTime', 0.2, 5, 0.05).name('Max dive time s');
  /* MIRRORS the Debug-view control rather than binding `ACT.diveRequiresGround`
     a second time with the opposite polarity. Same object, same property, same
     sense, `.listen()` on both so touching either updates the other on screen.
     Two controllers over one rule is fine; two controllers over one rule
     disagreeing about which way is "on" is how a toggle appears broken. */
  fDive.add(DEBUG, 'allowMidairDive').name('Allow midair dive').listen()
    .onChange((v) => { ACT.diveRequiresGround = !v; midairDive.updateDisplay(); });
  
  /* --- The skid ------------------------------------------------------------
     Where a dive goes when it ends. Its own folder because it is its own state
     with its own exit condition, and because "why did the dive stop there" is a
     question you answer with these four numbers. */
  const fSkid = gui.addFolder('Skid (dive recovery)');
  fSkid.add(TUNING, 'skidDrag', 0, 20, 0.05).name('Skid drag m/sÂ²');
  fSkid.add(TUNING, 'skidFriction', 0, 1.2, 0.005).name('Skid friction').onChange(reSurface);
  fSkid.add(TUNING, 'skidDamping', 0, 4, 0.01).name('Skid lin. damping').onChange(reSurface);
  fSkid.add(ACT, 'skidExitSpeed', 0, 6, 0.05).name('Skid ends below m/s');
  fSkid.add(ACT, 'skidMaxTime', 0.5, 12, 0.1).name('Backstop s');
  fSkid.add(ACT, 'skidEndsInKnockdown').name('Dive ends on the floor');
  fSkid.close();
  
  const fBall = gui.addFolder('Ball');
  fBall.add(BALL, 'restitution', 0, 1, 0.01).name('Bounciness')
    .onChange((v) => ballEntity.collider.setRestitution && ballEntity.collider.setRestitution(v));
  fBall.add(BALL, 'friction', 0, 2, 0.01).name('Surface grip')
    .onChange((v) => ballEntity.collider.setFriction && ballEntity.collider.setFriction(v));
  fBall.add(BALL, 'linearDamping', 0, 2, 0.01).name('Air drag')
    .onChange((v) => ballBody.setLinearDamping(v));
  fBall.add(BALL, 'angularDamping', 0, 3, 0.01).name('Spin decay')
    .onChange((v) => ballBody.setAngularDamping && ballBody.setAngularDamping(v));
  fBall.add(BALL, 'spawnHeight', 0.5, 12, 0.1).name('Serve height m');
  fBall.add({ s: serveBall }, 's').name('Serve (B)');
  fBall.add({ d: dropBall }, 'd').name('Drop in place');
  
  const fHit = gui.addFolder('Hitting');
  fHit.add(HIT, 'contactHeight', 0.2, 2.5, 0.05).name('Contact height m');
  fHit.add(HIT, 'volleySpeed', 2, 40, 0.5).name('Volley speed m/s');
  fHit.add(HIT, 'volleyAngleDeg', 0, 89, 1).name('Volley angle Â°');
  fHit.add(HIT, 'volleyReach', 0.5, 5, 0.05).name('Volley reach m (sphere)');
  fHit.add(HIT, 'volleyArcDeg', 30, 360, 5).name('Volley arc Â°');
  fHit.add(HIT, 'volleyInherit', 0, 1.5, 0.05).name('Volley inherit Ã—');
  fHit.add(HIT, 'volleyCancel', 0, 1, 0.05).name('Volley cancel Ã—');
  fHit.add(HIT, 'spikeSpeed', 2, 50, 0.5).name('Spike speed m/s');
  fHit.add(HIT, 'spikeAngleGroundDeg', -60, 30, 1).name('Spike Â° at ground');
  fHit.add(HIT, 'spikeAngleApexDeg', -80, 10, 1).name('Spike Â° at apex');
  fHit.add(HIT, 'spikeApexHeight', 0.2, 5, 0.05).name('Apex height m');
  fHit.add(HIT, 'spikeReach', 0.5, 5, 0.05).name('Spike reach m (sphere)');
  fHit.add(HIT, 'spikeArcDeg', 30, 360, 5).name('Spike arc Â°');
  fHit.add(HIT, 'spikeInherit', 0, 1.5, 0.05).name('Spike inherit Ã—');
  fHit.add(HIT, 'spikeCancel', 0, 1, 0.05).name('Spike cancel Ã—');
  fHit.add(ACT, 'hitWindup', 0, 0.6, 0.01).name('Windup s');
  fHit.add(ACT, 'hitActive', 0.02, 0.6, 0.01).name('Contact window s');
  fHit.add(ACT, 'hitRecover', 0, 1.5, 0.01).name('Recover (hit) s');
  fHit.add(ACT, 'hitWhiffRecover', 0, 2, 0.01).name('Recover (whiff) s');
  fHit.add(ACT, 'hitMovePenalty', 0, 1, 0.05).name('Move throttle while swinging');
  
  /* --- Stamina -------------------------------------------------------------
     The economy, in one folder. Everything here is live: the module adopts the
     tuning object rather than copying it, so a slider changes the next frame's
     arithmetic â€” which is the only way an economy can actually be tuned, because
     the question is always "how does this FEEL over the next thirty seconds".
     ---------------------------------------------------------------------- */
  const fStam = gui.addFolder('Stamina');
  fStam.add(STAM, 'max', 10, 300, 5).name('Max');
  fStam.add(STAM, 'regen', 0, 80, 0.5).name('Regen /s (at rest)');
  fStam.add(STAM, 'regenMoving', 0, 80, 0.1).name('Regen /s (moving)');
  fStam.add(STAM, 'regenDelay', 0, 3, 0.05).name('Regen delay s');
  fStam.add(STAM, 'restSpeed', 0, 4, 0.05).name('â€œAt restâ€ below m/s');
  fStam.add(STAM, 'diveCost', 0, 100, 1).name('Dive cost');
  fStam.add(STAM, 'hitCost', 0, 60, 1).name('Hit cost');
  fStam.add(STAM, 'slideDrain', 0, 100, 1).name('Slide drain /s');
  fStam.add(STAM, 'slideMinReserve', 0, 100, 1).name('Slide reserve');
  fStam.add(STAM, 'jumpCost', 0, 60, 1).name('Jump cost');
  fStam.add(STAM, 'jumpHoldDrain', 0, 40, 0.5).name('Jump hold drain /s');
  fStam.add(STAM, 'sprintDrain', 0, 40, 0.5).name('Sprint drain /s');
  fStam.add(STAM, 'sprintMinReserve', 0, 60, 1).name('Sprint reserve');
  fStam.add(STAM, 'inclineDrain', 0, 20, 0.1).name('Climb tax /(m/s up)');
  fStam.add(STAM, 'inclineMinSlope', 0, 45, 1).name('Climb tax above Â°');
  fStam.add(STAM, 'exhaustTime', 0, 6, 0.1).name('Exhaustion s');
  fStam.add(STAM, 'exhaustBlocksAll').name('Exhaustion blocks all');
  fStam.add({ refill: () => stamina.reset() }, 'refill').name('Refill now');
  fStam.add({ empty: () => stamina.reset(0) }, 'empty').name('Drain to 0');
  
  /* --- Authored clips ------------------------------------------------------
     Empty and inert until a .glb is dropped on the window. The weight is the one
     to reach for first: 0 is the pure procedural rig we tuned, 1 is the artist's
     pose, and everything between is a cross-fade you can watch. */
  /* --- The visible character ----------------------------------------------- */
  const fChar = gui.addFolder('Character (.glb)');
  fChar.add(VIEW, 'yawOffsetDeg', -180, 180, 1).name('Yaw offset Â°');
  fChar.add(VIEW, 'scale', 0.2, 3, 0.01).name('Model scale')
    .onChange((v) => { const v_obj = getView(); if (v_obj) v_obj.model.scale.setScalar(v); });
  fChar.add(VIEW, 'fade', 0, 1, 0.01).name('Cross-fade s');
  fChar.add(VIEW, 'yawRate', 1, 60, 0.5).name('Yaw chase rate');
  fChar.add(VIEW, 'liftRate', 0.5, 40, 0.5).name('Hip-drop rate m/s');
  fChar.add(VIEW, 'strideMatch').name('Match stride to speed');
  fChar.add(VIEW, 'runAuthoredFor', 0.2, 16, 0.05).name('run authored m/s');
  fChar.add(VIEW, 'sprintAuthoredFor', 0.2, 20, 0.05).name('sprint authored m/s');
  fChar.add({ show: () => { DEBUG.showDummy = !DEBUG.showDummy; dummyRoot.visible = DEBUG.showDummy; } },
    'show').name('Toggle procedural dummy');
  
  const fClips = gui.addFolder('Authored clips (.glb)');
  fClips.add(CLIPS, 'weight', 0, 1, 0.01).name('Clip weight');
  fClips.add(CLIPS, 'strideMatch').name('Match stride to speed');
  fClips.add(CLIPS, 'walkAuthoredFor', 0.2, 12, 0.05).name('walk authored m/s');
  fClips.add(CLIPS, 'runAuthoredFor', 0.2, 16, 0.05).name('run authored m/s');
  fClips.add(CLIPS, 'sprintAuthoredFor', 0.2, 20, 0.05).name('sprint authored m/s');
  fClips.add(CLIPS, 'status').name('Loaded').listen().disable();
  fClips.close();
  
  const fInput = gui.addFolder('Input');
  fInput.add(INPUT_T, 'deadzone', 0, 0.6, 0.01).name('Stick deadzone');
  fInput.add(INPUT_T, 'stickCurve', 0.5, 3, 0.05).name('Stick curve');
  fInput.add(INPUT_T, 'sprintTrigger', 0.1, 1, 0.05).name('Sprint trigger');
  fInput.close();

  return gui;
}
