/**
 * MODULE HEADER — src/config/cosmetics.js
 *
 * Role: Static schema and zero-allocation lookup helpers for athlete palettes,
 *   canonical roster, headwear catalog, and the Series 1 playtest headwear cycle
 *   (`PALETTES`, `PALETTE_IDS`, `HEADWEAR_CATALOG`, `HEADWEAR_IDS`, `MESH_BUILDER_KEYS`,
 *   `CANONICAL_ROSTER`, `ATHLETE_IDS`, `SERIES_1_PLAYTEST_CYCLE`, `SERIES_1_PLAYTEST_IDS`,
 *   `resolveHeadwearSpec`, `getHeadwearLabel`, `getNextHeadwearId`,
 *   `getCanonHeadwearIdForColorName`).
 * Frame Phase: Boot, menu/lobby configuration, and render-side headwear cycling;
 *   never mutates physics state.
 * Active Architectural Laws:
 *   - LAW 4 (One Source of Truth & Zero Allocations): All exported tables are
 *     frozen at module load; lookup helpers allocate nothing at call time.
 *   - LAW 6 (Determinism): Zero physics imports; cosmetics are pure scene-graph
 *     decorations and cannot affect simulation or capture hashes.
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
    meshBuilderKey: 'manager_cap', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'john',
  }),
  'umpire-ref-cap': Object.freeze({
    id: 'umpire-ref-cap', label: "Umpire's Ref Cap",
    meshBuilderKey: 'sensor_visor', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'umpire',
  }),
  'bhavin-keepers-helmet': Object.freeze({
    id: 'bhavin-keepers-helmet', label: "Keeper's Helmet",
    meshBuilderKey: 'wicket_grill', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'bhavin',
  }),
  'malik-sluggers-headband': Object.freeze({
    id: 'malik-sluggers-headband', label: "Slugger's Headband",
    meshBuilderKey: 'wrestler_bands', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'malik',
  }),
  'tupac-groundsmans-sunhat': Object.freeze({
    id: 'tupac-groundsmans-sunhat', label: "Groundsman's Sun Hat",
    meshBuilderKey: 'terrace_visor', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'tupac',
  }),
  'parisa-costumers-beret': Object.freeze({
    id: 'parisa-costumers-beret', label: "Costumer's Beret",
    meshBuilderKey: 'couture_wrap', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'parisa',
  }),
  'kahu-riggers-goggles': Object.freeze({
    id: 'kahu-riggers-goggles', label: "Rigger's Goggles",
    meshBuilderKey: 'rigger_band', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'kahu',
  }),
  'catarina-broadcast-headset': Object.freeze({
    id: 'catarina-broadcast-headset', label: 'Broadcast Headset',
    meshBuilderKey: 'broadcaster_mic', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'catarina',
  }),
  'vinny-scouts-bucket-hat': Object.freeze({
    id: 'vinny-scouts-bucket-hat', label: "Scout's Bucket Hat",
    meshBuilderKey: 'cursor_cap', socketTarget: 'headwearSlot',
    paletteTintable: true, tier: 'signature', ownerAthleteId: 'vinny',
  }),
  'kimi-fans-beanie': Object.freeze({
    id: 'kimi-fans-beanie', label: "Fan's Beanie",
    meshBuilderKey: 'ouendan_knot', socketTarget: 'headwearSlot',
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
 * THE SERIES 1 PLAYTEST CYCLE (in-match headwear selector).
 *
 * The approved Locker Headgear Pack (pass 7, 2026-10-17): the ten canonical
 * athlete signature pieces authored in `src/sim/valleyballHeadgear.js`, in
 * roster order, plus `none` (bare head). The generic placeholder rack
 * (cap_forward, cap_backward, beanie, visor, headband, goggles, bucket_hat)
 * is retired from the live selector; the catalog silhouettes remain for the
 * locker data below. Each entry's `builderKey` is the headgear-pack key that
 * `cosmeticsBuilders.js` resolves through its pack registry, and
 * `counterpartCatalogId` keeps locker traceability to the catalog silhouette
 * each athlete's signature piece supersedes. Frozen so the trial order can
 * never drift from the data.
 */
export const SERIES_1_PLAYTEST_CYCLE = Object.freeze([
  Object.freeze({ id: 'manager_cap', label: 'MANAGER CLASSIC CAP', builderKey: 'manager_cap', billBackward: false, counterpartCatalogId: 'john-captains-visor' }),
  Object.freeze({ id: 'sensor_visor', label: 'SENSOR VISOR', builderKey: 'sensor_visor', billBackward: false, counterpartCatalogId: 'umpire-ref-cap' }),
  Object.freeze({ id: 'wicket_grill', label: 'WICKETKEEPER HELMET', builderKey: 'wicket_grill', billBackward: false, counterpartCatalogId: 'bhavin-keepers-helmet' }),
  Object.freeze({ id: 'wrestler_bands', label: 'GRIDIRON HORNS', builderKey: 'wrestler_bands', billBackward: false, counterpartCatalogId: 'malik-sluggers-headband' }),
  Object.freeze({ id: 'terrace_visor', label: 'TERRACE MONTERA', builderKey: 'terrace_visor', billBackward: false, counterpartCatalogId: 'tupac-groundsmans-sunhat' }),
  Object.freeze({ id: 'couture_wrap', label: 'SILK ROAD DIADEM', builderKey: 'couture_wrap', billBackward: false, counterpartCatalogId: 'parisa-costumers-beret' }),
  Object.freeze({ id: 'rigger_band', label: 'WAYFINDER CORD', builderKey: 'rigger_band', billBackward: false, counterpartCatalogId: 'kahu-riggers-goggles' }),
  Object.freeze({ id: 'broadcaster_mic', label: 'STADIUM HEADSET', builderKey: 'broadcaster_mic', billBackward: false, counterpartCatalogId: 'catarina-broadcast-headset' }),
  Object.freeze({ id: 'cursor_cap', label: 'WINGED COURIER CAP', builderKey: 'cursor_cap', billBackward: false, counterpartCatalogId: 'vinny-scouts-bucket-hat' }),
  Object.freeze({ id: 'ouendan_knot', label: 'BLEACHER HACHIMAKI', builderKey: 'ouendan_knot', billBackward: false, counterpartCatalogId: 'kimi-fans-beanie' }),
  Object.freeze({ id: 'none', label: 'NONE', builderKey: null, billBackward: false, counterpartCatalogId: null }),
]);

/** The playtest cycle ids in trial order. Frozen, zero allocation. */
export const SERIES_1_PLAYTEST_IDS = Object.freeze(SERIES_1_PLAYTEST_CYCLE.map((entry) => entry.id));

const PLAYTEST_SPEC_BY_ID = new Map(SERIES_1_PLAYTEST_CYCLE.map((entry) => [entry.id, entry]));

/**
 * Resolve a headwear reference to the build spec the builders module consumes.
 * Accepts a playtest id (`manager_cap`, `wicket_grill`, ...), a catalog id
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
 * Next playtest id, wrapping around the eleven-state cycle. Zero allocation.
 * @param {string} currentId
 * @returns {string}
 */
export function getNextHeadwearId(currentId) {
  const index = SERIES_1_PLAYTEST_IDS.indexOf(currentId);
  return SERIES_1_PLAYTEST_IDS[(index + 1) % SERIES_1_PLAYTEST_IDS.length];
}

const PLAYTEST_ID_BY_CATALOG_ID = Object.freeze(
  new Map(
    SERIES_1_PLAYTEST_CYCLE
      .filter((entry) => entry.counterpartCatalogId)
      .map((entry) => [entry.counterpartCatalogId, entry.id])
  )
);

const CANON_PLAYTEST_BY_COLORKEY = Object.freeze(
  new Map(
    Object.values(CANONICAL_ROSTER)
      .filter((athlete) => athlete.colorKey && PLAYTEST_ID_BY_CATALOG_ID.has(athlete.signatureHeadwearId))
      .map((athlete) => [
        String(athlete.colorKey).toLowerCase(),
        PLAYTEST_ID_BY_CATALOG_ID.get(athlete.signatureHeadwearId),
      ])
  )
);

/**
 * Return the playtest headwear ID associated with a canon team color name, or null.
 * Zero allocation at call time.
 * @param {string} colorName
 * @returns {string|null}
 */
export function getCanonHeadwearIdForColorName(colorName) {
  return CANON_PLAYTEST_BY_COLORKEY.get(String(colorName || '').toLowerCase()) || null;
}
