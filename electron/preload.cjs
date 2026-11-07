'use strict';

/**
 * Exposes a small, fixed API to the page as `window.desktopAPI`. Its presence
 * is how the game can tell it is running in the desktop build; in a browser it
 * is undefined.
 *
 * The preload runs sandboxed, so it gets the app version from the argument
 * main.cjs passes in rather than from Node.
 */

const { contextBridge, ipcRenderer } = require('electron');

const versionArg = process.argv.find((arg) => arg.startsWith('--valleyball-version='));

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  platform: process.platform,
  version: versionArg ? versionArg.slice('--valleyball-version='.length) : '',
  quit: () => ipcRenderer.send('valleyball:quit'),
  toggleFullscreen: () => ipcRenderer.send('valleyball:toggle-fullscreen'),
});
