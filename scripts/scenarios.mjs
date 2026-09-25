/**
 * THE SCENARIOS — shared by scripts/trace.mjs. Derived on the COURT, Sep 25 2026.
 *
 * Each scenario is:
 *   end     the tick the run halts at (via ?captureTick)
 *   query   extra URL params: harness fixtures from src/debug/fixture.js
 *           (balls=1 keeps only the medium ball live; serve=i:x,y,z@T places it)
 *   script  (tick, pad, set, key) => void, serialised into the page, so it may
 *           not close over anything here. Keyed on the LOOP tick. Presses are
 *           RANGES. ONE set() PER BUTTON PER FRAME (it assigns, it does not OR).
 *           Pad indices: 0 South/jump, 1 East/volley-kick, 2 West/dive,
 *           3 North/spike, 6 LT/sprint, 7 RT/slide. Axes [lx, ly, rx, ry].
 *   expect  what MUST happen. { log } counts bracketed console lines containing
 *           that text; { when } evaluates a predicate over the per-tick facts
 *           row (see trace.mjs); all: true means every row in the window. A
 *           scenario whose mechanic did not happen FAILS however self-consistent
 *           it is — the lesson of the Sep 2026 audit, where both old scenarios
 *           had been pressing nothing since the HUD was hidden on Sep 6.
 *
 * GEOMETRY ON THE COURT, measured: the athlete drops from (0, 1.5, 0), lands by
 * tick 20, and is re-spawned by the capture harness at tick 31 — nothing is
 * scripted before tick 36. He faces -Z (yaw pi), so "in front" is negative z.
 * The medium ball has radius 0.5 m and rests with its centre at y 0.5.
 *
 * Every timing below came from a sweep, and each sits in the MIDDLE of the range
 * that connected, not at its edge, so a small drift fails the expectation
 * rather than silently flipping a hit into a whiff:
 *   volley  serve (0, 4.0, -0.7) @60; presses at 74, 78 and 82 all hit q 1.000
 *   spike   serve (0, 5.0, -0.7) @50; presses at 50 and 54 hit q 1.000 (46: q 0.756)
 *   kick    rest  (0, 0.52, -1.0) @40; press 70 -> q 1.000 (0.8 m: q 0.919; 1.2 m: whiff)
 */
export const SCENARIOS = {
  /** No input at all: the pure-function-of-the-tick claim, traced every tick. */
  idle: {
    end: 300,
    script: `() => {}`,
    expect: [
      { label: 'athlete lands and stays grounded', when: 'f => f.grounded', from: 40, to: 300, all: true },
      { label: 'full balance throughout', when: 'f => f.weight === 1', from: 40, to: 300, all: true },
    ],
  },

  /** Stand still; a ball falls in front; the volley meets it. */
  volley: {
    end: 140,
    query: 'balls=1&serve=1:0,4.0,-0.7@60',
    script: `(tick, pad, set) => { set(1, tick >= 78 && tick < 82); }`,
    expect: [
      { label: 'East resolves to a volley', log: '[strike] east -> volley', from: 78, to: 79 },
      { label: 'volley connects at full quality', log: '[strike] volley q 1.000', from: 92, to: 102 },
      { label: 'exactly one strike resolved', when: 'f => f.resolved === 1', from: 105, to: 140, all: true },
    ],
  },

  /** Standing spike at the reach peak on a falling ball. */
  spike: {
    end: 140,
    query: 'balls=1&serve=1:0,5.0,-0.7@50',
    script: `(tick, pad, set) => { set(3, tick >= 50 && tick < 54); }`,
    expect: [
      { label: 'spike connects at full quality', log: '[strike] spike q 1.000', from: 88, to: 100 },
      { label: 'side agreement holds', log: 'AGREE', from: 88, to: 100 },
    ],
  },

  /** A ball resting on the floor: East becomes a kick, and it connects. */
  kick: {
    end: 110,
    query: 'balls=1&serve=1:0,0.52,-1.0@40',
    script: `(tick, pad, set) => { set(1, tick >= 70 && tick < 74); }`,
    expect: [
      { label: 'East resolves to a kick', log: '[strike] east -> kick', from: 70, to: 71 },
      { label: 'kick connects at full quality', log: '[strike] kick q 1.000', from: 78, to: 90 },
    ],
  },

  /**
   * G3.5's actions scenario, re-verified on the court: the slide, the JUMP-
   * CANCEL at 125 (nine ticks in, still fast), the RE-ENTRY LOCKOUT with the
   * trigger held, a fresh slide after release, the dive and its crash, and the
   * KeyT knockdown with its recovery.
   */
  actions: {
    end: 430,
    query: 'balls=1',
    script: `(tick, pad, set, key) => {
      pad.axes = tick >= 36 ? [0, -1, 0, 0] : [0, 0, 0, 0];
      set(6, tick >= 36 && tick < 116);
      set(7, (tick >= 116 && tick < 200) || (tick >= 210 && tick < 232));
      set(2, tick >= 236 && tick < 242);
      set(0, (tick >= 125 && tick < 131) || (tick >= 250 && tick < 256));
      if (tick >= 316 && tick <= 318) key('KeyT');
    }`,
    expect: [
      { label: 'sprint reaches > 5.5 m/s', when: 'f => f.speed > 5.5', from: 100, to: 116 },
      { label: 'slide runs 116-124', when: 'f => f.slideTime > 0', from: 117, to: 124, all: true },
      { label: 'jump cancels the slide, trigger still held', when: 'f => f.slideTime === 0 && f.slideNeedsRelease', from: 128, to: 199, all: true },
      { label: 'lockout is the ONLY thing holding it out (speed > 4.0 gate)', when: 'f => f.speed > 4.0', from: 128, to: 134, all: true },
      { label: 'fresh slide after release', when: 'f => f.slideTime > 0', from: 212, to: 230, all: true },
      { label: 'dive launches', log: '[dive] launched', from: 236, to: 238 },
      { label: 'dive crash drops balance', when: 'f => f.weight < 0.5', from: 256, to: 300 },
      { label: 'KeyT knockdown goes limp', when: 'f => f.weight <= 0.01', from: 316, to: 322 },
      { label: 'recovery under way by 400', when: 'f => f.weight > 0.35', from: 400, to: 430, all: true },
    ],
  },

  /**
   * Locomotion: walk, run, sprint, a hard reversal, a strafe, and a release to
   * stop — the motor's feel goals as numbers (it must work to slow down).
   */
  locomotion: {
    end: 420,
    query: 'balls=1',
    script: `(tick, pad, set) => {
      let ax = [0, 0, 0, 0];
      if (tick >= 36 && tick < 90) ax = [0, -0.45, 0, 0];        // walk
      else if (tick >= 90 && tick < 150) ax = [0, -1, 0, 0];     // run
      else if (tick >= 150 && tick < 230) ax = [0, -1, 0, 0];    // sprint (LT below)
      else if (tick >= 230 && tick < 290) ax = [0, 1, 0, 0];     // hard reversal
      else if (tick >= 290 && tick < 340) ax = [1, 0, 0, 0];     // strafe right
      pad.axes = ax;
      set(6, tick >= 150 && tick < 230);
    }`,
    expect: [
      { label: 'walk stays under 2.5 m/s', when: 'f => f.speed < 2.5', from: 60, to: 90, all: true },
      { label: 'run settles between 3 and 5.2 m/s', when: 'f => f.speed > 3 && f.speed < 5.2', from: 130, to: 150, all: true },
      { label: 'sprint exceeds 5.5 m/s', when: 'f => f.speed > 5.5', from: 200, to: 230 },
      { label: 'stays on his feet throughout', when: 'f => f.weight > 0.9', from: 36, to: 420, all: true },
      // Measured: 4.18 m/s at release (340) decays near-linearly (~3.4 m/s^2) to
      // 0.23 by 410 and 0.01 by 420. Braking takes work, by design.
      { label: 'still carrying momentum 30 ticks after release', when: 'f => f.speed > 2', from: 368, to: 372, all: true },
      { label: 'comes to rest ~1.2 s after release', when: 'f => f.speed < 0.3', from: 410, to: 420, all: true },
    ],
  },
};
