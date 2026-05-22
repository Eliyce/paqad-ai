import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { PriorSliceSummary, SliceCheckpoint } from '@/core/types/planning.js';
import { summarizeCheckpoint } from './prior-slice-summary.js';

export class SliceCheckpointStore {
  async load(projectRoot: string, slug: string, sliceId: string): Promise<SliceCheckpoint | null> {
    const target = checkpointPath(projectRoot, slug, sliceId);
    if (!existsSync(target)) {
      return null;
    }

    try {
      return JSON.parse(await readFile(target, 'utf8')) as SliceCheckpoint;
    } catch {
      return null;
    }
  }

  async save(projectRoot: string, slug: string, checkpoint: SliceCheckpoint): Promise<string> {
    const target = checkpointPath(projectRoot, slug, checkpoint.slice_id);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
    return target;
  }

  async loadSummaries(
    projectRoot: string,
    slug: string,
    completedSliceIds: string[],
  ): Promise<PriorSliceSummary[]> {
    const summaries: PriorSliceSummary[] = [];

    for (const sliceId of completedSliceIds) {
      const checkpoint = await this.load(projectRoot, slug, sliceId);
      if (!checkpoint || checkpoint.status !== 'completed') {
        continue;
      }

      summaries.push(summarizeCheckpoint(checkpoint));
    }

    return summaries;
  }
}

export function checkpointPath(projectRoot: string, slug: string, sliceId: string): string {
  return join(projectRoot, PATHS.PLANNING_SPECS_DIR, `${slug}.checkpoints`, `${sliceId}.json`);
}
