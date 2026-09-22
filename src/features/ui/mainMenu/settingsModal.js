import { TUNING } from '../../../config/tuning.js';
import { soundManager } from '../../../audio/soundManager.js';
import { CAMERA_OPTIONS } from './constants.js';

/**
 * Main Menu Settings Modal (Decoupled from In-Game Pause)
 */
let mainMenuSettingsModalEl = null;

export function buildMainMenuSettingsModal(rootEl, playerConfigs = [], callbacks = {}) {
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
    if (playerConfigs[0]) playerConfigs[0].cameraMode = val;
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
  if (rootEl) rootEl.appendChild(mainMenuSettingsModalEl);

  return mainMenuSettingsModalEl;
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

export function getMainMenuSettingsModalEl() {
  return mainMenuSettingsModalEl;
}
