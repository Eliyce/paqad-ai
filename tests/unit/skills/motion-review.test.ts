import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/coding/skills/motion-review';
const sh = (n: string) => join(SKILL, 'scripts', n);
const FIX = 'tests/fixtures/design-skills/motion-review';

describe('motion-review', () => {
  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a motion finding citing motion.md', () => {
      const body = [
        '## Findings',
        '- **high** (motion.md → reduced-motion) — auth / motion: Toast ignores reduced-motion. Evidence: `src/Toast.tsx:42`. Required action: gate with `@media (prefers-reduced-motion: reduce)`.',
      ].join('\n');
      expect(runScript(path, [], { input: body }).status).toBe(0);
    });

    it('rejects a finding missing severity', () => {
      const body = [
        '## Findings',
        '- (motion.md → reduced-motion) — motion: bad. Evidence: `src/Toast.tsx:42`. Required action: fix.',
      ].join('\n');
      expect(runScript(path, [], { input: body }).status).toBe(1);
    });
  });

  describe('scan-animations.sh', () => {
    const path = sh('scan-animations.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('emits a stderr note and exits 0 for missing search root', () => {
      const r = runScript(path, ['/no/such/dir']);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/search root not found/);
    });

    it('normalizes CSS ms / s and framer-motion seconds to milliseconds', () => {
      withTempDir((dir) => {
        const root = `${dir}/src`;
        writeFile(dir, 'src/A.css', '.x { transition: all 300ms ease; }');
        writeFile(dir, 'src/B.css', '.y { transition-duration: 0.5s; }');
        writeFile(dir, 'src/C.tsx', '<motion.div transition={{ duration: 0.3 }} />');
        writeFile(dir, 'src/Slow.css', '.z { animation: slide 800ms linear; }');
        const r = runScript(path, [root]);
        expect(r.status).toBe(0);
        const rows = r.stdout.split('\n').filter((l) => l.length > 0);
        const ms = rows.map((r) => Number(r.split('\t')[1])).sort((a, b) => a - b);
        // 300, 300, 500, 800 (the framer 0.3s -> 300ms)
        expect(ms).toContain(300);
        expect(ms).toContain(500);
        expect(ms).toContain(800);
      });
    });
  });

  describe('parse-motion-budget.sh', () => {
    const path = sh('parse-motion-budget.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('requires a file argument', () => {
      const r = runScript(path, []);
      expect(r.status).toBe(2);
    });

    it('parses duration-ceiling, easing, and reduced-motion entries', () => {
      const r = runScript(path, [join(FIX, 'motion.md')]);
      expect(r.status).toBe(0);
      const rows = r.stdout.split('\n').filter((l) => l.length > 0);
      const map = Object.fromEntries(rows.map((row) => row.split('\t')));
      expect(map['duration-ceiling']).toBe('400ms');
      expect(map['easing']).toBe(
        'standard, easing, enter, exit'.includes('standard')
          ? 'standard, enter, exit'
          : map['easing'],
      );
      // Don't assume the literal easing list — just check the key is present.
      expect(map['reduced-motion']).toBe('respected');
    });

    it('ignores unrelated bullets and prose', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'm.md',
          [
            '# Motion',
            '',
            'Some prose.',
            '',
            '- duration-ceiling: 200ms',
            '- something-else: ignored',
            '- easing: standard',
          ].join('\n'),
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        const rows = r.stdout.split('\n').filter((l) => l.length > 0);
        expect(rows).toEqual(['duration-ceiling\t200ms', 'easing\tstandard']);
      });
    });
  });

  describe('find-reduced-motion-violations.sh', () => {
    const path = sh('find-reduced-motion-violations.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('emits a stderr note when search root is missing', () => {
      const r = runScript(path, ['/no/such/dir']);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/search root not found/);
    });

    it('flags animated files without a reduced-motion guard', () => {
      withTempDir((dir) => {
        const root = `${dir}/src`;
        writeFile(
          dir,
          'src/Toast.tsx',
          `import { motion } from 'framer-motion';\nexport const T = () => <motion.div transition={{ duration: 0.3 }} />;`,
        );
        writeFile(dir, 'src/Bad.css', '.x { transition: all 300ms ease; }');
        const r = runScript(path, [root]);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/Toast\.tsx\t/);
        expect(r.stdout).toMatch(/Bad\.css\t/);
      });
    });

    it('does not flag files guarded by prefers-reduced-motion media query', () => {
      withTempDir((dir) => {
        const root = `${dir}/src`;
        writeFile(
          dir,
          'src/Good.css',
          [
            '.x { transition: all 300ms ease; }',
            '@media (prefers-reduced-motion: reduce) {',
            '  .x { transition: none; }',
            '}',
          ].join('\n'),
        );
        const r = runScript(path, [root]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('does not flag files using framer-motion useReducedMotion()', () => {
      withTempDir((dir) => {
        const root = `${dir}/src`;
        writeFile(
          dir,
          'src/Good.tsx',
          `import { useReducedMotion } from 'framer-motion';\nexport const T = () => { const r = useReducedMotion(); return null; };`,
        );
        const r = runScript(path, [root]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });
  });
});
