import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE_PORT = 5192;
const VIDEO_DIR = path.join(ROOT, 'captures', '2v2_harvest', 'raw_recordings');

async function testRecord() {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  console.log('[test-record] Starting Vite server on port', VITE_PORT);
  const viteServer = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.js'),
    logLevel: 'error',
    server: { port: VITE_PORT, strictPort: true },
  });
  await viteServer.listen();

  console.log('[test-record] Launching Chromium with native recordVideo...');
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: [
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-gpu-rasterization',
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1920,1080',
    ],
  });

  try {
    const context = await browser.newContext({
      recordVideo: {
        dir: VIDEO_DIR,
        size: { width: 1920, height: 1080 },
      },
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    console.log('[test-record] Navigating to game...');
    await page.goto(`http://localhost:${VITE_PORT}/Valleyball-Versus/`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => !!window.__vb?.startMatch, null, { timeout: 15000 });

    // Seed 20261016 (Top candidate: Crimson/Emerald vs Azure/White, Big Ball)
    const configs = [
      { team: 'home', type: 'ai', difficulty: 'hard', aggressiveness: 0.90, name: 'Home 1', color: '#FF2A42', headwear: 'wrestler_bands', variant: 'masculine' },
      { team: 'away', type: 'ai', difficulty: 'hard', aggressiveness: 0.90, name: 'Away 1', color: '#1F65FF', headwear: 'wicket_grill', variant: 'classic' },
      { team: 'home', type: 'ai', difficulty: 'hard', aggressiveness: 0.85, name: 'Home 2', color: '#10E56A', headwear: 'ram_horns', variant: 'classic' },
      { team: 'away', type: 'ai', difficulty: 'hard', aggressiveness: 0.85, name: 'Away 2', color: '#FFFFFF', headwear: 'chullo_cap', variant: 'feminine' },
    ];

    console.log('[test-record] Starting match with Quad Split-Screen...');
    await page.evaluate((cfgs) => {
      // Hide debug UI elements
      const hideEl = document.createElement('style');
      hideEl.textContent = '#hud,#controls-card,#loading-status{display:none!important}';
      document.head.appendChild(hideEl);

      window.__vb.setSplitscreen(true);
      window.__vb.startMatch(cfgs, { ball: 'large', duration: 30 });
      window.__vb.skipFlyover();
    }, configs);

    console.log('[test-record] Recording 8 seconds of 2v2 action...');
    await page.waitForTimeout(8000);

    console.log('[test-record] Closing page to flush video...');
    await page.close();
    await context.close();

    const videoFiles = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm'));
    console.log('[test-record] Video recorded successfully:', videoFiles);
  } finally {
    await browser.close();
    await viteServer.close();
    console.log('[test-record] Done.');
  }
}

testRecord().catch((err) => {
  console.error('[test-record] Error:', err);
  process.exit(1);
});
