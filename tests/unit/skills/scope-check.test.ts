import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/scope-check';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('scope-check', () => {
  describe('check-spec-presence.sh', () => {
    const path = sh('check-spec-presence.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 1 with blocked-no-spec when directory missing', () => {
      const r = runScript(path, ['/no/such/dir']);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/blocked-no-spec/);
    });

    it('exits 1 with blocked-no-spec when directory exists but empty', () => {
      withTempDir((dir) => {
        const r = runScript(path, [dir]);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/blocked-no-spec/);
      });
    });

    it('exits 0 listing specs when directory contains .md files', () => {
      withTempDir((dir) => {
        writeFile(dir, 'users.md', '# spec');
        writeFile(dir, 'billing.md', '# spec');
        const r = runScript(path, [dir]);
        expect(r.status).toBe(0);
        const out = lines(r.stdout);
        expect(out.length).toBe(2);
        expect(out.some((p) => p.endsWith('users.md'))).toBe(true);
        expect(out.some((p) => p.endsWith('billing.md'))).toBe(true);
      });
    });

    it('respects -maxdepth 2 (deeper specs are excluded)', () => {
      withTempDir((dir) => {
        writeFile(dir, 'level1/spec.md', '');
        writeFile(dir, 'level1/level2/level3/deep.md', '');
        const r = runScript(path, [dir]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('level1/spec.md');
        expect(r.stdout).not.toContain('deep.md');
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes valid block with each allowed decision token', () => {
      for (const decision of ['within-scope', 'extension-needed', 'blocked-no-spec']) {
        const ok = [
          '## Scope Decision',
          `${decision} — reason`,
          '## Spec Evidence',
          '- `x.md` — y',
          '## Required Next Step',
          '- z',
        ].join('\n');
        expect(runScript(path, [], { input: ok }).status, `decision ${decision}`).toBe(0);
      }
    });

    it('fails when decision token is out-of-vocabulary', () => {
      const bad =
        '## Scope Decision\nmaybe — y\n## Spec Evidence\n- a\n## Required Next Step\n- b\n';
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/within-scope.*extension-needed.*blocked-no-spec/);
    });

    it('fails when any of the 3 sections missing', () => {
      const r = runScript(path, [], { input: '## Spec Evidence\n## Required Next Step\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Scope Decision/);
    });
  });
});
