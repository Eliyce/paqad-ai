import { resolve } from 'node:path';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/documentation-workflow';
const sh = (n: string) => resolve(join(SKILL, 'scripts', n));

describe('documentation-workflow', () => {
  describe('check-stage2-prereq.sh', () => {
    const path = sh('check-stage2-prereq.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 0 with "ok" when module-map.yml exists in cwd', () => {
      withTempDir((dir) => {
        writeFile(dir, 'docs/instructions/rules/module-map.yml', 'users:\n');
        const r = runScript(path, [], { cwd: dir });
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('ok');
      });
    });

    it('exits 1 with the canonical refusal message when missing', () => {
      withTempDir((dir) => {
        const r = runScript(path, [], { cwd: dir });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/I cannot find docs\/instructions\/rules\/module-map\.yml/);
        expect(r.stderr).toMatch(/create documentation first/);
        expect(r.stderr).toMatch(/create module documentation/);
      });
    });
  });

  describe('list-orphan-module-dirs.sh', () => {
    const path = sh('list-orphan-module-dirs.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 1 when module-map missing', () => {
      withTempDir((dir) => {
        const r = runScript(path, [], { cwd: dir });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/missing/);
      });
    });

    it('exits 0 with empty stdout when docs/modules does not exist', () => {
      withTempDir((dir) => {
        writeFile(dir, 'docs/instructions/rules/module-map.yml', 'users:\n');
        const r = runScript(path, [], { cwd: dir });
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('reports module dirs not declared in the map', () => {
      withTempDir((dir) => {
        writeFile(
          dir,
          'docs/instructions/rules/module-map.yml',
          ['users:', '  features:', '    - invite', 'billing:', '  features:', '    - charge'].join(
            '\n',
          ),
        );
        writeFile(dir, 'docs/modules/users/README.md', '');
        writeFile(dir, 'docs/modules/billing/README.md', '');
        writeFile(dir, 'docs/modules/orphan-pkg/README.md', '');
        const r = runScript(path, [], { cwd: dir });
        expect(r.status).toBe(0);
        const out = lines(r.stdout);
        expect(out).toEqual(['docs/modules/orphan-pkg']);
      });
    });

    it('does not flag declared modules', () => {
      withTempDir((dir) => {
        writeFile(dir, 'docs/instructions/rules/module-map.yml', 'users:\nbilling:\n');
        writeFile(dir, 'docs/modules/users/README.md', '');
        writeFile(dir, 'docs/modules/billing/README.md', '');
        const r = runScript(path, [], { cwd: dir });
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

    it('passes a valid block with all 3 sections', () => {
      const ok =
        '## Workflow Status\nMode: foundation\n## Completed Stages\n- s1\n## Blocked Stages\nnone\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when any of the 3 sections missing', () => {
      const r1 = runScript(path, [], { input: '## Completed Stages\n## Blocked Stages\n' });
      expect(r1.status).toBe(1);
      expect(r1.stderr).toMatch(/Workflow Status/);

      const r2 = runScript(path, [], { input: '## Workflow Status\n## Blocked Stages\n' });
      expect(r2.status).toBe(1);
      expect(r2.stderr).toMatch(/Completed Stages/);

      const r3 = runScript(path, [], { input: '## Workflow Status\n## Completed Stages\n' });
      expect(r3.status).toBe(1);
      expect(r3.stderr).toMatch(/Blocked Stages/);
    });
  });

  describe('assets', () => {
    it('stage1-final-message.txt is the canonical refusal-end message', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/stage1-final-message.txt'), 'utf8');
      expect(text).toContain('Module map written to docs/instructions/rules/module-map.yml');
      expect(text).toContain('create module documentation');
    });
  });
});
