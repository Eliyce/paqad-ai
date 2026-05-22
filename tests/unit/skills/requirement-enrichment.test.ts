import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/base/skills/requirement-enrichment';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('requirement-enrichment', () => {
  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid 3-section block in the canonical order', () => {
      const ok = [
        '## Confirmed Requirements',
        '- one',
        '## Assumptions',
        '- two',
        '## Open Questions',
        '- three',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when any of the 3 sections missing', () => {
      const noConf = runScript(path, [], { input: '## Assumptions\n## Open Questions\n' });
      expect(noConf.status).toBe(1);
      expect(noConf.stderr).toMatch(/Confirmed Requirements/);

      const noAssum = runScript(path, [], {
        input: '## Confirmed Requirements\n## Open Questions\n',
      });
      expect(noAssum.status).toBe(1);
      expect(noAssum.stderr).toMatch(/Assumptions/);

      const noOpen = runScript(path, [], { input: '## Confirmed Requirements\n## Assumptions\n' });
      expect(noOpen.status).toBe(1);
      expect(noOpen.stderr).toMatch(/Open Questions/);
    });

    it('fails when sections are out of canonical order', () => {
      const out = '## Open Questions\n- a\n## Confirmed Requirements\n- b\n## Assumptions\n- c\n';
      const r = runScript(path, [], { input: out });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/order/);
    });

    it('exits 2 on missing input file', () => {
      expect(runScript(path, ['/no/such/file']).status).toBe(2);
    });
  });

  describe('assets', () => {
    it('operational-checklist.txt is non-empty unique vocabulary', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/operational-checklist.txt'), 'utf8');
      const tokens = text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.split(/\s+/, 1)[0]);
      expect(tokens.length).toBeGreaterThan(5);
      expect(new Set(tokens).size).toBe(tokens.length);
    });
  });
});
