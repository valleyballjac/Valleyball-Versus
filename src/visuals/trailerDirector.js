import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { soundManager } from '../audio/soundManager.js';

/**
 * VALLEYBALL TRAILER DIRECTOR
 *
 * Choreographs the official debut music video trailer in lockstep with
 * the operatic synthwave soundtrack (Track 1: "Arena of Frost").
 *
 * Storyboard Timeline:
 * - 0:00 - 0:08 | SHOT 1: The North Monolithic Hoop (low-angle cathedral aperture)
 * - 0:08 - 0:17 | SHOT 2: The Stream Heads & High Ramps (high banking valley reveal)
 * - 0:17 - 0:26 | SHOT 3: The Sunken Floor & 18m Circle Zones (raking bassline glide)
 * - 0:26 - 0:34 | SHOT 4: The Ceiling Drop Apex (extreme close-up on spinning globe)
 * - 0:34 - 1:40 | SHOT 5: Fixed-Length Ball Follow Rig (kinetic gameplay action)
 *
 * LAW 1 & 6 COMPLIANCE:
 * TrailerDirector is strictly camera/render-side. It observes live physics
 * and controls camera transforms; it never alters simulation state.
 */
export class TrailerDirector {
  constructor(camera = null) {
    this.camera = camera || new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 500);
    this.isActive = false;
    this.elapsedTime = 0;
    this.duration = 180.0;

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
  }

  /**
   * Activates the trailer sequence.
   * @param {number} startOffset - seconds into the sequence (default 0)
   */
  start(startOffset = 0) {
    this.isActive = true;
    this.elapsedTime = startOffset;

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
        `;
        document.head.appendChild(styleEl);
      }
    }

    // Start music at the corresponding timestamp
    try {
      soundManager.music?.play?.(0);
      if (soundManager.music?.audioElement && startOffset > 0) {
        soundManager.music.audioElement.currentTime = startOffset;
      }
    } catch (_) {}

    console.log(`[trailer] TrailerDirector started at t=${startOffset.toFixed(2)}s`);
  }

  /**
   * Stops trailer mode and returns to normal cameras.
   */
  stop() {
    this.isActive = false;
    this.elapsedTime = 0;
    if (typeof document !== 'undefined') {
      document.body.classList.remove('trailer-mode-active');
      const root = document.getElementById('main-menu-root');
      if (root) root.style.display = '';
      const hud = document.getElementById('hud');
      if (hud && TUNING?.debug?.showHud) hud.style.display = '';
    }
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
   * Updates camera position and orientation based on current music timestamp.
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

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 1: THE MONOLITHIC ARENA REVEAL (0:00 – 0:34)
    // ═════════════════════════════════════════════════════════════════════════

    if (t < 8.0) {
      // SHOT 1: The North Monolithic Hoop (0.0s – 8.0s)
      // Monumental low-angle shot on court looking north-up into the monolithic torus aperture
      const prog = t / 8.0;
      const ease = prog * prog * (3 - 2 * prog); // smoothstep

      const hoopY = TUNING.match?.hoopCenterY ?? 10.0;
      const hoopZ = TUNING.match?.hoopNorthZ ?? -40.0;

      const camX = 6.0 - ease * 4.5;
      const camY = 3.5 + ease * 2.5;
      const camZ = -26.0 - ease * 4.0;
      this._pos.set(camX, camY, camZ);

      // Target: Looking up directly at the North Hoop center aperture
      this._target.set(0, hoopY, hoopZ);

      this.camera.position.copy(this._pos);
      this.camera.lookAt(this._target);

    } else if (t < 17.0) {
      // SHOT 2: The Stream Heads & High Ramps (8.0s – 17.0s)
      // Elevated banking sweep framing the NW stream drop ramp into the valley
      const prog = (t - 8.0) / 9.0;
      const ease = prog * prog * (3 - 2 * prog);

      const angle = -Math.PI * 0.45 + ease * 0.65;
      const rad = 32.0 - ease * 8.0;
      const camY = 16.0 - ease * 6.5;

      this._pos.set(
        rad * Math.sin(angle),
        camY,
        rad * Math.cos(angle)
      );

      // Target sweeps down the ramp toward the center court basin
      this._target.set(0, 1.8 + (1 - ease) * 3.0, 6.0 - ease * 6.0);

      this.camera.position.copy(this._pos);
      this.camera.lookAt(this._target);

    } else if (t < 26.0) {
      // SHOT 3: The Sunken Court Floor & 18m Circle Zones (17.0s – 26.0s)
      // Low raking glide across the chalk curves as the 16th-note bassline enters
      const prog = (t - 17.0) / 9.0;
      const ease = prog * prog * (3 - 2 * prog);

      const camX = 22.0 - ease * 28.0;
      const camY = 1.35 + Math.sin(prog * Math.PI) * 0.6;
      const camZ = -12.0 + ease * 24.0;
      this._pos.set(camX, camY, camZ);

      // Target frames the painted tactical circle and stadium jumbotrons
      this._target.set(0, 1.1, ease * 10.0);

      this.camera.position.copy(this._pos);
      this.camera.lookAt(this._target);

    } else if (t < 34.0) {
      // SHOT 4: High Stadium Aerial Drop (26.0s – 34.0s)
      // Majestic sweeping overhead shot descending down toward the live ball
      const prog = (t - 26.0) / 8.0;
      const ease = prog * prog * (3 - 2 * prog);

      const orbitAngle = Math.PI * 0.3 + prog * Math.PI * 0.4;
      const orbitRad = 26.0 - ease * 14.0;
      const camY = 18.0 - ease * 11.0;

      this._pos.set(
        orbitRad * Math.sin(orbitAngle),
        camY,
        orbitRad * Math.cos(orbitAngle)
      );

      // Target centers on the live court floor
      this._target.set(0, 1.0, 0);

      this.camera.position.copy(this._pos);
      this.camera.lookAt(this._target);

    } else {
      // ═════════════════════════════════════════════════════════════════════
      // PHASE 2: FIXED-LENGTH BALL FOLLOW RIG (34.0s+ ON THE BEAT DROP)
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
      const smoothFactor = 1.0 - Math.exp(-12.0 * delta);
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
        // Fallback: Default stadium longitudinal chase orientation
        dirZ = (this._ballSmoothPos.z > 0) ? -1 : 1;
      }

      // Position camera at exact fixed offset relative to live ball
      const desiredX = this._ballSmoothPos.x + dirX * this.ballChaseDistance;
      const desiredY = Math.max(1.2, this._ballSmoothPos.y + this.ballChaseHeight);
      const desiredZ = this._ballSmoothPos.z + dirZ * this.ballChaseDistance;

      // Smooth camera position
      const camSmooth = 1.0 - Math.exp(-8.0 * delta);
      this.camera.position.x += (desiredX - this.camera.position.x) * camSmooth;
      this.camera.position.y += (desiredY - this.camera.position.y) * camSmooth;
      this.camera.position.z += (desiredZ - this.camera.position.z) * camSmooth;

      // Camera looks directly at ball center with slight forward prediction
      this._target.set(
        this._ballSmoothPos.x + ballVel.x * this.ballChaseLead,
        this._ballSmoothPos.y + 0.1,
        this._ballSmoothPos.z + ballVel.z * this.ballChaseLead
      );

      // Apply micro-shake impulse if active
      if (this.trauma > 0) {
        const shake = this.trauma * this.trauma * 0.08;
        this.camera.position.x += (Math.random() - 0.5) * shake;
        this.camera.position.y += (Math.random() - 0.5) * shake;
      }

      this.camera.lookAt(this._target);
    }
  }
}

export const trailerDirector = new TrailerDirector();
if (typeof window !== 'undefined') {
  window.__trailerDirector = trailerDirector;
}
