# Valleyball Versus roadmap

Last updated 2026-11-10. This is the one place for what comes next. [AGENTS.md](../AGENTS.md) holds the rules and [the Gameplay Source of Truth](VALLEYBALL_GAMEPLAY_SOURCE_OF_TRUTH.md) holds the rules of the sport.

## Shipped: v0.4.0

Brought full 1v1 and 2v2 team gameplay, per-controller lobby navigation, right-aligned title menu, staggered idle poses, individual + collective team stats, inertia-scaled angular tracking + 4-tick buzz filtering, unified 8/15/42-tick AI strike & ballistic hoop targeting, and fixture support onto the release build.

---

## Now: v0.4.1 — Simplification, Efficiency, Bug Fixes, Docs & Core Completeness

Focuses on streamlining the post-v0.4.0 codebase, eliminating dead/vestigial code, unlocking major CPU/GPU frame-time efficiencies, fixing silent 2v2 AI and physics bugs, standardizing human + AI documentation across `src/`, and completing small unfinished match features (`Overtime Tiebreaker Menu` and `2v2 Fixtures`).

### 1. Modular Extraction (`src/main.js` Diet) & State Consolidation
- [ ] **Finish `ViewportManager` (`src/features/camera/viewportManager.js`)**: Move 1-screen, 2-way splitscreen, 4-way quad splitscreen, camera mode notifications, and post-processing out of `src/main.js`.
- [ ] **Finish `MatchManager` (`src/features/match/matchManager.js`)**: Fix `startMatch()` property names (`'N'`/`'S'`, `ticksRemaining`) and consolidate the 4 duplicate `matchState` reset blocks (`handleStartMatch`, `handleRematch`, `handleStartPractice`, `gui.js`).
- [ ] **Extract Dedicated Subsystems from `src/main.js`**:
  - `src/ui/hudOverlay.js` — HUD telemetry DOM caching, FPS/perf readouts, drag/weight displays.
  - `src/features/match/practiceMode.js` — Practice drill setup, 3-ball activation, `resetPracticeStats`.
  - `src/debug/hotkeys.js` — Dev keyboard shortcuts (`KeyK` knockdown, `Backspace` respawn, camera/headgear cycling).
- [ ] **Purge Dead Code & Unused Imports**:
  - Delete the ~250 lines of dead single-athlete G3.5 code in `src/main.js` (`spawnRagdoll`, `logL5Residuals`, `driveAttenuation`..`isTumbling`, dead `tracker`/`mountFollowerState`/`actionState`/`strikeState`, missing `models/actions.glb` reference).
  - Delete the 5 unused `src/features/*/index.js` barrel files, unused `AthleteManager` lifecycle methods, and all 42 `dead-import` entries in `baselines/audit-allow.json`.
- [ ] **Unify Menu State (`state.js` + `playerSetup.js`)**: Merge duplicated `playerConfigs` and remove the ~35 dead state fields in `src/features/ui/mainMenu/state.js`; fix D-pad/keyboard AI Playstyle chip highlighting (`DEF`, `BAL`, `AGG`, `ALL`).

### 2. Physics, AI, Audio & Cosmetics Bug Fixes & Cleanup
- [ ] **Fix `src/sim/motor.js` Bowl Remnant & Shared State**:
  - Replace circular-bowl math (`Math.hypot(x, z) > 8.0`) in `applyCleatAnchor` with actual `groundNormal` slope checks for the rectangular Valley Court.
  - Move `_lastHitRingIndex` from a module-level global onto each `motor` instance so multi-athlete ground-ray temporal coherence works.
  - Re-record determinism and scenario trace baselines once all scenario assertions pass.
- [ ] **Fix Silent 2v2 AI Bugs in `src/ai/botController.js` & `src/ai/botPerception.js`**:
  - Fix `mateBusy` (`teammate.tracker?.weight < 0.5 || teammate.isDiving?.()`), populate `opponent.isKnockedDown` in `botPerception.js`, replace `!trajectory.weHavePriority` with `trajectory.firstTouchBy !== 'self'`, fix `self.speedXZ` -> `self.speed`, and fix premature slide abort threshold (`dangerLowSpeed`).
  - Wire the 7 disconnected AI tuning keys (`strikeHeightMin/Max`, `defenseDepth`, `arriveRadiusChase/Position/Strike`, `jumpHeightThreshold`) from `TUNING.ai` into `botController.js` / `botSteering.js`.
  - Remove stale `trained_params.json`, dead `MULTI_STAGE_ATTACK` state machine, and 4 unused `botSteering.js` exports.
- [ ] **Fix `resetTuning()` Deep Copy (`src/config/tuning.js`)**: Deep-clone `DEFAULTS` so runtime mutations cannot corrupt nested config objects, and remove dead config keys.
- [ ] **Audio Cleanup (`src/audio/soundManager.js` & `public/audio/`)**: Delete empty `playSneakerSqueak`, `playProceduralSqueak`, and `updateBallRolling` stubs, stop preloading 4 unused WAV keys, and delete unreferenced squeak/roll/duplicate WAV files.
- [ ] **Cosmetics Cleanup**: Delete dead `createCurvedBaseballVisorGeo` in `src/sim/ragdoll.js`, remove the 5 superseded headwear builders and unreachable `isSignature` branches in `src/sim/cosmeticsBuilders.js`, and deduplicate visor/palette/math/PRNG helpers.

### 3. Runtime Performance & Frame-Time Efficiencies
- [ ] **Cache 2v2 AI Ball Trajectory (`src/ai/botPerception.js`)**: Share `simulateLongHorizonTrajectory` per `(ball, tick)` across all bots on the same tick (75% reduction in 2v2 trajectory CPU work).
- [ ] **Skip Hidden Skeleton Sync (`src/sim/ragdoll.js`)**: Guard `syncRagdollPose` bone matrix updates with `if (state.characterRoot?.visible)`.
- [ ] **Pre-Invert Static Bind Matrices (`src/sim/autorig.js`)**: Pre-compute `bindBoneToBody` and `bindBodyToBone` once at rig creation (eliminating 3,840 `Matrix4.invert()` calls/sec across 4 athletes).
- [ ] **Eliminate Hot-Loop Allocations & Console Spam**:
  - Gate `auditSkeleton()` + `console.table()` in `autorig.js` and hot-loop `console.log()` calls in `strikes.js` / `actions.js` behind debug flags.
  - Replace per-tick/per-frame allocations in `computeCompensatedAimAndSpeed`, `scoring.js`, `PlayerCamera`/`SportsCamera` (`getForwardXZ`/`getRightXZ`), `inputRouter.js`, `hustleBoards.js` (dirty-tick gate), `countdownOverlay.js`, and `turfParticles.js` (`instanceColor.needsUpdate` only when dirty).
- [ ] **Skybox Animation in Splitscreen & Flyover**: Call `updateCelestialSkybox` in 2-player splitscreen, 4-player quad splitscreen, and menu flyover modes.

### 4. Tied-Match Overtime Menu, 2v2 Fixtures & Snapshot Foundation
- [ ] **Tied-Match / Overtime Decision Menu**: When regulation (`00:00`) ends in a tie, pause physics in place and present an Overtime Agreement Menu allowing players to choose:
  - **Accept Draw / End Match** vs **Start Overtime**
  - **Overtime Format**: `Golden Goal (Next Goal Wins)` vs `Timed Overtime` (`1:00`, `2:00`, `3:00`, `5:00`)
  - **Player Position**: `Resume Live in Place` (unfreeze exact court positions/velocities) vs `Stream Head Respawn` (respawn on stream heads **aligned with each team's current defending/attacking goal orientation** after end flips, with a midfield ball drop).
- [ ] **2v2 Fixture Support (`?fixture=`) & 4-Player Victory Cam**: Extend `src/features/match/matchFixture.js` and `reportMatchResult` to 4-athlete 2v2 matches, and fix victory screen winner/team camera targeting.
- [ ] **Compact `InputFrame` & `WorldSnapshot` Serializer (`src/core/snapshot.js`)**: Lay the binary/typed-array serialization foundation for v0.4.2 `.vbreplay` recording, Spectator ring-buffer replays, and Desktop LAN.

### 5. Human + AI Code Comments & Scripts / CI Gate
- [ ] **Codebase-Wide Comment Pass**: Add clear **Module Headers** (Role, Frame Phase, Active Invariants), replace cryptic historical gate shorthand (`G3.5 Option B`) with plain-English *"Why"* explanations, fix all contradictory/stale comments, and document JSDoc units + scratch-buffer contracts.
- [ ] **Certify `corner-fan` Audit & Clean Up `scripts/`**: Update `scripts/audit_collision_coverage.mjs` so full `npm run audit` runs in CI, fix `scripts/generate_court_heightmap.mjs`, move arena GLB patchers to `scripts/arena-patches/`, commit `.github/workflows/desktop.yml` + `scripts/desktop_smoke.mjs`, and remove broken v0.2 Python capture and one-off marketing scripts.

---

## Next: v0.4.2 — Spectating, Replays, Desktop LAN, Music & Championship Polish

Builds on the clean v0.4.1 foundation to deliver tournament broadcast/spectating tools, local network play, full audio atmosphere, and 2v2 AI depth ahead of the **December 27, 2026 Inaugural Championship**.

### 1. Spectator Mode, Broadcast Director & Match Replays (`.vbreplay`)
- [ ] **Compact Match Recording (`.vbreplay`)**: Record match seed + 60 Hz `InputFrame` log (~40 KB per 5-minute match) so any match can be saved, re-watched from any angle, or fed directly into the highlight-mining pipeline.
- [ ] **Live Broadcast Director Camera**: Auto-switching camera director (Sideline Broadcast, Rim Orbit on aerial contests, Player Chase on fast breaks) for live tournament streams and bot-vs-bot exhibitions.
- [ ] **Free-Fly / Caster Drone Camera**: Smooth controller or mouse/WASD free-camera for live tournament commentators and video capture.
- [ ] **Spectator-Only Instant Replays**: Rolling 5-second `WorldSnapshot` transform ring buffer driving post-goal Picture-in-Picture / Rim-Cam instant replays **strictly on the Spectator view and Replay Viewer** (never interrupting live players' Continuous Momentum on court).

### 2. Desktop LAN Multiplayer & Dual-Monitor Tournament Spectator
- [ ] **Multi-PC LAN Play & Spectating (`electron/`)**: Auto-discovered local network rooms over UDP/WebSocket allowing 1–4 Player PCs (each with full-screen chase cameras at native 144–240 Hz) plus unlimited Spectator PCs on the local switch/router.
- [ ] **Single-PC Dual-Monitor Spectator Window**: Optional second Electron window outputting the clean Broadcast Director + Spectator Instant Replays + Hustle Telemetry to a tournament projector or capture card while players play on the primary display.

### 3. Audio Atmosphere (`musicManager.js` & Crowd Reactions)
- [ ] **In-Game Music Manager**: Bring `src/audio/musicManager.js` and soundtrack stems from `archive/trailer-debut-v2` onto `main` with menu/in-game mix controls.
- [ ] **Reactive Crowd Audio**: Dynamic crowd swells reacting to supersonic strikes, rim clanks, clutch dive saves, and overtime tension.

### 4. 2v2 AI Chemistry & Evolutionary Re-Training
- [ ] **2v2 Off-Ball & Aerial Chemistry**: Tune bot setter/spiker coordination, standing/jump spike frequency, and multi-touch combinations.
- [ ] **Evolutionary Training Sweep**: Run `npm run train:bot` with the 7 newly wired genome parameters and validate via `npm run eval:match`.

### 5. Inaugural Championship Readiness (December 27, 2026)
- [ ] **4-Controller Hub & Defocus Soak Test**: Verify 4 controllers on a USB hub with window defocus (`backgroundThrottling: false`).
- [ ] **Cross-Platform Desktop Builds**: Run and verify the GitHub Actions "Desktop builds" workflow (`.github/workflows/desktop.yml`) for Windows, macOS, and Linux.
- [ ] **Public Distribution Prep**: Windows code-signing certificate, macOS notarization, Linux AppImage/sandbox handling, and `steamworks.js` integration once the Steam page is live.
