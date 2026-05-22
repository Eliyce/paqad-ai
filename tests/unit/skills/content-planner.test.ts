import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/content/skills/content-planner';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('content-planner', () => {
  describe('lint-brief.sh', () => {
    const path = sh('lint-brief.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a brief with all required fields', () => {
      const ok = [
        '# Brief',
        '- **Audience:** founders',
        '- **Goal:** book a call',
        '- **Constraints:** ≤ 700 words',
        '- **Dependencies:** none',
        '- **Success metric:** 3 calls/wk',
        '## Outline',
        '1. hook',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails for each missing field', () => {
      for (const drop of [
        'Audience:',
        'Goal:',
        'Constraints:',
        'Outline',
        'Dependencies:',
        'Success metric:',
      ]) {
        const fields: Record<string, string> = {
          'Audience:': '- **Audience:** founders',
          'Goal:': '- **Goal:** book a call',
          'Constraints:': '- **Constraints:** ≤ 700 words',
          'Dependencies:': '- **Dependencies:** none',
          'Success metric:': '- **Success metric:** 3/wk',
          Outline: '## Outline\n1. hook',
        };
        const lines = Object.entries(fields)
          .filter(([k]) => k !== drop)
          .map(([, v]) => v);
        const body = lines.join('\n') + '\n';
        const r = runScript(path, [], { input: body });
        expect(r.status, `dropping ${drop}`).toBe(1);
        expect(r.stderr).toMatch(new RegExp(drop));
      }
    });

    it('exits 2 on missing input file', () => {
      expect(runScript(path, ['/no/such/file']).status).toBe(2);
    });
  });
});
