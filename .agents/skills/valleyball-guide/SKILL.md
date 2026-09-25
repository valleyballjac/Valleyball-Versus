---
name: valleyball-guide
description: Authoritative guide to Valleyball Versus — sport doctrine, physics invariants, athlete motor-ghost-ragdoll architecture, court specs, AI parity, and performance rules. Trigger whenever modifying, debugging, or reviewing Valleyball mechanics, physics, AI, or rendering.
---

# Valleyball Versus — Engineering & Design Guide

Welcome to **Valleyball Versus**, a pure physics sports simulation featuring deterministic active ragdolls, physical ball contact, dynamic hoop scoring, and locked 60 FPS execution.

This skill is the **canonical source of truth** for all human engineers and autonomous AI agents working in this codebase.

---

## 🏛️ Core Pillars at a Glance

1. **Pure Physics Sport Simulation**: No arbitrary arcade shortcuts. No ball magnetism, no artificial trajectory bending, no referee whistles, and no out-of-bounds (glass walls keep play alive).
2. **Three-Tier Athlete Model**:
   $$\text{Dynamic Sphere Motor} \longrightarrow \text{Kinematic Ghost Rig} \longrightarrow \text{PD Ragdoll Tracker}$$
   Ragdoll bodies chase the ghost in world space via pre-impulse PD servos scaled by body mass.
3. **The Single Balance Authority**: One continuous scalar `tracker.weight` ($0.0 \to 1.0$) arbitrates ragdoll tracking stiffness. No boolean character state machines.
4. **Valley Court Standardization**: The authored Valley Court (`public/models/arena.glb`) is the sole canonical arena. The procedural test bowl is permanently retired.
5. **Headless & Visual Simulation Parity**: All offline AI training, testing, and determinism benchmarks run against the exact same court trimesh, mass constants, and physics parameters as the live game.

---

## 📚 Deep-Dive References

Consult the specialized reference modules in `references/` for detailed implementation contracts:

* **[Sport Doctrine & Gameplay Philosophy](./references/sport_doctrine.md)**:
  Rules of the sport, glass boundary continuous play, hoop aperture scoring, positioning-first offensive philosophy, and why defensive blocking must never lock player movement.
* **[The 10 Architectural & Physics Invariants](./references/physics_invariants.md)**:
  Non-negotiable engine laws, clamped damping rules, root motion removal, memory allocation bans in tick loops, GPU jumbotron draw-call budgets, and lessons from failed procedural shoulder IK.
* **[Valley Court Specification & Landmarks](./references/court_spec.md)**:
  Court topography, slope angles, stream channel landmarks, hoop dimensions ($r = 4.667\,\text{m}$), and landmark stream drop spawns.
* **[AI Architecture & Headless Sim Parity](./references/ai_system.md)**:
  Bot perception on slopes, move suite integration (Sprint, Slide, Dive, Cut), fitness functions, and the strict requirement for headless training on real court trimeshes.

---

## 🛠️ Standard Project Commands

```bash
# Start local development server (http://localhost:5173/Valleyball-Versus/)
npm run dev

# Build production bundle
npm run build

# Run deterministic physics verification (must produce byte-identical SHA256)
npm run determinism

# Run headless match evaluation
npm run eval:match

# Run bot evolutionary training harness
npm run train:bot

# Deploy latest build to GitHub Pages
npm run deploy

# Package standalone HTML zip for itch.io
npm run package:itch
```

---

## 🔍 Codebase Map

| Directory | Purpose | Key Rules |
| :--- | :--- | :--- |
| `src/config/tuning.js` | **Single Source of Truth** | All constants, speeds, masses, and timings live here. Zero magic numbers elsewhere. |
| `src/sim/` | Physics & Body Simulation | Motor, autorig, ragdoll tracker, ball resistance, and arena collision. Deterministic 60 Hz. |
| `src/mechanics/` | Gameplay Mechanics | Locomotion actions (slide, dive, cut), strike impulse resolution, scoring, and mount recovery. |
| `src/input/` | Controller Abstraction | Gamepad / Keyboard slot mapping (`inputRouter.js`), buffering, and deadzones. |
| `src/ai/` | Autonomous Opponents | Spatial perception (`botPerception.js`), state machine (`botController.js`), and headless sim. |
| `src/visuals/` | Cameras & VFX | Player chase/broadcast cameras, turf particles, goal celebration, and scoreboard coordinators. |
| `src/audio/` | WebAudio Synthesis | Positional SFX, hoop swishes, impact resonance, and crowd presence. |
