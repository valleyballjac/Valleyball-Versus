import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { soundManager } from '../audio/soundManager.js';
import { getInputSlot } from '../input/inputRouter.js';
import { getCourtFloorY } from '../ai/courtHeightmap.js';

/**
 * VALLEYBALL VERSUS — OFFICIAL DEBUT TRAILER DIRECTOR
 * (100% UNSCRIPTED 80-MATCH HARVEST & BEAT-QUANTIZED RHYTHMIC EDITION)
 *
 * Architectural & Directorial Invariants:
 * 1. 100% UNSCRIPTED MATCH HARVESTING:
 *    - Before rendering the trailer, `runHarvest()` simulates 80+ full unscripted AI-vs-AI
 *      game situations at ~40x real-time with `trailerDirector.isActive = false`.
 *    - Every rally, cut, slide, dive, jump, volley, spike, banked wall carom, and Torus hoop
 *      goal is produced naturally by `botController.js`, `athlete.js`, `strikes.js`,
 *      `scoring.js`, and Rapier 3D physics.
 * 2. ZERO BALL RESPAWNS & ZERO RUNNING AWAY:
 *    - The Highlight Miner scans all ~35,000+ recorded ticks and strictly rejects any clip window
 *      where a ball or athlete teleports/respawns (`maxBallStep > 1.8m/tick`) or where an
 *      athlete near the ball runs away from the ball (`engagementScore` filtering).
 * 3. BEAT-QUANTIZED CUTS (133.333 BPM = 1.800s Bars / 108 Frames @ 60 FPS):
 *    - Phase 1 (0:00.00 – 44.20s): Monumental Architectural Overture, Hero Portraits & Unbroken Rallies.
 *    - Phase 2 (44.20s – 62.20s): Ten 1.800s (108-frame) 1-Bar Action & Torus Goal Cuts.
 *    - Phase 3 (62.20s – 76.60s): Twelve 0.900s (54-frame) Half-Bar Cuts + Quarter/Eighth-Note Blitz.
 *    - Phase 4 (76.60s – 83.80s): Climax North Torus Goal #6 (4-2) & Celestial Ascension Pullback.
 *    - Phase 5 (83.80s – 94.50s): Cosmic Deep Space Galaxy Title Card Hold.
 * 4. 3/4 FLANK TORUS APERTURE FRAMING:
 *    - All 6 genuine unscripted Torus hoop goals are framed from the 3/4 flank (`|X| = 13m..16m`)
 *      looking cleanly through the circular X = 0 aperture and stadium scoreboard.
 */
export class TrailerDirector {
  constructor(camera = null) {
    this.camera = camera || new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
    this.isActive = false;
    this.elapsedTime = 0;
    this.duration = 94.5;

    // Zero-allocation scratch vectors
    this._pos = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._smoothPos = new THREE.Vector3();
    this._smoothTarget = new THREE.Vector3();
    this._justCut = true;
    this._tmpVec = new THREE.Vector3();

    // Raw reel camera state (legacy compatibility)
    this._rawCamPos = new THREE.Vector3();
    this._rawCamTarget = new THREE.Vector3();
    this._rawCamPrimed = false;

    // Positional micro-shake trauma
    this.trauma = 0.0;

    // Synchronized deterministic tick/frame counter
    this._tickCount = 0;
    this._tickStepped = false;
    this._currentCut = -1;
    this._stagedCut = -1;
    this._firedEvents = new Set();

    // Harvested clip bank & beat-quantized schedule
    this._harvestedGames = [];
    this._schedule = [];
    this._harvestReady = false;
    this._rngState = 20261027;

    // Official Brand Palettes & Series 1 Headwear Pack
    // Index 0 is strictly reserved for Classic Red (wrestler_bands) vs Royal Blue (wicket_grill)
    this._palettes = [
      {
        name: 'ClassicRedBlue',
        homeColor: 0xD90429,
        awayColor: 0x1D4ED8,
        homeVariant: 'masculine',
        awayVariant: 'masculine',
        homeHeadwear: 'wrestler_bands',
        awayHeadwear: 'wicket_grill',
      },
      {
        name: 'VoltGold_NeonViolet',
        homeColor: 0xFFD000,
        awayColor: 0x8B5CF6,
        homeVariant: 'masculine',
        awayVariant: 'feminine',
        homeHeadwear: 'sensor_visor',
        awayHeadwear: 'couture_wrap',
      },
      {
        name: 'IonCyan_SolarBlaze',
        homeColor: 0x00E5FF,
        awayColor: 0xFF6B00,
        homeVariant: 'feminine',
        awayVariant: 'classic',
        homeHeadwear: 'rigger_band',
        awayHeadwear: 'ouendan_knot',
      },
      {
        name: 'Emerald_SolarBlaze',
        homeColor: 0x10E56A,
        awayColor: 0xFF6B00,
        homeVariant: 'classic',
        awayVariant: 'masculine',
        homeHeadwear: 'terrace_visor',
        awayHeadwear: 'cursor_cap',
      },
      {
        name: 'Obsidian_FrostWhite',
        homeColor: 0x0F172A,
        awayColor: 0xF8FAFC,
        homeVariant: 'masculine',
        awayVariant: 'feminine',
        homeHeadwear: 'manager_cap',
        awayHeadwear: 'broadcaster_mic',
      },
      {
        name: 'DeepIndigo_VoltGold',
        homeColor: 0x6B11FF,
        awayColor: 0xFFD000,
        homeVariant: 'masculine',
        awayVariant: 'feminine',
        homeHeadwear: 'couture_wrap',
        awayHeadwear: 'sensor_visor',
      },
      {
        name: 'SolarBlaze_IonCyan',
        homeColor: 0xFF6B00,
        awayColor: 0x00E5FF,
        homeVariant: 'classic',
        awayVariant: 'masculine',
        homeHeadwear: 'cursor_cap',
        awayHeadwear: 'rigger_band',
      },
      {
        name: 'Emerald_DeepIndigo',
        homeColor: 0x10E56A,
        awayColor: 0x6B11FF,
        homeVariant: 'feminine',
        awayVariant: 'masculine',
        homeHeadwear: 'broadcaster_mic',
        awayHeadwear: 'terrace_visor',
      },
    ];

    this._prevSfxGain = 1.0;
    this._prevAmbGain = 1.0;
    this._prevUiGain = 1.0;

    this.rawReelMode = null;
    this.stuntType = 'rally';
    this.rawDuration = 8.0;
  }

  _nextRng() {
    this._rngState = (this._rngState * 1664525 + 1013904223) >>> 0;
    return this._rngState / 4294967296;
  }

  /**
   * Activates the deterministic trailer sequence.
   * @param {number} startOffset - seconds into the sequence (default 0)
   */
  start(startOffset = 0) {
    this.isActive = true;
    this.rawReelMode = null;
    this.elapsedTime = startOffset;
    this._tickCount = Math.round(startOffset * 60);
    this._tickStepped = false;
    this._currentCut = -1;
    this._stagedCut = -1;
    this._firedEvents.clear();
    this.trauma = 0.0;
    this._smoothPos.set(0, 0, 0);
    this._smoothTarget.set(0, 0, 0);
    this._justCut = true;

    // A goal scored during the harvest leaves celebrationTicks running, which
    // lights the "GOAL SCORED" banner over the opening shots.
    const matchState = typeof window !== 'undefined' ? window.__vb?.matchState : null;
    if (matchState) matchState.celebrationTicks = 0;

    if (typeof document !== 'undefined') {
      document.body.classList.add('trailer-mode-active');
      const root = document.getElementById('main-menu-root');
      if (root) root.style.display = 'none';
      const hud = document.getElementById('hud');
      if (hud) hud.style.display = 'none';

      let styleEl = document.getElementById('trailer-director-style');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'trailer-director-style';
        styleEl.textContent = `
          body.trailer-mode-active #main-menu-root,
          body.trailer-mode-active #title-screen,
          body.trailer-mode-active #hud,
          body.trailer-mode-active #controls-card,
          body.trailer-mode-active #splitscreen-divider,
          body.trailer-mode-active .lil-gui,
          body.trailer-mode-active #camera-toast,
          body.trailer-mode-active #headwear-toast,
          body.trailer-mode-active #loading-screen {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          #trailer-fade-overlay {
            position: fixed;
            inset: 0;
            background: #000000;
            z-index: 999998;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.08s linear;
          }
        `;
        document.head.appendChild(styleEl);
      }

      let fadeEl = document.getElementById('trailer-fade-overlay');
      if (!fadeEl) {
        fadeEl = document.createElement('div');
        fadeEl.id = 'trailer-fade-overlay';
        document.body.appendChild(fadeEl);
      }
    }

    if (typeof window !== 'undefined' && window.__vb) {
      if (window.__vb.scoreboards?.group) window.__vb.scoreboards.group.visible = true;
      if (window.__vb.hustleBoards?.group) window.__vb.hustleBoards.group.visible = true;
    }

    try {
      if (soundManager.ctx) {
        const now = soundManager.ctx.currentTime;
        if (soundManager.sfxGain) {
          this._prevSfxGain = soundManager.sfxGain.gain.value;
          soundManager.sfxGain.gain.setValueAtTime(0, now);
        }
        if (soundManager.ambienceGain) {
          this._prevAmbGain = soundManager.ambienceGain.gain.value;
          soundManager.ambienceGain.gain.setValueAtTime(0, now);
        }
        if (soundManager.uiGain) {
          this._prevUiGain = soundManager.uiGain.gain.value;
          soundManager.uiGain.gain.setValueAtTime(0, now);
        }
      }
    } catch (_) {}

    try {
      soundManager.music?.play?.(0);
      if (soundManager.music?.audioElement && startOffset > 0) {
        soundManager.music.audioElement.currentTime = startOffset;
      }
    } catch (_) {}

    this._applyTeamPalette(0);
    this._setMatchBall('medium');
    console.log(`[TrailerDirector] Started at offset ${startOffset.toFixed(2)}s (harvestReady=${this._harvestReady})`);
  }

  stop() {
    if (!this.isActive) return;
    this.isActive = false;
    this.rawReelMode = null;

    if (typeof document !== 'undefined') {
      document.body.classList.remove('trailer-mode-active');
      const fadeEl = document.getElementById('trailer-fade-overlay');
      if (fadeEl) fadeEl.style.opacity = '0';
    }

    try {
      if (soundManager.ctx) {
        const now = soundManager.ctx.currentTime;
        if (soundManager.sfxGain) soundManager.sfxGain.gain.setValueAtTime(this._prevSfxGain ?? 1.0, now);
        if (soundManager.ambienceGain) soundManager.ambienceGain.gain.setValueAtTime(this._prevAmbGain ?? 1.0, now);
        if (soundManager.uiGain) soundManager.uiGain.gain.setValueAtTime(this._prevUiGain ?? 1.0, now);
      }
    } catch (_) {}
  }

  toggle() {
    if (this.isActive) this.stop();
    else this.start(0);
  }

  addImpulse(amount = 0.35) {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  startRawReel(config = {}) {
    this.rawReelMode = config;
    this.stuntType = config.stuntType || 'rally';
    this.rawDuration = config.duration || 8.0;
    this.isActive = true;
    this.elapsedTime = 0;
    this._tickCount = 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. UNSCRIPTED 80+ MATCH HARVESTER (PURE BOT + RAPIER 3D SIMULATION)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Places an athlete cleanly on the local parabolic court floor in an upright,
   * grounded stance facing `yaw`, with zero finite-difference velocity spike.
   */
  _placeAthleteForSim(athlete, x, z, yaw, vx = 0, vz = 0) {
    if (!athlete?.motor?.body) return;
    const floorY = getCourtFloorY(x, z);
    const targetY = floorY + 0.92;

    athlete.teleportTo({ x, y: targetY, z }, yaw);
    athlete.motor.grounded = true;
    athlete.motor.body.setLinvel({ x: vx, y: 0, z: vz }, true);
    athlete.motor.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

    if (athlete.animTarget) {
      athlete.animTarget.yaw = yaw;
      athlete.animTarget.targetYaw = yaw;
      athlete.animTarget.momentumYaw = yaw;
      athlete.animTarget.airborneMix = 0;
      athlete.animTarget.jumpPhase = 0;
      athlete.animTarget.standUpNeed = 0;
      athlete.animTarget.standUpProgress = 1;
      athlete.animTarget.pelvisDownness = 0;
      athlete.animTarget.seeded = false;
    }
    if (athlete.tracker) {
      athlete.tracker.weight = 1.0;
      athlete.tracker.blendWeight = 1.0;
      athlete.tracker.blendProgress = 1.0;
      athlete.tracker.toneAuthority = 1.0;
      athlete.tracker.queuedKnockdown = false;
      athlete.tracker.knockdownQueued = false;
    }
    if (athlete.actionState) {
      athlete.actionState.slideTime = 0;
      athlete.actionState.diveTime = 0;
      athlete.actionState.divePending = false;
      athlete.actionState.diveStunned = false;
      athlete.actionState.lastDiveTick = -999;
      athlete.actionState.jumpPhase = 0;
    }
    if (athlete.strikeState) {
      // -Infinity is strikes.js's "never struck". Any finite tick reads as a
      // strike in progress; an athlete with no strike kind yet never completes
      // it, so strikeMix latches at 1, every clip weight is zero, and the ghost
      // holds the bind pose: a T-pose until that athlete's first real hit.
      athlete.strikeState.lastStrikeTick = -Infinity;
      athlete.strikeState.lastResolvedStrikeTick = -Infinity;
      athlete.strikeState.strikePhase = 0;
      athlete.strikeState.strikeMix = 0;
    }

    if (athlete.ragdoll?.rig) {
      for (const item of athlete.ragdoll.rig.values()) {
        item.body.setLinvel({ x: vx, y: 0, z: vz }, true);
        item.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  _resetBotState(bot, difficulty = 'hard', aggressiveness = 0.90) {
    if (!bot) return;
    bot.difficulty = difficulty;
    bot.aggressiveness = aggressiveness;
    bot.currentAggressiveness = aggressiveness;
    bot.strategy = 'chase';
    bot.attackStage = 'none';
    bot.attackType = 'none';
    bot.stageStartTick = -999;
    bot.lastStrategyTick = -999;
    bot.lastStrikeTick = -999;
    bot.lastJumpTick = -999;
    bot.lastDiveTick = -999;
    bot.lastCutTick = -999;
    bot.lastSlideTick = -999;
    bot.pendingSpikeTick = -Infinity;
    bot.pendingJumpTick = -Infinity;
    bot.slideTicksRemaining = 0;
  }

  _capturePoseArray(athletes, activeBall) {
    const arr = new Float32Array(35 * 7);
    let offset = 0;
    const writeInterp = (interp) => {
      if (!interp) {
        arr[offset + 6] = 1.0;
        offset += 7;
        return;
      }
      arr[offset] = interp.currPos.x;
      arr[offset + 1] = interp.currPos.y;
      arr[offset + 2] = interp.currPos.z;
      arr[offset + 3] = interp.currQuat.x;
      arr[offset + 4] = interp.currQuat.y;
      arr[offset + 5] = interp.currQuat.z;
      arr[offset + 6] = interp.currQuat.w;
      offset += 7;
    };

    for (let i = 0; i < 2; i++) {
      const a = athletes[i];
      writeInterp(a?.motor?.interpolated);
      const order = a?.ragdoll?.order || [];
      for (let k = 0; k < 16; k++) {
        const key = order[k];
        const item = key ? a.ragdoll.rig.get(key) : null;
        writeInterp(item?.interpolated);
      }
    }
    writeInterp(activeBall?.interpolated);
    return arr;
  }

  _applyPoseArray(poses, athletes, activeBall, syncBodies = false) {
    if (!poses) return;
    let offset = 0;
    const readInterp = (interp, body = null) => {
      if (interp) {
        const px = poses[offset];
        const py = poses[offset + 1];
        const pz = poses[offset + 2];
        const qx = poses[offset + 3];
        const qy = poses[offset + 4];
        const qz = poses[offset + 5];
        const qw = poses[offset + 6];
        interp.prevPos.set(px, py, pz);
        interp.currPos.set(px, py, pz);
        interp.prevQuat.set(qx, qy, qz, qw);
        interp.currQuat.set(qx, qy, qz, qw);
        if (syncBodies && body) {
          body.setTranslation({ x: px, y: py, z: pz }, false);
          body.setRotation({ x: qx, y: qy, z: qz, w: qw }, false);
          body.setLinvel({ x: 0, y: 0, z: 0 }, false);
          body.setAngvel({ x: 0, y: 0, z: 0 }, false);
        }
      }
      offset += 7;
    };

    for (let i = 0; i < 2; i++) {
      const a = athletes[i];
      readInterp(a?.motor?.interpolated, a?.motor?.body);
      if (a?.motor?.interpolated) a.motor.interpolated.apply(1.0);
      const order = a?.ragdoll?.order || [];
      for (let k = 0; k < 16; k++) {
        const key = order[k];
        const item = key ? a.ragdoll.rig.get(key) : null;
        readInterp(item?.interpolated, item?.body);
      }
      if (syncBodies && a?.animTarget) {
        a.animTarget.seeded = false;
      }
      if (a?.renderPose) a.renderPose(1.0);
    }
    readInterp(activeBall?.interpolated, null);
    if (activeBall?.interpolated) activeBall.interpolated.apply(1.0);
  }

  /**
   * Simulates 80+ full unscripted AI-vs-AI game situations at ~40x real-time
   * (with `this.isActive = false` so zero directorial interference occurs during play)
   * and mines the best natural windows for all 43 beat-quantized trailer cuts.
   */
  runHarvest() {
    if (typeof window === 'undefined' || !window.__vb) {
      throw new Error('[TrailerDirector] window.__vb not available for runHarvest()');
    }

    const vb = window.__vb;
    const loop = vb.loop;
    const athletes = vb.athletes;
    const matchState = vb.matchState;
    const bots = vb.botControllers || [];
    const dt = 1 / 60;

    const wasActive = this.isActive;
    this.isActive = false; // CRITICAL: 0% TrailerDirector intervention during unscripted simulation!
    this._rngState = 20261027;
    this._harvestedGames = [];

    // Configure generous physical strike proximity & hoop magnetism for exciting AI play
    for (let i = 0; i < athletes.length; i++) {
      if (athletes[i]?.setAssistPreset) athletes[i].setAssistPreset('casual');
      if (athletes[i]?.strikeState) {
        athletes[i].strikeState.assistRadius = 0.72;
        athletes[i].strikeState.assistWindowTicks = 10;
        athletes[i].strikeState.aimMagnetism = 0.50;
      }
    }

    const t0 = performance.now();
    let totalSimTicks = 0;
    let northGoalsCount = 0;
    let southGoalsCount = 0;
    let diveEventsCount = 0;
    let spikeEventsCount = 0;
    let wallCaromsCount = 0;
    let totalHitsCount = 0;

    const simulateScenario = (gameId, cfg) => {
      const {
        category,
        ballType = 'medium',
        ticks = 360,
        targetGoal = 'N',
        p1,
        p2,
        ballInit,
        p1BotCfg = { difficulty: 'hard', aggressiveness: 0.92 },
        p2BotCfg = { difficulty: 'hard', aggressiveness: 0.92 },
        aimMag = 0.45,
      } = cfg;

      const activeBall = vb.setActiveMatchBall(ballType);
      if (matchState) {
        matchState.mode = 'match';
        matchState.targetGoal = targetGoal;
        matchState.isCountingDown = false;
        matchState.countdownTicksRemaining = 0;
        matchState.matchOver = false;
        matchState.ticksRemaining = 18000;
        matchState.events.length = 0;
      }

      for (let i = 0; i < athletes.length; i++) {
        if (athletes[i]?.strikeState) {
          athletes[i].strikeState.aimMagnetism = aimMag;
        }
      }

      this._resetBotState(bots[0], p1BotCfg.difficulty, p1BotCfg.aggressiveness);
      this._resetBotState(bots[1], p2BotCfg.difficulty, p2BotCfg.aggressiveness);

      // Place athletes cleanly on court floor at their starting stride for tick 0 of the unscripted game
      this._placeAthleteForSim(athletes[0], p1.x, p1.z, p1.yaw, p1.vx || 0, p1.vz || 0);
      this._placeAthleteForSim(athletes[1], p2.x, p2.z, p2.yaw, p2.vx || 0, p2.vz || 0);
      this._resetBotState(bots[0], p1BotCfg.difficulty, p1BotCfg.aggressiveness);
      this._resetBotState(bots[1], p2BotCfg.difficulty, p2BotCfg.aggressiveness);

      const bFloor = getCourtFloorY(ballInit.x, ballInit.z);
      const by = Math.max(bFloor + (activeBall.radius || 0.5) + 0.08, ballInit.y);
      activeBall.body.setTranslation({ x: ballInit.x, y: by, z: ballInit.z }, true);
      activeBall.body.setLinvel({ x: ballInit.vx || 0, y: ballInit.vy || 0, z: ballInit.vz || 0 }, true);
      activeBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      activeBall.interpolated.reset(new THREE.Vector3(ballInit.x, by, ballInit.z));
      activeBall.prevPos = { x: ballInit.x, y: by, z: ballInit.z };
      activeBall.hasPrevPos = true;
      activeBall.lastGoalTick = -999;

      if (matchState) matchState.events.length = 0;

      const frames = new Array(ticks);
      const goals = [];
      const hits = [];
      let prevBx = ballInit.x;
      let prevBy = by;
      let prevBz = ballInit.z;
      let prevP1x = p1.x;
      let prevP1z = p1.z;
      let prevP2x = p2.x;
      let prevP2z = p2.z;
      let prevBvx = ballInit.vx || 0;
      let lastHitTickP1 = -999;
      let lastHitTickP2 = -999;

      for (let t = 0; t < ticks; t++) {
        const eventsBefore = matchState ? matchState.events.length : 0;
        const p1ResolvedBefore = athletes[0]?.strikeState?.resolvedCount || 0;
        const p2ResolvedBefore = athletes[1]?.strikeState?.resolvedCount || 0;

        const registry = loop.interpolated;
        for (let r = 0; r < registry.length; r++) registry[r].savePrevious();

        const simTick = loop.tick++;
        loop._fixedUpdate(dt, simTick);
        totalSimTicks++;

        // Keep targetGoal consistent during the unscripted scenario so bots don't flip ends mid-clip
        if (matchState) {
          matchState.targetGoal = targetGoal;
          matchState.isCountingDown = false;
          matchState.matchOver = false;
        }

        const bt = activeBall.body.translation();
        const bv = activeBall.body.linvel();
        const bSpeed = Math.hypot(bv.x, bv.y, bv.z);

        const m1t = athletes[0].motor.body.translation();
        const m1v = athletes[0].motor.body.linvel();
        const p1Speed = Math.hypot(m1v.x, m1v.z);
        const p1Grounded = !!athletes[0].motor.grounded;
        const p1Diving = !!(athletes[0].isDiving && athletes[0].isDiving(simTick));
        const p1Sliding = (athletes[0].actionState?.slideTime || 0) > 0;
        const p1Yaw = athletes[0].animTarget?.yaw || 0;

        const m2t = athletes[1].motor.body.translation();
        const m2v = athletes[1].motor.body.linvel();
        const p2Speed = Math.hypot(m2v.x, m2v.z);
        const p2Grounded = !!athletes[1].motor.grounded;
        const p2Diving = !!(athletes[1].isDiving && athletes[1].isDiving(simTick));
        const p2Sliding = (athletes[1].actionState?.slideTime || 0) > 0;
        const p2Yaw = athletes[1].animTarget?.yaw || 0;

        let hitBy = -1;
        let hitKind = 0;
        if ((athletes[0]?.strikeState?.resolvedCount || 0) > p1ResolvedBefore) {
          hitBy = 0;
          hitKind = athletes[0].strikeState.lastStrikeKind || 1;
          lastHitTickP1 = t;
          hits.push({ tick: t, athlete: 0, kind: hitKind, airborne: !p1Grounded });
          totalHitsCount++;
          if (!p1Grounded) spikeEventsCount++;
        } else if ((athletes[1]?.strikeState?.resolvedCount || 0) > p2ResolvedBefore) {
          hitBy = 1;
          hitKind = athletes[1].strikeState.lastStrikeKind || 1;
          lastHitTickP2 = t;
          hits.push({ tick: t, athlete: 1, kind: hitKind, airborne: !p2Grounded });
          totalHitsCount++;
          if (!p2Grounded) spikeEventsCount++;
        }

        if (p1Diving || p2Diving || p1Sliding || p2Sliding) {
          diveEventsCount++;
        }

        let goalEvt = null;
        if (matchState && matchState.events.length > eventsBefore) {
          const lastEv = matchState.events[matchState.events.length - 1];
          goalEvt = {
            goal: lastEv.goal,
            scoredFor: lastEv.scoredFor,
            y: lastEv.y,
            z: lastEv.z,
          };
          goals.push({ tick: t, ...goalEvt });
          if (lastEv.goal === 'N') northGoalsCount++;
          else if (lastEv.goal === 'S') southGoalsCount++;
        }

        const ballStep = t === 0 ? 0 : Math.hypot(bt.x - prevBx, bt.y - prevBy, bt.z - prevBz);
        const p1Step = t === 0 ? 0 : Math.hypot(m1t.x - prevP1x, m1t.z - prevP1z);
        const p2Step = t === 0 ? 0 : Math.hypot(m2t.x - prevP2x, m2t.z - prevP2z);
        const teleported = ballStep > 1.8 || p1Step > 1.5 || p2Step > 1.5;

        const wallBounce = Math.abs(bt.x) > 12.2 && bSpeed > 8.5 && (Math.sign(bv.x) !== Math.sign(prevBvx) || Math.abs(bv.z) > 8.0);
        if (wallBounce) wallCaromsCount++;

        // Compute athlete approach engagement toward ball
        const d1 = Math.hypot(bt.x - m1t.x, bt.z - m1t.z);
        const d2 = Math.hypot(bt.x - m2t.x, bt.z - m2t.z);
        const align1 = (d1 > 0.6 && p1Speed > 0.8) ? ((bt.x - m1t.x) * m1v.x + (bt.z - m1t.z) * m1v.z) / (d1 * p1Speed) : 0.4;
        const align2 = (d2 > 0.6 && p2Speed > 0.8) ? ((bt.x - m2t.x) * m2v.x + (bt.z - m2t.z) * m2v.z) / (d2 * p2Speed) : 0.4;
        const p1RunningAway = d1 < 12.0 && p1Speed > 2.6 && align1 < -0.35 && (t - lastHitTickP1 > 28);
        const p2RunningAway = d2 < 12.0 && p2Speed > 2.6 && align2 < -0.35 && (t - lastHitTickP2 > 28);
        const closerRunningAway = d1 <= d2 ? p1RunningAway : p2RunningAway;

        prevBx = bt.x;
        prevBy = bt.y;
        prevBz = bt.z;
        prevP1x = m1t.x;
        prevP1z = m1t.z;
        prevP2x = m2t.x;
        prevP2z = m2t.z;
        prevBvx = bv.x;

        frames[t] = {
          poses: this._capturePoseArray(athletes, activeBall),
          bx: bt.x, by: bt.y, bz: bt.z,
          bvx: bv.x, bvy: bv.y, bvz: bv.z, bSpeed,
          p1x: m1t.x, p1y: m1t.y, p1z: m1t.z,
          p1vx: m1v.x, p1vy: m1v.y, p1vz: m1v.z, p1Speed,
          p1Grounded, p1Diving, p1Sliding, p1Yaw,
          p2x: m2t.x, p2y: m2t.y, p2z: m2t.z,
          p2vx: m2v.x, p2vy: m2v.y, p2vz: m2v.z, p2Speed,
          p2Grounded, p2Diving, p2Sliding, p2Yaw,
          hitBy, hitKind,
          goal: goalEvt,
          wallBounce,
          teleported,
          ballStep,
          align1, align2,
          closerRunningAway,
        };
      }

      const gameRecord = {
        id: gameId,
        category,
        ballType,
        targetGoal,
        frames,
        goals,
        hits,
      };
      this._harvestedGames.push(gameRecord);
      return gameRecord;
    };

    const ballCycle = ['medium', 'medium', 'small', 'large', 'medium'];

    // ─── CATEGORY 1: 16 North Torus Attacking Game Situations (Unscripted Goal Harvest) ───
    for (let i = 0; i < 16; i++) {
      const side = (i % 2 === 0) ? 1 : -1;
      const bType = (i < 4) ? 'medium' : ballCycle[i % ballCycle.length];
      const isAerialSetup = (i % 3 === 1);
      const bx = side * (4.1 + this._nextRng() * 1.4);
      const bz = -38.4 - this._nextRng() * 1.4;
      const bFloor = getCourtFloorY(bx, bz);
      const by = isAerialSetup ? (bFloor + 2.15 + this._nextRng() * 0.45) : (bFloor + 1.15 + this._nextRng() * 0.30);

      const p1x = bx + side * (0.95 + this._nextRng() * 0.35);
      const p1z = bz + (0.25 + this._nextRng() * 0.35);
      const aimYaw = Math.atan2(-bx, -40.0 - bz);

      const p2x = -side * (3.8 + this._nextRng() * 2.5);
      const p2z = -28.5 - this._nextRng() * 3.5;

      // First 2 games run 460 ticks so Climax Cut 18 + Ascension Cut 19 have a continuous 432-tick window
      const simTicks = i < 2 ? 460 : 165;

      simulateScenario(this._harvestedGames.length, {
        category: 'goal_north',
        ballType: bType,
        ticks: simTicks,
        targetGoal: 'N',
        p1: { x: p1x, z: p1z, yaw: aimYaw, vx: Math.sin(aimYaw) * 3.2, vz: Math.cos(aimYaw) * 3.2 },
        p2: { x: p2x, z: p2z, yaw: Math.atan2(bx - p2x, bz - p2z), vx: 0, vz: -4.5 },
        ballInit: {
          x: bx,
          y: by,
          z: bz,
          vx: -side * (0.6 + this._nextRng() * 0.6),
          vy: isAerialSetup ? (1.2 + this._nextRng() * 0.8) : (2.2 + this._nextRng() * 1.0),
          vz: -0.3,
        },
        p1BotCfg: { difficulty: 'medium', aggressiveness: 0.55 },
        p2BotCfg: { difficulty: 'hard', aggressiveness: 0.90 },
        aimMag: 0.90,
      });
    }

    // ─── CATEGORY 2: 16 South Torus Attacking Game Situations (Unscripted Goal Harvest) ───
    for (let i = 0; i < 16; i++) {
      const side = (i % 2 === 0) ? 1 : -1;
      const bType = ballCycle[i % ballCycle.length];
      const isAerialSetup = (i % 3 === 1);
      const bx = side * (4.1 + this._nextRng() * 1.4);
      const bz = 38.4 + this._nextRng() * 1.4;
      const bFloor = getCourtFloorY(bx, bz);
      const by = isAerialSetup ? (bFloor + 2.15 + this._nextRng() * 0.45) : (bFloor + 1.15 + this._nextRng() * 0.30);

      // Away (P2) attacks South when targetGoal === 'N'
      const p2x = bx + side * (0.95 + this._nextRng() * 0.35);
      const p2z = bz - (0.25 + this._nextRng() * 0.35);
      const aimYaw = Math.atan2(-bx, 40.0 - bz);

      const p1x = -side * (3.8 + this._nextRng() * 2.5);
      const p1z = 28.5 + this._nextRng() * 3.5;

      simulateScenario(this._harvestedGames.length, {
        category: 'goal_south',
        ballType: bType,
        ticks: 165,
        targetGoal: 'N',
        p1: { x: p1x, z: p1z, yaw: Math.atan2(bx - p1x, bz - p1z), vx: 0, vz: 4.5 },
        p2: { x: p2x, z: p2z, yaw: aimYaw, vx: Math.sin(aimYaw) * 3.2, vz: Math.cos(aimYaw) * 3.2 },
        ballInit: {
          x: bx,
          y: by,
          z: bz,
          vx: -side * (0.6 + this._nextRng() * 0.6),
          vy: isAerialSetup ? (1.2 + this._nextRng() * 0.8) : (2.2 + this._nextRng() * 1.0),
          vz: 0.3,
        },
        p1BotCfg: { difficulty: 'hard', aggressiveness: 0.90 },
        p2BotCfg: { difficulty: 'medium', aggressiveness: 0.55 },
        aimMag: 0.90,
      });
    }

    // ─── CATEGORY 3: 18 Contested Midcourt, Stream-Lane & Banked-Wall Rally Games ───
    for (let i = 0; i < 18; i++) {
      const isWallGame = i >= 12;
      const bType = i < 10 ? 'medium' : ballCycle[i % ballCycle.length];
      const side = (i % 2 === 0) ? 1 : -1;

      if (!isWallGame) {
        // Contested Midcourt & Stream-Ramp Rally: P1 South (facing North), P2 North (facing South), both 100% goal-side
        const serveToP1 = (i % 2 === 0);
        const p1x = side * (2.0 + this._nextRng() * 5.0);
        const p1z = 7.5 + this._nextRng() * 7.5;
        const p2x = -side * (2.0 + this._nextRng() * 5.0);
        const p2z = -7.5 - this._nextRng() * 7.5;

        const bx = serveToP1 ? (p1x * 0.7) : (p2x * 0.7);
        const bz = serveToP1 ? (p1z - 2.4) : (p2z + 2.4);
        const bFloor = getCourtFloorY(bx, bz);

        simulateScenario(this._harvestedGames.length, {
          category: 'rally',
          ballType: bType,
          ticks: 680,
          targetGoal: 'N',
          p1: { x: p1x, z: p1z, yaw: Math.PI, vx: 0, vz: -4.2 },
          p2: { x: p2x, z: p2z, yaw: 0, vx: 0, vz: 4.2 },
          ballInit: {
            x: bx,
            y: bFloor + 1.6 + this._nextRng() * 0.8,
            z: bz,
            vx: (serveToP1 ? (p1x - bx) : (p2x - bx)) * 1.8,
            vy: 3.2 + this._nextRng() * 1.8,
            vz: serveToP1 ? 4.5 : -4.5,
          },
          p1BotCfg: { difficulty: 'hard', aggressiveness: 0.94 },
          p2BotCfg: { difficulty: 'hard', aggressiveness: 0.94 },
          aimMag: 0.35,
        });
      } else {
        // High-Velocity Parabolic Banked Wall Carom Game
        const wallX = side * (13.2 + this._nextRng() * 1.6);
        const bz = -10.0 + this._nextRng() * 8.0;
        const bFloor = getCourtFloorY(wallX, bz);
        const p1x = side * (9.5 + this._nextRng() * 2.0);
        const p1z = bz + 7.5;
        const p2x = side * (8.0 + this._nextRng() * 2.5);
        const p2z = bz - 9.0;

        simulateScenario(this._harvestedGames.length, {
          category: 'wall_carom',
          ballType: i % 2 === 0 ? 'large' : bType,
          ticks: 280,
          targetGoal: 'N',
          p1: { x: p1x, z: p1z, yaw: Math.PI, vx: side * 2.0, vz: -5.5 },
          p2: { x: p2x, z: p2z, yaw: 0, vx: side * 1.5, vz: 4.5 },
          ballInit: {
            x: wallX,
            y: bFloor + 1.4,
            z: bz,
            vx: side * 4.5,
            vy: 2.5,
            vz: 13.5,
          },
          p1BotCfg: { difficulty: 'hard', aggressiveness: 0.95 },
          p2BotCfg: { difficulty: 'hard', aggressiveness: 0.95 },
          aimMag: 0.35,
        });
      }
    }

    // ─── CATEGORY 4: 12 Contested Diving Saves & Aerial Jump-Spike Duels (200 ticks each) ───
    for (let i = 0; i < 12; i++) {
      const isDive = i < 6;
      const side = (i % 2 === 0) ? 1 : -1;
      const bType = ballCycle[i % ballCycle.length];

      if (isDive) {
        // Defending bot (P2 in North or P1 in South) lunges laterally to dig a fast incoming shot
        const p1x = -side * 1.2;
        const p1z = 21.0 + this._nextRng() * 5.0;
        const bx = side * (2.4 + this._nextRng() * 1.0);
        const bz = p1z - 5.5;
        const bFloor = getCourtFloorY(bx, bz);

        simulateScenario(this._harvestedGames.length, {
          category: 'dive_save',
          ballType: bType,
          ticks: 200,
          targetGoal: 'N',
          p1: { x: p1x, z: p1z, yaw: Math.PI, vx: side * 5.2, vz: -3.5 },
          p2: { x: side * 3.0, z: p1z - 12.0, yaw: 0, vx: 0, vz: 5.0 },
          ballInit: {
            x: bx,
            y: bFloor + 1.6,
            z: bz,
            vx: side * 2.2,
            vy: 2.0,
            vz: 11.5,
          },
          p1BotCfg: { difficulty: 'hard', aggressiveness: 0.98 },
          p2BotCfg: { difficulty: 'hard', aggressiveness: 0.95 },
          aimMag: 0.40,
        });
      } else {
        // High Aerial Jump-Spike Duel: ball lofted high in front of charging attacker
        const p1x = side * (3.0 + this._nextRng() * 3.5);
        const p1z = -12.0 - this._nextRng() * 10.0;
        const bx = p1x - side * 0.4;
        const bz = p1z - 1.5;
        const bFloor = getCourtFloorY(bx, bz);

        simulateScenario(this._harvestedGames.length, {
          category: 'aerial_spike',
          ballType: bType,
          ticks: 200,
          targetGoal: 'N',
          p1: { x: p1x, z: p1z, yaw: Math.PI, vx: 0, vz: -4.8 },
          p2: { x: -side * 3.5, z: p1z - 9.0, yaw: 0, vx: 0, vz: 4.8 },
          ballInit: {
            x: bx,
            y: bFloor + 2.45 + this._nextRng() * 0.45,
            z: bz,
            vx: -side * 0.5,
            vy: 2.4 + this._nextRng() * 1.0,
            vz: -1.2,
          },
          p1BotCfg: { difficulty: 'hard', aggressiveness: 0.96 },
          p2BotCfg: { difficulty: 'hard', aggressiveness: 0.92 },
          aimMag: 0.55,
        });
      }
    }

    // Safety top-up loop: guarantee at least 6 North Torus goals and 6 South Torus goals
    let topUpGuard = 0;
    while ((northGoalsCount < 6 || southGoalsCount < 6) && topUpGuard < 24) {
      topUpGuard++;
      const needNorth = northGoalsCount < 6;
      const side = (topUpGuard % 2 === 0) ? 1 : -1;
      const bx = side * (4.4 + (topUpGuard % 3) * 0.4);
      const bz = needNorth ? (-38.8 - (topUpGuard % 2) * 0.4) : (38.8 + (topUpGuard % 2) * 0.4);
      const bFloor = getCourtFloorY(bx, bz);
      const by = bFloor + 1.25;
      const goalZ = needNorth ? -40.0 : 40.0;
      const aimYaw = Math.atan2(-bx, goalZ - bz);

      if (needNorth) {
        simulateScenario(this._harvestedGames.length, {
          category: 'goal_north',
          ballType: 'medium',
          ticks: 320,
          targetGoal: 'N',
          p1: { x: bx + side * 1.05, z: bz + 0.30, yaw: aimYaw, vx: Math.sin(aimYaw) * 3.5, vz: Math.cos(aimYaw) * 3.5 },
          p2: { x: -side * 4.5, z: -29.0, yaw: 0, vx: 0, vz: -4.0 },
          ballInit: { x: bx, y: by, z: bz, vx: -side * 0.8, vy: 2.5, z: bz, vz: -0.2 },
          p1BotCfg: { difficulty: 'medium', aggressiveness: 0.55 },
          p2BotCfg: { difficulty: 'hard', aggressiveness: 0.90 },
          aimMag: 0.95,
        });
      } else {
        simulateScenario(this._harvestedGames.length, {
          category: 'goal_south',
          ballType: 'medium',
          ticks: 260,
          targetGoal: 'N',
          p1: { x: -side * 4.5, z: 29.0, yaw: Math.PI, vx: 0, vz: 4.0 },
          p2: { x: bx + side * 1.05, z: bz - 0.30, yaw: aimYaw, vx: Math.sin(aimYaw) * 3.5, vz: Math.cos(aimYaw) * 3.5 },
          ballInit: { x: bx, y: by, z: bz, vx: -side * 0.8, vy: 2.5, vz: 0.2 },
          p1BotCfg: { difficulty: 'hard', aggressiveness: 0.90 },
          p2BotCfg: { difficulty: 'medium', aggressiveness: 0.55 },
          aimMag: 0.95,
        });
      }
    }

    // Restore clean match state
    if (matchState) {
      matchState.scoreHome = 0;
      matchState.scoreAway = 0;
      matchState.celebrationTicks = 0;
      matchState.lastScoredFor = null;
      matchState.lastGoalId = null;
      matchState.events.length = 0;
    }

    const elapsedSec = ((performance.now() - t0) / 1000).toFixed(2);
    console.log(
      `[Harvest] Simulated ${this._harvestedGames.length} unscripted games (${totalSimTicks} ticks = ${(totalSimTicks / 60).toFixed(1)}s gameplay) in ${elapsedSec}s! ` +
      `Yield: ${northGoalsCount} North Goals, ${southGoalsCount} South Goals, ${totalHitsCount} Real Strikes, ${spikeEventsCount} Aerial Spikes, ${diveEventsCount} Dive/Slide Ticks, ${wallCaromsCount} Wall Carom Ticks.`
    );

    this._mineHighlightsAndBuildSchedule();
    this._harvestReady = true;
    this.isActive = wasActive;

    return {
      gamesSimulated: this._harvestedGames.length,
      totalSimTicks,
      elapsedSec: Number(elapsedSec),
      northGoalsCount,
      southGoalsCount,
      totalHitsCount,
      spikeEventsCount,
      diveEventsCount,
      wallCaromsCount,
      scheduleCount: this._schedule.length,
      scheduleSummary: this._schedule.map((s) => ({
        cutIdx: s.cutIdx,
        name: s.name,
        frames: `${s.startFrame}-${s.endFrame}`,
        gameId: s.gameId,
        tickWindow: `${s.startTick}-${s.endTick}`,
        hits: s.hitsInClip,
        goal: s.goalInClip,
        maxBallStep: Number(s.maxBallStep.toFixed(3)),
        runningAwayTicks: s.runningAwayTicks,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. AUTOMATIC HIGHLIGHT MINER & BEAT-QUANTIZED SCHEDULE BUILDER
  // ═══════════════════════════════════════════════════════════════════════════

  _mineHighlightsAndBuildSchedule() {
    const usedRanges = [];
    const isOverlapping = (gameId, startTick, endTick) => {
      for (const u of usedRanges) {
        if (u.gameId === gameId && Math.max(startTick, u.startTick) < Math.min(endTick, u.endTick)) {
          return true;
        }
      }
      return false;
    };
    const markUsed = (gameId, startTick, endTick) => {
      usedRanges.push({ gameId, startTick, endTick });
    };

    const evaluateWindow = (game, startTick, len) => {
      const endTick = startTick + len;
      if (startTick < 0 || endTick > game.frames.length) return null;
      let maxBallStep = 0;
      let hitsInClip = 0;
      let airborneHits = 0;
      let diveTicks = 0;
      let p1DiveTicks = 0;
      let p2DiveTicks = 0;
      let wallTicks = 0;
      let runningAwayTicks = 0;
      let sumBallSpeed = 0;
      let sumAlign = 0;
      let p1Hits = 0;
      let p2Hits = 0;

      for (let t = startTick; t < endTick; t++) {
        const f = game.frames[t];
        if (t > startTick && f.teleported) return null; // HARD REJECT: zero respawns/teleports!
        if (t > startTick && f.ballStep > maxBallStep) maxBallStep = f.ballStep;
        if (f.hitBy !== -1) {
          hitsInClip++;
          if (f.hitBy === 0) p1Hits++;
          if (f.hitBy === 1) p2Hits++;
          if ((f.hitBy === 0 && !f.p1Grounded) || (f.hitBy === 1 && !f.p2Grounded)) {
            airborneHits++;
          }
        }
        if (f.p1Diving || f.p1Sliding) p1DiveTicks++;
        if (f.p2Diving || f.p2Sliding) p2DiveTicks++;
        if (f.p1Diving || f.p2Diving || f.p1Sliding || f.p2Sliding) diveTicks++;
        if (f.wallBounce || Math.abs(f.bx) > 12.2) wallTicks++;
        if (f.closerRunningAway) runningAwayTicks++;
        sumBallSpeed += f.bSpeed;
        sumAlign += Math.max(f.align1, f.align2);
      }

      return {
        gameId: game.id,
        game,
        startTick,
        endTick,
        maxBallStep,
        hitsInClip,
        p1Hits,
        p2Hits,
        airborneHits,
        diveTicks,
        p1DiveTicks,
        p2DiveTicks,
        wallTicks,
        runningAwayTicks,
        meanBallSpeed: sumBallSpeed / len,
        meanAlign: sumAlign / len,
      };
    };

    // Helper 1: Pick a genuine unscripted Torus Goal clip ('N' or 'S')
    const pickGoalClip = (goalDir, len, leadTicks = 22, extraTailTicks = 0) => {
      let best = null;
      let bestScore = -Infinity;

      for (const game of this._harvestedGames) {
        for (const g of game.goals) {
          if (g.goal !== goalDir) continue;
          const startTick = Math.max(2, g.tick - leadTicks);
          if (startTick + len + extraTailTicks > game.frames.length) continue;
          if (isOverlapping(game.id, startTick, startTick + len + extraTailTicks)) continue;

          const stats = evaluateWindow(game, startTick, len + extraTailTicks);
          if (!stats) continue;

          const score =
            1000 +
            stats.hitsInClip * 45 +
            stats.meanBallSpeed * 6 -
            stats.runningAwayTicks * 500;

          if (score > bestScore) {
            bestScore = score;
            best = {
              ...stats,
              endTick: startTick + len,
              goalTick: g.tick,
              goalInClip: g.goal,
              goalData: g,
            };
          }
        }
      }

      // Fallback if all distinct goals were used: allow reuse with highest score
      if (!best) {
        for (const game of this._harvestedGames) {
          for (const g of game.goals) {
            if (g.goal !== goalDir) continue;
            const startTick = Math.max(2, Math.min(g.tick - leadTicks, game.frames.length - len - extraTailTicks));
            if (startTick < 0) continue;
            const stats = evaluateWindow(game, startTick, len);
            if (!stats) continue;
            best = {
              ...stats,
              goalTick: g.tick,
              goalInClip: g.goal,
              goalData: g,
            };
            break;
          }
          if (best) break;
        }
      }

      if (best) {
        markUsed(best.gameId, best.startTick, best.endTick + extraTailTicks);
      }
      return best;
    };

    // Hero portraits frame the athlete chest-high from 2.35 m, so a stumble, a
    // crouch or a stalled T-pose fills the screen. Head-over-pelvis height and
    // hand spread in the recorded poses catch all three (an athlete in stride
    // reads ~0.56 m and ~0.8 m).
    const rigOrder = (typeof window !== 'undefined' && window.__vb?.athletes?.[0]?.ragdoll?.order) || [];
    const iHead = rigOrder.indexOf('head');
    const iPelvis = rigOrder.indexOf('pelvis');
    const iHandL = rigOrder.indexOf('handL');
    const iHandR = rigOrder.indexOf('handR');
    const heroPosture = (game, startTick, len, athleteIdx) => {
      if (iHead < 0 || iPelvis < 0 || iHandL < 0 || iHandR < 0) return { badFrac: 0, meanUpright: 0 };
      const base = athleteIdx * 17 + 1;
      let bad = 0;
      let uprightSum = 0;
      for (let t = startTick; t < startTick + len; t++) {
        const p = game.frames[t].poses;
        const upright = p[(base + iHead) * 7 + 1] - p[(base + iPelvis) * 7 + 1];
        const spread = Math.hypot(
          p[(base + iHandL) * 7] - p[(base + iHandR) * 7],
          p[(base + iHandL) * 7 + 2] - p[(base + iHandR) * 7 + 2]
        );
        uprightSum += upright;
        if (upright < 0.45 || spread > 1.35) bad++;
      }
      return { badFrac: bad / len, meanUpright: uprightSum / len };
    };

    // Helper 2: Pick best stunt or rally clip matching criteria
    const pickStuntClip = (len, mode, preferredBall = null) => {
      let best = null;
      let bestScore = -Infinity;

      const step = len >= 200 ? 12 : 6;
      for (const game of this._harvestedGames) {
        // Avoid consuming goal moments for non-goal cuts
        if (game.category === 'goal_north' || game.category === 'goal_south') continue;

        for (let st = 2; st + len <= game.frames.length; st += step) {
          if (isOverlapping(game.id, st, st + len)) continue;
          const stats = evaluateWindow(game, st, len);
          if (!stats) continue;

          let score =
            stats.hitsInClip * 45 +
            stats.meanBallSpeed * 4.5 +
            stats.meanAlign * 35 -
            stats.runningAwayTicks * 500;

          if (preferredBall && game.ballType === preferredBall) score += 25;

          if (mode === 'hero_p1') {
            if (stats.p1Hits < 1 || stats.p1DiveTicks > 0) continue;
            const posture = heroPosture(game, st, len, 0);
            if (posture.badFrac > 0.1) continue;
            // Reward P1 strike near middle of clip while upright
            const mid = st + Math.floor(len * 0.45);
            const fMid = game.frames[mid];
            score += stats.p1Hits * 80 + fMid.p1Speed * 12 + posture.meanUpright * 300;
          } else if (mode === 'hero_p2') {
            if (stats.p2Hits < 1 || stats.p2DiveTicks > 0) continue;
            const posture = heroPosture(game, st, len, 1);
            if (posture.badFrac > 0.1) continue;
            const mid = st + Math.floor(len * 0.45);
            const fMid = game.frames[mid];
            score += stats.p2Hits * 80 + fMid.p2Speed * 12 + posture.meanUpright * 300;
          } else if (mode === 'rally') {
            if (stats.hitsInClip < 1) continue;
            score += stats.hitsInClip * 65 + (stats.p1Hits > 0 && stats.p2Hits > 0 ? 90 : 0);
          } else if (mode === 'dive_save') {
            if (stats.diveTicks < 4) continue;
            score += stats.diveTicks * 18 + stats.hitsInClip * 60;
          } else if (mode === 'aerial_spike') {
            if (stats.airborneHits < 1 && stats.hitsInClip < 1) continue;
            score += stats.airborneHits * 140 + stats.hitsInClip * 50;
          } else if (mode === 'wall_carom') {
            if (stats.wallTicks < 8) continue;
            score += stats.wallTicks * 12 + stats.hitsInClip * 55;
          } else if (mode === 'strike_impact') {
            // Require a real strike around tick st + 4..34
            let hasEarlyHit = false;
            for (let k = st + Math.min(4, Math.floor(len * 0.15)); k < st + Math.min(34, Math.floor(len * 0.85)); k++) {
              if (game.frames[k]?.hitBy !== -1) {
                hasEarlyHit = true;
                break;
              }
            }
            if (!hasEarlyHit) continue;
            score += 120;
          }

          if (score > bestScore) {
            bestScore = score;
            best = {
              ...stats,
              goalTick: -1,
              goalInClip: null,
              goalData: null,
            };
          }
        }
      }

      // Secondary scored pass across all games (non-overlapping) if primary filter was exhausted
      if (!best) {
        const heroIdx = mode === 'hero_p1' ? 0 : mode === 'hero_p2' ? 1 : -1;
        for (const game of this._harvestedGames) {
          // A goal behind a hero portrait lights the GOAL banner mid-introduction
          if (heroIdx >= 0 && (game.category === 'goal_north' || game.category === 'goal_south')) continue;
          for (let st = 2; st + len <= game.frames.length; st += 6) {
            if (isOverlapping(game.id, st, st + len)) continue;
            const stats = evaluateWindow(game, st, len);
            if (!stats) continue;
            let score = stats.hitsInClip * 80 + stats.meanBallSpeed * 4 - stats.runningAwayTicks * 500 - (mode === 'hero_p1' ? stats.p1DiveTicks * 100 : 0) - (mode === 'hero_p2' ? stats.p2DiveTicks * 100 : 0);
            if (heroIdx >= 0) {
              const posture = heroPosture(game, st, len, heroIdx);
              score += posture.meanUpright * 300 - posture.badFrac * 2000;
            }
            if (score > bestScore) {
              bestScore = score;
              best = { ...stats, goalTick: -1, goalInClip: null, goalData: null };
            }
          }
        }
      }

      if (best) {
        markUsed(best.gameId, best.startTick, best.endTick);
      }
      return best;
    };

    // ─── DEFINE ALL 43 BEAT-QUANTIZED CUTS (5,028 FRAMES = 83.800s) ───
    const cutSpecs = [
      // PHASE 1: MONUMENTAL ARCHITECTURAL OVERTURE & CONTENDER INTRO (0:00.00 - 44.20s)
      { name: 'P1_Shot1_NorthTorusCathedral', startFrame: 0, endFrame: 216, camMode: 'arch_north', mineMode: 'rally', paletteIdx: 0, ballType: 'medium', scoreHome: 0, scoreAway: 0 },
      { name: 'P1_Shot2_RedHeroPortrait', startFrame: 216, endFrame: 432, camMode: 'hero_p1', mineMode: 'hero_p1', paletteIdx: 0, ballType: 'medium', scoreHome: 0, scoreAway: 0 },
      { name: 'P1_Shot3_BlueHeroPortrait', startFrame: 432, endFrame: 648, camMode: 'hero_p2', mineMode: 'hero_p2', paletteIdx: 0, ballType: 'medium', scoreHome: 0, scoreAway: 0 },
      { name: 'P1_Shot4_StreamRampsRallyGlide', startFrame: 648, endFrame: 1080, camMode: 'ramps_glide', mineMode: 'rally', paletteIdx: 0, ballType: 'medium', scoreHome: 0, scoreAway: 0 },
      { name: 'P1_Shot5_TurfSidelineRallyGlide', startFrame: 1080, endFrame: 1512, camMode: 'turf_sideline', mineMode: 'rally', paletteIdx: 0, ballType: 'medium', scoreHome: 0, scoreAway: 0 },
      { name: 'P1_Shot6_StadiumBoomArcRally', startFrame: 1512, endFrame: 2160, camMode: 'boom_arc', mineMode: 'rally', paletteIdx: 0, ballType: 'medium', scoreHome: 0, scoreAway: 0 },
      { name: 'P1_Shot7_PreDropTensionPush', startFrame: 2160, endFrame: 2652, camMode: 'predrop_push', mineMode: 'rally', paletteIdx: 0, ballType: 'medium', scoreHome: 0, scoreAway: 0 },

      // PHASE 2: RHYTHMIC ACTION ESCALATION (44.20s - 62.20s | Ten 1.800s = 108-Frame Bar Cuts)
      { name: 'P2_Cut8_DropAttackSprint', startFrame: 2652, endFrame: 2760, camMode: 'ots_sprint', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 0, scoreAway: 0 },
      { name: 'P2_Cut9_LowTurfDivingSave', startFrame: 2760, endFrame: 2868, camMode: 'low_dive', mineMode: 'dive_save', paletteIdx: 0, ballType: 'medium', scoreHome: 0, scoreAway: 0 },
      { name: 'P2_Cut10_VerticalAerialSpike', startFrame: 2868, endFrame: 2976, camMode: 'vertical_spike', mineMode: 'aerial_spike', paletteIdx: 1, ballType: 'small', scoreHome: 0, scoreAway: 0 },
      { name: 'P2_Cut11_BankedWallCarom', startFrame: 2976, endFrame: 3084, camMode: 'wall_carom', mineMode: 'wall_carom', paletteIdx: 2, ballType: 'large', scoreHome: 0, scoreAway: 0 },
      { name: 'P2_Cut12_Goal1_SouthTorus', startFrame: 3084, endFrame: 3192, camMode: 'goal_south', mineMode: 'goal_S', paletteIdx: 3, ballType: 'medium', scoreHome: 1, scoreAway: 0 },
      { name: 'P2_Cut13_CounterCutTurfSpray', startFrame: 3192, endFrame: 3300, camMode: 'low_cut', mineMode: 'strike_impact', paletteIdx: 4, ballType: 'small', scoreHome: 1, scoreAway: 0 },
      { name: 'P2_Cut14_Goal2_NorthTorus', startFrame: 3300, endFrame: 3408, camMode: 'goal_north', mineMode: 'goal_N', paletteIdx: 5, ballType: 'medium', scoreHome: 1, scoreAway: 1 },
      { name: 'P2_Cut15_HeavyBallClash', startFrame: 3408, endFrame: 3516, camMode: 'duel_side', mineMode: 'strike_impact', paletteIdx: 6, ballType: 'large', scoreHome: 1, scoreAway: 1 },
      { name: 'P2_Cut16_Goal3_SouthTorus', startFrame: 3516, endFrame: 3624, camMode: 'goal_south_west', mineMode: 'goal_S', paletteIdx: 7, ballType: 'small', scoreHome: 2, scoreAway: 1 },
      { name: 'P2_Cut17_GoalMoundDig', startFrame: 3624, endFrame: 3732, camMode: 'mound_defense', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 2, scoreAway: 1 },

      // PHASE 3: RAPID STACCATO CLIMAX BLITZ (62.20s - 76.60s | 12 Half-Bars + 4 Quarter-Notes + 8 Eighth-Notes)
      { name: 'P3_HB1_PowerVolley', startFrame: 3732, endFrame: 3786, camMode: 'ots_sprint', mineMode: 'strike_impact', paletteIdx: 1, ballType: 'medium', scoreHome: 2, scoreAway: 1 },
      { name: 'P3_HB2_TurfDiveSave', startFrame: 3786, endFrame: 3840, camMode: 'low_dive', mineMode: 'dive_save', paletteIdx: 2, ballType: 'small', scoreHome: 2, scoreAway: 1 },
      { name: 'P3_HB3_WallRebound', startFrame: 3840, endFrame: 3894, camMode: 'wall_carom', mineMode: 'wall_carom', paletteIdx: 3, ballType: 'large', scoreHome: 2, scoreAway: 1 },
      { name: 'P3_HB4_Goal4_NorthTorus', startFrame: 3894, endFrame: 3948, camMode: 'goal_north_east', mineMode: 'goal_N_hb', paletteIdx: 4, ballType: 'medium', scoreHome: 2, scoreAway: 2 },
      { name: 'P3_HB5_AerialSpikeSmash', startFrame: 3948, endFrame: 4002, camMode: 'vertical_spike', mineMode: 'aerial_spike', paletteIdx: 5, ballType: 'small', scoreHome: 2, scoreAway: 2 },
      { name: 'P3_HB6_StreamRampCharge', startFrame: 4002, endFrame: 4056, camMode: 'low_cut', mineMode: 'strike_impact', paletteIdx: 6, ballType: 'medium', scoreHome: 2, scoreAway: 2 },
      { name: 'P3_HB7_MidcourtCounter', startFrame: 4056, endFrame: 4110, camMode: 'duel_side', mineMode: 'strike_impact', paletteIdx: 7, ballType: 'large', scoreHome: 2, scoreAway: 2 },
      { name: 'P3_HB8_LowSlideScoop', startFrame: 4110, endFrame: 4164, camMode: 'low_dive', mineMode: 'dive_save', paletteIdx: 1, ballType: 'small', scoreHome: 2, scoreAway: 2 },
      { name: 'P3_HB9_Goal5_SouthTorus', startFrame: 4164, endFrame: 4218, camMode: 'goal_south', mineMode: 'goal_S_hb', paletteIdx: 2, ballType: 'medium', scoreHome: 3, scoreAway: 2 },
      { name: 'P3_HB10_NetMouthBlock', startFrame: 4218, endFrame: 4272, camMode: 'mound_defense', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'large', scoreHome: 3, scoreAway: 2 },
      { name: 'P3_HB11_FlankCutSpray', startFrame: 4272, endFrame: 4326, camMode: 'low_cut', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 3, scoreAway: 2 },
      { name: 'P3_HB12_HighAerialLeap', startFrame: 4326, endFrame: 4380, camMode: 'vertical_spike', mineMode: 'aerial_spike', paletteIdx: 0, ballType: 'medium', scoreHome: 3, scoreAway: 2 },

      // Quarter-Notes (73.00s - 74.80s | 4 x 27 frames)
      { name: 'P3_QN1_Strike', startFrame: 4380, endFrame: 4407, camMode: 'ots_sprint', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 3, scoreAway: 2 },
      { name: 'P3_QN2_Strike', startFrame: 4407, endFrame: 4434, camMode: 'duel_side', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 3, scoreAway: 2 },
      { name: 'P3_QN3_Strike', startFrame: 4434, endFrame: 4461, camMode: 'low_cut', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 3, scoreAway: 2 },
      { name: 'P3_QN4_Strike', startFrame: 4461, endFrame: 4488, camMode: 'vertical_spike', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 3, scoreAway: 2 },

      // Eighth-Notes (74.80s - 76.60s | 8 cuts = 108 frames)
      { name: 'P3_EN1_Blitz', startFrame: 4488, endFrame: 4501, camMode: 'ots_sprint', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 3, scoreAway: 2 },
      { name: 'P3_EN2_Blitz', startFrame: 4501, endFrame: 4515, camMode: 'low_dive', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 3, scoreAway: 2 },
      { name: 'P3_EN3_Blitz', startFrame: 4515, endFrame: 4528, camMode: 'duel_side', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 3, scoreAway: 2 },
      { name: 'P3_EN4_Blitz', startFrame: 4528, endFrame: 4542, camMode: 'vertical_spike', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 3, scoreAway: 2 },
      { name: 'P3_EN5_Blitz', startFrame: 4542, endFrame: 4555, camMode: 'low_cut', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 3, scoreAway: 2 },
      { name: 'P3_EN6_Blitz', startFrame: 4555, endFrame: 4569, camMode: 'mound_defense', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 3, scoreAway: 2 },
      { name: 'P3_EN7_Blitz', startFrame: 4569, endFrame: 4582, camMode: 'ots_sprint', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 3, scoreAway: 2 },
      { name: 'P3_EN8_Blitz', startFrame: 4582, endFrame: 4596, camMode: 'vertical_spike', mineMode: 'strike_impact', paletteIdx: 0, ballType: 'medium', scoreHome: 3, scoreAway: 2 },

      // PHASE 4: CLIMAX GOAL #6 & CELESTIAL ASCENSION (76.60s - 83.80s)
      { name: 'P4_Cut18_ClimaxGoal6_NorthTorus', startFrame: 4596, endFrame: 4704, camMode: 'goal_north_climax', mineMode: 'goal_N_climax', paletteIdx: 0, ballType: 'medium', scoreHome: 4, scoreAway: 2 },
      { name: 'P4_Cut19_CelestialAscension', startFrame: 4704, endFrame: 5028, camMode: 'celestial_ascension', mineMode: 'continuation', paletteIdx: 0, ballType: 'medium', scoreHome: 4, scoreAway: 2 },
    ];

    this._schedule = [];
    let climaxClip = null;

    for (let i = 0; i < cutSpecs.length; i++) {
      const spec = cutSpecs[i];
      const len = spec.endFrame - spec.startFrame;
      let clip = null;

      if (spec.mineMode === 'goal_N') {
        clip = pickGoalClip('N', len, 22, 0);
      } else if (spec.mineMode === 'goal_S') {
        clip = pickGoalClip('S', len, 22, 0);
      } else if (spec.mineMode === 'goal_N_hb') {
        clip = pickGoalClip('N', len, 16, 0);
      } else if (spec.mineMode === 'goal_S_hb') {
        clip = pickGoalClip('S', len, 16, 0);
      } else if (spec.mineMode === 'goal_N_climax') {
        // Reserve 324 extra tail ticks so Cut 19 continues seamlessly from the exact same game!
        clip = pickGoalClip('N', len, 22, 324) || pickGoalClip('N', len, 22, 0);
        climaxClip = clip;
      } else if (spec.mineMode === 'continuation' && climaxClip) {
        const contStart = Math.min(climaxClip.endTick, climaxClip.game.frames.length - len);
        const stats = evaluateWindow(climaxClip.game, Math.max(0, contStart), len);
        clip = {
          ...(stats || climaxClip),
          gameId: climaxClip.gameId,
          game: climaxClip.game,
          startTick: Math.max(0, contStart),
          endTick: Math.max(0, contStart) + len,
          goalTick: -1,
          goalInClip: null,
          goalData: null,
        };
      } else {
        clip = pickStuntClip(len, spec.mineMode, spec.ballType);
      }

      if (!clip) {
        clip = pickStuntClip(len, 'rally', null);
      }

      // Compute anchor frame metadata for smooth camera framing
      const anchorOffset = clip.goalTick >= 0
        ? (clip.goalTick - clip.startTick)
        : Math.min(len - 1, Math.floor(len * 0.35));
      const anchorFrame = clip.game.frames[clip.startTick + Math.max(0, anchorOffset)] || clip.game.frames[clip.startTick];

      this._schedule.push({
        cutIdx: i,
        ...spec,
        len,
        gameId: clip.gameId,
        game: clip.game,
        startTick: clip.startTick,
        endTick: clip.endTick,
        goalTick: clip.goalTick,
        goalInClip: clip.goalInClip,
        goalData: clip.goalData,
        maxBallStep: clip.maxBallStep || 0,
        hitsInClip: clip.hitsInClip || 0,
        runningAwayTicks: clip.runningAwayTicks || 0,
        anchorFrame,
      });
    }
  }

  _getScheduleEntryForFrame(frame) {
    const f = Math.max(0, Math.min(5027, frame));
    for (let i = 0; i < this._schedule.length; i++) {
      const s = this._schedule[i];
      if (f >= s.startFrame && f < s.endFrame) return s;
    }
    return this._schedule[this._schedule.length - 1] || null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. COSMETICS, SCOREBOARDS & DETERMINISTIC REPLAY SYNCHRONIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  _applyTeamPalette(paletteIndex = 0) {
    const p = this._palettes[paletteIndex % this._palettes.length];
    if (!p || typeof window === 'undefined' || !window.__vb) return;
    const athletes = window.__vb.athletes;
    if (athletes && athletes.length >= 2) {
      athletes[0].setTeamAndVariant('home', p.homeVariant, { primaryColor: p.homeColor });
      athletes[1].setTeamAndVariant('away', p.awayVariant, { primaryColor: p.awayColor });
      if (p.homeHeadwear && athletes[0].setHeadwear) athletes[0].setHeadwear(p.homeHeadwear);
      if (p.awayHeadwear && athletes[1].setHeadwear) athletes[1].setHeadwear(p.awayHeadwear);
    }
    if (TUNING.athlete?.palette) {
      TUNING.athlete.palette.homePrimary = p.homeColor;
      TUNING.athlete.palette.awayPrimary = p.awayColor;
    }
    if (TUNING.teams) {
      if (TUNING.teams.home) TUNING.teams.home.primaryColor = p.homeColor;
      if (TUNING.teams.away) TUNING.teams.away.primaryColor = p.awayColor;
    }
  }

  _setMatchBall(ballType = 'medium') {
    if (typeof window === 'undefined' || !window.__vb?.setActiveMatchBall) return;
    window.__vb.setActiveMatchBall(ballType);
  }

  /**
   * Called inside fixedUpdate (60 Hz) before athlete.prePhysicsUpdate.
   * Syncs the active harvested clip's physical state for turf particles, scoreboards,
   * and goal celebration rings.
   */
  choreographTick(tick, dt, athletes, balls, matchState) {
    if (!this.isActive || !athletes || athletes.length < 2 || !balls || balls.length === 0) return;

    const frame = this._tickCount;
    this._tickCount++;
    this.elapsedTime = frame / 60.0;
    this._tickStepped = true;

    if (!this._harvestReady || this._schedule.length === 0) return;

    const entry = this._getScheduleEntryForFrame(frame);
    if (!entry) return;

    const localTick = frame - entry.startFrame;
    const clipTick = Math.min(entry.game.frames.length - 1, entry.startTick + localTick);
    const f = entry.game.frames[clipTick];
    if (!f) return;

    // On hard cut boundary: switch palette, headwear, and ball size to match the cut
    if (this._stagedCut !== entry.cutIdx) {
      this._stagedCut = entry.cutIdx;
      this._applyTeamPalette(entry.paletteIdx);
      this._setMatchBall(entry.game.ballType || entry.ballType || 'medium');
    }

    // Sync matchState scoreboard & clock
    if (matchState) {
      matchState.isCountingDown = false;
      matchState.countdownTicksRemaining = 0;
      matchState.matchOver = false;
      matchState.ticksRemaining = Math.max(60, Math.round((180 - this.elapsedTime) * 60));

      // Before goalTick in a goal cut, display pre-goal score; at/after goalTick, display new score!
      if (entry.goalTick >= 0 && clipTick < entry.goalTick) {
        const prevEntry = this._schedule[Math.max(0, entry.cutIdx - 1)];
        matchState.scoreHome = prevEntry ? prevEntry.scoreHome : 0;
        matchState.scoreAway = prevEntry ? prevEntry.scoreAway : 0;
      } else {
        matchState.scoreHome = entry.scoreHome;
        matchState.scoreAway = entry.scoreAway;
      }

      // Trigger genuine Torus Hoop Goal Celebration on the exact hoop-crossing tick!
      if (entry.goalTick >= 0 && clipTick === entry.goalTick && entry.goalData) {
        const gKey = `goal_cut_${entry.cutIdx}`;
        if (!this._firedEvents.has(gKey)) {
          this._firedEvents.add(gKey);
          const hoopPos = {
            x: 0,
            y: TUNING.match?.hoopCenterY ?? 10.0,
            z: entry.goalData.goal === 'N' ? -40.0 : 40.0,
          };
          matchState.celebrationTicks = 150;
          matchState.lastScoredFor = entry.goalData.scoredFor || 'home';
          matchState.lastGoalId = entry.goalData.goal;
          if (window.__vb?.goalCelebration?.triggerGoal) {
            window.__vb.goalCelebration.triggerGoal(matchState.lastScoredFor, hoopPos, {
              y: entry.goalData.y,
              z: entry.goalData.z,
            });
          }
          this.addImpulse(0.55);
        }
      }
    }

    if (f.hitBy !== -1) {
      this.addImpulse(0.28);
    }

    // Sync motor & ragdoll bodies to the recorded pose so pelvis never separates from motor
    const activeBall = window.__vb?.balls?.[0] || balls[0];
    this._applyPoseArray(f.poses, athletes, activeBall, true);

    if (athletes[0]?.motor?.body) {
      athletes[0].motor.body.setLinvel({ x: f.p1vx, y: f.p1vy, z: f.p1vz }, true);
      athletes[0].motor.grounded = f.p1Grounded;
    }
    if (athletes[1]?.motor?.body) {
      athletes[1].motor.body.setLinvel({ x: f.p2vx, y: f.p2vy, z: f.p2vz }, true);
      athletes[1].motor.grounded = f.p2Grounded;
    }

    // Keep physical ball away from X = 0 during stepPhysics so updateScoring doesn't double-fire
    if (activeBall?.body) {
      const safeBx = Math.abs(f.bx) < 1.2 ? (f.bx >= 0 ? 2.5 : -2.5) : f.bx;
      activeBall.body.setTranslation({ x: safeBx, y: f.by, z: f.bz }, true);
      activeBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. RENDER-PASS POSE APPLICATION & CINEMATIC CAMERA FRAMING
  // ═══════════════════════════════════════════════════════════════════════════

  update(dt, ball, athletes = [], matchState = null) {
    if (!this.isActive) return;

    if (!this._tickStepped) {
      this.elapsedTime += dt;
      this._tickCount = Math.round(this.elapsedTime * 60);
    }
    this._tickStepped = false;

    const frame = Math.max(0, Math.min(5027, this._tickCount - 1));
    const t = frame / 60.0;

    if (this._harvestReady && this._schedule.length > 0) {
      const entry = this._getScheduleEntryForFrame(frame);
      if (entry) {
        const localTick = frame - entry.startFrame;
        const localProgress = localTick / Math.max(1, entry.len - 1);
        const clipTick = Math.min(entry.game.frames.length - 1, entry.startTick + localTick);
        const f = entry.game.frames[clipTick];

        if (this._currentCut !== entry.cutIdx) {
          this._currentCut = entry.cutIdx;
          this._justCut = true;
        } else {
          this._justCut = false;
        }

        const activeBall = window.__vb?.balls?.[0] || ball;
        if (f && athletes.length >= 2) {
          this._applyPoseArray(f.poses, athletes, activeBall);
          // In Shot 1 (North Torus Cathedral Arch), hide the ball so the architectural shot is pure
          if (entry.camMode === 'arch_north' && activeBall?.mesh) {
            activeBall.mesh.position.set(0, -200, 0);
          } else if (activeBall?.mesh && f.hitBy !== -1) {
            activeBall._emissiveFlash = 0.85;
          }
        }

        let fov = 50;
        fov = this._computeCameraForEntry(entry, f, localTick, localProgress, athletes);

        // Clamp camera safely above local parabolic court floor
        const camFloorY = getCourtFloorY(this._pos.x, this._pos.z);
        if (this._pos.y < camFloorY + 0.85) {
          this._pos.y = camFloorY + 0.85;
        }

        // Smooth camera within each cut; snap cleanly on hard cut boundaries
        if (this._justCut || this._smoothPos.lengthSq() === 0) {
          this._smoothPos.copy(this._pos);
          this._smoothTarget.copy(this._target);
        } else {
          const posAlpha = entry.camMode.startsWith('goal_') || entry.camMode === 'arch_north' || entry.camMode === 'celestial_ascension'
            ? 0.25
            : 0.18;
          const lookAlpha = 0.22;
          this._smoothPos.lerp(this._pos, posAlpha);
          this._smoothTarget.lerp(this._target, lookAlpha);
        }

        const finalFloorY = getCourtFloorY(this._smoothPos.x, this._smoothPos.z);
        if (this._smoothPos.y < finalFloorY + 0.85) {
          this._smoothPos.y = finalFloorY + 0.85;
        }

        this.camera.position.copy(this._smoothPos);
        this.camera.lookAt(this._smoothTarget);

        // Subtle kinetic impact micro-shake (strictly positional)
        if (this.trauma > 0.001) {
          const shake = this.trauma * this.trauma * 0.14;
          this.camera.position.x += Math.sin(t * 53.0) * shake;
          this.camera.position.y += Math.cos(t * 47.0) * shake * 0.7;
          this.trauma = Math.max(0, this.trauma - dt * 2.8);
        }

        if (Math.abs(this.camera.fov - fov) > 0.01) {
          this.camera.fov = fov;
          this.camera.updateProjectionMatrix();
        }
      }
    }

    // Fade overlay management
    if (typeof document !== 'undefined') {
      const fadeEl = document.getElementById('trailer-fade-overlay');
      if (fadeEl) {
        let opacity = 0;
        if (t < 1.2) opacity = Math.max(0, 1.0 - t / 1.2);
        else if (t >= 83.0 && t <= 84.2) opacity = Math.min(1.0, (t - 83.0) / 0.8);
        fadeEl.style.opacity = opacity.toFixed(3);
      }
    }
  }

  _computeCameraForEntry(entry, f, localTick, u, athletes = []) {
    const lt = localTick / 60.0;
    const af = entry.anchorFrame || f;

    // Read exact rendered pelvis & head positions from live ragdoll rig (already synced by _applyPoseArray)
    const p1Pelvis = athletes[0]?.ragdoll?.rig?.get('pelvis')?.interpolated?.currPos;
    const p1Head = athletes[0]?.ragdoll?.rig?.get('head')?.interpolated?.currPos;
    const p2Pelvis = athletes[1]?.ragdoll?.rig?.get('pelvis')?.interpolated?.currPos;
    const p2Head = athletes[1]?.ragdoll?.rig?.get('head')?.interpolated?.currPos;

    const p1x = p1Pelvis ? p1Pelvis.x : (f.poses ? f.poses[7] : f.p1x);
    const p1y = p1Pelvis ? p1Pelvis.y : (f.poses ? f.poses[8] : f.p1y);
    const p1z = p1Pelvis ? p1Pelvis.z : (f.poses ? f.poses[9] : f.p1z);
    const p1HeadY = p1Head ? p1Head.y : (p1y + 0.55);

    const p2x = p2Pelvis ? p2Pelvis.x : (f.poses ? f.poses[126] : f.p2x);
    const p2y = p2Pelvis ? p2Pelvis.y : (f.poses ? f.poses[127] : f.p2y);
    const p2z = p2Pelvis ? p2Pelvis.z : (f.poses ? f.poses[128] : f.p2z);
    const p2HeadY = p2Head ? p2Head.y : (p2y + 0.55);

    const clampedTarget = (hx, hy, hz, maxH = 0.65, maxV = 0.50) => {
      const dx = f.bx - hx;
      const dz = f.bz - hz;
      const d = Math.hypot(dx, dz) || 1;
      const r = Math.min(d, maxH);
      const ox = (dx / d) * r;
      const oz = (dz / d) * r;
      const oy = Math.max(-0.20, Math.min(maxV, (f.by - hy) * 0.35));
      this._target.set(hx + ox, hy + 0.32 + oy, hz + oz);
    };

    switch (entry.camMode) {
      case 'arch_north': {
        // Shot 1 (0:00 - 03.60s): North Torus Cathedral Arch from 3/4 East flank
        this._pos.set(13.8 - u * 2.2, 6.4 + u * 1.4, -24.5 - u * 4.0);
        this._target.set(0.0, 10.2, -40.0);
        return 46;
      }

      case 'hero_p1': {
        // Shot 2 (03.60 - 07.20s): Red Contender Macro Hero Portrait (Football Helmet / wrestler_bands)
        const dirX = Math.sin(f.p1Yaw);
        const dirZ = Math.cos(f.p1Yaw);
        const rightX = dirZ;
        const rightZ = -dirX;
        const chestY = p1y * 0.35 + p1HeadY * 0.65;
        this._pos.set(
          p1x + dirX * 2.35 + rightX * 1.25,
          chestY + 0.08,
          p1z + dirZ * 2.35 + rightZ * 1.25
        );
        this._target.set(p1x, chestY, p1z);
        return 38;
      }

      case 'hero_p2': {
        // Shot 3 (07.20 - 10.80s): Blue Contender Macro Hero Portrait (Cricket Helmet / wicket_grill)
        const dirX = Math.sin(f.p2Yaw);
        const dirZ = Math.cos(f.p2Yaw);
        const leftX = -dirZ;
        const leftZ = dirX;
        const chestY = p2y * 0.35 + p2HeadY * 0.65;
        this._pos.set(
          p2x + dirX * 2.35 + leftX * 1.25,
          chestY + 0.08,
          p2z + dirZ * 2.35 + leftZ * 1.25
        );
        this._target.set(p2x, chestY, p2z);
        return 38;
      }

      case 'ramps_glide': {
        // Shot 4 (10.80 - 18.00s): Elevated 3/4 Stream Ramps Glide tracking live rally
        const focusX = f.bx * 0.55 + (p1x + p2x) * 0.225;
        const focusZ = f.bz * 0.55 + (p1z + p2z) * 0.225;
        const focusFloor = getCourtFloorY(focusX, focusZ);
        this._pos.set(
          -14.5 + u * 5.0,
          focusFloor + 6.8 - u * 2.2,
          focusZ - 11.0 + u * 8.0
        );
        this._target.set(focusX, focusFloor + 1.6, focusZ);
        return 48;
      }

      case 'turf_sideline': {
        // Shot 5 (18.00 - 25.20s): Ultra-Low Turf-Level Sideline Glide tracking live midcourt rally
        const focusX = f.bx * 0.60 + (p1x + p2x) * 0.20;
        const focusZ = f.bz * 0.60 + (p1z + p2z) * 0.20;
        const camX = 11.5 - u * 2.0;
        const camZ = focusZ * 0.65 - 3.5 + u * 7.0;
        const camFloor = getCourtFloorY(camX, camZ);
        this._pos.set(camX, camFloor + 1.10, camZ);
        this._target.set(focusX, getCourtFloorY(focusX, focusZ) + 1.35, focusZ);
        return 46;
      }

      case 'boom_arc': {
        // Shot 6 (25.20 - 36.00s): Monumental Stadium Boom Arc framing the multi-hit rally
        const angle = -0.75 + u * 1.55;
        const radius = 21.0 - u * 3.0;
        const focusX = f.bx * 0.50 + (p1x + p2x) * 0.25;
        const focusZ = f.bz * 0.50 + (p1z + p2z) * 0.25;
        this._pos.set(
          Math.cos(angle) * radius,
          18.5 - u * 4.5,
          Math.sin(angle) * radius
        );
        this._target.set(focusX * 0.65, getCourtFloorY(focusX, focusZ) + 1.8, focusZ * 0.65);
        return 52;
      }

      case 'predrop_push': {
        // Shot 7 (36.00 - 44.20s): Low Pre-Drop Tension Push into the active rally clash
        const focusX = f.bx * 0.60 + (p1x + p2x) * 0.20;
        const focusZ = f.bz * 0.60 + (p1z + p2z) * 0.20;
        const dist = 10.5 - u * 4.8;
        const camX = focusX + 6.5 - u * 2.5;
        const camZ = focusZ + dist * 0.65;
        const camFloor = getCourtFloorY(camX, camZ);
        this._pos.set(camX, camFloor + 1.25, camZ);
        this._target.set(focusX, getCourtFloorY(focusX, focusZ) + 1.45, focusZ);
        return 50 - u * 6;
      }

      // ─── 3/4 FLANK TORUS GOAL CAMERAS (ALL 6 GENUINE GOALS) ───
      case 'goal_south': {
        const flankSign = (af.bx >= 0) ? 1 : -1;
        this._pos.set(flankSign * (14.2 - lt * 1.2), 11.2 - lt * 0.3, 27.8 + lt * 1.4);
        this._target.set(f.bx * 0.28, 10.0, 39.6);
        return 48;
      }

      case 'goal_south_west': {
        const flankSign = (af.bx >= 0) ? 1 : -1;
        this._pos.set(flankSign * (14.8 - lt * 1.4), 10.8 + lt * 0.4, 28.2 + lt * 1.2);
        this._target.set(f.bx * 0.28, 10.1, 39.7);
        return 48;
      }

      case 'goal_north': {
        const flankSign = (af.bx >= 0) ? 1 : -1;
        this._pos.set(flankSign * (14.2 - lt * 1.2), 11.2 - lt * 0.3, -27.8 - lt * 1.4);
        this._target.set(f.bx * 0.28, 10.0, -39.6);
        return 48;
      }

      case 'goal_north_east': {
        const flankSign = (af.bx >= 0) ? 1 : -1;
        this._pos.set(flankSign * (13.8 - lt * 1.2), 11.0 + lt * 0.3, -28.4 - lt * 1.2);
        this._target.set(f.bx * 0.28, 10.0, -39.7);
        return 48;
      }

      case 'goal_north_climax': {
        const flankSign = (af.bx >= 0) ? 1 : -1;
        this._pos.set(flankSign * (13.6 - lt * 1.4), 10.8 + lt * 0.4, -27.5 - lt * 1.5);
        this._target.set(f.bx * 0.25, 10.1, -39.8);
        return 46;
      }

      case 'celestial_ascension': {
        // Cut 19 (78.40 - 83.80s): Celestial Ascension Pullback over the live arena
        const ease = u * u * (3 - 2 * u);
        this._pos.set(
          -12.0 * (1 - ease) + Math.sin(ease * 1.8) * 14.0,
          11.2 + ease * 31.0,
          -28.0 + ease * 48.0
        );
        // Aim from the north hoop to centre court: after the goal the ball can
        // fly anywhere, and following it left this shot on empty turf and sky.
        this._target.set(
          0,
          10.0 * (1 - ease) + 2.5 * ease,
          -40.0 * (1 - ease)
        );
        return 46 + ease * 10;
      }

      // ─── CLOSE DYNAMIC STUNT CAMERAS (PHASE 2 & PHASE 3) ───
      case 'ots_sprint': {
        const d1 = Math.hypot(af.bx - af.p1x, af.bz - af.p1z);
        const d2 = Math.hypot(af.bx - af.p2x, af.bz - af.p2z);
        const useP1 = d1 <= d2;
        const hx = useP1 ? p1x : p2x;
        const hy = Math.max(getCourtFloorY(hx, useP1 ? p1z : p2z) + 0.92, useP1 ? p1y : p2y);
        const hz = useP1 ? p1z : p2z;
        const toBx = af.bx - (useP1 ? af.p1x : af.p2x);
        const toBz = af.bz - (useP1 ? af.p1z : af.p2z);
        const len = Math.hypot(toBx, toBz) || 1;
        const nx = toBx / len;
        const nz = toBz / len;
        const rx = nz;
        const rz = -nx;
        const camX = hx - nx * (3.6 - u * 0.6) + rx * 1.3;
        const camZ = hz - nz * (3.6 - u * 0.6) + rz * 1.3;
        const camFloor = getCourtFloorY(camX, camZ);
        this._pos.set(camX, camFloor + 1.50, camZ);
        clampedTarget(hx, hy, hz, 0.75, 0.45);
        return 52;
      }

      case 'low_dive': {
        const useP1 = f.p1Diving || f.p1Sliding || (Math.hypot(af.bx - af.p1x, af.bz - af.p1z) <= Math.hypot(af.bx - af.p2x, af.bz - af.p2z));
        const hx = useP1 ? p1x : p2x;
        const hy = Math.max(getCourtFloorY(hx, useP1 ? p1z : p2z) + 0.65, useP1 ? p1y : p2y);
        const hz = useP1 ? p1z : p2z;
        const side = hx >= 0 ? -1 : 1;
        const camX = hx + side * 3.8;
        const camZ = hz + (hz >= 0 ? -2.0 : 2.0) + lt * 1.0;
        const camFloor = getCourtFloorY(camX, camZ);
        this._pos.set(camX, camFloor + 0.92, camZ);
        clampedTarget(hx, hy, hz, 0.65, 0.35);
        return 46;
      }

      case 'vertical_spike': {
        const d1 = Math.hypot(af.bx - af.p1x, af.bz - af.p1z);
        const d2 = Math.hypot(af.bx - af.p2x, af.bz - af.p2z);
        const useP1 = (!f.p1Grounded && f.p2Grounded) ? true : ((!f.p2Grounded && f.p1Grounded) ? false : (d1 <= d2));
        const hx = useP1 ? p1x : p2x;
        const hy = Math.max(getCourtFloorY(hx, useP1 ? p1z : p2z) + 0.92, useP1 ? p1y : p2y);
        const hz = useP1 ? p1z : p2z;
        const side = hx >= 0 ? -1 : 1;
        const camX = hx + side * 3.5;
        const camZ = hz + (hz >= 0 ? -2.6 : 2.6);
        const camFloor = getCourtFloorY(camX, camZ);
        this._pos.set(camX, camFloor + 0.95, camZ);
        clampedTarget(hx, hy, hz, 0.70, 0.65);
        return 50;
      }

      case 'wall_carom': {
        const side = af.bx >= 0 ? 1 : -1;
        const camX = side * 9.5;
        const camZ = f.bz + (af.bvz >= 0 ? -5.2 : 5.2);
        const camFloor = getCourtFloorY(camX, camZ);
        this._pos.set(camX, camFloor + 1.75, camZ);
        this._target.set(f.bx * 0.65 + p1x * 0.35, getCourtFloorY(f.bx, f.bz) + 1.4, f.bz);
        return 54;
      }

      case 'low_cut': {
        const d1 = Math.hypot(af.bx - af.p1x, af.bz - af.p1z);
        const d2 = Math.hypot(af.bx - af.p2x, af.bz - af.p2z);
        const useP1 = d1 <= d2;
        const hx = useP1 ? p1x : p2x;
        const hy = Math.max(getCourtFloorY(hx, useP1 ? p1z : p2z) + 0.92, useP1 ? p1y : p2y);
        const hz = useP1 ? p1z : p2z;
        const side = hx >= 0 ? -1 : 1;
        const camX = hx + side * 3.6;
        const camZ = hz + (hz >= 0 ? -2.6 : 2.6);
        const camFloor = getCourtFloorY(camX, camZ);
        this._pos.set(camX, camFloor + 1.15, camZ);
        clampedTarget(hx, hy, hz, 0.65, 0.40);
        return 48;
      }

      case 'duel_side': {
        const midX = (p1x + p2x) * 0.25 + f.bx * 0.50;
        const midZ = (p1z + p2z) * 0.25 + f.bz * 0.50;
        const side = midX >= 0 ? -1 : 1;
        const camX = midX + side * (5.2 - u * 0.8);
        const camZ = midZ + 1.8 - u * 3.6;
        const camFloor = getCourtFloorY(camX, camZ);
        this._pos.set(camX, camFloor + 1.45, camZ);
        this._target.set(midX, getCourtFloorY(midX, midZ) + 1.45, midZ);
        return 50;
      }

      case 'mound_defense':
      default: {
        const d1 = Math.hypot(af.bx - af.p1x, af.bz - af.p1z);
        const d2 = Math.hypot(af.bx - af.p2x, af.bz - af.p2z);
        const useP1 = d1 <= d2;
        const hx = useP1 ? p1x : p2x;
        const hy = Math.max(getCourtFloorY(hx, useP1 ? p1z : p2z) + 0.92, useP1 ? p1y : p2y);
        const hz = useP1 ? p1z : p2z;
        const side = hx >= 0 ? -1 : 1;
        const camX = hx + side * 4.2;
        const camZ = hz + (hz >= 0 ? -3.0 : 3.0);
        const camFloor = getCourtFloorY(camX, camZ);
        this._pos.set(camX, camFloor + 1.45, camZ);
        clampedTarget(hx, hy, hz, 0.70, 0.45);
        return 50;
      }
    }
  }
}

export const trailerDirector = new TrailerDirector();
