import { TUNING } from '../config/tuning.js';
import { getColorName } from './mainMenu.js';
import { createMenuPadTracker, MENU_PAD } from '../input/menuPads.js';
import { buildMatchStatsReport } from '../features/match/matchManager.js';

/**
 * Arcade Victory Screen overlay for Valleyball Versus Match Mode.
 */

let overlayElement = null;
let titleElement = null;
let scoreElement = null;
let subtitleElement = null;
let statsContainer = null;
let isVisible = false;

let activeVictoryButtons = [];
let victoryFocusIndex = 0;
let victoryPollHandle = null;
let victoryOpenTimestamp = 0;
const victoryPads = createMenuPadTracker();

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
    padding: 26px 36px;
    background: rgba(14, 20, 30, 0.95);
    border: 2px solid rgba(120, 170, 210, 0.35);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7);
    max-width: 780px;
    width: 92%;
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
  statsContainer.id = 'victory-stats-box';
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

  const legendEl = document.createElement('div');
  legendEl.style.cssText = `
    margin-top: 14px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #94a3b8;
  `;
  legendEl.innerHTML = '🎮 <b style="color:#ffffff;">◀ ▶</b> SELECT &middot; <b style="color:#00e5ff;">A / START / ENTER</b> CONFIRM';
  container.appendChild(legendEl);

  overlayElement.appendChild(container);
  document.body.appendChild(overlayElement);
}

export function showVictoryScreen(
  match,
  p1Stats = { hits: 0, whiffs: 0, accuracy: 0 },
  p2Stats = { hits: 0, whiffs: 0, accuracy: 0 },
  statsReport = null,
) {
  if (!overlayElement) return;
  isVisible = true;
  overlayElement.style.display = 'flex';

  const isArrayCall = Array.isArray(p1Stats);
  const resolvedStatsArray = isArrayCall ? p1Stats : (window.__vb?.athleteMatchStats || [p1Stats, p2Stats]);
  const resolvedAthletes = Array.isArray(p2Stats)
    ? p2Stats
    : (window.__vb?.athletes || [
        { getStrikeStats: () => ({ hits: p1Stats.hits || 0, whiffs: p1Stats.whiffs || 0, accuracy: p1Stats.accuracy || 0 }) },
        { getStrikeStats: () => ({ hits: p2Stats.hits || 0, whiffs: p2Stats.whiffs || 0, accuracy: p2Stats.accuracy || 0 }) },
      ]);
  const enabledCount = resolvedAthletes.filter((a) => a && a.isEnabled !== false).length;

  const report = statsReport || buildMatchStatsReport({
    match,
    athletes: resolvedAthletes,
    athleteMatchStats: resolvedStatsArray,
    playerConfigs: (typeof window !== 'undefined' && window.__vb?.getPlayerConfigs?.()) || TUNING.players || [],
    activeCount: enabledCount >= 4 ? 4 : 2,
  });

  const is2v2 = (report.activeCount || 2) >= 4;
  const homeWon = match.scoreHome > match.scoreAway;
  const awayWon = match.scoreAway > match.scoreHome;

  const homeHex = '#' + (TUNING.athlete?.palette?.homePrimary ?? 0xd90429).toString(16).padStart(6, '0');
  const awayHex = '#' + (TUNING.athlete?.palette?.awayPrimary ?? 0x1d4ed8).toString(16).padStart(6, '0');
  const p1IsHome = (report.players?.[0]?.team || TUNING.players?.[0]?.team || 'home') === 'home';
  const team1SideKey = p1IsHome ? 'home' : 'away';
  const team2SideKey = p1IsHome ? 'away' : 'home';
  const team1Color = p1IsHome ? homeHex : awayHex;
  const team2Color = p1IsHome ? awayHex : homeHex;
  const team1ColorName = getColorName(team1Color).toUpperCase();
  const team2ColorName = getColorName(team2Color).toUpperCase();

  const team1Roster = is2v2 ? 'TEAM 1 · P1 & P3' : 'TEAM 1 · P1';
  const team2Roster = is2v2 ? 'TEAM 2 · P2 & P4' : 'TEAM 2 · P2';
  const team1Header = `${team1Roster} (${team1ColorName} / ${p1IsHome ? 'HOME' : 'AWAY'})`;
  const team2Header = `${team2Roster} (${team2ColorName} / ${p1IsHome ? 'AWAY' : 'HOME'})`;

  if (homeWon) {
    const winnerColorName = getColorName(homeHex).toUpperCase();
    const winnerTeamLabel = p1IsHome ? team1Roster : team2Roster;
    titleElement.textContent = `${winnerColorName} (${winnerTeamLabel}) WINS!`;
    titleElement.style.color = homeHex;
  } else if (awayWon) {
    const winnerColorName = getColorName(awayHex).toUpperCase();
    const winnerTeamLabel = p1IsHome ? team2Roster : team1Roster;
    titleElement.textContent = `${winnerColorName} (${winnerTeamLabel}) WINS!`;
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
  const durSecs = TUNING.match?.durationSeconds || 300;
  const durMin = Math.floor(durSecs / 60);
  const durRem = String(durSecs % 60).padStart(2, '0');
  subtitleElement.textContent = `${is2v2 ? '2v2 Team Match' : '1v1 Match'} · ${totalGoals} Total Goal${totalGoals === 1 ? '' : 's'} · ${durMin}:${durRem} Duration`;

  const t1Totals = report.teams?.[team1SideKey] || {};
  const t2Totals = report.teams?.[team2SideKey] || {};
  const t1Players = (report.players || []).filter((p) => p.team === team1SideKey);
  const t2Players = (report.players || []).filter((p) => p.team === team2SideKey);
  if (t1Players.length === 0) t1Players.push({ shortLabel: 'P1', ...p1Stats });
  if (t2Players.length === 0) t2Players.push({ shortLabel: 'P2', ...p2Stats });

  const renderSideCols = (teamTotalVal, playerVals, alignRight = false, accentColor = '#e2e8f0') => {
    const subColCount = 1 + playerVals.length;
    const playerTextColor = `color-mix(in srgb, ${accentColor} 24%, #e2e8f0)`;
    const cells = alignRight
      ? [
          ...playerVals.map((v) => `<span style="color: #cbd5e1; color: ${playerTextColor}; font-size: 11px; font-weight: 700; text-align: right;">${v}</span>`),
          `<span style="color: ${accentColor}; font-size: 12px; font-weight: 900; text-align: right; background: rgba(255,255,255,0.04); padding: 1px 6px; border-radius: 4px;">${teamTotalVal}</span>`,
        ]
      : [
          `<span style="color: ${accentColor}; font-size: 12px; font-weight: 900; text-align: left; background: rgba(255,255,255,0.04); padding: 1px 6px; border-radius: 4px;">${teamTotalVal}</span>`,
          ...playerVals.map((v) => `<span style="color: #cbd5e1; color: ${playerTextColor}; font-size: 11px; font-weight: 700; text-align: left;">${v}</span>`),
        ];
    return `<div style="display: grid; grid-template-columns: repeat(${subColCount}, 1fr); gap: 6px; align-items: center;">${cells.join('')}</div>`;
  };

  const renderStatRow = (label, accentColor, t1Total, t1PlayerMapper, t2PlayerMapper, t2Total) => `
    <div style="display: grid; grid-template-columns: 1fr 150px 1fr; gap: 10px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.06); align-items: center;">
      ${renderSideCols(t1Total, t1Players.map(t1PlayerMapper), false, accentColor)}
      <span style="color: #94a3b8; color: color-mix(in srgb, ${accentColor} 38%, #94a3b8); text-align: center; font-size: 10px; font-weight: 800; letter-spacing: 0.06em;">${label}</span>
      ${renderSideCols(t2Total, t2Players.map(t2PlayerMapper), true, accentColor)}
    </div>
  `;

  const t1SubHeaders = renderSideCols('TEAM', t1Players.map((p) => p.shortLabel || `P${(p.slotIndex ?? 0) + 1}`), false, team1Color);
  const t2SubHeaders = renderSideCols('TEAM', t2Players.map((p) => p.shortLabel || `P${(p.slotIndex ?? 1) + 1}`), true, team2Color);

  const t1TeamGoals = p1IsHome ? (match.scoreHome || 0) : (match.scoreAway || 0);
  const t2TeamGoals = p1IsHome ? (match.scoreAway || 0) : (match.scoreHome || 0);

  statsContainer.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 150px 1fr; gap: 10px; align-items: center; margin-bottom: 4px; font-weight: 900; font-size: 11px; letter-spacing: 0.08em;">
      <span style="color: ${team1Color}; text-align: left;">${team1Header}</span>
      <span style="color: #64748b; text-align: center;">TEAM &amp; PLAYER STATS</span>
      <span style="color: ${team2Color}; text-align: right;">${team2Header}</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 150px 1fr; gap: 10px; align-items: center; padding-bottom: 6px; margin-bottom: 2px; border-bottom: 1px solid rgba(120,170,210,0.25); font-size: 10px; letter-spacing: 0.08em;">
      ${t1SubHeaders}
      <span style="color: #475569; text-align: center; font-weight: 800;">METRIC</span>
      ${t2SubHeaders}
    </div>
    ${renderStatRow('GOALS', '#ff2e55', t1TeamGoals, (p) => p.goals ?? 0, (p) => p.goals ?? 0, t2TeamGoals)}
    ${is2v2 ? renderStatRow('ASSISTS', '#ff5733', t1Totals.assists ?? 0, (p) => p.assists ?? 0, (p) => p.assists ?? 0, t2Totals.assists ?? 0) : ''}
    ${renderStatRow('POWER SPIKES', '#ff7f24', t1Totals.spikes ?? 0, (p) => p.spikes ?? 0, (p) => p.spikes ?? 0, t2Totals.spikes ?? 0)}
    ${renderStatRow('OPP CIRCLE (ATK)', '#ffaa1d', t1Totals.oppCircleTouches ?? 0, (p) => p.oppCircleTouches ?? 0, (p) => p.oppCircleTouches ?? 0, t2Totals.oppCircleTouches ?? 0)}
    ${renderStatRow('SWEET SPOT HITS', '#ffd60a', `★ ${t1Totals.sweetSpotHits ?? 0}`, (p) => `★ ${p.sweetSpotHits ?? 0}`, (p) => `★ ${p.sweetSpotHits ?? 0}`, `★ ${t2Totals.sweetSpotHits ?? 0}`)}
    ${renderStatRow('STRIKES (H/W)', '#a3e635', `${t1Totals.hits ?? 0}/${t1Totals.whiffs ?? 0}`, (p) => `${p.hits ?? 0}/${p.whiffs ?? 0}`, (p) => `${p.hits ?? 0}/${p.whiffs ?? 0}`, `${t2Totals.hits ?? 0}/${t2Totals.whiffs ?? 0}`)}
    ${renderStatRow('STRIKE ACCURACY', '#22c55e', `${t1Totals.accuracy ?? 0}%`, (p) => `${p.accuracy ?? 0}%`, (p) => `${p.accuracy ?? 0}%`, `${t2Totals.accuracy ?? 0}%`)}
    ${renderStatRow('DEFENSIVE BLOCKS', '#14b8a6', t1Totals.defensiveBlocks ?? 0, (p) => p.defensiveBlocks ?? 0, (p) => p.defensiveBlocks ?? 0, t2Totals.defensiveBlocks ?? 0)}
    ${renderStatRow('OWN CIRCLE (DEF)', '#06b6d4', t1Totals.ownCircleTouches ?? 0, (p) => p.ownCircleTouches ?? 0, (p) => p.ownCircleTouches ?? 0, t2Totals.ownCircleTouches ?? 0)}
    ${renderStatRow('TOUCHES', '#3b82f6', t1Totals.totalTouches ?? 0, (p) => p.totalTouches ?? 0, (p) => p.totalTouches ?? 0, t2Totals.totalTouches ?? 0)}
    ${renderStatRow('GROUND DIVES', '#8b5cf6', t1Totals.dives ?? 0, (p) => p.dives ?? 0, (p) => p.dives ?? 0, t2Totals.dives ?? 0)}
    ${renderStatRow('DIVING SAVES', '#ec4899', t1Totals.divingHits ?? 0, (p) => p.divingHits ?? 0, (p) => p.divingHits ?? 0, t2Totals.divingHits ?? 0)}
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
    if (Date.now() - victoryOpenTimestamp < 750) return;
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

  victoryOpenTimestamp = Date.now();
  victoryPads.reset();

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

    victoryPads.update(pads);
    if (Date.now() - victoryOpenTimestamp < 750) return;

    for (const pad of pads) {
      if (!pad) continue;
      const e = victoryPads.pressed(pad);
      if (!e) continue;

      if (e & (MENU_PAD.left | MENU_PAD.up)) {
        victoryFocusIndex = (victoryFocusIndex - 1 + activeVictoryButtons.length) % activeVictoryButtons.length;
        updateVictoryFocusUI();
      }
      if (e & (MENU_PAD.right | MENU_PAD.down)) {
        victoryFocusIndex = (victoryFocusIndex + 1) % activeVictoryButtons.length;
        updateVictoryFocusUI();
      }
      if (e & (MENU_PAD.a | MENU_PAD.start)) {
        activeVictoryButtons[victoryFocusIndex]?.click();
        return;
      }
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
