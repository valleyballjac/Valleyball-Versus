import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';

/**
 * Multi-Target Dynamic Sports Framing Camera.
 *
 * Designed for local multiplayer Valleyball (1v1 and 2v2).
 * Automatically frames all active athletes and the match ball smoothly.
 * Uses exact frustum trigonometry so all players and the ball are guaranteed
 * to remain in view across the entire 120m court.
 */

const _centroid = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _desiredPos = new THREE.Vector3();
const _tempTarget = new THREE.Vector3();
let initialized = false;

export function getSportsCameraTarget() {
  return _camTarget;
}

export function resetSportsCamera() {
  initialized = false;
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
  let minY = Infinity;
  let maxY = -Infinity;
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
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
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
    minY = Math.min(minY, ballPos.y);
    maxY = Math.max(maxY, ballPos.y);
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
  const spreadY = Math.max(2.0, maxY - minY);
  const spreadZ = Math.max(16.0, maxZ - minZ);

  // Target look-at point (clamped within court boundaries, biased toward centerline)
  const targetX = avgX * 0.35;
  const targetY = Math.max(1.5, avgY + 0.6);
  const targetZ = Math.min(46.0, Math.max(-46.0, avgZ * 0.85));

  // Frustum trigonometry for sports sideline camera:
  // Camera sits on sideline (+X) looking across X toward center.
  // Longitudinal court spread (Z) is framed by the camera's horizontal FOV.
  // Vertical spread (Y) is framed by the camera's vertical FOV.
  const vFovRad = ((camera.fov || 50) * Math.PI) / 180;
  const aspect = camera.aspect || (16 / 9);
  const tanHalfH = Math.tan(vFovRad / 2) * aspect;
  const tanHalfV = Math.tan(vFovRad / 2);

  // Required distances with comfortable margin (8m along Z, 3m along Y)
  const requiredDistZ = (spreadZ * 0.5 + 8.0) / Math.max(0.1, tanHalfH);
  const requiredDistY = (spreadY * 0.5 + 3.0) / Math.max(0.1, tanHalfV);
  const requiredDistX = spreadX * 0.8 + 10.0;

  // Dynamic distance and height: zoom bounds 20m (tight) to 68m (full-court 120m spread)
  const dynamicDistance = Math.min(68.0, Math.max(20.0, Math.max(requiredDistZ, requiredDistY, requiredDistX)));
  const dynamicHeight = Math.min(32.0, Math.max(11.0, dynamicDistance * 0.40 + 2.0));

  // Positioned on the East sideline (+X), tracking longitudinal play (Z)
  _desiredPos.set(
    targetX + dynamicDistance,
    targetY + dynamicHeight,
    targetZ * 0.65, // Slight dolly lead along court length
  );

  _tempTarget.set(targetX, targetY, targetZ);

  const ease = 1 - Math.exp(-4.5 * frameDelta);

  if (!initialized) {
    initialized = true;
    _camTarget.copy(_tempTarget);
    camera.position.copy(_desiredPos);
  } else {
    _camTarget.lerp(_tempTarget, ease);
    camera.position.lerp(_desiredPos, ease);
  }

  camera.lookAt(_camTarget);
}
