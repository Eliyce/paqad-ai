import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/cross-module-impact-scanner';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('cross-module-impact-scanner', () => {
  describe('list-modules.sh', () => {
    const path = sh('list-modules.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 1 when module-map missing', () => {
      const r = runScript(path, ['/no/such/map.yml']);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/module map not found/);
    });

    it('extracts only top-level slugs (sorted, deduped)', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'map.yml',
          [
            'users:',
            '  features:',
            '    - invite',
            'billing:',
            '  features:',
            '    - charge',
            'api-tokens:',
          ].join('\n'),
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(lines(r.stdout)).toEqual(['api-tokens', 'billing', 'users']);
      });
    });
  });

  describe('find-integration-docs.sh', () => {
    const path = sh('find-integration-docs.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 0 with stderr note when root missing', () => {
      const r = runScript(path, ['/no/such']);
      expect(r.status).toBe(0);
    });

    it('returns empty (and exits 0) when there are no canonical integration docs', () => {
      withTempDir((dir) => {
        writeFile(dir, 'modules/users/README.md', 'unrelated');
        const r = runScript(path, [join(dir, 'modules')]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('finds events.md / contracts.md / integration.md / integrations.md', () => {
      withTempDir((dir) => {
        writeFile(dir, 'modules/users/events.md', '');
        writeFile(dir, 'modules/billing/contracts.md', '');
        writeFile(dir, 'modules/orders/integration.md', '');
        writeFile(dir, 'modules/notify/integrations.md', '');
        writeFile(dir, 'modules/users/api/endpoints.md', 'should not match');
        const r = runScript(path, [join(dir, 'modules')]);
        const out = lines(r.stdout);
        expect(out).toEqual([
          join(dir, 'modules/billing/contracts.md'),
          join(dir, 'modules/notify/integrations.md'),
          join(dir, 'modules/orders/integration.md'),
          join(dir, 'modules/users/events.md'),
        ]);
        expect(r.stdout).not.toContain('endpoints.md');
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes the internal-only short-circuit line', () => {
      const r = runScript(path, [], {
        input: 'Cross-Module Impact: internal-only — no consumers affected.\n',
      });
      expect(r.status).toBe(0);
    });

    it('passes a valid Impact Map block with allowed severity tokens', () => {
      const ok = [
        '## Cross-Module Impact',
        '',
        '### Impact Map',
        '',
        '| Surface | Type | Consumer | Severity | Coordinated change |',
        '| --- | --- | --- | --- | --- |',
        '| `POST /users` | API | billing | breaking | sync `email_verified` |',
        '| `user.created` | Event | analytics | additive | ignore by default |',
        '| `user.cache` | Cache | search | silent-shift | invalidate on update |',
      ].join('\n');
      const r = runScript(path, [], { input: ok });
      expect(r.status).toBe(0);
    });

    it('fails when "## Cross-Module Impact" missing', () => {
      const r = runScript(path, [], {
        input: '### Impact Map\n| Surface | Type | Consumer | Severity | Coordinated change |\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Cross-Module Impact/);
    });

    it('fails when canonical Impact Map header is wrong', () => {
      const r = runScript(path, [], {
        input: '## Cross-Module Impact\n### Impact Map\n| Surface | Severity |\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/canonical Impact Map table header/);
    });

    it('rejects out-of-vocabulary severity tokens', () => {
      const bad = [
        '## Cross-Module Impact',
        '### Impact Map',
        '| Surface | Type | Consumer | Severity | Coordinated change |',
        '| --- | --- | --- | --- | --- |',
        '| `x` | Y | z | catastrophic | a |',
      ].join('\n');
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/unknown severity/);
    });

    it('accepts every severity from the rubric', () => {
      for (const sev of ['breaking', 'additive', 'silent-shift', 'internal-only']) {
        const block = [
          '## Cross-Module Impact',
          '### Impact Map',
          '| Surface | Type | Consumer | Severity | Coordinated change |',
          '| --- | --- | --- | --- | --- |',
          `| \`x\` | T | c | ${sev} | go |`,
        ].join('\n');
        const r = runScript(path, [], { input: block });
        expect(r.status, `sev ${sev} stderr=${r.stderr}`).toBe(0);
      }
    });
  });

  describe('assets', () => {
    it('severity-rubric.txt tokens align with lint vocabulary', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/severity-rubric.txt'), 'utf8');
      const tokens = text
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('#'))
        .map((l) => l.split(/\s+/, 1)[0]);
      expect(new Set(tokens)).toEqual(
        new Set(['breaking', 'silent-shift', 'additive', 'internal-only']),
      );
    });
  });
});
