# Archive index

Nothing here describes the current game. For that, see [AGENTS.md](../../AGENTS.md), [the roadmap](../ROADMAP.md) and [the Gameplay Source of Truth](../VALLEYBALL_GAMEPLAY_SOURCE_OF_TRUTH.md).

## Documents in this folder

| File | What it is |
|---|---|
| `Phase2_PostMortem_Handover.md` | Phases 1 and 2 handover, September 2026 |
| `ARCHITECTURAL_SOURCE_OF_TRUTH.md` | Phase 3 handoff, gates G1 to G4.1. Its title predates AGENTS.md, which now takes precedence |
| `POST_MORTEM_AND_HANDOVER_v0.2.0.md` | Phase 4 post-mortem and the v0.2.0 architecture tour |
| `AI_HANDOVER.md` | AI opponents handover, September 2026 |
| `PHASE0_REPORT.md` | Rebuild baseline, including performance numbers |
| `weights.md` | Every writer and reader of `tracker.weight`, derived at G3.5 |
| `motor-authority-review.md` | Walk floor and braking review |
| `BRACE_GATE.md` | Agile brace gate and its open items |
| `HERMES_HANDOVER_2026-10-30.md` | Bot facing, bumper swap and explainer pipeline handover |
| `ELECTRON_DESKTOP_HANDOFF_2026-11-07.md` | Plan for the Electron desktop build. Implemented in `electron/`, which differs where the plan was wrong: vsync stays on, the bundle is served over `app://` rather than `file://`, and there is no `in-process-gpu` |

## Code preserved in git tags

These tags hold work that is not on `main`. To look at one, run `git show <tag>`. To bring code back, cherry-pick it onto a branch from `main`. Don't merge the trailer tags: they track 211 MB of `Claude outputs`.

| Tag | What it holds |
|---|---|
| `archive/trailer-debut-v2` | Source of the 2026-10-31 debut trailer, the trailer director and the music manager |
| `archive/primary-wip-2026-11-01` | Everything uncommitted in the main checkout on 2026-11-01, sorted into four commits (below) |
| `archive/menu-input-blockers` | The lobby and input fixes as originally built on trailer history |
| `archive/league-fixtures` | `?fixture=` as originally built on trailer history |
| `archive/trailer-pass1-backup` | First trailer pass |
| `archive/ai-opponents-original` | Original AI opponents branch; the system reached `main` through `6f268bf` |
| `archive/locker-claude` | Locker stages 1-2 experiment |
| `archive/locker-gemini` | Locker experiment with the in-engine photo booth, which exists only here |
| `archive/movement-feel-v0.4` | Movement sweep branch; the tuning is on `main` and the report is in `reports/` |
| `archive/demo-*` | Three unreferenced commits rescued from the old `Valleyball-Demo` clone, September 2026 |

Commits inside `archive/primary-wip-2026-11-01`:

| Commit | Contents |
|---|---|
| `45aa355` | Trailer rig edits, TikTok and caption scripts |
| `4f5451e` | How to Play explainer pipeline and publishing docs |
| `94fc5ca` | Halloween 2026 pumpkin ball skins |
| `c424d12` | Agent prompts, Argon AI backup, headgear pack |

## Files outside the repo

Renders and deliverables are not in git. They live next to the repo, in `../media`:

- `media/claude-outputs/`: trailer masters, explainer publishing docs, headgear pack and earlier outputs
- `media/agent-handovers/`: Hermes, Argon and Gemini handover prompts
- `media/debut-trailer-render-inputs/`: raw footage, stems and captions behind the final debut trailer, for `--composite-only` re-encodes
- `media/raw-footage-capture-worktree/`: 54 clips and masters from the Oct 24 trailer pass that exist nowhere else
- `media/demo-clone-scraps/`: tuning files, test scripts and the v0.3.1 itch.io zip from the old `Valleyball-Demo` clone
