// Rule-scripts integrity digest (buildout F5 — decision D1, audit).
//
// A cheap, hash-only fingerprint of the rule-script bindings' BLESSED state: the
// normalized map serialization plus the contents of every script the map
// references. The engine records this digest in the capability lock at apply time
// (the single-writer path); the enforcement seam recomputes it and compares, so a
// hand-edit that weakens a binding outside the engine is caught.
//
// Hash-only by design: it never executes a script (unlike the reconciler's
// fixture run), so it is safe to call on the per-edit enforcement hot path. The
// reconciler's RS-FIXTURE-FAIL still owns the heavier "a script no longer passes
// its own fixtures" check at planning time.
//
// The map is hashed via its NORMALIZED serialization (load + re-serialize), so a
// whitespace-only reformat does not read as tamper while any semantic change to a
// binding does.

import { createHash } from 'node:crypto';

import { loadRuleScriptMap, serializeRuleScriptMap } from './map.js';
import { scriptFilesHash } from './runner.js';

/**
 * The integrity digest of the project's rule-script bindings, or null when there
 * is no map (nothing bound → nothing to verify). Combines the normalized map
 * serialization with the canonical script-files hash.
 */
export function computeRuleScriptsDigest(projectRoot: string): string | null {
  const map = loadRuleScriptMap(projectRoot);
  if (!map) {
    return null;
  }
  const hash = createHash('sha256');
  hash.update(serializeRuleScriptMap(map));
  hash.update('\0');
  // scriptFilesHash already folds in each referenced script's content, sorted by
  // path (and marks an absent script), so a neutered or removed script changes it.
  hash.update(scriptFilesHash(projectRoot, map));
  return hash.digest('hex');
}
