/**
 * In-Game Settings & Pause Menu for Valleyball Versus.
 *
 * Designed to NOT pause the play clock or freeze physics:
 * match time and background simulation continue running while open.
 */

import { getColorName } from './mainMenu.js';
import { TUNING } from '../config/tuning.js';
import { soundManager } from '../audio/soundManager.js';

let menuOverlayEl = null;
let isOpen = false;
let clockBannerEl = null;
let callbacks = {
  onResume: null,
  onRematch: null,
  onPracticeMode: null,
  onFinishPractice: null,
  onMainMenu: null,
  onRenderSettingsChange: null,
  onCameraChange: null,
};

let hustleBoardSection = null;
let finishPracticeBtn = null;
let p1CamBox = null;
let p2CamBox = null;

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
let p1CamSelObj = null;
let p2CamSelObj = null;
let resumeBtnEl = null;
let mainMenuBtnEl = null;

let inGameFocusIndex = 0;
let inGameNavRows = [];
let inGamePollHandle = null;
let inGamePrevPad = { up: false, down: false, left: false, right: false, a: false, b: false, start: false, back: false };

let currentRenderSettings = {
  pixelRatioPreset: 'native',
  shadowQuality: 'high',
  showControlsOverlay: true,
  showTuningGui: false,
};

export function initInGameMenu({
  onResume,
  onRematch,
  onPracticeMode,
  onFinishPractice,
  onMainMenu,
  onRenderSettingsChange,
  onCameraChange,
  initialRenderSettings = {},
}) {
  if (menuOverlayEl) return;
  callbacks = { onResume, onRematch, onPracticeMode, onFinishPractice, onMainMenu, onRenderSettingsChange, onCameraChange };
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
      <span style="font-size: 10px; font-weight: 800; color: #00e5ff; background: rgba(0, 229, 255, 0.12); border: 1px solid rgba(0, 229, 255, 0.35); padding: 2px 6px; border-radius: 4px; margin-left: 2px;">v0.2.3</span>
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
      background: ${(currentRenderSettings.showControlsOverlay ?? true) === opt.id ? '#2563eb' : 'rgba(255, 255, 255, 0.06)'};
      color: ${(currentRenderSettings.showControlsOverlay ?? true) === opt.id ? '#ffffff' : '#94a3b8'};
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
  };

  // 4. Camera Modes Section
  container.appendChild(createSectionHeading('CAMERAS'));
  const camGrid = document.createElement('div');
  camGrid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;';

  function createCamSelector(playerIndex, titleText) {
    const box = document.createElement('div');
    box.style.cssText = 'background: rgba(255, 255, 255, 0.04); padding: 10px 14px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1);';
    const t = document.createElement('div');
    t.textContent = titleText;
    t.style.cssText = 'font-size: 11px; font-weight: 700; color: #94a3b8; margin-bottom: 6px;';
    const sel = document.createElement('select');
    sel.style.cssText = 'width: 100%; padding: 6px 8px; font-family: inherit; font-size: 12px; background: #0f172a; color: #f8fafc; border: 1px solid rgba(120, 170, 210, 0.3); border-radius: 4px; cursor: pointer;';
    const camLabels = {
      chase: '3RD PERSON CHASE',
      ball: 'BALL TRACKING CAM',
      sports: 'SPORTS CAM [FULLSCREEN]',
      broadcast: 'BROADCAST CAM [FULLSCREEN]',
      tactical: 'TACTICAL CAM',
    };
    ['chase', 'ball', 'sports', 'broadcast', 'tactical'].forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = camLabels[m] || (m.toUpperCase() + ' CAM');
      sel.appendChild(opt);
    });
    sel.onchange = () => {
      if (callbacks.onCameraChange) callbacks.onCameraChange(playerIndex, sel.value);
    };
    box.appendChild(t);
    box.appendChild(sel);
    return { box, select: sel };
  }

  const p1CamSel = createCamSelector(0, 'PLAYER 1 (HOME) [Tab]');
  const p2CamSel = createCamSelector(1, 'PLAYER 2 (AWAY) [ ] ]');
  p1CamSelObj = p1CamSel;
  p2CamSelObj = p2CamSel;
  p1CamBox = p1CamSel.box;
  p1CamBox.id = 'ingame-p1-cam-box';
  p2CamBox = p2CamSel.box;
  p2CamBox.id = 'ingame-p2-cam-box';
  camGrid.appendChild(p1CamSel.box);
  camGrid.appendChild(p2CamSel.box);
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

  actionsBox.appendChild(resumeBtn);
  actionsBox.appendChild(mainMenuBtn);
  container.appendChild(actionsBox);

  menuOverlayEl.appendChild(container);
  document.body.appendChild(menuOverlayEl);

  // Expose camera selector update function
  menuOverlayEl._updateCamSelects = (cam1Mode, cam2Mode) => {
    if (cam1Mode && p1CamSel?.select) p1CamSel.select.value = cam1Mode;
    if (cam2Mode && p2CamSel?.select) p2CamSel.select.value = cam2Mode;
  };
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
  const nextVal = !(currentRenderSettings.showControlsOverlay ?? true);
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

function cycleCam(playerIdx, sel, dir = 1) {
  if (!sel) return;
  const modes = ['chase', 'ball', 'sports', 'broadcast', 'tactical'];
  const curIdx = modes.indexOf(sel.value);
  const nextIdx = (curIdx + dir + modes.length) % modes.length;
  sel.value = modes[nextIdx];
  if (callbacks.onCameraChange) callbacks.onCameraChange(playerIdx, sel.value);
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
  if (p1CamBox) {
    rows.push({
      el: p1CamBox,
      onLeft: () => cycleCam(0, p1CamSelObj?.select, -1),
      onRight: () => cycleCam(0, p1CamSelObj?.select, 1),
      onAction: () => cycleCam(0, p1CamSelObj?.select, 1),
    });
  }
  if (!isPractice && p2CamBox) {
    rows.push({
      el: p2CamBox,
      onLeft: () => cycleCam(1, p2CamSelObj?.select, -1),
      onRight: () => cycleCam(1, p2CamSelObj?.select, 1),
      onAction: () => cycleCam(1, p2CamSelObj?.select, 1),
    });
  }
  if (resumeBtnEl) {
    rows.push({
      el: resumeBtnEl,
      isButton: true,
      onAction: () => resumeBtnEl.click(),
      onLeft: () => {},
      onRight: () => {
        if (mainMenuBtnEl) {
          const mIdx = rows.findIndex((r) => r.el === mainMenuBtnEl);
          if (mIdx !== -1) {
            inGameFocusIndex = mIdx;
            updateInGameFocusUI();
          }
        }
      },
      onDown: () => {
        if (mainMenuBtnEl) {
          const mIdx = rows.findIndex((r) => r.el === mainMenuBtnEl);
          if (mIdx !== -1) {
            inGameFocusIndex = mIdx;
            updateInGameFocusUI();
          }
        }
      },
    });
  }
  if (mainMenuBtnEl) {
    rows.push({
      el: mainMenuBtnEl,
      isButton: true,
      onAction: () => mainMenuBtnEl.click(),
      onLeft: () => {
        if (resumeBtnEl) {
          const rIdx = rows.findIndex((r) => r.el === resumeBtnEl);
          if (rIdx !== -1) {
            inGameFocusIndex = rIdx;
            updateInGameFocusUI();
          }
        }
      },
      onRight: () => {},
      onUp: () => {
        const rIdx = rows.findIndex((r) => r.el === resumeBtnEl);
        if (rIdx > 0) {
          inGameFocusIndex = rIdx - 1;
          updateInGameFocusUI();
        }
      },
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
        row.el.style.background = (row.el === p1CamBox || row.el === p2CamBox) ? 'rgba(255, 255, 255, 0.04)' : 'transparent';
        row.el.style.boxShadow = 'none';
      }
    }
  });
}

function startInGameMenuPolling() {
  stopInGameMenuPolling();

  const menuOpenedAt = Date.now();
  let closeAllowed = false;

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

  // Seed initial button states from connected gamepads so opening button holds don't trigger edge closes
  const initialPads = (typeof navigator.getGamepads === 'function') ? (navigator.getGamepads() || []) : [];
  let initB = false, initBack = false, initStart = false;
  for (let i = 0; i < initialPads.length; i++) {
    const pad = initialPads[i];
    if (pad && pad.connected) {
      if (pad.buttons[1]?.pressed) initB = true;
      if (pad.buttons[8]?.pressed) initBack = true;
      if (pad.buttons[9]?.pressed) initStart = true;
    }
  }

  inGamePrevPad = {
    up: false,
    down: false,
    left: false,
    right: false,
    a: false,
    b: initB || true,
    start: initStart || true,
    back: initBack || true,
  };

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

    inGameNavRows = getActiveInGameRows();
    if (inGameNavRows.length === 0) return;

    for (const pad of pads) {
      if (!pad) continue;
      const up = (pad.buttons[12]?.pressed || (pad.axes[1] && pad.axes[1] < -0.5)) || false;
      const down = (pad.buttons[13]?.pressed || (pad.axes[1] && pad.axes[1] > 0.5)) || false;
      const left = (pad.buttons[14]?.pressed || (pad.axes[0] && pad.axes[0] < -0.5)) || false;
      const right = (pad.buttons[15]?.pressed || (pad.axes[0] && pad.axes[0] > 0.5)) || false;
      const btnA = pad.buttons[0]?.pressed || false;
      const btnB = pad.buttons[1]?.pressed || false;
      const btnBack = pad.buttons[8]?.pressed || false;
      const btnStart = pad.buttons[9]?.pressed || false;

      const p = inGamePrevPad;

      // Close buttons must be released and cooldown window passed before accepting dismiss
      if (!closeAllowed) {
        if (!btnB && !btnBack && !btnStart && (Date.now() - menuOpenedAt > 200)) {
          closeAllowed = true;
        }
      }

      if (up && !p.up) {
        if (inGameNavRows[inGameFocusIndex]?.onUp) {
          inGameNavRows[inGameFocusIndex].onUp();
        } else {
          inGameFocusIndex = (inGameFocusIndex - 1 + inGameNavRows.length) % inGameNavRows.length;
          updateInGameFocusUI();
        }
      }
      if (down && !p.down) {
        if (inGameNavRows[inGameFocusIndex]?.onDown) {
          inGameNavRows[inGameFocusIndex].onDown();
        } else {
          inGameFocusIndex = (inGameFocusIndex + 1) % inGameNavRows.length;
          updateInGameFocusUI();
        }
      }
      if (left && !p.left) {
        inGameNavRows[inGameFocusIndex]?.onLeft?.();
      }
      if (right && !p.right) {
        inGameNavRows[inGameFocusIndex]?.onRight?.();
      }
      if (btnA && !p.a) {
        inGameNavRows[inGameFocusIndex]?.onAction?.();
      }
      if (closeAllowed && ((btnB && !p.b) || (btnBack && !p.back) || (btnStart && !p.start))) {
        hideInGameMenu();
        if (callbacks.onResume) callbacks.onResume();
        p.b = btnB; p.back = btnBack; p.start = btnStart;
        return;
      }

      p.up = up;
      p.down = down;
      p.left = left;
      p.right = right;
      p.a = btnA;
      p.b = btnB;
      p.back = btnBack;
      p.start = btnStart;
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

export function showInGameMenu(cam1Mode, cam2Mode) {
  if (!menuOverlayEl) return;
  isOpen = true;
  menuOverlayEl.style.display = 'flex';
  if (menuOverlayEl._updateCamSelects) {
    menuOverlayEl._updateCamSelects(cam1Mode, cam2Mode);
  }
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
    if (p2CamBox) p2CamBox.style.display = 'none';
  } else {
    if (hustleBoardSection) hustleBoardSection.style.display = 'none';
    if (finishPracticeBtn) finishPracticeBtn.style.display = 'none';
    if (p2CamBox) p2CamBox.style.display = 'block';
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
      r.el.style.background = (r.el === p1CamBox || r.el === p2CamBox) ? 'rgba(255, 255, 255, 0.04)' : 'transparent';
      r.el.style.boxShadow = 'none';
    }
  });
}

export function toggleInGameMenu(cam1Mode, cam2Mode) {
  if (isOpen) hideInGameMenu();
  else showInGameMenu(cam1Mode, cam2Mode);
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
  const min = Math.floor(match.ticksRemaining / (60 * 60));
  const sec = Math.floor((match.ticksRemaining % (60 * 60)) / 60);
  const timeStr = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  const homeColor = TUNING.athlete?.palette?.homePrimary ?? 0xd90429;
  const awayColor = TUNING.athlete?.palette?.awayPrimary ?? 0x1d4ed8;
  const homeName = getColorName(homeColor).toUpperCase();
  const awayName = getColorName(awayColor).toUpperCase();
  clockBannerEl.textContent = `TIME: ${timeStr} · ${homeName} ${match.scoreHome} - ${match.scoreAway} ${awayName}`;
}
