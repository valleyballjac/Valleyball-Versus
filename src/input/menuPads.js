/**
 * Gamepad edge tracking for DOM menus.
 *
 * Each physical pad (keyed by Gamepad.index) keeps its own previous state, so a
 * second connected pad can never clear the first pad's edges. A pad's first
 * sample after reset() only seeds that state: a button still held from the
 * previous screen reads as already down, and must be released before it counts.
 *
 * Usage, once per poll:
 *   tracker.update(pads);
 *   const e = tracker.pressed(pad);   // bits that went down this poll
 *   if (e & MENU_PAD.a) ...
 */

export const MENU_PAD = Object.freeze({
  up: 1,
  down: 2,
  left: 4,
  right: 8,
  a: 16,
  b: 32,
  x: 64,
  y: 128,
  lb: 256,
  rb: 512,
  back: 1024,
  start: 2048,
});

const STICK_THRESHOLD = 0.5;

function buttonDown(pad, index) {
  return !!pad.buttons[index]?.pressed;
}

function heldMask(pad) {
  const ax = pad.axes[0] || 0;
  const ay = pad.axes[1] || 0;
  let m = 0;
  if (buttonDown(pad, 12) || ay < -STICK_THRESHOLD) m |= MENU_PAD.up;
  if (buttonDown(pad, 13) || ay > STICK_THRESHOLD) m |= MENU_PAD.down;
  if (buttonDown(pad, 14) || ax < -STICK_THRESHOLD) m |= MENU_PAD.left;
  if (buttonDown(pad, 15) || ax > STICK_THRESHOLD) m |= MENU_PAD.right;
  if (buttonDown(pad, 0)) m |= MENU_PAD.a;
  if (buttonDown(pad, 1)) m |= MENU_PAD.b;
  if (buttonDown(pad, 2)) m |= MENU_PAD.x;
  if (buttonDown(pad, 3)) m |= MENU_PAD.y;
  if (buttonDown(pad, 4)) m |= MENU_PAD.lb;
  if (buttonDown(pad, 5)) m |= MENU_PAD.rb;
  if (buttonDown(pad, 8)) m |= MENU_PAD.back;
  if (buttonDown(pad, 9)) m |= MENU_PAD.start;
  return m;
}

export function createMenuPadTracker() {
  const held = new Map();
  const pressed = new Map();
  return {
    /** Forget every pad; seed current physical state so held buttons don't refire while fast taps aren't swallowed. */
    reset() {
      held.clear();
      pressed.clear();
      if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
        const raw = navigator.getGamepads() || [];
        for (let i = 0; i < raw.length; i++) {
          const pad = raw[i];
          if (pad && pad.connected !== false) {
            held.set(pad.index, heldMask(pad));
          }
        }
      }
    },
    /** Samples every connected pad exactly once for this poll. */
    update(pads) {
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (!pad) continue;
        const now = heldMask(pad);
        const before = held.has(pad.index) ? held.get(pad.index) : now;
        held.set(pad.index, now);
        pressed.set(pad.index, now & ~before);
      }
    },
    /** Bits that went down on this pad during the latest update(). */
    pressed(pad) {
      return pressed.get(pad.index) || 0;
    },
    /** Bits currently held on this pad as of the latest update(). */
    held(pad) {
      return held.get(pad.index) || 0;
    },
  };
}
