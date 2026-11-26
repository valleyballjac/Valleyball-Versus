/**
 * Module: features/camera/viewportManager
 * Role: Manages the 4 `PlayerCamera` rigs, `CinematicCamera`, `spectatorCamera`, viewport/scissor splitscreen rendering (1-screen, 2-way, and 4-way quad), shadow/DPR render settings, and camera/headwear HUD toasts.
 * Frame Phase: Render (Camera Update & Viewport Scissor Pass) and UI Resize/Settings Events.
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Single authority for viewport aspect ratios, splitscreen scissor rectangles, and camera mode synchronization with `TUNING`.
 *   - LAW 8 (60 FPS Frame-Time Budget): Updates `renderer.shadowMap.needsUpdate = true` once per frame across all viewports and reuses pre-allocated quad viewport descriptors.
 */

import * as THREE from 'three';
import { TUNING } from '../../config/tuning.js';
import { PlayerCamera } from '../../visuals/playerCamera.js';
import { CinematicCamera } from '../../visuals/cinematicCamera.js';
import { updateCelestialSkybox, setSkyboxQuality } from '../../visuals/skybox.js';
import { getHudPrefs, setHudPrefs } from '../../config/hudConfig.js';
import { getPlayerSlotTheme } from '../ui/mainMenu/constants.js';

const MAX_LIVE_PIXEL_RATIO = 1.5;

const CAMERA_MODE_DISPLAY_NAMES = {
  firstPerson: '1ST PERSON (POV)',
  thirdPerson: '3RD PERSON (BALL TRACK)',
  ball: '3RD PERSON (BALL TRACK)',
  chase: 'CHASE (ACTION)',
  tactical: 'TACTICAL (OVERHEAD)',
  broadcast: 'BROADCAST (SIDELINE)',
  sports: 'BROADCAST (DYNAMIC)',
};

let cameraToastTimeout = null;
let cameraToastFadeTimeout = null;
let headwearToastTimeout = null;
let headwearToastFadeTimeout = null;

// Pre-allocated 4-way quad viewport descriptors to avoid per-frame allocations
const _quadViewports = [
  { slot: 0, x: 0, y: 0, w: 0, h: 0 },
  { slot: 1, x: 0, y: 0, w: 0, h: 0 },
  { slot: 2, x: 0, y: 0, w: 0, h: 0 },
  { slot: 3, x: 0, y: 0, w: 0, h: 0 },
];
const _humanSlotsScratch = [];
const _viewportLayoutPool = [
  { slot: -1, x: 0, y: 0, w: 0, h: 0, camera: null },
  { slot: -1, x: 0, y: 0, w: 0, h: 0, camera: null },
  { slot: -1, x: 0, y: 0, w: 0, h: 0, camera: null },
  { slot: -1, x: 0, y: 0, w: 0, h: 0, camera: null },
];

function setCameraAspectIfChanged(camera, aspect) {
  if (Math.abs(camera.aspect - aspect) > 1e-6) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
}

/**
 * Manages cameras, splitscreen viewports, shadow/DPR quality presets, and camera notifications.
 */
class ViewportManager {
  constructor() {
    this.renderer = null;
    this.scene = null;
    this.stadiumLights = [];
    this.ambientLight = null;
    this.hemisphereLight = null;
    this.turfParticles = null;
    this._shadowDirty = true;
    this._dividerEl = null;
    this._lastDividerDisplay = '';
    this._hDividerEl = null;
    this._lastHDividerDisplay = '';
    this._contextLost = false;
    this._contextOverlayEl = null;
    this._boundContextCanvas = null;
    this.lastViewportLayout = [];
    this.lastIsSplitscreen = false;
    this.getGameState = () => 'menu';
    this.getAthletes = () => [];
    this.getActiveBotSlots = () => [];
    this.onControlsOverlayChange = null;
    this.getGuiInstance = () => null;

    /** @type {PlayerCamera[]} */
    this.playerCameras = [
      new PlayerCamera(0, TUNING.players[0]?.cameraMode || 'chase'),
      new PlayerCamera(1, TUNING.players[1]?.cameraMode || 'chase'),
      new PlayerCamera(2, TUNING.players[2]?.cameraMode || 'chase'),
      new PlayerCamera(3, TUNING.players[3]?.cameraMode || 'chase'),
    ];

    this.spectatorCamera = new THREE.PerspectiveCamera(
      TUNING.camera.fov,
      typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight) : 16 / 9,
      TUNING.camera.near,
      TUNING.camera.far,
    );

    this.cinematicCamera = new CinematicCamera();

    this.playerCameras.forEach((pc) => {
      pc.onModeChange = (newMode, _prevMode, playerIndex) => {
        this.showCameraNotification(playerIndex, newMode);
      };
    });
  }

  /**
   * Initializes the viewport manager with the WebGLRenderer, Scene, stadium lights, and state accessors.
   *
   * @param {object} params
   * @param {THREE.WebGLRenderer} params.renderer
   * @param {THREE.Scene} params.scene
   * @param {THREE.DirectionalLight[]} [params.stadiumLights=[]]
   * @param {() => string} [params.getGameState]
   * @param {() => Array<object>} [params.getAthletes]
   * @param {() => number[]} [params.getActiveBotSlots]
   * @param {(enabled: boolean) => void} [params.onControlsOverlayChange]
   * @param {() => object|null} [params.getGuiInstance]
   */
  init({
    renderer,
    scene,
    playerCameras,
    cinematicCamera,
    spectatorCamera,
    stadiumLights = [],
    ambientLight = null,
    hemisphereLight = null,
    turfParticles = null,
    getGameState,
    getAthletes,
    getActiveBotSlots,
    onControlsOverlayChange,
    onControlsOverlayToggle,
    getGuiInstance,
    getGui,
  }) {
    this.renderer = renderer;
    this.scene = scene;
    if (playerCameras) this.playerCameras = playerCameras;
    if (cinematicCamera) this.cinematicCamera = cinematicCamera;
    if (spectatorCamera) this.spectatorCamera = spectatorCamera;
    this.stadiumLights = stadiumLights;
    this.ambientLight = ambientLight;
    this.hemisphereLight = hemisphereLight;
    this.turfParticles = turfParticles;
    if (getGameState) this.getGameState = getGameState;
    if (getAthletes) this.getAthletes = getAthletes;
    if (getActiveBotSlots) this.getActiveBotSlots = getActiveBotSlots;
    if (onControlsOverlayChange || onControlsOverlayToggle) {
      this.onControlsOverlayChange = onControlsOverlayChange || onControlsOverlayToggle;
    }
    if (getGuiInstance || getGui) {
      this.getGuiInstance = getGuiInstance || getGui;
    }

    if (this.getGameState) {
      const initialPreset = getHudPrefs().graphicsPreset || 'balanced';
      this.applyGraphicsPreset(initialPreset);
    } else {
      this.applyShadowSettings();
      this.applyViewportSize();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.applyViewportSize());
    }
    this._bindWebGLContextHandlers();
  }

  _setContextLostOverlay(visible) {
    if (typeof document === 'undefined') return;
    if (!this._contextOverlayEl && visible) {
      const el = document.createElement('div');
      el.id = 'webgl-context-overlay';
      el.style.cssText = `
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(6, 10, 16, 0.92);
        color: #f8fafc;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 16px;
        font-weight: 800;
        letter-spacing: 0.08em;
        z-index: 12000;
        text-align: center;
        padding: 24px;
      `;
      el.textContent = 'Display connection interrupted. Restoring arena...';
      document.body?.appendChild(el);
      this._contextOverlayEl = el;
    }
    if (this._contextOverlayEl) {
      this._contextOverlayEl.style.display = visible ? 'flex' : 'none';
    }
  }

  _bindWebGLContextHandlers() {
    const canvasEl = this.renderer?.domElement;
    if (!canvasEl || typeof canvasEl.addEventListener !== 'function' || this._boundContextCanvas === canvasEl) return;
    this._boundContextCanvas = canvasEl;
    canvasEl.addEventListener('webglcontextlost', (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      this._contextLost = true;
      this._setContextLostOverlay(true);
    }, false);
    canvasEl.addEventListener('webglcontextrestored', () => {
      this._contextLost = false;
      this._shadowDirty = true;
      if (this.renderer?.shadowMap) this.renderer.shadowMap.needsUpdate = true;
      this.applyViewportSize();
      this._setContextLostOverlay(false);
    }, false);
  }

  /**
   * Returns the slot indices (0..3) currently controlled by human players.
   *
   * @returns {number[]}
   */
  getActiveHumanSlots() {
    const athletes = this.getAthletes();
    const activeBotSlots = this.getActiveBotSlots();
    _humanSlotsScratch.length = 0;
    for (let i = 0; i < athletes.length; i++) {
      if (athletes[i]?.isEnabled && !activeBotSlots.includes(i)) {
        _humanSlotsScratch.push(i);
      }
    }
    if (_humanSlotsScratch.length === 0 && this.getGameState() === 'practice') {
      _humanSlotsScratch.push(0);
    }
    return _humanSlotsScratch;
  }

  /**
   * Syncs a player's camera mode back into `TUNING.players[playerIndex]` and `TUNING.camera.mode`.
   *
   * @param {number} playerIndex
   * @param {string} mode
   */
  syncPlayerCameraMode(playerIndex, mode) {
    const p = TUNING.players[playerIndex];
    if (p) p.cameraMode = mode;
    if (playerIndex === 0) TUNING.camera.mode = mode;
  }

  /**
   * When one player leaves a shared fullscreen camera (`broadcast` / `sports`) in splitscreen,
   * restores any other slot still on a shared mode back to its last player-centric camera.
   *
   * @param {number} changedPlayerIndex
   */
  leaveSharedCameraForOtherSlot(changedPlayerIndex) {
    if (!TUNING.camera.splitscreen) return;
    for (let otherIdx = 0; otherIdx < this.playerCameras.length; otherIdx++) {
      if (otherIdx === changedPlayerIndex) continue;
      const otherCam = this.playerCameras[otherIdx];
      if (otherCam && (otherCam.mode === 'broadcast' || otherCam.mode === 'sports')) {
        const fallback = otherCam._lastPlayerMode || 'chase';
        otherCam.setMode(fallback, true);
        this.syncPlayerCameraMode(otherIdx, otherCam.mode);
      }
    }
  }

  _isSplitscreenState(gameState, humanSlots) {
    return gameState === 'match' || gameState === 'overtime_menu' || (gameState === 'practice' && humanSlots.length >= 2);
  }

  /**
   * Cycles a player's camera mode across all available views.
   *
   * @param {number} [playerIndex=0]
   */
  cycleCameraMode(playerIndex = 0) {
    const pc = this.playerCameras[playerIndex] || this.playerCameras[0];
    const gameState = this.getGameState();
    const humanSlots = this.getActiveHumanSlots();
    const isSplitscreen = this._isSplitscreenState(gameState, humanSlots) && !!TUNING.camera.splitscreen && humanSlots.length >= 2;
    const mode = pc.cycleMode(isSplitscreen);
    this.syncPlayerCameraMode(playerIndex, mode);
    if (mode !== 'broadcast' && mode !== 'sports') this.leaveSharedCameraForOtherSlot(playerIndex);
    this.applyViewportSize();
  }

  /**
   * Cycles a player's personal camera (`firstPerson` <-> `chase` <-> `thirdPerson`).
   *
   * @param {number} [playerIndex=0]
   * @param {number} [delta=1]
   */
  cyclePlayerCameraView(playerIndex = 0, delta = 1) {
    const pc = this.playerCameras[playerIndex] || this.playerCameras[0];
    const mode = pc.cyclePlayerView(delta);
    this.syncPlayerCameraMode(playerIndex, mode);
    this.leaveSharedCameraForOtherSlot(playerIndex);
    this.applyViewportSize();
  }

  /**
   * Cycles a player's arena camera (`tactical` <-> `broadcast`).
   *
   * @param {number} [playerIndex=0]
   * @param {number} [delta=1]
   */
  cycleArenaCameraView(playerIndex = 0, delta = 1) {
    const pc = this.playerCameras[playerIndex] || this.playerCameras[0];
    const gameState = this.getGameState();
    const humanSlots = this.getActiveHumanSlots();
    const wasShared = humanSlots.length > 0 && humanSlots.every(
      (s) => this.playerCameras[s]?.mode === 'broadcast' || this.playerCameras[s]?.mode === 'sports',
    );
    const isSplitscreen = this._isSplitscreenState(gameState, humanSlots) && !!TUNING.camera.splitscreen && humanSlots.length >= 2 && !wasShared;
    const mode = pc.cycleArenaView(delta, isSplitscreen);
    this.syncPlayerCameraMode(playerIndex, mode);
    if (mode === 'broadcast' && TUNING.camera.splitscreen) {
      for (const s of humanSlots) {
        if (s === playerIndex) continue;
        this.playerCameras[s]?.setMode('broadcast', false);
        this.syncPlayerCameraMode(s, 'broadcast');
      }
    } else if (mode !== 'broadcast' && mode !== 'sports') {
      this.leaveSharedCameraForOtherSlot(playerIndex);
    }
    this.applyViewportSize();
  }

  /**
   * Applies `TUNING.camera.fov` across all camera instances.
   */
  applyCameraTuning() {
    for (const pc of this.playerCameras) {
      pc.camera.fov = TUNING.camera.fov;
      pc.camera.updateProjectionMatrix();
    }
    this.cinematicCamera.camera.fov = TUNING.camera.fov;
    this.cinematicCamera.camera.updateProjectionMatrix();
    this.spectatorCamera.fov = TUNING.camera.fov;
    this.spectatorCamera.updateProjectionMatrix();
  }

  /**
   * Sizes the renderer and updates camera aspect ratios for 1-screen, 2-way splitscreen, or 4-way quad splitscreen.
   */
  applyViewportSize() {
    if (!this.renderer || typeof window === 'undefined') return;
    const width = window.innerWidth;
    const height = window.innerHeight;

    const gameState = this.getGameState();
    const athletes = this.getAthletes();
    const humanSlots = this.getActiveHumanSlots();
    const isSharedCam = humanSlots.length > 0 && humanSlots.every(
      (s) => this.playerCameras[s]?.mode === 'broadcast' || this.playerCameras[s]?.mode === 'sports',
    );
    const isMatchState = this._isSplitscreenState(gameState, humanSlots);
    const isSplitscreen = isMatchState && !!TUNING.camera.splitscreen && (humanSlots.length >= 2 || (athletes.length >= 2 && !!TUNING.camera.forceQuadSplitscreen)) && !isSharedCam;
    const isQuadSplit = isSplitscreen && (humanSlots.length > 2 || (athletes.length >= 4 && !!TUNING.camera.forceQuadSplitscreen));

    let ratio = Math.min(window.devicePixelRatio || 1, MAX_LIVE_PIXEL_RATIO);
    const preset = TUNING.render?.pixelRatioPreset;
    if (preset === '1.0') {
      // On Low/1.0 preset, drop splitscreen slightly to keep browser/iGPU locked at 60 FPS
      ratio = isSplitscreen ? 0.85 : 1.0;
    } else if (preset === '1.25') {
      // Cap quad splitscreen (4 full passes/frame) at 0.85x so bar TVs & iGPUs hold 60 FPS
      ratio = isQuadSplit ? 0.85 : Math.min(isSplitscreen ? 1.0 : 1.25, window.devicePixelRatio || 1);
    } else if (preset === 'native') {
      ratio = Math.min(window.devicePixelRatio || 1, isQuadSplit ? 1.0 : (isSplitscreen ? 1.25 : MAX_LIVE_PIXEL_RATIO));
    }

    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height);
    this._shadowDirty = true;

    setCameraAspectIfChanged(this.cinematicCamera.camera, width / Math.max(1, height));
    setCameraAspectIfChanged(this.spectatorCamera, width / Math.max(1, height));

    // Broadcast and Sports cameras are full-screen only: if in individual splitscreen, revert them to chase.
    if (isSplitscreen) {
      const slotsToCheck = humanSlots.length > 0 ? humanSlots : [0, 1, 2, 3];
      for (const s of slotsToCheck) {
        if (this.playerCameras[s] && (this.playerCameras[s].mode === 'sports' || this.playerCameras[s].mode === 'broadcast')) {
          this.playerCameras[s].setMode('chase');
          this.syncPlayerCameraMode(s, 'chase');
        }
      }
    }

    const aspect = isQuadSplit
      ? (width / 2) / Math.max(1, height / 2)
      : (isSplitscreen ? (width / 2) / Math.max(1, height) : width / Math.max(1, height));

    for (const pc of this.playerCameras) {
      setCameraAspectIfChanged(pc.camera, aspect);
    }
  }

  /**
   * Applies shadow map quality preset (`off`, `balanced`, `high`) to the WebGLRenderer and stadium towers.
   */
  applyShadowSettings() {
    if (!this.renderer) return;
    const quality = TUNING.render?.shadowQuality || 'balanced';
    if (quality === 'off') {
      this.renderer.shadowMap.enabled = false;
      for (const light of this.stadiumLights) {
        light.castShadow = false;
      }
    } else if (quality === 'balanced') {
      this.renderer.shadowMap.enabled = true;
      if (this.stadiumLights.length > 0) {
        this.stadiumLights[0].castShadow = true;
      }
      for (let i = 1; i < this.stadiumLights.length; i++) {
        this.stadiumLights[i].castShadow = false;
      }
    } else {
      // 'high' - 2 opposing stadium towers cast crisp cross shadows without 4x shadow-pass stall
      this.renderer.shadowMap.enabled = true;
      for (let i = 0; i < this.stadiumLights.length; i++) {
        this.stadiumLights[i].castShadow = (i === 0 || i === 3);
      }
    }
    this._shadowDirty = true;
    this.renderer.shadowMap.needsUpdate = true;
  }

  /**
   * Applies a unified Low / Balanced / High graphics preset for universal hardware
   * compatibility (DPR, shadows, stadium light count, skybox starfield, turf budget).
   *
   * @param {'low'|'balanced'|'high'} preset
   */
  applyGraphicsPreset(preset = 'balanced') {
    const mode = preset === 'low' || preset === 'high' ? preset : 'balanced';
    setHudPrefs({ graphicsPreset: mode });
    setSkyboxQuality(mode);

    const isLow = mode === 'low';
    const isHigh = mode === 'high';
    // Balanced & Low use 1 primary DirectionalLight + HemisphereLight fill instead of
    // 4 per-pixel GGX directional lights, cutting PBR fragment shading cost by >50%
    // while keeping crisp shadows and balanced stadium illumination.
    for (let i = 0; i < this.stadiumLights.length; i++) {
      const light = this.stadiumLights[i];
      if (!light) continue;
      if (isHigh) {
        light.visible = (i === 0 || i === 3);
        light.intensity = 1.15;
      } else {
        light.visible = (i === 0);
        light.intensity = isLow ? 1.75 : 1.85;
      }
    }
    if (this.hemisphereLight) {
      this.hemisphereLight.visible = true;
      this.hemisphereLight.intensity = isHigh ? 0.80 : (isLow ? 1.15 : 1.05);
    }
    if (this.ambientLight) {
      this.ambientLight.intensity = this.hemisphereLight ? 0.20 : (isLow ? 0.85 : 0.45);
    }
    if (this.turfParticles?.setMaxParticles) {
      this.turfParticles.setMaxParticles(isLow ? 64 : 256);
    }

    const dprPreset = isLow ? '1.0' : (mode === 'high' ? 'native' : '1.25');
    const shadowMode = isLow ? 'off' : (mode === 'high' ? 'high' : 'balanced');
    this.applyRenderSettings({ pixelRatioPreset: dprPreset, shadowQuality: shadowMode });
  }

  /**
   * Applies runtime render settings from Main Menu or In-Game Settings modal.
   *
   * @param {object} [settings={}]
   */
  applyRenderSettings(settings = {}) {
    if (settings.graphicsPreset) {
      this.applyGraphicsPreset(settings.graphicsPreset);
      return;
    }
    if (settings.pixelRatioPreset) {
      if (!TUNING.render) TUNING.render = {};
      TUNING.render.pixelRatioPreset = settings.pixelRatioPreset;
      this.applyViewportSize();
    }
    if (settings.shadowQuality) {
      if (!TUNING.render) TUNING.render = {};
      TUNING.render.shadowQuality = settings.shadowQuality;
      this.applyShadowSettings();
    }
    if (settings.showControlsOverlay !== undefined && this.onControlsOverlayChange) {
      this.onControlsOverlayChange(settings.showControlsOverlay);
    }
    const guiInstance = this.getGuiInstance();
    if (settings.showTuningGui !== undefined && guiInstance) {
      if (settings.showTuningGui) {
        guiInstance.show();
      } else {
        guiInstance.hide();
      }
    }
    if (guiInstance) {
      guiInstance.controllersRecursive().forEach((c) => c.updateDisplay());
    }
  }

  /**
   * Displays a floating toast notification for camera mode changes, positioned inside the player's active viewport
   * across 1-screen (`50%`), 2-way splitscreen (`25%` / `75%`), and 4-way quad splitscreen (`25%` / `75%` x, top/bottom half y).
   *
   * @param {number} playerIndex
   * @param {string} mode
   */
  showCameraNotification(playerIndex, mode) {
    if (typeof document === 'undefined') return;
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen && loadingScreen.style.display !== 'none') return;

    let toast = document.getElementById('camera-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'camera-toast';
      document.body.appendChild(toast);
    }

    const gameState = this.getGameState();
    const athletes = this.getAthletes();
    const humanSlots = this.getActiveHumanSlots();
    const isSharedCam = humanSlots.length > 0 && humanSlots.every(
      (s) => this.playerCameras[s]?.mode === 'broadcast' || this.playerCameras[s]?.mode === 'sports',
    );
    const isMatchState = this._isSplitscreenState(gameState, humanSlots);
    const isSplitscreen = isMatchState && !!TUNING.camera.splitscreen && (humanSlots.length >= 2 || (athletes.length >= 2 && !!TUNING.camera.forceQuadSplitscreen)) && !isSharedCam;
    const isQuadSplit = isSplitscreen && (humanSlots.length > 2 || (athletes.length >= 4 && !!TUNING.camera.forceQuadSplitscreen));

    const displayName = CAMERA_MODE_DISPLAY_NAMES[mode] || mode.toUpperCase();
    const ath = athletes[playerIndex];
    const cfg = TUNING.players?.[playerIndex];
    const team = ath?.team || cfg?.team || ((playerIndex === 0 || playerIndex === 2) ? 'home' : 'away');
    const fallbackColor = team === 'away'
      ? (TUNING.teams?.away?.primaryColor ?? 0x1d4ed8)
      : (TUNING.teams?.home?.primaryColor ?? 0xd90429);
    const rawPrimary = ath?.primaryColor ?? cfg?.primaryColor ?? fallbackColor;
    const slotTheme = getPlayerSlotTheme(playerIndex, rawPrimary);
    const playerPrefix = isSplitscreen
      ? `<span style="color: ${slotTheme.hex}; font-weight: 800; margin-right: 6px;">P${playerIndex + 1}</span>`
      : '';

    toast.innerHTML = `${playerPrefix}<span style="color: #7dd3fc; margin-right: 6px;">CAMERA:</span><span style="color: #ffffff; font-weight: 800;">${displayName}</span>`;

    if (isQuadSplit) {
      // 2x2 grid: P1 (top-left), P2 (top-right), P3 (bottom-left), P4 (bottom-right)
      toast.style.left = (playerIndex === 0 || playerIndex === 2) ? '25%' : '75%';
      toast.style.top = (playerIndex < 2) ? '8%' : '58%';
    } else if (isSplitscreen) {
      const leftSlot = humanSlots[0] ?? 0;
      toast.style.left = (playerIndex === leftSlot || playerIndex === 0) ? '25%' : '75%';
      toast.style.top = '';
    } else {
      toast.style.left = '50%';
      toast.style.top = '';
    }

    toast.style.display = 'block';
    void toast.offsetWidth;
    toast.classList.remove('fade-out');
    toast.classList.add('visible');

    if (cameraToastTimeout) clearTimeout(cameraToastTimeout);
    if (cameraToastFadeTimeout) clearTimeout(cameraToastFadeTimeout);

    cameraToastTimeout = setTimeout(() => {
      toast.classList.remove('visible');
      toast.classList.add('fade-out');
      cameraToastFadeTimeout = setTimeout(() => {
        toast.style.display = 'none';
        cameraToastFadeTimeout = null;
      }, 350);
    }, 1300);
  }

  /**
   * Displays a floating toast notification when an athlete's headwear is cycled via debug hotkeys.
   *
   * @param {string} headwearLabel
   */
  showHeadwearToast(headwearLabel) {
    if (typeof document === 'undefined') return;
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen && loadingScreen.style.display !== 'none') return;

    let toast = document.getElementById('headwear-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'headwear-toast';
      document.body.appendChild(toast);
    }

    toast.innerHTML = `<span style="color: #f0abfc; margin-right: 6px;">HEADWEAR:</span><span style="color: #ffffff; font-weight: 800;">${headwearLabel}</span>`;
    toast.style.left = '50%';
    toast.style.display = 'block';
    void toast.offsetWidth;
    toast.classList.remove('fade-out');
    toast.classList.add('visible');

    if (headwearToastTimeout) clearTimeout(headwearToastTimeout);
    if (headwearToastFadeTimeout) clearTimeout(headwearToastFadeTimeout);

    headwearToastTimeout = setTimeout(() => {
      toast.classList.remove('visible');
      toast.classList.add('fade-out');
      headwearToastFadeTimeout = setTimeout(() => {
        toast.style.display = 'none';
        headwearToastFadeTimeout = null;
      }, 350);
    }, 1300);
  }

  /**
   * Renders the scene across 1-screen, 2-way horizontal splitscreen, or 4-way quad splitscreen,
   * keeping the celestial skybox centered on each active camera.
   *
   * @param {object} params
   * @param {string} params.gameState
   * @param {boolean} params.isVictoryActive
   * @param {Array<object>} params.athletes
   * @param {number[]} params.humanSlots
   */
  renderScene({ gameState, isVictoryActive, victoryCameraActive, matchState, athletes, humanSlots, stepsThisFrame = 1, replayFollowSlot = -1 }) {
    const renderer = this.renderer;
    const scene = this.scene;
    if (!renderer || !scene || this._contextLost) return;

    const victoryActive = isVictoryActive !== undefined
      ? isVictoryActive
      : ((gameState === 'match') && !!(matchState && matchState.matchOver) && !!victoryCameraActive);

    const isSharedCam = humanSlots.length > 0 && humanSlots.every(
      (s) => this.playerCameras[s]?.mode === 'broadcast' || this.playerCameras[s]?.mode === 'sports',
    );
    const isFreeDrone = this.cinematicCamera.mode === 'free';
    const isMatchState = this._isSplitscreenState(gameState, humanSlots);
    const isSplitscreen = !isFreeDrone && isMatchState && !!TUNING.camera.splitscreen && (humanSlots.length >= 2 || (athletes.length >= 2 && !!TUNING.camera.forceQuadSplitscreen)) && !isSharedCam && !victoryActive;
    const isQuadSplit = isSplitscreen && (humanSlots.length > 2 || (athletes.length >= 4 && !!TUNING.camera.forceQuadSplitscreen));
    this.lastIsSplitscreen = isSplitscreen;

    if (!this._dividerEl && typeof document !== 'undefined') {
      this._dividerEl = document.getElementById('splitscreen-divider');
    }
    if (!this._hDividerEl && typeof document !== 'undefined') {
      this._hDividerEl = document.getElementById('splitscreen-divider-h');
    }
    const nextDividerDisplay = isSplitscreen ? 'block' : 'none';
    if (this._dividerEl && this._lastDividerDisplay !== nextDividerDisplay) {
      this._dividerEl.style.display = nextDividerDisplay;
      this._lastDividerDisplay = nextDividerDisplay;
    }
    const nextHDividerDisplay = isQuadSplit ? 'block' : 'none';
    if (this._hDividerEl && this._lastHDividerDisplay !== nextHDividerDisplay) {
      this._hDividerEl.style.display = nextHDividerDisplay;
      this._lastHDividerDisplay = nextHDividerDisplay;
    }

    const width = window.innerWidth;
    const height = Math.max(1, window.innerHeight);

    // Update stadium shadow maps at most once per stepped simulation tick (60 Hz)
    // instead of redundantly on every interpolated 120/144/240 Hz display frame.
    if (stepsThisFrame > 0 || this._shadowDirty) {
      renderer.shadowMap.needsUpdate = true;
      this._shadowDirty = false;
    }

    this.lastViewportLayout.length = 0;

    if (gameState === 'menu' || gameState === 'flyover' || victoryActive || isFreeDrone) {
      setCameraAspectIfChanged(this.cinematicCamera.camera, width / height);
      updateCelestialSkybox(this.cinematicCamera.camera);
      renderer.setViewport(0, 0, width, height);
      renderer.render(scene, this.cinematicCamera.camera);
      if (isFreeDrone) {
        const freeEntry = _viewportLayoutPool[0];
        freeEntry.slot = -1; freeEntry.x = 0; freeEntry.y = 0; freeEntry.w = width; freeEntry.h = height; freeEntry.camera = this.cinematicCamera.camera;
        this.lastViewportLayout.push(freeEntry);
      }
    } else if (isQuadSplit) {
      // 4-Way Quad Splitscreen (2x2 Grid: Top-Left P1, Top-Right P2, Bottom-Left P3, Bottom-Right P4)
      const halfW = Math.floor(width / 2);
      const halfH = Math.floor(height / 2);
      _quadViewports[0].x = 0; _quadViewports[0].y = halfH; _quadViewports[0].w = halfW; _quadViewports[0].h = height - halfH;
      _quadViewports[1].x = halfW; _quadViewports[1].y = halfH; _quadViewports[1].w = width - halfW; _quadViewports[1].h = height - halfH;
      _quadViewports[2].x = 0; _quadViewports[2].y = 0; _quadViewports[2].w = halfW; _quadViewports[2].h = halfH;
      _quadViewports[3].x = halfW; _quadViewports[3].y = 0; _quadViewports[3].w = width - halfW; _quadViewports[3].h = halfH;

      renderer.setScissorTest(true);
      for (let qIdx = 0; qIdx < 4; qIdx++) {
        const q = _quadViewports[qIdx];
        const pc = this.playerCameras[q.slot] || this.playerCameras[0];
        for (let i = 0; i < athletes.length; i++) {
          athletes[i]?.setHeadVisible?.(i === q.slot ? pc.mode !== 'firstPerson' : true);
        }
        setCameraAspectIfChanged(pc.camera, q.w / Math.max(1, q.h));
        updateCelestialSkybox(pc.camera);
        renderer.setViewport(q.x, q.y, q.w, q.h);
        renderer.setScissor(q.x, q.y, q.w, q.h);
        renderer.render(scene, pc.camera);

        const entry = _viewportLayoutPool[qIdx];
        entry.slot = q.slot; entry.x = q.x; entry.y = q.y; entry.w = q.w; entry.h = q.h; entry.camera = pc.camera;
        this.lastViewportLayout.push(entry);
      }
      for (let i = 0; i < athletes.length; i++) athletes[i]?.setHeadVisible?.(true);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, width, height);
    } else if (isSplitscreen) {
      const halfW = Math.floor(width / 2);
      const leftSlot = humanSlots[0] ?? 0;
      const rightSlot = humanSlots[1] ?? 1;

      renderer.setScissorTest(true);

      // Left Viewport
      for (let i = 0; i < athletes.length; i++) {
        athletes[i]?.setHeadVisible?.(i === leftSlot ? this.playerCameras[leftSlot].mode !== 'firstPerson' : true);
      }
      setCameraAspectIfChanged(this.playerCameras[leftSlot].camera, halfW / height);
      updateCelestialSkybox(this.playerCameras[leftSlot].camera);
      renderer.setViewport(0, 0, halfW, height);
      renderer.setScissor(0, 0, halfW, height);
      renderer.render(scene, this.playerCameras[leftSlot].camera);

      const leftEntry = _viewportLayoutPool[0];
      leftEntry.slot = leftSlot; leftEntry.x = 0; leftEntry.y = 0; leftEntry.w = halfW; leftEntry.h = height; leftEntry.camera = this.playerCameras[leftSlot].camera;
      this.lastViewportLayout.push(leftEntry);

      // Right Viewport
      for (let i = 0; i < athletes.length; i++) {
        athletes[i]?.setHeadVisible?.(i === rightSlot ? this.playerCameras[rightSlot].mode !== 'firstPerson' : true);
      }
      setCameraAspectIfChanged(this.playerCameras[rightSlot].camera, (width - halfW) / height);
      updateCelestialSkybox(this.playerCameras[rightSlot].camera);
      renderer.setViewport(halfW, 0, width - halfW, height);
      renderer.setScissor(halfW, 0, width - halfW, height);
      renderer.render(scene, this.playerCameras[rightSlot].camera);

      const rightEntry = _viewportLayoutPool[1];
      rightEntry.slot = rightSlot; rightEntry.x = halfW; rightEntry.y = 0; rightEntry.w = width - halfW; rightEntry.h = height; rightEntry.camera = this.playerCameras[rightSlot].camera;
      this.lastViewportLayout.push(rightEntry);

      // Restore head visibility after viewports
      for (let i = 0; i < athletes.length; i++) athletes[i]?.setHeadVisible?.(true);

      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, width, height);
    } else {
      // Single Viewport (Practice, 1 human vs AI, AI vs AI spectator, shared camera, or Replay POV)
      let activeRenderCamera = this.playerCameras[0].camera;
      let activeAthleteSlot = 0;
      if (replayFollowSlot >= 0 && replayFollowSlot < this.playerCameras.length && athletes[replayFollowSlot]?.isEnabled) {
        activeAthleteSlot = replayFollowSlot;
        activeRenderCamera = this.playerCameras[replayFollowSlot].camera;
      } else if (humanSlots.length === 0) {
        // All-AI spectator broadcast camera
        activeRenderCamera = this.spectatorCamera;
        activeAthleteSlot = -1;
      } else if (humanSlots.length === 1) {
        // Single human vs AI: ensure the camera renders the human player's viewport
        activeAthleteSlot = humanSlots[0];
        activeRenderCamera = this.playerCameras[activeAthleteSlot].camera;
      }

      const isFp = activeAthleteSlot >= 0 && this.playerCameras[activeAthleteSlot]?.mode === 'firstPerson';
      if (activeAthleteSlot >= 0 && athletes[activeAthleteSlot]?.setHeadVisible) {
        athletes[activeAthleteSlot].setHeadVisible(!isFp);
      }

      setCameraAspectIfChanged(activeRenderCamera, width / height);
      updateCelestialSkybox(activeRenderCamera);
      renderer.setViewport(0, 0, width, height);
      renderer.render(scene, activeRenderCamera);

      const singleEntry = _viewportLayoutPool[0];
      singleEntry.slot = activeAthleteSlot; singleEntry.x = 0; singleEntry.y = 0; singleEntry.w = width; singleEntry.h = height; singleEntry.camera = activeRenderCamera;
      this.lastViewportLayout.push(singleEntry);

      if (activeAthleteSlot >= 0 && athletes[activeAthleteSlot]?.setHeadVisible) {
        athletes[activeAthleteSlot].setHeadVisible(true);
      }
    }
  }
}

export const viewportManager = new ViewportManager();
export const showCameraNotification = (playerIndex, mode) => viewportManager.showCameraNotification(playerIndex, mode);
export const showHeadwearToast = (headwearLabel) => viewportManager.showHeadwearToast(headwearLabel);
export { ViewportManager };
