import { TUNING, assetUrl } from '../config/tuning.js';

/**
 * VALLEYBALL MUSIC MANAGER (CONTINUOUS-MOMENTUM ENGINE)
 *
 * Implements adaptive background music architecture for Valleyball Versus:
 * - Feeder playlist registry (supports 4-5 tracks, starts with 'Arena of Frost').
 * - Continuous momentum doctrine: Never stops on goals or whistles.
 * - Dynamic Web Audio processing:
 *   - BiquadFilterNode low-pass sweep on dives and aerial power spikes ("Cathedral Ceiling" slow-mo effect).
 *   - Accent ducking on goal scores to let the arena buzzer and crowd burst cut through while keeping the motor bass rolling.
 *   - Stem-ready architecture: seamlessly mixes 4-stem kits or streams master tracks.
 *
 * LAW 1 & 6 COMPLIANCE:
 * Music is STRICTLY render/consumer-side. Zero writes to physics or simulation ticks.
 */
export class MusicManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;

    // Audio Graph Nodes
    this.musicGain = null;
    this.filterNode = null;
    this.duckGain = null;

    // Playback state
    this.currentTrackIndex = 0;
    this.audioElement = null;
    this.mediaSourceNode = null;
    this.isPlaying = false;
    this.isMuted = false;

    // Stem buffers cache (for multitrack mode)
    this.stemBuffers = new Map();
    this.activeStemSources = [];
    this.stemGains = {
      drone: null,
      bass: null,
      drums: null,
      climax: null,
    };

    // Filter automation lock
    this._filterRamping = false;
  }

  /**
   * Initializes the MusicManager into the host Web Audio context.
   * @param {AudioContext} ctx
   * @param {GainNode} masterGain
   */
  init(ctx, masterGain) {
    if (!ctx || !masterGain) return;
    this.ctx = ctx;
    this.masterGain = masterGain;

    // Master Music Bus
    this.musicGain = this.ctx.createGain();
    const initialVol = TUNING.audio?.musicVolume ?? 0.7;
    const enabled = TUNING.audio?.musicEnabled ?? true;
    this.musicGain.gain.setValueAtTime(
      enabled ? initialVol : 0,
      this.ctx.currentTime,
    );
    this.musicGain.connect(this.masterGain);

    // Dynamic Low-Pass Filter (for dives, slow-mo aerial spikes, pause menu)
    this.filterNode = this.ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.setValueAtTime(20000, this.ctx.currentTime);
    this.filterNode.Q.setValueAtTime(1.0, this.ctx.currentTime);
    this.filterNode.connect(this.musicGain);

    // Goal Ducking Bus
    this.duckGain = this.ctx.createGain();
    this.duckGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
    this.duckGain.connect(this.filterNode);

    // Setup stem gain nodes summing into duckGain
    this.stemGains.drone = this.ctx.createGain();
    this.stemGains.drone.gain.setValueAtTime(1.0, this.ctx.currentTime);
    this.stemGains.drone.connect(this.duckGain);

    this.stemGains.bass = this.ctx.createGain();
    this.stemGains.bass.gain.setValueAtTime(1.0, this.ctx.currentTime);
    this.stemGains.bass.connect(this.duckGain);

    this.stemGains.drums = this.ctx.createGain();
    this.stemGains.drums.gain.setValueAtTime(1.0, this.ctx.currentTime);
    this.stemGains.drums.connect(this.duckGain);

    this.stemGains.climax = this.ctx.createGain();
    this.stemGains.climax.gain.setValueAtTime(0.0, this.ctx.currentTime);
    this.stemGains.climax.connect(this.duckGain);

    console.log('[music] MusicManager Web Audio graph initialized.');
  }

  /**
   * Returns playlist array from TUNING.
   */
  getPlaylist() {
    return TUNING.audio?.musicPlaylist || [
      {
        id: 'track_01_arena_of_frost',
        title: 'Arena of Frost (Debut Anthem)',
        bpm: 130,
        src: 'audio/music/track_01_arena_of_frost.mp3',
      },
      {
        id: 'track_02_baroque_pulse',
        title: 'Baroque Pulse',
        bpm: 128,
        src: 'audio/music/track_02_baroque_pulse.mp3',
      },
      {
        id: 'track_03_smalltown_drive',
        title: 'Smalltown Drive',
        bpm: 132,
        src: 'audio/music/track_03_smalltown_drive.mp3',
      },
      {
        id: 'track_04_gladiatorial_toccata',
        title: 'Gladiatorial Toccata',
        bpm: 126,
        src: 'audio/music/track_04_gladiatorial_toccata.mp3',
      },
      {
        id: 'track_05_spectral_continuum',
        title: 'Spectral Continuum',
        bpm: 130,
        src: 'audio/music/track_05_spectral_continuum.mp3',
      },
    ];
  }

  /**
   * Starts playing a track by index or ID.
   * @param {number|string} target
   * @param {boolean} loop
   */
  play(target = 0, loop = true) {
    if (!this.ctx) return;
    const playlist = this.getPlaylist();
    if (!playlist || playlist.length === 0) return;

    let index = 0;
    if (typeof target === 'number') {
      index = Math.max(0, Math.min(playlist.length - 1, target));
    } else if (typeof target === 'string') {
      const found = playlist.findIndex((t) => t.id === target);
      if (found >= 0) index = found;
    }
    this.currentTrackIndex = index;
    const track = playlist[index];

    // Ensure audio context is running
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    // Stop currently running playback
    this.stop();

    if (!track.src) {
      console.warn(`[music] Track "${track.title}" has no src configured.`);
      return;
    }

    try {
      const fullUrl = assetUrl(track.src);
      this.audioElement = new Audio();
      this.audioElement.src = fullUrl;
      this.audioElement.crossOrigin = 'anonymous';
      this.audioElement.loop = loop;
      this.audioElement.preload = 'auto';

      this.mediaSourceNode = this.ctx.createMediaElementSource(this.audioElement);
      this.mediaSourceNode.connect(this.duckGain);

      const playPromise = this.audioElement.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            this.isPlaying = true;
            console.log(`[music] Now playing: ${track.title} (${track.bpm || 130} BPM)`);
          })
          .catch((err) => {
            console.warn(`[music] Autoplay deferred until user interaction: ${err.message}`);
          });
      }
    } catch (err) {
      console.error(`[music] Failed to start track "${track.title}":`, err);
    }
  }

  /**
   * Stops music playback.
   */
  stop() {
    if (this.audioElement) {
      try {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
      } catch (_) {}
      this.audioElement = null;
    }
    if (this.mediaSourceNode) {
      try {
        this.mediaSourceNode.disconnect();
      } catch (_) {}
      this.mediaSourceNode = null;
    }
    this.isPlaying = false;
  }

  /**
   * Pauses current playback.
   */
  pause() {
    if (this.audioElement && this.isPlaying) {
      this.audioElement.pause();
      this.isPlaying = false;
    }
  }

  /**
   * Resumes current playback.
   */
  resume() {
    if (this.audioElement && !this.isPlaying) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.audioElement.play().catch(() => {});
      this.isPlaying = true;
    }
  }

  /**
   * Next track in playlist.
   */
  nextTrack() {
    const playlist = this.getPlaylist();
    const nextIdx = (this.currentTrackIndex + 1) % playlist.length;
    this.play(nextIdx);
  }

  /**
   * Previous track in playlist.
   */
  prevTrack() {
    const playlist = this.getPlaylist();
    const prevIdx = (this.currentTrackIndex - 1 + playlist.length) % playlist.length;
    this.play(prevIdx);
  }

  /**
   * Reacts to match kickoff.
   */
  onMatchStart() {
    if (!this.isPlaying) {
      this.play(this.currentTrackIndex);
    }
    this.resetAcoustics();
  }

  /**
   * Reacts to a goal being scored.
   * VALLEYBALL DOCTRINE: Play never stops, ball stays live, ends flip.
   * The music ducks briefly so the buzzer/crowd punches through,
   * but the underlying motor never halts.
   */
  onGoalScored() {
    if (!this.ctx || !this.duckGain) return;
    const now = this.ctx.currentTime;

    // Instant duck to 25% volume, smoothly ramping back to 100% across 0.75 seconds
    this.duckGain.gain.cancelScheduledValues(now);
    this.duckGain.gain.setValueAtTime(0.25, now);
    this.duckGain.gain.setTargetAtTime(1.0, now + 0.1, 0.25);
  }

  /**
   * Reacts to aerial power spikes or diving ground saves.
   * Sweeps low-pass filter down to ~450 Hz for 0.35s ("Cathedral Ceiling" slow-mo effect).
   */
  triggerImpactFilter(cutoffHz = 480, duration = 0.38) {
    if (!this.ctx || !this.filterNode) return;
    const now = this.ctx.currentTime;

    this.filterNode.frequency.cancelScheduledValues(now);
    this.filterNode.frequency.setValueAtTime(cutoffHz, now);
    this.filterNode.frequency.exponentialRampToValueAtTime(20000, now + duration);
  }

  /**
   * Modulates music acoustics based on live ball speed.
   * High-velocity balls (> 22 m/s) slightly brighten highs and boost presence.
   * @param {number} ballSpeed in m/s
   */
  onBallDynamics(ballSpeed) {
    if (!this.ctx || !this.filterNode) return;
    if (this._filterRamping) return;

    if (ballSpeed > 22.0) {
      const now = this.ctx.currentTime;
      this.filterNode.frequency.setTargetAtTime(22000, now, 0.1);
    }
  }

  /**
   * Resets filter and duck gains to standard open values.
   */
  resetAcoustics() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.filterNode) {
      this.filterNode.frequency.cancelScheduledValues(now);
      this.filterNode.frequency.setValueAtTime(20000, now);
    }
    if (this.duckGain) {
      this.duckGain.gain.cancelScheduledValues(now);
      this.duckGain.gain.setValueAtTime(1.0, now);
    }
  }

  /**
   * Updates music volume live according to TUNING.
   */
  updateVolume() {
    if (!this.ctx || !this.musicGain) return;
    const enabled = TUNING.audio?.enabled && (TUNING.audio?.musicEnabled ?? true);
    const configuredVol = TUNING.audio?.musicVolume ?? 0.7;
    const vol = enabled ? (this.volumeOverride ?? configuredVol) : 0;
    const now = this.ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(vol, now, 0.05);
  }

  setVolume(vol) {
    this.volumeOverride = Math.max(0, Math.min(1, vol));
    this.updateVolume();
  }

  getVolume() {
    return this.volumeOverride ?? TUNING.audio?.musicVolume ?? 0.7;
  }
}

export const musicManager = new MusicManager();
if (typeof window !== 'undefined') {
  window.__musicManager = musicManager;
}
