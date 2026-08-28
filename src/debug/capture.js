import { HALT } from '../core/Loop.js';
import { TUNING } from '../config/tuning.js';

/**
 * Capture policy — owned end to end here. The deterministic core knows nothing
 * about any of it.
 *
 * Two capture paths, deliberately different:
 *
 *   AUTO — the determinism regression test. Anchored to an exact tick, rendered
 *   from pure fixed state with the output pinned to a fixed resolution, so two
 *   runs under different frame pacing produce byte-identical PNGs. Armed only
 *   by the `?captureTick=N` query parameter, because it is per-run harness
 *   configuration, not game tuning: an external script must be able to set it
 *   without touching saved tuning state, and a plain run must carry no trace of
 *   it.
 *
 *   MANUAL — for eyeballing. Interpolated, at whatever size the canvas
 *   currently is, on demand from the console. Never used for comparison.
 *
 * The renderer must be constructed with `preserveDrawingBuffer: true`, or the
 * framebuffer may be cleared before a manual read and you get a perfectly
 * valid, perfectly blank PNG.
 */

const ENDPOINT = '/__capture';
const QUERY_KEY = 'captureTick';

/**
 * The pinned output size. Byte-comparable means identical pixels, so neither
 * the window size nor the device pixel ratio may leak into the image.
 */
const PINNED_WIDTH = 1280;
const PINNED_HEIGHT = 720;

let ctx = null;
let hotkeyInstalled = false;

/**
 * Reads the anchor tick from the URL. Returns null when the parameter is
 * absent or not a non-negative integer — in which case nothing is armed.
 * @param {string} [search]
 * @returns {number | null}
 */
export function readTargetTick(search) {
  const raw = new URLSearchParams(search ?? window.location.search).get(QUERY_KEY);
  if (raw === null || raw.trim() === '') return null;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    console.warn(`[capture] ignoring ${QUERY_KEY}=${raw} — expected a non-negative integer`);
    return null;
  }
  return value;
}

/**
 * @param {object} deps
 * @param {import('three').WebGLRenderer} deps.renderer
 * @param {import('three').Scene} deps.scene
 * @param {import('three').PerspectiveCamera} deps.camera
 * @param {import('../core/Loop.js').Loop} deps.loop
 * @param {() => void} deps.restoreViewport  re-applies the live window sizing
 * @param {(alpha: number) => void} [deps.poseCharacter]  poses the skinned
 *        meshes from the ragdoll bodies at a given alpha. The anchored capture
 *        renders at alpha 1, and the character is posed by the render pass
 *        rather than by the interpolation registry, so without this hook an
 *        anchored PNG would contain capsules in their stepped pose and a mesh
 *        still standing in bind pose.
 * @param {() => void} [deps.requestRagdollSpawn]  queues an R-spawn. It only
 *        sets a flag; the spawn itself happens inside fixedUpdate, because that
 *        is the one place allowed to mutate physics.
 * @returns {number | null} the armed tick, or null if nothing was armed
 */
export function initCapture(deps) {
  ctx = deps;

  window.__vb = window.__vb || {};
  window.__vb.capture = (name) => manualCapture(name);

  installManualHotkey();

  const target = readTargetTick();
  if (target === null) return null;

  // THE SPAWN SEAM. A determinism capture of an empty bowl proves very little
  // now that there is a character, so an armed run also spawns the ragdoll on a
  // fixed tick. It lives here, in the capture policy, and NOT in Loop.js: the
  // loop is Task 1's frozen foundation and knows nothing about ragdolls,
  // captures or files. Both listeners are tick-driven, so the whole sequence is
  // a function of the tick counter and repeats exactly.
  ctx.loop.onTick((tick) => {
    if (tick === TUNING.ragdoll.captureSpawnTick && ctx.requestRagdollSpawn) {
      ctx.requestRagdollSpawn();
    }
    return tick === target ? captureAnchored(tick) : undefined;
  });

  console.log(
    `[capture] armed for tick ${target}; ragdoll spawns at tick ` +
      `${TUNING.ragdoll.captureSpawnTick}; the loop will halt once it is written`,
  );
  return target;
}

/**
 * The anchored capture. Runs inside the tick listener, so `curr` holds exactly
 * this tick's state.
 *
 * Nothing here touches simulation state. It writes the renderer's output size,
 * the camera projection, and Object3D transforms through Interpolated.apply() —
 * and puts the first two back before returning.
 *
 * @param {number} tick
 * @returns {string} HALT
 */
function captureAnchored(tick) {
  const { renderer, scene, camera, loop } = ctx;

  const previousPixelRatio = renderer.getPixelRatio();

  renderer.setPixelRatio(1);
  renderer.setSize(PINNED_WIDTH, PINNED_HEIGHT, false);
  camera.aspect = PINNED_WIDTH / PINNED_HEIGHT;
  camera.updateProjectionMatrix();

  // alpha = 1 is pure current fixed state. The accumulator remainder differs
  // with refresh rate, so no interpolation fraction may reach the image.
  const registry = loop.interpolated;
  for (let i = 0; i < registry.length; i++) registry[i].apply(1);
  // The ragdoll keeps its own interpolation outside that registry, so it is
  // posed explicitly at the same alpha.
  if (ctx.poseCharacter) ctx.poseCharacter(1);
  renderer.render(scene, camera);

  // Synchronous on purpose: the async toBlob would let another frame land first.
  const dataUrl = renderer.domElement.toDataURL('image/png');

  renderer.setPixelRatio(previousPixelRatio);
  ctx.restoreViewport();
  // Resizing clears the drawing buffer, so leave a coherent final frame behind.
  renderer.render(scene, camera);

  // Said plainly, because the HUD cannot say it: the frame carrying the anchor
  // tick is abandoned by the halt, so the on-screen readout stops a tick or two
  // short. The number below and the filename are the authoritative record.
  console.log(`[capture] anchored at tick ${tick}; halting the loop`);

  post({ name: 'auto', tick, dataUrl, timestamped: false }).catch((error) =>
    console.error(String(error)),
  );

  return HALT;
}

/**
 * "p" takes a manual capture. Guarded against text entry so typing a p into a
 * tuning field does not fire one, and against auto-repeat so holding the key
 * does not flood the dev server.
 */
function installManualHotkey() {
  if (hotkeyInstalled) return;
  hotkeyInstalled = true;

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'KeyP' || event.repeat) return;

    const target = event.target;
    if (target && target.tagName) {
      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;
    }

    manualCapture('manual').catch((error) => console.error(String(error)));
  });
}

/**
 * Manual capture of whatever is currently on the canvas.
 * @param {string} [name]
 * @returns {Promise<{ path: string }>}
 */
export function manualCapture(name = 'manual') {
  if (!ctx) throw new Error('[capture] not initialised');
  const dataUrl = ctx.renderer.domElement.toDataURL('image/png');
  return post({ name, tick: ctx.loop.tick, dataUrl, timestamped: true });
}

async function post(payload) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`[capture] ${response.status} ${(body && body.error) || 'failed'}`);
  }

  console.log('[capture]', body.path);
  return body;
}
