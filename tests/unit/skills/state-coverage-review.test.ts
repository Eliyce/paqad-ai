import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/coding/skills/state-coverage-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('state-coverage-review', () => {
  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a well-formed state finding', () => {
      const body = [
        '## Findings',
        '- **high** (components.md → Button > focus) — auth / state: focus state not implemented. Evidence: `src/Button.tsx:1`. Required action: add focus-visible ring.',
      ].join('\n');
      expect(runScript(path, [], { input: body }).status).toBe(0);
    });

    it('rejects findings with no Findings heading', () => {
      const r = runScript(path, [], { input: '- nope' });
      expect(r.status).toBe(1);
    });
  });
});
