import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { displayCoordinator } from './displayCoordinator.js';

/**
 * THE FOUR IN-ARENA HUSTLE BOARDS — diegetic stadium video screens.
 *
 * Four rhombus / slanted-trapezoid video screens mounted on the vertical
 * boundary walls, symmetrically flanking both court halves (North and South
 * halves of both East and West walls).
 *
 * RESOURCE OPTIMIZATION:
 * - Practice Mode: All 4 boards share a SINGLE (1) GPU texture and canvas,
 *   reducing 2D draw costs and VRAM PCIe bandwidth by 75%.
 * - 1v1 Match Mode: Home boards share 1 texture, Away boards share 1 texture.
 * - Texture uploads are coordinated through displayCoordinator so at most 1
 *   texture upload occurs per frame, completely eliminating 1-second clock hitching.
 */

const FACING = {
  east: -Math.PI / 2, // Faces West (-X) into court
  west: Math.PI / 2,  // Faces East (+X) into court
};

function getTeamHex(team = 'home') {
  const p = TUNING.athlete?.palette;
  const num = team === 'away' ? (p?.awayPrimary ?? 0x1d4ed8) : (p?.homePrimary ?? 0xd90429);
  return '#' + num.toString(16).padStart(6, '0');
}

export function createHustleBoards(scene) {
  const cfg = TUNING.hustleBoard;
  if (!cfg || !cfg.enabled) {
    console.log('[hustleBoards] disabled in tuning; none built');
    return null;
  }

  const group = new THREE.Group();
  group.name = 'hustleBoards';

  const W = cfg.canvasWidth || 1024;
  const H = cfg.canvasHeight || 640;

  const width = cfg.width ?? 6.4;
  const height = cfg.height ?? 2.4;
  const centerY = cfg.centerY ?? 10.8;
  const centerZSouth = cfg.centerZSouth ?? 25.0;
  const centerZNorth = cfg.centerZNorth ?? -25.0;
  const posX = cfg.posX ?? 24.98;

  const planeGeom = new THREE.PlaneGeometry(width, height);

  function createChannel(name) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const context = canvas.getContext('2d');

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.FrontSide,
      toneMapped: false,
    });

    return {
      name,
      canvas,
      context,
      texture,
      material,
      dirty: true,
      lastKey: null,
      pendingData: null,
      pendingOutlineColor: null,
    };
  }

  // Two shared channels: Home and Away
  const channels = {
    home: createChannel('home'),
    away: createChannel('away'),
  };

  // Board definitions: 4 symmetrical rectangular boards flanking North and South
  const boardConfigs = [
    {
      key: 'east-south',
      side: 'east',
      team: 'home',
      x: posX,
      y: centerY,
      z: centerZSouth,
    },
    {
      key: 'east-north',
      side: 'east',
      team: 'away',
      x: posX,
      y: centerY,
      z: centerZNorth,
    },
    {
      key: 'west-south',
      side: 'west',
      team: 'away',
      x: -posX,
      y: centerY,
      z: centerZSouth,
    },
    {
      key: 'west-north',
      side: 'west',
      team: 'home',
      x: -posX,
      y: centerY,
      z: centerZNorth,
    },
  ];

  const boards = boardConfigs.map((spec) => {
    const isHome = spec.team === 'home';
    const channel = isHome ? channels.home : channels.away;

    const displayMesh = new THREE.Mesh(planeGeom, channel.material);
    displayMesh.name = `screen-${spec.key}`;
    displayMesh.frustumCulled = true;

    const pivot = new THREE.Group();
    pivot.name = `hustleBoard-${spec.key}`;
    pivot.position.set(spec.x, spec.y, spec.z);
    pivot.rotation.y = FACING[spec.side];
    pivot.add(displayMesh);

    group.add(pivot);

    return {
      spec,
      displayMesh,
      mesh: pivot,
    };
  });

  scene.add(group);

  console.log(
    `[hustleBoards] 4 rectangular boards built with shared channels (${W}x${H}): ${width}m x ${height}m, center y=${centerY}m, ` +
      `|z|=${Math.abs(centerZSouth)}m on |x| ${posX}m`,
  );

  return {
    group,
    boards,
    channels,
    channelCursor: 0,
    meshes: boards.map((b) => b.mesh),
    canvas: channels.home.canvas,
    texture: channels.home.texture,
  };
}

/**
 * Redraws the Hustle Boards if stats, time, or celebration state changed.
 */
export function updateHustleBoards(
  handle,
  practiceStats = {},
  sessionSeconds = 0,
  isPracticeActive = false,
  celebrationTicks = 0,
  matchProbe = null,
  athletes = null,
  athleteMatchStats = null,
) {
  if (!handle || !handle.channels) return;

  const cfg = TUNING.hustleBoard || {};
  const flashing = celebrationTicks > 0;
  const phase = flashing ? Math.floor(celebrationTicks / (cfg.flashTicks || 15)) % 2 : 0;

  const homeColor = getTeamHex('home');
  const awayColor = getTeamHex('away');
  const p1Team = TUNING.players[0]?.team || 'home';
  const p1CustomColor = TUNING.players[0]?.primaryColor;
  const practiceColor = p1CustomColor != null ? '#' + p1CustomColor.toString(16).padStart(6, '0') : getTeamHex(p1Team);

  const isMatch = !!(matchProbe && matchProbe.mode === 'match');

  // Assign materials to meshes based on mode
  if (isPracticeActive) {
    for (const b of handle.boards) {
      if (b.displayMesh.material !== handle.channels.home.material) {
        b.displayMesh.material = handle.channels.home.material;
      }
    }
  } else {
    for (const b of handle.boards) {
      const targetMat = b.spec.team === 'home' ? handle.channels.home.material : handle.channels.away.material;
      if (b.displayMesh.material !== targetMat) {
        b.displayMesh.material = targetMat;
      }
    }
  }

  // 1. Prepare data for home channel (Practice or Match Home or Standby)
  let dataHome, outlineColorHome;
  if (isPracticeActive) {
    const goals = practiceStats.goals || 0;
    const hits = practiceStats.hits || 0;
    const whiffs = practiceStats.whiffs || 0;
    const sweetSpots = practiceStats.sweetSpots || 0;
    const spikes = practiceStats.spikes || 0;
    const dives = practiceStats.dives || 0;
    const divingHits = practiceStats.divingHits || 0;
    const touches = practiceStats.totalTouches || 0;
    const attempts = hits + whiffs;
    const accuracy = attempts > 0 ? Math.round((hits / attempts) * 100) : 0;

    dataHome = {
      mode: 'practice',
      titleBadge: 'SOLO PRACTICE TELEMETRY',
      badgeText: 'SOLO PRACTICE',
      goals,
      accuracy,
      hits,
      whiffs,
      sweetSpots,
      spikes,
      dives,
      divingHits,
      touches,
      flashing,
      phase,
    };
    outlineColorHome = practiceColor;
  } else if (isMatch) {
    const athlete0 = athletes ? athletes[0] : null;
    const a0Strike = athlete0?.getStrikeStats() || {};
    const matchStats0 = (athleteMatchStats && athleteMatchStats[0]) || {};
    const hits0 = a0Strike.hits || 0;
    const whiffs0 = a0Strike.whiffs || 0;
    const attempts0 = hits0 + whiffs0;
    const accuracy0 = attempts0 > 0 ? Math.round((hits0 / attempts0) * 100) : 0;
    const goals0 = matchProbe.scoreHome || 0;

    dataHome = {
      mode: 'match',
      titleBadge: 'HOME ATHLETE TELEMETRY',
      badgeText: 'HOME ATHLETE',
      goals: goals0,
      accuracy: accuracy0,
      hits: hits0,
      whiffs: whiffs0,
      sweetSpots: matchStats0.sweetSpotHits || 0,
      spikes: matchStats0.spikes || 0,
      dives: matchStats0.dives || 0,
      divingHits: matchStats0.divingHits || 0,
      touches: matchStats0.totalTouches || 0,
      flashing,
      phase,
    };
    outlineColorHome = homeColor;
  } else {
    dataHome = {
      mode: 'standby',
      titleBadge: 'HOME COURT SIGHTLINE',
      badgeText: 'STANDBY',
      goals: 0,
      accuracy: 0,
      hits: 0,
      whiffs: 0,
      sweetSpots: 0,
      spikes: 0,
      dives: 0,
      divingHits: 0,
      touches: 0,
      flashing: false,
      phase: 0,
    };
    outlineColorHome = homeColor;
  }

  const keyHome = `home|${dataHome.mode}|${outlineColorHome}|${dataHome.goals}|${dataHome.hits}|${dataHome.whiffs}|${dataHome.sweetSpots}|${dataHome.spikes}|${dataHome.dives}|${dataHome.divingHits}|${dataHome.touches}|${dataHome.badgeText}|${flashing ? phase + 1 : 0}`;
  handle.channels.home.pendingData = dataHome;
  handle.channels.home.pendingOutlineColor = outlineColorHome;
  handle.channels.home.pendingKey = keyHome;
  if (handle.channels.home.lastKey !== keyHome) {
    handle.channels.home.dirty = true;
  }

  // 2. Prepare data for away channel (only needed in Match mode or Standby)
  if (isMatch || (!isPracticeActive && !isMatch)) {
    let dataAway, outlineColorAway;
    if (isMatch) {
      const athlete1 = athletes ? athletes[1] : null;
      const a1Strike = athlete1?.getStrikeStats() || {};
      const matchStats1 = (athleteMatchStats && athleteMatchStats[1]) || {};
      const hits1 = a1Strike.hits || 0;
      const whiffs1 = a1Strike.whiffs || 0;
      const attempts1 = hits1 + whiffs1;
      const accuracy1 = attempts1 > 0 ? Math.round((hits1 / attempts1) * 100) : 0;
      const goals1 = matchProbe.scoreAway || 0;

      dataAway = {
        mode: 'match',
        titleBadge: 'AWAY ATHLETE TELEMETRY',
        badgeText: 'AWAY ATHLETE',
        goals: goals1,
        accuracy: accuracy1,
        hits: hits1,
        whiffs: whiffs1,
        sweetSpots: matchStats1.sweetSpotHits || 0,
        spikes: matchStats1.spikes || 0,
        dives: matchStats1.dives || 0,
        divingHits: matchStats1.divingHits || 0,
        touches: matchStats1.totalTouches || 0,
        flashing,
        phase,
      };
      outlineColorAway = awayColor;
    } else {
      dataAway = {
        mode: 'standby',
        titleBadge: 'AWAY COURT SIGHTLINE',
        badgeText: 'STANDBY',
        goals: 0,
        accuracy: 0,
        hits: 0,
        whiffs: 0,
        sweetSpots: 0,
        spikes: 0,
        dives: 0,
        divingHits: 0,
        touches: 0,
        flashing: false,
        phase: 0,
      };
      outlineColorAway = awayColor;
    }

    const keyAway = `away|${dataAway.mode}|${outlineColorAway}|${dataAway.goals}|${dataAway.hits}|${dataAway.whiffs}|${dataAway.sweetSpots}|${dataAway.spikes}|${dataAway.dives}|${dataAway.divingHits}|${dataAway.touches}|${dataAway.badgeText}|${flashing ? phase + 1 : 0}`;
    handle.channels.away.pendingData = dataAway;
    handle.channels.away.pendingOutlineColor = outlineColorAway;
    handle.channels.away.pendingKey = keyAway;
    if (handle.channels.away.lastKey !== keyAway) {
      handle.channels.away.dirty = true;
    }
  } else {
    handle.channels.away.dirty = false;
  }

  // 3. Goal Flashing: update dirty immediately for synchronized celebration
  if (flashing) {
    if (handle.channels.home.dirty) {
      drawHustleBoard(handle.channels.home.context, handle.channels.home.canvas.width, handle.channels.home.canvas.height, handle.channels.home.pendingData, handle.channels.home.pendingOutlineColor);
      handle.channels.home.texture.needsUpdate = true;
      handle.channels.home.lastKey = handle.channels.home.pendingKey;
      handle.channels.home.dirty = false;
    }
    if (isMatch && handle.channels.away.dirty) {
      drawHustleBoard(handle.channels.away.context, handle.channels.away.canvas.width, handle.channels.away.canvas.height, handle.channels.away.pendingData, handle.channels.away.pendingOutlineColor);
      handle.channels.away.texture.needsUpdate = true;
      handle.channels.away.lastKey = handle.channels.away.pendingKey;
      handle.channels.away.dirty = false;
    }
    return;
  }

  // 4. Smooth upload scheduled within displayCoordinator budget (at most 1 per frame)
  if (!displayCoordinator.canUpload()) return;

  const activeChannels = isPracticeActive ? [handle.channels.home] : [handle.channels.home, handle.channels.away];
  if (handle.channelCursor === undefined) handle.channelCursor = 0;

  for (let step = 0; step < activeChannels.length; step++) {
    const idx = (handle.channelCursor + step) % activeChannels.length;
    const ch = activeChannels[idx];
    if (ch.dirty) {
      drawHustleBoard(ch.context, ch.canvas.width, ch.canvas.height, ch.pendingData, ch.pendingOutlineColor);
      ch.texture.needsUpdate = true;
      displayCoordinator.consumeUpload();
      ch.lastKey = ch.pendingKey;
      ch.dirty = false;
      handle.channelCursor = (idx + 1) % activeChannels.length;
      break;
    }
  }
}

function isDarkColor(hex) {
  if (!hex) return false;
  const num = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < 70;
}

function drawHustleBoard(ctx, W, H, data, outlineColor) {
  const darkOutline = isDarkColor(outlineColor);
  const effectiveOutline = darkOutline ? '#e2e8f0' : outlineColor;
  const scale = H / 800;

  // Background
  const isGoalLit = data.flashing && data.phase === 1;
  ctx.fillStyle = isGoalLit ? '#f59e0b' : '#060a12';
  ctx.fillRect(0, 0, W, H);

  // Subtle angled stadium speedlines
  ctx.strokeStyle = isGoalLit ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.025)';
  ctx.lineWidth = 1.5;
  for (let x = -H; x < W + H; x += 40 * scale) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + H * 0.35, H);
    ctx.stroke();
  }

  // Outer glowing architectural border in dynamic team color (no CPU shadowBlur)
  ctx.strokeStyle = isGoalLit ? '#1c1917' : effectiveOutline;
  ctx.lineWidth = Math.max(4, Math.round(8 * scale));
  ctx.strokeRect(6, 6, W - 12, H - 12);

  // HEADER BAR (Maximized)
  const headerH = Math.round(96 * scale);
  ctx.fillStyle = isGoalLit ? 'rgba(0, 0, 0, 0.15)' : 'rgba(10, 16, 28, 0.96)';
  ctx.fillRect(16, 16, W - 32, headerH);
  ctx.strokeStyle = isGoalLit ? '#1c1917' : effectiveOutline;
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, W - 32, headerH);

  // Header Title
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `900 ${Math.round(46 * scale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  if (darkOutline && !isGoalLit) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 4;
    ctx.strokeText('⚡ HUSTLE BOARD', 38, 16 + headerH / 2);
  }
  ctx.fillStyle = isGoalLit ? '#1c1917' : outlineColor;
  ctx.fillText('⚡ HUSTLE BOARD', 38, 16 + headerH / 2);

  // Telemetry Badge Pill in Header (right-aligned, enlarged and bold)
  const badge = data.badgeText || 'LIVE TELEMETRY';
  ctx.font = `900 ${Math.round(36 * scale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  const badgeWidth = ctx.measureText(badge).width + Math.round(52 * scale);
  const badgeHeight = Math.round(62 * scale);
  const badgeX = W - 32 - badgeWidth;
  const badgeY = 16 + (headerH - badgeHeight) / 2;

  ctx.fillStyle = isGoalLit ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.12)';
  ctx.strokeStyle = isGoalLit ? '#1c1917' : effectiveOutline;
  ctx.lineWidth = 2;
  ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
  ctx.strokeRect(badgeX, badgeY, badgeWidth, badgeHeight);

  ctx.fillStyle = isGoalLit ? '#1c1917' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badge, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2);

  // IF GOAL FLASHING BANNER
  if (data.flashing) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isGoalLit ? '#1c1917' : '#f59e0b';
    ctx.font = `900 ${Math.round(52 * scale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.fillText('★  TARGET GOAL SCORED!  ★', W / 2, H * 0.40);

    ctx.font = `900 ${Math.round(38 * scale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.fillText(`TOTAL TARGET GOALS: ${data.goals}`, W / 2, H * 0.60);

    ctx.font = `700 ${Math.round(24 * scale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.fillText(`STRIKE ACCURACY: ${data.accuracy}% · SWEET SPOTS: ${data.sweetSpots}`, W / 2, H * 0.78);
    return;
  }

  // IF STANDBY MODE (not in practice or match)
  if (data.mode === 'standby') {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = `900 ${Math.round(48 * scale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.fillStyle = '#f8fafc';
    ctx.fillText('⚡ ARENA HUSTLE BOARD ⚡', W / 2, H * 0.35);

    ctx.font = `700 ${Math.round(24 * scale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('ENTER PRACTICE SANDBOX OR 1V1 MATCH FOR LIVE METRICS', W / 2, H * 0.48);

    const chips = [
      ['GOALS', 'ACCURACY %', 'SWEET SPOTS'],
      ['POWER SPIKES', 'GROUND DIVES', 'DIVING HITS'],
    ];
    const chipW = Math.round(280 * scale);
    chips.forEach((row, rIdx) => {
      const startX = (W - (row.length * (chipW + 16) - 16)) / 2;
      row.forEach((label, cIdx) => {
        const cx = startX + cIdx * (chipW + 16);
        const cy = H * 0.60 + rIdx * Math.round(54 * scale);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.1)';
        ctx.strokeStyle = effectiveOutline;
        ctx.lineWidth = 1.5;
        ctx.fillRect(cx, cy, chipW, Math.round(42 * scale));
        ctx.strokeRect(cx, cy, chipW, Math.round(42 * scale));

        ctx.fillStyle = effectiveOutline;
        ctx.font = `800 ${Math.round(15 * scale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
        ctx.fillText(label, cx + chipW / 2, cy + Math.round(21 * scale));
      });
    });

    ctx.font = `600 ${Math.round(16 * scale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.fillStyle = '#64748b';
    ctx.fillText('LIVE TELEMETRY ARMED · 4 ARENA SCREENS', W / 2, H * 0.90);
    return;
  }

  // ACTIVE TELEMETRY: 7 MAXIMIZED VERTICAL ROWS (Organized in Clear Rainbow Order)
  const startY = Math.round(124 * scale);
  const items = [
    { label: 'GOALS SCORED', num: `${data.goals}`, color: '#f43f5e' }, // Fiery Red
    { label: 'STRIKE ACCURACY', num: `${data.accuracy}%`, color: '#f97316' }, // Vibrant Orange
    { label: 'SWEET-SPOT HITS', num: `★ ${data.sweetSpots}`, color: '#fbbf24' }, // Amber Yellow
    { label: 'POWER SPIKES', num: `${data.spikes}`, color: '#10b981' }, // Emerald Green
    { label: 'GROUND DIVES', num: `${data.dives}`, color: '#38bdf8' }, // Cyber Cyan
    { label: 'DIVING HITS', num: `${data.divingHits}`, color: '#3b82f6' }, // Royal Dark Blue
    { label: 'TOUCHES', num: `${data.touches}`, color: '#a855f7' }, // Neon Purple
  ];
  const rowH = (H - startY - Math.round(14 * scale)) / items.length;

  items.forEach((item, idx) => {
    const yCenter = startY + idx * rowH + rowH / 2;

    // Subtle row divider line
    if (idx > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(28, startY + idx * rowH);
      ctx.lineTo(W - 28, startY + idx * rowH);
      ctx.stroke();
    }

    // Left: Maximized bold Stat Name with crisp high-contrast offset shadow
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(44 * scale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillText(item.label, 36, yCenter + 2);
    ctx.fillStyle = item.color;
    ctx.fillText(item.label, 34, yCenter);

    // Right: Maximized bold glowing Stat Number with crisp high-contrast offset shadow
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(66 * scale)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillText(item.num, W - 32, yCenter + 2);
    ctx.fillStyle = item.color;
    ctx.fillText(item.num, W - 34, yCenter);
  });
}
