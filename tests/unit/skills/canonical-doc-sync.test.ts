import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/canonical-doc-sync';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('canonical-doc-sync', () => {
  describe('list-canonical-docs.sh', () => {
    const path = sh('list-canonical-docs.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 0 silently when docs root missing', () => {
      const r = runScript(path, ['/no/such/dir']);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
    });

    it('exits 0 with empty stdout when docs root has no canonical surfaces', () => {
      withTempDir((dir) => {
        writeFile(dir, 'docs/random.md', 'not under canonical surfaces');
        const r = runScript(path, [join(dir, 'docs')]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('lists docs under modules / business / registries / maintainers', () => {
      withTempDir((dir) => {
        writeFile(dir, 'docs/modules/a/README.md', '# a');
        writeFile(dir, 'docs/business/onboarding.md', '# b');
        writeFile(dir, 'docs/maintainers/canonical-contract-map.md', '# c');
        writeFile(dir, 'docs/registries/modules.md', '# d');
        writeFile(dir, 'docs/random/scratch.md', 'should be excluded');
        const r = runScript(path, [join(dir, 'docs')]);
        expect(r.status).toBe(0);
        const out = lines(r.stdout);
        expect(out).toEqual([
          join(dir, 'docs/business/onboarding.md'),
          join(dir, 'docs/maintainers/canonical-contract-map.md'),
          join(dir, 'docs/modules/a/README.md'),
          join(dir, 'docs/registries/modules.md'),
        ]);
        expect(r.stdout).not.toContain('scratch.md');
      });
    });

    it('output is sorted and deduplicated', () => {
      withTempDir((dir) => {
        writeFile(dir, 'docs/modules/c/README.md', '');
        writeFile(dir, 'docs/modules/a/README.md', '');
        writeFile(dir, 'docs/modules/b/README.md', '');
        const r = runScript(path, [join(dir, 'docs')]);
        const out = lines(r.stdout);
        expect(out).toEqual([...out].sort());
        expect(new Set(out).size).toBe(out.length);
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes valid block with Known Drift "none"', () => {
      const ok = '## Updated Docs\n- `docs/modules/x/README.md` — added\n## Known Drift\nnone\n';
      const r = runScript(path, [], { input: ok });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('ok');
    });

    it('passes valid block with backticked drift paths', () => {
      const ok = [
        '## Updated Docs',
        '- `docs/modules/x/README.md` — added',
        '## Known Drift',
        '- `docs/modules/y/README.md` — deferred until Q3',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when "## Updated Docs" missing', () => {
      const r = runScript(path, [], { input: '## Known Drift\nnone\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Updated Docs/);
    });

    it('fails when "## Known Drift" missing', () => {
      const r = runScript(path, [], {
        input: '## Updated Docs\n- `x.md` — y\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Known Drift/);
    });

    it('fails when Updated Docs has no backticked .md path', () => {
      const r = runScript(path, [], {
        input: '## Updated Docs\n- nothing here\n## Known Drift\nnone\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Updated Docs.+backticked .md/);
    });

    it('fails when Known Drift is neither "none" nor backticked .md paths', () => {
      const r = runScript(path, [], {
        input: '## Updated Docs\n- `x.md` — y\n## Known Drift\n- some prose without paths\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Known Drift.+backticked .md|exactly "none"/);
    });
  });

  describe('assets', () => {
    it('output.template.md filled passes lint-output.sh', () => {
      const filled = [
        '## Updated Docs',
        '- `docs/modules/users/README.md` — captured invite flow',
        '- `docs/business/governance.md` — added refund policy reference',
        '## Known Drift',
        'none',
      ].join('\n');
      expect(runScript(sh('lint-output.sh'), [], { input: filled }).status).toBe(0);
    });
  });
});
