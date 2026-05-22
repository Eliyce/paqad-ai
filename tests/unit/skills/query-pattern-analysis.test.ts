import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/coding/skills/query-pattern-analysis';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('query-pattern-analysis', () => {
  describe('scan-query-risks.sh', () => {
    const path = sh('scan-query-risks.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 with usage when no files', () => {
      expect(runScript(path).status).toBe(2);
    });

    it('emits header only on clean files', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.ts', 'const x = 1;');
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('risk | file:line | excerpt');
      });
    });

    it('detects ORM .find / .findOne candidates', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'a.ts',
          'const u = await User.findOne({ id });\nconst all = await User.find();',
        );
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('orm-find-inside-loop-candidate');
      });
    });

    it('detects await inside .map', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.ts', 'items.map(async (i) => await fetch(i));');
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('await-inside-map');
      });
    });

    it('detects SELECT * over-fetching', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'q.sql', 'SELECT * FROM users;');
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('over-fetching-select-star');
      });
    });

    it('detects unbounded pagination (limit:0 / LIMIT 0)', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.ts', 'const r = await q({ limit: 0 });');
        const g = writeFile(dir, 'b.sql', 'SELECT id FROM users LIMIT 0;');
        const r = runScript(path, [f, g]);
        expect(r.stdout).toContain('unbounded-pagination');
      });
    });

    it('detects ORDER BY RANDOM', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'q.sql', 'SELECT id FROM users ORDER BY RANDOM() LIMIT 1;');
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('non-deterministic-order');
      });
    });

    it('detects leading-wildcard LIKE', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'q.sql', "SELECT * FROM users WHERE email LIKE '%@example%';");
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('leading-wildcard-like');
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a 3-bucket block', () => {
      const ok = 'Correctness Risks: none\nMigration Safety Risks: none\nPerformance Risks: none\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when a bucket missing', () => {
      const r = runScript(path, [], { input: 'Correctness Risks: none\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Migration Safety Risks/);
    });
  });
});
