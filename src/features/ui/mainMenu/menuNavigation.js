import { soundManager } from '../../../audio/soundManager.js';
import { state } from './state.js';
import {
  getControllerAssignments,
  getAssignedSlotForPad,
  getExplicitDeviceMappings,
  getMatchSlotForKeyset,
  assignPadToSlot,
} from '../../../input/inputRouter.js';
import { createMenuPadTracker, MENU_PAD } from '../../../input/menuPads.js';
import { hideMainMenuSettingsModal, getMainMenuSettingsModalEl } from './settingsModal.js';
import { getFirstTimeSetupModalEl } from './firstTimeSetupModal.js';
import { hideHowToPlayModal, getControlsModalEl } from './howToPlayModal.js';
import { updateTitleFocusUI, updateTitleHostPrompt } from './titleScreen.js';

import { pollAssignmentGamepads, handleAssignmentKey } from './controllerAssignment.js';

let navCallbacks = {
  showTitleScreen: null,
  showPlayerSetup: null,
  getTitleScreenEl: null,
  getTitleButtons: null,
  getTitleFocusIndex: null,
  setTitleFocusIndex: null,
  playerSetup: null,
};

// One tracker for every main-menu screen: it is shared across title -> assignment ->
// lobby, so a button held through a screen change stays "already down" on the next one.
const menuPads = createMenuPadTracker();
const padTargetSlot = {};

/** Clears any cached P1->AI column targeting whenever entering a fresh menu screen. */
export function resetMenuPadTargets() {
  for (const key in padTargetSlot) {
    delete padTargetSlot[key];
  }
}

export function setMenuNavigationContext(ctx = {}) {
  Object.assign(navCallbacks, ctx);
}

export function triggerMenuHaptics(pad, duration = 35, weak = 0.25, strong = 0.1) {
  if (!pad) return;
  try {
    if (pad.vibrationActuator && typeof pad.vibrationActuator.playEffect === 'function') {
      pad.vibrationActuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: duration,
        weakMagnitude: weak,
        strongMagnitude: strong,
      }).catch(() => {});
    } else if (pad.hapticActuators && pad.hapticActuators[0] && typeof pad.hapticActuators[0].pulse === 'function') {
      pad.hapticActuators[0].pulse(weak, duration);
    }
  } catch (_) {}
}

export function moveScreen1Row(col, delta, ownerSlot = -1) {
  if (!navCallbacks.playerSetup) return;
  let cur = navCallbacks.playerSetup.playerFocusRow[col];
  const isAi = navCallbacks.playerSetup.playerConfigs?.[col]?.type === 'ai';
  // Protect human players from accidentally scrolling onto Row 6 (CTRL) and wiping themselves to AI.
  const skipCtrlRow = !isAi && ownerSlot >= 0 && col === ownerSlot;
  let next = cur + delta;
  if (skipCtrlRow) {
    if (cur === 5 && delta > 0) next = 8;
    if (cur === 8 && delta < 0) next = 5;
  } else {
    // Row 6 = CTRL (Human / AI Difficulty), Row 7 = STYLE (AI Playstyle, hidden when Human), Row 8 = Action Bar
    if (cur === 6 && delta > 0 && !isAi) next = 8;
    if (cur === 8 && delta < 0 && !isAi) next = 6;
  }
  next = Math.max(0, Math.min(8, next));
  if (next === 8 && cur !== 8) {
    navCallbacks.playerSetup.screen1ActionCol = 1;
  }
  navCallbacks.playerSetup.playerFocusRow[col] = next;
  navCallbacks.playerSetup.focusedColumn = col;
  navCallbacks.playerSetup.updateFocusUI();
  soundManager.playTone(520, 0.035, 'sine', 0.12);
}

// Match lobby keys: [keyset, action]. Keyset 0 = WASD + Space, 1 = IJKL + Enter + arrows,
// matching the keysets the keyboard plays with (see inputRouter KEYSETS).
const LOBBY_KEYS = {
  KeyW: [0, 'up'], KeyS: [0, 'down'], KeyA: [0, 'left'], KeyD: [0, 'right'], Space: [0, 'act'],
  KeyI: [1, 'up'], KeyK: [1, 'down'], KeyJ: [1, 'left'], KeyL: [1, 'right'], Enter: [1, 'act'],
  ArrowUp: [1, 'up'], ArrowDown: [1, 'down'], ArrowLeft: [1, 'left'], ArrowRight: [1, 'right'],
};

function activeMatchSlotCount() {
  return navCallbacks.playerSetup?.getActiveMatchPlayerCount?.() || 2;
}

function getSetupHostSlot() {
  const cfgs = navCallbacks.playerSetup?.playerConfigs;
  if (!cfgs || cfgs[0]?.type === 'human') return 0;
  const n = activeMatchSlotCount();
  for (let i = 0; i < n; i++) {
    if (cfgs[i]?.type === 'human') return i;
  }
  return 0;
}

function isSetupHostSlot(ownerSlot) {
  if (ownerSlot === 0) return true;
  const cfgs = navCallbacks.playerSetup?.playerConfigs;
  if (!cfgs || cfgs[0]?.type === 'human') return false;
  return ownerSlot >= 0 && ownerSlot === getSetupHostSlot();
}

function resolvePage2KeyOwner(keyset) {
  const cfgs = navCallbacks.playerSetup?.playerConfigs;
  const n = activeMatchSlotCount();
  const mappings = getExplicitDeviceMappings();
  if (!mappings) {
    const fallback = keyset < n ? keyset : -1;
    if (fallback >= 0 && cfgs?.[fallback]?.type === 'human') return fallback;
    if (keyset === 1) {
      for (let s = 0; s < n; s++) {
        if (cfgs?.[s]?.type === 'human') return s;
      }
    }
    return -1;
  }
  let kb1Claimed = false;
  let kb2Claimed = false;
  let kb1Slot = -1;
  for (let s = 0; s < n; s++) {
    if (cfgs?.[s]?.type !== 'human') continue;
    const m = mappings[s];
    if (m?.type === 'keyboard') {
      const ks = m.keyId === 'kb2' ? 1 : 0;
      if (ks === 0) {
        kb1Claimed = true;
        if (kb1Slot < 0) kb1Slot = s;
      } else {
        kb2Claimed = true;
      }
      if (ks === keyset) return s;
    }
  }
  const targetKeyId = keyset === 1 ? 'kb2' : 'kb1';
  if ((keyset === 0 && kb1Claimed) || (keyset === 1 && kb2Claimed)) return -1;
  const freeKeysets = [];
  if (!kb1Claimed) freeKeysets.push('kb1');
  if (!kb2Claimed) freeKeysets.push('kb2');
  let unmappedIdx = 0;
  for (let s = 0; s < n; s++) {
    if (cfgs?.[s]?.type !== 'human' || mappings[s]) continue;
    const assignedKeyId = freeKeysets[unmappedIdx++];
    if (assignedKeyId === targetKeyId) return s;
  }
  if (keyset === 1 && kb1Claimed && !kb2Claimed && kb1Slot >= 0) {
    return kb1Slot;
  }
  return -1;
}

function soloHumanSlot() {
  const ps = navCallbacks.playerSetup;
  const cfgs = ps.playerConfigs;
  const n = activeMatchSlotCount();
  if (cfgs[ps.focusedColumn]?.type === 'human' && ps.focusedColumn < n) return ps.focusedColumn;
  for (let i = 0; i < n; i++) {
    if (cfgs[i]?.type === 'human') return i;
  }
  return ps.focusedColumn;
}

function resolvePadOwnerSlot(padIndex, hasAssignedGamepad = false) {
  const assigned = getAssignedSlotForPad(padIndex);
  const n = activeMatchSlotCount();
  if (assigned >= 0 && assigned < n) return assigned;
  // Solo keyboard-lobby fallback: ONLY when no gamepad is assigned yet in this lobby,
  // let a newly-picked-up pad auto-bind to the keyboard-mapped human slot.
  // When at least one gamepad is already assigned, idle/unassigned pads never hijack another slot!
  if (!hasAssignedGamepad) {
    const mappings = getExplicitDeviceMappings();
    if (mappings) {
      for (let i = 0; i < n; i++) {
        if (mappings[i] && mappings[i].type !== 'gamepad') return i;
      }
    }
  }
  return -1;
}

function triggerSlotMenuHaptics(pad, slotIdx = 0) {
  if (!pad) return;
  if (slotIdx === 1) {
    triggerMenuHaptics(pad, 25, 0.28, 0.08);
    setTimeout(() => triggerMenuHaptics(pad, 25, 0.28, 0.08), 60);
  } else if (slotIdx >= 2) {
    triggerMenuHaptics(pad, 48, 0.18, 0.28);
  } else {
    triggerMenuHaptics(pad, 30, 0.22, 0.08);
  }
}

/** Versus lobbies only let a device ready its own player; ownerSlot -1 means any. */
function toggleReadyFrom(ownerSlot, target) {
  if (ownerSlot >= 0 && ownerSlot !== target) {
    soundManager.playTone(220, 0.1, 'sawtooth', 0.15);
    return;
  }
  navCallbacks.playerSetup.togglePlayerReady(target);
}

function toggleFocusedColumn(dir = 1, ownerSlot = -1) {
  const ps = navCallbacks.playerSetup;
  // Lock non-host guests strictly to their own column; only Setup Host can cycle onto AI slots
  if (ownerSlot >= 0 && !isSetupHostSlot(ownerSlot)) {
    soundManager.playTone(220, 0.1, 'sawtooth', 0.15);
    return ownerSlot;
  }
  const hostSlot = ownerSlot >= 0 ? ownerSlot : getSetupHostSlot();
  const n = activeMatchSlotCount();
  const baseOrder = n >= 4 ? [0, 2, 1, 3] : [0, 1];
  const order = baseOrder.filter((s) => s === hostSlot || ps.playerConfigs?.[s]?.type === 'ai');
  if (order.length <= 1) {
    soundManager.playTone(220, 0.1, 'sawtooth', 0.15);
    return hostSlot;
  }
  const curIdx = Math.max(0, order.indexOf(ps.focusedColumn));
  ps.focusedColumn = order[(curIdx + dir + order.length) % order.length];
  soundManager.playTone(440, 0.06, 'sine', 0.2);
  ps.updateFocusUI();
  return ps.focusedColumn;
}

/** Screen 1 (players): one navigation step in column `col`. Returns true if an option changed. */
function screen1Action(col, action, ownerSlot = -1) {
  const ps = navCallbacks.playerSetup;
  ps.focusedColumn = col;
  const row = ps.playerFocusRow[col];
  if (action === 'up' || action === 'down') {
    moveScreen1Row(col, action === 'up' ? -1 : 1, ownerSlot);
    return false;
  }
  const blockSelfAiWipe = row === 6 && ownerSlot >= 0 && col === ownerSlot && ps.playerConfigs?.[col]?.type === 'human';
  if (action === 'left' || action === 'right') {
    if (row === 8) {
      if (ownerSlot >= 0 && !isSetupHostSlot(ownerSlot)) return false;
      ps.screen1ActionCol = action === 'left' ? 0 : 1;
      ps.updateFocusUI();
      soundManager.playTone(400, 0.04, 'sine', 0.15);
      return false;
    }
    if (blockSelfAiWipe) {
      soundManager.playTone(220, 0.08, 'sawtooth', 0.14);
      return false;
    }
    ps.cycleOption(col, row, action === 'left' ? -1 : 1);
    if (ps.playerFocusRow[col] === 7 && ps.playerConfigs?.[col]?.type !== 'ai') {
      ps.playerFocusRow[col] = 6;
      ps.updateFocusUI();
    }
    return true;
  }
  if (action === 'act') {
    if (row === 8) {
      if (ownerSlot >= 0 && !isSetupHostSlot(ownerSlot)) {
        // Non-host confirm on row 8 toggles their own Ready badge instead of hijacking room navigation
        toggleReadyFrom(ownerSlot, ownerSlot);
        return false;
      }
      if (ps.screen1ActionCol === 0) {
        ps.btnBack?.click();
      } else {
        ps.setupPage = 2;
        window._updateSetupPage();
      }
      return false;
    }
    // Pressing A / Space / Enter on an option row keeps the current selection untouched
    // and advances focus cleanly to the next row (Left/Right still adjust options).
    moveScreen1Row(col, 1, ownerSlot);
    return false;
  }
  return false;
}

/**
 * Screen 2 (match rules):
 * - Only Setup Host can edit Match Rules (Row 0 = Ball Size, Row 1 = Match Length, Row 2 = Action Bar).
 * - Non-host players default directly to their own Ready button and can only toggle their own Ready state.
 */
function rulesAction(action, ownerSlot) {
  const ps = navCallbacks.playerSetup;
  const row = ps.matchRulesFocusRow;
  const n = activeMatchSlotCount();
  const resetHumanReady = () => {
    for (let i = 0; i < n; i++) {
      if (ps.playerConfigs?.[i]?.type === 'human') ps.playerReadyState[i] = false;
    }
  };
  const isAllAI = () => {
    for (let i = 0; i < n; i++) {
      if (ps.playerConfigs?.[i]?.type !== 'ai') return false;
    }
    return true;
  };

  if (ownerSlot < 0) return;

  // Non-host human players: locked strictly to their own Ready toggle (never yank Host back to Page 1)
  if (!isSetupHostSlot(ownerSlot)) {
    if (action === 'act' || action === 'ready' || action === 'start') {
      toggleReadyFrom(ownerSlot, ownerSlot);
    } else if (action === 'back') {
      if (ps.playerReadyState[ownerSlot] || ps.matchCountdownActive) {
        toggleReadyFrom(ownerSlot, ownerSlot);
      } else {
        soundManager.playTone(220, 0.08, 'sawtooth', 0.12);
      }
    }
    return;
  }

  const hostSlot = ownerSlot >= 0 ? ownerSlot : getSetupHostSlot();
  const hostDefaultCol = ps.playerConfigs?.[hostSlot]?.type === 'human' ? 1 : 2;
  if (action === 'up' || action === 'down') {
    ps.matchRulesFocusRow = Math.max(0, Math.min(2, row + (action === 'up' ? -1 : 1)));
    ps.updateFocusUI();
    soundManager.playTone(520, 0.035, 'sine', 0.12);
  } else if (action === 'left' || action === 'right') {
    const dir = action === 'left' ? -1 : 1;
    if (row === 0) ps.cycleMatchBall(dir);
    else if (row === 1) ps.cycleMatchDuration(dir);
    else {
      ps.matchRulesActionCol = Math.max(0, Math.min(2, (ps.matchRulesActionCol ?? hostDefaultCol) + dir));
      ps.updateFocusUI();
    }
    soundManager.playTone(440, 0.04, 'sine', 0.15);
  } else if (action === 'act') {
    if (ps.matchCountdownActive) ps.launchMatchNow();
    else if (row === 0 || row === 1) {
      // Pressing A on Ball Size or Match Length keeps the current selection and advances down
      ps.matchRulesFocusRow = Math.min(2, row + 1);
      ps.updateFocusUI();
      soundManager.playTone(520, 0.035, 'sine', 0.12);
    } else {
      const col = Math.max(0, Math.min(2, ps.matchRulesActionCol ?? hostDefaultCol));
      if (col === 0) {
        ps.btnBack?.click();
      } else if (col === 1) {
        if (ps.playerConfigs?.[hostSlot]?.type === 'human') toggleReadyFrom(hostSlot, hostSlot);
        else if (!ps.btnStartMatch?.disabled) ps.btnStartMatch?.click();
      } else if (col === 2) {
        if (!ps.btnStartMatch?.disabled) ps.btnStartMatch?.click();
        else if (ps.playerConfigs?.[hostSlot]?.type === 'human') toggleReadyFrom(hostSlot, hostSlot);
      }
    }
  } else if (action === 'ready') {
    if (ps.matchCountdownActive) {
      ps.cancelMatchCountdown();
      resetHumanReady();
      soundManager.playTone(330, 0.12, 'sine', 0.2);
      ps.updateReadyUI();
    } else if (isAllAI()) {
      ps.btnStartMatch?.click();
    } else if (ps.playerConfigs?.[hostSlot]?.type === 'human') {
      toggleReadyFrom(hostSlot, hostSlot);
    }
  } else if (action === 'back') {
    if (ps.matchCountdownActive) {
      ps.cancelMatchCountdown();
      resetHumanReady();
      soundManager.playTone(330, 0.12, 'sine', 0.2);
      ps.updateReadyUI();
    } else {
      ps.setupPage = 1;
      window._updateSetupPage();
      soundManager.playTone(330, 0.08, 'sine', 0.15);
    }
  } else if (action === 'start') {
    if (ps.matchCountdownActive) ps.launchMatchNow();
    else if (!ps.btnStartMatch?.disabled) ps.btnStartMatch?.click();
    else if (ps.playerConfigs?.[hostSlot]?.type === 'human') toggleReadyFrom(hostSlot, hostSlot);
  }
}

export function startMenuGamepadPolling() {
  stopSetupGamepadPolling();

  const onMenuKeyDown = (e) => {
    // 0. If Settings / In-Game Menu is open, ignore main menu keys
    const inGameOverlay = document.getElementById('ingame-menu-overlay');
    if (inGameOverlay && inGameOverlay.style.display === 'flex') {
      return;
    }

    // 0.25 First-Time Setup Modal Open
    const firstSetupEl = getFirstTimeSetupModalEl();
    if (firstSetupEl && firstSetupEl.style.display === 'flex') {
      if (e.code === 'Escape' || e.code === 'Backspace') {
        e.preventDefault();
        firstSetupEl._handleBack?.();
        return;
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        firstSetupEl._moveFocus?.(-1);
        return;
      }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        firstSetupEl._moveFocus?.(1);
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        firstSetupEl._handleLeft?.();
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        firstSetupEl._handleRight?.();
        return;
      }
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        firstSetupEl._handleAction?.();
        return;
      }
      return;
    }

    // 0.5 Settings Modal Open (Main Menu)
    const settingsModalEl = getMainMenuSettingsModalEl();
    if (settingsModalEl && settingsModalEl.style.display === 'flex') {
      if (e.code === 'Escape' || e.code === 'Backspace') {
        e.preventDefault();
        hideMainMenuSettingsModal();
        return;
      }
      if (e.code === 'Tab' || e.code === 'KeyQ' || e.code === 'KeyE') {
        e.preventDefault();
        const dir = (e.code === 'KeyQ' || (e.code === 'Tab' && e.shiftKey)) ? -1 : 1;
        settingsModalEl._cycleTab?.(dir);
        return;
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        settingsModalEl._moveFocus?.(-1);
        return;
      }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        settingsModalEl._moveFocus?.(1);
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        settingsModalEl._handleLeft?.();
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        settingsModalEl._handleRight?.();
        return;
      }
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        settingsModalEl._handleAction?.();
        return;
      }
      return;
    }

    // 1. How To Play Modal Open
    const howToModalEl = getControlsModalEl();
    if (howToModalEl && howToModalEl.style.display === 'flex') {
      const curTab = howToModalEl._getCurrentTab ? howToModalEl._getCurrentTab() : 'controls';
      if (e.code === 'Escape') {
        e.preventDefault();
        hideHowToPlayModal();
        return;
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        howToModalEl._cycleTab?.(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        howToModalEl._scrollContent?.(-50);
        return;
      }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        howToModalEl._scrollContent?.(50);
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        if (curTab === 'controls') {
          howToModalEl._cycleDevice?.(-1);
        } else {
          howToModalEl._cycleTab?.(-1);
        }
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        if (curTab === 'controls') {
          howToModalEl._cycleDevice?.(1);
        } else {
          howToModalEl._cycleTab?.(1);
        }
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (curTab === 'controls') {
          howToModalEl._cycleDevice?.(1);
        } else {
          hideHowToPlayModal();
        }
        return;
      }
    }

    // 1.5 Controller Assignment Screen Active
    if (state.controllerAssignmentEl && state.controllerAssignmentEl.style.display === 'flex') {
      if (e.code === 'Escape' || e.code === 'Backspace') {
        e.preventDefault();
        const btnBack = document.getElementById('assignment-btn-back');
        btnBack?.click();
        return;
      }
      if (e.code === 'KeyY') {
        e.preventDefault();
        const btnToggle = document.getElementById('assignment-btn-toggle');
        btnToggle?.click();
        return;
      }
      if (e.code === 'KeyX') {
        e.preventDefault();
        const btnBothAI = document.getElementById('assignment-btn-both-ai');
        btnBothAI?.click();
        return;
      }
      // The keys below move the keyboard's own card. Key auto-repeat must not: a
      // held Enter from the title would otherwise join or continue on its own.
      if (e.repeat) return;
      if (e.code === 'KeyS' || e.code === 'Tab') {
        e.preventDefault();
        document.getElementById('assignment-btn-swap-sides')?.click();
        return;
      }
      if (e.code === 'KeyB') {
        e.preventDefault();
        handleAssignmentKey('drop', 'kb1');
        return;
      }
      if (e.code === 'KeyK') {
        e.preventDefault();
        handleAssignmentKey('drop', 'kb2');
        return;
      }
      if (e.code === 'KeyJ') {
        e.preventDefault();
        handleAssignmentKey('left', 'kb2');
        return;
      }
      if (e.code === 'KeyL') {
        e.preventDefault();
        handleAssignmentKey('right', 'kb2');
        return;
      }
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        handleAssignmentKey('confirm', e.code === 'Enter' ? 'kb2' : 'kb1');
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        handleAssignmentKey('left', 'kb1');
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        handleAssignmentKey('right', 'kb1');
        return;
      }
      return;
    }

    // 2. Title Screen Active (P1 Control Only)
    if (state.titleScreenEl && state.titleScreenEl.style.display === 'flex') {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') {
        e.preventDefault();
        state.titleFocusIndex = (state.titleFocusIndex - 1 + state.titleButtons.length) % state.titleButtons.length;
        updateTitleFocusUI();
      } else if (e.code === 'KeyS' || e.code === 'ArrowDown') {
        e.preventDefault();
        state.titleFocusIndex = (state.titleFocusIndex + 1) % state.titleButtons.length;
        updateTitleFocusUI();
      } else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        navCallbacks.getTitleButtons?.()[navCallbacks.getTitleFocusIndex?.()]?.click();
      }
      return;
    }

    // 3. Player Setup Active
    if (!navCallbacks.playerSetup.playerSetupEl || navCallbacks.playerSetup.playerSetupEl.style.display !== 'flex') return;

    // CASE A: PRACTICE MODE (Rows 1..6 Athlete, 7 Drill Choice, 8 Ball Choice, 9 Action Bar)
    if (navCallbacks.playerSetup.currentSetupMode === 'practice') {
      if (e.code === 'Escape') {
        e.preventDefault();
        navCallbacks.showTitleScreen?.();
        return;
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        navCallbacks.playerSetup.playerFocusRow[0] = Math.max(1, navCallbacks.playerSetup.playerFocusRow[0] - 1);
        navCallbacks.playerSetup.updateFocusUI();
        return;
      }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        navCallbacks.playerSetup.playerFocusRow[0] = Math.min(9, navCallbacks.playerSetup.playerFocusRow[0] + 1);
        navCallbacks.playerSetup.updateFocusUI();
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        if (navCallbacks.playerSetup.playerFocusRow[0] === 9) {
          navCallbacks.playerSetup.practiceActionCol = 0;
          navCallbacks.playerSetup.updateFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] === 8) {
          navCallbacks.playerSetup.cycleMatchBall(-1);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
          navCallbacks.playerSetup.cyclePracticeDrill?.(-1);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 6) {
          navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], -1);
        }
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        if (navCallbacks.playerSetup.playerFocusRow[0] === 9) {
          navCallbacks.playerSetup.practiceActionCol = 1;
          navCallbacks.playerSetup.updateFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] === 8) {
          navCallbacks.playerSetup.cycleMatchBall(1);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
          navCallbacks.playerSetup.cyclePracticeDrill?.(1);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 6) {
          navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
        }
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (navCallbacks.playerSetup.playerFocusRow[0] === 9) {
          if (navCallbacks.playerSetup.practiceActionCol === 0) {
            navCallbacks.playerSetup.btnBack?.click();
          } else {
            navCallbacks.playerSetup.launchMatchNow();
          }
        } else {
          navCallbacks.playerSetup.playerFocusRow[0] = Math.min(9, navCallbacks.playerSetup.playerFocusRow[0] + 1);
          navCallbacks.playerSetup.updateFocusUI();
          soundManager.playTone(520, 0.035, 'sine', 0.12);
        }
        return;
      }
      return;
    }

    // --- MATCH MODE (SCREEN 1: PLAYERS, SCREEN 2: MATCH RULES) ---
    // Versus: WASD + Space edits the WASD player's column and IJKL + Enter + arrows the
    // IJKL player's, wherever they were assigned. Otherwise every key drives the shared
    // cursor and Tab switches columns.
    const versus = navCallbacks.playerSetup.isVersusLobby();
    const keyOwner = (keyset) => {
      const slot = getMatchSlotForKeyset(keyset);
      if (slot >= 0) return slot;
      return versus ? -1 : -1;
    };

    if (navCallbacks.playerSetup.setupPage === 2) {
      if (e.code === 'Escape') {
        e.preventDefault();
        rulesAction('back', getSetupHostSlot());
        return;
      }
      if (e.code === 'KeyX' || e.code === 'KeyR') {
        e.preventDefault();
        rulesAction('ready', resolvePage2KeyOwner(0));
        return;
      }
      const nav = LOBBY_KEYS[e.code];
      if (!nav) return;
      e.preventDefault();
      rulesAction(nav[1], resolvePage2KeyOwner(nav[0]));
      return;
    }

    if (e.code === 'Escape') {
      e.preventDefault();
      if (navCallbacks.playerSetup.btnBack) navCallbacks.playerSetup.btnBack.click();
      else navCallbacks.showTitleScreen?.();
      return;
    }

    if (e.code === 'KeyY') {
      e.preventDefault();
      navCallbacks.playerSetup.toggleLobbySlotHumanAi?.(navCallbacks.playerSetup.focusedColumn);
      soundManager.playTone(540, 0.05, 'sine', 0.18);
      return;
    }

    if (e.code === 'Tab') {
      e.preventDefault();
      const kbSlot = keyOwner(0);
      toggleFocusedColumn(e.shiftKey ? -1 : 1, kbSlot >= 0 ? kbSlot : getSetupHostSlot());
      return;
    }

    const nav = LOBBY_KEYS[e.code];
    if (!nav) return;
    e.preventDefault();
    const focusedCfg = navCallbacks.playerSetup.playerConfigs?.[navCallbacks.playerSetup.focusedColumn];
    const owner = keyOwner(nav[0]);
    const otherOwner = keyOwner(nav[0] === 0 ? 1 : 0);
    const hasTwoKeysets = owner >= 0 && otherOwner >= 0 && owner !== otherOwner;
    const ownerIsHost = owner >= 0 && isSetupHostSlot(owner);
    const col = hasTwoKeysets
      ? (ownerIsHost && focusedCfg?.type === 'ai' ? navCallbacks.playerSetup.focusedColumn : owner)
      : (versus ? (owner >= 0 && !(ownerIsHost && focusedCfg?.type === 'ai') ? owner : navCallbacks.playerSetup.focusedColumn) : (focusedCfg?.type === 'ai' || owner < 0 ? navCallbacks.playerSetup.focusedColumn : owner));
    screen1Action(col, nav[1], owner);
  };
  window.addEventListener('keydown', onMenuKeyDown);

  // Seeds from what is held right now, so a press that opened this screen never fires here.
  menuPads.reset();
  resetMenuPadTargets();

  state.gamepadPollHandle = setInterval(() => {
    if (!state.rootEl || state.rootEl.style.display === 'none') return;

    const inGameOverlay = document.getElementById('ingame-menu-overlay');
    if (inGameOverlay && inGameOverlay.style.display === 'flex') return;

    if (typeof navigator.getGamepads !== 'function') return;
    const raw = navigator.getGamepads();
    const pads = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] && raw[i].connected) pads.push(raw[i]);
    }
    menuPads.update(pads);
    if (!soundManager.unlocked) {
      for (let i = 0; i < pads.length; i++) {
        if (pads[i] && menuPads.pressed(pads[i])) {
          soundManager.unlock?.();
          break;
        }
      }
    }

    // 0a. First-Time Setup Modal Active
    const firstSetupEl = getFirstTimeSetupModalEl();
    if (firstSetupEl && firstSetupEl.style.display === 'flex') {
      for (const pad of pads) {
        if (!pad) continue;
        const e = menuPads.pressed(pad);
        if (e & MENU_PAD.up) firstSetupEl._moveFocus?.(-1);
        if (e & MENU_PAD.down) firstSetupEl._moveFocus?.(1);
        if (e & MENU_PAD.left) firstSetupEl._handleLeft?.();
        if (e & MENU_PAD.right) firstSetupEl._handleRight?.();
        if (e & (MENU_PAD.a | MENU_PAD.start)) {
          firstSetupEl._handleAction?.();
          return;
        }
        if ((e & MENU_PAD.b) || (e & MENU_PAD.back)) {
          firstSetupEl._handleBack?.();
          return;
        }
      }
      return;
    }

    // 0. Settings Modal Active (Main Menu)
    const settingsModalEl = getMainMenuSettingsModalEl();
    if (settingsModalEl && settingsModalEl.style.display === 'flex') {
      for (const pad of pads) {
        if (!pad) continue;
        const e = menuPads.pressed(pad);

        if (e & MENU_PAD.lb) settingsModalEl._cycleTab?.(-1);
        if (e & MENU_PAD.rb) settingsModalEl._cycleTab?.(1);
        if (e & MENU_PAD.up) settingsModalEl._moveFocus?.(-1);
        if (e & MENU_PAD.down) settingsModalEl._moveFocus?.(1);
        if (e & MENU_PAD.left) settingsModalEl._handleLeft?.();
        if (e & MENU_PAD.right) settingsModalEl._handleRight?.();
        if (e & MENU_PAD.a) settingsModalEl._handleAction?.();

        if ((e & MENU_PAD.b) || (e & MENU_PAD.back)) {
          hideMainMenuSettingsModal();
          return;
        }
      }
      return;
    }

    // 1. How To Play Modal Active
    const howToModalEl = getControlsModalEl();
    if (howToModalEl && howToModalEl.style.display === 'flex') {
      const curTab = howToModalEl._getCurrentTab ? howToModalEl._getCurrentTab() : 'controls';
      for (const pad of pads) {
        if (!pad) continue;
        const e = menuPads.pressed(pad);

        if ((e & MENU_PAD.lb)) {
          howToModalEl._cycleTab?.(-1);
        } else if ((e & MENU_PAD.rb)) {
          howToModalEl._cycleTab?.(1);
        }

        if (curTab === 'controls') {
          if (e & MENU_PAD.left) {
            howToModalEl._cycleDevice?.(-1);
          } else if ((e & MENU_PAD.right) || (e & MENU_PAD.x) || (e & MENU_PAD.a)) {
            howToModalEl._cycleDevice?.(1);
          }
        } else {
          if (e & MENU_PAD.left) howToModalEl._cycleTab?.(-1);
          else if (e & MENU_PAD.right) howToModalEl._cycleTab?.(1);
        }

        if (menuPads.held(pad) & MENU_PAD.up) howToModalEl._scrollContent?.(-14);
        if (menuPads.held(pad) & MENU_PAD.down) howToModalEl._scrollContent?.(14);

        if ((e & MENU_PAD.b) || (e & MENU_PAD.start) || (e & MENU_PAD.back)) {
          hideHowToPlayModal();
          return;
        }
      }
      return;
    }

    // 1.5 Controller Assignment Active
    if (state.controllerAssignmentEl && state.controllerAssignmentEl.style.display === 'flex') {
      pollAssignmentGamepads(pads, menuPads);
      return;
    }

    // 2. Title Screen Active -> Dynamic Lobby Host: any connected controller can press Up/Down/A/Start
    // to claim Host on the Title Screen, rumble to confirm, and become P1 Captain in Controller Assignment.
    if (state.titleScreenEl && state.titleScreenEl.style.display === 'flex') {
      const hostStillConnected = Number.isInteger(state.lobbyHostPadIndex) &&
        pads.some((p) => p && p.index === state.lobbyHostPadIndex);
      if (!hostStillConnected && state.lobbyHostPadIndex !== null) {
        state.lobbyHostPadIndex = null;
        updateTitleHostPrompt(null);
      }

      for (const pad of pads) {
        if (!pad) continue;
        const e = menuPads.pressed(pad);
        if (!e) continue;

        const isNavOrConfirm = Boolean(e & (MENU_PAD.up | MENU_PAD.down | MENU_PAD.a | MENU_PAD.start));
        if (!isNavOrConfirm) continue;

        // First pad to press (or another pad pressing A/Start/nav) claims Lobby Host cleanly
        if (state.lobbyHostPadIndex !== pad.index) {
          state.lobbyHostPadIndex = pad.index;
          updateTitleHostPrompt(pad.index);
        }

        if (e & MENU_PAD.up) {
          state.titleFocusIndex = (state.titleFocusIndex - 1 + state.titleButtons.length) % state.titleButtons.length;
          updateTitleFocusUI();
          soundManager.playTone(520, 0.035, 'sine', 0.12);
          triggerMenuHaptics(pad, 25, 0.15, 0.05);
        }
        if (e & MENU_PAD.down) {
          state.titleFocusIndex = (state.titleFocusIndex + 1) % state.titleButtons.length;
          updateTitleFocusUI();
          soundManager.playTone(520, 0.035, 'sine', 0.12);
          triggerMenuHaptics(pad, 25, 0.15, 0.05);
        }
        if ((e & MENU_PAD.a) || (e & MENU_PAD.start)) {
          soundManager.playTone(660, 0.05, 'sine', 0.18);
          triggerMenuHaptics(pad, 35, 0.25, 0.1);
          navCallbacks.getTitleButtons?.()[navCallbacks.getTitleFocusIndex?.()]?.click();
          return;
        }
      }
      return;
    }

    // 3. Player Setup Active
    if (!navCallbacks.playerSetup.playerSetupEl || navCallbacks.playerSetup.playerSetupEl.style.display !== 'flex') return;

    if (navCallbacks.playerSetup.updateInputBadgesUI) {
      navCallbacks.playerSetup.updateInputBadgesUI();
    } else {
      const assignments = getControllerAssignments(navCallbacks.playerSetup.currentSetupMode === 'practice' ? 1 : 2, navCallbacks.playerSetup.currentSetupMode);
      if (navCallbacks.playerSetup.playerInputBadges[0]) navCallbacks.playerSetup.playerInputBadges[0].textContent = `INPUT: ${assignments.p1}`;
      if (navCallbacks.playerSetup.playerInputBadges[1] && navCallbacks.playerSetup.currentSetupMode !== 'practice') navCallbacks.playerSetup.playerInputBadges[1].textContent = `INPUT: ${assignments.p2}`;
    }

    if (navCallbacks.playerSetup.currentSetupMode === 'practice') {
      // Practice screen (Rows 1..6 Athlete, 7 Drill, 8 Practice Ball, 9 Back/Start): any pad drives it.
      for (const pad of pads) {
        if (navCallbacks.playerSetup.playerSetupEl.style.display !== 'flex') return;
        const e = menuPads.pressed(pad);

        if (e & MENU_PAD.up) {
          navCallbacks.playerSetup.playerFocusRow[0] = Math.max(1, navCallbacks.playerSetup.playerFocusRow[0] - 1);
          navCallbacks.playerSetup.updateFocusUI();
        }
        if (e & MENU_PAD.down) {
          navCallbacks.playerSetup.playerFocusRow[0] = Math.min(9, navCallbacks.playerSetup.playerFocusRow[0] + 1);
          navCallbacks.playerSetup.updateFocusUI();
        }

        if (e & MENU_PAD.left) {
          if (navCallbacks.playerSetup.playerFocusRow[0] === 9) {
            navCallbacks.playerSetup.practiceActionCol = 0;
            navCallbacks.playerSetup.updateFocusUI();
            soundManager.playTone(400, 0.04, 'sine', 0.15);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] === 8) {
            navCallbacks.playerSetup.cycleMatchBall(-1);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
            navCallbacks.playerSetup.cyclePracticeDrill?.(-1);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 6) {
            navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], -1);
          }
        }
        if (e & MENU_PAD.right) {
          if (navCallbacks.playerSetup.playerFocusRow[0] === 9) {
            navCallbacks.playerSetup.practiceActionCol = 1;
            navCallbacks.playerSetup.updateFocusUI();
            soundManager.playTone(400, 0.04, 'sine', 0.15);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] === 8) {
            navCallbacks.playerSetup.cycleMatchBall(1);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
            navCallbacks.playerSetup.cyclePracticeDrill?.(1);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 6) {
            navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
          }
        }

        if (e & MENU_PAD.lb) navCallbacks.playerSetup.cycleMatchBall(-1);
        if (e & MENU_PAD.rb) navCallbacks.playerSetup.cycleMatchBall(1);

        if (e & MENU_PAD.a) {
          if (navCallbacks.playerSetup.playerFocusRow[0] === 9) {
            if (navCallbacks.playerSetup.practiceActionCol === 0) {
              navCallbacks.playerSetup.btnBack?.click();
            } else {
              navCallbacks.playerSetup.launchMatchNow();
            }
          } else {
            // Keep current option unchanged and move selector down to the next row
            navCallbacks.playerSetup.playerFocusRow[0] = Math.min(9, navCallbacks.playerSetup.playerFocusRow[0] + 1);
            navCallbacks.playerSetup.updateFocusUI();
            soundManager.playTone(520, 0.035, 'sine', 0.12);
          }
        }

        if ((e & MENU_PAD.b) || (e & MENU_PAD.back)) {
          navCallbacks.showTitleScreen?.();
          return;
        }

        if (e & MENU_PAD.start) {
          navCallbacks.playerSetup.launchMatchNow();
        }
      }
      return;
    }

    // --- MATCH MODE (SCREEN 1: PLAYERS, SCREEN 2: MATCH RULES) ---
    // Each assigned gamepad drives its own player card independently.
    // P2-P4 are locked strictly to their own slot; only P1 (Slot 0) can use LB/RB to configure AI slots or change screens.
    const ps = navCallbacks.playerSetup;
    const n = activeMatchSlotCount();
    const versus = ps.isVersusLobby();
    const page = ps.setupPage;
    for (const pad of pads) {
      const e = menuPads.pressed(pad);
      if (!e) continue;
      let assignedSlot = getAssignedSlotForPad(pad.index);
      if (assignedSlot >= n) assignedSlot = -1;
      const mappings = getExplicitDeviceMappings();
      let hasAssignedGamepad = false;
      if (mappings) {
        for (let i = 0; i < n; i++) {
          if (mappings[i] && mappings[i].type === 'gamepad') {
            hasAssignedGamepad = true;
            break;
          }
        }
      }
      const hasOpenAiSlot = Boolean(ps.playerConfigs && ps.playerConfigs.slice(0, n).some((c) => c?.type === 'ai'));

      // Direct Lobby Join: an unassigned controller pressing Y (or A/Start when another pad is already mapped)
      // immediately claims the next open AI slot on Page 1 without backing out to Controller Assignment.
      if (page === 1 && assignedSlot < 0 && hasOpenAiSlot && ((e & MENU_PAD.y) || (hasAssignedGamepad && (e & (MENU_PAD.a | MENU_PAD.start))))) {
        const claimed = ps.claimLobbySlotForPad ? ps.claimLobbySlotForPad(pad.index, pad.id) : -1;
        if (claimed >= 0) {
          padTargetSlot[pad.index] = claimed;
          ps.pulsePlayerCard?.(claimed);
          soundManager.playTone(660, 0.06, 'sine', 0.22);
          triggerSlotMenuHaptics(pad, claimed);
          continue;
        }
      }

      const ownerSlot = resolvePadOwnerSlot(pad.index, hasAssignedGamepad);
      if (assignedSlot < 0 && ownerSlot >= 0 && !hasAssignedGamepad) {
        assignPadToSlot(ownerSlot, pad.index, pad.id);
        assignedSlot = ownerSlot;
        hasAssignedGamepad = true;
        ps.updateInputBadgesUI?.();
        ps.updateFocusUI?.();
      }
      // If gamepads are already mapped in this lobby and this pad isn't one of them, ignore it so idle pads never hijack P1!
      if (ownerSlot < 0 && assignedSlot < 0 && hasAssignedGamepad) {
        continue;
      }

      if (page === 2) {
        if (e & MENU_PAD.up) rulesAction('up', ownerSlot);
        if (e & MENU_PAD.down) rulesAction('down', ownerSlot);
        if (e & (MENU_PAD.left | MENU_PAD.lb)) rulesAction('left', ownerSlot);
        else if (e & (MENU_PAD.right | MENU_PAD.rb)) rulesAction('right', ownerSlot);
        if (e & MENU_PAD.a) {
          rulesAction('act', ownerSlot);
          triggerSlotMenuHaptics(pad, ownerSlot);
        }
        if (e & MENU_PAD.x) {
          rulesAction('ready', ownerSlot);
          triggerSlotMenuHaptics(pad, ownerSlot);
        }
        if (e & (MENU_PAD.b | MENU_PAD.back)) rulesAction('back', ownerSlot);
        else if (e & MENU_PAD.start) {
          rulesAction('start', ownerSlot);
          triggerSlotMenuHaptics(pad, ownerSlot);
        }
      } else {
        // Resolve this controller's independent target column on Page 1.
        // Non-host guests are strictly locked to their own column.
        const isHost = isSetupHostSlot(ownerSlot);
        let col = (ownerSlot >= 0 && !isHost)
          ? ownerSlot
          : (ownerSlot >= 0 ? (padTargetSlot[pad.index] ?? ownerSlot) : ps.focusedColumn);
        if (isHost && ownerSlot >= 0 && col !== ownerSlot && ps.playerConfigs?.[col]?.type !== 'ai') {
          col = ownerSlot;
          padTargetSlot[pad.index] = ownerSlot;
        }

        if (e & (MENU_PAD.lb | MENU_PAD.rb)) {
          const dir = (e & MENU_PAD.lb) ? -1 : 1;
          if (ownerSlot >= 0 && !isHost) {
            // Non-host guests cannot LB/RB into other character setups
            col = ownerSlot;
            padTargetSlot[pad.index] = ownerSlot;
            ps.pulsePlayerCard?.(col);
            soundManager.playTone(220, 0.1, 'sawtooth', 0.15);
          } else if (isHost && ownerSlot >= 0) {
            const baseOrder = n >= 4 ? [0, 2, 1, 3] : [0, 1];
            const allowed = baseOrder.filter((s) => s === ownerSlot || ps.playerConfigs?.[s]?.type === 'ai');
            if (allowed.length <= 1) {
              soundManager.playTone(220, 0.1, 'sawtooth', 0.15);
            } else {
              const curIdx = Math.max(0, allowed.indexOf(col));
              col = allowed[(curIdx + dir + allowed.length) % allowed.length];
              padTargetSlot[pad.index] = col;
              ps.focusedColumn = col;
              ps.updateFocusUI();
              ps.pulsePlayerCard?.(col);
              soundManager.playTone(440, 0.06, 'sine', 0.2);
              triggerSlotMenuHaptics(pad, ownerSlot);
            }
          } else {
            col = toggleFocusedColumn(dir, -1);
            ps.pulsePlayerCard?.(col);
            triggerSlotMenuHaptics(pad, 0);
          }
        }

        if (e & MENU_PAD.y) {
          // Only Host editing an AI slot can toggle that AI slot to Human,
          // and pass padIndex = -1 so we NEVER steal Host's own bound gamepad onto the other slot.
          // Human players never accidentally wipe themselves to AI mid-setup with Y.
          if (ps.toggleLobbySlotHumanAi && (ownerSlot < 0 || isHost) && col !== ownerSlot) {
            ps.toggleLobbySlotHumanAi(col, -1, '');
            ps.pulsePlayerCard?.(col);
            soundManager.playTone(540, 0.05, 'sine', 0.18);
            triggerSlotMenuHaptics(pad, ownerSlot >= 0 ? ownerSlot : 0);
          } else {
            ps.pulsePlayerCard?.(col);
            soundManager.playTone(220, 0.08, 'sawtooth', 0.14);
          }
        }
        if (e & MENU_PAD.x) {
          // Allow each player to lock/unlock their own Ready badge right on Page 1
          if (ps.playerConfigs?.[col]?.type === 'human') {
            toggleReadyFrom(ownerSlot, col);
            ps.pulsePlayerCard?.(col);
            triggerSlotMenuHaptics(pad, col);
          }
        }
        if (e & MENU_PAD.up) {
          screen1Action(col, 'up', ownerSlot);
          ps.pulsePlayerCard?.(col);
          triggerMenuHaptics(pad, 20, 0.14, 0.04);
        }
        if (e & MENU_PAD.down) {
          screen1Action(col, 'down', ownerSlot);
          ps.pulsePlayerCard?.(col);
          triggerMenuHaptics(pad, 20, 0.14, 0.04);
        }
        const step = (action) => {
          ps.pulsePlayerCard?.(col);
          if (screen1Action(col, action, ownerSlot)) {
            soundManager.playTone(660, 0.045, 'sine', 0.18);
            triggerSlotMenuHaptics(pad, ownerSlot >= 0 ? ownerSlot : col);
          } else {
            triggerMenuHaptics(pad, 25, 0.18, 0.05);
          }
        };
        if (e & MENU_PAD.left) step('left');
        if (e & MENU_PAD.right) step('right');
        if (e & MENU_PAD.a) step('act');
        if (e & (MENU_PAD.b | MENU_PAD.back)) {
          if (ownerSlot >= 0 && !isHost) {
            // Non-host pressing B on Page 1 only un-readies themselves; never kicks the whole room back
            if (ps.playerReadyState?.[ownerSlot]) {
              toggleReadyFrom(ownerSlot, ownerSlot);
            } else {
              soundManager.playTone(220, 0.08, 'sawtooth', 0.12);
            }
            ps.pulsePlayerCard?.(ownerSlot);
          } else {
            if (ps.btnBack) {
              ps.btnBack.click();
            } else {
              navCallbacks.showTitleScreen?.();
            }
            soundManager.playTone(330, 0.08, 'sine', 0.15);
            triggerSlotMenuHaptics(pad, ownerSlot >= 0 ? ownerSlot : 0);
            return;
          }
        } else if (e & MENU_PAD.start) {
          if (ownerSlot >= 0 && !isHost) {
            // Non-host pressing Start on Page 1 toggles their own Ready status instead of yanking Host to Page 2
            toggleReadyFrom(ownerSlot, ownerSlot);
            ps.pulsePlayerCard?.(ownerSlot);
            triggerSlotMenuHaptics(pad, ownerSlot);
          } else {
            ps.setupPage = 2;
            window._updateSetupPage();
            soundManager.playTone(660, 0.05, 'sine', 0.2);
            triggerSlotMenuHaptics(pad, ownerSlot >= 0 ? ownerSlot : 0);
          }
        }
      }

      // A page change or a launch belongs to the next poll.
      if (ps.setupPage !== page || ps.playerSetupEl.style.display !== 'flex') return;
    }
  }, 50);

  window._cleanupSetupListeners = () => {
    window.removeEventListener('keydown', onMenuKeyDown);
    if (state.gamepadPollHandle) {
      clearInterval(state.gamepadPollHandle);
      state.gamepadPollHandle = null;
    }
  };
}

export function stopSetupGamepadPolling() {
  if (window._cleanupSetupListeners) {
    window._cleanupSetupListeners();
    window._cleanupSetupListeners = null;
  }
}

