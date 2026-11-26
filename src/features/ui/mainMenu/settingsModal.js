import {
  getHudPrefs,
  setHudPrefs,
  setCleanBroadcastHud,
  subscribeHudPrefs,
  applyHudPreset,
  getActiveHudPresetId,
  getRenderQualitySettings,
  setRenderQualitySettings,
  getCameraShakeMode,
  setCameraShakeMode,
  setDefaultCameraMode,
} from '../../../config/hudConfig.js';
import { soundManager } from '../../../audio/soundManager.js';
import { setVibrationEnabled, isVibrationEnabled } from '../../../input/inputRouter.js';
import { CAMERA_OPTIONS } from './constants.js';

/**
 * Main Menu Settings Modal: 4-tab zero-scroll layout (HUD & Guides | Graphics | Audio | Camera & Controls).
 */
let mainMenuSettingsModalEl = null;
function ensureSettingsTabStyles() {
  if (typeof document === 'undefined' || !document.head || typeof document.head.appendChild !== 'function') return;
  if (document.getElementById?.('vb-settings-tabs-style')) return;
  const style = document.createElement('style');
  style.id = 'vb-settings-tabs-style';
  style.textContent = `
    #settings-tablist [role="tab"] {
      position: relative;
      flex: 1 1 0;
      padding: 9px 10px;
      font-size: 11px;
      font-weight: 800;
      font-family: inherit;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #94a3b8;
      background: transparent;
      border: none;
      cursor: pointer;
      white-space: nowrap;
    }
    #settings-tablist [role="tab"][aria-selected="true"] {
      color: #38bdf8;
    }
    #settings-tablist [role="tab"][aria-selected="true"]::after {
      content: "";
      position: absolute;
      inset: auto 8px 0 8px;
      border-block-end: 3px solid #38bdf8;
    }
  `;
  document.head.appendChild(style);
}

export function buildMainMenuSettingsModal(rootEl, playerConfigs = [], callbacks = {}) {
  ensureSettingsTabStyles();
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
    -webkit-backdrop-filter: blur(12px);
    pointer-events: auto;
    z-index: 1000;
  `;

  let showTuningGuiState = false;
  let activeTabIdx = 0;
  let settingsFocusIndex = 1;

  const box = document.createElement('div');
  box.style.cssText = `
    display: flex;
    flex-direction: column;
    max-width: 640px;
    width: 94%;
    background: rgba(11, 17, 26, 0.98);
    border: 1px solid rgba(120, 170, 210, 0.35);
    border-radius: 14px;
    padding: 20px 28px 22px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.9), 0 0 30px rgba(56, 189, 248, 0.15);
    font-family: inherit;
    color: #cfe3f5;
    overflow: hidden;
    box-sizing: border-box;
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid;
    border-image: linear-gradient(90deg, #FF2A42 0%, #FF6B00 14.3%, #FFD000 28.6%, #10E56A 42.9%, #00E5FF 57.2%, #1F65FF 71.5%, #6B11FF 85.8%, #E000B8 100%) 1;
    padding-bottom: 10px;
    margin-bottom: 12px;
  `;
  header.innerHTML = `
    <div>
      <div style="font-size: 19px; font-weight: 900; letter-spacing: 0.1em; color: #ffffff;">SETTINGS</div>
      <div style="font-size: 10.5px; color: #94a3b8; font-weight: 700; letter-spacing: 0.08em; margin-top: 2px;">SWITCH CATEGORIES WITH CLICK, Q / E, TAB, OR LB / RB</div>
    </div>
  `;
  box.appendChild(header);

  // Accessible single-row horizontal tablist (no wrapping, no layout-shifting active styles)
  const tabDefs = [
    { id: 'hud', label: 'HUD & Guides' },
    { id: 'graphics', label: 'Graphics' },
    { id: 'audio', label: 'Audio' },
    { id: 'camera', label: 'Camera & Controls' },
  ];

  const tablistEl = document.createElement('div');
  tablistEl.id = 'settings-tablist';
  tablistEl.setAttribute?.('role', 'tablist');
  tablistEl.setAttribute?.('aria-label', 'Settings Categories');
  tablistEl.style.cssText = `
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 4px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.22);
    margin-bottom: 14px;
    overflow-x: auto;
    scrollbar-width: none;
  `;

  const tabBtns = [];
  const panelEls = [];
  const panelWrappers = [];

  const panelsHost = document.createElement('div');
  panelsHost.style.cssText = 'display: grid; grid-template-columns: 1fr; min-height: 256px;';

  tabDefs.forEach((def, idx) => {
    const tBtn = document.createElement('button');
    tBtn.type = 'button';
    tBtn.id = `settings-tab-${def.id}`;
    tBtn.setAttribute?.('role', 'tab');
    tBtn.setAttribute?.('aria-selected', idx === 0 ? 'true' : 'false');
    tBtn.textContent = def.label;
    tBtn.onclick = () => selectTab(idx, false);
    tabBtns.push(tBtn);
    tablistEl.appendChild(tBtn);

    const panel = document.createElement('div');
    panel.id = `settings-panel-${def.id}`;
    panel.setAttribute?.('role', 'tabpanel');
    panel.setAttribute?.('aria-labelledby', tBtn.id);
    if (idx !== 0) {
      panel.hidden = true;
      panel.style.display = 'none';
    } else {
      panel.style.display = 'block';
    }
    const inner = document.createElement('div');
    inner.style.cssText = 'display: flex; flex-direction: column; gap: 10px; padding: 2px 0;';
    panel.appendChild(inner);
    panelEls.push(panel);
    panelWrappers.push(inner);
    panelsHost.appendChild(panel);
  });

  box.appendChild(tablistEl);
  box.appendChild(panelsHost);

  const [hudWrap, gfxWrap, audioWrap, camWrap] = panelWrappers;

  const notifyRenderSettings = (payload) => {
    if (callbacks.onRenderSettingsChange) callbacks.onRenderSettingsChange(payload);
    else if (typeof window !== 'undefined' && window.__vb?.applyRenderSettings) window.__vb.applyRenderSettings(payload);
  };

  const buildToggleRow = (parentEl, labelText, opts, currentVal, onPick) => {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 3px 4px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size: 12px; font-weight: 700; color: #cbd5e1;';
    lbl.textContent = labelText;
    const grp = document.createElement('div');
    grp.style.cssText = 'display: flex; gap: 6px;';
    const btns = [];
    opts.forEach((opt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = opt.label;
      const isSel = currentVal === opt.id;
      b.style.cssText = `
        padding: 6px 12px; font-size: 11px; font-weight: 700; font-family: inherit;
        border-radius: 4px; cursor: pointer; border: 1px solid rgba(120, 170, 210, 0.3); transition: background 0.12s ease, color 0.12s ease;
        background: ${isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.06)'};
        color: ${isSel ? '#ffffff' : '#94a3b8'};
      `;
      b.onclick = () => onPick(opt.id);
      btns.push(b);
      grp.appendChild(b);
    });
    row.append(lbl, grp);
    parentEl.appendChild(row);
    return { row, btns };
  };

  // =========================================================================
  // TAB 0: HUD & GUIDES
  // =========================================================================
  const hudPresetRow = document.createElement('div');
  hudPresetRow.id = 'settings-hud-preset-row';
  hudPresetRow.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 9px 12px;
    background: rgba(56, 189, 248, 0.08);
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: 8px;
  `;
  const hudPresetHeader = document.createElement('div');
  hudPresetHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
  const hudPresetLabel = document.createElement('span');
  hudPresetLabel.style.cssText = 'font-size: 12px; font-weight: 800; letter-spacing: 0.06em; color: #e0f2fe; text-transform: uppercase;';
  hudPresetLabel.textContent = 'HUD Preset';
  const hudPresetBadge = document.createElement('span');
  hudPresetBadge.id = 'settings-hud-preset-badge';
  hudPresetBadge.style.cssText = 'font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(56, 189, 248, 0.35); color: #38bdf8;';
  hudPresetHeader.append(hudPresetLabel, hudPresetBadge);

  const hudPresetGroup = document.createElement('div');
  hudPresetGroup.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px;';
  const hudPresetOpts = [
    { id: 'minimal', btnId: 'btn-hud-preset-minimal', label: 'Minimal / Clean Broadcast', shortLabel: 'Minimal' },
    { id: 'standard', btnId: 'btn-hud-preset-standard', label: 'Standard', shortLabel: 'Standard' },
    { id: 'rookie', btnId: 'btn-hud-preset-rookie', label: 'Rookie / Live Room', shortLabel: 'Rookie' },
  ];
  const hudPresetBtns = [];
  const initPresetId = getActiveHudPresetId();
  hudPresetBadge.textContent = hudPresetOpts.find((o) => o.id === initPresetId)?.shortLabel || 'Custom';
  hudPresetBadge.style.color = initPresetId === 'custom' ? '#fbbf24' : '#38bdf8';

  hudPresetOpts.forEach((opt) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = opt.btnId;
    b.textContent = opt.label;
    const isSel = initPresetId === opt.id;
    b.style.cssText = `
      flex: 1 1 auto; padding: 6px 10px; font-size: 11px; font-weight: 700; font-family: inherit;
      border-radius: 4px; cursor: pointer; border: 1px solid rgba(120, 170, 210, 0.3);
      background: ${isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.06)'};
      color: ${isSel ? '#ffffff' : '#94a3b8'};
    `;
    b.onclick = () => {
      applyHudPreset(opt.id);
      notifyRenderSettings({ showControlsOverlay: Boolean(getHudPrefs().controlsOverlay) });
    };
    hudPresetBtns.push(b);
    hudPresetGroup.appendChild(b);
  });
  hudPresetRow.append(hudPresetHeader, hudPresetGroup);
  hudWrap.appendChild(hudPresetRow);

  const initHud = getHudPrefs();
  const overlayOpts = [
    { id: false, label: 'Hidden (Default)' },
    { id: true, label: 'Visible' },
  ];
  const { row: overlayRow, btns: overlayBtns } = buildToggleRow(
    hudWrap,
    'Controls Overlay (HUD)',
    overlayOpts,
    Boolean(initHud.controlsOverlay),
    (val) => {
      setHudPrefs({ controlsOverlay: val });
      notifyRenderSettings({ showControlsOverlay: val });
    },
  );

  const scorebugOpts = [
    { id: 'off', label: 'Off' },
    { id: 'splitscreen', label: 'Split-Screen' },
    { id: 'always', label: 'Always' },
  ];
  const { row: scorebugRow, btns: scorebugBtns } = buildToggleRow(
    hudWrap,
    'Broadcast Scorebug',
    scorebugOpts,
    initHud.scorebugMode,
    (val) => setHudPrefs({ scorebugMode: val }),
  );

  const boolOpts = [
    { id: false, label: 'Off' },
    { id: true, label: 'On' },
  ];
  const { row: dropRingRow, btns: dropRingBtns } = buildToggleRow(
    hudWrap,
    'Ball Rainbow Halo',
    boolOpts,
    initHud.ballDropRing,
    (val) => setHudPrefs({ ballDropRing: val }),
  );
  const { row: strikeGuideRow, btns: strikeGuideBtns } = buildToggleRow(
    hudWrap,
    'Strike Range Guide',
    boolOpts,
    initHud.strikeRangeGuide,
    (val) => setHudPrefs({ strikeRangeGuide: val }),
  );
  const { row: orientRow, btns: orientBtns } = buildToggleRow(
    hudWrap,
    'Ball Pip & Swap Cues',
    boolOpts,
    initHud.orientationCues,
    (val) => setHudPrefs({ orientationCues: val }),
  );

  const cleanRow = document.createElement('div');
  cleanRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 3px 4px;';
  const cleanLabel = document.createElement('span');
  cleanLabel.style.cssText = 'font-size: 12px; font-weight: 700; color: #cbd5e1;';
  cleanLabel.textContent = 'Clean Broadcast Footage';
  const cleanBtn = document.createElement('button');
  cleanBtn.type = 'button';
  cleanBtn.textContent = 'Hide All Guides';
  cleanBtn.style.cssText = `
    padding: 6px 12px; font-size: 11px; font-weight: 700; font-family: inherit;
    border-radius: 4px; cursor: pointer; border: 1px solid rgba(56, 189, 248, 0.45);
    background: rgba(56, 189, 248, 0.14); color: #e0f2fe;
  `;
  cleanBtn.onclick = () => {
    setCleanBroadcastHud();
    notifyRenderSettings({ showControlsOverlay: false });
  };
  cleanRow.append(cleanLabel, cleanBtn);
  hudWrap.appendChild(cleanRow);

  // =========================================================================
  // TAB 1: GRAPHICS
  // =========================================================================
  const initRender = getRenderQualitySettings();
  const gfxOpts = [
    { id: 'low', label: 'Low (Fast)' },
    { id: 'balanced', label: 'Balanced' },
    { id: 'high', label: 'High' },
  ];
  const dprOpts = [
    { id: '1.0', label: '1.0x (Fast)' },
    { id: '1.25', label: '1.25x (Balanced)' },
    { id: 'native', label: 'Native (Ultra)' },
  ];
  const shadowOpts = [
    { id: 'off', label: 'Off' },
    { id: 'balanced', label: 'Balanced (1 Tower)' },
    { id: 'high', label: 'High (4 Towers)' },
  ];

  let dprBtns = [];
  let shadowBtns = [];

  const syncGraphicsHighlight = () => {
    const cur = getRenderQualitySettings();
    gfxBtns.forEach((b, idx) => {
      const s = gfxOpts[idx].id === cur.graphicsPreset;
      b.style.background = s ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
      b.style.color = s ? '#ffffff' : '#94a3b8';
    });
    dprBtns.forEach((b, idx) => {
      const s = dprOpts[idx].id === cur.pixelRatioPreset;
      b.style.background = s ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
      b.style.color = s ? '#ffffff' : '#94a3b8';
    });
    shadowBtns.forEach((b, idx) => {
      const s = shadowOpts[idx].id === cur.shadowQuality;
      b.style.background = s ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
      b.style.color = s ? '#ffffff' : '#94a3b8';
    });
  };

  const { row: gfxRow, btns: gfxBtns } = buildToggleRow(
    gfxWrap,
    'Graphics Preset',
    gfxOpts,
    initRender.graphicsPreset,
    (val) => {
      const next = setRenderQualitySettings({ graphicsPreset: val });
      syncGraphicsHighlight();
      notifyRenderSettings({
        graphicsPreset: next.graphicsPreset,
        pixelRatioPreset: next.pixelRatioPreset,
        shadowQuality: next.shadowQuality,
        showControlsOverlay: Boolean(getHudPrefs().controlsOverlay),
      });
    },
  );

  const dprCtrl = buildToggleRow(
    gfxWrap,
    'Resolution Scale',
    dprOpts,
    initRender.pixelRatioPreset,
    (val) => {
      setRenderQualitySettings({ pixelRatioPreset: val });
      syncGraphicsHighlight();
      notifyRenderSettings({
        pixelRatioPreset: val,
        showControlsOverlay: Boolean(getHudPrefs().controlsOverlay),
      });
    },
  );
  const dprRow = dprCtrl.row;
  dprBtns = dprCtrl.btns;

  const shadowCtrl = buildToggleRow(
    gfxWrap,
    'Stadium Shadows',
    shadowOpts,
    initRender.shadowQuality,
    (val) => {
      setRenderQualitySettings({ shadowQuality: val });
      syncGraphicsHighlight();
      notifyRenderSettings({
        shadowQuality: val,
        showControlsOverlay: Boolean(getHudPrefs().controlsOverlay),
      });
    },
  );
  const shadowRow = shadowCtrl.row;
  shadowBtns = shadowCtrl.btns;

  // =========================================================================
  // TAB 2: AUDIO
  // =========================================================================
  const masterRow = document.createElement('div');
  masterRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px 4px;';
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

  const sfxRow = document.createElement('div');
  sfxRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px 4px;';
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

  masterRow.append(masterLabel, masterSlider, masterVal);
  sfxRow.append(sfxLabel, sfxSlider, sfxVal);
  audioWrap.append(masterRow, sfxRow);

  const muteOpts = [
    { id: false, label: 'Unmuted' },
    { id: true, label: 'Muted' },
  ];
  const { row: muteRow, btns: muteBtns } = buildToggleRow(
    audioWrap,
    'Mute Audio',
    muteOpts,
    Boolean(soundManager.isMuted?.()),
    (muted) => {
      soundManager.setMuted?.(muted);
      syncAudioUI();
    },
  );

  const syncAudioUI = () => {
    const mVol = Math.round((soundManager.getMasterVolume?.() ?? 0.8) * 100);
    const sVol = Math.round((soundManager.getSfxVolume?.() ?? 0.8) * 100);
    masterSlider.value = String(mVol);
    masterVal.textContent = `${mVol}%`;
    sfxSlider.value = String(sVol);
    sfxVal.textContent = `${sVol}%`;
    const isMuted = Boolean(soundManager.isMuted?.());
    muteBtns.forEach((b, idx) => {
      const s = muteOpts[idx].id === isMuted;
      b.style.background = s ? (isMuted ? '#ef4444' : '#2563eb') : 'rgba(255, 255, 255, 0.06)';
      b.style.color = s ? '#ffffff' : '#94a3b8';
    });
  };

  masterSlider.oninput = (e) => {
    const val = Number(e.target.value) / 100;
    masterVal.textContent = `${e.target.value}%`;
    soundManager.setMasterVolume(val);
    if (val > 0 && soundManager.isMuted?.()) {
      soundManager.setMuted(false);
      syncAudioUI();
    }
  };
  sfxSlider.oninput = (e) => {
    const val = Number(e.target.value) / 100;
    sfxVal.textContent = `${e.target.value}%`;
    soundManager.setSfxVolume(val);
  };

  // =========================================================================
  // TAB 3: CAMERA & CONTROLS
  // =========================================================================
  const camRow = document.createElement('div');
  camRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 3px 4px;';
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
    setDefaultCameraMode(val);
    if (typeof window !== 'undefined' && window.__vb?.setPlayerConfig) window.__vb.setPlayerConfig(0, { cameraMode: val });
    const lobbySelect = typeof document !== 'undefined' ? document.getElementById('select-camera-p1') : null;
    if (lobbySelect) lobbySelect.value = val;
  };
  camRow.append(camLabel, camSelect);
  camWrap.appendChild(camRow);

  const shakeOpts = [
    { id: 'off', label: 'Off' },
    { id: 'subtle', label: 'Subtle' },
    { id: 'full', label: 'Full' },
  ];
  const { row: shakeRow, btns: shakeBtns } = buildToggleRow(
    camWrap,
    'Screen Shake',
    shakeOpts,
    getCameraShakeMode(),
    (val) => {
      setCameraShakeMode(val);
      shakeBtns.forEach((btn, idx) => {
        const s = shakeOpts[idx].id === val;
        btn.style.background = s ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
        btn.style.color = s ? '#ffffff' : '#94a3b8';
      });
    },
  );

  const vibOpts = [
    { id: true, label: 'On' },
    { id: false, label: 'Off' },
  ];
  const { row: vibRow, btns: vibBtns } = buildToggleRow(
    camWrap,
    'Controller Vibration',
    vibOpts,
    isVibrationEnabled(),
    (val) => {
      setVibrationEnabled(val);
      vibBtns.forEach((btn, idx) => {
        const s = vibOpts[idx].id === val;
        btn.style.background = s ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
        btn.style.color = s ? '#ffffff' : '#94a3b8';
      });
    },
  );

  const { row: tuningRow, btns: tuningBtns } = buildToggleRow(
    camWrap,
    'Valleyball Tuning GUI',
    boolOpts,
    showTuningGuiState,
    (val) => {
      showTuningGuiState = val;
      tuningBtns.forEach((btn, idx) => {
        const s = boolOpts[idx].id === val;
        btn.style.background = s ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
        btn.style.color = s ? '#ffffff' : '#94a3b8';
      });
      notifyRenderSettings({ showTuningGui: val });
    },
  );

  // Close Button
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.id = 'btn-close-main-menu-settings';
  closeBtn.textContent = 'BACK / CLOSE [ESC / B]';
  closeBtn.style.cssText = `
    margin-top: 14px; padding: 11px; font-size: 12.5px; font-weight: 900; font-family: inherit;
    letter-spacing: 0.1em; color: #ffffff; background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 8px; cursor: pointer;
  `;
  closeBtn.onclick = hideMainMenuSettingsModal;
  box.appendChild(closeBtn);

  mainMenuSettingsModalEl.appendChild(box);
  if (rootEl) rootEl.appendChild(mainMenuSettingsModalEl);

  const syncMainHudButtons = (prefs) => {
    const activePreset = getActiveHudPresetId();
    hudPresetBtns.forEach((btn, idx) => {
      const s = hudPresetOpts[idx].id === activePreset;
      btn.style.background = s ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
      btn.style.color = s ? '#ffffff' : '#94a3b8';
    });
    hudPresetBadge.textContent = hudPresetOpts.find((o) => o.id === activePreset)?.shortLabel || 'Custom';
    hudPresetBadge.style.color = activePreset === 'custom' ? '#fbbf24' : '#38bdf8';
    const overlayEnabled = Boolean(prefs.controlsOverlay);
    overlayBtns.forEach((btn, idx) => {
      const s = overlayOpts[idx].id === overlayEnabled;
      btn.style.background = s ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
      btn.style.color = s ? '#ffffff' : '#94a3b8';
    });
    scorebugBtns.forEach((btn, idx) => {
      const s = scorebugOpts[idx].id === prefs.scorebugMode;
      btn.style.background = s ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
      btn.style.color = s ? '#ffffff' : '#94a3b8';
    });
    dropRingBtns.forEach((btn, idx) => {
      const s = boolOpts[idx].id === prefs.ballDropRing;
      btn.style.background = s ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
      btn.style.color = s ? '#ffffff' : '#94a3b8';
    });
    strikeGuideBtns.forEach((btn, idx) => {
      const s = boolOpts[idx].id === prefs.strikeRangeGuide;
      btn.style.background = s ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
      btn.style.color = s ? '#ffffff' : '#94a3b8';
    });
    orientBtns.forEach((btn, idx) => {
      const s = boolOpts[idx].id === prefs.orientationCues;
      btn.style.background = s ? '#2563eb' : 'rgba(255, 255, 255, 0.06)';
      btn.style.color = s ? '#ffffff' : '#94a3b8';
    });
    syncGraphicsHighlight();
  };
  subscribeHudPrefs(syncMainHudButtons);
  syncMainHudButtons(getHudPrefs());

  const tabBarNavRow = {
    el: tablistEl,
    isTabBar: true,
    onLeft: () => selectTab((activeTabIdx - 1 + tabDefs.length) % tabDefs.length, true),
    onRight: () => selectTab((activeTabIdx + 1) % tabDefs.length, true),
    onAction: () => selectTab((activeTabIdx + 1) % tabDefs.length, true),
  };

  const closeNavRow = {
    el: closeBtn,
    isButton: true,
    onLeft: () => {},
    onRight: () => {},
    onAction: () => {
      soundManager.playTone(330, 0.08, 'sine', 0.2);
      hideMainMenuSettingsModal();
    },
  };

  const cycleHelper = (opts, btns, curVal, dir) => {
    const curIdx = opts.findIndex((o) => o.id === curVal);
    const nextIdx = curIdx === -1 ? 0 : (curIdx + dir + opts.length) % opts.length;
    btns[nextIdx]?.click();
    soundManager.playTone(dir < 0 ? 440 : 520, 0.05, 'sine', 0.15);
  };

  const tabRowsByIdx = [
    // Tab 0: HUD & Guides
    [
      {
        el: hudPresetRow,
        onLeft: () => cycleHelper(hudPresetOpts, hudPresetBtns, getActiveHudPresetId(), -1),
        onRight: () => cycleHelper(hudPresetOpts, hudPresetBtns, getActiveHudPresetId(), 1),
        onAction: () => cycleHelper(hudPresetOpts, hudPresetBtns, getActiveHudPresetId(), 1),
      },
      {
        el: overlayRow,
        onLeft: () => cycleHelper(overlayOpts, overlayBtns, Boolean(getHudPrefs().controlsOverlay), -1),
        onRight: () => cycleHelper(overlayOpts, overlayBtns, Boolean(getHudPrefs().controlsOverlay), 1),
        onAction: () => cycleHelper(overlayOpts, overlayBtns, Boolean(getHudPrefs().controlsOverlay), 1),
      },
      {
        el: scorebugRow,
        onLeft: () => cycleHelper(scorebugOpts, scorebugBtns, getHudPrefs().scorebugMode, -1),
        onRight: () => cycleHelper(scorebugOpts, scorebugBtns, getHudPrefs().scorebugMode, 1),
        onAction: () => cycleHelper(scorebugOpts, scorebugBtns, getHudPrefs().scorebugMode, 1),
      },
      {
        el: dropRingRow,
        onLeft: () => cycleHelper(boolOpts, dropRingBtns, Boolean(getHudPrefs().ballDropRing), -1),
        onRight: () => cycleHelper(boolOpts, dropRingBtns, Boolean(getHudPrefs().ballDropRing), 1),
        onAction: () => cycleHelper(boolOpts, dropRingBtns, Boolean(getHudPrefs().ballDropRing), 1),
      },
      {
        el: strikeGuideRow,
        onLeft: () => cycleHelper(boolOpts, strikeGuideBtns, Boolean(getHudPrefs().strikeRangeGuide), -1),
        onRight: () => cycleHelper(boolOpts, strikeGuideBtns, Boolean(getHudPrefs().strikeRangeGuide), 1),
        onAction: () => cycleHelper(boolOpts, strikeGuideBtns, Boolean(getHudPrefs().strikeRangeGuide), 1),
      },
      {
        el: orientRow,
        onLeft: () => cycleHelper(boolOpts, orientBtns, Boolean(getHudPrefs().orientationCues), -1),
        onRight: () => cycleHelper(boolOpts, orientBtns, Boolean(getHudPrefs().orientationCues), 1),
        onAction: () => cycleHelper(boolOpts, orientBtns, Boolean(getHudPrefs().orientationCues), 1),
      },
      {
        el: cleanRow,
        onLeft: () => {},
        onRight: () => {},
        onAction: () => {
          cleanBtn.click();
          soundManager.playTone(360, 0.05, 'sine', 0.15);
        },
      },
    ],
    // Tab 1: Graphics
    [
      {
        el: gfxRow,
        onLeft: () => cycleHelper(gfxOpts, gfxBtns, getRenderQualitySettings().graphicsPreset, -1),
        onRight: () => cycleHelper(gfxOpts, gfxBtns, getRenderQualitySettings().graphicsPreset, 1),
        onAction: () => cycleHelper(gfxOpts, gfxBtns, getRenderQualitySettings().graphicsPreset, 1),
      },
      {
        el: dprRow,
        onLeft: () => cycleHelper(dprOpts, dprBtns, getRenderQualitySettings().pixelRatioPreset, -1),
        onRight: () => cycleHelper(dprOpts, dprBtns, getRenderQualitySettings().pixelRatioPreset, 1),
        onAction: () => cycleHelper(dprOpts, dprBtns, getRenderQualitySettings().pixelRatioPreset, 1),
      },
      {
        el: shadowRow,
        onLeft: () => cycleHelper(shadowOpts, shadowBtns, getRenderQualitySettings().shadowQuality, -1),
        onRight: () => cycleHelper(shadowOpts, shadowBtns, getRenderQualitySettings().shadowQuality, 1),
        onAction: () => cycleHelper(shadowOpts, shadowBtns, getRenderQualitySettings().shadowQuality, 1),
      },
    ],
    // Tab 2: Audio
    [
      {
        el: masterRow,
        onLeft: () => {
          masterSlider.value = String(Math.max(0, parseInt(masterSlider.value, 10) - 5));
          masterSlider.dispatchEvent(new Event('input'));
          soundManager.playTone(360, 0.04, 'sine', 0.15);
        },
        onRight: () => {
          masterSlider.value = String(Math.min(100, parseInt(masterSlider.value, 10) + 5));
          masterSlider.dispatchEvent(new Event('input'));
          soundManager.playTone(480, 0.04, 'sine', 0.15);
        },
        onAction: () => {},
      },
      {
        el: sfxRow,
        onLeft: () => {
          sfxSlider.value = String(Math.max(0, parseInt(sfxSlider.value, 10) - 5));
          sfxSlider.dispatchEvent(new Event('input'));
          soundManager.playTone(360, 0.04, 'sine', 0.15);
        },
        onRight: () => {
          sfxSlider.value = String(Math.min(100, parseInt(sfxSlider.value, 10) + 5));
          sfxSlider.dispatchEvent(new Event('input'));
          soundManager.playTone(480, 0.04, 'sine', 0.15);
        },
        onAction: () => {},
      },
      {
        el: muteRow,
        onLeft: () => cycleHelper(muteOpts, muteBtns, Boolean(soundManager.isMuted?.()), -1),
        onRight: () => cycleHelper(muteOpts, muteBtns, Boolean(soundManager.isMuted?.()), 1),
        onAction: () => cycleHelper(muteOpts, muteBtns, Boolean(soundManager.isMuted?.()), 1),
      },
    ],
    // Tab 3: Camera & Controls
    [
      {
        el: camRow,
        onLeft: () => {
          const curIdx = CAMERA_OPTIONS.findIndex((o) => o.id === camSelect.value);
          const nextIdx = (curIdx - 1 + CAMERA_OPTIONS.length) % CAMERA_OPTIONS.length;
          camSelect.value = CAMERA_OPTIONS[nextIdx].id;
          camSelect.dispatchEvent(new Event('change'));
          soundManager.playTone(440, 0.05, 'sine', 0.15);
        },
        onRight: () => {
          const curIdx = CAMERA_OPTIONS.findIndex((o) => o.id === camSelect.value);
          const nextIdx = (curIdx + 1) % CAMERA_OPTIONS.length;
          camSelect.value = CAMERA_OPTIONS[nextIdx].id;
          camSelect.dispatchEvent(new Event('change'));
          soundManager.playTone(520, 0.05, 'sine', 0.15);
        },
        onAction: () => {
          const curIdx = CAMERA_OPTIONS.findIndex((o) => o.id === camSelect.value);
          const nextIdx = (curIdx + 1) % CAMERA_OPTIONS.length;
          camSelect.value = CAMERA_OPTIONS[nextIdx].id;
          camSelect.dispatchEvent(new Event('change'));
          soundManager.playTone(520, 0.05, 'sine', 0.15);
        },
      },
      {
        el: shakeRow,
        onLeft: () => cycleHelper(shakeOpts, shakeBtns, getCameraShakeMode(), -1),
        onRight: () => cycleHelper(shakeOpts, shakeBtns, getCameraShakeMode(), 1),
        onAction: () => cycleHelper(shakeOpts, shakeBtns, getCameraShakeMode(), 1),
      },
      {
        el: vibRow,
        onLeft: () => cycleHelper(vibOpts, vibBtns, isVibrationEnabled(), -1),
        onRight: () => cycleHelper(vibOpts, vibBtns, isVibrationEnabled(), 1),
        onAction: () => cycleHelper(vibOpts, vibBtns, isVibrationEnabled(), 1),
      },
      {
        el: tuningRow,
        onLeft: () => cycleHelper(boolOpts, tuningBtns, showTuningGuiState, -1),
        onRight: () => cycleHelper(boolOpts, tuningBtns, showTuningGuiState, 1),
        onAction: () => cycleHelper(boolOpts, tuningBtns, showTuningGuiState, 1),
      },
    ],
  ];

  function getActiveRows() {
    return [tabBarNavRow, ...(tabRowsByIdx[activeTabIdx] || []), closeNavRow];
  }

  function clearAllRowHighlights() {
    tabRowsByIdx.flat().forEach((row) => {
      row.el.style.outline = 'none';
      row.el.style.background = row.el === hudPresetRow ? 'rgba(56, 189, 248, 0.08)' : 'transparent';
      row.el.style.boxShadow = 'none';
    });
    tablistEl.style.outline = 'none';
    closeBtn.style.outline = 'none';
    closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    closeBtn.style.borderColor = 'rgba(255, 255, 255, 0.25)';
    closeBtn.style.boxShadow = 'none';
  }

  function updateSettingsFocusUI() {
    clearAllRowHighlights();
    const rows = getActiveRows();
    if (settingsFocusIndex >= rows.length) settingsFocusIndex = rows.length - 1;
    if (settingsFocusIndex < 0) settingsFocusIndex = 0;

    const row = rows[settingsFocusIndex];
    if (!row) return;
    if (row.isButton) {
      row.el.style.outline = '2px solid #ffffff';
      row.el.style.outlineOffset = '2px';
      row.el.style.background = 'rgba(255, 255, 255, 0.22)';
      row.el.style.borderColor = '#ffffff';
      row.el.style.boxShadow = '0 0 16px rgba(255, 255, 255, 0.45)';
    } else if (row.isTabBar) {
      row.el.style.outline = '2px solid #38bdf8';
      row.el.style.outlineOffset = '3px';
      row.el.style.borderRadius = '6px';
    } else {
      row.el.style.outline = '2px solid #ffffff';
      row.el.style.outlineOffset = '3px';
      row.el.style.background = 'rgba(255, 255, 255, 0.08)';
      row.el.style.borderRadius = '6px';
      row.el.style.boxShadow = '0 0 14px rgba(255, 255, 255, 0.3)';
    }
  }

  function selectTab(idx, keepTabBarFocus = false) {
    const clamped = ((idx % tabDefs.length) + tabDefs.length) % tabDefs.length;
    activeTabIdx = clamped;
    tabBtns.forEach((btn, i) => {
      const sel = i === clamped;
      btn.setAttribute?.('aria-selected', sel ? 'true' : 'false');
      btn.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
    panelEls.forEach((panel, i) => {
      const sel = i === clamped;
      panel.hidden = !sel;
      panel.style.display = sel ? 'block' : 'none';
    });
    settingsFocusIndex = keepTabBarFocus ? 0 : 1;
    soundManager.playTone(460, 0.04, 'sine', 0.14);
    updateSettingsFocusUI();
  }

  mainMenuSettingsModalEl._syncCamera = () => {
    camSelect.value = playerConfigs[0]?.cameraMode || 'chase';
  };
  mainMenuSettingsModalEl._syncHudPrefs = () => {
    syncMainHudButtons(getHudPrefs());
    syncAudioUI();
  };
  mainMenuSettingsModalEl._cycleTab = (delta) => selectTab(activeTabIdx + delta, settingsFocusIndex === 0);
  mainMenuSettingsModalEl._selectTab = (idOrIdx) => {
    const idx = typeof idOrIdx === 'number' ? idOrIdx : tabDefs.findIndex((t) => t.id === idOrIdx);
    if (idx >= 0) selectTab(idx, false);
  };
  mainMenuSettingsModalEl._getActiveTabId = () => tabDefs[activeTabIdx]?.id || 'hud';
  mainMenuSettingsModalEl._moveFocus = (delta) => {
    const rows = getActiveRows();
    settingsFocusIndex = (settingsFocusIndex + delta + rows.length) % rows.length;
    soundManager.playTone(400, 0.04, 'sine', 0.15);
    updateSettingsFocusUI();
  };
  mainMenuSettingsModalEl._handleLeft = () => getActiveRows()[settingsFocusIndex]?.onLeft?.();
  mainMenuSettingsModalEl._handleRight = () => getActiveRows()[settingsFocusIndex]?.onRight?.();
  mainMenuSettingsModalEl._handleAction = () => getActiveRows()[settingsFocusIndex]?.onAction?.();
  mainMenuSettingsModalEl._updateFocusUI = () => {
    settingsFocusIndex = 1;
    updateSettingsFocusUI();
  };

  return mainMenuSettingsModalEl;
}

export function showMainMenuSettingsModal() {
  if (mainMenuSettingsModalEl) {
    mainMenuSettingsModalEl.style.display = 'flex';
    mainMenuSettingsModalEl._syncCamera?.();
    mainMenuSettingsModalEl._syncHudPrefs?.();
    mainMenuSettingsModalEl._updateFocusUI?.();
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
