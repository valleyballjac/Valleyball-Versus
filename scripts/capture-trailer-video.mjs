/**
 * VALLEYBALL VERSUS — OFFICIAL DEBUT TRAILER DETERMINISTIC CAPTURE & ASSEMBLY HARNESS
 *
 * Deterministic Frame-by-Frame Stepping Pipeline (Offline Rendering):
 * - Exactly 5,028 in-engine gameplay frames @ 60.00 FPS (83.800s duration)
 * - Piped synchronously from WebGL canvas into FFmpeg (image2pipe / mjpeg)
 * - Zero dropped frames, zero duplicate frames, zero jitter, zero stutter
 * - Hardware acceleration locked to NVIDIA GeForce RTX 3050 Ti Laptop GPU via --force_high_performance_gpu
 * - High-bitrate H.264 (CRF 17) Broadcast Master + Optimized Social Cut (<25 MB)
 * - 94.500s Total Deliverable Duration (5,670 frames @ 60.0000 FPS CFR)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { ALL_TRAILER_OVERLAYS, generateTrailerCaptions } from './generate_trailer_captions.mjs';
import { buildSfxStem } from './trailer-sfx.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE_PORT = 5183;
const FRAME_SERVER_PORT = 5189;
const OUT_DIR = path.join(ROOT, 'captures', 'trailer');
const CAPTIONS_DIR = path.join(OUT_DIR, 'captions');
const RAW_MP4 = path.join(OUT_DIR, 'raw_footage_1080p60.mp4');
const MASTER_MP4 = path.join(OUT_DIR, 'valleyball_versus_official_trailer_1080p60.mp4');
const DEBUT_MP4 = path.join(OUT_DIR, 'valleyball_versus_debut_trailer_1080p60.mp4');
const SOCIAL_MP4 = path.join(OUT_DIR, 'valleyball_versus_official_trailer_social_1080p.mp4');
const MUSIC_PATH = path.join(ROOT, 'public', 'audio', 'music', 'track_trailer_neon_velocity.mp3');
const TITLE_CARD = path.join(OUT_DIR, 'title_card_galaxy.png');

// Trailer render quality. 'high' lights the arena with all four floodlight towers
// (the game ships 'balanced': one shadow-casting tower), and 4096 shadow maps keep
// each athlete's four shadows crisp where 1024 blurs them into smudges.
const TRAILER_SHADOW_QUALITY = 'high';
const TRAILER_SHADOW_MAP_SIZE = 4096;
// Frames pass through a JPEG and an intermediate encode before the master
// encode, so keep both near-lossless.
const FRAME_JPEG_QUALITY = 1.0;
const RAW_CRF = 12;

// Audio master: music plus, when present, the synced game-SFX stem, normalised
// in two passes to the -14 LUFS streaming target with peak headroom for AAC.
const SFX_EVENTS_JSON = path.join(OUT_DIR, 'sfx_events.json');
const SFX_STEM = path.join(OUT_DIR, 'sfx_stem.wav');
const SFX_GAIN_DB = 0;
const AUDIO_MASTER_WAV = path.join(OUT_DIR, 'trailer_audio_master.wav');
const TARGET_LUFS = -14;
// Sample-peak ceiling; inter-sample overs then stay under the -1.5 dBTP target.
const LIMIT_DBFS = -2.0;

// ebur128 prints its summary on stderr: integrated loudness and true peak.
function measureLoudness(file) {
  const log = spawnSync('ffmpeg', [
    '-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-',
  ], { encoding: 'utf8' }).stderr;
  const summary = log.slice(log.lastIndexOf('Summary:'));
  return {
    integrated: parseFloat(summary.match(/I:\s+(-?[\d.]+) LUFS/)[1]),
    truePeak: parseFloat(summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/)[1]),
  };
}

function masterAudio() {
  const hasSfx = fs.existsSync(SFX_STEM);
  const premaster = path.join(OUT_DIR, 'trailer_audio_premaster.wav');
  const mix = hasSfx
    ? '[0:a]apad=whole_dur=94.5,atrim=duration=94.5[music];' +
      `[1:a]apad=whole_dur=94.5,atrim=duration=94.5,volume=${SFX_GAIN_DB}dB[sfx];` +
      '[music][sfx]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]'
    : '[0:a]apad=whole_dur=94.5,atrim=duration=94.5[mix]';
  // Float premaster: overlaps above full scale survive until the limiter
  execFileSync('ffmpeg', [
    '-y', '-i', MUSIC_PATH, ...(hasSfx ? ['-i', SFX_STEM] : []),
    '-filter_complex', mix, '-map', '[mix]', '-ar', '48000', '-c:a', 'pcm_f32le', premaster,
  ], { stdio: 'pipe' });

  // One static gain to the target, then a fixed-ceiling limiter. loudnorm's
  // linear mode falls back to dynamic gain riding when the peaks can't take the
  // gain, and alimiter's default auto-level would undo the ceiling.
  const limit = Math.pow(10, LIMIT_DBFS / 20).toFixed(4);
  let gainDb = TARGET_LUFS - measureLoudness(premaster).integrated;
  let result = null;
  for (let pass = 0; pass < 2; pass++) {
    execFileSync('ffmpeg', [
      '-y', '-i', premaster,
      '-af', `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${limit}:attack=2:release=60:level=disabled`,
      '-ar', '48000', '-c:a', 'pcm_s24le', AUDIO_MASTER_WAV,
    ], { stdio: 'pipe' });
    result = measureLoudness(AUDIO_MASTER_WAV);
    // Limiting shaves a little loudness; one correction pass recovers it
    if (Math.abs(result.integrated - TARGET_LUFS) <= 0.2) break;
    gainDb += TARGET_LUFS - result.integrated;
  }
  console.log(`[capture] Audio master (${hasSfx ? `music + game SFX at ${SFX_GAIN_DB} dB` : 'music only'}): ` +
    `${result.integrated} LUFS, true peak ${result.truePeak} dBTP`);
  return AUDIO_MASTER_WAV;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

async function ensureTitleCardAndCaptions() {
  if (!fs.existsSync(TITLE_CARD)) {
    console.log('[capture] Generating title_card_galaxy.png...');
    execFileSync('node', [path.join(ROOT, 'scripts', 'generate_title_card.mjs')], { stdio: 'inherit' });
  }
  const missingCaption = ALL_TRAILER_OVERLAYS.some((c) => !fs.existsSync(path.join(CAPTIONS_DIR, c.file)));
  if (missingCaption || process.argv.includes('--regen-captions')) {
    await generateTrailerCaptions();
  }
}

async function startFramePipeReceiver(outputFilePath) {
  if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath);

  console.log(`[capture] Spawning FFmpeg image2pipe encoder -> ${outputFilePath}...`);
  const ffmpegProcess = spawn('ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-r', '60',
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', String(RAW_CRF),
    '-pix_fmt', 'yuv420p',
    outputFilePath,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  let framesReceived = 0;
  let doneResolve;
  const donePromise = new Promise((resolve) => { doneResolve = resolve; });

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      return res.end();
    }

    if (req.url === '/frame' && req.method === 'POST') {
      req.on('data', (chunk) => {
        ffmpegProcess.stdin.write(chunk);
      });
      req.on('end', () => {
        framesReceived++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, frame: framesReceived }));
      });
      return;
    }

    if (req.url === '/done' && req.method === 'POST') {
      req.on('data', () => {});
      req.on('end', () => {
        console.log(`\n[capture] All ${framesReceived} frames received. Finalizing FFmpeg encoding...`);
        ffmpegProcess.stdin.end();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, totalFrames: framesReceived }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`[capture] FFmpeg encoder closed with exit code ${code}`);
    doneResolve({ code, framesReceived });
  });

  ffmpegProcess.on('error', (err) => {
    console.error('[capture] FFmpeg encoder process error:', err);
  });

  await new Promise((resolve) => server.listen(FRAME_SERVER_PORT, '127.0.0.1', resolve));
  console.log(`[capture] Frame pipe streaming server listening on 127.0.0.1:${FRAME_SERVER_PORT}`);

  return {
    server,
    waitForDone: () => donePromise,
  };
}

async function runCapture() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  VALLEYBALL VERSUS — DETERMINISTIC 1080p60 TRAILER CAPTURE       ║');
  console.log('║      Zero Dropped Frames | NVIDIA RTX 3050 Ti | 94.500s CFR      ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  await ensureTitleCardAndCaptions();

  const compositeOnly = process.argv.includes('--composite-only') && fs.existsSync(RAW_MP4);
  // --harvest-only stops after the harvest, so it must not start the frame
  // receiver: that deletes RAW_MP4 to make room for the new capture.
  const harvestOnly = process.argv.includes('--harvest-only');
  if (!compositeOnly) {
    // 1. Start frame pipe receiver and FFmpeg child process
    const receiver = harvestOnly ? null : await startFramePipeReceiver(RAW_MP4);

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

    // 3. Launch GPU-Accelerated Chromium forced onto NVIDIA RTX 3050 Ti
    console.log('[capture] Spawning GPU-accelerated Chromium with NVIDIA RTX 3050 Ti hardware lock...');
    const browser = await chromium.launch({
      headless: true,
      channel: 'chromium',
      args: [
        '--force_high_performance_gpu',
        '--use-gl=angle',
        '--use-angle=d3d11',
        '--enable-gpu-rasterization',
        '--enable-zero-copy',
        '--ignore-gpu-blocklist',
        '--no-sandbox',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--window-size=1920,1080',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();
    page.setDefaultTimeout(600000);

    // 4. Load Valleyball Versus
    const url = `http://localhost:${VITE_PORT}/Valleyball-Versus/`;
    console.log(`[capture] Navigating ${url}...`);
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForTimeout(5000); // Allow assets, shaders, and arena.glb to settle

    // 5. Setup match, verify active GPU, pre-warm WebGL shaders, and enter deterministic mode
    const setupInfo = await page.evaluate(async ({ shadowQuality, shadowMapSize }) => {
      // Hide all UI
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

      // Verify Active GPU renderer
      const canvas = document.getElementById('viewport');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const activeRenderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

      // Start 1v1 AI vs AI Match with Red (Football Helmet / wrestler_bands) vs Blue (Cricket Helmet / wicket_grill)
      if (window.__vb && window.__vb.startMatch) {
        const configs = [
          { id: 'p1', name: 'Home Bot', team: 'home', variant: 'masculine', cameraMode: 'chase', type: 'ai', difficulty: 'hard', aggressiveness: 0.95, primaryColor: 0xD90429, headwear: 'wrestler_bands' },
          { id: 'p2', name: 'Away Bot', team: 'away', variant: 'masculine', cameraMode: 'chase', type: 'ai', difficulty: 'hard', aggressiveness: 0.95, primaryColor: 0x1D4ED8, headwear: 'wicket_grill' }
        ];
        window.__vb.startMatch(configs, { ball: 'medium', duration: 300, arena: 'court' });
        if (window.__vb.skipFlyover) window.__vb.skipFlyover();

        if (window.__vb.athletes) {
          if (window.__vb.athletes[0]?.setHeadwear) window.__vb.athletes[0].setHeadwear('wrestler_bands');
          if (window.__vb.athletes[1]?.setHeadwear) window.__vb.athletes[1].setHeadwear('wicket_grill');
        }

        if (window.__vb.matchState) {
          window.__vb.matchState.countdownTicksRemaining = Math.round(14.40 * 60);
          window.__vb.matchState.isCountingDown = true;
        }
        if (window.__vb.scoreboards?.group) window.__vb.scoreboards.group.visible = true;
        if (window.__vb.hustleBoards?.group) window.__vb.hustleBoards.group.visible = true;
      }

      // Stadium lighting at trailer quality, set before the warmup so the
      // shadow-casting shader variants compile there rather than on frame 0.
      window.__vb.applyRenderSettings({ shadowQuality });
      const lighting = [];
      window.__vb.scene.traverse((obj) => {
        if (!obj.isDirectionalLight) return;
        if (obj.castShadow) {
          obj.shadow.mapSize.set(shadowMapSize, shadowMapSize);
          if (obj.shadow.map) {
            obj.shadow.map.dispose();
            obj.shadow.map = null;
          }
        }
        lighting.push(obj.castShadow ? obj.shadow.mapSize.x : 0);
      });

      // 2-second render warmup to compile all shaders
      await new Promise(r => setTimeout(r, 2000));

      // Halt the real-time requestAnimationFrame Loop: deterministic frame stepping takes over!
      if (window.__vb?.loop) {
        window.__vb.loop.stop();
      }

      // Run 80+ Unscripted Match Harvest & Highlight Miner before starting trailer playback!
      let harvestReport = null;
      if (window.__vb?.trailerDirector?.runHarvest) {
        harvestReport = window.__vb.trailerDirector.runHarvest();
      }

      // Start TrailerDirector at t=0
      if (window.__vb?.trailerDirector) {
        window.__vb.trailerDirector.start(0);
      }

      // Game-SFX events shown on each trailer frame, for the offline SFX stem:
      // playback replays recorded poses, so the game's sound dispatch never runs.
      // Read-only walk of the schedule; it does not touch playback state.
      const sfxEvents = [];
      const td = window.__vb?.trailerDirector;
      if (td?._schedule?.length) {
        const radiusOf = { small: 0.20, medium: 0.50, large: 0.75 };
        let lastGlassFrame = -99;
        for (let frame = 0; frame < 5028; frame++) {
          const entry = td._getScheduleEntryForFrame(frame);
          if (!entry?.game?.frames) continue;
          const local = frame - entry.startFrame;
          const clipTick = entry.startTick + local;
          // Past the clip's last tick playback holds the final pose: no new events
          if (clipTick >= entry.game.frames.length) continue;
          const rec = entry.game.frames[clipTick];
          const prev = local > 0 ? entry.game.frames[clipTick - 1] : null;
          if (!rec) continue;
          const radius = radiusOf[entry.game.ballType || entry.ballType || 'medium'] ?? 0.5;
          if (rec.hitBy !== -1) {
            const grounded = rec.hitBy === 0 ? rec.p1Grounded : rec.p2Grounded;
            sfxEvents.push({ frame, type: 'strike', kind: rec.hitKind, speed: rec.bSpeed, radius, airborne: !grounded });
          } else if (prev && prev.bvy < -1.2 && rec.bvy > 0.3 && !rec.wallBounce) {
            sfxEvents.push({ frame, type: 'bounce', speed: -prev.bvy, radius });
          }
          if (rec.wallBounce && frame - lastGlassFrame > 8) {
            lastGlassFrame = frame;
            sfxEvents.push({ frame, type: 'glass', speed: rec.bSpeed });
          }
          if (entry.goalTick >= 0 && clipTick === entry.goalTick) {
            sfxEvents.push({ frame, type: 'goal' });
          }
        }
      }

      return { activeRenderer, harvestReport, lighting, sfxEvents };
    }, { shadowQuality: TRAILER_SHADOW_QUALITY, shadowMapSize: TRAILER_SHADOW_MAP_SIZE });

    console.log(`[capture] Active WebGL Renderer: ${setupInfo.activeRenderer}`);
    console.log(`[capture] Stadium lighting: ${TRAILER_SHADOW_QUALITY}, shadow maps per directional light ${JSON.stringify(setupInfo.lighting)} (0 = no shadow)`);
    fs.writeFileSync(SFX_EVENTS_JSON, JSON.stringify(setupInfo.sfxEvents));
    console.log(`[capture] Exported ${setupInfo.sfxEvents.length} game-SFX events -> ${SFX_EVENTS_JSON}`);
    if (setupInfo.harvestReport) {
      const hr = setupInfo.harvestReport;
      console.log(
        `[capture] Unscripted Harvest Complete: ${hr.gamesSimulated} games (${hr.totalSimTicks} ticks) in ${hr.elapsedSec}s | ` +
        `North Goals: ${hr.northGoalsCount}, South Goals: ${hr.southGoalsCount}, Real Hits: ${hr.totalHitsCount}, ` +
        `Aerial Spikes: ${hr.spikeEventsCount}, Dive/Slide Ticks: ${hr.diveEventsCount}, Wall Caroms: ${hr.wallCaromsCount}`
      );
      const maxStepOverall = Math.max(...hr.scheduleSummary.map((s) => s.maxBallStep));
      const totalRunAway = hr.scheduleSummary.reduce((acc, s) => acc + s.runningAwayTicks, 0);
      console.log(`[capture] Schedule Audit (${hr.scheduleCount} cuts): Max single-tick ball step = ${maxStepOverall.toFixed(3)}m (0 respawns verified!) | Total running-away ticks = ${totalRunAway}`);
      console.table(hr.scheduleSummary);
      if (harvestOnly) {
        await browser.close();
        await viteServer.close();
        process.exit(0);
      }
    }
    console.log('[capture] Real-time loop halted. Beginning deterministic frame-by-frame stepping...');

    // 6. Deterministic Frame-Stepping Loop (5,028 frames @ 60.00 FPS = exactly 83.800 seconds)
    const TOTAL_FRAMES = 5028; // 83.800s * 60 FPS
    console.log(`[capture] Stepping & piping ${TOTAL_FRAMES} frames (83.800s footage @ 60 FPS)...`);

    const tStart = Date.now();
    await page.evaluate(async ({ totalFrames, framePort, jpegQuality }) => {
      const canvas = document.getElementById('viewport');
      const dt = 1 / 60;

      for (let frame = 0; frame < totalFrames; frame++) {
        // 1. Step simulation, physics, and directorial camera by exactly 1/60s
        window.__vb.stepDeterministicFrame(dt);

        // 2. Export canvas to a near-lossless JPEG blob
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', jpegQuality));

        // 3. Pipe binary frame over HTTP directly into FFmpeg stdin
        await fetch(`http://127.0.0.1:${framePort}/frame`, {
          method: 'POST',
          body: blob
        });

        // Periodic progress reporting
        if (frame > 0 && frame % 300 === 0) {
          console.log(`[in-page] Stepped ${frame}/${totalFrames} frames (${(frame / 60).toFixed(1)}s / 83.8s)`);
        }
      }

      // Notify receiver that all frames have completed
      await fetch(`http://127.0.0.1:${framePort}/done`, { method: 'POST' });
    }, { totalFrames: TOTAL_FRAMES, framePort: FRAME_SERVER_PORT, jpegQuality: FRAME_JPEG_QUALITY });

    const captureElapsedSec = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`[capture] Frame stepping complete in ${captureElapsedSec}s (avg ${(TOTAL_FRAMES / captureElapsedSec).toFixed(1)} FPS encoding speed).`);

    // Wait for FFmpeg process to close
    await receiver.waitForDone();
    receiver.server.close();

    const rawSizeMb = (fs.statSync(RAW_MP4).size / (1024 * 1024)).toFixed(2);
    console.log(`[capture] Deterministic footage stream created: ${RAW_MP4} (${rawSizeMb} MB)`);

    // Close browser and Vite
    await browser.close();
    await viteServer.close();
  } else {
    console.log(`[capture] --composite-only mode: Using existing ${RAW_MP4}`);
  }

  // 7. Post-Processing & Deliverable Assembly via FFmpeg
  console.log('\n=== ASSEMBLING FINAL BROADCAST DELIVERABLES (FFMPEG) ===');
  console.log(`[capture] Compositing footage (83.800s, 5028 frames) + ${ALL_TRAILER_OVERLAYS.length} Brand-Guide Overlays + galaxy title card (10.700s, 642 frames) with Neon Velocity (94.500s total)...`);

  // Build Overlay Filter Chain (6 Phase-1 Brand Cards + 7 Phase 2-4 Impact Words)
  const captionInputs = [];
  const captionFilterSteps = [];
  const skipBaseFade = process.argv.includes('--from-faded-master');
  const baseV0Filter = skipBaseFade
    ? '[0:v]trim=duration=83.8,fps=60,setpts=PTS-STARTPTS[vbase0]'
    : '[0:v]trim=duration=83.8,fade=t=in:st=0:d=2.0,fade=t=out:st=83.0:d=0.8,fps=60,setpts=PTS-STARTPTS[vbase0]';

  ALL_TRAILER_OVERLAYS.forEach((cap, idx) => {
    const inputIdx = 3 + idx;
    const capPath = path.join(CAPTIONS_DIR, cap.file);
    const streamDur = (cap.endSec + 0.25).toFixed(2);
    captionInputs.push('-loop', '1', '-t', streamDur, '-r', '60', '-i', capPath);
    const fadeInDur = (cap.fadeInSec ?? 0.35).toFixed(2);
    const fadeOutDur = (cap.fadeOutSec ?? 0.35).toFixed(2);
    const fadeOutStart = Math.max(cap.startSec, cap.endSec - (cap.fadeOutSec ?? 0.35)).toFixed(2);
    captionFilterSteps.push(
      `[${inputIdx}:v]format=rgba,fade=t=in:st=${cap.startSec.toFixed(2)}:d=${fadeInDur}:alpha=1,fade=t=out:st=${fadeOutStart}:d=${fadeOutDur}:alpha=1[cap${idx}]`
    );
    const prevLabel = idx === 0 ? 'vbase0' : `vcap${idx - 1}`;
    const nextLabel = idx === ALL_TRAILER_OVERLAYS.length - 1 ? 'v0' : `vcap${idx}`;
    captionFilterSteps.push(
      `[${prevLabel}][cap${idx}]overlay=0:0:eof_action=pass:enable='between(t,${cap.startSec.toFixed(2)},${cap.endSec.toFixed(2)})'[${nextLabel}]`
    );
  });

  const filterGraph = [
    baseV0Filter,
    ...captionFilterSteps,
    '[1:v]trim=duration=10.7,fade=t=in:st=0:d=0.8,fps=60,setpts=PTS-STARTPTS[v1]',
    '[v0][v1]concat=n=2:v=1:a=0,trim=duration=94.5,fps=60,setpts=PTS-STARTPTS[vout]'
  ].join(';');

  // Game-SFX stem from the events exported by the capture that made RAW_MP4
  if (fs.existsSync(SFX_EVENTS_JSON) && !process.argv.includes('--no-sfx')) {
    const events = JSON.parse(fs.readFileSync(SFX_EVENTS_JSON, 'utf8'));
    const counts = buildSfxStem(events, { audioDir: path.join(ROOT, 'public', 'audio'), outPath: SFX_STEM, durationSec: 94.5 });
    console.log(`[capture] Game-SFX stem: ${JSON.stringify(counts)} -> ${SFX_STEM}`);
  } else if (fs.existsSync(SFX_STEM)) {
    fs.unlinkSync(SFX_STEM);
  }

  const audioMaster = masterAudio();

  // A. Broadcast Master (1080p60 high-bitrate H.264 / 320k AAC)
  console.log('\n[capture] Encoding Deliverable 1: Broadcast Master 1080p60 MP4...');
  const masterArgs = [
    '-y',
    '-i', RAW_MP4,
    '-loop', '1', '-t', '12.0', '-r', '60', '-i', TITLE_CARD,
    '-i', audioMaster,
    ...captionInputs,
    '-filter_complex', filterGraph,
    '-map', '[vout]',
    '-map', '2:a',
    '-r', '60',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '17',
    '-fps_mode', 'cfr',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '320k',
    MASTER_MP4
  ];
  execFileSync('ffmpeg', masterArgs, { stdio: 'inherit' });
  const masterSizeMb = (fs.statSync(MASTER_MP4).size / (1024 * 1024)).toFixed(2);
  console.log(`[capture] Master MP4 created: ${MASTER_MP4} (${masterSizeMb} MB)`);

  // B. Social Web Cut (<25 MB for Twitter / Discord)
  console.log('\n[capture] Encoding Deliverable 2: Social Web Cut (<25 MB)...');
  // Two-pass to a 24 MB budget: CRF with a maxrate cap can't promise a size.
  const socialAudioKbps = 192;
  const socialVideoKbps = Math.floor((24 * 8 * 1024 * 1024) / 94.5 / 1000) - socialAudioKbps;
  const socialVideoArgs = [
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-b:v', `${socialVideoKbps}k`,
    '-pix_fmt', 'yuv420p',
    '-passlogfile', path.join(OUT_DIR, 'social_2pass'),
  ];
  execFileSync('ffmpeg', ['-y', '-i', MASTER_MP4, ...socialVideoArgs, '-pass', '1', '-an', '-f', 'null', '-'], { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-y', '-i', MASTER_MP4, ...socialVideoArgs, '-pass', '2', '-c:a', 'aac', '-b:a', `${socialAudioKbps}k`, SOCIAL_MP4], { stdio: 'inherit' });
  const socialSizeMb = (fs.statSync(SOCIAL_MP4).size / (1024 * 1024)).toFixed(2);
  console.log(`[capture] Social Web MP4 created: ${SOCIAL_MP4} (${socialSizeMb} MB)`);

  // Only clean up intermediate raw footage file if explicitly requested
  if (process.argv.includes('--cleanup-raw') && fs.existsSync(RAW_MP4)) {
    fs.unlinkSync(RAW_MP4);
  }

  // C. Milestone Verification Stills
  console.log('\n[capture] Extracting milestone verification stills from Master MP4...');
  const milestoneDir = path.join(OUT_DIR, 'milestone_frames');
  fs.mkdirSync(milestoneDir, { recursive: true });
  const brainMilestoneDir = 'C:\\Users\\portt\\.gemini\\antigravity\\brain\\5620eac9-cfe9-40c7-8710-7fadbd85d66d\\milestone_frames';
  fs.mkdirSync(brainMilestoneDir, { recursive: true });

  const milestones = [
    { name: '01_phase1_north_torus_cathedral_arch.png', time: '00:00:01.800' },
    { name: '02_phase1_red_contender_portrait.png', time: '00:00:06.200' },
    { name: '03_phase1_blue_contender_portrait.png', time: '00:00:09.000' },
    { name: '04_phase1_stream_heads_ramps_glide.png', time: '00:00:14.000' },
    { name: '05_phase1_turf_level_sideline_glide.png', time: '00:00:21.500' },
    { name: '06_phase1_stadium_boom_arc.png', time: '00:00:30.000' },
    { name: '07_phase1_low_predrop_tension_push.png', time: '00:00:40.000' },
    { name: '08_phase2_drop_attack_sprint.png', time: '00:00:44.600' },
    { name: '09_phase2_low_turf_diving_save.png', time: '00:00:46.500' },
    { name: '10_phase2_vertical_aerial_spike.png', time: '00:00:48.300' },
    { name: '11_phase2_banked_wall_carom.png', time: '00:00:50.200' },
    { name: '12_phase2_goal_1_south_torus_crossing.png', time: '00:00:51.850' },
    { name: '13_phase2_goal_2_north_torus_crossing.png', time: '00:00:55.450' },
    { name: '14_phase2_goal_3_south_torus_crossing.png', time: '00:00:59.050' },
    { name: '15_phase3_goal_4_north_torus_blitz.png', time: '00:01:05.350' },
    { name: '16_phase3_goal_5_south_torus_blitz.png', time: '00:01:09.850' },
    { name: '17_phase3_apex_micro_cut_frenzy.png', time: '00:01:14.500' },
    { name: '18_phase4_climax_goal_6_north_torus.png', time: '00:01:17.150' },
    { name: '19_phase4_celestial_ascension_arc.png', time: '00:01:22.000' },
    { name: '20_phase5_galaxy_title_card.png', time: '00:01:29.000' },
  ];

  for (const m of milestones) {
    const outPath = path.join(milestoneDir, m.name);
    execFileSync('ffmpeg', [
      '-y',
      '-ss', m.time,
      '-i', MASTER_MP4,
      '-vframes', '1',
      outPath
    ], { stdio: 'ignore' });
    fs.copyFileSync(outPath, path.join(brainMilestoneDir, m.name));
    console.log(`[capture] Extracted & synced milestone: ${m.name}`);
  }

  console.log('\n=== TRAILER PRODUCTION COMPLETE ===');
}

runCapture().catch(err => {
  console.error('[capture] Error during capture:', err);
  process.exit(1);
});
