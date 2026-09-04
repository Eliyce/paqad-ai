import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/acceptance-criteria-gen';
const sh = (n: string) => join(SKILL, 'scripts', n);
const asset = (n: string) => join(SKILL, 'assets', n);

// Issue #512 (C4): the skill emits the FLAT AC-N format the freeze parser reads. A dotted
// two-level AC-N.N is not a valid criterion id — it is ignored by the extractor/allocator
// and rejected by the linter.
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

    it('extracts flat AC ids, sorted and deduped, ignoring dotted ids', () => {
      const r = runScript(path, [], { input: 'AC-2 AC-1 AC-1 AC-10 not-an-id AC-3 AC-1.1' });
      expect(r.status).toBe(0);
      expect(lines(r.stdout)).toEqual(['AC-1', 'AC-2', 'AC-3', 'AC-10']);
    });

    it('handles a real markdown file', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'spec.md',
          '## ACs\n- AC-1: Given x, when y, then z (proof: automated).\n- AC-2: bla.\n- AC-3: bla.\n',
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(lines(r.stdout)).toEqual(['AC-1', 'AC-2', 'AC-3']);
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
      const a = runScript(path, [], { input: 'AC-1 AC-1 AC-2' });
      const b = runScript(path, [], { input: 'AC-1 AC-1 AC-2' });
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

    it('returns AC-{max+1} from the existing flat ids', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'spec.md', '- AC-1: a\n- AC-2: b\n- AC-3: c\n');
        expect(runScript(path, [f]).stdout.trim()).toBe('AC-4');
      });
    });

    it('ignores dotted ids when computing the next flat id', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'spec.md', '- AC-1: a\n### AC-9.9 legacy\n');
        expect(runScript(path, [f]).stdout.trim()).toBe('AC-2');
      });
    });

    it('returns AC-1 for an empty spec', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'spec.md', '# spec\nno ACs yet\n');
        expect(runScript(path, [f]).stdout.trim()).toBe('AC-1');
      });
    });
  });

  describe('lint-ac-output.sh', () => {
    const path = sh('lint-ac-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a fully valid flat block (exit 0, "ok" on stdout)', () => {
      const valid = [
        '## Acceptance criteria',
        '',
        '- AC-1: Given a user, when they sign in, then a session is created (proof: automated).',
        '- AC-2: Given a user, when they sign in with bad creds, then a 401 is returned (proof: manual).',
        '',
        '## Coverage Notes',
        '- AC-2 covers permission edge.',
      ].join('\n');
      const r = runScript(path, [], { input: valid });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('ok');
    });

    it('fails when "## Acceptance criteria" heading is missing', () => {
      const r = runScript(path, [], {
        input: '- AC-1: Given x, when y, then z (proof: automated).\n## Coverage Notes\n- ok\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Acceptance criteria/i);
    });

    it('fails when "## Coverage Notes" is missing', () => {
      const r = runScript(path, [], {
        input: '## Acceptance criteria\n- AC-1: Given x, when y, then z (proof: automated).\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Coverage Notes/);
    });

    it('fails on a dotted AC-N.N id', () => {
      const dotted = [
        '## Acceptance criteria',
        '- AC-1.1: Given a, when b, then c (proof: automated).',
        '## Coverage Notes',
        '- ok',
      ].join('\n');
      const r = runScript(path, [], { input: dotted });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/dotted/i);
    });

    it('fails on duplicate AC ids', () => {
      const dup = [
        '## Acceptance criteria',
        '- AC-1: Given a, when b, then c (proof: automated).',
        '- AC-1: Given a, when b, then c (proof: manual).',
        '## Coverage Notes',
        '- ok',
      ].join('\n');
      const r = runScript(path, [], { input: dup });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/duplicate/i);
    });

    it('fails when a criterion is missing Given/When/Then prose', () => {
      const missingGwt = [
        '## Acceptance criteria',
        '- AC-1: a sentence with no keywords (proof: automated).',
        '## Coverage Notes',
        '- ok',
      ].join('\n');
      const r = runScript(path, [], { input: missingGwt });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Given\/When\/Then/);
    });

    it('fails when a criterion is missing a proof tag', () => {
      const noProof = [
        '## Acceptance criteria',
        '- AC-1: Given a, when b, then c.',
        '## Coverage Notes',
        '- ok',
      ].join('\n');
      const r = runScript(path, [], { input: noProof });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/proof/i);
    });

    it('exits 2 when given a missing file path', () => {
      const r = runScript(path, ['/no/such/file.md']);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/file not found/i);
    });
  });

  describe('assets/output.template.md', () => {
    it('the template (with placeholders replaced) passes lint-ac-output.sh', () => {
      const filled = [
        '## Acceptance criteria',
        '',
        '- AC-1: Given an admin, when they invite, then a 201 is returned (proof: automated).',
        '- AC-2: Given a member, when they invite, then a 403 is returned (proof: manual).',
        '',
        '## Coverage Notes',
        '',
        '- AC-2 covers the permission edge.',
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
