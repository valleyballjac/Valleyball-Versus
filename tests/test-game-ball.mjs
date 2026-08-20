/**
 * Offline verification of game-ball.js.
 * Focus: the hit maths — direction and elevation signs, the height-scaled spike
 * angle, reach and arc gating, and the impulse model's cancel/inherit terms.
 */
import {
  createGameBall, hitDirection, spikeAngleAt, evaluateReach, reachOptions,
  reachFailure, computeHitImpulse, contactPoint,
  DEFAULT_BALL_TUNING, DEFAULT_HIT_TUNING,
} from './game-ball.js';

let pass = 0, fail = 0;
const approx = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const B = DEFAULT_BALL_TUNING;
const H = DEFAULT_HIT_TUNING;
const DEG = Math.PI / 180;
const V0 = { x: 0, y: 0, z: 0 };

// ---------------------------------------------------------------------------
console.log('\n1. The ball is an oversized weighty rubber playground ball');
{
  const diameter = B.radius * 2;
  check('roughly 0.48 m across — well past a hand span, un-grabbable',
    diameter > 0.42 && diameter < 0.56, `${diameter.toFixed(3)} m`);
  check('weightier than a volleyball (0.27 kg)', B.mass > 0.5, `${B.mass} kg`);
  check('but still far lighter than the athlete', B.mass < 5, `${B.mass} kg`);
  check('rubber-lively restitution', B.restitution > 0.6 && B.restitution < 0.95, `${B.restitution}`);
  check('grippy enough to roll rather than skid on slopes', B.friction > 0.4, `${B.friction}`);
  check('some air drag, but less than a volleyball would need',
    B.linearDamping > 0 && B.linearDamping < 0.6, `${B.linearDamping}`);
}
{
  // Density sanity: a real playground ball of this size is ~0.3 kg, so
  // "weightier" should be a few times that but nowhere near a medicine ball.
  const volume = (4 / 3) * Math.PI * B.radius ** 3;
  const density = B.mass / volume;
  check('density is ball-like, not lead', density > 20 && density < 100,
    `${density.toFixed(1)} kg/m³`);
}

// ---------------------------------------------------------------------------
console.log('\n2. Hit direction and elevation signs');
{
  const d = hitDirection(0, 0);
  check('facing 0 with no elevation points at +Z',
    approx(d.x, 0) && approx(d.y, 0) && approx(d.z, 1), `(${d.x}, ${d.y}, ${d.z})`);
}
{
  const d = hitDirection(Math.PI / 2, 0);
  check('facing 90° points at +X', approx(d.x, 1, 1e-12) && approx(d.z, 0, 1e-12));
}
{
  const up = hitDirection(0, 55);
  check('positive elevation sends the ball UP', up.y > 0, `y=${up.y.toFixed(3)}`);
  const down = hitDirection(0, -40);
  check('negative elevation sends the ball DOWN', down.y < 0, `y=${down.y.toFixed(3)}`);
  check('both still travel forward', up.z > 0 && down.z > 0);
}
{
  let bad = 0;
  for (let f = -Math.PI; f <= Math.PI; f += 0.3) {
    for (let e = -80; e <= 80; e += 10) {
      const d = hitDirection(f, e);
      if (Math.abs(Math.hypot(d.x, d.y, d.z) - 1) > 1e-12) bad++;
    }
  }
  check('direction is always unit length', bad === 0, `${bad} failures`);
}
{
  const d = hitDirection(1.1, 30);
  const facing = { x: Math.sin(1.1), z: Math.cos(1.1) };
  const horiz = Math.hypot(d.x, d.z);
  check('the horizontal component follows the facing angle exactly',
    approx(d.x / horiz, facing.x, 1e-12) && approx(d.z / horiz, facing.z, 1e-12));
}

// ---------------------------------------------------------------------------
console.log('\n3. Spike angle scales with height off the ground');
{
  check('at ground level the spike is nearly flat',
    approx(spikeAngleAt(0), H.spikeAngleGroundDeg), `${spikeAngleAt(0)}°`);
  check('flat enough not to bury the ball at your feet',
    Math.abs(spikeAngleAt(0)) < 15, `${spikeAngleAt(0)}°`);
}
{
  check('at the apex it reaches the full downward angle',
    approx(spikeAngleAt(H.spikeApexHeight), H.spikeAngleApexDeg), `${spikeAngleAt(H.spikeApexHeight)}°`);
  check('the full spike is genuinely steep', H.spikeAngleApexDeg < -25, `${H.spikeAngleApexDeg}°`);
}
{
  let monotonic = true, prev = Infinity;
  for (let h = 0; h <= 3; h += 0.1) {
    const a = spikeAngleAt(h);
    if (a > prev + 1e-9) monotonic = false;
    prev = a;
  }
  check('angle steepens monotonically with height', monotonic);
  check('beyond the apex it is clamped, not extrapolated',
    approx(spikeAngleAt(50), H.spikeAngleApexDeg), `${spikeAngleAt(50)}°`);
  check('negative height is clamped too', approx(spikeAngleAt(-5), H.spikeAngleGroundDeg));
}
{
  // The concrete failure the scaling exists to prevent: a steep spike from
  // standing height drives the ball into the floor a stride away.
  const steep = hitDirection(0, H.spikeAngleApexDeg);
  const contactH = H.contactHeight;
  const groundRange = steep.y < 0 ? contactH / -steep.y * Math.hypot(steep.x, steep.z) : Infinity;
  check('a full-angle spike from standing height would hit the floor within ~2 m',
    groundRange < 2, `${groundRange.toFixed(2)} m — this is why the angle scales`);

  const flat = hitDirection(0, spikeAngleAt(0));
  const flatRange = flat.y < 0 ? contactH / -flat.y * Math.hypot(flat.x, flat.z) : Infinity;
  check('the scaled ground-level spike travels much further', flatRange > 5,
    `${flatRange.toFixed(2)} m`);
}

// ---------------------------------------------------------------------------
console.log('\n4. Reach and arc gating');
{
  const contact = { x: 0, y: 1, z: 0 };
  const opts = reachOptions('volley');
  const near = evaluateReach(contact, { x: 0, y: 1, z: 1.0 }, 0, opts);
  check('a ball in front and close is in reach', near.inReach, JSON.stringify(near));
  const far = evaluateReach(contact, { x: 0, y: 1, z: 8 }, 0, opts);
  check('a ball across the court is not', !far.inReach, `distance=${far.distance}`);
}
{
  // Height is now folded into the same distance, so the vertical cases are
  // measured against the sphere's limit rather than a separate window.
  // (These once read the deleted height params, which made every coordinate
  // NaN — and NaN <= limit is false, so the tests "passed" while testing
  // nothing at all. Everything below is derived from `limit`.)
  const contact = { x: 0, y: 1, z: 0 };
  const opts = reachOptions('volley');
  const limit = opts.reach + opts.ballRadius;

  const high = evaluateReach(contact, { x: 0, y: 1 + limit + 0.5, z: 0 }, 0, opts);
  check('a ball far above the contact point is out of reach', !high.inReach, `dy=${high.dy}`);
  check('and the reason names the height', reachFailure(high, opts) === 'too high',
    reachFailure(high, opts));
  const low = evaluateReach(contact, { x: 0, y: 1 - limit - 0.5, z: 0 }, 0, opts);
  check('a ball far below it is too', !low.inReach, `dy=${low.dy}`);
  check('and that reason too', reachFailure(low, opts) === 'too low', reachFailure(low, opts));

  // The corner case a cylinder got wrong: close on the ground plane but high
  // enough that the true 3-D distance is outside the sphere.
  const dy = limit * 0.85, dz = limit * 0.85;   // each inside, together outside
  const diagonal = evaluateReach(contact, { x: 0, y: 1 + dy, z: dz }, 0, opts);
  check('near-but-high is refused, which a cylinder would have allowed',
    !diagonal.inReach && diagonal.planar < limit && Math.abs(diagonal.dy) < limit,
    `planar=${diagonal.planar.toFixed(2)} dy=${diagonal.dy.toFixed(2)} dist=${diagonal.distance.toFixed(2)} limit=${limit.toFixed(2)}`);

  // And a coordinate sweep with no NaN anywhere, so a silently-undefined param
  // can never make these pass by accident again.
  const sweep = [];
  for (let y = -3; y <= 3; y += 0.25) {
    for (let z = -3; z <= 3; z += 0.25) sweep.push(evaluateReach(contact, { x: 0, y: 1 + y, z }, 0, opts));
  }
  check('every reach evaluation is a real number', sweep.every((r) => Number.isFinite(r.distance)));
  check('and inReach agrees with the plain sphere test everywhere',
    sweep.every((r) => r.inReach === (r.distance <= r.limit)),
    `${sweep.filter((r) => r.inReach !== (r.distance <= r.limit)).length} disagreements`);
}
{
  // The volley is a defensive dig: reachable from any bearing.
  const contact = { x: 0, y: 1, z: 0 };
  const opts = reachOptions('volley');
  const behind = evaluateReach(contact, { x: 0, y: 1, z: -1.2 }, 0, opts);
  check('the volley reaches behind you (defensive dig)', behind.inReach,
    `angle=${behind.angleDeg.toFixed(1)}°`);
}
{
  // The spike is an attack: it must be roughly in front.
  const contact = { x: 0, y: 1, z: 0 };
  const opts = reachOptions('spike');
  const front = evaluateReach(contact, { x: 0, y: 1, z: 1.2 }, 0, opts);
  check('the spike reaches a ball in front', front.inReach, `angle=${front.angleDeg.toFixed(1)}°`);
  const behind = evaluateReach(contact, { x: 0, y: 1, z: -1.2 }, 0, opts);
  check('the spike does NOT reach a ball behind you', !behind.inReach,
    `angle=${behind.angleDeg.toFixed(1)}°`);
}
{
  const contact = { x: 0, y: 1, z: 0 };
  const opts = reachOptions('spike');
  // Facing +X now; a ball at +X should be in front.
  const r = evaluateReach(contact, { x: 1.2, y: 1, z: 0 }, Math.PI / 2, opts);
  check('the arc test rotates with facing', r.inReach, `angle=${r.angleDeg.toFixed(1)}°`);
}
{
  const contact = { x: 0, y: 1, z: 0 };
  const opts = reachOptions('spike');
  const onTop = evaluateReach(contact, { x: 0, y: 1, z: 0 }, 0, opts);
  check('a ball directly on top of you never fails on a degenerate bearing',
    onTop.inReach, JSON.stringify(onTop));
}

// ---------------------------------------------------------------------------
console.log('\n4b. Reach against where the ball ACTUALLY is');
// The earlier reach tests placed the ball inside the window by construction,
// which is exactly how a hit that never works in practice passes its tests.
// These use the real geometry: a ball lying on the floor, an athlete standing
// on it, contact measured at chest height.
{
  const PLAYER_R = 0.45;
  const athlete = { x: 0, y: PLAYER_R, z: 0 };          // standing on flat ground
  const contact = contactPoint(athlete, PLAYER_R, H);
  const resting = { x: 0, y: B.radius, z: 1.0 };        // ball settled on the deck

  const vOpt = reachOptions('volley', H, B.radius);
  const v = evaluateReach(contact, resting, 0, vOpt);
  check('a ball RESTING ON THE FLOOR can be dug with the volley', v.inReach,
    `dist=${v.distance.toFixed(3)} limit=${v.limit.toFixed(3)} → ${reachFailure(v, vOpt)}`);

  // Under the spherical test the spike CAN touch a floor ball — a sphere has no
  // notion of above vs below. What stops it being a free attack is the angle
  // ramp: from standing height a spike comes off nearly flat, so it is a drive
  // down the court and not a kill. Height is what earns the steep shot.
  const sOpt = reachOptions('spike', H, B.radius);
  const sp = evaluateReach(contact, resting, 0, sOpt);
  check('the spike can also touch a floor ball (a sphere has no "above")',
    sp.inReach, `dist=${sp.distance.toFixed(3)} limit=${sp.limit.toFixed(3)}`);
  check('but from the deck it comes off almost flat, not down',
    Math.abs(spikeAngleAt(0, H)) < 12, `${spikeAngleAt(0, H).toFixed(1)}°`);
  check('while from the apex it is a true downward attack',
    spikeAngleAt(H.spikeApexHeight, H) < -30, `${spikeAngleAt(H.spikeApexHeight, H).toFixed(1)}°`);
  check('so height is what buys the steep shot',
    spikeAngleAt(H.spikeApexHeight, H) < spikeAngleAt(0, H) - 20);
}
{
  // The volley sphere must clear the floor with margin, so a ball sitting in a
  // dip or on a downslope is still diggable.
  const PLAYER_R = 0.45;
  const contact = contactPoint({ x: 0, y: PLAYER_R, z: 0 }, PLAYER_R, H);
  const vOpt = reachOptions('volley', H, B.radius);
  const limit = vOpt.reach + vOpt.ballRadius;
  const lowestHittable = contact.y - limit;         // directly underfoot
  check('the volley reaches at or below ground level',
    lowestHittable <= 0, `lowest hittable ball centre y=${lowestHittable.toFixed(3)}`);
  check('with margin below a resting ball',
    B.radius - lowestHittable > 0.15, `${(B.radius - lowestHittable).toFixed(3)} m of margin`);

  // The number that actually decides a dig is the SLANT distance, not the drop.
  // A ball 1.0 m away on the deck is 1.29 m from the contact point, not 1.0.
  const resting = { x: 0, y: B.radius, z: 1.0 };
  const r = evaluateReach(contact, resting, 0, vOpt);
  check('and a floor ball 1 m away is measured on the slant',
    Math.abs(r.distance - Math.hypot(1.0, contact.y - B.radius)) < 1e-9,
    `${r.distance.toFixed(3)} m vs planar ${r.planar.toFixed(3)} m`);
  check('which is what makes the sphere stricter than the old cylinder',
    r.distance > r.planar, `${r.distance.toFixed(3)} > ${r.planar.toFixed(3)}`);
}
{
  const PLAYER_R = 0.45;
  const contact = contactPoint({ x: 0, y: PLAYER_R, z: 0 }, PLAYER_R, H);
  // Every height a rally actually produces should be hittable by SOMETHING.
  const heights = [B.radius, 0.4, 0.7, 1.0, 1.5, 2.0, 2.4];
  const unreachable = heights.filter((y) => {
    const ball = { x: 0, y, z: 1.0 };
    return !evaluateReach(contact, ball, 0, reachOptions('volley', H)).inReach
        && !evaluateReach(contact, ball, 0, reachOptions('spike', H)).inReach;
  });
  check('every realistic ball height is hittable by volley or spike',
    unreachable.length === 0, `unreachable at y = ${unreachable.join(', ')}`);
}
{
  const PLAYER_R = 0.45;
  const contact = contactPoint({ x: 0, y: PLAYER_R, z: 0 }, PLAYER_R, H);
  const vOpt = reachOptions('volley', H);
  check('a ball too far away reports "too far"',
    reachFailure(evaluateReach(contact, { x: 0, y: 1, z: 9 }, 0, vOpt), vOpt) === 'too far');
  check('a ball far overhead reports "too high"',
    reachFailure(evaluateReach(contact, { x: 0, y: 12, z: 0.5 }, 0, vOpt), vOpt) === 'too high');
  const sOpt = reachOptions('spike', H);
  check('a ball behind you reports "behind you" for the spike',
    reachFailure(evaluateReach(contact, { x: 0, y: 1.1, z: -1.2 }, 0, sOpt), sOpt) === 'behind you');
  check('an in-reach ball has no failure reason',
    reachFailure(evaluateReach(contact, { x: 0, y: 1.1, z: 1.0 }, 0, vOpt), vOpt) === null);
}

// ---------------------------------------------------------------------------
console.log('\n4c. Bounce survives Rapier averaging restitution with the floor');
{
  // Rapier AVERAGES restitution by default. The court is 0 so the athlete does
  // not bounce off it, which would silently halve the ball's bounce unless the
  // ball claims the Max combine rule.
  const averaged = (B.restitution + 0) / 2;
  check('averaging with a 0-restitution floor would gut the bounce',
    averaged * averaged < 0.25,
    `retains only ${(averaged * averaged * 100).toFixed(0)}% of height per bounce`);
  check('the ball keeps most of its height when its own restitution wins',
    B.restitution * B.restitution > 0.6,
    `retains ${(B.restitution * B.restitution * 100).toFixed(0)}%`);

  // A rally must survive without re-serving: a dug ball has to come back up
  // enough times to be hit again.
  let h = 3, bounces = 0;
  while (h > 0.4 && bounces < 30) { h *= B.restitution * B.restitution; bounces++; }
  check('a 3 m drop stays playable for several bounces', bounces >= 5,
    `${bounces} bounces above 0.4 m`);
}
{
  // And the collider must actually ASK for the Max rule.
  let rule = null, ruleEnum = null;
  const RAPIER = {
    CoefficientCombineRule: { Average: 0, Min: 1, Multiply: 2, Max: 3 },
    RigidBodyDesc: { dynamic: () => {
      const d = {}; ['setTranslation', 'setLinearDamping', 'setAngularDamping', 'setCanSleep']
        .forEach((k) => { d[k] = () => d; }); return d;
    } },
    ColliderDesc: { ball: () => {
      const c = {};
      ['setMass', 'setRestitution', 'setFriction', 'setCollisionGroups'].forEach((k) => { c[k] = () => c; });
      c.setRestitutionCombineRule = (r) => { rule = r; return c; };
      return c;
    } },
  };
  ruleEnum = RAPIER.CoefficientCombineRule;
  createGameBall(RAPIER, { createRigidBody: () => ({}), createCollider: (c) => c },
    {}, { x: 0, y: 0, z: 0 });
  check('the ball claims the Max restitution combine rule', rule === ruleEnum.Max,
    `got ${rule}`);
}
{
  // It must not explode on a Rapier build that lacks the enum.
  const RAPIER = {
    RigidBodyDesc: { dynamic: () => {
      const d = {}; ['setTranslation', 'setLinearDamping', 'setAngularDamping', 'setCanSleep']
        .forEach((k) => { d[k] = () => d; }); return d;
    } },
    ColliderDesc: { ball: () => {
      const c = {};
      ['setMass', 'setRestitution', 'setFriction', 'setCollisionGroups'].forEach((k) => { c[k] = () => c; });
      return c;   // no setRestitutionCombineRule at all
    } },
  };
  let threw = false;
  try {
    createGameBall(RAPIER, { createRigidBody: () => ({}), createCollider: (c) => c },
      {}, { x: 0, y: 0, z: 0 });
  } catch (e) { threw = true; }
  check('a Rapier build without the combine-rule API degrades quietly', !threw);
}

// ---------------------------------------------------------------------------
console.log('\n4d. The ball must never park itself');
{
  let canSleep = null;
  const RAPIER = {
    RigidBodyDesc: { dynamic: () => {
      const d = {};
      ['setTranslation', 'setLinearDamping', 'setAngularDamping'].forEach((k) => { d[k] = () => d; });
      d.setCanSleep = (v) => { canSleep = v; return d; };
      return d;
    } },
    ColliderDesc: { ball: () => {
      const c = {};
      ['setMass', 'setRestitution', 'setFriction', 'setCollisionGroups', 'setRestitutionCombineRule']
        .forEach((k) => { c[k] = () => c; });
      return c;
    } },
  };
  createGameBall(RAPIER, { createRigidBody: () => ({}), createCollider: (c) => c },
    {}, { x: 0, y: 0, z: 0 });
  check('sleeping is disabled on the ball body', canSleep === false, `canSleep=${canSleep}`);
}
{
  // A ball that stops bouncing must still ROLL. Angular damping is what kills
  // that, and a ball frozen mid-court reads as "glued to the floor".
  check('angular damping is low enough to keep it rolling', B.angularDamping < 0.15,
    `${B.angularDamping}`);
  check('linear damping does not stall it either', B.linearDamping < 0.4, `${B.linearDamping}`);

  // Crude roll-out: on a 12° grade, gravity along the slope must beat drag.
  const slopeAccel = 9.81 * Math.sin(12 * Math.PI / 180);
  check('a 12° grade accelerates the ball faster than drag removes speed',
    slopeAccel > B.linearDamping * 5, `${slopeAccel.toFixed(2)} m/s² vs drag at 5 m/s`);
}

// ---------------------------------------------------------------------------
console.log('\n4e. Reach is large enough to actually land in play');
{
  const PLAYER_R = 0.45;
  const contact = contactPoint({ x: 0, y: PLAYER_R, z: 0 }, PLAYER_R, H);
  // The athlete's own body is 0.45 m of radius before you even reach — a reach
  // barely larger than that is unusable while moving.
  // The test compares against reach + ball radius, so that is the number that
  // has to clear the body — quoting the bare reach understates it.
  const vOpt = reachOptions('volley', H, B.radius);
  const sOpt = reachOptions('spike', H, B.radius);
  const vLimit = vOpt.reach + vOpt.ballRadius;
  const sLimit = sOpt.reach + sOpt.ballRadius;
  // Stated as clearance OUTSIDE the body rather than as a multiple of it: what
  // matters is how far past your own collider you can touch a ball, and a full
  // body-width of clearance is the least that is usable while moving.
  check('the volley clears the athlete\'s own collider by a body width',
    vLimit - PLAYER_R > PLAYER_R * 2, `${(vLimit - PLAYER_R).toFixed(2)} m of clearance`);
  check('the spike does too', sLimit - PLAYER_R > PLAYER_R * 2,
    `${(sLimit - PLAYER_R).toFixed(2)} m of clearance`);
  check('a bigger ball is proportionally easier to touch',
    reachOptions('volley', H, 0.5).ballRadius > reachOptions('volley', H, 0.1).ballRadius);

  // Edge cases measured on the SLANT, since that is the live predicate.
  const drop = contact.y - B.radius;
  const justIn = Math.sqrt(Math.max(0, (vLimit - 0.1) ** 2 - drop ** 2));
  const atEdge = evaluateReach(contact, { x: 0, y: B.radius, z: justIn }, 0, vOpt);
  check('a floor ball just inside the radius is diggable', atEdge.inReach,
    `${atEdge.distance.toFixed(3)} vs ${atEdge.limit.toFixed(3)}`);
  const past = evaluateReach(contact, { x: 0, y: B.radius, z: justIn + 0.4 }, 0, vOpt);
  check('and just outside it is not', !past.inReach, reachFailure(past, vOpt));
}
{
  // The volley is the wider net in BOTH dimensions — it is the defensive shot,
  // reachable in any direction, and the spike is the committed one. If that
  // ever inverts, the spike becomes a strictly better volley and the volley
  // stops having a reason to exist.
  const vOpt = reachOptions('volley', H, B.radius);
  const sOpt = reachOptions('spike', H, B.radius);
  check('the volley sphere is the larger of the two',
    vOpt.reach > sOpt.reach, `${vOpt.reach} vs ${sOpt.reach}`);
  check('and the only one reachable in every direction',
    vOpt.arcDeg >= 360 && sOpt.arcDeg < 360, `${vOpt.arcDeg}° vs ${sOpt.arcDeg}°`);
  check('so the spike volume is strictly inside the volley volume',
    sOpt.reach + sOpt.ballRadius <= vOpt.reach + vOpt.ballRadius);
}

// ---------------------------------------------------------------------------
console.log('\n5. Impulse model');
{
  const r = computeHitImpulse({
    kind: 'volley', facingAngle: 0, heightAboveGround: 0,
    ballVelocity: V0, playerVelocity: V0, ballMass: B.mass,
  });
  check('a volley from rest sends the ball up and forward',
    r.impulse.y > 0 && r.impulse.z > 0, JSON.stringify(r.impulse));
  const speed = Math.hypot(r.deltaV.x, r.deltaV.y, r.deltaV.z);
  check('and at the configured launch speed', approx(speed, H.volleySpeed, 1e-9),
    `${speed.toFixed(3)} m/s`);
}
{
  // Impulse must scale with ball mass, so tuning survives a weight change.
  const light = computeHitImpulse({ kind: 'volley', facingAngle: 0, ballMass: 0.5, ballVelocity: V0, playerVelocity: V0 });
  const heavy = computeHitImpulse({ kind: 'volley', facingAngle: 0, ballMass: 2.0, ballVelocity: V0, playerVelocity: V0 });
  check('impulse scales linearly with ball mass',
    approx(heavy.impulse.z / light.impulse.z, 4, 1e-9),
    `${(heavy.impulse.z / light.impulse.z).toFixed(4)}×`);
  check('but the resulting speed is identical',
    approx(Math.hypot(light.deltaV.x, light.deltaV.y, light.deltaV.z),
           Math.hypot(heavy.deltaV.x, heavy.deltaV.y, heavy.deltaV.z), 1e-9));
}
{
  // A running hit must beat a standing one.
  const still = computeHitImpulse({ kind: 'spike', facingAngle: 0, heightAboveGround: 1.8,
    ballVelocity: V0, playerVelocity: V0, ballMass: B.mass });
  const running = computeHitImpulse({ kind: 'spike', facingAngle: 0, heightAboveGround: 1.8,
    ballVelocity: V0, playerVelocity: { x: 0, y: 0, z: 9 }, ballMass: B.mass });
  check('a running spike carries more forward punch', running.deltaV.z > still.deltaV.z + 1,
    `${still.deltaV.z.toFixed(2)} → ${running.deltaV.z.toFixed(2)} m/s`);
  check('exactly the configured inherit fraction',
    approx(running.deltaV.z - still.deltaV.z, 9 * H.spikeInherit, 1e-9));
}
{
  // A jumping player must not add lift to the ball — only horizontal momentum
  // is inherited, or every jump shot would balloon.
  const a = computeHitImpulse({ kind: 'spike', facingAngle: 0, heightAboveGround: 1.8,
    ballVelocity: V0, playerVelocity: V0, ballMass: B.mass });
  const b = computeHitImpulse({ kind: 'spike', facingAngle: 0, heightAboveGround: 1.8,
    ballVelocity: V0, playerVelocity: { x: 0, y: 7, z: 0 }, ballMass: B.mass });
  check('vertical player velocity is NOT inherited', approx(a.deltaV.y, b.deltaV.y, 1e-12),
    `${a.deltaV.y.toFixed(4)} vs ${b.deltaV.y.toFixed(4)}`);
}
{
  // The core reason `cancel` exists: without it, the same button on an incoming
  // ball versus a drifting one produces two completely different shots.
  const incoming = { x: 0, y: 0, z: -14 };            // rocketing toward the player
  const drifting = { x: 0, y: 0, z: -0.5 };
  const hitFast = computeHitImpulse({ kind: 'spike', facingAngle: 0, heightAboveGround: 1.8,
    ballVelocity: incoming, playerVelocity: V0, ballMass: B.mass });
  const hitSlow = computeHitImpulse({ kind: 'spike', facingAngle: 0, heightAboveGround: 1.8,
    ballVelocity: drifting, playerVelocity: V0, ballMass: B.mass });

  // Resulting ball velocity = old velocity + Δv.
  const outFast = incoming.z + hitFast.deltaV.z;
  const outSlow = drifting.z + hitSlow.deltaV.z;
  check('a hit on a fast incoming ball still goes forward', outFast > 0,
    `${outFast.toFixed(2)} m/s`);
  check('and lands reasonably close to the drifting-ball result',
    Math.abs(outFast - outSlow) < Math.abs(incoming.z - drifting.z),
    `fast=${outFast.toFixed(2)} slow=${outSlow.toFixed(2)} (incoming spread was ${Math.abs(incoming.z - drifting.z).toFixed(1)})`);
}
{
  // cancel = 1 fully replaces the incoming velocity: identical outcome
  // regardless of what the ball was doing.
  const t = { spikeCancel: 1 };
  const a = computeHitImpulse({ kind: 'spike', facingAngle: 0, heightAboveGround: 1.8,
    ballVelocity: { x: 3, y: -9, z: -12 }, playerVelocity: V0, ballMass: B.mass, tuning: t });
  const b = computeHitImpulse({ kind: 'spike', facingAngle: 0, heightAboveGround: 1.8,
    ballVelocity: { x: -2, y: 4, z: 6 }, playerVelocity: V0, ballMass: B.mass, tuning: t });
  const outA = { x: 3 + a.deltaV.x, y: -9 + a.deltaV.y, z: -12 + a.deltaV.z };
  const outB = { x: -2 + b.deltaV.x, y: 4 + b.deltaV.y, z: 6 + b.deltaV.z };
  check('cancel = 1 makes the outcome independent of the incoming ball',
    approx(outA.x, outB.x, 1e-9) && approx(outA.y, outB.y, 1e-9) && approx(outA.z, outB.z, 1e-9),
    `${JSON.stringify(outA)} vs ${JSON.stringify(outB)}`);
}
{
  const t = { spikeCancel: 0, spikeInherit: 0 };
  const bv = { x: 1, y: 2, z: 3 };
  const r = computeHitImpulse({ kind: 'spike', facingAngle: 0, heightAboveGround: 0,
    ballVelocity: bv, playerVelocity: V0, ballMass: B.mass, tuning: t });
  const speed = Math.hypot(r.deltaV.x, r.deltaV.y, r.deltaV.z);
  check('cancel = 0 is purely additive, as originally specced',
    approx(speed, H.spikeSpeed, 1e-9), `${speed.toFixed(4)} m/s of pure addition`);
}
{
  const spike = computeHitImpulse({ kind: 'spike', facingAngle: 0, heightAboveGround: H.spikeApexHeight,
    ballVelocity: V0, playerVelocity: V0, ballMass: B.mass });
  const volley = computeHitImpulse({ kind: 'volley', facingAngle: 0,
    ballVelocity: V0, playerVelocity: V0, ballMass: B.mass });
  check('a spike from the apex drives the ball downward', spike.deltaV.y < 0, `${spike.deltaV.y.toFixed(2)}`);
  check('a volley lofts it', volley.deltaV.y > 0, `${volley.deltaV.y.toFixed(2)}`);
  check('the spike is the harder shot',
    Math.hypot(spike.deltaV.x, spike.deltaV.y, spike.deltaV.z) >
    Math.hypot(volley.deltaV.x, volley.deltaV.y, volley.deltaV.z));
}
{
  let bad = 0;
  for (let i = 0; i < 500; i++) {
    const r = computeHitImpulse({
      kind: i % 2 ? 'spike' : 'volley',
      facingAngle: Math.sin(i) * 4,
      heightAboveGround: Math.abs(Math.sin(i / 7)) * 3,
      ballVelocity: { x: Math.sin(i) * 20, y: Math.cos(i) * 20, z: Math.sin(i / 3) * 20 },
      playerVelocity: { x: Math.cos(i) * 11, y: Math.sin(i) * 7, z: Math.cos(i / 5) * 11 },
      ballMass: B.mass,
    });
    for (const k of ['x', 'y', 'z']) if (!isFinite(r.impulse[k])) bad++;
  }
  check('impulses stay finite across the whole input range', bad === 0, `${bad} non-finite`);
}

// ---------------------------------------------------------------------------
console.log('\n6. Contact point');
{
  // The athlete's transform is the ball centre, so contact must be measured
  // from the ground up — not from the sphere centre.
  const c = contactPoint({ x: 2, y: 0.45, z: -3 }, 0.45);
  check('contact sits at chest height above the ground',
    approx(c.y, H.contactHeight), `${c.y}`);
  check('and tracks the athlete horizontally', c.x === 2 && c.z === -3);
}
{
  const grounded = contactPoint({ x: 0, y: 0.45, z: 0 }, 0.45);
  const jumping = contactPoint({ x: 0, y: 2.45, z: 0 }, 0.45);
  check('jumping raises the contact point', approx(jumping.y - grounded.y, 2, 1e-12),
    `${(jumping.y - grounded.y).toFixed(12)}`);
}

// ---------------------------------------------------------------------------
console.log('\n7. Ball construction against a mock Rapier');
{
  const made = {};
  const RAPIER = {
    RigidBodyDesc: { dynamic: () => {
      const d = { _t: null };
      d.setTranslation = (x, y, z) => { d._t = { x, y, z }; return d; };
      d.setLinearDamping = (v) => { made.linDamp = v; return d; };
      d.setAngularDamping = (v) => { made.angDamp = v; return d; };
      d.setCanSleep = () => d;
      return d;
    } },
    ColliderDesc: { ball: (r) => {
      const c = { r };
      c.setMass = (m) => { made.mass = m; return c; };
      c.setRestitution = (v) => { made.rest = v; return c; };
      c.setFriction = (v) => { made.fric = v; return c; };
      c.setCollisionGroups = (g) => { made.groups = g; return c; };
      return c;
    } },
  };
  const world = {
    createRigidBody: (d) => ({ desc: d, translation: () => d._t }),
    createCollider: (c) => c,
  };
  const ball = createGameBall(RAPIER, world, {}, { x: 1, y: 5, z: 2 }, 0x00020007);
  check('body spawns where asked', JSON.stringify(ball.body.translation()) === JSON.stringify({ x: 1, y: 5, z: 2 }));
  check('mass, restitution and friction are applied',
    made.mass === B.mass && made.rest === B.restitution && made.fric === B.friction);
  check('damping is applied to the body', made.linDamp === B.linearDamping && made.angDamp === B.angularDamping);
  check('collision groups pass through', made.groups === 0x00020007);
  check('tuning is returned for the caller to read', ball.tuning.radius === B.radius);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
