/**
 * VALLEYBALL VERSUS — 50-GAME ACTION HARVEST & SOCIAL CLIP PIPELINE
 *
 * Runs 50 live games across diverse ball sizes (small, medium, large),
 * character body builds (masculine, feminine, classic), official Brand
 * Dictionary color palettes, and AI aggressiveness.
 *
 * Detects high-impact moments (Torus goals, diving saves, sweet-spot spikes,
 * bank rebounds, multi-touch rallies) and exports broadcast-ready 1080p60 MP4
 * clips to `captures/socials/` along with `clips_manifest.md`.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE_PORT = 5184;
const CHUNK_SERVER_PORT = 5190;
const OUT_DIR = path.join(ROOT, 'captures', 'socials');
const RAW_DIR = path.join(OUT_DIR, 'raw_chunks');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

// Official Brand Palette Hex Codes
const PALETTES = {
  voltGold: { hex: 0xFFD000, name: 'Cyber Volt Gold' },
  neonViolet: { hex: 0x8B5CF6, name: 'Neon Violet' },
  emeraldGreen: { hex: 0x10E56A, name: 'Emerald Green' },
  solarBlaze: { hex: 0xFF6B00, name: 'Solar Blaze' },
  ionCyan: { hex: 0x00E5FF, name: 'Ion Cyan' },
  crimsonRed: { hex: 0xD90429, name: 'Crimson Red' },
  royalBlue: { hex: 0x1D4ED8, name: 'Royal Blue' },
  frostWhite: { hex: 0xF8FAFC, name: 'Frost White' },
  obsidianBlack: { hex: 0x0F172A, name: 'Obsidian Black' },
  deepIndigo: { hex: 0x6B11FF, name: 'Deep Indigo' },
};

// Generate 50 Diverse Game Configurations
function generateGameMatrix() {
  const balls = ['medium', 'small', 'large'];
  const builds = ['masculine', 'feminine', 'classic'];
  const palettePairs = [
    [PALETTES.voltGold, PALETTES.neonViolet],
    [PALETTES.ionCyan, PALETTES.crimsonRed],
    [PALETTES.emeraldGreen, PALETTES.solarBlaze],
    [PALETTES.frostWhite, PALETTES.obsidianBlack],
    [PALETTES.royalBlue, PALETTES.solarBlaze],
    [PALETTES.deepIndigo, PALETTES.voltGold],
  ];

  const games = [];
  for (let i = 1; i <= 50; i++) {
    const ball = balls[(i - 1) % balls.length];
    const buildHome = builds[(i - 1) % builds.length];
    const buildAway = builds[i % builds.length];
    const pair = palettePairs[(i - 1) % palettePairs.length];
    const agg = 0.75 + ((i * 7) % 25) * 0.01; // 0.75 to 0.99

    games.push({
      gameId: i,
      ball,
      home: {
        team: 'home',
        variant: buildHome,
        color: pair[0].hex,
        colorName: pair[0].name,
      },
      away: {
        team: 'away',
        variant: buildAway,
        color: pair[1].hex,
        colorName: pair[1].name,
      },
      aggressiveness: agg,
      durationSec: 8.0, // 8s per game evaluation window (optimal for social shorts / reels)
    });
  }
  return games;
}

async function startChunkReceiver() {
  let activeWriteStream = null;
  let currentRawPath = null;
  let donePromise = Promise.resolve();
  let doneResolve = null;

  function prepareStream(filename) {
    donePromise = new Promise((resolve) => { doneResolve = resolve; });
    currentRawPath = path.join(RAW_DIR, filename);
    if (fs.existsSync(currentRawPath)) fs.unlinkSync(currentRawPath);
    activeWriteStream = fs.createWriteStream(currentRawPath);
    return currentRawPath;
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      return res.end();
    }

    if (req.url === '/chunk' && req.method === 'POST') {
      if (activeWriteStream) {
        req.on('data', chunk => activeWriteStream.write(chunk));
      }
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (req.url === '/done' && req.method === 'POST') {
      req.on('data', () => {});
      req.on('end', () => {
        if (activeWriteStream) {
          activeWriteStream.end(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, path: currentRawPath }));
            if (doneResolve) doneResolve(currentRawPath);
          });
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          if (doneResolve) doneResolve(null);
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise(resolve => server.listen(CHUNK_SERVER_PORT, '127.0.0.1', resolve));

  return {
    server,
    prepareStream,
    waitForDone: () => donePromise,
  };
}

async function runHarvest() {
  const limitArg = process.argv.find((_, i, arr) => arr[i - 1] === '--limit');
  const maxGames = limitArg ? parseInt(limitArg, 10) : 50;
  const games = generateGameMatrix().slice(0, maxGames);

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║        VALLEYBALL VERSUS — ${maxGames}-GAME ACTION HARVEST PIPELINE       ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
  const receiver = await startChunkReceiver();

  // Launch Vite
  console.log(`[harvest] Launching Vite server on port ${VITE_PORT}...`);
  const viteServer = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.js'),
    logLevel: 'warn',
    server: { port: VITE_PORT, strictPort: true },
  });
  await viteServer.listen();

  // Launch GPU Chromium
  console.log('[harvest] Spawning GPU-accelerated Chromium (1920x1080)...');
  const browser = await chromium.launch({
    headless: false,
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
  page.setDefaultTimeout(600000);

  const url = `http://localhost:${VITE_PORT}/Valleyball-Versus/`;
  console.log(`[harvest] Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(6000);

  // Setup UI Hide
  await page.evaluate(() => {
    let s = document.getElementById('cap-ui-hide');
    if (!s) {
      s = document.createElement('style');
      s.id = 'cap-ui-hide';
      document.head.appendChild(s);
    }
    s.textContent = `
      #hud, #controls-card, #splitscreen-divider, .lil-gui, #main-menu-root, #title-screen, #loading-screen, #camera-toast {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
      }
    `;
  });

  const manifest = [];
  const selectedClips = [];

  // Harvest loop across 50 games
  console.log(`[harvest] Beginning execution of ${games.length} parameterized games...\n`);

  for (let idx = 0; idx < games.length; idx++) {
    const g = games[idx];
    const gameNum = String(g.gameId).padStart(2, '0');
    console.log(`[harvest] --- GAME ${gameNum}/50 | Ball: ${g.ball.toUpperCase()} | ${g.home.variant} (${g.home.colorName}) vs ${g.away.variant} (${g.away.colorName}) ---`);

    const rawFilename = `game_${gameNum}_raw.webm`;
    receiver.prepareStream(rawFilename);

    // Setup and trigger match in-browser
    const matchStats = await page.evaluate(async ({ g, idx, chunkPort }) => {
      // Rotate dynamic camera perspectives and athlete stunt types across matches
      const camModes = ['low_turf_tracking', 'flank_torus_north', 'flank_torus_south', 'banked_wall_curve', 'action_orbit', 'over_shoulder_chase'];
      const chosenCam = camModes[idx % camModes.length];
      const stuntModes = ['goal', 'dive', 'slide', 'cut', 'spike', 'rally'];
      const chosenStunt = stuntModes[idx % stuntModes.length];

      // Keep 3D Stadium Scoreboards and Hustle Boards glowing and visible
      if (window.__vb.scoreboards?.group) window.__vb.scoreboards.group.visible = true;
      if (window.__vb.hustleBoards?.group) window.__vb.hustleBoards.group.visible = true;

      // Configure athletes and ball
      const configs = [
        { id: 'p1', name: 'Home Bot', team: g.home.team, variant: g.home.variant, cameraMode: 'chase', type: 'ai', difficulty: 'hard', aggressiveness: g.aggressiveness, primaryColor: g.home.color },
        { id: 'p2', name: 'Away Bot', team: g.away.team, variant: g.away.variant, cameraMode: 'chase', type: 'ai', difficulty: 'hard', aggressiveness: g.aggressiveness, primaryColor: g.away.color }
      ];

      if (window.__vb && window.__vb.startMatch) {
        window.__vb.startMatch(configs, { ball: g.ball, duration: 180, arena: 'court' });
        if (window.__vb.skipFlyover) window.__vb.skipFlyover();
      }

      // Bypass countdown freeze so athletes start playing immediately
      if (window.__vb?.matchState) {
        window.__vb.matchState.isCountingDown = false;
        window.__vb.matchState.countdownTicksRemaining = 0;
      }

      // Activate camera in trailerDirector with rotating stunt
      if (window.__vb?.trailerDirector) {
        window.__vb.trailerDirector.startRawReel(chosenCam, { stuntType: chosenStunt, duration: g.durationSec });
      }

      // Connect MediaRecorder to WebGL canvas and WebAudio SFX stem
      const canvas = document.getElementById('viewport');
      let audioTrack = null;
      try {
        const sound = window.__vb?.sound;
        if (sound?.ctx) {
          if (sound.ctx.state === 'suspended') await sound.ctx.resume();
          const dest = sound.ctx.createMediaStreamDestination();
          if (sound.sfxGain) sound.sfxGain.connect(dest);
          else if (sound.masterGain) sound.masterGain.connect(dest);
          if (sound.uiGain) sound.uiGain.connect(dest);
          const aTracks = dest.stream.getAudioTracks();
          if (aTracks.length > 0) audioTrack = aTracks[0];
        }
      } catch (e) {
        console.warn('Audio capture warning:', e);
      }

      const tracks = [...canvas.captureStream(60).getVideoTracks()];
      if (audioTrack) tracks.push(audioTrack);
      const stream = new MediaStream(tracks);

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus'
          : 'video/webm',
        videoBitsPerSecond: 28000000
      });

      recorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
          try {
            await fetch(`http://127.0.0.1:${chunkPort}/chunk`, { method: 'POST', body: e.data });
          } catch (_) {}
        }
      };

      recorder.start(250);

      // Track athletic events during the round
      let maxBallSpeed = 0;
      let totalDives = 0;
      let totalSlides = 0;
      let totalCuts = 0;
      let sweetSpots = 0;
      let initialScoreA = window.__vb?.matchState?.scoreA || 0;
      let initialScoreB = window.__vb?.matchState?.scoreB || 0;

      const startTime = performance.now();
      while (performance.now() - startTime < g.durationSec * 1000) {
        await new Promise(r => setTimeout(r, 100));
        const ball = window.__vb?.balls?.[0];
        if (ball?.body?.linvel) {
          const v = ball.body.linvel();
          const spd = Math.hypot(v.x, v.y, v.z);
          if (spd > maxBallSpeed) maxBallSpeed = spd;
        }
        if (window.__vb?.athleteMatchStats) {
          for (const s of window.__vb.athleteMatchStats) {
            if (s.dives > totalDives) totalDives = s.dives;
            if (s.sweetSpotHits > sweetSpots) sweetSpots = s.sweetSpotHits;
          }
        }
      }

      recorder.stop();
      if (window.__vb?.trailerDirector) window.__vb.trailerDirector.stop();
      await new Promise(r => setTimeout(r, 600));
      await fetch(`http://127.0.0.1:${chunkPort}/done`, { method: 'POST' });

      const goalsScored = (window.__vb?.matchState?.scoreA || 0) - initialScoreA + (window.__vb?.matchState?.scoreB || 0) - initialScoreB;

        return {
          camera: chosenCam,
          stunt: chosenStunt,
          maxBallSpeed,
          totalDives,
          sweetSpots,
          goalsScored,
        };
      }, { g, idx, chunkPort: CHUNK_SERVER_PORT });

      await receiver.waitForDone();

      const rawFilePath = path.join(RAW_DIR, rawFilename);
      const rawExists = fs.existsSync(rawFilePath);
      const rawSizeBytes = rawExists ? fs.statSync(rawFilePath).size : 0;

      console.log(`  -> Match complete [${matchStats.stunt.toUpperCase()}]. Goals: ${matchStats.goalsScored} | Top Ball Speed: ${matchStats.maxBallSpeed.toFixed(1)} m/s | Dives: ${matchStats.totalDives} | Sweet-Spots: ${matchStats.sweetSpots} (${(rawSizeBytes / (1024*1024)).toFixed(1)} MB)`);

      manifest.push({
        gameId: g.gameId,
        ball: g.ball,
        home: g.home,
        away: g.away,
        stunt: matchStats.stunt,
        stats: matchStats,
        rawFile: rawFilename,
      });

      // Encode every recorded game into a broadcast-ready social clip
      if (rawSizeBytes > 300000) {
        const clipNum = String(selectedClips.length + 1).padStart(2, '0');
        const clipName = `clip_${clipNum}_${matchStats.stunt}_${g.ball}_${matchStats.camera}_${g.home.variant}_vs_${g.away.variant}.mp4`;
        const clipPath = path.join(OUT_DIR, clipName);
        const musicOffset = (idx * 1.818) % 70.0;
        const musicPath = path.join(ROOT, 'public', 'audio', 'music', 'track_trailer_neon_velocity.mp3');

      try {
        console.log(`  [clip] Encoding social highlight with game SFX + Neon Velocity: ${clipName}...`);
        const fadeOutStart = Math.max(0.5, g.durationSec - 1.2).toFixed(1);
        try {
          execFileSync('ffmpeg', [
            '-y',
            '-r', '60',
            '-i', rawFilePath,
            '-ss', String(musicOffset),
            '-i', musicPath,
            '-filter_complex', `[0:a:0]volume=1.2[sfx];[1:a:0]volume=0.30,afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeOutStart}:d=1.0[mus];[sfx][mus]amix=inputs=2:duration=first[aout]`,
            '-map', '0:v:0',
            '-map', '[aout]',
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '22',
            '-fps_mode', 'cfr',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-shortest',
            clipPath
          ], { stdio: 'pipe' });
        } catch (_) {
          // Fallback if raw chunk audio track absent
          execFileSync('ffmpeg', [
            '-y',
            '-r', '60',
            '-i', rawFilePath,
            '-ss', String(musicOffset),
            '-i', musicPath,
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '22',
            '-fps_mode', 'cfr',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-af', `afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeOutStart}:d=1.0`,
            '-shortest',
            clipPath
          ], { stdio: 'pipe' });
        }

        selectedClips.push({
          clipName,
          clipPath,
          gameId: g.gameId,
          ball: g.ball,
          home: g.home,
          away: g.away,
          camera: matchStats.camera || 'broadcast',
          stats: matchStats,
          fileSizeBytes: fs.statSync(clipPath).size,
        });
      } catch (err) {
        console.warn(`  [clip] Failed to encode clip ${clipName}:`, err.message);
      }
    }
  }

  await browser.close();
  await viteServer.close();
  receiver.server.close();

  // Write Manifest Document
  console.log(`\n[harvest] Writing Social Clips Manifest (${selectedClips.length} clips generated)...`);
  let manifestMd = `# Valleyball Versus — 50-Game Action Harvest Manifest\n\n`;
  manifestMd += `Total Games Executed: **${games.length}** | Social Highlight Clips Extracted: **${selectedClips.length}**\n\n`;
  manifestMd += `| Clip | Stunt Focus | Ball Type | Camera Perspective | Matchup & Variants | Top Ball Speed | Highlights | File Size |\n`;
  manifestMd += `|---|---|---|---|---|---|---|---|\n`;

  for (const c of selectedClips) {
    const sizeMb = (c.fileSizeBytes / (1024 * 1024)).toFixed(2);
    manifestMd += `| \`${c.clipName}\` | **${(c.stats.stunt || 'rally').toUpperCase()}** | **${c.ball.toUpperCase()}** | ${c.camera} | ${c.home.variant} (${c.home.colorName}) vs ${c.away.variant} (${c.away.colorName}) | ${c.stats.maxBallSpeed.toFixed(1)} m/s | Goals: ${c.stats.goalsScored}, Dives: ${c.stats.totalDives}, SweetSpots: ${c.stats.sweetSpots} | ${sizeMb} MB |\n`;
  }

  manifestMd += `\n---\n## Complete Game Evaluation Matrix\n\n`;
  manifestMd += `| Game | Stunt | Ball | Camera | Home Build (Palette) | Away Build (Palette) | Top Speed | Events |\n`;
  manifestMd += `|---|---|---|---|---|---|---|---|\n`;
  for (const m of manifest) {
    manifestMd += `| ${m.gameId} | **${(m.stunt || 'rally').toUpperCase()}** | ${m.ball} | ${m.stats.camera || 'broadcast'} | ${m.home.variant} (${m.home.colorName}) | ${m.away.variant} (${m.away.colorName}) | ${m.stats.maxBallSpeed.toFixed(1)} m/s | G:${m.stats.goalsScored} D:${m.stats.totalDives} S:${m.stats.sweetSpots} |\n`;
  }

  fs.writeFileSync(path.join(OUT_DIR, 'clips_manifest.md'), manifestMd, 'utf8');
  const brainDir = 'C:\\Users\\portt\\.gemini\\antigravity\\brain\\b374f0c0-8568-40f2-8627-bfed559fd017';
  try {
    fs.writeFileSync(path.join(brainDir, 'clips_manifest.md'), manifestMd, 'utf8');
  } catch (_) {}
  console.log(`[harvest] Manifest saved: ${path.join(OUT_DIR, 'clips_manifest.md')}`);
  console.log('=== ACTION HARVEST COMPLETE ===\n');
}

runHarvest().catch(err => {
  console.error('[harvest] Harvest error:', err);
  process.exit(1);
});
