import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

async function generatePumpkinTextures() {
  console.log('Fetching Natural Earth 50m land GeoJSON...');
  const res = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson');
  if (!res.ok) {
    throw new Error(`Failed to fetch GeoJSON: ${res.statusText}`);
  }
  const geojson = await res.json();
  console.log(`Fetched ${geojson.features.length} land features.`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const PUMPKIN_CONFIGS = [
    {
      name: 'ball_pumpkin_small',
      title: 'Small Ball (0.4m) — Cinder Jack (Noir Ember Earth)',
      ballType: 'small',
      // Dark charred gourd rind
      oceanColor: '#1c1008',
      ribDarkColor: 'rgba(10, 4, 1, 0.7)',
      ribLightColor: 'rgba(60, 25, 8, 0.4)',
      // Roasted autumn umber continent pulp
      landColor: '#6a2a07',
      reliefColor: '#361202',
      ribCount: 16,
      lineWidth: 3.5,
      blur: 10,
      glowColors: ['#ff2a00', '#ff6600', '#ff9900', '#ff3700'],
      emissiveIntensity: 1.4,
    },
    {
      name: 'ball_pumpkin_medium',
      title: 'Medium Ball (1.0m) — The Great Pumpkin Earth (Classic Harvest Jack)',
      ballType: 'medium',
      // Deep harvest pumpkin orange rind with rich shadow
      oceanColor: '#b43e00',
      ribDarkColor: 'rgba(74, 20, 0, 0.65)',
      ribLightColor: 'rgba(235, 115, 20, 0.35)',
      // Bright carved golden squash flesh
      landColor: '#ffb224',
      reliefColor: '#5c1900',
      ribCount: 20,
      lineWidth: 4.5,
      blur: 14,
      glowColors: ['#ff4500', '#ff8c00', '#ffc837', '#ffea70'],
      emissiveIntensity: 1.5,
    },
    {
      name: 'ball_pumpkin_large',
      title: 'Large Ball (1.5m) — Ghost Lumina Earth (Spectral Heirloom Gourd)',
      ballType: 'large',
      // Ivory ghost pumpkin rind
      oceanColor: '#e9e3d5',
      ribDarkColor: 'rgba(175, 163, 145, 0.5)',
      ribLightColor: 'rgba(255, 255, 255, 0.5)',
      // Muted witch-gold & dried sage continents
      landColor: '#d6c69b',
      reliefColor: '#968869',
      ribCount: 24,
      lineWidth: 3.6,
      blur: 9,
      glowColors: ['#f59e0b', '#eab308', '#84cc16', '#a3e635'],
      emissiveIntensity: 1.2,
    },
  ];

  for (const cfg of PUMPKIN_CONFIGS) {
    console.log(`\nRendering ${cfg.title}...`);

    const result = await page.evaluate(async ({ data, config }) => {
      const W = 2048;
      const H = 1024;

      function lonToX(lon) { return ((lon + 180) / 360) * W; }
      function latToY(lat) { return ((90 - lat) / 180) * H; }

      function drawPoly(ctx, coords) {
        ctx.beginPath();
        for (let i = 0; i < coords.length; i++) {
          const [lon, lat] = coords[i];
          const x = lonToX(lon);
          const y = latToY(lat);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }

      // --- 1. RENDER DIFFUSE MAP ---
      const diffCanvas = document.createElement('canvas');
      diffCanvas.width = W;
      diffCanvas.height = H;
      const diffCtx = diffCanvas.getContext('2d');

      // 1.1 Base Rind Color
      diffCtx.fillStyle = config.oceanColor;
      diffCtx.fillRect(0, 0, W, H);

      // 1.2 Vertical Pumpkin Longitude Ribs (Gourd Lobes)
      // Pumpkins have organic vertical ribs running North-to-South along longitudes.
      const ribGrad = diffCtx.createLinearGradient(0, 0, W, 0);
      const ribs = config.ribCount;
      for (let r = 0; r <= ribs; r++) {
        const t = r / ribs;
        ribGrad.addColorStop(Math.max(0, t - 0.015), config.ribLightColor);
        ribGrad.addColorStop(t, config.ribDarkColor);
        ribGrad.addColorStop(Math.min(1, t + 0.015), config.ribLightColor);
      }
      diffCtx.fillStyle = ribGrad;
      diffCtx.fillRect(0, 0, W, H);

      // 1.3 Fine pumpkin skin striations / organic waxy grain
      const grainCanvas = document.createElement('canvas');
      grainCanvas.width = 512;
      grainCanvas.height = 512;
      const gCtx = grainCanvas.getContext('2d');
      const gImg = gCtx.createImageData(512, 512);
      for (let i = 0; i < gImg.data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 32;
        gImg.data[i] = 128 + noise;
        gImg.data[i + 1] = 128 + noise;
        gImg.data[i + 2] = 128 + noise;
        gImg.data[i + 3] = 22; // very subtle
      }
      gCtx.putImageData(gImg, 0, 0);
      const pattern = diffCtx.createPattern(grainCanvas, 'repeat');
      if (pattern) {
        diffCtx.fillStyle = pattern;
        diffCtx.fillRect(0, 0, W, H);
      }

      // 1.4 Polar caps: stem shadow at North pole, blossom scar at South pole
      const stemGrad = diffCtx.createLinearGradient(0, 0, 0, H);
      stemGrad.addColorStop(0, 'rgba(28, 40, 18, 0.45)');   // subtle moss/stem cap
      stemGrad.addColorStop(0.04, 'rgba(0, 0, 0, 0)');
      stemGrad.addColorStop(0.96, 'rgba(0, 0, 0, 0)');
      stemGrad.addColorStop(1, 'rgba(45, 20, 5, 0.5)');     // blossom base scar
      diffCtx.fillStyle = stemGrad;
      diffCtx.fillRect(0, 0, W, H);

      // 1.5 Carved Continents Depth Layer 1 (Dark drop shadow into the rind)
      diffCtx.save();
      diffCtx.translate(2.5, 3.5);
      diffCtx.fillStyle = config.reliefColor;
      diffCtx.globalAlpha = 0.65;
      for (const feature of data.features) {
        const geom = feature.geometry;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        for (const poly of polys) {
          for (const ring of poly) {
            drawPoly(diffCtx, ring);
            diffCtx.fill();
          }
        }
      }
      diffCtx.restore();

      // 1.6 Carved Continents Interior Flesh (The Landmasses)
      diffCtx.fillStyle = config.landColor;
      diffCtx.globalAlpha = 1.0;
      for (const feature of data.features) {
        const geom = feature.geometry;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        for (const poly of polys) {
          for (const ring of poly) {
            drawPoly(diffCtx, ring);
            diffCtx.fill();
          }
        }
      }

      // 1.7 Inner Relief Topography (Pulp ridges within the carved continent)
      diffCtx.save();
      diffCtx.translate(-1.0, -1.0);
      diffCtx.fillStyle = '#ffedd5'; // subtle carved highlight edge
      diffCtx.globalAlpha = 0.35;
      for (const feature of data.features) {
        const geom = feature.geometry;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        for (const poly of polys) {
          for (const ring of poly) {
            drawPoly(diffCtx, ring);
            diffCtx.fill();
          }
        }
      }
      diffCtx.restore();

      // 1.8 Glowing Jack-o'-Lantern Coastlines (Diffuse Flame)
      function getFlameColor(lon, lat) {
        const n = ((lon + 180) / 360 + (lat + 90) / 180) * 0.5;
        const cols = config.glowColors;
        const idx = Math.floor(n * cols.length) % cols.length;
        return cols[idx];
      }

      diffCtx.lineWidth = config.lineWidth;
      diffCtx.shadowBlur = config.blur;

      for (const feature of data.features) {
        const geom = feature.geometry;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        for (const poly of polys) {
          for (const ring of poly) {
            if (ring.length < 2) continue;
            for (let i = 0; i < ring.length - 1; i++) {
              const [lon1, lat1] = ring[i];
              const [lon2, lat2] = ring[i + 1];
              if (Math.abs(lon1 - lon2) > 180) continue;

              const x1 = lonToX(lon1);
              const y1 = latToY(lat1);
              const x2 = lonToX(lon2);
              const y2 = latToY(lat2);

              const col = getFlameColor(lon1, lat1);
              diffCtx.strokeStyle = col;
              diffCtx.shadowColor = col;
              diffCtx.beginPath();
              diffCtx.moveTo(x1, y1);
              diffCtx.lineTo(x2, y2);
              diffCtx.stroke();
            }
          }
        }
      }

      // --- 2. RENDER EMISSIVE MAP (Jack-o'-Lantern Internal Flame) ---
      const emCanvas = document.createElement('canvas');
      emCanvas.width = W;
      emCanvas.height = H;
      const emCtx = emCanvas.getContext('2d');

      // Pure black background for emissive
      emCtx.fillStyle = '#000000';
      emCtx.fillRect(0, 0, W, H);

      // Pass 1: Outer Molten Ember Halo
      emCtx.lineWidth = config.lineWidth * 1.6;
      emCtx.shadowBlur = config.blur * 1.6;

      for (const feature of data.features) {
        const geom = feature.geometry;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        for (const poly of polys) {
          for (const ring of poly) {
            if (ring.length < 2) continue;
            for (let i = 0; i < ring.length - 1; i++) {
              const [lon1, lat1] = ring[i];
              const [lon2, lat2] = ring[i + 1];
              if (Math.abs(lon1 - lon2) > 180) continue;

              const x1 = lonToX(lon1);
              const y1 = latToY(lat1);
              const x2 = lonToX(lon2);
              const y2 = latToY(lat2);

              const col = config.glowColors[0]; // deep flame
              emCtx.strokeStyle = col;
              emCtx.shadowColor = col;
              emCtx.beginPath();
              emCtx.moveTo(x1, y1);
              emCtx.lineTo(x2, y2);
              emCtx.stroke();
            }
          }
        }
      }

      // Pass 2: Intense Incandescent Core
      emCtx.lineWidth = config.lineWidth * 0.9;
      emCtx.shadowBlur = config.blur * 0.7;

      for (const feature of data.features) {
        const geom = feature.geometry;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        for (const poly of polys) {
          for (const ring of poly) {
            if (ring.length < 2) continue;
            for (let i = 0; i < ring.length - 1; i++) {
              const [lon1, lat1] = ring[i];
              const [lon2, lat2] = ring[i + 1];
              if (Math.abs(lon1 - lon2) > 180) continue;

              const x1 = lonToX(lon1);
              const y1 = latToY(lat1);
              const x2 = lonToX(lon2);
              const y2 = latToY(lat2);

              const col = config.glowColors[config.glowColors.length - 1]; // brightest hot highlight
              emCtx.strokeStyle = col;
              emCtx.shadowColor = col;
              emCtx.beginPath();
              emCtx.moveTo(x1, y1);
              emCtx.lineTo(x2, y2);
              emCtx.stroke();
            }
          }
        }
      }

      return {
        diffuse: diffCanvas.toDataURL('image/png'),
        emissive: emCanvas.toDataURL('image/png'),
      };
    }, {
      data: geojson,
      config: cfg,
    });

    const diffBuf = Buffer.from(result.diffuse.replace(/^data:image\/png;base64,/, ''), 'base64');
    const emBuf = Buffer.from(result.emissive.replace(/^data:image\/png;base64,/, ''), 'base64');

    // Save to main worktree and debut worktree if present
    const targetDirs = [
      path.resolve('public/textures'),
      path.resolve('../Valleyball-Versus-AI-debut/public/textures'),
    ];

    for (const dir of targetDirs) {
      if (fs.existsSync(dir)) {
        fs.writeFileSync(path.join(dir, `${cfg.name}.png`), diffBuf);
        fs.writeFileSync(path.join(dir, `${cfg.name}_emissive.png`), emBuf);
        console.log(`  Saved ${path.join(dir, cfg.name)}.png (${Math.round(diffBuf.length / 1024)} KB)`);
        console.log(`  Saved ${path.join(dir, `${cfg.name}_emissive.png`)} (${Math.round(emBuf.length / 1024)} KB)`);
      }
    }
  }

  await browser.close();
  console.log('\nAll 3 Pumpkin Valleyball textures and emissive maps generated successfully!');
}

generatePumpkinTextures().catch(console.error);
