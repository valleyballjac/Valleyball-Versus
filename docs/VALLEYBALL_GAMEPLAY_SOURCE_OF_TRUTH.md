# VALLEYBALL: OFFICIAL GAMEPLAY SOURCE OF TRUTH & RULEBOOK

**Version:** 2.1 (v0.4.2.1 Baseline, updated 2026-11-24)  
**Status:** Canonical Design & Rules Contract  
**Audience:** Game Designers, Systems Engineers, Gameplay Programmers, Tournament Organizers, AI Agents  
**Authoritative Location:** `docs/VALLEYBALL_GAMEPLAY_SOURCE_OF_TRUTH.md`

---

## 1. THE ESSENCE OF VALLEYBALL

**Valleyball** is a high-velocity, continuous-momentum, full-contact 3D physics arena sport. It fuses the aerial trajectory reading of volleyball, the ground challenges and sliding tackles of street soccer, and the banked-surface momentum of sloped-bowl sports.

### The Golden Rule: Continuous Momentum
Unlike traditional sports, **Valleyball never pauses after a goal**. There is no whistle, no stoppage, no reset to midfield, and no dead-ball re-serve. When a goal is scored, play continues uninterrupted. The ball remains live in physics, the scoreboards flash, and attacking ends immediately invert. Players must instantly pivot from offense to defense in a continuous flow of athletic play.

---

## 2. THE ARENA & COURT GEOMETRY

The game is played inside the canonical authored Valley Court (`public/models/arena.glb`), a sunken sloped bowl enclosed by continuous perimeter glass.

```
                  [ NORTH HOOP (z = -40m, y = 10m) ]
                     [ NORTH STREAM HEADS: NW / NE ]
               ┌─────────────────────────────────────────┐
               │                                         │
               │         ( NORTH CIRCLE: ATTACK / DEF )  │
               │                   r = 18m               │
               │                                         │
               │                  MIDFIELD               │
               │             (Random Ball Drop)          │
               │                                         │
               │         ( SOUTH CIRCLE: ATTACK / DEF )  │
               │                   r = 18m               │
               │                                         │
               └─────────────────────────────────────────┘
                     [ SOUTH STREAM HEADS: SW / SE ]
                  [ SOUTH HOOP (z = +40m, y = 10m) ]
```

### 2.1 The Goal Hoops
- **Geometry**: Vertical tori centered in the `x = 0` plane at elevation `y = 10.0m`.
  - **Goal North**: `(0, 10.0, -40.0)`
  - **Goal South**: `(0, 10.0, +40.0)`
  - **Aperture**: Radius `4.667m` (measured off the authored arena asset), tube radius `0.33m`.
- **Aperture Plane**: The ring lies in the `YZ` plane at `x = 0`. The opening faces East-West (`+X / -X`).

### 2.2 Seamless Bowl Architecture
- **In-Play Surfaces**: The court floor, banked bowl walls, perimeter glass, and elevated stream head ramps are **100% legal, active play surfaces**.
- Athletes can ride the banked walls, dive off the elevated ramps, and bank rebounds off any surface.
- **Out of Bounds / Kill Plane**: If a ball or athlete falls below `y < -20.0m`, the watchdog system instantly catches and restores them to active play.

### 2.3 Court Circles (North & South Zones)
- Two `18m` radius circles are painted on the arena floor (centered near North and South).
- **Role**: Spatial telemetry and tactical awareness. Touching the ball inside a circle logs `Own Circle (Defense)` or `Opp Circle (Attack)` on the Hustle Board.
- **Scoring Value**: Goals scored from anywhere on court (inside or outside the circles) are worth **1 point**.

---

## 3. MATCH FORMAT, TIMING, & SPAWNS

### 3.1 Match Duration & Clock
- **Supported Match Lengths**: Configurable in Match Rules: `3:00` (fast arcade), **`5:00` (official tournament default)**, or `10:00` (extended).
- **Clock Engine**: Decremented per fixed step at 60 Hz (`300 * 60 = 18,000` ticks for a 5-minute match). The clock pauses only when the simulation itself is paused (e.g., pre-match countdown or Overtime Menu).
- **Opening Countdown**: A pre-match countdown holds the clock at full time while players orient on their stream heads.

### 3.2 Opening Spawns (Stream Heads)
Athletes spawn elevated on the landmark stream heads opposite the goal they are attacking:
- **1v1 Match (Home attacks North `-Z`, Away attacks South `+Z`)**:
  - **Home Athlete**: Spawns on a South stream head (`SW` or `SE`, `z ≈ +40m`), facing North (`yaw = PI`).
  - **Away Athlete**: Spawns on a North stream head (`NW` or `NE`, `z ≈ -40m`), facing South (`yaw = 0`).
- **2v2 Match**:
  - **Team 1 / Home (P1 & P3)**: Occupy both South stream heads (`SW` and `SE`).
  - **Team 2 / Away (P2 & P4)**: Occupy both North stream heads (`NW` and `NE`).

### 3.3 Opening Kickoff / Ball Drop
- When the match begins, the ball is dropped from `y = 10.0m` inside the court bounds.
- When the countdown hits **"GO!"**, athletes drop down the stream head ramps and race to contest the opening touch.

---

## 4. THE SCORING RULES & TARGET GOAL SWITCHING

### 4.1 Hoop Crossing & Full Ball-Clearance Scoring (`src/mechanics/scoring.js`)
A goal registers ONLY once the entire ball volume crosses the `x = 0` hoop plane (`|pos.x| >= ballRadius`) through a hoop's circular aperture (`r = 4.667m`, `y >= 6.0m`):
- **Universal Entry**: A shot entering from East to West (`+X` to `-X`) or West to East (`-X` to `+X`) is equally valid.
- **Goal-Line Saves**: If a defender swats a partially crossed ball back out before the whole sphere clears `x = 0`, the pending entry resets cleanly with zero goal awarded.
- **Instant Rebound Unthreading**: Because `clearedSide` flips the instant the full ball clears the ring, swatting a scored ball straight back through the hoop immediately scores the responding goal without any artificial re-arm distance, while a slow ball rocking across `x = 0` never clears `|x| >= ballRadius` and never double-scores.

### 4.2 Point Attribution & The Switching Invariant
Point allocation and end rotation follow this strict invariant:

```javascript
// 1. Assign point to whoever was attacking this goal
const scoredForHome = (state.targetGoal === goalId);
if (scoredForHome) state.scoreHome += 1;
else state.scoreAway += 1;

// 2. Unconditional end rotation: ends flip immediately
state.targetGoal = oppositeGoal(state.targetGoal);
```

1. **Initial Orientation**: Matches start with **Home attacking North** (`targetGoal = 'N'`, `z = -40m`) and **Away attacking South** (`targetGoal = 'S'`, `z = +40m`).
2. **Post-Goal Flip**: When a goal is scored in Goal North:
   - Home gets the point (since Home was attacking North).
   - `targetGoal` flips to South (`'S'`).
   - Home is now defending North and attacking South.
   - Away is now defending South and attacking North.
3. **Synchronized Arena Response**:
   - All stadium scoreboards and in-hoop goal indicators invert team colors immediately.
   - Side ribbon boards flip directional attack arrows.
   - Player chase cameras dynamically re-bias tracking toward the player's updated target hoop.

### 4.3 Own Goals & Rebound Shots
- If an athlete knocks the ball into the hoop their team is currently defending, the point is awarded to the opponent (who was designated as attacking that goal).
- Ends flip immediately, ensuring play always flows forward.

---

## 5. POSSESSION, CONTACT, STRIKES, & ASSIST PRESETS

### 5.1 Free Possession
- **Zero Touch Limits**: There are no 3-touch limits or double-touch whistles. Athletes can juggle, dribble, wall-pass, or volley repeatedly.

### 5.2 Full-Contact Play
- **Tackling & Knockdowns**: Physical collisions, slide tackles (`C` / `RT`), diving challenges (`Q` / `X`), and directional cuts (`V` or `F` / `RB`) are **100% legal**.
- Knocking down an opponent or dispossessing them with a clean slide is a core defensive tool. There are no fouls, cards, or penalty kicks.

### 5.3 Strikes & Sweet-Spot Timing (`src/config/tuning.js`)
- **Volley / Kick (`E` / `B` / Left Click)**: Ground kick (sweet spot at 8 ticks) or underhand/horizontal volley (sweet spot at 15 ticks) for controlled clears, passes, and angled shots.
- **Power Spike (`R` / `Y` / Right Click)**: Overhand aerial strike (sweet spot at 42 ticks).
- **Timing Curve**: Strikes timed within 5 ticks of the sweet spot deliver full 1.0 contact quality, tapering smoothly down to a 35% floor at 12 ticks.
- **Assist Presets (Selectable Per Player in Setup)**:
  - **Standard (Official Tournament Default)**: `assistRadius: 0.45m`, `assistWindowTicks: 6`, `aimMagnetism: 0.0`. Rewards clean positioning and timing while forgiving near-miss limb gaps; zero aim magnetism.
  - **Pure Sim**: `assistRadius: 0.0m`, `aimMagnetism: 0.0`. Strict physical limb collision only (available in tournaments by mutual agreement).
  - **Casual**: `assistRadius: 0.65m` plus 360-degree right-stick aim steering for newcomers.

---

## 6. CONTINUOUS PLAY & BOUNDARY RECOVERY

### 6.1 Out-of-Bounds Ball Respawn
- The sloped Valley Court floor and curved glass walls prevent dead-ball stalls naturally, so there is no mid-court stagnant-ball timer or stoppage.
- If a ball ever escapes court bounds (`y < killPlaneY`, `|x| > 33m`, or `|z| > 68m`), the watchdog immediately re-drops it from ceiling height (`y = 10.0m`) inside the field of play without pausing the match clock.

---

## 7. MATCH BALL TYPES & PHYSICS

The match host selects the match ball in Match Rules (`Random`, `Medium`, `Small`, or `Large`). All ball types score **1 point per goal**, while changing pace and trajectory:

| Ball Type | Diameter | Radius | Mass | Restitution | Friction | Character & Tactical Role |
|---|---|---|---|---|---|---|
| **Medium (Regulation Default)** | `1.0m` | `0.50m` | `2.20 kg` | `0.88` | `0.80` | **Official Tournament Standard**: Balanced weight, readable arcs, clean volley and spike response. |
| **Small (Foot Ball)** | `0.4m` | `0.20m` | `0.84 kg` | `0.88` | `0.80` | **High-Precision Challenge**: Compact, dense, rapid rebounds, rewarding tight footwork and reflexes. |
| **Large (Big Ball)** | `1.5m` | `0.75m` | `3.89 kg` | `0.85` | `0.85` | **Big-Rally Crowd Favorite**: Huge volume, skyward bounce, extended airborne rallies (optional for casual or 2v2 play). |

---

## 8. MATCH RESOLUTION & OVERTIME

### 8.1 Regulation End
When `ticksRemaining` reaches `0`:
- If one team leads, the arena buzzer sounds and the match transitions to the **Victory Screen** showing team and individual Hustle stats.
- If the score is **tied**, physics freezes in place and opens the **Overtime Agreement Menu**.

### 8.2 Overtime Agreement Menu (Shipped in v0.4.1)
On a tied match, players choose:
- **Format**:
  - **Golden Goal (Official Tournament Default)**: Sudden death; next goal wins immediately.
  - **Timed Overtime**: Extra period of `1:00`, `2:00`, `3:00`, or `5:00`.
  - **Accept Draw**: Concludes the match as a tie.
- **Positioning**:
  - **Respawn at Defending Goals (Official Tournament Default)**: Resets athletes onto stream heads aligned with each team's current attacking/defending end and drops the ball at midfield after a countdown.
  - **Resume Live in Place**: Unfreezes exact court positions and velocities immediately.

---

## 9. THE HUSTLE BOARD (POST-MATCH TELEMETRY)

Performance is evaluated across 10 stats presented in a **ROYGBIV spectrum** (both collective team totals and individual player breakdowns in 2v2):

1. **Red (`#ef4444`) : Goals**: Total goals scored.
2. **Coral (`#f43f5e`) : Power Spikes**: Overhand aerial spike executions.
3. **Orange (`#fb923c`) : Opp Circle (Attack)**: Ball touches inside the opponent's defensive circle.
4. **Yellow (`#ffd60a`) : Sweet Spot Hits**: Strikes executed within the optimal contact window.
5. **Green (`#22c55e`) : Strikes (Hits/Whiffs)**: Total strike attempts connected vs missed.
6. **Mint (`#10b981`) : Own Circle (Defense)**: Ball touches inside the team's defensive circle.
7. **Cyan (`#38bdf8`) : Strike Accuracy**: Percentage of strike attempts that successfully connected.
8. **Dark Blue (`#2563eb`) : Touches**: Total physical ball interactions across the match.
9. **Purple (`#8b5cf6`) : Ground Dives**: Total diving challenges initiated.
10. **Pink (`#ec4899`) : Diving Hits / Saves**: Balls struck or deflected while in an active dive.

---

*This document is the canonical source of truth for Valleyball gameplay mechanics and matches the shipped v0.4.1 / v0.4.2 build.*
