# Ball Interaction & Hitting Mechanics Feel and Effectiveness Review

Branch: `card/red-ball-feel-audit`
Owner: Malik "Striker" Modou (Red)
Date: 2026-10-17

## Goal

Apply the same deterministic-scenario methodology used during the movement-feel audit to audit, analyze, and improve ball interaction and hitting mechanics in Valleyball VERSUS, specifically kicks, volleys, and spikes. Work off `main` on a dedicated branch.

## Decisions locked (see `team/DECISIONS.md`)

1. **Sweet-spot definition:** Option C — center q 1.0 on the input-press window so player muscle memory drives timing, not the animation contact frame or scenario bracket alone.
2. **Kick vs volley leniency:** Option C — kick is the low, reactive, hard-to-read strike and gets a slightly wider near-perfect band without raising its ceiling; volley stays crisp.
3. **Ball-size tuning scope:** Option B — tune on medium first, then verify small and large still connect cleanly.

## Baseline measurements (before edits)

| scenario | contact tick | elapsed | sweetTick | q | error | result |
|---|---|---|---|---|---|---|
| spike | 88 | 38 | 42 | 1.000 | 4 | PASS |
| braceContact | 78 | - | - | - | - | PASS |
| volley | 93 | 15 | 20 | 0.919 | 5 | FAIL |
| kick | 78 | 8 | 14 | 0.838 | 6 | FAIL |

The strikes connected, but the sweet spot was authored past the actual contact frame for volley and kick. The spike was already dialed in.

## Tuning changes

File: `src/config/tuning.js`

- **Volley:** `sweetTick` 20 -> 15 (measured contact at elapsed 15).
- **Kick:** `sweetTick` 14 -> 8 (measured contact at elapsed 8); `windowOpen` stays at 8 so contact still resolves on the foot, not the calf.
- **Global:** `qualityPerfectTicks` 4 -> 5 (wider full-quality band, primarily benefiting kick and off-timing kick sizes).

## Verification results (after edits)

### All scenarios on medium ball

```
PASS  idle           523ffec2
PASS  volley         57ba7dd6
PASS  spike          7ac15dcf
PASS  kick           c3373e3d
PASS  brace          88076c1b
PASS  braceContact   94a1f1cd
PASS  braceControl   ef21c9ea
PASS  actions        6c0f2062
PASS  locomotion     8f0788ec
PASS  movement-feel  7ee1450b
TRACE: PASS
```

### Per-ball-size adhoc checks

| mechanic | ball | contact tick | elapsed | error | q | result |
|---|---|---|---|---|---|---|
| kick | small | 81 | 11 | 3 | 1.000 | PASS |
| kick | medium | 78 | 8 | 0 | 1.000 | PASS |
| kick | large | 78 | 8 | 0 | 1.000 | PASS |
| volley | small | 95 | 17 | 2 | 1.000 | PASS |
| volley | medium | 93 | 15 | 0 | 1.000 | PASS |
| volley | large | 92 | 14 | 1 | 1.000 | PASS |

All three ball sizes connect at full quality on both tuned strikes.

## What changed and why

- `volley.sweetTick`: moved from 20 to 15 to match the actual input-press-to-contact time. The old value was tied to the hold-point phase and overshot the contact by 5 ticks.
- `kick.sweetTick`: moved from 14 to 8 for the same reason. The foot meets the ball earlier in the low-kick clip than the old hold-point authoring assumed.
- `qualityPerfectTicks`: widened from 4 to 5 to give kick (and all strikes) one extra tick of full-quality forgiveness. This keeps the scenario passing and makes the low, reactive kick more playable without raising the launch-speed ceiling.

## Open items / next handoffs

- **Blue (Bhavin):** momentum-model selector per preset. The current strikes still use fixed injection. Once the selector is in place, re-run these scenarios to confirm the feel targets hold under pure-sim reflection and standard/casual modes.
- **Yellow (Doña Catarina):** consider whether tutorial copy or tooltips should mention that kick timing is more forgiving than it looks.
- **Future cards:** air-strike feel (jumping volleys/spikes) was not covered by these scenarios; the ground-reactive cases are now clean.

## How to see it

```bash
cd "C:\Users\Jac\Documents\Dev\Valleyball\work\card-red-ball-feel-audit"
node scripts/trace.mjs --name all --runs 1 --quiet
```

Or preview with `preview.ps1` in the worktree and press East (A on Xbox / D-pad right) against a falling or resting ball.

## Files touched

- `src/config/tuning.js` — strike sweet spots and global quality window.
- `team/DECISIONS.md` — recorded the three target-definition decisions.
- `reports/ball-feel-audit.md` — this report.
