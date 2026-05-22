import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('runtime patterns', () => {
  it('all benchmark patterns have the required format', async () => {
    const files = (
      await fg('runtime/capabilities/coding/benchmarks/patterns/*.md', {
        cwd: process.cwd(),
        absolute: true,
      })
    ).sort();

    expect(files).toHaveLength(8);

    for (const file of files) {
      const content = await readFile(file, 'utf8');
      expect(content).toContain('## Problem');
      expect(content).toContain('## Pattern');
    }
  });
});
