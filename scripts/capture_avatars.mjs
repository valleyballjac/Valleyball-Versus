/**
 * PHOTO BOOTH AUTOMATED CAPTURE RUNNER
 * Bootstraps Vite, drives headless Chromium with WebGL SwiftShader,
 * and generates all 10 canonical 512x512 avatar portraits into captures/avatars/.
 */

import { stat, readdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5173;
const TIMEOUT_MS = 60_000;

const CHROMIUM_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

const EXPECTED_AVATARS = [
  'white',
  'black',
  'blue',
  'red',
  'green',
  'purple',
  'teal',
  'yellow',
  'orange',
  'pink',
];

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(1000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
  });
}

async function main() {
  console.log('[photobooth-runner] Starting Photo Booth Capture Pipeline...');

  const alreadyRunning = await portInUse(PORT);
  let server = null;

  if (!alreadyRunning) {
    console.log(`[photobooth-runner] Launching Vite dev server on port ${PORT}...`);
    server = await createServer({
      root: ROOT,
      configFile: path.join(ROOT, 'vite.config.js'),
      logLevel: 'warn',
      server: { port: PORT, strictPort: true },
    });
    await server.listen();
  } else {
    console.log(`[photobooth-runner] Dev server already listening on port ${PORT}.`);
  }

  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error') {
        console.error(`[browser error] ${text}`);
      } else {
        console.log(`[browser] ${text}`);
      }
    });

    page.on('pageerror', (err) => {
      console.error(`[browser pageerror] ${err.message}`);
    });

    console.log(`[photobooth-runner] Navigating to http://localhost:${PORT}/?mode=photobooth...`);
    await page.goto(`http://localhost:${PORT}/?mode=photobooth`, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MS,
    });

    // Wait for window.captureRosterAvatars to be ready
    console.log('[photobooth-runner] Waiting for Photo Booth studio readiness...');
    await page.waitForFunction(() => typeof window.captureRosterAvatars === 'function', {
      timeout: TIMEOUT_MS,
    });

    console.log('[photobooth-runner] Invoking window.captureRosterAvatars()...');
    const captureResults = await page.evaluate(async () => {
      return await window.captureRosterAvatars();
    });

    console.log('[photobooth-runner] Capture function returned:', captureResults);

    // Verify all 10 expected PNG files on disk
    const outDir = path.join(ROOT, 'captures', 'avatars');
    console.log(`[photobooth-runner] Verifying captures in ${outDir}...`);

    let missing = 0;
    for (const id of EXPECTED_AVATARS) {
      const filePath = path.join(outDir, `${id}.png`);
      try {
        const fileStat = await stat(filePath);
        if (fileStat.size > 0) {
          console.log(`  ✓ ${id}.png  (${fileStat.size} bytes)`);
        } else {
          console.error(`  ✗ ${id}.png is 0 bytes!`);
          missing++;
        }
      } catch (err) {
        console.error(`  ✗ ${id}.png missing: ${err.message}`);
        missing++;
      }
    }

    if (missing > 0) {
      throw new Error(`Photo Booth capture incomplete: ${missing} avatars missing or empty.`);
    }

    console.log(`\n[photobooth-runner] SUCCESS! All 10 canonical avatar portraits captured into captures/avatars/\n`);
  } finally {
    await browser.close().catch(() => {});
    if (server) {
      await server.close().catch(() => {});
    }
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error('\n[photobooth-runner] FAILED:', err);
    process.exitCode = 1;
  });
