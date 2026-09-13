import * as THREE from 'three';
import { assetUrl } from '../config/tuning.js';

/**
 * Brand Ball component: Renders the official 3D globe ball slowly spinning
 * on a dedicated transparent canvas for UI menus.
 *
 * @param {HTMLElement} container - DOM container element where the canvas will be attached
 * @param {object} [options]
 * @param {number} [options.size=160] - Display width/height in CSS pixels
 * @param {number} [options.speed=0.35] - Rotation speed in radians per second
 * @param {number} [options.tilt=0.25] - Earth axial tilt in radians (approx 14.5 deg)
 * @returns {object} handle with { canvas, start, stop, dispose }
 */
export function createBrandBall(container, options = {}) {
  const size = options.size || 160;
  const speed = options.speed ?? 0.35;
  const tilt = options.tilt ?? 0.25;

  const canvas = document.createElement('canvas');
  canvas.className = 'brand-ball-canvas';
  canvas.width = size * 2;
  canvas.height = size * 2;
  canvas.style.cssText = `
    width: ${size}px;
    height: ${size}px;
    display: block;
    pointer-events: none;
    filter: drop-shadow(0 8px 24px rgba(0, 0, 0, 0.75));
  `;
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
  renderer.setSize(size, size, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
  camera.position.set(0, 0.05, 3.2);
  camera.lookAt(0, 0, 0);

  // Lighting tuned to illuminate the relief terrain and neon coastline
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
  dirLight.position.set(2, 3, 3);
  scene.add(dirLight);

  const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.6);
  rimLight.position.set(-3, 1, -2);
  scene.add(rimLight);

  // Pivot group to apply realistic axial tilt
  const tiltGroup = new THREE.Group();
  tiltGroup.rotation.z = -tilt;      // Earth-like axial tilt
  tiltGroup.rotation.x = 0.12;       // Slight downward pitch so continents are visible
  scene.add(tiltGroup);

  const geometry = new THREE.SphereGeometry(1.0, 36, 26);

  const textureLoader = new THREE.TextureLoader();
  const diffuseMap = textureLoader.load(assetUrl('textures/ball_medium.png'));
  diffuseMap.colorSpace = THREE.SRGBColorSpace;

  const emissiveMap = textureLoader.load(assetUrl('textures/ball_medium_emissive.png'));
  emissiveMap.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshStandardMaterial({
    map: diffuseMap,
    emissiveMap: emissiveMap,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 1.35,
    roughness: 0.35,
    metalness: 0.05,
  });

  const mesh = new THREE.Mesh(geometry, material);
  tiltGroup.add(mesh);

  let isRunning = false;
  let lastTime = performance.now();
  let rafId = null;

  function renderFrame(now) {
    if (!isRunning) return;
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    mesh.rotation.y += speed * dt;
    renderer.render(scene, camera);

    rafId = requestAnimationFrame(renderFrame);
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    lastTime = performance.now();
    rafId = requestAnimationFrame(renderFrame);
  }

  function stop() {
    isRunning = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function dispose() {
    stop();
    geometry.dispose();
    material.dispose();
    diffuseMap.dispose();
    emissiveMap.dispose();
    renderer.dispose();
    if (canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }
  }

  start();

  return {
    canvas,
    mesh,
    start,
    stop,
    dispose,
  };
}
