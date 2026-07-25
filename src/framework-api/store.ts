// Persisted framework-API index store (issue #397). Mirrors src/code-knowledge/store.ts:
// an atomic temp+rename write, and a tolerant read where a missing, corrupt, or
// schema-invalid file reads as absent (null) — never a crash, and never a half-built
// index masquerading as real (INV-3, INV-4).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { validateFrameworkApiIndex } from './schema.js';
import type { FrameworkApiIndex } from './types.js';

export function frameworkApiIndexPath(projectRoot: string): string {
  return join(projectRoot, PATHS.FRAMEWORK_API_INDEX);
}

/** Persist the index atomically (temp file + rename). Returns the written path. */
export function writeFrameworkApiIndex(projectRoot: string, index: FrameworkApiIndex): string {
  const target = frameworkApiIndexPath(projectRoot);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n', 'utf8');
  renameSync(tmp, target);
  return target;
}

/**
 * Read the persisted index, or null when none exists / it is corrupt / it fails schema
 * validation. Degrading to null is what lets `plan compile` fall through to its documented
 * "index not built" warning (AC-6) instead of blocking on infrastructure the developer
 * never asked for.
 */
export function readFrameworkApiIndex(projectRoot: string): FrameworkApiIndex | null {
  try {
    // Read directly (no existsSync-then-read race); a missing file throws ENOENT and
    // reads as absent, exactly like a corrupt or schema-invalid one.
    const parsed = JSON.parse(readFileSync(frameworkApiIndexPath(projectRoot), 'utf8')) as unknown;
    return validateFrameworkApiIndex(parsed).valid ? (parsed as FrameworkApiIndex) : null;
  } catch {
    return null;
  }
}
