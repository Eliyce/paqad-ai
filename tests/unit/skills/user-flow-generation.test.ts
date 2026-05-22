import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/coding/skills/user-flow-generation';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('user-flow-generation', () => {
  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid block with ordered Primary Flow', () => {
      const ok = [
        '## Primary Flow',
        '1. user clicks invite',
        '2. system sends email',
        '3. user accepts',
        '## Alternate Paths',
        '### Error',
        '1. provider returns 500',
        '## Flow Gaps',
        '- none',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when Primary Flow has no ordered list items', () => {
      const r = runScript(path, [], {
        input: '## Primary Flow\nsome prose\n## Alternate Paths\n## Flow Gaps\n- none\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/ordered list/);
    });

    it('fails when "## Primary Flow" missing', () => {
      const r = runScript(path, [], { input: '## Alternate Paths\n## Flow Gaps\n- none\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Primary Flow/);
    });

    it('passes "Flow Gaps: none" literal as alternative to section', () => {
      const ok = ['## Primary Flow', '1. step', '## Alternate Paths', 'Flow Gaps: none'].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });
  });

  describe('assets', () => {
    it('branch-categories.txt enumerates the alternate-path vocabulary', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/branch-categories.txt'), 'utf8');
      const tokens = text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.split(/\s+/, 1)[0]);
      expect(tokens.length).toBeGreaterThanOrEqual(5);
      expect(new Set(tokens).size).toBe(tokens.length);
    });
  });
});
