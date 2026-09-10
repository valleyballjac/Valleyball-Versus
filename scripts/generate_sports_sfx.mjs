import fs from 'fs';
import path from 'path';

const outDir = 'C:\\Users\\portt\\Dev\\Valleyball\\Valleyball-Demo\\public\\audio';
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const SAMPLE_RATE = 44100;

function encodeWav(samples) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (SAMPLE_RATE * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);

  // PCM samples with soft clipping
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i];
    if (s > 1.0) s = 1.0;
    else if (s < -1.0) s = -1.0;
    const intVal = s < 0 ? Math.floor(s * 32768) : Math.floor(s * 32767);
    buffer.writeInt16LE(intVal, 44 + i * 2);
  }

  return buffer;
}

// ---------------------------------------------------------------------------
// 1. FORMANT RESONATOR CLASS (Klatt 2nd-order bandpass filter)
// ---------------------------------------------------------------------------
class FormantResonator {
  constructor(freq, bw) {
    this.update(freq, bw);
    this.y1 = 0;
    this.y2 = 0;
  }
  update(freq, bw) {
    this.r = Math.exp((-Math.PI * bw) / SAMPLE_RATE);
    this.theta = (2 * Math.PI * freq) / SAMPLE_RATE;
    this.a1 = 2 * this.r * Math.cos(this.theta);
    this.a2 = -this.r * this.r;
    this.b0 = 1 - this.r;
  }
  process(x) {
    const y = this.b0 * x + this.a1 * this.y1 + this.a2 * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 2. RUBBER DODGEBALL IMPACTS (Small, Medium, Large Variations)
// Completely NON-TONAL physical rubber impacts: fast physical air compression pulse
// and shaped inharmonic noise burst. ZERO ringing sine tones or musical pitch.
// ---------------------------------------------------------------------------
function generateNonTonalRubberBall(ballType = 'med', variant = 1) {
  const durationSec = ballType === 'small' ? 0.08 : ballType === 'large' ? 0.12 : 0.095;
  const numSamples = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Float32Array(numSamples);

  let startF = 180, endF = 45, slapCutoff = 1800, decayRate = 0.016;
  if (ballType === 'small') {
    startF = 260; endF = 70; slapCutoff = 2600; decayRate = 0.013;
  } else if (ballType === 'large') {
    startF = 120; endF = 30; slapCutoff = 1200; decayRate = 0.024;
  }
  if (variant === 2) { startF *= 1.06; decayRate *= 0.95; }
  if (variant === 3) { startF *= 0.94; decayRate *= 1.05; }

  let filterY = 0;
  const alpha = Math.min(1.0, (2 * Math.PI * slapCutoff) / SAMPLE_RATE);

  let phase = 0;
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    // 1. Surface Rubber Slap (Noise transient, first 6ms)
    const whiteNoise = Math.random() * 2 - 1;
    filterY += alpha * (whiteNoise - filterY);
    const slapEnv = Math.exp(-t / 0.0035);
    const slap = filterY * slapEnv * 0.75;

    // 2. Physical Air Compression Pulse (steep exponential drop, no ringing sine)
    // Instantaneous frequency sweeps down extremely fast (>1000 Hz/s) so no pitch dwells
    const instantFreq = endF + (startF - endF) * Math.exp(-t / 0.009);
    phase += (2 * Math.PI * instantFreq) / SAMPLE_RATE;
    const thumpEnv = Math.exp(-t / decayRate);
    // Heavily soft-clipped impulse for acoustic density without harmonic tone
    const rawPulse = Math.sin(phase) + 0.3 * Math.sin(phase * 1.63);
    const pulse = Math.tanh(rawPulse * 1.5) * thumpEnv * 0.9;

    // 3. Sub-bass physical weight (single-cycle push)
    const subPush = Math.sin(Math.PI * Math.min(1.0, t / 0.018)) * Math.exp(-t / 0.025) * 0.6;

    samples[i] = slap + pulse + subPush;
  }

  return samples;
}

// Small Ball (0.4m): 2 variations + base alias
fs.writeFileSync(path.join(outDir, 'rubber_hit_small.wav'), encodeWav(generateNonTonalRubberBall('small', 1)));
fs.writeFileSync(path.join(outDir, 'rubber_hit_small_1.wav'), encodeWav(generateNonTonalRubberBall('small', 1)));
fs.writeFileSync(path.join(outDir, 'rubber_hit_small_2.wav'), encodeWav(generateNonTonalRubberBall('small', 2)));

// Medium Ball (1.0m): 3 variations + base alias
fs.writeFileSync(path.join(outDir, 'rubber_hit_med.wav'), encodeWav(generateNonTonalRubberBall('med', 1)));
fs.writeFileSync(path.join(outDir, 'rubber_hit_med_1.wav'), encodeWav(generateNonTonalRubberBall('med', 1)));
fs.writeFileSync(path.join(outDir, 'rubber_hit_med_2.wav'), encodeWav(generateNonTonalRubberBall('med', 2)));
fs.writeFileSync(path.join(outDir, 'rubber_hit_med_3.wav'), encodeWav(generateNonTonalRubberBall('med', 3)));

// Large Ball (1.5m): 2 variations + base alias
fs.writeFileSync(path.join(outDir, 'rubber_hit_large.wav'), encodeWav(generateNonTonalRubberBall('large', 1)));
fs.writeFileSync(path.join(outDir, 'rubber_hit_large_1.wav'), encodeWav(generateNonTonalRubberBall('large', 1)));
fs.writeFileSync(path.join(outDir, 'rubber_hit_large_2.wav'), encodeWav(generateNonTonalRubberBall('large', 2)));

console.log('[generate] Non-tonal rubber ball impact pools generated.');

// ---------------------------------------------------------------------------
// 3. BOUNDARY GLASS / BASKETBALL BACKBOARD IMPACTS
// Heavy acrylic backboard thud + high-frequency polycarbonate glass flex/rattle
// ---------------------------------------------------------------------------
function generateGlassBackboard(variant = 1) {
  const dur = variant === 2 ? 0.32 : 0.28;
  const numSamples = Math.floor(SAMPLE_RATE * dur);
  const samples = new Float32Array(numSamples);

  // Modes for acrylic/tempered glass panel:
  // Low thump + mid plate flex + high glass chatter
  const fLow = variant === 1 ? 190 : variant === 2 ? 165 : 210;
  const fHigh1 = variant === 1 ? 1420 : variant === 2 ? 1580 : 1350;
  const fHigh2 = variant === 1 ? 2340 : variant === 2 ? 2600 : 2200;
  const fHigh3 = variant === 1 ? 3850 : variant === 2 ? 4100 : 3600;

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    // 1. Initial Solid Rubber-on-Acrylic Smack
    let smack = 0;
    if (t < 0.015) {
      const sEnv = Math.exp(-t / 0.003);
      smack = (Math.random() * 2 - 1) * sEnv * 0.8;
    }

    // 2. Heavy Backboard Body Thud (dull bass punch)
    const thudEnv = Math.exp(-t / 0.05);
    const thud = Math.sin(2 * Math.PI * fLow * (1 + 0.3 * Math.exp(-t / 0.02)) * t) * thudEnv * 0.85;

    // 3. Polycarbonate Glass Panel Resonance & Vibration Flutter
    const glassEnv = Math.exp(-t / 0.08);
    const g1 = Math.sin(2 * Math.PI * fHigh1 * t) * 0.35;
    const g2 = Math.sin(2 * Math.PI * fHigh2 * t) * 0.25;
    const g3 = Math.sin(2 * Math.PI * fHigh3 * t) * 0.15;
    const glassChatter = (g1 + g2 + g3) * glassEnv;

    // 4. Subtle metal frame bracket ring
    const frameEnv = Math.exp(-t / 0.12);
    const frameRing = Math.sin(2 * Math.PI * 340 * t) * frameEnv * 0.2;

    samples[i] = smack * 0.7 + thud + glassChatter + frameRing;
  }

  return samples;
}

fs.writeFileSync(path.join(outDir, 'glass_hit_1.wav'), encodeWav(generateGlassBackboard(1)));
fs.writeFileSync(path.join(outDir, 'glass_hit_2.wav'), encodeWav(generateGlassBackboard(2)));
fs.writeFileSync(path.join(outDir, 'glass_hit_3.wav'), encodeWav(generateGlassBackboard(3)));
console.log('[generate] Glass backboard boundary impacts written.');

// ---------------------------------------------------------------------------
// 4. STEEL HOOP CLANKS (Exclusive to Goal Hoop Collisions)
// Deep resonant basketball rim tone (160-200 Hz), massive hoop scale, long gong-like decay
// ---------------------------------------------------------------------------
function generateHoopClankVariant(variant = 1) {
  const dur = variant === 2 ? 3.5 : 3.0;
  const numSamples = Math.floor(SAMPLE_RATE * dur);
  const samples = new Float32Array(numSamples);

  let f0 = 175;
  let decayBase = 1.15;
  let bracketRattleFreq = 95;

  if (variant === 1) {
    // Solid centered rim clank ("KLONK - DOOONG")
    f0 = 178;
    decayBase = 1.10;
    bracketRattleFreq = 92;
  } else if (variant === 2) {
    // Heavy back-iron / mount strike (deeper, weightier "DOOONNGG")
    f0 = 158;
    decayBase = 1.30;
    bracketRattleFreq = 86;
  } else {
    // Sharp rim lip strike (punchier "CLANG-TONK")
    f0 = 196;
    decayBase = 0.95;
    bracketRattleFreq = 104;
  }

  const modes = [
    // Deep solid steel rim fundamental (lingers and slowly fades like a gong)
    { f: f0, amp: 1.0, decay: decayBase },
    // Low-mid cylindrical ovalization mode
    { f: f0 * 2.05, amp: 0.65, decay: decayBase * 0.75 },
    // Hollow body flexural mode
    { f: f0 * 3.42, amp: 0.45, decay: decayBase * 0.55 },
    // Inharmonic steel ring mode
    { f: f0 * 5.18, amp: 0.32, decay: decayBase * 0.35 },
    // High metallic edge ping (tight, dies quickly so not shrill)
    { f: f0 * 7.65, amp: 0.22, decay: 0.065 },
  ];

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    // 1. Solid Mechanical Metal Impact Strike (heavy mechanical contact)
    let impactSnap = 0;
    if (t < 0.015) {
      const snapEnv = Math.exp(-t / 0.0028);
      impactSnap = (Math.random() * 2 - 1) * snapEnv * 0.85;
    }

    // 2. Low-frequency rim & bracket shudder (heavy mass of large hoop)
    const bracketShudder = Math.sin(2 * Math.PI * bracketRattleFreq * t) * Math.exp(-t / 0.22) * 0.45;

    // 3. Deep resonant steel ring with slow gong-like exponential fade
    let rimRing = 0;
    for (const m of modes) {
      const modeFreq = m.f * (1.0 + 0.015 * Math.exp(-t / 0.04));
      rimRing += Math.sin(2 * Math.PI * modeFreq * t) * Math.exp(-t / m.decay) * m.amp;
    }

    samples[i] = impactSnap * 0.75 + bracketShudder + rimRing * 0.8;
  }

  return samples;
}

fs.writeFileSync(path.join(outDir, 'hoop_metal_clank.wav'), encodeWav(generateHoopClankVariant(1)));
fs.writeFileSync(path.join(outDir, 'hoop_clank_1.wav'), encodeWav(generateHoopClankVariant(1)));
fs.writeFileSync(path.join(outDir, 'hoop_clank_2.wav'), encodeWav(generateHoopClankVariant(2)));
fs.writeFileSync(path.join(outDir, 'hoop_clank_3.wav'), encodeWav(generateHoopClankVariant(3)));
console.log('[generate] Lingering deep steel hoop gong clank variations written.');

// ---------------------------------------------------------------------------
// 5. INCIDENTAL PLAYER BODY THUDS (Ball bumps body/limb outside strike)
// Soft, cushioned flesh/torso impact with muted cloth damping (distinctly softer than floor)
// ---------------------------------------------------------------------------
function generateBodyThud(variant = 1) {
  const dur = 0.12;
  const numSamples = Math.floor(SAMPLE_RATE * dur);
  const samples = new Float32Array(numSamples);

  const f0 = variant === 1 ? 85 : variant === 2 ? 72 : 98;

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    // Soft, cushioned cloth/torso impact (fast decay, soft compression)
    const env = Math.exp(-t / 0.024);

    // Deep padded flesh/torso thump (low-frequency compression pulse, 70-100Hz)
    const thump = Math.sin(2 * Math.PI * f0 * (1.0 - t * 3.0) * t) * env * 0.85;

    // Soft fabric/clothing friction rustle (heavily muffled, zero hard slap)
    const rustleEnv = Math.exp(-t / 0.018);
    const rustle = (Math.random() * 2 - 1) * rustleEnv * 0.25;

    samples[i] = (thump + rustle) * 0.75;
  }

  return samples;
}

fs.writeFileSync(path.join(outDir, 'body_thud_1.wav'), encodeWav(generateBodyThud(1)));
fs.writeFileSync(path.join(outDir, 'body_thud_2.wav'), encodeWav(generateBodyThud(2)));
fs.writeFileSync(path.join(outDir, 'body_thud_3.wav'), encodeWav(generateBodyThud(3)));
console.log('[generate] Cushioned player body thud samples written.');

// ---------------------------------------------------------------------------
// 6. RAW BASKETBALL ARENA BUZZER (Direct, Authentic Electro-Mechanical Horn)
// 120Hz square/pulse horn with rich odd harmonics, extended 2.4s celebration duration
// ---------------------------------------------------------------------------
function generateBasketballArenaBuzzer() {
  const dur = 2.4;
  const numSamples = Math.floor(SAMPLE_RATE * dur);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    // Clean gate: 12ms ramp-in, hold full volume for 1.85s, then 0.5s natural stadium acoustic decay
    let env = 1.0;
    if (t < 0.012) {
      env = t / 0.012;
    } else if (t > 1.85) {
      const releaseT = t - 1.85;
      env = Math.exp(-releaseT / 0.18);
    }

    // 120 Hz mains frequency electro-mechanical horn
    const phase120 = (t * 120) % 1;
    const pulse120 = phase120 < 0.42 ? 1.0 : -1.0;

    // Harmonic stack (360Hz, 600Hz, 840Hz, 1080Hz, 1320Hz)
    const h3 = Math.sin(2 * Math.PI * 360 * t) * 0.45;
    const h5 = Math.sin(2 * Math.PI * 600 * t) * 0.32;
    const h7 = Math.sin(2 * Math.PI * 840 * t) * 0.22;
    const h9 = Math.sin(2 * Math.PI * 1080 * t) * 0.16;

    // Diaphragm metallic rasp
    const rasp = (Math.random() * 2 - 1) * 0.08;

    samples[i] = (pulse120 * 0.5 + h3 + h5 + h7 + h9 + rasp) * env * 0.85;
  }

  return samples;
}

fs.writeFileSync(path.join(outDir, 'arena_buzzer.wav'), encodeWav(generateBasketballArenaBuzzer()));
console.log('[generate] Extended basketball arena buzzer written.');

// ---------------------------------------------------------------------------
// 6b. BALL ROLLING AUDIO (Marble-on-a-track resonant rubber rolling loop)
// ---------------------------------------------------------------------------
function generateMarbleRubberRollLoop(ballType = 'small') {
  const dur = 2.0; // 2 seconds seamless loop
  const numSamples = Math.floor(SAMPLE_RATE * dur);
  const samples = new Float32Array(numSamples);

  // Resonant spherical acoustic modes (marble on a track with rubber dampening)
  const isSmall = ballType === 'small';
  const f0 = isSmall ? 385 : 210; // fundamental body hum
  const f1 = isSmall ? 615 : 340; // inharmonic second mode
  const f2 = isSmall ? 980 : 560; // track-guide acoustic chime
  const rotFreq = isSmall ? 4.5 : 2.5;

  let filterLow = 0;
  let filterMid = 0;

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    // 1. Tactile Surface Grain Noise (smooth court/track friction)
    const white = Math.random() * 2 - 1;
    // Low-passed bed (rubber contact mass)
    filterLow = 0.94 * filterLow + 0.06 * white;
    // Bandpass track shimmer (fine marble hiss)
    filterMid = 0.82 * filterMid + 0.18 * (white - filterLow);

    // 2. Cyclic rotation modulation (seam / rolling rotation)
    const rotMod = 1.0 + 0.18 * Math.sin(2 * Math.PI * rotFreq * t) + 0.08 * Math.cos(2 * Math.PI * rotFreq * 2 * t);

    // 3. Resonant Body Singing Whir (the distinctive "marble on track" harmonic tones)
    const tone0 = Math.sin(2 * Math.PI * f0 * t + 0.15 * Math.sin(2 * Math.PI * rotFreq * t));
    const tone1 = Math.sin(2 * Math.PI * f1 * t);
    const tone2 = Math.sin(2 * Math.PI * f2 * t);

    const bodyResonance = (tone0 * 0.45 + tone1 * 0.35 + tone2 * 0.20) * rotMod;

    // 4. Combined Marble / Rubber Tone
    const raw = (filterLow * 0.45 + filterMid * 0.35 + bodyResonance * 0.42) * 0.75;
    samples[i] = raw;
  }

  // Seamless boundary crossfade (0.05s) to guarantee zero click at loop point
  const fadeLen = Math.floor(SAMPLE_RATE * 0.05);
  for (let i = 0; i < fadeLen; i++) {
    const frac = i / fadeLen;
    samples[i] = samples[i] * frac + samples[numSamples - fadeLen + i] * (1 - frac);
  }

  return samples;
}

fs.writeFileSync(path.join(outDir, 'rubber_roll_small.wav'), encodeWav(generateMarbleRubberRollLoop('small')));
fs.writeFileSync(path.join(outDir, 'rubber_roll_loop.wav'), encodeWav(generateMarbleRubberRollLoop('med')));
console.log('[generate] Rubber ball marble-track rolling audio loops written (small & med).');

// ---------------------------------------------------------------------------
// 7. PLAYER VOCAL EFFORT: TENNIS GRUNTS & KARATE KIAIS
// Human vocal formant synthesis (Klatt filter + asymmetric glottal pulse train)
// ---------------------------------------------------------------------------
function generateHumanGrunt(type, variant = 1) {
  let dur = 0.18;
  let startF0 = 160;
  let endF0 = 120;
  let formants = [
    { f: 600, bw: 90 },
    { f: 1150, bw: 110 },
    { f: 2400, bw: 150 },
  ];
  let breathiness = 0.25;

  if (type === 'volley') {
    // Tennis Volley: Sharp, focused breath/grunt of effort
    if (variant === 1) {
      // "Huh!"
      dur = 0.17;
      startF0 = 165;
      endF0 = 130;
      formants = [{ f: 620, bw: 90 }, { f: 1120, bw: 110 }, { f: 2450, bw: 160 }];
      breathiness = 0.28;
    } else if (variant === 2) {
      // "Ah!"
      dur = 0.19;
      startF0 = 175;
      endF0 = 138;
      formants = [{ f: 740, bw: 100 }, { f: 1260, bw: 120 }, { f: 2550, bw: 170 }];
      breathiness = 0.22;
    } else {
      // "Tup / Eugh!"
      dur = 0.15;
      startF0 = 155;
      endF0 = 122;
      formants = [{ f: 520, bw: 85 }, { f: 1300, bw: 110 }, { f: 2300, bw: 150 }];
      breathiness = 0.32;
    }
  } else if (type === 'spike') {
    // Tennis Spike: Powerful explosive smash grunt ("HRAAH!", "EUGH!")
    if (variant === 1) {
      dur = 0.28;
      startF0 = 195;
      endF0 = 145;
      formants = [{ f: 820, bw: 110 }, { f: 1380, bw: 130 }, { f: 2650, bw: 180 }];
      breathiness = 0.35;
    } else if (variant === 2) {
      dur = 0.26;
      startF0 = 210;
      endF0 = 155;
      formants = [{ f: 880, bw: 120 }, { f: 1450, bw: 140 }, { f: 2750, bw: 190 }];
      breathiness = 0.40;
    } else {
      dur = 0.30;
      startF0 = 180;
      endF0 = 135;
      formants = [{ f: 700, bw: 100 }, { f: 1220, bw: 120 }, { f: 2450, bw: 160 }];
      breathiness = 0.30;
    }
  } else if (type === 'kick') {
    // Karate Kick Kiai: High-energy martial arts shout ("KIAI!", "HYAH!", "HA!")
    if (variant === 1) {
      // "KIAI!"
      dur = 0.23;
      startF0 = 230;
      endF0 = 270; // Rising inflection
      formants = [{ f: 450, bw: 90 }, { f: 1950, bw: 140 }, { f: 2900, bw: 180 }];
      breathiness = 0.20;
    } else if (variant === 2) {
      // "HYAH!"
      dur = 0.21;
      startF0 = 250;
      endF0 = 195;
      formants = [{ f: 780, bw: 100 }, { f: 1550, bw: 130 }, { f: 2750, bw: 170 }];
      breathiness = 0.30;
    } else {
      // "HA!"
      dur = 0.18;
      startF0 = 240;
      endF0 = 180;
      formants = [{ f: 820, bw: 110 }, { f: 1350, bw: 120 }, { f: 2600, bw: 160 }];
      breathiness = 0.24;
    }
  }

  const numSamples = Math.floor(SAMPLE_RATE * dur);
  const samples = new Float32Array(numSamples);

  const r1 = new FormantResonator(formants[0].f, formants[0].bw);
  const r2 = new FormantResonator(formants[1].f, formants[1].bw);
  const r3 = new FormantResonator(formants[2].f, formants[2].bw);

  let phase = 0;

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const prog = t / dur;

    // Pitch contour f0(t)
    const f0 = startF0 + (endF0 - startF0) * prog;
    phase += (2 * Math.PI * f0) / SAMPLE_RATE;

    // Glottal pulse excitation: asymmetric Rosenberg pulse
    const glottalCycle = (phase / (2 * Math.PI)) % 1;
    let glottal = 0;
    if (glottalCycle < 0.6) {
      glottal = Math.sin((Math.PI * glottalCycle) / 0.6);
    } else if (glottalCycle < 0.85) {
      glottal = Math.cos(((glottalCycle - 0.6) / 0.25) * (Math.PI / 2));
    } else {
      glottal = 0;
    }

    // Aspiration breath noise
    const breath = (Math.random() * 2 - 1) * breathiness;
    const excitation = glottal * (1.0 - breathiness) + breath;

    // Vocal tract filtering
    const f1Out = r1.process(excitation);
    const f2Out = r2.process(excitation);
    const f3Out = r3.process(excitation);

    // Natural attack and decay envelope
    let env = 1.0;
    if (prog < 0.15) env = prog / 0.15;
    else env = Math.exp(-(prog - 0.15) * 3.5);

    samples[i] = (f1Out * 0.55 + f2Out * 0.35 + f3Out * 0.18) * env * 0.85;
  }

  return samples;
}

// Write human grunts
fs.writeFileSync(path.join(outDir, 'grunt_volley_1.wav'), encodeWav(generateHumanGrunt('volley', 1)));
fs.writeFileSync(path.join(outDir, 'grunt_volley_2.wav'), encodeWav(generateHumanGrunt('volley', 2)));
fs.writeFileSync(path.join(outDir, 'grunt_volley_3.wav'), encodeWav(generateHumanGrunt('volley', 3)));

fs.writeFileSync(path.join(outDir, 'grunt_spike_1.wav'), encodeWav(generateHumanGrunt('spike', 1)));
fs.writeFileSync(path.join(outDir, 'grunt_spike_2.wav'), encodeWav(generateHumanGrunt('spike', 2)));
fs.writeFileSync(path.join(outDir, 'grunt_spike_3.wav'), encodeWav(generateHumanGrunt('spike', 3)));

fs.writeFileSync(path.join(outDir, 'grunt_kick_1.wav'), encodeWav(generateHumanGrunt('kick', 1)));
fs.writeFileSync(path.join(outDir, 'grunt_kick_2.wav'), encodeWav(generateHumanGrunt('kick', 2)));
fs.writeFileSync(path.join(outDir, 'grunt_kick_3.wav'), encodeWav(generateHumanGrunt('kick', 3)));

console.log('[generate] Tennis & Karate human effort vocal grunts written.');

// ---------------------------------------------------------------------------
// 8. SNEAKER SQUEAKS & FOOTSTEPS (Existing + Variation 3)
// ---------------------------------------------------------------------------
function generateSneakerSqueak(durationSec, fStart, fEnd, stutterRate) {
  const numSamples = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Float32Array(numSamples);

  let phase = 0;
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const prog = t / durationSec;
    const flutter = Math.sin(2 * Math.PI * stutterRate * t) * 180;
    const freq = fStart + (fEnd - fStart) * Math.pow(prog, 0.7) + flutter;
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;

    const env = Math.sin(Math.PI * Math.pow(prog, 0.6)) * Math.exp(-prog * 1.5);
    const grit = (Math.random() * 2 - 1) * 0.12;
    const wave = Math.sin(phase) + 0.3 * Math.sin(2 * phase);
    samples[i] = (wave + grit) * env * 0.8;
  }
  return samples;
}

fs.writeFileSync(path.join(outDir, 'sneaker_squeak_1.wav'), encodeWav(generateSneakerSqueak(0.085, 2100, 2900, 75)));
fs.writeFileSync(path.join(outDir, 'sneaker_squeak_2.wav'), encodeWav(generateSneakerSqueak(0.12, 2600, 1950, 90)));
fs.writeFileSync(path.join(outDir, 'sneaker_squeak_3.wav'), encodeWav(generateSneakerSqueak(0.095, 2350, 3100, 82)));
fs.writeFileSync(path.join(outDir, 'sneaker_skid.wav'), encodeWav(generateSneakerSqueak(0.24, 1850, 3100, 50)));

function generateFootstep(variant = 1) {
  const dur = 0.09;
  const numSamples = Math.floor(SAMPLE_RATE * dur);
  const samples = new Float32Array(numSamples);

  const fStart = variant === 1 ? 160 : variant === 2 ? 140 : 175;
  let phase = 0;
  for (let i = 0; i < numSamples; i++) {
    const t = i / dur;
    const tapEnv = Math.exp(-t * 8.5);
    phase += (2 * Math.PI * (fStart * (1 - t * 0.6))) / SAMPLE_RATE;
    const tone = Math.sin(phase) * 0.7;
    const scuff = (Math.random() * 2 - 1) * Math.exp(-t * 12) * 0.35;
    samples[i] = (tone + scuff) * tapEnv * 0.6;
  }
  return samples;
}

fs.writeFileSync(path.join(outDir, 'footstep_1.wav'), encodeWav(generateFootstep(1)));
fs.writeFileSync(path.join(outDir, 'footstep_2.wav'), encodeWav(generateFootstep(2)));
fs.writeFileSync(path.join(outDir, 'footstep_3.wav'), encodeWav(generateFootstep(3)));

// Net Swish
function generateHoopSwish() {
  const dur = 0.25;
  const numSamples = Math.floor(SAMPLE_RATE * dur);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const prog = t / dur;
    const env = Math.sin(Math.PI * prog) * 0.7;
    const noise = Math.random() * 2 - 1;
    const swishTone = Math.sin(2 * Math.PI * (1600 + 400 * Math.sin(prog * Math.PI)) * t);
    samples[i] = (noise * 0.7 + swishTone * 0.3) * env;
  }
  return samples;
}
fs.writeFileSync(path.join(outDir, 'hoop_swish.wav'), encodeWav(generateHoopSwish()));

console.log('All sports audio samples generated successfully in ' + outDir);
