# Valley Court Specification & Landmarks

## 1. Overview & Retirement of the Test Bowl

The **Valley Court** (`public/models/arena.glb`) is the sole canonical arena for Valleyball Versus.
* **The Procedural Test Bowl is Permanently Retired**: All legacy functions (`buildProfile`, `appendLip`, `createBowlArena`) have been removed from `src/sim/arena.js`. Never resurrect lathe geometry or bowl presets.
* All game modes (Practice, 1v1 Match, 2v2 Versus) and all test harnesses run exclusively on the Valley Court.

---

## 2. Spatial Geometry & Key Landmarks

The Valley Court is an authored, organically contoured arena featuring a central valley basin flanked by stream channels and elevated mounds.

### Coordinates & Dimensions
* **Longitudinal Axis ($Z$)**:
  - Length: $\pm 58.0\,\text{m}$ (total court span $\sim 116\,\text{m}$).
  - South Goal Hoop: $z = +43.0\,\text{m}$.
  - North Goal Hoop: $z = -43.0\,\text{m}$.
  - Center Court Line: $z = 0.0\,\text{m}$.
* **Lateral Axis ($X$)**:
  - Width: $\pm 24.0\,\text{m}$ (total court width $\sim 48\,\text{m}$).
  - Hoop center: $x = 0.0\,\text{m}$.
* **Vertical Axis ($Y$)**:
  - Center Basin Floor: $y \approx 0.0\,\text{m} \to 0.05\,\text{m}$.
  - Stream Heads (elevated corners): $y \approx 7.43\,\text{m} \to 8.12\,\text{m}$.
  - Mound Ridges: $y \approx 5.86\,\text{m} \to 10.05\,\text{m}$.
  - Kill Plane (Out-of-bounds watchdog threshold): $y < -5.0\,\text{m}$.

---

## 3. The Goal Hoops

* **Aperture Center**:
  - North Hoop: $(0.0,\, 7.50,\, -43.0)\,\text{m}$
  - South Hoop: $(0.0,\, 7.50,\, +43.0)\,\text{m}$
* **Aperture Radius**: $r = 4.667\,\text{m}$ (diameter $\approx 9.33\,\text{m}$).
* **Plane Orientation**: Aligned perpendicular to the longitudinal axis (lying in the $Z$-constant plane). The ball scores when crossing from $|z| < 43.0$ to $|z| \ge 43.0$ within the aperture radius.

---

## 4. Spawns & Stream Landmarks

All athlete and ball spawns are derived from authored court landmarks in `src/config/tuning.js`:

### Athlete Spawns
* **Home Team (South Half)**:
  - P1 Primary: `(0.0, 1.20, 22.0)` facing North ($\text{yaw} = \pi$)
  - P3 (2v2 Wing): `(-8.0, 1.20, 28.0)` facing North
* **Away Team (North Half)**:
  - P2 Primary: `(0.0, 1.20, -22.0)` facing South ($\text{yaw} = 0$)
  - P4 (2v2 Wing): `(8.0, 1.20, -28.0)` facing South

### Ball Stream Drop Spawns
Rather than spawning flat on the floor, balls are dropped from the elevated stream heads or high-elevation center drops:
* **High Center Drop Spawn**: `(0.0, 10.0, 0.0)`
* **Southwest Stream Head**: `(-12.77, 8.50, 39.96)`
* **Northeast Stream Head**: `(12.77, 8.50, -39.96)`

---

## 5. Collision Surfaces vs. Scenery

When loading `arena.glb`:
* **Court Floor & Mound Trimeshes**: Collidable Rapier trimeshes built with `RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES`.
* **Boundary Glass Barriers**: Collidable Rapier trimeshes for $y \ge 13.0\,\text{m}$, creating the continuous boundary envelope.
* **Line Decals (`M_Lines*`)**: Raised 5cm aesthetic painted lines (`Circle040_1`, `Circle018`, `Circle004`, Stream Head line trims) are explicitly filtered into **scenery / render-only** in `src/sim/arena.js` (`isRenderOnly`). They must **never** receive Rapier colliders.
