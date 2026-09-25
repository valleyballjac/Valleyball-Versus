import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';

const MAX_SPARKS = 64;
const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _color = new THREE.Color();
const _tempColor = new THREE.Color();

let _randSeed = 987654321;
function _fastRand() {
  _randSeed = (_randSeed * 1664525 + 1013904223) >>> 0;
  return _randSeed / 4294967296;
}

/**
 * Visual-only Goal Celebration System.
 *
 * Renders an understated, elegant celebration when a goal is scored:
 * 1. Hoop Ring Energy Flare: Expanding additive glow ring matching the hoop aperture.
 * 2. Team-Colored Spark Cascade: Sparkling embers tumbling downward through the hoop plane.
 * 3. Atmospheric Light Pulse: Brief ambient point light illuminating the rim, net, and mound.
 *
 * ZERO physics interaction: 100% decoupled from Rapier and match determinism.
 *
 * @param {THREE.Scene} scene
 */
export function createGoalCelebrationSystem(scene) {
  const group = new THREE.Group();
  group.name = 'goal-celebration';
  scene.add(group);

  // 1. Hoop Energy Ring (aperture radius ~ 4.67m, in X = 0 plane)
  const ringRadius = TUNING.match?.hoopRadius ?? 4.667;
  const ringGeom = new THREE.TorusGeometry(ringRadius, 0.14, 16, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ringMesh = new THREE.Mesh(ringGeom, ringMat);
  ringMesh.rotation.y = Math.PI / 2; // Lie in X = 0 plane
  ringMesh.visible = false;
  group.add(ringMesh);

  // 2. Atmospheric Point Light — pre-warmed at boot (LAW 8).
  // Kept permanently visible with intensity modulated at runtime to prevent WebGL shader recompilation hitches.
  const goalLight = new THREE.PointLight(0xffffff, 0, 24, 1.8);
  goalLight.visible = true;
  group.add(goalLight);

  // 3. Shimmering Spark Cascade (InstancedMesh)
  const sparkGeom = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  const sparkMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sparkMesh = new THREE.InstancedMesh(sparkGeom, sparkMat, MAX_SPARKS);
  sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;

  const sparkColors = new Float32Array(MAX_SPARKS * 3);
  sparkMesh.instanceColor = new THREE.InstancedBufferAttribute(sparkColors, 3);
  sparkMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  group.add(sparkMesh);

  // Spark state arrays
  const px = new Float32Array(MAX_SPARKS);
  const py = new Float32Array(MAX_SPARKS);
  const pz = new Float32Array(MAX_SPARKS);
  const vx = new Float32Array(MAX_SPARKS);
  const vy = new Float32Array(MAX_SPARKS);
  const vz = new Float32Array(MAX_SPARKS);
  const life = new Float32Array(MAX_SPARKS);
  const maxLife = new Float32Array(MAX_SPARKS);
  const baseScale = new Float32Array(MAX_SPARKS);

  // Animation timers
  let ringTime = 0;
  const ringDuration = 1.0; // seconds
  let activeSparks = 0;

  /**
   * Triggers an understated, team-colored celebration at the scoring goal.
   *
   * @param {'home'|'away'|string} team
   * @param {{ x: number, y: number, z: number }} hoopPos
   * @param {{ y: number, z: number }} [entryPoint]
   */
  function triggerGoal(team, hoopPos, entryPoint = null) {
    if (!hoopPos) return;

    // Resolve team primary color
    const teamConf = TUNING.teams?.[team];
    const hexColor = teamConf?.primaryColor
      ?? (team === 'home' ? 0xd90429 : 0x1d4ed8);
    _color.set(hexColor);

    // 1. Position & ignite hoop energy ring
    ringMesh.position.set(hoopPos.x, hoopPos.y, hoopPos.z);
    ringMesh.scale.set(1.0, 1.0, 1.0);
    ringMat.color.copy(_color);
    ringMat.opacity = 0.95;
    ringMesh.visible = true;
    ringTime = ringDuration;

    // 2. Position & ignite atmospheric point light (intensity-only modulation, LAW 8)
    goalLight.position.set(hoopPos.x, hoopPos.y, hoopPos.z);
    goalLight.color.copy(_color);
    goalLight.intensity = 3.5;

    // 3. Spawn spark cascade through the hoop
    const spawnCount = Math.min(36, MAX_SPARKS);
    activeSparks = spawnCount;

    const centerY = entryPoint ? entryPoint.y : hoopPos.y;
    const centerZ = entryPoint ? entryPoint.z : hoopPos.z;

    for (let i = 0; i < spawnCount; i++) {
      // Fan out across the aperture
      const angle = _fastRand() * Math.PI * 2;
      const dist = (0.3 + _fastRand() * 0.7) * (ringRadius * 0.85);
      px[i] = hoopPos.x + (_fastRand() - 0.5) * 0.6;
      py[i] = centerY + Math.sin(angle) * dist;
      pz[i] = centerZ + Math.cos(angle) * dist;

      // Gentle forward/backward spread along X (through the hoop) + downward drift
      vx[i] = (_fastRand() - 0.5) * 3.5;
      vy[i] = 1.0 + _fastRand() * 2.5; // slight initial upward fountain pop before falling
      vz[i] = (_fastRand() - 0.5) * 1.5;

      const dur = 0.9 + _fastRand() * 0.5;
      life[i] = dur;
      maxLife[i] = dur;
      baseScale[i] = 0.8 + _fastRand() * 0.6;

      // Shimmer: mix team color with warm gold / white highlights
      const isGoldSpark = _fastRand() > 0.65;
      if (isGoldSpark) {
        _tempColor.set(0xffe680).multiplyScalar(1.2);
      } else {
        _tempColor.copy(_color).multiplyScalar(1.1);
      }
      sparkMesh.setColorAt(i, _tempColor);
    }

    sparkMesh.count = activeSparks;
    sparkMesh.instanceColor.needsUpdate = true;
  }

  /**
   * Advances celebration animation and particle physics.
   * @param {number} dt delta seconds
   */
  function update(dt) {
    // 1. Update Hoop Ring & Light
    if (ringTime > 0) {
      ringTime = Math.max(0, ringTime - dt);
      const progress = 1.0 - (ringTime / ringDuration);

      // Smooth expansion: 1.0 -> 1.25
      const s = 1.0 + Math.sin(progress * Math.PI * 0.5) * 0.25;
      ringMesh.scale.set(s, s, s);

      // Smooth fade-out
      ringMat.opacity = Math.max(0, 0.95 * (1.0 - progress));
      goalLight.intensity = Math.max(0, 3.5 * (1.0 - progress * progress));

      if (ringTime <= 0) {
        ringMesh.visible = false;
        goalLight.intensity = 0;
      }
    }

    // 2. Update Spark Cascade
    if (activeSparks > 0) {
      const gravity = 7.0; // gentle, floating ember gravity
      let alive = 0;

      for (let i = 0; i < activeSparks; i++) {
        life[i] -= dt;
        if (life[i] <= 0) continue;

        vy[i] -= gravity * dt;
        vx[i] *= 0.98;
        vz[i] *= 0.98;

        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
        pz[i] += vz[i] * dt;

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

          sparkMesh.getColorAt(i, _tempColor);
          sparkMesh.setColorAt(alive, _tempColor);
        }

        const progress = 1.0 - (life[alive] / maxLife[alive]);
        const shrink = Math.max(0.05, (1.0 - progress * 0.9)) * baseScale[alive];

        _pos.set(px[alive], py[alive], pz[alive]);
        _scale.set(shrink, shrink, shrink);
        _matrix.compose(_pos, _quat, _scale);
        sparkMesh.setMatrixAt(alive, _matrix);

        alive++;
      }

      activeSparks = alive;
      sparkMesh.count = activeSparks;
      sparkMesh.instanceMatrix.needsUpdate = true;
      sparkMesh.instanceColor.needsUpdate = true;
    }
  }

  function reset() {
    ringTime = 0;
    ringMesh.visible = false;
    goalLight.intensity = 0;
    activeSparks = 0;
    sparkMesh.count = 0;
    sparkMesh.instanceMatrix.needsUpdate = true;
  }

  return {
    group,
    triggerGoal,
    update,
    reset,
  };
}
