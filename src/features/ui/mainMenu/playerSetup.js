import { TUNING } from '../../../config/tuning.js';
import {
  getControllerAssignments,
  getExplicitDeviceMappings,
  assignDefaultDeviceForSlot,
  clearDeviceMappingForSlot,
} from '../../../input/inputRouter.js';
import { soundManager } from '../../../audio/soundManager.js';
import { state } from './state.js';
import {
  PALETTE_SWATCHES,
  getColorName,
  PHYSIQUE_OPTIONS,
  CAMERA_OPTIONS,
  MATCH_BALL_OPTIONS,
  MATCH_DURATION_OPTIONS,
  ARENA_OPTIONS,
  PRACTICE_BALL_OPTIONS,
  ASSIST_OPTIONS,
} from './constants.js';

let rootEl = null;
let playerSetupEl = null;
let playerSetupContainerEl = null;
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
let navActions = {
  showTitleScreen: null,
};

export function setPlayerSetupCallbacks(cbs = {}, navs = {}) {
  Object.assign(callbacks, cbs);
  Object.assign(navActions, navs);
}


let playerConfigs = [
  {
    name: 'Player 1',
    type: 'human',
    difficulty: 'medium',
    aggressiveness: 0.60,
    team: 'home',
    variant: 'classic',
    primaryColor: 0xd90429,
    cameraMode: 'chase',
    assistPreset: 'standard',
  },
  {
    name: 'Player 2',
    type: 'human',
    difficulty: 'medium',
    aggressiveness: 0.60,
    team: 'away',
    variant: 'classic',
    primaryColor: 0x1d4ed8,
    cameraMode: 'chase',
    assistPreset: 'standard',
  },
];

let currentSetupMode = 'match';
let setupPage = 1;
let currentBallOptions = MATCH_BALL_OPTIONS;
let selectedMatchBall = 'random';
let selectedMatchDuration = 300;
let selectedMatchArena = 'court';
let matchBallCards = [];
let matchDurationButtons = [];
let arenaButtons = [];
let matchRulesBoxEl = null;
let matchRulesFocusRow = 0; // 0: ball, 1: duration, 2: arena, 3: action bar (back, ready p1, start, ready p2)
let matchRulesActionCol = 2; // 0: back, 1: ready p1, 2: start match, 3: ready p2
let screen1ActionCol = 1; // 0: back, 1: next
let practiceActionCol = 1; // 0: back, 1: start drill

let lobbyTitleEl = null;
let lobbySubtitleEl = null;
let lobbyBadgeEl = null;
let columnsBoxEl = null;
let col1El = null;
let col2El = null;
let col1HeaderLabelEl = null;
let matchBallCardsRowEl = null;
let matchBallHeaderTitleEl = null;
let matchBallHeaderDescEl = null;

let playerTypeButtons = [[], []];
let playerTeamButtons = [[], []];
let playerSwatchButtons = [[], []];
let playerPhysiqueButtons = [[], []];
let playerCameraSelects = [null, null];
let playerAssistButtons = [[], []];
let playerAssistDescEls = [null, null];
let playerReadyButtons = [null, null];
let playerInputBadges = [null, null];
let playerRowElements = [[], []];
let playerFocusRow = [0, 0];
let focusedColumn = 0; // 0 for Player 1, 1 for Player 2 (used for single-controller lobbies)
let btnStartMatch = null;
let btnNext = null;
let btnBack = null;
let btnReadyP1 = null;
let btnReadyP2 = null;
let playerReadyState = [false, false];
let matchCountdownInterval = null;
let matchCountdownSecs = 0;
let matchCountdownActive = false;
let readyBannerEls = [null, null];
let ctrlTagEls = [null, null];

export function ensureMenuStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('valleyball-menu-rainbow-style')) return;
  const style = document.createElement('style');
  style.id = 'valleyball-menu-rainbow-style';
  style.textContent = `
    @keyframes rainbow-glow {
      0% {
        outline-color: #ff2e55 !important;
        box-shadow: 0 0 18px rgba(255, 46, 85, 0.7), inset 0 0 8px rgba(255, 46, 85, 0.3) !important;
      }
      16% {
        outline-color: #ff6b35 !important;
        box-shadow: 0 0 18px rgba(255, 107, 53, 0.7), inset 0 0 8px rgba(255, 107, 53, 0.3) !important;
      }
      33% {
        outline-color: #fbb417 !important;
        box-shadow: 0 0 18px rgba(251, 180, 23, 0.7), inset 0 0 8px rgba(251, 180, 23, 0.3) !important;
      }
      50% {
        outline-color: #00e5ff !important;
        box-shadow: 0 0 18px rgba(0, 229, 255, 0.7), inset 0 0 8px rgba(0, 229, 255, 0.3) !important;
      }
      66% {
        outline-color: #3b82f6 !important;
        box-shadow: 0 0 18px rgba(59, 130, 246, 0.7), inset 0 0 8px rgba(59, 130, 246, 0.3) !important;
      }
      83% {
        outline-color: #a855f7 !important;
        box-shadow: 0 0 18px rgba(168, 85, 247, 0.7), inset 0 0 8px rgba(168, 85, 247, 0.3) !important;
      }
      100% {
        outline-color: #ff2e55 !important;
        box-shadow: 0 0 18px rgba(255, 46, 85, 0.7), inset 0 0 8px rgba(255, 46, 85, 0.3) !important;
      }
    }

    @keyframes bumper-pulse {
      0%, 100% { transform: scale(1); filter: brightness(1); }
      50% { transform: scale(1.1); filter: brightness(1.35) drop-shadow(0 0 8px rgba(0, 229, 255, 0.8)); }
    }

    .rainbow-focused {
      outline: 3px solid #00e5ff !important;
      outline-offset: 3px !important;
      animation: rainbow-glow 2.5s linear infinite !important;
      transform: scale(1.025) !important;
      background: rgba(255, 255, 255, 0.08) !important;
      transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.15s ease !important;
      z-index: 5 !important;
    }

    .contextual-btn-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.05em;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.3);
      color: #ffffff;
      box-shadow: 0 0 8px rgba(0, 0, 0, 0.4);
      vertical-align: middle;
      user-select: none;
    }
  `;
  document.head.appendChild(style);
}

export function buildPlayerSetupScreen(root, cbs = {}, navs = {}) {
  ensureMenuStyles();
  if (root) rootEl = root;
  setPlayerSetupCallbacks(cbs, navs);
  playerSetupEl = document.createElement('div');
  playerSetupEl.id = 'player-setup-screen';
  playerSetupEl.style.cssText = `
    position: absolute;
    inset: 0;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: radial-gradient(circle at center, rgba(6, 10, 16, 0.1) 0%, rgba(4, 7, 12, 0.45) 100%);
    pointer-events: auto;
  `;

  const container = document.createElement('div');
  container.id = 'player-setup-container';
  playerSetupContainerEl = container;
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    max-width: 860px;
    width: 95%;
    max-height: 98vh;
    overflow-y: auto;
    background: rgba(11, 17, 26, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 14px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.8), 0 0 24px rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    padding: 12px 20px;
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 6px;
  `;

  const title = document.createElement('div');
  lobbyTitleEl = document.createElement('div');
  lobbyTitleEl.style.cssText = 'font-size: 20px; font-weight: 900; letter-spacing: 0.1em; color: #ffffff; text-transform: uppercase;';
  lobbyTitleEl.textContent = 'MATCH LOBBY / SETUP';

  lobbySubtitleEl = document.createElement('div');
  lobbySubtitleEl.style.cssText = 'font-size: 11px; color: #94a3b8; margin-top: 2px;';
  lobbySubtitleEl.textContent = 'Configure Team and Character Options for both athletes';

  title.appendChild(lobbyTitleEl);
  title.appendChild(lobbySubtitleEl);

  lobbyBadgeEl = document.createElement('div');
  lobbyBadgeEl.textContent = '1v1 VERSUS · 5:00 DURATION';
  lobbyBadgeEl.style.cssText = `
    font-size: 12px;
    font-weight: 800;
    padding: 6px 14px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 6px;
    color: #ffffff;
    letter-spacing: 0.1em;
    box-shadow: 0 0 12px rgba(255, 255, 255, 0.2), 0 0 20px rgba(0, 229, 255, 0.15);
  `;

  header.appendChild(title);
  header.appendChild(lobbyBadgeEl);
  container.appendChild(header);

  // Sleek rainbow branding divider rule
  const rainbowDivider = document.createElement('div');
  rainbowDivider.style.cssText = `
    height: 2px;
    width: 100%;
    margin: 6px 0 12px 0;
    background: linear-gradient(90deg, #ff2e55 0%, #ff6b35 15%, #fbb417 30%, #4ade80 46%, #00e5ff 62%, #3b82f6 78%, #a855f7 90%, #ec4899 100%);
    border-radius: 1px;
    opacity: 0.85;
    box-shadow: 0 0 10px rgba(0, 229, 255, 0.4);
  `;
  container.appendChild(rainbowDivider);

  // 2 Columns: Player 1 (Left) & Player 2 (Right)
  columnsBoxEl = document.createElement('div');
  columnsBoxEl.id = 'player-setup-columns-box';
  columnsBoxEl.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 6px;';

  columnsBoxEl.appendChild(buildPlayerColumn(0, 'PLAYER 1', '#ffffff'));
  columnsBoxEl.appendChild(buildPlayerColumn(1, 'PLAYER 2', '#ffffff'));
  container.appendChild(columnsBoxEl);

  // Match Rules Box (Screen 2)
  matchRulesBoxEl = document.createElement('div');
  matchRulesBoxEl.id = 'match-rules-box';
  matchRulesBoxEl.style.cssText = 'display: none; flex-direction: column; gap: 8px; margin-bottom: 6px;';

  const rulesHeader = document.createElement('div');
  rulesHeader.id = 'match-rules-header-title';
  rulesHeader.style.cssText = 'font-size: 13px; font-weight: 800; color: #ffffff; letter-spacing: 0.1em; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.1);';
  rulesHeader.textContent = 'MATCH RULES & CUSTOMIZATION';
  matchRulesBoxEl.appendChild(rulesHeader);

  // 1. Match Ball Selector
  const mbs = buildMatchBallSelector();
  matchRulesBoxEl.appendChild(mbs);

  // 2. Match Duration Selector
  const mds = buildMatchDurationSelector();
  matchRulesBoxEl.appendChild(mds);

  // 3. Arena Selector
  const as = buildArenaSelector();
  matchRulesBoxEl.appendChild(as);

  container.appendChild(matchRulesBoxEl);

  // Function to switch pages
  window._updateSetupPage = function() {
    const p1TypeCard = document.getElementById('type-options-card-p1');
    const p2TypeCard = document.getElementById('type-options-card-p2');

    if (currentSetupMode === 'practice') {
      if (p1TypeCard) p1TypeCard.style.display = 'none';
      if (p2TypeCard) p2TypeCard.style.display = 'none';
      columnsBoxEl.style.display = 'grid';
      matchRulesBoxEl.style.display = 'flex';
      const durationBox = document.getElementById('match-duration-selector-box');
      const arenaBox = document.getElementById('arena-selector-box');
      if (durationBox) durationBox.style.display = 'none';
      if (arenaBox) arenaBox.style.display = 'none';
      if (rulesHeader) rulesHeader.style.display = 'none';
      if (btnNext) btnNext.style.display = 'none';
      if (btnReadyP1) btnReadyP1.style.display = 'none';
      if (btnReadyP2) btnReadyP2.style.display = 'none';
      if (btnStartMatch) {
        btnStartMatch.style.display = 'block';
        btnStartMatch.disabled = false;
        btnStartMatch.textContent = 'START PRACTICE DRILL ➔';
      }
      if (btnBack) btnBack.textContent = '⮌ TITLE';
      updateFocusUI();
      return;
    }

    if (p1TypeCard) p1TypeCard.style.display = 'flex';
    if (p2TypeCard) p2TypeCard.style.display = 'flex';

    const durationBox = document.getElementById('match-duration-selector-box');
    const arenaBox = document.getElementById('arena-selector-box');
    if (durationBox) durationBox.style.display = 'flex';
    if (arenaBox) arenaBox.style.display = 'flex';
    if (rulesHeader) rulesHeader.style.display = 'block';

    if (setupPage === 1) {
      columnsBoxEl.style.display = 'grid';
      matchRulesBoxEl.style.display = 'none';
      if (btnBack) btnBack.textContent = '⮌ TITLE';
      if (btnNext) btnNext.style.display = 'block';
      if (btnReadyP1) btnReadyP1.style.display = 'none';
      if (btnReadyP2) btnReadyP2.style.display = 'none';
      if (btnStartMatch) btnStartMatch.style.display = 'none';
      lobbyTitleEl.textContent = 'MATCH LOBBY / SETUP';
      if (lobbySubtitleEl) lobbySubtitleEl.textContent = 'Configure athletes, teams, and controller types';
    } else {
      columnsBoxEl.style.display = 'none';
      matchRulesBoxEl.style.display = 'flex';
      if (btnBack) btnBack.textContent = '⮌ PLAYERS';
      if (btnNext) btnNext.style.display = 'none';
      if (btnReadyP1) btnReadyP1.style.display = 'block';
      if (btnReadyP2) btnReadyP2.style.display = 'block';
      if (btnStartMatch) btnStartMatch.style.display = 'block';
      lobbyTitleEl.textContent = 'MATCH RULES & CUSTOMIZATION';
      if (lobbySubtitleEl) lobbySubtitleEl.textContent = 'Set regulation ball, match duration, and arena venue';
      updateMatchBallUI();
      updateMatchDurationUI();
      updateArenaUI();
    }
    updateReadyUI();
    updateAggressivenessUI(0);
    updateAggressivenessUI(1);
    updateFocusUI();
  };

  // Action Buttons: Back, Next, Ready Up P1, Start Match / Countdown, Ready Up P2
  const actionRow = document.createElement('div');
  actionRow.id = 'player-setup-action-row';
  actionRow.style.cssText = 'display: flex; gap: 10px; border-top: 1px solid rgba(120, 170, 210, 0.2); padding-top: 8px; align-items: center;';

  btnBack = document.createElement('button');
  btnBack.id = 'btn-setup-back';
  btnBack.textContent = '⮌ TITLE';
  btnBack.style.cssText = `
    padding: 10px 15px;
    font-size: 12px;
    font-weight: 700;
    font-family: inherit;
    letter-spacing: 0.08em;
    color: #cfe3f5;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
  `;
  btnBack.onmouseenter = () => { btnBack.style.background = 'rgba(255, 255, 255, 0.15)'; };
  btnBack.onmouseleave = () => { btnBack.style.background = 'rgba(255, 255, 255, 0.08)'; };
  btnBack.onclick = () => {
    cancelMatchCountdown();
    if (setupPage === 2 && currentSetupMode !== 'practice') {
      setupPage = 1;
      window._updateSetupPage();
    } else {
      if (navActions.showTitleScreen) navActions.showTitleScreen();
    }
  };

  btnNext = document.createElement('button');
  btnNext.id = 'btn-setup-next';
  btnNext.textContent = 'NEXT: MATCH RULES ➔';
  btnNext.style.cssText = `
    flex: 2;
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    color: #ffffff;
    background: #10b981;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 4px 18px rgba(16, 185, 129, 0.5);
    transition: all 0.15s ease;
  `;
  btnNext.onclick = () => {
    setupPage = 2;
    window._updateSetupPage();
  };

  btnReadyP1 = document.createElement('button');
  btnReadyP1.id = 'btn-ready-p1';
  btnReadyP1.textContent = 'READY UP (P1)';
  btnReadyP1.style.cssText = `
    flex: 1;
    padding: 10px 12px;
    font-size: 12px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    color: #cfe3f5;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
  `;
  btnReadyP1.onclick = () => {
    matchRulesFocusRow = 3;
    focusedColumn = 0;
    updateFocusUI();
    togglePlayerReady(0);
  };
  playerReadyButtons[0] = btnReadyP1;

  btnStartMatch = document.createElement('button');
  btnStartMatch.id = 'btn-start-match';
  btnStartMatch.textContent = 'READY UP TO BEGIN MATCH';
  btnStartMatch.disabled = true;
  btnStartMatch.style.cssText = `
    flex: 2;
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    color: #ffffff;
    background: #334155;
    opacity: 0.65;
    border: none;
    border-radius: 8px;
    cursor: not-allowed;
    transition: all 0.15s ease;
  `;
  btnStartMatch.onmouseenter = () => {
    if (!btnStartMatch.disabled || matchCountdownActive) {
      btnStartMatch.style.background = currentSetupMode === 'practice' ? '#34d399' : '#10b981';
    }
  };
  btnStartMatch.onmouseleave = () => {
    if (!btnStartMatch.disabled || matchCountdownActive) {
      btnStartMatch.style.background = currentSetupMode === 'practice' ? '#10b981' : '#10b981';
    }
  };
  btnStartMatch.onclick = () => {
    if (btnStartMatch.disabled && !matchCountdownActive) {
      soundManager.playTone(220, 0.1, 'sawtooth', 0.15);
      return;
    }
    if (currentSetupMode === 'practice') {
      launchMatchNow();
      return;
    }
    if (matchCountdownActive) {
      launchMatchNow();
      return;
    }
    const isBothAI = playerConfigs[0].type === 'ai' && playerConfigs[1].type === 'ai';
    if (isBothAI) {
      launchMatchNow();
      return;
    }
    startMatchCountdown(3);
  };

  btnReadyP2 = document.createElement('button');
  btnReadyP2.id = 'btn-ready-p2';
  btnReadyP2.textContent = 'READY UP (P2)';
  btnReadyP2.style.cssText = `
    flex: 1;
    padding: 10px 12px;
    font-size: 12px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    color: #cfe3f5;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
  `;
  btnReadyP2.onclick = () => {
    matchRulesFocusRow = 3;
    focusedColumn = 1;
    updateFocusUI();
    togglePlayerReady(1);
  };
  playerReadyButtons[1] = btnReadyP2;

  actionRow.appendChild(btnBack);
  actionRow.appendChild(btnNext);
  actionRow.appendChild(btnReadyP1);
  actionRow.appendChild(btnStartMatch);
  actionRow.appendChild(btnReadyP2);
  container.appendChild(actionRow);

  playerSetupEl.appendChild(container);
  rootEl.appendChild(playerSetupEl);
}


export function buildMatchBallSelector() {
  const box = document.createElement('div');
  box.id = 'match-ball-selector-box';
  box.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: rgba(16, 24, 38, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    padding: 6px 12px;
    margin: 0 0 6px 0;
  `;

  const top = document.createElement('div');
  top.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

  const titleWrapper = document.createElement('div');
  matchBallHeaderTitleEl = document.createElement('span');
  matchBallHeaderTitleEl.style.cssText = 'font-size: 11px; font-weight: 900; letter-spacing: 0.1em; color: #ffffff;';
  matchBallHeaderTitleEl.textContent = 'MATCH BALL';

  matchBallHeaderDescEl = document.createElement('span');
  matchBallHeaderDescEl.style.cssText = 'font-size: 10px; color: #94a3b8; margin-left: 8px;';
  matchBallHeaderDescEl.textContent = 'Select regulation ball or randomize (Gamepad LB / RB to cycle)';

  titleWrapper.appendChild(matchBallHeaderTitleEl);
  titleWrapper.appendChild(matchBallHeaderDescEl);
  top.appendChild(titleWrapper);
  box.appendChild(top);

  matchBallCardsRowEl = document.createElement('div');
  matchBallCardsRowEl.id = 'match-ball-cards-row';
  matchBallCardsRowEl.style.cssText = 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;';

  box.appendChild(matchBallCardsRowEl);
  renderMatchBallCards(currentBallOptions);
  return box;
}

export function renderMatchBallCards(options) {
  if (!matchBallCardsRowEl) return;
  matchBallCardsRowEl.innerHTML = '';
  matchBallCards = [];

  options.forEach((opt) => {
    const card = document.createElement('button');
    card.id = `match-ball-card-${opt.id}`;
    const isSelected = selectedMatchBall === opt.id;
    card.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 5px 8px;
      background: ${isSelected ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)'};
      border: 1px solid ${isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.15)'};
      border-radius: 6px;
      cursor: pointer;
      text-align: left;
      font-family: inherit;
      box-shadow: ${isSelected ? '0 0 14px rgba(255, 255, 255, 0.4), 0 0 18px rgba(0, 229, 255, 0.25)' : 'none'};
      transition: all 0.12s ease;
    `;
    card.innerHTML = `
      <span style="font-size: 11px; font-weight: 800; color: ${isSelected ? '#ffffff' : '#94a3b8'}; letter-spacing: 0.04em;">${opt.label}</span>
      <span style="font-size: 9.5px; color: #94a3b8; margin-top: 3px; line-height: 1.3;">${opt.desc}</span>
    `;
    card.onclick = () => {
      selectedMatchBall = opt.id;
      updateMatchBallUI();
    };
    matchBallCards.push({ card, opt });
    matchBallCardsRowEl.appendChild(card);
  });
}

export function updateMatchBallUI() {
  matchBallCards.forEach(({ card, opt }) => {
    const isSelected = selectedMatchBall === opt.id;
    card.style.background = isSelected ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)';
    card.style.borderColor = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.15)';
    card.style.boxShadow = isSelected ? '0 0 14px rgba(255, 255, 255, 0.4), 0 0 18px rgba(0, 229, 255, 0.25)' : 'none';
    const titleSpan = card.firstElementChild;
    if (titleSpan) titleSpan.style.color = isSelected ? '#ffffff' : '#94a3b8';
  });
}

export function cycleMatchBall(direction = 1) {
  const options = currentBallOptions || MATCH_BALL_OPTIONS;
  const curIdx = options.findIndex((b) => b.id === selectedMatchBall);
  const nextIdx = (curIdx + direction + options.length) % options.length;
  selectedMatchBall = options[nextIdx].id;
  updateMatchBallUI();
}

export function buildMatchDurationSelector() {
  const box = document.createElement('div');
  box.id = 'match-duration-selector-box';
  box.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: rgba(16, 24, 38, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    padding: 6px 12px;
    margin: 0 0 6px 0;
    transition: all 0.15s ease;
  `;

  const top = document.createElement('div');
  top.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

  const titleWrapper = document.createElement('div');
  const titleEl = document.createElement('span');
  titleEl.style.cssText = 'font-size: 11px; font-weight: 900; letter-spacing: 0.1em; color: #ffffff;';
  titleEl.textContent = 'MATCH DURATION';

  const descEl = document.createElement('span');
  descEl.style.cssText = 'font-size: 10px; color: #94a3b8; margin-left: 8px;';
  descEl.textContent = 'Regulation match time limit (Arrow keys or LB / RB to cycle)';

  titleWrapper.appendChild(titleEl);
  titleWrapper.appendChild(descEl);
  top.appendChild(titleWrapper);
  box.appendChild(top);

  const durationRowEl = document.createElement('div');
  durationRowEl.id = 'match-duration-row';
  durationRowEl.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;';

  matchDurationButtons = [];
  MATCH_DURATION_OPTIONS.forEach((opt) => {
    const card = document.createElement('button');
    card.id = `duration-card-${opt.id}`;
    const isSelected = selectedMatchDuration === opt.id;
    card.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 5px 8px;
      background: ${isSelected ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)'};
      border: 1px solid ${isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.15)'};
      border-radius: 6px;
      cursor: pointer;
      text-align: left;
      font-family: inherit;
      box-shadow: ${isSelected ? '0 0 14px rgba(255, 255, 255, 0.4), 0 0 18px rgba(0, 229, 255, 0.25)' : 'none'};
      transition: all 0.12s ease;
    `;
    card.innerHTML = `
      <span style="font-size: 11px; font-weight: 800; color: ${isSelected ? '#ffffff' : '#94a3b8'}; letter-spacing: 0.04em;">${opt.label}</span>
      <span style="font-size: 9.5px; color: #94a3b8; margin-top: 3px; line-height: 1.3;">${opt.desc}</span>
    `;
    card.onclick = () => {
      selectedMatchDuration = opt.id;
      matchRulesFocusRow = 1;
      updateMatchDurationUI();
      updateFocusUI();
    };
    matchDurationButtons.push({ card, opt });
    durationRowEl.appendChild(card);
  });

  box.appendChild(durationRowEl);
  return box;
}

export function updateMatchDurationUI() {
  matchDurationButtons.forEach(({ card, opt }) => {
    const isSelected = selectedMatchDuration === opt.id;
    card.style.background = isSelected ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)';
    card.style.borderColor = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.15)';
    card.style.boxShadow = isSelected ? '0 0 14px rgba(255, 255, 255, 0.4), 0 0 18px rgba(0, 229, 255, 0.25)' : 'none';
    const titleSpan = card.firstElementChild;
    if (titleSpan) titleSpan.style.color = isSelected ? '#ffffff' : '#94a3b8';
  });
}

export function cycleMatchDuration(direction = 1) {
  const curIdx = MATCH_DURATION_OPTIONS.findIndex((o) => o.id === selectedMatchDuration);
  const nextIdx = (curIdx + direction + MATCH_DURATION_OPTIONS.length) % MATCH_DURATION_OPTIONS.length;
  selectedMatchDuration = MATCH_DURATION_OPTIONS[nextIdx].id;
  updateMatchDurationUI();
}

export function buildArenaSelector() {
  const box = document.createElement('div');
  box.id = 'arena-selector-box';
  box.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: rgba(16, 24, 38, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    padding: 6px 12px;
    margin: 0 0 6px 0;
    transition: all 0.15s ease;
  `;

  const top = document.createElement('div');
  top.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

  const titleWrapper = document.createElement('div');
  const titleEl = document.createElement('span');
  titleEl.style.cssText = 'font-size: 11px; font-weight: 900; letter-spacing: 0.1em; color: #ffffff;';
  titleEl.textContent = 'ARENA / VENUE';

  const descEl = document.createElement('span');
  descEl.style.cssText = 'font-size: 10px; color: #94a3b8; margin-left: 8px;';
  descEl.textContent = 'Select venue (Changing venue reloads match environment)';

  titleWrapper.appendChild(titleEl);
  titleWrapper.appendChild(descEl);
  top.appendChild(titleWrapper);
  box.appendChild(top);

  const arenaRowEl = document.createElement('div');
  arenaRowEl.id = 'arena-selector-row';
  arenaRowEl.style.cssText = 'display: grid; grid-template-columns: 1fr; gap: 8px;';

  arenaButtons = [];
  ARENA_OPTIONS.forEach((opt) => {
    const card = document.createElement('button');
    card.id = `arena-card-${opt.id}`;
    const isSelected = selectedMatchArena === opt.id;
    card.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 5px 8px;
      background: ${isSelected ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)'};
      border: 1px solid ${isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.15)'};
      border-radius: 6px;
      cursor: pointer;
      text-align: left;
      font-family: inherit;
      box-shadow: ${isSelected ? '0 0 14px rgba(255, 255, 255, 0.4), 0 0 18px rgba(0, 229, 255, 0.25)' : 'none'};
      transition: all 0.12s ease;
    `;
    card.innerHTML = `
      <span style="font-size: 11px; font-weight: 800; color: ${isSelected ? '#ffffff' : '#94a3b8'}; letter-spacing: 0.04em;">${opt.label}</span>
      <span style="font-size: 9.5px; color: #94a3b8; margin-top: 3px; line-height: 1.3;">${opt.desc}</span>
    `;
    card.onclick = () => {
      selectedMatchArena = opt.id;
      matchRulesFocusRow = 2;
      updateArenaUI();
      updateFocusUI();
    };
    arenaButtons.push({ card, opt });
    arenaRowEl.appendChild(card);
  });

  box.appendChild(arenaRowEl);
  return box;
}

export function updateArenaUI() {
  arenaButtons.forEach(({ card, opt }) => {
    const isSelected = selectedMatchArena === opt.id;
    card.style.background = isSelected ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)';
    card.style.borderColor = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.15)';
    card.style.boxShadow = isSelected ? '0 0 14px rgba(255, 255, 255, 0.4), 0 0 18px rgba(0, 229, 255, 0.25)' : 'none';
    const titleSpan = card.firstElementChild;
    if (titleSpan) titleSpan.style.color = isSelected ? '#ffffff' : '#94a3b8';
  });
}

export function cycleArena(direction = 1) {
  const curIdx = ARENA_OPTIONS.findIndex((o) => o.id === selectedMatchArena);
  const nextIdx = (curIdx + direction + ARENA_OPTIONS.length) % ARENA_OPTIONS.length;
  selectedMatchArena = ARENA_OPTIONS[nextIdx].id;
  updateArenaUI();
}

export function getAggressivenessBadge(valPercent) {
  if (valPercent <= 35) {
    return { label: `DEFENSIVE (${valPercent}%)`, color: '#00e5ff', bg: 'rgba(0, 229, 255, 0.15)', border: 'rgba(0, 229, 255, 0.5)' };
  } else if (valPercent <= 65) {
    return { label: `BALANCED (${valPercent}%)`, color: '#f8fafc', bg: 'rgba(255, 255, 255, 0.12)', border: 'rgba(255, 255, 255, 0.35)' };
  } else if (valPercent <= 85) {
    return { label: `AGGRESSIVE (${valPercent}%)`, color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.5)' };
  } else {
    return { label: `ALL-OUT ATTACK (${valPercent}%)`, color: '#ef4444', bg: 'rgba(239, 68, 68, 0.20)', border: 'rgba(239, 68, 68, 0.6)' };
  }
}

export function setPlayerAggressiveness(idx, aggVal) {
  playerConfigs[idx].aggressiveness = Math.max(0, Math.min(1.0, aggVal));
  updateAggressivenessUI(idx);
  notifyPlayerUpdate(idx);
}

export function updateAggressivenessUI(idx) {
  const isAi = playerConfigs[idx].type === 'ai';
  const container = document.getElementById(`agg-container-p${idx + 1}`);
  if (container) {
    container.style.display = isAi ? 'flex' : 'none';
  }
  const slider = document.getElementById(`agg-slider-p${idx + 1}`);
  const curVal = Math.round((playerConfigs[idx].aggressiveness ?? 0.60) * 100);
  if (slider && document.activeElement !== slider) {
    slider.value = String(curVal);
  }
  const badge = document.getElementById(`agg-badge-p${idx + 1}`);
  if (badge) {
    const info = getAggressivenessBadge(curVal);
    badge.textContent = info.label;
    badge.style.color = info.color;
    badge.style.background = info.bg;
    badge.style.borderColor = info.border;
  }
}

export function updateInputBadgesUI() {
  const assignments = getControllerAssignments(currentSetupMode === 'practice' ? 1 : 2, currentSetupMode);

  [0, 1].forEach((idx) => {
    const badge = playerInputBadges[idx];
    if (!badge) return;

    if (currentSetupMode === 'practice') {
      badge.textContent = `INPUT: ${assignments.p1 || 'KEYBOARD WASD'}`;
      badge.style.color = '#ffffff';
      badge.style.borderColor = 'rgba(255, 255, 255, 0.25)';
      return;
    }

    const cfg = playerConfigs[idx];
    if (cfg && cfg.type === 'ai') {
      const diff = (cfg.difficulty || 'medium').toUpperCase();
      badge.textContent = `INPUT: AI BOT (${diff})`;
      badge.style.color = idx === 0 ? '#00e5ff' : '#ff2e55';
      badge.style.borderColor = idx === 0 ? 'rgba(0, 229, 255, 0.4)' : 'rgba(255, 46, 85, 0.4)';
    } else {
      const devName = idx === 0 ? assignments.p1 : assignments.p2;
      badge.textContent = `INPUT: ${(devName || (idx === 0 ? 'KEYBOARD WASD' : 'KEYBOARD IJKL')).toUpperCase()}`;
      badge.style.color = '#ffffff';
      badge.style.borderColor = 'rgba(255, 255, 255, 0.25)';
    }
  });
}

export function setPlayerType(idx, typeId) {
  if (typeId === 'human') {
    playerConfigs[idx].type = 'human';
    playerReadyState[idx] = false;
    assignDefaultDeviceForSlot(idx);
  } else {
    playerConfigs[idx].type = 'ai';
    playerConfigs[idx].difficulty = typeId.replace('ai-', '');
    playerReadyState[idx] = true;
    clearDeviceMappingForSlot(idx);
  }

  if (state.playerConfigs && state.playerConfigs[idx]) {
    state.playerConfigs[idx].type = playerConfigs[idx].type;
    state.playerConfigs[idx].difficulty = playerConfigs[idx].difficulty;
  }

  updateReadyUI();
  updateTypeButtonsUI();
  updateAggressivenessUI(idx);
  updateInputBadgesUI();
  updateFocusUI();
  notifyPlayerUpdate(idx);
}

export function applyControllerAssignments(assignments = null, mode = 'match') {
  if (mode === 'practice') {
    playerConfigs[0].type = 'human';
    playerReadyState[0] = false;
    updateTypeButtonsUI();
    updateReadyUI();
    updateInputBadgesUI();
    return;
  }

  let devP1 = null;
  let devP2 = null;

  if (assignments) {
    devP1 = assignments.team1?.[0] || null;
    devP2 = assignments.team2?.[0] || null;
  } else {
    const explicit = getExplicitDeviceMappings();
    if (explicit) {
      devP1 = explicit[0] || null;
      devP2 = explicit[1] || null;
    }
  }

  // Update Player 1
  if (devP1) {
    playerConfigs[0].type = 'human';
    playerReadyState[0] = false;
  } else {
    playerConfigs[0].type = 'ai';
    if (!playerConfigs[0].difficulty) playerConfigs[0].difficulty = 'medium';
    playerReadyState[0] = true;
  }

  // Update Player 2
  if (devP2) {
    playerConfigs[1].type = 'human';
    playerReadyState[1] = false;
  } else {
    playerConfigs[1].type = 'ai';
    if (!playerConfigs[1].difficulty) playerConfigs[1].difficulty = 'medium';
    playerReadyState[1] = true;
  }

  // Keep state.playerConfigs in sync
  if (state.playerConfigs) {
    state.playerConfigs[0].type = playerConfigs[0].type;
    state.playerConfigs[0].difficulty = playerConfigs[0].difficulty;
    state.playerConfigs[1].type = playerConfigs[1].type;
    state.playerConfigs[1].difficulty = playerConfigs[1].difficulty;
  }

  updateTypeButtonsUI();
  updateReadyUI();
  updateAggressivenessUI(0);
  updateAggressivenessUI(1);
  updateInputBadgesUI();
  updateFocusUI();
  notifyPlayerUpdate(0);
  notifyPlayerUpdate(1);
}

export function updateTypeButtonsUI() {
  [0, 1].forEach((idx) => {
    const curType = playerConfigs[idx].type || 'human';
    const curDiff = playerConfigs[idx].difficulty || 'medium';
    const activeId = curType === 'human' ? 'human' : `ai-${curDiff}`;

    playerTypeButtons[idx]?.forEach(({ btn, typeId }) => {
      const isSelected = activeId === typeId;
      btn.style.background = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.06)';
      btn.style.borderColor = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.15)';
      btn.style.color = isSelected ? '#000000' : '#94a3b8';
      btn.style.boxShadow = isSelected ? '0 0 10px rgba(255, 255, 255, 0.4)' : 'none';
    });
  });
}

export function setPlayerTeam(idx, team) {
  const otherIdx = 1 - idx;
  playerConfigs[idx].team = team;
  playerConfigs[otherIdx].team = team === 'home' ? 'away' : 'home';

  playerReadyState[0] = false;
  playerReadyState[1] = false;
  updateReadyUI();

  updateTeamButtonsUI();
  enforceColorExclusivity();

  notifyPlayerUpdate(0);
  notifyPlayerUpdate(1);
}

export function updateTeamButtonsUI() {
  [0, 1].forEach((idx) => {
    const curTeam = playerConfigs[idx].team;
    playerTeamButtons[idx]?.forEach(({ btn, teamId }) => {
      const isSelected = curTeam === teamId;
      const baseColor = teamId === 'home' ? '#d90429' : '#1d4ed8';
      btn.style.background = isSelected ? baseColor : 'rgba(255, 255, 255, 0.06)';
      btn.style.borderColor = isSelected ? baseColor : 'rgba(255, 255, 255, 0.15)';
      btn.style.color = isSelected ? '#ffffff' : '#94a3b8';
    });
  });
}

export function setPlayerColor(idx, colorHex) {
  if (currentSetupMode !== 'practice') {
    const homeIdx = playerConfigs[0].team === 'home' ? 0 : 1;
    const awayIdx = 1 - homeIdx;

    if (idx === awayIdx && colorHex === playerConfigs[homeIdx].primaryColor) {
      return;
    }
  }

  playerConfigs[idx].primaryColor = colorHex;
  playerReadyState[idx] = false;
  updateReadyUI();

  enforceColorExclusivity();
  notifyPlayerUpdate(idx);
}

export function enforceColorExclusivity() {
  if (currentSetupMode === 'practice') {
    updateSwatchUI();
    return;
  }

  const homeIdx = playerConfigs[0].team === 'home' ? 0 : 1;
  const awayIdx = 1 - homeIdx;
  const homeColor = playerConfigs[homeIdx].primaryColor;

  if (playerConfigs[awayIdx].primaryColor === homeColor) {
    const alt = PALETTE_SWATCHES.find((s) => s.hex !== homeColor);
    if (alt) {
      playerConfigs[awayIdx].primaryColor = alt.hex;
      notifyPlayerUpdate(awayIdx);
    }
  }

  updateSwatchUI();
}

export function updateSwatchUI() {
  const homeIdx = playerConfigs[0].team === 'home' ? 0 : 1;
  const awayIdx = 1 - homeIdx;
  const homeColor = playerConfigs[homeIdx].primaryColor;

  [0, 1].forEach((idx) => {
    const isAway = idx === awayIdx && currentSetupMode !== 'practice';
    const selectedColor = playerConfigs[idx].primaryColor;

    playerSwatchButtons[idx]?.forEach(({ btn, swatch }) => {
      const isHomeColor = swatch.hex === homeColor;
      const isSelected = selectedColor === swatch.hex;

      if (isAway && isHomeColor) {
        btn.style.opacity = '0.22';
        btn.style.cursor = 'not-allowed';
        btn.style.pointerEvents = 'none';
        btn.style.border = '2px solid transparent';
        btn.style.boxShadow = 'none';
        btn.title = `${swatch.name} (Claimed by Home Team)`;
      } else {
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.style.pointerEvents = 'auto';
        btn.style.border = isSelected ? '2px solid #ffffff' : '2px solid transparent';
        btn.style.boxShadow = isSelected ? '0 0 10px rgba(255, 255, 255, 0.8)' : 'none';
        btn.title = swatch.name;
      }
    });
  });
}

export function setPlayerPhysique(idx, variant) {
  playerConfigs[idx].variant = variant;
  playerReadyState[idx] = false;
  updateReadyUI();

  playerPhysiqueButtons[idx]?.forEach(({ btn, variant: v }) => {
    const isSel = v === variant;
    btn.style.background = isSel ? '#ffffff' : 'rgba(255, 255, 255, 0.06)';
    btn.style.borderColor = isSel ? '#ffffff' : 'rgba(255, 255, 255, 0.15)';
    btn.style.color = isSel ? '#000000' : '#94a3b8';
    btn.style.boxShadow = isSel ? '0 0 12px rgba(255, 255, 255, 0.4)' : 'none';
  });

  notifyPlayerUpdate(idx);
}

export function setPlayerCamera(idx, cameraMode) {
  playerConfigs[idx].cameraMode = cameraMode;
  playerReadyState[idx] = false;
  updateReadyUI();

  const sel = playerCameraSelects[idx];
  if (sel) sel.value = cameraMode;

  notifyPlayerUpdate(idx);
}

export function setPlayerAssist(idx, assistId) {
  if (!playerConfigs[idx]) return;
  playerConfigs[idx].assistPreset = assistId;
  playerReadyState[idx] = false;
  updateReadyUI();

  const btns = playerAssistButtons[idx] || [];
  btns.forEach(({ btn, id }) => {
    const isSelected = id === assistId;
    btn.style.color = isSelected ? '#000000' : '#94a3b8';
    btn.style.background = isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.06)';
    btn.style.borderColor = isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.15)';
    btn.style.boxShadow = isSelected ? '0 0 12px rgba(56, 189, 248, 0.5)' : 'none';
  });

  const descEl = playerAssistDescEls[idx];
  const opt = ASSIST_OPTIONS.find((o) => o.id === assistId);
  if (descEl && opt) {
    descEl.textContent = opt.desc;
  }

  notifyPlayerUpdate(idx);
  soundManager.playTone(360, 0.08, 'sine', 0.2);
}

export function updateAssistButtonsUI() {
  [0, 1].forEach((idx) => {
    const curPreset = playerConfigs[idx]?.assistPreset || 'standard';
    const btns = playerAssistButtons[idx] || [];
    btns.forEach(({ btn, id }) => {
      const isSelected = id === curPreset;
      btn.style.color = isSelected ? '#000000' : '#94a3b8';
      btn.style.background = isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.06)';
      btn.style.borderColor = isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.15)';
      btn.style.boxShadow = isSelected ? '0 0 12px rgba(56, 189, 248, 0.5)' : 'none';
    });
    const descEl = playerAssistDescEls[idx];
    const opt = ASSIST_OPTIONS.find((o) => o.id === curPreset);
    if (descEl && opt) {
      descEl.textContent = opt.desc;
    }
  });
}

export function cycleOption(playerIdx, rowIdx, direction = 1) {
  // Practice Mode row mapping
  if (currentSetupMode === 'practice') {
    if (rowIdx === 1) {
      setPlayerTeam(playerIdx, playerConfigs[playerIdx].team === 'home' ? 'away' : 'home');
    } else if (rowIdx === 2) {
      const allowed = PALETTE_SWATCHES;
      const curIdx = allowed.findIndex((s) => s.hex === playerConfigs[playerIdx].primaryColor);
      const nextIdx = (curIdx + direction + allowed.length) % allowed.length;
      setPlayerColor(playerIdx, allowed[nextIdx].hex);
    } else if (rowIdx === 3) {
      const curIdx = PHYSIQUE_OPTIONS.indexOf(playerConfigs[playerIdx].variant);
      const nextIdx = (curIdx + direction + PHYSIQUE_OPTIONS.length) % PHYSIQUE_OPTIONS.length;
      setPlayerPhysique(playerIdx, PHYSIQUE_OPTIONS[nextIdx]);
    } else if (rowIdx === 4) {
      const curIdx = CAMERA_OPTIONS.findIndex((c) => c.id === playerConfigs[playerIdx].cameraMode);
      const nextIdx = (curIdx + direction + CAMERA_OPTIONS.length) % CAMERA_OPTIONS.length;
      setPlayerCamera(playerIdx, CAMERA_OPTIONS[nextIdx].id);
    } else if (rowIdx === 5) {
      const curPreset = playerConfigs[playerIdx].assistPreset || 'standard';
      const curIdx = ASSIST_OPTIONS.findIndex((a) => a.id === curPreset);
      const nextIdx = (curIdx + direction + ASSIST_OPTIONS.length) % ASSIST_OPTIONS.length;
      setPlayerAssist(playerIdx, ASSIST_OPTIONS[nextIdx].id);
    }
    return;
  }

  // Match Mode Screen 1 row mapping
  if (rowIdx === 0) {
    const types = ['human', 'ai-easy', 'ai-medium', 'ai-hard'];
    const curConfig = playerConfigs[playerIdx];
    const curId = curConfig.type === 'human' ? 'human' : `ai-${curConfig.difficulty}`;
    const curIdx = types.indexOf(curId);
    const nextIdx = (curIdx + direction + types.length) % types.length;
    setPlayerType(playerIdx, types[nextIdx]);
  } else if (rowIdx === 1) {
    if (playerConfigs[playerIdx].type === 'ai') {
      const curVal = playerConfigs[playerIdx].aggressiveness ?? 0.60;
      const nextVal = Math.max(0, Math.min(1.0, Math.round((curVal + direction * 0.05) * 100) / 100));
      setPlayerAggressiveness(playerIdx, nextVal);
      soundManager.playTone(direction > 0 ? 520 : 380, 0.04, 'sine', 0.15);
    }
  } else if (rowIdx === 2) {
    setPlayerTeam(playerIdx, playerConfigs[playerIdx].team === 'home' ? 'away' : 'home');
  } else if (rowIdx === 3) {
    const homeIdx = playerConfigs[0].team === 'home' ? 0 : 1;
    const isAway = playerIdx !== homeIdx;
    const homeColor = playerConfigs[homeIdx].primaryColor;
    const allowed = PALETTE_SWATCHES.filter((s) => !isAway || s.hex !== homeColor);
    const curIdx = allowed.findIndex((s) => s.hex === playerConfigs[playerIdx].primaryColor);
    const nextIdx = (curIdx + direction + allowed.length) % allowed.length;
    setPlayerColor(playerIdx, allowed[nextIdx].hex);
  } else if (rowIdx === 4) {
    const curIdx = PHYSIQUE_OPTIONS.indexOf(playerConfigs[playerIdx].variant);
    const nextIdx = (curIdx + direction + PHYSIQUE_OPTIONS.length) % PHYSIQUE_OPTIONS.length;
    setPlayerPhysique(playerIdx, PHYSIQUE_OPTIONS[nextIdx]);
  } else if (rowIdx === 5) {
    const curIdx = CAMERA_OPTIONS.findIndex((c) => c.id === playerConfigs[playerIdx].cameraMode);
    const nextIdx = (curIdx + direction + CAMERA_OPTIONS.length) % CAMERA_OPTIONS.length;
    setPlayerCamera(playerIdx, CAMERA_OPTIONS[nextIdx].id);
  } else if (rowIdx === 6) {
    const curPreset = playerConfigs[playerIdx].assistPreset || 'standard';
    const curIdx = ASSIST_OPTIONS.findIndex((a) => a.id === curPreset);
    const nextIdx = (curIdx + direction + ASSIST_OPTIONS.length) % ASSIST_OPTIONS.length;
    setPlayerAssist(playerIdx, ASSIST_OPTIONS[nextIdx].id);
  } else if (rowIdx === 7) {
    if (screen1ActionCol === 0) {
      if (navActions.showTitleScreen) navActions.showTitleScreen();
    } else {
      setupPage = 2;
      window._updateSetupPage();
    }
  }
}

export function getConnectedPads() {
  if (typeof navigator.getGamepads !== 'function') return [];
  const raw = navigator.getGamepads();
  const pads = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] && raw[i].connected) pads.push(raw[i]);
  }
  return pads;
}


export function hidePlayerSetup() {
  if (navActions.hidePlayerSetup) {
    navActions.hidePlayerSetup();
  } else if (playerSetupEl) {
    playerSetupEl.style.display = 'none';
  }
}

export function launchMatchNow() {
  cancelMatchCountdown();
  hidePlayerSetup();
  const matchRules = {
    ball: selectedMatchBall,
    duration: selectedMatchDuration,
    arena: selectedMatchArena,
  };
  if (currentSetupMode === 'practice') {
    if (callbacks.onStartPractice) callbacks.onStartPractice(playerConfigs[0], selectedMatchBall);
  } else {
    if (callbacks.onStartMatch) callbacks.onStartMatch(playerConfigs, matchRules);
  }
}

export function startMatchCountdown(seconds = 3) {
  cancelMatchCountdown();
  matchCountdownActive = true;
  matchCountdownSecs = seconds;

  if (btnStartMatch) {
    btnStartMatch.disabled = false;
    btnStartMatch.style.background = '#10b981';
    btnStartMatch.style.opacity = '1';
    btnStartMatch.style.cursor = 'pointer';
    btnStartMatch.style.boxShadow = '0 0 25px rgba(16, 185, 129, 0.6)';
    btnStartMatch.textContent = `MATCH STARTING IN ${matchCountdownSecs}...`;
  }

  soundManager.playTone(440, 0.12, 'sine', 0.3);

  matchCountdownInterval = setInterval(() => {
    matchCountdownSecs--;
    if (matchCountdownSecs > 0) {
      const toneFreq = matchCountdownSecs === 2 ? 554.37 : 659.25;
      soundManager.playTone(toneFreq, 0.12, 'sine', 0.3);
      if (btnStartMatch) {
        btnStartMatch.textContent = `MATCH STARTING IN ${matchCountdownSecs}...`;
      }
    } else {
      cancelMatchCountdown();
      soundManager.playTone(880, 0.25, 'sine', 0.35);
      launchMatchNow();
    }
  }, 1000);
}

export function cancelMatchCountdown() {
  if (matchCountdownInterval) {
    clearInterval(matchCountdownInterval);
    matchCountdownInterval = null;
  }
  matchCountdownActive = false;
  matchCountdownSecs = 0;
}

export function togglePlayerReady(idx) {
  if (currentSetupMode === 'practice') {
    launchMatchNow();
    return;
  }
  if (playerConfigs[idx].type === 'ai') {
    return;
  }

  if (matchCountdownActive) {
    cancelMatchCountdown();
    playerReadyState[0] = false;
    playerReadyState[1] = false;
    soundManager.playTone(330, 0.12, 'sine', 0.2);
    updateReadyUI();
    return;
  }

  playerReadyState[idx] = !playerReadyState[idx];

  if (playerReadyState[idx]) {
    soundManager.playTone(587.33, 0.08, 'sine', 0.25);
    setTimeout(() => soundManager.playTone(880, 0.14, 'sine', 0.3), 70);
  } else {
    soundManager.playTone(330, 0.12, 'sine', 0.2);
  }

  updateReadyUI();
}

export function updateReadyUI() {
  if (currentSetupMode === 'practice') {
    if (btnStartMatch) {
      btnStartMatch.disabled = false;
      btnStartMatch.textContent = 'START PRACTICE DRILL ➔';
      btnStartMatch.style.background = '#10b981';
      btnStartMatch.style.opacity = '1';
      btnStartMatch.style.cursor = 'pointer';
      btnStartMatch.style.boxShadow = '0 4px 18px rgba(16, 185, 129, 0.5)';
    }
    if (btnReadyP1) btnReadyP1.style.display = 'none';
    if (btnReadyP2) btnReadyP2.style.display = 'none';
    return;
  }

  const isBothAI = playerConfigs[0].type === 'ai' && playerConfigs[1].type === 'ai';

  [0, 1].forEach((idx) => {
    const isAI = playerConfigs[idx].type === 'ai';
    if (isAI) {
      playerReadyState[idx] = true;
    }
    const btn = playerReadyButtons[idx];
    const isReady = playerReadyState[idx];
    const banner = readyBannerEls[idx];
    const col = idx === 0 ? col1El : col2El;

    if (banner) {
      banner.style.display = isReady ? 'flex' : 'none';
      if (isAI) {
        banner.innerHTML = `<span>✓</span><span>AI BOT (${(playerConfigs[idx].difficulty || 'medium').toUpperCase()}) READY</span>`;
      } else {
        banner.innerHTML = '<span>✓</span><span>READY - LOCKED IN</span>';
      }
    }

    if (col) {
      if (isReady) {
        col.style.borderColor = isAI ? '#00e5ff' : '#10b981';
        col.style.boxShadow = isAI ? '0 0 20px rgba(0, 229, 255, 0.35)' : '0 0 20px rgba(16, 185, 129, 0.35)';
      } else {
        col.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        col.style.boxShadow = 'none';
      }
    }

    if (btn) {
      if (setupPage === 2) {
        btn.style.display = 'block';
      }
      if (isAI) {
        btn.textContent = `✓ AI READY (BOT ${idx + 1})`;
        btn.disabled = true;
        btn.style.background = 'rgba(0, 229, 255, 0.15)';
        btn.style.borderColor = '#00e5ff';
        btn.style.color = '#00e5ff';
        btn.style.cursor = 'default';
        btn.style.boxShadow = 'none';
      } else if (isReady) {
        btn.disabled = false;
        btn.textContent = `✓ P${idx + 1} READY`;
        btn.style.background = '#10b981';
        btn.style.borderColor = '#10b981';
        btn.style.color = '#ffffff';
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = '0 0 14px rgba(16, 185, 129, 0.45)';
      } else {
        btn.disabled = false;
        btn.textContent = `READY UP (P${idx + 1})`;
        btn.style.background = 'rgba(255, 255, 255, 0.08)';
        btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        btn.style.color = '#cfe3f5';
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = 'none';
      }
    }
  });

  if (btnStartMatch && !matchCountdownActive) {
    const isBothAI = playerConfigs[0].type === 'ai' && playerConfigs[1].type === 'ai';
    const bothReady = playerReadyState[0] && playerReadyState[1];
    const countReady = (playerReadyState[0] ? 1 : 0) + (playerReadyState[1] ? 1 : 0);

    if (isBothAI) {
      btnStartMatch.disabled = false;
      btnStartMatch.textContent = 'SPECTATE MATCH ➔';
      btnStartMatch.style.background = '#00e5ff';
      btnStartMatch.style.color = '#000000';
      btnStartMatch.style.fontWeight = '900';
      btnStartMatch.style.border = '2px solid #00e5ff';
      btnStartMatch.style.opacity = '1';
      btnStartMatch.style.cursor = 'pointer';
      btnStartMatch.style.boxShadow = '0 0 25px rgba(0, 229, 255, 0.6), 0 4px 20px rgba(0, 229, 255, 0.4)';
    } else if (bothReady) {
      btnStartMatch.disabled = false;
      btnStartMatch.textContent = 'START MATCH ➔';
      btnStartMatch.style.background = '#10b981';
      btnStartMatch.style.color = '#ffffff';
      btnStartMatch.style.fontWeight = '900';
      btnStartMatch.style.border = '2px solid #34d399';
      btnStartMatch.style.opacity = '1';
      btnStartMatch.style.cursor = 'pointer';
      btnStartMatch.style.boxShadow = '0 4px 20px rgba(16, 185, 129, 0.45), 0 0 25px rgba(16, 185, 129, 0.25)';
    } else if (countReady === 1) {
      btnStartMatch.disabled = true;
      btnStartMatch.textContent = `WAITING FOR ${playerReadyState[0] ? 'P2' : 'P1'} (1/2 READY)`;
      btnStartMatch.style.background = 'rgba(255, 255, 255, 0.08)';
      btnStartMatch.style.color = '#cfe3f5';
      btnStartMatch.style.fontWeight = '800';
      btnStartMatch.style.border = '1px solid rgba(255, 255, 255, 0.2)';
      btnStartMatch.style.opacity = '0.85';
      btnStartMatch.style.cursor = 'not-allowed';
      btnStartMatch.style.boxShadow = 'none';
    } else {
      btnStartMatch.disabled = true;
      btnStartMatch.textContent = 'READY UP TO BEGIN MATCH';
      btnStartMatch.style.background = 'rgba(255, 255, 255, 0.08)';
      btnStartMatch.style.color = 'rgba(255, 255, 255, 0.4)';
      btnStartMatch.style.fontWeight = '800';
      btnStartMatch.style.border = '1px solid rgba(255, 255, 255, 0.15)';
      btnStartMatch.style.opacity = '0.65';
      btnStartMatch.style.cursor = 'not-allowed';
      btnStartMatch.style.boxShadow = 'none';
    }
  }
}

export function buildPlayerColumn(idx, label, themeColor) {
  const col = document.createElement('div');
  col.id = `player-setup-col-${idx + 1}`;
  if (idx === 0) col1El = col;
  else col2El = col;

  col.style.cssText = `
    display: flex;
    flex-direction: column;
    padding: 8px 12px;
    background: rgba(16, 24, 38, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 10px;
    gap: 6px;
  `;

  // Player Header
  const pHeader = document.createElement('div');
  pHeader.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding-bottom: 4px;
  `;

  const labelSpan = document.createElement('span');
  labelSpan.style.cssText = `font-size: 13px; font-weight: 800; letter-spacing: 0.1em; color: #ffffff; display: inline-flex; align-items: center; gap: 6px;`;
  labelSpan.innerHTML = idx === 0
    ? `<span class="contextual-btn-badge" id="badge-p1-lb" style="border-color:#00e5ff;color:#00e5ff;">LB</span><span>${label}</span>`
    : `<span>${label}</span><span class="contextual-btn-badge" id="badge-p2-rb" style="border-color:#ff2e55;color:#ff2e55;">RB</span>`;
  if (idx === 0) col1HeaderLabelEl = labelSpan;

  const subSpan = document.createElement('span');
  subSpan.style.cssText = 'font-size: 10px; color: #94a3b8; font-weight: 700;';
  subSpan.textContent = idx === 0 ? 'SOUTH · WASD' : 'NORTH · IJKL';

  const ctrlTag = document.createElement('span');
  ctrlTag.id = `ctrl-tag-p${idx + 1}`;
  ctrlTag.style.cssText = 'font-size: 10px; font-weight: 800; margin-left: 8px; letter-spacing: 0.05em; color: #ffffff;';
  ctrlTag.innerHTML = idx === 0 ? '<span class="contextual-btn-badge" style="border-color:#10b981;color:#10b981;">ACTIVE FOCUS</span>' : '<span class="contextual-btn-badge">LB/RB SWITCH</span>';
  ctrlTagEls[idx] = ctrlTag;

  pHeader.appendChild(labelSpan);
  pHeader.appendChild(ctrlTag);
  pHeader.appendChild(subSpan);
  col.appendChild(pHeader);

  // Input Assignment Badge
  const inputBadge = document.createElement('div');
  inputBadge.id = `input-badge-p${idx + 1}`;
  inputBadge.style.cssText = 'font-size: 9.5px; font-weight: 700; color: #ffffff; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 4px; padding: 2px 5px; text-align: center;';
  inputBadge.textContent = idx === 0 ? 'INPUT: KEYBOARD WASD' : 'INPUT: KEYBOARD IJKL';
  playerInputBadges[idx] = inputBadge;
  col.appendChild(inputBadge);

  // Ready State Banner
  const readyBanner = document.createElement('div');
  readyBanner.id = `ready-banner-p${idx + 1}`;
  readyBanner.style.cssText = `
    display: none;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 4px 8px;
    background: rgba(16, 185, 129, 0.25);
    border: 1px solid #10b981;
    border-radius: 5px;
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.1em;
    color: #34d399;
    box-shadow: 0 0 12px rgba(16, 185, 129, 0.4);
  `;
  readyBanner.innerHTML = '<span>✓</span><span>READY - LOCKED IN</span>';
  readyBannerEls[idx] = readyBanner;
  col.appendChild(readyBanner);

  playerRowElements[idx] = [];

  // SUB-WINDOW 0: PLAYER TYPE
  const typeCard = document.createElement('div');
  typeCard.id = `type-options-card-p${idx + 1}`;
  typeCard.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: rgba(11, 17, 26, 0.65);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    padding: 6px 10px;
    margin-bottom: 2px;
  `;
  typeCard.innerHTML = `<div style="font-size: 10.5px; font-weight: 800; letter-spacing: 0.1em; color: ${themeColor}; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 2px;">CONTROLLER TYPE</div>`;

  const typeRow = document.createElement('div');
  typeRow.id = `row-type-status-p${idx + 1}`;
  typeRow.style.cssText = 'display: flex; gap: 4px; padding: 4px 0; border-radius: 6px; transition: all 0.15s ease;';

  playerTypeButtons[idx] = [];
  [
    { id: 'human', label: 'HUMAN' },
    { id: 'ai-easy', label: 'EASY AI' },
    { id: 'ai-medium', label: 'MED AI' },
    { id: 'ai-hard', label: 'HARD AI' },
  ].forEach((t) => {
    const btn = document.createElement('button');
    btn.textContent = t.label;
    const curType = playerConfigs[idx].type || 'human';
    const curDiff = playerConfigs[idx].difficulty || 'medium';
    const activeId = curType === 'human' ? 'human' : 'ai-' + curDiff;
    const isSelected = activeId === t.id;

    btn.style.cssText = `
      flex: 1;
      padding: 7px 2px;
      font-size: 9px;
      font-weight: 800;
      font-family: inherit;
      color: ${isSelected ? '#000000' : '#94a3b8'};
      background: ${isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.06)'};
      border: 1px solid ${isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.15)'};
      border-radius: 5px;
      cursor: pointer;
      box-shadow: ${isSelected ? '0 0 10px rgba(255, 255, 255, 0.4)' : 'none'};
      transition: all 0.12s ease;
    `;
    btn.onclick = () => {
      playerFocusRow[idx] = 0;
      focusedColumn = idx;
      updateFocusUI();
      setPlayerType(idx, t.id);
    };
    playerTypeButtons[idx].push({ btn, typeId: t.id });
    typeRow.appendChild(btn);
  });
  typeCard.appendChild(typeRow);

  // AI Aggressiveness Slider (visible when AI is selected)
  const isAi = playerConfigs[idx].type === 'ai';
  const aggContainer = document.createElement('div');
  aggContainer.id = `agg-container-p${idx + 1}`;
  aggContainer.style.cssText = `
    display: ${isAi ? 'flex' : 'none'};
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
    padding-top: 5px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  `;

  const aggHeader = document.createElement('div');
  aggHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

  const aggTitle = document.createElement('span');
  aggTitle.style.cssText = 'font-size: 9.5px; font-weight: 700; color: #94a3b8; letter-spacing: 0.05em;';
  aggTitle.textContent = 'AI AGGRESSIVENESS';

  const aggBadge = document.createElement('span');
  aggBadge.id = `agg-badge-p${idx + 1}`;
  const curAggVal = Math.round((playerConfigs[idx].aggressiveness ?? 0.60) * 100);
  const badgeInfo = getAggressivenessBadge(curAggVal);
  aggBadge.style.cssText = `
    font-size: 9px;
    font-weight: 800;
    padding: 2px 7px;
    border-radius: 4px;
    color: ${badgeInfo.color};
    background: ${badgeInfo.bg};
    border: 1px solid ${badgeInfo.border};
    letter-spacing: 0.05em;
  `;
  aggBadge.textContent = badgeInfo.label;

  aggHeader.appendChild(aggTitle);
  aggHeader.appendChild(aggBadge);
  aggContainer.appendChild(aggHeader);

  // Slider row with [-] input [+] buttons
  const sliderRow = document.createElement('div');
  sliderRow.style.cssText = 'display: flex; align-items: center; gap: 6px;';

  const btnMinus = document.createElement('button');
  btnMinus.textContent = '–';
  btnMinus.style.cssText = 'width: 22px; height: 22px; font-size: 13px; font-weight: 900; line-height: 1; border-radius: 4px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #ffffff; cursor: pointer; display: flex; align-items: center; justify-content: center;';

  const aggSlider = document.createElement('input');
  aggSlider.type = 'range';
  aggSlider.id = `agg-slider-p${idx + 1}`;
  aggSlider.min = '0';
  aggSlider.max = '100';
  aggSlider.step = '5';
  aggSlider.value = String(curAggVal);
  aggSlider.style.cssText = `
    flex: 1;
    accent-color: #00e5ff;
    cursor: pointer;
    height: 5px;
  `;
  aggContainer.onclick = () => {
    playerFocusRow[idx] = 1;
    focusedColumn = idx;
    updateFocusUI();
  };
  aggSlider.onfocus = () => {
    playerFocusRow[idx] = 1;
    focusedColumn = idx;
    updateFocusUI();
  };

  const btnPlus = document.createElement('button');
  btnPlus.textContent = '+';
  btnPlus.style.cssText = 'width: 22px; height: 22px; font-size: 13px; font-weight: 900; line-height: 1; border-radius: 4px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #ffffff; cursor: pointer; display: flex; align-items: center; justify-content: center;';

  btnMinus.onclick = (e) => {
    e.stopPropagation();
    const newVal = Math.max(0, parseInt(aggSlider.value, 10) - 5);
    aggSlider.value = String(newVal);
    setPlayerAggressiveness(idx, newVal / 100);
  };

  btnPlus.onclick = (e) => {
    e.stopPropagation();
    const newVal = Math.min(100, parseInt(aggSlider.value, 10) + 5);
    aggSlider.value = String(newVal);
    setPlayerAggressiveness(idx, newVal / 100);
  };

  aggSlider.oninput = (e) => {
    const val = parseInt(e.target.value, 10);
    setPlayerAggressiveness(idx, val / 100);
  };

  sliderRow.appendChild(btnMinus);
  sliderRow.appendChild(aggSlider);
  sliderRow.appendChild(btnPlus);
  aggContainer.appendChild(sliderRow);

  // Quick preset chips: DEF 25%, BAL 60%, AGG 80%, ALL-OUT 100%
  const chipsRow = document.createElement('div');
  chipsRow.style.cssText = 'display: flex; gap: 4px;';
  [
    { label: 'DEF 25%', val: 0.25 },
    { label: 'BAL 60%', val: 0.60 },
    { label: 'AGG 80%', val: 0.80 },
    { label: 'ALL-OUT', val: 1.00 },
  ].forEach((chip) => {
    const chipBtn = document.createElement('button');
    chipBtn.textContent = chip.label;
    chipBtn.style.cssText = `
      flex: 1;
      font-size: 8px;
      font-weight: 700;
      padding: 3px 0;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #94a3b8;
      cursor: pointer;
      text-align: center;
    `;
    chipBtn.onclick = (e) => {
      e.stopPropagation();
      aggSlider.value = String(Math.round(chip.val * 100));
      setPlayerAggressiveness(idx, chip.val);
    };
    chipsRow.appendChild(chipBtn);
  });
  aggContainer.appendChild(chipsRow);

  typeCard.appendChild(aggContainer);
  playerRowElements[idx][0] = typeRow;
  playerRowElements[idx][1] = aggContainer;
  col.appendChild(typeCard);

  // SUB-WINDOW 1: TEAM OPTIONS
  const teamCard = document.createElement('div');
  teamCard.id = `team-options-card-p${idx + 1}`;
  teamCard.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: rgba(11, 17, 26, 0.65);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    padding: 6px 10px;
  `;
  teamCard.innerHTML = `<div style="font-size: 10.5px; font-weight: 800; letter-spacing: 0.1em; color: ${themeColor}; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 2px;">TEAM OPTIONS</div>`;

  // Row 1: Team Status
  const teamStatusRow = document.createElement('div');
  teamStatusRow.id = `row-team-status-p${idx + 1}`;
  teamStatusRow.style.cssText = 'display: flex; flex-direction: column; gap: 4px; padding: 4px; border-radius: 6px; transition: all 0.15s ease;';
  teamStatusRow.innerHTML = '<div style="font-size: 10px; font-weight: 700; color: #94a3b8;">TEAM STATUS</div>';

  const teamBtnRow = document.createElement('div');
  teamBtnRow.style.cssText = 'display: flex; gap: 6px;';

  playerTeamButtons[idx] = [];
  [
    { id: 'home', label: 'HOME / DARK' },
    { id: 'away', label: 'AWAY / LIGHT' },
  ].forEach((t) => {
    const btn = document.createElement('button');
    btn.textContent = t.label;
    const isSelected = playerConfigs[idx].team === t.id;
    btn.style.cssText = `
      flex: 1;
      padding: 7px 3px;
      font-size: 10px;
      font-weight: 800;
      font-family: inherit;
      color: ${isSelected ? '#ffffff' : '#94a3b8'};
      background: ${isSelected ? (t.id === 'home' ? '#d90429' : '#1d4ed8') : 'rgba(255, 255, 255, 0.06)'};
      border: 1px solid ${isSelected ? (t.id === 'home' ? '#d90429' : '#1d4ed8') : 'rgba(255, 255, 255, 0.15)'};
      border-radius: 5px;
      cursor: pointer;
    `;
    btn.onclick = () => {
      playerFocusRow[idx] = 2;
      focusedColumn = idx;
      updateFocusUI();
      setPlayerTeam(idx, t.id);
    };
    playerTeamButtons[idx].push({ btn, teamId: t.id });
    teamBtnRow.appendChild(btn);
  });
  teamStatusRow.appendChild(teamBtnRow);
  teamCard.appendChild(teamStatusRow);
  playerRowElements[idx][2] = teamStatusRow;

  // Row 2: Team Color Swatches
  const teamColorRow = document.createElement('div');
  teamColorRow.id = `row-team-color-p${idx + 1}`;
  teamColorRow.style.cssText = 'display: flex; flex-direction: column; gap: 4px; padding: 4px; border-radius: 6px; transition: all 0.15s ease;';
  teamColorRow.innerHTML = '<div style="font-size: 10px; font-weight: 700; color: #94a3b8;">TEAM COLOR</div>';

  const swatchGrid = document.createElement('div');
  swatchGrid.style.cssText = 'display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px;';

  playerSwatchButtons[idx] = [];
  PALETTE_SWATCHES.forEach((swatch) => {
    const swBtn = document.createElement('button');
    const isSelected = playerConfigs[idx].primaryColor === swatch.hex;
    swBtn.title = swatch.name;
    swBtn.style.cssText = `
      height: 24px;
      background: ${swatch.color};
      border: 2px solid ${isSelected ? '#ffffff' : 'transparent'};
      border-radius: 4px;
      cursor: pointer;
      box-shadow: ${isSelected ? '0 0 8px rgba(255,255,255,0.8)' : 'none'};
      transition: transform 0.1s ease;
    `;
    swBtn.onclick = () => {
      playerFocusRow[idx] = 3;
      focusedColumn = idx;
      updateFocusUI();
      setPlayerColor(idx, swatch.hex);
    };
    playerSwatchButtons[idx].push({ btn: swBtn, swatch });
    swatchGrid.appendChild(swBtn);
  });
  teamColorRow.appendChild(swatchGrid);
  teamCard.appendChild(teamColorRow);
  playerRowElements[idx][3] = teamColorRow;

  col.appendChild(teamCard);

  // SUB-WINDOW 2: CHARACTER OPTIONS
  const charCard = document.createElement('div');
  charCard.id = `char-options-card-p${idx + 1}`;
  charCard.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: rgba(11, 17, 26, 0.65);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    padding: 6px 10px;
  `;
  charCard.innerHTML = `<div style="font-size: 10.5px; font-weight: 800; letter-spacing: 0.1em; color: ${themeColor}; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 2px;">CHARACTER OPTIONS</div>`;

  // Row 3: Player Physique
  const physiqueRow = document.createElement('div');
  physiqueRow.id = `row-physique-p${idx + 1}`;
  physiqueRow.style.cssText = 'display: flex; flex-direction: column; gap: 4px; padding: 4px; border-radius: 6px; transition: all 0.15s ease;';
  physiqueRow.innerHTML = '<div style="font-size: 10px; font-weight: 700; color: #94a3b8;">PLAYER PHYSIQUE</div>';

  const physiqueBtnRow = document.createElement('div');
  physiqueBtnRow.style.cssText = 'display: flex; gap: 6px;';

  playerPhysiqueButtons[idx] = [];
  PHYSIQUE_OPTIONS.forEach((variant) => {
    const btn = document.createElement('button');
    btn.textContent = variant.toUpperCase();
    const isSelected = playerConfigs[idx].variant === variant;
    btn.style.cssText = `
      flex: 1;
      padding: 6px 3px;
      font-size: 10px;
      font-weight: 800;
      font-family: inherit;
      color: ${isSelected ? '#000000' : '#94a3b8'};
      background: ${isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.06)'};
      border: 1px solid ${isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.15)'};
      border-radius: 5px;
      box-shadow: ${isSelected ? '0 0 12px rgba(255, 255, 255, 0.4)' : 'none'};
      cursor: pointer;
    `;
    btn.onclick = () => {
      playerFocusRow[idx] = 4;
      focusedColumn = idx;
      updateFocusUI();
      setPlayerPhysique(idx, variant);
    };
    playerPhysiqueButtons[idx].push({ btn, variant });
    physiqueBtnRow.appendChild(btn);
  });
  physiqueRow.appendChild(physiqueBtnRow);
  charCard.appendChild(physiqueRow);
  playerRowElements[idx][4] = physiqueRow;

  // Row 4: Preferred Camera
  const cameraRow = document.createElement('div');
  cameraRow.id = `row-camera-p${idx + 1}`;
  cameraRow.style.cssText = 'display: flex; flex-direction: column; gap: 4px; padding: 4px; border-radius: 6px; transition: all 0.15s ease;';
  cameraRow.innerHTML = '<div style="font-size: 10px; font-weight: 700; color: #94a3b8;">PREFERRED CAMERA</div>';

  const camSelect = document.createElement('select');
  camSelect.id = `select-camera-p${idx + 1}`;
  camSelect.style.cssText = `
    width: 100%;
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 700;
    font-family: inherit;
    color: #ffffff;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 5px;
    cursor: pointer;
  `;
  CAMERA_OPTIONS.forEach((opt) => {
    const el = document.createElement('option');
    el.value = opt.id;
    el.textContent = opt.label;
    el.style.background = '#0b111a';
    if (playerConfigs[idx].cameraMode === opt.id) el.selected = true;
    camSelect.appendChild(el);
  });
  camSelect.onchange = (e) => {
    playerFocusRow[idx] = 5;
    focusedColumn = idx;
    updateFocusUI();
    setPlayerCamera(idx, e.target.value);
  };
  camSelect.onfocus = () => {
    playerFocusRow[idx] = 5;
    focusedColumn = idx;
    updateFocusUI();
  };
  playerCameraSelects[idx] = camSelect;
  cameraRow.appendChild(camSelect);
  charCard.appendChild(cameraRow);
  playerRowElements[idx][5] = cameraRow;

  // Row 5: Strike Assist Preset
  const assistRow = document.createElement('div');
  assistRow.id = `row-assist-p${idx + 1}`;
  assistRow.style.cssText = 'display: flex; flex-direction: column; gap: 4px; padding: 4px; border-radius: 6px; transition: all 0.15s ease;';
  assistRow.innerHTML = '<div style="font-size: 10px; font-weight: 700; color: #94a3b8;">STRIKE ASSIST</div>';

  const assistBtnRow = document.createElement('div');
  assistBtnRow.style.cssText = 'display: flex; gap: 6px;';

  playerAssistButtons[idx] = [];
  ASSIST_OPTIONS.forEach((opt) => {
    const btn = document.createElement('button');
    btn.textContent = opt.label.replace(' [DEFAULT]', '');
    const isSelected = (playerConfigs[idx].assistPreset || 'standard') === opt.id;
    btn.style.cssText = `
      flex: 1;
      padding: 6px 2px;
      font-size: 9.5px;
      font-weight: 800;
      font-family: inherit;
      color: ${isSelected ? '#000000' : '#94a3b8'};
      background: ${isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.06)'};
      border: 1px solid ${isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.15)'};
      border-radius: 5px;
      box-shadow: ${isSelected ? '0 0 12px rgba(56, 189, 248, 0.5)' : 'none'};
      cursor: pointer;
      transition: all 0.15s ease;
    `;
    btn.onclick = () => {
      playerFocusRow[idx] = 6;
      focusedColumn = idx;
      updateFocusUI();
      setPlayerAssist(idx, opt.id);
    };
    playerAssistButtons[idx].push({ btn, id: opt.id });
    assistBtnRow.appendChild(btn);
  });
  assistRow.appendChild(assistBtnRow);

  const assistDescEl = document.createElement('div');
  assistDescEl.style.cssText = 'font-size: 9.5px; color: #7dd3fc; margin-top: 2px; font-weight: 600; min-height: 14px;';
  const curOpt = ASSIST_OPTIONS.find((o) => o.id === (playerConfigs[idx].assistPreset || 'standard'));
  assistDescEl.textContent = curOpt?.desc || '';
  playerAssistDescEls[idx] = assistDescEl;
  assistRow.appendChild(assistDescEl);

  charCard.appendChild(assistRow);
  playerRowElements[idx][6] = assistRow;

  // Row 6: Next Button
  playerRowElements[idx][7] = btnNext;

  col.appendChild(charCard);

  return col;
}

export function updateFocusUI() {
  const ballBox = document.getElementById('match-ball-selector-box');
  const durationBox = document.getElementById('match-duration-selector-box');
  const arenaBox = document.getElementById('arena-selector-box');
  const pads = getConnectedPads();
  const isSingleController = pads.length < 2;

  // 1. PRACTICE MODE (Single Page)
  if (currentSetupMode === 'practice') {
    if (ctrlTagEls[0]) {
      ctrlTagEls[0].textContent = '[ACTIVE FOCUS]';
      ctrlTagEls[0].style.color = '#ffffff';
    }

    const activeRow = playerFocusRow[0];

    // Rows 1..5: Team Status, Team Color, Physique, Camera, Strike Assist
    [1, 2, 3, 4, 5].forEach((rIdx) => {
      const el = playerRowElements[0]?.[rIdx];
      if (!el) return;
      if (rIdx === activeRow) {
        el.classList.add('rainbow-focused');
      } else {
        el.classList.remove('rainbow-focused');
        el.style.outline = 'none';
        el.style.boxShadow = 'none';
        el.style.background = 'transparent';
        el.style.transform = 'scale(1)';
      }
    });

    // Row 6: Practice Ball Selector Box
    if (ballBox) {
      if (activeRow === 6) {
        ballBox.classList.add('rainbow-focused');
      } else {
        ballBox.classList.remove('rainbow-focused');
        ballBox.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        ballBox.style.outline = 'none';
        ballBox.style.boxShadow = 'none';
        ballBox.style.transform = 'scale(1)';
      }
    }

    // Row 7: Action Row (Back and Start Drill)
    if (btnBack && btnStartMatch) {
      if (activeRow === 7) {
        if (practiceActionCol === 0) {
          btnBack.classList.add('rainbow-focused');
          btnStartMatch.classList.remove('rainbow-focused');
          btnStartMatch.style.outline = 'none';
          btnStartMatch.style.transform = 'scale(1)';
        } else {
          btnStartMatch.classList.add('rainbow-focused');
          btnBack.classList.remove('rainbow-focused');
          btnBack.style.outline = 'none';
          btnBack.style.transform = 'scale(1)';
        }
      } else {
        btnBack.classList.remove('rainbow-focused');
        btnStartMatch.classList.remove('rainbow-focused');
        btnBack.style.outline = 'none';
        btnStartMatch.style.outline = 'none';
        btnBack.style.transform = 'scale(1)';
        btnStartMatch.style.transform = 'scale(1)';
      }
    }
    return;
  }

  // 2. MATCH MODE SCREEN 2: MATCH RULES & CUSTOMIZATION
  if (setupPage === 2) {
    // Row 0: Match Ball Box
    if (ballBox) {
      if (matchRulesFocusRow === 0) {
        ballBox.classList.add('rainbow-focused');
      } else {
        ballBox.classList.remove('rainbow-focused');
        ballBox.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        ballBox.style.outline = 'none';
        ballBox.style.boxShadow = 'none';
        ballBox.style.transform = 'scale(1)';
      }
    }

    // Row 1: Match Duration Box
    if (durationBox) {
      if (matchRulesFocusRow === 1) {
        durationBox.classList.add('rainbow-focused');
      } else {
        durationBox.classList.remove('rainbow-focused');
        durationBox.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        durationBox.style.outline = 'none';
        durationBox.style.boxShadow = 'none';
        durationBox.style.transform = 'scale(1)';
      }
    }

    // Row 2: Arena Selector Box
    if (arenaBox) {
      if (matchRulesFocusRow === 2) {
        arenaBox.classList.add('rainbow-focused');
      } else {
        arenaBox.classList.remove('rainbow-focused');
        arenaBox.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        arenaBox.style.outline = 'none';
        arenaBox.style.boxShadow = 'none';
        arenaBox.style.transform = 'scale(1)';
      }
    }

    // Row 3: Unified Action Bar (Back, Ready P1, Start Match, Ready P2)
    const actionBtns = [btnBack, btnReadyP1, btnStartMatch, btnReadyP2];
    actionBtns.forEach((btn, colIdx) => {
      if (!btn) return;
      const isFocused = (matchRulesFocusRow === 3) && (matchRulesActionCol === colIdx);
      if (isFocused) {
        btn.classList.add('rainbow-focused');
      } else {
        btn.classList.remove('rainbow-focused');
        btn.style.outline = 'none';
        btn.style.transform = 'scale(1)';
      }
    });
    return;
  }

  // 3. MATCH MODE SCREEN 1: PLAYER & TEAM SETUP
  [0, 1].forEach((idx) => {
    const tag = ctrlTagEls[idx];
    const col = idx === 0 ? col1El : col2El;
    if (tag) {
      if (!isSingleController) {
        tag.innerHTML = `<span class="contextual-btn-badge">[P${idx + 1} / PAD ${idx + 1}]</span>`;
        tag.style.color = '#ffffff';
      } else {
        if (focusedColumn === idx) {
          tag.innerHTML = `<span class="contextual-btn-badge" style="border-color:#10b981;color:#10b981;box-shadow:0 0 10px rgba(16,185,129,0.5);">ACTIVE FOCUS</span>`;
        } else {
          tag.innerHTML = idx === 0
            ? `<span class="contextual-btn-badge" style="animation:bumper-pulse 1.8s infinite;border-color:#00e5ff;color:#00e5ff;">◀ LB SWITCH</span>`
            : `<span class="contextual-btn-badge" style="animation:bumper-pulse 1.8s infinite;border-color:#ff2e55;color:#ff2e55;">RB SWITCH ▶</span>`;
        }
      }
    }
    if (col && !playerReadyState[idx]) {
      if (isSingleController && focusedColumn === idx) {
        col.style.borderColor = 'rgba(255, 255, 255, 0.45)';
      } else {
        col.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      }
    }

    const activeRow = playerFocusRow[idx];
    const isThisColActive = !isSingleController || focusedColumn === idx;

    // Rows 0..6: Type, AI Agg, Team, Color, Physique, Camera, Strike Assist
    [0, 1, 2, 3, 4, 5, 6].forEach((rIdx) => {
      const el = playerRowElements[idx]?.[rIdx];
      if (!el) return;
      const isFocused = (rIdx === activeRow && isThisColActive);
      if (isFocused) {
        el.classList.add('rainbow-focused');
        let hint = el.querySelector('.contextual-row-hint');
        if (!hint) {
          hint = document.createElement('span');
          hint.className = 'contextual-btn-badge contextual-row-hint';
          hint.style.cssText = 'float:right;font-size:9px;color:#00e5ff;border-color:#00e5ff;box-shadow:0 0 8px rgba(0,229,255,0.4);';
          hint.textContent = '◀ D-PAD ▶';
          const header = el.querySelector('div') || el;
          header.appendChild(hint);
        }
        hint.style.display = 'inline-flex';
      } else {
        el.classList.remove('rainbow-focused');
        el.style.outline = 'none';
        el.style.boxShadow = 'none';
        el.style.background = 'transparent';
        el.style.transform = 'scale(1)';
        const hint = el.querySelector('.contextual-row-hint');
        if (hint) hint.style.display = 'none';
      }
    });
  });

  // Row 7: Action Row (Back and Next)
  if (btnBack && btnNext) {
    const isActionFocused = isSingleController
      ? (playerFocusRow[focusedColumn] === 7)
      : (playerFocusRow[0] === 7 || playerFocusRow[1] === 7);
    if (isActionFocused) {
      if (screen1ActionCol === 0) {
        btnBack.classList.add('rainbow-focused');
        btnNext.classList.remove('rainbow-focused');
        btnNext.style.outline = 'none';
        btnNext.style.transform = 'scale(1)';
      } else {
        btnNext.classList.add('rainbow-focused');
        btnBack.classList.remove('rainbow-focused');
        btnBack.style.outline = 'none';
        btnBack.style.transform = 'scale(1)';
      }
    } else {
      btnNext.classList.remove('rainbow-focused');
      btnBack.classList.remove('rainbow-focused');
      btnNext.style.outline = 'none';
      btnBack.style.outline = 'none';
      btnNext.style.transform = 'scale(1)';
      btnBack.style.transform = 'scale(1)';
    }
  }
}

export function notifyPlayerUpdate(idx) {
  if (callbacks.onPlayerConfigChange) {
    callbacks.onPlayerConfigChange(idx, playerConfigs[idx]);
  }
}



export function getScreen1ActionCol() { return screen1ActionCol; }
export function setScreen1ActionCol(v) { screen1ActionCol = v; }
export function getMatchRulesActionCol() { return matchRulesActionCol; }
export function setMatchRulesActionCol(v) { matchRulesActionCol = v; }
export function getPracticeActionCol() { return practiceActionCol; }
export function setPracticeActionCol(v) { practiceActionCol = v; }
export function getPlayerConfigs() { return playerConfigs; }
export function getSelectedMatchBall() { return selectedMatchBall; }
export function setSelectedMatchBall(val) { selectedMatchBall = val; }
export function getSelectedMatchDuration() { return selectedMatchDuration; }
export function setSelectedMatchDuration(val) { selectedMatchDuration = val; }
export function getSelectedMatchArena() { return selectedMatchArena; }
export function setSelectedMatchArena(val) { selectedMatchArena = val; }
export function getCurrentSetupMode() { return currentSetupMode; }
export function setCurrentSetupMode(val) { currentSetupMode = val; }
export function getSetupPage() { return setupPage; }
export function setSetupPage(val) { setupPage = val; }
export function getCurrentBallOptions() { return currentBallOptions; }
export function setCurrentBallOptions(val) { currentBallOptions = val; }
export function getMatchRulesFocusRow() { return matchRulesFocusRow; }
export function setMatchRulesFocusRow(val) { matchRulesFocusRow = val; }
export function getFocusedColumn() { return focusedColumn; }
export function setFocusedColumn(val) { focusedColumn = val; }
export function getPlayerFocusRow() { return playerFocusRow; }
export function getPlayerReadyState() { return playerReadyState; }
export function isMatchCountdownActive() { return matchCountdownActive; }
export function getPlayerSetupEl() { return playerSetupEl; }
export function getPlayerSetupContainerEl() { return playerSetupContainerEl; }
export function getBtnStartMatch() { return btnStartMatch; }
export function getBtnBack() { return btnBack; }
export function getBtnNext() { return btnNext; }
export function getLobbyTitleEl() { return lobbyTitleEl; }
export function getLobbySubtitleEl() { return lobbySubtitleEl; }
export function getLobbyBadgeEl() { return lobbyBadgeEl; }
export function getColumnsBoxEl() { return columnsBoxEl; }
export function getCol1El() { return col1El; }
export function getCol2El() { return col2El; }
export function getCol1HeaderLabelEl() { return col1HeaderLabelEl; }
export function getMatchBallCardsRowEl() { return matchBallCardsRowEl; }
export function getMatchBallHeaderTitleEl() { return matchBallHeaderTitleEl; }
export function getMatchBallHeaderDescEl() { return matchBallHeaderDescEl; }
export function getPlayerReadyButtons() { return playerReadyButtons; }
export function getPlayerInputBadges() { return playerInputBadges; }
export function getCallbacks() { return callbacks; }

export const playerSetup = {
  get currentSetupMode() { return currentSetupMode; },
  set currentSetupMode(v) { currentSetupMode = v; },
  get setupPage() { return setupPage; },
  set setupPage(v) { setupPage = v; },
  get matchRulesFocusRow() { return matchRulesFocusRow; },
  set matchRulesFocusRow(v) { matchRulesFocusRow = v; },
  get matchRulesActionCol() { return matchRulesActionCol; },
  set matchRulesActionCol(v) { matchRulesActionCol = v; },
  get screen1ActionCol() { return screen1ActionCol; },
  set screen1ActionCol(v) { screen1ActionCol = v; },
  get practiceActionCol() { return practiceActionCol; },
  set practiceActionCol(v) { practiceActionCol = v; },
  get playerConfigs() { return playerConfigs; },
  get playerInputBadges() { return playerInputBadges; },
  get playerFocusRow() { return playerFocusRow; },
  get focusedColumn() { return focusedColumn; },
  set focusedColumn(v) { focusedColumn = v; },
  get btnStartMatch() { return btnStartMatch; },
  get btnBack() { return btnBack; },
  get btnNext() { return btnNext; },
  get playerReadyState() { return playerReadyState; },
  get matchCountdownActive() { return matchCountdownActive; },
  get playerSetupEl() { return playerSetupEl; },
  cycleMatchBall,
  cycleMatchDuration,
  cycleArena,
  cycleOption,
  launchMatchNow,
  cancelMatchCountdown,
  togglePlayerReady,
  updateReadyUI,
  updateFocusUI,
  updateInputBadgesUI,
  applyControllerAssignments,
  setPlayerType,
};
