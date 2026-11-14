/**
 * Module: ui/overtimeMenu
 * Role: Interactive Tied-Match / Overtime Agreement Menu displayed when regulation or timed overtime expires with a tied score.
 * Frame Phase: UI Event / Polling (active while `gameState === 'overtime_menu'`).
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Purely collects player agreement (`format`, `durationSeconds`, `positionMode`) and invokes `onConfirm`;
 *     `matchManager` and `main.js` own the actual simulation state transition.
 */

import { TUNING } from '../config/tuning.js';
import { getColorName } from './mainMenu.js';
import { soundManager } from '../audio/soundManager.js';
import { MENU_PAD, createMenuPadTracker } from '../input/menuPads.js';

let overlayEl = null;
let headerTitleEl = null;
let scoreBannerEl = null;
let formatRowEl = null;
let durationRowEl = null;
let positionRowEl = null;
let confirmBtnEl = null;

let isOpen = false;
let focusRowIdx = 0;
let pollHandle = null;
const padTracker = createMenuPadTracker();

let selectedFormat = 'golden_goal'; // 'golden_goal' | 'timed' | 'draw'
let selectedDuration = 120; // 60 | 120 | 180 | 300
let selectedPosition = 'respawn'; // 'in_place' | 'respawn'

let callbacks = {
  onConfirm: null,
};

const FORMAT_OPTIONS = [
  {
    id: 'golden_goal',
    label: 'GOLDEN GOAL',
    sub: 'Next Goal Wins (Sudden Death)',
  },
  {
    id: 'timed',
    label: 'TIMED OVERTIME',
    sub: 'Play Extra Period',
  },
  {
    id: 'draw',
    label: 'END MATCH AS DRAW',
    sub: 'Final Whistle · Tie Game',
  },
];

const DURATION_OPTIONS = [
  { id: 60, label: '1:00', sub: 'Sprint OT' },
  { id: 120, label: '2:00', sub: 'Standard OT' },
  { id: 180, label: '3:00', sub: 'Extended OT' },
  { id: 300, label: '5:00', sub: 'Full Period' },
];

const POSITION_OPTIONS = [
  {
    id: 'in_place',
    label: 'RESUME LIVE IN PLACE',
    sub: 'Unfreeze athletes & ball immediately where they stand',
  },
  {
    id: 'respawn',
    label: 'RESPAWN AT DEFENDING GOALS',
    sub: 'Reset to stream heads & drop ball at midfield (3s countdown)',
  },
];

let formatBtns = [];
let durationBtns = [];
let positionBtns = [];

/**
 * Initializes the Overtime Agreement Menu DOM overlay.
 *
 * @param {object} [cbs={}]
 * @param {(selection: { format: 'golden_goal'|'timed'|'draw', durationSeconds: number, positionMode: 'in_place'|'respawn' }) => void} [cbs.onConfirm]
 */
export function initOvertimeMenu(cbs = {}) {
  Object.assign(callbacks, cbs);
  if (overlayEl) return;

  overlayEl = document.createElement('div');
  overlayEl.id = 'overtime-menu-overlay';
  overlayEl.className = 'overtime-menu-overlay';
  overlayEl.style.cssText = `
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    background: radial-gradient(circle at center, rgba(10, 15, 29, 0.86) 0%, rgba(4, 7, 15, 0.95) 100%);
    backdrop-filter: blur(10px);
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 620;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: #f8fafc;
    user-select: none;
    padding: 20px;
    box-sizing: border-box;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width: 100%;
    max-width: 720px;
    background: rgba(15, 23, 42, 0.95);
    border: 2px solid rgba(251, 191, 36, 0.55);
    border-radius: 14px;
    padding: 24px 28px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85), 0 0 35px rgba(251, 191, 36, 0.18);
    display: flex;
    flex-direction: column;
    gap: 16px;
  `;

  // Header
  const headerBox = document.createElement('div');
  headerBox.style.cssText = 'text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.12); padding-bottom: 14px;';

  headerTitleEl = document.createElement('div');
  headerTitleEl.id = 'overtime-menu-title';
  headerTitleEl.style.cssText = `
    font-size: 22px;
    font-weight: 900;
    letter-spacing: 0.12em;
    color: #fbbf24;
    text-shadow: 0 0 18px rgba(251, 191, 36, 0.45);
  `;
  headerTitleEl.textContent = 'REGULATION TIED — OVERTIME AGREEMENT';

  scoreBannerEl = document.createElement('div');
  scoreBannerEl.id = 'overtime-menu-score';
  scoreBannerEl.style.cssText = `
    font-size: 16px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #ffffff;
    margin-top: 6px;
  `;
  scoreBannerEl.textContent = 'HOME 0 — 0 AWAY';

  const subHint = document.createElement('div');
  subHint.style.cssText = 'font-size: 11px; color: #94a3b8; margin-top: 6px;';
  subHint.textContent = 'Agree on overtime rules using Mouse, Arrow Keys / WASD, or Gamepad D-Pad';

  headerBox.append(headerTitleEl, scoreBannerEl, subHint);
  card.appendChild(headerBox);

  // Row 0: Format Selector
  formatRowEl = document.createElement('div');
  formatRowEl.id = 'overtime-row-format';
  formatRowEl.style.cssText = 'display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 8px; transition: all 0.15s ease;';

  const formatLabel = document.createElement('div');
  formatLabel.style.cssText = 'font-size: 11px; font-weight: 800; letter-spacing: 0.1em; color: #cbd5e1;';
  formatLabel.textContent = '1. OVERTIME FORMAT';

  const formatGrid = document.createElement('div');
  formatGrid.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;';

  formatBtns = FORMAT_OPTIONS.map((opt) => {
    const btn = document.createElement('button');
    btn.id = `overtime-format-${opt.id}`;
    btn.dataset.formatId = opt.id;
    btn.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1.5px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.05);
      color: #f8fafc;
      font-family: inherit;
      cursor: pointer;
      text-align: left;
      transition: all 0.12s ease;
    `;
    btn.innerHTML = `
      <span style="font-size: 12px; font-weight: 900; letter-spacing: 0.05em;">${opt.label}</span>
      <span style="font-size: 10px; color: #94a3b8; margin-top: 3px; line-height: 1.3;">${opt.sub}</span>
    `;
    btn.onclick = () => {
      selectedFormat = opt.id;
      focusRowIdx = 0;
      soundManager.playTone(480, 0.05, 'sine', 0.18);
      refreshOvertimeMenuUI();
    };
    formatGrid.appendChild(btn);
    return { btn, opt };
  });

  formatRowEl.append(formatLabel, formatGrid);
  card.appendChild(formatRowEl);

  // Row 1: Duration Selector (only active for Timed Overtime)
  durationRowEl = document.createElement('div');
  durationRowEl.id = 'overtime-row-duration';
  durationRowEl.style.cssText = 'display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 8px; transition: all 0.15s ease;';

  const durationLabel = document.createElement('div');
  durationLabel.style.cssText = 'font-size: 11px; font-weight: 800; letter-spacing: 0.1em; color: #cbd5e1;';
  durationLabel.textContent = '2. OVERTIME DURATION';

  const durationGrid = document.createElement('div');
  durationGrid.style.cssText = 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;';

  durationBtns = DURATION_OPTIONS.map((opt) => {
    const btn = document.createElement('button');
    btn.id = `overtime-duration-${opt.id}`;
    btn.dataset.durationSec = String(opt.id);
    btn.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1.5px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.05);
      color: #f8fafc;
      font-family: inherit;
      cursor: pointer;
      text-align: center;
      transition: all 0.12s ease;
    `;
    btn.innerHTML = `
      <span style="font-size: 14px; font-weight: 900;">${opt.label}</span>
      <span style="font-size: 9.5px; color: #94a3b8; margin-top: 2px;">${opt.sub}</span>
    `;
    btn.onclick = () => {
      selectedDuration = opt.id;
      focusRowIdx = getRowOrderIndex(durationRowEl);
      soundManager.playTone(520, 0.05, 'sine', 0.18);
      refreshOvertimeMenuUI();
    };
    durationGrid.appendChild(btn);
    return { btn, opt };
  });

  durationRowEl.append(durationLabel, durationGrid);
  card.appendChild(durationRowEl);

  // Row 2: Position Selector (active for Golden Goal or Timed Overtime)
  positionRowEl = document.createElement('div');
  positionRowEl.id = 'overtime-row-position';
  positionRowEl.style.cssText = 'display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 8px; transition: all 0.15s ease;';

  const positionLabel = document.createElement('div');
  positionLabel.style.cssText = 'font-size: 11px; font-weight: 800; letter-spacing: 0.1em; color: #cbd5e1;';
  positionLabel.textContent = 'KICKOFF / POSITIONING';

  const positionGrid = document.createElement('div');
  positionGrid.style.cssText = 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;';

  positionBtns = POSITION_OPTIONS.map((opt) => {
    const btn = document.createElement('button');
    btn.id = `overtime-position-${opt.id}`;
    btn.dataset.positionMode = opt.id;
    btn.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1.5px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.05);
      color: #f8fafc;
      font-family: inherit;
      cursor: pointer;
      text-align: left;
      transition: all 0.12s ease;
    `;
    btn.innerHTML = `
      <span style="font-size: 12px; font-weight: 900; letter-spacing: 0.04em;">${opt.label}</span>
      <span style="font-size: 10px; color: #94a3b8; margin-top: 3px; line-height: 1.3;">${opt.sub}</span>
    `;
    btn.onclick = () => {
      selectedPosition = opt.id;
      focusRowIdx = getRowOrderIndex(positionRowEl);
      soundManager.playTone(520, 0.05, 'sine', 0.18);
      refreshOvertimeMenuUI();
    };
    positionGrid.appendChild(btn);
    return { btn, opt };
  });

  positionRowEl.append(positionLabel, positionGrid);
  card.appendChild(positionRowEl);

  // Confirm Action Button
  confirmBtnEl = document.createElement('button');
  confirmBtnEl.id = 'overtime-confirm-btn';
  confirmBtnEl.style.cssText = `
    margin-top: 6px;
    padding: 14px 20px;
    border-radius: 10px;
    border: 2px solid #10b981;
    background: #10b981;
    color: #04130d;
    font-family: inherit;
    font-size: 15px;
    font-weight: 900;
    letter-spacing: 0.12em;
    cursor: pointer;
    box-shadow: 0 4px 18px rgba(16, 185, 129, 0.45);
    transition: all 0.15s ease;
  `;
  confirmBtnEl.textContent = 'START OVERTIME ➔';
  confirmBtnEl.onclick = () => {
    confirmOvertimeSelection();
  };
  card.appendChild(confirmBtnEl);

  overlayEl.appendChild(card);
  document.body.appendChild(overlayEl);
}

function getActiveRows() {
  const rows = [
    {
      el: formatRowEl,
      isButton: false,
      onLeft: () => cycleFormat(-1),
      onRight: () => cycleFormat(1),
      onAction: () => cycleFormat(1),
    },
  ];
  if (selectedFormat === 'timed') {
    rows.push({
      el: durationRowEl,
      isButton: false,
      onLeft: () => cycleDuration(-1),
      onRight: () => cycleDuration(1),
      onAction: () => cycleDuration(1),
    });
  }
  if (selectedFormat !== 'draw') {
    rows.push({
      el: positionRowEl,
      isButton: false,
      onLeft: () => cyclePosition(-1),
      onRight: () => cyclePosition(1),
      onAction: () => cyclePosition(1),
    });
  }
  rows.push({
    el: confirmBtnEl,
    isButton: true,
    onLeft: () => {},
    onRight: () => {},
    onAction: () => confirmOvertimeSelection(),
  });
  return rows;
}

function getRowOrderIndex(targetEl) {
  const rows = getActiveRows();
  const idx = rows.findIndex((r) => r.el === targetEl);
  return idx >= 0 ? idx : 0;
}

function cycleFormat(dir = 1) {
  const curIdx = FORMAT_OPTIONS.findIndex((o) => o.id === selectedFormat);
  const nextIdx = (curIdx + dir + FORMAT_OPTIONS.length) % FORMAT_OPTIONS.length;
  selectedFormat = FORMAT_OPTIONS[nextIdx].id;
  soundManager.playTone(480, 0.05, 'sine', 0.18);
  refreshOvertimeMenuUI();
}

function cycleDuration(dir = 1) {
  const curIdx = DURATION_OPTIONS.findIndex((o) => o.id === selectedDuration);
  const nextIdx = (curIdx + dir + DURATION_OPTIONS.length) % DURATION_OPTIONS.length;
  selectedDuration = DURATION_OPTIONS[nextIdx].id;
  soundManager.playTone(520, 0.05, 'sine', 0.18);
  refreshOvertimeMenuUI();
}

function cyclePosition(dir = 1) {
  const curIdx = POSITION_OPTIONS.findIndex((o) => o.id === selectedPosition);
  const nextIdx = (curIdx + dir + POSITION_OPTIONS.length) % POSITION_OPTIONS.length;
  selectedPosition = POSITION_OPTIONS[nextIdx].id;
  soundManager.playTone(520, 0.05, 'sine', 0.18);
  refreshOvertimeMenuUI();
}

function confirmOvertimeSelection() {
  if (!isOpen) return;
  soundManager.playTone(740, 0.12, 'sine', 0.3);
  const payload = {
    format: selectedFormat,
    durationSeconds: selectedDuration,
    positionMode: selectedPosition,
  };
  hideOvertimeMenu();
  if (callbacks.onConfirm) {
    callbacks.onConfirm(payload);
  }
}

function refreshOvertimeMenuUI() {
  if (!overlayEl) return;

  // Toggle row visibility based on selected format
  if (durationRowEl) {
    durationRowEl.style.display = selectedFormat === 'timed' ? 'flex' : 'none';
  }
  if (positionRowEl) {
    positionRowEl.style.display = selectedFormat !== 'draw' ? 'flex' : 'none';
  }

  // Highlight selected option cards
  formatBtns.forEach(({ btn, opt }) => {
    const sel = opt.id === selectedFormat;
    btn.style.background = sel ? 'rgba(251, 191, 36, 0.18)' : 'rgba(255, 255, 255, 0.05)';
    btn.style.borderColor = sel ? '#fbbf24' : 'rgba(255, 255, 255, 0.16)';
    btn.style.boxShadow = sel ? '0 0 14px rgba(251, 191, 36, 0.35)' : 'none';
  });

  durationBtns.forEach(({ btn, opt }) => {
    const sel = opt.id === selectedDuration;
    btn.style.background = sel ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.05)';
    btn.style.borderColor = sel ? '#38bdf8' : 'rgba(255, 255, 255, 0.16)';
    btn.style.boxShadow = sel ? '0 0 14px rgba(56, 189, 248, 0.35)' : 'none';
  });

  positionBtns.forEach(({ btn, opt }) => {
    const sel = opt.id === selectedPosition;
    btn.style.background = sel ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)';
    btn.style.borderColor = sel ? '#10b981' : 'rgba(255, 255, 255, 0.16)';
    btn.style.boxShadow = sel ? '0 0 14px rgba(16, 185, 129, 0.35)' : 'none';
  });

  if (confirmBtnEl) {
    if (selectedFormat === 'draw') {
      confirmBtnEl.textContent = 'FINISH MATCH AS DRAW ➔';
      confirmBtnEl.style.background = '#f59e0b';
      confirmBtnEl.style.borderColor = '#fbbf24';
    } else if (selectedFormat === 'golden_goal') {
      confirmBtnEl.textContent = 'START GOLDEN GOAL OVERTIME ➔';
      confirmBtnEl.style.background = '#10b981';
      confirmBtnEl.style.borderColor = '#34d399';
    } else {
      const mins = Math.floor(selectedDuration / 60);
      const secs = String(selectedDuration % 60).padStart(2, '0');
      confirmBtnEl.textContent = `START ${mins}:${secs} OVERTIME ➔`;
      confirmBtnEl.style.background = '#10b981';
      confirmBtnEl.style.borderColor = '#34d399';
    }
  }

  // Row focus styling
  const rows = getActiveRows();
  if (focusRowIdx >= rows.length) focusRowIdx = rows.length - 1;
  if (focusRowIdx < 0) focusRowIdx = 0;

  rows.forEach((row, idx) => {
    const isFocused = idx === focusRowIdx;
    if (row.isButton) {
      row.el.style.outline = isFocused ? '2.5px solid #ffffff' : 'none';
      row.el.style.outlineOffset = isFocused ? '3px' : '0px';
      row.el.style.transform = isFocused ? 'scale(1.02)' : 'scale(1)';
    } else {
      row.el.style.outline = isFocused ? '2px solid rgba(255, 255, 255, 0.85)' : 'none';
      row.el.style.background = isFocused ? 'rgba(255, 255, 255, 0.06)' : 'transparent';
    }
  });
}

function startOvertimeMenuPolling() {
  stopOvertimeMenuPolling();

  const onKeyDown = (e) => {
    if (!isOpen) return;
    const rows = getActiveRows();
    if (rows.length === 0) return;

    if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      focusRowIdx = (focusRowIdx - 1 + rows.length) % rows.length;
      soundManager.playTone(400, 0.04, 'sine', 0.15);
      refreshOvertimeMenuUI();
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault();
      focusRowIdx = (focusRowIdx + 1) % rows.length;
      soundManager.playTone(400, 0.04, 'sine', 0.15);
      refreshOvertimeMenuUI();
    } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      e.preventDefault();
      rows[focusRowIdx]?.onLeft?.();
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      e.preventDefault();
      rows[focusRowIdx]?.onRight?.();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      rows[focusRowIdx]?.onAction?.();
    }
  };

  window.addEventListener('keydown', onKeyDown);
  padTracker.reset();

  pollHandle = setInterval(() => {
    if (!isOpen || !overlayEl || overlayEl.style.display !== 'flex') {
      stopOvertimeMenuPolling();
      return;
    }
    if (typeof navigator.getGamepads !== 'function') return;
    const raw = navigator.getGamepads();
    const pads = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] && raw[i].connected) pads.push(raw[i]);
    }
    padTracker.update(pads);
    const rows = getActiveRows();
    if (rows.length === 0) return;

    for (const pad of pads) {
      if (!pad) continue;
      const e = padTracker.pressed(pad);
      if (e & MENU_PAD.up) {
        focusRowIdx = (focusRowIdx - 1 + rows.length) % rows.length;
        soundManager.playTone(400, 0.04, 'sine', 0.15);
        refreshOvertimeMenuUI();
      }
      if (e & MENU_PAD.down) {
        focusRowIdx = (focusRowIdx + 1) % rows.length;
        soundManager.playTone(400, 0.04, 'sine', 0.15);
        refreshOvertimeMenuUI();
      }
      if (e & MENU_PAD.left) {
        rows[focusRowIdx]?.onLeft?.();
      }
      if (e & MENU_PAD.right) {
        rows[focusRowIdx]?.onRight?.();
      }
      if (e & MENU_PAD.a) {
        rows[focusRowIdx]?.onAction?.();
        if (!isOpen) return;
      }
      if (e & MENU_PAD.start) {
        confirmOvertimeSelection();
        return;
      }
    }
  }, 50);

  window._cleanupOvertimeMenuListeners = () => {
    window.removeEventListener('keydown', onKeyDown);
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  };
}

function stopOvertimeMenuPolling() {
  if (window._cleanupOvertimeMenuListeners) {
    window._cleanupOvertimeMenuListeners();
    window._cleanupOvertimeMenuListeners = null;
  }
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

/**
 * Displays the Overtime Agreement Menu with current score and overtime period count.
 *
 * @param {object} [options={}]
 * @param {number} [options.scoreHome=0]
 * @param {number} [options.scoreAway=0]
 * @param {number} [options.overtimePeriod=0]
 */
export function showOvertimeMenu({ scoreHome = 0, scoreAway = 0, overtimePeriod = 0 } = {}) {
  if (!overlayEl) initOvertimeMenu(callbacks);
  isOpen = true;

  const homeColor = TUNING.athlete?.palette?.homePrimary ?? 0xd90429;
  const awayColor = TUNING.athlete?.palette?.awayPrimary ?? 0x1d4ed8;
  const homeName = getColorName(homeColor).toUpperCase();
  const awayName = getColorName(awayColor).toUpperCase();

  if (headerTitleEl) {
    headerTitleEl.textContent = overtimePeriod > 0
      ? `OVERTIME ${overtimePeriod} TIED — OVERTIME AGREEMENT`
      : 'REGULATION TIED — OVERTIME AGREEMENT';
  }
  if (scoreBannerEl) {
    scoreBannerEl.textContent = `TEAM 1 (${homeName}) ${scoreHome} — ${scoreAway} TEAM 2 (${awayName})`;
  }

  overlayEl.style.display = 'flex';
  // Focus primary Start Overtime button or first row so user can immediately press Enter/Start or adjust
  const rows = getActiveRows();
  focusRowIdx = rows.length - 1;
  refreshOvertimeMenuUI();
  startOvertimeMenuPolling();
}

/**
 * Hides the Overtime Agreement Menu and stops input polling.
 */
export function hideOvertimeMenu() {
  if (!overlayEl) return;
  isOpen = false;
  stopOvertimeMenuPolling();
  overlayEl.style.display = 'none';
}

/**
 * Returns whether the Overtime Agreement Menu is currently open.
 *
 * @returns {boolean}
 */
export function isOvertimeMenuOpen() {
  return isOpen;
}
