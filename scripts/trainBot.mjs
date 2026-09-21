#!/usr/bin/env node
/**
 * EVOLUTIONARY AI TRAINING — CLI entry point.
 *
 * Runs headless bot-vs-bot matches to optimize AI parameters through
 * evolutionary search. No browser, no rendering — pure physics simulation.
 *
 * Usage:
 *   node scripts/trainBot.mjs [options]
 *
 * Options:
 *   --generations N    Number of evolution generations (default: 30)
 *   --population N     Population size per generation (default: 16)
 *   --matches N        Matches per evaluation for statistical significance (default: 3)
 *   --duration N       Match duration in seconds (default: 120)
 *   --elites N         Number of elite genomes to preserve (default: 4)
 *   --mutationRate F   Probability of mutating each gene (default: 0.35)
 *   --mutationStrength F  Strength of mutations (default: 0.25)
 *   --seed N           Random seed for reproducibility (default: 12345)
 *   --output FILE      Output file for best parameters (default: trained_params.json)
 *   --mode MODE        'self-play' or 'vs-baseline' (default: vs-baseline)
 *   --verbose          Print per-match details
 */

import { initHeadless, createHeadlessMatch, runHeadlessMatch, destroyHeadlessMatch } from '../src/ai/headlessSim.js';
import { createFitnessAccumulator, accumulateTick, computeFitness } from '../src/ai/fitnessFunction.js';
import {
  createRNG, createDefaultGenome, createPopulation,
  selectElites, nextGeneration, formatGenome, genomeToTuningParams,
} from '../src/ai/evolutionarySearch.js';

import { writeFileSync } from 'fs';
import { resolve } from 'path';

// ═══ CLI ARGUMENT PARSING ═══
function parseArgs(args) {
  const opts = {
    generations: 30,
    population: 16,
    matches: 3,
    duration: 120,
    elites: 4,
    mutationRate: 0.35,
    mutationStrength: 0.25,
    seed: 12345,
    output: 'trained_params.json',
    mode: 'vs-baseline',
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--verbose') { opts.verbose = true; continue; }
    const val = args[i + 1];
    switch (arg) {
      case '--generations': opts.generations = parseInt(val); i++; break;
      case '--population': opts.population = parseInt(val); i++; break;
      case '--matches': opts.matches = parseInt(val); i++; break;
      case '--duration': opts.duration = parseInt(val); i++; break;
      case '--elites': opts.elites = parseInt(val); i++; break;
      case '--mutationRate': opts.mutationRate = parseFloat(val); i++; break;
      case '--mutationStrength': opts.mutationStrength = parseFloat(val); i++; break;
      case '--seed': opts.seed = parseInt(val); i++; break;
      case '--output': opts.output = val; i++; break;
      case '--mode': opts.mode = val; i++; break;
    }
  }
  return opts;
}

// ═══ EVALUATE A PARAMETER SET ═══
async function evaluateGenome(genome, opts, rng, baselineGenome) {
  const matchTicks = opts.duration * 60;
  let totalFitness = 0;
  const breakdowns = [];

  for (let m = 0; m < opts.matches; m++) {
    const seedA = Math.floor(rng() * 1000000);
    const seedB = Math.floor(rng() * 1000000);

    const paramsA = genome;  // Candidate
    const paramsB = opts.mode === 'self-play' ? genome : baselineGenome;

    const match = createHeadlessMatch(paramsA, paramsB, {
      matchTicks,
      seedA,
      seedB,
    });

    // Create fitness accumulator for the candidate (player A = home)
    const acc = createFitnessAccumulator('home');

    runHeadlessMatch(match, (m) => accumulateTick(acc, m));

    const result = computeFitness(acc, match.matchState);
    totalFitness += result.fitness;
    breakdowns.push(result);

    destroyHeadlessMatch(match);
  }

  return {
    avgFitness: totalFitness / opts.matches,
    breakdowns,
  };
}

// ═══ MAIN TRAINING LOOP ═══
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         VALLEYBALL AI — EVOLUTIONARY TRAINING              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`  Generations:      ${opts.generations}`);
  console.log(`  Population:       ${opts.population}`);
  console.log(`  Matches/eval:     ${opts.matches}`);
  console.log(`  Match duration:   ${opts.duration}s (${opts.duration * 60} ticks)`);
  console.log(`  Elite count:      ${opts.elites}`);
  console.log(`  Mutation rate:    ${opts.mutationRate}`);
  console.log(`  Mutation strength:${opts.mutationStrength}`);
  console.log(`  Mode:             ${opts.mode}`);
  console.log(`  Seed:             ${opts.seed}`);
  console.log(`  Output:           ${opts.output}`);
  console.log();

  // Initialize Rapier WASM
  console.log('Initializing physics engine...');
  await initHeadless();
  console.log('Physics engine ready.\n');

  const rng = createRNG(opts.seed);
  const baselineGenome = genomeToTuningParams(createDefaultGenome());

  // Create initial population
  let population = createPopulation(opts.population, rng);

  let bestEverFitness = -Infinity;
  let bestEverGenome = null;

  for (let gen = 0; gen < opts.generations; gen++) {
    const genStart = Date.now();
    const fitnesses = [];

    console.log(`── Generation ${gen + 1}/${opts.generations} ──`);

    // Evaluate each genome
    for (let i = 0; i < population.length; i++) {
      const genome = genomeToTuningParams(population[i]);
      const result = await evaluateGenome(genome, opts, rng, baselineGenome);
      fitnesses.push(result.avgFitness);

      if (opts.verbose) {
        const bd = result.breakdowns[0]?.breakdown;
        console.log(
          `  [${String(i).padStart(2)}] fitness: ${result.avgFitness.toFixed(1).padStart(7)} ` +
          `(goals: ${bd?.goals ?? 0}, hits: ${bd?.strikesLanded ?? 0}, onTarget: ${bd?.onTarget ?? 0}, whiffs: ${bd?.whiffs ?? 0})`,
        );
      }
    }

    // Select elites
    const elites = selectElites(population, fitnesses, opts.elites);
    const bestFitness = elites[0].fitness;
    const bestGenome = elites[0].genome;

    if (bestFitness > bestEverFitness) {
      bestEverFitness = bestFitness;
      bestEverGenome = { ...bestGenome };
    }

    const avgFitness = fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length;
    const elapsed = ((Date.now() - genStart) / 1000).toFixed(1);

    console.log(
      `  Best: ${bestFitness.toFixed(1)} | Avg: ${avgFitness.toFixed(1)} | ` +
      `All-time best: ${bestEverFitness.toFixed(1)} | ${elapsed}s`,
    );

    // Evolve next generation (unless this is the last)
    if (gen < opts.generations - 1) {
      population = nextGeneration(
        elites,
        opts.population,
        rng,
        opts.mutationRate,
        opts.mutationStrength,
      );
    }
  }

  // ═══ OUTPUT RESULTS ═══
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    TRAINING COMPLETE                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log(`Best fitness: ${bestEverFitness.toFixed(2)}\n`);
  console.log('Best parameters:');
  console.log(formatGenome(bestEverGenome));

  // Write results
  const tuningParams = genomeToTuningParams(bestEverGenome);
  const outputData = {
    fitness: bestEverFitness,
    genome: bestEverGenome,
    tuningParams,
    trainingConfig: opts,
    timestamp: new Date().toISOString(),
  };

  const outputPath = resolve(process.cwd(), opts.output);
  writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`\nResults written to: ${outputPath}`);

  console.log('\nTo apply these parameters, copy the "tuningParams" object');
  console.log('into TUNING.ai.hard (or create a new difficulty level) in');
  console.log('src/config/tuning.js');
}

main().catch((err) => {
  console.error('Training failed:', err);
  process.exit(1);
});
