import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/spec-quality-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('spec-quality-review', () => {
  describe('scan-defects.sh', () => {
    const path = sh('scan-defects.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 1 when spec missing', () => {
      const r = runScript(path, ['/no/such/spec.md']);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/spec not found/);
    });

    it('emits header only when spec is clean', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'spec.md', '# clean spec\n\nGiven valid input, when X, then Y.\n');
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('category | line | excerpt');
      });
    });

    it('detects vague quantifiers', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'spec.md',
          'The system handles a reasonable number of requests.\n',
        );
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('vague-quantifier');
      });
    });

    it('detects missing-actor sentences', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'spec.md',
          'The system will be available.\nIt should validate input.\n',
        );
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('missing-actor');
      });
    });

    it('detects unbounded modals', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'spec.md', 'It might fail under load. Could degrade.\n');
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('unbounded-modal');
      });
    });

    it('detects TBD/TODO/FIXME leaks', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'spec.md', '## Spec\nTODO add details.\nFIXME schema unclear.\n');
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('tbd-leak');
      });
    });

    it('skips lines under "## Open Questions" and "TBD" lines', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'spec.md',
          [
            '# Spec',
            'Given valid input, when X, then Y.',
            '## Open Questions',
            '- It might be slow (this should be ignored)',
            '- TODO add docs (this should also be ignored under Open Questions)',
          ].join('\n'),
        );
        const r = runScript(path, [f]);
        // Only the header — no defects from the Open Questions section.
        expect(r.stdout.trim()).toBe('category | line | excerpt');
      });
    });

    it('detects goal-collision keywords', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'spec.md',
          'It should be fast. However, accuracy is more important.\n',
        );
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('goal-collision');
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid block with Findings', () => {
      const ok =
        '## Findings\n- High (vague-quantifier) — spec.md:42: ambiguous. Required clarification: pick a number.\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when "## Findings" missing', () => {
      const r = runScript(path, [], { input: 'no header here\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Findings/);
    });
  });
});
