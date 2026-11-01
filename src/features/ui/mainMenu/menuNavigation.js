import { soundManager } from '../../../audio/soundManager.js';
import { state } from './state.js';
import { getControllerAssignments, getAssignedSlotForPad, getMatchSlotForKeyset } from '../../../input/inputRouter.js';
import { createMenuPadTracker, MENU_PAD } from '../../../input/menuPads.js';
import { hideMainMenuSettingsModal, getMainMenuSettingsModalEl } from './settingsModal.js';
import { hideHowToPlayModal, getControlsModalEl } from './howToPlayModal.js';
import { updateTitleFocusUI } from './titleScreen.js';

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

export function moveScreen1Row(col, delta) {
  if (!navCallbacks.playerSetup) return;
  let cur = navCallbacks.playerSetup.playerFocusRow[col];
  const isAi = navCallbacks.playerSetup.playerConfigs?.[col]?.type === 'ai';
  let next = cur + delta;
  if (cur === 0 && delta > 0 && !isAi) next = 2;
  if (cur === 2 && delta < 0 && !isAi) next = 0;
  next = Math.max(0, Math.min(8, next));
  navCallbacks.playerSetup.playerFocusRow[col] = next;
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

function soloHumanSlot() {
  const cfgs = navCallbacks.playerSetup.playerConfigs;
  if (cfgs[0]?.type === 'human') return 0;
  if (cfgs[1]?.type === 'human') return 1;
  return navCallbacks.playerSetup.focusedColumn;
}

/** Versus lobbies only let a device ready its own player; ownerSlot -1 means any. */
function toggleReadyFrom(ownerSlot, target) {
  if (ownerSlot >= 0 && ownerSlot !== target) {
    soundManager.playTone(220, 0.1, 'sawtooth', 0.15);
    return;
  }
  navCallbacks.playerSetup.togglePlayerReady(target);
}

function toggleFocusedColumn() {
  navCallbacks.playerSetup.focusedColumn = 1 - navCallbacks.playerSetup.focusedColumn;
  soundManager.playTone(440, 0.06, 'sine', 0.2);
  navCallbacks.playerSetup.updateFocusUI();
}

/** Screen 1 (players): one navigation step in column `col`. Returns true if an option changed. */
function screen1Action(col, action) {
  const ps = navCallbacks.playerSetup;
  const row = ps.playerFocusRow[col];
  if (action === 'up' || action === 'down') {
    moveScreen1Row(col, action === 'up' ? -1 : 1);
    return false;
  }
  if (action === 'left' || action === 'right') {
    if (row === 8) {
      ps.screen1ActionCol = action === 'left' ? 0 : 1;
      ps.updateFocusUI();
      soundManager.playTone(400, 0.04, 'sine', 0.15);
      return false;
    }
    ps.cycleOption(col, row, action === 'left' ? -1 : 1);
    return true;
  }
  if (action === 'act') {
    if (row === 8) {
      if (ps.screen1ActionCol === 0) {
        ps.btnBack?.click();
      } else {
        ps.setupPage = 2;
        window._updateSetupPage();
      }
      return false;
    }
    ps.cycleOption(col, row, 1);
    return true;
  }
  return false;
}

/** Screen 2 (match rules): one shared cursor for every device. */
function rulesAction(action, ownerSlot) {
  const ps = navCallbacks.playerSetup;
  const row = ps.matchRulesFocusRow;
  if (action === 'up' || action === 'down') {
    ps.matchRulesFocusRow = Math.max(0, Math.min(3, row + (action === 'up' ? -1 : 1)));
    ps.updateFocusUI();
  } else if (action === 'left' || action === 'right') {
    const dir = action === 'left' ? -1 : 1;
    if (row === 0) ps.cycleMatchBall(dir);
    else if (row === 1) ps.cycleMatchDuration(dir);
    else if (row === 2) ps.cycleArena(dir);
    else {
      ps.matchRulesActionCol = Math.max(0, Math.min(3, (ps.matchRulesActionCol ?? 2) + dir));
      ps.updateFocusUI();
      soundManager.playTone(400, 0.04, 'sine', 0.15);
    }
  } else if (action === 'act') {
    if (ps.matchCountdownActive) ps.launchMatchNow();
    else if (row === 0) ps.cycleMatchBall(1);
    else if (row === 1) ps.cycleMatchDuration(1);
    else if (row === 2) ps.cycleArena(1);
    else {
      const col = ps.matchRulesActionCol ?? 2;
      if (col === 0) ps.btnBack?.click();
      else if (col === 1) toggleReadyFrom(ownerSlot, 0);
      else if (col === 2) {
        if (!ps.btnStartMatch?.disabled) ps.btnStartMatch?.click();
      } else toggleReadyFrom(ownerSlot, 1);
    }
  } else if (action === 'back') {
    if (ps.matchCountdownActive) {
      ps.cancelMatchCountdown();
      ps.playerReadyState[0] = false;
      ps.playerReadyState[1] = false;
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
    else toggleReadyFrom(ownerSlot, ownerSlot >= 0 ? ownerSlot : soloHumanSlot());
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

    // 0.5 Settings Modal Open (Main Menu)
    const settingsModalEl = getMainMenuSettingsModalEl();
    if (settingsModalEl && settingsModalEl.style.display === 'flex') {
      if (e.code === 'Escape' || e.code === 'Backspace') {
        e.preventDefault();
        hideMainMenuSettingsModal();
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
          howToModalEl._cycleDevice?.();
        } else {
          howToModalEl._cycleTab?.(-1);
        }
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        if (curTab === 'controls') {
          howToModalEl._cycleDevice?.();
        } else {
          howToModalEl._cycleTab?.(1);
        }
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (curTab === 'controls') {
          howToModalEl._cycleDevice?.();
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
      if (e.code === 'KeyB') {
        e.preventDefault();
        handleAssignmentKey('drop');
        return;
      }
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        handleAssignmentKey('confirm');
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        handleAssignmentKey('left');
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        handleAssignmentKey('right');
        return;
      }
      return;
    }

    // 2. Title Screen Active
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

    // --- CASE A: PRACTICE MODE ---
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
        navCallbacks.playerSetup.playerFocusRow[0] = Math.min(8, navCallbacks.playerSetup.playerFocusRow[0] + 1);
        navCallbacks.playerSetup.updateFocusUI();
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        if (navCallbacks.playerSetup.playerFocusRow[0] === 8) {
          navCallbacks.playerSetup.practiceActionCol = 0;
          navCallbacks.playerSetup.updateFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
          navCallbacks.playerSetup.cycleMatchBall(-1);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 6) {
          navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], -1);
        }
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        if (navCallbacks.playerSetup.playerFocusRow[0] === 8) {
          navCallbacks.playerSetup.practiceActionCol = 1;
          navCallbacks.playerSetup.updateFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
          navCallbacks.playerSetup.cycleMatchBall(1);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 6) {
          navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
        }
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (navCallbacks.playerSetup.playerFocusRow[0] === 8) {
          if (navCallbacks.playerSetup.practiceActionCol === 0) {
            navCallbacks.playerSetup.btnBack?.click();
          } else {
            navCallbacks.playerSetup.launchMatchNow();
          }
        } else if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
          navCallbacks.playerSetup.cycleMatchBall(1);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 6) {
          navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
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
    const keyOwner = (keyset) => (versus ? getMatchSlotForKeyset(keyset) : -1);

    if (navCallbacks.playerSetup.setupPage === 2) {
      if (e.code === 'Escape') {
        e.preventDefault();
        rulesAction('back', -1);
        return;
      }
      const nav = LOBBY_KEYS[e.code];
      if (!nav) return;
      e.preventDefault();
      rulesAction(nav[1], keyOwner(nav[0]));
      return;
    }

    if (e.code === 'Escape') {
      e.preventDefault();
      navCallbacks.showTitleScreen?.();
      return;
    }

    if (e.code === 'Tab') {
      e.preventDefault();
      if (versus) soundManager.playTone(220, 0.1, 'sawtooth', 0.15);
      else toggleFocusedColumn();
      return;
    }

    const nav = LOBBY_KEYS[e.code];
    if (!nav) return;
    e.preventDefault();
    screen1Action(versus ? keyOwner(nav[0]) : navCallbacks.playerSetup.focusedColumn, nav[1]);
  };
  window.addEventListener('keydown', onMenuKeyDown);

  // Seeds from what is held right now, so a press that opened this screen never fires here.
  menuPads.reset();

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

    // 0. Settings Modal Active (Main Menu)
    const settingsModalEl = getMainMenuSettingsModalEl();
    if (settingsModalEl && settingsModalEl.style.display === 'flex') {
      for (const pad of pads) {
        if (!pad) continue;
        const e = menuPads.pressed(pad);

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
          if ((e & MENU_PAD.left) || (e & MENU_PAD.right) || (e & MENU_PAD.x) || (e & MENU_PAD.a)) {
            howToModalEl._cycleDevice?.();
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

    // 2. Title Screen Active -> Any connected pad navigates Title options
    if (state.titleScreenEl && state.titleScreenEl.style.display === 'flex') {
      for (const pad of pads) {
        if (!pad) continue;
        const e = menuPads.pressed(pad);

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
      // Solo screen: any pad drives it, not just the first one connected.
      for (const pad of pads) {
        if (navCallbacks.playerSetup.playerSetupEl.style.display !== 'flex') return;
        const e = menuPads.pressed(pad);

        if (e & MENU_PAD.up) {
          navCallbacks.playerSetup.playerFocusRow[0] = Math.max(1, navCallbacks.playerSetup.playerFocusRow[0] - 1);
          navCallbacks.playerSetup.updateFocusUI();
        }
        if (e & MENU_PAD.down) {
          navCallbacks.playerSetup.playerFocusRow[0] = Math.min(8, navCallbacks.playerSetup.playerFocusRow[0] + 1);
          navCallbacks.playerSetup.updateFocusUI();
        }

        if (e & MENU_PAD.left) {
          if (navCallbacks.playerSetup.playerFocusRow[0] === 8) {
            navCallbacks.playerSetup.practiceActionCol = 0;
            navCallbacks.playerSetup.updateFocusUI();
            soundManager.playTone(400, 0.04, 'sine', 0.15);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
            navCallbacks.playerSetup.cycleMatchBall(-1);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 6) {
            navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], -1);
          }
        }
        if (e & MENU_PAD.right) {
          if (navCallbacks.playerSetup.playerFocusRow[0] === 8) {
            navCallbacks.playerSetup.practiceActionCol = 1;
            navCallbacks.playerSetup.updateFocusUI();
            soundManager.playTone(400, 0.04, 'sine', 0.15);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
            navCallbacks.playerSetup.cycleMatchBall(1);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 6) {
            navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
          }
        }

        if (e & MENU_PAD.lb) navCallbacks.playerSetup.cycleMatchBall(-1);
        if (e & MENU_PAD.rb) navCallbacks.playerSetup.cycleMatchBall(1);

        if (e & MENU_PAD.a) {
          if (navCallbacks.playerSetup.playerFocusRow[0] === 8) {
            if (navCallbacks.playerSetup.practiceActionCol === 0) {
              navCallbacks.playerSetup.btnBack?.click();
            } else {
              navCallbacks.playerSetup.launchMatchNow();
            }
          } else if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
            navCallbacks.playerSetup.cycleMatchBall(1);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 6) {
            navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
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
    // Versus: each pad drives only the player it was assigned to; bench pads sit out.
    // Otherwise (one human or spectating) every pad drives the shared cursor.
    const versus = navCallbacks.playerSetup.isVersusLobby();
    const page = navCallbacks.playerSetup.setupPage;
    for (const pad of pads) {
      const e = menuPads.pressed(pad);
      if (!e) continue;
      const ownerSlot = versus ? getAssignedSlotForPad(pad.index) : -1;
      if (versus && ownerSlot < 0) continue;

      if (page === 2) {
        if (e & MENU_PAD.up) rulesAction('up', ownerSlot);
        if (e & MENU_PAD.down) rulesAction('down', ownerSlot);
        if (e & (MENU_PAD.left | MENU_PAD.lb)) rulesAction('left', ownerSlot);
        else if (e & (MENU_PAD.right | MENU_PAD.rb)) rulesAction('right', ownerSlot);
        if (e & MENU_PAD.a) rulesAction('act', ownerSlot);
        if (e & (MENU_PAD.b | MENU_PAD.back)) rulesAction('back', ownerSlot);
        else if (e & MENU_PAD.start) rulesAction('start', ownerSlot);
      } else {
        const col = versus ? ownerSlot : navCallbacks.playerSetup.focusedColumn;
        if (e & MENU_PAD.up) {
          screen1Action(col, 'up');
          triggerMenuHaptics(pad, 25, 0.15, 0.05);
        }
        if (e & MENU_PAD.down) {
          screen1Action(col, 'down');
          triggerMenuHaptics(pad, 25, 0.15, 0.05);
        }
        const step = (action) => {
          if (screen1Action(col, action)) {
            soundManager.playTone(660, 0.045, 'sine', 0.18);
            triggerMenuHaptics(pad, 35, 0.25, 0.1);
          } else {
            triggerMenuHaptics(pad, 30, 0.2, 0.05);
          }
        };
        if (e & MENU_PAD.left) step('left');
        if (e & MENU_PAD.right) step('right');
        if (e & MENU_PAD.a) step('act');
        if (e & (MENU_PAD.lb | MENU_PAD.rb)) {
          // Switching columns is how a solo player sets up the AI; versus columns are locked.
          if (versus) {
            soundManager.playTone(220, 0.1, 'sawtooth', 0.15);
          } else {
            toggleFocusedColumn();
            triggerMenuHaptics(pad, 40, 0.3, 0.15);
          }
        }
        if (e & (MENU_PAD.b | MENU_PAD.back)) {
          if (navCallbacks.playerSetup.btnBack) {
            navCallbacks.playerSetup.btnBack.click();
          } else {
            navCallbacks.showTitleScreen?.();
          }
          soundManager.playTone(330, 0.08, 'sine', 0.15);
          triggerMenuHaptics(pad, 30, 0.2, 0.05);
          return;
        } else if (e & MENU_PAD.start) {
          navCallbacks.playerSetup.setupPage = 2;
          window._updateSetupPage();
          soundManager.playTone(660, 0.05, 'sine', 0.2);
          triggerMenuHaptics(pad, 35, 0.25, 0.1);
        }
      }

      // A page change or a launch belongs to the next poll.
      if (navCallbacks.playerSetup.setupPage !== page || navCallbacks.playerSetup.playerSetupEl.style.display !== 'flex') return;
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

