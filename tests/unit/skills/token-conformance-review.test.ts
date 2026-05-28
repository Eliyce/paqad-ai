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
});
