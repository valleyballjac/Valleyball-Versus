import { soundManager } from '../../../audio/soundManager.js';
import { state } from './state.js';
import { getControllerAssignments } from '../../../input/inputRouter.js';
import { hideMainMenuSettingsModal, getMainMenuSettingsModalEl } from './settingsModal.js';
import { hideHowToPlayModal, getControlsModalEl } from './howToPlayModal.js';
import { updateTitleFocusUI } from './titleScreen.js';

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
    if (getMainMenuSettingsModalEl() && getMainMenuSettingsModalEl().style.display === 'flex') {
      if (e.code === 'Escape' || e.code === 'Backspace') {
        e.preventDefault();
        hideMainMenuSettingsModal();
        return;
      }
      return;
    }

    // 1. How To Play Modal Open
    if (getControlsModalEl() && getControlsModalEl().style.display === 'flex') {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        getControlsModalEl()._cycleTab?.(-1);
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        getControlsModalEl()._cycleTab?.(1);
        return;
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        getControlsModalEl()._cycleTab?.(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        hideHowToPlayModal();
        return;
      }
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
        navCallbacks.playerSetup.playerFocusRow[0] = Math.min(6, navCallbacks.playerSetup.playerFocusRow[0] + 1);
        navCallbacks.playerSetup.updateFocusUI();
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        if (navCallbacks.playerSetup.playerFocusRow[0] === 5) {
          navCallbacks.playerSetup.cycleMatchBall(-1);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 4) {
          navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], -1);
        }
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        if (navCallbacks.playerSetup.playerFocusRow[0] === 5) {
          navCallbacks.playerSetup.cycleMatchBall(1);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 4) {
          navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
        }
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (navCallbacks.playerSetup.playerFocusRow[0] === 6) {
          navCallbacks.playerSetup.launchMatchNow();
        } else if (navCallbacks.playerSetup.playerFocusRow[0] === 5) {
          navCallbacks.playerSetup.cycleMatchBall(1);
        } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 4) {
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
        navCallbacks.playerSetup.matchRulesFocusRow = Math.min(4, navCallbacks.playerSetup.matchRulesFocusRow + 1);
        navCallbacks.playerSetup.updateFocusUI();
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'KeyJ') {
        e.preventDefault();
        if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(-1);
        else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(-1);
        else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(-1);
        else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) {
          navCallbacks.playerSetup.focusedColumn = 0;
          navCallbacks.playerSetup.updateFocusUI();
        }
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'KeyL') {
        e.preventDefault();
        if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(1);
        else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(1);
        else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(1);
        else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) {
          navCallbacks.playerSetup.focusedColumn = 1;
          navCallbacks.playerSetup.updateFocusUI();
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
          const targetSlot = (e.code === 'Space') ? 0 : (navCallbacks.playerSetup.focusedColumn || 0);
          navCallbacks.playerSetup.togglePlayerReady(targetSlot);
        } else if (navCallbacks.playerSetup.matchRulesFocusRow === 4) {
          if (!navCallbacks.playerSetup.btnStartMatch?.disabled) {
            navCallbacks.playerSetup.btnStartMatch?.click();
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
      navCallbacks.playerSetup.playerFocusRow[navCallbacks.playerSetup.focusedColumn] = Math.max(0, navCallbacks.playerSetup.playerFocusRow[navCallbacks.playerSetup.focusedColumn] - 1);
      navCallbacks.playerSetup.updateFocusUI();
      return;
    }
    if (e.code === 'ArrowDown') {
      e.preventDefault();
      navCallbacks.playerSetup.playerFocusRow[navCallbacks.playerSetup.focusedColumn] = Math.min(6, navCallbacks.playerSetup.playerFocusRow[navCallbacks.playerSetup.focusedColumn] + 1);
      navCallbacks.playerSetup.updateFocusUI();
      return;
    }
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      navCallbacks.playerSetup.cycleOption(navCallbacks.playerSetup.focusedColumn, navCallbacks.playerSetup.playerFocusRow[navCallbacks.playerSetup.focusedColumn], -1);
      return;
    }
    if (e.code === 'ArrowRight') {
      e.preventDefault();
      navCallbacks.playerSetup.cycleOption(navCallbacks.playerSetup.focusedColumn, navCallbacks.playerSetup.playerFocusRow[navCallbacks.playerSetup.focusedColumn], 1);
      return;
    }

    // Player 1 Keyboard Controls (WASD navigation, Space action)
    if (e.code === 'KeyW') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 0;
      navCallbacks.playerSetup.playerFocusRow[0] = Math.max(0, navCallbacks.playerSetup.playerFocusRow[0] - 1);
      navCallbacks.playerSetup.updateFocusUI();
      return;
    }
    if (e.code === 'KeyS') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 0;
      navCallbacks.playerSetup.playerFocusRow[0] = Math.min(6, navCallbacks.playerSetup.playerFocusRow[0] + 1);
      navCallbacks.playerSetup.updateFocusUI();
      return;
    }
    if (e.code === 'KeyA') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 0;
      navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], -1);
      return;
    }
    if (e.code === 'KeyD') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 0;
      navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (navCallbacks.playerSetup.playerFocusRow[0] === 6) {
        navCallbacks.playerSetup.setupPage = 2;
        window._updateSetupPage();
      } else {
        navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
      }
      return;
    }

    // Player 2 Keyboard Controls (IJKL navigation, Enter action)
    if (e.code === 'KeyI') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 1;
      navCallbacks.playerSetup.playerFocusRow[1] = Math.max(0, navCallbacks.playerSetup.playerFocusRow[1] - 1);
      navCallbacks.playerSetup.updateFocusUI();
      return;
    }
    if (e.code === 'KeyK') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 1;
      navCallbacks.playerSetup.playerFocusRow[1] = Math.min(6, navCallbacks.playerSetup.playerFocusRow[1] + 1);
      navCallbacks.playerSetup.updateFocusUI();
      return;
    }
    if (e.code === 'KeyJ') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 1;
      navCallbacks.playerSetup.cycleOption(1, navCallbacks.playerSetup.playerFocusRow[1], -1);
      return;
    }
    if (e.code === 'KeyL') {
      e.preventDefault();
      navCallbacks.playerSetup.focusedColumn = 1;
      navCallbacks.playerSetup.cycleOption(1, navCallbacks.playerSetup.playerFocusRow[1], 1);
      return;
    }
    if (e.code === 'Enter') {
      e.preventDefault();
      const targetIdx = navCallbacks.playerSetup.focusedColumn;
      if (navCallbacks.playerSetup.playerFocusRow[targetIdx] === 6) {
        navCallbacks.playerSetup.setupPage = 2;
        window._updateSetupPage();
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

    // 0. Settings Modal Active (Main Menu) -> B / Back closes
    if (getMainMenuSettingsModalEl() && getMainMenuSettingsModalEl().style.display === 'flex') {
      for (const pad of pads) {
        if (!pad) continue;
        const btnB = pad.buttons[1]?.pressed || false;
        const btnBack = pad.buttons[8]?.pressed || false;
        const p = state.titlePrevPads[0];
        if ((btnB && !p.b) || (btnBack && !p.back)) {
          hideMainMenuSettingsModal();
          p.b = btnB; p.back = btnBack;
          return;
        }
        p.b = btnB; p.back = btnBack;
      }
      return;
    }

    // 1. How To Play Modal Active -> B / Start / Back closes; LB/RB/Left/Right switches tabs
    if (getControlsModalEl() && getControlsModalEl().style.display === 'flex') {
      for (const pad of pads) {
        if (!pad) continue;
        const btnB = pad.buttons[1]?.pressed || false;
        const btnStart = pad.buttons[9]?.pressed || false;
        const btnBack = pad.buttons[8]?.pressed || false;
        const btnLB = pad.buttons[4]?.pressed || false;
        const btnRB = pad.buttons[5]?.pressed || false;
        const left = (pad.buttons[14]?.pressed || (pad.axes[0] && pad.axes[0] < -0.5)) || false;
        const right = (pad.buttons[15]?.pressed || (pad.axes[0] && pad.axes[0] > 0.5)) || false;
        const p = state.titlePrevPads[0];

        if ((btnLB && !p.lb) || (left && !p.left)) {
          getControlsModalEl()._cycleTab?.(-1);
        } else if ((btnRB && !p.rb) || (right && !p.right)) {
          getControlsModalEl()._cycleTab?.(1);
        }

        p.lb = btnLB; p.rb = btnRB; p.left = left; p.right = right;

        if ((btnB && !p.b) || (btnStart && !p.start) || (btnBack && !p.back)) {
          hideHowToPlayModal();
          p.b = btnB; p.start = btnStart; p.back = btnBack;
          return;
        }
        p.b = btnB; p.start = btnStart; p.back = btnBack;
      }
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
        }
        if (down && !p.down) {
          state.titleFocusIndex = (state.titleFocusIndex + 1) % state.titleButtons.length;
          updateTitleFocusUI();
        }
        if ((btnA && !p.a) || (btnStart && !p.start)) {
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
    const assignments = getControllerAssignments(navCallbacks.playerSetup.currentSetupMode === 'practice' ? 1 : 2, navCallbacks.playerSetup.currentSetupMode);
    if (navCallbacks.playerSetup.playerInputBadges[0]) navCallbacks.playerSetup.playerInputBadges[0].textContent = `INPUT: ${assignments.p1}`;
    if (navCallbacks.playerSetup.playerInputBadges[1] && navCallbacks.playerSetup.currentSetupMode !== 'practice') navCallbacks.playerSetup.playerInputBadges[1].textContent = `INPUT: ${assignments.p2}`;

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
          navCallbacks.playerSetup.playerFocusRow[0] = Math.min(6, navCallbacks.playerSetup.playerFocusRow[0] + 1);
          navCallbacks.playerSetup.updateFocusUI();
        }

        if (left && !prev.left) {
          if (navCallbacks.playerSetup.playerFocusRow[0] === 5) navCallbacks.playerSetup.cycleMatchBall(-1);
          else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 4) navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], -1);
        }
        if (right && !prev.right) {
          if (navCallbacks.playerSetup.playerFocusRow[0] === 5) navCallbacks.playerSetup.cycleMatchBall(1);
          else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 4) navCallbacks.playerSetup.cycleOption(0, navCallbacks.playerSetup.playerFocusRow[0], 1);
        }

        if (btnLB && !prev.lb) navCallbacks.playerSetup.cycleMatchBall(-1);
        if (btnRB && !prev.rb) navCallbacks.playerSetup.cycleMatchBall(1);

        if (btnA && !prev.a) {
          if (navCallbacks.playerSetup.playerFocusRow[0] === 6) {
            navCallbacks.playerSetup.launchMatchNow();
          } else if (navCallbacks.playerSetup.playerFocusRow[0] === 5) {
            navCallbacks.playerSetup.cycleMatchBall(1);
          } else if (navCallbacks.playerSetup.playerFocusRow[0] >= 1 && navCallbacks.playerSetup.playerFocusRow[0] <= 4) {
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
          navCallbacks.playerSetup.matchRulesFocusRow = Math.min(4, navCallbacks.playerSetup.matchRulesFocusRow + 1);
          navCallbacks.playerSetup.updateFocusUI();
        }

        if (left && !prev.left) {
          if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) { navCallbacks.playerSetup.focusedColumn = 0; navCallbacks.playerSetup.updateFocusUI(); }
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 4) { navCallbacks.playerSetup.matchRulesFocusRow = 3; navCallbacks.playerSetup.updateFocusUI(); }
        }
        if (right && !prev.right) {
          if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) { navCallbacks.playerSetup.focusedColumn = 1; navCallbacks.playerSetup.updateFocusUI(); }
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 4) { navCallbacks.playerSetup.matchRulesFocusRow = 4; navCallbacks.playerSetup.updateFocusUI(); }
        }

        if (btnLB && !prev.lb) {
          if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(-1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) { navCallbacks.playerSetup.focusedColumn = 0; navCallbacks.playerSetup.updateFocusUI(); }
        }
        if (btnRB && !prev.rb) {
          if (navCallbacks.playerSetup.matchRulesFocusRow === 0) navCallbacks.playerSetup.cycleMatchBall(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 1) navCallbacks.playerSetup.cycleMatchDuration(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 2) navCallbacks.playerSetup.cycleArena(1);
          else if (navCallbacks.playerSetup.matchRulesFocusRow === 3) { navCallbacks.playerSetup.focusedColumn = 1; navCallbacks.playerSetup.updateFocusUI(); }
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
            navCallbacks.playerSetup.togglePlayerReady(navCallbacks.playerSetup.focusedColumn);
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
        navCallbacks.playerSetup.playerFocusRow[navCallbacks.playerSetup.focusedColumn] = Math.max(0, navCallbacks.playerSetup.playerFocusRow[navCallbacks.playerSetup.focusedColumn] - 1);
        navCallbacks.playerSetup.updateFocusUI();
      }
      if (down && !prev.down) {
        navCallbacks.playerSetup.playerFocusRow[navCallbacks.playerSetup.focusedColumn] = Math.min(6, navCallbacks.playerSetup.playerFocusRow[navCallbacks.playerSetup.focusedColumn] + 1);
        navCallbacks.playerSetup.updateFocusUI();
      }

      if (left && !prev.left) {
        navCallbacks.playerSetup.cycleOption(navCallbacks.playerSetup.focusedColumn, navCallbacks.playerSetup.playerFocusRow[navCallbacks.playerSetup.focusedColumn], -1);
      }
      if (right && !prev.right) {
        navCallbacks.playerSetup.cycleOption(navCallbacks.playerSetup.focusedColumn, navCallbacks.playerSetup.playerFocusRow[navCallbacks.playerSetup.focusedColumn], 1);
      }

      if (btnLB && !prev.lb) {
        navCallbacks.playerSetup.focusedColumn = 1 - navCallbacks.playerSetup.focusedColumn;
        soundManager.playTone(440, 0.06, 'sine', 0.2);
        navCallbacks.playerSetup.updateFocusUI();
      }
      if (btnRB && !prev.rb) {
        navCallbacks.playerSetup.focusedColumn = 1 - navCallbacks.playerSetup.focusedColumn;
        soundManager.playTone(440, 0.06, 'sine', 0.2);
        navCallbacks.playerSetup.updateFocusUI();
      }

      if (btnA && !prev.a) {
        if (navCallbacks.playerSetup.playerFocusRow[navCallbacks.playerSetup.focusedColumn] === 6) {
          navCallbacks.playerSetup.setupPage = 2;
          window._updateSetupPage();
        } else {
          navCallbacks.playerSetup.cycleOption(navCallbacks.playerSetup.focusedColumn, navCallbacks.playerSetup.playerFocusRow[navCallbacks.playerSetup.focusedColumn], 1);
        }
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
        navCallbacks.playerSetup.playerFocusRow[playerIdx] = Math.max(0, navCallbacks.playerSetup.playerFocusRow[playerIdx] - 1);
        navCallbacks.playerSetup.updateFocusUI();
      }
      if (down && !prev.down) {
        navCallbacks.playerSetup.playerFocusRow[playerIdx] = Math.min(6, navCallbacks.playerSetup.playerFocusRow[playerIdx] + 1);
        navCallbacks.playerSetup.updateFocusUI();
      }

      if (left && !prev.left) {
        navCallbacks.playerSetup.cycleOption(playerIdx, navCallbacks.playerSetup.playerFocusRow[playerIdx], -1);
      }
      if (right && !prev.right) {
        navCallbacks.playerSetup.cycleOption(playerIdx, navCallbacks.playerSetup.playerFocusRow[playerIdx], 1);
      }

      if (btnA && !prev.a) {
        if (navCallbacks.playerSetup.playerFocusRow[playerIdx] === 6) {
          navCallbacks.playerSetup.setupPage = 2;
          window._updateSetupPage();
        } else {
          navCallbacks.playerSetup.cycleOption(playerIdx, navCallbacks.playerSetup.playerFocusRow[playerIdx], 1);
        }
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
