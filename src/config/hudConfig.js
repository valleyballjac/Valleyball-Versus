/**
 * Module: config/hudConfig
 * Role: Runtime-toggleable readability HUD and graphics preset preferences
 *   (Broadcast Scorebug, 3D Rainbow Ball Halo, Player Strike-Range Guide,
 *   Off-Screen Ball Pip and Swap Cues, Controls Overlay, and Low/Balanced/High Graphics Preset).
 *   Ships with 3 presets: Minimal / Clean Broadcast, Standard (default), and Rookie / Live Room.
 *   Deterministic capture or fixture runs always force Minimal / Clean Broadcast defaults.
 * Frame Phase: UI Settings events and read-only Render pass queries.
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Pure visual preferences; never read by simulation.
 *   - LAW 6 (Determinism): Deterministic capture / fixture runs always force clean defaults.
 */

import { TUNING } from './tuning.js';

const STORAGE_KEY = 'valleyball_hud_prefs_v1';
const FIRST_TIME_SETUP_KEY = 'valleyball_first_setup_v1';
const VALID_SCOREBUG_MODES = new Set(['off', 'splitscreen', 'always']);
const VALID_GRAPHICS_PRESETS = new Set(['low', 'balanced', 'high']);
const VALID_DPR_PRESETS = new Set(['1.0', '1.25', 'native']);
const VALID_SHADOW_MODES = new Set(['off', 'balanced', 'high']);
const VALID_SHAKE_MODES = new Set(['off', 'subtle', 'full']);

export const CLEAN_HUD_PREFS = Object.freeze({
  scorebugMode: 'off',
  ballDropRing: false,
  strikeRangeGuide: false,
  orientationCues: false,
  controlsOverlay: false,
  graphicsPreset: 'balanced',
});

export const STANDARD_HUD_PREFS = Object.freeze({
  scorebugMode: 'splitscreen',
  ballDropRing: true,
  strikeRangeGuide: false,
  orientationCues: true,
  controlsOverlay: false,
  graphicsPreset: 'balanced',
});

export const ROOKIE_HUD_PREFS = Object.freeze({
  scorebugMode: 'always',
  ballDropRing: true,
  strikeRangeGuide: true,
  orientationCues: true,
  controlsOverlay: true,
  graphicsPreset: 'balanced',
});

export const DEFAULT_HUD_PREFS = STANDARD_HUD_PREFS;

const HUD_PRESETS = Object.freeze({
  minimal: CLEAN_HUD_PREFS,
  standard: STANDARD_HUD_PREFS,
  rookie: ROOKIE_HUD_PREFS,
});

function isDeterministicRun() {
  if (typeof window === 'undefined' || !window.location) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.has('captureTick') || params.has('fixture') || params.has('stateTrace');
  } catch {
    return false;
  }
}

const bootDefaults = isDeterministicRun() ? CLEAN_HUD_PREFS : DEFAULT_HUD_PREFS;

const currentPrefs = {
  scorebugMode: bootDefaults.scorebugMode,
  ballDropRing: bootDefaults.ballDropRing,
  strikeRangeGuide: bootDefaults.strikeRangeGuide,
  orientationCues: bootDefaults.orientationCues,
  controlsOverlay: bootDefaults.controlsOverlay,
  graphicsPreset: bootDefaults.graphicsPreset,
};

function syncControlsHudTuning() {
  if (TUNING?.controlsHud) {
    TUNING.controlsHud.userEnabled = isDeterministicRun() ? false : Boolean(currentPrefs.controlsOverlay);
  }
}

function getLocalStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

function sanitizeInto(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  let changed = false;
  if (typeof source.scorebugMode === 'string' && VALID_SCOREBUG_MODES.has(source.scorebugMode)) {
    if (target.scorebugMode !== source.scorebugMode) {
      target.scorebugMode = source.scorebugMode;
      changed = true;
    }
  }
  if (typeof source.ballDropRing === 'boolean' && target.ballDropRing !== source.ballDropRing) {
    target.ballDropRing = source.ballDropRing;
    changed = true;
  }
  if (typeof source.strikeRangeGuide === 'boolean' && target.strikeRangeGuide !== source.strikeRangeGuide) {
    target.strikeRangeGuide = source.strikeRangeGuide;
    changed = true;
  }
  if (typeof source.orientationCues === 'boolean' && target.orientationCues !== source.orientationCues) {
    target.orientationCues = source.orientationCues;
    changed = true;
  }
  if (typeof source.controlsOverlay === 'boolean' && target.controlsOverlay !== source.controlsOverlay) {
    target.controlsOverlay = source.controlsOverlay;
    changed = true;
  }
  if (typeof source.graphicsPreset === 'string' && VALID_GRAPHICS_PRESETS.has(source.graphicsPreset)) {
    if (target.graphicsPreset !== source.graphicsPreset) {
      target.graphicsPreset = source.graphicsPreset;
      changed = true;
    }
  }
  return changed;
}

function loadSavedPrefs() {
  if (isDeterministicRun()) {
    sanitizeInto(currentPrefs, CLEAN_HUD_PREFS);
    syncControlsHudTuning();
    return;
  }
  const storage = getLocalStorage();
  if (storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        sanitizeInto(currentPrefs, JSON.parse(raw));
      }
    } catch {
      // Ignore storage read errors in restricted iframes / private browsing.
    }
  }
  syncControlsHudTuning();
}

function persistPrefs() {
  if (isDeterministicRun()) return;
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(currentPrefs));
  } catch {
    // Ignore storage quota or sandbox errors.
  }
}

loadSavedPrefs();

const listeners = new Set();

/**
 * Returns the live HUD and graphics preferences object without allocating.
 * Treat the returned object as read-only; mutate through `setHudPrefs()`.
 */
export function getHudPrefs() {
  return currentPrefs;
}

/**
 * Updates one or more HUD/graphics preferences, persists to localStorage, and notifies subscribers.
 *
 * @param {Partial<typeof DEFAULT_HUD_PREFS>} partial
 * @returns {typeof currentPrefs}
 */
export function setHudPrefs(partial, { persist = true } = {}) {
  const changed = sanitizeInto(currentPrefs, partial);
  if (changed) {
    syncControlsHudTuning();
    if (persist) persistPrefs();
    for (const fn of listeners) {
      try {
        fn(currentPrefs);
      } catch {
        // Keep other listeners synced even if one UI panel is unmounted.
      }
    }
  }
  return currentPrefs;
}

/**
 * Restores all optional HUD readability overlays and 3D guides to OFF while
 * preserving the user's chosen graphics quality preset (ideal for clean broadcast
 * or replay capture footage).
 */
export function setCleanBroadcastHud() {
  return setHudPrefs({
    scorebugMode: 'off',
    ballDropRing: false,
    strikeRangeGuide: false,
    orientationCues: false,
    controlsOverlay: false,
  });
}

/**
 * Returns true when every optional HUD overlay and 3D guide is OFF.
 */
export function isCleanBroadcastHud() {
  return (
    currentPrefs.scorebugMode === 'off' &&
    !currentPrefs.ballDropRing &&
    !currentPrefs.strikeRangeGuide &&
    !currentPrefs.orientationCues &&
    !currentPrefs.controlsOverlay
  );
}

/**
 * Applies one of the 3 named HUD presets ('minimal', 'standard', 'rookie')
 * while preserving the user's chosen graphics quality preset.
 */
export function applyHudPreset(presetId) {
  const preset = typeof presetId === 'string' ? HUD_PRESETS[presetId] : null;
  if (!preset) return currentPrefs;
  return setHudPrefs({
    scorebugMode: preset.scorebugMode,
    ballDropRing: preset.ballDropRing,
    strikeRangeGuide: preset.strikeRangeGuide,
    orientationCues: preset.orientationCues,
    controlsOverlay: preset.controlsOverlay,
  });
}

function matchesHudPreset(prefs, preset) {
  return (
    prefs.scorebugMode === preset.scorebugMode &&
    Boolean(prefs.ballDropRing) === preset.ballDropRing &&
    Boolean(prefs.strikeRangeGuide) === preset.strikeRangeGuide &&
    Boolean(prefs.orientationCues) === preset.orientationCues &&
    Boolean(prefs.controlsOverlay) === preset.controlsOverlay
  );
}

/**
 * Returns 'minimal', 'standard', 'rookie', or 'custom' for the active HUD toggles.
 */
export function getActiveHudPresetId() {
  if (matchesHudPreset(currentPrefs, CLEAN_HUD_PREFS)) return 'minimal';
  if (matchesHudPreset(currentPrefs, STANDARD_HUD_PREFS)) return 'standard';
  if (matchesHudPreset(currentPrefs, ROOKIE_HUD_PREFS)) return 'rookie';
  return 'custom';
}

/**
 * Restores all preferences (including graphics preset) to shipped defaults.
 */
export function resetHudPrefs() {
  return setHudPrefs(isDeterministicRun() ? CLEAN_HUD_PREFS : DEFAULT_HUD_PREFS);
}

/**
 * Subscribes to preference updates so Main Menu Settings, In-Game Pause,
 * and Replay Broadcast controls stay in sync.
 *
 * @param {(prefs: typeof currentPrefs) => void} listener
 * @returns {() => void} unsubscribe callback
 */
export function subscribeHudPrefs(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Returns true if the player has already completed the First-Time Setup flow.
 */
export function hasCompletedFirstTimeSetup() {
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    return storage.getItem(FIRST_TIME_SETUP_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Marks the First-Time Setup flow as completed in localStorage.
 */
export function markFirstTimeSetupCompleted() {
  if (isDeterministicRun()) return;
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(FIRST_TIME_SETUP_KEY, '1');
  } catch {
    // Ignore storage quota or sandbox errors.
  }
}

/**
 * Returns true when First-Time Setup should open automatically at boot.
 * Skips deterministic runs and automated WebDriver smoke harnesses unless ?firstSetup=1 is set.
 */
export function shouldAutoShowFirstTimeSetup() {
  if (isDeterministicRun()) return false;
  if (typeof window !== 'undefined' && window.location) {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('firstSetup') === '1') return true;
      if (params.get('firstSetup') === '0') return false;
    } catch {
      // Ignore malformed location search strings.
    }
  }
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
  return !hasCompletedFirstTimeSetup();
}

/**
 * Reads current render quality settings from TUNING.render and HUD preferences.
 */
export function getRenderQualitySettings() {
  return {
    graphicsPreset: currentPrefs.graphicsPreset || 'balanced',
    pixelRatioPreset: TUNING?.render?.pixelRatioPreset || '1.25',
    shadowQuality: TUNING?.render?.shadowQuality || 'balanced',
  };
}

/**
 * Applies render quality updates to TUNING.render and hudConfig without raw external TUNING writes.
 */
export function setRenderQualitySettings({ graphicsPreset, pixelRatioPreset, shadowQuality } = {}) {
  if (!TUNING.render) TUNING.render = {};
  let nextDpr = pixelRatioPreset;
  let nextShadow = shadowQuality;
  if (typeof graphicsPreset === 'string' && VALID_GRAPHICS_PRESETS.has(graphicsPreset)) {
    setHudPrefs({ graphicsPreset });
    if (!nextDpr) nextDpr = graphicsPreset === 'low' ? '1.0' : (graphicsPreset === 'high' ? 'native' : '1.25');
    if (!nextShadow) nextShadow = graphicsPreset === 'low' ? 'off' : (graphicsPreset === 'high' ? 'high' : 'balanced');
  }
  if (typeof nextDpr === 'string' && VALID_DPR_PRESETS.has(nextDpr)) {
    TUNING.render.pixelRatioPreset = nextDpr;
  }
  if (typeof nextShadow === 'string' && VALID_SHADOW_MODES.has(nextShadow)) {
    TUNING.render.shadowQuality = nextShadow;
  }
  return getRenderQualitySettings();
}

/**
 * Reads or updates camera screen-shake mode ('off' | 'subtle' | 'full').
 */
export function getCameraShakeMode() {
  return TUNING?.camera?.shake?.mode || (TUNING?.camera?.shake?.enabled === false ? 'off' : 'subtle');
}

export function setCameraShakeMode(mode) {
  if (!VALID_SHAKE_MODES.has(mode)) return getCameraShakeMode();
  if (!TUNING.camera) TUNING.camera = {};
  if (!TUNING.camera.shake) TUNING.camera.shake = {};
  TUNING.camera.shake.mode = mode;
  TUNING.camera.shake.enabled = mode !== 'off';
  TUNING.camera.shake.multiplier = mode === 'off' ? 0.0 : (mode === 'full' ? 1.0 : 0.6);
  return mode;
}

export function setDefaultCameraMode(mode) {
  if (typeof mode !== 'string' || !mode) return;
  if (!TUNING.camera) TUNING.camera = {};
  TUNING.camera.mode = mode;
}

/**
 * Updates TUNING.athlete.palette and TUNING.teams colors cleanly from active player configs.
 */
export function syncTeamPaletteColors({ homeColor, awayColor, homeName, awayName } = {}) {
  if (TUNING?.athlete?.palette) {
    if (typeof homeColor === 'number' && Number.isFinite(homeColor)) {
      TUNING.athlete.palette.homePrimary = homeColor;
    }
    if (typeof awayColor === 'number' && Number.isFinite(awayColor)) {
      TUNING.athlete.palette.awayPrimary = awayColor;
    }
  }
  if (TUNING?.teams) {
    if (TUNING.teams.home) {
      if (typeof homeColor === 'number' && Number.isFinite(homeColor)) TUNING.teams.home.primaryColor = homeColor;
      if (homeName) TUNING.teams.home.name = homeName;
    }
    if (TUNING.teams.away) {
      if (typeof awayColor === 'number' && Number.isFinite(awayColor)) TUNING.teams.away.primaryColor = awayColor;
      if (awayName) TUNING.teams.away.name = awayName;
    }
  }
}
