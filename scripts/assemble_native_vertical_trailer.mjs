/**
 * VALLEYBALL VERSUS — TRUE NATIVE 9:16 VERTICAL ACTION TRAILER ENGINE
 *
 * Full-bleed edge-to-edge native 9:16 vertical trailer (1080x1920 @ 60 FPS CFR):
 * - ZERO letterboxing, ZERO blurred sidebars, ZERO template cards/links
 * - 100% full-screen live 3D gameplay action filling every pixel of mobile screens
 * - Beat-quantized to "Neon Velocity" (133.333 BPM) starting directly on THE DROP (Bar 0)
 * - 3-Act Action Arc:
 *     Act 1: The Drop & Rhythmic Action Escalation (0.00s – 18.00s | 10 Bars @ 1.800s)
 *     Act 2: Rapid-Fire Staccato Climax (18.00s – 32.40s | 12 Half-Bars @ 0.900s + Apex Blitz)
 *     Act 3: Climax Torus Hoop Goal & Celestial Ascension (32.40s – 41.40s | 9.00s)
 *     Outro: Fullscreen 9:16 Galaxy Title Card Lock (41.40s – 50.30s | 8.90s)
 * - Dual-Stem Audio Master:
 *     1. Full Stereo Master of "Neon Velocity" starting on the drop (44.20s in the track)
 *     2. Isolated In-Game SFX Stem boosted by +15 dB (spikes, dives, Torus hoop clanks, sirens)
 *     3. Broadcast mastered to -14 LUFS streaming target
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_DIR = path.join(ROOT, 'captures', 'vertical_trailer_temp');
const OUT_DIR = path.join(ROOT, 'captures', 'trailer');
const RAW_CHUNKS_DIR = path.join(ROOT, 'captures', 'raw_footage', 'raw_chunks');
const INENGINE_SRC = path.join(OUT_DIR, 'raw_footage_1080p60.mp4');
const MUSIC_SRC = path.join(ROOT, 'public', 'audio', 'music', 'track_trailer_neon_velocity.mp3');
const TITLE_CARD_SRC = path.join(OUT_DIR, 'title_card_vertical_9x16.png');
const MILESTONE_DIR = path.join(OUT_DIR, 'milestone_frames_native_9x16');

const MASTER_OUTPUT = path.join(OUT_DIR, 'valleyball_versus_trailer_native_9x16_1080p60.mp4');
const SOCIAL_OUTPUT = path.join(OUT_DIR, 'valleyball_versus_trailer_native_9x16_social.mp4');

fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(MILESTONE_DIR, { recursive: true });

// Ensure vertical title card exists
if (!fs.existsSync(TITLE_CARD_SRC)) {
  console.log('[native_9x16] Generating vertical title card...');
  execFileSync('node', [path.join(ROOT, 'scripts', 'generate_tiktok_graphics.mjs')], { stdio: 'inherit' });
}

// Complete 34-cut high-octane action sequence quantized to 133.333 BPM
const CUT_LIST = [
  // ── ACT 1: THE DROP & RHYTHMIC ACTION ESCALATION (0.000s – 18.000s | 10 Bars @ 1.800s) ──
  { id: '01_bar0_the_drop', type: 'raw', file: 'game_04_raw.webm', startSec: 0.5, durationSec: 1.800, desc: 'THE DROP: Vertical Aerial Cam, giant globe drops into the arena' },
  { id: '02_bar1_low_turf', type: 'raw', file: 'game_02_raw.webm', startSec: 2.2, durationSec: 1.800, desc: 'Bar 1: Low Turf Follow, sweet-spot strike by Red' },
  { id: '03_bar2_duel', type: 'raw', file: 'game_24_raw.webm', startSec: 1.5, durationSec: 1.800, desc: 'Bar 2: Over-Shoulder Chase, close midcourt duel' },
  { id: '04_bar3_orbit', type: 'raw', file: 'game_27_raw.webm', startSec: 2.2, durationSec: 1.800, desc: 'Bar 3: Action Orbit, close-up strike on neon globe' },
  { id: '05_bar4_strike_dive', type: 'raw', file: 'game_38_raw.webm', startSec: 2.2, durationSec: 1.800, desc: 'Bar 4: Over-Shoulder Chase, diving save on turf' },
  { id: '06_bar5_globe_roll', type: 'raw', file: 'game_09_raw.webm', startSec: 3.2, durationSec: 1.800, desc: 'Bar 5: Low Turf Follow, globe rolls between contenders' },
  { id: '07_bar6_black_globe', type: 'raw', file: 'game_31_raw.webm', startSec: 2.5, durationSec: 1.800, desc: 'Bar 6: Over-Shoulder Chase, heavy strike on black globe' },
  { id: '08_bar7_large_globe', type: 'raw', file: 'game_48_raw.webm', startSec: 0.5, durationSec: 1.800, desc: 'Bar 7: Action Orbit, giant momentum sphere' },
  { id: '09_bar8_green_gloves', type: 'raw', file: 'game_39_raw.webm', startSec: 1.6, durationSec: 1.800, desc: 'Bar 8: Vertical Aerial Spike, airborne strike' },
  { id: '10_bar9_red_key', type: 'raw', file: 'game_12_raw.webm', startSec: 0.6, durationSec: 1.800, desc: 'Bar 9: Banked Wall curve, chase across the slope' },

  // ── ACT 2: RAPID-FIRE STACCATO CLIMAX (18.000s – 32.400s | 14.400s) ──
  // Part A: 12 Half-Bar Cuts @ 0.900s each = 10.800s (18.000s – 28.800s)
  { id: '11_half1', type: 'raw', file: 'game_17_raw.webm', startSec: 1.0, durationSec: 0.900, desc: 'Half-Bar 1: Close sprint' },
  { id: '12_half2', type: 'raw', file: 'game_18_raw.webm', startSec: 0.8, durationSec: 0.900, desc: 'Half-Bar 2: Vertical Aerial Spike' },
  { id: '13_half3', type: 'raw', file: 'game_34_raw.webm', startSec: 2.9, durationSec: 0.900, desc: 'Half-Bar 3: Action Orbit, black globe' },
  { id: '14_half4', type: 'raw', file: 'game_46_raw.webm', startSec: 3.5, durationSec: 0.900, desc: 'Half-Bar 4: Vertical Aerial Spike' },
  { id: '15_half5', type: 'raw', file: 'game_03_raw.webm', startSec: 3.3, durationSec: 0.900, desc: 'Half-Bar 5: Over-Shoulder Chase' },
  { id: '16_half6_rvb', type: 'raw', file: 'game_10_raw.webm', startSec: 2.6, durationSec: 0.900, desc: 'Half-Bar 6 (Red vs Blue): Ball overhead' },
  { id: '17_half7_rvb', type: 'raw', file: 'game_20_raw.webm', startSec: 0.4, durationSec: 0.900, desc: 'Half-Bar 7 (Red vs Blue): Close contest' },
  { id: '18_half8_rvb', type: 'raw', file: 'game_30_raw.webm', startSec: 3.3, durationSec: 0.900, desc: 'Half-Bar 8 (Red vs Blue): Low Turf sprint' },
  { id: '19_half9_rvb', type: 'raw', file: 'game_45_raw.webm', startSec: 0.2, durationSec: 0.900, desc: 'Half-Bar 9 (Red vs Blue): Over-Shoulder Chase' },
  { id: '20_half10_rvb', type: 'raw', file: 'game_50_raw.webm', startSec: 5.4, durationSec: 0.900, desc: 'Half-Bar 10 (Red vs Blue): 3/4 Flank dive' },
  { id: '21_half11_rvb', type: 'raw', file: 'game_25_raw.webm', startSec: 0.4, durationSec: 0.900, desc: 'Half-Bar 11 (Red vs Blue): Aerial spike' },
  { id: '22_half12_rvb', type: 'raw', file: 'game_05_raw.webm', startSec: 1.0, durationSec: 0.900, desc: 'Half-Bar 12 (Red vs Blue): Banked wall exchange' },

  // Part B: Apex Eighth-Note Blitz (3.600s total | 28.800s – 32.400s), Red vs Blue
  { id: '23_eighth1', type: 'raw', file: 'game_20_raw.webm', startSec: 2.4, durationSec: 0.450, desc: '1/4 Note 1: Close contest' },
  { id: '24_eighth2', type: 'raw', file: 'game_30_raw.webm', startSec: 1.0, durationSec: 0.450, desc: '1/4 Note 2: Blue strike' },
  { id: '25_eighth3', type: 'raw', file: 'game_10_raw.webm', startSec: 4.6, durationSec: 0.450, desc: '1/4 Note 3: Blue dive' },
  { id: '26_eighth4', type: 'raw', file: 'game_45_raw.webm', startSec: 1.4, durationSec: 0.450, desc: '1/4 Note 4: Red spike' },
  { id: '27_eighth5', type: 'raw', file: 'game_35_raw.webm', startSec: 1.3, durationSec: 0.450, desc: '1/4 Note 5: Full layout dive' },
  { id: '28_eighth6', type: 'raw', file: 'game_50_raw.webm', startSec: 2.2, durationSec: 0.450, desc: '1/4 Note 6: Sprint challenge' },
  { id: '29_eighth7', type: 'raw', file: 'game_40_raw.webm', startSec: 3.7, durationSec: 0.450, desc: '1/4 Note 7: Black globe impact' },
  { id: '30_sixteenth1', type: 'raw', file: 'game_15_raw.webm', startSec: 5.1, durationSec: 0.225, desc: '1/8 Note 1: Ball at hoop' },
  { id: '31_sixteenth2', type: 'raw', file: 'game_25_raw.webm', startSec: 1.7, durationSec: 0.225, desc: '1/8 Note 2: Red strike' },

  // ── ACT 3: CLIMAX TORUS GOAL & CELESTIAL ASCENSION (32.400s – 41.400s | 9.000s) ──
  {
    id: '32_climax_goal',
    type: 'video',
    src: INENGINE_SRC,
    startSec: 71.200,
    durationSec: 3.600,
    desc: 'The Climax Torus Goal: Ball spikes directly through the elevated ring, siren rings out'
  },
  {
    id: '33_celestial_ascend',
    type: 'video',
    src: INENGINE_SRC,
    startSec: 78.400,
    durationSec: 5.400,
    desc: 'Celestial Ascension Arc: Camera rises above the celebration, dipping to black',
    filter: 'fade=t=out:st=4.6:d=0.8'
  },

  // ── OUTRO: FULLSCREEN 9:16 GALAXY TITLE CARD LOCK (41.400s – 50.300s | 8.900s) ──
  {
    id: '34_galaxy_title',
    type: 'image',
    src: TITLE_CARD_SRC,
    durationSec: 8.900,
    desc: 'Fullscreen 9:16 Galaxy Title Card Lock (fade in 0.8s, hold release info)',
    filter: 'fade=t=in:st=0:d=0.8'
  }
];

async function assembleNativeVerticalTrailer() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║       VALLEYBALL VERSUS — TRUE NATIVE 9:16 VERTICAL TRAILER      ║');
  console.log('║       1080x1920 @ 60.00 FPS CFR | Full-Bleed Action Master       ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const totalPlannedDuration = CUT_LIST.reduce((acc, c) => acc + c.durationSec, 0);
  console.log(`[native_9x16] Total planned cuts: ${CUT_LIST.length}`);
  console.log(`[native_9x16] Total duration: ${totalPlannedDuration.toFixed(3)}s (50.300s target)\n`);

  // 1. Transcode each cut into standardized CFR 1080x1920 (9:16) MP4
  console.log('[native_9x16] === STEP 1: RENDERING FULL-BLEED 9:16 CFR VIDEO SEGMENTS ===');
  const segmentFiles = [];
  let timelineSec = 0;

  // The full-bleed 9:16 crop filter:
  // Scale height to 1920 (width becomes 3413.33), then center crop exactly 1080x1920
  const verticalCropFilter = 'scale=3413:1920:flags=lanczos,crop=1080:1920:(in_w-out_w)/2:(in_h-out_h)/2,setsar=1';

  for (let i = 0; i < CUT_LIST.length; i++) {
    const cut = CUT_LIST[i];
    const segPath = path.join(TEMP_DIR, `vseg_${String(i + 1).padStart(2, '0')}_${cut.id}.mp4`);
    segmentFiles.push(segPath);

    console.log(`[${i + 1}/${CUT_LIST.length}] ${cut.id} (${cut.durationSec.toFixed(3)}s) - ${cut.desc}`);

    const args = ['-y'];
    const frameCount = Math.round((timelineSec + cut.durationSec) * 60) - Math.round(timelineSec * 60);
    timelineSec += cut.durationSec;

    const exactVideo = `fps=60,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${frameCount},setpts=PTS-STARTPTS`;
    const exactAudio = `aresample=48000,apad,atrim=duration=${(frameCount / 60).toFixed(6)},asetpts=PTS-STARTPTS`;
    const readSec = String(cut.durationSec + 0.5);

    if (cut.type === 'raw') {
      const rawPath = path.join(RAW_CHUNKS_DIR, cut.file);
      args.push(
        '-ss', String(cut.startSec),
        '-t', readSec,
        '-i', rawPath,
        '-vf', `${verticalCropFilter},format=yuv420p,${exactVideo}`,
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
      );
    } else if (cut.type === 'video') {
      const vf = cut.filter
        ? `${verticalCropFilter},format=yuv420p,${cut.filter},${exactVideo}`
        : `${verticalCropFilter},format=yuv420p,${exactVideo}`;

      args.push(
        '-ss', String(cut.startSec),
        '-t', readSec,
        '-i', cut.src,
        '-f', 'lavfi',
        '-t', String(cut.durationSec),
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-vf', vf,
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
      );
    } else if (cut.type === 'image') {
      // Fullscreen 9:16 title card is already 1080x1920
      const vf = cut.filter
        ? `scale=1080:1920:flags=lanczos,setsar=1,format=yuv420p,${cut.filter},${exactVideo}`
        : `scale=1080:1920:flags=lanczos,setsar=1,format=yuv420p,${exactVideo}`;

      args.push(
        '-loop', '1',
        '-t', String(cut.durationSec),
        '-r', '60',
        '-i', cut.src,
        '-f', 'lavfi',
        '-t', String(cut.durationSec),
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-vf', vf,
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
      );
    }

    execFileSync('ffmpeg', args, { stdio: 'pipe' });
  }

  // 2. Concatenate all 34 cuts into a single seamless vertical video stream
  console.log('\n[native_9x16] === STEP 2: CONCATENATING 34 VERTICAL CUTS (50.3s SEAMLESS EDIT) ===');
  const concatListFile = path.join(TEMP_DIR, 'vertical_concat_list.txt');
  const concatContent = segmentFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(concatListFile, concatContent, 'utf8');

  const stitchedVideoSfx = path.join(TEMP_DIR, 'stitched_vertical_video_sfx.mp4');
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

  // 3. Audio Layering: Mix "Neon Velocity" starting at 44.20s (The Drop) with isolated SFX Stem
  console.log('\n[native_9x16] === STEP 3: AUDIO MASTERING ("NEON VELOCITY" DROP + BOOSTED SFX) ===');
  const dur = totalPlannedDuration.toFixed(3);
  const filterComplex = [
    `[0:v]trim=duration=${dur},setpts=PTS-STARTPTS[vout]`,

    // Music starting at 44.20s in the track (the drum drop), ducked -2.5 dB during action, fading out at 46.5s -> 49.5s
    '[1:a]volume=enable=\'between(t,0,38.0)\':volume=-2.5dB,' +
      'afade=t=out:st=45.5:d=4.5,' +
      `apad=whole_dur=${dur},atrim=duration=${dur}[music]`,

    // SFX stem boosted by +15 dB so physical impacts (spikes, dives, Torus sirens) punch through
    `[0:a]volume=+15dB,atrim=duration=${dur}[sfx]`,

    // Mix at full level and master to -14 LUFS streaming target
    '[music][sfx]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11[aout]'
  ].join(';');

  console.log('\n[native_9x16] === STEP 4: ENCODING NATIVE 9:16 BROADCAST MASTER (1080x1920 60 FPS) ===');
  execFileSync('ffmpeg', [
    '-y',
    '-i', stitchedVideoSfx,
    '-ss', '44.200',
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
  console.log(`\n✓ Native 9:16 Master Deliverable: ${MASTER_OUTPUT}`);
  console.log(`  Size: ${(masterStat.size / (1024 * 1024)).toFixed(2)} MB`);

  // 4. Encode Social Web Cut (<25 MB for Discord / Mobile direct upload)
  console.log('\n[native_9x16] === STEP 5: ENCODING SOCIAL WEB CUT (<25 MB) ===');
  const socialAudioKbps = 192;
  const socialVideoKbps = Math.floor((24 * 8 * 1024 * 1024) / totalPlannedDuration / 1000) - socialAudioKbps;
  const socialVideoArgs = [
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-b:v', `${socialVideoKbps}k`,
    '-pix_fmt', 'yuv420p',
    '-passlogfile', path.join(TEMP_DIR, 'v_social_2pass')
  ];

  execFileSync('ffmpeg', ['-y', '-i', MASTER_OUTPUT, ...socialVideoArgs, '-pass', '1', '-an', '-f', 'null', '-'], { stdio: 'inherit' });
  execFileSync('ffmpeg', [
    '-y',
    '-i', MASTER_OUTPUT,
    ...socialVideoArgs,
    '-pass', '2',
    '-c:a', 'aac',
    '-b:a', `${socialAudioKbps}k`,
    '-ar', '48000',
    SOCIAL_OUTPUT
  ], { stdio: 'inherit' });

  const socialStat = fs.statSync(SOCIAL_OUTPUT);
  console.log(`\n✓ Native 9:16 Social Cut: ${SOCIAL_OUTPUT}`);
  console.log(`  Size: ${(socialStat.size / (1024 * 1024)).toFixed(2)} MB`);

  // 5. Extract Verification Milestone Stills
  console.log('\n[native_9x16] === STEP 6: EXTRACTING MILESTONE STILLS ===');
  const milestones = [
    { name: '01_act1_the_drop_aerial_cam.png', time: '00:00:01.000' },
    { name: '02_act1_low_turf_strike.png', time: '00:00:02.800' },
    { name: '03_act1_close_orbit_strike.png', time: '00:00:06.400' },
    { name: '04_act1_turf_diving_save.png', time: '00:00:08.200' },
    { name: '05_act2_staccato_blitz_contest.png', time: '00:00:23.000' },
    { name: '06_act2_rvb_diving_exchange.png', time: '00:00:27.500' },
    { name: '07_act3_climax_torus_hoop_goal.png', time: '00:00:34.500' },
    { name: '08_outro_fullscreen_galaxy_title.png', time: '00:00:44.000' },
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

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('       NATIVE 9:16 VERTICAL TRAILER PRODUCTION COMPLETE!          ');
  console.log('══════════════════════════════════════════════════════════════════\n');
}

assembleNativeVerticalTrailer().catch(err => {
  console.error('[native_9x16] Error during assembly:', err);
  process.exit(1);
});
