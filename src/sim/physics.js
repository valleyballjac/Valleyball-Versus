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
 * LAW L3: Rapier's built-in damping setters are never called, anywhere, and
 * their names appear nowhere in this codebase so the ban greps clean. Explicit
 * damping crashes the Rapier WASM build. All resistance is applied as clamped
 * impulses — see applyClampedDamping in motor.js, the single implementation.
 */

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
