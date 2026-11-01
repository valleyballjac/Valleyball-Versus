import fs from 'fs';

function patchFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let code = fs.readFileSync(filePath, 'utf8');

  // Replace ball texture URLs
  code = code.replace(
    /textureUrl:\s*assetUrl\('textures\/ball_small\.png'\),\s*emissiveUrl:\s*assetUrl\('textures\/ball_small_emissive\.png'\),/g,
    "textureUrl: assetUrl(HALLOWEEN_SKINS ? 'textures/ball_pumpkin_small.png' : 'textures/ball_small.png'),\n      emissiveUrl: assetUrl(HALLOWEEN_SKINS ? 'textures/ball_pumpkin_small_emissive.png' : 'textures/ball_small_emissive.png'),"
  );
  code = code.replace(
    /textureUrl:\s*assetUrl\('textures\/ball_medium\.png'\),\s*emissiveUrl:\s*assetUrl\('textures\/ball_medium_emissive\.png'\),/g,
    "textureUrl: assetUrl(HALLOWEEN_SKINS ? 'textures/ball_pumpkin_medium.png' : 'textures/ball_medium.png'),\n      emissiveUrl: assetUrl(HALLOWEEN_SKINS ? 'textures/ball_pumpkin_medium_emissive.png' : 'textures/ball_medium_emissive.png'),"
  );
  code = code.replace(
    /textureUrl:\s*assetUrl\('textures\/ball_large\.png'\),\s*emissiveUrl:\s*assetUrl\('textures\/ball_large_emissive\.png'\),/g,
    "textureUrl: assetUrl(HALLOWEEN_SKINS ? 'textures/ball_pumpkin_large.png' : 'textures/ball_large.png'),\n      emissiveUrl: assetUrl(HALLOWEEN_SKINS ? 'textures/ball_pumpkin_large_emissive.png' : 'textures/ball_large_emissive.png'),"
  );

  fs.writeFileSync(filePath, code, 'utf8');
  console.log(`Patched ${filePath}`);
}

patchFile('src/config/tuning.js');
patchFile('../Valleyball-Versus-AI-debut/src/config/tuning.js');
