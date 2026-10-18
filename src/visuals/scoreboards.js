import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { displayCoordinator } from './displayCoordinator.js';

/**
 * THE FOUR BOUNDARY SCOREBOARDS — diegetic stadium jumbotrons.
 *
 * Four canvas-textured panels bolted to the arena's boundary walls, one per
 * side, each facing the court. They show the score, the end the home player is
 * attacking, the clock, and a flashing banner for a couple of seconds after a
 * goal.
 *
 * ─── WHAT THIS FILE IS NOT ───────────────────────────────────────────────────
 *
 * LAW 1. There is no rigid body here, no collider and no interaction group. A
 * board is a mesh and a texture. A ball thrown at one passes straight through,
 * which is the correct behaviour for a thing hanging behind a 25 m wall the
 * ball cannot reach anyway, and it means nothing in this file can perturb the
 * simulation.
 *
 * LAW 6. There is no wall clock, no Date, no performance.now and no frame
 * counter. Everything drawn is a function of the match state's TICK counters —
 * `ticksRemaining` for the clock, `celebrationTicks` for the flash — so two
 * runs that step the same number of times draw the same pixels, and an anchored
 * capture is reproducible. This module lives under src/visuals/ rather than
 * src/sim/ precisely because it READS simulation state and never writes it.
 *
 * LESSON 22 — READOUTS READ. `updateScoreboards` is handed the probe object and
 * formats it. It does not recompute a score, does not decide when a goal
 * happened, and does not own the celebration countdown; scoring.js does all
 * three, and this file would be wrong about all three the moment they changed.
 *
 * LESSON 13's SPIRIT, adapted. The board geometry cannot be shared with a
 * collider because there is no collider — but the four boards do share one
 * geometry pair and one draw routine, so a change to the look cannot land on
 * three sides and miss the fourth.
 *
 * ─── WHERE THEY HANG ─────────────────────────────────────────────────────────
 *
 * Every number is in TUNING.scoreboard and every one of them was measured off
 * arena.glb with a raycast, not eyeballed. The comment there records what the
 * wall actually does at each height; the short version is that the court is a
 * stepped bowl, so "on the boundary" means two different heights and two
 * different distances depending on which side you are standing on.
 */

/** Which way each board faces, as a rotation about Y. */
const FACING = {
  /** A PlaneGeometry's normal is +Z, so rotY 0 faces +Z, into the court. */
  north: 0,
  south: Math.PI,
  east: -Math.PI / 2,
  west: Math.PI / 2,
};

function getHomeHex() {
  const c = TUNING.athlete?.palette?.homePrimary ?? 0xd90429;
  return '#' + c.toString(16).padStart(6, '0');
}

function getAwayHex() {
  const c = TUNING.athlete?.palette?.awayPrimary ?? 0x1d4ed8;
  return '#' + c.toString(16).padStart(6, '0');
}

function hexToRgba(hex, alpha = 0.16) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function isDarkColor(hex) {
  if (!hex) return false;
  const num = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < 70;
}

/** Canonical athletic broadcast typography */
const ATHLETIC_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function drawTeamText(ctx, text, x, y, color, strokeWidth = 2.5) {
  if (isDarkColor(color)) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.restore();
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * Draws the high-contrast clock string onto the shared decoupled micro-canvas (256x64).
 */
function drawMicroClock(ctx, W, H, text, isMatchOver) {
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontSize = text.length > 7 ? 32 : 40;
  ctx.font = `900 ${fontSize}px ${ATHLETIC_FONT}`;
  ctx.fillStyle = isMatchOver ? INK.away : INK.value;
  ctx.fillText(text, W / 2, H / 2 + 1);
}

/** The palette. Reads dynamic team colors from TUNING so boards match athletes. */
const INK = {
  panelIdle: '#0b111e', // Canonical obsidian stadium backdrop
  panelFlash: '#f0b429',
  screenBorder: '#1e293b', // Anodized metallic bezel
  accentPink: '#ec4899', // Canonical pink corner accents
  rule: 'rgba(245, 245, 247, 0.20)', // Subtle chalk line divider
  label: '#94a3b8',
  value: '#f8fafc',
  get home() {
    return getHomeHex();
  },
  get away() {
    return getAwayHex();
  },
  get homeTint() {
    return hexToRgba(this.home, 0.22);
  },
  get awayTint() {
    return hexToRgba(this.away, 0.22);
  },
  flashInk: '#1a1205',
};

/**
 * Draws an architectural Obsidian stadium bezel with canonical pink corner accents.
 */
function drawObsidianBezel(ctx, W, H) {
  ctx.fillStyle = INK.panelIdle;
  ctx.fillRect(0, 0, W, H);

  // Outer dark metallic bezel frame
  ctx.strokeStyle = INK.screenBorder;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  // Canonical pink corner tick brackets
  ctx.strokeStyle = INK.accentPink;
  ctx.lineWidth = 3;
  const tick = Math.min(28, Math.round(H * 0.08));
  const pad = 6;

  // Top-left
  ctx.beginPath();
  ctx.moveTo(pad, pad + tick);
  ctx.lineTo(pad, pad);
  ctx.lineTo(pad + tick, pad);
  ctx.stroke();

  // Top-right
  ctx.beginPath();
  ctx.moveTo(W - pad - tick, pad);
  ctx.lineTo(W - pad, pad);
  ctx.lineTo(W - pad, pad + tick);
  ctx.stroke();

  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(pad, H - pad - tick);
  ctx.lineTo(pad, H - pad);
  ctx.lineTo(pad + tick, H - pad);
  ctx.stroke();

  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(W - pad - tick, H - pad);
  ctx.lineTo(W - pad, H - pad);
  ctx.lineTo(W - pad, H - pad - tick);
  ctx.stroke();
}

/**
 * Builds the four boundary scoreboards and adds them to the scene.
 *
 * @param {THREE.Scene} scene
 * @returns {object|null} the handle passed back to updateScoreboards, or null
 *   when the boards are switched off in tuning.
 */
export function createScoreboards(scene) {
  const cfg = TUNING.scoreboard;
  if (!cfg.enabled) {
    console.log('[scoreboards] disabled in tuning; none built');
    return null;
  }

  const group = new THREE.Group();
  group.name = 'scoreboards';

  // RECESSED PLANE GEOMETRIES: zero 3D physical box depth sticking into the arena.
  // - endScreen: 14m x 6.5m (North and South end walls)
  // - sideScreen: 15m x 2.8m (East and West centerline ribbon displays)
  const geometry = {
    endScreen: new THREE.PlaneGeometry(cfg.endWidth, cfg.endHeight),
    sideScreen: new THREE.PlaneGeometry(cfg.sideWidth, cfg.sideHeight),
  };

  // ─── DECOUPLED MICRO-CLOCK OVERLAY ──────────────────────────────────────────
  // A single shared 256x64 canvas (65 KB payload) shared by all 4 scoreboards.
  // Replaces redrawing and re-uploading 13.6 MB across large canvases every second.
  const clockCanvas = document.createElement('canvas');
  clockCanvas.width = 256;
  clockCanvas.height = 64;
  const clockContext = clockCanvas.getContext('2d');

  const clockTexture = new THREE.CanvasTexture(clockCanvas);
  clockTexture.colorSpace = THREE.SRGBColorSpace;
  clockTexture.generateMipmaps = false;
  clockTexture.minFilter = THREE.LinearFilter;
  clockTexture.magFilter = THREE.LinearFilter;

  const clockMaterial = new THREE.MeshBasicMaterial({
    map: clockTexture,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  const clockGeometryEnd = new THREE.PlaneGeometry(5.2, 1.3);
  const clockGeometrySide = new THREE.PlaneGeometry(5.0, 1.3);
  const clockMeshes = [];

  const boards = [
    { key: 'north', side: 'end', x: 0, y: cfg.endCenterY, z: -cfg.endZ },
    { key: 'south', side: 'end', x: 0, y: cfg.endCenterY, z: cfg.endZ },
    { key: 'east', side: 'side', x: cfg.sideX, y: cfg.sideCenterY, z: 0 },
    { key: 'west', side: 'side', x: -cfg.sideX, y: cfg.sideCenterY, z: 0 },
  ].map((spec) => {
    const canvas = document.createElement('canvas');
    canvas.width = spec.side === 'end' ? (cfg.endCanvasWidth || 1024) : (cfg.sideCanvasWidth || 2048);
    canvas.height = spec.side === 'end' ? (cfg.endCanvasHeight || 512) : (cfg.sideCanvasHeight || 512);
    const context = canvas.getContext('2d');

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    // Self-lit basic material facing inwards toward the arena
    const screenMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.FrontSide,
    });

    const screen = new THREE.Mesh(
      spec.side === 'end' ? geometry.endScreen : geometry.sideScreen,
      screenMaterial,
    );
    screen.frustumCulled = true;

    // Child clock overlay mounted 2cm in front of the board plane to eliminate z-fighting
    const isEnd = spec.side === 'end';
    const clockMesh = new THREE.Mesh(
      isEnd ? clockGeometryEnd : clockGeometrySide,
      clockMaterial,
    );
    clockMesh.name = `clock-${spec.key}`;
    // Positioned directly over the designated clock cutout area
    // End: Y = +1.40m (canvas middle row between header pill and score rule)
    // Side: Y = +1.25m (canvas upper center column between flanks and score line)
    clockMesh.position.set(0, isEnd ? 1.40 : 1.25, 0.02);
    clockMesh.frustumCulled = true;
    screen.add(clockMesh);
    clockMeshes.push(clockMesh);

    const pivot = new THREE.Group();
    pivot.name = `scoreboard-${spec.key}`;
    pivot.position.set(spec.x, spec.y, spec.z);
    pivot.rotation.y = FACING[spec.key];
    pivot.add(screen);
    group.add(pivot);

    return {
      key: spec.key,
      side: spec.side,
      canvas,
      context,
      texture,
      screenMaterial,
      clockMesh,
      /** Cache key to skip redundant canvas repaints */
      lastKey: null,
    };
  });

  scene.add(group);

  console.log(
    `[scoreboards] ${boards.length} recessed boards: ends ${cfg.endWidth}x${cfg.endHeight} at ` +
      `y ${cfg.endCenterY}, |z| ${cfg.endZ}; sides ${cfg.sideWidth}x${cfg.sideHeight} at ` +
      `y ${cfg.sideCenterY}, |x| ${cfg.sideX}`,
  );

  return {
    group,
    boards,
    geometry,
    clockCanvas,
    clockContext,
    clockTexture,
    clockMaterial,
    clockGeometryEnd,
    clockGeometrySide,
    clockMeshes,
    lastClockText: null,
    lastFlashing: null,
  };
}

/**
 * Draws this frame's state onto all four boards.
 *
 * Call it from the render pass with the output of `matchProbe`. Nothing is
 * derived here that scoring.js does not already own.
 *
 * @param {object|null} handle from createScoreboards
 * @param {object|null} probe from matchProbe
 */
export function updateScoreboards(handle, probe) {
  if (!handle || !probe) return;

  const cfg = TUNING.scoreboard;

  // THE FLASH PHASE, and the reason it is part of the cache key.
  //
  // The obvious cache — "redraw when the score or the clock changed" — makes
  // the celebration banner draw exactly ONCE and then sit there, perfectly
  // still, for the whole two seconds. It is not a flash, it is a caption. The
  // phase below changes four times a second while the celebration runs, so it
  // belongs in the key that decides whether to redraw; outside a celebration it
  // is a constant and costs nothing.
  const flashing = probe.celebrationTicks > 0;
  const phase = flashing ? Math.floor(probe.celebrationTicks / cfg.flashTicks) % 2 : 0;

  const isMatchMode = probe.mode === 'match';
  const seconds = Math.floor(probe.ticksRemaining / 60);
  const clockText = !isMatchMode
    ? 'PRACTICE'
    : (probe.matchOver ? 'FULL TIME' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);

  // 1. DECOUPLED MICRO-CLOCK OVERLAY UPDATE (65 KB payload shared across all 4 boards)
  // Only updates when clock string or celebration flashing changes
  const clockDirty = (handle.lastClockText !== clockText) || (handle.lastFlashing !== flashing) || (handle.lastMatchOver !== probe.matchOver);
  if (clockDirty) {
    handle.lastClockText = clockText;
    handle.lastFlashing = flashing;
    handle.lastMatchOver = probe.matchOver;

    // During celebration flashing, hide clock overlays so the GOAL banner displays unimpeded
    if (handle.clockMeshes) {
      for (const mesh of handle.clockMeshes) {
        mesh.visible = !flashing;
      }
    }

    if (!flashing && handle.clockContext) {
      drawMicroClock(handle.clockContext, handle.clockCanvas.width, handle.clockCanvas.height, clockText, probe.matchOver);
      handle.clockTexture.needsUpdate = true;
    }
  }

  // 2. BACKPLATES UPDATE ONLY ON SCORE/GOAL/SIDE EVENTS (Zero uploads on standard second ticks)
  for (const board of handle.boards) {
    const key = `${board.key}|${probe.scoreHome}|${probe.scoreAway}|${probe.targetGoal}|` +
      `${probe.matchOver ? 1 : 0}|${flashing ? 1 : 0}|${probe.lastGoalId || ''}|${probe.lastScoredFor || ''}|${INK.home}|${INK.away}`;

    board.pendingKey = key;
    board.pendingView = { flashing, phase };
    if (board.lastKey !== key) {
      board.dirty = true;
    }
  }

  // 3. MATERIAL UNIFORM-DRIVEN CELEBRATION FLASHING (Zero GPU texture uploads, LAW 8)
  for (const board of handle.boards) {
    if (flashing) {
      if (phase === 1) {
        // Radiant gold flash pulse
        board.screenMaterial.color.setRGB(1.65, 1.45, 0.45);
      } else {
        // Clean baseline tone
        board.screenMaterial.color.setRGB(1.0, 1.0, 1.0);
      }
    } else {
      board.screenMaterial.color.setRGB(1.0, 1.0, 1.0);
    }
  }

  // Smooth round-robin: redraw and upload at most 1 dirty scoreboard per frame within budget
  if (handle.cursor === undefined) handle.cursor = 0;
  for (let step = 0; step < handle.boards.length; step++) {
    const idx = (handle.cursor + step) % handle.boards.length;
    const board = handle.boards[idx];
    if (board.dirty) {
      if (!displayCoordinator.canUpload()) {
        break; // Upload budget filled for this frame; yield to next frame
      }
      if (board.side === 'end') {
        drawEndBoard(board, probe, board.pendingView);
      } else {
        drawSideBoard(board, probe, board.pendingView);
      }
      board.texture.needsUpdate = true;
      displayCoordinator.consumeUpload();
      board.lastKey = board.pendingKey;
      board.dirty = false;
      handle.cursor = (idx + 1) % handle.boards.length;
      break;
    }
  }
}

/**
 * Draws the North or South end scoreboard (1024 x 512).
 *
 * Mounted behind the goal hoop: indicates which team is attacking THIS specific
 * goal at the top, the clock in the middle, and the score line prominently on
 * the bottom closest to the player's sightline.
 */
function drawEndBoard(board, probe, view) {
  const ctx = board.context;
  const W = board.canvas.width;
  const H = board.canvas.height;

  // Architectural Obsidian stadium bezel with canonical pink corner accents
  drawObsidianBezel(ctx, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (view.flashing) {
    const scoredAt = probe.lastGoalId || (probe.targetGoal === 'N' ? 'S' : 'N');
    const scoringTeam = probe.lastScoredFor ? probe.lastScoredFor.toUpperCase() : 'GOAL';
    const ink = INK.panelFlash;

    ctx.fillStyle = ink;
    ctx.font = `900 ${Math.round(H * 0.18)}px ${ATHLETIC_FONT}`;
    ctx.fillText('★  GOAL!  ★', W / 2, H * 0.22);

    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(H * 0.10)}px ${ATHLETIC_FONT}`;
    ctx.fillText(
      `${scoringTeam} SCORED AT GOAL ${scoredAt === 'N' ? 'NORTH' : 'SOUTH'}`,
      W / 2,
      H * 0.46,
    );

    // Score on bottom
    ctx.fillStyle = ink;
    ctx.font = `900 ${Math.round(H * 0.26)}px ${ATHLETIC_FONT}`;
    ctx.fillText(`${probe.scoreHome} - ${probe.scoreAway}`, W / 2, H * 0.76);
    return;
  }

  // ─── STANDING END BOARD ──────────────────────────────────────────────────

  // 1. TOP HEADER: Which team is attacking THIS specific goal!
  const isNorth = board.key === 'north';
  const homeAttacksThis = isNorth ? (probe.targetGoal === 'N') : (probe.targetGoal === 'S');
  const attackingTeam = homeAttacksThis ? 'HOME' : 'AWAY';
  const teamColor = homeAttacksThis ? INK.home : INK.away;
  const darkTeam = isDarkColor(teamColor);

  // Inset pill safely below top frame
  const pillW = Math.round(W * 0.88);
  const pillH = Math.round(H * 0.15);
  const pillX = Math.round((W - pillW) / 2);
  const pillY = Math.round(H * 0.06);

  ctx.fillStyle = darkTeam ? 'rgba(255, 255, 255, 0.12)' : (homeAttacksThis ? INK.homeTint : INK.awayTint);
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, pillH, 8);
  ctx.fill();
  ctx.strokeStyle = darkTeam ? '#e2e8f0' : teamColor;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.font = `900 ${Math.round(H * 0.076)}px ${ATHLETIC_FONT}`;
  const thisGoalName = isNorth ? 'NORTH' : 'SOUTH';
  drawTeamText(ctx, `▼  TARGET GOAL ${thisGoalName}  (ATTACKED BY ${attackingTeam})  ▼`, W / 2, pillY + pillH / 2, teamColor, 3);

  // 2. MIDDLE ROW: Match Clock handled by decoupled micro-clock mesh overlay

  // Thin separator rule
  ctx.strokeStyle = INK.rule;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(W * 0.08, H * 0.48);
  ctx.lineTo(W * 0.92, H * 0.48);
  ctx.stroke();

  // 3. BOTTOM ROW: PROMINENT ATHLETIC SCORE LINE
  ctx.font = `900 ${Math.round(H * 0.08)}px ${ATHLETIC_FONT}`;
  drawTeamText(ctx, 'HOME', W * 0.30, H * 0.58, INK.home, 3);
  drawTeamText(ctx, 'AWAY', W * 0.70, H * 0.58, INK.away, 3);

  // Bold score numbers in colossal athletic typography
  ctx.font = `900 ${Math.round(H * 0.28)}px ${ATHLETIC_FONT}`;
  ctx.fillStyle = INK.value;
  ctx.fillText(String(probe.scoreHome), W * 0.30, H * 0.78);
  ctx.fillText(String(probe.scoreAway), W * 0.70, H * 0.78);

  ctx.fillStyle = INK.label;
  ctx.font = `900 ${Math.round(H * 0.18)}px ${ATHLETIC_FONT}`;
  ctx.fillText('-', W * 0.50, H * 0.77);
}

/**
 * Draws the East or West centerline ribbon scoreboard (2048 x 512).
 *
 * Monumental scale: Left & right flanks show high-contrast directional chevron indicators
 * of which team is attacking toward the North and South goals. Center column holds the
 * clock on top and the prominent athletic score line on the bottom.
 */
function drawSideBoard(board, probe, view) {
  const ctx = board.context;
  const W = board.canvas.width;
  const H = board.canvas.height;

  // Architectural Obsidian stadium bezel with canonical pink corner accents
  drawObsidianBezel(ctx, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (view.flashing) {
    const scoredAt = probe.lastGoalId || (probe.targetGoal === 'N' ? 'S' : 'N');
    const scoringTeam = probe.lastScoredFor ? probe.lastScoredFor.toUpperCase() : 'GOAL';
    const ink = INK.panelFlash;

    ctx.fillStyle = ink;
    ctx.font = `900 ${Math.round(H * 0.20)}px ${ATHLETIC_FONT}`;
    ctx.fillText(`★  GOAL SCORED BY ${scoringTeam}  ★`, W / 2, H * 0.30);

    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(H * 0.12)}px ${ATHLETIC_FONT}`;
    ctx.fillText(
      `SCORED AT GOAL ${scoredAt === 'N' ? 'NORTH' : 'SOUTH'}  |  HOME ${probe.scoreHome} - ${probe.scoreAway} AWAY`,
      W / 2,
      H * 0.70,
    );
    return;
  }

  // ─── DIRECTIONAL GEOMETRY ────────────────────────────────────────────────
  // On East board (facing West/into court): Left is North (-Z), Right is South (+Z).
  // On West board (facing East/into court): Left is South (+Z), Right is North (-Z).
  const isEast = board.key === 'east';
  const leftIsNorth = isEast;

  const teamAttackingNorth = probe.targetGoal === 'N' ? 'HOME' : 'AWAY';
  const colorAttackingNorth = probe.targetGoal === 'N' ? INK.home : INK.away;

  const teamAttackingSouth = probe.targetGoal === 'S' ? 'HOME' : 'AWAY';
  const colorAttackingSouth = probe.targetGoal === 'S' ? INK.home : INK.away;

  const leftTeam = leftIsNorth ? teamAttackingNorth : teamAttackingSouth;
  const leftColor = leftIsNorth ? colorAttackingNorth : colorAttackingSouth;
  const leftGoalLabel = leftIsNorth ? 'GOAL NORTH' : 'GOAL SOUTH';
  const darkLeft = isDarkColor(leftColor);

  const rightTeam = leftIsNorth ? teamAttackingSouth : teamAttackingNorth;
  const rightColor = leftIsNorth ? colorAttackingSouth : colorAttackingNorth;
  const rightGoalLabel = leftIsNorth ? 'GOAL SOUTH' : 'GOAL NORTH';
  const darkRight = isDarkColor(rightColor);

  // 1. LEFT FLANK (Directional attack indicator toward left goal)
  const flankW = 700;
  const flankH = Math.round(H * 0.78);
  const flankY = Math.round((H - flankH) / 2);
  const leftX = 24;

  ctx.fillStyle = darkLeft ? 'rgba(255, 255, 255, 0.12)' : (leftTeam === 'HOME' ? INK.homeTint : INK.awayTint);
  ctx.beginPath();
  ctx.roundRect(leftX, flankY, flankW, flankH, 10);
  ctx.fill();
  ctx.strokeStyle = darkLeft ? '#e2e8f0' : leftColor;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.font = `900 ${Math.round(H * 0.17)}px ${ATHLETIC_FONT}`;
  drawTeamText(ctx, `◀◀◀  ${leftTeam}`, leftX + flankW / 2, flankY + flankH * 0.36, leftColor, 3.5);

  ctx.fillStyle = '#f1f5f9';
  ctx.font = `800 ${Math.round(H * 0.105)}px ${ATHLETIC_FONT}`;
  ctx.fillText(`TARGET: ${leftGoalLabel}`, leftX + flankW / 2, flankY + flankH * 0.72);

  // 2. RIGHT FLANK (Directional attack indicator toward right goal)
  const rightX = W - flankW - 24;

  ctx.fillStyle = darkRight ? 'rgba(255, 255, 255, 0.12)' : (rightTeam === 'HOME' ? INK.homeTint : INK.awayTint);
  ctx.beginPath();
  ctx.roundRect(rightX, flankY, flankW, flankH, 10);
  ctx.fill();
  ctx.strokeStyle = darkRight ? '#e2e8f0' : rightColor;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.font = `900 ${Math.round(H * 0.17)}px ${ATHLETIC_FONT}`;
  drawTeamText(ctx, `${rightTeam}  ▶▶▶`, rightX + flankW / 2, flankY + flankH * 0.36, rightColor, 3.5);

  ctx.fillStyle = '#f1f5f9';
  ctx.font = `800 ${Math.round(H * 0.105)}px ${ATHLETIC_FONT}`;
  ctx.fillText(`TARGET: ${rightGoalLabel}`, rightX + flankW / 2, flankY + flankH * 0.72);

  // 3. CENTER COLUMN: Clock on top, ATHLETIC SCORE LINE ON BOTTOM
  const centerX = W / 2;

  // Vertical boundary dividers separating flanks from center
  ctx.strokeStyle = INK.rule;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(leftX + flankW + 16, H * 0.10);
  ctx.lineTo(leftX + flankW + 16, H * 0.90);
  ctx.moveTo(rightX - 16, H * 0.10);
  ctx.lineTo(rightX - 16, H * 0.90);
  ctx.stroke();

  // Horizontal separator between micro-clock and score line
  ctx.beginPath();
  ctx.moveTo(leftX + flankW + 36, H * 0.48);
  ctx.lineTo(rightX - 36, H * 0.48);
  ctx.stroke();

  // PROMINENT ATHLETIC SCORE LINE ON THE BOTTOM
  const scoreY = H * 0.74;

  // HOME pill badge
  const homeBadgeW = 100;
  const homeBadgeH = 34;
  const homeBadgeX = centerX - 190 - homeBadgeW / 2;
  const homeBadgeY = scoreY - homeBadgeH / 2;
  ctx.fillStyle = isDarkColor(INK.home) ? 'rgba(255, 255, 255, 0.15)' : INK.homeTint;
  ctx.beginPath();
  ctx.roundRect(homeBadgeX, homeBadgeY, homeBadgeW, homeBadgeH, 6);
  ctx.fill();
  ctx.strokeStyle = isDarkColor(INK.home) ? '#e2e8f0' : INK.home;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = `900 ${Math.round(H * 0.065)}px ${ATHLETIC_FONT}`;
  drawTeamText(ctx, 'HOME', centerX - 190, scoreY, INK.home, 2.5);

  // Home score number
  ctx.font = `900 ${Math.round(H * 0.28)}px ${ATHLETIC_FONT}`;
  ctx.fillStyle = INK.value;
  ctx.fillText(String(probe.scoreHome), centerX - 90, scoreY);

  // Divider dash
  ctx.fillStyle = INK.label;
  ctx.font = `900 ${Math.round(H * 0.18)}px ${ATHLETIC_FONT}`;
  ctx.fillText('-', centerX, scoreY - 2);

  // Away score number
  ctx.font = `900 ${Math.round(H * 0.28)}px ${ATHLETIC_FONT}`;
  ctx.fillStyle = INK.value;
  ctx.fillText(String(probe.scoreAway), centerX + 90, scoreY);

  // AWAY pill badge
  const awayBadgeX = centerX + 190 - homeBadgeW / 2;
  ctx.fillStyle = isDarkColor(INK.away) ? 'rgba(255, 255, 255, 0.15)' : INK.awayTint;
  ctx.beginPath();
  ctx.roundRect(awayBadgeX, homeBadgeY, homeBadgeW, homeBadgeH, 6);
  ctx.fill();
  ctx.strokeStyle = isDarkColor(INK.away) ? '#e2e8f0' : INK.away;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = `900 ${Math.round(H * 0.065)}px ${ATHLETIC_FONT}`;
  drawTeamText(ctx, 'AWAY', centerX + 190, scoreY, INK.away, 2.5);
}

/**
 * Releases scoreboard geometries and textures upon teardown.
 *
 * @param {THREE.Scene} scene
 * @param {object|null} handle
 */
export function disposeScoreboards(scene, handle) {
  if (!handle) return;
  scene.remove(handle.group);
  for (const board of handle.boards) {
    board.texture.dispose();
    board.screenMaterial.dispose();
  }
  if (handle.clockTexture) handle.clockTexture.dispose();
  if (handle.clockMaterial) handle.clockMaterial.dispose();
  if (handle.clockGeometryEnd) handle.clockGeometryEnd.dispose();
  if (handle.clockGeometrySide) handle.clockGeometrySide.dispose();
  for (const geometry of Object.values(handle.geometry)) geometry.dispose();
}
