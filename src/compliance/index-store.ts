import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ObligationIndex } from './types.js';
import { DEFAULT_OBLIGATION_INDEX_PATH } from './constants.js';

export interface LoadObligationIndexOptions {
  project_root: string;
  index_path?: string;
}

export async function loadObligationIndex(
  options: LoadObligationIndexOptions,
): Promise<ObligationIndex | null> {
  const indexPath = resolveIndexPath(options.project_root, options.index_path);

  try {
    const raw = await readFile(indexPath, 'utf8');
    return JSON.parse(raw) as ObligationIndex;
  } catch (error) {
    if (isEnoentError(error)) {
      return null;
    }
    throw error;
  }
}

export interface SaveObligationIndexOptions {
  project_root: string;
  index: ObligationIndex;
  index_path?: string;
}

export async function saveObligationIndex(options: SaveObligationIndexOptions): Promise<string> {
  const indexPath = resolveIndexPath(options.project_root, options.index_path);
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, JSON.stringify(options.index, null, 2) + '\n', 'utf8');
  return indexPath;
}

function resolveIndexPath(projectRoot: string, indexPath?: string): string {
  return path.resolve(projectRoot, indexPath ?? DEFAULT_OBLIGATION_INDEX_PATH);
}

export function isEnoentError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}
