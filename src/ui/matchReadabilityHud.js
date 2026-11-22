/**
 * Module: ui/matchReadabilityHud
 * Role: Optional, toggleable DOM readability overlays (all OFF by default):
 *   A. Broadcast Scorebug Pill (`scorebugMode`: 'off' | 'splitscreen' | 'always')
 *      - Zero GPU cost; mutates text only when clock second, score, target end,
 *        or practice metrics change (~1 Hz).
 *   C. Off-Screen Ball Edge Pips + 1.4s Post-Goal End-Swap Tags (`orientationCues`: boolean)
 *      - Tracks active viewports across 1-screen, 2-way splitscreen, and 4-way quad;
 *        moves pips via GPU-composited `translate3d` only when ball leaves frustum.
 * Frame Phase: Render (after `viewportManager.renderScene`).
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Purely visual readout; never mutates simulation state.
 *   - LAW 8 (60 FPS Frame-Time Budget): Zero per-frame allocations; early exit when OFF.
 */

import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { getHudPrefs } from '../config/hudConfig.js';

const SWAP_TAG_TICKS = 84; // 1.4s at 60 Hz
const PIP_INSET_X = 46;
const PIP_INSET_Y = 30;
const FRUSTUM_MARGIN_X = 0.94;
const FRUSTUM_MARGIN_Y = 0.90;

const _projVec = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _toBall = new THREE.Vector3();

let rootEl = null;
let scorebugEl = null;
let scorebugHomeDot = null;
let scorebugHomeScore = null;
let scorebugHomeDir = null;
let scorebugClock = null;
let scorebugAwayScore = null;
let scorebugAwayDir = null;
let scorebugAwayDot = null;
let scorebugSwapBanner = null;
let scorebugPracticeLine = null;
let scorebugMatchRow = null;

const pipEls = [];
const pipArrowEls = [];
const swapTagEls = [];

// Change-detection cache so DOM stays idle between 1 Hz clock ticks
const cache = {
  rootVisible: false,
  scorebugVisible: false,
  scorebugIsPractice: false,
  scoreHome: -1,
  scoreAway: -1,
  clockText: '',
  targetGoal: '',
  flashing: false,
  homeHex: '',
  awayHex: '',
  practiceGoals: -1,
  practiceHits: -1,
  practiceWhiffs: -1,
  lastTargetGoalSeen: '',
  swapBannerTicksLeft: 0,
  lastPracticeGoalsSeen: 0,
  practiceSwapTicksLeft: 0,
  lastTickSeen: -1,
};

function toCssHex(num, fallback) {
  const v = typeof num === 'number' ? num : fallback;
  return '#' + (v >>> 0).toString(16).padStart(6, '0');
}

function createPipElement(index) {
  const el = document.createElement('div');
  el.id = `vb-ball-pip-${index}`;
  el.style.cssText = `
    position: fixed;
    left: 0;
    top: 0;
    display: none;
    align-items: center;
    gap: 5px;
    padding: 4px 9px;
    border-radius: 999px;
    background: rgba(6, 10, 18, 0.86);
    border: 1.5px solid rgba(251, 191, 36, 0.92);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55), 0 0 12px rgba(251, 191, 36, 0.25);
    color: #fef3c7;
    font-family: 'Orbitron', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10.5px;
    font-weight: 900;
    letter-spacing: 0.08em;
    pointer-events: none;
    will-change: transform;
    z-index: 42;
  `;
  const arrow = document.createElement('span');
  arrow.textContent = '▲';
  arrow.style.cssText = 'display: inline-block; font-size: 11px; color: #fbbf24; line-height: 1;';
  const label = document.createElement('span');
  label.textContent = 'BALL';
  el.appendChild(arrow);
  el.appendChild(label);
  return { el, arrow };
}

function createSwapTagElement(index) {
  const el = document.createElement('div');
  el.id = `vb-swap-tag-${index}`;
  el.style.cssText = `
    position: fixed;
    left: 0;
    top: 0;
    display: none;
    padding: 5px 11px;
    border-radius: 6px;
    background: rgba(6, 10, 18, 0.88);
    border: 1.5px solid rgba(0, 229, 255, 0.75);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
    color: #f8fafc;
    font-family: 'Orbitron', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    pointer-events: none;
    z-index: 43;
  `;
  return el;
}

/**
 * Mounts the dormant readability HUD root once at boot.
 */
export function initMatchReadabilityHud() {
  if (typeof document === 'undefined' || rootEl) return;

  rootEl = document.createElement('div');
  rootEl.id = 'vb-readability-hud';
  rootEl.style.cssText = `
    position: fixed;
    inset: 0;
    display: none;
    pointer-events: none;
    user-select: none;
    z-index: 40;
  `;

  // A. Broadcast Scorebug Pill (top-center)
  scorebugEl = document.createElement('div');
  scorebugEl.id = 'vb-scorebug';
  scorebugEl.style.cssText = `
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    pointer-events: none;
    font-family: 'Orbitron', ui-monospace, SFMono-Regular, Menlo, monospace;
    z-index: 44;
  `;

  scorebugMatchRow = document.createElement('div');
  scorebugMatchRow.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 14px;
    border-radius: 999px;
    background: rgba(6, 10, 18, 0.92);
    border: 1px solid rgba(148, 163, 184, 0.35);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
    color: #f8fafc;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.08em;
  `;

  scorebugHomeDir = document.createElement('span');
  scorebugHomeDir.style.cssText = 'font-size: 10px; color: #94a3b8; font-weight: 800;';

  scorebugHomeDot = document.createElement('span');
  scorebugHomeDot.style.cssText = 'width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: #d90429;';

  const homeTag = document.createElement('span');
  homeTag.textContent = 'HOME';
  homeTag.style.cssText = 'font-size: 10.5px; color: #cbd5e1;';

  scorebugHomeScore = document.createElement('span');
  scorebugHomeScore.textContent = '0';
  scorebugHomeScore.style.cssText = 'font-size: 16px; color: #ffffff; min-width: 16px; text-align: center;';

  const dividerL = document.createElement('span');
  dividerL.textContent = '|';
  dividerL.style.cssText = 'color: rgba(255,255,255,0.22);';

  scorebugClock = document.createElement('span');
  scorebugClock.textContent = '05:00';
  scorebugClock.style.cssText = 'font-size: 13px; color: #f8fafc; min-width: 54px; text-align: center;';

  const dividerR = document.createElement('span');
  dividerR.textContent = '|';
  dividerR.style.cssText = 'color: rgba(255,255,255,0.22);';

  scorebugAwayScore = document.createElement('span');
  scorebugAwayScore.textContent = '0';
  scorebugAwayScore.style.cssText = 'font-size: 16px; color: #ffffff; min-width: 16px; text-align: center;';

  const awayTag = document.createElement('span');
  awayTag.textContent = 'AWAY';
  awayTag.style.cssText = 'font-size: 10.5px; color: #cbd5e1;';

  scorebugAwayDot = document.createElement('span');
  scorebugAwayDot.style.cssText = 'width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: #1d4ed8;';

  scorebugAwayDir = document.createElement('span');
  scorebugAwayDir.style.cssText = 'font-size: 10px; color: #94a3b8; font-weight: 800;';

  scorebugMatchRow.append(
    scorebugHomeDir,
    scorebugHomeDot,
    homeTag,
    scorebugHomeScore,
    dividerL,
    scorebugClock,
    dividerR,
    scorebugAwayScore,
    awayTag,
    scorebugAwayDot,
    scorebugAwayDir,
  );

  scorebugPracticeLine = document.createElement('div');
  scorebugPracticeLine.style.cssText = `
    display: none;
    padding: 6px 14px;
    border-radius: 999px;
    background: rgba(6, 10, 18, 0.84);
    border: 1px solid rgba(0, 229, 255, 0.38);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
    color: #e2e8f0;
    font-size: 11.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
  `;

  scorebugSwapBanner = document.createElement('div');
  scorebugSwapBanner.textContent = 'GOAL · ENDS SWAPPED';
  scorebugSwapBanner.style.cssText = `
    display: none;
    padding: 3px 10px;
    border-radius: 999px;
    background: rgba(251, 191, 36, 0.92);
    color: #0b111e;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.12em;
    box-shadow: 0 4px 14px rgba(251, 191, 36, 0.35);
  `;

  scorebugEl.append(scorebugMatchRow, scorebugPracticeLine, scorebugSwapBanner);
  rootEl.appendChild(scorebugEl);

  // C. Up to 4 off-screen ball pips and 4 post-goal swap tags
  for (let i = 0; i < 4; i++) {
    const pip = createPipElement(i);
    pipEls.push(pip.el);
    pipArrowEls.push(pip.arrow);
    rootEl.appendChild(pip.el);

    const tag = createSwapTagElement(i);
    swapTagEls.push(tag);
    rootEl.appendChild(tag);
  }

  document.body.appendChild(rootEl);
}

function hideAllPipsAndTags() {
  for (let i = 0; i < pipEls.length; i++) {
    if (pipEls[i].style.display !== 'none') pipEls[i].style.display = 'none';
    if (swapTagEls[i].style.display !== 'none') swapTagEls[i].style.display = 'none';
  }
}

export function hideMatchReadabilityHud() {
  if (!rootEl) return;
  if (cache.rootVisible) {
    rootEl.style.display = 'none';
    cache.rootVisible = false;
  }
  if (cache.scorebugVisible && scorebugEl) {
    scorebugEl.style.display = 'none';
    cache.scorebugVisible = false;
  }
  hideAllPipsAndTags();
}

function formatClock(match) {
  if (!match) return '00:00';
  if (match.matchOver) return 'FINAL';
  if (match.isGoldenGoal) return 'OT · GG';
  const totalSec = Math.max(0, Math.floor((match.ticksRemaining || 0) / 60));
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return match.overtimePeriod > 0 ? `OT ${m}:${s}` : `${m}:${s}`;
}

function pickNearestVisibleBall(balls, cameraPos) {
  if (!balls || balls.length === 0) return null;
  if (balls.length === 1) return balls[0]?.mesh?.visible !== false ? balls[0] : null;
  let best = null;
  let bestDistSq = Infinity;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (!b?.mesh || b.mesh.visible === false) continue;
    const dx = b.mesh.position.x - cameraPos.x;
    const dy = b.mesh.position.y - cameraPos.y;
    const dz = b.mesh.position.z - cameraPos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      best = b;
    }
  }
  return best;
}

/**
 * Updates optional broadcast scorebug and orientation cues.
 * Returns immediately with zero work when both preferences are OFF.
 *
 * @param {object} params
 * @param {string} params.gameState
 * @param {boolean} params.isVictoryActive
 * @param {boolean} params.isMenuOpen
 * @param {object|null} params.match
 * @param {object|null} params.practiceStats
 * @param {Array<object>} params.athletes
 * @param {Array<object>} params.balls
 * @param {Array<object>} params.viewportLayout
 * @param {boolean} params.isSplitscreen
 * @param {number} params.tick
 */
export function updateMatchReadabilityHud({
  gameState,
  isVictoryActive,
  isMenuOpen,
  match,
  practiceStats,
  athletes,
  balls,
  viewportLayout,
  isSplitscreen,
  tick = 0,
}) {
  if (!rootEl) return;

  const prefs = getHudPrefs();
  const scorebugMode = prefs.scorebugMode;
  const orientationOn = prefs.orientationCues;

  const isMatch = gameState === 'match';
  const isPractice = gameState === 'practice';
  const isActive = (isMatch || isPractice) && !isVictoryActive && !isMenuOpen;

  if (!isActive || (scorebugMode === 'off' && !orientationOn)) {
    hideMatchReadabilityHud();
    return;
  }

  // Advance tick-driven swap tag timers deterministically (zero wall clock)
  const tickDelta = cache.lastTickSeen >= 0 && tick >= cache.lastTickSeen
    ? Math.min(10, tick - cache.lastTickSeen)
    : 0;
  cache.lastTickSeen = tick;

  if (isMatch && match) {
    if (cache.lastTargetGoalSeen && cache.lastTargetGoalSeen !== match.targetGoal) {
      cache.swapBannerTicksLeft = SWAP_TAG_TICKS;
    }
    cache.lastTargetGoalSeen = match.targetGoal || '';
    if (cache.swapBannerTicksLeft > 0) {
      cache.swapBannerTicksLeft = Math.max(0, cache.swapBannerTicksLeft - tickDelta);
    }
  } else {
    cache.lastTargetGoalSeen = '';
    cache.swapBannerTicksLeft = 0;
  }

  if (isPractice && practiceStats) {
    const g = practiceStats.goals || 0;
    if (g > cache.lastPracticeGoalsSeen) {
      cache.practiceSwapTicksLeft = SWAP_TAG_TICKS;
    }
    cache.lastPracticeGoalsSeen = g;
    if (cache.practiceSwapTicksLeft > 0) {
      cache.practiceSwapTicksLeft = Math.max(0, cache.practiceSwapTicksLeft - tickDelta);
    }
  } else {
    cache.lastPracticeGoalsSeen = practiceStats?.goals || 0;
    cache.practiceSwapTicksLeft = 0;
  }

  if (!cache.rootVisible) {
    rootEl.style.display = 'block';
    cache.rootVisible = true;
  }

  // ─── A. BROADCAST SCOREBUG PILL ────────────────────────────────────────────
  const showScorebug = isMatch
    ? (scorebugMode === 'always' || (scorebugMode === 'splitscreen' && isSplitscreen))
    : (isPractice && scorebugMode === 'always');

  if (!showScorebug) {
    if (cache.scorebugVisible) {
      scorebugEl.style.display = 'none';
      cache.scorebugVisible = false;
    }
  } else {
    if (!cache.scorebugVisible) {
      scorebugEl.style.display = 'flex';
      cache.scorebugVisible = true;
    }

    if (isPractice) {
      if (!cache.scorebugIsPractice) {
        scorebugMatchRow.style.display = 'none';
        scorebugSwapBanner.style.display = 'none';
        scorebugPracticeLine.style.display = 'block';
        cache.scorebugIsPractice = true;
      }
      const g = practiceStats?.goals || 0;
      const h = practiceStats?.hits || 0;
      const w = practiceStats?.whiffs || 0;
      if (g !== cache.practiceGoals || h !== cache.practiceHits || w !== cache.practiceWhiffs) {
        cache.practiceGoals = g;
        cache.practiceHits = h;
        cache.practiceWhiffs = w;
        const attempts = h + w;
        const acc = attempts > 0 ? Math.round((h / attempts) * 100) : 0;
        scorebugPracticeLine.textContent = `PRACTICE · ${g} GOALS · ${acc}% ACC`;
      }
    } else if (match) {
      if (cache.scorebugIsPractice) {
        scorebugPracticeLine.style.display = 'none';
        scorebugMatchRow.style.display = 'flex';
        cache.scorebugIsPractice = false;
      }

      const homeHex = toCssHex(TUNING.athlete?.palette?.homePrimary, 0xd90429);
      const awayHex = toCssHex(TUNING.athlete?.palette?.awayPrimary, 0x1d4ed8);
      if (homeHex !== cache.homeHex) {
        cache.homeHex = homeHex;
        scorebugHomeDot.style.background = homeHex;
      }
      if (awayHex !== cache.awayHex) {
        cache.awayHex = awayHex;
        scorebugAwayDot.style.background = awayHex;
      }

      const sHome = match.scoreHome || 0;
      const sAway = match.scoreAway || 0;
      if (sHome !== cache.scoreHome) {
        cache.scoreHome = sHome;
        scorebugHomeScore.textContent = String(sHome);
      }
      if (sAway !== cache.scoreAway) {
        cache.scoreAway = sAway;
        scorebugAwayScore.textContent = String(sAway);
      }

      const clockText = formatClock(match);
      if (clockText !== cache.clockText) {
        cache.clockText = clockText;
        scorebugClock.textContent = clockText;
      }

      const targetGoal = match.targetGoal || 'N';
      if (targetGoal !== cache.targetGoal) {
        cache.targetGoal = targetGoal;
        scorebugHomeDir.textContent = targetGoal === 'N' ? '▲N' : '▼S';
        scorebugAwayDir.textContent = targetGoal === 'N' ? '▼S' : '▲N';
      }

      const showSwap = (match.celebrationTicks || 0) > 0;
      if (showSwap !== cache.flashing) {
        cache.flashing = showSwap;
        scorebugSwapBanner.style.display = showSwap ? 'block' : 'none';
      }
    }
  }

  // ─── C. OFF-SCREEN BALL PIPS & 1.4s POST-GOAL SWAP TAGS ───────────────────
  if (!orientationOn || !viewportLayout || viewportLayout.length === 0) {
    hideAllPipsAndTags();
    return;
  }

  const winH = typeof window !== 'undefined' ? window.innerHeight : 720;
  const vpCount = Math.min(viewportLayout.length, 4);

  for (let i = 0; i < 4; i++) {
    const pipEl = pipEls[i];
    const tagEl = swapTagEls[i];
    if (i >= vpCount) {
      if (pipEl.style.display !== 'none') pipEl.style.display = 'none';
      if (tagEl.style.display !== 'none') tagEl.style.display = 'none';
      continue;
    }

    const vp = viewportLayout[i];
    const cam = vp.camera;
    const slot = vp.slot;

    // Convert Three.js bottom-left WebGL viewport Y into CSS top-left Y
    const cssLeft = vp.x;
    const cssTop = winH - (vp.y + vp.h);
    const cssW = vp.w;
    const cssH = vp.h;

    // 1. Off-screen Ball Edge Pip
    const targetBall = cam ? pickNearestVisibleBall(balls, cam.position) : null;
    if (cam && targetBall?.mesh) {
      _projVec.copy(targetBall.mesh.position).project(cam);
      cam.getWorldDirection(_camForward);
      _toBall.copy(targetBall.mesh.position).sub(cam.position);
      const isBehind = _toBall.dot(_camForward) < 0;

      let ndcX = _projVec.x;
      let ndcY = _projVec.y;
      if (isBehind) {
        ndcX = -ndcX;
        ndcY = -ndcY;
      }

      const isOnScreen = !isBehind && Math.abs(ndcX) <= FRUSTUM_MARGIN_X && Math.abs(ndcY) <= FRUSTUM_MARGIN_Y && _projVec.z <= 1.0;

      if (isOnScreen) {
        if (pipEl.style.display !== 'none') pipEl.style.display = 'none';
      } else {
        // Clamp unit vector onto viewport edge rect
        const len = Math.hypot(ndcX, ndcY) || 1;
        let ux = ndcX / len;
        let uy = ndcY / len;
        const maxScale = Math.min(
          Math.abs(ux) > 1e-4 ? 1 / Math.abs(ux) : 1e6,
          Math.abs(uy) > 1e-4 ? 1 / Math.abs(uy) : 1e6,
        );
        const edgeX = ux * maxScale;
        const edgeY = uy * maxScale;

        const halfW = Math.max(1, cssW * 0.5 - PIP_INSET_X);
        const halfH = Math.max(1, cssH * 0.5 - PIP_INSET_Y);
        const px = Math.round(cssLeft + cssW * 0.5 + edgeX * halfW - 30);
        const py = Math.round(cssTop + cssH * 0.5 - edgeY * halfH - 12);

        const angleDeg = Math.round((Math.atan2(ux, uy) * 180) / Math.PI);
        if (pipEl.style.display !== 'flex') pipEl.style.display = 'flex';
        pipEl.style.transform = `translate3d(${px}px, ${py}px, 0)`;
        pipArrowEls[i].style.transform = `rotate(${angleDeg}deg)`;
      }
    } else if (pipEl.style.display !== 'none') {
      pipEl.style.display = 'none';
    }

    // 2. 1.4s Post-Goal End-Swap Corner Tag
    if (isMatch && cache.swapBannerTicksLeft > 0 && slot >= 0 && match) {
      const ath = athletes?.[slot];
      const athTeam = ath?.team || TUNING.players?.[slot]?.team || (slot % 2 === 0 ? 'home' : 'away');
      const attacksNorth = athTeam === 'home' ? (match.targetGoal === 'N') : (match.targetGoal === 'S');
      const accent = athTeam === 'home'
        ? toCssHex(TUNING.athlete?.palette?.homePrimary, 0xd90429)
        : toCssHex(TUNING.athlete?.palette?.awayPrimary, 0x1d4ed8);
      const nextText = `P${slot + 1} · ATTACK ${attacksNorth ? 'NORTH ▲' : 'SOUTH ▼'}`;
      if (tagEl.textContent !== nextText) tagEl.textContent = nextText;
      tagEl.style.borderColor = accent;
      tagEl.style.left = `${Math.round(cssLeft + 14)}px`;
      tagEl.style.top = `${Math.round(cssTop + 14)}px`;
      tagEl.style.opacity = cache.swapBannerTicksLeft < 18 ? String((cache.swapBannerTicksLeft / 18).toFixed(2)) : '1';
      if (tagEl.style.display !== 'block') tagEl.style.display = 'block';
    } else if (isPractice && cache.practiceSwapTicksLeft > 0 && i === 0) {
      const nextText = 'GOAL · TARGET FLIPPED';
      if (tagEl.textContent !== nextText) tagEl.textContent = nextText;
      tagEl.style.borderColor = '#00e5ff';
      tagEl.style.left = `${Math.round(cssLeft + 14)}px`;
      tagEl.style.top = `${Math.round(cssTop + 14)}px`;
      tagEl.style.opacity = cache.practiceSwapTicksLeft < 18 ? String((cache.practiceSwapTicksLeft / 18).toFixed(2)) : '1';
      if (tagEl.style.display !== 'block') tagEl.style.display = 'block';
    } else if (tagEl.style.display !== 'none') {
      tagEl.style.display = 'none';
    }
  }
}
