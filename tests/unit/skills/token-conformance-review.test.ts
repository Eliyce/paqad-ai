import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/coding/skills/token-conformance-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('token-conformance-review', () => {
  describe('scan-tokens.sh', () => {
    const path = sh('scan-tokens.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('emits a header and exits 0 when search root is missing', () => {
      const r = runScript(path, ['/no/such/dir']);
      expect(r.status).toBe(0);
    });

    it('detects every documented hard-coded-value category', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/Color.tsx', `const c = '#1a73e8';`);
        writeFile(dir, 'src/Fn.tsx', `const b = rgba(0, 0, 0, 0.4);`);
        writeFile(dir, 'src/Tw.tsx', `<div className="bg-[#1a73e8]" />`);
        writeFile(dir, 'src/Spacing.css', `.x { margin: 24px; }`);
        writeFile(dir, 'src/Rem.css', `.y { padding: 1.25rem; }`);
        writeFile(dir, 'src/Inline.tsx', `<div style={{ color: '#fff' }} />`);
        writeFile(dir, 'src/Imp.css', `.z { color: red !important; }`);
        writeFile(dir, 'src/Font.css', `.t { font-family: "Helvetica Neue", sans-serif; }`);
        writeFile(dir, 'src/Named.css', `.n { color: cornflowerblue; }`);

        const r = runScript(path, [join(dir, 'src')]);
        expect(r.status).toBe(0);
        for (const cat of [
          'color-hex',
          'color-functional',
          'tailwind-arbitrary-color',
          'raw-px',
          'raw-rem-em',
          'inline-style',
          'important-override',
          'raw-font-family',
          'named-css-color',
        ]) {
          expect(r.stdout, `expected category ${cat}`).toContain(cat);
        }
      });
    });

    it('excludes test, stories, and snap files', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/foo.test.tsx', `const c = '#1a73e8';`);
        writeFile(dir, 'src/bar.stories.tsx', `const c = '#1a73e8';`);
        writeFile(dir, 'src/baz.snap', `const c = '#1a73e8';`);
        const r = runScript(path, [join(dir, 'src')]);
        expect(r.status).toBe(0);
        // Header is always emitted; no payload rows under the exclusions.
        const dataLines = r.stdout
          .split('\n')
          .filter((l) => l.includes('|') && !l.includes('category | file:line'));
        expect(dataLines).toEqual([]);
      });
    });
  });

  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a well-formed finding with contract_ref + Evidence + Required action', () => {
      const body = [
        '## Findings',
        '',
        '- **high** (tokens.md → color.primary.500) — auth / token: hard-coded `#1a73e8`. Evidence: `src/Button.tsx:42`. Required action: replace with `color.primary.500`.',
      ].join('\n');
      const r = runScript(path, [], { input: body });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/ok/);
    });

    it('rejects a finding missing the contract_ref', () => {
      const body = [
        '## Findings',
        '- **high** — auth / token: hard-coded. Evidence: `src/Button.tsx:42`. Required action: replace.',
      ].join('\n');
      const r = runScript(path, [], { input: body });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/contract_ref/);
    });

    it('rejects a finding missing Evidence', () => {
      const body = [
        '## Findings',
        '- **high** (tokens.md → color.primary.500) — token: hard-coded. Required action: replace.',
      ].join('\n');
      const r = runScript(path, [], { input: body });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Evidence/);
    });

    it('rejects a finding missing Required action', () => {
      const body = [
        '## Findings',
        '- **high** (tokens.md → color.primary.500) — token: hard-coded. Evidence: `src/Button.tsx:42`.',
      ].join('\n');
      const r = runScript(path, [], { input: body });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Required action/);
    });
  });

  describe('parse-tokens.sh', () => {
    const path = sh('parse-tokens.sh');
    const FIX = 'tests/fixtures/design-skills/token-conformance-review';

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('requires a path argument', () => {
      const r = runScript(path, []);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/tokens\.md path is required/);
    });

    it('errors on missing file with exit 2', () => {
      const r = runScript(path, ['/no/such/tokens.md']);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/file not found/);
    });

    it('parses every declared token in the fixture', () => {
      const r = runScript(path, [join(FIX, 'tokens.md')]);
      expect(r.status).toBe(0);
      const rows = r.stdout.split('\n').filter((l) => l.length > 0);
      expect(rows.length).toBe(11); // 11 declared tokens in the fixture
      // Spot-check a color and a spacing entry.
      expect(rows).toContain('color.primary.500\t#1a73e8\tcolor');
      expect(rows).toContain('spacing.4\t16px\tspacing');
      expect(rows).toContain('font.family.sans\tInter\tfont');
    });

    it('ignores non-token lines (headings, prose, blank)', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'tokens.md',
          [
            '# Tokens',
            '',
            'Some prose explaining the system.',
            '',
            '## Colors',
            '',
            '- color.brand = #abcdef',
            '- not a token line',
            '- color.invalid =', // missing value -> ignored
            '- = #orphan', // missing name -> ignored
            '* color.bullet-star = #112233',
          ].join('\n'),
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        const rows = r.stdout.split('\n').filter((l) => l.length > 0);
        expect(rows).toEqual(['color.brand\t#abcdef\tcolor', 'color.bullet-star\t#112233\tcolor']);
      });
    });
  });

  describe('normalize-color.sh', () => {
    const path = sh('normalize-color.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('canonicalizes 6-digit hex (lowercases, preserves)', () => {
      const r = runScript(path, ['#1A73E8']);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('#1a73e8');
    });

    it('expands 3-digit hex shorthand to 6-digit', () => {
      const r = runScript(path, ['#abc']);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('#aabbcc');
    });

    it('strips fully-opaque alpha (ff) from 8-digit hex', () => {
      const r = runScript(path, ['#1a73e8ff']);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('#1a73e8');
    });

    it('preserves non-opaque alpha on 8-digit hex', () => {
      const r = runScript(path, ['#1a73e880']);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('#1a73e880');
    });

    it('normalizes rgb()/rgba() to 6-digit hex', () => {
      expect(runScript(path, ['rgb(26, 115, 232)']).stdout.trim()).toBe('#1a73e8');
      expect(runScript(path, ['rgba(26, 115, 232, 0.5)']).stdout.trim()).toBe('#1a73e8');
    });

    it('accepts the color via stdin', () => {
      const r = runScript(path, [], { input: '#1A73E8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('#1a73e8');
    });

    it('exits 1 with a clear error for unrecognized input', () => {
      const r = runScript(path, ['cornflowerblue']);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/unrecognized color format/);
    });

    it('exits 1 when rgb component is out of range', () => {
      const r = runScript(path, ['rgb(300, 0, 0)']);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/out of range/);
    });
  });

  describe('match-leak-to-token.sh', () => {
    const path = sh('match-leak-to-token.sh');
    const FIX = 'tests/fixtures/design-skills/token-conformance-review';

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('rejects missing --leak / --tokens with usage error', () => {
      expect(runScript(path, []).status).toBe(2);
      expect(runScript(path, ['--leak', '#1a73e8']).status).toBe(2);
      expect(runScript(path, ['--tokens', join(FIX, 'tokens.md')]).status).toBe(2);
    });

    it('matches a hex leak to the exact declared token (case-insensitive)', () => {
      withTempDir((dir) => {
        // First parse fixture tokens.md into the TSV the matcher expects.
        const parsed = runScript(sh('parse-tokens.sh'), [join(FIX, 'tokens.md')]);
        expect(parsed.status).toBe(0);
        const tsv = writeFile(dir, 'tokens.tsv', parsed.stdout);
        const r = runScript(path, ['--leak', '#1A73E8', '--tokens', tsv]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('match\tcolor.primary.500');
      });
    });

    it('matches rgb() to a hex-declared token', () => {
      withTempDir((dir) => {
        const parsed = runScript(sh('parse-tokens.sh'), [join(FIX, 'tokens.md')]);
        const tsv = writeFile(dir, 'tokens.tsv', parsed.stdout);
        const r = runScript(path, ['--leak', 'rgb(26, 115, 232)', '--tokens', tsv]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('match\tcolor.primary.500');
      });
    });

    it('reports "no-match" when the leak does not correspond to any token', () => {
      withTempDir((dir) => {
        const parsed = runScript(sh('parse-tokens.sh'), [join(FIX, 'tokens.md')]);
        const tsv = writeFile(dir, 'tokens.tsv', parsed.stdout);
        const r = runScript(path, ['--leak', '#abcdef', '--tokens', tsv]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('no-match');
      });
    });

    it('reports "ambiguous" with comma-separated names when multiple tokens share a value', () => {
      withTempDir((dir) => {
        const tsv = writeFile(
          dir,
          'tokens.tsv',
          ['color.primary.500\t#1a73e8\tcolor', 'color.brand.blue\t#1a73e8\tcolor'].join('\n'),
        );
        const r = runScript(path, ['--leak', '#1a73e8', '--tokens', tsv]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toMatch(/^ambiguous\t/);
        expect(r.stdout).toContain('color.primary.500');
        expect(r.stdout).toContain('color.brand.blue');
      });
    });

    it('--namespace filters candidates to a single namespace', () => {
      withTempDir((dir) => {
        const tsv = writeFile(
          dir,
          'tokens.tsv',
          [
            'color.primary.500\t16px\tcolor', // wrong namespace, same value
            'spacing.4\t16px\tspacing',
          ].join('\n'),
        );
        const r = runScript(path, ['--leak', '16px', '--tokens', tsv, '--namespace', 'spacing']);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('match\tspacing.4');
      });
    });

    it('rejects unknown flags', () => {
      const r = runScript(path, ['--bogus', 'x']);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/unknown flag/);
    });
  });
});
