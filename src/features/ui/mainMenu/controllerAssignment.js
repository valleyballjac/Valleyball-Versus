/**
 * Module: features/ui/mainMenu/controllerAssignment
 * Role: Interactive Controller Assignment screen for 1v1 and 2v2 matches (routing gamepads & keyboard keysets to Team 1 / Team 2 / Bench).
 * Frame Phase: UI Event / Polling
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Syncs slot device mappings to `inputRouter` (`setExplicitDeviceMappings`) and slot types/teams
 *     to the shared 4-slot `state.playerConfigs` array without truncating it.
 */

import { soundManager } from '../../../audio/soundManager.js';
import { state } from './state.js';
import {
  getExplicitDeviceMappings,
  setExplicitDeviceMappings,
  isPadFightingMode,
  togglePadFightingMode,
} from '../../../input/inputRouter.js';
import { MENU_PAD } from '../../../input/menuPads.js';
import {
  getPlayerSlotTheme,
  detectGamepadProfile,
  renderCardinalDiamondSvg,
  renderViewportBadgeHtml,
} from './constants.js';

let containerEl = null;
let colTeam1El = null;
let colTeam2El = null;
let currentMode = '1v1'; // '1v1' or '2v2'
let onProceedCallback = null;
let onQuickStartCallback = null;
let onBackCallback = null;
let liveCalloutEl = null;
let calloutClearTimer = null;

function getSlotKitColor(slotIdx) {
  const fallback = (slotIdx === 0 || slotIdx === 2) ? 0xd90429 : 0x1d4ed8;
  return state.playerConfigs?.[slotIdx]?.primaryColor ?? fallback;
}

// Slots structure:
// team1: [deviceSlot0, deviceSlot2]
// team2: [deviceSlot1, deviceSlot3]
// bench: [device, ...]
const assignmentState = {
  team1: [null, null], // [P1, P3]
  team2: [null, null], // [P2, P4]
  bench: [],
};

function getCleanGamepadName(pad) {
  if (!pad) return 'Gamepad';
  const profile = detectGamepadProfile(pad);
  if (profile.brand === 'xbox') return `Xbox Controller (Pad ${pad.index + 1})`;
  if (profile.brand === 'playstation') return `PlayStation Controller (Pad ${pad.index + 1})`;
  if (profile.brand === 'switch') return `Switch Controller (Pad ${pad.index + 1})`;
  if (profile.brand === 'fightpad') return `Fighting Pad / Stick (Pad ${pad.index + 1})`;
  return `Gamepad ${pad.index + 1}`;
}

export function buildControllerAssignmentScreen(rootEl, callbacks = {}) {
  onProceedCallback = callbacks.onProceed || null;
  onQuickStartCallback = callbacks.onQuickStart || null;
  onBackCallback = callbacks.onBack || null;

  containerEl = document.createElement('div');
  containerEl.id = 'controller-assignment-screen';
  containerEl.style.cssText = `
    position: absolute;
    inset: 0;
    display: none;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    padding: 14px 24px 14px 24px;
    background: linear-gradient(180deg, rgba(3, 6, 12, 0.0) 0%, rgba(3, 6, 12, 0.14) 48%, rgba(3, 6, 12, 0.85) 100%);
    z-index: 550;
    font-family: inherit;
    user-select: none;
    box-sizing: border-box;
    gap: 10px;
  `;

  // --- LIVE "WHO AM I?" CONTROLLER IDENTITY CALLOUT BANNER ---
  liveCalloutEl = document.createElement('div');
  liveCalloutEl.id = 'assignment-live-callout';
  liveCalloutEl.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 100%;
    max-width: 1420px;
    padding: 9px 18px;
    border-radius: 10px;
    background: rgba(11, 17, 26, 0.90);
    border: 1.5px solid rgba(0, 229, 255, 0.42);
    color: #e2e8f0;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.05em;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    box-sizing: border-box;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  `;
  liveCalloutEl.innerHTML = '<span>PRESS A OR ANY BUTTON ON A PLUGGED-IN CONTROLLER TO JOIN</span>';
  containerEl.appendChild(liveCalloutEl);

  // --- HEADER SECTION (mounted inside the Bottom Command Dock so the center stays open) ---
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-width: 0;
  `;

  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';

  const title = document.createElement('h2');
  title.textContent = 'PICK SIDES & CONTROLLERS';
  title.style.cssText = `
    margin: 0;
    font-size: 16px;
    font-weight: 900;
    letter-spacing: 0.1em;
    color: #ffffff;
    text-transform: uppercase;
  `;

  const modeBadge = document.createElement('button');
  modeBadge.id = 'assignment-mode-badge';
  modeBadge.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 5px;
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #000000;
    background: linear-gradient(90deg, #00e5ff, #38bdf8);
    border: none;
    cursor: pointer;
    box-shadow: 0 0 12px rgba(0, 229, 255, 0.45);
    transition: transform 0.15s ease;
  `;
  modeBadge.innerHTML = `<span>MODE: 1v1 VERSUS</span><span class="contextual-btn-badge" style="background:#000;color:#fff;font-size:9px;">1v1 ACTIVE</span>`;
  modeBadge.onclick = () => {
    toggleMode();
  };

  titleRow.appendChild(title);
  titleRow.appendChild(modeBadge);

  const subtitle = document.createElement('div');
  subtitle.id = 'assignment-subtitle';
  subtitle.style.cssText = 'font-size: 11px; font-weight: 700; color: #cbd5e1; letter-spacing: 0.02em;';
  subtitle.innerHTML = '<b>◀ ▶</b> Home / Bench / Away &middot; <b style="color:#4ade80;">✕/A □/X △/Y START</b> Join from Bench &middot; <b style="color:#ff2e55;">○/B</b> Leave Seat &middot; <b style="color:#c084fc;">S/TAB</b> Swap Sides &middot; <b style="color:#00e5ff;">Host ✕/A</b> Customize &middot; <b style="color:#4ade80;">Host START</b> Quick Play';

  header.appendChild(titleRow);
  header.appendChild(subtitle);

  // --- 3-COLUMN ARENA GRID (Lower-Third Deck) ---
  const arenaGrid = document.createElement('div');
  arenaGrid.id = 'assignment-arena-grid';
  arenaGrid.style.cssText = `
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 16px;
    width: 100%;
    max-width: 1420px;
    margin: 0;
    flex: 0 1 auto;
    min-height: 0;
  `;

  // Column 1: Team 1 (Home - South Court)
  const t1Theme = getPlayerSlotTheme(0, getSlotKitColor(0));
  const colTeam1 = document.createElement('div');
  colTeam1.id = 'col-team1';
  colTeam1El = colTeam1;
  colTeam1.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(11, 17, 26, 0.86);
    border: 1.5px solid ${t1Theme.border};
    border-top: 4px solid ${t1Theme.hex};
    border-radius: 10px;
    padding: 12px 14px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.65), inset 0 0 16px ${t1Theme.bg};
  `;
  colTeam1.innerHTML = `
    <div id="col-team1-header" style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ${t1Theme.bgStrong};padding-bottom:6px;">
      <div style="display:flex;flex-direction:column;gap:1px;">
        <span id="col-team1-title" style="font-size:13px;font-weight:900;letter-spacing:0.12em;color:${t1Theme.hex};">HOME (SOUTH) · TEAM 1</span>
        <span style="font-size:9px;font-weight:800;letter-spacing:0.06em;color:#94a3b8;">DEFENDS SOUTH · ATTACKS NORTH</span>
      </div>
      <span id="col-team1-join-badge" class="contextual-btn-badge" style="border-color:${t1Theme.hex};color:${t1Theme.hex};">◀ JOIN HOME</span>
    </div>
    <div id="team1-slots-container" style="display:flex;flex-direction:column;gap:8px;flex:1;"></div>
  `;

  // Column 2: Bench (Available Devices)
  const colBench = document.createElement('div');
  colBench.id = 'col-bench';
  colBench.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(11, 17, 26, 0.82);
    border: 1px dashed rgba(255, 255, 255, 0.25);
    border-radius: 10px;
    padding: 12px 14px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.65);
  `;
  colBench.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.12);padding-bottom:6px;">
      <span style="font-size:13px;font-weight:900;letter-spacing:0.12em;color:#ffffff;">BENCH · UNASSIGNED</span>
      <span style="font-size:10px;font-weight:700;color:#94a3b8;">PRESS A / ANY BUTTON TO JOIN · TILT ◀ ▶</span>
    </div>
    <div id="bench-slots-container" style="display:flex;flex-direction:column;gap:8px;flex:1;overflow:visible;"></div>
  `;

  // Column 3: Team 2 (Away - North Court)
  const t2Theme = getPlayerSlotTheme(1, getSlotKitColor(1));
  const colTeam2 = document.createElement('div');
  colTeam2.id = 'col-team2';
  colTeam2El = colTeam2;
  colTeam2.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(11, 17, 26, 0.86);
    border: 1.5px solid ${t2Theme.border};
    border-top: 4px solid ${t2Theme.hex};
    border-radius: 10px;
    padding: 12px 14px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.65), inset 0 0 16px ${t2Theme.bg};
  `;
  colTeam2.innerHTML = `
    <div id="col-team2-header" style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ${t2Theme.bgStrong};padding-bottom:6px;">
      <div style="display:flex;flex-direction:column;gap:1px;">
        <span id="col-team2-title" style="font-size:13px;font-weight:900;letter-spacing:0.12em;color:${t2Theme.hex};">AWAY (NORTH) · TEAM 2</span>
        <span style="font-size:9px;font-weight:800;letter-spacing:0.06em;color:#94a3b8;">DEFENDS NORTH · ATTACKS SOUTH</span>
      </div>
      <span id="col-team2-join-badge" class="contextual-btn-badge" style="border-color:${t2Theme.hex};color:${t2Theme.hex};">JOIN AWAY ▶</span>
    </div>
    <div id="team2-slots-container" style="display:flex;flex-direction:column;gap:8px;flex:1;"></div>
  `;

  arenaGrid.appendChild(colTeam1);
  arenaGrid.appendChild(colBench);
  arenaGrid.appendChild(colTeam2);
  containerEl.appendChild(arenaGrid);

  // --- BOTTOM COMMAND DOCK (aligns Header + Action Buttons at the bottom of the page) ---
  const bottomDock = document.createElement('div');
  bottomDock.id = 'assignment-bottom-dock';
  bottomDock.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    max-width: 1420px;
    background: rgba(11, 17, 26, 0.88);
    border: 1px solid rgba(120, 170, 210, 0.28);
    border-radius: 10px;
    padding: 8px 16px;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.72);
    box-sizing: border-box;
  `;

  const actionRow = document.createElement('div');
  actionRow.style.cssText = `
    display: flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
  `;

  const btnBack = document.createElement('button');
  btnBack.id = 'assignment-btn-back';
  btnBack.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 8px 11px;
    font-size: 11px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.05em;
    color: #ffffff;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 6px;
    white-space: nowrap;
    cursor: pointer;
    transition: all 0.15s ease;
  `;
  btnBack.innerHTML = `<span class="contextual-btn-badge" style="display:inline-flex;align-items:center;gap:3px;border-color:#ff2e55;color:#ff2e55;white-space:nowrap;">${renderCardinalDiamondSvg('east', 12)} ○/B</span><span>TITLE</span>`;
  btnBack.onclick = () => {
    soundManager.playTone(330, 0.08, 'sine', 0.15);
    hideControllerAssignment();
    if (onBackCallback) onBackCallback();
  };

  const btnToggle = document.createElement('button');
  btnToggle.id = 'assignment-btn-toggle';
  btnToggle.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 8px 11px;
    font-size: 11px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.05em;
    color: #ffffff;
    background: rgba(245, 158, 11, 0.14);
    border: 1px solid rgba(245, 158, 11, 0.45);
    border-radius: 6px;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: 0 0 12px rgba(245, 158, 11, 0.2);
    transition: all 0.15s ease;
  `;
  btnToggle.innerHTML = `<span class="contextual-btn-badge" style="display:inline-flex;align-items:center;gap:3px;border-color:#fbb417;color:#fbb417;white-space:nowrap;">${renderCardinalDiamondSvg('north', 12)} △/Y</span><span>2v2 MODE</span>`;
  btnToggle.onclick = () => toggleMode();

  const btnBothAI = document.createElement('button');
  btnBothAI.id = 'assignment-btn-both-ai';
  btnBothAI.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 8px 11px;
    font-size: 11px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.05em;
    color: #00e5ff;
    background: rgba(0, 229, 255, 0.08);
    border: 1px solid rgba(0, 229, 255, 0.35);
    border-radius: 6px;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: 0 0 12px rgba(0, 229, 255, 0.2);
    transition: all 0.15s ease;
  `;
  btnBothAI.innerHTML = `<span class="contextual-btn-badge" style="display:inline-flex;align-items:center;gap:3px;border-color:#00e5ff;color:#00e5ff;white-space:nowrap;">${renderCardinalDiamondSvg('west', 12)} □/X</span><span>ALL AI</span>`;
  btnBothAI.onclick = () => setBothAI();

  const btnProceed = document.createElement('button');
  btnProceed.id = 'assignment-btn-proceed';
  btnProceed.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 13px;
    font-size: 11.5px;
    font-weight: 900;
    font-family: inherit;
    letter-spacing: 0.06em;
    color: #ffffff;
    background: rgba(0, 229, 255, 0.16);
    border: 1.5px solid #00e5ff;
    border-radius: 6px;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: 0 0 14px rgba(0, 229, 255, 0.35);
    transition: all 0.15s ease;
  `;
  btnProceed.innerHTML = `<span>CUSTOMIZE</span><span class="contextual-btn-badge" style="background:#000;color:#00e5ff;border-color:#00e5ff;display:inline-flex;align-items:center;gap:3px;white-space:nowrap;">${renderCardinalDiamondSvg('south', 12)} ✕/A</span>`;
  btnProceed.onclick = () => proceedToSetup();

  const btnQuickStart = document.createElement('button');
  btnQuickStart.id = 'assignment-btn-quick-start';
  btnQuickStart.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 9px 15px;
    font-size: 12px;
    font-weight: 900;
    font-family: inherit;
    letter-spacing: 0.07em;
    color: #000000;
    background: #10b981;
    border: 2px solid #ffffff;
    border-radius: 6px;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: 0 0 18px rgba(16, 185, 129, 0.55);
    transition: all 0.15s ease;
  `;
  btnQuickStart.innerHTML = `<span>QUICK PLAY</span><span class="contextual-btn-badge" style="background:#000;color:#4ade80;border-color:#4ade80;white-space:nowrap;">START</span>`;
  btnQuickStart.onclick = () => quickStartMatch();

  const btnSwapSides = document.createElement('button');
  btnSwapSides.id = 'assignment-btn-swap-sides';
  btnSwapSides.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 8px 11px;
    font-size: 11px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.05em;
    color: #e9d5ff;
    background: rgba(168, 85, 247, 0.14);
    border: 1px solid rgba(168, 85, 247, 0.45);
    border-radius: 6px;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: 0 0 12px rgba(168, 85, 247, 0.2);
    transition: all 0.15s ease;
  `;
  btnSwapSides.innerHTML = `<span class="contextual-btn-badge" style="border-color:#a855f7;color:#c084fc;white-space:nowrap;">S / TAB</span><span>SWAP SIDES</span>`;
  btnSwapSides.onclick = () => swapSides();

  actionRow.appendChild(btnBack);
  actionRow.appendChild(btnBothAI);
  actionRow.appendChild(btnToggle);
  actionRow.appendChild(btnSwapSides);
  actionRow.appendChild(btnProceed);
  actionRow.appendChild(btnQuickStart);
  bottomDock.appendChild(header);
  bottomDock.appendChild(actionRow);
  containerEl.appendChild(bottomDock);

  if (rootEl) rootEl.appendChild(containerEl);
  state.controllerAssignmentEl = containerEl;

  return containerEl;
}

function vacateSecondarySlotsToBench() {
  if (assignmentState.team1[1]) {
    assignmentState.bench.push(assignmentState.team1[1]);
    assignmentState.team1[1] = null;
  }
  if (assignmentState.team2[1]) {
    assignmentState.bench.push(assignmentState.team2[1]);
    assignmentState.team2[1] = null;
  }
}

function reconcileAssignmentFromExplicit(playerConfigsOverride = null) {
  const explicit = getExplicitDeviceMappings();
  if (!explicit) return;

  const livePads = [];
  if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
    const raw = navigator.getGamepads() || [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] && raw[i].connected) livePads.push(raw[i]);
    }
  }

  const existingDevices = allDevices();
  const slotCount = currentMode === '2v2' ? 4 : 2;
  const nextSlots = [null, null, null, null];
  const seatedSet = new Set();
  const usedPadIndices = new Set();

  const resolveMappedDevice = (m) => {
    if (!m) return null;
    if (m.type === 'keyboard') {
      const keyId = m.keyId === 'kb2' ? 'kb2' : 'kb1';
      return existingDevices.find((d) => d.type === 'keyboard' && d.keyId === keyId) || {
        type: 'keyboard',
        keyId,
        name: keyId === 'kb2' ? 'Keyboard 2 (IJKL + Arrows)' : 'Keyboard 1 (WASD + Mouse)',
      };
    }
    if (m.type === 'gamepad' && typeof m.padIndex === 'number') {
      const live = livePads.find((p) => p.index === m.padIndex);
      const prev = existingDevices.find((d) => d.type === 'gamepad' && d.padIndex === m.padIndex);
      if (live) {
        const fresh = makePadDevice(live);
        if (prev) {
          prev.id = fresh.id;
          prev.name = fresh.name;
          prev.brand = fresh.brand;
          prev.fightingPad = fresh.fightingPad;
          return prev;
        }
        return fresh;
      }
      if (prev) return prev;
      return {
        type: 'gamepad',
        padIndex: m.padIndex,
        name: m.name || `Gamepad ${m.padIndex + 1}`,
        id: m.id || `Gamepad ${m.padIndex + 1}`,
        brand: detectGamepadProfile({ id: m.id || '' }).brand,
        fightingPad: Boolean(m.fightingPad),
      };
    }
    return null;
  };

  for (let s = 0; s < slotCount; s++) {
    if (playerConfigsOverride?.[s]?.type === 'ai') continue;
    if (state.playerConfigs?.[s]?.type === 'ai' && !explicit[s]) continue;
    const m = explicit[s];
    if (!m) continue;
    const dev = resolveMappedDevice(m);
    if (dev) {
      nextSlots[s] = dev;
      seatedSet.add(dev);
      if (dev.type === 'gamepad') usedPadIndices.add(dev.padIndex);
    }
  }

  assignmentState.team1 = [nextSlots[0], nextSlots[2]];
  assignmentState.team2 = [nextSlots[1], nextSlots[3]];

  const nextBench = [];
  for (const pad of livePads) {
    if (usedPadIndices.has(pad.index)) continue;
    const prev = existingDevices.find((d) => d.type === 'gamepad' && d.padIndex === pad.index);
    if (prev && !seatedSet.has(prev)) {
      const fresh = makePadDevice(pad);
      prev.id = fresh.id;
      prev.name = fresh.name;
      prev.brand = fresh.brand;
      prev.fightingPad = fresh.fightingPad;
      nextBench.push(prev);
    } else {
      nextBench.push(makePadDevice(pad));
    }
    usedPadIndices.add(pad.index);
  }
  for (const keyId of ['kb1', 'kb2']) {
    const existingKb = existingDevices.find((d) => d.type === 'keyboard' && d.keyId === keyId);
    if (existingKb && seatedSet.has(existingKb)) continue;
    nextBench.push(existingKb || {
      type: 'keyboard',
      keyId,
      name: keyId === 'kb2' ? 'Keyboard 2 (IJKL + Arrows)' : 'Keyboard 1 (WASD + Mouse)',
    });
  }
  assignmentState.bench = nextBench;
}

export function showControllerAssignment(mode = '1v1', callbacks = {}, options = {}) {
  if (callbacks.onProceed) onProceedCallback = callbacks.onProceed;
  if (callbacks.onQuickStart) onQuickStartCallback = callbacks.onQuickStart;
  if (callbacks.onBack) onBackCallback = callbacks.onBack;
  currentMode = mode;

  if (state.titleScreenEl) state.titleScreenEl.style.display = 'none';
  state.titleBrandBall?.stop?.();

  const hasExisting = allDevices().length > 0;
  if (!options.preserveExisting || !hasExisting) {
    initDefaultAssignments();
  } else {
    reconcileAssignmentFromExplicit(options.playerConfigs || null);
    if (currentMode === '1v1') {
      vacateSecondarySlotsToBench();
    }
  }
  renderAssignmentUI();
  updateDefaultCallout();

  if (containerEl) {
    containerEl.style.display = 'flex';
  }
}

export function hideControllerAssignment() {
  if (containerEl) {
    containerEl.style.display = 'none';
  }
}

export function getControllerAssignmentEl() {
  return containerEl;
}

export function getControllerAssignmentMode() {
  return currentMode;
}

export function toggleMode() {
  currentMode = currentMode === '1v1' ? '2v2' : '1v1';
  if (currentMode === '1v1') {
    vacateSecondarySlotsToBench();
  } else {
    for (const teamKey of ['team1', 'team2']) {
      for (let i = 0; i < 2; i++) {
        if (!assignmentState[teamKey][i]) {
          const padIdx = assignmentState.bench.findIndex((d) => d && d.type === 'gamepad');
          if (padIdx >= 0) {
            assignmentState[teamKey][i] = assignmentState.bench.splice(padIdx, 1)[0];
          }
        }
      }
    }
  }
  soundManager.playTone(currentMode === '2v2' ? 660 : 520, 0.07, 'sine', 0.2);
  renderAssignmentUI();
  updateDefaultCallout();
}

function makePadDevice(pad) {
  const profile = detectGamepadProfile(pad);
  return {
    type: 'gamepad',
    padIndex: pad.index,
    name: getCleanGamepadName(pad),
    id: pad.id,
    brand: profile.brand,
    fightingPad: isPadFightingMode(pad),
  };
}

function toggleDeviceFightPadMode(device) {
  if (!device || device.type !== 'gamepad') return;
  let livePad = null;
  if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
    const raw = navigator.getGamepads() || [];
    livePad = raw[device.padIndex] || null;
  }
  const next = livePad ? togglePadFightingMode(livePad) : !device.fightingPad;
  device.fightingPad = next;
  soundManager.playTone(next ? 680 : 460, 0.06, 'sine', 0.2);
  renderAssignmentUI();
}

function allDevices() {
  return [...assignmentState.team1, ...assignmentState.team2, ...assignmentState.bench].filter(Boolean);
}

function findPadDevice(padIndex) {
  return allDevices().find((d) => d.type === 'gamepad' && d.padIndex === padIndex) || null;
}

function findKeyboardDevice(keyId = 'kb1') {
  return (
    allDevices().find((d) => d.type === 'keyboard' && d.keyId === keyId) ||
    allDevices().find((d) => d.type === 'keyboard') ||
    null
  );
}

function locateDevice(device) {
  if (assignmentState.team1.includes(device)) return 'team1';
  if (assignmentState.team2.includes(device)) return 'team2';
  return 'bench';
}

function activeSlotCount() {
  return currentMode === '2v2' ? 2 : 1;
}

function hasOpenSlot(teamKey) {
  return assignmentState[teamKey].slice(0, activeSlotCount()).some((d) => !d);
}

function anySeated() {
  return assignmentState.team1.some(Boolean) || assignmentState.team2.some(Boolean);
}

function playDenied() {
  soundManager.playTone(220, 0.1, 'sawtooth', 0.15);
}

/**
 * One tilt / arrow step: from the bench a device claims that side (swapping any
 * idle auto-seated device onto the bench so 3–4 connected pads never dead-end);
 * from the far side it drops back to the bench.
 */
function stepDevice(device, dir) {
  const loc = locateDevice(device);
  const fromBench = dir < 0 ? 'team1' : 'team2';
  const farSide = dir < 0 ? 'team2' : 'team1';
  if (loc === farSide) {
    unassignDevice(device);
    return true;
  }
  if (loc === 'bench') {
    assignDeviceToTeam(device, fromBench);
    return true;
  }
  return false;
}

/**
 * A / Enter. A benched device joins an open side while one is free; once active
 * sides are filled (or if the device is already seated, or Both AI is active),
 * confirming advances straight to Player Setup without locking out bench pads.
 */
function joinOrProceed(device) {
  if (device && locateDevice(device) === 'bench' && anySeated()) {
    const team = hasOpenSlot('team1') ? 'team1' : hasOpenSlot('team2') ? 'team2' : null;
    if (team) {
      assignDeviceToTeam(device, team);
      return;
    }
  }
  proceedToSetup();
}

/** Keeps the screen in step with controllers plugged in or pulled out while it is open. */
function syncConnectedPads(pads) {
  let changed = false;
  let autoPromotedPadIndex = -1;
  for (const pad of pads) {
    if (!pad) continue;
    const existing = findPadDevice(pad.index);
    if (!existing) {
      const padDev = makePadDevice(pad);
      // If no gamepads were awake when this screen opened (so Keyboard 1 was only auto-seated in Team 1),
      // auto-promote the first newly-woken gamepad into Team 1 Slot 1 and move Keyboard 1 to the bench.
      const hasSeatedPad = [...assignmentState.team1, ...assignmentState.team2].some((d) => d && d.type === 'gamepad');
      if (!hasSeatedPad && assignmentState.team1[0]?.type === 'keyboard' && !assignmentState.team2[0]) {
        assignmentState.bench.push(assignmentState.team1[0]);
        assignmentState.team1[0] = padDev;
        autoPromotedPadIndex = pad.index;
      } else {
        assignmentState.bench.push(padDev);
      }
      changed = true;
    } else if (existing.id !== pad.id) {
      const fresh = makePadDevice(pad);
      existing.id = fresh.id;
      existing.name = fresh.name;
      existing.brand = fresh.brand;
      existing.fightingPad = fresh.fightingPad;
      changed = true;
    }
  }
  for (const device of allDevices()) {
    if (device.type === 'gamepad' && !pads.some((p) => p && p.index === device.padIndex)) {
      // An unplugged pad's seat goes back to AI.
      unassignDeviceSilently(device);
      changed = true;
    }
  }
  return { changed, autoPromotedPadIndex };
}

/**
 * Keyboard on this screen makes the same moves a pad does, applied to the keyboard
 * device itself (not whichever card happens to be first on screen).
 * @param {'left' | 'right' | 'drop' | 'confirm'} action
 */
export function handleAssignmentKey(action, keyId = 'kb1') {
  const kb = findKeyboardDevice(keyId);
  if (action === 'left' || action === 'right') {
    if (kb) stepDevice(kb, action === 'left' ? -1 : 1);
  } else if (action === 'drop') {
    if (kb && locateDevice(kb) !== 'bench') unassignDevice(kb);
  } else if (action === 'confirm') {
    joinOrProceed(kb);
  }
}

function initDefaultAssignments() {
  const pads = [];
  if (typeof navigator.getGamepads === 'function') {
    const raw = navigator.getGamepads();
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] && raw[i].connected) pads.push(raw[i]);
    }
  }

  assignmentState.team1 = [null, null];
  assignmentState.team2 = [null, null];
  assignmentState.bench = [];

  // Create device representation
  const devices = pads.map(makePadDevice);

  // Always make Keyboard 1 (WASD) and Secondary Keyboard 2 (IJKL) available
  devices.push({
    type: 'keyboard',
    keyId: 'kb1',
    name: 'Keyboard 1 (WASD + Mouse)',
  });
  devices.push({
    type: 'keyboard',
    keyId: 'kb2',
    name: 'Keyboard 2 (IJKL + Arrows)',
  });

  // Default distribution:
  // If a Dynamic Lobby Host pad navigated the Title Screen, seat it first as P1 (Team 1 Captain)!
  if (devices.some((d) => d.type === 'gamepad')) {
    const padDevices = devices.filter((d) => d.type === 'gamepad');
    if (Number.isInteger(state.lobbyHostPadIndex)) {
      const hostIdx = padDevices.findIndex((d) => d.padIndex === state.lobbyHostPadIndex);
      if (hostIdx > 0) {
        const [hostDev] = padDevices.splice(hostIdx, 1);
        padDevices.unshift(hostDev);
      }
    }
    assignmentState.team1[0] = padDevices[0];
    if (padDevices.length > 1) {
      assignmentState.team2[0] = padDevices[1];
    }
    if (currentMode === '2v2') {
      if (padDevices.length > 2) assignmentState.team1[1] = padDevices[2];
      if (padDevices.length > 3) assignmentState.team2[1] = padDevices[3];
    }
    devices.forEach((d) => {
      if (
        d !== assignmentState.team1[0] &&
        d !== assignmentState.team2[0] &&
        d !== assignmentState.team1[1] &&
        d !== assignmentState.team2[1]
      ) {
        assignmentState.bench.push(d);
      }
    });
  } else {
    assignmentState.team1[0] = devices[0]; // Keyboard 1
    devices.slice(1).forEach((d) => assignmentState.bench.push(d));
  }
}

export function renderAssignmentUI() {
  if (!containerEl) return;

  const t1Theme = getPlayerSlotTheme(0, getSlotKitColor(0));
  const t2Theme = getPlayerSlotTheme(1, getSlotKitColor(1));
  if (colTeam1El) {
    colTeam1El.style.borderColor = t1Theme.border;
    colTeam1El.style.borderTop = `4px solid ${t1Theme.hex}`;
    colTeam1El.style.boxShadow = `0 8px 28px rgba(0, 0, 0, 0.65), inset 0 0 16px ${t1Theme.bg}`;
  }
  const t1Title = document.getElementById('col-team1-title');
  const t1Badge = document.getElementById('col-team1-join-badge');
  const t1Hdr = document.getElementById('col-team1-header');
  if (t1Title) t1Title.style.color = t1Theme.hex;
  if (t1Badge) { t1Badge.style.borderColor = t1Theme.hex; t1Badge.style.color = t1Theme.hex; }
  if (t1Hdr) t1Hdr.style.borderBottom = `1px solid ${t1Theme.bgStrong}`;

  if (colTeam2El) {
    colTeam2El.style.borderColor = t2Theme.border;
    colTeam2El.style.borderTop = `4px solid ${t2Theme.hex}`;
    colTeam2El.style.boxShadow = `0 8px 28px rgba(0, 0, 0, 0.65), inset 0 0 16px ${t2Theme.bg}`;
  }
  const t2Title = document.getElementById('col-team2-title');
  const t2Badge = document.getElementById('col-team2-join-badge');
  const t2Hdr = document.getElementById('col-team2-header');
  if (t2Title) t2Title.style.color = t2Theme.hex;
  if (t2Badge) { t2Badge.style.borderColor = t2Theme.hex; t2Badge.style.color = t2Theme.hex; }
  if (t2Hdr) t2Hdr.style.borderBottom = `1px solid ${t2Theme.bgStrong}`;

  const modeBadge = document.getElementById('assignment-mode-badge');
  const btnToggle = document.getElementById('assignment-btn-toggle');
  if (modeBadge) {
    modeBadge.innerHTML = `<span style="white-space:nowrap;">${currentMode === '1v1' ? '1v1 VERSUS' : '2v2 (4P)'}</span><span class="contextual-btn-badge" style="background:#000;color:#fbb417;border-color:#fbb417;font-size:9px;display:inline-flex;align-items:center;gap:3px;white-space:nowrap;">${renderCardinalDiamondSvg('north', 10)} △/Y</span>`;
  }
  if (btnToggle) {
    btnToggle.innerHTML = currentMode === '1v1'
      ? `<span class="contextual-btn-badge" style="display:inline-flex;align-items:center;gap:3px;border-color:#fbb417;color:#fbb417;white-space:nowrap;">${renderCardinalDiamondSvg('north', 12)} △/Y</span><span>2v2 MODE</span>`
      : `<span class="contextual-btn-badge" style="display:inline-flex;align-items:center;gap:3px;border-color:#fbb417;color:#fbb417;white-space:nowrap;">${renderCardinalDiamondSvg('north', 12)} △/Y</span><span>1v1 MODE</span>`;
  }

  const activeHumanSlots = [];
  if (assignmentState.team1[0]) activeHumanSlots.push(0);
  if (assignmentState.team2[0]) activeHumanSlots.push(1);
  if (currentMode === '2v2') {
    if (assignmentState.team1[1]) activeHumanSlots.push(2);
    if (assignmentState.team2[1]) activeHumanSlots.push(3);
  }

  const team1Container = document.getElementById('team1-slots-container');
  const team2Container = document.getElementById('team2-slots-container');
  const benchContainer = document.getElementById('bench-slots-container');

  if (team1Container) {
    team1Container.innerHTML = '';
    // Slot 0 (P1 Captain)
    team1Container.appendChild(createSlotCard('P1 · TEAM 1 CAPTAIN', assignmentState.team1[0], 'home', 0, activeHumanSlots));
    // Slot 2 (P3 Teammate)
    if (currentMode === '2v2') {
      team1Container.appendChild(createSlotCard('P3 · TEAM 1 PARTNER', assignmentState.team1[1], 'home', 2, activeHumanSlots));
    } else {
      team1Container.appendChild(createInactiveSlotCard('P3 SLOT · 2v2 MODE ONLY'));
    }
  }

  if (team2Container) {
    team2Container.innerHTML = '';
    // Slot 1 (P2 Captain)
    team2Container.appendChild(createSlotCard('P2 · TEAM 2 CAPTAIN', assignmentState.team2[0], 'away', 1, activeHumanSlots));
    // Slot 3 (P4 Teammate)
    if (currentMode === '2v2') {
      team2Container.appendChild(createSlotCard('P4 · TEAM 2 PARTNER', assignmentState.team2[1], 'away', 3, activeHumanSlots));
    } else {
      team2Container.appendChild(createInactiveSlotCard('P4 SLOT · 2v2 MODE ONLY'));
    }
  }

  if (benchContainer) {
    benchContainer.innerHTML = '';
    const benchCount = assignmentState.bench.length;
    if (benchCount >= 5) {
      benchContainer.style.display = 'grid';
      benchContainer.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
      benchContainer.style.gap = '6px';
    } else {
      benchContainer.style.display = 'flex';
      benchContainer.style.flexDirection = 'column';
      benchContainer.style.gap = benchCount >= 4 ? '6px' : '8px';
    }
    if (benchCount === 0) {
      const emptyNote = document.createElement('div');
      emptyNote.style.cssText = 'padding: 24px 12px; text-align: center; color: #10b981; font-size: 13px; font-weight: 800; border: 1px dashed rgba(16, 185, 129, 0.4); border-radius: 8px;';
      emptyNote.innerHTML = '<span>&#10003; All active devices seated &middot; Press any button on another USB pad to wake and join</span>';
      benchContainer.appendChild(emptyNote);
    } else {
      assignmentState.bench.forEach((device) => {
        const card = createBenchDeviceCard(device);
        if (benchCount >= 4) card.style.padding = '6px 9px';
        benchContainer.appendChild(card);
      });
    }
  }
}

function createSlotCard(label, device, team, slotIdx, activeHumanSlots = []) {
  const card = document.createElement('div');
  const kitColor = getSlotKitColor(slotIdx);
  const slotTheme = getPlayerSlotTheme(slotIdx, kitColor);
  const accent = slotTheme.hex;
  const sideLabel = team === 'home' ? 'HOME (SOUTH)' : 'AWAY (NORTH)';
  const sideColor = slotTheme.hex;
  const sideBg = slotTheme.bg;
  card.dataset.slotIdx = String(slotIdx);
  if (device?.type === 'gamepad') card.dataset.padIndex = String(device.padIndex);

  card.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: ${device ? `linear-gradient(90deg, ${slotTheme.bg} 0%, rgba(11, 17, 26, 0.85) 65%)` : 'rgba(11, 17, 26, 0.7)'};
    border: 1.5px solid ${device ? accent : 'rgba(255, 255, 255, 0.15)'};
    border-left: 5px solid ${device ? accent : 'rgba(255, 255, 255, 0.25)'};
    border-radius: 8px;
    padding: 10px 12px;
    box-shadow: ${device ? `0 0 16px ${slotTheme.glow}` : 'none'};
    transition: all 0.15s ease;
  `;

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 6px;';
  const viewportBadge = renderViewportBadgeHtml(slotIdx, activeHumanSlots, 'match', kitColor);
  const isSoloAwayHost = !assignmentState.team1[0] && slotIdx === 1 && device?.type === 'gamepad';
  const hostChip = ((slotIdx === 0 && device) || isSoloAwayHost)
    ? `<span style="padding:1px 5px;border-radius:4px;background:${slotTheme.bg};border:1px solid ${slotTheme.hex};color:${slotTheme.hex};font-size:8.5px;font-weight:900;letter-spacing:0.06em;">HOST</span>`
    : '';
  const sidePill = `<span style="padding:1px 5px;border-radius:4px;background:${sideBg};border:1px solid ${sideColor};color:${sideColor};font-size:8.5px;font-weight:900;letter-spacing:0.05em;">${sideLabel}</span>`;
  header.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">
      <span style="padding:1px 6px;border-radius:4px;background:${accent};color:${slotTheme.textOnFill};font-size:10px;font-weight:900;letter-spacing:0.06em;">${slotTheme.label}</span>
      <span style="font-size: 10px; font-weight: 800; letter-spacing: 0.08em; color: ${accent};">${label}</span>
      ${sidePill}
      ${hostChip}
    </span>
    ${viewportBadge}
  `;
  card.appendChild(header);

  const content = document.createElement('div');
  content.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px;';

  if (device) {
    const isFight = device.type === 'gamepad' && Boolean(device.fightingPad);
    const devIcon = device.type === 'gamepad' ? (isFight ? '🕹️' : '🎮') : '⌨️';
    const sideCue = team === 'home' ? '▶ BENCH / AWAY' : '◀ BENCH / HOME';
    const fightToggleHtml = device.type === 'gamepad'
      ? `<button data-action="fight-mode" class="contextual-btn-badge" style="cursor:pointer;border-color:${isFight ? '#fbb417' : 'rgba(255,255,255,0.28)'};color:${isFight ? '#fbb417' : '#cbd5e1'};background:${isFight ? 'rgba(251,180,23,0.18)' : 'rgba(255,255,255,0.06)'};" title="Toggle Standard Stick vs Fighting Pad (D-Pad Movement): LB / RB">
          ${isFight ? '🕹️ FIGHT PAD (D-PAD)' : '🎮 STICK MOVE'}
        </button>`
      : '';
    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:7px;min-width:0;flex:1;">
        <span style="font-size:17px;flex-shrink:0;">${devIcon}</span>
        <span style="font-size:11.5px;font-weight:800;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${device.name}</span>
      </div>
      <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
        ${fightToggleHtml}
        <span style="font-size:9px;color:#94a3b8;font-weight:800;">${sideCue}</span>
        <button data-action="unassign" class="contextual-btn-badge" style="cursor:pointer;background:rgba(255,46,85,0.14);border-color:#ff2e55;color:#ffccd5;display:inline-flex;align-items:center;gap:3px;" title="Drop to bench">
          ${renderCardinalDiamondSvg('east', 11)} ○/B · BENCH
        </button>
      </div>
    `;
    content.querySelector('[data-action="fight-mode"]')?.addEventListener('click', () => {
      toggleDeviceFightPadMode(device);
    });
    content.querySelector('[data-action="unassign"]')?.addEventListener('click', () => {
      unassignDevice(device);
    });
  } else {
    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:17px;">🤖</span>
        <span style="font-size:11.5px;font-weight:700;color:#94a3b8;">AI ATHLETE (CPU BOT)</span>
      </div>
      <span style="font-size:9.5px;color:#cbd5e1;font-weight:800;">PRESS A / ANY BUTTON OR TILT ◀ ▶ TO JOIN</span>
    `;
  }
  card.appendChild(content);

  return card;
}

function createInactiveSlotCard(label) {
  const card = document.createElement('div');
  card.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px dashed rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #475569;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
  `;
  card.textContent = label;
  return card;
}

function createBenchDeviceCard(device) {
  const card = document.createElement('div');
  if (device?.type === 'gamepad') card.dataset.padIndex = String(device.padIndex);
  const isFight = device.type === 'gamepad' && Boolean(device.fightingPad);
  const devIcon = device.type === 'gamepad' ? (isFight ? '🕹️' : '🎮') : '⌨️';
  card.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 8px 11px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    transition: all 0.15s ease;
  `;

  const fightBtnHtml = device.type === 'gamepad'
    ? `<button data-action="fight-mode" class="contextual-btn-badge" style="cursor:pointer;white-space:nowrap;flex-shrink:0;border-color:${isFight ? '#fbb417' : 'rgba(255,255,255,0.25)'};color:${isFight ? '#fbb417' : '#94a3b8'};" title="Toggle Fighting Pad D-Pad Movement (LB / RB)">
        ${isFight ? '🕹️ D-PAD' : '🎮 STICK'}
      </button>`
    : '';

  const joinPromptHtml = device.type === 'gamepad'
    ? '<span class="contextual-btn-badge" style="white-space:nowrap;flex-shrink:0;border-color:#4ade80;color:#4ade80;background:rgba(16,185,129,0.14);">PRESS A / ANY BUTTON TO JOIN</span>'
    : `<span class="contextual-btn-badge" style="white-space:nowrap;flex-shrink:0;border-color:#94a3b8;color:#cbd5e1;">${device.keyId === 'kb2' ? 'ENTER / J / L' : 'SPACE / A / D'}</span>`;

  const t1Theme = getPlayerSlotTheme(0, getSlotKitColor(0));
  const t2Theme = getPlayerSlotTheme(1, getSlotKitColor(1));
  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;">
      <div style="display:flex;align-items:center;gap:7px;min-width:0;flex:1;">
        <span style="font-size:15px;flex-shrink:0;">${devIcon}</span>
        <span style="font-size:11.5px;font-weight:800;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${device.name}</span>
      </div>
      ${joinPromptHtml}
    </div>
    <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap;">
      ${fightBtnHtml}
      <button data-claim="team1" class="contextual-btn-badge" style="cursor:pointer;white-space:nowrap;flex-shrink:0;border-color:${t1Theme.hex};color:${t1Theme.hex};">
        ◀ HOME (SOUTH)
      </button>
      <button data-claim="team2" class="contextual-btn-badge" style="cursor:pointer;white-space:nowrap;flex-shrink:0;border-color:${t2Theme.hex};color:${t2Theme.hex};">
        AWAY (NORTH) ▶
      </button>
    </div>
  `;

  card.querySelector('[data-action="fight-mode"]')?.addEventListener('click', () => {
    toggleDeviceFightPadMode(device);
  });
  card.querySelector('[data-claim="team1"]')?.addEventListener('click', () => {
    assignDeviceToTeam(device, 'team1');
  });
  card.querySelector('[data-claim="team2"]')?.addEventListener('click', () => {
    assignDeviceToTeam(device, 'team2');
  });

  return card;
}

function assignDeviceToTeam(device, teamKey) {
  const teamSlots = assignmentState[teamKey];
  const maxSlots = currentMode === '2v2' ? 2 : 1;

  // Already on this team: confirm identity without disturbing anyone
  for (let i = 0; i < maxSlots; i++) {
    if (teamSlots[i] === device) {
      soundManager.playTone(teamKey === 'team1' ? 620 : 540, 0.04, 'sine', 0.14);
      return true;
    }
  }

  // Never silently displace another seated player onto the bench!
  let openIdx = -1;
  for (let i = 0; i < maxSlots; i++) {
    if (!teamSlots[i]) {
      openIdx = i;
      break;
    }
  }
  if (openIdx < 0) {
    playDenied();
    const teamLabel = teamKey === 'team1' ? 'TEAM 1' : 'TEAM 2';
    const tip = currentMode === '1v1'
      ? `${teamLabel} IS FULL: PRESS Y FOR 2v2 OR HAVE THAT PLAYER PRESS B TO LEAVE`
      : `${teamLabel} IS FULL (2/2 PLAYERS SEATED)`;
    showAssignmentCallout(tip, '#f59e0b');
    return false;
  }

  // Remove from previous seat / bench and claim open seat cleanly
  unassignDeviceSilently(device);
  teamSlots[openIdx] = device;
  soundManager.playTone(teamKey === 'team1' ? 620 : 540, 0.045, 'sine', 0.18);
  renderAssignmentUI();
  const newSlot = getSlotIndexForDevice(device);
  announceDeviceIdentity(device, newSlot, 'JOINED');
  return true;
}

function unassignDeviceSilently(device) {
  [0, 1].forEach((i) => {
    if (assignmentState.team1[i] === device) assignmentState.team1[i] = null;
    if (assignmentState.team2[i] === device) assignmentState.team2[i] = null;
  });
  assignmentState.bench = assignmentState.bench.filter((d) => d !== device);
}

function unassignDevice(device) {
  unassignDeviceSilently(device);
  assignmentState.bench.push(device);
  soundManager.playTone(380, 0.04, 'sine', 0.15);
  renderAssignmentUI();
  announceDeviceIdentity(device, -1, 'ON BENCH');
}

function showAssignmentCallout(html, accentHex = '#00e5ff', holdMs = 2600) {
  if (!liveCalloutEl) return;
  liveCalloutEl.innerHTML = html;
  liveCalloutEl.style.borderColor = accentHex;
  liveCalloutEl.style.boxShadow = `0 0 22px ${accentHex}44, 0 8px 24px rgba(0, 0, 0, 0.65)`;
  if (calloutClearTimer) clearTimeout(calloutClearTimer);
  if (holdMs > 0) {
    calloutClearTimer = setTimeout(() => {
      calloutClearTimer = null;
      updateDefaultCallout();
    }, holdMs);
  }
}

function updateDefaultCallout() {
  if (!liveCalloutEl) return;
  const slots = currentMode === '2v2' ? [0, 2, 1, 3] : [0, 1];
  const devFor = (s) => (
    s === 0 ? assignmentState.team1[0]
      : s === 1 ? assignmentState.team2[0]
        : s === 2 ? assignmentState.team1[1]
          : assignmentState.team2[1]
  );
  const padCount = allDevices().filter((d) => d && d.type === 'gamepad').length;
  const padBanner = padCount > 0
    ? `<span style="color:#00e5ff;font-size:11px;">PADS DETECTED: ${padCount}</span>`
    : '<span style="color:#fbb417;font-size:11px;">PLUG IN OR PRESS ANY BUTTON ON USB PAD TO WAKE</span>';
  const parts = slots.map((s) => {
    const t = getPlayerSlotTheme(s, getSlotKitColor(s));
    const d = devFor(s);
    const sideTag = (s === 0 || s === 2) ? 'HOME' : 'AWAY';
    const devTxt = d ? (d.type === 'gamepad' ? `PAD ${d.padIndex + 1}` : (d.keyId === 'kb2' ? 'IJKL' : 'WASD')) : 'AI BOT';
    return `<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:6px;background:${d ? t.bg : 'rgba(255,255,255,0.05)'};border:1px solid ${d ? t.hex : 'rgba(255,255,255,0.2)'};color:${d ? '#ffffff' : '#94a3b8'};font-size:11.5px;font-weight:900;"><span style="color:${t.hex};">${t.short} ${sideTag}</span><span>${devTxt}</span></span>`;
  });
  const canJoinFromBench = assignmentState.bench.some((d) => d && d.type === 'gamepad') && (hasOpenSlot('team1') || hasOpenSlot('team2'));
  const joinHint = canJoinFromBench
    ? '<span style="color:#4ade80;font-size:10.5px;margin-left:6px;">PRESS A / ANY BUTTON TO JOIN</span>'
    : '<span style="color:#64748b;font-size:10.5px;margin-left:6px;">TAP ANY CONTROLLER TO FLASH YOUR SEAT</span>';
  liveCalloutEl.style.borderColor = 'rgba(0, 229, 255, 0.35)';
  liveCalloutEl.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.6)';
  liveCalloutEl.innerHTML = `
    ${padBanner}
    <span style="color:#475569;">&middot;</span>
    ${parts.join('<span style="color:#475569;">&middot;</span>')}
    ${joinHint}
  `;
}

function announceDeviceIdentity(device, slotIdx, verb = 'ACTIVE') {
  if (!device) return;
  const devLabel = device.type === 'gamepad'
    ? `PAD ${device.padIndex + 1}`
    : (device.keyId === 'kb2' ? 'KEYBOARD 2 (IJKL)' : 'KEYBOARD 1 (WASD)');
  if (slotIdx < 0) {
    showAssignmentCallout(
      `<span style="color:#cbd5e1;">🎮 ${devLabel} ${verb}: PRESS A / X / Y / START TO JOIN OR TILT <b>◀ HOME</b> / <b>AWAY ▶</b></span>`,
      '#94a3b8',
    );
    return;
  }
  const t = getPlayerSlotTheme(slotIdx, getSlotKitColor(slotIdx));
  const teamName = (slotIdx === 0 || slotIdx === 2) ? 'HOME (SOUTH) · TEAM 1' : 'AWAY (NORTH) · TEAM 2';
  const isHostSlot = slotIdx === 0 || (!assignmentState.team1[0] && slotIdx === 1 && device.type === 'gamepad');
  const hostNote = isHostSlot ? ' · HOST CONTROLS START / CUSTOMIZE' : '';
  showAssignmentCallout(
    `<span style="padding:2px 8px;border-radius:5px;background:${t.hex};color:${t.textOnFill};font-weight:900;">${t.short}</span>` +
      `<span style="color:#ffffff;">${devLabel} ${verb}: YOU ARE <b style="color:${t.hex};">PLAYER ${slotIdx + 1}</b> ON ${teamName}${hostNote}</span>`,
    t.hex,
  );
}

export function swapSides() {
  for (let i = 0; i < 2; i++) {
    const tmp = assignmentState.team1[i];
    assignmentState.team1[i] = assignmentState.team2[i];
    assignmentState.team2[i] = tmp;
  }
  soundManager.playTone(580, 0.06, 'sine', 0.18);
  renderAssignmentUI();
  showAssignmentCallout('SWAPPED SIDES: HOME (SOUTH) AND AWAY (NORTH) TRADED SEATS', '#a855f7');
}

export function setBothAI() {
  [0, 1].forEach((i) => {
    if (assignmentState.team1[i]) {
      assignmentState.bench.push(assignmentState.team1[i]);
      assignmentState.team1[i] = null;
    }
    if (assignmentState.team2[i]) {
      assignmentState.bench.push(assignmentState.team2[i]);
      assignmentState.team2[i] = null;
    }
  });
  soundManager.playTone(480, 0.06, 'sine', 0.18);
  renderAssignmentUI();
  updateDefaultCallout();
}

function getSlotIndexForDevice(device) {
  if (!device) return -1;
  if (assignmentState.team1[0] === device) return 0;
  if (assignmentState.team2[0] === device) return 1;
  if (assignmentState.team1[1] === device) return 2;
  if (assignmentState.team2[1] === device) return 3;
  return -1;
}

function isRoomHostPad(pad, device) {
  if (!pad) return false;
  if (assignmentState.team1[0] === device) return true;
  if (!assignmentState.team1[0] && assignmentState.team2[0] === device && device?.type === 'gamepad') {
    return true;
  }
  if (!anySeated()) {
    if (Number.isInteger(state.lobbyHostPadIndex)) {
      return pad.index === state.lobbyHostPadIndex;
    }
    return true;
  }
  return false;
}

function pulsePadCard(padIndex) {
  if (!containerEl || !Number.isInteger(padIndex)) return;
  const card = containerEl.querySelector?.(`[data-pad-index="${padIndex}"]`);
  if (!card) return;
  card.classList?.remove('card-identify-pulse');
  void card.offsetWidth;
  card.classList?.add('card-identify-pulse');
}

/**
 * Gamepad Polling Loop for Controller Assignment screen
 * @param {Gamepad[]} pads connected pads
 * @param {ReturnType<typeof import('../../../input/menuPads.js').createMenuPadTracker>} menuPads
 *   the main menu's tracker, already updated for this poll
 */
export function pollAssignmentGamepads(pads, menuPads) {
  if (!containerEl || containerEl.style.display !== 'flex') return;
  const { changed, autoPromotedPadIndex } = syncConnectedPads(pads);
  if (changed) renderAssignmentUI();

  for (const pad of pads) {
    if (!pad) continue;
    // Continuing or backing out hides this screen; the rest of this poll belongs to the next one.
    if (containerEl.style.display !== 'flex') return;
    const e = menuPads.pressed(pad);
    if (!e) continue;
    if (!soundManager.unlocked) soundManager.unlock?.();
    const device = findPadDevice(pad.index);
    if (!device) continue;

    // Suppress immediate Start/A/X/Y actions on the exact poll a waking pad auto-promoted to Host.
    if (pad.index === autoPromotedPadIndex) {
      announceDeviceIdentity(device, 0, 'JOINED AS HOST');
      soundManager.playTone(620, 0.05, 'sine', 0.18);
      triggerSlotHaptic(pad, 0);
      pulsePadCard(pad.index);
      continue;
    }

    const isHost = isRoomHostPad(pad, device);
    const isSeated = locateDevice(device) !== 'bench';

    // Tilt / D-pad: claim a side from the bench, or drop back from the far side
    if ((e & MENU_PAD.left) && stepDevice(device, -1)) triggerSlotHaptic(pad, getSlotIndexForDevice(device));
    if ((e & MENU_PAD.right) && stepDevice(device, 1)) triggerSlotHaptic(pad, getSlotIndexForDevice(device));

    // LB / RB toggles Fighting Pad (D-Pad Movement) mode for this controller
    if (e & (MENU_PAD.lb | MENU_PAD.rb)) {
      toggleDeviceFightPadMode(device);
      triggerSlotHaptic(pad, getSlotIndexForDevice(device));
    }

    // Back button returns to Title Screen only for the Lobby Host (prevents accidental idle-pad exits)
    if (e & MENU_PAD.back) {
      if (isHost) {
        soundManager.playTone(330, 0.08, 'sine', 0.15);
        hideControllerAssignment();
        if (onBackCallback) onBackCallback();
        triggerSlotHaptic(pad, getSlotIndexForDevice(device));
        return;
      }
      playDenied();
      pulsePadCard(pad.index);
      continue;
    }

    // B drops a seated pad to the bench; pressing B again from the bench returns to Title ONLY for Host
    if (e & MENU_PAD.b) {
      if (isSeated) {
        unassignDevice(device);
        triggerSlotHaptic(pad, -1);
      } else if (isHost) {
        soundManager.playTone(330, 0.08, 'sine', 0.15);
        hideControllerAssignment();
        if (onBackCallback) onBackCallback();
        triggerSlotHaptic(pad, -1);
        return;
      } else {
        playDenied();
        pulsePadCard(pad.index);
      }
    }

    // Unified bench walk-up join: any face button (A / X / Y / Start) claims an open seat from the bench
    if (!isSeated && (!isHost || anySeated()) && (e & (MENU_PAD.a | MENU_PAD.x | MENU_PAD.y | MENU_PAD.start))) {
      const team = hasOpenSlot('team1') ? 'team1' : hasOpenSlot('team2') ? 'team2' : null;
      if (team) {
        assignDeviceToTeam(device, team);
        triggerSlotHaptic(pad, getSlotIndexForDevice(device));
      } else {
        playDenied();
        showAssignmentCallout('ALL SEATS FULL: PRESS Y FOR 2v2 OR HAVE A PLAYER PRESS B TO LEAVE', '#f59e0b');
      }
      pulsePadCard(pad.index);
      continue;
    }

    // Set All AI with X (Host only so idle pads never wipe seated players)
    if (e & MENU_PAD.x) {
      if (isHost) {
        setBothAI();
        triggerSlotHaptic(pad, 0);
      } else {
        playDenied();
        pulsePadCard(pad.index);
      }
    }

    // Toggle 1v1 / 2v2 Mode with Y (Host only)
    if (e & MENU_PAD.y) {
      if (isHost) {
        toggleMode();
        triggerSlotHaptic(pad, 0);
      } else {
        playDenied();
        pulsePadCard(pad.index);
      }
    }

    // Start launches Quick Play straight into the match for Host (or seated P1 fallback)
    if (e & MENU_PAD.start) {
      if (isHost) {
        triggerSlotHaptic(pad, getSlotIndexForDevice(device));
        quickStartMatch();
        return;
      }
      playDenied();
      announceDeviceIdentity(device, getSlotIndexForDevice(device), 'READY (HOST PRESSES START TO PLAY)');
      pulsePadCard(pad.index);
      continue;
    }

    // A: benched pad joins an open slot; Host advances to Customize & Match Rules; non-host seated pad flashes identity
    if (e & MENU_PAD.a) {
      if (!isSeated) {
        const team = hasOpenSlot('team1') ? 'team1' : hasOpenSlot('team2') ? 'team2' : null;
        if (team) {
          assignDeviceToTeam(device, team);
          triggerSlotHaptic(pad, getSlotIndexForDevice(device));
        } else {
          playDenied();
          showAssignmentCallout('ALL SEATS FULL: PRESS Y FOR 2v2 OR HAVE A PLAYER PRESS B TO LEAVE', '#f59e0b');
        }
      } else if (isHost) {
        triggerSlotHaptic(pad, getSlotIndexForDevice(device));
        proceedToSetup();
        return;
      } else {
        // Non-host pressing A confirms their seat identity instead of unexpectedly advancing the room
        const slotIdx = getSlotIndexForDevice(device);
        announceDeviceIdentity(device, slotIdx, 'CONFIRMED');
        soundManager.playTone(620, 0.05, 'sine', 0.18);
        triggerSlotHaptic(pad, slotIdx);
      }
    }

    // Up / Down tilt or any neutral confirm flashes identity so players immediately know which pad they hold
    if (e & (MENU_PAD.up | MENU_PAD.down)) {
      const slotIdx = getSlotIndexForDevice(device);
      announceDeviceIdentity(device, slotIdx, 'IDENTIFIED');
      triggerSlotHaptic(pad, slotIdx);
    }

    pulsePadCard(pad.index);
  }
}

function triggerSlotHaptic(pad, slotIdx = 0) {
  try {
    if (!pad?.vibrationActuator || typeof pad.vibrationActuator.playEffect !== 'function') return;
    if (slotIdx === 1) {
      // P2 signature: crisp double-tap
      pad.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: 28, weakMagnitude: 0.28, strongMagnitude: 0.10 }).catch(() => {});
      setTimeout(() => {
        pad.vibrationActuator?.playEffect?.('dual-rumble', { startDelay: 0, duration: 28, weakMagnitude: 0.28, strongMagnitude: 0.10 }).catch(() => {});
      }, 65);
    } else if (slotIdx >= 2) {
      // P3 / P4 signature: firmer low-motor thump
      pad.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: 55, weakMagnitude: 0.20, strongMagnitude: 0.30 }).catch(() => {});
    } else {
      // P1 / Bench signature: clean single tap
      pad.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: 35, weakMagnitude: 0.25, strongMagnitude: 0.10 }).catch(() => {});
    }
  } catch (_) {}
}

function commitAssignmentMappings() {
  // Build mapping configuration (exact 1:1 hardware -> athlete slot authority)
  const mappings = {};
  if (assignmentState.team1[0]) mappings[0] = assignmentState.team1[0];
  if (assignmentState.team2[0]) mappings[1] = assignmentState.team2[0];
  if (currentMode === '2v2') {
    if (assignmentState.team1[1]) mappings[2] = assignmentState.team1[1];
    if (assignmentState.team2[1]) mappings[3] = assignmentState.team2[1];
  }

  setExplicitDeviceMappings(mappings);

  // Sync shared 4-slot state.playerConfigs without truncating length in 1v1 mode
  if (state.playerConfigs) {
    state.playerConfigs[0].type = assignmentState.team1[0] ? 'human' : 'ai';
    state.playerConfigs[0].team = 'home';
    state.playerConfigs[1].type = assignmentState.team2[0] ? 'human' : 'ai';
    state.playerConfigs[1].team = 'away';

    if (currentMode === '2v2') {
      if (state.playerConfigs[2]) {
        state.playerConfigs[2].type = assignmentState.team1[1] ? 'human' : 'ai';
        state.playerConfigs[2].team = 'home';
      }
      if (state.playerConfigs[3]) {
        state.playerConfigs[3].type = assignmentState.team2[1] ? 'human' : 'ai';
        state.playerConfigs[3].team = 'away';
      }
    }
  }
}

export function proceedToSetup() {
  soundManager.playTone(740, 0.08, 'sine', 0.22);
  hideControllerAssignment();
  commitAssignmentMappings();

  if (onProceedCallback) {
    onProceedCallback({
      mode: currentMode,
      assignments: assignmentState,
    });
  }
}

export function quickStartMatch() {
  soundManager.playTone(880, 0.12, 'sine', 0.28);
  hideControllerAssignment();
  commitAssignmentMappings();

  if (onQuickStartCallback) {
    onQuickStartCallback({
      mode: currentMode,
      assignments: assignmentState,
    });
  } else if (onProceedCallback) {
    onProceedCallback({
      mode: currentMode,
      assignments: assignmentState,
    });
  }
}
