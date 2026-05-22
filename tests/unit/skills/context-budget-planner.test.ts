import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/context-budget-planner';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('context-budget-planner', () => {
  describe('estimate-tokens.sh', () => {
    const path = sh('estimate-tokens.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 on unknown arg', () => {
      const r = runScript(path, ['--bogus', '1']);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/unknown arg/i);
    });

    it('emits the canonical Summary line + table + Recommended Compactions section', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'spec.md', 'a\n'.repeat(100)); // 100 lines
        const r = runScript(path, ['--available', '200000', '--committed', '30000'], {
          input: `3.0 ${f}\n`,
        });
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/^## Context Budget/m);
        expect(r.stdout).toMatch(
          /^Summary: Tier: \w+ \| Estimate: \d+ tokens \| Available: \d+ tokens \| Headroom: -?\d+ tokens/m,
        );
        expect(r.stdout).toMatch(/^### Per-Artifact Estimate/m);
        expect(r.stdout).toMatch(/^### Recommended Compactions/m);
        expect(r.stdout).toMatch(/\| Artifact \| Lines \| Weight \| Tokens \|/);
      });
    });

    it('computes line × weight per artifact correctly', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.md', 'a\n'.repeat(100));
        const r = runScript(path, ['--available', '200000', '--committed', '30000'], {
          input: `3.0 ${f}\n`,
        });
        // 100 lines × 3.0 weight = 300 tokens estimate; available 170000 - 300 = 169700 headroom.
        expect(r.stdout).toContain('| 100 | 3.0 | 300 |');
        expect(r.stdout).toContain('Estimate: 300 tokens');
        expect(r.stdout).toContain('Headroom: 169700 tokens');
      });
    });

    it('selects green tier when headroom > 50%', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.md', 'a\n'.repeat(10));
        const r = runScript(path, ['--available', '200000', '--committed', '30000'], {
          input: `1.0 ${f}\n`,
        });
        expect(r.stdout).toMatch(/Tier: green/);
        expect(r.stdout).toContain('Recommended Compactions: none');
      });
    });

    it('selects red tier when headroom drops to ≤10%', () => {
      withTempDir((dir) => {
        // usable = 100000-30000 = 70000; spend 65000 → headroom 5000 → 7% → red
        const f = writeFile(dir, 'big.md', 'x\n'.repeat(65000));
        const r = runScript(path, ['--available', '100000', '--committed', '30000'], {
          input: `1.0 ${f}\n`,
        });
        expect(r.stdout).toMatch(/Tier: red/);
        expect(r.stdout).not.toContain('Recommended Compactions: none');
      });
    });

    it('selects amber tier when headroom is 10–25%', () => {
      withTempDir((dir) => {
        // usable=70000, spend 60000 → headroom 10000 → 14% → amber
        const f = writeFile(dir, 'big.md', 'x\n'.repeat(60000));
        const r = runScript(path, ['--available', '100000', '--committed', '30000'], {
          input: `1.0 ${f}\n`,
        });
        expect(r.stdout).toMatch(/Tier: amber/);
      });
    });

    it('warns to stderr and counts a missing file as 0 lines', () => {
      const r = runScript(path, ['--available', '200000', '--committed', '30000'], {
        input: `2.0 /no/such/file.md\n`,
      });
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/missing file.*counted as 0 lines/);
      // Estimate must be 0 (0 lines × 2.0)
      expect(r.stdout).toContain('Estimate: 0 tokens');
    });

    it('handles multiple rows and totals them', () => {
      withTempDir((dir) => {
        const a = writeFile(dir, 'a.md', 'a\n'.repeat(100));
        const b = writeFile(dir, 'b.md', 'b\n'.repeat(50));
        const r = runScript(path, ['--available', '200000', '--committed', '30000'], {
          input: `2.0 ${a}\n4.0 ${b}\n`,
        });
        // 100×2.0=200, 50×4.0=200, total 400.
        expect(r.stdout).toContain('Estimate: 400 tokens');
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a structurally valid block', () => {
      const ok = [
        '## Context Budget',
        '',
        'Summary: Tier: green | Estimate: 300 tokens | Available: 170000 tokens | Headroom: 169700 tokens',
        '',
        '### Per-Artifact Estimate',
        '',
        '| Artifact | Lines | Weight | Tokens |',
        '| --- | --- | --- | --- |',
        '| `a.md` | 100 | 3.0 | 300 |',
        '',
        '### Recommended Compactions',
        '',
        'Recommended Compactions: none',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when "## Context Budget" missing', () => {
      const r = runScript(path, [], {
        input:
          'Summary: Tier: green | Estimate: 0 tokens | Available: 0 tokens | Headroom: 0 tokens\n### Per-Artifact Estimate\n### Recommended Compactions\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Context Budget/);
    });

    it('fails when Summary line malformed (missing tokens unit)', () => {
      const r = runScript(path, [], {
        input:
          '## Context Budget\nSummary: Tier: green Estimate 0 Available 0\n### Per-Artifact Estimate\n### Recommended Compactions\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Summary/);
    });

    it('fails when "### Per-Artifact Estimate" missing', () => {
      const r = runScript(path, [], {
        input:
          '## Context Budget\nSummary: Tier: green | Estimate: 0 tokens | Available: 0 tokens | Headroom: 0 tokens\n### Recommended Compactions\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Per-Artifact Estimate/);
    });

    it('fails when "### Recommended Compactions" missing', () => {
      const r = runScript(path, [], {
        input:
          '## Context Budget\nSummary: Tier: green | Estimate: 0 tokens | Available: 0 tokens | Headroom: 0 tokens\n### Per-Artifact Estimate\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Recommended Compactions/);
    });
  });

  describe('round-trip', () => {
    it('estimate-tokens output passes lint-output', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.md', 'a\n'.repeat(20));
        const out = runScript(
          sh('estimate-tokens.sh'),
          ['--available', '200000', '--committed', '30000'],
          {
            input: `2.0 ${f}\n`,
          },
        ).stdout;
        const lint = runScript(sh('lint-output.sh'), [], { input: out });
        expect(lint.status).toBe(0);
      });
    });
  });
});
