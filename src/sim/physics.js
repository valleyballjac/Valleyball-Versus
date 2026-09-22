import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from '../config/tuning.js';

/**
 * The Rapier world.
 *
 * DIRECTORY RULE (src/sim/): nothing under this directory may name any
 * wall-clock or scheduler API — not in live code, and not in a comment either,
 * so the rule is checkable with a single grep. The simulation cannot perceive
 * real time. If it needs a clock, the clock is `tick`.
 *
 * LAW L3: all resistance is applied as clamped impulses — see
 * applyClampedDamping in motor.js and the two helpers in damping.js, which are
 * the implementations. Rapier's own damping setters are not used for any of it.
 *
 * ONE LISTED EXCEPTION, and one correction. The exception is `applyArmDamping`
 * in tracker.js — ONE FUNCTION, TWO SITES, FOUR SETTER CALLS, AND IT MAY NOT
 * GROW BY A LINE. The clamped helpers run before world.step and damp the
 * pre-step velocity relative to the target, so they cannot touch chatter the
 * solver injects during the step — measured, raising their gains fourfold moved
 * it under 3%. The two sites are the arm chain and the dive's leg parachute;
 * the second arrived with the dive work and this wording was corrected in G3.5
 * to say so, because it had said "two lines" while the census greps to four.
 *
 * The ban therefore greps to four lines in one function, all commented, all in
 * tracker.js. A hit anywhere else in src/ is a violation.
 *
 * The correction: this file used to claim explicit damping CRASHES the WASM
 * build. Tested directly against @dimforge/rapier3d-compat 0.19.3 — it does
 * not. setLinearDamping and setAngularDamping apply cleanly, and a ball dropped
 * with damping 2.0 reaches -5.9 m/s where free fall reaches -24.0. The reason
 * to keep resistance in one clamped implementation stands on its own; it never
 * needed the crash claim, and the claim was wrong.
 */

/**
 * THE COLLISION GROUP LAYOUT — THE SINGLE SOURCE.
 *
 * This block used to be documentation while the constants lived in autorig.js,
 * which meant the description and the truth were two files apart and only one
 * of them was checked by the compiler. They are the same thing now: autorig.js
 * imports the words from here, main.js stamps the arena with one from here, and
 * ball.js takes its own from here. Nothing defines a group bit anywhere else.
 *
 *   0x0001  environment — the arena's trimesh. Stamped on in main.js, because
 *           arena.js is frozen; Rapier's default membership is every bit set,
 *           which is fine for contacts but useless as a ray filter.
 *   0x0002  ragdoll     — the sixteen character bodies (autorig.js).
 *   0x0004  motor       — the sphere (detachMotorFromRagdoll).
 *   0x0008  ball        — the one ball (ball.js).
 *   0x0010  ragdoll upper — the head and both arm chains (autorig.js). Split
 *           out of ragdoll so seven capsules stop dragging on the arena floor
 *           through a slide; they still meet the ball, which is what they are
 *           for.
 *
 * Rapier packs an interaction word as (membership << 16) | filter, and two
 * colliders interact only if EACH one's membership passes the OTHER's filter.
 * Both directions must agree, which is why every exclusion below is stated from
 * both sides rather than trusted to one.
 *
 * ENVIRONMENT_RAY_GROUPS is the odd one out: its FILTER half is
 * environment-only, so a ray cast with it hits the arena and nothing else.
 * Every non-contact ray in the project uses it — the camera's obstruction ray,
 * mount recovery's floor probe, the motor's ground fan, and now the ball's
 * height probe.
 *
 * WHY NOT filterExcludeRigidBody. That argument takes ONE body. The character
 * is sixteen, so excluding it that way is impossible — and without the filter
 * a downward ray from the sphere hits the character's own calf, which is what
 * left motor.grounded stuck true from a standing rest.
 *
 * It lives here rather than in main.js because motor.js needs it too and
 * motor.js cannot import main.js — main.js imports motor.js.
 */
export const GROUP_ENVIRONMENT = 0x0001;
export const GROUP_RAGDOLL = 0x0002;
export const GROUP_MOTOR = 0x0004;
export const GROUP_BALL = 0x0008;
export const GROUP_RAGDOLL_UPPER = 0x0010;
export const GROUP_RAGDOLL_P2 = 0x0020;
export const GROUP_RAGDOLL_UPPER_P2 = 0x0040;
export const GROUP_RAGDOLL_P3 = 0x0080;
export const GROUP_RAGDOLL_UPPER_P3 = 0x0100;
export const GROUP_RAGDOLL_P4 = 0x0200;
export const GROUP_RAGDOLL_UPPER_P4 = 0x0400;

/** Every bit that exists. The filter half is 16 bits wide. */
const ALL_GROUPS = 0xffff;

/**
 * Kept as an alias because motor.js is frozen and imports this name. It is the
 * environment MEMBERSHIP bit, not an interaction word — see ENVIRONMENT_GROUPS.
 */
export const ENVIRONMENT_MEMBERSHIP = GROUP_ENVIRONMENT;

const ALL_UPPER =
  GROUP_RAGDOLL_UPPER |
  GROUP_RAGDOLL_UPPER_P2 |
  GROUP_RAGDOLL_UPPER_P3 |
  GROUP_RAGDOLL_UPPER_P4;

/** The arena: everything except upper ragdolls, which pass through it. */
export const ENVIRONMENT_GROUPS =
  (GROUP_ENVIRONMENT << 16) | (ALL_GROUPS & ~ALL_UPPER);

const RAGDOLL_LOWER_BITS = [
  GROUP_RAGDOLL,
  GROUP_RAGDOLL_P2,
  GROUP_RAGDOLL_P3,
  GROUP_RAGDOLL_P4,
];

const RAGDOLL_UPPER_BITS = [
  GROUP_RAGDOLL_UPPER,
  GROUP_RAGDOLL_UPPER_P2,
  GROUP_RAGDOLL_UPPER_P3,
  GROUP_RAGDOLL_UPPER_P4,
];

/**
 * Resolves the collision interaction word for an athlete's ragdoll bone.
 * Supports up to 4 athletes (indices 0..3).
 *
 * For lower body/torso:
 *   Collides with arena, ball, and other players' ragdolls.
 *   Excludes own lower body, own upper body, and own sphere motor.
 *
 * For upper body (head, arms, hands):
 *   Collides with ball and other players' ragdolls.
 *   Excludes arena floor, own lower body, own upper body, and own sphere motor.
 */
export function getRagdollGroups(athleteIndex = 0, isUpper = false) {
  const idx = Math.max(0, Math.min(3, athleteIndex));
  const myLower = RAGDOLL_LOWER_BITS[idx];
  const myUpper = RAGDOLL_UPPER_BITS[idx];

  if (isUpper) {
    return (
      (myUpper << 16) |
      (ALL_GROUPS & ~GROUP_ENVIRONMENT & ~myLower & ~myUpper & ~GROUP_MOTOR)
    );
  }
  return (
    (myLower << 16) |
    (ALL_GROUPS & ~myLower & ~myUpper & ~GROUP_MOTOR)
  );
}

export const RAGDOLL_GROUPS = getRagdollGroups(0, false);
export const RAGDOLL_UPPER_GROUPS = getRagdollGroups(0, true);
export const RAGDOLL_P2_GROUPS = getRagdollGroups(1, false);
export const RAGDOLL_UPPER_P2_GROUPS = getRagdollGroups(1, true);
export const RAGDOLL_P3_GROUPS = getRagdollGroups(2, false);
export const RAGDOLL_UPPER_P3_GROUPS = getRagdollGroups(2, true);
export const RAGDOLL_P4_GROUPS = getRagdollGroups(3, false);
export const RAGDOLL_UPPER_P4_GROUPS = getRagdollGroups(3, true);

const ALL_RAGDOLLS =
  GROUP_RAGDOLL | GROUP_RAGDOLL_UPPER |
  GROUP_RAGDOLL_P2 | GROUP_RAGDOLL_UPPER_P2 |
  GROUP_RAGDOLL_P3 | GROUP_RAGDOLL_UPPER_P3 |
  GROUP_RAGDOLL_P4 | GROUP_RAGDOLL_UPPER_P4;

/**
 * The sphere hits the world only.
 * Motors NEVER collide with other motors, never with balls, and never with ragdolls.
 */
export const MOTOR_GROUPS =
  (GROUP_MOTOR << 16) |
  (ALL_GROUPS & ~ALL_RAGDOLLS & ~GROUP_BALL & ~GROUP_MOTOR);

/** The ball hits the world and athlete limbs, and passes through the sphere motors. */
export const BALL_GROUPS = (GROUP_BALL << 16) | (ALL_GROUPS & ~GROUP_MOTOR);

export const ENVIRONMENT_RAY_GROUPS = (0xffff << 16) | ENVIRONMENT_MEMBERSHIP;

/**
 * THE MATRIX, COMPUTED FROM THE WORDS ABOVE — never typed out by hand.
 *
 * A hand-written table is a second copy of the answer that starts agreeing with
 * the first and quietly stops. This derives each cell from the two words with
 * Rapier's own rule, so if a filter is edited the log changes with it. That is
 * the whole point: the motor/ball cell reading "no" is the evidence for the
 * spec, and it has to be evidence rather than a caption.
 */
export function logCollisionMatrix() {
  const rows = [
    ['environment', ENVIRONMENT_GROUPS],
    ['ragdoll', RAGDOLL_GROUPS],
    ['ragdoll_upper', RAGDOLL_UPPER_GROUPS],
    ['motor', MOTOR_GROUPS],
    ['ball', BALL_GROUPS],
  ];
  const interacts = (a, b) =>
    ((a >>> 16) & (b & 0xffff)) !== 0 && ((b >>> 16) & (a & 0xffff)) !== 0;

  const width = Math.max(...rows.map(([name]) => name.length));
  console.log(
    `[groups] ${''.padEnd(width)}  ${rows.map(([name]) => name.padStart(11)).join('')}`,
  );
  for (const [nameA, wordA] of rows) {
    const cells = rows.map(([, wordB]) => (interacts(wordA, wordB) ? 'YES' : 'no').padStart(11));
    console.log(`[groups] ${nameA.padEnd(width)}  ${cells.join('')}`);
  }
  console.log(
    '[groups] motor x ball must read "no" — the sphere ignores the ball by design; ' +
      'the limbs are what touch it.',
  );
}

/**
 * LAW 6 fixes this. It is deliberately NOT a TUNING knob, for the same reason
 * `loop.fixedHz` is not: changing it mid-run changes what the simulation is.
 */
const SOLVER_ITERATIONS = 16;

let world = null;

/**
 * The contact-force event queue.
 *
 * autoDrain is true, so the queue is cleared at the start of every world.step
 * and can only ever hold the events from the step just taken. Anything not
 * drained in the same fixed step it was produced is gone — which is what we
 * want: an impact is a property of a tick, not a backlog.
 */
let eventQueue = null;

/**
 * Boots Rapier and builds the world. Must be awaited before the loop starts.
 * @param {number} fixedDt the loop's constant timestep, in seconds
 * @returns {Promise<import('@dimforge/rapier3d-compat').World>}
 */
export async function initPhysics(fixedDt) {
  await RAPIER.init();

  world = new RAPIER.World({ x: 0, y: TUNING.physics.gravityY, z: 0 });
  world.numSolverIterations = SOLVER_ITERATIONS;

  // The physics timestep IS the loop's timestep. Never derived independently.
  world.timestep = fixedDt;

  eventQueue = new RAPIER.EventQueue(true);

  return world;
}

/** @returns {import('@dimforge/rapier3d-compat').World} */
export function getWorld() {
  if (!world) throw new Error('[physics] initPhysics() has not completed');
  return world;
}

/**
 * The ONLY place the world is stepped. Called from fixedUpdate, once per tick.
 *
 * Gravity is pushed from TUNING here rather than from a GUI callback, because
 * that keeps every physics mutation inside fixedUpdate.
 */
export function stepPhysics() {
  world.gravity.y = TUNING.physics.gravityY;
  world.step(eventQueue);
}

/**
 * Hands every contact-force event from the step just taken to `onEvent`.
 *
 * Called from fixedUpdate immediately after stepPhysics, and from nowhere else.
 * The event object Rapier passes in is a TEMPORARY — its fields are only valid
 * inside the closure, and it must never be stored — so the callback receives
 * plain numbers rather than the event itself.
 *
 * @param {(handle1: number, handle2: number, totalForce: number, maxForce: number) => void} onEvent
 */
export function drainContactForces(onEvent) {
  if (!eventQueue) return;
  eventQueue.drainContactForceEvents((event) => {
    onEvent(
      event.collider1(),
      event.collider2(),
      event.totalForceMagnitude(),
      event.maxForceMagnitude(),
    );
  });
}

export { RAPIER };
