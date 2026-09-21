import { TUNING } from '../config/tuning.js';
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
  { id: 'sports', label: 'SPORTS CAM [FULLSCREEN]' },
  { id: 'broadcast', label: 'SIDELINE BROADCAST [FULLSCREEN]' },
  { id: 'tactical', label: 'TACTICAL OVERHEAD' },
];

export const MATCH_BALL_OPTIONS = [
  { id: 'random', label: 'RANDOM', desc: 'Random each match [Default]' },
  { id: 'small', label: 'FOOTBALL (SMALL)', desc: '0.4m · Hard Difficulty' },
  { id: 'medium', label: 'MEDIUM BALL', desc: '1.0m · Average Difficulty' },
  { id: 'large', label: 'BIG BALL', desc: '1.5m · Easiest Difficulty' },
];

export const MATCH_DURATION_OPTIONS = [
  { id: 180, label: '3 MIN', desc: 'Fast arcade match' },
  { id: 300, label: '5 MIN (DEFAULT)', desc: 'Standard tournament match' },
  { id: 600, label: '10 MIN', desc: 'Extended championship' },
];

export const ARENA_OPTIONS = [
  { id: 'court', label: 'VALLEY COURT (DEFAULT)', desc: '50x120m valley basin with goal hoops' },
  { id: 'bowl', label: 'PHYSICS BOWL', desc: 'Procedural physics lathe & determinism anchor' },
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
let mainMenuSettingsModalEl = null;
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
    type: 'human',
    difficulty: 'medium',
    aggressiveness: 0.60,
    team: 'home',
    variant: 'classic',
    primaryColor: 0xd90429,
    cameraMode: 'chase',
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
  },
];

let currentSetupMode = 'match';
let setupPage = 1;
let currentBallOptions = MATCH_BALL_OPTIONS;
let selectedMatchBall = 'random';
let selectedMatchDuration = 300;
let selectedMatchArena = (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('arena')) === 'bowl' ? 'bowl' : 'court';
let matchBallCards = [];
let matchDurationButtons = [];
let arenaButtons = [];
let matchRulesBoxEl = null;
let matchRulesFocusRow = 0; // 0: ball, 1: duration, 2: arena, 3: ready, 4: start

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

  // 4. How To Play Modal (Controls, Match Basics, Scoring & Pro Tips)
  buildHowToPlayModal();

  // 5. Main Menu Settings Modal (Audio, Graphics, Camera)
  buildMainMenuSettingsModal();

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
    showMainMenuSettingsModal();
  });
  btnSettings.id = 'btn-title-settings';

  const btnHowToPlay = createMenuButton('HOW TO PLAY', 'rgba(255, 255, 255, 0.08)', () => {
    showHowToPlayModal();
  });
  btnHowToPlay.id = 'btn-title-how-to-play';

  menuList.appendChild(btnPractice);
  menuList.appendChild(btnPlayMatch);
  menuList.appendChild(btnMatch2v2);
  menuList.appendChild(btnSettings);
  menuList.appendChild(btnHowToPlay);

  titleButtons = [btnPractice, btnPlayMatch, btnSettings, btnHowToPlay];
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
      showTitleScreen();
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

function buildMatchDurationSelector() {
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

function updateMatchDurationUI() {
  matchDurationButtons.forEach(({ card, opt }) => {
    const isSelected = selectedMatchDuration === opt.id;
    card.style.background = isSelected ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)';
    card.style.borderColor = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.15)';
    card.style.boxShadow = isSelected ? '0 0 14px rgba(255, 255, 255, 0.4), 0 0 18px rgba(0, 229, 255, 0.25)' : 'none';
    const titleSpan = card.firstElementChild;
    if (titleSpan) titleSpan.style.color = isSelected ? '#ffffff' : '#94a3b8';
  });
}

function cycleMatchDuration(direction = 1) {
  const curIdx = MATCH_DURATION_OPTIONS.findIndex((o) => o.id === selectedMatchDuration);
  const nextIdx = (curIdx + direction + MATCH_DURATION_OPTIONS.length) % MATCH_DURATION_OPTIONS.length;
  selectedMatchDuration = MATCH_DURATION_OPTIONS[nextIdx].id;
  updateMatchDurationUI();
}

function buildArenaSelector() {
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
  arenaRowEl.style.cssText = 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;';

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

function updateArenaUI() {
  arenaButtons.forEach(({ card, opt }) => {
    const isSelected = selectedMatchArena === opt.id;
    card.style.background = isSelected ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)';
    card.style.borderColor = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.15)';
    card.style.boxShadow = isSelected ? '0 0 14px rgba(255, 255, 255, 0.4), 0 0 18px rgba(0, 229, 255, 0.25)' : 'none';
    const titleSpan = card.firstElementChild;
    if (titleSpan) titleSpan.style.color = isSelected ? '#ffffff' : '#94a3b8';
  });
}

function cycleArena(direction = 1) {
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

function setPlayerType(idx, typeId) {
  if (typeId === 'human') {
    playerConfigs[idx].type = 'human';
    playerReadyState[idx] = false;
  } else {
    playerConfigs[idx].type = 'ai';
    playerConfigs[idx].difficulty = typeId.replace('ai-', '');
    playerReadyState[idx] = true;
  }

  updateReadyUI();
  updateTypeButtonsUI();
  updateAggressivenessUI(idx);
  updateFocusUI();
  notifyPlayerUpdate(idx);
}

function updateTypeButtonsUI() {
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
    const types = ['human', 'ai-easy', 'ai-medium', 'ai-hard'];
    const curConfig = playerConfigs[playerIdx];
    const curId = curConfig.type === 'human' ? 'human' : `ai-${curConfig.difficulty}`;
    const curIdx = types.indexOf(curId);
    const nextIdx = (curIdx + direction + types.length) % types.length;
    setPlayerType(playerIdx, types[nextIdx]);
  } else if (rowIdx === 1) {
    setPlayerTeam(playerIdx, playerConfigs[playerIdx].team === 'home' ? 'away' : 'home');
  } else if (rowIdx === 2) {
    const homeIdx = playerConfigs[0].team === 'home' ? 0 : 1;
    const isAway = playerIdx !== homeIdx;
    const homeColor = playerConfigs[homeIdx].primaryColor;
    const allowed = PALETTE_SWATCHES.filter((s) => !isAway || s.hex !== homeColor);
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
    setupPage = 2;
    window._updateSetupPage();
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
      playerFocusRow[idx] = 1;
      focusedColumn = idx;
      updateFocusUI();
      setPlayerTeam(idx, t.id);
    };
    playerTeamButtons[idx].push({ btn, teamId: t.id });
    teamBtnRow.appendChild(btn);
  });
  teamStatusRow.appendChild(teamBtnRow);
  teamCard.appendChild(teamStatusRow);
  playerRowElements[idx][1] = teamStatusRow;

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
      playerFocusRow[idx] = 2;
      focusedColumn = idx;
      updateFocusUI();
      setPlayerColor(idx, swatch.hex);
    };
    playerSwatchButtons[idx].push({ btn: swBtn, swatch });
    swatchGrid.appendChild(swBtn);
  });
  teamColorRow.appendChild(swatchGrid);
  teamCard.appendChild(teamColorRow);
  playerRowElements[idx][2] = teamColorRow;

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
      playerFocusRow[idx] = 3;
      focusedColumn = idx;
      updateFocusUI();
      setPlayerPhysique(idx, variant);
    };
    playerPhysiqueButtons[idx].push({ btn, variant });
    physiqueBtnRow.appendChild(btn);
  });
  physiqueRow.appendChild(physiqueBtnRow);
  charCard.appendChild(physiqueRow);
  playerRowElements[idx][3] = physiqueRow;

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
    playerFocusRow[idx] = 4;
    focusedColumn = idx;
    updateFocusUI();
    setPlayerCamera(idx, e.target.value);
  };
  camSelect.onfocus = () => {
    playerFocusRow[idx] = 4;
    focusedColumn = idx;
    updateFocusUI();
  };
  playerCameraSelects[idx] = camSelect;
  cameraRow.appendChild(camSelect);
  charCard.appendChild(cameraRow);
  playerRowElements[idx][4] = cameraRow;

  // Row 5: Next Button
  playerRowElements[idx][5] = btnNext;

  col.appendChild(charCard);

  return col;
}

function updateFocusUI() {
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

    // Rows 1..4 (Character options: Team, Swatch, Physique, Camera)
    [1, 2, 3, 4].forEach((rIdx) => {
      const el = playerRowElements[0]?.[rIdx];
      if (!el) return;
      if (rIdx === activeRow) {
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

    // Row 5: Practice Ball Selector Box
    if (ballBox) {
      if (activeRow === 5) {
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

    // Row 6: Start Practice Drill Button
    if (btnStartMatch) {
      if (activeRow === 6) {
        btnStartMatch.style.outline = '2px solid #34d399';
        btnStartMatch.style.outlineOffset = '2px';
        btnStartMatch.style.boxShadow = '0 0 20px rgba(52, 211, 153, 0.6)';
      } else {
        btnStartMatch.style.outline = 'none';
        btnStartMatch.style.boxShadow = '0 4px 18px rgba(16, 185, 129, 0.5)';
      }
    }
    return;
  }

  // 2. MATCH MODE SCREEN 2: MATCH RULES & CUSTOMIZATION
  if (setupPage === 2) {
    // Row 0: Match Ball Box
    if (ballBox) {
      if (matchRulesFocusRow === 0) {
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

    // Row 1: Match Duration Box
    if (durationBox) {
      if (matchRulesFocusRow === 1) {
        durationBox.style.borderColor = '#ffffff';
        durationBox.style.outline = '2px solid #ffffff';
        durationBox.style.outlineOffset = '2px';
        durationBox.style.boxShadow = '0 0 20px rgba(255, 255, 255, 0.5), 0 0 25px rgba(0, 229, 255, 0.25)';
      } else {
        durationBox.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        durationBox.style.outline = 'none';
        durationBox.style.boxShadow = 'none';
      }
    }

    // Row 2: Arena Selector Box
    if (arenaBox) {
      if (matchRulesFocusRow === 2) {
        arenaBox.style.borderColor = '#ffffff';
        arenaBox.style.outline = '2px solid #ffffff';
        arenaBox.style.outlineOffset = '2px';
        arenaBox.style.boxShadow = '0 0 20px rgba(255, 255, 255, 0.5), 0 0 25px rgba(0, 229, 255, 0.25)';
      } else {
        arenaBox.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        arenaBox.style.outline = 'none';
        arenaBox.style.boxShadow = 'none';
      }
    }

    // Row 3: Ready Buttons
    [0, 1].forEach((idx) => {
      const readyBtn = playerReadyButtons[idx];
      if (readyBtn) {
        const isReadyFocused = (matchRulesFocusRow === 3) && (isSingleController ? focusedColumn === idx : true);
        if (isReadyFocused) {
          readyBtn.style.outline = '2px solid #ffffff';
          readyBtn.style.outlineOffset = '2px';
          readyBtn.style.transform = 'scale(1.02)';
        } else {
          readyBtn.style.outline = 'none';
          readyBtn.style.transform = 'scale(1)';
        }
      }
    });

    // Row 4: Start Match / Spectate Match Button
    if (btnStartMatch) {
      if (matchRulesFocusRow === 4) {
        btnStartMatch.style.outline = '3px solid #ffffff';
        btnStartMatch.style.outlineOffset = '2px';
        btnStartMatch.style.transform = 'scale(1.02)';
        btnStartMatch.style.boxShadow = '0 0 24px rgba(255, 255, 255, 0.7), 0 0 30px rgba(0, 229, 255, 0.35)';
      } else {
        btnStartMatch.style.outline = 'none';
        btnStartMatch.style.transform = 'scale(1)';
        btnStartMatch.style.boxShadow = btnStartMatch.disabled
          ? 'none'
          : (playerConfigs.every((c) => c.type === 'ai')
              ? '0 0 25px rgba(0, 229, 255, 0.6), 0 4px 20px rgba(0, 229, 255, 0.4)'
              : '0 4px 20px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25)');
      }
    }
    return;
  }

  // 3. MATCH MODE SCREEN 1: PLAYER & TEAM SETUP
  // Column focus tags & borders
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

    const activeRow = playerFocusRow[idx];
    const isThisColActive = !isSingleController || focusedColumn === idx;

    // Rows 0..4: Type, Team, Color, Physique, Camera
    [0, 1, 2, 3, 4].forEach((rIdx) => {
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
  });

  // Row 5: Next Button
  if (btnNext) {
    const isNextFocused = isSingleController
      ? (playerFocusRow[focusedColumn] === 5)
      : (playerFocusRow[0] === 5 || playerFocusRow[1] === 5);
    if (isNextFocused) {
      btnNext.style.outline = '2px solid #ffffff';
      btnNext.style.outlineOffset = '2px';
      btnNext.style.transform = 'scale(1.02)';
      btnNext.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.8), 0 0 25px rgba(255, 255, 255, 0.4)';
    } else {
      btnNext.style.outline = 'none';
      btnNext.style.transform = 'scale(1)';
      btnNext.style.boxShadow = '0 4px 18px rgba(16, 185, 129, 0.5)';
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
// 4. How To Play Modal (Controls, Match Basics, Scoring & Pro Tips)
// ---------------------------------------------------------------------------
const HOWTO_TABS = ['controls', 'basics', 'tips'];
let currentHowToPlayTab = 'controls';
let currentControlsDevice = 'gamepad'; // 'gamepad' | 'keyboard'

export function buildHowToPlayModal() {
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
    max-width: 840px;
    width: 92%;
    max-height: 90vh;
    overflow-y: auto;
    background: rgba(11, 17, 26, 0.98);
    border: 1px solid rgba(120, 170, 210, 0.35);
    border-radius: 14px;
    padding: 24px 28px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.9), 0 0 30px rgba(56, 189, 248, 0.15);
    font-family: inherit;
  `;

  // Header & 3-Tab Navigation
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
      <span style="color: #ffffff;">HOW TO PLAY</span>
    </div>
    <div style="font-size: 11px; color: #94a3b8; font-weight: 700; letter-spacing: 0.08em; margin-top: 2px;">CONTROLS · MATCH BASICS · SCORING STRATEGY</div>
  `;

  const mainTabGroup = document.createElement('div');
  mainTabGroup.style.cssText = 'display: flex; gap: 8px; background: rgba(0, 0, 0, 0.4); padding: 4px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);';

  const btnTabControls = document.createElement('button');
  btnTabControls.id = 'tab-howto-controls';
  btnTabControls.textContent = '🎮 CONTROLS';

  const btnTabBasics = document.createElement('button');
  btnTabBasics.id = 'tab-howto-basics';
  btnTabBasics.textContent = '📋 MATCH BASICS';

  const btnTabTips = document.createElement('button');
  btnTabTips.id = 'tab-howto-tips';
  btnTabTips.textContent = '🎯 SCORING & PRO TIPS';

  [btnTabControls, btnTabBasics, btnTabTips].forEach((btn) => {
    btn.style.cssText = `
      padding: 8px 14px;
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
    mainTabGroup.appendChild(btn);
  });

  header.appendChild(titleGroup);
  header.appendChild(mainTabGroup);
  box.appendChild(header);

  // -------------------------------------------------------------------------
  // VIEW 1: CONTROLS VIEW (Gamepad SVG + Keyboard Diagram + Reference Table)
  // -------------------------------------------------------------------------
  const controlsView = document.createElement('div');
  controlsView.id = 'howto-view-controls';
  controlsView.style.cssText = 'display: flex; flex-direction: column; width: 100%;';

  // Sub-tab switcher: Gamepad vs Keyboard
  const subTabContainer = document.createElement('div');
  subTabContainer.style.cssText = 'display: flex; justify-content: center; margin-bottom: 12px;';
  const subTabGroup = document.createElement('div');
  subTabGroup.style.cssText = 'display: flex; gap: 6px; background: rgba(255,255,255,0.05); padding: 3px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);';

  const btnSubGamepad = document.createElement('button');
  btnSubGamepad.id = 'subtab-controls-gamepad';
  btnSubGamepad.textContent = '🎮 GAMEPAD';
  btnSubGamepad.style.cssText = `
    padding: 6px 14px; font-size: 11px; font-weight: 800; font-family: inherit;
    color: #000000; background: #ffffff; border: 1px solid #ffffff; border-radius: 4px; cursor: pointer;
  `;

  const btnSubKeyboard = document.createElement('button');
  btnSubKeyboard.id = 'subtab-controls-keyboard';
  btnSubKeyboard.textContent = '⌨️ KEYBOARD & MOUSE';
  btnSubKeyboard.style.cssText = `
    padding: 6px 14px; font-size: 11px; font-weight: 800; font-family: inherit;
    color: #94a3b8; background: transparent; border: 1px solid transparent; border-radius: 4px; cursor: pointer;
  `;

  subTabGroup.appendChild(btnSubGamepad);
  subTabGroup.appendChild(btnSubKeyboard);
  subTabContainer.appendChild(subTabGroup);
  controlsView.appendChild(subTabContainer);

  const diagramContainer = document.createElement('div');
  diagramContainer.style.cssText = 'display: flex; flex-direction: column; align-items: center; width: 100%; margin-bottom: 16px;';

  // 1A. GAMEPAD SVG SCHEMATIC
  const gamepadView = document.createElement('div');
  gamepadView.id = 'controls-view-gamepad';
  gamepadView.style.cssText = 'width: 100%; display: flex; justify-content: center;';
  gamepadView.innerHTML = `
    <svg viewBox="0 0 760 300" style="width: 100%; max-height: 280px; filter: drop-shadow(0 6px 20px rgba(0,0,0,0.6)); font-family: ui-monospace, SFMono-Regular, Consolas, monospace;">
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

      <!-- Face Buttons -->
      <circle cx="495" cy="120" r="12" fill="#1e293b" stroke="#f43f5e" stroke-width="2" filter="url(#glowRose)"/>
      <text x="495" y="124" fill="#f43f5e" font-size="11" font-weight="900" text-anchor="middle">Y</text>

      <circle cx="525" cy="150" r="12" fill="#1e293b" stroke="#38bdf8" stroke-width="2" filter="url(#glowCyan)"/>
      <text x="525" y="154" fill="#38bdf8" font-size="11" font-weight="900" text-anchor="middle">B</text>

      <circle cx="495" cy="180" r="12" fill="#1e293b" stroke="#10b981" stroke-width="2" filter="url(#glowGreen)"/>
      <text x="495" y="184" fill="#10b981" font-size="11" font-weight="900" text-anchor="middle">A</text>

      <circle cx="465" cy="150" r="12" fill="#1e293b" stroke="#a855f7" stroke-width="2"/>
      <text x="465" y="154" fill="#a855f7" font-size="11" font-weight="900" text-anchor="middle">X</text>

      <!-- CALLOUT POINTERS & LABELS (LEFT) -->
      <polyline points="220,70 140,45" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="25" y="32" width="115" height="24" rx="4" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" stroke-width="1"/>
      <text x="82" y="48" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">LT · SPRINT</text>

      <polyline points="348,125 310,35" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="220" y="22" width="150" height="24" rx="4" fill="rgba(245,158,11,0.15)" stroke="#f59e0b" stroke-width="1"/>
      <text x="295" y="38" fill="#fcd34d" font-size="10" font-weight="800" text-anchor="middle">SELECT · BALL RESET</text>

      <polyline points="237,155 125,145" fill="none" stroke="#10b981" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="10" y="133" width="115" height="24" rx="4" fill="rgba(16,185,129,0.15)" stroke="#10b981" stroke-width="1"/>
      <text x="67" y="149" fill="#6ee7b7" font-size="10" font-weight="800" text-anchor="middle">L-STICK · MOVE</text>

      <polyline points="312,195 140,225" fill="none" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="15" y="213" width="125" height="24" rx="4" fill="rgba(251,191,36,0.15)" stroke="#fbbf24" stroke-width="1"/>
      <text x="77" y="229" fill="#fde68a" font-size="10" font-weight="800" text-anchor="middle">D-PAD · CYCLE CAM</text>

      <!-- CALLOUT POINTERS & LABELS (RIGHT) -->
      <polyline points="540,70 620,45" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="620" y="32" width="115" height="24" rx="4" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" stroke-width="1"/>
      <text x="677" y="48" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">RT · SLIDE</text>

      <polyline points="412,125 450,35" fill="none" stroke="#f43f5e" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="390" y="22" width="140" height="24" rx="4" fill="rgba(244,63,94,0.15)" stroke="#f43f5e" stroke-width="1"/>
      <text x="460" y="38" fill="#fda4af" font-size="10" font-weight="800" text-anchor="middle">START · PAUSE</text>

      <polyline points="507,120 625,95" fill="none" stroke="#f43f5e" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="625" y="83" width="115" height="24" rx="4" fill="rgba(244,63,94,0.15)" stroke="#f43f5e" stroke-width="1"/>
      <text x="682" y="99" fill="#fda4af" font-size="10" font-weight="800" text-anchor="middle">Y · SPIKE</text>

      <polyline points="537,150 635,135" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="635" y="123" width="115" height="24" rx="4" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" stroke-width="1"/>
      <text x="692" y="139" fill="#bae6fd" font-size="10" font-weight="800" text-anchor="middle">B · VOLLEY</text>

      <polyline points="465,162 615,175" fill="none" stroke="#a855f7" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="615" y="163" width="115" height="24" rx="4" fill="rgba(168,85,247,0.15)" stroke="#a855f7" stroke-width="1"/>
      <text x="672" y="179" fill="#e9d5ff" font-size="10" font-weight="800" text-anchor="middle">X · DIVE</text>

      <polyline points="507,180 625,215" fill="none" stroke="#10b981" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="625" y="203" width="115" height="24" rx="4" fill="rgba(16,185,129,0.15)" stroke="#10b981" stroke-width="1"/>
      <text x="682" y="219" fill="#a7f3d0" font-size="10" font-weight="800" text-anchor="middle">A · JUMP</text>

      <polyline points="445,205 530,265" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="450" y="260" width="165" height="24" rx="4" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" stroke-width="1"/>
      <text x="532" y="276" fill="#7dd3fc" font-size="10" font-weight="800" text-anchor="middle">R-STICK · AIM / ORIENT</text>
    </svg>
  `;

  // 1B. KEYBOARD & MOUSE SCHEMATIC
  const keyboardView = document.createElement('div');
  keyboardView.id = 'controls-view-keyboard';
  keyboardView.style.cssText = 'width: 100%; display: none; flex-direction: column; align-items: center; gap: 14px; padding: 6px 0;';
  keyboardView.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 720px;">
      <!-- Row 1: Function Keys -->
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; gap: 8px;">
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 68px; height: 48px; background: #0f172a; border: 1px solid #ef4444; border-radius: 6px; box-shadow: 0 0 10px rgba(239,68,68,0.3);">
            <span style="color: #ffffff; font-weight: 900; font-size: 13px;">ESC</span>
            <span style="color: #ef4444; font-weight: 700; font-size: 9px;">PAUSE</span>
          </div>
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 68px; height: 48px; background: #0f172a; border: 1px solid #fbbf24; border-radius: 6px; box-shadow: 0 0 10px rgba(251,191,36,0.3);">
            <span style="color: #ffffff; font-weight: 900; font-size: 13px;">TAB</span>
            <span style="color: #fbbf24; font-weight: 700; font-size: 9px;">CAM CYCLE</span>
          </div>
        </div>
        <div style="font-size: 11px; font-weight: 700; color: #94a3b8; letter-spacing: 0.08em;">PRIMARY ATHLETE CONTROLS (P1)</div>
      </div>

      <!-- Row 2: Action Letters Row (Q, W, E, R) + Mouse Look/Strikes -->
      <div style="display: flex; gap: 10px; justify-content: center; align-items: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 58px; background: #0f172a; border: 1px solid #a855f7; border-radius: 8px; box-shadow: 0 0 12px rgba(168,85,247,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">Q</span>
          <span style="color: #c084fc; font-weight: 800; font-size: 9px;">DIVE</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 58px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">W</span>
          <span style="color: #34d399; font-weight: 800; font-size: 9px;">MOVE FWD</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 78px; height: 58px; background: #0f172a; border: 1px solid #38bdf8; border-radius: 8px; box-shadow: 0 0 12px rgba(56,189,248,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">E / L-CLICK</span>
          <span style="color: #7dd3fc; font-weight: 800; font-size: 8.5px;">VOLLEY</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 78px; height: 58px; background: #0f172a; border: 1px solid #f43f5e; border-radius: 8px; box-shadow: 0 0 12px rgba(244,63,94,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">R / R-CLICK</span>
          <span style="color: #fb7185; font-weight: 800; font-size: 8.5px;">SPIKE</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 120px; height: 58px; background: #0f172a; border: 1px solid #00e5ff; border-radius: 8px; box-shadow: 0 0 12px rgba(0,229,255,0.35);">
          <span style="color: #00e5ff; font-weight: 900; font-size: 13px;">🖱️ MOUSE LOOK</span>
          <span style="color: #94a3b8; font-weight: 700; font-size: 8.5px;">POINTER LOCK (CLICK)</span>
        </div>
      </div>

      <!-- Row 3: Movement (A, S, D) + Practice Reset (B) -->
      <div style="display: flex; gap: 10px; justify-content: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 58px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">A</span>
          <span style="color: #34d399; font-weight: 800; font-size: 9px;">MOVE LEFT</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 58px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">S</span>
          <span style="color: #34d399; font-weight: 800; font-size: 9px;">MOVE BACK</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 58px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">D</span>
          <span style="color: #34d399; font-weight: 800; font-size: 9px;">MOVE RIGHT</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 58px; background: #0f172a; border: 1px solid #f59e0b; border-radius: 8px; box-shadow: 0 0 12px rgba(245,158,11,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">B</span>
          <span style="color: #fcd34d; font-weight: 800; font-size: 9px;">RESET BALL</span>
        </div>
      </div>

      <!-- Row 4: Modifiers (Shift, C, Space) -->
      <div style="display: flex; gap: 10px; justify-content: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 95px; height: 50px; background: #0f172a; border: 1px solid #38bdf8; border-radius: 8px; box-shadow: 0 0 12px rgba(56,189,248,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 13px;">SHIFT</span>
          <span style="color: #7dd3fc; font-weight: 800; font-size: 8.5px;">SPRINT</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 50px; background: #0f172a; border: 1px solid #38bdf8; border-radius: 8px; box-shadow: 0 0 12px rgba(56,189,248,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 13px;">C</span>
          <span style="color: #7dd3fc; font-weight: 800; font-size: 8.5px;">SLIDE</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 200px; height: 50px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 14px;">SPACEBAR</span>
          <span style="color: #34d399; font-weight: 800; font-size: 9px;">JUMP (HOLD FOR HEIGHT)</span>
        </div>
      </div>

      <!-- Sub-notice for P2 -->
      <div style="text-align: center; font-size: 10.5px; color: #64748b; font-weight: 600; margin-top: 4px;">
        PLAYER 2 SECONDARY KEYBOARD: <span style="color: #94a3b8;">IJKL (Move) · Enter (Jump) · Slash (Sprint) · O (Slide) · U (Dive) · P (Volley) · Bracket [ (Spike)</span>
      </div>
    </div>
  `;

  diagramContainer.appendChild(gamepadView);
  diagramContainer.appendChild(keyboardView);
  controlsView.appendChild(diagramContainer);

  // Quick Reference Table Card
  const tableCard = document.createElement('div');
  tableCard.style.cssText = `
    display: flex; flex-direction: column; gap: 7px; background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 10px; padding: 12px 16px; font-size: 11.5px;
  `;

  const rows = [
    { action: 'Move Athlete', pad: 'Left Stick', key: 'WASD · (P2: IJKL)', color: '#10b981' },
    { action: 'Aim Strikes / Look', pad: 'Right Stick', key: 'Mouse Movement · Arrow Keys', color: '#38bdf8' },
    { action: 'Sprint Boost', pad: 'Left Trigger (LT)', key: 'Shift · (P2: Slash /)', color: '#38bdf8' },
    { action: 'Slide Tackle (Hold)', pad: 'Right Trigger (RT)', key: 'C · (P2: O)', color: '#38bdf8' },
    { action: 'Jump (Hold for Height)', pad: 'A / Cross', key: 'Space · (P2: Enter)', color: '#10b981' },
    { action: 'Ground Dive', pad: 'X / Square', key: 'Q · (P2: U)', color: '#a855f7' },
    { action: 'Volley / Kick Strike', pad: 'B / Circle', key: 'Left-Click · E · (P2: P)', color: '#38bdf8' },
    { action: 'Spike Strike', pad: 'Y / Triangle', key: 'Right-Click · R · (P2: Bracket [)', color: '#f43f5e' },
    { action: 'Reset Ball (Practice)', pad: 'Select / Back / View', key: 'B · (P2: N)', color: '#f59e0b' },
    { action: 'Cycle Camera Angle', pad: 'D-Pad', key: 'Tab · (P2: Backslash \\)', color: '#fbbf24' },
    { action: 'Pause Menu / Settings', pad: 'Start / Options', key: 'Escape', color: '#ef4444' },
  ];

  rows.forEach((r, idx) => {
    const rowEl = document.createElement('div');
    rowEl.style.cssText = `
      display: flex; justify-content: space-between; align-items: center; padding-bottom: 5px;
      ${idx < rows.length - 1 ? 'border-bottom: 1px solid rgba(255, 255, 255, 0.05);' : ''}
    `;
    rowEl.innerHTML = `
      <span style="color: #cbd5e1; font-weight: 700; display: flex; align-items: center; gap: 8px;">
        <span style="width: 7px; height: 7px; border-radius: 50%; background: ${r.color}; box-shadow: 0 0 6px ${r.color};"></span>
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
  controlsView.appendChild(tableCard);
  box.appendChild(controlsView);

  // Sub-tab switcher logic (Gamepad vs Keyboard)
  function setDeviceTab(device) {
    currentControlsDevice = device;
    if (device === 'gamepad') {
      btnSubGamepad.style.background = '#ffffff';
      btnSubGamepad.style.color = '#000000';
      btnSubGamepad.style.borderColor = '#ffffff';
      btnSubKeyboard.style.background = 'transparent';
      btnSubKeyboard.style.color = '#94a3b8';
      btnSubKeyboard.style.borderColor = 'transparent';
      gamepadView.style.display = 'flex';
      keyboardView.style.display = 'none';
    } else {
      btnSubKeyboard.style.background = '#ffffff';
      btnSubKeyboard.style.color = '#000000';
      btnSubKeyboard.style.borderColor = '#ffffff';
      btnSubGamepad.style.background = 'transparent';
      btnSubGamepad.style.color = '#94a3b8';
      btnSubGamepad.style.borderColor = 'transparent';
      gamepadView.style.display = 'none';
      keyboardView.style.display = 'flex';
    }
  }
  btnSubGamepad.onclick = () => setDeviceTab('gamepad');
  btnSubKeyboard.onclick = () => setDeviceTab('keyboard');

  // -------------------------------------------------------------------------
  // VIEW 2: MATCH BASICS VIEW
  // -------------------------------------------------------------------------
  const basicsView = document.createElement('div');
  basicsView.id = 'howto-view-basics';
  basicsView.style.cssText = 'display: none; flex-direction: column; gap: 16px; width: 100%;';
  basicsView.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
      <!-- Card 1: THE ARENA & COURT -->
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 10px; padding: 16px;">
        <div style="font-size: 13px; font-weight: 900; color: #38bdf8; letter-spacing: 0.08em; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
          <span>🏟️</span> THE COURT & ARENA
        </div>
        <div style="font-size: 11.5px; color: #cbd5e1; line-height: 1.6;">
          <p style="margin: 0 0 8px 0;"><strong style="color: #ffffff;">1v1 Sunken Basin:</strong> Two athletes face off across an open arena bordered by high concrete and glass perimeter walls.</p>
          <p style="margin: 0 0 8px 0;"><strong style="color: #ffffff;">The Goal Hoops:</strong> Steel goal hoops sit high on the North and South boundary walls. Driving the ball through the ring awards 1 point.</p>
          <p style="margin: 0;"><strong style="color: #ffffff;">Active Rebounds:</strong> Side ramps and glass backboards are 100% physically live. Rebound bank shots keep rallies moving!</p>
        </div>
      </div>

      <!-- Card 2: RULES & CLOCK -->
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 10px; padding: 16px;">
        <div style="font-size: 13px; font-weight: 900; color: #10b981; letter-spacing: 0.08em; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
          <span>⏱️</span> MATCH RULES & CLOCK
        </div>
        <div style="font-size: 11.5px; color: #cbd5e1; line-height: 1.6;">
          <p style="margin: 0 0 8px 0;"><strong style="color: #ffffff;">5-Minute Regulation:</strong> Standard matches run for 5:00 of live play clock action.</p>
          <p style="margin: 0 0 8px 0;"><strong style="color: #ffffff;">Alternating Targets:</strong> Scoring a goal immediately flips attack ends. You defend the goal just scored on!</p>
          <p style="margin: 0;"><strong style="color: #ffffff;">Golden Goal Overtime:</strong> If scores are level at 0:00, sudden death initiates: next goal wins the match!</p>
        </div>
      </div>
    </div>

    <!-- Full-Width Card: PHYSICAL COMBAT & KNOCKDOWNS -->
    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(244, 63, 94, 0.35); border-radius: 10px; padding: 16px;">
      <div style="font-size: 13px; font-weight: 900; color: #f43f5e; letter-spacing: 0.08em; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
        <span>💥</span> FULL-CONTACT COMBAT & KNOCKDOWNS
      </div>
      <div style="font-size: 11.5px; color: #cbd5e1; line-height: 1.6; display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div>
          <p style="margin: 0 0 6px 0;"><strong style="color: #ffffff;">Slide Tackles:</strong> Sliding at sprint speeds (> 7 m/s) into an opponent sweeps their legs, causing an instant ragdoll knockdown!</p>
          <p style="margin: 0;"><strong style="color: #ffffff;">Physical Bumps:</strong> Colliding with an opposing athlete generates physical momentum impulse and authentic sneaker squeak audio.</p>
        </div>
        <div>
          <p style="margin: 0 0 6px 0;"><strong style="color: #ffffff;">Strike Staggers:</strong> Connecting with a kick, volley, or spike while an opponent is in reach applies physical strike impulse.</p>
          <p style="margin: 0;"><strong style="color: #ffffff;">Heavy Ball Hits:</strong> High-speed projectile balls (> 14 m/s) will knock athletes off their feet if hit in the chest or head!</p>
        </div>
      </div>
    </div>
  `;
  box.appendChild(basicsView);

  // -------------------------------------------------------------------------
  // VIEW 3: SCORING & PRO TIPS VIEW
  // -------------------------------------------------------------------------
  const tipsView = document.createElement('div');
  tipsView.id = 'howto-view-tips';
  tipsView.style.cssText = 'display: none; flex-direction: column; gap: 12px; width: 100%;';
  tipsView.innerHTML = `
    <!-- Tip 1 -->
    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #10b981; border-radius: 8px; padding: 12px 16px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #34d399; margin-bottom: 3px;">1. HOW TO SCORE YOUR FIRST GOAL: VOLLEY THEN SPIKE</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        Don't just chase or run into the ball! Position yourself as the ball approaches. Press <strong style="color: #38bdf8;">Volley (Left-Click / E / B)</strong> to pop the ball upward in a high arc toward the opponent's side. Then, as it reaches its peak, jump and unleash a <strong style="color: #f43f5e;">Spike (Right-Click / R / Y)</strong> to blast it downward into the hoop or off the backboard into the goal!
      </div>
    </div>

    <!-- Tip 2 -->
    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #38bdf8; border-radius: 8px; padding: 12px 16px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #38bdf8; margin-bottom: 3px;">2. JUMP TIMING & SWEET-SPOT CONTACT</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        Strikes hit significantly harder when connected near the center of the strike window! Hold <strong style="color: #ffffff;">Spacebar / A</strong> to jump higher. An aerial spike angled down over the center court net has immense velocity and is nearly impossible for a grounded keeper to stop.
      </div>
    </div>

    <!-- Tip 3 -->
    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #f59e0b; border-radius: 8px; padding: 12px 16px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #fbbf24; margin-bottom: 3px;">3. BANK SHOTS OFF THE SIDE WALLS</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        If your opponent is camping directly in front of the goal hoop, aim at the 45-degree corner ramps or high side walls. The ball will rebound at high velocity across the goal mouth, bypassing the defender entirely.
      </div>
    </div>

    <!-- Tip 4 -->
    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #a855f7; border-radius: 8px; padding: 12px 16px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #c084fc; margin-bottom: 3px;">4. CLUTCH DIVING SAVES & RECOVERY</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        If a spiked ball is dropping fast toward the floor, press <strong style="color: #ffffff;">Q / X</strong> to perform a ground dive! An outstretched dive pops the ball back up into play for a second chance. If you get knocked down, your athlete automatically recovers and stands back up with active physics.
      </div>
    </div>

    <!-- Tip 5 -->
    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #ef4444; border-radius: 8px; padding: 12px 16px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #f87171; margin-bottom: 3px;">5. BALL SIZES & DIFFICULTY</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        • <strong style="color: #ffffff;">Small Ball (0.4m):</strong> Fast, twitchy, heavy physics momentum, hardest difficulty.<br>
        • <strong style="color: #ffffff;">Medium Ball (1.0m):</strong> Standard regulation match ball, balanced flight and bounces.<br>
        • <strong style="color: #ffffff;">Big Ball (1.5m):</strong> Enormous rebound area, easiest difficulty, great for high rallies!
      </div>
    </div>
  `;
  box.appendChild(tipsView);

  // -------------------------------------------------------------------------
  // Main Tab Navigation Logic
  // -------------------------------------------------------------------------
  function setHowToPlayTab(tab) {
    currentHowToPlayTab = tab;
    const tabBtns = [
      { id: 'controls', btn: btnTabControls, view: controlsView },
      { id: 'basics', btn: btnTabBasics, view: basicsView },
      { id: 'tips', btn: btnTabTips, view: tipsView },
    ];

    tabBtns.forEach((item) => {
      const isSel = item.id === tab;
      item.btn.style.background = isSel ? '#ffffff' : 'transparent';
      item.btn.style.borderColor = isSel ? '#ffffff' : 'transparent';
      item.btn.style.color = isSel ? '#000000' : '#94a3b8';
      item.btn.style.boxShadow = isSel ? '0 0 14px rgba(255, 255, 255, 0.45), 0 0 20px rgba(0, 229, 255, 0.25)' : 'none';
      item.view.style.display = isSel ? 'flex' : 'none';
    });
  }

  function cycleHowToPlayTab(direction = 1) {
    const idx = HOWTO_TABS.indexOf(currentHowToPlayTab);
    const nextIdx = (idx + direction + HOWTO_TABS.length) % HOWTO_TABS.length;
    setHowToPlayTab(HOWTO_TABS[nextIdx]);
  }

  btnTabControls.onclick = () => setHowToPlayTab('controls');
  btnTabBasics.onclick = () => setHowToPlayTab('basics');
  btnTabTips.onclick = () => setHowToPlayTab('tips');

  // Close Button
  const closeBtn = document.createElement('button');
  closeBtn.id = 'btn-close-controls';
  closeBtn.textContent = 'CLOSE [ESC / B / SPACE]';
  closeBtn.style.cssText = `
    margin-top: 16px; padding: 12px; font-size: 13px; font-weight: 900; font-family: inherit;
    letter-spacing: 0.1em; color: #ffffff; background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 8px; cursor: pointer; transition: all 0.15s ease;
  `;
  closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(255, 255, 255, 0.2)'; closeBtn.style.borderColor = '#ffffff'; };
  closeBtn.onmouseleave = () => { closeBtn.style.background = 'rgba(255, 255, 255, 0.1)'; closeBtn.style.borderColor = 'rgba(255, 255, 255, 0.25)'; };
  closeBtn.onclick = hideHowToPlayModal;
  box.appendChild(closeBtn);

  controlsModalEl.appendChild(box);
  rootEl.appendChild(controlsModalEl);

  controlsModalEl._setTab = setHowToPlayTab;
  controlsModalEl._setDevice = setDeviceTab;
  controlsModalEl._cycleTab = cycleHowToPlayTab;
}

export function showHowToPlayModal(tab = 'controls') {
  if (controlsModalEl) {
    controlsModalEl.style.display = 'flex';
    if (controlsModalEl._setTab) controlsModalEl._setTab(tab);
  }
}

export function hideHowToPlayModal() {
  if (controlsModalEl) controlsModalEl.style.display = 'none';
}

export const showControlsModal = showHowToPlayModal;
export const hideControlsModal = hideHowToPlayModal;
export const buildControlsModal = buildHowToPlayModal;

// ---------------------------------------------------------------------------
// 5. Main Menu Settings Modal (Decoupled from In-Game Pause)
// ---------------------------------------------------------------------------
export function buildMainMenuSettingsModal() {
  mainMenuSettingsModalEl = document.createElement('div');
  mainMenuSettingsModalEl.id = 'main-menu-settings-modal';
  mainMenuSettingsModalEl.style.cssText = `
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
    max-width: 580px;
    width: 92%;
    max-height: 88vh;
    overflow-y: auto;
    background: rgba(11, 17, 26, 0.98);
    border: 1px solid rgba(120, 170, 210, 0.35);
    border-radius: 14px;
    padding: 24px 32px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.9), 0 0 30px rgba(56, 189, 248, 0.15);
    font-family: inherit;
    color: #cfe3f5;
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid;
    border-image: linear-gradient(90deg, #ff2e55, #ff6b35, #fbb417, #4ade80, #00e5ff, #3b82f6, #a855f7) 1;
    padding-bottom: 12px;
    margin-bottom: 20px;
  `;
  header.innerHTML = `
    <div>
      <div style="font-size: 20px; font-weight: 900; letter-spacing: 0.1em; color: #ffffff;">SETTINGS</div>
      <div style="font-size: 11px; color: #94a3b8; font-weight: 700; letter-spacing: 0.08em; margin-top: 2px;">GLOBAL AUDIO, DISPLAY & CAMERA PREFERENCES</div>
    </div>
  `;
  box.appendChild(header);

  function createSectionHeader(title) {
    const el = document.createElement('div');
    el.style.cssText = 'font-size: 11px; font-weight: 800; letter-spacing: 0.12em; color: #38bdf8; margin: 12px 0 8px 0; text-transform: uppercase;';
    el.textContent = title;
    return el;
  }

  // 1. AUDIO SECTION
  box.appendChild(createSectionHeader('🔊 Audio Levels'));

  // Master Volume
  const masterRow = document.createElement('div');
  masterRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
  const masterLabel = document.createElement('span');
  masterLabel.style.cssText = 'font-size: 12px; font-weight: 700; color: #cbd5e1;';
  masterLabel.textContent = 'Master Volume';
  const masterVal = document.createElement('span');
  masterVal.style.cssText = 'font-size: 12px; font-weight: 800; color: #ffffff; min-width: 45px; text-align: right;';
  const masterSlider = document.createElement('input');
  masterSlider.type = 'range';
  masterSlider.min = '0';
  masterSlider.max = '100';
  masterSlider.value = String(Math.round((soundManager.getMasterVolume?.() ?? 0.8) * 100));
  masterVal.textContent = `${masterSlider.value}%`;
  masterSlider.style.cssText = 'flex: 1; margin: 0 16px; accent-color: #38bdf8; cursor: pointer;';
  masterSlider.oninput = (e) => {
    const val = Number(e.target.value) / 100;
    masterVal.textContent = `${e.target.value}%`;
    soundManager.setMasterVolume(val);
  };
  masterRow.appendChild(masterLabel);
  masterRow.appendChild(masterSlider);
  masterRow.appendChild(masterVal);
  box.appendChild(masterRow);

  // SFX Volume
  const sfxRow = document.createElement('div');
  sfxRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;';
  const sfxLabel = document.createElement('span');
  sfxLabel.style.cssText = 'font-size: 12px; font-weight: 700; color: #cbd5e1;';
  sfxLabel.textContent = 'SFX & Ball Audio';
  const sfxVal = document.createElement('span');
  sfxVal.style.cssText = 'font-size: 12px; font-weight: 800; color: #ffffff; min-width: 45px; text-align: right;';
  const sfxSlider = document.createElement('input');
  sfxSlider.type = 'range';
  sfxSlider.min = '0';
  sfxSlider.max = '100';
  sfxSlider.value = String(Math.round((soundManager.getSfxVolume?.() ?? 0.8) * 100));
  sfxVal.textContent = `${sfxSlider.value}%`;
  sfxSlider.style.cssText = 'flex: 1; margin: 0 16px; accent-color: #10b981; cursor: pointer;';
  sfxSlider.oninput = (e) => {
    const val = Number(e.target.value) / 100;
    sfxVal.textContent = `${e.target.value}%`;
    soundManager.setSfxVolume(val);
  };
  sfxRow.appendChild(sfxLabel);
  sfxRow.appendChild(sfxSlider);
  sfxRow.appendChild(sfxVal);
  box.appendChild(sfxRow);

  // 2. DISPLAY & GRAPHICS SECTION
  box.appendChild(createSectionHeader('🖥️ Display & Graphics'));

  // Stadium Shadows
  const shadowRow = document.createElement('div');
  shadowRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
  const shadowLabel = document.createElement('span');
  shadowLabel.style.cssText = 'font-size: 12px; font-weight: 700; color: #cbd5e1;';
  shadowLabel.textContent = 'Stadium Shadows';
  const shadowGroup = document.createElement('div');
  shadowGroup.style.cssText = 'display: flex; gap: 6px;';
  const shadowOpts = [
    { id: 'off', label: 'Off' },
    { id: 'balanced', label: 'Balanced' },
    { id: 'high', label: 'High (4 Towers)' },
  ];
  const shadowBtns = [];
  shadowOpts.forEach((opt) => {
    const b = document.createElement('button');
    b.textContent = opt.label;
    const isSel = (TUNING.render?.shadowQuality || 'high') === opt.id;
    b.style.cssText = `
      padding: 6px 12px; font-size: 11px; font-weight: 700; font-family: inherit;
      border-radius: 4px; cursor: pointer; border: 1px solid rgba(120, 170, 210, 0.3); transition: all 0.12s ease;
      background: ${isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.06)'};
      color: ${isSel ? '#ffffff' : '#94a3b8'};
    `;
    b.onclick = () => {
      if (!TUNING.render) TUNING.render = {};
      TUNING.render.shadowQuality = opt.id;
      shadowBtns.forEach((btn, idx) => {
        const s = shadowOpts[idx].id === opt.id;
        btn.style.background = s ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
        btn.style.color = s ? '#ffffff' : '#94a3b8';
      });
      if (callbacks.onRenderSettingsChange) callbacks.onRenderSettingsChange({ shadowQuality: opt.id });
      else if (window.__vb?.applyRenderSettings) window.__vb.applyRenderSettings({ shadowQuality: opt.id });
    };
    shadowBtns.push(b);
    shadowGroup.appendChild(b);
  });
  shadowRow.appendChild(shadowLabel);
  shadowRow.appendChild(shadowGroup);
  box.appendChild(shadowRow);

  // Controls Overlay (HUD)
  const overlayRow = document.createElement('div');
  overlayRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;';
  const overlayLabel = document.createElement('span');
  overlayLabel.style.cssText = 'font-size: 12px; font-weight: 700; color: #cbd5e1;';
  overlayLabel.textContent = 'Controls Overlay (HUD)';
  const overlayGroup = document.createElement('div');
  overlayGroup.style.cssText = 'display: flex; gap: 6px;';
  const overlayOpts = [
    { id: false, label: 'Hidden (Default)' },
    { id: true, label: 'Visible' },
  ];
  const overlayBtns = [];
  overlayOpts.forEach((opt) => {
    const b = document.createElement('button');
    b.textContent = opt.label;
    const isSel = (opt.id === false);
    b.style.cssText = `
      padding: 6px 14px; font-size: 11px; font-weight: 700; font-family: inherit;
      border-radius: 4px; cursor: pointer; border: 1px solid rgba(120, 170, 210, 0.3); transition: all 0.12s ease;
      background: ${isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.06)'};
      color: ${isSel ? '#ffffff' : '#94a3b8'};
    `;
    b.onclick = () => {
      overlayBtns.forEach((btn, idx) => {
        const s = overlayOpts[idx].id === opt.id;
        btn.style.background = s ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
        btn.style.color = s ? '#ffffff' : '#94a3b8';
      });
      if (callbacks.onRenderSettingsChange) callbacks.onRenderSettingsChange({ showControlsOverlay: opt.id });
      else if (window.__vb?.applyRenderSettings) window.__vb.applyRenderSettings({ showControlsOverlay: opt.id });
    };
    overlayBtns.push(b);
    overlayGroup.appendChild(b);
  });
  overlayRow.appendChild(overlayLabel);
  overlayRow.appendChild(overlayGroup);
  box.appendChild(overlayRow);

  // 3. CAMERA & CONTROLS SECTION
  box.appendChild(createSectionHeader('🎥 Camera Angle'));

  const camRow = document.createElement('div');
  camRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;';
  const camLabel = document.createElement('span');
  camLabel.style.cssText = 'font-size: 12px; font-weight: 700; color: #cbd5e1;';
  camLabel.textContent = 'Default Camera Mode';
  const camSelect = document.createElement('select');
  camSelect.style.cssText = `
    padding: 6px 12px; font-size: 11px; font-weight: 700; font-family: inherit;
    color: #ffffff; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 5px; cursor: pointer;
  `;
  CAMERA_OPTIONS.forEach((opt) => {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    o.style.background = '#0b111a';
    if (opt.id === (playerConfigs[0]?.cameraMode || 'chase')) o.selected = true;
    camSelect.appendChild(o);
  });
  camSelect.onchange = (e) => {
    const val = e.target.value;
    playerConfigs[0].cameraMode = val;
    TUNING.camera.mode = val;
    if (window.__vb?.setPlayerConfig) window.__vb.setPlayerConfig(0, { cameraMode: val });
  };
  camRow.appendChild(camLabel);
  camRow.appendChild(camSelect);
  box.appendChild(camRow);

  // Close Button
  const closeBtn = document.createElement('button');
  closeBtn.id = 'btn-close-main-menu-settings';
  closeBtn.textContent = 'BACK / CLOSE [ESC / B]';
  closeBtn.style.cssText = `
    margin-top: 8px; padding: 12px; font-size: 13px; font-weight: 900; font-family: inherit;
    letter-spacing: 0.1em; color: #ffffff; background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 8px; cursor: pointer; transition: all 0.15s ease;
  `;
  closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(255, 255, 255, 0.2)'; closeBtn.style.borderColor = '#ffffff'; };
  closeBtn.onmouseleave = () => { closeBtn.style.background = 'rgba(255, 255, 255, 0.1)'; closeBtn.style.borderColor = 'rgba(255, 255, 255, 0.25)'; };
  closeBtn.onclick = hideMainMenuSettingsModal;
  box.appendChild(closeBtn);

  mainMenuSettingsModalEl.appendChild(box);
  rootEl.appendChild(mainMenuSettingsModalEl);
}

export function showMainMenuSettingsModal() {
  if (mainMenuSettingsModalEl) {
    mainMenuSettingsModalEl.style.display = 'flex';
  }
}

export function hideMainMenuSettingsModal() {
  if (mainMenuSettingsModalEl) {
    mainMenuSettingsModalEl.style.display = 'none';
  }
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

    // 0.5 Settings Modal Open (Main Menu)
    if (mainMenuSettingsModalEl && mainMenuSettingsModalEl.style.display === 'flex') {
      if (e.code === 'Escape' || e.code === 'Backspace') {
        e.preventDefault();
        hideMainMenuSettingsModal();
        return;
      }
      return;
    }

    // 1. How To Play Modal Open
    if (controlsModalEl && controlsModalEl.style.display === 'flex') {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        controlsModalEl._cycleTab?.(-1);
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        controlsModalEl._cycleTab?.(1);
        return;
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        controlsModalEl._cycleTab?.(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        hideHowToPlayModal();
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

    // --- CASE A: PRACTICE MODE ---
    if (currentSetupMode === 'practice') {
      if (e.code === 'Escape') {
        e.preventDefault();
        showTitleScreen();
        return;
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        playerFocusRow[0] = Math.max(1, playerFocusRow[0] - 1);
        updateFocusUI();
        return;
      }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        playerFocusRow[0] = Math.min(6, playerFocusRow[0] + 1);
        updateFocusUI();
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        if (playerFocusRow[0] === 5) {
          cycleMatchBall(-1);
        } else if (playerFocusRow[0] >= 1 && playerFocusRow[0] <= 4) {
          cycleOption(0, playerFocusRow[0], -1);
        }
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        if (playerFocusRow[0] === 5) {
          cycleMatchBall(1);
        } else if (playerFocusRow[0] >= 1 && playerFocusRow[0] <= 4) {
          cycleOption(0, playerFocusRow[0], 1);
        }
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (playerFocusRow[0] === 6) {
          launchMatchNow();
        } else if (playerFocusRow[0] === 5) {
          cycleMatchBall(1);
        } else if (playerFocusRow[0] >= 1 && playerFocusRow[0] <= 4) {
          cycleOption(0, playerFocusRow[0], 1);
        }
        return;
      }
      return;
    }

    // --- CASE B: MATCH MODE SCREEN 2 (MATCH RULES) ---
    if (setupPage === 2) {
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
        setupPage = 1;
        window._updateSetupPage();
        soundManager.playTone(330, 0.08, 'sine', 0.15);
        return;
      }

      if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'KeyI') {
        e.preventDefault();
        matchRulesFocusRow = Math.max(0, matchRulesFocusRow - 1);
        updateFocusUI();
        return;
      }
      if (e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'KeyK') {
        e.preventDefault();
        matchRulesFocusRow = Math.min(4, matchRulesFocusRow + 1);
        updateFocusUI();
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'KeyJ') {
        e.preventDefault();
        if (matchRulesFocusRow === 0) cycleMatchBall(-1);
        else if (matchRulesFocusRow === 1) cycleMatchDuration(-1);
        else if (matchRulesFocusRow === 2) cycleArena(-1);
        else if (matchRulesFocusRow === 3) {
          focusedColumn = 0;
          updateFocusUI();
        }
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'KeyL') {
        e.preventDefault();
        if (matchRulesFocusRow === 0) cycleMatchBall(1);
        else if (matchRulesFocusRow === 1) cycleMatchDuration(1);
        else if (matchRulesFocusRow === 2) cycleArena(1);
        else if (matchRulesFocusRow === 3) {
          focusedColumn = 1;
          updateFocusUI();
        }
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (matchCountdownActive) {
          launchMatchNow();
          return;
        }
        if (matchRulesFocusRow === 0) {
          cycleMatchBall(1);
        } else if (matchRulesFocusRow === 1) {
          cycleMatchDuration(1);
        } else if (matchRulesFocusRow === 2) {
          cycleArena(1);
        } else if (matchRulesFocusRow === 3) {
          const targetSlot = (e.code === 'Space') ? 0 : (focusedColumn || 0);
          togglePlayerReady(targetSlot);
        } else if (matchRulesFocusRow === 4) {
          if (!btnStartMatch?.disabled) {
            btnStartMatch?.click();
          }
        }
        return;
      }
      return;
    }

    // --- CASE C: MATCH MODE SCREEN 1 (PLAYER & TEAM SETUP) ---
    if (e.code === 'Escape') {
      e.preventDefault();
      showTitleScreen();
      return;
    }

    if (e.code === 'Tab') {
      e.preventDefault();
      focusedColumn = 1 - focusedColumn;
      soundManager.playTone(440, 0.06, 'sine', 0.2);
      updateFocusUI();
      return;
    }

    // Unified Arrow Keys navigation
    if (e.code === 'ArrowUp') {
      e.preventDefault();
      playerFocusRow[focusedColumn] = Math.max(0, playerFocusRow[focusedColumn] - 1);
      updateFocusUI();
      return;
    }
    if (e.code === 'ArrowDown') {
      e.preventDefault();
      playerFocusRow[focusedColumn] = Math.min(5, playerFocusRow[focusedColumn] + 1);
      updateFocusUI();
      return;
    }
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      cycleOption(focusedColumn, playerFocusRow[focusedColumn], -1);
      return;
    }
    if (e.code === 'ArrowRight') {
      e.preventDefault();
      cycleOption(focusedColumn, playerFocusRow[focusedColumn], 1);
      return;
    }

    // Player 1 Keyboard Controls (WASD navigation, Space action)
    if (e.code === 'KeyW') {
      e.preventDefault();
      focusedColumn = 0;
      playerFocusRow[0] = Math.max(0, playerFocusRow[0] - 1);
      updateFocusUI();
      return;
    }
    if (e.code === 'KeyS') {
      e.preventDefault();
      focusedColumn = 0;
      playerFocusRow[0] = Math.min(5, playerFocusRow[0] + 1);
      updateFocusUI();
      return;
    }
    if (e.code === 'KeyA') {
      e.preventDefault();
      focusedColumn = 0;
      cycleOption(0, playerFocusRow[0], -1);
      return;
    }
    if (e.code === 'KeyD') {
      e.preventDefault();
      focusedColumn = 0;
      cycleOption(0, playerFocusRow[0], 1);
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (playerFocusRow[0] === 5) {
        setupPage = 2;
        window._updateSetupPage();
      } else {
        cycleOption(0, playerFocusRow[0], 1);
      }
      return;
    }

    // Player 2 Keyboard Controls (IJKL navigation, Enter action)
    if (e.code === 'KeyI') {
      e.preventDefault();
      focusedColumn = 1;
      playerFocusRow[1] = Math.max(0, playerFocusRow[1] - 1);
      updateFocusUI();
      return;
    }
    if (e.code === 'KeyK') {
      e.preventDefault();
      focusedColumn = 1;
      playerFocusRow[1] = Math.min(5, playerFocusRow[1] + 1);
      updateFocusUI();
      return;
    }
    if (e.code === 'KeyJ') {
      e.preventDefault();
      focusedColumn = 1;
      cycleOption(1, playerFocusRow[1], -1);
      return;
    }
    if (e.code === 'KeyL') {
      e.preventDefault();
      focusedColumn = 1;
      cycleOption(1, playerFocusRow[1], 1);
      return;
    }
    if (e.code === 'Enter') {
      e.preventDefault();
      const targetIdx = focusedColumn;
      if (playerFocusRow[targetIdx] === 5) {
        setupPage = 2;
        window._updateSetupPage();
      } else {
        cycleOption(targetIdx, playerFocusRow[targetIdx], 1);
      }
      return;
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

    // 0. Settings Modal Active (Main Menu) -> B / Back closes
    if (mainMenuSettingsModalEl && mainMenuSettingsModalEl.style.display === 'flex') {
      for (const pad of pads) {
        if (!pad) continue;
        const btnB = pad.buttons[1]?.pressed || false;
        const btnBack = pad.buttons[8]?.pressed || false;
        const p = titlePrevPads[0];
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
          controlsModalEl._cycleTab?.(-1);
        } else if ((btnRB && !p.rb) || (right && !p.right)) {
          controlsModalEl._cycleTab?.(1);
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
          playerFocusRow[0] = Math.max(1, playerFocusRow[0] - 1);
          updateFocusUI();
        }
        if (down && !prev.down) {
          playerFocusRow[0] = Math.min(6, playerFocusRow[0] + 1);
          updateFocusUI();
        }

        if (left && !prev.left) {
          if (playerFocusRow[0] === 5) cycleMatchBall(-1);
          else if (playerFocusRow[0] >= 1 && playerFocusRow[0] <= 4) cycleOption(0, playerFocusRow[0], -1);
        }
        if (right && !prev.right) {
          if (playerFocusRow[0] === 5) cycleMatchBall(1);
          else if (playerFocusRow[0] >= 1 && playerFocusRow[0] <= 4) cycleOption(0, playerFocusRow[0], 1);
        }

        if (btnLB && !prev.lb) cycleMatchBall(-1);
        if (btnRB && !prev.rb) cycleMatchBall(1);

        if (btnA && !prev.a) {
          if (playerFocusRow[0] === 6) {
            launchMatchNow();
          } else if (playerFocusRow[0] === 5) {
            cycleMatchBall(1);
          } else if (playerFocusRow[0] >= 1 && playerFocusRow[0] <= 4) {
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

    // --- MATCH MODE SCREEN 2 (MATCH RULES) ---
    if (setupPage === 2) {
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
          matchRulesFocusRow = Math.max(0, matchRulesFocusRow - 1);
          updateFocusUI();
        }
        if (down && !prev.down) {
          matchRulesFocusRow = Math.min(4, matchRulesFocusRow + 1);
          updateFocusUI();
        }

        if (left && !prev.left) {
          if (matchRulesFocusRow === 0) cycleMatchBall(-1);
          else if (matchRulesFocusRow === 1) cycleMatchDuration(-1);
          else if (matchRulesFocusRow === 2) cycleArena(-1);
          else if (matchRulesFocusRow === 3) { focusedColumn = 0; updateFocusUI(); }
          else if (matchRulesFocusRow === 4) { matchRulesFocusRow = 3; updateFocusUI(); }
        }
        if (right && !prev.right) {
          if (matchRulesFocusRow === 0) cycleMatchBall(1);
          else if (matchRulesFocusRow === 1) cycleMatchDuration(1);
          else if (matchRulesFocusRow === 2) cycleArena(1);
          else if (matchRulesFocusRow === 3) { focusedColumn = 1; updateFocusUI(); }
          else if (matchRulesFocusRow === 4) { matchRulesFocusRow = 4; updateFocusUI(); }
        }

        if (btnLB && !prev.lb) {
          if (matchRulesFocusRow === 0) cycleMatchBall(-1);
          else if (matchRulesFocusRow === 1) cycleMatchDuration(-1);
          else if (matchRulesFocusRow === 2) cycleArena(-1);
          else if (matchRulesFocusRow === 3) { focusedColumn = 0; updateFocusUI(); }
        }
        if (btnRB && !prev.rb) {
          if (matchRulesFocusRow === 0) cycleMatchBall(1);
          else if (matchRulesFocusRow === 1) cycleMatchDuration(1);
          else if (matchRulesFocusRow === 2) cycleArena(1);
          else if (matchRulesFocusRow === 3) { focusedColumn = 1; updateFocusUI(); }
        }

        if (btnA && !prev.a) {
          if (matchCountdownActive) {
            launchMatchNow();
          } else if (matchRulesFocusRow === 0) {
            cycleMatchBall(1);
          } else if (matchRulesFocusRow === 1) {
            cycleMatchDuration(1);
          } else if (matchRulesFocusRow === 2) {
            cycleArena(1);
          } else if (matchRulesFocusRow === 3) {
            togglePlayerReady(focusedColumn);
          } else if (matchRulesFocusRow === 4) {
            if (!btnStartMatch?.disabled) btnStartMatch?.click();
          }
        }

        if ((btnB && !prev.b) || (btnBack && !prev.back)) {
          if (matchCountdownActive) {
            cancelMatchCountdown();
            playerReadyState[0] = false;
            playerReadyState[1] = false;
            soundManager.playTone(330, 0.12, 'sine', 0.2);
            updateReadyUI();
          } else {
            setupPage = 1;
            window._updateSetupPage();
            soundManager.playTone(330, 0.08, 'sine', 0.15);
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
          matchRulesFocusRow = Math.max(0, matchRulesFocusRow - 1);
          updateFocusUI();
        }
        if (down && !prev.down) {
          matchRulesFocusRow = Math.min(4, matchRulesFocusRow + 1);
          updateFocusUI();
        }

        if (left && !prev.left) {
          if (matchRulesFocusRow === 0) cycleMatchBall(-1);
          else if (matchRulesFocusRow === 1) cycleMatchDuration(-1);
          else if (matchRulesFocusRow === 2) cycleArena(-1);
          else if (matchRulesFocusRow === 3) { focusedColumn = 0; updateFocusUI(); }
        }
        if (right && !prev.right) {
          if (matchRulesFocusRow === 0) cycleMatchBall(1);
          else if (matchRulesFocusRow === 1) cycleMatchDuration(1);
          else if (matchRulesFocusRow === 2) cycleArena(1);
          else if (matchRulesFocusRow === 3) { focusedColumn = 1; updateFocusUI(); }
        }

        if (btnLB && !prev.lb) {
          if (matchRulesFocusRow === 0) cycleMatchBall(-1);
          else if (matchRulesFocusRow === 1) cycleMatchDuration(-1);
          else if (matchRulesFocusRow === 2) cycleArena(-1);
        }
        if (btnRB && !prev.rb) {
          if (matchRulesFocusRow === 0) cycleMatchBall(1);
          else if (matchRulesFocusRow === 1) cycleMatchDuration(1);
          else if (matchRulesFocusRow === 2) cycleArena(1);
        }

        if (btnA && !prev.a) {
          if (matchCountdownActive) {
            launchMatchNow();
          } else if (matchRulesFocusRow === 0) {
            cycleMatchBall(1);
          } else if (matchRulesFocusRow === 1) {
            cycleMatchDuration(1);
          } else if (matchRulesFocusRow === 2) {
            cycleArena(1);
          } else if (matchRulesFocusRow === 3) {
            togglePlayerReady(playerIdx);
          } else if (matchRulesFocusRow === 4) {
            if (!btnStartMatch?.disabled) btnStartMatch?.click();
          }
        }

        if ((btnB && !prev.b) || (btnBack && !prev.back)) {
          if (matchCountdownActive) {
            cancelMatchCountdown();
            playerReadyState[0] = false;
            playerReadyState[1] = false;
            soundManager.playTone(330, 0.12, 'sine', 0.2);
            updateReadyUI();
          } else {
            setupPage = 1;
            window._updateSetupPage();
            soundManager.playTone(330, 0.08, 'sine', 0.15);
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
        playerFocusRow[focusedColumn] = Math.max(0, playerFocusRow[focusedColumn] - 1);
        updateFocusUI();
      }
      if (down && !prev.down) {
        playerFocusRow[focusedColumn] = Math.min(5, playerFocusRow[focusedColumn] + 1);
        updateFocusUI();
      }

      if (left && !prev.left) {
        cycleOption(focusedColumn, playerFocusRow[focusedColumn], -1);
      }
      if (right && !prev.right) {
        cycleOption(focusedColumn, playerFocusRow[focusedColumn], 1);
      }

      if (btnLB && !prev.lb) {
        focusedColumn = 1 - focusedColumn;
        soundManager.playTone(440, 0.06, 'sine', 0.2);
        updateFocusUI();
      }
      if (btnRB && !prev.rb) {
        focusedColumn = 1 - focusedColumn;
        soundManager.playTone(440, 0.06, 'sine', 0.2);
        updateFocusUI();
      }

      if (btnA && !prev.a) {
        if (playerFocusRow[focusedColumn] === 5) {
          setupPage = 2;
          window._updateSetupPage();
        } else {
          cycleOption(focusedColumn, playerFocusRow[focusedColumn], 1);
        }
      }

      if ((btnB && !prev.b) || (btnBack && !prev.back)) {
        showTitleScreen();
        return;
      }

      if (btnStart && !prev.start) {
        setupPage = 2;
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
        playerFocusRow[playerIdx] = Math.max(0, playerFocusRow[playerIdx] - 1);
        updateFocusUI();
      }
      if (down && !prev.down) {
        playerFocusRow[playerIdx] = Math.min(5, playerFocusRow[playerIdx] + 1);
        updateFocusUI();
      }

      if (left && !prev.left) {
        cycleOption(playerIdx, playerFocusRow[playerIdx], -1);
      }
      if (right && !prev.right) {
        cycleOption(playerIdx, playerFocusRow[playerIdx], 1);
      }

      if (btnA && !prev.a) {
        if (playerFocusRow[playerIdx] === 5) {
          setupPage = 2;
          window._updateSetupPage();
        } else {
          cycleOption(playerIdx, playerFocusRow[playerIdx], 1);
        }
      }

      if ((btnB && !prev.b) || (btnBack && !prev.back)) {
        showTitleScreen();
        return;
      }

      if (btnStart && !prev.start) {
        setupPage = 2;
        window._updateSetupPage();
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
  hideMainMenuSettingsModal();
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
  setupPage = 1;
  matchRulesFocusRow = 0;
  focusedColumn = 0;
  playerReadyState = [false, false];
  playerFocusRow = (mode === 'practice') ? [1, 0] : [0, 0];
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
  if (rootEl) rootEl.style.pointerEvents = 'none';
}

export function hideMainMenu() {
  stopSetupGamepadPolling();
  titleBrandBall?.stop();
  hideHowToPlayModal();
  hideMainMenuSettingsModal();
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

