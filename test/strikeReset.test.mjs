/**
 * Regression fixtures for the T-pose after "return to main menu".
 *
 * The menu reset used to write lastStrikeTick = -999 and leave lastStrikeKind
 * at KIND_NONE for an athlete who had never pressed. runStrikes read the
 * finite tick as a strike in progress, the phase had no row to climb, and
 * strikeMix eased to 1 and stayed there — the action tier then gave the whole
 * blend to no clip and the mixer fell back to the bind pose.
 *
 * Run: npm run test  (node --test test/)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrikeState, resetStrikeState, runStrikes } from '../src/mechanics/strikes.js';

const DT = 1 / 60;
const KIND_NONE = 0;
const KIND_VOLLEY = 1;

/** Steps runStrikes with no press for `ticks` ticks and returns the last strikeMix. */
function idle(state, fromTick, ticks) {
  let out = null;
  for (let t = fromTick; t < fromTick + ticks; t++) {
    out = runStrikes({
      state, input: null, motor: null, ghost: null, balls: [],
      volleyQueued: false, spikeQueued: false, tick: t, dt: DT,
    });
  }
  return out.strikeMix;
}

test('an athlete that never struck asks for no strike share', () => {
  const state = createStrikeState();
  assert.equal(idle(state, 0, 120), 0);
});

test('a finite strike tick with no recorded kind never claims the action tier', () => {
  // The exact state the old menu reset left behind.
  const state = createStrikeState();
  state.lastStrikeTick = -999;
  state.lastResolvedStrikeTick = -999;
  assert.equal(state.lastStrikeKind, KIND_NONE);
  assert.equal(idle(state, 0, 120), 0);
});

test('resetStrikeState returns the latches to never-struck and keeps the assist config', () => {
  const state = createStrikeState();
  state.assistPreset = 'assisted';
  state.assistRadius = 0.45;
  state.aimMagnetism = 0.2;
  // Mid-match values, as a strike in flight leaves them.
  state.lastStrikeTick = 500;
  state.lastResolvedStrikeTick = 500;
  state.lastStrikeKind = KIND_VOLLEY;
  state.strikePhase = 0.4;
  state.strikeMix = 0.8;
  state.resolvedCount = 3;
  state.whiffCount = 2;
  state.lastLaunch.x = 12;

  resetStrikeState(state);

  assert.equal(state.lastStrikeTick, -Infinity);
  assert.equal(state.lastResolvedStrikeTick, -Infinity);
  assert.equal(state.lastStrikeKind, KIND_NONE);
  assert.equal(state.strikePhase, 0);
  assert.equal(state.strikeMix, 0);
  assert.equal(state.resolvedCount, 0);
  assert.equal(state.whiffCount, 0);
  assert.equal(state.lastLaunch.x, 0);
  assert.equal(state.assistPreset, 'assisted');
  assert.equal(state.assistRadius, 0.45);
  assert.equal(state.aimMagnetism, 0.2);

  assert.equal(idle(state, 1000, 120), 0);
});
