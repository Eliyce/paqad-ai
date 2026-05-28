import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/coding/skills/state-coverage-review';
const sh = (n: string) => join(SKILL, 'scripts', n);
const FIX = 'tests/fixtures/design-skills/state-coverage-review';

describe('state-coverage-review', () => {
  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a well-formed state finding', () => {
      const body = [
        '## Findings',
        '- **high** (components.md → Button > focus) — auth / state: focus state not implemented. Evidence: `src/Button.tsx:1`. Required action: add focus-visible ring.',
      ].join('\n');
      expect(runScript(path, [], { input: body }).status).toBe(0);
    });

    it('rejects findings with no Findings heading', () => {
      const r = runScript(path, [], { input: '- nope' });
      expect(r.status).toBe(1);
    });
  });

  describe('extract-source-states.sh', () => {
    const path = sh('extract-source-states.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('errors with exit 2 on missing component file', () => {
      const r = runScript(path, ['/no/such/file.tsx']);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/file not found/);
    });

    it('always emits the default state', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'Empty.tsx', 'export const Empty = () => <div/>;');
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        const states = r.stdout
          .split('\n')
          .filter((l) => l.length > 0)
          .map((l) => l.split('\t')[0]);
        expect(states).toContain('default');
      });
    });

    it('detects hover, focus, disabled, and loading on the Button fixture', () => {
      const r = runScript(path, [join(FIX, 'Button.tsx')]);
      expect(r.status).toBe(0);
      const states = r.stdout
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => l.split('\t')[0]);
      expect(states).toContain('default');
      expect(states).toContain('hover');
      expect(states).toContain('focus');
      expect(states).toContain('disabled');
      expect(states).toContain('loading');
      expect(states).not.toContain('error');
      expect(states).not.toContain('empty');
    });
  });

  describe('extract-tested-states.sh', () => {
    const path = sh('extract-tested-states.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('requires --component and --tests', () => {
      expect(runScript(path, []).status).toBe(2);
      expect(runScript(path, ['--component', 'Button']).status).toBe(2);
    });

    it('emits a stderr note and exits 0 when tests dir is missing', () => {
      const r = runScript(path, ['--component', 'Button', '--tests', '/no/such/dir']);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/tests dir not found/);
    });

    it('detects default, hover, focus, disabled states exercised in Button.e2e.ts', () => {
      const r = runScript(path, ['--component', 'Button', '--tests', join(FIX, 'e2e')]);
      expect(r.status).toBe(0);
      const states = r.stdout
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => l.split('\t')[0]);
      // Default is implicit for every file that mentions the component.
      expect(states).toContain('default');
      expect(states).toContain('hover');
      expect(states).toContain('focus');
      expect(states).toContain('disabled');
      expect(states).not.toContain('loading');
    });

    it('emits empty output when no test file mentions the component', () => {
      const r = runScript(path, ['--component', 'NotAComponent', '--tests', join(FIX, 'e2e')]);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
    });
  });

  describe('cross-reference-states.sh', () => {
    const path = sh('cross-reference-states.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('rejects missing required flags', () => {
      expect(runScript(path, []).status).toBe(2);
      expect(runScript(path, ['--declared', 'a,b']).status).toBe(2);
    });

    it('emits declared-not-implemented, implemented-not-tested, tested-not-implemented gaps', () => {
      withTempDir((dir) => {
        const impl = writeFile(
          dir,
          'impl.tsv',
          ['default\timplicit', 'focus\tcss-pseudo', 'disabled\tprop'].join('\n'),
        );
        const tested = writeFile(
          dir,
          'tested.tsv',
          ['default\tButton.test', 'focus\tButton.test', 'loading\tButton.test'].join('\n'),
        );
        const r = runScript(path, [
          '--declared',
          'default,focus,disabled,loading,error',
          '--implemented',
          impl,
          '--tested',
          tested,
        ]);
        expect(r.status).toBe(0);
        const rows = r.stdout.split('\n').filter((l) => l.length > 0);
        // declared - implemented = loading, error
        expect(rows).toContain('declared-not-implemented\terror');
        expect(rows).toContain('declared-not-implemented\tloading');
        // implemented - tested = disabled
        expect(rows).toContain('implemented-not-tested\tdisabled');
        // tested - implemented = loading
        expect(rows).toContain('tested-not-implemented\tloading');
      });
    });

    it('emits no rows when every set agrees', () => {
      withTempDir((dir) => {
        const impl = writeFile(dir, 'impl.tsv', ['default\timplicit', 'focus\tcss'].join('\n'));
        const tested = writeFile(dir, 'tested.tsv', ['default\tf', 'focus\tf'].join('\n'));
        const r = runScript(path, [
          '--declared',
          'default,focus',
          '--implemented',
          impl,
          '--tested',
          tested,
        ]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });
  });
});
