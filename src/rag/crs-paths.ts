import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import type { CrsCollectionId } from './types.js';

const SAFE_ID = /[^A-Za-z0-9._-]/g;

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

export function crsCollectionDir(projectRoot: string, collectionId: CrsCollectionId): string {
  return join(projectRoot, PATHS.CRS_DIR, escapeCollectionId(collectionId));
}

export function crsCollectionPaths(collectionId: CrsCollectionId): {
  indexPath: string;
  metaPath: string;
} {
  const dir = join(PATHS.CRS_DIR, escapeCollectionId(collectionId));
  return { indexPath: join(dir, 'index.json'), metaPath: join(dir, 'meta.json') };
}

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
