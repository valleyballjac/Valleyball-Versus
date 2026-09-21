# Headless screenshot capture

Produces clean, HUD-free gameplay stills from a built Valleyball Versus bundle,
with no need to play the game by hand.

## How it works

Headless Chrome suspends `requestAnimationFrame`, so the rAF-driven Loop never
leaves tick 0 — the trap already noted in the project's capture lore. These
scripts sidestep it by driving the entire clock from outside the page:
`requestAnimationFrame`, `performance.now()` and `Date.now()` are all replaced
with a counter advancing exactly 1000/60 ms per stepped frame.

Tick and frame then run 1:1, so injected input is a pure function of the tick and
a capture run is reproducible — the same property the `scenario.mjs` harness
relies on.

## Running

    # serve any built bundle (dist/, dist-itch/, or an unzipped release)
    cd <build dir> && python3 -m http.server 8877 --bind 127.0.0.1

    # in another shell
    pip install playwright && python3 -m playwright install chromium
    python3 capture.py     # practice sandbox: chase, sprint, spike, dive, cameras
    python3 match2.py      # 1v1: lobby, intro card, live play

Both hide `#hud`, `#controls-card` and `#splitscreen-divider` via injected CSS
before each shot, so only the WebGL canvas is captured.

## Notes

- SwiftShader software rendering is slow; a shot can take 10-30 s. Timeouts are
  set high on purpose.
- `js_click()` clicks buttons through the DOM rather than Playwright's actionability
  checks, which never pass while rAF is frozen mid-transition.
- The match flow needs the aerial intro sweep skipped (Space) before input reaches
  the athletes.
- Menu buttons are matched by visible text; `btn-practice-sandbox`, `btn-play-match`,
  `btn-ready-p1/p2` and `btn-start-match` are the stable ids.
