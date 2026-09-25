import * as THREE from 'three';

/**
 * Cinematic Camera Rig for Valleyball.
 *
 * Provides:
 * 1. Title Screen Orbit: Slow, ambient 360-degree rotation framing the arena and athletes.
 * 2. Pre-Match Flyover: Dynamic 10-second aerial sweep banking over the court, goals,
 *    and stream heads before the match countdown begins.
 */
export class CinematicCamera {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 500);

    this.mode = 'idle'; // 'idle' (title orbit) | 'flyover' (pre-match 10s cutscene)
    this.elapsedTime = 0;
    this.duration = 10.0; // seconds for flyover
    this.isComplete = false;

    this._target = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this.winnerPos = new THREE.Vector3();
  }

  startTitleOrbit() {
    this.mode = 'idle';
    this.elapsedTime = 0;
    this.isComplete = false;
  }

  startFlyover(duration = 10.0) {
    this.mode = 'flyover';
    this.elapsedTime = 0;
    this.duration = duration;
    this.isComplete = false;
  }

  startSetupPreview() {
    this.mode = 'setup';
    this.elapsedTime = 0;
    this.isComplete = false;
  }

  startKickoffRitual(duration = 4.0) {
    this.mode = 'kickoff';
    this.elapsedTime = 0;
    this.duration = duration;
    this.isComplete = false;
  }

  startVictoryPresentation(winnerPos = null, duration = 8.0) {
    this.mode = 'victory';
    this.elapsedTime = 0;
    this.duration = duration;
    this.isComplete = false;
    if (winnerPos) {
      this.winnerPos.copy(winnerPos);
    } else {
      this.winnerPos.set(0, 0, 0);
    }
  }

  update(delta) {
    if (this.mode === 'custom' || this.mode === 'manual') {
      return;
    }
    this.elapsedTime += delta;

    if (this.mode === 'flyover') {
      const progress = Math.min(1.0, this.elapsedTime / this.duration);
      if (progress >= 1.0) {
        this.isComplete = true;
      }

      // Smooth aerial flyover path:
      // Start high near South-East corner (behind Scarlet), swoops low across the center court,
      // climbs over North goal (behind Cobalt), and banks back toward midfield.
      // t: 0 to 1
      const angle = -Math.PI * 0.75 + progress * (Math.PI * 1.8);
      const radius = 48.0 - Math.sin(progress * Math.PI) * 16.0; // 48m -> 32m -> 48m
      const height = 18.0 - Math.sin(progress * Math.PI) * 7.0 + (1 - progress) * 4.0; // 22m -> 11m -> 18m

      this._pos.set(
        radius * Math.sin(angle),
        height,
        radius * Math.cos(angle)
      );

      // Target looks dynamically toward court center, tilting toward active goal/athletes
      const targetZ = Math.cos(progress * Math.PI * 2) * 12.0;
      this._target.set(0, 3.5, targetZ);

      this.camera.position.copy(this._pos);
      this.camera.lookAt(this._target);

    } else if (this.mode === 'setup') {
      // 'setup' — Wide staging framing both athletes on court at center circle flanking the menu
      const breatheX = Math.sin(this.elapsedTime * 0.4) * 0.1;
      const breatheY = Math.cos(this.elapsedTime * 0.6) * 0.04;
      this._pos.set(breatheX, 1.35 + breatheY, 5.2);
      this._target.set(0, 1.15, 0);

      this.camera.position.lerp(this._pos, 1 - Math.exp(-6.0 * delta));
      this.camera.lookAt(this._target);

    } else if (this.mode === 'kickoff') {
      const progress = Math.min(1.0, this.elapsedTime / this.duration);
      if (progress >= 1.0) {
        this.isComplete = true;
      }
      // Sideline standoff camera: dynamic low-angle tracking shot framing athletes and dropping ball
      const t = progress;
      const posX = 15.0 - t * 3.5;
      const posY = 1.6 + t * 1.0;
      const posZ = -3.0 + t * 6.0;
      this._pos.set(posX, posY, posZ);

      // Tilts from center basin pelvis up toward the dropping ball
      const targetY = 1.1 + t * 3.0;
      this._target.set(0, targetY, 0);

      this.camera.position.lerp(this._pos, 1 - Math.exp(-6.0 * delta));
      this.camera.lookAt(this._target);

    } else if (this.mode === 'victory') {
      // Orbiting hero presentation framing the victorious athlete
      const angle = (this.elapsedTime * 0.45);
      const radius = 4.2;
      const height = 1.35 + Math.sin(this.elapsedTime * 0.5) * 0.15;
      const wx = this.winnerPos ? this.winnerPos.x : 0;
      const wy = this.winnerPos ? this.winnerPos.y : 0;
      const wz = this.winnerPos ? this.winnerPos.z : 0;

      this._pos.set(
        wx + radius * Math.sin(angle),
        wy + height,
        wz + radius * Math.cos(angle)
      );
      this._target.set(wx, wy + 1.25, wz);

      this.camera.position.lerp(this._pos, 1 - Math.exp(-6.0 * delta));
      this.camera.lookAt(this._target);

    } else {
      // 'idle' — Gentle ambient title orbit (slow cinematic arena rotation)
      const angle = (this.elapsedTime * 0.04) % (Math.PI * 2);
      const radius = 54.0;
      const height = 16.5;

      this._pos.set(
        radius * Math.sin(angle),
        height,
        radius * Math.cos(angle)
      );
      this._target.set(0, 4.0, 0);

      this.camera.position.copy(this._pos);
      this.camera.lookAt(this._target);
    }
  }
}
