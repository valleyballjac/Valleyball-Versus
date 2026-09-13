import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';

/**
 * Multi-Target Dynamic Sports Framing Camera.
 *
 * Designed for local multiplayer Valleyball (1v1 and 2v2).
 * Automatically frames all active athletes and the match ball smoothly.
 * Provides a dynamic elevated sideline broadcast perspective where both defending
 * goals (North and South) and the entire valley basin are in view.
 */

const _centroid = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _desiredPos = new THREE.Vector3();
let initialized = false;

export function getSportsCameraTarget() {
  return _camTarget;
}

/**
 * Updates the multi-target sports camera.
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {object[]} athletes array of Athlete entities
 * @param {object|null} ball active match ball
 * @param {number} frameDelta seconds
 */
export function updateSportsCamera(camera, athletes = [], ball = null, frameDelta = 0.016) {
  if (!athletes || athletes.length === 0) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let avgX = 0;
  let avgY = 0;
  let avgZ = 0;
  let count = 0;

  for (const athlete of athletes) {
    if (!athlete.motor || !athlete.motor.mesh) continue;
    const p = athlete.motor.mesh.position;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
    avgX += p.x;
    avgY += p.y;
    avgZ += p.z;
    count += 1;
  }

  const ballPos = ball && ball.mesh ? ball.mesh.position : null;
  if (ballPos) {
    minX = Math.min(minX, ballPos.x);
    maxX = Math.max(maxX, ballPos.x);
    minZ = Math.min(minZ, ballPos.z);
    maxZ = Math.max(maxZ, ballPos.z);
    // Weight the ball slightly in the action center
    avgX += ballPos.x * 1.2;
    avgY += Math.min(6.0, Math.max(1.0, ballPos.y)) * 0.8;
    avgZ += ballPos.z * 1.2;
    count += 1.2;
  }

  if (count === 0) return;

  avgX /= count;
  avgY /= count;
  avgZ /= count;

  // Longitudinal and lateral spreads
  const spreadX = Math.max(10.0, maxX - minX);
  const spreadZ = Math.max(16.0, maxZ - minZ);
  const maxSpread = Math.max(spreadX * 1.2, spreadZ * 0.85);

  // Target look-at point (clamped within court boundaries, biased toward centerline)
  const targetX = avgX * 0.4;
  const targetY = Math.max(1.5, avgY + 0.8);
  const targetZ = Math.min(32.0, Math.max(-32.0, avgZ * 0.85));

  // Dynamic distance and height based on athlete & ball spread
  // Zoom bounds: tight 18m, wide 38m
  const dynamicDistance = Math.min(38.0, Math.max(18.0, maxSpread * 0.95 + 8.0));
  const dynamicHeight = Math.min(22.0, Math.max(11.0, maxSpread * 0.48 + 5.0));

  // Positioned on the East sideline (+X), tracking longitudinal play (Z)
  _desiredPos.set(
    targetX + dynamicDistance,
    targetY + dynamicHeight,
    targetZ * 0.65, // Slight dolly lead along court length
  );

  const ease = 1 - Math.exp(-4.5 * frameDelta);

  if (!initialized) {
    initialized = true;
    _camTarget.set(targetX, targetY, targetZ);
    camera.position.copy(_desiredPos);
  } else {
    _camTarget.lerp(new THREE.Vector3(targetX, targetY, targetZ), ease);
    camera.position.lerp(_desiredPos, ease);
  }

  camera.lookAt(_camTarget);
}
