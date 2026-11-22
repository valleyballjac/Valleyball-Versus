/**
 * ============================================================================
 * MODULE: src/debug/clipInventory.js
 * ============================================================================
 * ROLE:
 *   Startup diagnostic table listing every animation clip present in
 *   `character.glb` and which `TUNING` fields reference it, warning loudly
 *   when `TUNING` names a clip that does not exist in the asset set.
 * ============================================================================
 */

import { TUNING } from '../config/tuning.js';

export function tuningClipFields() {
  const fields = new Map();
  const add = (path, value) => {
    if (typeof value !== 'string' || value === '') return;
    const key = value.toLowerCase();
    const entry = fields.get(key);
    if (entry) entry.paths.push(path);
    else fields.set(key, { name: value, paths: [path] });
  };

  add('anim.blend.idleClip', TUNING.anim.blend.idleClip);

  for (const [key, value] of Object.entries(TUNING.blend2d)) {
    if (typeof value === 'string') {
      add(`blend2d.${key}`, value);
    } else if (value && typeof value === 'object') {
      for (const [dir, name] of Object.entries(value)) add(`blend2d.${key}.${dir}`, name);
    }
  }

  for (const group of ['jump', 'standUp', 'action']) {
    for (const [key, value] of Object.entries(TUNING[group])) {
      if (key.endsWith('Clip')) add(`${group}.${key}`, value);
    }
  }

  return fields;
}

export function logClipInventory(characterClips = []) {
  const fields = tuningClipFields();
  const rows = characterClips.map((clip) => ({
    name: clip.name,
    duration: clip.duration,
    tracks: clip.tracks.length,
    referencedBy: (fields.get(clip.name.toLowerCase()) || { paths: [] }).paths,
  }));

  const width = Math.max(4, ...rows.map((row) => row.name.length));
  console.log(
    `[clips] ${'clip'.padEnd(width)}  ${'dur (s)'.padStart(7)}  ${'tracks'.padStart(6)}  referenced by`,
  );
  for (const row of rows) {
    console.log(
      `[clips] ${row.name.padEnd(width)}  ${row.duration.toFixed(3).padStart(7)}  ` +
        `${String(row.tracks).padStart(6)}  ${row.referencedBy.join(', ') || '—'}`,
    );
  }

  const referenced = rows.filter((row) => row.referencedBy.length).length;
  console.log(
    `[clips] ${rows.length} clips in the asset set: ${referenced} referenced by a TUNING ` +
      `clip-name field, ${rows.length - referenced} unreferenced (not an error).`,
  );

  const present = new Set(rows.map((row) => row.name.toLowerCase()));
  for (const [key, entry] of fields) {
    if (present.has(key)) continue;
    console.warn(
      `[clips] TUNING names "${entry.name}" at ${entry.paths.join(', ')} and the asset set ` +
        `has no such clip. That field falls back rather than throwing, so it is silent at runtime.`,
    );
  }
}
