import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { getPacksForFrameworks } from '@/packs/project-packs.js';

export function resolveBuildOutputs(projectRoot: string, frameworks: string[]): string[] | null {
  const folders = new Set<string>();
  for (const pack of getPacksForFrameworks(frameworks, projectRoot)) {
    for (const folder of pack.manifest.build_outputs ?? []) folders.add(folder);
  }
  return folders.size > 0 ? [...folders].sort() : null;
}

export function computeBuildOutputFingerprint(
  projectRoot: string,
  folders: readonly string[] | null,
): string | null {
  if (!folders || folders.length === 0) return null;
  const entries: string[] = [];
  for (const folder of folders) {
    const files = listFolder(projectRoot, folder);
    if (files === null) return null;
    entries.push(...files);
  }
  return createHash('sha256').update(entries.sort().join('\n')).digest('hex');
}

function listFolder(projectRoot: string, folder: string): string[] | null {
  try {
    if (!lstatSync(join(projectRoot, folder)).isDirectory()) return null;
  } catch {
    return null;
  }
  const entries: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(projectRoot, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      const stats = lstatSync(join(projectRoot, child));
      entries.push(`${child}\0${stats.size}\0${stats.mtimeMs}`);
    }
  };
  walk(folder.replace(/\\/g, '/').replace(/\/+$/, ''));
  return entries;
}
