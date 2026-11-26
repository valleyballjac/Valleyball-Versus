/**
 * Module: visuals/ballDropRing
 * Role: Optional diegetic 3D turf guides (all OFF by default, toggleable live in
 *   Match, Practice, and Replay Playback):
 *   1. Terrain-Conformal Rainbow Ball Halo (`ballDropRing`):
 *      - Continuously visible at all ball heights (including ground bounces/rolls)
 *        with zero clipping on curved Valley Court banks, mounds, and stream walls
 *        via per-vertex O(1) `courtHeightmap` projection.
 *      - Color maps smoothly across Valleyball's canonical 8-stop spectrum from
 *        turf (Signal Red / Ember Orange) through volley height (Gold / Emerald)
 *        and jump-spike arcs (Cyan / Cobalt) up to high hoop lobs (Violet / Magenta).
 *   2. Proximity-Faded Player Strike-Range Guide (`strikeRangeGuide`):
 *      - Subtle terrain-conformal reach ring around each active athlete's feet,
 *        sized to their live strike assist preset (Pure Sim / Standard / Casual).
 *      - Invisible during open play (> 6.5m from ball), gently fades in as the
 *        ball approaches, and brightens crisply when the ball enters hitting reach.
 * Frame Phase: Render.
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Purely visual meshes; zero colliders, zero sim writes.
 *   - LAW 8 (60 FPS Frame-Time Budget): Pre-allocated vertex buffers, zero per-frame
 *     allocations, zero Rapier raycasts, `castShadow = false`, and O(1) early exit when OFF.
 */

import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { getHudPrefs } from '../config/hudConfig.js';
import { getCourtFloorY } from '../ai/courtHeightmap.js';
import { getVisualTerrainY, getVisualTerrainSurface } from '../sim/arena.js';

const MAX_POOLED_RINGS = 4;
const MAX_POOLED_REACH_RINGS = 4;
const RING_SEGMENTS = 64;
const VERTS_PER_RING = (RING_SEGMENTS + 1) * 2;

const MAX_SCALE_HEIGHT_M = 12.0;
const SURFACE_LIFT_M = 0.085;
const REACH_SURFACE_LIFT_M = 0.075;
const COURT_RING_LIMIT_X = 24.88;
const COURT_RING_LIMIT_Z = 59.88;
const COURT_ENTITY_MAX_X = 26.5;
const COURT_ENTITY_MAX_Z = 62.5;

const _centerSurf = { y: 0, nx: 0, ny: 1, nz: 0 };
const _vertSurf = { y: 0, nx: 0, ny: 1, nz: 0 };

function sampleRingSurfaceY(x, z) {
  const visY = getVisualTerrainY(x, z);
  return visY !== null ? visY : getCourtFloorY(x, z);
}

function sampleRingSurface(x, z, out) {
  if (getVisualTerrainSurface(x, z, out)) return out;
  out.y = getCourtFloorY(x, z);
  out.nx = 0;
  out.ny = 1;
  out.nz = 0;
  return out;
}

function isInsideCourtEnvelope(x, z) {
  return (
    Number.isFinite(x) &&
    Number.isFinite(z) &&
    Math.abs(x) <= COURT_ENTITY_MAX_X &&
    Math.abs(z) <= COURT_ENTITY_MAX_Z
  );
}

// Proximity envelope for the optional player strike-range guide
const REACH_FADE_OUT_DIST_M = 6.5;
const REACH_FADE_IN_DIST_M = 2.4;
const REACH_BASE_PHYSICAL_M = 1.35; // Physical limb reach radius before assistRadius
const REACH_MAX_HEIGHT_M = 3.35;

// Canonical 8-stop Valleyball Brand Spectrum mapped to height above terrain (metres)
const RAINBOW_STOPS = [
  { h: 0.0, color: new THREE.Color(0xff2a42) },  // Signal Red (turf / kick zone)
  { h: 0.9, color: new THREE.Color(0xff6b00) },  // Ember Orange (low bounce)
  { h: 2.0, color: new THREE.Color(0xffd000) },  // Solar Gold (chest volley zone)
  { h: 3.2, color: new THREE.Color(0x10e56a) },  // Turf Emerald (head / jump-strike window)
  { h: 4.8, color: new THREE.Color(0x00e5ff) },  // Electric Cyan (mid arc)
  { h: 6.8, color: new THREE.Color(0x1f65ff) },  // Cobalt Blue (high arc)
  { h: 8.8, color: new THREE.Color(0x6b11ff) },  // Ultraviolet (hoop approach)
  { h: 11.0, color: new THREE.Color(0xe000b8) }, // Magenta (hoop apex 10m+)
];

const COLOR_CHALK_WHITE = new THREE.Color(0xf8fafc);
const _scratchColor = new THREE.Color();
const _teamColor = new THREE.Color();

// Precomputed unit-circle LUT for zero-allocation terrain-conformal ring vertex updates
const _cosLut = new Float32Array(RING_SEGMENTS + 1);
const _sinLut = new Float32Array(RING_SEGMENTS + 1);
for (let s = 0; s <= RING_SEGMENTS; s++) {
  const a = (s / RING_SEGMENTS) * Math.PI * 2;
  _cosLut[s] = Math.cos(a);
  _sinLut[s] = Math.sin(a);
}

/**
 * Builds a pre-indexed dynamic ribbon-ring BufferGeometry updated in world space
 * each frame so every vertex conforms directly to the Valley Court heightmap.
 */
function createConformalRingGeometry() {
  const positions = new Float32Array(VERTS_PER_RING * 3);
  const indices = new Uint16Array(RING_SEGMENTS * 6);
  for (let s = 0; s < RING_SEGMENTS; s++) {
    const i0 = s * 2;
    const i1 = i0 + 1;
    const i2 = i0 + 2;
    const i3 = i0 + 3;
    const base = s * 6;
    indices[base] = i0;
    indices[base + 1] = i1;
    indices[base + 2] = i2;
    indices[base + 3] = i2;
    indices[base + 4] = i1;
    indices[base + 5] = i3;
  }
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(positions, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/**
 * Projects a surface-conformal annulus `(cx, cz, innerR, outerR)` onto the
 * C²-smooth visual Valley Court surface using a local tangent-plane basis and
 * surface-normal offset (zero allocations, zero cell-edge waves, uniform width
 * across steep curved upper embankments).
 */
function projectRingToTerrain(geometry, cx, cz, innerR, outerR, liftM) {
  const attr = geometry.attributes.position;
  const arr = attr.array;

  // Orthonormal tangent-plane basis at ring center so steep curved embankments
  // preserve true surface radius and ribbon thickness without vertical wave distortion.
  sampleRingSurface(cx, cz, _centerSurf);
  const cnx = _centerSurf.nx;
  const cny = _centerSurf.ny;
  const cnz = _centerSurf.nz;

  const t1Len = Math.hypot(cny, cnx) || 1;
  const t1x = cny / t1Len;
  const t1z = 0;

  const t2RawX = -cnx * cnz;
  const t2RawY = -cny * cnz;
  const t2RawZ = cnx * cnx + cny * cny;
  const t2Len = Math.hypot(t2RawX, t2RawY, t2RawZ) || 1;
  const t2x = t2RawX / t2Len;
  const t2z = t2RawZ / t2Len;

  const useNormalLift = liftM > 0;

  for (let s = 0; s <= RING_SEGMENTS; s++) {
    const cos = _cosLut[s];
    const sin = _sinLut[s];
    const dxUnit = t1x * cos + t2x * sin;
    const dzUnit = t1z * cos + t2z * sin;

    const ixRaw = Math.max(-COURT_RING_LIMIT_X, Math.min(COURT_RING_LIMIT_X, cx + dxUnit * innerR));
    const izRaw = Math.max(-COURT_RING_LIMIT_Z, Math.min(COURT_RING_LIMIT_Z, cz + dzUnit * innerR));
    sampleRingSurface(ixRaw, izRaw, _vertSurf);
    const ix = useNormalLift ? ixRaw + _vertSurf.nx * liftM : ixRaw;
    const iy = useNormalLift ? _vertSurf.y + _vertSurf.ny * liftM : _vertSurf.y + liftM;
    const iz = useNormalLift ? izRaw + _vertSurf.nz * liftM : izRaw;

    const oxRaw = Math.max(-COURT_RING_LIMIT_X, Math.min(COURT_RING_LIMIT_X, cx + dxUnit * outerR));
    const ozRaw = Math.max(-COURT_RING_LIMIT_Z, Math.min(COURT_RING_LIMIT_Z, cz + dzUnit * outerR));
    sampleRingSurface(oxRaw, ozRaw, _vertSurf);
    const ox = useNormalLift ? oxRaw + _vertSurf.nx * liftM : oxRaw;
    const oy = useNormalLift ? _vertSurf.y + _vertSurf.ny * liftM : _vertSurf.y + liftM;
    const oz = useNormalLift ? ozRaw + _vertSurf.nz * liftM : ozRaw;

    const vInner = s * 6;
    arr[vInner] = ix;
    arr[vInner + 1] = iy;
    arr[vInner + 2] = iz;
    arr[vInner + 3] = ox;
    arr[vInner + 4] = oy;
    arr[vInner + 5] = oz;
  }
  attr.needsUpdate = true;
}

/**
 * Evaluates the canonical 8-stop Valleyball spectrum color for a height above terrain.
 * Writes into `outColor` with zero allocations.
 */
export function evaluateHeightRainbowColor(heightM, outColor = _scratchColor) {
  const h = Math.max(0, Number.isFinite(heightM) ? heightM : 0);
  const last = RAINBOW_STOPS.length - 1;
  if (h >= RAINBOW_STOPS[last].h) {
    return outColor.copy(RAINBOW_STOPS[last].color);
  }
  for (let i = 0; i < last; i++) {
    const a = RAINBOW_STOPS[i];
    const b = RAINBOW_STOPS[i + 1];
    if (h <= b.h) {
      const span = b.h - a.h;
      const t = span > 1e-6 ? (h - a.h) / span : 0;
      return outColor.copy(a.color).lerp(b.color, t);
    }
  }
  return outColor.copy(RAINBOW_STOPS[0].color);
}

/**
 * Creates pooled terrain-conformal 3D ball halos and optional player strike-range
 * reach rings mounted to the scene.
 *
 * @param {THREE.Scene} scene
 */
export function createBallDropRings(scene) {
  const group = new THREE.Group();
  group.name = 'ball-drop-rings';
  group.visible = false;

  const entries = [];
  for (let i = 0; i < MAX_POOLED_RINGS; i++) {
    const outerGeo = createConformalRingGeometry();
    const innerGeo = createConformalRingGeometry();

    const outerMat = new THREE.MeshBasicMaterial({
      color: 0xff2a42,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xff2a42,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    outerMesh.castShadow = false;
    outerMesh.receiveShadow = false;
    outerMesh.frustumCulled = false;
    outerMesh.renderOrder = 2;

    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    innerMesh.castShadow = false;
    innerMesh.receiveShadow = false;
    innerMesh.frustumCulled = false;
    innerMesh.renderOrder = 3;

    const pivot = new THREE.Group();
    pivot.name = `ball-drop-ring-${i}`;
    pivot.visible = false;
    pivot.add(outerMesh);
    pivot.add(innerMesh);
    group.add(pivot);

    entries.push({ pivot, outerGeo, innerGeo, outerMesh, innerMesh, outerMat, innerMat });
  }

  // Optional proximity-faded player strike-range guide rings (up to 4 active athletes)
  const reachEntries = [];
  for (let i = 0; i < MAX_POOLED_REACH_RINGS; i++) {
    const geo = createConformalRingGeometry();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `strike-reach-ring-${i}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.visible = false;
    group.add(mesh);
    reachEntries.push({ geo, mat, mesh });
  }

  // Pre-seed initial valid triangles below the court for shader warmup
  for (let i = 0; i < entries.length; i++) {
    projectRingToTerrain(entries[i].outerGeo, 0, 0, 0.5, 0.65, -20);
    projectRingToTerrain(entries[i].innerGeo, 0, 0, 0.12, 0.24, -20);
  }
  for (let i = 0; i < reachEntries.length; i++) {
    projectRingToTerrain(reachEntries[i].geo, 0, 0, 1.4, 1.5, -20);
  }

  scene.add(group);

  // Per-ball scratch flag tracking whether any athlete is currently in strike reach
  const _ballInStrikeReach = [false, false, false, false];

  return {
    group,
    entries,
    reachEntries,

    /**
     * Toggles one pooled ball halo and one reach ring visible for boot shader
     * compilation (`renderer.compile`), then restores them cleanly.
     */
    setWarmupVisible(visible) {
      group.visible = !!visible;
      if (entries[0]) entries[0].pivot.visible = !!visible;
      if (reachEntries[0]) reachEntries[0].mesh.visible = !!visible;
    },

    /**
     * Updates terrain-conformal rainbow ball halos and optional player strike-range
     * guides. Zero allocations per call; early-exits immediately when both are OFF.
     *
     * @param {object} params
     * @param {string} params.gameState
     * @param {Array<object>} params.balls
     * @param {Array<object>} [params.athletes]
     * @param {boolean} [params.isVictoryActive=false]
     */
    update({ gameState, balls, athletes = null, isVictoryActive = false }) {
      const prefs = getHudPrefs();
      const showBallRing = Boolean(prefs.ballDropRing);
      const showReachGuide = Boolean(prefs.strikeRangeGuide);
      const activeMode = (gameState === 'match' || gameState === 'practice') && !isVictoryActive;

      if ((!showBallRing && !showReachGuide) || !activeMode || !balls || balls.length === 0) {
        if (group.visible) group.visible = false;
        return;
      }

      let anyVisible = false;
      const ballCount = Math.min(balls.length, entries.length);
      for (let bIdx = 0; bIdx < MAX_POOLED_RINGS; bIdx++) _ballInStrikeReach[bIdx] = false;

      // 1. Optional Proximity-Faded Player Strike-Range Guide (computed first so
      //    overlapping ball halos can also pulse chalk-white on strike-window lock)
      const athCount = (showReachGuide && Array.isArray(athletes))
        ? Math.min(athletes.length, reachEntries.length)
        : 0;

      for (let i = 0; i < reachEntries.length; i++) {
        const rEntry = reachEntries[i];
        if (i >= athCount) {
          rEntry.mesh.visible = false;
          continue;
        }
        const ath = athletes[i];
        if (!ath || ath.isEnabled === false || !ath.motor?.mesh) {
          rEntry.mesh.visible = false;
          continue;
        }

        const ax = ath.motor.mesh.position.x;
        const az = ath.motor.mesh.position.z;
        if (!isInsideCourtEnvelope(ax, az)) {
          rEntry.mesh.visible = false;
          continue;
        }

        const athFloorY = sampleRingSurfaceY(ax, az);
        const assistR = ath.strikeState?.assistRadius ?? 0.45;
        const reachRadius = REACH_BASE_PHYSICAL_M + assistR;

        // Find nearest visible ball to this athlete
        let nearestDistXZ = Infinity;
        let nearestBallIdx = -1;
        let nearestBallRadius = 0.5;
        let nearestHeightAboveAth = Infinity;
        for (let bIdx = 0; bIdx < ballCount; bIdx++) {
          const b = balls[bIdx];
          const bp = b?.mesh?.position;
          if (!b || !bp || b.mesh.visible === false) continue;
          const dXZ = Math.hypot(bp.x - ax, bp.z - az);
          if (dXZ < nearestDistXZ) {
            nearestDistXZ = dXZ;
            nearestBallIdx = bIdx;
            nearestBallRadius = b.radius ?? 0.5;
            nearestHeightAboveAth = bp.y - athFloorY;
          }
        }

        if (nearestBallIdx < 0 || nearestDistXZ >= REACH_FADE_OUT_DIST_M) {
          rEntry.mesh.visible = false;
          continue;
        }

        const proxT = Math.min(
          1.0,
          Math.max(0.0, (REACH_FADE_OUT_DIST_M - nearestDistXZ) / (REACH_FADE_OUT_DIST_M - REACH_FADE_IN_DIST_M)),
        );
        const inStrikeEnvelope =
          nearestDistXZ <= (reachRadius + nearestBallRadius) &&
          nearestHeightAboveAth <= REACH_MAX_HEIGHT_M;

        if (inStrikeEnvelope) {
          _ballInStrikeReach[nearestBallIdx] = true;
        }

        const ringThickness = inStrikeEnvelope ? 0.105 : 0.065;
        projectRingToTerrain(
          rEntry.geo,
          ax,
          az,
          Math.max(0.25, reachRadius - ringThickness),
          reachRadius,
          REACH_SURFACE_LIFT_M,
        );

        const rawHex = ath.primaryColor
          ?? TUNING.players?.[i]?.primaryColor
          ?? (ath.team === 'away'
            ? (TUNING.athlete?.palette?.awayPrimary ?? 0x1d4ed8)
            : (TUNING.athlete?.palette?.homePrimary ?? 0xd90429));
        _teamColor.setHex(typeof rawHex === 'number' ? rawHex : 0x00e5ff);
        if (inStrikeEnvelope) {
          rEntry.mat.color.copy(_teamColor).lerp(COLOR_CHALK_WHITE, 0.72);
          rEntry.mat.opacity = 0.56;
        } else {
          rEntry.mat.color.copy(_teamColor).lerp(COLOR_CHALK_WHITE, 0.22);
          rEntry.mat.opacity = proxT * 0.26;
        }

        rEntry.mesh.visible = rEntry.mat.opacity > 0.015;
        if (rEntry.mesh.visible) anyVisible = true;
      }

      // 2. Terrain-Conformal Constant Rainbow Ball Halo (always visible, zero ground flash)
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!showBallRing || i >= ballCount) {
          entry.pivot.visible = false;
          continue;
        }
        const b = balls[i];
        const meshPos = b?.mesh?.position;
        if (!b || !meshPos || b.mesh.visible === false) {
          entry.pivot.visible = false;
          continue;
        }

        const bx = meshPos.x;
        const by = meshPos.y;
        const bz = meshPos.z;
        if (!isInsideCourtEnvelope(bx, bz)) {
          entry.pivot.visible = false;
          continue;
        }

        const ballRadius = b.radius ?? 0.5;
        const floorY = sampleRingSurfaceY(bx, bz);
        const height = Math.max(0, (by - ballRadius) - floorY);

        // Smoothly tightens down around ball base on turf; never disappears on bounces
        const heightFrac = Math.min(1.0, height / MAX_SCALE_HEIGHT_M);
        const outerR = ballRadius * (1.18 + heightFrac * 1.38);
        const ringBand = Math.max(0.085, outerR * 0.16);
        const innerOuterR = Math.max(0.14, ballRadius * (0.28 + (1.0 - heightFrac) * 0.14));
        const innerInnerR = Math.max(0.04, innerOuterR * 0.48);

        projectRingToTerrain(entry.outerGeo, bx, bz, Math.max(0.08, outerR - ringBand), outerR, SURFACE_LIFT_M);
        projectRingToTerrain(entry.innerGeo, bx, bz, innerInnerR, innerOuterR, SURFACE_LIFT_M + 0.006);

        evaluateHeightRainbowColor(height, _scratchColor);
        const inReach = _ballInStrikeReach[i];

        entry.outerMat.color.copy(_scratchColor);
        if (inReach) {
          entry.outerMat.color.lerp(COLOR_CHALK_WHITE, 0.30);
          entry.innerMat.color.copy(COLOR_CHALK_WHITE);
          entry.outerMat.opacity = 0.92;
          entry.innerMat.opacity = 0.88;
        } else {
          entry.innerMat.color.copy(_scratchColor).lerp(COLOR_CHALK_WHITE, 0.25);
          entry.outerMat.opacity = 0.52 + (1.0 - heightFrac) * 0.36;
          entry.innerMat.opacity = 0.36 + (1.0 - heightFrac) * 0.36;
        }

        entry.pivot.visible = true;
        anyVisible = true;
      }

      group.visible = anyVisible;
    },

    dispose() {
      scene.remove(group);
      for (const entry of entries) {
        entry.outerGeo.dispose();
        entry.innerGeo.dispose();
        entry.outerMat.dispose();
        entry.innerMat.dispose();
      }
      for (const rEntry of reachEntries) {
        rEntry.geo.dispose();
        rEntry.mat.dispose();
      }
    },
  };
}
