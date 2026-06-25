import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { appendPlanningAudit } from '@/planning/audit.js';

// Issue #184 + follow-up — onboarded repos manage their git hygiene *inside*
// `.paqad/` rather than by editing the project's root `.gitignore`. paqad owns
// `.paqad/.gitignore` and `.paqad/.gitattributes` (git reads nested ignore /
// attributes files, applying their patterns relative to their own directory),
// so we never touch a file the project owns. Re-onboarding also scrubs the old
// paqad-managed block (and any pre-#184 `# paqad-ai` block) out of the project
// root `.gitignore`, migrating already-onboarded repos off the old layout.
//
// Decisions baked into the entry set:
//   - `framework-path.txt` is intentionally NOT ignored. It is the boot pointer
//     the agent-entry contract reads first; it is portable and stays committed
//     so a teammate who clones can boot without re-onboarding.
//   - `framework-version.txt` IS ignored. It is per-machine version state that
//     the silent-update hook rewrites every session; keeping it committed
//     churned the tree on every version bump.
//   - `ledger/` is ignored UNCONDITIONALLY (no longer gated on the enterprise
//     policy). Whether or not the ledger is written, it must never be able to
//     leak into git. The token-saving "don't write it unless enterprise" gate
//     lives at the verification write-site, not here.

const MANAGED_BEGIN = '# >>> paqad-ai managed (do not edit between markers) >>>';
const MANAGED_END = '# <<< paqad-ai managed <<<';

const GITATTRIBUTES_BEGIN = '# >>> paqad-ai managed >>>';
const GITATTRIBUTES_END = '# <<< paqad-ai managed <<<';

/** Legacy single-line marker emitted by the pre-#184 root-file writer. */
const LEGACY_MARKER = '# paqad-ai';

/**
 * Canonical ignore entries, written into `.paqad/.gitignore`. Patterns are
 * relative to the `.paqad/` directory because that is where the nested ignore
 * file lives. Section-header comments are interleaved for readability; the
 * contract is the set of non-comment paths.
 */
const MANAGED_GITIGNORE_ENTRIES = [
  '.agent-entry-loaded',
  'framework-version.txt',
  'cache/',
  'session/',
  'context/',
  'vectors/',
  'secrets.env',
  'workflows/',
  'indexes/',
  'pentest/',
  'theme/',
  'scripts/rules/.cache/',
  'scripts/rules/.history/',
  'onboarding-checkpoint.json',
  // Laravel-style framework config. `.config` is the dev-local override file (may
  // hold secrets like RAG api keys) — git-ignored. The tracked team surface
  // (`configs/.config.*`) and the `configs/README` have different path components,
  // so this pattern never touches them.
  '.config',
  '# per-machine runtime state (regenerated locally)',
  'logs/',
  'audit.log',
  'decisions/audit.jsonl',
  'decisions/events.jsonl',
  'detection-report.json',
  'stack-snapshot.json',
  'stack-drift.json',
  'doc-progress.json',
  'quality-baseline.json',
  'compiled-rules.json',
  'module-health/',
  'module-health-evidence/',
  'module-health-consumed-events.json',
  // Per-machine runtime state created on first use of a later workflow (not at
  // onboard). Each is regenerated locally or is a per-machine append-only log,
  // so committing it churns the tree the moment that workflow runs. Kept
  // unconditional (lesson from #187: a conditional ignore leaks).
  'patterns/', // regenerable pattern embeddings (mirror of vectors/)
  'crs/', // regenerable contextual-retrieval-store collections
  'attachments/', // ephemeral desktop-session attachment collections
  'attachment-events.jsonl', // per-machine attachment-index event log
  'traceability/', // rebuilt from reality each run
  'module-map/drift.json', // regenerable module-map drift snapshot
  'module-map/events.jsonl', // per-machine module-map audit log
  'schema-migrations.jsonl', // per-machine schema-migration audit log
  'skills/', // per-machine skill/pack failed-load event log
  'delivery-detection.json', // regenerated from git history per machine
  '# compliance ledger (share via dashboard/SIEM, not git)',
  'ledger/',
];

/**
 * Workstream C (issue #184) — the decision index is the one shared file two
 * branches still rewrite. `merge=union` keeps both sides' additions instead of
 * raising a conflict. The path is relative to `.paqad/` (nested attributes
 * file), and the index is pretty-printed one key per line, which is what union
 * merge needs.
 */
const MANAGED_GITATTRIBUTES_ENTRIES = ['decisions/index.json merge=union'];

/**
 * Framework artifacts the engine no longer creates. On re-onboard we untrack any
 * copy an earlier onboarding committed (`--cached`, working tree preserved) AND
 * remove the orphaned working-tree file, so a repo onboarded before this change
 * does not carry a stale, never-read file indefinitely. Each is a pure
 * framework artifact (no user-authored content), project-root-relative.
 *
 *   - `.paqad/version` — the PQD-424 plain-text schema stamp; zero readers, made
 *     redundant by `.paqad/schema-version.json` (the real migration marker).
 *   - `.paqad/classifier-config.json` — static, never read (the live router uses
 *     the compiled-in WORKFLOW_PATTERNS const); it had already silently drifted.
 *   - `.paqad/next-steps.md` — a one-time onboarding nudge with zero readers; the
 *     same guidance is printed to the terminal at the end of onboarding.
 *   - `.paqad/hooks/silent-update.sh` — the auto-update hook is no longer copied
 *     into the project; it runs from the framework install as a cross-platform
 *     `.mjs`. The per-project copy was never executed (the host wires the global
 *     one), so removing it is safe.
 */
const DEPRECATED_ARTIFACTS = [
  '.paqad/version',
  '.paqad/classifier-config.json',
  '.paqad/next-steps.md',
  '.paqad/hooks/silent-update.sh',
];

/**
 * Full-from-project-root paths the managed block ignores, used to (a) untrack
 * any now-ignored path an earlier onboarding committed and (b) scrub a legacy
 * `# paqad-ai` block out of the root `.gitignore`. `framework-path.txt` is added
 * to the scrub set (not the untrack set) so a legacy root entry for it is
 * cleaned even though it is no longer ignored.
 */
function ignoredPathsFromRoot(): string[] {
  return MANAGED_GITIGNORE_ENTRIES.filter((entry) => !entry.startsWith('#')).map(
    (entry) => `.paqad/${entry}`,
  );
}

/**
 * Write/refresh paqad's nested `.gitignore` + `.gitattributes` (the managed
 * policy now lives under `.paqad/`), scrub the old paqad-managed block out of
 * the project root `.gitignore` / `.gitattributes` (migration), and untrack any
 * now-ignored path an earlier onboarding committed. Each write is a no-op when
 * nothing changed, so re-onboarding stays clean.
 */
export function writeGitignore(projectRoot: string): void {
  // 1. paqad's own files under `.paqad/`.
  reconcileFile(
    join(projectRoot, '.paqad', '.gitignore'),
    MANAGED_BEGIN,
    MANAGED_END,
    MANAGED_GITIGNORE_ENTRIES,
  );
  reconcileFile(
    join(projectRoot, '.paqad', '.gitattributes'),
    GITATTRIBUTES_BEGIN,
    GITATTRIBUTES_END,
    MANAGED_GITATTRIBUTES_ENTRIES,
  );

  // 2. Migrate off the old root-file layout: remove paqad's managed block (and
  //    any pre-#184 legacy block) from the project root, preserving the rest.
  scrubRootFile(join(projectRoot, '.gitignore'), MANAGED_BEGIN, MANAGED_END, true);
  scrubRootFile(join(projectRoot, '.gitattributes'), GITATTRIBUTES_BEGIN, GITATTRIBUTES_END, false);

  // 3. Untrack any now-ignored path an earlier onboarding committed.
  untrackNowIgnoredPaths(projectRoot, ignoredPathsFromRoot());

  // 4. Remove framework artifacts the engine no longer creates (untrack the
  //    committed copy and unlink the orphaned working-tree file).
  removeDeprecatedArtifacts(projectRoot, DEPRECATED_ARTIFACTS);
}

/**
 * Clean up framework artifacts that are no longer generated. For each path:
 * untrack it when an earlier onboarding committed it (`--cached`, never deleting
 * a working-tree file via git), then unlink the orphaned working-tree copy.
 * Safe when not in a git repo, idempotent (no-op once nothing remains), and
 * leaves a single audit entry listing what was removed. Best-effort: a git or
 * unlink failure must never fail onboarding.
 */
function removeDeprecatedArtifacts(projectRoot: string, paths: string[]): void {
  if (isGitRepository(projectRoot)) {
    const tracked = listTrackedPaths(projectRoot, paths);
    if (tracked.length > 0) {
      try {
        execFileSync('git', ['rm', '-r', '--cached', '--ignore-unmatch', ...tracked], {
          cwd: projectRoot,
          stdio: 'ignore',
        });
      } catch {
        // Untrack is best-effort; a git failure must not fail onboarding.
      }
    }
  }

  const removed = paths.filter((path) => unlinkIfPresent(join(projectRoot, path)));
  if (removed.length > 0) {
    appendPlanningAudit(projectRoot, 'INFO', 'gitignore.removed-deprecated-artifacts', {
      paths: removed.join(','),
      count: removed.length,
    });
  }
}

/**
 * Unlink a file, returning whether it existed. ENOENT (already gone) is the
 * normal idempotent case; any other error is swallowed (best-effort). Uses a
 * try/unlink rather than existsSync-then-unlink to avoid a TOCTOU race
 * (CWE-367, CodeQL js/file-system-race).
 */
function unlinkIfPresent(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reconcile the paqad-managed block inside a paqad-owned file, creating it (and
 * its parent directory) when absent. Idempotent: when the block already
 * matches, the file is left byte-identical. Content outside the markers is
 * preserved untouched.
 */
function reconcileFile(path: string, begin: string, end: string, entries: string[]): void {
  // Single read, catch ENOENT — never `existsSync(path) ? readFileSync(path)`.
  // The check-then-write pair is a TOCTOU file-system race (CWE-367,
  // CodeQL js/file-system-race).
  const existing = readTextOrEmpty(path);
  const next = reconcileManagedBlock(existing, begin, end, entries);
  if (next !== existing) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next);
  }
}

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

  const trimmed = existing.replace(/\s+$/, '');
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : '';
  return `${prefix}${block}\n`;
}

/**
 * Remove the paqad-managed block — and, when `scrubLegacy`, a pre-#184
 * `# paqad-ai` block — from a project-owned root file, preserving everything
 * outside paqad's own region. A no-op when the file does not exist or carries
 * nothing of paqad's (so we never dirty a file needlessly).
 */
function scrubRootFile(path: string, begin: string, end: string, scrubLegacy: boolean): void {
  const existing = readTextOrEmpty(path);
  if (existing === '') {
    return;
  }

  let next = removeManagedBlock(existing, begin, end);
  if (scrubLegacy && next.includes(LEGACY_MARKER)) {
    next = stripLegacyBlock(next);
  }

  if (next !== existing) {
    writeFileSync(path, next);
  }
}

/**
 * Splice paqad's marker-fenced block out of `existing`, collapsing the blank
 * lines the removal would otherwise leave behind. Returns `existing` unchanged
 * when no complete block is present.
 */
function removeManagedBlock(existing: string, begin: string, end: string): string {
  const beginIdx = existing.indexOf(begin);
  const endIdx = existing.indexOf(end);
  if (beginIdx === -1 || endIdx <= beginIdx) {
    return existing;
  }

  const before = existing.slice(0, beginIdx).replace(/\n+$/, '');
  const after = existing.slice(endIdx + end.length).replace(/^\n+/, '');

  if (before === '' && after === '') {
    return '';
  }
  if (before === '') {
    return ensureTrailingNewline(after);
  }
  if (after === '') {
    return ensureTrailingNewline(before);
  }
  return ensureTrailingNewline(`${before}\n\n${after}`);
}

/**
 * Remove the pre-#184 legacy region from a root file: the `# paqad-ai` marker
 * line plus any line that exactly matches a path paqad has ever managed in the
 * root (every legacy path is a `.paqad/**` path). `framework-path.txt` is
 * included here so a legacy root entry for the boot pointer is cleaned even
 * though paqad no longer ignores it.
 */
function stripLegacyBlock(existing: string): string {
  const managedPaths = new Set([...ignoredPathsFromRoot(), '.paqad/framework-path.txt']);
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
 * index. For repos onboarded before this layout, untrack any now-ignored
 * managed path that is currently tracked. Safe when not in a git repo (skips
 * silently), never touches working-tree files (`--cached` only), idempotent
 * (no-op once nothing tracked matches), and leaves a single audit entry.
 */
function untrackNowIgnoredPaths(projectRoot: string, paths: string[]): void {
  if (!isGitRepository(projectRoot)) {
    return;
  }

  const tracked = listTrackedPaths(projectRoot, paths);
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

/**
 * Resolve, in a SINGLE `git ls-files` (not one subprocess per path), which of
 * `paths` git is currently tracking. A directory input matches when git tracks
 * any file beneath it; a file input matches an exact entry. Returns the matching
 * input paths (trailing slash stripped). Empty on any git failure (best-effort).
 *
 * Batching matters: writeGitignore checks ~30 ignore entries plus the deprecated
 * set on every run, and one subprocess per path made onboarding spawn dozens of
 * `git` processes, which timed out under load.
 */
function listTrackedPaths(projectRoot: string, paths: string[]): string[] {
  if (paths.length === 0) {
    return [];
  }
  const normalized = paths.map((path) => path.replace(/\/$/, ''));
  let listed: Set<string>;
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', ...normalized], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    listed = new Set(out.toString('utf8').split('\0').filter(Boolean));
  } catch {
    return [];
  }
  if (listed.size === 0) {
    return [];
  }
  const trackedEntries = [...listed];
  return normalized.filter((path) =>
    trackedEntries.some((entry) => entry === path || entry.startsWith(`${path}/`)),
  );
}
