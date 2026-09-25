import * as THREE from 'three';

const MAX_PARTICLES = 256;
const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _color = new THREE.Color();

const _tempColor = new THREE.Color();
let _randSeed = 13371337;
function _fastRand() {
  _randSeed = (_randSeed * 1664525 + 1013904223) >>> 0;
  return _randSeed / 4294967296;
}

/**
 * Resolves the surface color of the pitch directly under a world-space point.
 * Accurately matches the authored geometry and materials of arena.glb:
 * - Chalk Lines: White (0xeeeeee / M_Lines)
 * - Center Circle (|pos| < 10m): Red (0xe62828 / M_Center Circle)
 * - Pick / Mound Area: Orange (0xff8c1a / M_Pick)
 * - Scoring Circles (|pos - [0, +-40]| < 9.8m outside pick): Yellow (0xffea47 / M_Scoring Circle)
 * - Stream Basins & Heads: Dark Blue (0x1a47ff / M_Stream Heads)
 * - Main Streams (|x| in [9.8, 15.8], |z| in (2.8, 37)): Light Blue (0x68aeff / M_Stream)
 * - Corners (|z| >= 37.5, outer quadrants): Purple (0x60349a / M_Corner)
 * - Terrain / Inner Field: Green (0x4da73b / M_Field)
 *
 * @param {{ x: number, y: number, z: number }} position
 * @param {'court'|'bowl'} [arenaType='court']
 * @returns {number} Hex color
 */
export function getPitchSurfaceColor(position, arenaType = 'court') {
  if (arenaType !== 'court' || !position) {
    return 0x3a8249; // Default bowl grass green
  }
  const x = position.x;
  const z = position.z;
  const absX = Math.abs(x);
  const absZ = Math.abs(z);
  const distCenter = Math.hypot(x, z);

  // --- 1. CHALK LINES (White: 0xeeeeee) ---
  // A. Center circle boundary ring (radius ~ 10m, thickness ~ 0.35m)
  if (Math.abs(distCenter - 10.0) <= 0.3) {
    return 0xeeeeee;
  }

  // B. Scoring circle outer boundary ring (radius ~ 9.8m around hoop at [0, +-40])
  const distHoop = Math.hypot(x, absZ - 40.0);
  if (Math.abs(distHoop - 9.8) <= 0.35) {
    return 0xeeeeee;
  }

  // C. Pick / Key mound boundary line:
  // Front edge at absZ ~ 34.13 for absX <= 6.8
  if (Math.abs(absZ - 34.13) <= 0.35 && absX <= 6.8) {
    return 0xeeeeee;
  }
  // Side edges of the key / pick
  let pickSideX = -1;
  if (absZ >= 34.0 && absZ <= 36.8) {
    pickSideX = 6.6 + (8.87 - 6.6) * ((absZ - 34.0) / 2.8);
  } else if (absZ > 36.8 && absZ <= 49.6) {
    pickSideX = 8.87 * (1.0 - (absZ - 36.8) / 12.8);
  }
  if (pickSideX > 0 && Math.abs(absX - pickSideX) <= 0.35) {
    return 0xeeeeee;
  }

  // D. Stream channel boundary lines (rims at |x| ~ 10.1 and |x| ~ 15.45)
  if (absZ <= 42.6) {
    if (Math.abs(absX - 10.1) <= 0.25 || Math.abs(absX - 15.45) <= 0.25) {
      return 0xeeeeee;
    }
    // Stream basin end rim (|z| ~ 2.67) and stream head rim (|z| ~ 42.6)
    if (absX >= 10.1 && absX <= 15.45) {
      if (Math.abs(absZ - 2.67) <= 0.25 || Math.abs(absZ - 42.6) <= 0.3) {
        return 0xeeeeee;
      }
    }
  }

  // E. Outer court boundaries (|x| ~ 25m or |z| ~ 60m)
  if (Math.abs(absX - 25.0) <= 0.4 || Math.abs(absZ - 60.0) <= 0.4) {
    return 0xeeeeee;
  }

  // --- 2. CENTER CIRCLE (Red: 0xe62828) ---
  if (distCenter < 10.0) {
    return 0xe62828;
  }

  // --- 3. PICK / MOUND (Orange: 0xff8c1a) ---
  if (pickSideX > 0 && absX < pickSideX && absZ >= 34.0 && absZ <= 49.6) {
    return 0xff8c1a;
  }

  // --- 4. SCORING CIRCLE (Yellow: 0xffea47) ---
  if (distHoop < 9.8) {
    return 0xffea47;
  }

  // --- 5. STREAMS & BASINS ---
  if (absX >= 9.8 && absX <= 15.8) {
    // Basin at midcourt: |z| <= 2.8m -> Dark Blue
    if (absZ <= 2.8) {
      return 0x1a47ff;
    }
    // Stream Head at ends: |z| in [37.0, 42.8m] -> Dark Blue
    if (absZ >= 37.0 && absZ <= 42.8) {
      return 0x1a47ff;
    }
    // Main Organic Stream channel: |z| in (2.8, 37.0m) -> Light Blue
    if (absZ < 37.0) {
      return 0x68aeff;
    }
  }

  // --- 6. CORNERS (Purple: 0x60349a) ---
  // In arena.glb, the corner field terrain (VIS_Outer Field Corner) is green (M_Field);
  // ONLY the elevated corner wall rim (Y >= 10.8m) or outer boundary edge is purple (M_Corner).
  if (absZ >= 37.5) {
    const isElevatedWall = (position.y !== undefined && position.y >= 10.8);
    const isBoundaryEdge = absX >= 24.5;
    if (isElevatedWall || isBoundaryEdge) {
      if (absX >= 15.0 || absZ >= 42.8) {
        return 0x60349a;
      }
    }
  }

  // --- 7. DEFAULT FIELD TERRAIN (Green: 0x4da73b) ---
  return 0x4da73b;
}

/**
 * Creates an ultra-lightweight instanced turf/cleat particle system.
 * Zero-allocation runtime: pre-allocates particle pools and updates transforms in place.
 *
 * @param {THREE.Scene} scene
 */
export function createTurfParticleSystem(scene) {
  // Low-poly turf/dust chunk geometry
  const geometry = new THREE.BoxGeometry(0.06, 0.04, 0.06);
  const material = new THREE.MeshLambertMaterial();

  const instancedMesh = new THREE.InstancedMesh(geometry, material, MAX_PARTICLES);
  instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  instancedMesh.count = 0;
  instancedMesh.frustumCulled = false;

  // Colors buffer
  const colors = new Float32Array(MAX_PARTICLES * 3);
  instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  instancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

  scene.add(instancedMesh);

  // Particle state arrays
  const px = new Float32Array(MAX_PARTICLES);
  const py = new Float32Array(MAX_PARTICLES);
  const pz = new Float32Array(MAX_PARTICLES);

  const vx = new Float32Array(MAX_PARTICLES);
  const vy = new Float32Array(MAX_PARTICLES);
  const vz = new Float32Array(MAX_PARTICLES);

  const life = new Float32Array(MAX_PARTICLES);
  const maxLife = new Float32Array(MAX_PARTICLES);
  const baseScale = new Float32Array(MAX_PARTICLES);
  const groundY = new Float32Array(MAX_PARTICLES);

  let activeCount = 0;

  /**
   * Spawns a spray of turf particles kicking back from an action.
   *
   * @param {object} options
   * @param {{ x: number, y: number, z: number }} options.position Ground contact point (turf level)
   * @param {{ x: number, y: number, z: number }} [options.direction] Movement heading (particles kick backward)
   * @param {number} [options.speed=4.0] Intensity / launch speed
   * @param {number} [options.count=4] Number of particles
   * @param {number|string|THREE.Color} [options.surfaceColor=0x2d7a3e] Surface turf color
   * @param {number} [options.trailOffset=0.35] Distance in meters to offset spawn behind player root
   * @param {boolean} [options.isSlide=false] Whether this is a slide (triggers broad fan & lateral spread)
   */
  function spawnTurfPuff({
    position,
    direction = null,
    speed = 4.0,
    count = 4,
    surfaceColor = 0x2d7a3e,
    trailOffset = 0.35,
    isSlide = false,
  }) {
    if (!position) return;
    _color.set(surfaceColor);

    // Direction to kick particles: backward from movement, or random if no direction
    let kickX = 0;
    let kickZ = 0;
    if (direction) {
      const len = Math.hypot(direction.x, direction.z);
      if (len > 1e-4) {
        kickX = -direction.x / len;
        kickZ = -direction.z / len;
      }
    }

    // Anchor spawn point directly at cleat contact height, set back along trailing push-off foot
    const originX = position.x + kickX * trailOffset;
    const originZ = position.z + kickZ * trailOffset;
    const originY = position.y;

    const spawnN = Math.min(count, MAX_PARTICLES - activeCount);
    for (let i = 0; i < spawnN; i += 1) {
      const idx = activeCount;
      activeCount += 1;

      // Position anchored at cleat/ankle height (elevated 8-15cm so it never clips underground on downhill slopes)
      const posJitter = isSlide ? 0.45 : 0.18;
      px[idx] = originX + (_fastRand() - 0.5) * posJitter;
      py[idx] = originY + (isSlide ? 0.05 : 0.09) + _fastRand() * 0.06;
      pz[idx] = originZ + (_fastRand() - 0.5) * posJitter;
      groundY[idx] = originY;

      // Velocity: wide spread for slides, flat long rooster-tail for running
      const angleJitter = isSlide ? ((_fastRand() - 0.5) * 1.5) : ((_fastRand() - 0.5) * 0.6);
      const cos = Math.cos(angleJitter);
      const sin = Math.sin(angleJitter);
      const baseDirX = kickX !== 0 || kickZ !== 0 ? (kickX * cos - kickZ * sin) : (_fastRand() - 0.5);
      const baseDirZ = kickX !== 0 || kickZ !== 0 ? (kickX * sin + kickZ * cos) : (_fastRand() - 0.5);

      const pSpeedMult = isSlide ? (0.95 + _fastRand() * 0.5) : (0.85 + _fastRand() * 0.4);
      const particleSpeed = (speed * pSpeedMult + _fastRand() * 1.2);
      vx[idx] = baseDirX * particleSpeed;
      vy[idx] = isSlide ? (0.35 + _fastRand() * 0.65) : (0.65 + _fastRand() * 0.65);
      vz[idx] = baseDirZ * particleSpeed;

      const dur = (isSlide ? 0.55 : 0.50) + _fastRand() * 0.35;
      life[idx] = dur;
      maxLife[idx] = dur;
      baseScale[idx] = (isSlide ? 0.8 : 0.65) + _fastRand() * 0.5;

      // Slight color variation on each blade/chunk without allocation
      const shade = 0.85 + _fastRand() * 0.3;
      _tempColor.copy(_color).multiplyScalar(shade);
      instancedMesh.setColorAt(idx, _tempColor);
    }
    instancedMesh.count = activeCount;
    instancedMesh.instanceColor.needsUpdate = true;
  }

  /**
   * Spawns an explosive, directional spray of turf when an athlete plants and cuts.
   * Features a dual-velocity fan: fast low-skimming specks and high-popping tumbling turf chunks.
   *
   * @param {object} options
   * @param {{ x: number, y: number, z: number }} options.position Cleat plant point (turf level)
   * @param {{ x: number, y: number, z: number }} [options.cutDir] Redirect heading (spray kicks backward)
   * @param {number} [options.speed=7.5] Intensity / launch speed
   * @param {number} [options.count=10] Number of particles in the spray
   * @param {number|string|THREE.Color} [options.surfaceColor=0x4da73b] Pitch element surface color
   * @param {number} [options.trailOffset=0.28] Distance in meters to offset spawn behind plant foot
   */
  function spawnCutSpray({
    position,
    cutDir = null,
    speed = 7.5,
    count = 10,
    surfaceColor = 0x4da73b,
    trailOffset = 0.28,
  }) {
    if (!position) return;
    _color.set(surfaceColor);

    // Cut kicks opposite to the new propulsion vector
    let kickX = 0;
    let kickZ = 0;
    if (cutDir) {
      const len = Math.hypot(cutDir.x, cutDir.z);
      if (len > 1e-4) {
        kickX = -cutDir.x / len;
        kickZ = -cutDir.z / len;
      }
    }

    // Anchor at cleat plant point trailing slightly opposite cut heading
    const originX = position.x + kickX * trailOffset;
    const originZ = position.z + kickZ * trailOffset;
    const originY = position.y;

    const spawnN = Math.min(count, MAX_PARTICLES - activeCount);
    for (let i = 0; i < spawnN; i += 1) {
      const idx = activeCount;
      activeCount += 1;

      // Position anchored at feet / turf surface
      px[idx] = originX + (_fastRand() - 0.5) * 0.22;
      py[idx] = originY + 0.08 + _fastRand() * 0.06;
      pz[idx] = originZ + (_fastRand() - 0.5) * 0.22;
      groundY[idx] = originY;

      // Fan angle jitter (+- 50 degrees)
      const angleJitter = (_fastRand() - 0.5) * 1.0;
      const cos = Math.cos(angleJitter);
      const sin = Math.sin(angleJitter);
      const dirX = kickX !== 0 || kickZ !== 0 ? (kickX * cos - kickZ * sin) : (_fastRand() - 0.5);
      const dirZ = kickX !== 0 || kickZ !== 0 ? (kickX * sin + kickZ * cos) : (_fastRand() - 0.5);

      const isSkimmer = i % 2 === 0;
      const particleSpeed = isSkimmer ? (speed * 0.95 + _fastRand() * 2.2) : (speed * 0.65 + _fastRand() * 1.5);
      vx[idx] = dirX * particleSpeed;
      vy[idx] = isSkimmer ? (0.4 + _fastRand() * 0.6) : (1.1 + _fastRand() * 0.9);
      vz[idx] = dirZ * particleSpeed;

      const dur = 0.55 + _fastRand() * 0.35;
      life[idx] = dur;
      maxLife[idx] = dur;
      baseScale[idx] = (isSkimmer ? 0.6 : 0.85) + _fastRand() * 0.45;

      // Subtle natural tone variation
      const shade = 0.85 + _fastRand() * 0.3;
      _tempColor.copy(_color).multiplyScalar(shade);
      instancedMesh.setColorAt(idx, _tempColor);
    }
    instancedMesh.count = activeCount;
    instancedMesh.instanceColor.needsUpdate = true;
  }

  /**
   * Advances particle physics and updates instanced transforms.
   * @param {number} dt delta seconds
   */
  function update(dt) {
    if (activeCount === 0) {
      instancedMesh.count = 0;
      return;
    }

    const gravity = 14.0;
    let alive = 0;

    for (let i = 0; i < activeCount; i += 1) {
      life[i] -= dt;
      if (life[i] <= 0) continue;

      // Physics: lower horizontal damping for longer, flatter rooster tail arc
      vy[i] -= gravity * dt;
      vx[i] *= 0.975;
      vz[i] *= 0.975;

      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      pz[i] += vz[i] * dt;

      // Ground bounce / settle at the particle's ground elevation
      const floorY = groundY[i] + 0.02;
      if (py[i] < floorY) {
        py[i] = floorY;
        vy[i] *= -0.15;
        vx[i] *= 0.86;
        vz[i] *= 0.86;
      }

      // Compact active particles if holes exist
      if (alive !== i) {
        px[alive] = px[i];
        py[alive] = py[i];
        pz[alive] = pz[i];
        vx[alive] = vx[i];
        vy[alive] = vy[i];
        vz[alive] = vz[i];
        life[alive] = life[i];
        maxLife[alive] = maxLife[i];
        baseScale[alive] = baseScale[i];
        groundY[alive] = groundY[i];

        instancedMesh.getColorAt(i, _color);
        instancedMesh.setColorAt(alive, _color);
      }

      // Compute transform
      const progress = 1.0 - (life[alive] / maxLife[alive]);
      const shrink = Math.max(0.08, 1.0 - progress * 0.82) * baseScale[alive];

      _pos.set(px[alive], py[alive], pz[alive]);
      _scale.set(shrink, shrink * (1.0 + Math.abs(vy[alive]) * 0.12), shrink);
      _matrix.compose(_pos, _quat, _scale);
      instancedMesh.setMatrixAt(alive, _matrix);

      alive += 1;
    }

    activeCount = alive;
    instancedMesh.count = activeCount;
    instancedMesh.instanceMatrix.needsUpdate = true;
    instancedMesh.instanceColor.needsUpdate = true;
  }

  function reset() {
    activeCount = 0;
    instancedMesh.count = 0;
    instancedMesh.instanceMatrix.needsUpdate = true;
  }

  return {
    group: instancedMesh,
    spawnTurfPuff,
    spawnCutSpray,
    update,
    reset,
  };
}
