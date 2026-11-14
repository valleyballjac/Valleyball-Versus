import { createBrandBall } from '../../../visuals/brandBall.js';
import { state } from './state.js';
import { renderCardinalDiamondSvg } from './constants.js';

const QUIT_LABEL = 'QUIT TO DESKTOP';
const QUIT_ARMED_LABEL = 'PRESS AGAIN TO QUIT';

/**
 * Reversed rainbow palette (Violet at top -> Red at bottom reserved for Quit).
 * Every button shares a homogenized dark-glass base opacity and typography.
 */
const TITLE_RAINBOW_PALETTE = [
  { hex: '#a855f7', rgb: '168, 85, 247' }, // 0: Practice Sandbox (Violet)
  { hex: '#3b82f6', rgb: '59, 130, 246' }, // 1: Play Match 1v1 (Blue)
  { hex: '#00e5ff', rgb: '0, 229, 255' },  // 2: Play Match 2v2 (Cyan)
  { hex: '#10b981', rgb: '16, 185, 129' }, // 3: Settings (Emerald)
  { hex: '#84cc16', rgb: '132, 204, 22' }, // 4: How To Play (Lime Green)
  { hex: '#fbb417', rgb: '251, 180, 23' }, // 5: ValleyballVS.com (Gold)
  { hex: '#ff6b35', rgb: '255, 107, 53' }, // 6: Valleyball.org (Orange)
  { hex: '#ff2e55', rgb: '255, 46, 85' },  // 7: Quit to Desktop (Red)
];

/**
 * Main Menu Title Screen
 */
export function buildTitleScreen(rootEl, navActions = {}) {
  const titleScreenEl = document.createElement('div');
  titleScreenEl.id = 'title-screen';
  titleScreenEl.style.cssText = `
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    padding: clamp(32px, 5vh, 56px) clamp(44px, 5.5vw, 84px);
    box-sizing: border-box;
    background: radial-gradient(circle at 50% 45%, rgba(6, 10, 16, 0.18) 0%, rgba(4, 7, 12, 0.85) 100%);
    pointer-events: auto;
    transition: opacity 0.3s ease;
  `;

  // Left Brand Lockup: 3D Globe Ball + Rainbow VALLEYBALL + Outlined VERSUS v0.4.0
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: fit-content;
    user-select: none;
    padding: 24px 16px;
  `;

  // 3D Spinning Globe Ball
  const ballContainer = document.createElement('div');
  ballContainer.id = 'title-brand-ball-container';
  ballContainer.style.cssText = `
    width: 176px;
    height: 176px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 12px;
    position: relative;
  `;
  state.titleBrandBall = createBrandBall(ballContainer, { size: 176, speed: 0.35, tilt: 0.25 });

  const title = document.createElement('h1');
  title.textContent = 'VALLEYBALL';
  title.style.cssText = `
    font-size: clamp(46px, 4.2vw, 62px);
    font-weight: 900;
    letter-spacing: 0.14em;
    margin: 0;
    text-transform: uppercase;
    background: linear-gradient(90deg, #ff2e55 0%, #ff6b35 15%, #fbb417 30%, #4ade80 46%, #00e5ff 62%, #3b82f6 78%, #a855f7 90%, #ec4899 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    filter: drop-shadow(0 4px 18px rgba(0, 0, 0, 0.75)) drop-shadow(0 0 24px rgba(0, 229, 255, 0.25));
    line-height: 1.05;
  `;

  const tagRow = document.createElement('div');
  tagRow.style.cssText = `
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
  `;

  const tag = document.createElement('div');
  tag.textContent = 'VERSUS';
  tag.style.cssText = `
    font-size: 16px;
    font-weight: 900;
    letter-spacing: 0.45em;
    text-indent: 0.45em;
    color: #000000;
    -webkit-text-stroke: 1.5px #ffffff;
    text-stroke: 1.5px #ffffff;
    filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.85));
    line-height: 1.2;
  `;

  const versionBadge = document.createElement('div');
  versionBadge.textContent = 'v0.4.0';
  versionBadge.style.cssText = `
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: #00e5ff;
    background: rgba(0, 229, 255, 0.12);
    border: 1px solid rgba(0, 229, 255, 0.35);
    padding: 2px 8px;
    border-radius: 4px;
    box-shadow: 0 0 10px rgba(0, 229, 255, 0.15);
  `;

  tagRow.appendChild(tag);
  tagRow.appendChild(versionBadge);

  header.appendChild(ballContainer);
  header.appendChild(title);
  header.appendChild(tagRow);

  // Menu Options (Right Side, Balanced & Symmetrical)
  const menuList = document.createElement('div');
  menuList.style.cssText = `
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: stretch;
    gap: 12px;
    width: clamp(340px, 28vw, 385px);
  `;

  const btnPractice = createMenuButton('PRACTICE SANDBOX', TITLE_RAINBOW_PALETTE[0], () => {
    navActions.onPractice?.();
  });
  btnPractice.id = 'btn-practice-sandbox';

  const btnPlayMatch = createMenuButton('PLAY MATCH (1v1 VERSUS)', TITLE_RAINBOW_PALETTE[1], () => {
    navActions.onPlayMatch?.();
  });
  btnPlayMatch.id = 'btn-play-match';
  btnPlayMatch.innerHTML = `
    <span style="display:flex;align-items:center;gap:8px;">PLAY MATCH (1v1 VERSUS)</span>
    <span class="contextual-btn-badge" style="background:rgba(59,130,246,0.22);color:#93c5fd;border:1px solid rgba(59,130,246,0.55);font-weight:900;">2 ATHLETES</span>
  `;

  // 2v2 Versus Item (4 Athletes)
  const btnMatch2v2 = createMenuButton('PLAY MATCH (2v2 VERSUS)', TITLE_RAINBOW_PALETTE[2], () => {
    navActions.onPlayMatch2v2?.();
  });
  btnMatch2v2.id = 'btn-play-match-2v2';
  btnMatch2v2.innerHTML = `
    <span style="display:flex;align-items:center;gap:8px;">PLAY MATCH (2v2 VERSUS)</span>
    <span class="contextual-btn-badge" style="background:rgba(0,229,255,0.2);color:#00e5ff;border:1px solid rgba(0,229,255,0.5);font-weight:900;">4 ATHLETES</span>
  `;

  const btnSettings = createMenuButton('SETTINGS', TITLE_RAINBOW_PALETTE[3], () => {
    navActions.onSettings?.();
  });
  btnSettings.id = 'btn-title-settings';

  const btnHowToPlay = createMenuButton('HOW TO PLAY', TITLE_RAINBOW_PALETTE[4], () => {
    navActions.onHowToPlay?.();
  });
  btnHowToPlay.id = 'btn-title-how-to-play';

  // In-Browser Link Buttons
  const btnValleyballVS = createMenuButton('VALLEYBALLVS.COM ↗', TITLE_RAINBOW_PALETTE[5], () => {
    window.open('https://ValleyballVS.com', '_blank');
  });
  btnValleyballVS.id = 'btn-link-valleyball-vs';
  btnValleyballVS.innerHTML = `
    <span style="display:flex;align-items:center;gap:8px;">VALLEYBALLVS.COM</span>
    <span class="contextual-btn-badge" style="background:rgba(251,180,23,0.18);color:#fde047;border:1px solid rgba(251,180,23,0.48);">VISIT SITE ↗</span>
  `;

  const btnValleyballOrg = createMenuButton('VALLEYBALL.ORG ↗', TITLE_RAINBOW_PALETTE[6], () => {
    window.open('https://Valleyball.org', '_blank');
  });
  btnValleyballOrg.id = 'btn-link-valleyball-org';
  btnValleyballOrg.innerHTML = `
    <span style="display:flex;align-items:center;gap:8px;">VALLEYBALL.ORG</span>
    <span class="contextual-btn-badge" style="background:rgba(255,107,53,0.18);color:#fdba74;border:1px solid rgba(255,107,53,0.48);">ORGANIZATION ↗</span>
  `;

  menuList.appendChild(btnPractice);
  menuList.appendChild(btnPlayMatch);
  menuList.appendChild(btnMatch2v2);
  menuList.appendChild(btnSettings);
  menuList.appendChild(btnHowToPlay);
  menuList.appendChild(btnValleyballVS);
  menuList.appendChild(btnValleyballOrg);

  state.titleButtons = [
    btnPractice,
    btnPlayMatch,
    btnMatch2v2,
    btnSettings,
    btnHowToPlay,
    btnValleyballVS,
    btnValleyballOrg,
  ];

  // Desktop build only (electron/preload.cjs). Fullscreen has no other exit but
  // Alt+F4. Navigation wraps, so one press up from the top lands here: the
  // first press arms it and only a second press quits.
  const desktop = typeof window !== 'undefined' ? window.desktopAPI : undefined;
  if (desktop?.isDesktop) {
    const btnQuit = createMenuButton(QUIT_LABEL, TITLE_RAINBOW_PALETTE[7], () => {
      if (btnQuit.dataset.armed === '1') {
        desktop.quit();
        return;
      }
      btnQuit.dataset.armed = '1';
      btnQuit.textContent = QUIT_ARMED_LABEL;
    });
    btnQuit.id = 'btn-title-quit';
    menuList.appendChild(btnQuit);
    state.titleButtons.push(btnQuit);
  }
  state.titleFocusIndex = 1;
  state.titleButtons.forEach((btn, idx) => {
    btn.onmouseenter = () => {
      state.titleFocusIndex = idx;
      updateTitleFocusUI();
    };
    btn.onmouseleave = () => {
      updateTitleFocusUI();
    };
  });
  updateTitleFocusUI();

  const promptBar = document.createElement('div');
  promptBar.id = 'title-controller-prompt';
  promptBar.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 12px;
    margin-top: 4px;
    background: rgba(11, 17, 26, 0.82);
    border: 1px solid rgba(0, 229, 255, 0.35);
    border-radius: 8px;
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.07em;
    color: #cbd5e1;
    width: 100%;
    box-sizing: border-box;
    user-select: none;
  `;
  promptBar.innerHTML = `
    <span style="color:#00e5ff;font-weight:900;">🎮 P1 CONTROL</span>
    <span style="color:#475569;">&middot;</span>
    <span><b style="color:#ffffff;">↕</b> NAVIGATE</span>
    <span style="color:#475569;">&middot;</span>
    <span style="display:inline-flex;align-items:center;gap:4px;">${renderCardinalDiamondSvg('south', 13)} <b style="color:#4ade80;">✕/A / START / ENTER</b> SELECT</span>
  `;
  menuList.appendChild(promptBar);

  titleScreenEl.appendChild(header);
  titleScreenEl.appendChild(menuList);
  if (rootEl) rootEl.appendChild(titleScreenEl);

  state.titleScreenEl = titleScreenEl;
  return titleScreenEl;
}

export function updateTitleFocusUI() {
  state.titleButtons.forEach((btn, idx) => {
    if (!btn) return;
    const palette = TITLE_RAINBOW_PALETTE[idx] || TITLE_RAINBOW_PALETTE[0];
    const isFocused = idx === state.titleFocusIndex;
    btn.classList.remove('rainbow-focused');
    btn.style.outline = 'none';
    if (isFocused) {
      btn.style.transform = 'translateX(-10px) scale(1.02)';
      btn.style.background = `linear-gradient(90deg, rgba(${palette.rgb}, 0.28) 0%, rgba(15, 23, 42, 0.88) 100%)`;
      btn.style.borderColor = palette.hex;
      btn.style.borderLeft = `6px solid ${palette.hex}`;
      btn.style.boxShadow = `0 0 20px rgba(${palette.rgb}, 0.48), 0 6px 20px rgba(0, 0, 0, 0.55)`;
      try { btn.focus(); } catch (_) {}
    } else {
      if (btn.dataset.armed) {
        delete btn.dataset.armed;
        btn.textContent = QUIT_LABEL;
      }
      btn.style.transform = 'translateX(0) scale(1)';
      btn.style.background = `linear-gradient(90deg, rgba(${palette.rgb}, 0.12) 0%, rgba(15, 23, 42, 0.78) 65%)`;
      btn.style.borderColor = `rgba(${palette.rgb}, 0.42)`;
      btn.style.borderLeft = `5px solid ${palette.hex}`;
      btn.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.45)';
    }
  });
}

export function createMenuButton(text, paletteOrBg, onClick) {
  const palette = (paletteOrBg && typeof paletteOrBg === 'object')
    ? paletteOrBg
    : { hex: '#00e5ff', rgb: '0, 229, 255' };
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.dataset.accentHex = palette.hex;
  btn.dataset.accentRgb = palette.rgb;
  btn.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 15px 22px;
    font-size: 14px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.1em;
    color: #ffffff;
    background: linear-gradient(90deg, rgba(${palette.rgb}, 0.12) 0%, rgba(15, 23, 42, 0.78) 65%);
    border: 1.5px solid rgba(${palette.rgb}, 0.42);
    border-left: 5px solid ${palette.hex};
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
    transition: all 0.15s ease;
  `;
  btn.onclick = onClick;
  return btn;
}
