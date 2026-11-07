/**
 * In-Game Settings & Pause Menu for Valleyball Versus.
 *
 * Designed to NOT pause the play clock or freeze physics:
 * match time and background simulation continue running while open.
 */

import { getColorName } from './mainMenu.js';
import { TUNING } from '../config/tuning.js';
import { soundManager } from '../audio/soundManager.js';
import { setVibrationEnabled, isVibrationEnabled } from '../input/inputRouter.js';
import { createMenuPadTracker, MENU_PAD } from '../input/menuPads.js';

let menuOverlayEl = null;
let isOpen = false;
let clockBannerEl = null;
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

let hustleBoardSection = null;
let finishPracticeBtn = null;
const camBoxes = [null, null, null, null];
const camSelObjs = [null, null, null, null];

let dprRowEl = null;
let dprButtons = [];
let dprOptions = [];
let shadowRowEl = null;
let shadowButtons = [];
let shadowOptions = [];
let controlsRowEl = null;
let controlsButtons = [];
let controlsOptions = [];
let tuningRowEl = null;
let tuningButtons = [];
let tuningOptions = [];
let volRowEl = null;
let volSliderEl = null;
let muteRowEl = null;
let muteBtnEl = null;
let vibrationRowEl = null;
let vibrationButtons = [];
let vibrationOptions = [];
let resumeBtnEl = null;
let rematchBtnEl = null;
let mainMenuBtnEl = null;

let inGameFocusIndex = 0;
let inGameNavRows = [];
let inGamePollHandle = null;
const inGamePads = createMenuPadTracker();

let currentRenderSettings = {
  pixelRatioPreset: 'native',
  shadowQuality: 'high',
  showControlsOverlay: false,
  showTuningGui: false,
};

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
  initialRenderSettings = {},
}) {
  if (menuOverlayEl) return;
  callbacks = { onResume, onOpen, onRematch, onPracticeMode, onFinishPractice, onMainMenu, onRenderSettingsChange, onCameraChange, getCameraRows };
  Object.assign(currentRenderSettings, initialRenderSettings);

  menuOverlayEl = document.createElement('div');
  menuOverlayEl.id = 'ingame-menu-overlay';
  menuOverlayEl.style.cssText = `
    position: fixed;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(4, 7, 12, 0.78);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    z-index: 900;
    user-select: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #cfe3f5;
  `;

  const container = document.createElement('div');
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    padding: 24px 36px 28px;
    background: rgba(11, 17, 26, 0.94);
    border: 1px solid rgba(120, 170, 210, 0.35);
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.8), 0 0 20px rgba(59, 130, 246, 0.15);
    max-width: 580px;
    width: 92%;
    max-height: 88vh;
    overflow-y: auto;
  `;

  // 1. Header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid;
    border-image: linear-gradient(90deg, #ff2e55, #ff6b35, #fbb417, #4ade80, #00e5ff, #3b82f6, #a855f7) 1;
    padding-bottom: 12px;
    margin-bottom: 16px;
  `;

  const titleBox = document.createElement('div');
  titleBox.innerHTML = `
    <div style="font-size: 18px; font-weight: 900; letter-spacing: 0.08em; display: flex; align-items: baseline; gap: 8px;">
      <span style="background: linear-gradient(90deg, #ff2e55 0%, #ff6b35 20%, #fbb417 40%, #4ade80 60%, #00e5ff 80%, #a855f7 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">VALLEYBALL</span>
      <span style="font-size: 12px; font-weight: 900; letter-spacing: 0.22em; color: #000000; -webkit-text-stroke: 1px #ffffff; text-stroke: 1px #ffffff;">VERSUS</span>
      <span style="color: rgba(255,255,255,0.3); font-size: 14px;">/</span>
      <span style="color: #ffffff; font-size: 15px; font-weight: 800;">SETTINGS</span>
      <span style="font-size: 10px; font-weight: 800; color: #00e5ff; background: rgba(0, 229, 255, 0.12); border: 1px solid rgba(0, 229, 255, 0.35); padding: 2px 6px; border-radius: 4px; margin-left: 2px;">v0.4.0</span>
    </div>
    <div style="font-size: 11px; color: #fbbf24; margin-top: 2px;">
      ⚡ Play clock continues running in real time
    </div>
  `;

  clockBannerEl = document.createElement('div');
  clockBannerEl.style.cssText = `
    font-size: 12px;
    font-weight: 700;
    padding: 4px 10px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 4px;
    letter-spacing: 0.06em;
    color: #e2e8f0;
  `;
  clockBannerEl.textContent = 'MATCH ACTIVE';

  header.appendChild(titleBox);
  header.appendChild(clockBannerEl);
  container.appendChild(header);

  // 1b. Hustle Board Live Readout (Practice Mode Only)
  hustleBoardSection = document.createElement('div');
  hustleBoardSection.id = 'ingame-hustle-board-section';
  hustleBoardSection.style.cssText = `
    display: none;
    flex-direction: column;
    gap: 8px;
    background: rgba(16, 24, 38, 0.85);
    border: 1px solid rgba(56, 189, 248, 0.35);
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 14px;
  `;
  container.appendChild(hustleBoardSection);

  finishPracticeBtn = document.createElement('button');
  finishPracticeBtn.id = 'btn-finish-practice';
  finishPracticeBtn.textContent = 'FINISH PRACTICE & VIEW HUSTLE BOARD ➔';
  finishPracticeBtn.style.cssText = `
    display: none;
    width: 100%;
    padding: 12px;
    margin-bottom: 14px;
    font-size: 13px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #ffffff;
    background: #10b981;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
    transition: all 0.15s ease;
  `;
  finishPracticeBtn.onmouseenter = () => { finishPracticeBtn.style.background = '#34d399'; };
  finishPracticeBtn.onmouseleave = () => { finishPracticeBtn.style.background = '#10b981'; };
  finishPracticeBtn.onclick = () => {
    hideInGameMenu();
    if (callbacks.onFinishPractice) callbacks.onFinishPractice();
  };
  container.appendChild(finishPracticeBtn);

  // Helper for Section Titles
  function createSectionHeading(text) {
    const heading = document.createElement('div');
    heading.textContent = text;
    heading.style.cssText = `
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.12em;
      color: #ffffff;
      text-transform: uppercase;
      margin: 16px 0 8px;
    `;
    return heading;
  }

  // 2. Performance Settings Section
  container.appendChild(createSectionHeading('GRAPHICS & PERFORMANCE'));

  // Resolution Scale Row
  dprRowEl = document.createElement('div');
  const dprRow = dprRowEl;
  dprRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;';
  const dprLabel = document.createElement('div');
  dprLabel.textContent = 'Resolution Scale';
  dprLabel.style.cssText = 'font-size: 12px; color: #cbd5e1;';
  const dprButtonGroup = document.createElement('div');
  dprButtonGroup.style.cssText = 'display: flex; gap: 6px;';

  dprOptions = [
    { id: '1.0', label: '1.0x (Fast)' },
    { id: '1.25', label: '1.25x (Balanced)' },
    { id: 'native', label: 'Native (Ultra)' },
  ];

  dprButtons = [];
  dprOptions.forEach((opt) => {
    const btn = document.createElement('button');
    btn.textContent = opt.label;
    btn.style.cssText = `
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 700;
      font-family: inherit;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid rgba(120, 170, 210, 0.3);
      transition: all 0.12s ease;
      background: ${currentRenderSettings.pixelRatioPreset === opt.id ? '#2563eb' : 'rgba(255, 255, 255, 0.06)'};
      color: ${currentRenderSettings.pixelRatioPreset === opt.id ? '#ffffff' : '#94a3b8'};
    `;
    btn.onclick = () => {
      currentRenderSettings.pixelRatioPreset = opt.id;
      dprButtons.forEach((b, idx) => {
        const isSel = dprOptions[idx].id === opt.id;
        b.style.background = isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
        b.style.color = isSel ? '#ffffff' : '#94a3b8';
      });
      if (callbacks.onRenderSettingsChange) callbacks.onRenderSettingsChange({ ...currentRenderSettings });
    };
    dprButtons.push(btn);
    dprButtonGroup.appendChild(btn);
  });
  dprRow.appendChild(dprLabel);
  dprRow.appendChild(dprButtonGroup);
  container.appendChild(dprRow);

  // Shadow Quality Row
  shadowRowEl = document.createElement('div');
  const shadowRow = shadowRowEl;
  shadowRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;';
  const shadowLabel = document.createElement('div');
  shadowLabel.textContent = 'Stadium Shadows';
  shadowLabel.style.cssText = 'font-size: 12px; color: #cbd5e1;';
  const shadowButtonGroup = document.createElement('div');
  shadowButtonGroup.style.cssText = 'display: flex; gap: 6px;';

  shadowOptions = [
    { id: 'off', label: 'Off' },
    { id: 'balanced', label: 'Balanced (1 Tower)' },
    { id: 'high', label: 'High (4 Towers)' },
  ];

  shadowButtons = [];
  shadowOptions.forEach((opt) => {
    const btn = document.createElement('button');
    btn.textContent = opt.label;
    btn.style.cssText = `
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 700;
      font-family: inherit;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid rgba(120, 170, 210, 0.3);
      transition: all 0.12s ease;
      background: ${currentRenderSettings.shadowQuality === opt.id ? '#2563eb' : 'rgba(255, 255, 255, 0.06)'};
      color: ${currentRenderSettings.shadowQuality === opt.id ? '#ffffff' : '#94a3b8'};
    `;
    btn.onclick = () => {
      currentRenderSettings.shadowQuality = opt.id;
      shadowButtons.forEach((b, idx) => {
        const isSel = shadowOptions[idx].id === opt.id;
        b.style.background = isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
        b.style.color = isSel ? '#ffffff' : '#94a3b8';
      });
      if (callbacks.onRenderSettingsChange) callbacks.onRenderSettingsChange({ ...currentRenderSettings });
    };
    shadowButtons.push(btn);
    shadowButtonGroup.appendChild(btn);
  });
  shadowRow.appendChild(shadowLabel);
  shadowRow.appendChild(shadowButtonGroup);
  container.appendChild(shadowRow);

  // Controls Overlay Row
  controlsRowEl = document.createElement('div');
  const controlsRow = controlsRowEl;
  controlsRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;';
  const controlsLabel = document.createElement('div');
  controlsLabel.textContent = 'Controls Overlay';
  controlsLabel.style.cssText = 'font-size: 12px; color: #cbd5e1;';
  const controlsButtonGroup = document.createElement('div');
  controlsButtonGroup.style.cssText = 'display: flex; gap: 6px;';

  controlsOptions = [
    { id: true, label: 'Visible' },
    { id: false, label: 'Hidden' },
  ];
  controlsButtons = [];
  controlsOptions.forEach((opt) => {
    const btn = document.createElement('button');
    btn.textContent = opt.label;
    btn.style.cssText = `
      padding: 6px 14px;
      font-size: 11px;
      font-weight: 700;
      font-family: inherit;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid rgba(120, 170, 210, 0.3);
      transition: all 0.12s ease;
      background: ${(currentRenderSettings.showControlsOverlay ?? false) === opt.id ? '#2563eb' : 'rgba(255, 255, 255, 0.06)'};
      color: ${(currentRenderSettings.showControlsOverlay ?? false) === opt.id ? '#ffffff' : '#94a3b8'};
    `;
    btn.onclick = () => {
      currentRenderSettings.showControlsOverlay = opt.id;
      controlsButtons.forEach((b, idx) => {
        const isSel = controlsOptions[idx].id === opt.id;
        b.style.background = isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
        b.style.color = isSel ? '#ffffff' : '#94a3b8';
      });
      if (callbacks.onRenderSettingsChange) callbacks.onRenderSettingsChange({ ...currentRenderSettings });
    };
    controlsButtons.push(btn);
    controlsButtonGroup.appendChild(btn);
  });
  controlsRow.appendChild(controlsLabel);
  controlsRow.appendChild(controlsButtonGroup);
  container.appendChild(controlsRow);

  // Valleyball Tuning GUI Row
  tuningRowEl = document.createElement('div');
  const tuningRow = tuningRowEl;
  tuningRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;';
  const tuningLabel = document.createElement('div');
  tuningLabel.textContent = 'Valleyball Tuning GUI';
  tuningLabel.style.cssText = 'font-size: 12px; color: #cbd5e1;';
  const tuningButtonGroup = document.createElement('div');
  tuningButtonGroup.style.cssText = 'display: flex; gap: 6px;';

  tuningOptions = [
    { id: false, label: 'Off' },
    { id: true, label: 'On' },
  ];
  tuningButtons = [];
  tuningOptions.forEach((opt) => {
    const btn = document.createElement('button');
    btn.textContent = opt.label;
    btn.style.cssText = `
      padding: 6px 14px;
      font-size: 11px;
      font-weight: 700;
      font-family: inherit;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid rgba(120, 170, 210, 0.3);
      transition: all 0.12s ease;
      background: ${(currentRenderSettings.showTuningGui ?? false) === opt.id ? '#2563eb' : 'rgba(255, 255, 255, 0.06)'};
      color: ${(currentRenderSettings.showTuningGui ?? false) === opt.id ? '#ffffff' : '#94a3b8'};
    `;
    btn.onclick = () => {
      currentRenderSettings.showTuningGui = opt.id;
      tuningButtons.forEach((b, idx) => {
        const isSel = tuningOptions[idx].id === opt.id;
        b.style.background = isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
        b.style.color = isSel ? '#ffffff' : '#94a3b8';
      });
      if (callbacks.onRenderSettingsChange) callbacks.onRenderSettingsChange({ ...currentRenderSettings });
    };
    tuningButtons.push(btn);
    tuningButtonGroup.appendChild(btn);
  });
  tuningRow.appendChild(tuningLabel);
  tuningRow.appendChild(tuningButtonGroup);
  container.appendChild(tuningRow);

  // 3. Audio Section
  container.appendChild(createSectionHeading('AUDIO'));

  // Master Volume Row
  const volRow = document.createElement('div');
  volRowEl = volRow;
  volRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;';
  const volLabel = document.createElement('div');
  const initialVol = Math.round(soundManager.getMasterVolume() * 100);
  volLabel.innerHTML = `Master Volume <span id="ingame-volume-val" style="color: #60a5fa; font-weight: 700; margin-left: 6px;">${initialVol}%</span>`;
  volLabel.style.cssText = 'font-size: 12px; color: #cbd5e1; display: flex; align-items: center;';

  const volSlider = document.createElement('input');
  volSliderEl = volSlider;
  volSlider.type = 'range';
  volSlider.min = '0';
  volSlider.max = '100';
  volSlider.value = String(initialVol);
  volSlider.style.cssText = 'width: 130px; cursor: pointer; accent-color: #2563eb;';

  // Audio Mute Row
  const muteRow = document.createElement('div');
  muteRowEl = muteRow;
  muteRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;';
  const muteLabel = document.createElement('div');
  muteLabel.textContent = 'Mute Audio';
  muteLabel.style.cssText = 'font-size: 12px; color: #cbd5e1;';

  const muteBtn = document.createElement('button');
  muteBtnEl = muteBtn;
  const updateMuteBtnState = (isMuted) => {
    muteBtn.textContent = isMuted ? 'Muted' : 'Unmuted';
    muteBtn.style.background = isMuted ? '#ef4444' : 'rgba(255, 255, 255, 0.06)';
    muteBtn.style.color = isMuted ? '#ffffff' : '#94a3b8';
  };
  muteBtn.style.cssText = `
    padding: 6px 14px;
    font-size: 11px;
    font-weight: 700;
    font-family: inherit;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid rgba(120, 170, 210, 0.3);
    transition: all 0.12s ease;
  `;
  updateMuteBtnState(soundManager.isMuted());

  volSlider.oninput = (e) => {
    const val = parseInt(e.target.value, 10);
    const valSpan = volLabel.querySelector('#ingame-volume-val');
    if (valSpan) valSpan.textContent = `${val}%`;
    soundManager.setMasterVolume(val / 100);
    if (val > 0 && soundManager.isMuted()) {
      soundManager.setMuted(false);
      updateMuteBtnState(false);
    }
  };

  muteBtn.onclick = () => {
    const nowMuted = !soundManager.isMuted();
    soundManager.setMuted(nowMuted);
    updateMuteBtnState(nowMuted);
  };

  volRow.appendChild(volLabel);
  volRow.appendChild(volSlider);
  container.appendChild(volRow);

  muteRow.appendChild(muteLabel);
  muteRow.appendChild(muteBtn);
  container.appendChild(muteRow);

  menuOverlayEl._updateAudioUI = () => {
    const vol = Math.round(soundManager.getMasterVolume() * 100);
    volSlider.value = String(vol);
    const valSpan = volLabel.querySelector('#ingame-volume-val');
    if (valSpan) valSpan.textContent = `${vol}%`;
    updateMuteBtnState(soundManager.isMuted());
    const vibEnabled = isVibrationEnabled();
    vibrationButtons.forEach((b, idx) => {
      const isSel = vibrationOptions[idx].id === vibEnabled;
      b.style.background = isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
      b.style.color = isSel ? '#ffffff' : '#94a3b8';
    });
  };

  // 3b. Controls & Haptics Section
  container.appendChild(createSectionHeading('CONTROLS & HAPTICS'));

  // Controller Vibration Row
  const vibrationRow = document.createElement('div');
  vibrationRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;';
  const vibrationLabel = document.createElement('div');
  vibrationLabel.textContent = 'Controller Vibration';
  vibrationLabel.style.cssText = 'font-size: 12px; color: #cbd5e1;';
  const vibrationButtonGroup = document.createElement('div');
  vibrationButtonGroup.style.cssText = 'display: flex; gap: 6px;';

  const vibrationOptions = [
    { id: true, label: 'On' },
    { id: false, label: 'Off' },
  ];
  const vibrationButtons = [];
  vibrationOptions.forEach((opt) => {
    const btn = document.createElement('button');
    btn.textContent = opt.label;
    btn.style.cssText = `
      padding: 6px 14px;
      font-size: 11px;
      font-weight: 700;
      font-family: inherit;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid rgba(120, 170, 210, 0.3);
      transition: all 0.12s ease;
      background: ${isVibrationEnabled() === opt.id ? '#2563eb' : 'rgba(255, 255, 255, 0.06)'};
      color: ${isVibrationEnabled() === opt.id ? '#ffffff' : '#94a3b8'};
    `;
    btn.onclick = () => {
      setVibrationEnabled(opt.id);
      vibrationButtons.forEach((b, idx) => {
        const isSel = vibrationOptions[idx].id === opt.id;
        b.style.background = isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
        b.style.color = isSel ? '#ffffff' : '#94a3b8';
      });
    };
    vibrationButtons.push(btn);
    vibrationButtonGroup.appendChild(btn);
  });
  vibrationRow.appendChild(vibrationLabel);
  vibrationRow.appendChild(vibrationButtonGroup);
  vibrationRowEl = vibrationRow;
  container.appendChild(vibrationRow);

  // 4. Camera Modes Section (grouped by Team 1 [P1, P3] and Team 2 [P2, P4])
  container.appendChild(createSectionHeading('CAMERAS'));
  const camGrid = document.createElement('div');
  camGrid.id = 'ingame-cam-grid';
  camGrid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;';

  const team1CamGroup = document.createElement('div');
  team1CamGroup.id = 'ingame-cam-team-1';
  team1CamGroup.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

  const team2CamGroup = document.createElement('div');
  team2CamGroup.id = 'ingame-cam-team-2';
  team2CamGroup.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

  // Titles and options are filled per open by refreshCameraRows().
  function createCamSelector(playerIndex) {
    const box = document.createElement('div');
    box.style.cssText = 'background: rgba(255, 255, 255, 0.04); padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1);';
    const t = document.createElement('div');
    t.style.cssText = 'font-size: 10.5px; font-weight: 800; color: #cbd5e1; margin-bottom: 6px; letter-spacing: 0.04em;';

    const controlRow = document.createElement('div');
    controlRow.style.cssText = 'display: flex; gap: 5px; align-items: center;';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.textContent = '<';
    prevBtn.style.cssText = 'padding: 5px 8px; font-family: inherit; font-size: 11px; font-weight: 900; background: rgba(255,255,255,0.08); color: #ffffff; border: 1px solid rgba(120, 170, 210, 0.35); border-radius: 4px; cursor: pointer;';

    const sel = document.createElement('select');
    sel.style.cssText = 'flex: 1; min-width: 0; padding: 5px 6px; font-family: inherit; font-size: 11.5px; font-weight: 700; background: #0f172a; color: #f8fafc; border: 1px solid rgba(120, 170, 210, 0.3); border-radius: 4px; cursor: pointer;';
    sel.onchange = () => applyCameraChoice(playerIndex, sel.value);

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = '>';
    nextBtn.style.cssText = 'padding: 5px 8px; font-family: inherit; font-size: 11px; font-weight: 900; background: rgba(255,255,255,0.08); color: #ffffff; border: 1px solid rgba(120, 170, 210, 0.35); border-radius: 4px; cursor: pointer;';

    prevBtn.onclick = () => cycleCam(playerIndex, sel, -1);
    nextBtn.onclick = () => cycleCam(playerIndex, sel, 1);

    controlRow.appendChild(prevBtn);
    controlRow.appendChild(sel);
    controlRow.appendChild(nextBtn);

    box.appendChild(t);
    box.appendChild(controlRow);
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
  camGrid.appendChild(team1CamGroup);
  camGrid.appendChild(team2CamGroup);
  container.appendChild(camGrid);

  // 4. Action Buttons
  const actionsBox = document.createElement('div');
  actionsBox.style.cssText = 'display: flex; gap: 12px; margin-top: 14px; border-top: 1px solid rgba(120, 170, 210, 0.2); padding-top: 18px;';

  const resumeBtn = document.createElement('button');
  resumeBtnEl = resumeBtn;
  resumeBtn.textContent = 'BACK / RESUME [ESC]';
  resumeBtn.style.cssText = `
    flex: 1;
    padding: 12px;
    font-size: 14px;
    font-weight: 900;
    font-family: inherit;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #000000;
    background: #ffffff;
    border: 2px solid #ffffff;
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 4px 18px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25);
    transition: all 0.15s ease;
  `;
  resumeBtn.onmouseenter = () => {
    resumeBtn.style.transform = 'scale(1.02)';
    resumeBtn.style.boxShadow = '0 6px 24px rgba(255, 255, 255, 0.6), 0 0 30px rgba(255, 46, 85, 0.3)';
  };
  resumeBtn.onmouseleave = () => {
    resumeBtn.style.transform = 'scale(1)';
    resumeBtn.style.boxShadow = '0 4px 18px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25)';
  };
  resumeBtn.onclick = () => {
    hideInGameMenu();
    if (callbacks.onResume) callbacks.onResume();
  };

  const mainMenuBtn = document.createElement('button');
  mainMenuBtnEl = mainMenuBtn;
  mainMenuBtn.id = 'btn-ingame-main-menu';
  mainMenuBtn.textContent = 'MAIN MENU';
  mainMenuBtn.style.cssText = `
    flex: 1;
    padding: 12px;
    font-size: 14px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #cfe3f5;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  `;
  mainMenuBtn.onmouseenter = () => { mainMenuBtn.style.background = 'rgba(255, 255, 255, 0.15)'; };
  mainMenuBtn.onmouseleave = () => { mainMenuBtn.style.background = 'rgba(255, 255, 255, 0.08)'; };
  mainMenuBtn.onclick = () => {
    hideInGameMenu();
    if (callbacks.onMainMenu) callbacks.onMainMenu();
  };

  const rematchBtn = document.createElement('button');
  rematchBtnEl = rematchBtn;
  rematchBtn.id = 'btn-ingame-rematch';
  rematchBtn.textContent = 'RESTART MATCH';
  rematchBtn.style.cssText = `
    flex: 1;
    padding: 12px;
    font-size: 14px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #00e5ff;
    background: rgba(0, 229, 255, 0.10);
    border: 1px solid rgba(0, 229, 255, 0.40);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  `;
  rematchBtn.onmouseenter = () => { rematchBtn.style.background = 'rgba(0, 229, 255, 0.20)'; };
  rematchBtn.onmouseleave = () => { rematchBtn.style.background = 'rgba(0, 229, 255, 0.10)'; };
  rematchBtn.onclick = () => {
    hideInGameMenu();
    if (callbacks.onRematch) callbacks.onRematch();
  };

  actionsBox.appendChild(resumeBtn);
  actionsBox.appendChild(rematchBtn);
  actionsBox.appendChild(mainMenuBtn);
  container.appendChild(actionsBox);

  const legendFooter = document.createElement('div');
  legendFooter.style.cssText = `
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.10);
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #94a3b8;
    text-align: center;
  `;
  legendFooter.innerHTML = '🎮 <b style="color:#ffffff;">↕</b> NAVIGATE &middot; <b style="color:#ffffff;">◀ ▶ / A</b> CHANGE &middot; <b style="color:#00e5ff;">B / START / ESC</b> RESUME';
  container.appendChild(legendFooter);

  menuOverlayEl.appendChild(container);
  document.body.appendChild(menuOverlayEl);

}

const CAMERA_MODES = ['chase', 'thirdPerson', 'firstPerson', 'tactical', 'broadcast'];
const CAMERA_LABELS = {
  chase: 'CHASE CAM',
  thirdPerson: 'BALL TRACK',
  firstPerson: '1ST PERSON',
  tactical: 'TACTICAL',
  broadcast: 'BROADCAST [SHARED]',
};

/**
 * Shows a camera row only for each human player, titled with their colour, side and
 * camera keys, and offers only modes that player can actually get: in splitscreen,
 * Broadcast exists only as the shared view both players are already on.
 */
function refreshCameraRows() {
  const rows = callbacks.getCameraRows ? callbacks.getCameraRows() : [];
  camSelObjs.forEach((obj, i) => {
    if (!obj) return;
    const row = rows[i];
    obj.box.style.display = row && row.visible ? 'block' : 'none';
    if (!row || !row.visible) return;
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
  // Leaving a shared Broadcast view also moves the other player, so redraw both rows.
  refreshCameraRows();
}

// ---------------------------------------------------------------------------
// In-Game Menu Navigation & Polling
// ---------------------------------------------------------------------------
function cycleDpr(dir = 1) {
  const curIdx = dprOptions.findIndex((o) => o.id === currentRenderSettings.pixelRatioPreset);
  const nextIdx = (curIdx + dir + dprOptions.length) % dprOptions.length;
  dprButtons[nextIdx]?.click();
  updateInGameFocusUI();
}

function cycleShadow(dir = 1) {
  const curIdx = shadowOptions.findIndex((o) => o.id === currentRenderSettings.shadowQuality);
  const nextIdx = (curIdx + dir + shadowOptions.length) % shadowOptions.length;
  shadowButtons[nextIdx]?.click();
  updateInGameFocusUI();
}

function cycleControls() {
  const nextVal = !(currentRenderSettings.showControlsOverlay ?? false);
  const targetBtn = controlsButtons.find((_, idx) => controlsOptions[idx].id === nextVal);
  targetBtn?.click();
  updateInGameFocusUI();
}

function cycleTuning() {
  const nextVal = !(currentRenderSettings.showTuningGui ?? false);
  const targetBtn = tuningButtons.find((_, idx) => tuningOptions[idx].id === nextVal);
  targetBtn?.click();
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
}

function toggleVibration() {
  const nextVal = !isVibrationEnabled();
  setVibrationEnabled(nextVal);
  vibrationButtons.forEach((b, idx) => {
    const isSel = vibrationOptions[idx].id === nextVal;
    b.style.background = isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
    b.style.color = isSel ? '#ffffff' : '#94a3b8';
  });
  soundManager.playTone(nextVal ? 520 : 360, 0.05, 'sine', 0.2);
  updateInGameFocusUI();
}

function cycleCam(playerIdx, sel, dir = 1) {
  if (!sel || sel.options.length === 0) return;
  sel.selectedIndex = (sel.selectedIndex + dir + sel.options.length) % sel.options.length;
  applyCameraChoice(playerIdx, sel.value);
}

function getActiveInGameRows() {
  const isPractice = window.__vb?.getGameState?.() === 'practice' || window.__vb?.matchState?.mode === 'practice';
  const rows = [];
  if (isPractice && finishPracticeBtn) {
    rows.push({
      el: finishPracticeBtn,
      isButton: true,
      onAction: () => finishPracticeBtn.click(),
      onLeft: () => {},
      onRight: () => {},
    });
  }
  if (dprRowEl) {
    rows.push({
      el: dprRowEl,
      onLeft: () => cycleDpr(-1),
      onRight: () => cycleDpr(1),
      onAction: () => cycleDpr(1),
    });
  }
  if (shadowRowEl) {
    rows.push({
      el: shadowRowEl,
      onLeft: () => cycleShadow(-1),
      onRight: () => cycleShadow(1),
      onAction: () => cycleShadow(1),
    });
  }
  if (controlsRowEl) {
    rows.push({
      el: controlsRowEl,
      onLeft: () => cycleControls(),
      onRight: () => cycleControls(),
      onAction: () => cycleControls(),
    });
  }
  if (tuningRowEl) {
    rows.push({
      el: tuningRowEl,
      onLeft: () => cycleTuning(),
      onRight: () => cycleTuning(),
      onAction: () => cycleTuning(),
    });
  }
  if (volRowEl) {
    rows.push({
      el: volRowEl,
      onLeft: () => adjustVolume(-5),
      onRight: () => adjustVolume(5),
      onAction: () => adjustVolume(5),
    });
  }
  if (muteRowEl) {
    rows.push({
      el: muteRowEl,
      onLeft: () => toggleMute(),
      onRight: () => toggleMute(),
      onAction: () => toggleMute(),
    });
  }
  if (vibrationRowEl) {
    rows.push({
      el: vibrationRowEl,
      onLeft: () => toggleVibration(),
      onRight: () => toggleVibration(),
      onAction: () => toggleVibration(),
    });
  }
  for (const i of [0, 2, 1, 3]) {
    const box = camBoxes[i];
    const selObj = camSelObjs[i];
    if (box && box.style.display !== 'none') {
      rows.push({
        el: box,
        onLeft: () => cycleCam(i, selObj?.select, -1),
        onRight: () => cycleCam(i, selObj?.select, 1),
        onAction: () => cycleCam(i, selObj?.select, 1),
      });
    }
  }
  const actionBtns = [
    resumeBtnEl,
    (!isPractice && rematchBtnEl && rematchBtnEl.style.display !== 'none') ? rematchBtnEl : null,
    mainMenuBtnEl,
  ].filter(Boolean);

  if (actionBtns.length > 0) {
    const firstActionRowIdx = rows.length;
    actionBtns.forEach((btn, idx) => {
      rows.push({
        el: btn,
        isButton: true,
        onAction: () => btn.click(),
        onLeft: () => {
          const prevOffset = (idx - 1 + actionBtns.length) % actionBtns.length;
          inGameFocusIndex = firstActionRowIdx + prevOffset;
          updateInGameFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
        },
        onRight: () => {
          const nextOffset = (idx + 1) % actionBtns.length;
          inGameFocusIndex = firstActionRowIdx + nextOffset;
          updateInGameFocusUI();
          soundManager.playTone(400, 0.04, 'sine', 0.15);
        },
        onUp: () => {
          if (firstActionRowIdx > 0) {
            inGameFocusIndex = firstActionRowIdx - 1;
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

  inGameNavRows.forEach((row, idx) => {
    const isSel = idx === inGameFocusIndex;
    if (row.isButton) {
      if (isSel) {
        row.el.style.outline = '2px solid #ffffff';
        row.el.style.outlineOffset = '2px';
        row.el.style.transform = 'scale(1.02)';
        row.el.style.boxShadow = '0 0 20px rgba(255, 255, 255, 0.5), 0 0 25px rgba(0, 229, 255, 0.25)';
        if (row.el === mainMenuBtnEl) {
          row.el.style.background = 'rgba(255, 255, 255, 0.2)';
          row.el.style.borderColor = '#ffffff';
          row.el.style.color = '#ffffff';
        }
        row.el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      } else {
        row.el.style.outline = 'none';
        row.el.style.transform = 'scale(1)';
        if (row.el === mainMenuBtnEl) {
          row.el.style.background = 'rgba(255, 255, 255, 0.08)';
          row.el.style.borderColor = 'rgba(255, 255, 255, 0.2)';
          row.el.style.color = '#cfe3f5';
        }
        row.el.style.boxShadow = row.el === resumeBtnEl ? '0 4px 18px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25)' : (row.el === finishPracticeBtn ? '0 4px 14px rgba(16, 185, 129, 0.4)' : 'none');
      }
    } else {
      if (isSel) {
        row.el.style.outline = '2px solid #ffffff';
        row.el.style.outlineOffset = '3px';
        row.el.style.background = 'rgba(255, 255, 255, 0.08)';
        row.el.style.borderRadius = '6px';
        row.el.style.boxShadow = '0 0 16px rgba(255, 255, 255, 0.35)';
        row.el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      } else {
        row.el.style.outline = 'none';
        row.el.style.background = camBoxes.includes(row.el) ? 'rgba(255, 255, 255, 0.04)' : 'transparent';
        row.el.style.boxShadow = 'none';
      }
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
        updateInGameFocusUI();
      }
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault();
      inGameNavRows = getActiveInGameRows();
      if (inGameNavRows[inGameFocusIndex]?.onDown) {
        inGameNavRows[inGameFocusIndex].onDown();
      } else {
        inGameFocusIndex = (inGameFocusIndex + 1) % inGameNavRows.length;
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
      hideInGameMenu();
      if (callbacks.onResume) callbacks.onResume();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  // Per-pad edges, seeded from what is held now: the Start press that opened the
  // menu must be released before Start can close it.
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

    for (const pad of pads) {
      if (!pad) continue;
      const e = inGamePads.pressed(pad);

      if (e & MENU_PAD.up) {
        if (inGameNavRows[inGameFocusIndex]?.onUp) {
          inGameNavRows[inGameFocusIndex].onUp();
        } else {
          inGameFocusIndex = (inGameFocusIndex - 1 + inGameNavRows.length) % inGameNavRows.length;
          updateInGameFocusUI();
        }
      }
      if (e & MENU_PAD.down) {
        if (inGameNavRows[inGameFocusIndex]?.onDown) {
          inGameNavRows[inGameFocusIndex].onDown();
        } else {
          inGameFocusIndex = (inGameFocusIndex + 1) % inGameNavRows.length;
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
        // The action may have closed the menu (Resume, Main Menu, Finish Practice).
        if (!isOpen) return;
      }
      if (e & (MENU_PAD.b | MENU_PAD.back | MENU_PAD.start)) {
        hideInGameMenu();
        if (callbacks.onResume) callbacks.onResume();
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

export function showInGameMenu() {
  if (!menuOverlayEl) return;
  isOpen = true;
  if (callbacks.onOpen) callbacks.onOpen();
  menuOverlayEl.style.display = 'flex';
  refreshCameraRows();
  if (menuOverlayEl._updateAudioUI) {
    menuOverlayEl._updateAudioUI();
  }

  const isPractice = window.__vb?.getGameState?.() === 'practice' || window.__vb?.matchState?.mode === 'practice';

  if (isPractice) {
    if (hustleBoardSection) {
      hustleBoardSection.style.display = 'flex';
      const stats = window.__vb?.practiceStats || {};
      const rawSec = window.__vb?.practiceSessionSeconds;
      const sec = typeof rawSec === 'function' ? rawSec() : (Number(rawSec) || 0);
      const minStr = String(Math.floor(sec / 60)).padStart(2, '0');
      const secStr = String(Math.floor(sec % 60)).padStart(2, '0');
      const hits = stats.hits || 0;
      const whiffs = stats.whiffs || 0;
      const attempts = hits + whiffs;
      const acc = attempts > 0 ? Math.round((hits / attempts) * 100) : 0;

      hustleBoardSection.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.15); padding-bottom: 6px;">
          <span style="font-size: 13px; font-weight: 800; letter-spacing: 0.1em; color: #ffffff;">⚡ HUSTLE BOARD · LIVE STATS</span>
          <span style="font-size: 11px; font-weight: 700; color: #ffffff;">TIME ${minStr}:${secStr}</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(75px, 1fr)); gap: 8px; margin-top: 6px;">
          <div style="background: rgba(255,255,255,0.04); padding: 8px; border-radius: 6px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8; font-weight: 700;">GOALS</div>
            <div style="font-size: 22px; font-weight: 900; color: #10b981; margin-top: 2px;">${stats.goals || 0}</div>
          </div>
          <div style="background: rgba(255,255,255,0.04); padding: 8px; border-radius: 6px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8; font-weight: 700;">ACCURACY</div>
            <div style="font-size: 22px; font-weight: 900; color: #38bdf8; margin-top: 2px;">${acc}%</div>
            <div style="font-size: 9px; color: #64748b;">${hits}H / ${whiffs}W</div>
          </div>
          <div style="background: rgba(255,255,255,0.04); padding: 8px; border-radius: 6px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8; font-weight: 700;">SWEET SPOTS</div>
            <div style="font-size: 22px; font-weight: 900; color: #fbbf24; margin-top: 2px;">★ ${stats.sweetSpots || 0}</div>
          </div>
          <div style="background: rgba(255,255,255,0.04); padding: 8px; border-radius: 6px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8; font-weight: 700;">SPIKES</div>
            <div style="font-size: 20px; font-weight: 800; color: #f43f5e; margin-top: 2px;">${stats.spikes || 0}</div>
          </div>
          <div style="background: rgba(255,255,255,0.04); padding: 8px; border-radius: 6px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8; font-weight: 700;">DIVES</div>
            <div style="font-size: 20px; font-weight: 800; color: #a855f7; margin-top: 2px;">${stats.dives || 0}</div>
          </div>
          <div style="background: rgba(255,255,255,0.04); padding: 8px; border-radius: 6px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8; font-weight: 700;">DIVING HITS</div>
            <div style="font-size: 20px; font-weight: 800; color: #ec4899; margin-top: 2px;">${stats.divingHits || 0}</div>
          </div>
          <div style="background: rgba(255,255,255,0.04); padding: 8px; border-radius: 6px; text-align: center;">
            <div style="font-size: 10px; color: #94a3b8; font-weight: 700;">TOUCHES</div>
            <div style="font-size: 20px; font-weight: 800; color: #e2e8f0; margin-top: 2px;">${stats.totalTouches || 0}</div>
          </div>
        </div>
      `;
    }
    if (finishPracticeBtn) finishPracticeBtn.style.display = 'block';
    if (rematchBtnEl) rematchBtnEl.style.display = 'none';
  } else {
    if (hustleBoardSection) hustleBoardSection.style.display = 'none';
    if (finishPracticeBtn) finishPracticeBtn.style.display = 'none';
    if (rematchBtnEl) rematchBtnEl.style.display = 'block';
  }

  if (window.__vb?.matchState) {
    updateInGameMenuBanner(window.__vb.matchState);
  }

  inGameFocusIndex = 0;
  updateInGameFocusUI();
  startInGameMenuPolling();
}

export function hideInGameMenu() {
  if (!menuOverlayEl) return;
  isOpen = false;
  stopInGameMenuPolling();
  menuOverlayEl.style.display = 'none';
  const rows = getActiveInGameRows();
  rows.forEach((r) => {
    if (r.isButton) {
      r.el.style.outline = 'none';
      r.el.style.transform = 'scale(1)';
      r.el.style.boxShadow = '';
    } else {
      r.el.style.outline = 'none';
      r.el.style.background = camBoxes.includes(r.el) ? 'rgba(255, 255, 255, 0.04)' : 'transparent';
      r.el.style.boxShadow = 'none';
    }
  });
}

export function toggleInGameMenu() {
  if (isOpen) hideInGameMenu();
  else showInGameMenu();
  return isOpen;
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
  clockBannerEl.textContent = `TIME: ${timeStr} · ${homeName} ${match.scoreHome} - ${match.scoreAway} ${awayName}`;
}
