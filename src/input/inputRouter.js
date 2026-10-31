import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { showToast } from '../ui/mainMenu.js';
import { isInGameMenuOpen } from '../ui/inGameMenu.js';

/**
 * Input Router for Valleyball Versus.
 *
 * Routes keyboard and gamepads to athlete slots (1 to 4 athletes).
 * Supports:
 * - Assignment-screen mappings: each pad and each keyboard keyset (WASD + mouse,
 *   IJKL) drives exactly the slot it was assigned to. An unassigned keyset keeps
 *   its default slot (WASD -> P1, IJKL -> P2).
 * - No mappings: gamepads go to human slots in connection order; WASD -> P1, IJKL -> P2
 * - Practice Mode: P1 gets both Gamepad 0 and Keyboard WASD seamlessly (mappings ignored)
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
  cut: ['KeyV', 'KeyF'],
  // Held defence: a pose overlay only. It never gates movement or motor input.
  brace: ['KeyG'],
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
  // P2 mirrors P1's held defence without sharing a movement key.
  brace: ['KeyH'],
  volley: ['KeyP'],
  spike: ['BracketLeft', 'KeyY'],
  ballReset: ['KeyM'],
};

// Keyset 0 (kb1) also carries the mouse and Tab; keyset 1 (kb2) carries ']' and '\'.
// Each keyset drives the slot it was assigned to, so a keyboard on P2 is P2's.
const KEYSETS = [P1_KEYS, P2_KEYS];
const KEYBOARD_NAMES = { kb1: 'Keyboard 1 (WASD)', kb2: 'Secondary Keyboard (IJKL)' };

// Device routing, resolved once per sample by resolveDeviceRouting().
const keysetSlot = [0, 1];
const slotKeyset = [0, 1];
const slotPads = [null, null];
let arrowLookSlot = -1;

const GAMEPAD_BUTTONS = {
  jump: 0,        // A / Cross
  volley: 1,      // B / Circle (East)
  dive: 2,        // X / Square (West)
  spike: 3,       // Y / Triangle (North)
  cut: 5,         // RB / R1 (Right Shoulder)
  sprint: 6,      // LT / Left Trigger
  slide: 7,       // RT / Right Trigger
  brace: 4,       // LB / L1 (Left Shoulder)
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
    // Input state, not character state: actions sample this held signal each tick.
    braceHeld: false,
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

// Presentation-only snapshots. Never consumed by gameplay action readers.
export const CONTROL_BITS = Object.freeze({ move: 1, look: 2, sprint: 4, slide: 8, jump: 16, dive: 32, cut: 64, volley: 128, spike: 256, reset: 512, brace: 1024 });
const uiSlots = [0, 1].map((i) => ({ human: false, available: true, device: 'keyboard', keyset: i, standard: true, held: 0, pulse: 0, padIndex: -1, previousPadHeld: 0, initialized: false }));
const UI_ACTIONS = CONTROL_BITS.move | CONTROL_BITS.look | CONTROL_BITS.sprint | CONTROL_BITS.slide | CONTROL_BITS.jump | CONTROL_BITS.dive | CONTROL_BITS.cut | CONTROL_BITS.volley | CONTROL_BITS.spike | CONTROL_BITS.brace;
const uiKeyboardEdges = [0, 0];
const uiMouseHeld = [0, 0];
export function getControlsSnapshot() { return uiSlots; }

function anyHeld(codes) {
  for (let i = 0; i < codes.length; i++) {
    if (heldKeys.has(codes[i])) return true;
  }
  return false;
}

function keyAction(code, keyset) {
  const k = KEYSETS[keyset];
  if (code === k.moveUp || code === k.moveDown || code === k.moveLeft || code === k.moveRight) return CONTROL_BITS.move;
  if (k.sprint.includes(code)) return CONTROL_BITS.sprint;
  if (k.slide.includes(code)) return CONTROL_BITS.slide;
  if (code === k.jump) return CONTROL_BITS.jump;
  if (k.dive.includes(code)) return CONTROL_BITS.dive;
  if (k.cut.includes(code)) return CONTROL_BITS.cut;
  if (k.brace.includes(code)) return CONTROL_BITS.brace;
  if (k.volley.includes(code)) return CONTROL_BITS.volley;
  if (k.spike.includes(code)) return CONTROL_BITS.spike;
  if (k.ballReset.includes(code)) return CONTROL_BITS.reset;
  return 0;
}

function keyboardHeld(slotIdx, mode, pad) {
  let mask = 0;
  for (let ks = 0; ks < KEYSETS.length; ks++) {
    if (keysetSlot[ks] !== slotIdx) continue;
    const k = KEYSETS[ks];
    if (heldKeys.has(k.moveUp) || heldKeys.has(k.moveDown) || heldKeys.has(k.moveLeft) || heldKeys.has(k.moveRight)) mask |= CONTROL_BITS.move;
    if (anyHeld(k.sprint)) mask |= CONTROL_BITS.sprint;
    if (anyHeld(k.slide)) mask |= CONTROL_BITS.slide;
    if (heldKeys.has(k.jump)) mask |= CONTROL_BITS.jump;
    if (anyHeld(k.dive)) mask |= CONTROL_BITS.dive;
    if (anyHeld(k.cut)) mask |= CONTROL_BITS.cut;
    if (anyHeld(k.brace)) mask |= CONTROL_BITS.brace;
    if (anyHeld(k.volley)) mask |= CONTROL_BITS.volley;
    if (anyHeld(k.spike)) mask |= CONTROL_BITS.spike;
    if (mode === 'practice' && anyHeld(k.ballReset)) mask |= CONTROL_BITS.reset;
  }
  if (!pad && arrowLookSlot === slotIdx && (heldKeys.has('ArrowLeft') || heldKeys.has('ArrowRight') || heldKeys.has('ArrowUp') || heldKeys.has('ArrowDown'))) mask |= CONTROL_BITS.look;
  return mask | uiMouseHeld[slotIdx];
}

function updateUiSlot(index, pad, athleteCount, botSlots, mode) {
  const ui = uiSlots[index];
  ui.human = index < athleteCount && !botSlots.includes(index);
  if (!ui.human) {
    ui.held = ui.pulse = uiKeyboardEdges[index] = 0;
    return;
  }
  const mapping = explicitDeviceMappings && explicitDeviceMappings[index];
  // Both human slots retain keyboard control when a mapped pad is absent.
  ui.available = true;
  ui.keyset = slotKeyset[index];
  const keyboard = keyboardHeld(index, mode, pad);
  let padMask = 0;
  if (pad) {
    if (Math.hypot(pad.axes[0] || 0, pad.axes[1] || 0) > TUNING.motor.stickDeadzone) padMask |= CONTROL_BITS.move;
    if (Math.hypot(pad.axes[2] || 0, pad.axes[3] || 0) > TUNING.motor.stickDeadzone) padMask |= CONTROL_BITS.look;
    if (padDown(pad, GAMEPAD_BUTTONS.sprint)) padMask |= CONTROL_BITS.sprint;
    if (padDown(pad, GAMEPAD_BUTTONS.slide)) padMask |= CONTROL_BITS.slide;
    if (padDown(pad, GAMEPAD_BUTTONS.jump)) padMask |= CONTROL_BITS.jump;
    if (padDown(pad, GAMEPAD_BUTTONS.dive)) padMask |= CONTROL_BITS.dive;
    if (padDown(pad, GAMEPAD_BUTTONS.cut)) padMask |= CONTROL_BITS.cut;
    if (padDown(pad, GAMEPAD_BUTTONS.brace)) padMask |= CONTROL_BITS.brace;
    if (padDown(pad, GAMEPAD_BUTTONS.volley)) padMask |= CONTROL_BITS.volley;
    if (padDown(pad, GAMEPAD_BUTTONS.spike)) padMask |= CONTROL_BITS.spike;
    if (mode === 'practice' && padDown(pad, GAMEPAD_BUTTONS.ballReset)) padMask |= CONTROL_BITS.reset;
  }
  if (!ui.initialized) {
    ui.device = pad && mapping?.type !== 'keyboard' ? 'gamepad' : 'keyboard';
    ui.initialized = true;
  }
  if (ui.padIndex !== (pad ? pad.index : -1)) {
    ui.padIndex = pad ? pad.index : -1;
    ui.previousPadHeld = 0;
    if (!pad) ui.device = 'keyboard';
  }
  const padEdge = padMask & ~ui.previousPadHeld;
  ui.previousPadHeld = padMask;
  ui.standard = !pad || pad.mapping === 'standard';
  const allowed = mode === 'practice' ? UI_ACTIONS | CONTROL_BITS.reset : UI_ACTIONS;
  const keyEdge = uiKeyboardEdges[index] & allowed;
  // Both accepted devices in this sample retain the displayed layout.
  if (keyEdge && !padEdge) ui.device = 'keyboard';
  else if (padEdge && !keyEdge) ui.device = 'gamepad';
  ui.held = (ui.device === 'gamepad' ? padMask : keyboard) & allowed;
  ui.pulse = (ui.device === 'gamepad' ? padEdge : keyEdge) & allowed;
  uiKeyboardEdges[index] = 0;
}

const heldKeys = new Set();
let installed = false;
const cameraCyclePlayerQueued = [0, 0, 0, 0]; // -1 (left), +1 (right)
const cameraCycleArenaQueued = [0, 0, 0, 0];  // -1 (up: tactical), +1 (down: broadcast)
let menuToggleQueued = false;

export function consumeCameraCyclePlayer(slotIdx = 0) {
  const val = cameraCyclePlayerQueued[slotIdx] || 0;
  cameraCyclePlayerQueued[slotIdx] = 0;
  return val;
}

export function consumeCameraCycleArena(slotIdx = 0) {
  const val = cameraCycleArenaQueued[slotIdx] || 0;
  cameraCycleArenaQueued[slotIdx] = 0;
  return val;
}

export function consumeCameraCycle(slotIdx = 0) {
  return consumeCameraCyclePlayer(slotIdx) !== 0;
}

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
      dpadLeft: false,
      dpadRight: false,
      dpadUp: false,
      dpadDown: false,
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
  if (isInGameMenuOpen()) return;
  const newlyHeld = !heldKeys.has(event.code) && !event.repeat;
  heldKeys.add(event.code);
  if (newlyHeld) {
    for (let ks = 0; ks < KEYSETS.length; ks++) {
      const s = keysetSlot[ks];
      if (!currentBotSlots.includes(s)) uiKeyboardEdges[s] |= keyAction(event.code, ks);
    }
  }

  // Edge keys go to whichever slot each keyset is assigned to (never a bot's).
  if (!event.repeat) {
    for (let ks = 0; ks < KEYSETS.length; ks++) {
      const s = keysetSlot[ks];
      if (currentBotSlots.includes(s)) continue;
      const k = KEYSETS[ks];
      const slot = slots[s];
      if (event.code === k.jump) slot.jumpQueued = true;
      if (k.dive.includes(event.code)) slot.diveQueued = true;
      if (k.cut.includes(event.code)) slot.cutQueued = true;
      if (k.volley.includes(event.code)) slot.volleyQueued = true;
      if (k.spike.includes(event.code)) slot.spikeQueued = true;
      if (k.ballReset.includes(event.code)) slot.ballResetQueued = true;
    }
  }

  // Tab cycles the WASD player's camera (Shift+Tab cycles arena camera)
  if (event.code === 'Tab') {
    event.preventDefault();
    if (!event.repeat) {
      if (event.shiftKey) {
        cameraCycleArenaQueued[keysetSlot[0]] = 1;
      } else {
        cameraCyclePlayerQueued[keysetSlot[0]] = 1;
      }
    }
  }
  // ']' cycles the IJKL player's camera
  if (event.code === 'BracketRight') {
    event.preventDefault();
    if (!event.repeat) cameraCyclePlayerQueued[keysetSlot[1]] = 1;
  }
  // '\' cycles the IJKL player's arena camera
  if (event.code === 'Backslash') {
    event.preventDefault();
    if (!event.repeat) cameraCycleArenaQueued[keysetSlot[1]] = 1;
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
  uiKeyboardEdges.fill(0);
  uiMouseHeld.fill(0);
  for (let i = 0; i < uiSlots.length; i++) {
    uiSlots[i].held = uiSlots[i].pulse = uiSlots[i].previousPadHeld = 0;
  }
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

  // Mouse buttons strike for the WASD player
  window.addEventListener('mousedown', (event) => {
    if (isTextEntry(event.target)) return;
    const isGameplay = window.__vb?.getGameState ? (window.__vb.getGameState() === 'match' || window.__vb.getGameState() === 'practice') : true;
    if (!isGameplay || isInGameMenuOpen()) return;
    const s = getMouseSlot();
    if (s < 0) return;

    if (event.button === 0) {
      // Left click = Kick / Volley
      slots[s].volleyQueued = true;
      uiMouseHeld[s] |= CONTROL_BITS.volley;
      uiKeyboardEdges[s] |= CONTROL_BITS.volley;
    } else if (event.button === 2) {
      // Right click = Spike
      slots[s].spikeQueued = true;
      uiMouseHeld[s] |= CONTROL_BITS.spike;
      uiKeyboardEdges[s] |= CONTROL_BITS.spike;
    }
  });

  window.addEventListener('mouseup', (event) => {
    for (let s = 0; s < uiMouseHeld.length; s++) {
      if (event.button === 0) uiMouseHeld[s] &= ~CONTROL_BITS.volley;
      if (event.button === 2) uiMouseHeld[s] &= ~CONTROL_BITS.spike;
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
    // Pad N is the browser's pad number, as on the assignment cards — not a player slot.
    showToast(`🎮 Controller Connected: ${name} (Pad ${(pad?.index ?? 0) + 1})`, 'info', 4000);
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    const pad = e.gamepad;
    showToast(`⚠️ Controller Disconnected: Pad ${(pad?.index ?? 0) + 1}`, 'warning', 4000);
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

let explicitDeviceMappings = null;

export function setExplicitDeviceMappings(mappings) {
  explicitDeviceMappings = mappings;
}

export function getExplicitDeviceMappings() {
  return explicitDeviceMappings;
}

export function assignDefaultDeviceForSlot(slotIndex) {
  if (!explicitDeviceMappings) {
    explicitDeviceMappings = {};
  }
  const pads = getConnectedGamepads();
  const usedPadIndices = Object.entries(explicitDeviceMappings)
    .filter(([s, d]) => Number(s) !== slotIndex && d && d.type === 'gamepad')
    .map(([s, d]) => d.padIndex);

  const freePad = pads.find((p) => p && !usedPadIndices.includes(p.index));
  if (freePad) {
    explicitDeviceMappings[slotIndex] = {
      type: 'gamepad',
      padIndex: freePad.index,
      name: `Gamepad ${freePad.index + 1}`,
      id: freePad.id,
    };
  } else {
    // Two slots on one keyset would leave one of them with no keys at all.
    const takenKeyIds = Object.entries(explicitDeviceMappings)
      .filter(([s, d]) => Number(s) !== slotIndex && d && d.type === 'keyboard')
      .map(([, d]) => d.keyId || 'kb1');
    let keyId = slotIndex === 0 ? 'kb1' : 'kb2';
    if (takenKeyIds.includes(keyId)) keyId = keyId === 'kb1' ? 'kb2' : 'kb1';
    explicitDeviceMappings[slotIndex] = {
      type: 'keyboard',
      keyId,
      name: KEYBOARD_NAMES[keyId],
    };
  }
}

/** Player slot a gamepad is assigned to for the next match, or -1 if it is on the bench. */
export function getAssignedSlotForPad(padIndex) {
  if (!explicitDeviceMappings) return -1;
  for (let s = 0; s < 2; s++) {
    const m = explicitDeviceMappings[s];
    if (m && m.type === 'gamepad' && m.padIndex === padIndex) return s;
  }
  return -1;
}

/**
 * Player slot a keyboard keyset (0 = WASD, 1 = IJKL) drives in a match: the slot
 * it was assigned to, else its default. Same rule as resolveDeviceRouting().
 */
export function getMatchSlotForKeyset(keyset) {
  if (explicitDeviceMappings) {
    for (let s = 0; s < 2; s++) {
      const m = explicitDeviceMappings[s];
      if (m && m.type === 'keyboard' && (m.keyId === 'kb2' ? 1 : 0) === keyset) return s;
    }
  }
  return keyset;
}

export function clearDeviceMappingForSlot(slotIndex) {
  if (explicitDeviceMappings) {
    delete explicitDeviceMappings[slotIndex];
  }
}

/**
 * Returns human-readable routing assignments for UI display.
 */
export function getControllerAssignments(athleteCount = 2, mode = 'match') {
  // Practice ignores match assignments (see resolveDeviceRouting).
  const usesMappings = explicitDeviceMappings && mode !== 'practice' && athleteCount !== 1;
  if (usesMappings) {
    const formatDev = (m) => {
      if (!m) return 'AI Bot';
      if (m.type === 'gamepad') return `${m.name || `Gamepad ${m.padIndex + 1}`}`;
      return `${m.name || 'Keyboard'}`;
    };
    return {
      p1: formatDev(explicitDeviceMappings[0]),
      p2: formatDev(explicitDeviceMappings[1]),
      p3: formatDev(explicitDeviceMappings[2]),
      p4: formatDev(explicitDeviceMappings[3]),
    };
  }

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

  if (isInGameMenuOpen()) {
    for (let i = 0; i < athleteCount; i++) {
      if (!botSlots.includes(i)) {
        const slot = slots[i];
        slot.moveX = 0;
        slot.moveZ = 0;
        slot.sprintHeld = false;
        slot.slideHeld = false;
        slot.lookX = 0;
        slot.lookY = 0;
        slot.hasAim = false;
        slot.aimYaw = 0;
        slot.moveWorld.set(0, 0, 0);
      }
    }
    accumDX = 0;
    accumDY = 0;
    _mouseDX = 0;
    _mouseDY = 0;
    cameraCyclePlayerQueued.fill(0);
    cameraCycleArenaQueued.fill(0);
    heldKeys.clear();
    uiKeyboardEdges.fill(0);
    uiMouseHeld.fill(0);
    for (let i = 0; i < uiSlots.length; i++) {
      uiSlots[i].held = uiSlots[i].pulse = 0;
    }
    // The menu owns the pads: treat every button as held, so whatever closes it
    // (A on Resume, B, Start) must be released before it acts in play.
    latchPadPrev(0);
    latchPadPrev(1);
    return;
  }

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
  resolveDeviceRouting(pads, athleteCount, mode, botSlots);

  for (let i = 0; i < 2; i++) {
    if (i >= athleteCount || botSlots.includes(i)) continue;
    sampleHumanSlot(i, slotPads[i], i === 0 ? cam1Data : cam2Data, mode);
  }
  updateUiSlot(0, slotPads[0], mode === 'practice' ? 1 : athleteCount, botSlots, mode);
  updateUiSlot(1, slotPads[1], mode === 'practice' ? 1 : athleteCount, botSlots, mode);
}

function latchPadPrev(slotIdx) {
  const prev = getPadPrev(slotIdx);
  for (const key in prev) prev[key] = true;
}

function findPad(pads, padIndex) {
  for (let i = 0; i < pads.length; i++) {
    if (pads[i] && pads[i].index === padIndex) return pads[i];
  }
  return null;
}

/**
 * Decides which pad and which keyboard keysets feed each slot this sample.
 * Assignment-screen mappings win in matches; practice ignores them, so a pad
 * left over from a match never locks the solo athlete out.
 */
function resolveDeviceRouting(pads, athleteCount, mode, botSlots) {
  keysetSlot[0] = 0;
  keysetSlot[1] = 1;
  slotKeyset[0] = 0;
  slotKeyset[1] = 1;
  slotPads[0] = null;
  slotPads[1] = null;

  if (mode === 'practice' || athleteCount === 1) {
    if (!botSlots.includes(0)) slotPads[0] = pads[0] || null;
  } else if (explicitDeviceMappings) {
    for (let s = 0; s < 2; s++) {
      const m = explicitDeviceMappings[s];
      if (!m) continue;
      if (m.type === 'gamepad' && typeof m.padIndex === 'number') {
        slotPads[s] = findPad(pads, m.padIndex);
      } else if (m.type === 'keyboard') {
        const ks = m.keyId === 'kb2' ? 1 : 0;
        keysetSlot[ks] = s;
        slotKeyset[s] = ks;
      }
    }
  } else {
    // Route gamepads to humans in order
    let padIdx = 0;
    if (!botSlots.includes(0) && padIdx < pads.length) slotPads[0] = pads[padIdx++];
    if (!botSlots.includes(1) && padIdx < pads.length) slotPads[1] = pads[padIdx++];
  }

  // Arrow-key look goes to a pad-less IJKL player; otherwise to a pad-less WASD player.
  const ijkl = keysetSlot[1];
  const wasd = keysetSlot[0];
  arrowLookSlot = -1;
  if (mode !== 'practice' && athleteCount > 1 && !botSlots.includes(ijkl) && !slotPads[ijkl]) arrowLookSlot = ijkl;
  else if (!botSlots.includes(wasd) && !slotPads[wasd]) arrowLookSlot = wasd;
}

function sampleHumanSlot(i, pad, camData, mode) {
  const slot = slots[i];
  let x = 0;
  let z = 0;
  let sprintHeld = false;
  let slideHeld = false;
  let braceHeld = false;
  let lookX = 0;
  let lookY = 0;

  for (let ks = 0; ks < KEYSETS.length; ks++) {
    if (keysetSlot[ks] !== i) continue;
    const k = KEYSETS[ks];
    x += (heldKeys.has(k.moveRight) ? 1 : 0) - (heldKeys.has(k.moveLeft) ? 1 : 0);
    z += (heldKeys.has(k.moveUp) ? 1 : 0) - (heldKeys.has(k.moveDown) ? 1 : 0);
    if (anyHeld(k.sprint)) sprintHeld = true;
    if (anyHeld(k.slide)) slideHeld = true;
    if (anyHeld(k.brace)) braceHeld = true;
  }

  if (pad) {
    const stick = applyDeadzone(pad.axes[0] || 0, pad.axes[1] || 0, TUNING.motor.stickDeadzone);
    if (stick.x !== 0 || stick.y !== 0) {
      x = stick.x;
      z = -stick.y;
    }

    const look = applyDeadzone(pad.axes[2] || 0, pad.axes[3] || 0, TUNING.motor.stickDeadzone);
    lookX = look.x;
    lookY = look.y;

    if (padDown(pad, GAMEPAD_BUTTONS.sprint)) sprintHeld = true;
    if (padDown(pad, GAMEPAD_BUTTONS.slide)) slideHeld = true;
    if (padDown(pad, GAMEPAD_BUTTONS.brace)) braceHeld = true;

    const prev = getPadPrev(i);
    const jumpDown = padDown(pad, GAMEPAD_BUTTONS.jump);
    if (jumpDown && !prev.jump) slot.jumpQueued = true;
    prev.jump = jumpDown;

    const diveDown = padDown(pad, GAMEPAD_BUTTONS.dive);
    if (diveDown && !prev.dive) slot.diveQueued = true;
    prev.dive = diveDown;

    const cutDown = padDown(pad, GAMEPAD_BUTTONS.cut);
    if (cutDown && !prev.cut) slot.cutQueued = true;
    prev.cut = cutDown;

    const volleyDown = padDown(pad, GAMEPAD_BUTTONS.volley);
    if (volleyDown && !prev.volley) slot.volleyQueued = true;
    prev.volley = volleyDown;

    const spikeDown = padDown(pad, GAMEPAD_BUTTONS.spike);
    if (spikeDown && !prev.spike) slot.spikeQueued = true;
    prev.spike = spikeDown;

    const pauseDown = padDown(pad, GAMEPAD_BUTTONS.pauseMenu);
    if (pauseDown && !prev.pauseMenu) {
      if (!isInGameMenuOpen()) {
        menuToggleQueued = true;
      }
    }
    prev.pauseMenu = pauseDown;

    const ballResetDown = padDown(pad, GAMEPAD_BUTTONS.ballReset);
    if (ballResetDown && !prev.ballReset) {
      if (mode === 'practice') {
        slot.ballResetQueued = true;
      }
    }
    prev.ballReset = ballResetDown;

    const dLeft = padDown(pad, 14);
    const dRight = padDown(pad, 15);
    const dUp = padDown(pad, 12);
    const dDown = padDown(pad, 13);
    if (dLeft && !prev.dpadLeft) cameraCyclePlayerQueued[i] = -1;
    if (dRight && !prev.dpadRight) cameraCyclePlayerQueued[i] = 1;
    if (dUp && !prev.dpadUp) cameraCycleArenaQueued[i] = -1;
    if (dDown && !prev.dpadDown) cameraCycleArenaQueued[i] = 1;
    prev.dpadLeft = dLeft;
    prev.dpadRight = dRight;
    prev.dpadUp = dUp;
    prev.dpadDown = dDown;
  } else if (arrowLookSlot === i) {
    // Secondary keyboard camera control: Arrow keys
    lookX = (heldKeys.has('ArrowRight') ? 1 : 0) - (heldKeys.has('ArrowLeft') ? 1 : 0);
    lookY = (heldKeys.has('ArrowUp') ? 1 : 0) - (heldKeys.has('ArrowDown') ? 1 : 0);
  }

  const mag = Math.hypot(x, z);
  if (mag > 1) { x /= mag; z /= mag; }

  slot.moveX = x;
  slot.moveZ = z;
  slot.sprintHeld = sprintHeld;
  slot.slideHeld = slideHeld;
  slot.braceHeld = braceHeld;
  slot.lookX = lookX;
  slot.lookY = lookY;
  slot.hasAim = false;
  slot.aimYaw = 0;
  slot.cameraYaw = camData.yaw;

  if (camData.valid) {
    slot.moveWorld.set(0, 0, 0)
      .addScaledVector(camData.right, x)
      .addScaledVector(camData.forward, z);
  } else {
    slot.moveWorld.set(0, 0, 0);
  }
}

/** Slot whose camera takes mouse look and clicks (the WASD keyset's), or -1 when a bot holds it. */
export function getMouseSlot() {
  const s = keysetSlot[0];
  return currentBotSlots.includes(s) ? -1 : s;
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



