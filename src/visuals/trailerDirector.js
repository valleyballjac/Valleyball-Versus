import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { soundManager } from '../audio/soundManager.js';
import { getBotSlot } from '../input/inputRouter.js';
import { getCourtFloorY } from '../ai/courtHeightmap.js';

// Raw reel camera easing rates (1/s): position trails like a camera operator,
// aim leads it so fast strikes stay in frame.
const RAW_CAM_POS_RATE = 4.0;
const RAW_CAM_TARGET_RATE = 8.0;

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
    this._smoothPos = new THREE.Vector3();
    this._smoothTarget = new THREE.Vector3();
    this._smoothFocusX = 0;
    this._smoothFocusZ = 0;
    this._initializedFocus = false;
    this._justCut = true;
    this._ballSmoothPos = new THREE.Vector3(0, 1.0, 0);

    // Raw reel camera, eased toward each frame's framing instead of snapped to it
    this._rawCamPos = new THREE.Vector3();
    this._rawCamTarget = new THREE.Vector3();
    this._rawCamPrimed = false;

    // Camera micro-shake on heavy impacts (positional only, NEVER touches FOV)
    this.trauma = 0.0;

    // Directorial state tracking
    this._currentCut = -1;
    this._staccatoSubIndex = -1;
    this._goalTriggered = false;
    this._goalStaged = false;
    this._kickoffTriggered = false;

    // Brand Dictionary palette pairings with Series 1 Headwear
    // Default (idx 0) is classic Red (Football Helmet / wrestler_bands) vs Blue (Cricket Helmet / wicket_grill)
    this._palettes = [
      { name: 'ClassicRedBlue', homeColor: 0xD90429, awayColor: 0x1D4ED8, homeVariant: 'masculine', awayVariant: 'masculine', homeHeadwear: 'wrestler_bands', awayHeadwear: 'wicket_grill' },
      { name: 'VoltGold', homeColor: 0xFFD000, awayColor: 0x8B5CF6, homeVariant: 'masculine', awayVariant: 'feminine', homeHeadwear: 'sensor_visor', awayHeadwear: 'couture_wrap' },
      { name: 'IonCyan', homeColor: 0x00E5FF, awayColor: 0xD90429, homeVariant: 'feminine', awayVariant: 'classic', homeHeadwear: 'rigger_band', awayHeadwear: 'ouendan_knot' },
      { name: 'Emerald', homeColor: 0x10E56A, awayColor: 0xFF6B00, homeVariant: 'classic', awayVariant: 'masculine', homeHeadwear: 'terrace_visor', awayHeadwear: 'cursor_cap' },
      { name: 'Obsidian', homeColor: 0x0A0A0C, awayColor: 0xFFFFFF, homeVariant: 'masculine', awayVariant: 'feminine', homeHeadwear: 'manager_cap', awayHeadwear: 'broadcaster_mic' },
      { name: 'RoyalBlue', homeColor: 0x1D4ED8, awayColor: 0xFF6B00, homeVariant: 'feminine', awayVariant: 'classic', homeHeadwear: 'wicket_grill', awayHeadwear: 'wrestler_bands' },
      { name: 'DeepIndigo', homeColor: 0x6B11FF, awayColor: 0xFFD000, homeVariant: 'masculine', awayVariant: 'feminine', homeHeadwear: 'couture_wrap', awayHeadwear: 'sensor_visor' },
      { name: 'SolarBlaze', homeColor: 0xFF6B00, awayColor: 0x00E5FF, homeVariant: 'classic', awayVariant: 'masculine', homeHeadwear: 'cursor_cap', awayHeadwear: 'rigger_band' },
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
    this._introAthletesPositioned = false;
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
    this._smoothPos.set(0, 0, 0);
    this._smoothTarget.set(0, 0, 0);
    this._smoothFocusX = 0;
    this._smoothFocusZ = 0;
    this._initializedFocus = false;
    this._justCut = true;

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
    this._rawCamPrimed = false;

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

    // 0.00s to 11.50s: Athletes positioned at starting marks, Red in Football Helmet, Blue in Cricket Helmet
    if (t < 11.50 && athletes.length >= 2) {
      if (!this._introAthletesPositioned) {
        this._introAthletesPositioned = true;
        athletes[0]?.teleportTo?.({ x: 0.0, y: 0.9, z: 6.0 }, Math.PI);
        athletes[1]?.teleportTo?.({ x: 0.0, y: 0.9, z: -8.0 }, 0);
        this._applyPalette(0, athletes);
      }
      if (athletes[0]?.motor?.body) athletes[0].motor.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      if (athletes[1]?.motor?.body) athletes[1].motor.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }

    // Zero out movement inputs before 14.40s so contenders hold a proud, composed ready stance
    if (t < 14.40) {
      if (slot0) {
        slot0.moveX = 0;
        slot0.moveZ = 0;
        slot0.sprintHeld = false;
        slot0.slideHeld = false;
        slot0.jumpQueued = false;
      }
      if (slot1) {
        slot1.moveX = 0;
        slot1.moveZ = 0;
        slot1.sprintHeld = false;
        slot1.slideHeld = false;
        slot1.jumpQueued = false;
      }
    }

    // 0.00s to 7.20s: Ball held stationary out of play during macro contender reveals
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
    // RALLY 1 & GOAL 1: KICKOFF TO NORTH TORUS SPIKE (14.40s – 24.00s | 20.8s)
    // Verbs: Kickoff Serve -> Power Slide Dig -> Cleat Cut -> Jump Spike Goal
    // ═════════════════════════════════════════════════════════════════════════

    // Hit 1: Kickoff Serve (14.40s) — Home Bot (Red) strikes across net
    if (t >= 14.40 && t < 14.55 && !this._rally1Serve && primaryBall?.body) {
      this._rally1Serve = true;
      if (matchState) matchState.targetGoal = 'N';
      athletes[0]?.teleportTo?.({ x: 0.0, y: 0.9, z: 6.0 }, 0);
      athletes[1]?.teleportTo?.({ x: 0.0, y: 0.9, z: -10.0 }, Math.PI);
      primaryBall.body.setTranslation({ x: 0.0, y: 1.6, z: 5.2 }, true);
      primaryBall.body.setLinvel({ x: 0.0, y: 6.5, z: -15.0 }, true);
      if (slot0) {
        slot0.hasAim = true;
        slot0.aimYaw = 0;
        slot0.spikeQueued = true;
      }
      this.addImpulse(0.85);
    }

    // Away Bot (Blue) power slide dig at 17.20s: pops ball toward East flank
    if (t >= 17.15 && t < 17.35 && !this._rally1Dig && primaryBall?.body) {
      this._rally1Dig = true;
      primaryBall.body.setLinvel({ x: 3.5, y: 8.5, z: -7.0 }, true);
      if (slot1) {
        slot1.sprintHeld = true;
        slot1.slideHeld = true;
        slot1.volleyQueued = true;
        slot1.aimYaw = -Math.PI * 0.25;
        slot1.hasAim = true;
      }
      this.addImpulse(0.75);
    }

    // Home Bot (Red) cleat cut and aerial jump-spike into North Torus (20.00s -> 20.30s)
    if (t >= 19.60 && t < 19.80 && slot0) {
      slot0.cutQueued = true;
      slot0.sprintHeld = true;
    }
    if (t >= 19.85 && t < 20.05 && slot0) {
      slot0.jumpQueued = true;
    }
    if (t >= 20.25 && t < 20.45 && !this._goal1Staged && primaryBall?.body) {
      this._goal1Staged = true;
      if (athletes[0]?.motor?.body) {
        athletes[0].motor.body.setTranslation({ x: 5.0, y: 4.8, z: -25.0 }, true);
        athletes[0].motor.body.setLinvel({ x: 0, y: 1.5, z: 0 }, true);
        if (athletes[0].motor.interpolated) athletes[0].motor.interpolated.reset(new THREE.Vector3(5.0, 4.8, -25.0));
      }
      primaryBall.body.setTranslation({ x: 5.0, y: 5.2, z: -25.0 }, true);
      // Clean launch through North Torus aperture (crosses X=0 at Y=10.26, Z=-40.00, clearance > 4.4m)
      primaryBall.body.setLinvel({ x: -9.09, y: 12.94, z: -27.27 }, true);
      if (slot0) {
        slot0.hasAim = true;
        slot0.aimYaw = Math.atan2(-9.09, -27.27);
        slot0.spikeQueued = true;
      }
      this.addImpulse(1.0);
    }
    if (t >= 20.80 && !this._goal1Scored) {
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
        }
      } catch (_) {}
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RALLY 2 & GOAL 2: BANKED WALL COUNTER INTO SOUTH TORUS (24.00s – 35.00s | 31.7s)
    // Verbs: Flank Serve -> Parabolic Wall Carve -> Cleat Cut -> Jump Spike Goal
    // ═════════════════════════════════════════════════════════════════════════

    if (t >= 24.00 && t < 24.15 && primaryBall?.body && athletes.length >= 2) {
      if (matchState) matchState.targetGoal = 'S';
      athletes[1]?.teleportTo?.({ x: -6.0, y: 1.0, z: -8.0 }, Math.PI);
      athletes[0]?.teleportTo?.({ x: 8.0, y: 1.2, z: 12.0 }, 0);
      primaryBall.body.setTranslation({ x: -6.0, y: 1.6, z: -7.2 }, true);
      primaryBall.body.setLinvel({ x: 6.0, y: 7.0, z: 18.0 }, true);
      if (slot1) {
        slot1.hasAim = true;
        slot1.aimYaw = Math.PI * 0.25;
        slot1.spikeQueued = true;
      }
    }
    // Home Bot power slide along the banked turf wall
    if (t >= 27.60 && t < 27.85 && primaryBall?.body) {
      primaryBall.body.setLinvel({ x: -13.0, y: 8.5, z: 12.0 }, true);
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
    if (t >= 31.15 && t < 31.35 && !this._goal2Staged && primaryBall?.body) {
      this._goal2Staged = true;
      if (athletes[1]?.motor?.body) {
        athletes[1].motor.body.setTranslation({ x: -7.2, y: 6.8, z: 31.0 }, true);
        athletes[1].motor.body.setLinvel({ x: 0, y: 1.5, z: 0 }, true);
        if (athletes[1].motor.interpolated) athletes[1].motor.interpolated.reset(new THREE.Vector3(-7.2, 6.8, 31.0));
      }
      primaryBall.body.setTranslation({ x: -7.2, y: 7.5, z: 31.0 }, true);
      // Clean launch through South Torus aperture (crosses X=0 at Y=10.36, Z=+40.00, clearance > 4.3m)
      primaryBall.body.setLinvel({ x: 14.4, y: 9.0, z: 18.0 }, true);
      if (slot1) {
        slot1.spikeQueued = true;
        slot1.hasAim = true;
        slot1.aimYaw = Math.atan2(14.4, 18.0);
      }
      this.addImpulse(1.0);
    }
    if (t >= 31.75 && !this._goal2Scored) {
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
        }
      } catch (_) {}
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RALLY 3 & GOAL 3: TOP-DOWN SKY CAM BEAT DROP SPIKE (35.00s – 46.00s | 44.20s DROP!)
    // Verbs: Kickoff -> Midcourt Volley Exchange -> Sprint Duel -> APEX SPIKE DROP
    // ═════════════════════════════════════════════════════════════════════════

    if (t >= 35.00 && t < 35.15 && primaryBall?.body && athletes.length >= 2) {
      if (matchState) matchState.targetGoal = 'N';
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
      primaryBall.body.setLinvel({ x: 0.5, y: 6.5, z: 10.0 }, true);
      if (slot1) {
        slot1.volleyQueued = true;
        slot1.hasAim = true;
        slot1.aimYaw = Math.PI;
      }
    }
    // High set above net leading directly into the beat drop
    if (t >= 42.20 && t < 42.40 && primaryBall?.body) {
      primaryBall.body.setLinvel({ x: 6.0, y: 9.5, z: -14.0 }, true);
      if (slot1) slot1.volleyQueued = true;
    }
    // Leaping into the air at 43.6s
    if (t >= 43.60 && t < 43.80 && slot0) {
      slot0.jumpQueued = true;
      slot0.sprintHeld = true;
    }
    // AT EXACTLY 44.15s: BEAT DROP DETONATION!
    if (t >= 44.15 && t < 44.30 && !this._goal3Staged && primaryBall?.body) {
      this._goal3Staged = true;
      if (athletes[0]?.motor?.body) {
        athletes[0].motor.body.setTranslation({ x: 6.5, y: 7.2, z: -32.0 }, true);
        athletes[0].motor.body.setLinvel({ x: 0, y: 2.0, z: 0 }, true);
        if (athletes[0].motor.interpolated) athletes[0].motor.interpolated.reset(new THREE.Vector3(6.5, 7.2, -32.0));
      }
      primaryBall.body.setTranslation({ x: 6.5, y: 7.8, z: -32.0 }, true);
      // Clean launch through North Torus aperture (crosses X=0 at Y=10.38, Z=-40.00, clearance > 4.3m)
      primaryBall.body.setLinvel({ x: -13.0, y: 8.4, z: -16.0 }, true);
      if (slot0) {
        slot0.hasAim = true;
        slot0.aimYaw = Math.atan2(-13.0, -16.0);
        slot0.spikeQueued = true;
      }
      this.addImpulse(1.4);
    }
    if (t >= 44.70 && !this._goal3Scored) {
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
        }
      } catch (_) {}
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RALLY 4 & GOAL 4: ULTRA-LOW TURF PROFILE DIVE STRIKE (46.00s – 57.00s | 52.7s)
    // Verbs: Sideline Serve -> High Cleat Cut -> Stretch Dive Save -> South Torus Goal
    // ═════════════════════════════════════════════════════════════════════════

    if (t >= 46.00 && t < 46.15 && primaryBall?.body && athletes.length >= 2) {
      if (matchState) matchState.targetGoal = 'S';
      athletes[1]?.teleportTo?.({ x: 4.5, y: 0.9, z: -10.0 }, Math.PI);
      athletes[0]?.teleportTo?.({ x: 4.5, y: 0.9, z: 10.0 }, 0);
      primaryBall.body.setTranslation({ x: 4.5, y: 1.6, z: -9.2 }, true);
      primaryBall.body.setLinvel({ x: 0.5, y: 6.0, z: 18.0 }, true);
      if (slot1) slot1.spikeQueued = true;
    }
    // Stretch Dive Save at turf level
    if (t >= 51.40 && t < 51.65 && primaryBall?.body) {
      if (slot1) {
        slot1.diveQueued = true;
        slot1.hasAim = true;
        slot1.aimYaw = Math.PI;
      }
      this.addImpulse(0.85);
    }
    if (t >= 52.15 && t < 52.35 && !this._goal4Staged && primaryBall?.body) {
      this._goal4Staged = true;
      if (athletes[1]?.motor?.body) {
        athletes[1].motor.body.setTranslation({ x: 6.0, y: 6.8, z: 31.0 }, true);
        if (athletes[1].motor.interpolated) athletes[1].motor.interpolated.reset(new THREE.Vector3(6.0, 6.8, 31.0));
      }
      primaryBall.body.setTranslation({ x: 6.0, y: 7.5, z: 31.0 }, true);
      // Clean launch through South Torus aperture (crosses X=0 at Y=10.37, Z=+40.00, clearance > 4.3m)
      primaryBall.body.setLinvel({ x: -12.0, y: 9.0, z: 18.0 }, true);
      if (slot1) {
        slot1.spikeQueued = true;
        slot1.hasAim = true;
        slot1.aimYaw = Math.atan2(-12.0, 18.0);
      }
      this.addImpulse(1.0);
    }
    if (t >= 52.75 && !this._goal4Scored) {
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
        }
      } catch (_) {}
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RALLY 5 & GOAL 5: BANKED WALL FLANK CARVE INTO NORTH TORUS (57.00s – 67.00s | 63.0s)
    // Verbs: Parabolic Wall Launch -> High Speed Carve -> Power Slide -> North Torus Goal
    // ═════════════════════════════════════════════════════════════════════════

    if (t >= 57.00 && t < 57.15 && primaryBall?.body && athletes.length >= 2) {
      if (matchState) matchState.targetGoal = 'N';
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
    if (t >= 62.45 && t < 62.65 && !this._goal5Staged && primaryBall?.body) {
      this._goal5Staged = true;
      if (athletes[0]?.motor?.body) {
        athletes[0].motor.body.setTranslation({ x: -7.5, y: 6.5, z: -30.0 }, true);
        if (athletes[0].motor.interpolated) athletes[0].motor.interpolated.reset(new THREE.Vector3(-7.5, 6.5, -30.0));
      }
      primaryBall.body.setTranslation({ x: -7.5, y: 7.5, z: -30.0 }, true);
      // Clean launch through North Torus aperture (crosses X=0 at Y=10.35, Z=-40.00, clearance > 4.3m)
      primaryBall.body.setLinvel({ x: 15.0, y: 9.0, z: -20.0 }, true);
      if (slot0) {
        slot0.hasAim = true;
        slot0.aimYaw = Math.atan2(15.0, -20.0);
        slot0.spikeQueued = true;
      }
      this.addImpulse(1.0);
    }
    if (t >= 63.05 && !this._goal5Scored) {
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
        }
      } catch (_) {}
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RALLY 6 & GOAL 6: CLIMAX THROUGH-HOOP REVERSE SPIKE (67.00s – 78.40s | 72.7s)
    // Verbs: Net Aerial Clash -> Climax Spike Through Torus Ring -> Ascension
    // ═════════════════════════════════════════════════════════════════════════

    if (t >= 67.00 && t < 67.15 && primaryBall?.body && athletes.length >= 2) {
      if (matchState) matchState.targetGoal = 'N';
      athletes[0]?.teleportTo?.({ x: 0.0, y: 0.9, z: 2.0 }, 0);
      athletes[1]?.teleportTo?.({ x: 0.0, y: 0.9, z: -4.0 }, Math.PI);
      primaryBall.body.setTranslation({ x: 0.0, y: 1.6, z: 1.2 }, true);
      primaryBall.body.setLinvel({ x: 0.0, y: 6.2, z: -6.0 }, true);
      if (slot0) slot0.volleyQueued = true;
    }
    if (t >= 71.60 && t < 71.85 && slot0) {
      slot0.jumpQueued = true;
      slot0.sprintHeld = true;
    }
    if (t >= 72.15 && t < 72.35 && !this._goal6Staged && primaryBall?.body) {
      this._goal6Staged = true;
      if (athletes[0]?.motor?.body) {
        athletes[0].motor.body.setTranslation({ x: 6.0, y: 7.2, z: -31.0 }, true);
        athletes[0].motor.body.setLinvel({ x: 0, y: 1.5, z: 0 }, true);
        if (athletes[0].motor.interpolated) athletes[0].motor.interpolated.reset(new THREE.Vector3(6.0, 7.2, -31.0));
      }
      if (athletes[1]?.motor?.body) {
        athletes[1].motor.body.setTranslation({ x: -2.0, y: 7.5, z: -38.0 }, true);
        athletes[1].motor.body.setLinvel({ x: 2.0, y: 1.0, z: 0 }, true);
        if (athletes[1].motor.interpolated) athletes[1].motor.interpolated.reset(new THREE.Vector3(-2.0, 7.5, -38.0));
      }
      primaryBall.body.setTranslation({ x: 6.0, y: 7.8, z: -31.0 }, true);
      // Clean launch through North Torus aperture (crosses X=0 at Y=10.37, Z=-40.00, clearance > 4.3m)
      primaryBall.body.setLinvel({ x: -12.0, y: 8.4, z: -18.0 }, true);
      if (slot0) {
        slot0.hasAim = true;
        slot0.aimYaw = Math.atan2(-12.0, -18.0);
        slot0.spikeQueued = true;
      }
      if (slot1) slot1.jumpQueued = true;
      this.addImpulse(1.2);
    }
    if (t >= 72.75 && !this._goal6Scored) {
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

    // Visibility tiers (Revision 8 - Contender Character Hooks & Real Action):
    // 0.00s to 7.20s: Macro portraits of contenders — Red in Football Helmet, Blue in Cricket Helmet
    // 7.20s to 11.50s: Hero ball physics reveal — show ball carving banked wall
    // 11.50s+: Contenders face-off across net and full match action
    // Raw reel clips (6.8s) skip the tiers, which hide the ball until 7.20s.
    if (this.rawReelMode) {
      // fall through to the raw reel camera below
    } else if (t < 7.20) {
      if (athletes) {
        for (const ath of athletes) {
          if (ath?.setEnabled) ath.setEnabled(true);
          if (ath?.ragdoll?.group) ath.ragdoll.group.visible = true;
          if (ath?.group) ath.group.visible = true;
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

    // Dynamic focal center: continuous inverse-distance weighted midpoint between ball and athletes
    const d0 = Math.hypot(ballPos.x - ath0.x, ballPos.z - ath0.z);
    const d1 = Math.hypot(ballPos.x - ath1.x, ballPos.z - ath1.z);
    const w0 = 1.0 / (d0 * d0 + 1.0);
    const w1 = 1.0 / (d1 * d1 + 1.0);
    const wSum = w0 + w1;
    const athBlendX = (ath0.x * w0 + ath1.x * w1) / wSum;
    const athBlendZ = (ath0.z * w0 + ath1.z * w1) / wSum;
    const rawFocusX = 0.65 * ballPos.x + 0.35 * athBlendX;
    const rawFocusZ = 0.65 * ballPos.z + 0.35 * athBlendZ;

    const smoothFactor = 1.0 - Math.exp(-delta * 8.0);
    if (!this._initializedFocus) {
      this._smoothFocusX = rawFocusX;
      this._smoothFocusZ = rawFocusZ;
      this._initializedFocus = true;
    } else {
      this._smoothFocusX += (rawFocusX - this._smoothFocusX) * smoothFactor;
      this._smoothFocusZ += (rawFocusZ - this._smoothFocusZ) * smoothFactor;
    }
    const focusX = this._smoothFocusX;
    const focusZ = this._smoothFocusZ;
    const focusFloorY = getCourtFloorY(focusX, focusZ);
    const focusY = Math.max(focusFloorY + 0.8, Math.min(focusFloorY + 4.5, ballPos.y));
    const nearestAth = d0 <= d1 ? ath0 : ath1;

    // If raw reel mode is active, handle dedicated angle camera and return
    if (this.rawReelMode) {
      this._updateRawReelCamera(delta, liveBall, athletes, matchState, ballPos, ath0, ath1, nearestAth, focusX, focusZ, focusFloorY, focusY, hoopY, hoopZ);
      return;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 1: ACCELERATED OVERTURE & CONTENDER REVEALS (0:00.0 – 14.40s)
    // ═════════════════════════════════════════════════════════════════════════

    if (t < 3.60) {
      // SHOT 1: MACRO PORTRAIT — HOME RED CONTENDER (Football Helmet / wrestler_bands)
      this._snapCut(0, () => {
        this._setFov(38);
        this._applyPalette(0, athletes);
      });
      const prog = t / 3.60;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = 0.40 - ease * 0.15;
      const camY = 1.70 + ease * 0.05;
      const camZ = 3.9 + ease * 0.30;
      this._pos.set(camX, camY, camZ);
      this._target.set(0.0, 2.05, 6.0);

    } else if (t < 7.20) {
      // SHOT 2: REVERSE MACRO PORTRAIT — AWAY BLUE CONTENDER (Cricket Helmet / wicket_grill)
      this._snapCut(1, () => {
        this._setFov(38);
        this._applyPalette(0, athletes);
      });
      const prog = (t - 3.60) / 3.60;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = -0.40 + ease * 0.15;
      const camY = 1.70 + ease * 0.05;
      const camZ = -5.9 - ease * 0.30;
      this._pos.set(camX, camY, camZ);
      this._target.set(0.0, 2.05, -8.0);

    } else if (t < 11.50) {
      // SHOT 3: HERO BALL ROLLOUT CURVING DOWN EAST BANKED WALL
      this._snapCut(2, () => {
        this._setFov(50);
      });
      const prog = (t - 7.20) / 4.30;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = 11.5 - ease * 4.5;
      const camY = 3.6 - ease * 1.2;
      const camZ = 14.0 - ease * 7.0;
      this._pos.set(camX, camY, camZ);
      this._target.set(ballPos.x * 0.85, Math.max(0.8, ballPos.y), ballPos.z);

    } else if (t < 14.40) {
      // SHOT 4: MIDCOURT FACEOFF ACROSS NET
      this._snapCut(3, () => {
        this._setFov(50);
      });
      const prog = (t - 11.50) / 2.90;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = 7.0 - ease * 1.2;
      const camY = 2.0 + ease * 0.2;
      const camZ = 0.0 + ease * 0.5;
      this._pos.set(camX, camY, camZ);
      this._target.set(0.0, 1.4, -1.0);

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 2 & 3: 6-GOAL MULTI-ANGLE SHOWCASE (14.40s – 78.40s)
    // ═════════════════════════════════════════════════════════════════════════

    } else if (t < 24.00) {
      // SHOT 5: ELEVATED BROADCAST RAIL CAM — KICKOFF & GOAL 1 (21.0s | North Torus 1-0)
      this._snapCut(4, () => {
        this._setFov(54);
        this.addImpulse(0.85);
        this._applyPalette(0, athletes); // Act I Bookend: Red vs Blue
      });

      const railX = 16.5;
      const railY = 6.2;
      const railZ = focusZ * 0.40;
      this._pos.set(railX, railY, railZ);

      if (t >= 20.00 && t < 23.50) {
        const blend = Math.min(1.0, Math.max(0.0, (t - 20.00) / 0.80));
        const easeBlend = blend * blend * (3 - 2 * blend);
        this._target.set(
          (1 - easeBlend) * (focusX * 0.60) + easeBlend * 0.0,
          (1 - easeBlend) * 2.0 + easeBlend * 9.5,
          (1 - easeBlend) * (focusZ * 0.85) + easeBlend * (-40.0)
        );
      } else if (t >= 23.50) {
        this._target.set(0.0, 9.5, -40.0);
      } else {
        this._target.set(focusX * 0.60, 2.0, focusZ * 0.85);
      }

    } else if (t < 35.00) {
      // SHOT 6: EAST BANKED WALL LOW CAM — GOAL 2 (32.0s | South Torus 1-1)
      this._snapCut(5, () => {
        this._setFov(52);
        this.addImpulse(0.85);
        this._applyPalette(1, athletes); // Act II: VoltGold
      });

      const prog = (t - 24.00) / 11.00;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = 16.0 - ease * 2.0;
      const camY = 5.2 + ease * 0.6;
      const camZ = 6.0 + ease * 6.0;
      this._pos.set(camX, camY, camZ);

      if (t >= 30.80 && t < 34.00) {
        const blend = Math.min(1.0, Math.max(0.0, (t - 30.80) / 0.80));
        const easeBlend = blend * blend * (3 - 2 * blend);
        this._target.set(
          (1 - easeBlend) * (focusX * 0.50) + easeBlend * 0.0,
          (1 - easeBlend) * 2.2 + easeBlend * 9.5,
          (1 - easeBlend) * (focusZ * 0.80) + easeBlend * 40.0
        );
      } else if (t >= 34.00) {
        this._target.set(0.0, 9.5, 40.0);
      } else {
        this._target.set(focusX * 0.50, 2.2, focusZ * 0.80);
      }

    } else if (t < 44.20) {
      // SHOT 7A: WEST RALLY RAIL CAM — Rally 3 builds to the drop at center court
      this._snapCut(6, () => {
        this._setFov(54);
        this.addImpulse(0.9);
        this._applyPalette(2, athletes); // Act II: IonCyan
      });

      const railX = -12.0;
      const railY = 5.5;
      const railZ = focusZ * 0.50 + 4.0;
      this._pos.set(railX, railY, railZ);
      this._target.set(focusX * 0.60, 2.0, focusZ * 0.85);

    } else if (t < 46.00) {
      // SHOT 7B: TOP-DOWN 3/4 SKY CAM — GOAL 3 (44.20s Beat Drop! | North Torus 2-1)
      this._snapCut(6.5, () => {
        this._setFov(62);
      });

      const prog = (t - 44.20) / 1.80;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = 8.0 - ease * 4.0;
      const camY = 14.5 - ease * 1.5;
      const camZ = -12.0 - ease * 4.0;
      this._pos.set(camX, camY, camZ);
      this._target.set(0.0, 9.5, -40.0);

    } else if (t < 57.00) {
      // SHOT 8: ULTRA-LOW TURF PROFILE CAM — GOAL 4 (53.0s | South Torus 2-2)
      this._snapCut(7, () => {
        this._setFov(48);
        this.addImpulse(0.85);
        this._applyPalette(3, athletes); // Act II: Emerald
      });

      const prog = (t - 46.00) / 11.00;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = 8.5 - ease * 2.0;
      const camY = 2.0 + ease * 0.3;
      const camZ = 18.0 + ease * 8.0;
      this._pos.set(camX, camY, camZ);

      if (t >= 51.60 && t < 55.50) {
        const blend = Math.min(1.0, Math.max(0.0, (t - 51.60) / 0.80));
        const easeBlend = blend * blend * (3 - 2 * blend);
        this._target.set(
          (1 - easeBlend) * (focusX * 0.50) + easeBlend * 0.0,
          (1 - easeBlend) * 1.8 + easeBlend * 9.5,
          (1 - easeBlend) * (focusZ * 0.80) + easeBlend * 40.0
        );
      } else if (t >= 55.50) {
        this._target.set(0.0, 9.5, 40.0);
      } else {
        this._target.set(focusX * 0.50, 1.8, focusZ * 0.80);
      }

    } else if (t < 67.00) {
      // SHOT 9: FLANK 3/4 MID-COURT CAM — GOAL 5 (63.5s | North Torus 3-2)
      this._snapCut(8, () => {
        this._setFov(52);
        this.addImpulse(0.85);
        this._applyPalette(4, athletes); // Act II: Obsidian
      });

      const prog = (t - 57.00) / 10.00;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = 17.0 - ease * 2.0;
      const camY = 7.5 + ease * 0.5;
      const camZ = -26.0 - ease * 4.0;
      this._pos.set(camX, camY, camZ);

      if (t >= 61.80 && t < 65.50) {
        const blend = Math.min(1.0, Math.max(0.0, (t - 61.80) / 0.80));
        const easeBlend = blend * blend * (3 - 2 * blend);
        this._target.set(
          (1 - easeBlend) * (focusX * 0.60) + easeBlend * 0.0,
          (1 - easeBlend) * 2.0 + easeBlend * 9.5,
          (1 - easeBlend) * (focusZ * 0.85) + easeBlend * (-40.0)
        );
      } else if (t >= 65.50) {
        this._target.set(0.0, 9.5, -40.0);
      } else {
        this._target.set(focusX * 0.60, 2.0, focusZ * 0.85);
      }

    } else if (t < 72.10) {
      // SHOT 10A: EAST RALLY RAIL CAM — Red vs Blue contest the ball before the climax
      this._snapCut(9, () => {
        this._setFov(54);
        this.addImpulse(1.0);
        this._applyPalette(0, athletes); // Act III Bookend: Red vs Blue returns!
      });

      const railX = 12.0;
      const railY = 5.5;
      const railZ = focusZ * 0.50 + 4.0;
      this._pos.set(railX, railY, railZ);
      this._target.set(focusX * 0.60, 2.0, focusZ * 0.85);

    } else if (t < 78.40) {
      // SHOT 10B: THROUGH-HOOP 3/4 FRAMING CAM — GOAL 6 (73.0s Climax! | North Torus 4-2)
      // Cuts in on the 72.10s beat, just before the staged spike, so the ball's
      // flight through the ring is on screen. Positioned on East flank looking
      // cleanly through Torus aperture with zero pillar obstruction.
      this._snapCut(9.5, () => {
        this._setFov(56);
      });

      const prog = (t - 72.10) / 6.30;
      const ease = prog * prog * (3 - 2 * prog);
      const camX = 13.0 - ease * 2.5;
      const camY = 8.5 + ease * 0.5;
      const camZ = -33.0 - ease * 3.0;
      this._pos.set(camX, camY, camZ);
      this._target.set(-1.0, 9.5, -40.0);

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 4: CELESTIAL ASCENSION ARC (78.40s – 83.80s)
    // ═════════════════════════════════════════════════════════════════════════

    } else if (t < 83.80) {
      // SHOT 11: CELESTIAL ASCENSION ARC
      this._snapCut(10, () => {
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

    this._applyResilientClearance(delta);
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
      this._justCut = true;
      if (typeof onCutCallback === 'function') {
        onCutCallback();
      }
    }
  }

  _applyPalette(idx, athletes = []) {
    // Act I (0.0s – 24.0s) & Act III (67.0s – 94.5s) are strictly locked to Classic Red vs Blue
    // with Red in Football Helmet (wrestler_bands) and Blue in Cricket Helmet (wicket_grill).
    // Act II (24.0s – 67.0s) cycles through the diverse Brand Palettes and Series 1 headwear pack.
    const isBookend = this.elapsedTime < 24.0 || this.elapsedTime >= 67.0;
    const pal = isBookend ? this._palettes[0] : (this._palettes[idx % this._palettes.length] || this._palettes[0]);
    try {
      if (athletes[0]?.setTeamAndVariant) {
        athletes[0].setTeamAndVariant('home', pal.homeVariant, { primaryColor: pal.homeColor });
        if (athletes[0]?.setHeadwear && pal.homeHeadwear) {
          athletes[0].setHeadwear(pal.homeHeadwear);
        }
      }
      if (athletes[1]?.setTeamAndVariant) {
        athletes[1].setTeamAndVariant('away', pal.awayVariant, { primaryColor: pal.awayColor });
        if (athletes[1]?.setHeadwear && pal.awayHeadwear) {
          athletes[1].setHeadwear(pal.awayHeadwear);
        }
      }
    } catch (_) {}
  }

  _applyResilientClearance(delta = 1 / 60) {
    const floorY = getCourtFloorY(this._pos.x, this._pos.z);
    this._pos.y = Math.max(this._pos.y, floorY + 0.75);

    const targetFloorY = getCourtFloorY(this._target.x, this._target.z);
    this._target.y = Math.max(this._target.y, targetFloorY + 0.5);

    if (this._justCut) {
      this._justCut = false;
      this._smoothPos.copy(this._pos);
      this._smoothTarget.copy(this._target);
    } else {
      const lerpFactor = 1.0 - Math.exp(-delta * 12.0);
      this._smoothPos.lerp(this._pos, lerpFactor);
      this._smoothTarget.lerp(this._target, lerpFactor);
    }

    this.camera.position.copy(this._smoothPos);

    if (this.trauma > 0) {
      const shake = this.trauma * this.trauma * 0.08;
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }

    this.camera.lookAt(this._smoothTarget);
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
      case 'flank_torus_north':
      case 'flank_torus_south': {
        this._setFov(48);
        // Hold the hoop in the composition only while the ball is near it;
        // otherwise swing to an elevated flank view of the live action, so a
        // play at the far end is not filmed as an empty hoop.
        const side = this.rawReelMode === 'flank_torus_north' ? 1.0 : -1.0;
        const goalZ = side * hoopZ;
        const hoopDist = Math.hypot(ballPos.x, ballPos.z - goalZ);
        const near = Math.min(1.0, Math.max(0.0, (30.0 - hoopDist) / 20.0));
        const w = near * near * (3 - 2 * near);

        const hoopCamX = side * (16.0 - ease * 2.0);
        const hoopCamZ = -side * (22.0 + ease * 4.0);
        const hoopCamY = Math.max(7.5, getCourtFloorY(hoopCamX, hoopCamZ) + 3.0);
        const actCamX = Math.max(-16.0, Math.min(16.0, focusX + side * 7.0));
        // Behind the play relative to the goal, so both framings face the hoop
        // and the blend between them never swings the camera around.
        const actCamZ = focusZ + side * 6.0;
        const actCamY = Math.max(focusFloorY + 4.5, getCourtFloorY(actCamX, actCamZ) + 3.0);
        this._pos.set(
          actCamX + (hoopCamX - actCamX) * w,
          actCamY + (hoopCamY - actCamY) * w,
          actCamZ + (hoopCamZ - actCamZ) * w
        );

        const hoopTgtX = 0.3 * focusX;
        const hoopTgtY = 0.4 * focusY + 0.6 * hoopY;
        const hoopTgtZ = 0.4 * focusZ + 0.6 * goalZ;
        this._target.set(
          focusX + (hoopTgtX - focusX) * w,
          focusY + (hoopTgtY - focusY) * w,
          focusZ + (hoopTgtZ - focusZ) * w
        );
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

    // Ease toward this frame's framing rather than snapping to it, so the
    // camera rides through bounces and contacts instead of jittering with them.
    if (!this._rawCamPrimed) {
      this._rawCamPrimed = true;
      this._rawCamPos.copy(this._pos);
      this._rawCamTarget.copy(this._target);
    } else {
      this._rawCamPos.lerp(this._pos, 1 - Math.exp(-RAW_CAM_POS_RATE * delta));
      this._rawCamTarget.lerp(this._target, 1 - Math.exp(-RAW_CAM_TARGET_RATE * delta));
    }
    this._pos.copy(this._rawCamPos);
    this._target.copy(this._rawCamTarget);

    this._applyResilientClearance();
  }
}

export const trailerDirector = new TrailerDirector();
