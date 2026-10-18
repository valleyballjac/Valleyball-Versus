import * as THREE from 'three';
import { HEADWEAR_CATALOG } from '../config/cosmetics.js';

/**
 * PROCEDURAL THREE.JS HEADWEAR BUILDERS (Operation "Suit Up & Step Out", Phase 2).
 *
 * Owned by Purple (Parisa "The Palette" Shirin).
 *
 * Implements the complete, closed set of mesh builders for MESH_BUILDER_KEYS
 * defined in src/config/cosmetics.js. Every headwear piece is constructed
 * procedurally from Three.js primitives and materials, with zero runtime heap
 * churn on the match loop, zero physics bodies or colliders, and pure scene-graph
 * attachment to the ragdoll's `headwearSlot`.
 *
 * Brand & Aesthetic Discipline:
 * - Clean silhouettes recognizable across arena camera distances.
 * - Exact palette mapping via `userData.colorRole` ('primary', 'accent', 'joint', 'dark', 'white', 'lens').
 * - Materials utilize PBR MeshStandardMaterial with calibrated roughness and metalness.
 * - Shadow casting and receiving enabled for all structural meshes.
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
// 1. VISOR (John Valleyball signature & standard training visor)
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

  // Signature Captain's Chevron Plate
  const isSignature = options.headwearId === 'john-captains-visor' || options.tier === 'signature' || options.athleteId === 'john';
  if (isSignature) {
    const badgeGeo = new THREE.BoxGeometry(radius * 0.22, radius * 0.07, radius * 0.03);
    const badgeMesh = new THREE.Mesh(badgeGeo, mats.accentMat);
    badgeMesh.name = 'visor-captain-badge';
    badgeMesh.position.set(0, crownRadius * Math.cos(phiRim * 0.75), -crownRadius * Math.sin(phiRim * 0.75) * 1.01);
    badgeMesh.rotation.x = -0.32;
    badgeMesh.castShadow = true;
    group.add(badgeMesh);
  }

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. CAP (Umpire Bot signature ref cap & standard plain cap)
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

  // Signature Umpire referee piping/stripe
  const isSignature = options.headwearId === 'umpire-ref-cap' || options.tier === 'signature' || options.athleteId === 'umpire';
  if (isSignature) {
    const stripeGeo = new THREE.TorusGeometry(crownRadius * 0.99, radius * 0.02, 8, 32, Math.PI);
    const stripeMesh = new THREE.Mesh(stripeGeo, mats.accentMat);
    stripeMesh.name = 'cap-ref-stripe';
    stripeMesh.position.set(0, 0, 0);
    stripeMesh.rotation.y = Math.PI / 2;
    stripeMesh.castShadow = true;
    group.add(stripeMesh);
  }

  // Backwards cap (playtest id `cap_backward`): one group yaw flips the bill to
  // sit over the nape and the adjustment strap to face forward. Crown, button
  // and (absent) stripe are radially symmetric, so a single rotation is the
  // whole visual change; no new geometry, no new materials.
  if (options.billBackward === true) {
    group.rotation.y = Math.PI;
  }

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. HELMET (Bhavin Bhasin signature keeper's helmet)
// ─────────────────────────────────────────────────────────────────────────────
export function buildHelmet(options = {}) {
  const radius = options.radius ?? DEFAULT_HEAD_RADIUS;
  const colors = resolveCosmeticColors(options);
  const mats = createCosmeticMaterials(colors);

  const group = new THREE.Group();
  group.name = 'headwear-helmet';

  const helmRadius = radius * 1.05;

  // Protective outer dome
  const shellGeo = new THREE.SphereGeometry(helmRadius, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const shellMesh = new THREE.Mesh(shellGeo, mats.primaryMat);
  shellMesh.name = 'helmet-shell';
  shellMesh.castShadow = true;
  group.add(shellMesh);

  // Reinforced brow impact bar
  const browGeo = new THREE.TorusGeometry(helmRadius * 0.98, radius * 0.05, 12, 32, Math.PI * 0.85);
  const browMesh = new THREE.Mesh(browGeo, mats.accentMat);
  browMesh.name = 'helmet-brow-bar';
  browMesh.position.set(0, radius * 0.12, 0);
  browMesh.rotation.x = Math.PI * 0.60;
  browMesh.rotation.z = -Math.PI * 0.425;
  browMesh.castShadow = true;
  group.add(browMesh);

  // Top central ridge / ventilation spine
  const spineGeo = new THREE.BoxGeometry(radius * 0.12, radius * 0.08, helmRadius * 1.8);
  const spineMesh = new THREE.Mesh(spineGeo, mats.accentMat);
  spineMesh.name = 'helmet-crest';
  spineMesh.position.set(0, helmRadius * 0.96, -radius * 0.05);
  spineMesh.castShadow = true;
  group.add(spineMesh);

  // Left & right protective ear guards
  const earLGeo = new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, radius * 0.06, 16);
  const earL = new THREE.Mesh(earLGeo, mats.jointMat);
  earL.name = 'helmet-ear-l';
  earL.position.set(-helmRadius * 0.95, -radius * 0.08, 0);
  earL.rotation.z = Math.PI / 2;
  earL.castShadow = true;
  group.add(earL);

  const earR = new THREE.Mesh(earLGeo, mats.jointMat);
  earR.name = 'helmet-ear-r';
  earR.position.set(helmRadius * 0.95, -radius * 0.08, 0);
  earR.rotation.z = Math.PI / 2;
  earR.castShadow = true;
  group.add(earR);

  // Under-chin fastener strap
  const strapGeo = new THREE.TorusGeometry(radius * 0.92, radius * 0.025, 8, 24, Math.PI * 0.7);
  const strapMesh = new THREE.Mesh(strapGeo, mats.jointMat);
  strapMesh.name = 'helmet-strap';
  strapMesh.position.set(0, -radius * 0.45, -radius * 0.10);
  strapMesh.rotation.x = Math.PI * 0.15;
  strapMesh.rotation.z = Math.PI * 0.65;
  strapMesh.castShadow = true;
  group.add(strapMesh);

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. HEADBAND (Malik Modou signature slugger's headband & standard headband)
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

  // Signature Malik tie knot and trailing dynamic ribbons at rear (+Z)
  const isSignature = options.headwearId === 'malik-sluggers-headband' || options.tier === 'signature' || options.athleteId === 'malik';
  if (isSignature) {
    const knotGeo = new THREE.SphereGeometry(radius * 0.08, 12, 12);
    const knotMesh = new THREE.Mesh(knotGeo, mats.primaryMat);
    knotMesh.name = 'headband-knot';
    knotMesh.position.set(0, radius * 0.10, bandRadius * 1.02);
    knotMesh.castShadow = true;
    group.add(knotMesh);

    // Twin fluttering ribbon tails
    const ribbonGeo = new THREE.BoxGeometry(radius * 0.06, radius * 0.35, radius * 0.02);
    const ribbonL = new THREE.Mesh(ribbonGeo, mats.primaryMat);
    ribbonL.name = 'headband-tail-l';
    ribbonL.position.set(-radius * 0.06, -radius * 0.12, bandRadius * 1.05);
    ribbonL.rotation.set(-0.25, 0, 0.28);
    ribbonL.castShadow = true;
    group.add(ribbonL);

    const ribbonR = new THREE.Mesh(ribbonGeo, mats.accentMat);
    ribbonR.name = 'headband-tail-r';
    ribbonR.position.set(radius * 0.06, -radius * 0.14, bandRadius * 1.05);
    ribbonR.rotation.set(-0.32, 0, -0.22);
    ribbonR.castShadow = true;
    group.add(ribbonR);
  }

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. SUNHAT (Tupac Quispe signature groundsman's sunhat)
// ─────────────────────────────────────────────────────────────────────────────
export function buildSunhat(options = {}) {
  const radius = options.radius ?? DEFAULT_HEAD_RADIUS;
  const colors = resolveCosmeticColors(options);
  const mats = createCosmeticMaterials(colors);

  const group = new THREE.Group();
  group.name = 'headwear-sunhat';

  const crownRadius = radius * 1.02;

  // Crown cylinder with rounded top
  const crownGeo = new THREE.CylinderGeometry(crownRadius * 0.88, crownRadius, radius * 0.65, 32);
  const crownMesh = new THREE.Mesh(crownGeo, mats.primaryMat);
  crownMesh.name = 'sunhat-crown';
  crownMesh.position.set(0, radius * 0.42, 0);
  crownMesh.castShadow = true;
  group.add(crownMesh);

  // Crown dome cap
  const capGeo = new THREE.SphereGeometry(crownRadius * 0.88, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.4);
  const capMesh = new THREE.Mesh(capGeo, mats.primaryMat);
  capMesh.name = 'sunhat-top-dome';
  capMesh.position.set(0, radius * 0.68, 0);
  capMesh.castShadow = true;
  group.add(capMesh);

  // Woven ribbon hatband around base of crown
  const bandGeo = new THREE.CylinderGeometry(crownRadius * 1.02, crownRadius * 1.02, radius * 0.10, 32);
  const bandMesh = new THREE.Mesh(bandGeo, mats.accentMat);
  bandMesh.name = 'sunhat-band';
  bandMesh.position.set(0, radius * 0.16, 0);
  bandMesh.castShadow = true;
  group.add(bandMesh);

  // 360-degree wide sloping brim
  const brimGeo = new THREE.CylinderGeometry(radius * 1.85, crownRadius * 1.01, radius * 0.12, 32, 1, true);
  const brimMesh = new THREE.Mesh(brimGeo, mats.primaryMat);
  brimMesh.name = 'sunhat-brim';
  brimMesh.position.set(0, radius * 0.08, 0);
  brimMesh.castShadow = true;
  brimMesh.receiveShadow = true;
  group.add(brimMesh);

  // Brim edge trim in accent color
  const trimGeo = new THREE.TorusGeometry(radius * 1.85, radius * 0.02, 10, 32);
  const trimMesh = new THREE.Mesh(trimGeo, mats.accentMat);
  trimMesh.name = 'sunhat-trim';
  trimMesh.position.set(0, radius * 0.02, 0);
  trimMesh.rotation.x = Math.PI / 2;
  trimMesh.castShadow = true;
  group.add(trimMesh);

  // Draw cord / toggle
  const cordGeo = new THREE.CylinderGeometry(radius * 0.015, radius * 0.015, radius * 0.50, 8);
  const cordMesh = new THREE.Mesh(cordGeo, mats.jointMat);
  cordMesh.name = 'sunhat-cord';
  cordMesh.position.set(0, -radius * 0.28, 0);
  cordMesh.castShadow = true;
  group.add(cordMesh);

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. BERET (Parisa Shirin signature costumer's beret)
// ─────────────────────────────────────────────────────────────────────────────
export function buildBeret(options = {}) {
  const radius = options.radius ?? DEFAULT_HEAD_RADIUS;
  const colors = resolveCosmeticColors(options);
  const mats = createCosmeticMaterials(colors);

  const group = new THREE.Group();
  group.name = 'headwear-beret';

  // Chic tilted beret container sitting flush atop the skull
  const beretCrown = new THREE.Group();
  beretCrown.name = 'beret-crown-group';
  beretCrown.position.set(radius * 0.12, radius * 0.82, -radius * 0.04);
  beretCrown.rotation.z = -0.24; // classic Parisian tilt
  beretCrown.rotation.x = 0.08;

  // Single unified squashed sphere body: clean silhouette, zero overlapping seams/Z-fighting
  const crownGeo = new THREE.SphereGeometry(radius * 0.92, 24, 16);
  const crownMesh = new THREE.Mesh(crownGeo, mats.primaryMat);
  crownMesh.name = 'beret-body';
  crownMesh.scale.set(1.0, 0.28, 1.0);
  crownMesh.castShadow = true;
  beretCrown.add(crownMesh);

  // Subtle headband rim anchoring to skull
  const rimGeo = new THREE.TorusGeometry(radius * 0.58, radius * 0.035, 12, 24);
  const rimMesh = new THREE.Mesh(rimGeo, mats.accentMat);
  rimMesh.name = 'beret-rim';
  rimMesh.rotation.x = Math.PI / 2;
  rimMesh.position.set(0, -radius * 0.14, 0);
  rimMesh.castShadow = true;
  beretCrown.add(rimMesh);

  // Classic top stem tab (cabillou)
  const stemGeo = new THREE.CylinderGeometry(radius * 0.02, radius * 0.02, radius * 0.08, 8);
  const stemMesh = new THREE.Mesh(stemGeo, mats.accentMat);
  stemMesh.name = 'beret-stem';
  stemMesh.position.set(0, radius * 0.26, 0);
  stemMesh.castShadow = true;
  beretCrown.add(stemMesh);

  group.add(beretCrown);
  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. GOGGLES (Kahu Manaaki signature rigger's goggles & standard goggles)
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

  // Signature industrial studs for Kahu's piece
  const isSignature = options.headwearId === 'kahu-riggers-goggles' || options.tier === 'signature' || options.athleteId === 'kahu';
  if (isSignature) {
    const studGeo = new THREE.CylinderGeometry(radius * 0.035, radius * 0.035, radius * 0.03, 8);
    const studL = new THREE.Mesh(studGeo, mats.accentMat);
    studL.name = 'goggles-stud-l';
    studL.position.set(-eyeSpacing * 1.6, eyeY, eyeZ * 0.85);
    studL.rotation.z = Math.PI / 2;
    group.add(studL);

    const studR = new THREE.Mesh(studGeo, mats.accentMat);
    studR.name = 'goggles-stud-r';
    studR.position.set(eyeSpacing * 1.6, eyeY, eyeZ * 0.85);
    studR.rotation.z = Math.PI / 2;
    group.add(studR);
  }

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. HEADSET (Catarina Sol signature broadcast headset)
// ─────────────────────────────────────────────────────────────────────────────
export function buildHeadset(options = {}) {
  const radius = options.radius ?? DEFAULT_HEAD_RADIUS;
  const colors = resolveCosmeticColors(options);
  const mats = createCosmeticMaterials(colors);

  const group = new THREE.Group();
  group.name = 'headwear-headset';

  const archRadius = radius * 1.05;

  // Overhead cushioned arch band from ear to ear across the top of the skull
  const bandGeo = new THREE.TorusGeometry(archRadius, radius * 0.04, 10, 24, Math.PI);
  const bandMesh = new THREE.Mesh(bandGeo, mats.primaryMat);
  bandMesh.name = 'headset-arch';
  bandMesh.castShadow = true;
  group.add(bandMesh);

  // Left & right cushioned earcups sitting flush against the skull sides
  const cupGeo = new THREE.CylinderGeometry(radius * 0.28, radius * 0.28, radius * 0.12, 20);

  // Left earcup (-X)
  const cupL = new THREE.Mesh(cupGeo, mats.jointMat);
  cupL.name = 'headset-cup-l';
  cupL.position.set(-archRadius * 0.98, 0, 0);
  cupL.rotation.z = Math.PI / 2;
  cupL.castShadow = true;
  group.add(cupL);

  const plateL = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, radius * 0.04, 16), mats.primaryMat);
  plateL.position.set(-archRadius * 1.04, 0, 0);
  plateL.rotation.z = Math.PI / 2;
  group.add(plateL);

  // Right earcup (+X)
  const cupR = new THREE.Mesh(cupGeo, mats.jointMat);
  cupR.name = 'headset-cup-r';
  cupR.position.set(archRadius * 0.98, 0, 0);
  cupR.rotation.z = Math.PI / 2;
  cupR.castShadow = true;
  group.add(cupR);

  const plateR = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, radius * 0.04, 16), mats.primaryMat);
  plateR.position.set(archRadius * 1.04, 0, 0);
  plateR.rotation.z = Math.PI / 2;
  group.add(plateR);

  // Articulating boom microphone: anchored cleanly to left earcup, extending forward (-Z) and down toward mouth
  const boomGroup = new THREE.Group();
  boomGroup.name = 'headset-boom';
  boomGroup.position.set(-archRadius * 0.98, -radius * 0.05, 0);

  const armGeo = new THREE.CylinderGeometry(radius * 0.02, radius * 0.02, radius * 0.72, 8);
  const armMesh = new THREE.Mesh(armGeo, mats.jointMat);
  armMesh.position.set(radius * 0.25, -radius * 0.20, -radius * 0.35);
  armMesh.rotation.set(0.70, 0.40, -0.45);
  armMesh.castShadow = true;
  boomGroup.add(armMesh);

  // Microphone windscreen capsule
  const micGeo = new THREE.SphereGeometry(radius * 0.06, 12, 8);
  const micMesh = new THREE.Mesh(micGeo, mats.accentMat);
  micMesh.position.set(radius * 0.45, -radius * 0.42, -radius * 0.65);
  micMesh.castShadow = true;
  boomGroup.add(micMesh);

  group.add(boomGroup);
  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. BUCKETHAT (Vinny Valerius signature scout's bucket hat)
// ─────────────────────────────────────────────────────────────────────────────
export function buildBuckethat(options = {}) {
  const radius = options.radius ?? DEFAULT_HEAD_RADIUS;
  const colors = resolveCosmeticColors(options);
  const mats = createCosmeticMaterials(colors);

  const group = new THREE.Group();
  group.name = 'headwear-buckethat';

  const crownRadius = radius * 1.02;

  // Tapered bucket crown
  const crownGeo = new THREE.CylinderGeometry(crownRadius * 0.88, crownRadius, radius * 0.52, 32);
  const crownMesh = new THREE.Mesh(crownGeo, mats.primaryMat);
  crownMesh.name = 'buckethat-crown';
  crownMesh.position.set(0, radius * 0.34, 0);
  crownMesh.castShadow = true;
  group.add(crownMesh);

  // Crown flat top
  const topGeo = new THREE.CircleGeometry(crownRadius * 0.88, 32);
  const topMesh = new THREE.Mesh(topGeo, mats.primaryMat);
  topMesh.name = 'buckethat-top';
  topMesh.position.set(0, radius * 0.60, 0);
  topMesh.rotation.x = -Math.PI / 2;
  topMesh.castShadow = true;
  group.add(topMesh);

  // Contrast scout band
  const bandGeo = new THREE.CylinderGeometry(crownRadius * 1.015, crownRadius * 1.015, radius * 0.09, 32);
  const bandMesh = new THREE.Mesh(bandGeo, mats.accentMat);
  bandMesh.name = 'buckethat-band';
  bandMesh.position.set(0, radius * 0.14, 0);
  bandMesh.castShadow = true;
  group.add(bandMesh);

  // Downward-sloping flared bucket brim
  const brimGeo = new THREE.CylinderGeometry(crownRadius, radius * 1.48, radius * 0.20, 32, 1, true);
  const brimMesh = new THREE.Mesh(brimGeo, mats.primaryMat);
  brimMesh.name = 'buckethat-brim';
  brimMesh.position.set(0, radius * 0.04, 0);
  brimMesh.castShadow = true;
  brimMesh.receiveShadow = true;
  group.add(brimMesh);

  // Stitch rim accent
  const stitchGeo = new THREE.TorusGeometry(radius * 1.48, radius * 0.018, 8, 32);
  const stitchMesh = new THREE.Mesh(stitchGeo, mats.accentMat);
  stitchMesh.name = 'buckethat-stitch';
  stitchMesh.position.set(0, -radius * 0.06, 0);
  stitchMesh.rotation.x = Math.PI / 2;
  group.add(stitchMesh);

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. BEANIE (Kimi Kizuna signature fan's beanie & standard club beanie)
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

  // Signature fluffy pom-pom for Kimi's piece
  const isSignature = options.headwearId === 'kimi-fans-beanie' || options.tier === 'signature' || options.athleteId === 'kimi';
  if (isSignature) {
    const pomGeo = new THREE.SphereGeometry(radius * 0.16, 16, 16);
    const pomMesh = new THREE.Mesh(pomGeo, mats.accentMat);
    pomMesh.name = 'beanie-pompom';
    pomMesh.position.set(0, beanieRadius * 1.06, 0);
    pomMesh.castShadow = true;
    group.add(pomMesh);
  }

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. BANDANA (Standard club bandana / street court wrap)
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
// BUILDER REGISTRY & COMPOSITE BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Closed registry of mesh builders keyed by the exact strings in MESH_BUILDER_KEYS.
 */
export const HEADWEAR_BUILDERS = Object.freeze({
  visor: buildVisor,
  cap: buildCap,
  helmet: buildHelmet,
  headband: buildHeadband,
  sunhat: buildSunhat,
  beret: buildBeret,
  goggles: buildGoggles,
  headset: buildHeadset,
  buckethat: buildBuckethat,
  beanie: buildBeanie,
  bandana: buildBandana,
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
