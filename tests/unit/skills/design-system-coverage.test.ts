import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/coding/skills/design-system-coverage';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('design-system-coverage', () => {
  describe('list-contract-files.sh', () => {
    const path = sh('list-contract-files.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('reports all six expected contract files (absent when dir missing)', () => {
      withTempDir((dir) => {
        const r = runScript(path, [join(dir, 'docs/instructions/design-system')]);
        expect(r.status).toBe(0);
        for (const f of [
          'tokens.md',
          'components.md',
          'accessibility.md',
          'responsive.md',
          'motion.md',
          'patterns.md',
        ]) {
          expect(r.stdout).toContain(f);
        }
        expect(r.stdout).toContain('absent');
      });
    });

    it('distinguishes present/empty vs present/non-empty files', () => {
      withTempDir((dir) => {
        const base = 'docs/instructions/design-system';
        writeFile(dir, `${base}/tokens.md`, '# Tokens\n\ncolor.primary.500 = #1a73e8\n');
        writeFile(dir, `${base}/components.md`, ''); // empty
        const r = runScript(path, [join(dir, base)]);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/tokens\.md\tpresent\tnon-empty/);
        expect(r.stdout).toMatch(/components\.md\tpresent\tempty/);
      });
    });
  });

  describe('validate-contract.sh', () => {
    const path = sh('validate-contract.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a well-formed "missing" tier payload', () => {
      const r = runScript(path, [], {
        input: JSON.stringify({
          tier: 'missing',
          files: [],
          clauses: {
            tokens: [],
            components: [],
            accessibility: [],
            responsive: [],
            motion: [],
            patterns: [],
          },
        }),
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/ok/);
    });

    it('rejects an "adequate" tier with empty tokens clauses', () => {
      const r = runScript(path, [], {
        input: JSON.stringify({
          tier: 'adequate',
          files: [],
          clauses: {
            tokens: [],
            components: ['Button'],
            accessibility: ['WCAG-2.2-1.4.3'],
            responsive: [],
            motion: [],
            patterns: [],
          },
        }),
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/clauses\.tokens.*empty/);
    });

    it('rejects an unknown tier value', () => {
      const r = runScript(path, [], { input: '{ "tier": "halfway" }' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/tier/);
    });
  });
});
