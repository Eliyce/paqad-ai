import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { execa } from 'execa';

import { PATHS } from '@/core/constants/paths.js';
import type { CanonicalDocOwnershipKind, CanonicalDocTarget } from '@/core/types/verification.js';
import { readGitState } from '@/rag/git-state.js';

export interface ChangeEvidence {
  files: string[];
  source: 'session-artifact' | 'git-status' | 'none';
}

export async function loadChangeEvidence(projectRoot: string): Promise<ChangeEvidence> {
  const tracked = await readTrackedFiles(projectRoot);
  if (tracked.length > 0) {
    // Issue #450: never trust the session artifact blindly. A `changed-files.json`
    // left over from an already-delivered change (its files committed and clean)
    // would otherwise be attributed to a later, unrelated session and force the
    // full feature-development gate onto out-of-scope work. Keep only the entries
    // git still considers part of the current change.
    const reconciled = await reconcileTrackedWithGit(projectRoot, tracked);
    if (reconciled.length > 0) {
      return { files: reconciled, source: 'session-artifact' };
    }
    // Every tracked entry is stale (clean and already in base history): fall
    // through to git reality instead of returning an empty session-artifact.
  }

  const gitFiles = await readGitStatusFiles(projectRoot);
  if (gitFiles.length > 0) {
    return { files: gitFiles, source: 'git-status' };
  }

  return { files: [], source: 'none' };
}

/**
 * Intersect the tracked-file artifact with what git currently considers changed.
 * Returns the tracked list unchanged when git cannot bound the current change
 * (not a work tree, or no resolvable base branch), so non-git and base-less
 * repositories keep their prior behavior. Otherwise drops any entry that is
 * neither dirty in the working tree nor committed on this branch since the
 * merge-base — i.e. entries that git already treats as delivered base history.
 */
async function reconcileTrackedWithGit(projectRoot: string, tracked: string[]): Promise<string[]> {
  const changed = await gitChangedSet(projectRoot);
  if (changed === null) {
    return tracked;
  }
  return tracked.filter((filePath) => changed.has(filePath));
}

/**
 * The set of files git considers changed for the current branch: the union of
 * working-tree status and everything committed since the merge-base with the
 * base branch. Returns `null` when the divergence cannot be bounded — a non-git
 * directory, a detached HEAD, or a repo with no `main`/`master` base — signalling
 * "cannot reconcile, trust the artifact".
 */
async function gitChangedSet(projectRoot: string): Promise<Set<string> | null> {
  const gitState = readGitState(projectRoot);
  if (!gitState.head_commit || !gitState.base_commit) {
    return null;
  }

  const [statusFiles, committedFiles] = await Promise.all([
    readGitStatusFiles(projectRoot),
    readCommittedSinceBase(projectRoot, gitState.base_commit),
  ]);
  return new Set([...statusFiles, ...committedFiles]);
}

/** Files changed between `baseCommit` and HEAD (committed on this branch). */
async function readCommittedSinceBase(projectRoot: string, baseCommit: string): Promise<string[]> {
  try {
    const result = await execa('git', ['diff', '--name-only', `${baseCommit}..HEAD`], {
      cwd: projectRoot,
      reject: false,
    });
    if (result.exitCode !== 0) {
      return [];
    }

    return normalizePaths(
      result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } catch {
    return [];
  }
}

export function isDocumentationFile(filePath: string): boolean {
  return (
    filePath === 'README.md' || filePath.startsWith('docs/') || filePath.startsWith('website/')
  );
}

export function isTestFile(filePath: string): boolean {
  return (
    filePath.startsWith('tests/') ||
    filePath.includes('/__tests__/') ||
    /\.test\.[cm]?[jt]sx?$/.test(filePath) ||
    /\.spec\.[cm]?[jt]sx?$/.test(filePath)
  );
}

/**
 * True when a path lives under any `.paqad/` home — the root `.paqad/`, or a
 * nested runtime home such as `runtime/base/.paqad/` (issue #205). Everything
 * under a `.paqad/` home is framework work-product: generated logs, evidence
 * JSON, quality baselines, session state, team config. None of it is the
 * project's own source, so it must never be classified as changed code. Mirrors
 * the inlined checks already used by `src/rag/file-filter.ts` and
 * `src/stage-evidence/scope.ts`, but as a small exported predicate the
 * changed-file classifier can share.
 */
export function isPaqadArtifactPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return (
    normalized === '.paqad' || normalized.startsWith('.paqad/') || normalized.includes('/.paqad/')
  );
}

export function isCodeFile(filePath: string): boolean {
  // Issue #205 — generated `.paqad/` artifacts (from any `.paqad/` home, including
  // a self-hosted `runtime/base/.paqad/`) leak into the working tree and would
  // otherwise match the `runtime/`/extension rules below. They are never code.
  if (isPaqadArtifactPath(filePath)) {
    return false;
  }

  if (isDocumentationFile(filePath) || isTestFile(filePath)) {
    return false;
  }

  return (
    filePath.startsWith('src/') ||
    filePath.startsWith('runtime/') ||
    filePath.startsWith('scripts/') ||
    filePath.startsWith('bin/') ||
    filePath === 'package.json' ||
    filePath === 'tsconfig.json' ||
    filePath.endsWith('.ts') ||
    filePath.endsWith('.tsx') ||
    filePath.endsWith('.js') ||
    filePath.endsWith('.jsx') ||
    filePath.endsWith('.mjs') ||
    filePath.endsWith('.cjs') ||
    filePath.endsWith('.sh')
  );
}

export async function detectStaleDocTargets(
  projectRoot: string,
  changedFiles: string[],
): Promise<CanonicalDocTarget[]> {
  const relevantFiles = changedFiles.filter(
    (filePath) => isCodeFile(filePath) || isTestFile(filePath) || isDocumentationFile(filePath),
  );
  if (relevantFiles.length === 0) {
    return [];
  }

  try {
    const detectorPath = join(projectRoot, 'runtime', 'hooks', 'stale-doc-detector.sh');
    const result = await execa(detectorPath, {
      cwd: projectRoot,
      input: `${relevantFiles.join('\n')}\n`,
      reject: false,
    });
    if (result.exitCode !== 0 || result.stdout.trim() === '') {
      return [];
    }

    const parsed = JSON.parse(result.stdout) as unknown;
    return normalizeCanonicalDocTargets(parsed, relevantFiles);
  } catch {
    return [];
  }
}

async function readTrackedFiles(projectRoot: string): Promise<string[]> {
  const target = join(projectRoot, PATHS.CHANGED_FILES);
  if (!existsSync(target)) {
    return [];
  }

  try {
    const raw = await readFile(target, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizePaths(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return [];
  }
}

async function readGitStatusFiles(projectRoot: string): Promise<string[]> {
  try {
    const result = await execa('git', ['status', '--short', '--untracked-files=all'], {
      cwd: projectRoot,
      reject: false,
    });
    if (result.exitCode !== 0) {
      return [];
    }

    return normalizePaths(
      result.stdout
        .split('\n')
        .map(parseGitStatusPath)
        .filter((value): value is string => value !== null),
    );
  } catch {
    return [];
  }
}

function parseGitStatusPath(line: string): string | null {
  // `git status --short` emits `XY PATH`: a two-column status, one separator
  // space, then the path starting at column 3. The first column is a space for
  // worktree-only changes (e.g. " M package.json"), so the line must NOT be
  // left-trimmed before slicing — trimming the leading space shifts everything
  // left and drops the first character of the path ("ackage.json").
  const stripped = line.replace(/\r$/, '');
  if (stripped.length < 4) {
    return null;
  }

  const payload = stripped.slice(3).trim();
  if (payload.length === 0) {
    return null;
  }
  if (payload.includes(' -> ')) {
    return /* v8 ignore next */ payload.split(' -> ').at(-1) ?? null;
  }

  return payload;
}

function normalizePaths(files: string[]): string[] {
  return [...new Set(files.map((filePath) => filePath.replace(/\\/g, '/')).filter(Boolean))].sort();
}

function normalizeCanonicalDocTargets(
  parsed: unknown,
  changedFiles: string[],
): CanonicalDocTarget[] {
  if (!Array.isArray(parsed)) {
    return [];
  }

  const normalizedEntries = parsed
    .map((entry) => normalizeCanonicalDocTarget(entry, changedFiles))
    .filter((entry): entry is CanonicalDocTarget => entry !== null)
    .filter((entry) => isCanonicalDocPath(entry.target_path));

  const deduped = new Map<string, CanonicalDocTarget>();
  for (const entry of normalizedEntries) {
    const existing = deduped.get(entry.target_path);
    if (!existing) {
      deduped.set(entry.target_path, entry);
      continue;
    }

    deduped.set(entry.target_path, {
      target_path: entry.target_path,
      ownership_kind:
        existing.ownership_kind === 'direct-doc-edit' || entry.ownership_kind === 'direct-doc-edit'
          ? 'direct-doc-edit'
          : 'implementation-drift',
      owners: normalizePaths([...existing.owners, ...entry.owners]),
      reason: dedupeReasonFragments([existing.reason, entry.reason]),
    });
  }

  return [...deduped.values()].sort((a, b) => a.target_path.localeCompare(b.target_path));
}

function normalizeCanonicalDocTarget(
  entry: unknown,
  changedFiles: string[],
): CanonicalDocTarget | null {
  if (typeof entry === 'string') {
    return {
      target_path: normalizePath(entry),
      ownership_kind: changedFiles.includes(normalizePath(entry))
        ? 'direct-doc-edit'
        : 'implementation-drift',
      owners: changedFiles.includes(normalizePath(entry)) ? [normalizePath(entry)] : [],
      reason: changedFiles.includes(normalizePath(entry))
        ? 'Canonical doc changed directly in the diff.'
        : 'Detector marked this canonical doc as stale for the current diff.',
    };
  }

  if (typeof entry !== 'object' || entry === null) {
    return null;
  }

  const candidate = entry as Partial<CanonicalDocTarget> & {
    target?: unknown;
    target_path?: unknown;
    owners?: unknown;
    changed_files?: unknown;
    reason?: unknown;
    ownership_kind?: unknown;
  };
  const rawTarget =
    typeof candidate.target_path === 'string' ? candidate.target_path : candidate.target;
  if (typeof rawTarget !== 'string' || rawTarget.trim() === '') {
    return null;
  }

  const normalizedTarget = normalizePath(rawTarget);
  const owners = Array.isArray(candidate.owners)
    ? candidate.owners
    : Array.isArray(candidate.changed_files)
      ? candidate.changed_files
      : [];

  return {
    target_path: normalizedTarget,
    ownership_kind: normalizeOwnershipKind(
      candidate.ownership_kind,
      changedFiles.includes(normalizedTarget),
    ),
    owners: normalizePaths(owners.filter((value): value is string => typeof value === 'string')),
    reason:
      typeof candidate.reason === 'string' && candidate.reason.trim() !== ''
        ? candidate.reason.trim()
        : changedFiles.includes(normalizedTarget)
          ? 'Canonical doc changed directly in the diff.'
          : 'Detector marked this canonical doc as stale for the current diff.',
  };
}

function normalizeOwnershipKind(
  value: unknown,
  directlyEdited: boolean,
): CanonicalDocOwnershipKind {
  if (value === 'direct-doc-edit' || value === 'implementation-drift') {
    return value;
  }

  return directlyEdited ? 'direct-doc-edit' : 'implementation-drift';
}

export function isCanonicalDocPath(filePath: string): boolean {
  return (
    filePath === 'README.md' ||
    filePath.startsWith('docs/modules/') ||
    filePath.startsWith('docs/instructions/') ||
    filePath.startsWith('docs/maintainers/')
  );
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').trim();
}

function dedupeReasonFragments(reasons: string[]): string {
  return [...new Set(reasons.map((reason) => reason.trim()).filter(Boolean))].join(' ');
}
