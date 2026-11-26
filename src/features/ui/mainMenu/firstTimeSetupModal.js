/**
 * Module: features/ui/mainMenu/firstTimeSetupModal
 * Role: 3-card First-Time Setup and Sport Primer modal shown once on initial launch:
 *   Card 1: Sport Primer ("Valleyball is a physical sport, not an arcade game" + 3 rules)
 *   Card 2: Graphics Quality (Low / Balanced / High)
 *   Card 3: HUD Guidance (Rookie / Standard / Minimal) + Main Menu Settings note
 * Frame Phase: UI Event / Boot Transition
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Routes all graphics and HUD writes through `config/hudConfig.js`.
 *   - LAW 6 (Determinism): Auto-skipped during deterministic capture, fixture, and trace runs.
 */

import {
  getHudPrefs,
  applyHudPreset,
  getActiveHudPresetId,
  setRenderQualitySettings,
  markFirstTimeSetupCompleted,
} from '../../../config/hudConfig.js';
import { soundManager } from '../../../audio/soundManager.js';

let modalEl = null;
let currentStep = 0;
let focusedOptionIdx = 0;

const GRAPHICS_CARDS = [
  {
    id: 'low',
    title: 'LOW (FAST)',
    badge: 'LAPTOP / INTEGRATED GPU',
    desc: '1.0x resolution scale with stadium shadows off for maximum frame rate on lighter hardware.',
  },
  {
    id: 'balanced',
    title: 'BALANCED',
    badge: 'RECOMMENDED',
    desc: '1.25x resolution scale with 1-tower stadium shadows for crisp 60+ FPS court clarity.',
  },
  {
    id: 'high',
    title: 'HIGH',
    badge: 'DESKTOP GPU',
    desc: 'Native resolution with full 4-tower stadium shadows and broadcast lighting.',
  },
];

const HUD_CARDS = [
  {
    id: 'rookie',
    title: 'ROOKIE / LIVE ROOM',
    badge: 'FIRST PLAY',
    desc: 'Always-on scorebug, rainbow ball halo, strike-range ring, orientation cues, and live controls bar.',
  },
  {
    id: 'standard',
    title: 'STANDARD',
    badge: 'DEFAULT',
    desc: 'Split-screen scorebug, rainbow ball halo, and orientation cues with an unobstructed court view.',
  },
  {
    id: 'minimal',
    title: 'MINIMAL / CLEAN BROADCAST',
    badge: 'PURE SIGHTLINES',
    desc: 'All optional rings and overlays turned off for experienced athletes and clean broadcast capture.',
  },
];

export function buildFirstTimeSetupModal(rootEl, callbacks = {}) {
  if (modalEl) return modalEl;

  modalEl = document.createElement('div');
  modalEl.id = 'first-time-setup-modal';
  modalEl.style.cssText = `
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(4, 7, 14, 0.90);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    pointer-events: auto;
    z-index: 1050;
    padding: 18px;
    box-sizing: border-box;
    color: #e2e8f0;
  `;

  const card = document.createElement('div');
  card.id = 'first-time-setup-card';
  card.style.cssText = `
    display: flex;
    flex-direction: column;
    width: min(680px, 95vw);
    background: rgba(11, 17, 28, 0.98);
    border: 1.5px solid rgba(56, 189, 248, 0.42);
    border-radius: 14px;
    padding: 24px 28px 22px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.92), 0 0 32px rgba(0, 229, 255, 0.14);
    box-sizing: border-box;
    overflow: hidden;
  `;

  const topBar = document.createElement('div');
  topBar.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 12px;
    margin-bottom: 16px;
    border-bottom: 2px solid;
    border-image: linear-gradient(90deg, #FF2A42 0%, #FF6B00 14.3%, #FFD000 28.6%, #10E56A 42.9%, #00E5FF 57.2%, #1F65FF 71.5%, #6B11FF 85.8%, #E000B8 100%) 1;
  `;

  const brandGroup = document.createElement('div');
  brandGroup.innerHTML = `
    <div style="display: flex; align-items: baseline; gap: 8px;">
      <span style="font-family: 'Syncopate', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: 0.08em; background: linear-gradient(90deg, #FF2A42 0%, #FF6B00 14.3%, #FFD000 28.6%, #10E56A 42.9%, #00E5FF 57.2%, #1F65FF 71.5%, #6B11FF 85.8%, #E000B8 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;">VALLEYBALL</span>
      <span style="font-family: 'Syncopate', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.24em; color: #F5F5F7;">VERSUS</span>
    </div>
  `;

  const stepBadge = document.createElement('span');
  stepBadge.id = 'first-setup-step-badge';
  stepBadge.style.cssText = `
    font-size: 10.5px;
    font-weight: 900;
    letter-spacing: 0.12em;
    padding: 4px 10px;
    border-radius: 999px;
    color: #38bdf8;
    background: rgba(56, 189, 248, 0.12);
    border: 1px solid rgba(56, 189, 248, 0.4);
  `;

  topBar.append(brandGroup, stepBadge);
  card.appendChild(topBar);

  const bodyEl = document.createElement('div');
  bodyEl.id = 'first-setup-body';
  bodyEl.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';
  card.appendChild(bodyEl);

  const footerNoteEl = document.createElement('div');
  footerNoteEl.id = 'first-setup-footer-note';
  footerNoteEl.style.cssText = `
    margin-top: 14px;
    font-size: 11.5px;
    font-weight: 700;
    color: #94a3b8;
    text-align: center;
    min-height: 16px;
  `;
  card.appendChild(footerNoteEl);

  const navRow = document.createElement('div');
  navRow.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  `;

  const backBtn = document.createElement('button');
  backBtn.id = 'btn-first-setup-back';
  backBtn.type = 'button';
  backBtn.textContent = '◀ BACK';
  backBtn.style.cssText = `
    padding: 10px 18px;
    font-size: 12px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    color: #cbd5e1;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 7px;
    cursor: pointer;
  `;

  const hintEl = document.createElement('span');
  hintEl.style.cssText = 'font-size: 10.5px; font-weight: 700; color: #64748b; letter-spacing: 0.06em;';
  hintEl.textContent = '↕ / ◀ ▶ SELECT · ENTER / A CONTINUE';

  const nextBtn = document.createElement('button');
  nextBtn.id = 'btn-first-setup-next';
  nextBtn.type = 'button';
  nextBtn.style.cssText = `
    padding: 11px 22px;
    font-size: 12.5px;
    font-weight: 900;
    font-family: inherit;
    letter-spacing: 0.1em;
    color: #04130d;
    background: #00e5ff;
    border: 2px solid #ffffff;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 0 18px rgba(0, 229, 255, 0.45);
  `;

  navRow.append(backBtn, hintEl, nextBtn);
  card.appendChild(navRow);
  modalEl.appendChild(card);
  if (rootEl) rootEl.appendChild(modalEl);

  function applyGraphicsChoice(presetId) {
    const updated = setRenderQualitySettings({ graphicsPreset: presetId });
    if (callbacks.onRenderSettingsChange) callbacks.onRenderSettingsChange(updated);
    else if (typeof window !== 'undefined' && window.__vb?.applyRenderSettings) window.__vb.applyRenderSettings(updated);
  }

  function applyHudChoice(presetId) {
    applyHudPreset(presetId);
    const showControlsOverlay = Boolean(getHudPrefs().controlsOverlay);
    if (callbacks.onRenderSettingsChange) callbacks.onRenderSettingsChange({ showControlsOverlay });
    else if (typeof window !== 'undefined' && window.__vb?.applyRenderSettings) window.__vb.applyRenderSettings({ showControlsOverlay });
  }

  function finishSetup() {
    markFirstTimeSetupCompleted();
    soundManager.playTone(720, 0.1, 'sine', 0.22);
    hideFirstTimeSetupModal();
    callbacks.onComplete?.();
  }

  function goNext() {
    if (currentStep < 2) {
      currentStep += 1;
      syncDefaultOptionFocus();
      soundManager.playTone(540, 0.05, 'sine', 0.18);
      renderStep();
    } else {
      finishSetup();
    }
  }

  function goBack() {
    if (currentStep > 0) {
      currentStep -= 1;
      syncDefaultOptionFocus();
      soundManager.playTone(380, 0.05, 'sine', 0.16);
      renderStep();
    }
  }

  function syncDefaultOptionFocus() {
    if (currentStep === 1) {
      const g = getHudPrefs().graphicsPreset || 'balanced';
      const idx = GRAPHICS_CARDS.findIndex((c) => c.id === g);
      focusedOptionIdx = idx >= 0 ? idx : 1;
    } else if (currentStep === 2) {
      const h = getActiveHudPresetId();
      const idx = HUD_CARDS.findIndex((c) => c.id === h);
      focusedOptionIdx = idx >= 0 ? idx : 1;
    } else {
      focusedOptionIdx = 0;
    }
  }

  function selectOptionByOffset(delta) {
    if (currentStep === 1) {
      focusedOptionIdx = (focusedOptionIdx + delta + GRAPHICS_CARDS.length) % GRAPHICS_CARDS.length;
      applyGraphicsChoice(GRAPHICS_CARDS[focusedOptionIdx].id);
      soundManager.playTone(480, 0.04, 'sine', 0.16);
      renderStep();
    } else if (currentStep === 2) {
      focusedOptionIdx = (focusedOptionIdx + delta + HUD_CARDS.length) % HUD_CARDS.length;
      applyHudChoice(HUD_CARDS[focusedOptionIdx].id);
      soundManager.playTone(480, 0.04, 'sine', 0.16);
      renderStep();
    }
  }

  function renderChoiceCards(items, activeId, onPick, prefix) {
    const list = document.createElement('div');
    list.style.cssText = 'display: flex; flex-direction: column; gap: 9px;';
    items.forEach((item, idx) => {
      const isSelected = item.id === activeId;
      const isFocused = idx === focusedOptionIdx;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = `btn-first-setup-${prefix}-${item.id}`;
      btn.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
        width: 100%;
        padding: 11px 14px;
        text-align: left;
        font-family: inherit;
        border-radius: 9px;
        cursor: pointer;
        background: ${isSelected ? 'rgba(37, 99, 235, 0.24)' : 'rgba(255, 255, 255, 0.04)'};
        border: 1.5px solid ${isSelected ? '#38bdf8' : 'rgba(148, 163, 184, 0.25)'};
        outline: ${isFocused ? '2px solid #ffffff' : 'none'};
        outline-offset: 2px;
        box-shadow: ${isSelected ? '0 0 16px rgba(56, 189, 248, 0.22)' : 'none'};
      `;
      btn.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 8px;">
          <span style="font-size: 13px; font-weight: 900; letter-spacing: 0.06em; color: #ffffff;">${isSelected ? '● ' : '○ '}${item.title}</span>
          <span style="font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em; padding: 2px 7px; border-radius: 999px; color: ${isSelected ? '#04130d' : '#94a3b8'}; background: ${isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.08)'};">${item.badge}</span>
        </div>
        <span style="font-size: 11.5px; color: #cbd5e1; line-height: 1.38;">${item.desc}</span>
      `;
      btn.onclick = () => {
        focusedOptionIdx = idx;
        onPick(item.id);
        soundManager.playTone(500, 0.04, 'sine', 0.16);
        renderStep();
      };
      list.appendChild(btn);
    });
    return list;
  }

  function renderStep() {
    stepBadge.textContent = `STEP ${currentStep + 1} OF 3`;
    backBtn.style.visibility = currentStep === 0 ? 'hidden' : 'visible';
    bodyEl.innerHTML = '';

    if (currentStep === 0) {
      const intro = document.createElement('div');
      intro.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';
      intro.innerHTML = `
        <div>
          <div style="font-size: 19px; font-weight: 900; letter-spacing: 0.05em; color: #ffffff;">VALLEYBALL IS A SPORT, NOT A GAME.</div>
          <div style="font-size: 12.5px; color: #94a3b8; margin-top: 4px; line-height: 1.45;">
            Played inside a sunken sloped bowl with real physics, active ragdoll momentum, and zero artificial ball magnetism.
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
          <div style="padding: 12px; border-radius: 9px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(56, 189, 248, 0.25);">
            <div style="font-size: 11px; font-weight: 900; color: #38bdf8; letter-spacing: 0.08em; margin-bottom: 5px;">1. ALWAYS LIVE</div>
            <div style="font-size: 11px; color: #cbd5e1; line-height: 1.42;">Perimeter glass and banked valley walls keep every rebound in play. No out-of-bounds and no referee whistles.</div>
          </div>
          <div style="padding: 12px; border-radius: 9px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(16, 185, 129, 0.28);">
            <div style="font-size: 11px; font-weight: 900; color: #34d399; letter-spacing: 0.08em; margin-bottom: 5px;">2. BODY &amp; ANGLE</div>
            <div style="font-size: 11px; color: #cbd5e1; line-height: 1.42;">Positioning governs shot direction. Carve the slopes, plant a Cut to redirect, and meet the ball cleanly.</div>
          </div>
          <div style="padding: 12px; border-radius: 9px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(251, 191, 36, 0.30);">
            <div style="font-size: 11px; font-weight: 900; color: #fbbf24; letter-spacing: 0.08em; margin-bottom: 5px;">3. INSTANT FLIP</div>
            <div style="font-size: 11px; color: #cbd5e1; line-height: 1.42;">Score through the elevated 10m hoop and play continues nonstop: target goals invert immediately on every point.</div>
          </div>
        </div>
      `;
      bodyEl.appendChild(intro);
      footerNoteEl.textContent = 'Take two quick steps to choose your graphics and on-court guidance.';
      nextBtn.textContent = 'CHOOSE GRAPHICS ➔';
      nextBtn.style.background = '#00e5ff';
    } else if (currentStep === 1) {
      const heading = document.createElement('div');
      heading.innerHTML = `
        <div style="font-size: 17px; font-weight: 900; letter-spacing: 0.06em; color: #ffffff;">CHOOSE GRAPHICS QUALITY</div>
        <div style="font-size: 11.5px; color: #94a3b8; margin-top: 2px;">Select the preset that best matches your display and GPU.</div>
      `;
      bodyEl.appendChild(heading);
      const curGfx = getHudPrefs().graphicsPreset || 'balanced';
      bodyEl.appendChild(renderChoiceCards(GRAPHICS_CARDS, curGfx, applyGraphicsChoice, 'gfx'));
      footerNoteEl.textContent = 'These settings can be altered in the Main Menu Settings at any time.';
      nextBtn.textContent = 'CHOOSE HUD GUIDANCE ➔';
      nextBtn.style.background = '#00e5ff';
    } else {
      const heading = document.createElement('div');
      heading.innerHTML = `
        <div style="font-size: 17px; font-weight: 900; letter-spacing: 0.06em; color: #ffffff;">CHOOSE ON-COURT HUD GUIDANCE</div>
        <div style="font-size: 11.5px; color: #94a3b8; margin-top: 2px;">Pick how many visual court rings and control cues appear during play.</div>
      `;
      bodyEl.appendChild(heading);
      const curHud = getActiveHudPresetId();
      bodyEl.appendChild(renderChoiceCards(HUD_CARDS, curHud === 'custom' ? 'standard' : curHud, applyHudChoice, 'hud'));
      footerNoteEl.textContent = 'These settings can be altered in the Main Menu Settings at any time.';
      nextBtn.textContent = 'ENTER THE ARENA ➔';
      nextBtn.style.background = '#10b981';
    }
  }

  backBtn.onclick = goBack;
  nextBtn.onclick = goNext;

  modalEl._moveFocus = (delta) => selectOptionByOffset(delta);
  modalEl._handleLeft = () => {
    if (currentStep === 0) return;
    selectOptionByOffset(-1);
  };
  modalEl._handleRight = () => {
    if (currentStep === 0) return;
    selectOptionByOffset(1);
  };
  modalEl._handleAction = () => goNext();
  modalEl._handleBack = () => {
    if (currentStep > 0) goBack();
  };
  modalEl._resetAndRender = () => {
    currentStep = 0;
    focusedOptionIdx = 0;
    renderStep();
  };

  renderStep();
  return modalEl;
}

export function showFirstTimeSetupModal() {
  if (!modalEl) return;
  modalEl.style.display = 'flex';
  modalEl._resetAndRender?.();
}

export function hideFirstTimeSetupModal() {
  if (!modalEl) return;
  modalEl.style.display = 'none';
}

export function isFirstTimeSetupOpen() {
  return Boolean(modalEl && modalEl.style.display === 'flex');
}

export function getFirstTimeSetupModalEl() {
  return modalEl;
}
