import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function hashSourceFiles(projectRoot: string, sourceFiles: string[]): Promise<string> {
  const hash = createHash('sha1');

  for (const relativePath of [...new Set(sourceFiles)].sort()) {
    hash.update(`path:${relativePath}\0`);

    try {
      hash.update(await readFile(join(projectRoot, relativePath), 'utf8'));
    } catch {
      hash.update(`missing\0`);
    }
  }

  return `sha1:${hash.digest('hex').slice(0, 7)}`;
}
