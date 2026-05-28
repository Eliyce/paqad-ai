import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/coding/skills/design-system-sync';
const sh = (n: string) => join(SKILL, 'scripts', n);
const FIX = 'tests/fixtures/design-skills/design-system-sync';

describe('design-system-sync', () => {
  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a sync proposal cast as a finding block when used in the design-test workflow', () => {
      // design-system-sync's primary output is a proposal block (not a
      // findings list), but when it runs inside design-test it can emit a
      // documentation-drift finding pointing at a missing contract clause.
      const body = [
        '## Findings',
        '- **medium** (tokens.md → color.brand) — auth / documentation-drift: brand token used in code but undeclared. Evidence: `tailwind.config.ts:12`. Required action: append `color.brand = #abcdef` to tokens.md.',
      ].join('\n');
      expect(runScript(path, [], { input: body }).status).toBe(0);
    });

    it('rejects malformed findings', () => {
      const r = runScript(path, [], { input: '## Findings\n- nope' });
      expect(r.status).toBe(1);
    });
  });

  describe('detect-token-additions.sh', () => {
    const path = sh('detect-token-additions.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('reads a diff path argument', () => {
      const r = runScript(path, [join(FIX, 'token-diff.patch')]);
      expect(r.status).toBe(0);
      const rows = r.stdout.split('\n').filter((l) => l.length > 0);
      expect(rows).toContain('brand\t#abcdef');
      expect(rows).toContain('surfaceDeep\t#0f172a');
      expect(rows).toContain('14\t56px');
    });

    it('reads a diff from stdin', () => {
      const diff = readFileSync(join(FIX, 'token-diff.patch'), 'utf8');
      const r = runScript(path, [], { input: diff });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/brand\t#abcdef/);
    });

    it('ignores non-token-shaped values', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'd.patch',
          [
            '+++ b/src/design-tokens/x.ts',
            "+  description: 'A friendly name'",
            "+  brand: '#deadbe'",
            '+  layoutOrder: 7',
          ].join('\n'),
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        const rows = r.stdout.split('\n').filter((l) => l.length > 0);
        // Only the hex value qualifies as token-shaped.
        expect(rows).toEqual(['brand\t#deadbe']);
      });
    });

    it('errors on a missing file', () => {
      const r = runScript(path, ['/no/such/diff.patch']);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/file not found/);
    });
  });

  describe('detect-component-additions.sh', () => {
    const path = sh('detect-component-additions.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('detects only uppercase-named component files under src/components/', () => {
      const r = runScript(path, [join(FIX, 'component-diff.patch')]);
      expect(r.status).toBe(0);
      const rows = r.stdout.split('\n').filter((l) => l.length > 0);
      // Fixture adds Foo.tsx, Bar.tsx, helpers.ts, Foo.test.tsx.
      // Expected matches: Foo.tsx, Bar.tsx (the rest are excluded).
      expect(rows).toContain('Foo\tsrc/components/Foo.tsx');
      expect(rows).toContain('Bar\tsrc/components/Bar.tsx');
      expect(rows.find((row) => row.includes('helpers'))).toBeUndefined();
      expect(rows.find((row) => row.includes('Foo.test'))).toBeUndefined();
    });

    it('emits empty output for a diff with no new component files', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'd.patch',
          [
            'diff --git a/src/components/Existing.tsx b/src/components/Existing.tsx',
            'index 111..222',
            '--- a/src/components/Existing.tsx',
            '+++ b/src/components/Existing.tsx',
            '@@ -1 +1 @@',
            '-old',
            '+new',
          ].join('\n'),
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });
  });

  describe('propose-tokens-diff.sh', () => {
    const path = sh('propose-tokens-diff.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('emits a unified-diff hunk for tokens.md given token additions', () => {
      const r = runScript(path, [], {
        input: ['color.brand\t#abcdef', 'spacing.14\t56px'].join('\n'),
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('--- a/docs/instructions/design-system/tokens.md');
      expect(r.stdout).toContain('+++ b/docs/instructions/design-system/tokens.md');
      expect(r.stdout).toMatch(/^\+- color\.brand = #abcdef$/m);
      expect(r.stdout).toMatch(/^\+- spacing\.14 = 56px$/m);
    });

    it('emits no output for empty input', () => {
      const r = runScript(path, [], { input: '' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
    });
  });

  describe('propose-components-diff.sh', () => {
    const path = sh('propose-components-diff.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('emits a unified-diff hunk for components.md with the default skeleton', () => {
      const r = runScript(path, [], {
        input: ['Foo\tsrc/components/Foo.tsx', 'Bar\tsrc/components/Bar.tsx'].join('\n'),
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('--- a/docs/instructions/design-system/components.md');
      expect(r.stdout).toContain('+++ b/docs/instructions/design-system/components.md');
      expect(r.stdout).toMatch(/^\+## Foo$/m);
      expect(r.stdout).toMatch(/^\+## Bar$/m);
      expect(r.stdout).toMatch(/^\+- variants: TBD$/m);
      expect(r.stdout).toMatch(/^\+- states: default, hover, focus, disabled$/m);
    });

    it('emits no output for empty input', () => {
      const r = runScript(path, [], { input: '' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
    });
  });
});
