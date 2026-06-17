import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { execa } from 'execa';

import { PATHS } from '@/core/constants/paths.js';
import type { CanonicalDocOwnershipKind, CanonicalDocTarget } from '@/core/types/verification.js';

export interface ChangeEvidence {
  files: string[];
  source: 'session-artifact' | 'git-status' | 'none';
}

export async function loadChangeEvidence(projectRoot: string): Promise<ChangeEvidence> {
  const tracked = await readTrackedFiles(projectRoot);
  if (tracked.length > 0) {
    return { files: tracked, source: 'session-artifact' };
  }

  const gitFiles = await readGitStatusFiles(projectRoot);
  if (gitFiles.length > 0) {
    return { files: gitFiles, source: 'git-status' };
  }

  return { files: [], source: 'none' };
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

export function isCodeFile(filePath: string): boolean {
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
