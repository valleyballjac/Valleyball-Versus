import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'captures', 'trailer', 'captions');
fs.mkdirSync(OUT_DIR, { recursive: true });

/**
 * Phase 1 Educational Lower-Thirds (0:00.00 - 43.60s)
 * Styled strictly per Valleyball (v2.4) & Valleyball Versus (v2.1) Brand Dictionaries:
 * - Obsidian / Instrument Glass surface (#0A0A0C @ 82% alpha)
 * - Hairline neutral border (rgba(255,255,255,0.12)) — Violation VS-02 compliant (no arbitrary team hue framing)
 * - 8-Stop Spectral Seam accent rule (--spectral-linear)
 * - Syncopate 700 headlines, Space Grotesk body prose, JetBrains Mono metadata
 */
export const TRAILER_CAPTIONS = [
  {
    id: 'caption_01',
    file: 'caption_01.png',
    kind: 'card',
    startSec: 0.00,
    endSec: 5.00,
    fadeInSec: 0.45,
    fadeOutSec: 0.35,
    pillPrefix: 'ORIGINS // 01',
    pillSuffix: '3,500 YEARS OF SPORT EVOLVED',
    headline: 'WELCOME TO VALLEYBALL',
    body: 'Ancient stone-ring competition meets modern active physics inside a parabolic valley.',
    chips: ['PARABOLIC BASIN', 'ELEVATED TORUS HOOPS', 'CONTINUOUS ARENA'],
  },
  {
    id: 'caption_02',
    file: 'caption_02.png',
    kind: 'card',
    startSec: 5.60,
    endSec: 10.60,
    fadeInSec: 0.35,
    fadeOutSec: 0.35,
    pillPrefix: 'STRIKING & MOVEMENT // 02',
    pillSuffix: 'ATHLETIC PHYSICS',
    headline: 'ACTIVE RAGDOLL ATHLETICISM',
    body: 'Every limb in Valleyball is live physics. Use kicks, volleys, jumps, spikes, and desperate layout diving saves to combat the ball into the goal.',
    chips: ['ATHLETIC CUTS & DIVES', 'AIRBORNE SPIKES', 'SWEET-SPOT TIMING'],
  },
  {
    id: 'caption_03',
    file: 'caption_03.png',
    kind: 'card',
    startSec: 11.10,
    endSec: 17.75,
    fadeInSec: 0.35,
    fadeOutSec: 0.35,
    pillPrefix: 'ARENA TOPOGRAPHY // 03',
    pillSuffix: 'STEEP SLOPES · ZERO STOPPAGE',
    headline: 'NO OUT OF BOUNDS. NO WHISTLES.',
    body: 'Continuous perimeter glass keeps the ball live for five minutes of regulation. Carve the channels and launch off ramps to attack the hoop.',
    chips: ['PERFECT BOUNDARIES', 'ZERO STOPPAGE', '5-MINUTE REGULATION'],
  },
  {
    id: 'caption_04',
    file: 'caption_04.png',
    kind: 'card',
    startSec: 18.30,
    endSec: 24.95,
    fadeInSec: 0.35,
    fadeOutSec: 0.35,
    pillPrefix: 'BALL WEIGHT CLASSES // 04',
    pillSuffix: 'THREE BALLS',
    headline: 'THREE BALL WEIGHTS. ONE GRAVITY ARENA.',
    body: 'Small Football for aerial speed. Medium Valleyball for balanced play. Big Ball for heavy hits and an easy target.',
    chips: ['LIGHT: FAST (PRO)', 'MEDIUM: BALANCED', 'HEAVY: MOMENTUM BRAWL'],
  },
  {
    id: 'caption_05',
    file: 'caption_05.png',
    kind: 'card',
    startSec: 25.50,
    endSec: 35.65,
    fadeInSec: 0.35,
    fadeOutSec: 0.35,
    pillPrefix: 'THE SCORING LOOP // 05',
    pillSuffix: 'INSTANT TRANSITION',
    headline: 'SCORE A GOAL. FLIP THE COURT.',
    body: 'Drive the ball through the elevated hoop to score. Every goal immediately flips the active target to the opposite end, igniting an instant counter-attack.',
    chips: ['ELEVATED HOOP', 'ZERO RESET', 'END-TO-END TRANSITION'],
  },
  {
    id: 'caption_06',
    file: 'caption_06.png',
    kind: 'card',
    startSec: 36.30,
    endSec: 43.60,
    fadeInSec: 0.35,
    fadeOutSec: 0.35,
    pillPrefix: 'TACTICAL DISCIPLINE // 06',
    pillSuffix: '1V1 & 2V2 VERSUS',
    headline: 'HOLD GOAL-SIDE. COMMAND THE VALLEY.',
    body: 'Plant and cut for court positioning. Seal the hoop on defense, or punish an overcommitted opponent with clean aerial strikes.',
    chips: ['TACTICAL POSITIONING', 'PHYSICAL DEFENSE', 'MULTI-STAGE ATTACKS'],
  },
];

/**
 * Phases 2-4 Beat-Synced Impact Words (44.20s - 78.00s)
 * Styled strictly per VB-SPEC Amendment A (State A: Hollow Monoline over live gameplay):
 * - Syncopate 700, +0.18em tracking, Chalk White stroke over translucent glyph core
 * - Anchored by the 8-Stop Spectral Seam bar
 */
export const TRAILER_IMPACT_WORDS = [
  {
    id: 'impact_01',
    file: 'impact_01.png',
    kind: 'impact',
    startSec: 44.20,
    endSec: 45.10,
    fadeInSec: 0.05,
    fadeOutSec: 0.22,
    word: 'PLAY!',
  },
  {
    id: 'impact_02',
    file: 'impact_02.png',
    kind: 'impact',
    startSec: 46.00,
    endSec: 46.90,
    fadeInSec: 0.05,
    fadeOutSec: 0.22,
    word: 'DIVE!',
  },
  {
    id: 'impact_03',
    file: 'impact_03.png',
    kind: 'impact',
    startSec: 47.80,
    endSec: 48.70,
    fadeInSec: 0.05,
    fadeOutSec: 0.22,
    word: 'SPIKE!',
  },
  {
    id: 'impact_04',
    file: 'impact_04.png',
    kind: 'impact',
    startSec: 51.40,
    endSec: 52.30,
    fadeInSec: 0.05,
    fadeOutSec: 0.22,
    word: 'SCORE!',
  },
  {
    id: 'impact_05',
    file: 'impact_05.png',
    kind: 'impact',
    startSec: 55.00,
    endSec: 55.90,
    fadeInSec: 0.05,
    fadeOutSec: 0.22,
    word: 'DEFEND!',
  },
  {
    id: 'impact_06',
    file: 'impact_06.png',
    kind: 'impact',
    startSec: 62.20,
    endSec: 63.10,
    fadeInSec: 0.05,
    fadeOutSec: 0.22,
    word: "DON'T STOP!",
  },
  {
    id: 'impact_07',
    file: 'impact_07.png',
    kind: 'impact',
    startSec: 76.60,
    endSec: 78.00,
    fadeInSec: 0.05,
    fadeOutSec: 0.30,
    word: 'WIN!',
  },
];

export const ALL_TRAILER_OVERLAYS = [...TRAILER_CAPTIONS, ...TRAILER_IMPACT_WORDS];

function buildCaptionCardHtml(card) {
  const chipsHtml = card.chips
    .map((c) => `<span class="chip">${c}</span>`)
    .join('<span class="chip-sep">·</span>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700&family=Space+Grotesk:wght@400;500;600&family=Syncopate:wght@700&display=swap" rel="stylesheet">
  <style>
    :root {
      --void: #030308;
      --obsidian: #0A0A0C;
      --surface-border: rgba(255, 255, 255, 0.12);
      --chalk: #F5F5F7;
      --text-sub: #C8C8D4;
      --text-muted: #8E8E9E;
      --spec-cyan: #00E5FF;
      --spectral-linear: linear-gradient(
        90deg,
        #FF2A42 0%,
        #FF6B00 14.3%,
        #FFD000 28.6%,
        #10E56A 42.9%,
        #00E5FF 57.2%,
        #1F65FF 71.5%,
        #6B11FF 85.8%,
        #E000B8 100%
      );
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      background: transparent;
      -webkit-font-smoothing: antialiased;
    }

    .brand-card {
      position: absolute;
      left: 76px;
      bottom: 58px;
      width: 980px;
      background: rgba(10, 10, 14, 0.80);
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      box-shadow: 0 18px 48px rgba(3, 3, 8, 0.62);
      overflow: hidden;
    }

    /* Minimalist 2.5px 8-stop spectral seam along bottom edge */
    .spectral-seam {
      height: 2.5px;
      width: 100%;
      background: var(--spectral-linear);
    }

    .card-body-wrap {
      padding: 20px 28px 18px 28px;
      display: flex;
      flex-direction: column;
      gap: 9px;
    }

    /* Top Eyebrow Pill Row */
    .eyebrow-row {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11.5px;
      font-weight: 600;
      letter-spacing: 0.20em;
      text-transform: uppercase;
    }

    .spectral-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--spectral-linear);
      flex: 0 0 auto;
    }

    .pill-prefix {
      color: var(--spec-cyan);
    }

    .pill-dot {
      color: rgba(255, 255, 255, 0.28);
    }

    .pill-suffix {
      color: var(--text-muted);
    }

    /* Syncopate 700 Headline */
    .headline {
      font-family: 'Syncopate', sans-serif;
      font-size: 25px;
      font-weight: 700;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      color: var(--chalk);
      line-height: 1.18;
      margin-top: 1px;
    }

    /* Space Grotesk Editorial Body */
    .prose {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 18px;
      font-weight: 400;
      line-height: 1.44;
      color: var(--text-sub);
      letter-spacing: 0.01em;
    }

    /* Hairline Divider + Minimalist Spec Chips */
    .chips-bar {
      margin-top: 4px;
      padding-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--chalk);
      opacity: 0.92;
    }

    .chip-sep {
      color: rgba(255, 255, 255, 0.28);
    }
  </style>
</head>
<body>
  <div class="brand-card">
    <div class="card-body-wrap">
      <div class="eyebrow-row">
        <span class="spectral-dot"></span>
        <span class="pill-prefix">${card.pillPrefix}</span>
        <span class="pill-dot">·</span>
        <span class="pill-suffix">${card.pillSuffix}</span>
      </div>
      <div class="headline">${card.headline}</div>
      <div class="prose">${card.body}</div>
      <div class="chips-bar">${chipsHtml}</div>
    </div>
    <div class="spectral-seam"></div>
  </div>
</body>
</html>`;
}

function buildImpactWordHtml(item) {
  const isLong = item.word.length > 7;
  const fontSize = isLong ? 76 : 92;
  const seamWidth = isLong ? 460 : 280;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Syncopate:wght@700&display=swap" rel="stylesheet">
  <style>
    :root {
      --spectral-linear: linear-gradient(
        90deg,
        #FF2A42 0%,
        #FF6B00 14.3%,
        #FFD000 28.6%,
        #10E56A 42.9%,
        #00E5FF 57.2%,
        #1F65FF 71.5%,
        #6B11FF 85.8%,
        #E000B8 100%
      );
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      background: transparent;
      -webkit-font-smoothing: antialiased;
    }

    .impact-lockup {
      position: absolute;
      left: 50%;
      bottom: 72px;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 16px 40px 20px 40px;
      background: radial-gradient(ellipse at center, rgba(3, 3, 8, 0.58) 0%, rgba(3, 3, 8, 0.0) 74%);
    }

    /* VB-SPEC Amd. A — Hollow Monoline Syncopate 700 (+0.18em) over live gameplay */
    .impact-word {
      font-family: 'Syncopate', sans-serif;
      font-size: ${fontSize}px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-indent: 0.18em;
      text-transform: uppercase;
      color: rgba(245, 245, 247, 0.16);
      -webkit-text-stroke: 2.5px #F5F5F7;
      text-shadow:
        0 6px 24px rgba(3, 3, 8, 0.92),
        0 0 28px rgba(255, 255, 255, 0.35),
        0 0 56px rgba(0, 229, 255, 0.30);
      line-height: 1.02;
      white-space: nowrap;
    }

    .impact-seam {
      margin-top: 14px;
      width: ${seamWidth}px;
      height: 3.5px;
      border-radius: 2px;
      background: var(--spectral-linear);
      box-shadow:
        0 4px 16px rgba(3, 3, 8, 0.85),
        0 0 18px rgba(0, 229, 255, 0.55);
    }
  </style>
</head>
<body>
  <div class="impact-lockup">
    <div class="impact-word">${item.word}</div>
    <div class="impact-seam"></div>
  </div>
</body>
</html>`;
}

export async function generateTrailerCaptions() {
  console.log('[captions] Generating Minimalist Brand-Guide Overlays (6 Phase-1 Cards + 7 Impact Words)...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  for (const item of ALL_TRAILER_OVERLAYS) {
    const outPath = path.join(OUT_DIR, item.file);
    const html = item.kind === 'impact' ? buildImpactWordHtml(item) : buildCaptionCardHtml(item);
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
    await page.screenshot({ path: outPath, type: 'png', omitBackground: true });
    const label = item.kind === 'impact' ? item.word : item.headline;
    console.log(`[captions] Saved ${item.file} (${item.startSec.toFixed(2)}s - ${item.endSec.toFixed(2)}s): "${label}"`);
  }

  await browser.close();
  console.log(`[captions] All ${ALL_TRAILER_OVERLAYS.length} Brand-Guide overlays generated.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateTrailerCaptions().catch((err) => {
    console.error('[captions] Failed to generate captions:', err);
    process.exit(1);
  });
}
