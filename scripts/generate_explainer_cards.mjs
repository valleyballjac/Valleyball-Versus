import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'captures', 'explainer', 'cards');
const OUT_16x9 = path.join(OUT_DIR, '16x9');
const OUT_9x16 = path.join(OUT_DIR, '9x16');
// The trailer's galaxy title cards, already carrying the CTA and championship
// date: the long cut closes on the 16:9 one, every TikTok part on the 9:16 one.
const OUTRO_16x9 = path.join(ROOT, 'captures', 'trailer', 'title_card_galaxy.png');
const OUTRO_9x16 = path.join(ROOT, 'captures', 'trailer', 'title_card_vertical_9x16.png');

/**
 * HOW TO PLAY EXPLAINER — text-card overlays for the 16:9 long cut and the
 * native 9:16 TikTok series. Copy is from Claude outputs/explainer/
 * explainer_script_draft1.md; every claim there was checked against the code.
 *
 * Two layouts, one data set:
 * - 16:9: the official trailer's lower-third, unchanged, plus control keycaps.
 * - 9:16: beat headline under the TikTok tabs, card above the caption strip,
 *   both left-aligned inside SAFE_9x16 and clear of the right-hand rail.
 *
 * `headlinePortrait` is a shorter headline for beats whose full one runs
 * past two lines at portrait size.
 *
 * Every PNG is a transparent overlay. Fit checks run in-page after layout and
 * fail the run when a block outgrows its line budget.
 */

// Gamepad glyphs, coloured as on the in-game How to Play controller diagram.
const PAD = {
  A: { glyph: 'A', shape: 'round', color: '#10b981' },
  B: { glyph: 'B', shape: 'round', color: '#38bdf8' },
  X: { glyph: 'X', shape: 'round', color: '#a855f7' },
  Y: { glyph: 'Y', shape: 'round', color: '#f43f5e' },
  LB: { glyph: 'LB', shape: 'bumper', color: '#38bdf8' },
  RB: { glyph: 'RB', shape: 'bumper', color: '#38bdf8' },
  LT: { glyph: 'LT', shape: 'bumper', color: '#38bdf8' },
  RT: { glyph: 'RT', shape: 'bumper', color: '#38bdf8' },
  LS: { glyph: 'L-STICK', shape: 'bumper', color: '#10b981' },
};

// Bindings from src/input/inputRouter.js (P1 keyboard + GAMEPAD_BUTTONS).
const CONTROLS = {
  move: { pad: 'LS', keys: ['WASD'], label: 'MOVE' },
  sprint: { pad: 'LT', keys: ['SHIFT'], label: 'SPRINT' },
  jump: { pad: 'A', keys: ['SPACE'], label: 'JUMP' },
  cut: { pad: 'RB', keys: ['V'], label: 'CUT' },
  volley: { pad: 'B', keys: ['E', 'L-CLICK'], label: 'VOLLEY' },
  spike: { pad: 'Y', keys: ['R', 'R-CLICK'], label: 'SPIKE' },
  dive: { pad: 'X', keys: ['Q'], label: 'DIVE' },
  brace: { pad: 'LB', keys: ['G'], label: 'BRACE' },
  slide: { pad: 'RT', keys: ['C'], label: 'SLIDE' },
};

// TikTok keep-out margins on 1080x1920: the conservative end of published
// third-party guidance. Check against TikTok's own template before release.
const SAFE_9x16 = { top: 130, bottom: 480, right: 150, left: 60 };

// Line budgets the fit check enforces.
const FIT = {
  landscape: { headline: 1, body: 2 },
  portrait: { headline: 2, body: 4, minCardTop: 1000 },
};

/**
 * `pending` names the open item in the script doc that can still change the
 * copy; the card renders either way.
 */
export const EXPLAINER_BEATS = [
  {
    id: 'b01_object', kicker: 'THE OBJECT // 01', suffix: 'ONE POINT PER RING',
    headline: 'PUT THE BALL THROUGH THE RING.', headlinePortrait: 'THROUGH THE RING.',
    body: 'Two giant rings rise from the high ground at each end of the valley. Through the ring is one point.',
    controls: [], chips: ['TWO RINGS', 'ONE POINT', 'EITHER SIDE COUNTS'], durationSec: 9.0,
  },
  {
    id: 'b02_flip', kicker: 'THE FLIP // 02', suffix: 'NO RESET',
    headline: 'SCORE, THEN SWITCH ENDS.',
    body: 'Every goal flips the target. You now attack the far ring and defend the one you just scored on.',
    controls: [], chips: ['INSTANT FLIP', 'NO KICKOFF', 'PLAY ON'], durationSec: 9.0,
  },
  {
    id: 'b03_clock', kicker: 'THE CLOCK // 03', suffix: 'REGULATION',
    headline: 'FIVE MINUTES. MOST GOALS WINS.', headlinePortrait: '5 MINUTES. MOST GOALS WINS.',
    body: 'The clock runs for five minutes of live play. Whoever leads at full time takes the match.',
    controls: [], chips: ['5:00 REGULATION', 'LIVE CLOCK', 'FULL TIME'], durationSec: 9.0,
  },
  {
    id: 'b04_valley', kicker: 'THE VALLEY // 04', suffix: 'SUNKEN BASIN',
    headline: 'THE COURT IS A BOWL.',
    body: 'Flat through the middle, climbing steeply toward each ring. Attacks go uphill, and loose balls roll back to the center.',
    controls: [], chips: ['SUNKEN BASIN', 'UPHILL ATTACKS', 'ROLLING RETURNS'], durationSec: 9.0,
  },
  {
    id: 'b05_live', kicker: 'ALWAYS LIVE // 05', suffix: 'GLASS PERIMETER',
    headline: 'NO OUT OF BOUNDS. NO WHISTLES.', headlinePortrait: 'NO OUT OF BOUNDS.',
    body: 'Glass walls surround the court, so the ball is always live. Banks off the walls are fair game.',
    controls: [], chips: ['GLASS WALLS', 'BALL ALWAYS LIVE', 'BANK SHOTS'], durationSec: 9.0,
  },
  {
    id: 'b06_move', kicker: 'MOVEMENT // 06', suffix: 'LIVE MOMENTUM',
    headline: 'RUN. SPRINT. JUMP.',
    body: 'Your athlete is a live physics body. Momentum carries, slopes push back, and every landing has weight.',
    controls: ['move', 'sprint', 'jump'], chips: [], durationSec: 9.0,
  },
  {
    id: 'b07_cut', kicker: 'THE CUT // 07', suffix: 'PLANT & REDIRECT',
    headline: 'OVERRAN IT? CUT.',
    body: 'Plant a foot to kill your momentum and push off in a new direction. It’s how you get behind the ball.',
    controls: ['cut'], chips: ['PLANT & PUSH', 'GRIPS ON SLOPES'], durationSec: 9.0,
  },
  {
    id: 'b08_strikes', kicker: 'STRIKING // 08', suffix: 'KICK OR VOLLEY',
    headline: 'ONE BUTTON. TWO STRIKES.',
    body: 'Ball at your feet? Volley becomes a lofted kick. Ball above your hips? It’s a two-handed volley.',
    controls: ['volley'], chips: ['LOW = KICK', 'HIGH = VOLLEY'], durationSec: 9.0,
  },
  {
    id: 'b09_spike', kicker: 'THE SPIKE // 09', suffix: 'AIR TIMING',
    headline: 'GET UP. SPIKE DOWN.',
    body: 'The spike drives the ball downward. Jump, meet it at the top of your leap, and hammer it at the ring.',
    controls: ['spike'], chips: ['JUMP + SPIKE', 'DRIVEN DOWN'], durationSec: 9.0,
  },
  {
    id: 'b10_timing', kicker: 'TIMING // 10', suffix: 'SWEET SPOT',
    headline: 'HIT THE SWEET SPOT.',
    body: 'Every strike has a perfect moment. Nail it for full power. Mistime it and the ball leaves at a third of the speed.',
    controls: [], chips: ['PERFECT WINDOW', 'FULL POWER', 'LATE = WEAK'], durationSec: 9.0,
  },
  {
    id: 'b11_aim', kicker: 'AIM // 11', suffix: 'NO AUTO-AIM',
    headline: 'NOBODY AIMS FOR YOU.',
    body: 'The ball goes where you’re facing and steering when you press. Get your feet right before you swing.',
    controls: [], chips: ['YOUR AIM ONLY', 'POSITION FIRST', 'ZERO MAGNETISM'], durationSec: 9.0,
  },
  {
    id: 'b12_dive', kicker: 'THE DIVE // 12', suffix: 'LAST-DITCH SAVE',
    headline: 'LAY OUT FOR IT.',
    body: 'Dive to throw your whole body at a ball you can’t reach on foot. A good dive pops it back into play.',
    controls: ['dive'], chips: ['FULL LAYOUT', '1 S RECOVERY'], durationSec: 9.0,
  },
  {
    id: 'b13_brace', kicker: 'THE BRACE // 13', suffix: 'AGILE BLOCK',
    headline: 'BRACE. KEEP MOVING.',
    body: 'Hold Brace to get your hands up. The ball rebounds off you, and you never stop moving.',
    controls: ['brace'], chips: ['MOVE WHILE BRACED', 'BRACE + DIVE = INTERCEPT'], durationSec: 9.0,
  },
  {
    id: 'b14_contact', kicker: 'CONTACT // 14', suffix: 'FULL PHYSICS',
    headline: 'IT’S FULL CONTACT.',
    body: 'Slide in at speed to sweep an opponent’s legs. Big hits put athletes down, and they climb back up on their own.',
    controls: ['slide'], chips: ['SLIDE TACKLES', 'KNOCKDOWNS'], durationSec: 9.0,
  },
  {
    id: 'b15_balls', kicker: 'THE BALLS // 15', suffix: 'THREE SIZES',
    headline: 'THREE BALLS. THREE GAMES.',
    body: 'Small is quick and twitchy. Medium is the match ball. Large is huge, forgiving, and made for long rallies.',
    controls: [], chips: ['SMALL 0.4 M', 'MEDIUM 1.0 M', 'LARGE 1.5 M'], durationSec: 10.8,
  },
  {
    id: 'b16_modes', kicker: 'MODES // 16', suffix: 'PICK YOUR FIGHT',
    headline: 'PLAY YOUR WAY.',
    body: 'Go 1v1 against the AI on Easy, Medium or Hard, take on a friend locally, or train in Practice with all three balls.',
    controls: [], chips: ['VS AI', 'LOCAL 1V1', 'PRACTICE'], durationSec: 12.2,
  },
  {
    // The game has no soft touch (strikes launch at fixed speeds), so the
    // finale is the payoff montage rather than a self-set volley-and-spike.
    id: 'b17_combo', kicker: 'PUT IT TOGETHER // 17', suffix: 'THE PAYOFF',
    headline: 'POSITION. STRIKE. SCORE.',
    body: 'Get behind the ball, time your swing, and send it through the ring. Then the court flips and you go again.',
    controls: [], chips: ['POSITION', 'TIMING', 'FINISH'], durationSec: 14.0,
  },
];

export const EXPLAINER_PARTS = [
  { n: 1, topic: 'SCORING', hook: 'HOW DO YOU EVEN SCORE?', beats: ['b01_object', 'b02_flip', 'b03_clock'] },
  { n: 2, topic: 'THE COURT', hook: 'THERE’S NO OUT OF BOUNDS', beats: ['b04_valley', 'b05_live'] },
  { n: 3, topic: 'MOVEMENT', hook: 'THE MOVE EVERY PRO USES', beats: ['b06_move', 'b07_cut'] },
  { n: 4, topic: 'STRIKING', hook: 'KICK OR VOLLEY?', beats: ['b08_strikes', 'b10_timing'] },
  { n: 5, topic: 'ATTACKING', hook: 'HOW TO SPIKE', beats: ['b09_spike', 'b11_aim', 'b17_combo'] },
  { n: 6, topic: 'DEFENDING', hook: 'HOW TO DEFEND', beats: ['b12_dive', 'b13_brace'] },
  { n: 7, topic: 'CONTACT', hook: 'CAN YOU TACKLE?', beats: ['b14_contact'] },
  { n: 8, topic: 'BALLS & MODES', hook: 'PICK YOUR BALL', beats: ['b15_balls', 'b16_modes'] },
];

const FONTS = '<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700&family=Space+Grotesk:wght@400;500;600&family=Syncopate:wght@700&display=swap" rel="stylesheet">';

const TOKENS = `
  :root {
    --chalk: #F5F5F7;
    --text-sub: #C8C8D4;
    --text-muted: #8E8E9E;
    --spec-cyan: #00E5FF;
    --surface-border: rgba(255, 255, 255, 0.12);
    --spectral-linear: linear-gradient(90deg, #FF2A42 0%, #FF6B00 14.3%, #FFD000 28.6%, #10E56A 42.9%, #00E5FF 57.2%, #1F65FF 71.5%, #6B11FF 85.8%, #E000B8 100%);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { overflow: hidden; background: transparent; -webkit-font-smoothing: antialiased; }
  body { position: relative; }
  .card {
    position: absolute;
    background: rgba(10, 10, 14, 0.80);
    border: 1px solid var(--surface-border);
    border-radius: 8px;
    box-shadow: 0 18px 48px rgba(3, 3, 8, 0.62);
    overflow: hidden;
  }
  .seam { width: 100%; background: var(--spectral-linear); }
  .eyebrow { display: flex; align-items: center; font-family: 'JetBrains Mono', monospace; font-weight: 600; text-transform: uppercase; }
  .dot { border-radius: 50%; background: var(--spectral-linear); flex: 0 0 auto; }
  .pre { color: var(--spec-cyan); }
  .sep { color: rgba(255, 255, 255, 0.28); }
  .suf { color: var(--text-muted); }
  .headline { font-family: 'Syncopate', sans-serif; font-weight: 700; text-transform: uppercase; color: var(--chalk); }
  .prose { font-family: 'Space Grotesk', sans-serif; font-weight: 400; color: var(--text-sub); letter-spacing: 0.01em; }
  .chips { display: flex; align-items: center; flex-wrap: wrap; border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-family: 'JetBrains Mono', monospace; font-weight: 600; text-transform: uppercase; color: var(--chalk); }
  .ctl { display: inline-flex; align-items: center; white-space: nowrap; }
  .cap { display: inline-flex; align-items: center; justify-content: center; font-family: 'JetBrains Mono', monospace;
    font-weight: 700; color: var(--chalk); background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.30); }
  .cap.round { border-radius: 50%; padding: 0; }
  .cap.bumper { border-radius: 999px; }
  .cap.pad { border-color: var(--c); color: var(--c); box-shadow: 0 0 10px color-mix(in srgb, var(--c) 45%, transparent); }
  .cap.key { border-radius: 5px; }
  .ctl-or { color: rgba(255, 255, 255, 0.35); }
  .ctl-label { color: var(--spec-cyan); }
`;

function controlHtml(id) {
  const c = CONTROLS[id];
  const p = PAD[c.pad];
  const keys = c.keys.map((k) => `<span class="cap key">${k}</span>`).join('<span class="ctl-or">/</span>');
  return `<span class="ctl"><span class="cap pad ${p.shape}" style="--c:${p.color}">${p.glyph}</span>`
    + `<span class="ctl-or">/</span>${keys}<span class="ctl-label">${c.label}</span></span>`;
}

function chipsHtml(beat) {
  const items = [...beat.controls.map(controlHtml), ...beat.chips.map((c) => `<span>${c}</span>`)];
  return items.join('<span class="sep">·</span>');
}

function eyebrowHtml(pre, suf) {
  return `<div class="eyebrow"><span class="dot"></span><span class="pre">${pre}</span>`
    + `<span class="sep">·</span><span class="suf">${suf}</span></div>`;
}

function buildLandscapeHtml(beat) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${FONTS}<style>${TOKENS}
    html, body { width: 1920px; height: 1080px; }
    .card { left: 76px; bottom: 58px; width: 980px; }
    .wrap { padding: 20px 28px 18px; display: flex; flex-direction: column; gap: 9px; }
    .eyebrow { gap: 10px; font-size: 11.5px; letter-spacing: 0.20em; }
    .dot { width: 9px; height: 9px; }
    .headline { font-size: 25px; letter-spacing: 0.10em; line-height: 1.18; margin-top: 1px; }
    .prose { font-size: 18px; line-height: 1.44; }
    .chips { margin-top: 4px; padding-top: 10px; gap: 8px 12px; font-size: 11px; letter-spacing: 0.16em; opacity: 0.92; }
    .ctl { gap: 6px; }
    .cap { min-width: 22px; height: 22px; padding: 0 6px; font-size: 11px; letter-spacing: 0; }
    .cap.round { width: 22px; }
    .ctl-label { margin-left: 4px; }
    .seam { height: 2.5px; }
  </style></head><body>
    <div class="card">
      <div class="wrap">
        ${eyebrowHtml(beat.kicker, beat.suffix)}
        <div class="headline" data-fit="headline">${beat.headline}</div>
        <div class="prose" data-fit="body">${beat.body}</div>
        ${beat.controls.length + beat.chips.length ? `<div class="chips">${chipsHtml(beat)}</div>` : ''}
      </div>
      <div class="seam"></div>
    </div>
  </body></html>`;
}

/** The long cut's opening slate, in the trailer's hollow impact-word style. */
function buildTitleSlateHtml() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${FONTS}<style>${TOKENS}
    html, body { width: 1920px; height: 1080px; }
    .lockup { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 1500px;
      display: flex; flex-direction: column; align-items: center; text-align: center; gap: 22px; padding: 40px 70px;
      background: radial-gradient(ellipse at center, rgba(3,3,8,0.62) 0%, rgba(3,3,8,0) 72%); }
    .eyebrow { justify-content: center; gap: 14px; font-size: 20px; letter-spacing: 0.32em; }
    .dot { width: 12px; height: 12px; }
    .impact { font-family: 'Syncopate', sans-serif; font-weight: 700; font-size: 96px; letter-spacing: 0.18em;
      text-indent: 0.18em; line-height: 1.08; color: rgba(245,245,247,0.16); -webkit-text-stroke: 2.5px #F5F5F7;
      text-shadow: 0 6px 24px rgba(3,3,8,0.92), 0 0 28px rgba(255,255,255,0.35), 0 0 56px rgba(0,229,255,0.30); }
    .seam { width: 460px; height: 3.5px; border-radius: 2px; box-shadow: 0 4px 16px rgba(3,3,8,0.85), 0 0 18px rgba(0,229,255,0.55); }
  </style></head><body>
    <div class="lockup">
      <div class="eyebrow"><span class="dot"></span><span class="pre">VALLEYBALL VERSUS</span></div>
      <div class="impact" data-fit="headline">HOW TO PLAY</div>
      <div class="seam"></div>
    </div>
  </body></html>`;
}

// The headline block under the TikTok tabs, shared by beat cards and end slates.
const PORTRAIT_TOP_CSS = `
    .top { position: absolute; left: ${SAFE_9x16.left + 4}px; top: ${SAFE_9x16.top + 70}px; width: ${1080 - SAFE_9x16.left - SAFE_9x16.right - 8}px;
      display: flex; flex-direction: column; gap: 22px; }
    .top .eyebrow { gap: 14px; font-size: 22px; letter-spacing: 0.20em; }
    .top .dot { width: 14px; height: 14px; }
    .top .suf { color: #B8B8C8; }
    .top .headline { font-size: 62px; letter-spacing: 0.06em; line-height: 1.12;
      text-shadow: 0 4px 24px rgba(3,3,8,0.85), 0 0 2px rgba(3,3,8,0.6); }
    .top .seam { width: 150px; height: 5px; border-radius: 3px; }`;

/**
 * A TikTok part's closing frame: the vertical galaxy card (logo, CTA, date)
 * with the next part teased above the logo. `next` is null on the last part.
 */
function buildEndSlateHtml(bgDataUrl, part, next) {
  const eyebrow = eyebrowHtml(`PART ${part.n}/${EXPLAINER_PARTS.length}`, next ? 'NEXT UP' : 'SERIES COMPLETE');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${FONTS}<style>${TOKENS}
    html, body { width: 1080px; height: 1920px; }
    .bg { position: absolute; inset: 0; width: 1080px; height: 1920px; }
    ${PORTRAIT_TOP_CSS}
  </style></head><body>
    <img class="bg" src="${bgDataUrl}">
    <div class="top">
      ${eyebrow}
      <div class="headline" data-fit="headline">${next ? next.hook : 'NOW GO PLAY.'}</div>
      <div class="seam"></div>
    </div>
  </body></html>`;
}

/** `beat` is null for a part's opening hook, which has no lower card. */
function buildPortraitHtml(part, headline, beat) {
  const s = SAFE_9x16;
  const safeW = 1080 - s.left - s.right;
  const card = beat ? `
    <div class="card" data-fit="card">
      <div class="wrap">
        ${eyebrowHtml(beat.kicker, beat.suffix)}
        <div class="prose" data-fit="body">${beat.body}</div>
        ${beat.controls.length + beat.chips.length ? `<div class="chips">${chipsHtml(beat)}</div>` : ''}
      </div>
      <div class="seam"></div>
    </div>` : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${FONTS}<style>${TOKENS}
    html, body { width: 1080px; height: 1920px; }
    .scrim { position: absolute; left: 0; top: 0; width: 1080px; height: 760px;
      background: linear-gradient(to bottom, rgba(3,3,8,0.80) 0%, rgba(3,3,8,0.55) 45%, rgba(3,3,8,0) 100%); }
    ${PORTRAIT_TOP_CSS}
    .card { left: ${s.left}px; bottom: ${s.bottom + 24}px; width: ${safeW}px; border-radius: 14px; }
    .wrap { padding: 30px 36px 28px; display: flex; flex-direction: column; gap: 18px; }
    .card .eyebrow { gap: 12px; font-size: 19px; letter-spacing: 0.18em; }
    .card .dot { width: 12px; height: 12px; }
    .prose { font-size: 37px; line-height: 1.36; color: #DCDCE6; }
    .chips { padding-top: 20px; gap: 14px 18px; font-size: 20px; letter-spacing: 0.14em; }
    .ctl { gap: 10px; }
    .cap { min-width: 44px; height: 44px; padding: 0 12px; font-size: 21px; }
    .cap.round { width: 44px; }
    .ctl-label { margin-left: 6px; }
    .card .seam { height: 5px; }
  </style></head><body>
    <div class="scrim"></div>
    <div class="top">
      ${eyebrowHtml(`PART ${part.n}/${EXPLAINER_PARTS.length}`, part.topic)}
      <div class="headline" data-fit="headline">${headline}</div>
      <div class="seam"></div>
    </div>
    ${card}
  </body></html>`;
}

/** Lines per [data-fit] block, plus the card's top edge in page pixels. */
async function measure(page) {
  return page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('[data-fit]')) {
      const r = el.getBoundingClientRect();
      if (el.dataset.fit === 'card') { out.cardTop = Math.round(r.top); continue; }
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      out[el.dataset.fit] = Math.round(r.height / lh);
    }
    return out;
  });
}

function checkFit(label, m, budget) {
  const problems = [];
  if (m.headline > budget.headline) problems.push(`headline ${m.headline} lines > ${budget.headline}`);
  if (m.body > budget.body) problems.push(`body ${m.body} lines > ${budget.body}`);
  if (budget.minCardTop && m.cardTop !== undefined && m.cardTop < budget.minCardTop) {
    problems.push(`card top ${m.cardTop}px < ${budget.minCardTop}px`);
  }
  return problems.map((p) => `${label}: ${p}`);
}

async function renderOverlay(page, html, outPath) {
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(120);
  const m = await measure(page);
  await page.screenshot({ path: outPath, type: 'png', omitBackground: true });
  return m;
}

/** Review sheet: every overlay of one format tiled over flat turf green. */
async function renderReviewSheet(browser, files, tileW, tileH, cols, outPath) {
  const rows = Math.ceil(files.length / cols);
  const gap = 12;
  const width = cols * tileW + (cols + 1) * gap;
  const height = rows * (tileH + 26) + (rows + 1) * gap;
  const tiles = files.map((f) => `<figure><img src="${pathToFileURL(f).href}"><figcaption>${path.basename(f, '.png')}</figcaption></figure>`).join('');
  // Written to disk and opened by file URL: a setContent page is about:blank
  // and may not load file:// images.
  const htmlPath = outPath.replace(/\.png$/, '.html');
  fs.writeFileSync(htmlPath, `<!DOCTYPE html><html><head><style>
    body { margin: 0; padding: ${gap}px; background: #111318; display: grid; grid-template-columns: repeat(${cols}, ${tileW}px); gap: ${gap}px; }
    figure { margin: 0; }
    img { display: block; width: ${tileW}px; height: ${tileH}px; background: linear-gradient(160deg, #86ab78, #6e9462); }
    figcaption { font: 600 13px/26px ui-monospace, Consolas, monospace; color: #9aa3b2; }
  </style></head><body>${tiles}</body></html>`);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.screenshot({ path: outPath, type: 'png' });
  await page.close();
  fs.rmSync(htmlPath);
}

export async function generateExplainerCards() {
  for (const outro of [OUTRO_16x9, OUTRO_9x16]) {
    if (!fs.existsSync(outro)) {
      throw new Error(`missing ${path.relative(ROOT, outro)} — run scripts/generate_tiktok_graphics.mjs (9:16) or the trailer capture (16:9) first`);
    }
  }
  fs.mkdirSync(OUT_16x9, { recursive: true });
  fs.mkdirSync(OUT_9x16, { recursive: true });
  const beatById = new Map(EXPLAINER_BEATS.map((b) => [b.id, b]));
  const partByBeat = new Map();
  for (const part of EXPLAINER_PARTS) for (const id of part.beats) partByBeat.set(id, part);

  const browser = await chromium.launch({ headless: true });
  const landscape = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const portrait = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const problems = [];
  const files16 = [];
  const files9 = [];

  const title16 = path.join(OUT_16x9, 'b00_title_how_to_play.png');
  problems.push(...checkFit('16x9/title', await renderOverlay(landscape, buildTitleSlateHtml(), title16), FIT.landscape));
  files16.push(title16);
  for (const beat of EXPLAINER_BEATS) {
    const out16 = path.join(OUT_16x9, `${beat.id}.png`);
    problems.push(...checkFit(`16x9/${beat.id}`, await renderOverlay(landscape, buildLandscapeHtml(beat), out16), FIT.landscape));
    files16.push(out16);
  }

  const outroDataUrl = `data:image/png;base64,${fs.readFileSync(OUTRO_9x16).toString('base64')}`;
  const endSlates = [];
  EXPLAINER_PARTS.forEach((part, p) => {
    const prefix = `part${String(part.n).padStart(2, '0')}`;
    files9.push(path.join(OUT_9x16, `${prefix}_00_hook.png`));
    part.beats.forEach((id, i) => files9.push(path.join(OUT_9x16, `${prefix}_${String(i + 1).padStart(2, '0')}_${id}.png`)));
    const end = path.join(OUT_9x16, `${prefix}_99_end.png`);
    files9.push(end);
    endSlates.push({ file: end, part, next: EXPLAINER_PARTS[p + 1] ?? null });
  });
  for (const part of EXPLAINER_PARTS) {
    const hook = path.join(OUT_9x16, `part${String(part.n).padStart(2, '0')}_00_hook.png`);
    problems.push(...checkFit(`9x16/part${part.n} hook`, await renderOverlay(portrait, buildPortraitHtml(part, part.hook, null), hook), FIT.portrait));
  }
  for (const { file, part, next } of endSlates) {
    problems.push(...checkFit(`9x16/part${part.n} end`, await renderOverlay(portrait, buildEndSlateHtml(outroDataUrl, part, next), file), FIT.portrait));
  }
  for (const file of files9) {
    const match = /part\d+_\d+_(b\d+_\w+)\.png$/.exec(file);
    if (!match) continue;
    const beat = beatById.get(match[1]);
    const part = partByBeat.get(beat.id);
    problems.push(...checkFit(`9x16/${beat.id}`, await renderOverlay(portrait, buildPortraitHtml(part, beat.headlinePortrait ?? beat.headline, beat), file), FIT.portrait));
  }

  await renderReviewSheet(browser, files16, 640, 360, 3, path.join(OUT_DIR, 'review_16x9.png'));
  await renderReviewSheet(browser, files9, 270, 480, 9, path.join(OUT_DIR, 'review_9x16.png'));

  const manifest = {
    safe9x16: SAFE_9x16,
    title16x9: path.relative(ROOT, title16),
    outro16x9: path.relative(ROOT, OUTRO_16x9),
    beats: EXPLAINER_BEATS.map(({ id, durationSec, pending }) => ({ id, durationSec, pending: pending ?? null })),
    parts: EXPLAINER_PARTS.map((part, p) => ({ ...part, endSlate: path.relative(ROOT, endSlates[p].file) })),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await browser.close();

  console.log(`[explainer-cards] ${files16.length} landscape + ${files9.length} portrait overlays -> ${path.relative(ROOT, OUT_DIR)}`);
  for (const beat of EXPLAINER_BEATS) if (beat.pending) console.log(`[explainer-cards] pending: ${beat.id} (${beat.pending})`);
  if (problems.length) {
    for (const p of problems) console.error(`[explainer-cards] FIT ${p}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateExplainerCards().catch((err) => {
    console.error('[explainer-cards] Failed:', err);
    process.exit(1);
  });
}
