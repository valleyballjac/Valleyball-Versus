# OPERATIONAL DIRECTIVES FOR AI AGENTS & MODELS

Welcome to the **Valleyball Versus** codebase.
This document provides mandatory operational context, architectural invariants, code conventions, and verification procedures for any AI assistant, autonomous agent, or engineer modifying this repository.

> **Native Antigravity Skill**: If operating within Google Antigravity, activate the dedicated workspace skill:  
> `.agents/skills/valleyball-guide/SKILL.md` (and sub-modules in `references/`).

---

## 1. PROJECT ESSENTIALS

- **Title**: Valleyball Versus (v0.3.7)
- **Stack**: Three.js (r185.1), Rapier3D (`@dimforge/rapier3d-compat` 0.19.3), Vite (8.2.2), vanilla modern JavaScript (ES modules).
- **Core Concept**: Pure physics sports simulation featuring physical active ragdolls, mass-normal strikes, zero artificial ball magnetism, dynamic target goal switching, and locked 60+ FPS performance.
- **Working Root**: This repository. On Jac's laptop that is `C:\Users\portt\Dev\Valleyball\Valleyball-Versus-AI`.
- **Canonical Arena**: The **Valley Court** (`public/models/arena.glb`) is the sole canonical arena. The procedural test bowl is **permanently retired**.
- **Arena Source of Truth**: `arena.glb` itself. Since v11.1, collider fixes have been scripted patches to the GLB (`scripts/flip_inverted_corners.mjs`, `scripts/weld_barrier_tjunctions.mjs`, `scripts/arena_*.mjs`), and the Blender sources for v10.0 and later are not in this repo. **Never re-export the arena from a `.blend` without porting those fixes**, or they will be silently undone.
- **Roadmap**: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## 2. THE SPORT DOCTRINE

1. **Simulation First**: Valleyball Versus is strictly a physical simulation. It does not compromise its physics to chase arcade shortcuts. **Standard** (`assistRadius: 0.45`, `assistWindowTicks: 6`, `aimMagnetism: 0.0`) is the default out-of-the-box experience: a swing timed within 6 ticks of the sweet spot also connects with a ball up to 0.45 m from the striking limb, so a near miss is not silently ignored. There is still no aim magnetism. **Pure Sim** (`assistRadius: 0.0`, `aimMagnetism: 0.0`) is the hardcore option for players who want the challenge: the ball is struck only on real limb contact. Each player picks a preset on the player setup screen.
2. **No Out-of-Bounds**: The court is enclosed by continuous perimeter glass. The ball is **always live**. There are no throw-ins or sideline stops.
3. **No Referee Whistles**: Play flows continuously. Player collisions are resolved physically through Rapier rigid-body impulses.
4. **Positioning Over Aim Assist**: Physical strike exit angles depend on where the athlete makes physical contact with the ball. The **Cut mechanic** (`KeyV` / `RB`) provides the plant-and-redirect agility to position behind the ball.
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
- `src/ui/`: In-match DOM: HUD overlays, pause menu, countdown, and victory stats.
- `src/features/ui/mainMenu/`: Title screen, lobby, player setup, controller assignment, and How to Play.
- `src/features/`: Athlete roster, match lifecycle, and fixtures (`?fixture=`). `src/main.js` still owns much of this logic; see the roadmap.
- `src/ai/`: Bot brain, perception, steering, and the headless simulation used for evaluation and training.
- `src/visuals/`: Cameras, jumbotrons, scoreboards, turf particles, and goal celebration effects.
- `src/audio/`: WebAudio sound synthesizer and positional SFX.
- `scripts/`: Offline tools, determinism validators, bot training, arena patches, and packaging scripts.
- `docs/`: The roadmap and the rules of the sport. Finished handovers and reviews go in `docs/archive/`, which also indexes work preserved in git tags.
- `reports/`: Measurement reports.

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

# Run unit tests plus the boundary drop and corner traversal gates
npm test

# Check the audit ratchet (node scripts/audit.mjs --update locks in the current counts, on purpose)
npm run audit

# Run physics determinism verification
npm run determinism

# Play one fixture in the full game, headless (--duration N for a quick check)
npm run fixture

# Run headless match evaluation
npm run eval:match

# Run bot evolutionary training harness
npm run train:bot

# Build, then deploy to GitHub Pages (gh-pages branch)
npm run deploy

# Package self-contained zip for itch.io
npm run package:itch
```

---

## 8. ROADMAP

[`docs/ROADMAP.md`](docs/ROADMAP.md) is the only roadmap. Update it when priorities change, and don't start a new one.

---

## 9. WORKSPACE & BRANCH RULES

1. **`main` is the release line.** Branch from it and fetch first, because more than one clone pushes to it. Pushing, merging to `main`, deploying, and publishing all need Jac's explicit go-ahead.
2. **Game fixes never go on tooling branches.** Trailer, capture, and experiment branches drift from `main`, and fixes stranded on them have to be rescued later. Branch game fixes from `main`.
3. **Remove worktrees when their work lands.** A worktree that outlives its branch's purpose is how this workspace became tangled.
4. **No media in git.** Renders, footage, and deliverables go in `../media`. `captures/` is gitignored scratch output.
5. **No loose handovers.** Put next steps in the roadmap, and put a finished handover in `docs/archive/` with the date in its name.

### Release checklist

1. Run `npm version <x.y.z> --no-git-tag-version`, then update the badge in `index.html`, `titleScreen.js`, `inGameMenu.js`, and the title in this file. `test/version.test.mjs` fails if one is missed.
2. Run `npm test`, `npm run audit`, `npm run determinism`, and `npm run build`. If the audit's size ratchet fails because of intended growth, run `node scripts/audit.mjs --update` and say so in the commit.
3. Play-test anything that touches input with a real controller.
4. With Jac's go-ahead: merge to `main`, tag, push, `npm run deploy`, and `npm run package:itch` for the itch.io upload.
