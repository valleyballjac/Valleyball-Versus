/**
 * CORNER CAP NEGATIVE CONTROL — proves the certification gates REJECT a
 * missing or inverted corner glass-bottom shelf cap.
 *
 * Builds a disposable mutant world (removing or inverting the NE quadrant's
 * cap triangles, before collider construction, via mutateCap) and runs the
 * same three gate checks the release suite uses:
 *
 *   - winding (cornerCapWinding): cap tiles must be up-facing, one fan per
 *     quadrant. REMOVE leaves NE empty; INVERT leaves 32 down-facing tiles.
 *   - rest height (cornerCapRestCheck): every cap-backed VIS corner standing
 *     point must have a solid collider at >= 12.8 m below. REMOVE returns the
 *     ~11 m rim (or the void) instead.
 *   - dynamic drop: a ball dropped onto the intended 13 m cap must rest at
 *     >= 12.8 m. REMOVE lets it fall to the rim or void.
 *
 * Each mutant must fail AT LEAST one gate, and the restored (clean) world must
 * pass all of them. INVERT is caught by winding (Rapier 0.19.3-compat trimeshes
 * still hold a body from above, so the physical drop does not distinguish an
 * inverted cap; the geometry gate is the authoritative winding guard).
 *
 * Exit contract: 0 when every case matches its expectation, 1 otherwise.
 * Run: npm run test:negative
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { buildWorld } from './test_ball_roll.mjs';
import {
  CAP_HEIGHT_M,
  CAP_REST_MIN_Y,
  buildVisStandingWorld,
  cornerCapWinding,
  cornerCapRestCheck,
  cornerCapStandingPoints,
} from './corner_cap_gate.mjs';

const BALL_RADIUS = 0.5;
const TICKS = 240;
const KILL_FLOOR_Y = -5.0;

/** Drop a regulation ball from the intended cap height at (x, z) and return its
 * resting bottom and minimum center Y. Mirrors the drop gate's spawn. */
function dropBall(sim, x, z) {
  const body = sim.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true)
      .setLinearDamping(0.01).setAngularDamping(0.015));
  sim.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS).setDensity(4.2).setFriction(0.35).setRestitution(0.88),
    body);
  body.setTranslation({ x, y: CAP_HEIGHT_M + BALL_RADIUS + 0.05, z }, true);
  let minY = body.translation().y;
  for (let t = 0; t < TICKS; t++) {
    sim.step();
    const y = body.translation().y;
    if (y < minY) minY = y;
  }
  const restBase = body.translation().y - BALL_RADIUS;
  sim.removeRigidBody(body);
  return { restBase, minY };
}

async function main() {
  await RAPIER.init();
  const { world: visWorld } = await buildVisStandingWorld();

  // Representative cap-backed standing point in the NE quadrant (+x, -z), in
  // the outer wedge away from the extreme glass corner post.
  const standing = cornerCapStandingPoints(visWorld, 1.0);
  const ne = standing.filter((p) => p.x > 0 && p.z < 0).sort(
    (a, b) => (b.x + Math.abs(b.z)) - (a.x + Math.abs(a.z)))[0];
  if (!ne) throw new Error('no NE cap standing point found');

  const cases = [
    { label: 'CLEAN',      mutate: null,                                    windFail: false, restFail: false, dropFail: false },
    { label: 'REMOVE-NE',  mutate: { mode: 'remove', quadrant: 'NE' },      windFail: true,  restFail: true,  dropFail: true },
    { label: 'INVERT-NE',  mutate: { mode: 'invert', quadrant: 'NE' },      windFail: true,  restFail: false, dropFail: false },
  ];

  let ok = true;
  console.log(`representative NE cap point: x=${ne.x.toFixed(1)} z=${ne.z.toFixed(1)}`);
  for (const c of cases) {
    const { probe, sim, meshes } = await buildWorld({ mutate: c.mutate });
    const winding = cornerCapWinding(meshes);
    const rest = cornerCapRestCheck(probe, visWorld, 1.0);
    const drop = dropBall(sim, ne.x, ne.z);

    const windFail = winding.failures.length > 0;
    const restFail = rest.failures.length > 0;
    const dropFail = drop.restBase < CAP_REST_MIN_Y || drop.minY < KILL_FLOOR_Y;

    const caseOk = windFail === c.windFail && restFail === c.restFail && dropFail === c.dropFail;
    ok = ok && caseOk;

    console.log(
      `${c.label.padEnd(11)} winding=${windFail ? 'FAIL' : 'pass'}` +
      `(${winding.failures.length},down=${winding.downFacing})` +
      ` rest=${restFail ? 'FAIL' : 'pass'}(${rest.failures.length})` +
      ` drop=${dropFail ? 'FAIL' : 'pass'}(restBase=${drop.restBase.toFixed(2)})` +
      ` -> ${caseOk ? 'EXPECTED' : 'UNEXPECTED'}`);
    probe.free();
    sim.free();
  }

  visWorld.free();
  console.log(ok ? 'NEGATIVE CONTROL PASS — mutants rejected, clean world passes' : 'NEGATIVE CONTROL FAIL');
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});