import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { execa } from 'execa';

import type { CanonicalDocOwnershipKind, CanonicalDocTarget } from '@/core/types/verification.js';
import { readGitState } from '@/rag/git-state.js';

export interface ChangeEvidence {
  files: string[];
  source: 'git' | 'none';
}

/** Where a change started: the commit its work is measured from and the tree at open. */
export interface ChangeStartLike {
  commit: string;
  worktree: Record<string, string> | null;
}

export const DELETED_AT_START = 'deleted';

export function gitPathList(projectRoot: string, args: string[]): string[] | null {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
      maxBuffer: 16 * 1024 * 1024,
    })
      .split('\0')
      .filter((entry) => entry.length > 0);
  } catch {
    return null;
  }
}

export function digestWorkingFile(projectRoot: string, relativePath: string): string | null {
  try {
    return createHash('sha256')
      .update(readFileSync(join(projectRoot, relativePath)))
      .digest('hex');
  } catch {
    return null;
  }
}

/**
 * The files a change touched since its start point: committed, staged, edited and untracked,
 * leaving out paqad's own artifacts and every path whose content is unchanged since the change
 * opened (files that were already dirty or untracked then).
 */
export function changedFilesSince(projectRoot: string, start: ChangeStartLike): string[] | null {
  const diff = gitPathList(projectRoot, ['diff', '--name-only', '--relative', '-z', start.commit]);
  const untracked = gitPathList(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (diff === null || untracked === null) return null;
  const worktree = start.worktree ?? {};
  return [...new Set([...diff, ...untracked])]
    .map((path) => path.replace(/\\/g, '/'))
    .filter((path) => !isPaqadArtifactPath(path))
    .filter((path) => {
      const atStart = worktree[path];
      return (
        atStart === undefined ||
        (digestWorkingFile(projectRoot, path) ?? DELETED_AT_START) !== atStart
      );
    })
    .sort();
}

export interface LoadChangeEvidenceOptions {
  /** Measure from where the active change started instead of the merge-base with main. */
  since?: ChangeStartLike | null;
}

export async function loadChangeEvidence(
  projectRoot: string,
  options: LoadChangeEvidenceOptions = {},
): Promise<ChangeEvidence> {
  const files = await readGitChangedFiles(projectRoot, options);
  return files.length > 0 ? { files, source: 'git' } : { files: [], source: 'none' };
}

export async function readGitChangedFiles(
  projectRoot: string,
  options: LoadChangeEvidenceOptions = {},
): Promise<string[]> {
  if (options.since) {
    const since = changedFilesSince(projectRoot, options.since);
    if (since !== null) return since;
  }
  const gitState = readGitState(projectRoot);
  if (!gitState.head_commit || !gitState.base_commit) {
    return readGitStatusFiles(projectRoot);
  }

  const [statusFiles, committedFiles] = await Promise.all([
    readGitStatusFiles(projectRoot),
    readCommittedSinceBase(projectRoot, gitState.base_commit),
  ]);
  return normalizePaths([...statusFiles, ...committedFiles]);
}

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

export function isPaqadArtifactPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return (
    normalized === '.paqad' || normalized.startsWith('.paqad/') || normalized.includes('/.paqad/')
  );
}

export function isCodeFile(filePath: string): boolean {
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

export async function readGitStatusFiles(projectRoot: string): Promise<string[]> {
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
