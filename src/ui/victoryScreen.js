/**
 * @file victoryScreen.js
 * Responsibility: Post-match Victory / Draw summary screen and Practice Mode session summary overlay.
 * Upstream: Initialized and shown by `src/main.js` when a match concludes or practice ends.
 * Downstream: Reads `src/config/tuning.js`, `src/ui/mainMenu.js`, `src/input/menuPads.js`, and `src/features/match/matchManager.js`.
 * Key invariants:
 * - Displays both 1v1 and 2v2 team + individual player breakdown tables.
 * - Supports mouse, keyboard, and gamepad navigation for Rematch, Practice, and Main Menu actions.
 */

import { TUNING } from '../config/tuning.js';
import { getColorName } from './mainMenu.js';
import { createMenuPadTracker, MENU_PAD } from '../input/menuPads.js';
import { buildMatchStatsReport } from '../features/match/matchManager.js';
import { replayManager } from '../features/match/replayManager.js';

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
let defaultCallbacks = { onRematch: null, onPickSides: null, onWatchReplay: null, onPracticeMode: null, onMainMenu: null };

function parseHexRgb(hex) {
  const clean = String(hex || '#ffffff').replace('#', '');
  const full = clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean;
  const num = parseInt(full, 16);
  if (!Number.isFinite(num)) return [255, 255, 255];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function relativeLuminance([r, g, b]) {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function readableOnDark(hex, bgHex = '#0e141e', minRatio = 4.5) {
  const base = parseHexRgb(hex);
  const bgLum = relativeLuminance(parseHexRgb(bgHex));
  const ratioFor = (rgb) => {
    const l = relativeLuminance(rgb);
    return (Math.max(l, bgLum) + 0.05) / (Math.min(l, bgLum) + 0.05);
  };
  if (ratioFor(base) >= minRatio) {
    return '#' + base.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  const white = [248, 250, 252];
  for (let step = 1; step <= 20; step++) {
    const t = step / 20;
    const mixed = [
      Math.round(base[0] + (white[0] - base[0]) * t),
      Math.round(base[1] + (white[1] - base[1]) * t),
      Math.round(base[2] + (white[2] - base[2]) * t),
    ];
    if (ratioFor(mixed) >= minRatio) {
      return '#' + mixed.map((v) => v.toString(16).padStart(2, '0')).join('');
    }
  }
  return '#f8fafc';
}

export function initVictoryScreen({ onRematch, onPickSides, onWatchReplay, onPracticeMode, onMainMenu }) {
  if (overlayElement) return;
  defaultCallbacks = { onRematch, onPickSides, onWatchReplay, onPracticeMode, onMainMenu };

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
    padding: 16px 24px;
    background: rgba(14, 20, 30, 0.95);
    border: 2px solid rgba(120, 170, 210, 0.35);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7);
    max-width: 860px;
    max-height: 96vh;
    width: 94%;
    box-sizing: border-box;
    text-align: center;
  `;

  const brandBadge = document.createElement('div');
  brandBadge.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 4px;
  `;
  brandBadge.innerHTML = `
    <span style="font-family: 'Syncopate', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: 0.08em; background: linear-gradient(90deg, #FF2A42 0%, #FF6B00 14.3%, #FFD000 28.6%, #10E56A 42.9%, #00E5FF 57.2%, #1F65FF 71.5%, #6B11FF 85.8%, #E000B8 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;">VALLEYBALL</span>
    <span style="font-family: 'Syncopate', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.28em; color: #F5F5F7;">VERSUS</span>
  `;
  container.appendChild(brandBadge);

  const brandDivider = document.createElement('div');
  brandDivider.style.cssText = `
    height: 2px;
    width: 60px;
    margin: 0 auto 8px auto;
    background: linear-gradient(90deg, #FF2A42 0%, #FF6B00 14.3%, #FFD000 28.6%, #10E56A 42.9%, #00E5FF 57.2%, #1F65FF 71.5%, #6B11FF 85.8%, #E000B8 100%);
    border-radius: 1px;
    opacity: 0.85;
  `;
  container.appendChild(brandDivider);

  bannerElement = document.createElement('div');
  bannerElement.textContent = 'FULL TIME';
  bannerElement.style.cssText = `
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: #7d97ad;
    margin-bottom: 4px;
  `;

  titleElement = document.createElement('div');
  titleElement.style.cssText = `
    font-size: 28px;
    font-weight: 900;
    letter-spacing: 0.06em;
    margin-bottom: 8px;
    text-transform: uppercase;
  `;

  scoreElement = document.createElement('div');
  scoreElement.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 22px;
    font-size: 42px;
    font-weight: 900;
    margin-bottom: 6px;
  `;

  subtitleElement = document.createElement('div');
  subtitleElement.style.cssText = `
    font-size: 12.5px;
    color: #9cb5cb;
    margin-bottom: 12px;
  `;

  statsContainer = document.createElement('div');
  statsContainer.id = 'victory-stats-box';
  statsContainer.style.cssText = `
    width: 100%;
    box-sizing: border-box;
    pointer-events: none;
    overflow: hidden;
    margin-bottom: 14px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(120, 170, 210, 0.2);
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 12px;
  `;

  btnRowElement = document.createElement('div');
  btnRowElement.id = 'victory-actions-row';
  btnRowElement.style.cssText = `
    position: relative;
    z-index: 2;
    flex-shrink: 0;
    display: flex;
    flex-wrap: nowrap;
    gap: 8px;
    width: 100%;
    justify-content: center;
    align-items: center;
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

  const homePrimary = report.teams?.home?.primaryColor ?? TUNING.athlete?.palette?.homePrimary ?? 0xd90429;
  const awayPrimary = report.teams?.away?.primaryColor ?? TUNING.athlete?.palette?.awayPrimary ?? 0x1d4ed8;
  const homeHex = '#' + (homePrimary & 0xffffff).toString(16).padStart(6, '0');
  const awayHex = '#' + (awayPrimary & 0xffffff).toString(16).padStart(6, '0');
  const homeInk = readableOnDark(homeHex);
  const awayInk = readableOnDark(awayHex);
  const p1IsHome = (report.players?.[0]?.team || TUNING.players?.[0]?.team || 'home') === 'home';
  const team1SideKey = p1IsHome ? 'home' : 'away';
  const team2SideKey = p1IsHome ? 'away' : 'home';
  const team1RawHex = p1IsHome ? homeHex : awayHex;
  const team2RawHex = p1IsHome ? awayHex : homeHex;
  const team1Color = p1IsHome ? homeInk : awayInk;
  const team2Color = p1IsHome ? awayInk : homeInk;
  const team1ColorName = getColorName(team1RawHex).toUpperCase();
  const team2ColorName = getColorName(team2RawHex).toUpperCase();
  const isUltraDarkHex = (hex) => {
    const [r, g, b] = parseHexRgb(hex);
    return (r * 299 + g * 587 + b * 114) / 1000 < 32;
  };
  const t1BorderHex = isUltraDarkHex(team1RawHex) ? '#cbd5e1' : team1RawHex;
  const t2BorderHex = isUltraDarkHex(team2RawHex) ? '#cbd5e1' : team2RawHex;

  const team1Roster = is2v2 ? 'TEAM 1 · P1 & P3' : 'TEAM 1 · P1';
  const team2Roster = is2v2 ? 'TEAM 2 · P2 & P4' : 'TEAM 2 · P2';
  const team1Header = `${team1Roster} (${team1ColorName} / ${p1IsHome ? 'HOME' : 'AWAY'})`;
  const team2Header = `${team2Roster} (${team2ColorName} / ${p1IsHome ? 'AWAY' : 'HOME'})`;

  if (homeWon) {
    const winnerColorName = getColorName(homeHex).toUpperCase();
    const winnerTeamLabel = p1IsHome ? team1Roster : team2Roster;
    titleElement.textContent = `${winnerColorName} (${winnerTeamLabel}) WINS`;
    titleElement.style.color = homeInk;
  } else if (awayWon) {
    const winnerColorName = getColorName(awayHex).toUpperCase();
    const winnerTeamLabel = p1IsHome ? team2Roster : team1Roster;
    titleElement.textContent = `${winnerColorName} (${winnerTeamLabel}) WINS`;
    titleElement.style.color = awayInk;
  } else {
    titleElement.textContent = 'MATCH DRAW';
    titleElement.style.color = '#f3f4f6';
  }

  scoreElement.innerHTML = `
    <span style="color: ${homeInk};">${match.scoreHome}</span>
    <span style="color: #94a3b8; font-size: 32px;">-</span>
    <span style="color: ${awayInk};">${match.scoreAway}</span>
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

  statsContainer.style.borderTop = '1.5px solid rgba(120, 170, 210, 0.28)';
  statsContainer.style.borderBottom = '1.5px solid rgba(120, 170, 210, 0.28)';
  statsContainer.style.borderLeft = `4px solid ${t1BorderHex}`;
  statsContainer.style.borderRight = `4px solid ${t2BorderHex}`;
  statsContainer.dataset.team1Border = team1RawHex;
  statsContainer.dataset.team2Border = team2RawHex;

  statsContainer.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 140px 1fr; gap: 8px; align-items: center; margin-bottom: 6px; font-weight: 900; font-size: 10.5px; letter-spacing: 0.06em;">
      <span class="victory-team-badge" style="justify-self: start; display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; border: 1.5px solid ${t1BorderHex}; background: ${isUltraDarkHex(team1RawHex) ? 'rgba(24,24,27,0.92)' : `${team1RawHex}26`}; color: ${team1Color};">
        <span style="width: 7px; height: 7px; border-radius: 50%; background: ${team1RawHex}; flex-shrink: 0;"></span>
        <span>${team1Header}</span>
      </span>
      <span style="color: #64748b; text-align: center;">TEAM &amp; PLAYER STATS</span>
      <span class="victory-team-badge" style="justify-self: end; display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; border: 1.5px solid ${t2BorderHex}; background: ${isUltraDarkHex(team2RawHex) ? 'rgba(24,24,27,0.92)' : `${team2RawHex}26`}; color: ${team2Color};">
        <span>${team2Header}</span>
        <span style="width: 7px; height: 7px; border-radius: 50%; background: ${team2RawHex}; flex-shrink: 0;"></span>
      </span>
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
    padding: 11px 18px;
    font-size: 12.5px;
    font-weight: 900;
    font-family: inherit;
    letter-spacing: 0.07em;
    color: #000000;
    background: #ffffff;
    border: 2px solid #ffffff;
    border-radius: 6px;
    white-space: nowrap;
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

  const mainMenuBtn = document.createElement('button');
  mainMenuBtn.id = 'btn-victory-main-menu';
  mainMenuBtn.textContent = 'MAIN MENU';
  mainMenuBtn.style.cssText = `
    padding: 11px 16px;
    font-size: 12.5px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.06em;
    color: #cfe3f5;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    white-space: nowrap;
    cursor: pointer;
    transition: all 0.15s ease;
  `;
  mainMenuBtn.onmouseenter = () => { mainMenuBtn.style.background = 'rgba(255, 255, 255, 0.15)'; };
  mainMenuBtn.onclick = () => {
    hideVictoryScreen();
    if (defaultCallbacks.onMainMenu) defaultCallbacks.onMainMenu();
  };

  const pickSidesBtn = document.createElement('button');
  pickSidesBtn.id = 'btn-victory-pick-sides';
  pickSidesBtn.textContent = 'PICK SIDES / SWAP CONTROLLERS';
  pickSidesBtn.style.cssText = `
    padding: 11px 14px;
    font-size: 12px;
    font-weight: 800;
    font-family: inherit;
    letter-spacing: 0.05em;
    color: #c4b5fd;
    background: rgba(168, 85, 247, 0.14);
    border: 1px solid rgba(168, 85, 247, 0.5);
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
  `;
  pickSidesBtn.onmouseenter = () => { pickSidesBtn.style.background = 'rgba(168, 85, 247, 0.26)'; };
  pickSidesBtn.onmouseleave = () => { pickSidesBtn.style.background = 'rgba(168, 85, 247, 0.14)'; };
  pickSidesBtn.onclick = () => {
    hideVictoryScreen();
    if (defaultCallbacks.onPickSides) defaultCallbacks.onPickSides();
  };

  const navButtons = [rematchBtn, pickSidesBtn];
  btnRowElement.appendChild(rematchBtn);
  btnRowElement.appendChild(pickSidesBtn);

  const lastReplay = replayManager.getLastReplay();
  if (lastReplay && defaultCallbacks.onWatchReplay) {
    const watchReplayBtn = document.createElement('button');
    watchReplayBtn.id = 'btn-watch-replay';
    watchReplayBtn.textContent = 'WATCH REPLAY';
    watchReplayBtn.style.cssText = `
      padding: 11px 15px;
      font-size: 12.5px;
      font-weight: 800;
      font-family: inherit;
      letter-spacing: 0.06em;
      color: #00e5ff;
      background: rgba(0, 229, 255, 0.12);
      border: 1px solid rgba(0, 229, 255, 0.45);
      border-radius: 6px;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.15s ease;
    `;
    watchReplayBtn.onmouseenter = () => { watchReplayBtn.style.background = 'rgba(0, 229, 255, 0.22)'; };
    watchReplayBtn.onmouseleave = () => { watchReplayBtn.style.background = 'rgba(0, 229, 255, 0.12)'; };
    watchReplayBtn.onclick = () => {
      hideVictoryScreen();
      defaultCallbacks.onWatchReplay(lastReplay);
    };
    btnRowElement.appendChild(watchReplayBtn);
    navButtons.push(watchReplayBtn);

    const saveReplayBtn = document.createElement('button');
    saveReplayBtn.id = 'btn-save-replay';
    const alreadySaved = Boolean(lastReplay.userSaved);
    saveReplayBtn.textContent = alreadySaved ? 'Replay Saved' : 'Save Replay?';
    saveReplayBtn.title = lastReplay.savedPath || lastReplay.filename || 'Download .vbreplay file';
    saveReplayBtn.style.cssText = `
      padding: 11px 15px;
      font-size: 12.5px;
      font-weight: 800;
      font-family: inherit;
      letter-spacing: 0.04em;
      color: ${alreadySaved ? '#34d399' : '#cfe3f5'};
      background: ${alreadySaved ? 'rgba(16, 185, 129, 0.14)' : 'rgba(255, 255, 255, 0.08)'};
      border: 1px solid ${alreadySaved ? '#10b981' : 'rgba(255, 255, 255, 0.2)'};
      border-radius: 6px;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.15s ease;
    `;
    saveReplayBtn.onmouseenter = () => {
      if (!lastReplay.userSaved) saveReplayBtn.style.background = 'rgba(255, 255, 255, 0.15)';
    };
    saveReplayBtn.onmouseleave = () => {
      if (!lastReplay.userSaved) saveReplayBtn.style.background = 'rgba(255, 255, 255, 0.08)';
    };
    saveReplayBtn.onclick = () => {
      if (lastReplay.userSaved) return;
      replayManager.downloadLastReplay(lastReplay);
      lastReplay.userSaved = true;
      saveReplayBtn.textContent = 'Replay Saved';
      saveReplayBtn.style.color = '#34d399';
      saveReplayBtn.style.background = 'rgba(16, 185, 129, 0.14)';
      saveReplayBtn.style.borderColor = '#10b981';
    };
    btnRowElement.appendChild(saveReplayBtn);
    navButtons.push(saveReplayBtn);
  }

  btnRowElement.appendChild(mainMenuBtn);
  navButtons.push(mainMenuBtn);

  startVictoryGamepadPolling(navButtons);
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

  const pracPrimary = TUNING.players?.[0]?.primaryColor ?? TUNING.athlete?.palette?.homePrimary ?? 0xd90429;
  const pracHex = '#' + (pracPrimary & 0xffffff).toString(16).padStart(6, '0');
  const pracInk = readableOnDark(pracHex);
  statsContainer.style.border = `1.5px solid ${pracInk}`;

  subtitleElement.innerHTML = `<span style="color: ${badgeColor}; font-weight: 800; letter-spacing: 0.08em;">${badge}</span> <span style="color: #64748b; margin: 0 6px;">·</span> <span>${timeStr} SESSION TIME</span>`;

  statsContainer.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-weight: 800; font-size: 11px; letter-spacing: 0.08em;">
      <span style="display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; border: 1.5px solid ${pracInk}; background: ${pracHex}24; color: ${pracInk};">HUSTLE BOARD TELEMETRY</span>
      <span style="color: #94a3b8;">PRACTICE SUMMARY</span>
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
