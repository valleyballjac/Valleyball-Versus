# VALLEYBALL — ARCHITECTURAL SOURCE OF TRUTH & PROJECT HANDOFF

**From:** Fable 5.1 (Principal Architect, Phase 3 — G1 through G4.1)
**To:** the incoming Technical Architect / PM (Antigravity), with Claude Opus continuing as execution
**Date:** September 9, 2026
**Basis:** the live tree at `C:\Users\portt\Dev\Valleyball\Valleyball-Demo` as audited from disk on this date, the completion reports in `_fable\` and the claude.ai project `Valleyball 2026`, and the Phase 2 handover (`claude/phase2-postmortem-handover.md`), which this document supersedes as the entry point but does not replace as history.

**How to read this document:** §1 is law — do not relitigate without a measurement. §2 is what was built and proven. §3 is what was learned the hard way and must not be re-learned. §4 is what is open, in debt, or dangerous. §5 is how the project is actually driven. Everything marked **VERIFIED** was checked against the tree on Sep 9; everything marked **UNVERIFIED** is on the record from a report but has not been checked from disk since.

---

## 0. THE STATE OF THE TREE ON SEP 9 — READ THIS FIRST

The project moved between Sep 6 and Sep 9 without an architect's gate. What the tree says:

| Item | State |
|---|---|
| G4.1 kick + contextual East + predictive side selection | **Landed** (`strikes.js` 881 lines; `eastKind`, `chooseSide`, `sideAgreement` in the probe). Kick row on disk is rev 1.3's `[8, 14, 17]`; the Sep 6 measurement addendum's `[10, 14, 16]` and its amendment to the contact rule (§3.6) are **unruled and unapplied**. |
| Sweet-spot proximity assist (`checkStrikeAssist`, `assistRadius 0.28 m`, `±4 ticks`) | **Landed, outside every strike spec's fence** ("no auto-aim, no ball-seeking"). See §4.1 — it is a design decision that changes what the whiff data means. |
| Live feel tune | `driveTorque 3→4`, `brakeTorque 1→2`, `fallGravityMultiplier 2.5→2.0`, `takeoffRate 1.8→2.5`, `landRate 2.5→2.0`, `qualityPerfectTicks 3→4`, `MOUNT_RAY_LIFT 2.0→0.3`. Designer-directed; legal; **every one moves the determinism anchor.** |
| `motor.js` (frozen since Phase 2) | **Modified Sep 8**: the ground fan gained a centre-ray early exit and temporal coherence on the last-hit ring. A perf change to a frozen file; behaviour-neutral by intent, **unproven**. |
| Determinism anchors | **STALE.** The last laptop runs are Sep 3 (`captures/auto_bowl_t300_*`, `auto_court_t300_*`, `auto_bowl_t90_*`). No pair has been run against the current tree. The recorded anchors (`0E6C9579…` bowl, `77661696…` court) no longer describe this build. |
| Scenario harness | `scripts/scenario.mjs` unchanged since Sep 3: scenarios `strike` (whiffs by design — never re-derived) and `actions`. **No `kick` or `crossing` scenario exists.** G4.1 shipped without its input-path gate. |
| Court physics pass (G3.1) | **Not done** except the mount-ray lift. `RENDER_ONLY_PREFIXES` is still empty (the 5 cm line-decal ridges still have colliders); no floor merge; no camera-blocker group. `arena.glb` re-copied Sep 9 (sha256 `24562ac1…`, byte-identical to `Arena\ValleyballCourt2025_v8.3.glb`; `arena_v83_backup.glb` kept). |
| Public alpha | `vite.config.js` `base: '/Valleyball-Versus/'`, `npm run deploy` via `gh-pages`, a player-facing `README.md` ("score a goal by getting the balls through the ring"). The game is public. |
| Repo hygiene | Root now carries `current_tuning.json`, `user_tuning.json`, `c.json`, `diff.mjs` — tuning-diff scaffolding that belongs in `scripts/` or nowhere. |
| Censuses (all **VERIFIED** Sep 9) | `setTranslation` play sites: 4 (`resetBall`, watchdog, mount follower, R-spawn builder) + construction exceptions. Damping setters: `tracker.js` 229/230/242/243, one function, unchanged. `applyImpulse` in `mechanics/`: one line (`strikes.js:722`), receiver a ball. No wall clock under `sim/` or `mechanics/`. `fixedUpdate` = 115 lines (1065–1179). |

**The first action of the incoming architect is to re-anchor:** run `npm run determinism`, `-- --arena court`, `-- --tick 90`, `npm run scenario -- --name actions` on the laptop, record the new hashes as the Phase 3.1 anchors, and only then accept or reject the Sep 6–9 changes as a batch. Until that happens, nothing after Sep 3 is proven.

---

## 1. THE LAWS — CORE INVARIANTS

These are the Prime Directive of Iteration 2. Iteration 1 died on feel by making physics authoritative over pose; everything below exists to protect the inversion that fixed it.

### Law 1 — Physics owns momentum; animation owns pose
The athlete's root is a dynamic Rapier sphere (r 0.5) driven **only by torque and force** — a torque about `cross(worldUp, moveDir)`, a governor that *starves* the motor above max angular speed (never clamps velocity), an upward jump impulse. Data flows one way: `input → motor (momentum) → kinematic ghost (pose) → PD tracker → 16 ragdoll bodies`. **Nothing writes velocity or position to any athlete body during play.** The sanctioned spawn-event family is the only `setTranslation` in play code: R-spawn, the out-of-bounds watchdog, the mount follower, `resetBall`. A strike pushes the **ball** (`applyImpulse` on a ball body, mass-normalised to an authored launch speed), never the athlete. Knock the athlete down at a sprint and the sphere keeps its speed, because the athlete was never carrying it.

### Law 2 — World-space PD tracking only
No joint motors, no joint-space muscles, no local-frame servos. Each body gets a mass-scaled linear impulse toward its ghost target and an angular impulse from the shortest-arc quaternion error, both damped through the clamped helper, both sampling **pre-impulse** state. The pelvis boost is the inverted pendulum — a gain multiplier on the same path as every other body, not a mechanism.

### Law 3 — The damping-impulse clamp, with one quarantined exception
All gameplay damping goes through one implementation (`damping.js` / `applyClampedDamping` in `motor.js`): a relative-velocity impulse clamped so it can at most cancel motion, never inject energy or reverse it. The original claim that explicit Rapier damping crashes the WASM was **disproven** (rapier3d-compat 0.19.3); the clamp discipline stands on its own merits. **The one exception is one function: `applyArmDamping` in `tracker.js`, two sites (arm-chain chatter; the dive's leg parachute), four setter calls.** It may not grow by a line. The ball's air drag goes through the clamp. Any Rapier version bump re-runs the crash test and the jitter measurements before the exception is assumed still valid or still necessary.

### Law 4 — One blend weight; no boolean character state (rulings GF-2.0, GF-3.3)
`tracker.weight` (0..1) is the only balance authority; its satellites (`muscleTone`, `knockdownTone`, the stand-up effort floor, per-group stiffness, the dive's dead legs) are floats. Mechanics may keep **phase floats, monotone ratchets and recorded ticks** (`slidePhase`, `divePhase`, `strikePhase`, `lastJumpTick`, `lastDiveTick`, `lastStrikeTick`, `lastStrikeKind`, `lastStrikeSide`, `lastEastKind`). **No boolean of character state may exist and nothing may branch on "which state we are in."** Blend precedence is by continuous shares that sum to 1 (asserted once a second): stand-up > action (slide / dive / strike) > airborne > locomotion + idle. Hold-point ratchets are the house pattern for one-shot animations. **Animation time never derives from a noisy, non-monotone signal** (GF-3.3: the vy-scrub was tried twice and banned). A button edge-tracker (`slideNeedsRelease`, `padJumpWasDown`) is input state, not character state, and is legal — it must describe the button and be read in exactly one place.

### Law 5 — No root motion
The L5 strip pins the hips' world-horizontal axes to bind each step and keeps the vertical. **Which armature-local axes are horizontal is derived (`hipsAxisRoles`), never assumed** — the Mixamo root carries a 90° X rotation and an assumed strip pinned the vertical (Slide Left drifted 6.64 m before derivation). All 30 clips measure 0.0000 m residual; the readout is logged at boot and must stay 0.0000.

### Law 6 — Determinism
Fixed 60 Hz dt; the sim reads no wall clock; the mixer advances only in `fixedUpdate`; no mixer fade APIs; every timer is ticks; `setCanSleep(false)` on every character and ball body; 16 solver iterations as a code constant; joint limits via `joint.setLimits()` (limits on the descriptor are silently ignored); CCD on fast bodies over trimesh; `world.timestep = fixedDt` exactly. The gate currency is a **byte-identical anchored capture pair** (`?captureTick=N`, 1280×720, alpha 1). **Clarification (G3.5):** with no input the sim is a pure function of the tick; with input it is a function of (tick, per-*frame* input snapshot), because `sampleInput` latches once per rAF frame. The scenario harness pins rAF to one step per frame from outside the page to make injected input a function of the tick. **A per-tick input latch is a G5 input-router requirement.**

### Directory rules and standing rules
- **`src/sim/` and `src/mechanics/` name no wall clock or scheduler API, not even in a comment** — `grep "Date.now\|performance.now"` must return zero. Comments describe banned tokens without containing them (the G4 censuses answered themselves twice through comments).
- **A census clause is the exact command, run once on the current tree before it becomes a gate.** An un-run census is a claim. This rule was violated by the architect four times; the count is pasted beside the command.
- **Readouts read, never recompute** (Lesson 22). HUD and probe report stored values.
- **One apply site** (Lesson 23): `render()` and `captureAnchored` both walk `loop.interpolated`; nothing applies an `Interpolated` by name. Registering is the whole contract.
- **Audit the folder, not the report.** Completion reports are not evidence; files, hashes and captures are.
- **Every step's gate carries at least one criterion only a person can satisfy, stated as a number** (hit rate, whiff rate, "lands and scores N of M"). Three green gates shipped broken features before this rule existed.
- **The bowl is the determinism anchor; the court is a second measurement; `--arena` is explicit, never inherited from TUNING.**
- Court Geometry Integrity: nothing scales, rotates or repositions the authored court. There is **no net** — the goals are two tori (centre (0, 10, ±40), ring radius ≈ 5 m, tube 0.33 m, ring plane YZ). The contract values are hoop centre/radius, scoring-circle radii, field extents, kill plane.

---

## 2. MILESTONES — WHAT WAS BUILT AND PROVEN

### Phase 2 (closed Sep 2) — the Athlete Movement Baseline
Sphere motor; kinematic ghost; PD tracker with THE WEIGHT; auto-rigger deriving 16 bodies / 15 joints from the GLB's world-space bind pose (`BONE_MAP` is the only authored data); 2D locomotion blend space (gait × direction tents, one `locomotionPhase`, stride sync); jump / slide / dive / stand-up as hold-point ratchets; reactive knockdown through contact-force events; mount follower; spring-arm camera; anchored capture harness. See `claude/phase2-postmortem-handover.md` for the full record and §5 of that document for the 22 physics lessons.

### G1 — 30-animation model swap (closed Sep 2)
`YBOT30Animations.glb` (now `public/models/character.glb`) is **byte-identical in rig, skins and bind** to its predecessors; 15 shipping clips byte-identical; 15 new. `BONE_MAP` needed no edit. Asset defects on record: `Bash Hit Left` is a byte-duplicate of `Bash Hit Right`; `Idle Two Hand Volley` opens on three bind-pose frames (`clipStart ≥ 0.081`).
**G1.1:** per-ring backpedal (`Walk Backwards` / `Jog Backwards`), nine distinct cycle nodes; `scripts/determinism.mjs` (Playwright, headless SwiftShader, `npm run determinism`) became the gate protocol.

### G2 — the ball (closed Sep 3)
`sim/ball.js`; collision group `0x0008`; **the sphere motor ignores the ball, the limbs collide with it** (designer's spec, proven by `motorContactCount === 0`); restitution combine rule Max; CCD; clamped drag; `resetBall` as the fourth spawn-event site; contact forces instrumented, not mapped. The designer respec'd to **three oversized rubber dodgeballs** (0.4 / 1.0 / 1.5 m) as a scale fixture, kept as `TUNING.balls[]`; **creation order is load-bearing for Law 6** (sequential, never `Promise.all`). The render-path bug (frozen ball mesh, invisible to the capture gate) produced Lesson 23.

### G3 — dual-environment court import (closed Sep 3)
`TUNING.arena.type` `'court' | 'bowl'` with `?arena=` overriding; per-arena presets own spawns, kill plane and ball spawns; the authored court as **one fixed body with 51 world-baked trimesh colliders** (31,732 triangles, 0 degenerate); the bowl stays as the permanent test rig. The G1 audit's deny-list recommendation was **wrong**: `CenterCircle` and `Scoring Circle N/S` are floor, measured by a 2 m raycast grid (1474/1475 with all nodes collidable). GLTFLoader naming trap: multi-primitive nodes become groups whose child meshes carry the *mesh* name.
**G3.5:** `main.js` 2,206 → ~1,850; `fixedUpdate` 706 → 119 lines; `mechanics/{watchdog, mountFollower, actions}.js` with per-athlete state factories (no module singletons — G5 instantiates N); `ghostInputs` replaces field-poking; `docs/weights.md`; zombies deleted. Proven by the bowl hash not moving and by a scripted slide/dive/knockdown A/B.

### G4 — strikes (closed Sep 3 on the human criterion)
`mechanics/strikes.js`: a strike = **hold-point ratchet + tick window (sweet tick, quality curve) + contact resolver** applying a mass-normalised impulse to the ball. Volley (East) and Spike (North), from one table. Windows **measured** by offline FK on the striking limb (`scripts/measure_clips.mjs`), authored at 1× with `climbRate` as the live feel slider. Aim latched at the press edge (`lastAimYaw`). The designer's play found the volley unlandable (sweet tick at the stopped apex; 5 N event threshold suppressing contact) → retune `holdPoint 0.65`, window `[12, 20, 30]`, `ball.eventThreshold 1.0 N`. Option B: a jump swallows a slide, a dive locks the jump out; `slideNeedsRelease` re-entry lockout. `scripts/scenario.mjs` (`npm run scenario`) built.
**Standing finding:** both strikes are overhead; hands arrive ~1.6–2.1 m; **no ball can be played off the floor by hand.**

### G4.1 — the contextual kick (landed Sep 6–8; gate NOT closed)
East is one button: the nearest ball's centre height relative to the pelvis at the press records the kind (`kickBelowHips −0.10`, `kickHysteresis 0.05`, `contextRadius 4 m`; designer's ruling: a resting ball of any size is a kick). Kick row from `Idle Low Kick L/R`, bodies `footL/R`, `calfL/R`, `launchSpeed 10`, `elevationDeg 50`, contact tick 14 at 1×. **Predictive side selection** (`chooseSide`): ball and athlete projected to the row's `sweetTick` (both clamped by `sideProjectClamp`), nearest by projected distance, local x in the latched aim frame, deadzone → stick → last side; decided once at the press; `sideAgreement` is the number. Measured facts: the kick L/R pairs are one take mirrored; the spike L/R takes differ only in the legs (contact tick 42 on both sides — no per-side timing needed); `Idle Kick L/R` is a knee-to-hip-height kick and is not registered.

### Roadmap — what is next, in the architect's order
1. **Re-anchor** (§0). Then close G4.1: `kick` and `crossing` scenarios that *connect*, the play numbers (≥20 kicks at a resting ball, 20 airborne East presses resolving as volleys, `sideAgreement` before/after), the spike-contact screenshot, the two G3 debts.
2. **G3.1 — court physics pass.** Instrument first (motor vy spikes, `pelvisFloorY` jumps, spring-arm length jumps, each with the collider hit), then: `M_Lines*` *primitives* render-only by material (they are 5 cm raised ridges with their own colliders — the likeliest cause of the reported hitching at z ≈ ±40–48); floor nodes merged into one trimesh with winding normalised for the eleven det −1 nodes and `FIX_INTERNAL_EDGES` tested on the court (the bowl's earlier TriMeshFlags disaster was a lathe with degenerates, a different case); a `GROUP_CAMERA_BLOCKER` bit so the spring-arm ray ignores the tori and glass. Glass stays collidable — it is the boundary (its lower corners are open in the asset; artist fix logged).
3. **G2.1 — auto-face-the-ball camera.** The strafe blend space was built for it; right-stick override per the standing facing ruling. Aim currently = camera yaw.
4. **G5 — game state and local multiplayer.** `gamestate.js`, tick-driven, no wall clock: serve → rally → point → reset as data; scoring on hoop passage / ball-ground by side; out-of-bounds by boundary volumes against the court contract; resets only through the spawn-event family; **the per-round ball pick from a seeded, tick-driven PRNG, never `Math.random`** (designer wants all three balls, randomised per round). **Multi-athlete:** an input router mapping N gamepads → N (motor, ghost, tracker, rig, actions, strikes) instances — every mechanics module already exposes `create*State()` for this; **a per-tick input latch** so input is a function of the tick; `syncRagdollPose`'s per-bone `updateWorldMatrix` (debt §6.6 of the handover) becomes quadratic pain with a roster; shared-screen camera policy that favours no player. Determinism then covers the full rally loop.

---

## 3. NON-NEGOTIABLES AND HARD-LEARNED LESSONS

The Phase 2 handover's 22 physics lessons stand in full (`claude/phase2-postmortem-handover.md` §5). The ones that will be hit again first, plus everything learned in Phase 3:

### 3.1 PD tracking
- **Sample pre-impulse state** for both PD terms; damping the post-spring velocity is a veto (kd 8→400 made tracking 60× worse).
- **Mass-scale the linear spring** (gains are accelerations); equal impulses flick a 0.76 kg hand 15× harder than the pelvis — that was the hand buzz.
- **Shortest-arc the quaternion error** (negate at w < 0) or a body is intermittently told to rotate the long way at full gain.
- **The weight cannot buy tone**: weight scales springs and dampers; a floor on it prevents falling at all. Tone is a separate damper-only floor.
- `kpScale = max(weight^limpness, standUpNeed·standUpProgress·authority)` — without the stand-up's own effort term the get-up has nothing to act through.

### 3.2 The mount follower and recovery
- **Edge-triggered remounts never fire**; held constraints ("is he down NOW → converge the sphere") have no timing to miss. The follower moves the sphere with capped per-step displacement, velocity preserved, **no `interpolated.reset`** (resetting every step is render stutter), wall-clamped by a ray.
- **Floor height is a ray, not y = 0**; one ray per step, shared by follower and stand-up. `MOUNT_RAY_LIFT` is now 0.3 m (was 2.0): the 2 m origin hit the goal torus tube from below and read a floor at hoop height; the cost, stated in the code, is that a pelvis clipped > 0.3 m under the floor now finds nothing and takes the honest "never guess a Y" branch.
- The stand-up clock must be a signal the clip cannot influence (the recovery ramp), or the get-up is circular.
- `isTumbling` and the mount hold both test `weight < mountRecoverBelow`; they are meant to be independent evidence — review whenever either is touched (`docs/weights.md`).

### 3.3 Contact-force events
- `EventQueue(autoDrain)`, per-collider thresholds, drained and spent the **same tick** — an impact is a property of a tick, not a backlog.
- **Calibrate before mapping** (Lesson 15): instrument the ceiling of clean play, set thresholds above it. Athlete impacts: `impact.eventThreshold 500 N`. Ball contacts: `ball.eventThreshold 1.0 N` (lowered from 5 N because a driving hand meeting a light ball raised no event at all — the resolver never saw the contact). Measured on the old volleyball: 0 N clean play, 15–133 N deliberate bumps, ~2,875 N jump-landing; **feet have never been measured**; the 1 N noise (rest / clean play / bumping) is still owed.
- **Contact resolution gates on timing, not force** — a resolver that also gated on force would silently drop the exact contacts the volley bug produced.
- Ball contacts **never cost the athlete weight** (instrument-only since G2; a design decision, not a limitation).

### 3.4 Strike mechanics
- **The contact frame is where the limb is *moving*, not where it has stopped** (the G4 volley bug: sweet tick at the hand-height apex, hand stationary, contact force under threshold, HUD counting attempts and no hits).
- **Standing contact rule** (G4.1 §10.1, with the pending amendment in §3.6): among frames at or below the target height, keep those whose *signed* velocity along the strike's own launch direction is ≥ 50 % of the clip's peak along that direction; contact = furthest reach among them. Windows are the qualified span at both ends, **never ±N**. Bind frames are measured, not assumed.
- Windows measured at 1× first; `climbRate` is the only feel slider; "snappier" is a designer decision made after 1× has been felt.
- A whiff is data. The hit/whiff rate per kind, and `sideAgreement` for sided rows, are the human criteria.
- Strike-while-airborne is permitted with no grounded gate (the jump spike is the sport). The known cost is a standing pose played in the air until a jump-spike clip exists.

### 3.5 The harnesses
- The determinism harness never presses a button; it **cannot see** slide, dive, knockdown or strikes. The scenario harness exists for that; its mechanism is the synthetic rAF clock (`Loop._onFrame(now)` takes the rAF argument; feed it 1000/60 ms per frame).
- Key scripts on the loop's published tick, not a frame counter from page load (boot time varies); presses are **tick ranges**, never `=== N`; `set()` is an assignment — one call per button per frame; always pin `?arena=` in a probe; read the `--trace` HUD readout every run — **two runs agreeing is necessary and nowhere near sufficient** (a scenario testing nothing is perfectly self-consistent).
- Design a scenario around the case that **distinguishes** the mechanisms (the slide-lockout test proved nothing until the press moved to a tick where every other clause was satisfied).
- Do not edit files under the Vite root while a run is in flight (HMR reloads the page). The HUD tick trails the armed tick by a few frames; the PNG and filename are the record. The capture endpoint reads only the canvas; HUD evidence is a browser screenshot.
- A backgrounded Chrome tab suspends rAF; the loop never leaves tick 0.
- SwiftShader hashes never equal GPU hashes; each pair compares against itself. The laptop is the machine of record.

### 3.6 Assets and clips
- Two model files, one rig: byte-identity of skeleton/skin/bind makes a swap free. The 0.01 armature scale means every rig measurement is world-space; bind matrices carry the scale legitimately.
- GLTFLoader strips `:` from names; keep authored names in tables, sanitise at lookup.
- **A node's name is not evidence of its role; coverage is measured** (the deny-list lesson).
- The volley clip: three bind frames at the head; the tail is a settled idle stance, not bind (`clipEnd 0.95` trims a settle — the G4 report's "tail is bind" was wrong).
- **Pending amendment to the contact rule** (Opus, Sep 6, unruled): the gate must use velocity along the row's **launch direction** (pitched by `elevationDeg`), not forward-only — a forward-only gate reads the spike's fastest, straight-down hand as "stopped". Under the amended gate the kick's qualified span is `[10, 16]` (on disk: `[8, 14, 17]`, where 17 was derived from raw speed by no rule), the spike's contact is tick 42 on both sides, and the volley's `holdPoint 0.65` sits on the last driving frame with no margin (measured contact 0.595 for a shoulder-high ball). **Architect's position on leaving:** the amendment is correct in kind and should be ruled in; author the kick window from it; do not move the volley further along the clip — that direction caused the original bug.

### 3.7 Process lessons that cost a step each
- A green gate shipped a broken feature three times (un-run Law 3 census; frozen ball mesh; unlandable volley). Hence the human criterion rule.
- Extracting code by line range: diff each moved block against its source range; check every comment block ends on a full stop (G3.5's off-by-two truncated a ruling mid-sentence and dragged a dead `let` along).
- Rulings appended as tables leave the spec body contradicting them; each revision reconciles the body (G4.1 rev 1.4).
- The execution model has no shell on the laptop; laptop runs are the designer's. Mirror runs verify the code; they are not the gate.

---

## 4. OPEN DECISIONS, TECHNICAL DEBT, WATCH-OUTS

### 4.1 Open design decisions (the designer owns these)
1. **The proximity assist** (`checkStrikeAssist`): a qualifying limb within 0.28 m of the ball's surface, within ±4 ticks of the sweet tick, resolves as a strike with a **fabricated 50 N force**. It is Law 1-clean (impulse still on the ball only) and Law 4-clean, but it was fenced out of every strike spec, and it changes what the data means: whiff rates now include rescued swings, and Lesson 15's force samples must be filtered to real contacts. **Recommendation:** keep it if the designer wants it, but tag every assisted resolve in the log and HUD, report hit rates with and without assist, and never let an assisted force into a calibration set.
2. Whether the spike's `holdPoint` moves from 0.641 (authored) to the measured contact phase 0.545 — a direction-correspondence question, not a hit question. Feel decision.
3. Whether ball contact ever costs the athlete weight (a spiked ball to the face).
4. Whether steering during the spike's half-second window is wanted (aim is latched at the press by ruling; revisit from play, not by accident).
5. The second contextual band (`Idle Kick L/R` for a ball at 0.45–0.90 m) — numbers on record, not built.
6. Kick force floor — expected, set from filtered deliberate-kick data, not yet.
7. Jump-spike clip, right-slide clip, dive-recovery clip, lateral sprint clips, backwards diagonals — asset requests, not code.
8. Bash Hit: re-export the duplicated Left take or drop the pair.

### 4.2 Technical debt, in priority order
1. **Re-anchor and re-gate the Sep 6–9 batch** (§0). Includes proving the `motor.js` ground-fan change behaviour-neutral (it is a frozen file; a perf change with no hash is a claim).
2. **Build the `kick` and `crossing` scenarios and re-derive `strike`** so all three connect. G4.1 has no input-path gate today.
3. **G3.1 court physics pass** (§2 roadmap item 2). Playtesting the sport on a hitching court poisons every feel verdict after it.
4. **`animtarget.js` is 1,917 lines** and `strikes.js` is 881. The blend-space file is the next god file; the strike file will grow again with G5. Extract the node construction and the tier combination before G5.
5. Repo hygiene: move or delete `current_tuning.json`, `user_tuning.json`, `c.json`, `diff.mjs` from the root; `tuning.js` is 71 KB of essays (handover debt §6.10); the GUI is hand-maintained per key (§6.9).
6. The two G3 debts, now five steps old: the location of the one floor-grid point with no floor; a standing screenshot on a mirrored (det −1) court node.
7. The 1 N event-threshold noise numbers (rest / clean play / bumping); go per-collider if rest is not ~0.
8. Handover debts still open: `syncRagdollPose` per-bone `updateWorldMatrix` (multiplayer perf); grounded semantics split between `motor.grounded` and the animation debounce; jump feel polish (landing weight, jump-while-stumbling policy).
9. The watchdog's respawn is consumed on the *next* tick (comment corrected; behaviour kept — a one-tick delay nobody can see; change it only as its own step with its own hash).
10. `Phase2_PostMortem_Handover.md` line 80 says "15 bodies / 14 joints"; the real figure is 16 / 15.

### 4.3 Watch-outs
- **The public alpha is live** (`/Valleyball-Versus/`). A `TUNING` change is now a release. Consider a tag per gated build.
- **Live tunes are legal and each one moves the anchor.** Batch them, re-anchor, record.
- Adding a body without registering its `Interpolated` cannot happen anymore (one apply site), but adding a **mechanic** without a scenario that exercises it can — and the determinism gate will stay green while it is broken.
- `TUNING.balls` order and the sequential creation loop are load-bearing for determinism (Rapier walks bodies in handle order).
- Rapier trimesh flags: `FIX_INTERNAL_EDGES` was catastrophic on the *bowl* (degenerate lathe poles; fall-through to y = −487); that measurement does not transfer to the court, where cross-collider seams are a different problem. Measure on the court.
- The 0.01 armature scale and the sanitised bone names will bite anyone who reads the rig by hand.
- `slideNeedsRelease` may be read by `startingSlide` and nothing else; if a second button needs an edge-tracker, both move to `input.js`.

---

## 5. GUIDANCE FOR THE INCOMING ARCHITECT

**The workflow that works.** The architect writes a spec; Opus reviews it *before* the prompt is written (every review so far has found real defects in the spec — an un-runnable census, a silent placeholder, a wrong slot); the PM builds the prompt with the laws restated and the fence verbatim; Opus builds and reports; the architect **audits the folder** (stage the files, run the greps, hash the captures) and rules; the designer owns feel verdicts and design rulings; the laptop gate closes before the next prompt is released. Prompts restate the laws they touch every time — the execution model will "improve" a law otherwise, and has.

**What the execution model is good at, and what to watch.** Opus's reports are unusually honest — it names its own shortfalls, measures before asserting, and has overturned the architect twice with data (the deny-list; the census rule). Take a "this falls short of §X" at face value and rule on it; do not let it be dressed up later. Watch for scope creep dressed as feel (the assist landed without a spec), for frozen files being edited for good reasons without a hash, and for D0 debts rolling forward — the two G3 debts are on their fifth step.

**The designer.** Jac plays and finds what the harness cannot: the unlandable volley, the wrong-limb spike, the court hitching. Every one of those became a measurement and then a rule. Put the human criterion in every gate and read the per-press logs he generates.

**The gate, restated.** A step closes on: the laptop determinism pair unchanged (bowl) or recorded (court); a scenario that *exercises* the mechanic and connects; the censuses run as exact commands; screenshots of the behaviour; and one number only a person can produce. Not before.

**Where things are.** Specs, verdicts and reports: `C:\Users\portt\Dev\Valleyball\_fable\` (architect) and the claude.ai project `claude/` docs (Opus). Laws history: `claude/iteration-2-post-mortem-laws.md`, `claude/phase2-postmortem-handover.md`. Weight ecosystem: `docs/weights.md`. Harnesses: `scripts/determinism.mjs`, `scripts/scenario.mjs`, `scripts/measure_clips.mjs`. Arena reference material and the Blender sources: `Dev\Valleyball\Arena\Context\`.

**Two things I would do on day one.** Re-anchor (§0), and rule on the contact-rule amendment (§3.6) — it is correct and it is blocking the kick window. Then G3.1 before anything else touches feel.

— Fable 5.1
