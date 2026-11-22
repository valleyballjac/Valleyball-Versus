/**
 * Module: ui/replayDock
 * Role: Broadcast Replay Director Dock, Athlete POV switcher (P1-P4), 7-camera selector
 *   (Broadcast / Dynamic / Tactical / Chase / Ball-Track / 1st-Person / Free Drone),
 *   in-app clean WebGL canvas video clip recorder (.webm), `.vbreplay` save/load, and
 *   keyboard + gamepad transport controller.
 * Frame Phase: Render (DOM transport updates + Free-Fly drone + gamepad director controls).
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Delegates playback transport, follows & seeks exclusively
 *     through `replayManager` and Free-Fly camera motion through `cinematicCamera`.
 */

import { replayManager } from '../features/match/replayManager.js';
import { setCleanBroadcastHud } from '../config/hudConfig.js';
import { createMenuPadTracker, MENU_PAD } from '../input/menuPads.js';

const CAMERA_BUTTONS = [
  { id: 'broadcast', key: '1', label: 'BROADCAST' },
  { id: 'sports', key: '2', label: 'DYNAMIC' },
  { id: 'tactical', key: '3', label: 'TACTICAL' },
  { id: 'chase', key: '4', label: 'CHASE' },
  { id: 'thirdPerson', key: '5', label: 'BALL-TRACK' },
  { id: 'firstPerson', key: '6', label: '1ST PERSON' },
  { id: 'free', key: '7', label: 'DRONE [F]' },
];

const FORWARD_SPEED_PILLS = [0.1, 0.25, 0.5, 1, 2, 4];

let dockEl = null;
let goalBannerEl = null;
let playBtnEl = null;
let slowMoBtnEl = null;
let rewModeBtnEl = null;
let ffwModeBtnEl = null;
let statusPillEl = null;
let timeLabelEl = null;
let trackEl = null;
let fillEl = null;
let thumbEl = null;
let hoverTipEl = null;
let markersEl = null;
let goalsStripEl = null;
let goalChipBtns = [];
let heightReadoutEl = null;
let droneHintEl = null;
let targetGroupEl = null;
let recBtnEl = null;
let recBadgeEl = null;
let fileInputEl = null;
let speedBtns = [];
let camBtns = [];
let targetBtns = [];

let dockHiddenForCleanFootage = false;
let lastGoalsSignature = '';
let lastPlayersSignature = '';
let lastUiSignature = '';
let lastBannerSignature = '';
let isDraggingLook = false;
let lastDragX = 0;
let lastDragY = 0;
let isScrubbingTimeline = false;
let wasPausedBeforeScrub = false;
let heightButtonHoldDir = 0;
let heightButtonHoldStartMs = 0;
let lastDockUpdateMs = 0;
let listenersInstalled = false;

// In-app clean WebGL canvas video clip recorder (.webm)
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartMs = 0;

const replayPads = createMenuPadTracker();
const freeKeysHeld = new Set();
const _freeInputScratch = {
  moveForward: 0,
  moveRight: 0,
  moveUp: 0,
  lookYawRate: 0,
  lookPitchRate: 0,
  fast: false,
  slow: false,
};

let callbacks = {
  onSeek: null,
  onJumpGoal: null,
  onSelectCamera: null,
  onSelectFollowSlot: null,
  onLoadReplayFile: null,
  onExitReplay: null,
  onCleanFootage: null,
  onFreeLookDelta: null,
  onFreeFovDelta: null,
  onAdjustHeight: null,
  getCameraHeight: null,
  isMenuOpen: () => false,
};

function formatFramesAsTime(frames) {
  const totalSec = Math.max(0, Math.floor((frames || 0) / 60));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatSeconds(sec) {
  const totalSec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function toHexCss(colorNum, fallback = '#00e5ff') {
  if (typeof colorNum !== 'number' || !Number.isFinite(colorNum)) return fallback;
  return '#' + (colorNum & 0xffffff).toString(16).padStart(6, '0');
}

function isBrightHex(hex) {
  const clean = String(hex || '').replace('#', '');
  if (clean.length !== 6) return false;
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return (r * 299 + g * 587 + b * 114) / 1000 > 165;
}

/**
 * Resolves scorer display tag, team label, assist tag, and kit color for a
 * recorded replay goal event. Safe on legacy v2/v3 replays with or without scorerSlot.
 */
export function describeGoalScorer(goalEvent = {}, meta = null) {
  const players = Array.isArray(meta?.players) ? meta.players : [];
  const scoredTeam = goalEvent?.scoredFor === 'away' ? 'away' : 'home';
  const teamLabel = scoredTeam === 'away' ? 'AWAY' : 'HOME';
  const defaultTeamHex = scoredTeam === 'away' ? '#38bdf8' : '#ef4444';

  const slot = Number.isInteger(goalEvent?.scorerSlot) && goalEvent.scorerSlot >= 0
    ? goalEvent.scorerSlot
    : null;
  const scorerPlayer = slot !== null ? (players[slot] || null) : null;
  const teamFallbackPlayer = players.find((p) => p?.team === scoredTeam) || null;

  const colorHex = toHexCss(
    scorerPlayer?.primaryColor ?? teamFallbackPlayer?.primaryColor,
    defaultTeamHex,
  );
  const bright = isBrightHex(colorHex);
  const textHex = bright ? '#090d16' : '#ffffff';
  const borderHex = bright ? '#0f172a' : '#ffffff';

  const rawName = scorerPlayer?.displayName || (slot !== null ? `P${slot + 1}` : null);
  const shortTag = slot !== null ? `P${slot + 1}` : teamLabel;
  const fullLabel = rawName
    ? (rawName.toUpperCase() === shortTag ? `${shortTag} (${teamLabel})` : `${rawName} (${teamLabel})`)
    : `${teamLabel} TEAM`;

  const assistSlot = Number.isInteger(goalEvent?.assistSlot)
    && goalEvent.assistSlot >= 0
    && goalEvent.assistSlot !== slot
    ? goalEvent.assistSlot
    : null;
  const assistPlayer = assistSlot !== null ? (players[assistSlot] || null) : null;
  const assistTag = assistSlot !== null
    ? (assistPlayer?.displayName || `P${assistSlot + 1}`)
    : null;

  const hoopLabel = goalEvent?.goal === 'N' ? 'North Hoop' : (goalEvent?.goal === 'S' ? 'South Hoop' : 'Hoop');
  const scoreLabel = `${goalEvent?.scoreHome ?? 0}-${goalEvent?.scoreAway ?? 0}`;

  return {
    slot,
    shortTag,
    fullLabel,
    teamLabel,
    assistTag,
    colorHex,
    textHex,
    borderHex,
    hoopLabel,
    scoreLabel,
  };
}

function isTypingTarget(target) {
  if (!target?.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target.isContentEditable);
}

function pickSupportedVideoMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const mime of candidates) {
    if (typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

function isRecordingClip() {
  return Boolean(mediaRecorder && mediaRecorder.state === 'recording');
}

export function stopReplayVideoClip() {
  if (!mediaRecorder) return false;
  try {
    if (mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  } catch (_) {}
  return true;
}

export function toggleReplayVideoClip() {
  if (isRecordingClip()) {
    stopReplayVideoClip();
    return false;
  }
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') return false;
  const canvas = document.getElementById('viewport');
  if (!canvas || typeof canvas.captureStream !== 'function') return false;

  try {
    const stream = canvas.captureStream(60);
    const mimeType = pickSupportedVideoMime();
    const opts = mimeType
      ? { mimeType, videoBitsPerSecond: 12_000_000 }
      : { videoBitsPerSecond: 12_000_000 };
    recordedChunks = [];
    const rec = new MediaRecorder(stream, opts);
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) recordedChunks.push(ev.data);
    };
    rec.onstop = () => {
      const chunks = recordedChunks;
      recordedChunks = [];
      mediaRecorder = null;
      recordingStartMs = 0;
      lastUiSignature = '';
      if (chunks.length > 0 && typeof Blob !== 'undefined') {
        const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
        const a = document.createElement('a');
        a.href = url;
        a.download = `valleyball_clip_${stamp}.webm`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      stream.getTracks().forEach((t) => t.stop());
    };
    mediaRecorder = rec;
    recordingStartMs = performance.now();
    rec.start(250);
    lastUiSignature = '';
    return true;
  } catch (err) {
    console.warn('[replayDock] video clip capture failed:', err?.message || err);
    mediaRecorder = null;
    recordingStartMs = 0;
    return false;
  }
}

function makeDockBtn(label, title, onClick, accent = null) {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.style.cssText = `
    padding: 4px 8px;
    font-size: 10px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.05em;
    color: ${accent || '#e2e8f0'};
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid ${accent || 'rgba(255, 255, 255, 0.22)'};
    border-radius: 5px;
    cursor: pointer;
    white-space: nowrap;
  `;
  b.onclick = onClick;
  return b;
}

function buildDock() {
  if (dockEl || typeof document === 'undefined') return dockEl;

  dockEl = document.createElement('div');
  dockEl.id = 'replay-broadcast-dock';
  dockEl.style.cssText = `
    position: fixed;
    left: 50%;
    bottom: 10px;
    transform: translateX(-50%);
    display: none;
    flex-direction: column;
    gap: 5px;
    width: min(1220px, 97vw);
    padding: 7px 12px;
    background: rgba(8, 13, 22, 0.90);
    border: 1px solid rgba(0, 229, 255, 0.35);
    border-top: 3px solid #00e5ff;
    border-radius: 10px;
    color: #e2e8f0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    z-index: 620;
    user-select: none;
    box-sizing: border-box;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.72);
  `;

  // Hidden .vbreplay file input for loading saved replays
  fileInputEl = document.createElement('input');
  fileInputEl.type = 'file';
  fileInputEl.accept = '.vbreplay,application/octet-stream';
  fileInputEl.style.display = 'none';
  fileInputEl.addEventListener('change', async () => {
    const file = fileInputEl.files?.[0];
    fileInputEl.value = '';
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      await callbacks.onLoadReplayFile?.(new Uint8Array(buf), file.name);
    } catch (err) {
      console.warn('[replayDock] failed to load .vbreplay file:', err?.message || err);
    }
  });
  dockEl.appendChild(fileInputEl);

  // Row 1: Interactive Click-and-Drag Timeline Scrubber + Playhead Thumb + Hover Tooltip + Colored Scorer Goal Pins
  const timelineRow = document.createElement('div');
  timelineRow.style.cssText = 'display: flex; align-items: center; gap: 10px; width: 100%; padding-top: 12px;';

  const replayBadge = document.createElement('span');
  replayBadge.textContent = '● DIRECTOR SUITE';
  replayBadge.style.cssText = 'font-size: 10px; font-weight: 900; letter-spacing: 0.1em; color: #00e5ff; white-space: nowrap;';

  statusPillEl = document.createElement('span');
  statusPillEl.id = 'replay-status-pill';
  statusPillEl.textContent = '▶ 1x';
  statusPillEl.style.cssText = 'padding: 2px 7px; border-radius: 999px; background: rgba(0, 229, 255, 0.16); border: 1px solid rgba(0, 229, 255, 0.45); color: #00e5ff; font-size: 9.5px; font-weight: 900; letter-spacing: 0.06em; white-space: nowrap; min-width: 58px; text-align: center;';

  recBadgeEl = document.createElement('span');
  recBadgeEl.id = 'replay-rec-badge';
  recBadgeEl.textContent = '● REC 00:00';
  recBadgeEl.style.cssText = 'display: none; padding: 2px 7px; border-radius: 999px; background: #ef4444; color: #ffffff; font-size: 9.5px; font-weight: 900; letter-spacing: 0.08em; white-space: nowrap;';

  trackEl = document.createElement('div');
  trackEl.id = 'replay-timeline-track';
  trackEl.style.cssText = `
    position: relative;
    flex: 1;
    height: 24px;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
    overflow: visible;
  `;

  const railEl = document.createElement('div');
  railEl.style.cssText = `
    position: relative;
    width: 100%;
    height: 10px;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 999px;
    overflow: visible;
    pointer-events: none;
  `;

  fillEl = document.createElement('div');
  fillEl.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 0%;
    background: linear-gradient(90deg, #00e5ff, #3b82f6);
    border-radius: 999px;
    pointer-events: none;
  `;

  thumbEl = document.createElement('div');
  thumbEl.id = 'replay-timeline-thumb';
  thumbEl.style.cssText = `
    position: absolute;
    left: 0%;
    top: 50%;
    width: 16px;
    height: 16px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: #ffffff;
    border: 3px solid #00e5ff;
    box-shadow: 0 0 12px rgba(0, 229, 255, 0.9);
    pointer-events: none;
    z-index: 4;
  `;

  hoverTipEl = document.createElement('div');
  hoverTipEl.id = 'replay-timeline-hovertip';
  hoverTipEl.style.cssText = `
    position: absolute;
    bottom: 24px;
    left: 0%;
    transform: translateX(-50%);
    display: none;
    padding: 2px 7px;
    border-radius: 5px;
    background: rgba(6, 10, 18, 0.96);
    border: 1px solid rgba(0, 229, 255, 0.65);
    color: #ffffff;
    font-size: 10px;
    font-weight: 900;
    pointer-events: none;
    white-space: nowrap;
    z-index: 6;
  `;

  markersEl = document.createElement('div');
  markersEl.id = 'replay-goal-markers';
  markersEl.style.cssText = 'position: absolute; inset: 0; pointer-events: none; z-index: 3;';

  railEl.append(fillEl, markersEl, thumbEl);
  trackEl.append(railEl, hoverTipEl);

  const clientXToFrame = (clientX) => {
    const status = replayManager.getPlaybackStatus();
    if (!status.active || status.totalFrames <= 0) return { frac: 0, frame: 0, valid: false };
    const rect = trackEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return { frac, frame: frac * status.totalFrames, valid: true };
  };

  const updateHoverTip = (clientX) => {
    const info = clientXToFrame(clientX);
    if (!info.valid) {
      hoverTipEl.style.display = 'none';
      return info;
    }
    hoverTipEl.style.display = 'block';
    hoverTipEl.style.left = `${(info.frac * 100).toFixed(2)}%`;
    hoverTipEl.textContent = formatFramesAsTime(info.frame);
    return info;
  };

  trackEl.addEventListener('pointerdown', (ev) => {
    if (ev.target?.closest?.('.replay-goal-marker')) return;
    const info = updateHoverTip(ev.clientX);
    if (!info.valid) return;
    ev.preventDefault();
    isScrubbingTimeline = true;
    wasPausedBeforeScrub = replayManager.isPlaybackPaused();
    replayManager.setPlaybackPaused(true);
    try { trackEl.setPointerCapture(ev.pointerId); } catch (_) {}
    callbacks.onSeek?.(info.frame);
  });

  trackEl.addEventListener('pointermove', (ev) => {
    const info = updateHoverTip(ev.clientX);
    if (isScrubbingTimeline && info.valid) {
      callbacks.onSeek?.(info.frame);
    }
  });

  const finishScrub = (ev) => {
    if (!isScrubbingTimeline) return;
    isScrubbingTimeline = false;
    try { trackEl.releasePointerCapture(ev.pointerId); } catch (_) {}
    replayManager.setPlaybackPaused(wasPausedBeforeScrub);
    lastUiSignature = '';
  };
  trackEl.addEventListener('pointerup', finishScrub);
  trackEl.addEventListener('pointercancel', finishScrub);
  trackEl.addEventListener('pointerleave', () => {
    if (!isScrubbingTimeline) hoverTipEl.style.display = 'none';
  });

  timeLabelEl = document.createElement('span');
  timeLabelEl.id = 'replay-time-label';
  timeLabelEl.style.cssText = 'font-size: 11.5px; font-weight: 900; color: #ffffff; min-width: 96px; text-align: right; white-space: nowrap;';
  timeLabelEl.textContent = '00:00 / 00:00';

  timelineRow.append(replayBadge, statusPillEl, recBadgeEl, trackEl, timeLabelEl);
  dockEl.appendChild(timelineRow);

  // Row 1b: Clickable Goal Scorer Strip (shows who scored every goal, auto-hidden if 0 goals)
  goalsStripEl = document.createElement('div');
  goalsStripEl.id = 'replay-goals-strip';
  goalsStripEl.style.cssText = 'display: none; align-items: center; gap: 5px; overflow-x: auto; padding: 2px 0 4px 0; scrollbar-width: thin;';
  dockEl.appendChild(goalsStripEl);

  // Row 2: Prominent Media Transport Controls + Slow-Mo + Speed Pills + Export / Clean / Exit
  const controlsRow = document.createElement('div');
  controlsRow.style.cssText = 'display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 5px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);';

  const makeTransportBtn = (id, label, title, onClick, extraCss = '') => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = label;
    b.title = title;
    b.style.cssText = `
      padding: 5px 8px;
      font-size: 10.5px;
      font-weight: 900;
      font-family: inherit;
      letter-spacing: 0.05em;
      color: #f8fafc;
      background: rgba(255, 255, 255, 0.10);
      border: 1.5px solid rgba(255, 255, 255, 0.28);
      border-radius: 7px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
      ${extraCss}
    `;
    b.onclick = onClick;
    return b;
  };

  const transportGroup = document.createElement('div');
  transportGroup.style.cssText = 'display: flex; align-items: center; gap: 4px; flex-wrap: wrap;';

  const prevGoalBtn = makeTransportBtn('replay-btn-prev-goal', '⏮', 'Jump to previous goal or match start (,)', () => {
    callbacks.onJumpGoal?.(-1);
  });

  rewModeBtnEl = makeTransportBtn('replay-btn-rewind', '⏪ REW', 'Continuous Rewind (-1x / -2x / -4x) [R]', () => {
    replayManager.cycleRewind();
    lastUiSignature = '';
  }, 'border-color: rgba(245, 158, 11, 0.55); color: #fcd34d;');

  const stepBackBtn = makeTransportBtn('replay-btn-step-back', '-5s', 'Skip back 5 seconds (J)', () => {
    const st = replayManager.getPlaybackStatus();
    callbacks.onSeek?.(Math.max(0, st.cursor - 300));
  }, 'padding: 5px 7px; font-size: 10px;');

  playBtnEl = makeTransportBtn('replay-btn-playpause', '⏸ PAUSE', 'Play / Pause (Space)', () => {
    replayManager.togglePlaybackPaused();
    lastUiSignature = '';
  }, 'padding: 5px 12px; font-size: 11px; min-width: 92px; background: #00e5ff; color: #06101c; border-color: #ffffff; box-shadow: 0 0 14px rgba(0, 229, 255, 0.45);');

  slowMoBtnEl = makeTransportBtn('replay-btn-slomo', 'SLO-MO', 'Cycle Slow-Motion (0.5x / 0.25x / 0.1x / 1x) [M]', () => {
    replayManager.cycleSlowMo();
    lastUiSignature = '';
  }, 'border-color: rgba(16, 185, 129, 0.65); color: #6ee7b7;');

  const stepFwdBtn = makeTransportBtn('replay-btn-step-fwd', '+5s', 'Skip forward 5 seconds (L)', () => {
    const st = replayManager.getPlaybackStatus();
    callbacks.onSeek?.(Math.min(st.totalFrames, st.cursor + 300));
  }, 'padding: 5px 7px; font-size: 10px;');

  ffwModeBtnEl = makeTransportBtn('replay-btn-ffw', '⏩ FFW', 'Fast-Forward (2x / 4x / 1x) [ ] ]', () => {
    replayManager.cycleFastForward();
    lastUiSignature = '';
  }, 'border-color: rgba(168, 85, 247, 0.65); color: #e9d5ff;');

  const nextGoalBtn = makeTransportBtn('replay-btn-next-goal', '⏭', 'Jump to next goal or match end (.)', () => {
    callbacks.onJumpGoal?.(1);
  });

  transportGroup.append(prevGoalBtn, rewModeBtnEl, stepBackBtn, playBtnEl, slowMoBtnEl, stepFwdBtn, ffwModeBtnEl, nextGoalBtn);

  const speedGroup = document.createElement('div');
  speedGroup.style.cssText = 'display: flex; align-items: center; gap: 3px;';
  speedBtns = FORWARD_SPEED_PILLS.map((spd) => {
    const b = makeDockBtn(`${spd}x`, `Set playback speed ${spd}x ([ / ])`, () => {
      replayManager.setPlaybackSpeed(spd);
      replayManager.setPlaybackPaused(false);
      lastUiSignature = '';
    });
    b.style.padding = '3px 6px';
    b.dataset.speed = String(spd);
    speedGroup.appendChild(b);
    return b;
  });

  const rightGroup = document.createElement('div');
  rightGroup.style.cssText = 'display: flex; align-items: center; gap: 4px; flex-wrap: wrap;';

  recBtnEl = makeDockBtn('● REC [V]', 'Record clean WebGL canvas video clip (.webm, zero dock overlay)', () => {
    toggleReplayVideoClip();
  }, '#fb7185');
  recBtnEl.id = 'replay-btn-rec';

  const saveBtn = makeDockBtn('SAVE', 'Download current match replay file (.vbreplay)', () => {
    replayManager.downloadLastReplay();
  }, '#4ade80');
  saveBtn.id = 'replay-btn-save';

  const loadBtn = makeDockBtn('LOAD', 'Open a saved .vbreplay file from disk', () => {
    fileInputEl?.click();
  }, '#38bdf8');
  loadBtn.id = 'replay-btn-load';

  const cleanBtn = makeDockBtn('CLEAN [H]', 'Hide Dock and overlays for clean OBS footage (H to restore)', () => {
    toggleReplayCleanFootage();
  }, '#fbb417');
  cleanBtn.id = 'replay-btn-clean';

  const exitBtn = makeDockBtn('EXIT', 'Stop replay playback and return to menu', () => {
    stopReplayVideoClip();
    callbacks.onExitReplay?.();
  }, '#ff2e55');
  exitBtn.id = 'replay-btn-exit';

  rightGroup.append(recBtnEl, saveBtn, loadBtn, cleanBtn, exitBtn);
  controlsRow.append(transportGroup, speedGroup, rightGroup);
  dockEl.appendChild(controlsRow);

  // Row 3: Target Athlete Chips (P1..P4) + Camera Height (- / +) + All 7 Camera Presets
  const cameraRow = document.createElement('div');
  cameraRow.style.cssText = 'display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px;';

  targetGroupEl = document.createElement('div');
  targetGroupEl.id = 'replay-target-group';
  targetGroupEl.style.cssText = 'display: flex; align-items: center; gap: 4px; flex-wrap: wrap;';

  const heightGroup = document.createElement('div');
  heightGroup.id = 'replay-height-group';
  heightGroup.style.cssText = 'display: flex; align-items: center; gap: 3px;';
  const heightLbl = document.createElement('span');
  heightLbl.textContent = 'HEIGHT:';
  heightLbl.style.cssText = 'font-size: 9.5px; font-weight: 900; color: #94a3b8; letter-spacing: 0.08em; margin-right: 2px;';

  const bindHoldHeightBtn = (btn, dir) => {
    btn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      heightButtonHoldDir = dir;
      heightButtonHoldStartMs = performance.now();
    });
  };

  const heightDownBtn = makeDockBtn('-', 'Lower camera height (Hold or click, keys: - / PageDown / Q)', () => {}, '#38bdf8');
  heightDownBtn.id = 'replay-btn-height-down';
  heightDownBtn.style.minWidth = '26px';
  heightDownBtn.style.fontSize = '12px';
  bindHoldHeightBtn(heightDownBtn, -1);

  heightReadoutEl = makeDockBtn('H 0.0m', 'Current camera height (Click to reset)', () => {
    callbacks.onAdjustHeight?.(0, true);
    lastUiSignature = '';
  }, '#cbd5e1');
  heightReadoutEl.id = 'replay-btn-height-reset';
  heightReadoutEl.style.minWidth = '64px';

  const heightUpBtn = makeDockBtn('+', 'Raise camera height (Hold or click, keys: + / PageUp / E)', () => {}, '#38bdf8');
  heightUpBtn.id = 'replay-btn-height-up';
  heightUpBtn.style.minWidth = '26px';
  heightUpBtn.style.fontSize = '12px';
  bindHoldHeightBtn(heightUpBtn, 1);

  heightGroup.append(heightLbl, heightDownBtn, heightReadoutEl, heightUpBtn);

  const camGroup = document.createElement('div');
  camGroup.style.cssText = 'display: flex; align-items: center; gap: 4px; flex-wrap: wrap;';
  const camLbl = document.createElement('span');
  camLbl.textContent = 'VIEW:';
  camLbl.style.cssText = 'font-size: 9.5px; font-weight: 900; color: #94a3b8; letter-spacing: 0.08em; margin-right: 2px;';
  camGroup.appendChild(camLbl);

  camBtns = CAMERA_BUTTONS.map((c) => {
    const b = makeDockBtn(`${c.key}:${c.label}`, `Switch camera (${c.key})`, () => {
      callbacks.onSelectCamera?.(c.id);
    });
    b.style.padding = '3px 6px';
    b.id = `replay-cam-${c.id}`;
    b.dataset.cam = c.id;
    camGroup.appendChild(b);
    return b;
  });

  cameraRow.append(targetGroupEl, heightGroup, camGroup);
  dockEl.appendChild(cameraRow);

  // Row 4: Contextual Shortcut / Free-Drone Hint Bar
  droneHintEl = document.createElement('div');
  droneHintEl.id = 'replay-free-drone-hint';
  droneHintEl.style.cssText = `
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 12px;
    padding-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 9.5px;
    color: #94a3b8;
  `;
  dockEl.appendChild(droneHintEl);

  // Floating Broadcast Goal Scorer Callout Banner (appears cleanly during goal window)
  goalBannerEl = document.createElement('div');
  goalBannerEl.id = 'replay-goal-banner';
  goalBannerEl.style.cssText = `
    position: fixed;
    top: 72px;
    left: 50%;
    transform: translateX(-50%);
    display: none;
    align-items: center;
    gap: 10px;
    padding: 7px 16px;
    border-radius: 999px;
    background: rgba(6, 11, 20, 0.92);
    border: 2px solid #00e5ff;
    color: #ffffff;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.07em;
    pointer-events: none;
    z-index: 615;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.65);
    white-space: nowrap;
  `;
  document.body.appendChild(goalBannerEl);

  document.body.appendChild(dockEl);
  return dockEl;
}

function rebuildPlayerTargetChips(meta) {
  if (!targetGroupEl) return;
  const count = meta?.playerCount >= 4 ? 4 : 2;
  const players = Array.isArray(meta?.players) ? meta.players : [];
  targetGroupEl.innerHTML = '';
  targetBtns = [];

  const lbl = document.createElement('span');
  lbl.textContent = 'PLAYER [TAB]:';
  lbl.style.cssText = 'font-size: 9.5px; font-weight: 900; color: #94a3b8; letter-spacing: 0.08em; margin-right: 2px;';
  targetGroupEl.appendChild(lbl);

  for (let i = 0; i < count; i++) {
    const p = players[i] || {};
    const teamHex = toHexCss(p.primaryColor, i % 2 === 0 ? '#d90429' : '#1d4ed8');
    const shortName = `P${i + 1}`;
    const b = document.createElement('button');
    b.id = `replay-target-p${i + 1}`;
    b.dataset.slot = String(i);
    b.dataset.hex = teamHex;
    b.title = `Follow ${p.displayName || shortName} (${p.team === 'away' ? 'Away' : 'Home'})`;
    b.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 8px;
      font-size: 10px;
      font-weight: 900;
      font-family: inherit;
      letter-spacing: 0.05em;
      color: #cbd5e1;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 5px;
      cursor: pointer;
      white-space: nowrap;
    `;
    b.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${teamHex};display:inline-block;box-shadow:0 0 6px ${teamHex};"></span><span>${shortName}</span>`;
    b.onclick = () => {
      callbacks.onSelectFollowSlot?.(i);
    };
    targetBtns.push(b);
    targetGroupEl.appendChild(b);
  }
}

function installReplayListeners() {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;

  window.addEventListener('keydown', (e) => {
    if (!replayManager.isPlayingBack() || callbacks.isMenuOpen?.()) return;
    if (isTypingTarget(e.target)) return;

    freeKeysHeld.add(e.code);
    if (e.repeat) return;

    if (e.code === 'Space') {
      e.preventDefault();
      replayManager.togglePlaybackPaused();
    } else if (e.code === 'Tab') {
      e.preventDefault();
      const nextSlot = replayManager.cycleFollowSlot(e.shiftKey ? -1 : 1);
      callbacks.onSelectFollowSlot?.(nextSlot);
    } else if (e.code === 'KeyJ') {
      e.preventDefault();
      const st = replayManager.getPlaybackStatus();
      callbacks.onSeek?.(Math.max(0, st.cursor - 300));
    } else if (e.code === 'KeyL') {
      e.preventDefault();
      const st = replayManager.getPlaybackStatus();
      callbacks.onSeek?.(Math.min(st.totalFrames, st.cursor + 300));
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      replayManager.cycleRewind();
    } else if (e.code === 'KeyM') {
      e.preventDefault();
      replayManager.cycleSlowMo();
    } else if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.code === 'PageUp') {
      e.preventDefault();
      if (replayManager.getCameraPreset() !== 'free') {
        callbacks.onAdjustHeight?.(1.0, false);
        lastUiSignature = '';
      }
    } else if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.code === 'PageDown') {
      e.preventDefault();
      if (replayManager.getCameraPreset() !== 'free') {
        callbacks.onAdjustHeight?.(-1.0, false);
        lastUiSignature = '';
      }
    } else if (e.code === 'Digit0' || e.code === 'Numpad0') {
      e.preventDefault();
      callbacks.onAdjustHeight?.(0, true);
      lastUiSignature = '';
    } else if (e.code === 'Comma') {
      e.preventDefault();
      callbacks.onJumpGoal?.(-1);
    } else if (e.code === 'Period') {
      e.preventDefault();
      callbacks.onJumpGoal?.(1);
    } else if (e.code === 'BracketLeft') {
      e.preventDefault();
      replayManager.cyclePlaybackSpeed(-1);
    } else if (e.code === 'BracketRight') {
      e.preventDefault();
      replayManager.cyclePlaybackSpeed(1);
    } else if (e.code === 'Digit1') {
      callbacks.onSelectCamera?.('broadcast');
    } else if (e.code === 'Digit2') {
      callbacks.onSelectCamera?.('sports');
    } else if (e.code === 'Digit3') {
      callbacks.onSelectCamera?.('tactical');
    } else if (e.code === 'Digit4') {
      callbacks.onSelectCamera?.('chase');
    } else if (e.code === 'Digit5') {
      callbacks.onSelectCamera?.('thirdPerson');
    } else if (e.code === 'Digit6') {
      callbacks.onSelectCamera?.('firstPerson');
    } else if (e.code === 'Digit7' || e.code === 'KeyF') {
      callbacks.onSelectCamera?.('free');
    } else if (e.code === 'KeyV') {
      e.preventDefault();
      toggleReplayVideoClip();
    } else if (e.code === 'KeyH' && !e.shiftKey) {
      e.preventDefault();
      toggleReplayCleanFootage();
    }
  });

  window.addEventListener('keyup', (e) => {
    freeKeysHeld.delete(e.code);
  });

  window.addEventListener('blur', () => {
    freeKeysHeld.clear();
    isDraggingLook = false;
    heightButtonHoldDir = 0;
  });

  window.addEventListener('mousedown', (e) => {
    if (!replayManager.isPlayingBack() || replayManager.getCameraPreset() !== 'free') return;
    if (callbacks.isMenuOpen?.()) return;
    if (dockEl && dockEl.contains(e.target)) return;
    if (e.button === 0 || e.button === 2) {
      isDraggingLook = true;
      lastDragX = e.clientX;
      lastDragY = e.clientY;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDraggingLook) return;
    if (!replayManager.isPlayingBack() || replayManager.getCameraPreset() !== 'free') {
      isDraggingLook = false;
      return;
    }
    const dx = e.clientX - lastDragX;
    const dy = e.clientY - lastDragY;
    lastDragX = e.clientX;
    lastDragY = e.clientY;
    callbacks.onFreeLookDelta?.(-dx * 0.0042, -dy * 0.0036);
  });

  window.addEventListener('mouseup', () => {
    isDraggingLook = false;
  });

  const endHeightButtonHold = () => {
    if (heightButtonHoldDir === 0) return;
    const dir = heightButtonHoldDir;
    const heldMs = performance.now() - heightButtonHoldStartMs;
    heightButtonHoldDir = 0;
    if (heldMs < 180) {
      callbacks.onAdjustHeight?.(dir * 1.5, false);
      lastUiSignature = '';
    }
  };
  window.addEventListener('pointerup', endHeightButtonHold);
  window.addEventListener('pointercancel', endHeightButtonHold);

  window.addEventListener('wheel', (e) => {
    if (!replayManager.isPlayingBack() || replayManager.getCameraPreset() !== 'free') return;
    if (callbacks.isMenuOpen?.()) return;
    if (dockEl && dockEl.contains(e.target)) return;
    callbacks.onFreeFovDelta?.(e.deltaY > 0 ? 3.0 : -3.0);
  }, { passive: true });
}

function pollReplayDirectorGamepads() {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
  const raw = navigator.getGamepads();
  if (!raw) return;
  const pads = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] && raw[i].connected) pads.push(raw[i]);
  }
  if (pads.length === 0) return;

  replayPads.update(pads);
  const isFree = replayManager.getCameraPreset() === 'free';
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i];
    const e = replayPads.pressed(pad);
    if (!e) continue;

    if (e & MENU_PAD.a) replayManager.togglePlaybackPaused();
    if (e & MENU_PAD.x) toggleReplayCleanFootage();
    if (e & MENU_PAD.y) {
      const cur = replayManager.getPlaybackSpeed();
      const idx = FORWARD_SPEED_PILLS.indexOf(cur);
      replayManager.setPlaybackSpeed(FORWARD_SPEED_PILLS[(idx + 1) % FORWARD_SPEED_PILLS.length]);
    }
    if (e & MENU_PAD.left) {
      const nextCam = replayManager.cycleCameraPreset(-1);
      callbacks.onSelectCamera?.(nextCam);
    } else if (e & MENU_PAD.right) {
      const nextCam = replayManager.cycleCameraPreset(1);
      callbacks.onSelectCamera?.(nextCam);
    }
    if (!isFree) {
      if (e & MENU_PAD.lb) {
        const nextSlot = replayManager.cycleFollowSlot(-1);
        callbacks.onSelectFollowSlot?.(nextSlot);
      } else if (e & MENU_PAD.rb) {
        const nextSlot = replayManager.cycleFollowSlot(1);
        callbacks.onSelectFollowSlot?.(nextSlot);
      }
      if (e & MENU_PAD.down) {
        const st = replayManager.getPlaybackStatus();
        callbacks.onSeek?.(Math.max(0, st.cursor - 300));
      } else if (e & MENU_PAD.up) {
        const st = replayManager.getPlaybackStatus();
        callbacks.onSeek?.(Math.min(st.totalFrames, st.cursor + 300));
      }
    }
  }
}

export function toggleReplayCleanFootage(forceHidden = null) {
  dockHiddenForCleanFootage = forceHidden === null ? !dockHiddenForCleanFootage : Boolean(forceHidden);
  if (dockHiddenForCleanFootage) {
    setCleanBroadcastHud();
    callbacks.onCleanFootage?.(true);
  } else {
    callbacks.onCleanFootage?.(false);
  }
  return dockHiddenForCleanFootage;
}

export function isReplayDockHidden() {
  return dockHiddenForCleanFootage;
}

export function resetReplayDockState() {
  stopReplayVideoClip();
  dockHiddenForCleanFootage = false;
  freeKeysHeld.clear();
  isDraggingLook = false;
  isScrubbingTimeline = false;
  heightButtonHoldDir = 0;
  lastDockUpdateMs = 0;
  lastGoalsSignature = '';
  lastPlayersSignature = '';
  lastUiSignature = '';
  lastBannerSignature = '';
  goalChipBtns = [];
  replayPads.reset();
  if (hoverTipEl) hoverTipEl.style.display = 'none';
  if (goalBannerEl) goalBannerEl.style.display = 'none';
  if (goalsStripEl) goalsStripEl.style.display = 'none';
  if (dockEl) dockEl.style.display = 'none';
}

export function initReplayDock(cbs = {}) {
  Object.assign(callbacks, cbs);
  buildDock();
  installReplayListeners();
}

/**
 * Samples keyboard + gamepad inputs for the Free-Fly Caster Drone camera (zero allocations).
 */
export function sampleFreeDroneInput() {
  let mf = (freeKeysHeld.has('KeyW') ? 1 : 0) - (freeKeysHeld.has('KeyS') ? 1 : 0);
  let mr = (freeKeysHeld.has('KeyD') ? 1 : 0) - (freeKeysHeld.has('KeyA') ? 1 : 0);
  const upHeld = freeKeysHeld.has('KeyE')
    || freeKeysHeld.has('Equal')
    || freeKeysHeld.has('NumpadAdd')
    || freeKeysHeld.has('PageUp')
    || heightButtonHoldDir > 0;
  const downHeld = freeKeysHeld.has('KeyQ')
    || freeKeysHeld.has('Minus')
    || freeKeysHeld.has('NumpadSubtract')
    || freeKeysHeld.has('PageDown')
    || heightButtonHoldDir < 0;
  let mu = (upHeld ? 1 : 0) - (downHeld ? 1 : 0);
  let yawRate = (freeKeysHeld.has('ArrowRight') ? 1.8 : 0) - (freeKeysHeld.has('ArrowLeft') ? 1.8 : 0);
  let pitchRate = (freeKeysHeld.has('ArrowDown') ? 1.4 : 0) - (freeKeysHeld.has('ArrowUp') ? 1.4 : 0);
  let fast = freeKeysHeld.has('ShiftLeft') || freeKeysHeld.has('ShiftRight');
  let slow = freeKeysHeld.has('AltLeft') || freeKeysHeld.has('AltRight');

  if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || !p.connected) continue;
      const lx = Math.abs(p.axes[0] || 0) > 0.14 ? p.axes[0] : 0;
      const ly = Math.abs(p.axes[1] || 0) > 0.14 ? p.axes[1] : 0;
      const rx = Math.abs(p.axes[2] || 0) > 0.14 ? p.axes[2] : 0;
      const ry = Math.abs(p.axes[3] || 0) > 0.14 ? p.axes[3] : 0;
      const lt = p.buttons[6]?.value || 0;
      const rt = p.buttons[7]?.value || 0;
      if (lx || ly || rx || ry || lt > 0.1 || rt > 0.1) {
        mr += lx;
        mf -= ly;
        mu += (rt - lt);
        yawRate += rx * 2.1;
        pitchRate += ry * 1.6;
        if (p.buttons[5]?.pressed) fast = true;
        if (p.buttons[4]?.pressed) slow = true;
        break;
      }
    }
  }

  _freeInputScratch.moveForward = mf;
  _freeInputScratch.moveRight = mr;
  _freeInputScratch.moveUp = mu;
  _freeInputScratch.lookYawRate = yawRate;
  _freeInputScratch.lookPitchRate = pitchRate;
  _freeInputScratch.fast = fast;
  _freeInputScratch.slow = slow;
  return _freeInputScratch;
}

/**
 * Updates the Broadcast Replay Director Dock DOM during `render()`.
 */
export function updateReplayDock({ isMenuOpen = false } = {}) {
  const el = buildDock();
  if (!el) return;

  const status = replayManager.getPlaybackStatus();
  if (!status.active || isMenuOpen) {
    if (el.style.display !== 'none') el.style.display = 'none';
    if (goalBannerEl && goalBannerEl.style.display !== 'none') goalBannerEl.style.display = 'none';
    lastDockUpdateMs = 0;
    return;
  }

  const nowMs = performance.now();
  const dt = lastDockUpdateMs > 0 ? Math.min(0.05, Math.max(0.001, (nowMs - lastDockUpdateMs) / 1000)) : 1 / 60;
  lastDockUpdateMs = nowMs;

  pollReplayDirectorGamepads();

  // Continuous smooth camera height adjustment while holding + / - / PageUp / PageDown or dock buttons
  if (status.cameraPreset !== 'free') {
    const upHeld = freeKeysHeld.has('Equal') || freeKeysHeld.has('NumpadAdd') || freeKeysHeld.has('PageUp') || heightButtonHoldDir > 0;
    const downHeld = freeKeysHeld.has('Minus') || freeKeysHeld.has('NumpadSubtract') || freeKeysHeld.has('PageDown') || heightButtonHoldDir < 0;
    const dir = (upHeld ? 1 : 0) - (downHeld ? 1 : 0);
    if (dir !== 0) {
      const fast = freeKeysHeld.has('ShiftLeft') || freeKeysHeld.has('ShiftRight');
      const slow = freeKeysHeld.has('AltLeft') || freeKeysHeld.has('AltRight');
      const rate = slow ? 4.0 : (fast ? 24.0 : 12.0);
      callbacks.onAdjustHeight?.(dir * rate * dt, false);
    }
  }

  if (dockHiddenForCleanFootage) {
    if (el.style.display !== 'none') el.style.display = 'none';
    if (goalBannerEl && goalBannerEl.style.display !== 'none') goalBannerEl.style.display = 'none';
    return;
  }

  if (el.style.display !== 'flex') el.style.display = 'flex';
  if (typeof document !== 'undefined' && document.pointerLockElement && typeof document.exitPointerLock === 'function') {
    try { document.exitPointerLock(); } catch (_) {}
  }

  const total = Math.max(1, status.totalFrames);
  const pct = Math.max(0, Math.min(100, (status.cursor / total) * 100));
  if (fillEl) fillEl.style.width = `${pct.toFixed(2)}%`;
  if (thumbEl) thumbEl.style.left = `${pct.toFixed(2)}%`;

  // Rebuild P1..P4 target chips only when replay metadata changes
  const pCount = status.meta?.playerCount >= 4 ? 4 : 2;
  const playersSig = `${pCount}:${(status.meta?.players || []).map((p) => `${p.primaryColor}:${p.displayName}`).join(',')}`;
  if (playersSig !== lastPlayersSignature) {
    lastPlayersSignature = playersSig;
    rebuildPlayerTargetChips(status.meta);
  }

  // Rebuild team/player-colored timeline goal markers AND clickable Goal Scorer Strip
  const goalsSig = `${total}:${playersSig}:${status.goals.map((g) => `${g.frame}:${g.scoredFor}:${g.scorerSlot}:${g.assistSlot}`).join('|')}`;
  if (markersEl && goalsSig !== lastGoalsSignature) {
    lastGoalsSignature = goalsSig;
    markersEl.innerHTML = '';
    goalChipBtns = [];
    if (goalsStripEl) goalsStripEl.innerHTML = '';

    if (goalsStripEl) {
      if (status.goals.length > 0) {
        goalsStripEl.style.display = 'flex';
        const gLbl = document.createElement('span');
        gLbl.textContent = 'GOALS:';
        gLbl.style.cssText = 'font-size: 9.5px; font-weight: 900; color: #94a3b8; letter-spacing: 0.08em; white-space: nowrap; margin-right: 2px;';
        goalsStripEl.appendChild(gLbl);
      } else {
        goalsStripEl.style.display = 'none';
      }
    }

    let prevPinPct = -99;
    let stagger = false;
    for (let i = 0; i < status.goals.length; i++) {
      const g = status.goals[i];
      const info = describeGoalScorer(g, status.meta);
      const leftPct = Math.max(1.2, Math.min(98.8, ((g.frame || 0) / total) * 100));
      if (leftPct - prevPinPct < 5.5) stagger = !stagger;
      else stagger = false;
      prevPinPct = leftPct;

      const assistPart = info.assistTag ? ` · Assist: ${info.assistTag}` : '';
      const timeStr = formatFramesAsTime(g.frame);
      const richTitle = `Goal #${i + 1}: ${info.fullLabel}${assistPart} (${info.scoreLabel} at ${timeStr}, ${info.hoopLabel})`;

      const pin = document.createElement('button');
      pin.className = 'replay-goal-marker';
      pin.dataset.goalIndex = String(i);
      pin.title = `${richTitle} | Click to jump 3s before goal`;
      pin.style.cssText = `
        position: absolute;
        left: ${leftPct.toFixed(2)}%;
        top: -5px;
        width: 11px;
        height: 20px;
        transform: translateX(-50%);
        background: ${info.colorHex};
        border: 1.5px solid ${info.borderHex};
        border-radius: 3px;
        cursor: pointer;
        pointer-events: auto;
        padding: 0;
        box-shadow: 0 0 10px ${info.colorHex}aa;
        overflow: visible;
      `;

      const tag = document.createElement('span');
      tag.textContent = info.shortTag;
      tag.style.cssText = `
        position: absolute;
        left: 50%;
        top: ${stagger ? '-26px' : '-16px'};
        transform: translateX(-50%);
        padding: 0px 4px;
        border-radius: 3px;
        background: ${info.colorHex};
        color: ${info.textHex};
        border: 1px solid ${info.borderHex};
        font-size: 8.5px;
        font-weight: 900;
        line-height: 12px;
        letter-spacing: 0.04em;
        white-space: nowrap;
        pointer-events: none;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.75);
      `;
      pin.appendChild(tag);

      pin.addEventListener('pointerenter', () => {
        if (!hoverTipEl) return;
        hoverTipEl.style.display = 'block';
        hoverTipEl.style.left = `${leftPct.toFixed(2)}%`;
        hoverTipEl.textContent = `#${i + 1} ${info.fullLabel}${info.assistTag ? ` (+${info.assistTag})` : ''} · ${info.scoreLabel} · ${timeStr}`;
      });
      pin.addEventListener('pointerleave', () => {
        if (hoverTipEl && !isScrubbingTimeline) hoverTipEl.style.display = 'none';
      });
      pin.onclick = (ev) => {
        ev.stopPropagation();
        callbacks.onSeek?.(Math.max(0, (g.frame || 0) - 180));
      };
      markersEl.appendChild(pin);

      // Clickable goal chip in Goal Scorer Strip
      if (goalsStripEl) {
        const chip = document.createElement('button');
        chip.className = 'replay-goal-chip';
        chip.dataset.goalIndex = String(i);
        chip.dataset.hex = info.colorHex;
        chip.title = `${richTitle} | Click to jump 3s before goal`;
        chip.style.cssText = `
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 8px;
          font-size: 10px;
          font-weight: 800;
          font-family: inherit;
          color: #e2e8f0;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.22);
          border-radius: 999px;
          cursor: pointer;
          white-space: nowrap;
        `;
        const assistBadge = info.assistTag ? ` <span style="color:#94a3b8;font-weight:700;">(+${info.assistTag})</span>` : '';
        chip.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${info.colorHex};border:1px solid ${info.borderHex};display:inline-block;flex-shrink:0;"></span><span style="color:#94a3b8;">#${i + 1}</span><span style="color:#ffffff;font-weight:900;">${info.fullLabel}</span>${assistBadge}<span style="color:#00e5ff;">${info.scoreLabel}</span><span style="color:#94a3b8;">${timeStr}</span>`;
        chip.onclick = () => {
          callbacks.onSeek?.(Math.max(0, (g.frame || 0) - 180));
        };
        goalChipBtns.push(chip);
        goalsStripEl.appendChild(chip);
      }
    }
  }

  // Update Floating Broadcast Goal Scorer Banner (active during [goal.frame, goal.frame + 210])
  let activeBannerGoalIdx = -1;
  let activeNearGoalIdx = -1;
  for (let i = status.goals.length - 1; i >= 0; i--) {
    const gf = status.goals[i]?.frame ?? -9999;
    if (status.cursor >= gf && status.cursor <= gf + 210) {
      activeBannerGoalIdx = i;
      activeNearGoalIdx = i;
      break;
    }
    if (activeNearGoalIdx < 0 && status.cursor >= gf - 180 && status.cursor <= gf + 210) {
      activeNearGoalIdx = i;
    }
  }
  const bannerSig = `${activeBannerGoalIdx}|${playersSig}`;
  if (goalBannerEl && bannerSig !== lastBannerSignature) {
    lastBannerSignature = bannerSig;
    if (activeBannerGoalIdx >= 0) {
      const g = status.goals[activeBannerGoalIdx];
      const info = describeGoalScorer(g, status.meta);
      const assistHtml = info.assistTag
        ? `<span style="color:#cbd5e1;font-size:10.5px;font-weight:800;padding-left:6px;border-left:1px solid rgba(255,255,255,0.2);">ASSIST: ${info.assistTag}</span>`
        : '';
      goalBannerEl.style.borderColor = info.colorHex;
      goalBannerEl.style.boxShadow = `0 10px 28px rgba(0, 0, 0, 0.7), 0 0 18px ${info.colorHex}66`;
      goalBannerEl.innerHTML = `<span style="width:11px;height:11px;border-radius:50%;background:${info.colorHex};border:1.5px solid ${info.borderHex};display:inline-block;"></span><span style="color:#fbbf24;">GOAL #${activeBannerGoalIdx + 1}</span><span>${info.fullLabel}</span>${assistHtml}<span style="color:#00e5ff;">${info.scoreLabel}</span><span style="color:#94a3b8;font-size:10px;">${info.hoopLabel.toUpperCase()}</span>`;
      goalBannerEl.style.display = 'flex';
    } else {
      goalBannerEl.style.display = 'none';
    }
  }

  const rawHeight = callbacks.getCameraHeight ? callbacks.getCameraHeight() : status.cameraHeightOffset;
  const heightDisplayVal = Number.isFinite(rawHeight) ? Math.round(rawHeight * 10) / 10 : 0;

  const recNow = isRecordingClip();
  const recSec = recNow ? Math.floor((nowMs - recordingStartMs) / 1000) : -1;
  const timeKey = `${Math.floor(status.cursor / 6)}|${total}|${status.paused}|${status.speed}|${status.cameraPreset}|${status.followSlot}|${recSec}|${heightDisplayVal}|${activeNearGoalIdx}`;
  if (timeKey === lastUiSignature) return;
  lastUiSignature = timeKey;

  if (timeLabelEl) {
    timeLabelEl.textContent = `${formatFramesAsTime(status.cursor)} / ${formatFramesAsTime(status.totalFrames)}`;
  }
  const isRew = !status.paused && status.speed < 0;
  const isSlowMo = !status.paused && status.speed > 0 && status.speed < 1;
  const isFfw = !status.paused && status.speed > 1;
  if (statusPillEl) {
    if (status.paused) {
      statusPillEl.textContent = '⏸ PAUSED';
      statusPillEl.style.color = '#fbbf24';
      statusPillEl.style.borderColor = 'rgba(251, 191, 36, 0.55)';
      statusPillEl.style.background = 'rgba(251, 191, 36, 0.16)';
    } else if (isRew) {
      statusPillEl.textContent = `⏪ REW ${Math.abs(status.speed)}x`;
      statusPillEl.style.color = '#fbbf24';
      statusPillEl.style.borderColor = '#f59e0b';
      statusPillEl.style.background = 'rgba(245, 158, 11, 0.22)';
    } else if (isSlowMo) {
      statusPillEl.textContent = `SLO ${status.speed}x`;
      statusPillEl.style.color = '#34d399';
      statusPillEl.style.borderColor = '#10b981';
      statusPillEl.style.background = 'rgba(16, 185, 129, 0.22)';
    } else if (isFfw) {
      statusPillEl.textContent = `⏩ FFW ${status.speed}x`;
      statusPillEl.style.color = '#e9d5ff';
      statusPillEl.style.borderColor = '#a855f7';
      statusPillEl.style.background = 'rgba(168, 85, 247, 0.24)';
    } else {
      statusPillEl.textContent = `▶ ${status.speed}x`;
      statusPillEl.style.color = '#00e5ff';
      statusPillEl.style.borderColor = 'rgba(0, 229, 255, 0.45)';
      statusPillEl.style.background = 'rgba(0, 229, 255, 0.16)';
    }
  }
  if (playBtnEl) {
    if (status.paused) {
      playBtnEl.textContent = '▶ PLAY';
      playBtnEl.style.background = '#22c55e';
      playBtnEl.style.color = '#04120a';
      playBtnEl.style.borderColor = '#ffffff';
      playBtnEl.style.boxShadow = '0 0 16px rgba(34, 197, 94, 0.6)';
    } else {
      playBtnEl.textContent = '⏸ PAUSE';
      playBtnEl.style.background = '#00e5ff';
      playBtnEl.style.color = '#06101c';
      playBtnEl.style.borderColor = '#ffffff';
      playBtnEl.style.boxShadow = '0 0 14px rgba(0, 229, 255, 0.45)';
    }
  }
  if (slowMoBtnEl) {
    slowMoBtnEl.textContent = isSlowMo ? `SLO ${status.speed}x` : 'SLO-MO';
    slowMoBtnEl.style.background = isSlowMo ? '#10b981' : 'rgba(255, 255, 255, 0.10)';
    slowMoBtnEl.style.color = isSlowMo ? '#04120a' : '#6ee7b7';
    slowMoBtnEl.style.borderColor = isSlowMo ? '#ffffff' : 'rgba(16, 185, 129, 0.65)';
    slowMoBtnEl.style.boxShadow = isSlowMo ? '0 0 14px rgba(16, 185, 129, 0.55)' : 'none';
  }
  if (rewModeBtnEl) {
    rewModeBtnEl.textContent = isRew ? `⏪ ${Math.abs(status.speed)}x` : '⏪ REW';
    rewModeBtnEl.style.background = isRew ? '#f59e0b' : 'rgba(255, 255, 255, 0.10)';
    rewModeBtnEl.style.color = isRew ? '#0b0a04' : '#fcd34d';
    rewModeBtnEl.style.borderColor = isRew ? '#ffffff' : 'rgba(245, 158, 11, 0.55)';
  }
  if (ffwModeBtnEl) {
    ffwModeBtnEl.textContent = isFfw ? `⏩ ${status.speed}x` : '⏩ FFW';
    ffwModeBtnEl.style.background = isFfw ? '#a855f7' : 'rgba(255, 255, 255, 0.10)';
    ffwModeBtnEl.style.color = isFfw ? '#ffffff' : '#e9d5ff';
    ffwModeBtnEl.style.borderColor = isFfw ? '#ffffff' : 'rgba(168, 85, 247, 0.65)';
  }
  if (heightReadoutEl) {
    if (status.cameraPreset === 'free') {
      heightReadoutEl.textContent = `ALT ${heightDisplayVal.toFixed(1)}m`;
      heightReadoutEl.style.color = '#38bdf8';
      heightReadoutEl.style.borderColor = 'rgba(56, 189, 248, 0.55)';
    } else {
      const sign = heightDisplayVal > 0 ? '+' : '';
      heightReadoutEl.textContent = `H ${sign}${heightDisplayVal.toFixed(1)}m`;
      const activeH = Math.abs(heightDisplayVal) > 0.05;
      heightReadoutEl.style.color = activeH ? '#38bdf8' : '#cbd5e1';
      heightReadoutEl.style.borderColor = activeH ? '#38bdf8' : 'rgba(255, 255, 255, 0.22)';
    }
  }
  for (const chip of goalChipBtns) {
    const active = Number(chip.dataset.goalIndex) === activeNearGoalIdx;
    const hex = chip.dataset.hex || '#00e5ff';
    chip.style.background = active ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)';
    chip.style.borderColor = active ? hex : 'rgba(255, 255, 255, 0.22)';
    chip.style.boxShadow = active ? `0 0 10px ${hex}66` : 'none';
  }
  if (recBadgeEl) {
    recBadgeEl.style.display = recNow ? 'inline-block' : 'none';
    if (recNow) recBadgeEl.textContent = `● REC ${formatSeconds(recSec)}`;
  }
  if (recBtnEl) {
    recBtnEl.textContent = recNow ? `■ STOP (${formatSeconds(recSec)}) [V]` : '● REC [V]';
    recBtnEl.style.background = recNow ? '#ef4444' : 'rgba(255, 255, 255, 0.08)';
    recBtnEl.style.color = recNow ? '#ffffff' : '#fb7185';
    recBtnEl.style.borderColor = recNow ? '#ffffff' : '#fb7185';
  }
  for (const b of speedBtns) {
    const spd = Number(b.dataset.speed);
    const active = !status.paused && spd === status.speed;
    const isSlowPill = spd < 1;
    b.style.background = active ? (isSlowPill ? '#10b981' : '#00e5ff') : 'rgba(255, 255, 255, 0.08)';
    b.style.color = active ? '#000000' : (isSlowPill ? '#6ee7b7' : '#cbd5e1');
    b.style.borderColor = active ? (isSlowPill ? '#10b981' : '#00e5ff') : 'rgba(255, 255, 255, 0.22)';
  }
  for (const b of camBtns) {
    const active = b.dataset.cam === status.cameraPreset;
    b.style.background = active ? '#3b82f6' : 'rgba(255, 255, 255, 0.08)';
    b.style.color = active ? '#ffffff' : '#cbd5e1';
    b.style.borderColor = active ? '#60a5fa' : 'rgba(255, 255, 255, 0.22)';
  }
  for (const b of targetBtns) {
    const active = Number(b.dataset.slot) === status.followSlot;
    const hex = b.dataset.hex || '#00e5ff';
    b.style.background = active ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.05)';
    b.style.borderColor = active ? hex : 'rgba(255, 255, 255, 0.20)';
    b.style.color = active ? '#ffffff' : '#94a3b8';
    b.style.boxShadow = active ? `0 0 10px ${hex}66` : 'none';
  }
  if (droneHintEl) {
    if (status.cameraPreset === 'free') {
      droneHintEl.innerHTML = '<span><b style="color:#00e5ff;">FREE DRONE</b></span><span><b>WASD / L-Stick</b> Fly</span><span><b>+ / - / Q / E / LT / RT</b> Height</span><span><b>Drag / R-Stick</b> Look</span><span><b>Wheel</b> FOV Zoom</span><span><b>M</b> Slow-Mo · <b>Shift / RB</b> Fast · <b>Alt / LB</b> Slow Glide</span><span><b>V</b> .webm Clip</span>';
    } else {
      droneHintEl.innerHTML = '<span><b>Drag Timeline</b> Instant Scrub</span><span><b>Space / A</b> Play / Pause</span><span><b>M</b> Slow-Mo · <b>R</b> Rewind · <b>+ / -</b> Camera Height (0 Reset)</span><span><b>, / .</b> Prev / Next Goal</span><span><b>TAB / LB-RB</b> Athlete (P1 to P4)</span><span><b>1-7</b> Camera · <b>V</b> Clip · <b>H</b> Clean</span>';
    }
  }
}
