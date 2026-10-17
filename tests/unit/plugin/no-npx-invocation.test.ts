import { readFileSync } from 'node:fs';

import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

// Issue #616, Part 6 (AC-8): the plugin puts `paqad-ai` on PATH, so the shipped source and runtime
// tell the agent to run `paqad-ai …`, never `npx paqad-ai …`. The ONE allowed exception is the
// router's fallback sentence ("If `paqad-ai` is not found, use `npx paqad-ai` instead."), which
// exists for npm/advisory hosts where it is not on PATH — so every surviving `npx paqad-ai` must
// be that fallback line.
describe('shipped guidance uses paqad-ai, not npx paqad-ai (issue #616)', () => {
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
        // The fallback sentence is the one allowed `npx paqad-ai`. Match it by a backtick-free
        // phrase so it is recognised both in the rendered router and in the escaped TS source.
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
