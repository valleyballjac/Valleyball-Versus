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

/** Analogue-trigger travel past which the trigger counts as held. */
const TRIGGER_THRESHOLD = 0.5;

/**
 * THE KEYMAP. Bindings, deliberately NOT in TUNING: TUNING is the set of
 * numbers that change how the game FEELS, and which button does what is not one
 * of them — it is the contract between the player's hands and the verbs. Mixing
 * the two would put "does C slide" on the same slider panel as "how fast does
 * the camera orbit", and only one of those is a tuning question.
 *
 * Gamepad indices are the standard mapping: 6 and 7 are the triggers, 2 is
 * X/Square. Analogue triggers report both `pressed` and `value`, so both are
 * read — a pad that populates only one of them still works.
 */
const KEYMAP = {
  sprint: { pad: 6, keys: ['ShiftLeft', 'ShiftRight'] },
  slide: { pad: 7, keys: ['KeyC'] },
  dive: { pad: 2, keys: ['KeyQ'] },
  // Button 9 is Start in the standard mapping. Resetting the ball is a spawn
  // event, not a verb, so it sits on a menu button rather than a face button.
  ballReset: { pad: 9, keys: ['KeyB'] },
};

/** Is this pad button down, by either report? */
function padDown(pad, index) {
  const button = pad.buttons[index];
  return !!(button && (button.pressed || button.value > TRIGGER_THRESHOLD));
}

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

/**
 * The one InputState object. fixedUpdate reads it; nothing else writes it.
 *
 * moveX / moveZ are the raw stick-space axes (right-positive, forward-positive).
 * moveWorld is those axes rotated into world space against the camera, latched
 * per frame so every step in the frame consumes an identical vector.
 *
 * lookX / lookY are the RIGHT stick, raw and deliberately NOT rotated into world
 * space. mouseDX / mouseDY are the same axis from a mouse drag, accumulated in
 * PIXELS since the last sample and cleared by it — a drag and a stick feed the
 * same two camera angles, and the camera owns the conversion. They drive the camera orbit, which is expressed in the camera's own
 * frame — an azimuth rate and an elevation rate — so a camera-relative rotation
 * here would be rotating the camera against itself.
 *
 * THE RIGHT STICK USED TO BE FACING. It is the camera now. Facing has gone back
 * to following velocity, because a free-roam player steering a rolling ball has
 * no use for a facing axis and every use for a camera. See animtarget.js.
 *
 * sprintHeld is INPUT state, not character state: it is the position of a
 * button this frame, exactly like jumpQueued, and nothing in the simulation
 * branches on it except the motor's own speed governor.
 *
 * cameraYaw is the camera's ground-plane heading, LATCHED here once per frame.
 * The simulation reads the camera through this number and through nothing else
 * (LAW L6): every fixed step inside a frame therefore sees one identical yaw,
 * rather than each sampling a camera that the render pass is moving underneath
 * them. It is derived from the same _forward the movement basis is built from,
 * so facing and movement can never disagree about where the camera is looking.
 */
export const input = {
  moveX: 0,
  moveZ: 0,
  jumpQueued: false,
  sprintHeld: false,
  /** Held, like sprintHeld. */
  slideHeld: false,
  /** Edge-triggered and consumed, exactly like jumpQueued. */
  diveQueued: false,
  /** Edge-triggered and consumed, exactly like diveQueued. The ball's reset is
   *  a SPAWN EVENT, so the flag is all input is allowed to do — fixedUpdate
   *  owns the teleport. */
  ballResetQueued: false,
  moveWorld: new THREE.Vector3(),
  lookX: 0,
  lookY: 0,
  /** Pixels of primary-button drag since the last sample. Consumed by the
   *  camera and zeroed here, so a frame that drops does not lose the motion
   *  and a frame that repeats does not apply it twice. */
  mouseDX: 0,
  mouseDY: 0,
  cameraYaw: 0,
};

const heldKeys = new Set();
let padJumpWasDown = false;
let padDiveWasDown = false;
let padBallResetWasDown = false;
let installed = false;

/**
 * MOUSE DRAG, accumulated between samples.
 *
 * This replaces OrbitControls' own pointer handling, which went with it. The
 * deltas are summed here rather than read as a position because a browser can
 * deliver several pointermove events between two rendered frames, and taking
 * only the last one throws away most of a fast flick.
 *
 * Pointer capture is used so a drag that leaves the canvas — or the window —
 * still ends with a pointerup we hear about. Without it, dragging off the edge
 * and releasing leaves the camera spinning until the next click.
 */
let dragging = false;
let dragPointerId = -1;
let accumDX = 0;
let accumDY = 0;

function onPointerDown(event) {
  if (event.button !== 0) return;
  dragging = true;
  dragPointerId = event.pointerId;
  accumDX = 0;
  accumDY = 0;
  if (event.target && event.target.setPointerCapture) {
    event.target.setPointerCapture(event.pointerId);
  }
}

function onPointerMove(event) {
  if (!dragging || event.pointerId !== dragPointerId) return;
  accumDX += event.movementX || 0;
  accumDY += event.movementY || 0;
}

function onPointerUp(event) {
  if (event.pointerId !== dragPointerId) return;
  dragging = false;
  dragPointerId = -1;
}

function isTextEntry(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function onKeyDown(event) {
  if (isTextEntry(event.target)) return;
  heldKeys.add(event.code);

  // Edge-triggered: auto-repeat must not re-queue a jump or a dive.
  if (event.code === 'Space' && !event.repeat) input.jumpQueued = true;
  if (KEYMAP.dive.keys.includes(event.code) && !event.repeat) input.diveQueued = true;
  if (KEYMAP.ballReset.keys.includes(event.code) && !event.repeat) input.ballResetQueued = true;
}

function onKeyUp(event) {
  heldKeys.delete(event.code);
}

function onBlur() {
  // Losing focus mid-key leaves the key stuck down forever otherwise.
  heldKeys.clear();
  padJumpWasDown = false;
  padDiveWasDown = false;
  // Same for a drag: losing focus mid-drag would otherwise leave the camera
  // taking pointer deltas from a button nobody is holding.
  dragging = false;
  dragPointerId = -1;
  accumDX = 0;
  accumDY = 0;
}

/**
 * @param {HTMLElement} [surface] the element a drag must start on. The canvas,
 *        so a drag that begins on the tuning panel does not swing the camera.
 */
export function initInput(surface) {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const target = surface || window;
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerUp);
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

  let lookX = 0;
  let lookY = 0;

  // Held, not toggled: a toggle is a mode, and these are meant to be something
  // the hand is doing.
  let sprintHeld = KEYMAP.sprint.keys.some((k) => heldKeys.has(k));
  let slideHeld = KEYMAP.slide.keys.some((k) => heldKeys.has(k));

  const pad = firstConnectedGamepad();
  if (pad) {
    // Stick up reads negative on axis 1, and forward is positive here.
    const stick = applyDeadzone(pad.axes[0] || 0, pad.axes[1] || 0, TUNING.motor.stickDeadzone);
    if (stick.x !== 0 || stick.y !== 0) {
      x = stick.x;
      z = -stick.y;
    }

    // The right stick, axes 2 and 3, through the same radial deadzone rescale.
    // Sharing TUNING.motor.stickDeadzone is deliberate: two deadzones for two
    // sticks on the same pad is two numbers to keep in agreement by hand.
    //
    // Signs are left exactly as the pad reports them. main.js owns which way a
    // push turns the camera, because that is a camera convention and not an
    // input one — putting the negation here would hide it from the place that
    // has to be read to understand the orbit.
    const look = applyDeadzone(pad.axes[2] || 0, pad.axes[3] || 0, TUNING.motor.stickDeadzone);
    lookX = look.x;
    lookY = look.y;

    if (padDown(pad, KEYMAP.sprint.pad)) sprintHeld = true;
    if (padDown(pad, KEYMAP.slide.pad)) slideHeld = true;

    const jumpDown = !!(pad.buttons[0] && pad.buttons[0].pressed);
    if (jumpDown && !padJumpWasDown) input.jumpQueued = true;
    padJumpWasDown = jumpDown;

    // Edge-triggered on the pad too: holding X must queue one dive, not sixty.
    const diveDown = padDown(pad, KEYMAP.dive.pad);
    if (diveDown && !padDiveWasDown) input.diveQueued = true;
    padDiveWasDown = diveDown;

    // Same edge treatment, same reason: a held Start must serve once.
    const ballResetDown = padDown(pad, KEYMAP.ballReset.pad);
    if (ballResetDown && !padBallResetWasDown) input.ballResetQueued = true;
    padBallResetWasDown = ballResetDown;
  }

  // Diagonals must not be faster than cardinals.
  const magnitude = Math.hypot(x, z);
  if (magnitude > 1) {
    x /= magnitude;
    z /= magnitude;
  }

  input.moveX = x;
  input.moveZ = z;

  input.sprintHeld = sprintHeld;
  input.slideHeld = slideHeld;
  input.lookX = lookX;
  input.lookY = lookY;

  // Handed over and cleared in one step: whatever the camera does not consume
  // this frame is not carried into the next.
  input.mouseDX = accumDX;
  input.mouseDY = accumDY;
  accumDX = 0;
  accumDY = 0;

  // Camera-relative: the camera's forward flattened onto the ground plane.
  camera.getWorldDirection(_forward);
  _forward.y = 0;

  if (_forward.lengthSq() < 1e-8) {
    // Looking straight down or up: no usable ground-plane forward this frame.
    // lookX/lookY are NOT cleared here — the orbit is what gets the camera out
    // of this pose, so zeroing it would leave the player unable to recover.
    //
    // cameraYaw KEEPS ITS PREVIOUS VALUE rather than being zeroed. A yaw of 0
    // is a real heading, not a "no data" marker, so writing one here would spin
    // the character to face world +Z the instant the camera passed through
    // vertical. Holding the last good heading is the only answer that does not
    // invent a direction the player did not ask for.
    input.moveWorld.set(0, 0, 0);
    return;
  }

  _forward.normalize();
  // forward x up is screen-right: for a camera looking down -Z this yields +X.
  _right.crossVectors(_forward, WORLD_UP).normalize();

  input.moveWorld.set(0, 0, 0).addScaledVector(_right, x).addScaledVector(_forward, z);

  // The latch. Same convention as every other yaw in the project:
  // atan2(x, z), so 0 faces world +Z.
  input.cameraYaw = Math.atan2(_forward.x, _forward.z);
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

/**
 * Reads and clears the queued dive. Same contract as consumeJump: fixedUpdate
 * calls this exactly once per step and clears the flag whether or not the dive
 * actually fires, so a press made during the cooldown is spent rather than
 * buffered into a dive the player did not ask for at a moment they did not
 * choose.
 * @returns {boolean}
 */
export function consumeDive() {
  const queued = input.diveQueued;
  input.diveQueued = false;
  return queued;
}

/**
 * Reads and clears the queued ball reset. Same contract as consumeDive: called
 * once per fixed step, whether or not it fires, so a press cannot survive into
 * a later tick and serve twice.
 *
 * @returns {boolean}
 */
export function consumeBallReset() {
  const queued = input.ballResetQueued;
  input.ballResetQueued = false;
  return queued;
}
