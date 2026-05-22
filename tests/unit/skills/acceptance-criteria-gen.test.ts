import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/acceptance-criteria-gen';
const sh = (n: string) => join(SKILL, 'scripts', n);
const asset = (n: string) => join(SKILL, 'assets', n);

describe('acceptance-criteria-gen', () => {
  describe('extract-ac-ids.sh', () => {
    const path = sh('extract-ac-ids.sh');

    it('--help exits 0 with a usage line', () => {
      const r = runScript(path, ['--help']);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/Usage:/i);
    });

    it('-h exits 0 (alias)', () => {
      expect(runScript(path, ['-h']).status).toBe(0);
    });

    it('extracts AC ids from stdin, sorted and deduped', () => {
      const r = runScript(path, [], { input: 'AC-2.1 AC-1.1 AC-1.1 AC-1.2 not-an-id AC-3' });
      expect(r.status).toBe(0);
      expect(lines(r.stdout)).toEqual(['AC-1.1', 'AC-1.2', 'AC-2.1', 'AC-3']);
    });

    it('handles a real markdown file', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'spec.md',
          '## ACs\n### AC-1.1\nGiven x, then y.\n### AC-1.2\nbla.\n### AC-2.1\nbla.\n',
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(lines(r.stdout)).toEqual(['AC-1.1', 'AC-1.2', 'AC-2.1']);
      });
    });

    it('returns empty stdout when no AC ids appear', () => {
      const r = runScript(path, [], { input: 'no ids here at all' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
    });

    it('exits 2 on missing file with stderr explanation', () => {
      const r = runScript(path, ['/definitely/not/here.md']);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/file not found/i);
    });

    it('is idempotent (same input → same output)', () => {
      const a = runScript(path, [], { input: 'AC-1.1 AC-1.1 AC-2.1' });
      const b = runScript(path, [], { input: 'AC-1.1 AC-1.1 AC-2.1' });
      expect(a.stdout).toBe(b.stdout);
    });
  });

  describe('next-ac-id.sh', () => {
    const path = sh('next-ac-id.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 with usage when no spec file is passed', () => {
      const r = runScript(path);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/usage:/i);
    });

    it('exits 2 when the spec file is missing', () => {
      const r = runScript(path, ['/no/such/spec.md']);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/spec not found/i);
    });

    it('returns AC-{fr}.{n+1} when fr exists', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'spec.md', '### AC-1.1\n### AC-1.2\n### AC-2.1\n');
        expect(runScript(path, [f, '1']).stdout.trim()).toBe('AC-1.3');
        expect(runScript(path, [f, '2']).stdout.trim()).toBe('AC-2.2');
      });
    });

    it('returns AC-{fr}.1 when fr has no existing children', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'spec.md', '### AC-1.1\n');
        expect(runScript(path, [f, '5']).stdout.trim()).toBe('AC-5.1');
      });
    });

    it('returns AC-{n+1} when called without fr (single-level mode)', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'spec.md', '### AC-1\n### AC-2\n');
        expect(runScript(path, [f]).stdout.trim()).toBe('AC-3');
      });
    });

    it('returns AC-1 for an empty spec', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'spec.md', '# spec\nno ACs yet\n');
        expect(runScript(path, [f]).stdout.trim()).toBe('AC-1');
        expect(runScript(path, [f, '1']).stdout.trim()).toBe('AC-1.1');
      });
    });
  });

  describe('lint-ac-output.sh', () => {
    const path = sh('lint-ac-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a fully valid block (exit 0, "ok" on stdout)', () => {
      const valid = [
        '## Acceptance Criteria',
        '',
        '### AC-1.1',
        '',
        'Given a user, when they sign in, then session created.',
        '',
        '### AC-1.2',
        '',
        'Given a user, when they sign in with bad creds, then 401.',
        '',
        '## Coverage Notes',
        '- AC-1.2 covers permission edge.',
      ].join('\n');
      const r = runScript(path, [], { input: valid });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('ok');
    });

    it('fails when "## Acceptance Criteria" heading is missing', () => {
      const r = runScript(path, [], {
        input: '### AC-1.1\nGiven x when y then z.\n## Coverage Notes\n- ok\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Acceptance Criteria/);
    });

    it('fails when "## Coverage Notes" is missing', () => {
      const r = runScript(path, [], {
        input: '## Acceptance Criteria\n### AC-1.1\nGiven x when y then z.\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Coverage Notes/);
    });

    it('fails on duplicate AC ids', () => {
      const dup = [
        '## Acceptance Criteria',
        '### AC-1.1',
        'Given a, when b, then c.',
        '### AC-1.1',
        'Given a, when b, then c.',
        '## Coverage Notes',
        '- ok',
      ].join('\n');
      const r = runScript(path, [], { input: dup });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/duplicate/i);
    });

    it('fails when a criterion is missing Given/When/Then prose', () => {
      const missingGwt = [
        '## Acceptance Criteria',
        '### AC-1.1',
        'a sentence with no GWT keywords whatsoever.',
        '## Coverage Notes',
        '- ok',
      ].join('\n');
      const r = runScript(path, [], { input: missingGwt });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Given\/When\/Then/);
    });

    it('exits 2 when given a missing file path', () => {
      const r = runScript(path, ['/no/such/file.md']);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/file not found/i);
    });
  });

  describe('assets/output.template.md', () => {
    it('the template (with placeholders replaced) passes lint-ac-output.sh', () => {
      // Placeholders → realistic values
      const filled = [
        '## Acceptance Criteria',
        '',
        '### AC-1.1',
        '',
        'Given an admin, when they invite, then 201 returned.',
        '',
        '### AC-1.2',
        '',
        'Given a member, when they invite, then 403 returned.',
        '',
        '## Coverage Notes',
        '',
        '- AC-1.2 covers the permission edge.',
      ].join('\n');
      const r = runScript(sh('lint-ac-output.sh'), [], { input: filled });
      expect(r.status).toBe(0);
    });

    it('exists on disk where SKILL.md says it does', async () => {
      const fs = await import('node:fs');
      expect(fs.existsSync(asset('output.template.md'))).toBe(true);
    });
  });
});
