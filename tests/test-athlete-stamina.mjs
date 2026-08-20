/**
 * Offline verification of athlete-stamina.js.
 *
 * The module is pure arithmetic and four clocks, so almost everything here is
 * checkable exactly. Where a check could pass for the wrong reason there is a
 * NEGATIVE CONTROL immediately beside it — several of these caught real
 * mistakes while the module was being written, and the ones that read as
 * obvious are the ones most worth keeping.
 */
import {
  createAthleteStamina, DEFAULT_STAMINA_TUNING, inclineDrainRate,
} from './athlete-stamina.js';
import { createAthleteActions, DEFAULT_ACTION_TUNING } from './athlete-actions.js';

let pass = 0, fail = 0;
const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const T = DEFAULT_STAMINA_TUNING;
const AT = DEFAULT_ACTION_TUNING;
const DT = 1 / 60;
/** Run `seconds` of idle updates. */
const idle = (s, seconds, opts) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) s.update(DT, opts);
  return s.value;
};

// ---------------------------------------------------------------------------
console.log('\n1. The tank');
{
  const s = createAthleteStamina();
  check('starts full', s.value === T.max && s.fraction === 1, `${s.value}`);
  check('and reports its own maximum', s.max === T.max);
  check('a custom start is honoured', createAthleteStamina({ tuning: { start: 40 } }).value === 40);
  check('and clamped into range',
    createAthleteStamina({ tuning: { start: 500 } }).value === T.max
    && createAthleteStamina({ tuning: { start: -5 } }).value === 0);
  check('nothing is exhausted at rest', !s.exhausted && !s.denied);
  check('the fraction is what a bar wants', s.fraction >= 0 && s.fraction <= 1);
}

// ---------------------------------------------------------------------------
console.log('\n2. Flat costs');
{
  const s = createAthleteStamina();
  check('a dive costs its tuning', s.spend('dive') && approx(s.value, T.max - T.diveCost),
    `${s.value}`);
  check('a hit costs its tuning', s.spend('hit')
    && approx(s.value, T.max - T.diveCost - T.hitCost), `${s.value}`);
  check('an unpriced action is free', s.spend('sneeze') && approx(s.value, T.max - T.diveCost - T.hitCost));

  // Three dives is the design target for a full bar; the fourth must fail.
  const t = createAthleteStamina();
  let dives = 0;
  for (let i = 0; i < 10; i++) if (t.spend('dive')) dives++;
  check('a full bar buys exactly three dives', dives === 3, `${dives}`);
  check('and the fourth is refused, not overdrawn', t.value >= 0, `${t.value}`);
}
{
  // Spending never goes negative — a bar that can read -12 is a bar that
  // renders past the end of its track.
  const s = createAthleteStamina({ tuning: { start: 5 } });
  s.spend('hit');
  check('an unaffordable spend deducts nothing', approx(s.value, 5), `${s.value}`);
  check('and is reported as a refusal', s.denied && s.deniedKind === 'hit');
  const t = createAthleteStamina({ tuning: { start: 5, hitCost: 5 } });
  t.spend('hit');
  check('an exactly-affordable spend goes through and lands on zero',
    approx(t.value, 0), `${t.value}`);
}
{
  /* FLOATING POINT. `value` is accumulated by regeneration, so an exactly-full
     bar is really 99.99999999999. A dive refused at 30.0 stamina is a bug
     report, and the epsilon in `canAfford` is what prevents it. */
  const hair = T.diveCost - 1e-12;
  const s = createAthleteStamina({ tuning: { start: hair } });
  check('a value a hair under the cost would fail a naive comparison',
    !(s.value >= T.diveCost), `${s.value}`);
  check('but is still affordable, because of the epsilon', s.canAfford('dive'));
  check('NEGATIVE CONTROL: a MEANINGFUL shortfall is still refused',
    !createAthleteStamina({ tuning: { start: T.diveCost - 0.5 } }).canAfford('dive'));

  // And the same thing arrived at by actually regenerating, with a rate that
  // does not divide evenly into the cost.
  const t = createAthleteStamina({ tuning: { start: 0, regen: 17, regenDelay: 0, exhaustTime: 0 } });
  while (t.value < T.diveCost) t.update(DT);
  check('a regenerated tank crosses the cost and can spend it',
    t.canAfford('dive') && t.spend('dive') && t.value >= 0, `${t.value}`);
}

// ---------------------------------------------------------------------------
console.log('\n3. The slide drains, and its reserve is not a charge');
{
  const s = createAthleteStamina();
  check('checking affordability charges nothing',
    s.canAfford('slide') && s.value === T.max, `${s.value}`);
  const before = s.value;
  s.drain('slide', 1.0);
  check('one second of sliding costs one second of drain',
    approx(s.value, before - T.slideDrain), `${s.value}`);
  check('and drain reports there is fuel left', s.drain('slide', 0) === true);
}
{
  // The reserve refuses a slide there is no point starting.
  const s = createAthleteStamina({ tuning: { start: T.slideMinReserve - 1 } });
  check('below the reserve a slide is refused', !s.canAfford('slide'));
  const t = createAthleteStamina({ tuning: { start: T.slideMinReserve } });
  check('exactly at the reserve it is allowed', t.canAfford('slide'));
  check('NEGATIVE CONTROL: the reserve is not the drain rate',
    T.slideMinReserve !== T.slideDrain);
}
{
  /* THE DESIGN CONSTRAINT WORTH ASSERTING: a full bar must NOT sustain a
     maximum-length slide. If it did, the clock would always be what ends a
     slide and the meter would be decoration. */
  const sustain = T.max / T.slideDrain;
  check('a full bar sustains less than slideMaxTime of sliding',
    sustain < AT.slideMaxTime, `${sustain.toFixed(2)} s vs ${AT.slideMaxTime} s cap`);
  check('but comfortably more than the commit window',
    sustain > AT.slideCommitTime * 3, `${sustain.toFixed(2)} s`);
}
{
  const s = createAthleteStamina();
  let steps = 0;
  while (s.drain('slide', DT) && steps < 10000) steps++;
  check('draining terminates at zero, not below', s.value === 0, `${s.value}`);
  check('and takes the time the arithmetic says',
    approx(steps * DT, T.max / T.slideDrain, 0.02), `${(steps * DT).toFixed(3)} s`);
  check('running dry triggers exhaustion', s.exhausted);
}

// ---------------------------------------------------------------------------
console.log('\n4. Regeneration, and the delay that gives costs meaning');
{
  const s = createAthleteStamina({ tuning: { start: 0, exhaustTime: 0 } });
  idle(s, 1.0);
  check('idling regenerates at the tuned rate', approx(s.value, T.regen, 0.4), `${s.value}`);
  idle(s, 30);
  check('and stops at the maximum', s.value === T.max, `${s.value}`);
}
{
  // Committed states forbid recovery entirely.
  const s = createAthleteStamina({ tuning: { start: 40, regenDelay: 0 } });
  idle(s, 1.0, { draining: true });
  check('no regeneration while committed', approx(s.value, 40), `${s.value}`);
  idle(s, 1.0, { draining: false });
  check('NEGATIVE CONTROL: the same second while free does regenerate',
    s.value > 40 + T.regen * 0.8, `${s.value}`);
}
{
  /* THE WHIFF ARITHMETIC — the reason `regenDelay` exists.

     RECORDED, because the numbers moved underneath it: at the original 18/s
     regeneration a whiffed swing (windup + active + whiff recovery = 0.71 s)
     paid back 12.8 points against a 10-point cost, so swinging at air was NET
     POSITIVE and the delay was the only thing standing between the meter and
     decoration. Recovery is 8/s now and the whiff is already a loss without it.

     The delay still earns its place — it roughly triples the loss — and the
     property worth asserting is the ORDERING, not the historical emergency:
     recovery during a whiff must not come close to paying for it. */
  const cycle = AT.hitWindup + AT.hitActive + AT.hitWhiffRecover;
  const withoutDelay = T.regen * cycle;
  const withDelay = T.regen * Math.max(0, cycle - T.regenDelay);
  check('a whiff is a net loss even before the delay is counted',
    withoutDelay < T.hitCost, `${withoutDelay.toFixed(1)} regen vs ${T.hitCost} cost`);
  check('and the delay makes it a much bigger one',
    withDelay < withoutDelay * 0.6,
    `${withDelay.toFixed(1)} with vs ${withoutDelay.toFixed(1)} without`);
  check('so a swing costs most of its face value',
    T.hitCost - withDelay > T.hitCost * 0.75,
    `net ${(T.hitCost - withDelay).toFixed(1)} of ${T.hitCost}`);

  // And measured, not just derived.
  const s = createAthleteStamina();
  const start = s.value;
  for (let i = 0; i < 5; i++) { s.spend('hit'); idle(s, cycle); }
  check('five whiffed swings measurably drain the bar', s.value < start - 5 * 3,
    `${s.value.toFixed(1)} from ${start}`);
}
{
  const s = createAthleteStamina();
  s.spend('hit');
  const afterSpend = s.value;
  idle(s, T.regenDelay * 0.5);
  check('regeneration is held off right after a spend', approx(s.value, afterSpend),
    `${s.value}`);
  check('and the remaining hold is reported', s.regenDelayRemaining > 0);
  idle(s, T.regenDelay);
  check('then it resumes', s.value > afterSpend, `${s.value}`);
}

// ---------------------------------------------------------------------------
console.log('\n4b. Two regeneration rates');
{
  /* RECOVERY IS SOMETHING YOU STOP TO DO. The fast rate is for standing still;
     anything else trickles. Both measured, and the ratio asserted, because the
     gap between them IS the mechanic — if they were close the distinction would
     be arithmetic nobody could feel. */
  const rest = createAthleteStamina({ tuning: { start: 0, exhaustTime: 0 } });
  idle(rest, 1.0, { atRest: true });
  check('at rest, the fast rate', approx(rest.value, T.regen, 0.3), `${rest.value}`);

  const moving = createAthleteStamina({ tuning: { start: 0, exhaustTime: 0 } });
  idle(moving, 1.0, { atRest: false });
  check('moving, the slow one', approx(moving.value, T.regenMoving, 0.15), `${moving.value}`);
  check('and moving is drastically slower, not marginally',
    T.regen >= T.regenMoving * 3, `${T.regen} vs ${T.regenMoving}`);
  check('the live rate is reported for the HUD',
    approx(rest.regenRate, T.regen) && approx(moving.regenRate, T.regenMoving),
    `${rest.regenRate} / ${moving.regenRate}`);
  check('and the reported rate is 0 while recovery is blocked',
    (() => {
      const s = createAthleteStamina({ tuning: { start: 50 } });
      s.spend('hit');
      return s.regenRate === 0;
    })());

  // A host that never passes `atRest` must not silently drop to the trickle.
  const legacy = createAthleteStamina({ tuning: { start: 0, exhaustTime: 0 } });
  idle(legacy, 1.0);
  check('a host that omits atRest gets the fast rate, not the slow one',
    approx(legacy.value, T.regen, 0.3), `${legacy.value}`);

  // The headline number: recovery is now SLOW in absolute terms.
  check('a full bar from empty takes a real amount of standing still',
    T.max / T.regen > 8, `${(T.max / T.regen).toFixed(1)} s`);
}

// ---------------------------------------------------------------------------
console.log('\n4c. Sprinting and climbing');
{
  const s = createAthleteStamina();
  s.drain('sprint', 1.0);
  check('a second of sprinting costs its tuning',
    approx(s.value, T.max - T.sprintDrain), `${s.value}`);
  // One second is already spent above, so the remainder is what is left.
  let steps = 0;
  while (s.drain('sprint', DT) && steps < 100000) steps++;
  check('and a full bar buys a real but finite sprint',
    approx(1 + (steps + 1) * DT, T.max / T.sprintDrain, 0.05),
    `${(1 + (steps + 1) * DT).toFixed(2)} s vs ${(T.max / T.sprintDrain).toFixed(2)}`);
  check('which is long enough to be useful', T.max / T.sprintDrain > 8,
    `${(T.max / T.sprintDrain).toFixed(1)} s`);
  check('running out of sprint exhausts you', s.exhausted);
}
{
  const s = createAthleteStamina({ tuning: { start: T.sprintMinReserve } });
  check('at the reserve, sprinting is allowed', s.canAfford('sprint'));
  const t = createAthleteStamina({ tuning: { start: T.sprintMinReserve - 1 } });
  check('below it, refused', !t.canAfford('sprint'));
  check('and the reserve is small — walking is never the thing being gated',
    T.sprintMinReserve < T.diveCost / 2, `${T.sprintMinReserve}`);
}
{
  /* THE INCLINE TAX is proportional to the rate of ASCENT. Traversing a ramp
     sideways is free; going straight up it is not. That is the whole reason it
     is not a function of the slope angle alone. */
  const rate = (climbRate, slopeDeg, grounded = true) =>
    inclineDrainRate({ climbRate, slopeDeg, grounded, tuning: T });

  check('flat ground is free', rate(0, 0) === 0);
  check('a gentle rise is free', rate(1.5, T.inclineMinSlope - 1) === 0);
  check('a steep climb is taxed', rate(1.5, T.inclineMinSlope + 1) > 0);
  check('and the tax scales with how fast you climb',
    approx(rate(2, 30), 2 * rate(1, 30)), `${rate(2, 30)} vs ${rate(1, 30)}`);
  check('descending costs nothing', rate(-2, 30) === 0);
  check('NEGATIVE CONTROL: the same slope climbed does cost', rate(2, 30) > 0);
  check('and nothing is owed in mid-air — there is nothing to push against',
    rate(2, 30, false) === 0);

  // The design target, stated as the arithmetic it comes from: running up a
  // 25° ramp at 6 m/s should buy roughly ten seconds.
  const climb = 6 * Math.sin(25 * Math.PI / 180);
  const perSecond = rate(climb, 25);
  check('a hard climb is expensive but survivable',
    T.max / perSecond > 6 && T.max / perSecond < 20,
    `${(T.max / perSecond).toFixed(1)} s at ${perSecond.toFixed(1)}/s`);
}
{
  // Applied through `drain`'s scale, which is the path the host actually uses.
  const s = createAthleteStamina();
  s.drain('incline', 1.0, 10);
  check('the incline drain goes through the same meter', approx(s.value, T.max - 10),
    `${s.value}`);
  check('and it blocks regeneration like every other spend',
    s.regenDelayRemaining > 0);
  const t = createAthleteStamina();
  t.drain('incline', 1.0, 0);
  check('NEGATIVE CONTROL: a zero rate costs nothing', t.value === T.max, `${t.value}`);
}
{
  /* A CONTINUOUS DRAIN SUPPRESSES RECOVERY ON ITS OWN, with no extra rule: the
     drain re-arms `regenDelay` every step. This is worth an explicit test
     because it is a property that falls out of the design rather than one
     anybody wrote, and a future refactor could lose it silently. */
  const s = createAthleteStamina({ tuning: { start: 50 } });
  for (let i = 0; i < 120; i++) { s.drain('sprint', DT); s.update(DT, { atRest: false }); }
  const spent = 50 - s.value;
  check('sprinting nets the full drain, with no regeneration underneath it',
    approx(spent, T.sprintDrain * 2, 0.3), `${spent.toFixed(2)} over 2 s`);
}

// ---------------------------------------------------------------------------
console.log('\n4d. Jumping');
{
  /* TWO COSTS, because a jump here is two things: one impulse, plus a hold that
     buys altitude by keeping gravity light while the button is down. */
  const s = createAthleteStamina();
  check('a jump costs its flat tuning',
    s.spend('jump') && approx(s.value, T.max - T.jumpCost), `${s.value}`);
  s.drain('jumpHold', 0.5);
  check('and holding it drains on top',
    approx(s.value, T.max - T.jumpCost - T.jumpHoldDrain * 0.5), `${s.value}`);

  const full = T.jumpCost + T.jumpHoldDrain * 0.35;
  check('a fully-held jump is a real fraction of a dive, not a rounding error',
    full > T.diveCost * 0.4 && full < T.diveCost, `${full.toFixed(1)} vs ${T.diveCost}`);
  check('but cheaper than a dive — it is the cheapest thing on the price list',
    T.jumpCost < T.diveCost && T.jumpCost > 0);
  check('a full bar buys several jumps', Math.floor(T.max / full) >= 4,
    `${Math.floor(T.max / full)}`);
}
{
  // An exhausted athlete cannot jump at all.
  const s = createAthleteStamina({ tuning: { start: 0 } });
  s.drain('slide', 1);                       // arm the penalty
  check('an exhausted jump is refused', s.spend('jump') === false);
  check('and attributed', s.denied && s.deniedKind === 'jump');
  check('NEGATIVE CONTROL: a full tank jumps fine',
    createAthleteStamina().spend('jump') === true);

  const low = createAthleteStamina({ tuning: { start: T.jumpCost - 0.5 } });
  check('one point short is also refused', low.canAfford('jump') === false);
  check('exactly enough is allowed',
    createAthleteStamina({ tuning: { start: T.jumpCost } }).canAfford('jump'));
}
{
  /* THE HOLD HAS NO RESERVE, deliberately. It is the continuation of a jump
     already paid for; requiring one would cut the boost off mid-rise at an
     arbitrary height, which reads as the jump being broken rather than as
     running out of puff. It simply stops when the tank does. */
  check('the hold requires nothing to continue',
    createAthleteStamina({ tuning: { start: 0 } }).requirementOf('jumpHold') === 0);
  const s = createAthleteStamina({ tuning: { start: 2 } });
  s.drain('jumpHold', 1.0);
  check('and it stops at zero rather than going negative', s.value === 0, `${s.value}`);
  check('running the tank dry on a hold exhausts you', s.exhausted);
}

// ---------------------------------------------------------------------------
console.log('\n5. Exhaustion');
{
  let fired = 0;
  const s = createAthleteStamina({ tuning: { start: 10, hitCost: 10 }, onExhausted: () => fired++ });
  s.spend('hit');
  check('reaching zero triggers the penalty', s.exhausted && s.value === 0);
  check('and fires the hook exactly once', fired === 1, `${fired}`);
  s.drain('slide', 1.0);
  check('staying at zero does not re-arm it', fired === 1 && s.exhausted, `${fired}`);

  check('nothing is affordable while exhausted',
    !s.canAfford('dive') && !s.canAfford('slide') && !s.canAfford('hit'));
  idle(s, T.exhaustTime * 0.5);
  check('and no regeneration happens during the window', s.value === 0, `${s.value}`);
  check('the remaining time is reported', s.exhaustRemaining > 0);
  idle(s, T.exhaustTime);
  check('the window ends', !s.exhausted);
  check('and regeneration takes over', s.value > 0, `${s.value}`);
}
{
  /* THE WINDOW IS THE PENALTY, and it has to be measured rather than assumed:
     an off-by-one-frame timer decrement makes 1.5 s measure 1.52 and nobody
     ever finds out why the economy feels loose. */
  const s = createAthleteStamina({ tuning: { start: 0, regen: 1000 } });
  s.drain('slide', 1);                       // reach zero, arm the window
  let t = 0;
  while (s.exhausted && t < 10) { s.update(DT); t += DT; }
  check('the penalty lasts exactly its tuning', approx(t, T.exhaustTime, DT * 1.5),
    `${t.toFixed(3)} s vs ${T.exhaustTime}`);
}
{
  // The softer economy: exhaustion pauses regen but does not lock actions out.
  const s = createAthleteStamina({
    tuning: { start: 0, exhaustBlocksAll: false, hitCost: 0 },
  });
  s.drain('slide', 1);
  check('with the block off, a free action is still allowed while exhausted',
    s.exhausted && s.canAfford('hit'));
  check('NEGATIVE CONTROL: a costed one is still refused on affordability',
    !s.canAfford('dive'));
  const t = createAthleteStamina({ tuning: { start: 0, hitCost: 0 } });
  t.drain('slide', 1);
  check('and with the block ON even a free action is refused', !t.canAfford('hit'));
}

// ---------------------------------------------------------------------------
console.log('\n6. Refusal feedback');
{
  let denied = [];
  const s = createAthleteStamina({ tuning: { start: 0 }, onDenied: (k) => denied.push(k) });
  check('an unaffordable spend returns false', s.spend('dive') === false);
  check('and names what was refused', denied.length === 1 && denied[0] === 'dive',
    JSON.stringify(denied));
  check('the flash is live', s.denied && s.deniedKind === 'dive');
  idle(s, T.denyFlash + 0.1);
  check('and expires on its own', !s.denied && s.deniedKind === null);
  check('NEGATIVE CONTROL: an AFFORDABLE spend flags nothing',
    (() => { const t = createAthleteStamina(); t.spend('dive'); return !t.denied; })());
}

// ---------------------------------------------------------------------------
console.log('\n7. Reset, and robustness');
{
  const s = createAthleteStamina({ tuning: { start: 0 } });
  s.drain('slide', 1);
  s.reset();
  check('reset refills and clears every clock',
    s.value === T.max && !s.exhausted && !s.denied && s.regenDelayRemaining === 0);
  s.reset(0);
  check('reset to a value is honoured, without arming exhaustion',
    s.value === 0 && !s.exhausted);
}
{
  const s = createAthleteStamina();
  s.update();                                   // no dt, no state object
  s.update(0, {});
  s.drain('slide');                             // no dt
  check('missing arguments are tolerated', Number.isFinite(s.value) && s.value === T.max,
    `${s.value}`);

  // 20 000 chaotic frames: every invariant must hold at every step.
  const t = createAthleteStamina();
  let bad = 0, seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 20000; i++) {
    const r = rnd();
    if (r < 0.02) t.spend('dive');
    else if (r < 0.06) t.spend('hit');
    else if (r < 0.30) t.drain('slide', DT);
    t.update(DT, { draining: r < 0.30 });
    if (!(t.value >= 0 && t.value <= T.max && Number.isFinite(t.value))) bad++;
    if (t.fraction < 0 || t.fraction > 1) bad++;
  }
  check('20 000 chaotic frames never leave the tank', bad === 0, `${bad} violations`);
  check('and it is still usable at the end', Number.isFinite(t.value));
}
{
  /* A ZERO MAXIMUM is a tuning slider away, and a division by it would put NaN
     into a CSS width — which renders as a bar of indeterminate length rather
     than as an error anyone would notice. */
  const s = createAthleteStamina({ tuning: { max: 0 } });
  s.update(DT);
  check('a zero maximum does not produce NaN', s.fraction === 0 && Number.isFinite(s.value),
    `${s.fraction}`);
}

// ---------------------------------------------------------------------------
console.log('\n8. Wired into the action machine');
{
  // WITHOUT stamina the module must behave exactly as it did before this
  // feature existed. Everything in test-athlete-actions.mjs depends on it.
  const a = createAthleteActions();
  check('no stamina object → a dive is free', a.tryDive(true) === true);
  const b = createAthleteActions();
  b.update(DT, { speed: 9, grounded: true, slideHeld: true });
  check('and a slide is free', b.state === 'sliding', b.state);
}
{
  const s = createAthleteStamina();
  const a = createAthleteActions({ stamina: s });
  check('a dive charges the tank', a.tryDive(true) && approx(s.value, T.max - T.diveCost),
    `${s.value}`);
  a.reset();
  s.reset(T.diveCost - 1);
  check('and is refused one point short', a.tryDive(true) === false, a.state);
  check('the state machine did not move', a.state === 'none', a.state);
  check('nothing was deducted for the refusal', approx(s.value, T.diveCost - 1), `${s.value}`);
  check('and the refusal is attributed to stamina', s.denied && s.deniedKind === 'dive');
}
{
  /* CHARGE ORDER. A dive refused by the GROUNDED rule must not be billed —
     paying for an action that never happened is the cheapest possible way to
     make a resource system feel unfair. */
  const s = createAthleteStamina();
  const a = createAthleteActions({ stamina: s });
  check('a mid-air dive is refused', a.tryDive(false) === false);
  check('and costs nothing', s.value === T.max, `${s.value}`);
  check('NEGATIVE CONTROL: the same dive on the ground does cost',
    a.tryDive(true) && s.value < T.max);
}
{
  const s = createAthleteStamina();
  const a = createAthleteActions({ stamina: s });
  check('a swing charges the tank', a.tryHit('volley') && approx(s.value, T.max - T.hitCost),
    `${s.value}`);
  // Refused for a NON-stamina reason: no double charge.
  const before = s.value;
  check('a second swing while swinging is refused', a.tryHit('spike') === false);
  check('and is not billed', approx(s.value, before), `${s.value}`);
}
{
  const s = createAthleteStamina();
  const a = createAthleteActions({ stamina: s });
  const S = (o) => Object.assign({ grounded: true, speed: 9 }, o);
  a.update(DT, S({ slideHeld: true }));
  check('a slide starts with a full tank', a.state === 'sliding', a.state);
  const after = s.value;
  check('and entering it charged nothing', approx(after, T.max), `${after}`);
  a.update(DT, S({ slideHeld: true }));
  check('but holding it does drain', s.value < after, `${s.value}`);
}
{
  /* RUNNING DRY MID-SLIDE. It resolves through the SAME path as letting go of
     the trigger — same commit window, same stand-up-or-wipeout decision — so
     there is only ever one copy of that logic. Fast enough to stand up here. */
  const s = createAthleteStamina({ tuning: { start: 8 } });
  const a = createAthleteActions({ stamina: s });
  const S = (o) => Object.assign({ grounded: true, speed: 9 }, o);
  a.update(DT, S({ slideHeld: true }));
  check('a slide can start on a low tank if it clears the reserve',
    a.state === (8 >= T.slideMinReserve ? 'sliding' : 'none'), a.state);

  const t = createAthleteStamina({ tuning: { start: T.slideMinReserve } });
  const b = createAthleteActions({ stamina: t });
  b.update(DT, S({ slideHeld: true }));
  check('exactly at the reserve, the slide starts', b.state === 'sliding', b.state);
  let frames = 0;
  while (b.state === 'sliding' && frames < 2000) {
    b.update(DT, S({ slideHeld: true }));       // trigger HELD the whole time
    frames++;
  }
  check('and running dry ends it even with the trigger held',
    b.state !== 'sliding', b.state);
  check('with the reason saying why', /stamina/.test(b.reason), b.reason);
  check('the commit window was still respected',
    frames * DT >= AT.slideCommitTime, `${(frames * DT).toFixed(2)} s`);
  check('NEGATIVE CONTROL: an unlimited tank keeps the same slide going',
    (() => {
      const c = createAthleteActions({ stamina: createAthleteStamina({ tuning: { slideDrain: 0 } }) });
      c.update(DT, S({ slideHeld: true }));
      for (let i = 0; i < frames + 10; i++) c.update(DT, S({ slideHeld: true }));
      return c.state === 'sliding';
    })(), 'a zero-drain slide should still be running');
}
{
  // The whole loop, as the demo runs it: actions first, then the meter.
  const s = createAthleteStamina();
  const a = createAthleteActions({ stamina: s });
  const step = (o) => {
    a.update(DT, Object.assign({ grounded: true, speed: 9 }, o));
    s.update(DT, { draining: a.physics.passive });
  };
  for (let i = 0; i < 400; i++) step({ divePressed: i % 40 === 0, volleyPressed: i % 17 === 0 });
  check('400 frames of spam never overdraw the tank',
    s.value >= 0 && s.value <= T.max && Number.isFinite(s.value), `${s.value}`);
  check('and the machine is in a valid state',
    ['none', 'sliding', 'diving', 'skidding', 'knocked', 'recovering'].includes(a.state),
    a.state);

  /* SPAM HAS TO BE PUNISHED, or the whole feature is decorative.

     `speed: 0`, deliberately. At speed the SKID is what limits the dive rate
     (it runs to `skidMaxTime` because nothing here decelerates), and both
     machines would land on the same count — a check that passes or fails for a
     reason that has nothing to do with stamina. At a standstill the skid ends
     immediately and the only thing left rate-limiting a dive is the tank. */
  /* `skidEndsInKnockdown: false` on BOTH, deliberately. A dive now resolves into
     a knockdown plus a recovery, and that is what rate-limits diving — both
     machines would land on the same count and the check would pass or fail for
     a reason with nothing to do with stamina. Switched off, the only thing left
     rate-limiting a dive is the tank, which is what this measures. */
  const softDive = { skidEndsInKnockdown: false };
  const free = createAthleteActions({ tuning: { ...softDive } });
  let freeDives = 0, pricedDives = 0;
  const s2 = createAthleteStamina();
  const priced = createAthleteActions({ tuning: { ...softDive }, stamina: s2 });
  const world = { grounded: true, speed: 0 };
  for (let i = 0; i < 600; i++) {
    if (free.tryDive(true)) freeDives++;
    free.update(DT, world);
    if (priced.tryDive(true)) pricedDives++;
    priced.update(DT, world);
    s2.update(DT, { draining: priced.physics.passive });
  }
  check('a free athlete dives constantly', freeDives > 20, `${freeDives}`);
  check('stamina genuinely limits dive spam', pricedDives < freeDives / 2,
    `${pricedDives} priced vs ${freeDives} free`);
  check('but does not stop it entirely — it is a budget, not a ban',
    pricedDives >= 3, `${pricedDives}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
