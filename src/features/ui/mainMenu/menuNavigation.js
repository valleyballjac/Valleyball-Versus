import { soundManager } from '../../../audio/soundManager.js';
import { state } from './state.js';
import { getControllerAssignments } from '../../../input/inputRouter.js';
import { hideMainMenuSettingsModal, getMainMenuSettingsModalEl } from './settingsModal.js';
import { hideHowToPlayModal, getControlsModalEl } from './howToPlayModal.js';
import { updateTitleFocusUI } from './titleScreen.js';

import { pollAssignmentGamepads } from './controllerAssignment.js';

let navCallbacks = {
  showTitleScreen: null,
  showPlayerSetup: null,
  getTitleScreenEl: null,
  getTitleButtons: null,
  getTitleFocusIndex: null,
  setTitleFocusIndex: null,
  playerSetup: null,
};

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
  next = Math.max(0, Math.min(7, next));
  navCallbacks.playerSetup.playerFocusRow[col] = next;
  navCallbacks.playerSetup.updateFocusUI();
  soundManager.playTone(520, 0.035, 'sine', 0.12);
}

state.titlePrevPads = [{ up: false, down: false, a: false, b: false, start: false, back: false }];

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
      if (e.code === 'KeyB') {
        e.preventDefault();
        const unassignBtn = state.controllerAssignmentEl?.querySelector('.contextual-btn-badge[title="Drop to bench"]');
        unassignBtn?.click();
        return;
      }
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        const btnProceed = document.getElementById('assignment-btn-proceed');
        btnProceed?.click();
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        const btnClaim1 = document.getElementById('btn-claim-team1');
        btnClaim1?.click();
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        const btnClaim2 = document.getElementById('btn-claim-team2');
        btnClaim2?.click();
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
        navCallbacks.playerSetup.playerFocusRow[0] = Math.min(7, navCallbacks.playerSetup.playerFocusRow[0] + 1);
        navCallbacks.playerSetup.updateFocusUI();
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
          navCallbacks.playerSetup.practiceActionCol = 0;
          navCallbacks.playerSetup.updateFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] === 6) {
          navCallbacks.playerSetup.cycleMatchBall(-1);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 5) {
          navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], -1);
        }
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
          navCallbacks.playerSetup.practiceActionCol = 1;
          navCallbacks.playerSetup.updateFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] === 6) {
          navCallbacks.playerSetup.cycleMatchBall(1);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 5) {
          navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
        }
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
          if (navCallbacks.playerSetup.practiceActionCol === 0) {
            navCallbacks.playerSetup.btnBack?.click();
          } else {
            navCallbacks.playerSetup.launchMatchNow();
          }
        } else if (navCallbacks.playerSetup.playerFocusRow[0] === 6) {
          navCallbacks.playerSetup.cycleMatchBall(1);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 5) {
          navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
        }
        return;
      }
      return;
    }

    // --- CASE B: MATCH MODE SCREEN 2 (MATCH RULES) ---
    if (navCallbacks.playerSetup.setupPage === 2) {
      if (e.code === 'Escape') {
        e.preventDefault();
        if (navCallbacks.playerSetup.matchCountdownActive) {
          navCallbacks.playerSetup.cancelMatchCountdown();
          navCallbacks.playerSetup.playerReadyState[0] = false;
          navCallbacks.playerSetup.playerReadyState[1] = false;
          soundManager.playTone(330, 0.12, 'sine', 0.2);
          navCallbacks.playerSetup.updateReadyUI();
          return;
        }
        navCallbacks.playerSetup.setupPage = 1;
        window._updateSetupPage();
        soundManager.playTone(330, 0.08, 'sine', 0.15);
        return;
      }

      if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'KeyI') {
        e.preventDefault();
        navCallbacks.playerSetup.matchRulesFocusRow = Math.max(0, navCallbacks.playerSetup.matchRulesFocusRow - 1);
        navCallbacks.playerSetup.updateFocusUI();
        return;
      }
      if (e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'KeyK') {
        e.preventDefault();
        navCallbacks.playerSetup.matchRulesFocusRow = Math.min(3, navCallbacks.playerSetup.matchRulesFocusRow + 1);
        navCallbacks.playerSetup.updateFocusUI();
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'KeyJ') {
        e.preventDefault();
        if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(-1);
        else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(-1);
        else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(-1);
        else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) {
          navCallbacks.playerSetup.matchRulesActionCol = Math.max(0, (navCallbacks.playerSetup.matchRulesActionCol ?? 2) - 1);
          navCallbacks.playerSetup.updateFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
        }
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'KeyL') {
        e.preventDefault();
        if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(1);
        else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(1);
        else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(1);
        else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) {
          navCallbacks.playerSetup.matchRulesActionCol = Math.min(3, (navCallbacks.playerSetup.matchRulesActionCol ?? 2) + 1);
          navCallbacks.playerSetup.updateFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
        }
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (navCallbacks.playerSetup.matchCountdownActive) {
          navCallbacks.playerSetup.launchMatchNow();
          return;
        }
        if (navCallbacks.playerSetup.matchRulesFocusRow === 0) {
          navCallbacks.playerSetup.cycleMatchBall(1);
        } else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) {
          navCallbacks.playerSetup.cycleMatchDuration(1);
        } else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) {
          navCallbacks.playerSetup.cycleArena(1);
        } else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) {
          const col = navCallbacks.playerSetup.matchRulesActionCol ?? 2;
          if (col === 0) {
            navCallbacks.playerSetup.btnBack?.click();
          } else if (col === 1) {
            navCallbacks.playerSetup.togglePlayerReady(0);
          } else if (col === 2) {
            if (!navCallbacks.playerSetup.btnStartMatch?.disabled) {
              navCallbacks.playerSetup.btnStartMatch?.click();
            }
          } else if (col === 3) {
            navCallbacks.playerSetup.togglePlayerReady(1);
          }
        }
        return;
      }
      return;
    }

    // --- CASE C: MATCH MODE SCREEN 1 (PLAYER & TEAM SETUP) ---
    if (e.code === 'Escape') {
      e.preventDefault();
      navCallbacks.showTitleScreen?.();
      return;
    }

    if (e.code === 'Tab') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 1 - navCallbacks.playerSetup.focusedColumn;
      soundManager.playTone(440, 0.06, 'sine', 0.2);
      navCallbacks.playerSetup.updateFocusUI();
      return;
    }

    // Unified Arrow Keys navigation
    if (e.code === 'ArrowUp') {
      e.preventDefault();
      moveScreen1Row(navCallbacks.playerSetup.focusedColumn, -1);
      return;
    }
    if (e.code === 'ArrowDown') {
      e.preventDefault();
      moveScreen1Row(navCallbacks.playerSetup.focusedColumn, 1);
      return;
    }
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      const col = navCallbacks.playerSetup.focusedColumn;
      const row = navCallbacks.playerSetup.playerFocusRow[col];
      if (row === 7) {
        navCallbacks.playerSetup.screen1ActionCol = 0;
        navCallbacks.playerSetup.updateFocusUI();
        soundManager.playTone(400, 0.04, 'sine', 0.15);
      } else {
        navCallbacks.playerSetup.cycleOption(col, row, -1);
      }
      return;
    }
    if (e.code === 'ArrowRight') {
      e.preventDefault();
      const col = navCallbacks.playerSetup.focusedColumn;
      const row = navCallbacks.playerSetup.playerFocusRow[col];
      if (row === 7) {
        navCallbacks.playerSetup.screen1ActionCol = 1;
        navCallbacks.playerSetup.updateFocusUI();
        soundManager.playTone(400, 0.04, 'sine', 0.15);
      } else {
        navCallbacks.playerSetup.cycleOption(col, row, 1);
      }
      return;
    }

    // Player 1 Keyboard Controls (WASD navigation, Space action)
    if (e.code === 'KeyW') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 0;
      moveScreen1Row(0, -1);
      return;
    }
    if (e.code === 'KeyS') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 0;
      moveScreen1Row(0, 1);
      return;
    }
    if (e.code === 'KeyA') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 0;
      if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
        navCallbacks.playerSetup.screen1ActionCol = 0;
        navCallbacks.playerSetup.updateFocusUI();
        soundManager.playTone(400, 0.04, 'sine', 0.15);
      } else {
        navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], -1);
      }
      return;
    }
    if (e.code === 'KeyD') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 0;
      if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
        navCallbacks.playerSetup.screen1ActionCol = 1;
        navCallbacks.playerSetup.updateFocusUI();
        soundManager.playTone(400, 0.04, 'sine', 0.15);
      } else {
        navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
      }
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
        if (navCallbacks.playerSetup.screen1ActionCol === 0) {
          navCallbacks.playerSetup.btnBack?.click();
        } else {
          navCallbacks.playerSetup.setupPage = 2;
          window._updateSetupPage();
        }
      } else {
        navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
      }
      return;
    }

    // Player 2 Keyboard Controls (IJKL navigation, Enter action)
    if (e.code === 'KeyI') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 1;
      moveScreen1Row(1, -1);
      return;
    }
    if (e.code === 'KeyK') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 1;
      moveScreen1Row(1, 1);
      return;
    }
    if (e.code === 'KeyJ') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 1;
      if (navCallbacks.playerSetup.playerFocusRow[1] === 7) {
        navCallbacks.playerSetup.screen1ActionCol = 0;
        navCallbacks.playerSetup.updateFocusUI();
        soundManager.playTone(400, 0.04, 'sine', 0.15);
      } else {
        navCallbacks.playerSetup.cycleOption(1, navCallbacks.playerSetup.playerFocusRow[1], -1);
      }
      return;
    }
    if (e.code === 'KeyL') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 1;
      if (navCallbacks.playerSetup.playerFocusRow[1] === 7) {
        navCallbacks.playerSetup.screen1ActionCol = 1;
        navCallbacks.playerSetup.updateFocusUI();
        soundManager.playTone(400, 0.04, 'sine', 0.15);
      } else {
        navCallbacks.playerSetup.cycleOption(1, navCallbacks.playerSetup.playerFocusRow[1], 1);
      }
      return;
    }
    if (e.code === 'Enter') {
      e.preventDefault();
      const targetIdx = navCallbacks.playerSetup.focusedColumn;
      if (navCallbacks.playerSetup.playerFocusRow[targetIdx] === 7) {
        if (navCallbacks.playerSetup.screen1ActionCol === 0) {
          navCallbacks.playerSetup.btnBack?.click();
        } else {
          navCallbacks.playerSetup.setupPage = 2;
          window._updateSetupPage();
        }
      } else {
        navCallbacks.playerSetup.cycleOption(targetIdx, navCallbacks.playerSetup.playerFocusRow[targetIdx], 1);
      }
      return;
    }
  };
  window.addEventListener('keydown', onMenuKeyDown);

  const prevPads = [
    { up: false, down: false, left: false, right: false, a: false, b: false, lb: false, rb: false, start: false, back: false },
    { up: false, down: false, left: false, right: false, a: false, b: false, lb: false, rb: false, start: false, back: false },
  ];
  state.titlePrevPads = [{ up: false, down: false, a: false, b: false, start: false, back: false }];

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

    // 0. Settings Modal Active (Main Menu)
    const settingsModalEl = getMainMenuSettingsModalEl();
    if (settingsModalEl && settingsModalEl.style.display === 'flex') {
      for (const pad of pads) {
        if (!pad) continue;
        const up = (pad.buttons[12]?.pressed || (pad.axes[1] && pad.axes[1] < -0.5)) || false;
        const down = (pad.buttons[13]?.pressed || (pad.axes[1] && pad.axes[1] > 0.5)) || false;
        const left = (pad.buttons[14]?.pressed || (pad.axes[0] && pad.axes[0] < -0.5)) || false;
        const right = (pad.buttons[15]?.pressed || (pad.axes[0] && pad.axes[0] > 0.5)) || false;
        const btnA = pad.buttons[0]?.pressed || false;
        const btnB = pad.buttons[1]?.pressed || false;
        const btnBack = pad.buttons[8]?.pressed || false;
        const p = state.titlePrevPads[0];

        if (up && !p.up) settingsModalEl._moveFocus?.(-1);
        if (down && !p.down) settingsModalEl._moveFocus?.(1);
        if (left && !p.left) settingsModalEl._handleLeft?.();
        if (right && !p.right) settingsModalEl._handleRight?.();
        if (btnA && !p.a) settingsModalEl._handleAction?.();

        if ((btnB && !p.b) || (btnBack && !p.back)) {
          hideMainMenuSettingsModal();
          p.b = btnB; p.back = btnBack;
          return;
        }

        p.up = up; p.down = down; p.left = left; p.right = right;
        p.a = btnA; p.b = btnB; p.back = btnBack;
      }
      return;
    }

    // 1. How To Play Modal Active
    const howToModalEl = getControlsModalEl();
    if (howToModalEl && howToModalEl.style.display === 'flex') {
      const curTab = howToModalEl._getCurrentTab ? howToModalEl._getCurrentTab() : 'controls';
      for (const pad of pads) {
        if (!pad) continue;
        const btnB = pad.buttons[1]?.pressed || false;
        const btnX = pad.buttons[2]?.pressed || false;
        const btnA = pad.buttons[0]?.pressed || false;
        const btnStart = pad.buttons[9]?.pressed || false;
        const btnBack = pad.buttons[8]?.pressed || false;
        const btnLB = pad.buttons[4]?.pressed || false;
        const btnRB = pad.buttons[5]?.pressed || false;
        const up = (pad.buttons[12]?.pressed || (pad.axes[1] && pad.axes[1] < -0.4)) || false;
        const down = (pad.buttons[13]?.pressed || (pad.axes[1] && pad.axes[1] > 0.4)) || false;
        const left = (pad.buttons[14]?.pressed || (pad.axes[0] && pad.axes[0] < -0.5)) || false;
        const right = (pad.buttons[15]?.pressed || (pad.axes[0] && pad.axes[0] > 0.5)) || false;
        const p = state.titlePrevPads[0];

        if ((btnLB && !p.lb)) {
          howToModalEl._cycleTab?.(-1);
        } else if ((btnRB && !p.rb)) {
          howToModalEl._cycleTab?.(1);
        }

        if (curTab === 'controls') {
          if ((left && !p.left) || (right && !p.right) || (btnX && !p.x) || (btnA && !p.a)) {
            howToModalEl._cycleDevice?.();
          }
        } else {
          if (left && !p.left) howToModalEl._cycleTab?.(-1);
          else if (right && !p.right) howToModalEl._cycleTab?.(1);
        }

        if (up) howToModalEl._scrollContent?.(-14);
        if (down) howToModalEl._scrollContent?.(14);

        p.lb = btnLB; p.rb = btnRB; p.left = left; p.right = right;
        p.up = up; p.down = down; p.x = btnX; p.a = btnA;

        if ((btnB && !p.b) || (btnStart && !p.start) || (btnBack && !p.back)) {
          hideHowToPlayModal();
          p.b = btnB; p.start = btnStart; p.back = btnBack;
          return;
        }
        p.b = btnB; p.start = btnStart; p.back = btnBack;
      }
      return;
    }

    // 1.5 Controller Assignment Active
    if (state.controllerAssignmentEl && state.controllerAssignmentEl.style.display === 'flex') {
      pollAssignmentGamepads(pads);
      return;
    }

    // 2. Title Screen Active -> Any connected pad navigates Title options
    if (state.titleScreenEl && state.titleScreenEl.style.display === 'flex') {
      for (const pad of pads) {
        if (!pad) continue;
        const up = (pad.buttons[12]?.pressed || (pad.axes[1] && pad.axes[1] < -0.5)) || false;
        const down = (pad.buttons[13]?.pressed || (pad.axes[1] && pad.axes[1] > 0.5)) || false;
        const btnA = pad.buttons[0]?.pressed || false;
        const btnStart = pad.buttons[9]?.pressed || false;
        const p = state.titlePrevPads[0];

        if (up && !p.up) {
          state.titleFocusIndex = (state.titleFocusIndex - 1 + state.titleButtons.length) % state.titleButtons.length;
          updateTitleFocusUI();
          soundManager.playTone(520, 0.035, 'sine', 0.12);
          triggerMenuHaptics(pad, 25, 0.15, 0.05);
        }
        if (down && !p.down) {
          state.titleFocusIndex = (state.titleFocusIndex + 1) % state.titleButtons.length;
          updateTitleFocusUI();
          soundManager.playTone(520, 0.035, 'sine', 0.12);
          triggerMenuHaptics(pad, 25, 0.15, 0.05);
        }
        if ((btnA && !p.a) || (btnStart && !p.start)) {
          soundManager.playTone(660, 0.05, 'sine', 0.18);
          triggerMenuHaptics(pad, 35, 0.25, 0.1);
          navCallbacks.getTitleButtons?.()[navCallbacks.getTitleFocusIndex?.()]?.click();
        }

        p.up = up;
        p.down = down;
        p.a = btnA;
        p.start = btnStart;
      }
      return;
    }

    // 3. Player Setup Active
    if (!navCallbacks.playerSetup.playerSetupEl || navCallbacks.playerSetup.playerSetupEl.style.display !== 'flex') return;

    const isSingleController = pads.length < 2;
    if (navCallbacks.playerSetup.updateInputBadgesUI) {
      navCallbacks.playerSetup.updateInputBadgesUI();
    } else {
      const assignments = getControllerAssignments(navCallbacks.playerSetup.currentSetupMode === 'practice' ? 1 : 2, navCallbacks.playerSetup.currentSetupMode);
      if (navCallbacks.playerSetup.playerInputBadges[0]) navCallbacks.playerSetup.playerInputBadges[0].textContent = `INPUT: ${assignments.p1}`;
      if (navCallbacks.playerSetup.playerInputBadges[1] && navCallbacks.playerSetup.currentSetupMode !== 'practice') navCallbacks.playerSetup.playerInputBadges[1].textContent = `INPUT: ${assignments.p2}`;
    }

    if (navCallbacks.playerSetup.currentSetupMode === 'practice') {
      const pad = pads[0] || null;
      if (pad) {
        const prev = prevPads[0];
        const up = (pad.buttons[12]?.pressed || (pad.axes[1] && pad.axes[1] < -0.5)) || false;
        const down = (pad.buttons[13]?.pressed || (pad.axes[1] && pad.axes[1] > 0.5)) || false;
        const left = (pad.buttons[14]?.pressed || (pad.axes[0] && pad.axes[0] < -0.5)) || false;
        const right = (pad.buttons[15]?.pressed || (pad.axes[0] && pad.axes[0] > 0.5)) || false;

        const btnA = pad.buttons[0]?.pressed || false;
        const btnB = pad.buttons[1]?.pressed || false;
        const btnLB = pad.buttons[4]?.pressed || false;
        const btnRB = pad.buttons[5]?.pressed || false;
        const btnBack = pad.buttons[8]?.pressed || false;
        const btnStart = pad.buttons[9]?.pressed || false;

        if (up && !prev.up) {
          navCallbacks.playerSetup.playerFocusRow[0] = Math.max(1, navCallbacks.playerSetup.playerFocusRow[0] - 1);
          navCallbacks.playerSetup.updateFocusUI();
        }
        if (down && !prev.down) {
          navCallbacks.playerSetup.playerFocusRow[0] = Math.min(7, navCallbacks.playerSetup.playerFocusRow[0] + 1);
          navCallbacks.playerSetup.updateFocusUI();
        }

        if (left && !prev.left) {
          if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
            navCallbacks.playerSetup.practiceActionCol = 0;
            navCallbacks.playerSetup.updateFocusUI();
            soundManager.playTone(400, 0.04, 'sine', 0.15);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] === 6) {
            navCallbacks.playerSetup.cycleMatchBall(-1);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 5) {
            navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], -1);
          }
        }
        if (right && !prev.right) {
          if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
            navCallbacks.playerSetup.practiceActionCol = 1;
            navCallbacks.playerSetup.updateFocusUI();
            soundManager.playTone(400, 0.04, 'sine', 0.15);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] === 6) {
            navCallbacks.playerSetup.cycleMatchBall(1);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 5) {
            navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
          }
        }

        if (btnLB && !prev.lb) navCallbacks.playerSetup.cycleMatchBall(-1);
        if (btnRB && !prev.rb) navCallbacks.playerSetup.cycleMatchBall(1);

        if (btnA && !prev.a) {
          if (navCallbacks.playerSetup.playerFocusRow[0] === 7) {
            if (navCallbacks.playerSetup.practiceActionCol === 0) {
              navCallbacks.playerSetup.btnBack?.click();
            } else {
              navCallbacks.playerSetup.launchMatchNow();
            }
          } else if (navCallbacks.playerSetup.playerFocusRow[0] === 6) {
            navCallbacks.playerSetup.cycleMatchBall(1);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 5) {
            navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
          }
        }

        if ((btnB && !prev.b) || (btnBack && !prev.back)) {
          navCallbacks.showTitleScreen?.();
          return;
        }

        if (btnStart && !prev.start) {
          navCallbacks.playerSetup.launchMatchNow();
        }

        prev.up = up; prev.down = down; prev.left = left; prev.right = right;
        prev.a = btnA; prev.b = btnB; prev.lb = btnLB; prev.rb = btnRB;
        prev.back = btnBack; prev.start = btnStart;
      }
      return;
    }

    // --- MATCH MODE SCREEN 2 (MATCH RULES) ---
    if (navCallbacks.playerSetup.setupPage === 2) {
      if (isSingleController) {
        const pad = pads[0];
        if (!pad) return;
        const prev = prevPads[0];

        const up = (pad.buttons[12]?.pressed || (pad.axes[1] && pad.axes[1] < -0.5)) || false;
        const down = (pad.buttons[13]?.pressed || (pad.axes[1] && pad.axes[1] > 0.5)) || false;
        const left = (pad.buttons[14]?.pressed || (pad.axes[0] && pad.axes[0] < -0.5)) || false;
        const right = (pad.buttons[15]?.pressed || (pad.axes[0] && pad.axes[0] > 0.5)) || false;

        const btnA = pad.buttons[0]?.pressed || false;
        const btnB = pad.buttons[1]?.pressed || false;
        const btnLB = pad.buttons[4]?.pressed || false;
        const btnRB = pad.buttons[5]?.pressed || false;
        const btnBack = pad.buttons[8]?.pressed || false;
        const btnStart = pad.buttons[9]?.pressed || false;

        if (up && !prev.up) {
          navCallbacks.playerSetup.matchRulesFocusRow = Math.max(0, navCallbacks.playerSetup.matchRulesFocusRow - 1);
          navCallbacks.playerSetup.updateFocusUI();
        }
        if (down && !prev.down) {
          navCallbacks.playerSetup.matchRulesFocusRow = Math.min(3, navCallbacks.playerSetup.matchRulesFocusRow + 1);
          navCallbacks.playerSetup.updateFocusUI();
        }

        if (left && !prev.left) {
          if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) {
            navCallbacks.playerSetup.matchRulesActionCol = Math.max(0, (navCallbacks.playerSetup.matchRulesActionCol ?? 2) - 1);
            navCallbacks.playerSetup.updateFocusUI();
            soundManager.playTone(400, 0.04, 'sine', 0.15);
          }
        }
        if (right && !prev.right) {
          if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) {
            navCallbacks.playerSetup.matchRulesActionCol = Math.min(3, (navCallbacks.playerSetup.matchRulesActionCol ?? 2) + 1);
            navCallbacks.playerSetup.updateFocusUI();
            soundManager.playTone(400, 0.04, 'sine', 0.15);
          }
        }

        if (btnLB && !prev.lb) {
          if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) {
            navCallbacks.playerSetup.matchRulesActionCol = Math.max(0, (navCallbacks.playerSetup.matchRulesActionCol ?? 2) - 1);
            navCallbacks.playerSetup.updateFocusUI();
          }
        }
        if (btnRB && !prev.rb) {
          if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) {
            navCallbacks.playerSetup.matchRulesActionCol = Math.min(3, (navCallbacks.playerSetup.matchRulesActionCol ?? 2) + 1);
            navCallbacks.playerSetup.updateFocusUI();
          }
        }

        if (btnA && !prev.a) {
          if (navCallbacks.playerSetup.matchCountdownActive) {
            navCallbacks.playerSetup.launchMatchNow();
          } else if (navCallbacks.playerSetup.matchRulesFocusRow === 0) {
            navCallbacks.playerSetup.cycleMatchBall(1);
          } else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) {
            navCallbacks.playerSetup.cycleMatchDuration(1);
          } else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) {
            navCallbacks.playerSetup.cycleArena(1);
          } else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) {
            const col = navCallbacks.playerSetup.matchRulesActionCol ?? 2;
            if (col === 0) navCallbacks.playerSetup.btnBack?.click();
            else if (col === 1) navCallbacks.playerSetup.togglePlayerReady(0);
            else if (col === 2) {
              if (!navCallbacks.playerSetup.btnStartMatch?.disabled) navCallbacks.playerSetup.btnStartMatch?.click();
            } else if (col === 3) navCallbacks.playerSetup.togglePlayerReady(1);
          }
        }

        if ((btnB && !prev.b) || (btnBack && !prev.back)) {
          if (navCallbacks.playerSetup.matchCountdownActive) {
            navCallbacks.playerSetup.cancelMatchCountdown();
            navCallbacks.playerSetup.playerReadyState[0] = false;
            navCallbacks.playerSetup.playerReadyState[1] = false;
            soundManager.playTone(330, 0.12, 'sine', 0.2);
            navCallbacks.playerSetup.updateReadyUI();
          } else {
            navCallbacks.playerSetup.setupPage = 1;
            window._updateSetupPage();
            soundManager.playTone(330, 0.08, 'sine', 0.15);
          }
        }

        if (btnStart && !prev.start) {
          if (navCallbacks.playerSetup.matchCountdownActive) {
            navCallbacks.playerSetup.launchMatchNow();
          } else if (!navCallbacks.playerSetup.btnStartMatch?.disabled) {
            navCallbacks.playerSetup.btnStartMatch?.click();
          } else {
            navCallbacks.playerSetup.togglePlayerReady(navCallbacks.playerSetup.focusedColumn);
          }
        }

        prev.up = up; prev.down = down; prev.left = left; prev.right = right;
        prev.a = btnA; prev.b = btnB; prev.lb = btnLB; prev.rb = btnRB;
        prev.back = btnBack; prev.start = btnStart;
        return;
      }

      // Dual Gamepads on Screen 2
      [0, 1].forEach((playerIdx) => {
        const pad = pads[playerIdx];
        if (!pad) return;
        const prev = prevPads[playerIdx];

        const up = (pad.buttons[12]?.pressed || (pad.axes[1] && pad.axes[1] < -0.5)) || false;
        const down = (pad.buttons[13]?.pressed || (pad.axes[1] && pad.axes[1] > 0.5)) || false;
        const left = (pad.buttons[14]?.pressed || (pad.axes[0] && pad.axes[0] < -0.5)) || false;
        const right = (pad.buttons[15]?.pressed || (pad.axes[0] && pad.axes[0] > 0.5)) || false;

        const btnA = pad.buttons[0]?.pressed || false;
        const btnB = pad.buttons[1]?.pressed || false;
        const btnLB = pad.buttons[4]?.pressed || false;
        const btnRB = pad.buttons[5]?.pressed || false;
        const btnBack = pad.buttons[8]?.pressed || false;
        const btnStart = pad.buttons[9]?.pressed || false;

        if (up && !prev.up) {
          navCallbacks.playerSetup.matchRulesFocusRow = Math.max(0, navCallbacks.playerSetup.matchRulesFocusRow - 1);
          navCallbacks.playerSetup.updateFocusUI();
        }
        if (down && !prev.down) {
          navCallbacks.playerSetup.matchRulesFocusRow = Math.min(4, navCallbacks.playerSetup.matchRulesFocusRow + 1);
          navCallbacks.playerSetup.updateFocusUI();
        }

        if (left && !prev.left) {
          if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) { navCallbacks.playerSetup.focusedColumn = 0; navCallbacks.playerSetup.updateFocusUI(); }
        }
        if (right && !prev.right) {
          if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) { navCallbacks.playerSetup.focusedColumn = 1; navCallbacks.playerSetup.updateFocusUI(); }
        }

        if (btnLB && !prev.lb) {
          if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(-1);
        }
        if (btnRB && !prev.rb) {
          if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(1);
        }

        if (btnA && !prev.a) {
          if (navCallbacks.playerSetup.matchCountdownActive) {
            navCallbacks.playerSetup.launchMatchNow();
          } else if (navCallbacks.playerSetup.matchRulesFocusRow === 0) {
            navCallbacks.playerSetup.cycleMatchBall(1);
          } else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) {
            navCallbacks.playerSetup.cycleMatchDuration(1);
          } else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) {
            navCallbacks.playerSetup.cycleArena(1);
          } else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) {
            navCallbacks.playerSetup.togglePlayerReady(playerIdx);
          } else if (navCallbacks.playerSetup.matchRulesFocusRow === 4) {
            if (!navCallbacks.playerSetup.btnStartMatch?.disabled) navCallbacks.playerSetup.btnStartMatch?.click();
          }
        }

        if ((btnB && !prev.b) || (btnBack && !prev.back)) {
          if (navCallbacks.playerSetup.matchCountdownActive) {
            navCallbacks.playerSetup.cancelMatchCountdown();
            navCallbacks.playerSetup.playerReadyState[0] = false;
            navCallbacks.playerSetup.playerReadyState[1] = false;
            soundManager.playTone(330, 0.12, 'sine', 0.2);
            navCallbacks.playerSetup.updateReadyUI();
          } else {
            navCallbacks.playerSetup.setupPage = 1;
            window._updateSetupPage();
            soundManager.playTone(330, 0.08, 'sine', 0.15);
          }
        }

        if (btnStart && !prev.start) {
          if (navCallbacks.playerSetup.matchCountdownActive) {
            navCallbacks.playerSetup.launchMatchNow();
          } else if (!navCallbacks.playerSetup.btnStartMatch?.disabled) {
            navCallbacks.playerSetup.btnStartMatch?.click();
          } else {
            navCallbacks.playerSetup.togglePlayerReady(playerIdx);
          }
        }

        prev.up = up; prev.down = down; prev.left = left; prev.right = right;
        prev.a = btnA; prev.b = btnB; prev.lb = btnLB; prev.rb = btnRB;
        prev.back = btnBack; prev.start = btnStart;
      });
      return;
    }

    // --- MATCH MODE SCREEN 1 (PLAYER & TEAM SETUP) ---
    if (isSingleController) {
      const pad = pads[0];
      if (!pad) return;
      const prev = prevPads[0];

      const up = (pad.buttons[12]?.pressed || (pad.axes[1] && pad.axes[1] < -0.5)) || false;
      const down = (pad.buttons[13]?.pressed || (pad.axes[1] && pad.axes[1] > 0.5)) || false;
      const left = (pad.buttons[14]?.pressed || (pad.axes[0] && pad.axes[0] < -0.5)) || false;
      const right = (pad.buttons[15]?.pressed || (pad.axes[0] && pad.axes[0] > 0.5)) || false;

      const btnA = pad.buttons[0]?.pressed || false;
      const btnB = pad.buttons[1]?.pressed || false;
      const btnLB = pad.buttons[4]?.pressed || false;
      const btnRB = pad.buttons[5]?.pressed || false;
      const btnBack = pad.buttons[8]?.pressed || false;
      const btnStart = pad.buttons[9]?.pressed || false;

      if (up && !prev.up) {
        moveScreen1Row(navCallbacks.playerSetup.focusedColumn, -1);
        triggerMenuHaptics(pad, 25, 0.15, 0.05);
      }
      if (down && !prev.down) {
        moveScreen1Row(navCallbacks.playerSetup.focusedColumn, 1);
        triggerMenuHaptics(pad, 25, 0.15, 0.05);
      }

      if (left && !prev.left) {
        const col = navCallbacks.playerSetup.focusedColumn;
        const row = navCallbacks.playerSetup.playerFocusRow[col];
        if (row === 7) {
          navCallbacks.playerSetup.screen1ActionCol = 0;
          navCallbacks.playerSetup.updateFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
          triggerMenuHaptics(pad, 30, 0.2, 0.05);
        } else {
          navCallbacks.playerSetup.cycleOption(col, row, -1);
          soundManager.playTone(660, 0.045, 'sine', 0.18);
          triggerMenuHaptics(pad, 35, 0.25, 0.1);
        }
      }
      if (right && !prev.right) {
        const col = navCallbacks.playerSetup.focusedColumn;
        const row = navCallbacks.playerSetup.playerFocusRow[col];
        if (row === 7) {
          navCallbacks.playerSetup.screen1ActionCol = 1;
          navCallbacks.playerSetup.updateFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
          triggerMenuHaptics(pad, 30, 0.2, 0.05);
        } else {
          navCallbacks.playerSetup.cycleOption(col, row, 1);
          soundManager.playTone(660, 0.045, 'sine', 0.18);
          triggerMenuHaptics(pad, 35, 0.25, 0.1);
        }
      }

      if (btnLB && !prev.lb) {
        navCallbacks.playerSetup.focusedColumn = 1 - navCallbacks.playerSetup.focusedColumn;
        soundManager.playTone(440, 0.06, 'sine', 0.2);
        triggerMenuHaptics(pad, 40, 0.3, 0.15);
        navCallbacks.playerSetup.updateFocusUI();
      }
      if (btnRB && !prev.rb) {
        navCallbacks.playerSetup.focusedColumn = 1 - navCallbacks.playerSetup.focusedColumn;
        soundManager.playTone(440, 0.06, 'sine', 0.2);
        triggerMenuHaptics(pad, 40, 0.3, 0.15);
        navCallbacks.playerSetup.updateFocusUI();
      }

      if (btnA && !prev.a) {
        const col = navCallbacks.playerSetup.focusedColumn;
        const row = navCallbacks.playerSetup.playerFocusRow[col];
        if (row === 7) {
          if (navCallbacks.playerSetup.screen1ActionCol === 0) {
            navCallbacks.playerSetup.btnBack?.click();
          } else {
            navCallbacks.playerSetup.setupPage = 2;
            window._updateSetupPage();
          }
        } else {
          navCallbacks.playerSetup.cycleOption(col, row, 1);
          soundManager.playTone(660, 0.045, 'sine', 0.18);
          triggerMenuHaptics(pad, 35, 0.25, 0.1);
        }
      }

      if ((btnB && !prev.b) || (btnBack && !prev.back)) {
        if (navCallbacks.playerSetup.btnBack) {
          navCallbacks.playerSetup.btnBack.click();
        } else {
          navCallbacks.showTitleScreen?.();
        }
        soundManager.playTone(330, 0.08, 'sine', 0.15);
        triggerMenuHaptics(pad, 30, 0.2, 0.05);
        return;
      }

      if (btnStart && !prev.start) {
        navCallbacks.playerSetup.setupPage = 2;
        window._updateSetupPage();
        soundManager.playTone(660, 0.05, 'sine', 0.2);
        triggerMenuHaptics(pad, 35, 0.25, 0.1);
      }

      prev.up = up; prev.down = down; prev.left = left; prev.right = right;
      prev.a = btnA; prev.b = btnB; prev.lb = btnLB; prev.rb = btnRB;
      prev.back = btnBack; prev.start = btnStart;
      return;
    }

    // Match Mode: Two Gamepads Connected on Screen 1 (Pad 0 drives P1, Pad 1 drives P2)
    [0, 1].forEach((playerIdx) => {
      const pad = pads[playerIdx];
      if (!pad) return;
      const prev = prevPads[playerIdx];

      const up = (pad.buttons[12]?.pressed || (pad.axes[1] && pad.axes[1] < -0.5)) || false;
      const down = (pad.buttons[13]?.pressed || (pad.axes[1] && pad.axes[1] > 0.5)) || false;
      const left = (pad.buttons[14]?.pressed || (pad.axes[0] && pad.axes[0] < -0.5)) || false;
      const right = (pad.buttons[15]?.pressed || (pad.axes[0] && pad.axes[0] > 0.5)) || false;

      const btnA = pad.buttons[0]?.pressed || false;
      const btnB = pad.buttons[1]?.pressed || false;
      const btnLB = pad.buttons[4]?.pressed || false;
      const btnRB = pad.buttons[5]?.pressed || false;
      const btnBack = pad.buttons[8]?.pressed || false;
      const btnStart = pad.buttons[9]?.pressed || false;

      if (up && !prev.up) {
        moveScreen1Row(playerIdx, -1);
        triggerMenuHaptics(pad, 25, 0.15, 0.05);
      }
      if (down && !prev.down) {
        moveScreen1Row(playerIdx, 1);
        triggerMenuHaptics(pad, 25, 0.15, 0.05);
      }

      if (left && !prev.left) {
        const row = navCallbacks.playerSetup.playerFocusRow[playerIdx];
        if (row === 7) {
          navCallbacks.playerSetup.screen1ActionCol = 0;
          navCallbacks.playerSetup.updateFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
          triggerMenuHaptics(pad, 30, 0.2, 0.05);
        } else {
          navCallbacks.playerSetup.cycleOption(playerIdx, row, -1);
          soundManager.playTone(660, 0.045, 'sine', 0.18);
          triggerMenuHaptics(pad, 35, 0.25, 0.1);
        }
      }
      if (right && !prev.right) {
        const row = navCallbacks.playerSetup.playerFocusRow[playerIdx];
        if (row === 7) {
          navCallbacks.playerSetup.screen1ActionCol = 1;
          navCallbacks.playerSetup.updateFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
          triggerMenuHaptics(pad, 30, 0.2, 0.05);
        } else {
          navCallbacks.playerSetup.cycleOption(playerIdx, row, 1);
          soundManager.playTone(660, 0.045, 'sine', 0.18);
          triggerMenuHaptics(pad, 35, 0.25, 0.1);
        }
      }

      if (btnA && !prev.a) {
        const row = navCallbacks.playerSetup.playerFocusRow[playerIdx];
        if (row === 7) {
          if (navCallbacks.playerSetup.screen1ActionCol === 0) {
            navCallbacks.playerSetup.btnBack?.click();
          } else {
            navCallbacks.playerSetup.setupPage = 2;
            window._updateSetupPage();
          }
        } else {
          navCallbacks.playerSetup.cycleOption(playerIdx, row, 1);
          soundManager.playTone(660, 0.045, 'sine', 0.18);
          triggerMenuHaptics(pad, 35, 0.25, 0.1);
        }
      }

      if ((btnB && !prev.b) || (btnBack && !prev.back)) {
        if (navCallbacks.playerSetup.btnBack) {
          navCallbacks.playerSetup.btnBack.click();
        } else {
          navCallbacks.showTitleScreen?.();
        }
        soundManager.playTone(330, 0.08, 'sine', 0.15);
        triggerMenuHaptics(pad, 30, 0.2, 0.05);
        return;
      }

      if (btnStart && !prev.start) {
        navCallbacks.playerSetup.setupPage = 2;
        window._updateSetupPage();
        soundManager.playTone(660, 0.05, 'sine', 0.2);
        triggerMenuHaptics(pad, 35, 0.25, 0.1);
      }

      if ((btnB && !prev.b) || (btnBack && !prev.back)) {
        navCallbacks.showTitleScreen?.();
        return;
      }

      if (btnStart && !prev.start) {
        navCallbacks.playerSetup.setupPage = 2;
        window._updateSetupPage();
      }

      prev.up = up; prev.down = down; prev.left = left; prev.right = right;
      prev.a = btnA; prev.b = btnB; prev.lb = btnLB; prev.rb = btnRB;
      prev.back = btnBack; prev.start = btnStart;
    });
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
