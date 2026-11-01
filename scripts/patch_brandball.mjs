import fs from 'fs';

function patchBrandBall(filePath) {
  if (!fs.existsSync(filePath)) return;
  let code = fs.readFileSync(filePath, 'utf8');

  code = code.replace(
    "import { assetUrl } from '../config/tuning.js';",
    "import { assetUrl, HALLOWEEN_SKINS } from '../config/tuning.js';"
  );
  code = code.replace(
    "const diffuseMap = textureLoader.load(assetUrl('textures/ball_medium.png'));",
    "const diffuseMap = textureLoader.load(assetUrl(HALLOWEEN_SKINS ? 'textures/ball_pumpkin_medium.png' : 'textures/ball_medium.png'));"
  );
  code = code.replace(
    "const emissiveMap = textureLoader.load(assetUrl('textures/ball_medium_emissive.png'));",
    "const emissiveMap = textureLoader.load(assetUrl(HALLOWEEN_SKINS ? 'textures/ball_pumpkin_medium_emissive.png' : 'textures/ball_medium_emissive.png'));"
  );

  fs.writeFileSync(filePath, code, 'utf8');
  console.log(`Patched ${filePath}`);
}

patchBrandBall('src/visuals/brandBall.js');
patchBrandBall('../Valleyball-Versus-AI-debut/src/visuals/brandBall.js');
