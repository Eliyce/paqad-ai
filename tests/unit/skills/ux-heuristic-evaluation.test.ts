import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/coding/skills/ux-heuristic-evaluation';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('ux-heuristic-evaluation', () => {
  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes valid block with both buckets', () => {
      const ok = '## Blocking Issues\n- x\n## Improvement Opportunities\n- y\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('passes "<bucket>: none" literal form', () => {
      const ok = 'Blocking Issues: none\nImprovement Opportunities: none\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when a bucket missing', () => {
      const r = runScript(path, [], { input: '## Blocking Issues\n- x\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Improvement Opportunities/);
    });
  });

  describe('assets', () => {
    it('heuristics.txt enumerates non-empty unique heuristics', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/heuristics.txt'), 'utf8');
      const tokens = text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.split(/\s+/, 1)[0]);
      expect(tokens.length).toBeGreaterThanOrEqual(8);
      expect(new Set(tokens).size).toBe(tokens.length);
    });
  });
});
