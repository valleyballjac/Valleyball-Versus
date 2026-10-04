import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';

const root = process.cwd();
const outDir = path.join(root, 'dist-itch');
const releaseDir = path.join(root, 'release');
const zipFile = path.join(releaseDir, 'valleyball-versus-itch.zip');

// --- Minimal, dependency-free ZIP writer ------------------------------------
// Emits forward-slash entry paths (itch.io requires '/', not '\') and uses
// zlib (Node built-in) so no external archiver can leak platform separators.
// A fixed DOS timestamp keeps the archive byte-reproducible across runs.

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0;       // 00:00:00
const DOS_DATE = 0x5c21;  // 2026-01-01 ((2026-1980)<<9 | 1<<5 | 1)

function collectFiles(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, base, out);
    else if (entry.isFile()) out.push({ rel: path.relative(base, full).split(path.sep).join('/'), full });
  }
  return out;
}

function writeZip(srcDir, zipPath) {
  const files = collectFiles(srcDir, srcDir, []).sort((a, b) => a.rel.localeCompare(b.rel));
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { rel, full } of files) {
    const data = fs.readFileSync(full);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const method = compressed.length < data.length ? 8 : 0;
    const payload = method === 8 ? compressed : data;
    const crc = crc32(data);
    const nameBuf = Buffer.from(rel, 'utf8');

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(DOS_TIME, 10);
    lfh.writeUInt16LE(DOS_DATE, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(payload.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    chunks.push(lfh, nameBuf, payload);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(0x0314, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(DOS_TIME, 12);
    cdh.writeUInt16LE(DOS_DATE, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(payload.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    central.push(cdh, nameBuf);

    offset += 30 + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(zipPath, Buffer.concat([...chunks, centralBuf, eocd]));
  return files.length;
}

console.log('=== PACKAGING VALLEYBALL VERSUS FOR ITCH.IO ===');

// 1. Build with relative base
console.log('\n[1/3] Building with relative base (./)...');
if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true });
}
execSync('npx vite build --base=./ --outDir dist-itch', { stdio: 'inherit', cwd: root });

// 2. Ensure release directory
console.log('\n[2/3] Preparing release destination...');
if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}
if (fs.existsSync(zipFile)) {
  fs.unlinkSync(zipFile);
}

// 3. Create zip archive with index.html at root (forward-slash paths)
console.log('\n[3/3] Creating zip archive (valleyball-versus-itch.zip)...');
const entryCount = writeZip(outDir, zipFile);
console.log(`Archived ${entryCount} entries with forward-slash paths.`);

// 4. Verify zip contents
const stats = fs.statSync(zipFile);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
console.log(`\n======================================================`);
console.log(`Successfully created: ${zipFile}`);
console.log(`Archive Size: ${sizeMB} MB`);
console.log(`Structure: 'index.html' is at the root of the archive.`);
console.log(`======================================================\n`);
console.log('Ready to upload to itch.io:');
console.log('1. Go to https://itch.io/game/new (or edit your game)');
console.log('2. Set "Kind of project" -> "HTML"');
console.log('3. Upload "release/valleyball-versus-itch.zip"');
console.log('4. Check "This file will be played in the browser"');
console.log('5. Viewport: 1280x720 (or 1600x900), enable Fullscreen button');