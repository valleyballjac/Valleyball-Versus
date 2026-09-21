export const GENOME = {
  reactionDelayTicks:     { min: 0,   max: 20,  step: 1,    default: 4 },
  aimAccuracy:            { min: 0.3, max: 1.0, step: 0.05, default: 0.85 },
  interceptLeadFactor:    { min: 0.3, max: 1.2, step: 0.05, default: 0.95 },
  strikeTimingJitter:     { min: 0,   max: 10,  step: 1,    default: 2 },
  sprintUsage:            { min: 0.3, max: 1.0, step: 0.05, default: 0.85 },
  diveAccuracy:           { min: 0.0, max: 1.0, step: 0.05, default: 0.7 },
  spikeAccuracy:          { min: 0.0, max: 1.0, step: 0.05, default: 0.75 },
  defensiveAwareness:     { min: 0.2, max: 1.0, step: 0.05, default: 0.75 },
  strategyUpdateInterval: { min: 2,   max: 14,  step: 1,    default: 6 },
  positionOffset:         { min: 0.15, max: 0.6, step: 0.05, default: 0.3 },
  strikeRange:            { min: 1.2, max: 2.8, step: 0.1,  default: 2.0 },
  strikeHeightMin:        { min: -1.0, max: 0.2, step: 0.1, default: -0.5 },
  strikeHeightMax:        { min: 1.5, max: 4.5, step: 0.1,  default: 3.2 },
  chaseToPositionDist:    { min: 6.0, max: 20.0, step: 0.5, default: 12.0 },
  defenseDepth:           { min: 0.2, max: 0.8, step: 0.05, default: 0.45 },
  arriveRadiusChase:      { min: 0.5, max: 2.0, step: 0.1,  default: 0.9 },
  arriveRadiusPosition:   { min: 0.2, max: 0.8, step: 0.05, default: 0.5 },
  arriveRadiusStrike:     { min: 0.1, max: 0.5, step: 0.05, default: 0.25 },
  jumpHeightThreshold:    { min: 0.8, max: 3.0, step: 0.1,  default: 1.8 },
  diveDistMin:            { min: 1.2, max: 3.5, step: 0.1,  default: 2.0 },
  diveDistMax:            { min: 3.5, max: 7.0, step: 0.1,  default: 4.8 },
};

function quantize(value, min, max, step) {
    let clamped = Math.max(min, Math.min(max, value));
    let steps = Math.round((clamped - min) / step);
    let quantized = min + steps * step;
    return Math.round(quantized * 10000) / 10000;
}

export function createDefaultGenome() {
    const genome = {};
    for (const key in GENOME) {
        genome[key] = GENOME[key].default;
    }
    return genome;
}

export function createRandomGenome(rng) {
    const genome = {};
    for (const key in GENOME) {
        const def = GENOME[key];
        const val = def.min + rng() * (def.max - def.min);
        genome[key] = quantize(val, def.min, def.max, def.step);
    }
    return genome;
}

export function mutateGenome(genome, rng, mutationRate = 0.3, mutationStrength = 0.2) {
    const mutated = {};
    for (const key in GENOME) {
        let val = genome[key];
        if (rng() < mutationRate) {
            const def = GENOME[key];
            const u1 = Math.max(1e-10, rng());
            const u2 = rng();
            const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            val += z0 * mutationStrength * (def.max - def.min);
        }
        const def = GENOME[key];
        mutated[key] = quantize(val, def.min, def.max, def.step);
    }
    return mutated;
}

export function crossoverGenomes(genomeA, genomeB, rng) {
    const child = {};
    for (const key in GENOME) {
        child[key] = rng() < 0.5 ? genomeA[key] : genomeB[key];
    }
    return child;
}

export function createPopulation(size, rng, baseGenome = null) {
    const pop = [];
    const base = baseGenome || createDefaultGenome();
    pop.push(base);
    for (let i = 1; i < size; i++) {
        pop.push(mutateGenome(base, rng, 0.5, 0.3)); // Higher mutation for initial spread
    }
    return pop;
}

export function selectElites(population, fitnesses, eliteCount) {
    const combined = population.map((genome, index) => ({ genome, fitness: fitnesses[index] }));
    combined.sort((a, b) => b.fitness - a.fitness);
    return combined.slice(0, eliteCount);
}

export function nextGeneration(elites, populationSize, rng, mutationRate = 0.3, mutationStrength = 0.2) {
    const nextGen = [];
    
    // Elitism: Preserve all elites as-is
    for (const elite of elites) {
        nextGen.push({ ...elite.genome });
    }

    while (nextGen.length < populationSize) {
        if (rng() < 0.3 && elites.length > 1) {
            const parent1 = elites[Math.floor(rng() * elites.length)].genome;
            const parent2 = elites[Math.floor(rng() * elites.length)].genome;
            const child = crossoverGenomes(parent1, parent2, rng);
            nextGen.push(mutateGenome(child, rng, mutationRate, mutationStrength));
        } else {
            const parent = elites[Math.floor(rng() * elites.length)].genome;
            nextGen.push(mutateGenome(parent, rng, mutationRate, mutationStrength));
        }
    }
    
    return nextGen;
}

export function formatGenome(genome) {
    return Object.entries(genome)
        .map(([key, val]) => `${key}: ${val}`)
        .join(', ');
}

export function genomeToTuningParams(genome) {
    return { ...genome };
}

export function createRNG(seed) {
    let state = seed >>> 0;
    if (state === 0) state = 1;
    return function() {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state = state >>> 0;
        return (state / 4294967296);
    };
}
