// Persisted code-knowledge index store (issue #353). Mirrors the checks/report-store
// discipline: an atomic temp+rename write, and a tolerant read where a missing,
// corrupt, or schema-invalid file reads as absent (null) — never a crash, and never
// a half-built index masquerading as real (INV-4).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { validateCodeKnowledgeIndex } from './schema.js';
import type { CodeKnowledgeIndex } from './types.js';

export function codeKnowledgeIndexPath(projectRoot: string): string {
  return join(projectRoot, PATHS.CODE_KNOWLEDGE_INDEX);
}

/** Persist the index atomically (temp file + rename). Returns the written path. */
export function writeCodeKnowledgeIndex(projectRoot: string, index: CodeKnowledgeIndex): string {
  const target = codeKnowledgeIndexPath(projectRoot);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n', 'utf8');
  renameSync(tmp, target);
  return target;
}

/**
 * Read the persisted index, or null when none exists / it is corrupt / it fails
 * schema validation. Degrading to null keeps a bad file from crashing a consumer
 * and prevents a malformed index from being trusted.
 */
export function readCodeKnowledgeIndex(projectRoot: string): CodeKnowledgeIndex | null {
  const target = codeKnowledgeIndexPath(projectRoot);
  try {
    // Read directly (no existsSync-then-read race); a missing file throws ENOENT and
    // reads as absent, exactly like a corrupt or schema-invalid one.
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as unknown;
    return validateCodeKnowledgeIndex(parsed).valid ? (parsed as CodeKnowledgeIndex) : null;
  } catch {
    return null;
  }
}
