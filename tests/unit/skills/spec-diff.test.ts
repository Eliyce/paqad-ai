import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/spec-diff';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('spec-diff', () => {
  describe('extract-ac-ids.sh', () => {
    const path = sh('extract-ac-ids.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 with usage when no files passed', () => {
      const r = runScript(path);
      expect(r.status).toBe(2);
    });

    it('extracts AC ids across multiple specs (sorted, deduped)', () => {
      withTempDir((dir) => {
        const a = writeFile(dir, 'a.md', '### AC-1.1\n### AC-1.2\n');
        const b = writeFile(dir, 'b.md', '### AC-1.2\n### AC-2.1\n');
        const r = runScript(path, [a, b]);
        expect(r.status).toBe(0);
        expect(lines(r.stdout)).toEqual(['AC-1.1', 'AC-1.2', 'AC-2.1']);
      });
    });

    it('returns empty stdout when specs have no ACs', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.md', '# spec without ACs');
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('skips missing files quietly', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.md', '### AC-1.1\n');
        const r = runScript(path, [f, '/no/such/file.md']);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('AC-1.1');
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid block with each allowed decision', () => {
      for (const dec of ['covered', 'extension', 'conflict']) {
        const ok = `## Spec Diff Decision\n${dec} — reason\n## Evidence\n- \`x.md\` — y\n## Implication\n- z\n`;
        expect(runScript(path, [], { input: ok }).status, `dec ${dec}`).toBe(0);
      }
    });

    it('fails when decision token is out-of-vocab', () => {
      const r = runScript(path, [], {
        input: '## Spec Diff Decision\nmaybe — y\n## Evidence\n- a\n## Implication\n- b\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/covered.*extension.*conflict/);
    });

    it('fails when any of 3 sections missing', () => {
      const r = runScript(path, [], { input: '## Evidence\n## Implication\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Spec Diff Decision/);
    });
  });
});
