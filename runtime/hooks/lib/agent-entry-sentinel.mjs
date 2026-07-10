// Shared sentinel-freshness logic for the paqad agent-entry gates — cross-platform
// Node port of the former agent-entry-sentinel.sh (issue #240).
//
// Imported by:
//   - runtime/hooks/agent-entry-gate.mjs        (PreToolUse — blocks edits)
//   - runtime/hooks/agent-entry-prompt-gate.mjs (UserPromptSubmit — gates every turn)
//
// Both gates must agree on what "the sentinel is fresh" means, so the logic lives
// here and the gates only own their respective enforcement. Importing this module
// runs nothing; callers invoke sentinelState() explicitly.
//
// The .sh original used `find -newer` / `-nt` (mtime comparison). This port uses
// statSync().mtimeMs with a strict `>` comparison, matching `-nt` semantics
// (equal mtimes are NOT "newer"), and short-circuits on the first newer file.

import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { resolveProjectRoot } from './paqad-disabled.mjs';

/** Relative path of the active agent entry file (CLAUDE.md, AGENTS.md, …). */
export function entryFile(env = process.env) {
  return env.PAQAD_ENTRY_FILE || 'CLAUDE.md';
}

/** Absolute path to the per-session sentinel. */
export function sentinelPath(projectRoot) {
  return join(projectRoot, '.paqad', '.agent-entry-loaded');
}

/**
 * Echoes one of:
 *   "missing"
 *   "stale:<entry-file|framework-path|docs-instructions>"
 *   "fresh"
 * and DELETES the sentinel when stale, so the next gate run re-blocks until the
 * agent reloads. Mirrors agent-entry-sentinel.sh exactly.
 */
export function sentinelState(projectRoot = resolveProjectRoot(), env = process.env) {
  const sentinel = sentinelPath(projectRoot);
  let sentinelMtime;
  try {
    sentinelMtime = statSync(sentinel).mtimeMs;
  } catch {
    return 'missing';
  }

  const newer = (relative) => {
    try {
      return statSync(join(projectRoot, relative)).mtimeMs > sentinelMtime;
    } catch {
      return false;
    }
  };

  if (newer(entryFile(env))) {
    rmSync(sentinel, { force: true });
    return 'stale:entry-file';
  }
  if (newer('.paqad/framework-path.txt')) {
    rmSync(sentinel, { force: true });
    return 'stale:framework-path';
  }
  if (anyFileNewer(join(projectRoot, 'docs', 'instructions'), sentinelMtime)) {
    rmSync(sentinel, { force: true });
    return 'stale:docs-instructions';
  }
  return 'fresh';
}

/** True when any file under `dir` (recursively) has an mtime strictly newer than
 *  `mtime`. Short-circuits on the first hit; an absent dir is not newer. */
function anyFileNewer(dir, mtime) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (anyFileNewer(full, mtime)) {
        return true;
      }
    } else {
      try {
        if (statSync(full).mtimeMs > mtime) {
          return true;
        }
      } catch {
        // Unreadable entry — ignore, it cannot prove staleness.
      }
    }
  }
  return false;
}
