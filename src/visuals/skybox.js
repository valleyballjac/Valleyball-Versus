import * as THREE from 'three';

/**
 * High-fidelity celestial galaxy skydome and precision starfield.
 *
 * Solves:
 * 1. ZERO SEAMS: A continuous 3D mathematical shader using unit direction vectors
 *    (dir.x, dir.y, dir.z) completely eliminates UV seams, cubemap edges, and pole pinch.
 * 2. ZERO PIXELATION: Stars are rendered via THREE.Points with sizeAttenuation: false,
 *    pinning each star to subpixel/native screen-space sharpness (1.0 to 1.8px) with
 *    soft Gaussian anti-aliased circular alpha.
 * 3. REALISTIC ASTRONOMICAL DYNAMICS: Accurate stellar temperatures (pure white, ice blue,
 *    pale gold) and astronomical magnitude distribution.
 */

let skyboxGroup = null;

export function initCelestialSkybox(scene) {
  // If previously initialized, clean up
  if (skyboxGroup) {
    scene.remove(skyboxGroup);
    skyboxGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
    skyboxGroup = null;
  }

  skyboxGroup = new THREE.Group();
  skyboxGroup.name = 'celestial-skybox';

  // Base background color
  scene.background = new THREE.Color(0x020409);

  // ---------------------------------------------------------------------------
  // 1. SEAMLESS 3D PROCEDURAL NEBULA SKYDOME
  // ---------------------------------------------------------------------------
  // Radius 320m sits well within the camera far plane (400m) while wrapping the arena.
  const domeRadius = 320;
  const domeGeo = new THREE.SphereGeometry(domeRadius, 48, 32);

  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldDir;

      void main() {
        vec3 d = vWorldDir;

        // Base celestial void: obsidian black to deep navy horizon
        vec3 voidColor = vec3(0.012, 0.020, 0.048);     // Deep zenith void
        vec3 horizonColor = vec3(0.028, 0.052, 0.110);  // Luminous deep horizon haze

        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(horizonColor, voidColor, h);

        // ---------------------------------------------------------------------
        // 1. INCLINED GALACTIC EQUATOR (Milky Way River across the cosmos)
        // ---------------------------------------------------------------------
        // Plane normal inclined at ~38 degrees across the sky
        vec3 galPlaneNormal = normalize(vec3(0.55, 0.78, -0.28));
        float galDist = abs(dot(d, galPlaneNormal));
        // Soft Gaussian falloff along the galactic disc
        float milkyWayHaze = exp(-galDist * galDist * 18.0);
        float mwTurbulence = (sin(d.x * 4.2 + d.z * 3.5) * cos(d.y * 3.8 + d.x * 1.5)) * 0.5 + 0.5;
        vec3 mwCore = vec3(0.14, 0.11, 0.28); // Vibrant twilight lavender
        vec3 mwTeal = vec3(0.03, 0.20, 0.26); // Ethereal cyan dust rim
        col += mix(mwCore, mwTeal, mwTurbulence) * milkyWayHaze * 0.78;

        // ---------------------------------------------------------------------
        // 2. 3D CONTINUOUS NEBULAR HARMONICS (100% SEAMLESS, NO UV SEAMS)
        // ---------------------------------------------------------------------
        // Lobe 1: Deep twilight indigo cloud
        float n1 = sin(d.x * 2.2 + d.y * 1.5) * cos(d.z * 2.2);
        float nebIndigo = smoothstep(0.24, 0.88, n1);
        col += vec3(0.12, 0.08, 0.28) * nebIndigo * 0.65;

        // Lobe 2: Cosmic cyan / ocean azure dust
        float n2 = sin(d.z * 2.8 - d.x * 1.6) * cos(d.y * 2.4);
        float nebCyan = smoothstep(0.28, 0.90, n2);
        col += vec3(0.04, 0.18, 0.25) * nebCyan * 0.55;

        // Lobe 3: Soft magenta / stellar nursery core
        float n3 = cos(d.x * 3.4 + d.z * 1.8) * sin(d.y * 3.0);
        float nebViolet = smoothstep(0.38, 0.94, n3);
        col += vec3(0.20, 0.06, 0.24) * nebViolet * 0.45;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const domeMesh = new THREE.Mesh(domeGeo, domeMat);
  domeMesh.renderOrder = -200;
  skyboxGroup.add(domeMesh);

  // ---------------------------------------------------------------------------
  // 2. PRECISION SUBPIXEL PARTICLE STARFIELD (NO PIXELATION)
  // ---------------------------------------------------------------------------
  // Smooth circular Gaussian point sprite on offscreen canvas (64x64)
  const starCanvas = document.createElement('canvas');
  starCanvas.width = 64;
  starCanvas.height = 64;
  const sctx = starCanvas.getContext('2d');
  const sGrad = sctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  sGrad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  sGrad.addColorStop(0.2, 'rgba(255, 255, 255, 0.85)');
  sGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.25)');
  sGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
  sctx.fillStyle = sGrad;
  sctx.fillRect(0, 0, 64, 64);

  const starTexture = new THREE.CanvasTexture(starCanvas);
  starTexture.needsUpdate = true;

  // Generate 3,400 stars uniformly on sphere using Fibonacci spiral + seeded jitter
  const starCount = 3400;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);

  let seed = 918273;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  const phi = (1 + Math.sqrt(5)) / 2; // Golden ratio
  const starRadius = domeRadius - 4;  // Just inside the dome shell

  for (let i = 0; i < starCount; i++) {
    // Fibonacci sphere distribution for perfectly uniform non-clustering coverage
    const y = 1 - (i / (starCount - 1)) * 2; // y goes from 1 to -1
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = (2 * Math.PI * i) / phi;

    // Small pseudo-random angular jitter to avoid rigid spiral pattern
    const jitterTheta = (rnd() - 0.5) * 0.08;
    const jitterY = (rnd() - 0.5) * 0.02;
    const finalY = Math.max(-0.98, Math.min(0.98, y + jitterY));
    const finalR = Math.sqrt(Math.max(0, 1 - finalY * finalY));
    const finalTheta = theta + jitterTheta;

    positions[i * 3 + 0] = Math.cos(finalTheta) * finalR * starRadius;
    positions[i * 3 + 1] = finalY * starRadius;
    positions[i * 3 + 2] = Math.sin(finalTheta) * finalR * starRadius;

    // Real stellar temperature and magnitude weighting
    const mag = rnd(); // 0 (faint) to 1 (bright)
    // 75% background stars (0.40 - 0.75), 20% medium (0.75 - 0.95), 5% brilliant gems (1.0 - 1.4)
    let brightness = 0.42 + mag * 0.48;
    if (mag > 0.90) brightness = 0.95 + (mag - 0.90) * 4.0;

    // Stellar spectral tint
    const colorRoll = rnd();
    let r = 0.96, g = 0.98, b = 1.0; // Class A/F diamond white (70%)
    if (colorRoll > 0.82) {
      // Class B: Ice blue
      r = 0.70; g = 0.88; b = 1.0;
    } else if (colorRoll < 0.12) {
      // Class G/K: Warm gold
      r = 1.0; g = 0.92; b = 0.65;
    } else if (colorRoll >= 0.76 && colorRoll <= 0.82) {
      // Class M: Soft lavender / rose
      r = 0.98; g = 0.82; b = 0.98;
    }

    colors[i * 3 + 0] = Math.min(1.0, r * brightness);
    colors[i * 3 + 1] = Math.min(1.0, g * brightness);
    colors[i * 3 + 2] = Math.min(1.0, b * brightness);
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const starMat = new THREE.PointsMaterial({
    size: 1.6, // Native screen-space size in pixels
    sizeAttenuation: false, // PREVENTS PIXELATION: Each star is a subpixel pinpoint
    map: starTexture,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });

  const starPoints = new THREE.Points(starGeo, starMat);
  starPoints.renderOrder = -190;
  skyboxGroup.add(starPoints);

  scene.add(skyboxGroup);
  return skyboxGroup;
}

/**
 * Keeps the celestial sphere centered on the active camera so it remains at infinity.
 * @param {THREE.Camera} camera
 */
export function updateCelestialSkybox(camera) {
  if (skyboxGroup && camera) {
    skyboxGroup.position.copy(camera.position);
  }
}
