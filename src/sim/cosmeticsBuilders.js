import * as THREE from 'three';

/**
 * THE VALLEYBALL LOCKER: procedural headwear builders.
 *
 * Every export is `create<Item>(radius, colors) -> THREE.Group`, where
 * `radius` is the head sphere radius and `colors` is the object returned by
 * getAthleteColors() in ragdoll.js ({ primary, bodyGrey, jointGrey, ... }).
 *
 * HEAD-LOCAL FRAME (matches the existing athletic cap in ragdoll.js):
 *   origin = skull centre, +Y = up, -Z = forward (face), +Z = back, +X = right.
 * Everything is expressed as a multiple of `radius`, so an item fits any head
 * the rig derives and survives the feminine variant's 0.92 head scale.
 *
 * STRICTLY VISUAL. Nothing in this file knows Rapier exists: no colliders, no
 * bodies, no mass. These groups are mounted under the head's solid mesh group
 * and ride along with it; they never feed anything back into the simulation.
 *
 * DIRECTORY RULE (src/sim/): nothing here names a wall-clock or scheduler API.
 *
 * MATERIAL ROLES: every material carries `userData.colorRole` so that
 * updateAthletePalette() recolors it when the team palette changes:
 *   'primary'  team-colored fabric / metal           -> colors.primary
 *   'joint'    dark graphite fixtures                 -> colors.jointGrey
 *   'bodyGrey' neutral matte body-tone fixtures       -> colors.bodyGrey
 *   'visor'    glowing elements (emissive 1.5)        -> colors.primary + emissive
 *   'accent'   fixed-color detail (e.g. greenstone)   -> left alone
 */

/** Emissive strength for 'visor' role materials, read back by updateAthletePalette. */
export const VISOR_EMISSIVE_INTENSITY = 1.5;

/** Pounamu / jade greenstone used by the Wayfinder Cord toggle. Not team-tinted. */
export const JADE_HEX = 0x2f8f6a;

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function primaryMaterial(colors, extra = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: colors.primary,
    roughness: 0.62,
    metalness: 0.06,
    ...extra,
  });
  mat.userData.colorRole = 'primary';
  return mat;
}

function jointMaterial(colors, extra = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: colors.jointGrey,
    roughness: 0.85,
    metalness: 0.05,
    ...extra,
  });
  mat.userData.colorRole = 'joint';
  return mat;
}

function bodyGreyMaterial(colors, extra = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: colors.bodyGrey,
    roughness: colors.roughness ?? 0.82,
    metalness: colors.metalness ?? 0.04,
    ...extra,
  });
  mat.userData.colorRole = 'bodyGrey';
  return mat;
}

function visorMaterial(colors, extra = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: colors.primary,
    emissive: colors.primary,
    emissiveIntensity: VISOR_EMISSIVE_INTENSITY,
    roughness: 0.28,
    metalness: 0.18,
    ...extra,
  });
  mat.userData.colorRole = 'visor';
  mat.userData.emissiveIntensity = VISOR_EMISSIVE_INTENSITY;
  return mat;
}

function accentMaterial(hex, extra = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: hex,
    roughness: 0.35,
    metalness: 0.12,
    ...extra,
  });
  mat.userData.colorRole = 'accent';
  return mat;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function mesh(geometry, material, name) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = false;
  if (name) m.name = name;
  return m;
}

/**
 * A horizontal ring (or ring segment) around the skull, centred on the face.
 * `arc` is the swept angle; `arc = 2π` is a full headband. `facing` rotates
 * the segment's centre around +Y: 0 = forward (-Z), π = backward (+Z).
 */
function ring(radius, tube, arc, material, { y = 0, facing = 0, name } = {}) {
  const geo = new THREE.TorusGeometry(radius, tube, 10, Math.max(16, Math.round(arc * 12)), arc);
  const m = mesh(geo, material, name);
  // TorusGeometry lies in the XY plane with its arc starting on +X. Yaw it so
  // the arc's midpoint will face -Z (then `facing`), and lay it flat into XZ.
  // After this the mesh's LOCAL Z is world-up, so callers that want to squash
  // or stretch the band vertically scale `.z`, not `.y`.
  m.rotation.set(0, (Math.PI - arc) / 2 + facing, 0);
  m.rotateX(-Math.PI / 2);
  m.position.y = y;
  return m;
}

/** A straight strut between two head-local points. */
function strut(from, to, thickness, material, name) {
  _dir.subVectors(to, from);
  const length = _dir.length();
  const geo = new THREE.CylinderGeometry(thickness, thickness, length, 10, 1);
  const m = mesh(geo, material, name);
  _mid.addVectors(from, to).multiplyScalar(0.5);
  m.position.copy(_mid);
  m.quaternion.setFromUnitVectors(UP, _dir.normalize());
  return m;
}

/** Upper skull dome: a sphere cap from the apex down to polar angle `phi`. */
function dome(radius, phi, material, name) {
  const geo = new THREE.SphereGeometry(radius, 32, 16, 0, Math.PI * 2, 0, phi);
  return mesh(geo, material, name);
}

/**
 * A flat half-disc bill. `direction` = -1 extends forward (-Z), +1 backward (+Z).
 * The disc is centred on its straight edge so it can sit on the crown rim.
 */
function halfDiscBill(radius, thickness, material, direction, name) {
  const thetaStart = direction < 0 ? Math.PI / 2 : -Math.PI / 2;
  const geo = new THREE.CylinderGeometry(radius, radius, thickness, 28, 1, false, thetaStart, Math.PI);
  return mesh(geo, material, name);
}

function group(name) {
  const g = new THREE.Group();
  g.name = name;
  return g;
}

// ---------------------------------------------------------------------------
// Builders (one per HEADWEAR_CATALOG entry with a non-null `build`)
// ---------------------------------------------------------------------------

/**
 * Manager Flat-Brim: classic baseball crown with a dead-flat bill extended
 * forward. The crown rim sits just above the brow so the eye line stays clear.
 */
export function createManagerCap(radius, colors) {
  const g = group('headwear-manager_cap');
  const fabric = primaryMaterial(colors);
  const trim = jointMaterial(colors);

  const crownR = radius * 1.04;
  const phiRim = Math.PI * 0.40;
  const yRim = crownR * Math.cos(phiRim);
  const rRim = crownR * Math.sin(phiRim);

  g.add(dome(crownR, phiRim, fabric, 'crown'));

  // Sweatband ring at the rim, in graphite, hides the dome's open edge.
  g.add(ring(rRim, radius * 0.035, Math.PI * 2, trim, { y: yRim, name: 'rim-band' }));

  // Flat bill: half disc hinged on the rim, a hair of downward rake.
  const bill = halfDiscBill(radius * 0.92, radius * 0.04, fabric, -1, 'flat-bill');
  bill.position.set(0, yRim - radius * 0.01, -rRim * 0.92);
  bill.rotation.x = -0.05;
  g.add(bill);

  // Squatchee button on top.
  const button = mesh(new THREE.CylinderGeometry(radius * 0.08, radius * 0.08, radius * 0.035, 16), trim, 'button');
  button.position.y = crownR * 1.005;
  g.add(button);

  return g;
}

/**
 * Sensor Visor: a horizontal curved bar across the eye line with an emissive
 * strip, mounted on a graphite housing band that wraps the back of the skull.
 */
export function createSensorVisor(radius, colors) {
  const g = group('headwear-sensor_visor');
  const housing = jointMaterial(colors, { roughness: 0.55, metalness: 0.35 });
  const glow = visorMaterial(colors);

  const yEye = radius * 0.12;

  // Rear housing band: the half that wraps around the back.
  g.add(ring(radius * 1.05, radius * 0.07, Math.PI * 1.15, housing, { y: yEye, facing: Math.PI, name: 'housing' }));

  // Front emissive bar across the eyes.
  const bar = ring(radius * 1.07, radius * 0.11, Math.PI * 0.95, glow, { y: yEye, name: 'visor-bar' });
  bar.scale.z = 0.65; // squash the tube vertically: a flat strip, not a sausage
  g.add(bar);

  // Temple emitter nodes where bar meets housing.
  for (const side of [-1, 1]) {
    const node = mesh(new THREE.SphereGeometry(radius * 0.12, 16, 12), glow, side < 0 ? 'node-l' : 'node-r');
    node.position.set(side * radius * 1.06, yEye, -radius * 0.12);
    g.add(node);
  }

  return g;
}

/**
 * Wicketkeeper Grill: a minimalist protective faceguard curved over the lower
 * face, built from thin graphite bars anchored to small temple pads.
 */
export function createWicketGrill(radius, colors) {
  const g = group('headwear-wicket_grill');
  const bars = jointMaterial(colors, { roughness: 0.5, metalness: 0.45 });
  const pads = primaryMaterial(colors);

  const R = radius * 1.10;
  const bar = radius * 0.028;

  // Horizontal hoops from just below the eyes down past the chin.
  for (const y of [0.04, -0.12, -0.28, -0.44]) {
    g.add(ring(R, bar, Math.PI * 0.82, bars, { y: radius * y, name: `hoop-${y}` }));
  }

  // Vertical bars tying the hoops together.
  for (const a of [-0.62, 0, 0.62]) {
    const x = R * Math.sin(a);
    const z = -R * Math.cos(a);
    g.add(strut(
      new THREE.Vector3(x, radius * 0.12, z),
      new THREE.Vector3(x, -radius * 0.52, z),
      bar, bars, `upright-${a}`,
    ));
  }

  // Temple anchor pads in team colour.
  for (const side of [-1, 1]) {
    const pad = mesh(new THREE.SphereGeometry(radius * 0.22, 16, 12), pads, side < 0 ? 'pad-l' : 'pad-r');
    pad.position.set(side * radius * 1.02, radius * 0.08, -radius * 0.08);
    pad.scale.set(0.45, 1, 1);
    g.add(pad);
  }

  return g;
}

/**
 * Combat Horns: two angled athletic horns rising from flattened temple pads,
 * tapering outward. Horns in team colour, pads in graphite.
 */
export function createCombatHorns(radius, colors) {
  const g = group('headwear-wrestler_bands');
  const horn = primaryMaterial(colors, { roughness: 0.5 });
  const pad = jointMaterial(colors);

  for (const side of [-1, 1]) {
    const tag = side < 0 ? 'l' : 'r';

    const temple = mesh(new THREE.SphereGeometry(radius * 0.32, 18, 14), pad, `pad-${tag}`);
    temple.position.set(side * radius * 0.90, radius * 0.30, -radius * 0.10);
    temple.scale.set(0.38, 1, 1);
    g.add(temple);

    const spike = mesh(new THREE.ConeGeometry(radius * 0.19, radius * 0.80, 14), horn, `horn-${tag}`);
    spike.position.set(side * radius * 0.86, radius * 0.72, -radius * 0.12);
    // Lean outward (about Z) and a touch forward (about X).
    spike.rotation.set(-0.18, 0, side * -0.62);
    g.add(spike);
  }

  // Connecting brow band so the pads read as one piece of kit.
  g.add(ring(radius * 1.03, radius * 0.045, Math.PI * 1.3, pad, { y: radius * 0.30, facing: Math.PI, name: 'band' }));

  return g;
}

/**
 * Terrace Sun Visor: an open-top headband with an angular, wide brim that
 * shades the upper brow. Three flat panels: a centre plank and two swept wings.
 */
export function createTerraceVisor(radius, colors) {
  const g = group('headwear-terrace_visor');
  const fabric = primaryMaterial(colors);
  const underside = jointMaterial(colors);

  const yBand = radius * 0.34;

  // Open-top band.
  const band = ring(radius * 1.04, radius * 0.09, Math.PI * 2, fabric, { y: yBand, name: 'band' });
  band.scale.z = 1.5; // taller band
  g.add(band);

  const thick = radius * 0.035;

  // Centre plank.
  const plank = mesh(new THREE.BoxGeometry(radius * 1.25, thick, radius * 0.95), fabric, 'brim-centre');
  plank.position.set(0, yBand - radius * 0.02, -radius * 1.40);
  plank.rotation.x = -0.16;
  g.add(plank);

  // Swept wings, angled back toward the temples.
  for (const side of [-1, 1]) {
    const wing = mesh(new THREE.BoxGeometry(radius * 0.95, thick, radius * 0.60), fabric, side < 0 ? 'brim-l' : 'brim-r');
    wing.position.set(side * radius * 1.05, yBand - radius * 0.02, -radius * 0.98);
    wing.rotation.set(-0.16, side * 0.70, 0);
    g.add(wing);
  }

  // Dark underside liner strip so the brim reads as having thickness from below.
  const liner = ring(radius * 1.10, radius * 0.03, Math.PI * 0.9, underside, { y: yBand - radius * 0.07, name: 'liner' });
  g.add(liner);

  return g;
}

/**
 * Silk Road Diadem: an aristocratic tiered crest along the high forehead.
 * Metallic team-colour band with a tall centre spire, two flanking spires,
 * and glowing jewels set at the base of each.
 */
export function createCoutureDiadem(radius, colors) {
  const g = group('headwear-couture_wrap');
  const metal = primaryMaterial(colors, { roughness: 0.28, metalness: 0.65 });
  const jewel = visorMaterial(colors);

  const yBand = radius * 0.46;
  const R = radius * 1.03;

  // Band wraps the front two-thirds of the skull.
  g.add(ring(R, radius * 0.05, Math.PI * 1.35, metal, { y: yBand, name: 'band' }));

  const spires = [
    { a: 0,     h: 0.62, r: 0.11 },
    { a: -0.55, h: 0.40, r: 0.085 },
    { a: 0.55,  h: 0.40, r: 0.085 },
  ];
  for (const s of spires) {
    const x = R * Math.sin(s.a);
    const z = -R * Math.cos(s.a);
    const spire = mesh(new THREE.ConeGeometry(radius * s.r, radius * s.h, 10), metal, `spire-${s.a}`);
    spire.position.set(x, yBand + radius * s.h * 0.5, z);
    // Tilt outward away from the skull by rotating around the tangent axis.
    spire.rotation.set(-0.22 * Math.cos(s.a), 0, -0.22 * Math.sin(s.a));
    g.add(spire);

    const gem = mesh(new THREE.SphereGeometry(radius * s.r * 0.75, 14, 10), jewel, `gem-${s.a}`);
    gem.position.set(x * 1.03, yBand, z * 1.03);
    g.add(gem);
  }

  return g;
}

/**
 * Wayfinder Cord: a knotted double band (one graphite, one team colour) with a
 * jade greenstone toggle hanging from the knot behind the ear.
 */
export function createWayfinderCord(radius, colors) {
  const g = group('headwear-rigger_band');
  const cordDark = jointMaterial(colors, { roughness: 0.9 });
  const cordTeam = primaryMaterial(colors, { roughness: 0.8 });
  const jade = accentMaterial(JADE_HEX);

  const R = radius * 1.03;
  const tube = radius * 0.035;

  // Two bands, slightly offset and tilted against each other.
  // (After ring()'s lay-flat, the mesh's local Y is the forward axis, so a
  // small local-Y rotation rolls the band ear-to-ear.)
  const upper = ring(R, tube, Math.PI * 2, cordTeam, { y: radius * 0.30, name: 'cord-upper' });
  upper.rotateY(0.05);
  g.add(upper);
  const lower = ring(R, tube, Math.PI * 2, cordDark, { y: radius * 0.23, name: 'cord-lower' });
  lower.rotateY(-0.05);
  g.add(lower);

  // Knot behind the right ear.
  const knotAngle = Math.PI * 0.72; // measured from forward, toward +X/+Z
  const kx = R * Math.sin(knotAngle);
  const kz = -R * Math.cos(knotAngle);
  const knot = mesh(new THREE.SphereGeometry(radius * 0.085, 14, 10), cordDark, 'knot');
  knot.position.set(kx, radius * 0.265, kz);
  g.add(knot);

  // Two short cord tails trailing down from the knot.
  const tailTop = new THREE.Vector3(kx, radius * 0.25, kz);
  g.add(strut(tailTop, new THREE.Vector3(kx + radius * 0.08, -radius * 0.10, kz + radius * 0.10), tube * 0.8, cordDark, 'tail-a'));
  g.add(strut(tailTop, new THREE.Vector3(kx - radius * 0.04, -radius * 0.05, kz + radius * 0.16), tube * 0.8, cordTeam, 'tail-b'));

  // Jade toggle: a small adze-shaped pendant on the longer tail.
  const toggle = mesh(new THREE.CapsuleGeometry(radius * 0.05, radius * 0.16, 6, 12), jade, 'toggle');
  toggle.position.set(kx + radius * 0.09, -radius * 0.20, kz + radius * 0.11);
  toggle.rotation.z = 0.12;
  g.add(toggle);

  return g;
}

/**
 * Stadium Headset: an over-ear circular earpiece on the left, a slim headband
 * over the crown, a counter-pad on the right, and a curved boom mic ending in
 * a glowing capsule at the mouth.
 */
export function createBroadcasterHeadset(radius, colors) {
  const g = group('headwear-broadcaster_mic');
  const shell = primaryMaterial(colors, { roughness: 0.45, metalness: 0.2 });
  const graphite = jointMaterial(colors, { roughness: 0.55, metalness: 0.3 });
  const glow = visorMaterial(colors);

  const yEar = -radius * 0.02;
  const xEar = radius * 1.0;

  // Left ear cup: outer shell + inner pad.
  const cup = mesh(new THREE.CylinderGeometry(radius * 0.34, radius * 0.34, radius * 0.16, 24), shell, 'earcup-l');
  cup.rotation.z = Math.PI / 2;
  cup.position.set(-xEar - radius * 0.06, yEar, 0);
  g.add(cup);
  const padL = mesh(new THREE.CylinderGeometry(radius * 0.26, radius * 0.26, radius * 0.08, 24), graphite, 'pad-l');
  padL.rotation.z = Math.PI / 2;
  padL.position.set(-xEar + radius * 0.02, yEar, 0);
  g.add(padL);

  // Right counter-pad (single-ear broadcaster rig).
  const padR = mesh(new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, radius * 0.10, 20), graphite, 'pad-r');
  padR.rotation.z = Math.PI / 2;
  padR.position.set(xEar + radius * 0.01, yEar, 0);
  g.add(padR);

  // Headband over the crown: torus arc in the XY plane from +X over +Y to -X.
  const bandGeo = new THREE.TorusGeometry(radius * 1.08, radius * 0.045, 8, 32, Math.PI);
  const band = mesh(bandGeo, graphite, 'headband');
  band.position.y = yEar;
  g.add(band);

  // Boom mic: two straight segments approximating a curve from the cup to the mouth.
  const a = new THREE.Vector3(-xEar - radius * 0.02, yEar - radius * 0.12, -radius * 0.18);
  const b = new THREE.Vector3(-radius * 0.72, -radius * 0.42, -radius * 0.72);
  const c = new THREE.Vector3(-radius * 0.22, -radius * 0.50, -radius * 1.02);
  g.add(strut(a, b, radius * 0.025, graphite, 'boom-a'));
  g.add(strut(b, c, radius * 0.025, graphite, 'boom-b'));

  const capsule = mesh(new THREE.CapsuleGeometry(radius * 0.06, radius * 0.08, 6, 12), glow, 'mic');
  capsule.position.copy(c);
  capsule.rotation.z = Math.PI / 2;
  g.add(capsule);

  return g;
}

/**
 * Winged Courier Cap: an aerodynamic runner's cap worn backwards, bill to the
 * rear, with two subtle swept fins on the sides.
 */
export function createCourierCap(radius, colors) {
  const g = group('headwear-cursor_cap');
  const fabric = primaryMaterial(colors, { roughness: 0.55 });
  const fin = jointMaterial(colors, { roughness: 0.5, metalness: 0.25 });

  const crownR = radius * 1.04;
  const phiRim = Math.PI * 0.42;
  const yRim = crownR * Math.cos(phiRim);
  const rRim = crownR * Math.sin(phiRim);

  const crown = dome(crownR, phiRim, fabric, 'crown');
  crown.rotation.x = -0.08; // nose-down tilt: low on the brow, open at the back
  g.add(crown);

  // Backward bill with a slight upward flick.
  const bill = halfDiscBill(radius * 0.80, radius * 0.035, fabric, +1, 'rear-bill');
  bill.position.set(0, yRim, rRim * 0.90);
  bill.rotation.x = -0.22;
  g.add(bill);

  // Side fins: thin blades rising toward the rear.
  for (const side of [-1, 1]) {
    const blade = mesh(new THREE.BoxGeometry(radius * 0.035, radius * 0.26, radius * 0.62), fin, side < 0 ? 'fin-l' : 'fin-r');
    blade.position.set(side * radius * 0.98, radius * 0.48, radius * 0.18);
    blade.rotation.set(-0.55, 0, side * 0.12);
    g.add(blade);
  }

  // Small vent stud on the crown apex.
  const stud = mesh(new THREE.SphereGeometry(radius * 0.06, 12, 8), fin, 'stud');
  stud.position.y = crownR * 1.0;
  g.add(stud);

  return g;
}

/**
 * Bleacher Hachimaki: a flat team-colour headband tied at the back of the
 * skull, with two ribbon tails trailing behind.
 */
export function createOuendanHeadband(radius, colors) {
  const g = group('headwear-ouendan_knot');
  const cloth = primaryMaterial(colors, { roughness: 0.78 });

  const yBand = radius * 0.26;

  const band = ring(radius * 1.03, radius * 0.06, Math.PI * 2, cloth, { y: yBand, name: 'band' });
  band.scale.z = 1.9; // flat cloth band, not a cord
  g.add(band);

  // Knot at the back.
  const knot = mesh(new THREE.SphereGeometry(radius * 0.13, 14, 10), cloth, 'knot');
  knot.position.set(0, yBand, radius * 1.02);
  knot.scale.set(1.2, 0.8, 0.8);
  g.add(knot);

  // Two ribbon tails: thin flat strips angled apart and drooping.
  for (const side of [-1, 1]) {
    const tag = side < 0 ? 'l' : 'r';
    const upper = mesh(new THREE.BoxGeometry(radius * 0.13, radius * 0.02, radius * 0.55), cloth, `ribbon-${tag}-a`);
    upper.position.set(side * radius * 0.16, yBand - radius * 0.10, radius * 1.30);
    upper.rotation.set(0.42, side * 0.28, 0);
    g.add(upper);

    const lower = mesh(new THREE.BoxGeometry(radius * 0.12, radius * 0.02, radius * 0.50), cloth, `ribbon-${tag}-b`);
    lower.position.set(side * radius * 0.30, yBand - radius * 0.46, radius * 1.62);
    lower.rotation.set(0.95, side * 0.34, 0);
    g.add(lower);
  }

  return g;
}
