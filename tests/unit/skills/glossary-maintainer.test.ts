import { resolve, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/glossary-maintainer';
const sh = (n: string) => resolve(join(SKILL, 'scripts', n));

describe('glossary-maintainer', () => {
  describe('find-term-uses.sh', () => {
    const path = sh('find-term-uses.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 with usage when no term passed', () => {
      const r = runScript(path);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/usage:/);
    });

    it('exits 0 with empty stdout when nothing in cwd', () => {
      withTempDir((dir) => {
        const r = runScript(path, ['anything'], { cwd: dir });
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('finds AC ids that co-occur with the term in .paqad/specs', () => {
      withTempDir((dir) => {
        writeFile(
          dir,
          '.paqad/specs/users.md',
          '### AC-1.1\nrefund window applies\n### AC-1.2\nunrelated\n',
        );
        writeFile(dir, '.paqad/specs/billing.md', '### AC-2.1\nrefund window applies\n');
        const r = runScript(path, ['refund window'], { cwd: dir });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('ac-id\tAC-1.1');
        expect(r.stdout).toContain('ac-id\tAC-2.1');
      });
    });

    it('finds doc files mentioning the term', () => {
      withTempDir((dir) => {
        writeFile(dir, 'docs/business/refunds.md', 'refund window: 30 days');
        writeFile(dir, 'docs/business/onboarding.md', 'no mention here');
        const r = runScript(path, ['refund window'], { cwd: dir });
        expect(r.stdout).toContain('doc-file\tdocs/business/refunds.md');
        expect(r.stdout).not.toContain('docs/business/onboarding.md');
      });
    });

    it('finds source files mentioning the term', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/billing/refund.ts', '// refund window check');
        writeFile(dir, 'src/billing/charge.ts', 'no mention');
        const r = runScript(path, ['refund window'], { cwd: dir });
        expect(r.stdout).toContain('source-file\tsrc/billing/refund.ts');
        expect(r.stdout).not.toContain('charge.ts');
      });
    });

    it('finds API endpoints from endpoints.md when nearby line mentions term', () => {
      withTempDir((dir) => {
        writeFile(
          dir,
          'docs/modules/billing/api/endpoints.md',
          'POST /invoices/{id}/refund — applies the refund window logic\nGET /invoices — listing\n',
        );
        const r = runScript(path, ['refund window'], { cwd: dir });
        expect(r.stdout).toContain('api-endpoint\tPOST /invoices/{id}/refund');
        // The unrelated GET endpoint should not be tagged for this term.
        expect(r.stdout).not.toContain('GET /invoices');
      });
    });

    it('escapes regex metacharacters in the term', () => {
      withTempDir((dir) => {
        writeFile(dir, 'docs/x.md', 'feature(x) is a thing');
        const r = runScript(path, ['feature(x)'], { cwd: dir });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('docs/x.md');
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes the "Glossary Updates: none" short circuit', () => {
      const r = runScript(path, [], { input: 'Glossary Updates: none\n' });
      expect(r.status).toBe(0);
    });

    it('passes a valid block', () => {
      const ok = [
        '## Glossary Updates',
        '- Refund window: the period during which a paid invoice can be refunded.',
        '  Used in: AC-3.1, POST /invoices/{id}/refund',
        '## Terminology Drift',
        '- none',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when "## Glossary Updates" missing', () => {
      const r = runScript(path, [], { input: '## Terminology Drift\n- none\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Glossary Updates/);
    });

    it('fails when "## Terminology Drift" missing', () => {
      const r = runScript(path, [], {
        input: '## Glossary Updates\n- Term: definition.\n  Used in: AC-1.1\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Terminology Drift/);
    });
  });
});
