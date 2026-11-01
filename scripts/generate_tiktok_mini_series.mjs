/**
 * VALLEYBALL VERSUS — TIKTOK 3-PART MINI-SERIES ENGINE
 *
 * Produces 3 targeted, digestible, full-resolution 9:16 vertical videos:
 * 1. Video 1: "Base Game Mechanics" (Active Ragdolls, Kicks, Spikes, Dives, 3 Ball Weights)
 * 2. Video 2: "Arena Elements" (Parabolic Basin, No Out-of-Bounds, Stream Ramps, 10m Torus Hoops)
 * 3. Video 3: "High-Octane Action & Goal Scoring" (32 m/s Strikes, Layout Saves, Torus Goals & Sirens)
 *
 * Framing:
 * - 1080x1920 @ 60 FPS CFR
 * - Uncropped 16:9 gameplay centered (full court spread visible, NOT zoomed in!)
 * - Soft ambient blurred arena background reflection
 * - Clean diegetic topic headers & synced explanatory captions
 * - Fullscreen 9:16 Galaxy Title Card outro lock
 * - Mastered dual-stem audio (Neon Velocity + boosted in-game impacts)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'captures', 'trailer');
const SERIES_DIR = path.join(OUT_DIR, 'mini_series_tiktok');
const TEMP_DIR = path.join(ROOT, 'captures', 'mini_series_temp');

const INENGINE_SRC = path.join(OUT_DIR, 'raw_footage_1080p60.mp4');
const MUSIC_SRC = path.join(ROOT, 'public', 'audio', 'music', 'track_trailer_neon_velocity.mp3');
const TITLE_CARD_SRC = path.join(OUT_DIR, 'title_card_vertical_9x16.png');
const RAW_CHUNKS_DIR = path.join(ROOT, 'captures', 'raw_footage', 'raw_chunks');
const SOCIALS_DIR = path.join(ROOT, 'captures', 'socials');

fs.mkdirSync(SERIES_DIR, { recursive: true });
fs.mkdirSync(TEMP_DIR, { recursive: true });

// Define the 3 Videos with exact beat-quantized cut sequences (12 Bars @ 1.800s = 21.600s each)
const VIDEOS = [
  {
    id: 'ep01_game_mechanics',
    title: 'BASE GAME MECHANICS',
    subtitle: 'SOCCER × VOLLEYBALL × ACTIVE RAGDOLL PHYSICS',
    tag: 'FIELD MANUAL // 01',
    description: 'Master active ragdoll limb strikes, timed sweet-spots, and 3 ball weight classes.',
    filename: 'valleyball_versus_tiktok_01_mechanics.mp4',
    cuts: [
      {
        id: 'c1_hero_intro',
        src: INENGINE_SRC,
        startSec: 5.4,
        durationSec: 1.800,
        tag: 'CORE CONCEPT // ACTIVE PHYSICS',
        head: 'ACTIVE RAGDOLL ATHLETES',
        body: 'Every limb is live 3D physics. No canned animations or magnet snaps.',
        chips: ['ACTIVE RAGDOLLS', 'LIVE MASS', '100% PHYSICS']
      },
      {
        id: 'c2_kicks_volleys',
        src: path.join(SOCIALS_DIR, 'clip_01_red_vs_blue_goal_medium_low_turf_tracking.mp4'),
        startSec: 1.8,
        durationSec: 3.600,
        tag: 'STRIKE COMBAT // SWEET-SPOTS',
        head: 'SWEET-SPOT KICKS & VOLLEYS',
        body: 'Time your swings on incoming bounces for +55° lofted kicks or two-hand volleys.',
        chips: ['TIMED CONTACT', '+55° KICKS', 'VOLLEY CONTROL']
      },
      {
        id: 'c3_jump_spikes',
        src: path.join(SOCIALS_DIR, 'clip_05_red_vs_blue_spike_small_action_orbit.mp4'),
        startSec: 1.5,
        durationSec: 3.600,
        tag: 'AERIAL COMBAT // SPIKES',
        head: 'AIRBORNE JUMP-SPIKES',
        body: 'Leap above the rim to unleash downward jump-spikes with crushing power.',
        chips: ['AIRBORNE LIFTOFF', 'RIM CLEARANCE', 'DOWNWARD SPIKES']
      },
      {
        id: 'c4_dives_slides',
        src: path.join(SOCIALS_DIR, 'clip_02_red_vs_blue_dive_small_flank_torus_north.mp4'),
        startSec: 1.2,
        durationSec: 3.600,
        tag: 'DEFENSIVE AGILITY // DIVES',
        head: 'LAYOUT DIVING SAVES',
        body: 'Desperate horizontal dives across the turf to save sinking ball trajectories.',
        chips: ['LAYOUT DIVES', 'TURF SLIDES', 'REBOUND SAVES']
      },
      {
        id: 'c5_ball_classes',
        src: path.join(SOCIALS_DIR, 'clip_03_red_vs_blue_slide_large_flank_torus_south.mp4'),
        startSec: 1.0,
        durationSec: 3.600,
        tag: 'EQUIPMENT // 3 BALL CLASSES',
        head: 'LIGHT · MEDIUM · HEAVY BALLS',
        body: 'Light for supersonic aerial speed, Medium for balanced duels, Heavy for momentum brawls.',
        chips: ['LIGHT: PRO SPEED', 'MEDIUM: BALANCED', 'HEAVY: MOMENTUM']
      },
      {
        id: 'c6_title_outro',
        type: 'title_card',
        durationSec: 5.400
      }
    ]
  },

  {
    id: 'ep02_arena_elements',
    title: 'THE ARENA ELEMENTS',
    subtitle: 'PARABOLIC BASIN • ZERO STOPPAGE • 10M HOOPS',
    tag: 'FIELD MANUAL // 02',
    description: 'Explore the continuous perimeter glass, stream channels, 11m ramps, and elevated Torus hoops.',
    filename: 'valleyball_versus_tiktok_02_arena.mp4',
    cuts: [
      {
        id: 'c1_basin_reveal',
        src: INENGINE_SRC,
        startSec: 0.0,
        durationSec: 3.600,
        tag: 'ARENA ARCHITECTURE // BASIN',
        head: 'THE PARABOLIC BASIN',
        body: 'A 120-meter curved gravity bowl. Steep slopes naturally funnel all play toward center.',
        chips: ['120M BASIN', 'PARABOLIC SLOPES', 'GRAVITY DYNAMICS']
      },
      {
        id: 'c2_perimeter_glass',
        src: path.join(SOCIALS_DIR, 'clip_04_red_vs_blue_cut_medium_banked_wall_curve.mp4'),
        startSec: 1.2,
        durationSec: 3.600,
        tag: 'RULES OF ENGAGEMENT // FLOW',
        head: 'NO OUT OF BOUNDS. ZERO WHISTLES.',
        body: 'Continuous perimeter glass keeps the ball live for 5 full minutes of regulation.',
        chips: ['ZERO STOPPAGE', 'BANKED CAROMS', 'CONTINUOUS PLAY']
      },
      {
        id: 'c3_stream_ramps',
        src: INENGINE_SRC,
        startSec: 11.5,
        durationSec: 3.600,
        tag: 'TOPOGRAPHY // SPEED CHANNELS',
        head: 'STREAM CHANNELS & 11M RAMPS',
        body: 'Carve the side stream beds and launch off 11-meter corner ramps for aerial elevation.',
        chips: ['STREAM CHANNELS', '11M RAMPS', 'AERIAL LAUNCH']
      },
      {
        id: 'c4_torus_hoops',
        src: INENGINE_SRC,
        startSec: 25.5,
        durationSec: 3.600,
        tag: 'SCORING TARGETS // ELEVATION',
        head: '10-METER ELEVATED TORUS HOOPS',
        body: 'Ancient stone-ring competition evolved: drive the sphere through the elevated ring to score.',
        chips: ['10M ELEVATION', 'TORUS RING', 'HIGH-VELOCITY TARGET']
      },
      {
        id: 'c5_instant_flip',
        src: INENGINE_SRC,
        startSec: 51.5,
        durationSec: 1.800,
        tag: 'THE SCORING LOOP // TRANSITION',
        head: 'SCORE A GOAL · FLIP THE COURT',
        body: 'Every goal immediately flips the active hoop to the opposite end for instant counter-attacks.',
        chips: ['NO RESETS', 'INSTANT COUNTER', 'END-TO-END']
      },
      {
        id: 'c6_title_outro',
        type: 'title_card',
        durationSec: 5.400
      }
    ]
  },

  {
    id: 'ep03_action_scoring',
    title: 'ACTION & GOAL SCORING',
    subtitle: '32 M/S STRIKES • CLUTCH DIVES • TORUS GOALS',
    tag: 'FIELD MANUAL // 03',
    description: 'High-octane rallies, supersonic strikes, desperate layout saves, and Torus goals.',
    filename: 'valleyball_versus_tiktok_03_action_scoring.mp4',
    cuts: [
      {
        id: 'c1_supersonic_strike',
        src: path.join(SOCIALS_DIR, 'clip_48_action_rally_large_over_shoulder_chase_classic_vs_masculine.mp4'),
        startSec: 0.5,
        durationSec: 3.600,
        tag: 'TOP RECORDED VELOCITY // SPEED',
        head: 'SUPERSONIC 32.0 M/S STRIKES',
        body: 'Heavy momentum strikes reach breakneck velocities across the curved valley floor.',
        chips: ['32.0 M/S SPEED', 'HEAVY HIT', 'BREAKAWAY DUEL']
      },
      {
        id: 'c2_clutch_dives',
        src: path.join(SOCIALS_DIR, 'clip_38_action_dive_small_flank_torus_north_feminine_vs_classic.mp4'),
        startSec: 0.8,
        durationSec: 3.600,
        tag: 'DEFENSIVE MIRACLES // TURF',
        head: 'LAST-SECOND LAYOUT SAVES',
        body: 'Contenders risk body and limb diving full stretch to deny certainty goals.',
        chips: ['FULL EXTENSION', 'GOAL-LINE SAVE', 'TURF SKID']
      },
      {
        id: 'c3_wall_caroms',
        src: path.join(SOCIALS_DIR, 'clip_22_action_cut_medium_banked_wall_curve_masculine_vs_feminine.mp4'),
        startSec: 1.0,
        durationSec: 3.600,
        tag: 'TACTICAL REBOUNDS // WALLS',
        head: 'BANKED WALL FAST BREAKS',
        body: 'Carom strikes off the perimeter glass to bypass defenders and set up clean finishes.',
        chips: ['BANK CAROMS', 'WALL RIDES', 'ANGLED STRIKES']
      },
      {
        id: 'c4_climax_goal',
        src: INENGINE_SRC,
        startSec: 71.2,
        durationSec: 3.600,
        tag: 'THE SCORING MOMENT // GOAL',
        head: 'THREADING THE TORUS RING',
        body: 'Airborne strike threading the elevated aperture as celebration sirens sound out.',
        chips: ['TORUS GOAL', 'SIREN ACTIVATION', 'SCORE ADVANCE']
      },
      {
        id: 'c5_victory_ascend',
        src: INENGINE_SRC,
        startSec: 78.4,
        durationSec: 1.800,
        tag: 'MATCH VICTORY // CELESTIAL',
        head: 'COMMAND THE BASIN',
        body: 'Crane camera ascends above the celebrating arena following the match winner.',
        chips: ['MATCH POINT', 'VICTORY ASCENT', 'CHAMPIONSHIP']
      },
      {
        id: 'c6_title_outro',
        type: 'title_card',
        durationSec: 5.400
      }
    ]
  }
];

async function generateCardOverlay(browser, video, cut, cutIndex, totalCuts) {
  const overlayPath = path.join(TEMP_DIR, `overlay_${video.id}_cut${cutIndex}.png`);
  if (cut.type === 'title_card') return null;

  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600;800&family=Space+Grotesk:wght@500;700&family=Syncopate:wght@700&display=swap" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      width: 1080px; height: 1920px;
      background: transparent;
      color: #F8FAFC;
      font-family: 'Space Grotesk', sans-serif;
      position: relative;
      overflow: hidden;
    }

    /* TOP HEADER ZONE (y = 120 to 600) */
    .top-header {
      position: absolute; top: 120px; left: 0; width: 1080px;
      display: flex; flex-direction: column; align-items: center; text-align: center;
      padding: 0 40px;
    }
    .series-tag {
      font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 800;
      color: #00E5FF; letter-spacing: 0.22em; text-transform: uppercase;
      background: rgba(10, 10, 14, 0.90); border: 2px solid rgba(0, 229, 255, 0.6);
      padding: 10px 28px; border-radius: 999px; margin-bottom: 16px;
      box-shadow: 0 0 25px rgba(0, 229, 255, 0.35);
    }
    .title {
      font-family: 'Syncopate', sans-serif; font-size: 46px; font-weight: 700;
      letter-spacing: 0.10em; text-transform: uppercase; line-height: 1.15;
      text-shadow: 0 0 30px rgba(0, 229, 255, 0.7), 0 0 60px rgba(31, 101, 255, 0.4);
    }
    .subtitle {
      font-size: 24px; font-weight: 700; color: #A5F3FC;
      letter-spacing: 0.10em; text-transform: uppercase; margin-top: 12px;
    }

    /* VIEWPORT FRAME ACCENTS (y = 656 to 1264) */
    .viewport-accent {
      position: absolute; top: 654px; left: 0; width: 1080px; height: 612px;
      border-top: 3px solid rgba(0, 229, 255, 0.7);
      border-bottom: 3px solid rgba(0, 229, 255, 0.7);
      box-shadow: 0 0 40px rgba(0, 229, 255, 0.3);
      pointer-events: none;
    }
    .hud-chip-left {
      position: absolute; top: -18px; left: 44px;
      background: #0A0A0C; padding: 6px 18px; border-radius: 6px;
      border: 1.5px solid rgba(0, 229, 255, 0.6);
      font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 800;
      letter-spacing: 0.15em; color: #00E5FF; text-transform: uppercase;
    }
    .hud-chip-right {
      position: absolute; top: -18px; right: 44px;
      background: #0A0A0C; padding: 6px 18px; border-radius: 6px;
      border: 1.5px solid rgba(255, 255, 255, 0.4);
      font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 800;
      letter-spacing: 0.15em; color: #FFF; text-transform: uppercase;
    }

    /* BOTTOM CAPTION CARD (y = 1285 to 1640) */
    .bottom-card {
      position: absolute; top: 1285px; left: 44px; right: 44px;
      background: rgba(10, 10, 14, 0.94);
      border: 2px solid rgba(255, 255, 255, 0.28);
      border-radius: 24px; padding: 28px 36px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.2);
    }
    .card-tag {
      font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 800;
      color: #FFD000; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 10px;
      text-shadow: 0 0 15px rgba(255, 208, 0, 0.4);
    }
    .card-head {
      font-size: 38px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
      color: #FFF; margin-bottom: 12px; line-height: 1.18;
    }
    .card-body {
      font-size: 24px; line-height: 1.42; color: #F1F5F9; margin-bottom: 18px; font-weight: 500;
    }
    .card-chips {
      display: flex; flex-wrap: wrap; gap: 10px;
    }
    .card-chip {
      font-family: 'JetBrains Mono', monospace; font-size: 17px; font-weight: 800;
      padding: 8px 18px; border-radius: 8px;
      background: rgba(0, 229, 255, 0.15); border: 1.5px solid rgba(0, 229, 255, 0.5);
      color: #00E5FF; text-transform: uppercase; letter-spacing: 0.12em;
    }
  </style>
</head>
<body>
  <div class="top-header">
    <div class="series-tag">${video.tag}</div>
    <div class="title">${video.title}</div>
    <div class="subtitle">${video.subtitle}</div>
  </div>

  <div class="viewport-accent">
    <div class="hud-chip-left">60 FPS CFR • 100% UNTOUCHED ACTION</div>
    <div class="hud-chip-right">PART ${cutIndex + 1}/${totalCuts - 1}</div>
  </div>

  <div class="bottom-card">
    <div class="card-tag">${cut.tag}</div>
    <div class="card-head">${cut.head}</div>
    <div class="card-body">${cut.body}</div>
    <div class="card-chips">
      ${(cut.chips || []).map(c => `<div class="card-chip">${c}</div>`).join('')}
    </div>
  </div>
</body>
</html>`;

  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: overlayPath, type: 'png', omitBackground: true });
  await page.close();
  return overlayPath;
}

function hasAudioStream(filePath) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1',
      filePath
    ], { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch (_) {
    return false;
  }
}

async function renderVideo(browser, video) {
  console.log(`\n══════════════════════════════════════════════════════════════════`);
  console.log(`  PRODUCING: ${video.title} (${video.filename})`);
  console.log(`══════════════════════════════════════════════════════════════════`);

  const totalDuration = video.cuts.reduce((a, c) => a + c.durationSec, 0);
  console.log(`[video] Planned duration: ${totalDuration.toFixed(1)}s across ${video.cuts.length} cuts`);

  const segmentFiles = [];
  let timelineSec = 0;

  for (let i = 0; i < video.cuts.length; i++) {
    const cut = video.cuts[i];
    const segPath = path.join(TEMP_DIR, `seg_${video.id}_${i}.mp4`);
    segmentFiles.push(segPath);

    const frameCount = Math.round((timelineSec + cut.durationSec) * 60) - Math.round(timelineSec * 60);
    timelineSec += cut.durationSec;

    const exactVideo = `fps=60,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${frameCount},setpts=PTS-STARTPTS`;
    const exactAudio = `aresample=48000,apad,atrim=duration=${(frameCount / 60).toFixed(6)},asetpts=PTS-STARTPTS`;

    if (cut.type === 'title_card') {
      console.log(`[cut ${i + 1}/${video.cuts.length}] Fullscreen 9:16 Galaxy Title Card Outro Lock (${cut.durationSec.toFixed(1)}s)`);
      execFileSync('ffmpeg', [
        '-y',
        '-loop', '1',
        '-t', String(cut.durationSec),
        '-r', '60',
        '-i', TITLE_CARD_SRC,
        '-f', 'lavfi',
        '-t', String(cut.durationSec),
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-vf', `scale=1080:1920:flags=lanczos,setsar=1,format=yuv420p,fade=t=in:st=0:d=0.8,${exactVideo}`,
        '-af', exactAudio,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-r', '60',
        '-fps_mode', 'cfr',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '48000',
        segPath
      ], { stdio: 'pipe' });
    } else {
      console.log(`[cut ${i + 1}/${video.cuts.length}] ${cut.head} (${cut.durationSec.toFixed(1)}s)`);
      const overlayPng = await generateCardOverlay(browser, video, cut, i, video.cuts.length);

      // Filter graph:
      // - Background: [0:v] scaled to fill 1080x1920, softly blurred (boxblur=12:2), color graded (brightness -0.4)
      // - Foreground: [0:v] scaled to exactly 1080x608 (100% full uncropped court view!) centered at y=656
      // - Overlay: [1:v] diegetic header and bottom descriptive card
      const filter = [
        '[0:v]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=12:2,eq=brightness=-0.40:saturation=1.2,scale=1080:1920:flags=bicubic,setsar=1[bg]',
        '[0:v]scale=1080:608:flags=lanczos,setsar=1[fg]',
        '[bg][fg]overlay=0:656[comp]',
        `[comp][1:v]overlay=0:0,format=yuv420p,${exactVideo}[vout]`
      ].join(';');

      // All video cuts use clean silent audio in intermediate segments so there is ZERO
      // music collision or secondary audio track bleeding from raw footage/social clips.
      const args = [
        '-y',
        '-ss', String(cut.startSec),
        '-t', String(cut.durationSec + 0.5),
        '-i', cut.src,
        '-loop', '1',
        '-t', String(cut.durationSec),
        '-i', overlayPng,
        '-f', 'lavfi',
        '-t', String(cut.durationSec),
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-filter_complex', filter,
        '-map', '[vout]',
        '-map', '2:a:0',
        '-af', exactAudio,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-r', '60',
        '-fps_mode', 'cfr',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '48000',
        '-ac', '2',
        segPath
      ];

      execFileSync('ffmpeg', args, { stdio: 'pipe' });
    }
  }

  // Concatenate segments
  const concatFile = path.join(TEMP_DIR, `concat_${video.id}.txt`);
  fs.writeFileSync(concatFile, segmentFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'), 'utf8');

  const stitchedVideo = path.join(TEMP_DIR, `stitched_${video.id}.mp4`);
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatFile,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '17',
    '-r', '60',
    '-fps_mode', 'cfr',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    stitchedVideo
  ], { stdio: 'pipe' });

  // Single Master Soundtrack: Apply ONE unified, continuous master track of "Neon Velocity"
  // Beat-synced starting on the drop @ 44.20s, with a clean fadeout during outro, normalized to -14 LUFS.
  // There is NO secondary audio, NO conflicting cut audio, and NO overlapping tracks.
  const masterPath = path.join(SERIES_DIR, video.filename);
  const dur = totalDuration.toFixed(3);
  const audioFilter = [
    `[0:v]trim=duration=${dur},setpts=PTS-STARTPTS[vout]`,
    `[1:a]atrim=duration=${dur},asetpts=PTS-STARTPTS,afade=t=out:st=17.5:d=3.8,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`
  ].join(';');

  execFileSync('ffmpeg', [
    '-y',
    '-i', stitchedVideo,
    '-ss', '44.200',
    '-i', MUSIC_SRC,
    '-filter_complex', audioFilter,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-r', '60',
    '-fps_mode', 'cfr',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '256k',
    '-ar', '48000',
    masterPath
  ], { stdio: 'pipe' });

  const stat = fs.statSync(masterPath);
  console.log(`✓ Master Deliverable created: ${masterPath} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);

  // Extract verification stills
  const stillPath = path.join(SERIES_DIR, `preview_${video.id}.png`);
  execFileSync('ffmpeg', [
    '-y',
    '-ss', '00:00:04.500',
    '-i', masterPath,
    '-vframes', '1',
    '-f', 'image2',
    '-update', '1',
    stillPath
  ], { stdio: 'ignore' });
  console.log(`✓ Verification still: ${stillPath}`);
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║       VALLEYBALL VERSUS — TIKTOK 3-PART MINI-SERIES PIPELINE     ║');
  console.log('║      1080x1920 @ 60 FPS CFR | Uncropped Action + Deep Context    ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: true });

  for (const video of VIDEOS) {
    await renderVideo(browser, video);
  }

  await browser.close();
  console.log('\n==================================================================');
  console.log('           ALL 3 TIKTOK MINI-SERIES VIDEOS DELIVERED!             ');
  console.log('==================================================================\n');
}

run().catch(err => {
  console.error('[mini_series] Error:', err);
  process.exit(1);
});
