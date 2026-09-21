import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';

// Pre-allocated scratch objects for zero-allocation hot path
const _vec1 = new THREE.Vector3();
const _vec2 = new THREE.Vector3();
const _vec3 = new THREE.Vector3();
const _scratchPos = new THREE.Vector3();
const _scratchVel = new THREE.Vector3();

// Fixed values for hoops based on game rules
const HOOP_RADIUS = 4.667;
const HOOP_CENTER_Y = 10.0;
const HOOP_N_POS = new THREE.Vector3(0, HOOP_CENTER_Y, -40.0);
const HOOP_S_POS = new THREE.Vector3(0, HOOP_CENTER_Y, 40.0);

export const STREAM_LANES = {
    WEST_X: -12.5,
    EAST_X: 12.5,
};

export const STREAM_HEADS = {
    SW: { x: -12.78, y: 8.24, z: 39.96 },
    SE: { x: 12.78, y: 8.24, z: 39.96 },
    NW: { x: -12.78, y: 8.24, z: -39.96 },
    NE: { x: 12.78, y: 8.24, z: -39.96 },
};

function wrapAngle(a) {
    const t = (a + Math.PI) % (2 * Math.PI);
    return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

// ═══ LONG-HORIZON TRAJECTORY SAMPLES (Zero-Allocation Circular Buffer) ═══
export const TRAJECTORY_SAMPLES_COUNT = 160;
export const TRAJECTORY_STEP_TICKS = 3;
export const TRAJECTORY_DT = TRAJECTORY_STEP_TICKS * (1 / 60); // 0.05 seconds

/**
 * Creates a complete perception struct with dedicated vector objects and
 * 160 pre-allocated long-horizon trajectory sample nodes.
 */
export function createPerception() {
    const trajectorySamples = [];
    for (let i = 0; i < TRAJECTORY_SAMPLES_COUNT; i++) {
        trajectorySamples.push({
            tick: i * TRAJECTORY_STEP_TICKS,
            time: i * TRAJECTORY_DT,
            pos: new THREE.Vector3(),
            vel: new THREE.Vector3(),
            isGrounded: false,
            isBounce: false,
            isApex: false,
            inStreamLane: false,
            inHoopAperture: false,
        });
    }

    return {
        self: {
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            speed: 0,
            grounded: true,
            weight: 1.0,
            isRecovering: false,
            facingYaw: 0
        },
        opponent: {
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            speed: 0
        },
        match: {
            targetGoal: 'N',
            scoreHome: 0,
            scoreAway: 0,
            ticksRemaining: 0,
            isCountingDown: false,
            matchOver: false
        },
        ball: {
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            angularVelocity: new THREE.Vector3(),
            speed: 0,
            heightAboveGround: 0,
            radius: 0.5,
            mass: 2.0,
            id: 'medium',
            peakY: 0,
            ticksToApex: 0,
            isRising: false,
            isFalling: false
        },
        hoops: {
            attackGoalPos: new THREE.Vector3(),
            defendGoalPos: new THREE.Vector3(),
            vecToAttackGoal: new THREE.Vector3(0, 0, -1),
            vecToDefendGoal: new THREE.Vector3(0, 0, 1),
            isHome: false,
            hoopRadius: HOOP_RADIUS,
            hoopCenterY: HOOP_CENTER_Y
        },
        stream: {
            nearestLaneX: -12.5,
            attackStreamHead: new THREE.Vector3(),
            defendStreamHead: new THREE.Vector3(),
            isInStreamLane: false,
            isAtStreamHead: false,
            isFinishingZone: false,
        },
        goalSide: {
            isGoalSide: true,
            signedDistBehindBall: 0.0,
            angleToDefendGoal: 0.0,
            facingDefendGoal: false,
        },
        ballPhysicsProfile: {
            decelFactor: 1.0,
            maxApproachSpeed: 1.0,
            brakingDistance: 1.0,
            strikeReach: 2.0,
        },
        ballIntercept: {
            position: new THREE.Vector3(),
            ticksToArrive: 0,
            reachable: false
        },
        trajectory: {
            samples: trajectorySamples,
            count: TRAJECTORY_SAMPLES_COUNT,
            firstTouchBy: 'self',
            possessionWindow: 0.0,
            earliestInterceptTickSelf: 0,
            earliestInterceptPosSelf: new THREE.Vector3(),
            earliestInterceptTickOpp: 0,
            earliestInterceptPosOpp: new THREE.Vector3(),
            trajectoryInvalidatedTick: Infinity,
            defensiveBlockTarget: new THREE.Vector3(),
            opponentShotVector: new THREE.Vector3(),
            nextApexPos: new THREE.Vector3(),
            hasApex: false,
            ticksToNextApex: 0,
            nextBouncePos: new THREE.Vector3(),
            hasBounce: false,
            ticksToNextBounce: 0,
        },
        threat: 0,
        opportunity: 0
    };
}

// Fallback singleton for backwards compatibility
const _defaultPerception = createPerception();

/**
 * Predict ball position after a given number of ticks
 */
export function projectBallPosition(ballPos, ballVel, ticks, gravityY, outVec = _vec1) {
    const time = ticks * (1 / 60); // Assuming 60Hz tick rate
    outVec.copy(ballPos);
    outVec.x += ballVel.x * time;
    outVec.y += ballVel.y * time + 0.5 * gravityY * time * time;
    outVec.z += ballVel.z * time;
    return outVec;
}

/**
 * Approximates the valley court terrain surface height (Y in meters) given Z coordinate.
 * Measured directly from arena.glb COL_Court collision mesh:
 *   |Z| <= 10: Y = 0.0m (flat central basin)
 *   |Z| = 20:  Y ≈ 1.5m
 *   |Z| = 30:  Y ≈ 4.0m
 *   |Z| = 40:  Y ≈ 7.8m (Hoop aperture at Y = 10.0m)
 *   |Z| >= 50: Y ≈ 10.0 - 10.8m (high corner boundaries)
 */
export function getCourtFloorY(z) {
    const az = Math.abs(z);
    if (az <= 10.0) return 0.0;
    if (az >= 50.0) return 10.0;
    const u = (az - 10.0) / 40.0;
    return 10.0 * Math.pow(u, 1.35);
}

const _simPos = new THREE.Vector3();
const _simVel = new THREE.Vector3();
const _simNormal = new THREE.Vector3();

/**
 * Simulates a long-horizon (480 ticks / 8.0 seconds) multi-bounce ballistic & rolling
 * trajectory across 3D terrain topography with restitution and quadratic drag.
 */
export function simulateLongHorizonTrajectory(ballPos, ballVel, ballRadius, ballId, destTrajectory, maxTicks = 480) {
    const trajectory = destTrajectory || _defaultPerception.trajectory;
    const restitution = ballId === 'large' ? 0.85 : 0.88;
    const linearDrag = ballId === 'large' ? 0.010 : (ballId === 'small' ? 0.015 : 0.012);
    const gravityY = TUNING?.physics?.gravityY ?? -12.0;

    _simPos.copy(ballPos);
    _simVel.copy(ballVel);

    let hasApex = false;
    let nextApexTick = 0;
    let hasBounce = false;
    let nextBounceTick = 0;

    for (let i = 0; i < TRAJECTORY_SAMPLES_COUNT; i++) {
        const sample = trajectory.samples[i];
        sample.isBounce = false;
        sample.isApex = false;
        sample.isGrounded = false;
        sample.inHoopAperture = false;

        if (i === 0) {
            sample.pos.copy(_simPos);
            sample.vel.copy(_simVel);
            sample.inStreamLane = Math.abs(Math.abs(_simPos.x) - 12.5) <= 3.0;
            continue;
        }

        const prevVelY = _simVel.y;
        const dt = TRAJECTORY_DT;

        // Quadratic drag
        const speed = _simVel.length();
        if (speed > 1e-3) {
            const dragDecel = linearDrag * speed * speed;
            const factor = Math.max(0, 1.0 - (dragDecel * dt) / speed);
            _simVel.x *= factor;
            _simVel.z *= factor;
        }

        // Gravity
        _simVel.y += gravityY * dt;

        // Step position
        _simPos.x += _simVel.x * dt;
        _simPos.y += _simVel.y * dt;
        _simPos.z += _simVel.z * dt;

        // Lateral side walls (at X ≈ ±16.0)
        if (_simPos.x < -16.0) {
            _simPos.x = -16.0;
            if (_simVel.x < 0) _simVel.x = -_simVel.x * restitution;
        } else if (_simPos.x > 16.0) {
            _simPos.x = 16.0;
            if (_simVel.x > 0) _simVel.x = -_simVel.x * restitution;
        }

        // End boundaries (at Z ≈ ±52.0)
        if (_simPos.z < -52.0) {
            _simPos.z = -52.0;
            if (_simVel.z < 0) _simVel.z = -_simVel.z * restitution;
        } else if (_simPos.z > 52.0) {
            _simPos.z = 52.0;
            if (_simVel.z > 0) _simVel.z = -_simVel.z * restitution;
        }

        // Terrain collision check
        const floorY = getCourtFloorY(_simPos.z) + ballRadius;
        const az = Math.abs(_simPos.z);
        const slopeYPerZ = (az > 10.0 && az < 50.0)
            ? Math.sign(_simPos.z) * 0.3375 * Math.pow((az - 10.0) / 40.0, 0.35)
            : 0;
        
        const normLen = Math.hypot(1.0, slopeYPerZ);
        _simNormal.set(0, 1.0 / normLen, -slopeYPerZ / normLen);

        if (_simPos.y <= floorY) {
            _simPos.y = floorY;
            const vDotN = _simVel.dot(_simNormal);
            if (vDotN < 0) {
                if (Math.abs(vDotN) > 0.8) {
                    // Restitution bounce
                    _simVel.addScaledVector(_simNormal, -(1.0 + restitution) * vDotN);
                    _simVel.multiplyScalar(0.95);
                    sample.isBounce = true;
                    if (!hasBounce) {
                        hasBounce = true;
                        nextBounceTick = sample.tick;
                        trajectory.nextBouncePos.copy(_simPos);
                    }
                } else {
                    // Rolling contact along terrain
                    _simVel.addScaledVector(_simNormal, -vDotN);
                    const slopeAccZ = -gravityY * _simNormal.z;
                    _simVel.z += slopeAccZ * dt;
                    _simVel.multiplyScalar(Math.max(0, 1.0 - 0.05 * dt * 60));
                    sample.isGrounded = true;
                }
            }
        }

        // Apex detection
        if (prevVelY > 0 && _simVel.y <= 0) {
            sample.isApex = true;
            if (!hasApex) {
                hasApex = true;
                nextApexTick = sample.tick;
                trajectory.nextApexPos.copy(_simPos);
            }
        }

        // Stream lane detection (|X| ≈ 12.5)
        sample.inStreamLane = Math.abs(Math.abs(_simPos.x) - 12.5) <= 3.0;

        // Hoop aperture detection
        const distToHoopN = Math.hypot(_simPos.x, _simPos.y - HOOP_CENTER_Y, _simPos.z - (-40.0));
        const distToHoopS = Math.hypot(_simPos.x, _simPos.y - HOOP_CENTER_Y, _simPos.z - 40.0);
        sample.inHoopAperture = distToHoopN <= HOOP_RADIUS || distToHoopS <= HOOP_RADIUS;

        sample.pos.copy(_simPos);
        sample.vel.copy(_simVel);
    }

    trajectory.hasApex = hasApex;
    trajectory.ticksToNextApex = nextApexTick;
    trajectory.hasBounce = hasBounce;
    trajectory.ticksToNextBounce = nextBounceTick;
}

/**
 * Game-Theoretic Reachability & Opponent Trajectory Mutation Solver.
 * Compares arrival times of self vs opponent along future trajectory nodes.
 */
export function evaluateOpponentContest(selfPos, selfVel, oppPos, oppVel, defendGoalPos, destTrajectory, hasOpponent = true) {
    const trajectory = destTrajectory || _defaultPerception.trajectory;
    let earliestSelfTick = Infinity;
    let earliestOppTick = Infinity;
    let selfNodeIdx = -1;
    let oppNodeIdx = -1;

    const selfSpeed = 5.4;
    const oppSpeed = 5.4;

    for (let i = 0; i < TRAJECTORY_SAMPLES_COUNT; i++) {
        const sample = trajectory.samples[i];
        const t = sample.time;

        // Self reachability
        const distSelf = Math.hypot(sample.pos.x - selfPos.x, sample.pos.z - selfPos.z);
        const timeToReachSelf = 0.12 + distSelf / selfSpeed;
        if (timeToReachSelf <= t && earliestSelfTick === Infinity) {
            earliestSelfTick = sample.tick;
            selfNodeIdx = i;
        }

        // Opponent reachability
        if (hasOpponent) {
            const distOpp = Math.hypot(sample.pos.x - oppPos.x, sample.pos.z - oppPos.z);
            const timeToReachOpp = 0.12 + distOpp / oppSpeed;
            if (timeToReachOpp <= t && earliestOppTick === Infinity) {
                earliestOppTick = sample.tick;
                oppNodeIdx = i;
            }
        }

        if (earliestSelfTick !== Infinity && earliestOppTick !== Infinity) {
            break;
        }
    }

    if (earliestSelfTick === Infinity) {
        earliestSelfTick = 480;
        selfNodeIdx = TRAJECTORY_SAMPLES_COUNT - 1;
    }
    if (earliestOppTick === Infinity) {
        earliestOppTick = 480;
        oppNodeIdx = TRAJECTORY_SAMPLES_COUNT - 1;
    }

    trajectory.earliestInterceptTickSelf = earliestSelfTick;
    trajectory.earliestInterceptPosSelf.copy(trajectory.samples[selfNodeIdx].pos);

    trajectory.earliestInterceptTickOpp = earliestOppTick;
    trajectory.earliestInterceptPosOpp.copy(trajectory.samples[oppNodeIdx].pos);

    const timeSelf = earliestSelfTick * (1 / 60);
    const timeOpp = earliestOppTick * (1 / 60);
    const deltaT = timeOpp - timeSelf;
    trajectory.possessionWindow = deltaT;

    if (deltaT > 0.3 || !hasOpponent) {
        trajectory.firstTouchBy = 'self';
        trajectory.trajectoryInvalidatedTick = Infinity;
    } else if (deltaT < -0.25) {
        trajectory.firstTouchBy = 'opponent';
        trajectory.trajectoryInvalidatedTick = earliestOppTick;

        // Opponent will strike from earliestInterceptPosOpp toward defendGoalPos
        const oppPosTarget = trajectory.samples[oppNodeIdx].pos;
        trajectory.opponentShotVector
            .set(defendGoalPos.x - oppPosTarget.x, 0, defendGoalPos.z - oppPosTarget.z)
            .normalize();

        // Position defensively along shot vector: 55% between opponent and defending net
        const blockZ = defendGoalPos.z > 0
            ? Math.min(36.0, Math.max(16.0, oppPosTarget.z + 0.55 * (defendGoalPos.z - oppPosTarget.z)))
            : Math.max(-36.0, Math.min(-16.0, oppPosTarget.z + 0.55 * (defendGoalPos.z - oppPosTarget.z)));
        const blockX = oppPosTarget.x * 0.45;
        trajectory.defensiveBlockTarget.set(blockX, getCourtFloorY(blockZ), blockZ);
    } else {
        trajectory.firstTouchBy = 'contested';
        trajectory.trajectoryInvalidatedTick = Math.min(earliestSelfTick, earliestOppTick);
    }
}

export function buildPerception(ownAthlete, opponentAthlete, activeBalls, matchState, tick, destPerception = _defaultPerception) {
    const perception = destPerception || _defaultPerception;

    // Self
    if (ownAthlete && ownAthlete.motor && ownAthlete.motor.body) {
        const t = ownAthlete.motor.body.translation();
        perception.self.position.set(t.x, t.y, t.z);
        
        const v = ownAthlete.motor.body.linvel();
        perception.self.velocity.set(v.x, v.y, v.z);
        
        perception.self.speed = perception.self.velocity.length();
        perception.self.grounded = !!ownAthlete.motor.grounded;
        
        perception.self.weight = ownAthlete.tracker ? ownAthlete.tracker.weight : 1.0;
        perception.self.isRecovering = perception.self.weight < 0.5;
        
        perception.self.facingYaw = ownAthlete.animTarget ? ownAthlete.animTarget.yaw : 0;
    }

    // Opponent
    if (opponentAthlete && opponentAthlete.motor && opponentAthlete.motor.body) {
        const t = opponentAthlete.motor.body.translation();
        perception.opponent.position.set(t.x, t.y, t.z);
        
        const v = opponentAthlete.motor.body.linvel();
        perception.opponent.velocity.set(v.x, v.y, v.z);
        
        perception.opponent.speed = perception.opponent.velocity.length();
    } else {
        perception.opponent.position.set(0, 0, 0);
        perception.opponent.velocity.set(0, 0, 0);
        perception.opponent.speed = 0;
    }

    // Match State
    if (matchState) {
        perception.match.targetGoal = matchState.targetGoal || 'N';
        perception.match.scoreHome = matchState.scoreHome || 0;
        perception.match.scoreAway = matchState.scoreAway || 0;
        perception.match.ticksRemaining = matchState.ticksRemaining || 0;
        perception.match.isCountingDown = !!matchState.isCountingDown;
        perception.match.matchOver = !!matchState.matchOver;
    }

    // Hoops: accurately determine Home vs Away
    const isHome = ownAthlete?.team ? (ownAthlete.team === 'home') : (ownAthlete?.id === 'p1');
    perception.hoops.isHome = isHome;

    const target = perception.match.targetGoal || 'N';
    const attackGoal = isHome ? target : (target === 'N' ? 'S' : 'N');
    const defendGoal = attackGoal === 'N' ? 'S' : 'N';

    perception.hoops.attackGoalPos.copy(attackGoal === 'N' ? HOOP_N_POS : HOOP_S_POS);
    perception.hoops.defendGoalPos.copy(defendGoal === 'N' ? HOOP_N_POS : HOOP_S_POS);

    // Compute dynamic normalized line-of-action vectors from athlete to goals
    const selfX = perception.self.position.x;
    const selfZ = perception.self.position.z;
    const toAtkX = perception.hoops.attackGoalPos.x - selfX;
    const toAtkZ = perception.hoops.attackGoalPos.z - selfZ;
    const atkLen = Math.hypot(toAtkX, toAtkZ) || 1.0;
    perception.hoops.vecToAttackGoal.set(toAtkX / atkLen, 0, toAtkZ / atkLen);

    const toDefX = perception.hoops.defendGoalPos.x - selfX;
    const toDefZ = perception.hoops.defendGoalPos.z - selfZ;
    const defLen = Math.hypot(toDefX, toDefZ) || 1.0;
    perception.hoops.vecToDefendGoal.set(toDefX / defLen, 0, toDefZ / defLen);

    // Ball
    let nearestBall = null;
    let minSqDist = Infinity;

    if (activeBalls && activeBalls.length > 0) {
        for (let i = 0; i < activeBalls.length; i++) {
            const b = activeBalls[i];
            if (!b || !b.body) continue;
            
            const t = b.body.translation();
            _scratchPos.set(t.x, t.y, t.z);
            
            const sqDist = _scratchPos.distanceToSquared(perception.self.position);
            if (sqDist < minSqDist) {
                minSqDist = sqDist;
                nearestBall = b;
            }
        }
    }

    if (nearestBall) {
        const t = nearestBall.body.translation();
        perception.ball.position.set(t.x, t.y, t.z);
        
        const v = nearestBall.body.linvel();
        perception.ball.velocity.set(v.x, v.y, v.z);
        
        const angV = nearestBall.body.angvel ? nearestBall.body.angvel() : {x:0,y:0,z:0};
        perception.ball.angularVelocity.set(angV.x, angV.y, angV.z);
        
        perception.ball.id = nearestBall.id || (nearestBall.radius <= 0.3 ? 'small' : (nearestBall.radius >= 0.6 ? 'large' : 'medium'));
        perception.ball.radius = nearestBall.radius || 0.5;
        perception.ball.mass = nearestBall.body.mass ? nearestBall.body.mass() : (nearestBall.mass || 2.0);
        perception.ball.speed = perception.ball.velocity.length();
        perception.ball.heightAboveGround = perception.ball.position.y - perception.ball.radius;

        // Trajectory apex and vertical state
        const peakTime = perception.ball.velocity.y > 0 ? perception.ball.velocity.y / 12.0 : 0;
        perception.ball.peakY = perception.ball.position.y + (perception.ball.velocity.y > 0 ? (perception.ball.velocity.y * perception.ball.velocity.y) / 24.0 : 0);
        perception.ball.ticksToApex = Math.round(peakTime * 60);
        perception.ball.isRising = perception.ball.velocity.y > 1.2;
        perception.ball.isFalling = perception.ball.velocity.y < -1.2;

        // ═══ LONG-HORIZON (5-10s / 480 TICKS) TRAJECTORY & RACE-TO-BALL SOLVER ═══
        simulateLongHorizonTrajectory(
            perception.ball.position,
            perception.ball.velocity,
            perception.ball.radius,
            perception.ball.id,
            perception.trajectory,
            480
        );

        const hasOpponent = !!(opponentAthlete && opponentAthlete.motor && opponentAthlete.motor.body);
        evaluateOpponentContest(
            perception.self.position,
            perception.self.velocity,
            perception.opponent.position,
            perception.opponent.velocity,
            perception.hoops.defendGoalPos,
            perception.trajectory,
            hasOpponent
        );

        // Assign primary intercept to earliest reachable self arrival point
        perception.ballIntercept.position.copy(perception.trajectory.earliestInterceptPosSelf);
        perception.ballIntercept.ticksToArrive = perception.trajectory.earliestInterceptTickSelf;
        perception.ballIntercept.reachable = perception.trajectory.earliestInterceptTickSelf < 480;

        // Line-of-action vectors
        perception.hoops.vecToAttackGoal
            .set(perception.hoops.attackGoalPos.x - perception.ballIntercept.position.x, 0, perception.hoops.attackGoalPos.z - perception.ballIntercept.position.z)
            .normalize();
        if (perception.hoops.vecToAttackGoal.lengthSq() === 0) {
            perception.hoops.vecToAttackGoal.set(0, 0, attackGoal === 'N' ? -1 : 1);
        }

        perception.hoops.vecToDefendGoal
            .set(perception.hoops.defendGoalPos.x - perception.ball.position.x, 0, perception.hoops.defendGoalPos.z - perception.ball.position.z)
            .normalize();
        if (perception.hoops.vecToDefendGoal.lengthSq() === 0) {
            perception.hoops.vecToDefendGoal.set(0, 0, defendGoal === 'N' ? -1 : 1);
        }

        // Threat (0..1)
        if (perception.ball.speed > 0.1) {
            _vec2.copy(perception.ball.velocity).normalize();
            _vec3.copy(perception.hoops.defendGoalPos).sub(perception.ball.position).normalize();
            const dot = _vec2.dot(_vec3);
            perception.threat = Math.max(0, dot);
        } else {
            perception.threat = 0;
        }
        // If opponent reaches the ball first, boost defensive threat ONLY if ball is moving toward or in our defending half
        if (perception.trajectory.firstTouchBy === 'opponent') {
            const toDefZ = perception.hoops.defendGoalPos.z - perception.ball.position.z;
            const ballMovingToDef = (perception.ball.velocity.z * Math.sign(toDefZ)) > 0.3;
            const ballInOurCourt = perception.hoops.defendGoalPos.z > 0
                ? perception.ball.position.z > 0.0
                : perception.ball.position.z < -0.0;
            if (ballMovingToDef || ballInOurCourt) {
                perception.threat = Math.max(perception.threat, 0.70);
            }
        }

        // Opportunity (0..1)
        _vec2.copy(perception.ball.position).sub(perception.self.position);
        const distToBall = _vec2.length();
        let opp = 1.0 - Math.min(1.0, distToBall / 10.0);
        
        const hDiff = Math.abs(perception.ball.position.y - 1.0);
        opp *= (1.0 - Math.min(1.0, hDiff / 5.0));
        
        perception.opportunity = Math.max(0, Math.min(1.0, opp));

        // Stream Geometry & Landmarks
        const ballX = perception.ball.position.x;
        const ballZ = perception.ball.position.z;
        const nearestLaneX = ballX < 0 ? STREAM_LANES.WEST_X : STREAM_LANES.EAST_X;
        perception.stream.nearestLaneX = nearestLaneX;
        perception.stream.isInStreamLane = Math.abs(ballX - nearestLaneX) <= 4.0;

        // Choose attack stream head (matching ball side X)
        const isAttackNorth = attackGoal === 'N';
        const atkHead = isAttackNorth
            ? (ballX < 0 ? STREAM_HEADS.NW : STREAM_HEADS.NE)
            : (ballX < 0 ? STREAM_HEADS.SW : STREAM_HEADS.SE);
        perception.stream.attackStreamHead.set(atkHead.x, atkHead.y, atkHead.z);

        const defHead = isAttackNorth
            ? (ballX < 0 ? STREAM_HEADS.SW : STREAM_HEADS.SE)
            : (ballX < 0 ? STREAM_HEADS.NW : STREAM_HEADS.NE);
        perception.stream.defendStreamHead.set(defHead.x, defHead.y, defHead.z);

        // Distance to attacking stream head
        const distToAtkHead = Math.hypot(ballX - atkHead.x, ballZ - atkHead.z);
        perception.stream.isAtStreamHead = distToAtkHead <= 6.0;

        // Finishing zone: attacking third (|Z| >= 22m toward attack goal)
        const inAttackingHalfZ = isAttackNorth ? ballZ <= -22.0 : ballZ >= 22.0;
        perception.stream.isFinishingZone = inAttackingHalfZ;

        // Goal-Side Metrics & Own-Goal Guard
        const signZ = isAttackNorth ? -1 : 1; // positive direction towards attack goal
        const signedDist = signZ * (ballZ - selfZ);
        perception.goalSide.signedDistBehindBall = signedDist;
        const isLateral = Math.abs(selfX - ballX) >= 0.9;
        perception.goalSide.isGoalSide = signedDist >= -0.4 || isLateral;

        // Facing vs Defending Goal Angle Check
        const yawToDefend = Math.atan2(toDefX, toDefZ);
        const facingYaw = perception.self.facingYaw;
        const angleDiff = Math.abs(wrapAngle(facingYaw - yawToDefend));
        perception.goalSide.angleToDefendGoal = angleDiff;
        perception.goalSide.facingDefendGoal = angleDiff < (70 * Math.PI / 180);

        // Ball-Size Specific Physics & Approach Profiles
        const bRadius = perception.ball.radius;
        if (perception.ball.id === 'small' || bRadius <= 0.3) {
            perception.ballPhysicsProfile.decelFactor = 0.65;
            perception.ballPhysicsProfile.maxApproachSpeed = 0.70;
            perception.ballPhysicsProfile.brakingDistance = 1.8;
            perception.ballPhysicsProfile.strikeReach = 1.35;
        } else if (perception.ball.id === 'large' || bRadius >= 0.6) {
            perception.ballPhysicsProfile.decelFactor = 1.0;
            perception.ballPhysicsProfile.maxApproachSpeed = 1.0;
            perception.ballPhysicsProfile.brakingDistance = 0.8;
            perception.ballPhysicsProfile.strikeReach = 2.3;
        } else {
            perception.ballPhysicsProfile.decelFactor = 0.85;
            perception.ballPhysicsProfile.maxApproachSpeed = 0.88;
            perception.ballPhysicsProfile.brakingDistance = 1.2;
            perception.ballPhysicsProfile.strikeReach = 1.85;
        }

    } else {
        // Safe defaults if no ball
        perception.ball.position.set(0, 0, 0);
        perception.ball.velocity.set(0, 0, 0);
        perception.ball.speed = 0;
        perception.ball.heightAboveGround = 0;
        perception.ballIntercept.reachable = false;
        perception.threat = 0;
        perception.opportunity = 0;
    }

    return perception;
}
