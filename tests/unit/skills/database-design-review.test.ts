import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/coding/skills/database-design-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('database-design-review', () => {
  describe('scan-migration-smells.sh', () => {
    const path = sh('scan-migration-smells.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 with usage when no files', () => {
      expect(runScript(path).status).toBe(2);
    });

    it('emits header only when migrations are clean', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'add_users.sql', 'CREATE TABLE users (id BIGSERIAL PRIMARY KEY);');
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('smell | file:line | excerpt');
      });
    });

    it('detects destructive drops', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'drop_users.sql',
          'DROP TABLE users;\nALTER TABLE x DROP COLUMN y;',
        );
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('destructive-drop');
      });
    });

    it('detects NOT NULL without default', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'add_col.sql',
          'ALTER TABLE users ADD COLUMN status text NOT NULL;',
        );
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('not-null-without-default');
      });
    });

    it('detects rename without shim', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'rename.sql',
          'ALTER TABLE users RENAME COLUMN email TO email_addr;',
        );
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('rename-without-shim');
      });
    });

    it('detects DELETE FROM and TRUNCATE', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'wipe.sql', 'DELETE FROM users;\nTRUNCATE billing_logs;');
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('data-deletion');
      });
    });

    it('detects type changes', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'type.sql', 'ALTER TABLE users ALTER COLUMN id TYPE bigint;');
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('type-change');
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
        '## Correctness Risks\n- a\n## Migration Safety Risks\n- b\n## Performance Risks\n- c\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('passes when buckets use the "<bucket>: none" form', () => {
      const ok = 'Correctness Risks: none\nMigration Safety Risks: none\nPerformance Risks: none\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when any bucket missing', () => {
      const r = runScript(path, [], { input: '## Correctness Risks\n## Performance Risks\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Migration Safety Risks/);
    });
  });
});
