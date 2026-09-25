# OPERATIONAL DIRECTIVES FOR AI AGENTS & MODELS

Welcome to the **Valleyball Versus** codebase.
This document provides mandatory operational context, architectural invariants, code conventions, and verification procedures for any AI assistant, autonomous agent, or engineer modifying this repository.

> **Native Antigravity Skill**: If operating within Google Antigravity, activate the dedicated workspace skill:  
> `.agents/skills/valleyball-guide/SKILL.md` (and sub-modules in `references/`).

---

## 1. PROJECT ESSENTIALS

- **Title**: Valleyball Versus (v0.2.3)
- **Stack**: Three.js (r185.1), Rapier3D (`@dimforge/rapier3d-compat` 0.19.3), Vite (8.2.2), vanilla modern JavaScript (ES modules).
- **Core Concept**: Pure physics sports simulation featuring physical active ragdolls, mass-normal strikes, zero artificial ball magnetism, dynamic target goal switching, and locked 60+ FPS performance.
- **Working Root**: `C:\Users\portt\Dev\Valleyball\Valleyball-Demo`
- **Canonical Arena**: The **Valley Court** (`public/models/arena.glb`) is the sole canonical arena. The procedural test bowl is **permanently retired**.

---

## 2. THE SPORT DOCTRINE

1. **Simulation First**: Valleyball Versus is strictly a physical simulation. It does not compromise its physics to chase arcade shortcuts. Pure Sim (`assistRadius: 0.0`, `aimMagnetism: 0.0`) is the default out-of-the-box experience.
2. **No Out-of-Bounds**: The court is enclosed by continuous perimeter glass. The ball is **always live**. There are no throw-ins or sideline stops.
3. **No Referee Whistles**: Play flows continuously. Player collisions are resolved physically through Rapier rigid-body impulses.
4. **Positioning Over Aim Assist**: Physical strike exit angles depend on where the athlete makes physical contact with the ball. The **Cut mechanic** (`KeyV` / `LB`) provides the plant-and-redirect agility to position behind the ball.
5. **Defense Must Never Lock Movement**: Any future defensive mechanic (such as blocks or braces) **must never lock the athlete into a frozen pose or restrict locomotion**. Athletes must remain agile and mobile at all times.

---

## 3. THE 10 NON-NEGOTIABLE ARCHITECTURAL INVARIANTS

Every AI model working on this project must respect these laws. Code that violates these invariants must be rejected.

1. **Law 1 — Physics owns momentum; animation owns pose**:
   - The athlete's root is a dynamic Rapier rolling sphere driven **only by torque and impulses**.
   - **NEVER** write position (`setTranslation`) or velocity (`setLinvel`) directly to an athlete body during active play.
   - Physical strike impulses are applied **to the ball**, never directly to the striking hand or athlete root.
2. **Law 2 — World-space PD tracking only**:
   - No joint motors or local-frame servos. Ragdoll bodies chase the ghost via mass-scaled linear and angular impulses sampled *pre-impulse*.
3. **Law 3 — Clamped damping discipline**:
   - All gameplay damping must pass through `applyClampedLinearDamping` and `applyClampedAngularDamping` (`src/sim/damping.js`). Damping impulses can at most cancel motion; they can **never** inject energy or reverse direction.
4. **Law 4 — One blend weight; no boolean character states**:
   - `tracker.weight` (0..1) is the sole balance authority.
   - **Never introduce boolean state machines for the character.** Use continuous phase floats (`slidePhase`, `divePhase`) and integer tick timestamps (`lastJumpTick`).
   - Blend shares must sum to 1.0 continuously: `stand-up > action > airborne > locomotion + idle`.
5. **Law 5 — Zero root motion**:
   - The horizontal axes of the hips bone are pinned to bind space every tick. Residual horizontal root motion must remain strictly `0.0000 m`.
6. **Law 6 — Absolute determinism & no wall clocks**:
   - The simulation steps at a fixed 60 Hz dt (`fixedDt = 1/60`).
   - **NEVER use `Date.now()`, `performance.now()`, or unseeded `Math.random()` inside `src/sim/`, `src/mechanics/`, or `src/ai/`.** All timing is measured in integer ticks.
   - Determinism verification (`npm run determinism`) must produce byte-identical SHA-256 hashes on the Valley Court.
7. **Law 7 — Decoupled rendering invariant**:
   - High-frequency telemetry (clocks, scores, speedometers) must **never** force canvas redraws or texture re-uploads of large static background meshes.
8. **Law 8 — Jumbotron upload budget (Zero Goal GPU Stalls)**:
   - Flashing scoreboards during goals must be animated via material emissive/color uniforms, **never** by triggering multi-canvas 2D redraws and synchronous `gl.texImage2D` uploads on the goal frame. Strictly observe the `displayCoordinator` upload budget (max 1 upload per frame).
   - Pre-warm all celebration lights at boot; never toggle dynamic `PointLight.visible` at runtime to prevent shader recompilation stalls.
9. **Law 9 — Procedural IK limitations on Mixamo armatures**:
   - Do not attach procedural reaching IK to Mixamo shoulder bones without dedicated, authored base poses and explicit joint angle limits. Unconstrained reaching creates 180° quaternion singularities and violent ragdoll flailing.
10. **Law 10 — Court floor trimesh weld (`FIX_INTERNAL_EDGES`)**:
    - All playing court surface trimeshes must be initialized with `RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES` to weld adjacent coplanar edges and prevent phantom deceleration/rebound spikes.
    - Raised line decals (`M_Lines*`) must remain classified as **scenery / render-only** and excluded from physics colliders.

---

## 4. MEMORY & ZERO ALLOCATION IN TICK LOOPS

- **Forbidden**: Never allocate `new THREE.Vector3()`, `new THREE.Quaternion()`, `new Array()`, or inline lambda closures inside `fixedUpdate`, `applyTracking`, `runActions`, or `runStrikes`.
- Use module-scoped scratch variables (`_v1`, `_q1`, `_matrix`) initialized at file load time.

---

## 5. FILE SYSTEM & CODE PLACEMENT RULES

- `src/config/tuning.js`: **The Single Source of Truth.** Every tunable parameter belongs here. Never scatter magic numbers or local constants in other modules.
- `src/sim/`: Physics, athlete rig, motor, ball, and arena collision.
- `src/mechanics/`: Game rules, scoring, goal switching, strike impulse delivery, mount recovery.
- `src/input/`: Gamepad and keyboard abstraction layer (`inputRouter.js`).
- `src/ui/`: DOM menus, lobby, HUD overlays, pause screen, and victory stats.
- `src/visuals/`: Cameras, jumbotrons, scoreboards, turf particles, and goal celebration effects.
- `src/audio/`: WebAudio sound synthesizer and positional SFX.
- `scripts/`: Offline tools, determinism validators, bot training, and packaging scripts.

---

## 6. ASSET & URL CONVENTIONS

Valleyball uses a dual-deployment pipeline:
- GitHub Pages is served from base `/Valleyball-Versus/`.
- itch.io is served from relative base `./`.

**Rule**: **NEVER hardcode asset paths like `/models/arena.glb` or `/textures/ball.png`.**
Always wrap asset paths in `assetUrl(path)` from `src/config/tuning.js`:
```javascript
import { assetUrl } from '../config/tuning.js';
const url = assetUrl('models/character.glb');
```

---

## 7. STANDARD WORKFLOW COMMANDS

```bash
# Run local dev server (port 5173)
npm run dev

# Build production bundle
npm run build

# Run physics determinism verification
npm run determinism

# Run headless match evaluation
npm run eval:match

# Run bot evolutionary training harness
npm run train:bot

# Deploy to GitHub Pages (gh-pages branch)
npm run deploy

# Package self-contained zip for itch.io
npm run package:itch
```

---

## 8. PRIMARY ROADMAP FOR INCOMING AGENTS (v0.2.4 Priority)

1. **AI Retraining & Valley Court Parity (#1 Priority for v0.2.4)**:
   - Ensure `src/ai/headlessSim.js` and `scripts/trainBot.mjs` evaluate on the exact Valley Court trimesh.
   - Teach bot perception about court slopes, basin elevation, and hoop apertures.
   - Integrate the **Cut mechanic** (`KeyV` / `LB`) into bot decision trees for rapid slope braking and reversal.
2. **Performance Polish on Goals**:
   - Refactor `src/visuals/scoreboards.js` celebration flashing to use emissive material uniforms instead of multi-jumbotron 2D canvas redraws.
   - Pre-warm `goalCelebration.js` point light to eliminate shader recompilation hitches.
3. **Sport Ceremony & Match Presentation**:
   - Implement kickoff ritual (players setting up on their respective halves, camera framing, ball spawning from high stream drop).
   - Match conclusion presentation (athletes transitioning into post-match postures, broadcast camera wide shot, victory telemetry).
4. **Defensive Mechanics (When Offensive Positioning is Ready)**:
   - Re-approach defense as an agile physical brace that **never locks player locomotion**.
