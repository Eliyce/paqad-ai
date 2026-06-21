import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AdapterFactory } from '@/adapters';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';

/**
 * Enforces `docs/instructions/rules/coding/agent-entry-files.md`: a host entry
 * file is a minimal bootstrap, not a feature changelog. Its only `##` sections
 * are one-line pointers to managed `.paqad/` contracts. A new `## Feature`
 * section (the failure mode the rule prevents) fails this test until the
 * allow-list below is deliberately updated.
 */
const ALLOWED_HEADINGS = new Set(['## paqad in your chat', '## Decision Pause Contract']);

function topLevelHeadings(content: string): string[] {
  return content
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.trim());
}

describe('agent entry files stay minimal', () => {
  for (const type of ADAPTER_TYPES) {
    it(`${type}: entry-file headings are a subset of the allow-list`, async () => {
      const adapter = AdapterFactory.create(type);
      const projectRoot = mkdtempSync(join(tmpdir(), `paqad-entry-min-${type}-`));
      const files = await adapter.generateConfig({
        frameworkPath: '.paqad/framework-path.txt',
        rulesPath: 'docs/instructions/rules',
        projectRoot,
      });

      // The entry file is the one at the adapter's config path (other files an
      // adapter may emit — e.g. a native hook JSON — are not entry files).
      const entry = files.find((file) => file.path === adapter.getConfigPath());
      expect(entry, `${type} must emit its entry file (${adapter.getConfigPath()})`).toBeDefined();

      const headings = topLevelHeadings(entry!.content);
      const disallowed = headings.filter((heading) => !ALLOWED_HEADINGS.has(heading));
      expect(
        disallowed,
        `${type} entry file has non-allow-listed section(s): ${disallowed.join(', ')}. ` +
          `Entry files stay minimal — put new behaviour in the framework, not the entry file.`,
      ).toEqual([]);
    });
  }
});
