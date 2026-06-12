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

/**
 * Issue #146 — the audited write pipeline behind every dashboard file
 * mutation (spec section 6.2 steps 2-3 and the section 6.3 guardrails).
 *
 * Route handlers never write files directly: they validate their payload,
 * then call {@link writeManagedFile}, which enforces the path allowlist,
 * detects concurrent edits via content hashes, writes atomically, and
 * appends the `actor="dashboard"` audit line. Agent sync (spec step 5) needs
 * no code here: the agent-entry gates compare mtimes under
 * `docs/instructions/**` against the sentinel, so the write itself
 * invalidates stale agent context.
 */

/** Thrown when a PUT carries a stale content hash (spec 6.3 → HTTP 409). */
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

/** Thrown when a path falls outside the allowlist (spec 6.3 → HTTP 403). */
export class PathNotAllowedError extends Error {
  constructor(relativePath: string, reason: string) {
    super(`Path is not editable from the dashboard: ${relativePath} (${reason}).`);
    this.name = 'PathNotAllowedError';
  }
}

/**
 * Exact-file allowlist entries beyond `docs/instructions/**`. Named config
 * files only — evidence and ledgers have no mutation routes at all.
 */
const ALLOWED_FILES: readonly string[] = [
  PATHS.PROJECT_PROFILE,
  PATHS.DECISION_PAUSE_CONTRACT,
  PATHS.RAG_IGNORE_CONFIG,
];

const ALLOWED_EXTENSIONS = ['.md', '.yml', '.yaml', '.json'];

const MAX_MANAGED_FILE_BYTES = 1024 * 1024;

export function contentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

/**
 * Normalizes and validates a project-relative path against the allowlist:
 * only `docs/instructions/**` plus the named config files; no traversal, no
 * dotfiles, editable extensions only; symlinks are resolved and rejected
 * when they escape the project root. Returns the absolute path.
 */
export function resolveManagedPath(projectRoot: string, relativePath: string): string {
  const posix = toPosixPath(relativePath).replace(/^\/+/, '');
  if (posix.length === 0) {
    throw new PathNotAllowedError(relativePath, 'empty path');
  }
  const segments = posix.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new PathNotAllowedError(relativePath, 'path traversal');
  }

  // The named .paqad config files start with a dot segment, so the literal
  // allowlist is checked before the dotfile rule.
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

  // Canonicalize the root itself (macOS tmpdir lives behind /var → /private
  // symlinks) so the escape checks compare like with like.
  const realRoot = existsSync(projectRoot)
    ? realpathSync(resolve(projectRoot))
    : resolve(projectRoot);
  const absolute = resolve(realRoot, posix);
  const rootPrefix = `${realRoot}${sep}`;
  if (!absolute.startsWith(rootPrefix)) {
    throw new PathNotAllowedError(relativePath, 'outside the project root');
  }

  // Reject symlinked targets (and symlinked parents) that escape the root.
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

/** Reads an allowlisted file with the hash the client must echo on PUT. */
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
  /**
   * Hash of the content the client loaded; `null` asserts the file is being
   * created and must not already exist.
   */
  baseHash: string | null;
  /** Audit log action, e.g. `dashboard.config.delivery-policy.write`. */
  action: string;
}

export interface WriteManagedFileResult {
  path: string;
  hash: string;
}

/**
 * The single write path for dashboard file mutations: allowlist, size cap,
 * optimistic-concurrency check, atomic write (temp file + rename), audit.
 */
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
