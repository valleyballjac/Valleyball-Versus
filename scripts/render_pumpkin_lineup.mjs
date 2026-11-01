import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

async function renderLineup() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  const smallDiff = fs.readFileSync('public/textures/ball_pumpkin_small.png').toString('base64');
  const smallEm = fs.readFileSync('public/textures/ball_pumpkin_small_emissive.png').toString('base64');
  const medDiff = fs.readFileSync('public/textures/ball_pumpkin_medium.png').toString('base64');
  const medEm = fs.readFileSync('public/textures/ball_pumpkin_medium_emissive.png').toString('base64');
  const lrgDiff = fs.readFileSync('public/textures/ball_pumpkin_large.png').toString('base64');
  const lrgEm = fs.readFileSync('public/textures/ball_pumpkin_large_emissive.png').toString('base64');

  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <script type="importmap">
          {
            "imports": {
              "three": "https://unpkg.com/three@0.185.1/build/three.module.js"
            }
          }
        </script>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
      </head>
      <body style="margin: 0; background: #07090e; overflow: hidden; font-family: 'Space Grotesk', sans-serif;">
        <canvas id="c" width="1920" height="1080" style="width: 1920px; height: 1080px; display: block;"></canvas>
      </body>
    </html>
  `);

  const lineupBase64 = await page.evaluate(async (data) => {
    const THREE = await import('three');
    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(1920, 1080, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06070a);

    const camera = new THREE.PerspectiveCamera(38, 1920 / 1080, 0.1, 100);
    camera.position.set(0, 0.2, 5.0);
    camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffeedd, 0.7);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xfff5ea, 1.8);
    keyLight.position.set(4, 5, 4);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xff5500, 1.3);
    rimLight.position.set(-5, 1, -2);
    scene.add(rimLight);

    const spookyPurple = new THREE.DirectionalLight(0x7c3aed, 0.4);
    spookyPurple.position.set(0, -3, 2);
    scene.add(spookyPurple);

    const loader = new THREE.TextureLoader();

    async function createBallMesh(diffB64, emB64, radius, emIntensity) {
      const [diffMap, emMap] = await Promise.all([
        new Promise(res => loader.load('data:image/png;base64,' + diffB64, res)),
        new Promise(res => loader.load('data:image/png;base64,' + emB64, res)),
      ]);
      diffMap.colorSpace = THREE.SRGBColorSpace;
      emMap.colorSpace = THREE.SRGBColorSpace;

      const geom = new THREE.SphereGeometry(radius, 64, 48);
      const mat = new THREE.MeshStandardMaterial({
        map: diffMap,
        emissiveMap: emMap,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: emIntensity,
        roughness: 0.38,
        metalness: 0.05,
      });
      return new THREE.Mesh(geom, mat);
    }

    // Small Ball on the left
    const smallGroup = new THREE.Group();
    smallGroup.position.set(-2.2, -0.15, 0);
    smallGroup.rotation.z = -0.25;
    smallGroup.rotation.x = 0.22;
    smallGroup.rotation.y = -1.1;
    const smallMesh = await createBallMesh(data.smallDiff, data.smallEm, 0.65, 1.4);
    smallGroup.add(smallMesh);
    scene.add(smallGroup);

    // Medium Ball in the center (hero)
    const medGroup = new THREE.Group();
    medGroup.position.set(0, 0.1, 0.3);
    medGroup.rotation.z = -0.25;
    medGroup.rotation.x = 0.22;
    medGroup.rotation.y = -1.1;
    const medMesh = await createBallMesh(data.medDiff, data.medEm, 1.0, 1.5);
    medGroup.add(medMesh);
    scene.add(medGroup);

    // Large Ball on the right
    const lrgGroup = new THREE.Group();
    lrgGroup.position.set(2.4, 0.2, -0.4);
    lrgGroup.rotation.z = -0.25;
    lrgGroup.rotation.x = 0.22;
    lrgGroup.rotation.y = -1.1;
    const lrgMesh = await createBallMesh(data.lrgDiff, data.lrgEm, 1.25, 1.2);
    lrgGroup.add(lrgMesh);
    scene.add(lrgGroup);

    renderer.render(scene, camera);

    // Overlay 2D typography onto canvas
    const ctx = canvas.getContext('2d');
    // Note: WebGL context preserves buffer or we can grab image
    return canvas.toDataURL('image/png');
  }, {
    smallDiff, smallEm,
    medDiff, medEm,
    lrgDiff, lrgEm,
  });

  const buf = Buffer.from(lineupBase64.replace(/^data:image\/png;base64,/, ''), 'base64');
  fs.writeFileSync('public/textures/valleyball_halloween_lineup.png', buf);

  const artifactDir = 'C:/Users/portt/.gemini/antigravity/brain/afca4e5d-0910-4db6-860f-b43f00536cc7';
  if (fs.existsSync(artifactDir)) {
    fs.writeFileSync(path.join(artifactDir, 'valleyball_halloween_lineup.png'), buf);
    console.log('Saved 3-ball lineup to artifacts directory!');
  }

  await browser.close();
}

renderLineup().catch(console.error);
