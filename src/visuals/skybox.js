import * as THREE from 'three';

/**
 * Creates a procedural celestial galaxy skybox for the Valleyball arena.
 *
 * Visual hierarchy:
 * - Deep cosmic obsidian base (#030712)
 * - Ethereal nebular clouds in twilight indigo (#1e1b4b), deep purple (#2e1065), and cosmic cyan (#083344)
 * - Deterministic seeded starfield with varying magnitudes and soft glow halos
 * - Subtle galactic dust plane along the horizon
 *
 * @param {THREE.Scene} scene
 * @returns {THREE.CanvasTexture}
 */
export function initCelestialSkybox(scene) {
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 1. Base void: Deep Cosmic Obsidian
  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, W, H);

  // 2. Cosmic nebular bands (soft layered radial gradients)
  const nebulae = [
    { x: W * 0.25, y: H * 0.38, r: 420, color: 'rgba(30, 27, 75, 0.24)' },    // Deep indigo
    { x: W * 0.32, y: H * 0.34, r: 280, color: 'rgba(46, 16, 101, 0.20)' },   // Royal purple
    { x: W * 0.65, y: H * 0.42, r: 480, color: 'rgba(8, 51, 68, 0.22)' },     // Cosmic cyan
    { x: W * 0.72, y: H * 0.36, r: 310, color: 'rgba(30, 27, 75, 0.18)' },    // Violet-indigo
    { x: W * 0.50, y: H * 0.22, r: 550, color: 'rgba(15, 23, 42, 0.35)' },    // Obsidian cloud
    { x: W * 0.85, y: H * 0.48, r: 350, color: 'rgba(12, 74, 110, 0.16)' },   // Deep ocean teal
  ];

  for (const n of nebulae) {
    const grad = ctx.createRadialGradient(n.x, n.y, 10, n.x, n.y, n.r);
    grad.addColorStop(0, n.color);
    grad.addColorStop(0.5, n.color.replace(/[\d\.]+\)$/, '0.08)'));
    grad.addColorStop(1, 'rgba(3, 7, 18, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Faint Milky Way dust river (diagonal flowing haze)
  ctx.save();
  ctx.translate(W * 0.5, H * 0.42);
  ctx.rotate(-0.16);
  const bandGrad = ctx.createLinearGradient(0, -180, 0, 180);
  bandGrad.addColorStop(0, 'rgba(3, 7, 18, 0)');
  bandGrad.addColorStop(0.3, 'rgba(46, 16, 101, 0.08)');
  bandGrad.addColorStop(0.5, 'rgba(8, 51, 68, 0.12)');
  bandGrad.addColorStop(0.7, 'rgba(30, 27, 75, 0.08)');
  bandGrad.addColorStop(1, 'rgba(3, 7, 18, 0)');
  ctx.fillStyle = bandGrad;
  ctx.fillRect(-W, -180, W * 2, 360);
  ctx.restore();

  // 4. Deterministic pseudo-random starfield
  // LCG pseudo-random generator with fixed seed for byte-identical determinism
  let seed = 421337;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  const starCount = 1400;
  for (let i = 0; i < starCount; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const mag = rnd(); // magnitude: 0 (faint) to 1 (bright)

    // Higher density near upper hemisphere (sky) than lower hemisphere (below horizon)
    const upperFactor = y < H * 0.65 ? 1.0 : 0.35;
    if (rnd() > upperFactor) continue;

    const radius = 0.5 + mag * 1.5;
    const alpha = 0.25 + mag * 0.70;

    // Tint distribution: mostly white, some ice-blue, some soft gold
    let starColor = `rgba(248, 250, 252, ${alpha.toFixed(2)})`;
    const tintRoll = rnd();
    if (tintRoll > 0.85) {
      starColor = `rgba(186, 230, 253, ${alpha.toFixed(2)})`; // Ice blue
    } else if (tintRoll < 0.12) {
      starColor = `rgba(254, 240, 138, ${(alpha * 0.85).toFixed(2)})`; // Soft gold
    } else if (tintRoll > 0.75 && tintRoll <= 0.85) {
      starColor = `rgba(233, 213, 255, ${alpha.toFixed(2)})`; // Pale lavender
    }

    ctx.fillStyle = starColor;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Occasional bright star with cross diffraction halo
    if (mag > 0.94) {
      const haloGrad = ctx.createRadialGradient(x, y, 0, x, y, radius * 5);
      haloGrad.addColorStop(0, starColor.replace(/[\d\.]+\)$/, '0.45)'));
      haloGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(x, y, radius * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 5. Create Three.js equirectangular background texture
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  scene.background = texture;
  return texture;
}
