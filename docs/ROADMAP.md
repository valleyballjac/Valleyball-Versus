# Valleyball Versus roadmap

Last updated 2026-11-18. This is the one place for what comes next. [AGENTS.md](../AGENTS.md) holds the rules and [the Gameplay Source of Truth](VALLEYBALL_GAMEPLAY_SOURCE_OF_TRUTH.md) holds the rules of the sport.

## Shipped: v0.4.0

Brought full 1v1 and 2v2 team gameplay, per-controller lobby navigation, right-aligned title menu, staggered idle poses, individual + collective team stats, inertia-scaled angular tracking + 4-tick buzz filtering, unified 8/15/42-tick AI strike & ballistic hoop targeting, and fixture support onto the release build.

---

## Shipped: v0.4.1 — Simplification, Efficiency, Menu & Controller Overhaul, Docs & Core Completeness

Streamlined the post-v0.4.0 codebase, eliminated dead/vestigial code, unlocked major CPU/GPU frame-time efficiencies, fixed silent 2v2 AI and physics bugs, standardized human + AI documentation across `src/`, completed `Overtime Tiebreaker Menu` and `2v2 Fixtures`, and overhauled the Main Menu, Controller Assignment, Player Setup, and Match Rules flows across Keyboard & Mouse, Standard Gamepad, and Fighting Pad / Arcade Stick.

### 1. Modular Extraction (`src/main.js` Diet) & State Consolidation
- [x] **Finish `ViewportManager` (`src/features/camera/viewportManager.js`)**: Move 1-screen, 2-way splitscreen, 4-way quad splitscreen, camera mode notifications, and post-processing out of `src/main.js`.
- [x] **Finish `MatchManager` (`src/features/match/matchManager.js`)**: Fix `startMatch()` property names (`'N'`/`'S'`, `ticksRemaining`) and consolidate the 4 duplicate `matchState` reset blocks (`handleStartMatch`, `handleRematch`, `handleStartPractice`, `gui.js`).
- [x] **Extract Dedicated Subsystems from `src/main.js`**:
  - `src/ui/hudOverlay.js` — HUD telemetry DOM caching, FPS/perf readouts, drag/weight displays.
  - `src/features/match/practiceMode.js` — Practice drill setup, 3-ball activation, `resetPracticeStats`.
  - `src/debug/hotkeys.js` — Dev keyboard shortcuts (`KeyK` knockdown, `Backspace` respawn, camera/headgear cycling).
- [x] **Purge Dead Code & Unused Imports**:
  - Delete the ~250 lines of dead single-athlete G3.5 code in `src/main.js` (`spawnRagdoll`, `logL5Residuals`, `driveAttenuation`..`isTumbling`, dead `tracker`/`mountFollowerState`/`actionState`/`strikeState`, missing `models/actions.glb` reference).
  - Delete the 5 unused `src/features/*/index.js` barrel files, unused `AthleteManager` lifecycle methods, and all 42 `dead-import` entries in `baselines/audit-allow.json`.
- [x] **Unify Menu State (`state.js` + `playerSetup.js`)**: Merge duplicated `playerConfigs` and remove the ~35 dead state fields in `src/features/ui/mainMenu/state.js`; fix D-pad/keyboard AI Playstyle chip highlighting (`DEF`, `BAL`, `AGG`, `ALL`).

### 2. Physics, AI, Audio & Cosmetics Bug Fixes & Cleanup
- [x] **Fix `src/sim/motor.js` Bowl Remnant & Shared State**:
  - Replace circular-bowl math (`Math.hypot(x, z) > 8.0`) in `applyCleatAnchor` with actual `groundNormal` slope checks for the rectangular Valley Court.
  - Move `_lastHitRingIndex` from a module-level global onto each `motor` instance so multi-athlete ground-ray temporal coherence works.
  - Re-record determinism and scenario trace baselines once all scenario assertions pass.
- [x] **Fix Silent 2v2 AI Bugs in `src/ai/botController.js` & `src/ai/botPerception.js`**:
  - Fix `mateBusy` (`teammate.tracker?.weight < 0.5 || teammate.isDiving?.()`), populate `opponent.isKnockedDown` in `botPerception.js`, replace `!trajectory.weHavePriority` with `trajectory.firstTouchBy !== 'self'`, fix `self.speedXZ` -> `self.speed`, and fix premature slide abort threshold (`dangerLowSpeed`).
  - Wire the 7 disconnected AI tuning keys (`strikeHeightMin/Max`, `defenseDepth`, `arriveRadiusChase/Position/Strike`, `jumpHeightThreshold`) from `TUNING.ai` into `botController.js` / `botSteering.js`.
  - Remove stale `trained_params.json`, dead `MULTI_STAGE_ATTACK` state machine, and 4 unused `botSteering.js` exports.
- [x] **Fix `resetTuning()` Deep Copy (`src/config/tuning.js`)**: Deep-clone `DEFAULTS` so runtime mutations cannot corrupt nested config objects, and remove dead config keys.
- [x] **Audio Cleanup (`src/audio/soundManager.js` & `public/audio/`)**: Delete empty `playSneakerSqueak`, `playProceduralSqueak`, and `updateBallRolling` stubs, stop preloading 4 unused WAV keys, and delete unreferenced squeak/roll/duplicate WAV files.
- [x] **Cosmetics Cleanup**: Delete dead `createCurvedBaseballVisorGeo` in `src/sim/ragdoll.js`, remove the 5 superseded headwear builders and unreachable `isSignature` branches in `src/sim/cosmeticsBuilders.js`, and deduplicate visor/palette/math/PRNG helpers.

### 3. Runtime Performance & Frame-Time Efficiencies
- [x] **Cache 2v2 AI Ball Trajectory (`src/ai/botPerception.js`)**: Share `simulateLongHorizonTrajectory` per `(ball, tick)` across all bots on the same tick (75% reduction in 2v2 trajectory CPU work).
- [x] **Skip Hidden Skeleton Sync (`src/sim/ragdoll.js`)**: Guard `syncRagdollPose` bone matrix updates with `if (state.characterRoot?.visible)`.
- [x] **Pre-Invert Static Bind Matrices (`src/sim/autorig.js`)**: Pre-compute `bindBoneToBody` and `bindBodyToBone` once at rig creation (eliminating 3,840 `Matrix4.invert()` calls/sec across 4 athletes).
- [x] **Eliminate Hot-Loop Allocations & Console Spam**:
  - Gate `auditSkeleton()` + `console.table()` in `autorig.js` and hot-loop `console.log()` calls in `strikes.js` / `actions.js` behind debug flags.
  - Replace per-tick/per-frame allocations in `computeCompensatedAimAndSpeed`, `scoring.js`, `PlayerCamera`/`SportsCamera` (`getForwardXZ`/`getRightXZ`), `inputRouter.js`, `hustleBoards.js` (dirty-tick gate), `countdownOverlay.js`, and `turfParticles.js` (`instanceColor.needsUpdate` only when dirty).
- [x] **Skybox Animation in Splitscreen & Flyover**: Call `updateCelestialSkybox` in 2-player splitscreen, 4-player quad splitscreen, and menu flyover modes.

### 4. Tied-Match Overtime Menu, 2v2 Fixtures & Snapshot Foundation
- [x] **Tied-Match / Overtime Decision Menu**: When regulation (`00:00`) ends in a tie, pause physics in place and present an Overtime Agreement Menu allowing players to choose:
  - **Accept Draw / End Match** vs **Start Overtime**
  - **Overtime Format**: `Golden Goal (Next Goal Wins)` vs `Timed Overtime` (`1:00`, `2:00`, `3:00`, `5:00`)
  - **Player Position**: `Resume Live in Place` (unfreeze exact court positions/velocities) vs `Stream Head Respawn` (respawn on stream heads **aligned with each team's current defending/attacking goal orientation** after end flips, with a midfield ball drop).
- [x] **2v2 Fixture Support (`?fixture=`) & 4-Player Victory Cam**: Extend `src/features/match/matchFixture.js` and `reportMatchResult` to 4-athlete 2v2 matches, and fix victory screen winner/team camera targeting.
- [x] **Compact `InputFrame` & `WorldSnapshot` Serializer (`src/core/snapshot.js`)**: Lay the binary/typed-array serialization foundation for v0.4.2 `.vbreplay` recording, Spectator ring-buffer replays, and Desktop LAN.

### 5. Human + AI Code Comments, Menu/Controller Overhaul & CI Gate
- [x] **Codebase-Wide Comment Pass**: Add clear **Module Headers** (Role, Frame Phase, Active Invariants), replace cryptic historical gate shorthand (`G3.5 Option B`) with plain-English *"Why"* explanations, fix all contradictory/stale comments, and document JSDoc units + scratch-buffer contracts.
- [x] **Certify `corner-fan` Audit & Clean Up `scripts/`**: Update `scripts/audit_collision_coverage.mjs` so full `npm run audit` runs in CI, fix `scripts/generate_court_heightmap.mjs`, move arena GLB patchers to `scripts/arena-patches/`, commit `.github/workflows/desktop.yml` + `scripts/desktop_smoke.mjs`, and remove broken v0.2 Python capture and one-off marketing scripts.
- [x] **Menu & Controller UX Overhaul**: Homogenized reversed-rainbow Title Screen (`P1` control only), Fighting Pad / Arcade Stick `D-Pad Move` mode, 4-diamond cardinal face-button prompts, live mini-screen viewport corner badges, per-controller color cursors (`P1` Cyan, `P2` Coral, `P3` Gold, `P4` Violet), `P2–P4` column locking, top-to-bottom Match Rules (`P1` rules only), per-player Ready lock, and silenced background menu ball impacts.

---

## Shipped: v0.4.2 (Dec 27 Championship Build, 2026-11-22)

Shipped the live local tournament and public web/desktop build ahead of the **December 27, 2026 Inaugural Championship** (1 to 2 local PC stations, 5-minute timed matches, Golden Goal overtime, Standard assist, 1.0m Medium Ball).

### 1. Broadcast Replay Director Suite (v3 `.vbreplay`)
- [x] **v3 World-State Pose Keyframe Recording (`src/core/replayPose.js`)**: Automatically records 30 Hz ball and 16-part athlete ragdoll transforms plus scoreboard state for zero-desync playback and sub-millisecond (`< 0.2 ms`) instant timeline click-and-drag scrubbing. Auto-saves silently in Electron (`userData/replays`) and supports Save/Load `.vbreplay` files.
- [x] **Full Director Transport, Slow-Mo, Camera Height & Clip Export (`src/ui/replayDock.js`)**: Prominent Play/Pause, dedicated Slow-Mo (`0.5x`, `0.25x`, `0.1x`), continuous Rewind (`-1x`, `-2x`, `-4x`), Fast-Forward (`2x`, `4x`), `+` / `-` camera height controls across all 7 cameras and Free Drone, `P1` to `P4` athlete targeting, color-coded goal-scorer timeline pins, clickable Goal Scorer Strip, Broadcast Goal Callout Banner, and clean in-app `.webm` clip recording.

### 2. Gameplay, Physics, Performance & UX Polish
- [x] **2.5x Frame-Rate Optimization (`src/sim/meshBatcher.js`, `viewportManager.js`, `ragdoll.js`)**: Batched static arena meshes (preserving vertex colors on purple corner wedges) and headwear, optimized Balanced lighting and splitscreen pixel-ratio defaults (`2P Splitscreen Balanced`: `49.9 FPS -> 131.0 FPS`, draw calls `312 -> 182`).
- [x] **Full Ball-Clearance Scoring & Instant Unthreading (`src/mechanics/scoring.js`)**: Goal registers once the full ball volume crosses `x = 0`, enabling clean goal-line saves on partial pokes and instant responding goals when a scored ball is swatted straight back through the hoop. Enforced strict single-ball regulation matches across Quick Play, Setup, and scoring.
- [x] **Arena Corner Lip Seal & Audio Limiter (`src/sim/arena.js`, `soundManager.js`)**: Removed `FIX_INTERNAL_EDGES` from barrier/goal trimeshes, welded curved corner fan rim skirts (`0/264` breaches across Small/Medium/Large balls), and rate-limited rolling glass impact audio to `<= 2/sec`.
- [x] **Multiplayer Reliability, Setup & How To Play Overhaul**: Fixed Match 1 P2 controller activation, added 3D spinning Match Ball preview, fixed Practice setup head spin and simplified Practice to Free Sandbox, fixed `A` advance in setup menus, and rebuilt How To Play across Standard Gamepad, Fighting Pad / Arcade Stick, and Keyboard & Mouse.
- [x] **USB-Hub Reconnect & Defocus Safety**: Verified Electron `backgroundThrottling: false`, latched gamepad states across window blur, added hardware-ID reconnect recovery, and removed noisy synthetic `hoop_swish.wav`.

### Remaining Pre-Championship Local Polish
- [ ] **In-Game Music Manager (Stretch / Next Up)**: Bring `src/audio/musicManager.js` and soundtrack stems onto `main` with menu/in-game mix controls once core playtest and venue milestones are locked.
- [ ] **Pre-Championship 4-Controller Soak**: Run a live 4-controller USB-hub soak session at a Monday playtest before Dec 27.

---

## Next: v0.4.3+ (Post-Championship, Jan 2027+)

Deferred intentionally so Dec 27 focus stays on local playtests, tournament execution, and community growth:

### 1. Broadcast Director & Spectator Instant Replays
- [ ] **Live Broadcast Director Camera**: Auto-switching camera director (Sideline Broadcast, Rim Orbit on aerial contests, Player Chase on fast breaks).
- [ ] **Free-Fly / Caster Drone Camera**: Smooth controller or mouse/WASD free-camera for live casters and video capture.
- [ ] **Spectator-Only Instant Replays**: Rolling 5-second `WorldSnapshot` transform ring buffer driving post-goal Picture-in-Picture replays strictly on Spectator/Replay views (OBS `stream-kit/` covers instant replays for Dec 27).

### 2. Multi-PC LAN & Dual-Monitor Spectator
- [ ] **Multi-PC LAN Play & Spectating (`electron/`)**: Auto-discovered UDP/WebSocket local network rooms for multi-PC full-screen play plus Spectator PCs.
- [ ] **Single-PC Dual-Monitor Spectator Window**: Optional second Electron window outputting the Broadcast Director feed to a projector or capture card.

### 3. Audio Atmosphere, 2v2 AI & Public Distribution
- [ ] **Reactive Crowd Audio**: Dynamic crowd swells reacting to power spikes, rim clanks, clutch dives, and overtime tension.
- [ ] **2v2 AI Chemistry & Evolutionary Re-Training**: Tune bot setter/spiker coordination and run `npm run train:bot` with the newly wired genome parameters.
- [ ] **Cross-Platform Signed Builds & Steam Prep**: Run `.github/workflows/desktop.yml` across Windows, macOS, and Linux; add code signing, notarization, and `steamworks.js` once the Steam page is live.
