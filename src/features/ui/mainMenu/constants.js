import { SERIES_1_PLAYTEST_CYCLE } from '../../../config/cosmetics.js';

export const PALETTE_SWATCHES = [
  { name: 'Red', color: '#d90429', hex: 0xd90429 },
  { name: 'Blue', color: '#1d4ed8', hex: 0x1d4ed8 },
  { name: 'Yellow', color: '#ffd60a', hex: 0xffd60a },
  { name: 'Green', color: '#15803d', hex: 0x15803d },
  { name: 'Purple', color: '#8b5cf6', hex: 0x8b5cf6 },
  { name: 'Orange', color: '#ea580c', hex: 0xea580c },
  { name: 'Teal', color: '#06b6d4', hex: 0x06b6d4 },
  { name: 'Pink', color: '#ec4899', hex: 0xec4899 },
  { name: 'White', color: '#f8fafc', hex: 0xf8fafc },
  { name: 'Black', color: '#0f172a', hex: 0x0f172a },
];

export function getColorName(color) {
  if (color === null || color === undefined) return 'Custom';
  let hexNum = color;
  if (typeof color === 'string') {
    hexNum = parseInt(color.replace('#', ''), 16);
  }
  const match = PALETTE_SWATCHES.find((s) => s.hex === hexNum);
  if (match) return match.name;
  return 'Custom';
}

export const PHYSIQUE_OPTIONS = ['classic', 'masculine', 'feminine'];

export const CAMERA_OPTIONS = [
  { id: 'chase', label: 'CHASE CAM', fullLabel: '3RD PERSON CHASE (DEFAULT)' },
  { id: 'thirdPerson', label: 'BALL TRACK', fullLabel: '3RD PERSON (BALL TRACK)' },
  { id: 'firstPerson', label: '1ST PERSON', fullLabel: '1ST PERSON (EYE-LEVEL)' },
  { id: 'tactical', label: 'TACTICAL', fullLabel: 'TACTICAL OVERHEAD' },
  { id: 'broadcast', label: 'BROADCAST [SHARED]', fullLabel: 'SIDELINE BROADCAST [FULLSCREEN]' },
];

export const MATCH_BALL_OPTIONS = [
  { id: 'random', label: 'RANDOM', desc: 'Random each match' },
  { id: 'small', label: 'FOOTBALL (SMALL)', desc: '0.4m · Hard Difficulty' },
  { id: 'medium', label: 'MEDIUM BALL', desc: '1.0m · Average Difficulty [Default]' },
  { id: 'large', label: 'BIG BALL', desc: '1.5m · Easiest Difficulty' },
];

export const MATCH_DURATION_OPTIONS = [
  { id: 180, label: '3 MIN', desc: 'Fast arcade match' },
  { id: 300, label: '5 MIN (DEFAULT)', desc: 'Standard tournament match' },
  { id: 600, label: '10 MIN', desc: 'Extended championship' },
];

export const ARENA_OPTIONS = [
  { id: 'court', label: 'VALLEY ARENA [DEFAULT]', desc: '50x120m valley basin with stream-heads & goal hoops' },
];

export const PRACTICE_BALL_OPTIONS = [
  { id: 'all', label: 'ALL 3 BALLS [SANDBOX]', desc: 'Small, Medium & Big active simultaneously' },
  { id: 'medium', label: 'REGULATION (MEDIUM)', desc: '1.0m · Standard match ball drills' },
  { id: 'small', label: 'FOOTBALL (SMALL)', desc: '0.4m · Precision strike training' },
  { id: 'large', label: 'BIG BALL (TRAINING)', desc: '1.5m · Rebound & volley practice' },
];

export const PRACTICE_DRILL_OPTIONS = [
  { id: 'sandbox', label: 'FREE SANDBOX', desc: 'Open court · Press Key B / Select to self-toss ball' },
  { id: 'newcomer_drill', label: 'NEWCOMER CHECKLIST', desc: '4-step basics (Volley, Spike, Dive, Goal) · Untimed' },
  { id: 'ball_feeder', label: 'BALL FEEDER', desc: 'Auto-lobs a fresh midfield ball every 4.5s' },
  { id: 'sparring_bot', label: 'SPARRING BOT', desc: '1v1 warm-up rally vs Medium Balanced AI' },
  { id: 'local_warmup', label: 'LOCAL WARMUP (2P-4P)', desc: 'All connected controllers active on practice court' },
];

export const BALL_OPTIONS = MATCH_BALL_OPTIONS;

export const HEADWEAR_OPTIONS = Object.freeze(SERIES_1_PLAYTEST_CYCLE.map((e) => Object.freeze({ id: e.id, label: e.label })));

export const ASSIST_OPTIONS = [
  { id: 'standard', label: 'STANDARD', desc: 'Balanced · 0.45m hit forgiveness' },
  { id: 'pureSim', label: 'PURE SIM', desc: 'True physics · 0% forgiveness' },
  { id: 'casual', label: 'CASUAL', desc: '0.65m reach · Wide hit timing window' },
];

export function toHexCss(color, fallback = '#d90429') {
  if (typeof color === 'number' && Number.isFinite(color)) {
    return '#' + (color & 0xffffff).toString(16).padStart(6, '0');
  }
  if (typeof color === 'string') {
    const clean = color.trim().replace('#', '');
    if (/^[0-9a-fA-F]{3}$/.test(clean)) {
      return '#' + clean.replace(/(.)/g, '$1$1').toLowerCase();
    }
    if (/^[0-9a-fA-F]{6}$/.test(clean)) {
      return '#' + clean.toLowerCase();
    }
  }
  return fallback;
}

function parseHexRgb(color) {
  const hex = toHexCss(color, '#ffffff').slice(1);
  const num = parseInt(hex, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb) {
  return 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
}

function linearRgbToLab([r, g, b]) {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / 1.00000;
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function readableOnDark(hex, bgHex = '#0f172a', minRatio = 4.5) {
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

export function checkSwatchContrast(homeHex, awayHex) {
  const ra = parseHexRgb(homeHex);
  const rb = parseHexRgb(awayHex);
  const lumA = relativeLuminance(ra);
  const lumB = relativeLuminance(rb);
  const ratio = Number(((Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05)).toFixed(2));
  if (ra[0] === rb[0] && ra[1] === rb[1] && ra[2] === rb[2]) {
    return { ok: false, ratio, reason: 'Both teams use the same kit color' };
  }
  if (lumA < 0.12 && lumB < 0.12 && ratio < 1.5) {
    return { ok: false, ratio, reason: 'Both kit colors are very dark and may blend in shadow' };
  }
  if (lumA > 0.65 && lumB > 0.65 && ratio < 1.5) {
    return { ok: false, ratio, reason: 'Both kit colors are bright and may blend on court' };
  }
  const la = [srgbToLinear(ra[0]), srgbToLinear(ra[1]), srgbToLinear(ra[2])];
  const lb = [srgbToLinear(rb[0]), srgbToLinear(rb[1]), srgbToLinear(rb[2])];
  if (deltaE(linearRgbToLab(la), linearRgbToLab(lb)) < 30) {
    return { ok: false, ratio, reason: 'Kit colors are too close in hue and brightness' };
  }
  const simP = ([r, g, b]) => [
    0.152286 * r + 1.052583 * g - 0.204868 * b,
    0.114503 * r + 0.786281 * g + 0.099216 * b,
    -0.003882 * r - 0.048116 * g + 1.051998 * b,
  ];
  const simD = ([r, g, b]) => [
    0.367322 * r + 0.860646 * g - 0.227968 * b,
    0.280085 * r + 0.672501 * g + 0.047413 * b,
    -0.011820 * r + 0.042940 * g + 0.968881 * b,
  ];
  const simT = ([r, g, b]) => [
    1.255528 * r - 0.076749 * g - 0.178779 * b,
    -0.078411 * r + 0.930809 * g + 0.147602 * b,
    0.004733 * r + 0.691367 * g + 0.303900 * b,
  ];
  if (Math.min(deltaE(linearRgbToLab(simP(la)), linearRgbToLab(simP(lb))), deltaE(linearRgbToLab(simD(la)), linearRgbToLab(simD(lb)))) < 28) {
    return { ok: false, ratio, reason: 'Low red-green colorblind contrast between Home and Away kits' };
  }
  if (deltaE(linearRgbToLab(simT(la)), linearRgbToLab(simT(lb))) < 28) {
    return { ok: false, ratio, reason: 'Low blue-yellow colorblind contrast between Home and Away kits' };
  }
  return { ok: true, ratio, reason: '' };
}

function buildKitTheme(slotIdx, kitColorHex) {
  const hex = readableOnDark(kitColorHex, '#0f172a');
  const rgb = parseHexRgb(hex);
  const rgba = (a) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
  const slotNum = slotIdx + 1;
  return Object.freeze({
    slot: slotIdx,
    label: `P${slotNum}`,
    short: `P${slotNum}`,
    teamTag: slotIdx % 2 === 0 ? 'T1' : 'T2',
    name: getColorName(kitColorHex),
    hex,
    bg: rgba(0.14),
    bgStrong: rgba(0.24),
    border: hex,
    glow: rgba(0.48),
    textOnFill: relativeLuminance(rgb) > 0.35 ? '#0f172a' : '#ffffff',
  });
}

/**
 * Signature visual identity per controller/player slot (P1..P4) aligned with team kit colors.
 * Defaults to Home Red (P1/P3) and Away Blue (P2/P4) while keeping P1..P4 slot tags distinct.
 */
export const PLAYER_SLOT_COLORS = Object.freeze([
  buildKitTheme(0, '#d90429'),
  buildKitTheme(1, '#1d4ed8'),
  buildKitTheme(2, '#d90429'),
  buildKitTheme(3, '#1d4ed8'),
]);

export function getPlayerSlotTheme(slotIdx = 0, kitColorHex = null) {
  const safeIdx = Number.isInteger(slotIdx) && slotIdx >= 0 && slotIdx < 4 ? slotIdx : 0;
  if (kitColorHex !== null && kitColorHex !== undefined) {
    return buildKitTheme(safeIdx, kitColorHex);
  }
  return PLAYER_SLOT_COLORS[safeIdx] || PLAYER_SLOT_COLORS[0];
}

/**
 * Detects controller brand and whether hardware is a Fighting Pad / Arcade Stick / Hitbox.
 */
export function detectGamepadProfile(pad) {
  const raw = pad?.id || '';
  const axesCount = Array.isArray(pad?.axes) ? pad.axes.length : 4;
  const isFightHardware = /fighting|arcade|hitbox|fightstick|hori|qanba|victrix|mayflash|mad\s*catz|kitsune|snack\s*box|m30|octa|leverless/i.test(raw) || axesCount < 2;

  if (isFightHardware) {
    return {
      brand: 'fightpad',
      cleanName: 'Fighting Pad',
      icon: '🕹️',
      isFightingPad: true,
      buttons: { south: '✕/A', east: '○/B', west: '□/X', north: '△/Y' },
    };
  }
  if (/dualsense|dualshock|054c|wireless controller|playstation|ps4|ps5|sony/i.test(raw)) {
    return {
      brand: 'playstation',
      cleanName: 'PlayStation',
      icon: '🎮',
      isFightingPad: false,
      buttons: { south: '✕', east: '○', west: '□', north: '△' },
    };
  }
  if (/xbox|xinput|045e|microsoft/i.test(raw)) {
    return {
      brand: 'xbox',
      cleanName: 'Xbox',
      icon: '🎮',
      isFightingPad: false,
      buttons: { south: 'A', east: 'B', west: 'X', north: 'Y' },
    };
  }
  if (/pro controller|joy-con|057e|nintendo|switch/i.test(raw)) {
    return {
      brand: 'switch',
      cleanName: 'Switch',
      icon: '🎮',
      isFightingPad: false,
      buttons: { south: 'B', east: 'A', west: 'Y', north: 'X' },
    };
  }
  return {
    brand: 'generic',
    cleanName: 'Gamepad',
    icon: '🎮',
    isFightingPad: false,
    buttons: { south: '✕/A', east: '○/B', west: '□/X', north: '△/Y' },
  };
}

const CARDINAL_META = {
  south: { label: 'South (✕ / A)', short: '✕ / A', color: '#4ade80' },
  east:  { label: 'East (○ / B)',  short: '○ / B', color: '#ff2e55' },
  west:  { label: 'West (□ / X)',  short: '□ / X', color: '#00e5ff' },
  north: { label: 'North (△ / Y)', short: '△ / Y', color: '#fbb417' },
};

/**
 * Renders an inline 4-diamond cardinal face-button SVG icon with the target direction lit up.
 * Supports both `renderCardinalDiamondSvg(dir, size)` and `renderCardinalDiamondSvg(dir, color, size)`.
 * @param {'north'|'south'|'east'|'west'} activeDir
 * @param {number|string} [sizeOrColor=15]
 * @param {number} [maybeSize=15]
 */
export function renderCardinalDiamondSvg(activeDir = 'south', sizeOrColor = 15, maybeSize = 15) {
  const meta = CARDINAL_META[activeDir] || CARDINAL_META.south;
  const isCustomColor = typeof sizeOrColor === 'string' && sizeOrColor.trim().length > 0 && Number.isNaN(Number(sizeOrColor));
  const activeColor = isCustomColor ? sizeOrColor : meta.color;
  const parsedSize = Number(isCustomColor ? maybeSize : sizeOrColor);
  const numSize = Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : 14;
  const fillFor = (dir) => (dir === activeDir ? activeColor : 'rgba(255,255,255,0.16)');
  const strokeFor = (dir) => (dir === activeDir ? '#ffffff' : 'rgba(255,255,255,0.42)');
  return `<svg aria-hidden="true" width="${numSize}" height="${numSize}" viewBox="0 0 20 20" style="width:${numSize}px;height:${numSize}px;min-width:${numSize}px;max-width:${numSize}px;min-height:${numSize}px;max-height:${numSize}px;display:inline-block;vertical-align:middle;flex-shrink:0;">
    <polygon points="10,1.5 12.8,4.3 10,7.1 7.2,4.3" fill="${fillFor('north')}" stroke="${strokeFor('north')}" stroke-width="1"/>
    <polygon points="10,12.9 12.8,15.7 10,18.5 7.2,15.7" fill="${fillFor('south')}" stroke="${strokeFor('south')}" stroke-width="1"/>
    <polygon points="4.3,7.2 7.1,10 4.3,12.8 1.5,10" fill="${fillFor('west')}" stroke="${strokeFor('west')}" stroke-width="1"/>
    <polygon points="15.7,7.2 18.5,10 15.7,12.8 12.9,10" fill="${fillFor('east')}" stroke="${strokeFor('east')}" stroke-width="1"/>
  </svg>`;
}

/**
 * Renders a cardinal face-button prompt with 4-diamond icon + universal dual label (e.g. `West (□/X)`).
 * @param {'north'|'south'|'east'|'west'} dir
 * @param {string} [actionText='']
 * @param {boolean} [compact=false]
 */
export function renderCardinalPromptHtml(dir, actionText = '', compact = false) {
  const meta = CARDINAL_META[dir] || CARDINAL_META.south;
  const btnText = compact ? meta.short : meta.label;
  const svg = renderCardinalDiamondSvg(dir, compact ? 13 : 15);
  const suffix = actionText ? `<span style="margin-left:4px;">· ${actionText}</span>` : '';
  return `<span style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle;"><span style="display:inline-flex;align-items:center;gap:3px;padding:1px 5px;border-radius:4px;background:rgba(255,255,255,0.1);border:1px solid ${meta.color};color:${meta.color};font-weight:900;font-size:0.92em;line-height:1.15;">${svg}<span>${btnText}</span></span>${suffix}</span>`;
}

/**
 * Computes which part of the screen a slot (`0..3`) will occupy during the match,
 * matching `ViewportManager.renderScene` in `src/features/camera/viewportManager.js`.
 *
 * @param {number} slotIdx 0..3
 * @param {number[]} humanSlots Array of human-controlled slot indices (e.g. `[0, 1]`)
 * @param {'match'|'practice'} [mode='match']
 */
export function getSlotViewportInfo(slotIdx, humanSlots = [], mode = 'match') {
  if (mode === 'practice') {
    return { mode: 'full', label: 'FULLSCREEN', detail: 'Solo Screen' };
  }
  const isHuman = humanSlots.includes(slotIdx);
  if (humanSlots.length === 0) {
    return { mode: 'spectator', label: 'SPECTATOR TV', detail: 'Shared Broadcast' };
  }
  if (!isHuman) {
    return { mode: 'ai', label: 'AI BOT (NO CAM)', detail: 'CPU Controlled' };
  }
  if (humanSlots.length === 1) {
    return { mode: 'full', label: 'FULLSCREEN', detail: '100% Display' };
  }
  if (humanSlots.length === 2) {
    const isLeft = humanSlots[0] === slotIdx;
    return isLeft
      ? { mode: 'left', label: 'LEFT SCREEN', detail: 'Left Half Split' }
      : { mode: 'right', label: 'RIGHT SCREEN', detail: 'Right Half Split' };
  }
  // 3 or 4 humans -> 2x2 Quad Splitscreen: P1=Top-Left, P2=Top-Right, P3=Bottom-Left, P4=Bottom-Right
  if (slotIdx === 0) return { mode: 'tl', label: 'TOP-LEFT SCREEN', detail: 'Top-Left Corner' };
  if (slotIdx === 1) return { mode: 'tr', label: 'TOP-RIGHT SCREEN', detail: 'Top-Right Corner' };
  if (slotIdx === 2) return { mode: 'bl', label: 'BOT-LEFT SCREEN', detail: 'Bottom-Left Corner' };
  return { mode: 'br', label: 'BOT-RIGHT SCREEN', detail: 'Bottom-Right Corner' };
}

/**
 * Renders a mini 16:9 screen diagram SVG + viewport label badge showing where the player's camera sits on screen.
 */
export function renderViewportBadgeHtml(slotIdx, humanSlots = [], mode = 'match', kitColorHex = null) {
  const info = getSlotViewportInfo(slotIdx, humanSlots, mode);
  const theme = getPlayerSlotTheme(slotIdx, kitColorHex);
  const activeFill = info.mode === 'ai' ? 'rgba(148,163,184,0.28)' : theme.hex;
  const borderCol = info.mode === 'ai' ? 'rgba(148,163,184,0.4)' : theme.hex;
  const textCol = info.mode === 'ai' ? '#94a3b8' : theme.hex;

  let highlightRect = '';
  if (info.mode === 'full' || info.mode === 'spectator') {
    highlightRect = `<rect x="2" y="2" width="16" height="10" rx="1" fill="${activeFill}" opacity="0.88"/>`;
  } else if (info.mode === 'left') {
    highlightRect = `<rect x="2" y="2" width="7.5" height="10" rx="0.8" fill="${activeFill}" opacity="0.92"/><line x1="10" y1="1.5" x2="10" y2="12.5" stroke="rgba(255,255,255,0.45)" stroke-width="1"/>`;
  } else if (info.mode === 'right') {
    highlightRect = `<rect x="10.5" y="2" width="7.5" height="10" rx="0.8" fill="${activeFill}" opacity="0.92"/><line x1="10" y1="1.5" x2="10" y2="12.5" stroke="rgba(255,255,255,0.45)" stroke-width="1"/>`;
  } else if (info.mode === 'tl') {
    highlightRect = `<rect x="2" y="2" width="7.5" height="4.6" rx="0.6" fill="${activeFill}" opacity="0.95"/><line x1="10" y1="1.5" x2="10" y2="12.5" stroke="rgba(255,255,255,0.38)" stroke-width="0.8"/><line x1="1.5" y1="7" x2="18.5" y2="7" stroke="rgba(255,255,255,0.38)" stroke-width="0.8"/>`;
  } else if (info.mode === 'tr') {
    highlightRect = `<rect x="10.5" y="2" width="7.5" height="4.6" rx="0.6" fill="${activeFill}" opacity="0.95"/><line x1="10" y1="1.5" x2="10" y2="12.5" stroke="rgba(255,255,255,0.38)" stroke-width="0.8"/><line x1="1.5" y1="7" x2="18.5" y2="7" stroke="rgba(255,255,255,0.38)" stroke-width="0.8"/>`;
  } else if (info.mode === 'bl') {
    highlightRect = `<rect x="2" y="7.4" width="7.5" height="4.6" rx="0.6" fill="${activeFill}" opacity="0.95"/><line x1="10" y1="1.5" x2="10" y2="12.5" stroke="rgba(255,255,255,0.38)" stroke-width="0.8"/><line x1="1.5" y1="7" x2="18.5" y2="7" stroke="rgba(255,255,255,0.38)" stroke-width="0.8"/>`;
  } else if (info.mode === 'br') {
    highlightRect = `<rect x="10.5" y="7.4" width="7.5" height="4.6" rx="0.6" fill="${activeFill}" opacity="0.95"/><line x1="10" y1="1.5" x2="10" y2="12.5" stroke="rgba(255,255,255,0.38)" stroke-width="0.8"/><line x1="1.5" y1="7" x2="18.5" y2="7" stroke="rgba(255,255,255,0.38)" stroke-width="0.8"/>`;
  }

  const svg = `<svg aria-hidden="true" width="18" height="13" viewBox="0 0 20 14" style="width:18px;height:13px;min-width:18px;max-width:18px;min-height:13px;max-height:13px;display:inline-block;vertical-align:middle;flex-shrink:0;">
    <rect x="1" y="1" width="18" height="12" rx="2" fill="rgba(15,23,42,0.9)" stroke="${borderCol}" stroke-width="1.3"/>
    ${highlightRect}
  </svg>`;

  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:5px;background:rgba(15,23,42,0.75);border:1px solid ${borderCol};color:${textCol};font-size:9px;font-weight:800;letter-spacing:0.05em;white-space:nowrap;" title="${theme.short} Match Viewport: ${info.detail}">${svg}<span>${theme.short} · ${info.label}</span></span>`;
}

