#!/usr/bin/env node
/**
 * MOVEMENT FEEL AUDIT REPORT
 *
 * Runs the `movement-feel` trace scenario and produces a structured markdown
 * report of locomotion metrics, with critical feedback and tuning suggestions.
 *
 * Usage:
 *   node scripts/feelReport.mjs             # print report to stdout
 *   node scripts/feelReport.mjs --json      # print metrics JSON
 *   node scripts/feelReport.mjs --out report.md
 */

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runTraceFacts() {
  return new Promise((resolve, reject) => {
    const cp = spawn('node', ['scripts/trace.mjs', '--name', 'movement-feel', '--runs', '1', '--facts', '--quiet'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    cp.stdout.on('data', (d) => { stdout += d.toString(); });
    cp.stderr.on('data', (d) => { stderr += d.toString(); });
    cp.on('error', (e) => reject(e));
    cp.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        return reject(new Error(`trace exited ${code}\n${stderr}`));
      }
      resolve(stdout);
    });
  });
}

function parseFacts(stdout) {
  const lines = stdout.split('\n');
  const start = lines.findIndex((l) => l.includes('facts (run A):'));
  if (start === -1) throw new Error('trace did not emit facts block');
  const factLines = lines.slice(start + 1).filter((l) => {
    const t = l.trim();
    return t.startsWith('{') && t.endsWith('}');
  });
  return factLines.map((l) => JSON.parse(l.trim()));
}

function windowFacts(facts, from, to) {
  return facts.filter((f) => f.tick >= from && f.tick <= to);
}

function round(n) {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n;
}

function maxIn(facts, key) {
  return Math.max(0, ...facts.map((f) => f[key] ?? 0));
}
function avgIn(facts, key) {
  if (!facts.length) return 0;
  return facts.reduce((s, f) => s + (f[key] ?? 0), 0) / facts.length;
}

function timeToThreshold(facts, threshold, afterTick, key = 'speed') {
  const start = facts.find((f) => f.tick >= afterTick);
  if (!start) return null;
  const hit = facts.find((f) => f.tick > start.tick && (f[key] ?? 0) >= threshold);
  return hit ? (hit.tick - start.tick) / 60 : null;
}

function timeFromReleaseToStop(facts, releaseTick, stopThreshold = 0.3) {
  const start = facts.find((f) => f.tick >= releaseTick);
  if (!start) return null;
  const hit = facts.find((f) => f.tick > start.tick && f.speed <= stopThreshold);
  return hit ? (hit.tick - start.tick) / 60 : null;
}

function jumpMetrics(facts, jumpTick) {
  // Find the contiguous airborne segment that STARTS at or after jumpTick.
  const startIdx = facts.findIndex((f) => f.tick >= jumpTick && !f.grounded);
  if (startIdx === -1) return null;
  const airborne = [];
  for (let i = startIdx; i < facts.length; i++) {
    if (facts[i].grounded) break;
    airborne.push(facts[i]);
  }
  if (!airborne.length) return null;
  const apex = airborne.reduce((a, f) => (f.y > a.y ? f : a), airborne[0]);
  const launch = airborne[0];
  const landingTick = airborne[airborne.length - 1].tick;
  return {
    launchSpeed: round(launch.speed),
    apexHeight: round(apex.y),
    apexTick: apex.tick,
    airTime: round((landingTick - launch.tick) / 60),
    landingTick,
  };
}

function reversalLag(facts, inputFlipTick) {
  const before = facts.filter((f) => f.tick >= inputFlipTick - 30 && f.tick < inputFlipTick);
  const beforeSpeed = before.length ? avgIn(before.slice(-5), 'speed') : 0;
  const after = facts.filter((f) => f.tick >= inputFlipTick);
  if (!after.length) return null;
  const target = beforeSpeed * 0.5;
  const hit = after.find((f) => f.tick > inputFlipTick + 5 && f.speed >= target);
  return hit ? (hit.tick - inputFlipTick) / 60 : null;
}

function gradeTopSpeed(s, minOk, good) {
  if (s >= good) return 'A';
  if (s >= minOk) return 'B';
  return s >= minOk * 0.7 ? 'C' : 'D';
}
function gradeStop(t, good = 0.6, ok = 1.0, loose = 2.0) {
  if (t <= good) return 'A';
  if (t <= ok) return 'B';
  if (t <= loose) return 'C';
  return 'D';
}
function gradeReversal(t, good = 0.45, ok = 0.65, loose = 0.90) {
  if (t <= good) return 'A';
  if (t <= ok) return 'B';
  if (t <= loose) return 'C';
  return 'D';
}

function buildReport(facts) {
  const walk = windowFacts(facts, 200, 230);
  const run = windowFacts(facts, 320, 350);
  const sprint = windowFacts(facts, 460, 490);
  const coast = windowFacts(facts, 490, 700);

  const walkTop = round(maxIn(walk, 'speed'));
  const runTop = round(maxIn(run, 'speed'));
  const sprintTop = round(maxIn(sprint, 'speed'));

  const accelWalk = timeToThreshold(facts, walkTop * 0.9, 70);
  const accelRun = timeToThreshold(facts, runTop * 0.9, 270);
  const accelSprint = timeToThreshold(facts, sprintTop * 0.9, 390);
  const stopTime = round(timeFromReleaseToStop(coast, 490, 0.3));
  const stopDist = (() => {
    const start = coast.find((f) => f.tick >= 490);
    const end = coast.find((f) => f.tick > 490 && f.speed <= 0.3);
    if (!start || !end) return null;
    return Math.abs(end.z - start.z);
  })();
  const revLag = round(reversalLag(facts, 760));
  const backwardSpeed = round(avgIn(windowFacts(facts, 780, 840), 'speed'));

  const jumpStand = jumpMetrics(facts, 900);
  const jumpRun = jumpMetrics(facts, 1000);

  const gait = {
    walkTop,
    walkAvg: round(avgIn(walk, 'speed')),
    accelWalk: round(accelWalk),
    runTop,
    runAvg: round(avgIn(run, 'speed')),
    accelRun: round(accelRun),
    sprintTop,
    sprintAvg: round(avgIn(sprint, 'speed')),
    accelSprint: round(accelSprint),
  };
  const braking = { stopTime, stopDistance: round(stopDist) };
  const reversal = { recoveryLag: revLag, backwardSpeed };
  const jumps = { stand: jumpStand, running: jumpRun };
  const grades = {
    walkFeel: gradeTopSpeed(walkTop, 1.8, 2.3),
    runFeel: gradeTopSpeed(runTop, 3.5, 4.5),
    sprintFeel: gradeTopSpeed(sprintTop, 5.5, 6.5),
    stopFeel: gradeStop(stopTime),
    reversalFeel: gradeReversal(revLag),
  };

  return { gait, braking, reversal, jumps, grades };
}

function critical(report) {
  const notes = [];
  const g = report.grades;
  const { gait, braking, reversal, jumps } = report;

  if (g.walkFeel !== 'A') {
    notes.push(`- **Walk is sluggish.** Top speed is only ${gait.walkTop} m/s across the 50-tick walk window. For a deliberate but responsive walk, aim for 1.8-2.3 m/s. Light stick input is barely registering; the magnitude curve or \`driveTorque\` is too soft at low authority.`);
  }
  if (g.runFeel !== 'A') {
    notes.push(`- **Run feel is serviceable but not athletic.** Top run speed is ${gait.runTop} m/s. It sits at the low edge of the intended 4.0-5.0 m/s pocket. A small drive-torque bump would move it from "jog" to "run" without touching sprint.`);
  }
  if (g.sprintFeel === 'A') {
    notes.push(`- **Sprint is strong.** Top reached ${gait.sprintTop} m/s with an average of ${gait.sprintAvg} m/s, above the ${gait.sprintTop >= 6.5 ? 6.5 : 5.5} m/s bar. Keep the current cap and resistance balance.`);
  } else if (g.sprintFeel === 'B') {
    notes.push(`- **Sprint is good but not elite.** Top reached ${gait.sprintTop} m/s. That clears the minimum 5.5 m/s target but misses the 6.5 m/s A-grade. For more burst, raise \`maxAngularSpeed\` or trim \`rollingResistance\` slightly.`);
  } else {
    notes.push(`- **Sprint does not pop.** Capped at ${gait.sprintTop} m/s, below the 5.5 m/s target. Check \`rollingResistance\`, \`driveTorque\`, and \`sprintTurnAuthority\`; too much lateral bleed or resistance can starve forward acceleration.`);
  }
  if (g.stopFeel !== 'A') {
    notes.push(`- **Braking is too loose.** From sprint release, it takes ${braking.stopTime} s and ${braking.stopDistance} m to drop below 0.3 m/s. Under 0.6 s reads crisp; this feels like sliding on ice. Raise \`brakeTorque\` or \`rollingResistance\` moderately.`);
  } else {
    notes.push(`- **Braking feels planted.** Stop time ${braking.stopTime} s over ${braking.stopDistance} m.`);
  }
  if (g.reversalFeel !== 'A') {
    notes.push(`- **Reversal lacks athletic snap.** After a full stick flip at sprint speed, it takes ${reversal.recoveryLag} s to recover meaningful momentum. A plant-and-pivot should snap in under 0.45 s. Consider sharpening \`reversalBiteTime\` or increasing counter-braking impulse.`);
  } else {
    notes.push(`- **Reversal snaps.** Recovery in ${reversal.recoveryLag} s.`);
  }

  if (!jumps.stand || !Number.isFinite(jumps.stand.airTime)) {
    notes.push('- **Jump data missing or invalid.** The in-place jump did not register a clean airborne window; verify the jump cooldown and grounded gate.');
  } else {
    notes.push(`- **Jump arc is athletic.** In-place apex ${jumps.stand.apexHeight} m, air time ${jumps.stand.airTime} s. Running jump preserves ${jumps.running.launchSpeed} m/s horizontal, which rewards momentum.`);
  }

  if (!notes.length) return '- All measured movement grades are A. No critical issues detected by the audit.';
  return notes.join('\n');
}

function toMarkdown(report) {
  const g = report.grades;
  const j = report.jumps;

  return `# Movement Feel Audit Report

Generated from deterministic trace scenario \`movement-feel\` on the Valley Court, v0.3.0 (main).

## Verdict (letter grades)

- Walk feel: **${g.walkFeel}**
- Run feel: **${g.runFeel}**
- Sprint feel: **${g.sprintFeel}**
- Stopping feel: **${g.stopFeel}**
- Reversal feel: **${g.reversalFeel}**

## Speed by gait

| Gait | Top speed (m/s) | Average (m/s) | Time to 90% peak (s) |
|------|----------------:|--------------:|---------------------:|
| Walk | ${report.gait.walkTop} | ${report.gait.walkAvg} | ${report.gait.accelWalk} |
| Run | ${report.gait.runTop} | ${report.gait.runAvg} | ${report.gait.accelRun} |
| Sprint | ${report.gait.sprintTop} | ${report.gait.sprintAvg} | ${report.gait.accelSprint} |

## Braking (release at sprint end, tick 490)

- Time to sub-0.3 m/s: **${report.braking.stopTime} s**
- Distance travelled while stopping: **${report.braking.stopDistance} m**

## Reversal (stick flips at tick 760)

- Time to recover meaningful new-direction speed: **${report.reversal.recoveryLag} s**
- Average speed during reversal window: **${report.reversal.backwardSpeed} m/s**

## Jumps

| Type | Launch speed (m/s) | Apex height (m) | Air time (s) |
|------|-------------------:|----------------:|-------------:|
| In-place | ${j.stand?.launchSpeed ?? '-'} | ${j.stand?.apexHeight ?? '-'} | ${j.stand?.airTime ?? '-'} |
| Running | ${j.running?.launchSpeed ?? '-'} | ${j.running?.apexHeight ?? '-'} | ${j.running?.airTime ?? '-'} |

## Critical feedback

${critical(report)}

## Suggested knobs

- Walk/run differentiation: \`TUNING.motor.driveTorque\` and the stick magnitude curve in \`inputRouter.js\`
- Sprint ceiling: \`TUNING.motor.maxAngularSpeed\`, \`TUNING.motor.rollingResistance\`
- Stop crunch: \`TUNING.motor.brakeTorque\` and \`TUNING.motor.rollingResistance\`
- Reversal snap: \`TUNING.motor.reversalBiteTime\`
- Jump arc: \`TUNING.jump.impulse\`, \`TUNING.physics.gravityY\`, \`TUNING.jump.fallGravityMultiplier\`

## How to reproduce

\`\`\`bash
git checkout card/blue-motor-authority-review
npm ci --ignore-scripts
node scripts/feelReport.mjs
\`\`\`
`;
}

async function main() {
  const stdout = await runTraceFacts();
  const facts = parseFacts(stdout);
  const report = buildReport(facts);

  const jsonFlag = process.argv.includes('--json');
  const outIdx = process.argv.indexOf('--out');
  const outPath = outIdx > -1 ? process.argv[outIdx + 1] : null;

  if (jsonFlag) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const md = toMarkdown(report);
  if (outPath) {
    const target = path.resolve(ROOT, outPath);
    await writeFile(target, md);
    console.log(`Report written to ${target}`);
  } else {
    console.log(md);
  }
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
