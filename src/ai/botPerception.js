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

// Return struct, mutated in place to avoid allocations
const _perception = {
    ball: {
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
        radius: 0.5,
        mass: 1.0,
        speed: 0,
        heightAboveGround: 0
    },
    self: {
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        speed: 0,
        grounded: false,
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
    hoops: {
        attackGoalPos: new THREE.Vector3(),
        defendGoalPos: new THREE.Vector3(),
        hoopRadius: HOOP_RADIUS,
        hoopCenterY: HOOP_CENTER_Y
    },
    ballIntercept: {
        position: new THREE.Vector3(),
        ticksToArrive: 0,
        reachable: false
    },
    threat: 0,
    opportunity: 0
};

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

export function buildPerception(ownAthlete, opponentAthlete, activeBalls, matchState, tick) {
    // Self
    if (ownAthlete && ownAthlete.motor && ownAthlete.motor.body) {
        const t = ownAthlete.motor.body.translation();
        _perception.self.position.set(t.x, t.y, t.z);
        
        const v = ownAthlete.motor.body.linvel();
        _perception.self.velocity.set(v.x, v.y, v.z);
        
        _perception.self.speed = _perception.self.velocity.length();
        _perception.self.grounded = !!ownAthlete.motor.grounded;
        
        _perception.self.weight = ownAthlete.tracker ? ownAthlete.tracker.weight : 1.0;
        _perception.self.isRecovering = _perception.self.weight < 0.5;
        
        _perception.self.facingYaw = ownAthlete.animTarget ? ownAthlete.animTarget.yaw : 0;
    }

    // Opponent
    if (opponentAthlete && opponentAthlete.motor && opponentAthlete.motor.body) {
        const t = opponentAthlete.motor.body.translation();
        _perception.opponent.position.set(t.x, t.y, t.z);
        
        const v = opponentAthlete.motor.body.linvel();
        _perception.opponent.velocity.set(v.x, v.y, v.z);
        
        _perception.opponent.speed = _perception.opponent.velocity.length();
    } else {
        _perception.opponent.position.set(0, 0, 0);
        _perception.opponent.velocity.set(0, 0, 0);
        _perception.opponent.speed = 0;
    }

    // Match State
    if (matchState) {
        _perception.match.targetGoal = matchState.targetGoal || 'N';
        _perception.match.scoreHome = matchState.scoreHome || 0;
        _perception.match.scoreAway = matchState.scoreAway || 0;
        _perception.match.ticksRemaining = matchState.ticksRemaining || 0;
        _perception.match.isCountingDown = !!matchState.isCountingDown;
        _perception.match.matchOver = !!matchState.matchOver;
    }

    // Hoops (AI is Player 2, so it attacks opposite of targetGoal)
    if (_perception.match.targetGoal === 'N') {
        _perception.hoops.defendGoalPos.copy(HOOP_N_POS);
        _perception.hoops.attackGoalPos.copy(HOOP_S_POS);
    } else {
        _perception.hoops.defendGoalPos.copy(HOOP_S_POS);
        _perception.hoops.attackGoalPos.copy(HOOP_N_POS);
    }

    // Ball
    let nearestBall = null;
    let minSqDist = Infinity;

    if (activeBalls && activeBalls.length > 0) {
        for (let i = 0; i < activeBalls.length; i++) {
            const b = activeBalls[i];
            if (!b || !b.body) continue;
            
            const t = b.body.translation();
            _scratchPos.set(t.x, t.y, t.z);
            
            const sqDist = _scratchPos.distanceToSquared(_perception.self.position);
            if (sqDist < minSqDist) {
                minSqDist = sqDist;
                nearestBall = b;
            }
        }
    }

    if (nearestBall) {
        const t = nearestBall.body.translation();
        _perception.ball.position.set(t.x, t.y, t.z);
        
        const v = nearestBall.body.linvel();
        _perception.ball.velocity.set(v.x, v.y, v.z);
        
        const angV = nearestBall.body.angvel ? nearestBall.body.angvel() : {x:0,y:0,z:0};
        _perception.ball.angularVelocity.set(angV.x, angV.y, angV.z);
        
        _perception.ball.radius = nearestBall.radius || 0.5;
        _perception.ball.mass = nearestBall.mass || 1.0;
        _perception.ball.speed = _perception.ball.velocity.length();
        _perception.ball.heightAboveGround = _perception.ball.position.y - _perception.ball.radius;

        // Ball Intercept Calculation (target height roughly pelvis = 1.0m)
        const targetHeight = 1.0;
        const h0 = _perception.ball.position.y;
        const v0y = _perception.ball.velocity.y;
        const g = -12.0; // Gravity from law

        // quadratic: 0.5*g*t^2 + v0y*t + (h0 - targetHeight) = 0
        const a = 0.5 * g;
        const b = v0y;
        const c = h0 - targetHeight;
        const discriminant = b * b - 4 * a * c;

        let interceptTime = -1;
        if (discriminant >= 0) {
            const root = Math.sqrt(discriminant);
            const t1 = (-b - root) / (2 * a);
            const t2 = (-b + root) / (2 * a);
            // We want the smallest positive time
            if (t1 > 0 && t2 > 0) {
                interceptTime = Math.min(t1, t2);
            } else if (t1 > 0) {
                interceptTime = t1;
            } else if (t2 > 0) {
                interceptTime = t2;
            }
        }

        if (interceptTime > 0) {
            const interceptTicks = interceptTime * 60;
            _perception.ballIntercept.ticksToArrive = interceptTicks;
            
            projectBallPosition(_perception.ball.position, _perception.ball.velocity, interceptTicks, g, _perception.ballIntercept.position);
            
            // Can we reach it? Sprint speed ~6 m/s
            _vec2.copy(_perception.ballIntercept.position).sub(_perception.self.position);
            _vec2.y = 0;
            const dist = _vec2.length();
            _perception.ballIntercept.reachable = (dist / 6.0) <= interceptTime;
        } else {
            _perception.ballIntercept.ticksToArrive = 0;
            _perception.ballIntercept.position.copy(_perception.ball.position);
            _perception.ballIntercept.reachable = false;
        }

        // Threat (0..1)
        if (_perception.ball.speed > 0.1) {
            _vec2.copy(_perception.ball.velocity).normalize();
            _vec3.copy(_perception.hoops.defendGoalPos).sub(_perception.ball.position).normalize();
            const dot = _vec2.dot(_vec3);
            _perception.threat = Math.max(0, dot);
        } else {
            _perception.threat = 0;
        }

        // Opportunity (0..1)
        _vec2.copy(_perception.ball.position).sub(_perception.self.position);
        const distToBall = _vec2.length();
        let opp = 1.0 - Math.min(1.0, distToBall / 10.0);
        
        const hDiff = Math.abs(_perception.ball.position.y - 1.0);
        opp *= (1.0 - Math.min(1.0, hDiff / 5.0));
        
        _perception.opportunity = Math.max(0, Math.min(1.0, opp));

    } else {
        // Safe defaults if no ball
        _perception.ball.position.set(0, 0, 0);
        _perception.ball.velocity.set(0, 0, 0);
        _perception.ball.speed = 0;
        _perception.ball.heightAboveGround = 0;
        _perception.ballIntercept.reachable = false;
        _perception.threat = 0;
        _perception.opportunity = 0;
    }

    return _perception;
}
