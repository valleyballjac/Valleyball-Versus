# Rebuild Phase 0 — Baseline report

Branch `rebuild/core`, local only. Base: `e34833f` (v0.2.3, Sep 24 2026), tagged `baseline/v0.2.3-e34833f`.
Written by Claude (cloud workspace, headless Chromium 1194 / SwiftShader, 2 cores).

## Verdict

Phase 0 is done on the cloud side. "Unchanged" is now provable on every tick, and every scenario proves its own mechanic happened.
Two findings change what earlier gates meant:

1. **The scenario harness had been testing nothing.** Both `strike` and `actions` passed while no scripted press ever fired (details below).
2. **Starting Practice threw a `ReferenceError` on every start since v0.2.0.** It's fixed in a separate commit.

## What was added

| Piece | Command / param | What it proves |
| --- | --- | --- |
| State trace | `?stateTrace=1` (src/debug/stateTrace.js) | Per-tick digest of every rigid body plus each athlete's ghost. Renderer-independent: a cloud run and a laptop run can be compared directly. |
| Ball fixtures | `?balls=1&serve=1:x,y,z@T` (src/debug/fixture.js) | Put a ball at hand height on a known tick. Armed runs only; balls only, never athletes. |
| Trace harness | `npm run trace -- --name all [--baseline \| --record]` | One page load per run, every tick compared, first divergent tick named, and expectations checked. |
| Scenarios | scripts/scenarios.mjs | idle, volley, spike, kick, actions, locomotion, all derived on the court. `npm run scenario` now runs them all. |
| Audit | `npm run audit` | The laws as a ratchet against baselines/audit-allow.json. |
| Profile | `npm run profile [-- --mode match]` | fixedUpdate/render timing and a V8 CPU profile by file. |

## Baselines (cloud)

| Scenario | Ticks | Trace digest | What it asserts (all OK) |
| --- | --- | --- | --- |
| idle | 300 | `5f98cc71` | Grounded and at full weight from tick 40 on |
| volley | 140 | `d7284069` | East→volley at 78; q 1.000 at 96 (handL 334 N → 24.5 m/s); exactly one resolve |
| spike | 140 | `77c4f5f5` | q 1.000 at 95 (handL 289 N → 22.0 m/s), side AGREE |
| kick | 110 | `3dc2bbdb` | East→kick at 70 (ball −0.512 m below pelvis); q 1.000 at 84 (footL 379 N → 14.5 m/s) |
| actions | 430 | `b7d23f80` | Sprint > 5.5; slide 117–124; jump-cancel with trigger held, at > 4.0 m/s (so only the lockout holds it out); fresh slide 212–230; dive at 236; crash weight 0.2; KeyT weight 0; recovery > 0.35 by 400 |
| locomotion | 420 | `e0ee4a7e` | Walk < 2.5; run 3–5.2; sprint > 5.5; never below weight 0.9; > 2 m/s 30 ticks after release; at rest by 410 |

Court determinism PNG pairs (SwiftShader): t90 `2ac97d92…`, t300 `d5ecfd86…`, t600 `fc1febea…`.
t300 is identical before and after the Phase 0 code, and identical with the trace armed. The trace is read-only in practice, not just in intent.

## Finding 1 — the old scenario gate was hollow

- **The tick came from the HUD.** `scenario.mjs` keyed its script on `#hud-tick`. `updateHud()` returns early when `TUNING.debug.showHud` is off, the release default since the Sep 6 alpha, so the element read `0` forever. No `tick >= N` press ever fired, and both scenarios compared idle runs.
- **A second rAF loop broke the clock.** `visuals/brandBall.js` runs its own loop, and the pinned clock advanced on every callback, not just the Loop's. The Loop saw ~33 ms per frame and took two steps per frame, so the script skipped ticks.
- **Fix:** read `window.__vb.loop.tick`. Advance the clock only on the Loop's frame, stepping 1000/60 + 1e-6 ms so float rounding never leaves the accumulator one ulp short. `trace.mjs` now FAILS unless every loop frame takes exactly one step.
- **Consequence:** every "scenario PASS" since Sep 6 said nothing about slides, dives, knockdowns or strikes.

## Finding 2 — Practice start threw since v0.2.0

- **The bug:** `handleStartPractice` read `urlParams`, a local of `boot()`, so the ReferenceError skipped the P1 drop from 12 m, the ball re-drop and the viewport reset. It also broke `?skipMenu=true`.
- **Fix:** separate commit, one line. Reproduced headless before the fix and confirmed clean after. Hashes are unaffected, because the capture path never calls it.

## Finding 3 — match mode has no determinism coverage

The capture path forces practice with athlete 2 disabled. Two athletes, athlete-to-athlete collisions, scoring, the countdown and bots have never been under a determinism or trace gate.
Phase 1 adds a two-athlete scripted scenario and a bot-vs-bot trace.

## Performance baseline (headless, CPU-side only)

| Config | fixedUpdate mean / p50 / p95 / max | render (JS) mean / p95 |
| --- | --- | --- |
| 1 athlete, practice, 1280×720 | 1.52 / 1.40 / 2.70 / 6.40 ms | 1.99 / 5.00 ms |
| 2 athletes, match, 320×180 | 3.43 / 2.90 / 7.10 / 12.80 ms | 2.87 / 5.20 ms |

- **Where the CPU goes:** three.js (matrix updates, program and uniform setup) and Rapier's WASM step. Game code is small.
- **What the idle time means:** 97–99% of the main thread is idle waiting on SwiftShader, so these runs are GPU-bound and say nothing about real frame time. The laptop Chrome trace is the render truth.
- **Implication for 2v2:** simulation cost roughly doubles per athlete pair, so four athletes would be ~7 ms mean and ~14 ms p95 before any rendering. Performance work belongs before 2v2, not after.
- **Minor:** `features/ui/mainMenu/menuNavigation.js` shows up in the CPU profile during a match, so menu code is running during play.

## Audit baseline (known debt, now a ratchet)

| Rule | Count | Where |
| --- | --- | --- |
| clock | 2 | `sim/ball.js` unseeded `Math.random` branch |
| teleport | 56 | main.js 21, ai/headlessSim.js 20, sim/athlete.js 5, sim/ball.js 5, others 5 |
| layering | 1 | sim/athlete.js imports audio/soundManager.js |
| tuning-write | 72 | main.js 54, settingsModal 8, matchManager 5, soundManager 3, inputRouter 2 |
| dead-module | 6 | 5 `features/*/index.js` barrels and features/camera/viewportManager.js |
| dead-import | 46 | 18 in main.js: leftovers of the pre-athlete.js path (createMotor, updateMotor, applyTracking, runActions, runStrikes…) |
| assets | 1 | main.js requests `models/actions.glb`, which does not exist |
| clips | 1 | `action.crashClip = "Crash"` is not in character.glb |
| size | — | main.js 3,764 · animtarget 1,992 · tuning 1,719 · strikes 956 lines |

## Noted for the Phase 1 audit

- **Mirrored naming:** strike side logs read `side R … clip:L`, with contact on the left limb recorded as AGREE. This is probably a mirrored convention; confirm it's intended.
- **Braking:** stopping from 4.2 m/s takes ~1.2 s (~3.4 m/s²). Check it against the "must work to slow down" goal.
- **Pre-serve side choice:** with a ball not yet served, chooseSide projected to a parked ball 11.7 m away. Harmless in play, but "nearest ball" should probably ignore disabled bodies.
- **Capture respawn:** the capture path re-spawns the ragdoll at tick 31, so nothing can be scripted before tick 36.

## What Jac runs on the laptop (the Phase 0 gate)

```
git fetch _fable\rebuild\rebuild-core.bundle rebuild/core:rebuild/core
git switch rebuild/core
npm run audit
npm run trace -- --name all --baseline
npm run determinism
```

The decisive line is `trace … --baseline`: it compares the laptop's per-tick state digests against the cloud's.
All six MATCH means the simulation is bit-identical across machines, and cloud gates can stand in for laptop gates from here on.
A DIFFER names the first tick where they part.
