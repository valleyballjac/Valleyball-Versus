/**
 * @file inGameMenu.js
 * Responsibility: Ultra-lean, zero-scroll in-game pause menu centered on Resume Game,
 * flanked by team-colored Home and Away Stat Boards (with rainbow stat numbers) during matches
 * and the untimed Hustle Board during practice.
 * Upstream: Initialized by `src/main.js` and toggled via `Escape` or controller `Start`.
 * Downstream: Calls `src/ui/mainMenu.js`, `src/config/hudConfig.js`, `src/features/match/matchManager.js`,
 * `src/audio/soundManager.js`, and `src/input/menuPads.js`.
 */

import { getColorName } from './mainMenu.js';
import { TUNING } from '../config/tuning.js';
import {
  getHudPrefs,
  subscribeHudPrefs,
  applyHudPreset,
  getActiveHudPresetId,
} from '../config/hudConfig.js';
import { buildMatchStatsReport } from '../features/match/matchManager.js';
import { soundManager } from '../audio/soundManager.js';
import { createMenuPadTracker, MENU_PAD } from '../input/menuPads.js';

let menuOverlayEl = null;
let centerCardEl = null;
let homeStatBoardEl = null;
let awayStatBoardEl = null;
let hustleBoardSection = null;
let isOpen = false;
let clockBannerEl = null;
let pauseOwnerBadgeEl = null;
let activePauseOwner = null;
const PAUSE_SLOT_HEX = ['#00e5ff', '#ff2e55', '#fbb417', '#a855f7'];

let callbacks = {
  onResume: null,
  onOpen: null,
  onRematch: null,
  onPracticeMode: null,
  onFinishPractice: null,
  onMainMenu: null,
  onRenderSettingsChange: null,
  onCameraChange: null,
  getCameraRows: null,
};

let camSectionEl = null;
const camBoxes = [null, null, null, null];
const camSelObjs = [null, null, null, null];

let hudPresetRowEl = null;
let hudPresetButtons = [];
let hudPresetOptions = [];
let hudPresetBadgeEl = null;

let volRowEl = null;
let volSliderEl = null;
let muteBtnEl = null;

let resumeBtnEl = null;
let rematchBtnEl = null;
let finishPracticeBtn = null;
let mainMenuBtnEl = null;

let inGameFocusIndex = 0;
let inGameNavRows = [];
let inGamePollHandle = null;
const inGamePads = createMenuPadTracker();

const CAMERA_MODES = ['chase', 'thirdPerson', 'firstPerson', 'tactical', 'broadcast'];
const CAMERA_LABELS = {
  chase: 'CHASE CAM',
  thirdPerson: 'BALL TRACK',
  firstPerson: '1ST PERSON',
  tactical: 'TACTICAL',
  broadcast: 'BROADCAST [SHARED]',
};

// Rainbow stat number palette (preserved across all team kit borders)
const STAT_RAINBOW = {
  goals: '#ff2a42',
  assists: '#ff8a00',
  touches: '#ffd000',
  accuracy: '#10e56a',
  sweetSpots: '#00e5ff',
  spikes: '#3b82f6',
  dives: '#a855f7',
  divingHits: '#ec4899',
};

function toHex(colorNum, fallback = 0xd90429) {
  const n = typeof colorNum === 'number' && Number.isFinite(colorNum) ? colorNum : fallback;
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}

function getColorLuminanceByte(colorNum) {
  const n = typeof colorNum === 'number' && Number.isFinite(colorNum) ? (colorNum & 0xffffff) : 0xd90429;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function getTeamBorderStyles(primaryColor) {
  const hex = toHex(primaryColor);
  const ultraDark = getColorLuminanceByte(primaryColor) < 32;
  return {
    hex,
    ultraDark,
    borderCss: `2px solid ${hex}`,
    shadowCss: ultraDark
      ? '0 0 0 1.5px rgba(226, 232, 240, 0.72), 0 16px 40px rgba(0, 0, 0, 0.82)'
      : `0 16px 40px rgba(0, 0, 0, 0.82), 0 0 22px ${hex}38`,
    badgeBorderHex: ultraDark ? '#cbd5e1' : hex,
    badgeBgCss: ultraDark ? 'rgba(24, 24, 27, 0.92)' : `${hex}26`,
    dotShadowCss: ultraDark ? '0 0 6px rgba(226, 232, 240, 0.7)' : `0 0 8px ${hex}`,
  };
}

function resumeFromInGameMenu() {
  if (!isOpen) return;
  hideInGameMenu();
  if (callbacks.onResume) callbacks.onResume();
}

export function initInGameMenu({
  onResume,
  onOpen,
  onRematch,
  onPracticeMode,
  onFinishPractice,
  onMainMenu,
  onRenderSettingsChange,
  onCameraChange,
  getCameraRows,
}) {
  if (menuOverlayEl) return;
  callbacks = {
    onResume,
    onOpen,
    onRematch,
    onPracticeMode,
    onFinishPractice,
    onMainMenu,
    onRenderSettingsChange,
    onCameraChange,
    getCameraRows,
  };

  menuOverlayEl = document.createElement('div');
  menuOverlayEl.id = 'ingame-menu-overlay';
  menuOverlayEl.style.cssText = `
    position: fixed;
    inset: 0;
    display: none;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 18px;
    padding: 16px 20px;
    box-sizing: border-box;
    overflow: hidden;
    background: rgba(4, 7, 12, 0.80);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    z-index: 900;
    user-select: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #cfe3f5;
  `;

  // Left Flanking Stat Board (Home Team in Match)
  homeStatBoardEl = document.createElement('aside');
  homeStatBoardEl.id = 'ingame-stat-board-home';
  homeStatBoardEl.style.cssText = `
    display: none;
    flex-direction: column;
    gap: 10px;
    width: 264px;
    max-width: 25vw;
    flex-shrink: 0;
    padding: 14px 16px;
    box-sizing: border-box;
    border-radius: 12px;
    background: rgba(11, 17, 26, 0.94);
    overflow: hidden;
  `;

  // Center Ultra-Lean Pause Card (Strictly Zero Scroll)
  centerCardEl = document.createElement('div');
  centerCardEl.id = 'ingame-pause-card';
  centerCardEl.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 11px;
    padding: 18px 24px 16px;
    box-sizing: border-box;
    background: rgba(11, 17, 26, 0.96);
    border: 1px solid rgba(120, 170, 210, 0.38);
    border-radius: 12px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.85), 0 0 22px rgba(59, 130, 246, 0.16);
    width: 472px;
    max-width: 92vw;
    max-height: 92vh;
    overflow: hidden;
    flex-shrink: 0;
  `;

  // Right Flanking Stat Board (Away Team in Match)
  awayStatBoardEl = document.createElement('aside');
  awayStatBoardEl.id = 'ingame-stat-board-away';
  awayStatBoardEl.style.cssText = `
    display: none;
    flex-direction: column;
    gap: 10px;
    width: 264px;
    max-width: 25vw;
    flex-shrink: 0;
    padding: 14px 16px;
    box-sizing: border-box;
    border-radius: 12px;
    background: rgba(11, 17, 26, 0.94);
    overflow: hidden;
  `;

  // Right Flanking Hustle Board (Practice Mode Only, Untimed)
  hustleBoardSection = document.createElement('aside');
  hustleBoardSection.id = 'ingame-hustle-board-section';
  hustleBoardSection.style.cssText = `
    display: none;
    flex-direction: column;
    gap: 10px;
    width: 280px;
    max-width: 28vw;
    flex-shrink: 0;
    padding: 14px 16px;
    box-sizing: border-box;
    border-radius: 12px;
    background: rgba(11, 17, 26, 0.94);
    border: 2px solid rgba(56, 189, 248, 0.45);
    overflow: hidden;
  `;

  // 1. Header inside Center Pause Card
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    border-bottom: 2px solid;
    border-image: linear-gradient(90deg, #FF2A42 0%, #FF6B00 14.3%, #FFD000 28.6%, #10E56A 42.9%, #00E5FF 57.2%, #1F65FF 71.5%, #6B11FF 85.8%, #E000B8 100%) 1;
    padding-bottom: 10px;
  `;

  const titleBox = document.createElement('div');
  titleBox.innerHTML = `
    <div style="font-size: 14px; font-weight: 700; letter-spacing: 0.06em; display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px;">
      <span style="font-family: 'Syncopate', sans-serif; font-weight: 700; background: linear-gradient(90deg, #FF2A42 0%, #FF6B00 14.3%, #FFD000 28.6%, #10E56A 42.9%, #00E5FF 57.2%, #1F65FF 71.5%, #6B11FF 85.8%, #E000B8 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;">VALLEYBALL</span>
      <span style="font-family: 'Syncopate', sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.2em; color: #F5F5F7;">VERSUS</span>
      <span style="color: rgba(255,255,255,0.3); font-size: 13px;">/</span>
      <span style="color: #ffffff; font-size: 13px; font-weight: 800;">PAUSED</span>
      <span style="font-size: 10px; font-weight: 800; color: #00e5ff; background: rgba(0, 229, 255, 0.12); border: 1px solid rgba(0, 229, 255, 0.35); padding: 1px 5px; border-radius: 4px;">v0.4.3</span>
    </div>
  `;

  const rightBadges = document.createElement('div');
  rightBadges.style.cssText = 'display: flex; flex-direction: column; align-items: flex-end; gap: 3px;';

  clockBannerEl = document.createElement('div');
  clockBannerEl.id = 'ingame-clock-banner';
  clockBannerEl.style.cssText = `
    font-size: 11px;
    font-weight: 800;
    padding: 3px 8px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 4px;
    letter-spacing: 0.05em;
    color: #e2e8f0;
    white-space: nowrap;
  `;
  clockBannerEl.textContent = 'MATCH PAUSED';

  pauseOwnerBadgeEl = document.createElement('div');
  pauseOwnerBadgeEl.id = 'ingame-pause-owner-badge';
  pauseOwnerBadgeEl.style.cssText = `
    display: none;
    font-size: 9.5px;
    font-weight: 900;
    padding: 2px 7px;
    border-radius: 4px;
    letter-spacing: 0.08em;
    background: rgba(0, 229, 255, 0.14);
    border: 1px solid #00e5ff;
    color: #00e5ff;
    white-space: nowrap;
  `;

  rightBadges.append(clockBannerEl, pauseOwnerBadgeEl);
  header.append(titleBox, rightBadges);
  centerCardEl.appendChild(header);

  // 2. Top Primary Action: RESUME GAME (always focus index 0)
  resumeBtnEl = document.createElement('button');
  resumeBtnEl.id = 'btn-ingame-resume';
  resumeBtnEl.type = 'button';
  resumeBtnEl.textContent = '▶ RESUME GAME';
  resumeBtnEl.style.cssText = `
    width: 100%;
    padding: 13px 16px;
    font-size: 15px;
    font-weight: 900;
    font-family: inherit;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border-radius: 8px;
    cursor: pointer;
    transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
  `;
  resumeBtnEl.onclick = () => resumeFromInGameMenu();
  centerCardEl.appendChild(resumeBtnEl);

  // 3. Active Human Cameras Section
  camSectionEl = document.createElement('div');
  camSectionEl.id = 'ingame-cam-section';
  camSectionEl.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

  const camHeading = document.createElement('div');
  camHeading.textContent = 'PLAYER CAMERAS';
  camHeading.style.cssText = 'font-size: 10.5px; font-weight: 800; letter-spacing: 0.12em; color: #94a3b8;';
  camSectionEl.appendChild(camHeading);

  const camGrid = document.createElement('div');
  camGrid.id = 'ingame-cam-grid';
  camGrid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px;';

  const team1CamGroup = document.createElement('div');
  team1CamGroup.id = 'ingame-cam-team-1';
  team1CamGroup.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

  const team2CamGroup = document.createElement('div');
  team2CamGroup.id = 'ingame-cam-team-2';
  team2CamGroup.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

  function createCamSelector(playerIndex) {
    const box = document.createElement('div');
    box.style.cssText = 'background: rgba(255, 255, 255, 0.04); padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.12);';
    const t = document.createElement('div');
    t.style.cssText = 'font-size: 10px; font-weight: 800; color: #cbd5e1; margin-bottom: 4px; letter-spacing: 0.03em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

    const controlRow = document.createElement('div');
    controlRow.style.cssText = 'display: flex; gap: 4px; align-items: center;';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.textContent = '<';
    prevBtn.style.cssText = 'padding: 4px 7px; font-family: inherit; font-size: 11px; font-weight: 900; background: rgba(255,255,255,0.08); color: #ffffff; border: 1px solid rgba(120, 170, 210, 0.35); border-radius: 4px; cursor: pointer;';

    const sel = document.createElement('select');
    sel.style.cssText = 'flex: 1; min-width: 0; padding: 4px 5px; font-family: inherit; font-size: 11px; font-weight: 700; background: #0f172a; color: #f8fafc; border: 1px solid rgba(120, 170, 210, 0.3); border-radius: 4px; cursor: pointer;';
    sel.onchange = () => applyCameraChoice(playerIndex, sel.value);

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = '>';
    nextBtn.style.cssText = 'padding: 4px 7px; font-family: inherit; font-size: 11px; font-weight: 900; background: rgba(255,255,255,0.08); color: #ffffff; border: 1px solid rgba(120, 170, 210, 0.35); border-radius: 4px; cursor: pointer;';

    prevBtn.onclick = () => cycleCam(playerIndex, sel, -1);
    nextBtn.onclick = () => cycleCam(playerIndex, sel, 1);

    controlRow.append(prevBtn, sel, nextBtn);
    box.append(t, controlRow);
    return { box, select: sel, title: t };
  }

  for (let i = 0; i < 4; i++) {
    const camSel = createCamSelector(i);
    camSelObjs[i] = camSel;
    camBoxes[i] = camSel.box;
    camBoxes[i].id = `ingame-p${i + 1}-cam-box`;
    if (i === 0 || i === 2) {
      team1CamGroup.appendChild(camSel.box);
    } else {
      team2CamGroup.appendChild(camSel.box);
    }
  }
  camGrid.append(team1CamGroup, team2CamGroup);
  camSectionEl.appendChild(camGrid);
  centerCardEl.appendChild(camSectionEl);

  // 4. Quick Settings Rows: 1-Row HUD Preset + 1-Row Master Volume & Mute
  const quickSettingsBox = document.createElement('div');
  quickSettingsBox.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding-top: 6px; border-top: 1px solid rgba(120, 170, 210, 0.16);';

  hudPresetRowEl = document.createElement('div');
  hudPresetRowEl.id = 'ingame-hud-preset-row';
  hudPresetRowEl.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; border-radius: 6px;';
  const hudPresetLeft = document.createElement('div');
  hudPresetLeft.style.cssText = 'display: flex; align-items: center; gap: 7px;';
  const hudPresetLabel = document.createElement('div');
  hudPresetLabel.textContent = 'HUD Preset';
  hudPresetLabel.style.cssText = 'font-size: 12px; font-weight: 700; color: #e2e8f0;';
  hudPresetBadgeEl = document.createElement('span');
  hudPresetBadgeEl.id = 'ingame-hud-preset-badge';
  hudPresetBadgeEl.style.cssText = 'font-size: 9.5px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; padding: 1px 6px; border-radius: 999px; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(56, 189, 248, 0.35); color: #38bdf8;';
  hudPresetLeft.append(hudPresetLabel, hudPresetBadgeEl);

  const hudPresetGroup = document.createElement('div');
  hudPresetGroup.style.cssText = 'display: flex; gap: 5px;';
  hudPresetOptions = [
    { id: 'minimal', btnId: 'btn-ingame-hud-preset-minimal', label: 'Minimal' },
    { id: 'standard', btnId: 'btn-ingame-hud-preset-standard', label: 'Standard' },
    { id: 'rookie', btnId: 'btn-ingame-hud-preset-rookie', label: 'Rookie' },
  ];
  hudPresetButtons = [];
  const initHudPresetId = getActiveHudPresetId();
  hudPresetBadgeEl.textContent = hudPresetOptions.find((o) => o.id === initHudPresetId)?.label || 'Custom';
  hudPresetOptions.forEach((opt) => {
    const btn = document.createElement('button');
    btn.id = opt.btnId;
    btn.type = 'button';
    btn.textContent = opt.label;
    const isSel = initHudPresetId === opt.id;
    btn.style.cssText = `
      padding: 5px 10px;
      font-size: 11px;
      font-weight: 700;
      font-family: inherit;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid rgba(120, 170, 210, 0.32);
      transition: all 0.12s ease;
      background: ${isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.06)'};
      color: ${isSel ? '#ffffff' : '#94a3b8'};
    `;
    btn.onclick = () => {
      applyHudPreset(opt.id);
      const nextOverlay = Boolean(getHudPrefs().controlsOverlay);
      if (callbacks.onRenderSettingsChange) {
        callbacks.onRenderSettingsChange({ showControlsOverlay: nextOverlay });
      }
    };
    hudPresetButtons.push(btn);
    hudPresetGroup.appendChild(btn);
  });
  hudPresetRowEl.append(hudPresetLeft, hudPresetGroup);
  quickSettingsBox.appendChild(hudPresetRowEl);

  const syncHudToggleButtons = () => {
    const activePreset = getActiveHudPresetId();
    hudPresetButtons.forEach((b, idx) => {
      const isSel = hudPresetOptions[idx].id === activePreset;
      b.style.background = isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
      b.style.color = isSel ? '#ffffff' : '#94a3b8';
    });
    if (hudPresetBadgeEl) {
      hudPresetBadgeEl.textContent = hudPresetOptions.find((o) => o.id === activePreset)?.label || 'Custom';
      hudPresetBadgeEl.style.color = activePreset === 'custom' ? '#fbbf24' : '#38bdf8';
    }
  };
  subscribeHudPrefs(syncHudToggleButtons);
  syncHudToggleButtons();
  menuOverlayEl._syncHudPrefs = syncHudToggleButtons;

  // Master Volume + inline Mute button row
  volRowEl = document.createElement('div');
  volRowEl.id = 'ingame-volume-row';
  volRowEl.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; border-radius: 6px;';
  const volLabel = document.createElement('div');
  volLabel.style.cssText = 'font-size: 12px; font-weight: 700; color: #e2e8f0; display: flex; align-items: center;';
  const volTitleSpan = document.createElement('span');
  volTitleSpan.textContent = 'Master Volume';
  const volValSpan = document.createElement('span');
  volValSpan.id = 'ingame-volume-val';
  volValSpan.style.cssText = 'color: #60a5fa; font-weight: 800; margin-left: 6px;';
  const initialVol = Math.round(soundManager.getMasterVolume() * 100);
  volValSpan.textContent = `${initialVol}%`;
  volLabel.append(volTitleSpan, volValSpan);

  const volControls = document.createElement('div');
  volControls.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  volSliderEl = document.createElement('input');
  volSliderEl.id = 'ingame-volume-slider';
  volSliderEl.type = 'range';
  volSliderEl.min = '0';
  volSliderEl.max = '100';
  volSliderEl.value = String(initialVol);
  volSliderEl.style.cssText = 'width: 118px; cursor: pointer; accent-color: #2563eb;';

  muteBtnEl = document.createElement('button');
  muteBtnEl.id = 'btn-ingame-mute';
  muteBtnEl.type = 'button';
  muteBtnEl.style.cssText = `
    padding: 5px 10px;
    font-size: 11px;
    font-weight: 700;
    font-family: inherit;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid rgba(120, 170, 210, 0.32);
    transition: all 0.12s ease;
  `;

  const updateMuteBtnState = (isMuted) => {
    muteBtnEl.textContent = isMuted ? 'Muted' : 'Mute';
    muteBtnEl.style.background = isMuted ? '#ef4444' : 'rgba(255, 255, 255, 0.06)';
    muteBtnEl.style.color = isMuted ? '#ffffff' : '#94a3b8';
  };
  updateMuteBtnState(soundManager.isMuted());

  volSliderEl.oninput = (e) => {
    const val = parseInt(e.target.value, 10);
    volValSpan.textContent = `${val}%`;
    soundManager.setMasterVolume(val / 100);
    if (val > 0 && soundManager.isMuted()) {
      soundManager.setMuted(false);
      updateMuteBtnState(false);
    }
  };

  muteBtnEl.onclick = () => {
    const nowMuted = !soundManager.isMuted();
    soundManager.setMuted(nowMuted);
    updateMuteBtnState(nowMuted);
  };

  volControls.append(volSliderEl, muteBtnEl);
  volRowEl.append(volLabel, volControls);
  quickSettingsBox.appendChild(volRowEl);
  centerCardEl.appendChild(quickSettingsBox);

  menuOverlayEl._updateAudioUI = () => {
    const vol = Math.round(soundManager.getMasterVolume() * 100);
    volSliderEl.value = String(vol);
    volValSpan.textContent = `${vol}%`;
    updateMuteBtnState(soundManager.isMuted());
  };

  // 5. Secondary Bottom Action Row (REMATCH or FINISH PRACTICE + MAIN MENU)
  const actionsBox = document.createElement('div');
  actionsBox.style.cssText = 'display: flex; gap: 10px; padding-top: 10px; border-top: 1px solid rgba(120, 170, 210, 0.2);';

  rematchBtnEl = document.createElement('button');
  rematchBtnEl.id = 'btn-ingame-rematch';
  rematchBtnEl.type = 'button';
  rematchBtnEl.textContent = 'REMATCH';
  rematchBtnEl.style.cssText = `
    flex: 1;
    padding: 10px 12px;
    font-size: 12.5px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #00e5ff;
    background: rgba(0, 229, 255, 0.10);
    border: 1px solid rgba(0, 229, 255, 0.42);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.12s ease;
  `;
  rematchBtnEl.onclick = () => {
    hideInGameMenu();
    if (callbacks.onRematch) callbacks.onRematch();
  };

  finishPracticeBtn = document.createElement('button');
  finishPracticeBtn.id = 'btn-finish-practice';
  finishPracticeBtn.type = 'button';
  finishPracticeBtn.textContent = 'FINISH PRACTICE';
  finishPracticeBtn.style.cssText = `
    display: none;
    flex: 1;
    padding: 10px 12px;
    font-size: 12.5px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #04130d;
    background: #10b981;
    border: 1px solid #34d399;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.12s ease;
  `;
  finishPracticeBtn.onclick = () => {
    hideInGameMenu();
    if (callbacks.onFinishPractice) callbacks.onFinishPractice();
  };

  mainMenuBtnEl = document.createElement('button');
  mainMenuBtnEl.id = 'btn-ingame-main-menu';
  mainMenuBtnEl.type = 'button';
  mainMenuBtnEl.textContent = 'MAIN MENU';
  mainMenuBtnEl.style.cssText = `
    flex: 1;
    padding: 10px 12px;
    font-size: 12.5px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #cfe3f5;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.12s ease;
  `;
  mainMenuBtnEl.onclick = () => {
    hideInGameMenu();
    if (callbacks.onMainMenu) callbacks.onMainMenu();
  };

  actionsBox.append(rematchBtnEl, finishPracticeBtn, mainMenuBtnEl);
  centerCardEl.appendChild(actionsBox);

  const legendFooter = document.createElement('div');
  legendFooter.style.cssText = `
    padding-top: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #94a3b8;
    text-align: center;
  `;
  legendFooter.innerHTML = '<b style="color:#ffffff;">↕</b> NAVIGATE &middot; <b style="color:#ffffff;">◀ ▶ / A</b> CHANGE &middot; <b style="color:#00e5ff;">B / START / ESC</b> RESUME';
  centerCardEl.appendChild(legendFooter);

  menuOverlayEl.append(homeStatBoardEl, centerCardEl, awayStatBoardEl, hustleBoardSection);
  menuOverlayEl._getFocusIndex = () => inGameFocusIndex;
  menuOverlayEl._getNavRows = () => inGameNavRows;
  document.body.appendChild(menuOverlayEl);
}

function renderTeamStatBoardCard(boardEl, teamData, is2v2) {
  if (!boardEl || !teamData) return;
  const styles = getTeamBorderStyles(teamData.primaryColor);
  const kitName = getColorName(teamData.primaryColor).toUpperCase();
  const rosterSlots = (teamData.players || []).map((p) => p.shortLabel).join(' & ') || teamData.kitLabel;

  boardEl.style.border = styles.borderCss;
  boardEl.style.boxShadow = styles.shadowCss;
  boardEl.dataset.teamColor = styles.hex;

  const statCells = [
    { label: 'GOALS', value: teamData.goals ?? 0, color: STAT_RAINBOW.goals },
    ...(is2v2 ? [{ label: 'ASSISTS', value: teamData.assists ?? 0, color: STAT_RAINBOW.assists }] : []),
    { label: 'TOUCHES', value: teamData.totalTouches ?? 0, color: STAT_RAINBOW.touches },
    { label: 'ACCURACY', value: `${teamData.accuracy ?? 0}%`, sub: `${teamData.hits ?? 0}H / ${teamData.whiffs ?? 0}W`, color: STAT_RAINBOW.accuracy },
    { label: 'SWEET SPOTS', value: teamData.sweetSpotHits ?? 0, color: STAT_RAINBOW.sweetSpots },
    { label: 'SPIKES', value: teamData.spikes ?? 0, color: STAT_RAINBOW.spikes },
    { label: 'DIVES', value: teamData.dives ?? 0, color: STAT_RAINBOW.dives },
    { label: 'DIVING HITS', value: teamData.divingHits ?? 0, color: STAT_RAINBOW.divingHits },
  ];

  const cellsHtml = statCells.map((cell) => `
    <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 6px; padding: 7px 8px; display: flex; flex-direction: column; justify-content: center;">
      <div style="font-size: 9px; font-weight: 800; letter-spacing: 0.08em; color: #94a3b8;">${cell.label}</div>
      <div style="font-size: 18px; font-weight: 900; color: ${cell.color}; margin-top: 2px; line-height: 1.1;">${cell.value}</div>
      ${cell.sub ? `<div style="font-size: 8.5px; color: #64748b; margin-top: 1px;">${cell.sub}</div>` : ''}
    </div>
  `).join('');

  boardEl.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.12);">
      <div style="display: flex; flex-direction: column; gap: 4px; min-width: 0;">
        <span class="ingame-stat-team-badge" style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 999px; border: 1.5px solid ${styles.badgeBorderHex}; background: ${styles.badgeBgCss}; font-size: 10px; font-weight: 900; letter-spacing: 0.08em; color: #f8fafc; width: fit-content;">
          <span style="width: 7px; height: 7px; border-radius: 50%; background: ${styles.hex}; box-shadow: ${styles.dotShadowCss}; flex-shrink: 0;"></span>
          <span>${teamData.kitLabel} &middot; ${kitName}</span>
        </span>
        <span style="font-size: 9.5px; font-weight: 700; color: #94a3b8; letter-spacing: 0.06em;">${rosterSlots}</span>
      </div>
      <div style="font-size: 28px; font-weight: 900; color: #ffffff; line-height: 1;">${teamData.goals ?? 0}</div>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
      ${cellsHtml}
    </div>
  `;
}

function refreshMatchAndPracticeSideBoards(isPractice, isReplay) {
  if (isPractice) {
    if (homeStatBoardEl) homeStatBoardEl.style.display = 'none';
    if (awayStatBoardEl) awayStatBoardEl.style.display = 'none';
    if (hustleBoardSection) {
      const vb = typeof window !== 'undefined' ? window.__vb : null;
      const stats = vb?.practiceStats || {};
      const p1Color = vb?.athletes?.[0]?.primaryColor ?? TUNING.players?.[0]?.primaryColor ?? TUNING.athlete?.palette?.homePrimary ?? 0xd90429;
      const styles = getTeamBorderStyles(p1Color);
      const kitName = getColorName(p1Color).toUpperCase();
      const hits = stats.hits || 0;
      const whiffs = stats.whiffs || 0;
      const attempts = hits + whiffs;
      const acc = attempts > 0 ? Math.round((hits / attempts) * 100) : 0;

      hustleBoardSection.style.display = 'flex';
      hustleBoardSection.style.border = styles.borderCss;
      hustleBoardSection.style.boxShadow = styles.shadowCss;
      hustleBoardSection.dataset.teamColor = styles.hex;
      hustleBoardSection.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.14); padding-bottom: 8px;">
          <span style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 999px; border: 1.5px solid ${styles.badgeBorderHex}; background: ${styles.badgeBgCss}; font-size: 10px; font-weight: 900; letter-spacing: 0.08em; color: #f8fafc;">
            <span style="width: 7px; height: 7px; border-radius: 50%; background: ${styles.hex}; box-shadow: ${styles.dotShadowCss};"></span>
            <span>HUSTLE BOARD &middot; ${kitName}</span>
          </span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
          <div style="background: rgba(255,255,255,0.04); padding: 7px 8px; border-radius: 6px;">
            <div style="font-size: 9px; color: #94a3b8; font-weight: 800;">GOALS</div>
            <div style="font-size: 18px; font-weight: 900; color: ${STAT_RAINBOW.goals}; margin-top: 2px;">${stats.goals || 0}</div>
          </div>
          <div style="background: rgba(255,255,255,0.04); padding: 7px 8px; border-radius: 6px;">
            <div style="font-size: 9px; color: #94a3b8; font-weight: 800;">ACCURACY</div>
            <div style="font-size: 18px; font-weight: 900; color: ${STAT_RAINBOW.accuracy}; margin-top: 2px;">${acc}%</div>
            <div style="font-size: 8.5px; color: #64748b;">${hits}H / ${whiffs}W</div>
          </div>
          <div style="background: rgba(255,255,255,0.04); padding: 7px 8px; border-radius: 6px;">
            <div style="font-size: 9px; color: #94a3b8; font-weight: 800;">SWEET SPOTS</div>
            <div style="font-size: 18px; font-weight: 900; color: ${STAT_RAINBOW.sweetSpots}; margin-top: 2px;">${stats.sweetSpots || 0}</div>
          </div>
          <div style="background: rgba(255,255,255,0.04); padding: 7px 8px; border-radius: 6px;">
            <div style="font-size: 9px; color: #94a3b8; font-weight: 800;">SPIKES</div>
            <div style="font-size: 18px; font-weight: 900; color: ${STAT_RAINBOW.spikes}; margin-top: 2px;">${stats.spikes || 0}</div>
          </div>
          <div style="background: rgba(255,255,255,0.04); padding: 7px 8px; border-radius: 6px;">
            <div style="font-size: 9px; color: #94a3b8; font-weight: 800;">DIVES</div>
            <div style="font-size: 18px; font-weight: 900; color: ${STAT_RAINBOW.dives}; margin-top: 2px;">${stats.dives || 0}</div>
          </div>
          <div style="background: rgba(255,255,255,0.04); padding: 7px 8px; border-radius: 6px;">
            <div style="font-size: 9px; color: #94a3b8; font-weight: 800;">DIVING HITS</div>
            <div style="font-size: 18px; font-weight: 900; color: ${STAT_RAINBOW.divingHits}; margin-top: 2px;">${stats.divingHits || 0}</div>
          </div>
          <div style="background: rgba(255,255,255,0.04); padding: 7px 8px; border-radius: 6px; grid-column: span 2;">
            <div style="font-size: 9px; color: #94a3b8; font-weight: 800;">TOTAL TOUCHES</div>
            <div style="font-size: 18px; font-weight: 900; color: ${STAT_RAINBOW.touches}; margin-top: 2px;">${stats.totalTouches || 0}</div>
          </div>
        </div>
      `;
    }
    return;
  }

  if (hustleBoardSection) hustleBoardSection.style.display = 'none';
  if (isReplay) {
    if (homeStatBoardEl) homeStatBoardEl.style.display = 'none';
    if (awayStatBoardEl) awayStatBoardEl.style.display = 'none';
    return;
  }

  const vb = typeof window !== 'undefined' ? window.__vb : null;
  const report = buildMatchStatsReport({
    match: vb?.matchState || null,
    athletes: vb?.athletes || [],
    athleteMatchStats: vb?.athleteMatchStats || [],
    playerConfigs: vb?.getPlayerConfigs?.() || TUNING.players || [],
  });

  if (homeStatBoardEl) {
    homeStatBoardEl.style.display = 'flex';
    renderTeamStatBoardCard(homeStatBoardEl, report.teams.home, report.is2v2);
  }
  if (awayStatBoardEl) {
    awayStatBoardEl.style.display = 'flex';
    renderTeamStatBoardCard(awayStatBoardEl, report.teams.away, report.is2v2);
  }
}

function refreshCameraRows() {
  const rows = callbacks.getCameraRows ? callbacks.getCameraRows() : [];
  let anyVisible = false;
  camSelObjs.forEach((obj, i) => {
    if (!obj) return;
    const row = rows[i];
    const vis = Boolean(row && row.visible);
    if (vis) anyVisible = true;
    obj.box.style.display = vis ? 'block' : 'none';
    if (!vis) return;
    obj.title.textContent = row.hint ? `${row.label} · ${row.hint}` : row.label;
    obj.select.innerHTML = '';
    for (const m of CAMERA_MODES) {
      if (m === 'broadcast' && !row.allowBroadcast) continue;
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = CAMERA_LABELS[m];
      obj.select.appendChild(opt);
    }
    obj.select.value = row.mode;
  });
  if (camSectionEl) {
    camSectionEl.style.display = anyVisible ? 'flex' : 'none';
  }
  const t1Group = document.getElementById('ingame-cam-team-1');
  const t2Group = document.getElementById('ingame-cam-team-2');
  const camGrid = document.getElementById('ingame-cam-grid');
  const t1Vis = Boolean((rows[0] && rows[0].visible) || (rows[2] && rows[2].visible));
  const t2Vis = Boolean((rows[1] && rows[1].visible) || (rows[3] && rows[3].visible));
  if (t1Group) t1Group.style.display = t1Vis ? 'flex' : 'none';
  if (t2Group) t2Group.style.display = t2Vis ? 'flex' : 'none';
  if (camGrid) {
    camGrid.style.gridTemplateColumns = (t1Vis && t2Vis) ? '1fr 1fr' : '1fr';
  }
}

function applyCameraChoice(playerIdx, mode) {
  if (callbacks.onCameraChange) callbacks.onCameraChange(playerIdx, mode);
  refreshCameraRows();
}

function cycleHudPreset(dir = 1) {
  const curIdx = hudPresetOptions.findIndex((o) => o.id === getActiveHudPresetId());
  const nextIdx = curIdx === -1 ? (dir > 0 ? 1 : 0) : (curIdx + dir + hudPresetOptions.length) % hudPresetOptions.length;
  hudPresetButtons[nextIdx]?.click();
  updateInGameFocusUI();
}

function adjustVolume(delta) {
  if (!volSliderEl) return;
  const curVal = parseInt(volSliderEl.value, 10);
  const nextVal = Math.max(0, Math.min(100, curVal + delta));
  volSliderEl.value = String(nextVal);
  volSliderEl.dispatchEvent(new Event('input'));
}

function toggleMute() {
  muteBtnEl?.click();
  updateInGameFocusUI();
}

function cycleCam(playerIdx, sel, dir = 1) {
  if (!sel || sel.options.length === 0) return;
  sel.selectedIndex = (sel.selectedIndex + dir + sel.options.length) % sel.options.length;
  applyCameraChoice(playerIdx, sel.value);
}

function getActiveInGameRows() {
  const rows = [];
  if (resumeBtnEl) {
    rows.push({
      el: resumeBtnEl,
      isButton: true,
      isPrimaryResume: true,
      onAction: () => resumeBtnEl.click(),
      onLeft: () => {},
      onRight: () => {},
    });
  }
  for (const i of [0, 2, 1, 3]) {
    const box = camBoxes[i];
    const selObj = camSelObjs[i];
    if (box && box.style.display !== 'none' && camSectionEl?.style.display !== 'none') {
      rows.push({
        el: box,
        onLeft: () => cycleCam(i, selObj?.select, -1),
        onRight: () => cycleCam(i, selObj?.select, 1),
        onAction: () => cycleCam(i, selObj?.select, 1),
      });
    }
  }
  if (hudPresetRowEl) {
    rows.push({
      el: hudPresetRowEl,
      onLeft: () => cycleHudPreset(-1),
      onRight: () => cycleHudPreset(1),
      onAction: () => cycleHudPreset(1),
    });
  }
  if (volRowEl) {
    rows.push({
      el: volRowEl,
      onLeft: () => adjustVolume(-5),
      onRight: () => adjustVolume(5),
      onAction: () => toggleMute(),
    });
  }

  const bottomBtns = [
    (rematchBtnEl && rematchBtnEl.style.display !== 'none') ? rematchBtnEl : null,
    (finishPracticeBtn && finishPracticeBtn.style.display !== 'none') ? finishPracticeBtn : null,
    mainMenuBtnEl,
  ].filter(Boolean);

  if (bottomBtns.length > 0) {
    const firstBottomIdx = rows.length;
    bottomBtns.forEach((btn, idx) => {
      rows.push({
        el: btn,
        isButton: true,
        onAction: () => btn.click(),
        onLeft: () => {
          if (bottomBtns.length < 2) return;
          const prevOffset = (idx - 1 + bottomBtns.length) % bottomBtns.length;
          inGameFocusIndex = firstBottomIdx + prevOffset;
          updateInGameFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
        },
        onRight: () => {
          if (bottomBtns.length < 2) return;
          const nextOffset = (idx + 1) % bottomBtns.length;
          inGameFocusIndex = firstBottomIdx + nextOffset;
          updateInGameFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
        },
        onUp: () => {
          if (firstBottomIdx > 0) {
            inGameFocusIndex = firstBottomIdx - 1;
            updateInGameFocusUI();
            soundManager.playTone(400, 0.04, 'sine', 0.15);
          }
        },
        onDown: () => {
          inGameFocusIndex = 0;
          updateInGameFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
        },
      });
    });
  }
  return rows;
}

function updateInGameFocusUI() {
  inGameNavRows = getActiveInGameRows();
  if (inGameNavRows.length === 0) return;
  if (inGameFocusIndex >= inGameNavRows.length) inGameFocusIndex = inGameNavRows.length - 1;
  if (inGameFocusIndex < 0) inGameFocusIndex = 0;

  const vb = typeof window !== 'undefined' ? window.__vb : null;
  const isPractice = vb?.getGameState?.() === 'practice' || vb?.matchState?.mode === 'practice';
  const isReplay = Boolean(vb?.replay?.isPlayingBack?.());
  const baseResumeLabel = isReplay ? 'RESUME REPLAY' : (isPractice ? 'RESUME PRACTICE' : 'RESUME GAME');

  inGameNavRows.forEach((row, idx) => {
    const isSel = idx === inGameFocusIndex;
    row.el.dataset.focused = isSel ? 'true' : 'false';
    if (row.isPrimaryResume) {
      row.el.textContent = isSel ? `▶ ${baseResumeLabel} [ESC]` : baseResumeLabel;
      if (isSel) {
        row.el.style.background = 'linear-gradient(90deg, #00e5ff 0%, #38bdf8 58%, #fbbf24 100%)';
        row.el.style.color = '#03111c';
        row.el.style.border = '2px solid #ffffff';
        row.el.style.outline = '3px solid #fbbf24';
        row.el.style.outlineOffset = '2px';
        row.el.style.transform = 'scale(1.015)';
        row.el.style.boxShadow = '0 0 26px rgba(0, 229, 255, 0.65), 0 0 14px rgba(251, 191, 36, 0.45)';
      } else {
        row.el.style.background = 'rgba(0, 229, 255, 0.14)';
        row.el.style.color = '#e0f2fe';
        row.el.style.border = '2px solid rgba(0, 229, 255, 0.55)';
        row.el.style.outline = 'none';
        row.el.style.transform = 'scale(1)';
        row.el.style.boxShadow = 'none';
      }
    } else if (row.isButton) {
      if (isSel) {
        row.el.style.outline = '2.5px solid #fbbf24';
        row.el.style.outlineOffset = '2px';
        row.el.style.transform = 'scale(1.02)';
        row.el.style.boxShadow = '0 0 18px rgba(251, 191, 36, 0.45)';
        if (row.el === mainMenuBtnEl) {
          row.el.style.background = 'rgba(255, 255, 255, 0.2)';
          row.el.style.borderColor = '#ffffff';
          row.el.style.color = '#ffffff';
        }
      } else {
        row.el.style.outline = 'none';
        row.el.style.transform = 'scale(1)';
        row.el.style.boxShadow = 'none';
        if (row.el === mainMenuBtnEl) {
          row.el.style.background = 'rgba(255, 255, 255, 0.08)';
          row.el.style.borderColor = 'rgba(255, 255, 255, 0.22)';
          row.el.style.color = '#cfe3f5';
        }
      }
    } else if (isSel) {
      row.el.style.outline = '2px solid #00e5ff';
      row.el.style.outlineOffset = '2px';
      row.el.style.background = 'rgba(0, 229, 255, 0.10)';
      row.el.style.boxShadow = '0 0 14px rgba(0, 229, 255, 0.28)';
    } else {
      row.el.style.outline = 'none';
      row.el.style.background = camBoxes.includes(row.el) ? 'rgba(255, 255, 255, 0.04)' : 'transparent';
      row.el.style.boxShadow = 'none';
    }
  });
}

function startInGameMenuPolling() {
  stopInGameMenuPolling();

  const onKeyDown = (e) => {
    if (!isOpen) return;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      inGameNavRows = getActiveInGameRows();
      if (inGameNavRows[inGameFocusIndex]?.onUp) {
        inGameNavRows[inGameFocusIndex].onUp();
      } else {
        inGameFocusIndex = (inGameFocusIndex - 1 + inGameNavRows.length) % inGameNavRows.length;
        soundManager.playTone(400, 0.04, 'sine', 0.15);
        updateInGameFocusUI();
      }
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault();
      inGameNavRows = getActiveInGameRows();
      if (inGameNavRows[inGameFocusIndex]?.onDown) {
        inGameNavRows[inGameFocusIndex].onDown();
      } else {
        inGameFocusIndex = (inGameFocusIndex + 1) % inGameNavRows.length;
        soundManager.playTone(400, 0.04, 'sine', 0.15);
        updateInGameFocusUI();
      }
    } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      e.preventDefault();
      inGameNavRows = getActiveInGameRows();
      inGameNavRows[inGameFocusIndex]?.onLeft?.();
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      e.preventDefault();
      inGameNavRows = getActiveInGameRows();
      inGameNavRows[inGameFocusIndex]?.onRight?.();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      inGameNavRows = getActiveInGameRows();
      inGameNavRows[inGameFocusIndex]?.onAction?.();
    } else if (e.code === 'Escape') {
      e.preventDefault();
      resumeFromInGameMenu();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  inGamePads.reset();

  inGamePollHandle = setInterval(() => {
    if (!isOpen || !menuOverlayEl || menuOverlayEl.style.display !== 'flex') {
      stopInGameMenuPolling();
      return;
    }

    if (typeof navigator.getGamepads !== 'function') return;
    const raw = navigator.getGamepads();
    const pads = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] && raw[i].connected) pads.push(raw[i]);
    }

    inGamePads.update(pads);
    inGameNavRows = getActiveInGameRows();
    if (inGameNavRows.length === 0) return;

    const ownerPadConnected = activePauseOwner &&
      Number.isInteger(activePauseOwner.padIndex) &&
      pads.some((p) => p && p.index === activePauseOwner.padIndex);

    for (const pad of pads) {
      if (!pad) continue;
      if (ownerPadConnected && pad.index !== activePauseOwner.padIndex) continue;
      const e = inGamePads.pressed(pad);

      if (e & MENU_PAD.up) {
        if (inGameNavRows[inGameFocusIndex]?.onUp) {
          inGameNavRows[inGameFocusIndex].onUp();
        } else {
          inGameFocusIndex = (inGameFocusIndex - 1 + inGameNavRows.length) % inGameNavRows.length;
          soundManager.playTone(400, 0.04, 'sine', 0.15);
          updateInGameFocusUI();
        }
      }
      if (e & MENU_PAD.down) {
        if (inGameNavRows[inGameFocusIndex]?.onDown) {
          inGameNavRows[inGameFocusIndex].onDown();
        } else {
          inGameFocusIndex = (inGameFocusIndex + 1) % inGameNavRows.length;
          soundManager.playTone(400, 0.04, 'sine', 0.15);
          updateInGameFocusUI();
        }
      }
      if (e & MENU_PAD.left) {
        inGameNavRows[inGameFocusIndex]?.onLeft?.();
      }
      if (e & MENU_PAD.right) {
        inGameNavRows[inGameFocusIndex]?.onRight?.();
      }
      if (e & MENU_PAD.a) {
        inGameNavRows[inGameFocusIndex]?.onAction?.();
        if (!isOpen) return;
      }
      if (e & (MENU_PAD.b | MENU_PAD.back | MENU_PAD.start)) {
        resumeFromInGameMenu();
        return;
      }
    }
  }, 50);

  window._cleanupInGameMenuListeners = () => {
    window.removeEventListener('keydown', onKeyDown);
    if (inGamePollHandle) {
      clearInterval(inGamePollHandle);
      inGamePollHandle = null;
    }
  };
}

function stopInGameMenuPolling() {
  if (window._cleanupInGameMenuListeners) {
    window._cleanupInGameMenuListeners();
    window._cleanupInGameMenuListeners = null;
  }
  if (inGamePollHandle) {
    clearInterval(inGamePollHandle);
    inGamePollHandle = null;
  }
}

export function showInGameMenu(owner = null) {
  if (!menuOverlayEl) return;
  isOpen = true;
  activePauseOwner = owner && typeof owner === 'object' ? owner : null;
  if (pauseOwnerBadgeEl) {
    if (activePauseOwner) {
      const hex = PAUSE_SLOT_HEX[activePauseOwner.slotIndex] || '#00e5ff';
      pauseOwnerBadgeEl.textContent = `PAUSED BY ${activePauseOwner.label || `P${(activePauseOwner.slotIndex ?? 0) + 1}`}`;
      pauseOwnerBadgeEl.style.color = hex;
      pauseOwnerBadgeEl.style.borderColor = hex;
      pauseOwnerBadgeEl.style.background = 'rgba(15, 23, 42, 0.9)';
      pauseOwnerBadgeEl.style.display = 'inline-block';
    } else {
      pauseOwnerBadgeEl.textContent = 'HOST / KEYBOARD CONTROL';
      pauseOwnerBadgeEl.style.color = '#94a3b8';
      pauseOwnerBadgeEl.style.borderColor = 'rgba(148, 163, 184, 0.35)';
      pauseOwnerBadgeEl.style.background = 'rgba(255, 255, 255, 0.05)';
      pauseOwnerBadgeEl.style.display = 'inline-block';
    }
  }
  if (callbacks.onOpen) callbacks.onOpen();
  menuOverlayEl.style.display = 'flex';

  refreshCameraRows();
  if (menuOverlayEl._updateAudioUI) menuOverlayEl._updateAudioUI();
  if (menuOverlayEl._syncHudPrefs) menuOverlayEl._syncHudPrefs();

  const vb = typeof window !== 'undefined' ? window.__vb : null;
  const isPractice = vb?.getGameState?.() === 'practice' || vb?.matchState?.mode === 'practice';
  const isReplay = Boolean(vb?.replay?.isPlayingBack?.());

  if (finishPracticeBtn) finishPracticeBtn.style.display = isPractice ? 'block' : 'none';
  if (rematchBtnEl) rematchBtnEl.style.display = (!isPractice && !isReplay) ? 'block' : 'none';

  refreshMatchAndPracticeSideBoards(isPractice, isReplay);

  if (vb?.matchState) {
    updateInGameMenuBanner(vb.matchState);
  }

  // Always focus RESUME GAME at the top on open
  inGameFocusIndex = 0;
  updateInGameFocusUI();
  startInGameMenuPolling();
}

export function hideInGameMenu() {
  if (!menuOverlayEl) return;
  isOpen = false;
  activePauseOwner = null;
  stopInGameMenuPolling();
  menuOverlayEl.style.display = 'none';
}

export function toggleInGameMenu(owner = null) {
  if (isOpen) resumeFromInGameMenu();
  else showInGameMenu(owner);
  return isOpen;
}

export function getInGamePauseOwner() {
  return activePauseOwner;
}

export function isInGameMenuOpen() {
  return isOpen;
}

export function updateInGameMenuBanner(match) {
  if (!isOpen || !clockBannerEl || !match) return;
  if (match.mode !== 'match') {
    clockBannerEl.textContent = 'PRACTICE SANDBOX';
    return;
  }
  if (match.isCountingDown) {
    clockBannerEl.textContent = `PRE-MATCH · PAUSED (${match.countdownSecondsRemaining ?? 3}s)`;
    return;
  }
  const min = Math.floor(match.ticksRemaining / (60 * 60));
  const sec = Math.floor((match.ticksRemaining % (60 * 60)) / 60);
  const timeStr = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  const homeColor = TUNING.athlete?.palette?.homePrimary ?? 0xd90429;
  const awayColor = TUNING.athlete?.palette?.awayPrimary ?? 0x1d4ed8;
  const homeName = getColorName(homeColor).toUpperCase();
  const awayName = getColorName(awayColor).toUpperCase();
  clockBannerEl.textContent = `${timeStr} · ${homeName} ${match.scoreHome} - ${match.scoreAway} ${awayName}`;
}
