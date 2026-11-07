# Valleyball Versus roadmap

Last updated 2026-11-07. This is the one place for what comes next. [AGENTS.md](../AGENTS.md) holds the rules and [the Gameplay Source of Truth](VALLEYBALL_GAMEPLAY_SOURCE_OF_TRUTH.md) holds the rules of the sport.

## Now: v0.4.0

Brings full 1v1 and 2v2 team gameplay, per-controller lobby navigation, right-aligned title menu, staggered idle poses, individual + collective team stats, inertia-scaled angular tracking + 4-tick buzz filtering, unified 8/15/42-tick AI strike & ballistic hoop targeting, and fixture support onto the release build.

- [x] Play-test the lobby, keyboard assignment, hot-plug and pause-menu camera rows with real controllers.
- [x] Full 2v2 team mode (4-athlete roster, quad split-screen, team & individual stats, grouped lobby setup, teammate bot roles, strike arbitration).
- [x] AI v0.4.0 strike horizons (`8/15/42`), Rapier limb-offset matching, additive-impulse aim compensation, East-West hoop playbook, and headless mechanical parity.
- [x] Merge to `main`, tag `v0.4.0`, and package release builds.

## Inaugural Championship: December 27, 2026

Expected to be 1v1 this year, so it does not depend on 2v2. `?fixture=` (`src/features/match/matchFixture.js`, `npm run fixture`) already plays one fully specified 1v1 match.

The Windows desktop build (`npm run desktop:dist`, see AGENTS.md) is the tournament runtime. On Jac's laptop it renders on the discrete GPU at the panel's native 165 Hz and keeps rendering when unfocused. Still to do before the event:

- [ ] Play-test with four controllers on a hub, including after clicking onto another monitor.
- [ ] Bundle the Orbitron font. `index.html` loads it from Google Fonts, so an offline machine falls back to a system font.
- [ ] Decide whether the title screen needs a Quit item. `window.desktopAPI.quit()` exists; today Alt+F4 is the only exit in fullscreen.
- [ ] The exe is unsigned, so Windows SmartScreen warns on first run. Fine for the event machine; needs a code-signing certificate before a public download.
- [ ] Steam: `steamworks.js` and an App ID, once there is a Steam page.

## v0.4.0: 2v2 (Shipped)

Already in place: team scoring, four `TUNING.players` configs, four input slots, the controller assignment screen and four stream heads.

Build in this order, so each step can be tested by the one before it:

1. **Four-athlete test harness.** `src/ai/headlessSim.js` builds two athletes. Add four, plus a four-athlete determinism anchor and `npm run eval:match` support.
2. **Roster and spawns.** `ensureRoster(2, ...)` in `src/main.js` and the match-start code handle two athletes. Replace or delete `AthleteManager.teleportToMatchSpawns`, which is never called and puts P2 and P3 on the wrong sides.
3. **Input.** `src/input/inputRouter.js` samples only human slots 0 and 1.
4. **Ball contact.** Strike state is per athlete, with no shared claim on the ball. Add arbitration so teammates can't double-hit it. The v0.2.0 post-mortem warned about double-impulse bugs here.
5. **Bots.** `updateBot` and `buildPerception` take one opponent and have no concept of a teammate. In `src/main.js`, `opponentIdx` hands the P3 bot its own teammate as the opponent. Bots also need role assignment so two teammates don't both chase the ball.
6. **Rendering.** `src/main.js` hard-codes a two-way split. `src/features/camera/viewportManager.js` has a quad split that nothing imports: wire it in or delete it.
7. **Lobby and end of match.** `playerSetup.js` assumes exactly two players. Stats, winner selection and the victory screen are keyed to P1 and P2.
8. **Performance.** Phase 0 estimated about 7 ms mean and 14 ms p95 for physics alone with four athletes, on a 2-core cloud runner. Measure on real hardware early, since the frame budget is 16.7 ms.
9. **Unlock.** Remove the "Coming in v0.4.0" locks in `titleScreen.js` and `controllerAssignment.js`.

If a later league plays 2v2, the fixture format needs to change too: it allows one athlete per side, with fixed slots.

**Structure:** most of these steps run through `src/main.js`. The `features/` modules were meant to own this logic, but the move stopped halfway. Finish the move only where 2v2 forces an edit, rather than running a separate refactor. The size ratchet rose to about 4,150 lines for fixtures in v0.3.7, and 2v2 should bring it back down.

## Side quests (unscheduled)

- **In-game music.** `musicManager.js` and its tracks are on `archive/trailer-debut-v2`.
- **Crowd audio** reacting to shot power and near misses.
- **Halloween skins**, the explainer pipeline and the locker photo booth. See [the archive index](archive/README.md).

## Open follow-ups

- **Arena Blender sources.** Commits cite `.blend` files v10.0 to v10.9, which are not in git. Find them and store them with the arena's other source files. Until then, `arena.glb` is the only source of truth (see AGENTS.md).
- **AI tactical & spike/aerial refinement.** v0.4.0 aligned prediction horizons to 8/15/42 ticks, Rapier limb offsets, and East-West hoop ballistics; continue tuning standing/jump spike frequency, 2v2 off-ball chemistry, and multi-touch combinations.
- **Trace expectations.** `docs/archive/BRACE_GATE.md` lists unresolved volley and kick trace expectations.
- **Menu cost during play.** Phase 0 saw `menuNavigation.js` in the CPU profile during matches. Re-measure now that the menu input has been rewritten.
- **Corner-fan certification.** `npm run audit` has failed its collision half since arena v11.1 (it passes at `arena-v11`), so CI runs only `node scripts/audit.mjs` for now. The rule flags 26 vertical triangles at `|x| = 25` inside the corner fan band, added by the Oct 24 boundary work. All 1,772 rest checks, the drop test and the traversal test pass, so the rule is probably stale. Confirm the geometry is intended, then update the rule and put `npm run audit` back in CI.
