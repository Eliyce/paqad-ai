import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { generateProjectRules } from '@/onboarding/rule-generator.js';

describe('AC-54 onboarding copies the default rules from the packs', () => {
  it('AC-54 writes each pack rule under docs/instructions/rules unchanged', async () => {
    const base = join(process.cwd(), 'runtime/base/rules');
    const name = readdirSync(base).find((file) => file.endsWith('.md'))!;
    const files = await generateProjectRules([
      { path: join(base, name), level: 0, source: `base/rules/${name}` },
      {
        path: join(base, name),
        level: 1,
        source: 'capabilities/coding/rules/testing/guide.md',
      },
    ]);
    expect(files.map((file) => file.path.split('\\').join('/'))).toEqual([
      `docs/instructions/rules/_shared/${name}`,
      'docs/instructions/rules/coding/testing.md',
    ]);
    expect(files[0]!.content).toBe(readFileSync(join(base, name), 'utf8'));
    expect(files.every((file) => file.autoUpdate === false)).toBe(true);
  });
});
