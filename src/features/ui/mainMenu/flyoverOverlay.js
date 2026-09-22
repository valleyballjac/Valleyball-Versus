/**
 * Pre-Match Cutscene Overlay: Matchup presentation banner with skippable prompt.
 */
let flyoverOverlayEl = null;
let flyoverTimerEl = null;
let flyoverMatchupEl = null;
let onSkipCallback = null;
let rootContainer = null;

export function buildFlyoverOverlay(rootEl, onSkipFlyover) {
  rootContainer = rootEl;
  onSkipCallback = onSkipFlyover;

  flyoverOverlayEl = document.createElement('div');
  flyoverOverlayEl.id = 'flyover-overlay';
  flyoverOverlayEl.style.cssText = `
    position: fixed;
    inset: 0;
    display: none;
    flex-direction: column;
    justify-content: space-between;
    padding: 40px 60px;
    pointer-events: none;
    z-index: 700;
    background: linear-gradient(to bottom, rgba(4,7,12,0.65) 0%, transparent 25%, transparent 75%, rgba(4,7,12,0.75) 100%);
  `;

  // Top Matchup Banner
  const topBox = document.createElement('div');
  topBox.style.cssText = 'display: flex; flex-direction: column; align-items: center; text-align: center;';

  const arenaTag = document.createElement('div');
  arenaTag.textContent = 'VALLEY BASIN ARENA · 1v1 MATCH';
  arenaTag.style.cssText = 'font-size: 13px; font-weight: 700; letter-spacing: 0.2em; color: #94a3b8; margin-bottom: 4px;';

  flyoverMatchupEl = document.createElement('div');
  flyoverMatchupEl.style.cssText = `
    font-size: 36px;
    font-weight: 900;
    letter-spacing: 0.08em;
    color: #ffffff;
    text-shadow: 0 4px 20px rgba(0, 0, 0, 0.9);
  `;
  flyoverMatchupEl.innerHTML = '<span style="color: #d90429;">RED</span> <span style="color: #64748b; font-size: 24px;">VS</span> <span style="color: #1d4ed8;">BLUE</span>';

  topBox.appendChild(arenaTag);
  topBox.appendChild(flyoverMatchupEl);

  // Bottom Skip Prompt
  const botBox = document.createElement('div');
  botBox.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-end; width: 100%;';

  const cameraInfo = document.createElement('div');
  cameraInfo.style.cssText = 'font-size: 11px; font-weight: 600; color: #64748b; letter-spacing: 0.06em;';
  cameraInfo.textContent = 'AERIAL ARENA SWEEP';

  const skipBtn = document.createElement('button');
  skipBtn.id = 'btn-skip-flyover';
  skipBtn.innerHTML = 'SKIP INTRO [SPACE / A] <span style="margin-left: 4px;">⏭</span>';
  skipBtn.style.cssText = `
    pointer-events: auto;
    padding: 10px 18px;
    font-size: 12px;
    font-weight: 800;
    font-family: inherit;
    color: #ffffff;
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 6px;
    cursor: pointer;
    letter-spacing: 0.08em;
    backdrop-filter: blur(4px);
    transition: all 0.15s ease;
  `;
  skipBtn.onmouseenter = () => { skipBtn.style.background = 'rgba(255, 255, 255, 0.25)'; };
  skipBtn.onmouseleave = () => { skipBtn.style.background = 'rgba(255, 255, 255, 0.15)'; };
  skipBtn.onclick = () => {
    if (onSkipCallback) onSkipCallback();
  };

  botBox.appendChild(cameraInfo);
  botBox.appendChild(skipBtn);

  flyoverOverlayEl.appendChild(topBox);
  flyoverOverlayEl.appendChild(botBox);
  if (rootContainer) rootContainer.appendChild(flyoverOverlayEl);

  return flyoverOverlayEl;
}

export function showFlyoverOverlay(
  p1Name = 'HOME',
  p2Name = 'AWAY',
  p1Color = '#ff4d6d',
  p2Color = '#60a5fa',
) {
  if (!flyoverOverlayEl) return;
  if (rootContainer) rootContainer.style.pointerEvents = 'auto';
  flyoverOverlayEl.style.display = 'flex';
  if (flyoverMatchupEl) {
    flyoverMatchupEl.innerHTML = `<span style="color: ${p1Color};">${p1Name}</span> <span style="color: #64748b; font-size: 24px;">VS</span> <span style="color: ${p2Color};">${p2Name}</span>`;
  }
}

export function hideFlyoverOverlay() {
  if (flyoverOverlayEl) flyoverOverlayEl.style.display = 'none';
  if (rootContainer) rootContainer.style.pointerEvents = 'none';
}

export function getFlyoverOverlayEl() {
  return flyoverOverlayEl;
}
