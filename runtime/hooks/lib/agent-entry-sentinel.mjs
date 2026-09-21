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
//
// Per-agent keying (issue #567). Under stage isolation each mandatory stage runs in its own
// host subagent that shares the ORCHESTRATOR's `session_id` — the Claude Code hooks docs
// confirm a subagent's PreToolUse payload carries the parent `session_id` and is distinguished
// only by a per-call `agent_id`. A single shared `.agent-entry-loaded` would therefore let a
// stage subagent inherit the orchestrator's fresh sentinel and skip its own cold framework
// load. So when a hook fires inside a subagent (an `agent_id` is present), the sentinel is
// keyed on that `agent_id` under `.paqad/session/agent-entry/`; on the main thread (no
// `agent_id`) the unkeyed path is used and behaviour is byte-identical to before.

import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveProjectRoot } from './paqad-disabled.mjs';

/** Relative path of the active agent entry file (CLAUDE.md, AGENTS.md, …). */
export function entryFile(env = process.env) {
  return env.PAQAD_ENTRY_FILE || 'CLAUDE.md';
}

/** Absolute path to the main-thread sentinel. */
export function sentinelPath(projectRoot) {
  return join(projectRoot, '.paqad', '.agent-entry-loaded');
}

/** The directory holding per-agent entry markers (issue #567). */
export function agentEntryMarkerDir(projectRoot) {
  return join(projectRoot, '.paqad', 'session', 'agent-entry');
}

/**
 * The per-agent entry marker path for a subagent `agentId`, or `null` when there is no usable
 * id (main thread, or an empty/space id) — in which case the caller uses the unkeyed sentinel.
 * The id is sanitized to a safe filename so a hostile/odd id can never escape the marker dir.
 */
export function agentEntryMarkerPath(projectRoot, agentId) {
  const safe = typeof agentId === 'string' ? agentId.trim().replace(/[^A-Za-z0-9_-]/g, '_') : '';
  if (safe.length === 0) {
    return null;
  }
  return join(agentEntryMarkerDir(projectRoot), safe);
}

/**
 * Stamp a subagent's per-agent entry marker (issue #567) — the gate calls this when it exempts
 * the bootstrap sentinel Write inside a subagent, so the same bootstrap the agent always runs
 * (write `.paqad/.agent-entry-loaded`) doubles as this agent's keyed load-confirmation without
 * the agent needing to know its own `agent_id`. Best-effort: never throws into the hook.
 */
export function stampAgentEntryMarker(projectRoot, agentId) {
  const marker = agentEntryMarkerPath(projectRoot, agentId);
  if (!marker) {
    return;
  }
  try {
    mkdirSync(agentEntryMarkerDir(projectRoot), { recursive: true });
    writeFileSync(marker, `${JSON.stringify({ loaded_at: new Date().toISOString(), agentId })}\n`);
  } catch {
    // best-effort; a failed stamp just re-blocks the agent, which is fail-safe.
  }
}

/**
 * Clear every per-agent entry marker (issue #567). Called from SessionStart so a new main
 * session starts every identity ungated, exactly as it resets the base sentinel. Best-effort.
 */
export function clearAgentEntryMarkers(projectRoot) {
  try {
    rmSync(agentEntryMarkerDir(projectRoot), { recursive: true, force: true });
  } catch {
    // best-effort; never fail a session start over marker cleanup.
  }
}

/**
 * Echoes one of:
 *   "missing"
 *   "stale:<entry-file|framework-path|docs-instructions>"
 *   "fresh"
 * and DELETES the sentinel when stale, so the next gate run re-blocks until the
 * agent reloads. Mirrors agent-entry-sentinel.sh exactly.
 *
 * `agentId` (issue #567) keys the check on a subagent's per-agent marker; omitted/empty means
 * the main thread and the unkeyed sentinel, byte-identical to before.
 */
export function sentinelState(projectRoot = resolveProjectRoot(), env = process.env, agentId) {
  const sentinel = agentEntryMarkerPath(projectRoot, agentId) ?? sentinelPath(projectRoot);
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
