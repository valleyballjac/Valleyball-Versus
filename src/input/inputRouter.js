import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { showToast } from '../ui/mainMenu.js';
import { isInGameMenuOpen } from '../ui/inGameMenu.js';

/**
 * Input Router for Valleyball Versus.
 *
 * Routes keyboard and gamepads to athlete slots (1 to 4 athletes).
 * Supports:
 * - 2+ Gamepads: P1 = Gamepad 0, P2 = Gamepad 1 (with P1 keyboard fallback)
 * - 1 Gamepad: P1 = Keyboard WASD, P2 = Gamepad 0
 * - 0 Gamepads: P1 = Keyboard WASD, P2 = Secondary Keyboard (IJKL)
 * - Practice Mode: P1 gets both Gamepad 0 and Keyboard WASD seamlessly
 *
 * LAW 6 — Input is sampled once per rendered frame from loop.onFrame, and read only
 * inside fixedUpdate.
 */

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TRIGGER_THRESHOLD = 0.5;

const P1_KEYS = {
  moveUp: 'KeyW',
  moveLeft: 'KeyA',
  moveDown: 'KeyS',
  moveRight: 'KeyD',
  sprint: ['ShiftLeft'],
  slide: ['KeyC'],
  dive: ['KeyQ'],
  jump: 'Space',
  cut: ['KeyV'],
  volley: ['KeyE'],
  spike: ['KeyR'],
  ballReset: ['KeyB'],
};

const P2_KEYS = {
  moveUp: 'KeyI',
  moveLeft: 'KeyJ',
  moveDown: 'KeyK',
  moveRight: 'KeyL',
  sprint: ['ShiftRight', 'Slash'],
  slide: ['KeyO'],
  dive: ['KeyU'],
  jump: 'Enter',
  cut: ['KeyN'],
  volley: ['KeyP'],
  spike: ['BracketLeft', 'KeyY'],
  ballReset: ['KeyM'],
};

const GAMEPAD_BUTTONS = {
  jump: 0,        // A / Cross
  volley: 1,      // B / Circle (East)
  dive: 2,        // X / Square (West)
  spike: 3,       // Y / Triangle (North)
  cut: 4,         // LB / L1 (Left Shoulder)
  sprint: 6,      // LT / Left Trigger
  slide: 7,       // RT / Right Trigger
  ballReset: 8,   // Select / Back / View
  pauseMenu: 9,   // Start / Options
};

function padDown(pad, index) {
  if (!pad || !pad.buttons) return false;
  const button = pad.buttons[index];
  return !!(button && (button.pressed || button.value > TRIGGER_THRESHOLD));
}

function applyDeadzone(x, y, deadzone) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadzone) return { x: 0, y: 0 };
  const scaled = (magnitude - deadzone) / (1 - deadzone) / magnitude;
  return { x: x * scaled, y: y * scaled };
}

export function createInputSlot() {
  return {
    moveX: 0,
    moveZ: 0,
    sprintHeld: false,
    slideHeld: false,
    jumpQueued: false,
    diveQueued: false,
    cutQueued: false,
    volleyQueued: false,
    spikeQueued: false,
    ballResetQueued: false,
    moveWorld: new THREE.Vector3(),
    lookX: 0,
    lookY: 0,
    hasAim: false,
    aimYaw: 0,
    cameraYaw: 0,
  };
}

const heldKeys = new Set();
let installed = false;
const cameraCyclesQueued = [false, false, false, false];
let menuToggleQueued = false;

// Mouse drag state
let dragging = false;
let dragPointerId = -1;
let accumDX = 0;
let accumDY = 0;
let _mouseDX = 0;
let _mouseDY = 0;

export function getMouseDeltas() {
  return { dx: _mouseDX, dy: _mouseDY };
}

// Up to 4 athlete input slots
const slots = [
  createInputSlot(),
  createInputSlot(),
  createInputSlot(),
  createInputSlot(),
];

// Previous button states for edge-detection per pad
const padPrevStates = new Map();

function getPadPrev(padIndex) {
  if (!padPrevStates.has(padIndex)) {
    padPrevStates.set(padIndex, {
      jump: false,
      dive: false,
      cut: false,
      volley: false,
      spike: false,
      ballReset: false,
      pauseMenu: false,
      dpad: false,
    });
  }
  return padPrevStates.get(padIndex);
}

function isTextEntry(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

let currentBotSlots = [];

function onKeyDown(event) {
  if (isTextEntry(event.target)) return;
  heldKeys.add(event.code);

  if (!event.repeat) {
    // P1 edge keys (only if P1 is not a bot)
    if (!currentBotSlots.includes(0)) {
      if (event.code === P1_KEYS.jump) slots[0].jumpQueued = true;
      if (P1_KEYS.dive.includes(event.code)) slots[0].diveQueued = true;
      if (P1_KEYS.cut.includes(event.code)) slots[0].cutQueued = true;
      if (P1_KEYS.volley.includes(event.code)) slots[0].volleyQueued = true;
      if (P1_KEYS.spike.includes(event.code)) slots[0].spikeQueued = true;
      if (P1_KEYS.ballReset.includes(event.code)) slots[0].ballResetQueued = true;
    }

    // P2 edge keys (only if P2 is not a bot)
    if (!currentBotSlots.includes(1)) {
      if (event.code === P2_KEYS.jump) slots[1].jumpQueued = true;
      if (P2_KEYS.dive.includes(event.code)) slots[1].diveQueued = true;
      if (P2_KEYS.cut.includes(event.code)) slots[1].cutQueued = true;
      if (P2_KEYS.volley.includes(event.code)) slots[1].volleyQueued = true;
      if (P2_KEYS.spike.includes(event.code)) slots[1].spikeQueued = true;
      if (P2_KEYS.ballReset.includes(event.code)) slots[1].ballResetQueued = true;
    }
  }

  // Tab cycles P1 camera
  if (event.code === 'Tab') {
    event.preventDefault();
    if (!event.repeat) cameraCyclesQueued[0] = true;
  }
  // ']' or '\' cycles P2 camera
  if (event.code === 'BracketRight' || event.code === 'Backslash') {
    event.preventDefault();
    if (!event.repeat) cameraCyclesQueued[1] = true;
  }

  if (event.code === 'Escape') {
    exitGamePointerLock();
  }
}

function onKeyUp(event) {
  heldKeys.delete(event.code);
}

function onBlur() {
  heldKeys.clear();
  padPrevStates.clear();
  dragging = false;
  dragPointerId = -1;
  accumDX = 0;
  accumDY = 0;
}

let isPointerLocked = false;
let inputSurface = null;

export function isInputPointerLocked() {
  return isPointerLocked;
}

export function requestGamePointerLock() {
  const target = inputSurface || document.body;
  if (target && typeof target.requestPointerLock === 'function') {
    try {
      const promise = target.requestPointerLock();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {});
      }
    } catch (_) {}
  }
}

export function exitGamePointerLock() {
  if (document.exitPointerLock && document.pointerLockElement) {
    document.exitPointerLock();
  }
}

function onPointerDown(event) {
  if (event.button === 0 && !isPointerLocked) {
    dragging = true;
    dragPointerId = event.pointerId;
    accumDX = 0;
    accumDY = 0;
  }
}

function onPointerMove(event) {
  if (isPointerLocked) return; // handled by window mousemove
  if (!dragging || event.pointerId !== dragPointerId) return;
  accumDX += event.movementX || 0;
  accumDY += event.movementY || 0;
}

function onPointerUp(event) {
  if (event.pointerId === dragPointerId) {
    dragging = false;
    dragPointerId = -1;
  }
}

export function initInputRouter(surface) {
  if (installed) return;
  installed = true;
  inputSurface = surface || window;

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = Boolean(document.pointerLockElement);
  });

  // Dedicated mousemove listener for Pointer Lock movement across browsers
  window.addEventListener('mousemove', (event) => {
    if (isPointerLocked) {
      accumDX += event.movementX || 0;
      accumDY += event.movementY || 0;
    }
  });

  // Clicking into gameplay requests pointer lock
  const target = surface || window;
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerUp);

  window.addEventListener('click', (e) => {
    if (isTextEntry(e.target)) return;
    if (e.target.closest && (e.target.closest('#main-menu-root') || e.target.closest('#in-game-menu-container') || e.target.closest('.how-to-play-modal') || e.target.closest('.victory-overlay'))) {
      return;
    }
    const isGameplay = window.__vb?.getGameState ? (window.__vb.getGameState() === 'match' || window.__vb.getGameState() === 'practice') : true;
    if (isGameplay && !isInGameMenuOpen() && !isPointerLocked) {
      requestGamePointerLock();
    }
  });

  // Mouse buttons for Player 1 strike actions
  window.addEventListener('mousedown', (event) => {
    if (isTextEntry(event.target)) return;
    const isGameplay = window.__vb?.getGameState ? (window.__vb.getGameState() === 'match' || window.__vb.getGameState() === 'practice') : true;
    if (!isGameplay || isInGameMenuOpen()) return;

    if (event.button === 0) {
      // Left click = Kick / Volley
      slots[0].volleyQueued = true;
    } else if (event.button === 2) {
      // Right click = Spike
      slots[0].spikeQueued = true;
    }
  });

  // Disable context menu so right click performs spike without browser menu
  window.addEventListener('contextmenu', (event) => {
    const isGameplay = window.__vb?.getGameState ? (window.__vb.getGameState() === 'match' || window.__vb.getGameState() === 'practice') : true;
    if (isGameplay) {
      event.preventDefault();
    }
  });

  // Gamepad hotplug notifications
  window.addEventListener('gamepadconnected', (e) => {
    const pad = e.gamepad;
    const name = pad?.id ? pad.id.split('(')[0].trim() : `Gamepad ${pad?.index ?? 0}`;
    showToast(`🎮 Controller Connected: ${name} (Slot P${(pad?.index ?? 0) + 1})`, 'info', 4000);
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    const pad = e.gamepad;
    showToast(`⚠️ Controller Disconnected: Slot P${(pad?.index ?? 0) + 1}`, 'warning', 4000);
  });
}

const _connectedGamepads = [];

function getConnectedGamepads() {
  _connectedGamepads.length = 0;
  if (typeof navigator.getGamepads !== 'function') return _connectedGamepads;
  const raw = navigator.getGamepads();
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] && raw[i].connected) _connectedGamepads.push(raw[i]);
  }
  return _connectedGamepads;
}

/**
 * Returns human-readable routing assignments for UI display.
 */
export function getControllerAssignments(athleteCount = 2, mode = 'match') {
  const pads = getConnectedGamepads();
  if (mode === 'practice' || athleteCount === 1) {
    return {
      p1: pads.length > 0 ? `Gamepad 1 (${pads[0].id.slice(0, 16)}...) + Keyboard WASD` : 'Keyboard WASD',
      p2: null,
    };
  }

  if (pads.length >= 2) {
    return {
      p1: `Gamepad 1 (${pads[0].id.slice(0, 14)}...) [WASD]`,
      p2: `Gamepad 2 (${pads[1].id.slice(0, 14)}...) [IJKL]`,
    };
  }

  if (pads.length === 1) {
    return {
      p1: `Gamepad 1 (${pads[0].id.slice(0, 14)}...) [WASD]`,
      p2: 'Secondary Keyboard (IJKL)',
    };
  }

  return {
    p1: 'Keyboard WASD',
    p2: 'Secondary Keyboard (IJKL)',
  };
}

const lastGoodYaw = [0, 0];

function getCamVectors(cam, slotIdx = 0) {
  if (!cam) return { yaw: lastGoodYaw[slotIdx] || 0, forward: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0), valid: false };
  const fwd = new THREE.Vector3();
  const rgt = new THREE.Vector3();
  cam.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() > 1e-8) {
    fwd.normalize();
    rgt.crossVectors(fwd, WORLD_UP).normalize();
    const yaw = Math.atan2(fwd.x, fwd.z);
    lastGoodYaw[slotIdx] = yaw;
    return { yaw, forward: fwd, right: rgt, valid: true };
  }
  return { yaw: lastGoodYaw[slotIdx] || 0, forward: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0), valid: false };
}

/**
 * Samples all inputs once per frame.
 * @param {THREE.Camera|THREE.Camera[]} cameras Single camera or array [cam1, cam2]
 * @param {number} athleteCount
 * @param {'practice' | 'match'} mode
 * @param {number[]} botSlots  slot indices controlled by bots (skip device polling)
 */
export function sampleAllInputs(cameras, athleteCount = 2, mode = 'match', botSlots = []) {
  currentBotSlots = botSlots;
  // Hand over accumulated mouse deltas
  _mouseDX = accumDX;
  _mouseDY = accumDY;
  accumDX = 0;
  accumDY = 0;

  // Resolve camera(s)
  const isCamArray = Array.isArray(cameras);
  const p1Cam = isCamArray ? (cameras[0]?.camera || cameras[0]) : (cameras?.camera || cameras);
  const p2Cam = isCamArray ? (cameras[1]?.camera || cameras[1] || p1Cam) : p1Cam;

  const cam1Data = getCamVectors(p1Cam, 0);
  const cam2Data = getCamVectors(p2Cam, 1);

  const pads = getConnectedGamepads();

  // Determine gamepad routing
  let p1Pad = null;
  let p2Pad = null;

  if (mode === 'practice' || athleteCount === 1) {
    p1Pad = !botSlots.includes(0) ? pads[0] || null : null;
  } else {
    // Route gamepads to humans in order
    let padIdx = 0;
    if (!botSlots.includes(0) && padIdx < pads.length) {
      p1Pad = pads[padIdx++];
    }
    if (!botSlots.includes(1) && padIdx < pads.length) {
      p2Pad = pads[padIdx++];
    }
  }

  // --- SLOT 0 (P1) ---
  if (!botSlots.includes(0)) {
    const slot = slots[0];
    let x = (heldKeys.has(P1_KEYS.moveRight) ? 1 : 0) - (heldKeys.has(P1_KEYS.moveLeft) ? 1 : 0);
    let z = (heldKeys.has(P1_KEYS.moveUp) ? 1 : 0) - (heldKeys.has(P1_KEYS.moveDown) ? 1 : 0);
    let sprintHeld = P1_KEYS.sprint.some((k) => heldKeys.has(k));
    let slideHeld = P1_KEYS.slide.some((k) => heldKeys.has(k));
    let lookX = 0;
    let lookY = 0;

    if (p1Pad) {
      const stick = applyDeadzone(p1Pad.axes[0] || 0, p1Pad.axes[1] || 0, TUNING.motor.stickDeadzone);
      if (stick.x !== 0 || stick.y !== 0) {
        x = stick.x;
        z = -stick.y;
      }

      const look = applyDeadzone(p1Pad.axes[2] || 0, p1Pad.axes[3] || 0, TUNING.motor.stickDeadzone);
      lookX = look.x;
      lookY = look.y;

      if (padDown(p1Pad, GAMEPAD_BUTTONS.sprint)) sprintHeld = true;
      if (padDown(p1Pad, GAMEPAD_BUTTONS.slide)) slideHeld = true;

      const prev = getPadPrev(0);
      const jumpDown = padDown(p1Pad, GAMEPAD_BUTTONS.jump);
      if (jumpDown && !prev.jump) slot.jumpQueued = true;
      prev.jump = jumpDown;

      const diveDown = padDown(p1Pad, GAMEPAD_BUTTONS.dive);
      if (diveDown && !prev.dive) slot.diveQueued = true;
      prev.dive = diveDown;

      const cutDown = padDown(p1Pad, GAMEPAD_BUTTONS.cut);
      if (cutDown && !prev.cut) slot.cutQueued = true;
      prev.cut = cutDown;

      const volleyDown = padDown(p1Pad, GAMEPAD_BUTTONS.volley);
      if (volleyDown && !prev.volley) slot.volleyQueued = true;
      prev.volley = volleyDown;

      const spikeDown = padDown(p1Pad, GAMEPAD_BUTTONS.spike);
      if (spikeDown && !prev.spike) slot.spikeQueued = true;
      prev.spike = spikeDown;

      const pauseDown = padDown(p1Pad, GAMEPAD_BUTTONS.pauseMenu);
      if (pauseDown && !prev.pauseMenu) {
        if (!isInGameMenuOpen()) {
          menuToggleQueued = true;
        }
      }
      prev.pauseMenu = pauseDown;

      const ballResetDown = padDown(p1Pad, GAMEPAD_BUTTONS.ballReset);
      if (ballResetDown && !prev.ballReset) {
        if (mode === 'practice') {
          slot.ballResetQueued = true;
        }
      }
      prev.ballReset = ballResetDown;

      const dpadDown = padDown(p1Pad, 12) || padDown(p1Pad, 13) || padDown(p1Pad, 14) || padDown(p1Pad, 15);
      if (dpadDown && !prev.dpad) cameraCyclesQueued[0] = true;
      prev.dpad = dpadDown;
    } else if (mode === 'practice' || athleteCount === 1 || p2Pad) {
      // Secondary keyboard camera / aim control: Arrow keys
      lookX = (heldKeys.has('ArrowRight') ? 1 : 0) - (heldKeys.has('ArrowLeft') ? 1 : 0);
      lookY = (heldKeys.has('ArrowUp') ? 1 : 0) - (heldKeys.has('ArrowDown') ? 1 : 0);
    }

    const lookMag = Math.hypot(lookX, lookY);
    let hasAim = false;
    let aimYaw = 0;
    if (lookMag > 0.15 && cam1Data.valid) {
      hasAim = true;
      const aimWorldX = cam1Data.right.x * lookX + cam1Data.forward.x * (-lookY);
      const aimWorldZ = cam1Data.right.z * lookX + cam1Data.forward.z * (-lookY);
      aimYaw = Math.atan2(aimWorldX, aimWorldZ);
    }

    const mag = Math.hypot(x, z);
    if (mag > 1) { x /= mag; z /= mag; }

    slot.moveX = x;
    slot.moveZ = z;
    slot.sprintHeld = sprintHeld;
    slot.slideHeld = slideHeld;
    slot.lookX = lookX;
    slot.lookY = lookY;
    slot.hasAim = hasAim;
    slot.aimYaw = aimYaw;
    slot.cameraYaw = cam1Data.yaw;

    if (cam1Data.valid) {
      slot.moveWorld.set(0, 0, 0)
        .addScaledVector(cam1Data.right, x)
        .addScaledVector(cam1Data.forward, z);
    } else {
      slot.moveWorld.set(0, 0, 0);
    }
  }

  // --- SLOT 1 (P2) ---
  if (athleteCount > 1 && !botSlots.includes(1)) {
    const slot = slots[1];
    let x = (heldKeys.has(P2_KEYS.moveRight) ? 1 : 0) - (heldKeys.has(P2_KEYS.moveLeft) ? 1 : 0);
    let z = (heldKeys.has(P2_KEYS.moveUp) ? 1 : 0) - (heldKeys.has(P2_KEYS.moveDown) ? 1 : 0);
    let sprintHeld = P2_KEYS.sprint.some((k) => heldKeys.has(k));
    let slideHeld = P2_KEYS.slide.some((k) => heldKeys.has(k));
    let lookX = 0;
    let lookY = 0;

    if (p2Pad) {
      const stick = applyDeadzone(p2Pad.axes[0] || 0, p2Pad.axes[1] || 0, TUNING.motor.stickDeadzone);
      if (stick.x !== 0 || stick.y !== 0) {
        x = stick.x;
        z = -stick.y;
      }

      const look = applyDeadzone(p2Pad.axes[2] || 0, p2Pad.axes[3] || 0, TUNING.motor.stickDeadzone);
      lookX = look.x;
      lookY = look.y;

      if (padDown(p2Pad, GAMEPAD_BUTTONS.sprint)) sprintHeld = true;
      if (padDown(p2Pad, GAMEPAD_BUTTONS.slide)) slideHeld = true;

      const prev = getPadPrev(1);
      const jumpDown = padDown(p2Pad, GAMEPAD_BUTTONS.jump);
      if (jumpDown && !prev.jump) slot.jumpQueued = true;
      prev.jump = jumpDown;

      const diveDown = padDown(p2Pad, GAMEPAD_BUTTONS.dive);
      if (diveDown && !prev.dive) slot.diveQueued = true;
      prev.dive = diveDown;

      const cutDown = padDown(p2Pad, GAMEPAD_BUTTONS.cut);
      if (cutDown && !prev.cut) slot.cutQueued = true;
      prev.cut = cutDown;

      const volleyDown = padDown(p2Pad, GAMEPAD_BUTTONS.volley);
      if (volleyDown && !prev.volley) slot.volleyQueued = true;
      prev.volley = volleyDown;

      const spikeDown = padDown(p2Pad, GAMEPAD_BUTTONS.spike);
      if (spikeDown && !prev.spike) slot.spikeQueued = true;
      prev.spike = spikeDown;

      const pauseDown = padDown(p2Pad, GAMEPAD_BUTTONS.pauseMenu);
      if (pauseDown && !prev.pauseMenu) {
        if (!isInGameMenuOpen()) {
          menuToggleQueued = true;
        }
      }
      prev.pauseMenu = pauseDown;

      const ballResetDown = padDown(p2Pad, GAMEPAD_BUTTONS.ballReset);
      if (ballResetDown && !prev.ballReset) {
        if (mode === 'practice') {
          slot.ballResetQueued = true;
        }
      }
      prev.ballReset = ballResetDown;

      const dpadDown = padDown(p2Pad, 12) || padDown(p2Pad, 13) || padDown(p2Pad, 14) || padDown(p2Pad, 15);
      if (dpadDown && !prev.dpad) cameraCyclesQueued[1] = true;
      prev.dpad = dpadDown;
    } else {
      // Secondary keyboard camera control: Arrow keys
      lookX = (heldKeys.has('ArrowRight') ? 1 : 0) - (heldKeys.has('ArrowLeft') ? 1 : 0);
      lookY = (heldKeys.has('ArrowUp') ? 1 : 0) - (heldKeys.has('ArrowDown') ? 1 : 0);
    }

    const lookMag = Math.hypot(lookX, lookY);
    let hasAim = false;
    let aimYaw = 0;
    if (lookMag > 0.15 && cam2Data.valid) {
      hasAim = true;
      const aimWorldX = cam2Data.right.x * lookX + cam2Data.forward.x * (-lookY);
      const aimWorldZ = cam2Data.right.z * lookX + cam2Data.forward.z * (-lookY);
      aimYaw = Math.atan2(aimWorldX, aimWorldZ);
    }

    const mag = Math.hypot(x, z);
    if (mag > 1) { x /= mag; z /= mag; }

    slot.moveX = x;
    slot.moveZ = z;
    slot.sprintHeld = sprintHeld;
    slot.slideHeld = slideHeld;
    slot.lookX = lookX;
    slot.lookY = lookY;
    slot.hasAim = hasAim;
    slot.aimYaw = aimYaw;
    slot.cameraYaw = cam2Data.yaw;

    if (cam2Data.valid) {
      slot.moveWorld.set(0, 0, 0)
        .addScaledVector(cam2Data.right, x)
        .addScaledVector(cam2Data.forward, z);
    } else {
      slot.moveWorld.set(0, 0, 0);
    }
  }
}

export function getInputSlot(index) {
  return slots[index] || slots[0];
}

export function consumeAthleteJump(index) {
  const slot = slots[index] || slots[0];
  const q = slot.jumpQueued;
  slot.jumpQueued = false;
  return q;
}

export function consumeAthleteDive(index) {
  const slot = slots[index] || slots[0];
  const q = slot.diveQueued;
  slot.diveQueued = false;
  return q;
}

export function consumeAthleteCut(index) {
  const slot = slots[index] || slots[0];
  const q = slot.cutQueued;
  slot.cutQueued = false;
  return q;
}


export function consumeAthleteVolley(index) {
  const slot = slots[index] || slots[0];
  const q = slot.volleyQueued;
  slot.volleyQueued = false;
  return q;
}

export function consumeAthleteSpike(index) {
  const slot = slots[index] || slots[0];
  const q = slot.spikeQueued;
  slot.spikeQueued = false;
  return q;
}

export function consumeAthleteBallReset(index) {
  const slot = slots[index] || slots[0];
  const q = slot.ballResetQueued;
  slot.ballResetQueued = false;
  return q;
}

export function consumeCameraCycle(playerIndex = 0) {
  const q = cameraCyclesQueued[playerIndex] || false;
  cameraCyclesQueued[playerIndex] = false;
  return q;
}

export function consumeMenuToggle() {
  const q = menuToggleQueued;
  menuToggleQueued = false;
  return q;
}

// ═══ BOT INJECTION API ═══
// Used by src/ai/botController.js to drive synthetic input into a slot.

/**
 * Returns the raw input slot for bot controllers to write into directly.
 * The bot writes moveWorld, moveX, moveZ, sprintHeld, and action queues.
 *
 * @param {number} index slot index (0-3)
 * @returns {object} the input slot
 */
export function getBotSlot(index) {
  return slots[index] || slots[0];
}

/**
 * Queues a discrete action trigger for a bot-controlled slot.
 *
 * @param {number} index slot index
 * @param {string} action 'jump' | 'dive' | 'volley' | 'spike' | 'ballReset'
 */
export function queueBotAction(index, action) {
  const slot = slots[index] || slots[0];
  if (action === 'jump') slot.jumpQueued = true;
  if (action === 'dive') slot.diveQueued = true;
  if (action === 'cut') slot.cutQueued = true;
  if (action === 'volley') slot.volleyQueued = true;
  if (action === 'spike') slot.spikeQueued = true;
  if (action === 'ballReset') slot.ballResetQueued = true;
}

/**
 * Triggers physical vibration actuator (dual-rumble) on the gamepad assigned to an athlete slot.
 *
 * @param {number} slotIndex 0 (P1) or 1 (P2)
 * @param {object} options
 * @param {number} [options.weakMagnitude=0.3] High-frequency motor intensity (0.0 to 1.0)
 * @param {number} [options.strongMagnitude=0.0] Low-frequency motor intensity (0.0 to 1.0)
 * @param {number} [options.duration=80] Vibration duration in milliseconds
 */
export function triggerHaptic(slotIndex = 0, { weakMagnitude = 0.3, strongMagnitude = 0.0, duration = 80 } = {}) {
  if (TUNING.input && TUNING.input.vibrationEnabled === false) return;
  const pads = getConnectedGamepads();
  if (!pads || pads.length === 0) return;
  const pad = pads[slotIndex] || (slotIndex === 0 ? pads[0] : null);
  if (!pad || !pad.vibrationActuator) return;

  try {
    if (typeof pad.vibrationActuator.playEffect === 'function') {
      pad.vibrationActuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: Math.max(10, Math.min(1000, duration)),
        weakMagnitude: Math.max(0, Math.min(1, weakMagnitude)),
        strongMagnitude: Math.max(0, Math.min(1, strongMagnitude)),
      }).catch(() => {});
    }
  } catch (err) {
    // Ignore unsupported browser edge cases
  }
}

export function setVibrationEnabled(enabled) {
  if (!TUNING.input) TUNING.input = {};
  TUNING.input.vibrationEnabled = Boolean(enabled);
}

export function isVibrationEnabled() {
  return TUNING.input?.vibrationEnabled ?? true;
}



