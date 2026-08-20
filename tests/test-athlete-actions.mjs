/**
 * Offline verification of athlete-actions.js.
 * Focus: the slide rules that the one-line spec doesn't capture — minimum entry
 * speed, the grace window, the commit window, and the airborne pause — plus the
 * knockdown/recovery chain and the physics profile it exports.
 */
import { createAthleteActions, DEFAULT_ACTION_TUNING } from './athlete-actions.js';

let pass = 0, fail = 0;
const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const T = DEFAULT_ACTION_TUNING;
const DT = 1 / 60;
const S = (o = {}) => Object.assign({ grounded: true, speed: 0, slideHeld: false }, o);
const run = (a, seconds, s) => { let last; for (let i = 0; i < Math.round(seconds / DT); i++) last = a.update(DT, s); return last; };
const FAST = T.slideMinEntrySpeed + 3;

// ---------------------------------------------------------------------------
console.log('\n1. Baseline');
{
  const a = createAthleteActions();
  check('starts in none', a.state === 'none');
  check('movement is not locked', !a.movementLocked);
  check('physics profile is inert', !a.physics.passive && !a.physics.frozen && !a.physics.lowFriction);
  check('the puppet starts pinned', a.physics.puppet === 'pinned', a.physics.puppet);
}

// ---------------------------------------------------------------------------
console.log('\n2. Slide entry requires real speed');
{
  const a = createAthleteActions();
  run(a, 0.5, S({ speed: 0, slideHeld: true }));
  check('cannot slide from standing still', a.state === 'none', a.state);
  check('and is NOT knocked down for trying', a.state !== 'knocked', a.state);
}
{
  const a = createAthleteActions();
  run(a, 0.1, S({ speed: T.slideMinEntrySpeed - 0.3, slideHeld: true }));
  check('cannot slide just below the entry speed', a.state === 'none', a.state);
}
{
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  check('slides when fast enough', a.state === 'sliding', a.state);
  check('physics goes passive', a.physics.passive && a.physics.steering && a.physics.lowFriction);
  check('movement is not locked while sliding', !a.movementLocked);
}
{
  const a = createAthleteActions();
  run(a, 0.5, S({ speed: FAST, slideHeld: true, grounded: false }));
  check('cannot start a slide in mid-air', a.state === 'none', a.state);
}

// ---------------------------------------------------------------------------
console.log('\n3. Grace window: a fresh slide is not instantly punished');
{
  // Enter at a legal speed, then immediately drop below the wipeout threshold.
  // Without grace this would knock down on the very next frame.
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  run(a, T.slideGraceTime - 0.1, S({ speed: T.slideMinSpeed - 1, slideHeld: true }));
  check('slow speed inside grace does not wipe out', a.state === 'sliding', a.state);
  check('wipeout check reads as not armed', !a.slideArmed);

  run(a, 0.2, S({ speed: T.slideMinSpeed - 1, slideHeld: true }));
  check('once grace elapses, it wipes out', a.state === 'knocked', a.state);
  check('the reason is recorded', /momentum/.test(a.reason), a.reason);
}
{
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  run(a, T.slideGraceTime + 0.3, S({ speed: FAST, slideHeld: true }));
  check('a fast slide keeps going once armed', a.state === 'sliding', a.state);
  check('and reports itself armed', a.slideArmed);
  check('margin above the threshold is reported',
    approx(a.slideMargin(FAST), FAST - T.slideMinSpeed), `${a.slideMargin(FAST)}`);
}

// ---------------------------------------------------------------------------
console.log('\n4. Airborne pauses the wipeout check');
{
  // Launching off a crest loses ground speed without losing momentum.
  // Being punished for catching air on a sloped court would be backwards.
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  run(a, 1.5, S({ speed: 0.2, slideHeld: true, grounded: false }));
  check('slow ground speed while airborne does not wipe out', a.state === 'sliding', a.state);
  check('and the check stays disarmed in the air', !a.slideArmed);
}
{
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  run(a, 1.0, S({ speed: 0.2, slideHeld: true, grounded: false }));
  run(a, T.slideGraceTime + 0.2, S({ speed: 0.2, slideHeld: true, grounded: true }));
  check('landing slow then arms and wipes out', a.state === 'knocked', a.state);
}

// ---------------------------------------------------------------------------
console.log('\n5. Commit window: you cannot bail out of the gamble');
{
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  run(a, T.slideCommitTime - 0.15, S({ speed: FAST, slideHeld: false }));
  check('releasing inside the commit window is ignored', a.state === 'sliding', a.state);
  check('and it reports as committed', a.slideCommitted);

  run(a, 0.25, S({ speed: FAST, slideHeld: false }));
  check('after the commit window, release stands you up', a.state === 'none', a.state);
  check('physics returns to normal', !a.physics.passive && !a.physics.lowFriction);
}
{
  // The band between the two thresholds: fast enough to keep sliding, too slow
  // to get back on your feet. Releasing here must wipe out, for that reason.
  const between = (T.slideMinSpeed + T.slideExitSpeed) / 2;
  check('there IS a band between sliding on and standing up',
    T.slideExitSpeed - T.slideMinSpeed > 0.4,
    `min=${T.slideMinSpeed} exit=${T.slideExitSpeed}`);

  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  run(a, T.slideCommitTime + 0.1, S({ speed: between, slideHeld: false }));
  check('releasing inside that band wipes out', a.state === 'knocked', a.state);
  check('and says it was too slow to stand', /stand/.test(a.reason), a.reason);
}
{
  // Below slideMinSpeed the momentum rule fires first, and should.
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  run(a, T.slideCommitTime + 0.1, S({ speed: T.slideMinSpeed - 0.5, slideHeld: false }));
  check('below the momentum threshold, that rule wins', /momentum/.test(a.reason), a.reason);
}
{
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  run(a, T.slideMaxTime + 0.2, S({ speed: FAST, slideHeld: true }));
  check('a slide cannot run forever', a.state === 'knocked', a.state);
  check('timeout is reported', /timed out/.test(a.reason), a.reason);
}

// ---------------------------------------------------------------------------
console.log('\n5b. The stall floor, and the two ways out of a slide');
{
  /* A STOPPED SLIDE IS A FALL. `slideMinSpeed` is the graded "you are losing
     it" rule and it waits for grace; this is the floor underneath it, and it
     waits for nothing. At 0.6 m/s there is no argument to be had — you are on
     the floor either way and the only question is whether the game admits it. */
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  check('the slide started', a.state === 'sliding', a.state);
  a.update(DT, S({ speed: T.slideStallSpeed - 0.1, slideHeld: true }));
  check('stalling drops you immediately, inside the commit window',
    a.state === 'knocked', a.state);
  check('and says why', /halt/.test(a.reason), a.reason);
  check('NEGATIVE CONTROL: the commit window really had not elapsed',
    a.stateTime < T.slideCommitTime, `${a.stateTime}`);
  check('the floor sits well below the graded threshold',
    T.slideStallSpeed < T.slideMinSpeed, `${T.slideStallSpeed} vs ${T.slideMinSpeed}`);
}
{
  // Airborne is exempt: a slide that leaves the deck over a crest is briefly at
  // low GROUND speed without having lost anything.
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  run(a, 0.3, S({ speed: 0.1, slideHeld: true, grounded: false }));
  check('stalling in mid-air does not drop you', a.state === 'sliding', a.state);
  a.update(DT, S({ speed: 0.1, slideHeld: true, grounded: true }));
  check('NEGATIVE CONTROL: the same speed on landing does', a.state === 'knocked', a.state);
}
{
  /* JUMP IS THE ESCAPE HATCH, and it has to work at the moment you want it —
     which is the moment you are about to fall over, inside the commit window. */
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  a.update(DT, S({ speed: FAST, slideHeld: true, jumpPressed: true }));
  check('jump bails out of a slide', a.state === 'none', a.state);
  check('even inside the commit window', /jumped/.test(a.reason), a.reason);
  check('and it is a clean exit, not a knockdown', !a.movementLocked);

  // It beats the stall, which is the only ordering that makes it useful.
  const b = createAthleteActions();
  b.update(DT, S({ speed: FAST, slideHeld: true }));
  b.update(DT, S({ speed: 0.05, slideHeld: true, jumpPressed: true }));
  check('jumping on the very frame you stall still saves you',
    b.state === 'none', `${b.state}/${b.reason}`);
  const c = createAthleteActions();
  c.update(DT, S({ speed: FAST, slideHeld: true }));
  c.update(DT, S({ speed: 0.05, slideHeld: true }));
  check('NEGATIVE CONTROL: without the jump, the same frame drops you',
    c.state === 'knocked', c.state);

  // And it can be turned off.
  const d = createAthleteActions({ tuning: { slideJumpEscape: false } });
  d.update(DT, S({ speed: FAST, slideHeld: true }));
  d.update(DT, S({ speed: FAST, slideHeld: true, jumpPressed: true }));
  check('the escape is optional', d.state === 'sliding', d.state);
}
{
  // Releasing at speed remains the OTHER way out, unchanged.
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  run(a, T.slideCommitTime + 0.1, S({ speed: FAST, slideHeld: false }));
  check('releasing with momentum still stands you up cleanly', a.state === 'none', a.state);
}

// ---------------------------------------------------------------------------
console.log('\n5c. The slide speed band');
{
  /* THE CHECK IS A TRUE MAGNITUDE, not a squared one. `speed` arrives from the
     host as hypot(vx, vz) and is compared directly against thresholds in m/s;
     nothing here squares anything. The way to prove that from outside is
     DIMENSIONAL: a threshold of 4 must fire at 3.9 and not at 4.1. Under a
     squared comparison (16 vs speed²) it would fire anywhere below 4²=16, i.e.
     at every speed up to 16 m/s — so the 4.1 case is the one that catches it. */
  const at = (speed) => {
    const a = createAthleteActions({ tuning: { slideMinSpeed: 4, slideGraceTime: 0 } });
    a.update(DT, S({ speed: FAST, slideHeld: true }));
    run(a, 0.2, S({ speed, slideHeld: true }));
    return a.state;
  };
  check('just under the threshold wipes out', at(3.9) === 'knocked', at(3.9));
  check('just over it does not', at(4.1) === 'sliding', at(4.1));
  check('NEGATIVE CONTROL: a squared comparison would fail the second of those',
    4.1 < 4 * 4);

  // And the same at a completely different scale, so a coincidence at 4 cannot
  // carry the claim.
  const at9 = (speed) => {
    const a = createAthleteActions({
      tuning: { slideMinSpeed: 9, slideMinEntrySpeed: 10, slideGraceTime: 0 } });
    a.update(DT, S({ speed: 12, slideHeld: true }));
    run(a, 0.2, S({ speed, slideHeld: true }));
    return a.state;
  };
  check('the threshold tracks its tuning at any scale',
    at9(8.9) === 'knocked' && at9(9.1) === 'sliding');
}
{
  /* THE BAND ONLY WORKS AS A SET, and the two ways to break it are silent. */
  const a = createAthleteActions();
  const b = a.slideBand();
  check('the shipped defaults are coherent', b.coherent, b.problems.join('; '));
  check('and in band order',
    b.stall < b.wipeout && b.wipeout < b.exit && b.exit <= b.entry,
    `${b.stall} < ${b.wipeout} < ${b.exit} <= ${b.entry}`);

  const over = createAthleteActions({ tuning: { slideMinSpeed: 99 } }).slideBand();
  check('raising the knockdown speed past the others is REPORTED, not silent',
    !over.coherent && over.problems.length >= 2, over.problems.join('; '));
  check('and it names the stand-up collision specifically',
    over.problems.some((p) => /exit/.test(p)), over.problems.join('; '));

  const low = createAthleteActions({ tuning: { slideStallSpeed: 9 } }).slideBand();
  check('so is a stall floor above the wipeout threshold',
    !low.coherent && low.problems.some((p) => /stall/.test(p)), low.problems.join('; '));
}
{
  // The dial is reachable and live — it is the one people retune.
  const tune = {};
  const a = createAthleteActions({ tuning: tune });
  check('slideMinSpeed is a top-level tuning key', tune.slideMinSpeed === T.slideMinSpeed);
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  tune.slideMinSpeed = FAST + 1;                    // ← what the slider does
  tune.slideGraceTime = 0;
  run(a, 0.1, S({ speed: FAST, slideHeld: true }));
  check('and raising it mid-slide takes effect immediately', a.state === 'knocked',
    a.state);
}

// ---------------------------------------------------------------------------
console.log('\n6. Knockdown → recovery chain');
{
  const a = createAthleteActions();
  check('knockDown works from none', a.knockDown('test') === true);
  check('state is knocked', a.state === 'knocked');
  check('movement is locked', a.movementLocked);
  check('physics is frozen', a.physics.frozen);
  check('a second knockDown while down is refused', a.knockDown() === false);

  run(a, T.knockdownTime - 0.1, S());
  check('stays down for the full duration', a.state === 'knocked', a.state);
  run(a, 0.2, S());
  check('then recovers', a.state === 'recovering', a.state);
  check('still locked while getting up', a.movementLocked);
  run(a, T.recoverTime + 0.1, S());
  check('control is returned', a.state === 'none' && !a.movementLocked, a.state);
  check('physics unfrozen', !a.physics.frozen);
}
{
  // Landing matters: you cannot get up while still in the air.
  const a = createAthleteActions();
  a.knockDown();
  run(a, T.knockdownTime + 1.0, S({ grounded: false }));
  check('does not recover while airborne', a.state === 'knocked', a.state);
  run(a, 0.1, S({ grounded: true }));
  check('recovers once grounded', a.state === 'recovering', a.state);
}
{
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  check('sliding before the hit', a.state === 'sliding');
  a.knockDown('impact');
  check('a knockdown cancels a slide outright', a.state === 'knocked', a.state);
  check('and clears the passive profile', !a.physics.passive && a.physics.frozen);
}

// ---------------------------------------------------------------------------
console.log('\n7. Transitions are observable');
{
  const seen = [];
  const a = createAthleteActions({ onTransition: (to, from, why) => seen.push(`${from}->${to}:${why}`) });
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  run(a, T.slideGraceTime + 0.3, S({ speed: 0.1, slideHeld: true }));
  check('transition hook fires for entry and wipeout', seen.length >= 2, seen.join(' | '));
  check('entry is reported first', seen[0].startsWith('none->sliding'), seen[0]);
  check('wipeout carries a reason', /sliding->knocked/.test(seen[1]), seen[1]);
}
{
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  check('changed flag is set on the transition frame', a.changed);
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  check('and cleared the frame after', !a.changed);
  check('previousState is tracked', a.previousState === 'none', a.previousState);
}

// ---------------------------------------------------------------------------
console.log('\n8. Dive');
{
  const a = createAthleteActions();
  check('dive can be started from none', a.tryDive(true) === true);
  check('state is diving', a.state === 'diving');
  check('physics goes passive but not frozen', a.physics.passive && !a.physics.frozen);
  check('and is flagged as a dive, distinct from a slide',
    a.physics.diving && !a.physics.steering,
    JSON.stringify(a.physics));
  check('the collider goes slippery so the landing skids', a.physics.lowFriction);
}
{
  // The profile must be correct the instant tryDive returns — the host reads it
  // in the same tick to decide which forces to run.
  const a = createAthleteActions();
  a.tryDive(true);
  check('the dive profile is live before the next update()', a.physics.diving);
  const b = createAthleteActions();
  b.update(DT, S({ divePressed: true }));
  check('and equally when entered through update()', b.physics.diving);
}
{
  // Without a ground requirement you can dive again mid-air, and the risk the
  // whole mechanic is built on becomes free flight.
  const a = createAthleteActions();
  check('an airborne dive is refused', a.tryDive(false) === false);
  check('and the state is untouched', a.state === 'none', a.state);
  const b = createAthleteActions({ tuning: { diveRequiresGround: false } });
  check('unless the rule is turned off', b.tryDive(false) === true);
}
{
  // A refused dive must not swallow the slide press that came with it.
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, grounded: false, divePressed: true, slideHeld: true }));
  check('a refused dive in mid-air leaves you in none', a.state === 'none', a.state);
  a.update(DT, S({ speed: FAST, grounded: true, divePressed: true, slideHeld: true }));
  check('and the dive lands the moment you touch down', a.state === 'diving', a.state);
}
{
  const a = createAthleteActions();
  a.tryDive(true);
  a.update(DT, S({ grounded: false, divePressed: true }));
  check('you cannot chain a second dive out of the first', a.state === 'diving');
  check('and it is still the original dive', a.stateTime > 0);
}
{
  const a = createAthleteActions();
  a.tryDive(true);
  run(a, T.diveMinAirTime - 0.02, S({ grounded: true }));
  check('the launch frame cannot end the dive', a.state === 'diving', a.state);
  // Landing hands the dive's remaining speed to a SKID, not to a knockdown.
  // Kept above the exit speed so the skid does not resolve on the same step.
  run(a, 0.15, S({ grounded: true, speed: FAST }));
  check('landing ends the dive in a skid', a.state === 'skidding', a.state);
  check('landing is the recorded reason', /landed/.test(a.reason), a.reason);
}
{
  const a = createAthleteActions();
  a.tryDive(true);
  run(a, T.diveMaxAirTime + 0.1, S({ grounded: false, speed: FAST }));
  check('a dive that never lands still resolves', a.state === 'skidding', a.state);
  check('timeout is the recorded reason', /timed out/.test(a.reason), a.reason);
}
{
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  a.update(DT, S({ speed: FAST, slideHeld: true, divePressed: true }));
  check('you can dive out of a slide', a.state === 'diving', a.state);
  check('and the physics profile follows immediately',
    a.physics.diving && !a.physics.steering);
}
{
  /* THE PRICE OF A DIVE CHANGED, and this is the test that records it.

     It used to be a KNOCKDOWN: every dive ended face-down, and the check here
     was that no path skipped it. That resolution also zeroed the velocity,
     which is what made a dive stop dead as though it had hit a wall.

     The price is now the SKID: you keep every bit of your momentum and you lose
     all of your control until it runs out. So the invariant becomes "no path
     out of a dive skips the skid", plus the lockout that makes the skid cost
     something. A dive with neither would simply be a better jump.

     Checked on the transition LOG, not the final state: after the skid has bled
     out the machine is legitimately back at 'none', so the end state proves
     nothing either way. */
  let skipped = 0, unlocked = 0, total = 0;
  for (const airborne of [true, false]) {
    for (const t of [0.05, 0.3, 1.0, 2.0, 4.0]) {
      const log = [];
      const a = createAthleteActions({ onTransition: (to) => log.push(to) });
      a.tryDive(true);
      // FAST throughout, so the skid is entered with speed to spend rather than
      // resolving on the step it begins.
      run(a, t, S({ grounded: !airborne, speed: FAST }));
      if (!a.movementLocked) unlocked++;
      run(a, 8.0, S({ grounded: true, speed: 0 }));
      total++;
      const d = log.indexOf('diving'), k = log.indexOf('skidding');
      if (k <= d) skipped++;
    }
  }
  check('every dive routes through a skid, whatever its length',
    skipped === 0, `${skipped} of ${total} escaped the skid`);
  check('and movement is locked for the whole of it',
    unlocked === 0, `${unlocked} of ${total} kept control`);
}
{
  /* THE LOCKOUT, stated directly. Diving and skidding lock movement for a
     different reason than being knocked down does — you are committed, not
     downed — but the flag the host reads is the same one. */
  const a = createAthleteActions();
  check('standing still is not locked', !a.movementLocked);
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  check('NEGATIVE CONTROL: a slide is NOT locked — it steers', !a.movementLocked, a.state);
  const b = createAthleteActions();
  b.tryDive(true);
  check('a dive is locked', b.movementLocked && b.committed);
  run(b, 0.4, S({ grounded: true, speed: FAST }));
  check('and so is the skid it becomes', b.state === 'skidding' && b.movementLocked);
  /* AND THEN THEY GO DOWN. A dive keeps its momentum through the skid and then
     pays for it on the floor — see `skidEndsInKnockdown`. Control does come
     back, but only after the knockdown and the recovery, which is the point:
     the dive is no longer a dash with a cooldown. */
  run(b, 2.0, S({ grounded: true, speed: 0 }));
  check('the skid drops them, rather than standing them up',
    b.state === 'knocked' && !b.committed, b.state);
  check('and they are still locked out on the floor', b.movementLocked);
  run(b, T.knockdownTime + T.recoverTime + 1.0,
    S({ grounded: true, speed: 0, puppetSettled: true }));
  check('control returns once they have got up',
    b.state === 'none' && !b.movementLocked, b.state);
}
{
  /* THE SKID ENDS ON SPEED, NOT ON A CLOCK. That is what "they are at the mercy
     of their momentum until they slide to a halt" means mechanically. */
  const a = createAthleteActions();
  a.tryDive(true);
  run(a, 0.4, S({ grounded: true, speed: FAST }));
  run(a, 3.0, S({ grounded: true, speed: T.skidExitSpeed + 0.5 }));
  check('a skid that keeps its speed keeps skidding', a.state === 'skidding', a.state);
  a.update(DT, S({ grounded: true, speed: T.skidExitSpeed - 0.01 }));
  check('and ends the moment it drops through the threshold',
    a.state === 'knocked' && /dive landed/.test(a.reason), `${a.state}/${a.reason}`);
  check('NEGATIVE CONTROL: with the penalty off it stands up instead',
    (() => {
      const c = createAthleteActions({ tuning: { skidEndsInKnockdown: false } });
      c.tryDive(true);
      run(c, 0.4, S({ grounded: true, speed: FAST }));
      c.update(DT, S({ grounded: true, speed: 0 }));
      return c.state === 'none';
    })());

  // The backstop exists for the pathological case: skid onto a downhill and the
  // speed may never fall on its own. Lying there forever is worse than a timer.
  const b = createAthleteActions();
  b.tryDive(true);
  run(b, 0.4, S({ grounded: true, speed: FAST }));
  run(b, T.skidMaxTime + 0.2, S({ grounded: true, speed: 40 }));
  check('but a skid that never slows is still ended by the backstop',
    b.state === 'knocked' && /timed out/.test(b.reason), `${b.state}/${b.reason}`);
}
{
  /* THE PHYSICS PROFILE. Three explicit flags, because the host used to derive
     "sliding" as `passive && !diving` — correct with two passive states, wrong
     the moment a third arrived, and it would have played the slide's posture
     through every skid. */
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  check('a slide reports itself as sliding, alone',
    a.physics.sliding && !a.physics.diving && !a.physics.skidding && a.physics.passive);
  check('and it is the only passive state that steers', a.physics.steering);
  const b = createAthleteActions();
  b.tryDive(true);
  check('a dive reports itself as diving, alone',
    b.physics.diving && !b.physics.sliding && !b.physics.skidding && b.physics.passive);
  run(b, 0.4, S({ grounded: true, speed: FAST }));
  check('a skid reports itself as skidding, alone',
    b.physics.skidding && !b.physics.sliding && !b.physics.diving && b.physics.passive);
  check('NEGATIVE CONTROL: the old derivation would have called it a slide',
    b.physics.passive && !b.physics.diving && !b.physics.sliding);
  check('and all three run the low-friction contact', b.physics.lowFriction);
  check('none of them is frozen — a skid is not a knockdown', !b.physics.frozen);
  check('and the puppet stays pinned throughout', b.physics.puppet === 'pinned');
}
{
  // The ground probe reaches past the body, so `grounded` stays true for a beat
  // after launch. diveMinAirTime has to outlast that or the dive resolves
  // before it leaves the deck.
  check('the landing floor outlasts the probe\'s post-launch grounded window',
    T.diveMinAirTime > 0.15, `${T.diveMinAirTime} s`);
  check('but is still far below the timeout', T.diveMinAirTime < T.diveMaxAirTime / 4);
}

// ---------------------------------------------------------------------------
console.log('\n8b. Hitting rides as an OVERLAY, not an exclusive state');
{
  const a = createAthleteActions();
  check('not swinging at rest', !a.hitting);
  a.update(DT, S({ volleyPressed: true }));
  check('a volley press starts a swing', a.hitting && a.hit.kind === 'volley', a.hit.phase);
  check('the exclusive state is untouched', a.state === 'none', a.state);
  check('movement is throttled while swinging', a.hitThrottle < 1, `${a.hitThrottle}`);
  check('contact is not live during windup', !a.contactOpen, a.hit.phase);
}
{
  const a = createAthleteActions();
  a.update(DT, S({ spikePressed: true }));
  check('a spike press picks the spike kind', a.hit.kind === 'spike');
  run(a, T.hitWindup + 0.02, S());
  check('after windup the contact window opens', a.contactOpen, a.hit.phase);
  run(a, T.hitActive + 0.02, S());
  check('the window then closes into recovery', a.hit.phase === 'recover', a.hit.phase);
}
{
  // The whole point of "committed swing": a whiff costs more than a hit.
  const hitRig = createAthleteActions();
  hitRig.update(DT, S({ volleyPressed: true }));
  run(hitRig, T.hitWindup + 0.02, S());
  hitRig.reportHitConnected();
  let connectedFrames = 0;
  while (hitRig.hitting && connectedFrames < 600) { hitRig.update(DT, S()); connectedFrames++; }

  const whiffRig = createAthleteActions();
  whiffRig.update(DT, S({ volleyPressed: true }));
  let whiffFrames = 0;
  while (whiffRig.hitting && whiffFrames < 600) { whiffRig.update(DT, S()); whiffFrames++; }

  check('a whiff takes longer to recover from than a connection',
    whiffFrames > connectedFrames + 5,
    `hit=${(connectedFrames / 60).toFixed(2)}s whiff=${(whiffFrames / 60).toFixed(2)}s`);
}
{
  const a = createAthleteActions();
  a.update(DT, S({ volleyPressed: true }));
  check('a second swing mid-swing is refused', a.tryHit('spike') === false);
  check('and the original kind is kept', a.hit.kind === 'volley');
}
{
  const a = createAthleteActions();
  a.update(DT, S({ volleyPressed: true }));
  check('reportHitConnected is refused before the window opens',
    a.reportHitConnected() === false, a.hit.phase);
  run(a, T.hitWindup + 0.02, S());
  check('accepted once the window is open', a.reportHitConnected() === true);
  check('and refused twice for the same swing', a.reportHitConnected() === false);
  check('contact closes after connecting', !a.contactOpen);
}
{
  /* REVERSED CONTRACT, recorded rather than deleted: you used to be able to
     swing mid-dive, on the reasoning that a hit is an overlay and overlays ride
     alongside anything.

     It is still an overlay — you can swing mid-slide and mid-jump, asserted
     immediately below — but a dive is now a COMMITMENT, and being able to swing
     out of one turns it into a free dash with a hitbox attached. That is the
     opposite of a risk. The commitment window is the dive AND the skid it
     decays into: ending the lockout at the state boundary would let you land a
     dive and immediately spike, which is the same exploit one state later. */
  const a = createAthleteActions();
  a.tryDive(true);
  a.update(DT, S({ grounded: false, volleyPressed: true }));
  check('a dive refuses a swing — it is a commitment, not a dash',
    !a.hitting && a.state === 'diving', `${a.state}/${a.hit.phase}`);
  run(a, 0.4, S({ grounded: true, speed: FAST }));
  a.update(DT, S({ grounded: true, speed: FAST, spikePressed: true }));
  check('and so does the skid, or the lockout would end one state early',
    !a.hitting && a.state === 'skidding', `${a.state}/${a.hit.phase}`);
  run(a, 3.0, S({ grounded: true, speed: 0 }));
  a.update(DT, S({ grounded: true, volleyPressed: true }));
  check('swinging works again once they are back on their feet',
    a.hitting && a.state === 'none', `${a.state}/${a.hit.phase}`);
}
{
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  a.update(DT, S({ speed: FAST, slideHeld: true, volleyPressed: true }));
  check('you can swing while sliding', a.hitting && a.state === 'sliding');
}
{
  const a = createAthleteActions();
  a.update(DT, S({ grounded: false, spikePressed: true }));
  check('you can swing mid-air (the jump spike)', a.hitting && a.hit.kind === 'spike');
}
{
  const a = createAthleteActions();
  a.update(DT, S({ volleyPressed: true }));
  a.knockDown('smashed');
  check('a knockdown cancels the swing outright', !a.hitting, a.hit.phase);
  check('and swinging is refused while down', a.tryHit('volley') === false);
}
{
  const a = createAthleteActions();
  a.update(DT, S({ volleyPressed: true, spikePressed: true }));
  check('pressing both at once resolves to exactly one swing',
    a.hitting && (a.hit.kind === 'volley' || a.hit.kind === 'spike'), a.hit.kind);
}
{
  const a = createAthleteActions();
  a.update(DT, S({ volleyPressed: true }));
  a.reset();
  check('reset clears a swing in progress', !a.hitting && a.hit.phase === 'idle');
  check('and throttle returns to full', a.hitThrottle === 1);
}
{
  // Mashing the hit button must never leave the machine stuck mid-swing.
  const a = createAthleteActions();
  let stuck = 0, swinging = 0;
  for (let i = 0; i < 4000; i++) {
    a.update(DT, S({
      speed: Math.abs(Math.sin(i / 30)) * 10,
      grounded: i % 41 !== 0,
      volleyPressed: i % 3 === 0,
      spikePressed: i % 7 === 0,
      slideHeld: i % 200 < 90,
    }));
    if (a.hitting) { swinging++; if (swinging > 60 * 3) stuck++; } else swinging = 0;
  }
  check('button mashing never jams a swing open', stuck === 0, `${stuck} overlong swings`);
}

// ---------------------------------------------------------------------------
console.log('\n9. Robustness');
{
  const a = createAthleteActions();
  let threw = false;
  try { a.update(DT); a.update(DT, {}); a.update(0, S()); } catch (e) { threw = true; }
  check('missing or empty state objects are tolerated', !threw);
}
{
  const a = createAthleteActions();
  a.update(DT, S({ speed: FAST, slideHeld: true }));
  a.reset();
  check('reset clears back to none', a.state === 'none' && !a.movementLocked);
  check('and clears the physics profile', !a.physics.passive && !a.physics.lowFriction);
}
{
  // Long chaotic session: the machine must always resolve, never deadlock.
  const a = createAthleteActions();
  let stuck = 0, lockedRun = 0, bad = 0;
  for (let i = 0; i < 6000; i++) {
    const st = a.update(DT, {
      grounded: i % 53 !== 0,
      speed: Math.abs(Math.sin(i / 31)) * 12,
      slideHeld: i % 300 < 170,
      divePressed: i % 977 === 0,
    });
    if (a.movementLocked) { lockedRun++; if (lockedRun > (T.knockdownTime + T.recoverTime + 1) * 60) stuck++; }
    else lockedRun = 0;
  }
  check('6000 chaotic frames only ever produce valid states', bad === 0, `${bad} invalid`);
  check('never deadlocks in a locked state', stuck === 0, `${stuck} overlong locks`);
}
{
  // The exact bug the rules exist to prevent: mash slide at a standstill.
  const a = createAthleteActions();
  let knocked = 0;
  for (let i = 0; i < 600; i++) {
    a.update(DT, S({ speed: 0, slideHeld: i % 2 === 0, slidePressed: i % 2 === 0 }));
    if (a.state === 'knocked') knocked++;
  }
  check('mashing slide while stationary never knocks you down', knocked === 0, `${knocked} frames knocked`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
