/**
 * THE AUDIT — the project's laws as code, not prose.
 *
 *   npm run audit              check every rule against baselines/audit-allow.json
 *   npm run audit -- --update  rewrite the allow-list from the current tree
 *                              (only ever to SHRINK it after paying down debt,
 *                              or with a stated reason in the commit message)
 *
 * Every rule is a RATCHET. Known debt is written down in the allow-list with a
 * count; the audit fails when a count goes UP or a new file appears, and it
 * congratulates when a count goes down (then --update locks the gain in). This is
 * how "a census clause is a command that will be run" stops depending on anyone
 * remembering to run it: the census IS this file.
 *
 * Rules (each prints its findings):
 *   clock        Date.now / performance.now / Math.random in sim, mechanics, ai, core
 *   teleport     setTranslation / setLinvel / setAngvel / setRotation per file (LAW 1)
 *   layering     sim/ and mechanics/ importing audio, ui, visuals, features, input, DOM
 *   tuning-write runtime writes to TUNING outside config/ and debug/
 *   dead-module  src files unreachable from the entry points
 *   dead-import  named imports never referenced in the importing file
 *   assets       asset paths in src that do not exist under public/
 *   clips        clip names referenced by TUNING that the character GLB lacks
 *   size         lines per file for the known monoliths (may not grow)
 */

import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const ALLOW_FILE = path.join(ROOT, 'baselines', 'audit-allow.json');
const ENTRIES = ['src/main.js'];
const MONOLITHS = ['src/main.js', 'src/sim/animtarget.js', 'src/config/tuning.js', 'src/mechanics/strikes.js'];

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(m?js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Source with comments blanked (line structure kept), so greps hit code only. */
function stripComments(src) {
  let out = '';
  let i = 0;
  let mode = 'code';
  let quote = '';
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { mode = 'str'; quote = c; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i += 1; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i += 2; continue; } if (c === '\n') out += c; i += 1; continue; }
    if (mode === 'str') {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) mode = 'code';
      i += 1; continue;
    }
  }
  return out;
}

function countMatches(code, re) {
  const hits = [];
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) hits.push({ line: i + 1, text: lines[i].trim().slice(0, 100), n: m.length });
  }
  return hits;
}

function parseImports(code) {
  const imports = [];
  const re = /import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+))?\s*(?:from\s*)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(code))) {
    const names = [];
    if (m[1]) names.push(m[1]);
    if (m[3]) names.push(m[3]);
    if (m[2]) for (const part of m[2].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      names.push((as[1] || as[0]).trim());
    }
    imports.push({ spec: m[4], names });
  }
  const dyn = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dyn.exec(code))) imports.push({ spec: m[1], names: [] });
  return imports;
}

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  let p = path.resolve(path.dirname(fromFile), spec);
  if (!/\.m?js$/.test(p)) p += '.js';
  return p;
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/** Animation names from a GLB's JSON chunk. */
async function glbClipNames(file) {
  const buf = await readFile(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  return (json.animations || []).map((a) => a.name);
}

async function main() {
  const update = process.argv.includes('--update');
  const files = await walk(SRC);
  const code = new Map();
  const raw = new Map();
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    raw.set(f, text);
    code.set(f, stripComments(text));
  }

  const found = {}; // rule -> { key: count }
  const detail = {}; // rule -> [lines]
  const add = (rule, key, n, lines = []) => {
    found[rule] ??= {};
    detail[rule] ??= [];
    found[rule][key] = (found[rule][key] || 0) + n;
    detail[rule].push(...lines.map((l) => `${key}:${l.line}  ${l.text}`));
  };

  const inDirs = (f, dirs) => dirs.some((d) => rel(f).startsWith(`src/${d}/`));

  for (const [f, c] of code) {
    const key = rel(f);

    if (inDirs(f, ['sim', 'mechanics', 'ai', 'core'])) {
      const hits = countMatches(c, /\b(Date\.now|performance\.now|Math\.random)\s*\(/g);
      if (hits.length) add('clock', key, hits.reduce((s, h) => s + h.n, 0), hits);
    }

    const tp = countMatches(c, /\.(setTranslation|setLinvel|setAngvel|setRotation)\s*\(/g);
    if (tp.length) add('teleport', key, tp.reduce((s, h) => s + h.n, 0), tp);

    if (inDirs(f, ['sim', 'mechanics'])) {
      const bad = parseImports(c).filter((imp) => /\/(audio|ui|visuals|features|input)\//.test(imp.spec) || /\.\.\/input(\.js)?$/.test(imp.spec));
      const dom = countMatches(c, /\b(document|window)\./g);
      if (bad.length) add('layering', key, bad.length, bad.map((b) => ({ line: 0, text: `imports ${b.spec}` })));
      if (dom.length) add('layering', key, dom.length, dom);
    }

    if (!inDirs(f, ['config', 'debug'])) {
      const w = countMatches(c, /\bTUNING(\.[\w$]+|\[[^\]]+\])+\s*(=(?!=)|\+=|-=|\*=|\/=)/g);
      const assign = countMatches(c, /Object\.assign\(\s*TUNING\b/g);
      const all = [...w, ...assign];
      if (all.length) add('tuning-write', key, all.length, all);
    }

    // assets: quoted relative asset paths
    const assetRe = /['"`]\/?((?:models|textures|audio)\/[\w .\-/]+\.(?:glb|gltf|png|jpg|jpeg|webp|wav|mp3|ogg))['"`]/g;
    let m;
    while ((m = assetRe.exec(c))) {
      if (!(await exists(path.join(ROOT, 'public', m[1])))) {
        const line = c.slice(0, m.index).split('\n').length;
        add('assets', `${key} -> ${m[1]}`, 1, [{ line, text: m[1] }]);
      }
    }
  }

  // dead modules + dead imports
  const reach = new Set();
  const stack = ENTRIES.map((e) => path.join(ROOT, e));
  while (stack.length) {
    const f = stack.pop();
    if (reach.has(f) || !code.has(f)) continue;
    reach.add(f);
    for (const imp of parseImports(code.get(f))) {
      const r = resolveSpec(f, imp.spec);
      if (r) stack.push(r);
    }
  }
  // scripts/ are entry points too (headless tools import src/ai, src/mechanics)
  for (const s of await walk(path.join(ROOT, 'scripts'))) {
    for (const imp of parseImports(stripComments(await readFile(s, 'utf8')))) {
      const r = resolveSpec(s, imp.spec);
      if (r && code.has(r)) { const st = [r]; while (st.length) { const f = st.pop(); if (reach.has(f)) continue; reach.add(f); for (const i2 of parseImports(code.get(f))) { const r2 = resolveSpec(f, i2.spec); if (r2 && code.has(r2)) st.push(r2); } } }
    }
  }
  for (const f of files) if (!reach.has(f)) add('dead-module', rel(f), 1, [{ line: 0, text: 'unreachable from src/main.js and scripts/' }]);

  for (const [f, c] of code) {
    for (const imp of parseImports(c)) {
      for (const name of imp.names) {
        const uses = c.match(new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g')) || [];
        if (uses.length <= 1) add('dead-import', `${rel(f)} :: ${name}`, 1, [{ line: 0, text: `from ${imp.spec}` }]);
      }
    }
  }

  // clips: every clip-name string in TUNING must exist in the character GLB
  try {
    const clips = new Set(await glbClipNames(path.join(ROOT, 'public', 'models', 'character.glb')));
    const { TUNING } = await import(path.join(SRC, 'config', 'tuning.js')).catch(() => ({}));
    if (TUNING) {
      const walkT = (o, p) => {
        for (const [k, v] of Object.entries(o)) {
          const here = p ? `${p}.${k}` : k;
          if (typeof v === 'string' && /clip/i.test(k) && v && !clips.has(v)) add('clips', `${here} = "${v}"`, 1, [{ line: 0, text: 'not in character.glb' }]);
          else if (v && typeof v === 'object' && !Array.isArray(v)) walkT(v, here);
          else if (Array.isArray(v) && /clip/i.test(k)) for (const x of v) if (typeof x === 'string' && !clips.has(x)) add('clips', `${here}[] = "${x}"`, 1, [{ line: 0, text: 'not in character.glb' }]);
        }
      };
      walkT(TUNING, '');
    }
  } catch (e) {
    add('clips', `(could not check: ${e.message.slice(0, 60)})`, 1);
  }

  for (const m of MONOLITHS) {
    const t = raw.get(path.join(ROOT, m));
    if (t) add('size', m, t.split('\n').length);
  }

  // ─── compare with the allow-list ───
  let allow = {};
  try { allow = JSON.parse(await readFile(ALLOW_FILE, 'utf8')); } catch { /* first run */ }

  const rules = ['clock', 'teleport', 'layering', 'tuning-write', 'dead-module', 'dead-import', 'assets', 'clips', 'size'];
  let failed = false;
  const summary = [];
  for (const rule of rules) {
    const now = found[rule] || {};
    const was = allow[rule] || {};
    const worse = [];
    const better = [];
    for (const [k, n] of Object.entries(now)) {
      const a = was[k] ?? 0;
      if (n > a) worse.push(`${k}: ${a} -> ${n}`);
      else if (n < a) better.push(`${k}: ${a} -> ${n}`);
    }
    for (const [k, a] of Object.entries(was)) if (!(k in now) && a > 0) better.push(`${k}: ${a} -> 0`);
    const total = Object.values(now).reduce((s, n) => s + n, 0);
    const status = worse.length ? 'FAIL' : better.length ? 'BETTER' : 'ok';
    if (worse.length) failed = true;
    summary.push({ rule, total, status, worse, better });
  }

  console.log('\nrule          total  status');
  for (const s of summary) {
    console.log(`${s.rule.padEnd(13)} ${String(s.total).padStart(5)}  ${s.status}`);
    for (const w of s.worse) console.log(`                 WORSE  ${w}`);
    for (const b of s.better) console.log(`                 better ${b}`);
  }
  if (process.argv.includes('--verbose')) {
    for (const rule of rules) {
      if (!detail[rule]?.length) continue;
      console.log(`\n[${rule}]`);
      for (const d of detail[rule]) console.log(`  ${d}`);
    }
  }

  if (update) {
    await mkdir(path.dirname(ALLOW_FILE), { recursive: true });
    const sorted = {};
    for (const rule of rules) sorted[rule] = Object.fromEntries(Object.entries(found[rule] || {}).sort());
    await writeFile(ALLOW_FILE, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`\nwrote ${rel(ALLOW_FILE)}`);
    return 0;
  }
  console.log(`\nAUDIT: ${failed ? 'FAIL' : 'PASS'}${failed ? '' : ' (no rule got worse)'}\n`);
  return failed ? 1 : 0;
}

main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e); process.exitCode = 1; });
