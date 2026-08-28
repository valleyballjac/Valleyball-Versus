import { TUNING } from '../config/tuning.js';

/**
 * The deterministic fixed-step loop.
 *
 * This file is the ONLY place in the project that reads wall-clock time, and it
 * reads it from exactly one source: the timestamp the rAF callback is handed.
 * No other clock is sampled anywhere, so there is no chance of two clocks
 * disagreeing with each other.
 *
 * `fixedUpdate` receives only the constant timestep and the integer tick. The
 * simulation cannot perceive real time — see the directory-level ban documented
 * in src/sim/.
 *
 * The loop knows nothing about files, names, images or the DOM. Everything an
 * external harness needs, it gets through `tick` and `onTick`.
 */

/** How many raw frame times the display-Hz readout averages over. */
const DISPLAY_SAMPLE_COUNT = 30;

/** Sentinel an onTick listener returns to stop the loop scheduling frames. */
export const HALT = 'halt';

export class Loop {
  /**
   * @param {object}   handlers
   * @param {(dt: number, tick: number) => void} handlers.fixedUpdate
   * @param {(alpha: number) => void}            handlers.render
   */
  constructor({ fixedUpdate, render }) {
    this._fixedUpdate = fixedUpdate;
    this._render = render;

    // LAW 6 — the fixed rate is bound ONCE, here. Rapier's integration
    // parameters will be locked to this same value in Step 2. It is deliberately
    // not parameterised at runtime.
    this.fixedHz = TUNING.loop.fixedHz;
    this.fixedDt = 1 / this.fixedHz;

    /**
     * The project's canonical clock. Monotonic integer, starts at 0.
     * Incremented once per fixedUpdate and by nothing else, anywhere.
     */
    this.tick = 0;
    /** Unconsumed real time, in seconds. Always < fixedDt after a frame. */
    this.accumulator = 0;
    /** Interpolation factor handed to render(). Always in [0, 1). */
    this.alpha = 0;
    /** Steps taken during the most recent frame. Read by the HUD. */
    this.stepsThisFrame = 0;

    // Wall-clock readouts, for the HUD only. The simulation never sees these.
    this.frameTimeMs = 0;
    this.displayHz = 0;
    this.wallClockElapsed = 0;

    /** Registry of Interpolated instances; savePrevious() is called on each. */
    this.interpolated = [];

    this._frameListeners = [];
    this._tickListeners = [];
    this._startTime = 0;
    this._previousTime = 0;
    this._seeded = false;
    this._displaySamples = [];
    this._displayCursor = 0;

    this._rafHandle = 0;
    this._running = false;
    this._onFrame = this._onFrame.bind(this);
  }

  /**
   * Registers an Interpolated so the loop snapshots it before every step.
   * @template T
   * @param {T} interpolated
   * @returns {T}
   */
  register(interpolated) {
    this.interpolated.push(interpolated);
    return interpolated;
  }

  /**
   * Registers a listener invoked once per rendered frame, before that frame's
   * steps are drained. Whatever it latches is therefore seen identically by
   * every step in the frame, which is what makes per-frame sampling safe to
   * consume from inside a fixed step.
   *
   * The loop knows nothing about what is being latched. Return values are
   * ignored — only onTick can halt.
   *
   * @param {() => void} listener
   * @returns {() => void} unregister
   */
  onFrame(listener) {
    this._frameListeners.push(listener);
    return () => {
      const at = this._frameListeners.indexOf(listener);
      if (at !== -1) this._frameListeners.splice(at, 1);
    };
  }

  /**
   * Registers a listener invoked with the tick that fixedUpdate has just been
   * called with, immediately after that call and before the frame's
   * interpolated render.
   *
   * At the instant a listener runs, every registered Interpolated's `curr`
   * holds exactly that tick's state, so a listener that wants the pure fixed
   * state — with no interpolation remainder in it — renders at alpha 1.
   *
   * Every registered listener runs even when an earlier one halts. Returning
   * HALT from any of them stops the loop scheduling further frames.
   *
   * @param {(tick: number) => unknown} listener
   * @returns {() => void} unregister
   */
  onTick(listener) {
    this._tickListeners.push(listener);
    return () => {
      const at = this._tickListeners.indexOf(listener);
      if (at !== -1) this._tickListeners.splice(at, 1);
    };
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._seeded = false;
    this._rafHandle = requestAnimationFrame(this._onFrame);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._rafHandle);
    this._rafHandle = 0;
  }

  /**
   * The determinism proof: simulated time minus real elapsed time, in ms.
   *
   * Hovers near zero while running normally. After a stall it steps by exactly
   * the amount the MAX_FRAME_TIME clamp refused to simulate, and then stops
   * growing. That is time dilation working as designed, not a bug.
   */
  get driftMs() {
    return (this.tick * this.fixedDt - this.wallClockElapsed) * 1000;
  }

  _onFrame(now) {
    if (!this._running) return;

    // Seed on the first frame so it yields a frameTime of exactly 0, rather than
    // letting an uninitialised value produce one huge dt for the clamp to eat.
    if (!this._seeded) {
      this._seeded = true;
      this._startTime = now;
      this._previousTime = now;
    }

    const rawFrameTime = (now - this._previousTime) / 1000;
    this._previousTime = now;
    this.wallClockElapsed = (now - this._startTime) / 1000;
    this.frameTimeMs = rawFrameTime * 1000;
    this._recordDisplaySample(rawFrameTime);

    // The clamp. When a frame takes 3 seconds the simulation runs SLOW; it does
    // not try to catch up. There is deliberately no catch-up logic here.
    const maxFrameTime = TUNING.loop.maxFrameTime;
    const frameTime = rawFrameTime > maxFrameTime ? maxFrameTime : rawFrameTime;

    this.accumulator += frameTime;

    const frameListeners = this._frameListeners;
    for (let i = 0; i < frameListeners.length; i++) frameListeners[i]();

    const dt = this.fixedDt;
    this.stepsThisFrame = 0;

    while (this.accumulator >= dt) {
      const registry = this.interpolated;
      for (let i = 0; i < registry.length; i++) registry[i].savePrevious();

      const steppedTick = this.tick;
      this._fixedUpdate(dt, steppedTick);

      this.tick++;
      this.accumulator -= dt;
      this.stepsThisFrame++;

      if (this._notify(steppedTick) === HALT) {
        // Stop here. The frame is abandoned rather than finished, so no alpha
        // is ever published from an accumulator the drain left over-full.
        this._running = false;
        return;
      }
    }

    this.alpha = this.accumulator / dt;
    this._render(this.alpha);

    this._rafHandle = requestAnimationFrame(this._onFrame);
  }

  _notify(tick) {
    const listeners = this._tickListeners;
    let outcome = null;
    for (let i = 0; i < listeners.length; i++) {
      if (listeners[i](tick) === HALT) outcome = HALT;
    }
    return outcome;
  }

  _recordDisplaySample(frameTime) {
    if (!(frameTime > 0)) return;
    this._displaySamples[this._displayCursor % DISPLAY_SAMPLE_COUNT] = frameTime;
    this._displayCursor++;
    const sorted = this._displaySamples.slice().sort((a, b) => a - b);
    this.displayHz = 1 / sorted[sorted.length >> 1];
  }
}
