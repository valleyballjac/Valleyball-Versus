/**
 * THE VALLEYBALL LOCKER REGISTRY
 * Canonical color palettes, headwear catalog, and athlete presets.
 *
 * Pure data. No Rapier, no three.js, no wall-clock APIs: this file is safe to
 * import from src/sim/, from the menus, and from offline scripts alike.
 *
 * Headwear `build` names resolve to exported functions in
 * src/sim/cosmeticsBuilders.js. `null` means the slot stays empty.
 */

export const PALETTES = {
  white:   { hex: 0xF8FAFC, name: 'White',   role: 'captain' },
  black:   { hex: 0x0F172A, name: 'Black',   role: 'umpire' },
  blue:    { hex: 0x1D4ED8, name: 'Blue',    role: 'catcher' },
  red:     { hex: 0xD90429, name: 'Red',     role: 'slugger' },
  green:   { hex: 0x15803D, name: 'Green',   role: 'groundskeeper' },
  purple:  { hex: 0x8B5CF6, name: 'Purple',  role: 'costumer' },
  teal:    { hex: 0x06B6D4, name: 'Teal',    role: 'rigger' },
  yellow:  { hex: 0xFFD60A, name: 'Yellow',  role: 'announcer' },
  orange:  { hex: 0xEA580C, name: 'Orange',  role: 'scout' },
  pink:    { hex: 0xEC4899, name: 'Pink',    role: 'fan' },
};

export const HEADWEAR_CATALOG = {
  none:            { id: 'none',            name: 'Bare Dome',          tier: 'free',    slot: 'headwear', build: null },
  manager_cap:     { id: 'manager_cap',     name: 'Manager Flat-Brim',   tier: 'free',    slot: 'headwear', build: 'createManagerCap' },
  sensor_visor:    { id: 'sensor_visor',    name: 'Sensor Visor',       tier: 'premium', slot: 'headwear', build: 'createSensorVisor' },
  wicket_grill:    { id: 'wicket_grill',    name: 'Wicketkeeper Grill', tier: 'premium', slot: 'headwear', build: 'createWicketGrill' },
  wrestler_bands:  { id: 'wrestler_bands',  name: 'Combat Horns',       tier: 'premium', slot: 'headwear', build: 'createCombatHorns' },
  terrace_visor:   { id: 'terrace_visor',   name: 'Terrace Sun Visor',  tier: 'premium', slot: 'headwear', build: 'createTerraceVisor' },
  couture_wrap:    { id: 'couture_wrap',    name: 'Silk Road Diadem',   tier: 'premium', slot: 'headwear', build: 'createCoutureDiadem' },
  rigger_band:     { id: 'rigger_band',     name: 'Wayfinder Cord',     tier: 'premium', slot: 'headwear', build: 'createWayfinderCord' },
  broadcaster_mic: { id: 'broadcaster_mic', name: 'Stadium Headset',    tier: 'premium', slot: 'headwear', build: 'createBroadcasterHeadset' },
  cursor_cap:      { id: 'cursor_cap',      name: 'Winged Courier Cap', tier: 'premium', slot: 'headwear', build: 'createCourierCap' },
  ouendan_knot:    { id: 'ouendan_knot',    name: 'Bleacher Hachimaki', tier: 'premium', slot: 'headwear', build: 'createOuendanHeadband' },
};

export const CANONICAL_ROSTER = {
  white:  { id: 'white',  name: 'John Valleyball',             palette: 'white',  headwear: 'manager_cap',     variant: 'masculine' },
  black:  { id: 'black',  name: 'Umpire Bot',                  palette: 'black',  headwear: 'sensor_visor',    variant: 'masculine' },
  blue:   { id: 'blue',   name: 'Bhavin "The Anchor" Bhasin',  palette: 'blue',   headwear: 'wicket_grill',    variant: 'masculine' },
  red:    { id: 'red',    name: 'Malik "Striker" Modou',       palette: 'red',    headwear: 'wrestler_bands',  variant: 'masculine' },
  green:  { id: 'green',  name: 'Tupac "The Terrace" Quispe',  palette: 'green',  headwear: 'terrace_visor',   variant: 'masculine' },
  purple: { id: 'purple', name: 'Parisa "The Palette" Shirin', palette: 'purple', headwear: 'couture_wrap',    variant: 'feminine'  },
  teal:   { id: 'teal',   name: 'Kahu "The Toki" Manaaki',     palette: 'teal',   headwear: 'rigger_band',     variant: 'masculine' },
  yellow: { id: 'yellow', name: 'Doña Catarina Sol',           palette: 'yellow', headwear: 'broadcaster_mic', variant: 'feminine'  },
  orange: { id: 'orange', name: 'Vinny Valerius',              palette: 'orange', headwear: 'cursor_cap',      variant: 'masculine' },
  pink:   { id: 'pink',   name: 'Kimi "Hana" Kizuna',          palette: 'pink',   headwear: 'ouendan_knot',    variant: 'feminine'  },
};

/**
 * Stable iteration order for the roster (object key order is insertion order
 * in practice, but the photo booth and menus should not have to rely on it).
 */
export const ROSTER_ORDER = Object.freeze(Object.keys(CANONICAL_ROSTER));
