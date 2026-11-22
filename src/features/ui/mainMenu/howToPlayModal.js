/**
 * Module: features/ui/mainMenu/howToPlayModal
 * Role: How To Play modal with 3 bespoke input schematics (Standard Gamepad,
 *   Fighting Pad / Arcade Stick, and Keyboard & Mouse P1+P2), current v0.4.2
 *   Match Basics (1v1/2v2, Full Ball-Clearance Hoops, Overtime Agreement,
 *   Replay Director Suite), and Scoring & Pro Tips.
 * Frame Phase: UI Event / Modal Overlay.
 */
import { soundManager } from '../../../audio/soundManager.js';
import { TUNING } from '../../../config/tuning.js';

let rootContainer = null;
let controlsModalEl = null;

const HOWTO_TABS = ['controls', 'basics', 'tips'];
const DEVICE_TABS = ['gamepad', 'fightpad', 'keyboard'];
let currentHowToPlayTab = 'controls';
let currentControlsDevice = 'gamepad';

function renderKeyCap(keyLabel, actionLabel, accent, widthPx = 56, heightPx = 46) {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:${widthPx}px;height:${heightPx}px;background:linear-gradient(180deg,#162033 0%,#0b1220 100%);border:1.5px solid ${accent};border-bottom:3px solid ${accent};border-radius:7px;box-shadow:0 3px 10px rgba(0,0,0,0.45);padding:2px;box-sizing:border-box;">
      <span style="color:#ffffff;font-weight:900;font-size:12px;line-height:1.1;white-space:nowrap;">${keyLabel}</span>
      <span style="color:${accent};font-weight:800;font-size:7.5px;letter-spacing:0.04em;margin-top:2px;white-space:nowrap;">${actionLabel}</span>
    </div>
  `;
}

function buildStandardGamepadSvg() {
  return `
    <svg viewBox="0 0 880 340" style="width: 100%; max-height: 315px; filter: drop-shadow(0 8px 24px rgba(0,0,0,0.65)); font-family: ui-monospace, SFMono-Regular, Consolas, monospace;">
      <defs>
        <linearGradient id="vbPadShell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#243247"/>
          <stop offset="55%" stop-color="#131c2e"/>
          <stop offset="100%" stop-color="#090f1b"/>
        </linearGradient>
        <linearGradient id="vbPadGrip" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1e293b"/>
          <stop offset="100%" stop-color="#0a101d"/>
        </linearGradient>
      </defs>

      <!-- Triggers (back layer) -->
      <path d="M 282 78 C 282 54 328 50 346 66 L 346 88 L 282 88 Z" fill="#0f172a" stroke="#38bdf8" stroke-width="2"/>
      <text x="314" y="74" fill="#7dd3fc" font-size="10" font-weight="900" text-anchor="middle">LT / L2</text>

      <path d="M 598 78 C 598 54 552 50 534 66 L 534 88 L 598 88 Z" fill="#0f172a" stroke="#38bdf8" stroke-width="2"/>
      <text x="566" y="74" fill="#7dd3fc" font-size="10" font-weight="900" text-anchor="middle">RT / R2</text>

      <!-- Bumpers -->
      <rect x="272" y="84" width="84" height="19" rx="9" fill="#1e293b" stroke="#93c5fd" stroke-width="2"/>
      <text x="314" y="97" fill="#dbeafe" font-size="9.5" font-weight="900" text-anchor="middle">LB / L1</text>

      <rect x="524" y="84" width="84" height="19" rx="9" fill="#1e293b" stroke="#3b82f6" stroke-width="2"/>
      <text x="566" y="97" fill="#bfdbfe" font-size="9.5" font-weight="900" text-anchor="middle">RB / R1</text>

      <!-- Ergonomic Controller Body -->
      <path d="M 308 100
               C 262 100 228 122 212 164
               C 194 212 188 268 214 294
               C 236 316 266 302 288 272
               L 322 232
               C 340 226 540 226 558 232
               L 592 272
               C 614 302 644 316 666 294
               C 692 268 686 212 668 164
               C 652 122 618 100 572 100
               Z"
            fill="url(#vbPadShell)" stroke="#475569" stroke-width="2.5"/>

      <!-- Inner contoured grip sheen -->
      <path d="M 244 205 C 224 236 220 270 236 284 C 248 294 264 282 278 262" fill="none" stroke="rgba(148,163,184,0.18)" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M 636 205 C 656 236 660 270 644 284 C 632 294 616 282 602 262" fill="none" stroke="rgba(148,163,184,0.18)" stroke-width="2.5" stroke-linecap="round"/>

      <!-- Center System Strip -->
      <rect x="386" y="122" width="108" height="34" rx="17" fill="#0b1220" stroke="#334155" stroke-width="1.5"/>
      <circle cx="410" cy="139" r="9" fill="#1e293b" stroke="#f59e0b" stroke-width="2"/>
      <rect x="406" y="136" width="8" height="6" rx="1.5" fill="none" stroke="#fcd34d" stroke-width="1.2"/>
      <circle cx="470" cy="139" r="9" fill="#1e293b" stroke="#f43f5e" stroke-width="2"/>
      <path d="M 466 135 H 474 M 466 139 H 474 M 466 143 H 474" stroke="#fda4af" stroke-width="1.4"/>
      <circle cx="440" cy="139" r="7" fill="rgba(0,229,255,0.15)" stroke="#00e5ff" stroke-width="1.4"/>

      <!-- Left Analog Stick -->
      <circle cx="304" cy="158" r="27" fill="#090f1d" stroke="#10b981" stroke-width="2.2"/>
      <circle cx="304" cy="158" r="16" fill="#1e293b" stroke="#34d399" stroke-width="1.5"/>
      <text x="304" y="162" fill="#a7f3d0" font-size="11" font-weight="900" text-anchor="middle">LS</text>

      <!-- D-Pad -->
      <path d="M 358 182 H 374 V 198 H 390 V 214 H 374 V 230 H 358 V 214 H 342 V 198 H 358 Z"
            fill="#162033" stroke="#fbbf24" stroke-width="2"/>
      <circle cx="366" cy="206" r="4" fill="#090f1d"/>

      <!-- Right Analog Stick -->
      <circle cx="514" cy="204" r="27" fill="#090f1d" stroke="#00e5ff" stroke-width="2.2"/>
      <circle cx="514" cy="204" r="16" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5"/>
      <text x="514" y="208" fill="#bae6fd" font-size="11" font-weight="900" text-anchor="middle">RS</text>

      <!-- Face Button Diamond -->
      <circle cx="576" cy="158" r="42" fill="rgba(9,15,29,0.55)" stroke="rgba(148,163,184,0.22)" stroke-width="1.2"/>
      <!-- North: Y / Triangle -->
      <circle cx="576" cy="128" r="14" fill="#1e293b" stroke="#f43f5e" stroke-width="2.2"/>
      <text x="576" y="132" fill="#fda4af" font-size="9.5" font-weight="900" text-anchor="middle">Y/△</text>
      <!-- East: B / Circle -->
      <circle cx="606" cy="158" r="14" fill="#1e293b" stroke="#38bdf8" stroke-width="2.2"/>
      <text x="606" y="162" fill="#bae6fd" font-size="9.5" font-weight="900" text-anchor="middle">B/○</text>
      <!-- South: A / Cross -->
      <circle cx="576" cy="188" r="14" fill="#1e293b" stroke="#10b981" stroke-width="2.2"/>
      <text x="576" y="192" fill="#a7f3d0" font-size="9.5" font-weight="900" text-anchor="middle">A/✕</text>
      <!-- West: X / Square -->
      <circle cx="546" cy="158" r="14" fill="#1e293b" stroke="#a855f7" stroke-width="2.2"/>
      <text x="546" y="162" fill="#e9d5ff" font-size="9.5" font-weight="900" text-anchor="middle">X/□</text>

      <!-- LEFT SIDE CALLOUTS (clean orthogonal lines, zero crossings) -->
      <polyline points="282,68 188,68" fill="none" stroke="#38bdf8" stroke-width="1.6"/>
      <rect x="14" y="50" width="174" height="36" rx="6" fill="rgba(56,189,248,0.14)" stroke="#38bdf8" stroke-width="1.2"/>
      <text x="101" y="65" fill="#ffffff" font-size="10.5" font-weight="900" text-anchor="middle">LT / L2 · SPRINT</text>
      <text x="101" y="79" fill="#7dd3fc" font-size="8.5" font-weight="700" text-anchor="middle">HOLD FOR TOP SPEED</text>

      <polyline points="272,94 218,94 188,118" fill="none" stroke="#93c5fd" stroke-width="1.6"/>
      <rect x="14" y="100" width="174" height="36" rx="6" fill="rgba(147,197,253,0.14)" stroke="#93c5fd" stroke-width="1.2"/>
      <text x="101" y="115" fill="#ffffff" font-size="10.5" font-weight="900" text-anchor="middle">LB / L1 · AGILE BRACE</text>
      <text x="101" y="129" fill="#bfdbfe" font-size="8.5" font-weight="700" text-anchor="middle">HOLD TO BLOCK / REDIRECT</text>

      <polyline points="277,158 188,168" fill="none" stroke="#10b981" stroke-width="1.6"/>
      <rect x="14" y="150" width="174" height="36" rx="6" fill="rgba(16,185,129,0.14)" stroke="#10b981" stroke-width="1.2"/>
      <text x="101" y="165" fill="#ffffff" font-size="10.5" font-weight="900" text-anchor="middle">L-STICK · MOVE</text>
      <text x="101" y="179" fill="#6ee7b7" font-size="8.5" font-weight="700" text-anchor="middle">360° COURT MOVEMENT</text>

      <polyline points="342,206 232,206 188,242" fill="none" stroke="#fbbf24" stroke-width="1.6"/>
      <rect x="14" y="224" width="174" height="38" rx="6" fill="rgba(251,191,36,0.14)" stroke="#fbbf24" stroke-width="1.2"/>
      <text x="101" y="240" fill="#ffffff" font-size="10.5" font-weight="900" text-anchor="middle">D-PAD · CYCLE CAMERA</text>
      <text x="101" y="254" fill="#fde68a" font-size="8.5" font-weight="700" text-anchor="middle">◀▶ PLAYER · ↕ ARENA VIEW</text>

      <!-- TOP CENTER CALLOUTS -->
      <polyline points="410,130 410,42 382,42" fill="none" stroke="#f59e0b" stroke-width="1.5"/>
      <rect x="206" y="8" width="184" height="34" rx="6" fill="rgba(245,158,11,0.14)" stroke="#f59e0b" stroke-width="1.2"/>
      <text x="298" y="22" fill="#ffffff" font-size="10" font-weight="900" text-anchor="middle">SELECT / VIEW</text>
      <text x="298" y="35" fill="#fcd34d" font-size="8.5" font-weight="700" text-anchor="middle">SELF-TOSS BALL (PRACTICE)</text>

      <polyline points="470,130 470,42 498,42" fill="none" stroke="#f43f5e" stroke-width="1.5"/>
      <rect x="490" y="8" width="184" height="34" rx="6" fill="rgba(244,63,94,0.14)" stroke="#f43f5e" stroke-width="1.2"/>
      <text x="582" y="22" fill="#ffffff" font-size="10" font-weight="900" text-anchor="middle">START / OPTIONS</text>
      <text x="582" y="35" fill="#fda4af" font-size="8.5" font-weight="700" text-anchor="middle">PAUSE MENU &amp; SETTINGS</text>

      <!-- RIGHT SIDE CALLOUTS -->
      <polyline points="598,68 692,68" fill="none" stroke="#38bdf8" stroke-width="1.6"/>
      <rect x="692" y="50" width="174" height="36" rx="6" fill="rgba(56,189,248,0.14)" stroke="#38bdf8" stroke-width="1.2"/>
      <text x="779" y="65" fill="#ffffff" font-size="10.5" font-weight="900" text-anchor="middle">RT / R2 · SLIDE</text>
      <text x="779" y="79" fill="#7dd3fc" font-size="8.5" font-weight="700" text-anchor="middle">HOLD TO SLIDE TACKLE</text>

      <polyline points="608,94 662,94 692,108" fill="none" stroke="#3b82f6" stroke-width="1.6"/>
      <rect x="692" y="92" width="174" height="34" rx="6" fill="rgba(59,130,246,0.14)" stroke="#3b82f6" stroke-width="1.2"/>
      <text x="779" y="106" fill="#ffffff" font-size="10.5" font-weight="900" text-anchor="middle">RB / R1 · CUT / PLANT</text>
      <text x="779" y="119" fill="#93c5fd" font-size="8.5" font-weight="700" text-anchor="middle">SHARP DIRECTIONAL PIVOT</text>

      <polyline points="590,128 656,128 692,148" fill="none" stroke="#f43f5e" stroke-width="1.6"/>
      <rect x="692" y="132" width="174" height="34" rx="6" fill="rgba(244,63,94,0.14)" stroke="#f43f5e" stroke-width="1.2"/>
      <text x="779" y="146" fill="#ffffff" font-size="10.5" font-weight="900" text-anchor="middle">Y / △ · SPIKE</text>
      <text x="779" y="159" fill="#fda4af" font-size="8.5" font-weight="700" text-anchor="middle">DOWNWARD POWER SHOT</text>

      <polyline points="620,158 656,158 692,188" fill="none" stroke="#38bdf8" stroke-width="1.6"/>
      <rect x="692" y="172" width="174" height="34" rx="6" fill="rgba(56,189,248,0.14)" stroke="#38bdf8" stroke-width="1.2"/>
      <text x="779" y="186" fill="#ffffff" font-size="10.5" font-weight="900" text-anchor="middle">B / ○ · VOLLEY / KICK</text>
      <text x="779" y="199" fill="#bae6fd" font-size="8.5" font-weight="700" text-anchor="middle">LIFT ARC OR PASS SHOT</text>

      <polyline points="546,172 546,246 692,228" fill="none" stroke="#a855f7" stroke-width="1.6"/>
      <rect x="692" y="212" width="174" height="34" rx="6" fill="rgba(168,85,247,0.14)" stroke="#a855f7" stroke-width="1.2"/>
      <text x="779" y="226" fill="#ffffff" font-size="10.5" font-weight="900" text-anchor="middle">X / □ · DIVE</text>
      <text x="779" y="239" fill="#e9d5ff" font-size="8.5" font-weight="700" text-anchor="middle">LUNGE SAVE (+LB = LOW)</text>

      <polyline points="576,202 642,268 692,268" fill="none" stroke="#10b981" stroke-width="1.6"/>
      <rect x="692" y="252" width="174" height="34" rx="6" fill="rgba(16,185,129,0.14)" stroke="#10b981" stroke-width="1.2"/>
      <text x="779" y="266" fill="#ffffff" font-size="10.5" font-weight="900" text-anchor="middle">A / ✕ · JUMP</text>
      <text x="779" y="279" fill="#a7f3d0" font-size="8.5" font-weight="700" text-anchor="middle">LEAP FOR AERIAL STRIKES</text>

      <!-- BOTTOM RIGHT STICK CALLOUT -->
      <polyline points="514,231 514,294" fill="none" stroke="#00e5ff" stroke-width="1.6"/>
      <rect x="378" y="294" width="272" height="36" rx="6" fill="rgba(0,229,255,0.14)" stroke="#00e5ff" stroke-width="1.2"/>
      <text x="514" y="309" fill="#ffffff" font-size="10.5" font-weight="900" text-anchor="middle">R-STICK · ORBIT CAMERA</text>
      <text x="514" y="323" fill="#7dd3fc" font-size="8.5" font-weight="700" text-anchor="middle">AIM CHASE &amp; 1ST-PERSON VIEWS</text>
    </svg>
  `;
}

function buildFightPadSvg() {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;">
      <svg viewBox="0 0 880 310" style="width: 100%; max-height: 280px; filter: drop-shadow(0 8px 24px rgba(0,0,0,0.65)); font-family: ui-monospace, SFMono-Regular, Consolas, monospace;">
        <defs>
          <linearGradient id="vbDeckGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#090f1d"/>
          </linearGradient>
          <radialGradient id="vbBallTop" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stop-color="#6ee7b7"/>
            <stop offset="55%" stop-color="#10b981"/>
            <stop offset="100%" stop-color="#065f46"/>
          </radialGradient>
        </defs>

        <!-- Arcade Fightstick / 8-Button Fightpad Deck -->
        <rect x="60" y="42" width="760" height="240" rx="22" fill="url(#vbDeckGrad)" stroke="#475569" stroke-width="2.5"/>
        <rect x="74" y="54" width="732" height="216" rx="16" fill="none" stroke="rgba(251,180,23,0.28)" stroke-width="1.5"/>

        <!-- Top Utility Bar -->
        <rect x="295" y="14" width="136" height="32" rx="6" fill="rgba(251,191,36,0.16)" stroke="#fbbf24" stroke-width="1.4"/>
        <text x="363" y="28" fill="#ffffff" font-size="9.5" font-weight="900" text-anchor="middle">SELECT / BACK</text>
        <text x="363" y="40" fill="#fde68a" font-size="8" font-weight="800" text-anchor="middle">CAM CYCLE · TOSS</text>
        <line x1="363" y1="46" x2="363" y2="72" stroke="#fbbf24" stroke-width="1.5"/>
        <circle cx="363" cy="76" r="9" fill="#0f172a" stroke="#fbbf24" stroke-width="2"/>

        <rect x="449" y="14" width="136" height="32" rx="6" fill="rgba(244,63,94,0.16)" stroke="#f43f5e" stroke-width="1.4"/>
        <text x="517" y="28" fill="#ffffff" font-size="9.5" font-weight="900" text-anchor="middle">START / OPTIONS</text>
        <text x="517" y="40" fill="#fda4af" font-size="8" font-weight="800" text-anchor="middle">PAUSE MENU</text>
        <line x1="517" y1="46" x2="517" y2="72" stroke="#f43f5e" stroke-width="1.5"/>
        <circle cx="517" cy="76" r="9" fill="#0f172a" stroke="#f43f5e" stroke-width="2"/>

        <!-- Left Side: Arcade Lever / D-Pad 8-Way Movement -->
        <circle cx="210" cy="166" r="68" fill="#0b1220" stroke="#10b981" stroke-width="2"/>
        <!-- 8-Way Directional Arrows -->
        <path d="M 210 106 L 218 119 H 202 Z" fill="#34d399"/>
        <path d="M 210 226 L 218 213 H 202 Z" fill="#34d399"/>
        <path d="M 150 166 L 163 158 V 174 Z" fill="#34d399"/>
        <path d="M 270 166 L 257 158 V 174 Z" fill="#34d399"/>
        <!-- Dust washer + Ball top -->
        <circle cx="210" cy="166" r="34" fill="#162033" stroke="#334155" stroke-width="2"/>
        <circle cx="210" cy="166" r="22" fill="url(#vbBallTop)" stroke="#a7f3d0" stroke-width="1.5"/>
        <text x="210" y="252" fill="#6ee7b7" font-size="11" font-weight="900" text-anchor="middle">D-PAD / LEVER · 8-WAY MOVE</text>

        <!-- Right Side: Iconic 2x4 Vewlix Arcade Button Bank -->
        <!-- TOP ROW: X/Sq (Dive), Y/Tri (Spike), RB/R1 (Cut), LB/L1 (Brace) -->
        <g transform="translate(390,136)">
          <circle cx="0" cy="0" r="32" fill="#0b1220" stroke="#a855f7" stroke-width="2.5"/>
          <text x="0" y="-4" fill="#e9d5ff" font-size="11" font-weight="900" text-anchor="middle">X / □</text>
          <text x="0" y="11" fill="#ffffff" font-size="9.5" font-weight="900" text-anchor="middle">DIVE</text>
        </g>
        <g transform="translate(474,122)">
          <circle cx="0" cy="0" r="32" fill="#0b1220" stroke="#f43f5e" stroke-width="2.5"/>
          <text x="0" y="-4" fill="#fda4af" font-size="11" font-weight="900" text-anchor="middle">Y / △</text>
          <text x="0" y="11" fill="#ffffff" font-size="9.5" font-weight="900" text-anchor="middle">SPIKE</text>
        </g>
        <g transform="translate(558,122)">
          <circle cx="0" cy="0" r="32" fill="#0b1220" stroke="#3b82f6" stroke-width="2.5"/>
          <text x="0" y="-4" fill="#93c5fd" font-size="11" font-weight="900" text-anchor="middle">RB / R1</text>
          <text x="0" y="11" fill="#ffffff" font-size="9.5" font-weight="900" text-anchor="middle">CUT</text>
        </g>
        <g transform="translate(642,130)">
          <circle cx="0" cy="0" r="32" fill="#0b1220" stroke="#93c5fd" stroke-width="2.5"/>
          <text x="0" y="-4" fill="#dbeafe" font-size="11" font-weight="900" text-anchor="middle">LB / L1</text>
          <text x="0" y="11" fill="#ffffff" font-size="9.5" font-weight="900" text-anchor="middle">BRACE</text>
        </g>

        <!-- BOTTOM ROW: A/X (Jump), B/O (Volley), RT/R2 (Slide), LT/L2 (Sprint) -->
        <g transform="translate(390,214)">
          <circle cx="0" cy="0" r="32" fill="#0b1220" stroke="#10b981" stroke-width="2.5"/>
          <text x="0" y="-4" fill="#a7f3d0" font-size="11" font-weight="900" text-anchor="middle">A / ✕</text>
          <text x="0" y="11" fill="#ffffff" font-size="9.5" font-weight="900" text-anchor="middle">JUMP</text>
        </g>
        <g transform="translate(474,200)">
          <circle cx="0" cy="0" r="32" fill="#0b1220" stroke="#38bdf8" stroke-width="2.5"/>
          <text x="0" y="-4" fill="#bae6fd" font-size="11" font-weight="900" text-anchor="middle">B / ○</text>
          <text x="0" y="11" fill="#ffffff" font-size="9.5" font-weight="900" text-anchor="middle">VOLLEY</text>
        </g>
        <g transform="translate(558,200)">
          <circle cx="0" cy="0" r="32" fill="#0b1220" stroke="#00e5ff" stroke-width="2.5"/>
          <text x="0" y="-4" fill="#7dd3fc" font-size="11" font-weight="900" text-anchor="middle">RT / R2</text>
          <text x="0" y="11" fill="#ffffff" font-size="9.5" font-weight="900" text-anchor="middle">SLIDE</text>
        </g>
        <g transform="translate(642,208)">
          <circle cx="0" cy="0" r="32" fill="#0b1220" stroke="#38bdf8" stroke-width="2.5"/>
          <text x="0" y="-4" fill="#7dd3fc" font-size="11" font-weight="900" text-anchor="middle">LT / L2</text>
          <text x="0" y="11" fill="#ffffff" font-size="9.5" font-weight="900" text-anchor="middle">SPRINT</text>
        </g>

        <text x="516" y="258" fill="#cbd5e1" font-size="10" font-weight="800" text-anchor="middle">6-BUTTON PADS: USE TOP &amp; BOTTOM 3 COLUMNS + SHOULDER TRIGGERS</text>
      </svg>
      <div style="width:100%;max-width:760px;padding:8px 14px;border-radius:8px;background:rgba(251,180,23,0.12);border:1px solid rgba(251,180,23,0.4);color:#fde68a;font-size:11px;font-weight:700;text-align:center;">
        Auto-detected for arcade sticks, fightpads, and leverless controllers. Press <b style="color:#ffffff;">LB / RB</b> on Pick Sides to toggle Fight Pad (D-Pad Movement) on any controller.
      </div>
    </div>
  `;
}

function buildKeyboardViewHtml() {
  return `
    <div style="display:grid;grid-template-columns:1.15fr 1fr;gap:12px;width:100%;box-sizing:border-box;">
      <!-- PLAYER 1: WASD + MOUSE -->
      <div style="background:rgba(15,23,42,0.72);border:1.5px solid rgba(0,229,255,0.4);border-top:3px solid #00e5ff;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;font-weight:900;letter-spacing:0.08em;color:#00e5ff;">PLAYER 1 · WASD + MOUSE</span>
          <span style="font-size:9.5px;font-weight:700;color:#94a3b8;">CLICK COURT TO LOCK MOUSE</span>
        </div>
        <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;">
          <div style="display:flex;flex-direction:column;gap:5px;">
            <!-- Row 1: Esc, Tab -->
            <div style="display:flex;gap:5px;">
              ${renderKeyCap('ESC', 'PAUSE', '#f43f5e', 54, 40)}
              ${renderKeyCap('TAB', 'CAMERA', '#fbbf24', 58, 40)}
              ${renderKeyCap('B', 'TOSS', '#f59e0b', 50, 40)}
            </div>
            <!-- Row 2: Q W E R -->
            <div style="display:flex;gap:5px;padding-left:6px;">
              ${renderKeyCap('Q', 'DIVE', '#a855f7', 50, 44)}
              ${renderKeyCap('W', 'FWD', '#10b981', 50, 44)}
              ${renderKeyCap('E', 'VOLLEY', '#38bdf8', 50, 44)}
              ${renderKeyCap('R', 'SPIKE', '#f43f5e', 50, 44)}
            </div>
            <!-- Row 3: A S D F G -->
            <div style="display:flex;gap:5px;padding-left:14px;">
              ${renderKeyCap('A', 'LEFT', '#10b981', 50, 44)}
              ${renderKeyCap('S', 'BACK', '#10b981', 50, 44)}
              ${renderKeyCap('D', 'RIGHT', '#10b981', 50, 44)}
              ${renderKeyCap('F / V', 'CUT', '#3b82f6', 50, 44)}
              ${renderKeyCap('G', 'BRACE', '#93c5fd', 50, 44)}
            </div>
            <!-- Row 4: Shift, C, Space -->
            <div style="display:flex;gap:5px;">
              ${renderKeyCap('SHIFT', 'SPRINT', '#38bdf8', 74, 42)}
              ${renderKeyCap('C', 'SLIDE', '#00e5ff', 50, 42)}
              ${renderKeyCap('SPACEBAR', 'JUMP', '#10b981', 148, 42)}
            </div>
          </div>

          <!-- Mouse SVG -->
          <svg viewBox="0 0 116 176" style="width:104px;flex-shrink:0;">
            <rect x="16" y="10" width="84" height="148" rx="40" fill="#0f172a" stroke="#475569" stroke-width="2"/>
            <path d="M 16 66 V 48 C 16 26 32 10 56 10 V 66 Z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.6"/>
            <path d="M 60 10 C 84 10 100 26 100 48 V 66 H 60 Z" fill="rgba(244,63,94,0.22)" stroke="#f43f5e" stroke-width="1.6"/>
            <rect x="53" y="28" width="10" height="24" rx="5" fill="#1e293b" stroke="#94a3b8" stroke-width="1.2"/>
            <text x="36" y="42" fill="#bae6fd" font-size="8.5" font-weight="900" text-anchor="middle">LMB</text>
            <text x="36" y="54" fill="#ffffff" font-size="7.5" font-weight="800" text-anchor="middle">VOLLEY</text>
            <text x="80" y="42" fill="#fda4af" font-size="8.5" font-weight="900" text-anchor="middle">RMB</text>
            <text x="80" y="54" fill="#ffffff" font-size="7.5" font-weight="800" text-anchor="middle">SPIKE</text>
            <text x="58" y="104" fill="#00e5ff" font-size="9" font-weight="900" text-anchor="middle">MOVE MOUSE</text>
            <text x="58" y="118" fill="#cbd5e1" font-size="8" font-weight="700" text-anchor="middle">CAMERA LOOK</text>
            <path d="M 42 134 L 34 134 M 74 134 L 82 134 M 58 124 L 58 144" stroke="#00e5ff" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
      </div>

      <!-- PLAYER 2: IJKL + ARROWS -->
      <div style="background:rgba(15,23,42,0.72);border:1.5px solid rgba(255,46,85,0.4);border-top:3px solid #ff2e55;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;font-weight:900;letter-spacing:0.08em;color:#ff2e55;">PLAYER 2 · IJKL + ARROWS</span>
          <span style="font-size:9.5px;font-weight:700;color:#94a3b8;">SHARED KEYBOARD</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <!-- Row 1: U I O P [ -->
          <div style="display:flex;gap:5px;">
            ${renderKeyCap('U', 'DIVE', '#a855f7', 50, 44)}
            ${renderKeyCap('I', 'FWD', '#10b981', 50, 44)}
            ${renderKeyCap('O', 'SLIDE', '#00e5ff', 50, 44)}
            ${renderKeyCap('P', 'VOLLEY', '#38bdf8', 50, 44)}
            ${renderKeyCap('[', 'SPIKE', '#f43f5e', 48, 44)}
            ${renderKeyCap(']', 'CAM', '#fbbf24', 48, 44)}
          </div>
          <!-- Row 2: H J K L ENTER -->
          <div style="display:flex;gap:5px;padding-left:6px;">
            ${renderKeyCap('H', 'BRACE', '#93c5fd', 50, 44)}
            ${renderKeyCap('J', 'LEFT', '#10b981', 50, 44)}
            ${renderKeyCap('K', 'BACK', '#10b981', 50, 44)}
            ${renderKeyCap('L', 'RIGHT', '#10b981', 50, 44)}
            ${renderKeyCap('ENTER', 'JUMP', '#10b981', 96, 44)}
          </div>
          <!-- Row 3: N M / R-SHIFT -->
          <div style="display:flex;gap:5px;padding-left:14px;">
            ${renderKeyCap('N', 'CUT', '#3b82f6', 50, 42)}
            ${renderKeyCap('M', 'TOSS', '#f59e0b', 50, 42)}
            ${renderKeyCap('/ · R-SHFT', 'SPRINT', '#38bdf8', 96, 42)}
            ${renderKeyCap('ARROWS', 'CAM LOOK', '#00e5ff', 92, 42)}
          </div>
        </div>
        <div style="font-size:9.5px;color:#94a3b8;line-height:1.4;margin-top:2px;">
          Assign Keyboard 2 (IJKL) to Team 2 on Pick Sides for instant 2-player play on one keyboard.
        </div>
      </div>
    </div>
  `;
}

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
    background: rgba(4, 7, 12, 0.90);
    backdrop-filter: blur(12px);
    pointer-events: auto;
    z-index: 1000;
  `;

  const box = document.createElement('div');
  box.style.cssText = `
    display: flex;
    flex-direction: column;
    max-width: 960px;
    width: 94%;
    max-height: 92vh;
    overflow-y: auto;
    background: rgba(11, 17, 26, 0.98);
    border: 1px solid rgba(120, 170, 210, 0.35);
    border-radius: 14px;
    padding: 20px 26px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.9), 0 0 30px rgba(56, 189, 248, 0.15);
    font-family: inherit;
    box-sizing: border-box;
  `;

  // Header & 3-Tab Navigation
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid;
    border-image: linear-gradient(90deg, #ff2e55, #ff6b35, #fbb417, #4ade80, #00e5ff, #3b82f6, #a855f7) 1;
    padding-bottom: 12px;
    margin-bottom: 14px;
    flex-wrap: wrap;
    gap: 12px;
  `;

  const titleGroup = document.createElement('div');
  titleGroup.innerHTML = `
    <div style="font-size: 20px; font-weight: 900; letter-spacing: 0.1em; display: flex; align-items: baseline; gap: 8px;">
      <span style="background: linear-gradient(90deg, #ff2e55 0%, #ff6b35 20%, #fbb417 40%, #4ade80 60%, #00e5ff 80%, #a855f7 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">VALLEYBALL</span>
      <span style="color: #ffffff;">HOW TO PLAY</span>
    </div>
    <div style="font-size: 10.5px; color: #94a3b8; font-weight: 700; letter-spacing: 0.08em; margin-top: 2px;">LB / RB SWITCHES SECTION · ◀ ▶ SWITCHES INPUT DIAGRAM</div>
  `;

  const mainTabGroup = document.createElement('div');
  mainTabGroup.style.cssText = 'display: flex; gap: 6px; background: rgba(0, 0, 0, 0.4); padding: 4px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);';

  const btnTabControls = document.createElement('button');
  btnTabControls.id = 'tab-howto-controls';
  btnTabControls.textContent = '🎮 CONTROLS';

  const btnTabBasics = document.createElement('button');
  btnTabBasics.id = 'tab-howto-basics';
  btnTabBasics.textContent = '📋 MATCH RULES';

  const btnTabTips = document.createElement('button');
  btnTabTips.id = 'tab-howto-tips';
  btnTabTips.textContent = '🎯 PRO TIPS';

  [btnTabControls, btnTabBasics, btnTabTips].forEach((btn) => {
    btn.style.cssText = `
      padding: 8px 14px;
      font-size: 11.5px;
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
  // VIEW 1: CONTROLS VIEW (3 Dedicated Input Schematics + Quick Reference)
  // -------------------------------------------------------------------------
  const controlsView = document.createElement('div');
  controlsView.id = 'howto-view-controls';
  controlsView.style.cssText = 'display: flex; flex-direction: column; width: 100%; gap: 12px;';

  const subTabContainer = document.createElement('div');
  subTabContainer.style.cssText = 'display: flex; justify-content: center;';
  const subTabGroup = document.createElement('div');
  subTabGroup.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; background: rgba(255,255,255,0.05); padding: 4px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12);';

  const makeSubBtn = (id, label) => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = label;
    b.style.cssText = `
      padding: 6px 14px; font-size: 11px; font-weight: 800; font-family: inherit;
      color: #94a3b8; background: transparent; border: 1px solid transparent; border-radius: 5px; cursor: pointer;
      transition: all 0.12s ease;
    `;
    return b;
  };

  const btnSubGamepad = makeSubBtn('subtab-controls-gamepad', '🎮 STANDARD GAMEPAD');
  const btnSubFightpad = makeSubBtn('subtab-controls-fightpad', '🕹️ FIGHTING PAD / STICK');
  const btnSubKeyboard = makeSubBtn('subtab-controls-keyboard', '⌨️ KEYBOARD & MOUSE');

  subTabGroup.append(btnSubGamepad, btnSubFightpad, btnSubKeyboard);
  subTabContainer.appendChild(subTabGroup);
  controlsView.appendChild(subTabContainer);

  const diagramContainer = document.createElement('div');
  diagramContainer.style.cssText = 'display: flex; flex-direction: column; align-items: center; width: 100%;';

  const gamepadView = document.createElement('div');
  gamepadView.id = 'controls-view-gamepad';
  gamepadView.style.cssText = 'width: 100%; display: flex; justify-content: center;';
  gamepadView.innerHTML = buildStandardGamepadSvg();

  const fightpadView = document.createElement('div');
  fightpadView.id = 'controls-view-fightpad';
  fightpadView.style.cssText = 'width: 100%; display: none; justify-content: center;';
  fightpadView.innerHTML = buildFightPadSvg();

  const keyboardView = document.createElement('div');
  keyboardView.id = 'controls-view-keyboard';
  keyboardView.style.cssText = 'width: 100%; display: none; flex-direction: column; align-items: center;';
  keyboardView.innerHTML = buildKeyboardViewHtml();

  diagramContainer.append(gamepadView, fightpadView, keyboardView);
  controlsView.appendChild(diagramContainer);

  // 3-Column Quick Reference Table
  const tableCard = document.createElement('div');
  tableCard.style.cssText = `
    display: flex; flex-direction: column; gap: 5px; background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 10px; padding: 10px 14px; font-size: 11px;
  `;

  const headRow = document.createElement('div');
  headRow.style.cssText = 'display:grid;grid-template-columns:1.15fr 1fr 1fr 1.35fr;gap:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.14);font-size:9.5px;font-weight:900;letter-spacing:0.08em;color:#64748b;';
  headRow.innerHTML = '<span>ACTION</span><span>GAMEPAD</span><span>FIGHT PAD</span><span>KEYBOARD (P1 / P2)</span>';
  tableCard.appendChild(headRow);

  const rows = [
    { action: 'Move Athlete', pad: 'Left Stick', fight: 'D-Pad / Lever', key: 'WASD / IJKL', color: '#10b981' },
    { action: 'Orbit Camera', pad: 'Right Stick', fight: 'Auto-Track / Cam', key: 'Mouse / Arrows', color: '#00e5ff' },
    { action: 'Jump', pad: 'A / Cross', fight: 'A / Cross', key: 'Space / Enter', color: '#10b981' },
    { action: 'Volley / Kick', pad: 'B / Circle', fight: 'B / Circle', key: 'L-Click, E / P', color: '#38bdf8' },
    { action: 'Spike Shot', pad: 'Y / Triangle', fight: 'Y / Triangle', key: 'R-Click, R / [', color: '#f43f5e' },
    { action: 'Ground Dive', pad: 'X / Square', fight: 'X / Square', key: 'Q / U', color: '#a855f7' },
    { action: 'Sprint (Hold)', pad: 'LT / L2', fight: 'LT / L2', key: 'L-Shift / Slash', color: '#38bdf8' },
    { action: 'Slide Tackle (Hold)', pad: 'RT / R2', fight: 'RT / R2', key: 'C / O', color: '#00e5ff' },
    { action: 'Directional Cut', pad: 'RB / R1', fight: 'RB / R1', key: 'F, V / N', color: '#3b82f6' },
    { action: 'Agile Brace (Hold)', pad: 'LB / L1', fight: 'LB / L1', key: 'G / H', color: '#93c5fd' },
    { action: 'Cycle Camera', pad: 'D-Pad', fight: 'Select (Match)', key: 'Tab / ] Key', color: '#fbbf24' },
    { action: 'Self-Toss (Practice)', pad: 'Select / View', fight: 'Select (Practice)', key: 'B / M', color: '#f59e0b' },
    { action: 'Pause / Settings', pad: 'Start / Options', fight: 'Start / Options', key: 'Escape', color: '#ef4444' },
  ];

  rows.forEach((r, idx) => {
    const rowEl = document.createElement('div');
    rowEl.style.cssText = `
      display: grid; grid-template-columns: 1.15fr 1fr 1fr 1.35fr; gap: 8px; align-items: center; padding-bottom: 4px;
      ${idx < rows.length - 1 ? 'border-bottom: 1px solid rgba(255, 255, 255, 0.05);' : ''}
    `;
    rowEl.innerHTML = `
      <span style="color: #e2e8f0; font-weight: 800; display: flex; align-items: center; gap: 7px;">
        <span style="width: 7px; height: 7px; border-radius: 50%; background: ${r.color}; box-shadow: 0 0 6px ${r.color}; flex-shrink: 0;"></span>
        ${r.action}
      </span>
      <span style="color: #ffffff; font-weight: 700;">${r.pad}</span>
      <span style="color: #fde68a; font-weight: 700;">${r.fight}</span>
      <span style="color: #bae6fd; font-weight: 700;">${r.key}</span>
    `;
    tableCard.appendChild(rowEl);
  });
  controlsView.appendChild(tableCard);
  box.appendChild(controlsView);

  function setDeviceTab(device) {
    currentControlsDevice = DEVICE_TABS.includes(device) ? device : 'gamepad';
    const items = [
      { id: 'gamepad', btn: btnSubGamepad, view: gamepadView, display: 'flex' },
      { id: 'fightpad', btn: btnSubFightpad, view: fightpadView, display: 'flex' },
      { id: 'keyboard', btn: btnSubKeyboard, view: keyboardView, display: 'flex' },
    ];
    items.forEach((item) => {
      const sel = item.id === currentControlsDevice;
      item.btn.style.background = sel ? '#ffffff' : 'transparent';
      item.btn.style.color = sel ? '#000000' : '#94a3b8';
      item.btn.style.borderColor = sel ? '#ffffff' : 'transparent';
      item.view.style.display = sel ? item.display : 'none';
    });
  }
  btnSubGamepad.onclick = () => setDeviceTab('gamepad');
  btnSubFightpad.onclick = () => setDeviceTab('fightpad');
  btnSubKeyboard.onclick = () => setDeviceTab('keyboard');
  setDeviceTab('gamepad');

  // -------------------------------------------------------------------------
  // VIEW 2: MATCH RULES VIEW
  // -------------------------------------------------------------------------
  const basicsView = document.createElement('div');
  basicsView.id = 'howto-view-basics';
  basicsView.style.cssText = 'display: none; flex-direction: column; gap: 14px; width: 100%;';
  basicsView.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
      <!-- Card 1: THE VALLEY COURT -->
      <div style="background: rgba(15, 23, 42, 0.72); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 10px; padding: 15px;">
        <div style="font-size: 13px; font-weight: 900; color: #38bdf8; letter-spacing: 0.08em; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
          <span>🏟️</span> 1v1 &amp; 2v2 VALLEY COURT
        </div>
        <div style="font-size: 11.5px; color: #cbd5e1; line-height: 1.6;">
          <p style="margin: 0 0 8px 0;"><strong style="color: #ffffff;">Continuous Play Basin:</strong> Face off in 1v1 duels or 2v2 team matches inside a banked bowl ringed by full-height glass barriers. There are no out-of-bounds whistles: every bank and rebound stays live.</p>
          <p style="margin: 0 0 8px 0;"><strong style="color: #ffffff;">Full Ball-Clearance Hoops:</strong> Two open steel hoops stand at the North and South ends, glowing in the attacking team's color. Put the <strong style="color:#ffffff;">entire ball</strong> through your target hoop from either side for 1 point.</p>
          <p style="margin: 0;"><strong style="color: #ffffff;">Instant Unthreading:</strong> Scoring immediately flips attack ends with no reset. Swatting a narrowly scored ball completely back out through the hoop immediately registers a responding goal!</p>
        </div>
      </div>

      <!-- Card 2: MATCH CLOCK, OVERTIME & REPLAYS -->
      <div style="background: rgba(15, 23, 42, 0.72); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 10px; padding: 15px;">
        <div style="font-size: 13px; font-weight: 900; color: #10b981; letter-spacing: 0.08em; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
          <span>⏱️</span> CLOCK, OVERTIME &amp; REPLAYS
        </div>
        <div style="font-size: 11.5px; color: #cbd5e1; line-height: 1.6;">
          <p style="margin: 0 0 8px 0;"><strong style="color: #ffffff;">Regulation Length:</strong> Pick 3:00, 5:00, or 10:00 matches on Match Rules, or press <strong style="color:#4ade80;">START</strong> on Pick Sides for instant Quick Play.</p>
          <p style="margin: 0 0 8px 0;"><strong style="color: #ffffff;">Overtime Agreement:</strong> Tied at 0:00? Players choose <strong style="color:#fbbf24;">Golden Goal Sudden Death</strong>, <strong style="color:#38bdf8;">Timed Overtime</strong>, or an <strong style="color:#cbd5e1;">Agreed Draw</strong>, resuming in place or from Stream Heads.</p>
          <p style="margin: 0;"><strong style="color: #ffffff;">Director Replay Suite:</strong> Every match auto-records. Watch replays from any athlete's POV (P1 to P4), fly the Free Drone (<strong style="color:#00e5ff;">F</strong>), export clean <strong style="color:#fb7185;">.webm</strong> clips (<strong style="color:#fb7185;">V</strong>), or share <strong style="color:#4ade80;">.vbreplay</strong> files.</p>
        </div>
      </div>
    </div>

    <!-- Full-Width Card: PHYSICAL COMBAT & KNOCKDOWNS -->
    <div style="background: rgba(15, 23, 42, 0.72); border: 1px solid rgba(244, 63, 94, 0.35); border-radius: 10px; padding: 15px;">
      <div style="font-size: 13px; font-weight: 900; color: #f43f5e; letter-spacing: 0.08em; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
        <span>💥</span> FULL-CONTACT COMBAT &amp; KNOCKDOWNS
      </div>
      <div style="font-size: 11.5px; color: #cbd5e1; line-height: 1.6; display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div>
          <p style="margin: 0 0 6px 0;"><strong style="color: #ffffff;">Slide Tackles:</strong> Sliding at speed (&gt; ${TUNING.action.slideTackleMinSpeed} m/s) into an opponent sweeps their legs into a full ragdoll knockdown.</p>
          <p style="margin: 0;"><strong style="color: #ffffff;">Physical Bumps:</strong> Colliding shoulder-to-shoulder shoves both athletes apart based on closing speed.</p>
        </div>
        <div>
          <p style="margin: 0 0 6px 0;"><strong style="color: #ffffff;">Slide Clashes:</strong> When two athletes slide into each other head-on, both go down.</p>
          <p style="margin: 0;"><strong style="color: #ffffff;">Heavy Ball Hits:</strong> A fast or heavy ball striking an unbraced athlete in the torso or head knocks them off their feet.</p>
        </div>
      </div>
    </div>
  `;
  box.appendChild(basicsView);

  // -------------------------------------------------------------------------
  // VIEW 3: PRO TIPS VIEW
  // -------------------------------------------------------------------------
  const tipsView = document.createElement('div');
  tipsView.id = 'howto-view-tips';
  tipsView.style.cssText = 'display: none; flex-direction: column; gap: 11px; width: 100%;';
  tipsView.innerHTML = `
    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #10b981; border-radius: 8px; padding: 11px 15px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #34d399; margin-bottom: 3px;">1. VOLLEY TO SET UP THE JUMP SPIKE</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        Do not just sprint blindly into the ball. Tap <strong style="color: #38bdf8;">Volley (B / Circle / L-Click / E)</strong> to lift the ball cleanly toward the hoop, then time your <strong style="color: #34d399;">Jump (A / Cross / Space)</strong> and hammer a <strong style="color: #f43f5e;">Spike (Y / Triangle / R-Click / R)</strong> downward through the ring.
      </div>
    </div>

    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #3b82f6; border-radius: 8px; padding: 11px 15px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #60a5fa; margin-bottom: 3px;">2. USE DIRECTIONAL CUT ON STEEP SLOPES</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        Running downhill builds huge speed on the Valley Court banks. Press <strong style="color: #93c5fd;">Cut / Plant (RB / R1 / F)</strong> while steering in a new direction to plant your cleat and snap instantly into a fresh sprint angle without skidding past the ball.
      </div>
    </div>

    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #a855f7; border-radius: 8px; padding: 11px 15px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #c084fc; margin-bottom: 3px;">3. AGILE BRACE, GOAL-LINE SAVES &amp; BRACED DIVES</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        Hold <strong style="color: #ffffff;">Brace (LB / L1 / G)</strong> to stay mobile while deflecting incoming rockets back the way you face. Press <strong style="color: #e9d5ff;">Dive (X / Square / Q)</strong> while bracing to launch a low desperation lunge. Even if the ball pokes halfway into the hoop, swatting it back before full clearance counts as a clean goal-line save.
      </div>
    </div>

    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #f59e0b; border-radius: 8px; padding: 11px 15px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #fbbf24; margin-bottom: 3px;">4. BANK SHOTS &amp; VISUAL READABILITY GUIDES</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        Every hoop is open on both sides: bank shots off the corner ramps and glass walls to attack the unguarded face. Need help reading ball height on high lobs? Open <strong style="color: #ffffff;">Settings</strong> to toggle the <strong style="color: #00e5ff;">Rainbow Ball Halo</strong>, <strong style="color: #34d399;">Strike Range Guide</strong>, and <strong style="color: #fbbf24;">Off-Screen Ball Pips</strong> live at any time.
      </div>
    </div>

    <div style="background: rgba(15, 23, 42, 0.75); border-left: 4px solid #ef4444; border-radius: 8px; padding: 11px 15px;">
      <div style="font-size: 12.5px; font-weight: 800; color: #f87171; margin-bottom: 3px;">5. THREE REGULATION MATCH BALLS</div>
      <div style="font-size: 11px; color: #cbd5e1; line-height: 1.55;">
        • <strong style="color: #fbbf24;">Small Ball (0.4 m, 0.84 kg):</strong> Lightning fast, razor precision, hardest target to read.<br>
        • <strong style="color: #00e5ff;">Medium Ball (1.0 m, 2.2 kg):</strong> Canonical tournament standard with balanced loft and rebound.<br>
        • <strong style="color: #f43f5e;">Large Ball (1.5 m, 3.9 kg):</strong> Heavy wrecking ball with massive rebound area and strong knockdown force.
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
    soundManager.playTone(540, 0.05, 'sine', 0.18);
  }

  btnTabControls.onclick = () => setHowToPlayTab('controls');
  btnTabBasics.onclick = () => setHowToPlayTab('basics');
  btnTabTips.onclick = () => setHowToPlayTab('tips');

  // Close Button
  const closeBtn = document.createElement('button');
  closeBtn.id = 'btn-close-controls';
  closeBtn.textContent = 'CLOSE [ESC / B / START]';
  closeBtn.style.cssText = `
    margin-top: 14px; padding: 10px; font-size: 12.5px; font-weight: 900; font-family: inherit;
    letter-spacing: 0.1em; color: #ffffff; background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 8px; cursor: pointer; transition: all 0.15s ease;
  `;
  closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(255, 255, 255, 0.2)'; closeBtn.style.borderColor = '#ffffff'; };
  closeBtn.onmouseleave = () => { closeBtn.style.background = 'rgba(255, 255, 255, 0.1)'; closeBtn.style.borderColor = 'rgba(255, 255, 255, 0.25)'; };
  closeBtn.onclick = hideHowToPlayModal;
  box.appendChild(closeBtn);

  controlsModalEl.appendChild(box);
  if (rootContainer) rootContainer.appendChild(controlsModalEl);

  function cycleDeviceTab(direction = 1) {
    const idx = DEVICE_TABS.indexOf(currentControlsDevice);
    const nextIdx = (idx + (direction >= 0 ? 1 : -1) + DEVICE_TABS.length) % DEVICE_TABS.length;
    setDeviceTab(DEVICE_TABS[nextIdx]);
    soundManager.playTone(480, 0.05, 'sine', 0.2);
  }

  function scrollContent(pixels) {
    box.scrollTop += pixels;
  }

  controlsModalEl._setTab = setHowToPlayTab;
  controlsModalEl._setDevice = setDeviceTab;
  controlsModalEl._cycleTab = cycleHowToPlayTab;
  controlsModalEl._cycleDevice = cycleDeviceTab;
  controlsModalEl._scrollContent = scrollContent;
  controlsModalEl._getCurrentTab = () => currentHowToPlayTab;
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
