/**
 * Offline verification of athlete-input.js.
 * Focus: the camera-basis maths (stick-up must always mean "away from the
 * camera", at whatever yaw it is sitting), deadzone behaviour, edge-triggered
 * buttons, right-stick and mouse look, and the gamepad/keyboard merge.
 */
import {
  createAthleteInput, cameraBasisFromYaw, writeCameraBasis, applyDeadzone,
  BUTTONS, DEFAULT_INPUT_TUNING,
} from './athlete-input.js';

let pass = 0, fail = 0;
const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const D = Math.PI / 180;
const T = DEFAULT_INPUT_TUNING;
const ISO = cameraBasisFromYaw(45 * D);

function pad(o = {}) {
  const buttons = new Array(16).fill(0).map(() => ({ pressed: false, value: 0 }));
  for (const [i, v] of Object.entries(o.buttons || {})) {
    buttons[i] = typeof v === 'number' ? { pressed: v > 0.5, value: v } : { pressed: !!v, value: v ? 1 : 0 };
  }
  return { id: 'mock pad', connected: true, axes: o.axes || [0, 0, 0, 0], buttons };
}
const make = (padState, keys = new Set(), tuning, mouse) => {
  const holder = { pad: padState };
  const m = mouse || { dx: 0, dy: 0 };
  const input = createAthleteInput({ getGamepads: () => [holder.pad], keys, tuning, mouse: m });
  return { input, holder, keys, mouse: m };
};

// ---------------------------------------------------------------------------
console.log('\n1. Fixed camera basis');
{
  const b = cameraBasisFromYaw(0);
  check('yaw 0: screen-up is -Z', approx(b.forwardX, 0) && approx(b.forwardZ, -1),
    `(${b.forwardX.toFixed(3)}, ${b.forwardZ.toFixed(3)})`);
  check('yaw 0: screen-right is +X', approx(b.rightX, 1) && approx(b.rightZ, 0),
    `(${b.rightX.toFixed(3)}, ${b.rightZ.toFixed(3)})`);
}
{
  const b = cameraBasisFromYaw(45 * D);
  check('forward and right stay perpendicular',
    approx(b.forwardX * b.rightX + b.forwardZ * b.rightZ, 0, 1e-12));
  check('both basis vectors stay unit length',
    approx(Math.hypot(b.forwardX, b.forwardZ), 1, 1e-12) &&
    approx(Math.hypot(b.rightX, b.rightZ), 1, 1e-12));
  check('45° iso forward points into -X/-Z',
    b.forwardX < 0 && b.forwardZ < 0, `(${b.forwardX.toFixed(3)}, ${b.forwardZ.toFixed(3)})`);
}
{
  let bad = 0;
  for (let deg = 0; deg < 360; deg += 7) {
    const b = cameraBasisFromYaw(deg * D);
    if (Math.abs(b.forwardX * b.rightX + b.forwardZ * b.rightZ) > 1e-12) bad++;
    if (Math.abs(Math.hypot(b.forwardX, b.forwardZ) - 1) > 1e-12) bad++;
  }
  check('basis is orthonormal at every yaw', bad === 0, `${bad} failures`);
}

// ---------------------------------------------------------------------------
console.log('\n2. Deadzone');
{
  const z = applyDeadzone(0.1, 0.1, T.deadzone, T.stickCurve);
  check('inside the deadzone reads as centred', z.magnitude === 0 && z.x === 0 && z.y === 0);
}
{
  const z = applyDeadzone(1, 0, T.deadzone, T.stickCurve);
  check('full deflection reaches magnitude 1', approx(z.magnitude, 1, 1e-9), `${z.magnitude}`);
}
{
  // Direction must survive the rescale — this is what stops diagonal drift.
  const z = applyDeadzone(0.6, 0.8, T.deadzone, T.stickCurve);
  const ratioIn = 0.6 / 0.8, ratioOut = z.x / z.y;
  check('deadzone preserves stick direction', approx(ratioIn, ratioOut, 1e-9),
    `${ratioIn.toFixed(6)} vs ${ratioOut.toFixed(6)}`);
}
{
  const z = applyDeadzone(2, 2, T.deadzone, T.stickCurve);
  check('over-range input is clamped to 1', z.magnitude <= 1 + 1e-9, `${z.magnitude}`);
}
{
  let last = -1, monotonic = true;
  for (let m = T.deadzone + 0.01; m <= 1; m += 0.02) {
    const z = applyDeadzone(m, 0, T.deadzone, T.stickCurve);
    if (z.magnitude < last) monotonic = false;
    last = z.magnitude;
  }
  check('magnitude rises monotonically past the deadzone', monotonic);
}
{
  const z = applyDeadzone(0, 0, T.deadzone, T.stickCurve);
  check('exactly centred is safe (no divide by zero)',
    z.magnitude === 0 && isFinite(z.x) && isFinite(z.y));
}

// ---------------------------------------------------------------------------
console.log('\n3. Stick → world direction against the fixed camera');
{
  // Stick up (axis Y = -1) must move AWAY from the camera, i.e. along forward.
  const { input } = make(pad({ axes: [0, -1] }));
  const s = input.sample(ISO);
  check('stick up maps to camera-forward',
    approx(s.moveX, ISO.forwardX, 1e-9) && approx(s.moveZ, ISO.forwardZ, 1e-9),
    `(${s.moveX.toFixed(3)}, ${s.moveZ.toFixed(3)})`);
}
{
  const { input } = make(pad({ axes: [1, 0] }));
  const s = input.sample(ISO);
  check('stick right maps to camera-right',
    approx(s.moveX, ISO.rightX, 1e-9) && approx(s.moveZ, ISO.rightZ, 1e-9),
    `(${s.moveX.toFixed(3)}, ${s.moveZ.toFixed(3)})`);
}
{
  const { input } = make(pad({ axes: [0, 1] }));
  const s = input.sample(ISO);
  check('stick down is the exact opposite of stick up',
    approx(s.moveX, -ISO.forwardX, 1e-9) && approx(s.moveZ, -ISO.forwardZ, 1e-9));
}
{
  // The whole point of a static camera: screen-up never changes meaning.
  const { input, holder } = make(pad({ axes: [0, -1] }));
  const a = input.sample(ISO);
  const first = { x: a.moveX, z: a.moveZ };
  holder.pad = pad({ axes: [0, -1] });
  const b = input.sample(ISO);
  check('stick up means the same world direction every sample',
    approx(b.moveX, first.x, 1e-12) && approx(b.moveZ, first.z, 1e-12));
}
{
  const r = Math.SQRT1_2;                       // a true unit diagonal deflection
  const { input } = make(pad({ axes: [r, -r] }));
  const s = input.sample(ISO);
  check('full diagonal deflection stays unit-length in world space',
    approx(Math.hypot(s.moveX, s.moveZ), 1, 1e-6), `${Math.hypot(s.moveX, s.moveZ).toFixed(6)}`);
}
{
  // Analog pressure must survive to the caller, or half-stick runs full speed.
  const { input } = make(pad({ axes: [0, -0.6] }));
  const s = input.sample(ISO);
  check('partial deflection reports a partial magnitude',
    s.magnitude > 0 && s.magnitude < 0.85, `magnitude=${s.magnitude.toFixed(3)}`);
  check('but the heading is still a usable direction',
    Math.hypot(s.moveX, s.moveZ) > 0, `|move|=${Math.hypot(s.moveX, s.moveZ).toFixed(3)}`);
}
{
  const { input } = make(pad({ axes: [0.05, -0.05] }));
  const s = input.sample(ISO);
  check('drift inside the deadzone produces no movement',
    s.moveX === 0 && s.moveZ === 0 && s.magnitude === 0);
}

// ---------------------------------------------------------------------------
console.log('\n4. Buttons and edge triggering');
{
  const { input, holder } = make(pad({ buttons: { [BUTTONS.A]: true } }));
  let s = input.sample(ISO);
  check('A press is edge-triggered on the first frame', s.jumpPressed && s.jumpHeld);
  s = input.sample(ISO);
  check('held A does not re-trigger', !s.jumpPressed && s.jumpHeld);
  holder.pad = pad({});
  s = input.sample(ISO);
  check('released A clears held', !s.jumpHeld && !s.jumpPressed);
  holder.pad = pad({ buttons: { [BUTTONS.A]: true } });
  s = input.sample(ISO);
  check('re-pressing A triggers again', s.jumpPressed);
}
{
  // Sprint is the LEFT trigger; the RIGHT trigger is the slide.
  const { input } = make(pad({ buttons: { [BUTTONS.LT]: 0.9 } }));
  const s = input.sample(ISO);
  check('analog LEFT trigger sprints', s.sprint);
  check('and does not also start a slide', !s.slideHeld);
  const { input: i2 } = make(pad({ buttons: { [BUTTONS.LT]: 0.2 } }));
  check('a lightly-pressed trigger does not sprint', !i2.sample(ISO).sprint);
  // The bumpers used to alias sprint and slide. They are the camera cycle now,
  // and one button doing two jobs is how a rebind turns into a bug report.
  const { input: i3 } = make(pad({ buttons: { [BUTTONS.LB]: true } }));
  const s3 = i3.sample(ISO);
  check('the left bumper no longer sprints', !s3.sprint);
  check('it cycles the camera backwards instead', s3.camPrevPressed);
}
{
  const { input } = make(pad({ buttons: { [BUTTONS.RT]: 0.9 } }));
  const s = input.sample(ISO);
  check('analog RIGHT trigger slides', s.slideHeld);
  check('slide is edge-detected on the first frame', s.slidePressed);
  check('and does not also sprint', !s.sprint);
  check('held slide stops reporting a fresh press', !input.sample(ISO).slidePressed);
  const { input: i4 } = make(pad({ buttons: { [BUTTONS.RB]: true } }));
  const s4 = i4.sample(ISO);
  check('the right bumper no longer slides', !s4.slideHeld);
  check('it cycles the camera forwards instead', s4.camNextPressed);
}
{
  // Face cluster is indexed by POSITION. South is A, not B — the exact thing
  // that made the original binding spec ambiguous.
  check('SOUTH is index 0 and equals A', BUTTONS.SOUTH === 0 && BUTTONS.A === 0);
  check('EAST is index 1 and equals B', BUTTONS.EAST === 1 && BUTTONS.B === 1);
  check('WEST is index 2 and equals X', BUTTONS.WEST === 2 && BUTTONS.X === 2);
  check('NORTH is index 3 and equals Y', BUTTONS.NORTH === 3 && BUTTONS.Y === 3);
}
{
  const { input } = make(pad({ buttons: { [BUTTONS.EAST]: true } }));
  const s = input.sample(ISO);
  check('EAST/B is the underhand volley', s.volleyPressed);
  check('and does not fire jump', !s.jumpPressed);
  check('volley is edge-triggered', !input.sample(ISO).volleyPressed);
}
{
  const { input } = make(pad({ buttons: { [BUTTONS.NORTH]: true } }));
  check('NORTH/Y is the overhand spike', input.sample(ISO).spikePressed);
}
{
  const { input } = make(pad({ buttons: { [BUTTONS.WEST]: true } }));
  check('WEST/X is the dive', input.sample(ISO).divePressed);
}
{
  const { input } = make(pad({ buttons: { [BUTTONS.SOUTH]: true } }));
  const s = input.sample(ISO);
  check('SOUTH/A is still jump', s.jumpPressed);
  check('and does not fire the volley', !s.volleyPressed);
}
{
  const { input } = make(pad({ buttons: { [BUTTONS.BACK]: true } }));
  check('BACK is the debug knockdown', input.sample(ISO).knockPressed);
  check('and is edge-triggered', !input.sample(ISO).knockPressed);
}
{
  const { input } = make(pad({ buttons: { [BUTTONS.LEFT]: true } }));
  const s = input.sample(ISO);
  check('d-pad left produces movement', Math.hypot(s.moveX, s.moveZ) > 0.9);
  check('d-pad reads as full deflection', approx(s.magnitude, 1));
}

// ---------------------------------------------------------------------------
console.log('\n5. Keyboard, and merging with the pad');
{
  const keys = new Set(['KeyW']);
  const { input } = make(null, keys);
  const s = input.sample(ISO);
  check('W maps to camera-forward',
    approx(s.moveX, ISO.forwardX, 1e-9) && approx(s.moveZ, ISO.forwardZ, 1e-9));
  check('source is reported as keyboard', s.source === 'keyboard', s.source);
}
{
  const keys = new Set(['KeyW', 'KeyD']);
  const { input } = make(null, keys);
  const s = input.sample(ISO);
  check('diagonal keys stay unit-length', approx(Math.hypot(s.moveX, s.moveZ), 1, 1e-9),
    `${Math.hypot(s.moveX, s.moveZ).toFixed(6)}`);
}
{
  const keys = new Set(['Space']);
  const { input } = make(null, keys);
  check('Space jumps', input.sample(ISO).jumpPressed);
  check('and is edge-triggered', !input.sample(ISO).jumpPressed);
}
{
  const keys = new Set(['ShiftLeft']);
  const { input } = make(null, keys);
  check('Shift sprints', input.sample(ISO).sprint);
}
{
  const { input } = make(null, new Set(['KeyP']));
  check('P knocks down', input.sample(ISO).knockPressed);
}
{
  const { input } = make(null, new Set(['KeyC']));
  const s = input.sample(ISO);
  check('C slides', s.slideHeld && s.slidePressed);
}
{
  const { input } = make(null, new Set(['KeyJ']));
  check('J is the volley', input.sample(ISO).volleyPressed);
  const { input: i2 } = make(null, new Set(['KeyK']));
  check('K is the spike', i2.sample(ISO).spikePressed);
  const { input: i3 } = make(null, new Set(['KeyL']));
  check('L is the dive', i3.sample(ISO).divePressed);
}
{
  // Bindings are data, so a rebind must not need a code change.
  const keys = new Set(['KeyZ']);
  const input = createAthleteInput({ keys, bindings: { volley: { pad: 1, keys: ['KeyZ'] } } });
  check('bindings can be overridden', input.sample(ISO).volleyPressed);
}
{
  // With no pad connected the module must still work.
  const { input } = make(null, new Set(['KeyW']));
  check('no gamepad connected is fine', !input.connected);
  check('keyboard still drives movement', Math.hypot(input.sample(ISO).moveX, input.sample(ISO).moveZ) > 0.9);
}
{
  const keys = new Set(['KeyW']);
  const { input } = make(pad({ axes: [0, -1] }), keys);
  const s = input.sample(ISO);
  check('both sources at once is reported', s.source === 'both', s.source);
  check('and does not double the movement vector',
    approx(Math.hypot(s.moveX, s.moveZ), 1, 1e-9), `${Math.hypot(s.moveX, s.moveZ).toFixed(4)}`);
}
{
  const keys = new Set(['KeyW', 'ShiftLeft']);
  const { input } = make(null, keys);
  input.sample(ISO);
  input.clear();
  const s = input.sample(ISO);
  check('clear() releases everything (window blur)',
    s.moveX === 0 && s.moveZ === 0 && !s.sprint && !s.jumpHeld &&
    !s.slideHeld && !s.volleyPressed && !s.divePressed);
}

// ---------------------------------------------------------------------------
console.log('\n5b. Free look: right stick and mouse');
{
  const { input } = make(pad({ axes: [0, 0, 0.8, -0.6] }));
  const s = input.sample(ISO);
  check('the right stick is axes 2 and 3', s.lookX > 0 && s.lookY < 0,
    `${s.lookX.toFixed(2)}, ${s.lookY.toFixed(2)}`);
  check('and reports a magnitude', s.lookMagnitude > 0.5, `${s.lookMagnitude}`);
  check('while leaving movement alone', s.moveX === 0 && s.moveZ === 0);
}
{
  const { input } = make(pad({ axes: [0.9, 0.9, 0, 0] }));
  const s = input.sample(ISO);
  check('the LEFT stick does not leak into look', s.lookMagnitude === 0);
  check('and still drives movement', Math.hypot(s.moveX, s.moveZ) > 0.5);
}
{
  // The look stick needs a smaller deadzone than movement: a stray flick of the
  // view costs far less than a stray step, and fine aim lives near the centre.
  check('look deadzone is tighter than the movement deadzone',
    DEFAULT_INPUT_TUNING.lookDeadzone < DEFAULT_INPUT_TUNING.deadzone,
    `${DEFAULT_INPUT_TUNING.lookDeadzone} vs ${DEFAULT_INPUT_TUNING.deadzone}`);
  const nudge = DEFAULT_INPUT_TUNING.lookDeadzone + 0.03;
  const { input } = make(pad({ axes: [nudge, 0, nudge, 0] }));
  const s = input.sample(ISO);
  check('a nudge past the look deadzone registers as look', s.lookMagnitude > 0);
  check('but the same nudge is still inside the movement deadzone',
    Math.hypot(s.moveX, s.moveZ) === 0);
}
{
  const { input } = make(pad({ axes: [0, 0, 0.05, 0.05] }));
  check('a resting look stick reads as zero', input.sample(ISO).lookMagnitude === 0);
}
{
  const { input, mouse } = make(null);
  mouse.dx = 40; mouse.dy = -12;
  const s = input.sample(ISO);
  check('mouse deltas come through', s.mouseLookX === 40 && s.mouseLookY === -12,
    `${s.mouseLookX}, ${s.mouseLookY}`);
  check('and the accumulator is drained', mouse.dx === 0 && mouse.dy === 0);
  const s2 = input.sample(ISO);
  check('so the same motion is never applied twice',
    s2.mouseLookX === 0 && s2.mouseLookY === 0);
}
{
  // Several mousemove events inside one frame must all count. Reading "the
  // latest delta" instead of accumulating silently drops most of a fast flick.
  const { input, mouse } = make(null);
  for (let i = 0; i < 8; i++) mouse.dx += 5;
  check('deltas accumulate between samples', input.sample(ISO).mouseLookX === 40);
}
{
  const { input, mouse } = make(pad({ axes: [0, 0, 0, 0.7] }), new Set(), { lookInvertY: true });
  mouse.dy = 10;
  const s = input.sample(ISO);
  check('invert Y flips the stick', s.lookY < 0, `${s.lookY}`);
  check('and the mouse too, so the two never disagree', s.mouseLookY < 0, `${s.mouseLookY}`);
}
{
  const { input, mouse } = make(pad({ axes: [0, 0, 0.9, 0.9] }));
  mouse.dx = 30;
  input.clear();
  const s = input.state;
  check('clear() drops look state as well', s.lookX === 0 && s.mouseLookX === 0);
  check('and empties the mouse accumulator', mouse.dx === 0 && mouse.dy === 0);
}
{
  const { input } = make(null);
  const s = input.sample(ISO);
  check('no pad means no look input', s.lookMagnitude === 0 && s.lookX === 0);
  const { input: i2 } = make({ id: 'x', connected: true, axes: [0.5, 0.5], buttons: [] });
  check('a pad with only two axes does not produce NaN look',
    Number.isFinite(i2.sample(ISO).lookX) && i2.sample(ISO).lookMagnitude === 0);
}

// ---------------------------------------------------------------------------
console.log('\n5c. writeCameraBasis, the per-frame path');
{
  const out = { forwardX: 0, forwardZ: 0, rightX: 0, rightZ: 0 };
  for (const yaw of [0, 0.7, -2.2, 3.9]) {
    const fresh = cameraBasisFromYaw(yaw);
    writeCameraBasis(out, yaw);
    if (out.forwardX !== fresh.forwardX || out.forwardZ !== fresh.forwardZ
        || out.rightX !== fresh.rightX || out.rightZ !== fresh.rightZ) {
      check(`writeCameraBasis matches at yaw ${yaw}`, false, JSON.stringify(out));
    }
  }
  check('writeCameraBasis agrees with cameraBasisFromYaw at every yaw', true);
  const same = writeCameraBasis(out, 1.0);
  check('and writes in place rather than allocating', same === out);
}

// ---------------------------------------------------------------------------
console.log('\n6. Robustness');
{
  const input = createAthleteInput({});
  let threw = false;
  try { input.sample(ISO); input.sample(); } catch (e) { threw = true; }
  check('works with no deps injected at all', !threw);
}
{
  const input = createAthleteInput({ getGamepads: () => [null, undefined, null] });
  let threw = false;
  try { input.sample(ISO); } catch (e) { threw = true; }
  check('null entries in the gamepad list are skipped', !threw);
}
{
  const input = createAthleteInput({ getGamepads: () => [{ connected: true, axes: [], buttons: [] }] });
  let threw = false, s;
  try { s = input.sample(ISO); } catch (e) { threw = true; }
  check('a pad with no axes or buttons is tolerated', !threw && s.magnitude === 0);
}
{
  const input = createAthleteInput({ getGamepads: () => [{ connected: true, axes: [NaN, NaN], buttons: [] }] });
  const s = input.sample(ISO);
  check('NaN axes do not leak into the move vector',
    isFinite(s.moveX) && isFinite(s.moveZ), `(${s.moveX}, ${s.moveZ})`);
}
{
  const { input } = make(pad({ axes: [0.5, -0.5] }), new Set(), { gamepadIndex: 3 });
  const s = input.sample(ISO);
  check('an out-of-range gamepadIndex reads as no pad', s.magnitude === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
