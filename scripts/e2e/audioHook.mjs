/**
 * Non-invasive AudioContext inspection hook for opaque-box E2E tests.
 * Captures AudioContext initial state, resume() calls, and state transitions
 * on window.__vbE2EAudio without modifying src/audio/soundManager.js.
 */

export function installAudioInspectionHook(targetWindow = globalThis) {
  const win = targetWindow;
  if (!win) {
    throw new Error('installAudioInspectionHook requires a window object');
  }
  if (win.__vbE2EAudio && (win.AudioContext?.__vbWrapped || win.webkitAudioContext?.__vbWrapped)) {
    return win.__vbE2EAudio;
  }

  const entries = [];

  function wrapConstructor(OriginalCtor) {
    if (typeof OriginalCtor !== 'function') return OriginalCtor;
    if (OriginalCtor.__vbWrapped) return OriginalCtor;

    function WrappedAudioContext(...args) {
      const ctx = new OriginalCtor(...args);
      const entry = {
        index: entries.length,
        initialState: ctx.state || 'unknown',
        currentState: ctx.state || 'unknown',
        resumeCalls: 0,
        resumeTimestamps: [],
        stateHistory: [{ state: ctx.state || 'unknown', ts: Date.now() }],
      };
      entries.push(entry);

      if (typeof ctx.addEventListener === 'function') {
        ctx.addEventListener('statechange', () => {
          entry.currentState = ctx.state || entry.currentState;
          entry.stateHistory.push({ state: entry.currentState, ts: Date.now() });
        });
      }

      if (typeof ctx.resume === 'function') {
        const origResume = ctx.resume.bind(ctx);
        ctx.resume = (...resumeArgs) => {
          entry.resumeCalls += 1;
          entry.resumeTimestamps.push({ stateBefore: ctx.state, ts: Date.now() });
          const res = origResume(...resumeArgs);
          if (res && typeof res.then === 'function') {
            res.then(
              () => {
                entry.currentState = ctx.state || entry.currentState;
              },
              () => {
                entry.currentState = ctx.state || entry.currentState;
              },
            );
          } else {
            entry.currentState = ctx.state || entry.currentState;
          }
          return res;
        };
      }

      return ctx;
    }

    WrappedAudioContext.prototype = OriginalCtor.prototype;
    WrappedAudioContext.__vbWrapped = true;
    return WrappedAudioContext;
  }

  const origStandard = win.AudioContext;
  const origWebkit = win.webkitAudioContext;
  if (typeof origStandard === 'function') {
    win.AudioContext = wrapConstructor(origStandard);
  }
  if (typeof origWebkit === 'function') {
    if (origWebkit === origStandard) {
      win.webkitAudioContext = win.AudioContext;
    } else {
      win.webkitAudioContext = wrapConstructor(origWebkit);
    }
  }

  const api = {
    snapshot() {
      let resumeCalls = 0;
      const initialStates = [];
      const currentStates = [];
      const stateHistory = [];
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        resumeCalls += e.resumeCalls;
        initialStates.push(e.initialState);
        currentStates.push(e.currentState);
        stateHistory.push(e.stateHistory.slice());
      }
      return {
        contextCount: entries.length,
        resumeCalls,
        initialStates,
        currentStates,
        stateHistory,
      };
    },
    reset() {
      entries.length = 0;
    },
  };

  Object.defineProperty(win, '__vbE2EAudio', {
    value: api,
    configurable: true,
    writable: true,
  });

  return api;
}
