/**
 * Module: config/hudConfig
 * Role: Runtime-toggleable readability HUD & graphics preset preferences
 *   (Broadcast Scorebug, 3D Rainbow Ball Halo, Player Strike-Range Guide,
 *   Off-Screen Ball Pip & Swap Cues, and Low/Balanced/High Graphics Preset).
 *   All HUD/guide options default to OFF so live play and replay footage stay
 *   clean unless explicitly enabled, and every toggle can be switched live
 *   during both matches and replay playback.
 * Frame Phase: UI Settings events and read-only Render pass queries.
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Pure visual preferences; never read by simulation.
 *   - LAW 6 (Determinism): Deterministic capture / fixture runs always force defaults.
 */

const STORAGE_KEY = 'valleyball_hud_prefs_v1';
const VALID_SCOREBUG_MODES = new Set(['off', 'splitscreen', 'always']);
const VALID_GRAPHICS_PRESETS = new Set(['low', 'balanced', 'high']);

export const DEFAULT_HUD_PREFS = Object.freeze({
  scorebugMode: 'off',
  ballDropRing: false,
  strikeRangeGuide: false,
  orientationCues: false,
  graphicsPreset: 'balanced',
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

const currentPrefs = {
  scorebugMode: DEFAULT_HUD_PREFS.scorebugMode,
  ballDropRing: DEFAULT_HUD_PREFS.ballDropRing,
  strikeRangeGuide: DEFAULT_HUD_PREFS.strikeRangeGuide,
  orientationCues: DEFAULT_HUD_PREFS.orientationCues,
  graphicsPreset: DEFAULT_HUD_PREFS.graphicsPreset,
};

function sanitizeInto(target, source) {
  if (!source || typeof source !== 'object') return false;
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
  if (typeof source.graphicsPreset === 'string' && VALID_GRAPHICS_PRESETS.has(source.graphicsPreset)) {
    if (target.graphicsPreset !== source.graphicsPreset) {
      target.graphicsPreset = source.graphicsPreset;
      changed = true;
    }
  }
  return changed;
}

function loadSavedPrefs() {
  if (isDeterministicRun()) return;
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    sanitizeInto(currentPrefs, JSON.parse(raw));
  } catch {
    // Ignore storage read errors in restricted iframes / private browsing.
  }
}

function persistPrefs() {
  if (isDeterministicRun()) return;
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPrefs));
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
    !currentPrefs.orientationCues
  );
}

/**
 * Restores all preferences (including graphics preset) to shipped defaults.
 */
export function resetHudPrefs() {
  return setHudPrefs(DEFAULT_HUD_PREFS);
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
