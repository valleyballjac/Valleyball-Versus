# Valleyball: Locker System & Photo Booth Implementation Plan
**Document Path:** `docs/EXECUTION_PROMPT_LOCKER_AND_PHOTOBOOTH.md`  
**Repository:** `C:\Users\portt\Dev\Valleyball\Valleyball-Versus-AI`  
**Target Branch:** `feature/locker-and-photobooth`  
**Stack:** Three.js, Rapier Physics, Vite Dev Server, Vanilla ES Modules

---

## 1. Project Context & Pre-Flight Checks
Valleyball Versus is a fast-paced, physics-driven digital sport played on sloped courts. The athlete model is an articulated geometric mannequin built in Three.js (`src/sim/ragdoll.js`) driven by a 65-joint Mixamo skeleton and Rapier physics. The project already has an active capture endpoint configured in `vite-plugin-capture.js` listening for base64 PNGs.

### The 3 Anti-Hallucination Guardrails (Read Carefully):
1. **Never Touch Rapier Physics:** Cosmetics are strictly visual scene-graph decorations (`THREE.Group`, `THREE.Mesh`). They are attached to bones or existing `solidMesh` groups. They must **NEVER** register Rapier colliders, rigid bodies, or physics mass.
2. **Never Render WebGL in Naked Node.js:** Node.js has no DOM or WebGL canvas. All rendering must occur inside the browser context via the Vite development server (`http://localhost:5174/?mode=photobooth`).
3. **Continuous Compiler Verification:** After every stage, execute `npm run build`. Never proceed to the next stage if the build produces compiler or bundle errors.

---

## 2. Stage-by-Stage Implementation

### Stage 1: The Data Contracts (`src/config/cosmetics.js`)
Create `src/config/cosmetics.js` as a pure data registry. It must contain zero imports from Rapier or wall-clock APIs.

```javascript
/**
 * THE VALLEYBALL LOCKER REGISTRY
 * Canonical color palettes, headwear catalog, and athlete presets.
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
```

---

### Stage 2: Procedural Headwear Builders & Ragdoll Integration

#### 1. Create `src/sim/cosmeticsBuilders.js`
Define lightweight Three.js procedural geometry generators for each headwear item using primitives (`SphereGeometry`, `CylinderGeometry`, `TorusGeometry`, `BoxGeometry`). 

All materials must attach `userData.colorRole` so `updateAthletePalette` can recolor them automatically:
* `userData.colorRole = 'primary'` (for team-colored fabric/metal)
* `userData.colorRole = 'visor'` (for glowing elements, emissive intensity 1.5)
* `userData.colorRole = 'joint'` or `'bodyGrey'` (for neutral fixtures)

Key builder specifications:
* **`createManagerCap(radius, colors)`**: A classic baseball cap crown with a flat bill extended forward.
* **`createSensorVisor(radius, colors)`**: A horizontal curved bar across the eye-line with emissive visor material.
* **`createWicketGrill(radius, colors)`**: Minimalist protective wireframe faceguard curved over the lower face.
* **`createCombatHorns(radius, colors)`**: Two angled athletic horns/temple pads tapering outward.
* **`createTerraceVisor(radius, colors)`**: Angular wide-brim visor shading the upper brow.
* **`createCoutureDiadem(radius, colors)`**: An aristocratic tiered crown/crest along the high forehead.
* **`createWayfinderCord(radius, colors)`**: Knotted double-band with a jade greenstone toggle.
* **`createBroadcasterHeadset(radius, colors)`**: An over-ear circular earpiece with a curved boom mic extending to the mouth.
* **`createCourierCap(radius, colors)`**: A backwards-turned aerodynamic runner's cap with subtle side fins.
* **`createOuendanHeadband(radius, colors)`**: Front forehead band with dual ribbon tails trailing behind the skull.

#### 2. Update `src/sim/ragdoll.js`
1. In `createSolidAthletePart()`, under `if (key === 'head')`:
   Add a dedicated group container named `athlete-headwear-slot` as a child of the head solidGroup.
2. Export `setAthleteHeadwear(state, headwearId, colors)`:
   * Finds `athlete-headwear-slot`.
   * Disposes of existing children geometries.
   * Invokes the appropriate builder from `CosmeticsBuilders` and mounts the new mesh group.

---

### Stage 3: The In-Engine Photo Booth Viewport (`?mode=photobooth`)

In `src/main.js`:
1. Check query parameter:
   ```javascript
   const isPhotoBooth = new URLSearchParams(window.location.search).get('mode') === 'photobooth';
   ```
2. If `isPhotoBooth` is active:
   * Bypass standard match logic and HUD rendering.
   * Spawn a dedicated studio turntable scene:
     - Neutral dark backdrop (`0x0b0f17`).
     - Key Light: Top-right studio spotlight (`0xffffff`, intensity 2.2).
     - Rim Light: Strong edge backlight (`0x38bdf8`, intensity 3.8) to pop black mannequin silhouettes from the dark background.
   * Position camera at chest/chin level (distance ~1.15m, 12° side angle, looking slightly up).
   * Expose `window.captureRosterAvatars()` on the global window object.
   * When invoked, `captureRosterAvatars()` iterates over `CANONICAL_ROSTER`, applies palette and headwear, captures a 512×512 base64 canvas snapshot, and POSTs to `/api/capture` with target filename `avatars/${athleteId}.png`.

---

### Stage 4: Verification & Execution
1. Run `npm run build` in PowerShell. Ensure 0 errors and a clean exit.
2. Launch Vite in dev mode (`npm run dev`).
3. Open `http://localhost:5174/?mode=photobooth` in the browser or via automated runner to generate all 10 avatars into `captures/avatars/`.
4. Inspect the generated images in `captures/avatars/` to confirm proper scaling, no clipping, and accurate palette assignments.
