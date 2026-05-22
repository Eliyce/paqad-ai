import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ExecutionSlice } from '@/core/types/planning.js';

import type { SliceCheckpointStore } from './slice-checkpoint.js';

export interface PreconditionCheckResult {
  met: boolean;
  blockedBy: string[];
}

export async function verifySlicePreconditions(
  projectRoot: string,
  slug: string,
  slice: ExecutionSlice,
  checkpointStore: SliceCheckpointStore,
): Promise<PreconditionCheckResult> {
  const blockedBy: string[] = [];

  for (const raw of slice.preconditions ?? []) {
    const parsed = parsePrecondition(raw);
    if (!parsed) {
      continue;
    }

    const checkpoint = await checkpointStore.load(projectRoot, slug, parsed.sliceId);
    if (!checkpoint || checkpoint.status !== 'completed') {
      blockedBy.push(parsed.sliceId);
      continue;
    }

    if (parsed.exportName && parsed.filePath) {
      const target = join(projectRoot, parsed.filePath);
      if (!existsSync(target)) {
        blockedBy.push(raw);
        continue;
      }

      const content = await readFile(target, 'utf8');
      if (!content.includes(parsed.exportName)) {
        blockedBy.push(raw);
      }
    }
  }

  return {
    met: blockedBy.length === 0,
    blockedBy,
  };
}

function parsePrecondition(
  input: string,
): { sliceId: string; exportName: string | null; filePath: string | null } | null {
  const match = input.match(/(SL-[\w-]+)(?:\s+([\w$]+)\s+exported(?:\s+\(([^)]+)\))?)?/i);
  if (!match) {
    return null;
  }

  return {
    sliceId: match[1],
    exportName: match[2] ?? null,
    filePath: match[3] ?? null,
  };
}
