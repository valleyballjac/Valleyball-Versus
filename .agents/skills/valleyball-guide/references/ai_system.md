# AI Architecture & Headless Simulation Parity

## 1. The Headless Simulation Parity Mandate

The Valleyball AI is trained and evaluated using a headless simulation harness (`src/ai/headlessSim.js`, `scripts/trainBot.mjs`, `scripts/evalMatch.mjs`).

### ⚠️ Strict Parity Requirement
* **The Fatal Flaw of Early Bots**: In previous milestones, the AI was trained inside an idealized flat test bowl that diverged completely from the real Valley Court. Consequently, the bots lacked understanding of slopes, mounds, hoop elevations, and court-specific trajectories.
* **The Mandate**: All AI evaluation, perception calculations, and evolutionary training **must run against the exact same Valley Court trimesh and physics constants** used by the real visual client.
* Divergent simulation environments, simplified flat-ground physics, or altered drag/gravity constants for headless training are **strictly forbidden**.

---

## 2. AI Architecture Components

The Valleyball AI operates across four disciplined layers:

```
┌────────────────────────────────────────────────────────┐
│              1. Spatial Perception                     │
│          (src/ai/botPerception.js)                     │
│  - Ball trajectory prediction & ground intercept       │
│  - Valley slope query & elevation delta                │
│  - Goal hoop aperture angle & defensive depth          │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│              2. Tactical Decision                      │
│          (src/ai/botController.js)                     │
│  - State Machine: SERVE, DEFEND, APPROACH, STRIKE, RECOVER
│  - Aerial decision trees (jump-volley vs. spike)       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│              3. Synthetic Athlete Input                │
│             (src/input/inputRouter.js)                 │
│  - Writes to bot input slot (moveWorld, sprint, etc.)   │
│  - Queues athletic triggers: Jump, Dive, Slide, Cut    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│            4. Evolutionary Fitness Scoring             │
│            (src/ai/fitnessFunction.js)                 │
│  - Rewards goals, clean strikes, hoop defense, cuts    │
│  - Penalizes whiffs, tumbling, and overshooting basin  │
└────────────────────────────────────────────────────────┘
```

---

## 3. Utilizing the Full Athletic Moveset

A common failure mode of AI implementations is reducing the bot to simple directional running and striking. The Valleyball AI is architected to utilize the **complete physical moveset**:

1. **Sprint Commitment & Carving**:
   - The bot should engage `sprintHeld` when closing large distances across court, while accounting for the physical turning radius (arc commitment).
2. **The Cut Mechanic (`KeyV` / `LB` / `queueBotAction(slot, 'cut')`)**:
   - On the sloped mounds and high-velocity descents, turning purely via steering causes sliding and drift.
   - The bot must execute **Cuts** to plant cleats into the turf, instantly kill momentum, and reverse heading to line up physical strikes.
3. **Slides & Dives**:
   - Grounder balls and low-trajectory shots below hip level should trigger dives or slides, using the athlete's extended mass as a recovery scoop.
4. **Aerial Spikes**:
   - Elevated balls in the attacking half should trigger timed jump-spikes at the apex of the jump arc.

---

## 4. Headless Training Harness (`scripts/trainBot.mjs`)

* **Execution**:
  ```bash
  npm run train:bot
  ```
* **Algorithm**: Genetic algorithm optimizing parameter weights in `trained_params.json`.
* **Fitness Metric**:
  $$\text{Fitness} = \text{Goals} \times 100 + \text{On-Target Shots} \times 20 + \text{Interceptions} \times 10 - \text{Whiffs} \times 15 - \text{Tumble Ticks} \times 0.5$$
* After retraining, bots must be evaluated in head-to-head matches (`npm run eval:match`) to confirm tangible improvement against the baseline controller on the Valley Court.
