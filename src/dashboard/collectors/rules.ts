import { PATHS } from '@/core/constants/paths.js';

import type { SectionData } from '../types.js';
import { collectDocsArea } from './docs-area.js';

const HELPER = {
  what: 'docs/instructions/rules/** holds the canonical rules loaded by every agent invocation: constitution, security, performance, testing, etc.',
  goodLooksLike: 'All rule files in place for the project\'s stack, regenerated when capabilities change, refreshed in the last 30 days.',
} as const;

/**
 * Phase-1 expected minimum: 5 rule files. We avoid stack-aware
 * expectations here per the brief — that's a future enhancement once a
 * registry of "which rules each pack ships" exists.
 */
const EXPECTED_MIN = 5;

export function collectRules(projectRoot: string, now: number = Date.now()): SectionData {
  return collectDocsArea(
    projectRoot,
    {
      id: 'rules',
      title: 'Rules',
      relPath: PATHS.RULES_DIR,
      expectedMin: EXPECTED_MIN,
      helper: HELPER,
      missingCommand: '`paqad-ai refresh`',
    },
    now,
  );
}
