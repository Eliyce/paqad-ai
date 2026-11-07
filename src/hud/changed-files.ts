import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readSync, statSync, type Stats } from 'node:fs';
import { join } from 'node:path';

import { changedFilesSince, type ChangeStartPoint } from '@/feature-evidence/delivery.js';
import { isPaqadArtifactPath } from '@/pipeline/change-evidence.js';
import { readGitState } from '@/rag/git-state.js';

export const GIT_READ_TIMEOUT_MS = 2_000;
export const COMMIT_TIMES_LIMIT = 200;
const GIT_READ_MAX_BYTES = 16 * 1024 * 1024;

export interface ChangeGitReading {
  files: string[];
  commitTimes: Map<string, string>;
}

function gitRead(projectRoot: string, args: string[]): string[] {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_READ_TIMEOUT_MS,
    maxBuffer: GIT_READ_MAX_BYTES,
  })
    .split('\0')
    .filter((entry) => entry.length > 0);
}

export function readChangeGit(
  projectRoot: string,
  baseBranch: string | null,
  onError: (error: unknown) => void,
  start?: ChangeStartPoint | null,
): ChangeGitReading | null {
  const base =
    start === undefined
      ? readGitState(projectRoot, baseBranch ? { baseBranch } : {}).base_commit
      : (start?.commit ?? undefined);
  if (!base) return null;
  try {
    const files = new Set<string>();
    if (start) {
      const since = changedFilesSince(projectRoot, start);
      if (since === null) throw new Error('git could not list the changed files');
      for (const path of since) files.add(path);
    } else {
      for (const path of [
        ...gitRead(projectRoot, ['diff', '--name-only', '--relative', '-z', base]),
        ...gitRead(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
      ]) {
        if (!isPaqadArtifactPath(path)) files.add(path);
      }
    }
    const commitTimes = new Map<string, string>();
    for (const entry of gitRead(projectRoot, [
      'log',
      '-z',
      `--max-count=${COMMIT_TIMES_LIMIT}`,
      '--format=%H %cI',
      `${base}..HEAD`,
    ])) {
      const [sha, at] = entry.trim().split(' ');
      if (sha && at) commitTimes.set(sha, at);
    }
    return { files: [...files].sort(), commitTimes };
  } catch (error) {
    onError(error);
    return null;
  }
}

export function readWorkingTreeDirty(projectRoot: string): boolean | null {
  try {
    const paths = [
      ...gitRead(projectRoot, ['diff', '--name-only', '--relative', '-z', 'HEAD']),
      ...gitRead(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
    ];
    return paths.some((path) => !isPaqadArtifactPath(path));
  } catch {
    return null;
  }
}

export interface ChangeDiff {
  additions: number;
  deletions: number;
  partial: boolean;
}

export const NEW_FILE_MAX_BYTES = 1024 * 1024;
export const NUL_PROBE_BYTES = 8 * 1024;
export const NEW_FILES_PER_SNAPSHOT = 500;
export const NEW_FILE_BYTES_PER_SNAPSHOT = 8 * 1024 * 1024;
const NEW_FILE_CACHE_LIMIT = 10_000;

interface CachedCount {
  size: number;
  mtimeMs: number;
  lines: number;
}

const newFileLines = new Map<string, CachedCount>();

export function clearChangeDiffCache(): void {
  newFileLines.clear();
}

function numstatEntries(items: string[]): Array<{ path: string; added: number; removed: number }> {
  const entries: Array<{ path: string; added: number; removed: number }> = [];
  for (let index = 0; index < items.length; index += 1) {
    const [added = '', removed = '', ...rest] = items[index]!.split('\t');
    let path = rest.join('\t');
    if (path === '') {
      path = items[index + 2] ?? '';
      index += 2;
    }
    if (path === '') continue;
    entries.push({
      path: path.replace(/\\/g, '/'),
      added: Number.parseInt(added, 10) || 0,
      removed: Number.parseInt(removed, 10) || 0,
    });
  }
  return entries;
}

function countLines(buffer: Buffer, length: number): number {
  if (length === 0) return 0;
  let lines = 0;
  for (let index = 0; index < length; index += 1) {
    if (buffer[index] === 0x0a) lines += 1;
  }
  return buffer[length - 1] === 0x0a ? lines : lines + 1;
}

function readNewFileLines(path: string, size: number): { lines: number; bytes: number } | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(size);
    const probe = Math.min(size, NUL_PROBE_BYTES);
    let read = readSync(fd, buffer, 0, probe, 0);
    if (buffer.subarray(0, read).includes(0)) return { lines: 0, bytes: read };
    while (read < size) {
      const more = readSync(fd, buffer, read, size - read, read);
      if (more === 0) break;
      read += more;
    }
    return { lines: countLines(buffer, read), bytes: read };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

export function readChangeDiff(
  projectRoot: string,
  start: ChangeStartPoint | null,
  files: readonly string[] | null,
  onError: (error: unknown) => void,
): ChangeDiff | null {
  if (!start || !files) return null;
  const listed = new Set(files.map((path) => path.replace(/\\/g, '/')));
  let additions = 0;
  let deletions = 0;
  let partial = false;
  let untracked: string[];
  try {
    const counted = new Set<string>();
    for (const entry of numstatEntries(
      gitRead(projectRoot, ['diff', '--numstat', '-z', '--relative', start.commit]),
    )) {
      if (!listed.has(entry.path) || counted.has(entry.path)) continue;
      counted.add(entry.path);
      additions += entry.added;
      deletions += entry.removed;
    }
    const missing = [...listed].filter((path) => !counted.has(path));
    untracked =
      missing.length === 0
        ? []
        : gitRead(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z'])
            .map((path) => path.replace(/\\/g, '/'))
            .filter((path) => listed.has(path) && !counted.has(path));
  } catch (error) {
    onError(error);
    return null;
  }
  let filesRead = 0;
  let bytesRead = 0;
  for (const path of [...new Set(untracked)].sort()) {
    const absolute = join(projectRoot, path);
    let stats: Stats;
    try {
      stats = statSync(absolute);
    } catch {
      continue;
    }
    if (!stats.isFile() || stats.size > NEW_FILE_MAX_BYTES) continue;
    const cached = newFileLines.get(absolute);
    if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
      additions += cached.lines;
      continue;
    }
    if (
      partial ||
      filesRead >= NEW_FILES_PER_SNAPSHOT ||
      bytesRead + stats.size > NEW_FILE_BYTES_PER_SNAPSHOT
    ) {
      partial = true;
      continue;
    }
    const counted = readNewFileLines(absolute, stats.size);
    if (counted === null) continue;
    filesRead += 1;
    bytesRead += counted.bytes;
    additions += counted.lines;
    if (newFileLines.size >= NEW_FILE_CACHE_LIMIT) newFileLines.clear();
    newFileLines.set(absolute, { size: stats.size, mtimeMs: stats.mtimeMs, lines: counted.lines });
  }
  return { additions, deletions, partial };
}
