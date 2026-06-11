import { access } from 'node:fs/promises';
// posix.join keeps DocTarget.file forward-slashed on Windows; the segments
// are repo-relative literals, never native filesystem paths.
import { posix } from 'node:path';

import type { DocTarget, ExecutionSlice } from '@/core/types/planning.js';

const { join } = posix;

export async function resolveDocTargets(
  root: string,
  executionSlices: ExecutionSlice[],
  apiImpact?: string | null,
  uiImpact?: string | null,
): Promise<DocTarget[]> {
  const targets: DocTarget[] = [];
  let nextId = 1;

  for (const slice of executionSlices) {
    for (const touched of slice.touches) {
      const moduleName = deriveModuleName(touched);
      if (!moduleName) {
        continue;
      }

      const technicalDoc = join('docs/modules', moduleName, 'technical.md');
      if (await exists(join(root, technicalDoc))) {
        targets.push({
          target_id: `DOC-${nextId++}`,
          file: technicalDoc,
          section: 'Technical Notes',
          reason: `${slice.slice_id} touches ${touched}`,
          slice_id: slice.slice_id,
          status: 'pending',
        });
      }

      if (apiImpact && (touched.includes('/api/') || touched.includes('api'))) {
        targets.push({
          target_id: `DOC-${nextId++}`,
          file: join('docs/modules', moduleName, 'api', 'endpoints.md'),
          section: 'API Changes',
          reason: `${slice.slice_id} changes API behavior`,
          slice_id: slice.slice_id,
          status: 'pending',
        });
      }

      if (
        uiImpact &&
        (touched.includes('/ui/') ||
          touched.includes('/components/') ||
          touched.includes('/pages/'))
      ) {
        targets.push({
          target_id: `DOC-${nextId++}`,
          file: join('docs/modules', moduleName, 'ui', 'components.md'),
          section: 'UI Changes',
          reason: `${slice.slice_id} changes UI behavior`,
          slice_id: slice.slice_id,
          status: 'pending',
        });
      }
    }
  }

  return dedupeTargets(targets);
}

function deriveModuleName(touched: string): string | null {
  const segments = touched.split('/').filter(Boolean);
  if (segments[0] === 'src' && segments[1]) {
    return segments[1];
  }
  if (segments[0] === 'app' && segments[1]) {
    return segments[1];
  }
  return null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function dedupeTargets(targets: DocTarget[]): DocTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.file}:${target.section}:${target.slice_id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
