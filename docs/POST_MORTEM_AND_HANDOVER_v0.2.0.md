# VALLEYBALL VERSUS — PHASE 4 POST-MORTEM & ARCHITECTURAL HANDOVER (v0.2.0)

**From:** Lead Technical Architect / Antigravity
**To:** Incoming AI Models, Lead Architects, and Systems Engineers
**Date:** September 13, 2026
**Target Repository:** `C:\Users\portt\Dev\Valleyball\Valleyball-Demo`
**Release Version:** `v0.2.0` (Live on GitHub Pages & packaged for itch.io)

---

## 1. EXECUTIVE SUMMARY & BUILD STATE

On September 13, 2026, **Valleyball** graduated from an experimental movement/physics sandbox into **Valleyball Versus (v0.2.0)**: a feature-complete 1v1 splitscreen arcade sports game.

The working tree has been audited, tested, committed (`690f30d`, `b5339dd`), tagged (`v0.2.0`), merged across `demo-update` and `main`, deployed live to GitHub Pages (`origin/gh-pages`), and packaged into a self-contained relative-base archive for itch.io (`release/valleyball-versus-itch.zip`).

### Key Vital Signs
- **Engine**: Three.js (r185.1) + Rapier3D (`@dimforge/rapier3d-compat` 0.19.3) + Vite (8.2.2).
- **Framerate**: Locked 60+ FPS on mid-range hardware and dual-camera splitscreen viewports.
- **Verification Suites**:
  - Headless determinism tests (`scripts/determinism.mjs`).
  - Automated match scoring test (`scratch/test_goal_switching_logic.mjs` — 100% pass).
  - Playwright visual test suite (`scratch/verify_bw_theme.mjs` — 8 screens verified).
  - Production preview verification (`scratch/test_dist.mjs`, `scratch/test_dist_itch.mjs` — 0 errors).

---

## 2. PHASE 4 POST-MORTEM: BREAKTHROUGHS & TRIUMPHS

### 2.1 The Decoupled Micro-Clock Overlay (Eliminating the 1s PCIe Texture Hitch)
**The Problem**:
During test matches, a consistent micro-stutter occurred precisely on every second tick (`04:59` $\to$ `04:58`). Investigation of the WebGL rendering pipeline revealed that four massive stadium jumbotrons ($1024 \times 512$ and $2048 \times 256$) and two hustle boards ($1024 \times 640$) were redrawing their entire 2D canvases and invoking blocking `gl.texImage2D` calls to upload over **$13.6\,\text{MB}$ of uncompressed pixel buffers** across the PCIe bus every single second. Even when spread over consecutive frames via display coordinators, this triggered continuous pipeline flushes during splitscreen rendering.

**The Solution**:
We decoupled fast-ticking telemetry from static display geometry:
1. **Event-Driven Backplates**: Stadium backplate canvases now only redraw when state actually changes (a goal is scored, teams swap ends, or kit colors mutate). During standard play, **zero backplate uploads occur**.
2. **Shared Micro-Clock Canvas Overlay**: Created a tiny, dedicated $256 \times 64$ canvas (`clockCanvas`, $65\,\text{KB}$ payload) mapped to an independent `MeshBasicMaterial` with `transparent: true`.
3. **Single Texture Instance**: Mounted as a child `PlaneGeometry` overlay 2cm in front of each board surface. **All four stadium scoreboards share the exact same material and texture instance**.
4. **Impact**: Reduced per-second texture upload bandwidth by **99.5%** ($13.6\,\text{MB} \to 65\,\text{KB}$), completely eradicating the 1-second hitch.

### 2.2 Universal Dynamic Target Goal Switching
**The Problem**:
Legacy builds had hardcoded logic that forced `targetGoal = GOAL_N` and assumed `scoredForHome = (goalId === GOAL_N)`. This prevented the fundamental rule of Valleyball from functioning: ends must flip after every scored goal.

**The Solution**:
Standardized the universal scoring invariant in `src/mechanics/scoring.js`:
```javascript
const scoredForHome = (state.targetGoal === goalId);
if (scoredForHome) state.scoreHome += 1;
else state.scoreAway += 1;

// Unconditional end swap after any scored goal
state.targetGoal = oppositeGoal(state.targetGoal);
```
All connected subsystems respond synchronously to this single source of truth:
- Stadium North/South end boards invert their `ATTACKING GOAL` banners and team colors.
- East/West ribbon boards flip their directional arrows.
- Player cameras dynamically re-bias their tracking offset toward the player's updated attacking hoop.
- Court circle sensors dynamically track `Own Circle (Defense)` vs `Opp Circle (Attack)`.

### 2.3 Splitscreen Viewport Scissor Engine
Implemented dual-player splitscreen using Three.js scissor testing in `src/main.js`:
- Each frame splits the canvas into two independent viewports (`renderer.setScissorTest(true)`):
  - Left Viewport: Player 1 (Home Athlete), biased toward P1's target hoop.
  - Right Viewport: Player 2 (Away Athlete), biased toward P2's target hoop.
- Input is cleanly routed via `src/input/inputRouter.js`, allowing Gamepad 0 vs Gamepad 1, Gamepad vs Keyboard, or Split-Keyboard (WASD vs IJKL).

### 2.4 Multi-Athlete Manager & Physique Customization
Encapsulated character instances into `src/sim/athlete.js`. Each athlete manages its own:
- Rapier sphere motor (`sim/motor.js`).
- Kinematic ghost mixer (`sim/animtarget.js`).
- Active ragdoll with 16 rigid bodies (`sim/ragdoll.js`).
- World-space PD tracker with inverted pendulum pelvis boost (`sim/tracker.js`).
- Three selectable physique archetypes:
  - `Classic`: Standard balanced athletic frame.
  - `Masculine`: Broadened shoulders and heavier presence.
  - `Feminine`: Agile, sleek, sharp profile.
Physique scaling adjusts bone scales and ragdoll colliders at construction time without corrupting the derived Mixamo bind matrices.

### 2.5 Visual Identity: Black & White with Iridescent Accents
Replaced legacy saturated red/blue menu chrome with a high-contrast aesthetic:
- **Obsidian Glass Panels**: `rgba(11, 17, 26, 0.78)` backdrops with subtle 1px white borders.
- **Hero Action Buttons**: Pure `#ffffff` fills, `#000000` heavyweight typography, and dual-chroma rainbow bloom.
- **Brand Lockup**: 3D match ball slowly spinning in real time above the rainbow Valleyball emblem.
- **The Hustle Board**: 10 post-match performance metrics organized in a pure ROYGBIV rainbow spectrum with dark blue touches.

### 2.6 Dual-Deployment Distribution Pipeline
Architected a two-tier release pipeline:
- **GitHub Pages**: Deployed via `npm run deploy` (`gh-pages -d dist`) with `base: '/Valleyball-Versus/'`.
- **itch.io**: Packaged via `npm run package:itch` (`scripts/package_itch.mjs`) into `release/valleyball-versus-itch.zip` using relative `base: './'` so assets load seamlessly inside iframe embeds.

---

## 3. THE 7 INVARIANT LAWS OF VALLEYBALL

Incoming models and developers must treat these laws as non-negotiable architectural constraints.

### Law 1 — Physics owns momentum; animation owns pose
The athlete root is a dynamic Rapier sphere driven **strictly by torque and force**. Never write position or velocity to an athlete rigid body during active play (`setTranslation` / `setLinvel` are strictly forbidden outside sanctioned spawn/teleport handlers). Knock down an athlete, and the sphere preserves its real velocity.

### Law 2 — World-space PD tracking only
No joint motors or internal joint-space servos. Each ragdoll body receives a mass-scaled linear impulse toward its ghost target and an angular impulse from the shortest-arc quaternion error. Both sample pre-impulse states and pass through the damping clamp.

### Law 3 — Clamped damping discipline
All velocity damping must pass through `applyClampedDamping`. It is mathematically constrained to cancel motion at most; it can never inject energy or reverse velocity. The only sanctioned exception is `applyArmDamping` in `tracker.js`.

### Law 4 — One blend weight; no boolean character states
`tracker.weight` (0..1) is the sole authority on balance. Blend shares sum to 1.0 continuously: `stand-up > action (slide / dive / strike) > airborne > locomotion + idle`. Mechanics track phase floats (`slidePhase`, `divePhase`) and tick timestamps (`lastJumpTick`), never discrete boolean states.

### Law 5 — No root motion
The horizontal axes of the hips bone are pinned to bind space every tick. Local horizontal axes are derived (`hipsAxisRoles`), never hardcoded. Residual root motion must remain strictly `0.0000 m`.

### Law 6 — Absolute determinism
Simulation steps at fixed 60 Hz dt (`1/60`s). `sim/` and `mechanics/` must **never read wall clocks** (`Date.now()`, `performance.now()`, or unseeded `Math.random()`). All timers are measured in discrete integer ticks.

### Law 7 — Decoupled Rendering Invariant (New in v0.2.0)
High-frequency telemetry (clocks, scores, speedometers) must never force re-renders or texture re-uploads of large static background meshes. Fast-updating UI elements must live in separate lightweight micro-canvases, DOM overlays, or shared low-resolution texture planes.

---

## 4. CODEBASE DIRECTORY ANATOMY

```
C:\Users\portt\Dev\Valleyball\Valleyball-Demo\
├── public/                 # Static assets (copied verbatim to dist/)
│   ├── audio/              # Sound effects (synthesized & recorded WAVs)
│   ├── models/             # arena.glb, character.glb, actions.glb
│   └── textures/           # Ball textures, emissive maps, previews
├── scripts/                # Verification, generation, and packaging tools
│   ├── determinism.mjs     # Headless Rapier physics determinism test
│   ├── generate_ball_textures.mjs
│   ├── generate_sports_sfx.mjs
│   ├── measure_clips.mjs   # Animation rig & root-motion validator
│   ├── package_itch.mjs    # Builds & zips relative-base bundle for itch.io
│   └── scenario.mjs        # Scenario test runner
├── src/
│   ├── audio/
│   │   └── soundManager.js # Procedural WebAudio & positional SFX engine
│   ├── config/
│   │   └── tuning.js       # LAW 4: The ONE single source of truth for all parameters
│   ├── core/
│   │   └── Loop.js         # Fixed-timestep accumulator (60 Hz tick loop)
│   ├── debug/
│   │   └── gui.js          # lil-gui live parameter tuning harness
│   ├── input/
│   │   └── inputRouter.js  # Abstraction for Gamepads, Split-Keyboard, and hot-swapping
│   ├── mechanics/
│   │   ├── actions.js      # Slides, dives, and aerial transitions
│   │   ├── mountFollower.js# Sphere-to-pelvis constraint follower
│   │   ├── scoring.js      # Goal detection, target switching, and score tracking
│   │   ├── strikes.js      # Strike volumes, sweet-spot detection, impulse transfer
│   │   └── watchdog.js     # Out-of-bounds safety recovery
│   ├── sim/
│   │   ├── animtarget.js   # Kinematic ghost mixer & world-space target generator
│   │   ├── arena.js        # Court colliders, hoop sensors, kill planes
│   │   ├── athlete.js      # Multi-athlete instance controller (P1/P2/physiques)
│   │   ├── autorig.js      # Derives 16-body ragdoll from GLB bind pose
│   │   ├── ball.js         # Rapier sphere ball with spin and restitution
│   │   ├── motor.js        # Dynamic rolling sphere motor & ground ray fan
│   │   ├── physics.js      # Rapier world initialization & collision groups
│   │   ├── ragdoll.js      # 16 rigid bodies, joints, limits, and visual meshes
│   │   └── tracker.js      # World-space PD tracking & pelvis boost
│   ├── ui/
│   │   ├── countdownOverlay.js # Match countdown overlay with chromatic auras
│   │   ├── inGameMenu.js   # Pause menu, settings, keyboard/gamepad navigation
│   │   ├── mainMenu.js     # Title screen, lobby setup, physique selector, controls modal
│   │   └── victoryScreen.js# Match summary, 10-stat Hustle Board, rematch flow
│   ├── visuals/
│   │   ├── brandBall.js    # Spinning 3D title screen match ball
│   │   ├── cinematicCamera.js # Slow arena orbit camera for title screen
│   │   ├── displayCoordinator.js # Staggers heavy texture uploads across frames
│   │   ├── hustleBoards.js # Event-driven in-arena stat jumbotrons
│   │   ├── playerCamera.js # Spring-arm chase camera with target-hoop bias
│   │   ├── scoreboards.js  # Stadium scoreboards with decoupled micro-clock overlays
│   │   └── sportsCamera.js # Broadcast sideline tracking camera
│   └── main.js             # Engine bootstrap, splitscreen scissor loop, state machine
├── release/                # Generated packages and promotional screenshots
│   ├── screenshots/        # itch.io promotional screenshots
│   └── valleyball-versus-itch.zip # Ready-to-upload itch.io game archive
├── AGENTS.md               # Direct guidance instructions for autonomous coding agents
├── index.html              # Canvas container, HUD, and keyboard mapping cards
├── package.json            # Version 0.2.0, dependencies, and build scripts
└── vite.config.js          # Base URL configuration & capture plugin
```

---

## 5. TECHNICAL DEBT & KNOWN HAZARDS

Any model picking up this repository should be aware of these existing rough edges:

1. **Camera Arena Collision / Occlusion**:
   - In tight corners or high wall bounces, the player spring-arm camera can occasionally clip through the upper lip of the bowl arena geometry.
   - *Recommended Solution*: Implement a raycast probe from the athlete pelvis to the desired camera arm position that pulls the camera forward upon intersecting environment colliders.
2. **2v2 Court Congestion & Ball Ownership**:
   - The court and 4 spawn stream heads were authored to accommodate 2v2 play, but strike proximity arbitration currently assumes a 1v1 ball claim. In 2v2, teammate collision and strike priority need explicit arbitration to prevent double-impulse catapult bugs.
3. **Audio Context Autoplay Policy**:
   - WebAudio requires user gesture activation. `soundManager.js` lazily initializes on the first click/keydown, but if a player starts directly with a gamepad without touching the keyboard/mouse, audio might remain suspended until the first DOM interaction.

---

## 6. STRATEGIC ROADMAP FOR INCOMING MODELS

Here are the highest-impact features and systems ready to be tackled next:

### Milestone 1: 2v2 Local Versus Mode (The "Coming Soon" Button)
- **Status**: UI button already exists on the title screen with a `COMING SOON` badge.
- **Implementation**:
  - Extend `inputRouter.js` to manage 4 player slots (`P1`, `P2`, `P3`, `P4`).
  - Spawn 4 athletes via `athlete.js` (2 Home in red, 2 Away in blue/white).
  - Support 4-player splitscreen (quadrant viewports) or a shared dynamic tactical broadcast camera.

### Milestone 2: Autonomous Sparring Bot / AI Opponent
- **Objective**: Allow solo players to play full Versus matches without a couch partner.
- **Architecture**:
  - Author `src/ai/botController.js` feeding synthetic `VirtualInput` into Athlete 2's input stream.
  - Implement a 3-state machine:
    1. *Anticipate / Intercept*: Read ball trajectory from Rapier linear velocity, calculate arrival point at floor height, drive motor torque toward target.
    2. *Position & Jump*: Time jump impulse when ball height matches reach ceiling.
    3. *Strike / Volley*: Trigger North (Spike) or East (Volley) when ball enters sweet spot radius.

### Milestone 3: Netcode / WebRTC Peer-to-Peer Multiplayer
- Because Rapier physics and input frames are strictly deterministic (fixed 60 Hz tick), the game is an ideal candidate for rollback netcode or input-delay lockstep over WebRTC datachannels.

---

*This document stands as the official architectural baseline for Valleyball Versus v0.2.0. Protect the laws, maintain the 60 FPS performance standard, and build boldly.*
