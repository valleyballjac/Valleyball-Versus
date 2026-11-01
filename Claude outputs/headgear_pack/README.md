# Valleyball Versus: Locker Headgear Pack (pass 7, approved 2026-10-17)

`valleyballHeadgear.js` is one self-contained ES module. No imports: pass your own `THREE` in.

    import * as THREE from 'three';
    import { ROSTER, buildForAthlete, loadLeagueMark, paletteFor, recolorHeadgear } from './valleyballHeadgear.js';

    const mark = loadLeagueMark(THREE);                       // embedded 512px mask, loaded once
    const piece = buildForAthlete(THREE, 'red', { radius: 0.2, markTexture: mark });
    headMesh.add(piece);                                      // head-local: origin = head centre, -Z = face

Or by item, with an explicit palette:

    const pal = paletteFor('blue');                           // { primary, secondary, accent, neutral }
    const helmet = buildWicketkeeperHelmet(THREE, pal, { radius: 0.2, markTexture: mark });

Rules the pack keeps: zero physics (Group/Mesh only), nothing below the chin line, no neck geometry,
every dimension scales with `radius`. Every material carries `userData.colorRole` so
`recolorHeadgear(group, palette)` re-tints a live piece. `disposeHeadgear(group)` frees it.

Files
- valleyballHeadgear.js      the module (inventory, colour bindings and API docs are in its header)
- valleyball_mark_512.png    the league mark as a white-on-black alpha mask (also embedded in the module)
- standalone_proof.png       the ten pieces built by this file on plain 0.20 m spheres
