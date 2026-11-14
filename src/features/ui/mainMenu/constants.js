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
  { id: 'random', label: 'RANDOM', desc: 'Random each match [Default]' },
  { id: 'small', label: 'FOOTBALL (SMALL)', desc: '0.4m · Hard Difficulty' },
  { id: 'medium', label: 'MEDIUM BALL', desc: '1.0m · Average Difficulty' },
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

export const BALL_OPTIONS = MATCH_BALL_OPTIONS;

export const HEADWEAR_OPTIONS = Object.freeze(SERIES_1_PLAYTEST_CYCLE.map((e) => Object.freeze({ id: e.id, label: e.label })));

export const ASSIST_OPTIONS = [
  { id: 'standard', label: 'STANDARD', desc: 'v0.2.2 baseline · 0.45m hit forgiveness' },
  { id: 'pureSim', label: 'PURE SIM', desc: 'True physics · 0% forgiveness' },
  { id: 'casual', label: 'CASUAL', desc: '0.65m reach + 360° right-stick aim steering' },
];

/**
 * Signature visual identity per controller/player slot (P1..P4).
 * Ensures every player's cursor, badge, and viewport indicator is immediately distinguishable.
 */
export const PLAYER_SLOT_COLORS = Object.freeze([
  Object.freeze({
    slot: 0,
    label: 'P1',
    short: 'P1',
    name: 'Cyan',
    hex: '#00e5ff',
    bg: 'rgba(0, 229, 255, 0.14)',
    bgStrong: 'rgba(0, 229, 255, 0.24)',
    border: '#00e5ff',
    glow: 'rgba(0, 229, 255, 0.48)',
    textOnFill: '#001018',
  }),
  Object.freeze({
    slot: 1,
    label: 'P2',
    short: 'P2',
    name: 'Coral',
    hex: '#ff2e55',
    bg: 'rgba(255, 46, 85, 0.14)',
    bgStrong: 'rgba(255, 46, 85, 0.24)',
    border: '#ff2e55',
    glow: 'rgba(255, 46, 85, 0.48)',
    textOnFill: '#ffffff',
  }),
  Object.freeze({
    slot: 2,
    label: 'P3',
    short: 'P3',
    name: 'Gold',
    hex: '#fbb417',
    bg: 'rgba(251, 180, 23, 0.14)',
    bgStrong: 'rgba(251, 180, 23, 0.24)',
    border: '#fbb417',
    glow: 'rgba(251, 180, 23, 0.48)',
    textOnFill: '#1a1100',
  }),
  Object.freeze({
    slot: 3,
    label: 'P4',
    short: 'P4',
    name: 'Violet',
    hex: '#a855f7',
    bg: 'rgba(168, 85, 247, 0.14)',
    bgStrong: 'rgba(168, 85, 247, 0.24)',
    border: '#a855f7',
    glow: 'rgba(168, 85, 247, 0.48)',
    textOnFill: '#ffffff',
  }),
]);

export function getPlayerSlotTheme(slotIdx = 0) {
  return PLAYER_SLOT_COLORS[slotIdx] || PLAYER_SLOT_COLORS[0];
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
export function renderViewportBadgeHtml(slotIdx, humanSlots = [], mode = 'match') {
  const info = getSlotViewportInfo(slotIdx, humanSlots, mode);
  const theme = getPlayerSlotTheme(slotIdx);
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

  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:5px;background:rgba(15,23,42,0.75);border:1px solid ${borderCol};color:${textCol};font-size:9px;font-weight:800;letter-spacing:0.05em;white-space:nowrap;" title="Match Viewport: ${info.detail}">${svg}<span>${info.label}</span></span>`;
}

