import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/api-doc-maintainer';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('api-doc-maintainer', () => {
  describe('find-api-docs.sh', () => {
    const path = sh('find-api-docs.sh');

    it('--help exits 0 with a usage line', () => {
      const r = runScript(path, ['--help']);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/Usage:/i);
    });

    it('returns empty stdout when docs-root does not exist (notes on stderr)', () => {
      const r = runScript(path, ['/no/such/dir']);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
      expect(r.stderr).toMatch(/docs root not found/i);
    });

    it('finds endpoints.md, schemas.md, error-codes.md across modules — sorted', () => {
      withTempDir((dir) => {
        writeFile(dir, 'modules/users/api/endpoints.md', '# users');
        writeFile(dir, 'modules/users/api/schemas.md', '# schemas');
        writeFile(dir, 'modules/billing/api/endpoints.md', '# billing');
        writeFile(dir, 'modules/billing/api/error-codes.md', '# errors');
        writeFile(dir, 'modules/users/README.md', 'unrelated');
        writeFile(dir, 'modules/users/api/openapi.yml', 'unrelated');
        const r = runScript(path, [join(dir, 'modules')]);
        expect(r.status).toBe(0);
        const out = lines(r.stdout);
        expect(out).toEqual([
          join(dir, 'modules/billing/api/endpoints.md'),
          join(dir, 'modules/billing/api/error-codes.md'),
          join(dir, 'modules/users/api/endpoints.md'),
          join(dir, 'modules/users/api/schemas.md'),
        ]);
      });
    });

    it('does NOT pick up files outside the canonical api/ paths', () => {
      withTempDir((dir) => {
        writeFile(dir, 'modules/users/endpoints.md', 'wrong location');
        writeFile(dir, 'modules/users/api/endpoints.md', 'right location');
        const r = runScript(path, [join(dir, 'modules')]);
        expect(lines(r.stdout)).toEqual([join(dir, 'modules/users/api/endpoints.md')]);
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid block', () => {
      const ok = [
        '## Updated API Docs',
        '- `docs/modules/users/api/endpoints.md` — added invite',
        '## Coverage Gaps',
        '- none',
      ].join('\n');
      const r = runScript(path, [], { input: ok });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('ok');
    });

    it('fails when "## Updated API Docs" missing', () => {
      const r = runScript(path, [], { input: '## Coverage Gaps\n- none\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Updated API Docs/);
    });

    it('fails when "## Coverage Gaps" missing', () => {
      const r = runScript(path, [], {
        input: '## Updated API Docs\n- `x.md` — y\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Coverage Gaps/);
    });

    it('fails when Updated API Docs lists no backticked .md path', () => {
      const r = runScript(path, [], {
        input: '## Updated API Docs\n- nothing here in backticks\n## Coverage Gaps\n- none\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/backtick-quoted .md path/);
    });

    it('exits 2 on missing input file', () => {
      const r = runScript(path, ['/no/such/file.md']);
      expect(r.status).toBe(2);
    });
  });

  describe('assets', () => {
    it('output.template.md filled in passes lint-output.sh', () => {
      const filled = [
        '## Updated API Docs',
        '- `docs/modules/users/api/endpoints.md` — POST /invite payload + 403 path documented',
        '- `docs/modules/users/api/error-codes.md` — added `INVITE_DUP_EMAIL`',
        '## Coverage Gaps',
        '- none',
      ].join('\n');
      const r = runScript(sh('lint-output.sh'), [], { input: filled });
      expect(r.status).toBe(0);
    });
  });
});
