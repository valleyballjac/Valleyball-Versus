/**
 * Offline game-SFX stem for the frame-stepped debut trailer.
 *
 * The trailer replays recorded poses, so the game's own sound dispatch never
 * runs during capture. capture-trailer-video.mjs instead exports the harvested
 * events shown on each trailer frame (strikes, floor bounces, glass caroms,
 * goals), and this module places the game's WAV samples at those frames with
 * the same pools, gain curves and pitch rules as src/audio/soundManager.js.
 *
 * Output: 48 kHz stereo 16-bit WAV, centred (no spatial panning).
 */

import fs from 'node:fs';
import path from 'node:path';

const OUT_RATE = 48000;

// Bus levels in soundManager: gameplay sounds on sfxGain, the goal buzzer on uiGain.
const SFX_BUS = 1.0;
const UI_BUS = 1.0;

function readWavMono(file) {
  const buf = fs.readFileSync(file);
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(offset + 10),
        rate: buf.readUInt32LE(offset + 12),
        bits: buf.readUInt16LE(offset + 22),
      };
    } else if (id === 'data') {
      data = buf.subarray(offset + 8, offset + 8 + size);
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error(`unsupported WAV: ${file}`);
  const frames = data.length / 2 / fmt.channels;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) s += data.readInt16LE((i * fmt.channels + c) * 2);
    out[i] = s / fmt.channels / 32768;
  }
  return { rate: fmt.rate, samples: out };
}

// Deterministic stand-in for soundManager's Math.random pool picks and detune.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSfxStem(events, { audioDir, outPath, durationSec, gainDb = 0, seed = 20261031 }) {
  const total = Math.ceil(durationSec * OUT_RATE);
  const mix = new Float32Array(total);
  const cache = new Map();
  const sample = (key) => {
    if (!cache.has(key)) cache.set(key, readWavMono(path.join(audioDir, `${key}.wav`)));
    return cache.get(key);
  };
  const rng = makeRng(seed);
  const lastInPool = new Map();

  const place = (key, atSec, gain, rate = 1.0) => {
    const { rate: srcRate, samples } = sample(key);
    const step = (srcRate / OUT_RATE) * Math.max(0.2, Math.min(3.0, rate));
    const start = Math.round(atSec * OUT_RATE);
    for (let n = 0; start + n < total; n++) {
      const p = n * step;
      const i = Math.floor(p);
      if (i + 1 >= samples.length) break;
      const v = samples[i] + (samples[i + 1] - samples[i]) * (p - i);
      mix[start + n] += v * gain;
    }
  };

  // soundManager.playSampleFromPool: random pick, no immediate repeat, ±8% detune.
  const placeFromPool = (poolName, keys, atSec, gain, baseRate = 1.0) => {
    let pick = keys[Math.floor(rng() * keys.length)];
    if (keys.length > 1 && pick === lastInPool.get(poolName)) {
      const rest = keys.filter((k) => k !== pick);
      pick = rest[Math.floor(rng() * rest.length)];
    }
    lastInPool.set(poolName, pick);
    place(pick, atSec, gain, baseRate * (0.92 + rng() * 0.16));
  };

  // soundManager.playSweetSpotPop: sine sub-thud under clean strikes and spikes.
  const placePop = (atSec, isSpike) => {
    const f0 = isSpike ? 95 : 85;
    const f1 = isSpike ? 34 : 35;
    const dur = isSpike ? 0.12 : 0.09;
    const peak = isSpike ? 0.50 : 0.35;
    const start = Math.round(atSec * OUT_RATE);
    const len = Math.round(dur * OUT_RATE);
    let phase = 0;
    for (let n = 0; n < len && start + n < total; n++) {
      const u = n / len;
      const freq = f0 * Math.pow(f1 / f0, u);
      phase += (2 * Math.PI * freq) / OUT_RATE;
      mix[start + n] += Math.sin(phase) * peak * Math.pow(0.001 / peak, u) * SFX_BUS;
    }
  };

  const rubberPool = (radius) => {
    if (radius <= 0.3) return ['rubber_small', ['rubber_hit_small_1', 'rubber_hit_small_2']];
    if (radius >= 0.65) return ['rubber_large', ['rubber_hit_large_1', 'rubber_hit_large_2']];
    return ['rubber_med', ['rubber_hit_med_1', 'rubber_hit_med_2', 'rubber_hit_med_3']];
  };

  const counts = {};
  for (const ev of events) {
    const at = ev.frame / 60;
    counts[ev.type] = (counts[ev.type] || 0) + 1;
    if (ev.type === 'strike') {
      // playStrike: rubber smack + effort grunt
      const kind = ev.kind === 2 ? 'spike' : ev.kind === 3 ? 'kick' : 'volley';
      const [poolName, pool] = rubberPool(ev.radius);
      const volume = Math.min(1.0, Math.max(0.4, ev.speed / 16.0));
      const rate = kind === 'spike' ? 1.1 : kind === 'kick' ? 0.92 : 1.0;
      placeFromPool(poolName, pool, at, volume * SFX_BUS, rate);
      const grunts = [1, 2, 3].map((i) => `grunt_${kind}_${i}`);
      placeFromPool(`grunt_${kind}`, grunts, at, Math.min(1.0, 0.75 + 0.25 * 0.6) * SFX_BUS);
      if (kind === 'spike' || ev.airborne) placePop(at, kind === 'spike');
    } else if (ev.type === 'bounce') {
      // playBallBounce
      if (ev.speed < 0.35) continue;
      const norm = Math.max(0, (ev.speed - 0.35) / 10.0);
      const volume = Math.min(1.0, Math.pow(norm, 1.35) * 0.95 + 0.035);
      const [poolName, pool] = rubberPool(ev.radius);
      placeFromPool(poolName, pool, at, volume * 0.85 * SFX_BUS, ev.speed < 1.2 ? 0.90 : 1.0);
    } else if (ev.type === 'glass') {
      // playGlassImpact
      const volume = Math.min(1.0, Math.max(0.18, Math.pow(ev.speed / 10.0, 0.75)));
      placeFromPool('glass', ['glass_hit_1', 'glass_hit_2', 'glass_hit_3'], at, volume * SFX_BUS);
    } else if (ev.type === 'goal') {
      // playHoopCrossing + playGoal (buzzer on the UI bus)
      place('hoop_swish', at, 0.85 * SFX_BUS);
      place('arena_buzzer', at, 0.9 * UI_BUS);
    }
  }

  // 16-bit stereo WAV, same signal on both channels. The trim gain goes on
  // before the soft clip, so the clip only touches overlaps that still exceed
  // full scale rather than flattening every loud hit.
  const trim = Math.pow(10, gainDb / 20);
  const data = Buffer.alloc(total * 4);
  for (let n = 0; n < total; n++) {
    const v = Math.tanh(mix[n] * trim);
    const s = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    data.writeInt16LE(s, n * 4);
    data.writeInt16LE(s, n * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(OUT_RATE, 24);
  header.writeUInt32LE(OUT_RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(outPath, Buffer.concat([header, data]));
  return counts;
}
