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
  buildControllerAssignmentScreen,
  showControllerAssignment,
  hideControllerAssignment,
  getControllerAssignmentMode,
} from './controllerAssignment.js';
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
  getCol3El,
  getCol4El,
  getPlayerReadyButtons,
  getMatchBallHeaderTitleEl,
  getMatchBallHeaderDescEl,
  setCurrentBallOptions,
  setSelectedMatchBall,
  setCurrentSetupMode,
  setMatchFormat,
  setSetupPage,
  setMatchRulesFocusRow,
  setFocusedColumn,
  getPlayerFocusRow,
  applyControllerAssignments,
  updateInputBadgesUI,
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
export * from './controllerAssignment.js';
export {
  getPlayerConfigs,
  getSelectedMatchBall,
  getAggressivenessBadge,
  setPlayerAggressiveness,
  updateAggressivenessUI,
  applyControllerAssignments,
  updateInputBadgesUI,
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

  const openMatchControllerAssignment = (preserveExisting = false, initialMode = null) => {
    const playerSetupEl = getPlayerSetupEl();
    if (playerSetupEl && playerSetupEl.style.display === 'flex') {
      playerSetupEl.style.display = 'none';
      if (callbacks.onExitSetup) callbacks.onExitSetup();
    }
    if (state.titleScreenEl) state.titleScreenEl.style.display = 'none';
    rootEl.style.pointerEvents = 'auto';
    const targetMode = initialMode || (preserveExisting ? getControllerAssignmentMode() : '1v1');
    showControllerAssignment(targetMode, {
      onProceed: (data) => showPlayerSetup('match', data),
      onBack: () => showTitleScreen(),
    }, { preserveExisting });
    startMenuGamepadPolling();
  };

  // Build Screens
  buildControllerAssignmentScreen(rootEl, {
    onProceed: (data) => showPlayerSetup('match', data),
    onBack: () => showTitleScreen(),
  });
  buildPlayerSetupScreen(rootEl, callbacks, {
    showTitleScreen,
    hidePlayerSetup,
    showControllerAssignment: () => openMatchControllerAssignment(true),
  });
  buildTitleScreen(rootEl, {
    onPractice: () => showPlayerSetup('practice'),
    onPlayMatch: () => openMatchControllerAssignment(false, '1v1'),
    onPlayMatch2v2: () => openMatchControllerAssignment(false, '2v2'),
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
  if (typeof window !== 'undefined') window.playerSetup = playerSetup;
  showTitleScreen();
}

export function showTitleScreen() {
  cancelMatchCountdown();
  hideControllerAssignment();
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

export function showPlayerSetup(mode = 'match', options = {}) {
  if (!rootEl) return;
  hideControllerAssignment();
  state.titleBrandBall?.stop();
  const normalizedMode = mode === 'match2v2' ? 'match' : mode;
  setCurrentSetupMode(normalizedMode);
  const fmt = normalizedMode === 'match'
    ? (mode === 'match2v2' ? '2v2' : (options?.mode || getControllerAssignmentMode() || '1v1'))
    : '1v1';
  setMatchFormat(fmt);
  const is2v2 = normalizedMode === 'match' && fmt === '2v2';
  mode = normalizedMode;
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
  const col3El = getCol3El();
  const col4El = getCol4El();
  const playerReadyButtons = getPlayerReadyButtons();
  const matchBallHeaderTitleEl = getMatchBallHeaderTitleEl();
  const matchBallHeaderDescEl = getMatchBallHeaderDescEl();

  let curBallOpts = MATCH_BALL_OPTIONS;
  if (mode === 'practice') {
    if (playerSetupEl) {
      playerSetupEl.style.alignItems = 'center';
      playerSetupEl.style.justifyContent = 'flex-end';
      playerSetupEl.style.paddingLeft = '18px';
      playerSetupEl.style.background = 'linear-gradient(180deg, rgba(4, 7, 12, 0.0) 0%, rgba(4, 7, 12, 0.06) 55%, rgba(4, 7, 12, 0.52) 100%)';
    }
    if (playerSetupContainerEl) {
      playerSetupContainerEl.style.maxWidth = '1860px';
      playerSetupContainerEl.style.width = '100%';
      playerSetupContainerEl.style.margin = '0 auto';
      playerSetupContainerEl.style.boxShadow = 'none';
      playerSetupContainerEl.style.border = 'none';
      playerSetupContainerEl.style.background = 'transparent';
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
    if (col1HeaderLabelEl) col1HeaderLabelEl.textContent = 'SOLO ATHLETE';
    if (col2El) col2El.style.display = 'none';
    if (col3El) col3El.style.display = 'none';
    if (col4El) col4El.style.display = 'none';
    playerReadyButtons.forEach((b) => { if (b) b.style.display = 'none'; });
    if (matchBallHeaderTitleEl) matchBallHeaderTitleEl.textContent = 'PRACTICE BALL';
    if (matchBallHeaderDescEl) matchBallHeaderDescEl.textContent = 'Choose multi-ball sandbox or single ball drill (LB / RB to cycle)';
    curBallOpts = PRACTICE_BALL_OPTIONS;
    setCurrentBallOptions(PRACTICE_BALL_OPTIONS);
    setSelectedMatchBall('all');
  } else {
    if (playerSetupEl) {
      playerSetupEl.style.alignItems = 'center';
      playerSetupEl.style.justifyContent = 'flex-end';
      playerSetupEl.style.paddingLeft = '18px';
      playerSetupEl.style.background = 'linear-gradient(180deg, rgba(4, 7, 12, 0.0) 0%, rgba(4, 7, 12, 0.06) 55%, rgba(4, 7, 12, 0.52) 100%)';
    }
    if (playerSetupContainerEl) {
      playerSetupContainerEl.style.maxWidth = '1860px';
      playerSetupContainerEl.style.width = '100%';
      playerSetupContainerEl.style.margin = '0 auto';
      playerSetupContainerEl.style.boxShadow = 'none';
      playerSetupContainerEl.style.border = 'none';
      playerSetupContainerEl.style.background = 'transparent';
    }
    if (matchBallCardsRowEl) {
      matchBallCardsRowEl.style.gridTemplateColumns = 'repeat(4, 1fr)';
    }
    if (lobbyTitleEl) lobbyTitleEl.textContent = is2v2 ? '2v2 TEAM LOBBY / SETUP' : 'MATCH LOBBY / SETUP';
    if (lobbySubtitleEl) {
      lobbySubtitleEl.textContent = is2v2
        ? 'Team 1 (P1 & P3) vs Team 2 (P2 & P4) — Collective team kits & individual athlete loadouts'
        : 'Team 1 (P1) vs Team 2 (P2) — Collective team kits & individual athlete loadouts';
    }
    if (lobbyBadgeEl) {
      lobbyBadgeEl.textContent = is2v2 ? '2v2 (4 ATHLETES) · 5:00 DURATION' : '1v1 VERSUS · 5:00 DURATION';
      lobbyBadgeEl.style.background = 'rgba(255, 255, 255, 0.08)';
      lobbyBadgeEl.style.borderColor = 'rgba(255, 255, 255, 0.35)';
      lobbyBadgeEl.style.color = '#ffffff';
      lobbyBadgeEl.style.boxShadow = '0 0 12px rgba(255, 255, 255, 0.2), 0 0 20px rgba(0, 229, 255, 0.15)';
    }
    if (col1HeaderLabelEl) col1HeaderLabelEl.textContent = 'PLAYER 1';
    if (col2El) col2El.style.display = 'flex';
    if (col3El) col3El.style.display = is2v2 ? 'flex' : 'none';
    if (col4El) col4El.style.display = is2v2 ? 'flex' : 'none';
    if (playerReadyButtons[0]) playerReadyButtons[0].style.display = 'block';
    if (playerReadyButtons[1]) playerReadyButtons[1].style.display = 'block';
    if (playerReadyButtons[2]) playerReadyButtons[2].style.display = is2v2 ? 'block' : 'none';
    if (playerReadyButtons[3]) playerReadyButtons[3].style.display = is2v2 ? 'block' : 'none';
    if (matchBallHeaderTitleEl) matchBallHeaderTitleEl.textContent = 'MATCH BALL';
    if (matchBallHeaderDescEl) matchBallHeaderDescEl.textContent = 'Select regulation ball or randomize (Gamepad LB / RB to cycle)';
    curBallOpts = MATCH_BALL_OPTIONS;
    setCurrentBallOptions(MATCH_BALL_OPTIONS);
    setSelectedMatchBall('random');
  }

  renderMatchBallCards(curBallOpts);

  if (callbacks.onEnterSetup) {
    callbacks.onEnterSetup(is2v2 ? 'match2v2' : mode);
  }

  cancelMatchCountdown();
  setSetupPage(1);
  setMatchRulesFocusRow(0);
  setFocusedColumn(0);

  // Apply controller assignment configuration to athlete slots
  if (mode === 'match') {
    applyControllerAssignments(options?.assignments || null, 'match');
  } else {
    applyControllerAssignments(null, 'practice');
  }

  // Shared cursor starts on the first human player's column.
  const cfgs = getPlayerConfigs();
  const activeCount = is2v2 ? 4 : 2;
  const firstHuman = cfgs.slice(0, activeCount).findIndex((c) => c.type === 'human');
  setFocusedColumn(mode === 'match' && firstHuman >= 0 ? firstHuman : 0);

  const focusRows = getPlayerFocusRow();
  focusRows[0] = (mode === 'practice') ? 1 : 2;
  focusRows[1] = 2;
  focusRows[2] = 2;
  focusRows[3] = 2;

  if (window._updateSetupPage) window._updateSetupPage();
  updateReadyUI();
  updateTeamButtonsUI();
  enforceColorExclusivity();
  updateMatchBallUI();
  updateInputBadgesUI();
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
  hideControllerAssignment();
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
    state.controllerAssignmentEl?.style.display === 'flex' ||
    playerSetupEl?.style.display === 'flex'
  );
}
