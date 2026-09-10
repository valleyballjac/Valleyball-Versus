import { TUNING, assetUrl } from '../config/tuning.js';

/**
 * VALLEYBALL SOUND ENGINE (HYBRID ARCHITECTURE)
 *
 * Combines authentic, curated sports audio samples (.wav) with dynamic
 * Web Audio procedural synthesis and 3D spatial panning.
 *
 * Core Sound Features:
 * - Real rubber dodgeball / playground ball acoustic impacts (small, med, large).
 * - Basketball sneaker squeaks on cuts, sprint launches, slides, and landings.
 * - Basketball arena electric buzzer + heavy steel hoop clank + net swish.
 * - Rhythmic court footsteps during locomotion.
 * - Seamless procedural fallbacks for all sounds if samples are loading.
 * - Anti-sputter velocity gating: eliminates resting contact buzzing.
 *
 * LAW 1 & 6 COMPLIANCE:
 * Audio is STRICTLY consumer-only / render-side. It reads state, forces,
 * and positions; it NEVER writes to physics, never alters transforms, and never
 * affects simulation determinism.
 */

class SoundManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.ambienceGain = null;
    this.uiGain = null;
    this.unlocked = false;
    this.camera = null;

    // Sample buffer cache
    this.buffers = new Map();
    this.samplesLoading = false;
    this.samplesLoaded = false;

    // Ambient loop nodes
    this.windNode = null;
    this.riverNode = null;
    this.ambienceStarted = false;

    // Footstep toggle
    this.footstepIdx = 0;
    this.lastBounceTime = 0;
    this.lastSqueakTime = 0;
    this.lastGlassTime = 0;
    this.lastHoopClankTime = 0;
    this.lastBodyThudTime = 0;
    this.lastPlayedInPool = new Map();
  }

  /**
   * Initializes the AudioContext and gain bus hierarchy.
   */
  init(camera = null) {
    if (this.ctx) return;
    this.camera = camera;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      console.warn('[audio] Web Audio API not supported in this browser.');
      return;
    }

    this.ctx = new AudioCtx();

    // Master Bus
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(
      TUNING.audio.enabled ? TUNING.audio.masterVolume : 0,
      this.ctx.currentTime,
    );
    this.masterGain.connect(this.ctx.destination);

    // SFX Bus
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.setValueAtTime(TUNING.audio.sfxVolume, this.ctx.currentTime);
    this.sfxGain.connect(this.masterGain);

    // UI & Arena Buzzer Bus
    this.uiGain = this.ctx.createGain();
    this.uiGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
    this.uiGain.connect(this.masterGain);

    // Ambience Bus
    this.ambienceGain = this.ctx.createGain();
    this.ambienceGain.gain.setValueAtTime(TUNING.audio.ambienceVolume, this.ctx.currentTime);
    this.ambienceGain.connect(this.masterGain);

    this.setupUnlockListeners();
    this.preloadSamples();
    console.log('[audio] Hybrid SoundManager initialized.');
  }

  setCamera(camera) {
    this.camera = camera;
  }

  setupUnlockListeners() {
    const unlock = () => {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          this.unlocked = true;
          console.log('[audio] Web Audio context resumed and unlocked.');
          if (!this.ambienceStarted && TUNING.audio.ambienceVolume > 0) {
            this.startAmbience();
          }
        });
      } else if (this.ctx && this.ctx.state === 'running') {
        this.unlocked = true;
        if (!this.ambienceStarted && TUNING.audio.ambienceVolume > 0) {
          this.startAmbience();
        }
      }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };

    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
  }

  /**
   * Preload and decode authentic sports audio samples (.wav) into memory.
   */
  async preloadSamples() {
    if (this.samplesLoading || this.samplesLoaded) return;
    this.samplesLoading = true;

    const samples = [
      // Rubber ball pools
      ['rubber_small', 'audio/rubber_hit_small.wav'],
      ['rubber_small_1', 'audio/rubber_hit_small_1.wav'],
      ['rubber_small_2', 'audio/rubber_hit_small_2.wav'],
      ['rubber_med', 'audio/rubber_hit_med.wav'],
      ['rubber_med_1', 'audio/rubber_hit_med_1.wav'],
      ['rubber_med_2', 'audio/rubber_hit_med_2.wav'],
      ['rubber_med_3', 'audio/rubber_hit_med_3.wav'],
      ['rubber_large', 'audio/rubber_hit_large.wav'],
      ['rubber_large_1', 'audio/rubber_hit_large_1.wav'],
      ['rubber_large_2', 'audio/rubber_hit_large_2.wav'],
      // Glass backboard boundary hits
      ['glass_1', 'audio/glass_hit_1.wav'],
      ['glass_2', 'audio/glass_hit_2.wav'],
      ['glass_3', 'audio/glass_hit_3.wav'],
      // Steel hoop clanks (goal collision only)
      ['hoop_clank_1', 'audio/hoop_clank_1.wav'],
      ['hoop_clank_2', 'audio/hoop_clank_2.wav'],
      ['hoop_clank_3', 'audio/hoop_clank_3.wav'],
      ['hoop_clank', 'audio/hoop_metal_clank.wav'],
      ['hoop_swish', 'audio/hoop_swish.wav'],
      // Incidental player body thuds
      ['body_thud_1', 'audio/body_thud_1.wav'],
      ['body_thud_2', 'audio/body_thud_2.wav'],
      ['body_thud_3', 'audio/body_thud_3.wav'],
      // Athletic footsteps
      ['footstep_1', 'audio/footstep_1.wav'],
      ['footstep_2', 'audio/footstep_2.wav'],
      ['footstep_3', 'audio/footstep_3.wav'],
      // Arena buzzer
      ['arena_buzzer', 'audio/arena_buzzer.wav'],
      // Player effort vocals (tennis grunts & karate kiais)
      ['grunt_volley_1', 'audio/grunt_volley_1.wav'],
      ['grunt_volley_2', 'audio/grunt_volley_2.wav'],
      ['grunt_volley_3', 'audio/grunt_volley_3.wav'],
      ['grunt_spike_1', 'audio/grunt_spike_1.wav'],
      ['grunt_spike_2', 'audio/grunt_spike_2.wav'],
      ['grunt_spike_3', 'audio/grunt_spike_3.wav'],
      ['grunt_kick_1', 'audio/grunt_kick_1.wav'],
      ['grunt_kick_2', 'audio/grunt_kick_2.wav'],
      ['grunt_kick_3', 'audio/grunt_kick_3.wav'],
    ];

    await Promise.all(
      samples.map(async ([key, relPath]) => {
        try {
          const url = assetUrl(relPath);
          const res = await fetch(url);
          if (res.ok) {
            const arrayBuf = await res.arrayBuffer();
            const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
            this.buffers.set(key, audioBuf);
          }
        } catch (err) {
          console.warn(`[audio] Note: sample ${key} will use procedural fallback (${err.message})`);
        }
      }),
    );

    this.samplesLoaded = true;
    this.samplesLoading = false;
    console.log(`[audio] Preloaded ${this.buffers.size} authentic sports audio samples.`);
  }

  ensureRunning() {
    if (!this.ctx) return false;
    if (!TUNING.audio.enabled) return false;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx.state === 'running';
  }

  updateTuning() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(
      TUNING.audio.enabled ? TUNING.audio.masterVolume : 0,
      now,
      0.05,
    );
    this.sfxGain.gain.setTargetAtTime(TUNING.audio.sfxVolume, now, 0.05);
    this.ambienceGain.gain.setTargetAtTime(TUNING.audio.ambienceVolume, now, 0.05);
  }

  /**
   * Helper to create stereo panner and distance gain based on 3D world position.
   */
  createSpatialPanner(worldPos, targetBus = this.sfxGain) {
    if (!this.ctx) return { input: null, output: null };

    const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    const distGain = this.ctx.createGain();

    if (!worldPos || !this.camera || !TUNING.audio.spatialAudio) {
      distGain.connect(targetBus);
      return { input: distGain, output: distGain };
    }

    const camPos = this.camera.position;
    const dx = worldPos.x - camPos.x;
    const dy = worldPos.y - camPos.y;
    const dz = worldPos.z - camPos.z;
    const dist = Math.hypot(dx, dy, dz);

    const atten = 1.0 / (1.0 + 0.022 * dist);
    distGain.gain.setValueAtTime(Math.min(1.0, Math.max(0.12, atten)), this.ctx.currentTime);

    if (panner) {
      const camYaw = this.camera.rotation.y || 0;
      const cosY = Math.cos(camYaw);
      const sinY = Math.sin(camYaw);
      const localX = dx * cosY - dz * sinY;
      const pan = Math.max(-0.85, Math.min(0.85, localX / Math.max(6.0, dist)));
      panner.pan.setValueAtTime(pan, this.ctx.currentTime);

      distGain.connect(panner);
      panner.connect(targetBus);
      return { input: distGain, output: panner };
    } else {
      distGain.connect(targetBus);
      return { input: distGain, output: distGain };
    }
  }

  /**
   * Plays a preloaded audio buffer with pitch variation, gain scaling, and spatial audio.
   */
  playSample(key, gainVal = 1.0, playbackRate = 1.0, worldPos = null, targetBus = this.sfxGain) {
    if (!this.ensureRunning()) return false;
    const buf = this.buffers.get(key);
    if (!buf) return false;

    const { input } = this.createSpatialPanner(worldPos, targetBus);
    if (!input) return false;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(Math.max(0.2, Math.min(3.0, playbackRate)), this.ctx.currentTime);

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(gainVal, this.ctx.currentTime);

    src.connect(gainNode);
    gainNode.connect(input);
    src.start();
    return true;
  }

  /**
   * Plays a random sample from a pool of candidate keys, avoiding immediate repetition
   * and applying subtle random pitch detuning (±8%) to ensure high acoustic variety.
   */
  playSampleFromPool(poolName, keys, volume = 1.0, baseRate = 1.0, worldPos = null, targetBus = this.sfxGain) {
    if (!keys || keys.length === 0) return false;
    const lastKey = this.lastPlayedInPool.get(poolName);
    let candidate = keys[Math.floor(Math.random() * keys.length)];
    if (keys.length > 1 && candidate === lastKey) {
      const filtered = keys.filter((k) => k !== lastKey);
      candidate = filtered[Math.floor(Math.random() * filtered.length)];
    }
    this.lastPlayedInPool.set(poolName, candidate);

    const detune = 0.92 + Math.random() * 0.16;
    return this.playSample(candidate, volume, baseRate * detune, worldPos, targetBus);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GAMEPLAY SOUND DISPATCH
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ball Bounce Impact (Court Floor & General Surfaces):
   * Dynamic non-repeating rubber ball pools with velocity-scaled volume.
   */
  playBallBounce(ballRadius, speed, surfaceType = 'court', worldPos = null) {
    if (!this.ensureRunning()) return;

    // Strict velocity floor to eliminate resting micro-chatter
    if (speed < 0.35) return;

    const now = this.ctx.currentTime;
    if (now - this.lastBounceTime < 0.055) return;
    this.lastBounceTime = now;

    // Dynamic velocity curve: subtle soft taps up to authoritative heavy rebounds.
    // Normalized smooth power curve without an artificial high volume floor so low hops are soft.
    const norm = Math.max(0, (speed - 0.35) / 10.0);
    const volume = Math.min(1.0, Math.pow(norm, 1.35) * 0.95 + 0.035);

    let pool = ['rubber_med_1', 'rubber_med_2', 'rubber_med_3'];
    let poolName = 'rubber_med';
    if (ballRadius <= 0.3) {
      pool = ['rubber_small_1', 'rubber_small_2'];
      poolName = 'rubber_small';
    } else if (ballRadius >= 0.65) {
      pool = ['rubber_large_1', 'rubber_large_2'];
      poolName = 'rubber_large';
    }

    const rate = speed < 1.2 ? 0.90 : 1.0;
    const played = this.playSampleFromPool(poolName, pool, volume * 0.85, rate, worldPos);
    if (!played) {
      this.playProceduralRubberHit(ballRadius, volume, worldPos);
    }

    if (surfaceType === 'river') {
      this.playSplash(now, worldPos, volume * 0.6);
    }
  }

  /**
   * Continuous Ball Rolling Sound:
   * Removed for launch; to be re-evaluated for future releases.
   */
  updateBallRolling() {}

  /**
   * Boundary Glass / Basketball Backboard Impact:
   * Solid acrylic slap and polycarbonate glass flex when hitting boundaries.
   */
  playGlassImpact(speed, worldPos = null) {
    if (!this.ensureRunning()) return;
    if (speed < 0.35) return;

    const now = this.ctx.currentTime;
    if (now - this.lastGlassTime < 0.075) return;
    this.lastGlassTime = now;

    const volume = Math.min(1.0, Math.max(0.18, Math.pow(speed / 10.0, 0.75)));
    this.playSampleFromPool('glass', ['glass_1', 'glass_2', 'glass_3'], volume, 1.0, worldPos);
  }

  /**
   * Steel Hoop Clank:
   * EXCLUSIVE to physical collisions between the ball and the goal hoops.
   */
  playHoopClank(speed = 6.0, worldPos = null) {
    if (!this.ensureRunning()) return;
    if (speed < 0.35) return;

    const now = this.ctx.currentTime;
    if (now - this.lastHoopClankTime < 0.08) return;
    this.lastHoopClankTime = now;

    const volume = Math.min(1.0, Math.max(0.25, Math.pow(speed / 8.0, 0.7)));
    this.playSampleFromPool('hoop_clank', ['hoop_clank_1', 'hoop_clank_2', 'hoop_clank_3'], volume, 1.0, worldPos);
  }

  /**
   * Incidental Player Impact:
   * Ball bumps into the player's body or limbs outside an active strike window.
   * Distinctly softer than court floor bounces (cushioned flesh/clothing touch).
   */
  playPlayerBallImpact(speed, worldPos = null, ballRadius = 0.5) {
    if (!this.ensureRunning()) return;
    if (speed < 0.25) return;

    const now = this.ctx.currentTime;
    if (now - this.lastBodyThudTime < 0.07) return;
    this.lastBodyThudTime = now;

    // Distinctly softer than court floor bounces
    const norm = Math.max(0, (speed - 0.25) / 8.0);
    const volume = Math.min(0.55, Math.pow(norm, 1.1) * 0.45 + 0.08);
    this.playSampleFromPool('body_thud', ['body_thud_1', 'body_thud_2', 'body_thud_3'], volume, 1.0, worldPos);
  }

  /**
   * Human Vocal Exertion (Tennis Grunts & Karate Kiais):
   * Authentic athletic effort vocals accompanying strikes.
   */
  playPlayerGrunt(kindName, quality = 0.5, worldPos = null) {
    if (!this.ensureRunning()) return;

    let pool = ['grunt_volley_1', 'grunt_volley_2', 'grunt_volley_3'];
    if (kindName === 'spike') {
      pool = ['grunt_spike_1', 'grunt_spike_2', 'grunt_spike_3'];
    } else if (kindName === 'kick') {
      pool = ['grunt_kick_1', 'grunt_kick_2', 'grunt_kick_3'];
    }

    const volume = Math.min(1.0, 0.75 + 0.25 * quality);
    this.playSampleFromPool('grunt_' + kindName, pool, volume, 1.0, worldPos);
  }

  /**
   * Strike (Volley, Spike, Kick):
   * Taut rubber dodgeball smack paired with human vocal effort.
   */
  playStrike(kindName, quality = 0.5, speed = 14.0, worldPos = null, ballRadius = 0.5) {
    if (!this.ensureRunning()) return;

    const now = this.ctx.currentTime;
    const q = Math.max(0.3, Math.min(1.0, quality));
    const volume = Math.min(1.0, Math.max(0.4, speed / 16.0));

    let pool = ['rubber_med_1', 'rubber_med_2', 'rubber_med_3'];
    let poolName = 'rubber_med';
    if (ballRadius <= 0.3) {
      pool = ['rubber_small_1', 'rubber_small_2'];
      poolName = 'rubber_small';
    } else if (ballRadius >= 0.65) {
      pool = ['rubber_large_1', 'rubber_large_2'];
      poolName = 'rubber_large';
    }

    let rate = 1.0;
    if (kindName === 'spike') rate *= 1.1;
    else if (kindName === 'kick') rate *= 0.92;

    const played = this.playSampleFromPool(poolName, pool, volume, rate, worldPos);
    if (!played) {
      this.playProceduralRubberHit(ballRadius, volume, worldPos, kindName);
    }

    // 2. Play Human Player Vocal Exertion Grunt (Tennis grunt / Karate kiai)
    this.playPlayerGrunt(kindName, q, worldPos);
  }

  /**
   * Sneaker Traction Squeak:
   * Removed for launch per user direction to eliminate annoying squeaks.
   */
  playSneakerSqueak() {}

  /**
   * Athletic Court Footsteps:
   * Clean rubber shoe taps on court floor cycling across 3 variations.
   */
  playFootstep(worldPos = null) {
    if (!this.ensureRunning()) return;

    this.footstepIdx = (this.footstepIdx + 1) % 3;
    const pool = ['footstep_1', 'footstep_2', 'footstep_3'];
    const sampleKey = pool[this.footstepIdx];
    const rate = 0.94 + Math.random() * 0.12;

    this.playSample(sampleKey, 0.45, rate, worldPos);
  }

  /**
   * Goal Scoring Event:
   * Raw Basketball Arena Buzzer!
   * (Net swish removed; steel rim clank triggers only when ball hits the hoop)
   */
  playGoal(team = 'home', goalId = 'N', worldPos = null) {
    if (!this.ensureRunning()) return;

    // Raw Basketball Arena Buzzer (played globally via UI bus)
    const played = this.playSample('arena_buzzer', 0.9, 1.0, null, this.uiGain);
    if (!played) {
      this.playProceduralArenaBuzzer();
    }
  }

  playGoalHorn(team = 'home', goalId = 'N', worldPos = null) {
    this.playGoal(team, goalId, worldPos);
  }

  /**
   * Aperture Crossing Swish
   */
  playHoopCrossing(worldPos = null) {
    if (!this.ensureRunning()) return;
    this.playSample('hoop_swish', 0.85, 1.0, worldPos);
  }

  /**
   * Athlete Maneuvers (Jump, Land, Slide)
   */
  playAthleteAction(action, worldPos = null) {
    if (!this.ensureRunning()) return;

    if (action === 'jump') {
      this.playProceduralWhoosh(worldPos, 0.16);
    } else if (action === 'land') {
      this.playFootstep(worldPos);
    } else if (action === 'slide') {
      this.playProceduralWhoosh(worldPos, 0.20);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROCEDURAL FALLBACKS
  // ═══════════════════════════════════════════════════════════════════════════

  playProceduralRubberHit(ballRadius, volume, worldPos, kindName = 'bounce') {
    const now = this.ctx.currentTime;
    const { input } = this.createSpatialPanner(worldPos);
    if (!input) return;

    // Non-tonal noise burst for dead rubber physical smack
    const dur = ballRadius <= 0.3 ? 0.07 : ballRadius >= 0.65 ? 0.11 : 0.085;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / this.ctx.sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t / 0.014);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const cutoff = ballRadius <= 0.3 ? 480 : ballRadius >= 0.65 ? 220 : 340;
    filter.frequency.setValueAtTime(cutoff, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume * 0.85, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(input);
    src.start(now);
  }

  playProceduralSqueak() {}

  playProceduralArenaBuzzer() {
    const now = this.ctx.currentTime;
    const dur = 0.85;

    [120, 240, 720].forEach((f, idx) => {
      const osc = this.ctx.createOscillator();
      osc.type = idx === 0 ? 'sawtooth' : 'pulse' in osc ? 'pulse' : 'square';
      osc.frequency.setValueAtTime(f, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.4 / (idx + 1), now);
      gain.gain.setValueAtTime(0.4 / (idx + 1), now + dur - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      osc.connect(gain);
      gain.connect(this.uiGain);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    });
  }

  playProceduralWhoosh(worldPos, dur = 0.16) {
    const now = this.ctx.currentTime;
    const { input } = this.createSpatialPanner(worldPos);
    if (!input) return;

    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / d.length);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(300, now);
    filter.frequency.exponentialRampToValueAtTime(750, now + dur);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(input);
    src.start(now);
  }

  playSplash(startTime, worldPos, intensity) {
    const { input } = this.createSpatialPanner(worldPos);
    if (!input) return;

    const dur = 0.18;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length * 0.4));
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, startTime);
    filter.Q.setValueAtTime(2.0, startTime);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.35 * intensity, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(input);
    src.start(startTime);
  }

  startAmbience() {
    if (!this.ctx || this.ambienceStarted) return;
    this.ambienceStarted = true;

    const sampleRate = this.ctx.sampleRate;
    const bufferLength = sampleRate * 3;
    const noiseBuffer = this.ctx.createBuffer(1, bufferLength, sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferLength; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      output[i] = (b0 + b1 + b2) * 0.12;
    }

    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = noiseBuffer;
    windSrc.loop = true;

    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.setValueAtTime(300, this.ctx.currentTime);

    const windGain = this.ctx.createGain();
    windGain.gain.setValueAtTime(0.15, this.ctx.currentTime);

    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.ambienceGain);
    windSrc.start();
    this.windNode = windSrc;
  }
}

export const soundManager = new SoundManager();
if (typeof window !== 'undefined') {
  window.__soundManager = soundManager;
}
