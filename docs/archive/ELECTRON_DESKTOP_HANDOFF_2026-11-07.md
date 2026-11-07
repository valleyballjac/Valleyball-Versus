# Valleyball Dedicated Desktop Release (Electron)
*Technical Handoff & Implementation Guide for Claude*

---

## 1. Executive Goal

Package **Valleyball Versus (v0.4.0)** into a dedicated Windows desktop application (`.exe`) to:
1. Power the **December 27 Championship** on local hardware with maximum fidelity, zero browser frame-rate jitter, and uncapped refresh rates (**144Hz / 240Hz+**).
2. Support rock-solid **4-controller local multiplayer** without browser tab sleep or WebHID focus-loss issues.
3. Serve as the binary foundation for listing the game **free on Steam / Itch.io**.

---

## 2. Key Engine Discovery: Physics Loop Audit

> [!NOTE]
> **No Simulation Drift at High Refresh Rates**:  
> An audit of `src/core/Loop.js` and `src/sim/physics.js` confirms that Valleyball already decouples rendering from simulation using a fixed timestep accumulator and state interpolation (`src/core/Interpolated.js`).  
> Uncapping the rendering loop to 144Hz, 240Hz, or 360Hz **will not speed up the game or break physics determinism**. The simulation advances at its fixed tick, and Three.js interpolates transforms smoothly between ticks.

---

## 3. Architecture & File Structure

```
Valleyball-Versus-AI/
├── electron/
│   ├── main.cjs            # Main Electron process, GPU flags, window lifecycle
│   └── preload.cjs         # Context bridge, platform detection (isDesktopApp: true)
├── build/
│   └── icon.ico            # Application icon (from brand_dictionary/mark.png)
└── package.json            # Scripts: desktop:dev, desktop:build
```

---

## 4. Implementation Steps

### Step 1: Install Dependencies
Run in `Valleyball-Versus-AI/`:
```bash
npm install --save-dev electron electron-builder wait-on cross-env
```
*(Optional for Steamworks: `npm install steamworks.js`)*

---

### Step 2: Create `electron/main.cjs`
This file configures Chromium command-line switches to unlock high refresh rates and enforce aggressive controller retention:

```javascript
const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');

// Uncap frame rates for 144Hz / 240Hz / 360Hz monitors
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('in-process-gpu');

// Audio and timer resilience
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let mainWindow = null;

function createWindow() {
  Menu.setApplicationMenu(null); // Hide default window menu bar

  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: true,           // Default to tournament borderless fullscreen
    autoHideMenuBar: true,
    backgroundColor: '#0A0A0C', // Match obsidian void
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // CRITICAL: Keeps 4 gamepads polling even if window loses focus!
    },
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173/Valleyball-Versus/');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // F11 to toggle fullscreen during tournament setup
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

---

### Step 3: Create `electron/preload.cjs`
```javascript
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  platform: process.platform,
  version: process.env.npm_package_version || '0.4.0',
});
```

---

### Step 4: Configure `package.json`
Add desktop run and packaging scripts:
```json
"scripts": {
  "desktop:dev": "cross-env NODE_ENV=development electron electron/main.cjs",
  "desktop:pack": "vite build && electron-builder --dir",
  "desktop:dist": "vite build && electron-builder"
},
"build": {
  "appId": "com.valleyball.versus",
  "productName": "Valleyball Versus",
  "directories": {
    "output": "release"
  },
  "files": [
    "dist/**/*",
    "electron/**/*"
  ],
  "win": {
    "target": ["nsis", "portable"],
    "icon": "public/mark.png"
  },
  "nsis": {
    "oneClick": true,
    "perMachine": false,
    "allowToChangeInstallationDirectory": false
  }
}
```

---

### Step 5: Gamepad & Tournament QA Verification
1. **Multi-Controller Polling**: Plug in 4 USB Xbox/DualSense controllers into a hub. Verify that `playerSetup.js` detects all 4 controllers simultaneously without input dropouts.
2. **Defocus Test**: Click outside the window to another monitor; verify the game continues rendering and gamepads continue responding (`backgroundThrottling: false`).
3. **High Refresh Rate Test**: On a 144Hz or 240Hz display, open `main.js` debug stats (`TUNING.debug`) and confirm frame rendering hits the native display refresh rate smoothly.
4. **Offline Run**: Disconnect Wi-Fi / Ethernet and ensure the game boots instantly to the title screen.

---

### Step 6: Steamworks Integration (Pre-Championship)
When ready for Steam, initialize `steamworks.js` inside `electron/main.cjs`:
```javascript
let steamClient = null;
try {
  const steamworks = require('steamworks.js');
  steamClient = steamworks.init(YOUR_STEAM_APP_ID);
  console.log(`[Steam] Connected as: ${steamClient.localplayer.getName()}`);
} catch (err) {
  console.warn('[Steam] Running in standalone non-Steam mode:', err.message);
}
```
This automatically enables the **Steam Overlay**, friends list invites, and tracks player counts.
