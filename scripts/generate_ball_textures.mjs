import fs from 'fs';
import { chromium } from 'file:///C:/Users/portt/Dev/Valleyball/Valleyball-Demo/node_modules/playwright/index.mjs';

async function generateBallTextures() {
  console.log('Fetching Natural Earth 50m land GeoJSON...');
  const res = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson');
  const geojson = await res.json();
  console.log(`Fetched ${geojson.features.length} land features.`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const BALL_CONFIGS = [
    {
      name: 'ball_small',
      title: 'Foot Ball (Small, 0.4m) — Noir Stealth Earth',
      ballType: 'small',
      oceanColor: '#101114',
      landColor: '#1e2025',
      reliefColor: '#17181c',
      lineWidth: 3.5,
      blur: 9,
      emissiveIntensity: 1.2,
    },
    {
      name: 'ball_medium',
      title: 'Medium Ball (1.0m) — Yin-Yang Earth',
      ballType: 'medium',
      oceanColor: '#070709',
      landColor: '#f2f2f5',
      reliefColor: '#dedee3',
      lineWidth: 4.0,
      blur: 11,
      emissiveIntensity: 1.3,
    },
    {
      name: 'ball_large',
      title: 'Big Ball (1.5m) — Porcelain Pearl Earth',
      ballType: 'large',
      oceanColor: '#f4f2ee',
      landColor: '#e4dfd7',
      reliefColor: '#d6cfc4',
      lineWidth: 3.2,
      blur: 7,
      emissiveIntensity: 1.0,
    },
  ];

  for (const cfg of BALL_CONFIGS) {
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

      // Ocean
      diffCtx.fillStyle = config.oceanColor;
      diffCtx.fillRect(0, 0, W, H);

      // Continents
      diffCtx.fillStyle = config.landColor;
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

      // Subtle relief topography shading
      diffCtx.fillStyle = config.reliefColor;
      diffCtx.globalAlpha = 0.25;
      for (const feature of data.features) {
        const geom = feature.geometry;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        for (const poly of polys) {
          for (const ring of poly) {
            diffCtx.save();
            diffCtx.translate(1.5, 2.0);
            drawPoly(diffCtx, ring);
            diffCtx.fill();
            diffCtx.restore();
          }
        }
      }
      diffCtx.globalAlpha = 1.0;

      function getColor(lon, lat) {
        if (config.ballType === 'small') {
          const nLon = (lon + 180) / 360;
          const nLat = (lat + 90) / 180;
          const hue = Math.round((nLon * 340 + nLat * 60 + 260) % 360);
          return `hsl(${hue}, 100%, 65%)`;
        } else if (config.ballType === 'medium') {
          let hue;
          if (lon >= -30 && lon <= 50) {
            const t = (lon + 30) / 80;
            hue = 180 - t * 140;
          } else if (lon > 50 && lon <= 180) {
            const t = (lon - 50) / 130;
            hue = (40 - t * 80 + 360) % 360;
          } else {
            const t = (lon + 180) / 150;
            hue = 270 - t * 90;
          }
          return `hsl(${Math.round(hue)}, 100%, 62%)`;
        } else {
          const nLon = (lon + 180) / 360;
          const hue = Math.round((nLon * 360 + 190) % 360);
          return `hsl(${hue}, 95%, 60%)`;
        }
      }

      // Draw Glowing Coastlines on Diffuse
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

              const col = getColor(lon1, lat1);
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

      // --- 2. RENDER EMISSIVE MAP ---
      const emCanvas = document.createElement('canvas');
      emCanvas.width = W;
      emCanvas.height = H;
      const emCtx = emCanvas.getContext('2d');

      // Pure black background for emissive
      emCtx.fillStyle = '#000000';
      emCtx.fillRect(0, 0, W, H);

      emCtx.lineWidth = config.lineWidth * 1.1;
      emCtx.shadowBlur = config.blur * 1.3;

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

              const col = getColor(lon1, lat1);
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

    fs.writeFileSync(`public/textures/${cfg.name}.png`, diffBuf);
    fs.writeFileSync(`public/textures/${cfg.name}_emissive.png`, emBuf);
    console.log(`  Saved public/textures/${cfg.name}.png (${Math.round(diffBuf.length / 1024)} KB)`);
    console.log(`  Saved public/textures/${cfg.name}_emissive.png (${Math.round(emBuf.length / 1024)} KB)`);
  }

  await browser.close();
  console.log('\nAll 3 ball textures and emissive maps generated successfully!');
}

generateBallTextures().catch(console.error);
