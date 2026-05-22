import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/coding/skills/ui-doc-maintainer';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('ui-doc-maintainer', () => {
  describe('find-ui-docs.sh', () => {
    const path = sh('find-ui-docs.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 0 with empty stdout when no canonical UI docs', () => {
      withTempDir((dir) => {
        writeFile(dir, 'modules/users/README.md', '');
        const r = runScript(path, [join(dir, 'modules')]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('finds screens / components / states / variants / flows under ui/', () => {
      withTempDir((dir) => {
        writeFile(dir, 'modules/users/ui/screens.md', '');
        writeFile(dir, 'modules/users/ui/components.md', '');
        writeFile(dir, 'modules/users/ui/states.md', '');
        writeFile(dir, 'modules/users/ui/variants.md', '');
        writeFile(dir, 'modules/users/ui/flows.md', '');
        writeFile(dir, 'modules/users/screens.md', 'wrong location'); // outside ui/
        const r = runScript(path, [join(dir, 'modules')]);
        const out = lines(r.stdout);
        expect(out.length).toBe(5);
        expect(r.stdout).not.toContain('modules/users/screens.md');
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
        '## Updated UI Docs\n- `docs/modules/users/ui/screens.md` — added invite\n## Open UI Gaps\n- none\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when "## Updated UI Docs" missing', () => {
      const r = runScript(path, [], { input: '## Open UI Gaps\nnone\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Updated UI Docs/);
    });

    it('fails when no backticked .md path under Updated UI Docs', () => {
      const r = runScript(path, [], {
        input: '## Updated UI Docs\n- nothing\n## Open UI Gaps\n- none\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/backticked .md path/);
    });
  });
});
