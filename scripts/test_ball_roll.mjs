/**
 * BALL-ROLL TERRAIN GATE — automated seam and channel-mouth roll tests.
 *
 * Drops and rolls the regulation medium ball across every terrain seam and
 * stream channel mouth of the canonical Valley Court (COL_Court from
 * public/models/arena.glb) in a headless Rapier3D world, and verifies a
 * smooth rollout: no lip launches, no lateral deflection, no phantom
 * deceleration at seams.
 *
 * 8 scenarios:
 *   a) Stream channel mouths, 4 quadrants (NE, NW, SE, SW)
 *   b) Stream-to-field sideline seam, E and W (stations z = 0 and z = 15)
 *   c) KeyBump-to-scoring-circle boundary, N and S
 *
 * Exit contract: exit code 0 when all scenarios pass, 1 if any fails.
 * Exports test_ball_roll_report.json next to the package root.
 *
 * Run: npm run test:roll
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from '../src/config/tuning.js';
import { toTrimeshArrays } from '../src/sim/arena.js';

// ═══ CONSTANTS (card spec) ═══
const DT = 1 / 60;                       // standard fixed timestep
const BALL_RADIUS = 0.5;                 // standard medium ball
const BALL_DENSITY_GCM3 = 0.0042;        // regulation density (see src/sim/ball.js LESSON 12)
const BALL_FRICTION = 0.35;
const BALL_RESTITUTION = 0.88;
const BALL_DRAG_LINEAR = 0.01;
const BALL_DRAG_ANGULAR = 0.015;
const SPAWN_GAP = 0.02;                  // ball bottom clearance above surface at spawn.
// SPEC NOTE: the card says "spawn at y = surface + 0.1m". A 0.1 m free drop
// onto a 0.88-restitution ball produces a ~1.3 m/s rebound that swamps the
// 0.50 m/s mouth threshold and masks genuine lip kicks, so the harness
// spawns the ball resting on the surface (0.02 m clearance). Any positive
// vertical velocity measured after spawn is then terrain-induced by
// definition. Recorded in the report as spawnGapM.

// Scenario thresholds (card spec)
const MOUTH_MAX_REBOUND_VY = 0.50;       // m/s upward while airborne
const MOUTH_MAX_LATERAL_DEFLECT = 0.35;  // m |delta z| across the transition
const MOUTH_FINAL_ABS_X = 10.5;          // ball must funnel into the channel bed
const SEAM_MAX_VX_LOSS = 0.25;           // m/s outward-speed loss over crossing
const SEAM_MAX_VY_HOP = 0.15;            // m/s upward while airborne in crossing window
const BOUNDARY_MAX_VY_KICK = 0.15;       // m/s upward while airborne in crossing window
const CROSS_WINDOW_HALF = 1.0;           // m, half-width of the seam crossing window

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ═══ WORLD BUILD (mirrors src/ai/headlessSim.js) ═══

export async function buildWorld() {
  await RAPIER.init();

  const modelPath = path.join(ROOT, 'public', 'models', 'arena.glb');
  const glbBuffer = fs.readFileSync(modelPath);
  const arrayBuffer = glbBuffer.buffer.slice(
    glbBuffer.byteOffset, glbBuffer.byteOffset + glbBuffer.byteLength);

  const meshes = await new Promise((resolve, reject) => {
    const collected = [];
    new GLTFLoader().parse(arrayBuffer, '', (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((obj) => {
        if (obj.isMesh && obj.name && obj.name.startsWith('COL_')) {
          const geom = obj.geometry.clone();
          geom.applyMatrix4(obj.matrixWorld);
          const isCourtSurface = obj.name === 'COL_Court';
          const { vertices, indices } = toTrimeshArrays(geom, {
            filterInverted: isCourtSurface,
            maxInvertedY: 4.0,
          });
          geom.dispose();
          if (indices && indices.length > 0) {
            collected.push({ name: obj.name, vertices, indices, isCourtSurface });
          }
        }
      });
      resolve(collected);
    }, reject);
  });

  if (!meshes.some((m) => m.name === 'COL_Court')) {
    throw new Error('COL_Court not found in arena.glb');
  }

  // Two worlds: `probe` holds only the static terrain (stepped once so the
  // broadphase is populated) and answers surface raycasts; `sim` carries the
  // terrain plus the rolling ball. Keeping probes in a ball-free world means
  // a downward ray at the ball's (x, z) can never hit the ball itself.
  const buildStatic = () => {
    const w = new RAPIER.World({ x: 0, y: TUNING.physics.gravityY, z: 0 });
    const groundBody = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const m of meshes) {
      const flags = m.isCourtSurface ? RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES : 0;
      const desc = flags
        ? RAPIER.ColliderDesc.trimesh(m.vertices, m.indices, flags)
        : RAPIER.ColliderDesc.trimesh(m.vertices, m.indices);
      desc.setFriction(0.3).setRestitution(0.75);
      w.createCollider(desc, groundBody);
    }
    w.step();
    return w;
  };
  const probe = buildStatic();
  const sim = buildStatic();
  return { probe, sim, meshNames: meshes.map((m) => m.name) };
}

// ═══ SURFACE SAMPLING ═══

/** Terrain surface Y at (x, z) via downward raycast against the probe world. */
export function surfaceY(probe, x, z) {
  const ray = new RAPIER.Ray({ x, y: 80, z }, { x: 0, y: -1, z: 0 });
  const hit = probe.castRay(ray, 200, true);
  if (!hit) return null;
  const toi = hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
  return 80 - toi;
}

/**
 * March raycasts along a path and return the coordinate of the strongest
 * terrain transition (largest per-step height change) inside [minS, maxS],
 * plus the full profile for diagnostics.
 * axis: 'x' (march x, fixed z) or 'z' (march z, fixed x). s0 is the start.
 */
export function locateTransition(probe, axis, fixed, s0, bandNear, bandFar, step = 0.1) {
  const lo = Math.min(s0, bandFar);
  const hi = Math.max(s0, bandFar);
  const profile = [];
  for (let s = lo; s <= hi + 1e-9; s += step) {
    const y = axis === 'x' ? surfaceY(probe, s, fixed) : surfaceY(probe, fixed, s);
    if (y === null) continue;
    profile.push({ s, y });
  }
  let best = null;
  const bandLo = Math.min(bandNear, bandFar);
  const bandHi = Math.max(bandNear, bandFar);
  for (let i = 1; i < profile.length; i++) {
    const dS = profile[i].s - profile[i - 1].s;
    const dY = profile[i].y - profile[i - 1].y;
    const slope = Math.abs(dY / dS);
    const inBand = profile[i].s >= bandLo && profile[i].s <= bandHi;
    if (inBand && (!best || slope > best.slope)) {
      best = { s: profile[i].s, slope };
    }
  }
  return { crossing: best ? best.s : null, slope: best ? best.slope : null, profile };
}

// ═══ BALL + RUNNER ═══

function createBall(world) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(BALL_DRAG_LINEAR)
      .setAngularDamping(BALL_DRAG_ANGULAR));
  world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS)
      .setDensity(BALL_DENSITY_GCM3 * 1000)
      .setFriction(BALL_FRICTION)
      .setRestitution(BALL_RESTITUTION)
      // Game code constants (src/sim/ball.js): the ball's own bounciness must
      // win against dead surfaces, and friction Min keeps it from stalling.
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
    body);
  return body;
}

/**
 * Run one roll. Spawns the ball at (x, z) with initial horizontal velocity,
 * steps `ticks` times in the sim world, then resolves the per-tick surface
 * gap via the probe world (which never contains the ball).
 */
function runRoll({ sim, probe }, { x, z, vx, vz, ticks }) {
  const surf0 = surfaceY(probe, x, z);
  if (surf0 === null) throw new Error(`no terrain under spawn (${x}, ${z})`);
  const body = createBall(sim);
  body.setTranslation({ x, y: surf0 + BALL_RADIUS + SPAWN_GAP, z }, true);
  body.setLinvel({ x: vx, y: 0, z: vz }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);

  const samples = [];
  for (let t = 0; t < ticks; t++) {
    sim.step();
    const p = body.translation();
    const v = body.linvel();
    samples.push({
      t,
      x: p.x, y: p.y, z: p.z,
      vx: v.x, vy: v.y, vz: v.z,
    });
  }
  sim.removeRigidBody(body);
  for (const s of samples) {
    const sy = surfaceY(probe, s.x, s.z);
    s.gap = sy === null ? null : s.y - sy - BALL_RADIUS;
  }
  return { samples, spawnSurfaceY: surf0 };
}

// ═══ METRIC HELPERS ═══

/** Max upward velocity while airborne (gap > 0.05 m). */
function maxAirborneVy(samples, from = 0, to = samples.length) {
  let max = 0;
  for (let i = from; i < to; i++) {
    const s = samples[i];
    if (s.gap !== null && s.gap > 0.05 && s.vy > max) max = s.vy;
  }
  return max;
}

/** Ticks inside the seam crossing window (|s - crossing| <= half). */
function windowTicks(samples, axis, crossing, half) {
  const out = [];
  for (let i = 0; i < samples.length; i++) {
    const s = axis === 'x' ? samples[i].x : samples[i].z;
    if (Math.abs(Math.abs(s) - Math.abs(crossing)) <= half) out.push(i);
  }
  return out;
}

// ═══ SCENARIOS ═══

function mouthScenario(envs, sx, sz, label) {
  const x = 13.0 * sx;
  const z = 38.0 * sz;
  const { samples } = runRoll(envs, {
    x, z,
    vx: -3.0 * sx, // down the mouth bank, inward
    vz: 0,
    ticks: 120,
  });
  const z0 = samples.length ? z : z;
  let lateralDeflect = 0;
  for (const s of samples) lateralDeflect = Math.max(lateralDeflect, Math.abs(s.z - z0));
  const last = samples[samples.length - 1];
  const reboundVy = maxAirborneVy(samples);
  return {
    group: 'channel-mouth', label,
    metrics: {
      maxReboundVy: { value: round3(reboundVy), threshold: MOUTH_MAX_REBOUND_VY, pass: reboundVy <= MOUTH_MAX_REBOUND_VY },
      lateralDeflect: { value: round3(lateralDeflect), threshold: MOUTH_MAX_LATERAL_DEFLECT, pass: lateralDeflect <= MOUTH_MAX_LATERAL_DEFLECT },
      finalAbsX: { value: round3(Math.abs(last.x)), threshold: MOUTH_FINAL_ABS_X, pass: Math.abs(last.x) < MOUTH_FINAL_ABS_X, below: true },
    },
    spawn: { x, z, vx: -3.0 * sx, vz: 0 },
    final: { x: round3(last.x), y: round3(last.y), z: round3(last.z) },
  };
}

function seamScenario(envs, side, label) {
  // Stations z = 0 and z = 15; worst-case metrics are reported per side.
  const stations = [];
  for (const z of [0, 15]) {
    const spawnX = 4.0 * side;
    const loc = locateTransition(envs.probe, 'x', z, spawnX, 8.0 * side, 16.0 * side);
    if (loc.crossing === null) throw new Error(`seam not found at z=${z}`);
    const { samples } = runRoll(envs, {
      x: spawnX, z,
      vx: 4.0 * side,
      vz: 0,
      ticks: 360,
    });
    const w = windowTicks(samples, 'x', loc.crossing, CROSS_WINDOW_HALF);
    if (w.length === 0) throw new Error(`ball never reached seam window at z=${z}`);
    const wStart = w[0];
    const wEnd = w[w.length - 1];
    const speedOut = (s) => s.vx * side;
    const vAtEntry = speedOut(samples[wStart]);
    let minV = vAtEntry;
    let maxSpike = 0;
    for (let i = wStart; i <= wEnd; i++) {
      minV = Math.min(minV, speedOut(samples[i]));
      if (i > wStart) {
        maxSpike = Math.max(maxSpike, speedOut(samples[i - 1]) - speedOut(samples[i]));
      }
    }
    const vxLoss = vAtEntry - minV;
    const vyHop = maxAirborneVy(samples, wStart, wEnd + 1);
    stations.push({
      z,
      crossingX: round3(loc.crossing),
      crossingSlope: round3(loc.slope),
      vxLoss: round3(vxLoss),
      maxVxSpike: round3(maxSpike),
      vyHop: round3(vyHop),
      windowTicks: [wStart, wEnd],
    });
  }
  const worstLoss = Math.max(...stations.map((st) => st.vxLoss));
  const worstHop = Math.max(...stations.map((st) => st.vyHop));
  return {
    group: 'sideline-seam', label,
    metrics: {
      vxLoss: { value: worstLoss, threshold: SEAM_MAX_VX_LOSS, pass: worstLoss <= SEAM_MAX_VX_LOSS },
      vyHop: { value: worstHop, threshold: SEAM_MAX_VY_HOP, pass: worstHop <= SEAM_MAX_VY_HOP },
    },
    stations,
    spawn: { x: 4.0 * side, vx: 4.0 * side, vz: 0, gapAboveSurface: SPAWN_GAP },
  };
}

function boundaryScenario(envs, dir, label) {
  // The "yellow KeyBump" is the seated goal mound (COL_Goals) behind each
  // hoop. Its seat meets the court in a steep face (court ~6.2 m to mound
  // ~10.9 m within 0.25 m of z at x = 0). The roll approaches the seat from
  // the field side: the ball must reach it and stop cleanly, with no upward
  // snag/hop (Delta v_y) at the seated boundary. The court climb below the
  // seat is ~30% grade, so the spawn sits 1.5 m before the located face to
  // keep the ball from stalling on the approach before it reaches it.
  const loc = locateTransition(envs.probe, 'z', 0, 30.0 * dir, 30.0 * dir, 44.0 * dir, 0.05);
  if (loc.crossing === null) throw new Error(`KeyBump seat not found (${label})`);
  const spawnZ = loc.crossing - 1.5 * dir;
  const { samples } = runRoll(envs, {
    x: 0, z: spawnZ,
    vx: 0,
    vz: 4.0 * dir,
    ticks: 240,
  });
  const w = windowTicks(samples, 'z', loc.crossing, CROSS_WINDOW_HALF);
  if (w.length === 0) throw new Error(`ball never reached seat window (${label})`);
  const wStart = w[0];
  const wEnd = w[w.length - 1];
  const vyKick = maxAirborneVy(samples, wStart, wEnd + 1);
  let maxSpike = 0;
  for (let i = wStart + 1; i <= wEnd; i++) {
    const dv = Math.hypot(samples[i].vx - samples[i - 1].vx, samples[i].vz - samples[i - 1].vz);
    maxSpike = Math.max(maxSpike, dv);
  }
  const last = samples[samples.length - 1];
  return {
    group: 'keybump-boundary', label,
    metrics: {
      vyKick: { value: round3(vyKick), threshold: BOUNDARY_MAX_VY_KICK, pass: vyKick <= BOUNDARY_MAX_VY_KICK },
    },
    diagnostics: {
      seatZ: round3(loc.crossing),
      seatSlope: round3(loc.slope),
      maxHorizontalDvPerTick: round3(maxSpike),
      finalZ: round3(last.z),
      finalVz: round3(last.vz),
    },
    spawn: { x: 0, z: round3(spawnZ), vx: 0, vz: 4.0 * dir, gapAboveSurface: SPAWN_GAP },
  };
}

function round3(v) { return Math.round(v * 1000) / 1000; }

// ═══ MAIN ═══

async function main() {
  const envs = await buildWorld();
  const { probe, meshNames } = envs;

  const scenarios = [];
  // a) Channel mouths. N = negative z (hoop at z = -40).
  scenarios.push(mouthScenario(envs, +1, -1, 'NE'));
  scenarios.push(mouthScenario(envs, -1, -1, 'NW'));
  scenarios.push(mouthScenario(envs, +1, +1, 'SE'));
  scenarios.push(mouthScenario(envs, -1, +1, 'SW'));
  // b) Sideline seams.
  scenarios.push(seamScenario(envs, +1, 'E'));
  scenarios.push(seamScenario(envs, -1, 'W'));
  // c) KeyBump / scoring-circle boundaries.
  scenarios.push(boundaryScenario(envs, +1, 'S'));
  scenarios.push(boundaryScenario(envs, -1, 'N'));

  // ═══ REPORT ═══
  const rows = [];
  for (const sc of scenarios) {
    const parts = [];
    let pass = true;
    for (const [k, m] of Object.entries(sc.metrics)) {
      parts.push(`${k}=${m.value}/${m.threshold}${m.below ? '(<)' : '(<=)'}`);
      pass = pass && m.pass;
    }
    rows.push({ label: sc.label, group: sc.group, pass, detail: parts.join(' ') });
  }

  const allPass = rows.every((r) => r.pass);

  console.log('\nVALLEYBALL BALL-ROLL TERRAIN GATE');
  console.log(`colliders loaded: ${meshNames.join(', ')}`);
  console.log(`gravity: ${TUNING.physics.gravityY} m/s2, dt: ${DT}s, ball r=${BALL_RADIUS} rest=${BALL_RESTITUTION} fric=${BALL_FRICTION}`);
  console.log('');
  const w1 = 26, w2 = 34, w3 = 6;
  console.log(['SCENARIO'.padEnd(w1), 'MEASURED / THRESHOLD'.padEnd(w2), 'RESULT'].join(''));
  console.log('-'.repeat(w1 + w2 + w3));
  for (const r of rows) {
    console.log([r.label.padEnd(w1), r.detail.padEnd(w2), r.pass ? 'PASS' : 'FAIL'].join(''));
  }
  console.log('-'.repeat(w1 + w2 + w3));
  console.log(allPass ? 'ALL SCENARIOS PASS' : 'FAILURES PRESENT');
  console.log('');

  const report = {
    generatedBy: 'scripts/test_ball_roll.mjs',
    fixedDt: DT,
    gravityY: TUNING.physics.gravityY,
    colliders: meshNames,
    ball: {
      radius: BALL_RADIUS,
      restitution: BALL_RESTITUTION,
      restitutionCombine: 'Max',
      friction: BALL_FRICTION,
      frictionCombine: 'Min',
      linearDrag: BALL_DRAG_LINEAR,
      angularDrag: BALL_DRAG_ANGULAR,
    },
    spawnGapM: SPAWN_GAP,
    spawnGapNote:
      'Card spec says surface + 0.1m; a 0.1m free drop onto a 0.88-restitution ball ' +
      'rebounds at ~1.3 m/s and swamps the 0.50 m/s mouth threshold, so the ball ' +
      'spawns resting on the surface (0.02m). All measured vertical kicks are ' +
      'terrain-induced by construction.',
    allPass,
    scenarios,
  };
  const reportPath = path.join(ROOT, 'test_ball_roll_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`report: ${reportPath}`);

  probe.free();
  envs.sim.free();
  process.exitCode = allPass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('ball-roll gate crashed:', e);
    process.exitCode = 1;
  });
}
