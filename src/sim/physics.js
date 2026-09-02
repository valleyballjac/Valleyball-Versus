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
 * ONE LISTED EXCEPTION, and one correction. The exception is the arm chain's
 * solver damping, applied per step in tracker.js: the clamped helpers run
 * before world.step and damp the pre-step velocity relative to the target, so
 * they cannot touch chatter the solver injects during the step — measured,
 * raising their gains
 * fourfold moved it under 3%. That site names the setters, so the ban no longer
 * greps to zero; it greps to two lines in one function, both commented.
 *
 * The correction: this file used to claim explicit damping CRASHES the WASM
 * build. Tested directly against @dimforge/rapier3d-compat 0.19.3 — it does
 * not. setLinearDamping and setAngularDamping apply cleanly, and a ball dropped
 * with damping 2.0 reaches -5.9 m/s where free fall reaches -24.0. The reason
 * to keep resistance in one clamped implementation stands on its own; it never
 * needed the crash claim, and the claim was wrong.
 */

/**
 * THE COLLISION GROUP LAYOUT, in one place.
 *
 *   0x0001  environment — the arena's trimesh. Stamped on in main.js, because
 *           arena.js is frozen; Rapier's default membership is every bit set,
 *           which is fine for contacts but useless as a ray filter.
 *   0x0002  ragdoll     — the sixteen character bodies (autorig.js).
 *   0x0004  motor       — the sphere (autorig.js, detachMotorFromRagdoll).
 *
 * ENVIRONMENT_RAY_GROUPS is an interaction-groups word whose FILTER half is
 * environment-only, so a ray cast with it can hit the arena and nothing else.
 * Every non-contact ray in the project uses it: the camera's obstruction ray,
 * mount recovery's floor probe, and the motor's ground fan.
 *
 * WHY NOT filterExcludeRigidBody. That argument takes ONE body. The character
 * is sixteen, so excluding it that way is impossible — and without the filter
 * a downward ray from the sphere hits the character's own calf, which is what
 * left motor.grounded stuck true from a standing rest.
 *
 * It lives here rather than in main.js because motor.js needs it too and
 * motor.js cannot import main.js — main.js imports motor.js.
 */
export const ENVIRONMENT_MEMBERSHIP = 0x0001;
export const ENVIRONMENT_RAY_GROUPS = (0xffff << 16) | ENVIRONMENT_MEMBERSHIP;

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
