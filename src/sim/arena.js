import * as THREE from 'three';
import { TUNING } from '../config/tuning.js';
import { RAPIER, getWorld } from './physics.js';

/**
 * The bowl arena: a flat floor that curves smoothly up into a rim.
 *
 * The visual mesh and the trimesh collider are built from ONE geometry. They are
 * never authored separately — if they drift apart, what you see stops being what
 * you collide with, and every feel bug becomes unfalsifiable.
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
  const { floorRadius, rimRadius, rimHeight, profilePoints, wallCurvePower } = TUNING.arena;

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
    TUNING.arena;

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
export function createArena() {
  const geometry = new THREE.LatheGeometry(buildProfile(), TUNING.arena.latheSegments);
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

  const world = getWorld();
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  const { vertices, indices, degenerateCount } = toTrimeshArrays(geometry);
  const collider = world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices), body);

  return {
    group,
    geometry,
    body,
    collider,
    triangleCount: indices.length / 3,
    degenerateCount,
  };
}
