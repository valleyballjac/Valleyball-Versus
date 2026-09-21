#!/usr/bin/env node
/**
 * VALLEYBALL MATCH ANALYTICS EVALUATOR
 *
 * Runs simulated matches between AI bots and outputs a structured analytics
 * box score with efficiency ratios (diving save rate, sweet-spot accuracy,
 * circle dominance, and strike conversion).
 *
 * Usage:
 *   node scripts/evalMatch.mjs [options]
 *
 * Options:
 *   --duration N       Match duration in seconds (default: 60)
 *   --homeDiff DIFF    'easy' | 'medium' | 'hard' (default: hard)
 *   --awayDiff DIFF    'easy' | 'medium' | 'hard' (default: hard)
 *   --seed N           Random seed (default: 42)
 *   --matches N        Number of matches to average (default: 1)
 */

import { initHeadless, createHeadlessMatch, runHeadlessMatch, destroyHeadlessMatch } from '../src/ai/headlessSim.js';
import { createFitnessAccumulator, accumulateTick, computeFitness } from '../src/ai/fitnessFunction.js';
import { TUNING } from '../src/config/tuning.js';

function parseArgs(args) {
  const opts = {
    duration: 60,
    homeDiff: 'hard',
    awayDiff: 'hard',
    seed: 42,
    matches: 1,
    ball: 'medium',
    aggA: 0.60,
    aggB: 0.60,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const val = args[i + 1];
    switch (arg) {
      case '--duration': opts.duration = parseInt(val, 10); i++; break;
      case '--homeDiff': opts.homeDiff = val; i++; break;
      case '--awayDiff': opts.awayDiff = val; i++; break;
      case '--seed': opts.seed = parseInt(val, 10); i++; break;
      case '--matches': opts.matches = parseInt(val, 10); i++; break;
      case '--ball': opts.ball = val; i++; break;
      case '--aggA': opts.aggA = parseFloat(val); i++; break;
      case '--aggB': opts.aggB = parseFloat(val); i++; break;
    }
  }
  return opts;
}

function formatPercent(num, denom) {
  if (!denom || denom === 0) return '  0.0%';
  const pct = (num / denom) * 100;
  return `${pct.toFixed(1)}%`.padStart(6);
}

async function runEval() {
  const opts = parseArgs(process.argv.slice(2));

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║           VALLEYBALL MATCH ANALYTICS & STATS EVALUATOR           ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  Duration: ${opts.duration}s (${opts.duration * 60} ticks) | Matches: ${opts.matches}`);
  console.log(`  Ball: ${opts.ball.toUpperCase()} | Aggressiveness: P1=${opts.aggA.toFixed(2)} vs P2=${opts.aggB.toFixed(2)}`);
  console.log(`  Home: ${opts.homeDiff.toUpperCase()} AI  vs  Away: ${opts.awayDiff.toUpperCase()} AI`);
  console.log(`  Seed: ${opts.seed}\n`);

  await initHeadless();

  const homeTotals = {
    goals: 0,
    ownGoals: 0,
    strikesLanded: 0,
    spikes: 0,
    volleys: 0,
    sweetSpotHits: 0,
    whiffs: 0,
    onTarget: 0,
    dives: 0,
    divingHits: 0,
    oppCircle: 0,
    ownCircle: 0,
    defBlocks: 0,
    fitness: 0,
  };

  const awayTotals = {
    goals: 0,
    ownGoals: 0,
    strikesLanded: 0,
    spikes: 0,
    volleys: 0,
    sweetSpotHits: 0,
    whiffs: 0,
    onTarget: 0,
    dives: 0,
    divingHits: 0,
    oppCircle: 0,
    ownCircle: 0,
    defBlocks: 0,
    fitness: 0,
  };

  const homeParams = TUNING.ai?.[opts.homeDiff] || null;
  const awayParams = TUNING.ai?.[opts.awayDiff] || null;

  for (let m = 0; m < opts.matches; m++) {
    const matchSeed = opts.seed + m * 100;
    const match = createHeadlessMatch(homeParams, awayParams, {
      matchTicks: opts.duration * 60,
      seedA: matchSeed,
      seedB: matchSeed + 1,
      ballType: opts.ball,
      homeDiff: opts.homeDiff,
      awayDiff: opts.awayDiff,
      aggressivenessA: opts.aggA,
      aggressivenessB: opts.aggB,
    });

    const accHome = createFitnessAccumulator('home');
    const accAway = createFitnessAccumulator('away');

    runHeadlessMatch(match, (mObj) => {
      accumulateTick(accHome, mObj);
      accumulateTick(accAway, mObj);
    });

    const resHome = computeFitness(accHome, match.matchState);
    const resAway = computeFitness(accAway, match.matchState);

    // Track strike kinds
    for (const hit of (match.lastHits || [])) {
      if (hit.side === 'home') {
        if (hit.kind === 'spike') homeTotals.spikes++;
        else if (hit.kind === 'volley') homeTotals.volleys++;
      } else {
        if (hit.kind === 'spike') awayTotals.spikes++;
        else if (hit.kind === 'volley') awayTotals.volleys++;
      }
    }

    // Track own goals
    for (const ev of (match.matchState.events || [])) {
      const priorHits = (match.lastHits || []).filter(h => h.tick <= ev.tick);
      const lastHit = priorHits[priorHits.length - 1];
      if (lastHit && lastHit.side !== ev.scoredFor) {
        if (lastHit.side === 'home') homeTotals.ownGoals++;
        else awayTotals.ownGoals++;
      }
    }

    // Accumulate
    homeTotals.goals += resHome.breakdown.goals;
    homeTotals.strikesLanded += resHome.breakdown.strikesLanded;
    homeTotals.sweetSpotHits += resHome.breakdown.sweetSpotHits || 0;
    homeTotals.whiffs += resHome.breakdown.whiffs;
    homeTotals.onTarget += resHome.breakdown.onTarget;
    homeTotals.dives += resHome.breakdown.divesAttempted || 0;
    homeTotals.divingHits += resHome.breakdown.divingHits || 0;
    homeTotals.oppCircle += resHome.breakdown.oppCircleTouches || 0;
    homeTotals.ownCircle += resHome.breakdown.ownCircleTouches || 0;
    homeTotals.fitness += resHome.fitness;

    awayTotals.goals += resAway.breakdown.goals;
    awayTotals.strikesLanded += resAway.breakdown.strikesLanded;
    awayTotals.sweetSpotHits += resAway.breakdown.sweetSpotHits || 0;
    awayTotals.whiffs += resAway.breakdown.whiffs;
    awayTotals.onTarget += resAway.breakdown.onTarget;
    awayTotals.dives += resAway.breakdown.divesAttempted || 0;
    awayTotals.divingHits += resAway.breakdown.divingHits || 0;
    awayTotals.oppCircle += resAway.breakdown.oppCircleTouches || 0;
    awayTotals.ownCircle += resAway.breakdown.ownCircleTouches || 0;
    awayTotals.fitness += resAway.fitness;

    destroyHeadlessMatch(match);
  }

  const N = opts.matches;
  const avg = (tot) => (tot / N).toFixed(1);

  console.log('┌─────────────────────────────────────┬──────────────┬──────────────┐');
  console.log('│ METRIC                              │ HOME (P1)    │ AWAY (P2)    │');
  console.log('├─────────────────────────────────────┼──────────────┼──────────────┤');
  console.log(`│ Score (Goals)                       │ ${String(avg(homeTotals.goals)).padStart(12)} │ ${String(avg(awayTotals.goals)).padStart(12)} │`);
  console.log(`│ Own Goals Conceded                  │ ${String(avg(homeTotals.ownGoals)).padStart(12)} │ ${String(avg(awayTotals.ownGoals)).padStart(12)} │`);
  console.log(`│ Strikes Landed (Total)              │ ${String(avg(homeTotals.strikesLanded)).padStart(12)} │ ${String(avg(awayTotals.strikesLanded)).padStart(12)} │`);
  console.log(`│   └─ Aerial Spikes                  │ ${String(avg(homeTotals.spikes)).padStart(12)} │ ${String(avg(awayTotals.spikes)).padStart(12)} │`);
  console.log(`│   └─ Volleys                        │ ${String(avg(homeTotals.volleys)).padStart(12)} │ ${String(avg(awayTotals.volleys)).padStart(12)} │`);
  console.log(`│ Whiffs (Missed Swings)              │ ${String(avg(homeTotals.whiffs)).padStart(12)} │ ${String(avg(awayTotals.whiffs)).padStart(12)} │`);
  const homeAcc = formatPercent(homeTotals.strikesLanded, homeTotals.strikesLanded + homeTotals.whiffs);
  const awayAcc = formatPercent(awayTotals.strikesLanded, awayTotals.strikesLanded + awayTotals.whiffs);
  console.log(`│ Strike Accuracy %                   │ ${homeAcc.padStart(12)} │ ${awayAcc.padStart(12)} │`);
  console.log(`│ Sweet Spot Hits (Clean Power)       │ ${String(avg(homeTotals.sweetSpotHits)).padStart(12)} │ ${String(avg(awayTotals.sweetSpotHits)).padStart(12)} │`);
  const homeSweetPct = formatPercent(homeTotals.sweetSpotHits, homeTotals.strikesLanded);
  const awaySweetPct = formatPercent(awayTotals.sweetSpotHits, awayTotals.strikesLanded);
  console.log(`│ Sweet Spot Conversion %             │ ${homeSweetPct.padStart(12)} │ ${awaySweetPct.padStart(12)} │`);
  console.log(`│ On-Target Shots                     │ ${String(avg(homeTotals.onTarget)).padStart(12)} │ ${String(avg(awayTotals.onTarget)).padStart(12)} │`);
  console.log('├─────────────────────────────────────┼──────────────┼──────────────┤');
  console.log(`│ Ground Dives Attempted              │ ${String(avg(homeTotals.dives)).padStart(12)} │ ${String(avg(awayTotals.dives)).padStart(12)} │`);
  console.log(`│ Diving Hits (Saves)                 │ ${String(avg(homeTotals.divingHits)).padStart(12)} │ ${String(avg(awayTotals.divingHits)).padStart(12)} │`);
  const homeDiveEff = formatPercent(homeTotals.divingHits, homeTotals.dives);
  const awayDiveEff = formatPercent(awayTotals.divingHits, awayTotals.dives);
  console.log(`│ Diving Save Efficiency %            │ ${homeDiveEff.padStart(12)} │ ${awayDiveEff.padStart(12)} │`);
  console.log('├─────────────────────────────────────┼──────────────┼──────────────┤');
  console.log(`│ Opp Circle Touches (Attack Threat)  │ ${String(avg(homeTotals.oppCircle)).padStart(12)} │ ${String(avg(awayTotals.oppCircle)).padStart(12)} │`);
  console.log(`│ Own Circle Touches (Defensive Hold) │ ${String(avg(homeTotals.ownCircle)).padStart(12)} │ ${String(avg(awayTotals.ownCircle)).padStart(12)} │`);
  console.log(`│ Overall Performance Fitness         │ ${String(avg(homeTotals.fitness)).padStart(12)} │ ${String(avg(awayTotals.fitness)).padStart(12)} │`);
  console.log('└─────────────────────────────────────┴──────────────┴──────────────┘\n');
}

runEval().catch(err => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});
