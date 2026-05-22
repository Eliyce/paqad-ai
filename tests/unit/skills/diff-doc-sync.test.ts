import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/diff-doc-sync';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('diff-doc-sync', () => {
  describe('detect-stale-docs.sh', () => {
    const path = sh('detect-stale-docs.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 0 silently when docs-root missing', () => {
      const r = runScript(path, ['/no/such']);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/docs root not found/);
    });

    it('returns the changed doc itself when a doc was edited directly', () => {
      withTempDir((dir) => {
        writeFile(dir, 'modules/users/README.md', '');
        const r = runScript(path, [join(dir, 'modules')], {
          input: 'docs/modules/users/api/endpoints.md\n',
        });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('docs/modules/users/api/endpoints.md');
      });
    });

    it('maps a changed source file to candidate canonical docs of the same module', () => {
      withTempDir((dir) => {
        writeFile(dir, 'modules/users/README.md', '');
        writeFile(dir, 'modules/users/api/endpoints.md', '');
        writeFile(dir, 'modules/billing/README.md', '');
        const r = runScript(path, [join(dir, 'modules')], {
          input: 'src/users/handler.ts\n',
        });
        expect(r.status).toBe(0);
        const out = lines(r.stdout);
        // Both users docs should appear; billing should not.
        expect(out.some((p) => p.endsWith('modules/users/README.md'))).toBe(true);
        expect(out.some((p) => p.endsWith('modules/users/api/endpoints.md'))).toBe(true);
        expect(out.some((p) => p.endsWith('modules/billing/README.md'))).toBe(false);
      });
    });

    it('returns sorted, deduplicated stdout', () => {
      withTempDir((dir) => {
        writeFile(dir, 'modules/users/README.md', '');
        const r = runScript(path, [join(dir, 'modules')], {
          input: 'src/users/a.ts\nsrc/users/b.ts\nsrc/users/a.ts\n',
        });
        const out = lines(r.stdout);
        expect(out).toEqual([...out].sort());
        expect(new Set(out).size).toBe(out.length);
      });
    });

    it('returns empty stdout when no changed file matches any module', () => {
      withTempDir((dir) => {
        writeFile(dir, 'modules/users/README.md', '');
        const r = runScript(path, [join(dir, 'modules')], {
          input: 'src/unrelated/file.ts\n',
        });
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

    it('passes the empty array', () => {
      const r = runScript(path, [], { input: '[]' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('ok');
    });

    it('passes a sorted dedup array of .md paths', () => {
      const r = runScript(path, [], {
        input: '["docs/modules/a/README.md","docs/modules/b/README.md"]',
      });
      expect(r.status).toBe(0);
    });

    it('rejects invalid JSON', () => {
      const r = runScript(path, [], { input: 'not json' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/not valid JSON/);
    });

    it('rejects non-array JSON', () => {
      const r = runScript(path, [], { input: '{"a":1}' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/not a JSON array/);
    });

    it('rejects unsorted array', () => {
      const r = runScript(path, [], { input: '["b.md","a.md"]' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/not sorted/);
    });

    it('rejects array with duplicates', () => {
      const r = runScript(path, [], { input: '["a.md","a.md"]' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/duplicates/);
    });

    it('rejects non-.md entries', () => {
      const r = runScript(path, [], { input: '["a.md","b.json"]' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/non-.*\.md/);
    });
  });
});
