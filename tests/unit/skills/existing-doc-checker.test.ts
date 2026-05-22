import { resolve, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/existing-doc-checker';
const sh = (n: string) => resolve(join(SKILL, 'scripts', n));

describe('existing-doc-checker', () => {
  describe('scan-docs.sh', () => {
    const path = sh('scan-docs.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 with usage when no keywords', () => {
      const r = runScript(path);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/usage:/i);
    });

    it('exits 0 with empty stdout when no canonical surfaces in cwd', () => {
      withTempDir((dir) => {
        const r = runScript(path, ['anything'], { cwd: dir });
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('returns empty stdout when keyword matches nothing', () => {
      withTempDir((dir) => {
        writeFile(dir, 'docs/modules/users/README.md', 'invitation flow');
        const r = runScript(path, ['nonsense-keyword'], { cwd: dir });
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('emits "<path>\\t<keyword>" rows for each hit, sorted unique', () => {
      withTempDir((dir) => {
        writeFile(dir, 'docs/modules/users/README.md', 'invitation flow with role check');
        writeFile(dir, 'docs/business/onboarding.md', 'invitation policy');
        writeFile(dir, 'docs/modules/users/api/endpoints.md', 'unrelated content');
        const r = runScript(path, ['invitation'], { cwd: dir });
        expect(r.status).toBe(0);
        const out = lines(r.stdout);
        expect(out.every((l) => l.endsWith('\tinvitation'))).toBe(true);
        expect(out.length).toBe(2);
        expect(out).toEqual([...out].sort());
      });
    });

    it('handles regex metacharacters in keywords by escaping them', () => {
      withTempDir((dir) => {
        writeFile(dir, 'docs/modules/users/README.md', 'feature(x): does y');
        // The keyword contains parentheses; without escape this would be regex group syntax
        const r = runScript(path, ['feature(x):'], { cwd: dir });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('docs/modules/users/README.md');
      });
    });

    it('only scans canonical surfaces (modules/business/maintainers/instructions/.paqad/indexes), excludes others', () => {
      withTempDir((dir) => {
        writeFile(dir, 'docs/modules/users/README.md', 'token rotation');
        writeFile(dir, 'docs/random/scratch.md', 'token rotation'); // not a canonical surface
        const r = runScript(path, ['token'], { cwd: dir });
        const out = lines(r.stdout);
        expect(out.some((l) => l.includes('docs/modules/users/README.md'))).toBe(true);
        expect(out.some((l) => l.includes('docs/random/scratch.md'))).toBe(false);
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
        '## Canonical Files\n- `docs/x.md`\n## Potential Drift\n- none\n## Missing Docs\n- none\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when "## Canonical Files" missing', () => {
      const r = runScript(path, [], { input: '## Potential Drift\n## Missing Docs\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Canonical Files/);
    });

    it('fails when "## Potential Drift" missing', () => {
      const r = runScript(path, [], { input: '## Canonical Files\n## Missing Docs\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Potential Drift/);
    });

    it('fails when "## Missing Docs" missing', () => {
      const r = runScript(path, [], { input: '## Canonical Files\n## Potential Drift\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Missing Docs/);
    });
  });
});
