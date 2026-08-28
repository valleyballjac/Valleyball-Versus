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
    showSphereWireframe: true,
    showRagdollColliders: true,
    showCharacterMesh: true,
  },

  physics: { gravityY: -20 },

  // All construction-time: the bowl geometry and its trimesh collider are built
  // once at boot from these, and the collider is not rebuilt on the fly.
  arena: {
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
  },

  motor: {
    // Construction-time: radius and density size the ball collider.
    radius: 0.5,
    density: 2.0,
    spawnY: 3,
    // Live.
    friction: 1.0,
    restitution: 0.0,
    driveTorque: 6.0,
    maxAngularSpeed: 25,
    // Seeded at 8.0 by the spec; measured down to 1.0 to satisfy acceptance
    // criterion 2. A braking impulse of T decelerates this rolling ball at
    // T * radius / (I + m * radius^2) = 1.364 * T m/s^2. At T = 8 that is
    // 10.9 m/s^2, which exceeds gravity's pull along the bowl wall everywhere
    // below r ~= 11 (10.6 m/s^2 at r = 10). The released ball therefore parks
    // on the slope and creeps down at 0.1 m/s instead of rolling back, crossing
    // the floor and oscillating up the far side. At 1.0 the brake is 1.36
    // m/s^2, gravity wins on every part of the wall, and the ball still comes
    // to a dead stop on the flat floor in under 2 s from 5 m/s.
    brakeTorque: 1.0,
    rollingResistance: 0.4,
    airControlMultiplier: 0.15,
    groundRayCount: 8,
    groundedEpsilon: 0.15,
    stickDeadzone: 0.15,
  },

  jump: { impulse: 7.0, fallGravityMultiplier: 2.5 },

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
  },

  // THE STAND-UP. Two continuous signals — how low the pelvis is, and which way
  // it is facing — with no latch and no state between them.
  standUp: {
    pelvisStandHeight: 0.95,
    ease: 6.0,
    minRate: 0.5,
    faceBlendBand: 0.2,
    mountSlack: 0.15,
    faceDownClip: 'Stand Up Face Down',
    faceUpClip: 'Stand Up Face Up',
  },

  anim: {
    // Global multiplier on the gait's rate and on the idle action's playback.
    timeScale: 1.0,

    // 'auto' runs the blend space. Any clip name pins that single clip at
    // weight 1 — the Task 4 behaviour, kept for debugging and for the L5 creep
    // test, where a run clip is pinned while the sphere sits still.
    override: 'auto',

    // THE 1D LOCOMOTION BLEND SPACE. Three clips play at once, always; the
    // sphere's horizontal speed decides how much of each is heard.
    blend: {
      idleClip: 'At Rest',
      jogClip: 'Running Forward',
      sprintClip: 'Running Sprint',
      // Speeds (m/s) at which each node owns weight 1.
      idleSpeed: 0.0,
      jogSpeed: 4.0,
      sprintSpeed: 8.5,
      // 1/s. Contact jitter on a rolling ball is several tenths of a m/s of
      // noise; without this the weights flicker and so does the pose.
      speedSmoothing: 6.0,
      // 1/s. The eased weights ARE the crossfade — see animtarget.js on why
      // three's fade API is not used.
      weightEase: 8.0,
    },

    // Stride sync: turn the legs over at roughly ground speed. With root motion
    // stripped the feet must skate somewhat; this bounds how much.
    stride: {
      enabled: true,
      jogNominal: 4.0,
      sprintNominal: 8.5,
      min: 0.6,
      max: 1.6,
    },
  },

  // World-space PD tracking. Every one of these is live.
  tracking: {
    // LAW L4 — the single blend weight starts here. 1 = full tracking,
    // 0 = pure ragdoll. Display-only in the GUI: it is simulation state, and a
    // slider on it would be a second writer competing with recovery.
    startWeight: 1.0,
    // Seeded 60. The impulse is kp * error * dt with no mass term, so the
    // steady state where the spring balances gravity sits at error = m*g/kp.
    // At 60 that is a 3.8 m sag for the 11.5 kg pelvis — the character simply
    // fell through its own target. 8000 puts the sag at 8 mm.
    linearKp: 8000,
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
    // How limp the character goes as the weight falls. kp is scaled by
    // weight^limpness, so a larger exponent collapses the low end harder while
    // leaving full tracking at weight 1 untouched. At 2 the pelvis servo is
    // still strong enough at weight 0.3 to hold the body in a crouch; see the
    // knockdown-depth table in the Task 6.1 report.
    limpness: 5,
    maxLinearImpulse: 0.6,
    // Seeded 0.35 — the single most damaging seed in the set. This cap is NOT
    // scaled by inertia, and these bodies span 2.25e-3 (a hand) to 7.9e-2 (the
    // pelvis) kg·m². At 0.35 one step could spin the pelvis at 4.4 rad/s and a
    // hand at 155, so the angular term was pure noise: measured, raising
    // angularKp made the ORIENTATION error worse, 9.5° with the term switched
    // off against 30° with it on. At 0.01 it does what it is for — 2.4°.
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
    limits: { knee: [0, 2.4], elbow: [0, 2.6] },
  },

  visual: {
    turnLerpSpeed: 10.0,
    // Below this horizontal speed the passenger keeps its last yaw rather than
    // snapping to the direction of a vanishing velocity vector.
    turnSpeedThreshold: 0.35,
    boxWidth: 0.8,
    boxHeight: 1.8,
    boxDepth: 0.8,
  },

  // Static three-quarter view. Applied at boot and whenever one of these
  // changes; OrbitControls still owns the camera between those moments.
  camera: {
    x: 0,
    y: 18,
    z: 22,
    fov: 52,
    // Render-side follow. A 96 m bowl does not fit in a static three-quarter
    // view. Read-only with respect to the simulation — see main.js.
    follow: true,
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
