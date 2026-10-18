/**
 * COSMETICS SCHEMA (Operation "Suit Up & Step Out", Phases 1 & 2).
 *
 * This is the single source of truth for athlete palettes, headwear, and the
 * canonical roster. It is PURE STATIC DATA plus read-only accessors. It deliberately
 * has ZERO physics imports: no Rapier rigid bodies, no colliders, no solver seams.
 * Cosmetics are scene-graph decorations. A cosmetic can never move the ball, cost a
 * tick, or change a capture hash.
 *
 * LAW 4 / LAW 6 apply: everything lives in this one file, nothing is rebuilt or
 * mutated at runtime, and all exported collections are frozen at module load so
 * nothing downstream can accidentally write into them. Callers must not allocate
 * inside the fixed 60 Hz loop; the lookup helpers below return pre-frozen objects,
 * so asking them for a palette or an athlete's cosmetics costs no heap action.
 *
 * CROSS-MODULE CONTRACT (`src/sim/cosmeticsBuilders.js`, owned by Purple):
 * `HEADWEAR_CATALOG` items carry a `meshBuilderKey`. The builders module MUST expose
 * one builder function per distinct key, keyed by that exact string, returning a
 * Three.js Object3D group. The builder receives `{ palette, tint }` and attaches
 * nothing itself — mounting is the ragdoll's `headwearSlot` job. `socketTarget` is the
 * name of that slot (`'headwearSlot'`). Adding a builder key here without shipping the
 * matching builder (or vice versa) is a broken contract; keep them in lockstep.
 */

/**
 * THE TEN ATHLETE PALETTES.
 *
 * `hex` is the canonical accent color, exactly as the brand names them (the ten
 * "accent colors" in the design system). `value` is the same color as a 0xRRGGBB
 * integer, authored once rather than parsed at runtime, so Three.js materials can
 * take it directly without string parsing on the beat path. `accent` / `accentValue`
 * are a second, authored companion tone for jersey trim and headwear tinting.
 *
 * Keys (`colorKey`) are lower-case and match the brand's accent names. Palette ids
 * match the athlete slug that owns them (see CANONICAL_ROSTER).
 */
export const PALETTES = Object.freeze({
  white: Object.freeze({
    id: 'white', colorKey: 'white', name: 'White',
    hex: '#F8FAFC', value: 0xF8FAFC,
    accent: '#94A3B8', accentValue: 0x94A3B8,
  }),
  black: Object.freeze({
    id: 'black', colorKey: 'black', name: 'Black',
    hex: '#0F172A', value: 0x0F172A,
    accent: '#38BDF8', accentValue: 0x38BDF8,
  }),
  blue: Object.freeze({
    id: 'blue', colorKey: 'blue', name: 'Blue',
    hex: '#1D4ED8', value: 0x1D4ED8,
    accent: '#60A5FA', accentValue: 0x60A5FA,
  }),
  red: Object.freeze({
    id: 'red', colorKey: 'red', name: 'Red',
    hex: '#D90429', value: 0xD90429,
    accent: '#FCA5A5', accentValue: 0xFCA5A5,
  }),
  green: Object.freeze({
    id: 'green', colorKey: 'green', name: 'Green',
    hex: '#15803D', value: 0x15803D,
    accent: '#86EFAC', accentValue: 0x86EFAC,
  }),
  purple: Object.freeze({
    id: 'purple', colorKey: 'purple', name: 'Purple',
    hex: '#8B5CF6', value: 0x8B5CF6,
    accent: '#C4B5FD', accentValue: 0xC4B5FD,
  }),
  teal: Object.freeze({
    id: 'teal', colorKey: 'teal', name: 'Teal',
    hex: '#06B6D4', value: 0x06B6D4,
    accent: '#67E8F9', accentValue: 0x67E8F9,
  }),
  yellow: Object.freeze({
    id: 'yellow', colorKey: 'yellow', name: 'Yellow',
    hex: '#FFD60A', value: 0xFFD60A,
    accent: '#92400E', accentValue: 0x92400E,
  }),
  orange: Object.freeze({
    id: 'orange', colorKey: 'orange', name: 'Orange',
    hex: '#EA580C', value: 0xEA580C,
    accent: '#FDBA74', accentValue: 0xFDBA74,
  }),
  pink: Object.freeze({
    id: 'pink', colorKey: 'pink', name: 'Pink',
    hex: '#EC4899', value: 0xEC4899,
    accent: '#F9A8D4', accentValue: 0xF9A8D4,
  }),
});

export const PALETTE_IDS = Object.freeze(Object.keys(PALETTES));

/**
 * THE HEADWEAR CATALOG.
 *
 * Two tiers:
 *  - `signature`: one per athlete, the piece that IS that athlete. `ownerAthleteId`
 *    ties it to its roster entry and, by rule, only that athlete may equip it.
 *  - `standard`: the common rack, equippable by anyone, `ownerAthleteId` null.
 *
 * Item fields:
 *  - `id`            unique slug, referenced by CANONICAL_ROSTER and selections.
 *  - `label`         human-readable display name (UI / announcements).
 *  - `meshBuilderKey` the builder key cosmeticsBuilders.js must expose.
 *  - `socketTarget`  the mount socket name on the ragdoll (`'headwearSlot'`).
 *  - `paletteTintable` whether the builder accepts palette tinting.
 *  - `tier`          'signature' | 'standard'.
 *  - `ownerAthleteId` slug of the owning athlete, or null for standard.
 */
export const HEADWEAR_CATALOG = Object.freeze({
  // ── SIGNATURE PIECES (one per athlete) ─────────────────────────────────────
  'john-captains-visor': Object.freeze({
    id: 'john-captains-visor', label: "Captain's Cap",
    meshBuilderKey: 'cap', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'john',
  }),
  'umpire-ref-cap': Object.freeze({
    id: 'umpire-ref-cap', label: "Umpire's Ref Cap",
    meshBuilderKey: 'cap', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'umpire',
  }),
  'bhavin-keepers-helmet': Object.freeze({
    id: 'bhavin-keepers-helmet', label: "Keeper's Helmet",
    meshBuilderKey: 'helmet', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'bhavin',
  }),
  'malik-sluggers-headband': Object.freeze({
    id: 'malik-sluggers-headband', label: "Slugger's Headband",
    meshBuilderKey: 'headband', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'malik',
  }),
  'tupac-groundsmans-sunhat': Object.freeze({
    id: 'tupac-groundsmans-sunhat', label: "Groundsman's Sun Hat",
    meshBuilderKey: 'sunhat', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'tupac',
  }),
  'parisa-costumers-beret': Object.freeze({
    id: 'parisa-costumers-beret', label: "Costumer's Beret",
    meshBuilderKey: 'beret', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'parisa',
  }),
  'kahu-riggers-goggles': Object.freeze({
    id: 'kahu-riggers-goggles', label: "Rigger's Goggles",
    meshBuilderKey: 'goggles', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'kahu',
  }),
  'catarina-broadcast-headset': Object.freeze({
    id: 'catarina-broadcast-headset', label: 'Broadcast Headset',
    meshBuilderKey: 'headset', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'catarina',
  }),
  'vinny-scouts-bucket-hat': Object.freeze({
    id: 'vinny-scouts-bucket-hat', label: "Scout's Bucket Hat",
    meshBuilderKey: 'buckethat', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'vinny',
  }),
  'kimi-fans-beanie': Object.freeze({
    id: 'kimi-fans-beanie', label: "Fan's Beanie",
    meshBuilderKey: 'beanie', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'kimi',
  }),

  // ── STANDARD PIECES (common rack) ─────────────────────────────────────────
  'std-cap': Object.freeze({
    id: 'std-cap', label: 'Plain Cap',
    meshBuilderKey: 'cap', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'standard', ownerAthleteId: null,
  }),
  'std-headband': Object.freeze({
    id: 'std-headband', label: 'Sweat Headband',
    meshBuilderKey: 'headband', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'standard', ownerAthleteId: null,
  }),
  'std-visor': Object.freeze({
    id: 'std-visor', label: 'Training Visor',
    meshBuilderKey: 'visor', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'standard', ownerAthleteId: null,
  }),
  'std-goggles': Object.freeze({
    id: 'std-goggles', label: 'Court Goggles',
    meshBuilderKey: 'goggles', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'standard', ownerAthleteId: null,
  }),
  'std-beanie': Object.freeze({
    id: 'std-beanie', label: 'Club Beanie',
    meshBuilderKey: 'beanie', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'standard', ownerAthleteId: null,
  }),
  'std-bandana': Object.freeze({
    id: 'std-bandana', label: 'Club Bandana',
    meshBuilderKey: 'bandana', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'standard', ownerAthleteId: null,
  }),
});

export const HEADWEAR_IDS = Object.freeze(Object.keys(HEADWEAR_CATALOG));

/**
 * The complete, closed set of mesh builder keys Purple's cosmeticsBuilders.js
 * must implement. Derived from the catalog so the two cannot drift: if a new
 * builder key is added to the catalog and no builder ships, this list flags it.
 */
export const MESH_BUILDER_KEYS = Object.freeze(
  [...new Set(HEADWEAR_IDS.map((id) => HEADWEAR_CATALOG[id].meshBuilderKey))],
);

/**
 * THE SERIES 1 LOCKER RACK.
 *
 * Every catalog id an athlete may cycle through in the eventual locker: the
 * standard common rack first, then the signature silhouettes, then `none`.
 * Frozen so the locker order cannot drift from the catalog. This is distinct
 * from SERIES_1_PLAYTEST_CYCLE below, which is the eight-choice in-match
 * selector and is keyed by the playtest vocabulary, not catalog ids.
 */
export const SERIES_1_HEADWEAR_IDS = Object.freeze([
  ...HEADWEAR_IDS.filter((id) => HEADWEAR_CATALOG[id].tier === 'standard'),
  ...HEADWEAR_IDS.filter((id) => HEADWEAR_CATALOG[id].tier === 'signature'),
  'none',
]);

/**
 * THE CANONICAL ROSTER.
 *
 * One entry per athlete. The athlete slug (`id`) is the join key used everywhere:
 * it indexes PALETTES by `paletteId` and HEADWEAR_CATALOG by `signatureHeadwearId`.
 *
 * `jerseyNumber` and `jerseyName` are the kit markings; `role` is the one-line
 * position description. These are cosmetic/identity fields, not physics: nothing
 * here is read inside the simulation loop.
 */
export const CANONICAL_ROSTER = Object.freeze({
  john: Object.freeze({
    id: 'john', colorKey: 'white', name: 'John Valleyball',
    paletteId: 'white', signatureHeadwearId: 'john-captains-visor',
    jerseyNumber: 1, jerseyName: 'VALLEYBALL',
    role: 'Captain and orchestrator',
  }),
  umpire: Object.freeze({
    id: 'umpire', colorKey: 'black', name: 'Umpire Bot',
    paletteId: 'black', signatureHeadwearId: 'umpire-ref-cap',
    jerseyNumber: 0, jerseyName: 'UMPIRE',
    role: 'QA and gatekeeper',
  }),
  bhavin: Object.freeze({
    id: 'bhavin', colorKey: 'blue', name: 'Bhavin Bhasin',
    paletteId: 'blue', signatureHeadwearId: 'bhavin-keepers-helmet',
    jerseyNumber: 3, jerseyName: 'BHASIN',
    role: 'Core simulation and architecture',
  }),
  malik: Object.freeze({
    id: 'malik', colorKey: 'red', name: 'Malik Modou',
    paletteId: 'red', signatureHeadwearId: 'malik-sluggers-headband',
    jerseyNumber: 10, jerseyName: 'MODOU',
    role: 'Gameplay and feel',
  }),
  tupac: Object.freeze({
    id: 'tupac', colorKey: 'green', name: 'Tupac Quispe',
    paletteId: 'green', signatureHeadwearId: 'tupac-groundsmans-sunhat',
    jerseyNumber: 5, jerseyName: 'QUISPE',
    role: 'Arenas and terrain',
  }),
  parisa: Object.freeze({
    id: 'parisa', colorKey: 'purple', name: 'Parisa Shirin',
    paletteId: 'purple', signatureHeadwearId: 'parisa-costumers-beret',
    jerseyNumber: 8, jerseyName: 'SHIRIN',
    role: 'Art, animation and brand',
  }),
  kahu: Object.freeze({
    id: 'kahu', colorKey: 'teal', name: 'Kahu Manaaki',
    paletteId: 'teal', signatureHeadwearId: 'kahu-riggers-goggles',
    jerseyNumber: 6, jerseyName: 'MANAAKI',
    role: 'Builds, tools and releases',
  }),
  catarina: Object.freeze({
    id: 'catarina', colorKey: 'yellow', name: 'Catarina Sol',
    paletteId: 'yellow', signatureHeadwearId: 'catarina-broadcast-headset',
    jerseyNumber: 7, jerseyName: 'SOL',
    role: 'Copy and community voice',
  }),
  vinny: Object.freeze({
    id: 'vinny', colorKey: 'orange', name: 'Vinny Valerius',
    paletteId: 'orange', signatureHeadwearId: 'vinny-scouts-bucket-hat',
    jerseyNumber: 9, jerseyName: 'VALERIUS',
    role: 'Research and business',
  }),
  kimi: Object.freeze({
    id: 'kimi', colorKey: 'pink', name: 'Kimi Kizuna',
    paletteId: 'pink', signatureHeadwearId: 'kimi-fans-beanie',
    jerseyNumber: 2, jerseyName: 'KIZUNA',
    role: 'UX and playtesting',
  }),
});

export const ATHLETE_IDS = Object.freeze(Object.keys(CANONICAL_ROSTER));

/**
 * PRE-RESOLVED ATHLETE COSMETICS.
 *
 * `getAthleteCosmetics` is called at selection / lobby time, but it must also be
 * safe to call from any code path that might touch the beat loop, so the resolved
 * composite is built once here and frozen. Asking for an athlete's cosmetics is a
 * plain map read, never a fresh object.
 */
const _resolved = new Map();
for (const id of ATHLETE_IDS) {
  const entry = CANONICAL_ROSTER[id];
  _resolved.set(id, Object.freeze({
    athlete: entry,
    palette: PALETTES[entry.paletteId],
    signatureHeadwear: HEADWEAR_CATALOG[entry.signatureHeadwearId],
  }));
}
const RESOLVED_COSMETICS = _resolved;

/**
 * Resolve an athlete's full cosmetic identity: roster entry, palette, and the
 * signature headwear item that belongs to them. Returns a frozen composite, or
 * null if the id is unknown. Zero allocation.
 *
 * @param {string} athleteId an ATHLETE_IDS slug
 * @returns {{athlete: object, palette: object, signatureHeadwear: object} | null}
 */
export function getAthleteCosmetics(athleteId) {
  return RESOLVED_COSMETICS.get(athleteId) || null;
}

/**
 * Resolve a palette by its `id` or `colorKey`. Zero allocation.
 * @param {string} key palette id or colorKey
 * @returns {object | null}
 */
export function getPalette(key) {
  if (!key) return null;
  return PALETTES[key] || PALETTES[String(key).toLowerCase()] || null;
}

/**
 * Resolve a headwear item by id. Zero allocation.
 * @param {string} headwearId a HEADWEAR_IDS slug
 * @returns {object | null}
 */
export function getHeadwear(headwearId) {
  return HEADWEAR_CATALOG[headwearId] || null;
}

/**
 * Headwear an athlete is allowed to equip: their own signature piece plus every
 * standard item. Signature pieces are NOT transferable. Frozen, zero allocation.
 * @param {string} athleteId an ATHLETE_IDS slug
 * @returns {string[]} headwear ids, the owner's signature first
 */
export function listHeadwearForAthlete(athleteId) {
  const entry = CANONICAL_ROSTER[athleteId];
  if (!entry) return Object.freeze([]);
  const out = [entry.signatureHeadwearId];
  for (const id of HEADWEAR_IDS) {
    if (HEADWEAR_CATALOG[id].tier === 'standard') out.push(id);
  }
  return Object.freeze(out);
}

/**
 * Validate a cosmetic selection. A selection is `{ athleteId, headwearId, paletteId? }`.
 *
 * Rules enforced:
 *  1. athleteId must be a known roster slug.
 *  2. headwearId must be a known catalog id.
 *  3. a signature piece may only be worn by its owner; standard pieces are open.
 *  4. an optional paletteId, when present, must be a known palette.
 *
 * Returns `{ valid, errors: string[] }`. It never throws; it reports.
 * @param {{athleteId?: string, headwearId?: string, paletteId?: string}} selection
 * @returns {{valid: boolean, errors: string[]}}
 */
/**
 * THE SERIES 1 PLAYTEST CYCLE (in-match headwear selector).
 *
 * The exact eight visual choices Jac trials against, in order. These ids are
 * the playtest vocabulary and are authoritative; they are deliberately NOT
 * catalog ids, because cap_forward / cap_backward are the same catalog
 * silhouette with the bill flipped, and bucket_hat reuses the bucket silhouette
 * that the catalog ships only as Vinny's signature piece. Each entry therefore
 * carries the builder key and bill orientation it renders, plus the catalog id
 * whose silhouette it reuses, for locker traceability. Frozen so the trial
 * order can never drift from the data.
 */
export const SERIES_1_PLAYTEST_CYCLE = Object.freeze([
  Object.freeze({ id: 'cap_forward', label: 'CAP FORWARD', builderKey: 'cap', billBackward: false, counterpartCatalogId: 'std-cap' }),
  Object.freeze({ id: 'cap_backward', label: 'CAP BACKWARD', builderKey: 'cap', billBackward: true, counterpartCatalogId: 'std-cap' }),
  Object.freeze({ id: 'beanie', label: 'BEANIE', builderKey: 'beanie', billBackward: false, counterpartCatalogId: 'std-beanie' }),
  Object.freeze({ id: 'visor', label: 'VISOR', builderKey: 'visor', billBackward: false, counterpartCatalogId: 'std-visor' }),
  Object.freeze({ id: 'headband', label: 'HEADBAND', builderKey: 'headband', billBackward: false, counterpartCatalogId: 'std-headband' }),
  Object.freeze({ id: 'goggles', label: 'GOGGLES', builderKey: 'goggles', billBackward: false, counterpartCatalogId: 'std-goggles' }),
  Object.freeze({ id: 'bucket_hat', label: 'BUCKET HAT', builderKey: 'buckethat', billBackward: false, counterpartCatalogId: 'vinny-scouts-bucket-hat' }),
  Object.freeze({ id: 'none', label: 'NONE', builderKey: null, billBackward: false, counterpartCatalogId: null }),
]);

/** The playtest cycle ids in trial order. Frozen, zero allocation. */
export const SERIES_1_PLAYTEST_IDS = Object.freeze(SERIES_1_PLAYTEST_CYCLE.map((entry) => entry.id));

const PLAYTEST_SPEC_BY_ID = new Map(SERIES_1_PLAYTEST_CYCLE.map((entry) => [entry.id, entry]));

/**
 * Resolve a headwear reference to the build spec the builders module consumes.
 * Accepts a playtest id (`cap_forward`, `beanie`, ...), a catalog id
 * (`std-cap`, ...), a raw builder key (`cap`, `helmet`, ...), or `none`.
 * Returns `{ builderKey, billBackward }`, or null for `none` / an unknown id.
 * This is the single reconciliation point between the playtest vocabulary and
 * the catalog; the ragdoll mounts whatever this returns.
 */
export function resolveHeadwearSpec(headwearId) {
  if (!headwearId || headwearId === 'none') return null;
  const playtest = PLAYTEST_SPEC_BY_ID.get(headwearId);
  if (playtest) return { builderKey: playtest.builderKey, billBackward: playtest.billBackward };
  if (HEADWEAR_CATALOG[headwearId]) {
    return { builderKey: HEADWEAR_CATALOG[headwearId].meshBuilderKey, billBackward: false };
  }
  if (MESH_BUILDER_KEYS.includes(headwearId)) {
    return { builderKey: headwearId, billBackward: false };
  }
  return null;
}

/**
 * Human-readable label for a playtest id, catalog id, builder key, or `none`.
 * Zero allocation.
 * @param {string} headwearId
 * @returns {string}
 */
export function getHeadwearLabel(headwearId) {
  const playtest = PLAYTEST_SPEC_BY_ID.get(headwearId);
  if (playtest) return playtest.label;
  if (HEADWEAR_CATALOG[headwearId]) return HEADWEAR_CATALOG[headwearId].label;
  return String(headwearId || 'none').toUpperCase();
}

/**
 * Next playtest id, wrapping around the eight-choice cycle. Zero allocation.
 * @param {string} currentId
 * @returns {string}
 */
export function getNextHeadwearId(currentId) {
  const index = SERIES_1_PLAYTEST_IDS.indexOf(currentId);
  return SERIES_1_PLAYTEST_IDS[(index + 1) % SERIES_1_PLAYTEST_IDS.length];
}

export function validateCosmeticSelection(selection = {}) {
  const errors = [];
  const athleteId = selection && selection.athleteId;
  const headwearId = selection && selection.headwearId;
  const paletteId = selection && selection.paletteId;

  const roster = CANONICAL_ROSTER[athleteId];
  if (!roster) {
    errors.push(`Unknown athleteId: ${athleteId}`);
  }

  const headwear = HEADWEAR_CATALOG[headwearId];
  if (!headwear) {
    errors.push(`Unknown headwearId: ${headwearId}`);
  } else if (roster) {
    if (headwear.tier === 'signature' && headwear.ownerAthleteId !== athleteId) {
      errors.push(
        `Signature piece "${headwear.label}" belongs to ${headwear.ownerAthleteId}, not ${athleteId}`,
      );
    }
  }

  if (paletteId !== undefined && paletteId !== null && !PALETTES[paletteId]) {
    errors.push(`Unknown paletteId: ${paletteId}`);
  }

  return { valid: errors.length === 0, errors };
}