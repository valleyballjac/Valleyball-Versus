# Motor Authority Review: Walk Floor and Braking Leverage

Author: Bhavin "The Anchor" Bhasin (Blue)
Card: card/blue-motor-authority-review
Base: main @ cda89c0 (v0.3.0)

## The question (verbatim from the card)

Do we have enough authority in `driveTorque`, `brakeTorque`, and clamped linear
damping to raise the walk floor to 1.8-2.2 m/s and cut braking distance in half,
or does the stick response curve need reshaping first?

## Verdict

- Braking: **YES, authority exists.** `brakeTorque` + `rollingResistance` are the
  levers and both have headroom. No curve work required for this half.
- Walk floor: **NO, not cleanly.** There is no walk ceiling and no analog
  response curve anywhere. "Walk" is an emergent number from a linear stick map
  times one shared torque term. `driveTorque` alone cannot place a 1.8-2.2 m/s
  walk floor without also dragging run acceleration along for the ride. Reshape
  the stick curve, or add a walk governor, first.
- "Clamped linear damping" is **mislabeled as a locomotion lever.** It is not
  applied to the motor sphere at all; the root is damped angularly only.

## How the motor actually structures the problem

### Locomotion has exactly two governor ceilings, neither of which is "walk"

`src/sim/motor.js:308-310`:

```js
const effectiveMax = input.sprintHeld
  ? TUNING.motor.maxAngularSpeed                    // 12 rad/s = 6.0 m/s
  : TUNING.blend2d.runSpeed / TUNING.motor.radius;  // 3.8 / 0.5 = 7.6 rad/s = 3.8 m/s
```

There are two stops on the governor: sprint and not-sprint. There is no walk
stop. Below the not-sprint ceiling, the single drive term is

`src/sim/motor.js:336`:
```js
const magnitude = TUNING.motor.driveTorque * inputMagnitude * control * driveScale * steerScale * dt;
```

`inputMagnitude` is the only analog input here, and it enters as a plain linear
multiplier on one torque. It scales walk and run acceleration to exactly the
same degree, because there is one torque expression and no per-gait curve.

### The stick map is a bare linear deadzone, nothing else

`src/input/inputRouter.js:74-79`:
```js
function applyDeadzone(x, y, deadzone) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadzone) return { x: 0, y: 0 };
  const scaled = (magnitude - deadzone) / (1 - deadzone) / magnitude;
  return { x: x * scaled, y: y * scaled };
}
```

`TUNING.motor.stickDeadzone = 0.15` (`tuning.js:295`). The bottom 15% of the
stick is silent, then a linear renormalization. No power curve, no per-gait
remap, no walk band. Keyboard is worse: it never goes through this at all and
lands as a binary magnitude 1 (`inputRouter.js:698-699`, `802-803`).

Concrete consequence, using the audit's own walk deflection of 40%
(`scripts/scenarios.mjs:168`, `ax = [0, -0.40, 0, 0]`):

```
post-deadzone magnitude = (0.40 - 0.15) / (1 - 0.15) = 0.294
```

Forty percent of physical stick becomes 29.4% of drive authority, and that
29.4% is the entire knob that sets the walk's terminal speed. That compression
is why walk tops out at 0.713 m/s and why there is no clean walk band to tune.

### "Clamped linear damping" is not a root lever

`applyClampedLinearDamping` (`src/sim/damping.js`) is called from exactly three
families of sites, none of which is the motor sphere:

- `src/sim/athlete.js:224` and `src/main.js:1248` — `applyLimpBrake`, damping the
  ragdoll **limb** bodies when the athlete is knocked down.
- `src/main.js:1448` — the brace, damping the **ball** on a deflected shot.
- `src/sim/tracker.js:441` — tracking, damping **limb** bodies against relative
  velocity.

The motor sphere's only resistance is angular, through `motor.js`'s own
`applyClampedDamping`: `rollingResistance` every tick (`motor.js:373`) plus
`brakeTorque` when the stick is neutral (`motor.js:346-347`). So the levers that
matter for this card are all in `TUNING.motor` and are all angular.

### Empirical confirmation (deterministic trace, court)

Ran an adhoc trace holding the audit's walk input (40% stick, no sprint) for 360
ticks instead of the audit's 50-tick window. The sphere does **not** settle at
0.713 m/s; it climbs monotonically and parks on the run governor:

```
tick  90  speed 0.846   (54 ticks of drive)
tick 120  speed 1.308
tick 200  speed 2.539
tick 250  speed 3.309
tick 285  speed 3.793   <- run ceiling (runSpeed/r = 3.8 m/s)
tick 300+ speed 3.77-3.80  (flat; then it rides up the bowl wall)
```

So the audit's "walk @ 0.713 m/s" is purely a 50-tick sampling artifact, not a
terminal speed. This is the direct, measured proof that there is no walk ceiling
to tune against: partial stick and full stick share the one non-sprint governor,
and any `driveTorque` raise shortens the climb to 3.8 m/s without creating a
distinct walk floor.

## Authority assessment, lever by lever

### Braking distance (halve it) — in range

Today the released-sphere decel is `brakeTorque (2.0) + rollingResistance (0.5)`
= 2.5 N m of angular resistance, measured 0.833 s / 1.727 m to drop from sprint
below 0.3 m/s. The brake term has generous headroom: it was seeded at 8.0 and
measured down to 1.0 (`tuning.js:266-275`), and the debug panel exposes 0-60
(`src/debug/gui.js:194`). Raising `brakeTorque` from 2.0 toward 3-4 should take
the stop distance roughly toward half, with two caveats Red must sweep against:

1. The brake only fires when the stick is neutral (`motor.js:346`,
   `inputMagnitude <= MIN_INPUT`). Doubling the brake does nothing for an athlete
   who holds the stick against motion; that path is the reversal bite
   (`reversalBiteTime`, currently 0.25 s), which already grades A.
2. Do not push the brake past the point where a released ball parks on the
   valley wall. The comment records the failure at T=8 (10.9 m/s^2 exceeds the
   slope's gravity everywhere below r~11) and the safe landing at T=1 (1.36
   m/s^2). The usable band is wide but bounded; sweep it, don't guess it.

### Walk floor (1.8-2.2 m/s) — not in range via torque alone

Because the governor has no walk ceiling and the stick map is linear, the walk
floor is not a quantity any single `driveTorque` value selects. Raising
`driveTorque` lifts the entire non-sprint accel curve, so walk rises but so does
run's feel, and the walk/run separation (which the blend space keys off at
`blend2d.walkSpeed = 1.8` vs `blend2d.runSpeed = 3.8`, `tuning.js:555-556`)
collapses. This is an input-shaping gap, not a torque-range gap.

Two viable structural fixes (both Red-side sweeps, Blue flagging the shape):

1. **A walk governor ceiling**, mirroring the existing two: a
   `walkSpeed / radius` stop engaged when not sprinting and the input magnitude
   sits below a run threshold. This gives an explicit, tunable walk terminal
   speed, and it obeys Law L1 because, like the other two, it starves drive
   torque rather than writing velocity.
2. **A shaped stick response curve** in `inputRouter.js` (replacing or wrapping
   `applyDeadzone`) that maps the low-deflection band onto a deliberate walk
   output instead of the current linear collapse. This is the cheaper change and
   the one that also fixes "light stick input barely registers".

Either way the curve/ceiling is the prerequisite; `driveTorque` tuning after
that is fine for feel, but on its own it cannot hit the target cleanly.

## Law notes (what a fix must respect)

- Law L1: any new ceiling must starve torque, never write position or velocity.
- Law L3: any new resistance must route through the clamped damping helpers.
- Law L4: no boolean gait state. A walk governor must be a continuous threshold
  on existing signals (`sprintHeld`, `inputMagnitude`, speed), not a new state
  flag.

## What changed on this branch

Nothing yet. This is a review card; it produces this document, not tuning
values. The sweep is Red's play.

## Handoff

- Next: Red (<@1555610832203939901>) runs the parameter sweeps. The two lines of
  attack are (1) brakeTorque 2.0 -> 3-4 against the ice-rink stop, and (2) walk
  floor via a walk-ceiling governor or a shaped response curve, not raw
  driveTorque.
- John (<@1549636725306036245>): flagging the card's third lever as mislabeled;
  there is no clamped-linear-damping path to the motor sphere.

Foundation holds.