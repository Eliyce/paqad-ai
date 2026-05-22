import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/security/skills/business-logic-abuse-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('business-logic-abuse-review', () => {
  describe('find-workflow-docs.sh', () => {
    const path = sh('find-workflow-docs.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 0 with stderr note when docs root missing', () => {
      const r = runScript(path, ['/no/such/dir']);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/docs root not found/i);
    });

    it('finds docs by canonical filename (workflows.md, state.md, approvals.md, etc.)', () => {
      withTempDir((dir) => {
        writeFile(dir, 'modules/users/workflows.md', '# users wf');
        writeFile(dir, 'modules/billing/state.md', '# billing state');
        writeFile(dir, 'modules/billing/approvals.md', '# approvals');
        writeFile(dir, 'modules/users/README.md', 'unrelated');
        const r = runScript(path, [join(dir, 'modules')]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('modules/users/workflows.md');
        expect(r.stdout).toContain('modules/billing/state.md');
        expect(r.stdout).toContain('modules/billing/approvals.md');
        expect(r.stdout).not.toContain('README.md');
      });
    });

    it('also surfaces docs whose content mentions state-machine vocabulary', () => {
      withTempDir((dir) => {
        writeFile(
          dir,
          'modules/orders/lifecycle.md',
          '# orders\nThe state machine has these transitions: pending → approved → refunded.',
        );
        writeFile(dir, 'modules/orders/notes.md', 'random text without keywords.');
        const r = runScript(path, [join(dir, 'modules')]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('lifecycle.md');
        expect(r.stdout).not.toContain('notes.md');
      });
    });
  });

  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid finding with all 5 required segments', () => {
      const ok = [
        '## Findings',
        '### users — bypass-approval',
        '- **Module:** users',
        '- **Step:** invite',
        '- **Abuse case:** bypass-approval',
        '- **Missing proof:** no test covers admin-bypass path',
        '- **Reproduction:** 1. login 2. POST /users/invite without role check',
      ].join('\n');
      const r = runScript(path, [], { input: ok });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('ok');
    });

    it('fails when any required segment is missing', () => {
      const missingStep = [
        '## Findings',
        '### x — replay',
        '- **Module:** x',
        '- **Abuse case:** replay',
        '- **Missing proof:** none',
        '- **Reproduction:** 1.',
      ].join('\n');
      const r = runScript(path, [], { input: missingStep });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Step:/);
    });

    it('fails when "## Findings" heading missing', () => {
      const r = runScript(path, [], { input: '### x — replay\n- **Module:** x\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/## Findings/);
    });

    it('fails when no "### ..." subsections present', () => {
      const r = runScript(path, [], { input: '## Findings\n- some bullet\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/finding subsections/i);
    });

    it('exits 2 on missing input file', () => {
      expect(runScript(path, ['/no/such/file']).status).toBe(2);
    });
  });

  describe('assets', () => {
    it('output.template.md filled passes lint-findings.sh', () => {
      const filled = [
        '## Findings',
        '### billing — replay',
        '- **Module:** billing',
        '- **Step:** charge confirmation',
        '- **Abuse case:** replay',
        '- **Missing proof:** no idempotency-key test on confirm endpoint',
        '- **Reproduction:** 1. capture confirm POST 2. replay 3. observe double-charge',
      ].join('\n');
      const r = runScript(sh('lint-findings.sh'), [], { input: filled });
      expect(r.status).toBe(0);
    });

    it('abuse-case-categories.txt is a non-empty list of valid categories', async () => {
      const fs = await import('node:fs');
      const abs = join(SKILL, 'assets', 'abuse-case-categories.txt');
      const text = fs.readFileSync(abs, 'utf8');
      const tokens = text
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('#'))
        .map((l) => l.split(/\s+/, 1)[0]);
      // No duplicate tokens
      expect(new Set(tokens).size).toBe(tokens.length);
      // Each is kebab-case
      for (const t of tokens) expect(t).toMatch(/^[a-z][a-z0-9-]*$/);
    });
  });
});
