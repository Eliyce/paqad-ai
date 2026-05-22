import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/content/skills/script-writer';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('script-writer', () => {
  describe('estimate-runtime.sh', () => {
    const path = sh('estimate-runtime.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 with usage when no file', () => {
      expect(runScript(path).status).toBe(2);
    });

    it('counts only words on VO: lines and emits MM:SS runtime', () => {
      withTempDir((dir) => {
        // 150 words of VO at default 150wpm → 1:00.
        const vo = Array.from({ length: 30 }, () => '- **VO:** ' + 'word '.repeat(5).trim()).join(
          '\n',
        );
        const f = writeFile(dir, 'script.md', '# Header (not counted)\n' + vo + '\n');
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('Words: 150');
        expect(r.stdout).toContain('WPM: 150');
        expect(r.stdout).toContain('Runtime: 01:00');
      });
    });

    it('honors a custom WPM', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'script.md', '- **VO:** one two three four five\n');
        // 5 words at 60wpm → 5/60 min = 5 sec
        const r = runScript(path, [f, '60']);
        expect(r.stdout).toContain('Words: 5');
        expect(r.stdout).toContain('WPM: 60');
        expect(r.stdout).toContain('Runtime: 00:05');
      });
    });

    it('returns 00:00 when no VO lines exist', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'script.md', '# header only, no VO lines\n');
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('Words: 0');
        expect(r.stdout).toContain('Runtime: 00:00');
      });
    });
  });
});
