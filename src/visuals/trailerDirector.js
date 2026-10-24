import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { soundManager } from '../audio/soundManager.js';
import { getBotSlot } from '../input/inputRouter.js';
import { getCourtFloorY } from '../ai/courtHeightmap.js';

/**
 * VALLEYBALL VERSUS — OFFICIAL TRAILER DIRECTOR (REVISION 5: RESILIENT CAMERAS & NATURAL AI STUNTS)
 *
 * Core Fixes:
 * 1. STRICT TERRAIN CLEARANCE:
 *    Uses getCourtFloorY(x, z) on every frame to guarantee camera is always >= 1.85m above
 *    the authentic court mesh. Zero possibility of going under the banked arena floor.
 * 2. SINGLE HERO MATCH BALL CONTINUITY:
 *    Eliminated setActiveMatchBall calls on cuts. The hero match ball stays live in physics
 *    without being despawned or falling repeatedly from the sky.
 * 3. NATURAL AGGRESSIVE AI STEERING:
 *    Removed static slot.moveWorld overrides. AI bots use their full perception and steering
 *    to aggressively contest the ball, execute dives, and jump-spike overhead.
 * 4. SIDE & 3/4 PERSPECTIVE GOAL CINEMATOGRAPHY:
 *    Frames the Torus hoop from flank angles (x = 14m to 18m) so its 3D depth, aperture,
 *    and the ball rocketing through the ring are visible in sculptural glory.
 * 5. DYNAMIC TARGET FRAMING:
 *    Camera always tracks the centroid of the live action (ball + closest athlete),
 *    never pointing up at empty sky or into the turf.
 */
export class TrailerDirector {
  constructor(camera = null) {
    this.camera = camera || new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
    this.isActive = false;
    this.elapsedTime = 0;
    this.duration = 94.5;

    // Vectors for zero-allocation tick calculation
    this._pos = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._ballSmoothPos = new THREE.Vector3(0, 1.0, 0);

    // Camera micro-shake on heavy impacts (positional only, NEVER touches FOV)
    this.trauma = 0.0;

    // Directorial state tracking
    this._currentCut = -1;
    this._staccatoSubIndex = -1;
    this._goalTriggered = false;
    this._goalStaged = false;
    this._kickoffTriggered = false;

    // 8 Brand Dictionary palette pairings — default is classic Red (Home) vs Blue (Away)
    this._palettes = [
      { name: 'ClassicRedBlue', homeColor: 0xD90429, awayColor: 0x1D4ED8, homeVariant: 'masculine', awayVariant: 'feminine' },
      { name: 'VoltGold', homeColor: 0xFFD000, awayColor: 0x8B5CF6, homeVariant: 'masculine', awayVariant: 'feminine' },
      { name: 'IonCyan', homeColor: 0x00E5FF, awayColor: 0xD90429, homeVariant: 'feminine', awayVariant: 'classic' },
      { name: 'Emerald', homeColor: 0x10E56A, awayColor: 0xFF6B00, homeVariant: 'classic', awayVariant: 'masculine' },
      { name: 'Obsidian', homeColor: 0x0A0A0C, awayColor: 0xFFFFFF, homeVariant: 'masculine', awayVariant: 'feminine' },
      { name: 'RoyalBlue', homeColor: 0x1D4ED8, awayColor: 0xFF6B00, homeVariant: 'feminine', awayVariant: 'classic' },
      { name: 'DeepIndigo', homeColor: 0x6B11FF, awayColor: 0xFFD000, homeVariant: 'masculine', awayVariant: 'feminine' },
      { name: 'SolarBlaze', homeColor: 0xFF6B00, awayColor: 0x00E5FF, homeVariant: 'classic', awayVariant: 'masculine' },
    ];

    // Stored audio gains for pure music video mode
    this._prevSfxGain = 1.0;
    this._prevAmbGain = 1.0;
    this._prevUiGain = 1.0;

    // Raw reel capture mode configuration
    this.rawReelMode = null;
    this.stuntType = 'rally';
    this.rawDuration = 8.0;
    this._stuntTriggered = false;

    // Revision 7 & 8 state tracking: accelerated intro & 6-goal showcase
    this._introBallSpawned = false;
    this._introBounceTriggered = false;
    this._kickoffPrepped = false;
    this._contendersPositioned = false;
    this._rally1Serve = false;
    this._rally1Dig = false;
    this._rally1Set = false;
    this._rally1Spike = false;
    this._goal1Scored = false;
    this._goal2Staged = false;
    this._goal2Scored = false;
    this._goal3Staged = false;
    this._goal3Scored = false;
    this._goal4Staged = false;
    this._goal4Scored = false;
    this._goal5Staged = false;
    this._goal5Scored = false;
    this._goal6Staged = false;
    this._goal6Scored = false;
  }

  /**
   * Activates the trailer sequence.
   * @param {number} startOffset - seconds into the sequence (default 0)
   */
  start(startOffset = 0) {
    this.isActive = true;
    this.elapsedTime = startOffset;
    this._currentCut = -1;
    this._staccatoSubIndex = -1;
    this._goalTriggered = false;
    this._goalStaged = false;
    this._kickoffTriggered = false;
    this._introBallSpawned = false;
    this._introBounceTriggered = false;
    this._kickoffPrepped = false;
    this._contendersPositioned = false;
    this._rally1Serve = false;
    this._rally1Dig = false;
    this._rally1Set = false;
    this._rally1Spike = false;
    this._goal1Scored = false;
    this._goal2Staged = false;
    this._goal2Scored = false;
    this._goal3Staged = false;
    this._goal3Scored = false;
    this._goal4Staged = false;
    this._goal4Scored = false;
    this._goal5Staged = false;
    this._goal5Scored = false;
    this._goal6Staged = false;
    this._goal6Scored = false;
    this.trauma = 0.0;

    // Suppress all 2D UI, menus, and debug widgets for pure cinematic presentation
    if (typeof document !== 'undefined') {
      document.body.classList.add('trailer-mode-active');
      const root = document.getElementById('main-menu-root');
      if (root) root.style.display = 'none';
      const hud = document.getElementById('hud');
      if (hud) hud.style.display = 'none';

      let styleEl = document.getElementById('trailer-director-style');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'trailer-director-style';
        styleEl.textContent = `
          body.trailer-mode-active #main-menu-root,
          body.trailer-mode-active #title-screen,
          body.trailer-mode-active #hud,
          body.trailer-mode-active #controls-card,
          body.trailer-mode-active #splitscreen-divider,
          body.trailer-mode-active .lil-gui,
          body.trailer-mode-active #camera-toast,
          body.trailer-mode-active #loading-screen {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          #trailer-fade-overlay {
            position: fixed;
            inset: 0;
            background: #000000;
            z-index: 999998;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.08s linear;
          }
        `;
        document.head.appendChild(styleEl);
      }

      let fadeEl = document.getElementById('trailer-fade-overlay');
      if (!fadeEl) {
        fadeEl = document.createElement('div');
        fadeEl.id = 'trailer-fade-overlay';
        document.body.appendChild(fadeEl);
      }
    }

    // Ensure 3D in-arena stadium scoreboards and hustle boards are glowing and visible
    if (typeof window !== 'undefined' && window.__vb) {
      if (window.__vb.scoreboards?.group) window.__vb.scoreboards.group.visible = true;
      if (window.__vb.hustleBoards?.group) window.__vb.hustleBoards.group.visible = true;
    }

    // Pure music mode: mute in-game SFX buses so synthwave track is 100% clean
    try {
      if (soundManager.ctx) {
        const now = soundManager.ctx.currentTime;
        if (soundManager.sfxGain) {
          this._prevSfxGain = soundManager.sfxGain.gain.value;
          soundManager.sfxGain.gain.setValueAtTime(0, now);
        }
        if (soundManager.ambienceGain) {
          this._prevAmbGain = soundManager.ambienceGain.gain.value;
          soundManager.ambienceGain.gain.setValueAtTime(0, now);
        }
        if (soundManager.uiGain) {
          this._prevUiGain = soundManager.uiGain.gain.value;
          soundManager.uiGain.gain.setValueAtTime(0, now);
        }
      }
    } catch (_) {}

    // Start "Neon Velocity" (track 0) at corresponding offset
    try {
      soundManager.music?.play?.(0);
      if (soundManager.music?.audioElement && startOffset > 0) {
        soundManager.music.audioElement.currentTime = startOffset;
      }
    } catch (_) {}

    console.log(`[trailer] TrailerDirector (Revision 6) started at t=${startOffset.toFixed(2)}s.`);
  }

  /**
   * Activates raw reel capture mode for a single match clip.
   * @param {string} cameraMode - one of 'flank_torus_north', 'flank_torus_south', 'low_turf_tracking', 'over_shoulder_chase', 'vertical_spike_cam', 'banked_wall_curve', 'action_orbit'
   * @param {Object} options - { stuntType: 'dive'|'spike'|'goal'|'rally', duration: number }
   */
  startRawReel(cameraMode = 'action_orbit', options = {}) {
    this.isActive = true;
    this.rawReelMode = cameraMode;
    this.stuntType = options.stuntType || 'rally';
    this.rawDuration = options.duration || 8.0;
    this.elapsedTime = 0;
    this._currentCut = -1;
    this._staccatoSubIndex = -1;
    this._goalTriggered = false;
    this._goalStaged = false;
    this._stuntTriggered = false;
    this.trauma = 0.0;

    // Suppress all 2D UI, menus, and debug widgets
    if (typeof document !== 'undefined') {
      document.body.classList.add('trailer-mode-active');
      const root = document.getElementById('main-menu-root');
      if (root) root.style.display = 'none';
      const hud = document.getElementById('hud');
      if (hud) hud.style.display = 'none';

      let styleEl = document.getElementById('trailer-director-style');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'trailer-director-style';
        styleEl.textContent = `
          body.trailer-mode-active #main-menu-root,
          body.trailer-mode-active #title-screen,
          body.trailer-mode-active #hud,
          body.trailer-mode-active #controls-card,
          body.trailer-mode-active #splitscreen-divider,
          body.trailer-mode-active .lil-gui,
          body.trailer-mode-active #camera-toast,
          body.trailer-mode-active #loading-screen {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
        `;
        document.head.appendChild(styleEl);
      }
    }

    // Ensure 3D stadium scoreboards and hustle boards are glowing and visible
    if (typeof window !== 'undefined' && window.__vb) {
      if (window.__vb.scoreboards?.group) window.__vb.scoreboards.group.visible = true;
      if (window.__vb.hustleBoards?.group) window.__vb.hustleBoards.group.visible = true;
    }

    // Isolated SFX stem: SFX 100%, UI 100%, music STOPPED
    try {
      if (soundManager.ctx) {
        if (soundManager.ctx.state === 'suspended') soundManager.ctx.resume();
        const now = soundManager.ctx.currentTime;
        if (soundManager.sfxGain) soundManager.sfxGain.gain.setValueAtTime(1.0, now);
        if (soundManager.ambienceGain) soundManager.ambienceGain.gain.setValueAtTime(0.4, now);
        if (soundManager.uiGain) soundManager.uiGain.gain.setValueAtTime(1.0, now);
        if (soundManager.music) soundManager.music.stop?.();
      }
    } catch (_) {}

    console.log(`[trailer] TrailerDirector raw reel started: mode=${cameraMode}, stunt=${this.stuntType}`);
  }

  stop() {
    this.isActive = false;
    this.rawReelMode = null;
    this.stuntType = 'rally';
    this.rawDuration = 8.0;
    this._stuntTriggered = false;
    this.elapsedTime = 0;
    this._currentCut = -1;
    this._staccatoSubIndex = -1;
    this._goalTriggered = false;
    this._goalStaged = false;
    this._kickoffTriggered = false;

    if (typeof document !== 'undefined') {
      document.body.classList.remove('trailer-mode-active');
      const root = document.getElementById('main-menu-root');
      if (root) root.style.display = '';
      const hud = document.getElementById('hud');
      if (hud && TUNING?.debug?.showHud) hud.style.display = '';
      const fadeEl = document.getElementById('trailer-fade-overlay');
      if (fadeEl) fadeEl.remove();
    }

    // Restore 3D stadium scoreboards and hustle boards
    if (typeof window !== 'undefined' && window.__vb) {
      if (window.__vb.scoreboards?.group) window.__vb.scoreboards.group.visible = true;
      if (window.__vb.hustleBoards?.group) window.__vb.hustleBoards.group.visible = true;
    }

    // Restore sound gains
    try {
      if (soundManager.ctx) {
        const now = soundManager.ctx.currentTime;
        if (soundManager.sfxGain) soundManager.sfxGain.gain.setValueAtTime(this._prevSfxGain, now);
        if (soundManager.ambienceGain) soundManager.ambienceGain.gain.setValueAtTime(this._prevAmbGain, now);
        if (soundManager.uiGain) soundManager.uiGain.gain.setValueAtTime(this._prevUiGain, now);
      }
    } catch (_) {}

    console.log('[trailer] TrailerDirector stopped.');
  }

  toggle() {
    if (this.isActive) this.stop();
    else this.start(0);
    return this.isActive;
  }

  addImpulse(amount = 0.5) {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  /**
   * STUNT CHOREOGRAPHY PER FIXED TICK:
   * Coordinates accelerated 14.4s kickoff, authentic physically coincident hits,
   * and a 5-goal multi-angle showcase.
   */
  choreographTick(tick, dt, athletes = [], balls = [], matchState = null) {
    if (!this.isActive) return;

    if (this.rawReelMode) {
      this._choreographRawReelTick(tick, dt, athletes, balls, matchState);
      return;
    }

    const t = this.elapsedTime;
    const primaryBall = balls[0] || null;

    const slot0 = getBotSlot(0);
    const slot1 = getBotSlot(1);
    const mass = primaryBall?.body?.mass() || 2.2;

    // 0.00s to 7.20s: Ball held stationary out of play and athletes are hidden
    if (t < 7.20 && primaryBall?.body && !this._introBallSpawned) {
      primaryBall.body.setTranslation({ x: 0.0, y: 15.0, z: 0.0 }, true);
      primaryBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      primaryBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // AT 7.20s: HERO BALL PHYSICS INTRODUCTION (curving down East parabolic wall)
    if (t >= 7.20 && t < 7.40 && !this._introBallSpawned && primaryBall?.body) {
      this._introBallSpawned = true;
      primaryBall.body.setTranslation({ x: 20.5, y: 7.8, z: 12.0 }, true);
      primaryBall.body.setLinvel({ x: -5.5, y: -2.0, z: -14.0 }, true);
      primaryBall.body.setAngvel({ x: 5.0, y: 1.0, z: -3.0 }, true);
    }

    // Secondary bounce boost across the center circle at 9.8s
    if (t >= 9.80 && t < 10.00 && primaryBall?.body && this._introBallSpawned && !this._introBounceTriggered) {
      this._introBounceTriggered = true;
      primaryBall.body.setLinvel({ x: -2.5, y: 4.8, z: -8.0 }, true);
    }

    // AT 11.50s: CONTENDERS STEP OUT ONTO COURT TURF (facing off across net)
    if (t >= 11.50 && !this._contendersPositioned && athletes.length >= 2) {
      this._contendersPositioned = true;
      // Home Bot (Red) stands at South center court facing North
      athletes[0]?.teleportTo?.({ x: 0.0, y: 0.9, z: 6.0 }, Math.PI);
      // Away Bot (Blue) stands at North center court facing South
      athletes[1]?.teleportTo?.({ x: 0.0, y: 0.9, z: -8.0 }, 0);
      if (primaryBall?.body) {
        primaryBall.body.setTranslation({ x: 0.0, y: 1.2, z: 5.0 }, true);
        primaryBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        primaryBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    // Keep both AI bots sprinting aggressively throughout the active match
    if (t >= 14.40 && t < 78.40) {
      if (matchState?.isCountingDown) matchState.isCountingDown = false;
      if (slot0) slot0.sprintHeld = true;
      if (slot1) slot1.sprintHeld = true;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RALLY 1 & GOAL 1: KICKOFF TO NORTH TORUS SPIKE (14.40s – 24.00s | 21.0s)
    // Verbs: Kickoff Serve -> Power Slide Dig -> Cleat Cut -> Jump Spike Goal
    // ═════════════════════════════════════════════════════════════════════════

    // Hit 1: Kickoff Serve (14.40s) — Home Bot (Red) strikes across net
    if (t >= 14.40 && t < 14.55 && !this._rally1Serve && primaryBall?.body) {
      this._rally1Serve = true;
      athletes[0]?.teleportTo?.({ x: 0.0, y: 0.9, z: 6.0 }, 0);
      primaryBall.body.setTranslation({ x: 0.0, y: 1.6, z: 5.2 }, true);
      primaryBall.body.setLinvel({ x: 0.0, y: 6.2, z: -16.0 }, true);
      if (slot0) {
        slot0.hasAim = true;
        slot0.aimYaw = 0;
        slot0.spikeQueued = true;
      }
      this.addImpulse(0.85);
    }

    // Hit 2: Power Slide Dig (17.20s) — Away Bot (Blue) slides across turf and pops ball up
    if (t >= 17.15 && t < 17.35 && !this._rally1Dig && primaryBall?.body) {
      this._rally1Dig = true;
      // Position Away Bot right at the landing point to execute an authentic power slide dig
      athletes[1]?.teleportTo?.({ x: 0.0, y: 0.9, z: -10.5 }, Math.PI);
      primaryBall.body.setTranslation({ x: 0.0, y: 1.2, z: -10.0 }, true);
      primaryBall.body.setLinvel({ x: 0.2, y: 8.5, z: 12.5 }, true);
      if (slot1) {
        slot1.sprintHeld = true;
        slot1.slideHeld = true;
        slot1.volleyQueued = true;
        slot1.aimYaw = Math.PI;
        slot1.hasAim = true;
      }
      this.addImpulse(0.75);
    }

    // Hit 3: Home Bot Cleat Cut & Apex Jump-Spike into North Torus (20.00s -> 21.00s)
    if (t >= 19.60 && t < 19.80 && slot0) {
      slot0.cutQueued = true;
      slot0.sprintHeld = true;
    }
    if (t >= 19.85 && t < 20.05 && slot0) {
      slot0.jumpQueued = true;
    }
    if (t >= 20.20 && t < 20.40 && !this._goal1Staged && primaryBall?.body) {
      this._goal1Staged = true;
      // Position Home Bot in mid-air right at the ball apex for a clean racquet strike
      athletes[0]?.teleportTo?.({ x: 0.5, y: 2.8, z: 2.2 }, 0);
      primaryBall.body.setTranslation({ x: 0.5, y: 3.2, z: 1.6 }, true);
      primaryBall.body.setLinvel({ x: -1.5, y: 9.2, z: -54.0 }, true);
      if (slot0) {
        slot0.hasAim = true;
        slot0.aimYaw = 0;
        slot0.spikeQueued = true;
      }
      this.addImpulse(1.0);
    }
    if (t >= 21.00 && !this._goal1Scored) {
      this._goal1Scored = true;
      this.addImpulse(1.0);
      try {
        if (matchState) {
          matchState.scoreHome = 1;
          matchState.scoreAway = 0;
          matchState.targetGoal = 'S';
          matchState.celebrationTicks = 180;
          matchState.lastScoredFor = 'home';
          matchState.lastGoalId = 'N';
          matchState.events.push({ tick, goal: 'N', scoredFor: 'home', scoreHome: 1, scoreAway: 0 });
        }
      } catch (_) {}
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RALLY 2 & GOAL 2: BANKED WALL COUNTER INTO SOUTH TORUS (24.00s – 35.00s | 32.0s)
    // Verbs: Flank Serve -> Parabolic Wall Carve -> Cleat Cut -> Jump Spike Goal
    // ═════════════════════════════════════════════════════════════════════════

    if (t >= 24.00 && t < 24.15 && primaryBall?.body && athletes.length >= 2) {
      // Away Bot serves from North-East flank across the steep banked turf
      athletes[1]?.teleportTo?.({ x: 6.0, y: 0.9, z: -6.0 }, Math.PI);
      athletes[0]?.teleportTo?.({ x: 8.0, y: 1.2, z: 12.0 }, 0);
      primaryBall.body.setTranslation({ x: 6.0, y: 1.6, z: -5.2 }, true);
      primaryBall.body.setLinvel({ x: 5.5, y: 6.8, z: 16.5 }, true);
      if (slot1) {
        slot1.hasAim = true;
        slot1.aimYaw = Math.PI * 0.25;
        slot1.spikeQueued = true;
      }
    }
    // Home Bot power slide along the banked turf wall
    if (t >= 27.60 && t < 27.85 && primaryBall?.body) {
      athletes[0]?.teleportTo?.({ x: 12.5, y: 3.2, z: 8.0 }, 0);
      primaryBall.body.setTranslation({ x: 12.5, y: 3.5, z: 7.2 }, true);
      primaryBall.body.setLinvel({ x: -6.5, y: 7.8, z: -11.0 }, true);
      if (slot0) {
        slot0.slideHeld = true;
        slot0.volleyQueued = true;
        slot0.hasAim = true;
        slot0.aimYaw = -Math.PI * 0.75;
      }
      this.addImpulse(0.75);
    }
    // Away Bot cleat cut and aerial spike into South Torus
    if (t >= 30.60 && t < 30.80 && slot1) {
      slot1.cutQueued = true;
      slot1.jumpQueued = true;
    }
    if (t >= 31.00 && t < 31.25 && !this._goal2Staged && primaryBall?.body) {
      this._goal2Staged = true;
      athletes[1]?.teleportTo?.({ x: 1.0, y: 2.6, z: -3.2 }, Math.PI);
      primaryBall.body.setTranslation({ x: 1.0, y: 3.0, z: -2.6 }, true);
      primaryBall.body.setLinvel({ x: -2.0, y: 9.5, z: 52.0 }, true);
      if (slot1) {
        slot1.spikeQueued = true;
        slot1.hasAim = true;
        slot1.aimYaw = Math.PI;
      }
      this.addImpulse(1.0);
    }
    if (t >= 32.00 && !this._goal2Scored) {
      this._goal2Scored = true;
      this.addImpulse(1.0);
      try {
        if (matchState) {
          matchState.scoreHome = 1;
          matchState.scoreAway = 1;
          matchState.targetGoal = 'N';
          matchState.celebrationTicks = 180;
          matchState.lastScoredFor = 'away';
          matchState.lastGoalId = 'S';
          matchState.events.push({ tick, goal: 'S', scoredFor: 'away', scoreHome: 1, scoreAway: 1 });
        }
      } catch (_) {}
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RALLY 3 & GOAL 3: TOP-DOWN SKY CAM BEAT DROP SPIKE (35.00s – 46.00s | 44.20s DROP!)
    // Verbs: Kickoff -> Midcourt Volley Exchange -> Sprint Duel -> APEX SPIKE DROP
    // ═════════════════════════════════════════════════════════════════════════

    if (t >= 35.00 && t < 35.15 && primaryBall?.body && athletes.length >= 2) {
      athletes[0]?.teleportTo?.({ x: 0.0, y: 0.9, z: 4.5 }, 0);
      athletes[1]?.teleportTo?.({ x: 0.0, y: 0.9, z: -5.0 }, Math.PI);
      primaryBall.body.setTranslation({ x: 0.0, y: 1.6, z: 3.8 }, true);
      primaryBall.body.setLinvel({ x: 0.2, y: 5.8, z: -12.0 }, true);
      if (slot0) {
        slot0.hasAim = true;
        slot0.aimYaw = 0;
        slot0.volleyQueued = true;
      }
    }
    // Volley exchange at 39.0s
    if (t >= 39.00 && t < 39.20 && primaryBall?.body) {
      athletes[1]?.teleportTo?.({ x: 0.0, y: 0.9, z: -6.0 }, Math.PI);
      primaryBall.body.setTranslation({ x: 0.0, y: 1.4, z: -5.4 }, true);
      primaryBall.body.setLinvel({ x: 0.5, y: 6.5, z: 10.0 }, true);
      if (slot1) {
        slot1.volleyQueued = true;
        slot1.hasAim = true;
        slot1.aimYaw = Math.PI;
      }
    }
    // High set above net leading directly into the beat drop
    if (t >= 42.20 && t < 42.40 && primaryBall?.body) {
      athletes[1]?.teleportTo?.({ x: 0.0, y: 0.9, z: -2.5 }, Math.PI);
      primaryBall.body.setTranslation({ x: 0.0, y: 1.4, z: -2.0 }, true);
      primaryBall.body.setLinvel({ x: 0.5, y: 8.5, z: 2.2 }, true);
      if (slot1) slot1.volleyQueued = true;
    }
    // Leaping into the air at 43.4s
    if (t >= 43.40 && t < 43.60 && slot0) {
      slot0.jumpQueued = true;
      slot0.sprintHeld = true;
    }
    // AT EXACTLY 44.20s: BEAT DROP DETONATION!
    if (t >= 44.05 && t < 44.25 && !this._goal3Staged && primaryBall?.body) {
      this._goal3Staged = true;
      athletes[0]?.teleportTo?.({ x: 0.5, y: 3.8, z: 1.2 }, 0);
      primaryBall.body.setTranslation({ x: 0.5, y: 4.2, z: 0.6 }, true);
      primaryBall.body.setLinvel({ x: -1.8, y: 8.8, z: -56.0 }, true);
      if (slot0) {
        slot0.hasAim = true;
        slot0.aimYaw = 0;
        slot0.spikeQueued = true;
      }
      this.addImpulse(1.4);
    }
    if (t >= 44.95 && !this._goal3Scored) {
      this._goal3Scored = true;
      this.addImpulse(1.2);
      try {
        if (matchState) {
          matchState.scoreHome = 2;
          matchState.scoreAway = 1;
          matchState.targetGoal = 'S';
          matchState.celebrationTicks = 180;
          matchState.lastScoredFor = 'home';
          matchState.lastGoalId = 'N';
          matchState.events.push({ tick, goal: 'N', scoredFor: 'home', scoreHome: 2, scoreAway: 1 });
        }
      } catch (_) {}
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RALLY 4 & GOAL 4: ULTRA-LOW TURF PROFILE DIVE STRIKE (46.00s – 57.00s | 53.0s)
    // Verbs: Sideline Serve -> High Cleat Cut -> Stretch Dive Save -> South Torus Goal
    // ═════════════════════════════════════════════════════════════════════════

    if (t >= 46.00 && t < 46.15 && primaryBall?.body && athletes.length >= 2) {
      athletes[1]?.teleportTo?.({ x: 5.0, y: 0.8, z: -10.0 }, Math.PI);
      athletes[0]?.teleportTo?.({ x: 4.0, y: 0.8, z: 10.0 }, 0);
      primaryBall.body.setTranslation({ x: 5.0, y: 1.6, z: -9.2 }, true);
      primaryBall.body.setLinvel({ x: -0.5, y: 5.8, z: 16.0 }, true);
      if (slot1) slot1.spikeQueued = true;
    }
    // Stretch Dive Save at turf level
    if (t >= 51.40 && t < 51.65 && primaryBall?.body) {
      athletes[1]?.teleportTo?.({ x: 5.0, y: 0.8, z: -12.5 }, Math.PI);
      primaryBall.body.setTranslation({ x: 5.0, y: 1.0, z: -11.8 }, true);
      primaryBall.body.setLinvel({ x: -2.0, y: 8.8, z: 42.0 }, true);
      if (slot1) {
        slot1.diveQueued = true;
        slot1.hasAim = true;
        slot1.aimYaw = Math.PI;
      }
      this.addImpulse(0.85);
    }
    if (t >= 52.10 && t < 52.35 && !this._goal4Staged && primaryBall?.body) {
      this._goal4Staged = true;
      athletes[1]?.teleportTo?.({ x: 3.5, y: 1.2, z: -8.0 }, Math.PI);
      primaryBall.body.setTranslation({ x: 3.5, y: 2.2, z: -7.2 }, true);
      primaryBall.body.setLinvel({ x: -3.5, y: 9.8, z: 58.0 }, true);
      if (slot1) {
        slot1.spikeQueued = true;
        slot1.hasAim = true;
        slot1.aimYaw = Math.PI;
      }
      this.addImpulse(1.0);
    }
    if (t >= 53.00 && !this._goal4Scored) {
      this._goal4Scored = true;
      this.addImpulse(1.0);
      try {
        if (matchState) {
          matchState.scoreHome = 2;
          matchState.scoreAway = 2;
          matchState.targetGoal = 'N';
          matchState.celebrationTicks = 180;
          matchState.lastScoredFor = 'away';
          matchState.lastGoalId = 'S';
          matchState.events.push({ tick, goal: 'S', scoredFor: 'away', scoreHome: 2, scoreAway: 2 });
        }
      } catch (_) {}
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RALLY 5 & GOAL 5: BANKED WALL FLANK CARVE INTO NORTH TORUS (57.00s – 67.00s | 63.5s)
    // Verbs: Parabolic Wall Launch -> High Speed Carve -> Power Slide -> North Torus Goal
    // ═════════════════════════════════════════════════════════════════════════

    if (t >= 57.00 && t < 57.15 && primaryBall?.body && athletes.length >= 2) {
      athletes[0]?.teleportTo?.({ x: 12.0, y: 3.2, z: 5.0 }, 0);
      athletes[1]?.teleportTo?.({ x: 6.0, y: 0.9, z: -10.0 }, Math.PI);
      primaryBall.body.setTranslation({ x: 12.0, y: 3.8, z: 4.2 }, true);
      primaryBall.body.setLinvel({ x: -2.5, y: 5.5, z: -14.0 }, true);
      if (slot0) slot0.spikeQueued = true;
    }
    if (t >= 61.80 && t < 62.05 && slot0) {
      slot0.cutQueued = true;
      slot0.sprintHeld = true;
    }
    if (t >= 62.40 && t < 62.65 && !this._goal5Staged && primaryBall?.body) {
      this._goal5Staged = true;
      athletes[0]?.teleportTo?.({ x: 10.5, y: 3.2, z: 3.8 }, 0);
      primaryBall.body.setTranslation({ x: 10.5, y: 3.8, z: 3.0 }, true);
      primaryBall.body.setLinvel({ x: -6.5, y: 9.2, z: -55.0 }, true);
      if (slot0) {
        slot0.hasAim = true;
        slot0.aimYaw = -Math.PI * 0.15;
        slot0.spikeQueued = true;
      }
      this.addImpulse(1.0);
    }
    if (t >= 63.30 && !this._goal5Scored) {
      this._goal5Scored = true;
      this.addImpulse(1.0);
      try {
        if (matchState) {
          matchState.scoreHome = 3;
          matchState.scoreAway = 2;
          matchState.targetGoal = 'S';
          matchState.celebrationTicks = 180;
          matchState.lastScoredFor = 'home';
          matchState.lastGoalId = 'N';
          matchState.events.push({ tick, goal: 'N', scoredFor: 'home', scoreHome: 3, scoreAway: 2 });
        }
      } catch (_) {}
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RALLY 6 & GOAL 6: CLIMAX THROUGH-HOOP REVERSE SPIKE (67.00s – 78.40s | 73.0s)
    // Verbs: Net Aerial Clash -> Climax Spike Through Torus Ring -> Ascension
    // ═════════════════════════════════════════════════════════════════════════

    if (t >= 67.00 && t < 67.15 && primaryBall?.body && athletes.length >= 2) {
      athletes[0]?.teleportTo?.({ x: 0.0, y: 0.9, z: 2.0 }, 0);
      athletes[1]?.teleportTo?.({ x: 0.0, y: 0.9, z: -6.0 }, Math.PI);
      primaryBall.body.setTranslation({ x: 0.0, y: 1.6, z: 1.2 }, true);
      primaryBall.body.setLinvel({ x: 0.0, y: 6.2, z: -6.0 }, true);
      if (slot0) slot0.volleyQueued = true;
    }
    if (t >= 71.80 && t < 72.05 && slot0) {
      slot0.jumpQueued = true;
    }
    if (t >= 72.25 && t < 72.50 && !this._goal6Staged && primaryBall?.body) {
      this._goal6Staged = true;
      athletes[0]?.teleportTo?.({ x: 0.5, y: 3.8, z: 1.6 }, 0);
      athletes[1]?.teleportTo?.({ x: 0.5, y: 3.5, z: -2.5 }, Math.PI);
      primaryBall.body.setTranslation({ x: 0.5, y: 4.2, z: 1.0 }, true);
      primaryBall.body.setLinvel({ x: 2.5, y: 8.5, z: -58.0 }, true);
      if (slot0) {
        slot0.hasAim = true;
        slot0.aimYaw = 0;
        slot0.spikeQueued = true;
      }
      if (slot1) slot1.jumpQueued = true;
      this.addImpulse(1.2);
    }
    if (t >= 72.95 && !this._goal6Scored) {
      this._goal6Scored = true;
      this.addImpulse(1.0);
      try {
        if (matchState) {
          matchState.scoreHome = 4;
          matchState.scoreAway = 2;
          matchState.targetGoal = 'S';
          matchState.celebrationTicks = 240;
          matchState.lastScoredFor = 'home';
          matchState.lastGoalId = 'N';
          matchState.events.push({ tick, goal: 'N', scoredFor: 'home', scoreHome: 4, scoreAway: 2 });
        }
      } catch (_) {}
    }
  }

  /**
   * CINEMATIC CAMERA UPDATE PER RENDER FRAME:
   * Dynamically tracks the live action, frames Torus hoops from side/3/4 perspectives,
   * snaps hard cuts instantly, and strictly enforces >= 1.85m terrain clearance.
   */
  update(delta, liveBall = null, athletes = [], matchState = null) {
    if (!this.isActive) return;

    this.elapsedTime += delta;
    const t = this.elapsedTime;

    // Dissipate micro-shake quickly
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - delta * 12.0);
    }

    // Visibility tiers (Revision 7 - Accelerated Action):
    // 0.00s to 7.20s: Stadium reveal — hide athletes and ball (scoreboards VISIBLE from frame 0)
    // 7.20s to 11.50s: Hero ball physics reveal — show ball carving banked wall, hide athletes
    // 11.50s+: Contenders step in — show both athletes (Red vs Blue) and ball
    if (t < 7.20) {
      if (athletes) {
        for (const ath of athletes) {
          if (ath?.setEnabled) ath.setEnabled(false);
          if (ath?.ragdoll?.group) ath.ragdoll.group.visible = false;
          if (ath?.group) ath.group.visible = false;
        }
      }
      if (liveBall?.mesh) liveBall.mesh.visible = false;
      if (typeof window !== 'undefined' && window.__vb?.balls) {
        for (const b of window.__vb.balls) {
          if (b?.mesh) b.mesh.visible = false;
        }
      }
    } else if (t < 11.50) {
      if (athletes) {
        for (const ath of athletes) {
          if (ath?.setEnabled) ath.setEnabled(false);
          if (ath?.ragdoll?.group) ath.ragdoll.group.visible = false;
          if (ath?.group) ath.group.visible = false;
        }
      }
      if (liveBall?.mesh) liveBall.mesh.visible = true;
      if (typeof window !== 'undefined' && window.__vb?.balls) {
        for (const b of window.__vb.balls) {
          if (b?.mesh) b.mesh.visible = true;
        }
      }
    } else {
      if (athletes) {
        for (const ath of athletes) {
          if (ath?.setEnabled) ath.setEnabled(true);
          if (ath?.ragdoll?.group) ath.ragdoll.group.visible = true;
          if (ath?.group) ath.group.visible = true;
        }
      }
      if (liveBall?.mesh) liveBall.mesh.visible = true;
      if (typeof window !== 'undefined' && window.__vb?.balls) {
        for (const b of window.__vb.balls) {
          if (b?.mesh) b.mesh.visible = true;
        }
      }
      if (t >= 14.40 && matchState?.isCountingDown) {
        matchState.isCountingDown = false;
      }
    }

    const hoopY = TUNING.match?.hoopCenterY ?? 10.0;
    const hoopZ = TUNING.match?.hoopNorthZ ?? -40.0;

    // Sample live ball position
    let ballPos = { x: 0, y: 1.0, z: 0 };
    if (liveBall) {
      if (typeof liveBall.translation === 'function') {
        ballPos = liveBall.translation();
      } else if (liveBall.body && typeof liveBall.body.translation === 'function') {
        ballPos = liveBall.body.translation();
      } else if (liveBall.position) {
        ballPos = liveBall.position;
      }
    }

    // Sample athletes positions
    const ath0 = athletes[0]?.motor?.body?.translation?.() || ballPos;
    const ath1 = athletes[1]?.motor?.body?.translation?.() || ballPos;

    // Dynamic focal center: weighted midpoint between ball and nearest athlete
    const d0 = Math.hypot(ballPos.x - ath0.x, ballPos.z - ath0.z);
    const d1 = Math.hypot(ballPos.x - ath1.x, ballPos.z - ath1.z);
    const nearestAth = d0 <= d1 ? ath0 : ath1;
    const focusX = 0.65 * ballPos.x + 0.35 * nearestAth.x;
    const focusZ = 0.65 * ballPos.z + 0.35 * nearestAth.z;
    const focusFloorY = getCourtFloorY(focusX, focusZ);
    const focusY = Math.max(focusFloorY + 0.8, Math.min(focusFloorY + 4.5, ballPos.y));

    // If raw reel mode is active, handle dedicated angle camera and return
    if (this.rawReelMode) {
      this._updateRawReelCamera(delta, liveBall, athletes, matchState, ballPos, ath0, ath1, nearestAth, focusX, focusZ, focusFloorY, focusY, hoopY, hoopZ);
      return;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 1: ACCELERATED OVERTURE & BALL PHYSICS (0:00.0 – 14.40s)
    // ═════════════════════════════════════════════════════════════════════════

    if (t < 7.20) {
      // SHOT 1: THE TORUS FLANK & NORTH JUMBOTRON REVEAL (0.00s – 7.20s)
      this._setFov(55);
      const prog = t / 7.20;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = 17.5 - ease * 4.0;
      const camY = 11.5 - ease * 2.5;
      const camZ = -25.0 - ease * 6.0;
      this._pos.set(camX, camY, camZ);
      this._target.set(0.0, 10.5, -42.0);

    } else if (t < 14.40) {
      // SHOT 2: HERO BALL ROLLOUT & CONTENDERS ENTRANCE (7.20s – 14.40s)
      this._snapCut(1, () => {
        this._setFov(54);
      });
      const prog = (t - 7.20) / 7.20;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = 14.5 - ease * 8.5;
      const camY = 5.2 - ease * 2.2;
      const camZ = 16.0 - ease * 12.0;
      this._pos.set(camX, camY, camZ);
      this._target.set(ballPos.x * 0.7, Math.max(1.0, ballPos.y), ballPos.z);

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 2 & 3: 6-GOAL MULTI-ANGLE SHOWCASE (14.40s – 78.40s)
    // ═════════════════════════════════════════════════════════════════════════

    } else if (t < 24.00) {
      // SHOT 3: ELEVATED BROADCAST RAIL CAM — GOAL 1 (21.0s | North Torus 1-0)
      this._snapCut(2, () => {
        this._setFov(54);
        this.addImpulse(0.85);
        this._applyPalette(0, athletes);
      });

      const railX = 16.5;
      const railY = 6.2;
      const railZ = focusZ * 0.40;
      this._pos.set(railX, railY, railZ);

      if (t >= 20.20 && t < 23.50) {
        // Smoothly frame North Torus goal score and celebration
        this._target.set(0.0, 9.5, -38.0);
      } else {
        this._target.set(focusX * 0.60, 2.0, focusZ * 0.85);
      }

    } else if (t < 35.00) {
      // SHOT 4: EAST BANKED WALL LOW CAM — GOAL 2 (32.0s | South Torus 1-1)
      this._snapCut(3, () => {
        this._setFov(52);
        this.addImpulse(0.85);
        this._applyPalette(0, athletes);
      });

      const prog = (t - 24.00) / 11.00;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = 16.0 - ease * 2.0;
      const camY = 5.2 + ease * 0.6;
      const camZ = 6.0 + ease * 6.0;
      this._pos.set(camX, camY, camZ);

      if (t >= 31.00 && t < 34.00) {
        this._target.set(0.0, 9.5, 38.0);
      } else {
        this._target.set(focusX * 0.50, 2.2, focusZ * 0.80);
      }

    } else if (t < 46.00) {
      // SHOT 5: TOP-DOWN 3/4 SKY CAM — GOAL 3 (44.20s Beat Drop! | North Torus 2-1)
      this._snapCut(4, () => {
        this._setFov(62);
        this.addImpulse(0.9);
        this._applyPalette(0, athletes);
      });

      const prog = (t - 35.00) / 11.00;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = 8.0 - ease * 4.0;
      const camY = 14.5 - ease * 1.5;
      const camZ = -12.0 - ease * 4.0;
      this._pos.set(camX, camY, camZ);
      this._target.set(0.0, 8.5, -38.0);

    } else if (t < 57.00) {
      // SHOT 6: ULTRA-LOW TURF PROFILE CAM — GOAL 4 (53.0s | South Torus 2-2)
      this._snapCut(5, () => {
        this._setFov(48);
        this.addImpulse(0.85);
        this._applyPalette(0, athletes);
      });

      const camX = 7.5;
      const camY = 1.85;
      const camZ = 22.0;
      this._pos.set(camX, camY, camZ);

      if (t >= 52.00 && t < 55.50) {
        this._target.set(0.0, 9.5, 38.0);
      } else {
        this._target.set(focusX * 0.50, 1.8, focusZ * 0.80);
      }

    } else if (t < 67.00) {
      // SHOT 7: FLANK 3/4 MID-COURT CAM — GOAL 5 (63.5s | North Torus 3-2)
      this._snapCut(6, () => {
        this._setFov(52);
        this.addImpulse(0.85);
        this._applyPalette(0, athletes);
      });

      const prog = (t - 57.00) / 10.00;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = 17.0 - ease * 2.0;
      const camY = 7.5 + ease * 0.5;
      const camZ = -26.0 - ease * 4.0;
      this._pos.set(camX, camY, camZ);
      this._target.set(0.0, 9.2, -40.0);

    } else if (t < 78.40) {
      // SHOT 8: THROUGH-HOOP 3/4 FRAMING CAM — GOAL 6 (73.0s Climax! | North Torus 4-2)
      // Positioned on East flank looking cleanly through Torus aperture with zero pillar obstruction
      this._snapCut(7, () => {
        this._setFov(56);
        this.addImpulse(1.0);
        this._applyPalette(0, athletes);
      });

      const prog = (t - 67.00) / 11.40;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = 13.0 - ease * 2.5;
      const camY = 8.5 + ease * 0.5;
      const camZ = -33.0 - ease * 3.0;
      this._pos.set(camX, camY, camZ);
      this._target.set(-2.0, 8.8, -41.0);

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 4: CELESTIAL ASCENSION ARC (78.40s – 83.80s)
    // ═════════════════════════════════════════════════════════════════════════

    } else if (t < 83.80) {
      // SHOT 9: CELESTIAL ASCENSION ARC
      this._snapCut(8, () => {
        this._setFov(66);
      });

      const prog = (t - 78.40) / 5.40;
      const ease = prog * prog * (3 - 2 * prog);
      const rad = 22.0 + ease * 18.0;
      const angle = -Math.PI * 0.25 + ease * 0.6;
      const camY = 16.0 + ease * 24.0;
      this._pos.set(rad * Math.sin(angle), camY, rad * Math.cos(angle));
      this._target.set(0, 2.0, 0);

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 5: GALAXY TITLE CARD OUTRO (83.80s – 94.50s)
    // ═════════════════════════════════════════════════════════════════════════

    } else {
      this._pos.set(0, 45.0, -10.0);
      this._target.set(0, 0, -40.0);
    }

    this._applyResilientClearance();
  }

  _setFov(fov) {
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  _snapCut(cutIndex, onCutCallback = null) {
    if (this._currentCut !== cutIndex) {
      this._currentCut = cutIndex;
      if (typeof onCutCallback === 'function') {
        onCutCallback();
      }
    }
  }

  _applyPalette(idx, athletes = []) {
    // Strictly preserve default Red (Home 0xD90429) vs Blue (Away 0x1D4ED8) across all trailer shots
    const pal = this._palettes[0];
    try {
      if (athletes[0]?.setTeamAndVariant) {
        athletes[0].setTeamAndVariant('home', pal.homeVariant, { primaryColor: pal.homeColor });
      }
      if (athletes[1]?.setTeamAndVariant) {
        athletes[1].setTeamAndVariant('away', pal.awayVariant, { primaryColor: pal.awayColor });
      }
    } catch (_) {}
  }

  _applyResilientClearance() {
    const floorY = getCourtFloorY(this._pos.x, this._pos.z);
    this._pos.y = Math.max(this._pos.y, floorY + 1.85);

    const targetFloorY = getCourtFloorY(this._target.x, this._target.z);
    this._target.y = Math.max(this._target.y, targetFloorY + 0.6);

    this.camera.position.copy(this._pos);

    if (this.trauma > 0) {
      const shake = this.trauma * this.trauma * 0.08;
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }

    this.camera.lookAt(this._target);
  }

  _choreographRawReelTick(tick, dt, athletes = [], balls = [], matchState = null) {
    const t = this.elapsedTime;
    const primaryBall = balls[0] || null;
    const slot0 = getBotSlot(0);
    const slot1 = getBotSlot(1);

    // Keep both AI bots sprinting with full drive
    if (slot0) slot0.sprintHeld = true;
    if (slot1) slot1.sprintHeld = true;

    if (!primaryBall?.body || athletes.length < 2) return;

    const bP = primaryBall.body.translation();
    const a0P = athletes[0]?.motor?.body?.translation();
    const a1P = athletes[1]?.motor?.body?.translation();

    if (this.stuntType === 'dive') {
      if (t >= 0.8 && !this._stuntTriggered && a1P) {
        const dx = bP.x - a1P.x;
        const dz = bP.z - a1P.z;
        const dist = Math.hypot(dx, dz);
        if (slot1) {
          slot1.moveWorld.set(dx / (dist || 1), 0, dz / (dist || 1));
          slot1.moveX = slot1.moveWorld.x;
          slot1.moveZ = slot1.moveWorld.z;
          if (dist <= 3.5 && dist >= 0.8) {
            this._stuntTriggered = true;
            slot1.diveQueued = true;
            const aimYaw = Math.atan2(dx, dz);
            slot1.aimYaw = aimYaw;
            slot1.cameraYaw = aimYaw;
            slot1.hasAim = true;
          }
        }
      }
    } else if (this.stuntType === 'slide') {
      if (t >= 0.8 && !this._stuntTriggered && a0P) {
        const dx = bP.x - a0P.x;
        const dz = bP.z - a0P.z;
        const dist = Math.hypot(dx, dz);
        if (slot0) {
          slot0.moveWorld.set(dx / (dist || 1), 0, dz / (dist || 1));
          slot0.moveX = slot0.moveWorld.x;
          slot0.moveZ = slot0.moveWorld.z;
          if (dist <= 4.2) {
            this._stuntTriggered = true;
            slot0.slideHeld = true;
            slot0.volleyQueued = true;
            const aimYaw = Math.atan2(dx, dz);
            slot0.aimYaw = aimYaw;
            slot0.cameraYaw = aimYaw;
            slot0.hasAim = true;
          }
        }
      }
    } else if (this.stuntType === 'cut') {
      if (t >= 0.8 && !this._stuntTriggered && a0P) {
        if (slot0) {
          this._stuntTriggered = true;
          slot0.cutQueued = true;
        }
      }
    } else if (this.stuntType === 'spike') {
      if (t >= 0.8 && !this._stuntTriggered && a0P) {
        const dx = bP.x - a0P.x;
        const dz = bP.z - a0P.z;
        const dist = Math.hypot(dx, dz);
        if (slot0) {
          slot0.moveWorld.set(dx / (dist || 1), 0, dz / (dist || 1));
          if (dist <= 2.2) {
            this._stuntTriggered = true;
            slot0.jumpQueued = true;
            slot0.spikeQueued = true;
            const aimYaw = Math.atan2(dx, dz);
            slot0.aimYaw = aimYaw;
            slot0.cameraYaw = aimYaw;
            slot0.hasAim = true;
          }
        }
      }
    } else if (this.stuntType === 'goal') {
      if (t >= 0.8 && !this._goalStaged && a0P) {
        const dx = bP.x - a0P.x;
        const dz = bP.z - a0P.z;
        const dist = Math.hypot(dx, dz);
        if (slot0) {
          slot0.moveWorld.set(dx / (dist || 1), 0, dz / (dist || 1));
          if (dist <= 2.0) {
            this._goalStaged = true;
            slot0.jumpQueued = true;
            slot0.spikeQueued = true;
            const goalYaw = Math.atan2(0.0 - a0P.x, -40.0 - a0P.z);
            slot0.aimYaw = goalYaw;
            slot0.cameraYaw = goalYaw;
            slot0.hasAim = true;
          }
        }
      }
    }
  }

  _updateRawReelCamera(delta, liveBall, athletes, matchState, ballPos, ath0, ath1, nearestAth, focusX, focusZ, focusFloorY, focusY, hoopY, hoopZ) {
    const t = this.elapsedTime;
    const dur = Math.max(1.0, this.rawDuration);
    const prog = Math.min(1.0, t / dur);
    const ease = prog * prog * (3 - 2 * prog);

    const ath = nearestAth;
    const athFloor = getCourtFloorY(ath.x, ath.z);
    const toB_x = ballPos.x - ath.x;
    const toB_z = ballPos.z - ath.z;
    const dist = Math.hypot(toB_x, toB_z) || 1.0;
    const ndx = toB_x / dist;
    const ndz = toB_z / dist;
    const perpX = -ndz;
    const perpZ = ndx;

    switch (this.rawReelMode) {
      case 'flank_torus_north': {
        this._setFov(48);
        const camX = 16.0 - ease * 2.0;
        const camY = Math.max(7.5, getCourtFloorY(camX, -22.0) + 3.0);
        const camZ = -22.0 - ease * 4.0;
        this._pos.set(camX, camY, camZ);
        this._target.set(0.3 * focusX, 0.4 * focusY + 0.6 * hoopY, 0.4 * focusZ + 0.6 * hoopZ);
        break;
      }
      case 'flank_torus_south': {
        this._setFov(48);
        const camX = -16.0 + ease * 2.0;
        const camY = Math.max(7.5, getCourtFloorY(camX, 22.0) + 3.0);
        const camZ = 22.0 + ease * 4.0;
        this._pos.set(camX, camY, camZ);
        this._target.set(0.3 * focusX, 0.4 * focusY + 0.6 * hoopY, 0.4 * focusZ + 0.6 * (-hoopZ));
        break;
      }
      case 'low_turf_tracking': {
        this._setFov(48);
        const sideSign = (focusX >= 0) ? 1.0 : -1.0;
        const camX = focusX + sideSign * 5.2;
        const camZ = focusZ - 2.8;
        const camY = Math.max(focusFloorY + 1.85, getCourtFloorY(camX, camZ) + 1.85);
        this._pos.set(camX, camY, camZ);
        this._target.set(focusX, focusFloorY + 1.1, focusZ);
        break;
      }
      case 'over_shoulder_chase': {
        this._setFov(48);
        const athF = getCourtFloorY(ath.x, ath.z);
        let dirX = ballPos.x - ath.x;
        let dirZ = ballPos.z - ath.z;
        let dLen = Math.hypot(dirX, dirZ);
        if (dLen < 0.5) { dirZ = (ath.z >= 0) ? -1.0 : 1.0; dirX = 0.0; dLen = 1.0; }
        const ndx = dirX / dLen;
        const ndz = dirZ / dLen;
        const camX = ath.x - ndx * 3.2 - ndz * 0.6;
        const camZ = ath.z - ndz * 3.2 + ndx * 0.6;
        const camY = Math.max(athF + 1.95, getCourtFloorY(camX, camZ) + 1.85);
        this._pos.set(camX, camY, camZ);
        this._target.set(focusX, focusFloorY + 1.1, focusZ);
        break;
      }
      case 'vertical_spike_cam': {
        this._setFov(52);
        const sideX = (focusX >= 0) ? -3.5 : 3.5;
        const camX = focusX + sideX;
        const camZ = focusZ - 3.2;
        const camY = Math.max(focusFloorY + 1.85, getCourtFloorY(camX, camZ) + 1.85);
        this._pos.set(camX, camY, camZ);
        this._target.set(focusX, Math.max(focusFloorY + 2.0, Math.min(focusFloorY + 4.5, ballPos.y + 0.6)), focusZ);
        break;
      }
      case 'banked_wall_curve': {
        this._setFov(52);
        const wallSign = (focusX >= 0) ? 1.0 : -1.0;
        const camX = focusX + wallSign * 4.8;
        const camZ = focusZ + 3.2;
        const camY = Math.max(focusFloorY + 2.8, getCourtFloorY(camX, camZ) + 1.85);
        this._pos.set(camX, camY, camZ);
        this._target.set(focusX, focusFloorY + 1.0, focusZ);
        break;
      }
      case 'action_orbit':
      default: {
        this._setFov(50);
        const orbitAngle = t * 1.6 + 0.5;
        const camDist = 4.8;
        const camX = focusX + camDist * Math.sin(orbitAngle);
        const camZ = focusZ + camDist * Math.cos(orbitAngle);
        const camY = Math.max(focusFloorY + 2.2, getCourtFloorY(camX, camZ) + 1.85);
        this._pos.set(camX, camY, camZ);
        this._target.set(focusX, Math.max(focusFloorY + 1.0, Math.min(focusFloorY + 3.2, ballPos.y)), focusZ);
        break;
      }
    }

    this._applyResilientClearance();
  }
}

export const trailerDirector = new TrailerDirector();
