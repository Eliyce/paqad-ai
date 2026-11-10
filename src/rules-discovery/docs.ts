import { refreshStackDocsFromInventory } from '@/stack-docs/generator.js';

import { advanceRun, readInventoryFile } from './flow.js';
import { readResearchFiles } from './research.js';
import { readRun } from './run-store.js';

export function researchNotes(projectRoot: string, runId: string): Map<string, string> {
  const notes = new Map<string, string>();
  for (const source of readResearchFiles(projectRoot, runId).sources) {
    if (typeof source.package === 'string' && typeof source.fact === 'string') {
      if (!notes.has(source.package)) notes.set(source.package, source.fact);
    }
  }
  return notes;
}

export async function docsStep(
  projectRoot: string,
  runId: string,
  now: Date = new Date(),
  expectedRevision?: number,
): Promise<{ updated: string[] }> {
  const run = readRun(projectRoot, runId);
  if (run.state !== 'ok' || run.record.status !== 'open' || run.record.step !== 'docs') {
    throw new Error(`run ${runId} is not waiting at the docs step`);
  }
  const inventory = readInventoryFile(projectRoot, runId);
  const result =
    inventory === null
      ? { updated: [] }
      : await refreshStackDocsFromInventory(projectRoot, {
          packages: inventory.packages,
          notes: researchNotes(projectRoot, runId),
        });
  advanceRun(projectRoot, runId, { step: 'done', status: 'done' }, expectedRevision, now);
  return result;
}
