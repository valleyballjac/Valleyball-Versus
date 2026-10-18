/**
 * ============================================================================
 *  VALLEYBALL VERSUS: THE LOCKER HEADGEAR PACK (pass 7, approved 2026-10-17)
 * ============================================================================
 *
 *  Ten signature headgear pieces for the canonical roster, as procedural
 *  Three.js geometry. One file, no imports: pass your own `THREE` in.
 *
 *  SIGNATURE
 *    build<ItemName>(THREE, palette, options) -> THREE.Group
 *
 *    THREE    the three.js module (r150+; verified on r185)
 *    palette  { primary, secondary, accent, neutral } as 0xRRGGBB numbers
 *    options  { radius = 0.20,        head sphere radius in metres
 *               markTexture = null,   THREE.Texture for the league mark (see loadLeagueMark)
 *               castShadow = true }
 *
 *  ANCHOR: the returned group is in HEAD-LOCAL space: origin at the head
 *  sphere's centre, +Y up, -Z the face, +Z the back, +X the athlete's right.
 *  Parent it to the head and it is placed. Every dimension scales with
 *  `options.radius`, so one builder fits any head.
 *
 *  FLOATING HEAD RULE: nothing in any piece extends below the chin line
 *  (y > -0.8 * radius for every piece); there is no neck or torso geometry.
 *
 *  ZERO PHYSICS: these are THREE.Group / THREE.Mesh only. No colliders, no
 *  bodies, no mass. They never feed anything back into a simulation.
 *
 *  COLOUR BINDINGS (how the palette maps onto each part)
 *    primary   the athlete's team colour: cap/helmet/hat/headband fabric,
 *              the Blue helmet shell, Red's stripes, ear pieces and horns,
 *              Purple's metal, Teal's band, Yellow's cups, Pink's cloth, the
 *              VISOR housing on Black.
 *    accent    the contrasting trim: White's button, strap and league mark;
 *              Blue's grille and ear-guard marks; Red's shell and face guard;
 *              Green's hat band and beads; Teal's cords and knot; Yellow's
 *              pads, headband and boom; Orange's fins; every league mark.
 *              Rule: accent is the OPPOSITE of the base kit (near-white on
 *              the black home kit, near-black on the white away kit), except
 *              the two neutral palettes, which flip so the trim still reads
 *              (White's cap gets black trim, Black's VISOR gets white).
 *              `accentFor(primary, kit)` implements this.
 *    secondary the base-layer kit colour (home 0x383b42, away 0xffffff).
 *              Reserved for 'bodyGrey' parts; no approved piece uses it.
 *    neutral   joint grey (home 0x22242a, away 0xd0d5dd). Reserved; unused.
 *    glow      (derived) emissive elements: Black's scanner slit, Purple's
 *              jewels, Yellow's on-air lamp. Primary, except a near-black
 *              primary glows cool white (0xdbe4f0) so it stays visible.
 *    fixed     never recoloured: Teal's jade toki (0x2f8f6a), Yellow's foam
 *              windscreen (0x24262b) and marigold (0xf59e0b/0xd97706/0x92400e),
 *              Purple's pearls (0xf3ecdc).
 *
 *  Every material carries `userData.colorRole` ('primary' | 'accent' |
 *  'bodyGrey' | 'visor' | 'fixed'), so `recolorHeadgear(group, palette)`
 *  re-tints a live piece when the player changes kit.
 *
 *  THE LEAGUE MARK is the flat monochrome Valleyball globe, applied as an
 *  alpha-cut decal in the accent colour. Load it once with
 *  `loadLeagueMark(THREE)` (embedded 512px mask) or `loadLeagueMark(THREE, url)`
 *  and pass it as `options.markTexture`. Without it the marks are omitted.
 *
 *  INVENTORY (athlete, item, internal id, builder, palette hex, kit, accent)
 *    White   John Valleyball              Manager Classic Cap   manager_cap      buildManagerClassicCap   0xF8FAFC  home  0x0f172a (flipped)
 *    Black   Umpire Bot                   Sensor VISOR          sensor_visor     buildSensorVisor         0x0F172A  away  0xf1f5f9 (flipped)
 *    Blue    Bhavin "The Anchor" Bhasin   Wicketkeeper Helmet   wicket_grill     buildWicketkeeperHelmet  0x1D4ED8  away  0x0f172a
 *    Red     Malik "Striker" Modou        Gridiron Horns        wrestler_bands   buildGridironHorns       0xD90429  home  0xf1f5f9
 *    Green   Tupac "The Terrace" Quispe   Terrace Montera       terrace_visor    buildTerraceMontera      0x15803D  home  0xf1f5f9
 *    Purple  Parisa "The Palette" Shirin  Silk Road Diadem      couture_wrap     buildSilkRoadDiadem      0x8B5CF6  away  0x0f172a
 *    Teal    Kahu "The Toki" Manaaki      Wayfinder Cord        rigger_band      buildWayfinderCord       0x06B6D4  home  0xf1f5f9
 *    Yellow  Dona Catarina Sol            Stadium Headset       broadcaster_mic  buildStadiumHeadset      0xFFD60A  home  0xf1f5f9
 *    Orange  Vinny Valerius               Winged Courier Cap    cursor_cap       buildWingedCourierCap    0xEA580C  away  0x0f172a
 *    Pink    Kimi "Hana" Kizuna           Bleacher Hachimaki    ouendan_knot     buildBleacherHachimaki   0xEC4899  away  0x0f172a
 *
 *  QUICK START
 *    import * as THREE from 'three';
 *    import { ROSTER, buildForAthlete, loadLeagueMark } from './valleyballHeadgear.js';
 *    const mark = loadLeagueMark(THREE);
 *    const hat = buildForAthlete(THREE, 'red', { radius: 0.2, markTexture: mark });
 *    headMesh.add(hat);   // headMesh: the head sphere, centred at its origin
 * ============================================================================
 */

export const DEFAULT_HEAD_RADIUS = 0.2;

/** Emissive strength for 'visor' (glow) materials. */
export const VISOR_EMISSIVE_INTENSITY = 1.5;
/** Pounamu / jade greenstone for Teal's toki. Fixed, never team-tinted. */
export const JADE_HEX = 0x2f8f6a;

/** Base layers. `accent` is the opposite of the base so trim reads. */
export const KITS = {
  home: { name: 'Home (black)', secondary: 0x383b42, neutral: 0x22242a, accent: 0xf1f5f9 },
  away: { name: 'Away (white)', secondary: 0xffffff, neutral: 0xd0d5dd, accent: 0x0f172a },
};

/** The ten palettes. */
export const PALETTES = {
  white: 0xF8FAFC, black: 0x0F172A, blue: 0x1D4ED8, red: 0xD90429, green: 0x15803D,
  purple: 0x8B5CF6, teal: 0x06B6D4, yellow: 0xFFD60A, orange: 0xEA580C, pink: 0xEC4899,
};

/** The canonical roster with each athlete's signature piece. */
export const ROSTER = {
  white:  { id: 'white',  name: 'John Valleyball',             item: 'Manager Classic Cap', itemId: 'manager_cap',     build: 'buildManagerClassicCap',  kit: 'home', variant: 'classic' },
  black:  { id: 'black',  name: 'Umpire Bot',                  item: 'Sensor VISOR',        itemId: 'sensor_visor',    build: 'buildSensorVisor',        kit: 'away', variant: 'classic' },
  blue:   { id: 'blue',   name: 'Bhavin "The Anchor" Bhasin',  item: 'Wicketkeeper Helmet', itemId: 'wicket_grill',    build: 'buildWicketkeeperHelmet', kit: 'away', variant: 'masculine' },
  red:    { id: 'red',    name: 'Malik "Striker" Modou',       item: 'Gridiron Horns',      itemId: 'wrestler_bands',  build: 'buildGridironHorns',      kit: 'home', variant: 'masculine' },
  green:  { id: 'green',  name: 'Tupac "The Terrace" Quispe',  item: 'Terrace Montera',     itemId: 'terrace_visor',   build: 'buildTerraceMontera',     kit: 'home', variant: 'classic' },
  purple: { id: 'purple', name: 'Parisa "The Palette" Shirin', item: 'Silk Road Diadem',    itemId: 'couture_wrap',    build: 'buildSilkRoadDiadem',     kit: 'away', variant: 'feminine' },
  teal:   { id: 'teal',   name: 'Kahu "The Toki" Manaaki',     item: 'Wayfinder Cord',      itemId: 'rigger_band',     build: 'buildWayfinderCord',      kit: 'home', variant: 'masculine' },
  yellow: { id: 'yellow', name: 'Dona Catarina Sol',           item: 'Stadium Headset',     itemId: 'broadcaster_mic', build: 'buildStadiumHeadset',     kit: 'home', variant: 'feminine' },
  orange: { id: 'orange', name: 'Vinny Valerius',              item: 'Winged Courier Cap',  itemId: 'cursor_cap',      build: 'buildWingedCourierCap',   kit: 'away', variant: 'classic' },
  pink:   { id: 'pink',   name: 'Kimi "Hana" Kizuna',          item: 'Bleacher Hachimaki',  itemId: 'ouendan_knot',    build: 'buildBleacherHachimaki',  kit: 'away', variant: 'feminine' },
};

function luminance(hex) {
  return (0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255)) / 255;
}

/**
 * The accent for a primary on a kit: the kit's accent, except the two
 * neutral palettes flip so the trim still reads against the piece itself.
 */
export function accentFor(primaryHex, kit = 'home') {
  const lum = luminance(primaryHex);
  if (lum > 0.9) return 0x0f172a;
  if (lum < 0.12) return 0xf1f5f9;
  return KITS[kit].accent;
}

/** The full { primary, secondary, accent, neutral } palette for a roster athlete. */
export function paletteFor(athleteId, kit = null) {
  const entry = ROSTER[athleteId];
  if (!entry) throw new Error(`[headgear] unknown athlete "${athleteId}"`);
  const k = kit || entry.kit;
  const primary = PALETTES[entry.id];
  return { primary, secondary: KITS[k].secondary, neutral: KITS[k].neutral, accent: accentFor(primary, k) };
}

/** The league mark as a 512px white-on-black alpha mask (PNG, base64). */
export const LEAGUE_MARK_DATA_URL = 'data:image/png;base64,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'

/**
 * Loads the league mark texture once. Pass the result as options.markTexture.
 * `url` defaults to the embedded mask; point it at your own hosted copy if
 * you prefer (white = opaque, black = cut away: three.js reads alphaMap from
 * the green channel).
 */
export function loadLeagueMark(THREE, url = LEAGUE_MARK_DATA_URL) {
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ===========================================================================
// THE KIT: every helper and builder, closed over the caller's THREE.
// (This is the tested game module, verbatim, parameterised on THREE.)
// ===========================================================================

function makeKit(THREE, markTex) {
  const FOAM_HEX = 0x24262b;

  const UP = new THREE.Vector3(0, 1, 0);
  const _dir = new THREE.Vector3();
  const _mid = new THREE.Vector3();

  // ---------------------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------------------

  function roleMaterial(role, color, extra) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.06, ...extra });
    mat.userData.colorRole = role;
    return mat;
  }
  const primaryMaterial = (c, extra = {}) => roleMaterial('primary', c.primary, extra);
  const accentMaterial = (c, extra = {}) => roleMaterial('accent', c.accent, { roughness: 0.55, metalness: 0.1, ...extra });
  const fixedMaterial = (hex, extra = {}) => roleMaterial('fixed', hex, { roughness: 0.5, metalness: 0.08, ...extra });

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

  const METAL = { roughness: 0.3, metalness: 0.65 };

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
   * `tall` stretches the tube vertically.
   */
  function ring(radius, tube, arc, material, { y = 0, facing = 0, name, tall = 1 } = {}) {
    const geo = new THREE.TorusGeometry(radius, tube, 12, Math.max(16, Math.round(arc * 16)), arc);
    const m = mesh(geo, material, name);
    m.rotation.set(0, (Math.PI - arc) / 2 + facing, 0);
    m.rotateX(-Math.PI / 2);
    m.position.y = y;
    m.scale.z = tall;
    return m;
  }

  /** A flat band: an open cylinder segment around the skull, centred on the face (+ `facing`). */
  function band(radius, height, arc, material, { y = 0, facing = 0, name } = {}) {
    const geo = new THREE.CylinderGeometry(radius, radius, height, Math.max(24, Math.round(arc * 20)), 1, true, 0, arc);
    const m = mesh(geo, material, name);
    m.material.side = THREE.DoubleSide;
    m.rotation.y = Math.PI - arc / 2 + facing;
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
    return mesh(new THREE.SphereGeometry(radius, 36, 18, 0, Math.PI * 2, 0, phi), material, name);
  }

  /** A conical brim from `inner` to `outer`, dropping (`drop` > 0) or lifting toward the edge. */
  function brim(inner, outer, drop, material, name) {
    const h = Math.max(Math.abs(drop), 0.001);
    const geo = new THREE.CylinderGeometry(drop >= 0 ? inner : outer, drop >= 0 ? outer : inner, h, 48, 1, true);
    const m = mesh(geo, material, name);
    m.material.side = THREE.DoubleSide;
    return m;
  }

  /**
   * The classic curved baseball bill from ragdoll.js's athletic cap: fused to
   * the crown rim, pitched by `pitch` (positive = down), curled at the sides.
   * `direction` -1 = forward, +1 = backward.
   */
  function curvedBill(radius, rimRadius, rimY, length, thickness, material, direction, name, pitch = 0.26) {
    const uSteps = 22;
    const tSteps = 10;
    const thetaMax = Math.PI * 0.38;
    const curl = radius * 0.10;
    const positions = [];
    const indices = [];
    const point = (u, t, layer) => {
      const theta = u * thetaMax;
      const profile = Math.max(0, Math.cos(u * Math.PI * 0.5));
      const bx = rimRadius * Math.sin(theta);
      const bz = direction * rimRadius * Math.cos(theta);
      const off = layer === 'top' ? thickness * 0.5 : -thickness * 0.5;
      if (t <= 0) return [bx * 0.96, rimY + off, bz * 0.96];
      const L = length * Math.pow(profile, 0.72) * t;
      const x = bx + Math.sin(theta * 0.7) * L * Math.cos(pitch);
      const z = bz + direction * Math.cos(theta * 0.7) * L * Math.cos(pitch);
      const y = rimY - L * Math.sin(pitch) - curl * u * u * t + off;
      return [x, y, z];
    };
    for (const layer of ['top', 'bottom']) {
      for (let j = 0; j <= tSteps; j++) {
        const t = j === 0 ? -0.15 : j / tSteps;
        for (let i = 0; i <= uSteps; i++) positions.push(...point((i / uSteps) * 2 - 1, t, layer));
      }
    }
    const row = uSteps + 1;
    const layerSize = (tSteps + 1) * row;
    for (let j = 0; j < tSteps; j++) {
      for (let i = 0; i < uSteps; i++) {
        const a = j * row + i;
        indices.push(a, a + row + 1, a + 1, a, a + row, a + row + 1);
        const b = layerSize + a;
        indices.push(b, b + 1, b + row + 1, b, b + row + 1, b + row);
      }
    }
    for (let i = 0; i < uSteps; i++) {
      const t = tSteps * row + i;
      const b = layerSize + t;
      indices.push(t, t + 1, b + 1, t, b + 1, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const m = mesh(geo, material, name);
    m.material.side = THREE.DoubleSide;
    return m;
  }

  function group(name) {
    const g = new THREE.Group();
    g.name = name;
    return g;
  }

  /** Position on a sphere of radius R at yaw `a` (0 = face, +ve toward +X) and height `y`. */
  function onSkull(R, a, y) {
    const r = Math.sqrt(Math.max(0, R * R - y * y));
    return new THREE.Vector3(r * Math.sin(a), y, -r * Math.cos(a));
  }

  /** Position on a vertical cylinder of radius R (a band) at yaw `a`, height `y`. */
  function onBand(R, a, y) {
    return new THREE.Vector3(R * Math.sin(a), y, -R * Math.cos(a));
  }

  /** The league mark texture handed to this kit (white-on-black alpha mask), or null. */
    function markTexture() { return markTex || null; }

  /**
   * THE LEAGUE MARK: a flat disc carrying the globe as an alpha-cut decal in
   * the accent colour. Built facing +Z, `size` is its radius.
   */
  function leagueMark(size, colors, name = 'league-mark') {
    const tex = markTexture();
    const params = { color: colors.accent, roughness: 0.75, metalness: 0.02, side: THREE.DoubleSide };
    if (tex) Object.assign(params, { alphaMap: tex, transparent: true, alphaTest: 0.5 });
    const mat = new THREE.MeshStandardMaterial(params);
    mat.userData.colorRole = 'accent';
    const m = mesh(new THREE.CircleGeometry(size, 48), mat, name);
    m.castShadow = false;
    return m;
  }

  /** Mounts a +Z-facing decal on a sphere (radius R) at yaw `a`, height `y`, edges just touching. */
  function setMark(mark, R, a, y, size) {
    const p = onSkull(R, a, y);
    const normal = p.clone().normalize();
    const lift = (size * size) / (2 * R) + R * 0.004;
    mark.position.copy(p).addScaledVector(normal, lift);
    mark.up.set(0, 1, 0);
    mark.lookAt(_mid.copy(mark.position).add(normal));
    return mark;
  }

  /** Mounts a +Z-facing decal on a vertical band (radius R) at yaw `a`, height `y`. */
  function setMarkOnBand(mark, R, a, y, size) {
    const p = onBand(R, a, y);
    const normal = new THREE.Vector3(p.x, 0, p.z).normalize();
    const lift = (size * size) / (2 * R) + R * 0.004;
    mark.position.copy(p).addScaledVector(normal, lift);
    mark.up.set(0, 1, 0);
    mark.lookAt(_mid.copy(mark.position).add(normal));
    return mark;
  }

  /**
   * A flat ribbon painted along a meridian of a sphere of radius R: from
   * angle t0 to t1 where t = 0 is the apex, +ve toward the face (-Z).
   */
  function meridianStrip(R, width, t0, t1, material, name, xOffset = 0) {
    const steps = 40;
    const positions = [];
    const normals = [];
    const indices = [];
    for (let i = 0; i <= steps; i++) {
      const t = t0 + (t1 - t0) * (i / steps);
      const cy = Math.cos(t);
      const cz = -Math.sin(t);
      for (const sx of [-1, 1]) {
        // Keep every vertex on the sphere: the circle at x shrinks to sqrt(R^2 - x^2).
        const x = xOffset + sx * width * 0.5;
        const r = Math.sqrt(Math.max(0, R * R - x * x));
        positions.push(x, r * cy, r * cz);
        normals.push(x / R, (r * cy) / R, (r * cz) / R);
      }
    }
    for (let i = 0; i < steps; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);
    const m = mesh(geo, material, name);
    m.material.side = THREE.DoubleSide;
    return m;
  }

  /**
   * A cloth band whose height and centre line vary with yaw: `profile(a)`
   * returns { y, h } for yaw a (0 = face). Vertices lie on a cylinder of
   * radius R; normals point outward.
   */
  function shapedBand(R, profile, material, name, steps = 72) {
    const positions = [];
    const normals = [];
    const indices = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const { y, h } = profile(a);
      const x = R * Math.sin(a);
      const z = -R * Math.cos(a);
      positions.push(x, y + h / 2, z, x, y - h / 2, z);
      normals.push(Math.sin(a), 0, -Math.cos(a), Math.sin(a), 0, -Math.cos(a));
    }
    for (let i = 0; i < steps; i++) {
      const a = i * 2;
      indices.push(a, a + 3, a + 1, a, a + 2, a + 3); // wound outward
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);
    const m = mesh(geo, material, name);
    m.material.side = THREE.DoubleSide;
    return m;
  }

  /** A small marigold: a dark centre with two rings of rounded petals. Faces +Y. */
  function marigold(size, name = 'marigold') {
    const g = group(name);
    const petal = fixedMaterial(0xf59e0b, { roughness: 0.8 });
    const inner = fixedMaterial(0xd97706, { roughness: 0.8 });
    const heart = fixedMaterial(0x92400e, { roughness: 0.9 });
    const c = mesh(new THREE.SphereGeometry(size * 0.3, 12, 8), heart, 'heart');
    c.scale.y = 0.6;
    g.add(c);
    for (const [n, r, rad, mat, lift] of [[8, 0.72, 0.36, petal, 0], [6, 0.42, 0.3, inner, 0.08]]) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (n === 6 ? 0.3 : 0);
        const p = mesh(new THREE.SphereGeometry(size * rad, 10, 8), mat, 'petal');
        p.position.set(Math.cos(a) * size * r, size * lift, Math.sin(a) * size * r);
        p.scale.set(1.25, 0.45, 0.8);
        p.rotation.y = -a;
        g.add(p);
      }
    }
    return g;
  }

  /** A tube whose radius tapers from r0 to r1 along `curve`. */
  function taperedTube(curve, r0, r1, material, name, segments = 48, radial = 10) {
    const frames = curve.computeFrenetFrames(segments, false);
    const positions = [];
    const normals = [];
    const indices = [];
    const p = new THREE.Vector3();
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      curve.getPointAt(t, p);
      const r = r0 + (r1 - r0) * t;
      const N = frames.normals[i];
      const B = frames.binormals[i];
      for (let j = 0; j <= radial; j++) {
        const v = (j / radial) * Math.PI * 2;
        const nx = Math.cos(v) * N.x + Math.sin(v) * B.x;
        const ny = Math.cos(v) * N.y + Math.sin(v) * B.y;
        const nz = Math.cos(v) * N.z + Math.sin(v) * B.z;
        positions.push(p.x + r * nx, p.y + r * ny, p.z + r * nz);
        normals.push(nx, ny, nz);
      }
    }
    const row = radial + 1;
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * row + j;
        indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);
    return mesh(geo, material, name);
  }

  // ---------------------------------------------------------------------------
  // WHITE: Manager Classic Cap
  // ---------------------------------------------------------------------------

  /** The base model's classic cap, a shade larger, with the globe on the front panel. */
  function createManagerCap(radius, colors) {
    const g = group('headwear-manager_cap');
    const fabric = primaryMaterial(colors, { roughness: 0.68 });
    const trim = accentMaterial(colors, { roughness: 0.7 });

    const crownR = radius * 1.05;
    const phiRim = Math.PI * 0.37;
    const yRim = crownR * Math.cos(phiRim);
    const rRim = crownR * Math.sin(phiRim);

    const cap = group('cap');
    cap.position.y = radius * 0.02;
    cap.rotation.x = 0.06;
    g.add(cap);
    cap.add(dome(crownR, phiRim, fabric, 'crown'));
    cap.add(curvedBill(radius, rRim, yRim, radius * 0.74, radius * 0.04, fabric, -1, 'bill'));
    const button = mesh(new THREE.CylinderGeometry(radius * 0.08, radius * 0.08, radius * 0.03, 16), trim, 'button');
    button.position.y = crownR * 1.005;
    cap.add(button);
    cap.add(band(rRim * 0.995, radius * 0.07, Math.PI * 0.42, trim, { y: yRim + radius * 0.05, facing: Math.PI, name: 'strap' }));
    cap.add(setMark(leagueMark(radius * 0.19, colors), crownR, 0, yRim + radius * 0.22, radius * 0.19));
    return g;
  }

  // ---------------------------------------------------------------------------
  // BLACK: Sensor VISOR
  // ---------------------------------------------------------------------------

  /**
   * Cylon territory: a slim black band across the eyes with one glowing
   * scanner slit. Housing in the team colour, so the umpire stays black.
   */
  function createSensorVisor(radius, colors) {
    const g = group('headwear-sensor_visor');
    const housing = primaryMaterial(colors, { roughness: 0.35, metalness: 0.5 });
    const glow = visorMaterial(colors);

    const yEye = radius * 0.1;
    const R = radius * 1.06;
    const arc = Math.PI * 0.7;
    g.add(band(R, radius * 0.17, arc, housing, { y: yEye, name: 'band' }));
    g.add(band(R - radius * 0.03, radius * 0.17, arc, housing, { y: yEye, name: 'band-inner' }));
    const scanner = ring(R + radius * 0.01, radius * 0.013, arc * 0.86, glow, { y: yEye, name: 'scanner', tall: 0.7 });
    scanner.material.emissiveIntensity = 0.9;
    scanner.material.userData.emissiveIntensity = 0.9;
    g.add(scanner);
    // The umpire's crest: the league mark flat on the brow, centred above the scanner.
    g.add(setMark(leagueMark(radius * 0.14, colors), radius * 1.0, 0, yEye + radius * 0.34, radius * 0.14));
    return g;
  }

  // ---------------------------------------------------------------------------
  // BLUE: Wicketkeeper Helmet
  // ---------------------------------------------------------------------------

  /**
   * The cricket helmet: shell over the ears with a short peak, ear guards,
   * and a face grille that starts exactly at the shell rim.
   */
  function createWicketGrill(radius, colors) {
    const g = group('headwear-wicket_grill');
    const shell = primaryMaterial(colors, { roughness: 0.4, metalness: 0.15 });
    const bars = accentMaterial(colors, { roughness: 0.45, metalness: 0.5 });

    // The whole helmet sits high and tilts back off the brow: the shell's rim
    // runs from above the eyes at the front down over the ears and nape.
    const helmet = group('helmet');
    helmet.position.y = radius * 0.14;
    helmet.rotation.x = 0.55;
    g.add(helmet);

    const shellR = radius * 1.1;
    const phiShell = Math.PI * 0.55;
    const yRim = shellR * Math.cos(phiShell);
    const rRim = shellR * Math.sin(phiShell);
    helmet.add(dome(shellR, phiShell, shell, 'shell'));
    helmet.add(curvedBill(radius, rRim, yRim + radius * 0.02, radius * 0.42, radius * 0.045, shell, -1, 'peak'));

    for (const side of [-1, 1]) {
      const guard = mesh(new THREE.CylinderGeometry(radius * 0.34, radius * 0.34, radius * 0.12, 24), shell, side < 0 ? 'ear-l' : 'ear-r');
      guard.rotation.z = Math.PI / 2;
      guard.position.set(side * radius * 1.04, -radius * 0.06, 0);
      helmet.add(guard);
      const mark = leagueMark(radius * 0.22, colors, `mark-${side < 0 ? 'l' : 'r'}`);
      mark.position.set(side * (radius * 1.04 + radius * 0.065), -radius * 0.06, 0);
      mark.rotation.y = side * Math.PI / 2;
      helmet.add(mark);
    }

    // Grille: NOT a child of the tilted shell. It hangs from the ear guards and
    // sits in front of the mouth and chin, whatever the shell does.
    const grille = group('grille');
    grille.rotation.x = -0.08; // leans a touch forward at the chin
    g.add(grille);
    const R = radius * 1.12;
    const bar = radius * 0.034;
    const hoops = [-0.26, -0.46, -0.66];
    for (const y of hoops) {
      grille.add(ring(R, bar, Math.PI * 0.8, bars, { y: radius * y, name: `hoop-${y}` }));
    }
    for (const a of [-0.72, -0.24, 0.24, 0.72]) {
      grille.add(strut(onBand(R, a, -radius * 0.14), onBand(R, a, -radius * 0.76), bar, bars, `upright-${a}`));
    }
    // Side arms up from the top hoop's ends to the ear guards.
    for (const side of [-1, 1]) {
      const earAnchor = new THREE.Vector3(side * radius * 1.06, radius * 0.06, radius * 0.02);
      grille.add(strut(onBand(R, side * Math.PI * 0.4, -radius * 0.26), earAnchor, bar, bars, `arm-${side}`));
    }
    return g;
  }

  // ---------------------------------------------------------------------------
  // RED: Gridiron Horns
  // ---------------------------------------------------------------------------

  /**
   * The seventies NFL helmet: contrasting shell with the face cut open from
   * the brow, a single face bar at mouth level, the team stripe over the top,
   * ear holes, and small horns off the stripe.
   */
  function createCombatHorns(radius, colors) {
    const g = group('headwear-wrestler_bands');
    const shell = accentMaterial(colors, { roughness: 0.35, metalness: 0.2 });
    const stripe = primaryMaterial(colors, { roughness: 0.4, metalness: 0.15 });

    const shellR = radius * 1.12;
    // Top cap: full circle down to the brow line.
    const browPhi = Math.PI * 0.36;
    g.add(dome(shellR, browPhi, shell, 'shell-top'));
    // Skirt: from the brow down over the ears and nape, open across the face.
    // Sphere azimuth: phi = 0 is +X... the face (-Z) sits at phi = 1.5π.
    const faceOpening = Math.PI * 0.62;
    const skirtGeo = new THREE.SphereGeometry(
      shellR, 36, 12,
      Math.PI * 1.5 + faceOpening / 2, Math.PI * 2 - faceOpening,
      browPhi, Math.PI * 0.62 - browPhi,
    );
    const skirt = mesh(skirtGeo, shell, 'shell-skirt');
    skirt.material.side = THREE.DoubleSide;
    g.add(skirt);

    // Twin stripes painted on the shell, brow to nape.
    for (const sx of [-1, 1]) {
      g.add(meridianStrip(shellR * 1.004, radius * 0.09, -Math.PI * 0.6, browPhi * 0.98, stripe, `stripe-${sx}`, sx * radius * 0.13));
    }

    // Ear pieces with short bull's horns growing out of them: out, then up and
    // a little forward, rooted in the red disc so nothing floats.
    for (const side of [-1, 1]) {
      const tag = side < 0 ? 'l' : 'r';
      const ear = new THREE.Vector3(side * shellR * 0.995, -radius * 0.05, 0);
      const hole = mesh(new THREE.CylinderGeometry(radius * 0.17, radius * 0.17, radius * 0.06, 20), stripe, `ear-${tag}`);
      hole.rotation.z = Math.PI / 2;
      hole.position.copy(ear);
      g.add(hole);
      const curve = new THREE.QuadraticBezierCurve3(
        ear.clone(),
        ear.clone().add(new THREE.Vector3(side * radius * 0.22, radius * 0.12, -radius * 0.05)),
        ear.clone().add(new THREE.Vector3(side * radius * 0.26, radius * 0.5, -radius * 0.22)),
      );
      g.add(taperedTube(curve, radius * 0.11, radius * 0.025, stripe, `horn-${tag}`, 24));
    }

    // Double-bar face guard: two bars across the mouth and chin, a centre
    // post between them, and arms up to the skirt edges.
    const R = shellR * 1.04;
    const barR = radius * 0.042;
    g.add(ring(R, barR, Math.PI * 0.6, shell, { y: -radius * 0.32, name: 'facebar-upper' }));
    g.add(ring(R, barR, Math.PI * 0.6, shell, { y: -radius * 0.54, name: 'facebar-lower' }));
    g.add(strut(onBand(R, 0, -radius * 0.32), onBand(R, 0, -radius * 0.54), barR, shell, 'facebar-post'));
    for (const side of [-1, 1]) {
      g.add(strut(onBand(R, side * Math.PI * 0.3, -radius * 0.32), onSkull(shellR, side * faceOpening / 2, -radius * 0.1), barR, shell, `facebar-arm-${side}`));
      g.add(strut(onBand(R, side * Math.PI * 0.3, -radius * 0.32), onBand(R, side * Math.PI * 0.3, -radius * 0.54), barR, shell, `facebar-side-${side}`));
    }

    // The league mark on the back, right of the stripes, the way helmet decals sit.
    g.add(setMark(leagueMark(radius * 0.16, colors), shellR, Math.PI - 0.5, radius * 0.3, radius * 0.16));
    return g;
  }

  // ---------------------------------------------------------------------------
  // GREEN: Terrace Montera
  // ---------------------------------------------------------------------------

  /** A highland montera perched on the crown: round top, flat upturned brim, beaded edge. */
  function createTerraceMontera(radius, colors) {
    const g = group('headwear-terrace_visor');
    const wool = primaryMaterial(colors, { roughness: 0.9 });
    const trim = accentMaterial(colors, { roughness: 0.7 });

    const yBase = radius * 0.72;
    const crownR = radius * 0.92;
    const crownH = radius * 0.46;
    const wall = mesh(new THREE.CylinderGeometry(crownR * 0.97, crownR, crownH, 36), wool, 'crown');
    wall.position.y = yBase + crownH / 2;
    g.add(wall);
    const top = dome(crownR * 0.97, Math.PI * 0.5, wool, 'crown-top');
    top.position.y = yBase + crownH;
    top.scale.y = 0.22;
    g.add(top);

    const brimDrop = -radius * 0.14;
    const brimOuter = radius * 1.85;
    const b = brim(radius * 0.86, brimOuter, brimDrop, wool, 'brim');
    b.position.y = yBase + radius * 0.06;
    g.add(b);

    g.add(ring(crownR * 1.01, radius * 0.045, Math.PI * 2, trim, { y: yBase + radius * 0.1, name: 'band', tall: 1.5 }));
    // Beads sit ON the brim's upturned edge: the brim's outer rim is at
    // yBase + 0.06 + |drop| / 2, and the bead rests on it.
    const beadR = radius * 0.05;
    const rimY = yBase + radius * 0.06 + Math.abs(brimDrop) / 2;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const bead = mesh(new THREE.SphereGeometry(beadR, 8, 6), trim, `bead-${i}`);
      bead.position.set(Math.sin(a) * (brimOuter - beadR * 0.6), rimY + beadR * 0.5, -Math.cos(a) * (brimOuter - beadR * 0.6));
      g.add(bead);
    }
    g.add(setMarkOnBand(leagueMark(radius * 0.15, colors), crownR * 0.985, 0, yBase + crownH * 0.52, radius * 0.15));
    return g;
  }

  // ---------------------------------------------------------------------------
  // PURPLE: Silk Road Diadem
  // ---------------------------------------------------------------------------

  /**
   * Back to the first pass's simplicity: a slim metallic band, three slender
   * spires (centre tallest), a jewel at the foot of each.
   */
  function createCoutureDiadem(radius, colors) {
    const g = group('headwear-couture_wrap');
    const metal = primaryMaterial(colors, METAL);
    const jewel = visorMaterial(colors);

    const yBand = radius * 0.44;
    const R = radius * 1.05;
    g.add(ring(R, radius * 0.05, Math.PI * 1.4, metal, { y: yBand, name: 'band', tall: 1.4 }));

    // Rounded petals rather than spikes: soft ellipsoids, like the body's capsules.
    const spires = [{ a: 0, h: 0.62, r: 0.11 }, { a: -0.5, h: 0.4, r: 0.09 }, { a: 0.5, h: 0.4, r: 0.09 }];
    for (const s of spires) {
      const base = onBand(R, s.a, yBand + radius * 0.02);
      const spire = mesh(new THREE.SphereGeometry(radius * s.r, 16, 12), metal, `petal-${s.a}`);
      spire.position.copy(base);
      spire.position.y += radius * s.h * 0.5;
      spire.scale.set(1, s.h / s.r * 0.5, 0.55);
      spire.rotation.set(-0.18 * Math.cos(s.a), 0, -0.18 * Math.sin(s.a));
      g.add(spire);
      const gem = mesh(new THREE.SphereGeometry(radius * s.r * 0.95, 14, 10), jewel, `gem-${s.a}`);
      gem.position.copy(onBand(R * 1.03, s.a, yBand));
      g.add(gem);
    }
    return g;
  }

  // ---------------------------------------------------------------------------
  // TEAL: Wayfinder Cord
  // ---------------------------------------------------------------------------

  /**
   * The second pass's cord, aligned: a team band and a contrasting cord stacked
   * cleanly, a knot with two tails at the back, and the jade toki hanging from
   * the right temple.
   */
  function createWayfinderCord(radius, colors) {
    const g = group('headwear-rigger_band');
    const cloth = primaryMaterial(colors, { roughness: 0.85 });
    const cord = accentMaterial(colors, { roughness: 0.85 });
    const jade = fixedMaterial(JADE_HEX, { roughness: 0.3, metalness: 0.15 });

    const R = radius * 1.04;
    const yBand = radius * 0.3;
    g.add(band(R, radius * 0.16, Math.PI * 2, cloth, { y: yBand, name: 'band' }));
    g.add(ring(R + radius * 0.01, radius * 0.035, Math.PI * 2, cord, { y: yBand + radius * 0.1, name: 'cord-upper' }));
    g.add(ring(R + radius * 0.01, radius * 0.035, Math.PI * 2, cord, { y: yBand - radius * 0.1, name: 'cord-lower' }));

    const k = onBand(R + radius * 0.06, Math.PI, yBand);
    const knot = mesh(new THREE.SphereGeometry(radius * 0.12, 14, 10), cord, 'knot');
    knot.position.copy(k);
    g.add(knot);
    g.add(strut(k, new THREE.Vector3(k.x + radius * 0.14, k.y - radius * 0.5, k.z + radius * 0.1), radius * 0.03, cord, 'tail-a'));
    g.add(strut(k, new THREE.Vector3(k.x - radius * 0.12, k.y - radius * 0.44, k.z + radius * 0.14), radius * 0.03, cord, 'tail-b'));

    const anchor = onBand(R + radius * 0.03, 0.95, yBand - radius * 0.08);
    const hang = anchor.clone();
    hang.y -= radius * 0.3;
    g.add(strut(anchor, hang, radius * 0.022, cord, 'toki-cord'));
    const blade = mesh(new THREE.BoxGeometry(radius * 0.17, radius * 0.4, radius * 0.06), jade, 'toki');
    blade.position.copy(hang);
    blade.position.y -= radius * 0.18;
    blade.rotation.y = 0.95;
    g.add(blade);
    const edge = mesh(new THREE.ConeGeometry(radius * 0.1, radius * 0.14, 4), jade, 'toki-edge');
    edge.position.copy(blade.position);
    edge.position.y -= radius * 0.27;
    edge.rotation.set(Math.PI, 0.95 + Math.PI / 4, 0);
    g.add(edge);
    return g;
  }

  // ---------------------------------------------------------------------------
  // YELLOW: Stadium Headset
  // ---------------------------------------------------------------------------

  /** Broadcast cans with the globe on each cup, a hugging headband, boom and windscreen. */
  function createBroadcasterHeadset(radius, colors) {
    const g = group('headwear-broadcaster_mic');
    const shell = primaryMaterial(colors, { roughness: 0.45, metalness: 0.2 });
    const trim = accentMaterial(colors, { roughness: 0.5, metalness: 0.3 });
    const foam = fixedMaterial(FOAM_HEX, { roughness: 0.95 });
    const lamp = visorMaterial(colors);

    const cupR = radius * 0.46;
    const xCup = radius * 1.14;
    const yCup = -radius * 0.02;
    for (const side of [-1, 1]) {
      const tag = side < 0 ? 'l' : 'r';
      const cup = mesh(new THREE.CylinderGeometry(cupR, cupR, radius * 0.24, 28), shell, `cup-${tag}`);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * xCup, yCup, 0);
      g.add(cup);
      const pad = mesh(new THREE.CylinderGeometry(cupR * 0.85, cupR * 0.85, radius * 0.08, 28), trim, `pad-${tag}`);
      pad.rotation.z = Math.PI / 2;
      pad.position.set(side * (xCup - radius * 0.15), yCup, 0);
      g.add(pad);
      const mark = leagueMark(radius * 0.22, colors, `mark-${tag}`);
      mark.position.set(side * (xCup + radius * 0.125), yCup, 0);
      mark.rotation.y = side * Math.PI / 2;
      g.add(mark);
    }
    const hb = mesh(new THREE.TorusGeometry(xCup, radius * 0.075, 10, 40, Math.PI), trim, 'headband');
    hb.position.y = yCup + cupR * 0.9;
    hb.scale.set(1, 0.68, 1.7);
    g.add(hb);

    const a = new THREE.Vector3(-xCup - radius * 0.05, yCup - radius * 0.34, -radius * 0.12);
    const b = new THREE.Vector3(-radius * 0.72, -radius * 0.58, -radius * 0.8);
    const c = new THREE.Vector3(-radius * 0.25, -radius * 0.62, -radius * 1.1);
    g.add(strut(a, b, radius * 0.04, trim, 'boom-a'));
    g.add(strut(b, c, radius * 0.04, trim, 'boom-b'));
    const windscreen = mesh(new THREE.SphereGeometry(radius * 0.16, 14, 10), foam, 'windscreen');
    windscreen.position.copy(c);
    g.add(windscreen);
    const onAir = mesh(new THREE.SphereGeometry(radius * 0.05, 10, 8), lamp, 'on-air');
    onAir.position.set(-(xCup + radius * 0.12), yCup + radius * 0.3, -radius * 0.2);
    g.add(onAir);

    // A marigold tucked at the hair tie behind the right ear, clear of the band
    // (which runs over the crown) and of the cups.
    const flower = marigold(radius * 0.17);
    flower.position.set(radius * 0.3, radius * 0.5, radius * 0.86);
    flower.rotation.set(0.9, 0.35, -0.5);
    g.add(flower);
    return g;
  }

  // ---------------------------------------------------------------------------
  // ORANGE: Winged Courier Cap
  // ---------------------------------------------------------------------------

  /** A low runner's cap worn backwards, bill flipped up at the back, swept fins, globe on the front. */
  function createCourierCap(radius, colors) {
    const g = group('headwear-cursor_cap');
    const fabric = primaryMaterial(colors, { roughness: 0.5 });
    const wing = accentMaterial(colors, { roughness: 0.45, metalness: 0.25 });

    const crownR = radius * 1.06;
    const phiRim = Math.PI * 0.42;
    const yRim = crownR * Math.cos(phiRim);
    const rRim = crownR * Math.sin(phiRim);

    const cap = group('cap');
    g.add(cap);
    cap.add(dome(crownR, phiRim, fabric, 'crown'));
    // Backwards: the bill points to +Z and is pitched UP, the way a flipped cap sits.
    cap.add(curvedBill(radius, rRim, yRim + radius * 0.02, radius * 0.7, radius * 0.038, fabric, +1, 'rear-bill', -0.32));

    const shape = new THREE.Shape();
    shape.moveTo(0, -radius * 0.14);
    shape.lineTo(0, radius * 0.18);
    shape.lineTo(radius * 0.95, radius * 0.5);
    shape.lineTo(radius * 0.75, radius * 0.08);
    shape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(shape, { depth: radius * 0.035, bevelEnabled: false });
    for (const side of [-1, 1]) {
      const fin = mesh(finGeo, wing, side < 0 ? 'fin-l' : 'fin-r');
      fin.material.side = THREE.DoubleSide;
      fin.position.set(side * radius * 1.0, radius * 0.42, -radius * 0.05);
      fin.rotation.set(0, -Math.PI / 2, 0);
      cap.add(fin);
    }
    cap.add(setMark(leagueMark(radius * 0.19, colors), crownR, Math.PI, yRim + radius * 0.4, radius * 0.19));
    return g;
  }

  // ---------------------------------------------------------------------------
  // PINK: Bleacher Hachimaki
  // ---------------------------------------------------------------------------

  /**
   * A traditional hachimaki: a tenugui tied round the head, wide across the
   * forehead and narrowing to a twist at the back, worn high and canted up at
   * the front so the panel faces forward and up. The league mark sits large on
   * the front panel; the knot's tails stand up and out behind.
   */
  function createOuendanHeadband(radius, colors) {
    const g = group('headwear-ouendan_knot');
    const cloth = primaryMaterial(colors, { roughness: 0.82 });

    const hachi = group('hachimaki');
    hachi.rotation.x = 0.3; // front rises up the forehead
    g.add(hachi);

    const R = radius * 1.03;
    const yBack = radius * 0.22;
    const yFront = radius * 0.34;
    const hBack = radius * 0.1;
    const hFront = radius * 0.5;
    const profile = (a) => {
      const w = Math.pow((1 + Math.cos(a)) / 2, 1.6); // 1 at the face, 0 at the nape
      return { y: yBack + (yFront - yBack) * w, h: hBack + (hFront - hBack) * w };
    };
    hachi.add(shapedBand(R, profile, cloth, 'band'));
    hachi.add(shapedBand(R + radius * 0.02, profile, cloth, 'band-outer'));
    const front = profile(0);
    hachi.add(setMarkOnBand(leagueMark(radius * 0.2, colors), R + radius * 0.02, 0, front.y, radius * 0.2));

    const knot = mesh(new THREE.SphereGeometry(radius * 0.11, 14, 10), cloth, 'knot');
    knot.position.set(0, yBack, R + radius * 0.05);
    knot.scale.set(1.3, 0.7, 0.7);
    hachi.add(knot);
    for (const side of [-1, 1]) {
      const tag = side < 0 ? 'l' : 'r';
      const tail = mesh(new THREE.BoxGeometry(radius * 0.12, radius * 0.02, radius * 0.5), cloth, `tail-${tag}`);
      tail.position.set(side * radius * 0.18, yBack + radius * 0.18, R + radius * 0.2);
      tail.rotation.set(-0.75, side * 0.55, side * 0.2);
      hachi.add(tail);
    }
    return g;
  }

  return {
    createManagerCap, createSensorVisor, createWicketGrill, createCombatHorns, createTerraceMontera,
    createCoutureDiadem, createWayfinderCord, createBroadcasterHeadset, createCourierCap, createOuendanHeadband,
  };
}

const kitCache = new WeakMap();
function kitFor(THREE, markTexture) {
  let byMark = kitCache.get(THREE);
  if (!byMark) { byMark = new Map(); kitCache.set(THREE, byMark); }
  const key = markTexture || null;
  if (!byMark.has(key)) byMark.set(key, makeKit(THREE, markTexture));
  return byMark.get(key);
}

function toColors(palette) {
  return {
    primary: palette.primary,
    accent: palette.accent,
    bodyGrey: palette.secondary ?? 0x383b42,
    jointGrey: palette.neutral ?? 0x22242a,
    roughness: 0.82,
    metalness: 0.04,
  };
}

function finish(group, itemId, palette, options) {
  group.userData.headgearId = itemId;
  group.userData.palette = { ...palette };
  const cast = options.castShadow !== false;
  group.traverse((o) => { if (o.isMesh && o.name !== 'league-mark' && !o.name.startsWith('mark-')) o.castShadow = cast; });
  return group;
}

function make(THREE, palette, options, itemId, fn) {
  const radius = options.radius ?? DEFAULT_HEAD_RADIUS;
  const kit = kitFor(THREE, options.markTexture || null);
  return finish(kit[fn](radius, toColors(palette)), itemId, palette, options);
}

// ---------------------------------------------------------------------------
// PUBLIC BUILDERS: build<ItemName>(THREE, palette, options) -> THREE.Group
// ---------------------------------------------------------------------------

/** WHITE, John Valleyball. Classic cap, curved bill, button, rear strap, league mark above the bill. */
export function buildManagerClassicCap(THREE, palette, options = {}) { return make(THREE, palette, options, 'manager_cap', 'createManagerCap'); }
/** BLACK, Umpire Bot. Slim VISOR band with one glowing scanner slit and the umpire's crest on the brow. */
export function buildSensorVisor(THREE, palette, options = {}) { return make(THREE, palette, options, 'sensor_visor', 'createSensorVisor'); }
/** BLUE, Bhavin. Cricket helmet tilted back off the brow, ear guards with the mark, grille across mouth and chin. */
export function buildWicketkeeperHelmet(THREE, palette, options = {}) { return make(THREE, palette, options, 'wicket_grill', 'createWicketGrill'); }
/** RED, Malik. Seventies football helmet: open face, twin stripes, double-bar guard, bull horns from the ear pieces, mark back-right. */
export function buildGridironHorns(THREE, palette, options = {}) { return make(THREE, palette, options, 'wrestler_bands', 'createCombatHorns'); }
/** GREEN, Tupac. Highland montera perched on the crown: flat upturned brim, beaded edge, band, mark on the crown. */
export function buildTerraceMontera(THREE, palette, options = {}) { return make(THREE, palette, options, 'terrace_visor', 'createTerraceMontera'); }
/** PURPLE, Parisa. Slim metallic band, three rounded petals, three glowing jewels. */
export function buildSilkRoadDiadem(THREE, palette, options = {}) { return make(THREE, palette, options, 'couture_wrap', 'createCoutureDiadem'); }
/** TEAL, Kahu. Wide band with two cords, knot and tails at the back, jade toki at the right temple. */
export function buildWayfinderCord(THREE, palette, options = {}) { return make(THREE, palette, options, 'rigger_band', 'createWayfinderCord'); }
/** YELLOW, Catarina. Broadcast cans with the mark on each cup, hugging headband, boom and windscreen, on-air lamp, marigold. */
export function buildStadiumHeadset(THREE, palette, options = {}) { return make(THREE, palette, options, 'broadcaster_mic', 'createBroadcasterHeadset'); }
/** ORANGE, Vinny. Low runner's cap worn backwards, bill flipped up, swept fins, mark on the back of the crown. */
export function buildWingedCourierCap(THREE, palette, options = {}) { return make(THREE, palette, options, 'cursor_cap', 'createCourierCap'); }
/** PINK, Kimi. Tenugui hachimaki: wide canted front panel with a large mark, thin twist and knot at the back. */
export function buildBleacherHachimaki(THREE, palette, options = {}) { return make(THREE, palette, options, 'ouendan_knot', 'createOuendanHeadband'); }

export const BUILDERS = {
  buildManagerClassicCap, buildSensorVisor, buildWicketkeeperHelmet, buildGridironHorns, buildTerraceMontera,
  buildSilkRoadDiadem, buildWayfinderCord, buildStadiumHeadset, buildWingedCourierCap, buildBleacherHachimaki,
};

/** Builds a roster athlete's signature piece in their own palette (or another kit's). */
export function buildForAthlete(THREE, athleteId, options = {}) {
  const entry = ROSTER[athleteId];
  if (!entry) throw new Error(`[headgear] unknown athlete "${athleteId}"`);
  return BUILDERS[entry.build](THREE, paletteFor(athleteId, options.kit || null), options);
}

/** Re-tints a built piece in place for a new palette (kit change, Locker mix-and-match). */
export function recolorHeadgear(group, palette) {
  const glow = luminance(palette.primary) < 0.12 ? 0xdbe4f0 : palette.primary;
  group.traverse((o) => {
    if (!o.isMesh || !o.material || !o.material.userData) return;
    const m = o.material;
    switch (m.userData.colorRole) {
      case 'primary': m.color.setHex(palette.primary); break;
      case 'accent': m.color.setHex(palette.accent); break;
      case 'bodyGrey': m.color.setHex(palette.secondary ?? 0x383b42); break;
      case 'visor': m.color.setHex(glow); m.emissive.setHex(glow); break;
      default: break; // 'fixed'
    }
  });
  group.userData.palette = { ...palette };
}

/** Frees a built piece's geometry and materials. */
export function disposeHeadgear(group) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
    else o.material?.dispose();
  });
  group.removeFromParent();
}
