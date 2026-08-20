/**
 * camera-director.js
 * ---------------------------------------------------------------------------
 * The camera system: several rigs, one blender, and the free-look orbit that
 * sits on top of them.
 *
 * Everything here is spherical. A rig produces a PIVOT (a point on the athlete,
 * the ball, or between them) and an orbit — radius, azimuth, polar — and the
 * camera position falls out of that. Spherical coordinates are what make free
 * look well-behaved: azimuth wraps freely, and polar is clamped away from both
 * poles, so there is no orientation at which the up-vector degenerates and the
 * view rolls. That is the gimbal-lock failure, and clamping polar is the whole
 * of the fix.
 *
 * Conventions match THREE.Spherical exactly, so the two are interchangeable:
 *
 *   theta (azimuth) = atan2(x, z)   — 0 looks down +Z, increasing toward +X
 *   phi   (polar)   = acos(y / r)   — 0 is straight up, PI/2 is the horizon
 *
 * theta also matches the athlete's own `facingAngle` convention (forward =
 * (sin a, 0, cos a)), which is what lets the movement basis be read straight
 * off the camera with no conversion.
 *
 * THE THING THAT IS EASY TO GET WRONG: when the camera can rotate, the movement
 * basis has to rotate with it, or "stick up" stops meaning "away from camera"
 * and the controls feel broken the moment you orbit. But a camera whose yaw
 * swings wildly on its own — a broadcast rig panning across a court — must NOT
 * drive the basis, or your controls swing with it while you are just running in
 * a straight line. So each rig publishes a `basisYaw` separately from where the
 * camera actually points: usually its own azimuth, but for fixed rigs, the rig's
 * axis instead.
 *
 * Dependencies: THREE, injected, and only for building the camera object and
 * MathUtils.lerp. Every solver below is pure and runs under test with no engine.
 */

import { adoptTuning } from './rig-math.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const DEFAULT_CAMERA_TUNING = {
  // --- Projection ---------------------------------------------------------
  // Perspective is the default. Orthographic is kept as a toggle because the
  // flat iso read is genuinely useful for judging distances while tuning, but
  // it is no longer what you get on load.
  orthographic:      false,
  fov:               52,
  near:               0.1,
  far:              400,
  orthoZoom:         13,

  // --- Free look ----------------------------------------------------------
  padLookSpeed:       2.7,   // rad/s at full right-stick deflection
  mouseLookSpeed:     0.0026,// rad per pixel of mouse movement
  invertY:          false,
  minPolarDeg:        6,     // how close to straight overhead you may get…
  maxPolarDeg:       84,     // …and to ground level. Clamped away from BOTH
                             // poles: at phi = 0 or PI the azimuth becomes
                             // meaningless and the view rolls — that is the
                             // gimbal-lock case, and this clamp is the fix.

  // --- Auto-recentre ------------------------------------------------------
  autoRecentre:      true,
  recentreDelay:      1.4,   // s of no look input before the camera drifts back
  recentreRate:       1.8,   // rad/s of drift once it starts
  recentreMinSpeed:   2.0,   // m/s — standing still, leave the view alone

  // --- Follow & blending --------------------------------------------------
  positionLerp:      10.0,   // per-second follow rate inside a mode
  targetLerp:        13.0,
  blendTime:          0.60,  // s to cross-fade between modes
  autoAimRate:        1.6,   // rad/s cap on a rig aiming ITSELF (the rally cam
                             // swinging as the ball crosses you). Free look is
                             // deliberately not capped — that must stay 1:1 or
                             // orbiting feels like dragging something heavy —
                             // but an automatic swing has to be slow enough
                             // that the movement basis riding on it doesn't
                             // make you visibly veer mid-stride.
};

/* ===========================================================================
   PURE MATHS
   =========================================================================== */

/**
 * Spherical → cartesian offset, using THREE.Spherical's convention.
 * Returns the offset FROM the pivot TO the camera.
 */
export function sphericalToCartesian(radius, phi, theta) {
  const s = Math.sin(phi) * radius;
  return { x: s * Math.sin(theta), y: Math.cos(phi) * radius, z: s * Math.cos(theta) };
}

/** Signed shortest angular difference a → b, in (-PI, PI]. */
export function shortestAngle(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/** Move `from` toward `to` by at most `maxStep`, the short way round. */
export function approachAngle(from, to, maxStep) {
  const d = shortestAngle(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

/** Smoothstep, so a mode transition eases out of and into rest. */
export function ease(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * Frame-rate independent lerp factor. `rate` is "how much of the remaining gap
 * is closed per second"; naively multiplying by dt makes the camera stiffer at
 * high frame rates and looser at low ones, which is why this is exponential.
 */
export function lerpFactor(rate, dt) {
  return 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));
}

/**
 * How far back a camera must sit to fit a sphere of `radius` in frame.
 *
 * Solved against BOTH axes and the tighter one wins — on a wide window the
 * vertical FOV binds, on a tall one the horizontal does, and picking only one
 * lets the subject slide out of frame at the other aspect ratio.
 */
export function distanceToFit(radius, fovDeg, aspect, margin = 1.15) {
  const r = Math.max(0.01, radius) * Math.max(1, margin);
  const vFov = Math.max(1, fovDeg) * DEG;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.1, aspect));
  return Math.max(r / Math.tan(vFov / 2), r / Math.tan(hFov / 2));
}

/**
 * The bounding sphere of a set of points: centre, and the radius that contains
 * them all. Used by the rally rig to keep the athlete and the ball both in
 * frame without guessing at a distance.
 */
export function boundingSphere(points) {
  const pts = (points || []).filter(Boolean);
  if (!pts.length) return { centre: { x: 0, y: 0, z: 0 }, radius: 0 };
  let cx = 0, cy = 0, cz = 0;
  for (const p of pts) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= pts.length; cy /= pts.length; cz /= pts.length;
  let radius = 0;
  for (const p of pts) radius = Math.max(radius, Math.hypot(p.x - cx, p.y - cy, p.z - cz));
  return { centre: { x: cx, y: cy, z: cz }, radius };
}

/* ===========================================================================
   THE RIGS
   ---------------------------------------------------------------------------
   Each solve(ctx, T, orbit) returns:
     pivot     the point the camera orbits and looks at
     radius    orbit distance
     phi/theta orbit angles, already including any free-look offset
     fov       desired field of view
     basisYaw  the yaw the MOVEMENT basis should use (see the header note)
     freeLook  whether the right stick / mouse drive this rig at all
   =========================================================================== */

export const CAMERA_MODES = [
  {
    id: 'action',
    label: 'Action Cam',
    blurb: 'Trailing third person. Right stick orbits; it drifts back behind you.',
    freeLook: true,
    recentres: true,
    // Defaults the rig returns to when you stop looking around.
    home: { radius: 6.4, polarDeg: 68 },
    solve(ctx, T, orbit) {
      // Pivot is chest height on the athlete, pushed slightly to the right so
      // the athlete does not sit dead centre and block the ball.
      const shoulder = 0.55;
      const px = ctx.player.x + Math.cos(orbit.theta) * shoulder;
      const pz = ctx.player.z - Math.sin(orbit.theta) * shoulder;
      return {
        pivot: { x: px, y: ctx.player.y + 1.15, z: pz },
        radius: orbit.radius,
        phi: orbit.phi,
        theta: orbit.theta,
        fov: T.fov,
        basisYaw: orbit.theta,
      };
    },
  },
  {
    id: 'arena',
    label: 'Arena Cam',
    blurb: 'Wide three-quarter view of the field. Stable basis, no auto-recentre.',
    freeLook: true,
    recentres: false,
    home: { radius: 24, polarDeg: 54.736 },   // 90 - 35.264: the true iso angle
    solve(ctx, T, orbit) {
      return {
        pivot: { x: ctx.player.x, y: ctx.player.y + 1.0, z: ctx.player.z },
        radius: orbit.radius,
        phi: orbit.phi,
        theta: orbit.theta,
        fov: T.fov * 0.72,          // longer lens: less distortion when far out
        basisYaw: orbit.theta,
      };
    },
  },
  {
    id: 'rally',
    label: 'Rally Cam',
    blurb: 'Frames you AND the ball. Sits behind you looking down the play.',
    freeLook: true,
    recentres: true,
    home: { radius: 9, polarDeg: 64 },
    /**
     * Where the rig wants to point on its own. Returned separately from solve()
     * so the director can rate-limit it — this value swings through 180° as the
     * ball crosses you, and an un-damped swing would take the movement basis
     * with it.
     */
    aimYaw(ctx) {
      const ball = ctx.ball;
      if (!ball) return undefined;
      const dx = ball.x - ctx.player.x, dz = ball.z - ctx.player.z;
      if (Math.hypot(dx, dz) < 1.2) return undefined;   // too close to have a bearing
      return Math.atan2(-dx, -dz);                      // opposite the ball
    },
    solve(ctx, T, orbit) {
      const ball = ctx.ball || ctx.player;
      // Bound both subjects, then SOLVE the distance that actually fits them.
      // Guessing a fixed distance is what makes ball cams lose the ball exactly
      // when it matters — on the long shots.
      const sphere = boundingSphere([
        { x: ctx.player.x, y: ctx.player.y + 1.0, z: ctx.player.z },
        ball,
      ]);
      const radius = clamp(
        distanceToFit(sphere.radius + 2.2, T.fov, ctx.aspect || 1.6, 1.12),
        6.5, 34
      );
      // Free look is an OFFSET here, not an override — the rig keeps aiming
      // itself and you nudge it, which is what stops it fighting you.
      const theta = orbit.autoTheta + orbit.lookTheta;
      return {
        pivot: { x: sphere.centre.x, y: sphere.centre.y + 0.4, z: sphere.centre.z },
        radius,
        phi: orbit.phi,
        theta,
        fov: T.fov,
        basisYaw: theta,
      };
    },
  },
  {
    id: 'broadcast',
    label: 'Broadcast',
    blurb: 'Fixed sideline tower that pans and zooms with the play.',
    freeLook: false,
    recentres: false,
    home: { radius: 30, polarDeg: 62 },
    solve(ctx, T, orbit) {
      const ball = ctx.ball || ctx.player;
      const sphere = boundingSphere([
        { x: ctx.player.x, y: ctx.player.y + 1.0, z: ctx.player.z },
        ball,
      ]);
      // A real broadcast camera does not chase — it sits on its tower and pans.
      // The rig tracks the action along ONE axis only, and heavily damped, so
      // the frame reads as a camera operator rather than a drone.
      const rigTheta = orbit.homeTheta;
      const along = { x: Math.cos(rigTheta), z: -Math.sin(rigTheta) };
      const slide = clamp(sphere.centre.x * along.x + sphere.centre.z * along.z, -18, 18);

      const pivot = {
        x: sphere.centre.x, y: sphere.centre.y + 0.8, z: sphere.centre.z,
      };
      const offset = sphericalToCartesian(orbit.radius, orbit.phi, rigTheta);
      // The camera's own position is the tower: fixed, except for the slide.
      const eye = {
        x: along.x * slide + offset.x,
        y: offset.y,
        z: along.z * slide + offset.z,
      };
      // Zoom rather than dolly, exactly as a broadcast lens does.
      const dist = Math.hypot(eye.x - pivot.x, eye.y - pivot.y, eye.z - pivot.z);
      const fov = clamp(2 * Math.atan((sphere.radius + 3.0) / Math.max(1, dist)) / DEG, 18, 62);

      return {
        eye, pivot, fov,
        radius: orbit.radius, phi: orbit.phi, theta: rigTheta,
        // NOT the camera's live yaw: the rig axis. A panning camera driving the
        // movement basis would swing your controls while you ran in a straight
        // line, which is the exact bug this field exists to prevent.
        basisYaw: rigTheta,
      };
    },
  },
];

/* ===========================================================================
   THE DIRECTOR
   =========================================================================== */

/**
 * @param {object}  deps
 * @param {object}  deps.THREE
 * @param {number}  deps.aspect
 * @param {object} [deps.tuning]
 * @param {string} [deps.mode]   starting mode id
 * @param {number} [deps.homeTheta]  default azimuth for every rig (radians)
 * @param {function} [deps.onModeChange] (mode, previous) for HUD/toast
 */
export function createCameraDirector({ THREE, aspect, tuning, mode, homeTheta, onModeChange }) {
  // ADOPTED, not copied — see `adoptTuning`. Field of view, follow rates and
  // look speeds are all live controls.
  const T = adoptTuning(tuning, DEFAULT_CAMERA_TUNING);
  const modes = CAMERA_MODES;
  const HOME_THETA = homeTheta === undefined ? 45 * DEG : homeTheta;

  let index = Math.max(0, modes.findIndex((m) => m.id === (mode || 'action')));
  let camera = null;
  let currentAspect = aspect || 1.6;

  // Per-mode orbit state, so cycling back to a rig restores how you left it.
  const orbits = modes.map((m) => ({
    radius: m.home.radius,
    phi: m.home.polarDeg * DEG,
    theta: HOME_THETA,
    lookTheta: 0,      // free-look offset, used by rigs that aim themselves
    autoTheta: HOME_THETA,  // the rig's own aim, rate-limited by the director
    homeTheta: HOME_THETA,
  }));

  // Live camera state. `pos`/`target`/`fov` are what the camera actually uses;
  // the rig produces a goal each frame and these chase it.
  const pos = { x: 0, y: 0, z: 0 };
  const target = { x: 0, y: 0, z: 0 };
  let fov = T.fov;
  let basisYaw = HOME_THETA;
  let started = false;

  // Blend bookkeeping.
  let blendT = 1;                 // 1 = settled
  const blendFrom = {
    pos: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 },
    fov: T.fov, basisYaw: HOME_THETA,
  };

  let sinceLook = 99;             // s since the player last moved the view

  const state = {
    modeId: modes[index].id,
    modeLabel: modes[index].label,
    modeIndex: index,
    blending: false,
    blend: 1,
    freeLook: modes[index].freeLook,
    azimuthDeg: HOME_THETA / DEG,
    polarDeg: modes[index].home.polarDeg,
    radius: modes[index].home.radius,
    fov: T.fov,
    basisYaw: HOME_THETA,
    recentring: false,
  };

  function buildCamera() {
    const prev = camera;
    if (T.orthographic) {
      const h = T.orthoZoom;
      camera = new THREE.OrthographicCamera(
        -h * currentAspect, h * currentAspect, h, -h, T.near, T.far);
    } else {
      camera = new THREE.PerspectiveCamera(T.fov, currentAspect, T.near, T.far);
    }
    if (prev && prev.position && camera.position) {
      camera.position.copy(prev.position);
    }
    applyToCamera();
    return camera;
  }

  function setAspect(a) {
    currentAspect = a || currentAspect;
    if (!camera) return;
    if (camera.isOrthographicCamera) {
      const h = T.orthoZoom;
      camera.left = -h * currentAspect; camera.right = h * currentAspect;
      camera.top = h; camera.bottom = -h;
    } else {
      camera.aspect = currentAspect;
    }
    camera.updateProjectionMatrix && camera.updateProjectionMatrix();
  }

  /**
   * Feed raw look input. dx/dy are already sensitivity-scaled by the caller.
   *
   * The finite guards are not paranoia: these come straight off DOM events and
   * gamepad axes, and a single NaN here is unrecoverable — it propagates into
   * the orbit, then the camera matrix, and the screen goes black with nothing
   * in the console to explain it. clamp() will not save you, because every
   * comparison against NaN is false, so NaN passes a range check unharmed.
   */
  function look(dx, dy) {
    const m = modes[index];
    if (!m.freeLook) return false;
    const ax = Number.isFinite(dx) ? dx : 0;
    const ay = Number.isFinite(dy) ? dy : 0;
    if (!ax && !ay) return false;
    const o = orbits[index];
    const dPhi = (T.invertY ? -ay : ay);

    o.theta -= ax;
    o.lookTheta -= ax;
    o.phi = clamp(o.phi + dPhi, T.minPolarDeg * DEG, T.maxPolarDeg * DEG);
    sinceLook = 0;
    return true;
  }

  /** Zoom the current rig in or out. Each rig keeps its own radius. */
  function zoom(delta) {
    const o = orbits[index];
    const d = Number.isFinite(delta) ? clamp(delta, -4, 4) : 0;
    o.radius = clamp(o.radius * Math.exp(d), 2.0, 60);
    return o.radius;
  }

  function setMode(id, silent) {
    const next = modes.findIndex((m) => m.id === id);
    if (next < 0 || next === index) return false;
    const from = modes[index];
    index = next;
    // Snapshot where the camera IS, then ease from there to wherever the new
    // rig wants to be. Without the snapshot the camera teleports, which in a
    // first-person-ish view is genuinely disorienting.
    blendFrom.pos.x = pos.x; blendFrom.pos.y = pos.y; blendFrom.pos.z = pos.z;
    blendFrom.target.x = target.x; blendFrom.target.y = target.y; blendFrom.target.z = target.z;
    blendFrom.fov = fov;
    blendFrom.basisYaw = basisYaw;
    blendT = started ? 0 : 1;
    sinceLook = 0;
    state.modeId = modes[index].id;
    state.modeLabel = modes[index].label;
    state.modeIndex = index;
    state.freeLook = modes[index].freeLook;
    if (onModeChange) onModeChange(modes[index], from);
    return true;
  }

  /** Cycle modes. +1 = next, -1 = previous; wraps both ways. */
  function cycle(dir) {
    const step = (dir || 0) < 0 ? -1 : 1;
    const next = (index + step + modes.length) % modes.length;
    return setMode(modes[next].id);
  }

  function applyToCamera() {
    if (!camera) return;
    camera.position.set(pos.x, pos.y, pos.z);
    camera.lookAt(target.x, target.y, target.z);
    if (!camera.isOrthographicCamera && camera.fov !== undefined
        && Math.abs(camera.fov - fov) > 1e-4) {
      camera.fov = fov;
      camera.updateProjectionMatrix && camera.updateProjectionMatrix();
    }
  }

  /**
   * @param {number} dt
   * @param {object} ctx
   * @param {object} ctx.player   world position of the athlete's root body
   * @param {object} [ctx.ball]
   * @param {number} [ctx.speed]  athlete's horizontal speed, for auto-recentre
   * @param {number} [ctx.travelYaw] direction of travel; the recentre target
   * @param {number} [ctx.aspect]
   */
  function update(step, context) {
    const m = modes[index];
    const o = orbits[index];
    const dt = Number.isFinite(step) ? clamp(step, 0, 0.5) : 0;
    const ctx = context || {};
    if (!ctx.player) ctx.player = { x: 0, y: 0, z: 0 };
    if (ctx.aspect && Number.isFinite(ctx.aspect)) currentAspect = ctx.aspect;

    sinceLook += dt;

    // --- Auto-recentre ----------------------------------------------------
    // Only while actually moving: drifting the view while the player stands
    // still and reads the field is the camera taking control away for no reason.
    // AND only if they are generally running FORWARD. If they run sideways (strafing)
    // or backwards, sweeping the camera behind them causes a feedback loop where
    // the controls rotate out from under them (moving in a circle).
    const behind = (ctx.travelYaw !== undefined) ? ctx.travelYaw + Math.PI : 0;
    const wantsRecentre = T.autoRecentre && m.recentres
      && sinceLook > T.recentreDelay
      && (ctx.speed || 0) > T.recentreMinSpeed
      && ctx.travelYaw !== undefined
      && Math.abs(shortestAngle(o.theta, behind)) < (Math.PI / 3);

    state.recentring = !!wantsRecentre;
    if (wantsRecentre) {
      // Behind the athlete: the camera sits opposite the direction of travel.
      o.theta = approachAngle(o.theta, behind, T.recentreRate * dt);
      o.lookTheta = approachAngle(o.lookTheta, 0, T.recentreRate * dt);
      o.phi += (m.home.polarDeg * DEG - o.phi) * lerpFactor(T.recentreRate, dt);
    }

    // --- Let a self-aiming rig turn, but only so fast ---------------------
    const fullCtx = Object.assign({ aspect: currentAspect }, ctx);
    if (m.aimYaw) {
      const aim = m.aimYaw(fullCtx);
      if (aim !== undefined) o.autoTheta = approachAngle(o.autoTheta, aim, T.autoAimRate * dt);
    }

    // --- Solve the rig ----------------------------------------------------
    const solved = m.solve(fullCtx, T, {
      radius: o.radius, phi: o.phi, theta: o.theta,
      lookTheta: o.lookTheta, autoTheta: o.autoTheta, homeTheta: o.homeTheta,
    });

    const goalTarget = solved.pivot;
    const goalPos = solved.eye || (() => {
      const off = sphericalToCartesian(solved.radius, solved.phi, solved.theta);
      return { x: goalTarget.x + off.x, y: goalTarget.y + off.y, z: goalTarget.z + off.z };
    })();

    if (!started) {
      // First frame: sit exactly where the rig asks, or the camera flies in
      // from the origin.
      pos.x = goalPos.x; pos.y = goalPos.y; pos.z = goalPos.z;
      target.x = goalTarget.x; target.y = goalTarget.y; target.z = goalTarget.z;
      fov = solved.fov;
      basisYaw = solved.basisYaw;
      started = true;
      blendT = 1;
    } else if (blendT < 1) {
      // --- Mode transition: ease from the snapshot to the (moving) goal ----
      blendT = Math.min(1, blendT + dt / Math.max(0.01, T.blendTime));
      const k = ease(blendT);
      const L = THREE.MathUtils.lerp;
      pos.x = L(blendFrom.pos.x, goalPos.x, k);
      pos.y = L(blendFrom.pos.y, goalPos.y, k);
      pos.z = L(blendFrom.pos.z, goalPos.z, k);
      target.x = L(blendFrom.target.x, goalTarget.x, k);
      target.y = L(blendFrom.target.y, goalTarget.y, k);
      target.z = L(blendFrom.target.z, goalTarget.z, k);
      fov = L(blendFrom.fov, solved.fov, k);
      // The basis rides the SAME easing curve as the camera. Anything else and
      // there is a window mid-transition where the controls point somewhere the
      // camera isn't — worse than a hard snap, because it is invisible.
      basisYaw = blendFrom.basisYaw
        + shortestAngle(blendFrom.basisYaw, solved.basisYaw) * k;
    } else {
      // --- Settled: ordinary exponential follow ---------------------------
      const kp = lerpFactor(T.positionLerp, dt);
      const kt = lerpFactor(T.targetLerp, dt);
      const L = THREE.MathUtils.lerp;
      pos.x = L(pos.x, goalPos.x, kp);
      pos.y = L(pos.y, goalPos.y, kp);
      pos.z = L(pos.z, goalPos.z, kp);
      target.x = L(target.x, goalTarget.x, kt);
      target.y = L(target.y, goalTarget.y, kt);
      target.z = L(target.z, goalTarget.z, kt);
      fov = L(fov, solved.fov, kt);
      // Settled: track the rig exactly. Free look must be 1:1 — the rate limit
      // that matters was already applied to the rig's own aim, above.
      basisYaw = solved.basisYaw;
    }

    applyToCamera();

    state.blend = blendT;
    state.blending = blendT < 1;
    state.azimuthDeg = ((solved.theta / DEG) % 360 + 360) % 360;
    state.polarDeg = solved.phi / DEG;
    state.radius = solved.radius;
    state.fov = fov;
    state.basisYaw = basisYaw;
    return state;
  }

  /** Drop the camera exactly where the rig wants it, with no fly-in. */
  function snap() { started = false; blendT = 1; }

  function reset() {
    modes.forEach((m, i) => {
      orbits[i].radius = m.home.radius;
      orbits[i].phi = m.home.polarDeg * DEG;
      orbits[i].theta = HOME_THETA;
      orbits[i].lookTheta = 0;
      orbits[i].autoTheta = HOME_THETA;
    });
    snap();
  }

  buildCamera();

  return {
    tuning: T, modes, state,
    update, look, zoom, cycle, setMode, setAspect, snap, reset,
    rebuild: buildCamera,
    get camera() { return camera; },
    get mode() { return modes[index]; },
    get orbit() { return orbits[index]; },
    /** The yaw the movement basis should be built from, this frame. */
    get basisYaw() { return basisYaw; },
  };
}
