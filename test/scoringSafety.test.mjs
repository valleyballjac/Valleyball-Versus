/**
 * Competition-safety regression tests for scoring and match lifecycle guards:
 *   1. Teleport-chord / `resetEpoch` phantom goal rejection.
 *   2. Unphysical single-tick jump (> 3 m / tick) rejection.
 *   3. Countdown and post-match (`matchOver`) goal suppression + buzzer-beater validity.
 *   4. Subterranean hoop crossing (`y < 6.0 m`) rejection vs legal hoop crossing.
 *   5. `MatchManager` lifecycle fixes: `_agreedDraw` reset, `rematch(configs)` countdown
 *      preservation, and `startOvertime({ positionMode: 'respawn' })` countdown + tracker reset.
 *
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { TUNING } from '../src/config/tuning.js';
import { createMatchState, updateScoring } from '../src/mechanics/scoring.js';
import { MatchManager } from '../src/features/match/matchManager.js';

function makeMockBall(handle, x, y, z, radius = 0.5) {
  const pos = { x, y, z };
  return {
    radius,
    collider: { handle },
    resetEpoch: 0,
    body: {
      translation() {
        return pos;
      },
    },
    moveTo(nx, ny, nz) {
      pos.x = nx;
      pos.y = ny;
      pos.z = nz;
    },
  };
}

test('resetEpoch teleport chord across hoop aperture never scores a phantom goal', () => {
  const state = createMatchState();
  state.mode = 'match';
  state.isCountingDown = false;
  state.countdownTicksRemaining = 0;
  state.ticksRemaining = 3600;

  const ball = makeMockBall(101, -0.6, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 1);
  assert.equal(state.events.length, 0);

  // Teleport straight through the North hoop center with resetEpoch bumped (simulating resetBall)
  ball.resetEpoch += 1;
  ball.moveTo(0.6, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 2);
  assert.equal(state.events.length, 0, 'Teleport chord after resetBall must not score');
  assert.equal(state.scoreHome, 0);
  assert.equal(state.scoreAway, 0);

  // Subsequent genuine physical shot clearing x = 0 DOES score normally
  ball.moveTo(2.0, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 3);
  ball.moveTo(0.4, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 4);
  ball.moveTo(-0.55, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 5);
  assert.equal(state.events.length, 1, 'Genuine physical crossing must still score');
  assert.equal(state.scoreHome, 1);
});

test('single-tick jump longer than 3 m re-anchors without scoring even without resetEpoch', () => {
  const state = createMatchState();
  state.mode = 'match';
  state.isCountingDown = false;
  state.countdownTicksRemaining = 0;
  state.ticksRemaining = 3600;

  const ball = makeMockBall(102, -4.0, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 1);

  // 8 m jump in a single tick across the hoop center (480 m/s unphysical chord)
  ball.moveTo(4.0, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 2);
  assert.equal(state.events.length, 0, 'Unphysical >3 m single-tick jump must not score');
});

test('countdown suppresses scoring, final live tick buzzer-beater counts, post-match suppresses scoring', () => {
  const state = createMatchState();
  state.mode = 'match';
  state.isCountingDown = true;
  state.countdownTicksRemaining = 2;
  state.ticksRemaining = 2;

  const ball = makeMockBall(103, -0.6, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 1);

  // Cross hoop fully while countdown is active (countdownTicksRemaining: 1 -> 0 on tick 2)
  ball.moveTo(0.6, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 2);
  assert.equal(state.events.length, 0, 'Crossing during countdown must not score');
  assert.equal(state.isCountingDown, false);

  // Stay clear on East during tick 3 (ticksRemaining: 2 -> 1)
  ball.moveTo(1.2, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 3);

  // Buzzer-beater on final live tick clearing full ball diameter (ticksRemaining: 1 -> 0)
  ball.moveTo(-0.55, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 4);
  assert.equal(state.events.length, 1, 'Genuine buzzer-beater on final live tick must count');
  assert.equal(state.matchOver, true);

  // Post-match rolling crossing after matchOver === true must NOT score
  ball.moveTo(-2.0, 10.0, TUNING.match.hoopSouthZ);
  updateScoring(state, [ball], 5);
  ball.moveTo(-0.4, 10.0, TUNING.match.hoopSouthZ);
  updateScoring(state, [ball], 6);
  ball.moveTo(0.6, 10.0, TUNING.match.hoopSouthZ);
  updateScoring(state, [ball], 7);
  assert.equal(state.events.length, 1, 'Post-match crossings after buzzer must not score');
});

test('subterranean hoop crossing (y < 6.0 m) is rejected while legal floor-level crossing scores', () => {
  const state = createMatchState();
  state.mode = 'match';
  state.isCountingDown = false;
  state.countdownTicksRemaining = 0;
  state.ticksRemaining = 3600;

  // Bottom of raw 4.667 m hoop disc reaches y = 5.333 m (below actual ~6.46..9.46 m floor)
  const ball = makeMockBall(104, -0.6, 5.6, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 1);
  ball.moveTo(0.6, 5.6, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 2);
  assert.equal(state.events.length, 0, 'Subterranean crossing below y=6.0 m must be rejected');

  // Legal crossing above floor inside hoop aperture scores normally
  ball.moveTo(2.0, 9.8, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 3);
  ball.moveTo(0.4, 9.8, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 4);
  ball.moveTo(-0.55, 9.8, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 5);
  assert.equal(state.events.length, 1, 'Legal floor-level crossing inside hoop must score');
});

test('Full Ball-Clearance rule: partial poke is a goal-line save, full swat-back unthreading scores immediately, and rocking never double-scores', () => {
  const state = createMatchState();
  state.mode = 'match';
  state.isCountingDown = false;
  state.countdownTicksRemaining = 0;
  state.ticksRemaining = 3600;

  // Medium ball (radius = 0.50 m) starts clear on West (-0.8)
  const ball = makeMockBall(105, -0.8, 10.0, TUNING.match.hoopNorthZ, 0.5);
  updateScoring(state, [ball], 1);

  // 1. Partial poke across x = 0 to +0.35 (< 0.50 radius), then swatted back to -0.7 -> 0 goals (goal-line save!)
  ball.moveTo(0.35, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 2);
  assert.equal(state.events.length, 0, 'Partial poke (center crossed, trailing edge still on West) must NOT score yet');

  ball.moveTo(-0.2, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 3);
  ball.moveTo(-0.7, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 4);
  assert.equal(state.events.length, 0, 'Swatting partially-crossed ball back out is a clean goal-line save');

  // 2. Full clearance West -> East (+0.52 >= 0.50) scores Goal 1 for Home
  ball.moveTo(0.25, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 5);
  assert.equal(state.events.length, 0, 'Still straddling x = 0 at +0.25');
  ball.moveTo(0.52, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 6);
  assert.equal(state.events.length, 1, 'Full ball clearance (+0.52 >= 0.50) registers Goal 1');
  assert.equal(state.scoreHome, 1);
  assert.equal(state.scoreAway, 0);
  assert.equal(state.targetGoal, 'S');

  // 3. Immediate swat-back (unthreading) East -> West (-0.52 <= -0.50) MUST score responding Goal 2 for Away!
  ball.moveTo(-0.15, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 7);
  assert.equal(state.events.length, 1);
  ball.moveTo(-0.52, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 8);
  assert.equal(state.events.length, 2, 'Unthreading full ball back through the hoop immediately scores responding Goal 2');
  assert.equal(state.scoreHome, 1);
  assert.equal(state.scoreAway, 1);
  assert.equal(state.targetGoal, 'N');

  // 4. Resting ball rocking +-0.2 m across x = 0 never clears +-0.50 and never phantom-scores
  for (let t = 9; t <= 20; t++) {
    ball.moveTo(t % 2 === 0 ? 0.2 : -0.2, 10.0, TUNING.match.hoopNorthZ);
    updateScoring(state, [ball], t);
  }
  assert.equal(state.events.length, 2, 'Rocking on x = 0 without full ball clearance must never double-score');

  // 5. Going around the hoop outside aperture to East (+5.0), then cleanly shooting back West scores 1 goal
  ball.moveTo(-0.7, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 21);
  ball.moveTo(0.7, 10.0, TUNING.match.hoopNorthZ + 8.0); // outside hoop Z
  updateScoring(state, [ball], 22);
  ball.moveTo(0.7, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 23);
  ball.moveTo(-0.55, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [ball], 24);
  assert.equal(state.events.length, 3, 'Going around hoop and re-entering from East scores cleanly');
});

test('Full Ball-Clearance scales accurately across Small (0.20 m) and Large (0.75 m) balls', () => {
  const state = createMatchState();
  state.mode = 'practice';
  state.isCountingDown = false;
  state.countdownTicksRemaining = 0;
  state.ticksRemaining = 3600;

  const smallBall = makeMockBall(106, -0.3, 10.0, TUNING.match.hoopNorthZ, 0.20);
  const largeBall = makeMockBall(107, -0.9, 10.0, TUNING.match.hoopSouthZ, 0.75);
  updateScoring(state, [smallBall, largeBall], 1);

  // Small ball clears at +0.21; large ball at +0.60 is still straddling (0.60 < 0.75)
  smallBall.moveTo(0.21, 10.0, TUNING.match.hoopNorthZ);
  largeBall.moveTo(0.60, 10.0, TUNING.match.hoopSouthZ);
  updateScoring(state, [smallBall, largeBall], 2);
  assert.equal(state.events.length, 1, 'Small ball clears at +0.21, large ball at +0.60 has not cleared 0.75 m yet');
  assert.equal(state.events[0].goal, 'N');

  // Large ball finishes clearing at +0.76 -> scores!
  largeBall.moveTo(0.76, 10.0, TUNING.match.hoopSouthZ);
  updateScoring(state, [smallBall, largeBall], 3);
  assert.equal(state.events.length, 2, 'Large ball registers once center reaches +0.76 >= 0.75 m');
  assert.equal(state.events[1].goal, 'S');
});

test('Regulation match mode strictly evaluates 1 active ball only (3-ball sandbox is Practice-only)', () => {
  const state = createMatchState();
  state.mode = 'match';
  state.isCountingDown = false;
  state.countdownTicksRemaining = 0;
  state.ticksRemaining = 3600;

  const primary = makeMockBall(201, -0.6, 10.0, TUNING.match.hoopNorthZ, 0.50);
  const extraA = makeMockBall(202, -0.6, 10.0, TUNING.match.hoopNorthZ, 0.20);
  const extraB = makeMockBall(203, -0.9, 10.0, TUNING.match.hoopSouthZ, 0.75);
  updateScoring(state, [primary, extraA, extraB], 1);

  // Only extra balls cross hoops -> must NOT score in regulation match mode!
  extraA.moveTo(0.6, 10.0, TUNING.match.hoopNorthZ);
  extraB.moveTo(0.9, 10.0, TUNING.match.hoopSouthZ);
  updateScoring(state, [primary, extraA, extraB], 2);
  assert.equal(state.events.length, 0, 'Extra sandbox balls must never score in a regular match');

  // Primary match ball crosses -> scores cleanly!
  primary.moveTo(0.6, 10.0, TUNING.match.hoopNorthZ);
  updateScoring(state, [primary, extraA, extraB], 3);
  assert.equal(state.events.length, 1, 'Primary regulation match ball scores cleanly');
});

test('MatchManager syncs matchState.mode on startMatch/startPractice/rematch and resets lifecycle cleanly', () => {
  const prevMode = TUNING.match.mode;
  try {
    TUNING.match.mode = 'practice';
    const mm = new MatchManager();
    mm.startMatch();
    assert.equal(mm.getState().mode, 'match', 'startMatch must set matchState.mode to match even when TUNING starts in practice');

    mm.startPractice();
    assert.equal(mm.getState().mode, 'practice', 'startPractice must set matchState.mode to practice');

    const st = mm.getState();
    st._agreedDraw = true;
    st._buzzerPlayed = true;
    st.ballTrackers.set(1, { prevX: 0, prevY: 10, prevZ: 0, clearedSide: 1, pendingGoal: null, pendingFromSide: 0 });

    // Passing player configs array (as src/main.js does) must NOT zero out countdown and must restore match mode
    mm.rematch([{ team: 'home' }, { team: 'away' }]);
    assert.equal(mm.getState().mode, 'match', 'rematch must restore matchState.mode to match');
    assert.equal(st._agreedDraw, false, 'rematch must clear _agreedDraw');
    assert.equal(st._buzzerPlayed, false, 'rematch must clear _buzzerPlayed');
    assert.equal(st.isCountingDown, true, 'rematch(configs) must preserve kickoff countdown');
    assert.ok(st.countdownTicksRemaining > 0, 'rematch(configs) must arm countdownTicksRemaining');
    assert.equal(st.ballTrackers.size, 0, 'rematch must clear ballTrackers');

    // Respawn overtime must clear trackers and arm kickoff countdown
    st.ballTrackers.set(2, { prevX: 1, prevY: 9, prevZ: -40, clearedSide: 1, pendingGoal: null, pendingFromSide: 0 });
    st.isCountingDown = false;
    st.countdownTicksRemaining = 0;
    mm.startOvertime({ format: 'golden_goal', positionMode: 'respawn' });
    assert.equal(st.isGoldenGoal, true);
    assert.equal(st.isCountingDown, true, 'respawn overtime must arm kickoff countdown');
    assert.ok(st.countdownTicksRemaining > 0);
    assert.equal(st.ballTrackers.size, 0, 'respawn overtime must clear ballTrackers');

    // In-place overtime must NOT arm countdown
    mm.startOvertime({ format: 'timed', durationSeconds: 60, positionMode: 'in_place' });
    assert.equal(st.isGoldenGoal, false);
    assert.equal(st.isCountingDown, false, 'in_place overtime must resume immediately without countdown');
    assert.equal(st.ticksRemaining, 3600);
  } finally {
    TUNING.match.mode = prevMode;
  }
});
