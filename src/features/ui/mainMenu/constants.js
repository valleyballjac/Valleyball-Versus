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
  { id: 'chase', label: '3RD PERSON CHASE (DEFAULT)' },
  { id: 'ball', label: 'BALL TRACKING CAM' },
  { id: 'sports', label: 'SPORTS CAM [FULLSCREEN]' },
  { id: 'broadcast', label: 'SIDELINE BROADCAST [FULLSCREEN]' },
  { id: 'tactical', label: 'TACTICAL OVERHEAD' },
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
  { id: 'court', label: 'VALLEY COURT (DEFAULT)', desc: '50x120m valley basin with goal hoops' },
  { id: 'bowl', label: 'PHYSICS BOWL', desc: 'Procedural physics lathe & determinism anchor' },
];

export const PRACTICE_BALL_OPTIONS = [
  { id: 'all', label: 'ALL 3 BALLS [SANDBOX]', desc: 'Small, Medium & Big active simultaneously' },
  { id: 'medium', label: 'REGULATION (MEDIUM)', desc: '1.0m · Standard match ball drills' },
  { id: 'small', label: 'FOOTBALL (SMALL)', desc: '0.4m · Precision strike training' },
  { id: 'large', label: 'BIG BALL (TRAINING)', desc: '1.5m · Rebound & volley practice' },
];

export const BALL_OPTIONS = MATCH_BALL_OPTIONS;
