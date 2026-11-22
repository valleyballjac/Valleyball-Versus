/**
 * Module: ui/practiceHud
 * Role: Compact top-left Practice Mode HUD showing active drill mode, live 60s Newcomer Drill
 *   4-step checklist, quick-toss ball summon hint (B / Select), and live hit accuracy counters.
 * Frame Phase: Render (throttled DOM diff, 0 allocations on unchanged frames).
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Pure read-only UI overlay; never writes simulation state.
 */

import {
  practiceStats,
  newcomerDrill,
  getSelectedPracticeDrill,
  getPracticeSessionSeconds,
} from '../features/match/practiceMode.js';

const DRILL_LABELS = {
  sandbox: 'FREE SANDBOX',
  newcomer_drill: '60s NEWCOMER DRILL',
  ball_feeder: 'BALL FEEDER (4.5s LOB)',
  sparring_bot: 'SPARRING BOT (1v1)',
  local_warmup: 'LOCAL WARMUP (MULTIPLAYER)',
};

let rootEl = null;
let lastRenderKey = '';

function ensureRoot() {
  if (rootEl || typeof document === 'undefined') return rootEl;
  rootEl = document.createElement('div');
  rootEl.id = 'practice-mode-hud';
  rootEl.style.cssText = `
    position: fixed;
    top: 14px;
    left: 14px;
    display: none;
    flex-direction: column;
    gap: 6px;
    padding: 10px 14px;
    min-width: 240px;
    max-width: 310px;
    background: rgba(10, 15, 24, 0.84);
    border: 1px solid rgba(168, 85, 247, 0.45);
    border-left: 4px solid #a855f7;
    border-radius: 8px;
    color: #e2e8f0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    pointer-events: none;
    user-select: none;
    z-index: 420;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
  `;
  document.body.appendChild(rootEl);
  return rootEl;
}

function stepRowHtml(label, done, cur, target) {
  const color = done ? '#4ade80' : '#cbd5e1';
  const icon = done ? '✓' : '○';
  return `<div style="display:flex;justify-content:space-between;align-items:center;color:${color};font-weight:${done ? '800' : '600'};">
    <span>${icon} ${label}</span>
    <span>${cur}/${target}</span>
  </div>`;
}

/**
 * Updates the Practice Mode HUD pill. Auto-hides outside Practice or when Clean Broadcast / menus are open.
 *
 * @param {{ gameState: string, isMenuOpen: boolean }} state
 */
export function updatePracticeHud({ gameState, isMenuOpen }) {
  const el = ensureRoot();
  if (!el) return;

  const drillMode = getSelectedPracticeDrill();
  if (gameState !== 'practice' || isMenuOpen) {
    if (el.style.display !== 'none') el.style.display = 'none';
    return;
  }

  if (el.style.display !== 'flex') el.style.display = 'flex';

  const hits = practiceStats.hits || 0;
  const whiffs = practiceStats.whiffs || 0;
  const attempts = hits + whiffs;
  const acc = attempts > 0 ? Math.round((hits / attempts) * 100) : 0;
  const goals = practiceStats.goals || 0;
  const secInt = Math.floor(getPracticeSessionSeconds());
  const remSec = Math.ceil((newcomerDrill.ticksRemaining || 0) / 60);

  const key = `${drillMode}|${hits}|${whiffs}|${goals}|${secInt}|${newcomerDrill.volleysDone}|${newcomerDrill.spikesDone}|${newcomerDrill.divesDone}|${newcomerDrill.goalsDone}|${newcomerDrill.completed}`;
  if (key === lastRenderKey) return;
  lastRenderKey = key;

  const title = DRILL_LABELS[drillMode] || 'PRACTICE SANDBOX';
  let drillHtml = '';

  if (drillMode === 'newcomer_drill') {
    const statusChip = newcomerDrill.completed
      ? `<span style="color:#4ade80;font-weight:900;">DRILL COMPLETE (${newcomerDrill.completedAtSeconds}s)!</span>`
      : `<span style="color:#fbb417;font-weight:900;">${remSec}s LEFT</span>`;
    drillHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(255,255,255,0.1);padding-top:5px;margin-top:2px;">
        <span style="color:#c084fc;font-weight:800;font-size:10px;">NEWCOMER CHECKLIST</span>
        ${statusChip}
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;font-size:10.5px;">
        ${stepRowHtml('Land 3 Volleys / Kicks', newcomerDrill.volleysDone >= newcomerDrill.volleyTarget, newcomerDrill.volleysDone, newcomerDrill.volleyTarget)}
        ${stepRowHtml('Rip 1 Power Spike', newcomerDrill.spikesDone >= newcomerDrill.spikeTarget, newcomerDrill.spikesDone, newcomerDrill.spikeTarget)}
        ${stepRowHtml('Commit 1 Dive Save', newcomerDrill.divesDone >= newcomerDrill.diveTarget, newcomerDrill.divesDone, newcomerDrill.diveTarget)}
        ${stepRowHtml('Score 1 Hoop Goal', newcomerDrill.goalsDone >= newcomerDrill.goalTarget, newcomerDrill.goalsDone, newcomerDrill.goalTarget)}
      </div>
    `;
  }

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span style="font-weight:900;color:#ffffff;letter-spacing:0.08em;">${title}</span>
      <span style="color:#38bdf8;font-weight:800;">G:${goals} · H:${hits} (${acc}%)</span>
    </div>
    ${drillHtml}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid rgba(255,255,255,0.1);padding-top:4px;font-size:10px;color:#94a3b8;white-space:nowrap;">
      <span><b style="color:#00e5ff;">B / SELECT</b>: Toss Ball In Front</span>
      <span><b style="color:#cbd5e1;">ESC / START</b>: Menu</span>
    </div>
  `;
}

export function hidePracticeHud() {
  if (rootEl) rootEl.style.display = 'none';
}
