import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ScannedEntry {
  /** Path relative to the scanned root. */
  relPath: string;
  /** Absolute path. */
  absPath: string;
  mtimeMs: number;
  sizeBytes: number;
}

export interface ScanOptions {
  /** Limit recursion to this depth. Default Infinity. */
  maxDepth?: number;
  /** Predicate filtering filenames (not paths). Default: include everything. */
  fileFilter?: (name: string) => boolean;
}

/**
 * Recursively list files under `root`. Silently returns `[]` if `root`
 * does not exist or is not a directory. Symlinks are not followed.
 * Hidden entries are included — collectors decide what to skip.
 */
export function scanDirectory(root: string, options: ScanOptions = {}): ScannedEntry[] {
  const out: ScannedEntry[] = [];
  const maxDepth = options.maxDepth ?? Infinity;
  const fileFilter = options.fileFilter ?? (() => true);

  const walk = (dir: string, depth: number, rel: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const entryAbs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) walk(entryAbs, depth + 1, entryRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!fileFilter(entry.name)) continue;
      try {
        const st = statSync(entryAbs);
        out.push({
          relPath: entryRel,
          absPath: entryAbs,
          mtimeMs: st.mtimeMs,
          sizeBytes: st.size,
        });
      } catch {
        // ignore — file removed mid-scan
      }
    }
  };

  walk(root, 0, '');
  return out;
}

/** Returns the mtime of a single file in ms, or `null` if not present. */
export function fileMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}
