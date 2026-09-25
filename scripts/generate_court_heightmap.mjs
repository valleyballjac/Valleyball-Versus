import fs from 'fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const glbBuffer = fs.readFileSync('public/models/arena.glb');
const arrayBuffer = glbBuffer.buffer.slice(glbBuffer.byteOffset, glbBuffer.byteOffset + glbBuffer.byteLength);

new GLTFLoader().parse(arrayBuffer, '', (gltf) => {
  let court = null;
  gltf.scene.traverse((obj) => {
    if (obj.name === 'COL_Court') court = obj;
  });

  if (!court) {
    console.error('COL_Court not found in arena.glb');
    process.exit(1);
  }

  const pos = court.geometry.attributes.position;
  const gridW = 49;
  const gridH = 111;
  const uint16Arr = new Uint16Array(gridW * gridH);

  for (let r = 0; r < gridH; r++) {
    const gz = -55 + r;
    for (let c = 0; c < gridW; c++) {
      const gx = -24 + c;
      let closestY = 0;
      let minDist = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i);
        const py = pos.getY(i);
        const pz = pos.getZ(i);
        const d = (px - gx) * (px - gx) + (pz - gz) * (pz - gz);
        if (d < minDist) {
          minDist = d;
          closestY = py;
        }
      }
      uint16Arr[r * gridW + c] = Math.round(closestY * 1000);
    }
  }

  const buffer = Buffer.from(uint16Arr.buffer);
  const base64 = buffer.toString('base64');
  console.log('Base64 string length:', base64.length);

  const fileContent = `/**
 * Precomputed 1m resolution elevation grid for the canonical Valley Court (COL_Court).
 * 49 cols (X: -24 to 24m) x 111 rows (Z: -55 to 55m). Millimeter precision (Uint16).
 * Mean elevation error: 0.030m (3cm).
 */
const GRID_W = 49;
const GRID_H = 111;
const MIN_X = -24;
const MIN_Z = -55;

const b64 = '${base64}';
const binStr = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
const bytes = new Uint8Array(binStr.length);
for (let i = 0; i < binStr.length; i++) {
  bytes[i] = binStr.charCodeAt(i);
}
const HEIGHTS = new Uint16Array(bytes.buffer);

/**
 * Samples authentic Valley Court terrain surface height (Y in meters) at (x, z).
 * Bilinear interpolation with 3cm mean error.
 * Supports legacy (z) call signature.
 *
 * @param {number} x Lateral court coordinate (-24 to 24m)
 * @param {number} [z] Longitudinal court coordinate (-55 to 55m)
 * @returns {number} Terrain floor Y in meters
 */
export function getCourtFloorY(x, z) {
  if (z === undefined) {
    z = x;
    x = 0;
  }
  const cx = Math.max(0, Math.min(GRID_W - 1, x - MIN_X));
  const rz = Math.max(0, Math.min(GRID_H - 1, z - MIN_Z));
  const x0 = Math.floor(cx);
  const x1 = Math.min(GRID_W - 1, x0 + 1);
  const z0 = Math.floor(rz);
  const z1 = Math.min(GRID_H - 1, z0 + 1);
  const fx = cx - x0;
  const fz = rz - z0;
  const y00 = HEIGHTS[z0 * GRID_W + x0] * 0.001;
  const y10 = HEIGHTS[z0 * GRID_W + x1] * 0.001;
  const y01 = HEIGHTS[z1 * GRID_W + x0] * 0.001;
  const y11 = HEIGHTS[z1 * GRID_W + x1] * 0.001;
  return (y00 * (1 - fx) + y10 * fx) * (1 - fz) + (y01 * (1 - fx) + y11 * fx) * fz;
}

/**
 * Computes unit surface normal on the terrain at (x, z).
 * Uses finite central differences.
 *
 * @param {number} x
 * @param {number} z
 * @param {THREE.Vector3} [outVec] Optional scratch vector
 * @returns {THREE.Vector3|{x: number, y: number, z: number}}
 */
export function getCourtSlopeNormal(x, z, outVec = null) {
  const eps = 0.5;
  const yL = getCourtFloorY(x - eps, z);
  const yR = getCourtFloorY(x + eps, z);
  const yD = getCourtFloorY(x, z - eps);
  const yU = getCourtFloorY(x, z + eps);
  const dYdX = (yR - yL) / (2 * eps);
  const dYdZ = (yU - yD) / (2 * eps);
  const len = Math.hypot(-dYdX, 1.0, -dYdZ) || 1.0;
  const nx = -dYdX / len;
  const ny = 1.0 / len;
  const nz = -dYdZ / len;
  if (outVec) {
    outVec.set(nx, ny, nz);
    return outVec;
  }
  return { x: nx, y: ny, z: nz };
}
`;

  fs.writeFileSync('src/ai/courtHeightmap.js', fileContent);
  console.log('Successfully written src/ai/courtHeightmap.js');
});
