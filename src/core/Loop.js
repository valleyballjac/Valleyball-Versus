/**
 * ============================================================================
 * MODULE: src/core/Loop.js
 * ============================================================================
 * ROLE:
 *   Deterministic fixed-timestep accumulator loop (60 Hz `fixedUpdate`) paired
 *   with an uncapped display-refresh `render(alpha)` pass.
 *
 * FRAME PHASE:
 *   Top-level frame driver (`requestAnimationFrame`):
 *     1. Samples wall-clock delta from the `rAF` timestamp only.
 *     2. Runs `onFrame` listeners (e.g., input latching) once per display frame.
 *     3. Drains `accumulator` in fixed `1 / 60` s increments (`savePrevious` ->
 *        `fixedUpdate(dt, tick)` -> `tick++` -> `onTick` listeners).
 *     4. Computes `alpha = accumulator / fixedDt` and invokes `render(alpha)`.
 *
 * ARCHITECTURAL INVARIANTS:
 *   - Law 6 (Absolute Determinism & Single Clock Authority): This module is the
 *     ONLY place in the engine that reads wall-clock timestamps. `fixedUpdate`
 *     receives only constant `fixedDt` (`1/60` s) and integer `tick`.
 *   - No Catch-Up Spiral: Frame deltas exceeding `TUNING.loop.maxFrameTime` are
 *     clamped so a background stall slows real-time playback rather than running
 *     dozens of physics steps in a single frame.
 *   - Zero Heap Allocation in `_onFrame`: Display-rate sample buffers are
 *     pre-allocated `Float64Array`s.
 * ============================================================================
 */

import { TUNING } from '../config/tuning.js';

/** Number of raw frame deltas averaged for the HUD display-Hz readout. */
const DISPLAY_SAMPLE_COUNT = 30;

/** Sentinel returned by an `onTick` listener to halt further frame scheduling. */
export const HALT = 'halt';

export class Loop {
  /**
   * @param {object} handlers
   * @param {(dt: number, tick: number) => void} handlers.fixedUpdate 60 Hz simulation step.
   * @param {(alpha: number) => void}            handlers.render      Visual render callback.
   */
  constructor({ fixedUpdate, render }) {
    this._fixedUpdate = fixedUpdate;
    this._render = render;

    // Law 6 — bound once at construction to match Rapier's integration dt.
    this.fixedHz = TUNING.loop.fixedHz;
    this.fixedDt = 1 / this.fixedHz;

    /** Canonical monotonic simulation tick counter (incremented once per fixed step). */
    this.tick = 0;
    /** Unconsumed real time in seconds (`0 <= accumulator < fixedDt` after step drain). */
    this.accumulator = 0;
    /** Interpolation factor in `[0, 1)` passed to `render(alpha)`. */
    this.alpha = 0;
    /** Number of fixed simulation steps executed during the current display frame. */
    this.stepsThisFrame = 0;

    // Wall-clock telemetry readouts for HUD/diagnostics only (never read by sim/).
    this.frameTimeMs = 0;
    this.displayHz = 0;
    this.wallClockElapsed = 0;

    /** Registry of `Interpolated` instances snapshotted before each fixed step. */
    this.interpolated = [];

    this._frameListeners = [];
    this._tickListeners = [];
    this._startTime = 0;
    this._previousTime = 0;
    this._seeded = false;

    // Pre-allocated typed buffers for zero-allocation display-Hz median calculation.
    this._displaySamples = new Float64Array(DISPLAY_SAMPLE_COUNT);
    this._sortBuffer = new Float64Array(DISPLAY_SAMPLE_COUNT);
    this._displayCursor = 0;

    this._rafHandle = 0;
    this._running = false;
    this.paused = false;
    this._onFrame = this._onFrame.bind(this);
  }

  /**
   * Registers an `Interpolated` wrapper so `savePrevious()` runs before each step.
   * @template T
   * @param {T} interpolated
   * @returns {T}
   */
  register(interpolated) {
    this.interpolated.push(interpolated);
    return interpolated;
  }

  /**
   * Registers a callback invoked once per display frame before fixed steps drain.
   * Used to latch edge-triggered inputs so all steps in the frame see consistent state.
   *
   * @param {() => void} listener
   * @returns {() => void} Unregister callback.
   */
  onFrame(listener) {
    this._frameListeners.push(listener);
    return () => {
      const at = this._frameListeners.indexOf(listener);
      if (at !== -1) this._frameListeners.splice(at, 1);
    };
  }

  /**
   * Registers a callback invoked immediately after each `fixedUpdate(dt, tick)`.
   * Returning `HALT` from any listener stops the loop cleanly after all listeners run.
   *
   * @param {(tick: number) => unknown} listener
   * @returns {() => void} Unregister callback.
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
   * Simulated time minus real wall-clock elapsed time (ms).
   * Remains near zero under normal load; steps negatively when `maxFrameTime`
   * clamps a stall (intentional time dilation rather than spiral of death).
   */
  get driftMs() {
    return (this.tick * this.fixedDt - this.wallClockElapsed) * 1000;
  }

  _onFrame(now) {
    if (!this._running) return;

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

    const maxFrameTime = TUNING.loop.maxFrameTime;
    const frameTime = rawFrameTime > maxFrameTime ? maxFrameTime : rawFrameTime;

    this.accumulator += frameTime;

    const frameListeners = this._frameListeners;
    for (let i = 0; i < frameListeners.length; i++) frameListeners[i]();

    if (this.paused) {
      this.accumulator = 0;
      this._render(0);
      this._rafHandle = requestAnimationFrame(this._onFrame);
      return;
    }

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
    if (this._displayCursor % 15 === 0) {
      const len = Math.min(this._displayCursor, DISPLAY_SAMPLE_COUNT);
      for (let i = 0; i < len; i++) this._sortBuffer[i] = this._displaySamples[i];
      for (let i = 1; i < len; i++) {
        const val = this._sortBuffer[i];
        let j = i - 1;
        while (j >= 0 && this._sortBuffer[j] > val) {
          this._sortBuffer[j + 1] = this._sortBuffer[j];
          j--;
        }
        this._sortBuffer[j + 1] = val;
      }
      const median = this._sortBuffer[len >> 1];
      if (median > 0) this.displayHz = 1 / median;
    }
  }
}
