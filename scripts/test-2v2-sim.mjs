import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE_PORT = 5188;

async function testSim() {
  console.log('[test-2v2-sim] Starting Vite server on port', VITE_PORT);
  const viteServer = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.js'),
    logLevel: 'warn',
    server: { port: VITE_PORT, strictPort: true },
  });
  await viteServer.listen();

  console.log('[test-2v2-sim] Launching Chromium with D3D11 acceleration...');
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

  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (msg) => {
      const txt = msg.text();
      if (txt.includes('[match]') || txt.includes('[ai]') || txt.includes('[score]')) {
        console.log('  PAGE LOG:', txt);
      }
    });

    const url = `http://localhost:${VITE_PORT}/Valleyball-Versus/`;
    console.log('[test-2v2-sim] Navigating to', url);
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });

    console.log('[test-2v2-sim] Waiting for window.__vb...');
    await page.waitForFunction(() => !!window.__vb && !!window.__vb.startMatch, null, { timeout: 15000 });

    console.log('[test-2v2-sim] Triggering 2v2 AI Match via window.__vb.startMatch...');
    const configs = [
      { team: 'home', type: 'ai', difficulty: 'hard', aggressiveness: 0.85, name: 'Crimson Striker', color: '#FF2A42', headwear: 'ram_horns', variant: 'masculine' },
      { team: 'away', type: 'ai', difficulty: 'hard', aggressiveness: 0.85, name: 'Azure Guardian', color: '#1F65FF', headwear: 'wicket_grill', variant: 'masculine' },
      { team: 'home', type: 'ai', difficulty: 'hard', aggressiveness: 0.80, name: 'Emerald Wing', color: '#10E56A', headwear: 'chullo_cap', variant: 'feminine' },
      { team: 'away', type: 'ai', difficulty: 'hard', aggressiveness: 0.80, name: 'Violet Spiker', color: '#6B11FF', headwear: 'beret', variant: 'feminine' },
    ];

    await page.evaluate((cfgs) => {
      window.__vb.startMatch(cfgs, { ball: 'medium', duration: 60 });
      window.__vb.skipFlyover();
    }, configs);

    console.log('[test-2v2-sim] Stepping 300 frames to verify 4 bots simulate...');
    await page.waitForTimeout(5000);

    const matchStatus = await page.evaluate(() => ({
      gameState: window.__vb.getGameState(),
      scoreHome: window.__vb.matchState?.scoreHome,
      scoreAway: window.__vb.matchState?.scoreAway,
      athletesCount: window.__vb.athletes?.length,
      ballPos: window.__vb.balls?.[0]?.body?.translation(),
    }));

    console.log('[test-2v2-sim] Match Status after 5s:', JSON.stringify(matchStatus, null, 2));
  } finally {
    await browser.close();
    await viteServer.close();
    console.log('[test-2v2-sim] Test complete and server closed.');
  }
}

testSim().catch((err) => {
  console.error('[test-2v2-sim] Error:', err);
  process.exit(1);
});
