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
    flex-direction: column;
    justify-content: space-between;
    padding: 48px 64px;
    background: radial-gradient(circle at 35% 45%, rgba(6, 10, 16, 0.2) 0%, rgba(4, 7, 12, 0.85) 100%);
    pointer-events: auto;
    transition: opacity 0.3s ease;
  `;

  // Top Header (Brand Lockup: 3D Globe Ball + Rainbow VALLEYBALL + Outlined VERSUS)
  const header = document.createElement('div');
  header.style.cssText = `
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: fit-content;
    user-select: none;
  `;

  // 3D Spinning Globe Ball
  const ballContainer = document.createElement('div');
  ballContainer.id = 'title-brand-ball-container';
  ballContainer.style.cssText = `
    width: 140px;
    height: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 2px;
    position: relative;
  `;
  state.titleBrandBall = createBrandBall(ballContainer, { size: 140, speed: 0.35, tilt: 0.25 });

  const title = document.createElement('h1');
  title.textContent = 'VALLEYBALL';
  title.style.cssText = `
    font-size: 52px;
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
    margin-top: 6px;
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
  versionBadge.textContent = 'v0.2.3';
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

  // Menu Options (Bottom Left)
  const menuList = document.createElement('div');
  menuList.style.cssText = 'display: flex; flex-direction: column; gap: 14px; width: 360px; margin-bottom: 24px;';

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

  // Unselectable 2v2 Versus Item
  const btnMatch2v2 = document.createElement('div');
  btnMatch2v2.id = 'btn-play-match-2v2-soon';
  btnMatch2v2.style.cssText = `
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.35);
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    cursor: not-allowed;
    user-select: none;
    pointer-events: none;
  `;
  btnMatch2v2.innerHTML = `
    <span>PLAY MATCH (2v2 VERSUS)</span>
    <span style="font-size: 10px; font-weight: 800; letter-spacing: 0.14em; padding: 3px 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.08); color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.25);">COMING SOON</span>
  `;

  const btnSettings = createMenuButton('SETTINGS', 'rgba(255, 255, 255, 0.08)', () => {
    navActions.onSettings?.();
  });
  btnSettings.id = 'btn-title-settings';

  const btnHowToPlay = createMenuButton('HOW TO PLAY', 'rgba(255, 255, 255, 0.08)', () => {
    navActions.onHowToPlay?.();
  });
  btnHowToPlay.id = 'btn-title-how-to-play';

  menuList.appendChild(btnPractice);
  menuList.appendChild(btnPlayMatch);
  menuList.appendChild(btnMatch2v2);
  menuList.appendChild(btnSettings);
  menuList.appendChild(btnHowToPlay);

  state.titleButtons = [btnPractice, btnPlayMatch, btnSettings, btnHowToPlay];
  state.titleFocusIndex = 0;
  state.titleButtons.forEach((btn, idx) => {
    btn.onmouseenter = () => {
      state.titleFocusIndex = idx;
      updateTitleFocusUI();
    };
  });
  updateTitleFocusUI();

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
      btn.style.transform = 'translateX(12px)';
      btn.style.borderColor = '#ffffff';
      btn.style.boxShadow = '0 0 22px rgba(255, 255, 255, 0.6), 0 0 25px rgba(0, 229, 255, 0.3), 0 0 35px rgba(255, 46, 85, 0.25)';
      btn.style.outline = '2px solid #ffffff';
      btn.style.outlineOffset = '2px';
      try { btn.focus(); } catch (_) {}
    } else {
      btn.style.transform = 'translateX(0)';
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
    padding: 16px 24px;
    font-size: 15px;
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
    btn.style.transform = 'translateX(8px)';
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
