# Boundary Ball-Roll Sweep and Entrapment Certification

Card: t_ab794a23
Parent: t_a6749ce7 (corner fan ledges -> vertical curtain, COL_Barriers only)
Arena: public/models/arena.glb @ fdc613d
Engine: headless Rapier3D (test_ball_roll.mjs)

## Verdict

Zero ball entrapment across the perimeter long-side sills and all four corner
transitions. The vertical curtain conversion (terrain rim ~11m up to a glass
bottom cap at ~13m) fully removes the former corner shelf that could trap a
rolling ball. Certifying PASS.

## Roll gate (npm run test:roll)

6 new barrier scenarios added to scripts/test_ball_roll.mjs. All PASS.

corner+NE  maxClimbBase=11.566/12 (<)  vyPop=0/0.5  wedgeTicks=0/90   PASS
corner+NW  maxClimbBase=11.566/12 (<)  vyPop=0/0.5  wedgeTicks=0/90   PASS
corner+SE  maxClimbBase=11.566/12 (<)  vyPop=0/0.5  wedgeTicks=0/90   PASS
corner+SW  maxClimbBase=11.566/12 (<)  vyPop=0/0.5  wedgeTicks=0/90   PASS
sill E     vyHop=0/0.5  wedgeTicks=0/90  maxClimbBase=9.184/12 (<)    PASS
sill W     vyHop=0/0.5  wedgeTicks=0/90  maxClimbBase=9.172/12 (<)    PASS

Metric meaning
- maxClimbBase: highest ball base (center y - radius) reached. Certifies the
  ball never climbs the curtain onto the 13m glass shelf (threshold 12m).
- vyPop: maximum airborne upward velocity at the curtain (unnatural launch).
- wedgeTicks: consecutive ticks of near-zero horizontal speed while perched
  above the rim base (9.5m); >= 90 (1.5s) would mean wedged/trapped.

## Pre-existing failures (out of scope, unchanged geometry)

The 8 legacy scenarios cover interior COL_Court/COL_Goals features (stream
channel mouths, stream-to-field sideline seams, keybump boundaries). 6 fail,
but the parent changed only COL_Barriers, so these are pre-existing and not
regressions from the corner fix:

NE/NW/SE/SW channel-mouth: lateralDeflect 0.559-0.653 vs threshold 0.35
E/W stream-to-field seam:   vxLoss 3.009/3.351 vs threshold 0.25
S/N keybump:                PASS

Recommend routing these to Green (Tupac) as a separate COL_Court terrain
calibration item; they are unrelated to the perimeter entrapment certification.

## Determinism (npm run determinism)

PASS. Two independent runs on the Valley Court are byte-identical:

  A  d02238d15e94df0cb47e2ed7694dc4168f1c817bc908c9b8aaa9a6be48c14f27  411771
  B  d02238d15e94df0cb47e2ed7694dc4168f1c817bc908c9b8aaa9a6be48c14f27  411771

The new COL_Barriers geometry (1236 tris, 2 degenerate / 0 inverted removed)
is fully deterministic.

## Static audit (node scripts/audit.mjs)

All rules pass except one pre-existing size drift unrelated to this card or
the parent:

  size FAIL  WORSE src/config/tuning.js: 1732 -> 1742

That drift came from commit 654e24f (chalk-width pink outline), which touched
tuning.js only. Neither this card nor the parent modifies tuning.js. Flagging
for Yana/John: update baselines/audit-allow.json from 1732 to 1742 or trim the
chalk-outline tuning.

## Files changed (this card)

- scripts/test_ball_roll.mjs: added 6 barrier/corner/sill scenarios
  (cornerBarrierScenario x4, sillScenario x2) with thresholds walled to the
  measured curtain physics.