import * as THREE from 'three';
import { TUNING } from '../../config/tuning.js';
import { CinematicCamera } from '../../visuals/cinematicCamera.js';

/**
 * Manages viewports, camera rigs, scissor test splits,
 * dynamic shared arena camera, and spectator broadcasts.
 *
 * Supports:
 * - 1 Viewport (Fullscreen: single player, spectator, or dynamic arena)
 * - 2 Viewports (Horizontal Split: 1v1 human vs human)
 * - 4 Viewports (Quad 2x2 Split: 4 independent 3rd-person chase views)
 */
class ViewportManager {
  constructor() {
    this.renderer = null;
    this.scene = null;
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    /** @type {THREE.PerspectiveCamera[]} */
    this.playerCameras = [];
    /** @type {any[]} */
    this.cameraRigs = [];

    this.spectatorCamera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);
    this.dynamicArenaCamera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 1000);
    this.cinematicCamera = null;

    this.mode = 'fullscreen'; // 'fullscreen' | 'split2' | 'split4' | 'dynamicArena' | 'spectator'
    this.activePlayerIndex = 0;

    // Scratch math vectors for dynamic arena framing
    this._arenaCenter = new THREE.Vector3();
    this._arenaTarget = new THREE.Vector3();
    this._desiredCamPos = new THREE.Vector3();
    this._camOffset = new THREE.Vector3();
  }

  /**
   * Initializes cameras and sets up viewport renderer.
   */
  init(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.cinematicCamera = new CinematicCamera(this.spectatorCamera, {
      orbitRadius: 36,
      orbitElevation: 16,
      orbitSpeed: 0.18,
    });

    this.spectatorCamera.position.set(0, 18, -48);
    this.spectatorCamera.lookAt(0, 2, 0);

    this.dynamicArenaCamera.position.set(0, 22, -42);
    this.dynamicArenaCamera.lookAt(0, 2, 0);

    this.ensureCameras(4);
    this.resize(window.innerWidth, window.innerHeight);
  }

  /**
   * Ensures camera instances exist for up to `count` players.
   */
  ensureCameras(count = 4) {
    while (this.playerCameras.length < count) {
      const cam = new THREE.PerspectiveCamera(
        TUNING.camera?.fov || 65,
        this.width / this.height,
        0.1,
        1000,
      );
      this.playerCameras.push(cam);
    }
  }

  /**
   * Updates camera aspect ratios upon window resize.
   */
  resize(width, height) {
    this.width = width;
    this.height = height;

    const fullAspect = width / height;
    this.spectatorCamera.aspect = fullAspect;
    this.spectatorCamera.updateProjectionMatrix();

    this.dynamicArenaCamera.aspect = fullAspect;
    this.dynamicArenaCamera.updateProjectionMatrix();

    const halfWAspect = (width / 2) / height;
    const quadAspect = (width / 2) / (height / 2);

    for (const cam of this.playerCameras) {
      cam.aspect = this.mode === 'split2'
        ? halfWAspect
        : (this.mode === 'split4' ? quadAspect : fullAspect);
      cam.updateProjectionMatrix();
    }
  }

  /**
   * Sets viewport presentation mode.
   *
   * @param {'fullscreen' | 'split2' | 'split4' | 'dynamicArena' | 'spectator'} mode
   * @param {number} activePlayerIndex Player slot to display when in fullscreen mode
   */
  setMode(mode, activePlayerIndex = 0) {
    this.mode = mode;
    this.activePlayerIndex = activePlayerIndex;
    this.resize(this.width, this.height);
  }

  /**
   * Computes dynamic arena wide camera bounds framing all athletes and ball.
   */
  updateDynamicArena(dt, athletes, ball) {
    let minX = -10, maxX = 10, minZ = -20, maxZ = 20;
    let count = 0;

    for (const a of athletes) {
      if (!a.isEnabled || !a.motor?.body) continue;
      const t = a.motor.body.translation();
      minX = Math.min(minX, t.x);
      maxX = Math.max(maxX, t.x);
      minZ = Math.min(minZ, t.z);
      maxZ = Math.max(maxZ, t.z);
      count++;
    }

    if (ball?.body) {
      const bt = ball.body.translation();
      minX = Math.min(minX, bt.x);
      maxX = Math.max(maxX, bt.x);
      minZ = Math.min(minZ, bt.z);
      maxZ = Math.max(maxZ, bt.z);
    }

    const midX = (minX + maxX) * 0.5;
    const midZ = (minZ + maxZ) * 0.5;
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    const maxSpan = Math.max(spanX * 0.85, spanZ);

    // Target position: elevated sideline angle
    const desiredDist = Math.max(30, Math.min(58, 22 + maxSpan * 0.85));
    const desiredHeight = Math.max(14, Math.min(32, 10 + maxSpan * 0.45));

    this._desiredCamPos.set(midX * 0.4, desiredHeight, midZ - desiredDist);
    this._arenaTarget.set(midX, 2.5, midZ);

    const lerpRate = Math.min(1.0, dt * 3.5);
    this.dynamicArenaCamera.position.lerp(this._desiredCamPos, lerpRate);
    this.dynamicArenaCamera.lookAt(this._arenaTarget);
  }

  /**
   * Renders the scene across active viewports.
   *
   * @param {THREE.Scene} scene
   */
  render(scene) {
    if (!this.renderer) return;

    if (this.mode === 'split2') {
      const halfW = Math.floor(this.width / 2);

      // Left viewport (Player 1)
      this.renderer.setViewport(0, 0, halfW, this.height);
      this.renderer.setScissor(0, 0, halfW, this.height);
      this.renderer.setScissorTest(true);
      this.renderer.render(scene, this.playerCameras[0]);

      // Right viewport (Player 2)
      this.renderer.setViewport(halfW, 0, this.width - halfW, this.height);
      this.renderer.setScissor(halfW, 0, this.width - halfW, this.height);
      this.renderer.render(scene, this.playerCameras[1]);

      this.renderer.setScissorTest(false);
    } else if (this.mode === 'split4') {
      const halfW = Math.floor(this.width / 2);
      const halfH = Math.floor(this.height / 2);

      this.renderer.setScissorTest(true);

      // Top-Left (P1)
      this.renderer.setViewport(0, halfH, halfW, this.height - halfH);
      this.renderer.setScissor(0, halfH, halfW, this.height - halfH);
      this.renderer.render(scene, this.playerCameras[0]);

      // Top-Right (P2)
      this.renderer.setViewport(halfW, halfH, this.width - halfW, this.height - halfH);
      this.renderer.setScissor(halfW, halfH, this.width - halfW, this.height - halfH);
      this.renderer.render(scene, this.playerCameras[1]);

      // Bottom-Left (P3)
      this.renderer.setViewport(0, 0, halfW, halfH);
      this.renderer.setScissor(0, 0, halfW, halfH);
      this.renderer.render(scene, this.playerCameras[2] || this.playerCameras[0]);

      // Bottom-Right (P4)
      this.renderer.setViewport(halfW, 0, this.width - halfW, halfH);
      this.renderer.setScissor(halfW, 0, this.width - halfW, halfH);
      this.renderer.render(scene, this.playerCameras[3] || this.playerCameras[1]);

      this.renderer.setScissorTest(false);
    } else {
      // Single Viewport Fullscreen
      this.renderer.setViewport(0, 0, this.width, this.height);
      this.renderer.setScissorTest(false);

      let targetCam = this.playerCameras[this.activePlayerIndex] || this.playerCameras[0];
      if (this.mode === 'spectator') {
        targetCam = this.spectatorCamera;
      } else if (this.mode === 'dynamicArena') {
        targetCam = this.dynamicArenaCamera;
      }

      this.renderer.render(scene, targetCam);
    }
  }
}

export const viewportManager = new ViewportManager();
export { ViewportManager };
