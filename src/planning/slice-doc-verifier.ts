import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type { DocTarget, SliceDocCheck } from '@/core/types/planning.js';

export function snapshotDocTargets(
  projectRoot: string,
  docTargets: DocTarget[],
): Record<string, string | null> {
  return Object.fromEntries(
    docTargets.map((target) => [target.target_id, hashFile(join(projectRoot, target.file))]),
  );
}

export function verifySliceDocs(
  projectRoot: string,
  docTargets: DocTarget[],
  baseline: Record<string, string | null>,
): SliceDocCheck[] {
  return docTargets.map((target) => {
    const currentHash = hashFile(join(projectRoot, target.file));
    const changed = baseline[target.target_id] !== currentHash;
    return {
      target_id: target.target_id,
      status: changed ? 'updated' : 'skipped',
      changed,
    };
  });
}

function hashFile(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }

  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
