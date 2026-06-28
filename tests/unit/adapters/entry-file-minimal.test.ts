import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AdapterFactory } from '@/adapters';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';

/**
 * Enforces `docs/instructions/rules/coding/agent-entry-files.md` (issue #229): a
 * host entry file is a LEAN stub — a bootstrap pointer + the graceful-degradation
 * fallback clause + the `Adapter:` footer, with ZERO `##` sections. The load order
 * and BOTH contracts live only in the install bootstrap, behind its enablement
 * check, so the always-injected entry file carries none of them. This is what
 * makes a disabled project load no framework docs on every provider.
 */
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

      // The entry file is the one at the adapter's config path (other files an
      // adapter may emit — e.g. a native hook JSON — are not entry files).
      const entry = files.find((file) => file.path === adapter.getConfigPath());
      expect(entry, `${type} must emit its entry file (${adapter.getConfigPath()})`).toBeDefined();
      const content = entry!.content;

      // Zero `##` sections — the allow-list is empty for a lean stub.
      expect(
        topLevelHeadings(content),
        `${type} entry file must have no \`##\` sections — put behaviour in the framework bootstrap.`,
      ).toEqual([]);

      // Points to the bootstrap, carries the fallback clause and the Adapter footer.
      expect(content).toContain('.paqad/framework-path.txt');
      expect(content).toContain('AGENT-BOOTSTRAP.md');
      expect(content).toContain('Adapter:');

      // Names no docs load order and inlines neither contract.
      expect(content).not.toContain('docs/instructions');
      expect(content).not.toContain('docs/modules');
      expect(content).not.toContain('Decision Pause Contract');
      expect(content).not.toContain('narration contract');

      // Carries no "Use this file as the … entrypoint …" decoration line — the
      // host already auto-injects the file, so restating its purpose is dead
      // weight a lean stub must not carry.
      expect(
        content,
        `${type} entry file must not restate that it is the entrypoint — the host injects it already.`,
      ).not.toMatch(/Use this file as the .*entrypoint/i);
    });
  }
});
