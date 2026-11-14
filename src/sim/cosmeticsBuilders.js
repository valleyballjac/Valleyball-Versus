import * as THREE from 'three';
import { HEADWEAR_CATALOG } from '../config/cosmetics.js';
import * as HeadgearRoster from './valleyballHeadgear.js';

/**
 * MODULE HEADER — src/sim/cosmeticsBuilders.js
 *
 * Role: Procedural Three.js headwear mesh builders and registry (`HEADWEAR_BUILDERS`,
 *   `buildHeadwear`, `resolveCosmeticColors`, `createCurvedBaseballVisorGeo`,
 *   `buildVisor`, `buildCap`, `buildHeadband`, `buildGoggles`, `buildBeanie`,
 *   `buildBandana`, plus re-exports `resolveHeadwearPalette`, `recolorHeadgear`).
 * Frame Phase: Render-side mount/recolor only (at athlete spawn or headwear cycle);
 *   never invoked inside the 60 Hz fixed step.
 * Active Architectural Laws:
 *   - LAW 4 (Zero Hot-Loop Allocations): Headwear is constructed only on mount;
 *     color updates mutate existing material uniforms in place via `recolorHeadgear`.
 *   - LAW 6 / LAW 10 (Render-Only Cosmetics): Zero Rapier bodies or colliders.
 */

// Reusable unit constants
const DEFAULT_HEAD_RADIUS = 0.125;

/**
 * Resolves numeric color values and palette metadata from an options object.
 * @param {object} [options]
 * @returns {{ primary: number, accent: number, joint: number, dark: number, white: number, gold: number }}
 */
export function resolveCosmeticColors(options = {}) {
  let primary = 0xd90429;
  let accent = 0xfca5a5;

  if (options.palette) {
    if (typeof options.palette.value === 'number') {
      primary = options.palette.value;
    } else if (typeof options.palette.primary === 'number') {
      primary = options.palette.primary;
    }
    if (typeof options.palette.accentValue === 'number') {
      accent = options.palette.accentValue;
    } else if (typeof options.palette.accent === 'number') {
      accent = options.palette.accent;
    }
  }

  if (options.teamColor !== undefined && options.teamColor !== null) {
    primary = typeof options.teamColor === 'string'
      ? (HeadgearRoster.PALETTES[options.teamColor.toLowerCase()] ?? parseInt(options.teamColor.replace('#', '0x'), 16))
      : options.teamColor;
  }
  if (options.primaryHex !== undefined && options.primaryHex !== null) {
    primary = typeof options.primaryHex === 'string'
      ? parseInt(options.primaryHex.replace('#', '0x'), 16)
      : options.primaryHex;
  }
  if (options.tint !== undefined && options.tint !== null) {
    primary = typeof options.tint === 'string'
      ? parseInt(options.tint.replace('#', '0x'), 16)
      : options.tint;
  }
  if (options.primaryColor !== undefined && options.primaryColor !== null) {
    primary = typeof options.primaryColor === 'string'
      ? parseInt(options.primaryColor.replace('#', '0x'), 16)
      : options.primaryColor;
  }
  if (options.accentColor !== undefined && options.accentColor !== null) {
    accent = typeof options.accentColor === 'string'
      ? parseInt(options.accentColor.replace('#', '0x'), 16)
      : options.accentColor;
  } else if (options.accent !== undefined && options.accent !== null) {
    accent = typeof options.accent === 'string'
      ? parseInt(options.accent.replace('#', '0x'), 16)
      : options.accent;
  } else if (options.teamColor !== undefined || options.isHome !== undefined || options.kit !== undefined) {
    accent = HeadgearRoster.accentFor(primary, options.isHome ?? options.kit ?? 'home');
  }

  const joint = options.jointColor !== undefined && options.jointColor !== null
    ? (typeof options.jointColor === 'string' ? parseInt(options.jointColor.replace('#', '0x'), 16) : options.jointColor)
    : 0x22242a;

  const dark = 0x181a20;
  const white = 0xf8fafc;
  const gold = 0xf59e0b;

  return { primary, accent, joint, dark, white, gold };
}

/**
 * Creates standard materials tagged with color roles for dynamic palette updates.
 */
function createCosmeticMaterials(colors) {
  const primaryMat = new THREE.MeshStandardMaterial({
    color: colors.primary,
    roughness: 0.65,
    metalness: 0.05,
  });
  primaryMat.userData.colorRole = 'primary';

  const accentMat = new THREE.MeshStandardMaterial({
    color: colors.accent,
    roughness: 0.60,
    metalness: 0.08,
  });
  accentMat.userData.colorRole = 'accent';

  const jointMat = new THREE.MeshStandardMaterial({
    color: colors.joint,
    roughness: 0.85,
    metalness: 0.05,
  });
  jointMat.userData.colorRole = 'joint';

  const darkMat = new THREE.MeshStandardMaterial({
    color: colors.dark,
    roughness: 0.88,
    metalness: 0.04,
  });
  darkMat.userData.colorRole = 'dark';

  const whiteMat = new THREE.MeshStandardMaterial({
    color: colors.white,
    roughness: 0.70,
    metalness: 0.02,
  });
  whiteMat.userData.colorRole = 'white';

  const goldMat = new THREE.MeshStandardMaterial({
    color: colors.gold,
    roughness: 0.35,
    metalness: 0.75,
  });
  goldMat.userData.colorRole = 'gold';

  const lensMat = new THREE.MeshStandardMaterial({
    color: colors.primary,
    emissive: colors.primary,
    emissiveIntensity: 0.5,
    roughness: 0.15,
    metalness: 0.30,
    transparent: true,
    opacity: 0.82,
  });
  lensMat.userData.colorRole = 'lens';

  return { primaryMat, accentMat, jointMat, darkMat, whiteMat, goldMat, lensMat };
}

/**
 * Generates an authentic curved visor/cap bill geometry with downward temple curl.
 */
export function createCurvedBaseballVisorGeo(
  radius,
  crownRadius = null,
  phiRim = Math.PI * 0.50,
  thetaMax = Math.PI * 0.38,
  billLength = null,
  thickness = null,
) {
  const cRadius = crownRadius ?? (radius * 1.03);
  const L0 = billLength ?? (radius * 0.68);
  const thick = thickness ?? (radius * 0.035);
  const pitch = 0.26;
  const curl = radius * 0.10;

  const yRim = cRadius * Math.cos(phiRim);
  const rRim = cRadius * Math.sin(phiRim);

  const uSteps = 24;
  const tSteps = 12;
  const positions = [];
  const indices = [];

  function getPoint(u, tNorm, layer) {
    const theta = u * thetaMax;
    const profile = Math.max(0, Math.cos(u * Math.PI * 0.5));

    const bx = rRim * Math.sin(theta);
    const bz = -rRim * Math.cos(theta);
    const by = yRim;

    let x, y, z;
    if (tNorm <= 0) {
      x = bx * 0.96;
      z = bz * 0.96;
      y = by + (layer === 'top' ? thick * 0.5 : -thick * 0.5);
    } else {
      const Lt = L0 * Math.pow(profile, 0.72) * tNorm;
      const dirX = Math.sin(theta * 0.70);
      const dirZ = -Math.cos(theta * 0.70);
      x = bx + dirX * Lt * Math.cos(pitch);
      z = bz + dirZ * Lt * Math.cos(pitch);
      const yCurl = -curl * (u * u) * tNorm;
      const yPitch = -Lt * Math.sin(pitch);
      const yOffset = layer === 'top' ? thick * 0.5 : -thick * 0.5;
      y = by + yPitch + yCurl + yOffset;
    }
    return [x, y, z];
  }

  const topStart = 0;
  for (let j = 0; j <= tSteps; j++) {
    const tNorm = j === 0 ? -0.15 : j / tSteps;
    for (let i = 0; i <= uSteps; i++) {
      const u = (i / uSteps) * 2 - 1;
      const [x, y, z] = getPoint(u, tNorm, 'top');
      positions.push(x, y, z);
    }
  }

  const bottomStart = positions.length / 3;
  for (let j = 0; j <= tSteps; j++) {
    const tNorm = j === 0 ? -0.15 : j / tSteps;
    for (let i = 0; i <= uSteps; i++) {
      const u = (i / uSteps) * 2 - 1;
      const [x, y, z] = getPoint(u, tNorm, 'bottom');
      positions.push(x, y, z);
    }
  }

  const rowLen = uSteps + 1;
  for (let j = 0; j < tSteps; j++) {
    for (let i = 0; i < uSteps; i++) {
      const a = topStart + j * rowLen + i;
      const b = a + 1;
      const c = a + rowLen;
      const d = c + 1;
      indices.push(a, d, b);
      indices.push(a, c, d);
    }
  }
  for (let j = 0; j < tSteps; j++) {
    for (let i = 0; i < uSteps; i++) {
      const a = bottomStart + j * rowLen + i;
      const b = a + 1;
      const c = a + rowLen;
      const d = c + 1;
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }
  for (let i = 0; i < uSteps; i++) {
    const topIdx = topStart + tSteps * rowLen + i;
    const botIdx = bottomStart + tSteps * rowLen + i;
    indices.push(topIdx, topIdx + 1, botIdx + 1);
    indices.push(topIdx, botIdx + 1, botIdx);
  }
  for (let i = 0; i < uSteps; i++) {
    const topIdx = topStart + i;
    const botIdx = bottomStart + i;
    indices.push(topIdx, botIdx + 1, topIdx + 1);
    indices.push(topIdx, botIdx, botIdx + 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. VISOR (Standard training visor)
// ─────────────────────────────────────────────────────────────────────────────
export function buildVisor(options = {}) {
  const radius = options.radius ?? DEFAULT_HEAD_RADIUS;
  const colors = resolveCosmeticColors(options);
  const mats = createCosmeticMaterials(colors);

  const group = new THREE.Group();
  group.name = 'headwear-visor';

  const crownRadius = radius * 1.03;
  const phiRim = Math.PI * 0.36;
  const phiBandStart = phiRim * 0.60;
  const phiBandLength = phiRim * 0.40;

  // Open-top sports visor band
  const bandGeo = new THREE.SphereGeometry(crownRadius, 32, 10, 0, Math.PI * 2, phiBandStart, phiBandLength);
  const bandMesh = new THREE.Mesh(bandGeo, mats.primaryMat);
  bandMesh.name = 'visor-band';
  bandMesh.castShadow = true;
  group.add(bandMesh);

  // Curved visor bill
  const visorGeo = createCurvedBaseballVisorGeo(radius, crownRadius, phiRim, Math.PI * 0.38, radius * 0.68, radius * 0.035);
  const visorMesh = new THREE.Mesh(visorGeo, mats.primaryMat);
  visorMesh.name = 'visor-bill';
  visorMesh.castShadow = true;
  group.add(visorMesh);

  // Back elastic strap
  const strapGeo = new THREE.CylinderGeometry(radius * 0.20, radius * 0.20, radius * 0.035, 12);
  const strapMesh = new THREE.Mesh(strapGeo, mats.jointMat);
  strapMesh.name = 'visor-strap';
  strapMesh.position.set(0, crownRadius * Math.cos(phiRim) * 0.95, crownRadius * Math.sin(phiRim) * 0.98);
  strapMesh.rotation.x = Math.PI / 2 + 0.12;
  strapMesh.castShadow = true;
  group.add(strapMesh);

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. CAP (Standard plain cap)
// ─────────────────────────────────────────────────────────────────────────────
export function buildCap(options = {}) {
  const radius = options.radius ?? DEFAULT_HEAD_RADIUS;
  const colors = resolveCosmeticColors(options);
  const mats = createCosmeticMaterials(colors);

  const group = new THREE.Group();
  group.name = 'headwear-cap';

  const crownRadius = radius * 1.03;
  const phiRim = Math.PI * 0.50;

  // Cap crown dome - covers upper skull down to brow
  const crownGeo = new THREE.SphereGeometry(crownRadius, 32, 16, 0, Math.PI * 2, 0, phiRim);
  const crownMesh = new THREE.Mesh(crownGeo, mats.primaryMat);
  crownMesh.name = 'cap-crown';
  crownMesh.castShadow = true;
  group.add(crownMesh);

  // Curved visor bill
  const visorGeo = createCurvedBaseballVisorGeo(radius, crownRadius, phiRim, Math.PI * 0.38, radius * 0.68, radius * 0.035);
  const visorMesh = new THREE.Mesh(visorGeo, mats.primaryMat);
  visorMesh.name = 'cap-bill';
  visorMesh.castShadow = true;
  group.add(visorMesh);

  // Top squatchee button
  const buttonGeo = new THREE.CylinderGeometry(radius * 0.08, radius * 0.08, radius * 0.03, 16);
  const buttonMesh = new THREE.Mesh(buttonGeo, mats.jointMat);
  buttonMesh.name = 'cap-button';
  buttonMesh.position.set(0, crownRadius * 1.008, 0);
  buttonMesh.castShadow = true;
  group.add(buttonMesh);

  // Back adjustment strap
  const strapGeo = new THREE.CylinderGeometry(radius * 0.20, radius * 0.20, radius * 0.035, 12);
  const strapMesh = new THREE.Mesh(strapGeo, mats.jointMat);
  strapMesh.name = 'cap-strap';
  strapMesh.position.set(0, crownRadius * Math.cos(phiRim) * 0.95, crownRadius * Math.sin(phiRim) * 0.98);
  strapMesh.rotation.x = Math.PI / 2 + 0.12;
  strapMesh.castShadow = true;
  group.add(strapMesh);

  // Backwards cap (catalog spec `billBackward: true`): one group yaw flips the
  // bill to sit over the nape and the adjustment strap to face forward. Crown
  // and button are radially symmetric, so a single rotation is the whole visual
  // change; no new geometry, no new materials.
  if (options.billBackward === true) {
    group.rotation.y = Math.PI;
  }

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. HEADBAND (Standard sweat headband)
// ─────────────────────────────────────────────────────────────────────────────
export function buildHeadband(options = {}) {
  const radius = options.radius ?? DEFAULT_HEAD_RADIUS;
  const colors = resolveCosmeticColors(options);
  const mats = createCosmeticMaterials(colors);

  const group = new THREE.Group();
  group.name = 'headwear-headband';

  const bandRadius = radius * 1.01;

  // Wide athletic sweatband ring
  const bandGeo = new THREE.TorusGeometry(bandRadius, radius * 0.07, 16, 32);
  const bandMesh = new THREE.Mesh(bandGeo, mats.primaryMat);
  bandMesh.name = 'headband-main';
  bandMesh.position.set(0, radius * 0.10, 0);
  bandMesh.rotation.x = Math.PI / 2;
  bandMesh.castShadow = true;
  group.add(bandMesh);

  // Accent middle stripe
  const stripeGeo = new THREE.TorusGeometry(bandRadius * 1.008, radius * 0.022, 12, 32);
  const stripeMesh = new THREE.Mesh(stripeGeo, mats.accentMat);
  stripeMesh.name = 'headband-stripe';
  stripeMesh.position.set(0, radius * 0.10, 0);
  stripeMesh.rotation.x = Math.PI / 2;
  stripeMesh.castShadow = true;
  group.add(stripeMesh);

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. GOGGLES (Standard court goggles)
// ─────────────────────────────────────────────────────────────────────────────
export function buildGoggles(options = {}) {
  const radius = options.radius ?? DEFAULT_HEAD_RADIUS;
  const colors = resolveCosmeticColors(options);
  const mats = createCosmeticMaterials(colors);

  const group = new THREE.Group();
  group.name = 'headwear-goggles';

  const eyeZ = -radius * 0.94;
  const eyeY = radius * 0.04;
  const eyeSpacing = radius * 0.38;

  // Elastic wrap strap encircling skull
  const strapGeo = new THREE.TorusGeometry(radius * 1.01, radius * 0.045, 8, 32);
  const strapMesh = new THREE.Mesh(strapGeo, mats.jointMat);
  strapMesh.name = 'goggles-strap';
  strapMesh.position.set(0, eyeY, 0);
  strapMesh.rotation.x = Math.PI / 2;
  strapMesh.castShadow = true;
  group.add(strapMesh);

  // Lens frame rings (Left and Right)
  const frameGeo = new THREE.TorusGeometry(radius * 0.25, radius * 0.06, 12, 24);

  const frameL = new THREE.Mesh(frameGeo, mats.primaryMat);
  frameL.name = 'goggles-frame-l';
  frameL.position.set(-eyeSpacing, eyeY, eyeZ);
  frameL.castShadow = true;
  group.add(frameL);

  const frameR = new THREE.Mesh(frameGeo, mats.primaryMat);
  frameR.name = 'goggles-frame-r';
  frameR.position.set(eyeSpacing, eyeY, eyeZ);
  frameR.castShadow = true;
  group.add(frameR);

  // Translucent tinted lenses
  const lensGeo = new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, radius * 0.02, 24);

  const lensL = new THREE.Mesh(lensGeo, mats.lensMat);
  lensL.name = 'goggles-lens-l';
  lensL.position.set(-eyeSpacing, eyeY, eyeZ);
  lensL.rotation.x = Math.PI / 2;
  group.add(lensL);

  const lensR = new THREE.Mesh(lensGeo, mats.lensMat);
  lensR.name = 'goggles-lens-r';
  lensR.position.set(eyeSpacing, eyeY, eyeZ);
  lensR.rotation.x = Math.PI / 2;
  group.add(lensR);

  // Center nose bridge
  const bridgeGeo = new THREE.BoxGeometry(radius * 0.24, radius * 0.06, radius * 0.04);
  const bridgeMesh = new THREE.Mesh(bridgeGeo, mats.accentMat);
  bridgeMesh.name = 'goggles-bridge';
  bridgeMesh.position.set(0, eyeY, eyeZ * 1.01);
  bridgeMesh.castShadow = true;
  group.add(bridgeMesh);

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. BEANIE (Standard club beanie)
// ─────────────────────────────────────────────────────────────────────────────
export function buildBeanie(options = {}) {
  const radius = options.radius ?? DEFAULT_HEAD_RADIUS;
  const colors = resolveCosmeticColors(options);
  const mats = createCosmeticMaterials(colors);

  const group = new THREE.Group();
  group.name = 'headwear-beanie';

  const beanieRadius = radius * 1.04;

  // Knit beanie dome
  const domeGeo = new THREE.SphereGeometry(beanieRadius, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.48);
  const domeMesh = new THREE.Mesh(domeGeo, mats.primaryMat);
  domeMesh.name = 'beanie-dome';
  domeMesh.castShadow = true;
  group.add(domeMesh);

  // Folded ribbed cuff band
  const cuffGeo = new THREE.TorusGeometry(beanieRadius * 0.99, radius * 0.075, 16, 32);
  const cuffMesh = new THREE.Mesh(cuffGeo, mats.accentMat);
  cuffMesh.name = 'beanie-cuff';
  cuffMesh.position.set(0, radius * 0.08, 0);
  cuffMesh.rotation.x = Math.PI / 2;
  cuffMesh.castShadow = true;
  group.add(cuffMesh);

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. BANDANA (Standard club bandana / street court wrap)
// ─────────────────────────────────────────────────────────────────────────────
export function buildBandana(options = {}) {
  const radius = options.radius ?? DEFAULT_HEAD_RADIUS;
  const colors = resolveCosmeticColors(options);
  const mats = createCosmeticMaterials(colors);

  const group = new THREE.Group();
  group.name = 'headwear-bandana';

  const bandRadius = radius * 1.02;

  // Fitted skull wrap dome
  const wrapGeo = new THREE.SphereGeometry(bandRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.44);
  const wrapMesh = new THREE.Mesh(wrapGeo, mats.primaryMat);
  wrapMesh.name = 'bandana-wrap';
  wrapMesh.castShadow = true;
  group.add(wrapMesh);

  // Folded brow ring
  const browGeo = new THREE.TorusGeometry(bandRadius * 0.99, radius * 0.05, 12, 32);
  const browMesh = new THREE.Mesh(browGeo, mats.primaryMat);
  browMesh.name = 'bandana-brow';
  browMesh.position.set(0, radius * 0.08, 0);
  browMesh.rotation.x = Math.PI / 2;
  browMesh.castShadow = true;
  group.add(browMesh);

  // Accent edge piping
  const pipeGeo = new THREE.TorusGeometry(bandRadius * 1.01, radius * 0.02, 10, 32);
  const pipeMesh = new THREE.Mesh(pipeGeo, mats.accentMat);
  pipeMesh.name = 'bandana-piping';
  pipeMesh.position.set(0, radius * 0.08, 0);
  pipeMesh.rotation.x = Math.PI / 2;
  pipeMesh.castShadow = true;
  group.add(pipeMesh);

  // Rear knot at the nape (+Z)
  const knotGeo = new THREE.SphereGeometry(radius * 0.075, 12, 12);
  const knotMesh = new THREE.Mesh(knotGeo, mats.primaryMat);
  knotMesh.name = 'bandana-knot';
  knotMesh.position.set(0, radius * 0.04, bandRadius * 1.01);
  knotMesh.castShadow = true;
  group.add(knotMesh);

  // Trailing folded fabric tails
  const tailGeo = new THREE.BoxGeometry(radius * 0.10, radius * 0.28, radius * 0.018);
  const tailL = new THREE.Mesh(tailGeo, mats.primaryMat);
  tailL.name = 'bandana-tail-l';
  tailL.position.set(-radius * 0.05, -radius * 0.14, bandRadius * 1.03);
  tailL.rotation.set(-0.28, 0, 0.24);
  tailL.castShadow = true;
  group.add(tailL);

  const tailR = new THREE.Mesh(tailGeo, mats.accentMat);
  tailR.name = 'bandana-tail-r';
  tailR.position.set(radius * 0.05, -radius * 0.16, bandRadius * 1.03);
  tailR.rotation.set(-0.35, 0, -0.20);
  tailR.castShadow = true;
  group.add(tailR);

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// APPROVED PASS-7 ROSTER PIECES (the Locker Headgear Pack)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ten finalized, approved signature pieces (pass 7, 2026-10-17) live in
 * src/sim/valleyballHeadgear.js, a single self-contained module that takes
 * THREE as an argument rather than importing it. Each entry renders in its
 * AUTHORED palette (Bhavin's helmet stays blue, Malik's horns stay red), which
 * is exactly what Jac approved in the portraits. Zero physics: Group / Mesh
 * only, every dimension scaled by options.radius, nothing feeds the sim.
 *
 * The league mark is one shared texture, loaded lazily once and reused by
 * every piece, so the globe decal costs a single async load per session rather
 * than one per mount. Loading is render-side only and never enters the fixed
 * 60 Hz step (Law 4 / Law 6).
 */

let _leagueMark = null;
function getLeagueMark() {
  if (_leagueMark === null) {
    // Headless physics harnesses (npm test scripts) run without a DOM, so
    // THREE.TextureLoader cannot exist there. The pack treats a missing mark
    // as "decal omitted", which is fine for sim-only runs.
    if (typeof document === 'undefined') return null;
    _leagueMark = HeadgearRoster.loadLeagueMark(THREE);
  }
  return _leagueMark;
}

// item id -> { fn, athleteId }. The item id doubles as the builder key in
// HEADWEAR_BUILDERS below, so SERIES_1_PLAYTEST_CYCLE can reference this tier
// with the same vocabulary the portraits used.
const ROSTER_HEADWEAR = Object.freeze({
  manager_cap:     { fn: HeadgearRoster.buildManagerClassicCap,  athleteId: 'white' },
  sensor_visor:    { fn: HeadgearRoster.buildSensorVisor,        athleteId: 'black' },
  wicket_grill:    { fn: HeadgearRoster.buildWicketkeeperHelmet, athleteId: 'blue' },
  wrestler_bands:  { fn: HeadgearRoster.buildGridironHorns,      athleteId: 'red' },
  terrace_visor:   { fn: HeadgearRoster.buildTerraceMontera,     athleteId: 'green' },
  couture_wrap:    { fn: HeadgearRoster.buildSilkRoadDiadem,     athleteId: 'purple' },
  rigger_band:     { fn: HeadgearRoster.buildWayfinderCord,      athleteId: 'teal' },
  broadcaster_mic: { fn: HeadgearRoster.buildStadiumHeadset,     athleteId: 'yellow' },
  cursor_cap:      { fn: HeadgearRoster.buildWingedCourierCap,   athleteId: 'orange' },
  ouendan_knot:    { fn: HeadgearRoster.buildBleacherHachimaki,  athleteId: 'pink' },
});

/**
 * Wrap an approved roster builder into this module's local `(options) => group`
 * contract. A roster piece always renders in its authored palette, at the
 * mount head's radius, with the shared league mark decal applied.
 */
function makeRosterBuilder({ fn, athleteId }) {
  return function buildApprovedPiece(options = {}) {
    const radius = options.radius ?? DEFAULT_HEAD_RADIUS;
    const palette = HeadgearRoster.resolveHeadwearPalette({ athleteId, ...options });
    return fn(THREE, palette, { radius, markTexture: getLeagueMark(), ...options, athleteId });
  };
}

const APPROVED_ROSTER_BUILDERS = Object.freeze(
  Object.fromEntries(
    Object.entries(ROSTER_HEADWEAR).map(([key, spec]) => [key, makeRosterBuilder(spec)]),
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// BUILDER REGISTRY & COMPOSITE BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Closed registry of mesh builders keyed by the exact strings in MESH_BUILDER_KEYS.
 */
export const HEADWEAR_BUILDERS = Object.freeze({
  visor: buildVisor,
  cap: buildCap,
  headband: buildHeadband,
  goggles: buildGoggles,
  beanie: buildBeanie,
  bandana: buildBandana,
  ...APPROVED_ROSTER_BUILDERS,
});

/**
 * Builds any headwear piece given a catalog ID, builder key, or catalog item object.
 * @param {string | object} itemOrKey
 * @param {object} [options]
 * @returns {THREE.Group | null}
 */
export function buildHeadwear(itemOrKey, options = {}) {
  if (!itemOrKey) return null;

  let builderKey = null;
  let catalogItem = null;

  if (typeof itemOrKey === 'object' && itemOrKey.meshBuilderKey) {
    catalogItem = itemOrKey;
    builderKey = itemOrKey.meshBuilderKey;
  } else if (typeof itemOrKey === 'string') {
    if (HEADWEAR_CATALOG && HEADWEAR_CATALOG[itemOrKey]) {
      catalogItem = HEADWEAR_CATALOG[itemOrKey];
      builderKey = catalogItem.meshBuilderKey;
    } else if (HEADWEAR_BUILDERS[itemOrKey]) {
      builderKey = itemOrKey;
    }
  }

  if (!builderKey || !HEADWEAR_BUILDERS[builderKey]) {
    console.warn(`[cosmeticsBuilders] Unknown builder key or headwear ID: "${itemOrKey}"`);
    return null;
  }

  const mergedOptions = {
    ...options,
    headwearId: catalogItem ? catalogItem.id : (options.headwearId ?? itemOrKey),
    tier: catalogItem ? catalogItem.tier : options.tier,
    ownerAthleteId: catalogItem ? catalogItem.ownerAthleteId : options.ownerAthleteId,
  };

  const builderFn = HEADWEAR_BUILDERS[builderKey];
  return builderFn(mergedOptions);
}

export { resolveHeadwearPalette, recolorHeadgear } from './valleyballHeadgear.js';
