/**
 * Module: ui/controllerDisconnectModal
 * Role: Mid-match controller disconnect pause and manual reassign overlay.
 * Frame Phase: UI Event / 50ms Polling (while paused during active match play).
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Queries and updates `inputRouter` mappings via exported helpers;
 *     `main.js` owns match pause (`loop.paused`) and bot/setup transitions.
 */

import { soundManager } from '../audio/soundManager.js';
import { createMenuPadTracker, MENU_PAD } from '../input/menuPads.js';
import {
  getDisconnectedMappedSlots,
  getUnclaimedConnectedPads,
  getExplicitDeviceMappings,
  reassignSlotToPad,
  reassignSlotToKeyboard,
  refreshDisconnectRouting,
  exitGamePointerLock,
} from '../input/inputRouter.js';
import { getPlayerSlotTheme } from '../features/ui/mainMenu/constants.js';

let overlayEl = null;
let slotBadgeEl = null;
let expectedDeviceEl = null;
let statusBannerEl = null;
let actionsContainerEl = null;

let isOpen = false;
let pollHandle = null;
let keydownCleanup = null;
let focusIndex = 0;
let actionButtons = [];
let lastSignature = '';
let stickyTargetSlot = 0;
let wasDisconnected = false;

const padTracker = createMenuPadTracker();

let callbacks = {
  onResume: null,
  onSwitchToBot: null,
  onReturnToSetup: null,
};

function shortPadLabel(pad) {
  const raw = (pad?.id || '').split('(')[0].trim();
  if (!raw) return 'USB Controller';
  return raw.length > 26 ? raw.slice(0, 26) : raw;
}

function getFreeKeysets(excludeSlot) {
  const mappings = getExplicitDeviceMappings();
  let kb1Taken = false;
  let kb2Taken = false;
  if (mappings) {
    for (let s = 0; s < 4; s++) {
      if (s === excludeSlot) continue;
      const m = mappings[s];
      if (m && m.type === 'keyboard') {
        if (m.keyId === 'kb2') kb2Taken = true;
        else kb1Taken = true;
      }
    }
  }
  const free = [];
  if (!kb1Taken) free.push({ keyId: 'kb1', label: 'KEYBOARD 1 (WASD + MOUSE)' });
  if (!kb2Taken) free.push({ keyId: 'kb2', label: 'KEYBOARD 2 (IJKL + ARROWS)' });
  return free;
}

function resolveAndMaybeClose() {
  const remaining = refreshDisconnectRouting();
  if (remaining.length === 0) {
    hideControllerDisconnectModal();
    callbacks.onResume?.();
    return true;
  }
  renderModalActions(true);
  return false;
}

function applyFocusStyles() {
  for (let i = 0; i < actionButtons.length; i++) {
    const btn = actionButtons[i];
    if (!btn) continue;
    const isFocused = i === focusIndex && !btn.disabled;
    btn.style.outline = isFocused ? '2px solid #00e5ff' : 'none';
    btn.style.outlineOffset = isFocused ? '2px' : '0px';
    btn.style.boxShadow = isFocused ? '0 0 14px rgba(0, 229, 255, 0.45)' : 'none';
  }
}

function moveFocus(delta) {
  if (actionButtons.length === 0) return;
  let next = focusIndex;
  for (let step = 0; step < actionButtons.length; step++) {
    next = (next + delta + actionButtons.length) % actionButtons.length;
    if (!actionButtons[next]?.disabled) {
      focusIndex = next;
      soundManager.playTone(440, 0.04, 'sine', 0.14);
      applyFocusStyles();
      return;
    }
  }
}

function activateFocused() {
  const btn = actionButtons[focusIndex];
  if (btn && !btn.disabled) {
    btn.click();
  }
}

function makeActionBtn(id, label, sub, accentHex, bgColor, onClick) {
  const btn = document.createElement('button');
  btn.id = id;
  btn.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1.5px solid ${accentHex};
    background: ${bgColor};
    color: #ffffff;
    font-family: inherit;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.05em;
    cursor: pointer;
    text-align: left;
    box-sizing: border-box;
    transition: all 0.12s ease;
  `;
  btn.innerHTML = `
    <span>${label}</span>
    <span style="font-size:10px;color:#cbd5e1;font-weight:700;">${sub}</span>
  `;
  btn.onclick = onClick;
  return btn;
}

function renderModalActions(force = false) {
  if (!overlayEl || !actionsContainerEl) return;
  const disconnected = getDisconnectedMappedSlots();
  const unclaimed = getUnclaimedConnectedPads();
  const targetSlot = disconnected.length > 0 ? disconnected[0] : stickyTargetSlot;
  if (disconnected.length > 0) stickyTargetSlot = targetSlot;

  const freeKeysets = getFreeKeysets(targetSlot);
  const sig = `${disconnected.join(',')}|${unclaimed.map((p) => `${p.index}:${p.id}`).join(',')}|${freeKeysets.map((k) => k.keyId).join(',')}|${targetSlot}`;
  if (!force && sig === lastSignature) return;
  lastSignature = sig;

  const slotTheme = getPlayerSlotTheme(targetSlot);
  const mappings = getExplicitDeviceMappings();
  const expected = mappings?.[targetSlot];
  const expectedName = expected?.name || `Gamepad ${(expected?.padIndex ?? 0) + 1}`;

  if (slotBadgeEl) {
    slotBadgeEl.textContent = `P${targetSlot + 1} CONTROLLER DISCONNECTED`;
    slotBadgeEl.style.color = slotTheme.hex;
    slotBadgeEl.style.borderColor = slotTheme.hex;
    slotBadgeEl.style.background = slotTheme.bg;
  }
  if (expectedDeviceEl) {
    expectedDeviceEl.textContent = disconnected.length > 0
      ? `EXPECTED DEVICE: ${expectedName}`
      : `P${targetSlot + 1} CONTROLLER READY`;
  }
  if (statusBannerEl) {
    if (disconnected.length > 0) {
      statusBannerEl.textContent = `WAITING FOR P${targetSlot + 1} CONTROLLER: PLUG IN ${expectedName.toUpperCase()} TO RECONNECT OR PICK AN OPTION BELOW`;
      statusBannerEl.style.color = '#fbbf24';
      statusBannerEl.style.borderColor = 'rgba(251, 191, 36, 0.45)';
      statusBannerEl.style.background = 'rgba(251, 191, 36, 0.10)';
    } else {
      statusBannerEl.textContent = `CONTROLLER RECONNECTED: P${targetSlot + 1} IS BACK ONLINE`;
      statusBannerEl.style.color = '#4ade80';
      statusBannerEl.style.borderColor = 'rgba(16, 185, 129, 0.55)';
      statusBannerEl.style.background = 'rgba(16, 185, 129, 0.14)';
    }
  }

  actionsContainerEl.innerHTML = '';
  actionButtons = [];

  // 1. Reconnect option
  if (disconnected.length === 0) {
    const resumeBtn = makeActionBtn(
      'disconnect-btn-resume',
      'CONTROLLER RECONNECTED: RESUME MATCH',
      'A / ENTER',
      '#10b981',
      'rgba(16, 185, 129, 0.25)',
      () => {
        soundManager.playTone(740, 0.08, 'sine', 0.22);
        hideControllerDisconnectModal();
        callbacks.onResume?.();
      },
    );
    actionButtons.push(resumeBtn);
    actionsContainerEl.appendChild(resumeBtn);
  } else {
    const waitBtn = makeActionBtn(
      'disconnect-btn-wait',
      `RECONNECT P${targetSlot + 1} CONTROLLER (${expectedName.toUpperCase()})`,
      'PLUG IN TO RESUME',
      'rgba(251, 191, 36, 0.45)',
      'rgba(251, 191, 36, 0.08)',
      () => {},
    );
    waitBtn.disabled = true;
    waitBtn.style.cursor = 'default';
    waitBtn.style.opacity = '0.85';
    actionButtons.push(waitBtn);
    actionsContainerEl.appendChild(waitBtn);
  }

  // 2. Assign another plugged-in pad
  for (let i = 0; i < unclaimed.length; i++) {
    const padInfo = unclaimed[i];
    const padBtn = makeActionBtn(
      `disconnect-btn-pad-${padInfo.index}`,
      `ASSIGN PAD ${padInfo.index + 1} (${shortPadLabel(padInfo)}) TO P${targetSlot + 1}`,
      'OR PRESS A / START ON PAD',
      '#00e5ff',
      'rgba(0, 229, 255, 0.14)',
      () => {
        soundManager.playTone(660, 0.06, 'sine', 0.20);
        reassignSlotToPad(targetSlot, padInfo.index);
        resolveAndMaybeClose();
      },
    );
    actionButtons.push(padBtn);
    actionsContainerEl.appendChild(padBtn);
  }

  // 3. Switch to Keyboard / Mouse
  if (freeKeysets.length > 0) {
    for (let i = 0; i < freeKeysets.length; i++) {
      const k = freeKeysets[i];
      const kbBtn = makeActionBtn(
        `disconnect-btn-${k.keyId}`,
        `SWITCH P${targetSlot + 1} TO ${k.label}`,
        'KEYBOARD',
        '#38bdf8',
        'rgba(56, 189, 248, 0.14)',
        () => {
          soundManager.playTone(620, 0.06, 'sine', 0.20);
          reassignSlotToKeyboard(targetSlot, k.keyId);
          resolveAndMaybeClose();
        },
      );
      actionButtons.push(kbBtn);
      actionsContainerEl.appendChild(kbBtn);
    }
  } else {
    const noKbBtn = makeActionBtn(
      'disconnect-btn-kb-none',
      'KEYBOARDS IN USE BY OTHER SLOTS',
      'UNAVAILABLE',
      'rgba(148, 163, 184, 0.35)',
      'rgba(255, 255, 255, 0.04)',
      () => {},
    );
    noKbBtn.disabled = true;
    noKbBtn.style.cursor = 'default';
    noKbBtn.style.opacity = '0.6';
    actionButtons.push(noKbBtn);
    actionsContainerEl.appendChild(noKbBtn);
  }

  // 4. Switch slot to AI Bot
  const aiBtn = makeActionBtn(
    'disconnect-btn-ai',
    `SWITCH P${targetSlot + 1} TO AI BOT`,
    'CPU SUB',
    '#fbb417',
    'rgba(251, 180, 23, 0.14)',
    () => {
      soundManager.playTone(540, 0.06, 'sine', 0.18);
      callbacks.onSwitchToBot?.(targetSlot);
      resolveAndMaybeClose();
    },
  );
  actionButtons.push(aiBtn);
  actionsContainerEl.appendChild(aiBtn);

  // 5. Return to Setup
  const setupBtn = makeActionBtn(
    'disconnect-btn-setup',
    'RETURN TO CONTROLLER SETUP',
    'PICK SIDES',
    '#ff2e55',
    'rgba(255, 46, 85, 0.14)',
    () => {
      soundManager.playTone(360, 0.08, 'sine', 0.18);
      hideControllerDisconnectModal();
      callbacks.onReturnToSetup?.();
    },
  );
  actionButtons.push(setupBtn);
  actionsContainerEl.appendChild(setupBtn);

  // Auto-focus Resume when a disconnected controller reconnects; otherwise pick first enabled button
  const justReconnected = wasDisconnected && disconnected.length === 0 && actionButtons[0]?.id === 'disconnect-btn-resume';
  wasDisconnected = disconnected.length > 0;
  if (justReconnected) {
    focusIndex = 0;
  } else if (focusIndex >= actionButtons.length || actionButtons[focusIndex]?.disabled) {
    focusIndex = 0;
    for (let i = 0; i < actionButtons.length; i++) {
      if (!actionButtons[i]?.disabled) {
        focusIndex = i;
        break;
      }
    }
  }
  applyFocusStyles();
}

function isPadUnclaimedInMappings(padIndex, unclaimed) {
  for (let i = 0; i < unclaimed.length; i++) {
    if (unclaimed[i].index === padIndex) return true;
  }
  return false;
}

function startPolling() {
  stopPolling();

  const onKeyDown = (e) => {
    if (!isOpen) return;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      moveFocus(-1);
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault();
      moveFocus(1);
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      activateFocused();
    }
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('keydown', onKeyDown);
    keydownCleanup = () => window.removeEventListener('keydown', onKeyDown);
  }

  padTracker.reset();
  pollHandle = setInterval(() => {
    if (!isOpen) {
      stopPolling();
      return;
    }
    refreshDisconnectRouting();
    const disconnected = getDisconnectedMappedSlots();
    const unclaimed = getUnclaimedConnectedPads();

    const pads = [];
    if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
      const raw = navigator.getGamepads() || [];
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] && raw[i].connected !== false) pads.push(raw[i]);
      }
    }
    padTracker.update(pads);

    renderModalActions(false);

    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad) continue;
      const e = padTracker.pressed(pad);
      if (!e) continue;

      // Direct unclaimed-pad hot-swap on A or Start press
      if (disconnected.length > 0 && isPadUnclaimedInMappings(pad.index, unclaimed) && (e & (MENU_PAD.a | MENU_PAD.start))) {
        const targetSlot = disconnected[0];
        soundManager.playTone(680, 0.07, 'sine', 0.22);
        reassignSlotToPad(targetSlot, pad.index);
        if (resolveAndMaybeClose()) return;
        continue;
      }

      if (e & MENU_PAD.up) moveFocus(-1);
      if (e & MENU_PAD.down) moveFocus(1);
      if (e & (MENU_PAD.a | MENU_PAD.start)) {
        activateFocused();
        if (!isOpen) return;
      }
    }
  }, 50);
}

function stopPolling() {
  if (keydownCleanup) {
    keydownCleanup();
    keydownCleanup = null;
  }
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

export function initControllerDisconnectModal(cbs = {}) {
  Object.assign(callbacks, cbs);
  if (overlayEl || typeof document === 'undefined') return;

  overlayEl = document.createElement('div');
  overlayEl.id = 'controller-disconnect-overlay';
  overlayEl.style.cssText = `
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(4, 7, 12, 0.84);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 950;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: #f8fafc;
    user-select: none;
    padding: 20px;
    box-sizing: border-box;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width: 100%;
    max-width: 560px;
    background: rgba(11, 17, 26, 0.96);
    border: 1.5px solid rgba(251, 191, 36, 0.55);
    border-top: 4px solid #fbbf24;
    border-radius: 12px;
    padding: 22px 26px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85), 0 0 28px rgba(251, 191, 36, 0.18);
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-sizing: border-box;
  `;

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;flex-direction:column;gap:6px;border-bottom:1px solid rgba(255,255,255,0.12);padding-bottom:12px;';

  slotBadgeEl = document.createElement('div');
  slotBadgeEl.id = 'disconnect-slot-badge';
  slotBadgeEl.style.cssText = 'display:inline-block;align-self:flex-start;padding:3px 10px;border-radius:5px;border:1px solid #00e5ff;font-size:12px;font-weight:900;letter-spacing:0.08em;';
  slotBadgeEl.textContent = 'P1 CONTROLLER DISCONNECTED';

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-size:18px;font-weight:900;letter-spacing:0.08em;color:#ffffff;';
  titleEl.textContent = 'MATCH PAUSED: RECONNECT OR REASSIGN';

  expectedDeviceEl = document.createElement('div');
  expectedDeviceEl.id = 'disconnect-expected-device';
  expectedDeviceEl.style.cssText = 'font-size:11px;font-weight:700;color:#94a3b8;';
  expectedDeviceEl.textContent = 'EXPECTED DEVICE: GAMEPAD';

  header.append(slotBadgeEl, titleEl, expectedDeviceEl);

  statusBannerEl = document.createElement('div');
  statusBannerEl.id = 'disconnect-status-banner';
  statusBannerEl.style.cssText = 'padding:9px 12px;border-radius:8px;border:1px solid rgba(251,191,36,0.45);background:rgba(251,191,36,0.10);color:#fbbf24;font-size:11px;font-weight:800;letter-spacing:0.04em;';

  actionsContainerEl = document.createElement('div');
  actionsContainerEl.id = 'disconnect-modal-actions';
  actionsContainerEl.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

  const footerHint = document.createElement('div');
  footerHint.style.cssText = 'font-size:10px;color:#94a3b8;text-align:center;font-weight:700;letter-spacing:0.04em;';
  footerHint.textContent = 'USE UP / DOWN + ENTER OR ANY CONNECTED CONTROLLER · UNCLAIMED PAD: PRESS A / START TO CLAIM';

  card.append(header, statusBannerEl, actionsContainerEl, footerHint);
  overlayEl.appendChild(card);
  document.body?.appendChild(overlayEl);
}

export function showControllerDisconnectModal(disconnectedSlots = null) {
  if (!overlayEl) initControllerDisconnectModal(callbacks);
  if (Array.isArray(disconnectedSlots) && disconnectedSlots.length > 0) {
    stickyTargetSlot = disconnectedSlots[0];
  } else {
    const current = getDisconnectedMappedSlots();
    if (current.length > 0) stickyTargetSlot = current[0];
  }
  isOpen = true;
  lastSignature = '';
  focusIndex = 0;
  wasDisconnected = Array.isArray(disconnectedSlots)
    ? disconnectedSlots.length > 0
    : getDisconnectedMappedSlots().length > 0;
  exitGamePointerLock();
  if (overlayEl) overlayEl.style.display = 'flex';
  renderModalActions(true);
  startPolling();
}

export function hideControllerDisconnectModal() {
  isOpen = false;
  lastSignature = '';
  wasDisconnected = false;
  stopPolling();
  if (overlayEl) overlayEl.style.display = 'none';
}

export function isDisconnectModalOpen() {
  return isOpen;
}
