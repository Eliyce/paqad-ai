import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXPERT_ROLES } from '@/spec-pipeline/experts/roster.js';
import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/base/skills/expert-notes';
const sh = (n: string) => join(SKILL, 'scripts', n);

const VALID = JSON.stringify({
  notes: [
    {
      role: 'db-expert',
      findings: [
        { target: 'invoices', claim: 'index customer_id', kind: 'requirement', severity: 'must' },
      ],
      questions: [],
    },
  ],
  tokens: { 'db-expert': 900 },
});

describe('expert-notes', () => {
  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 when the file is missing', () => {
      expect(runScript(path, ['/no/such/file.json']).status).toBe(2);
    });

    it('passes a valid notes artifact', () => {
      const r = runScript(path, [], { input: VALID });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('ok');
    });

    it('fails invalid JSON', () => {
      expect(runScript(path, [], { input: '{not json' }).status).toBe(1);
    });

    it('fails a missing notes[] array', () => {
      const r = runScript(path, [], { input: JSON.stringify({ tokens: {} }) });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/notes\[\] array/);
    });

    it('fails a finding without a target and an unknown kind', () => {
      const bad = JSON.stringify({
        notes: [{ role: 'db-expert', findings: [{ claim: 'c', kind: 'wish' }] }],
        tokens: {},
      });
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/needs a target/);
      expect(r.stderr).toMatch(/unknown kind/);
    });

    it('fails a non-array questions field', () => {
      const bad = JSON.stringify({
        notes: [{ role: 'db-expert', findings: [], questions: 'nope' }],
        tokens: {},
      });
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/questions must be an array/);
    });
  });

  it('ships a lens file for every pickable expert role (AC-17)', () => {
    const missing = EXPERT_ROLES.filter(
      (role) => !existsSync(join(SKILL, 'references', 'lenses', `${role}.md`)),
    );
    expect(missing, `missing lens files: ${missing.join(', ')}`).toEqual([]);
  });
});
