import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/test-per-ac-planner';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('test-per-ac-planner', () => {
  describe('extract-ac-ids.sh', () => {
    const path = sh('extract-ac-ids.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 when ac-file missing', () => {
      const r = runScript(path, ['/no/such/file.md']);
      expect(r.status).toBe(2);
    });

    it('extracts sorted dedup AC ids', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'ac.md', '### AC-2.1\n### AC-1.1\n### AC-1.2\n### AC-2.1\n');
        expect(lines(runScript(path, [f]).stdout)).toEqual(['AC-1.1', 'AC-1.2', 'AC-2.1']);
      });
    });

    it('returns empty stdout (exit 0) when ac-file has no ACs', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'ac.md', '# spec without criteria\n');
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });
  });

  describe('check-coverage.sh', () => {
    const path = sh('check-coverage.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 when args missing', () => {
      expect(runScript(path).status).toBe(2);
    });

    it('returns AC ids in spec but missing from plan', () => {
      withTempDir((dir) => {
        const ac = writeFile(dir, 'ac.md', '### AC-1.1\n### AC-1.2\n### AC-2.1\n');
        const plan = writeFile(dir, 'plan.md', '### AC-1.1 → T1.1\n');
        const r = runScript(path, [ac, plan]);
        expect(r.status).toBe(0);
        expect(lines(r.stdout)).toEqual(['AC-1.2', 'AC-2.1']);
      });
    });

    it('returns empty when every AC is covered', () => {
      withTempDir((dir) => {
        const ac = writeFile(dir, 'ac.md', '### AC-1.1\n### AC-1.2\n');
        const plan = writeFile(dir, 'plan.md', '### AC-1.1 → T1.1\n### AC-1.2 → T1.2\n');
        const r = runScript(path, [ac, plan]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('survives empty ac-file or plan-file', () => {
      withTempDir((dir) => {
        const ac = writeFile(dir, 'ac.md', '');
        const plan = writeFile(dir, 'plan.md', '');
        const r = runScript(path, [ac, plan]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid block with canonical 5-col table', () => {
      const ok = [
        '## Verification Plan',
        '### AC-1.1 → T1.1, T1.2',
        '| Test ID | Layer | File | Case | Notes |',
        '| --- | --- | --- | --- | --- |',
        '| T1.1 | unit | tests/x.ts | happy | name "AC-1.1 — y" |',
        '| T1.2 | unit | tests/x.ts | dup | name "AC-1.1 — dup" |',
        '## Uncovered Criteria',
        '- AC-2.1: needs staging',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when T-id parent does not match its AC parent', () => {
      const bad = [
        '## Verification Plan',
        '### AC-1.1 → T2.1',
        '| Test ID | Layer | File | Case | Notes |',
        '| --- | --- | --- | --- | --- |',
        '| T2.1 | unit | t.ts | x | y |',
        '## Uncovered Criteria',
        '- none',
      ].join('\n');
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/T-id T2\.1 not under that AC|AC-1\.1/);
    });

    it('fails when section headings missing', () => {
      const r = runScript(path, [], { input: '### AC-1.1\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Verification Plan/);
    });
  });
});
