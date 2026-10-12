import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { soundManager } from '../audio/soundManager.js';

/**
 * VALLEYBALL TRAILER DIRECTOR
 *
 * Choreographs the official debut music video trailer in lockstep with
 * the operatic synthwave soundtrack ("Neon Velocity" — 89.85s, ~133 BPM).
 *
 * Storyboard Cue Timeline:
 * - 0:00 - 0:07 | SHOT 1: North Torus Monolithic Arch (cathedral aperture looking North-Up)
 * - 0:07 - 0:17 | SHOT 2: Stream Heads & High Ramps (elevated banking valley reveal)
 * - 0:17 - 0:28 | SHOT 3: Sunken Floor & 18m Circle (low raking glide along chalk markings)
 * - 0:28 - 0:36 | SHOT 4: High Stadium Aerial Descent (sweeping orbital crane)
 * - 0:36 - 0:43 | SHOT 5: Pre-Drop Tension Floor Lock (raking ground push on ball & ramps)
 * - 0:43 - 0:88 | PHASE 2: FIXED-LENGTH BALL FOLLOW RIG & RAPID MULTI-BALL MONTAGE
 *   - 0:43 - 0:50 | Beat Drop Snap: Medium Ball (1.0m Earth Globe) | Classic Red vs Blue
 *   - 0:50 - 0:57 | Downbeat Switch: Small Lightning Ball (0.4m) | Cyber Violet vs Volt Gold
 *   - 0:57 - 0:64 | Downbeat Switch: Large Exercise Ball (1.5m) | Emerald Green vs Solar Blaze
 *   - 0:64 - 0:75 | SUPER DROP Peak: Medium Ball | Championship Gold | Torus Goal & End-Flip
 *   - 0:75 - 0:82 | Downbeat Switch: Multi-Ball Frenzy & Rapid Volleys
 *   - 0:82 - 0:88 | Outro Ascension: Camera rises toward torus arch as final chord resolves
 * - 0:88 - 0:90 | FINALE FREEZE-FRAME & OFFICIAL TITLE CARD
 *
 * LAW 1 & 6 COMPLIANCE:
 * TrailerDirector is strictly camera/render-side. It observes live physics
 * and controls camera transforms; it never alters simulation state.
 */
export class TrailerDirector {
  constructor(camera = null) {
    this.camera = camera || new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 500);
    this.baseFov = 65;
    this.isActive = false;
    this.elapsedTime = 0;
    this.duration = 89.85;

    // Vectors for zero-allocation tick calculation
    this._pos = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._ballSmoothPos = new THREE.Vector3(0, 1.0, 0);
    this._camVelocity = new THREE.Vector3();

    // Fixed Ball Chase settings
    this.ballChaseDistance = 3.8;
    this.ballChaseHeight = 1.15;
    this.ballChaseLead = 0.08;

    // Camera shake / impulse on hits
    this.trauma = 0.0;

    // Montage state flags
    this._phase2Started = false;
    this._montagePhase = -1;
    this._freezeFrameActive = false;
    this._freezeCameraPos = new THREE.Vector3();
    this._freezeCameraTarget = new THREE.Vector3();

    // Stored audio gains for pure music video mode
    this._prevSfxGain = 1.0;
    this._prevAmbGain = 1.0;
    this._prevUiGain = 1.0;
  }

  /**
   * Activates the trailer sequence.
   * @param {number} startOffset - seconds into the sequence (default 0)
   */
  start(startOffset = 0) {
    this.isActive = true;
    this.elapsedTime = startOffset;
    this._phase2Started = false;
    this._montagePhase = -1;
    this._freezeFrameActive = false;

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
          #trailer-title-card {
            position: fixed;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: radial-gradient(circle at center, rgba(10, 13, 18, 0.5) 0%, rgba(5, 7, 10, 0.88) 100%);
            backdrop-filter: blur(4px);
            z-index: 999999;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            text-align: center;
            opacity: 0;
            transition: opacity 0.35s ease;
            pointer-events: none;
          }
          #trailer-title-card.visible {
            opacity: 1;
          }
          #trailer-title-card .title-logo {
            font-size: 76px;
            font-weight: 900;
            letter-spacing: 0.18em;
            color: #ffffff;
            text-transform: uppercase;
            text-shadow: 0 0 35px rgba(56, 189, 248, 0.9), 0 0 70px rgba(239, 68, 68, 0.6);
            margin: 0;
            line-height: 1.1;
          }
          #trailer-title-card .sub-url {
            font-size: 26px;
            font-weight: 800;
            letter-spacing: 0.1em;
            color: #38bdf8;
            margin-top: 20px;
            text-transform: uppercase;
            text-shadow: 0 0 20px rgba(56, 189, 248, 0.7);
          }
          #trailer-title-card .sub-championship {
            font-size: 20px;
            font-weight: 600;
            letter-spacing: 0.14em;
            color: #f1f5f9;
            margin-top: 14px;
            text-transform: uppercase;
            opacity: 0.92;
          }
        `;
        document.head.appendChild(styleEl);
      }

      // Remove existing title card if present
      const oldCard = document.getElementById('trailer-title-card');
      if (oldCard) oldCard.remove();
    }

    // Pure music mode: mute in-game sound effects so synthwave track is 100% clean
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

    console.log(`[trailer] TrailerDirector started at t=${startOffset.toFixed(2)}s with Neon Velocity.`);
  }

  /**
   * Stops trailer mode and returns to normal gameplay state.
   */
  stop() {
    this.isActive = false;
    this.elapsedTime = 0;
    this._phase2Started = false;
    this._montagePhase = -1;
    this._freezeFrameActive = false;

    if (typeof document !== 'undefined') {
      document.body.classList.remove('trailer-mode-active');
      const root = document.getElementById('main-menu-root');
      if (root) root.style.display = '';
      const hud = document.getElementById('hud');
      if (hud && TUNING?.debug?.showHud) hud.style.display = '';
      const card = document.getElementById('trailer-title-card');
      if (card) card.remove();
    }

    if (this._titleCardMesh) {
      this.camera.remove(this._titleCardMesh);
      if (this._titleCardMesh.geometry) this._titleCardMesh.geometry.dispose();
      if (this._titleCardMesh.material) {
        if (this._titleCardMesh.material.map) this._titleCardMesh.material.map.dispose();
        this._titleCardMesh.material.dispose();
      }
      this._titleCardMesh = null;
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

  /**
   * Toggles trailer mode on/off.
   */
  toggle() {
    if (this.isActive) {
      this.stop();
    } else {
      this.start(0);
    }
    return this.isActive;
  }

  /**
   * Triggers a subtle camera impulse (e.g. on clean strikes or power spikes).
   * @param {number} amount (0.0 to 1.0)
   */
  addImpulse(amount = 0.5) {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  /**
   * Renders the outro Title Card on DOM and in-canvas Three.js overlay.
   */
  _showTitleCard() {
    if (this._titleCardMesh) return;
    try {
      const c = document.createElement('canvas');
      c.width = 1920;
      c.height = 1080;
      const ctx = c.getContext('2d');

      // Radial vignette backdrop over freeze frame
      const grad = ctx.createRadialGradient(960, 540, 120, 960, 540, 980);
      grad.addColorStop(0, 'rgba(10, 13, 18, 0.45)');
      grad.addColorStop(1, 'rgba(5, 7, 10, 0.88)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1920, 1080);

      // Title Glow & Typography
      ctx.shadowColor = 'rgba(56, 189, 248, 0.95)';
      ctx.shadowBlur = 45;
      ctx.font = '900 82px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('VALLEYBALL VERSUS', 960, 480);

      // Subheading 1: Play Free Now! ValleyballVS.com
      ctx.shadowColor = 'rgba(56, 189, 248, 0.8)';
      ctx.shadowBlur = 24;
      ctx.font = '800 30px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('PLAY FREE NOW!  VALLEYBALLVS.COM', 960, 555);

      // Subheading 2: Inaugural Championship December 27, 2026
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.font = '700 22px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#f1f5f9';
      ctx.fillText('INAUGURAL CHAMPIONSHIP DECEMBER 27, 2026', 960, 615);

      const texture = new THREE.CanvasTexture(c);
      texture.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 1.0,
        depthTest: false,
        depthWrite: false,
      });

      const geom = new THREE.PlaneGeometry(2.265, 1.274);
      this._titleCardMesh = new THREE.Mesh(geom, mat);
      this._titleCardMesh.position.set(0, 0, -1.0);
      this.camera.add(this._titleCardMesh);
    } catch (e) {
      console.warn('[trailer] Failed to create in-canvas title card:', e);
    }

    if (typeof document !== 'undefined') {
      let card = document.getElementById('trailer-title-card');
      if (!card) {
        card = document.createElement('div');
        card.id = 'trailer-title-card';
        card.innerHTML = `
          <h1 class="title-logo">VALLEYBALL VERSUS</h1>
          <div class="sub-url">Play Free Now! ValleyballVS.com</div>
          <div class="sub-championship">Inaugural Championship December 27, 2026</div>
        `;
        document.body.appendChild(card);
        requestAnimationFrame(() => card.classList.add('visible'));
      }
    }
  }

  /**
   * Updates camera position, orientation, and montage state based on audio timestamp.
   *
   * @param {number} delta - Frame delta in seconds
   * @param {object} liveBall - Rapier rigid body or ball representation
   * @param {Array<object>} athletes - Active athlete rigs
   * @param {object} matchState - Live match state
   */
  update(delta, liveBall = null, athletes = [], matchState = null) {
    if (!this.isActive) return;

    this.elapsedTime += delta;
    const t = this.elapsedTime;

    // Dissipate trauma shake
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - delta * 4.0);
    }

    // Dynamic FOV lens punch: tighten FOV on trauma, easing back smoothly
    this.camera.fov = this.baseFov - this.trauma * 2.8;

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 1: MONOLITHIC ARENA REVEAL (0:00 – 0:43)
    // ═════════════════════════════════════════════════════════════════════════

    if (t < 7.0) {
      // SHOT 1: The North Monolithic Hoop (0.0s – 7.0s)
      // Monumental low-angle court perspective looking North-Up through the torus aperture
      const prog = t / 7.0;
      const ease = prog * prog * (3 - 2 * prog);

      const hoopY = TUNING.match?.hoopCenterY ?? 10.0;
      const hoopZ = TUNING.match?.hoopNorthZ ?? -40.0;

      const camX = 6.0 - ease * 4.5;
      const camY = 3.2 + ease * 2.2;
      const camZ = -26.0 - ease * 4.0;
      this._pos.set(camX, camY, camZ);
      this._target.set(0, hoopY, hoopZ);

      this.camera.position.copy(this._pos);
      this.camera.lookAt(this._target);

    } else if (t < 17.0) {
      // SHOT 2: Stream Heads & High Ramps (7.0s – 17.0s)
      // Elevated banking sweep revealing high drop ramps cascading into the valley bowl
      const prog = (t - 7.0) / 10.0;
      const ease = prog * prog * (3 - 2 * prog);

      const angle = -Math.PI * 0.45 + ease * 0.65;
      const rad = 32.0 - ease * 8.0;
      const camY = 16.0 - ease * 6.5;

      this._pos.set(rad * Math.sin(angle), camY, rad * Math.cos(angle));
      this._target.set(0, 1.8 + (1 - ease) * 3.0, 6.0 - ease * 6.0);

      this.camera.position.copy(this._pos);
      this.camera.lookAt(this._target);

    } else if (t < 28.0) {
      // SHOT 3: Sunken Court Floor & 18m Circle (17.0s – 28.0s)
      // Low raking glide along the red circle chalk markings as driving bassline locks in
      const prog = (t - 17.0) / 11.0;
      const ease = prog * prog * (3 - 2 * prog);

      const camX = 22.0 - ease * 28.0;
      const camY = 1.35 + Math.sin(prog * Math.PI) * 0.55;
      const camZ = -12.0 + ease * 24.0;
      this._pos.set(camX, camY, camZ);
      this._target.set(0, 1.1, ease * 10.0);

      this.camera.position.copy(this._pos);
      this.camera.lookAt(this._target);

    } else if (t < 36.0) {
      // SHOT 4: High Stadium Aerial Descent (28.0s – 36.0s)
      // Majestic sweeping overhead view of full arena complex
      const prog = (t - 28.0) / 8.0;
      const ease = prog * prog * (3 - 2 * prog);

      const orbitAngle = Math.PI * 0.3 + prog * Math.PI * 0.4;
      const orbitRad = 26.0 - ease * 13.0;
      const camY = 18.0 - ease * 10.0;

      this._pos.set(orbitRad * Math.sin(orbitAngle), camY, orbitRad * Math.cos(orbitAngle));
      this._target.set(0, 1.0, 0);

      this.camera.position.copy(this._pos);
      this.camera.lookAt(this._target);

    } else if (t < 43.0) {
      // SHOT 5: Pre-Drop Tension Floor Lock (36.0s – 43.0s)
      // Low court raking push framing the ball and athletes poised on ramps as riser peaks
      const prog = (t - 36.0) / 7.0;
      const ease = prog * prog * (3 - 2 * prog);

      const camX = 0.5 + Math.sin(prog * Math.PI * 0.5) * 1.5;
      const camY = 0.85 + ease * 0.45;
      const camZ = 7.5 - ease * 4.2;
      this._pos.set(camX, camY, camZ);
      this._target.set(0, 1.0, 0);

      this.camera.position.copy(this._pos);
      this.camera.lookAt(this._target);

    } else if (t < 88.0) {
      // ═════════════════════════════════════════════════════════════════════
      // PHASE 2: FIXED-LENGTH BALL FOLLOW RIG & RAPID MULTI-BALL MONTAGE
      // (0:43 – 0:88 on the Beat Drop)
      // ═════════════════════════════════════════════════════════════════════

      // Sample live ball position from physics
      let ballPos = { x: 0, y: 1.0, z: 0 };
      let ballVel = { x: 0, y: 0, z: 0 };

      if (liveBall) {
        if (typeof liveBall.translation === 'function') {
          ballPos = liveBall.translation();
        } else if (liveBall.body && typeof liveBall.body.translation === 'function') {
          ballPos = liveBall.body.translation();
          if (typeof liveBall.body.linvel === 'function') {
            ballVel = liveBall.body.linvel();
          }
        } else if (liveBall.position) {
          ballPos = liveBall.position;
        }
      }

      // Smooth ball position to eliminate sub-step jitter
      const smoothFactor = 1.0 - Math.exp(-14.0 * delta);
      this._ballSmoothPos.x += (ballPos.x - this._ballSmoothPos.x) * smoothFactor;
      this._ballSmoothPos.y += (ballPos.y - this._ballSmoothPos.y) * smoothFactor;
      this._ballSmoothPos.z += (ballPos.z - this._ballSmoothPos.z) * smoothFactor;

      // Calculate directional trailing vector behind ball momentum
      const speed = Math.hypot(ballVel.x, ballVel.z);
      let dirX = 0;
      let dirZ = -1;

      if (speed > 1.0) {
        dirX = -ballVel.x / speed;
        dirZ = -ballVel.z / speed;
      } else {
        dirZ = (this._ballSmoothPos.z > 0) ? -1 : 1;
      }

      // Desired chase camera position
      let desiredX = this._ballSmoothPos.x + dirX * this.ballChaseDistance;
      let desiredY = Math.max(1.2, this._ballSmoothPos.y + this.ballChaseHeight);
      let desiredZ = this._ballSmoothPos.z + dirZ * this.ballChaseDistance;

      // Target centered on ball with slight forward lead
      this._target.set(
        this._ballSmoothPos.x + ballVel.x * this.ballChaseLead,
        this._ballSmoothPos.y + 0.1,
        this._ballSmoothPos.z + ballVel.z * this.ballChaseLead
      );

      // --- RAPID MULTI-BALL MONTAGE DOWNBEAT SWITCHES ---
      // 1. Instant Hard Snap on Beat Drop at t = 43.0s
      if (!this._phase2Started) {
        this._phase2Started = true;
        this._montagePhase = 0;
        this.camera.position.set(desiredX, desiredY, desiredZ);
        this.addImpulse(0.95);

        // Setting 1: Medium Regulation Ball, Classic Red vs Blue
        try {
          if (window.__vb?.setActiveMatchBall) window.__vb.setActiveMatchBall('medium');
          if (athletes[0]?.setTeamAndVariant) athletes[0].setTeamAndVariant('home', 'masculine', { primaryColor: 0xd90429 });
          if (athletes[1]?.setTeamAndVariant) athletes[1].setTeamAndVariant('away', 'feminine', { primaryColor: 0x1d4ed8 });
        } catch (_) {}
      }

      // 2. Bar 30 Downbeat Switch at t = 50.0s: Small Lightning Ball (Cyberpunk Palettes)
      if (t >= 50.0 && this._montagePhase === 0) {
        this._montagePhase = 1;
        this.addImpulse(0.75);
        try {
          if (window.__vb?.setActiveMatchBall) window.__vb.setActiveMatchBall('small');
          if (athletes[0]?.setTeamAndVariant) athletes[0].setTeamAndVariant('home', 'feminine', { primaryColor: 0x8b5cf6 });
          if (athletes[1]?.setTeamAndVariant) athletes[1].setTeamAndVariant('away', 'classic', { primaryColor: 0xeab308 });
        } catch (_) {}
      }

      // 3. Bar 34 Downbeat Switch at t = 57.0s: Large Exercise Ball (Emerald vs Solar)
      if (t >= 57.0 && this._montagePhase === 1) {
        this._montagePhase = 2;
        this.addImpulse(0.8);
        try {
          if (window.__vb?.setActiveMatchBall) window.__vb.setActiveMatchBall('large');
          if (athletes[0]?.setTeamAndVariant) athletes[0].setTeamAndVariant('home', 'classic', { primaryColor: 0x10b981 });
          if (athletes[1]?.setTeamAndVariant) athletes[1].setTeamAndVariant('away', 'masculine', { primaryColor: 0xff5722 });
        } catch (_) {}
      }

      // 4. Bar 38 SUPER DROP Climax at t = 64.0s: Return to Medium Globe Ball / Championship Gold
      if (t >= 64.0 && this._montagePhase === 2) {
        this._montagePhase = 3;
        this.addImpulse(1.0);
        try {
          if (window.__vb?.setActiveMatchBall) window.__vb.setActiveMatchBall('medium');
          if (athletes[0]?.setTeamAndVariant) athletes[0].setTeamAndVariant('home', 'masculine', { primaryColor: 0xf59e0b });
          if (athletes[1]?.setTeamAndVariant) athletes[1].setTeamAndVariant('away', 'feminine', { primaryColor: 0xffffff });
        } catch (_) {}
      }

      // 5. Bar 44 Downbeat Switch at t = 75.0s: Multi-Ball Frenzy
      if (t >= 75.0 && this._montagePhase === 3) {
        this._montagePhase = 4;
        this.addImpulse(0.7);
        try {
          if (window.__vb?.setActiveMatchBall) window.__vb.setActiveMatchBall('all');
        } catch (_) {}
      }

      // 6. Outro Ascension (82.0s – 88.0s): Smoothly crane camera upward framing the ball
      if (t >= 82.0) {
        const outProg = (t - 82.0) / 6.0;
        const outEase = outProg * outProg;
        desiredY += outEase * 5.0;
        desiredZ += (dirZ > 0 ? 1 : -1) * outEase * 4.0;
      }

      // Smooth camera interpolation
      const camSmooth = 1.0 - Math.exp(-9.0 * delta);
      this.camera.position.x += (desiredX - this.camera.position.x) * camSmooth;
      this.camera.position.y += (desiredY - this.camera.position.y) * camSmooth;
      this.camera.position.z += (desiredZ - this.camera.position.z) * camSmooth;

      // Micro-shake impulse
      if (this.trauma > 0) {
        const shake = this.trauma * this.trauma * 0.09;
        this.camera.position.x += (Math.random() - 0.5) * shake;
        this.camera.position.y += (Math.random() - 0.5) * shake;
      }

      this.camera.lookAt(this._target);

    } else {
      // ═════════════════════════════════════════════════════════════════════
      // OUTRO CADENCE & FREEZE-FRAME TITLE CARD (0:88 – 0:90)
      // ═════════════════════════════════════════════════════════════════════
      if (!this._freezeFrameActive) {
        this._freezeFrameActive = true;
        this._freezeCameraPos.copy(this.camera.position);
        this._freezeCameraTarget.copy(this._target);
        this._showTitleCard();
      }

      // Hold exact freeze-frame camera
      this.camera.position.copy(this._freezeCameraPos);
      this.camera.lookAt(this._freezeCameraTarget);
    }
  }
}

export const trailerDirector = new TrailerDirector();
if (typeof window !== 'undefined') {
  window.__trailerDirector = trailerDirector;
}
