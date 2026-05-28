import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/coding/skills/design-system-sync';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('design-system-sync', () => {
  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a sync proposal cast as a finding block when used in the design-test workflow', () => {
      // design-system-sync's primary output is a proposal block (not a
      // findings list), but when it runs inside design-test it can emit a
      // documentation-drift finding pointing at a missing contract clause.
      const body = [
        '## Findings',
        '- **medium** (tokens.md → color.brand) — auth / documentation-drift: brand token used in code but undeclared. Evidence: `tailwind.config.ts:12`. Required action: append `color.brand = #abcdef` to tokens.md.',
      ].join('\n');
      expect(runScript(path, [], { input: body }).status).toBe(0);
    });

    it('rejects malformed findings', () => {
      const r = runScript(path, [], { input: '## Findings\n- nope' });
      expect(r.status).toBe(1);
    });
  });
});
