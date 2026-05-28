import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/coding/skills/copy-and-ia-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('copy-and-ia-review', () => {
  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a copy finding citing patterns.md', () => {
      const body = [
        '## Findings',
        '- **medium** (patterns.md → terminology) — auth / copy: User vs Member mismatch. Evidence: `src/Settings.tsx:42`. Required action: standardize on Member.',
      ].join('\n');
      expect(runScript(path, [], { input: body }).status).toBe(0);
    });

    it('rejects when Findings heading is missing', () => {
      const r = runScript(path, [], { input: '- nope' });
      expect(r.status).toBe(1);
    });
  });
});
