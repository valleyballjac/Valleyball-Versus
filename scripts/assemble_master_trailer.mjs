/**
 * VALLEYBALL VERSUS — OFFICIAL MASTER TRAILER ASSEMBLY ENGINE
 *
 * Direct turnkey implementation of the GEMINI ARGON MASTER EDITORIAL PROMPT:
 * - 94.500s Total Duration (5,670 Frames @ 60.00 FPS CFR)
 * - 16:9 Aspect Ratio (1920x1080)
 * - Beat-Grid Quantized to "Neon Velocity" (133.333 BPM, 1.800s bars, 0.900s half-bars, 0.450s/0.225s staccato)
 * - 5-Phase Narrative Arc:
 *     Phase 1: Monumental Architectural Overture (0:00.00 – 44.20s)
 *     Phase 2: Rhythmic Action Escalation (44.20s – 62.20s)
 *     Phase 3: Rapid-Fire Staccato Climax (62.20s – 76.60s)
 *     Phase 4: Climax Torus Goal & Celestial Ascension (76.60s – 88.00s)
 *     Phase 5: Brand Galaxy Outro & Title Card Lock (88.00s – 94.50s)
 * - Dual Audio Stems:
 *     1. Full Stereo Master of "Neon Velocity" (ducked -2.5 dB during heavy impact hits)
 *     2. Isolated in-game SFX stem (spikes, diving thuds, Torus goal sirens, floor squeaks)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_DIR = path.join(ROOT, 'captures', 'trailer_assembly_temp');
const OUT_DIR = path.join(ROOT, 'captures', 'trailer');
const RAW_CHUNKS_DIR = path.join(ROOT, 'captures', 'raw_footage', 'raw_chunks');
const OVERTURE_SRC = path.join(OUT_DIR, 'valleyball_versus_debut_trailer_1080p60.mp4');
const MUSIC_SRC = path.join(ROOT, 'public', 'audio', 'music', 'track_trailer_neon_velocity.mp3');
const TITLE_CARD_SRC = path.join(OUT_DIR, 'title_card_galaxy.png');

const MASTER_OUTPUT = path.join(OUT_DIR, 'valleyball_versus_official_trailer_1080p60.mp4');
const SOCIAL_OUTPUT = path.join(OUT_DIR, 'valleyball_versus_official_trailer_social_1080p.mp4');

fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// Define complete 35-cut sequence strictly quantized to 133.33 BPM
const CUT_LIST = [
  // ── PHASE 1: MONUMENTAL ARCHITECTURAL OVERTURE (0.000s – 44.200s | 44.200s) ──
  {
    id: '01_phase1_overture',
    type: 'video',
    src: OVERTURE_SRC,
    startSec: 0.0,
    durationSec: 44.200,
    desc: 'Monumental Architectural Overture (Torus flank, ramps, sideline glide, stadium boom, pre-drop push)',
    filter: 'fade=t=in:st=0:d=2.0'
  },

  // ── PHASE 2: RHYTHMIC ACTION ESCALATION (44.200s – 62.200s | 10 Bars @ 1.800s) ──
  {
    id: '02_cut6_the_drop',
    type: 'raw',
    file: 'game_02_raw.webm',
    startSec: 0.8,
    durationSec: 1.800,
    desc: 'CUT 6 (THE DROP | Bar 0): Small Ball Ion Cyan, Low Turf Follow, 72.9 m/s sprint & spike detonation'
  },
  {
    id: '03_cut7_bar1_dive',
    type: 'raw',
    file: 'game_09_raw.webm',
    startSec: 0.5,
    durationSec: 1.800,
    desc: 'CUT 7 (Bar 1): Large Ball Classic vs Masculine, Low Turf Action Follow, full-extension turf dive save'
  },
  {
    id: '04_cut8_bar2_spike',
    type: 'raw',
    file: 'game_04_raw.webm',
    startSec: 0.5,
    durationSec: 1.800,
    desc: 'CUT 8 (Bar 2): Medium Ball Masculine vs Feminine, Vertical Aerial Spike Cam, skyward leap'
  },
  {
    id: '05_cut9_bar3_bank',
    type: 'raw',
    file: 'game_26_raw.webm',
    startSec: 0.5,
    durationSec: 1.800,
    desc: 'CUT 9 (Bar 3): Small Ball Feminine vs Classic, Banked Wall Curve, steep parabolic carve 59.5 m/s'
  },
  {
    id: '06_cut10_bar4_chase',
    type: 'raw',
    file: 'game_10_raw.webm',
    startSec: 0.5,
    durationSec: 1.800,
    desc: 'CUT 10 (Bar 4): Medium Ball Masculine vs Feminine, Over-Shoulder Chase Cam, 46.7 m/s attack'
  },
  {
    id: '07_cut11_bar5_orbit',
    type: 'raw',
    file: 'game_06_raw.webm',
    startSec: 0.5,
    durationSec: 1.800,
    desc: 'CUT 11 (Bar 5): Large Ball Classic vs Masculine, Dynamic Action Orbit, 62.0 m/s spike'
  },
  {
    id: '08_cut12_bar6_flank',
    type: 'raw',
    file: 'game_14_raw.webm',
    startSec: 0.5,
    durationSec: 1.800,
    desc: 'CUT 12 (Bar 6): Small Ball Feminine vs Classic, 3/4 Flank South Torus, 26.1 m/s spike'
  },
  {
    id: '09_cut13_bar7_orbit_dive',
    type: 'raw',
    file: 'game_13_raw.webm',
    startSec: 0.5,
    durationSec: 1.800,
    desc: 'CUT 13 (Bar 7): Medium Ball Masculine vs Feminine, Dynamic Action Orbit, dive save'
  },
  {
    id: '10_cut14_bar8_low_sprint',
    type: 'raw',
    file: 'game_16_raw.webm',
    startSec: 0.5,
    durationSec: 1.800,
    desc: 'CUT 14 (Bar 8): Medium Ball Masculine vs Feminine, Low Turf Tracking, 19.0 m/s sprint duel'
  },
  {
    id: '11_cut15_bar9_chase_dive',
    type: 'raw',
    file: 'game_17_raw.webm',
    startSec: 0.5,
    durationSec: 1.800,
    desc: 'CUT 15 (Bar 9): Small Ball Feminine vs Classic, Over-Shoulder Chase, diving recovery'
  },

  // ── PHASE 3: RAPID-FIRE STACCATO CLIMAX (62.200s – 76.600s | 14.400s) ──
  // Part A: 12 Half-Bar Cuts @ 0.900s each = 10.800s (62.200s – 73.000s)
  {
    id: '12_cut16_half1',
    type: 'raw',
    file: 'game_18_raw.webm',
    startSec: 0.5,
    durationSec: 0.900,
    desc: 'CUT 16 (Half-Bar 1): Large Ball, Vertical Aerial Spike, 44.9 m/s apex strike'
  },
  {
    id: '13_cut17_half2',
    type: 'raw',
    file: 'game_19_raw.webm',
    startSec: 0.5,
    durationSec: 0.900,
    desc: 'CUT 17 (Half-Bar 2): Medium Ball, Banked Wall Curve, 31.5 m/s carve'
  },
  {
    id: '14_cut18_half3',
    type: 'raw',
    file: 'game_20_raw.webm',
    startSec: 0.5,
    durationSec: 0.900,
    desc: 'CUT 18 (Half-Bar 3): Small Ball, Dynamic Action Orbit, kinetic sprint rally'
  },
  {
    id: '15_cut19_half4',
    type: 'raw',
    file: 'game_21_raw.webm',
    startSec: 0.5,
    durationSec: 0.900,
    desc: 'CUT 19 (Half-Bar 4): Large Ball, 3/4 Flank South Torus, turf dive save'
  },
  {
    id: '16_cut20_half5',
    type: 'raw',
    file: 'game_22_raw.webm',
    startSec: 0.5,
    durationSec: 0.900,
    desc: 'CUT 20 (Half-Bar 5): Medium Ball, 3/4 Flank North Torus, 50.9 m/s spike'
  },
  {
    id: '17_cut21_half6',
    type: 'raw',
    file: 'game_23_raw.webm',
    startSec: 0.5,
    durationSec: 0.900,
    desc: 'CUT 21 (Half-Bar 6): Small Ball, Low Turf Tracking, Torus goal 25.3 m/s'
  },
  {
    id: '18_cut22_half7',
    type: 'raw',
    file: 'game_24_raw.webm',
    startSec: 0.5,
    durationSec: 0.900,
    desc: 'CUT 22 (Half-Bar 7): Large Ball, Over-Shoulder Chase, kinetic sprint rally'
  },
  {
    id: '19_cut23_half8',
    type: 'raw',
    file: 'game_25_raw.webm',
    startSec: 0.5,
    durationSec: 0.900,
    desc: 'CUT 23 (Half-Bar 8): Medium Ball, Vertical Aerial Spike, dive save'
  },
  {
    id: '20_cut24_half9',
    type: 'raw',
    file: 'game_30_raw.webm',
    startSec: 0.5,
    durationSec: 0.900,
    desc: 'CUT 24 (Half-Bar 9): Large Ball, Low Turf Tracking, 62.9 m/s spike'
  },
  {
    id: '21_cut25_half10',
    type: 'raw',
    file: 'game_31_raw.webm',
    startSec: 0.5,
    durationSec: 0.900,
    desc: 'CUT 25 (Half-Bar 10): Medium Ball, Over-Shoulder Chase, 59.9 m/s goal blast'
  },
  {
    id: '22_cut26_half11',
    type: 'raw',
    file: 'game_32_raw.webm',
    startSec: 0.5,
    durationSec: 0.900,
    desc: 'CUT 26 (Half-Bar 11): Small Ball, Vertical Aerial Spike, sprint rally'
  },
  {
    id: '23_cut27_half12',
    type: 'raw',
    file: 'game_33_raw.webm',
    startSec: 0.5,
    durationSec: 0.900,
    desc: 'CUT 27 (Half-Bar 12): Large Ball, Banked Wall Curve, turf dive save'
  },

  // Part B: Apex Eighth-Note Blitz (3.600s total | 73.000s – 76.600s)
  {
    id: '24_cut28_eighth1',
    type: 'raw',
    file: 'game_34_raw.webm',
    startSec: 0.5,
    durationSec: 0.450,
    desc: 'CUT 28 (1/4 Note 1): Medium Ball, Action Orbit, 61.5 m/s spike'
  },
  {
    id: '25_cut29_eighth2',
    type: 'raw',
    file: 'game_35_raw.webm',
    startSec: 0.5,
    durationSec: 0.450,
    desc: 'CUT 29 (1/4 Note 2): Small Ball, 3/4 Flank South Torus, goal strike'
  },
  {
    id: '26_cut30_eighth3',
    type: 'raw',
    file: 'game_38_raw.webm',
    startSec: 0.5,
    durationSec: 0.450,
    desc: 'CUT 30 (1/4 Note 3): Small Ball, Over-Shoulder Chase, 40.7 m/s spike'
  },
  {
    id: '27_cut31_eighth4',
    type: 'raw',
    file: 'game_39_raw.webm',
    startSec: 0.5,
    durationSec: 0.450,
    desc: 'CUT 31 (1/4 Note 4): Large Ball, Vertical Aerial Spike, 36.9 m/s goal strike'
  },
  {
    id: '28_cut32_eighth5',
    type: 'raw',
    file: 'game_42_raw.webm',
    startSec: 0.5,
    durationSec: 0.450,
    desc: 'CUT 32 (1/4 Note 5): Large Ball, 3/4 Flank South Torus, 61.1 m/s spike'
  },
  {
    id: '29_cut33_eighth6',
    type: 'raw',
    file: 'game_43_raw.webm',
    startSec: 0.5,
    durationSec: 0.450,
    desc: 'CUT 33 (1/4 Note 6): Medium Ball, 3/4 Flank North Torus, 49.2 m/s goal'
  },
  {
    id: '30_cut34_eighth7',
    type: 'raw',
    file: 'game_46_raw.webm',
    startSec: 0.5,
    durationSec: 0.450,
    desc: 'CUT 34 (1/4 Note 7): Medium Ball, Vertical Aerial Spike, 71.0 m/s spike'
  },
  {
    id: '31_cut35_sixteenth1',
    type: 'raw',
    file: 'game_47_raw.webm',
    startSec: 0.5,
    durationSec: 0.225,
    desc: 'CUT 35 (1/8 Note 1): Small Ball, Banked Wall Curve, 53.8 m/s goal'
  },
  {
    id: '32_cut36_sixteenth2',
    type: 'raw',
    file: 'game_50_raw.webm',
    startSec: 0.5,
    durationSec: 0.225,
    desc: 'CUT 36 (1/8 Note 2): Small Ball, 3/4 Flank North Torus, 56.3 m/s supersonic spike'
  },

  // ── PHASE 4: CLIMAX TORUS GOAL & CELESTIAL ASCENSION (76.600s – 88.000s | 11.400s) ──
  {
    id: '33_cut37_climax_goal',
    type: 'raw',
    file: 'game_07_raw.webm',
    startSec: 0.5,
    durationSec: 5.600,
    desc: 'CUT 37: The Climax Torus Goal in 3/4 Side Profile (61.8 m/s strike through ring, celebratory siren)'
  },
  {
    id: '34_cut38_celestial_ascend',
    type: 'video',
    src: OVERTURE_SRC,
    startSec: 82.200,
    durationSec: 5.800,
    desc: 'CUT 38: Celestial Ascension Arc (high soaring crane expanding upward above stadium floodlights)'
  },

  // ── PHASE 5: BRAND GALAXY OUTRO & TITLE CARD LOCK (88.000s – 94.500s | 6.500s) ──
  {
    id: '35_cut39_galaxy_title',
    type: 'image',
    src: TITLE_CARD_SRC,
    durationSec: 6.500,
    desc: 'CUT 39: Brand Galaxy Outro & Title Card Lock (fade in 0.8s, hold release date and URL to 94.5s)',
    filter: 'fade=t=in:st=0:d=0.8'
  }
];

async function assembleTrailer() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║       VALLEYBALL VERSUS — OFFICIAL MASTER TRAILER ASSEMBLY       ║');
  console.log('║        94.500s Broadcast 1080p60 | Gemini Argon Blueprint        ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  // Verify total duration
  const totalPlannedDuration = CUT_LIST.reduce((acc, c) => acc + c.durationSec, 0);
  console.log(`[assembly] Planned cuts: ${CUT_LIST.length}`);
  console.log(`[assembly] Total planned duration: ${totalPlannedDuration.toFixed(3)}s (Target: 94.500s)`);

  if (Math.abs(totalPlannedDuration - 94.500) > 0.001) {
    throw new Error(`Duration mismatch: ${totalPlannedDuration} != 94.500`);
  }

  // 1. Process and transcode each cut into standardized CFR 1080p60 MP4
  console.log('\n[assembly] === STEP 1: RENDERING STANDARDIZED CFR VIDEO CHUNKS ===');
  const segmentFiles = [];

  for (let i = 0; i < CUT_LIST.length; i++) {
    const cut = CUT_LIST[i];
    const segPath = path.join(TEMP_DIR, `seg_${String(i + 1).padStart(2, '0')}_${cut.id}.mp4`);
    segmentFiles.push(segPath);

    console.log(`[${i + 1}/${CUT_LIST.length}] ${cut.id} (${cut.durationSec.toFixed(3)}s) - ${cut.desc}`);

    const args = ['-y'];

    if (cut.type === 'raw') {
      const rawPath = path.join(RAW_CHUNKS_DIR, cut.file);
      args.push(
        '-ss', String(cut.startSec),
        '-t', String(cut.durationSec),
        '-r', '60',
        '-i', rawPath,
        '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p',
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
      );
    } else if (cut.type === 'video') {
      const vf = cut.filter
        ? `scale=1920:1080:flags=lanczos,format=yuv420p,${cut.filter}`
        : 'scale=1920:1080:flags=lanczos,format=yuv420p';

      args.push(
        '-ss', String(cut.startSec),
        '-t', String(cut.durationSec),
        '-i', cut.src,
        '-vf', vf,
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
      );
    } else if (cut.type === 'image') {
      const vf = cut.filter
        ? `scale=1920:1080:flags=lanczos,format=yuv420p,${cut.filter}`
        : 'scale=1920:1080:flags=lanczos,format=yuv420p';

      // Generate video from still image with silent audio channel
      args.push(
        '-loop', '1',
        '-t', String(cut.durationSec),
        '-r', '60',
        '-i', cut.src,
        '-f', 'lavfi',
        '-t', String(cut.durationSec),
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-vf', vf,
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
      );
    }

    execFileSync('ffmpeg', args, { stdio: 'pipe' });
  }

  // 2. Concatenate all 35 segments into a single video stream with SFX track
  console.log('\n[assembly] === STEP 2: CONCATENATING ALL 35 CUTS (SEAMLESS 94.5s EDIT) ===');
  const concatListFile = path.join(TEMP_DIR, 'concat_list.txt');
  const concatContent = segmentFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(concatListFile, concatContent, 'utf8');

  const stitchedVideoSfx = path.join(TEMP_DIR, 'stitched_video_sfx.mp4');
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatListFile,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '17',
    '-r', '60',
    '-fps_mode', 'cfr',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-ac', '2',
    stitchedVideoSfx
  ], { stdio: 'inherit' });

  console.log(`[assembly] Stitched video+SFX created: ${stitchedVideoSfx}`);

  // 3. Audio Layering: Mix "Neon Velocity" Music Master with isolated SFX Stem
  // - "Neon Velocity" runs from 0.0s to 89.85s, with a gentle 3.5s fadeout into silence by 93.5s
  // - During Phase 2, Phase 3, and Climax Goal (44.20s – 82.20s), duck music by -2.5 dB
  //   so in-game impacts (dives, strikes, sirens) cut through with maximum punch!
  console.log('\n[assembly] === STEP 3: DUAL-STEM AUDIO MASTERING (NEON VELOCITY + SFX DUCKING) ===');

  const filterComplex = [
    // [0:v] Pass-through video stream trimmed to exact 94.500s
    '[0:v]trim=duration=94.500,setpts=PTS-STARTPTS[vout]',

    // [1:a] Music Master:
    // Apply dynamic ducking: 0 dB during overture (0-44.20s), -2.5 dB during kinetic action (44.20-82.20s),
    // restore to 0 dB during celestial outro, and fade out at 89.5s -> 93.8s.
    '[1:a]volume=enable=\'between(t,44.20,82.20)\':volume=-2.5dB,' +
    'afade=t=out:st=89.5:d=4.3,' +
    'apad=whole_dur=94.500,atrim=duration=94.500[music]',

    // [0:a] SFX Stem from video clips:
    // Boost SFX during action phases (+1.5 dB) for visceral kinetic crunch
    '[0:a]volume=enable=\'between(t,44.20,82.20)\':volume=+1.5dB,' +
    'atrim=duration=94.500[sfx]',

    // Mix Music + SFX with limiter to prevent digital clipping
    '[music][sfx]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.95[aout]'
  ].join(';');

  console.log('\n[assembly] === STEP 4: ENCODING MASTER BROADCAST DELIVERABLE (1080p60) ===');
  execFileSync('ffmpeg', [
    '-y',
    '-i', stitchedVideoSfx,
    '-i', MUSIC_SRC,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '17',
    '-r', '60',
    '-fps_mode', 'cfr',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '320k',
    '-ar', '48000',
    MASTER_OUTPUT
  ], { stdio: 'inherit' });

  const masterStat = fs.statSync(MASTER_OUTPUT);
  console.log(`\n✓ Broadcast Master Deliverable: ${MASTER_OUTPUT}`);
  console.log(`  Size: ${(masterStat.size / (1024 * 1024)).toFixed(2)} MB`);

  // 4. Encode Social Web Cut (<25 MB for Twitter / Discord)
  console.log('\n[assembly] === STEP 5: ENCODING SOCIAL WEB CUT (<25 MB) ===');
  execFileSync('ffmpeg', [
    '-y',
    '-i', MASTER_OUTPUT,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '24.5',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    SOCIAL_OUTPUT
  ], { stdio: 'inherit' });

  const socialStat = fs.statSync(SOCIAL_OUTPUT);
  console.log(`\n✓ Social Web Deliverable: ${SOCIAL_OUTPUT}`);
  console.log(`  Size: ${(socialStat.size / (1024 * 1024)).toFixed(2)} MB`);

  // 5. Extract Milestone Verification Frames
  console.log('\n[assembly] === STEP 6: EXTRACTING MILESTONE VERIFICATION FRAMES ===');
  const milestoneDir = path.join(OUT_DIR, 'final_milestones');
  fs.mkdirSync(milestoneDir, { recursive: true });

  const testFrames = [
    { time: '00:00:05.000', name: '01_phase1_torus_reveal.png' },
    { time: '00:00:22.000', name: '02_phase1_turf_glide.png' },
    { time: '00:00:42.000', name: '03_phase1_pre_drop_tension.png' },
    { time: '00:00:45.000', name: '04_phase2_beat_drop_detonation.png' },
    { time: '00:00:47.000', name: '05_phase2_low_turf_dive.png' },
    { time: '00:00:48.500', name: '06_phase2_vertical_aerial_spike.png' },
    { time: '00:00:50.500', name: '07_phase2_banked_wall_carve.png' },
    { time: '00:00:52.000', name: '08_phase2_over_shoulder_chase.png' },
    { time: '00:01:05.000', name: '09_phase3_staccato_blitz.png' },
    { time: '00:01:15.000', name: '10_phase3_apex_eighth_notes.png' },
    { time: '00:01:19.000', name: '11_phase4_climax_torus_goal.png' },
    { time: '00:01:25.000', name: '12_phase4_celestial_ascension.png' },
    { time: '00:01:31.500', name: '13_phase5_galaxy_title_card.png' }
  ];

  for (const f of testFrames) {
    const outImg = path.join(milestoneDir, f.name);
    execFileSync('ffmpeg', [
      '-y',
      '-ss', f.time,
      '-i', MASTER_OUTPUT,
      '-frames:v', '1',
      '-update', '1',
      outImg
    ], { stdio: 'pipe' });
    console.log(`  Extracted: ${f.name} @ ${f.time}`);
  }

  console.log('\n================================================================');
  console.log('✓ OFFICIAL VALLEYBALL VERSUS TRAILER RENDERING COMPLETE!');
  console.log('================================================================');
}

assembleTrailer().catch((err) => {
  console.error('\n[assembly] FATAL ERROR during assembly:', err);
  process.exit(1);
});
