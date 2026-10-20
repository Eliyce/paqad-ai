import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AdapterFactory } from '@/adapters';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';

function topLevelHeadings(content: string): string[] {
  return content
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.trim());
}

describe('agent entry files stay lean', () => {
  for (const type of ADAPTER_TYPES) {
    it(`${type}: entry file is a lean bootstrap stub`, async () => {
      const adapter = AdapterFactory.create(type);
      const projectRoot = mkdtempSync(join(tmpdir(), `paqad-entry-min-${type}-`));
      const files = await adapter.generateConfig({
        frameworkPath: '.paqad/framework-path.txt',
        rulesPath: 'docs/instructions/rules',
        projectRoot,
      });

      const entry = files.find((file) => file.path === adapter.getConfigPath());
      expect(entry, `${type} must emit its entry file (${adapter.getConfigPath()})`).toBeDefined();
      const content = entry!.content;

      expect(
        topLevelHeadings(content),
        `${type} entry file must have no \`##\` sections — put behaviour in the framework bootstrap.`,
      ).toEqual([]);

      expect(content).toContain('.paqad/framework-path.txt');
      expect(content).toContain('AGENT-BOOTSTRAP.md');
      expect(content).toContain('Adapter:');

      expect(content).not.toContain('docs/instructions');
      expect(content).not.toContain('docs/modules');
      expect(content).not.toContain('Decision Pause Contract');
      expect(content).not.toContain('narration contract');

      expect(
        content,
        `${type} entry file must not restate that it is the entrypoint — the host injects it already.`,
      ).not.toMatch(/Use this file as the .*entrypoint/i);
    });
  }
});
