// Persisted site-map progress store (issue #448). The site-map publisher's own
// differential-refresh ledger, split out of the documentation workflow's doc-progress.json.
// Mirrors src/code-knowledge/store.ts: an atomic temp+rename write, and a tolerant read where
// a missing, corrupt, or schema-invalid file reads as absent (null) — never a crash. That
// tolerance is the whole point: an unrelated stale ledger can no longer abort a site-map run
// (INV-2/INV-3), the exact failure #448 reports against the shared doc-progress reader.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  SITE_MAP_PROGRESS_SCHEMA_VERSION,
  type SiteMapProgressEntry,
  type SiteMapProgressFile,
} from '@/core/types/site-map-progress.js';

import { validateSiteMapProgress } from './schema.js';

export function siteMapProgressPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SITE_MAP_PROGRESS);
}

/** An empty, valid progress document — the starting point when none exists on disk. */
export function emptySiteMapProgress(): SiteMapProgressFile {
  return { schema_version: SITE_MAP_PROGRESS_SCHEMA_VERSION, generated_by: 'paqad-ai', views: {} };
}

/** A fresh, not-yet-published entry for a view and its source files. */
export function createSiteMapProgressEntry(
  path: string,
  source_files: string[],
): SiteMapProgressEntry {
  return {
    path,
    state: 'not_started',
    started_at: null,
    completed_at: null,
    source_files,
    source_hash: null,
    tokens_used: null,
  };
}

/** Persist the progress ledger atomically (temp file + rename). Returns the written path. */
export function writeSiteMapProgress(projectRoot: string, progress: SiteMapProgressFile): string {
  const target = siteMapProgressPath(projectRoot);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(progress, null, 2) + '\n', 'utf8');
  renameSync(tmp, target);
  return target;
}

/**
 * Read the progress ledger, or null when none exists / it is corrupt / it fails schema
 * validation. Degrading to null keeps a bad file from crashing the publisher and prevents a
 * malformed ledger from being trusted — the site-map run simply re-establishes its views.
 */
export function readSiteMapProgress(projectRoot: string): SiteMapProgressFile | null {
  const target = siteMapProgressPath(projectRoot);
  try {
    // Read directly (no existsSync-then-read race); a missing file throws ENOENT and reads
    // as absent, exactly like a corrupt or schema-invalid one.
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as unknown;
    return validateSiteMapProgress(parsed).valid ? (parsed as SiteMapProgressFile) : null;
  } catch {
    return null;
  }
}
