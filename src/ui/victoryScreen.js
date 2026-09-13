import { TUNING } from '../config/tuning.js';
import { getColorName } from './mainMenu.js';

/**
 * Arcade Victory Screen overlay for Valleyball Versus Match Mode.
 */

let overlayElement = null;
let titleElement = null;
let scoreElement = null;
let subtitleElement = null;
let statsContainer = null;
let rematchBtn = null;
let isVisible = false;

let activeVictoryButtons = [];
let victoryFocusIndex = 0;
let victoryPollHandle = null;
let victoryPrevPad = { left: false, right: false, up: false, down: false, a: false, start: false };

let bannerElement = null;
let btnRowElement = null;
let defaultCallbacks = { onRematch: null, onPracticeMode: null, onMainMenu: null };

export function initVictoryScreen({ onRematch, onPracticeMode, onMainMenu }) {
  if (overlayElement) return;
  defaultCallbacks = { onRematch, onPracticeMode, onMainMenu };

  overlayElement = document.createElement('div');
  overlayElement.id = 'victory-overlay';
  overlayElement.style.cssText = `
    position: fixed;
    inset: 0;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(6, 10, 16, 0.88);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    z-index: 1000;
    user-select: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  `;

  const container = document.createElement('div');
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 32px 48px;
    background: rgba(14, 20, 30, 0.95);
    border: 2px solid rgba(120, 170, 210, 0.35);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7);
    max-width: 520px;
    width: 90%;
    text-align: center;
  `;

  const brandBadge = document.createElement('div');
  brandBadge.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 6px;
  `;
  brandBadge.innerHTML = `
    <span style="font-size: 18px; font-weight: 900; letter-spacing: 0.12em; background: linear-gradient(90deg, #ff2e55 0%, #ff6b35 20%, #fbb417 40%, #4ade80 60%, #00e5ff 80%, #a855f7 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">VALLEYBALL</span>
    <span style="font-size: 12px; font-weight: 900; letter-spacing: 0.25em; color: #000000; -webkit-text-stroke: 1px #ffffff; text-stroke: 1px #ffffff;">VERSUS</span>
  `;
  container.appendChild(brandBadge);

  const brandDivider = document.createElement('div');
  brandDivider.style.cssText = `
    height: 2px;
    width: 60px;
    margin: 0 auto 12px auto;
    background: linear-gradient(90deg, #ff2e55 0%, #ff6b35 20%, #fbb417 40%, #4ade80 60%, #00e5ff 80%, #a855f7 100%);
    border-radius: 1px;
    opacity: 0.8;
  `;
  container.appendChild(brandDivider);

  bannerElement = document.createElement('div');
  bannerElement.textContent = 'FULL TIME';
  bannerElement.style.cssText = `
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: #7d97ad;
    margin-bottom: 8px;
  `;

  titleElement = document.createElement('div');
  titleElement.style.cssText = `
    font-size: 32px;
    font-weight: 900;
    letter-spacing: 0.06em;
    margin-bottom: 16px;
    text-transform: uppercase;
  `;

  scoreElement = document.createElement('div');
  scoreElement.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 24px;
    font-size: 48px;
    font-weight: 900;
    margin-bottom: 12px;
  `;

  subtitleElement = document.createElement('div');
  subtitleElement.style.cssText = `
    font-size: 13px;
    color: #9cb5cb;
    margin-bottom: 18px;
  `;

  statsContainer = document.createElement('div');
  statsContainer.style.cssText = `
    width: 100%;
    margin-bottom: 24px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(120, 170, 210, 0.2);
    border-radius: 8px;
    padding: 12px 18px;
    font-size: 12px;
  `;

  btnRowElement = document.createElement('div');
  btnRowElement.style.cssText = `
    display: flex;
    gap: 16px;
    width: 100%;
    justify-content: center;
  `;

  container.appendChild(bannerElement);
  container.appendChild(titleElement);
  container.appendChild(scoreElement);
  container.appendChild(subtitleElement);
  container.appendChild(statsContainer);
  container.appendChild(btnRowElement);
  overlayElement.appendChild(container);
  document.body.appendChild(overlayElement);
}

export function showVictoryScreen(match, p1Stats = { hits: 0, whiffs: 0, accuracy: 0 }, p2Stats = { hits: 0, whiffs: 0, accuracy: 0 }) {
  if (!overlayElement) return;
  isVisible = true;
  overlayElement.style.display = 'flex';

  const homeWon = match.scoreHome > match.scoreAway;
  const awayWon = match.scoreAway > match.scoreHome;

  const homeHex = '#' + (TUNING.athlete?.palette?.homePrimary ?? 0xd90429).toString(16).padStart(6, '0');
  const awayHex = '#' + (TUNING.athlete?.palette?.awayPrimary ?? 0x1d4ed8).toString(16).padStart(6, '0');
  const p1IsHome = TUNING.players?.[0]?.team === 'home';
  const p1Color = p1IsHome ? homeHex : awayHex;
  const p2Color = p1IsHome ? awayHex : homeHex;
  const p1ColorName = getColorName(p1Color).toUpperCase();
  const p2ColorName = getColorName(p2Color).toUpperCase();
  const p1Label = p1IsHome ? `PLAYER 1 (${p1ColorName} / HOME)` : `PLAYER 1 (${p1ColorName} / AWAY)`;
  const p2Label = p1IsHome ? `PLAYER 2 (${p2ColorName} / AWAY)` : `PLAYER 2 (${p2ColorName} / HOME)`;

  if (homeWon) {
    const winnerColorName = getColorName(homeHex).toUpperCase();
    titleElement.textContent = `${winnerColorName} (${p1IsHome ? 'PLAYER 1' : 'PLAYER 2'}) WINS!`;
    titleElement.style.color = homeHex;
  } else if (awayWon) {
    const winnerColorName = getColorName(awayHex).toUpperCase();
    titleElement.textContent = `${winnerColorName} (${p1IsHome ? 'PLAYER 2' : 'PLAYER 1'}) WINS!`;
    titleElement.style.color = awayHex;
  } else {
    titleElement.textContent = 'MATCH DRAW!';
    titleElement.style.color = '#f3f4f6';
  }

  scoreElement.innerHTML = `
    <span style="color: ${homeHex};">${match.scoreHome}</span>
    <span style="color: #64748b; font-size: 32px;">-</span>
    <span style="color: ${awayHex};">${match.scoreAway}</span>
  `;

  const totalGoals = match.goals || (match.scoreHome + match.scoreAway);
  subtitleElement.textContent = `${totalGoals} Total Goal${totalGoals === 1 ? '' : 's'} · 5:00 Match Duration`;

  // Render Extended Stats Grid
  const p1Goals = p1IsHome ? match.scoreHome : match.scoreAway;
  const p2Goals = p1IsHome ? match.scoreAway : match.scoreHome;

  const p1H = p1Stats.hits || 0;
  const p1W = p1Stats.whiffs || 0;
  const p1A = p1Stats.accuracy !== undefined ? p1Stats.accuracy : (p1H + p1W > 0 ? Math.round((p1H / (p1H + p1W)) * 100) : 0);
  const p1Touches = p1Stats.totalTouches ?? (p1H + p1W);
  const p1Sweet = p1Stats.sweetSpotHits ?? 0;
  const p1Spikes = p1Stats.spikes ?? 0;
  const p1Dives = p1Stats.dives ?? 0;
  const p1DivingHits = p1Stats.divingHits ?? 0;
  const p1Def = p1Stats.ownCircleTouches ?? 0;
  const p1Att = p1Stats.oppCircleTouches ?? 0;

  const p2H = p2Stats.hits || 0;
  const p2W = p2Stats.whiffs || 0;
  const p2A = p2Stats.accuracy !== undefined ? p2Stats.accuracy : (p2H + p2W > 0 ? Math.round((p2H / (p2H + p2W)) * 100) : 0);
  const p2Touches = p2Stats.totalTouches ?? (p2H + p2W);
  const p2Sweet = p2Stats.sweetSpotHits ?? 0;
  const p2Spikes = p2Stats.spikes ?? 0;
  const p2Dives = p2Stats.dives ?? 0;
  const p2DivingHits = p2Stats.divingHits ?? 0;
  const p2Def = p2Stats.ownCircleTouches ?? 0;
  const p2Att = p2Stats.oppCircleTouches ?? 0;

  statsContainer.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 140px 1fr; gap: 8px; align-items: center; margin-bottom: 8px; font-weight: 800; font-size: 11px; letter-spacing: 0.08em;">
      <span style="color: ${p1Color}; text-align: left;">${p1Label}</span>
      <span style="color: #64748b; text-align: center;">MATCH STATS</span>
      <span style="color: ${p2Color}; text-align: right;">${p2Label}</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 140px 1fr; gap: 8px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #ef4444; text-align: left; font-size: 13px;">${p1Goals}</span>
      <span style="color: #94a3b8; text-align: center; font-size: 11px;">GOALS</span>
      <span style="color: #ef4444; text-align: right; font-size: 13px;">${p2Goals}</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 140px 1fr; gap: 8px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #f43f5e; text-align: left;">${p1Spikes}</span>
      <span style="color: #94a3b8; text-align: center; font-size: 11px;">POWER SPIKES</span>
      <span style="color: #f43f5e; text-align: right;">${p2Spikes}</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 140px 1fr; gap: 8px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #fb923c; text-align: left;">${p1Att}</span>
      <span style="color: #94a3b8; text-align: center; font-size: 11px;">OPP CIRCLE (ATTACK)</span>
      <span style="color: #fb923c; text-align: right;">${p2Att}</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 140px 1fr; gap: 8px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #ffd60a; text-align: left;">★ ${p1Sweet}</span>
      <span style="color: #94a3b8; text-align: center; font-size: 11px;">SWEET SPOT HITS</span>
      <span style="color: #ffd60a; text-align: right;">★ ${p2Sweet}</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 140px 1fr; gap: 8px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #22c55e; text-align: left;">${p1H} <span style="color: #94a3b8; font-size: 10px;">(${p1W} w)</span></span>
      <span style="color: #94a3b8; text-align: center; font-size: 11px;">STRIKES (HITS/WHIFFS)</span>
      <span style="color: #22c55e; text-align: right;">${p2H} <span style="color: #94a3b8; font-size: 10px;">(${p2W} w)</span></span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 140px 1fr; gap: 8px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #10b981; text-align: left;">${p1Def}</span>
      <span style="color: #94a3b8; text-align: center; font-size: 11px;">OWN CIRCLE (DEFENSE)</span>
      <span style="color: #10b981; text-align: right;">${p2Def}</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 140px 1fr; gap: 8px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #38bdf8; text-align: left;">${p1A}%</span>
      <span style="color: #94a3b8; text-align: center; font-size: 11px;">STRIKE ACCURACY</span>
      <span style="color: #38bdf8; text-align: right;">${p2A}%</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 140px 1fr; gap: 8px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #2563eb; text-align: left;">${p1Touches}</span>
      <span style="color: #94a3b8; text-align: center; font-size: 11px;">TOUCHES</span>
      <span style="color: #2563eb; text-align: right;">${p2Touches}</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 140px 1fr; gap: 8px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #8b5cf6; text-align: left;">${p1Dives}</span>
      <span style="color: #94a3b8; text-align: center; font-size: 11px;">GROUND DIVES</span>
      <span style="color: #8b5cf6; text-align: right;">${p2Dives}</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 140px 1fr; gap: 8px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #ec4899; text-align: left;">${p1DivingHits}</span>
      <span style="color: #94a3b8; text-align: center; font-size: 11px;">DIVING HITS / SAVES</span>
      <span style="color: #ec4899; text-align: right;">${p2DivingHits}</span>
    </div>
  `;
  bannerElement.textContent = 'FULL TIME';
  bannerElement.style.color = '#7d97ad';

  btnRowElement.innerHTML = '';
  const rematchBtn = document.createElement('button');
  rematchBtn.id = 'btn-rematch';
  rematchBtn.textContent = 'REMATCH';
  rematchBtn.style.cssText = `
    padding: 12px 28px;
    font-size: 14px;
    font-weight: 900;
    font-family: inherit;
    letter-spacing: 0.08em;
    color: #000000;
    background: #ffffff;
    border: 2px solid #ffffff;
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 4px 18px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25);
    transition: all 0.15s ease;
  `;
  rematchBtn.onmouseenter = () => {
    rematchBtn.style.transform = 'scale(1.04)';
    rematchBtn.style.boxShadow = '0 6px 24px rgba(255, 255, 255, 0.6), 0 0 30px rgba(255, 46, 85, 0.3)';
  };
  rematchBtn.onmouseleave = () => {
    rematchBtn.style.transform = 'scale(1)';
    rematchBtn.style.boxShadow = '0 4px 18px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25)';
  };
  rematchBtn.onclick = () => {
    hideVictoryScreen();
    if (defaultCallbacks.onRematch) defaultCallbacks.onRematch();
  };

  const practiceBtn = document.createElement('button');
  practiceBtn.textContent = 'PRACTICE MODE';
  practiceBtn.style.cssText = `
    padding: 12px 24px;
    font-size: 14px;
    font-weight: 700;
    font-family: inherit;
    letter-spacing: 0.06em;
    color: #cfe3f5;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  `;
  practiceBtn.onmouseenter = () => { practiceBtn.style.background = 'rgba(255, 255, 255, 0.15)'; };
  practiceBtn.onmouseleave = () => { practiceBtn.style.background = 'rgba(255, 255, 255, 0.08)'; };
  practiceBtn.onclick = () => {
    hideVictoryScreen();
    if (defaultCallbacks.onPracticeMode) defaultCallbacks.onPracticeMode();
  };

  const mainMenuBtn = document.createElement('button');
  mainMenuBtn.textContent = 'MAIN MENU';
  mainMenuBtn.style.cssText = `
    padding: 12px 24px;
    font-size: 14px;
    font-weight: 700;
    font-family: inherit;
    letter-spacing: 0.06em;
    color: #cfe3f5;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  `;
  mainMenuBtn.onmouseenter = () => { mainMenuBtn.style.background = 'rgba(255, 255, 255, 0.15)'; };
  mainMenuBtn.onclick = () => {
    hideVictoryScreen();
    if (defaultCallbacks.onMainMenu) defaultCallbacks.onMainMenu();
  };

  rematchBtn.id = 'btn-rematch';
  practiceBtn.id = 'btn-victory-practice';
  mainMenuBtn.id = 'btn-victory-main-menu';

  btnRowElement.appendChild(rematchBtn);
  btnRowElement.appendChild(practiceBtn);
  btnRowElement.appendChild(mainMenuBtn);

  startVictoryGamepadPolling([rematchBtn, practiceBtn, mainMenuBtn]);
}

export function showPracticeSummary(
  stats = {},
  sessionSeconds = 0,
  { onPracticeAgain, onCustomize, onMainMenu } = {},
) {
  if (!overlayElement) return;
  isVisible = true;
  overlayElement.style.display = 'flex';

  const goals = stats.goals || 0;
  const hits = stats.hits || 0;
  const whiffs = stats.whiffs || 0;
  const sweetSpots = stats.sweetSpots || 0;
  const spikes = stats.spikes || 0;
  const dives = stats.dives || 0;
  const divingHits = stats.divingHits || 0;
  const touches = stats.totalTouches || 0;
  const attempts = hits + whiffs;
  const accuracy = attempts > 0 ? Math.round((hits / attempts) * 100) : 0;

  const min = Math.floor(sessionSeconds / 60);
  const sec = Math.floor(sessionSeconds % 60);
  const timeStr = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

  bannerElement.textContent = 'PRACTICE SESSION COMPLETE';
  bannerElement.style.color = '#38bdf8';

  titleElement.textContent = '⚡ HUSTLE BOARD';
  titleElement.style.color = '#ffffff';

  scoreElement.innerHTML = `
    <span style="color: #10b981; font-size: 50px;">${goals}</span>
    <span style="color: #64748b; font-size: 20px; font-weight: 700; margin: 0 4px;">GOALS ·</span>
    <span style="color: #38bdf8; font-size: 50px;">${accuracy}%</span>
    <span style="color: #64748b; font-size: 20px; font-weight: 700; margin: 0 4px;">ACC</span>
  `;

  let badge = '🌱 PRACTICE DRILL COMPLETED';
  let badgeColor = '#94a3b8';
  if (goals >= 5 && accuracy >= 80) {
    badge = '🔥 ELITE SHARPSHOOTER';
    badgeColor = '#f59e0b';
  } else if (goals >= 3) {
    badge = '⚡ STRIKE SPECIALIST';
    badgeColor = '#10b981';
  } else if (accuracy >= 60) {
    badge = '🎯 PRECISION DRIFTER';
    badgeColor = '#38bdf8';
  }

  subtitleElement.innerHTML = `<span style="color: ${badgeColor}; font-weight: 800; letter-spacing: 0.08em;">${badge}</span> <span style="color: #64748b; margin: 0 6px;">·</span> <span>${timeStr} DRILL TIME</span>`;

  statsContainer.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-weight: 800; font-size: 11px; letter-spacing: 0.08em;">
      <span style="color: #38bdf8;">HUSTLE BOARD TELEMETRY</span>
      <span style="color: #94a3b8;">SOLO DRILL SUMMARY</span>
    </div>
    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #94a3b8; font-size: 11px;">TARGET GOALS SCORED</span>
      <span style="color: #10b981; font-size: 13px;">${goals}</span>
    </div>
    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #94a3b8; font-size: 11px;">STRIKE ACCURACY</span>
      <span style="color: #38bdf8; font-size: 13px;">${accuracy}% <span style="color: #64748b; font-size: 11px;">(${hits} hits / ${whiffs} whiffs)</span></span>
    </div>
    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #94a3b8; font-size: 11px;">SWEET-SPOT CONTACTS (≥80%)</span>
      <span style="color: #fbbf24; font-size: 13px;">★ ${sweetSpots}</span>
    </div>
    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #94a3b8; font-size: 11px;">POWER SPIKES EXECUTED</span>
      <span style="color: #f43f5e; font-size: 13px;">${spikes}</span>
    </div>
    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #94a3b8; font-size: 11px;">GROUND DIVES</span>
      <span style="color: #a855f7; font-size: 13px;">${dives}</span>
    </div>
    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #94a3b8; font-size: 11px;">DIVING HITS / SAVES</span>
      <span style="color: #ec4899; font-size: 13px;">${divingHits}</span>
    </div>
    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.06); font-weight: 700;">
      <span style="color: #94a3b8; font-size: 11px;">TOTAL BALL TOUCHES</span>
      <span style="color: #e2e8f0; font-size: 13px;">${touches}</span>
    </div>
  `;

  btnRowElement.innerHTML = '';

  const btnPracticeAgain = document.createElement('button');
  btnPracticeAgain.id = 'btn-practice-again';
  btnPracticeAgain.textContent = 'PRACTICE AGAIN';
  btnPracticeAgain.style.cssText = `
    padding: 12px 24px;
    font-size: 13px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.08em;
    color: #ffffff;
    background: #10b981;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
    transition: all 0.15s ease;
  `;
  btnPracticeAgain.onmouseenter = () => { btnPracticeAgain.style.background = '#34d399'; };
  btnPracticeAgain.onmouseleave = () => { btnPracticeAgain.style.background = '#10b981'; };
  btnPracticeAgain.onclick = () => {
    hideVictoryScreen();
    if (onPracticeAgain) onPracticeAgain();
    else if (defaultCallbacks.onPracticeMode) defaultCallbacks.onPracticeMode();
  };

  const btnCustomize = document.createElement('button');
  btnCustomize.id = 'btn-practice-customize';
  btnCustomize.textContent = 'CHANGE SETUP';
  btnCustomize.style.cssText = `
    padding: 12px 20px;
    font-size: 13px;
    font-weight: 700;
    font-family: inherit;
    letter-spacing: 0.06em;
    color: #cfe3f5;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  `;
  btnCustomize.onmouseenter = () => { btnCustomize.style.background = 'rgba(255, 255, 255, 0.15)'; };
  btnCustomize.onmouseleave = () => { btnCustomize.style.background = 'rgba(255, 255, 255, 0.08)'; };
  btnCustomize.onclick = () => {
    hideVictoryScreen();
    if (onCustomize) onCustomize();
    else if (defaultCallbacks.onMainMenu) defaultCallbacks.onMainMenu();
  };

  const btnMainMenu = document.createElement('button');
  btnMainMenu.id = 'btn-practice-main-menu';
  btnMainMenu.textContent = 'MAIN MENU';
  btnMainMenu.style.cssText = `
    padding: 12px 20px;
    font-size: 13px;
    font-weight: 700;
    font-family: inherit;
    letter-spacing: 0.06em;
    color: #cfe3f5;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  `;
  btnMainMenu.onmouseenter = () => { btnMainMenu.style.background = 'rgba(255, 255, 255, 0.15)'; };
  btnMainMenu.onmouseleave = () => { btnMainMenu.style.background = 'rgba(255, 255, 255, 0.08)'; };
  btnMainMenu.onclick = () => {
    hideVictoryScreen();
    if (onMainMenu) onMainMenu();
    else if (defaultCallbacks.onMainMenu) defaultCallbacks.onMainMenu();
  };

  btnRowElement.appendChild(btnPracticeAgain);
  btnRowElement.appendChild(btnCustomize);
  btnRowElement.appendChild(btnMainMenu);

  startVictoryGamepadPolling([btnPracticeAgain, btnCustomize, btnMainMenu]);
}

function updateVictoryFocusUI() {
  if (!activeVictoryButtons || activeVictoryButtons.length === 0) return;
  if (victoryFocusIndex >= activeVictoryButtons.length) victoryFocusIndex = activeVictoryButtons.length - 1;
  if (victoryFocusIndex < 0) victoryFocusIndex = 0;

  activeVictoryButtons.forEach((btn, idx) => {
    if (idx === victoryFocusIndex) {
      btn.style.outline = '2px solid #ffffff';
      btn.style.outlineOffset = '2px';
      btn.style.transform = 'scale(1.06)';
      btn.style.boxShadow = '0 0 22px rgba(255, 255, 255, 0.6), 0 0 25px rgba(0, 229, 255, 0.3)';
    } else {
      btn.style.outline = 'none';
      btn.style.transform = 'scale(1)';
      btn.style.boxShadow = btn.id === 'btn-rematch' ? '0 4px 18px rgba(255, 255, 255, 0.45), 0 0 25px rgba(0, 229, 255, 0.25)' : (btn.id === 'btn-practice-again' ? '0 4px 14px rgba(16, 185, 129, 0.4)' : 'none');
    }
  });
}

function startVictoryGamepadPolling(buttons) {
  stopVictoryGamepadPolling();
  activeVictoryButtons = buttons;
  victoryFocusIndex = 0;
  updateVictoryFocusUI();

  // Mouse hover also syncs focus
  activeVictoryButtons.forEach((btn, idx) => {
    btn.onmouseenter = () => {
      victoryFocusIndex = idx;
      updateVictoryFocusUI();
    };
  });

  const onKeyDown = (e) => {
    if (!isVisible) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'KeyJ') {
      e.preventDefault();
      victoryFocusIndex = (victoryFocusIndex - 1 + activeVictoryButtons.length) % activeVictoryButtons.length;
      updateVictoryFocusUI();
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'KeyL') {
      e.preventDefault();
      victoryFocusIndex = (victoryFocusIndex + 1) % activeVictoryButtons.length;
      updateVictoryFocusUI();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      activeVictoryButtons[victoryFocusIndex]?.click();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  victoryPrevPad = { left: false, right: false, up: false, down: false, a: false, start: false };

  victoryPollHandle = setInterval(() => {
    if (!isVisible || !overlayElement || overlayElement.style.display !== 'flex') {
      stopVictoryGamepadPolling();
      return;
    }

    if (typeof navigator.getGamepads !== 'function') return;
    const raw = navigator.getGamepads();
    const pads = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] && raw[i].connected) pads.push(raw[i]);
    }

    for (const pad of pads) {
      if (!pad) continue;
      const left = (pad.buttons[14]?.pressed || (pad.axes[0] && pad.axes[0] < -0.5)) || false;
      const right = (pad.buttons[15]?.pressed || (pad.axes[0] && pad.axes[0] > 0.5)) || false;
      const up = (pad.buttons[12]?.pressed || (pad.axes[1] && pad.axes[1] < -0.5)) || false;
      const down = (pad.buttons[13]?.pressed || (pad.axes[1] && pad.axes[1] > 0.5)) || false;
      const btnA = pad.buttons[0]?.pressed || false;
      const btnStart = pad.buttons[9]?.pressed || false;

      const p = victoryPrevPad;

      if ((left && !p.left) || (up && !p.up)) {
        victoryFocusIndex = (victoryFocusIndex - 1 + activeVictoryButtons.length) % activeVictoryButtons.length;
        updateVictoryFocusUI();
      }
      if ((right && !p.right) || (down && !p.down)) {
        victoryFocusIndex = (victoryFocusIndex + 1) % activeVictoryButtons.length;
        updateVictoryFocusUI();
      }
      if ((btnA && !p.a) || (btnStart && !p.start)) {
        activeVictoryButtons[victoryFocusIndex]?.click();
      }

      p.left = left;
      p.right = right;
      p.up = up;
      p.down = down;
      p.a = btnA;
      p.start = btnStart;
    }
  }, 50);

  window._cleanupVictoryListeners = () => {
    window.removeEventListener('keydown', onKeyDown);
    if (victoryPollHandle) {
      clearInterval(victoryPollHandle);
      victoryPollHandle = null;
    }
  };
}

function stopVictoryGamepadPolling() {
  if (window._cleanupVictoryListeners) {
    window._cleanupVictoryListeners();
    window._cleanupVictoryListeners = null;
  }
  if (victoryPollHandle) {
    clearInterval(victoryPollHandle);
    victoryPollHandle = null;
  }
}

export function hideVictoryScreen() {
  if (!overlayElement) return;
  isVisible = false;
  stopVictoryGamepadPolling();
  overlayElement.style.display = 'none';
  activeVictoryButtons.forEach((btn) => {
    btn.style.outline = 'none';
    btn.style.transform = 'scale(1)';
  });
}

export function isVictoryScreenVisible() {
  return isVisible;
}
