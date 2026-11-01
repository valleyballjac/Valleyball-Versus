// Card mock-ups for the How to Play explainer: one beat (B12, the dive) in the
// trailer's 16:9 lower-third and in the native 9:16 TikTok layout, over the
// same simulation tick rendered natively at each aspect.
//
// Run from the repo root:  node "Claude outputs/explainer/mockups/render_mockups.mjs"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'node_modules/playwright/index.mjs')).href);

const BEAT = {
  kicker: 'THE DIVE // 12',
  kickerSuffix: 'LAST-DITCH SAVE',
  headline: 'LAY OUT FOR IT.',
  body: 'Dive to throw your whole body at a ball you can’t reach on foot. A good dive pops it back into play.',
  control: { pad: 'X', padColor: '#a855f7', key: 'Q', label: 'DIVE' },
  chips: ['FULL LAYOUT', '1 S RECOVERY'],
  part: 'PART 6/8',
  partTopic: 'HOW TO DEFEND',
};

// TikTok keep-out margins (conservative end of published guidance; final
// check against TikTok's own safe-zone template before release).
const SAFE = { top: 130, bottom: 480, right: 150, left: 60 };

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
  body { position: relative; overflow: hidden; background: #000; -webkit-font-smoothing: antialiased; }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
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
  .ctl { display: inline-flex; align-items: center; }
  .cap { display: inline-flex; align-items: center; justify-content: center; font-family: 'JetBrains Mono', monospace;
    font-weight: 700; color: var(--chalk); background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.30); }
  .cap.pad { border-radius: 50%; border-color: var(--c); color: var(--c); box-shadow: 0 0 10px color-mix(in srgb, var(--c) 45%, transparent); }
  .cap.key { border-radius: 5px; }
  .ctl-or { color: rgba(255, 255, 255, 0.35); }
  .ctl-label { color: var(--spec-cyan); }
`;

function controlHtml(c) {
  return `<span class="ctl"><span class="cap pad" style="--c:${c.padColor}">${c.pad}</span><span class="ctl-or">/</span><span class="cap key">${c.key}</span><span class="ctl-label">${c.label}</span></span>`;
}

function chipsHtml(beat) {
  return [controlHtml(beat.control), ...beat.chips.map((c) => `<span>${c}</span>`)].join('<span class="sep">·</span>');
}

// 16:9 — the trailer's lower-third, unchanged except for the control chip.
function landscapeHtml(bg, beat) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${FONTS}<style>${TOKENS}
    body { width: 1920px; height: 1080px; }
    .card { left: 76px; bottom: 58px; width: 980px; }
    .wrap { padding: 20px 28px 18px; display: flex; flex-direction: column; gap: 9px; }
    .eyebrow { gap: 10px; font-size: 11.5px; letter-spacing: 0.20em; }
    .dot { width: 9px; height: 9px; }
    .headline { font-size: 25px; letter-spacing: 0.10em; line-height: 1.18; margin-top: 1px; }
    .prose { font-size: 18px; line-height: 1.44; }
    .chips { margin-top: 4px; padding-top: 10px; gap: 12px; font-size: 11px; letter-spacing: 0.16em; opacity: 0.92; }
    .ctl { gap: 6px; }
    .cap { min-width: 22px; height: 22px; padding: 0 5px; font-size: 11px; letter-spacing: 0; }
    .ctl-label { margin-left: 4px; }
    .seam { height: 2.5px; }
  </style></head><body>
    <img class="bg" src="${bg}">
    <div class="card">
      <div class="wrap">
        <div class="eyebrow"><span class="dot"></span><span class="pre">${beat.kicker}</span><span class="sep">·</span><span class="suf">${beat.kickerSuffix}</span></div>
        <div class="headline">${beat.headline}</div>
        <div class="prose">${beat.body}</div>
        <div class="chips">${chipsHtml(beat)}</div>
      </div>
      <div class="seam"></div>
    </div>
  </body></html>`;
}

// 9:16 — headline up top under the TikTok tabs, the card above the caption
// strip, both left-aligned inside the safe area and clear of the right rail.
function portraitHtml(bg, beat, showSafe) {
  const safeW = 1080 - SAFE.left - SAFE.right;
  const overlay = showSafe ? `
    <div class="ko" style="left:0;top:0;width:1080px;height:${SAFE.top}px"><span>TABS / LIVE</span></div>
    <div class="ko" style="left:0;bottom:0;width:1080px;height:${SAFE.bottom}px"><span>CAPTION · USERNAME · SOUND</span></div>
    <div class="ko" style="right:0;top:${SAFE.top}px;width:${SAFE.right}px;height:${1920 - SAFE.top - SAFE.bottom}px"><span class="v">LIKE · COMMENT · SHARE</span></div>
    <div class="ko" style="left:0;top:${SAFE.top}px;width:${SAFE.left}px;height:${1920 - SAFE.top - SAFE.bottom}px"></div>
    <div class="safe" style="left:${SAFE.left}px;top:${SAFE.top}px;width:${safeW}px;height:${1920 - SAFE.top - SAFE.bottom}px"></div>` : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${FONTS}<style>${TOKENS}
    body { width: 1080px; height: 1920px; }
    .scrim { position: absolute; left: 0; top: 0; width: 1080px; height: 760px;
      background: linear-gradient(to bottom, rgba(3,3,8,0.80) 0%, rgba(3,3,8,0.55) 45%, rgba(3,3,8,0) 100%); }
    .top { position: absolute; left: ${SAFE.left + 4}px; top: ${SAFE.top + 70}px; width: ${safeW - 8}px; display: flex; flex-direction: column; gap: 22px; }
    .top .eyebrow { gap: 14px; font-size: 22px; letter-spacing: 0.20em; }
    .top .dot { width: 14px; height: 14px; }
    .top .headline { font-size: 62px; letter-spacing: 0.06em; line-height: 1.12;
      text-shadow: 0 4px 24px rgba(3,3,8,0.85), 0 0 2px rgba(3,3,8,0.6); }
    .top .seam { width: 150px; height: 5px; border-radius: 3px; }
    .card { left: ${SAFE.left}px; bottom: ${SAFE.bottom + 24}px; width: ${safeW}px; border-radius: 14px; }
    .wrap { padding: 30px 36px 28px; display: flex; flex-direction: column; gap: 18px; }
    .card .eyebrow { gap: 12px; font-size: 19px; letter-spacing: 0.18em; }
    .card .dot { width: 12px; height: 12px; }
    .prose { font-size: 37px; line-height: 1.36; color: #DCDCE6; }
    .chips { padding-top: 20px; gap: 18px; font-size: 20px; letter-spacing: 0.14em; }
    .ctl { gap: 10px; }
    .cap { min-width: 44px; height: 44px; padding: 0 10px; font-size: 21px; }
    .ctl-label { margin-left: 6px; }
    .card .seam { height: 5px; }
    .ko { position: absolute; background: rgba(255, 40, 70, 0.22); display: flex; align-items: center; justify-content: center; }
    .ko span { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 20px; letter-spacing: 0.16em; color: rgba(255,255,255,0.85); }
    .ko span.v { writing-mode: vertical-rl; }
    .safe { position: absolute; border: 3px dashed rgba(0, 229, 255, 0.85); }
  </style></head><body>
    <img class="bg" src="${bg}">
    <div class="scrim"></div>
    <div class="top">
      <div class="eyebrow"><span class="dot"></span><span class="pre">${beat.part}</span><span class="sep">·</span><span class="suf" style="color:#B8B8C8">${beat.partTopic}</span></div>
      <div class="headline">${beat.headline}</div>
      <div class="seam"></div>
    </div>
    <div class="card">
      <div class="wrap">
        <div class="eyebrow"><span class="dot"></span><span class="pre">${beat.kicker}</span><span class="sep">·</span><span class="suf">${beat.kickerSuffix}</span></div>
        <div class="prose">${beat.body}</div>
        <div class="chips">${chipsHtml(beat)}</div>
      </div>
      <div class="seam"></div>
    </div>
    ${overlay}
  </body></html>`;
}

const bgUrl = (name) => pathToFileURL(path.join(HERE, 'bg', name)).href;
const jobs = [
  { out: 'B12_dive_16x9.png', w: 1920, h: 1080, html: landscapeHtml(bgUrl('dive_16x9.jpg'), BEAT) },
  { out: 'B12_dive_9x16.png', w: 1080, h: 1920, html: portraitHtml(bgUrl('dive_9x16.jpg'), BEAT, false) },
  { out: 'B12_dive_9x16_safezones.png', w: 1080, h: 1920, html: portraitHtml(bgUrl('dive_9x16.jpg'), BEAT, true) },
];

const browser = await chromium.launch({ headless: true });
const htmlDir = path.join(HERE, 'html');
fs.mkdirSync(htmlDir, { recursive: true });
for (const job of jobs) {
  const page = await browser.newPage({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: 1 });
  const htmlPath = path.join(htmlDir, job.out.replace('.png', '.html'));
  fs.writeFileSync(htmlPath, job.html);
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(HERE, job.out), type: 'png' });
  await page.close();
  console.log(`[mockups] ${job.out}`);
}
await browser.close();
