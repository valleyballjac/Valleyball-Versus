/**
 * Module: ui/hudOverlay
 * Role: Diagnostic telemetry HUD overlay (`#hud`) formatting loop timing, motor/ragdoll state, animation blend shares, ball physics, strike windows, and match clock/score.
 * Frame Phase: Render (Post-Frame Readout, gated by `TUNING.debug.showHud`).
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): Purely reads simulation and loop probes (`ballProbe`, `strikeProbe`, `matchProbe`); never mutates simulation state.
 *   - LAW 8 (60 FPS Frame-Time Budget): Caches all 31 HUD DOM element references at module load and skips all work when `TUNING.debug.showHud` is false.
 */

import { TUNING } from '../config/tuning.js';
import { horizontalSpeed } from '../sim/motor.js';
import { ballProbe } from '../sim/ball.js';
import { strikeProbe } from '../mechanics/strikes.js';
import { getInputSlot } from '../input/inputRouter.js';

const hud = document.getElementById('hud');
const hudTick = document.getElementById('hud-tick');
const hudAlpha = document.getElementById('hud-alpha');
const hudSteps = document.getElementById('hud-steps');
const hudFrameTime = document.getElementById('hud-frametime');
const hudDisplayHz = document.getElementById('hud-displayhz');
const hudDrift = document.getElementById('hud-drift');
const hudSpeed = document.getElementById('hud-speed');
const hudGrounded = document.getElementById('hud-grounded');
const hudWeight = document.getElementById('hud-weight');
const hudAnimSpeed = document.getElementById('hud-animspeed');
const hudBlend = document.getElementById('hud-blend');
const hudDirection = document.getElementById('hud-direction');
const hudBackNode = document.getElementById('hud-backnode');
const hudLocalVel = document.getElementById('hud-localvel');
const hudSprint = document.getElementById('hud-sprint');
const hudAirborne = document.getElementById('hud-airborne');
const hudImpact = document.getElementById('hud-impact');
const hudStandUp = document.getElementById('hud-standup');
const hudBall = document.getElementById('hud-ball');
const hudBallTouch = document.getElementById('hud-balltouch');
const hudBallPeak = document.getElementById('hud-ballpeak');
const hudStrike = document.getElementById('hud-strike');
const hudStrikeHit = document.getElementById('hud-strikehit');
const hudStrikeRate = document.getElementById('hud-strikerate');
const hudCamMode = document.getElementById('hud-cammode');
const hudScore = document.getElementById('hud-score');
const hudDrag = document.getElementById('hud-drag');
const hudLoco = document.getElementById('hud-loco');
const hudArm = document.getElementById('hud-arm');
const hudAction = document.getElementById('hud-action');
const hudShares = document.getElementById('hud-shares');

/**
 * Toggles `#hud` DOM visibility. Called at boot and from debug GUI/hotkeys, never per-frame.
 *
 * @param {boolean} visible
 */
export function setHudVisible(visible) {
  if (hud) {
    hud.style.display = visible ? '' : 'none';
  }
}

/**
 * Formats the strike window, last contact, and hit-rate strings for the HUD.
 *
 * @param {object} st Output of `strikeProbe(strikeState)`
 * @param {number} tick Current simulation tick
 * @returns {{ strikeText: string, hitText: string, rateText: string }}
 */
export function formatStrikeHud(st, tick) {
  if (!st) {
    return { strikeText: '—', hitText: '—', rateText: '0 / 0' };
  }
  const row = st.kind === 'spike'
    ? TUNING.strike.spike
    : (st.kind === 'kick' ? TUNING.strike.kick : TUNING.strike.volley);
  const since = tick - st.lastStrikeTick;
  const open = Number.isFinite(since) && since >= row.windowOpen && since <= row.windowClose;
  const strikeText = st.lastStrikeTick === -Infinity
    ? '—'
    : `${st.kind}${st.kind === 'spike' ? (st.side >= 0 ? ' R' : ' L') : ''} ` +
      `ph ${st.phase.toFixed(2)} mix ${st.mix.toFixed(2)} ` +
      `w ${Number.isFinite(since) ? since : '—'}${open ? ' OPEN' : ''}`;
  const hitText = st.lastContactKey
    ? `${st.lastContactKey} @${st.lastContactTick} q ${st.lastContactQuality.toFixed(2)} ` +
      `${st.lastContactForce.toFixed(0)} N -> ${st.lastLaunchSpeed.toFixed(1)} m/s`
    : '—';
  const attempts = st.attempts || (st.resolvedCount + st.whiffCount);
  const assisted = st.assistedCount || 0;
  const assistTag = assisted > 0 ? ` (${assisted} assisted)` : '';
  const rateText = `${st.resolvedCount}${assistTag} / ${attempts}` +
    (Number.isFinite(st.hitRate) ? `  (${(st.hitRate * 100).toFixed(0)}%)` : '');
  return { strikeText, hitText, rateText };
}

/**
 * Formats the score, target goal, and regulation/overtime clock string for `#hud-score`.
 *
 * @param {object} m Match probe or `matchState`
 * @returns {string}
 */
export function formatMatchHud(m) {
  const mins = Math.floor(m.ticksRemaining / 3600);
  const secs = Math.floor((m.ticksRemaining % 3600) / 60);
  const clock = m.isGoldenGoal && !m.matchOver
    ? 'OT · GOLDEN GOAL'
    : `${m.overtimePeriod > 0 && !m.matchOver ? 'OT ' : ''}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return (
    `${m.scoreHome} - ${m.scoreAway}  ->goal ${m.targetGoal}  ` +
    `${m.mode === 'match' ? clock : 'practice'}${m.matchOver ? '  FULL TIME' : ''}`
  );
}

/**
 * Updates all diagnostic `#hud` spans for the current rendered frame.
 *
 * @param {object} params
 * @param {object} params.loop Fixed-step loop instance
 * @param {object|null} params.athlete Primary tracked athlete (`athletes[0]`)
 * @param {object|null} params.cameraRig Primary `PlayerCamera` rig (`playerCameras[0]`)
 * @param {object|null} params.ball Active ball instance
 * @param {Array<object>} [params.balls=[]] All active balls
 * @param {object|null} [params.match=null] Match probe snapshot
 */
export function updateHud({
  loop,
  athlete,
  cameraRig,
  ball,
  balls = [],
  match = null,
}) {
  if (!TUNING.debug.showHud) return;

  const mtr = athlete ? athlete.motor : null;
  const trk = athlete ? athlete.tracker : null;
  const tgt = athlete ? athlete.animTarget : null;
  const act = athlete ? athlete.actionState : null;
  const stk = athlete ? athlete.strikeState : null;

  if (hudTick) hudTick.textContent = String(loop.tick);
  if (hudAlpha) hudAlpha.textContent = loop.alpha.toFixed(2);
  if (hudSteps) hudSteps.textContent = String(loop.stepsThisFrame);
  if (hudFrameTime) hudFrameTime.textContent = `${loop.frameTimeMs.toFixed(2)} ms`;
  if (hudDisplayHz) hudDisplayHz.textContent = `${loop.displayHz.toFixed(1)} Hz`;
  if (hudDrift) hudDrift.textContent = `${loop.driftMs.toFixed(1)} ms`;
  if (hudSpeed) hudSpeed.textContent = mtr ? `${horizontalSpeed(mtr).toFixed(2)} m/s` : '—';
  if (hudGrounded) hudGrounded.textContent = mtr ? String(mtr.grounded) : '—';
  if (hudWeight) hudWeight.textContent = trk ? trk.weight.toFixed(2) : '—';
  if (hudAnimSpeed) hudAnimSpeed.textContent = tgt ? tgt.smoothedSpeed.toFixed(2) : '—';
  if (hudBlend) {
    hudBlend.textContent = tgt
      ? `${tgt.gait.idle.toFixed(2)} ${tgt.gait.walk.toFixed(2)} ` +
        `${tgt.gait.run.toFixed(2)} ${tgt.gait.sprint.toFixed(2)}`
      : '—';
  }
  if (hudDirection) {
    hudDirection.textContent = tgt
      ? tgt.direction.map((d) => d.toFixed(2)).join(' ')
      : '—';
  }
  if (hudBackNode) {
    hudBackNode.textContent = tgt
      ? `${tgt.weights.walkB.toFixed(2)} ${tgt.nodes.walk.b.name} / ` +
        `${tgt.weights.runB.toFixed(2)} ${tgt.nodes.run.b.name}`
      : '—';
  }
  if (hudLocalVel) {
    hudLocalVel.textContent = tgt
      ? `${tgt.localVelX.toFixed(2)} / ${tgt.localVelZ.toFixed(2)}`
      : '—';
  }
  if (hudSprint) hudSprint.textContent = getInputSlot(0).sprintHeld ? 'SPRINT' : '—';
  if (hudAirborne) {
    hudAirborne.textContent = tgt
      ? `${tgt.airborneMix.toFixed(2)} / ${tgt.jumpPhase.toFixed(2)} / ${tgt.jumpClipMix.toFixed(2)}`
      : '—';
  }
  if (hudDrag) {
    const resScale = athlete?.lastResistanceScale ?? 1;
    hudDrag.textContent = resScale.toFixed(2);
  }
  if (hudArm && cameraRig) {
    hudArm.textContent =
      `${cameraRig.currentDistance.toFixed(3)} / ${cameraRig.azimuth.toFixed(2)} / ${cameraRig.pitch.toFixed(2)}`;
  }

  const diveReady = act
    ? Math.max(0, TUNING.action.diveCooldownTicks - (loop.tick - act.lastDiveTick))
    : 0;
  if (hudAction) {
    hudAction.textContent = act
      ? `${act.slideTime} / ${act.divePending ? 'DIVE' : '—'} / cd ${Number.isFinite(diveReady) ? Math.round(diveReady) : 0}`
      : '—';
  }

  if (hudShares) {
    if (tgt) {
      const sh = tgt.shares;
      hudShares.textContent =
        `${sh.stand.toFixed(2)} ${sh.action.toFixed(2)} ${sh.air.toFixed(2)} ${sh.loco.toFixed(2)}`;
    } else {
      hudShares.textContent = '—';
    }
  }
  if (hudLoco) {
    hudLoco.textContent = tgt
      ? tgt.shares.loco < 0.005
        ? '0.00'
        : tgt.shares.loco.toFixed(2)
      : '—';
  }

  const age = trk ? loop.tick - trk.lastImpactTick : Infinity;
  if (hudImpact) {
    hudImpact.textContent =
      trk && trk.lastImpactKey && age <= TUNING.impact.hudHoldTicks
        ? `${trk.lastImpactKey} ${Math.round(trk.lastImpactExcess)}`
        : '—';
  }

  if (hudStandUp) {
    hudStandUp.textContent = tgt
      ? `${tgt.standUpNeed.toFixed(2)} / ${tgt.standUpProgress.toFixed(2)} / ${tgt.pelvisDownness.toFixed(2)}`
      : '—';
  }

  if (ball) {
    const b = ballProbe(ball);
    if (hudBall) {
      hudBall.textContent = `${b.label}  ${b.speed.toFixed(2)} m/s / ${
        Number.isFinite(b.heightAboveFloor) ? b.heightAboveFloor.toFixed(3) : '—'
      } m`;
    }
    let latest = null;
    for (const other of balls) {
      if (other.lastTouchKey && (!latest || other.lastTouchTick > latest.lastTouchTick)) {
        latest = other;
      }
    }
    if (hudBallTouch) {
      hudBallTouch.textContent = latest
        ? `${latest.id}:${latest.lastTouchKey} @${latest.lastTouchTick} ${latest.lastTouchForce.toFixed(1)} N`
        : '—';
    }
    let motorContacts = 0;
    let peakAcross = 0;
    for (const other of balls) {
      motorContacts += other.motorContactCount;
      if (other.peakTouchForce > peakAcross) peakAcross = other.peakTouchForce;
    }
    if (hudBallPeak) {
      hudBallPeak.textContent = `${peakAcross.toFixed(1)} N / ${motorContacts}`;
    }
  } else {
    if (hudBall) hudBall.textContent = '—';
    if (hudBallTouch) hudBallTouch.textContent = '—';
    if (hudBallPeak) hudBallPeak.textContent = '—';
  }

  if (stk) {
    const st = strikeProbe(stk);
    const { strikeText, hitText, rateText } = formatStrikeHud(st, loop.tick);
    if (hudStrike) hudStrike.textContent = strikeText;
    if (hudStrikeHit) hudStrikeHit.textContent = hitText;
    if (hudStrikeRate) hudStrikeRate.textContent = rateText;
  } else {
    if (hudStrike) hudStrike.textContent = '—';
    if (hudStrikeHit) hudStrikeHit.textContent = '—';
    if (hudStrikeRate) hudStrikeRate.textContent = '0 / 0';
  }

  if (hudCamMode) {
    hudCamMode.textContent = `${TUNING.camera.mode.toUpperCase()} [Tab / D-Pad]`;
  }

  if (hudScore && match) {
    hudScore.textContent = formatMatchHud(match);
  }
}
