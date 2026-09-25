/**
 * STATE TRACE — a renderer-independent fingerprint of the simulation, per tick.
 *
 * The PNG pair proves determinism on ONE renderer: a SwiftShader hash never
 * equals a GPU hash, so a cloud run and a laptop run can only be compared
 * against themselves. This module hashes the SIMULATION instead of the picture:
 * every rigid body's translation, rotation, linear and angular velocity, in
 * Rapier's handle order, plus each athlete's ghost targets, blend weight and
 * grounded flag. Two machines that step the same world produce the same digest,
 * whatever they draw it with.
 *
 * READ-ONLY BY CONSTRUCTION. It is armed only by `?stateTrace=1`, it runs in a
 * loop.onTick listener (after fixedUpdate, before render), and it only calls
 * getters. It cannot move the simulation, so arming it cannot change a hash —
 * which Phase 0 checks by running the determinism pair with and without it.
 *
 * Floats are hashed by their exact IEEE-754 bits (no rounding), so a one-ULP
 * divergence shows up on the tick it happens, not four anchors later.
 */

const QUERY_KEY = 'stateTrace';

/** FNV-1a, 32-bit, over bytes. Fast, allocation-free, good enough to detect drift. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const _f64 = new Float64Array(1);
const _u8 = new Uint8Array(_f64.buffer);

function mix(h, x) {
  _f64[0] = x;
  for (let i = 0; i < 8; i++) {
    h ^= _u8[i];
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

function mixVec(h, v) {
  h = mix(h, v.x);
  h = mix(h, v.y);
  return mix(h, v.z);
}

function mixQuat(h, q) {
  h = mixVec(h, q);
  return mix(h, q.w);
}

/**
 * Digest of every rigid body in the world, in handle order.
 * @param {import('@dimforge/rapier3d-compat').World} world
 */
export function hashWorld(world) {
  let h = FNV_OFFSET;
  let count = 0;
  world.bodies.forEach((body) => {
    count += 1;
    h = mix(h, body.handle);
    h = mix(h, body.isEnabled() ? 1 : 0);
    h = mixVec(h, body.translation());
    h = mixQuat(h, body.rotation());
    h = mixVec(h, body.linvel());
    h = mixVec(h, body.angvel());
  });
  return { hash: h >>> 0, bodies: count };
}

/** Digest of the parts of an athlete that live outside Rapier. */
export function hashAthlete(athlete) {
  let h = FNV_OFFSET;
  const tr = athlete.tracker;
  const at = athlete.animTarget;
  if (tr) h = mix(h, tr.weight);
  if (athlete.motor) h = mix(h, athlete.motor.grounded ? 1 : 0);
  if (at && at.targets) {
    for (const [, t] of at.targets) {
      h = mixVec(h, t.currPos);
      h = mixQuat(h, t.currQuat);
    }
  }
  return h >>> 0;
}

export function readStateTraceFlag(search) {
  const raw = new URLSearchParams(search ?? window.location.search).get(QUERY_KEY);
  return raw === '1' || raw === 'true';
}

/**
 * Arms the trace when `?stateTrace=1` is present. Exposes the result on
 * `window.__vbTrace` for harnesses: { ticks: number[], world: number[],
 * athletes: number[][], bodies: number }.
 *
 * @param {object} deps
 * @param {import('../core/Loop.js').Loop} deps.loop
 * @param {() => import('@dimforge/rapier3d-compat').World} deps.getWorld
 * @param {() => object[]} deps.getAthletes
 * @returns {boolean} whether the trace was armed
 */
export function initStateTrace({ loop, getWorld, getAthletes }) {
  if (!readStateTraceFlag()) return false;
  const trace = { ticks: [], world: [], athletes: [], bodies: 0 };
  window.__vbTrace = trace;
  loop.onTick((tick) => {
    const world = getWorld();
    if (!world) return;
    const w = hashWorld(world);
    trace.ticks.push(tick);
    trace.world.push(w.hash);
    trace.bodies = w.bodies;
    const athletes = getAthletes();
    const row = new Array(athletes.length);
    for (let i = 0; i < athletes.length; i++) row[i] = hashAthlete(athletes[i]);
    trace.athletes.push(row);
  });
  console.log('[stateTrace] armed — hashing world + athletes every tick');
  return true;
}
