# `tracker.weight` — every writer and every reader

**Derived by grep, not from memory.** The greps are in the appendix; every row
below points at a line one of them returned. Written for G3.5, against the tree
that step produced.

`tracker.weight` is the single blend weight the whole character runs on
(LAW L4 / RULING GF-2.0). There is no "knocked down" boolean anywhere in the
project. A hit subtracts from this float, a ramp adds to it, and everything the
athlete does — how hard he steers, how hard the sphere brakes, how stiff his
spine is, whether the stand-up take can move him — is a consequence of where the
float ended up. **That is why this page exists: seven separate mechanics read
one number, and until now nothing said so in one place.**

Range: **0..1**, clamped at both writers. 1 = fully in control, 0 = boneless.

---

## 1. `tracker.weight`

### Writers — four, and only four

| # | Site | What it does | Range |
|---|---|---|---|
| W1 | `sim/tracker.js:146` `applyImpacts` | `weight -= excess * impact.scale * multiplier * dt` — one subtraction per contact event over the force threshold | unbounded before W2 |
| W2 | `sim/tracker.js:155` `applyImpacts` | `Math.min(1, Math.max(0, weight))` — the clamp that closes W1 | 0..1 |
| W3 | `sim/tracker.js:258` `applyTracking` | `weight = tracker.knockdownTone` on a consumed knockdown. **Assignment, not subtraction** — a knockdown sets the floor it lands on | 0..1 (the tone) |
| W4 | `sim/tracker.js:269` `applyTracking` | the recovery ramp, `weight + recoverPerSecond * dt`, clamped. Skipped entirely while `tumbling` | 0..1 |

There is no fifth. `queueKnockdown` (`tracker.js:107`) does **not** write the
weight — it raises a flag and records a tone, and W3 spends both on the next
step. That separation is what keeps a knockdown a spawn-slot event rather than
something input can do mid-step.

### Readers — seven, in four files

| # | Site | Reads it as | Effect |
|---|---|---|---|
| R1 | `main.js:704` `driveAttenuation` | `weight²` | steering authority. A stumbling athlete steers; a downed one does not |
| R2 | `main.js:722` `knockdownDrag` | `smoothstep01((dragOnset - weight) / dragOnset)` | the sphere's braking multiplier, 1 at `weight ≥ dragOnset` |
| R3 | `main.js:755-756` `applyLimpBrake` | `weight < ragdoll.limpBrakeBelow`, then `1 - weight/limpBrakeBelow` | direct clamped braking on the sixteen ragdoll bodies while limp |
| R4 | `main.js:773` `isTumbling` | `weight < impact.mountRecoverBelow` (AND pelvis speed > 2.0) | holds W4 off while a limp body is still sliding |
| R5 | `mechanics/mountFollower.js:168` | `weight < impact.mountRecoverBelow` (AND `pelvisDownness > 0.25`) | the "detached" half of the mount hold |
| R6 | `sim/tracker.js:274` `applyGains` | `const weight = tracker.weight` | the PD gains — see §2 |
| R7 | `main.js:381`, `main.js:1663` | text / probe | HUD and `window.__vb.probe`. **Read-only, never fed back** |

R4 and R5 both compare against `impact.mountRecoverBelow`, and that is
deliberate: they are the two halves of one question asked in two places, and the
comment at `MOUNT_FOLLOW_STAND_NEED` explains why the *other* half of each test
is required to be independent evidence.

---

## 2. Inside `applyGains` — where the weight becomes force

`sim/tracker.js:274-372`. One read of `weight` fans out into four scales.

| Derived | Line | Formula | Range | Notes |
|---|---|---|---|---|
| `kpScale` | 325 | `max(weight ^ tracking.limpness, standEffort * standUp.authority)` | 0..1 | stiffness. `limpness` is 5, so weight⁵ — which is why the **stand-up effort floor** exists at all |
| `standEffort` | 324 | `animTarget.standUpNeed * animTarget.standUpProgress` | 0..1 | zero standing, zero the instant he goes down, largest through the middle of the take |
| `kdScale` | 332 | `max(weight, tracker.muscleTone)` | 0..1 | damping only. Once weight passes the tone this is just `weight` |
| `groupScale` | 356 | `group + (1 - group) * weight` | `groupStiffness[g]`..1 | **per-group stiffness lerp**. At weight 1 every group is exactly 1.0 — nothing is softened while he is in control |
| `groupScale` (legs) | 363-366 | `groupScale + (diveLegStiffness - groupScale) * animTarget.diveMix` | `diveLegStiffness`..`groupScale` | **the dive's dead legs**. Six named bodies (`LEG_BODIES`), faded by `diveMix`, not by weight |

`boost` (line 372, `pelvisBoost` on the pelvis only) is the inverted pendulum
and does not read the weight.

---

## 3. The satellites

### `tracker.muscleTone` — 0..1

The floor under the **damping** term and nothing else.

| | Site | |
|---|---|---|
| declared | `tracker.js:60` | `muscleTone: 0` |
| written | `tracker.js:259` | `muscleTone = knockdownTone`, on the same consumed knockdown as W3 |
| read | `tracker.js:332` | `kdScale = max(weight, muscleTone)` |

It needs no decay of its own: it stops mattering the moment the character is
stiffer than the floor.

### `tracker.knockdownTone` — 0..1

The tone a queued knockdown will land on. Not a weight; a *request*.

| | Site | |
|---|---|---|
| declared | `tracker.js:58` | `knockdownTone: 0` |
| written | `tracker.js:112-114` | `queueKnockdown(tracker, tone)`. Two knockdowns queued before one is consumed take `min()` — the limper |
| read | `tracker.js:258-259` | spent into both `weight` and `muscleTone`, once |

Callers: `main.js` (the T key, step 4), `mechanics/actions.js` twice — the
slide ridden into the ground (tone 0) and the dive's landing edge (tone
`action.crashMuscleTone`). Every other knockdown passes tone 0 and therefore
lands on 0 exactly as it always did.

### `animTarget.recoveryWeight` — 0..1

`tracker.weight` handed to the ghost. **A copy, never a second authority.**

| | Site | |
|---|---|---|
| declared | `animtarget.js:314` | `recoveryWeight: 1` |
| written | `animtarget.js:1339` | `readGhostInputs` — the one door, from `main.js:1036` (`ghostInputs.recoveryWeight = tracker.weight`) |
| read | `animtarget.js:808` | `rawNeed = 1 - recoveryWeight` — the stand-up need |
| read | `animtarget.js:858` | `< prevRecoveryWeight - collapseDrop` — a collapse seen as a downward edge |
| read | `animtarget.js:863` | `ceiling = min(1, recoveryWeight * recoverGain)` |
| mirrored | `animtarget.js:861` | `prevRecoveryWeight = recoveryWeight`, for the edge above |

**Why it is handed over rather than read.** The ghost drives the stand-up take
off this number and not off the pelvis, because a scrub anchored to the body
cannot haul the body — the body only moves by being hauled toward the scrub.
Before G3.5 this arrived as `animTarget.recoveryWeight = tracker.weight` poked
directly from `fixedUpdate`; it now arrives in `ghostInputs`.

### `animTarget.diveMix` — 0..1

Not a weight, but it multiplies one: it is the fade on the dead-leg stiffness
above (`tracker.js:363-366`). Written by `mechanics/actions.js` through
`ghostInputs`, eased at `action.poseEase`.

---

## 4. The one invariant worth restating

**Nothing reads the weight and writes it back.** R1-R7 are all consumers; the
only writers are the four in `tracker.js`. The HUD and the probe (R7) are
explicitly read-only — LESSON 22, and the reason `hud-weight` shows
`tracker.weight.toFixed(2)` rather than a second copy of the arithmetic.

---

## Appendix — the greps

```text
$ grep -rn "\.weight\b\|weight =" src/ --include=*.js \
    | grep -v "recoveryWeight\|prevRecoveryWeight\|weightAudit\|WEIGHT_SUM\|weights\."
src/config/tuning.js:650:    // The latch clears on `tracker.weight > 0.5` — "he is back on his feet, the
src/sim/tracker.js:146:    tracker.weight -= excess * TUNING.impact.scale * multiplier * dt;
src/sim/tracker.js:155:  tracker.weight = Math.min(1, Math.max(0, tracker.weight));
src/sim/tracker.js:258:    tracker.weight = tracker.knockdownTone;
src/sim/tracker.js:269:    tracker.weight = Math.min(1, Math.max(0, tracker.weight + TUNING.tracking.recoverPerSecond * dt));
src/sim/tracker.js:274:  const weight = tracker.weight;
src/sim/animtarget.js:312:    /** tracker.weight, written by main.js before updateAnimTarget. The ghost
src/sim/animtarget.js:774: * THE RECOVERY IS THE CLOCK NOW. tracker.weight climbs on a pure ramp
src/sim/animtarget.js:984:    const weight = w[c.id];
src/mechanics/mountFollower.js:168:        tracker.weight < TUNING.impact.mountRecoverBelow &&
src/mechanics/actions.js:17: * flight, and the `tracker.weight > 0.5` early-out that ended every dive before
src/mechanics/actions.js:271:  // The `tracker.weight > 0.5` early-out that used to sit here is GONE. It read
src/main.js:381:  hudWeight.textContent = tracker.weight.toFixed(2);
src/main.js:701:// DRIVE ATTENUATION. tracker.weight squared: a stumbling athlete steers, a
src/main.js:704:  return tracker.weight * tracker.weight;
src/main.js:722:      smoothstep01((TUNING.impact.dragOnset - tracker.weight) / TUNING.impact.dragOnset);
src/main.js:755:  if (ragdoll && tracker.weight < TUNING.ragdoll.limpBrakeBelow) {
src/main.js:756:    const limpness = 1 - tracker.weight / TUNING.ragdoll.limpBrakeBelow;
src/main.js:773:    tracker.weight < TUNING.impact.mountRecoverBelow &&
src/main.js:1663:      weight: tracker.weight,
```

`tuning.js:650`, `animtarget.js:774`, `animtarget.js:984` and the two
`mechanics/actions.js` hits are comments or an unrelated local named `weight`
(the blend node's own share, `animtarget.js:984`).

```text
$ grep -rn "muscleTone\|knockdownTone" src/ --include=*.js
src/sim/tracker.js:58:    knockdownTone: 0,
src/sim/tracker.js:60:    muscleTone: 0,
src/sim/tracker.js:96: * character genuinely falls. `muscleTone` is a floor under the DAMPING term
src/sim/tracker.js:112:  tracker.knockdownTone = tracker.knockdownQueued
src/sim/tracker.js:113:    ? Math.min(tracker.knockdownTone, tone)
src/sim/tracker.js:258:    tracker.weight = tracker.knockdownTone;
src/sim/tracker.js:259:    tracker.muscleTone = tracker.knockdownTone;
src/sim/tracker.js:322:  // exactly the window that had none. It is the same idea as muscleTone one
src/sim/tracker.js:332:  const kdScale = Math.max(weight, tracker.muscleTone);
```

```text
$ grep -rn "recoveryWeight" src/ --include=*.js
src/sim/animtarget.js:314:    recoveryWeight: 1,
src/sim/animtarget.js:315:    /** Last tick's recoveryWeight, so a collapse can be seen as a downward
src/sim/animtarget.js:330:     *  directly; the number is handed to it, like recoveryWeight. */
src/sim/animtarget.js:808:  const rawNeed = Math.min(1, Math.max(0, 1 - state.recoveryWeight));
src/sim/animtarget.js:858:  if (state.recoveryWeight < state.prevRecoveryWeight - tuning.collapseDrop) {
src/sim/animtarget.js:861:  state.prevRecoveryWeight = state.recoveryWeight;
src/sim/animtarget.js:863:  const ceiling = Math.min(1, state.recoveryWeight * tuning.recoverGain);
src/sim/animtarget.js:1317: * lines — `animTarget.recoveryWeight = ...`, `animTarget.slidePhase = ...` and
src/sim/animtarget.js:1339:  state.recoveryWeight = inputs.recoveryWeight;
src/main.js:1036:        recoveryWeight: tracker.weight,
```
