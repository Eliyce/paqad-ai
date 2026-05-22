import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/coding/skills/root-cause-analysis';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('root-cause-analysis', () => {
  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes the canonical 8-section RCA', () => {
      const ok = [
        '## Problem Statement',
        'x',
        '## Symptoms & Impact',
        '- y',
        '## Timeline',
        '- 12:00 — z',
        '## Evidence',
        '- log.txt:1',
        '## Root Cause',
        'cause',
        '## Contributing Factors',
        '- factor',
        '## Solution',
        'fix',
        '## Verification & Follow-Up',
        '- check',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when any section missing', () => {
      const r = runScript(path, [], { input: '## Problem Statement\n## Solution\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Symptoms & Impact|Timeline|Evidence|Root Cause/);
    });

    it('fails when sections are out of canonical order', () => {
      const out = [
        '## Solution',
        'x',
        '## Problem Statement',
        'y',
        '## Symptoms & Impact',
        '- z',
        '## Timeline',
        '- t',
        '## Evidence',
        '- e',
        '## Root Cause',
        'rc',
        '## Contributing Factors',
        '- f',
        '## Verification & Follow-Up',
        '- v',
      ].join('\n');
      const r = runScript(path, [], { input: out });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/out of order/i);
    });

    it('always requires "## Solution" even when remediation is proposed', () => {
      const out = [
        '## Problem Statement',
        '## Symptoms & Impact',
        '## Timeline',
        '## Evidence',
        '## Root Cause',
        '## Contributing Factors',
        '## Verification & Follow-Up',
      ].join('\n');
      const r = runScript(path, [], { input: out });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Solution/);
    });
  });

  describe('assets', () => {
    it('section-order.txt is the 8 canonical RCA sections', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/section-order.txt'), 'utf8');
      const sections = text.split('\n').filter((l) => l.trim());
      expect(sections).toEqual([
        'Problem Statement',
        'Symptoms & Impact',
        'Timeline',
        'Evidence',
        'Root Cause',
        'Contributing Factors',
        'Solution',
        'Verification & Follow-Up',
      ]);
    });
  });
});
