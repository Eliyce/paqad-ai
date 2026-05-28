import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/coding/skills/accessibility-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('accessibility-review', () => {
  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a finding citing a WCAG id as contract_ref', () => {
      const body = [
        '## Findings',
        '- **blocker** (WCAG-2.2-1.4.3) — auth / a11y: contrast 3.8:1. Evidence: `src/Button.tsx:34`. Required action: darken `color.text.muted`.',
      ].join('\n');
      expect(runScript(path, [], { input: body }).status).toBe(0);
    });

    it('rejects a finding with no WCAG id and no contract file', () => {
      const body = [
        '## Findings',
        '- **high** — a11y: bad. Evidence: `src/Button.tsx:34`. Required action: fix.',
      ].join('\n');
      const r = runScript(path, [], { input: body });
      expect(r.status).toBe(1);
    });
  });
});
