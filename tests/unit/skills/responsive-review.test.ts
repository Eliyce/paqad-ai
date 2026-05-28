import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/coding/skills/responsive-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('responsive-review', () => {
  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a responsive finding', () => {
      const body = [
        '## Findings',
        '- **high** (responsive.md → breakpoint:sm) — auth / responsive: horizontal scroll at 640px. Evidence: `src/Pricing.tsx:18`. Required action: wrap cards below sm.',
      ].join('\n');
      expect(runScript(path, [], { input: body }).status).toBe(0);
    });

    it('rejects empty Findings block', () => {
      const r = runScript(path, [], { input: '## Findings\n' });
      expect(r.status).toBe(1);
    });
  });
});
