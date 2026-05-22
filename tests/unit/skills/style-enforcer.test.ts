import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/content/skills/style-enforcer';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('style-enforcer', () => {
  describe('check-style.sh', () => {
    const path = sh('check-style.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 with usage when no draft', () => {
      expect(runScript(path).status).toBe(2);
    });

    it('flags forbid hits with rule | line | excerpt', () => {
      withTempDir((dir) => {
        const draft = writeFile(dir, 'd.md', 'It literally just works.\n');
        const rules = writeFile(dir, 'rules.txt', 'forbid\t\\bliterally\\b\nforbid\t\\bjust\\b\n');
        const r = runScript(path, [draft, rules]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('forbid:');
        expect(r.stdout).toContain('literally');
        expect(r.stdout).toContain('just');
      });
    });

    it('flags warn hits separately', () => {
      withTempDir((dir) => {
        const draft = writeFile(
          dir,
          'd.md',
          'In order to ship faster we utilize dynamic loading.\n',
        );
        const rules = writeFile(dir, 'rules.txt', 'warn\t\\bin order to\\b\nwarn\t\\butilize\\b\n');
        const r = runScript(path, [draft, rules]);
        expect(r.stdout).toContain('warn:');
      });
    });

    it('emits header only when nothing matches', () => {
      withTempDir((dir) => {
        const draft = writeFile(dir, 'd.md', 'plain accurate copy\n');
        const rules = writeFile(dir, 'rules.txt', 'forbid\t\\bliterally\\b\n');
        const r = runScript(path, [draft, rules]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('rule | line | excerpt');
      });
    });

    it('falls back to bundled default-rules.txt when no project style exists', () => {
      withTempDir((dir) => {
        const draft = writeFile(dir, 'd.md', 'It literally just works.\n');
        // No project writing-style.md, no explicit style-file → fallback
        const r = runScript(path, [draft], { cwd: dir });
        expect(r.status).toBe(0);
        // default-rules.txt forbids "literally"; we should see a hit.
        expect(r.stdout).toContain('forbid:');
      });
    });

    it('skips comment and blank lines in rules file', () => {
      withTempDir((dir) => {
        const draft = writeFile(dir, 'd.md', 'literally\n');
        const rules = writeFile(dir, 'rules.txt', '# comment\n\nforbid\t\\bliterally\\b\n');
        const r = runScript(path, [draft, rules]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('literally');
      });
    });
  });

  describe('assets', () => {
    it('default-rules.txt parses as expected directive\\tpattern lines', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/default-rules.txt'), 'utf8');
      const rules = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
      expect(rules.length).toBeGreaterThan(0);
      for (const r of rules) {
        const [d] = r.split('\t');
        expect(['forbid', 'warn']).toContain(d);
      }
    });
  });
});
