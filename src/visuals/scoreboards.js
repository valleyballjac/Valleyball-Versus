import * as THREE from 'three';

import { TUNING } from '../config/tuning.js';

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

/** The palette. Reads dynamic team colors from TUNING so boards match athletes. */
const INK = {
  panelIdle: '#090e15',
  panelFlash: '#f0b429',
  screenBorder: 'rgba(90, 140, 190, 0.35)',
  rule: 'rgba(120, 170, 210, 0.25)',
  label: '#7d97ad',
  value: '#f2f8ff',
  get home() {
    return getHomeHex();
  },
  get away() {
    return getAwayHex();
  },
  get homeTint() {
    return hexToRgba(this.home, 0.16);
  },
  get awayTint() {
    return hexToRgba(this.away, 0.16);
  },
  flashInk: '#1a1205',
};

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

  const boards = [
    { key: 'north', side: 'end', x: 0, y: cfg.endCenterY, z: -cfg.endZ },
    { key: 'south', side: 'end', x: 0, y: cfg.endCenterY, z: cfg.endZ },
    { key: 'east', side: 'side', x: cfg.sideX, y: cfg.sideCenterY, z: 0 },
    { key: 'west', side: 'side', x: -cfg.sideX, y: cfg.sideCenterY, z: 0 },
  ].map((spec) => {
    const canvas = document.createElement('canvas');
    canvas.width = spec.side === 'end' ? (cfg.endCanvasWidth || 1024) : (cfg.sideCanvasWidth || 1280);
    canvas.height = spec.side === 'end' ? (cfg.endCanvasHeight || 512) : (cfg.sideCanvasHeight || 256);
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

  return { group, boards, geometry };
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

  const seconds = Math.floor(probe.ticksRemaining / 60);
  const clock =
    probe.mode === 'match'
      ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
      : 'PRACTICE';

  // ONE STRING. If it has not changed, not one of the four canvases is touched
  // and not one texture is re-uploaded — which for a static scoreboard is every
  // frame but the handful where something actually happened.
  const key = `${probe.scoreHome}|${probe.scoreAway}|${probe.targetGoal}|${clock}|` +
    `${probe.matchOver ? 1 : 0}|${flashing ? phase + 1 : 0}|${probe.lastGoalId || ''}`;

  for (const board of handle.boards) {
    const key = `${board.key}|${probe.scoreHome}|${probe.scoreAway}|${probe.targetGoal}|${clock}|` +
      `${probe.matchOver ? 1 : 0}|${flashing ? phase + 1 : 0}|${probe.lastGoalId || ''}|${probe.lastScoredFor || ''}|${INK.home}|${INK.away}`;

    if (board.lastKey === key) continue;
    board.lastKey = key;

    if (board.side === 'end') {
      drawEndBoard(board, probe, { clock, flashing, phase });
    } else {
      drawSideBoard(board, probe, { clock, flashing, phase });
    }

    board.texture.needsUpdate = true;
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

  const lit = view.flashing && view.phase === 1;
  ctx.fillStyle = lit ? INK.panelFlash : INK.panelIdle;
  ctx.fillRect(0, 0, W, H);

  // Recessed architectural border frame with clean 8px inset
  ctx.strokeStyle = lit ? INK.flashInk : INK.screenBorder;
  ctx.lineWidth = 5;
  ctx.strokeRect(8, 8, W - 16, H - 16);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (view.flashing) {
    const scoredAt = probe.lastGoalId || (probe.targetGoal === 'N' ? 'S' : 'N');
    const scoringTeam = probe.lastScoredFor ? probe.lastScoredFor.toUpperCase() : 'GOAL';
    const ink = lit ? INK.flashInk : INK.panelFlash;

    ctx.fillStyle = ink;
    ctx.font = `bold ${Math.round(H * 0.18)}px ui-monospace, Consolas, monospace`;
    ctx.fillText('★  GOAL!  ★', W / 2, H * 0.22);

    ctx.font = `bold ${Math.round(H * 0.10)}px ui-monospace, Consolas, monospace`;
    ctx.fillText(
      `${scoringTeam} SCORED AT GOAL ${scoredAt === 'N' ? 'NORTH' : 'SOUTH'}`,
      W / 2,
      H * 0.46,
    );

    // Score on bottom
    ctx.font = `bold ${Math.round(H * 0.24)}px ui-monospace, Consolas, monospace`;
    ctx.fillText(`${probe.scoreHome} - ${probe.scoreAway}`, W / 2, H * 0.76);
    return;
  }

  // ─── STANDING END BOARD ──────────────────────────────────────────────────

  // 1. TOP HEADER: Which team is attacking THIS specific goal!
  // North board: targetGoal == 'N' means Home attacks North; 'S' means Away attacks North.
  // South board: targetGoal == 'S' means Home attacks South; 'N' means Away attacks South.
  const isNorth = board.key === 'north';
  const homeAttacksThis = isNorth ? (probe.targetGoal === 'N') : (probe.targetGoal === 'S');
  const attackingTeam = homeAttacksThis ? 'HOME' : 'AWAY';
  const teamColor = homeAttacksThis ? INK.home : INK.away;

  // Inset pill safely below top frame
  const pillW = Math.round(W * 0.84);
  const pillH = Math.round(H * 0.135);
  const pillX = Math.round((W - pillW) / 2);
  const pillY = Math.round(H * 0.065);

  ctx.fillStyle = homeAttacksThis ? INK.homeTint : INK.awayTint;
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, pillH, 8);
  ctx.fill();
  ctx.strokeStyle = teamColor;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = teamColor;
  ctx.font = `bold ${Math.round(H * 0.068)}px ui-monospace, Consolas, monospace`;
  const thisGoalName = isNorth ? 'NORTH' : 'SOUTH';
  ctx.fillText(`●  ${attackingTeam} ATTACKING GOAL ${thisGoalName}  ●`, W / 2, pillY + pillH / 2);

  // 2. MIDDLE ROW: Match Clock / Practice Status / Full Time
  ctx.fillStyle = probe.matchOver ? INK.away : INK.value;
  ctx.font = `bold ${Math.round(H * 0.14)}px ui-monospace, Consolas, monospace`;
  ctx.fillText(probe.matchOver ? 'FULL TIME' : view.clock, W / 2, H * 0.33);

  // Thin separator rule
  ctx.strokeStyle = INK.rule;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W * 0.10, H * 0.47);
  ctx.lineTo(W * 0.90, H * 0.47);
  ctx.stroke();

  // 3. BOTTOM ROW: THE PROMINENT SCORE LINE (as requested)
  ctx.font = `bold ${Math.round(H * 0.075)}px ui-monospace, Consolas, monospace`;
  ctx.fillStyle = INK.home;
  ctx.fillText('HOME', W * 0.30, H * 0.57);
  ctx.fillStyle = INK.away;
  ctx.fillText('AWAY', W * 0.70, H * 0.57);

  // Bold score numbers
  ctx.font = `bold ${Math.round(H * 0.23)}px ui-monospace, Consolas, monospace`;
  ctx.fillStyle = INK.value;
  ctx.fillText(String(probe.scoreHome), W * 0.30, H * 0.78);
  ctx.fillText(String(probe.scoreAway), W * 0.70, H * 0.78);

  ctx.fillStyle = INK.label;
  ctx.font = `bold ${Math.round(H * 0.15)}px ui-monospace, Consolas, monospace`;
  ctx.fillText('-', W * 0.50, H * 0.77);
}

/**
 * Draws the East or West centerline ribbon scoreboard (2048 x 256).
 *
 * Prominently widened (~8.75:1): Left & right flanks show directional visual indicators
 * of which team is attacking toward the North and South goals with generous padding for
 * the full "ATTACKING GOAL NORTH/SOUTH" text. Center column holds the clock on top and
 * the score line on the bottom.
 */
function drawSideBoard(board, probe, view) {
  const ctx = board.context;
  const W = board.canvas.width;
  const H = board.canvas.height;

  const lit = view.flashing && view.phase === 1;
  ctx.fillStyle = lit ? INK.panelFlash : INK.panelIdle;
  ctx.fillRect(0, 0, W, H);

  // Recessed architectural border frame
  ctx.strokeStyle = lit ? INK.flashInk : INK.screenBorder;
  ctx.lineWidth = 5;
  ctx.strokeRect(2.5, 2.5, W - 5, H - 5);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (view.flashing) {
    const scoredAt = probe.lastGoalId || (probe.targetGoal === 'N' ? 'S' : 'N');
    const scoringTeam = probe.lastScoredFor ? probe.lastScoredFor.toUpperCase() : 'GOAL';
    const ink = lit ? INK.flashInk : INK.panelFlash;

    ctx.fillStyle = ink;
    ctx.font = `bold ${Math.round(H * 0.28)}px ui-monospace, Consolas, monospace`;
    ctx.fillText(`★  GOAL SCORED BY ${scoringTeam}  ★`, W / 2, H * 0.32);

    ctx.font = `bold ${Math.round(H * 0.32)}px ui-monospace, Consolas, monospace`;
    ctx.fillText(
      `SCORED AT GOAL ${scoredAt === 'N' ? 'NORTH' : 'SOUTH'}  |  HOME ${probe.scoreHome} - ${probe.scoreAway} AWAY`,
      W / 2,
      H * 0.72,
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

  const rightTeam = leftIsNorth ? teamAttackingSouth : teamAttackingNorth;
  const rightColor = leftIsNorth ? colorAttackingSouth : colorAttackingNorth;
  const rightGoalLabel = leftIsNorth ? 'GOAL SOUTH' : 'GOAL NORTH';

  // 1. LEFT FLANK (Directional attack indicator toward left goal)
  // Generous 692px box gives the 420px "ATTACKING GOAL X" text ~136px padding on each side.
  const flankW = 692;
  const flankH = Math.round(H * 0.74);
  const flankY = Math.round((H - flankH) / 2);
  const leftX = 24;

  ctx.fillStyle = leftTeam === 'HOME' ? INK.homeTint : INK.awayTint;
  ctx.beginPath();
  ctx.roundRect(leftX, flankY, flankW, flankH, 8);
  ctx.fill();
  ctx.strokeStyle = leftColor;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = leftColor;
  ctx.font = `bold ${Math.round(H * 0.21)}px ui-monospace, Consolas, monospace`;
  ctx.fillText(`◀  ${leftTeam}`, leftX + flankW / 2, flankY + flankH * 0.36);

  ctx.fillStyle = '#e6f1fc';
  ctx.font = `bold ${Math.round(H * 0.135)}px ui-monospace, Consolas, monospace`;
  ctx.fillText(`ATTACKING ${leftGoalLabel}`, leftX + flankW / 2, flankY + flankH * 0.74);

  // 2. RIGHT FLANK (Directional attack indicator toward right goal)
  const rightX = W - flankW - 24;

  ctx.fillStyle = rightTeam === 'HOME' ? INK.homeTint : INK.awayTint;
  ctx.beginPath();
  ctx.roundRect(rightX, flankY, flankW, flankH, 8);
  ctx.fill();
  ctx.strokeStyle = rightColor;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = rightColor;
  ctx.font = `bold ${Math.round(H * 0.21)}px ui-monospace, Consolas, monospace`;
  ctx.fillText(`${rightTeam}  ▶`, rightX + flankW / 2, flankY + flankH * 0.36);

  ctx.fillStyle = '#e6f1fc';
  ctx.font = `bold ${Math.round(H * 0.135)}px ui-monospace, Consolas, monospace`;
  ctx.fillText(`ATTACKING ${rightGoalLabel}`, rightX + flankW / 2, flankY + flankH * 0.74);

  // 3. CENTER COLUMN: Clock on top, SCORE LINE ON BOTTOM
  const centerX = W / 2;

  // Vertical boundary dividers separating flanks from center
  ctx.strokeStyle = INK.rule;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(leftX + flankW + 12, H * 0.12);
  ctx.lineTo(leftX + flankW + 12, H * 0.88);
  ctx.moveTo(rightX - 12, H * 0.12);
  ctx.lineTo(rightX - 12, H * 0.88);
  ctx.stroke();

  // Match clock on upper half
  ctx.fillStyle = probe.matchOver ? INK.away : INK.value;
  ctx.font = `bold ${Math.round(H * 0.20)}px ui-monospace, Consolas, monospace`;
  ctx.fillText(probe.matchOver ? 'FULL TIME' : view.clock, centerX, H * 0.28);

  // SCORE LINE ON THE BOTTOM (as requested)
  ctx.font = `bold ${Math.round(H * 0.13)}px ui-monospace, Consolas, monospace`;
  ctx.fillStyle = INK.home;
  ctx.fillText('HOME', centerX - 170, H * 0.70);

  ctx.font = `bold ${Math.round(H * 0.32)}px ui-monospace, Consolas, monospace`;
  ctx.fillStyle = INK.value;
  ctx.fillText(String(probe.scoreHome), centerX - 82, H * 0.70);

  ctx.fillStyle = INK.label;
  ctx.font = `bold ${Math.round(H * 0.22)}px ui-monospace, Consolas, monospace`;
  ctx.fillText('-', centerX, H * 0.69);

  ctx.font = `bold ${Math.round(H * 0.32)}px ui-monospace, Consolas, monospace`;
  ctx.fillStyle = INK.value;
  ctx.fillText(String(probe.scoreAway), centerX + 82, H * 0.70);

  ctx.font = `bold ${Math.round(H * 0.13)}px ui-monospace, Consolas, monospace`;
  ctx.fillStyle = INK.away;
  ctx.fillText('AWAY', centerX + 170, H * 0.70);
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
  for (const geometry of Object.values(handle.geometry)) geometry.dispose();
}
