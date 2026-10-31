import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'captures', 'trailer');
fs.mkdirSync(OUT_DIR, { recursive: true });

const LOGO_PATH = path.join(ROOT, 'public', 'textures', 'brand_logo_mark.png');
const OVERLAY_FILE = path.join(OUT_DIR, 'tiktok_frame_overlay.png');
const TITLE_CARD_FILE = path.join(OUT_DIR, 'title_card_vertical_9x16.png');

async function generateTikTokGraphics() {
  console.log('[tiktok_gfx] Launching Chromium to generate 9:16 vertical graphics...');
  const logoBase64 = fs.existsSync(LOGO_PATH)
    ? `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`
    : '';

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
  });

  // 1. GENERATE TIKTOK FRAME OVERLAY (1080x1920 PNG with transparent center)
  const overlayHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Space+Grotesk:wght@500;700&family=Syncopate:wght@700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1080px;
      height: 1920px;
      overflow: hidden;
      background: transparent;
      color: #F5F5F7;
      position: relative;
      font-family: 'Space Grotesk', sans-serif;
    }

    /* TOP ZONE: y = 0 to 656 */
    .top-zone {
      position: absolute;
      top: 0;
      left: 0;
      width: 1080px;
      height: 656px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      padding-bottom: 32px;
      padding-left: 48px;
      padding-right: 48px;
    }

    .top-badge-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 18px;
      border-radius: 9999px;
      background: rgba(10, 10, 12, 0.75);
      border: 1px solid rgba(0, 229, 255, 0.35);
      box-shadow: 0 0 20px rgba(0, 229, 255, 0.2);
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.18em;
      color: #00E5FF;
      text-transform: uppercase;
      margin-bottom: 18px;
    }

    .pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #00E5FF;
      box-shadow: 0 0 8px #00E5FF;
    }

    .brand-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      margin-bottom: 12px;
    }

    .logo-img {
      width: 64px;
      height: 64px;
      object-fit: contain;
      filter: drop-shadow(0 0 16px rgba(0, 229, 255, 0.5));
    }

    .wordmark {
      font-family: 'Syncopate', sans-serif;
      font-size: 38px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #F5F5F7;
      text-shadow: 0 0 24px rgba(0, 229, 255, 0.5);
      line-height: 1;
    }

    .spectral-seam {
      width: 320px;
      height: 3px;
      border-radius: 2px;
      background: linear-gradient(90deg,
        #FF2A42 0%, #FF6B00 14.3%, #FFD000 28.6%,
        #10E56A 42.9%, #00E5FF 57.2%, #1F65FF 71.5%,
        #6B11FF 85.8%, #E000B8 100%);
      box-shadow: 0 0 12px rgba(0, 229, 255, 0.6);
      margin-top: 10px;
      margin-bottom: 16px;
    }

    .hook-tagline {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 19px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(245, 245, 247, 0.9);
      text-shadow: 0 2px 10px rgba(0,0,0,0.8);
      text-align: center;
    }

    /* CENTER VIEWPORT FRAME: y = 656 to 1264 */
    .viewport-frame {
      position: absolute;
      top: 656px;
      left: 0;
      width: 1080px;
      height: 608px;
      box-sizing: border-box;
      border-top: 1.5px solid rgba(255, 255, 255, 0.25);
      border-bottom: 1.5px solid rgba(255, 255, 255, 0.25);
      box-shadow:
        inset 0 1px 0 rgba(0, 229, 255, 0.3),
        inset 0 -1px 0 rgba(0, 229, 255, 0.3),
        0 0 30px rgba(0, 0, 0, 0.6);
      pointer-events: none;
    }

    /* HUD Corner Brackets */
    .corner-tl, .corner-tr, .corner-bl, .corner-br {
      position: absolute;
      width: 16px;
      height: 16px;
      border-color: #00E5FF;
      border-style: solid;
    }
    .corner-tl { top: -2px; left: 16px; border-width: 2px 0 0 2px; }
    .corner-tr { top: -2px; right: 16px; border-width: 2px 2px 0 0; }
    .corner-bl { bottom: -2px; left: 16px; border-width: 0 0 2px 2px; }
    .corner-br { bottom: -2px; right: 16px; border-width: 0 2px 2px 0; }

    /* HUD Metadata pills along the frame edge */
    .hud-meta-left {
      position: absolute;
      top: -12px;
      left: 48px;
      background: #0A0A0C;
      padding: 2px 12px;
      border-radius: 4px;
      border: 1px solid rgba(255,255,255,0.18);
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.15em;
      color: #F8FAFC;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .rec-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #FF2A42;
      box-shadow: 0 0 6px #FF2A42;
    }

    .hud-meta-right {
      position: absolute;
      top: -12px;
      right: 48px;
      background: #0A0A0C;
      padding: 2px 12px;
      border-radius: 4px;
      border: 1px solid rgba(255,255,255,0.18);
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.15em;
      color: #00E5FF;
    }

    /* BOTTOM ZONE: y = 1264 to 1920 */
    .bottom-zone {
      position: absolute;
      top: 1264px;
      left: 0;
      width: 1080px;
      height: 656px;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 36px;
      padding-left: 48px;
      padding-right: 120px; /* Leave right rail clear for TikTok action buttons */
      box-sizing: border-box;
    }

    .chips-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
      margin-bottom: 22px;
    }

    .feature-chip {
      padding: 8px 18px;
      border-radius: 8px;
      background: rgba(10, 10, 12, 0.82);
      border: 1px solid rgba(255, 255, 255, 0.14);
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.14em;
      color: #F8FAFC;
      text-transform: uppercase;
      box-shadow: 0 4px 14px rgba(0,0,0,0.5);
    }

    .cta-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: 82%;
      max-width: 580px;
      padding: 16px 28px;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(31, 101, 255, 0.35) 0%, rgba(0, 229, 255, 0.25) 100%);
      border: 1.5px solid rgba(0, 229, 255, 0.6);
      box-shadow: 0 0 28px rgba(0, 229, 255, 0.3);
      font-family: 'Space Grotesk', sans-serif;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #FFFFFF;
      text-shadow: 0 0 12px rgba(0, 229, 255, 0.8);
      margin-bottom: 20px;
    }

    .music-credit {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.16em;
      color: rgba(248, 250, 252, 0.7);
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <!-- TOP OVERLAY -->
  <div class="top-zone">
    <div class="top-badge-pill">
      <span class="pulse-dot"></span>
      <span>OFFICIAL GAMEPLAY TRAILER</span>
    </div>
    <div class="brand-row">
      ${logoBase64 ? `<img class="logo-img" src="${logoBase64}" alt="Logo" />` : ''}
      <h1 class="wordmark">VALLEYBALL</h1>
    </div>
    <div class="spectral-seam"></div>
    <div class="hook-tagline">ACTIVE RAGDOLLS • NO OUT OF BOUNDS</div>
  </div>

  <!-- CENTER FRAME BORDER -->
  <div class="viewport-frame">
    <div class="corner-tl"></div>
    <div class="corner-tr"></div>
    <div class="corner-bl"></div>
    <div class="corner-br"></div>
    <div class="hud-meta-left">
      <span class="rec-dot"></span>
      <span>60 FPS CFR</span>
    </div>
    <div class="hud-meta-right">
      <span>133.3 BPM</span>
    </div>
  </div>

  <!-- BOTTOM OVERLAY -->
  <div class="bottom-zone">
    <div class="chips-row">
      <div class="feature-chip">PARABOLIC BASIN</div>
      <div class="feature-chip">ELEVATED TORUS</div>
      <div class="feature-chip">3 BALL WEIGHTS</div>
    </div>
    <div class="cta-button">
      <span>WISHLIST ON STEAM</span>
    </div>
    <div class="music-credit">
      <span>♫ NEON VELOCITY — OFFICIAL SOUNDTRACK</span>
    </div>
  </div>
</body>
</html>`;

  await page.setContent(overlayHtml, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.screenshot({ path: OVERLAY_FILE, type: 'png', omitBackground: true });
  console.log(`[tiktok_gfx] ✓ Generated Frame Overlay: ${OVERLAY_FILE}`);

  // 2. GENERATE FULLSCREEN 9:16 VERTICAL TITLE CARD (1080x1920)
  const titleCardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Space+Grotesk:wght@500;700&family=Syncopate:wght@700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1080px;
      height: 1920px;
      overflow: hidden;
      background-color: #030308;
      color: #F5F5F7;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .galaxy-bg {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 50% 40%, rgba(31, 101, 255, 0.16) 0%, transparent 60%),
        radial-gradient(circle at 85% 15%, rgba(224, 0, 184, 0.12) 0%, transparent 50%),
        radial-gradient(circle at 15% 85%, rgba(0, 229, 255, 0.10) 0%, transparent 50%),
        radial-gradient(circle at 50% 50%, #0A0A0C 0%, #030308 100%);
      z-index: 1;
    }

    .starfield {
      position: absolute;
      inset: 0;
      background-image:
        radial-gradient(1.5px 1.5px at 180px 240px, #ffffff, transparent),
        radial-gradient(1.5px 1.5px at 360px 480px, rgba(255,255,255,0.7), transparent),
        radial-gradient(2px 2px at 720px 200px, #ffffff, transparent),
        radial-gradient(1.5px 1.5px at 920px 420px, rgba(255,255,255,0.8), transparent),
        radial-gradient(2px 2px at 240px 1100px, #ffffff, transparent),
        radial-gradient(1.5px 1.5px at 840px 1250px, rgba(255,255,255,0.7), transparent),
        radial-gradient(2px 2px at 480px 1580px, #ffffff, transparent),
        radial-gradient(1.5px 1.5px at 900px 1650px, rgba(255,255,255,0.6), transparent);
      opacity: 0.9;
      z-index: 2;
    }

    .card-content {
      position: relative;
      z-index: 3;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 0 40px;
    }

    .logo-container {
      width: 280px;
      height: 280px;
      margin-bottom: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      filter: drop-shadow(0 0 60px rgba(0, 229, 255, 0.55));
    }
    .logo-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .wordmark {
      font-family: 'Syncopate', sans-serif;
      font-size: 58px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #F5F5F7;
      text-shadow:
        0 0 35px rgba(0, 229, 255, 0.65),
        0 0 70px rgba(31, 101, 255, 0.4);
      line-height: 1.15;
    }

    .spectral-seam {
      width: 480px;
      height: 4px;
      margin-top: 36px;
      margin-bottom: 36px;
      border-radius: 2px;
      background: linear-gradient(90deg,
        #FF2A42 0%, #FF6B00 14.3%, #FFD000 28.6%,
        #10E56A 42.9%, #00E5FF 57.2%, #1F65FF 71.5%,
        #6B11FF 85.8%, #E000B8 100%);
      box-shadow: 0 0 20px rgba(0, 229, 255, 0.7);
    }

    .subtitle-primary {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 32px;
      font-weight: 700;
      letter-spacing: 0.14em;
      color: #00E5FF;
      text-transform: uppercase;
      text-shadow: 0 0 24px rgba(0, 229, 255, 0.7);
      margin-bottom: 18px;
    }

    .subtitle-secondary {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 22px;
      font-weight: 500;
      letter-spacing: 0.20em;
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
      ${logoBase64 ? `<img class="logo-img" src="${logoBase64}" alt="Logo Mark" />` : ''}
    </div>
    <div class="wordmark">VALLEYBALL<br>VERSUS</div>
    <div class="spectral-seam"></div>
    <div class="subtitle-primary">PLAY FREE NOW!<br>VALLEYBALLVS.COM</div>
    <div class="subtitle-secondary">INAUGURAL CHAMPIONSHIP<br>DECEMBER 27, 2026</div>
  </div>
</body>
</html>`;

  await page.setContent(titleCardHtml, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.screenshot({ path: TITLE_CARD_FILE, type: 'png' });
  console.log(`[tiktok_gfx] ✓ Generated Vertical Title Card: ${TITLE_CARD_FILE}`);

  await browser.close();
}

generateTikTokGraphics().catch(err => {
  console.error('[tiktok_gfx] Error:', err);
  process.exit(1);
});
