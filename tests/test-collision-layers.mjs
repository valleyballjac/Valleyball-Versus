/**
 * The interaction matrix, asserted rather than eyeballed.
 *
 * This file exists because the bug it guards was invisible: the locomotion
 * sphere has no mesh, so when it was batting the volleyball around, the ball
 * simply rebounded off nothing half a metre from the character. Nothing throws,
 * nothing logs, and the cause was two hex literals shifted against each other.
 */
import {
  LAYER, groups, membershipOf, filterOf, canCollide, groupsPuppet,
  GROUPS_WORLD, GROUPS_BALL, GROUPS_ATHLETE, RAY_FILTER, ALL_GROUPS,
} from './collision-layers.js';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

console.log('\n1. Bit arithmetic');
{
  const ids = Object.values(LAYER);
  check('every layer is a distinct single bit',
    new Set(ids).size === ids.length
    && ids.every((v) => v > 0 && (v & (v - 1)) === 0));
  check('and they fit in the 16 bits Rapier gives each half',
    ids.every((v) => v <= 0x8000));

  const g = groups(LAYER.PUPPET, LAYER.WORLD | LAYER.BALL);
  check('membership packs into the high half', membershipOf(g) === LAYER.PUPPET);
  check('filter packs into the low half', filterOf(g) === (LAYER.WORLD | LAYER.BALL));

  /* SIGN SAFETY. `1 << 15 << 16` overflows into the sign bit, and JavaScript
     hands Rapier a NEGATIVE number — a silently different mask, and only for the
     highest layers, so it would work fine right up until someone added the
     sixteenth one. */
  const high = groups(1 << 15, 0xFFFF);
  check('a bit-15 membership stays unsigned', high > 0, `${high}`);
  check('and still round-trips', membershipOf(high) === (1 << 15));
}

console.log('\n2. The matrix');
{
  // The whole point of the exercise: these three lines are the requirement.
  check('the locomotion sphere IGNORES the ball',
    !canCollide(GROUPS_ATHLETE, GROUPS_BALL));
  check('the puppet DOES hit the ball',
    canCollide(groupsPuppet(false), GROUPS_BALL));
  check('and both still hit the court',
    canCollide(GROUPS_ATHLETE, GROUPS_WORLD) && canCollide(groupsPuppet(false), GROUPS_WORLD));
  check('the ball hits the court too', canCollide(GROUPS_BALL, GROUPS_WORLD));

  // Co-located by construction: the puppet's pelvis sits on the sphere, so if
  // they collided the solver would spend every frame pushing apart two things
  // that are meant to be in the same place.
  check('the puppet ignores the sphere that carries it',
    !canCollide(groupsPuppet(false), GROUPS_ATHLETE));
  check('even with self-collision on',
    !canCollide(groupsPuppet(true), GROUPS_ATHLETE));

  check('non-adjacent self-collision is off by default',
    !canCollide(groupsPuppet(false), groupsPuppet(false)));
  check('and on when asked', canCollide(groupsPuppet(true), groupsPuppet(true)));
}
{
  // SYMMETRY. Rapier ANDs both directions, so the predicate must too — a mask
  // that only works because of its partner is a trap for whoever edits the
  // partner next.
  const all = Object.values(ALL_GROUPS);
  let asymmetric = 0;
  for (const a of all) for (const b of all) if (canCollide(a, b) !== canCollide(b, a)) asymmetric++;
  check('the predicate is symmetric, as Rapier is', asymmetric === 0);

  // And BOTH sides of the athlete/ball exclusion are written out, not just one.
  check('the sphere excludes the ball from its filter',
    (filterOf(GROUPS_ATHLETE) & LAYER.BALL) === 0);
  check('and the ball excludes the sphere from its own',
    (filterOf(GROUPS_BALL) & LAYER.ATHLETE) === 0);
}
{
  // Negative control: the matrix has to be capable of failing.
  const oldAthlete = groups(LAYER.ATHLETE, LAYER.WORLD | LAYER.BALL);
  check('the OLD mask really did let the sphere hit the ball',
    canCollide(oldAthlete, groups(LAYER.BALL, 0xFFFF)),
    'if this is false the test proves nothing');
}

console.log('\n3. Ground probes');
{
  check('the ray sees terrain', (filterOf(RAY_FILTER) & LAYER.WORLD) !== 0);
  // If the ball were in this filter you could stand on it, and a ball rolling
  // under the athlete would read as floor.
  check('and nothing else at all', filterOf(RAY_FILTER) === LAYER.WORLD);
  check('its membership is permissive, since a ray belongs to no layer',
    membershipOf(RAY_FILTER) === 0xFFFF);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
