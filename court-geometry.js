import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUPS_WORLD } from './collision-layers.js';

export function buildCourt(scene, world) {
  const surfaceMeshes = [];
  
  function addStaticBox(w, h, d, pos, quatRot, color) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.93, metalness: 0.04 })
    );
    mesh.position.set(pos.x, pos.y, pos.z);
    if (quatRot) mesh.quaternion.copy(quatRot);
    mesh.receiveShadow = true; mesh.castShadow = true;
    scene.add(mesh);
    surfaceMeshes.push(mesh);
  
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z));
    const q = mesh.quaternion;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        /* 1.05, matching the athlete's own `tuning.friction`, and the two are
           coupled ON PURPOSE. The athlete's collider combines friction with MIN
           (see `athleteColliderDesc`), so the coefficient the solver uses is
           min(athlete, court): the court can only ever LOWER the athlete's
           traction. At the old 0.9 that silently cost 14% of the acceleration
           ceiling — a_max = μ·g, so 10.3 m/s² would have become 8.8 — while the
           drive torque was still being computed from 1.05 and the difference
           came out as wheelspin. Matching them keeps the ceiling arithmetic
           truthful. Lower this deliberately to author an ice patch. */
        .setFriction(1.05).setRestitution(0)
        .setCollisionGroups(GROUPS_WORLD),
      body);
    return mesh;
  }
  
  const GROUND_SIZE = 70;
  addStaticBox(GROUND_SIZE, 1, GROUND_SIZE, { x: 0, y: -0.5, z: 0 }, null, 0x232733);
  const grid = new THREE.GridHelper(GROUND_SIZE, 70, 0x363c48, 0x1e222b);
  grid.position.y = 0.012;
  scene.add(grid);
  
  const RAMP_T = 0.5;
  function addRampBetween(x, width, zStart, yStart, zEnd, yEnd, color) {
    const dz = zEnd - zStart, dy = yEnd - yStart;
    const len = Math.hypot(dz, dy);
    const a = Math.atan2(dy, dz);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-a, 0, 0));
    addStaticBox(width, RAMP_T, len, {
      x,
      y: (yStart + yEnd) / 2 - (RAMP_T / 2) * Math.cos(a),
      z: (zStart + zEnd) / 2 + (RAMP_T / 2) * Math.sin(a),
    }, q, color);
  }
  function addAngledRamp(deg, slopeLength, width, x, zStart, yStart, color) {
    const a = deg * Math.PI / 180;
    const zEnd = zStart + slopeLength * Math.cos(a);
    const yEnd = yStart + slopeLength * Math.sin(a);
    addRampBetween(x, width, zStart, yStart, zEnd, yEnd, color);
    return { zEnd, yEnd };
  }
  
  for (const [deg, x, color] of [[10, -22, 0x2d3444], [20, -12, 0x333a4d], [30, -2, 0x3a4156], [45, 8, 0x434a61]]) {
    addAngledRamp(deg, 11, 7, x, 5, 0, color);
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(7, 0.06, 0.6),
      new THREE.MeshBasicMaterial({ color: 0x4ecdc4, transparent: true, opacity: 0.5 }));
    marker.position.set(x, 0.05, 4.2);
    scene.add(marker);
  }
  const climb = addAngledRamp(12, 16, 9, 24, -4, 0, 0x2f3648);
  addStaticBox(9, RAMP_T, 8, { x: 24, y: climb.yEnd - RAMP_T / 2, z: climb.zEnd + 4 }, null, 0x3d4459);
  addAngledRamp(-30, climb.yEnd / Math.sin(30 * Math.PI / 180), 9, 24, climb.zEnd + 8, climb.yEnd, 0x474e66);
  
  for (let i = 0; i < 4; i++) {
    const h = 0.16 + i * 0.16;
    addStaticBox(6, h, 1.6, { x: -32, y: h / 2, z: -2 + i * 1.6 }, null, 0x39404f);
  }
  return surfaceMeshes;
}
