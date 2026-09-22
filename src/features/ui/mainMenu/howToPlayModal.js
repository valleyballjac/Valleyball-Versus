/**
 * 4. How To Play Modal (Controls, Match Basics, Scoring & Pro Tips)
 */
let rootContainer = null;
let controlsModalEl = null;

const HOWTO_TABS = ['controls', 'basics', 'tips'];
let currentHowToPlayTab = 'controls';
let currentControlsDevice = 'gamepad'; // 'gamepad' | 'keyboard'

export function buildHowToPlayModal(rootEl) {
  if (rootEl) rootContainer = rootEl;
  controlsModalEl = document.createElement('div');
  controlsModalEl.id = 'controls-modal';
  controlsModalEl.style.cssText = `
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(4, 7, 12, 0.88);
    backdrop-filter: blur(12px);
    pointer-events: auto;
    z-index: 1000;
  `;

  const box = document.createElement('div');
  box.style.cssText = `
    display: flex;
    flex-direction: column;
    max-width: 840px;
    width: 92%;
    max-height: 90vh;
    overflow-y: auto;
    background: rgba(11, 17, 26, 0.98);
    border: 1px solid rgba(120, 170, 210, 0.35);
    border-radius: 14px;
    padding: 24px 28px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.9), 0 0 30px rgba(56, 189, 248, 0.15);
    font-family: inherit;
  `;

  // Header & 3-Tab Navigation
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid;
    border-image: linear-gradient(90deg, #ff2e55, #ff6b35, #fbb417, #4ade80, #00e5ff, #3b82f6, #a855f7) 1;
    padding-bottom: 14px;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 12px;
  `;

  const titleGroup = document.createElement('div');
  titleGroup.innerHTML = `
    <div style="font-size: 20px; font-weight: 900; letter-spacing: 0.1em; display: flex; align-items: baseline; gap: 8px;">
      <span style="background: linear-gradient(90deg, #ff2e55 0%, #ff6b35 20%, #fbb417 40%, #4ade80 60%, #00e5ff 80%, #a855f7 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">VALLEYBALL</span>
      <span style="color: #ffffff;">HOW TO PLAY</span>
    </div>
    <div style="font-size: 11px; color: #94a3b8; font-weight: 700; letter-spacing: 0.08em; margin-top: 2px;">CONTROLS · MATCH BASICS · SCORING STRATEGY</div>
  `;

  const mainTabGroup = document.createElement('div');
  mainTabGroup.style.cssText = 'display: flex; gap: 8px; background: rgba(0, 0, 0, 0.4); padding: 4px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);';

  const btnTabControls = document.createElement('button');
  btnTabControls.id = 'tab-howto-controls';
  btnTabControls.textContent = '🎮 CONTROLS';

  const btnTabBasics = document.createElement('button');
  btnTabBasics.id = 'tab-howto-basics';
  btnTabBasics.textContent = '📋 MATCH BASICS';

  const btnTabTips = document.createElement('button');
  btnTabTips.id = 'tab-howto-tips';
  btnTabTips.textContent = '🎯 SCORING & PRO TIPS';

  [btnTabControls, btnTabBasics, btnTabTips].forEach((btn) => {
    btn.style.cssText = `
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 800;
      font-family: inherit;
      letter-spacing: 0.08em;
      color: #94a3b8;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
    `;
    mainTabGroup.appendChild(btn);
  });

  header.appendChild(titleGroup);
  header.appendChild(mainTabGroup);
  box.appendChild(header);

  // -------------------------------------------------------------------------
  // VIEW 1: CONTROLS VIEW (Gamepad SVG + Keyboard Diagram + Reference Table)
  // -------------------------------------------------------------------------
  const controlsView = document.createElement('div');
  controlsView.id = 'howto-view-controls';
  controlsView.style.cssText = 'display: flex; flex-direction: column; width: 100%;';

  // Sub-tab switcher: Gamepad vs Keyboard
  const subTabContainer = document.createElement('div');
  subTabContainer.style.cssText = 'display: flex; justify-content: center; margin-bottom: 12px;';
  const subTabGroup = document.createElement('div');
  subTabGroup.style.cssText = 'display: flex; gap: 6px; background: rgba(255,255,255,0.05); padding: 3px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);';

  const btnSubGamepad = document.createElement('button');
  btnSubGamepad.id = 'subtab-controls-gamepad';
  btnSubGamepad.textContent = '🎮 GAMEPAD';
  btnSubGamepad.style.cssText = `
    padding: 6px 14px; font-size: 11px; font-weight: 800; font-family: inherit;
    color: #000000; background: #ffffff; border: 1px solid #ffffff; border-radius: 4px; cursor: pointer;
  `;

  const btnSubKeyboard = document.createElement('button');
  btnSubKeyboard.id = 'subtab-controls-keyboard';
  btnSubKeyboard.textContent = '⌨️ KEYBOARD & MOUSE';
  btnSubKeyboard.style.cssText = `
    padding: 6px 14px; font-size: 11px; font-weight: 800; font-family: inherit;
    color: #94a3b8; background: transparent; border: 1px solid transparent; border-radius: 4px; cursor: pointer;
  `;

  subTabGroup.appendChild(btnSubGamepad);
  subTabGroup.appendChild(btnSubKeyboard);
  subTabContainer.appendChild(subTabGroup);
  controlsView.appendChild(subTabContainer);

  const diagramContainer = document.createElement('div');
  diagramContainer.style.cssText = 'display: flex; flex-direction: column; align-items: center; width: 100%; margin-bottom: 16px;';

  // 1A. GAMEPAD SVG SCHEMATIC
  const gamepadView = document.createElement('div');
  gamepadView.id = 'controls-view-gamepad';
  gamepadView.style.cssText = 'width: 100%; display: flex; justify-content: center;';
  gamepadView.innerHTML = `
    <svg viewBox="0 0 760 300" style="width: 100%; max-height: 280px; filter: drop-shadow(0 6px 20px rgba(0,0,0,0.6)); font-family: ui-monospace, SFMono-Regular, Consolas, monospace;">
      <defs>
        <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1e293b"/>
          <stop offset="100%" stop-color="#090f1d"/>
        </linearGradient>
        <filter id="glowCyan" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#38bdf8" flood-opacity="0.6"/>
        </filter>
        <filter id="glowRose" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#f43f5e" flood-opacity="0.6"/>
        </filter>
        <filter id="glowGreen" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#10b981" flood-opacity="0.6"/>
        </filter>
      </defs>

      <!-- Controller Silhouette -->
      <path d="M 270 85 C 235 85 200 105 175 145 C 150 185 145 235 175 268 C 205 298 250 260 280 215 C 315 200 445 200 480 215 C 510 260 555 298 585 268 C 615 235 610 185 585 145 C 560 105 525 85 490 85 Z" fill="url(#bodyGrad)" stroke="#334155" stroke-width="2.5"/>
      <ellipse cx="205" cy="225" rx="32" ry="44" fill="none" stroke="rgba(56,189,248,0.12)" stroke-width="2"/>
      <ellipse cx="555" cy="225" rx="32" ry="44" fill="none" stroke="rgba(56,189,248,0.12)" stroke-width="2"/>

      <!-- Bumpers / Triggers -->
      <rect x="220" y="60" width="52" height="20" rx="5" fill="#1e293b" stroke="#38bdf8" stroke-width="2"/>
      <text x="246" y="74" fill="#38bdf8" font-size="11" font-weight="900" text-anchor="middle">LT / LB</text>

      <rect x="488" y="60" width="52" height="20" rx="5" fill="#1e293b" stroke="#38bdf8" stroke-width="2"/>
      <text x="514" y="74" fill="#38bdf8" font-size="11" font-weight="900" text-anchor="middle">RT / RB</text>

      <!-- Left Thumbstick -->
      <circle cx="265" cy="155" r="28" fill="#0f172a" stroke="#38bdf8" stroke-width="2" filter="url(#glowCyan)"/>
      <circle cx="265" cy="155" r="15" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>
      <path d="M 265 143 L 265 147 M 265 163 L 265 167 M 253 155 L 257 155 M 273 155 L 277 155" stroke="#94a3b8" stroke-width="2"/>

      <!-- Right Thumbstick -->
      <circle cx="435" cy="188" r="28" fill="#0f172a" stroke="#38bdf8" stroke-width="2" filter="url(#glowCyan)"/>
      <circle cx="435" cy="188" r="15" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>
      <path d="M 435 176 L 435 180 M 435 196 L 435 200 M 423 188 L 427 188 M 443 188 L 447 188" stroke="#94a3b8" stroke-width="2"/>

      <!-- D-Pad -->
      <path d="M 319 168 H 331 V 182 H 345 V 194 H 331 V 208 H 319 V 194 H 305 V 182 H 319 Z" fill="#1e293b" stroke="#64748b" stroke-width="2"/>

      <!-- Center System Buttons -->
      <circle cx="348" cy="132" r="7" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
      <circle cx="412" cy="132" r="7" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>

      <!-- Face Buttons -->
      <circle cx="495" cy="120" r="12" fill="#1e293b" stroke="#f43f5e" stroke-width="2" filter="url(#glowRose)"/>
      <text x="495" y="124" fill="#f43f5e" font-size="11" font-weight="900" text-anchor="middle">Y</text>

      <circle cx="525" cy="150" r="12" fill="#1e293b" stroke="#38bdf8" stroke-width="2" filter="url(#glowCyan)"/>
      <text x="525" y="154" fill="#38bdf8" font-size="11" font-weight="900" text-anchor="middle">B</text>

      <circle cx="495" cy="180" r="12" fill="#1e293b" stroke="#10b981" stroke-width="2" filter="url(#glowGreen)"/>
      <text x="495" y="184" fill="#10b981" font-size="11" font-weight="900" text-anchor="middle">A</text>

      <circle cx="465" cy="150" r="12" fill="#1e293b" stroke="#a855f7" stroke-width="2"/>
      <text x="465" y="154" fill="#a855f7" font-size="11" font-weight="900" text-anchor="middle">X</text>

      <!-- CALLOUT POINTERS & LABELS (LEFT) -->
      <polyline points="220,70 140,45" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="25" y="32" width="115" height="24" rx="4" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" stroke-width="1"/>
      <text x="82" y="48" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">LT · SPRINT</text>

      <polyline points="230,90 140,80" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="25" y="68" width="115" height="24" rx="4" fill="rgba(59,130,246,0.15)" stroke="#3b82f6" stroke-width="1"/>
      <text x="82" y="84" fill="#93c5fd" font-size="10" font-weight="800" text-anchor="middle">LB · CUT / PLANT</text>

      <polyline points="348,125 310,35" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="220" y="22" width="150" height="24" rx="4" fill="rgba(245,158,11,0.15)" stroke="#f59e0b" stroke-width="1"/>
      <text x="295" y="38" fill="#fcd34d" font-size="10" font-weight="800" text-anchor="middle">SELECT · BALL RESET</text>

      <polyline points="237,155 125,145" fill="none" stroke="#10b981" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="10" y="133" width="115" height="24" rx="4" fill="rgba(16,185,129,0.15)" stroke="#10b981" stroke-width="1"/>
      <text x="67" y="149" fill="#6ee7b7" font-size="10" font-weight="800" text-anchor="middle">L-STICK · MOVE</text>

      <polyline points="312,195 140,225" fill="none" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="15" y="213" width="125" height="24" rx="4" fill="rgba(251,191,36,0.15)" stroke="#fbbf24" stroke-width="1"/>
      <text x="77" y="229" fill="#fde68a" font-size="10" font-weight="800" text-anchor="middle">D-PAD · CYCLE CAM</text>

      <!-- CALLOUT POINTERS & LABELS (RIGHT) -->
      <polyline points="540,70 620,45" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="620" y="32" width="115" height="24" rx="4" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" stroke-width="1"/>
      <text x="677" y="48" fill="#ffffff" font-size="10" font-weight="800" text-anchor="middle">RT · SLIDE</text>

      <polyline points="412,125 450,35" fill="none" stroke="#f43f5e" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="390" y="22" width="140" height="24" rx="4" fill="rgba(244,63,94,0.15)" stroke="#f43f5e" stroke-width="1"/>
      <text x="460" y="38" fill="#fda4af" font-size="10" font-weight="800" text-anchor="middle">START · PAUSE</text>

      <polyline points="507,120 625,95" fill="none" stroke="#f43f5e" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="625" y="83" width="115" height="24" rx="4" fill="rgba(244,63,94,0.15)" stroke="#f43f5e" stroke-width="1"/>
      <text x="682" y="99" fill="#fda4af" font-size="10" font-weight="800" text-anchor="middle">Y · SPIKE</text>

      <polyline points="537,150 635,135" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="635" y="123" width="115" height="24" rx="4" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" stroke-width="1"/>
      <text x="692" y="139" fill="#bae6fd" font-size="10" font-weight="800" text-anchor="middle">B · VOLLEY</text>

      <polyline points="465,162 615,175" fill="none" stroke="#a855f7" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="615" y="163" width="115" height="24" rx="4" fill="rgba(168,85,247,0.15)" stroke="#a855f7" stroke-width="1"/>
      <text x="672" y="179" fill="#e9d5ff" font-size="10" font-weight="800" text-anchor="middle">X · DIVE</text>

      <polyline points="507,180 625,215" fill="none" stroke="#10b981" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="625" y="203" width="115" height="24" rx="4" fill="rgba(16,185,129,0.15)" stroke="#10b981" stroke-width="1"/>
      <text x="682" y="219" fill="#a7f3d0" font-size="10" font-weight="800" text-anchor="middle">A · JUMP</text>

      <polyline points="445,205 530,265" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3"/>
      <rect x="450" y="260" width="165" height="24" rx="4" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" stroke-width="1"/>
      <text x="532" y="276" fill="#7dd3fc" font-size="10" font-weight="800" text-anchor="middle">R-STICK · AIM / ORIENT</text>
    </svg>
  `;

  // 1B. KEYBOARD & MOUSE SCHEMATIC
  const keyboardView = document.createElement('div');
  keyboardView.id = 'controls-view-keyboard';
  keyboardView.style.cssText = 'width: 100%; display: none; flex-direction: column; align-items: center; gap: 14px; padding: 6px 0;';
  keyboardView.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 720px;">
      <!-- Row 1: Function Keys -->
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; gap: 8px;">
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 68px; height: 48px; background: #0f172a; border: 1px solid #ef4444; border-radius: 6px; box-shadow: 0 0 10px rgba(239,68,68,0.3);">
            <span style="color: #ffffff; font-weight: 900; font-size: 13px;">ESC</span>
            <span style="color: #ef4444; font-weight: 700; font-size: 9px;">PAUSE</span>
          </div>
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 68px; height: 48px; background: #0f172a; border: 1px solid #fbbf24; border-radius: 6px; box-shadow: 0 0 10px rgba(251,191,36,0.3);">
            <span style="color: #ffffff; font-weight: 900; font-size: 13px;">TAB</span>
            <span style="color: #fbbf24; font-weight: 700; font-size: 9px;">CAM CYCLE</span>
          </div>
        </div>
        <div style="font-size: 11px; font-weight: 700; color: #94a3b8; letter-spacing: 0.08em;">PRIMARY ATHLETE CONTROLS (P1)</div>
      </div>

      <!-- Row 2: Action Letters Row (Q, W, E, R) + Mouse Look/Strikes -->
      <div style="display: flex; gap: 10px; justify-content: center; align-items: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 58px; background: #0f172a; border: 1px solid #a855f7; border-radius: 8px; box-shadow: 0 0 12px rgba(168,85,247,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">Q</span>
          <span style="color: #c084fc; font-weight: 800; font-size: 9px;">DIVE</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 58px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">W</span>
          <span style="color: #34d399; font-weight: 800; font-size: 9px;">MOVE FWD</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 78px; height: 58px; background: #0f172a; border: 1px solid #38bdf8; border-radius: 8px; box-shadow: 0 0 12px rgba(56,189,248,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">E / L-CLICK</span>
          <span style="color: #7dd3fc; font-weight: 800; font-size: 8.5px;">VOLLEY</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 78px; height: 58px; background: #0f172a; border: 1px solid #f43f5e; border-radius: 8px; box-shadow: 0 0 12px rgba(244,63,94,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">R / R-CLICK</span>
          <span style="color: #fb7185; font-weight: 800; font-size: 8.5px;">SPIKE</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 120px; height: 58px; background: #0f172a; border: 1px solid #00e5ff; border-radius: 8px; box-shadow: 0 0 12px rgba(0,229,255,0.35);">
          <span style="color: #00e5ff; font-weight: 900; font-size: 13px;">🖱️ MOUSE LOOK</span>
          <span style="color: #94a3b8; font-weight: 700; font-size: 8.5px;">POINTER LOCK (CLICK)</span>
        </div>
      </div>

      <!-- Row 3: Movement (A, S, D) + Practice Reset (B) -->
      <div style="display: flex; gap: 10px; justify-content: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 58px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">A</span>
          <span style="color: #34d399; font-weight: 800; font-size: 9px;">MOVE LEFT</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 58px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">S</span>
          <span style="color: #34d399; font-weight: 800; font-size: 9px;">MOVE BACK</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 58px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">D</span>
          <span style="color: #34d399; font-weight: 800; font-size: 9px;">MOVE RIGHT</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 58px; background: #0f172a; border: 1px solid #f59e0b; border-radius: 8px; box-shadow: 0 0 12px rgba(245,158,11,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 17px;">B</span>
          <span style="color: #fcd34d; font-weight: 800; font-size: 9px;">RESET BALL</span>
        </div>
      </div>

      <!-- Row 4: Modifiers (Shift, C, Space) -->
      <div style="display: flex; gap: 10px; justify-content: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 95px; height: 50px; background: #0f172a; border: 1px solid #38bdf8; border-radius: 8px; box-shadow: 0 0 12px rgba(56,189,248,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 13px;">SHIFT</span>
          <span style="color: #7dd3fc; font-weight: 800; font-size: 8.5px;">SPRINT</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 50px; background: #0f172a; border: 1px solid #38bdf8; border-radius: 8px; box-shadow: 0 0 12px rgba(56,189,248,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 13px;">C</span>
          <span style="color: #7dd3fc; font-weight: 800; font-size: 8.5px;">SLIDE</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 50px; background: #0f172a; border: 1px solid #3b82f6; border-radius: 8px; box-shadow: 0 0 12px rgba(59,130,246,0.35);">
          <span style="color: #ffffff; font-weight: 900; font-size: 13px;">F</span>
          <span style="color: #93c5fd; font-weight: 800; font-size: 8.5px;">CUT</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 200px; height: 50px; background: #0f172a; border: 2px solid #10b981; border-radius: 8px; box-shadow: 0 0 16px rgba(16,185,129,0.45);">
          <span style="color: #ffffff; font-weight: 900; font-size: 14px;">SPACEBAR</span>
          <span style="color: #34d399; font-weight: 800; font-size: 9px;">JUMP (HOLD FOR HEIGHT)</span>
        </div>
      </div>

      <!-- Sub-notice for P2 -->
      <div style="text-align: center; font-size: 10.5px; color: #64748b; font-weight: 600; margin-top: 4px;">
        PLAYER 2 SECONDARY KEYBOARD: <span style="color: #94a3b8;">IJKL (Move) · Enter (Jump) · Slash (Sprint) · O (Slide) · H (Cut) · U (Dive) · P (Volley) · Bracket [ (Spike)</span>
      </div>
    </div>
  `;

  diagramContainer.appendChild(gamepadView);
  diagramContainer.appendChild(keyboardView);
  controlsView.appendChild(diagramContainer);

  // Quick Reference Table Card
  const tableCard = document.createElement('div');
  tableCard.style.cssText = `
    display: flex; flex-direction: column; gap: 7px; background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 10px; padding: 12px 16px; font-size: 11.5px;
  `;

  const rows = [
    { action: 'Move Athlete', pad: 'Left Stick', key: 'WASD · (P2: IJKL)', color: '#10b981' },
    { action: 'Aim Strikes / Look', pad: 'Right Stick', key: 'Mouse Movement · Arrow Keys', color: '#38bdf8' },
    { action: 'Sprint Boost', pad: 'Left Trigger (LT)', key: 'Shift · (P2: Slash /)', color: '#38bdf8' },
    { action: 'Slide Tackle (Hold)', pad: 'Right Trigger (RT)', key: 'C · (P2: O)', color: '#38bdf8' },
    { action: 'Directional Cut / Plant', pad: 'Left Bumper (LB / L1)', key: 'F · (P2: H)', color: '#3b82f6' },
    { action: 'Jump (Hold for Height)', pad: 'A / Cross', key: 'Space · (P2: Enter)', color: '#10b981' },
    { action: 'Ground Dive', pad: 'X / Square', key: 'Q · (P2: U)', color: '#a855f7' },
    { action: 'Volley / Kick Strike', pad: 'B / Circle', key: 'Left-Click · E · (P2: P)', color: '#38bdf8' },
    { action: 'Spike Strike', pad: 'Y / Triangle', key: 'Right-Click · R · (P2: Bracket [)', color: '#f43f5e' },
    { action: 'Reset Ball (Practice)', pad: 'Select / Back / View', key: 'B · (P2: N)', color: '#f59e0b' },
    { action: 'Cycle Camera Angle', pad: 'D-Pad', key: 'Tab · (P2: Backslash \\)', color: '#fbbf24' },
    { action: 'Pause Menu / Settings', pad: 'Start / Options', key: 'Escape', color: '#ef4444' },
  ];

  rows.forEach((r, idx) => {
    const rowEl = document.createElement('div');
    rowEl.style.cssText = `
      display: flex; justify-content: space-between; align-items: center; padding-bottom: 5px;
      ${idx < rows.length - 1 ? 'border-bottom: 1px solid rgba(255, 255, 255, 0.05);' : ''}
    `;
    rowEl.innerHTML = `
      <span style="color: #cbd5e1; font-weight: 700; display: flex; align-items: center; gap: 8px;">
        <span style="width: 7px; height: 7px; border-radius: 50%; background: ${r.color}; box-shadow: 0 0 6px ${r.color};"></span>
        ${r.action}
      </span>
      <div style="display: flex; gap: 14px; font-weight: 700;">
        <span style="color: #ffffff;">${r.pad}</span>
        <span style="color: #64748b;">·</span>
        <span style="color: #ffffff;">${r.key}</span>
      </div>
    `;
    tableCard.appendChild(rowEl);
  });
  controlsView.appendChild(tableCard);
  box.appendChild(controlsView);

  // Sub-tab switcher logic (Gamepad vs Keyboard)
  function setDeviceTab(device) {
    currentControlsDevice = device;
    if (device === 'gamepad') {
      btnSubGamepad.style.background = '#ffffff';
      btnSubGamepad.style.color = '#000000';
      btnSubGamepad.style.borderColor = '#ffffff';
      btnSubKeyboard.style.background = 'transparent';
      btnSubKeyboard.style.color = '#94a3b8';
      btnSubKeyboard.style.borderColor = 'transparent';
      gamepadView.style.display = 'flex';
      keyboardView.style.display = 'none';
    } else {
      btnSubKeyboard.style.background = '#ffffff';
      btnSubKeyboard.style.color = '#000000';
      btnSubKeyboard.style.borderColor = '#ffffff';
      btnSubGamepad.style.background = 'transparent';
      btnSubGamepad.style.color = '#94a3b8';
      btnSubGamepad.style.borderColor = 'transparent';
      gamepadView.style.display = 'none';
      keyboardView.style.display = 'flex';
    }
  }
  btnSubGamepad.onclick = () => setDeviceTab('gamepad');
  btnSubKeyboard.onclick = () => setDeviceTab('keyboard');

  // -------------------------------------------------------------------------
  // VIEW 2: MATCH BASICS VIEW
  // -------------------------------------------------------------------------
  const basicsView = document.createElement('div');
  basicsView.id = 'howto-view-basics';
  basicsView.style.cssText = 'display: none; flex-direction: column; gap: 16px; width: 100%;';
  basicsView.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
      <!-- Card 1: THE ARENA & COURT -->
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 10px; padding: 16px;">
        <div style="font-size: 13px; font-weight: 900; color: #38bdf8; letter-spacing: 0.08em; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
          <span>🏟️</span> THE COURT & ARENA
        </div>
        <div style="font-size: 11.5px; color: #cbd5e1; line-height: 1.6;">
          <p style="margin: 0 0 8px 0;"><strong style="color: #ffffff;">1v1 Sunken Basin:</strong> Two athletes face off across an open arena bordered by high concrete and glass perimeter walls.</p>
          <p style="margin: 0 0 8px 0;"><strong style="color: #ffffff;">The Goal Hoops:</strong> Steel goal hoops sit high on the North and South boundary walls. Driving the ball through the ring awards 1 point.</p>
          <p style="margin: 0;"><strong style="color: #ffffff;">Active Rebounds:</strong> Side ramps and glass backboards are 100% physically live. Rebound bank shots keep rallies moving!</p>
        </div>
      </div>

      <!-- Card 2: RULES & CLOCK -->
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 10px; padding: 16px;">
        <div style="font-size: 13px; font-weight: 900; color: #10b981; letter-spacing: 0.08em; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
          <span>⏱️</span> MATCH RULES & CLOCK
        </div>
        <div style="font-size: 11.5px; color: #cbd5e1; line-height: 1.6;">
          <p style="margin: 0 0 8px 0;"><strong style="color: #ffffff;">5-Minute Regulation:</strong> Standard matches run for 5:00 of live play clock action.</p>
          <p style="margin: 0 0 8px 0;"><strong style="color: #ffffff;">Alternating Targets:</strong> Scoring a goal immediately flips attack ends. You defend the goal just scored on!</p>
          <p style="margin: 0;"><strong style="color: #ffffff;">Golden Goal Overtime:</strong> If scores are level at 0:00, sudden death initiates: next goal wins the match!</p>
        </div>
      </div>
    </div>

    <!-- Full-Width Card: PHYSICAL COMBAT & KNOCKDOWNS -->
    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(244, 63, 94, 0.35); border-radius: 10px; padding: 16px;">
      <div style="font-size: 13px; font-weight: 900; color: #f43f5e; letter-spacing: 0.08em; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
        <span>💥</span> FULL-CONTACT COMBAT & KNOCKDOWNS
      </div>
      <div style="font-size: 11.5px; color: #cbd5e1; line-height: 1.6; display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div>
          <p style="margin: 0 0 6px 0;"><strong style="color: #ffffff;">Slide Tackles:</strong> Sliding at sprint speeds (> 7 m/s) into an opponent sweeps their legs, causing an instant ragdoll knockdown!</p>
          <p style="margin: 0;"><strong style="color: #ffffff;">Physical Bumps:</strong> Colliding with an opposing athlete generates physical momentum impulse and authentic sneaker squeak audio.</p>
        </div>
        <div>
          <p style="margin: 0 0 6px 0;"><strong style="color: #ffffff;">Strike Staggers:</strong> Connecting with a kick, volley, or spike while an opponent is in reach applies physical strike impulse.</p>
          <p style="margin: 0;"><strong style="color: #ffffff;">Heavy Ball Hits:</strong> High-speed projectile balls (> 14 m/s) will knock athletes off their feet if hit in the chest or head!</p>
        </div>
      </div>
    </div>
  `;
  box.appendChild(basicsView);

  // -------------------------------------------------------------------------
  // VIEW 3: SCORING & PRO TIPS VIEW
  // -------------------------------------------------------------------------
  const tipsView = document.createElement('div');
  tipsView.id = 'howto-view-tips';
  tipsView.style.cssText = 'display: none; flex-direction: column; gap: 12px; width: 100%;';
  tipsView.innerHTML = `
    <!-- Tip 1 -->
    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #10b981; border-radius: 8px; padding: 12px 16px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #34d399; margin-bottom: 3px;">1. HOW TO SCORE YOUR FIRST GOAL: VOLLEY THEN SPIKE</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        Don't just chase or run into the ball! Position yourself as the ball approaches. Press <strong style="color: #38bdf8;">Volley (Left-Click / E / B)</strong> to pop the ball upward in a high arc toward the opponent's side. Then, as it reaches its peak, jump and unleash a <strong style="color: #f43f5e;">Spike (Right-Click / R / Y)</strong> to blast it downward into the hoop or off the backboard into the goal!
      </div>
    </div>

    <!-- Tip 2 -->
    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #38bdf8; border-radius: 8px; padding: 12px 16px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #38bdf8; margin-bottom: 3px;">2. JUMP TIMING & SWEET-SPOT CONTACT</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        Strikes hit significantly harder when connected near the center of the strike window! Hold <strong style="color: #ffffff;">Spacebar / A</strong> to jump higher. An aerial spike angled down over the center court net has immense velocity and is nearly impossible for a grounded keeper to stop.
      </div>
    </div>

    <!-- Tip 3 -->
    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #f59e0b; border-radius: 8px; padding: 12px 16px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #fbbf24; margin-bottom: 3px;">3. BANK SHOTS OFF THE SIDE WALLS</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        If your opponent is camping directly in front of the goal hoop, aim at the 45-degree corner ramps or high side walls. The ball will rebound at high velocity across the goal mouth, bypassing the defender entirely.
      </div>
    </div>

    <!-- Tip 4 -->
    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #a855f7; border-radius: 8px; padding: 12px 16px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #c084fc; margin-bottom: 3px;">4. CLUTCH DIVING SAVES & RECOVERY</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        If a spiked ball is dropping fast toward the floor, press <strong style="color: #ffffff;">Q / X</strong> to perform a ground dive! An outstretched dive pops the ball back up into play for a second chance. If you get knocked down, your athlete automatically recovers and stands back up with active physics.
      </div>
    </div>

    <!-- Tip 5 -->
    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #ef4444; border-radius: 8px; padding: 12px 16px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #f87171; margin-bottom: 3px;">5. BALL SIZES & DIFFICULTY</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        • <strong style="color: #ffffff;">Small Ball (0.4m):</strong> Fast, twitchy, heavy physics momentum, hardest difficulty.<br>
        • <strong style="color: #ffffff;">Medium Ball (1.0m):</strong> Standard regulation match ball, balanced flight and bounces.<br>
        • <strong style="color: #ffffff;">Big Ball (1.5m):</strong> Enormous rebound area, easiest difficulty, great for high rallies!
      </div>
    </div>
  `;
  box.appendChild(tipsView);

  // -------------------------------------------------------------------------
  // Main Tab Navigation Logic
  // -------------------------------------------------------------------------
  function setHowToPlayTab(tab) {
    currentHowToPlayTab = tab;
    const tabBtns = [
      { id: 'controls', btn: btnTabControls, view: controlsView },
      { id: 'basics', btn: btnTabBasics, view: basicsView },
      { id: 'tips', btn: btnTabTips, view: tipsView },
    ];

    tabBtns.forEach((item) => {
      const isSel = item.id === tab;
      item.btn.style.background = isSel ? '#ffffff' : 'transparent';
      item.btn.style.borderColor = isSel ? '#ffffff' : 'transparent';
      item.btn.style.color = isSel ? '#000000' : '#94a3b8';
      item.btn.style.boxShadow = isSel ? '0 0 14px rgba(255, 255, 255, 0.45), 0 0 20px rgba(0, 229, 255, 0.25)' : 'none';
      item.view.style.display = isSel ? 'flex' : 'none';
    });
  }

  function cycleHowToPlayTab(direction = 1) {
    const idx = HOWTO_TABS.indexOf(currentHowToPlayTab);
    const nextIdx = (idx + direction + HOWTO_TABS.length) % HOWTO_TABS.length;
    setHowToPlayTab(HOWTO_TABS[nextIdx]);
  }

  btnTabControls.onclick = () => setHowToPlayTab('controls');
  btnTabBasics.onclick = () => setHowToPlayTab('basics');
  btnTabTips.onclick = () => setHowToPlayTab('tips');

  // Close Button
  const closeBtn = document.createElement('button');
  closeBtn.id = 'btn-close-controls';
  closeBtn.textContent = 'CLOSE [ESC / B / SPACE]';
  closeBtn.style.cssText = `
    margin-top: 16px; padding: 12px; font-size: 13px; font-weight: 900; font-family: inherit;
    letter-spacing: 0.1em; color: #ffffff; background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 8px; cursor: pointer; transition: all 0.15s ease;
  `;
  closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(255, 255, 255, 0.2)'; closeBtn.style.borderColor = '#ffffff'; };
  closeBtn.onmouseleave = () => { closeBtn.style.background = 'rgba(255, 255, 255, 0.1)'; closeBtn.style.borderColor = 'rgba(255, 255, 255, 0.25)'; };
  closeBtn.onclick = hideHowToPlayModal;
  box.appendChild(closeBtn);

  controlsModalEl.appendChild(box);
  if (rootContainer) rootContainer.appendChild(controlsModalEl);

  controlsModalEl._setTab = setHowToPlayTab;
  controlsModalEl._setDevice = setDeviceTab;
  controlsModalEl._cycleTab = cycleHowToPlayTab;
}

export function showHowToPlayModal(tab = 'controls') {
  if (controlsModalEl) {
    controlsModalEl.style.display = 'flex';
    if (controlsModalEl._setTab) controlsModalEl._setTab(tab);
  }
}

export function hideHowToPlayModal() {
  if (controlsModalEl) controlsModalEl.style.display = 'none';
}

export const showControlsModal = showHowToPlayModal;
export const hideControlsModal = hideHowToPlayModal;
export const buildControlsModal = buildHowToPlayModal;

export function getControlsModalEl() {
  return controlsModalEl;
}
