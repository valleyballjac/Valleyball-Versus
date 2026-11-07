/**
 * npm run desktop:dev — the desktop shell over the Vite dev server, with HMR.
 *
 * Reuses a dev server that is already running on the configured port, and
 * otherwise starts one for the life of the Electron window. Extra arguments
 * are passed through to Electron (e.g. `npm run desktop:dev -- --uncapped`).
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

// Port and base as set in vite.config.js (strictPort, so they never drift).
const DEV_URL = 'http://localhost:5173/Valleyball-Versus/';

const require = createRequire(import.meta.url);
/** In Node, the electron package exports the path to its binary. */
const electronBinary = require('electron');

async function isServing(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

let server = null;
if (await isServing(DEV_URL)) {
  console.log(`[desktop:dev] Using the dev server already running at ${DEV_URL}`);
} else {
  server = await createServer();
  await server.listen();
  console.log(`[desktop:dev] Started Vite at ${DEV_URL}`);
}

const electron = spawn(electronBinary, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VALLEYBALL_DEV_URL: DEV_URL },
});

electron.on('exit', async (code) => {
  if (server) await server.close();
  process.exit(code ?? 0);
});
