import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/diff-minimizer';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('diff-minimizer', () => {
  describe('extract-ac-ids.sh', () => {
    const path = sh('extract-ac-ids.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 with usage when no file passed', () => {
      const r = runScript(path);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/usage:/i);
    });

    it('exits 2 when file missing', () => {
      const r = runScript(path, ['/no/such/file.md']);
      expect(r.status).toBe(2);
    });

    it('extracts sorted dedup AC ids from a real spec', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'ac.md', '### AC-2.1\nx\n### AC-1.1\ny\n### AC-1.2\nz\n');
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(lines(r.stdout)).toEqual(['AC-1.1', 'AC-1.2', 'AC-2.1']);
      });
    });

    it('returns empty stdout (exit 0) when spec has no AC ids', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'ac.md', '# Spec\n\nNo criteria yet.\n');
        const r = runScript(path, [f]);
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

    it('passes a valid block with allowed classifications and Open Questions: none', () => {
      const ok = [
        '## Diff Minimization',
        '### Step Map',
        '| # | Step | Classification | Mapped AC | Action |',
        '| --- | --- | --- | --- | --- |',
        '| 1 | add column | ac-satisfying | AC-1.1 | keep |',
        '| 2 | redundant try/catch | scaffolding | — | drop — error already surfaces |',
        '| 3 | extract repo class | over-build | — | drop — used once |',
        '| 4 | migration | necessary-setup | step 1 | keep |',
        '### Recommended Drops',
        '- step 2',
        '- step 3',
        '### Necessary Setup (justified)',
        '- step 4',
        'Open Questions: none',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('rejects an unknown classification', () => {
      const bad = [
        '## Diff Minimization',
        '### Step Map',
        '| # | Step | Classification | Mapped AC | Action |',
        '| --- | --- | --- | --- | --- |',
        '| 1 | x | refactor | — | drop |',
        '### Recommended Drops',
        '### Necessary Setup',
        'Open Questions: none',
      ].join('\n');
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/unknown classification: refactor/);
    });

    it('accepts every classification from the rubric', () => {
      for (const cls of ['ac-satisfying', 'necessary-setup', 'scaffolding', 'over-build']) {
        const block = [
          '## Diff Minimization',
          '### Step Map',
          '| # | Step | Classification | Mapped AC | Action |',
          '| --- | --- | --- | --- | --- |',
          `| 1 | x | ${cls} | — | y |`,
          '### Recommended Drops',
          '### Necessary Setup',
          'Open Questions: none',
        ].join('\n');
        expect(runScript(path, [], { input: block }).status, `cls ${cls}`).toBe(0);
      }
    });

    it('fails when canonical 5-column Step Map header missing', () => {
      const r = runScript(path, [], {
        input:
          '## Diff Minimization\n### Step Map\n| # | Step |\n### Recommended Drops\n### Necessary Setup\nOpen Questions: none\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/canonical 5-column header/);
    });

    it('fails when "Open Questions" section / exact line missing', () => {
      const r = runScript(path, [], {
        input:
          '## Diff Minimization\n### Step Map\n| # | Step | Classification | Mapped AC | Action |\n| --- | --- | --- | --- | --- |\n### Recommended Drops\n### Necessary Setup\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Open Questions/);
    });
  });

  describe('assets', () => {
    it('classifications.txt vocabulary aligns with lint accepted set', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/classifications.txt'), 'utf8');
      const tokens = text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.split(/\s+/, 1)[0]);
      expect(new Set(tokens)).toEqual(
        new Set(['ac-satisfying', 'necessary-setup', 'scaffolding', 'over-build']),
      );
    });
  });
});
