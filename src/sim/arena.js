import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { TUNING } from '../config/tuning.js';
import { RAPIER, getWorld, ENVIRONMENT_GROUPS } from './physics.js';

/**
 * MODULE HEADER — src/sim/arena.js
 *
 * Role: Loads the authored Valleyball court GLB (`loadCourtArena`, `createArena`),
 *   normalizes court/barrier materials, extracts non-degenerate triangle meshes
 *   (`toTrimeshArrays`), builds static Rapier trimesh colliders in deterministic
 *   order, and maps collider handles to semantic surface types (`getArenaColliderType`).
 * Frame Phase: Boot / initialization only (`createArena`).
 * Active Architectural Laws:
 *   - DERIVATION FROM VISUALS: Every court collider is derived from the authored
 *     mesh geometry baked through its world transform.
 *   - LAW 6 (Determinism): Collider creation order is deterministic and independent
 *     of debug visualization flags (`?showColliders=1`).
 */
const arenaColliderTypes = new Map();

/**
 * DEBUG: ?showColliders=1 renders the authored collision proxies as colored
 * wireframes instead of hiding them, so the terrain hand-off can be eyeballed
 * against the visual mesh. Boundary=cyan, court=green, goal=orange. Off by
 * default and never active headless, so determinism (LAW 6) is untouched.
 */
function wantColliderWireframes() {
  if (typeof location === 'undefined' || !location.search) return false;
  return /(?:^|[?&])showColliders=1(?:&|$)/.test(location.search);
}
const SHOW_COLLIDERS = wantColliderWireframes();

function colliderDebugColor(owner) {
  if (owner.includes('Barrier') || owner.includes('Boundary')) return 0x00ffff; // cyan
  if (owner.includes('Goal') || owner.includes('Hoop')) return 0xffa500; // orange
  return 0x00ff00; // green — court / anything else
}

/**
 * Returns the semantic surface type of an arena collider ('court', 'boundary', 'goal')
 * @param {number} handle Rapier collider handle
 * @returns {'court'|'boundary'|'goal'|null}
 */
export function getArenaColliderType(handle) {
  return arenaColliderTypes.get(handle) || null;
}



/**
 * Twice the area below which a triangle is treated as having no surface at all.
 *
 * Structural, not tunable — it separates "is a triangle" from "is three points
 * that happen to be collinear", which is a property of floating point, not of
 * how the game feels. It sits here with SOLVER_ITERATIONS and MIN_ANGULAR_SPEED
 * rather than in TUNING for the same reason those do: a slider on it could only
 * ever break the collider.
 */
const DEGENERATE_CROSS_LENGTH = 1e-10;

const _triA = new THREE.Vector3();
const _triB = new THREE.Vector3();
const _triC = new THREE.Vector3();
const _edgeAB = new THREE.Vector3();
const _edgeAC = new THREE.Vector3();

/**
 * Extracts the vertex and index arrays a Rapier trimesh wants, filtering out
 * zero-area degenerate triangles and (when `options.filterInverted` is set)
 * downward-facing floor triangles before Rapier builds its BVH.
 *
 * Zero-area triangles have no well-defined normal and produce contradictory
 * contact planes in Rapier's solver; filtering them in JS before Rapier sees
 * the index buffer keeps ball and motor rolling contacts clean without using
 * `FIX_INTERNAL_EDGES` (which merges vertices and breaks collision).
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {{ filterInverted?: boolean, maxInvertedY?: number }} [options]
 * @returns {{ vertices: Float32Array, indices: Uint32Array, degenerateCount: number, invertedCount: number }}
 */
export function toTrimeshArrays(geometry, options = {}) {
  const position = geometry.getAttribute('position');
  const vertices =
    position.array instanceof Float32Array
      ? position.array
      : Float32Array.from(position.array);

  let source;
  if (geometry.index) {
    source =
      geometry.index.array instanceof Uint32Array
        ? geometry.index.array
        : Uint32Array.from(geometry.index.array);
  } else {
    source = new Uint32Array(position.count);
    for (let i = 0; i < source.length; i++) source[i] = i;
  }

  // Keep only triangles that enclose actual area. |AB x AC| is twice the area,
  // and the comparison is written so that a NaN coordinate fails the test and
  // the triangle is dropped, rather than passing it to the solver.
  const filterInverted = options.filterInverted ?? false;
  const maxInvertedY = options.maxInvertedY ?? 4.0;

  const kept = [];
  let degenerateCount = 0;
  let invertedCount = 0;

  for (let t = 0; t < source.length; t += 3) {
    const i = source[t];
    const j = source[t + 1];
    const k = source[t + 2];

    _triA.fromArray(vertices, i * 3);
    _triB.fromArray(vertices, j * 3);
    _triC.fromArray(vertices, k * 3);

    _edgeAB.subVectors(_triB, _triA);
    _edgeAC.subVectors(_triC, _triA);

    const cross = _edgeAB.cross(_edgeAC);
    const len = cross.length();

    if (len <= DEGENERATE_CROSS_LENGTH) {
      degenerateCount++;
      continue;
    }

    // Inverted floor triangles (faces with downward normal on playing floor)
    // from mirrored instances or inverted face winding in Blender.
    if (filterInverted) {
      const ny = cross.y / len;
      const midY = (_triA.y + _triB.y + _triC.y) / 3;
      if (ny < -0.1 && midY < maxInvertedY) {
        invertedCount++;
        continue;
      }
    }

    kept.push(i, j, k);
  }

  const indices = Uint32Array.from(kept);

  return {
    vertices,
    indices,
    degenerateCount,
    invertedCount,
  };
}

/**
 * Names as the ARTIST wrote them, recovered from what the loader produced.
 *
 * Two things mangle them on the way in. GLTFLoader sanitises for property
 * binding, so "Back Boundary N.001" arrives as "Back_Boundary_N001"; and a node
 * whose mesh has more than one primitive becomes a GROUP with the node's name
 * and CHILD meshes named after the mesh — so "Scoring Circle N" arrives as a
 * group containing "Circle039" and "Circle039_1". Matching on the mesh's own
 * name therefore misses exactly the multi-material pieces, which in this asset
 * is most of the interesting ones.
 *
 * @param {string} name
 * @returns {string} underscores and runs of whitespace folded to single spaces
 */
function readableName(name) {
  return String(name || '').replace(/[_\s]+/g, ' ').trim();
}

/**
 * The artist's node this mesh belongs to: the highest ancestor below the loaded
 * root, or the mesh itself if it is already that child.
 *
 * @param {THREE.Object3D} object
 * @param {THREE.Object3D} root
 * @returns {THREE.Object3D}
 */
function ownerNode(object, root) {
  let node = object;
  while (node.parent && node.parent !== root) node = node.parent;
  return node;
}

/**
 * Returns true if this mesh is visual-only scenery (dense circle rims or raised
 * chalk line meshes) that should be excluded from Rapier physics colliders.
 *
 * @param {THREE.Object3D} object
 * @returns {boolean}
 */
function isRenderOnly(object) {
  // Dense circle rims: visuals only
  if (object.name === 'Circle039_1' || object.name === 'Circle186_1') return true;

  // 5cm raised line ridges: keep visuals, exclude from physics colliders
  if (object.isMesh) {
    const mats = Array.isArray(object.material) ? object.material : [object.material];
    if (mats.some((m) => m && m.name && m.name.includes('Lines'))) return true;
  }

  return false;
}

/**
 * Normalises authored Blender glTF materials so default metalness (1.0 in glTF)
 * does not render court surfaces as reflective plastic under key lighting.
 *
 * @param {THREE.Material} material
 */
function normaliseCourtMaterial(material) {
  if (!material || !material.isMeshStandardMaterial) return;

  // Standardize chalk lines to canonical arena chalk white (#F5F5F7)
  if (material.name && (material.name.includes('Lines') || material.name.includes('Chalk'))) {
    material.color.set(0xF5F5F7);
    material.roughness = 0.9;
    material.metalness = 0.0;
    return;
  }

  // Translucent perimeter glass barriers: crystal clean pane
  const isBarrierGlass = material.transparent || material.name === 'M_Barrier Glass' || material.name?.includes('Barrier');
  if (isBarrierGlass) {
    const config = TUNING.arena?.barrier || {};
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.FrontSide;
    material.roughness = config.roughness ?? 0.10;
    material.metalness = config.metalness ?? 0.15;
    material.opacity = config.opacity ?? 0.08;
    return;
  }

  // Stream / water channels: very subtle hydro-matte, eliminating distracting glare and hotspots
  if (material.name && (material.name.includes('Stream') || material.name.includes('Water'))) {
    material.roughness = 0.65;
    material.metalness = 0.02;
    return;
  }

  // Colored athletic court zones: sealed satin composite finish
  if (
    material.name &&
    (material.name.includes('Center') ||
      material.name.includes('Pick') ||
      material.name.includes('Scoring') ||
      material.name.includes('Corner'))
  ) {
    material.roughness = 0.68;
    material.metalness = 0.03;
    return;
  }

  // Main playing turf: clean athletic synthetic turf with subtle directional slope roll-off
  if (material.name && (material.name.includes('Field') || material.name.includes('Turf'))) {
    material.roughness = 0.78;
    material.metalness = 0.02;
    return;
  }

  // Goal hoops / hardware: anodized athletic satin metal
  if (material.name && (material.name.includes('Goal') || material.name.includes('Hoop'))) {
    material.roughness = 0.35;
    material.metalness = 0.50;
    return;
  }

  material.metalness = Math.min(material.metalness ?? 0, 0.04);
  material.roughness = Math.max(material.roughness ?? 1, 0.80);
  // The glass barriers are authored alphaMode BLEND. Leave them transparent,
  // but stop them writing depth or they punch holes in everything behind.
  // Render FrontSide to eliminate 50% transparent pixel overdraw across large bounds.
  if (material.transparent) {
    material.depthWrite = false;
    material.side = THREE.FrontSide;
  }
}

/**
 * Attaches a chalk-width pink outline along glass pane edges, chamfers, and angle intersections.
 *
 * @param {THREE.Mesh} object
 * @param {string} owner
 * @param {THREE.Material[]} materials
 */
function attachBarrierEdgeOutlines(object, owner, materials) {
  const isBarrier =
    owner.includes('Barrier') ||
    owner.includes('Boundary') ||
    materials.some((m) => m && (m.name === 'M_Barrier Glass' || m.name?.includes('Barrier')));
  if (!isBarrier || !object.geometry) return;

  const config = TUNING.arena?.barrier || {};
  const edgeGeo = new THREE.EdgesGeometry(object.geometry, config.edgeAngle ?? 25);
  const lineMat = new THREE.LineBasicMaterial({
    color: config.edgeColor ?? 0xEC4899,
    transparent: true,
    opacity: config.edgeOpacity ?? 0.90,
    depthWrite: false,
  });
  const edgeLines = new THREE.LineSegments(edgeGeo, lineMat);
  edgeLines.name = `${owner}_pink_edges`;
  object.add(edgeLines);
}

/**
 * Loads the authored court and derives its colliders from the meshes it draws.
 *
 * ONE FIXED BODY, MANY COLLIDERS. The alternative — merging forty meshes into a
 * single geometry — was rejected: eleven of the court's nodes are mirrored
 * instances (negative determinant), and merging them into one buffer flips
 * their winding, so the merged render mesh would be inside-out exactly where
 * the collider was fine. Kept as separate colliders on one static body, each
 * baked through its own mesh's world matrix, the question never arises. three.js
 * flips the front face per object for negative determinants on its own.
 *
 * @param {THREE.Scene} scene
 * @returns {Promise<object>} the arena handle
 */
async function loadCourtArena(scene) {
  const url = TUNING.arena.modelUrl;
  const gltf = await new GLTFLoader().loadAsync(url);

  const group = gltf.scene;
  group.name = 'arena-court';
  // Every world matrix below is read off this, so it is computed ONCE here and
  // before anything measures anything — the same discipline loadCharacter uses.
  group.updateMatrixWorld(true);

  const world = getWorld();
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  const colliders = [];
  // The world extent of what was actually handed to Rapier, accumulated from the
  // BAKED vertex buffers rather than from the scene graph. If the bake is wrong
  // this is the line that says so — a collider set whose bounds do not match the
  // asset's is the difference between a floor and a hole.
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  /** owner node name -> triangles contributed, so the log reads in the artist's
   *  vocabulary rather than in Blender's primitive numbering. */
  const collidable = new Map();
  const scenery = new Set();
  let triangleCount = 0;
  let degenerateCount = 0;
  let invertedCount = 0;

  // Check if the asset provides dedicated collision proxies (prefixed with COL)
  let hasDedicatedColliders = false;
  group.traverse((object) => {
    if (object.isMesh) {
      const owner = readableName(ownerNode(object, group).name);
      if (owner.startsWith('COL')) hasDedicatedColliders = true;
    }
  });

  // Traversal order is the glTF node order, which is fixed by the file — so the
  // colliders are created in the same order on every run. LAW 6 does not care
  // what the order IS, only that it cannot change between two runs.
  group.traverse((object) => {
    if (!object.isMesh) return;

    const owner = readableName(ownerNode(object, group).name) || readableName(object.name);
    const isColliderProxy = owner.startsWith('COL');

    if (hasDedicatedColliders) {
      if (isColliderProxy) {
        if (SHOW_COLLIDERS) {
          // Debug view: render the collision proxy as a colored wireframe laid
          // over the scene (depthTest off so it reads through the visual floor).
          object.material = new THREE.MeshBasicMaterial({
            color: colliderDebugColor(owner),
            wireframe: true,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
            depthWrite: false,
          });
          object.renderOrder = 1000;
          object.visible = true;
        } else {
          // Dedicated collision geometry: invisible in the render pass
          object.visible = false;
        }
      } else {
        // Visual mesh: normalise materials, render with shadows, skip physics collision
        object.receiveShadow = true;
        object.castShadow = false;
        object.frustumCulled = true;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) normaliseCourtMaterial(material);
        attachBarrierEdgeOutlines(object, owner, materials);
        scenery.add(owner);
        return;
      }
    } else {
      // Visuals first, and for every mesh including the scenery.
      object.receiveShadow = true;
      object.castShadow = false;
      object.frustumCulled = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) normaliseCourtMaterial(material);

      if (isRenderOnly(object, group)) {
        attachBarrierEdgeOutlines(object, owner, materials);
        scenery.add(owner);
        return;
      }
    }

    // BAKED INTO WORLD SPACE. The clone is essential: applyMatrix4 mutates, and
    // the geometry being mutated is the one the renderer is about to draw.
    const baked = object.geometry.clone();
    baked.applyMatrix4(object.matrixWorld);

    const isCourtSurface = isColliderProxy || !hasDedicatedColliders;
    const {
      vertices,
      indices,
      degenerateCount: dropped,
      invertedCount: droppedInverted = 0,
    } = toTrimeshArrays(baked, {
      filterInverted: isCourtSurface,
      maxInvertedY: 4.0,
    });
    baked.dispose();

    if (indices.length === 0) {
      scenery.add(`${owner} (no non-degenerate triangles)`);
      return;
    }

    for (let v = 0; v < vertices.length; v += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = vertices[v + axis];
        if (value < bounds.min[axis]) bounds.min[axis] = value;
        if (value > bounds.max[axis]) bounds.max[axis] = value;
      }
    }

    // INTERNAL EDGE FIXING: On authored court trimeshes (especially dense
    // organic meshes with thousands of tiny facets), internal edges between adjacent
    // coplanar/sub-coplanar triangles create ghost contact ridges. When a ball penetrates
    // slightly, multiple conflicting facet normals generate phantom de-penetration
    // impulses that shoot the ball sideways and artificially inject kinetic energy.
    // FIX_INTERNAL_EDGES welds adjacent coplanar edges into smooth collision manifolds,
    // guaranteeing clean, pure restitution bounces without phantom acceleration.
    const desc = isCourtSurface
      ? RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      : RAPIER.ColliderDesc.trimesh(vertices, indices);
    const collider = world.createCollider(desc, body);
    collider.setCollisionGroups(ENVIRONMENT_GROUPS);
    colliders.push(collider);

    let arenaType = 'court';
    if (owner.includes('Barrier') || owner.includes('Boundary')) arenaType = 'boundary';
    else if (owner.includes('Goal') || owner.includes('Hoop')) arenaType = 'goal';
    else if (owner.includes('Court')) arenaType = 'court';
    arenaColliderTypes.set(collider.handle, arenaType);

    collidable.set(owner, (collidable.get(owner) || 0) + indices.length / 3);
    triangleCount += indices.length / 3;
    degenerateCount += dropped;
    invertedCount += droppedInverted;
  });

  scene.add(group);

  console.log(
    `[arena] court "${url}": ${colliders.length} trimesh colliders on one fixed body, ` +
      `${triangleCount} triangles (${degenerateCount} degenerate, ${invertedCount} inverted removed)`,
  );
  const byName = [...collidable.entries()].sort((a, b) => b[1] - a[1]);
  console.log(
    `[arena] collidable nodes (${byName.length}): ` +
      byName.map(([name, tris]) => `${name} ${tris}`).join(', '),
  );
  console.log(
    `[arena] render-only (${scenery.size}): ${[...scenery].join(', ') || 'none'}`,
  );
  const fixed3 = (n) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a');
  console.log(
    `[arena] collider world bounds: x ${fixed3(bounds.min[0])}..${fixed3(bounds.max[0])}, ` +
      `y ${fixed3(bounds.min[1])}..${fixed3(bounds.max[1])}, ` +
      `z ${fixed3(bounds.min[2])}..${fixed3(bounds.max[2])}`,
  );

  return {
    type: 'court',
    group,
    geometry: null,
    body,
    colliders,
    collider: colliders[0],
    triangleCount,
    degenerateCount,
  };
}

/**
 * The active arena type. Valley Court is the authentic arena.
 *
 * @returns {'court'}
 */
export function activeArenaType() {
  return 'court';
}

/** The active arena's preset block. @returns {object} */
export function activeArenaPreset() {
  return TUNING.arena.court;
}

/**
 * Builds the Valley Court arena and puts it in the scene.
 *
 * @param {THREE.Scene} scene
 * @returns {Promise<object>} the arena handle
 */
export async function createArena(scene) {
  return loadCourtArena(scene);
}
