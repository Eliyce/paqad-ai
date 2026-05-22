import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/error-catalog-maintainer';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('error-catalog-maintainer', () => {
  describe('find-error-catalogs.sh', () => {
    const path = sh('find-error-catalogs.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 0 with empty stdout when root missing', () => {
      const r = runScript(path, ['/no/such']);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
    });

    it('finds error-catalog.md and error-codes.md across modules', () => {
      withTempDir((dir) => {
        writeFile(dir, 'modules/users/error-catalog.md', '');
        writeFile(dir, 'modules/billing/error-codes.md', '');
        writeFile(dir, 'modules/billing/api/error-codes.md', '');
        writeFile(dir, 'modules/users/README.md', 'unrelated');
        const r = runScript(path, [join(dir, 'modules')]);
        const out = lines(r.stdout);
        expect(out.length).toBe(3);
        expect(r.stdout).not.toContain('README.md');
      });
    });
  });

  describe('extract-error-codes.sh', () => {
    const path = sh('extract-error-codes.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 when no files passed', () => {
      const r = runScript(path);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/usage:/i);
    });

    it('returns empty stdout (exit 0) when files have no matching codes', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.ts', 'const greeting = "hello world"; // nothing to extract');
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('extracts UPPER_SNAKE codes ending with allowed suffixes', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'a.ts',
          [
            'throw new Error(USER_NOT_FOUND);',
            'throw new Error(INVITE_FAILED);',
            'throw new Error(EMAIL_INVALID);',
            'throw new Error(EMAIL_MISSING);',
            'throw new Error(SOMETHING_FORBIDDEN);',
            'throw new Error(STATE_CONFLICT);',
            'throw new Error(GENERIC_ERROR);',
          ].join('\n'),
        );
        const r = runScript(path, [f]);
        const out = lines(r.stdout);
        expect(out).toContain('USER_NOT_FOUND');
        expect(out).toContain('INVITE_FAILED');
        expect(out).toContain('EMAIL_INVALID');
        expect(out).toContain('EMAIL_MISSING');
        expect(out).toContain('SOMETHING_FORBIDDEN');
        expect(out).toContain('STATE_CONFLICT');
        expect(out).toContain('GENERIC_ERROR');
      });
    });

    it('extracts kebab-case codes from { code: "foo-bar" } style literals', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'a.ts',
          ['throw { code: "invite-dup-email" };', 'throw { errorCode: "user-not-found" };'].join(
            '\n',
          ),
        );
        const r = runScript(path, [f]);
        const out = lines(r.stdout);
        expect(out).toContain('invite-dup-email');
        expect(out).toContain('user-not-found');
      });
    });

    it('output is sorted and deduped across multiple input files', () => {
      withTempDir((dir) => {
        const a = writeFile(dir, 'a.ts', 'throw EMAIL_INVALID; throw EMAIL_INVALID;');
        const b = writeFile(dir, 'b.ts', 'throw USER_NOT_FOUND;');
        const r = runScript(path, [a, b]);
        const out = lines(r.stdout);
        expect(out).toEqual([...out].sort());
        expect(new Set(out).size).toBe(out.length);
      });
    });

    it('skips non-existent files quietly', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.ts', 'throw EMAIL_INVALID;');
        const r = runScript(path, [f, '/no/such/file.ts']);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('EMAIL_INVALID');
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid block', () => {
      const ok =
        '## Updated Error Entries\n- `USER_NOT_FOUND` in `docs/modules/users/error-codes.md`\n## Catalog Gaps\n- none\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when "## Updated Error Entries" missing', () => {
      const r = runScript(path, [], { input: '## Catalog Gaps\nnone\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Updated Error Entries/);
    });

    it('fails when "## Catalog Gaps" missing', () => {
      const r = runScript(path, [], { input: '## Updated Error Entries\n- `X`\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Catalog Gaps/);
    });

    it('fails when Updated Error Entries lists no backticked entries', () => {
      const r = runScript(path, [], {
        input: '## Updated Error Entries\n- nothing in backticks\n## Catalog Gaps\nnone\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/backticked entries/);
    });
  });
});
