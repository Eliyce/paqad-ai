import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ScannedEntry {
  relPath: string;
  absPath: string;
  mtimeMs: number;
  sizeBytes: number;
}

export interface ScanOptions {
  maxDepth?: number;
  fileFilter?: (name: string) => boolean;
}

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
      } catch {}
    }
  };

  walk(root, 0, '');
  return out;
}

export function fileMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}
