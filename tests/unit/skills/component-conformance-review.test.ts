import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/coding/skills/component-conformance-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('component-conformance-review', () => {
  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a well-formed component finding', () => {
      const body = [
        '## Findings',
        '- **high** (components.md → Button) — auth / component: variant `ghost` declared but not implemented. Evidence: `src/Button.tsx:1`. Required action: add `variant: ghost`.',
      ].join('\n');
      const r = runScript(path, [], { input: body });
      expect(r.status).toBe(0);
    });

    it('rejects findings without a contract_ref or evidence', () => {
      const body = ['## Findings', '- **high** — component: bad. Required action: fix.'].join('\n');
      const r = runScript(path, [], { input: body });
      expect(r.status).toBe(1);
    });
  });
});
