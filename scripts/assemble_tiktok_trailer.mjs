/**
 * VALLEYBALL VERSUS — OFFICIAL TIKTOK / VERTICAL (9:16) TRAILER COMPOSITOR
 *
 * Adapts the 94.500s 1080p60 Master Trailer into a broadcast-grade 9:16 vertical format:
 * - Resolution: 1080x1920 @ 60.00 FPS CFR (setsar=1, square pixels)
 * - Layer 1: Ambient Dynamic Background (real-time blurred, darkened gameplay reflection)
 * - Layer 2: Centered 16:9 Viewport (1080x608 uncropped gameplay at y=656)
 * - Layer 3: Diegetic Brand & HUD Frame Overlay (brand logo, spectral seam, 60fps metadata)
 * - Layer 4: Fullscreen 9:16 Galaxy Title Card outro (fades in at 85.60s to 94.50s)
 * - Audio: Retains the pristine -14 LUFS dual-stem master (Neon Velocity + boosted SFX)
 *
 * Deliverables:
 * 1. valleyball_versus_trailer_tiktok_9x16_1080p60.mp4 (High-bitrate Broadcast Master)
 * 2. valleyball_versus_trailer_tiktok_9x16_social.mp4 (<25 MB Social Web Cut)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'captures', 'trailer');
const MILESTONE_DIR = path.join(OUT_DIR, 'milestone_frames_tiktok');

const TRAILER_SRC = path.join(OUT_DIR, 'valleyball_versus_official_trailer_Graphics_1080p60.mp4');
const OVERLAY_SRC = path.join(OUT_DIR, 'tiktok_frame_overlay.png');
const TITLE_CARD_SRC = path.join(OUT_DIR, 'title_card_vertical_9x16.png');

const MASTER_OUTPUT = path.join(OUT_DIR, 'valleyball_versus_trailer_tiktok_9x16_1080p60.mp4');
const SOCIAL_OUTPUT = path.join(OUT_DIR, 'valleyball_versus_trailer_tiktok_9x16_social.mp4');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(MILESTONE_DIR, { recursive: true });

async function assembleTikTokTrailer() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║    VALLEYBALL VERSUS — OFFICIAL TIKTOK 9:16 TRAILER ADAPTER      ║');
  console.log('║        1080x1920 @ 60.00 FPS CFR | Broadcast & Social Cuts       ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  if (!fs.existsSync(TRAILER_SRC)) {
    throw new Error(`Master trailer source missing: ${TRAILER_SRC}`);
  }

  // Ensure 9:16 graphics exist
  if (!fs.existsSync(OVERLAY_SRC) || !fs.existsSync(TITLE_CARD_SRC)) {
    console.log('[tiktok] Generating 9:16 frame overlay and title card...');
    execFileSync('node', [path.join(ROOT, 'scripts', 'generate_tiktok_graphics.mjs')], { stdio: 'inherit' });
  }

  // Complex Filter Graph:
  // 1. [0:v] -> downscale to 270x480, boxblur=8:2, color grade (brightness -0.35, saturation 1.2), upscale to 1080x1920 bicubic -> [bg]
  // 2. [0:v] -> scale to 1080x608 lanczos -> [fg]
  // 3. [bg][fg] -> overlay foreground at x=0, y=656 -> [comp]
  // 4. [comp][1:v] -> overlay frame overlay HUD -> [with_hud]
  // 5. [2:v] -> fade in at 85.60s with 0.8s duration -> [title]
  // 6. [with_hud][title] -> overlay fullscreen title card enabled at t>=85.60 -> [vout]
  const filterComplex = [
    // Dynamic Ambient Background
    '[0:v]scale=270:480:force_original_aspect_ratio=increase,' +
      'crop=270:480,boxblur=8:2,' +
      'eq=brightness=-0.35:saturation=1.2,' +
      'scale=1080:1920:flags=bicubic,setsar=1[bg]',

    // Centered 16:9 Viewport
    '[0:v]scale=1080:608:flags=lanczos,setsar=1[fg]',

    // Merge Viewport onto Background
    '[bg][fg]overlay=0:656[comp]',

    // Overlay Diegetic Frame HUD
    '[comp][1:v]overlay=0:0[with_hud]',

    // Vertical Galaxy Title Card for Outro Lock (85.60s - 94.50s)
    '[2:v]format=rgba,fade=t=in:st=85.6:d=0.8:alpha=1,setsar=1[title]',
    '[with_hud][title]overlay=0:0:enable=\'gte(t,85.6)\'[vout]'
  ].join(';');

  console.log('[tiktok] === STEP 1: RENDERING BROADCAST MASTER DELIVERABLE (1080x1920 60 FPS CFR) ===');
  execFileSync('ffmpeg', [
    '-y',
    '-i', TRAILER_SRC,
    '-loop', '1',
    '-t', '94.5',
    '-i', OVERLAY_SRC,
    '-loop', '1',
    '-t', '94.5',
    '-i', TITLE_CARD_SRC,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '0:a:0',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-r', '60',
    '-fps_mode', 'cfr',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '256k',
    '-ar', '48000',
    MASTER_OUTPUT
  ], { stdio: 'inherit' });

  const masterStat = fs.statSync(MASTER_OUTPUT);
  const masterSizeMb = (masterStat.size / (1024 * 1024)).toFixed(2);
  console.log(`\n✓ Broadcast TikTok Master: ${MASTER_OUTPUT} (${masterSizeMb} MB)`);

  console.log('\n[tiktok] === STEP 2: ENCODING SOCIAL WEB CUT (<25 MB FOR DISCORD / MOBILE) ===');
  execFileSync('ffmpeg', [
    '-y',
    '-i', MASTER_OUTPUT,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '24.5',
    '-maxrate', '1900k',
    '-bufsize', '3800k',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    SOCIAL_OUTPUT
  ], { stdio: 'inherit' });

  const socialStat = fs.statSync(SOCIAL_OUTPUT);
  const socialSizeMb = (socialStat.size / (1024 * 1024)).toFixed(2);
  console.log(`✓ Social Web Cut: ${SOCIAL_OUTPUT} (${socialSizeMb} MB)`);

  console.log('\n[tiktok] === STEP 3: EXTRACTING MILESTONE VERIFICATION STILLS ===');
  const milestones = [
    { name: '01_phase1_stadium_and_hud.png', time: '00:00:02.500' },
    { name: '02_phase1_red_contender.png', time: '00:00:06.500' },
    { name: '03_phase2_action_drop_play.png', time: '00:00:44.800' },
    { name: '04_phase2_diving_save.png', time: '00:00:46.800' },
    { name: '05_phase3_rapid_fire_rally.png', time: '00:01:05.500' },
    { name: '06_phase4_climax_torus_goal.png', time: '00:01:17.500' },
    { name: '07_phase5_fullscreen_title_card.png', time: '00:01:29.000' },
  ];

  for (const m of milestones) {
    const outPath = path.join(MILESTONE_DIR, m.name);
    execFileSync('ffmpeg', [
      '-y',
      '-ss', m.time,
      '-i', MASTER_OUTPUT,
      '-vframes', '1',
      '-f', 'image2',
      '-update', '1',
      outPath
    ], { stdio: 'ignore' });
    console.log(`  ✓ Milestone: ${m.name}`);
  }

  console.log('\n================================================================');
  console.log('           TIKTOK TRAILER ADAPTATION COMPLETE!                  ');
  console.log('================================================================\n');
}

assembleTikTokTrailer().catch(err => {
  console.error('[tiktok] Error during assembly:', err);
  process.exit(1);
});
