import { PATHS } from '@/core/constants/paths.js';

import type { SectionData } from '../types.js';
import { collectDocsArea } from './docs-area.js';

const HELPER = {
  what: 'docs/instructions/workflows/** holds the YAML workflow definitions the workflow engine runs (feature-development, pentest, RCA, …).',
  goodLooksLike:
    'At least one workflow per active capability, regenerated when packs change, recently edited.',
} as const;

/** Phase-1 expected minimum: 1 workflow definition. */
const EXPECTED_MIN = 1;

export function collectWorkflows(projectRoot: string, now: number = Date.now()): SectionData {
  return collectDocsArea(
    projectRoot,
    {
      id: 'workflows',
      title: 'Workflows',
      relPath: PATHS.WORKFLOWS_DIR,
      expectedMin: EXPECTED_MIN,
      // Workflow files are YAML.
      fileFilter: (n) => n.endsWith('.yaml') || n.endsWith('.yml'),
      helper: HELPER,
      missingCommand: '`paqad-ai refresh`',
    },
    now,
  );
}
