import * as THREE from 'three';

import { TUNING } from '../config/tuning.js';
import { RAPIER, getWorld, ENVIRONMENT_RAY_GROUPS } from '../sim/physics.js';

/**
 * THE MOUNT FOLLOWER — the floor probe under the pelvis, and the held
 * constraint that keeps the sphere beneath a downed athlete.
 *
 * Lifted out of `fixedUpdate` whole in G3.5. Every line and every comment
 * travelled with it; nothing was rewritten, reordered or shortened, because the
 * gate for this step is a byte-identical determinism hash and the reasoning in
 * these comments is the only record of why two earlier attempts at this
 * mechanic failed.
 *
 * IT RETURNS `pelvisFloorY` RATHER THAN SETTING IT. That value was a
 * module-level `let` in main.js, written here and read two hundred lines later
 * by the ghost — a channel with no declaration and no owner. It is a return
 * value now, which is the same number travelling the same distance with its
 * route written down.
 *
 * THE RAY IS THIS MODULE'S OWN. main.js used to keep ONE lazily-built
 * `RAPIER.Ray` shared between this mechanic and the camera's spring arm, with
 * the origin and direction objects rewritten in place before each cast. That
 * sharing was safe only because every caller happened to set all six fields
 * first; it is not a property anyone could check. Each owner now has its own,
 * which costs one Ray object for the life of the process and removes an
 * invariant that was being maintained by luck.
 *
 * THE DIRECTORY RULE APPLIES HERE TOO (src/mechanics/): nothing in this file
 * names a wall clock or a scheduler. The clock is `tick`.
 */

/**
 * Mount-hold gates that are not feel knobs and must not become sliders.
 *
 * pelvisDownness past this means the pelvis is genuinely on the floor rather
 * than dipped; the speed gate means the drag has already done its work and the
 * ball is no longer travelling. Both are statements about when the hold is SAFE, not
 * about how it should feel, so they live here beside the ruling rather than in
 * TUNING where a slider would invite tuning an invariant. Both were relaxed for
 * Task 7 (0.8 -> 0.7, 0.2 -> 0.5) so the held window opens while the weight
 * gate is still open — see the measured table at the constraint itself.
 */
/**
 * How far the pelvis must have dropped before the sphere starts following it.
 *
 * EARLY, BUT ABOVE THE NOISE FLOOR. The follower is continuous and converges on
 * its own, so engaging while the character is still going down is what lets the
 * sphere travel WITH the body instead of chasing it afterwards — the old gates
 * waited for the body to be flat and stopped, which is precisely the moment the
 * sphere was furthest away.
 *
 * But not arbitrarily early. A character standing normally on the mount used to
 * sit at ~0.06 here, because the pelvis rests a little under the nominal
 * standing height — so a gate of 0.05 was BELOW the resting value and the
 * follower engaged during ordinary play whenever the weight dipped. Caught in
 * the determinism pair: the anchored capture logged the follower running at
 * tick 55 while the character was simply settling onto its mount at spawn.
 * That is the "unexplained movement" class of bug in miniature.
 *
 * The resting value is a clean 0 now that the measurement spans the reachable
 * range, so 0.25 has more margin than it was designed with, not less.
 *
 * IT READS pelvisDownness, NOT standUpNeed, and that distinction is the whole
 * reason the two exist separately. standUpNeed is now the tracker's recovery
 * ramp — and mount recovery's two conditions are supposed to be INDEPENDENT
 * evidence that tracking has failed. Pointing this gate at a weight-derived
 * number would make it "weight is low AND weight is low", which is one
 * condition wearing two hats. RULING GF-1.4 stands: this reads sim state only,
 * and it stays unreachable while tracking is healthy.
 */
const MOUNT_FOLLOW_STAND_NEED = 0.25;
/** How far above the pelvis the floor ray starts, and how far it reaches. */
const MOUNT_RAY_LIFT = 2.0;
const MOUNT_RAY_LENGTH = 20;

/**
 * @returns {object} scratch and recorded ticks this module owns
 */
export function createMountFollowerState() {
  return {
    /** Built lazily — RAPIER is not initialised at module-eval time. */
    envRay: null,
    /** The Ray's origin and direction, rewritten in place before every cast. */
    rayFrom: { x: 0, y: 0, z: 0 },
    rayDir: { x: 0, y: 0, z: 0 },
    /** Scratch for the sphere's new position, so a follow allocates nothing. */
    mountPoint: new THREE.Vector3(),
    /** Rate-limits the follow log to once a second. A recorded tick, not a state. */
    lastMountLogTick: -1e9,
  };
}

/**
 * One step of the floor probe and the mount hold.
 *
 * @param {object} args
 * @param {ReturnType<typeof createMountFollowerState>} args.state
 * @param {object} args.motor
 * @param {object|null} args.ragdoll
 * @param {object|null} args.animTarget the ghost, READ for pelvisDownness
 * @param {object} args.tracker READ for weight
 * @param {number} args.tick
 * @param {number} args.dt
 * @returns {number} the world Y of the floor under the pelvis, or NaN if the
 *   ray found nothing — which the ghost's standUpNeed reads as "no surface".
 */
export function runMountFollower({ state, motor, ragdoll, animTarget, tracker, tick, dt }) {
  // ═══ THE MOUNT HOLD ═══
  //
  // RULING GF-1.4 — this is the third member of the sanctioned spawn-event
  // family (spawn, watchdog, mount hold). Conditions read only sim state; it is
  // unreachable while tracking is healthy; it must never gain a code path
  // driven by input or animation.
  //
  // WHY THIS IS A HELD CONSTRAINT AND NOT AN EVENT, which is the whole of the
  // redesign. It was written twice as an edge — "when these four things become
  // true, snap once" — and it never fired either time, for a reason that is
  // obvious in hindsight and was invisible in the code: the four gates are
  // driven by processes running at completely different rates, and their open
  // windows did not overlap. Measured in GF-2, on a sprint knockdown:
  //
  //     weight < gate      ticks   0..28     (recovery ramp, 0.3/s)
  //     standUpNeed > gate ticks  57..103    (pelvis ease, 6/s)
  //     sphere at rest     ticks  48..419    (the knockdown drag)
  //     separated          ticks  12..159
  //
  // Three of four held together for a 47-tick stretch and the fourth had closed
  // 29 ticks earlier. There is no edge to catch there. Asking instead "is the
  // character down RIGHT NOW, and if so put the ball under it" has no timing to
  // miss: it is a condition evaluated every step, and it re-asserts itself for
  // as long as the answer is yes.
  //
  // The consequence is the point. The sphere sits under the pelvis for the
  // ENTIRE down period, so when the ghost's mountSlack easing hands the mount
  // back and the stand-up plays, it pulls STRAIGHT UP — the character never
  // travels toward the sphere, because the sphere was never anywhere else.
  // THE FLOOR UNDER THE PELVIS, cast once per step and used twice: by the mount
  // hold for the sphere's height, and by the ghost's standUpNeed for the
  // character's height above the surface rather than above y = 0. One ray, in
  // the file that already owns the environment-only filter.
  let pelvisFloorY = NaN;
  if (ragdoll) {
    const pelvisItem = ragdoll.rig.get('pelvis');
    if (pelvisItem) {
      const p = pelvisItem.body.translation();
      if (!state.envRay) state.envRay = new RAPIER.Ray(state.rayFrom, state.rayDir);
      state.rayFrom.x = p.x; state.rayFrom.y = p.y + MOUNT_RAY_LIFT; state.rayFrom.z = p.z;
      state.rayDir.x = 0; state.rayDir.y = -1; state.rayDir.z = 0;
      const probe = getWorld().castRay(
        state.envRay, MOUNT_RAY_LENGTH, true, undefined, ENVIRONMENT_RAY_GROUPS,
      );
      if (probe) pelvisFloorY = state.rayFrom.y - probe.timeOfImpact;
    }
  }

  if (motor && ragdoll && animTarget) {
    const pelvisItem = ragdoll.rig.get('pelvis');
    if (pelvisItem) {
      const pelvis = pelvisItem.body.translation();
      const sphere = motor.body.translation();

      // DETACHED: the character has lost its footing. One condition, evaluated
      // every step, with no edge to catch and no second mode. During healthy
      // play the weight sits at 1 and this is never true.
      const detached =
        tracker.weight < TUNING.impact.mountRecoverBelow &&
        animTarget.pelvisDownness > MOUNT_FOLLOW_STAND_NEED;

      const separation = Math.hypot(pelvis.x - sphere.x, pelvis.z - sphere.z);

      if (detached && separation > TUNING.impact.mountSnapEpsilon) {
        if (!Number.isFinite(pelvisFloorY)) {
          // Should be impossible inside the bowl. NEVER GUESS A Y.
          console.warn(
            `[mount] floor ray found nothing under the pelvis at tick ${tick}; follow skipped`,
          );
        } else {
          // ── THE STEP THE SPHERE TAKES THIS TICK ──
          //
          // Speed proportional to the gap and CAPPED. Close in it is an
          // exponential ease that settles without overshoot; far out it is a
          // constant-speed chase whose per-step displacement can never exceed
          // mountFollowSpeed * dt — about 0.2 m, which is what the ball covers
          // in one step at a sprint. That cap is the whole reason this is
          // smooth: the displacement is ordinary motion as far as the renderer
          // is concerned, so prev/curr interpolate it like any other movement.
          const gapX = pelvis.x - sphere.x;
          const gapZ = pelvis.z - sphere.z;
          const targetY = pelvisFloorY + TUNING.motor.radius;
          const gapY = targetY - sphere.y;

          const pull = Math.min(
            TUNING.impact.mountFollowSpeed,
            TUNING.impact.mountFollowRate * separation,
          );
          let move = Math.min(separation, pull * dt);

          // ── THE WALL CLAMP ──
          //
          // The sphere is being moved by fiat rather than by the solver, so
          // nothing stops it entering geometry on the way. A ray along the
          // step, environment-only, stops it short of anything in the path.
          // The bowl's interior is convex so a segment between two interior
          // points stays inside it and this rarely fires today — it is here for
          // the first obstacle that lands in the arena, and it costs one ray
          // only on the steps where the follower is actually moving.
          const invSep = 1 / separation;
          const dirX = gapX * invSep;
          const dirZ = gapZ * invSep;

          if (!state.envRay) state.envRay = new RAPIER.Ray(state.rayFrom, state.rayDir);
          state.rayFrom.x = sphere.x; state.rayFrom.y = sphere.y; state.rayFrom.z = sphere.z;
          state.rayDir.x = dirX; state.rayDir.y = 0; state.rayDir.z = dirZ;
          const reach = move + TUNING.motor.radius;
          const blocked = getWorld().castRay(
            state.envRay, reach, true, undefined, ENVIRONMENT_RAY_GROUPS,
          );
          if (blocked) {
            move = Math.max(0, Math.min(move, blocked.timeOfImpact - TUNING.motor.radius));
          }

          // ── PLACE IT, AND LEAVE THE VELOCITY ALONE ──
          //
          // The velocity is deliberately NOT zeroed. Zeroing it was half of the
          // old glitch: it made the sphere stop dead while the ragdoll carried
          // on, so the two were forever being yanked back together. Left alone,
          // the sphere keeps its momentum and sheds it through the knockdown
          // drag on the ordinary clamped path, while this correction closes
          // whatever gap the drag has not. Two forces that agree, instead of a
          // teleport fighting a body.
          //
          // And NO motor.interpolated.reset(). That call is for a genuine
          // teleport — the watchdog — and calling it here every step was the
          // render stutter: it collapses prev onto curr, so the frame shows the
          // sphere at its new position with no interpolation, sixty times a
          // second. The loop already saved prev at the top of this frame and
          // syncMotorSnapshot writes curr after the step; a bounded displacement
          // between them is exactly what the interpolation contract is for.
          state.mountPoint.set(
            sphere.x + dirX * move,
            sphere.y + gapY * Math.min(1, TUNING.impact.mountFollowRate * dt),
            sphere.z + dirZ * move,
          );
          motor.body.setTranslation(
            { x: state.mountPoint.x, y: state.mountPoint.y, z: state.mountPoint.z },
            true,
          );

          if (tick - state.lastMountLogTick >= TUNING.loop.fixedHz) {
            state.lastMountLogTick = tick;
            console.log(
              `[mount] following pelvis (tick ${tick}, d=${separation.toFixed(3)}, ` +
                `step=${move.toFixed(3)} m)`,
            );
          }
        }
      }
    }
  }
  return pelvisFloorY;
}
