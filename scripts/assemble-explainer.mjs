/**
 * HOW TO PLAY EXPLAINER — assembly.
 *
 *   node scripts/assemble-explainer.mjs [long|tiktok|all]
 *
 * Reads captures/explainer/timeline.json (from plan-explainer-shots.mjs), the
 * rendered shots (capture-explainer.mjs render) and the card overlays
 * (generate_explainer_cards.mjs), and writes to captures/explainer/out/:
 *   - valleyball_how_to_play_16x9.mp4       the full long cut on "Maximum Velocity"
 *   - tiktok/partNN_<topic>.mp4             eight 9:16 parts, with music
 *   - tiktok/partNN_<topic>_nomusic.mp4     the same, silent, for an in-app sound
 *   - tiktok/bonus_*.mp4                    two music-synced highlight shorts
 *
 * Every segment is first built as its own exact-length clip per aspect, so the
 * long cut and the TikTok parts cut from identical footage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { EXPLAINER_PARTS } from './generate_explainer_cards.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const X = path.join(ROOT, 'captures', 'explainer');
const SHOTS = path.join(X, 'shots');
const CARDS = path.join(X, 'cards');
const TMP = process.env.XP_TMP ?? path.join(X, 'assembly_tmp');
const OUT = process.env.XP_OUT ?? path.join(X, 'out');
const OUTRO = { '16x9': path.join(ROOT, 'captures/trailer/title_card_galaxy.png'), '9x16': path.join(ROOT, 'captures/trailer/title_card_vertical_9x16.png') };
const SIZE = { '16x9': [1920, 1080], '9x16': [1080, 1920] };
const FPS = 60;
const FADE = 0.3;

const timeline = JSON.parse(fs.readFileSync(process.env.XP_TIMELINE ?? path.join(X, 'timeline.json'), 'utf8'));
const { music } = timeline;
const MUSIC = path.join(ROOT, music.file);
const BAR = 240 / music.bpm;
const barSec = (b) => music.bar1 + (b - 1) * BAR;
const barFrame = (b) => (b <= 1 ? 0 : Math.round(barSec(b) * FPS));

// Cuts in the 12-beat recap on the breakdown, one beat each.
const RECAP = ['b06_run', 'b07_cut', 'b08_kick', 'b08_volley', 'b09_spike', 'b12_dive', 'b13_brace', 'b14_tackle', 'rally_slide', 'rally_dive2', 'rally_volley', 'b11_ring'];
// Panel labels for the split segments.
const LABELS = {
  b10_perfect: 'PERFECT TIMING · FULL POWER', b10_late: 'LATE · A THIRD OF THE SPEED',
  b15_small: 'SMALL · 0.4 M', b15_medium: 'MEDIUM · 1.0 M', b15_large: 'LARGE · 1.5 M',
};
// TikTok music: the bar each part's excerpt starts on, by energy section.
const PART_MUSIC = { 1: 49, 2: 25, 3: 73, 4: 25, 5: 49, 6: 81, 7: 115, 8: 89 };
// Each part opens on a moment it doesn't then repeat: [segment, shot].
const PART_HOOK = {
  1: ['b17', 'b17_goal2'], 2: ['rally', 'rally_bank'], 3: ['rally', 'rally_slide'], 4: ['rally', 'rally_volley'],
  5: ['b17', 'b17_goal1'], 6: ['rally', 'rally_dive2'], 7: ['rally', 'rally_knock'], 8: ['b17', 'b17_goal3'],
};
// A beat window centred on a specific shot instead of the segment's last key.
const PART_BEAT_SHOT = { b17_combo: 'b17_goal1' };

const ENC_TMP = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', String(FPS)];
const ENC_FINAL = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart'];

function ff(args) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
}
/**
 * Two-pass linear loudnorm to -14 LUFS: measure first, then apply one gain.
 * Single-pass loudnorm rides the level and drifts on a track that builds into
 * a loud drop (the full song came out at -12.5).
 */
function loudnorm(inputArgs, pre) {
  const target = 'I=-14:TP=-1.5:LRA=11';
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...inputArgs, '-af', `${pre}loudnorm=${target}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = JSON.parse(r.stderr.slice(r.stderr.lastIndexOf('{'), r.stderr.lastIndexOf('}') + 1));
  return `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
}

function frames(file) {
  return parseInt(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file]).toString().trim(), 10);
}
const shotFile = (id, aspect) => path.join(SHOTS, `${id}_${aspect}.mp4`);
const segFile = (id, aspect) => path.join(TMP, `seg_${id}_${aspect}.mp4`);

/** Panel labels, in the cards' mono style, rendered once. */
async function renderLabels() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 80 }, deviceScaleFactor: 1 });
  for (const [id, text] of Object.entries(LABELS)) {
    await page.setContent(`<!DOCTYPE html><html><head><link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet"><style>
      html,body{margin:0;background:transparent}
      span{display:inline-block;margin:12px;padding:10px 18px;border-radius:6px;background:rgba(10,10,14,.8);border:1px solid rgba(255,255,255,.14);
        font:700 22px 'JetBrains Mono',monospace;letter-spacing:.16em;color:#F5F5F7}
    </style></head><body><span id="l">${text}</span></body></html>`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await (await page.$('#l')).screenshot({ path: path.join(TMP, `label_${id}.png`), omitBackground: true });
  }
  await browser.close();
}

/** One segment as an exact-length clip in one aspect. */
function buildSegment(seg, aspect) {
  const out = segFile(seg.id, aspect);
  const n = seg.frames[1] - seg.frames[0];
  const [W, H] = SIZE[aspect];
  if (seg.outro) {
    ff(['-loop', '1', '-framerate', String(FPS), '-i', OUTRO[aspect], '-vf', `scale=${W}:${H},format=yuv420p,fade=t=in:st=0:d=0.5`, '-frames:v', String(n), ...ENC_TMP, out]);
  } else if (seg.recap) {
    const shotsById = new Map(timeline.segments.flatMap((s) => s.shots).map((s) => [s.id, s]));
    const inputs = [], parts = [];
    RECAP.forEach((id, i) => {
      const s = shotsById.get(id);
      const len = Math.round(((i + 1) * n) / RECAP.length) - Math.round((i * n) / RECAP.length);
      const key = s.keyFrame - s.frames[0];
      const a = Math.max(0, Math.min(s.frames[1] - s.frames[0] - len, key - Math.round(len * 0.4)));
      inputs.push('-i', shotFile(id, aspect));
      parts.push(`[${i}:v]trim=start_frame=${a}:end_frame=${a + len},setpts=PTS-STARTPTS[r${i}]`);
    });
    ff([...inputs, '-filter_complex', `${parts.join(';')};${RECAP.map((_, i) => `[r${i}]`).join('')}concat=n=${RECAP.length}:v=1:a=0[v]`, '-map', '[v]', '-frames:v', String(n), ...ENC_TMP, out]);
  } else if (seg.panel) {
    const inputs = [], labels = [], f = [];
    seg.shots.forEach((s, i) => { inputs.push('-i', shotFile(s.id, aspect)); });
    seg.shots.forEach((s, i) => { inputs.push('-i', path.join(TMP, `label_${s.id}.png`)); });
    const k = seg.shots.length;
    // Labels sit where nothing covers them: in 16:9 at the panel tops (the card
    // owns the bottom left); in 9:16 either side of the divider, between the
    // headline and the card. The 9:16 triptych leaves it to the card's chips.
    const labelY = (i) => (aspect === '16x9' ? '40' : k === 2 ? (i === 0 ? 'H-h-20' : '20') : null);
    seg.shots.forEach((s, i) => {
      const y = labelY(i);
      f.push(y === null ? `[${i}:v]null[p${i}]` : `[${i}:v][${k + i}:v]overlay=x=(W-w)/2:y=${y}[p${i}]`);
    });
    const stack = aspect === '16x9' ? 'hstack' : 'vstack';
    const line = aspect === '16x9' ? seg.shots.slice(1).map((_, i) => `drawbox=x=${(i + 1) * (W / k) - 2}:y=0:w=4:h=${H}:color=white@0.55:t=fill`) : seg.shots.slice(1).map((_, i) => `drawbox=x=0:y=${(i + 1) * (H / k) - 2}:w=${W}:h=4:color=white@0.55:t=fill`);
    f.push(`${seg.shots.map((_, i) => `[p${i}]`).join('')}${stack}=inputs=${k}${line.length ? ',' + line.join(',') : ''}[v]`);
    ff([...inputs, '-filter_complex', f.join(';'), '-map', '[v]', '-frames:v', String(n), ...ENC_TMP, out]);
  } else {
    const inputs = seg.shots.flatMap((s) => ['-i', shotFile(s.id, aspect)]);
    const f = `${seg.shots.map((_, i) => `[${i}:v]`).join('')}concat=n=${seg.shots.length}:v=1:a=0[v]`;
    ff([...inputs, '-filter_complex', f, '-map', '[v]', '-frames:v', String(n), ...ENC_TMP, out]);
  }
  const got = frames(out);
  if (got !== n) throw new Error(`${seg.id} ${aspect}: ${got} frames, expected ${n}`);
}

/** Card overlay filter chain: each [input] faded in and out over its window. */
function overlayChain(base, overlays, firstInput) {
  const f = [];
  let cur = base;
  overlays.forEach((o, i) => {
    const d = o.end - o.start;
    f.push(`[${firstInput + i}:v]format=rgba,fade=t=in:st=0:d=${FADE}:alpha=1,fade=t=out:st=${(d - FADE).toFixed(3)}:d=${FADE}:alpha=1,setpts=PTS-STARTPTS+${o.start.toFixed(3)}/TB[o${i}]`);
    f.push(`${cur}[o${i}]overlay=0:0:eof_action=pass:enable='between(t,${o.start.toFixed(3)},${o.end.toFixed(3)})'[b${i}]`);
    cur = `[b${i}]`;
  });
  return { f, out: cur };
}

function buildLong() {
  const aspect = '16x9';
  const list = path.join(TMP, 'long_16x9.txt');
  fs.writeFileSync(list, timeline.segments.map((s) => `file '${segFile(s.id, aspect).replace(/\\/g, '/')}'`).join('\n'));
  const video = path.join(TMP, 'long_16x9_video.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);
  const overlays = [];
  const seg = (id) => timeline.segments.find((s) => s.id === id);
  const title = seg('cold')?.shots.find((s) => s.id === 'cold_title');
  if (title) overlays.push({ png: path.join(CARDS, '16x9', 'b00_title_how_to_play.png'), start: title.frames[0] / FPS + 0.1, end: title.frames[1] / FPS - 0.1 });
  for (const s of timeline.segments) {
    if (!s.card) continue;
    let end = s.frames[1] / FPS - 0.15;
    if (s.id === 'b17') end = barSec(119) - 0.1; // the finale's card clears for the last two goals
    overlays.push({ png: path.join(CARDS, '16x9', `${s.card}.png`), start: s.frames[0] / FPS + 0.35, end });
  }
  const inputs = ['-i', video, '-i', MUSIC];
  for (const o of overlays) inputs.push('-loop', '1', '-framerate', String(FPS), '-t', (o.end - o.start).toFixed(3), '-i', o.png);
  const { f, out } = overlayChain('[0:v]', overlays, 2);
  f.push(`[1:a]atrim=0:${music.durationSec},${loudnorm(['-i', MUSIC], `atrim=0:${music.durationSec},`)}[a]`);
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'valleyball_how_to_play_16x9.mp4');
  ff([...inputs, '-filter_complex', f.join(';'), '-map', out, '-map', '[a]', '-frames:v', String(timeline.endFrame), ...ENC_FINAL, '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', file]);
  console.log(`[assemble] ${path.relative(ROOT, file)}: ${frames(file)} frames`);
}

/** A 9:16 window of `bars` bars from a segment clip, keeping its key moment in view. */
function windowFrom(segId, bars, keyAt = 0.55, shotId = null) {
  const s = timeline.segments.find((x) => x.id === segId);
  const n = s.frames[1] - s.frames[0];
  const len = Math.round(bars * BAR * FPS);
  const keyShot = shotId ? s.shots.find((x) => x.id === shotId) : s.shots.reduce((best, x) => (x.keyFrame > (best?.keyFrame ?? -1) ? x : best), null);
  const key = (keyShot?.keyFrame ?? s.frames[0] + n / 2) - s.frames[0];
  const a = Math.max(0, Math.min(n - len, Math.round(key - keyAt * len)));
  return { file: segFile(segId, '9x16'), a, len };
}

function buildTikTok() {
  const dir = path.join(OUT, 'tiktok');
  fs.mkdirSync(dir, { recursive: true });
  const segOfCard = (card) => timeline.segments.find((s) => s.card === card)?.id;
  const jobs = EXPLAINER_PARTS.map((part) => {
    const p = String(part.n).padStart(2, '0');
    const beats = part.beats.map((card, i) => ({ card, seg: segOfCard(card), png: path.join(CARDS, '9x16', `part${p}_${String(i + 1).padStart(2, '0')}_${card}.png`) }));
    const [hookSeg, hookShot] = PART_HOOK[part.n];
    return { name: `part${p}_${part.topic.toLowerCase().replace(/[^a-z]+/g, '_')}`, startBar: PART_MUSIC[part.n],
      hook: { ...windowFrom(hookSeg, 2, 0.6, hookShot), png: path.join(CARDS, '9x16', `part${p}_00_hook.png`) },
      beats: beats.map((b) => ({ ...windowFrom(b.seg, 4, 0.55, PART_BEAT_SHOT[b.card] ?? null), png: b.png })),
      end: path.join(CARDS, '9x16', `part${p}_99_end.png`) };
  });
  // Bonus shorts ride the long cut's own music position, so they stay in sync.
  const bonus = [
    { name: 'bonus_the_payoff', startBar: 112, clips: [{ ...windowFrom('recap', 3, 0.5) }, { ...windowFrom('b17', 8, 0.5) }], end: OUTRO['9x16'] },
    { name: 'bonus_no_whistles', startBar: 98, clips: [{ ...windowFrom('rally', 7, 0.5) }], end: OUTRO['9x16'] },
  ];
  for (const job of [...jobs, ...bonus]) {
    const clips = job.hook ? [job.hook, ...job.beats] : job.clips;
    const inputs = [], f = [];
    clips.forEach((c, i) => {
      inputs.push('-i', c.file);
      f.push(`[${i}:v]trim=start_frame=${c.a}:end_frame=${c.a + c.len},setpts=PTS-STARTPTS[c${i}]`);
    });
    const endLen = Math.round(2 * BAR * FPS);
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', (endLen / FPS).toFixed(3), '-i', job.end);
    const ei = clips.length;
    f.push(`[${ei}:v]scale=1080:1920,format=yuv420p,setpts=PTS-STARTPTS[endv]`);
    f.push(`${clips.map((_, i) => `[c${i}]`).join('')}[endv]concat=n=${clips.length + 1}:v=1:a=0[base]`);
    // Card overlays over each clip window.
    const overlays = [];
    let t = 0;
    for (const c of clips) {
      if (c.png) overlays.push({ png: c.png, start: t + 0.2, end: t + c.len / FPS - 0.15 });
      t += c.len / FPS;
    }
    const total = t + endLen / FPS;
    overlays.forEach((o) => inputs.push('-loop', '1', '-framerate', String(FPS), '-t', (o.end - o.start).toFixed(3), '-i', o.png));
    const { f: of, out } = overlayChain('[base]', overlays, ei + 1);
    f.push(...of);
    const totalFrames = Math.round(total * FPS);
    const silent = path.join(dir, `${job.name}_nomusic.mp4`);
    ff([...inputs, '-f', 'lavfi', '-t', total.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo', '-filter_complex', f.join(';'), '-map', out, '-map', `${inputs.filter((x) => x === '-i').length}:a`,
      '-frames:v', String(totalFrames), ...ENC_FINAL, '-c:a', 'aac', '-b:a', '128k', '-shortest', silent]);
    const withMusic = path.join(dir, `${job.name}.mp4`);
    const ss = barSec(job.startBar), fadeOut = Math.max(0, total - 0.6);
    ff(['-i', silent, '-ss', ss.toFixed(3), '-t', total.toFixed(3), '-i', MUSIC,
      '-filter_complex', `[1:a]afade=t=in:st=0:d=0.05,afade=t=out:st=${fadeOut.toFixed(3)}:d=0.6,loudnorm=I=-14:TP=-1.5:LRA=11[a]`,
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-shortest', withMusic]);
    console.log(`[assemble] ${path.relative(ROOT, withMusic)}: ${(total).toFixed(1)} s`);
  }
}

const mode = process.argv[2] ?? 'all';
const REBUILD = process.env.XP_REBUILD?.split(',') ?? null;
fs.mkdirSync(TMP, { recursive: true });
await renderLabels();
for (const aspect of ['16x9', '9x16']) {
  for (const seg of timeline.segments) {
    if (mode === 'tiktok' && aspect === '16x9') continue;
    if (mode === 'long' && aspect === '9x16') continue;
    // XP_REBUILD=b10,b15 rebuilds just those; other segment clips are reused.
    if (REBUILD && !REBUILD.includes(seg.id) && fs.existsSync(segFile(seg.id, aspect))) continue;
    buildSegment(seg, aspect);
  }
  console.log(`[assemble] segments built (${aspect})`);
}
if (mode !== 'tiktok') buildLong();
if (mode !== 'long') buildTikTok();
