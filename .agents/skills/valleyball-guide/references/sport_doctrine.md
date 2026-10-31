# Sport Doctrine & Gameplay Philosophy

## 1. The Soul of Valleyball Versus

**Valleyball Versus is a pure physics sports simulation.**
It is intentionally engineered with high physical discipline, a demanding skill ceiling, and zero arcade magnetism.

* **Forever Free, Pure Sim Identity**: Valleyball Versus does not dilute its core simulation to chase mass-market arcade compromises. The upcoming *Valleyball Arenas* title is designed to explore arcade modes and broader accessibility; *Versus* remains the uncompromising, authentic competitive simulation.
* **Pure Physical Agency**: A ball is struck where an athlete's physical limb or body collides with it (on the default Standard preset, also by a well-timed near miss, see below). There is zero artificial homing, zero curve-assist, and zero trajectory manipulation.
* **Standard by Default**: The default configuration is `standard` (`assistRadius: 0.45`, `assistWindowTicks: 6`, `aimMagnetism: 0.0`): a swing timed within 6 ticks of the sweet spot also connects with a ball up to 0.45 m from the striking limb. `pureSim` (`assistRadius: 0.0`, `aimMagnetism: 0.0`) is the hardcore option for players who want the challenge, where only real limb contact strikes the ball. `casual` widens the forgiveness further. Each player picks a preset on the player setup screen.

---

## 2. Court Rules & Match Structure

### 🚫 No Out-of-Bounds
* **Continuous Play**: The court is bounded by tall, transparent perimeter glass barriers. The ball is **always live**.
* Bounces off the glass walls, goal hoops, mound slopes, and valley floors are legal and intended tactical play surfaces.
* There are no throw-ins, corner kicks, or sideline restarts.

### 🚫 No Referee Whistles
* There are no fouls, no stoppages, and no referee whistles.
* Physical player collisions (shoulder checks, slides, aerial crashes) are resolved entirely through Rapier rigid-body impulse dynamics. High-momentum collisions can induce knockdowns via `tracker.weight`, but play never halts.

### 🎯 The Scoring Objective
* **Hoop Apertures**: Suspended at either end of the court along the center longitudinal axis ($x = 0$) at $z = \pm 43.0\,\text{m}$, elevated at $y = 7.5\,\text{m}$ with a radius of $r = 4.667\,\text{m}$.
* **The Goal Event**: A goal is scored when the ball's center cleanly crosses through the hoop aperture plane from the inside playing field outward.
* **Goal State & Reset**: Scoring arms an immediate celebration state, registers points on stadium jumbotrons, and initiates the kickoff ceremony.

---

## 3. Offensive-First Philosophy

### Positioning Over Assisted Aiming
* The primary barrier to shot placement in Valleyball is **athlete positioning**, not button timing.
* The exit trajectory of a strike is governed by where the athlete's striking limb makes contact relative to the ball's center of mass and incoming momentum.
* **The Cut Mechanic (`KeyV` / `RB`)**: Allows the athlete to plant cleats into the turf, instantly shed lateral momentum, and redirect toward the ball to set up optimal physical striking angles.

### Defense Must Never Lock Player Movement
* **The Lesson of the Failed Block IK**: An earlier attempt to procedural-IK limbs toward incoming balls broke athlete locomotion and caused severe ragdoll panics.
* **The Golden Rule for Defense**: Any future defensive mechanic (such as blocks or braces) **must never lock the athlete into a frozen pose or restrict locomotion**. Athletes must remain agile, mobile, and responsive at all times.
* Defense should be explored only after offensive feel, footwork, and physical striking feel natural and intuitive.
