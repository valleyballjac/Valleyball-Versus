import { TUNING } from '../../config/tuning.js';
import { horizontalSpeed } from '../../sim/motor.js';
import { queueKnockdown } from '../../sim/tracker.js';
import { soundManager } from '../../audio/soundManager.js';
import { triggerHaptic } from '../../input/inputRouter.js';

function getPairTick(a1, a2, field) {
  const map = a1[field];
  if (!map) return -1e9;
  const val = map.get(a2.id);
  return val === undefined ? -1e9 : val;
}

function setPairTick(a1, a2, field, tick) {
  if (!a1[field]) a1[field] = new Map();
  if (!a2[field]) a2[field] = new Map();
  a1[field].set(a2.id, tick);
  a2[field].set(a1.id, tick);
}

/**
 * Handles physical reactions and slide-tackle knockdowns when two athletes collide.
 *
 * Uses per-pair cooldowns so 3- and 4-player pileups resolve every colliding pair
 * independently without one pair starving separation on other colliding pairs.
 *
 * GROUND-PLANE PHYSICS ONLY:
 * All impulses are strictly horizontal (y = 0.0) so athletes stay grounded on the pitch
 * rather than launching or bouncing into the air.
 */
export function resolveAthleteCollision({
  a1,
  a2,
  hit1,
  hit2,
  tick,
  athletes,
  playerCameras,
}) {
  if (!a1 || !a2 || !a1.motor?.body || !a2.motor?.body) return;

  const idx1 = athletes.indexOf(a1);
  const idx2 = athletes.indexOf(a2);

  const isA1Sliding = a1.actionState && a1.actionState.slideTime > 0;
  const isA2Sliding = a2.actionState && a2.actionState.slideTime > 0;

  // 1. SLIDE TACKLE: Slider sweeps victim's lower limbs along the turf; victim trips and collapses
  if (isA1Sliding && !isA2Sliding) {
    const speed1 = horizontalSpeed(a1.motor);
    if (
      speed1 > TUNING.action.slideTackleMinSpeed &&
      (tick - getPairTick(a1, a2, '_pairTackleTicks')) > TUNING.action.slideTackleCooldownTicks
    ) {
      setPairTick(a1, a2, '_pairTackleTicks', tick);
      queueKnockdown(a2.tracker, 0.0);
      const v1 = a1.motor.body.linvel();

      // Victim swept along the turf (y = 0.0, no vertical catapult)
      a2.motor.body.applyImpulse({ x: v1.x * 0.45, y: 0.0, z: v1.z * 0.45 }, true);

      // Physically kick the victim's hit leg forward in the ragdoll solver
      const victimLimbKey = (hit2 && !hit2.isMotor && hit2.key) || 'calfL';
      const victimLimbGroup = (hit2 && !hit2.isMotor && hit2.group) || 'limb';
      if (a2.impactEvents) {
        a2.impactEvents.push({ key: victimLimbKey, group: victimLimbGroup, force: 16.0 });
      }

      // Slider retains forward momentum and cuts through along the turf (y = 0.0)
      a1.motor.body.applyImpulse({ x: -v1.x * 0.12, y: 0.0, z: -v1.z * 0.12 }, true);

      const p1 = a1.motor.body.translation();
      const p2 = a2.motor.body.translation();
      const midPos = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5, z: (p1.z + p2.z) * 0.5 };
      soundManager.playAthleteAction('slide', midPos);
      soundManager.playBodyCollision(1.0, midPos);
      for (const pc of playerCameras) pc.addTrauma(0.22);
      const haptics = {
        weakMagnitude: TUNING.input?.haptics?.tackleWeak ?? 0.35,
        strongMagnitude: TUNING.input?.haptics?.tackleStrong ?? 0.15,
        duration: TUNING.input?.haptics?.tackleDuration ?? 80,
      };
      if (idx1 >= 0) triggerHaptic(idx1, haptics);
      if (idx2 >= 0) triggerHaptic(idx2, haptics);
      return;
    }
  } else if (isA2Sliding && !isA1Sliding) {
    const speed2 = horizontalSpeed(a2.motor);
    if (
      speed2 > TUNING.action.slideTackleMinSpeed &&
      (tick - getPairTick(a1, a2, '_pairTackleTicks')) > TUNING.action.slideTackleCooldownTicks
    ) {
      setPairTick(a1, a2, '_pairTackleTicks', tick);
      queueKnockdown(a1.tracker, 0.0);
      const v2 = a2.motor.body.linvel();

      a1.motor.body.applyImpulse({ x: v2.x * 0.45, y: 0.0, z: v2.z * 0.45 }, true);

      const victimLimbKey = (hit1 && !hit1.isMotor && hit1.key) || 'calfL';
      const victimLimbGroup = (hit1 && !hit1.isMotor && hit1.group) || 'limb';
      if (a1.impactEvents) {
        a1.impactEvents.push({ key: victimLimbKey, group: victimLimbGroup, force: 16.0 });
      }

      a2.motor.body.applyImpulse({ x: -v2.x * 0.12, y: 0.0, z: -v2.z * 0.12 }, true);

      const p1 = a1.motor.body.translation();
      const p2 = a2.motor.body.translation();
      const midPos = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5, z: (p1.z + p2.z) * 0.5 };
      soundManager.playAthleteAction('slide', midPos);
      soundManager.playBodyCollision(1.0, midPos);
      for (const pc of playerCameras) pc.addTrauma(0.22);
      const haptics = {
        weakMagnitude: TUNING.input?.haptics?.tackleWeak ?? 0.35,
        strongMagnitude: TUNING.input?.haptics?.tackleStrong ?? 0.15,
        duration: TUNING.input?.haptics?.tackleDuration ?? 80,
      };
      if (idx1 >= 0) triggerHaptic(idx1, haptics);
      if (idx2 >= 0) triggerHaptic(idx2, haptics);
      return;
    }
  } else if (isA1Sliding && isA2Sliding) {
    // Both sliding: head-on clash on the turf
    if ((tick - getPairTick(a1, a2, '_pairTackleTicks')) > TUNING.action.slideTackleCooldownTicks) {
      setPairTick(a1, a2, '_pairTackleTicks', tick);
      queueKnockdown(a1.tracker, 0.0);
      queueKnockdown(a2.tracker, 0.0);
      const v1 = a1.motor.body.linvel();
      const v2 = a2.motor.body.linvel();
      a1.motor.body.applyImpulse({ x: -v1.x * 0.6, y: 0.0, z: -v1.z * 0.6 }, true);
      a2.motor.body.applyImpulse({ x: -v2.x * 0.6, y: 0.0, z: -v2.z * 0.6 }, true);

      const p1 = a1.motor.body.translation();
      const p2 = a2.motor.body.translation();
      const midPos = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5, z: (p1.z + p2.z) * 0.5 };
      soundManager.playBodyCollision(1.0, midPos);
      for (const pc of playerCameras) pc.addTrauma(0.26);
      const haptics = {
        weakMagnitude: (TUNING.input?.haptics?.tackleWeak ?? 0.35) * 1.1,
        strongMagnitude: (TUNING.input?.haptics?.tackleStrong ?? 0.15) * 1.2,
        duration: 90,
      };
      if (idx1 >= 0) triggerHaptic(idx1, haptics);
      if (idx2 >= 0) triggerHaptic(idx2, haptics);
      return;
    }
  }

  // 2. ATHLETE JOSTLING / BODY BUMPS (Per-pair cooldown so 4-player pileups separate cleanly)
  if ((tick - getPairTick(a1, a2, '_pairCollideTicks')) > 6) {
    setPairTick(a1, a2, '_pairCollideTicks', tick);

    const p1 = a1.motor.body.translation();
    const p2 = a2.motor.body.translation();
    let dx = p2.x - p1.x;
    let dz = p2.z - p1.z;
    let dist = Math.hypot(dx, dz);
    if (dist < 1e-4) {
      const angle = Math.max(0, idx1) * 1.57079632679 + Math.max(0, idx2) * 0.78539816339;
      dx = Math.cos(angle);
      dz = Math.sin(angle);
      dist = 1;
    }
    const nx = dx / dist;
    const nz = dz / dist;

    const v1 = a1.motor.body.linvel();
    const v2 = a2.motor.body.linvel();
    const vRel = (v1.x - v2.x) * nx + (v1.z - v2.z) * nz;

    const approachImpulse = Math.max(0, vRel) * 2.8;
    const overlap = Math.max(0, 1.05 - dist);
    const overlapImpulse = overlap * 4.5;
    const impulseMag = Math.min(5.0, approachImpulse + overlapImpulse);

    if (impulseMag > 0.05) {
      if (impulseMag > 1.2) {
        for (const pc of playerCameras) pc.addTrauma(Math.min(0.14, impulseMag * 0.035));
        const haptics = {
          weakMagnitude: TUNING.input?.haptics?.collisionWeak ?? 0.25,
          strongMagnitude: TUNING.input?.haptics?.collisionStrong ?? 0.10,
          duration: TUNING.input?.haptics?.collisionDuration ?? 60,
        };
        if (idx1 >= 0) triggerHaptic(idx1, haptics);
        if (idx2 >= 0) triggerHaptic(idx2, haptics);
      }
      // Pure ground plane impulse: NEVER launch athletes into the air (y = 0.0)
      a1.motor.body.applyImpulse({ x: -nx * impulseMag, y: 0.0, z: -nz * impulseMag }, true);
      a2.motor.body.applyImpulse({ x: nx * impulseMag, y: 0.0, z: nz * impulseMag }, true);

      const k1 = (hit1 && !hit1.isMotor && hit1.key) || 'chest';
      const g1 = (hit1 && !hit1.isMotor && hit1.group) || 'torso';
      const k2 = (hit2 && !hit2.isMotor && hit2.key) || 'chest';
      const g2 = (hit2 && !hit2.isMotor && hit2.group) || 'torso';

      if (a1.impactEvents) a1.impactEvents.push({ key: k1, group: g1, force: impulseMag * 3.5 });
      if (a2.impactEvents) a2.impactEvents.push({ key: k2, group: g2, force: impulseMag * 3.5 });

      const midPos = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5, z: (p1.z + p2.z) * 0.5 };
      soundManager.playBodyCollision(Math.max(0.2, Math.min(1.0, vRel / 4.0)), midPos);
    }
  }
}
