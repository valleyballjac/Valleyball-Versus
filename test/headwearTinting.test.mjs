import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  accentFor,
  BUILDERS,
  KITS,
  PALETTES,
  ROSTER,
  recolorHeadgear,
  resolveHeadwearPalette,
} from '../src/sim/valleyballHeadgear.js';

import {
  buildHeadwear,
  recolorHeadgear as recolorFromBuilders,
  resolveHeadwearPalette as resolveFromBuilders,
} from '../src/sim/cosmeticsBuilders.js';

test('re-exports from cosmeticsBuilders.js', () => {
  assert.equal(typeof resolveFromBuilders, 'function');
  assert.equal(typeof recolorFromBuilders, 'function');
  assert.equal(resolveFromBuilders, resolveHeadwearPalette);
  assert.equal(recolorFromBuilders, recolorHeadgear);
});

test('accentFor supports boolean isHome, string kit, and luminance flips', () => {
  // Boolean isHome
  assert.equal(accentFor(0x8B5CF6, true), KITS.home.accent);
  assert.equal(accentFor(0x8B5CF6, false), KITS.away.accent);

  // String kit
  assert.equal(accentFor(0x8B5CF6, 'home'), KITS.home.accent);
  assert.equal(accentFor(0x8B5CF6, 'away'), KITS.away.accent);

  // Luminance flips:
  // White (> 0.9) must flip to dark trim (0x0f172a) even on home
  assert.equal(accentFor(PALETTES.white, 'home'), 0x0f172a);
  assert.equal(accentFor('#F8FAFC', true), 0x0f172a);

  // Black (< 0.12) must flip to light trim (0xf1f5f9) even on away
  assert.equal(accentFor(PALETTES.black, 'away'), 0xf1f5f9);
  assert.equal(accentFor('0x0F172A', false), 0xf1f5f9);
});

test('resolveHeadwearPalette handles kit and team color combinations', () => {
  // Home kit with custom teamColor hex string
  const homeCustom = resolveHeadwearPalette({ teamColor: '#8B5CF6', isHome: true });
  assert.equal(homeCustom.primary, 0x8B5CF6);
  assert.equal(homeCustom.secondary, 0x383b42);
  assert.equal(homeCustom.neutral, 0x22242a);
  assert.equal(homeCustom.accent, 0xf1f5f9);

  // Away kit with custom primaryHex number
  const awayCustom = resolveHeadwearPalette({ primaryHex: 0x8B5CF6, isHome: false });
  assert.equal(awayCustom.primary, 0x8B5CF6);
  assert.equal(awayCustom.secondary, 0xffffff);
  assert.equal(awayCustom.neutral, 0xd0d5dd);
  assert.equal(awayCustom.accent, 0x0f172a);

  // Team color name
  const tealAway = resolveHeadwearPalette({ teamColor: 'teal', kit: 'away' });
  assert.equal(tealAway.primary, PALETTES.teal);
  assert.equal(tealAway.secondary, 0xffffff);
  assert.equal(tealAway.neutral, 0xd0d5dd);
  assert.equal(tealAway.accent, 0x0f172a);

  // Fallback athlete defaults
  const whiteDefault = resolveHeadwearPalette({ athleteId: 'white' });
  assert.equal(whiteDefault.primary, PALETTES.white);
  assert.equal(whiteDefault.secondary, 0x383b42);
  assert.equal(whiteDefault.accent, 0x0f172a); // flipped for white

  const blackDefault = resolveHeadwearPalette({ athleteId: 'black' });
  assert.equal(blackDefault.primary, PALETTES.black);
  assert.equal(blackDefault.secondary, 0xffffff);
  assert.equal(blackDefault.accent, 0xf1f5f9); // flipped for black
});

test('all 10 approved pieces render correctly with custom team color swatches', () => {
  const customColor = 0x8B5CF6; // Purple

  for (const [athleteId, info] of Object.entries(ROSTER)) {
    const builderFn = BUILDERS[info.build];
    assert.equal(typeof builderFn, 'function', `Builder function for ${athleteId} exists`);

    const group = builderFn(THREE, null, {
      teamColor: customColor,
      isHome: true,
      radius: 0.18,
    });

    assert.ok(group, `Group built for ${info.item}`);
    assert.equal(group.userData.headgearId, info.itemId);
    assert.equal(group.userData.palette.primary, customColor);

    let foundPrimary = false;

    group.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of materials) {
        if (m.userData?.colorRole === 'primary') {
          foundPrimary = true;
          assert.equal(m.color.getHex(), customColor);
        }
      }
    });

    assert.ok(foundPrimary, `${info.item} must have at least one primary-colored mesh`);
  }
});

test('fixed accents (jade toki stone, league marks) do not alter color on recolor', () => {
  // Test Wayfinder Cord (Kahu's piece with pounamu jade stone 0x2f8f6a)
  const piece = BUILDERS.buildWayfinderCord(THREE, null, {
    primaryHex: 0x06B6D4,
    isHome: true,
  });

  const JADE_HEX = 0x2f8f6a;
  let tokiMesh = null;

  piece.traverse((o) => {
    if (o.isMesh && o.name === 'toki') tokiMesh = o;
  });

  assert.ok(tokiMesh, 'Wayfinder cord must have toki mesh');
  assert.equal(tokiMesh.material.userData.colorRole, 'fixed');
  assert.equal(tokiMesh.material.color.getHex(), JADE_HEX);

  // Test Manager Cap (John Valleyball's piece with league mark)
  const cap = BUILDERS.buildManagerClassicCap(THREE, null, {
    primaryHex: 0xF8FAFC,
    isHome: true,
  });

  let markMesh = null;
  cap.traverse((o) => {
    if (o.isMesh && (o.name === 'league-mark' || o.name.startsWith('mark-'))) markMesh = o;
  });

  assert.ok(markMesh, 'Manager cap must have league mark mesh');
  assert.equal(markMesh.material.userData.colorRole, 'fixed');
  const initialMarkColor = markMesh.material.color.getHex();

  // Recolor Wayfinder cord to Red on Away kit
  recolorHeadgear(piece, {
    primaryHex: 0xD90429,
    isHome: false,
  });

  // Verify primary recolored
  assert.equal(piece.userData.palette.primary, 0xD90429);
  assert.equal(piece.userData.palette.secondary, 0xffffff);

  // Verify fixed jade DID NOT change color
  assert.equal(tokiMesh.material.color.getHex(), JADE_HEX);

  // Recolor Manager cap to Blue on Away kit
  recolorHeadgear(cap, {
    primaryHex: 0x1D4ED8,
    isHome: false,
  });

  assert.equal(cap.userData.palette.primary, 0x1D4ED8);
  assert.equal(cap.userData.palette.secondary, 0xffffff);

  // Verify fixed mark DID NOT change color
  assert.equal(markMesh.material.color.getHex(), initialMarkColor);
});

test('recolorHeadgear handles multi-materials and roles correctly', () => {
  const group = new THREE.Group();

  const matPrimary = new THREE.MeshStandardMaterial({ color: 0x000000 });
  matPrimary.userData.colorRole = 'primary';

  const matAccent = new THREE.MeshStandardMaterial({ color: 0x000000 });
  matAccent.userData.colorRole = 'accent';

  const matBody = new THREE.MeshStandardMaterial({ color: 0x000000 });
  matBody.userData.colorRole = 'bodyGrey';

  const matNeutral = new THREE.MeshStandardMaterial({ color: 0x000000 });
  matNeutral.userData.colorRole = 'neutral';

  const matVisor = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x000000 });
  matVisor.userData.colorRole = 'visor';

  const matFixed = new THREE.MeshStandardMaterial({ color: 0x123456 });
  matFixed.userData.colorRole = 'fixed';

  // Multi-material mesh
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const multiMesh = new THREE.Mesh(geom, [matPrimary, matAccent, matBody, matNeutral, matVisor, matFixed]);
  group.add(multiMesh);

  recolorHeadgear(group, {
    primaryHex: 0x8B5CF6,
    isHome: true,
  });

  assert.equal(matPrimary.color.getHex(), 0x8B5CF6);
  assert.equal(matAccent.color.getHex(), 0xf1f5f9);
  assert.equal(matBody.color.getHex(), 0x383b42);
  assert.equal(matNeutral.color.getHex(), 0x22242a);
  assert.equal(matVisor.color.getHex(), 0x8B5CF6);
  assert.equal(matVisor.emissive.getHex(), 0x8B5CF6);
  assert.equal(matFixed.color.getHex(), 0x123456); // untouched

  // Switch to away
  recolorHeadgear(group, {
    primaryHex: 0x8B5CF6,
    isHome: false,
  });

  assert.equal(matAccent.color.getHex(), 0x0f172a);
  assert.equal(matBody.color.getHex(), 0xffffff);
  assert.equal(matNeutral.color.getHex(), 0xd0d5dd);
  assert.equal(matFixed.color.getHex(), 0x123456);
});

test('buildHeadwear passes dynamic options through makeRosterBuilder', () => {
  // manager_cap built via buildHeadwear with custom teamColor and isHome: false
  const piece = buildHeadwear('manager_cap', {
    teamColor: 0x8B5CF6,
    isHome: false,
  });

  assert.ok(piece);
  assert.equal(piece.userData.palette.primary, 0x8B5CF6);
  assert.equal(piece.userData.palette.secondary, 0xffffff); // away
  assert.equal(piece.userData.palette.neutral, 0xd0d5dd);
  assert.equal(piece.userData.palette.accent, 0x0f172a); // away trim
});
