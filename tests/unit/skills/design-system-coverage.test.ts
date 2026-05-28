import { readFileSync } from 'node:fs';
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

  describe('count-clauses.sh', () => {
    const path = sh('count-clauses.sh');
    const FIX = 'tests/fixtures/design-skills/design-system-coverage';

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('requires a file argument', () => {
      const r = runScript(path, []);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/file argument required/);
    });

    it('emits count 0 for a missing file (still exit 0)', () => {
      const r = runScript(path, ['/no/such/file.md']);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toMatch(/\t0$/);
    });

    it('emits count 0 for an empty file', () => {
      const r = runScript(path, [join(FIX, 'empty-tokens.md')]);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toMatch(/\t0$/);
    });

    it('counts the populated tokens fixture clauses', () => {
      const r = runScript(path, [join(FIX, 'tokens.md')]);
      expect(r.status).toBe(0);
      const [, count] = r.stdout.trim().split('\t');
      // tokens.md has 10 declared tokens
      expect(Number(count)).toBe(10);
    });

    it('ignores headings, blank lines, code fences, and frontmatter delimiters', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'thing.md',
          [
            '---',
            'name: x',
            '---',
            '',
            '# Heading',
            '',
            '## Sub',
            '',
            '```',
            'code',
            '```',
            '',
            '- one',
            '- two',
            '- three',
          ].join('\n'),
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        // Counts: `name: x` (1) + 3 list-item bullets (3) = 4.
        // Lines inside the code fence are excluded; fence delimiters are
        // excluded; headings and the frontmatter `---` rules are excluded.
        const [, count] = r.stdout.trim().split('\t');
        expect(Number(count)).toBe(4);
      });
    });
  });

  describe('derive-tier.sh', () => {
    const path = sh('derive-tier.sh');

    const counts = (rows: Record<string, number>) =>
      Object.entries(rows)
        .map(([file, n]) => `docs/instructions/design-system/${file}\t${n}`)
        .join('\n');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('returns tier=missing when every file is 0', () => {
      const r = runScript(path, [], {
        input: counts({
          'tokens.md': 0,
          'components.md': 0,
          'accessibility.md': 0,
          'responsive.md': 0,
          'motion.md': 0,
          'patterns.md': 0,
        }),
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^tier=missing$/m);
    });

    it('returns tier=strong when every file > 0', () => {
      const r = runScript(path, [], {
        input: counts({
          'tokens.md': 12,
          'components.md': 5,
          'accessibility.md': 3,
          'responsive.md': 4,
          'motion.md': 2,
          'patterns.md': 1,
        }),
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^tier=strong$/m);
    });

    it('returns tier=adequate when tokens+components+accessibility populated and at least one optional', () => {
      const r = runScript(path, [], {
        input: counts({
          'tokens.md': 8,
          'components.md': 3,
          'accessibility.md': 2,
          'responsive.md': 0,
          'motion.md': 1,
          'patterns.md': 0,
        }),
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^tier=adequate$/m);
    });

    it('returns tier=bare when tokens populated but accessibility empty', () => {
      const r = runScript(path, [], {
        input: counts({
          'tokens.md': 10,
          'components.md': 4,
          'accessibility.md': 0,
          'responsive.md': 1,
          'motion.md': 1,
          'patterns.md': 1,
        }),
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^tier=bare$/m);
    });

    it('rejects non-numeric counts', () => {
      const r = runScript(path, [], { input: 'docs/instructions/design-system/tokens.md\tNaN' });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/non-numeric/);
    });

    it('ignores unknown contract filenames with a note on stderr', () => {
      const r = runScript(path, [], {
        input: 'docs/instructions/design-system/colors.md\t5',
      });
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/ignoring unknown contract file/);
      expect(r.stdout).toMatch(/^tier=missing$/m);
    });
  });

  describe('gap-report.sh', () => {
    const path = sh('gap-report.sh');
    const FIX = 'tests/fixtures/design-skills/design-system-coverage';

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('reports every expected file as missing when directory is absent', () => {
      const r = runScript(path, ['/no/such/dir']);
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
        expect(r.stdout).toContain('missing-file');
      }
      // Stable id sequence:
      expect(r.stdout).toMatch(/DT-DS-0001\tmissing-file/);
      expect(r.stdout).toMatch(/DT-DS-0006\tmissing-file/);
    });

    it('reports populated files as no-gap and empty files as empty-file', () => {
      withTempDir((dir) => {
        const ds = `${dir}/docs/instructions/design-system`;
        // Copy the populated fixtures into a temp project layout.
        writeFile(
          dir,
          'docs/instructions/design-system/tokens.md',
          readFileSync(join(FIX, 'tokens.md'), 'utf8'),
        );
        writeFile(
          dir,
          'docs/instructions/design-system/components.md',
          readFileSync(join(FIX, 'components.md'), 'utf8'),
        );
        writeFile(
          dir,
          'docs/instructions/design-system/accessibility.md',
          readFileSync(join(FIX, 'accessibility.md'), 'utf8'),
        );
        // responsive.md / motion.md / patterns.md absent.
        const r = runScript(path, [ds]);
        expect(r.status).toBe(0);
        // Row format: DT-DS-NNNN<TAB><category><TAB>... so the category appears
        // BEFORE the file path. Assert order accordingly.
        expect(r.stdout).not.toMatch(/missing-file.*tokens\.md|empty-file.*tokens\.md/);
        expect(r.stdout).toMatch(/missing-file.*responsive\.md/);
        expect(r.stdout).toMatch(/missing-file.*motion\.md/);
        expect(r.stdout).toMatch(/missing-file.*patterns\.md/);
      });
    });

    it('treats a file present-but-blank as empty-file', () => {
      withTempDir((dir) => {
        const ds = `${dir}/docs/instructions/design-system`;
        writeFile(dir, 'docs/instructions/design-system/tokens.md', '');
        writeFile(dir, 'docs/instructions/design-system/components.md', '   \n  \n');
        const r = runScript(path, [ds]);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/empty-file.*tokens\.md/);
        expect(r.stdout).toMatch(/empty-file.*components\.md/);
      });
    });
  });
});
