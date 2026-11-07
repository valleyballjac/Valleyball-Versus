/**
 * Arcade Countdown Overlay for Valleyball Versus Match Mode.
 *
 * Renders a bold, pulsing 5... 4... 3... 2... 1... GO! sequence
 * during pre-match positioning so players can get their bearings.
 */

let overlayEl = null;
let numberEl = null;
let labelEl = null;
let lastDisplayedSec = -1;
let goTimer = 0;
let splitFramesContainerEl = null;
let splitFrameEls = [];
let watermarkHoldTimer = 0;

function toHexColor(num, fallback = '#ff2e55') {
  if (typeof num === 'string' && num.startsWith('#')) return num;
  if (typeof num === 'number' && Number.isFinite(num)) {
    return '#' + (num & 0xffffff).toString(16).padStart(6, '0');
  }
  return fallback;
}

export function initCountdownOverlay() {
  if (overlayEl) return;

  splitFramesContainerEl = document.createElement('div');
  splitFramesContainerEl.id = 'splitscreen-viewport-frames';
  splitFramesContainerEl.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    user-select: none;
    z-index: 440;
    display: none;
    box-sizing: border-box;
  `;

  splitFrameEls = [];
  for (let i = 0; i < 4; i++) {
    const frame = document.createElement('div');
    frame.className = 'splitscreen-viewport-frame';
    frame.dataset.frameIndex = String(i);
    frame.style.cssText = `
      position: absolute;
      box-sizing: border-box;
      pointer-events: none;
      display: none;
      transition: border-color 0.2s ease;
    `;

    const badge = document.createElement('div');
    badge.className = 'splitscreen-viewport-watermark';
    badge.style.cssText = `
      position: absolute;
      bottom: 14px;
      left: 14px;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 5px 11px;
      border-radius: 6px;
      background: rgba(11, 13, 20, 0.82);
      backdrop-filter: blur(6px);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.12em;
      color: #f8fafc;
      text-transform: uppercase;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.55);
      transition: opacity 0.2s ease;
    `;

    const dot = document.createElement('span');
    dot.className = 'splitscreen-watermark-dot';
    dot.style.cssText = `
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    `;

    const text = document.createElement('span');
    text.className = 'splitscreen-watermark-text';

    badge.appendChild(dot);
    badge.appendChild(text);
    frame.appendChild(badge);
    splitFramesContainerEl.appendChild(frame);
    splitFrameEls.push({ frame, badge, dot, text });
  }
  document.body.appendChild(splitFramesContainerEl);

  overlayEl = document.createElement('div');
  overlayEl.id = 'countdown-overlay';
  overlayEl.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    user-select: none;
    z-index: 500;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    text-align: center;
  `;

  labelEl = document.createElement('div');
  labelEl.textContent = 'MATCH STARTING IN';
  labelEl.style.cssText = `
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.22em;
    color: #ffffff;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.9), 0 0 20px rgba(255, 255, 255, 0.5);
    margin-bottom: 4px;
    text-transform: uppercase;
  `;

  numberEl = document.createElement('div');
  numberEl.textContent = '5';
  numberEl.style.cssText = `
    font-size: 96px;
    font-weight: 900;
    line-height: 1;
    letter-spacing: 0.04em;
    color: #ffffff;
    text-shadow: 0 4px 24px rgba(0, 0, 0, 0.9), 0 0 35px rgba(255, 255, 255, 0.8), 0 0 50px rgba(0, 229, 255, 0.35);
    transition: transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  `;

  overlayEl.appendChild(labelEl);
  overlayEl.appendChild(numberEl);
  document.body.appendChild(overlayEl);
}

export function resetCountdownOverlay() {
  lastDisplayedSec = -1;
  goTimer = 0;
  watermarkHoldTimer = 3.5;
  if (overlayEl) overlayEl.style.display = 'none';
  if (splitFramesContainerEl) splitFramesContainerEl.style.display = 'none';
}

function updateSplitscreenFrames(isCountingDown, delta) {
  if (!splitFramesContainerEl) return;
  const vb = typeof window !== 'undefined' ? window.__vb : null;
  const gameState = vb?.getGameState?.() || 'menu';
  const tuning = vb?.tuning;
  const victoryOverlay = document.getElementById('victory-overlay');
  const isVictoryVisible = Boolean(victoryOverlay && victoryOverlay.style.display === 'flex');
  const dividerEl = document.getElementById('splitscreen-divider');
  const isSplitDividerActive = Boolean(dividerEl && dividerEl.style.display === 'block');
  const isSplitscreen = gameState === 'match' && !isVictoryVisible && (isSplitDividerActive || Boolean(tuning?.camera?.splitscreen));

  if (!isSplitscreen) {
    splitFramesContainerEl.style.display = 'none';
    return;
  }

  const athletes = vb?.athletes || [];
  const configs = vb?.getPlayerConfigs?.() || tuning?.players || [];
  const humanSlots = [];
  for (let i = 0; i < athletes.length; i++) {
    if (!athletes[i]?.isEnabled) continue;
    const cfg = configs[i] || tuning?.players?.[i];
    if (cfg?.type === 'human') humanSlots.push(i);
  }
  if (humanSlots.length < 2) {
    humanSlots.length = 0;
    for (let i = 0; i < athletes.length; i++) {
      if (athletes[i]?.isEnabled) humanSlots.push(i);
    }
  }
  if (humanSlots.length < 2) {
    splitFramesContainerEl.style.display = 'none';
    return;
  }

  const matchState = vb?.matchState;
  const fixedHz = tuning?.loop?.fixedHz || 60;
  const totalTicks = (tuning?.match?.durationSeconds || 300) * fixedHz;
  const elapsedMatchSec = matchState && typeof matchState.ticksRemaining === 'number'
    ? Math.max(0, (totalTicks - matchState.ticksRemaining) / fixedHz)
    : 0;

  if (isCountingDown) {
    watermarkHoldTimer = 2.8;
  } else if (watermarkHoldTimer > 0) {
    watermarkHoldTimer = Math.max(0, Math.min(watermarkHoldTimer - delta, 2.8 - elapsedMatchSec));
  }
  const showWatermark = isCountingDown || watermarkHoldTimer > 0;
  const watermarkOpacity = isCountingDown ? 1 : Math.min(1, watermarkHoldTimer / 0.8);

  splitFramesContainerEl.style.display = 'block';
  const isQuad = humanSlots.length > 2;
  const viewports = isQuad
    ? [
        { slot: 0, top: '0%', left: '0%', width: '50%', height: '50%' },
        { slot: 1, top: '0%', left: '50%', width: '50%', height: '50%' },
        { slot: 2, top: '50%', left: '0%', width: '50%', height: '50%' },
        { slot: 3, top: '50%', left: '50%', width: '50%', height: '50%' },
      ]
    : [
        { slot: humanSlots[0] ?? 0, top: '0%', left: '0%', width: '50%', height: '100%' },
        { slot: humanSlots[1] ?? 1, top: '0%', left: '50%', width: '50%', height: '100%' },
      ];

  for (let i = 0; i < splitFrameEls.length; i++) {
    const item = splitFrameEls[i];
    const vp = viewports[i];
    if (!vp) {
      item.frame.style.display = 'none';
      continue;
    }
    const slot = vp.slot;
    const ath = athletes[slot];
    const cfg = configs[slot] || tuning?.players?.[slot] || {};
    const team = ath?.team || cfg?.team || ((slot === 0 || slot === 2) ? 'home' : 'away');
    const teamNum = (slot === 0 || slot === 2) ? 1 : 2;
    const kitLabel = team === 'away' ? 'AWAY' : 'HOME';
    const rawColor = ath?.primaryColor ?? cfg?.primaryColor ?? (
      team === 'away'
        ? (tuning?.athlete?.palette?.awayPrimary ?? 0x1d4ed8)
        : (tuning?.athlete?.palette?.homePrimary ?? 0xd90429)
    );
    const teamHex = toHexColor(rawColor, team === 'away' ? '#3b82f6' : '#ff2e55');

    item.frame.style.display = 'block';
    item.frame.style.top = vp.top;
    item.frame.style.left = vp.left;
    item.frame.style.width = vp.width;
    item.frame.style.height = vp.height;
    item.frame.style.border = `2.5px solid ${teamHex}`;
    item.frame.style.boxShadow = `inset 0 0 14px ${teamHex}40`;
    item.frame.dataset.playerSlot = String(slot);
    item.frame.dataset.teamColor = teamHex;

    if (showWatermark && watermarkOpacity > 0.01) {
      item.badge.style.display = 'inline-flex';
      item.badge.style.opacity = watermarkOpacity.toFixed(3);
      item.badge.style.border = `1.5px solid ${teamHex}`;
      item.dot.style.background = teamHex;
      item.dot.style.boxShadow = `0 0 8px ${teamHex}`;
      item.text.textContent = `PLAYER ${slot + 1} · TEAM ${teamNum} (${kitLabel})`;
    } else {
      item.badge.style.display = 'none';
      item.badge.style.opacity = '0';
    }
  }
}

/**
 * Updates countdown display each frame.
 * @param {number} countdownSeconds Integer seconds remaining (5 to 0)
 * @param {boolean} isCountingDown True if match is in pre-match countdown
 * @param {number} delta Frame delta seconds
 */
export function updateCountdownOverlay(countdownSeconds, isCountingDown, delta = 0.016) {
  if (!overlayEl) return;
  updateSplitscreenFrames(isCountingDown, delta);

  if (isCountingDown && countdownSeconds > 0) {
    overlayEl.style.display = 'flex';
    goTimer = 0.85; // queue "GO!" duration when zero hits

    if (countdownSeconds !== lastDisplayedSec) {
      lastDisplayedSec = countdownSeconds;
      numberEl.textContent = String(countdownSeconds);
      labelEl.textContent = countdownSeconds > 3 ? 'SERVICE' : 'GET READY';

      // Pulse animation
      numberEl.style.transform = 'scale(1.35)';
      setTimeout(() => {
        if (numberEl) numberEl.style.transform = 'scale(1.0)';
      }, 100);

      // Chromatic rainbow glow progression: 5,4 cyan glow -> 3,2 amber glow -> 1 crimson glow
      numberEl.style.color = '#ffffff';
      if (countdownSeconds > 3) {
        numberEl.style.textShadow = '0 4px 24px rgba(0, 0, 0, 0.9), 0 0 30px rgba(255, 255, 255, 0.8), 0 0 45px rgba(0, 229, 255, 0.45)';
      } else if (countdownSeconds > 1) {
        numberEl.style.textShadow = '0 4px 24px rgba(0, 0, 0, 0.9), 0 0 30px rgba(255, 255, 255, 0.8), 0 0 45px rgba(251, 180, 23, 0.45)';
      } else {
        numberEl.style.textShadow = '0 4px 24px rgba(0, 0, 0, 0.9), 0 0 35px rgba(255, 255, 255, 0.9), 0 0 50px rgba(255, 46, 85, 0.55)';
      }
    }
  } else if (goTimer > 0) {
    // Show "PLAY!" flash
    overlayEl.style.display = 'flex';
    goTimer -= delta;
    labelEl.textContent = 'VALLEYBALL';
    numberEl.textContent = 'PLAY!';
    numberEl.style.color = '#ffffff';
    numberEl.style.textShadow = '0 4px 24px rgba(0, 0, 0, 0.9), 0 0 40px rgba(255, 255, 255, 0.95), 0 0 60px rgba(74, 222, 128, 0.6)';
    numberEl.style.transform = 'scale(1.2)';

    if (goTimer <= 0) {
      overlayEl.style.display = 'none';
      lastDisplayedSec = -1;
    }
  } else {
    overlayEl.style.display = 'none';
  }
}
