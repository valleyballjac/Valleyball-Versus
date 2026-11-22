/**
 * Module: visuals/setupBallPreview
 * Role: Live 3D Match & Practice Ball Preview on the setup stage using the real
 *   1:1 physical-scale game ball meshes (Small 0.4m, Medium 1.0m, Large 1.5m)
 *   plus a 3-ball slow orbital carousel for Random and Practice All-3-Balls.
 * Frame Phase: Render (called only while `gameState === 'menu'`).
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Purely visual mesh staging while physics bodies
 *     remain disabled during setup; restores mesh scale on hide().
 *   - LAW 8 (60 FPS Frame-Time Budget): Zero per-frame heap allocations; reuses
 *     existing ball meshes and one pre-allocated pedestal ring.
 */

import * as THREE from 'three';

const BALL_IDS = ['small', 'medium', 'large'];
const ORBIT_PHASE_OFFSETS = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
const RAINBOW_HEX = [0xff2a42, 0xff6b00, 0xffd000, 0x10e56a, 0x00e5ff, 0x3b82f6, 0xa855f7, 0xec4899];

const _colorA = new THREE.Color();
const _colorB = new THREE.Color();

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = Math.max(0, Math.min(1, t)) - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/**
 * Creates the 3D Setup Ball Preview controller mounted to `scene`.
 *
 * @param {THREE.Scene} scene
 */
export function createSetupBallPreview(scene) {
  const pedestalGroup = new THREE.Group();
  pedestalGroup.name = 'setup-ball-preview-pedestal';
  pedestalGroup.visible = false;

  const outerRingGeo = new THREE.RingGeometry(0.86, 1.0, 64);
  outerRingGeo.rotateX(-Math.PI / 2);
  const outerRingMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const outerRingMesh = new THREE.Mesh(outerRingGeo, outerRingMat);
  outerRingMesh.castShadow = false;
  outerRingMesh.receiveShadow = false;
  outerRingMesh.renderOrder = 2;

  const innerDiscGeo = new THREE.CircleGeometry(0.84, 48);
  innerDiscGeo.rotateX(-Math.PI / 2);
  const innerDiscMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const innerDiscMesh = new THREE.Mesh(innerDiscGeo, innerDiscMat);
  innerDiscMesh.castShadow = false;
  innerDiscMesh.receiveShadow = false;
  innerDiscMesh.renderOrder = 1;

  pedestalGroup.add(innerDiscMesh);
  pedestalGroup.add(outerRingMesh);
  scene.add(pedestalGroup);

  let active = false;
  let previewMode = 'match'; // 'match' | 'practice'
  let ballChoice = 'random'; // 'random' | 'all' | 'small' | 'medium' | 'large'
  let elapsed = 0;
  let popProgress = 1;

  function findBallIndex(allBalls, id) {
    if (!Array.isArray(allBalls)) return -1;
    for (let i = 0; i < allBalls.length; i++) {
      if (allBalls[i]?.id === id) return i;
    }
    const fallback = BALL_IDS.indexOf(id);
    return fallback >= 0 && fallback < allBalls.length ? fallback : -1;
  }

  function applyRainbowColor(t, matA, matB) {
    const count = RAINBOW_HEX.length;
    const scaled = ((t % count) + count) % count;
    const i0 = Math.floor(scaled);
    const i1 = (i0 + 1) % count;
    const frac = scaled - i0;
    _colorA.setHex(RAINBOW_HEX[i0]);
    _colorB.setHex(RAINBOW_HEX[i1]);
    _colorA.lerp(_colorB, frac);
    matA.color.copy(_colorA);
    matB.color.copy(_colorA);
  }

  return {
    /**
     * Configures whether the 3D ball preview is shown and which ball choice is active.
     *
     * @param {{ visible?: boolean, mode?: 'match'|'practice', ballChoice?: string }} opts
     */
    setSelection({ visible = false, mode = previewMode, ballChoice: nextChoice = ballChoice } = {}) {
      const nextVisible = Boolean(visible);
      const changed = nextVisible !== active || nextChoice !== ballChoice || mode !== previewMode;
      active = nextVisible;
      previewMode = mode === 'practice' ? 'practice' : 'match';
      ballChoice = nextChoice || 'random';
      if (changed && active) {
        popProgress = 0;
      }
      if (!active) {
        pedestalGroup.visible = false;
      }
    },

    isActive() {
      return active;
    },

    /**
     * Hides the preview cleanly and restores 1:1 mesh scale on all game balls.
     *
     * @param {Array<object>} allBalls
     */
    hide(allBalls = []) {
      active = false;
      pedestalGroup.visible = false;
      if (Array.isArray(allBalls)) {
        for (let i = 0; i < allBalls.length; i++) {
          const mesh = allBalls[i]?.mesh;
          if (mesh) {
            mesh.scale.set(1, 1, 1);
            mesh.visible = false;
          }
        }
      }
    },

    /**
     * Updates live visual ball transforms and pedestal glow ring while in setup.
     *
     * @param {number} dt
     * @param {Array<object>} allBalls
     */
    update(dt, allBalls) {
      if (!active || !Array.isArray(allBalls) || allBalls.length === 0) {
        pedestalGroup.visible = false;
        return;
      }

      const safeDt = Math.min(0.05, Math.max(0.001, dt || 1 / 60));
      elapsed += safeDt;
      popProgress = Math.min(1, popProgress + safeDt * 4.5);
      const popScale = Math.max(0.02, easeOutBack(popProgress));

      const isPractice = previewMode === 'practice';
      const isCarousel = ballChoice === 'random' || ballChoice === 'all';

      // Framed cleanly for cinematicCamera setup view `(0, 1.55, 6.25) -> (0, 1.38, 0)`:
      // - Match Mode: elevates the spinning ball(s) into the open stadium sky ABOVE the
      //   staged athletes (heads top out at ~1.72 m, z = 0.15) and slightly behind them
      //   (z = -0.35) so both characters remain 100% unobstructed from head to toe.
      // - Practice Mode: floats the ball(s) cleanly to the right of the solo athlete
      //   (athlete at x = +0.45) with zero overlap.
      const baseX = isPractice ? 2.25 : 0.0;
      const baseZ = isPractice ? -0.35 : -0.35;

      pedestalGroup.visible = true;
      pedestalGroup.position.set(baseX, 0.04, isPractice ? -0.10 : 0.10);

      if (isCarousel) {
        // 3-Ball Slow Orbital Carousel (shows Small, Medium, and Large at true 1:1 scale)
        const rx = isPractice ? 0.62 : 1.50;
        const rz = isPractice ? 0.24 : 0.28;
        const ringScale = isPractice ? 0.88 : 1.25;
        pedestalGroup.scale.set(ringScale, 1, ringScale);
        applyRainbowColor(elapsed * 0.95, outerRingMat, innerDiscMat);
        outerRingMat.opacity = 0.50 + Math.sin(elapsed * 3.0) * 0.12;
        innerDiscMat.opacity = 0.11;

        const orbitSpeed = 0.82;
        for (let i = 0; i < allBalls.length; i++) {
          const b = allBalls[i];
          const mesh = b?.mesh;
          if (!mesh) continue;
          const phase = elapsed * orbitSpeed + (ORBIT_PHASE_OFFSETS[i] ?? (i * 2.1));
          const r = b.radius ?? 0.5;
          const ox = baseX + Math.sin(phase) * rx;
          const oz = baseZ + Math.cos(phase) * rz;
          // Elevate cleanly above the ~1.72m athlete heads in Match Mode, or clearly to the right in Practice
          const oy = (isPractice ? 1.98 : 2.52) + r * 0.58 + Math.sin(elapsed * 2.2 + i * 2.09) * 0.06;

          mesh.visible = true;
          mesh.position.set(ox, oy, oz);
          mesh.rotation.set(elapsed * 0.45 + i * 0.6, elapsed * 1.15 + i * 1.2, 0);
          mesh.scale.set(popScale, popScale, popScale);
        }
        return;
      }

      // Single Regulation Ball Preview (Small 0.4m, Medium 1.0m, or Large 1.5m at true 1:1 physical scale)
      const targetIdx = findBallIndex(allBalls, ballChoice);
      for (let i = 0; i < allBalls.length; i++) {
        const b = allBalls[i];
        const mesh = b?.mesh;
        if (!mesh) continue;
        if (i !== targetIdx) {
          mesh.visible = false;
          mesh.scale.set(1, 1, 1);
          continue;
        }
        const r = b.radius ?? 0.5;
        const ringScale = Math.max(0.55, r * 1.35);
        pedestalGroup.scale.set(ringScale, 1, ringScale);

        const accentHex = ballChoice === 'small' ? 0xfbb417 : (ballChoice === 'large' ? 0xff2e55 : 0x00e5ff);
        outerRingMat.color.setHex(accentHex);
        innerDiscMat.color.setHex(accentHex);
        outerRingMat.opacity = 0.58 + Math.sin(elapsed * 3.4) * 0.12;
        innerDiscMat.opacity = 0.12;

        const hoverY = (isPractice ? 1.92 : 2.42) + r * 0.65 + Math.sin(elapsed * 2.4) * 0.06;
        mesh.visible = true;
        mesh.position.set(baseX, hoverY, baseZ);
        mesh.rotation.set(0.28 + Math.sin(elapsed * 0.9) * 0.12, elapsed * 1.05, 0);
        mesh.scale.set(popScale, popScale, popScale);
      }
    },

    dispose() {
      scene.remove(pedestalGroup);
      outerRingGeo.dispose();
      outerRingMat.dispose();
      innerDiscGeo.dispose();
      innerDiscMat.dispose();
    },
  };
}
