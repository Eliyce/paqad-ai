import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GeneratedFile } from '@/adapters/adapter.interface.js';
import { PATHS } from '@/core/constants/paths.js';
import type { ResolvedArtifact } from '@/core/types/resolution.js';

export async function generateProjectRules(rules: ResolvedArtifact[]): Promise<GeneratedFile[]> {
  return Promise.all(
    rules.map(async (rule) => ({
      path: toProjectRulePath(rule.source),
      content: await readFile(rule.path, 'utf8'),
      autoUpdate: false,
    })),
  );
}

function toProjectRulePath(source: string): string {
  const normalized = source.replaceAll('\\', '/');

  if (normalized.startsWith('base/rules/')) {
    return join(PATHS.RULES_DIR, '_shared', normalized.replace(/^base\/rules\//, ''));
  }

  if (normalized.startsWith('capabilities/')) {
    const capabilityNormalized = normalized.replace(/^capabilities\//, '');
    const [prefix, suffix] = capabilityNormalized.split('/rules/');

    if (prefix !== undefined && suffix !== undefined) {
      const target = suffix.endsWith('/guide.md') ? suffix.replace('/guide.md', '.md') : suffix;
      return join(PATHS.RULES_DIR, prefix, target);
    }
  }

  const [prefix, suffix] = normalized.split('/rules/');

  if (prefix === undefined || suffix === undefined) {
    return join(PATHS.RULES_DIR, normalized);
  }

  const target = suffix.endsWith('/guide.md') ? suffix.replace('/guide.md', '.md') : suffix;
  return join(PATHS.RULES_DIR, prefix, target);
}
