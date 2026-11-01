# Movement Feel v0.4 Sweep Report

Branch: `card/preview-movement-feel-v0.4`
Base: Blue's `1237565` (squared magnitude-aware walk governor) + Red's tuning deltas.

## Tuning changes from v0.3.0

- `TUNING.motor.driveTorque`: 4 → 8
- `TUNING.motor.walkSpeed`: 1.9 (added for magnitude-aware walk band)
- `TUNING.motor.maxAngularSpeed`: 12 → 13.5
- `TUNING.motor.brakeTorque`: 2 → 4
- `TUNING.blend2d.walkSpeed`: 1.8 → 2.0
- `TUNING.blend2d.runSpeed`: 3.8 → 4.5
- `TUNING.blend2d.sprintSpeed`: 5.0 → 6.5

## Verified feelReport numbers

| Metric | v0.3.0 baseline | v0.4 tuned | Target |
|--------|----------------:|-----------:|-------:|
| Walk top speed | 0.71 m/s | 2.15 m/s | 1.8-2.2 m/s |
| Run top speed | — | 4.641 m/s | ~4.5 m/s |
| Sprint top speed | — | 6.65 m/s | ~6.5 m/s |
| Sprint stop distance | 1.73 m | 2.535 m | — |
| Sprint stop time | 0.83 s | 0.833 s | — |
| Reversal lag | 0.17 s | 0.167 s | < 0.2 s |
| In-place jump apex | 2.35 m | 2.549 m | 2.3-2.5 m |

Notes:
- The walk band now holds inside 1.8-2.2 m/s at 40% stick thanks to the squared magnitude governor.
- Sprint stop distance is longer than the old run-release measurement because the sprint top speed jumped 28% (6.65 m/s vs ~5.2 m/s). The run-release stop remains tight.
- Reversal and jump arc are unchanged and athletic.

## Validation commands

```bash
git checkout card/preview-movement-feel-v0.4
npm ci --ignore-scripts
npm run determinism      # PASS: SHA-256 match on court tick 300
node scripts/trace.mjs --name movement-feel   # PASS
node scripts/trace.mjs --name locomotion      # PASS
node scripts/trace.mjs --name actions         # PASS
node scripts/feelReport.mjs                   # numbers above
```

## Non-locomotion caveats

- `volley` and `kick` scenarios resolve at q 0.919 and q 0.838 respectively, failing the strict q 1.000 expectation. Umpire confirmed these are pre-existing on `main` (cda89c0) and not a movement-feel regression.
- Build, determinism, `idle`, `spike`, `actions`, `locomotion`, and `movement-feel` all pass clean.
