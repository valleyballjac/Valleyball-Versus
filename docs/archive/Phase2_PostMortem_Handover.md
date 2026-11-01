# VALLEYBALL — PHASE 2 POST-MORTEM & HANDOVER
**From:** Fable (Principal Architect, Iteration 2, Phases 1–2)
**To:** Fable 5.1 (Principal Architect, Phase 3)
**Date:** September 2, 2026
**Status of the build:** Phases 1 and 2 complete. The Athlete Movement Baseline is proven, audited from code and captures, and running in `C:\Users\portt\Dev\Valleyball\Valleyball-Demo`.

This document is the genesis context for the next architect. It explains the bespoke Active Ragdoll architecture, the laws as they now actually stand (one was amended by evidence mid-phase — see §4.3), the hard-won physics lessons, the technical debt, and the Phase 3 roadmap. Everything here was verified against the final source, not reconstructed from memory.

---

## 1. WHAT THIS PROJECT IS

Valleyball is a physics-based local-multiplayer sports game (Three.js + Rapier via `@dimforge/rapier3d-compat`, Vite, vanilla JS). The character controller is the intended differentiator: a physically simulated athlete with real weight and momentum, built so players can eventually author their own sports on top of it.

**Iteration 1 failed** by making physics authoritative over pose through joint-space muscles — local joint motors chasing animation rotations. The result was an "animatronic robot": technically sound, dead on feel. **Iteration 2 inverted the relationship** and it worked. Everything below exists to protect that inversion.

### The working folder — the single most expensive lesson that wasn't physics
The live project is `C:\Users\portt\Dev\Valleyball\Valleyball-Demo`. A stale copy exists at `C:\Users\portt\Downloads\valleyball`; early in Phase 1 the architect audited the stale copy while the execution model wrote to the live one, and a full gate cycle was spent discovering that completion reports and disk contents are different things. **Audit the folder, not the report.** (See §7, Workflow.)

### Assets
- **Character:** `public/models/YBOT15Animations.glb` — a 65-joint Mixamo rig (`mixamorig:` prefix, Hips root), two SkinnedMeshes sharing one skeleton, **0.01 armature scale** (centimetres), T-pose bind, ~1.75 m tall, 15 embedded clips: At Rest, Walk Forward, Running Forward, Running Sprint, Walk Strafe L/R, Strafe Run L/R, Standing Jump, Jump Running, Jump Backwards, Stand Up Face Up, Stand Up Face Down, Running Dive, Slide Left. It replaced `character.glb` (byte-identical rig, 13 clips), which is still on disk as the predecessor; nothing loads it.
- **Optional:** `public/models/actions.glb` — an additive clip source, validated per-clip against the skeleton before registration. Absent today; that is the normal configuration.
- **Phase 3 brings a 30-animation model.** The auto-rigger was built for exactly this swap: only the `BONE_MAP` table and the clip-name entries in TUNING should need editing (§2.4).

### Control schema (on record with the designer)
Jump = South (A/Cross) / Space. Underhand volley = East (B/Circle). Overhand spike = North (Y/Triangle). Dive = West (X/Square) / KeyQ. Sprint = Left Trigger (button 6) / Shift. Slide = Right Trigger (button 7) / KeyC. Right stick (axes 2/3) = camera orbit. Movement = left stick / WASD, camera-relative. Knockdown debug = T; respawn = R; manual capture = P.

---

## 2. THE ARCHITECTURE — THREE ACTORS AND ONE FLOAT

The character is three coupled systems, with strictly one-directional data flow:

```
input ──► SPHERE MOTOR (physics; owns ALL momentum)
              │  position, velocity, grounded
              ▼
         KINEMATIC GHOST (animation; owns ALL pose)
              │  world-space target transforms per body
              ▼
         ACTIVE RAGDOLL (16 rigid bodies; the visible athlete)
              ▲
         PD TRACKER (binds ragdoll to ghost; scaled by THE WEIGHT)
```

### 2.1 The Sphere Motor (`sim/motor.js`)
The root of the character is a dynamic Rapier sphere (radius 0.5, ball collider) driven **only by torque and force** — no kinematic writes during play, ever. Drive is a torque about `cross(worldUp, moveDir)`; a governor **starves** the motor (applies zero torque) above a max angular speed rather than clamping velocity. Sprint is a second, higher ceiling gated on `input.sprintHeld` (linear speed ≈ ω·r for a rolling ball, so the jog cap is `jogSpeed / radius`). Braking and rolling resistance go through the clamped-damping helper (§4.2). Jump is an upward impulse, grounded-gated, with a tick-based cooldown (`lastJumpTick`); extra fall gravity (`fallGravityMultiplier`) kills float. Grounded is a **distance-based ray fan** — one centre ray plus a ring at the sphere's radius, environment-filtered — never a single ray, never hit-existence.

`updateMotor(motor, input, jumpQueued, dt, driveScale, tick, resistanceScale)` — the two scale parameters are the *only* hooks gameplay has into the motor: `driveScale` (weight², so a downed athlete can't steer — Ruling 6.1: scales torque, never velocity) and `resistanceScale` (knockdown drag × slide/dive-skid resistance, multiplying the *requested* braking impulses before the clamp).

### 2.2 The Kinematic Ghost (`sim/animtarget.js`)
An invisible `SkeletonUtils.clone` of the character plays every animation via `THREE.AnimationMixer`, advanced **only** in `fixedUpdate` by the constant dt. The ghost's world placement comes from the sphere (the mount: sphere bottom, feet height, plus a yaw), never from the clips — Law 5. From the posed ghost, each fixed step computes a **world-space target transform per ragdoll body**:

```
targetBodyWorld = targetBoneWorld · inverse(bindBoneWorld) · bindBodyWorld
```

using bind matrices captured once at rig time (they legitimately contain the 0.01 armature scale; never "fix" them). Targets keep prev/curr; finite differences supply the target velocities the damping needs.

**The blend system** is layered continuous weights, never states:
- **Gait tent** (1D over smoothed horizontal speed): idle / walk / run / sprint.
- **Direction tent** (angular, F/R/B/L with wrap) over velocity rotated into the character's yaw frame. Convention: `local.x > 0` = character's right, `local.z > 0` = forward. Node weight = gait × direction. The sprint ring is forward-only; its non-forward share reassigns to the run ring. Backpedal is `Walk Forward` scrubbed in reverse — still a placeholder.
- **One `locomotionPhase`** drives every cycle clip at `timeScale 0` via direct `.time` writes in a single function (`writeClipTimes`). Phase-synced legs through every crossfade; stride sync scales cycle rate by ground speed. **`crossFadeTo`/`fadeIn`/`fadeOut` are banned** — they schedule against mixer wall-time and break determinism.
- **Override tiers**, precedence: stand-up > action (slide/dive) > airborne > locomotion+idle. Shares multiply out and always sum to 1 (asserted once per second, with a `weightAudit` export).
- **Mount yaw**: camera-locked in free roam (that is what makes strafing exist — velocity-locked facing makes the direction tent read pure-forward always, measured); **momentum-locked during slide/dive** via an angular lerp by `slideMix`/`diveMix`; heading held below a velocity floor. Reads the smoothed velocity, one step stale, deliberately.
- **Jump / slide / dive / stand-up** are hold-point ratchets (§4.4) — monotone phase floats with authored hold points, never booleans.

### 2.3 The PD Tracker (`sim/tracker.js`) — and THE WEIGHT
Every fixed step, before the world steps, each of the 16 bodies gets:
- a **linear impulse** `error · linearKp · mass · boost · kpScale · groupScale · dt`, capped at `maxLinearImpulse · mass` (mass-scaled gain = identical acceleration per body — the hand-jitter fix; mass-proportional caps);
- **linear damping** of `(bodyVel − targetVel)` through the clamped helper;
- an **angular impulse** from the shortest-arc axis-angle of `targetQuat · inverse(bodyQuat)` (negate when w < 0 — the intermittent-blow-up fix), capped;
- **angular damping** of relative angular velocity through the clamped helper.

Both PD terms sample **pre-impulse** state (reading post-impulse velocity turns kd into a veto of kp — measured: kd 8→400 made tracking error 60× *worse*).

**THE WEIGHT** (`tracker.weight`, 0..1) is the one balance authority. `kpScale = max(weight^limpness, standUpNeed·standUpProgress·standUp.authority)` — the second term is the get-up's own muscular effort, without which the stand-up take had nothing to act through (traced: kpScale ≈ 0 for the first two seconds of every recovery). `kdScale = max(weight, muscleTone)` — tone floors the *damper* only, so a dive lands loose, not boneless (a weight floor was measured and rejected: at 0.25 the character never goes down at all). Writers of the weight: the recovery ramp (+`recoverPerSecond`, gated off while tumbling/dive-stunned), impacts (−excess force × group multiplier), and `queueKnockdown(tracker, tone)` (min-merge; tone becomes both the landing weight and the tone floor). Readers: the gains, `driveScale`, the knockdown drag, the mount-follower gate, and the ghost's recovery clock. **The pelvis boost** is the inverted pendulum — a gain multiplier on the same path as every other body, not a mechanism.

### 2.4 The Auto-Rigger (`sim/autorig.js`)
15 bodies / 14 joints derived at runtime from the skeleton's **world-space bind pose**. The only authored data is the `BONE_MAP` table (key, bone, explicit end bone, parent, shape, group, joint type, authored hinge axis, limits) plus TUNING ratios. Capsule radii scale from **measured character height**, not segment length (a 0.10 m pelvis segment must not make a 2 cm waist). Segment orientation from an explicit basis, not `setFromUnitVectors` (antiparallel-degenerate for the straight-down legs — measured 79° of random roll between collinear thigh and calf, which silently destroys hinge zeros). Revolute axes are authored because a T-pose is collinear at elbows and knees. Self-collision off; motor detached from the ragdoll's collision set (`detachMotorFromRagdoll` — the legs straddle the ball by construction). Exports `ARM_CHAIN_DAMPED` and `LEG_BODIES` sets for the tracker's targeted damping. Loud contract enforcement: missing bones throw with the full bone listing. **For the Phase 3 model swap: edit the table, never the algorithm.**

### 2.5 The render path (`sim/ragdoll.js`)
The visible mesh is posed **from the bodies**: per mapped bone, parents-first against the *real scene parents* (unmapped clavicles; the 0.01-scale armature root), `desiredBoneWorld = interpolatedBodyWorld · inverse(bindBodyWorld) · bindBoneWorld`. Debug wireframe capsules double as the interpolation targets so mesh and capsules can never disagree. Mesh-inside-capsules through a full flop IS the proof the derivation is right.

### 2.6 The harness (Phase 1's dividend — do not erode it)
- **60 Hz fixed-step accumulator loop** (`core/Loop.js`): tick counter, `onTick`/`onFrame` seams, alpha-interpolated rendering via the `Interpolated` prev/curr contract, frame-time clamp (time dilation, no catch-up). The loop knows nothing about capture, ragdolls, or files.
- **Determinism regression test**: `?captureTick=N` spawns on a fixed tick and captures a pinned 1280×720 @ DPR 1, alpha-1 PNG, then halts. Protocol: run, rename to `auto_t300_runA.png`, run again, compare sha256 — byte-identical or the gate fails. The capture re-derives the spring arm at alpha 1 (a latent frame-pacing leak, found and closed).
- **TUNING** (`config/tuning.js`): the single source of truth for every tunable, read live, with lil-gui; construction-time values render locked. Invariant gates that must not become sliders live as code constants beside their rulings (e.g. `MOUNT_FOLLOW_STAND_NEED`).
- **The spring arm** (`main.js`): sole camera owner (OrbitControls removed). Azimuth/pitch/fixed radius, environment-only obstruction ray, shorten-instantly / restore-eased; in the clear it converges to radius — the stuck state is unrepresentable. Sim reads the camera only through `input.cameraYaw`, latched per frame in the input snapshot.
- **Collision groups** (in `sim/physics.js`): `0x0001` environment, `0x0002` ragdoll, `0x0004` motor. `ENVIRONMENT_RAY_GROUPS` filters every non-contact ray (camera, floor probe, ground fan) — `filterExcludeRigidBody` takes one body and the character is sixteen.
- **Contact-force events**: `EventQueue(autoDrain)`, per-collider thresholds, drained the same tick, mapped handle→rig key. Impacts are calibrated: threshold set *above the measured ceiling of clean play* (Deliverable-0 discipline: instrument first, then map).
- **`window.__vb.probe()`**: a read-only diagnostic snapshot (plain numbers, never body handles — a console handle on a body is a hole in every law). Track error, group error, joint deviation from bind with off-axis/signed hinge angles, scorpion metric, limb speeds vs ghost limb targets. Tune with this, not by anecdote.
- **Sanctioned spawn-event family** — the ONLY `setTranslation` sites in play code (census: exactly three): initial spawn, the out-of-bounds watchdog, and the mount follower. Nothing else may ever teleport a body.

---

## 3. THE `fixedUpdate` ORDERING CONTRACT

Several systems only work in this order (documented at the function; preserve it or re-derive it consciously):

1. respawn (spawn event) → 2. watchdog (spawn event) → 3. pelvis floor ray (cast once, used by mount follower AND stand-up height) → 4. mount follower (spawn event; BEFORE the ghost so mountSlack sees the moved sphere same-step) → 5. knockdown consume → 6. jump/dive consume → 7. slide/dive mechanics → 8. `saveRagdollPrevious` (curr→prev before anything moves) → 9. `updateMotor` (with drive/resistance scales; may set `lastJumpTick`) → 10. liftoff edge (read from `lastJumpTick` changing) → 11. ghost field handoff (`recoveryWeight`, `steerInput`, mixes, phases) → 12. `updateAnimTarget` → 13. `applyTracking` → 14. `stepPhysics` (the ONE world step) → 15. impact drain + `applyImpacts` (same tick) → 16. snapshots → 17. once-a-second asserts (non-finite, weight partition, strafe-sign alarm, flail alarm).

---

## 4. THE LAWS, AS THEY NOW ACTUALLY STAND

### 4.1 Law 1 — Physics owns momentum; Animation owns pose
Intact and proven. The root is the sphere; the visual body binds to it through tracking forces (the pelvis boost is the inverted pendulum). Nothing writes velocity or position to any body during play except the three sanctioned spawn events. Data flows motor → ghost → tracker → bodies, one way. Knock the athlete down at a sprint and the sphere keeps its speed, because the athlete was never carrying it.

### 4.2 Law 2 — World-space PD tracking only
Intact. No joint motors, no joint-space muscles, no local-frame servos anywhere. Stumbles emerge from the joints resolving world-space pulls.

### 4.3 Law 3 — The Damping-Impulse Clamp. **AMENDED BY EVIDENCE — read carefully.**
The original law: explicit damping crashes the Rapier WASM; all damping must be clamped impulses that at most cancel *relative* velocity. During Phase 2 the crash claim was **tested and disproven** against `@dimforge/rapier3d-compat 0.19.3` (a ball dropped with damping 2.0 reaches −5.9 m/s vs −24.0 free-fall; no crash). The stale claim was corrected in `physics.js`, and one documented exception now exists: **solver-side `setLinearDamping`/`setAngularDamping` on the arm chain** (speed-and-downness-gated, for solver-injected chatter the pre-step helpers mathematically cannot reach — every alternative was measured and moved nothing) **and on the legs during a dive** (the leg parachute, faded by diveMix). The ban therefore greps to two commented lines in one function (`applyArmDamping`), not zero.

**The next architect's position should be:** the clamp discipline stands on its own merits — single implementation (`damping.js`), relative-velocity, cannot inject energy, cannot reverse motion — and remains the default for ALL gameplay damping. The solver-side exception is legal but *quarantined*: it must never grow beyond `applyArmDamping`, and any Rapier version bump must re-run the crash test and the jitter measurements before the exception is assumed still valid or still necessary. This amendment was made by the execution model on measured evidence mid-phase; the measurements are good, but adopt it as a formally re-litigated law, not as drift.

### 4.4 Law 4 — One Blend Weight, no boolean states (scope rulings GF-2.0 / GF-3.3)
The weight is still the only balance authority, but its ecosystem grew satellites — all floats, all documented: `muscleTone` (damper floor), `knockdownTone` (landing weight), the stand-up effort floor on kp, per-group stiffness lerped to 1 by weight, the dive's dead legs. The scope rulings that made the action systems legal: **mechanics-phase floats are allowed** — an edge may latch a float or start a monotone ratchet (`jumpQueued`, `locomotionPhase`, `standUpProgress`, `jumpPhase`, `slidePhase`, `divePhase`, `prevGrounded`, recorded ticks like `lastDiveTick`/`diveStunUntil`); **no boolean of character state may exist and nothing may branch on "which state we are in."** Hold-point ratchets (climb to an authored hold, hold, complete on an edge) are the house pattern for one-shot animations — they cannot loop and cannot be re-triggered mid-flight. The vy-scrub for jump timing was tried twice, failed twice, and is banned by ruling GF-3.3: animation time never derives from a noisy, non-monotone signal.

### 4.5 Law 5 — No root motion
Intact, with a war story (§5.9): the strip must be derived from the armature's axes, not assumed.

### 4.6 Law 6 — Determinism is law
Fixed 60 Hz dt only; the sim reads no wall clock (the `src/sim/` directory bans naming one, greppable); mixer advances only in fixedUpdate; no mixer fade APIs; every mechanics timer is ticks; the anchored capture is the regression test and byte-identical pairs are the gate currency. Engine specifics: `setCanSleep(false)` on every character body; 16 solver iterations (a code constant, deliberately not tunable); joint limits via `joint.setLimits()` — limits on the JointData descriptor are **silently ignored**; `setCcdEnabled(true)` on fast bodies over trimesh; `world.timestep = fixedDt` exactly.

---

## 5. THE PHYSICS LESSONS (what the next architect must not re-learn)

1. **PD terms sample pre-impulse state.** Damping the post-spring velocity is a veto, not a damper. Measured: kd 8→400 worsened tracking error 60×.
2. **Mass-scale the linear spring.** Equal impulses per body flick a 0.76 kg hand 15× harder than an 11.4 kg pelvis — that WAS the hand buzz. Gains are accelerations.
3. **Shortest-arc the quaternion error** (negate at w<0) or a body degrees from target is occasionally told to rotate the long way at full gain. Intermittent, maddening.
4. **The weight cannot buy tone.** Weight scales springs AND dampers; a floor on it prevents falling at all (measured table in `queueKnockdown`). Tone is a separate damper-only floor.
5. **The stand-up deadlock:** a get-up scrub anchored to pelvis height is circular — the pose can't haul the body because the pose is derived from the body. The clock must be a signal the clip cannot influence: the recovery ramp, with a gain so the take finishes ahead of the weight, and a collapse re-seed on any one-tick downward weight step.
6. **The recovery window problem:** four gates driven by processes at different rates never overlap — an edge-triggered remount "never fires." Held constraints ("is he down NOW → converge the sphere") have no timing to miss. The follower moves the sphere with capped per-step displacement, velocity preserved, no `interpolated.reset` (resetting every step IS render stutter), wall-clamped by a ray.
7. **Floor height is a ray, not y=0.** On the bowl wall a flat-on-the-slope pelvis is metres above zero; standUpNeed read "standing" for a downed athlete. One ray per step, shared by follower and stand-up.
8. **T-pose degeneracies:** `setFromUnitVectors` is antiparallel-degenerate for straight-down legs (79° random roll → broken hinge zeros); cross-of-segments hinge-axis derivation is zero at collinear elbows/knees. Explicit bases; authored axes.
9. **The Z-up armature vs L5:** the Mixamo exporter leaves a 90° X on the armature root; "strip horizontal XZ" in armature-local terms pinned the *vertical* and kept a horizontal. Invisible for 13 in-place cycles (≤0.32 m drift), catastrophic for travel clips (Slide Left: 6.64 m). Derive which local axes are world-horizontal (`hipsAxisRoles`); after derivation, all 15 clips measure 0.0000 m.
10. **Scale trap:** the 0.01 armature scale means every rig measurement must be world-space; bind matrices carry the scale legitimately — store whole, never decompose assuming unit scale.
11. **GLTFLoader strips `:` from node names** (`PropertyBinding.sanitizeNodeName`). Keep asset names in authored tables; sanitize at lookup.
12. **Densities:** author g/cm³, convert ×1000 for Rapier, or the athlete weighs 73 grams. Corroborate via a second number (tumble impulse).
13. **Trimesh arenas:** lathe poles produce zero-area triangles that read as contradictory contact planes (ball spins in place, drive cancelled). Rapier's own TriMeshFlags made it worse (measured: fall-through at −487). Filter degenerates in JS before Rapier sees the index buffer. Visual and collider from ONE geometry, always.
14. **Grounded needs a ray fan** (distance-based, ring at radius) AND, for animation only, an asymmetric debounce — believe leaving instantly, require agreement to land. One tick of false contact mid-flight re-latched jump clips and cratered airborneMix.
15. **Contact-force calibration before mapping:** instrument the ceiling of clean play, set the threshold above it with margin, or standing still bleeds the weight.
16. **Impacts are a property of a tick:** autoDrain queue, drained and spent the same step.
17. **Time-based action penalties feel like theft.** The slide's maxTicks knockdown cut every fast slide mid-flight; replaced by physical conditions (rode it below knockdownSpeed while still holding). Penalties should be things the player can see coming.
18. **Read the athlete, not the vehicle,** when asking athlete questions: the dive-skid's end reads pelvis speed, because the sphere is braked by different forces than the sliding body (measured 10.7 vs 7.1 m/s²).
19. **One camera owner.** OrbitControls + spring arm + follow = three owners whose run order was load-bearing. The spring arm's invariant (converges to radius in the clear) makes the stuck state unrepresentable.
20. **The capture must re-derive EVERYTHING at alpha 1** — the spring arm ran earlier at frame alpha and leaked frame pacing into "deterministic" pixels.
21. **Two model files, one rig:** swapping the character asset is safe when skeleton, skin, and bind are byte-identical; the auto-rigger's derivation makes the collider side free.
22. **HUD readouts must READ, never recompute.** A duplicated share calculation drifted from the mixer's truth and reported 62% stand-up during a slide the mixer wasn't playing.

---

## 6. TECHNICAL DEBT (documented, not fixed — in priority order)

1. **`main.js` is a 1650-line god file; `fixedUpdate` alone is ~590 lines** orchestrating watchdog, mount follower, slide, dive, dive-stun, knockdown drag, limp brake, grounded debounce, liftoff edge, tumbling gate. The ordering contract (§3) is documented but implicit in one function body. Refactor: extract `mechanics/actions.js` (slide+dive), `mechanics/mountFollower.js`, `mechanics/watchdog.js`, keeping the ordering explicit in one short orchestrator. Do this BEFORE the ball adds more mechanics to the same function.
2. **The Law 3 exception is quarantined but informal** (§4.3). Formally re-adopt or migrate; pin the Rapier version; re-run the crash + jitter measurements on any bump.
3. **The weight ecosystem's invariants live in comments.** Writers/readers of `tracker.weight` and its satellites span three files (tracker, main, animtarget-via-`recoveryWeight`). One authoritative doc-block (or a `weights.md`) listing every writer, every reader, and the legal ranges would prevent the next "why is recovery held off" hunt.
4. **Cross-module plumbing by field-poking:** `main.js` writes `animTarget.recoveryWeight/steerInput/slideMix/diveMix/slidePhase/divePhase` directly. It's documented ("main owns mechanics, ghost owns pose shares") but untyped and easy to miss one. Formalize a single `ghostInputs` object handed into `updateAnimTarget`.
5. **Duplicated math helpers** (`shortestAngleDelta`, `ease`, `smoothstep01`) across animtarget/main (and legacy passenger). Three call sites earned a tiny shared module.
6. **`syncRagdollPose` calls `parent.updateWorldMatrix(true, false)` per mapped bone per frame** plus a full-tree update after — fine for one character, quadratic-ish pain for the multiplayer roster. Batch the ancestor refresh.
7. **Grounded semantics are split** (raw `motor.grounded` for physics, `stableGrounded` debounce computed in main for animation). Correct but subtle; centralize the derivation next refactor.
8. **Zombie files:** `sim/passenger.js` (orphaned since GF-1; survived four deletion orders — delete by hand), `public/models/character.glb` (superseded), and the entire stale `Downloads\valleyball` clone (delete or rename; it has already cost one audit cycle).
9. **The GUI is hand-maintained per TUNING key** (`gui.js` builds folders manually, locked-vs-live per entry). Every TUNING addition risks a missing/mislabelled slider. Consider generating from a schema with lock annotations.
10. **`tuning.js` is 1022 lines** — the essays are valuable but the DEFAULTS object is drifting toward unscannable. Split the war-story comments into docs, keep terse one-liners in the object.
11. **Asset placeholders still live:** backpedal = reversed Walk Forward; no lateral sprint clips; airborne "hang" = held jump frame; single slide clip (left only — a right-slide mirror or clip is needed); no authored dive-recovery distinct from stand-ups. The 30-animation model should retire most of these — audit its clip list against this list on arrival.
12. **The determinism pair is a manual protocol** (run, rename, run, hash). Automate: a Playwright script driving two headless runs of `?captureTick=300` and comparing hashes; wire into CI. The harness was designed for exactly this and it's ~40 lines.
13. **`isDown`-adjacent gate constants are split between TUNING and code constants** deliberately (feel vs invariant), but the rule lives only in comments; write it into the contributing doc.
14. **Jump feel is explicitly deferred** (designer's call): standing-jump polish, land-recovery weight, jump-while-stumbling policy all open.
15. **Evidence debts:** none outstanding at handover except that the FINAL build's determinism pair should be re-run after any first Phase 3 change (protocol above).

---

## 7. THE WORKFLOW (how this project is actually driven)

Two-model loop: the **Architect** (Fable — you) designs, writes strict task prompts, and enforces; the **execution model** ("Opus") writes code from those prompts, pasted by the designer (Jac). Hard-won rules:

- **Prompts restate the laws they touch**, every time. The execution model will hallucinate generic solutions without them, and will occasionally "improve" a law — twice it silently skipped an ordered fix (the remount), once it amended a law with good evidence (§4.3). Trust nothing you haven't read on disk.
- **Gates close on evidence in the folder**: code diffs/hashes of frozen files, grep censuses (`setTranslation` sites, banned setters, fade APIs, state booleans), the determinism pair, and labelled captures of the specific behaviors. Completion reports are not evidence. The architect stages files from `Dev\Valleyball\Valleyball-Demo` and reads them.
- **Calibrate before tuning** (measure the regime, then set thresholds); **instrument before arguing** (the probe exists so feel debates end in numbers).
- **Asset truth beats the wishlist**: parse the GLB before writing prompts against clips or bones it may not have.
- **One step at a time; do not move until the current step is perfect.** The designer (Jac) owns feel verdicts and design rulings (facing, cameras, penalties); the architect owns law and structure.

---

## 8. PHASE 3 ROADMAP — THE SPORT

Order chosen so each step's evidence is visible in captures, and the riskiest integration (the new model) lands before mechanics are built on its clips.

### Step G1 — The 30-Animation Model Swap
Prove the auto-rigger's core promise. Parse the new GLB first (joints, names, scale, clip inventory vs §6.11's placeholder list). Edit `BONE_MAP` and TUNING clip names ONLY. Gate: skeleton audit passes; flop test; mesh-in-capsules; all placeholder retirements logged; determinism pair on the new asset. Budget a feel-tuning session — new proportions change masses, radii, and PD feel.

### Step G2 — The Ball
New collision group (0x0008). Designer's spec on record: **the Sphere Motor ignores the ball; the limbs collide with it.** Dynamic ball (real volleyball ≈ 0.27 kg, radius ≈ 0.105 m — expect to cheat mass/restitution for feel), CCD on, `setCanSleep(false)` during rallies, interpolated visual, serve/reset via the spawn-event family. Ball state joins the determinism capture. Contact-force events on the ball for Step G4's touch detection. Camera: this is where the **auto-face-the-ball mode** lands (the strafe blend space was built for it); right-stick override per the standing facing ruling.
### Step G3 — Arena Import
Authored arena GLB → the existing single-geometry trimesh pipeline (degenerate filter stays; log triangle counts; consider convex decomposition for the net posts if contacts misbehave). **Court Geometry Integrity pillar:** net height, court boundaries, and collision layers are contract values in TUNING/manifest — mechanics experiments must not alter them. Per-arena kill plane and spawn points. The bowl remains as the physics test rig behind a scene flag.

### Step G4 — Strikes (Bump, Volley/Set, Spike, Kick)
The designer's schema: volley = East, spike = North (dive already ships and can already contact the ball mid-flight = the diving dig). Architecture: strike = action-tier pose overlay (hold-point ratchet) + a **timing window** (tick latch from press) + a **contact resolver** — when a hand/forearm (or foot, for kick) body contacts the ball inside the window, apply `applyImpulse` to the BALL aimed by facing + stick + strike type (volley up, spike down per the design doc), scaled by a quality curve over timing error. The limbs' physical contact provides the incidental touches for free; the strike impulse provides intent. Keep Law 1 sacred: strikes push the ball, never the athlete's root (recoil, if wanted, is a torque on the sphere through the normal input path). Expect a dedicated feel phase: strike windows are the sport.

### Step G5 — Game State
One `gamestate.js` module, tick-driven, no wall clock: serve → rally → point → reset lifecycle as data; scoring on ball-ground contact by court side; out-of-bounds by boundary volumes (sensor colliders or pure math against the court contract); resets exclusively through the spawn-event family. **Local multiplayer prep** (the founding pillar): input router mapping N gamepads → N motor/ghost/tracker/rig instances (§6.6's perf item matters here), shared-screen camera policy that favors no player. Determinism now covers the full rally loop.

### Cross-cutting
Automate the determinism pair (§6.12) before G2; refactor `main.js` (§6.1) before G4 adds strike mechanics to it; re-audit collision-group matrix at each step (it's about to grow: ball, net, boundaries, N players).

---

## 9. FINAL STATE OF RECORD

- All Prime Directive laws verified in the final source except as amended in §4.3 (documented, quarantined).
- `setTranslation` census: exactly three sanctioned sites (spawn, watchdog, mount follower). Banned-setter census: two commented lines in `applyArmDamping`, per the amended law. No mixer fade APIs. No character-state booleans.
- Determinism protocol last passed on the GF-3-era baseline; re-run on first Phase 3 touch.
- The project doc `claude/iteration-2-post-mortem-laws.md` (claude.ai project "Valleyball 2026") tracks the laws and status and should be updated as Phase 3 lands.

The athlete runs, strafes, jumps, dives, slides, crashes, and gets up where he fell, on nothing but momentum, a ghost, and one float. Phase 3 gives him something to play for. Guard the laws, audit the folder, and make him an athlete with a sport.

— Fable, Principal Architect, Phases 1–2
