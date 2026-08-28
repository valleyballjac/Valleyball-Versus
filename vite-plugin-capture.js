import fs from 'node:fs';
import path from 'node:path';

/**
 * Server half of the capture pipeline. Dev only.
 *
 * Vite's connect stack does not parse JSON bodies, so the request stream is read
 * in chunks and parsed here. A 1080p base64 PNG is several megabytes; nothing
 * below assumes a small body.
 */

const PNG_PREFIX = 'data:image/png;base64,';
const MAX_BODY_BYTES = 64 * 1024 * 1024;

/**
 * `name` arrives over the network and is about to become a path segment.
 * Everything outside [a-z0-9_-] is dropped, and the result is length-limited.
 * @param {unknown} name
 * @returns {string} sanitised name, or '' if nothing survived
 */
export function sanitiseName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
}

function respond(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

/**
 * The request handler, exported on its own so it can be exercised outside Vite.
 * @param {{ root?: string, dir?: string }} [options]
 */
export function createCaptureHandler(options = {}) {
  const root = options.root || process.cwd();
  const outDir = path.resolve(root, options.dir || 'captures');

  return function captureHandler(req, res, next) {
    if (req.method !== 'POST') return next();

    const chunks = [];
    let received = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      received += chunk.length;

      if (received > MAX_BODY_BYTES) {
        aborted = true;
        respond(res, 413, { error: 'capture body too large' });
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('error', () => {
      aborted = true;
    });

    req.on('end', () => {
      if (aborted) return;

      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return respond(res, 400, { error: 'body was not valid JSON' });
      }

      const name = sanitiseName(payload && payload.name);
      if (!name) return respond(res, 400, { error: 'capture name is empty after sanitising' });

      const tick = payload && payload.tick;
      if (!Number.isFinite(tick)) return respond(res, 400, { error: 'tick must be a finite number' });

      const dataUrl = payload && payload.dataUrl;
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_PREFIX)) {
        return respond(res, 400, { error: 'dataUrl must be a base64 PNG data URL' });
      }

      const buffer = Buffer.from(dataUrl.slice(PNG_PREFIX.length), 'base64');

      // A capture meant for comparison gets a stable, tick-addressed name, so a
      // harness can hash `auto_t300.png` without globbing and a re-run
      // overwrites rather than accumulating. Only a capture that explicitly asks
      // to be kept alongside its predecessors gets a timestamp — ISO 8601, with
      // the characters that are illegal in filenames on Windows folded to '-'.
      const stem = `${name}_t${Math.trunc(tick)}`;
      const file = payload.timestamped === true
        ? `${stem}_${new Date().toISOString().replace(/[:.]/g, '-')}.png`
        : `${stem}.png`;
      const full = path.join(outDir, file);

      try {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(full, buffer);
      } catch (error) {
        return respond(res, 500, { error: `could not write capture: ${error.message}` });
      }

      const relative = path.relative(root, full);
      console.log(`[capture] ${relative}  (${buffer.length} bytes)`);
      respond(res, 200, { path: relative });
    });
  };
}

/** @param {{ dir?: string }} [options] */
export default function capturePlugin(options = {}) {
  return {
    name: 'valleyball-capture',
    apply: 'serve',
    configureServer(server) {
      const handler = createCaptureHandler({ root: server.config.root, ...options });
      server.middlewares.use('/__capture', handler);
    },
  };
}
