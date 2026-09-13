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

export function initCountdownOverlay() {
  if (overlayEl) return;

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
  if (overlayEl) overlayEl.style.display = 'none';
}

/**
 * Updates countdown display each frame.
 * @param {number} countdownSeconds Integer seconds remaining (5 to 0)
 * @param {boolean} isCountingDown True if match is in pre-match countdown
 * @param {number} delta Frame delta seconds
 */
export function updateCountdownOverlay(countdownSeconds, isCountingDown, delta = 0.016) {
  if (!overlayEl) return;

  if (isCountingDown && countdownSeconds > 0) {
    overlayEl.style.display = 'flex';
    goTimer = 0.85; // queue "GO!" duration when zero hits

    if (countdownSeconds !== lastDisplayedSec) {
      lastDisplayedSec = countdownSeconds;
      numberEl.textContent = String(countdownSeconds);
      labelEl.textContent = 'GET READY';

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
    // Show "GO!" flash
    overlayEl.style.display = 'flex';
    goTimer -= delta;
    labelEl.textContent = 'VALLEYBALL';
    numberEl.textContent = 'GO!';
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
