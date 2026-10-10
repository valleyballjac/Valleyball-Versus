import { CONTROL_BITS } from '../input/inputRouter.js';
import { TUNING } from '../config/tuning.js';

// DOM-only presentation. The router owns the snapshot; this module never consumes an action.
const actions = [
  ['move', 'Move'], ['look', 'Look'], ['sprint', 'Sprint'], ['slide', 'Slide'],
  ['jump', 'Jump'], ['dive', 'Dive'], ['cut', 'Cut'], ['volley', 'Volley'],
  ['spike', 'Spike'], ['reset', 'Reset ball'],
];
const keys = [
  ['WASD', 'Mouse', 'Shift', 'C', 'Space', 'Q', 'V / F', 'E / Click', 'R / Right click', 'B'],
  ['IJKL', 'Arrows', 'Right Shift / Slash', 'O', 'Enter', 'U', 'N / H', 'P', '[ / Y', 'M'],
];
const padLabels = ['LS', 'RS', 'LT', 'RT', 'A', 'X', 'LB', 'B', 'Y', 'Back'];
const padIndices = ['Axis 0/1', 'Axis 2/3', 'Btn 6', 'Btn 7', 'Btn 0', 'Btn 2', 'Btn 4', 'Btn 1', 'Btn 3', 'Btn 8'];
const slots = [null, null];
let root = null;
let enabled = TUNING.controlsHud.userEnabled;
let visible = false;

function makeLayout(labels, parent) {
  const nodes = [];
  const layout = document.createElement('div');
  layout.className = 'controls-strip-layout';
  for (let i = 0; i < actions.length; i++) {
    const badge = document.createElement('span');
    badge.className = 'controls-badge';
    const glyph = document.createElement('kbd');
    glyph.textContent = labels[i];
    const label = document.createElement('span');
    label.textContent = actions[i][1];
    badge.append(glyph, label);
    layout.appendChild(badge);
    nodes.push(badge);
  }
  parent.appendChild(layout);
  return { layout, nodes, mask: 0 };
}

export function initControlsOverlay() {
  if (root) return;
  root = document.getElementById('controls-overlay');
  if (!root) return;
  for (let i = 0; i < slots.length; i++) {
    const panel = document.createElement('div');
    panel.className = 'controls-strip';
    const title = document.createElement('div');
    title.className = 'controls-strip-title';
    title.textContent = `P${i + 1}`;
    const device = document.createElement('span');
    title.appendChild(device);
    panel.appendChild(title);
    const keyboard = makeLayout(keys[i], panel);
    const gamepad = makeLayout(padLabels, panel);
    const fallback = makeLayout(padIndices, panel);
    const status = document.createElement('div');
    status.className = 'controls-disconnected';
    status.textContent = 'Controller disconnected';
    panel.appendChild(status);
    root.appendChild(panel);
    slots[i] = { panel, device, keyboard, gamepad, fallback, status, layout: null, pulseUntil: new Float64Array(actions.length) };
  }
}

export function setControlsOverlayEnabled(value) {
  enabled = !!value;
}

function clearSlot(slot) {
  slot.pulseUntil.fill(0);
  if (slot.layout) {
    const layout = slot.layout;
    for (let i = 0; i < actions.length; i++) {
      if (layout.mask & (1 << i)) layout.nodes[i].classList.remove('pressed');
    }
    layout.mask = 0;
  }
}

export function hideControlsOverlay() {
  if (!root) return;
  if (visible) {
    visible = false;
    root.hidden = true;
    for (let i = 0; i < slots.length; i++) clearSlot(slots[i]);
  }
}

// Pass primitive context values, never allocate a context object in the frame loop.
export function updateControlsOverlay(snapshot, state, menuOpen, endOpen, matchOver, countdown, modalOpen) {
  if (!root) return;
  const shouldShow = (state === 'match' || state === 'practice') && !menuOpen && !endOpen && !matchOver && !modalOpen && (enabled || countdown);
  if (visible !== shouldShow) {
    visible = shouldShow;
    root.hidden = !visible;
    if (!visible) for (let i = 0; i < slots.length; i++) clearSlot(slots[i]);
  }
  if (!visible) return;
  const now = performance.now(); // UI-only pulse expiration, never read by simulation.
  for (let i = 0; i < slots.length; i++) {
    const data = snapshot[i];
    const slot = slots[i];
    if (slot.panel.hidden === data.human) slot.panel.hidden = !data.human;
    if (!data.human) continue;
    const layout = !data.available ? null : data.device === 'keyboard' ? slot.keyboard : data.standard ? slot.gamepad : slot.fallback;
    if (slot.layout !== layout) {
      clearSlot(slot);
      slot.layout = layout;
      slot.keyboard.layout.hidden = layout !== slot.keyboard;
      slot.gamepad.layout.hidden = layout !== slot.gamepad;
      slot.fallback.layout.hidden = layout !== slot.fallback;
      slot.status.hidden = !!layout;
      slot.device.textContent = !layout ? 'Controller disconnected' : data.device === 'keyboard' ? 'Keyboard' : 'Gamepad';
    }
    if (!layout) continue;
    for (let j = 0; j < actions.length; j++) {
      const bit = CONTROL_BITS[actions[j][0]];
      if (data.pulse & bit) slot.pulseUntil[j] = now + TUNING.controlsHud.pulseMs;
      const active = !!((data.held & bit) || now < slot.pulseUntil[j]);
      if (active !== !!(layout.mask & bit)) {
        layout.nodes[j].classList.toggle('pressed', active);
        if (active) layout.mask |= bit;
        else layout.mask &= ~bit;
      }
    }
    // Only practice exposes ball reset. Hide P1 keyboard look outside practice where arrows may be assigned to P2.
    const practice = state === 'practice';
    if (layout.nodes[9].hidden !== !practice) layout.nodes[9].hidden = !practice;
    if (layout === slot.keyboard && i === 0 && layout.nodes[1].hidden !== !practice) layout.nodes[1].hidden = !practice;
  }
}
