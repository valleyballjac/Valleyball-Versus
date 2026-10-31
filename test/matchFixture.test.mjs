/**
 * Unit tests for match fixtures (src/features/match/matchFixture.js): the
 * ?fixture= format the league runner and tournament links use to start one
 * fully specified match, bot or human on either side.
 *
 * Run: npm run test  (node --test test/)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXTURE_VERSION,
  normalizeFixture,
  readFixtureFromSearch,
  encodeFixtureParam,
  decodeFixtureParam,
  createFixtureRandom,
  fixtureBotSeed,
  fixtureMatchSetup,
  fixtureDeviceMappings,
  resultSide,
  buildMatchResult,
  hashString,
} from '../src/features/match/matchFixture.js';
import { TUNING } from '../src/config/tuning.js';

const botVsHuman = {
  id: 'S1-R1-M1',
  seed: 1234,
  durationSeconds: 120,
  ball: 'large',
  home: { name: 'Volt Gold', controller: 'bot', difficulty: 'medium', aggressiveness: 0.4, color: '#FFD000' },
  away: { name: "Jac O'Neil", controller: 'human', device: 'gamepad2', color: 'blue', headwear: 'none' },
};

test('an empty fixture is two default bots with TUNING.fixture defaults', () => {
  const { fixture, errors } = normalizeFixture({});
  assert.deepEqual(errors, []);
  assert.equal(fixture.version, FIXTURE_VERSION);
  assert.equal(fixture.id, 'fixture');
  assert.equal(fixture.seed, hashString('fixture'));
  assert.equal(fixture.durationSeconds, TUNING.fixture.durationSeconds);
  assert.equal(fixture.ball, TUNING.fixture.ball);
  assert.equal(fixture.assist, 'pureSim');
  assert.equal(fixture.flyover, true);
  assert.equal(fixture.home.controller, 'bot');
  assert.equal(fixture.home.name, 'Home');
  assert.equal(fixture.home.difficulty, TUNING.fixture.botDifficulty);
  assert.equal(fixture.home.color, TUNING.fixture.homeColor);
  assert.equal(fixture.away.name, 'Away');
  assert.equal(fixture.away.color, TUNING.fixture.awayColor);
});

test('a bot-vs-human fixture keeps every field it names', () => {
  const { fixture, errors } = normalizeFixture(botVsHuman);
  assert.deepEqual(errors, []);
  assert.equal(fixture.seed, 1234);
  assert.equal(fixture.durationSeconds, 120);
  assert.equal(fixture.home.color, 0xffd000);
  assert.equal(fixture.home.aggressiveness, 0.4);
  assert.equal(fixture.away.controller, 'human');
  assert.equal(fixture.away.device, 'gamepad2');
  assert.equal(fixture.away.color, 0x1d4ed8);
  assert.equal(fixture.away.headwear, 'none');
  assert.equal(fixture.away.difficulty, undefined);
});

test('a human side with no device is auto', () => {
  const { fixture } = normalizeFixture({ home: { controller: 'human' } });
  assert.equal(fixture.home.device, 'auto');
});

test('typos and unknown keys are errors, never quiet defaults', () => {
  const { fixture, errors } = normalizeFixture({
    durationSecs: 60,
    home: { controller: 'humna' },
    away: { colour: 'red' },
  });
  assert.equal(fixture, null);
  assert.ok(errors.some((e) => e.includes('unknown key "durationSecs"')));
  assert.ok(errors.some((e) => e.includes('home.controller')));
  assert.ok(errors.some((e) => e.includes('away: unknown key "colour"')));
});

test('bot-only and human-only fields are refused on the other kind of side', () => {
  const { errors } = normalizeFixture({
    home: { controller: 'bot', device: 'keyboard1' },
    away: { controller: 'human', difficulty: 'hard', aggressiveness: 0.5 },
  });
  assert.ok(errors.some((e) => e.includes('home.device only applies to a human side')));
  assert.ok(errors.some((e) => e.includes('away.difficulty only applies to a bot side')));
  assert.ok(errors.some((e) => e.includes('away.aggressiveness only applies to a bot side')));
});

test('two humans cannot share one device', () => {
  const { errors } = normalizeFixture({
    home: { controller: 'human', device: 'keyboard1' },
    away: { controller: 'human', device: 'keyboard1' },
  });
  assert.ok(errors.some((e) => e.includes('cannot both use keyboard1')));
});

test('out-of-range values are refused', () => {
  const { errors } = normalizeFixture({
    seed: -1,
    durationSeconds: 5,
    ball: 'huge',
    assist: 'aimbot',
    flyover: 'yes',
    home: { aggressiveness: 2, color: '#GGGGGG', headwear: 'top_hat' },
  });
  for (const field of ['seed', 'durationSeconds', 'ball', 'assist', 'flyover', 'home.aggressiveness', 'home.color', 'home.headwear']) {
    assert.ok(errors.some((e) => e.includes(field)), `expected an error naming ${field}`);
  }
});

test('names that could carry markup are refused; long names too', () => {
  const markup = normalizeFixture({ home: { name: '<img src=x onerror=alert(1)>' } });
  assert.ok(markup.errors.some((e) => e.includes('home.name')));
  const long = normalizeFixture({ home: { name: 'x'.repeat(TUNING.fixture.nameMaxLength + 1) } });
  assert.ok(long.errors.some((e) => e.includes('longer than')));
  const spaced = normalizeFixture({ home: { name: '  Ana   María  ' } });
  assert.equal(spaced.fixture.home.name, 'Ana María');
});

test('ids are checked, not rewritten', () => {
  assert.ok(normalizeFixture({ id: 'S1 R1' }).errors.some((e) => e.startsWith('id ')));
  assert.equal(normalizeFixture({ id: 'S1-R1:M2.b' }).fixture.id, 'S1-R1:M2.b');
});

test('an unsupported version is refused', () => {
  assert.ok(normalizeFixture({ version: 2 }).errors.some((e) => e.includes('version 2')));
});

test('base64url and raw JSON both decode, unicode included', () => {
  const input = { ...botVsHuman, home: { ...botVsHuman.home, name: 'Ana María' } };
  const encoded = encodeFixtureParam(input);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeFixtureParam(encoded), input);
  assert.deepEqual(decodeFixtureParam(JSON.stringify(input)), input);
});

test('readFixtureFromSearch: absent, valid, and undecodable', () => {
  assert.deepEqual(readFixtureFromSearch('?mode=match'), { fixture: null, errors: [] });
  const ok = readFixtureFromSearch(`?fixture=${encodeFixtureParam(botVsHuman)}`);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.fixture.id, 'S1-R1-M1');
  const bad = readFixtureFromSearch('?fixture=%%%');
  assert.equal(bad.fixture, null);
  assert.ok(bad.errors[0].startsWith('fixture could not be decoded'));
});

test('the fixture random is a pure function of the seed', () => {
  const a = createFixtureRandom(99);
  const b = createFixtureRandom(99);
  const c = createFixtureRandom(100);
  const seqA = [a(), a(), a(), a()];
  assert.deepEqual(seqA, [b(), b(), b(), b()]);
  assert.notDeepEqual(seqA, [c(), c(), c(), c()]);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test('each bot slot gets its own seed, fixed by the fixture seed', () => {
  const { fixture } = normalizeFixture(botVsHuman);
  assert.notEqual(fixtureBotSeed(fixture, 0), fixtureBotSeed(fixture, 1));
  assert.equal(fixtureBotSeed(fixture, 0), fixtureBotSeed({ seed: 1234 }, 0));
});

test('setup: home is slot 0, away is slot 1, and both carry the match assist', () => {
  const { fixture } = normalizeFixture(botVsHuman);
  const { configs, rules } = fixtureMatchSetup(fixture, createFixtureRandom(fixture.seed));
  assert.equal(configs[0].team, 'home');
  assert.equal(configs[0].type, 'ai');
  assert.equal(configs[0].difficulty, 'medium');
  assert.equal(configs[0].displayName, 'Volt Gold');
  assert.equal(configs[1].team, 'away');
  assert.equal(configs[1].type, 'human');
  assert.equal(configs[0].assistPreset, 'pureSim');
  assert.equal(configs[1].assistPreset, 'pureSim');
  assert.deepEqual(rules, { ball: 'large', duration: 120 });
});

test('a random ball resolves the same way for the same seed', () => {
  const { fixture } = normalizeFixture({ seed: 7, ball: 'random' });
  const first = fixtureMatchSetup(fixture, createFixtureRandom(7)).rules.ball;
  const second = fixtureMatchSetup(fixture, createFixtureRandom(7)).rules.ball;
  assert.equal(first, second);
  assert.ok(['small', 'medium', 'large'].includes(first));
});

test('device mappings: none when every human is auto, explicit otherwise', () => {
  assert.equal(fixtureDeviceMappings(normalizeFixture({ away: { controller: 'human' } }).fixture), null);
  const mixed = fixtureDeviceMappings(normalizeFixture({
    home: { controller: 'human' },
    away: { controller: 'human', device: 'keyboard2' },
  }).fixture);
  assert.deepEqual(mixed.autoSlots, [0]);
  assert.equal(mixed.mappings[0], null);
  assert.deepEqual(mixed.mappings[1], { type: 'keyboard', keyId: 'kb2', name: 'Keyboard (IJKL)' });
  const pad = fixtureDeviceMappings(normalizeFixture(botVsHuman).fixture);
  assert.deepEqual(pad.mappings[1], { type: 'gamepad', padIndex: 1, name: 'Gamepad 2' });
  assert.equal(pad.mappings[0], null);
});

test('a result names the winner, both sides and every goal', () => {
  const { fixture } = normalizeFixture(botVsHuman);
  const { configs } = fixtureMatchSetup(fixture, createFixtureRandom(fixture.seed));
  const result = buildMatchResult({
    fixture,
    matchState: {
      scoreHome: 1,
      scoreAway: 2,
      events: [
        { tick: 900, scoredFor: 'away', goal: 'S', y: 10, z: 40 },
        { tick: 2100, scoredFor: 'home', goal: 'N', y: 10, z: -40 },
        { tick: 5000, scoredFor: 'away', goal: 'S', y: 10, z: 40 },
      ],
    },
    sides: {
      home: resultSide(configs[0], { hits: 4 }),
      away: resultSide(configs[1], { hits: 6 }, 'gamepad2'),
    },
    ball: 'large',
    durationSeconds: 120,
    endedTick: 7380,
  });
  assert.equal(result.fixtureId, 'S1-R1-M1');
  assert.equal(result.seed, 1234);
  assert.equal(result.winner, 'away');
  assert.deepEqual(result.score, { home: 1, away: 2 });
  assert.equal(result.assist, 'pureSim');
  assert.deepEqual(result.home, { name: 'Volt Gold', controller: 'bot', stats: { hits: 4 }, difficulty: 'medium', aggressiveness: 0.4 });
  assert.deepEqual(result.away, { name: "Jac O'Neil", controller: 'human', stats: { hits: 6 }, device: 'gamepad2' });
  assert.deepEqual(result.goals[1], { tick: 2100, scoredFor: 'home', goal: 'N' });
});

test('a lobby match (no fixture) still reports, with a draw', () => {
  const result = buildMatchResult({
    fixture: null,
    matchState: { scoreHome: 0, scoreAway: 0, events: [] },
    sides: { home: resultSide({ type: 'human', name: 'Player 1' }, {}), away: resultSide({ type: 'ai', name: 'Player 2', difficulty: 'hard' }, {}) },
    ball: 'medium',
    durationSeconds: 300,
    endedTick: 18000,
  });
  assert.equal(result.fixtureId, null);
  assert.equal(result.seed, null);
  assert.equal(result.assist, null);
  assert.equal(result.winner, 'draw');
  assert.equal(result.home.controller, 'human');
  assert.equal(result.away.controller, 'bot');
});
