import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/coding/skills/responsive-review';
const sh = (n: string) => join(SKILL, 'scripts', n);
const FIX = 'tests/fixtures/design-skills/responsive-review';

describe('responsive-review', () => {
  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a responsive finding', () => {
      const body = [
        '## Findings',
        '- **high** (responsive.md → breakpoint:sm) — auth / responsive: horizontal scroll at 640px. Evidence: `src/Pricing.tsx:18`. Required action: wrap cards below sm.',
      ].join('\n');
      expect(runScript(path, [], { input: body }).status).toBe(0);
    });

    it('rejects empty Findings block', () => {
      const r = runScript(path, [], { input: '## Findings\n' });
      expect(r.status).toBe(1);
    });
  });

  describe('extract-breakpoints.sh', () => {
    const path = sh('extract-breakpoints.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('requires a file argument', () => {
      const r = runScript(path, []);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/responsive\.md path is required/);
    });

    it('parses each declared breakpoint as <name>\\t<width>', () => {
      const r = runScript(path, [join(FIX, 'responsive.md')]);
      expect(r.status).toBe(0);
      const rows = r.stdout.split('\n').filter((l) => l.length > 0);
      expect(rows).toEqual(['sm\t640', 'md\t768', 'lg\t1024', 'xl\t1280']);
    });

    it('ignores prose and non-breakpoint bullets', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'r.md',
          [
            '# Responsive',
            '',
            'Some prose about responsiveness.',
            '',
            '- sm: 640',
            '- not a breakpoint',
            '- minimum tap area: 24x24 CSS pixels',
            '- xl: 1280',
          ].join('\n'),
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        const rows = r.stdout.split('\n').filter((l) => l.length > 0);
        expect(rows).toEqual(['sm\t640', 'xl\t1280']);
      });
    });
  });

  describe('find-horizontal-scroll.sh', () => {
    const path = sh('find-horizontal-scroll.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('requires a file argument', () => {
      const r = runScript(path, []);
      expect(r.status).toBe(2);
    });

    it('lists every (route, breakpoint) pair with horizontalScroll=true', () => {
      const r = runScript(path, [join(FIX, 'runtime-checks.json')]);
      expect(r.status).toBe(0);
      const rows = r.stdout.split('\n').filter((l) => l.length > 0);
      expect(rows).toEqual(['/\tsm\t720\t640', '/pricing\tlg\t1200\t1024']);
    });

    it('emits no rows when no breakpoint reports horizontalScroll', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'rc.json',
          JSON.stringify({
            routes: [{ path: '/', breakpoints: [{ name: 'lg', horizontalScroll: false }] }],
          }),
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('rejects payloads without a routes array', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'bad.json', '{ "no": "routes" }');
        const r = runScript(path, [f]);
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/expected runtime-checks payload/);
      });
    });
  });

  describe('find-touch-target-violations.sh', () => {
    const path = sh('find-touch-target-violations.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('rejects non-numeric --min', () => {
      const r = runScript(path, ['--min', 'big']);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/positive integer/);
    });

    it('detects CSS width/height below the default 24px minimum', () => {
      withTempDir((dir) => {
        const root = `${dir}/src`;
        writeFile(dir, 'src/Tiny.css', '.icon { width: 18px; height: 18px; }');
        writeFile(dir, 'src/Big.css', '.icon { width: 48px; }');
        const r = runScript(path, [root]);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/Tiny\.css.*\t18\t/);
        expect(r.stdout).not.toMatch(/Big\.css/);
      });
    });

    it('detects Tailwind w-N / h-N utilities below the floor', () => {
      withTempDir((dir) => {
        const root = `${dir}/src`;
        writeFile(dir, 'src/IconButton.tsx', '<button className="w-4 h-4" />');
        writeFile(dir, 'src/Ok.tsx', '<button className="w-6 h-6" />');
        const r = runScript(path, [root]);
        expect(r.status).toBe(0);
        // w-4 = 4*4 = 16px < 24 → violation
        expect(r.stdout).toMatch(/IconButton\.tsx.*\t16\t/);
        // w-6 = 24px → at the threshold, not a violation
        expect(r.stdout).not.toMatch(/Ok\.tsx/);
      });
    });

    it('respects a custom --min', () => {
      withTempDir((dir) => {
        const root = `${dir}/src`;
        writeFile(dir, 'src/M.css', '.tap { width: 36px; }');
        const r = runScript(path, [root, '--min', '44']);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/M\.css.*\t36\t/);
      });
    });
  });
});
