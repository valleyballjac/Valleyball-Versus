/**
 * Deterministic virtual Gamepad API mock for opaque-box Playwright E2E tests.
 * Designed to be injected via page.addInitScript(installVirtualGamepadMock)
 * and also exercised directly in Node during self-test verification.
 */

export function installVirtualGamepadMock(targetWindow = globalThis, targetNavigator = null) {
  const win = targetWindow;
  const nav = targetNavigator || win?.navigator;
  if (!win || !nav) {
    throw new Error('installVirtualGamepadMock requires window and navigator objects');
  }

  const MAX_SLOTS = 4;
  const BUTTON_COUNT = 17;
  const slots = [null, null, null, null];
  const hapticsLog = [];

  function nowMs() {
    if (typeof win.performance?.now === 'function') {
      return win.performance.now();
    }
    return Date.now();
  }

  function makeButtons() {
    const arr = new Array(BUTTON_COUNT);
    for (let i = 0; i < BUTTON_COUNT; i++) {
      arr[i] = { pressed: false, touched: false, value: 0 };
    }
    return arr;
  }

  function applyButtonSpec(buttons, spec, triggerValues = {}) {
    for (let i = 0; i < BUTTON_COUNT; i++) {
      buttons[i].pressed = false;
      buttons[i].touched = false;
      buttons[i].value = 0;
    }
    if (Array.isArray(spec)) {
      for (let i = 0; i < spec.length; i++) {
        const b = spec[i];
        if (Number.isInteger(b) && b >= 0 && b < BUTTON_COUNT) {
          buttons[b].pressed = true;
          buttons[b].touched = true;
          buttons[b].value = 1;
        }
      }
    } else if (spec && typeof spec === 'object') {
      const keys = Object.keys(spec);
      for (let i = 0; i < keys.length; i++) {
        const b = Number(keys[i]);
        const v = spec[keys[i]];
        if (Number.isInteger(b) && b >= 0 && b < BUTTON_COUNT) {
          const val = typeof v === 'number' ? v : (v ? 1 : 0);
          buttons[b].pressed = val > 0.5;
          buttons[b].touched = val > 0;
          buttons[b].value = val;
        }
      }
    }
    if (triggerValues && typeof triggerValues === 'object') {
      const tKeys = Object.keys(triggerValues);
      for (let i = 0; i < tKeys.length; i++) {
        const b = Number(tKeys[i]);
        const val = Number(triggerValues[tKeys[i]]);
        if (Number.isInteger(b) && b >= 0 && b < BUTTON_COUNT && Number.isFinite(val)) {
          buttons[b].pressed = val > 0.5;
          buttons[b].touched = val > 0;
          buttons[b].value = val;
        }
      }
    }
  }

  function buildPad(index, opts = {}) {
    const isFight = Boolean(opts.fightingPadHardware);
    const defaultAxes = isFight ? [0] : [0, 0, 0, 0];
    const axes = Array.isArray(opts.axes) ? opts.axes.slice() : defaultAxes;
    const buttons = makeButtons();
    if (opts.buttons || opts.triggerValues) {
      applyButtonSpec(buttons, opts.buttons, opts.triggerValues);
    }
    const id = typeof opts.id === 'string' && opts.id.length > 0
      ? opts.id
      : (isFight
        ? `Arcade Fighting Stick (Vendor: 0f0d Product: 00${index + 1}0)`
        : `Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02e${index})`);
    return {
      index,
      id,
      connected: true,
      mapping: opts.mapping || 'standard',
      timestamp: nowMs(),
      axes,
      buttons,
      vibrationActuator: {
        playEffect: async (type, params) => {
          hapticsLog.push({
            index,
            type,
            params: params ? { ...params } : null,
            ts: nowMs(),
          });
          return 'complete';
        },
      },
    };
  }

  function dispatchPadEvent(eventName, pad) {
    if (!pad || typeof win.dispatchEvent !== 'function' || typeof win.Event !== 'function') {
      return;
    }
    const evt = new win.Event(eventName);
    Object.defineProperty(evt, 'gamepad', {
      value: pad,
      configurable: true,
      enumerable: true,
    });
    win.dispatchEvent(evt);
  }

  function assertSlotIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= MAX_SLOTS) {
      throw new RangeError(`Pad index must be 0..3, got ${index}`);
    }
  }

  function connect(index, opts = {}) {
    assertSlotIndex(index);
    const pad = buildPad(index, opts);
    slots[index] = pad;
    if (opts.dispatchEvent !== false) {
      dispatchPadEvent('gamepadconnected', pad);
    }
    return pad;
  }

  function wake(index, pressedButtons = [0], opts = {}) {
    return connect(index, {
      ...opts,
      buttons: pressedButtons,
    });
  }

  function disconnect(index, opts = {}) {
    assertSlotIndex(index);
    const existing = slots[index];
    slots[index] = null;
    if (existing) {
      existing.connected = false;
      existing.timestamp = nowMs();
      if (opts.dispatchEvent !== false) {
        dispatchPadEvent('gamepaddisconnected', existing);
      }
    }
    return existing;
  }

  function swapPad(index, newId, opts = {}) {
    assertSlotIndex(index);
    const oldPad = slots[index];
    if (oldPad) {
      oldPad.connected = false;
      oldPad.timestamp = nowMs();
      if (opts.dispatchEvent !== false) {
        dispatchPadEvent('gamepaddisconnected', oldPad);
      }
    }
    const nextPad = buildPad(index, {
      ...opts,
      id: newId || `Spare USB Controller (Vendor: 045e Product: 0b1${index})`,
    });
    slots[index] = nextPad;
    if (opts.dispatchEvent !== false) {
      dispatchPadEvent('gamepadconnected', nextPad);
    }
    return nextPad;
  }

  function setButton(index, btnIdx, pressed, value = null) {
    assertSlotIndex(index);
    const pad = slots[index];
    if (!pad) throw new Error(`No pad connected at slot ${index}`);
    if (!Number.isInteger(btnIdx) || btnIdx < 0 || btnIdx >= BUTTON_COUNT) {
      throw new RangeError(`Button index out of range: ${btnIdx}`);
    }
    const numVal = value === null ? (pressed ? 1 : 0) : Number(value);
    pad.buttons[btnIdx].pressed = Boolean(pressed || numVal > 0.5);
    pad.buttons[btnIdx].touched = Boolean(pressed || numVal > 0);
    pad.buttons[btnIdx].value = numVal;
    pad.timestamp = nowMs();
    return pad;
  }

  function setButtons(index, pressedList = [], triggerValues = {}) {
    assertSlotIndex(index);
    const pad = slots[index];
    if (!pad) throw new Error(`No pad connected at slot ${index}`);
    applyButtonSpec(pad.buttons, pressedList, triggerValues);
    pad.timestamp = nowMs();
    return pad;
  }

  function setAxes(index, axes = [0, 0, 0, 0]) {
    assertSlotIndex(index);
    const pad = slots[index];
    if (!pad) throw new Error(`No pad connected at slot ${index}`);
    pad.axes = Array.isArray(axes) ? axes.slice() : [0, 0, 0, 0];
    pad.timestamp = nowMs();
    return pad;
  }

  function snapshot() {
    return slots.map((p) => {
      if (!p) return null;
      const pressedButtons = [];
      for (let i = 0; i < p.buttons.length; i++) {
        if (p.buttons[i]?.pressed) pressedButtons.push(i);
      }
      return {
        index: p.index,
        id: p.id,
        connected: p.connected,
        axes: p.axes.slice(),
        pressedButtons,
      };
    });
  }

  function getHapticsLog() {
    return hapticsLog.slice();
  }

  function clearHapticsLog() {
    hapticsLog.length = 0;
  }

  function resetAll() {
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (slots[i]) slots[i].connected = false;
      slots[i] = null;
    }
    hapticsLog.length = 0;
  }

  const getGamepadsMock = () => [slots[0], slots[1], slots[2], slots[3]];
  const proto = win.Navigator?.prototype;
  if (proto) {
    Object.defineProperty(proto, 'getGamepads', {
      configurable: true,
      writable: true,
      value: getGamepadsMock,
    });
  }
  Object.defineProperty(nav, 'getGamepads', {
    configurable: true,
    writable: true,
    value: getGamepadsMock,
  });

  const api = {
    connect,
    wake,
    disconnect,
    swapPad,
    setButton,
    setButtons,
    setAxes,
    snapshot,
    getHapticsLog,
    clearHapticsLog,
    resetAll,
  };

  Object.defineProperty(win, '__vbE2EPads', {
    value: api,
    configurable: true,
    writable: true,
  });

  return api;
}
