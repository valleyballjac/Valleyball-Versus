import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE_PORT = 5190;
const OUT_DIR = path.join(ROOT, 'captures', '2v2_harvest');

const COLORS = [
  { name: 'Crimson', hex: '#FF2A42' },
  { name: 'Azure', hex: '#1F65FF' },
  { name: 'Gold', hex: '#FFD000' },
  { name: 'Emerald', hex: '#10E56A' },
  { name: 'Violet', hex: '#6B11FF' },
  { name: 'Orange', hex: '#FF6B00' },
  { name: 'Cyan', hex: '#00E5FF' },
  { name: 'Magenta', hex: '#E000B8' },
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Obsidian', hex: '#22252A' },
];

const PHYSIQUES = ['classic', 'masculine', 'feminine'];

const HEADWEAR = [
  'wrestler_bands',
  'wicket_grill',
  'captain_visor',
  'ram_horns',
  'chullo_cap',
  'beret',
  'toki_crest',
  'floral_crown',
  'courier_cap',
  'hachimaki',
];

const BALLS = ['large', 'medium', 'small'];

function generateConfigs(seed) {
  // Deterministic pseudo-random choice from seed
  let s = (seed * 1664525 + 1013904223) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const ball = BALLS[seed % BALLS.length];
  const shuffledColors = [...COLORS].sort(() => rand() - 0.5);
  const shuffledHeadwear = [...HEADWEAR].sort(() => rand() - 0.5);

  const configs = [
    // Team 1 (Home)
    {
      team: 'home',
      type: 'ai',
      difficulty: 'hard',
      aggressiveness: 0.70 + rand() * 0.25,
      name: `Home 1 (${shuffledColors[0].name})`,
      color: shuffledColors[0].hex,
      headwear: shuffledHeadwear[0],
      variant: PHYSIQUES[Math.floor(rand() * PHYSIQUES.length)],
    },
    // Team 2 (Away)
    {
      team: 'away',
      type: 'ai',
      difficulty: 'hard',
      aggressiveness: 0.70 + rand() * 0.25,
      name: `Away 1 (${shuffledColors[1].name})`,
      color: shuffledColors[1].hex,
      headwear: shuffledHeadwear[1],
      variant: PHYSIQUES[Math.floor(rand() * PHYSIQUES.length)],
    },
    // Team 1 (Home)
    {
      team: 'home',
      type: 'ai',
      difficulty: 'hard',
      aggressiveness: 0.65 + rand() * 0.25,
      name: `Home 2 (${shuffledColors[2].name})`,
      color: shuffledColors[2].hex,
      headwear: shuffledHeadwear[2],
      variant: PHYSIQUES[Math.floor(rand() * PHYSIQUES.length)],
    },
    // Team 2 (Away)
    {
      team: 'away',
      type: 'ai',
      difficulty: 'hard',
      aggressiveness: 0.65 + rand() * 0.25,
      name: `Away 2 (${shuffledColors[3].name})`,
      color: shuffledColors[3].hex,
      headwear: shuffledHeadwear[3],
      variant: PHYSIQUES[Math.floor(rand() * PHYSIQUES.length)],
    },
  ];

  return { seed, ball, configs };
}

async function runMiner() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[2v2-miner] Launching Vite on port ${VITE_PORT}...`);
  const viteServer = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.js'),
    logLevel: 'error',
    server: { port: VITE_PORT, strictPort: true },
  });
  await viteServer.listen();

  console.log('[2v2-miner] Launching Headless Chromium with D3D11 acceleration...');
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: [
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-gpu-rasterization',
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--window-size=1920,1080',
    ],
  });

  const TOTAL_SEEDS = 30; // 30 comprehensive 2v2 matches
  const MATCH_TICKS = 3600; // 60s of gameplay per match
  const results = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();

    console.log('[2v2-miner] Booting game...');
    await page.goto(`http://localhost:${VITE_PORT}/Valleyball-Versus/`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => !!window.__vb?.startMatch, null, { timeout: 15000 });

    console.log(`[2v2-miner] Starting Fast-Mining Loop across ${TOTAL_SEEDS} seeds...`);

    for (let i = 1; i <= TOTAL_SEEDS; i++) {
      const spec = generateConfigs(20261000 + i);
      process.stdout.write(`  Mining match ${i}/${TOTAL_SEEDS} [Seed ${spec.seed}, Ball: ${spec.ball}]... `);
      const startTime = Date.now();

      const stats = await page.evaluate(({ spec, ticks }) => {
        const vb = window.__vb;
        const loop = vb.loop;

        // Start match
        vb.startMatch(spec.configs, { ball: spec.ball, duration: 60 });
        vb.skipFlyover();

        const log = {
          spikes: 0,
          volleys: 0,
          kicks: 0,
          dives: 0,
          slides: 0,
          jumps: 0,
          maxBallSpeed: 0,
          rimScrambles: 0,
          caroms: 0,
          goals: 0,
        };

        const lastResolved = [0, 0, 0, 0];
        let lastB = null;

        // Run fast tick loop
        for (let t = 0; t < ticks; t++) {
          if (vb.lastMatchResult) break;

          // Step fixedUpdate & physics
          const fl = loop._frameListeners;
          for (let f = 0; f < fl.length; f++) fl[f]();
          const reg = loop.interpolated;
          for (let r = 0; r < reg.length; r++) reg[r].savePrevious();
          const steppedTick = loop.tick;
          loop._fixedUpdate(loop.fixedDt, steppedTick);
          loop.tick++;
          loop._notify(steppedTick);

          // Tally stats across all 4 athletes
          const activeBall = vb.balls?.[0];
          if (!activeBall) continue;
          const b = activeBall.body.translation();
          const v = activeBall.body.linvel();
          const speed = Math.hypot(v.x, v.y, v.z);
          if (speed > log.maxBallSpeed) log.maxBallSpeed = speed;

          // Rim scramble detection: athletes near ring (y ~ 10, z = +-40)
          let nearRimCount = 0;
          for (let a = 0; a < vb.athletes.length; a++) {
            const ath = vb.athletes[a];
            if (!ath?.motor?.body) continue;
            const ap = ath.motor.body.translation();
            const dN = Math.hypot(ap.x, ap.y - 10, ap.z - (-40));
            const dS = Math.hypot(ap.x, ap.y - 10, ap.z - 40);
            if (dN < 4.0 || dS < 4.0) nearRimCount++;

            // Strike detection
            const st = ath.strikeState;
            if (st && st.resolvedCount !== lastResolved[a]) {
              lastResolved[a] = st.resolvedCount;
              if (st.lastStrikeKind === 2) log.spikes++;
              else if (st.lastStrikeKind === 1) log.volleys++;
              else if (st.lastStrikeKind === 3) log.kicks++;
            }

            // Dive & slide detection
            const ac = ath.actionState;
            if (ac) {
              if (ac.slideTime > 0.05 && ac.slideTime < 0.1) log.slides++;
            }
          }
          if (nearRimCount >= 2 && (Math.abs(b.z - (-40)) < 4.0 || Math.abs(b.z - 40) < 4.0)) {
            log.rimScrambles++;
          }

          // Wall bank carom
          if (lastB) {
            const dvh = Math.hypot(v.x - lastB.vx, v.z - lastB.vz);
            if (dvh > 5.0 && (Math.abs(b.x) > 22.0 || Math.abs(b.z) > 55.0)) {
              log.caroms++;
            }
          }
          lastB = { x: b.x, y: b.y, z: b.z, vx: v.x, vy: v.y, vz: v.z };
        }

        const scoreHome = vb.matchState?.scoreHome || 0;
        const scoreAway = vb.matchState?.scoreAway || 0;
        log.goals = scoreHome + scoreAway;

        return {
          score: [scoreHome, scoreAway],
          log,
        };
      }, { spec, ticks: MATCH_TICKS });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // Score formula
      const score = (
        stats.log.goals * 20 +
        stats.log.spikes * 6 +
        stats.log.rimScrambles * 2 +
        stats.log.volleys * 1.5 +
        stats.log.slides * 2 +
        stats.log.caroms * 3 +
        Math.min(stats.log.maxBallSpeed, 35) * 1.2
      );

      const record = {
        seed: spec.seed,
        ball: spec.ball,
        configs: spec.configs.map((c) => ({ name: c.name, color: c.color, headwear: c.headwear, variant: c.variant })),
        score: stats.score,
        metrics: stats.log,
        highlightScore: Math.round(score),
        elapsedSeconds: parseFloat(elapsed),
      };

      results.push(record);
      console.log(`Done (${elapsed}s) -> Score: ${stats.score[0]}-${stats.score[1]}, Spikes: ${stats.log.spikes}, RimScrambles: ${stats.log.rimScrambles}, MaxSpeed: ${stats.log.maxBallSpeed.toFixed(1)}m/s | HighlightRank: ${Math.round(score)}`);
    }

    // Sort by Highlight Score descending
    results.sort((a, b) => b.highlightScore - a.highlightScore);

    const outPath = path.join(OUT_DIR, '2v2_top_mined_matches.json');
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`\n[2v2-miner] Finished! Top 5 Mined Highlights written to ${outPath}:`);
    for (let r = 0; r < Math.min(5, results.length); r++) {
      const top = results[r];
      console.log(`  #${r + 1}: Seed ${top.seed} (Score: ${top.highlightScore} pts) - Ball: ${top.ball}, Goals: ${top.metrics.goals}, Spikes: ${top.metrics.spikes}, MaxSpd: ${top.metrics.maxBallSpeed.toFixed(1)}m/s`);
    }
  } finally {
    await browser.close();
    await viteServer.close();
    console.log('[2v2-miner] Servers closed.');
  }
}

runMiner().catch((err) => {
  console.error('[2v2-miner] Error:', err);
  process.exit(1);
});
