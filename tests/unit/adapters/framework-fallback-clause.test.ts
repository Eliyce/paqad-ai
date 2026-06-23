import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AdapterFactory } from '@/adapters';
import { buildFrameworkFallbackClause } from '@/adapters/shared/framework-fallback-clause.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';

// Issue #220 — every host entry file carries one core-owned graceful-degradation
// clause so an absent/disabled paqad never hard-fails a hook-less IDE
// (PhpStorm/Junie et al.). It must be byte-identical across hosts and must NOT
// be a `##` heading (it stays inside the entry-file heading allow-list — see
// entry-file-minimal.test.ts).

describe('entry-file framework fallback clause', () => {
  const clause = buildFrameworkFallbackClause();

  it('mentions the degrade-to-vanilla contract', () => {
    expect(clause).toContain('proceed as a normal assistant');
    expect(clause).toContain('Do not block');
    expect(clause).toContain('disabled');
    expect(clause).not.toContain('## ');
  });

  for (const type of ADAPTER_TYPES) {
    it(`${type}: entry file contains the identical clause`, async () => {
      const adapter = AdapterFactory.create(type);
      const projectRoot = mkdtempSync(join(tmpdir(), `paqad-fallback-${type}-`));
      const files = await adapter.generateConfig({
        frameworkPath: '.paqad/framework-path.txt',
        rulesPath: 'docs/instructions/rules',
        projectRoot,
      });
      const entry = files.find((file) => file.path === adapter.getConfigPath());
      expect(entry, `${type} must emit its entry file`).toBeDefined();
      expect(entry!.content).toContain(clause);
    });
  }
});
