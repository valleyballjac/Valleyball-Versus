# Valleyball Versus roadmap

Last updated 2026-11-01. This is the one place for what comes next. [AGENTS.md](../AGENTS.md) holds the rules and [the Gameplay Source of Truth](VALLEYBALL_GAMEPLAY_SOURCE_OF_TRUTH.md) holds the rules of the sport.

## Now: v0.3.7

Brings the lobby, input, camera and fixture work onto `main`.

- [ ] Play-test the lobby, keyboard assignment, hot-plug and pause-menu camera rows with real controllers.
- [ ] Merge to `main`, tag, and deploy to GitHub Pages and itch.io, on Jac's go-ahead.

## Inaugural Championship: December 27, 2026

Expected to be 1v1 this year, so it does not depend on 2v2. `?fixture=` (`src/features/match/matchFixture.js`, `npm run fixture`) already plays one fully specified 1v1 match.

## v0.4: 2v2

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
- **Bot prediction horizons** are hard-coded at 14/20/42 ticks, while `TUNING.strike`'s sweet ticks are 8/15/42. Fix this on its own and A/B it.
- **Trace expectations.** `docs/archive/BRACE_GATE.md` lists unresolved volley and kick trace expectations.
- **Menu cost during play.** Phase 0 saw `menuNavigation.js` in the CPU profile during matches. Re-measure now that the menu input has been rewritten.
