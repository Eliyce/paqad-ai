// Session-start dirty-file baseline (issue #576, Finding 1b).
//
// The in-session completion backstop takes its changed-file set from a whole-tree `git status`
// (change-evidence.ts). Before this baseline existed there was no record of what was ALREADY
// dirty when the session started, so a pre-existing modified tracked file — a JetBrains-written
// config, a half-finished edit from before the session, a teammate's stash — was attributed to
// the current turn and could fail a read-only session at Stop.
//
// This module records, once at session start, a digest of every file git then reports as changed,
// under the git-ignored session ledger dir. At `hook-completion` origin the backstop subtracts any
// file whose digest is UNCHANGED since that baseline: it was dirt the session inherited, not work
// the agent did. A file the agent edits has a different digest and still counts, so a genuine
// feature-development change is never hidden (INV-2 / NFR-3). commit / push / CI origins are
// path-based and never consult the baseline.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveSessionId } from '@/rag-ledger/session.js';
import { sessionLedgerDir } from '@/session-ledger/ledger.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';

import { readGitStatusFiles } from './change-evidence.js';

const BASELINE_FILE = '.dirty-baseline.json';

/** A session-start snapshot: the content digest of every file that was already dirty. */
export interface DirtyBaseline {
  captured_at: string;
  /** Project-relative posix path → sha256 of the file's bytes at session start. */
  files: Record<string, string>;
}

/** The git-ignored baseline path for a session, under its stage-evidence ledger dir. */
function baselinePath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, sessionId), BASELINE_FILE);
}

/** sha256 of a file's bytes, or `null` when it cannot be read (e.g. a deleted path). */
function digestFile(projectRoot: string, relativePath: string): string | null {
  try {
    return createHash('sha256')
      .update(readFileSync(join(projectRoot, relativePath)))
      .digest('hex');
  } catch {
    return null;
  }
}

/**
 * Capture the session-start dirty-file baseline, keyed by the resolved session id. Idempotent:
 * writes ONCE per session (a later call is a no-op), so the snapshot reflects the tree as it was
 * BEFORE the agent ran, not after. Best-effort — every fault is swallowed, since a missing baseline
 * simply means no subtraction (today's behaviour).
 *
 * The write is atomic-exclusive (`flag: 'wx'`) rather than a `existsSync`-then-write guard: the
 * check-then-use pattern is a filesystem race (CodeQL js/file-system-race). With `wx`, a second
 * capture in the same session throws EEXIST and is swallowed, giving the same once-per-session
 * result without the race.
 */
export async function captureSessionDirtyBaseline(
  projectRoot: string,
  sessionHint: string | null,
): Promise<void> {
  const sessionId = resolveSessionId(projectRoot, sessionHint);
  const path = baselinePath(projectRoot, sessionId);
  const dirty = await readGitStatusFiles(projectRoot);
  const files: Record<string, string> = {};
  for (const relativePath of dirty) {
    const digest = digestFile(projectRoot, relativePath);
    if (digest !== null) {
      files[relativePath] = digest;
    }
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({ captured_at: new Date().toISOString(), files }, null, 2)}\n`,
      { flag: 'wx' },
    );
  } catch {
    // best-effort — EEXIST (already captured this session) or any write fault is a no-op.
  }
}

/** Read the session's dirty-file baseline, or `null` when none was captured / it is unreadable. */
export function readSessionDirtyBaseline(
  projectRoot: string,
  sessionHint: string | null,
): DirtyBaseline | null {
  const sessionId = resolveSessionId(projectRoot, sessionHint);
  try {
    const parsed = JSON.parse(
      readFileSync(baselinePath(projectRoot, sessionId), 'utf8'),
    ) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as DirtyBaseline).files === 'object' &&
      (parsed as DirtyBaseline).files !== null
    ) {
      return parsed as DirtyBaseline;
    }
  } catch {
    // absent or malformed → no baseline.
  }
  return null;
}

/**
 * Drop from `files` every path that was already dirty at session start AND is byte-for-byte
 * unchanged since (same digest). A path the agent modified has a different digest and is KEPT; a
 * path not in the baseline is KEPT; an unreadable path is KEPT (fail-safe). With no baseline the
 * list is returned unchanged.
 */
export function subtractUnchangedBaselineFiles(
  projectRoot: string,
  sessionHint: string | null,
  files: readonly string[],
): string[] {
  const baseline = readSessionDirtyBaseline(projectRoot, sessionHint);
  if (baseline === null) {
    return [...files];
  }
  return files.filter((relativePath) => {
    const baselineDigest = baseline.files[relativePath];
    if (baselineDigest === undefined) {
      return true; // not pre-existing dirt → keep
    }
    const currentDigest = digestFile(projectRoot, relativePath);
    if (currentDigest === null) {
      return true; // unreadable now → keep (never hide a change we cannot confirm is inherited)
    }
    return currentDigest !== baselineDigest; // changed since baseline → keep; unchanged → subtract
  });
}
