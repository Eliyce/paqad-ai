import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/coding/skills/component-conformance-review';
const sh = (n: string) => join(SKILL, 'scripts', n);
const FIX = 'tests/fixtures/design-skills/component-conformance-review';

describe('component-conformance-review', () => {
  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a well-formed component finding', () => {
      const body = [
        '## Findings',
        '- **high** (components.md → Button) — auth / component: variant `ghost` declared but not implemented. Evidence: `src/Button.tsx:1`. Required action: add `variant: ghost`.',
      ].join('\n');
      const r = runScript(path, [], { input: body });
      expect(r.status).toBe(0);
    });

    it('rejects findings without a contract_ref or evidence', () => {
      const body = ['## Findings', '- **high** — component: bad. Required action: fix.'].join('\n');
      const r = runScript(path, [], { input: body });
      expect(r.status).toBe(1);
    });
  });

  describe('derive-inventory.sh', () => {
    const path = sh('derive-inventory.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('emits empty output and a stderr note for missing directory', () => {
      const r = runScript(path, ['/no/such/dir']);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
      expect(r.stderr).toMatch(/components dir not found/);
    });

    it('lists each component file by name', () => {
      withTempDir((dir) => {
        const root = `${dir}/src/components`;
        writeFile(dir, 'src/components/Button.tsx', 'export const Button = () => null;');
        writeFile(dir, 'src/components/Input.tsx', 'export const Input = () => null;');
        writeFile(dir, 'src/components/Card.jsx', 'export const Card = () => null;');
        const r = runScript(path, [root]);
        expect(r.status).toBe(0);
        const names = r.stdout
          .split('\n')
          .filter((l) => l.length > 0)
          .map((l) => l.split('\t')[0])
          .sort();
        expect(names).toEqual(['Button', 'Card', 'Input']);
      });
    });

    it('excludes test, story, type-decl, and barrel files', () => {
      withTempDir((dir) => {
        const root = `${dir}/src/components`;
        writeFile(dir, 'src/components/Button.tsx', 'x');
        writeFile(dir, 'src/components/Button.test.tsx', 'x');
        writeFile(dir, 'src/components/Button.spec.tsx', 'x');
        writeFile(dir, 'src/components/Button.stories.tsx', 'x');
        writeFile(dir, 'src/components/types.d.ts', 'x');
        writeFile(dir, 'src/components/index.ts', 'x');
        const r = runScript(path, [root]);
        expect(r.status).toBe(0);
        const names = r.stdout
          .split('\n')
          .filter((l) => l.length > 0)
          .map((l) => l.split('\t')[0]);
        expect(names).toEqual(['Button']);
      });
    });

    it('skips lower-case helper files with a stderr note', () => {
      withTempDir((dir) => {
        const root = `${dir}/src/components`;
        writeFile(dir, 'src/components/helpers.ts', 'x');
        writeFile(dir, 'src/components/Button.tsx', 'x');
        const r = runScript(path, [root]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('Button');
        expect(r.stdout).not.toContain('helpers');
        expect(r.stderr).toMatch(/skipping non-component file.*helpers\.ts/);
      });
    });
  });

  describe('parse-components-md.sh', () => {
    const path = sh('parse-components-md.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('requires a file argument', () => {
      const r = runScript(path, []);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/components\.md path is required/);
    });

    it('parses each declared component with its variants and states', () => {
      const r = runScript(path, [join(FIX, 'components.md')]);
      expect(r.status).toBe(0);
      const rows = r.stdout.split('\n').filter((l) => l.length > 0);
      // Fixture: Button, Input, Card, GhostComponent
      expect(rows.length).toBe(4);
      const map = Object.fromEntries(
        rows.map((r) => {
          const [name, variants, states] = r.split('\t');
          return [name, { variants, states }];
        }),
      );
      expect(map.Button.variants).toBe('primary,secondary,ghost');
      expect(map.Button.states).toBe('default,hover,focus,disabled,loading');
      expect(map.Input.variants).toBe('text,password');
      expect(map.GhostComponent.variants).toBe('-');
      expect(map.GhostComponent.states).toBe('-');
    });
  });

  describe('diff-inventories.sh', () => {
    const path = sh('diff-inventories.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('rejects missing --source / --declared with usage error', () => {
      expect(runScript(path, []).status).toBe(2);
      expect(runScript(path, ['--source', '/no/such']).status).toBe(2);
    });

    it('emits in-source-not-declared and declared-not-in-source set differences', () => {
      withTempDir((dir) => {
        const src = writeFile(
          dir,
          'inv.tsv',
          [
            'Button\tsrc/components/Button.tsx',
            'Input\tsrc/components/Input.tsx',
            'Modal\tsrc/components/Modal.tsx',
          ].join('\n'),
        );
        const dec = writeFile(
          dir,
          'declared.tsv',
          ['Button\tprimary\tdefault,hover', 'Input\ttext\tdefault', 'Dropdown\t-\t-'].join('\n'),
        );
        const r = runScript(path, ['--source', src, '--declared', dec]);
        expect(r.status).toBe(0);
        const lines = r.stdout.split('\n').filter((l) => l.length > 0);
        expect(lines).toContain('in-source-not-declared\tModal\tsrc/components/Modal.tsx');
        expect(lines).toContain('declared-not-in-source\tDropdown\t-');
        // Components that appear on both sides emit no rows.
        expect(lines.find((l) => l.includes('\tButton\t'))).toBeUndefined();
        expect(lines.find((l) => l.includes('\tInput\t'))).toBeUndefined();
      });
    });

    it('emits no rows when both inventories agree', () => {
      withTempDir((dir) => {
        const src = writeFile(dir, 'inv.tsv', 'Button\tsrc/components/Button.tsx');
        const dec = writeFile(dir, 'declared.tsv', 'Button\tprimary\tdefault');
        const r = runScript(path, ['--source', src, '--declared', dec]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });
  });
});
