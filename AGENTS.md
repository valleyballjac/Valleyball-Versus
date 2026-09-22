# OPERATIONAL DIRECTIVES FOR AI AGENTS & MODELS

Welcome to the **Valleyball Versus** codebase.
This document provides mandatory operational context, architectural invariants, code conventions, and verification procedures for any AI assistant, autonomous agent, or engineer modifying this repository.

---

## 1. PROJECT ESSENTIALS

- **Title**: Valleyball Versus (v0.2.0)
- **Stack**: Three.js (r185.1), Rapier3D (`@dimforge/rapier3d-compat` 0.19.3), Vite (8.2.2), vanilla modern JavaScript (ES modules).
- **Core Concept**: 1v1 splitscreen arcade sports game featuring physical active ragdolls, high-velocity strikes, dynamic target goal switching, and locked 60+ FPS performance.
- **Working Root**: `C:\Users\portt\Dev\Valleyball\Valleyball-Demo`

---

## 2. THE 7 NON-NEGOTIABLE ARCHITECTURAL INVARIANTS

Every AI model working on this project must respect these laws. Code that violates these invariants must be rejected.

1. **Law 1 — Physics owns momentum; animation owns pose**:
   - The athlete's root is a dynamic Rapier rolling sphere driven **only by torque and impulses**.
   - **NEVER** write position or velocity directly to an athlete body during active play (`setTranslation` and `setLinvel` are forbidden outside sanctioned spawn/teleport sites).
   - Momentum belongs to physics; pose belongs to the kinematic ghost.
2. **Law 2 — World-space PD tracking only**:
   - No joint motors or local-frame servos. Ragdoll bodies chase the ghost via mass-scaled linear and angular impulses sampled *pre-impulse*.
3. **Law 3 — Clamped damping discipline**:
   - All gameplay damping must pass through `applyClampedDamping` (`motor.js` / `damping.js`). Damping impulses can at most cancel motion; they can **never** inject energy or reverse direction.
4. **Law 4 — One blend weight; no boolean character states**:
   - `tracker.weight` (0..1) is the sole balance authority.
   - **Never introduce boolean state machines for the character.** Use continuous phase floats (`slidePhase`, `divePhase`) and integer tick timestamps (`lastJumpTick`).
   - Blend shares must sum to 1.0 continuously: `stand-up > action > airborne > locomotion + idle`.
5. **Law 5 — Zero root motion**:
   - The horizontal axes of the hips bone are pinned to bind space every tick. Residual root motion must remain strictly `0.0000 m`.
6. **Law 6 — Absolute determinism & no wall clocks**:
   - The simulation steps at a fixed 60 Hz dt (`fixedDt = 1/60`).
   - **NEVER use `Date.now()`, `performance.now()`, or unseeded `Math.random()` inside `src/sim/` or `src/mechanics/`.** All timing is measured in integer ticks.
7. **Law 7 — Decoupled rendering invariant**:
   - High-frequency telemetry (clocks, scores, speedometers) must **never** force canvas redraws or texture re-uploads of large static background meshes.
   - Clocks and dynamic text must use dedicated micro-canvases, shared textures, or DOM overlays.

---

## 3. FILE SYSTEM & CODE PLACEMENT RULES

- `src/config/tuning.js`: **The Single Source of Truth.** Every tunable parameter belongs here. Never scatter magic numbers or local constants in other modules.
- `src/sim/`: Physics, athlete rig, motor, ball, and arena collision.
- `src/mechanics/`: Game rules, scoring, goal switching, strike impulse delivery, watchdog.
- `src/input/`: Gamepad and keyboard abstraction layer (`inputRouter.js`).
- `src/ui/`: DOM menus, lobby, HUD overlays, pause screen, and victory stats.
- `src/visuals/`: Cameras, jumbotrons, scoreboards, and stadium effects.
- `src/audio/`: WebAudio sound synthesizer and positional SFX.
- `scripts/`: Offline tools, determinism validators, and packaging scripts.

---

## 4. ASSET & URL CONVENTIONS

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

## 5. STANDARD WORKFLOW COMMANDS

```bash
# Run local dev server (port 5173)
npm run dev

# Run physics determinism verification
npm run determinism

# Build production bundle for GitHub Pages
npm run build

# Deploy to GitHub Pages (gh-pages branch)
npm run deploy

# Package self-contained zip for itch.io
npm run package:itch
```

---

## 6. PRIMARY ROADMAP FOR INCOMING AGENTS

If asked to build new features, prioritize the following architecture-aligned tasks:

1. **2v2 Versus Match Mode**:
   - Add slots for P3/P4 in `src/input/inputRouter.js`.
   - Instantiate 4 athletes via `src/sim/athlete.js` at the 4 pre-measured landmark stream heads in `tuning.js`.
   - Add strike arbitration to prevent teammate double-impulse catapults.
2. **Autonomous Sparring Bot / AI Opponent**:
   - Create `src/ai/botController.js` to drive synthetic input to Player 2.
   - Predict ball landing coordinates using Rapier linear velocity and project sphere motor torque toward the intercept point.
3. **Camera Arena Occlusion**:
   - Add a raycast probe from athlete pelvis to chase camera arm in `src/visuals/playerCamera.js` to prevent clipping through the bowl arena lip.
4. **WebRTC Rollback Netcode**:
   - Build a peer-to-peer network layer syncing discrete 60 Hz input frames.

---

## 7. CANONICAL GAMEPLAY RULES & SPECIFICATION

Before altering scoring, match flow, spawns, camera bias, or ball physics, read:
📖 **`docs/VALLEYBALL_GAMEPLAY_SOURCE_OF_TRUTH.md`**

This document governs the official rules of the sport:
- **Continuous Momentum**: Play never pauses on a goal; the ball remains live in physics.
- **Dynamic Goal Switching**: Ends unconditionally invert immediately after any scored goal.
- **Spawns & Kickoff**: Elevated stream head spawns and randomized field ball drop.
- **Tackling & Possession**: 100% legal full-contact collisions with free arcade possession.
- **Ball Profiles**: Small (speed), Medium (official standard), Large (heavy inertia).
- **Match Time & Resolution**: Strictly 5-minute regulation with draw / overtime options.

---

## 8. VERSION BUMPING & IN-GAME LABELING DISCIPLINE

Whenever starting work on a new version or forking from a public release:
1. **`package.json`**: Immediately bump the `"version"` field (e.g. `0.2.3`).
2. **`index.html`**: Update the version badge on the loading screen (`<span ...>v0.2.3</span>`).
3. **`src/features/ui/mainMenu/titleScreen.js`**: Update the version badge next to the `VERSUS` tag on the main title screen.
4. **`src/ui/inGameMenu.js`**: Update the version badge in the in-game settings/pause menu header.
5. Never leave stale version numbers on the active development branch so testers and developers always know the exact build they are working on.

---
*Follow the laws, verify with tests, and build upon this solid foundation.*

