/**
 * @module debug/hotkeys
 * Developer and in-match keyboard shortcuts (ragdoll respawn, knockdown,
 * telemetry HUD toggle, per-player team/silhouette/headwear cycling for P1-P4,
 * splitscreen toggle, flyover skip, and in-game pause menu toggle).
 */

import { TUNING } from '../config/tuning.js';
import { getNextHeadwearId, getHeadwearLabel } from '../config/cosmetics.js';

const VARIANTS = ['masculine', 'feminine', 'classic'];

/**
 * Shared guard: a hotkey must not fire while the user is typing in a tuning
 * or text field, and key auto-repeat must not fire it sixty times a second.
 *
 * @param {KeyboardEvent} event
 * @param {string} code
 * @returns {boolean}
 */
export function isHotkey(event, code) {
  if (event.code !== code || event.repeat) return false;
  const target = event.target;
  if (target && target.tagName) {
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
      return false;
    }
  }
  return true;
}

function refreshGui(getGui) {
  const gui = getGui?.();
  if (gui) gui.controllersRecursive().forEach((c) => c.updateDisplay());
}

function togglePlayerTeam(slotIdx, getAthletes, getGui) {
  const athletes = getAthletes?.() || [];
  const p = TUNING.players?.[slotIdx] || (slotIdx === 0 ? TUNING.athlete : null);
  if (!p) return;
  p.team = p.team === 'home' ? 'away' : 'home';
  if (slotIdx === 0 && TUNING.athlete) TUNING.athlete.team = p.team;
  if (athletes[slotIdx]) athletes[slotIdx].setTeamAndVariant(p.team, null);
  refreshGui(getGui);
}

function cyclePlayerVariant(slotIdx, getAthletes, getGui) {
  const athletes = getAthletes?.() || [];
  const p = TUNING.players?.[slotIdx] || (slotIdx === 0 ? TUNING.athlete : null);
  if (!p) return;
  const nextIdx = (VARIANTS.indexOf(p.variant) + 1) % VARIANTS.length;
  p.variant = VARIANTS[nextIdx];
  if (slotIdx === 0 && TUNING.athlete) TUNING.athlete.variant = p.variant;
  if (athletes[slotIdx]) athletes[slotIdx].setTeamAndVariant(null, p.variant);
  refreshGui(getGui);
}

function cyclePlayerHeadwear(slotIdx, getAthletes, headwearControls, onShowHeadwearToast, getGui) {
  const athletes = getAthletes?.() || [];
  const athlete = athletes[slotIdx];
  if (!athlete) return;
  const next = getNextHeadwearId(athlete.headwear);
  athlete.setHeadwear(next);
  if (TUNING.players?.[slotIdx]) TUNING.players[slotIdx].headwear = next;
  const key = `p${slotIdx + 1}`;
  if (headwearControls && key in headwearControls) {
    headwearControls[key] = next;
  }
  onShowHeadwearToast?.(getHeadwearLabel(next));
  refreshGui(getGui);
}

/**
 * Installs global developer and match hotkeys on `window`.
 *
 * @param {object} handlers
 * @param {() => object[]} handlers.getAthletes
 * @param {() => string} handlers.getGameState
 * @param {() => object|null} [handlers.getGui]
 * @param {object} [handlers.headwearControls]
 * @param {() => void} handlers.onRequestRespawn
 * @param {(visible: boolean) => void} handlers.onHudToggle
 * @param {() => void} handlers.onSplitscreenToggle
 * @param {() => void} handlers.onSkipFlyover
 * @param {() => void} handlers.onToggleInGameMenu
 * @param {(label: string) => void} [handlers.onShowHeadwearToast]
 */
export function installHotkeys({
  getAthletes,
  getGameState,
  getGui,
  headwearControls,
  onRequestRespawn,
  onHudToggle,
  onSplitscreenToggle,
  onSkipFlyover,
  onToggleInGameMenu,
  onShowHeadwearToast,
}) {
  window.addEventListener('keydown', (event) => {
    // BACKSPACE — respawn ragdoll(s) on the next fixed tick
    if (isHotkey(event, 'Backspace')) {
      onRequestRespawn?.();
    }

    // "T" — knockdown all active athletes on the next fixed tick
    if (isHotkey(event, 'KeyT')) {
      const athletes = getAthletes?.() || [];
      for (const a of athletes) a?.requestKnockdown?.();
    }

    // "Shift+H" or "F3" — toggle developer telemetry HUD
    if (isHotkey(event, 'F3') || (isHotkey(event, 'KeyH') && event.shiftKey)) {
      TUNING.debug.showHud = !TUNING.debug.showHud;
      onHudToggle?.(TUNING.debug.showHud);
      refreshGui(getGui);
    }

    // P1: Digit1 (Team), Digit2 (Silhouette), Digit3 (Headwear)
    if (isHotkey(event, 'Digit1') && !event.shiftKey) {
      togglePlayerTeam(0, getAthletes, getGui);
    }
    if (isHotkey(event, 'Digit2') && !event.shiftKey) {
      cyclePlayerVariant(0, getAthletes, getGui);
    }
    if (isHotkey(event, 'Digit3') && !event.shiftKey) {
      cyclePlayerHeadwear(0, getAthletes, headwearControls, onShowHeadwearToast, getGui);
    }

    // P2: Digit9 (Team), Digit0 (Silhouette), Digit8 (Headwear)
    if (isHotkey(event, 'Digit9') && !event.shiftKey) {
      togglePlayerTeam(1, getAthletes, getGui);
    }
    if (isHotkey(event, 'Digit0') && !event.shiftKey) {
      cyclePlayerVariant(1, getAthletes, getGui);
    }
    if (isHotkey(event, 'Digit8') && !event.shiftKey) {
      cyclePlayerHeadwear(1, getAthletes, headwearControls, onShowHeadwearToast, getGui);
    }

    // P3: Digit4 (Team), Digit5 (Silhouette), Digit6 (Headwear)
    if (isHotkey(event, 'Digit4') && !event.shiftKey) {
      togglePlayerTeam(2, getAthletes, getGui);
    }
    if (isHotkey(event, 'Digit5') && !event.shiftKey) {
      cyclePlayerVariant(2, getAthletes, getGui);
    }
    if (isHotkey(event, 'Digit6') && !event.shiftKey) {
      cyclePlayerHeadwear(2, getAthletes, headwearControls, onShowHeadwearToast, getGui);
    }

    // P4: Digit7 (Team), Shift+Digit7 (Silhouette), Shift+Digit6 (Headwear)
    if (isHotkey(event, 'Digit7') && !event.shiftKey) {
      togglePlayerTeam(3, getAthletes, getGui);
    }
    if (isHotkey(event, 'Digit7') && event.shiftKey) {
      cyclePlayerVariant(3, getAthletes, getGui);
    }
    if (isHotkey(event, 'Digit6') && event.shiftKey) {
      cyclePlayerHeadwear(3, getAthletes, headwearControls, onShowHeadwearToast, getGui);
    }

    // "F8" or "Shift+V" — toggle splitscreen mode
    if (isHotkey(event, 'F8') || (isHotkey(event, 'KeyV') && event.shiftKey)) {
      TUNING.camera.splitscreen = !TUNING.camera.splitscreen;
      onSplitscreenToggle?.();
      refreshGui(getGui);
    }

    const gameState = getGameState?.() || 'menu';

    // Skip flyover cutscene with Space, Enter, or Escape
    if (gameState === 'flyover' && (isHotkey(event, 'Space') || isHotkey(event, 'Enter') || isHotkey(event, 'Escape'))) {
      onSkipFlyover?.();
      return;
    }

    // "Escape" — toggle in-game settings & pause menu (outside title menu and overtime agreement modal)
    if (isHotkey(event, 'Escape') && gameState !== 'menu' && gameState !== 'overtime_menu') {
      onToggleInGameMenu?.();
    }
  });
}
