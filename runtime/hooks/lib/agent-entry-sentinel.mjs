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
//
// Per-session keying (issue #582). Two host sessions in one checkout used to share the one
// `.paqad/.agent-entry-loaded` file, so a SessionStart in session B deleted the sentinel that
// session A had just written, and A's next edit was blocked. When the hook payload carries a
// `session_id`, the main-thread sentinel now lives at `.paqad/.agent-entry-loaded.d/<id>`
// (sanitized like an agent id), and SessionStart removes only its own file. The single legacy
// file is used only when the payload has no session id.

import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveProjectRoot } from './paqad-disabled.mjs';

/** Relative path of the active agent entry file (CLAUDE.md, AGENTS.md, …). */
export function entryFile(env = process.env) {
  return env.PAQAD_ENTRY_FILE || 'CLAUDE.md';
}

/**
 * The main-thread sentinel as a project-relative POSIX path (issue #582):
 * `.paqad/.agent-entry-loaded.d/<sanitized session id>` when a usable `sessionId` is given,
 * else the legacy `.paqad/.agent-entry-loaded`. The gates print this so the agent writes the
 * exact file its own session is checked against.
 */
export function sentinelRelative(sessionId) {
  const safe = safeFileKey(sessionId);
  return safe.length === 0 ? '.paqad/.agent-entry-loaded' : `.paqad/.agent-entry-loaded.d/${safe}`;
}

/** Absolute path to the main-thread sentinel for `sessionId` (see `sentinelRelative`). */
export function sentinelPath(projectRoot, sessionId) {
  return join(projectRoot, ...sentinelRelative(sessionId).split('/'));
}

/** The directory holding per-agent entry markers (issue #567). */
export function agentEntryMarkerDir(projectRoot) {
  return join(projectRoot, '.paqad', 'session', 'agent-entry');
}

/**
 * The sanitized, safe filename for a subagent `agentId` or a host `sessionId`, or `''` when
 * there is no usable id. Anything outside `[A-Za-z0-9_-]` becomes `_`, so an odd id can never
 * escape its directory and never carries a character Windows forbids in a filename.
 */
function safeFileKey(id) {
  return typeof id === 'string' ? id.trim().replace(/[^A-Za-z0-9_-]/g, '_') : '';
}

/**
 * The per-agent entry marker path for a subagent `agentId`, or `null` when there is no usable
 * id (main thread, or an empty/space id) — in which case the caller uses the unkeyed sentinel.
 * The id is sanitized to a safe filename so a hostile/odd id can never escape the marker dir.
 */
export function agentEntryMarkerPath(projectRoot, agentId) {
  const safe = safeFileKey(agentId);
  if (safe.length === 0) {
    return null;
  }
  return join(agentEntryMarkerDir(projectRoot), safe);
}

/**
 * The per-agent marker as a project-relative POSIX path (e.g. `.paqad/session/agent-entry/x`),
 * or `null` for the main thread. The PreToolUse gate names this in its block message so a stage
 * subagent knows the exact file that clears its own gate (issue #567) — the agent cannot read
 * its own `agent_id`, but the gate can, so the gate tells it.
 */
export function agentEntryMarkerRelative(agentId) {
  const safe = safeFileKey(agentId);
  return safe.length === 0 ? null : `.paqad/session/agent-entry/${safe}`;
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
 * Stamp the per-session sentinel for `sessionId` (issue #582). The edit gate calls this when it
 * exempts a main-thread Write of the legacy `.paqad/.agent-entry-loaded`, so an agent that
 * follows older wording still clears its own session's gate. Best-effort: never throws.
 */
export function stampSessionSentinel(projectRoot, sessionId, entry) {
  if (safeFileKey(sessionId).length === 0) {
    return;
  }
  const target = sentinelPath(projectRoot, sessionId);
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      `${JSON.stringify({ loaded_at: new Date().toISOString(), entry_file: entry })}\n`,
    );
  } catch {
    // best-effort; a failed stamp just re-blocks the edit, which is fail-safe.
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
 * the main thread. `sessionId` (issue #582) then keys the main-thread check on that session's
 * own file; the legacy single file is checked only when there is no usable session id. The
 * stale deletion removes whichever file was checked.
 */
export function sentinelState(
  projectRoot = resolveProjectRoot(),
  env = process.env,
  agentId,
  sessionId,
) {
  const sentinel =
    agentEntryMarkerPath(projectRoot, agentId) ?? sentinelPath(projectRoot, sessionId);
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
