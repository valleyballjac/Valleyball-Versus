/**
 * Module: visuals/shaderWarmup
 * Role: Pre-compiles WebGL shader programs once behind the boot loading screen
 *   so pooled or initially hidden effects (`turfParticles`, `goalCelebration`,
 *   `ballDropRings`) never cause synchronous 350 to 780 ms mid-match stalls on
 *   their first activation.
 * Frame Phase: Boot only (never runs in fixedUpdate or render).
 * Active Architectural Laws:
 *   - LAW 8 (60 FPS Frame-Time Budget): Eliminates first-use shader compile hitches.
 */

import * as THREE from 'three';

const _warmupMatrix = new THREE.Matrix4().makeTranslation(0, -100, 0);

/**
 * Temporarily marks pooled VFX meshes visible with count >= 1, invokes
 * `renderer.compile(scene, camera)`, and restores their exact initial state.
 *
 * @param {object} params
 * @param {THREE.WebGLRenderer} params.renderer
 * @param {THREE.Scene} params.scene
 * @param {THREE.Camera} params.camera
 * @param {object|null} [params.turfParticles]
 * @param {object|null} [params.goalCelebration]
 * @param {object|null} [params.ballDropRings]
 */
export function warmupSceneShaders({
  renderer,
  scene,
  camera,
  turfParticles = null,
  goalCelebration = null,
  ballDropRings = null,
}) {
  if (!renderer || !scene || !camera) return;

  const savedTurfCount = turfParticles?.instancedMesh ? turfParticles.instancedMesh.count : null;
  const savedRingVis = goalCelebration?.ringMesh ? goalCelebration.ringMesh.visible : null;
  const savedSparkCount = goalCelebration?.sparkMesh ? goalCelebration.sparkMesh.count : null;

  try {
    if (turfParticles?.instancedMesh && savedTurfCount === 0) {
      turfParticles.instancedMesh.setMatrixAt(0, _warmupMatrix);
      turfParticles.instancedMesh.count = 1;
      turfParticles.instancedMesh.instanceMatrix.needsUpdate = true;
    }
    if (goalCelebration?.ringMesh) {
      goalCelebration.ringMesh.visible = true;
    }
    if (goalCelebration?.sparkMesh && savedSparkCount === 0) {
      goalCelebration.sparkMesh.setMatrixAt(0, _warmupMatrix);
      goalCelebration.sparkMesh.count = 1;
      goalCelebration.sparkMesh.instanceMatrix.needsUpdate = true;
    }
    if (ballDropRings?.setWarmupVisible) {
      ballDropRings.setWarmupVisible(true);
    }

    renderer.compile(scene, camera);

    // ANGLE (D3D11/Metal/SwiftShader) can defer backend HLSL/MSL pipeline compilation
    // until the first real draw call. Issue a single 1×1 scissored render behind the
    // boot loading screen so pooled VFX and shadow-depth shaders finish compiling
    // before tick 0, then restore the exact renderer viewport and scissor state.
    const savedViewport = new THREE.Vector4();
    const savedScissor = new THREE.Vector4();
    const savedScissorTest = renderer.getScissorTest();
    renderer.getViewport(savedViewport);
    renderer.getScissor(savedScissor);
    try {
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, 1, 1);
      renderer.setScissor(0, 0, 1, 1);
      renderer.render(scene, camera);
    } finally {
      renderer.setViewport(savedViewport);
      renderer.setScissor(savedScissor);
      renderer.setScissorTest(savedScissorTest);
    }
  } catch (err) {
    console.warn('[shaderWarmup] compile skipped:', err?.message || err);
  } finally {
    if (turfParticles?.instancedMesh && savedTurfCount !== null) {
      turfParticles.instancedMesh.count = savedTurfCount;
    }
    if (goalCelebration?.ringMesh && savedRingVis !== null) {
      goalCelebration.ringMesh.visible = savedRingVis;
    }
    if (goalCelebration?.sparkMesh && savedSparkCount !== null) {
      goalCelebration.sparkMesh.count = savedSparkCount;
    }
    if (ballDropRings?.setWarmupVisible) {
      ballDropRings.setWarmupVisible(false);
    }
  }
}
