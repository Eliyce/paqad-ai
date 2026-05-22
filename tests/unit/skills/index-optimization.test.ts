import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/coding/skills/index-optimization';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('index-optimization', () => {
  describe('scan-query-shapes.sh', () => {
    const path = sh('scan-query-shapes.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 with usage when no files', () => {
      expect(runScript(path).status).toBe(2);
    });

    it('emits header only on clean files', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.ts', 'function noop() {}');
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('shape | file:line | excerpt');
      });
    });

    it('detects equality WHERE filters', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'q.sql', 'SELECT * FROM users WHERE email = ?;');
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('equality-filter');
      });
    });

    it('detects IN / LIKE filters', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'q.sql',
          "SELECT * FROM users WHERE id IN (1,2,3);\nSELECT * FROM users WHERE email LIKE '%@x%';",
        );
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('in-or-like-filter');
      });
    });

    it('detects ORDER BY', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'q.sql', 'SELECT * FROM users ORDER BY created_at DESC;');
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('order-by');
      });
    });

    it('detects JOIN ... ON', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'q.sql',
          'SELECT * FROM users JOIN profiles ON users.id = profiles.user_id;',
        );
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('join-on');
      });
    });

    it('detects GROUP BY', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'q.sql', 'SELECT count(*) FROM users GROUP BY tenant_id;');
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('group-by');
      });
    });

    it('detects uniqueness rules', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'q.sql', 'CREATE UNIQUE INDEX users_email_idx ON users (email);');
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('uniqueness-rule');
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid 3-bucket block', () => {
      const ok =
        '## Correctness Risks\nnone\n## Migration Safety Risks\nnone\n## Performance Risks\n- index missing on users.email\n';
      // Lint accepts both "## Bucket" and "Bucket: none" — try the "##" form
      // and confirm — if it fails, the test exposes a lint bug.
      const ok2 =
        'Correctness Risks: none\nMigration Safety Risks: none\nPerformance Risks: none\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
      expect(runScript(path, [], { input: ok2 }).status).toBe(0);
    });

    it('fails when any bucket missing', () => {
      const r = runScript(path, [], { input: 'Correctness Risks: none\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Migration Safety Risks|Performance Risks/);
    });
  });
});
