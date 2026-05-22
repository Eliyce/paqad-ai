import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/capabilities/security/skills/finding-normalizer';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('finding-normalizer', () => {
  describe('validate-findings.sh', () => {
    const path = sh('validate-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid array of findings', () => {
      const ok = JSON.stringify([
        {
          id: 'PT-1',
          title: 'XSS',
          severity: 'high',
          effort: 'small',
          impact_area: 'comments',
          evidence: 'src/c.ts:1',
          reproduction: '1. open URL...',
          status: 'open',
        },
      ]);
      const r = runScript(path, [], { input: ok });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('ok');
    });

    it('rejects invalid JSON', () => {
      const r = runScript(path, [], { input: 'not json' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/invalid JSON/);
    });

    it('rejects non-array JSON', () => {
      const r = runScript(path, [], { input: '{}' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/expected JSON array/);
    });

    it('rejects findings missing required fields', () => {
      const bad = JSON.stringify([{ id: 'PT-1' }]);
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/missing/);
    });

    it('rejects out-of-vocab severity / effort / status', () => {
      const bad = JSON.stringify([
        {
          id: 'PT-1',
          title: 'x',
          severity: 'catastrophic',
          effort: 'small',
          impact_area: 'a',
          evidence: 'b',
          reproduction: 'c',
          status: 'open',
        },
      ]);
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/bad severity catastrophic/);
    });

    it('rejects duplicate ids', () => {
      const dup = JSON.stringify([
        {
          id: 'PT-1',
          title: 'a',
          severity: 'high',
          effort: 'small',
          impact_area: 'x',
          evidence: 'y',
          reproduction: 'z',
          status: 'open',
        },
        {
          id: 'PT-1',
          title: 'b',
          severity: 'low',
          effort: 'trivial',
          impact_area: 'x',
          evidence: 'y',
          reproduction: 'z',
          status: 'open',
        },
      ]);
      const r = runScript(path, [], { input: dup });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/duplicate id/);
    });

    it('accepts every status from the vocabulary', () => {
      for (const status of ['open', 'fixed', 'wont-fix', 'blocked', 'retest-pass', 'retest-fail']) {
        const arr = JSON.stringify([
          {
            id: 'PT-' + status,
            title: 'a',
            severity: 'low',
            effort: 'trivial',
            impact_area: 'x',
            evidence: 'y',
            reproduction: 'z',
            status,
          },
        ]);
        expect(runScript(path, [], { input: arr }).status, `status ${status}`).toBe(0);
      }
    });
  });

  describe('assets', () => {
    it('vocabulary.txt enumerates the closed sets used by the validator', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/vocabulary.txt'), 'utf8');
      // sanity check: includes critical + open + small
      expect(text).toContain('critical');
      expect(text).toContain('open');
      expect(text).toContain('small');
    });
  });
});
