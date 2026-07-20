import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { StackSnapshot } from '@/core/types/introspection.js';
import { sanitizeStackSnapshotRepository } from '@/onboarding/manifest-writer.js';

/**
 * Synchronous read of the stack snapshot, for callers that cannot await (issue #357: the
 * plan-compile verb is sync all the way down). Same tolerance contract as
 * {@link StackSnapshotCache.read} — a missing or corrupt snapshot reads as `null`, never a
 * throw — and it resolves the path through `PATHS.STACK_SNAPSHOT` so there is one place
 * the snapshot location is known.
 */
export function readStackSnapshotSync(projectRoot: string): StackSnapshot | null {
  try {
    return JSON.parse(
      readFileSync(join(projectRoot, PATHS.STACK_SNAPSHOT), 'utf8'),
    ) as StackSnapshot;
  } catch {
    return null;
  }
}

export class StackSnapshotCache {
  async read(projectRoot: string): Promise<StackSnapshot | null> {
    try {
      const raw = await readFile(join(projectRoot, PATHS.STACK_SNAPSHOT), 'utf8');
      return JSON.parse(raw) as StackSnapshot;
    } catch {
      return null;
    }
  }

  async write(projectRoot: string, snapshot: StackSnapshot): Promise<void> {
    const target = join(projectRoot, PATHS.STACK_SNAPSHOT);
    await mkdir(dirname(target), { recursive: true });
    const sanitized = sanitizeStackSnapshotRepository(projectRoot, snapshot);
    await writeFile(target, `${JSON.stringify(sanitized, null, 2)}\n`);
  }

  async hashFiles(projectRoot: string, relativePaths: string[]): Promise<Record<string, string>> {
    const hashes: Record<string, string> = {};

    for (const relativePath of relativePaths) {
      try {
        const content = await readFile(join(projectRoot, relativePath), 'utf8');
        hashes[relativePath] = `sha256:${createHash('sha256').update(content).digest('hex')}`;
      } catch {
        try {
          const pathStat = await stat(join(projectRoot, relativePath));
          hashes[relativePath] = pathStat.isDirectory() ? 'exists:directory' : 'exists:file';
        } catch {
          continue;
        }
      }
    }

    return hashes;
  }
}
