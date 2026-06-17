import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { appendPlanningAudit } from '@/planning/audit.js';

// Issue #184 — onboarded repos must be team-safe. The paqad entries now live in
// an explicit begin/end managed block that is reconciled in place on every
// run, so re-onboarding an already-onboarded repo picks up newly added ignore
// entries (the old writer bailed the moment it saw its marker and so could
// never ship new entries). A matching `.gitattributes` block makes the shared
// decision index auto-merge, and a one-time untrack removes any now-ignored
// path that an older onboarding committed to the index.

const GITIGNORE_BEGIN = '# >>> paqad-ai managed (do not edit between markers) >>>';
const GITIGNORE_END = '# <<< paqad-ai managed <<<';

/** Legacy single-line marker emitted by the pre-#184 writer. */
const LEGACY_MARKER = '# paqad-ai';

/**
 * Canonical ignore paths (issue #184, A2). Order matters only for readability;
 * the contract is the set of paths. Section-header comments are interleaved for
 * a tidy file. Anything here is per-machine runtime state, secrets, the
 * compliance ledger, or all module-health (rollup + evidence) — none of which
 * belongs in version control. Decision packets, contracts, and config stay
 * tracked and are deliberately absent.
 */
const MANAGED_GITIGNORE_ENTRIES = [
  '.paqad/framework-path.txt',
  '.paqad/.agent-entry-loaded',
  '.paqad/cache/',
  '.paqad/session/',
  '.paqad/context/',
  '.paqad/vectors/',
  '.paqad/secrets.env',
  '.paqad/workflows/',
  '.paqad/indexes/',
  '.paqad/pentest/',
  '.paqad/theme/',
  '.paqad/scripts/rules/.cache/',
  '.paqad/onboarding-checkpoint.json',
  '# per-machine runtime state (regenerated locally)',
  '.paqad/logs/',
  '.paqad/audit.log',
  '.paqad/decisions/audit.jsonl',
  '.paqad/decisions/events.jsonl',
  '.paqad/detection-report.json',
  '.paqad/stack-snapshot.json',
  '.paqad/stack-drift.json',
  '.paqad/doc-progress.json',
  '.paqad/quality-baseline.json',
  '.paqad/compiled-rules.json',
  '.paqad/module-health/',
  '.paqad/module-health-evidence/',
  '.paqad/module-health-consumed-events.json',
  '# compliance ledger (share via dashboard/SIEM, not git)',
  '.paqad/ledger/',
];

const GITATTRIBUTES_BEGIN = '# >>> paqad-ai managed >>>';
const GITATTRIBUTES_END = '# <<< paqad-ai managed <<<';

/**
 * Workstream C — the decision index is the one shared file two branches still
 * rewrite (each appends its resolved decisions). `merge=union` keeps both
 * sides' additions instead of raising a conflict. The index is pretty-printed
 * one key per line, which is what union merge needs.
 */
const MANAGED_GITATTRIBUTES_ENTRIES = ['.paqad/decisions/index.json merge=union'];

/**
 * Reconcile the paqad-managed block inside `existing`, returning the new file
 * contents. Idempotent: when the block already matches, the returned string
 * equals `existing`. Everything outside the markers is preserved untouched.
 */
function reconcileManagedBlock(
  existing: string,
  begin: string,
  end: string,
  entries: string[],
): string {
  const block = [begin, ...entries, end].join('\n');
  const beginIdx = existing.indexOf(begin);
  const endIdx = existing.indexOf(end);

  if (beginIdx !== -1 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + end.length);
    return ensureTrailingNewline(`${before}${block}${after}`);
  }

  // No managed block yet. Drop any legacy single-marker block first so we don't
  // leave stale duplicate entries behind, then append the managed block.
  const base = existing.includes(LEGACY_MARKER) ? stripLegacyBlock(existing, entries) : existing;
  const trimmed = base.replace(/\s+$/, '');
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : '';
  return `${prefix}${block}\n`;
}

/**
 * Remove the pre-#184 legacy region: the `# paqad-ai` marker line plus any
 * line that exactly matches one of the managed entries (every legacy path is a
 * `.paqad/**` path that the managed block re-adds, so removing exact matches
 * loses nothing). Comment lines among the entries are never used to match.
 */
function stripLegacyBlock(existing: string, entries: string[]): string {
  const managedPaths = new Set(entries.filter((entry) => !entry.startsWith('#')));
  return existing
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== LEGACY_MARKER && !managedPaths.has(trimmed);
    })
    .join('\n');
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

/**
 * Write/refresh the paqad-managed `.gitignore` block (issue #184, A1+A2), the
 * `.gitattributes` block (Workstream C), and untrack any now-ignored path an
 * earlier onboarding committed (A3). Each write is a no-op when nothing
 * changed, so re-onboarding stays clean.
 */
export function writeGitignore(projectRoot: string): void {
  reconcileFile(
    join(projectRoot, '.gitignore'),
    GITIGNORE_BEGIN,
    GITIGNORE_END,
    MANAGED_GITIGNORE_ENTRIES,
  );
  reconcileFile(
    join(projectRoot, '.gitattributes'),
    GITATTRIBUTES_BEGIN,
    GITATTRIBUTES_END,
    MANAGED_GITATTRIBUTES_ENTRIES,
  );
  untrackNowIgnoredPaths(projectRoot);
}

function reconcileFile(path: string, begin: string, end: string, entries: string[]): void {
  // Single read, catch ENOENT — never `existsSync(path) ? readFileSync(path)`.
  // The check-then-write pair is a TOCTOU file-system race (CWE-367,
  // CodeQL js/file-system-race): the file can change between the existence
  // check and the write. Mirrors writeMarkdownIfChanged in
  // decision-pause-contract-writer.ts.
  const existing = readTextOrEmpty(path);
  const next = reconcileManagedBlock(existing, begin, end, entries);
  if (next !== existing) {
    writeFileSync(path, next);
  }
}

/** Read a UTF-8 file, returning `''` when it does not exist (ENOENT). */
function readTextOrEmpty(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

/**
 * A3 — adding a path to `.gitignore` does not untrack files already in the
 * index. For repos onboarded before #184, untrack any now-ignored managed path
 * that is currently tracked. Safe when not in a git repo (skips silently),
 * never touches working-tree files (`--cached` only), idempotent (no-op once
 * nothing tracked matches), and leaves a single audit entry of what it did.
 */
function untrackNowIgnoredPaths(projectRoot: string): void {
  if (!isGitRepository(projectRoot)) {
    return;
  }

  const managedPaths = MANAGED_GITIGNORE_ENTRIES.filter((entry) => !entry.startsWith('#')).map(
    (entry) => entry.replace(/\/$/, ''),
  );

  const tracked = managedPaths.filter((path) => isTracked(projectRoot, path));
  if (tracked.length === 0) {
    return;
  }

  try {
    execFileSync('git', ['rm', '-r', '--cached', '--ignore-unmatch', ...tracked], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
  } catch {
    // Untrack is best-effort; a git failure here must not fail onboarding.
    return;
  }

  appendPlanningAudit(projectRoot, 'INFO', 'gitignore.untracked-now-ignored', {
    paths: tracked.join(','),
    count: tracked.length,
  });
}

function isGitRepository(projectRoot: string): boolean {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString().trim() === 'true';
  } catch {
    return false;
  }
}

function isTracked(projectRoot: string, path: string): boolean {
  try {
    const out = execFileSync('git', ['ls-files', '--', path], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString().trim().length > 0;
  } catch {
    return false;
  }
}
