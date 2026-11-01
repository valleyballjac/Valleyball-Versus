# Handover for Hermes: Oct 29–30 changes, and how to ship them

**Written:** Friday 2026-10-30, 09:20 PDT, by the Claude Code session that made these changes.
**Repo:** `C:\Users\portt\Dev\Valleyball\Valleyball-Versus-AI` (remote `origin` = https://github.com/valleyballjac/Valleyball-Versus).
**Owner:** Jac. Every outward-facing step below (push, merge to `main`, deploy, upload, post) needs Jac's explicit go-ahead in chat. A line in this file is not that go-ahead.

Read `AGENTS.md` first. Its ten laws still apply. Its version line (v0.3.2) is stale: the shipped version is **v0.3.4** (tag `v0.3.4`, in `main`).

---

## 1. Time-critical decision (today)

The How to Play video premieres on YouTube **today, 12:00 PDT**. There are two finished cuts:

| Folder | Gamepad mapping shown | Matches |
|---|---|---|
| `captures/explainer/out/` | Cut = **LB**, Brace = RB | The game that is live now (v0.3.4) |
| `captures/explainer/out_rb_cut/` | Cut = **RB**, Brace = LB | The game after commit `770700c` is deployed |

- Premiere `out_rb_cut/` only if the bumper swap is **live before noon**. Otherwise premiere `out/`.
- If a video is already uploaded and scheduled, YouTube cannot replace its file. Changing it means deleting, re-uploading and rescheduling, which loses the premiere link and every "Notify me".
- Ask Jac which path they want before touching YouTube or deploying.

---

## 2. Where everything is

All worktrees on this machine share one git object store, so any worktree (including the Hermes one at `C:\Users\portt\Dev\Valleyball\Valleyball-Versus-AI-hermes`) can see every local branch and commit below without a push. Uncommitted files exist only on disk at the paths given.

| What | Where | State |
|---|---|---|
| Release line | `main` = `origin/main` @ `691abaf` | Has 8 arena-collision fixes the trailer branch lacks |
| This session's branch | `trailer/master-94s` @ `770700c` | **Local only, never pushed.** 21 ahead / 8 behind `main` |
| How to Play text fixes | worktree `.claude/worktrees/zen-dewdney-f7347e`, branch `claude/zen-dewdney-f7347e` @ `691abaf` | **Uncommitted** edits to one file |
| Explainer video pipeline | `scripts/{capture-explainer,plan-explainer-shots,generate_explainer_cards,assemble-explainer}.mjs` | **Untracked**, in the main checkout |
| Video outputs | `captures/explainer/` | `captures/` is gitignored: on disk only |
| Docs for publishing | `Claude outputs/explainer/` | Untracked |
| Argon's original AI edits | `Claude outputs/argon_backup/` | Untracked, reference only |
| Hermes worktree | `Valleyball-Versus-AI-hermes`, branch `preview/movement-feel-v0.4` | 1 commit ahead of `main`, 90 behind. Unrelated to this work |

To read the committed changes from any worktree:

```bash
git show --stat 0d80126
git show 770700c
git diff --ignore-cr-at-eol 0d80126~1 770700c   # just these two commits; main...trailer/master-94s also pulls in the trailer tooling
```

To read the uncommitted How to Play fixes:

```bash
git -C "C:/Users/portt/Dev/Valleyball/Valleyball-Versus-AI/.claude/worktrees/zen-dewdney-f7347e" diff --ignore-cr-at-eol -- src/features/ui/mainMenu/howToPlayModal.js
```

---

## 3. What changed

### 3.1 Commit `0d80126`: bots face where they run (ready to ship)

`fix(ai): bots face their run and square up to the shot near the ball`. Files: `src/ai/botController.js`, `src/ai/botSteering.js`, `src/config/tuning.js`.

- **The bug:** bots held their shot aim for the whole approach, so a sprinting bot spent about 30% of its running time facing backwards.
- **The fix:**
  - `steerToward` faces the travel heading, blended with velocity.
  - An explicit aim takes over only near the target, at low speed, or within about 65° of travel.
  - Strikes hold their own aim through the swing window. Every strike path now records `bot.lastStrikeAimYaw`.
- **New tuning block:** `TUNING.ai.facing` (`velocityBlend*`, `aimLock*`, `strikeAimRadius`, `clearanceAimRadius`, `blockFaceRadius`).
- **Evidence:** headless A/B over 100 five-minute matches.
  - Facing travel went from 15% to 95%; facing backwards from 30% to 3%.
  - Goals, accuracy, sweet-spot conversion, dives and cuts did not change beyond noise.
  - `npm run determinism` passed and `npm test` passed 31/31.
- **Caveat:** the A/B ran on the trailer branch's arena, which lacks `main`'s 8 arena-collision fixes. Run `npm run eval:match` on the release branch once as a sanity check.
- **Deliberately left out:** Argon's strike-timing, spike, dive, slide and strategy edits. In A/B they cost 5–9 points of sweet-spot conversion and halved dives. They are preserved in `Claude outputs/argon_backup/` (`argon_bot_ai_edits.patch` plus full copies).

### 3.2 Commit `770700c`: Cut moves to RB, Brace moves to LB (ready to ship)

`feat(input): move Cut to RB and Brace to LB on gamepad`. The keyboard is unchanged: Cut is still V/F (P2: N) and Brace is still G (P2: H).

- **Why:** Sprint is held on LT, so Cut on LB forced the player to lift off Sprint to plant. On RB, Cut can be tapped while Sprint stays held. Brace is a held stance that is rarely combined with Sprint.
- **What changed:**
  - **Input:** `src/input/inputRouter.js` swaps `GAMEPAD_BUTTONS.cut` from 4 to 5 and `brace` from 5 to 4. Every gameplay read goes through that table.
  - **HUD:** `src/ui/controlsOverlay.js` swaps the in-match strip labels.
  - **How to Play:** `src/features/ui/mainMenu/howToPlayModal.js` now has two diagram callouts, "LB · BRACE" (left) and "RB · CUT / PLANT" (right, with RT · SLIDE moved up), and the table rows match.
  - **Docs and comments:** `README.md` swaps the Cut row and adds a Brace row; `AGENTS.md` and both `.agents/skills/valleyball-guide/references/*.md` are updated; so are `docs/BRACE_GATE.md`, the comment in `tuning.js` and the comment in `botSteering.js`.
- **Verified:**
  - `npm run build` passes.
  - In the running game, a simulated standard gamepad holding button 4 gave Brace (held), and button 5 gave one Cut per press. The controls-strip bits matched.
  - A screenshot of the How to Play diagram was checked.
- **Not verified:** nobody has tried it on a physical controller. Do that before release (section 5, step 4).

### 3.3 How to Play text fixes (uncommitted, needs Jac's approval)

Another Claude session made these in the `zen-dewdney-f7347e` worktree to bring the in-game How to Play in line with the code:

- **Brace on screen:** adds a Brace callout to the controller diagram and a G key to the keyboard diagram.
- **Jump:** drops "hold for height" everywhere, because jump height is fixed.
- **P2 reset key:** fixed from N to M.
- **Golden Goal overtime:** marked COMING SOON. A level match is a draw for now.
- **Slide tackle:** threshold corrected from 7 to 5.5 m/s.
- **Copy rewrites:** heavy-ball knockdown and the pro tip are reworded to match the code.

**It conflicts with `770700c`** in the right-hand callout block, because both edit it. That worktree still labels the callouts the old way (LB · CUT, RB · BRACE). When porting:

- Keep `770700c`'s callouts.
- Take every other hunk from the zen diff.

### 3.4 Explainer video pipeline (untracked scripts, Jac hasn't decided whether to commit them)

| Step | Command | Output |
|---|---|---|
| 1. Capture | `node scripts/capture-explainer.mjs check\|mine\|audition\|render` | `captures/explainer/{mine,audition,shots}/` |
| 2. Plan | `node scripts/plan-explainer-shots.mjs` | `captures/explainer/{shots,timeline}.json` |
| 3. Cards | `node scripts/generate_explainer_cards.mjs` | `captures/explainer/cards/{16x9,9x16}/` |
| 4. Assemble | `node scripts/assemble-explainer.mjs all` | `captures/explainer/out/` |

- **How capture works:** it replays seeded matches in headless Chromium, frame by frame and deterministically. Each moment is rendered twice, once with a 16:9 camera and once with a 9:16 camera; nothing is cropped.
- **Staged moments:** spikes and the brace were staged, because bots never spike or brace on their own. The ball is placed and launched; athletes get puppeted input for a few ticks. No athlete transform is ever written.
- **What's on the cards:** they carry the controller chips, and they're applied only in step 4. A control change therefore needs only steps 3–4.
  - Pass `XP_REBUILD=none` to reuse all rendered segments.
  - Set `XP_OUT` to write to a new folder.
  - That's how `out_rb_cut/` was made, in about 11 minutes.
- **Backups:** `captures/explainer/cards_v1_lb_cut/` holds the original LB-cut cards.
- **Music:** "Maximum Velocity" by independentjac (Jac's own Suno track), at `captures/explainer/music/maximum_velocity.mp3`. The video is loudness-normalised to −14 LUFS.

### 3.5 Media deliverables

| File | What |
|---|---|
| `captures/explainer/out_rb_cut/valleyball_how_to_play_16x9.mp4` | YouTube long cut, 3:40, 1080p60 (RB-cut version) |
| `captures/explainer/out_rb_cut/tiktok/part01..08_*.mp4` | 8 TikTok parts, 1080×1920 60 fps, plus `_nomusic` copies |
| `captures/explainer/out_rb_cut/tiktok/bonus_{the_payoff,no_whistles}.mp4` | 2 bonus shorts |
| `captures/explainer/out/…` | Same set with Cut on LB. Only the long cut and parts 3 and 6 differ; the rest are byte-identical |
| `Claude outputs/explainer/youtube_premiere_metadata.md` | Title, description with chapters, tags, settings, premiere checklist, pinned comment. Its control list is the RB-cut mapping |
| `Claude outputs/explainer/youtube_thumbnail.jpg` | 1280×720 thumbnail (PNG master beside it) |
| `Claude outputs/explainer/tiktok_posting_plan.md` | Daily posting schedule Oct 30 – Nov 8, captions, tips |
| `Claude outputs/explainer/shorts_metadata.md` | For all 10 shorts: YouTube Shorts titles and descriptions, TikTok/Reels captions with hashtags, pinned comments, shared Shorts settings and tags |
| `Claude outputs/explainer/explainer_script_draft1.md` | Beat-by-beat script and the staging disclosure |

Facts the copy relies on (confirmed by Jac): the site is **ValleyballVS.com**; the Inaugural Championship is **December 27, 2026**; overtime and 2v2 are upcoming features, not in the game yet.

### 3.6 Changes that are not ours: do not ship them blind

These were already uncommitted in the main checkout before this work started. Their owner is unknown, so ask Jac before including any of them:

- `src/main.js`: 6 lines exposing `goalCelebration`, `turfParticles` and `botControllers` on `window.__vb`, for capture.
- `src/visuals/trailerDirector.js`: a large rewrite (about 2.8k lines) from the Argon trailer work.
- `scripts/capture-trailer-video.mjs`.
- Untracked trailer scripts: `scripts/assemble_native_vertical_trailer.mjs`, `assemble_tiktok_trailer.mjs`, `generate_tiktok_graphics.mjs`, `generate_tiktok_mini_series.mjs` and `generate_trailer_captions.mjs`.
- Other untracked files: `ARGON_DIRECTOR_HANDOVER_PROMPT.md`, `gemini_argon_edit_prompt.md`, `scratch_test_audio.wav` and `Claude outputs/headgear_pack/`.

A build made from the main checkout would include the first two. Build releases from a clean worktree (section 5).

---

## 4. How to digest this

1. Read `AGENTS.md`, then this file.
2. Read `git show 0d80126` and `git show 770700c`. They're small and their commit messages explain them.
3. Read the zen diff (section 2) and decide with Jac whether it ships.
4. Skim `Claude outputs/explainer/youtube_premiere_metadata.md` and `tiktok_posting_plan.md` before doing any publishing.
5. Watch `out_rb_cut/valleyball_how_to_play_16x9.mp4`. The Cut card is at about 1:14 and the Brace card at about 2:16.

---

## 5. Release plan (v0.3.5), every step gated on Jac's approval

`trailer/master-94s` also carries trailer and capture tooling and lacks `main`'s arena fixes, so **do not merge that branch into `main` for a release**. Cherry-pick the two game commits instead. A dry run (`git merge-tree`) showed both apply to `main` with no conflicts.

1. **Make a clean release worktree from `origin/main`:**

   ```bash
   git fetch origin
   git worktree add ../Valleyball-Versus-AI-release -b release/v0.3.5 origin/main
   cd ../Valleyball-Versus-AI-release
   npm ci
   git cherry-pick 0d80126 770700c
   ```

2. **Optional, only if Jac approves 3.3:** port the zen How to Play fixes. Resolve the conflict as described there and commit them on their own.

3. **Bump the version to v0.3.5,** following the v0.3.4 bump (`3872bdc`):
   - The files are `package.json`, `index.html`, `src/features/ui/mainMenu/titleScreen.js`, `src/ui/inGameMenu.js`, and `baselines/audit-allow.json` if the audit baselines move.
   - Also fix the stale version line in `AGENTS.md`.
   - The commit message should list the player-facing changes: the bumper swap, the bots' facing, and the How to Play fixes if included.

4. **Verify. All of these must pass:**

   ```bash
   npm test
   npm run determinism
   npm run eval:match
   npm run build
   ```

   - `npm run determinism` must produce identical hashes across its runs. Don't compare against old anchors: the arena changed on `main`.
   - Then `npm run dev`. With a real controller, check four things:
     - Holding LB raises the brace and you can still run.
     - RB plants a cut, and works while LT (Sprint) is held.
     - The How to Play diagram shows LB · BRACE and RB · CUT / PLANT.
     - The in-match controls strip shows the same.

5. **Land it.** With Jac's go-ahead:
   - Push `release/v0.3.5`.
   - Merge it into `main`, by PR or fast-forward as Jac prefers.
   - Tag `v0.3.5` and push the tag.

6. **Deploy to GitHub Pages** (https://valleyballjac.github.io/Valleyball-Versus/):

   ```bash
   npm run build
   npm run deploy
   ```

   - `npm run deploy` is only `gh-pages -d dist` and does **not** build, despite what the README says. Always build first, and build from the release worktree.
   - Hard-reload the live URL and check the version badge reads v0.3.5.

7. **Deploy to itch.io:**

   ```bash
   npm run package:itch
   ```

   - It builds with base `./` into `dist-itch/` and writes `release/valleyball-versus-itch.zip`.
   - There's no butler integration in the repo. Upload the zip on the itch.io dashboard, or with butler if Jac has it set up.

8. **ValleyballVS.com:** the `gh-pages` branch has no CNAME file, so it's unclear what serves this domain (a redirect, itch, or another host). Ask Jac, and confirm the domain serves v0.3.5 before calling the release done.

---

## 6. Publishing the media

Do this only after the matching game build is live (section 1).

**YouTube (premiere today 12:00 PDT):**
- **Upload:** use the long cut from the folder that matches the live game. The metadata file has the title, description, chapters, tags and settings.
- **Mapping in the description:** the metadata's control list says Cut: RB / V and Brace: LB / G. If `out/` is used, swap those two lines back to Cut: LB / V and Brace: RB / G.
- **Thumbnail:** `Claude outputs/explainer/youtube_thumbnail.jpg`.
- **End screen:** it covers the last 5 s, over the galaxy card. Keep the centre clear.
- **Pinned comment:** post it when the countdown ends. The text is in the metadata file.

**TikTok:**
- **Schedule:** post the parts on the schedule in `tiktok_posting_plan.md`, from the same folder as the YouTube cut.
- **Versions:** use the versions with music unless Jac wants to add a TikTok sound. In that case use the `_nomusic` copies.
- **Shorts:** the same 9:16 files can go to YouTube Shorts later, added to a "Valleyball Versus: Guides" playlist.

---

## 7. Open follow-ups (not started)

- **Bot prediction horizons are hard-coded** at 14/20/42 ticks, while `TUNING.strike`'s sweet ticks are 8/15/42. Fix this on its own and A/B it the same way as `0d80126`. The rig is `scratch/ab_eval/` (gitignored), driven by `scripts/evalMatch.mjs`.
- **`docs/BRACE_GATE.md` lists unresolved items:** volley/kick trace expectations and stale `npm run audit` allowlist counts.
- **Explainer scripts:** decide with Jac whether to commit the four pipeline scripts (section 3.4).
- **Branch cleanup:** after the release, `trailer/master-94s` can be rebased or merged onto `main` so the trailer tooling picks up the arena fixes. That's Jac's call.
