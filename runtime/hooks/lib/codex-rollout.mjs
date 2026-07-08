// codex-rollout.mjs — locate the Codex CLI rollout transcript for a finished run.
//
// Codex Desktop's `Stop` payload carries no readable `transcript_path`, and its
// `paqad:stage` markers live in MID-RUN assistant messages — the inline
// `last_assistant_message` the payload carries is the final summary only, which
// never holds them. So the record-only completion hook (verification-record.mjs)
// would scan a marker-less string and silently record a well-behaved Codex run as
// "no stages / blocked" (issue #313, finding 1; same class as #265's Gemini gap).
//
// This reads the session's own rollout jsonl off disk so the real markers reach
// the parser. Codex writes every session as
// `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` (override the root with
// `CODEX_HOME`). All functions are best-effort and NEVER throw — a missing tree,
// an unreadable subdir, or a racing deletion simply yields '' / [].

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAX_DEPTH = 6;

/**
 * Resolve the Codex sessions root: `$CODEX_HOME/sessions` when `CODEX_HOME` is
 * set and non-blank, else `~/.codex/sessions`.
 */
export function codexSessionsDir() {
  const home =
    typeof process.env.CODEX_HOME === 'string' && process.env.CODEX_HOME.trim() !== ''
      ? process.env.CODEX_HOME.trim()
      : join(homedir(), '.codex');
  return join(home, 'sessions');
}

/**
 * Walk the Codex sessions tree (dated `YYYY/MM/DD` subdirs) and collect every
 * `rollout-*.jsonl` file with its path, basename and mtime. Depth-guarded and
 * error-tolerant so an unreadable subdir can never throw.
 */
export function collectRolloutFiles(root, depth = 0) {
  if (depth > MAX_DEPTH) return [];
  const found = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectRolloutFiles(full, depth + 1));
    } else if (
      entry.isFile() &&
      entry.name.startsWith('rollout-') &&
      entry.name.endsWith('.jsonl')
    ) {
      try {
        found.push({ path: full, name: entry.name, mtimeMs: statSync(full).mtimeMs });
      } catch {
        // Racing deletion / permission flip — skip this entry.
      }
    }
  }
  return found;
}

/**
 * Best-effort read of the Codex rollout transcript for this run. Prefers the
 * rollout whose filename carries `sessionId`; otherwise the most recently
 * modified rollout (the run that just ended). Returns the raw jsonl text for the
 * marker parser's line scan, or '' on any absence/error.
 */
export function resolveCodexRolloutText(sessionId) {
  try {
    const sessionsDir = codexSessionsDir();
    if (!existsSync(sessionsDir)) return '';
    const rollouts = collectRolloutFiles(sessionsDir);
    if (rollouts.length === 0) return '';
    let chosen;
    if (typeof sessionId === 'string' && sessionId.trim() !== '') {
      chosen = rollouts.find((file) => file.name.includes(sessionId.trim()));
    }
    if (!chosen) {
      chosen = rollouts.reduce((newest, file) => (file.mtimeMs > newest.mtimeMs ? file : newest));
    }
    return readFileSync(chosen.path, 'utf8');
  } catch {
    return '';
  }
}
