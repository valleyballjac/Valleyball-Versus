/**
 * CORNER FAN NEGATIVE CONTROL — proves the certification gates REJECT a
 * missing or inverted sloped corner fan.
 *
 * Builds disposable mutant worlds (removing or inverting the NE quadrant's
 * fan triangles, before collider construction, via mutateCap) and runs the
 * same gate checks the release suite uses:
 *
 *   - winding (cornerCapWinding): each quadrant must carry a full up-facing
 *     rim-to-apex fan. REMOVE leaves NE empty; INVERT flips NE's tiles
 *     downward.
 *   - static rest height (cornerCapRestCheck, graded against the PRISTINE fan
 *     world): under every fan point the topmost solid surface must BE the fan.
 *     REMOVE returns the ~10.5 m court rim below it.
 *   - dynamic drop: a regulation ball dropped onto the NE fan must stay
 *     inside the enclosed court (it may roll downhill into the field, a
 *     legitimate rest near ~8.7 m, but must never exit through the void).
 *     REMOVE drops it straight out of the world (measured rest -82 m).
 *
 * Each mutant must fail AT LEAST one gate, and the restored (clean) world must
 * pass all of them. INVERT is always caught by winding; whether the ray-based
 * rest check also catches it depends on Rapier's triangle ray sidedness, which
 * is measured below rather than assumed (see expectations).
 *
 * Exit contract: 0 when every case matches its expectation, 1 otherwise.
 * Run: npm run test:negative
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { buildWorld } from './test_ball_roll.mjs';
import {
  buildFanWorld,
  cornerCapWinding,
  cornerCapRestCheck,
  cornerCapStandingPoints,
  castDown,
} from './corner_cap_gate.mjs';

const BALL_RADIUS = 0.5;
const TICKS = 240;
const KILL_FLOOR_Y = -5.0;

/** Separation tolerance (m) for the backface ray probe: the inverted mutant
 * still "supports" a ray hit when Rapier rays are double-sided. */
const DROP_REST_TOL = 0.6;

/** Drop a regulation ball from just above the fan surface at (x, z) and
 * return its resting bottom and minimum center Y. Mirrors the drop gate's
 * spawn. */
function dropBall(sim, x, z, fanY) {
  const body = sim.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true)
      .setLinearDamping(0.01).setAngularDamping(0.015));
  sim.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS).setDensity(4.2).setFriction(0.35).setRestitution(0.88),
    body);
  body.setTranslation({ x, y: fanY + BALL_RADIUS + 0.05, z }, true);
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
  // Pristine fan world: the yardstick mutants are graded against. Built from
  // arena.glb on disk, never from the mutated mesh arrays.
  const { world: fanWorld, tris: fanTris } = await buildFanWorld();

  // Representative NE fan point (+x, -z): mid-slope, fanY closest to 12.0, so
  // a REMOVE mutant opens the full corner void under it (measured fall to
  // -82 m) and the drop check has maximal separation.
  const standing = cornerCapStandingPoints(fanWorld, 1.0);
  const ne = standing
    .filter((p) => p.x > 0 && p.z < 0)
    .sort((a, b) => Math.abs(a.fanY - 12.0) - Math.abs(b.fanY - 12.0))[0];
  if (!ne) throw new Error('no NE fan standing point found');

  // Measure Rapier's ray sidedness once on the inverted mutant: does castDown
  // still hit a downward-wound fan? This decides the INVERT rest expectation
  // (the winding gate catches INVERT either way).
  const { probe: invProbe } = await buildWorld({ mutate: { mode: 'invert', quadrant: 'NE' } });
  const invSurf = castDown(invProbe, ne.x, 80, ne.z);
  const rayHitsBackface = invSurf !== null && invSurf >= ne.fanY - DROP_REST_TOL;
  invProbe.free();

  const cases = [
    { label: 'CLEAN',      mutate: null,                               windFail: false, restFail: false, dropFail: false },
    { label: 'REMOVE-NE',  mutate: { mode: 'remove', quadrant: 'NE' }, windFail: true,  restFail: true,  dropFail: true },
    { label: 'INVERT-NE',  mutate: { mode: 'invert', quadrant: 'NE' }, windFail: true,  restFail: !rayHitsBackface, dropFail: !rayHitsBackface },
  ];

  let ok = true;
  console.log(`pristine fan: ${fanTris} tris, ${standing.length} standing points`);
  console.log(`representative NE fan point: x=${ne.x.toFixed(1)} z=${ne.z.toFixed(1)} fanY=${ne.fanY.toFixed(2)}`);
  console.log(`rapier ray hits inverted fan backface: ${rayHitsBackface}`);
  for (const c of cases) {
    const { probe, sim, meshes } = await buildWorld({ mutate: c.mutate });
    const winding = cornerCapWinding(meshes);
    const rest = cornerCapRestCheck(probe, fanWorld, 1.0);
    const drop = dropBall(sim, ne.x, ne.z, ne.fanY);

    const windFail = winding.failures.length > 0;
    const restFail = rest.failures.length > 0;
    // Downhill roll into the enclosed field is a legitimate CLEAN rest
    // (~8.7 m); only an exit through the kill plane is a drop failure.
    const dropFail = drop.restBase < KILL_FLOOR_Y || drop.minY < KILL_FLOOR_Y;

    const caseOk = windFail === c.windFail && restFail === c.restFail && dropFail === c.dropFail;
    ok = ok && caseOk;

    console.log(
      `${c.label.padEnd(11)} winding=${windFail ? 'FAIL' : 'pass'}` +
      `(${winding.failures.length},down=${winding.downFacing},vert=${winding.verticalInBand})` +
      ` rest=${restFail ? 'FAIL' : 'pass'}(${rest.failures.length})` +
      ` drop=${dropFail ? 'FAIL' : 'pass'}(restBase=${drop.restBase.toFixed(2)},fanY=${ne.fanY.toFixed(2)})` +
      ` -> ${caseOk ? 'EXPECTED' : 'UNEXPECTED'}`);
    probe.free();
    sim.free();
  }

  fanWorld.free();
  console.log(ok ? 'NEGATIVE CONTROL PASS — mutants rejected, clean world passes' : 'NEGATIVE CONTROL FAIL');
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
