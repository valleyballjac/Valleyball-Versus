# Agile brace — local gate and play verdict

Branch: `wt/t_417afc44` (based on local `main`; this checkout has no local `rebuild/core`). No branch was pushed or merged.

Design: Hold G (P1), H (P2), or RB/R1 (gamepad) to blend 40% of the authored two-hand volley pose into the existing locomotion/air/strike blend. The other 60% remains available to ordinary locomotion while otherwise healthy. The physical ragdoll arms, not a bespoke ball impulse or proximity resolver, deflect a ball. The motor receives the same input and drive scale as before. Releasing the button eases the pose back out. Balance loss fades the brace out with `tracker.weight`.

The architecture document's September roadmap describes a bowl anchor, but the current AGENTS.md retires that bowl and names Valley Court the canonical determinism arena. Follow AGENTS.md on this current tree; the old handoff is historical, not a command to change arenas. This is a local seed tune, not a designer-approved feel setting.

Step 1 — build and simulation laws, from the repository root:

- `npm ci --no-audit --no-fund && npm run build && git diff --check` — expect build success, zero diff errors.
- Census (run on this change once before writing this gate): `git diff -U0 -- src/input/inputRouter.js src/mechanics/actions.js src/sim/animtarget.js src/sim/athlete.js src/main.js src/config/tuning.js | grep '^+' | grep -E 'setLinvel|setTranslation|Math.random|Date.now|performance.now|setLinearDamping|setAngularDamping' | wc -l` — measured **0** added forbidden calls. `git diff -U0 -- src/input/inputRouter.js src/mechanics/actions.js src/sim/animtarget.js src/sim/athlete.js src/main.js src/config/tuning.js | grep '^+' | grep -E 'braceMix: actions.braceMix' | wc -l` — measured **2** handoffs (entity and legacy orchestrator).
- Human-only: play 10 ground runs holding guard, and confirm locomotion remains responsive in **10/10**; note any frame where the athlete appears pinned.

Step 2 — action and contact fixtures:

- `npm run trace -- --name brace --runs 2`; `npm run trace -- --name braceContact --runs 2`; `npm run trace -- --name braceControl --runs 2` — expect PASS and all per-tick rows byte-identical within each pair. `braceContact` and `braceControl` use the same ball serve: the braced ball's lateral x exceeds 0.8 m by tick 105, versus |x| < 0.2 m without bracing; zero strike resolves. These are narrow fixtures, not a general save-rate claim.
- Human-only: serve or shoot 10 balls toward the defender while moving laterally and holding the guard; count **at least 7/10** visibly altered by hand/forearm contact, and report saved goals separately from incidental torso bounces. This seed threshold is for Jac to judge, not machine-certified.

Step 3 — baseline regression and laptop anchor:

- `npm run trace -- --name all --runs 2` and `npm run determinism` on Jac's laptop; record exact court hashes and failures, never assume old anchors transfer. In the local run, the action, locomotion, idle, spike and brace scenarios passed; the volley and kick scenarios self-consistently resolved a strike but failed their expected full-quality log. These were not silently counted as green; they need an independent regression triage. `npm run audit` also failed against stale size/tuning-write/dead-import allowlist counts (e.g. main.js baseline 3764 versus current tree 3919 lines). Do not approve on the basis of build alone.
- Human-only: alternate 10 braced and 10 unbraced sprints, cuts, and jumps on the sloped court. Report **10/10** successful movement inputs in each set, plus any 180-degree arm twist, body clip, or obscured ball; if one occurs, the gate is red regardless of simulation hash.
