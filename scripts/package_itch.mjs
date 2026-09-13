import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const outDir = path.join(root, 'dist-itch');
const releaseDir = path.join(root, 'release');
const zipFile = path.join(releaseDir, 'valleyball-versus-itch.zip');

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

// 3. Create zip archive with index.html at root
console.log('\n[3/3] Creating zip archive (valleyball-versus-itch.zip)...');
try {
  execSync(`tar -a -c -f "${zipFile}" -C "${outDir}" .`, { stdio: 'inherit', cwd: root });
} catch (e) {
  console.log('tar fallback to PowerShell Compress-Archive...');
  execSync(`powershell -Command "Compress-Archive -Path '${outDir}/*' -DestinationPath '${zipFile}' -Force"`, { stdio: 'inherit', cwd: root });
}

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
