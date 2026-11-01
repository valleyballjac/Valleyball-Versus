import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

async function renderPreview() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });

  const diffBase64 = fs.readFileSync('public/textures/ball_pumpkin_medium.png').toString('base64');
  const emBase64 = fs.readFileSync('public/textures/ball_pumpkin_medium_emissive.png').toString('base64');

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
      </head>
      <body style="margin: 0; background: #07090e; display: flex; justify-content: center; align-items: center; height: 100vh;">
        <canvas id="c" width="1024" height="1024" style="width: 1024px; height: 1024px;"></canvas>
      </body>
    </html>
  `);

  const previewBase64 = await page.evaluate(async ({ diffData, emData }) => {
    const THREE = await import('three');
    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(1024, 1024, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0.05, 3.0);
    camera.lookAt(0, 0, 0);

    // Warm dramatic lighting for Halloween
    const ambient = new THREE.AmbientLight(0xffeedd, 0.7);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xfff5ea, 1.8);
    keyLight.position.set(3, 4, 3);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xff5500, 1.4);
    rimLight.position.set(-3, 1, -2);
    scene.add(rimLight);

    const fillLight = new THREE.DirectionalLight(0x6d28d9, 0.35); // subtle spooky purple fill
    fillLight.position.set(0, -3, 2);
    scene.add(fillLight);

    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.z = -0.25; // Earth axial tilt
    tiltGroup.rotation.x = 0.22;  // Pitch downward to showcase Northern continents
    tiltGroup.rotation.y = -1.1;  // Americas & Atlantic view
    scene.add(tiltGroup);

    const loader = new THREE.TextureLoader();
    const [diffMap, emMap] = await Promise.all([
      new Promise(res => loader.load('data:image/png;base64,' + diffData, res)),
      new Promise(res => loader.load('data:image/png;base64,' + emData, res)),
    ]);
    diffMap.colorSpace = THREE.SRGBColorSpace;
    emMap.colorSpace = THREE.SRGBColorSpace;

    const geom = new THREE.SphereGeometry(1.0, 64, 48);
    const mat = new THREE.MeshStandardMaterial({
      map: diffMap,
      emissiveMap: emMap,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 1.4,
      roughness: 0.38,
      metalness: 0.05,
    });

    const mesh = new THREE.Mesh(geom, mat);
    tiltGroup.add(mesh);

    renderer.render(scene, camera);
    return canvas.toDataURL('image/png');
  }, { diffData: diffBase64, emData: emBase64 });

  const buf = Buffer.from(previewBase64.replace(/^data:image\/png;base64,/, ''), 'base64');
  fs.writeFileSync('public/textures/preview_pumpkin_ball.png', buf);
  console.log('Saved preview to public/textures/preview_pumpkin_ball.png');

  const artifactDir = 'C:/Users/portt/.gemini/antigravity/brain/afca4e5d-0910-4db6-860f-b43f00536cc7';
  if (fs.existsSync(artifactDir)) {
    fs.writeFileSync(path.join(artifactDir, 'preview_pumpkin_ball.png'), buf);
    console.log('Copied preview to artifacts directory');
  }

  await browser.close();
}

renderPreview().catch(console.error);
