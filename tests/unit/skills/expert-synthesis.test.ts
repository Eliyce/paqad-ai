import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/base/skills/expert-synthesis';
const sh = (n: string) => join(SKILL, 'scripts', n);

const VALID = JSON.stringify({
  verdict: 'ready',
  accepted: ['EX-db-expert-1'],
  declined: [],
  conflicts: [],
  gaps: [],
  questions: [],
  tokens: 100,
});

describe('expert-synthesis', () => {
  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 when the file is missing', () => {
      expect(runScript(path, ['/no/such/file.json']).status).toBe(2);
    });

    it('passes a valid synthesis artifact', () => {
      const r = runScript(path, [], { input: VALID });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('ok');
    });

    it('fails a bad verdict', () => {
      const bad = JSON.stringify({ ...JSON.parse(VALID), verdict: 'maybe' });
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/verdict/);
    });

    it('fails a declined row without a reason', () => {
      const bad = JSON.stringify({
        ...JSON.parse(VALID),
        declined: [{ id: 'EX-db-expert-1', reason: '' }],
      });
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/needs a reason/);
    });

    it('fails when an array field is missing', () => {
      const bad = JSON.stringify({ verdict: 'ready', accepted: [] });
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/must be an array/);
    });

    it('fails invalid JSON', () => {
      expect(runScript(path, [], { input: 'nope' }).status).toBe(1);
    });
  });
});
