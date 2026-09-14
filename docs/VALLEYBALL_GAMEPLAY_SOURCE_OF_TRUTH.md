# VALLEYBALL — OFFICIAL GAMEPLAY SOURCE OF TRUTH & RULEBOOK

**Version:** 1.0 (v0.2.0 Baseline)  
**Status:** Canonical Design & Rules Contract  
**Audience:** Game Designers, Systems Engineers, Gameplay Programmers, AI Agent Architects  
**Authoritative Location:** `docs/VALLEYBALL_GAMEPLAY_SOURCE_OF_TRUTH.md`

---

## 1. THE ESSENCE OF VALLEYBALL

**Valleyball** is a high-velocity, continuous-momentum, full-contact 3D arcade arena sport. It fuses the aerial trajectory tracking of volleyball, the ground combat and sliding tackles of street soccer, and the kinetic wall-riding physics of extreme sports.

### The Golden Rule: Continuous Momentum
Unlike traditional sports, **Valleyball never pauses after a goal**. There is no whistle, no stoppage, no reset to midfield, and no dead-ball re-serve. When a goal is scored, play continues uninterrupted. The ball remains live in physics, the scoreboard flashes, and attacking ends immediately invert. Players must instantly pivot from offense to defense in a continuous flow of athletic play.

---

## 2. THE ARENA & COURT GEOMETRY

The game is played inside a seamless sunken bowl arena.

```
                  [ NORTH HOOP (z = +40m, y = 10m) ]
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
                  [ SOUTH HOOP (z = -40m, y = 10m) ]
```

### 2.1 The Goal Hoops
- **Geometry**: Vertical tori centered in the `x = 0` plane at elevation `y = 10.0m`.
  - **Goal North**: `(0, 10.0, +40.0)`
  - **Goal South**: `(0, 10.0, -40.0)`
  - **Aperture**: Radius $\approx 5.0\text{m}$, tube radius $0.33\text{m}$.
- **Aperture Plane**: The ring lies strictly in the `YZ` plane at `x = 0`. The opening faces East-West ($\pm X$).

### 2.2 Seamless Bowl Architecture
- **In-Play Surfaces**: The court floor, the banked bowl walls, and the elevated stream head ramps are **100% legal, active play surfaces**.
- Athletes can ride the banked walls, dive off the elevated ramps, and rebound shots off any architectural surface.
- **Out of Bounds / Kill Plane**: If a ball or athlete falls below `y < -20.0m`, the watchdog system instantly catches and restores them to active play.

### 2.3 Court Circles (North & South Zones)
- Two $18\text{m}$ radius circles are painted on the arena floor (centered at North and South).
- **Role**: Spatial telemetry & tactical awareness. Touching the ball inside a circle logs `Own Circle (Defense)` or `Opp Circle (Attack)` on the Hustle Board.
- **Scoring Value**: Goals scored from anywhere on court (inside or outside the circles) are worth **1 point**.

---

## 3. MATCH FORMAT, TIMING, & SPAWNS

### 3.1 Match Duration & Clock
- **Regulation Time**: Strictly timed **5 minutes (300 seconds)**.
- **Clock Engine**: Decremented per fixed step at 60 Hz (`300 * 60 = 18,000 ticks`). The clock pauses only when the simulation itself is paused.
- **Opening Countdown**: A **5-second pre-match countdown** holds the clock at `05:00` while players orient and view team lineups.

### 3.2 Opening Spawns (Stream Heads)
Athletes spawn elevated at $+7.5\text{m}$ on the landmark stream heads:
- **1v1 Match**:
  - **Home Athlete**: Spawns at South stream head (randomized between `SW` or `SE`), facing North (`yaw = 0`).
  - **Away Athlete**: Spawns at North stream head (randomized between `NW` or `NE`), facing South (`yaw = \pi`).
- **2v2 Match**:
  - **Home Team (P1 & P3)**: Occupy both South stream heads (`SW` and `SE`).
  - **Away Team (P2 & P4)**: Occupy both North stream heads (`NW` and `NE`).

### 3.3 Opening Kickoff / Ball Drop
- When the match begins, the ball is dropped from the ceiling at elevation $y = 10\text{m}$.
- **Drop Position**: **Randomized anywhere within the active field of play**.
- When the countdown hits **"GO!"**, athletes drop down the stream head ramps and race to contest the opening touch.

---

## 4. THE SCORING RULES & TARGET GOAL SWITCHING

### 4.1 Hoop Crossing & Detection
A goal occurs when a ball's center crosses the `x = 0` plane within a hoop's circular aperture:
- **Universal Entry**: A shot entering from East $\to$ West ($+X \to -X$) or West $\to$ East ($-X \to +X$) is equally valid.
- **Segment Test**: Detected via swept segment intersection between `pPrev` and `pCurr` across $x = 0$, ensuring even hyper-velocity spikes ($>25\text{m/s}$) are never missed.

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

1. **Initial Orientation**: Matches always start with **Home attacking North** (`targetGoal = 'N'`) and **Away attacking South** (`targetGoal = 'S'`).
2. **Post-Goal Flip**: When a goal is scored in Goal North:
   - Home gets the point (since Home was attacking North).
   - `targetGoal` flips to South (`'S'`).
   - Home is now defending North and attacking South.
   - Away is now defending South and attacking North.
3. **Synchronized Arena Response**:
   - All 4 stadium scoreboards invert team attacking banners and color fills.
   - Side ribbon boards flip directional attack arrows.
   - Player chase cameras dynamically re-bias tracking toward the player's updated target hoop.

### 4.3 Own Goals & Rebound Shots
- If an athlete knocks the ball into the hoop their team is currently *defending*, the point is awarded to the opponent (who was designated as attacking that goal).
- Ends flip immediately, ensuring the game always progresses forward.

---

## 5. POSSESSION, CONTACT, & STRIKE MECHANICS

### 5.1 Free Arcade Possession
- **Zero Touch Limits**: There are no volleyball-style 3-touch limits or double-touch whistles. Athletes can juggle, dribble, wall-pass, or volley repeatedly.

### 5.2 Arcade Full-Contact
- **Tackling & Knockdowns**: Physical collisions, slide tackles (`C` / `RT`), and diving challenges (`Q` / `X`) are **100% legal**.
- Knocking down an opponent or dispossessing them with a clean slide is a core defensive strategy. There are no fouls, yellow cards, or penalty kicks.

### 5.3 Strikes & Sweet Spots
- **Volley / Kick (`E` / `B`)**: Underhand/horizontal contact providing controlled trajectory shaping and ground clears.
- **Power Spike (`R` / `Y`)**: Overhand strike. When struck at the peak of an athlete's jump reach within the sweet-spot window ($\pm 4$ ticks), the ball triggers an accelerated rainbow power spike directly toward the target hoop.

---

## 6. STAGNANT & DEAD BALL RULES

### 6.1 Automatic Arena Re-Drop
- If a ball comes to a complete standstill on the court, gets wedged in a corner, or remains untouched for **4.0 consecutive seconds**:
  1. An arena buzzer sounds.
  2. The ball is automatically teleported to ceiling height ($y = 10\text{m}$) and dropped at a randomized $(X, Z)$ coordinate within the field of play.
  3. Play continues without pausing the match clock.

---

## 7. MATCH BALL TYPES & PHYSICS

The match host selects the match ball during pre-match setup. All ball types score **1 point per goal**, but dramatically alter game pace and feel:

| Ball Type | Radius | Mass | Restitution | Friction | Character & Tactical Role |
|---|---|---|---|---|---|
| **Medium (Official)** | $0.50\text{m}$ | $2.20\text{kg}$ | $0.88$ | $0.80$ | **The Canonical Standard**: Blue/Yellow signature ball. Balanced weight, predictable trajectory, optimal sweet-spot response. |
| **Small** | $0.20\text{m}$ | $0.84\text{kg}$ | $0.88$ | $0.80$ | **Lightning Pace**: Crimson/White. Fast, light, snappy, high aerial bounce, rewarding twitch reflexes and rapid volleys. |
| **Large (Exercise Ball)** | $0.75\text{m}$ | $3.89\text{kg}$ | $0.85$ | $0.85$ | **Heavy Striker**: Purple/Silver. High inertia, massive momentum, pushes athletes backward on contact, wall-bouncer. |

---

## 8. MATCH RESOLUTION & OVERTIME

### 8.1 Regulation End
When `ticksRemaining` reaches `0`:
1. The game state switches to `victory`.
2. The arena buzzer sounds.
3. The Victory Screen displays the winning team or Draw banner.

### 8.2 Tiebreaker Rules
- **Default (Exhibition Match)**: Concludes as a **DRAW / TIED MATCH**.
- **Tournament / Competitive Mode (Configurable)**:
  - **Option A: Sudden Death Golden Goal**: The match clock extends indefinitely; the next team to score any goal wins immediately.
  - **Option B: Fixed Overtime**: Adds a 2-minute overtime clock.

---

## 9. THE HUSTLE BOARD (POST-MATCH TELEMETRY)

Performance is evaluated across 10 stats presented in a strict **ROYGBIV spectrum**:

1. **Red (`#ef4444`) — Goals**: Total goals scored.
2. **Coral (`#f43f5e`) — Power Spikes**: High-velocity aerial spike executions.
3. **Orange (`#fb923c`) — Opp Circle (Attack)**: Ball touches inside the opponent's defensive circle.
4. **Yellow (`#ffd60a`) — Sweet Spot Hits**: Strikes executed within the optimal contact window.
5. **Green (`#22c55e`) — Strikes (Hits/Whiffs)**: Total strike attempts connected vs missed.
6. **Mint (`#10b981`) — Own Circle (Defense)**: Ball touches inside the team's defensive circle.
7. **Cyan (`#38bdf8`) — Strike Accuracy**: Percentage of strike attempts that successfully connected.
8. **Dark Blue (`#2563eb`) — Touches**: Total physical ball interactions across the match.
9. **Purple (`#8b5cf6`) — Ground Dives**: Total defensive diving slides initiated.
10. **Pink (`#ec4899`) — Diving Hits / Saves**: Balls struck or deflected while in an active dive.

---

*This document is the single source of truth for Valleyball gameplay mechanics. Any modifications to game rules, hoop behavior, or match progression must align with this document.*
