import * as THREE from 'three';
import { TUNING } from './config/tuning.js';

/**
 * Input sampling.
 *
 * PROJECT STANDARD: input is SAMPLED once per rendered frame (from the loop's
 * onFrame hook) and only READ inside fixedUpdate. Nothing here applies a force
 * or touches a body.
 *
 * This file deliberately lives outside src/sim/ — it reads the gamepad and the
 * camera, neither of which the simulation is allowed to perceive directly.
 */

const WORLD_UP = new THREE.Vector3(0, 1, 0);

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

/**
 * The one InputState object. fixedUpdate reads it; nothing else writes it.
 *
 * moveX / moveZ are the raw stick-space axes (right-positive, forward-positive).
 * moveWorld is those axes rotated into world space against the camera, latched
 * per frame so every step in the frame consumes an identical vector.
 */
export const input = {
  moveX: 0,
  moveZ: 0,
  jumpQueued: false,
  moveWorld: new THREE.Vector3(),
};

const heldKeys = new Set();
let padJumpWasDown = false;
let installed = false;

function isTextEntry(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function onKeyDown(event) {
  if (isTextEntry(event.target)) return;
  heldKeys.add(event.code);

  // Edge-triggered: auto-repeat must not re-queue a jump.
  if (event.code === 'Space' && !event.repeat) input.jumpQueued = true;
}

function onKeyUp(event) {
  heldKeys.delete(event.code);
}

function onBlur() {
  // Losing focus mid-key leaves the key stuck down forever otherwise.
  heldKeys.clear();
  padJumpWasDown = false;
}

export function initInput() {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
}

/**
 * Radial deadzone, rescaled so the live range still spans a full 0..1 rather
 * than starting at the deadzone edge.
 */
function applyDeadzone(x, y, deadzone) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadzone) return { x: 0, y: 0 };

  const scaled = (magnitude - deadzone) / (1 - deadzone) / magnitude;
  return { x: x * scaled, y: y * scaled };
}

function firstConnectedGamepad() {
  if (typeof navigator.getGamepads !== 'function') return null;
  const pads = navigator.getGamepads();
  for (let i = 0; i < pads.length; i++) {
    if (pads[i] && pads[i].connected) return pads[i];
  }
  return null;
}

/**
 * Samples keyboard and gamepad and rebuilds the camera-relative world vector.
 * Called once per rendered frame. Never called from fixedUpdate.
 *
 * @param {THREE.Camera} camera
 */
export function sampleInput(camera) {
  let x = (heldKeys.has('KeyD') ? 1 : 0) - (heldKeys.has('KeyA') ? 1 : 0);
  let z = (heldKeys.has('KeyW') ? 1 : 0) - (heldKeys.has('KeyS') ? 1 : 0);

  const pad = firstConnectedGamepad();
  if (pad) {
    // Stick up reads negative on axis 1, and forward is positive here.
    const stick = applyDeadzone(pad.axes[0] || 0, pad.axes[1] || 0, TUNING.motor.stickDeadzone);
    if (stick.x !== 0 || stick.y !== 0) {
      x = stick.x;
      z = -stick.y;
    }

    const jumpDown = !!(pad.buttons[0] && pad.buttons[0].pressed);
    if (jumpDown && !padJumpWasDown) input.jumpQueued = true;
    padJumpWasDown = jumpDown;
  }

  // Diagonals must not be faster than cardinals.
  const magnitude = Math.hypot(x, z);
  if (magnitude > 1) {
    x /= magnitude;
    z /= magnitude;
  }

  input.moveX = x;
  input.moveZ = z;

  // Camera-relative: the camera's forward flattened onto the ground plane.
  camera.getWorldDirection(_forward);
  _forward.y = 0;

  if (_forward.lengthSq() < 1e-8) {
    // Looking straight down or up: no usable ground-plane forward this frame.
    input.moveWorld.set(0, 0, 0);
    return;
  }

  _forward.normalize();
  // forward x up is screen-right: for a camera looking down -Z this yields +X.
  _right.crossVectors(_forward, WORLD_UP).normalize();

  input.moveWorld.set(0, 0, 0).addScaledVector(_right, x).addScaledVector(_forward, z);
}

/**
 * Reads and clears the queued jump. fixedUpdate calls this exactly once per
 * step, and clears the flag whether or not the jump actually fires.
 * @returns {boolean}
 */
export function consumeJump() {
  const queued = input.jumpQueued;
  input.jumpQueued = false;
  return queued;
}
