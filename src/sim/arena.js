import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { TUNING } from '../config/tuning.js';
import { RAPIER, getWorld, ENVIRONMENT_GROUPS } from './physics.js';

/**
 * THE TWO ARENAS.
 *
 *   bowl  — the procedural lathe. A flat floor curving up into a rim, built
 *           from one geometry: the visual mesh and the trimesh collider are the
 *           SAME object, so they cannot drift and no feel bug is unfalsifiable.
 *           This is the permanent physics test rig and the determinism anchor.
 *   court — the authored Valleyball court, loaded from a GLB.
 *
 * THE COURT CANNOT KEEP THE ONE-GEOMETRY GUARANTEE, and it is worth being
 * honest about which half survives. An authored asset arrives as forty meshes
 * with their own transforms; there is no single geometry to share. What is kept
 * is the direction of the dependency: every collider is derived FROM the render
 * mesh it belongs to, baked through that mesh's own world matrix. Nobody authors
 * a collision proxy by hand, so the collider cannot describe a surface the
 * player is not looking at. It can only ever be missing, never wrong — and the
 * inclusion decision is logged at boot so "missing" is visible.
 */

/**
 * Profile for THREE.LatheGeometry, in (radius, height) pairs.
 *
 * Three sections, in order:
 *
 *   FLOOR — flat from the centre out to floorRadius.
 *   WALL  — a curve to (rimRadius, rimHeight) whose slope starts at exactly
 *           zero, so the floor and the wall meet without a crease for the ball
 *           to catch on.
 *   LIP   — an inward-curling overhang. Past the rim the profile turns BACK
 *           toward the axis, losing lipInset in radius while gaining lipHeight
 *           in height. A ball arriving with real speed meets an overhang and is
 *           turned back down instead of being launched out of the world.
 *
 * THE LIP IS A QUADRATIC BEZIER, and that is the whole reason it is not three
 * lines of lerp. Joining an inward curl to an outward-climbing wall with a
 * straight segment, or with an ease that starts at zero slope, puts a crease at
 * the rim — exactly the feature the floor-to-wall join was carefully built to
 * avoid, at exactly the place the ball is travelling fastest. Anchoring the
 * Bezier's control point along the wall's own outgoing tangent makes the join
 * tangent-continuous by construction: the curve leaves the rim in the direction
 * the wall was already going and rotates from there.
 *
 * @returns {THREE.Vector2[]}
 */
const LIP_TANGENT_FRACTION = 0.6;

export function buildProfile() {
  const { floorRadius, rimRadius, rimHeight, profilePoints, wallCurvePower } = TUNING.arena.bowl;

  const total = Math.max(4, Math.round(profilePoints));
  const flatCount = Math.max(2, Math.round(total / 4));
  const wallCount = Math.max(2, total - flatCount);

  const points = [];

  for (let i = 0; i < flatCount; i++) {
    points.push(new THREE.Vector2((i / (flatCount - 1)) * floorRadius, 0));
  }

  for (let i = 1; i <= wallCount; i++) {
    const t = i / wallCount;
    points.push(
      new THREE.Vector2(
        floorRadius + (rimRadius - floorRadius) * t,
        rimHeight * Math.pow(t, wallCurvePower),
      ),
    );
  }

  appendLip(points);
  return points;
}

/**
 * Appends the overhang, starting from whatever the wall's last point is.
 *
 * The wall's outgoing tangent at t = 1 is d(radius)/dt = rimRadius - floorRadius
 * and d(height)/dt = rimHeight * wallCurvePower, straight from the derivative of
 * the profile above. The Bezier control point sits along that direction, so the
 * lip is C1-continuous with the wall.
 *
 * @param {THREE.Vector2[]} points mutated in place
 */
function appendLip(points) {
  const { floorRadius, rimRadius, rimHeight, wallCurvePower, lipInset, lipHeight, lipPoints } =
    TUNING.arena.bowl;

  const count = Math.max(2, Math.round(lipPoints));

  const start = points[points.length - 1];
  const end = new THREE.Vector2(rimRadius - lipInset, rimHeight + lipHeight);

  // The wall's outgoing tangent, normalised.
  const tangent = new THREE.Vector2(rimRadius - floorRadius, rimHeight * wallCurvePower).normalize();

  // Control point along that tangent. The fraction sets how far the curve
  // carries on outward before turning; it is a shape constant of this curve,
  // not a feel value, so it lives here rather than in TUNING.
  const control = start.clone().addScaledVector(tangent, start.distanceTo(end) * LIP_TANGENT_FRACTION);

  for (let i = 1; i <= count; i++) {
    const u = i / count;
    const v = 1 - u;

    points.push(
      new THREE.Vector2(
        v * v * start.x + 2 * v * u * control.x + u * u * end.x,
        v * v * start.y + 2 * v * u * control.y + u * u * end.y,
      ),
    );
  }
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
 * Extracts the vertex and index arrays a Rapier trimesh wants, in the exact
 * types it wants them in.
 *
 * LatheGeometry is indexed, but a non-indexed geometry is handled rather than
 * assumed away: a sequential index is a valid triangle list.
 *
 * DEGENERATE TRIANGLES ARE REMOVED, and that removal is the whole reason this
 * function is not a two-liner.
 *
 * A lathe whose profile starts at radius 0 has a pole: every one of the
 * `latheSegments` quads in the first ring collapses to a triangle with two
 * coincident vertices, so the bowl arrives with exactly `latheSegments`
 * zero-area triangles stacked at the origin. They are invisible — a triangle
 * with no area rasterises to nothing — so the visual mesh does not care.
 *
 * Rapier's contact generation cares enormously. A zero-area triangle has no
 * well-defined normal, and the solver reads a nest of them as a thicket of
 * mutually contradictory contact planes. A ball resting on that spot has every
 * drive impulse cancelled by the contradictory contacts and the residue dumped
 * into yaw: it sits at the centre of the bowl spinning on the spot, taking
 * torque and going nowhere. That is exactly where the ball spawns.
 *
 * Rapier's own TriMeshFlags do not solve this. DELETE_DEGENERATE_TRIANGLES
 * leaves the ball stuck, and FIX_INTERNAL_EDGES (which implies
 * MERGE_DUPLICATE_VERTICES) is actively catastrophic on this mesh — it breaks
 * collision outright and the ball falls through the floor to y = -487. Both
 * were measured, not assumed. The filter therefore runs here, in JS, before
 * Rapier ever sees the index buffer.
 *
 * Only the COLLIDER's index buffer is filtered. The geometry object itself is
 * untouched and is still the single shared source for visual and collider
 * alike — the triangles dropped here are the ones that draw nothing.
 *
 * @param {THREE.BufferGeometry} geometry
 * @returns {{ vertices: Float32Array, indices: Uint32Array, degenerateCount: number }}
 */
export function toTrimeshArrays(geometry) {
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
  const kept = [];
  for (let t = 0; t < source.length; t += 3) {
    const i = source[t];
    const j = source[t + 1];
    const k = source[t + 2];

    _triA.fromArray(vertices, i * 3);
    _triB.fromArray(vertices, j * 3);
    _triC.fromArray(vertices, k * 3);

    _edgeAB.subVectors(_triB, _triA);
    _edgeAC.subVectors(_triC, _triA);

    if (_edgeAB.cross(_edgeAC).length() > DEGENERATE_CROSS_LENGTH) kept.push(i, j, k);
  }

  const indices = Uint32Array.from(kept);

  return { vertices, indices, degenerateCount: (source.length - indices.length) / 3 };
}

/**
 * Builds the bowl and its static collider.
 * @returns {{ group: THREE.Group, geometry: THREE.BufferGeometry, body: object, collider: object, triangleCount: number }}
 */
/**
 * MESHES THAT ARE SCENERY, not surface. EMPTY, and measured that way.
 *
 * The mechanism stays because a court will eventually carry decals worth
 * skipping, and because a deny-list is the safe direction: get an allow-list
 * wrong and a wall the artist added is quietly not solid, which nobody notices
 * until a player walks out of the world. Get a deny-list wrong and a painted
 * line is standable, which costs triangles and changes nothing anyone can feel.
 *
 * IT STARTED WITH TWO ENTRIES AND BOTH WERE WRONG. "CenterCircle" and
 * "Scoring Circle N/S" read like decals — the names say so, and they are the
 * two heaviest detail meshes in the file. They are the FLOOR. CenterCircle is a
 * 1,078-triangle disc at y 0.00-0.05 covering x,z +/-10.1, which is the middle
 * of the court and where everything spawns; the scoring circles carry the
 * ground from z +/-30 out to +/-50, past where the inner field stops.
 *
 * Measured on a 2 m grid over x +/-24, z +/-58, casting down from y 45:
 *
 *   all nodes collidable              1474 / 1475 points have floor
 *   minus the two scoring circles     1405 / 1475        (70 holes)
 *   minus those and CenterCircle      1325 / 1475       (150 holes)
 *
 * So the cost of "obviously scenery" was a hole under the spawn point. Anything
 * added here in future gets the same grid run over it first.
 */
const RENDER_ONLY_PREFIXES = [];

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
 * Is this mesh scenery? Checked against the mesh AND every ancestor up to the
 * root, because the name that carries the artist's intent may be two levels up.
 *
 * @param {THREE.Object3D} object
 * @param {THREE.Object3D} root
 * @returns {boolean}
 */
function isRenderOnly(object, root) {
  for (let node = object; node && node !== root; node = node.parent) {
    const name = readableName(node.name);
    if (RENDER_ONLY_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  }
  return false;
}

/**
 * Normalises an authored material toward the bowl's look, without repainting
 * the artist's work.
 *
 * Blender exports arrive with metalness the glTF spec defaults to 1.0 on
 * anything the artist did not explicitly set, which under a single key light
 * reads as wet plastic. Clamping metalness down and roughness up puts the court
 * in the same lighting regime as the lathe bowl. Colour, maps and transparency
 * are left exactly as authored — this adjusts how the surface answers light,
 * not what it is.
 *
 * @param {THREE.Material} material
 */
function normaliseCourtMaterial(material) {
  if (!material || !material.isMeshStandardMaterial) return;
  material.metalness = Math.min(material.metalness ?? 0, 0.05);
  material.roughness = Math.max(material.roughness ?? 1, 0.8);
  // The glass barriers are authored alphaMode BLEND. Leave them transparent,
  // but stop them writing depth or they punch holes in everything behind.
  if (material.transparent) material.depthWrite = false;
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

  // Traversal order is the glTF node order, which is fixed by the file — so the
  // colliders are created in the same order on every run. LAW 6 does not care
  // what the order IS, only that it cannot change between two runs.
  group.traverse((object) => {
    if (!object.isMesh) return;

    // Visuals first, and for every mesh including the scenery.
    object.receiveShadow = true;
    object.castShadow = false;
    object.frustumCulled = false;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) normaliseCourtMaterial(material);

    const owner = readableName(ownerNode(object, group).name) || readableName(object.name);

    if (isRenderOnly(object, group)) {
      scenery.add(owner);
      return;
    }

    // BAKED INTO WORLD SPACE. The clone is essential: applyMatrix4 mutates, and
    // the geometry being mutated is the one the renderer is about to draw.
    const baked = object.geometry.clone();
    baked.applyMatrix4(object.matrixWorld);

    const { vertices, indices, degenerateCount: dropped } = toTrimeshArrays(baked);
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

    const collider = world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices), body);
    collider.setCollisionGroups(ENVIRONMENT_GROUPS);
    colliders.push(collider);
    collidable.set(owner, (collidable.get(owner) || 0) + indices.length / 3);
    triangleCount += indices.length / 3;
    degenerateCount += dropped;
  });

  scene.add(group);

  console.log(
    `[arena] court "${url}": ${colliders.length} trimesh colliders on one fixed body, ` +
      `${triangleCount} triangles (${degenerateCount} degenerate removed)`,
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
 * Which arena this run is using.
 *
 * The query parameter wins over TUNING for the same reason ?captureTick does:
 * it is per-run harness configuration, and a script must be able to pick an
 * arena without editing saved tuning state. Read ONCE, at boot.
 *
 * @returns {'court'|'bowl'}
 */
export function activeArenaType() {
  const requested =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('arena')
      : null;
  const type = requested || TUNING.arena.type;
  if (type !== 'court' && type !== 'bowl') {
    console.warn(`[arena] unknown arena "${type}" — falling back to bowl`);
    return 'bowl';
  }
  return type;
}

/** The active arena's preset block. @returns {object} */
export function activeArenaPreset() {
  return TUNING.arena[activeArenaType()];
}

/**
 * Builds whichever arena this run asked for and puts it in the scene.
 *
 * @param {THREE.Scene} scene
 * @returns {Promise<object>} the arena handle
 */
export async function createArena(scene) {
  if (activeArenaType() === 'court') return loadCourtArena(scene);
  return createBowlArena(scene);
}

/**
 * The procedural test bowl — unchanged in shape, geometry and collider from the
 * rig every determinism pair to date was measured on.
 *
 * @param {THREE.Scene} scene
 * @returns {object}
 */
function createBowlArena(scene) {
  const geometry = new THREE.LatheGeometry(buildProfile(), TUNING.arena.bowl.latheSegments);
  geometry.computeVertexNormals();

  const surface = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0x2c3a49,
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
  );
  surface.name = 'arena-surface';

  // Shares the same geometry object, so the overlay can never describe a
  // different surface from the one underneath it.
  const wire = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0x5f86a8,
      wireframe: true,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    }),
  );
  wire.name = 'arena-wireframe';

  const group = new THREE.Group();
  group.name = 'arena';
  group.add(surface, wire);

  // The floor RECEIVES and never casts. A self-shadowing lathe at grazing light
  // angles is all acne and no information, and nothing below the floor can see a
  // shadow anyway.
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.receiveShadow = true;
    object.castShadow = false;
  });

  const world = getWorld();
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  const { vertices, indices, degenerateCount } = toTrimeshArrays(geometry);
  const collider = world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices), body);
  // Stamped here now that this file is no longer frozen. It used to be applied
  // from main.js with a comment explaining that it could not live here; the
  // reason has gone, so the stamp has moved to the collider it describes.
  collider.setCollisionGroups(ENVIRONMENT_GROUPS);

  scene.add(group);

  console.log(
    `[arena] bowl built: ${indices.length / 3} collider triangles ` +
      `(${degenerateCount} degenerate lathe-pole triangles removed)`,
  );

  return {
    type: 'bowl',
    group,
    geometry,
    body,
    colliders: [collider],
    collider,
    triangleCount: indices.length / 3,
    degenerateCount,
  };
}
