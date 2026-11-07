import { createBrandBall } from '../../../visuals/brandBall.js';
import { state } from './state.js';

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

  const btnPractice = createMenuButton('PRACTICE SANDBOX', 'rgba(255, 255, 255, 0.12)', () => {
    navActions.onPractice?.();
  });
  btnPractice.id = 'btn-practice-sandbox';

  const btnPlayMatch = createMenuButton('PLAY MATCH (1v1 VERSUS)', '#ffffff', () => {
    navActions.onPlayMatch?.();
  });
  btnPlayMatch.id = 'btn-play-match';
  btnPlayMatch.style.color = '#000000';
  btnPlayMatch.style.fontWeight = '900';
  btnPlayMatch.style.border = '2px solid #ffffff';
  btnPlayMatch.style.boxShadow = '0 4px 20px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25)';
  btnPlayMatch.onmouseleave = () => {
    if (state.titleFocusIndex !== 1) {
      btnPlayMatch.style.transform = 'translateX(0)';
      btnPlayMatch.style.borderColor = '#ffffff';
      btnPlayMatch.style.boxShadow = '0 4px 20px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25)';
    }
  };

  // 2v2 Versus Item (4 Athletes)
  const btnMatch2v2 = createMenuButton('PLAY MATCH (2v2 VERSUS)', 'rgba(0, 229, 255, 0.14)', () => {
    navActions.onPlayMatch2v2?.();
  });
  btnMatch2v2.id = 'btn-play-match-2v2';
  btnMatch2v2.innerHTML = `
    <span style="display:flex;align-items:center;gap:8px;">PLAY MATCH (2v2 VERSUS)</span>
    <span class="contextual-btn-badge" style="background:rgba(0,229,255,0.2);color:#00e5ff;border:1px solid rgba(0,229,255,0.5);font-weight:900;">4 ATHLETES</span>
  `;

  const btnSettings = createMenuButton('SETTINGS', 'rgba(255, 255, 255, 0.08)', () => {
    navActions.onSettings?.();
  });
  btnSettings.id = 'btn-title-settings';

  const btnHowToPlay = createMenuButton('HOW TO PLAY', 'rgba(255, 255, 255, 0.08)', () => {
    navActions.onHowToPlay?.();
  });
  btnHowToPlay.id = 'btn-title-how-to-play';

  // In-Browser Link Buttons
  const btnValleyballVS = createMenuButton('VALLEYBALLVS.COM ↗', 'rgba(0, 229, 255, 0.08)', () => {
    window.open('https://ValleyballVS.com', '_blank');
  });
  btnValleyballVS.id = 'btn-link-valleyball-vs';
  btnValleyballVS.innerHTML = `
    <span style="display:flex;align-items:center;gap:8px;">VALLEYBALLVS.COM</span>
    <span class="contextual-btn-badge" style="background:rgba(0,229,255,0.18);color:#00e5ff;border:1px solid rgba(0,229,255,0.45);">VISIT SITE ↗</span>
  `;

  const btnValleyballOrg = createMenuButton('VALLEYBALL.ORG ↗', 'rgba(255, 255, 255, 0.08)', () => {
    window.open('https://Valleyball.org', '_blank');
  });
  btnValleyballOrg.id = 'btn-link-valleyball-org';
  btnValleyballOrg.innerHTML = `
    <span style="display:flex;align-items:center;gap:8px;">VALLEYBALL.ORG</span>
    <span class="contextual-btn-badge" style="background:rgba(255,255,255,0.15);color:#ffffff;border:1px solid rgba(255,255,255,0.35);">ORGANIZATION ↗</span>
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
  state.titleFocusIndex = 1;
  state.titleButtons.forEach((btn, idx) => {
    btn.onmouseenter = () => {
      state.titleFocusIndex = idx;
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
    gap: 10px;
    padding: 8px 14px;
    margin-top: 4px;
    background: rgba(11, 17, 26, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #cbd5e1;
    width: 100%;
    box-sizing: border-box;
    user-select: none;
  `;
  promptBar.innerHTML = `
    <span>🎮 ANY CONTROLLER</span>
    <span style="color:#475569;">&middot;</span>
    <span><b style="color:#ffffff;">↕</b> NAVIGATE</span>
    <span style="color:#475569;">&middot;</span>
    <span><b style="color:#00e5ff;">A / START / ENTER</b> SELECT</span>
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
    const isPlayMatch = btn.id === 'btn-play-match';
    if (idx === state.titleFocusIndex) {
      btn.classList.add('rainbow-focused');
      btn.style.transform = 'translateX(-10px) scale(1.02)';
      try { btn.focus(); } catch (_) {}
    } else {
      btn.classList.remove('rainbow-focused');
      btn.style.transform = 'translateX(0) scale(1)';
      btn.style.borderColor = isPlayMatch ? '#ffffff' : 'rgba(255, 255, 255, 0.2)';
      btn.style.boxShadow = isPlayMatch ? '0 4px 20px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25)' : '0 4px 16px rgba(0, 0, 0, 0.4)';
      btn.style.outline = 'none';
    }
  });
}

export function createMenuButton(text, bg, onClick) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = `
    padding: 15px 22px;
    font-size: 14px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.1em;
    color: #ffffff;
    background: ${bg};
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    transition: all 0.15s ease;
  `;
  btn.onmouseenter = () => {
    btn.style.transform = 'translateX(-8px)';
    btn.style.borderColor = '#ffffff';
    btn.style.boxShadow = '0 6px 20px rgba(255, 255, 255, 0.2)';
  };
  btn.onmouseleave = () => {
    btn.style.transform = 'translateX(0)';
    btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    btn.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.4)';
  };
  btn.onclick = onClick;
  return btn;
}
