/**
 * LAW 4 — One source of truth.
 *
 * Every tunable number in the project lives in this one object. There is no
 * second config, no per-module default, no magic number scattered through a
 * module.
 *
 * Values are read LIVE, every tick. Never copy one of these into a module-level
 * `const` at import time — the GUI slider would then silently do nothing.
 *
 * CONSTRUCTION-TIME VALUES. A handful are read once, when a body, a collider or
 * a geometry is built, and cannot take effect without a reload. They live here
 * anyway — this is the single source of truth — but the GUI renders them as
 * disabled, display-only controllers rather than sliders that appear to work and
 * do not. They are marked below. `loop.fixedHz` is the original member of that
 * group: changing the timestep at runtime destroys determinism.
 */

const DEFAULTS = {
  // Construction-time: the loop binds fixedHz once. LAW 6.
  loop: { fixedHz: 60, maxFrameTime: 0.25 },

  debug: {
    showHud: true,
    showSphereWireframe: false,
    showRagdollColliders: true,
    showCharacterMesh: false,
    showBallWireframe: false,
  },

  // -12, not -20. The user tested this live through the GUI and reported the
  // jump feels much better; it was never written back to disk, so the file
  // still shipped -20 and every fresh load undid the finding.
  physics: { gravityY: -12 },

  // THE TWO ARENAS. All construction-time: whichever one is selected is built
  // once at boot and never rebuilt on the fly.
  arena: {
    // 'court' | 'bowl'. Read ONCE at boot and overridable per run with the
    // query parameter ?arena=bowl — same reasoning as ?captureTick, which is
    // that harness configuration must not require editing saved tuning state.
    type: 'court',
    modelUrl: '/models/arena.glb',

    // THE AUTHORED COURT. A 50 x 120 m valley basin: the inner field rises from
    // the centre out to the ends, streams flank it, and two goal hoops face
    // across the court width at z = +/-40. There is no net.
    court: {
      // The centre circle. The athlete lands here and can run either way.
      spawn: { x: 0, y: 1.5, z: 0 },
      // Below the lowest basin. The authored glass barriers are 1-2 triangle
      // placeholders with open lower corners, so a ball CAN leave through them
      // near the top corners — the kill plane is the real boundary contract
      // until G5 authors proper boundary volumes.
      killPlaneY: -15,
      ballSpawns: [
        { x: -3.0, y: 3.5, z: 1.5 },
        { x: 0.0, y: 4.5, z: 3.0 },
        { x: 3.0, y: 5.5, z: 1.5 },
      ],
    },

    // THE TEST RIG, preserved exactly. Every determinism pair measured to date
    // was measured on these numbers; they are the baseline and they do not move
    // because the court arrived.
    bowl: {
      floorRadius: 30,
      rimRadius: 48,
      rimHeight: 8,
      // Points across the flat floor and up the wall. The lip adds lipPoints on
      // top of these, so the profile is profilePoints + lipPoints long.
      profilePoints: 40,
      latheSegments: 96,
      wallCurvePower: 2,
      // THE LIP. Past the rim the profile turns back INWARD and keeps climbing,
      // so a ball arriving with real speed meets an overhang instead of a launch
      // ramp. Inset is how far in it curls, height how far up.
      lipInset: 3,
      lipHeight: 2,
      lipPoints: 6,
      // The watchdog floor. Anything below this has left the world.
      killPlaneY: -10,
      spawn: { x: 0, y: 3.0, z: 0 },
      ballSpawns: [
        { x: -3.5, y: 3.5, z: 2.0 },
        { x: 0.0, y: 4.5, z: 3.5 },
        { x: 4.0, y: 5.5, z: 2.0 },
      ],
    },
  },

  // SETTINGS SHARED BY EVERY BALL. Not per-spec, because neither is a property
  // of any one ball: the threshold is about what the instrumentation should
  // bother reporting, and the capture tick is harness timing.
  ball: {
    // N — below this Rapier raises no contact event AT ALL, so the strike
    // resolver never sees the touch even though the collision still happens.
    // Lowered from 5 so a soft contact on a falling ball can resolve.
    eventThreshold: 1.0,
    captureSpawnTick: 30, // reset on the tick the ragdoll spawns in an armed run
  },

  // THE BALL FIXTURE — three sizes at once, to judge scale and collision feel
  // against each other rather than one at a time from memory.
  //
  // SPAWN POSITIONS ARE NOT HERE. They belong to the ARENA, not to the ball:
  // the same three balls drop into two differently shaped worlds, and a spawn
  // that suits the bowl's flat floor is not the one that suits the court's
  // centre circle. TUNING.arena.<type>.ballSpawns supplies them, matched to this
  // array by index.
  //
  // ORDER IS LOAD-BEARING (LAW 6). Bodies are created in this order, Rapier
  // hands out handles in creation order, and the solver walks them in handle
  // order — so reordering this array changes the simulation. Append, do not
  // shuffle.
  //
  // The densities fall with size on purpose. Held at the dodgeball's
  // 0.025 g/cm3 a 1.5 m ball would mass 44 kg and would not be a ball the
  // athlete plays with, it would be a wall that rolls. These are authored from
  // the mass wanted, backwards: density = mass / ((4/3) pi r^3) / 1000.
  balls: [
    {
      id: 'small',
      label: 'Small (0.4m)',
      radius: 0.20,
      density: 0.025,     // -> 0.838 kg
      friction: 0.8,
      restitution: 0.88,
      linearDrag: 0.015,
      angularDrag: 0.04,
      colorA: 0xd32f2f,   // crimson
      colorB: 0xf5f5f5,   // white
    },
    {
      id: 'medium',
      label: 'Medium (1.0m)',
      radius: 0.50,
      density: 0.0042,    // -> 2.199 kg
      friction: 0.8,
      restitution: 0.88,
      linearDrag: 0.012,
      angularDrag: 0.03,
      colorA: 0x1976d2,   // blue
      colorB: 0xfbc02d,   // yellow
    },
    {
      id: 'large',
      label: 'Large (1.5m Exercise Ball)',
      radius: 0.75,
      density: 0.0022,    // -> 3.888 kg
      friction: 0.85,
      restitution: 0.85,
      linearDrag: 0.01,
      angularDrag: 0.02,
      colorA: 0x7b1fa2,   // purple
      colorB: 0xb0bec5,   // silver
    },
  ],

  motor: {
    // Construction-time: radius and density size the ball collider.
    radius: 0.5,
    density: 2.0,
    spawnY: 3,
    // Live.
    friction: 1.0,
    restitution: 0.0,
    // HEAVY. Halved from 6.0. Drive torque is what the player pushes with on
    // flat ground, and cutting it is what makes flat-ground momentum expensive
    // to build without capping what gravity can give you down a slope — a
    // velocity cap would do the opposite, so the acceleration is what moves.
    driveTorque: 4.0,
    // 12 rad/s = 6.0 m/s. LOWERED from 25, and this is the lever that actually
    // delivers the heaviness — cutting driveTorque alone did not, because at
    // 3.0 the motor still had enough authority to climb all the way to the old
    // 25 rad/s ceiling, just slower. Measured: flat sprint stayed at 12.46 m/s
    // while a slope ride only returned 7.70, so the flat was FASTER than the
    // bowl and the design goal was inverted.
    //
    // Why this cap and not a velocity clamp: the governor STARVES DRIVE TORQUE
    // and never writes a velocity (LAW L1). So it bounds what the player can
    // push themselves to on flat ground and does nothing whatsoever to speed
    // that gravity supplied. Ride the wall down and the ball passes straight
    // through this number — which is exactly the asymmetry the brief asks for:
    // flat ground is sluggish, the bowl is where speed lives.
    maxAngularSpeed: 12,
    // Seeded at 8.0 by the spec; measured down to 1.0 to satisfy acceptance
    // criterion 2. A braking impulse of T decelerates this rolling ball at
    // T * radius / (I + m * radius^2) = 1.364 * T m/s^2. At T = 8 that is
    // 10.9 m/s^2, which exceeds gravity's pull along the bowl wall everywhere
    // below r ~= 11 (10.6 m/s^2 at r = 10). The released ball therefore parks
    // on the slope and creeps down at 0.1 m/s instead of rolling back, crossing
    // the floor and oscillating up the far side. At 1.0 the brake is 1.36
    // m/s^2, gravity wins on every part of the wall, and the ball still comes
    // to a dead stop on the flat floor in under 2 s from 5 m/s.
    brakeTorque: 2.0,
    // 0.5 — a slight raise from 0.4, and deliberately no more.
    //
    // Resistance turned out NOT to be a heaviness lever: the governor sets the
    // flat-ground terminal speed by starving torque, so the flat ceiling is
    // 6.04 m/s at every value tried between 0.30 and 0.75. What resistance does
    // change is how much of a slope ride survives to the bottom:
    //
    //     rollRes | flat sprint | slope-ride peak
    //       0.30  |    6.05     |      5.49
    //       0.40  |    6.04     |      5.28
    //       0.55  |    6.04     |      4.96
    //       0.75  |    6.04     |      4.35
    //
    // So raising it past here costs the bowl its whole point without making the
    // flat any slower. The heaviness comes from maxAngularSpeed and driveTorque.
    rollingResistance: 0.5,
    airControlMultiplier: 0.15,
    groundRayCount: 8,
    groundedEpsilon: 0.15,
    stickDeadzone: 0.15,
    // THE KNOCKDOWN DRAG. Multiplies the REQUESTED brake and rolling-resistance
    // impulses as the tracking weight craters, so a sphere whose rider has been
    // put on the floor drags to a stop instead of rolling on alone. It is a
    // multiplier on an impulse that still goes through the L3 clamp, which means
    // it can only stop the ball sooner — never reverse it, however large this
    // gets. At weight 1 the multiplier is exactly 1 and clean play is untouched.
    downedDragBoost: 40,
  },

  jump: {
    impulse: 7.0,
    fallGravityMultiplier: 2.0,

    // THE AIRBORNE OVERRIDE. Asymmetric on purpose: a jump leaves the ground
    // in a couple of frames and the pose has to commit that fast, but a landing
    // that snapped back to locomotion at the same rate reads as a cut. Fast in,
    // soft out.
    airEaseIn: 18.0,
    airEaseOut: 5.0,
    // THE LATCH WINDOW. Horizontal speed at the instant of liftoff decides
    // which jump clip plays for the WHOLE flight — below inPlaceBelow it is
    // entirely the standing jump, above runAbove entirely the running one,
    // linear between. Latching at liftoff rather than mixing continuously is
    // what stops a jump that slows down in the air from morphing between two
    // clips while the character is committed to one arc.
    inPlaceBelow: 1.5,
    runAbove: 4.0,
    standingClip: 'Standing Jump',
    runningClip: 'Jump Running',
    // Mixamo's jump clips open on a crouch and close on a recovery that both
    // belong to a root-motion take we are not playing. The scrub is mapped into
    // this window so the overlay shows the flight, not the wind-up.
    clipStart: 0.15,
    clipEnd: 0.85,
    // Ticks between jumps. Raised from 30 to 90 (1.5 s) as the anti-bunny-hop
    // measure — the player has to actually run between jumps rather than
    // pogoing across the arena.
    //
    // NOTE: this is the jump cooldown. The addendum asked for a new
    // action.jumpCooldownTicks gating consumeJump in main.js, but that gate
    // already exists here and has since GF-1, enforced inside updateMotor and
    // verified at exactly 30-tick spacing across 300 ticks of spam. A second
    // cooldown in main.js would be two mechanisms for one rule, and the one
    // that fired first would win by accident. Raising this is the same change.
    cooldownTicks: 90,
    // Consecutive grounded ticks before the ANIMATION believes it. The ground
    // ray can flash true for a single tick when the sphere grazes a steep wall
    // mid-flight, which was enough to yank airborneMix down by a quarter in one
    // step (it eases at airEaseIn 18/s) and, with a jump queued, to register a
    // fresh liftoff and re-latch the clip mix mid-air. Asymmetric on purpose:
    // leaving the ground is believed instantly, arriving takes confirmation.
    groundedDebounceTicks: 3,
    // THE HOLD-POINT RATCHET (RULING GF-3.3). All three are points in the clip
    // or rates through it, in clip-fractions and clip-fractions per second.
    // Nothing here derives from vertical velocity any more.
    //
    // takeoffRate carries the clip from its first frame to the hold point in
    // apexHold / takeoffRate = 0.31 s, about the time a jump takes to leave the
    // ground and open out.
    takeoffRate: 2.5,
    // WHERE THE POSE HOLDS. The clip stops here for the whole airtime, and that
    // held frame IS the airborne pose — a jump is one shape held, not a
    // sequence played at whatever rate the arc happens to imply. Just past the
    // middle of the usable window, where the Mixamo jumps have their legs
    // gathered under them.
    apexHold: 0.55,
    // Rate from the hold point through the landing frames to 1.0 once the feet
    // are down: 0.45 of the clip in 0.18 s. Fast enough not to outlast
    // airEaseOut, slow enough to be seen.
    landRate: 2.0,
  },

  // REACTIVE RAGDOLLING. Contact forces on the character's own colliders push
  // the tracking weight down. forceThreshold is set from measurement, not from
  // taste — see the calibration numbers in the Task 6 report.
  impact: {
    // Rapier's own pre-filter: contacts below this never become events at all.
    eventThreshold: 500,
    // MEASURED, not chosen. Clean play (30 s of idle, sprint and jumps) peaks
    // at 29,690 N — the character's own feet striking the floor, driven down by
    // the PD tracker. 32,000 clears that with margin and costs clean play
    // exactly 0.000 weight over the whole 30 s.
    forceThreshold: 32000,
    // At this scale a free drop from the lip drains 1.16 — a full knockdown —
    // while clean play drains nothing. See the Task 6 calibration table.
    scale: 1e-3,
    // Where it lands matters: a head hit puts you down, a hand hit does not.
    multiplier: { head: 2.0, torso: 1.0, limb: 0.7, extremity: 0.4 },
    // Ticks the HUD keeps showing the last impact before it fades.
    hudHoldTicks: 120,
    // Where the knockdown drag starts to bite, as a tracking weight. The curve
    // is a smoothstep from here down to 0, so there is no threshold to cross —
    // at weight 1 the drag multiplier is exactly 1 and it rises smoothly as the
    // character loses its footing.
    dragOnset: 0.5,
    // How far the sphere must be from the fallen pelvis before the snap is
    // worth doing. It replaces tracking.maxMountDistance in that condition:
    // that gate was 0.5 m, so any knockdown that ended inside half a metre
    // never snapped at all, and the ghost's mountSlack then dragged the
    // character backward onto a sphere it was already standing next to. This
    // is small enough that almost every knockdown qualifies and large enough
    // that a settled character does not re-trigger on numerical noise.
    // Inside this the sphere is already under the body and the follower rests.
    // It is a deadband, not a trigger: the follower is continuous either side.
    mountSnapEpsilon: 0.05,
    // THE FOLLOWER. 1/s — how hard the sphere is pulled toward the fallen
    // pelvis. Exponential when close, so it settles without overshoot.
    mountFollowRate: 9.0,
    // m/s — the ceiling on that pull. THIS is the number that keeps the follow
    // smooth: the per-step displacement is capped at mountFollowSpeed * dt, so
    // the sphere never moves further in one step than it would while sprinting,
    // and the ordinary prev/curr interpolation absorbs it with no reset and no
    // stutter. Raising it past the motor's own top speed reintroduces the
    // teleport this replaced.
    mountFollowSpeed: 12.0,
    // Mount recovery will not even be considered above this weight. It is a
    // guard on a sanctioned spawn event, not a knob for feel: raising it makes
    // the event reachable while the character is still fighting to stay up,
    // which is exactly what RULING GF-1.4 forbids.
    // RAISED to 0.50 in Task 7. The specified 0.30 was measured and does NOT
    // work: on a sprint knockdown the weight gate is open for ticks 0..58 and
    // standUpNeed does not cross 0.7 until tick 59. They miss by ONE TICK, and
    // the overlap is exactly zero.
    //
    // That near-miss is structural, not luck, and it explains why this has been
    // intermittent across three tasks: recoverPerSecond 0.3 walks the weight to
    // 0.30 in exactly 60 ticks, and standUp.ease 6.0 walks the pelvis down to
    // standUpNeed 0.7 in about 59 — two unrelated seeds that happen to produce
    // almost identical durations, so the gates hand off with no overlap and any
    // small change flips the result between "fires" and "never fires".
    //
    // standUpNeed PEAKS at 0.805 around tick 88, where the weight has reached
    // 0.445. A gate at 0.50 gives ticks 0..100 against standUpNeed's 59..113 —
    // a 41-tick overlap that is not sensitive to either rate.
    //
    // Still unreachable in healthy play, which is what RULING GF-1.4 requires:
    // the AND with standUpNeed > 0.7 means the pelvis is under 0.29 m off the
    // surface. You cannot be lying on the floor while tracking is healthy, and
    // at weight 0.50 the pelvis servo is at 0.50^5 = 3% of full stiffness.
    mountRecoverBelow: 0.50,
  },

  // THE STAND-UP. Two continuous signals — how low the pelvis is, and which way
  // it is facing — with no latch and no state between them.
  standUp: {
    // THE TWO ENDS OF standUpNeed, both measured off the pelvis body's height
    // above the floor under it. Need is 0 at standHeight and 1 at proneHeight.
    //
    // proneHeight used to be an implied ZERO, which no athlete ever reaches:
    // a pelvis lying flat measures 0.130 m in every trace, so need saturated at
    // 0.86 and two things followed from it. standShare could never exceed 0.86,
    // so 14% of the blend was still walking while the athlete lay on the floor;
    // and the stand-up band never reached the front of the clip. Spanning the
    // real range fixes both, and it also drops the resting need from 0.06 to a
    // clean 0 — that 0.06 was the noise floor the mount follower's gate had to
    // be lifted clear of.
    pelvisStandHeight: 0.95,
    pelvisProneHeight: 0.13,
    ease: 6.0,

    // THE PLAY RATE, in phase per second. No longer a floor under a
    // body-driven scrub — it IS the scrub now, and it should read as the speed
    // the take plays at. The live window is 0.56 of a 2.35 s clip = 1.32 s, so
    // 0.75 is the take at its authored pace.
    minRate: 0.75,

    // HOW FAR AHEAD OF THE RECOVERY THE POSE MAY RUN.
    //
    // The scrub's ceiling is the weight scaled by this. It was 3 on the theory
    // that the pose should FINISH and wait, because the body only moves by
    // being hauled toward it — but the tail of that wait is the same failure
    // the whole redesign was for, just moved to the end: the ghost holding a
    // standing pose while the body is dragged up under it. Measured, ticks from
    // the take completing to the pelvis actually reaching standing height:
    //
    //     gain 3.0 -> 86 ticks    2.0 -> 58    1.6 -> 45    1.2 -> -13
    //
    // At 1.2 the take lands within a couple of hundred milliseconds of the
    // athlete arriving upright, and standShare stays pinned at 1.00 across the
    // entire rise instead of handing back half way. The cost is that the clip
    // plays over about 2.2 s rather than its authored 1.32 s — slower than
    // authored, and much better looking, because a get-up that finishes with
    // the athlete reads as driving him and one that finishes early reads as
    // nothing happening.
    recoverGain: 1.2,

    // HOW MUCH STIFFNESS THE GET-UP ITSELF IS WORTH, 0..1, floored into
    // kpScale in tracker.js. See the note at the site: without it the take
    // plays through the exact window where weight^limpness is zero, and the
    // athlete has no means to perform it. 1.0 means "a get-up at full swing is
    // as strong as a standing athlete", which is roughly true of a real one.
    authority: 1.0,

    // HOW BIG A ONE-TICK FALL IN THE WEIGHT COUNTS AS A COLLAPSE.
    //
    // Comfortably above anything the impact drain does in a single step and
    // comfortably below the smallest real knockdown, which is 1.0 -> 0.2. It
    // exists because a knockdown no longer always lands on zero: see the note
    // at the site in animtarget.js.
    collapseDrop: 0.5,

    // HOW THE TAKE HANDS THE POSE BACK, in phase.
    //
    // standShare used to be standUpNeed and nothing else, and need is
    // 1 - weight: so the share was governed by the recovery ramp while the
    // scrub was governed by the take's own clock, and the two finish at
    // completely different times. Traced: progress reached 1.000 with need
    // still at 0.60, so the last third of the get-up was blended at 60% against
    // 40% locomotion — and worse, the athlete kept 40% of a WALK pose while
    // lying on the floor. The take now holds the pose outright until it has
    // actually played, then hands back.
    //
    // This is the width of the handback, not a switch: full control while
    // progress is below 1 - releaseBand, ramping to nothing as it reaches 1.
    // A hard "share = 1 while 0 < progress < 1" would step the blend weight the
    // instant the clip ended, which is a visible pop in the one frame the
    // athlete is finally upright.
    releaseBand: 0.25,

    // THE CLIP'S LIVE WINDOW, same idea as jump.clipStart/End. Both takes open
    // and close on a static hold: measured hips height per phase, Face Down
    // sits at 0.270 until 0.15 and at ~1.03 from 0.72; Face Up sits at ~0.12
    // until 0.12 and at ~0.94 from 0.68. Scrubbing the whole clip spent about
    // 45% of the get-up on two frozen poses. One pair covers both.
    clipStart: 0.14,
    clipEnd: 0.7,


    faceBlendBand: 0.2,
    mountSlack: 0.15,
    faceDownClip: 'Stand Up Face Down',
    faceUpClip: 'Stand Up Face Up',
  },

  // THE 2D LOCOMOTION BLEND SPACE — three concentric rings of directional
  // clips, selected by speed (which ring) and by heading relative to facing
  // (where on the ring). Replaces the 1D idle/jog/sprint speeds.
  blend2d: {
    // Ground speeds (m/s) at which each ring owns the whole gait weight. Idle
    // is 0 implicitly: it is not a ring, because it has neither a cycle nor a
    // direction. These doubles as the ring's NOMINAL speed for stride sync —
    // "the speed this clip was authored to travel at" and "the speed at which
    // this ring owns the blend" are the same number by construction.
    // LOWERED with the motor. These are the speeds at which each animation
    // ring owns the blend, so they have to track what the character can
    // actually reach or the gait reads wrong: leave sprintSpeed at 8.5 while
    // flat-ground sprint tops out near 6 and the sprint clip never fully
    // engages on the flat. Re-seeded against the measured new ceilings.
    // Re-seeded a second time from a play session: these are the values that
    // felt right in the GUI, written down so a reload keeps them.
    walkSpeed: 2.0,
    runSpeed: 4.5,
    sprintSpeed: 6.0,

    // THE NODE TABLE. Ring order is F, R, B, L throughout and must stay in that
    // order — the angular tent reads it as four equal sectors starting at
    // forward and going clockwise (toward +X, i.e. the character's right).
    //
    // B IS A FIRST-CLASS SLOT ON BOTH RINGS, and each ring owns its own clip.
    //
    // It was not always. Through Phase 2 there was no backpedal clip in the
    // asset at all and the back of BOTH rings stood in with the walk ring's own
    // forward clip; G1 named "Walk Backwards" in one shared seam, which retired
    // the stand-in but still handed a single node object to both rings, so
    // backing up at run speed was a walk cadence stretched to fit. Both of those
    // were compromises on clips that did not exist. They do now.
    //
    // WALK BACK — "Walk Backwards": 1.22 s, loops with 0 degrees of closure
    // error, zero travel to strip, the same 1.05-1.2 s cadence as "Walk Forward".
    // RUN BACK — "Jog Backwards": 0.73 s, authored at run cadence against
    // "Running Forward" at 0.72 s. It carries 1.20 m of travel; LAW L5 removes
    // it, measured at 0.0000 m residual.
    //
    // AN EMPTY STRING IN EITHER `b` SLOT still means "this ring has no backpedal
    // clip", and that ring alone falls back to a clone of the walk ring's
    // forward clip played FORWARD — not reversed. The measurement behind that
    // choice lives in the comment at the fallback in animtarget.js and stays
    // there as the record; it is why a reversed stand-in is never coming back.
    // The two rings fall back independently: emptying one does not touch the
    // other.
    //
    // Ring order is F, R, B, L. The tent reads it as four equal sectors, so the
    // key order in these tables is cosmetic but kept honest to that reading.
    walkClips: { f: 'Walk Forward',    r: 'Walk Strafe Right', b: 'Walk Backwards', l: 'Walk Strafe Left' },
    runClips:  { f: 'Running Forward', r: 'Strafe Run Right',  b: 'Jog Backwards',  l: 'Strafe Run Left' },
    // The sprint ring has a forward node and nothing else — there is no lateral
    // sprint clip and inventing one by stretching a run strafe would read as a
    // skid. See the CAP RULE in animtarget.js for where the missing weight goes.
    sprintClip: 'Running Sprint',
  },

  // Which way the character faces, as one continuously mixed heading. The right
  // stick's own deadzone is TUNING.motor.stickDeadzone — one deadzone for both
  // sticks, so they feel the same in the hand.
  // Camera-locked facing: the character turns to match the camera's heading.
  // Raised from GF-1's 8.0 — facing now has to track a camera the player is
  // actively swinging rather than a velocity heading that changes slowly, and
  // at 8 the character visibly lagged the view. High enough to feel locked,
  // low enough that it is still an ease and not a per-frame snap.
  facing: {
    ease: 12.0,
    // m/s. Below this there is no travel direction worth reading and the last
    // heading is HELD — a stopping athlete must not swing to wherever the final
    // centimetre per second happened to point. It sits above the contact jitter
    // on a rolling ball (several tenths of a m/s, the same noise
    // anim.blend.speedSmoothing exists for) and well below walkSpeed 2.0, so
    // any deliberate movement turns him.
    velocityFloor: 0.6,

    // COASTING — facing the way you are actually travelling when you are not
    // steering. Below steerDeadzone the stick counts as released; above
    // coastSpeed the athlete is genuinely being carried somewhere; coastEase is
    // how fast the facing drifts onto the travel heading once both hold. The
    // return is not eased at all — any steering zeroes the mix on the tick it
    // arrives, so the athlete is strafing again immediately.
    steerDeadzone: 0.1,
    coastSpeed: 0.5,
    coastEase: 3.0,
  },

  anim: {
    // Global multiplier on the gait's rate and on the idle action's playback.
    timeScale: 1.0,

    // 'auto' runs the blend space. Any clip name pins that single clip at
    // weight 1 — the Task 4 behaviour, kept for debugging and for the L5 creep
    // test, where a run clip is pinned while the sphere sits still.
    override: 'auto',

    // Idle is the one node that is not part of the blend space: no ring, no
    // direction, no phase. It free-runs on the mixer.
    blend: {
      idleClip: 'At Rest',
      // 1/s. Contact jitter on a rolling ball is several tenths of a m/s of
      // noise; without this the weights flicker and so does the pose. Applied
      // to the velocity VECTOR now, not just its magnitude, so a jittering
      // heading cannot make the direction tent chatter either.
      speedSmoothing: 6.0,
      // 1/s. The eased weights ARE the crossfade — see animtarget.js on why
      // three's fade API is not used.
      weightEase: 8.0,
    },

    // Stride sync: turn the legs over at roughly ground speed. With root motion
    // stripped the feet must skate somewhat; this bounds how much. The per-clip
    // nominal speed is the ring's own blend2d speed — the two were always the
    // same number, and keeping a second copy here let them drift apart.
    stride: {
      enabled: true,
      min: 0.6,
      max: 1.6,
    },
  },

  // THE TWO ACTIONS. Slide and dive are orchestrated in main.js out of the
  // motor's existing scale parameters and the one blend weight; nothing here
  // introduces a character state.
  action: {
    // Resolved against the character asset plus the optional actions.glb. A
    // name that resolves to nothing warns once at boot and falls back to the
    // held airborne pose — the mechanics work whether or not the art is there.
    slideClip: 'Slide Left',
    diveClip: 'Running Dive',

    // THE USABLE WINDOW OF EACH ACTION CLIP, same idea as jump.clipStart/End.
    //
    // Measured on the fifteen-clip predecessor asset, hips height in world metres with the
    // L5 strip applied, sampled across the clip:
    //   Slide Left    0.900 -> 0.255 (sliding) -> 0.987 (back on his feet)
    //   Running Dive  0.909 -> 1.046 (the leap) -> 0.281 at 0.85 -> -0.740
    // The slide is a complete take and is played whole. The dive is authored
    // as a dive off a height: past 0.85 it keeps descending at roughly 6 m/s
    // and ends 0.74 m BELOW the floor it started on, and since the ghost is
    // what the tracker chases, that tail would haul the athlete through the
    // court. 0.85 is where the hips reach 0.281 — prone, matching the depth
    // the slide reaches — so the clip is cut at the landing rather than at
    // the end of the authored fall.
    slideClipStart: 0.0,
    slideClipEnd: 1.0,
    // diveClipStart SKIPS THE RUN-UP. Torso tilt from world up across the
    // clip: 26 deg standing at 0.00, still 70 deg with both feet planted at
    // 0.30, and the airborne extension is 0.45-0.65 (83-114 deg, feet leaving
    // the floor at 0.176 -> 1.117). Starting at 0 meant a third of a second of
    // wind-up the athlete had already done for real, which is the "takes too
    // long to assume the dive pose". 0.45 puts him in the superman on the
    // launch tick.
    diveClipStart: 0.45,
    // PULLED BACK FROM 0.85, AND THIS IS THE SCORPION FIX.
    //
    // The legs kicking the athlete in the head was not a physics glitch: it was
    // in the take. Measured the GHOST's own target pose through a dive — its
    // feet reached 1.18 m ABOVE its own head by the end of the window, because
    // "Running Dive" finishes on a forward roll and 0.85 was deep into it. The
    // body only ever reached 0.66 m, so the ragdoll was already resisting the
    // pose it was being given rather than causing the problem. Every physics
    // lever pushed the wrong way for the same reason: raising the leg stiffness
    // from 0.10 to 0.40 made it WORSE (0.65 m -> 0.84 m), because a stiffer leg
    // tracks the animation more faithfully and the animation was the scorpion.
    //
    // Ending the window at 0.52 stops it at clip tilt 92 degrees — the athlete
    // extends from the launch to dead horizontal and no further. The take's
    // tumble is not needed: he goes limp at touchdown and the physics rolls him.
    //
    //     end 0.85 -> body 0.659 m above head, ghost 1.565
    //     end 0.70 -> body 0.501, ghost 1.014
    //     end 0.58 -> body 0.384, ghost 0.642
    //     end 0.52 -> body 0.299, ghost 0.424     <- shipped
    //     end 0.48 -> body 0.294, ghost 0.300     (window 0.03 wide, a frozen pose)
    //
    // 0.30 m of foot above head is a diving athlete, not a scorpion.
    diveClipEnd: 0.52,

    // THE DIVE'S AIRBORNE HOLD POINT, and the two rates that reach it. Same
    // shape as the jump's hold-point ratchet (RULING GF-3.3) and the slide's.
    //
    // divePoseTicks IS GONE. It played the window 0.45..0.85 linearly over 25
    // ticks, but the flight lasts about 45 (diveImpulseUp 4.5 against gravity
    // -12), so from tick 25 onward the ghost was holding the END of the window
    // — clip phase 0.85, which is the LANDING pose, head well below hips — for
    // the last third of the flight. Measured: the ghost's pelvis tilt sat pinned
    // at 144.7 degrees from world up while the athlete was still in the air.
    // That is the face-plant. It was never limpness; weight is 1.00 through the
    // whole dive, and the body was tracking that pose to within 10 degrees. He
    // was diving head-first because the animation told him to.
    //
    // The pose now ratchets to diveHoldPhase and STOPS there for as long as he
    // is airborne. 0.25 of the window is clip phase 0.55, measured at 98 degrees
    // of torso tilt — just past horizontal, which is the soaring superman. On
    // ground contact the ratchet continues to 1 and the landing plays out under
    // the skid.
    diveHoldPhase: 0.25,
    diveTakeoffRate: 3.0,
    diveLandRate: 0.75,

    // THE DIVE LATCH'S FLOOR, in ticks.
    //
    // The latch clears on `tracker.weight > 0.5` — "he is back on his feet, the
    // dive is over". queueKnockdown only QUEUES the collapse; the tracker
    // consumes it later in the same step, so on the launch tick itself weight
    // is still whatever it was while running, ~1.0, and the clear fired on the
    // tick the latch was set. Measured: diveMix never left 0 and the dive clip
    // never played once in a five-second trace. This floor holds the latch
    // until the knockdown has actually landed. Weight reaches 0.01 within one
    // tracker update, so anything above a couple of ticks is enough; 6 is
    // 0.1 s of margin and still far below the shortest real dive.
    diveLatchMinTicks: 6,

    // THE SLIDE.
    // Below this there is no slide to start. Raised from 3.0 so that a slide is
    // something you do out of a RUN: runSpeed is 4.5 and walkSpeed 2.0, so 4.0
    // sits above every walking speed and below the run ring's own nominal —
    // you have to be genuinely moving, and a brisk walk will not do it.
    minSlideSpeed: 4.0,
    // Committed briefly. For this many ticks after the start the slide runs
    // whether or not the button is still held, so a tap is a real slide rather
    // than a flicker.
    minSlideTicks: 15,

    // maxSlideTicks IS GONE. It capped the slide at 45 ticks and then called
    // queueKnockdown, so every slide ended face-down 0.75 s in no matter how
    // fast the athlete was travelling — measured cutting in at 5.4 m/s with
    // the stick still held, and then immediately starting a second slide that
    // was knocked down too. A slide now ends on exactly two conditions: the
    // button released past the commitment window, or stopSpeed reached. There
    // is no timer, and no path from sliding to the floor.

    // THE FREEZE. The Mixamo take is a whole slide-AND-STAND-UP sequence, so
    // scrubbing it 0..1 stood the athlete up while the button was still down.
    // Measured hips height and torso tilt across the clip: entry crouch to
    // 0.15, the slide proper 0.20-0.45 (hips 0.234-0.336, tilt 34-76 deg),
    // recovery from 0.55 (tilt back to 19 deg, hips 0.987). So the phase
    // ratchets up to slideHoldPhase and STOPS there for as long as the slide
    // runs; when it ends the ratchet continues to 1 and the clip's own
    // recovery plays out under the crossfade.
    //
    // Rates are phase per second, exactly like jump.takeoffRate. Entry is fast
    // because the athlete is already at speed and the pose should be there;
    // exit is near the clip's authored pace (0.70 of phase over ~1.08 s).
    // THE PENALTY SPEED, shared by the slide and the grounded dive.
    //
    // Both are "the athlete has committed to the floor and is coasting". Ride
    // one down to walking pace and it stops being a slide and becomes a fall:
    // below this the commitment is spent and the athlete goes down. It sits
    // well above stopSpeed (0.2) on purpose — a slide the player LET GO of
    // coasts cleanly to a stop and costs nothing, and only a slide still being
    // held all the way to the bottom is punished. One number for both because
    // it is one idea, and because two sliders would drift apart.
    knockdownSpeed: 1.0,

    // THE GROUNDED DIVE'S OWN BRAKING, and why it is not slideResistance.
    //
    // A slide is a move you ride out; a belly landing is a stop. The two want
    // opposite ends of the same knob, so they get separate ones.
    //
    // It was briefly LOWER than the slide's (2.0), for a reason that no longer
    // applies: the knockdown gate used to read the sphere, the sphere brakes
    // harder than a prone body does, and matching their decelerations was the
    // only way to stop the collapse firing while the athlete was still moving.
    // The gate reads the pelvis now, so the sphere is free to be the thing that
    // kills the momentum — which is what it should have been all along, since
    // the sphere IS the athlete's mass and the tracker drags the body to it.
    //
    // THERE IS A CEILING ON THIS, and it is not a tuning preference — it is the
    // tracker's clamped linear impulse. The sphere is the only thing this knob
    // brakes; the prone athlete is brought along by the tracker, and past what
    // that clamp can transmit the sphere simply stops out from under him and
    // then hauls him BACKWARDS. Measured skid length from touchdown to the
    // collapse, and how far the athlete is pulled back while still rigid:
    //
    //     2.0 -> 7.0 m skid, no pull       6.5 -> 3.7 m, no pull
    //     8.0 -> 2.8 m skid, 0.7 m pull   14.0 -> 3.8 m, 1.5 m pull
    //
    // So 8 and above buy nothing and cost a visible yank. 6.5 is the shortest
    // skid the athlete can actually be carried through — a bit under half the
    // old one — and it is where this stops being worth raising. If the belly
    // slide still wants shortening, the lever is ragdoll.friction, which brakes
    // the ATHLETE against the floor instead of braking the sphere and hoping he
    // follows.
    diveResistance: 6.5,

    // THE LEGS GO DEAD THE MOMENT THE DIVE POSE COMES UP, and only the legs.
    // Multiplies the six leg bodies' stiffness AND damping, faded by diveMix so
    // it arrives over the same frames the pose does. At 0 they are pure ragdoll
    // and gravity drops them, which is the heavy trailing lower body a real
    // dive has; the torso and arms stay at full weight holding the superman.
    // NOT zero. At 0 the legs are perfectly boneless and carry their forward
    // momentum straight over the athlete's back — measured, a foot ended up
    // 0.86 m ABOVE his head. A tenth of the stiffness is not enough to hold a
    // pose but it is enough for the PD to fight the swing, and it is the only
    // lever available: Rapier has no cone limit in this build, so the hip
    // cannot simply be told to stop at 20 degrees. See the note at
    // ragdoll.limits.
    // HOW FAR THE DIVE POSE'S HIPS SIT BELOW STANDING HEIGHT, in metres. See
    // the long note at the L5 strip in animtarget.js for why this is a drop and
    // not the vertical strip it looks like it should be.
    diveHipDrop: 0.65,

    // THE STUN. Ticks after a dive lands during which the tracker's recovery
    // ramp is held off entirely, so the weight sits on crashMuscleTone and the
    // stand-up cannot begin — its scrub ceiling is the weight, so the take is
    // pinned at its first frame for the whole duration. A dive is the biggest
    // commitment in the moveset and this is what it costs: one second flat on
    // the floor before the athlete can even start getting up.
    diveStunTicks: 60,

    diveLegStiffness: 0.1,

    // AND A PARACHUTE. Solver-side damping on the six leg bodies while the dive
    // pose is up, applied per step in tracker.js and faded by diveMix, so they
    // bleed forward momentum on the way down instead of arriving with all of it
    // and whipping. Same listed exception to LAW L3 as the arm chain, and the
    // same reason: this is momentum the clamped helpers cannot see, because it
    // is carried through the joints during the solve.


    slideHoldPhase: 0.3,
    slideEntryRate: 3.0,
    slideExitRate: 0.65,
    // MULTIPLIES the existing resistance path — it does not replace it. The
    // sphere coasts and bleeds speed through the same clamped helper every
    // other braking impulse goes through (LAW L3).
    // LOWERED from 4.0. The slide was bleeding speed fast enough that it hit
    // the stop threshold — and therefore the knockdown — while the player still
    // had the button down and expected to be travelling. At 1.6 the sphere
    // still slows noticeably (it is 1.6x the ordinary rolling resistance) but
    // carries its momentum for about two and a half times as long.
    // LOWERED again to 1.15. At 1.6 the slide was still braking noticeably
    // harder than a free roll, so the player hit the stop threshold while they
    // could still see themselves moving. At 1.15 the slide is barely more
    // resistant than coasting — the speed it loses is mostly the ordinary
    // rolling resistance, which is what "coasting" should mean.
    //
    // RAISED BACK TO 4.5, because the reason it was lowered is gone. Every one
    // of those reductions was avoiding a PENALTY at the end of the slide —
    // reaching stopSpeed used to queue a knockdown — and reaching stopSpeed now
    // just ends the slide, on his feet, with weight untouched. Meanwhile the
    // brake at motor.js step 3 only fires with the stick neutral, so a slide
    // with the stick still held is braked by rollingResistance alone: measured
    // 0.51 m/s^2 at 1.15, which is a twelve-second slide and slower to stop
    // than a free coast. 4.5 gives about 2 m/s^2 — roughly three seconds and
    // eight metres from a full sprint, ended early any time past minSlideTicks
    // by letting go.
    slideResistance: 4.5,

    // THE SLIDE'S DRAG IS SLOPE-AWARE, because a single constant cannot be both
    // things at once. The drag is a roughly CONSTANT deceleration (the damping
    // request binds well below its clamp at these speeds), so on a slope the
    // question is only whether gravity's along-slope term beats it. Measured on
    // the bowl wall: coasting down the steep section accelerates at +1.6 to
    // +1.9 m/s^2, and the flat slide at slideResistance 4.5 decelerates at
    // 1.3 m/s^2. Those are close enough that downhill barely gains — and every
    // way of fixing it by lowering the constant lengthens the flat slide by the
    // same proportion. Sweeping the constant 0.5 -> 20 on the flat spans "still
    // accelerating at 5.5 m/s" to "stopped", so the constant is doing real work
    // there and must not simply be reduced.
    //
    // Scaling it by the sphere's VERTICAL velocity separates the two cases with
    // no new state and no branch: descending (vy negative) thins the drag,
    // climbing thickens it, and flat ground is exactly the value above. The
    // clamps stop a fast fall from removing the drag altogether or a hard climb
    // from becoming a wall.
    slideSlopeRef: 1.2,
    slideSlopeMin: 0.35,
    slideSlopeMax: 1.8,
    // How slow is "slid to a stop". Lowered from the old 0.8 hard-coded
    // constant in main.js and moved here where it belongs: it is a feel number
    // and it was the other half of the early-knockdown complaint.
    stopSpeed: 0.2,
    // MUSCLE TONE. Damping authority the character KEEPS while knocked down.
    //
    // It is not a floor on the tracking weight — that was tried and measured
    // and it stops the character going down at all, because weight scales the
    // springs and the damping together. This floors the damping ALONE: the
    // springs go fully off so the body genuinely falls, while the limbs keep a
    // quarter of their resistance and land as a body instead of exploding.
    // See queueKnockdown in tracker.js for the measurements.
    crashMuscleTone: 0.2,
    // The clip the crash reaches for. Absent from the asset today, so it falls
    // back to the held airborne pose through the same path slide and dive use.
    crashClip: 'Crash',

    // THE DIVE. Absolute impulses in N·s, the same convention as jump.impulse —
    // NOT scaled by mass. Forward is along the input direction, or along the
    // facing when there is no input. On a 1.047 kg sphere the numbers ARE the
    // metres per second they buy, near enough.
    //
    // HALVED FROM 9.0 / 4.5. At those values the launch added 8.6 m/s forward
    // on top of a 6 m/s run and threw the sphere 0.75 m up: a fifteen-metre-
    // per-second flight that read as a superhero leap and undid the heavy,
    // grounded feel everything else is tuned for. At 4.5 / 2.4 it adds 4.3 m/s
    // to a run and rises about 0.24 m — a lunge that leaves the ground because
    // the athlete threw himself at something, not because he can fly.
    diveImpulseForward: 4.5,
    diveImpulseUp: 2.4,
    // Ticks between dives. Raised from 90 to 150 (2.5 s): a dive ends in a
    // crash and a stand-up, and being able to queue the next one before the
    // last has finished is not a mechanic, it is a bug.
    diveCooldownTicks: 150,

    // 1/s. How fast an action's pose takes its share of the blend.
    poseEase: 10.0,
  },

  // ═══ THE STRIKES ═══ (G4)
  //
  // One table, two rows, one mechanism. A strike is a pose ratchet, a tick
  // window, and an impulse on the BALL — never on the athlete (LAW 1).
  //
  // THE WINDOWS ARE MEASURED, NOT GUESSED. Both clips were forward-kinematicked
  // out of the GLB and the striking hand tracked through them; the numbers below
  // are where that hand actually meets a ball, at 1x playback. The measurement
  // and its method are in the G4 report. Re-measure if the clips are ever
  // re-exported — `sweetTick` is a fact about the animation, not a feel knob.
  //
  // `climbRate` IS the feel knob. It is authored at 1x, which is the animator's
  // own timing, and it is live: raise it and the strike is snappier, at the cost
  // of the telegraph a defender reads. Raising it does NOT move `sweetTick`,
  // which is a separate slider, so a snappier strike lands earlier and the two
  // must be moved together to stay honest.
  strike: {
    pressCooldownTicks: 20,   // a new press inside this many ticks is ignored
    qualityPerfectTicks: 4,   // |error| <= this -> quality 1.0
    qualityZeroTicks: 12,     // |error| >= this -> quality floor
    qualityFloor: 0.35,       // a mistimed contact still leaves at 35% speed
    aimStickWeight: 0.6,      // 0 = aim is pure facing, 1 = pure stick heading
    mixEase: 10.0,            // action-tier share ease, same rate as poseEase

    // ═══ THE EAST BUTTON IS CONTEXTUAL ═══ (G4.1 §5)
    //
    // One button, two rows. The ball's CENTRE height relative to the pelvis at
    // the moment of the press decides whether East swings a volley or plants a
    // kick — the answer to the G4 finding that both strikes are overhead
    // actions and a ball at rest on the floor is unreachable by either.
    //
    // This is a recorded value from a continuous query at an edge, the same
    // class of thing as `lastStrikeSide` (LAW 4 / GF-2.0). There is no kick
    // mode and no second latch: the kind selects a ROW.
    kickBelowHips: -0.10,     // m — ball centre below the pelvis by more than
                              // this and East is a kick. DESIGNER RULING Sep 6:
                              // a resting ball of ANY size is a kick. Measured
                              // resting centres relative to a 0.967 m pelvis:
                              // small -0.77, medium -0.47, large -0.22 — all
                              // decisive at -0.10, all outside the band below.
    kickHysteresis: 0.05,     // m — a press within this of the threshold
                              // repeats the LAST kind chosen, so a bobbing ball
                              // cannot flip kinds between two presses.
    contextRadius: 4.0,       // m — no ball nearer than this and East is a
                              // volley: the athlete swings at air, which is a
                              // whiff, which is data.

    // ═══ SIDE SELECTION, SHARED BY EVERY SIDED ROW ═══ (G4.1 §5b)
    //
    // Predictive, not a snapshot. G4 sampled the ball's local x at the press,
    // and a ball crossing the chest is on the other side by `sweetTick` — 14 to
    // 42 ticks later, depending on the row. It is still ONE recorded value
    // decided ONCE at the press; only the query got better.
    sideDeadzone: 0.20,       // m — |projected localX| under this is "centred",
                              // and the stick decides, then the last side.
    sideProjectClamp: 6.0,    // m — BOTH projected displacements are clamped by
                              // this, ball and athlete alike. A spike-speed ball
                              // must not project across the court, and a
                              // sprinting athlete must not be assumed to cover
                              // 2.8 m. `sideAgreement` is the number that says
                              // whether this ever wants to be per-body.
    volley: {
      clip: 'Idle Two Hand Volley',   // reload
      // MEASURED: frames outside [0.055, 0.995] are the bind T-pose, so 0.10
      // and 0.95 clear it at both ends. The G1 audit named the head; the tail
      // is the same and had not been recorded.
      clipStart: 0.10, clipEnd: 0.95,     // reload
      // RETUNED to the forward-push contact frame at clip fraction 0.65 —
      // chest/head height, hand still driving upward at ~4.3 m/s.
      //
      // It was 0.900 / [20, 28, 38], the argmax of hand HEIGHT (f 0.865, 0.784 m
      // above the hips). That is the top of the arc, where the hand has stopped:
      // measured rise is 0.13 m per 5% of clip through f 0.45-0.60 and 0.01 m per
      // 5% at f 0.80-0.85. Contact there is a stationary hand meeting a falling
      // ball — a small force, a fully overhead target, and 0.433 m of reach
      // against 0.548 m earlier. In play it was hard to land and did not score.
      holdPoint: 0.65,
      windowOpen: 12, sweetTick: 20, windowClose: 30,
      climbRate: 1.93,        // phase/s; 0.900 in 28 ticks = 1x
      completeRate: 1.93,     // the follow-through, also 1x
      launchSpeed: 14.0,      // m/s on a perfect contact, mass-normalised
      elevationDeg: 55,       // above horizontal
      bodies: ['handL', 'handR', 'foreArmL', 'foreArmR'],
    },
    spike: {
      clipLeft: 'Standing Spike Left', clipRight: 'Standing Spike Right',  // reload
      clipStart: 0.05, clipEnd: 0.90,     // reload
      // MEASURED: the hand peaks 0.814 m above the hips at fraction 0.485, then
      // swings down and OUT — furthest reach 0.857 m at 0.595, fastest 10.47 m/s
      // at 0.615. Contact is the reach peak, phase 0.641, 42 ticks at 1x.
      holdPoint: 0.641,
      windowOpen: 30, sweetTick: 42, windowClose: 54,
      climbRate: 0.92,        // phase/s; 0.641 in 42 ticks = 1x
      completeRate: 0.92,
      launchSpeed: 22.0,
      elevationDeg: -18,      // below horizontal — down into the valley
      bodies: ['handL', 'handR', 'foreArmL', 'foreArmR'],
    },
    kick: {
      clipLeft: 'Idle Low Kick Left', clipRight: 'Idle Low Kick Right',  // reload
      // MEASURED (G4.1 §4). 0.5833 s = 35 ticks. NO bind-pose frames at either
      // end — both ends sit in the same idle stance and the clip loops cleanly
      // out of and back into it, so unlike the volley there is nothing to trim.
      // Assume nothing: the volley has one at the head only, not both.
      clipStart: 0.00, clipEnd: 1.00,     // reload
      // MEASURED: tick 14 of 35 — foot 0.255 m above the floor, 0.583 m forward
      // of the pelvis, moving 5.21 m/s of which 4.21 m/s is forward.
      //
      // WHY 14 SERVES ALL THREE BALLS. The contact frame depends on ball size,
      // because it is where the foot meets a ball at that centre height: tick
      // 12 for the small, 16 for the medium and the large. sweetTick 14 puts
      // every one of them at |error| 2, inside qualityPerfectTicks, so all
      // three land at full quality off one number. That is a property of the
      // asset, measured — not a compromise between them.
      //
      // The contact rule is where the limb is MOVING, not where it has stopped:
      // the literal furthest reach is tick 20, where the foot has reversed at
      // -0.41 m/s, and authoring there would have reproduced the G4 volley bug
      // exactly. See scripts/measure_clips.mjs, which is the tool of record.
      holdPoint: 0.400,
      windowOpen: 8, sweetTick: 14, windowClose: 17,
      climbRate: 1.71,        // phase/s; 0.400 in 14 ticks = 1x
      completeRate: 1.71,
      launchSpeed: 10.0,      // m/s — a kick lofts a ball back up to hand height
                              // for the next touch. It does not spike it.
      elevationDeg: 50,       // above horizontal
      // THE LEGS. `calf` and `foot` are the rig keys that exist; there is no
      // shin in BONE_MAP, and naming one would silently never match.
      bodies: ['footL', 'footR', 'calfL', 'calfR'],
    },
  },

  // World-space PD tracking. Every one of these is live.
  tracking: {
    // LAW L4 — the single blend weight starts here. 1 = full tracking,
    // 0 = pure ragdoll. Display-only in the GUI: it is simulation state, and a
    // slider on it would be a second writer competing with recovery.
    startWeight: 1.0,
    // Seeded 60, then 8000. The impulse USED to be kp * error * dt with no mass
    // term, so the steady state where the spring balanced gravity sat at
    // error = m*g/kp: at 60 that was a 3.8 m sag for the 11.5 kg pelvis, and
    // 8000 put it at 8 mm.
    //
    // RE-SEEDED TO 700 because the impulse is now kp * error * dt * MASS — see
    // the note at the site in tracker.js. The gain is an acceleration now, so
    // the sag is g/kp for every body alike, and 700 * 11.451 = 8016 leaves the
    // pelvis exactly where 8000 had it. Every OTHER body got quieter, which was
    // the point.
    linearKp: 700,
    // Seeded 8. The L3 clamp caps this at a full cancellation of relative
    // velocity, so large values are safe rather than explosive, and the extra
    // authority is what keeps the mount from breathing.
    linearKd: 400,
    // Seeded 30. Above about 60 the impulse cap below is what limits this, so
    // its exact value stops mattering; 200 sits clear of the seed's dead zone.
    angularKp: 200,
    // Seeded 3. Same clamp argument as linearKd.
    angularKd: 40,
    pelvisBoost: 3.0,

    // PER-GROUP STIFFNESS, keyed by autorig's BONE_MAP group. Multiplies both
    // kpScale and kdScale, so a group that is softer is also less damped —
    // which is what "ragdolls realistically" means; a limb that is loose but
    // heavily damped moves like it is underwater.
    //
    // The point is the CRASH. At weight 0.2 a uniform scale makes the athlete
    // limp all over and the torso folds; keeping the core near full while the
    // extremities drop lets him land holding his shape and let his arms and
    // legs take the impact. See the measured table where these values were
    // chosen.
    groupStiffness: {
      torso: 1.0,
      head: 0.8,
      limb: 0.3,
      extremity: 0.1,
    },
    // How limp the character goes as the weight falls. kp is scaled by
    // weight^limpness, so a larger exponent collapses the low end harder while
    // leaving full tracking at weight 1 untouched. At 2 the pelvis servo is
    // still strong enough at weight 0.3 to hold the body in a crouch; see the
    // knockdown-depth table in the Task 6.1 report.
    limpness: 5,
    // LOWERED 0.6 -> 0.25 as the other half of the jitter fix. In units of the
    // body's own mass, so a heavy torso and a light hand are limited
    // proportionally. Mean extremity speed with the athlete standing still,
    // which should read ~0 and is entirely PD overshoot when it does not:
    //
    //     flat kp, cap 0.6  -> 0.164 m/s     flat kp, cap 0.25 -> 0.134
    //     mass kp, cap 0.6  -> 0.143         mass kp, cap 0.25 -> 0.081
    //
    // The two compound: mass-scaling brings the light bodies' impulses into a
    // range where a tighter cap no longer binds on the heavy ones. Tracking
    // error is unmoved by either — 0.0081 m to 0.0090 m at rest, 0.0782 m to
    // 0.0784 m walking — and the walking limbs still follow the ghost at a
    // ratio of 0.99 to 1.02. Do not take the cap below about 0.2: at 0.10 the
    // jitter only reaches 0.112 and the tracking error is nineteen times worse.
    maxLinearImpulse: 0.25,
    // Seeded 0.35 — the single most damaging seed in the set. This cap is NOT
    // scaled by inertia, and these bodies span 2.25e-3 (a hand) to 7.9e-2 (the
    // pelvis) kg·m². At 0.35 one step could spin the pelvis at 4.4 rad/s and a
    // hand at 155, so the angular term was pure noise: measured, raising
    // angularKp made the ORIENTATION error worse, 9.5° with the term switched
    // off against 30° with it on. At 0.01 it does what it is for — 2.4°.
    // RAISED 0.01 -> 0.06 (ruling, delegated). At 0.01 the ghost held a torso
    // tilt of at most 19 degrees while the body reached 90 at speed: the cap
    // was starving the correction that keeps the athlete upright, and the
    // clamp — not the gain — was the binding constraint. 0.06 sweeps the
    // measured maximum to 24 degrees. It is still a clamp, so LAW L3 holds:
    // the impulse can only ever reduce the error, never add energy.
    maxAngularImpulse: 0.01,
    // Raising limpness is what buys this back. A flat collapse via slow
    // recovery alone needs 0.12 here, an 8.3 s penalty; at limpness 5 the same
    // depth recovers in 3.3 s, which is a sporting knockdown rather than a
    // spectator ejection.
    recoverPerSecond: 0.3,
    // Horizontal pelvis-to-sphere distance past which the character is judged
    // to have come off its mount. Warned once per excursion, not per step.
    maxMountDistance: 0.5,
  },

  // All construction-time in the same sense the arena is: the ragdoll is
  // derived once per R-spawn from these, and nothing is rebuilt mid-flight.
  // Changing any of them takes effect on the NEXT spawn, and the GUI says so.
  ragdoll: {
    spawnHeight: 6,
    tumbleImpulse: 0.5,
    // The tick the deterministic capture spawns the ragdoll on, so an anchored
    // run contains a character in a repeatable pose rather than an empty bowl.
    captureSpawnTick: 30,
    // g/cm3 (water = 1.0). autorig converts to Rapier's kg/m3.
    density: { torso: 1.2, limb: 1.0, head: 0.9, extremity: 0.8 },
    // Fractions of the MEASURED character height, never of segment length.
    radiusRatio: { torso: 0.075, limb: 0.032, head: 0.062, extremity: 0.024 },
    lengthFit: 0.9,
    // JOINT RANGES, radians, about each hinge's authored axis.
    //
    // HINGE RANGES, radians, about each joint's authored axis. The ankle is NOT
    // here: it is a universal joint now, with no free axis for a range to apply
    // to — see the long note at the joint builder in autorig.js.
    //
    // AND THERE IS NO COURSE OF ACTION FOR THE HIPS OR THE SPINE. Both are
    // spherical and both are unlimited — the hip reaches 178 degrees from bind
    // on a dive landing — and Rapier 0.19.3 offers no way to constrain either.
    // Tested directly: setLimits exists ONLY when a joint's mask leaves exactly
    // one free angular axis and that axis is the one supplied (Rapier hands
    // back a revolute wrapper); with two free swings, three, or none, the
    // method is not on the object at all. So there is no cone limit in this
    // build, and the only limitable hip is a hinge — which was measured and
    // rejected: leg tracking error went from 0.010 m to 0.154 m, fifteen times
    // worse, because one axis cannot reach a hip pose authored in three. The
    // athlete could not stand in his own idle.
    //
    // The scorpion turned out not to need them. See action.diveClipEnd.
    //
    // The knees were measured innocent. Through a running jump landing a
    // revolute knee held to 0.6 degrees off-hinge while the spherical ankle
    // reached 145 degrees, all of it off any sensible axis: "knees bending
    // backward" was the feet all along. Left at [0, 2.4] because nothing in the
    // measurement asks for anything else — the knee never reached the limit,
    // it just swung through its legitimate range.
    limits: { knee: [0, 2.4], elbow: [0, 2.6] },

    // SURFACE. Neither of these was ever set, so the sixteen ragdoll colliders
    // have been running on Rapier's defaults (friction 0.5, restitution 0)
    // since Task 3 — worth knowing, because it means the reported "bounce" is
    // NOT restitution: it was already zero. Setting it explicitly anyway so the
    // value is a decision on record rather than a library default that could
    // change under us.
    restitution: 0.0,

    // PER-GROUP OVERRIDE. Only the torso, and only so a dive landing rebounds
    // instead of stopping dead — the rebound is what throws the limp legs down
    // rather than leaving them folded. Everything else keeps 0: bouncy hands
    // and feet read as rubber, and a bouncy head is worse.
    restitutionByGroup: { torso: 0.3 },
    // Raised above the 0.5 default, then brought back down. 1.6 stopped a
    // 6 m/s dive dead in about 1.2 s with no visible skid at all — the
    // complaint. This is a body sliding on its side across a floor, so it
    // should not be frictionless either. Construction-time: applies on the
    // next R-spawn.
    friction: 0.9,

    // SOLVER-SIDE DAMPING ON THE ARM CHAIN ONLY. Construction-time: applies on
    // the next R-spawn. See the long note at the site in autorig.js for why
    // this is a listed exception to LAW L3 and why the clamped helper cannot
    // reach the thing.
    //
    // THE TRADE IS CLOSE TO LINEAR AND THERE IS NO FREE SETTING. Mean hand
    // speed with the athlete standing still, against how much of the walking
    // arm swing survives (1.00 = the body follows the ghost exactly):
    //
    //     lin/ang    idle hands      walking arm swing
    //     none       0.098 / 0.123   1.01 / 1.02
    //     2 / 4      0.097 / 0.120   0.97 / 0.98
    //     8 / 15     0.089 / 0.108   0.89 / 0.89
    //     14 / 25    0.081 / 0.099   0.81 / 0.82
    //     25 / 40    0.070 / 0.088   0.70 / 0.71
    //
    // Every tenth of the buzz costs about a tenth of the arm swing. 8/15 is the
    // most that can be spent before the run starts to look armless. Raise them
    // together if the shimmer still reads on a real display; the number to
    // watch is the walking ratio, not the idle one.
    //
    // NOT the cause, both tested and reverted: CCD on these bodies (off makes
    // no difference, 0.101/0.120), and the tracker's own gains, which the
    // clamp already saturates.
    // SOLVER-SIDE DAMPING ON THE ARM CHAIN, applied per step in tracker.js and
    // GATED — full value with the athlete standing still, faded to nothing by
    // armDampingFadeSpeed and by standUpNeed. The buzz is an IDLE complaint and
    // the cost is a WALKING one, so paying it only at rest gets both.
    //
    // These read absurdly high because the gate makes them nearly free; a
    // CONSTANT 25 already cost 30% of the arm swing. See the long note and the
    // measured table at the site in tracker.js — including the six PD levers
    // that were tested against this and moved it by nothing at all.
    armLinearDamping: 150.0,
    armAngularDamping: 150.0,
    /** m/s of sphere speed at which the arm damping has faded to nothing. */
    armDampingFadeSpeed: 1.5,

    // THE DIVE'S LEG PARACHUTE, same mechanism as the arm chain above and the
    // same listed exception to LAW L3. Applied per step in tracker.js, faded by
    // diveMix, zero at every other moment. See the measured table at the site.
    diveLegLinearDamping: 4.0,
    diveLegAngularDamping: 8.0,

    // THE LIMP BRAKE. While the character is fully limp the ragdoll carries its
    // momentum on pure physics and slides like ice — the tracker's own damping
    // is scaled by weight and is therefore switched off exactly when the body
    // needs it most. This is an EXTRA braking impulse applied to every ragdoll
    // body below limpBrakeBelow, ramped in so nothing steps.
    //
    // It goes through the same L3 clamped helper as every other braking impulse
    // in the project, so it can only ever cancel motion and never reverse it.
    // THE SECOND BRAKE, and BY FAR the bigger of the two on a dive landing.
    // Weight sits at ~0.01 from launch until well after touchdown, so this is
    // at full ramp for exactly the window the skid is supposed to happen in;
    // lowering friction alone was never going to give the skid back. Measured
    // pelvis travel from touchdown to rest, friction 0.9 throughout:
    //     limpBrake 25 -> stopped dead      12 -> 1.1 m      6 -> 2.1 m      0 -> 2.7 m
    // 6 is a real skid that still ends.
    //
    // KNOWN, and left alone deliberately: this brake is gated on weight, not on
    // contact, so it also damps the athlete in MID-AIR — part of what 25 was
    // doing was eating the dive's own leap (peak flight speed 6.4 m/s at 25
    // against 9.1 at 0). Gating it on ground contact would need a per-body
    // ground query the project does not have, and the value below is enough
    // without one. Raise it if a limp body ever slides too far; do not raise it
    // to shorten a dive.
    limpBrakeBelow: 0.1,
    limpBrake: 6.0,
  },

  visual: {
    // turnSpeedThreshold retired here with the velocity-heading facing path in
    // GF-2: facing is camera-locked now and the camera's yaw is always
    // meaningful, so there is no vanishing velocity vector left to guard
    // against. Removed rather than left as a live-looking slider that does
    // nothing.
    boxWidth: 0.8,
    boxHeight: 1.8,
    boxDepth: 0.8,
  },

  // THE SPRING ARM. One owner for the camera: main.js holds azimuth, pitch and
  // a current distance, and derives the transform from them every frame. There
  // is no OrbitControls any more, and therefore no second thing that also
  // believes it owns the camera — which is what the x/y/z/follow trio here used
  // to be: a static pose that a follow function then quietly overwrote.
  camera: {
    fov: 52,
    // Where the arm sits in the clear. currentDistance always converges here.
    radius: 8.0,
    // The arm points at the sphere plus this, so the frame is centred on the
    // athlete's chest rather than on the ball between his feet.
    targetHeight: 1.2,
    // Radians per second per unit of stick deflection.
    orbitSpeed: 2.5,
    // Mouse drag: screen pixels per radian. Larger is slower.
    mousePixelsPerRadian: 400,
    // Elevation clamps, in radians above the horizon. The lower bound keeps the
    // camera off the ground plane; the upper stops it reaching straight down,
    // where azimuth stops meaning anything and the view gimbals.
    minPitch: 0.1,
    maxPitch: 1.35,
    // How far in front of an obstruction the camera stops.
    collisionMargin: 0.3,
    // The arm will not shorten past this even against a hard corner.
    minDistance: 1.5,
    // 1/s. Obstruction SHORTENS instantly; restoring eases at this rate.
    restoreEase: 4.0,
  },
};

/** The live object. Import this; read through it every time you need a value. */
export const TUNING = structuredClone(DEFAULTS);

/**
 * Restores every value to its shipped default.
 *
 * Mutates TUNING in place rather than reassigning it, so every module that
 * imported the binding keeps pointing at the same live object.
 */
export function resetTuning() {
  for (const group of Object.keys(DEFAULTS)) {
    Object.assign(TUNING[group], DEFAULTS[group]);
  }
}

/** Serialised TUNING, for the GUI's "Copy TUNING JSON" button. */
export function tuningJson() {
  return JSON.stringify(TUNING, null, 2);
}
