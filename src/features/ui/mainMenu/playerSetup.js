/**
 * Module: features/ui/mainMenu/playerSetup
 * Role: Two-page Player & Team Setup and Match Rules / Practice Sandbox configuration screen.
 * Frame Phase: UI Event / Polling
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Shares `state.playerConfigs` (4-slot array) with Controller Assignment and main orchestrator.
 */

import {
  getControllerAssignments,
  getExplicitDeviceMappings,
  assignDefaultDeviceForSlot,
  clearDeviceMappingForSlot,
  assignPadToSlot,
  getAssignedSlotForPad,
} from '../../../input/inputRouter.js';
import { soundManager } from '../../../audio/soundManager.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import {
  PALETTE_SWATCHES,
  getColorName,
  HEADWEAR_OPTIONS,
  PHYSIQUE_OPTIONS,
  CAMERA_OPTIONS,
  MATCH_BALL_OPTIONS,
  MATCH_DURATION_OPTIONS,
  ARENA_OPTIONS,
  ASSIST_OPTIONS,
  getPlayerSlotTheme,
  renderCardinalDiamondSvg,
  renderViewportBadgeHtml,
} from './constants.js';
import { getCanonHeadwearIdForColorName } from '../../../config/cosmetics.js';

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
  hidePlayerSetup: null,
  showControllerAssignment: null,
};

export function setPlayerSetupCallbacks(cbs = {}, navs = {}) {
  Object.assign(callbacks, cbs);
  Object.assign(navActions, navs);
}


// Shared 4-slot player configuration array owned by state.js
const playerConfigs = state.playerConfigs;

let currentSetupMode = 'match';
let matchFormat = '1v1';

export function getMatchFormat() { return matchFormat; }
export function setMatchFormat(val) { matchFormat = val === '2v2' ? '2v2' : '1v1'; }
export function getActiveMatchPlayerCount() {
  if (currentSetupMode === 'practice') return 1;
  return matchFormat === '2v2' ? 4 : 2;
}
function getActivePlayerIndices() {
  const count = getActiveMatchPlayerCount();
  const res = [];
  for (let i = 0; i < count; i++) res.push(i);
  return res;
}

let setupPage = 1;
let currentBallOptions = MATCH_BALL_OPTIONS;
let selectedMatchBall = 'random';
let selectedMatchDuration = 300;
let selectedMatchArena = 'court';
let matchBallCards = [];
let matchDurationButtons = [];
let arenaButtons = [];
let matchRulesBoxEl = null;
let matchRulesFocusRow = 0; // 0: ball, 1: duration, 2: arena, 3: action bar (back, ready p1..p4, start)
let matchRulesActionCol = 2; // 0: back, 1: ready p1, 2: start match, 3: ready p2
let screen1ActionCol = 1; // 0: back, 1: next
let practiceActionCol = 1; // 0: back, 1: start drill

let lobbyTitleEl = null;
let lobbySubtitleEl = null;
let lobbyBadgeEl = null;
let columnsBoxEl = null;
let teamGroup1El = null;
let teamGroup2El = null;
let previewWindowEl = null;
let team1PlayersGridEl = null;
let team2PlayersGridEl = null;
const teamHeaderTitleEls = [null, null];
const teamHeaderCardEls = [null, null];
let col1El = null;
let col2El = null;
let col3El = null;
let col4El = null;
const colEls = [null, null, null, null];
let col1HeaderLabelEl = null;
let matchBallCardsRowEl = null;
let matchBallHeaderTitleEl = null;
let matchBallHeaderDescEl = null;

let playerTypeButtons = [[], [], [], []];
let playerTeamButtons = [[], [], [], []];
let playerSwatchButtons = [[], [], [], []];
let playerPhysiqueButtons = [[], [], [], []];
const playerHeadwearLabelEls = [null, null, null, null];
const playerCameraLabelEls = [null, null, null, null];
const playerCameraDotsEls = [[], [], [], []];
const colSubEls = [null, null, null, null];
let setupLegendEl = null;
let playerCameraSelects = [null, null, null, null];
let playerAssistButtons = [[], [], [], []];
let playerAssistDescEls = [null, null, null, null];
let playerReadyButtons = [null, null, null, null];
let playerInputBadges = [null, null, null, null];
let playerViewportBadges = [null, null, null, null];
let playerRowElements = [[], [], [], []];
let playerFocusRow = [0, 0, 0, 0];
let focusedColumn = 0; // 0..3 for active player column (used for shared-cursor lobbies)
let btnStartMatch = null;
let btnNext = null;
let btnBack = null;
let btnReadyP1 = null;
let btnReadyP2 = null;
let btnReadyP3 = null;
let btnReadyP4 = null;
let playerReadyState = [false, false, false, false];
let matchCountdownInterval = null;
let matchCountdownSecs = 0;
let matchCountdownActive = false;
let readyBannerEls = [null, null, null, null];
let ctrlTagEls = [null, null, null, null];

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

    #main-menu-root,
    #main-menu-root *,
    #main-menu-root *::before,
    #main-menu-root *::after {
      box-sizing: border-box;
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
    justify-content: flex-end;
    padding: 10px 18px 12px 18px;
    box-sizing: border-box;
    background: linear-gradient(180deg, rgba(4, 7, 12, 0.0) 0%, rgba(4, 7, 12, 0.06) 55%, rgba(4, 7, 12, 0.52) 100%);
    pointer-events: auto;
  `;

  const container = document.createElement('div');
  container.id = 'player-setup-container';
  playerSetupContainerEl = container;
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 8px;
    max-width: 1860px;
    width: 100%;
    height: 100%;
    max-height: 100vh;
    overflow: visible;
    box-sizing: border-box;
    background: transparent;
    border: none;
    border-radius: 14px;
    box-shadow: none;
    padding: 0;
  `;

  // Header Info Block (mounted inside the Bottom Command Dock so it never clogs the center)
  const headerWrap = document.createElement('div');
  headerWrap.id = 'setup-header-info';
  headerWrap.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 0 1 auto;
    max-width: 44%;
    min-width: 0;
    box-sizing: border-box;
  `;

  const title = document.createElement('div');
  title.style.cssText = 'min-width: 0;';
  lobbyTitleEl = document.createElement('div');
  lobbyTitleEl.style.cssText = 'font-size: 14px; font-weight: 900; letter-spacing: 0.09em; color: #ffffff; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
  lobbyTitleEl.textContent = 'MATCH LOBBY / SETUP';

  lobbySubtitleEl = document.createElement('div');
  lobbySubtitleEl.style.cssText = 'font-size: 9.5px; color: #94a3b8; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
  lobbySubtitleEl.textContent = 'Configure Collective Teams and Individual Athletes — 3D stage live in center';

  title.appendChild(lobbyTitleEl);
  title.appendChild(lobbySubtitleEl);

  lobbyBadgeEl = document.createElement('div');
  lobbyBadgeEl.textContent = '1v1 VERSUS · 5:00 DURATION';
  lobbyBadgeEl.style.cssText = `
    font-size: 10px;
    font-weight: 800;
    padding: 4px 9px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 6px;
    color: #ffffff;
    letter-spacing: 0.06em;
    white-space: nowrap;
    flex-shrink: 0;
    box-shadow: 0 0 12px rgba(255, 255, 255, 0.18), 0 0 16px rgba(0, 229, 255, 0.12);
  `;

  headerWrap.appendChild(title);
  headerWrap.appendChild(lobbyBadgeEl);

  // 3-Zone Setup Grid: Left (Team 1 Panel) | Center (Open 3D Preview Stage) | Right (Team 2 Panel)
  columnsBoxEl = document.createElement('div');
  columnsBoxEl.id = 'player-setup-columns-box';
  columnsBoxEl.style.cssText = 'display: grid; grid-template-columns: minmax(300px, 390px) minmax(260px, 1fr) minmax(300px, 390px); gap: 14px; align-items: end; margin-bottom: 0; width: 100%; box-sizing: border-box;';

  teamGroup1El = buildTeamGroupPanel(0, 'TEAM 1', [0, 2]);
  previewWindowEl = buildCenterPreviewWindow();
  teamGroup2El = buildTeamGroupPanel(1, 'TEAM 2', [1, 3]);

  columnsBoxEl.appendChild(teamGroup1El);
  columnsBoxEl.appendChild(previewWindowEl);
  columnsBoxEl.appendChild(teamGroup2El);
  container.appendChild(columnsBoxEl);

  // Match Rules Box (Screen 2 — Vertical Top-to-Bottom Stack: Row 0 Ball Size -> Row 1 Match Duration)
  matchRulesBoxEl = document.createElement('div');
  matchRulesBoxEl.id = 'match-rules-box';
  matchRulesBoxEl.style.cssText = `
    display: none;
    flex-direction: column;
    gap: 10px;
    margin: 0 auto;
    max-width: 860px;
    width: 100%;
    box-sizing: border-box;
    background: rgba(11, 17, 26, 0.88);
    border: 1.5px solid rgba(0, 229, 255, 0.35);
    border-top: 4px solid #00e5ff;
    border-radius: 10px;
    padding: 12px 16px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.65);
  `;

  const rulesHeader = document.createElement('div');
  rulesHeader.id = 'match-rules-header-title';
  rulesHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px;';
  rulesHeader.innerHTML = `
    <span style="font-size:12px;font-weight:900;letter-spacing:0.12em;color:#ffffff;">MATCH RULES (VERTICAL TOP-TO-BOTTOM)</span>
    <span class="contextual-btn-badge" style="border-color:#00e5ff;color:#00e5ff;background:rgba(0,229,255,0.14);">🎮 P1 CONTROLS RULES · P2–P4 READY BELOW</span>
  `;
  matchRulesBoxEl.appendChild(rulesHeader);

  // Row 0: Match Ball Selector (Top)
  const mbs = buildMatchBallSelector();
  matchRulesBoxEl.appendChild(mbs);

  // Row 1: Match Duration Selector (Bottom)
  const mds = buildMatchDurationSelector();
  matchRulesBoxEl.appendChild(mds);

  // Arena Selector kept hidden (single arena: Valley Arena)
  const as = buildArenaSelector();
  as.style.display = 'none';
  matchRulesBoxEl.appendChild(as);

  container.appendChild(matchRulesBoxEl);

  // Function to switch pages
  window._updateSetupPage = function() {
    const typeCards = [1, 2, 3, 4].map((n) => document.getElementById(`type-options-card-p${n}`));
    const is2v2 = matchFormat === '2v2';

    if (currentSetupMode === 'practice') {
      typeCards.forEach((c) => { if (c) c.style.display = 'none'; });
      if (col2El) col2El.style.display = 'none';
      if (col3El) col3El.style.display = 'none';
      if (col4El) col4El.style.display = 'none';
      if (teamGroup2El) teamGroup2El.style.display = 'none';
      if (previewWindowEl) previewWindowEl.style.display = 'flex';
      if (team1PlayersGridEl) team1PlayersGridEl.style.gridTemplateColumns = 'minmax(0, 1fr)';
      if (teamHeaderTitleEls[0]) teamHeaderTitleEls[0].textContent = 'SOLO ATHLETE · TEAM KIT';
      columnsBoxEl.style.display = 'grid';
      columnsBoxEl.style.gridTemplateColumns = 'minmax(290px, 370px) minmax(320px, 1fr)';
      matchRulesBoxEl.style.display = 'flex';
      matchRulesBoxEl.style.maxWidth = '580px';
      matchRulesBoxEl.style.margin = '0';
      const durationBox = document.getElementById('match-duration-selector-box');
      const arenaBox = document.getElementById('arena-selector-box');
      if (durationBox) durationBox.style.display = 'none';
      if (arenaBox) arenaBox.style.display = 'none';
      if (rulesHeader) rulesHeader.style.display = 'none';
      if (btnNext) btnNext.style.display = 'none';
      playerReadyButtons.forEach((b) => { if (b) b.style.display = 'none'; });
      if (btnStartMatch) {
        btnStartMatch.style.display = 'block';
        btnStartMatch.disabled = false;
        btnStartMatch.textContent = 'START PRACTICE DRILL ➔';
      }
      if (btnBack) btnBack.textContent = '⮌ TITLE';
      updateFocusUI();
      return;
    }

    typeCards.forEach((c) => { if (c) c.style.display = 'flex'; });
    if (teamGroup1El) teamGroup1El.style.display = 'flex';
    if (teamGroup2El) teamGroup2El.style.display = 'flex';
    if (previewWindowEl) previewWindowEl.style.display = 'flex';
    if (col2El) col2El.style.display = 'flex';
    if (col3El) col3El.style.display = is2v2 ? 'flex' : 'none';
    if (col4El) col4El.style.display = is2v2 ? 'flex' : 'none';
    if (team1PlayersGridEl) team1PlayersGridEl.style.gridTemplateColumns = is2v2 ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)';
    if (team2PlayersGridEl) team2PlayersGridEl.style.gridTemplateColumns = is2v2 ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)';
    if (teamHeaderTitleEls[0]) teamHeaderTitleEls[0].textContent = is2v2 ? 'TEAM 1 · P1 & P3' : 'TEAM 1 · P1';
    if (teamHeaderTitleEls[1]) teamHeaderTitleEls[1].textContent = is2v2 ? 'TEAM 2 · P2 & P4' : 'TEAM 2 · P2';

    const durationBox = document.getElementById('match-duration-selector-box');
    const arenaBox = document.getElementById('arena-selector-box');
    if (durationBox) durationBox.style.display = 'flex';
    if (arenaBox) arenaBox.style.display = 'none';
    if (rulesHeader) rulesHeader.style.display = 'flex';

    if (setupPage === 1) {
      columnsBoxEl.style.display = 'grid';
      columnsBoxEl.style.gridTemplateColumns = is2v2
        ? 'minmax(350px, 1.24fr) minmax(190px, 0.72fr) minmax(350px, 1.24fr)'
        : 'minmax(300px, 390px) minmax(260px, 1fr) minmax(300px, 390px)';
      matchRulesBoxEl.style.display = 'none';
      if (btnBack) btnBack.textContent = navActions.showControllerAssignment ? '⮌ CONTROLLERS' : '⮌ TITLE';
      if (btnNext) btnNext.style.display = 'block';
      playerReadyButtons.forEach((b) => { if (b) b.style.display = 'none'; });
      if (btnStartMatch) btnStartMatch.style.display = 'none';
      lobbyTitleEl.textContent = is2v2 ? '2v2 TEAM LOBBY / SETUP' : 'MATCH LOBBY / SETUP';
      if (lobbySubtitleEl) {
        lobbySubtitleEl.textContent = is2v2
          ? 'Team 1 (P1 & P3) vs Team 2 (P2 & P4) — Collective team kits & individual athlete loadouts'
          : 'Team 1 (P1) vs Team 2 (P2) — Collective team kits & individual athlete loadouts';
      }
    } else {
      columnsBoxEl.style.display = 'none';
      matchRulesBoxEl.style.display = 'flex';
      matchRulesBoxEl.style.flexDirection = 'column';
      matchRulesBoxEl.style.maxWidth = '860px';
      matchRulesBoxEl.style.margin = '0 auto';
      matchRulesFocusRow = 0;
      matchRulesActionCol = playerConfigs[0]?.type === 'human' ? 1 : 2;
      if (btnBack) btnBack.textContent = '⮌ PLAYERS';
      if (btnNext) btnNext.style.display = 'none';
      if (btnReadyP1) btnReadyP1.style.display = 'block';
      if (btnReadyP2) btnReadyP2.style.display = 'block';
      if (btnReadyP3) btnReadyP3.style.display = is2v2 ? 'block' : 'none';
      if (btnReadyP4) btnReadyP4.style.display = is2v2 ? 'block' : 'none';
      if (btnStartMatch) btnStartMatch.style.display = 'block';
      lobbyTitleEl.textContent = 'MATCH RULES & READY UP';
      if (lobbySubtitleEl) lobbySubtitleEl.textContent = 'P1 sets Ball Size & Match Length (↕ / ◀ ▶) — Each player locks in their own Ready button';
      updateMatchBallUI();
      updateMatchDurationUI();
    }
    updateReadyUI();
    getActivePlayerIndices().forEach((idx) => updateAggressivenessUI(idx));
    updateFocusUI();
  };

  // Action Buttons: Back, Next, Ready Up P1..P4, Start Match / Countdown
  const actionRow = document.createElement('div');
  actionRow.id = 'player-setup-action-row';
  actionRow.style.cssText = `
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    gap: 6px;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: nowrap;
    box-sizing: border-box;
  `;

  btnBack = document.createElement('button');
  btnBack.id = 'btn-setup-back';
  btnBack.textContent = '⮌ TITLE';
  btnBack.style.cssText = `
    flex: 0 0 auto;
    padding: 9px 14px;
    font-size: 11.5px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.06em;
    color: #cfe3f5;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 8px;
    white-space: nowrap;
    cursor: pointer;
    box-sizing: border-box;
    transition: all 0.15s ease;
  `;
  btnBack.onmouseenter = () => { btnBack.style.background = 'rgba(255, 255, 255, 0.15)'; };
  btnBack.onmouseleave = () => { btnBack.style.background = 'rgba(255, 255, 255, 0.08)'; };
  btnBack.onclick = () => {
    cancelMatchCountdown();
    if (setupPage === 2 && currentSetupMode !== 'practice') {
      setupPage = 1;
      window._updateSetupPage();
    } else if (currentSetupMode === 'match' && navActions.showControllerAssignment) {
      navActions.showControllerAssignment();
    } else {
      if (navActions.showTitleScreen) navActions.showTitleScreen();
    }
  };

  btnNext = document.createElement('button');
  btnNext.id = 'btn-setup-next';
  btnNext.textContent = 'NEXT: MATCH RULES ➔';
  btnNext.style.cssText = `
    flex: 0 1 280px;
    min-width: 170px;
    padding: 9px 16px;
    font-size: 12.5px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    color: #ffffff;
    background: #10b981;
    border: 1px solid #34d399;
    border-radius: 8px;
    white-space: nowrap;
    cursor: pointer;
    box-sizing: border-box;
    box-shadow: 0 4px 16px rgba(16, 185, 129, 0.45);
    transition: all 0.15s ease;
  `;
  btnNext.onclick = () => {
    setupPage = 2;
    window._updateSetupPage();
  };
  [0, 1, 2, 3].forEach((i) => {
    if (playerRowElements[i]) playerRowElements[i][8] = btnNext;
  });

  const makeReadyBtn = (idx) => {
    const slotTheme = getPlayerSlotTheme(idx);
    const btn = document.createElement('button');
    btn.id = `btn-ready-p${idx + 1}`;
    btn.textContent = `READY P${idx + 1}`;
    btn.style.cssText = `
      flex: 0 1 155px;
      min-width: 105px;
      padding: 9px 10px;
      font-size: 11px;
      font-weight: 800;
      font-family: inherit;
      letter-spacing: 0.05em;
      color: ${slotTheme.hex};
      background: ${slotTheme.bg};
      border: 1.5px solid ${slotTheme.hex};
      border-radius: 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
      box-sizing: border-box;
      transition: all 0.15s ease;
    `;
    btn.onclick = () => {
      if (idx > 0 && playerConfigs[idx]?.type === 'human') {
        const m = getExplicitDeviceMappings()?.[idx];
        soundManager.playTone(240, 0.08, 'sawtooth', 0.14);
        const devHint = m?.type === 'gamepad'
          ? `Pad ${m.padIndex + 1} (press □/X, ✕/A, or START)`
          : 'Keyboard 2 (press ENTER)';
        showToast(`🎮 P${idx + 1} must Ready Up on their own controller: ${devHint}`, 'info', 2000);
        return;
      }
      if (idx === 0) {
        matchRulesFocusRow = 2;
        matchRulesActionCol = 1;
      }
      updateFocusUI();
      togglePlayerReady(idx);
    };
    playerReadyButtons[idx] = btn;
    return btn;
  };

  btnReadyP1 = makeReadyBtn(0);
  btnReadyP3 = makeReadyBtn(2);
  btnReadyP3.style.display = 'none';

  btnStartMatch = document.createElement('button');
  btnStartMatch.id = 'btn-start-match';
  btnStartMatch.textContent = 'READY UP TO BEGIN MATCH';
  btnStartMatch.disabled = true;
  btnStartMatch.style.cssText = `
    flex: 0 1 225px;
    min-width: 145px;
    padding: 9px 14px;
    font-size: 12px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.06em;
    color: #ffffff;
    background: #334155;
    opacity: 0.65;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: not-allowed;
    box-sizing: border-box;
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
    const isAllAI = getActivePlayerIndices().every((i) => playerConfigs[i]?.type === 'ai');
    if (isAllAI) {
      launchMatchNow();
      return;
    }
    startMatchCountdown(3);
  };

  btnReadyP2 = makeReadyBtn(1);
  btnReadyP4 = makeReadyBtn(3);
  btnReadyP4.style.display = 'none';

  actionRow.appendChild(btnBack);
  actionRow.appendChild(btnNext);
  actionRow.appendChild(btnReadyP1);
  actionRow.appendChild(btnReadyP3);
  actionRow.appendChild(btnStartMatch);
  actionRow.appendChild(btnReadyP2);
  actionRow.appendChild(btnReadyP4);

  // Unified Bottom Command Dock: aligns BOTH the Header Info window and the Footer Action/Legend window at the bottom of the page
  const bottomDock = document.createElement('div');
  bottomDock.id = 'setup-bottom-dock';
  bottomDock.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    background: rgba(11, 17, 26, 0.90);
    border: 1px solid rgba(120, 170, 210, 0.30);
    border-radius: 10px;
    padding: 8px 14px 6px 14px;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.72);
  `;

  const bottomTopRow = document.createElement('div');
  bottomTopRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-width: 0; box-sizing: border-box;';
  bottomTopRow.appendChild(headerWrap);
  bottomTopRow.appendChild(actionRow);
  bottomDock.appendChild(bottomTopRow);

  const rainbowDivider = document.createElement('div');
  rainbowDivider.style.cssText = `
    height: 1.5px;
    width: 100%;
    background: linear-gradient(90deg, #ff2e55 0%, #ff6b35 15%, #fbb417 30%, #4ade80 46%, #00e5ff 62%, #3b82f6 78%, #a855f7 90%, #ec4899 100%);
    border-radius: 1px;
    opacity: 0.75;
  `;
  bottomDock.appendChild(rainbowDivider);

  setupLegendEl = document.createElement('div');
  setupLegendEl.id = 'player-setup-controller-legend';
  setupLegendEl.style.cssText = `
    padding: 1px 6px 0 6px;
    font-size: 9.5px;
    font-weight: 800;
    letter-spacing: 0.07em;
    color: #cbd5e1;
    text-align: center;
    user-select: none;
  `;
  bottomDock.appendChild(setupLegendEl);
  container.appendChild(bottomDock);

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
  matchBallHeaderTitleEl.style.cssText = 'font-size: 11px; font-weight: 900; letter-spacing: 0.1em; color: #00e5ff;';
  matchBallHeaderTitleEl.textContent = '1. MATCH BALL SIZE';

  matchBallHeaderDescEl = document.createElement('span');
  matchBallHeaderDescEl.style.cssText = 'font-size: 10px; color: #94a3b8; margin-left: 8px;';
  matchBallHeaderDescEl.textContent = 'P1 selects regulation ball or random (◀ ▶ or LB / RB to cycle)';

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
  titleEl.style.cssText = 'font-size: 11px; font-weight: 900; letter-spacing: 0.1em; color: #00e5ff;';
  titleEl.textContent = '2. MATCH LENGTH';

  const descEl = document.createElement('span');
  descEl.style.cssText = 'font-size: 10px; color: #94a3b8; margin-left: 8px;';
  descEl.textContent = 'P1 selects regulation time limit (◀ ▶ or LB / RB to cycle)';

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
  if (lobbyBadgeEl && currentSetupMode === 'match') {
    const mins = Math.floor(selectedMatchDuration / 60);
    const secs = String(selectedMatchDuration % 60).padStart(2, '0');
    const fmtLabel = matchFormat === '2v2' ? '2v2 (4 ATHLETES)' : '1v1 VERSUS';
    lobbyBadgeEl.textContent = `${fmtLabel} · ${mins}:${secs} DURATION`;
  }
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
  const aggVal = playerConfigs[idx].aggressiveness ?? 0.60;
  const curVal = Math.round(aggVal * 100);
  const slider = document.getElementById(`agg-slider-p${idx + 1}`);
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
  // Sync the 4 playstyle chip buttons (DEF, BAL, AGG, ALL) so Keyboard/Gamepad D-Pad cycling highlights the active chip
  const chipsRow = document.getElementById(`agg-chips-p${idx + 1}`);
  if (chipsRow) {
    const presets = [0.25, 0.60, 0.80, 1.00];
    let activeChipIdx = 1;
    let bestDist = Infinity;
    presets.forEach((v, cIdx) => {
      const d = Math.abs(aggVal - v);
      if (d < bestDist) {
        bestDist = d;
        activeChipIdx = cIdx;
      }
    });
    Array.from(chipsRow.children).forEach((b, cIdx) => {
      const sel = cIdx === activeChipIdx;
      b.style.background = sel ? '#00e5ff' : 'rgba(255, 255, 255, 0.06)';
      b.style.borderColor = sel ? '#00e5ff' : 'rgba(255, 255, 255, 0.14)';
      b.style.color = sel ? '#000000' : '#cbd5e1';
    });
  }
}

export function updateInputBadgesUI() {
  const activeCount = getActiveMatchPlayerCount();
  const assignments = getControllerAssignments(activeCount, currentSetupMode);
  const slotNames = [assignments.p1, assignments.p2, assignments.p3, assignments.p4];
  const defaultKb = ['KEYBOARD WASD', 'KEYBOARD IJKL', 'KEYBOARD WASD', 'KEYBOARD IJKL'];
  const explicit = getExplicitDeviceMappings();
  const activeIndices = getActivePlayerIndices();
  const humanSlots = activeIndices.filter((i) => playerConfigs[i]?.type === 'human');

  [0, 1, 2, 3].forEach((idx) => {
    const badge = playerInputBadges[idx];
    const vpBadge = playerViewportBadges[idx];
    const slotTheme = getPlayerSlotTheme(idx);

    if (vpBadge) {
      vpBadge.innerHTML = renderViewportBadgeHtml(idx, humanSlots, currentSetupMode);
    }

    if (!badge) return;

    if (currentSetupMode === 'practice') {
      badge.textContent = `🎮 P1: ${assignments.p1 || 'KEYBOARD WASD'}`;
      badge.style.color = slotTheme.hex;
      badge.style.borderColor = slotTheme.hex;
      badge.style.background = slotTheme.bg;
      return;
    }

    const cfg = playerConfigs[idx];
    if (cfg && cfg.type === 'ai') {
      const diff = (cfg.difficulty || 'medium').toUpperCase();
      badge.textContent = `🤖 AI BOT (${diff})`;
      badge.style.color = '#94a3b8';
      badge.style.borderColor = 'rgba(148, 163, 184, 0.35)';
      badge.style.background = 'rgba(255, 255, 255, 0.04)';
    } else {
      const m = explicit?.[idx];
      const isFight = m?.type === 'gamepad' && Boolean(m?.fightingPad);
      const devIcon = m?.type === 'gamepad' ? (isFight ? '🕹️' : '🎮') : '⌨️';
      const fightSuffix = isFight ? ' [D-PAD]' : '';
      const devName = slotNames[idx];
      badge.textContent = `${devIcon} ${(devName || defaultKb[idx]).toUpperCase()}${fightSuffix}`;
      badge.style.color = slotTheme.hex;
      badge.style.borderColor = slotTheme.hex;
      badge.style.background = slotTheme.bg;
    }
  });
}

export function setPlayerType(idx, typeId) {
  if (!playerConfigs[idx]) return;
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

  const devs = [null, null, null, null];
  if (assignments) {
    devs[0] = assignments.team1?.[0] || null;
    devs[1] = assignments.team2?.[0] || null;
    devs[2] = assignments.team1?.[1] || null;
    devs[3] = assignments.team2?.[1] || null;
  } else {
    const explicit = getExplicitDeviceMappings();
    if (explicit) {
      for (let i = 0; i < 4; i++) devs[i] = explicit[i] || null;
    }
  }

  const activeIndices = getActivePlayerIndices();
  activeIndices.forEach((idx) => {
    if (devs[idx]) {
      playerConfigs[idx].type = 'human';
      playerReadyState[idx] = false;
    } else {
      playerConfigs[idx].type = 'ai';
      if (!playerConfigs[idx].difficulty) playerConfigs[idx].difficulty = 'medium';
      playerReadyState[idx] = true;
    }
    if (state.playerConfigs && state.playerConfigs[idx]) {
      state.playerConfigs[idx].type = playerConfigs[idx].type;
      state.playerConfigs[idx].difficulty = playerConfigs[idx].difficulty;
    }
  });

  updateTypeButtonsUI();
  updateReadyUI();
  activeIndices.forEach((idx) => updateAggressivenessUI(idx));
  updateInputBadgesUI();
  updateFocusUI();
  activeIndices.forEach((idx) => notifyPlayerUpdate(idx));
}

export function updateTypeButtonsUI() {
  [0, 1, 2, 3].forEach((idx) => {
    if (!playerConfigs[idx]) return;
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
  const myGroup = (idx % 2 === 0) ? [0, 2] : [1, 3];
  const oppGroup = (idx % 2 === 0) ? [1, 3] : [0, 2];
  const oppTeam = team === 'home' ? 'away' : 'home';
  myGroup.forEach((i) => { if (playerConfigs[i]) playerConfigs[i].team = team; });
  oppGroup.forEach((i) => { if (playerConfigs[i]) playerConfigs[i].team = oppTeam; });

  getActivePlayerIndices().forEach((i) => {
    if (playerConfigs[i]?.type === 'human') playerReadyState[i] = false;
  });
  updateReadyUI();

  updateTeamButtonsUI();
  enforceColorExclusivity();

  getActivePlayerIndices().forEach((i) => notifyPlayerUpdate(i));
}

export function updateTeamButtonsUI() {
  [0, 1, 2, 3].forEach((idx) => {
    if (!playerConfigs[idx]) return;
    const curTeam = playerConfigs[idx].team;
    playerTeamButtons[idx]?.forEach(({ btn, teamId }) => {
      const isSelected = curTeam === teamId;
      const baseColor = teamId === 'home' ? '#d90429' : '#1d4ed8';
      btn.style.background = isSelected ? baseColor : 'rgba(255, 255, 255, 0.06)';
      btn.style.borderColor = isSelected ? baseColor : 'rgba(255, 255, 255, 0.15)';
      btn.style.color = isSelected ? '#ffffff' : '#94a3b8';
    });
    const subEl = colSubEls[idx];
    if (subEl) {
      if (currentSetupMode === 'practice') {
        subEl.textContent = 'SOLO SANDBOX';
      } else {
        subEl.textContent = curTeam === 'home' ? 'SOUTH · TARGETS NORTH' : 'NORTH · TARGETS SOUTH';
      }
    }
  });
}

export function setPlayerColor(idx, colorHex) {
  if (!playerConfigs[idx]) return;
  if (currentSetupMode !== 'practice') {
    const homeRep = playerConfigs[0].team === 'home' ? 0 : 1;
    const isAway = playerConfigs[idx].team !== 'home';
    if (isAway && colorHex === playerConfigs[homeRep].primaryColor) {
      return;
    }
  }

  const sameTeamIndices = currentSetupMode === 'practice'
    ? [idx]
    : [0, 1, 2, 3].filter((i) => playerConfigs[i]?.team === playerConfigs[idx].team);

  sameTeamIndices.forEach((i) => {
    playerConfigs[i].primaryColor = colorHex;
  });

  const canon = getCanonHeadwearIdForColorName(getColorName(colorHex).toLowerCase());
  if (canon) {
    playerConfigs[idx].headwear = canon;
    const labelEl = playerHeadwearLabelEls[idx];
    if (labelEl) {
      const opt = HEADWEAR_OPTIONS.find((o) => o.id === canon);
      labelEl.textContent = opt ? opt.label : canon;
    }
  }
  playerReadyState[idx] = false;
  updateReadyUI();

  enforceColorExclusivity();
  sameTeamIndices.forEach((i) => notifyPlayerUpdate(i));
}

export function enforceColorExclusivity() {
  if (currentSetupMode === 'practice') {
    updateSwatchUI();
    return;
  }

  const homeIdx = playerConfigs[0].team === 'home' ? 0 : 1;
  const awayIdx = 1 - homeIdx;
  const homeColor = playerConfigs[homeIdx].primaryColor;

  // Ensure teammates share their team's primaryColor
  [0, 1, 2, 3].forEach((i) => {
    if (playerConfigs[i]) {
      const repIdx = playerConfigs[i].team === 'home' ? homeIdx : awayIdx;
      playerConfigs[i].primaryColor = playerConfigs[repIdx].primaryColor;
    }
  });

  if (playerConfigs[awayIdx].primaryColor === homeColor) {
    const alt = PALETTE_SWATCHES.find((s) => s.hex !== homeColor);
    if (alt) {
      [0, 1, 2, 3].forEach((i) => {
        if (playerConfigs[i]?.team === 'away') {
          playerConfigs[i].primaryColor = alt.hex;
          const canon = getCanonHeadwearIdForColorName(getColorName(alt.hex).toLowerCase());
          if (canon && i === awayIdx) {
            playerConfigs[i].headwear = canon;
            const labelEl = playerHeadwearLabelEls[i];
            if (labelEl) {
              const opt = HEADWEAR_OPTIONS.find((o) => o.id === canon);
              labelEl.textContent = opt ? opt.label : canon;
            }
          }
          notifyPlayerUpdate(i);
        }
      });
    }
  }

  updateSwatchUI();
}

export function updateSwatchUI() {
  const homeIdx = playerConfigs[0].team === 'home' ? 0 : 1;
  const homeColor = playerConfigs[homeIdx].primaryColor;

  [0, 1].forEach((teamGroupIdx) => {
    const repIdx = teamGroupIdx === 0 ? 0 : 1;
    const cardEl = teamHeaderCardEls[teamGroupIdx];
    if (cardEl && playerConfigs[repIdx]) {
      const hexStr = '#' + (playerConfigs[repIdx].primaryColor ?? 0xffffff).toString(16).padStart(6, '0');
      cardEl.style.borderTop = `3px solid ${hexStr}`;
    }
  });

  [0, 1, 2, 3].forEach((idx) => {
    if (!playerConfigs[idx]) return;
    const isAway = playerConfigs[idx].team !== 'home' && currentSetupMode !== 'practice';
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

export function setPlayerHeadwear(idx, headwearId) {
  if (!playerConfigs[idx]) return;
  playerConfigs[idx].headwear = headwearId;
  playerReadyState[idx] = false;
  updateReadyUI();

  const labelEl = playerHeadwearLabelEls[idx];
  if (labelEl) {
    const opt = HEADWEAR_OPTIONS.find((o) => o.id === headwearId);
    labelEl.textContent = opt ? opt.label : (headwearId || 'NONE');
  }

  notifyPlayerUpdate(idx);
}

export function cyclePlayerHeadwear(idx, dir = 1) {
  if (!playerConfigs[idx]) return;
  const curId = playerConfigs[idx].headwear;
  const curIdx = HEADWEAR_OPTIONS.findIndex((o) => o.id === curId);
  const nextIdx = curIdx === -1
    ? (dir > 0 ? 0 : HEADWEAR_OPTIONS.length - 1)
    : (curIdx + dir + HEADWEAR_OPTIONS.length) % HEADWEAR_OPTIONS.length;
  setPlayerHeadwear(idx, HEADWEAR_OPTIONS[nextIdx].id);
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
  const optIdx = CAMERA_OPTIONS.findIndex((o) => o.id === cameraMode);
  const labelEl = playerCameraLabelEls[idx];
  if (labelEl) {
    const opt = optIdx >= 0 ? CAMERA_OPTIONS[optIdx] : null;
    labelEl.textContent = opt ? opt.label : cameraMode.toUpperCase();
  }
  const dots = playerCameraDotsEls[idx] || [];
  dots.forEach((dotEl, dIdx) => {
    const active = dIdx === optIdx;
    dotEl.style.background = active ? '#00e5ff' : 'rgba(255, 255, 255, 0.22)';
    dotEl.style.boxShadow = active ? '0 0 6px rgba(0, 229, 255, 0.8)' : 'none';
  });

  if (
    currentSetupMode === 'match' &&
    cameraMode === 'broadcast' &&
    playerConfigs[0]?.type === 'human' &&
    playerConfigs[1]?.type === 'human'
  ) {
    showToast('SIDELINE BROADCAST — Shared Fullscreen View for All Players', 'info', 2200);
  }

  updateInputBadgesUI();
  notifyPlayerUpdate(idx);
}

export function cyclePlayerCamera(idx, dir = 1) {
  if (!playerConfigs[idx]) return;
  const curIdx = CAMERA_OPTIONS.findIndex((c) => c.id === playerConfigs[idx].cameraMode);
  const nextIdx = curIdx === -1
    ? 0
    : (curIdx + dir + CAMERA_OPTIONS.length) % CAMERA_OPTIONS.length;
  setPlayerCamera(idx, CAMERA_OPTIONS[nextIdx].id);
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
  [0, 1, 2, 3].forEach((idx) => {
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
      cyclePlayerHeadwear(playerIdx, direction);
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
    }
    return;
  }

  // Match Mode Screen 1 row mapping (Top-to-Bottom: 0=Team Kit, 1=Team Color, 2=Headwear, 3=Physique, 4=Camera, 5=Assist, 6=Control/AI Difficulty, 7=AI Style, 8=Action Bar)
  if (rowIdx === 0) {
    setPlayerTeam(playerIdx, playerConfigs[playerIdx].team === 'home' ? 'away' : 'home');
  } else if (rowIdx === 1) {
    const homeIdx = playerConfigs[0].team === 'home' ? 0 : 1;
    const isAway = playerConfigs[playerIdx]?.team !== 'home';
    const homeColor = playerConfigs[homeIdx].primaryColor;
    const allowed = PALETTE_SWATCHES.filter((s) => !isAway || s.hex !== homeColor);
    const curIdx = allowed.findIndex((s) => s.hex === playerConfigs[playerIdx].primaryColor);
    const nextIdx = (curIdx + direction + allowed.length) % allowed.length;
    setPlayerColor(playerIdx, allowed[nextIdx].hex);
  } else if (rowIdx === 2) {
    cyclePlayerHeadwear(playerIdx, direction);
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
  } else if (rowIdx === 6) {
    const types = ['human', 'ai-easy', 'ai-medium', 'ai-hard'];
    const curConfig = playerConfigs[playerIdx];
    const curId = curConfig.type === 'human' ? 'human' : `ai-${curConfig.difficulty}`;
    const curIdx = types.indexOf(curId);
    const nextIdx = (curIdx + direction + types.length) % types.length;
    setPlayerType(playerIdx, types[nextIdx]);
  } else if (rowIdx === 7) {
    if (playerConfigs[playerIdx].type === 'ai') {
      const presets = [0.25, 0.60, 0.80, 1.00];
      const curVal = playerConfigs[playerIdx].aggressiveness ?? 0.60;
      let curIdx = 1;
      let bestDist = Infinity;
      presets.forEach((v, idx) => {
        const d = Math.abs(curVal - v);
        if (d < bestDist) {
          bestDist = d;
          curIdx = idx;
        }
      });
      const nextIdx = (curIdx + direction + presets.length) % presets.length;
      setPlayerAggressiveness(playerIdx, presets[nextIdx]);
      soundManager.playTone(direction > 0 ? 520 : 380, 0.04, 'sine', 0.15);
    }
  } else if (rowIdx === 8) {
    if (screen1ActionCol === 0) {
      if (btnBack) btnBack.click();
      else if (navActions.showTitleScreen) navActions.showTitleScreen();
    } else {
      setupPage = 2;
      window._updateSetupPage();
    }
  }
}

/**
 * Versus lobby: all active slots are human and each has its own assigned device.
 * Every device then edits only its own player's column. Otherwise (any AI slot,
 * one human, or spectating) any device can also use LB / RB / Tab to switch
 * columns so humans can configure AI bots too.
 */
export function isVersusLobby() {
  if (currentSetupMode !== 'match') return false;
  const mappings = getExplicitDeviceMappings();
  const activeIndices = getActivePlayerIndices();
  return !!mappings && activeIndices.every((i) => playerConfigs[i]?.type === 'human' && !!mappings[i]);
}

function lobbyDeviceLabel(idx) {
  const m = getExplicitDeviceMappings()?.[idx];
  if (!m) return `P${idx + 1}`;
  if (m.type === 'gamepad') return `P${idx + 1} · PAD ${m.padIndex + 1}`;
  return `P${idx + 1} · ${m.keyId === 'kb2' ? 'IJKL' : 'WASD'}`;
}

/**
 * Allows any unassigned gamepad pressing A / Y / Start inside the Lobby to directly
 * claim the next open AI slot (or pad-less human slot) on the fly without returning
 * to the Controller Assignment screen.
 */
export function claimLobbySlotForPad(padIndex, padId = '') {
  if (currentSetupMode !== 'match') return -1;
  const existing = getAssignedSlotForPad(padIndex);
  const activeIndices = getActivePlayerIndices();
  if (existing >= 0 && existing < activeIndices.length) return existing;

  // Prefer the first active AI slot; fallback to any human slot without an explicit gamepad
  let targetSlot = activeIndices.find((i) => playerConfigs[i]?.type === 'ai');
  if (targetSlot === undefined) {
    const mappings = getExplicitDeviceMappings();
    targetSlot = activeIndices.find((i) => !mappings?.[i] || mappings[i].type !== 'gamepad');
  }
  if (targetSlot === undefined) return -1;

  assignPadToSlot(targetSlot, padIndex, padId);
  playerConfigs[targetSlot].type = 'human';
  playerReadyState[targetSlot] = false;
  if (state.playerConfigs && state.playerConfigs[targetSlot]) {
    state.playerConfigs[targetSlot].type = 'human';
  }
  playerFocusRow[targetSlot] = targetSlot === 0 ? 1 : 2; // P1 starts on Team Color, P2-P4 start on Hat

  updateReadyUI();
  updateTypeButtonsUI();
  updateAggressivenessUI(targetSlot);
  updateInputBadgesUI();
  updateFocusUI();
  notifyPlayerUpdate(targetSlot);

  soundManager.playTone(587.33, 0.06, 'sine', 0.22);
  setTimeout(() => soundManager.playTone(880, 0.1, 'sine', 0.25), 60);
  showToast(`🎮 Controller ${padIndex + 1} joined as Player ${targetSlot + 1}!`, 'info', 2200);
  return targetSlot;
}

/**
 * Toggles a lobby slot between Human and AI Bot directly inside the Lobby (e.g. via Y button).
 */
export function toggleLobbySlotHumanAi(slotIdx, padIndex = -1, padId = '') {
  if (currentSetupMode !== 'match' || !playerConfigs[slotIdx]) return;
  if (playerConfigs[slotIdx].type === 'ai') {
    if (padIndex >= 0) {
      assignPadToSlot(slotIdx, padIndex, padId);
    } else {
      assignDefaultDeviceForSlot(slotIdx);
    }
    playerConfigs[slotIdx].type = 'human';
    playerReadyState[slotIdx] = false;
    playerFocusRow[slotIdx] = slotIdx === 0 ? 1 : 2;
    if (state.playerConfigs && state.playerConfigs[slotIdx]) {
      state.playerConfigs[slotIdx].type = 'human';
    }
    updateReadyUI();
    updateTypeButtonsUI();
    updateAggressivenessUI(slotIdx);
    updateInputBadgesUI();
    updateFocusUI();
    notifyPlayerUpdate(slotIdx);
    soundManager.playTone(660, 0.07, 'sine', 0.22);
  } else {
    playerFocusRow[slotIdx] = 6;
    setPlayerType(slotIdx, `ai-${playerConfigs[slotIdx].difficulty || 'medium'}`);
    soundManager.playTone(380, 0.07, 'sine', 0.18);
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
    const activeConfigs = playerConfigs.slice(0, getActiveMatchPlayerCount());
    if (callbacks.onStartMatch) callbacks.onStartMatch(activeConfigs, matchRules);
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
  if (!playerConfigs[idx] || playerConfigs[idx].type === 'ai') {
    return;
  }

  const activeIndices = getActivePlayerIndices();

  if (matchCountdownActive) {
    cancelMatchCountdown();
    activeIndices.forEach((i) => {
      if (playerConfigs[i]?.type === 'human') playerReadyState[i] = false;
    });
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

  // Auto-launch 3s countdown on Page 2 as soon as all active players lock in Ready!
  const allReady = activeIndices.every((i) => playerReadyState[i]);
  if (
    setupPage === 2 &&
    playerReadyState[idx] &&
    allReady &&
    !matchCountdownActive
  ) {
    startMatchCountdown(3);
  }
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
    playerReadyButtons.forEach((b) => { if (b) b.style.display = 'none'; });
    return;
  }

  const activeIndices = getActivePlayerIndices();
  const is2v2 = matchFormat === '2v2';

  [0, 1, 2, 3].forEach((idx) => {
    const isActiveSlot = idx < activeIndices.length;
    const isAI = playerConfigs[idx]?.type === 'ai';
    if (isAI) {
      playerReadyState[idx] = true;
    }
    const btn = playerReadyButtons[idx];
    const isReady = playerReadyState[idx];
    const banner = readyBannerEls[idx];
    const col = colEls[idx];

    if (banner) {
      banner.style.display = (isActiveSlot && isReady) ? 'flex' : 'none';
      if (isAI) {
        banner.innerHTML = '<span>✓</span><span>AI READY</span>';
      } else {
        banner.innerHTML = '<span>✓</span><span>READY</span>';
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
      const slotTheme = getPlayerSlotTheme(idx);
      if (setupPage === 2) {
        btn.style.display = (idx < 2 || is2v2) ? 'inline-flex' : 'none';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.gap = '5px';
      }
      if (isAI) {
        btn.innerHTML = `<span>✓ BOT P${idx + 1} READY</span>`;
        btn.disabled = true;
        btn.style.background = 'rgba(148, 163, 184, 0.12)';
        btn.style.borderColor = 'rgba(148, 163, 184, 0.35)';
        btn.style.borderLeft = `4px solid ${slotTheme.hex}`;
        btn.style.color = '#94a3b8';
        btn.style.cursor = 'default';
        btn.style.boxShadow = 'none';
      } else if (isReady) {
        btn.disabled = false;
        btn.innerHTML = `<span style="padding:1px 5px;border-radius:3px;background:${slotTheme.hex};color:${slotTheme.textOnFill};font-size:9.5px;font-weight:900;">P${idx + 1}</span><span>✓ READY!</span>`;
        btn.style.background = '#10b981';
        btn.style.borderColor = '#34d399';
        btn.style.borderLeft = `5px solid ${slotTheme.hex}`;
        btn.style.color = '#ffffff';
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = `0 0 16px rgba(16, 185, 129, 0.55), 0 0 8px ${slotTheme.glow}`;
      } else {
        btn.disabled = false;
        btn.innerHTML = `<span style="padding:1px 5px;border-radius:3px;background:${slotTheme.hex};color:${slotTheme.textOnFill};font-size:9.5px;font-weight:900;">P${idx + 1}</span>${renderCardinalDiamondSvg('west', 12)}<span>□/X READY</span>`;
        btn.style.background = slotTheme.bg;
        btn.style.borderColor = slotTheme.hex;
        btn.style.borderLeft = `5px solid ${slotTheme.hex}`;
        btn.style.color = '#ffffff';
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = `0 0 12px ${slotTheme.glow}`;
      }
    }
  });

  if (btnStartMatch && !matchCountdownActive) {
    const isAllAI = activeIndices.every((i) => playerConfigs[i]?.type === 'ai');
    const allReady = activeIndices.every((i) => playerReadyState[i]);
    const countReady = activeIndices.filter((i) => playerReadyState[i]).length;
    const waitingLabels = activeIndices.filter((i) => !playerReadyState[i]).map((i) => `P${i + 1}`);

    if (isAllAI) {
      btnStartMatch.disabled = false;
      btnStartMatch.textContent = 'SPECTATE MATCH ➔';
      btnStartMatch.style.background = '#00e5ff';
      btnStartMatch.style.color = '#000000';
      btnStartMatch.style.fontWeight = '900';
      btnStartMatch.style.border = '2px solid #00e5ff';
      btnStartMatch.style.opacity = '1';
      btnStartMatch.style.cursor = 'pointer';
      btnStartMatch.style.boxShadow = '0 0 25px rgba(0, 229, 255, 0.6), 0 4px 20px rgba(0, 229, 255, 0.4)';
    } else if (allReady) {
      btnStartMatch.disabled = false;
      btnStartMatch.textContent = 'START MATCH ➔';
      btnStartMatch.style.background = '#10b981';
      btnStartMatch.style.color = '#ffffff';
      btnStartMatch.style.fontWeight = '900';
      btnStartMatch.style.border = '2px solid #34d399';
      btnStartMatch.style.opacity = '1';
      btnStartMatch.style.cursor = 'pointer';
      btnStartMatch.style.boxShadow = '0 4px 20px rgba(16, 185, 129, 0.45), 0 0 25px rgba(16, 185, 129, 0.25)';
    } else if (countReady > 0) {
      btnStartMatch.disabled = true;
      btnStartMatch.textContent = `WAITING ${waitingLabels.join('/')} (${countReady}/${activeIndices.length})`;
      btnStartMatch.style.background = 'rgba(255, 255, 255, 0.08)';
      btnStartMatch.style.color = '#cfe3f5';
      btnStartMatch.style.fontWeight = '800';
      btnStartMatch.style.border = '1px solid rgba(255, 255, 255, 0.2)';
      btnStartMatch.style.opacity = '0.85';
      btnStartMatch.style.cursor = 'not-allowed';
      btnStartMatch.style.boxShadow = 'none';
    } else {
      btnStartMatch.disabled = true;
      btnStartMatch.textContent = 'READY UP TO BEGIN';
      btnStartMatch.style.background = 'rgba(255, 255, 255, 0.08)';
      btnStartMatch.style.color = 'rgba(255, 255, 255, 0.45)';
      btnStartMatch.style.fontWeight = '800';
      btnStartMatch.style.border = '1px solid rgba(255, 255, 255, 0.15)';
      btnStartMatch.style.opacity = '0.65';
      btnStartMatch.style.cursor = 'not-allowed';
      btnStartMatch.style.boxShadow = 'none';
    }
  }
}

export function buildCenterPreviewWindow() {
  const stage = document.createElement('div');
  stage.id = 'setup-preview-window';
  stage.style.cssText = `
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    min-height: 280px;
    height: 100%;
    pointer-events: none;
  `;
  return stage;
}

export function buildTeamGroupPanel(teamGroupIdx, teamTitle, slotIndices) {
  const repIdx = slotIndices[0];
  const groupPanel = document.createElement('div');
  groupPanel.id = `team-group-${teamGroupIdx + 1}`;
  groupPanel.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  `;

  // Shared Collective Team Header Card
  const teamCard = document.createElement('div');
  teamCard.id = `team-header-card-${teamGroupIdx + 1}`;
  teamHeaderCardEls[teamGroupIdx] = teamCard;
  const initHex = '#' + (playerConfigs[repIdx].primaryColor ?? 0xffffff).toString(16).padStart(6, '0');
  teamCard.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: rgba(11, 17, 26, 0.88);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-top: 3px solid ${initHex};
    border-radius: 10px;
    padding: 9px 12px;
    box-sizing: border-box;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  `;

  const topBar = document.createElement('div');
  topBar.style.cssText = 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 4px;';

  const titleSpan = document.createElement('span');
  titleSpan.id = `team-header-title-${teamGroupIdx + 1}`;
  titleSpan.style.cssText = 'font-size: 13px; font-weight: 900; letter-spacing: 0.12em; color: #ffffff;';
  titleSpan.textContent = `${teamTitle} · P${slotIndices[0] + 1}`;
  teamHeaderTitleEls[teamGroupIdx] = titleSpan;

  const subSpan = document.createElement('span');
  subSpan.style.cssText = 'font-size: 10px; color: #94a3b8; font-weight: 800; letter-spacing: 0.06em;';
  subSpan.textContent = playerConfigs[repIdx].team === 'home' ? 'SOUTH · TARGETS NORTH' : 'NORTH · TARGETS SOUTH';
  slotIndices.forEach((s) => { colSubEls[s] = subSpan; });

  topBar.appendChild(titleSpan);
  topBar.appendChild(subSpan);
  teamCard.appendChild(topBar);

  // Row 0: Collective Team Kit (Home / Dark vs Away / Light)
  const teamStatusRow = document.createElement('div');
  teamStatusRow.id = `row-team-status-p${repIdx + 1}`;
  teamStatusRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 3px 4px; border-radius: 6px; transition: all 0.15s ease;';

  const kitLabel = document.createElement('div');
  kitLabel.style.cssText = 'font-size: 10px; font-weight: 800; color: #94a3b8; letter-spacing: 0.08em; min-width: 58px;';
  kitLabel.textContent = 'TEAM KIT';

  const teamBtnRow = document.createElement('div');
  teamBtnRow.style.cssText = 'display: flex; gap: 6px; flex: 1;';

  const teamBtns = [];
  [
    { id: 'home', label: 'HOME / DARK' },
    { id: 'away', label: 'AWAY / LIGHT' },
  ].forEach((t) => {
    const btn = document.createElement('button');
    btn.textContent = t.label;
    const isSelected = playerConfigs[repIdx].team === t.id;
    btn.style.cssText = `
      flex: 1;
      padding: 6px 6px;
      font-size: 10px;
      font-weight: 800;
      font-family: inherit;
      color: ${isSelected ? '#ffffff' : '#94a3b8'};
      background: ${isSelected ? (t.id === 'home' ? '#d90429' : '#1d4ed8') : 'rgba(255, 255, 255, 0.06)'};
      border: 1px solid ${isSelected ? (t.id === 'home' ? '#d90429' : '#1d4ed8') : 'rgba(255, 255, 255, 0.15)'};
      border-radius: 5px;
      white-space: nowrap;
      cursor: pointer;
    `;
    btn.onclick = () => {
      const targetSlot = slotIndices.includes(focusedColumn) ? focusedColumn : repIdx;
      playerFocusRow[targetSlot] = currentSetupMode === 'practice' ? 1 : 0;
      focusedColumn = targetSlot;
      updateFocusUI();
      setPlayerTeam(repIdx, t.id);
    };
    teamBtns.push({ btn, teamId: t.id });
    teamBtnRow.appendChild(btn);
  });
  slotIndices.forEach((s) => { playerTeamButtons[s] = teamBtns; });
  teamStatusRow.appendChild(kitLabel);
  teamStatusRow.appendChild(teamBtnRow);
  teamCard.appendChild(teamStatusRow);

  // Row 1: Collective Team Color (Single-line 10-swatch strip)
  const teamColorRow = document.createElement('div');
  teamColorRow.id = `row-team-color-p${repIdx + 1}`;
  teamColorRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 3px 4px; border-radius: 6px; transition: all 0.15s ease;';

  const colorLabel = document.createElement('div');
  colorLabel.style.cssText = 'font-size: 10px; font-weight: 800; color: #94a3b8; letter-spacing: 0.08em; min-width: 58px;';
  colorLabel.textContent = 'COLOR';

  const swatchGrid = document.createElement('div');
  swatchGrid.style.cssText = 'display: grid; grid-template-columns: repeat(10, 1fr); gap: 5px; flex: 1;';

  const swatchBtns = [];
  PALETTE_SWATCHES.forEach((swatch) => {
    const swBtn = document.createElement('button');
    const isSelected = playerConfigs[repIdx].primaryColor === swatch.hex;
    swBtn.title = swatch.name;
    swBtn.style.cssText = `
      height: 22px;
      background: ${swatch.color};
      border: 2px solid ${isSelected ? '#ffffff' : 'transparent'};
      border-radius: 4px;
      cursor: pointer;
      box-shadow: ${isSelected ? '0 0 8px rgba(255,255,255,0.8)' : 'none'};
      transition: transform 0.1s ease;
    `;
    swBtn.onclick = () => {
      const targetSlot = slotIndices.includes(focusedColumn) ? focusedColumn : repIdx;
      playerFocusRow[targetSlot] = currentSetupMode === 'practice' ? 2 : 1;
      focusedColumn = targetSlot;
      updateFocusUI();
      setPlayerColor(repIdx, swatch.hex);
    };
    swatchBtns.push({ btn: swBtn, swatch });
    swatchGrid.appendChild(swBtn);
  });
  slotIndices.forEach((s) => { playerSwatchButtons[s] = swatchBtns; });
  teamColorRow.appendChild(colorLabel);
  teamColorRow.appendChild(swatchGrid);
  teamCard.appendChild(teamColorRow);

  groupPanel.appendChild(teamCard);

  // Team Players Grid (P1 & P3 on Team 1; P2 & P4 on Team 2)
  const playersGrid = document.createElement('div');
  playersGrid.id = `team-${teamGroupIdx + 1}-players-grid`;
  playersGrid.style.cssText = 'display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; width: 100%; min-width: 0; box-sizing: border-box;';
  if (teamGroupIdx === 0) team1PlayersGridEl = playersGrid;
  else team2PlayersGridEl = playersGrid;

  slotIndices.forEach((slotIdx) => {
    const col = buildPlayerColumn(slotIdx, `PLAYER ${slotIdx + 1}`, '#ffffff', teamStatusRow, teamColorRow);
    playersGrid.appendChild(col);
  });

  groupPanel.appendChild(playersGrid);
  return groupPanel;
}

export function buildPlayerColumn(idx, label, themeColor, sharedTeamStatusRow = null, sharedTeamColorRow = null) {
  const slotTheme = getPlayerSlotTheme(idx);
  const col = document.createElement('div');
  col.id = `player-setup-col-${idx + 1}`;
  colEls[idx] = col;
  if (idx === 0) col1El = col;
  else if (idx === 1) col2El = col;
  else if (idx === 2) col3El = col;
  else if (idx === 3) col4El = col;

  col.style.cssText = `
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    background: rgba(11, 17, 26, 0.88);
    border: 1.5px solid rgba(255, 255, 255, 0.16);
    border-top: 3px solid ${slotTheme.hex};
    border-radius: 10px;
    gap: 6px;
    min-width: 0;
    box-sizing: border-box;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
  `;

  // Individual Player Header
  const pHeader = document.createElement('div');
  pHeader.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding-bottom: 5px;
    gap: 6px;
  `;

  const labelSpan = document.createElement('span');
  labelSpan.style.cssText = 'font-size: 13px; font-weight: 900; letter-spacing: 0.08em; color: #ffffff; display: inline-flex; align-items: center; gap: 6px;';

  const slotColorPill = document.createElement('span');
  slotColorPill.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 1px 6px;
    border-radius: 4px;
    background: ${slotTheme.bg};
    border: 1px solid ${slotTheme.hex};
    color: ${slotTheme.hex};
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.06em;
  `;
  slotColorPill.textContent = slotTheme.short;
  labelSpan.appendChild(slotColorPill);

  if (idx === 0 || idx === 1) {
    const badgeEl = document.createElement('span');
    badgeEl.className = 'contextual-btn-badge';
    badgeEl.id = idx === 0 ? 'badge-p1-lb' : 'badge-p2-rb';
    badgeEl.style.borderColor = slotTheme.hex;
    badgeEl.style.color = slotTheme.hex;
    badgeEl.textContent = idx === 0 ? 'LB' : 'RB';
    const titleTextEl = document.createElement('span');
    titleTextEl.textContent = label;
    if (idx === 0) {
      labelSpan.append(badgeEl, titleTextEl);
      col1HeaderLabelEl = titleTextEl;
    } else {
      labelSpan.append(titleTextEl, badgeEl);
    }
  } else {
    const titleTextEl = document.createElement('span');
    titleTextEl.textContent = label;
    labelSpan.appendChild(titleTextEl);
  }

  const ctrlTag = document.createElement('span');
  ctrlTag.id = `ctrl-tag-p${idx + 1}`;
  ctrlTag.style.cssText = 'font-size: 9.5px; font-weight: 800; letter-spacing: 0.04em; color: #ffffff;';
  ctrlTag.innerHTML = idx === 0 ? `<span class="contextual-btn-badge" style="border-color:${slotTheme.hex};color:${slotTheme.hex};">ACTIVE</span>` : '<span class="contextual-btn-badge">P1: TAB/RB</span>';
  ctrlTagEls[idx] = ctrlTag;

  pHeader.appendChild(labelSpan);
  pHeader.appendChild(ctrlTag);
  col.appendChild(pHeader);

  // Compact Status Strip (Input Assignment + Viewport Screen Indicator + Ready Pill)
  const statusStrip = document.createElement('div');
  statusStrip.style.cssText = 'display: flex; gap: 5px; align-items: center; min-width: 0; flex-wrap: wrap;';

  const inputBadge = document.createElement('div');
  inputBadge.id = `input-badge-p${idx + 1}`;
  inputBadge.style.cssText = 'flex: 1; min-width: 110px; font-size: 9.5px; font-weight: 700; color: #ffffff; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 5px; padding: 3px 6px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
  inputBadge.textContent = idx % 2 === 0 ? 'INPUT: KEYBOARD WASD' : 'INPUT: KEYBOARD IJKL';
  playerInputBadges[idx] = inputBadge;
  statusStrip.appendChild(inputBadge);

  const viewportBadge = document.createElement('div');
  viewportBadge.id = `viewport-badge-p${idx + 1}`;
  viewportBadge.style.cssText = 'display: inline-flex; align-items: center; flex-shrink: 0;';
  playerViewportBadges[idx] = viewportBadge;
  statusStrip.appendChild(viewportBadge);

  const readyBanner = document.createElement('div');
  readyBanner.id = `ready-banner-p${idx + 1}`;
  readyBanner.style.cssText = `
    display: none;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 3px 7px;
    background: rgba(16, 185, 129, 0.22);
    border: 1px solid #10b981;
    border-radius: 5px;
    font-size: 9.5px;
    font-weight: 800;
    letter-spacing: 0.05em;
    color: #34d399;
    white-space: nowrap;
  `;
  readyBanner.innerHTML = '<span>✓</span><span>READY</span>';
  readyBannerEls[idx] = readyBanner;
  statusStrip.appendChild(readyBanner);
  col.appendChild(statusStrip);

  playerRowElements[idx] = [];
  playerRowElements[idx][0] = sharedTeamStatusRow;
  playerRowElements[idx][1] = sharedTeamColorRow;

  // Individual Athlete Options Container (Placed FIRST, above Human/AI Control Type)
  const charCard = document.createElement('div');
  charCard.id = `char-options-card-p${idx + 1}`;
  charCard.style.cssText = 'display: flex; flex-direction: column; gap: 5px;';

  // Row 2 (Match) / Row 3 (Practice): Headwear (Single-line horizontal row)
  const headwearRow = document.createElement('div');
  headwearRow.id = `row-headwear-p${idx + 1}`;
  headwearRow.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 2px 3px; border-radius: 6px; transition: all 0.15s ease;';

  const hwTitle = document.createElement('div');
  hwTitle.style.cssText = 'font-size: 9.5px; font-weight: 800; color: #94a3b8; min-width: 38px; letter-spacing: 0.06em;';
  hwTitle.textContent = 'HAT';

  const headwearCyclerRow = document.createElement('div');
  headwearCyclerRow.style.cssText = 'display: flex; gap: 4px; align-items: center; flex: 1; min-width: 0;';

  const btnPrevHw = document.createElement('button');
  btnPrevHw.textContent = '<';
  btnPrevHw.style.cssText = 'padding: 5px 8px; font-size: 10.5px; font-weight: 800; font-family: inherit; color: #ffffff; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 5px; cursor: pointer;';
  btnPrevHw.onclick = () => {
    playerFocusRow[idx] = currentSetupMode === 'practice' ? 3 : 2;
    focusedColumn = idx;
    cyclePlayerHeadwear(idx, -1);
    updateFocusUI();
  };

  const headwearLabelEl = document.createElement('div');
  headwearLabelEl.id = `label-headwear-p${idx + 1}`;
  headwearLabelEl.style.cssText = 'flex: 1; padding: 5px 6px; font-size: 10px; font-weight: 800; text-align: center; color: #ffffff; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
  const initialHwOpt = HEADWEAR_OPTIONS.find((o) => o.id === playerConfigs[idx].headwear);
  headwearLabelEl.textContent = initialHwOpt ? initialHwOpt.label : (playerConfigs[idx].headwear || 'NONE');
  playerHeadwearLabelEls[idx] = headwearLabelEl;

  const btnNextHw = document.createElement('button');
  btnNextHw.textContent = '>';
  btnNextHw.style.cssText = 'padding: 5px 8px; font-size: 10.5px; font-weight: 800; font-family: inherit; color: #ffffff; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 5px; cursor: pointer;';
  btnNextHw.onclick = () => {
    playerFocusRow[idx] = currentSetupMode === 'practice' ? 3 : 2;
    focusedColumn = idx;
    cyclePlayerHeadwear(idx, 1);
    updateFocusUI();
  };

  headwearCyclerRow.append(btnPrevHw, headwearLabelEl, btnNextHw);
  headwearRow.append(hwTitle, headwearCyclerRow);
  charCard.appendChild(headwearRow);
  playerRowElements[idx][2] = headwearRow;

  // Row 3 (Match) / Row 4 (Practice): Player Physique (Single-line horizontal row)
  const physiqueRow = document.createElement('div');
  physiqueRow.id = `row-physique-p${idx + 1}`;
  physiqueRow.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 2px 3px; border-radius: 6px; transition: all 0.15s ease;';

  const physTitle = document.createElement('div');
  physTitle.style.cssText = 'font-size: 9.5px; font-weight: 800; color: #94a3b8; min-width: 38px; letter-spacing: 0.06em;';
  physTitle.textContent = 'BUILD';

  const physiqueBtnRow = document.createElement('div');
  physiqueBtnRow.style.cssText = 'display: flex; gap: 4px; flex: 1;';

  const shortPhysLabels = { classic: 'CLASSIC', masculine: 'MASC', feminine: 'FEM' };
  playerPhysiqueButtons[idx] = [];
  PHYSIQUE_OPTIONS.forEach((variant) => {
    const btn = document.createElement('button');
    btn.textContent = shortPhysLabels[variant] || variant.toUpperCase();
    const isSelected = playerConfigs[idx].variant === variant;
    btn.style.cssText = `
      flex: 1;
      padding: 5px 4px;
      font-size: 9.5px;
      font-weight: 800;
      font-family: inherit;
      color: ${isSelected ? '#000000' : '#94a3b8'};
      background: ${isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.06)'};
      border: 1px solid ${isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.15)'};
      border-radius: 5px;
      white-space: nowrap;
      box-shadow: ${isSelected ? '0 0 8px rgba(255, 255, 255, 0.35)' : 'none'};
      cursor: pointer;
    `;
    btn.onclick = () => {
      playerFocusRow[idx] = currentSetupMode === 'practice' ? 4 : 3;
      focusedColumn = idx;
      updateFocusUI();
      setPlayerPhysique(idx, variant);
    };
    playerPhysiqueButtons[idx].push({ btn, variant });
    physiqueBtnRow.appendChild(btn);
  });
  physiqueRow.append(physTitle, physiqueBtnRow);
  charCard.appendChild(physiqueRow);
  playerRowElements[idx][3] = physiqueRow;

  // Row 4 (Match) / Row 5 (Practice): Streamlined Camera Selector (Single-line + 5-dot indicator)
  const cameraRow = document.createElement('div');
  cameraRow.id = `row-camera-p${idx + 1}`;
  cameraRow.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 2px 3px; border-radius: 6px; transition: all 0.15s ease;';

  const camTitleWrap = document.createElement('div');
  camTitleWrap.style.cssText = 'display: flex; flex-direction: column; gap: 2px; min-width: 38px;';
  const camTitle = document.createElement('span');
  camTitle.style.cssText = 'font-size: 9.5px; font-weight: 800; color: #94a3b8; letter-spacing: 0.06em;';
  camTitle.textContent = 'CAM';

  const dotsWrap = document.createElement('div');
  dotsWrap.style.cssText = 'display: flex; gap: 2px;';
  playerCameraDotsEls[idx] = [];
  const initCamIdx = Math.max(0, CAMERA_OPTIONS.findIndex((o) => o.id === playerConfigs[idx].cameraMode));
  CAMERA_OPTIONS.forEach((_, dIdx) => {
    const dot = document.createElement('span');
    const active = dIdx === initCamIdx;
    dot.style.cssText = `width: 4px; height: 4px; border-radius: 50%; background: ${active ? '#00e5ff' : 'rgba(255,255,255,0.22)'};`;
    playerCameraDotsEls[idx].push(dot);
    dotsWrap.appendChild(dot);
  });
  camTitleWrap.append(camTitle, dotsWrap);

  const cameraCyclerRow = document.createElement('div');
  cameraCyclerRow.style.cssText = 'display: flex; gap: 4px; align-items: center; flex: 1; min-width: 0;';

  const btnPrevCam = document.createElement('button');
  btnPrevCam.textContent = '<';
  btnPrevCam.style.cssText = 'padding: 5px 8px; font-size: 10.5px; font-weight: 800; font-family: inherit; color: #ffffff; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 5px; cursor: pointer;';
  btnPrevCam.onclick = () => {
    playerFocusRow[idx] = currentSetupMode === 'practice' ? 5 : 4;
    focusedColumn = idx;
    cyclePlayerCamera(idx, -1);
    updateFocusUI();
  };

  const cameraLabelEl = document.createElement('div');
  cameraLabelEl.id = `label-camera-p${idx + 1}`;
  cameraLabelEl.style.cssText = 'flex: 1; padding: 5px 6px; font-size: 10px; font-weight: 800; text-align: center; color: #00e5ff; background: rgba(0, 229, 255, 0.08); border: 1px solid rgba(0, 229, 255, 0.28); border-radius: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;';
  const initialCamOpt = CAMERA_OPTIONS[initCamIdx];
  cameraLabelEl.textContent = initialCamOpt ? initialCamOpt.label : (playerConfigs[idx].cameraMode || 'CHASE').toUpperCase();
  cameraLabelEl.onclick = () => {
    playerFocusRow[idx] = currentSetupMode === 'practice' ? 5 : 4;
    focusedColumn = idx;
    cyclePlayerCamera(idx, 1);
    updateFocusUI();
  };
  playerCameraLabelEls[idx] = cameraLabelEl;

  const btnNextCam = document.createElement('button');
  btnNextCam.textContent = '>';
  btnNextCam.style.cssText = 'padding: 5px 8px; font-size: 10.5px; font-weight: 800; font-family: inherit; color: #ffffff; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 5px; cursor: pointer;';
  btnNextCam.onclick = () => {
    playerFocusRow[idx] = currentSetupMode === 'practice' ? 5 : 4;
    focusedColumn = idx;
    cyclePlayerCamera(idx, 1);
    updateFocusUI();
  };

  cameraCyclerRow.append(btnPrevCam, cameraLabelEl, btnNextCam);
  cameraRow.append(camTitleWrap, cameraCyclerRow);
  charCard.appendChild(cameraRow);
  playerRowElements[idx][4] = cameraRow;

  // Row 5 (Match) / Row 6 (Practice): Strike Assist Preset (Single-line horizontal row)
  const assistRow = document.createElement('div');
  assistRow.id = `row-assist-p${idx + 1}`;
  assistRow.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 2px 3px; border-radius: 6px; transition: all 0.15s ease;';

  const assistTitle = document.createElement('div');
  assistTitle.style.cssText = 'font-size: 9.5px; font-weight: 800; color: #94a3b8; min-width: 38px; letter-spacing: 0.06em;';
  assistTitle.textContent = 'ASSIST';

  const assistBtnRow = document.createElement('div');
  assistBtnRow.style.cssText = 'display: flex; gap: 4px; flex: 1;';

  playerAssistButtons[idx] = [];
  ASSIST_OPTIONS.forEach((opt) => {
    const btn = document.createElement('button');
    btn.textContent = opt.label;
    const isSelected = (playerConfigs[idx].assistPreset || 'standard') === opt.id;
    btn.style.cssText = `
      flex: 1;
      padding: 5px 4px;
      font-size: 9.5px;
      font-weight: 800;
      font-family: inherit;
      color: ${isSelected ? '#000000' : '#94a3b8'};
      background: ${isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.06)'};
      border: 1px solid ${isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.15)'};
      border-radius: 5px;
      white-space: nowrap;
      box-shadow: ${isSelected ? '0 0 8px rgba(56, 189, 248, 0.45)' : 'none'};
      cursor: pointer;
      transition: all 0.15s ease;
    `;
    btn.onclick = () => {
      playerFocusRow[idx] = currentSetupMode === 'practice' ? 6 : 5;
      focusedColumn = idx;
      updateFocusUI();
      setPlayerAssist(idx, opt.id);
    };
    playerAssistButtons[idx].push({ btn, id: opt.id });
    assistBtnRow.appendChild(btn);
  });
  assistRow.append(assistTitle, assistBtnRow);
  charCard.appendChild(assistRow);
  playerRowElements[idx][5] = assistRow;

  col.appendChild(charCard);

  // Row 6: Control Type (Human / AI Difficulty) + Row 7: AI Style (Placed at the BOTTOM of the selection menu)
  const typeCard = document.createElement('div');
  typeCard.id = `type-options-card-p${idx + 1}`;
  typeCard.style.cssText = 'display: flex; flex-direction: column; gap: 4px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 5px;';

  const typeRow = document.createElement('div');
  typeRow.id = `row-type-status-p${idx + 1}`;
  typeRow.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 2px 3px; border-radius: 6px; transition: all 0.15s ease;';

  const ctrlLabel = document.createElement('div');
  ctrlLabel.style.cssText = 'font-size: 9.5px; font-weight: 800; color: #94a3b8; min-width: 38px; letter-spacing: 0.06em;';
  ctrlLabel.textContent = 'CTRL';
  typeRow.appendChild(ctrlLabel);

  const typeBtnWrap = document.createElement('div');
  typeBtnWrap.style.cssText = 'display: flex; gap: 4px; flex: 1;';

  playerTypeButtons[idx] = [];
  [
    { id: 'human', label: 'HUMAN' },
    { id: 'ai-easy', label: 'EASY' },
    { id: 'ai-medium', label: 'MED' },
    { id: 'ai-hard', label: 'HARD' },
  ].forEach((t) => {
    const btn = document.createElement('button');
    btn.textContent = t.label;
    const curType = playerConfigs[idx].type || 'human';
    const curDiff = playerConfigs[idx].difficulty || 'medium';
    const activeId = curType === 'human' ? 'human' : 'ai-' + curDiff;
    const isSelected = activeId === t.id;

    btn.style.cssText = `
      flex: 1;
      padding: 5px 4px;
      font-size: 9.5px;
      font-weight: 800;
      font-family: inherit;
      color: ${isSelected ? '#000000' : '#94a3b8'};
      background: ${isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.06)'};
      border: 1px solid ${isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.15)'};
      border-radius: 5px;
      white-space: nowrap;
      cursor: pointer;
      box-shadow: ${isSelected ? '0 0 8px rgba(255, 255, 255, 0.35)' : 'none'};
      transition: all 0.12s ease;
    `;
    btn.onclick = () => {
      playerFocusRow[idx] = 6;
      focusedColumn = idx;
      updateFocusUI();
      setPlayerType(idx, t.id);
    };
    playerTypeButtons[idx].push({ btn, typeId: t.id });
    typeBtnWrap.appendChild(btn);
  });
  typeRow.appendChild(typeBtnWrap);
  typeCard.appendChild(typeRow);

  // Row 7: Single-line AI Aggressiveness Row (visible when AI is selected)
  const isAi = playerConfigs[idx].type === 'ai';
  const aggContainer = document.createElement('div');
  aggContainer.id = `agg-container-p${idx + 1}`;
  aggContainer.style.cssText = `
    display: ${isAi ? 'flex' : 'none'};
    align-items: center;
    gap: 6px;
    padding: 2px 3px;
    border-radius: 6px;
  `;

  const aggTitle = document.createElement('span');
  aggTitle.style.cssText = 'font-size: 9.5px; font-weight: 800; color: #94a3b8; min-width: 38px; letter-spacing: 0.06em;';
  aggTitle.textContent = 'STYLE';
  aggContainer.appendChild(aggTitle);

  const aggBadge = document.createElement('span');
  aggBadge.id = `agg-badge-p${idx + 1}`;
  const curAggVal = Math.round((playerConfigs[idx].aggressiveness ?? 0.60) * 100);
  const badgeInfo = getAggressivenessBadge(curAggVal);
  aggBadge.style.cssText = 'display: none;';
  aggBadge.textContent = badgeInfo.label;
  aggContainer.appendChild(aggBadge);

  const aggSlider = document.createElement('input');
  aggSlider.type = 'range';
  aggSlider.id = `agg-slider-p${idx + 1}`;
  aggSlider.min = '0';
  aggSlider.max = '100';
  aggSlider.step = '5';
  aggSlider.value = String(curAggVal);
  aggSlider.style.display = 'none';
  aggContainer.appendChild(aggSlider);

  aggContainer.onclick = () => {
    playerFocusRow[idx] = 7;
    focusedColumn = idx;
    updateFocusUI();
  };

  const chipsRow = document.createElement('div');
  chipsRow.id = `agg-chips-p${idx + 1}`;
  chipsRow.style.cssText = 'display: flex; gap: 4px; flex: 1;';
  [
    { label: 'DEF', val: 0.25 },
    { label: 'BAL', val: 0.60 },
    { label: 'AGG', val: 0.80 },
    { label: 'ALL', val: 1.00 },
  ].forEach((chip) => {
    const chipBtn = document.createElement('button');
    chipBtn.textContent = chip.label;
    const isChipSel = Math.abs((playerConfigs[idx].aggressiveness ?? 0.60) - chip.val) <= 0.12;
    chipBtn.style.cssText = `
      flex: 1;
      font-size: 9.5px;
      font-weight: 800;
      padding: 5px 4px;
      border-radius: 5px;
      white-space: nowrap;
      background: ${isChipSel ? '#00e5ff' : 'rgba(255, 255, 255, 0.06)'};
      border: 1px solid ${isChipSel ? '#00e5ff' : 'rgba(255, 255, 255, 0.14)'};
      color: ${isChipSel ? '#000000' : '#cbd5e1'};
      cursor: pointer;
    `;
    chipBtn.onclick = (e) => {
      e.stopPropagation();
      playerFocusRow[idx] = 7;
      focusedColumn = idx;
      aggSlider.value = String(Math.round(chip.val * 100));
      setPlayerAggressiveness(idx, chip.val);
      Array.from(chipsRow.children).forEach((b, cIdx) => {
        const sel = [0.25, 0.60, 0.80, 1.00][cIdx] === chip.val;
        b.style.background = sel ? '#00e5ff' : 'rgba(255, 255, 255, 0.06)';
        b.style.borderColor = sel ? '#00e5ff' : 'rgba(255, 255, 255, 0.14)';
        b.style.color = sel ? '#000000' : '#cbd5e1';
      });
      updateFocusUI();
    };
    chipsRow.appendChild(chipBtn);
  });
  aggContainer.appendChild(chipsRow);

  typeCard.appendChild(aggContainer);
  playerRowElements[idx][6] = typeRow;
  playerRowElements[idx][7] = aggContainer;
  col.appendChild(typeCard);

  // Row 8: Next Button
  playerRowElements[idx][8] = btnNext;

  return col;
}

function clearControllerFocusStyle(el) {
  if (!el) return;
  el.classList.remove('rainbow-focused');
  el.style.outline = 'none';
  el.style.boxShadow = 'none';
  if (!el.tagName || el.tagName !== 'BUTTON') {
    if (el.id !== 'match-ball-selector-box' && el.id !== 'match-duration-selector-box' && el.id !== 'arena-selector-box') {
      el.style.background = 'transparent';
    }
  }
  el.style.transform = 'scale(1)';
  const badge = el.querySelector(':scope > .ctrl-focus-pill');
  if (badge) badge.remove();
}

function applyControllerFocusStyle(el, controllerSlotIdx, customLabel = null) {
  if (!el) return;
  el.classList.remove('rainbow-focused');
  const theme = getPlayerSlotTheme(controllerSlotIdx);
  el.style.outline = `2px solid ${theme.hex}`;
  el.style.outlineOffset = '1px';
  el.style.boxShadow = `0 0 14px ${theme.glow}, inset 0 0 8px ${theme.bg}`;
  if (!el.tagName || el.tagName !== 'BUTTON') {
    if (el.id !== 'match-ball-selector-box' && el.id !== 'match-duration-selector-box' && el.id !== 'arena-selector-box') {
      el.style.background = theme.bg;
    }
  }
  el.style.position = 'relative';
  let badge = el.querySelector(':scope > .ctrl-focus-pill');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'ctrl-focus-pill';
    el.appendChild(badge);
  }
  badge.style.cssText = `
    position: absolute;
    top: -9px;
    right: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: #060b13;
    border: 1.5px solid ${theme.hex};
    color: ${theme.hex};
    font-size: 8.5px;
    font-weight: 900;
    letter-spacing: 0.06em;
    line-height: 1.2;
    pointer-events: none;
    z-index: 5;
    box-shadow: 0 2px 6px rgba(0,0,0,0.75);
    white-space: nowrap;
  `;
  badge.textContent = customLabel || `${theme.short}`;
}

export function updateFocusUI() {
  const ballBox = document.getElementById('match-ball-selector-box');
  const durationBox = document.getElementById('match-duration-selector-box');
  const arenaBox = document.getElementById('arena-selector-box');
  const sharedCursor = !isVersusLobby();

  const lbBadge = document.getElementById('badge-p1-lb');
  const rbBadge = document.getElementById('badge-p2-rb');
  const showSwitchBadges = currentSetupMode === 'match' && playerConfigs.some((c, i) => i < getActiveMatchPlayerCount() && c.type === 'ai');
  if (lbBadge) lbBadge.style.display = showSwitchBadges ? 'inline-flex' : 'none';
  if (rbBadge) rbBadge.style.display = showSwitchBadges ? 'inline-flex' : 'none';

  if (setupLegendEl) {
    if (currentSetupMode === 'practice') {
      setupLegendEl.innerHTML = `🎮 <b>↕</b> ROW &middot; <b>◀ ▶</b> CHANGE &middot; <b style="color:#10b981;">START</b> LAUNCH PRACTICE &middot; ${renderCardinalDiamondSvg('east', '#f87171', 12)} <b>○/B / ESC</b> TITLE`;
    } else if (setupPage === 2) {
      setupLegendEl.innerHTML = `🎮 <b style="color:#00e5ff;">P1 ONLY: ↕ / ◀ ▶ MATCH RULES</b> &middot; ${renderCardinalDiamondSvg('west', '#10b981', 12)} <b style="color:#10b981;">□/X / START</b> OWN READY &middot; ${renderCardinalDiamondSvg('south', '#00e5ff', 12)} <b style="color:#00e5ff;">✕/A / START</b> P1 LAUNCH &middot; ${renderCardinalDiamondSvg('east', '#f87171', 12)} <b>○/B / ESC</b> PLAYERS`;
    } else if (!sharedCursor) {
      setupLegendEl.innerHTML = `🎮 EACH CONTROLLER EDITS ITS OWN PLAYER &amp; TEAM &middot; <b>↕</b> ROW &middot; <b>◀ ▶</b> CHANGE &middot; <b style="color:#00e5ff;">P1 LB/RB/TAB</b> EDIT AI &middot; <b style="color:#10b981;">START</b> MATCH RULES ➔ &middot; ${renderCardinalDiamondSvg('east', '#f87171', 12)} <b>○/B</b> CONTROLLERS`;
    } else {
      setupLegendEl.innerHTML = `🎮 <b>↕</b> ROW &middot; <b>◀ ▶</b> CHANGE &middot; ${renderCardinalDiamondSvg('north', '#f59e0b', 12)} <b style="color:#f59e0b;">△/Y</b> JOIN / BOT &middot; <b style="color:#00e5ff;">P1 LB / RB / TAB</b> SWITCH SLOT &middot; <b style="color:#10b981;">START</b> MATCH RULES ➔ &middot; ${renderCardinalDiamondSvg('east', '#f87171', 12)} <b>○/B</b> CONTROLLERS`;
    }
  }

  // 1. PRACTICE MODE (Single Page)
  if (currentSetupMode === 'practice') {
    if (ctrlTagEls[0]) {
      ctrlTagEls[0].textContent = '[P1 ACTIVE]';
      ctrlTagEls[0].style.color = '#00e5ff';
    }

    const activeRow = playerFocusRow[0];

    const practiceRowMap = {
      1: playerRowElements[0]?.[0], // Team Status
      2: playerRowElements[0]?.[1], // Team Color
      3: playerRowElements[0]?.[2], // Headwear
      4: playerRowElements[0]?.[3], // Physique
      5: playerRowElements[0]?.[4], // Camera
      6: playerRowElements[0]?.[5], // Strike Assist
    };

    [1, 2, 3, 4, 5, 6].forEach((rIdx) => {
      const el = practiceRowMap[rIdx];
      if (!el) return;
      if (rIdx === activeRow) {
        applyControllerFocusStyle(el, 0, 'P1');
      } else {
        clearControllerFocusStyle(el);
      }
    });

    // Row 7: Practice Ball Selector Box
    if (ballBox) {
      if (activeRow === 7) {
        applyControllerFocusStyle(ballBox, 0, 'P1');
      } else {
        clearControllerFocusStyle(ballBox);
        ballBox.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      }
    }

    // Row 8: Action Row (Back and Start Drill)
    if (btnBack && btnStartMatch) {
      if (activeRow === 8) {
        if (practiceActionCol === 0) {
          applyControllerFocusStyle(btnBack, 0, 'P1');
          clearControllerFocusStyle(btnStartMatch);
        } else {
          applyControllerFocusStyle(btnStartMatch, 0, 'P1');
          clearControllerFocusStyle(btnBack);
        }
      } else {
        clearControllerFocusStyle(btnBack);
        clearControllerFocusStyle(btnStartMatch);
      }
    }
    return;
  }

  // 2. MATCH MODE SCREEN 2: MATCH RULES & CUSTOMIZATION
  // Only P1 controls Match Rules (Row 0 = Ball Size, Row 1 = Match Length, Row 2 = P1 Action Bar).
  // Other human players (P2-P4) default directly to their own color-coded Ready button.
  if (setupPage === 2) {
    if (ballBox) {
      if (matchRulesFocusRow === 0) {
        applyControllerFocusStyle(ballBox, 0, 'P1 RULES');
      } else {
        clearControllerFocusStyle(ballBox);
        ballBox.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      }
    }

    if (durationBox) {
      if (matchRulesFocusRow === 1) {
        applyControllerFocusStyle(durationBox, 0, 'P1 RULES');
      } else {
        clearControllerFocusStyle(durationBox);
        durationBox.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      }
    }

    if (arenaBox) {
      clearControllerFocusStyle(arenaBox);
    }

    const p1ActionBtns = [btnBack, btnReadyP1, btnStartMatch];
    const clampedP1Col = Math.max(0, Math.min(p1ActionBtns.length - 1, matchRulesActionCol));
    p1ActionBtns.forEach((btn, colIdx) => {
      if (!btn) return;
      const isFocused = (matchRulesFocusRow === 2) && (clampedP1Col === colIdx);
      if (isFocused) {
        applyControllerFocusStyle(btn, 0, 'P1');
      } else {
        clearControllerFocusStyle(btn);
      }
    });

    // P2, P3, P4 always focus their own Ready button on Page 2
    [1, 2, 3].forEach((slotIdx) => {
      const rBtn = playerReadyButtons[slotIdx];
      if (!rBtn) return;
      const isActiveSlot = slotIdx < getActiveMatchPlayerCount() && playerConfigs[slotIdx]?.type === 'human';
      if (isActiveSlot) {
        applyControllerFocusStyle(rBtn, slotIdx, `P${slotIdx + 1}`);
      } else {
        clearControllerFocusStyle(rBtn);
      }
    });
    return;
  }

  // 3. MATCH MODE SCREEN 1: TEAM & PLAYER SETUP
  // Every human slot ALWAYS has its own active row cursor highlight with its signature controller color & badge,
  // AND focusedColumn allows P1 (Slot 0) to configure AI slots via LB/RB/TAB.
  const activeIndices = getActivePlayerIndices();
  const humanCount = activeIndices.filter((i) => playerConfigs[i]?.type === 'human').length;
  const isSlotCursorActive = (s) => (humanCount > 1 ? (playerConfigs[s]?.type === 'human' || focusedColumn === s) : (playerConfigs[s]?.type === 'human' && s === 0) || focusedColumn === s);

  // Clear shared team rows first before applying active focus highlights
  [0, 1].forEach((teamRep) => {
    clearControllerFocusStyle(playerRowElements[teamRep]?.[0]);
    clearControllerFocusStyle(playerRowElements[teamRep]?.[1]);
  });

  activeIndices.forEach((idx) => {
    const slotTheme = getPlayerSlotTheme(idx);
    const tag = ctrlTagEls[idx];
    const col = colEls[idx];
    const isHumanSlot = playerConfigs[idx]?.type === 'human';
    if (tag) {
      if (isHumanSlot) {
        tag.innerHTML = `<span class="contextual-btn-badge" style="border-color:${slotTheme.hex};color:${slotTheme.hex};">${lobbyDeviceLabel(idx)}</span>`;
        tag.style.color = '#ffffff';
      } else if (focusedColumn === idx) {
        tag.innerHTML = `<span class="contextual-btn-badge" style="border-color:#00e5ff;color:#00e5ff;box-shadow:0 0 10px rgba(0,229,255,0.45);">P1 EDITING · △/Y: JOIN</span>`;
      } else {
        tag.innerHTML = `<span class="contextual-btn-badge" style="border-color:rgba(255,255,255,0.28);color:#94a3b8;">BOT · P1 LB/RB/TAB</span>`;
      }
    }
    if (col && !playerReadyState[idx]) {
      if (isSlotCursorActive(idx)) {
        col.style.borderColor = isHumanSlot ? slotTheme.hex : '#00e5ff';
      } else {
        col.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      }
    }

    const activeRow = playerFocusRow[idx];
    const isThisColActive = isSlotCursorActive(idx);
    const controllerOwner = isHumanSlot ? idx : 0;
    const badgeLabel = isHumanSlot ? slotTheme.short : `P1 ➔ BOT ${slotTheme.short}`;

    // Individual rows 2..7: 2=Headwear, 3=Physique, 4=Camera, 5=Assist, 6=Control Type, 7=AI Style
    [2, 3, 4, 5, 6, 7].forEach((rIdx) => {
      const el = playerRowElements[idx]?.[rIdx];
      if (!el) return;
      if (rIdx === activeRow && isThisColActive) {
        applyControllerFocusStyle(el, controllerOwner, badgeLabel);
      } else {
        clearControllerFocusStyle(el);
      }
    });
  });

  // Shared Team Header rows (0 = Team Kit, 1 = Team Color) for Team 1 ([0, 2]) and Team 2 ([1, 3])
  [
    { rep: 0, slots: [0, 2] },
    { rep: 1, slots: [1, 3] },
  ].forEach(({ rep, slots }) => {
    const validSlots = slots.filter((s) => activeIndices.includes(s));
    [0, 1].forEach((rIdx) => {
      const el = playerRowElements[rep]?.[rIdx];
      if (!el) return;
      const focusingSlots = validSlots.filter((s) => playerFocusRow[s] === rIdx && isSlotCursorActive(s));
      if (focusingSlots.length > 0) {
        const primarySlot = focusingSlots[0];
        const ownerIdx = playerConfigs[primarySlot]?.type === 'human' ? primarySlot : 0;
        const combinedLabel = focusingSlots
          .map((s) => (playerConfigs[s]?.type === 'human' ? getPlayerSlotTheme(s).short : `P1➔${getPlayerSlotTheme(s).short}`))
          .join(' + ');
        applyControllerFocusStyle(el, ownerIdx, combinedLabel);
      } else {
        clearControllerFocusStyle(el);
      }
    });
  });

  // Row 8: Action Row (Back and Next)
  if (btnBack && btnNext) {
    const actionSlots = activeIndices.filter(
      (i) => playerFocusRow[i] === 8 && isSlotCursorActive(i),
    );
    if (actionSlots.length > 0) {
      const primarySlot = actionSlots[0];
      const ownerIdx = playerConfigs[primarySlot]?.type === 'human' ? primarySlot : 0;
      const combinedLabel = actionSlots
        .map((s) => (playerConfigs[s]?.type === 'human' ? getPlayerSlotTheme(s).short : 'P1'))
        .join(' + ');
      if (screen1ActionCol === 0) {
        applyControllerFocusStyle(btnBack, ownerIdx, combinedLabel);
        clearControllerFocusStyle(btnNext);
      } else {
        applyControllerFocusStyle(btnNext, ownerIdx, combinedLabel);
        clearControllerFocusStyle(btnBack);
      }
    } else {
      clearControllerFocusStyle(btnNext);
      clearControllerFocusStyle(btnBack);
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
export function getCol3El() { return col3El; }
export function getCol4El() { return col4El; }
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
  get matchFormat() { return matchFormat; },
  set matchFormat(v) { matchFormat = v === '2v2' ? '2v2' : '1v1'; },
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
  getActiveMatchPlayerCount,
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
  isVersusLobby,
  claimLobbySlotForPad,
  toggleLobbySlotHumanAi,
  setPlayerType,
  setPlayerHeadwear,
  cyclePlayerHeadwear,
  setPlayerCamera,
  cyclePlayerCamera,
};
