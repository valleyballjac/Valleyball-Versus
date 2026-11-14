/**
 * npm run desktop:smoke — launch a packaged desktop build and check it boots.
 *
 * Uses this platform's unpacked build in release/desktop/ (build it first with
 * desktop:dist, desktop:dist:mac or desktop:dist:linux), or the executable
 * passed as the first argument. CI runs it on Windows, macOS and Linux.
 *
 * Passes when the title screen appears, the bundled Orbitron faces load, the
 * page makes no request outside the bundle, nothing throws, and Quit to
 * Desktop arms on one press and closes the app on the second.
 */

import fs from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const UNPACKED = {
  win32: 'win-unpacked/Valleyball Versus.exe',
  darwin: 'mac-universal/Valleyball Versus.app/Contents/MacOS/Valleyball Versus',
  linux: 'linux-unpacked/valleyball-versus',
};

const executablePath = process.argv[2] || path.join('release', 'desktop', UNPACKED[process.platform] ?? '');
if (!fs.existsSync(executablePath)) {
  console.error(`[smoke] No build at ${executablePath}. Build one first, or pass its path.`);
  process.exit(1);
}

// Software-rendered CI machines take a while to compile the arena's shaders.
const BOOT_TIMEOUT_MS = 180_000;

const failures = [];
const app = await electron.launch({ executablePath, args: ['--windowed'], timeout: BOOT_TIMEOUT_MS });
app.context().on('request', (request) => {
  const url = request.url();
  if (!/^(app|data|blob|devtools):/.test(url)) failures.push(`external request: ${url}`);
});
app.context().on('requestfailed', (request) => failures.push(`request failed: ${request.url()} ${request.failure()?.errorText}`));

const win = await app.firstWindow();
win.on('pageerror', (error) => failures.push(`page error: ${error}`));
win.on('console', (message) => {
  if (message.type() === 'error') failures.push(`console error: ${message.text()}`);
});

const quit = win.locator('#btn-title-quit');
await quit.waitFor({ timeout: BOOT_TIMEOUT_MS });

const faces = await win.evaluate(() =>
  [...document.fonts].filter((face) => face.family.replace(/["']/g, '') === 'Orbitron').map((face) => `${face.weight}:${face.status}`),
);
if (faces.length !== 3 || !faces.every((face) => face.endsWith(':loaded'))) {
  failures.push(`Orbitron faces not all loaded: ${faces.join(', ') || 'none registered'}`);
}

await quit.click();
const armed = (await quit.textContent()).trim();
if (armed !== 'PRESS AGAIN TO QUIT') failures.push(`one press on Quit showed "${armed}"`);

const closed = new Promise((resolve) => app.once('close', () => resolve(true)));
await quit.click();
const didClose = await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve(false), 10_000))]);
if (!didClose) {
  failures.push('a second press on Quit did not close the app');
  await app.close();
}

if (failures.length) {
  console.error(`[smoke] FAIL (${executablePath})\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`[smoke] PASS (${executablePath}): title screen up, Orbitron ${faces.join(' ')}, no external requests, Quit works`);
