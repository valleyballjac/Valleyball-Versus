'use strict';

/**
 * Valleyball Versus — desktop shell (Electron main process).
 *
 * The game itself is the same Vite bundle the web builds ship. This file only
 * hosts it: one window, the Chromium switches a local tournament machine
 * wants, and a private `app://` protocol that serves the bundle from disk.
 *
 * Why a custom protocol rather than loadFile(): Chromium's fetch() does not
 * support file:// URLs, and the game fetches its GLB models and audio. The
 * `app://` scheme is registered as standard and secure, so fetch, ES modules,
 * localStorage and the Gamepad API (secure contexts only) all behave exactly
 * as they do on the HTTPS deployments.
 *
 * Command-line options for the built app:
 *   --windowed   start in a window instead of borderless fullscreen
 *   --uncapped   turn vsync off and render as fast as the GPU allows
 *                (benchmarking only: tears, and works the GPU flat out)
 *
 * Environment:
 *   VALLEYBALL_DEV_URL   load this URL instead of the bundle (desktop:dev)
 */

const { app, BrowserWindow, Menu, protocol, net, shell, ipcMain, powerSaveBlocker, screen } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.VALLEYBALL_DEV_URL || '';
const START_WINDOWED = process.argv.includes('--windowed') || DEV_URL !== '';
const UNCAPPED = process.argv.includes('--uncapped');

const SCHEME = 'app';
const HOST = 'valleyball';
const APP_URL = `${SCHEME}://${HOST}/index.html`;
const BUNDLE_ROOT = path.join(__dirname, '..', 'dist-desktop');

// --- Chromium switches (must be set before the app is ready) ----------------

// Dual-GPU laptops: run on the discrete GPU, not the integrated one.
app.commandLine.appendSwitch('force_high_performance_gpu');
// Keep WebGL hardware-accelerated on drivers Chromium would otherwise blocklist
// down to the software rasteriser, which is unplayable.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Gamepad presses do not count as a user gesture, so without this a
// controller-only setup could leave the AudioContext suspended.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Keep the frame loop and gamepad polling alive when the window loses focus or
// is covered by another window (Windows occlusion detection would pause it).
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// By default requestAnimationFrame is synced to the display, so a 144 Hz or
// 240 Hz monitor already gets 144 or 240 rendered frames a second. The
// simulation is a fixed 60 Hz step (src/core/Loop.js) either way.
if (UNCAPPED) {
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('disable-gpu-vsync');
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

// One copy of the game at a time. A second launch focuses the first.
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) app.quit();

/** @type {BrowserWindow | null} */
let mainWindow = null;
let displaySleepBlocker = -1;

function serveBundle() {
  protocol.handle(SCHEME, (request) => {
    const { host, pathname } = new URL(request.url);
    if (host !== HOST) return new Response('Not found', { status: 404 });
    const file = path.normalize(path.join(BUNDLE_ROOT, decodeURIComponent(pathname)));
    // Refuse anything that resolves outside the bundle (e.g. ../ in the path).
    if (!file.startsWith(BUNDLE_ROOT + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function windowedBounds() {
  // 16:9, at most 1600x900, and never larger than 90% of the work area.
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.min(1600, Math.floor(width * 0.9), Math.floor(((height * 0.9) * 16) / 9));
  return { width: w, height: Math.round((w * 9) / 16) };
}

function isAppPage(url) {
  if (DEV_URL) return url.startsWith(new URL(DEV_URL).origin);
  return url.startsWith(`${SCHEME}://${HOST}/`);
}

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    ...windowedBounds(),
    fullscreen: !START_WINDOWED,
    useContentSize: true,
    autoHideMenuBar: true,
    backgroundColor: '#0A0A0C',
    title: 'Valleyball Versus',
    // The packaged exe carries its own icon; this one is for unpackaged runs.
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep rendering and polling gamepads when the window is not focused.
      backgroundThrottling: false,
      additionalArguments: [`--valleyball-version=${app.getVersion()}`],
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    displaySleepBlocker = powerSaveBlocker.start('prevent-display-sleep');
  });

  const { webContents } = mainWindow;

  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    // F11 toggles fullscreen (the window menu, and its shortcuts, are removed).
    if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'I' && input.control && input.shift) {
      webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // The title screen's links open in the system browser, never in a game window.
  webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (!isAppPage(url)) event.preventDefault();
  });
  webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'fullscreen');
  });

  mainWindow.on('closed', () => {
    if (powerSaveBlocker.isStarted(displaySleepBlocker)) powerSaveBlocker.stop(displaySleepBlocker);
    mainWindow = null;
  });

  mainWindow.loadURL(DEV_URL || APP_URL);
}

// Calls from the page (window.desktopAPI, see preload.cjs).
function fromMainWindow(event) {
  return mainWindow !== null && event.sender === mainWindow.webContents;
}
ipcMain.on('valleyball:quit', (event) => {
  if (fromMainWindow(event)) app.quit();
});
ipcMain.on('valleyball:toggle-fullscreen', (event) => {
  if (fromMainWindow(event)) mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (!isFirstInstance) return;
  if (!DEV_URL) serveBundle();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
