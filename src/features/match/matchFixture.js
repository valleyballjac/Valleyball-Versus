/**
 * @module features/match/matchFixture
 * URL-driven deterministic match fixture parser, validator, seed generator,
 * device mapper, and result builder supporting both 1v1 and 2v2 matches.
 *
 *   ?fixture=<base64url JSON>      what runners and tournament links send
 *   ?fixture=<URI-encoded JSON>    readable by hand while testing
 *
 * A fixture names each side (home/away in 1v1, or home/away/home2/away2 in 2v2),
 * each a bot or a human, with its kit and display name, plus one ball, one
 * length, one assist rule, optional overtime policy, and a seed. The page skips
 * the menus, plays exactly that match, and reports one result (`vb:matchover`).
 *
 * STRICT ON PURPOSE. An unknown key or a bad value is an error, never a quiet
 * default: in a tournament, a typo such as "controller": "humna" must not turn
 * a player into a bot.
 *
 * SLOTS ARE FIXED:
 *   1v1: home is slot 0, away is slot 1.
 *   2v2: home is slot 0, away is slot 1, home2 is slot 2, away2 is slot 3.
 */

import { TUNING } from '../../config/tuning.js';
import { PALETTES, resolveHeadwearSpec } from '../../config/cosmetics.js';

export const FIXTURE_VERSION = 1;

const TOP_KEYS = [
  'version',
  'id',
  'seed',
  'mode',
  'durationSeconds',
  'ball',
  'assist',
  'flyover',
  'overtime',
  'overtimeDurationSeconds',
  'home',
  'away',
  'home2',
  'away2',
  'players',
];
const SIDE_KEYS = ['name', 'controller', 'device', 'difficulty', 'aggressiveness', 'variant', 'color', 'headwear', 'camera'];
const MODES = ['1v1', '2v2'];
const BALLS = ['small', 'medium', 'large', 'random'];
const CONCRETE_BALLS = ['small', 'medium', 'large'];
const CONTROLLERS = ['bot', 'human'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const VARIANTS = ['classic', 'masculine', 'feminine'];
const CAMERAS = ['chase', 'thirdPerson', 'firstPerson'];
const OVERTIME_MODES = ['draw', 'golden_goal', 'timed'];
const OVERTIME_DURATIONS = [60, 120, 180, 300];

// A human side's device, by the name an organizer writes, to the input
// router's mapping. 'auto' leaves the side on the router's default routing.
const DEVICES = {
  keyboard1: { type: 'keyboard', keyId: 'kb1', name: 'Keyboard (WASD)' },
  keyboard2: { type: 'keyboard', keyId: 'kb2', name: 'Keyboard (IJKL)' },
  gamepad1: { type: 'gamepad', padIndex: 0, name: 'Gamepad 1' },
  gamepad2: { type: 'gamepad', padIndex: 1, name: 'Gamepad 2' },
  gamepad3: { type: 'gamepad', padIndex: 2, name: 'Gamepad 3' },
  gamepad4: { type: 'gamepad', padIndex: 3, name: 'Gamepad 4' },
};
const DEVICE_NAMES = ['auto', ...Object.keys(DEVICES)];

// Display names reach innerHTML (the flyover matchup), so only plain text passes.
const NAME_PATTERN = /^[\p{L}\p{N} ._'-]+$/u;
const ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function listOf(values) {
  return values.map((v) => `"${v}"`).join(', ');
}

function checkKeys(obj, allowed, where, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`${where}: unknown key "${key}" (allowed: ${allowed.join(', ')})`);
  }
}

function oneOf(value, allowed, fallback, where, errors) {
  if (value === undefined) return fallback;
  if (allowed.includes(value)) return value;
  errors.push(`${where} must be one of ${listOf(allowed)}, got ${JSON.stringify(value)}`);
  return fallback;
}

function cleanName(value, fallback, where, errors) {
  if (value === undefined) return fallback;
  const max = TUNING.fixture.nameMaxLength;
  if (typeof value !== 'string') {
    errors.push(`${where} must be a string`);
    return fallback;
  }
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || !NAME_PATTERN.test(name)) {
    errors.push(`${where} may use letters, digits, spaces and . _ ' - only, got ${JSON.stringify(value)}`);
    return fallback;
  }
  if (name.length > max) {
    errors.push(`${where} is longer than ${max} characters`);
    return fallback;
  }
  return name;
}

function parseColor(value, fallback, where, errors) {
  if (value === undefined) return fallback;
  if (Number.isInteger(value) && value >= 0 && value <= 0xffffff) return value;
  if (typeof value === 'string') {
    const hex = value.match(/^(?:#|0x)([0-9a-fA-F]{6})$/);
    if (hex) return parseInt(hex[1], 16);
    if (PALETTES[value]) return PALETTES[value].value;
  }
  errors.push(`${where} must be "#RRGGBB", "0xRRGGBB" or a palette id (${listOf(Object.keys(PALETTES))}), got ${JSON.stringify(value)}`);
  return fallback;
}

/** FNV-1a, 32-bit. A fixture with no seed is seeded from its id, so it still replays. */
export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Mulberry32. Every random choice a fixture match makes outside the
 * simulation (ball, stream heads) draws from this, in a fixed order, so the
 * same seed sets the match up the same way every time.
 * @param {number} seed uint32
 * @returns {() => number} [0, 1)
 */
export function createFixtureRandom(seed) {
  let a = seed >>> 0;
  return function fixtureRandom() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The bot controller seed for a slot: one per side, both fixed by the fixture seed. */
export function fixtureBotSeed(fixture, slotIndex) {
  return (fixture.seed ^ Math.imul(slotIndex + 1, 0x9e3779b1)) >>> 0;
}

export function encodeFixtureParam(fixture) {
  const bytes = new TextEncoder().encode(JSON.stringify(fixture));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeFixtureParam(raw) {
  const text = raw.trim();
  if (text.startsWith('{')) return JSON.parse(text);
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

const DEFAULT_SIDE_NAMES = {
  home: 'Home',
  away: 'Away',
  home2: 'Home 2',
  away2: 'Away 2',
};

function normalizeSide(input, where, errors) {
  const cfg = TUNING.fixture;
  const side = input === undefined ? {} : input;
  if (!isPlainObject(side)) {
    errors.push(`${where} must be an object`);
    return null;
  }
  checkKeys(side, SIDE_KEYS, where, errors);

  const isHomeSide = where === 'home' || where === 'home2';
  const defaultName = DEFAULT_SIDE_NAMES[where] || (isHomeSide ? 'Home' : 'Away');
  const controller = oneOf(side.controller, CONTROLLERS, 'bot', `${where}.controller`, errors);
  const out = {
    name: cleanName(side.name, defaultName, `${where}.name`, errors),
    controller,
    variant: oneOf(side.variant, VARIANTS, cfg.variant, `${where}.variant`, errors),
    color: parseColor(side.color, isHomeSide ? cfg.homeColor : cfg.awayColor, `${where}.color`, errors),
    headwear: null,
    camera: oneOf(side.camera, CAMERAS, cfg.camera, `${where}.camera`, errors),
  };

  if (side.headwear !== undefined && side.headwear !== null) {
    if (side.headwear === 'none' || (typeof side.headwear === 'string' && resolveHeadwearSpec(side.headwear))) {
      out.headwear = side.headwear;
    } else {
      errors.push(`${where}.headwear ${JSON.stringify(side.headwear)} is not a known headwear id`);
    }
  }

  if (controller === 'bot') {
    if (side.device !== undefined) errors.push(`${where}.device only applies to a human side`);
    out.difficulty = oneOf(side.difficulty, DIFFICULTIES, cfg.botDifficulty, `${where}.difficulty`, errors);
    out.aggressiveness = cfg.botAggressiveness;
    if (side.aggressiveness !== undefined) {
      if (typeof side.aggressiveness === 'number' && side.aggressiveness >= 0 && side.aggressiveness <= 1) {
        out.aggressiveness = side.aggressiveness;
      } else {
        errors.push(`${where}.aggressiveness must be a number from 0 to 1`);
      }
    }
  } else {
    if (side.difficulty !== undefined) errors.push(`${where}.difficulty only applies to a bot side`);
    if (side.aggressiveness !== undefined) errors.push(`${where}.aggressiveness only applies to a bot side`);
    out.device = oneOf(side.device, DEVICE_NAMES, 'auto', `${where}.device`, errors);
  }
  return out;
}

/**
 * Validates a fixture and fills in its defaults from TUNING.fixture.
 * @param {unknown} input parsed JSON
 * @returns {{ fixture: object | null, errors: string[] }} fixture is null whenever errors is not empty
 */
export function normalizeFixture(input) {
  const errors = [];
  if (!isPlainObject(input)) return { fixture: null, errors: ['fixture must be a JSON object'] };
  checkKeys(input, TOP_KEYS, 'fixture', errors);
  const cfg = TUNING.fixture;

  if (input.version !== undefined && input.version !== FIXTURE_VERSION) {
    errors.push(`version ${JSON.stringify(input.version)} is not supported (this build reads version ${FIXTURE_VERSION})`);
  }

  let id = 'fixture';
  if (input.id !== undefined) {
    if (typeof input.id === 'string' && ID_PATTERN.test(input.id) && input.id.length <= cfg.idMaxLength) {
      id = input.id;
    } else {
      errors.push(`id must be 1 to ${cfg.idMaxLength} of A-Z a-z 0-9 _ . : -`);
    }
  }

  let seed = hashString(id);
  if (input.seed !== undefined) {
    if (Number.isInteger(input.seed) && input.seed >= 0 && input.seed <= 0xffffffff) seed = input.seed;
    else errors.push('seed must be an integer from 0 to 4294967295');
  }

  const mode = oneOf(input.mode, MODES, '1v1', 'mode', errors);

  let durationSeconds = cfg.durationSeconds;
  if (input.durationSeconds !== undefined) {
    const d = input.durationSeconds;
    if (Number.isInteger(d) && d >= cfg.minDurationSeconds && d <= cfg.maxDurationSeconds) durationSeconds = d;
    else errors.push(`durationSeconds must be a whole number from ${cfg.minDurationSeconds} to ${cfg.maxDurationSeconds}`);
  }

  let flyover = cfg.flyover;
  if (input.flyover !== undefined) {
    if (typeof input.flyover === 'boolean') flyover = input.flyover;
    else errors.push('flyover must be true or false');
  }

  const overtime = oneOf(input.overtime, OVERTIME_MODES, 'draw', 'overtime', errors);
  const overtimeDurationSeconds = oneOf(input.overtimeDurationSeconds, OVERTIME_DURATIONS, 120, 'overtimeDurationSeconds', errors);

  let homeInput = input.home;
  let awayInput = input.away;
  let home2Input = input.home2;
  let away2Input = input.away2;

  if (input.players !== undefined) {
    if (homeInput !== undefined || awayInput !== undefined || home2Input !== undefined || away2Input !== undefined) {
      errors.push('players array cannot be combined with home, away, home2, or away2 keys');
    } else if (!Array.isArray(input.players)) {
      errors.push('players must be an array');
    } else {
      const expectedLen = mode === '2v2' ? 4 : 2;
      if (input.players.length !== expectedLen) {
        errors.push(`players must have ${expectedLen} entries for mode "${mode}", got ${input.players.length}`);
      } else {
        homeInput = input.players[0];
        awayInput = input.players[1];
        if (mode === '2v2') {
          home2Input = input.players[2];
          away2Input = input.players[3];
        }
      }
    }
  } else if (mode === '1v1') {
    if (home2Input !== undefined) errors.push('home2 only applies when mode is "2v2"');
    if (away2Input !== undefined) errors.push('away2 only applies when mode is "2v2"');
  }

  const home = normalizeSide(homeInput, 'home', errors);
  const away = normalizeSide(awayInput, 'away', errors);
  const home2 = mode === '2v2' ? normalizeSide(home2Input, 'home2', errors) : null;
  const away2 = mode === '2v2' ? normalizeSide(away2Input, 'away2', errors) : null;

  const fixture = {
    version: FIXTURE_VERSION,
    id,
    seed,
    mode,
    durationSeconds,
    ball: oneOf(input.ball, BALLS, cfg.ball, 'ball', errors),
    assist: oneOf(input.assist, Object.keys(TUNING.strike.assistPresets), cfg.assist, 'assist', errors),
    flyover,
    overtime,
    overtimeDurationSeconds,
    home,
    away,
  };

  if (mode === '2v2') {
    fixture.home2 = home2;
    fixture.away2 = away2;
  }

  const namedSides = mode === '2v2'
    ? [['home', home], ['away', away], ['home2', home2], ['away2', away2]]
    : [['home', home], ['away', away]];

  for (let i = 0; i < namedSides.length; i++) {
    const [nameA, sideA] = namedSides[i];
    if (!sideA || sideA.controller !== 'human' || sideA.device === 'auto') continue;
    for (let j = i + 1; j < namedSides.length; j++) {
      const [nameB, sideB] = namedSides[j];
      if (!sideB || sideB.controller !== 'human' || sideB.device === 'auto') continue;
      if (sideA.device === sideB.device) {
        errors.push(`${nameA} and ${nameB} cannot both use ${sideA.device}`);
      }
    }
  }

  return { fixture: errors.length ? null : fixture, errors };
}

/**
 * Reads ?fixture= from a query string.
 * @param {string} search
 * @returns {{ fixture: object | null, errors: string[] }} both empty when the URL carries no fixture
 */
export function readFixtureFromSearch(search) {
  const raw = new URLSearchParams(search).get('fixture');
  if (raw === null) return { fixture: null, errors: [] };
  let input;
  try {
    input = decodeFixtureParam(raw);
  } catch (err) {
    return { fixture: null, errors: [`fixture could not be decoded: ${err.message}`] };
  }
  return normalizeFixture(input);
}

/**
 * Explicit device mappings for the human sides, or null when every human side
 * is 'auto' (the router's default routing already covers that).
 * @returns {{ mappings: object, autoSlots: number[] } | null}
 */
export function fixtureDeviceMappings(fixture) {
  const sides = fixture.mode === '2v2'
    ? [fixture.home, fixture.away, fixture.home2, fixture.away2]
    : [fixture.home, fixture.away];
  if (!sides.some((s) => s && s.controller === 'human' && s.device !== 'auto')) return null;
  const mappings = {};
  const autoSlots = [];
  for (let i = 0; i < sides.length; i++) {
    const s = sides[i];
    if (s && s.controller === 'human' && s.device !== 'auto') {
      mappings[i] = { ...DEVICES[s.device] };
    } else {
      mappings[i] = null;
      if (s && s.controller === 'human') autoSlots.push(i);
    }
  }
  return { mappings, autoSlots };
}

function sideConfig(side, team, id, assist) {
  return {
    id,
    team,
    name: side.name,
    displayName: side.name,
    type: side.controller === 'bot' ? 'ai' : 'human',
    difficulty: side.difficulty,
    aggressiveness: side.aggressiveness,
    variant: side.variant,
    primaryColor: side.color,
    headwear: side.headwear,
    cameraMode: side.camera,
    assistPreset: assist,
  };
}

/**
 * The player configs and rules handleStartMatch takes, plus device mappings.
 * Draws the ball (when "random") from `random` first, before anything else.
 * @param {object} fixture normalized
 * @param {() => number} random from createFixtureRandom(fixture.seed)
 */
export function fixtureMatchSetup(fixture, random) {
  const ball = fixture.ball === 'random'
    ? CONCRETE_BALLS[Math.floor(random() * CONCRETE_BALLS.length)]
    : fixture.ball;
  const configs = [
    sideConfig(fixture.home, 'home', 'p1', fixture.assist),
    sideConfig(fixture.away, 'away', 'p2', fixture.assist),
  ];
  if (fixture.mode === '2v2' && fixture.home2 && fixture.away2) {
    configs.push(
      sideConfig(fixture.home2, 'home', 'p3', fixture.assist),
      sideConfig(fixture.away2, 'away', 'p4', fixture.assist),
    );
  }
  return {
    configs,
    rules: { ball, duration: fixture.durationSeconds },
    devices: fixtureDeviceMappings(fixture),
  };
}

/**
 * One side of a result, from the config that started the match.
 * @param {object} config a handleStartMatch player config
 * @param {object} stats strike and match stats for that slot
 * @param {string | null} device the fixture's device name for a human side
 */
export function resultSide(config, stats, device = null) {
  const isBot = config?.type === 'ai';
  const side = {
    name: config?.displayName || config?.name || null,
    controller: isBot ? 'bot' : 'human',
    stats,
  };
  if (isBot) {
    side.difficulty = config.difficulty ?? null;
    side.aggressiveness = config.aggressiveness ?? null;
  } else {
    side.device = device;
  }
  return side;
}

/**
 * The one result a finished match reports, fixture or not.
 * @param {object} args
 * @param {object | null} args.fixture the fixture that started the match; null for a lobby match
 * @param {{ scoreHome: number, scoreAway: number, events: object[] }} args.matchState
 * @param {{ home: object | null, away: object | null, home2?: object | null, away2?: object | null }} args.sides from resultSide
 */
export function buildMatchResult({ fixture, matchState, sides, ball, durationSeconds, endedTick }) {
  const home = matchState.scoreHome || 0;
  const away = matchState.scoreAway || 0;
  const is2v2 = fixture?.mode === '2v2' || Boolean(sides?.home2 || sides?.away2);
  const result = {
    version: FIXTURE_VERSION,
    fixtureId: fixture ? fixture.id : null,
    seed: fixture ? fixture.seed : null,
    mode: is2v2 ? '2v2' : '1v1',
    ball,
    assist: fixture ? fixture.assist : null,
    durationSeconds,
    endedTick,
    score: { home, away },
    winner: home > away ? 'home' : away > home ? 'away' : 'draw',
    home: sides.home,
    away: sides.away,
    goals: (matchState.events || []).map((e) => ({ tick: e.tick, scoredFor: e.scoredFor, goal: e.goal })),
  };
  if (is2v2) {
    result.home2 = sides.home2 ?? null;
    result.away2 = sides.away2 ?? null;
  }
  if (matchState.overtimePeriod > 0 || matchState.overtimeMode) {
    result.overtime = {
      mode: matchState.overtimeMode || (matchState.isGoldenGoal ? 'golden_goal' : 'timed'),
      periods: matchState.overtimePeriod || 1,
    };
  }
  return result;
}
