import * as THREE from 'three';
import { BONE_MAP, resolveBoneByName } from './autorig.js';

/**
 * MODULE HEADER — src/sim/ghostClipPruner.js
 *
 * Role: Strips unused leaf/finger bone tracks from glTF AnimationClips bound to
 *   the invisible kinematic ghost skeleton (`pruneClipsForGhost`), leaving every
 *   BONE_MAP bone and all of its ancestors untouched.
 * Frame Phase: Boot / character spawn (`createAnimTarget`); never runs per tick.
 * Active Architectural Laws:
 *   - LAW L6 (Determinism): Pure structural filter over the bind skeleton hierarchy;
 *     every BONE_MAP bone's world matrix remains bit-for-bit identical.
 */

const _prunedCache = new WeakMap();

/**
 * Collects the raw and sanitized names of every BONE_MAP bone plus all of its
 * scene-graph ancestors so no parent transform influencing a tracked body is
 * ever dropped.
 *
 * @param {THREE.Skeleton} skeleton
 * @returns {Set<string>}
 */
function collectTrackedHierarchyNames(skeleton) {
  const kept = new Set();
  for (const entry of BONE_MAP) {
    const bone = resolveBoneByName(skeleton, entry.bone);
    for (let node = bone; node; node = node.parent) {
      if (node.name) {
        kept.add(node.name);
        kept.add(THREE.PropertyBinding.sanitizeNodeName(node.name));
      }
    }
  }
  return kept;
}

/**
 * Returns a cached array of lightweight AnimationClip views containing only
 * tracks targeting BONE_MAP bones and their ancestors (drops ~30 unused finger
 * and leaf-tip bones from 60 Hz ghost AnimationMixer evaluation).
 *
 * @param {THREE.AnimationClip[]} clips
 * @param {THREE.Skeleton} skeleton
 * @returns {THREE.AnimationClip[]}
 */
export function pruneClipsForGhost(clips, skeleton) {
  if (!Array.isArray(clips) || clips.length === 0 || !skeleton) return clips;
  const cached = _prunedCache.get(clips);
  if (cached) return cached;

  const keptNames = collectTrackedHierarchyNames(skeleton);
  if (keptNames.size === 0) return clips;

  const pruned = clips.map((clip) => {
    const keptTracks = [];
    for (let i = 0; i < clip.tracks.length; i++) {
      const track = clip.tracks[i];
      const dot = track.name.indexOf('.');
      const rawNode = dot === -1 ? track.name : track.name.slice(0, dot);
      const cleanNode = THREE.PropertyBinding.sanitizeNodeName(rawNode);
      if (keptNames.has(rawNode) || keptNames.has(cleanNode)) {
        keptTracks.push(track);
      }
    }
    if (keptTracks.length === clip.tracks.length || keptTracks.length === 0) {
      return clip;
    }
    return new THREE.AnimationClip(clip.name, clip.duration, keptTracks, clip.blendMode);
  });

  _prunedCache.set(clips, pruned);
  return pruned;
}
