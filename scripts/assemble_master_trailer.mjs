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
 *     Phase 4: Climax Torus Goal & Celestial Ascension (76.60s – 85.60s)
 *     Phase 5: Brand Galaxy Outro & Title Card Lock (85.60s – 94.50s)
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
// Written by scripts/generate-argon-raw-reel.mjs
const RAW_CHUNKS_DIR = path.join(ROOT, 'captures', 'raw_footage', 'raw_chunks');
// The in-engine trailer sequence from capture-trailer-video.mjs, stepped frame by
// frame: every engine frame at exactly 60 fps, so video time equals engine time.
// No fades or title card (the debut composite adds those).
const INENGINE_SRC = path.join(OUT_DIR, 'raw_footage_1080p60.mp4');
const MUSIC_SRC = path.join(ROOT, 'public', 'audio', 'music', 'track_trailer_neon_velocity.mp3');
const TITLE_CARD_SRC = path.join(OUT_DIR, 'title_card_galaxy.png');

// Distinct from capture-trailer-video.mjs, which writes its in-engine-only cut
// to valleyball_versus_official_trailer_*.mp4 and would overwrite these.
const MASTER_OUTPUT = path.join(OUT_DIR, 'valleyball_versus_master_trailer_1080p60.mp4');
const SOCIAL_OUTPUT = path.join(OUT_DIR, 'valleyball_versus_master_trailer_social_1080p.mp4');
const MONTAGE_PREVIEW_OUTPUT = path.join(OUT_DIR, 'montage_preview_1080p60.mp4');

// --montage-only renders just the gameplay cuts (44.2s – 76.6s) with the music
// from the same point, to review the action edit without the in-engine captures.
const MONTAGE_ONLY = process.argv.includes('--montage-only');

fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// Define complete 35-cut sequence strictly quantized to 133.33 BPM.
// Gameplay cuts come from the trailer/clip-capture reel (2026-10-23): game_NN_raw.webm,
// startSec = seconds into that raw clip. Games 5, 10, ... 50 are Red (Football Helmet)
// vs Blue (Cricket Helmet); every cut from 66.7s on uses only those, matching the
// director's Act III Red vs Blue lock from 67s.
const CUT_LIST = [
  // ── PHASE 1: MONUMENTAL ARCHITECTURAL OVERTURE (0.000s – 44.200s | 44.200s) ──
  {
    id: '01_phase1_overture',
    type: 'video',
    src: INENGINE_SRC,
    startSec: 0.0,
    durationSec: 44.200,
    desc: 'Monumental Architectural Overture (in-engine: stadium reveal, contenders, opening goals, Rally 3 build)',
    filter: 'fade=t=in:st=0:d=2.0'
  },

  // ── PHASE 2: RHYTHMIC ACTION ESCALATION (44.200s – 62.200s | 10 Bars @ 1.800s) ──
  { id: '02_bar0_the_drop', type: 'raw', file: 'game_04_raw.webm', startSec: 0.5, durationSec: 1.800, desc: 'THE DROP (Bar 0): Vertical Aerial Spike Cam, the giant black globe fills the frame' },
  { id: '03_bar1_low_turf', type: 'raw', file: 'game_02_raw.webm', startSec: 2.2, durationSec: 1.800, desc: 'Bar 1: Low Turf Follow, close strike by the red-hat athlete' },
  { id: '04_bar2_duel', type: 'raw', file: 'game_24_raw.webm', startSec: 1.5, durationSec: 1.800, desc: 'Bar 2: Over-Shoulder Chase, close duel under the globe (purple vs yellow gloves)' },
  { id: '05_bar3_orbit', type: 'raw', file: 'game_27_raw.webm', startSec: 2.2, durationSec: 1.800, desc: 'Bar 3: Dynamic Action Orbit, globe ball in close-up as the athletes close in' },
  { id: '06_bar4_strike_dive', type: 'raw', file: 'game_38_raw.webm', startSec: 2.2, durationSec: 1.800, desc: 'Bar 4: Over-Shoulder Chase, close strike into a dive (red gloves)' },
  { id: '07_bar5_globe_roll', type: 'raw', file: 'game_09_raw.webm', startSec: 3.2, durationSec: 1.800, desc: 'Bar 5: Low Turf Follow, the globe rolls through the athletes' },
  { id: '08_bar6_black_globe', type: 'raw', file: 'game_31_raw.webm', startSec: 2.5, durationSec: 1.800, desc: 'Bar 6: Over-Shoulder Chase, close strike on the black globe (yellow gloves)' },
  { id: '09_bar7_large_globe', type: 'raw', file: 'game_48_raw.webm', startSec: 0.5, durationSec: 1.800, desc: 'Bar 7: Dynamic Action Orbit, large globe rolls past the athletes' },
  { id: '10_bar8_green_gloves', type: 'raw', file: 'game_39_raw.webm', startSec: 1.6, durationSec: 1.800, desc: 'Bar 8: Vertical Aerial Spike, globe and green-gloved athlete' },
  { id: '11_bar9_red_key', type: 'raw', file: 'game_12_raw.webm', startSec: 0.6, durationSec: 1.800, desc: 'Bar 9: Banked Wall, chase across the red key after the globe' },

  // ── PHASE 3: RAPID-FIRE STACCATO CLIMAX (62.200s – 76.600s | 14.400s) ──
  // Part A: 12 Half-Bar Cuts @ 0.900s each = 10.800s (62.200s – 73.000s)
  { id: '12_half1', type: 'raw', file: 'game_17_raw.webm', startSec: 1.0, durationSec: 0.900, desc: 'Half-Bar 1: Over-Shoulder Chase, close sprint (blue gloves)' },
  { id: '13_half2', type: 'raw', file: 'game_18_raw.webm', startSec: 0.8, durationSec: 0.900, desc: 'Half-Bar 2: Vertical Aerial Spike, the globe fills the frame' },
  { id: '14_half3', type: 'raw', file: 'game_34_raw.webm', startSec: 2.9, durationSec: 0.900, desc: 'Half-Bar 3: Dynamic Action Orbit, athlete and the black globe close' },
  { id: '15_half4', type: 'raw', file: 'game_46_raw.webm', startSec: 3.5, durationSec: 0.900, desc: 'Half-Bar 4: Vertical Aerial Spike, athlete in hat meets the black globe' },
  { id: '16_half5', type: 'raw', file: 'game_03_raw.webm', startSec: 3.3, durationSec: 0.900, desc: 'Half-Bar 5: Over-Shoulder Chase, close athlete and the globe' },
  { id: '17_half6_rvb', type: 'raw', file: 'game_10_raw.webm', startSec: 2.6, durationSec: 0.900, desc: 'Half-Bar 6 (Red vs Blue): Over-Shoulder Chase, ball overhead' },
  { id: '18_half7_rvb', type: 'raw', file: 'game_20_raw.webm', startSec: 0.4, durationSec: 0.900, desc: 'Half-Bar 7 (Red vs Blue): Dynamic Action Orbit, close contest' },
  { id: '19_half8_rvb', type: 'raw', file: 'game_30_raw.webm', startSec: 3.3, durationSec: 0.900, desc: 'Half-Bar 8 (Red vs Blue): Low Turf Follow, Blue chases the globe' },
  { id: '20_half9_rvb', type: 'raw', file: 'game_45_raw.webm', startSec: 0.2, durationSec: 0.900, desc: 'Half-Bar 9 (Red vs Blue): Over-Shoulder Chase, Red and the globe close' },
  { id: '21_half10_rvb', type: 'raw', file: 'game_50_raw.webm', startSec: 5.4, durationSec: 0.900, desc: 'Half-Bar 10 (Red vs Blue): 3/4 Flank North, Blue closes in as Red dives' },
  { id: '22_half11_rvb', type: 'raw', file: 'game_25_raw.webm', startSec: 0.4, durationSec: 0.900, desc: 'Half-Bar 11 (Red vs Blue): Vertical Aerial Spike, Red on the ball' },
  { id: '23_half12_rvb', type: 'raw', file: 'game_05_raw.webm', startSec: 1.0, durationSec: 0.900, desc: 'Half-Bar 12 (Red vs Blue): Banked Wall, diving exchange' },

  // Part B: Apex Eighth-Note Blitz (3.600s total | 73.000s – 76.600s), Red vs Blue
  { id: '24_eighth1', type: 'raw', file: 'game_20_raw.webm', startSec: 2.4, durationSec: 0.450, desc: '1/4 Note 1: close contest' },
  { id: '25_eighth2', type: 'raw', file: 'game_30_raw.webm', startSec: 1.0, durationSec: 0.450, desc: '1/4 Note 2: Blue and the globe' },
  { id: '26_eighth3', type: 'raw', file: 'game_10_raw.webm', startSec: 4.6, durationSec: 0.450, desc: '1/4 Note 3: Blue strike' },
  { id: '27_eighth4', type: 'raw', file: 'game_45_raw.webm', startSec: 1.4, durationSec: 0.450, desc: '1/4 Note 4: Red and the globe' },
  { id: '28_eighth5', type: 'raw', file: 'game_35_raw.webm', startSec: 1.3, durationSec: 0.450, desc: '1/4 Note 5: Red full-stretch dive' },
  { id: '29_eighth6', type: 'raw', file: 'game_50_raw.webm', startSec: 2.2, durationSec: 0.450, desc: '1/4 Note 6: Red sprints the ball, Blue closing' },
  { id: '30_eighth7', type: 'raw', file: 'game_40_raw.webm', startSec: 3.7, durationSec: 0.450, desc: '1/4 Note 7: both athletes and the black globe' },
  { id: '31_sixteenth1', type: 'raw', file: 'game_15_raw.webm', startSec: 5.1, durationSec: 0.225, desc: '1/8 Note 1: ball at the hoop' },
  { id: '32_sixteenth2', type: 'raw', file: 'game_25_raw.webm', startSec: 1.7, durationSec: 0.225, desc: '1/8 Note 2: Red strike' },

  // ── PHASE 4: CLIMAX TORUS GOAL & CELESTIAL ASCENSION (76.600s – 85.600s | 9.000s) ──
  // In-engine shots on engine time, offset by exactly 3 bars (5.4s) so their
  // beat-designed events stay on the beat. Its staged goal is built for this
  // shot; a raw-reel physics strike rarely threads the hoop.
  {
    id: '33_climax_goal',
    type: 'video',
    src: INENGINE_SRC,
    startSec: 71.200,
    // Ends 1.8s after the goal: the rest of Shot 10B is a static empty ring
    durationSec: 3.600,
    desc: 'The Climax Torus Goal: Act III rally, cut on the 77.5s beat to the ring view, spike through the ring on 78.4s'
  },
  {
    id: '34_celestial_ascend',
    type: 'video',
    src: INENGINE_SRC,
    startSec: 78.400,
    durationSec: 5.400,
    desc: 'Celestial Ascension Arc (Shot 11 crane rising over the stadium), dipping to black for the title',
    filter: 'fade=t=out:st=4.6:d=0.8'
  },

  // ── PHASE 5: BRAND GALAXY OUTRO & TITLE CARD LOCK (85.600s – 94.500s | 8.900s) ──
  // Lands on the 85.6s bar line, over the music's closing phrase (it is silent by ~89s).
  {
    id: '35_galaxy_title',
    type: 'image',
    src: TITLE_CARD_SRC,
    durationSec: 8.900,
    desc: 'Brand Galaxy Outro & Title Card Lock (fade in 0.8s, hold release date and URL to 94.5s)',
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

  const cuts = MONTAGE_ONLY ? CUT_LIST.filter(c => c.type === 'raw') : CUT_LIST;
  const montageStartSec = CUT_LIST.slice(0, CUT_LIST.indexOf(cuts[0])).reduce((acc, c) => acc + c.durationSec, 0);
  const montageDurationSec = cuts.reduce((acc, c) => acc + c.durationSec, 0);

  // 1. Process and transcode each cut into standardized CFR 1080p60 MP4
  console.log('\n[assembly] === STEP 1: RENDERING STANDARDIZED CFR VIDEO CHUNKS ===');
  const segmentFiles = [];
  let timelineSec = montageStartSec;

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const segPath = path.join(TEMP_DIR, `seg_${String(i + 1).padStart(2, '0')}_${cut.id}.mp4`);
    segmentFiles.push(segPath);

    console.log(`[${i + 1}/${cuts.length}] ${cut.id} (${cut.durationSec.toFixed(3)}s) - ${cut.desc}`);

    const args = ['-y'];

    // Every segment must be exactly its beat-grid length or the cuts drift off
    // the music: resampling VFR captures to 60 fps lands a few frames long (31
    // cuts drifted ~2s). Trim to an exact frame count, cloning the last frame if
    // a source runs short, and cut the audio to the same length.
    // Round on the cumulative timeline (0.225s is 13.5 frames) so every cut stays
    // within half a frame of its beat and the total stays exact.
    const frameCount = Math.round((timelineSec + cut.durationSec) * 60) - Math.round(timelineSec * 60);
    timelineSec += cut.durationSec;
    const exactVideo = `fps=60,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${frameCount},setpts=PTS-STARTPTS`;
    const exactAudio = `aresample=48000,apad,atrim=duration=${(frameCount / 60).toFixed(6)},asetpts=PTS-STARTPTS`;
    const readSec = String(cut.durationSec + 0.5);

    if (cut.type === 'raw') {
      const rawPath = path.join(RAW_CHUNKS_DIR, cut.file);
      // No input -r: MediaRecorder WebM is VFR, and forcing 60 fps on input
      // retimes low-fps clips into fast-forward. Resample on output only.
      args.push(
        '-ss', String(cut.startSec),
        '-t', readSec,
        '-i', rawPath,
        '-vf', `scale=1920:1080:flags=lanczos,format=yuv420p,${exactVideo}`,
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
        ? `scale=1920:1080:flags=lanczos,format=yuv420p,${cut.filter},${exactVideo}`
        : `scale=1920:1080:flags=lanczos,format=yuv420p,${exactVideo}`;

      // The in-engine capture's own audio is the music bed, which the master
      // adds itself, so this segment's SFX stem is silence (no doubled music).
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
      const vf = cut.filter
        ? `scale=1920:1080:flags=lanczos,format=yuv420p,${cut.filter},${exactVideo}`
        : `scale=1920:1080:flags=lanczos,format=yuv420p,${exactVideo}`;

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

  if (MONTAGE_ONLY) {
    // Music from the montage's own start so the cuts land on the same beats
    // as in the full trailer; same ducking and SFX boost as the action phases.
    const dur = montageDurationSec.toFixed(3);
    const previewFilter = [
      `[0:v]trim=duration=${dur},setpts=PTS-STARTPTS[vout]`,
      `[1:a]volume=-2.5dB,apad=whole_dur=${dur},atrim=duration=${dur}[music]`,
      `[0:a]volume=+15dB,atrim=duration=${dur}[sfx]`,
      '[music][sfx]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11[aout]'
    ].join(';');
    execFileSync('ffmpeg', [
      '-y',
      '-i', stitchedVideoSfx,
      '-ss', montageStartSec.toFixed(3),
      '-i', MUSIC_SRC,
      '-filter_complex', previewFilter,
      '-map', '[vout]',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-r', '60',
      '-fps_mode', 'cfr',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '256k',
      '-ar', '48000',
      MONTAGE_PREVIEW_OUTPUT
    ], { stdio: 'inherit' });
    console.log(`\n✓ Montage preview (${montageStartSec.toFixed(1)}s – ${(montageStartSec + montageDurationSec).toFixed(1)}s of the trailer): ${MONTAGE_PREVIEW_OUTPUT}`);
    return;
  }

  // 3. Audio Layering: Mix "Neon Velocity" Music Master with isolated SFX Stem
  // - "Neon Velocity" runs from 0.0s to 89.85s, with a gentle 3.5s fadeout into silence by 93.5s
  // - During Phase 2, Phase 3, and Climax Goal (44.20s – 82.20s), duck music by -2.5 dB
  //   so in-game impacts (dives, strikes, sirens) cut through with maximum punch!
  console.log('\n[assembly] === STEP 3: DUAL-STEM AUDIO MASTERING (NEON VELOCITY + SFX DUCKING) ===');

  const filterComplex = [
    // [0:v] Pass-through video stream trimmed to exact 94.500s
    '[0:v]trim=duration=94.500,setpts=PTS-STARTPTS[vout]',

    // [1:a] Music Master:
    // Apply dynamic ducking: 0 dB during overture (0-44.20s), -2.5 dB during kinetic action (44.20-80.20s),
    // restore to 0 dB during celestial outro, and fade out at 89.5s -> 93.8s.
    '[1:a]volume=enable=\'between(t,44.20,80.20)\':volume=-2.5dB,' +
    'afade=t=out:st=89.5:d=4.3,' +
    'apad=whole_dur=94.500,atrim=duration=94.500[music]',

    // [0:a] SFX Stem from video clips:
    // Boost SFX during action phases for visceral kinetic crunch. The captured
    // game SFX sit ~20 dB under the music (-34.6 vs -15 LUFS over the montage),
    // so +15 dB is what lets strikes and dives actually cut through.
    '[0:a]volume=enable=\'between(t,44.20,80.20)\':volume=+15dB,' +
    'atrim=duration=94.500[sfx]',

    // Mix Music + SFX at their own levels (amix's default normalize halves both,
    // which left the master at -22 LUFS), limit, then bring the mix to the
    // -14 LUFS streaming target, with peak headroom for the AAC encode.
    '[music][sfx]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11[aout]'
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
  // Two-pass to a bitrate budget: CRF can't promise a file size (CRF 24.5 came
  // out at 25.6 MB). 24 MB over the running time, less the audio track.
  console.log('\n[assembly] === STEP 5: ENCODING SOCIAL WEB CUT (<25 MB) ===');
  const socialAudioKbps = 192;
  const socialVideoKbps = Math.floor((24 * 8 * 1024 * 1024) / totalPlannedDuration / 1000) - socialAudioKbps;
  const socialVideoArgs = [
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-b:v', `${socialVideoKbps}k`,
    '-pix_fmt', 'yuv420p',
    '-passlogfile', path.join(TEMP_DIR, 'social_2pass')
  ];
  execFileSync('ffmpeg', ['-y', '-i', MASTER_OUTPUT, ...socialVideoArgs, '-pass', '1', '-an', '-f', 'null', '-'], { stdio: 'inherit' });
  execFileSync('ffmpeg', [
    '-y',
    '-i', MASTER_OUTPUT,
    ...socialVideoArgs,
    '-pass', '2',
    '-c:a', 'aac',
    '-b:a', `${socialAudioKbps}k`,
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
