import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { isDarkColor } from './scoreboards.js';

/**
 * NON-COLLIDER IN-GOAL TEAM COLOR INDICATORS.
 *
 * Fills each hoop aperture (`X = 0` scoring plane) with a clean, untextured
 * translucent plane and slim rim glow tinted to the attacking team's color:
 *   - `matchState.targetGoal` glows in Home's `primaryColor`; the opposite hoop
 *     glows in Away's `primaryColor`, so every player always attacks the goal
 *     glowing their own team color (swapping ends automatically after goals).
 *
 * LAW 1 — Zero rigid bodies, zero colliders, zero physics interaction.
 * LAW 6 — Pure function of simulation `tick` and `matchState`; zero wall clocks or RNG.
 * LAW 8 — Zero runtime lights or shader-recompiling visibility toggles.
 */

const _baseColor = new THREE.Color();
const _brightColor = new THREE.Color();
const _white = new THREE.Color(0xffffff);

function toHexCss(hexNum) {
  const safe = Number.isFinite(hexNum) ? (hexNum & 0xffffff) : 0xd90429;
  return '#' + safe.toString(16).padStart(6, '0');
}

function createHoopIndicatorAssembly(hoopZ, hoopCenterY, hoopRadius, name) {
  const root = new THREE.Group();
  root.name = name;
  root.position.set(0, hoopCenterY, hoopZ);

  // Oriented in the X = 0 scoring plane (local XY rotated +90 deg around Y -> YZ plane)
  const apertureGroup = new THREE.Group();
  apertureGroup.rotation.y = Math.PI / 2;
  root.add(apertureGroup);

  // 1. Clean, untextured non-collider translucent plane inside the hoop aperture
  const planeGeom = new THREE.CircleGeometry(Math.max(1.0, hoopRadius - 0.03), 64);
  const planeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.32,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const planeMesh = new THREE.Mesh(planeGeom, planeMat);
  planeMesh.renderOrder = 2;
  apertureGroup.add(planeMesh);

  // 2. Slim hoop-hugging rim glow so the team color remains readable edge-on down X = 0
  const rimGeom = new THREE.TorusGeometry(hoopRadius, 0.12, 12, 64);
  const rimMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const rimMesh = new THREE.Mesh(rimGeom, rimMat);
  rimMesh.renderOrder = 3;
  apertureGroup.add(rimMesh);

  return {
    root,
    planeMesh,
    planeMat,
    rimMesh,
    rimMat,
  };
}

function applyHoopAppearance(assembly, hexColor, tick, pulse01, active = true) {
  assembly.planeMesh.visible = active;
  assembly.rimMesh.visible = active;
  if (!active) return;

  _baseColor.setHex(hexColor);
  const dark = isDarkColor(toHexCss(hexColor));
  _brightColor.copy(_baseColor).lerp(_white, dark ? 0.32 : 0.12);

  const breathe = 0.5 + 0.5 * Math.sin(tick * 0.06);

  assembly.planeMat.color.copy(dark ? _brightColor : _baseColor);
  assembly.planeMat.opacity = Math.min(0.62, 0.28 + breathe * 0.05 + pulse01 * 0.24);

  assembly.rimMat.color.copy(_brightColor);
  assembly.rimMat.opacity = Math.min(0.78, 0.44 + breathe * 0.08 + pulse01 * 0.24);
}

/**
 * Creates the non-collider 3D in-goal team color planes.
 *
 * @param {THREE.Scene} scene
 */
export function createGoalIndicators(scene) {
  if (typeof document !== 'undefined') {
    document.getElementById('goal-target-hud')?.remove();
  }

  const hoopCenterY = TUNING.match?.hoopCenterY ?? 10.0;
  const hoopRadius = TUNING.match?.hoopRadius ?? 4.667;
  const hoopNorthZ = TUNING.match?.hoopNorthZ ?? -40.0;
  const hoopSouthZ = TUNING.match?.hoopSouthZ ?? 40.0;

  const group = new THREE.Group();
  group.name = 'goal-target-indicators';
  scene.add(group);

  const north = createHoopIndicatorAssembly(hoopNorthZ, hoopCenterY, hoopRadius, 'goal-indicator-north');
  const south = createHoopIndicatorAssembly(hoopSouthZ, hoopCenterY, hoopRadius, 'goal-indicator-south');
  group.add(north.root, south.root);

  /**
   * Deterministic visual update driven from simulation tick and match state.
   */
  function update({
    gameState,
    matchState,
    tick = 0,
  }) {
    const show3D = gameState === 'match' || gameState === 'practice' || gameState === 'flyover';
    group.visible = show3D;
    if (!show3D) return;

    const targetGoal = matchState?.targetGoal === 'S' ? 'S' : 'N';
    const homeColor = TUNING.teams?.home?.primaryColor
      ?? TUNING.athlete?.palette?.homePrimary
      ?? 0xd90429;
    const awayColor = TUNING.teams?.away?.primaryColor
      ?? TUNING.athlete?.palette?.awayPrimary
      ?? 0x1d4ed8;

    const celebMax = Math.max(1, TUNING.match?.celebrationTicks || 150);
    const celebTicks = matchState?.celebrationTicks || 0;
    const hasScoredOnce = (matchState?.events?.length || 0) > 0;
    const pulse01 = (celebTicks > 0 && hasScoredOnce) ? Math.min(1, celebTicks / celebMax) : 0;

    if (gameState === 'practice') {
      const p1Color = TUNING.players?.[0]?.primaryColor ?? homeColor;
      const northIsTarget = targetGoal === 'N';
      applyHoopAppearance(north, p1Color, tick, pulse01, northIsTarget);
      applyHoopAppearance(south, p1Color, tick, pulse01, !northIsTarget);
    } else {
      const northColor = targetGoal === 'N' ? homeColor : awayColor;
      const southColor = targetGoal === 'N' ? awayColor : homeColor;
      applyHoopAppearance(north, northColor, tick, pulse01, true);
      applyHoopAppearance(south, southColor, tick, pulse01, true);
    }
  }

  return { group, update };
}
