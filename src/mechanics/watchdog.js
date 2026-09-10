import * as THREE from 'three';

import { TUNING } from '../config/tuning.js';
import { consumeBallReset } from '../input.js';
import { resetBall, getCourtBallDropSpawn } from '../sim/ball.js';

/**
 * THE WATCHDOGS — the athlete's kill plane and the balls'.
 *
 * Lifted out of `fixedUpdate` whole in G3.5. Not one line of it changed on the
 * way: the same conditions in the same order, reading the same preset, writing
 * through the same two sanctioned spawn-event sites. What changed is that
 * `fixedUpdate` now calls it instead of containing it.
 *
 * WHY THE STATE IS A PARAMETER AND NOT A MODULE-LEVEL `let`. It was a
 * module-level `let` in main.js and that was fine while there was exactly one
 * athlete. G5 instantiates N of them, and a scratch vector shared between two
 * athletes' respawns is a bug that only appears when both go out of bounds on
 * the same tick — which is precisely the tick nobody tests. One state object
 * per athlete, created at boot, held by the caller.
 *
 * THE DIRECTORY RULE APPLIES HERE TOO (src/mechanics/): nothing in this file
 * names a wall clock or a scheduler. The clock is `tick`.
 */

/**
 * @returns {{ respawnPoint: THREE.Vector3 }} scratch this module owns
 */
export function createWatchdogState() {
  return {
    /** Reused by the respawn so a teleport allocates nothing. */
    respawnPoint: new THREE.Vector3(),
  };
}

/**
 * One step of both watchdogs.
 *
 * @param {object} args
 * @param {ReturnType<typeof createWatchdogState>} args.state
 * @param {object} args.motor
 * @param {object|null} args.ragdoll
 * @param {object[]} args.balls
 * @param {object} args.arenaPreset the ACTIVE arena's preset — spawn and kill plane
 * @param {number|null} args.armedCaptureTick the tick `?captureTick=N` armed, or null
 * @param {number} args.tick
 * @returns {boolean} true if the athlete must be respawned — consumed at the
 *   top of the NEXT tick, where fixedUpdate's step 1 sits
 */
export function runWatchdog({ state, motor, ragdoll, balls, arenaPreset, armedCaptureTick, tick }) {
  // The caller's `respawnRequested` flag, returned rather than assigned, because
  // a module that reaches back into main.js's module scope is the coupling this
  // step exists to remove.
  let respawn = false;

  // THE OUT-OF-BOUNDS WATCHDOG.
  //
  // A respawn is a SPAWN EVENT, not gameplay. This is the one sanctioned use of
  // setTranslation/setLinvel outside construction, it is unreachable from input,
  // and it must never grow conditions that fire during normal play.
  //
  // THE CENSUS IS FOUR PLAY-CODE SITES: the R-spawn, this watchdog, the mount
  // follower in mechanics/mountFollower.js, and resetBall in sim/ball.js. The
  // ball's is the same class as the other three — a spawn event consumed on a
  // tick boundary, never reachable from gameplay — which is why it was allowed
  // to join the family rather than being written inline here. The full census
  // with its construction-class exceptions is the comment above fixedUpdate.
  //
  // It reads only body positions and the tick, so it is deterministic by
  // construction: the same run reaches the same y at the same tick and respawns
  // on the same tick. It lives here, beside the rest of the spawn plumbing,
  // rather than in motor.js, which stays frozen.
  //
  // THE `if (motor)` IS REDUNDANT and kept anyway. fixedUpdate returns early
  // without a motor, so this can never see one — but it was here before the
  // extraction and G3.5 is a refactor: a guard removed is a line changed, and
  // the gate for this step is that no line changes behaviour at all.
  if (motor) {
    const motorY = motor.body.translation().y;
    const pelvis = ragdoll && ragdoll.rig.get('pelvis');
    const pelvisY = pelvis ? pelvis.body.translation().y : Infinity;

    // The kill plane and the landing point both come from the active preset —
    // the court's basin is far deeper than the bowl's, so a shared number would
    // either fire during normal play on one or never fire on the other.
    if (motorY < arenaPreset.killPlaneY || pelvisY < arenaPreset.killPlaneY) {
      state.respawnPoint.set(arenaPreset.spawn.x, arenaPreset.spawn.y, arenaPreset.spawn.z);

      const p = state.respawnPoint;
      motor.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      motor.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      motor.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      // prev AND curr, so the render does not streak the sphere across the bowl
      // for one frame on its way back to the middle.
      motor.interpolated.reset(state.respawnPoint);

      // CONSUMED AT THE TOP OF THE NEXT TICK, not this one.
      //
      // This comment used to say "just below, on THIS tick", and it had said so
      // since Phase 2. It was never true: `fixedUpdate` consumes the respawn
      // flag at step 1, ABOVE the watchdog, so a flag raised here waits a step.
      // Corrected in G4's Deliverable 0 — the comment moved, the behaviour did
      // not, because a one-tick delay on an out-of-bounds respawn is invisible
      // and changing it would move the determinism anchor for no gain.
      //
      // The sphere has already been placed, so the rebuild still happens at the
      // mount it was moved to; only the tick it happens on differs.
      respawn = true;
      console.log(`[watchdog] out of bounds — respawned at tick ${tick}`);
    }
  }

  // ═══ THE BALL'S SPAWN EVENT ═══
  //
  // The fourth and last member of the sanctioned family, and the same shape as
  // the other three: it teleports a body, so it lives here in fixedUpdate at the
  // spawn-event slot and is unreachable from anywhere else. Three ways in, all
  // of them events rather than states:
  //
  //   the serve      — B / Start, edge-triggered and consumed exactly once
  //   the armed run  — a capture run resets the ball on a fixed tick so it is
  //                    in the anchored image, which is why it can be compared
  //   the watchdog   — the same kill plane the athlete has; a ball that left
  //                    the world does not come back on its own
  //
  // consumeBallReset() is deliberately FIRST in the disjunction so it runs on
  // every step whether or not the other two are true. A queued press that
  // survives into a later tick is a press that serves twice.
  //
  // WITH THREE BALLS the serve and the armed-run seed are still ALL-OR-NOTHING —
  // one press puts the whole fixture back — while the watchdog stays per-ball,
  // because one ball leaving the world is not a reason to gather up the other
  // two mid-play.
  //
  // consumeBallReset() runs FIRST and unconditionally, so a queued press cannot
  // survive into a later tick and serve twice.
  const serveQueued = consumeBallReset();
  const armedBallSpawn = armedCaptureTick !== null && tick === TUNING.ball.captureSpawnTick;
  const isCourt = (TUNING.arena && TUNING.arena.type !== 'bowl') || (arenaPreset && arenaPreset.killPlaneY === -15);
  const isDeterministic = armedCaptureTick !== null;

  for (let i = 0; i < balls.length; i += 1) {
    const b = balls[i];
    const belowWorld = b.body.translation().y < arenaPreset.killPlaneY;
    if (serveQueued || armedBallSpawn || belowWorld) {
      const dropPos = isCourt
        ? getCourtBallDropSpawn(i, balls.length, tick, isDeterministic)
        : null;
      resetBall(b, tick, dropPos);
      if (belowWorld && !serveQueued && !armedBallSpawn) {
        console.log(`[ball:${b.id}] out of bounds — reset at tick ${tick}`);
      }
    }
  }

  return respawn;
}
