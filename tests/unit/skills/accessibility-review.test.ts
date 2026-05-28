import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/coding/skills/accessibility-review';
const sh = (n: string) => join(SKILL, 'scripts', n);
const FIX = 'tests/fixtures/design-skills/accessibility-review';

describe('accessibility-review', () => {
  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a finding citing a WCAG id as contract_ref', () => {
      const body = [
        '## Findings',
        '- **blocker** (WCAG-2.2-1.4.3) — auth / a11y: contrast 3.8:1. Evidence: `src/Button.tsx:34`. Required action: darken `color.text.muted`.',
      ].join('\n');
      expect(runScript(path, [], { input: body }).status).toBe(0);
    });

    it('rejects a finding with no WCAG id and no contract file', () => {
      const body = [
        '## Findings',
        '- **high** — a11y: bad. Evidence: `src/Button.tsx:34`. Required action: fix.',
      ].join('\n');
      const r = runScript(path, [], { input: body });
      expect(r.status).toBe(1);
    });
  });

  describe('static-a11y-scan.sh', () => {
    const path = sh('static-a11y-scan.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('emits a stderr note and exits 0 for a missing search root', () => {
      const r = runScript(path, ['/no/such/dir']);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/search root not found/);
    });

    it('detects img-no-alt, button-no-name, positive-tabindex, outline-zero', () => {
      withTempDir((dir) => {
        const root = `${dir}/src`;
        writeFile(dir, 'src/A.tsx', '<img src="hero.jpg" width="800" />');
        writeFile(dir, 'src/B.tsx', '<button className="icon-only" />');
        writeFile(dir, 'src/C.tsx', '<div tabIndex="3">hi</div>');
        writeFile(dir, 'src/D.css', '.x { outline: none; }');
        const r = runScript(path, [root]);
        expect(r.status).toBe(0);
        const cats = r.stdout
          .split('\n')
          .filter((l) => l.length > 0)
          .map((l) => l.split('\t')[0]);
        expect(cats).toContain('img-no-alt');
        expect(cats).toContain('button-no-name');
        expect(cats).toContain('positive-tabindex');
        expect(cats).toContain('outline-zero');
      });
    });

    it('skips img tags that already have alt', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/Good.tsx', '<img src="hero.jpg" alt="Hero banner" />');
        const r = runScript(path, [`${dir}/src`]);
        expect(r.status).toBe(0);
        expect(r.stdout).not.toContain('img-no-alt');
      });
    });

    it('skips test/spec/stories files via the exclude list', () => {
      withTempDir((dir) => {
        writeFile(dir, 'src/A.test.tsx', '<img src="x" />');
        writeFile(dir, 'src/A.stories.tsx', '<img src="x" />');
        const r = runScript(path, [`${dir}/src`]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });
  });

  describe('parse-axe-violations.sh', () => {
    const path = sh('parse-axe-violations.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('errors with exit 2 on missing file', () => {
      const r = runScript(path, ['/no/such/file.json']);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/file not found/);
    });

    it('errors with exit 2 on invalid JSON', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'bad.json', '{ not json');
        const r = runScript(path, [f]);
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/invalid JSON/);
      });
    });

    it('emits one row per (route, rule, node) triple from a runtime-checks payload', () => {
      const r = runScript(path, [join(FIX, 'axe-results.json')]);
      expect(r.status).toBe(0);
      const rows = r.stdout.split('\n').filter((l) => l.length > 0);
      // Fixture has 3 nodes total across two violations on '/', 0 on '/pricing'.
      expect(rows.length).toBe(3);
      expect(rows).toContain(
        '/\tcolor-contrast\tserious\tmain > p.muted\tElements must meet minimum color contrast ratio thresholds',
      );
      expect(rows).toContain(
        '/\tcolor-contrast\tserious\tnav > a\tElements must meet minimum color contrast ratio thresholds',
      );
      expect(rows).toContain(
        '/\tbutton-name\tcritical\tbutton.icon-only\tButtons must have discernible text',
      );
    });

    it('accepts a bare array of violations (test-scaffolding shape)', () => {
      withTempDir((dir) => {
        const payload = JSON.stringify([
          {
            id: 'image-alt',
            impact: 'critical',
            help: 'Images must have alt text',
            nodes: [{ target: ['img.hero'] }],
          },
        ]);
        const f = writeFile(dir, 'a.json', payload);
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe(
          '(route-unknown)\timage-alt\tcritical\timg.hero\tImages must have alt text',
        );
      });
    });
  });

  describe('map-axe-to-wcag.sh', () => {
    const path = sh('map-axe-to-wcag.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('maps known axe rules to their WCAG criteria', () => {
      const cases: Array<[string, string]> = [
        ['color-contrast', 'WCAG-2.2-1.4.3'],
        ['image-alt', 'WCAG-2.2-1.1.1'],
        ['button-name', 'WCAG-2.2-4.1.2'],
        ['link-name', 'WCAG-2.2-2.4.4'],
        ['label', 'WCAG-2.2-1.3.1'],
        ['target-size', 'WCAG-2.2-2.5.8'],
        ['html-has-lang', 'WCAG-2.2-3.1.1'],
      ];
      for (const [rule, wcag] of cases) {
        const r = runScript(path, [rule]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe(wcag);
      }
    });

    it('reads the rule id from stdin', () => {
      const r = runScript(path, [], { input: 'color-contrast' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('WCAG-2.2-1.4.3');
    });

    it('emits WCAG-UNKNOWN with a stderr note for unmapped rules', () => {
      const r = runScript(path, ['some-future-axe-rule']);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('WCAG-UNKNOWN');
      expect(r.stderr).toMatch(/not in mapping table/);
    });

    it('exits 2 when no rule id is provided', () => {
      const r = runScript(path, [], { input: '' });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/axe rule id is required/);
    });
  });
});
