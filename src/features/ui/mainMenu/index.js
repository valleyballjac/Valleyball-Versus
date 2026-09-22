import {
  PALETTE_SWATCHES,
  getColorName,
  PHYSIQUE_OPTIONS,
  CAMERA_OPTIONS,
  MATCH_BALL_OPTIONS,
  MATCH_DURATION_OPTIONS,
  ARENA_OPTIONS,
  PRACTICE_BALL_OPTIONS,
  BALL_OPTIONS,
} from './constants.js';

import { showToast } from './toast.js';
import { initMobileNotice } from './mobileNotice.js';
import {
  buildFlyoverOverlay,
  showFlyoverOverlay,
  hideFlyoverOverlay,
  getFlyoverOverlayEl,
} from './flyoverOverlay.js';
import {
  buildMainMenuSettingsModal,
  showMainMenuSettingsModal,
  hideMainMenuSettingsModal,
  getMainMenuSettingsModalEl,
} from './settingsModal.js';
import {
  buildHowToPlayModal,
  showHowToPlayModal,
  hideHowToPlayModal,
  showControlsModal,
  hideControlsModal,
  buildControlsModal,
  getControlsModalEl,
} from './howToPlayModal.js';
import {
  buildTitleScreen,
  updateTitleFocusUI,
  createMenuButton,
} from './titleScreen.js';
import { state } from './state.js';
import {
  buildPlayerSetupScreen,
  playerSetup,
  getPlayerConfigs,
  getSelectedMatchBall,
  getSelectedMatchDuration,
  getSelectedMatchArena,
  getAggressivenessBadge,
  setPlayerAggressiveness,
  updateAggressivenessUI,
  renderMatchBallCards,
  updateMatchBallUI,
  updateTeamButtonsUI,
  enforceColorExclusivity,
  updateReadyUI,
  updateFocusUI,
  cancelMatchCountdown,
  getPlayerSetupEl,
  getPlayerSetupContainerEl,
  getMatchBallCardsRowEl,
  getLobbyTitleEl,
  getLobbySubtitleEl,
  getLobbyBadgeEl,
  getColumnsBoxEl,
  getCol1HeaderLabelEl,
  getCol2El,
  getPlayerReadyButtons,
  getMatchBallHeaderTitleEl,
  getMatchBallHeaderDescEl,
  setCurrentBallOptions,
  setSelectedMatchBall,
  setCurrentSetupMode,
  setSetupPage,
  setMatchRulesFocusRow,
  setFocusedColumn,
  getPlayerReadyState,
  getPlayerFocusRow,
} from './playerSetup.js';
import {
  startMenuGamepadPolling,
  stopSetupGamepadPolling,
  setMenuNavigationContext,
} from './menuNavigation.js';

export * from './constants.js';
export * from './toast.js';
export * from './mobileNotice.js';
export * from './flyoverOverlay.js';
export * from './settingsModal.js';
export * from './howToPlayModal.js';
export {
  getPlayerConfigs,
  getSelectedMatchBall,
  getAggressivenessBadge,
  setPlayerAggressiveness,
  updateAggressivenessUI,
} from './playerSetup.js';

let rootEl = null;
let callbacks = {
  onStartMatch: null,
  onStartPractice: null,
  onPlayerConfigChange: null,
  onOpenSettings: null,
  onSkipFlyover: null,
  onEnterSetup: null,
  onExitSetup: null,
  onRenderSettingsChange: null,
};

export function initMainMenu(cbs = {}) {
  Object.assign(callbacks, cbs);

  rootEl = document.getElementById('main-menu-root');
  if (!rootEl) {
    rootEl = document.createElement('div');
    rootEl.id = 'main-menu-root';
    rootEl.style.cssText = `
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 500;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
      overflow: hidden;
      user-select: none;
    `;
    document.body.appendChild(rootEl);
  }
  state.rootEl = rootEl;

  // Build Modals and Overlays
  buildHowToPlayModal(rootEl);
  buildMainMenuSettingsModal(rootEl, getPlayerConfigs(), callbacks);
  buildFlyoverOverlay(rootEl, callbacks.onSkipFlyover);

  // Build Screens
  buildPlayerSetupScreen(rootEl, callbacks, { showTitleScreen, hidePlayerSetup });
  buildTitleScreen(rootEl, {
    onPractice: () => showPlayerSetup('practice'),
    onPlayMatch: () => showPlayerSetup('match'),
    onSettings: () => showMainMenuSettingsModal(),
    onHowToPlay: () => showHowToPlayModal(),
  });

  // Connect Navigation Context
  setMenuNavigationContext({
    showTitleScreen,
    showPlayerSetup,
    getTitleScreenEl: () => state.titleScreenEl,
    getTitleButtons: () => state.titleButtons,
    getTitleFocusIndex: () => state.titleFocusIndex,
    setTitleFocusIndex: (idx) => { state.titleFocusIndex = idx; },
    playerSetup,
  });

  initMobileNotice();
  showTitleScreen();
}

export function showTitleScreen() {
  cancelMatchCountdown();
  if (!rootEl) return;
  const playerSetupEl = getPlayerSetupEl();
  if (playerSetupEl && playerSetupEl.style.display === 'flex' && callbacks.onExitSetup) {
    callbacks.onExitSetup();
  }
  rootEl.style.pointerEvents = 'auto';
  if (state.titleScreenEl) state.titleScreenEl.style.display = 'flex';
  if (playerSetupEl) playerSetupEl.style.display = 'none';
  const flyoverOverlayEl = getFlyoverOverlayEl();
  if (flyoverOverlayEl) flyoverOverlayEl.style.display = 'none';
  hideControlsModal();
  hideMainMenuSettingsModal();
  updateTitleFocusUI();
  startMenuGamepadPolling();
  state.titleBrandBall?.start();
}

export function showPlayerSetup(mode = 'match') {
  if (!rootEl) return;
  state.titleBrandBall?.stop();
  setCurrentSetupMode(mode);
  rootEl.style.pointerEvents = 'auto';
  if (state.titleScreenEl) state.titleScreenEl.style.display = 'none';
  const playerSetupEl = getPlayerSetupEl();
  if (playerSetupEl) playerSetupEl.style.display = 'flex';
  const flyoverOverlayEl = getFlyoverOverlayEl();
  if (flyoverOverlayEl) flyoverOverlayEl.style.display = 'none';

  const playerSetupContainerEl = getPlayerSetupContainerEl();
  const matchBallCardsRowEl = getMatchBallCardsRowEl();
  const lobbyTitleEl = getLobbyTitleEl();
  const lobbySubtitleEl = getLobbySubtitleEl();
  const lobbyBadgeEl = getLobbyBadgeEl();
  const columnsBoxEl = getColumnsBoxEl();
  const col1HeaderLabelEl = getCol1HeaderLabelEl();
  const col2El = getCol2El();
  const playerReadyButtons = getPlayerReadyButtons();
  const matchBallHeaderTitleEl = getMatchBallHeaderTitleEl();
  const matchBallHeaderDescEl = getMatchBallHeaderDescEl();

  let curBallOpts = MATCH_BALL_OPTIONS;
  if (mode === 'practice') {
    if (playerSetupEl) {
      playerSetupEl.style.alignItems = 'flex-start';
      playerSetupEl.style.justifyContent = 'center';
      playerSetupEl.style.paddingLeft = '50px';
      playerSetupEl.style.background = 'radial-gradient(circle at 25% 50%, rgba(6, 10, 16, 0.25) 0%, rgba(4, 7, 12, 0.5) 100%)';
    }
    if (playerSetupContainerEl) {
      playerSetupContainerEl.style.maxWidth = '520px';
      playerSetupContainerEl.style.width = '100%';
      playerSetupContainerEl.style.margin = '0';
      playerSetupContainerEl.style.boxShadow = '0 16px 48px rgba(0, 0, 0, 0.9), 0 0 30px rgba(16, 185, 129, 0.18)';
      playerSetupContainerEl.style.border = '1px solid rgba(16, 185, 129, 0.35)';
    }
    if (matchBallCardsRowEl) {
      matchBallCardsRowEl.style.gridTemplateColumns = 'repeat(2, 1fr)';
    }
    if (lobbyTitleEl) lobbyTitleEl.textContent = 'PRACTICE SETUP / LOBBY';
    if (lobbySubtitleEl) lobbySubtitleEl.textContent = 'Solo athlete drill configuration and practice ball';
    if (lobbyBadgeEl) {
      lobbyBadgeEl.textContent = 'SOLO PRACTICE · SANDBOX';
      lobbyBadgeEl.style.background = 'rgba(16, 185, 129, 0.2)';
      lobbyBadgeEl.style.borderColor = 'rgba(16, 185, 129, 0.5)';
      lobbyBadgeEl.style.color = '#34d399';
    }
    if (columnsBoxEl) columnsBoxEl.style.gridTemplateColumns = '1fr';
    if (col1HeaderLabelEl) col1HeaderLabelEl.textContent = 'SOLO ATHLETE';
    if (col2El) col2El.style.display = 'none';
    if (playerReadyButtons[0]) playerReadyButtons[0].style.display = 'none';
    if (matchBallHeaderTitleEl) matchBallHeaderTitleEl.textContent = 'PRACTICE BALL';
    if (matchBallHeaderDescEl) matchBallHeaderDescEl.textContent = 'Choose multi-ball sandbox or single ball drill (LB / RB to cycle)';
    curBallOpts = PRACTICE_BALL_OPTIONS;
    setCurrentBallOptions(PRACTICE_BALL_OPTIONS);
    setSelectedMatchBall('all');
  } else {
    if (playerSetupEl) {
      playerSetupEl.style.alignItems = 'center';
      playerSetupEl.style.justifyContent = 'center';
      playerSetupEl.style.paddingLeft = '16px';
      playerSetupEl.style.background = 'radial-gradient(circle at center, rgba(6, 10, 16, 0.1) 0%, rgba(4, 7, 12, 0.45) 100%)';
    }
    if (playerSetupContainerEl) {
      playerSetupContainerEl.style.maxWidth = '860px';
      playerSetupContainerEl.style.width = '95%';
      playerSetupContainerEl.style.margin = '0 auto';
      playerSetupContainerEl.style.boxShadow = '0 16px 48px rgba(0, 0, 0, 0.8), 0 0 24px rgba(255, 255, 255, 0.1)';
      playerSetupContainerEl.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    }
    if (matchBallCardsRowEl) {
      matchBallCardsRowEl.style.gridTemplateColumns = 'repeat(4, 1fr)';
    }
    if (lobbyTitleEl) lobbyTitleEl.textContent = 'MATCH LOBBY / SETUP';
    if (lobbySubtitleEl) lobbySubtitleEl.textContent = 'Configure Team and Character Options for both athletes';
    if (lobbyBadgeEl) {
      lobbyBadgeEl.textContent = '1v1 VERSUS · 5:00 DURATION';
      lobbyBadgeEl.style.background = 'rgba(255, 255, 255, 0.08)';
      lobbyBadgeEl.style.borderColor = 'rgba(255, 255, 255, 0.35)';
      lobbyBadgeEl.style.color = '#ffffff';
      lobbyBadgeEl.style.boxShadow = '0 0 12px rgba(255, 255, 255, 0.2), 0 0 20px rgba(0, 229, 255, 0.15)';
    }
    if (columnsBoxEl) columnsBoxEl.style.gridTemplateColumns = '1fr 1fr';
    if (col1HeaderLabelEl) col1HeaderLabelEl.textContent = 'PLAYER 1';
    if (col2El) col2El.style.display = 'flex';
    if (playerReadyButtons[0]) playerReadyButtons[0].style.display = 'block';
    if (playerReadyButtons[1]) playerReadyButtons[1].style.display = 'block';
    if (matchBallHeaderTitleEl) matchBallHeaderTitleEl.textContent = 'MATCH BALL';
    if (matchBallHeaderDescEl) matchBallHeaderDescEl.textContent = 'Select regulation ball or randomize (Gamepad LB / RB to cycle)';
    curBallOpts = MATCH_BALL_OPTIONS;
    setCurrentBallOptions(MATCH_BALL_OPTIONS);
    setSelectedMatchBall('random');
  }

  renderMatchBallCards(curBallOpts);

  if (callbacks.onEnterSetup) {
    callbacks.onEnterSetup(mode);
  }

  cancelMatchCountdown();
  setSetupPage(1);
  setMatchRulesFocusRow(0);
  setFocusedColumn(0);
  const readyStates = getPlayerReadyState();
  readyStates[0] = false;
  readyStates[1] = false;
  const focusRows = getPlayerFocusRow();
  focusRows[0] = (mode === 'practice') ? 1 : 0;
  focusRows[1] = 0;

  if (window._updateSetupPage) window._updateSetupPage();
  updateReadyUI();
  updateTeamButtonsUI();
  enforceColorExclusivity();
  updateMatchBallUI();
  updateFocusUI();
  startMenuGamepadPolling();
}

export function hidePlayerSetup() {
  stopSetupGamepadPolling();
  const playerSetupEl = getPlayerSetupEl();
  if (playerSetupEl) playerSetupEl.style.display = 'none';
}

export function hideMainMenu() {
  stopSetupGamepadPolling();
  state.titleBrandBall?.stop();
  hideHowToPlayModal();
  hideMainMenuSettingsModal();
  if (rootEl) rootEl.style.pointerEvents = 'none';
  if (state.titleScreenEl) state.titleScreenEl.style.display = 'none';
  const playerSetupEl = getPlayerSetupEl();
  if (playerSetupEl) playerSetupEl.style.display = 'none';
  const flyoverOverlayEl = getFlyoverOverlayEl();
  if (flyoverOverlayEl) flyoverOverlayEl.style.display = 'none';
}

export function isMainMenuActive() {
  if (!rootEl) return false;
  const playerSetupEl = getPlayerSetupEl();
  return (
    state.titleScreenEl?.style.display === 'flex' ||
    playerSetupEl?.style.display === 'flex'
  );
}
