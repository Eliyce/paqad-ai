import { readFileSync } from 'node:fs';

import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

describe('shipped guidance uses paqad-ai, not npx paqad-ai', () => {
  it('leaves no npx paqad-ai outside the router fallback sentence', async () => {
    const files = await fg(['src/**/*.ts', 'runtime/**/*.{md,mjs,ts,hbs}'], {
      cwd: process.cwd(),
      absolute: true,
      ignore: ['**/node_modules/**'],
    });

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (!content.includes('npx paqad-ai')) continue;
      for (const line of content.split('\n')) {
        if (line.includes('npx paqad-ai') && !line.includes('is not found, use')) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('ships the router fallback sentence exactly once', async () => {
    const router = readFileSync('runtime/AGENT-ROUTER.md', 'utf8');
    const matches = router.match(/use `npx paqad-ai` instead/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
