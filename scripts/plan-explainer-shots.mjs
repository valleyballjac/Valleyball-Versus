/**
 * HOW TO PLAY EXPLAINER — shot planner.
 *
 *   node scripts/plan-explainer-shots.mjs      writes captures/explainer/shots.json + timeline.json
 *
 * Maps every segment of the long cut onto bars of "Maximum Velocity"
 * (137.568 BPM, bar 1 at 0.192 s, 125 bars + a hard stop) and fills each with
 * mined bot play or a staged take. Every shot is computed twice, a 16:9 and a
 * 9:16 camera path over the SAME simulation ticks, so the two cuts show the
 * same moment framed natively for each screen.
 *
 * A shot's frame k shows the state after simulation tick `start + k` (the
 * mined row with t = start + k). Camera paths are smoothed forward and
 * backward over the known trajectory, so the camera anticipates the play.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCourtFloorY } from '../src/ai/courtHeightmap.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'captures', 'explainer');

// ═══ MUSIC GRID ═══
export const MUSIC = { file: 'captures/explainer/music/maximum_velocity.mp3', bpm: 137.568, bar1: 0.192, bars: 125, durationSec: 219.8135 };
const BAR = 240 / MUSIC.bpm;
export const barFrame = (b) => (b <= 1 ? 0 : Math.round((MUSIC.bar1 + (b - 1) * BAR) * 60));
const END_FRAME = Math.round(MUSIC.durationSec * 60);

// ═══ ARENA LIMITS FOR CAMERAS ═══
const CAM_X = 22.5, CAM_Z = 58, CLEAR = 0.9;

const ASPECTS = {
  '16x9': { w: 1920, h: 1080 },
  '9x16': { w: 1080, h: 1920 },
};
const PANELS = {
  split2: { '16x9': { w: 960, h: 1080 }, '9x16': { w: 1080, h: 960 } },
  split3: { '16x9': { w: 640, h: 1080 }, '9x16': { w: 1080, h: 640 } },
};

// ═══ TRACK DATA ═══
const mineCache = new Map();
function mine(match) {
  if (!mineCache.has(match)) {
    const rows = JSON.parse(fs.readFileSync(path.join(OUT, 'mine', `${match}.json`), 'utf8')).rows.filter((r) => r.t !== undefined);
    mineCache.set(match, rows);
  }
  return mineCache.get(match);
}
function audition(id) {
  return JSON.parse(fs.readFileSync(path.join(OUT, 'audition', `${id}.json`), 'utf8'));
}
/** Row accessor for a source: staged takes read their audition rows from the launch on. */
function source(src) {
  const rows = mine(src.match);
  const aud = src.aud ? audition(src.aud) : null;
  const L = aud?.audition.launch.tick;
  const at = (t) => {
    if (aud && t >= L) return aud.rows[Math.min(aud.rows.length - 1, t - L)];
    return rows[Math.max(0, Math.min(rows.length - 1, t - 1))];
  };
  const last = aud ? L + aud.rows.length - 1 : rows.length;
  return { at, last, stage: aud ? { puppet: aud.audition.puppet, brace: aud.audition.brace, launch: aud.audition.launch } : null };
}
function events(src) {
  const s = source(src);
  const out = [];
  for (let t = 1; t <= s.last; t++) for (const e of s.at(t).ev ?? []) out.push({ ...e, t });
  return out;
}

// ═══ VECTOR HELPERS ═══
const lerp = (a, b, u) => a + (b - a) * u;
const ease = (u) => u * u * (3 - 2 * u);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function gaussSmooth(series, sigma) {
  if (sigma <= 0) return series;
  const r = Math.ceil(sigma * 2.5), out = [];
  for (let i = 0; i < series.length; i++) {
    let w = 0; const acc = series[0].map(() => 0);
    for (let k = -r; k <= r; k++) {
      const j = clamp(i + k, 0, series.length - 1), g = Math.exp(-(k * k) / (2 * sigma * sigma));
      series[j].forEach((v, d) => { acc[d] += v * g; });
      w += g;
    }
    out.push(acc.map((v) => v / w));
  }
  return out;
}
function keepInside(p) {
  const x = clamp(p[0], -CAM_X, CAM_X), z = clamp(p[2], -CAM_Z, CAM_Z);
  return [x, Math.max(p[1], getCourtFloorY(x, z) + CLEAR), z];
}
const r3 = (v) => Math.round(v * 1000) / 1000;
const pack = (p, l, f) => ({ p: p.map(r3), l: l.map(r3), f: r3(f) });

// ═══ RIGS ═══
// Each rig maps (source, tick list, aspect) -> camera per frame.
const PAD = 40;

/** Athlete- or ball-centred follow camera. */
function rigFollow(o) {
  return (src, ticks, aspect) => {
    const port = aspect === '9x16' || aspect === 'panelTall';
    const s = source(src);
    const t0 = ticks[0] - PAD, t1 = ticks.at(-1) + PAD;
    const raw = [];
    for (let t = t0; t <= t1; t++) {
      const r = s.at(t);
      const b = r.b;
      let fx, fy, fz;
      if (o.who === 'ball') { fx = b[0]; fy = b[1]; fz = b[2]; } else {
        const a = r.a[o.who];
        const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const wb = (o.wBall ?? 0.35) * clamp(1 - (d - 4) / 8, 0, 1);
        fx = lerp(a[0], b[0], wb); fz = lerp(a[2], b[2], wb);
        fy = Math.max(a[1] + 0.5, lerp(a[1] + 0.5, b[1], wb * 0.6));
      }
      raw.push([fx, fy, fz]);
    }
    const focus = gaussSmooth(raw, o.sigma ?? 14);
    // One azimuth for the whole shot, from the subject's mean travel.
    let mx = 0, mz = 0;
    for (let t = ticks[0]; t <= ticks.at(-1); t++) {
      const r = s.at(t);
      const v = o.who === 'ball' ? [r.b[3], r.b[5]] : [r.a[o.who][3], r.a[o.who][4]];
      mx += v[0]; mz += v[1];
    }
    let travel = Math.hypot(mx, mz) > 1e-3 ? Math.atan2(mx, mz) : 0;
    if (o.azimuthWorld !== undefined) travel = o.azimuthWorld;
    const mid = focus[Math.floor(focus.length / 2)];
    let az;
    if (o.view === 'behind') az = travel + Math.PI;
    else if (o.view === 'front') az = travel + (o.frontSkew ?? 0.5);
    else if (o.view === 'fixed') az = o.az;
    else {
      // Side view, on the side that looks in toward the court's centre line.
      const sideA = travel + Math.PI / 2, sideB = travel - Math.PI / 2;
      az = Math.sign(Math.sin(sideA)) === Math.sign(mid[0] || 1) ? sideA : sideB;
      if (o.flipSide) az = az === sideA ? sideB : sideA;
    }
    const dist = (port ? o.distTall ?? o.dist * 0.85 : o.dist);
    const height = (port ? o.heightTall ?? o.height * 0.8 : o.height);
    const fov = port ? o.fovTall ?? 58 : o.fov ?? 46;
    const drop = port ? o.dropTall ?? 1.1 : o.drop ?? 0.35;
    const shift = port ? 0 : o.shift ?? 0.9;
    const cams = focus.map((f) => {
      const p = keepInside([f[0] + Math.sin(az) * dist, (o.heightFromFloor ? getCourtFloorY(f[0] + Math.sin(az) * dist, f[2] + Math.cos(az) * dist) : f[1]) + height, f[2] + Math.cos(az) * dist]);
      return p;
    });
    const camS = gaussSmooth(cams, 10);
    const out = [];
    for (const t of ticks) {
      const i = t - t0;
      const f = focus[i], p = camS[i];
      const fwd = [f[0] - p[0], 0, f[2] - p[2]], n = Math.hypot(fwd[0], fwd[2]) || 1;
      const right = [-fwd[2] / n, 0, fwd[0] / n];
      out.push(pack(p, [f[0] - right[0] * shift, f[1] - drop + (o.lookUp ?? 0), f[2] - right[2] * shift], fov));
    }
    return out;
  };
}

/** Flank camera on a ring, on the side the ball comes toward, with a slow push-in. */
function rigRing(o) {
  return (src, ticks, aspect) => {
    const port = aspect === '9x16' || aspect === 'panelTall';
    const zR = o.goal === 'N' ? -40 : 40, toMid = -Math.sign(zR);
    const side = o.side;
    const a = port ? { p: [side * 13, 10.4, zR + toMid * 12.5], l: [0, 11.0, zR], f: 62 } : { p: [side * 16, 10.8, zR + toMid * 13], l: [0, 9.8, zR], f: 48 };
    const b = port ? { p: [side * 11.5, 10.2, zR + toMid * 11], l: [0, 11.0, zR], f: 62 } : { p: [side * 14, 10.5, zR + toMid * 11.5], l: [0, 9.9, zR], f: 46 };
    return ticks.map((t, k) => {
      const u = ease(k / Math.max(1, ticks.length - 1));
      return pack(a.p.map((v, i) => lerp(v, b.p[i], u)), a.l.map((v, i) => lerp(v, b.l[i], u)), lerp(a.f, b.f, u));
    });
  };
}

/** Keyframed camera path, eased between keys. keys: [{u, p, l, f}] per aspect. */
function rigPath(o) {
  return (src, ticks, aspect) => {
    const keys = (aspect === '9x16' || aspect === 'panelTall') ? o.tall : o.wide;
    return ticks.map((t, k) => {
      const u = k / Math.max(1, ticks.length - 1);
      let i = 0; while (i < keys.length - 2 && u > keys[i + 1].u) i++;
      const A = keys[i], B = keys[i + 1];
      const v = ease(clamp((u - A.u) / (B.u - A.u), 0, 1));
      return pack(A.p.map((x, j) => lerp(x, B.p[j], v)), A.l.map((x, j) => lerp(x, B.l[j], v)), lerp(A.f, B.f, v));
    });
  };
}

/** Low camera looking up at a jumping athlete. */
function rigSpike(o) {
  return (src, ticks, aspect) => {
    const port = aspect === '9x16' || aspect === 'panelTall';
    const s = source(src);
    // Placed from where the athlete stands at the spike, not mid-shot: after
    // the landing the bot takes the athlete back and runs off.
    const a0 = s.at(o.atTick).a[o.who];
    const yaw = o.aimYaw;
    const side = [Math.cos(yaw), -Math.sin(yaw)];
    const fwd = [Math.sin(yaw), Math.cos(yaw)];
    const d = port ? 4.0 : 4.6;
    // Square to the shot line on the side nearer the court's centre line, a little in front.
    const sgn = Math.abs(a0[0] - side[0] * d) < Math.abs(a0[0] + side[0] * d) ? -1 : 1;
    const px = a0[0] + side[0] * d * sgn + fwd[0] * 1.2, pz = a0[2] + side[1] * d * sgn + fwd[1] * 1.2;
    const p = keepInside([px, getCourtFloorY(px, pz) + (port ? 0.9 : 1.1), pz]);
    // Low and looking up at the athlete, so the jump climbs the frame.
    const look = gaussSmooth(ticks.map((t) => { const a = s.at(t).a[o.who]; return [a[0], a[1] + 1.3, a[2]]; }), 14);
    return look.map((l) => pack(p, [l[0], l[1] + (port ? 0.1 : 0.4), l[2]], port ? 58 : 46));
  };
}

// ═══ PICKERS ═══
function firstEvent(match, pred, after = 0) {
  return events({ match }).find((e) => e.t > after && pred(e));
}
function diveTouches(match) {
  const s = source({ match }), out = [];
  for (const d of events({ match }).filter((e) => e.k === 'dive')) {
    for (let t = d.t; t < d.t + 50 && t < s.last; t++) {
      const a = s.at(t), b = s.at(t + 1);
      const dv = Math.hypot(b.b[3] - a.b[3], b.b[4] - a.b[4], b.b[5] - a.b[5]);
      const ath = b.a[d.who];
      if (dv > 3 && Math.hypot(b.b[0] - ath[0], b.b[2] - ath[2]) < 2.5) {
        out.push({ ...d, touch: t, run: Math.hypot(s.at(d.t).a[d.who][3], s.at(d.t).a[d.who][4]), out: Math.hypot(b.b[3], b.b[4], b.b[5]) });
        break;
      }
    }
  }
  return out;
}
function goalOf(src) {
  const g = events(src).find((e) => e.k === 'goal' && (!src.aud || e.t > audition(src.aud).audition.launch.tick + 2));
  const s = source(src);
  const before = s.at(g.t - 6).b;
  return { t: g.t, goal: s.at(g.t).b[2] < 0 ? 'N' : 'S', side: -Math.sign(before[0]) || 1 };
}

// ═══ THE CUT ═══
// Segment: { id, bars: [from, to), card, shots: [{ id, bars?, src, key, keyAt, rig, panel? }] }
// A shot without `bars` fills the whole segment. `continuous: true` on a
// segment maps one source timeline across all of its shots (a match cut).
function buildSegments() {
  const goalCold = goalOf({ match: 'm_medium3' });
  const goalB01 = goalOf({ match: 'm_large2' });
  const goalB02 = goalOf({ match: 'm_medium5' });
  const goalB11 = goalOf({ match: 'm_medium' });
  const spikeGoal = { match: 'm_medium4', aud: 'pspike_m_medium4_7465_0_d17_h3.2_upo' };
  const spikeGoalAud = audition(spikeGoal.aud).audition;
  const lobGoal = { match: 'm_large', aud: 'spike_m_large_1640_1_1.35' };
  const goalsDrop = [
    { src: spikeGoal, g: goalOf(spikeGoal) },
    { src: { match: 'm_medium2' }, g: goalOf({ match: 'm_medium2' }) },
    { src: lobGoal, g: goalOf(lobGoal) },
    { src: { match: 'm_large' }, g: goalOf({ match: 'm_large' }) },
  ];
  const spikeSrc = { match: 'm_medium2', aud: 'pspike_m_medium2_8635_0_d17_h3.2_upi' };
  const spikeAud = audition(spikeSrc.aud).audition;
  const spikeTick = events(spikeSrc).find((e) => e.k === 'strike' && e.kind === 'spike').t;
  const braceSrc = { match: 'm_medium', aud: 'pbrace_m_medium_3425_1_h1.45_t0.6' };
  const braceAud = audition(braceSrc.aud).audition;
  const kickMed = firstEvent('m_medium', (e) => e.k === 'strike' && e.kind === 'kick' && e.q === 1, 5000);
  const volleyMed = firstEvent('m_medium3', (e) => e.k === 'strike' && e.kind === 'volley' && e.q === 1, 2000);
  const volleyPerfect = firstEvent('m_medium2', (e) => e.k === 'strike' && e.kind === 'volley' && e.q === 1, 1000);
  const volleyWeak = firstEvent('m_medium', (e) => e.k === 'strike' && e.kind === 'volley' && e.q < 0.5);
  const kickS = firstEvent('m_small', (e) => e.k === 'strike' && e.kind === 'kick' && e.q === 1, 1500);
  const kickM = firstEvent('m_medium', (e) => e.k === 'strike' && e.kind === 'kick' && e.q === 1, 7000);
  const kickL = firstEvent('m_large', (e) => e.k === 'strike' && e.kind === 'kick' && e.q === 1, 9000);
  const diveMed = diveTouches('m_medium').concat(diveTouches('m_medium2'), diveTouches('m_medium5'))
    .filter((d) => d.run > 7 && d.out > 5).sort((a, b) => b.run - a.run)[0];
  const diveMatch = ['m_medium', 'm_medium2', 'm_medium5'].find((m) => diveTouches(m).some((d) => d.t === diveMed.t && d.who === diveMed.who));
  const diveL = diveTouches('m_large').find((d) => d.t === 12283);
  const diveS = diveTouches('m_small2').filter((d) => d.run > 7).at(2);
  const slideFast = firstEvent('m_medium4', (e) => e.k === 'slide' && e.speed > 8, 3000);
  const knockCut = { match: 'm_large2', t: 4643, who: 0 };
  const tackleKnock = { match: 'm_small2', t: 1675, who: 1 };

  const W = (o) => rigFollow(o);
  return [
    { id: 'cold', bars: [1, 9], continuous: true, src: { match: 'm_medium3' }, key: goalCold.t, keyFrame: barFrame(6) + 30, shots: [
      { id: 'cold_crane', bars: [1, 4], rig: rigPath({
        wide: [{ u: 0, p: [20, 24, 26], l: [0, 6, -6], f: 50 }, { u: 1, p: [14, 15, -8], l: [0, 9, -36], f: 48 }],
        tall: [{ u: 0, p: [16, 26, 22], l: [0, 8, -8], f: 66 }, { u: 1, p: [11, 16, -10], l: [0, 10, -36], f: 62 }] }) },
      { id: 'cold_goal', bars: [4, 7], rig: rigRing({ goal: goalCold.goal, side: goalCold.side }) },
      { id: 'cold_title', bars: [7, 9], rig: rigPath({
        wide: [{ u: 0, p: [goalCold.side * 9, 12, -24], l: [0, 10.5, -40], f: 50 }, { u: 1, p: [goalCold.side * 4, 13.5, -22], l: [0, 11, -40], f: 52 }],
        tall: [{ u: 0, p: [goalCold.side * 8, 11.5, -26], l: [0, 11.5, -40], f: 64 }, { u: 1, p: [goalCold.side * 3.5, 12.5, -24], l: [0, 12, -40], f: 66 }] }) },
    ] },
    { id: 'b01', card: 'b01_object', bars: [9, 14], continuous: true, src: { match: 'm_large2' }, key: goalB01.t, keyFrame: barFrame(13), shots: [
      { id: 'b01_approach', bars: [9, 12], rig: W({ who: 'ball', dist: 13, height: 4.5, fov: 48, distTall: 11, heightTall: 3.5, view: 'side' }) },
      { id: 'b01_ring', bars: [12, 14], rig: rigRing({ goal: goalB01.goal, side: goalB01.side }) },
    ] },
    { id: 'b02', card: 'b02_flip', bars: [14, 19], continuous: true, src: { match: 'm_medium5' }, key: goalB02.t, keyFrame: barFrame(15) + 25, shots: [
      { id: 'b02_goal', bars: [14, 16], rig: rigRing({ goal: goalB02.goal, side: goalB02.side }) },
      { id: 'b02_flip', bars: [16, 19], rig: rigPath({
        wide: [{ u: 0, p: [9, 22, 56], l: [-2, 5, 16], f: 50 }, { u: 1, p: [8, 19, 50], l: [-2, 2, 0], f: 50 }],
        tall: [{ u: 0, p: [8, 22, 55], l: [-1, 6, 18], f: 64 }, { u: 1, p: [7, 19, 49], l: [-1, 3, 2], f: 64 }] }) },
    ] },
    { id: 'b03', card: 'b03_clock', bars: [19, 25], continuous: true, src: { match: 'm_medium4' }, key: 3600, keyFrame: barFrame(19), shots: [
      { id: 'b03_board', bars: [19, 22], rig: rigPath({
        wide: [{ u: 0, p: [0, 16, -26], l: [0, 25.5, -65], f: 24 }, { u: 1, p: [0, 16.5, -30], l: [0, 25.8, -65], f: 22 }],
        tall: [{ u: 0, p: [0, 18.5, -26], l: [0, 25.5, -65], f: 22 }, { u: 1, p: [0, 19, -30], l: [0, 25.8, -65], f: 20 }] }) },
      { id: 'b03_play', bars: [22, 25], rig: W({ who: 'ball', dist: 16, height: 7, fov: 50, distTall: 13, heightTall: 6, view: 'side' }) },
    ] },
    { id: 'b04', card: 'b04_valley', bars: [25, 31], src: { match: 'm_medium2' }, key: 6000, keyAt: 0.5, shots: [
      { id: 'b04_valley', rig: rigPath({
        wide: [{ u: 0, p: [22, 13, 40], l: [-4, 2, 6], f: 54 }, { u: 1, p: [22, 11, -34], l: [-4, 4, -8], f: 54 }],
        tall: [{ u: 0, p: [21, 15, 30], l: [0, 3, 2], f: 68 }, { u: 1, p: [21, 13, -30], l: [0, 5, -6], f: 68 }] }) },
    ] },
    { id: 'b05', card: 'b05_live', bars: [31, 37], src: { match: 'm_medium2' }, key: 4411, keyAt: 0.45, shots: [
      { id: 'b05_bank', rig: W({ who: 'ball', dist: 10, height: 2.6, fov: 50, distTall: 8, heightTall: 2.2, view: 'fixed', az: -Math.PI / 2 - 0.35, sigma: 18 }) },
    ] },
    { id: 'b06', card: 'b06_move', bars: [37, 43], src: { match: 'm_medium' }, key: 2814, keyAt: 0.5, shots: [
      { id: 'b06_run', rig: W({ who: 0, wBall: 0.2, dist: 6.5, height: 2.4, fov: 50, distTall: 5.5, heightTall: 1.8, view: 'behind', sigma: 16 }) },
    ] },
    { id: 'b07', card: 'b07_cut', bars: [43, 49], src: { match: 'm_medium' }, key: 3487, keyAt: 0.45, shots: [
      { id: 'b07_cut', rig: W({ who: 0, wBall: 0.25, dist: 7, height: 7.5, fov: 50, distTall: 6, heightTall: 6.5, view: 'side', drop: 0.6, sigma: 10 }) },
    ] },
    { id: 'b08', card: 'b08_strikes', bars: [49, 55], shots: [
      { id: 'b08_kick', bars: [49, 52], src: { match: 'm_medium' }, key: kickMed.t, keyAt: 0.45, rig: W({ who: kickMed.who, wBall: 0.45, dist: 5.2, height: 1.7, fov: 48, distTall: 4.6, heightTall: 1.4, view: 'side' }) },
      { id: 'b08_volley', bars: [52, 55], src: { match: 'm_medium3' }, key: volleyMed.t, keyAt: 0.45, rig: W({ who: volleyMed.who, wBall: 0.45, dist: 5.2, height: 1.8, fov: 48, distTall: 4.6, heightTall: 1.6, view: 'side' }) },
    ] },
    // Staged cards cut at the ball placement: a natural lead-in that ends the
    // tick before it, then the staged angle from 10 ticks after.
    { id: 'b09', card: 'b09_spike', bars: [55, 61], shots: [
      { id: 'b09_lead', bars: [55, 59], src: { match: spikeSrc.match }, key: spikeAud.launch.tick - 1, endTick: spikeAud.launch.tick - 1,
        rig: W({ who: spikeAud.who, wBall: 0, dist: 7, height: 2.4, fov: 48, distTall: 6, heightTall: 2, view: 'side' }) },
      { id: 'b09_spike', bars: [59, 61], src: spikeSrc, key: spikeTick, rig: rigSpike({ who: spikeAud.who, aimYaw: spikeAud.puppet.aimYaw, atTick: spikeTick }) },
    ] },
    { id: 'b10', card: 'b10_timing', bars: [61, 67], panel: 'split2', shots: [
      { id: 'b10_perfect', src: { match: 'm_medium2' }, key: volleyPerfect.t, keyAt: 0.45, rig: W({ who: volleyPerfect.who, wBall: 0.5, dist: 5.5, height: 2.0, fov: 50, view: 'side', shift: 0 }) },
      { id: 'b10_late', src: { match: 'm_medium' }, key: volleyWeak.t, keyAt: 0.45, rig: W({ who: volleyWeak.who, wBall: 0.5, dist: 5.5, height: 2.0, fov: 50, view: 'side', shift: 0 }) },
    ] },
    { id: 'b11', card: 'b11_aim', bars: [67, 73], continuous: true, src: { match: 'm_medium' }, key: goalB11.t, keyFrame: barFrame(71) + 40, shots: [
      { id: 'b11_strike', bars: [67, 70], rig: W({ who: 0, wBall: 0.4, dist: 7.5, height: 2.6, fov: 48, distTall: 6.5, heightTall: 2.2, view: 'behind' }) },
      { id: 'b11_ring', bars: [70, 73], rig: rigRing({ goal: goalB11.goal, side: goalB11.side }) },
    ] },
    { id: 'b12', card: 'b12_dive', bars: [73, 79], src: { match: diveMatch }, key: diveMed.t, keyAt: 0.45, shots: [
      { id: 'b12_dive', rig: W({ who: diveMed.who, wBall: 0.35, dist: 6, height: 0.9, heightFromFloor: true, fov: 50, distTall: 5, heightTall: 0.8, view: 'front', frontSkew: 0.9, drop: -0.2, dropTall: 0.4 }) },
    ] },
    { id: 'b13', card: 'b13_brace', bars: [79, 85], shots: [
      { id: 'b13_lead', bars: [79, 82], src: { match: braceSrc.match }, key: braceAud.launch.tick - 1, endTick: braceAud.launch.tick - 1,
        rig: W({ who: braceAud.who, wBall: 0, dist: 7, height: 2.2, fov: 48, distTall: 6, heightTall: 1.8, view: 'side' }) },
      { id: 'b13_brace', bars: [82, 85], src: braceSrc, key: braceAud.launch.tick + 37,
        rig: W({ who: braceAud.who, wBall: 0.15, dist: 4.4, height: 1.5, fov: 48, distTall: 3.8, heightTall: 1.3, view: 'fixed', az: braceAud.puppet.aimYaw + 0.6, sigma: 18 }) },
    ] },
    { id: 'b14', card: 'b14_contact', bars: [85, 91], src: { match: tackleKnock.match }, key: tackleKnock.t, keyAt: 0.3, shots: [
      { id: 'b14_tackle', rig: W({ who: tackleKnock.who, wBall: 0, dist: 6.5, height: 1.0, heightFromFloor: true, fov: 50, distTall: 5.5, heightTall: 0.9, view: 'side', drop: 0.1, dropTall: 0.6, sigma: 16 }) },
    ] },
    { id: 'b15', card: 'b15_balls', bars: [91, 98], panel: 'split3', shots: [
      { id: 'b15_small', src: { match: 'm_small' }, key: kickS.t, keyAt: 0.4, rig: W({ who: kickS.who, wBall: 0.5, dist: 5, height: 1.8, fov: 50, view: 'side', shift: 0 }) },
      { id: 'b15_medium', src: { match: 'm_medium' }, key: kickM.t, keyAt: 0.4, rig: W({ who: kickM.who, wBall: 0.5, dist: 5.4, height: 1.8, fov: 50, view: 'side', shift: 0 }) },
      { id: 'b15_large', src: { match: 'm_large' }, key: kickL.t, keyAt: 0.4, rig: W({ who: kickL.who, wBall: 0.5, dist: 6.4, height: 2, fov: 50, view: 'side', shift: 0 }) },
    ] },
    { id: 'rally', bars: [98, 105], shots: [
      { id: 'rally_dive', bars: [98, 99], src: { match: 'm_large' }, key: diveL.touch, keyAt: 0.45, rig: W({ who: diveL.who, wBall: 0.3, dist: 6, height: 1.1, heightFromFloor: true, fov: 50, view: 'side' }) },
      { id: 'rally_slide', bars: [99, 100], src: { match: 'm_medium4' }, key: slideFast.t, keyAt: 0.35, rig: W({ who: slideFast.who, wBall: 0.2, dist: 5.5, height: 0.9, heightFromFloor: true, fov: 52, view: 'side' }) },
      { id: 'rally_bank', bars: [100, 101], src: { match: 'm_medium5' }, key: 15053, keyAt: 0.5, rig: W({ who: 'ball', dist: 8, height: 2.4, fov: 52, view: 'fixed', az: -Math.PI / 2 - 0.3 }) },
      { id: 'rally_knock', bars: [101, 102], src: { match: knockCut.match }, key: knockCut.t, keyAt: 0.35, rig: W({ who: knockCut.who, wBall: 0, dist: 5.5, height: 1.2, heightFromFloor: true, fov: 52, view: 'side' }) },
      { id: 'rally_volley', bars: [102, 103], src: { match: 'm_large' }, key: 4280, keyAt: 0.45, rig: W({ who: 0, wBall: 0.45, dist: 7.5, height: 2.2, fov: 50, view: 'side' }) },
      { id: 'rally_dive2', bars: [103, 104], src: { match: 'm_small2' }, key: diveS.touch, keyAt: 0.45, rig: W({ who: diveS.who, wBall: 0.3, dist: 5.5, height: 1.0, heightFromFloor: true, fov: 52, view: 'front' }) },
      { id: 'rally_kick', bars: [104, 105], src: { match: 'm_large2' }, key: 9215, keyAt: 0.45, rig: W({ who: 0, wBall: 0.45, dist: 7.5, height: 2.0, fov: 50, view: 'side' }) },
    ] },
    { id: 'b16', card: 'b16_modes', bars: [105, 112], shots: [
      { id: 'b16_a', bars: [105, 107], src: { match: 'm_medium2' }, key: 7000, keyAt: 0.5, rig: W({ who: 'ball', dist: 10.5, height: 4.5, fov: 50, view: 'side' }) },
      { id: 'b16_b', bars: [107, 109], src: { match: 'm_medium3' }, key: 4500, keyAt: 0.5, rig: W({ who: 'ball', dist: 10.5, height: 4.5, fov: 50, view: 'side' }) },
      { id: 'b16_c', bars: [109, 112], src: { match: 'm_medium5' }, key: 8000, keyAt: 0.5, rig: W({ who: 'ball', dist: 10.5, height: 4.5, fov: 50, view: 'side' }) },
    ] },
    { id: 'recap', bars: [112, 115], recap: true },
    { id: 'b17', card: 'b17_combo', bars: [115, 123], shots: goalsDrop.map((g, i) => ({
      id: `b17_goal${i + 1}`, bars: [115 + 2 * i, 117 + 2 * i], src: g.src, key: g.g.t, keyAt: 0.55,
      // The spike goal plays from behind the spiker, down the shot line to the ring.
      rig: i === 0
        ? W({ who: spikeGoalAud.who, wBall: 0.25, dist: 7.5, height: 3.0, fov: 62, fovTall: 68, distTall: 6.5, heightTall: 2.6, lookUp: 4.4, drop: 1.6, dropTall: 1.0, view: 'fixed', az: spikeGoalAud.puppet.aimYaw + Math.PI, shift: 0 })
        : rigRing({ goal: g.g.goal, side: g.g.side }),
    })) },
    { id: 'outro', bars: [123, 126], outro: true },
  ];
}

// ═══ EXPAND TO RENDER JOBS ═══
function main() {
  const segments = buildSegments();
  const jobs = [];
  const timeline = { music: MUSIC, endFrame: END_FRAME, segments: [] };
  for (const seg of segments) {
    const segF0 = barFrame(seg.bars[0]), segF1 = seg.id === 'outro' ? END_FRAME : barFrame(seg.bars[1]);
    const tl = { id: seg.id, card: seg.card ?? null, frames: [segF0, segF1], panel: seg.panel ?? null, recap: !!seg.recap, outro: !!seg.outro, shots: [] };
    timeline.segments.push(tl);
    if (!seg.shots) continue;
    for (const sh of seg.shots) {
      const f0 = sh.bars ? barFrame(sh.bars[0]) : segF0, f1 = sh.bars ? barFrame(sh.bars[1]) : segF1;
      const n = f1 - f0;
      const src = sh.src ?? seg.src;
      let start;
      if (seg.continuous) start = seg.key - (seg.keyFrame - segF0) + (f0 - segF0);
      else if (sh.endTick !== undefined) start = sh.endTick - n + 1;
      else start = (sh.key ?? seg.key) - Math.round((sh.keyAt ?? seg.keyAt ?? 0.5) * n);
      const s = source(src);
      // Never show the ball placement: staged footage starts 10 ticks after it.
      if (s.stage) start = Math.max(start, s.stage.launch.tick + 10);
      if (start < 1 || start + n - 1 > s.last) throw new Error(`${sh.id}: ticks ${start}..${start + n - 1} outside source 1..${s.last}`);
      const ticks = Array.from({ length: n }, (_, k) => start + k);
      const keyTick = sh.key ?? seg.key;
      tl.shots.push({ id: sh.id, frames: [f0, f1], keyFrame: f0 + clamp(keyTick - start, 0, n - 1) });
      const panel = seg.panel ? PANELS[seg.panel] : null;
      for (const aspect of Object.keys(ASPECTS)) {
        const size = panel ? panel[aspect] : ASPECTS[aspect];
        const rigAspect = panel ? (size.h > size.w ? 'panelTall' : 'panelWide') : aspect;
        const cams = sh.rig(src, ticks, rigAspect);
        jobs.push({ id: `${sh.id}_${aspect}`, match: src.match, stageKey: src.aud ?? null, w: size.w, h: size.h, start, end: start + n - 1, cams, stage: s.stage });
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify({ shots: jobs }));
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 1));
  const frames = jobs.reduce((a, j) => a + (j.end - j.start + 1), 0);
  console.log(`[plan] ${jobs.length} render jobs, ${frames} frames total, ${timeline.segments.length} segments, end frame ${END_FRAME}`);
  for (const seg of timeline.segments) console.log(`  ${seg.id.padEnd(7)} frames ${seg.frames[0]}-${seg.frames[1]}  ${seg.shots.map((s) => s.id).join(', ')}`);
}

main();
