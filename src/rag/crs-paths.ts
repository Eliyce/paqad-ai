// PQD-415 — on-disk addressing for project-scoped CRS collections.
//
// A CRS collection is keyed by a caller-chosen `CrsCollectionId` (e.g.
// `project-A:crs`). Collection ids may contain characters that are illegal in a
// directory name on some platforms (a colon is illegal on NTFS), so they are
// escaped to a filesystem-safe form before they ever touch the disk. The escape
// is deterministic and part of the public contract — the desktop reconstructs an
// on-disk path with {@link escapeCollectionId} when it needs to.

import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import type { CrsCollectionId } from './types.js';

/** Characters allowed verbatim in an escaped collection directory name. */
const SAFE_ID = /[^A-Za-z0-9._-]/g;

/**
 * Map a {@link CrsCollectionId} to a deterministic, filesystem-safe directory
 * name. Any character outside `[A-Za-z0-9._-]` is replaced with `_`, and any run
 * of dots (which could otherwise form a `..` traversal) is collapsed to `_`.
 * Whenever escaping changed the string, a short content hash of the original id
 * is appended so two distinct ids can never collapse to the same directory.
 *
 * @throws {Error} when `id` is empty or escapes to nothing usable.
 */
export function escapeCollectionId(id: CrsCollectionId): string {
  const raw = String(id);
  if (raw.trim().length === 0) {
    throw new Error('CRS collection id must be a non-empty string');
  }
  const safe = raw.replace(SAFE_ID, '_').replace(/\.{2,}/g, '_');
  if (safe === '.') {
    throw new Error(`CRS collection id escapes to an unusable directory name: ${raw}`);
  }
  if (safe === raw) {
    return safe;
  }
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return `${safe}-${hash}`;
}

/** Absolute path to a CRS collection's directory under `<projectRoot>/.paqad/crs/`. */
export function crsCollectionDir(projectRoot: string, collectionId: CrsCollectionId): string {
  return join(projectRoot, PATHS.CRS_DIR, escapeCollectionId(collectionId));
}

/**
 * Project-relative index/meta paths for a CRS collection, in the shape
 * {@link FileVectorIndex} expects (it joins them onto `projectRoot` itself).
 */
export function crsCollectionPaths(collectionId: CrsCollectionId): {
  indexPath: string;
  metaPath: string;
} {
  const dir = join(PATHS.CRS_DIR, escapeCollectionId(collectionId));
  return { indexPath: join(dir, 'index.json'), metaPath: join(dir, 'meta.json') };
}

/**
 * Full on-disk layout for a CRS collection — both the project-relative paths
 * {@link FileVectorIndex} consumes and the absolute paths the side-by-side
 * reindex swap needs (it `rename`s sibling directories directly). `escaped` is
 * the directory name; `.revert.<ms>` siblings under `crsRootAbs` are retired
 * indexes awaiting their 24-hour cleanup.
 */
export function crsCollectionLayout(
  projectRoot: string,
  collectionId: CrsCollectionId,
): {
  escaped: string;
  crsRootAbs: string;
  relDir: string;
  absDir: string;
  indexPath: string;
  metaPath: string;
} {
  const escaped = escapeCollectionId(collectionId);
  const relDir = join(PATHS.CRS_DIR, escaped);
  return {
    escaped,
    crsRootAbs: join(projectRoot, PATHS.CRS_DIR),
    relDir,
    absDir: join(projectRoot, relDir),
    indexPath: join(relDir, 'index.json'),
    metaPath: join(relDir, 'meta.json'),
  };
}
