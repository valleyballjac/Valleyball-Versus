/**
 * VALLEYBALL VERSUS — OFFICIAL TRAILER VIDEO CAPTURE HARNESS
 *
 * Captures 1080p 60fps video with GPU hardware acceleration,
 * runs the 89.85s "Neon Velocity" trailer choreography, and
 * outputs:
 * 1. Broadcast Master 1080p60 MP4 (~35 Mbps H.264 / 320k AAC)
 * 2. Social Web Cut 1080p60 MP4 (<25 MB for Twitter/Discord)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE_PORT = 5183;
const CHUNK_SERVER_PORT = 5189;
const OUT_DIR = path.join(ROOT, 'captures', 'trailer');
const RAW_WEBM = path.join(OUT_DIR, 'raw_stream.webm');
const MASTER_MP4 = path.join(OUT_DIR, 'valleyball_versus_debut_trailer_1080p60.mp4');
const SOCIAL_MP4 = path.join(OUT_DIR, 'valleyball_versus_debut_trailer_social_1080p.mp4');
const MUSIC_PATH = path.join(ROOT, 'public', 'audio', 'music', 'track_trailer_neon_velocity.mp3');

fs.mkdirSync(OUT_DIR, { recursive: true });

async function startChunkReceiver() {
  if (fs.existsSync(RAW_WEBM)) fs.unlinkSync(RAW_WEBM);
  const writeStream = fs.createWriteStream(RAW_WEBM);

  let doneResolve;
  const donePromise = new Promise((resolve) => { doneResolve = resolve; });

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      return res.end();
    }

    if (req.url === '/chunk' && req.method === 'POST') {
      req.on('data', chunk => writeStream.write(chunk));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    } else if (req.url === '/done' && req.method === 'POST') {
      req.on('data', () => {});
      req.on('end', () => {
        writeStream.end(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          doneResolve();
        });
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise(resolve => server.listen(CHUNK_SERVER_PORT, '127.0.0.1', resolve));
  console.log(`[capture] Chunk streaming server listening on 127.0.0.1:${CHUNK_SERVER_PORT}`);

  return {
    server,
    waitForDone: () => donePromise,
  };
}

async function runCapture() {
  console.log('=== STARTING VALLEYBALL DEBUT TRAILER VIDEO CAPTURE ===');

  // 1. Start chunk streaming receiver
  const receiver = await startChunkReceiver();

  // 2. Start Vite server
  console.log(`[capture] Launching Vite server on port ${VITE_PORT}...`);
  const viteServer = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.js'),
    logLevel: 'warn',
    server: { port: VITE_PORT, strictPort: true },
  });
  await viteServer.listen();
  console.log(`[capture] Vite server running at http://localhost:${VITE_PORT}/Valleyball-Versus/`);

  // 3. Launch GPU-Accelerated Chromium
  console.log('[capture] Spawning GPU-accelerated Chromium (1920x1080)...');
  const browser = await chromium.launch({
    headless: false, // headed ensures full hardware D3D11 rendering at 60fps
    args: [
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-gpu-rasterization',
      '--enable-zero-copy',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--window-size=1920,1080',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(180000);

  // 4. Load Valleyball Versus
  const url = `http://localhost:${VITE_PORT}/Valleyball-Versus/`;
  console.log(`[capture] Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(6000); // Allow assets, audio, and arena.glb to settle

  // 5. Setup Match and Recording in Browser
  console.log('[capture] Setting up match & MediaRecorder...');
  await page.evaluate(async (chunkPort) => {
    // Hide UI
    let style = document.getElementById('cap-ui-hide');
    if (!style) {
      style = document.createElement('style');
      style.id = 'cap-ui-hide';
      document.head.appendChild(style);
    }
    style.textContent = `
      #hud, #controls-card, #splitscreen-divider, .lil-gui, #main-menu-root, #title-screen, #loading-screen, #camera-toast {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
      }
    `;

    // Start 1v1 AI vs AI Match
    if (window.__vb && window.__vb.startMatch) {
      const configs = [
        { id: 'p1', name: 'Home Bot', team: 'home', variant: 'masculine', cameraMode: 'chase', type: 'ai', difficulty: 'hard', aggressiveness: 0.8 },
        { id: 'p2', name: 'Away Bot', team: 'away', variant: 'classic', cameraMode: 'chase', type: 'ai', difficulty: 'hard', aggressiveness: 0.8 }
      ];
      window.__vb.startMatch(configs, { ball: 'medium', duration: 300, arena: 'court' });
      if (window.__vb.skipFlyover) window.__vb.skipFlyover();
    }

    // Connect MediaRecorder to WebGL canvas stream
    const canvas = document.getElementById('viewport');
    const stream = canvas.captureStream(60);

    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm',
      videoBitsPerSecond: 35000000 // 35 Mbps broadcast bitrate
    });

    recorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        try {
          await fetch(`http://127.0.0.1:${chunkPort}/chunk`, {
            method: 'POST',
            body: e.data
          });
        } catch (_) {}
      }
    };

    window.__trailerRecorder = recorder;
    recorder.start(400); // 400ms chunk intervals

    // Start TrailerDirector at t=0
    if (window.__vb && window.__vb.trailerDirector) {
      window.__vb.trailerDirector.start(0);
    }
  }, CHUNK_SERVER_PORT);

  console.log('[capture] Recording live trailer sequence with Neon Velocity (89.85s + outro)...');

  let inGameTime = 0;
  while (inGameTime < 90.5) {
    await page.waitForTimeout(4000);
    inGameTime = await page.evaluate(() => window.__vb?.trailerDirector?.elapsedTime || 0);
    console.log(`[capture] In-game sequence time: ${inGameTime.toFixed(1)}s / 90.5s`);
  }
  await page.waitForTimeout(1200);

  // 6. Stop Recorder
  console.log('[capture] Sequence completed. Finalizing recording stream...');
  await page.evaluate(async (chunkPort) => {
    if (window.__trailerRecorder && window.__trailerRecorder.state !== 'inactive') {
      window.__trailerRecorder.stop();
    }
    // Allow final chunks to flush
    await new Promise(r => setTimeout(r, 1000));
    await fetch(`http://127.0.0.1:${chunkPort}/done`, { method: 'POST' });
  }, CHUNK_SERVER_PORT);

  // Wait for chunk receiver to finish writing RAW_WEBM
  await receiver.waitForDone();
  receiver.server.close();
  console.log(`[capture] Raw WebM stream written: ${RAW_WEBM} (${(fs.statSync(RAW_WEBM).size / (1024 * 1024)).toFixed(2)} MB)`);

  // Close browser and Vite
  await browser.close();
  await viteServer.close();

  // 7. Post-Processing & Deliverable Assembly via FFmpeg
  console.log('\n=== ASSEMBLING FINAL BROADCAST DELIVERABLES (FFMPEG) ===');

  // A. Broadcast Master (1080p60 high-bitrate H.264 / 320k AAC)
  console.log('[capture] Encoding Deliverable 1: Broadcast Master 1080p60 MP4...');
  const masterArgs = [
    '-y',
    '-r', '60',
    '-i', RAW_WEBM,
    '-i', MUSIC_PATH,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '17',
    '-fps_mode', 'cfr',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '320k',
    '-shortest',
    MASTER_MP4
  ];
  execFileSync('ffmpeg', masterArgs, { stdio: 'inherit' });
  console.log(`[capture] Master MP4 created: ${MASTER_MP4}`);

  // B. Social Web Cut (<25 MB for Twitter / Discord)
  console.log('[capture] Encoding Deliverable 2: Social Web Cut (<25 MB)...');
  const socialArgs = [
    '-y',
    '-i', MASTER_MP4,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '24',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    SOCIAL_MP4
  ];
  execFileSync('ffmpeg', socialArgs, { stdio: 'inherit' });
  const socialSizeMb = (fs.statSync(SOCIAL_MP4).size / (1024 * 1024)).toFixed(2);
  console.log(`[capture] Social Web MP4 created: ${SOCIAL_MP4} (${socialSizeMb} MB)`);

  console.log('\n=== TRAILER PRODUCTION COMPLETE ===');
}

runCapture().catch(err => {
  console.error('[capture] Error during capture:', err);
  process.exit(1);
});
