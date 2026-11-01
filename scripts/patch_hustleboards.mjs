import fs from 'fs';

function patchHustleBoards(filePath) {
  if (!fs.existsSync(filePath)) return;
  let code = fs.readFileSync(filePath, 'utf8');

  code = code.replace(
    "import { TUNING } from '../config/tuning.js';",
    "import { TUNING, HALLOWEEN_SKINS } from '../config/tuning.js';"
  );
  code = code.replace(
    "ctx.fillText('ENTER PRACTICE SANDBOX OR 1V1 MATCH FOR LIVE METRICS', W / 2, H * 0.48);",
    "ctx.fillText(HALLOWEEN_SKINS ? 'RULEBOOK AUDIT: NO RULE SAYS DOGS CANNOT PLAY VALLEYBALL 🐕🎃' : 'ENTER PRACTICE SANDBOX OR 1V1 MATCH FOR LIVE METRICS', W / 2, H * 0.48);"
  );
  code = code.replace(
    "ctx.fillText('LIVE TELEMETRY ARMED · 4 ARENA SCREENS', W / 2, H * 0.90);",
    "ctx.fillText(HALLOWEEN_SKINS ? 'CANINE DIVISION ARMED · HALLOWEEN PUMPKIN EDITION' : 'LIVE TELEMETRY ARMED · 4 ARENA SCREENS', W / 2, H * 0.90);"
  );

  fs.writeFileSync(filePath, code, 'utf8');
  console.log(`Patched ${filePath}`);
}

patchHustleBoards('src/visuals/hustleBoards.js');
patchHustleBoards('../Valleyball-Versus-AI-debut/src/visuals/hustleBoards.js');
