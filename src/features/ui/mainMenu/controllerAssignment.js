import { soundManager } from '../../../audio/soundManager.js';
import { state } from './state.js';
import { setExplicitDeviceMappings } from '../../../input/inputRouter.js';
import { MENU_PAD } from '../../../input/menuPads.js';

let containerEl = null;
let currentMode = '1v1'; // '1v1' or '2v2'
let onProceedCallback = null;
let onBackCallback = null;

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
  const id = (pad.id || '').toLowerCase();
  if (id.includes('xinput') || id.includes('xbox') || id.includes('045e')) {
    return `Xbox Controller (Pad ${pad.index + 1})`;
  }
  if (id.includes('dualsense') || id.includes('wireless controller') || id.includes('playstation') || id.includes('054c')) {
    return `PlayStation Controller (Pad ${pad.index + 1})`;
  }
  if (id.includes('nintendo') || id.includes('switch') || id.includes('057e')) {
    return `Switch Controller (Pad ${pad.index + 1})`;
  }
  return `Gamepad ${pad.index + 1}`;
}

export function buildControllerAssignmentScreen(rootEl, callbacks = {}) {
  onProceedCallback = callbacks.onProceed || null;
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
    background: linear-gradient(180deg, rgba(3, 6, 12, 0.0) 0%, rgba(3, 6, 12, 0.14) 48%, rgba(3, 6, 12, 0.82) 100%);
    z-index: 550;
    font-family: inherit;
    user-select: none;
    box-sizing: border-box;
    gap: 10px;
  `;

  // --- HEADER SECTION (mounted inside the Bottom Command Dock so the center stays open) ---
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    min-width: 0;
  `;

  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';

  const title = document.createElement('h2');
  title.textContent = 'CONTROLLER ASSIGNMENT & SIDES';
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
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #000000;
    background: linear-gradient(90deg, #00e5ff, #38bdf8);
    border: none;
    cursor: pointer;
    box-shadow: 0 0 12px rgba(0, 229, 255, 0.45);
    transition: transform 0.15s ease;
  `;
  modeBadge.innerHTML = `<span>MODE: 1v1 VERSUS</span><span class="contextual-btn-badge" style="background:#000;color:#fff;font-size:8.5px;">1v1 ACTIVE</span>`;
  modeBadge.onclick = () => {
    toggleMode();
  };

  titleRow.appendChild(title);
  titleRow.appendChild(modeBadge);

  const subtitle = document.createElement('div');
  subtitle.id = 'assignment-subtitle';
  subtitle.style.cssText = 'font-size: 10px; font-weight: 700; color: #94a3b8; letter-spacing: 0.03em;';
  subtitle.innerHTML = 'Controller: <b>◀ ▶</b> claim Team 1 / Team 2 &middot; <b>A</b> join / continue &middot; <b>B</b> bench / back &middot; Keyboard: <b>A / D</b> or <b>← →</b> switch side &middot; <b>Enter</b> join / continue';

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

  // Column 1: Team 1 (Home - Cyan)
  const colTeam1 = document.createElement('div');
  colTeam1.id = 'col-team1';
  colTeam1.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(11, 17, 26, 0.84);
    border: 1.5px solid rgba(0, 229, 255, 0.45);
    border-radius: 10px;
    padding: 12px 14px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.65), inset 0 0 16px rgba(0, 229, 255, 0.06);
  `;
  colTeam1.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(0,229,255,0.22);padding-bottom:6px;">
      <span style="font-size:13px;font-weight:900;letter-spacing:0.12em;color:#00e5ff;">TEAM 1 (P1 &amp; P3)</span>
      <span class="contextual-btn-badge" style="border-color:#00e5ff;color:#00e5ff;">◀ TILT LEFT</span>
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
      <span style="font-size:13px;font-weight:900;letter-spacing:0.12em;color:#ffffff;">AVAILABLE CONTROLLERS</span>
      <span style="font-size:10px;font-weight:700;color:#94a3b8;">[BENCH]</span>
    </div>
    <div id="bench-slots-container" style="display:flex;flex-direction:column;gap:8px;flex:1;max-height:175px;overflow-y:auto;"></div>
  `;

  // Column 3: Team 2 (Away - Coral)
  const colTeam2 = document.createElement('div');
  colTeam2.id = 'col-team2';
  colTeam2.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(11, 17, 26, 0.84);
    border: 1.5px solid rgba(255, 46, 85, 0.45);
    border-radius: 10px;
    padding: 12px 14px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.65), inset 0 0 16px rgba(255, 46, 85, 0.06);
  `;
  colTeam2.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,46,85,0.22);padding-bottom:6px;">
      <span style="font-size:13px;font-weight:900;letter-spacing:0.12em;color:#ff2e55;">TEAM 2 (P2 &amp; P4)</span>
      <span class="contextual-btn-badge" style="border-color:#ff2e55;color:#ff2e55;">TILT RIGHT ▶</span>
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
    gap: 8px;
  `;

  const btnBack = document.createElement('button');
  btnBack.id = 'assignment-btn-back';
  btnBack.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 14px;
    font-size: 11px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.06em;
    color: #ffffff;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  `;
  btnBack.innerHTML = `<span class="contextual-btn-badge">B / ESC</span><span>TITLE</span>`;
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
    gap: 6px;
    padding: 9px 14px;
    font-size: 11px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.06em;
    color: #ffffff;
    background: rgba(245, 158, 11, 0.14);
    border: 1px solid rgba(245, 158, 11, 0.45);
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 0 12px rgba(245, 158, 11, 0.2);
    transition: all 0.15s ease;
  `;
  btnToggle.innerHTML = `<span class="contextual-btn-badge" style="border-color:#f59e0b;color:#f59e0b;">Y</span><span>SWITCH TO 2v2</span>`;
  btnToggle.onclick = () => toggleMode();

  const btnBothAI = document.createElement('button');
  btnBothAI.id = 'assignment-btn-both-ai';
  btnBothAI.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 14px;
    font-size: 11px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.06em;
    color: #00e5ff;
    background: rgba(0, 229, 255, 0.08);
    border: 1px solid rgba(0, 229, 255, 0.35);
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 0 12px rgba(0, 229, 255, 0.2);
    transition: all 0.15s ease;
  `;
  btnBothAI.innerHTML = `<span class="contextual-btn-badge" style="border-color:#00e5ff;color:#00e5ff;">X</span><span>ALL AI</span>`;
  btnBothAI.onclick = () => setBothAI();

  const btnProceed = document.createElement('button');
  btnProceed.id = 'assignment-btn-proceed';
  btnProceed.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    font-size: 12px;
    font-weight: 900;
    font-family: inherit;
    letter-spacing: 0.08em;
    color: #000000;
    background: #10b981;
    border: 2px solid #ffffff;
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 0 18px rgba(16, 185, 129, 0.5);
    transition: all 0.15s ease;
  `;
  btnProceed.innerHTML = `<span>CONTINUE</span><span class="contextual-btn-badge" style="background:#000;color:#fff;">START / A</span>`;
  btnProceed.onclick = () => proceedToSetup();

  actionRow.appendChild(btnBack);
  actionRow.appendChild(btnBothAI);
  actionRow.appendChild(btnToggle);
  actionRow.appendChild(btnProceed);
  bottomDock.appendChild(header);
  bottomDock.appendChild(actionRow);
  containerEl.appendChild(bottomDock);

  if (rootEl) rootEl.appendChild(containerEl);
  state.controllerAssignmentEl = containerEl;

  return containerEl;
}

export function showControllerAssignment(mode = '1v1', callbacks = {}, options = {}) {
  if (callbacks.onProceed) onProceedCallback = callbacks.onProceed;
  if (callbacks.onBack) onBackCallback = callbacks.onBack;
  currentMode = mode;

  const hasExisting = allDevices().length > 0;
  if (!options.preserveExisting || !hasExisting) {
    initDefaultAssignments();
  }
  renderAssignmentUI();

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
    if (assignmentState.team1[1]) {
      assignmentState.bench.push(assignmentState.team1[1]);
      assignmentState.team1[1] = null;
    }
    if (assignmentState.team2[1]) {
      assignmentState.bench.push(assignmentState.team2[1]);
      assignmentState.team2[1] = null;
    }
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
}

function makePadDevice(pad) {
  return {
    type: 'gamepad',
    padIndex: pad.index,
    name: getCleanGamepadName(pad),
    id: pad.id,
  };
}

function allDevices() {
  return [...assignmentState.team1, ...assignmentState.team2, ...assignmentState.bench].filter(Boolean);
}

function findPadDevice(padIndex) {
  return allDevices().find((d) => d.type === 'gamepad' && d.padIndex === padIndex) || null;
}

function findKeyboardDevice() {
  return allDevices().find((d) => d.type === 'keyboard') || null;
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
  for (const pad of pads) {
    if (pad && !findPadDevice(pad.index)) {
      const padDev = makePadDevice(pad);
      // If no gamepads were awake when this screen opened (so Keyboard 1 was only auto-seated in Team 1),
      // auto-promote the first newly-woken gamepad into Team 1 Slot 1 and move Keyboard 1 to the bench.
      const hasSeatedPad = [...assignmentState.team1, ...assignmentState.team2].some((d) => d && d.type === 'gamepad');
      if (!hasSeatedPad && assignmentState.team1[0]?.type === 'keyboard' && !assignmentState.team2[0]) {
        assignmentState.bench.push(assignmentState.team1[0]);
        assignmentState.team1[0] = padDev;
      } else {
        assignmentState.bench.push(padDev);
      }
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
  return changed;
}

/**
 * Keyboard on this screen makes the same moves a pad does, applied to the keyboard
 * device itself (not whichever card happens to be first on screen).
 * @param {'left' | 'right' | 'drop' | 'confirm'} action
 */
export function handleAssignmentKey(action) {
  const kb = findKeyboardDevice();
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

  // Always make Keyboard 1 (WASD) available
  devices.push({
    type: 'keyboard',
    keyId: 'kb1',
    name: 'Keyboard 1 (WASD + Space)',
  });

  // Default distribution:
  // If at least 1 gamepad, Pad 0 to Team 1 Slot 0.
  // If at least 2 gamepads, Pad 1 to Team 2 Slot 1.
  // Else, Keyboard 1 to Team 1 Slot 0.
  if (devices.some((d) => d.type === 'gamepad')) {
    const padDevices = devices.filter((d) => d.type === 'gamepad');
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

  const modeBadge = document.getElementById('assignment-mode-badge');
  const btnToggle = document.getElementById('assignment-btn-toggle');
  if (modeBadge) {
    modeBadge.innerHTML = `<span>MODE: ${currentMode === '1v1' ? '1v1 VERSUS' : '2v2 (4 ATHLETES)'}</span><span class="contextual-btn-badge" style="background:#000;color:#fff;font-size:9px;">Y / CLICK</span>`;
  }
  if (btnToggle) {
    btnToggle.innerHTML = currentMode === '1v1'
      ? `<span class="contextual-btn-badge">Y</span><span>SWITCH TO 2v2 (4 ATHLETES)</span>`
      : `<span class="contextual-btn-badge">Y</span><span>SWITCH TO 1v1 VERSUS</span>`;
  }

  const team1Container = document.getElementById('team1-slots-container');
  const team2Container = document.getElementById('team2-slots-container');
  const benchContainer = document.getElementById('bench-slots-container');

  if (team1Container) {
    team1Container.innerHTML = '';
    // Slot 0 (P1 Captain)
    team1Container.appendChild(createSlotCard('SLOT 1 &middot; CAPTAIN', assignmentState.team1[0], 'home', 0));
    // Slot 2 (P3 Teammate)
    if (currentMode === '2v2') {
      team1Container.appendChild(createSlotCard('SLOT 2 &middot; TEAMMATE', assignmentState.team1[1], 'home', 2));
    } else {
      team1Container.appendChild(createInactiveSlotCard('2v2 ONLY · INACTIVE IN 1v1'));
    }
  }

  if (team2Container) {
    team2Container.innerHTML = '';
    // Slot 1 (P2 Captain)
    team2Container.appendChild(createSlotCard('SLOT 1 &middot; CAPTAIN', assignmentState.team2[0], 'away', 1));
    // Slot 3 (P4 Teammate)
    if (currentMode === '2v2') {
      team2Container.appendChild(createSlotCard('SLOT 2 &middot; TEAMMATE', assignmentState.team2[1], 'away', 3));
    } else {
      team2Container.appendChild(createInactiveSlotCard('2v2 ONLY · INACTIVE IN 1v1'));
    }
  }

  if (benchContainer) {
    benchContainer.innerHTML = '';
    if (assignmentState.bench.length === 0) {
      const emptyNote = document.createElement('div');
      emptyNote.style.cssText = 'padding: 24px 12px; text-align: center; color: #10b981; font-size: 13px; font-weight: 800; border: 1px dashed rgba(16, 185, 129, 0.4); border-radius: 8px;';
      emptyNote.innerHTML = '<span>&#10003; All connected devices assigned to teams</span>';
      benchContainer.appendChild(emptyNote);
    } else {
      assignmentState.bench.forEach((device) => {
        benchContainer.appendChild(createBenchDeviceCard(device));
      });
    }
  }
}

function createSlotCard(label, device, team, slotIdx) {
  const card = document.createElement('div');
  const isCyan = team === 'home';
  const accent = isCyan ? '#00e5ff' : '#ff2e55';

  card.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: rgba(11, 17, 26, 0.7);
    border: 1px solid ${device ? accent : 'rgba(255, 255, 255, 0.15)'};
    border-radius: 8px;
    padding: 12px;
    box-shadow: ${device ? `0 0 16px ${isCyan ? 'rgba(0,229,255,0.3)' : 'rgba(255,46,85,0.3)'}` : 'none'};
    transition: all 0.15s ease;
  `;

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
  header.innerHTML = `
    <span style="font-size: 10px; font-weight: 800; letter-spacing: 0.08em; color: ${accent};">${label}</span>
    <span style="font-size: 10px; font-weight: 700; color: #94a3b8;">${device ? (device.type === 'gamepad' ? '🎮 HUMAN' : '⌨ HUMAN') : '🤖 AI BOT'}</span>
  `;
  card.appendChild(header);

  const content = document.createElement('div');
  content.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px;';

  if (device) {
    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">${device.type === 'gamepad' ? '🎮' : '⌨'}</span>
        <span style="font-size:12px;font-weight:800;color:#ffffff;">${device.name}</span>
      </div>
      <button class="contextual-btn-badge" style="cursor:pointer;background:rgba(255,255,255,0.1);color:#fff;" title="Drop to bench">
        B &middot; UNASSIGN
      </button>
    `;
    content.querySelector('button')?.addEventListener('click', () => {
      unassignDevice(device);
    });
  } else {
    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">🤖</span>
        <span style="font-size:12px;font-weight:700;color:#94a3b8;">AI ATHLETE (AUTO-PILOT)</span>
      </div>
      <span style="font-size:10px;color:#64748b;font-weight:700;">VACANT</span>
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
  card.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    transition: all 0.15s ease;
  `;

  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:16px;">${device.type === 'gamepad' ? '🎮' : '⌨'}</span>
      <span style="font-size:12px;font-weight:800;color:#ffffff;">${device.name}</span>
    </div>
    <div style="display:flex;gap:6px;">
      <button data-claim="team1" class="contextual-btn-badge" style="cursor:pointer;border-color:#00e5ff;color:#00e5ff;">
        ◀ TEAM 1
      </button>
      <button data-claim="team2" class="contextual-btn-badge" style="cursor:pointer;border-color:#ff2e55;color:#ff2e55;">
        TEAM 2 ▶
      </button>
    </div>
  `;

  card.querySelector('[data-claim="team1"]')?.addEventListener('click', () => {
    assignDeviceToTeam(device, 'team1');
  });
  card.querySelector('[data-claim="team2"]')?.addEventListener('click', () => {
    assignDeviceToTeam(device, 'team2');
  });

  return card;
}

function assignDeviceToTeam(device, teamKey) {
  // Remove from wherever it was
  unassignDeviceSilently(device);

  const teamSlots = assignmentState[teamKey];
  const maxSlots = currentMode === '2v2' ? 2 : 1;
  for (let i = 0; i < maxSlots; i++) {
    if (!teamSlots[i]) {
      teamSlots[i] = device;
      soundManager.playTone(teamKey === 'team1' ? 620 : 540, 0.045, 'sine', 0.18);
      renderAssignmentUI();
      return true;
    }
  }

  // If team is full, displace oldest slot (FIFO) to the bench
  if (maxSlots === 2) {
    if (teamSlots[0]) assignmentState.bench.push(teamSlots[0]);
    teamSlots[0] = teamSlots[1];
    teamSlots[1] = device;
  } else {
    if (teamSlots[0]) assignmentState.bench.push(teamSlots[0]);
    teamSlots[0] = device;
  }
  soundManager.playTone(teamKey === 'team1' ? 620 : 540, 0.045, 'sine', 0.18);
  renderAssignmentUI();
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
}

/**
 * Gamepad Polling Loop for Controller Assignment screen
 * @param {Gamepad[]} pads connected pads
 * @param {ReturnType<typeof import('../../../input/menuPads.js').createMenuPadTracker>} menuPads
 *   the main menu's tracker, already updated for this poll
 */
export function pollAssignmentGamepads(pads, menuPads) {
  if (!containerEl || containerEl.style.display !== 'flex') return;
  if (syncConnectedPads(pads)) renderAssignmentUI();

  for (const pad of pads) {
    if (!pad) continue;
    // Continuing or backing out hides this screen; the rest of this poll belongs to the next one.
    if (containerEl.style.display !== 'flex') return;
    const e = menuPads.pressed(pad);
    if (!e) continue;
    const device = findPadDevice(pad.index);
    if (!device) continue;

    // Tilt / D-pad: claim a side from the bench, or drop back from the far side
    if ((e & MENU_PAD.left) && stepDevice(device, -1)) triggerHaptic(pad);
    if ((e & MENU_PAD.right) && stepDevice(device, 1)) triggerHaptic(pad);

    // B drops a seated pad to the bench; pressing B again from the bench (or Back
    // from anywhere) returns cleanly to the Title Screen without trapping players.
    if (e & MENU_PAD.back) {
      soundManager.playTone(330, 0.08, 'sine', 0.15);
      hideControllerAssignment();
      if (onBackCallback) onBackCallback();
      triggerHaptic(pad);
      return;
    }

    if (e & MENU_PAD.b) {
      if (locateDevice(device) !== 'bench') {
        unassignDevice(device);
        triggerHaptic(pad);
      } else {
        soundManager.playTone(330, 0.08, 'sine', 0.15);
        hideControllerAssignment();
        if (onBackCallback) onBackCallback();
        triggerHaptic(pad);
        return;
      }
    }

    // Set Both AI with X
    if (e & MENU_PAD.x) {
      setBothAI();
      triggerHaptic(pad);
    }

    // Toggle 1v1 / 2v2 Mode with Y
    if (e & MENU_PAD.y) {
      toggleMode();
      triggerHaptic(pad);
    }

    // Start from any controller always proceeds directly to Player Setup
    if (e & MENU_PAD.start) {
      proceedToSetup();
      triggerHaptic(pad);
      return;
    }

    // A: join open slot from the bench, or continue to setup
    if (e & MENU_PAD.a) {
      joinOrProceed(device);
      triggerHaptic(pad);
    }
  }
}

function triggerHaptic(pad) {
  try {
    if (pad.vibrationActuator && typeof pad.vibrationActuator.playEffect === 'function') {
      pad.vibrationActuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: 35,
        weakMagnitude: 0.25,
        strongMagnitude: 0.1,
      }).catch(() => {});
    }
  } catch (_) {}
}

export function proceedToSetup() {
  soundManager.playTone(740, 0.08, 'sine', 0.22);
  hideControllerAssignment();

  // Build mapping configuration
  const mappings = {};
  if (assignmentState.team1[0]) {
    mappings[0] = assignmentState.team1[0];
  }
  if (assignmentState.team2[0]) {
    mappings[1] = assignmentState.team2[0];
  }
  if (currentMode === '2v2') {
    if (assignmentState.team1[1]) mappings[2] = assignmentState.team1[1];
    if (assignmentState.team2[1]) mappings[3] = assignmentState.team2[1];
  }

  setExplicitDeviceMappings(mappings);

  // Sync state.playerConfigs
  if (state.playerConfigs) {
    state.playerConfigs[0].type = assignmentState.team1[0] ? 'human' : 'ai';
    state.playerConfigs[0].team = 'home';
    state.playerConfigs[1].type = assignmentState.team2[0] ? 'human' : 'ai';
    state.playerConfigs[1].team = 'away';

    if (currentMode === '2v2') {
      if (!state.playerConfigs[2]) {
        state.playerConfigs.push({
          name: 'Player 3',
          type: assignmentState.team1[1] ? 'human' : 'ai',
          difficulty: 'medium',
          aggressiveness: 0.60,
          team: 'home',
          variant: 'classic',
          primaryColor: 0xf59e0b,
          cameraMode: 'chase',
          assistPreset: 'standard',
        });
      } else {
        state.playerConfigs[2].type = assignmentState.team1[1] ? 'human' : 'ai';
        state.playerConfigs[2].team = 'home';
      }

      if (!state.playerConfigs[3]) {
        state.playerConfigs.push({
          name: 'Player 4',
          type: assignmentState.team2[1] ? 'human' : 'ai',
          difficulty: 'medium',
          aggressiveness: 0.60,
          team: 'away',
          variant: 'classic',
          primaryColor: 0x06b6d4,
          cameraMode: 'chase',
          assistPreset: 'standard',
        });
      } else {
        state.playerConfigs[3].type = assignmentState.team2[1] ? 'human' : 'ai';
        state.playerConfigs[3].team = 'away';
      }
    } else {
      // 1v1 mode
      state.playerConfigs.length = 2;
    }
  }

  if (onProceedCallback) {
    onProceedCallback({
      mode: currentMode,
      assignments: assignmentState,
    });
  }
}
