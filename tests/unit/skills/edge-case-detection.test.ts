import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/base/skills/edge-case-detection';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('edge-case-detection', () => {
  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes the empty short-circuit literal', () => {
      const r = runScript(path, [], { input: 'No Additional Edge Cases\n' });
      expect(r.status).toBe(0);
    });

    it('passes a valid block with required segments per case', () => {
      const ok = [
        '## Edge Cases',
        '### Empty cart',
        '- **Scenario:** user with no items submits',
        '- **Why It Matters:** API returns 200 silently',
        '- **Apply To:** AC-1.2; tests/checkout.test.ts',
        '### Stale price',
        '- **Scenario:** cached price older than 24h',
        '- **Why It Matters:** customer charged the wrong amount',
        '- **Apply To:** invoices.created event handler',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when "## Edge Cases" missing', () => {
      const r = runScript(path, [], { input: '### x\n- **Scenario:** y\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Edge Cases/);
    });

    it('fails when no "### ..." case headings present', () => {
      const r = runScript(path, [], { input: '## Edge Cases\n- some prose\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/no "### \.{3}" case headings/);
    });

    it('fails when a case is missing any of the 3 required segments', () => {
      // Two cases but only one Apply To: → fewer
      const bad = [
        '## Edge Cases',
        '### Case A',
        '- **Scenario:** s',
        '- **Why It Matters:** w',
        '- **Apply To:** t',
        '### Case B',
        '- **Scenario:** s',
        '- **Why It Matters:** w',
      ].join('\n');
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Apply To:/);
    });

    it('exits 2 on missing input file', () => {
      expect(runScript(path, ['/no/such/file']).status).toBe(2);
    });
  });

  describe('assets', () => {
    it('categories.txt is non-empty unique vocabulary', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/categories.txt'), 'utf8');
      const tokens = text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.split(/\s+/, 1)[0]);
      expect(tokens.length).toBeGreaterThan(5);
      expect(new Set(tokens).size).toBe(tokens.length);
    });
  });
});
