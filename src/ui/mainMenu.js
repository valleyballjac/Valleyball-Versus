import { getControllerAssignments } from '../input/inputRouter.js';
import { soundManager } from '../audio/soundManager.js';
import { createBrandBall } from '../visuals/brandBall.js';

/**
 * Main Menu & Player Setup UI for Valleyball Versus.
 *
 * Includes:
 * 1. Title Screen: Play Match, Practice Sandbox, Settings, Controls.
 * 2. Player Setup Screen: 2-column configuration for P1 & P2 with live 3D character updates.
 * 3. Pre-Match Cutscene Overlay: Matchup presentation banner with skippable prompt.
 */

export const PALETTE_SWATCHES = [
  { name: 'Red', color: '#d90429', hex: 0xd90429 },
  { name: 'Blue', color: '#1d4ed8', hex: 0x1d4ed8 },
  { name: 'Yellow', color: '#ffd60a', hex: 0xffd60a },
  { name: 'Green', color: '#15803d', hex: 0x15803d },
  { name: 'Purple', color: '#8b5cf6', hex: 0x8b5cf6 },
  { name: 'Orange', color: '#ea580c', hex: 0xea580c },
  { name: 'Teal', color: '#06b6d4', hex: 0x06b6d4 },
  { name: 'Pink', color: '#ec4899', hex: 0xec4899 },
  { name: 'White', color: '#f8fafc', hex: 0xf8fafc },
  { name: 'Black', color: '#0f172a', hex: 0x0f172a },
];

export function getColorName(color) {
  if (color === null || color === undefined) return 'Custom';
  let hexNum = color;
  if (typeof color === 'string') {
    hexNum = parseInt(color.replace('#', ''), 16);
  }
  const match = PALETTE_SWATCHES.find((s) => s.hex === hexNum);
  if (match) return match.name;
  return 'Custom';
}

const PHYSIQUE_OPTIONS = ['classic', 'masculine', 'feminine'];

const CAMERA_OPTIONS = [
  { id: 'chase', label: '3RD PERSON CHASE (DEFAULT)' },
  { id: 'ball', label: 'BALL TRACKING CAM' },
  { id: 'sports', label: 'SPORTS CAM (SPECTATOR)' },
  { id: 'broadcast', label: 'SIDELINE BROADCAST' },
  { id: 'tactical', label: 'TACTICAL OVERHEAD' },
];

export const MATCH_BALL_OPTIONS = [
  { id: 'random', label: 'RANDOM', desc: 'Random each match [Default]' },
  { id: 'small', label: 'FOOTBALL (SMALL)', desc: '0.4m · Hard Difficulty' },
  { id: 'medium', label: 'MEDIUM BALL', desc: '1.0m · Average Difficulty' },
  { id: 'large', label: 'BIG BALL', desc: '1.5m · Easiest Difficulty' },
];

export const PRACTICE_BALL_OPTIONS = [
  { id: 'all', label: 'ALL 3 BALLS [SANDBOX]', desc: 'Small, Medium & Big active simultaneously' },
  { id: 'medium', label: 'REGULATION (MEDIUM)', desc: '1.0m · Standard match ball drills' },
  { id: 'small', label: 'FOOTBALL (SMALL)', desc: '0.4m · Precision strike training' },
  { id: 'large', label: 'BIG BALL (TRAINING)', desc: '1.5m · Rebound & volley practice' },
];

export const BALL_OPTIONS = MATCH_BALL_OPTIONS;

let rootEl = null;
let titleScreenEl = null;
let playerSetupEl = null;
let playerSetupContainerEl = null;
let flyoverOverlayEl = null;
let controlsModalEl = null;
let titleBrandBall = null;

let callbacks = {
  onStartMatch: null,
  onStartPractice: null,
  onPlayerConfigChange: null,
  onOpenSettings: null,
  onSkipFlyover: null,
  onEnterSetup: null,
  onExitSetup: null,
};


let playerConfigs = [
  {
    name: 'Player 1',
    team: 'home',
    variant: 'classic',
    primaryColor: 0xd90429,
    cameraMode: 'chase',
  },
  {
    name: 'Player 2',
    team: 'away',
    variant: 'classic',
    primaryColor: 0x1d4ed8,
    cameraMode: 'chase',
  },
];

let currentSetupMode = 'match';
let currentBallOptions = MATCH_BALL_OPTIONS;
let selectedMatchBall = 'random';
let matchBallCards = [];

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

let playerTeamButtons = [[], []];
let playerSwatchButtons = [[], []];
let playerPhysiqueButtons = [[], []];
let playerCameraSelects = [null, null];
let playerReadyButtons = [null, null];
let playerInputBadges = [null, null];
let playerRowElements = [[], []];
let playerFocusRow = [0, 0];
let focusedColumn = 0; // 0 for Player 1, 1 for Player 2 (used for single-controller lobbies)
let btnStartMatch = null;
let btnReadyP1 = null;
let btnReadyP2 = null;
let playerReadyState = [false, false];
let matchCountdownInterval = null;
let matchCountdownSecs = 0;
let matchCountdownActive = false;
let readyBannerEls = [null, null];
let ctrlTagEls = [null, null];
let titleButtons = [];
let titleFocusIndex = 0;
let gamepadPollHandle = null;

export function initMainMenu(cbs = {}) {
  if (rootEl) return;
  callbacks = { ...callbacks, ...cbs };

  rootEl = document.createElement('div');
  rootEl.id = 'main-menu-root';
  rootEl.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 800;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    user-select: none;
  `;

  // 1. Title Screen
  buildTitleScreen();

  // 2. Player Setup Subview
  buildPlayerSetupScreen();

  // 3. Pre-Match Flyover Cutscene Overlay
  buildFlyoverOverlay();

  // 4. Controls Modal
  buildControlsModal();

  document.body.appendChild(rootEl);
  startMenuGamepadPolling();
}

// ---------------------------------------------------------------------------
// 1. Title Screen
// ---------------------------------------------------------------------------
function buildTitleScreen() {
  titleScreenEl = document.createElement('div');
  titleScreenEl.id = 'title-screen';
  titleScreenEl.style.cssText = `
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 48px 64px;
    background: radial-gradient(circle at 35% 45%, rgba(6, 10, 16, 0.2) 0%, rgba(4, 7, 12, 0.85) 100%);
    pointer-events: auto;
    transition: opacity 0.3s ease;
  `;

  // Top Header (Brand Lockup: 3D Globe Ball + Rainbow VALLEYBALL + Outlined VERSUS)
  const header = document.createElement('div');
  header.style.cssText = `
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: fit-content;
    user-select: none;
  `;

  // 3D Spinning Globe Ball
  const ballContainer = document.createElement('div');
  ballContainer.id = 'title-brand-ball-container';
  ballContainer.style.cssText = `
    width: 140px;
    height: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 2px;
    position: relative;
  `;
  titleBrandBall = createBrandBall(ballContainer, { size: 140, speed: 0.35, tilt: 0.25 });

  const title = document.createElement('h1');
  title.textContent = 'VALLEYBALL';
  title.style.cssText = `
    font-size: 52px;
    font-weight: 900;
    letter-spacing: 0.14em;
    margin: 0;
    text-transform: uppercase;
    background: linear-gradient(90deg, #ff2e55 0%, #ff6b35 15%, #fbb417 30%, #4ade80 46%, #00e5ff 62%, #3b82f6 78%, #a855f7 90%, #ec4899 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    filter: drop-shadow(0 4px 18px rgba(0, 0, 0, 0.75)) drop-shadow(0 0 24px rgba(0, 229, 255, 0.25));
    line-height: 1.05;
  `;

  const tag = document.createElement('div');
  tag.textContent = 'VERSUS';
  tag.style.cssText = `
    font-size: 16px;
    font-weight: 900;
    letter-spacing: 0.45em;
    text-indent: 0.45em;
    color: #000000;
    -webkit-text-stroke: 1.5px #ffffff;
    text-stroke: 1.5px #ffffff;
    margin-top: 6px;
    filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.85));
    line-height: 1.2;
  `;

  header.appendChild(ballContainer);
  header.appendChild(title);
  header.appendChild(tag);

  // Menu Options (Bottom Left)
  const menuList = document.createElement('div');
  menuList.style.cssText = 'display: flex; flex-direction: column; gap: 14px; width: 360px; margin-bottom: 24px;';

  const btnPractice = createMenuButton('PRACTICE SANDBOX', 'rgba(255, 255, 255, 0.12)', () => {
    showPlayerSetup('practice');
  });
  btnPractice.id = 'btn-practice-sandbox';

  const btnPlayMatch = createMenuButton('PLAY MATCH (1v1 VERSUS)', '#ffffff', () => {
    showPlayerSetup('match');
  });
  btnPlayMatch.id = 'btn-play-match';
  btnPlayMatch.style.color = '#000000';
  btnPlayMatch.style.fontWeight = '900';
  btnPlayMatch.style.border = '2px solid #ffffff';
  btnPlayMatch.style.boxShadow = '0 4px 20px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25)';
  btnPlayMatch.onmouseleave = () => {
    if (titleFocusIndex !== 1) {
      btnPlayMatch.style.transform = 'translateX(0)';
      btnPlayMatch.style.borderColor = '#ffffff';
      btnPlayMatch.style.boxShadow = '0 4px 20px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25)';
    }
  };

  // Unselectable 2v2 Versus Item
  const btnMatch2v2 = document.createElement('div');
  btnMatch2v2.id = 'btn-play-match-2v2-soon';
  btnMatch2v2.style.cssText = `
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.35);
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    cursor: not-allowed;
    user-select: none;
    pointer-events: none;
  `;
  btnMatch2v2.innerHTML = `
    <span>PLAY MATCH (2v2 VERSUS)</span>
    <span style="font-size: 10px; font-weight: 800; letter-spacing: 0.14em; padding: 3px 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.08); color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.25);">COMING SOON</span>
  `;

  const btnSettings = createMenuButton('SETTINGS', 'rgba(255, 255, 255, 0.08)', () => {
    if (callbacks.onOpenSettings) callbacks.onOpenSettings();
  });
  btnSettings.id = 'btn-title-settings';

  const btnControls = createMenuButton('CONTROLS', 'rgba(255, 255, 255, 0.08)', () => {
    showControlsModal();
  });
  btnControls.id = 'btn-title-controls';

  menuList.appendChild(btnPractice);
  menuList.appendChild(btnPlayMatch);
  menuList.appendChild(btnMatch2v2);
  menuList.appendChild(btnSettings);
  menuList.appendChild(btnControls);

  titleButtons = [btnPractice, btnPlayMatch, btnSettings, btnControls];
  titleFocusIndex = 0;
  titleButtons.forEach((btn, idx) => {
    btn.onmouseenter = () => {
      titleFocusIndex = idx;
      updateTitleFocusUI();
    };
  });
  updateTitleFocusUI();

  titleScreenEl.appendChild(header);
  titleScreenEl.appendChild(menuList);
  rootEl.appendChild(titleScreenEl);
}

function updateTitleFocusUI() {
  titleButtons.forEach((btn, idx) => {
    if (!btn) return;
    const isPlayMatch = btn.id === 'btn-play-match';
    if (idx === titleFocusIndex) {
      btn.style.transform = 'translateX(12px)';
      btn.style.borderColor = '#ffffff';
      btn.style.boxShadow = '0 0 22px rgba(255, 255, 255, 0.6), 0 0 25px rgba(0, 229, 255, 0.3), 0 0 35px rgba(255, 46, 85, 0.25)';
      btn.style.outline = '2px solid #ffffff';
      btn.style.outlineOffset = '2px';
      try { btn.focus(); } catch (_) {}
    } else {
      btn.style.transform = 'translateX(0)';
      btn.style.borderColor = isPlayMatch ? '#ffffff' : 'rgba(255, 255, 255, 0.2)';
      btn.style.boxShadow = isPlayMatch ? '0 4px 20px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25)' : '0 4px 16px rgba(0, 0, 0, 0.4)';
      btn.style.outline = 'none';
    }
  });
}

function createMenuButton(text, bg, onClick) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = `
    padding: 16px 24px;
    font-size: 15px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.1em;
    color: #ffffff;
    background: ${bg};
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    transition: all 0.15s ease;
  `;
  btn.onmouseenter = () => {
    btn.style.transform = 'translateX(8px)';
    btn.style.borderColor = '#ffffff';
    btn.style.boxShadow = '0 6px 20px rgba(255, 255, 255, 0.2)';
  };
  btn.onmouseleave = () => {
    btn.style.transform = 'translateX(0)';
    btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    btn.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.4)';
  };
  btn.onclick = onClick;
  return btn;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 2. Player Setup Screen
// ---------------------------------------------------------------------------
function buildPlayerSetupScreen() {
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

  // Match Ball Selector (Positioned directly below the columns!)
  container.appendChild(buildMatchBallSelector());

  // Action Buttons: Back, Ready Up P1, Start Match / Countdown, Ready Up P2
  const actionRow = document.createElement('div');
  actionRow.id = 'player-setup-action-row';
  actionRow.style.cssText = 'display: flex; gap: 10px; border-top: 1px solid rgba(120, 170, 210, 0.2); padding-top: 8px; align-items: center;';

  const btnBack = document.createElement('button');
  btnBack.id = 'btn-setup-back';
  btnBack.textContent = '⮌ BACK';
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
    showTitleScreen();
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
    playerFocusRow[0] = 5;
    focusedColumn = 0;
    updateFocusUI();
    togglePlayerReady(0);
  };
  playerReadyButtons[0] = btnReadyP1;
  playerRowElements[0][5] = btnReadyP1;
  playerRowElements[0][6] = btnStartMatch;

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
    playerFocusRow[1] = 5;
    focusedColumn = 1;
    updateFocusUI();
    togglePlayerReady(1);
  };
  playerReadyButtons[1] = btnReadyP2;
  playerRowElements[1][5] = btnReadyP2;
  playerRowElements[1][6] = btnStartMatch;

  actionRow.appendChild(btnBack);
  actionRow.appendChild(btnReadyP1);
  actionRow.appendChild(btnStartMatch);
  actionRow.appendChild(btnReadyP2);
  container.appendChild(actionRow);

  playerSetupEl.appendChild(container);
  rootEl.appendChild(playerSetupEl);
}


function buildMatchBallSelector() {
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

function renderMatchBallCards(options) {
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

function updateMatchBallUI() {
  matchBallCards.forEach(({ card, opt }) => {
    const isSelected = selectedMatchBall === opt.id;
    card.style.background = isSelected ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)';
    card.style.borderColor = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.15)';
    card.style.boxShadow = isSelected ? '0 0 14px rgba(255, 255, 255, 0.4), 0 0 18px rgba(0, 229, 255, 0.25)' : 'none';
    const titleSpan = card.firstElementChild;
    if (titleSpan) titleSpan.style.color = isSelected ? '#ffffff' : '#94a3b8';
  });
}

function cycleMatchBall(direction = 1) {
  const options = currentBallOptions || MATCH_BALL_OPTIONS;
  const curIdx = options.findIndex((b) => b.id === selectedMatchBall);
  const nextIdx = (curIdx + direction + options.length) % options.length;
  selectedMatchBall = options[nextIdx].id;
  updateMatchBallUI();
}

function setPlayerTeam(idx, team) {
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

function updateTeamButtonsUI() {
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

function setPlayerColor(idx, colorHex) {
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

function enforceColorExclusivity() {
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

function updateSwatchUI() {
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

function setPlayerPhysique(idx, variant) {
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

function setPlayerCamera(idx, cameraMode) {
  playerConfigs[idx].cameraMode = cameraMode;
  playerReadyState[idx] = false;
  updateReadyUI();

  const sel = playerCameraSelects[idx];
  if (sel) sel.value = cameraMode;

  notifyPlayerUpdate(idx);
}

function cycleOption(playerIdx, rowIdx, direction = 1) {
  if (rowIdx === 0) {
    setPlayerTeam(playerIdx, playerConfigs[playerIdx].team === 'home' ? 'away' : 'home');
  } else if (rowIdx === 1) {
    const homeIdx = playerConfigs[0].team === 'home' ? 0 : 1;
    const isAway = playerIdx !== homeIdx;
    const homeColor = playerConfigs[homeIdx].primaryColor;
    const allowed = PALETTE_SWATCHES.filter((s) => !isAway || s.hex !== homeColor);
    const curIdx = allowed.findIndex((s) => s.hex === playerConfigs[playerIdx].primaryColor);
    const nextIdx = (curIdx + direction + allowed.length) % allowed.length;
    setPlayerColor(playerIdx, allowed[nextIdx].hex);
  } else if (rowIdx === 2) {
    const curIdx = PHYSIQUE_OPTIONS.indexOf(playerConfigs[playerIdx].variant);
    const nextIdx = (curIdx + direction + PHYSIQUE_OPTIONS.length) % PHYSIQUE_OPTIONS.length;
    setPlayerPhysique(playerIdx, PHYSIQUE_OPTIONS[nextIdx]);
  } else if (rowIdx === 3) {
    const curIdx = CAMERA_OPTIONS.findIndex((c) => c.id === playerConfigs[playerIdx].cameraMode);
    const nextIdx = (curIdx + direction + CAMERA_OPTIONS.length) % CAMERA_OPTIONS.length;
    setPlayerCamera(playerIdx, CAMERA_OPTIONS[nextIdx].id);
  } else if (rowIdx === 4) {
    cycleMatchBall(direction);
  } else if (rowIdx === 5) {
    togglePlayerReady(playerIdx);
  }
}

function getConnectedPads() {
  if (typeof navigator.getGamepads !== 'function') return [];
  const raw = navigator.getGamepads();
  const pads = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] && raw[i].connected) pads.push(raw[i]);
  }
  return pads;
}

function launchMatchNow() {
  cancelMatchCountdown();
  hidePlayerSetup();
  if (currentSetupMode === 'practice') {
    if (callbacks.onStartPractice) callbacks.onStartPractice(playerConfigs[0], selectedMatchBall);
  } else {
    if (callbacks.onStartMatch) callbacks.onStartMatch(playerConfigs, selectedMatchBall);
  }
}

function startMatchCountdown(seconds = 3) {
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

function cancelMatchCountdown() {
  if (matchCountdownInterval) {
    clearInterval(matchCountdownInterval);
    matchCountdownInterval = null;
  }
  matchCountdownActive = false;
  matchCountdownSecs = 0;
}

function togglePlayerReady(idx) {
  if (currentSetupMode === 'practice') {
    launchMatchNow();
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

function updateReadyUI() {
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

  [0, 1].forEach((idx) => {
    const btn = playerReadyButtons[idx];
    const isReady = playerReadyState[idx];
    const banner = readyBannerEls[idx];
    const col = idx === 0 ? col1El : col2El;

    if (banner) {
      banner.style.display = isReady ? 'flex' : 'none';
    }

    if (col) {
      if (isReady) {
        col.style.borderColor = '#10b981';
        col.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.35)';
      } else {
        col.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        col.style.boxShadow = 'none';
      }
    }

    if (btn) {
      btn.style.display = 'block';
      if (isReady) {
        btn.textContent = `✓ P${idx + 1} READY`;
        btn.style.background = '#10b981';
        btn.style.borderColor = '#10b981';
        btn.style.color = '#ffffff';
        btn.style.boxShadow = '0 0 14px rgba(16, 185, 129, 0.45)';
      } else {
        btn.textContent = `READY UP (P${idx + 1})`;
        btn.style.background = 'rgba(255, 255, 255, 0.08)';
        btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        btn.style.color = '#cfe3f5';
        btn.style.boxShadow = 'none';
      }
    }
  });

  if (btnStartMatch && !matchCountdownActive) {
    const isAnyReady = playerReadyState[0] || playerReadyState[1];
    btnStartMatch.disabled = !isAnyReady;
    if (isAnyReady) {
      btnStartMatch.textContent = 'START MATCH ➔';
      btnStartMatch.style.background = '#ffffff';
      btnStartMatch.style.color = '#000000';
      btnStartMatch.style.fontWeight = '900';
      btnStartMatch.style.border = '2px solid #ffffff';
      btnStartMatch.style.opacity = '1';
      btnStartMatch.style.cursor = 'pointer';
      btnStartMatch.style.boxShadow = '0 4px 20px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25)';
    } else {
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

function buildPlayerColumn(idx, label, themeColor) {
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
  labelSpan.style.cssText = `font-size: 13px; font-weight: 800; letter-spacing: 0.1em; color: #ffffff;`;
  labelSpan.textContent = label;
  if (idx === 0) col1HeaderLabelEl = labelSpan;

  const subSpan = document.createElement('span');
  subSpan.style.cssText = 'font-size: 10px; color: #94a3b8; font-weight: 700;';
  subSpan.textContent = idx === 0 ? 'SOUTH · WASD' : 'NORTH · IJKL';

  const ctrlTag = document.createElement('span');
  ctrlTag.id = `ctrl-tag-p${idx + 1}`;
  ctrlTag.style.cssText = 'font-size: 10px; font-weight: 800; margin-left: 8px; letter-spacing: 0.05em; color: #ffffff;';
  ctrlTag.textContent = idx === 0 ? '[ACTIVE FOCUS]' : '[LB/RB SWITCH]';
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

  // Row 0: Team Status
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
      playerFocusRow[idx] = 0;
      updateFocusUI();
      setPlayerTeam(idx, t.id);
    };
    playerTeamButtons[idx].push({ btn, teamId: t.id });
    teamBtnRow.appendChild(btn);
  });
  teamStatusRow.appendChild(teamBtnRow);
  teamCard.appendChild(teamStatusRow);
  playerRowElements[idx][0] = teamStatusRow;

  // Row 1: Team Color Swatches
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
      playerFocusRow[idx] = 1;
      updateFocusUI();
      setPlayerColor(idx, swatch.hex);
    };
    playerSwatchButtons[idx].push({ btn: swBtn, swatch });
    swatchGrid.appendChild(swBtn);
  });
  teamColorRow.appendChild(swatchGrid);
  teamCard.appendChild(teamColorRow);
  playerRowElements[idx][1] = teamColorRow;

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
  charCard.innerHTML = `<div style="font-size: 10.5px; font-weight: 800; letter-spacing: 0.1em; color: #ffffff; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 2px;">CHARACTER OPTIONS</div>`;

  // Row 2: Player Physique
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
      playerFocusRow[idx] = 2;
      updateFocusUI();
      setPlayerPhysique(idx, variant);
    };
    playerPhysiqueButtons[idx].push({ btn, variant });
    physiqueBtnRow.appendChild(btn);
  });
  physiqueRow.appendChild(physiqueBtnRow);
  charCard.appendChild(physiqueRow);
  playerRowElements[idx][2] = physiqueRow;

  // Row 3: Preferred Camera
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
    playerFocusRow[idx] = 3;
    updateFocusUI();
    setPlayerCamera(idx, e.target.value);
  };
  camSelect.onfocus = () => {
    playerFocusRow[idx] = 3;
    updateFocusUI();
  };
  playerCameraSelects[idx] = camSelect;
  cameraRow.appendChild(camSelect);
  charCard.appendChild(cameraRow);
  playerRowElements[idx][3] = cameraRow;

  col.appendChild(charCard);

  return col;
}

function updateFocusUI() {
  const ballBox = document.getElementById('match-ball-selector-box');
  const pads = getConnectedPads();
  const isSingleController = pads.length < 2;

  // In match mode, update column focus tags and subtle column borders
  if (currentSetupMode !== 'practice') {
    [0, 1].forEach((idx) => {
      const tag = ctrlTagEls[idx];
      const col = idx === 0 ? col1El : col2El;
      if (tag) {
        if (!isSingleController) {
          tag.textContent = `[P${idx + 1} / PAD ${idx + 1}]`;
          tag.style.color = '#ffffff';
        } else {
          if (focusedColumn === idx) {
            tag.textContent = '[ACTIVE FOCUS]';
            tag.style.color = '#ffffff';
          } else {
            tag.textContent = '[LB/RB SWITCH]';
            tag.style.color = '#64748b';
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
    });
  } else {
    if (ctrlTagEls[0]) {
      ctrlTagEls[0].textContent = '[ACTIVE FOCUS]';
      ctrlTagEls[0].style.color = '#ffffff';
    }
  }

  const ballFocused = isSingleController
    ? (playerFocusRow[focusedColumn] === 4)
    : (playerFocusRow[0] === 4 || playerFocusRow[1] === 4);

  if (ballBox) {
    if (ballFocused) {
      ballBox.style.borderColor = '#ffffff';
      ballBox.style.outline = '2px solid #ffffff';
      ballBox.style.outlineOffset = '2px';
      ballBox.style.boxShadow = '0 0 20px rgba(255, 255, 255, 0.5), 0 0 25px rgba(0, 229, 255, 0.25)';
    } else {
      ballBox.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      ballBox.style.outline = 'none';
      ballBox.style.boxShadow = 'none';
    }
  }

  [0, 1].forEach((idx) => {
    const activeRow = playerFocusRow[idx];
    const isThisColActive = currentSetupMode === 'practice' || !isSingleController || focusedColumn === idx;

    [0, 1, 2, 3].forEach((rIdx) => {
      const el = playerRowElements[idx]?.[rIdx];
      if (!el) return;
      if (rIdx === activeRow && isThisColActive) {
        el.style.outline = '2px solid #ffffff';
        el.style.outlineOffset = '2px';
        el.style.boxShadow = '0 0 12px rgba(255, 255, 255, 0.3)';
        el.style.background = 'rgba(255, 255, 255, 0.06)';
      } else {
        el.style.outline = 'none';
        el.style.boxShadow = 'none';
        el.style.background = 'transparent';
      }
    });

    if (currentSetupMode === 'practice') {
      if (btnStartMatch) {
        if (playerFocusRow[0] === 5) {
          btnStartMatch.style.outline = '2px solid #34d399';
          btnStartMatch.style.outlineOffset = '2px';
          btnStartMatch.style.boxShadow = '0 0 20px rgba(52, 211, 153, 0.6)';
        } else {
          btnStartMatch.style.outline = 'none';
          btnStartMatch.style.boxShadow = '0 4px 18px rgba(16, 185, 129, 0.5)';
        }
      }
    } else {
      const readyBtn = playerReadyButtons[idx];
      if (readyBtn) {
        if (activeRow === 5 && isThisColActive) {
          readyBtn.style.outline = '2px solid #ffffff';
          readyBtn.style.outlineOffset = '2px';
          readyBtn.style.transform = 'scale(1.02)';
        } else {
          readyBtn.style.outline = 'none';
          readyBtn.style.transform = 'scale(1)';
        }
      }
    }
  });

  if (currentSetupMode !== 'practice' && btnStartMatch) {
    const isStartFocused = isSingleController
      ? (playerFocusRow[focusedColumn] === 6)
      : (playerFocusRow[0] === 6 || playerFocusRow[1] === 6);

    if (isStartFocused) {
      btnStartMatch.style.outline = '3px solid #ffffff';
      btnStartMatch.style.outlineOffset = '2px';
      btnStartMatch.style.transform = 'scale(1.02)';
      btnStartMatch.style.boxShadow = '0 0 24px rgba(255, 255, 255, 0.7), 0 0 30px rgba(0, 229, 255, 0.35)';
    } else {
      btnStartMatch.style.outline = 'none';
      btnStartMatch.style.transform = 'scale(1)';
      btnStartMatch.style.boxShadow = btnStartMatch.disabled
        ? 'none'
        : '0 4px 20px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25)';
    }
  }
}

function notifyPlayerUpdate(idx) {
  if (callbacks.onPlayerConfigChange) {
    callbacks.onPlayerConfigChange(idx, playerConfigs[idx]);
  }
}

// ---------------------------------------------------------------------------
// 3. Pre-Match Cutscene Overlay
// ---------------------------------------------------------------------------
let flyoverTimerEl = null;
let flyoverMatchupEl = null;

function buildFlyoverOverlay() {
  flyoverOverlayEl = document.createElement('div');
  flyoverOverlayEl.id = 'flyover-overlay';
  flyoverOverlayEl.style.cssText = `
    position: fixed;
    inset: 0;
    display: none;
    flex-direction: column;
    justify-content: space-between;
    padding: 40px 60px;
    pointer-events: none;
    z-index: 700;
    background: linear-gradient(to bottom, rgba(4,7,12,0.65) 0%, transparent 25%, transparent 75%, rgba(4,7,12,0.75) 100%);
  `;

  // Top Matchup Banner
  const topBox = document.createElement('div');
  topBox.style.cssText = 'display: flex; flex-direction: column; align-items: center; text-align: center;';

  const arenaTag = document.createElement('div');
  arenaTag.textContent = 'VALLEY BASIN ARENA · 1v1 MATCH';
  arenaTag.style.cssText = 'font-size: 13px; font-weight: 700; letter-spacing: 0.2em; color: #94a3b8; margin-bottom: 4px;';

  flyoverMatchupEl = document.createElement('div');
  flyoverMatchupEl.style.cssText = `
    font-size: 36px;
    font-weight: 900;
    letter-spacing: 0.08em;
    color: #ffffff;
    text-shadow: 0 4px 20px rgba(0, 0, 0, 0.9);
  `;
  flyoverMatchupEl.innerHTML = '<span style="color: #d90429;">RED</span> <span style="color: #64748b; font-size: 24px;">VS</span> <span style="color: #1d4ed8;">BLUE</span>';

  topBox.appendChild(arenaTag);
  topBox.appendChild(flyoverMatchupEl);

  // Bottom Skip Prompt
  const botBox = document.createElement('div');
  botBox.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-end; width: 100%;';

  const cameraInfo = document.createElement('div');
  cameraInfo.style.cssText = 'font-size: 11px; font-weight: 600; color: #64748b; letter-spacing: 0.06em;';
  cameraInfo.textContent = 'AERIAL ARENA SWEEP';

  const skipBtn = document.createElement('button');
  skipBtn.id = 'btn-skip-flyover';
  skipBtn.innerHTML = 'SKIP INTRO [SPACE / A] <span style="margin-left: 4px;">⏭</span>';
  skipBtn.style.cssText = `
    pointer-events: auto;
    padding: 10px 18px;
    font-size: 12px;
    font-weight: 800;
    font-family: inherit;
    color: #ffffff;
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 6px;
    cursor: pointer;
    letter-spacing: 0.08em;
    backdrop-filter: blur(4px);
    transition: all 0.15s ease;
  `;
  skipBtn.onmouseenter = () => { skipBtn.style.background = 'rgba(255, 255, 255, 0.25)'; };
  skipBtn.onmouseleave = () => { skipBtn.style.background = 'rgba(255, 255, 255, 0.15)'; };
  skipBtn.onclick = () => {
    if (callbacks.onSkipFlyover) callbacks.onSkipFlyover();
  };

  botBox.appendChild(cameraInfo);
  botBox.appendChild(skipBtn);

  flyoverOverlayEl.appendChild(topBox);
  flyoverOverlayEl.appendChild(botBox);
  rootEl.appendChild(flyoverOverlayEl);
}

// ---------------------------------------------------------------------------
// 4. Controls Modal
// ---------------------------------------------------------------------------
let currentControlsTab = 'gamepad'; // 'gamepad' | 'keyboard'

function buildControlsModal() {
  controlsModalEl = document.createElement('div');
  controlsModalEl.id = 'controls-modal';
  controlsModalEl.style.cssText = `
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(4, 7, 12, 0.88);
    backdrop-filter: blur(12px);
    pointer-events: auto;
    z-index: 1000;
  `;

  const box = document.createElement('div');
  box.style.cssText = `
    display: flex;
    flex-direction: column;
    max-width: 820px;
    width: 92%;
    max-height: 90vh;
    overflow-y: auto;
    background: rgba(11, 17, 26, 0.98);
    border: 1px solid rgba(120, 170, 210, 0.35);
    border-radius: 14px;
    padding: 24px 28px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.9), 0 0 30px rgba(56, 189, 248, 0.15);
  `;

  // Header & Tab Navigation
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid;
    border-image: linear-gradient(90deg, #ff2e55, #ff6b35, #fbb417, #4ade80, #00e5ff, #3b82f6, #a855f7) 1;
    padding-bottom: 14px;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 12px;
  `;

  const titleGroup = document.createElement('div');
  titleGroup.innerHTML = `
    <div style="font-size: 20px; font-weight: 900; letter-spacing: 0.1em; display: flex; align-items: baseline; gap: 8px;">
      <span style="background: linear-gradient(90deg, #ff2e55 0%, #ff6b35 20%, #fbb417 40%, #4ade80 60%, #00e5ff 80%, #a855f7 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">VALLEYBALL</span>
      <span style="color: #ffffff;">CONTROLS</span>
    </div>
    <div style="font-size: 11px; color: #94a3b8; font-weight: 700; letter-spacing: 0.08em; margin-top: 2px;">INTERACTIVE SCHEMATIC & FIELD MANUAL</div>
  `;

  const tabGroup = document.createElement('div');
  tabGroup.style.cssText = 'display: flex; gap: 8px; background: rgba(0, 0, 0, 0.4); padding: 4px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);';

  const btnTabGamepad = document.createElement('button');
  btnTabGamepad.id = 'tab-controls-gamepad';
  btnTabGamepad.textContent = '🎮 GAMEPAD';
  btnTabGamepad.style.cssText = `
    padding: 8px 16px;
    font-size: 12px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    color: #000000;
    background: #ffffff;
    border: 1px solid #ffffff;
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 0 14px rgba(255, 255, 255, 0.45), 0 0 20px rgba(0, 229, 255, 0.25);
    transition: all 0.15s ease;
  `;

  const btnTabKeyboard = document.createElement('button');
  btnTabKeyboard.id = 'tab-controls-keyboard';
  btnTabKeyboard.textContent = '⌨️ KEYBOARD & MOUSE';
  btnTabKeyboard.style.cssText = `
    padding: 8px 16px;
    font-size: 12px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    color: #94a3b8;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  `;

  tabGroup.appendChild(btnTabGamepad);
  tabGroup.appendChild(btnTabKeyboard);
  header.appendChild(titleGroup);
  header.appendChild(tabGroup);
  box.appendChild(header);

  // Diagram Container
  const diagramContainer = document.createElement('div');
  diagramContainer.style.cssText = 'display: flex; flex-direction: column; align-items: center; width: 100%; margin-bottom: 20px;';

  // 1. GAMEPAD SVG SCHEMATIC
  const gamepadView = document.createElement('div');
  gamepadView.id = 'controls-view-gamepad';
  gamepadView.style.cssText = 'width: 100%; display: flex; justify-content: center;';
  gamepadView.innerHTML = `
    <svg viewBox="0 0 760 300" style="width: 100%; max-height: 290px; filter: drop-shadow(0 6px 20px rgba(0,0,0,0.6)); font-family: ui-monospace, SFMono-Regular, Consolas, monospace;">
      <defs>
        <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1e293b"/>
          <stop offset="100%" stop-color="#090f1d"/>
        </linearGradient>
        <filter id="glowCyan" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#38bdf8" flood-opacity="0.6"/>
        </filter>
        <filter id="glowRose" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#f43f5e" flood-opacity="0.6"/>
        </filter>
        <filter id="glowGreen" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#10b981" flood-opacity="0.6"/>
        </filter>
      </defs>

      <!-- Controller Silhouette -->
      <path d="M 270 85 C 235 85 200 105 175 145 C 150 185 145 235 175 268 C 205 298 250 260 280 215 C 315 200 445 200 480 215 C 510 260 555 298 585 268 C 615 235 610 185 585 145 C 560 105 525 85 490 85 Z" fill="url(#bodyGrad)" stroke="#334155" stroke-width="2.5"/>
      <ellipse cx="205" cy="225" rx="32" ry="44" fill="none" stroke="rgba(56,189,248,0.12)" stroke-width="2"/>
      <ellipse cx="555" cy="225" rx="32" ry="44" fill="none" stroke="rgba(56,189,248,0.12)" stroke-width="2"/>

      <!-- Bumpers / Triggers -->
      <rect x="220" y="60" width="52" height="20" rx="5" fill="#1e293b" stroke="#38bdf8" stroke-width="2"/>
      <text x="246" y="74" fill="#38bdf8" font-size="11" font-weight="900" text-anchor="middle">LT / LB</text>

      <rect x="488" y="60" width="52" height="20" rx="5" fill="#1e293b" stroke="#38bdf8" stroke-width="2"/>
      <text x="514" y="74" fill="#38bdf8" font-size="11" font-weight="900" text-anchor="middle">RT / RB</text>

      <!-- Left Thumbstick -->
      <circle cx="265" cy="155" r="28" fill="#0f172a" stroke="#38bdf8" stroke-width="2" filter="url(#glowCyan)"/>
      <circle cx="265" cy="155" r="15" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>
      <path d="M 265 143 L 265 147 M 265 163 L 265 167 M 253 155 L 257 155 M 273 155 L 277 155" stroke="#94a3b8" stroke-width="2"/>

      <!-- Right Thumbstick -->
      <circle cx="435" cy="188" r="28" fill="#0f172a" stroke="#38bdf8" stroke-width="2" filter="url(#glowCyan)"/>
      <circle cx="435" cy="188" r="15" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>
      <path d="M 435 176 L 435 180 M 435 196 L 435 200 M 423 188 L 427 188 M 443 188 L 447 188" stroke="#94a3b8" stroke-width="2"/>

      <!-- D-Pad -->
      <path d="M 319 168 H 331 V 182 H 345 V 194 H 331 V 208 H 319 V 194 H 305 V 182 H 319 Z" fill="#1e293b" stroke="#64748b" stroke-width="2"/>

      <!-- Center System Buttons -->
      <circle cx="348" cy="132" r="7" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
      <circle cx="412" cy="132" r="7" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>

      <!-- Face Buttons (Diamond) -->
      <!-- Y (North) -->
      <circle cx="495" cy="120" r="12" fill="#1e293b" stroke="#f43f5e" stroke-width="2" filter="url(#glowRose)"/>
      <text x="495" y="124" fill="#f43f5e" font-size="11" font-weight="900" text-anchor="middle">Y</text>
      <!-- B (East) -->
      <circle cx="525" cy="150" r="12" fill="#1e293b" stroke="#38bdf8" stroke-width="2" filter="url(#glowCyan)"/>
      <text x="525" y="154" fill="#38bdf8" font-size="11" font-weight="900" text-anchor="middle">B</text>
      <!-- A (South) -->
      <circle cx="495" cy="180" r="12" fill="#1e293b" stroke="#10b981" stroke-width="2" filter="url(#glowGreen)"/>
      <text x="495" y="184" fill="#10b981" font-size="11" font-weight="900" text-anchor="middle">A</text>
      <!-- X (West) -->
      <circle cx="465" cy="150" r="12" fill="#1e293b" stroke="#a855f7" stroke-width="2"/>
      <text x="465" y="154" fill="#a855f7" font-size="11" font-weight="900" text-anchor="middle">X</text>

      <!-- CALLOUT POINTERS & LABELS (LEFT SIDE) -->
      <!-- LT Callout -->
      <polyline points="220,70 140,45" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="25" y="32" width="115" height="24" rx="4" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" stroke-width="1"/>
      <text x="82" y="48" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">LT · SPRINT</text>

      <!-- Back / Select Callout -->
      <polyline points="348,125 310,35" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="220" y="22" width="150" height="24" rx="4" fill="rgba(245,158,11,0.15)" stroke="#f59e0b" stroke-width="1"/>
      <text x="295" y="38" fill="#fcd34d" font-size="10" font-weight="800" text-anchor="middle">SELECT · BALL RESET</text>

      <!-- Left Stick Callout -->
      <polyline points="237,155 125,145" fill="none" stroke="#10b981" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="10" y="133" width="115" height="24" rx="4" fill="rgba(16,185,129,0.15)" stroke="#10b981" stroke-width="1"/>
      <text x="67" y="149" fill="#6ee7b7" font-size="10" font-weight="800" text-anchor="middle">L-STICK · MOVE</text>

      <!-- D-Pad Callout -->
      <polyline points="312,195 140,225" fill="none" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="15" y="213" width="125" height="24" rx="4" fill="rgba(251,191,36,0.15)" stroke="#fbbf24" stroke-width="1"/>
      <text x="77" y="229" fill="#fde68a" font-size="10" font-weight="800" text-anchor="middle">D-PAD · CYCLE CAM</text>

      <!-- CALLOUT POINTERS & LABELS (RIGHT SIDE) -->
      <!-- RT Callout -->
      <polyline points="540,70 620,45" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="620" y="32" width="115" height="24" rx="4" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" stroke-width="1"/>
      <text x="677" y="48" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">RT · SLIDE</text>

      <!-- Start Callout -->
      <polyline points="412,125 450,35" fill="none" stroke="#f43f5e" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="390" y="22" width="140" height="24" rx="4" fill="rgba(244,63,94,0.15)" stroke="#f43f5e" stroke-width="1"/>
      <text x="460" y="38" fill="#fda4af" font-size="10" font-weight="800" text-anchor="middle">START · PAUSE</text>

      <!-- Y Strike Callout -->
      <polyline points="507,120 625,95" fill="none" stroke="#f43f5e" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="625" y="83" width="115" height="24" rx="4" fill="rgba(244,63,94,0.15)" stroke="#f43f5e" stroke-width="1"/>
      <text x="682" y="99" fill="#fda4af" font-size="10" font-weight="800" text-anchor="middle">Y · SPIKE</text>

      <!-- B Volley Callout -->
      <polyline points="537,150 635,135" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="635" y="123" width="115" height="24" rx="4" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" stroke-width="1"/>
      <text x="692" y="139" fill="#bae6fd" font-size="10" font-weight="800" text-anchor="middle">B · VOLLEY</text>

      <!-- X Dive Callout -->
      <polyline points="465,162 615,175" fill="none" stroke="#a855f7" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="615" y="163" width="115" height="24" rx="4" fill="rgba(168,85,247,0.15)" stroke="#a855f7" stroke-width="1"/>
      <text x="672" y="179" fill="#e9d5ff" font-size="10" font-weight="800" text-anchor="middle">X · DIVE</text>

      <!-- A Jump Callout -->
      <polyline points="507,180 625,215" fill="none" stroke="#10b981" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="625" y="203" width="115" height="24" rx="4" fill="rgba(16,185,129,0.15)" stroke="#10b981" stroke-width="1"/>
      <text x="682" y="219" fill="#a7f3d0" font-size="10" font-weight="800" text-anchor="middle">A · JUMP</text>

      <!-- Right Stick Callout -->
      <polyline points="445,205 530,265" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="450" y="260" width="165" height="24" rx="4" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" stroke-width="1"/>
      <text x="532" y="276" fill="#7dd3fc" font-size="10" font-weight="800" text-anchor="middle">R-STICK · AIM / ORIENT</text>
    </svg>
  `;

  // 2. KEYBOARD & MOUSE SCHEMATIC
  const keyboardView = document.createElement('div');
  keyboardView.id = 'controls-view-keyboard';
  keyboardView.style.cssText = 'width: 100%; display: none; flex-direction: column; align-items: center; gap: 14px; padding: 10px 0;';
  keyboardView.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 680px;">
      <!-- Row 1: Function Keys -->
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; gap: 8px;">
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 68px; height: 50px; background: #0f172a; border: 1px solid #ef4444; border-radius: 6px; box-shadow: 0 0 10px rgba(239,68,68,0.3);">
            <span style="color: #ffffff; font-weight: 900; font-size: 13px;">ESC</span>
            <span style="color: #ef4444; font-weight: 700; font-size: 9px;">PAUSE</span>
          </div>
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 68px; height: 50px; background: #0f172a; border: 1px solid #fbbf24; border-radius: 6px; box-shadow: 0 0 10px rgba(251,191,36,0.3);">
            <span style="color: #ffffff; font-weight: 900; font-size: 13px;">TAB</span>
            <span style="color: #fbbf24; font-weight: 700; font-size: 9px;">CAM CYCLE</span>
          </div>
        </div>
        <div style="font-size: 11px; font-weight: 700; color: #94a3b8; letter-spacing: 0.08em;">PRIMARY ATHLETE CONTROLS (P1)</div>
      </div>

      <!-- Row 2: Action Letters Row (Q, W, E, R) -->
      <div style="display: flex; gap: 10px; justify-content: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 62px; background: #0f172a; border: 1px solid #a855f7; border-radius: 8px; box-shadow: 0 0 12px rgba(168,85,247,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 18px;">Q</span>
          <span style="color: #c084fc; font-weight: 800; font-size: 10px;">DIVE</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 62px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 18px;">W</span>
          <span style="color: #34d399; font-weight: 800; font-size: 10px;">MOVE FWD</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 62px; background: #0f172a; border: 1px solid #38bdf8; border-radius: 8px; box-shadow: 0 0 12px rgba(56,189,248,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 18px;">E</span>
          <span style="color: #7dd3fc; font-weight: 800; font-size: 10px;">VOLLEY</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 62px; background: #0f172a; border: 1px solid #f43f5e; border-radius: 8px; box-shadow: 0 0 12px rgba(244,63,94,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 18px;">R</span>
          <span style="color: #fb7185; font-weight: 800; font-size: 10px;">SPIKE</span>
        </div>
      </div>

      <!-- Row 3: Movement (A, S, D) + Practice Reset (B) -->
      <div style="display: flex; gap: 10px; justify-content: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 62px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 18px;">A</span>
          <span style="color: #34d399; font-weight: 800; font-size: 10px;">MOVE LEFT</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 62px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 18px;">S</span>
          <span style="color: #34d399; font-weight: 800; font-size: 10px;">MOVE BACK</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 62px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 18px;">D</span>
          <span style="color: #34d399; font-weight: 800; font-size: 10px;">MOVE RIGHT</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 62px; background: #0f172a; border: 1px solid #f59e0b; border-radius: 8px; box-shadow: 0 0 12px rgba(245,158,11,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 18px;">B</span>
          <span style="color: #fcd34d; font-weight: 800; font-size: 10px;">RESET BALL</span>
        </div>
      </div>

      <!-- Row 4: Modifiers (Shift, C, Space) -->
      <div style="display: flex; gap: 10px; justify-content: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 95px; height: 54px; background: #0f172a; border: 1px solid #38bdf8; border-radius: 8px; box-shadow: 0 0 12px rgba(56,189,248,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 14px;">SHIFT</span>
          <span style="color: #7dd3fc; font-weight: 800; font-size: 9px;">SPRINT</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 54px; background: #0f172a; border: 1px solid #38bdf8; border-radius: 8px; box-shadow: 0 0 12px rgba(56,189,248,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 14px;">C</span>
          <span style="color: #7dd3fc; font-weight: 800; font-size: 9px;">SLIDE</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 200px; height: 54px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 15px;">SPACEBAR</span>
          <span style="color: #34d399; font-weight: 800; font-size: 10px;">JUMP (HOLD FOR HEIGHT)</span>
        </div>
      </div>
      
      <!-- Sub-notice for P2 -->
      <div style="text-align: center; font-size: 11px; color: #64748b; font-weight: 600; margin-top: 4px;">
        PLAYER 2 SECONDARY KEYBOARD: <span style="color: #94a3b8;">IJKL (Move) · Enter (Jump) · Slash (Sprint) · O (Slide) · U (Dive) · P (Volley) · Bracket [ (Spike)</span>
      </div>
    </div>
  `;

  diagramContainer.appendChild(gamepadView);
  diagramContainer.appendChild(keyboardView);
  box.appendChild(diagramContainer);

  // Tab Switching Logic
  function setControlsTab(tab) {
    currentControlsTab = tab;
    if (tab === 'gamepad') {
      btnTabGamepad.style.background = '#ffffff';
      btnTabGamepad.style.borderColor = '#ffffff';
      btnTabGamepad.style.color = '#000000';
      btnTabGamepad.style.boxShadow = '0 0 14px rgba(255, 255, 255, 0.45), 0 0 20px rgba(0, 229, 255, 0.25)';

      btnTabKeyboard.style.background = 'transparent';
      btnTabKeyboard.style.borderColor = 'transparent';
      btnTabKeyboard.style.color = '#94a3b8';
      btnTabKeyboard.style.boxShadow = 'none';

      gamepadView.style.display = 'flex';
      keyboardView.style.display = 'none';
    } else {
      btnTabKeyboard.style.background = '#ffffff';
      btnTabKeyboard.style.borderColor = '#ffffff';
      btnTabKeyboard.style.color = '#000000';
      btnTabKeyboard.style.boxShadow = '0 0 14px rgba(255, 255, 255, 0.45), 0 0 20px rgba(0, 229, 255, 0.25)';

      btnTabGamepad.style.background = 'transparent';
      btnTabGamepad.style.borderColor = 'transparent';
      btnTabGamepad.style.color = '#94a3b8';
      btnTabGamepad.style.boxShadow = 'none';

      gamepadView.style.display = 'none';
      keyboardView.style.display = 'flex';
    }
  }

  btnTabGamepad.onclick = () => setControlsTab('gamepad');
  btnTabKeyboard.onclick = () => setControlsTab('keyboard');

  // Quick Reference Table Card
  const tableCard = document.createElement('div');
  tableCard.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 10px;
    padding: 14px 18px;
    font-size: 12px;
  `;

  const rows = [
    { action: 'Move Athlete', pad: 'Left Stick', key: 'WASD · (P2: IJKL)', color: '#10b981' },
    { action: 'Aim Strikes / Orient', pad: 'Right Stick', key: 'Arrow Keys · Mouse Drag', color: '#38bdf8' },
    { action: 'Sprint Boost', pad: 'Left Trigger (LT)', key: 'Shift · (P2: Slash /)', color: '#38bdf8' },
    { action: 'Slide Tackle (Hold)', pad: 'Right Trigger (RT)', key: 'C · (P2: O)', color: '#38bdf8' },
    { action: 'Jump (Hold for Height)', pad: 'A / Cross', key: 'Space · (P2: Enter)', color: '#10b981' },
    { action: 'Ground Dive', pad: 'X / Square', key: 'Q · (P2: U)', color: '#a855f7' },
    { action: 'Volley / Kick Strike', pad: 'B / Circle', key: 'E · (P2: P)', color: '#38bdf8' },
    { action: 'Spike Strike', pad: 'Y / Triangle', key: 'R · (P2: Bracket [)', color: '#f43f5e' },
    { action: 'Reset Ball (Practice)', pad: 'Select / Back / View', key: 'B · (P2: N)', color: '#f59e0b' },
    { action: 'Cycle Camera Angle', pad: 'D-Pad', key: 'Tab · (P2: Backslash \\)', color: '#fbbf24' },
    { action: 'Pause Menu / Settings', pad: 'Start / Options', key: 'Escape', color: '#ef4444' },
  ];

  rows.forEach((r, idx) => {
    const rowEl = document.createElement('div');
    rowEl.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 6px;
      ${idx < rows.length - 1 ? 'border-bottom: 1px solid rgba(255, 255, 255, 0.05);' : ''}
    `;
    rowEl.innerHTML = `
      <span style="color: #cbd5e1; font-weight: 700; display: flex; align-items: center; gap: 8px;">
        <span style="width: 8px; height: 8px; border-radius: 50%; background: ${r.color}; box-shadow: 0 0 6px ${r.color};"></span>
        ${r.action}
      </span>
      <div style="display: flex; gap: 14px; font-weight: 700;">
        <span style="color: #ffffff;">${r.pad}</span>
        <span style="color: #64748b;">·</span>
        <span style="color: #ffffff;">${r.key}</span>
      </div>
    `;
    tableCard.appendChild(rowEl);
  });
  box.appendChild(tableCard);

  // Close Button
  const closeBtn = document.createElement('button');
  closeBtn.id = 'btn-close-controls';
  closeBtn.textContent = 'CLOSE [ESC / B / SPACE]';
  closeBtn.style.cssText = `
    margin-top: 16px;
    padding: 12px;
    font-size: 13px;
    font-weight: 900;
    font-family: inherit;
    letter-spacing: 0.1em;
    color: #ffffff;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
  `;
  closeBtn.onmouseenter = () => {
    closeBtn.style.background = 'rgba(255, 255, 255, 0.2)';
    closeBtn.style.borderColor = '#ffffff';
  };
  closeBtn.onmouseleave = () => {
    closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    closeBtn.style.borderColor = 'rgba(255, 255, 255, 0.25)';
  };
  closeBtn.onclick = hideControlsModal;
  box.appendChild(closeBtn);

  controlsModalEl.appendChild(box);
  rootEl.appendChild(controlsModalEl);

  // Expose tab switcher for hotkeys
  controlsModalEl._setTab = setControlsTab;
}

function showControlsModal() {
  if (controlsModalEl) {
    controlsModalEl.style.display = 'flex';
    if (controlsModalEl._setTab) controlsModalEl._setTab('gamepad');
  }
}

function hideControlsModal() {
  if (controlsModalEl) controlsModalEl.style.display = 'none';
}

let titlePrevPads = [{ up: false, down: false, a: false, b: false, start: false, back: false }];

function startMenuGamepadPolling() {
  stopSetupGamepadPolling();

  const onMenuKeyDown = (e) => {
    // 0. If Settings / In-Game Menu is open, ignore main menu keys
    const inGameOverlay = document.getElementById('ingame-menu-overlay');
    if (inGameOverlay && inGameOverlay.style.display === 'flex') {
      return;
    }

    // 1. Controls Modal Open
    if (controlsModalEl && controlsModalEl.style.display === 'flex') {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        if (controlsModalEl._setTab) controlsModalEl._setTab('gamepad');
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        if (controlsModalEl._setTab) controlsModalEl._setTab('keyboard');
        return;
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        const next = currentControlsTab === 'gamepad' ? 'keyboard' : 'gamepad';
        if (controlsModalEl._setTab) controlsModalEl._setTab(next);
        return;
      }
      if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        hideControlsModal();
        return;
      }
    }

    // 2. Title Screen Active
    if (titleScreenEl && titleScreenEl.style.display === 'flex') {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') {
        e.preventDefault();
        titleFocusIndex = (titleFocusIndex - 1 + titleButtons.length) % titleButtons.length;
        updateTitleFocusUI();
      } else if (e.code === 'KeyS' || e.code === 'ArrowDown') {
        e.preventDefault();
        titleFocusIndex = (titleFocusIndex + 1) % titleButtons.length;
        updateTitleFocusUI();
      } else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        titleButtons[titleFocusIndex]?.click();
      }
      return;
    }

    // 3. Player Setup Active
    if (!playerSetupEl || playerSetupEl.style.display !== 'flex') return;

    if (e.code === 'Escape') {
      e.preventDefault();
      if (matchCountdownActive) {
        cancelMatchCountdown();
        playerReadyState[0] = false;
        playerReadyState[1] = false;
        soundManager.playTone(330, 0.12, 'sine', 0.2);
        updateReadyUI();
        return;
      }
      if (currentSetupMode !== 'practice' && (playerReadyState[0] || playerReadyState[1])) {
        playerReadyState[0] = false;
        playerReadyState[1] = false;
        soundManager.playTone(330, 0.12, 'sine', 0.2);
        updateReadyUI();
        return;
      }
      showTitleScreen();
      return;
    }

    if (e.code === 'Tab' && currentSetupMode !== 'practice') {
      e.preventDefault();
      focusedColumn = 1 - focusedColumn;
      soundManager.playTone(440, 0.06, 'sine', 0.2);
      updateFocusUI();
      return;
    }

    // Unified Arrow Keys navigation (operates on the focused column)
    if (e.code === 'ArrowUp') {
      e.preventDefault();
      playerFocusRow[focusedColumn] = Math.max(0, playerFocusRow[focusedColumn] - 1);
      updateFocusUI();
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      playerFocusRow[focusedColumn] = Math.min(5, playerFocusRow[focusedColumn] + 1);
      updateFocusUI();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      if (playerFocusRow[focusedColumn] === 4) {
        cycleMatchBall(-1);
      } else {
        cycleOption(focusedColumn, playerFocusRow[focusedColumn], -1);
      }
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      if (playerFocusRow[focusedColumn] === 4) {
        cycleMatchBall(1);
      } else {
        cycleOption(focusedColumn, playerFocusRow[focusedColumn], 1);
      }
    }

    // Player 1 Keyboard Controls (WASD navigation, Space ready)
    if (e.code === 'KeyW') {
      e.preventDefault();
      focusedColumn = 0;
      playerFocusRow[0] = Math.max(0, playerFocusRow[0] - 1);
      updateFocusUI();
    } else if (e.code === 'KeyS') {
      e.preventDefault();
      focusedColumn = 0;
      playerFocusRow[0] = Math.min(currentSetupMode === 'practice' ? 5 : 6, playerFocusRow[0] + 1);
      updateFocusUI();
    } else if (e.code === 'KeyA') {
      e.preventDefault();
      focusedColumn = 0;
      if (playerFocusRow[0] === 4) {
        cycleMatchBall(-1);
      } else {
        cycleOption(0, playerFocusRow[0], -1);
      }
    } else if (e.code === 'KeyD') {
      e.preventDefault();
      focusedColumn = 0;
      if (playerFocusRow[0] === 4) {
        cycleMatchBall(1);
      } else {
        cycleOption(0, playerFocusRow[0], 1);
      }
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (matchCountdownActive) {
        launchMatchNow();
        return;
      }
      if (currentSetupMode === 'practice') {
        if (playerFocusRow[0] === 5) {
          launchMatchNow();
        } else if (playerFocusRow[0] === 4) {
          cycleMatchBall(1);
        } else {
          cycleOption(0, playerFocusRow[0], 1);
        }
      } else {
        if (playerFocusRow[0] === 6) {
          btnStartMatch?.click();
        } else if (playerFocusRow[0] === 5) {
          togglePlayerReady(0);
        } else if (playerFocusRow[0] === 4) {
          cycleMatchBall(1);
        } else {
          cycleOption(0, playerFocusRow[0], 1);
        }
      }
    }

    // Player 2 Keyboard Controls (IJKL navigation, Enter ready)
    if (e.code === 'KeyI' && currentSetupMode !== 'practice') {
      e.preventDefault();
      focusedColumn = 1;
      playerFocusRow[1] = Math.max(0, playerFocusRow[1] - 1);
      updateFocusUI();
    } else if (e.code === 'KeyK' && currentSetupMode !== 'practice') {
      e.preventDefault();
      focusedColumn = 1;
      playerFocusRow[1] = Math.min(currentSetupMode === 'practice' ? 5 : 6, playerFocusRow[1] + 1);
      updateFocusUI();
    } else if (e.code === 'KeyJ' && currentSetupMode !== 'practice') {
      e.preventDefault();
      focusedColumn = 1;
      if (playerFocusRow[1] === 4) {
        cycleMatchBall(-1);
      } else {
        cycleOption(1, playerFocusRow[1], -1);
      }
    } else if (e.code === 'KeyL' && currentSetupMode !== 'practice') {
      e.preventDefault();
      focusedColumn = 1;
      if (playerFocusRow[1] === 4) {
        cycleMatchBall(1);
      } else {
        cycleOption(1, playerFocusRow[1], 1);
      }
    } else if (e.code === 'Enter') {
      e.preventDefault();
      if (matchCountdownActive) {
        launchMatchNow();
        return;
      }
      if (currentSetupMode === 'practice') {
        launchMatchNow();
      } else {
        const targetIdx = focusedColumn;
        if (playerFocusRow[targetIdx] === 6) {
          btnStartMatch?.click();
        } else if (playerFocusRow[targetIdx] === 5) {
          togglePlayerReady(targetIdx);
        } else if (playerFocusRow[targetIdx] === 4) {
          cycleMatchBall(1);
        } else {
          cycleOption(targetIdx, playerFocusRow[targetIdx], 1);
        }
      }
    }
  };
  window.addEventListener('keydown', onMenuKeyDown);

  const prevPads = [
    { up: false, down: false, left: false, right: false, a: false, b: false, lb: false, rb: false, start: false, back: false },
    { up: false, down: false, left: false, right: false, a: false, b: false, lb: false, rb: false, start: false, back: false },
  ];
  titlePrevPads = [{ up: false, down: false, a: false, b: false, start: false, back: false }];

  gamepadPollHandle = setInterval(() => {
    if (!rootEl || rootEl.style.display === 'none') return;

    const inGameOverlay = document.getElementById('ingame-menu-overlay');
    if (inGameOverlay && inGameOverlay.style.display === 'flex') return;

    if (typeof navigator.getGamepads !== 'function') return;
    const raw = navigator.getGamepads();
    const pads = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] && raw[i].connected) pads.push(raw[i]);
    }

    // 1. Controls Modal Active -> B / Start / Back closes; LB/RB/Left/Right switches tabs
    if (controlsModalEl && controlsModalEl.style.display === 'flex') {
      for (const pad of pads) {
        if (!pad) continue;
        const btnB = pad.buttons[1]?.pressed || false;
        const btnStart = pad.buttons[9]?.pressed || false;
        const btnBack = pad.buttons[8]?.pressed || false;
        const btnLB = pad.buttons[4]?.pressed || false;
        const btnRB = pad.buttons[5]?.pressed || false;
        const left = (pad.buttons[14]?.pressed || (pad.axes[0] && pad.axes[0] < -0.5)) || false;
        const right = (pad.buttons[15]?.pressed || (pad.axes[0] && pad.axes[0] > 0.5)) || false;
        const p = titlePrevPads[0];

        if ((btnLB && !p.lb) || (left && !p.left)) {
          if (controlsModalEl._setTab) controlsModalEl._setTab('gamepad');
        } else if ((btnRB && !p.rb) || (right && !p.right)) {
          if (controlsModalEl._setTab) controlsModalEl._setTab('keyboard');
        }

        p.lb = btnLB; p.rb = btnRB; p.left = left; p.right = right;

        if ((btnB && !p.b) || (btnStart && !p.start) || (btnBack && !p.back)) {
          hideControlsModal();
          p.b = btnB; p.start = btnStart; p.back = btnBack;
          return;
        }
        p.b = btnB; p.start = btnStart; p.back = btnBack;
      }
      return;
    }

    // 2. Title Screen Active -> Any connected pad navigates Title options
    if (titleScreenEl && titleScreenEl.style.display === 'flex') {
      for (const pad of pads) {
        if (!pad) continue;
        const up = (pad.buttons[12]?.pressed || (pad.axes[1] && pad.axes[1] < -0.5)) || false;
        const down = (pad.buttons[13]?.pressed || (pad.axes[1] && pad.axes[1] > 0.5)) || false;
        const btnA = pad.buttons[0]?.pressed || false;
        const btnStart = pad.buttons[9]?.pressed || false;
        const p = titlePrevPads[0];

        if (up && !p.up) {
          titleFocusIndex = (titleFocusIndex - 1 + titleButtons.length) % titleButtons.length;
          updateTitleFocusUI();
        }
        if (down && !p.down) {
          titleFocusIndex = (titleFocusIndex + 1) % titleButtons.length;
          updateTitleFocusUI();
        }
        if ((btnA && !p.a) || (btnStart && !p.start)) {
          titleButtons[titleFocusIndex]?.click();
        }

        p.up = up;
        p.down = down;
        p.a = btnA;
        p.start = btnStart;
      }
      return;
    }

    // 3. Player Setup Active
    if (!playerSetupEl || playerSetupEl.style.display !== 'flex') return;

    const isSingleController = pads.length < 2;
    const assignments = getControllerAssignments(currentSetupMode === 'practice' ? 1 : 2, currentSetupMode);
    if (playerInputBadges[0]) playerInputBadges[0].textContent = `INPUT: ${assignments.p1}`;
    if (playerInputBadges[1] && currentSetupMode !== 'practice') playerInputBadges[1].textContent = `INPUT: ${assignments.p2}`;

    if (currentSetupMode === 'practice') {
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
          playerFocusRow[0] = Math.max(0, playerFocusRow[0] - 1);
          updateFocusUI();
        }
        if (down && !prev.down) {
          playerFocusRow[0] = Math.min(5, playerFocusRow[0] + 1);
          updateFocusUI();
        }

        if (left && !prev.left) {
          if (playerFocusRow[0] === 4) cycleMatchBall(-1);
          else cycleOption(0, playerFocusRow[0], -1);
        }
        if (right && !prev.right) {
          if (playerFocusRow[0] === 4) cycleMatchBall(1);
          else cycleOption(0, playerFocusRow[0], 1);
        }

        if (btnLB && !prev.lb) cycleMatchBall(-1);
        if (btnRB && !prev.rb) cycleMatchBall(1);

        if (btnA && !prev.a) {
          if (playerFocusRow[0] === 5) {
            launchMatchNow();
          } else if (playerFocusRow[0] === 4) {
            cycleMatchBall(1);
          } else {
            cycleOption(0, playerFocusRow[0], 1);
          }
        }

        if ((btnB && !prev.b) || (btnBack && !prev.back)) {
          showTitleScreen();
          return;
        }

        if (btnStart && !prev.start) {
          launchMatchNow();
        }

        prev.up = up; prev.down = down; prev.left = left; prev.right = right;
        prev.a = btnA; prev.b = btnB; prev.lb = btnLB; prev.rb = btnRB;
        prev.back = btnBack; prev.start = btnStart;
      }
      return;
    }

    // Match Mode: Single Gamepad Branch (LB / RB to swap column, unified readying)
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
        playerFocusRow[focusedColumn] = Math.max(0, playerFocusRow[focusedColumn] - 1);
        updateFocusUI();
      }
      if (down && !prev.down) {
        playerFocusRow[focusedColumn] = Math.min(6, playerFocusRow[focusedColumn] + 1);
        updateFocusUI();
      }

      if (left && !prev.left) {
        if (playerFocusRow[focusedColumn] === 4) {
          cycleMatchBall(-1);
        } else if (playerFocusRow[focusedColumn] === 6) {
          playerFocusRow[focusedColumn] = 5;
          updateFocusUI();
        } else {
          cycleOption(focusedColumn, playerFocusRow[focusedColumn], -1);
        }
      }
      if (right && !prev.right) {
        if (playerFocusRow[focusedColumn] === 4) {
          cycleMatchBall(1);
        } else if (playerFocusRow[focusedColumn] === 5) {
          playerFocusRow[focusedColumn] = 6;
          updateFocusUI();
        } else {
          cycleOption(focusedColumn, playerFocusRow[focusedColumn], 1);
        }
      }

      // LB / RB: If on match ball row (4), cycle match ball; else switch column!
      if (btnLB && !prev.lb) {
        if (playerFocusRow[focusedColumn] === 4) {
          cycleMatchBall(-1);
        } else {
          focusedColumn = 1 - focusedColumn;
          soundManager.playTone(440, 0.06, 'sine', 0.2);
          updateFocusUI();
        }
      }
      if (btnRB && !prev.rb) {
        if (playerFocusRow[focusedColumn] === 4) {
          cycleMatchBall(1);
        } else {
          focusedColumn = 1 - focusedColumn;
          soundManager.playTone(440, 0.06, 'sine', 0.2);
          updateFocusUI();
        }
      }

      if (btnA && !prev.a) {
        if (matchCountdownActive) {
          launchMatchNow();
        } else if (playerFocusRow[focusedColumn] === 6) {
          btnStartMatch?.click();
        } else if (playerFocusRow[focusedColumn] === 5) {
          togglePlayerReady(focusedColumn);
        } else if (playerFocusRow[focusedColumn] === 4) {
          cycleMatchBall(1);
        } else {
          cycleOption(focusedColumn, playerFocusRow[focusedColumn], 1);
        }
      }

      if ((btnB && !prev.b) || (btnBack && !prev.back)) {
        if (matchCountdownActive) {
          cancelMatchCountdown();
          playerReadyState[0] = false;
          playerReadyState[1] = false;
          soundManager.playTone(330, 0.12, 'sine', 0.2);
          updateReadyUI();
        } else if (playerReadyState[0] || playerReadyState[1]) {
          playerReadyState[0] = false;
          playerReadyState[1] = false;
          soundManager.playTone(330, 0.12, 'sine', 0.2);
          updateReadyUI();
        } else {
          showTitleScreen();
          return;
        }
      }

      if (btnStart && !prev.start) {
        if (matchCountdownActive) {
          launchMatchNow();
        } else if (!btnStartMatch?.disabled) {
          btnStartMatch?.click();
        } else {
          togglePlayerReady(focusedColumn);
        }
      }

      prev.up = up; prev.down = down; prev.left = left; prev.right = right;
      prev.a = btnA; prev.b = btnB; prev.lb = btnLB; prev.rb = btnRB;
      prev.back = btnBack; prev.start = btnStart;
      return;
    }

    // Match Mode: Two Gamepads Connected (Pad 0 drives P1, Pad 1 drives P2)
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
        playerFocusRow[playerIdx] = Math.max(0, playerFocusRow[playerIdx] - 1);
        updateFocusUI();
      }
      if (down && !prev.down) {
        playerFocusRow[playerIdx] = Math.min(6, playerFocusRow[playerIdx] + 1);
        updateFocusUI();
      }

      if (left && !prev.left) {
        if (playerFocusRow[playerIdx] === 4) cycleMatchBall(-1);
        else if (playerFocusRow[playerIdx] === 6) {
          playerFocusRow[playerIdx] = 5;
          updateFocusUI();
        } else cycleOption(playerIdx, playerFocusRow[playerIdx], -1);
      }
      if (right && !prev.right) {
        if (playerFocusRow[playerIdx] === 4) cycleMatchBall(1);
        else if (playerFocusRow[playerIdx] === 5) {
          playerFocusRow[playerIdx] = 6;
          updateFocusUI();
        } else cycleOption(playerIdx, playerFocusRow[playerIdx], 1);
      }

      if (btnLB && !prev.lb) cycleMatchBall(-1);
      if (btnRB && !prev.rb) cycleMatchBall(1);

      if (btnA && !prev.a) {
        if (matchCountdownActive) {
          launchMatchNow();
        } else if (playerFocusRow[playerIdx] === 6) {
          btnStartMatch?.click();
        } else if (playerFocusRow[playerIdx] === 5) {
          togglePlayerReady(playerIdx);
        } else if (playerFocusRow[playerIdx] === 4) {
          cycleMatchBall(1);
        } else {
          cycleOption(playerIdx, playerFocusRow[playerIdx], 1);
        }
      }

      if ((btnB && !prev.b) || (btnBack && !prev.back)) {
        if (matchCountdownActive) {
          cancelMatchCountdown();
          playerReadyState[0] = false;
          playerReadyState[1] = false;
          soundManager.playTone(330, 0.12, 'sine', 0.2);
          updateReadyUI();
        } else if (playerReadyState[playerIdx]) {
          playerReadyState[playerIdx] = false;
          soundManager.playTone(330, 0.12, 'sine', 0.2);
          updateReadyUI();
        } else {
          showTitleScreen();
          return;
        }
      }

      if (btnStart && !prev.start) {
        if (matchCountdownActive) {
          launchMatchNow();
        } else if (!btnStartMatch?.disabled) {
          btnStartMatch?.click();
        } else {
          togglePlayerReady(playerIdx);
        }
      }

      prev.up = up; prev.down = down; prev.left = left; prev.right = right;
      prev.a = btnA; prev.b = btnB; prev.lb = btnLB; prev.rb = btnRB;
      prev.back = btnBack; prev.start = btnStart;
    });
  }, 50);

  window._cleanupSetupListeners = () => {
    window.removeEventListener('keydown', onMenuKeyDown);
    if (gamepadPollHandle) {
      clearInterval(gamepadPollHandle);
      gamepadPollHandle = null;
    }
  };
}

function stopSetupGamepadPolling() {
  if (window._cleanupSetupListeners) {
    window._cleanupSetupListeners();
    window._cleanupSetupListeners = null;
  }
}

// ---------------------------------------------------------------------------
// Public Navigation API
// ---------------------------------------------------------------------------
export function showTitleScreen() {
  cancelMatchCountdown();
  if (!rootEl) return;
  if (playerSetupEl && playerSetupEl.style.display === 'flex' && callbacks.onExitSetup) {
    callbacks.onExitSetup();
  }
  rootEl.style.pointerEvents = 'auto';
  titleScreenEl.style.display = 'flex';
  playerSetupEl.style.display = 'none';
  flyoverOverlayEl.style.display = 'none';
  hideControlsModal();
  updateTitleFocusUI();
  startMenuGamepadPolling();
  titleBrandBall?.start();
}

export function showPlayerSetup(mode = 'match') {
  if (!rootEl) return;
  titleBrandBall?.stop();
  currentSetupMode = mode;
  rootEl.style.pointerEvents = 'auto';
  titleScreenEl.style.display = 'none';
  playerSetupEl.style.display = 'flex';
  flyoverOverlayEl.style.display = 'none';

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
    currentBallOptions = PRACTICE_BALL_OPTIONS;
    selectedMatchBall = 'all';
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
    currentBallOptions = MATCH_BALL_OPTIONS;
    selectedMatchBall = 'random';
  }

  renderMatchBallCards(currentBallOptions);

  if (callbacks.onEnterSetup) {
    callbacks.onEnterSetup(mode);
  }

  cancelMatchCountdown();
  focusedColumn = 0;
  playerReadyState = [false, false];
  playerFocusRow = [0, 0];
  updateReadyUI();
  updateTeamButtonsUI();
  enforceColorExclusivity();
  updateMatchBallUI();
  updateFocusUI();
  startMenuGamepadPolling();
}

export function hidePlayerSetup() {
  stopSetupGamepadPolling();
  if (playerSetupEl) playerSetupEl.style.display = 'none';
}

export function showFlyoverOverlay(
  p1Name = 'HOME',
  p2Name = 'AWAY',
  p1Color = '#ff4d6d',
  p2Color = '#60a5fa',
) {
  if (!flyoverOverlayEl) return;
  rootEl.style.pointerEvents = 'auto';
  flyoverOverlayEl.style.display = 'flex';
  if (flyoverMatchupEl) {
    flyoverMatchupEl.innerHTML = `<span style="color: ${p1Color};">${p1Name}</span> <span style="color: #64748b; font-size: 24px;">VS</span> <span style="color: ${p2Color};">${p2Name}</span>`;
  }
}

export function hideFlyoverOverlay() {
  if (flyoverOverlayEl) flyoverOverlayEl.style.display = 'none';
}

export function hideMainMenu() {
  stopSetupGamepadPolling();
  titleBrandBall?.stop();
  if (rootEl) rootEl.style.pointerEvents = 'none';
  if (titleScreenEl) titleScreenEl.style.display = 'none';
  if (playerSetupEl) playerSetupEl.style.display = 'none';
  if (flyoverOverlayEl) flyoverOverlayEl.style.display = 'none';
}

export function isMainMenuActive() {
  if (!rootEl) return false;
  return (
    titleScreenEl.style.display === 'flex' ||
    playerSetupEl.style.display === 'flex'
  );
}

export function getPlayerConfigs() {
  return playerConfigs;
}

export function getSelectedMatchBall() {
  return selectedMatchBall;
}

// ---------------------------------------------------------------------------
// Toast Notification HUD System
// ---------------------------------------------------------------------------

let toastContainerEl = null;

function ensureToastContainer() {
  if (toastContainerEl && document.body.contains(toastContainerEl)) return toastContainerEl;
  toastContainerEl = document.createElement('div');
  toastContainerEl.id = 'vy-toast-container';
  toastContainerEl.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    z-index: 100000;
    pointer-events: none;
    max-width: 400px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  `;
  document.body.appendChild(toastContainerEl);
  return toastContainerEl;
}

export function showToast(message, type = 'info', duration = 3500) {
  if (typeof document === 'undefined') return;
  const container = ensureToastContainer();
  const toast = document.createElement('div');

  const borderColor = type === 'warning' ? 'rgba(245, 158, 11, 0.7)' : (type === 'error' ? 'rgba(239, 68, 68, 0.7)' : 'rgba(59, 130, 246, 0.7)');
  const bgColor = type === 'warning' ? 'rgba(30, 25, 15, 0.94)' : (type === 'error' ? 'rgba(30, 15, 15, 0.94)' : 'rgba(15, 23, 42, 0.94)');
  const textColor = type === 'warning' ? '#fde68a' : (type === 'error' ? '#fca5a5' : '#e2e8f0');

  toast.style.cssText = `
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 18px;
    background: ${bgColor};
    color: ${textColor};
    border: 1px solid ${borderColor};
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5), 0 0 15px rgba(59, 130, 246, 0.2);
    backdrop-filter: blur(10px);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.3px;
    transform: translateX(100%);
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: auto;
  `;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.transform = 'translateX(0)';
    toast.style.opacity = '1';
  });

  setTimeout(() => {
    toast.style.transform = 'translateX(100%)';
    toast.style.opacity = '0';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 320);
  }, duration);
}

// ---------------------------------------------------------------------------
// Mobile / Touch Device Notice Banner
// ---------------------------------------------------------------------------

let mobileNoticeEl = null;

export function initMobileNotice() {
  if (typeof window === 'undefined') return;
  if (sessionStorage.getItem('vy_mobile_notice_dismissed')) return;

  const isTouchOrMobile = (
    ('ontouchstart' in window) ||
    (navigator.maxTouchPoints > 0) ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth < 768
  );

  if (!isTouchOrMobile) return;

  mobileNoticeEl = document.createElement('div');
  mobileNoticeEl.id = 'vy-mobile-notice';
  mobileNoticeEl.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 99999;
    background: linear-gradient(90deg, rgba(30, 58, 138, 0.96) 0%, rgba(15, 23, 42, 0.96) 100%);
    border-bottom: 2px solid rgba(59, 130, 246, 0.5);
    color: #e2e8f0;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.4;
  `;

  mobileNoticeEl.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px;">
      <span style="font-size: 18px;">📱</span>
      <span>
        <strong>Mobile / Touch Device Detected:</strong> Valleyball Versus is optimized for desktop browsers with 1–2 gamepads or keyboard. Touch controls are currently not supported.
      </span>
    </div>
    <button id="vy-mobile-dismiss" style="
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      margin-left: 12px;
      white-space: nowrap;
    ">DISMISS ✕</button>
  `;

  document.body.appendChild(mobileNoticeEl);

  const dismissBtn = mobileNoticeEl.querySelector('#vy-mobile-dismiss');
  if (dismissBtn) {
    dismissBtn.onclick = () => {
      sessionStorage.setItem('vy_mobile_notice_dismissed', '1');
      mobileNoticeEl.remove();
      mobileNoticeEl = null;
    };
  }
}

