# Valleyball AI Opponent - Project Handover & Release Documentation

## Project State
We are on the `feature/ai-opponents` branch in the `Valleyball-Versus-AI` repository.
The AI Opponent feature is complete, verified, and ready for merge into `main`.

---

## Architectural Summary

### 1. Core AI Systems (`src/ai/`)
*   **Zero Velocity Overrides (LAW 1):** The AI brain generates purely synthetic inputs (`moveX`, `moveZ`, `jump`, `dive`, `action`, `sprint`) written into athlete input slots. It never touches velocity, positions, or internal physics variables directly.
*   **Perception (`botPerception.js`):** Intercept quadratic math, 5-second ballistic trajectory forecasting, goal-side alignment detection, spatial zone classification, and threat assessment. Zero-allocation math on the 60Hz tick path.
*   **Strategy FSM (`botController.js`):** Dynamic arbitration between `CHASE`, `POSITION`, `MULTI_STAGE_ATTACK`, `STRIKE`, `DEFEND`, and `RECOVER`.
    - Integrated defensive safety guard: bots with possession priority never retreat into defense; threat resistance scales with aggressiveness.
    - Direct aggressiveness alignment: slider values (0.1 to 1.0) govern strike range, trigger distance, jump-spike reach, and strike cooldown.
*   **Option B Steering Motor (`botSteering.js`):**
    - **Reynolds Velocity-Space Steering:** Calculates desired velocity $\vec{v}_{\text{desired}} = \hat{d} \cdot v_{\text{top}}$ and applies counter-steering damping $(\vec{v}_{\text{desired}} - \vec{v}_{\text{current}})$ to cancel momentum drift and stop "marble on ice" sliding.
    - **Terrain Contour Banking:** Compensates for 3D valley slopes ($|Z| > 10$) with an uphill banking vector, neutralizing downhill gravity drift during lateral flank maneuvers.
    - **Goal-Aligned Approach Arcs (`steerGoalAlignedApproach`):** Routes athlete onto an approach runway behind the ball co-linear with the goal vector ($\vec{v}_{\text{arr}} \parallel \vec{v}_{\text{shot}}$), driving cleanly through the ball toward the net.

### 2. UI & Match Setup (`src/ui/mainMenu.js`)
*   Player 1 and Player 2 Human vs AI toggles.
*   Difficulty selection: Easy, Medium, Hard (loaded from `src/config/tuning.js`).
*   Aggressiveness slider (0.10 to 1.00) in match setup.
*   AI vs AI Spectator Mode with broadcast camera and fullscreen support.

### 3. Evolutionary Search & Analytics (`scripts/trainBot.mjs`, `scripts/evalMatch.mjs`)
*   Headless deterministic Rapier simulation (`headlessSim.js`).
*   Match analytics evaluator tracking strike accuracy, aerial spikes, volleys, whiffs, own goals, and territory control.
*   `trained_params.json` tuned parameters applied to `TUNING.ai`.

---

## Verification & Compliance Metrics
*   **Own Goals:** Strictly 0.0 across all tested difficulties, ball sizes, and match durations.
*   **Midfield Dives:** Strictly 0.0; dives are reserved for emergency net saves.
*   **Determinism (LAW 6):** 100% bit-identical trajectories verified across 3,600 ticks using seeded headless simulation.
*   **Production Build:** Clean compilation with Vite (`npm run build`).

---

## Ready for Merge to `main`
All requirements for Option B and the AI opponents feature have been satisfied.
