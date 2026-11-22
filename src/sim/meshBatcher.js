/**
 * Module: sim/meshBatcher
 * Role: Deterministic boot/mount-time static geometry batcher (`mergeStaticGroupByMaterial`,
 *   `mergeLineSegmentsList`) that merges static meshes sharing identical materials into
 *   single draw calls while respecting negative-determinant mirrored glTF transforms and
 *   preserving `material.userData.colorRole` for live team palette recoloring.
 * Frame Phase: Boot / Athlete Headwear Mount only (never called in 60 Hz fixedUpdate or render).
 * Active Architectural Laws:
 *   - LAW 4 (Zero Hot-Loop Allocations): Runs once at arena load or headwear swap.
 *   - LAW 6 (Determinism): Preserves deterministic traversal order and never touches physics.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function materialMergeKey(mat, receiveShadow, castShadow) {
  if (!mat) return null;
  // Never merge textured materials with different maps or custom shader materials
  if (mat.isShaderMaterial || mat.isRawShaderMaterial) return null;
  const mapUuid = mat.map ? mat.map.uuid : '';
  const normalUuid = mat.normalMap ? mat.normalMap.uuid : '';
  const roughUuid = mat.roughnessMap ? mat.roughnessMap.uuid : '';
  const metalUuid = mat.metalnessMap ? mat.metalnessMap.uuid : '';
  const emUuid = mat.emissiveMap ? mat.emissiveMap.uuid : '';
  const role = mat.userData?.colorRole || '';
  const col = mat.color ? mat.color.getHexString() : '';
  const em = mat.emissive ? mat.emissive.getHexString() : '';
  const r = mat.roughness !== undefined ? mat.roughness.toFixed(3) : '';
  const m = mat.metalness !== undefined ? mat.metalness.toFixed(3) : '';
  const op = mat.opacity !== undefined ? mat.opacity.toFixed(3) : '1';
  const ei = mat.emissiveIntensity !== undefined ? mat.emissiveIntensity.toFixed(3) : '0';
  return [
    mat.type,
    role,
    col,
    em,
    ei,
    r,
    m,
    mat.transparent ? 'T' : 'O',
    op,
    mat.depthWrite ? 'DW' : 'NW',
    mat.side ?? 0,
    mat.blending ?? 1,
    mat.toneMapped === false ? 'NT' : 'TM',
    mat.vertexColors ? 'VC' : 'NV',
    receiveShadow ? 'RS' : 'NR',
    castShadow ? 'CS' : 'NC',
    mapUuid,
    normalUuid,
    roughUuid,
    metalUuid,
    emUuid,
  ].join('|');
}

/**
 * Clones `sourceGeo`, bakes `matrix` into world/root space, flips triangle winding
 * when `matrix` has negative determinant (mirrored glTF nodes), and normalizes
 * attributes to a clean indexed geometry ready for `mergeGeometries`.
 */
function bakeForMerge(sourceGeo, matrix, keepUv, keepColor) {
  if (!sourceGeo?.attributes?.position) return null;
  const geo = sourceGeo.clone();

  // Strip mismatched optional attributes so mergeGeometries never fails,
  // while preserving `uv` for textured materials and `color` for vertexColors materials
  // (e.g. arena purple corner wedges which carry GLTF COLOR_0 attributes).
  for (const attrName of Object.keys(geo.attributes)) {
    if (attrName === 'position' || attrName === 'normal') continue;
    if (attrName === 'uv' && keepUv) continue;
    if (attrName === 'color' && keepColor) continue;
    geo.deleteAttribute(attrName);
  }
  geo.morphAttributes = {};
  geo.clearGroups();

  if (!geo.attributes.normal) {
    geo.computeVertexNormals();
  }

  geo.applyMatrix4(matrix);

  // Mirrored glTF instance (negative determinant): Three.js flips gl.frontFace per object,
  // whereas a world-space merged mesh renders with standard CCW front faces.
  // Swapping (i1, i2) restores exact CCW winding while transformed normals already point outward.
  if (matrix.determinant() < 0) {
    if (geo.index) {
      const arr = geo.index.array;
      for (let i = 0; i < arr.length; i += 3) {
        const tmp = arr[i + 1];
        arr[i + 1] = arr[i + 2];
        arr[i + 2] = tmp;
      }
    } else {
      const pos = geo.attributes.position;
      const nrm = geo.attributes.normal;
      const uv = geo.attributes.uv;
      const col = geo.attributes.color;
      const colStride = col ? col.itemSize : 0;
      for (let i = 0; i < pos.count; i += 3) {
        const a = i + 1;
        const b = i + 2;
        for (let c = 0; c < 3; c++) {
          const tp = pos.array[a * 3 + c];
          pos.array[a * 3 + c] = pos.array[b * 3 + c];
          pos.array[b * 3 + c] = tp;
          if (nrm) {
            const tn = nrm.array[a * 3 + c];
            nrm.array[a * 3 + c] = nrm.array[b * 3 + c];
            nrm.array[b * 3 + c] = tn;
          }
        }
        if (uv) {
          for (let c = 0; c < 2; c++) {
            const tu = uv.array[a * 2 + c];
            uv.array[a * 2 + c] = uv.array[b * 2 + c];
            uv.array[b * 2 + c] = tu;
          }
        }
        if (col && colStride > 0) {
          for (let c = 0; c < colStride; c++) {
            const tc = col.array[a * colStride + c];
            col.array[a * colStride + c] = col.array[b * colStride + c];
            col.array[b * colStride + c] = tc;
          }
        }
      }
    }
  }

  // Ensure uniform indexed representation across the bucket
  if (!geo.index) {
    const count = geo.attributes.position.count;
    const idx = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }

  return geo;
}

/**
 * Merges static single-material child meshes inside `rootGroup` by material into
 * compact batched meshes directly under `rootGroup` (or a replacement `THREE.Group`).
 *
 * Preserves `rootGroup.userData`, `material.userData.colorRole`, shadows, and renderOrder.
 * Safely skips multi-material meshes, skinned meshes, or unsupported shader materials.
 *
 * @param {THREE.Group} rootGroup
 * @param {object} [options]
 * @param {boolean} [options.disposeOriginals=true]
 * @param {(mesh: THREE.Mesh) => boolean} [options.filter]
 * @returns {{ beforeDraws: number, afterDraws: number }}
 */
export function mergeStaticGroupByMaterial(rootGroup, { disposeOriginals = true, filter = null } = {}) {
  if (!rootGroup) return { beforeDraws: 0, afterDraws: 0 };

  rootGroup.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(rootGroup.matrixWorld).invert();
  const relMatrix = new THREE.Matrix4();

  const buckets = new Map();
  const candidates = [];

  rootGroup.traverse((obj) => {
    if (!obj.isMesh || obj.isSkinnedMesh || obj.isInstancedMesh) return;
    if (!obj.visible || !obj.geometry || !obj.material || Array.isArray(obj.material)) return;
    if (filter && !filter(obj)) return;

    const key = materialMergeKey(obj.material, obj.receiveShadow, obj.castShadow);
    if (!key) return;
    const bucketKey = `${key}|ro:${obj.renderOrder || 0}`;

    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        material: obj.material,
        receiveShadow: obj.receiveShadow,
        castShadow: obj.castShadow,
        renderOrder: obj.renderOrder || 0,
        frustumCulled: obj.frustumCulled,
        meshes: [],
      };
      buckets.set(bucketKey, bucket);
    }
    bucket.meshes.push(obj);
    candidates.push(obj);
  });

  if (candidates.length <= buckets.size) {
    return { beforeDraws: candidates.length, afterDraws: candidates.length };
  }

  let afterDraws = 0;
  const toRemove = [];
  const mergedMeshes = [];

  for (const bucket of buckets.values()) {
    if (bucket.meshes.length < 2) {
      afterDraws += bucket.meshes.length;
      continue;
    }

    const needUv = Boolean(
      bucket.material.map ||
      bucket.material.normalMap ||
      bucket.material.roughnessMap ||
      bucket.material.metalnessMap ||
      bucket.material.emissiveMap,
    );
    const keepUv = needUv && bucket.meshes.every((m) => Boolean(m.geometry?.attributes?.uv));
    const needColor = Boolean(bucket.material.vertexColors);
    const firstColor = bucket.meshes[0]?.geometry?.attributes?.color;
    const keepColor = needColor
      && Boolean(firstColor)
      && bucket.meshes.every((m) => {
        const c = m.geometry?.attributes?.color;
        return Boolean(c) && c.itemSize === firstColor.itemSize && c.normalized === firstColor.normalized && c.array.constructor === firstColor.array.constructor;
      });
    if (needColor && !keepColor) {
      afterDraws += bucket.meshes.length;
      continue;
    }

    const bakedGeos = [];
    let ok = true;
    for (const m of bucket.meshes) {
      relMatrix.multiplyMatrices(rootInv, m.matrixWorld);
      const g = bakeForMerge(m.geometry, relMatrix, keepUv, keepColor);
      if (!g) {
        ok = false;
        break;
      }
      bakedGeos.push(g);
    }

    if (!ok || bakedGeos.length < 2) {
      for (const g of bakedGeos) g.dispose();
      afterDraws += bucket.meshes.length;
      continue;
    }

    const mergedGeo = mergeGeometries(bakedGeos, false);
    for (const g of bakedGeos) g.dispose();

    if (!mergedGeo) {
      afterDraws += bucket.meshes.length;
      continue;
    }

    const mergedMesh = new THREE.Mesh(mergedGeo, bucket.material);
    mergedMesh.name = `batched-${bucket.material.name || bucket.material.userData?.colorRole || 'mesh'}`;
    mergedMesh.receiveShadow = bucket.receiveShadow;
    mergedMesh.castShadow = bucket.castShadow;
    mergedMesh.renderOrder = bucket.renderOrder;
    mergedMesh.frustumCulled = bucket.frustumCulled;
    mergedMeshes.push(mergedMesh);
    afterDraws += 1;

    for (const m of bucket.meshes) {
      toRemove.push(m);
    }
  }

  for (const m of toRemove) {
    m.removeFromParent();
    if (disposeOriginals && m.geometry) {
      m.geometry.dispose();
    }
  }

  for (const mm of mergedMeshes) {
    rootGroup.add(mm);
  }

  return { beforeDraws: candidates.length, afterDraws };
}

/**
 * Merges a list of `THREE.LineSegments` (e.g., all pink arena barrier edge outlines)
 * into a single world-space `THREE.LineSegments` draw call.
 *
 * @param {THREE.LineSegments[]} lines
 * @param {THREE.Material} material
 * @param {string} [name='batched-lines']
 * @returns {THREE.LineSegments|null}
 */
export function mergeLineSegmentsList(lines, material, name = 'batched-lines') {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const geos = [];
  for (const seg of lines) {
    if (!seg?.geometry?.attributes?.position) continue;
    seg.updateMatrixWorld(true);
    const g = seg.geometry.clone();
    for (const attrName of Object.keys(g.attributes)) {
      if (attrName !== 'position') g.deleteAttribute(attrName);
    }
    g.applyMatrix4(seg.matrixWorld);
    geos.push(g);
  }
  if (geos.length === 0) return null;
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return null;
  const out = new THREE.LineSegments(merged, material);
  out.name = name;
  out.frustumCulled = true;
  return out;
}
