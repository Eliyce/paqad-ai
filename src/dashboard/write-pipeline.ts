import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';

import { appendDashboardAudit } from './approvals.js';

export class WriteConflictError extends Error {
  readonly currentContent: string | null;
  readonly currentHash: string | null;

  constructor(relativePath: string, currentContent: string | null, currentHash: string | null) {
    super(
      `This file changed since you opened it, likely by an agent. Review the diff of ${relativePath}.`,
    );
    this.name = 'WriteConflictError';
    this.currentContent = currentContent;
    this.currentHash = currentHash;
  }
}

export class PathNotAllowedError extends Error {
  constructor(relativePath: string, reason: string) {
    super(`Path is not editable from the dashboard: ${relativePath} (${reason}).`);
    this.name = 'PathNotAllowedError';
  }
}

const ALLOWED_FILES: readonly string[] = [PATHS.PROJECT_PROFILE, PATHS.RAG_IGNORE_CONFIG];

const ALLOWED_EXTENSIONS = ['.md', '.yml', '.yaml', '.json'];

const MAX_MANAGED_FILE_BYTES = 1024 * 1024;

export function contentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

export function resolveManagedPath(projectRoot: string, relativePath: string): string {
  const posix = toPosixPath(relativePath).replace(/^\/+/, '');
  if (posix.length === 0) {
    throw new PathNotAllowedError(relativePath, 'empty path');
  }
  const segments = posix.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new PathNotAllowedError(relativePath, 'path traversal');
  }

  const named = ALLOWED_FILES.includes(posix);
  if (!named) {
    if (segments.some((segment) => segment.startsWith('.'))) {
      throw new PathNotAllowedError(relativePath, 'dotfiles are not editable');
    }
    if (!posix.startsWith(`${PATHS.INSTRUCTIONS_DIR}/`)) {
      throw new PathNotAllowedError(
        relativePath,
        'outside docs/instructions and the named config files',
      );
    }
  }
  if (!ALLOWED_EXTENSIONS.some((extension) => posix.endsWith(extension))) {
    throw new PathNotAllowedError(relativePath, 'extension is not editable');
  }

  const realRoot = existsSync(projectRoot)
    ? realpathSync(resolve(projectRoot))
    : resolve(projectRoot);
  const absolute = resolve(realRoot, posix);
  const rootPrefix = `${realRoot}${sep}`;
  if (!absolute.startsWith(rootPrefix)) {
    throw new PathNotAllowedError(relativePath, 'outside the project root');
  }

  let probe = absolute;
  while (probe.startsWith(rootPrefix)) {
    if (existsSync(probe)) {
      if (lstatSync(probe).isSymbolicLink()) {
        throw new PathNotAllowedError(relativePath, 'symlinks are not editable');
      }
      const real = realpathSync(probe);
      if (real !== probe && !real.startsWith(rootPrefix)) {
        throw new PathNotAllowedError(relativePath, 'resolves outside the project root');
      }
      break;
    }
    probe = dirname(probe);
  }

  return absolute;
}

export interface ManagedFile {
  path: string;
  exists: boolean;
  content: string | null;
  hash: string | null;
}

export function readManagedFile(projectRoot: string, relativePath: string): ManagedFile {
  const absolute = resolveManagedPath(projectRoot, relativePath);
  const posix = toPosixPath(relativePath).replace(/^\/+/, '');
  if (!existsSync(absolute)) {
    return { path: posix, exists: false, content: null, hash: null };
  }
  const content = readFileSync(absolute, 'utf8');
  return { path: posix, exists: true, content, hash: contentHash(content) };
}

export interface WriteManagedFileInput {
  relativePath: string;
  content: string;
  baseHash: string | null;
  action: string;
}

export interface WriteManagedFileResult {
  path: string;
  hash: string;
}

export function writeManagedFile(
  projectRoot: string,
  input: WriteManagedFileInput,
): WriteManagedFileResult {
  const absolute = resolveManagedPath(projectRoot, input.relativePath);
  const posix = toPosixPath(input.relativePath).replace(/^\/+/, '');

  if (Buffer.byteLength(input.content, 'utf8') > MAX_MANAGED_FILE_BYTES) {
    throw new Error(`File exceeds the ${MAX_MANAGED_FILE_BYTES / 1024} KB dashboard write limit.`);
  }

  const current = existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
  const currentHash = current === null ? null : contentHash(current);
  if (currentHash !== input.baseHash) {
    throw new WriteConflictError(posix, current, currentHash);
  }

  mkdirSync(dirname(absolute), { recursive: true });
  const temp = join(dirname(absolute), `.paqad-dashboard-write-${process.pid}.tmp`);
  writeFileSync(temp, input.content);
  renameSync(temp, absolute);

  const hash = contentHash(input.content);
  appendDashboardAudit(projectRoot, input.action, { path: posix, contentHash: hash });
  return { path: posix, hash };
}
