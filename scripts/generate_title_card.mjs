import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'captures', 'trailer');
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT_FILE = path.join(OUT_DIR, 'title_card_galaxy.png');
const LOGO_PATH = path.join(ROOT, 'public', 'textures', 'brand_logo_mark.png');

async function generateTitleCard() {
  console.log('[title_card] Generating Brand Dictionary Galaxy Title Card (1920x1080)...');

  const logoBase64 = fs.existsSync(LOGO_PATH)
    ? `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Space+Grotesk:wght@500;700&family=Syncopate:wght@700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      background-color: #030308;
      color: #F5F5F7;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    /* Cosmic Galaxy & Radial Gradient Backdrop */
    .galaxy-bg {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 50% 45%, rgba(31, 101, 255, 0.12) 0%, transparent 55%),
        radial-gradient(circle at 82% 18%, rgba(224, 0, 184, 0.08) 0%, transparent 45%),
        radial-gradient(circle at 18% 82%, rgba(0, 229, 255, 0.07) 0%, transparent 45%),
        radial-gradient(circle at 50% 50%, #0A0A0C 0%, #030308 100%);
      z-index: 1;
    }

    /* Subtle Cosmic Starfield */
    .starfield {
      position: absolute;
      inset: 0;
      background-image:
        radial-gradient(1.5px 1.5px at 240px 180px, #ffffff, transparent),
        radial-gradient(1.5px 1.5px at 480px 320px, rgba(255,255,255,0.7), transparent),
        radial-gradient(2px 2px at 960px 120px, #ffffff, transparent),
        radial-gradient(1.5px 1.5px at 1440px 240px, rgba(255,255,255,0.8), transparent),
        radial-gradient(2px 2px at 1680px 420px, #ffffff, transparent),
        radial-gradient(1px 1px at 300px 720px, rgba(255,255,255,0.6), transparent),
        radial-gradient(2px 2px at 780px 880px, #ffffff, transparent),
        radial-gradient(1.5px 1.5px at 1200px 810px, rgba(255,255,255,0.7), transparent),
        radial-gradient(2px 2px at 1620px 920px, #ffffff, transparent),
        radial-gradient(1.5px 1.5px at 960px 960px, rgba(255,255,255,0.6), transparent);
      opacity: 0.85;
      z-index: 2;
    }

    .card-content {
      position: relative;
      z-index: 3;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      transform: translateY(-8px);
    }

    /* Official Brand Logo Mark */
    .logo-container {
      width: 220px;
      height: 220px;
      margin-bottom: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      filter: drop-shadow(0 0 45px rgba(0, 229, 255, 0.45));
    }
    .logo-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    /* Wordmark: VALLEYBALL VERSUS in Syncopate 700 */
    .wordmark {
      font-family: 'Syncopate', sans-serif;
      font-size: 82px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #F5F5F7;
      text-shadow:
        0 0 30px rgba(0, 229, 255, 0.6),
        0 0 60px rgba(31, 101, 255, 0.35);
      line-height: 1.05;
      margin-left: 0.18em;
    }

    /* 8-Stop Spectral Linear Accent Bar */
    .spectral-seam {
      width: 440px;
      height: 4px;
      margin-top: 26px;
      margin-bottom: 26px;
      border-radius: 2px;
      background: linear-gradient(90deg,
        #FF2A42 0%, #FF6B00 14.3%, #FFD000 28.6%,
        #10E56A 42.9%, #00E5FF 57.2%, #1F65FF 71.5%,
        #6B11FF 85.8%, #E000B8 100%);
      box-shadow: 0 0 16px rgba(0, 229, 255, 0.6);
    }

    /* Subtitle 1: PLAY FREE NOW! VALLEYBALLVS.COM */
    .subtitle-primary {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 32px;
      font-weight: 700;
      letter-spacing: 0.14em;
      color: #00E5FF;
      text-transform: uppercase;
      text-shadow: 0 0 24px rgba(0, 229, 255, 0.7);
      margin-bottom: 14px;
    }

    /* Subtitle 2: INAUGURAL CHAMPIONSHIP DECEMBER 27, 2026 */
    .subtitle-secondary {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 21px;
      font-weight: 500;
      letter-spacing: 0.22em;
      color: #C0C0CF;
      text-transform: uppercase;
      opacity: 0.95;
    }
  </style>
</head>
<body>
  <div class="galaxy-bg"></div>
  <div class="starfield"></div>
  <div class="card-content">
    <div class="logo-container">
      <img class="logo-img" src="${logoBase64}" alt="Valleyball Logo Mark" />
    </div>
    <div class="wordmark">VALLEYBALL VERSUS</div>
    <div class="spectral-seam"></div>
    <div class="subtitle-primary">PLAY FREE NOW! &nbsp;VALLEYBALLVS.COM</div>
    <div class="subtitle-secondary">INAUGURAL CHAMPIONSHIP DECEMBER 27, 2026</div>
  </div>
</body>
</html>`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);

  await page.screenshot({ path: OUT_FILE, type: 'png' });
  await browser.close();

  console.log(`[title_card] Saved Title Card: ${OUT_FILE} (${fs.statSync(OUT_FILE).size} bytes)`);
}

generateTitleCard().catch(err => {
  console.error('[title_card] Error:', err);
  process.exit(1);
});
