import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/rollback-safety-planner';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('rollback-safety-planner', () => {
  describe('select-stories.sh', () => {
    const path = sh('select-stories.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 1 when plan file missing', () => {
      const r = runScript(path, ['/no/such/plan.md']);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/story plan not found/);
    });

    it('selects stories with reversibility: hard', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'plan.md',
          [
            '### S-1 — easy story',
            'reversibility: easy',
            'blast-radius: isolated',
            '',
            '### S-2 — hard story',
            'reversibility: hard',
            'blast-radius: isolated',
          ].join('\n'),
        );
        const r = runScript(path, [f]);
        expect(lines(r.stdout)).toEqual(['S-2']);
      });
    });

    it('selects stories with blast-radius: wide', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'plan.md',
          [
            '### S-1 — narrow',
            'reversibility: easy',
            'blast-radius: isolated',
            '',
            '### S-2 — wide',
            'reversibility: easy',
            'blast-radius: wide',
          ].join('\n'),
        );
        const r = runScript(path, [f]);
        expect(lines(r.stdout)).toEqual(['S-2']);
      });
    });

    it('selects ALL stories when workflow=migration', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'plan.md',
          [
            '### S-1 — easy',
            'reversibility: easy',
            'blast-radius: isolated',
            '',
            '### S-2 — easy',
            'reversibility: easy',
            'blast-radius: isolated',
          ].join('\n'),
        );
        const r = runScript(path, [f, 'migration']);
        expect(lines(r.stdout)).toEqual(['S-1', 'S-2']);
      });
    });

    it('emits empty stdout when no stories qualify', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'plan.md',
          '### S-1 — easy\nreversibility: easy\nblast-radius: isolated\n',
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('returns sorted unique ids', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'plan.md',
          [
            '### S-3 — wide',
            'blast-radius: wide',
            '### S-1 — hard',
            'reversibility: hard',
            '### S-2 — wide',
            'blast-radius: wide',
          ].join('\n'),
        );
        const r = runScript(path, [f]);
        expect(lines(r.stdout)).toEqual(['S-1', 'S-2', 'S-3']);
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes the empty short-circuit literal', () => {
      const r = runScript(path, [], {
        input:
          'Rollback Plans: none required (all stories have easy reversibility and isolated blast radius).\n',
      });
      expect(r.status).toBe(0);
    });

    it('passes a valid plan with all 5 required field lines', () => {
      const ok = [
        '## Rollback Plans',
        '### S-1 — flag rollout',
        '- **Trigger:** alarm fires',
        '- **Time-to-rollback:** ≤ 5 min',
        '- **Steps:** disable flag, verify',
        '- **Verification:** dashboard shows OK',
        '- **Drill:** monthly',
        'Coverage: Stories needing rollback plans: 1 | Plans drafted: 1 | Open Questions: 0',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when any required field missing per plan', () => {
      const missingDrill = [
        '## Rollback Plans',
        '### S-1',
        '- **Trigger:** x',
        '- **Time-to-rollback:** y',
        '- **Steps:** z',
        '- **Verification:** w',
        'Coverage: Stories needing rollback plans: 1 | Plans drafted: 1 | Open Questions: 0',
      ].join('\n');
      const r = runScript(path, [], { input: missingDrill });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Drill:/);
    });

    it('fails when Coverage footer missing or malformed', () => {
      const r = runScript(path, [], {
        input:
          '## Rollback Plans\n### S-1\n- **Trigger:** x\n- **Time-to-rollback:** y\n- **Steps:** z\n- **Verification:** w\n- **Drill:** v\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Coverage:/);
    });
  });
});
