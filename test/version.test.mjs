/**
 * Every place the game shows its version must match package.json, so a bump
 * can't miss one. v0.3.5 and v0.3.6 both shipped with a stale in-game menu badge.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const { version } = JSON.parse(read('package.json'));

const SHOWN_IN = [
  'index.html',
  'src/features/ui/mainMenu/titleScreen.js',
  'src/ui/inGameMenu.js',
  'AGENTS.md',
];

for (const file of SHOWN_IN) {
  test(`${file} shows v${version}`, () => {
    assert.ok(read(file).includes(`v${version}`), `${file} does not mention v${version}`);
  });
}
