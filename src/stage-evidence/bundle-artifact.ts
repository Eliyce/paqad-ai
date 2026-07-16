// Rigid-bundle-artifact boundary check (issue #394).
//
// A thinking stage proves its work with a file the recorder hashes (issue #320). But
// `planning` and `specification` own a RIGID, script-written bundle file — `plan.json`
// (via `paqad-ai plan compile`) and `specification.json` (via `paqad-ai spec freeze`) —
// and nothing else is their artifact. Before #394 the artifact-path validator accepted
// ANY in-tree file (artifact-path.ts judges tree LOCATION only), so a hand-written
// `.paqad/features/<slug>/plan.md` cleared the gate and the bundle's real plan.json /
// specification.json were never produced (the incident).
//
// This is the boundary partition both stage-end callers (the `stage end` CLI and the
// chat-marker parser) run AFTER `normalizeArtifactPath`: for a rigid stage the ONLY
// accepted artifact is the active bundle's rigid file; any other path is rejected, so
// the recorder hashes no digest and the stage folds inconclusive — the model must run
// `plan compile` / `spec freeze`. Every non-rigid stage (`review` and the mutation
// stages) passes through unchanged: review owns no rigid bundle file, and a mutation
// stage's proof is the observed edit, not an artifact.

import { featureFilePath, type FeatureBundleFile } from '@/feature-evidence/paths.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';

/**
 * The rigid bundle file a thinking stage must prove itself with, or `null` when the
 * stage owns no rigid artifact (`review`, and every mutation stage). Keyed off the
 * stage id so the recorder registry stays the single source of stage names.
 */
export function bundleArtifactFile(stage: string): FeatureBundleFile | null {
  if (stage === 'planning') return 'plan';
  if (stage === 'specification') return 'specification';
  return null;
}

/** The compile/freeze verb that writes a rigid stage's bundle artifact. */
export function bundleArtifactVerb(file: FeatureBundleFile): string {
  return file === 'plan' ? 'paqad-ai plan compile' : 'paqad-ai spec freeze';
}

export interface BundleArtifactCheck {
  /** Whether the stage owns a rigid bundle file (planning/specification). */
  rigid: boolean;
  /** The active bundle's expected rigid path, or `null` (no active feature / not rigid). */
  expected: string | null;
  /** Input paths that ARE the expected bundle file (the only ones a rigid stage keeps). */
  accepted: string[];
  /** Input paths rejected for a rigid stage (not the bundle file). */
  rejected: string[];
  /** The verb to name in a message when a rigid stage kept nothing, else `null`. */
  verb: string | null;
}

/**
 * Partition already-normalized (project-relative posix) artifact paths for a stage-end
 * against the active feature bundle's rigid file. For `planning` / `specification` the
 * only accepted artifact is the bundle's `plan.json` / `specification.json`; every other
 * path is rejected so the recorder writes no digest and the stage folds inconclusive
 * (issue #394). For every non-rigid stage the paths pass through unchanged.
 *
 * When no feature is active (a stage-end with nothing open), a rigid stage's `expected`
 * is `null` and all paths are rejected — you cannot prove planning/specification without
 * a bundle to write into.
 */
export function checkBundleArtifacts(
  projectRoot: string,
  sessionId: string,
  stage: string,
  normalizedPaths: readonly string[],
): BundleArtifactCheck {
  const file = bundleArtifactFile(stage);
  if (!file) {
    return {
      rigid: false,
      expected: null,
      accepted: [...normalizedPaths],
      rejected: [],
      verb: null,
    };
  }
  const dirName = currentFeature(projectRoot, sessionId);
  const expected = dirName ? featureFilePath(dirName, file) : null;
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const path of normalizedPaths) {
    if (expected !== null && path === expected) {
      accepted.push(path);
    } else {
      rejected.push(path);
    }
  }
  return { rigid: true, expected, accepted, rejected, verb: bundleArtifactVerb(file) };
}
