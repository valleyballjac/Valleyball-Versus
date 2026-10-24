/**
 * VALLEYBALL VERSUS — 50-GAME MULTI-ANGLE RAW FOOTAGE HARVEST & COMPILATION PIPELINE
 *
 * Designed specifically for post-production assembly in Gemini Argon.
 *
 * Core Features:
 * 1. 50-Game Parameterized Matrix across:
 *    - 3 Ball Types: Small, Medium, Large
 *    - 3 Athlete Body Variants: Masculine, Feminine, Classic
 *    - 6 Official Brand Dictionary Palette Pairings
 * 2. 6 Dynamic Usable Camera Perspectives (guaranteed >= 1.85m terrain clearance):
 *    - flank_torus_north: 3/4 Side Profile Torus Hoop (frames aperture & 3D depth)
 *    - flank_torus_south: 3/4 Side Profile South Torus Hoop
 *    - low_turf_tracking: Ground-level raking camera tracking sprint duels & dives
 *    - over_shoulder_chase: Tight 3rd-person follow cam behind attacking athlete
 *    - vertical_spike_cam: Low upward-angled view framing aerial jump-spikes & blocks
 *    - banked_wall_curve: Tracking high-velocity carves along steep parabolic walls
 *    - action_orbit: Dynamic 360-degree revolving orbit around action centroid
 * 3. In-Engine Stunt & Action Injection:
 *    - Forces full sprint drive (`sprintHeld`)
 *    - Coordinated emergency diving saves on low balls
 *    - Mid-air apex spikes and block collisions on aerial balls
 *    - Precision parabolic Torus goals with celebratory shockwaves
 * 4. Machine-Readable Multimodal Slating:
 *    - Burns in lower-third metadata slugs and running timecode on every clip:
 *      [CLIP 01 | MATCH 01 | MEDIUM BALL | MASCULINE VS FEMININE | 3/4 FLANK HOOP | RALLY]
 *      allowing Gemini Argon to parse and cut footage with frame accuracy.
 * 5. Single Master Deliverable:
 *    - Assembles all curated clips into a single high-bitrate 1080p60 MP4 file:
 *      `captures/raw_footage/valleyball_versus_raw_footage_master_1080p60.mp4`
 *    - Pure SFX audio stem (zero music bleed) for effortless scoring against "Neon Velocity".
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE_PORT = 5186;
const CHUNK_SERVER_PORT = 5192;
const OUT_DIR = path.join(ROOT, 'captures', 'raw_footage');
const RAW_DIR = path.join(OUT_DIR, 'raw_chunks');
const CLIPS_DIR = path.join(OUT_DIR, 'clips');
const MASTER_MP4 = path.join(OUT_DIR, 'valleyball_versus_raw_footage_master_1080p60.mp4');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });
fs.mkdirSync(CLIPS_DIR, { recursive: true });

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

const CAMERA_MODES = [
  { mode: 'flank_torus_north', label: '3/4 FLANK NORTH TORUS', desc: 'Flank profile framing hoop depth, aperture, and goal strikes' },
  { mode: 'low_turf_tracking', label: 'LOW TURF ACTION FOLLOW', desc: 'Raking 1.85m ground camera tracking sprint duels and slides' },
  { mode: 'over_shoulder_chase', label: 'OVER-SHOULDER CHASE', desc: 'Tight 3rd-person follow cam behind attacking athlete' },
  { mode: 'vertical_spike_cam', label: 'VERTICAL AERIAL SPIKE', desc: 'Low camera angled upward framing mid-air spikes and blocks' },
  { mode: 'banked_wall_curve', label: 'BANKED WALL PARABOLIC', desc: 'Camera framing ball carves along steep banked arena walls' },
  { mode: 'action_orbit', label: 'DYNAMIC ACTION ORBIT', desc: 'Revolving 360-degree orbit around action centroid' },
  { mode: 'flank_torus_south', label: '3/4 FLANK SOUTH TORUS', desc: 'Flank profile framing South hoop and defensive goal clears' },
];

const STUNT_TYPES = [
  { type: 'dive', label: 'TURF DIVE SAVE', desc: 'Full-stretch diving save at court level' },
  { type: 'spike', label: 'AERIAL APEX SPIKE', desc: 'Mid-air leap and overhead spike/block clash' },
  { type: 'goal', label: 'TORUS HOOP GOAL', desc: 'Parabolic strike through Torus hoop aperture' },
  { type: 'rally', label: 'KINETIC SPRINT RALLY', desc: 'High-speed sprint duel with rapid volley exchanges' },
];

function generate50GameMatrix() {
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
    const camInfo = CAMERA_MODES[(i - 1) % CAMERA_MODES.length];
    const stuntInfo = STUNT_TYPES[(i - 1) % STUNT_TYPES.length];

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
      cameraMode: camInfo.mode,
      cameraLabel: camInfo.label,
      cameraDesc: camInfo.desc,
      stuntType: stuntInfo.type,
      stuntLabel: stuntInfo.label,
      stuntDesc: stuntInfo.desc,
      aggressiveness: 0.85 + ((i * 3) % 15) * 0.01,
      durationSec: 6.8, // 6.8s per clip (~5.5 minutes total compilation)
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
  const games = generate50GameMatrix().slice(0, maxGames);

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║     VALLEYBALL VERSUS — GEMINI ARGON RAW FOOTAGE HARVEST         ║`);
  console.log(`║      ${maxGames} Matches | 6 Cinematic Angles | Multimodal Slating      ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const receiver = await startChunkReceiver();

  // 1. Launch Vite Server
  console.log(`[reel] Launching Vite server on port ${VITE_PORT}...`);
  const viteServer = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.js'),
    logLevel: 'warn',
    server: { port: VITE_PORT, strictPort: true },
  });
  await viteServer.listen();

  // 2. Launch Chromium with Direct3D 11 hardware acceleration
  console.log('[reel] Launching GPU Direct3D 11 Chromium (1920x1080)...');
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
  console.log(`[reel] Loading application at ${url}...`);
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(5000);

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

  const processedClips = [];

  console.log(`[reel] Beginning recording of ${games.length} matches...\n`);

  for (let idx = 0; idx < games.length; idx++) {
    const g = games[idx];
    const gameNum = String(g.gameId).padStart(2, '0');
    console.log(`[reel] ▶ MATCH ${gameNum}/${maxGames} | ${g.ball.toUpperCase()} BALL | ${g.home.variant} vs ${g.away.variant} | ${g.cameraLabel} [${g.stuntLabel}]`);

    const rawFilename = `game_${gameNum}_raw.webm`;
    receiver.prepareStream(rawFilename);

    // Setup and trigger match in-browser
    const matchStats = await page.evaluate(async ({ g, chunkPort }) => {
      // Configure athletes and ball
      const configs = [
        { id: 'p1', name: 'Home Bot', team: g.home.team, variant: g.home.variant, cameraMode: 'chase', type: 'ai', difficulty: 'hard', aggressiveness: g.aggressiveness, primaryColor: g.home.color },
        { id: 'p2', name: 'Away Bot', team: g.away.team, variant: g.away.variant, cameraMode: 'chase', type: 'ai', difficulty: 'hard', aggressiveness: g.aggressiveness, primaryColor: g.away.color }
      ];

      // Hide stadium scoreboards and hustle boards
      if (window.__vb.scoreboards?.group) window.__vb.scoreboards.group.visible = false;
      if (window.__vb.hustleBoards?.group) window.__vb.hustleBoards.group.visible = false;

      // Start match and activate raw reel director
      if (window.__vb?.startMatch) {
        window.__vb.startMatch(configs, { ball: g.ball, duration: 180, arena: 'court' });
        if (window.__vb.skipFlyover) window.__vb.skipFlyover();
      }

      // Bypass countdown hold so play begins immediately from the first frame
      if (window.__vb?.matchState) {
        window.__vb.matchState.isCountingDown = false;
        window.__vb.matchState.countdownTicksRemaining = 0;
      }

      if (window.__vb?.trailerDirector) {
        window.__vb.trailerDirector.startRawReel(g.cameraMode, { stuntType: g.stuntType, duration: g.durationSec });
      }

      // Capture video from canvas and audio from WebAudio SFX bus
      const canvas = document.getElementById('viewport');
      let audioTrack = null;
      try {
        const sound = window.__vb?.sound;
        if (sound?.ctx) {
          if (sound.ctx.state === 'suspended') await sound.ctx.resume();
          const dest = sound.ctx.createMediaStreamDestination();
          if (sound.sfxGain) {
            sound.sfxGain.connect(dest);
          } else if (sound.masterGain) {
            sound.masterGain.connect(dest);
          }
          if (sound.uiGain) sound.uiGain.connect(dest);
          const aTracks = dest.stream.getAudioTracks();
          if (aTracks.length > 0) audioTrack = aTracks[0];
        }
      } catch (e) {
        console.warn('Audio capture hook warning:', e);
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
      await new Promise(r => setTimeout(r, 500));
      await fetch(`http://127.0.0.1:${chunkPort}/done`, { method: 'POST' });

      const goalsScored = (window.__vb?.matchState?.scoreA || 0) - initialScoreA + (window.__vb?.matchState?.scoreB || 0) - initialScoreB;

      return {
        maxBallSpeed,
        totalDives,
        sweetSpots,
        goalsScored,
      };
    }, { g, chunkPort: CHUNK_SERVER_PORT });

    await receiver.waitForDone();

    const rawFilePath = path.join(RAW_DIR, rawFilename);
    const rawExists = fs.existsSync(rawFilePath);
    const rawSizeBytes = rawExists ? fs.statSync(rawFilePath).size : 0;

    console.log(`    ↳ Recorded: Top Speed: ${matchStats.maxBallSpeed.toFixed(1)} m/s | Dives: ${matchStats.totalDives} | Goals: ${matchStats.goalsScored} (${(rawSizeBytes / (1024*1024)).toFixed(1)} MB)`);

    // Transcode and Burn In Machine-Readable Slate with FFmpeg
    const clipId = String(idx + 1).padStart(2, '0');
    const clipFilename = `clip_${clipId}_${g.ball}_${g.cameraMode}_${g.stuntType}.mp4`;
    const clipPath = path.join(CLIPS_DIR, clipFilename);

    const slateText = `CLIP ${clipId} | MATCH ${gameNum} | ${g.ball.toUpperCase()} BALL | ${g.home.variant.toUpperCase()} vs ${g.away.variant.toUpperCase()} | ${g.cameraLabel} | ${g.stuntLabel}`;
    // Escape single quotes and colons for ffmpeg drawtext filter
    const escapedSlateText = slateText.replace(/'/g, '').replace(/:/g, '\\:');

    const filterString = [
      `drawtext=fontfile='C\\:/Windows/Fonts/consola.ttf':text='${escapedSlateText}':fontcolor=white:fontsize=22:x=48:y=h-th-48:box=1:boxcolor=black@0.75:boxborderw=8`,
      `drawtext=fontfile='C\\:/Windows/Fonts/consola.ttf':text='REEL TC\\: %{pts\\:hms}':fontcolor=0xFFD000:fontsize=20:x=w-tw-48:y=48:box=1:boxcolor=black@0.75:boxborderw=6`
    ].join(',');

    try {
      execFileSync('ffmpeg', [
        '-y',
        '-r', '60',
        '-i', rawFilePath,
        '-ss', '0.4', // Skip initial camera settle frame
        '-t', '5.8',  // Clean 5.8s action segment
        '-vf', filterString,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '20',
        '-r', '60',
        '-fps_mode', 'cfr',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '48000',
        '-ac', '2',
        clipPath
      ], { stdio: 'pipe' });

      const clipStat = fs.statSync(clipPath);
      processedClips.push({
        clipId: idx + 1,
        clipFilename,
        clipPath,
        gameId: g.gameId,
        ball: g.ball,
        home: g.home,
        away: g.away,
        cameraMode: g.cameraMode,
        cameraLabel: g.cameraLabel,
        cameraDesc: g.cameraDesc,
        stuntType: g.stuntType,
        stuntLabel: g.stuntLabel,
        stuntDesc: g.stuntDesc,
        stats: matchStats,
        durationSec: 5.8,
        fileSizeBytes: clipStat.size,
      });
      console.log(`    ↳ Slated & Transcoded: ${clipFilename} (${(clipStat.size / (1024*1024)).toFixed(2)} MB)`);
    } catch (err) {
      console.warn(`    ↳ FFmpeg slate failed for ${clipFilename}:`, err.message);
    }
  }

  await browser.close();
  await viteServer.close();
  receiver.server.close();

  // 3. Assemble Single Master MP4 File via Concat Demuxer
  console.log(`\n[reel] === ASSEMBLING SINGLE MASTER COMPILATION FILE (${processedClips.length} CLIPS) ===`);
  const concatListPath = path.join(OUT_DIR, 'concat_list.txt');
  const concatLines = processedClips.map(c => `file '${c.clipPath.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(concatListPath, concatLines, 'utf8');

  try {
    execFileSync('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      MASTER_MP4
    ], { stdio: 'inherit' });
    console.log(`[reel] Master compilation file successfully assembled: ${MASTER_MP4} (${(fs.statSync(MASTER_MP4).size / (1024*1024)).toFixed(2)} MB)`);
  } catch (err) {
    console.error('[reel] Master concat failed:', err.message);
  }

  // 4. Calculate Exact Master Timecodes for Gemini Argon
  let accumulatedTime = 0;
  for (const c of processedClips) {
    c.masterStartSec = accumulatedTime;
    c.masterEndSec = accumulatedTime + c.durationSec;
    const sMin = Math.floor(c.masterStartSec / 60);
    const sSec = (c.masterStartSec % 60).toFixed(1);
    const eMin = Math.floor(c.masterEndSec / 60);
    const eSec = (c.masterEndSec % 60).toFixed(1);
    c.timecodeRange = `${String(sMin).padStart(2, '0')}:${sSec.padStart(4, '0')} - ${String(eMin).padStart(2, '0')}:${eSec.padStart(4, '0')}`;
    accumulatedTime += c.durationSec;
  }

  // 5. Write Machine-Readable Manifests (JSON and Markdown)
  fs.writeFileSync(path.join(OUT_DIR, 'clips_manifest.json'), JSON.stringify(processedClips, null, 2), 'utf8');

  let manifestMd = `# Valleyball Versus — Raw Action Footage Master Compilation\n\n`;
  manifestMd += `Total Matches: **${processedClips.length}** | Total Reel Duration: **${(accumulatedTime / 60).toFixed(2)} minutes** (${accumulatedTime.toFixed(1)}s)\n`;
  manifestMd += `Master File: \`${MASTER_MP4}\`\n\n`;
  manifestMd += `| Clip | Reel Timecode | Ball | Matchup & Variants | Camera Angle | Stunt Action | Highlights |\n`;
  manifestMd += `|---|---|---|---|---|---|---|\n`;

  for (const c of processedClips) {
    manifestMd += `| \`${String(c.clipId).padStart(2, '0')}\` | **${c.timecodeRange}** | **${c.ball.toUpperCase()}** | ${c.home.variant} vs ${c.away.variant} | ${c.cameraLabel} | ${c.stuntLabel} | Speed: ${c.stats.maxBallSpeed.toFixed(1)}m/s, Dives: ${c.stats.totalDives}, Goals: ${c.stats.goalsScored} |\n`;
  }

  fs.writeFileSync(path.join(OUT_DIR, 'clips_manifest.md'), manifestMd, 'utf8');
  console.log(`[reel] Manifest written: ${path.join(OUT_DIR, 'clips_manifest.md')}`);
  console.log(`[reel] JSON index written: ${path.join(OUT_DIR, 'clips_manifest.json')}`);
  console.log('=== GEMINI ARGON RAW FOOTAGE HARVEST COMPLETE ===\n');
}

runHarvest().catch(err => {
  console.error('[reel] Execution failed:', err);
  process.exit(1);
});
