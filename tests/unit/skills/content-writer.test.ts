import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/content/skills/content-writer';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('content-writer', () => {
  describe('check-coverage.sh', () => {
    const path = sh('check-coverage.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 when args missing', () => {
      expect(runScript(path).status).toBe(2);
    });

    it('exits 0 with "ok" when every brief outline section appears in draft', () => {
      withTempDir((dir) => {
        const brief = writeFile(
          dir,
          'brief.md',
          '## Outline\n1. Hook — opening\n2. Body — middle\n3. CTA — close\n',
        );
        const draft = writeFile(
          dir,
          'draft.md',
          '# Title\n\n## Hook\n...\n## Body\n...\n## CTA\n...\n',
        );
        const r = runScript(path, [brief, draft]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('ok');
      });
    });

    it('exits 1 listing each missing section', () => {
      withTempDir((dir) => {
        const brief = writeFile(
          dir,
          'brief.md',
          '## Outline\n1. Hook — opening\n2. Body — middle\n3. CTA — close\n',
        );
        const draft = writeFile(dir, 'draft.md', '# Title\n## Hook\n...\n');
        const r = runScript(path, [brief, draft]);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('Body');
        expect(r.stderr).toContain('CTA');
      });
    });
  });

  describe('word-count.sh', () => {
    const path = sh('word-count.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('counts plain-text words', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'd.md', 'one two three four five\n');
        const r = runScript(path, [f]);
        expect(r.stdout.trim()).toBe('5');
      });
    });

    it('excludes frontmatter', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'd.md', '---\ntitle: foo bar baz qux\n---\n\nbody one two\n');
        const r = runScript(path, [f]);
        // Only "body one two" counts → 3 words
        expect(r.stdout.trim()).toBe('3');
      });
    });

    it('excludes fenced code blocks', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'd.md',
          'body one two\n\n```ts\nthese words should not count\n```\n\nmore body text\n',
        );
        const r = runScript(path, [f]);
        // "body one two" + "more body text" = 6 words.
        expect(r.stdout.trim()).toBe('6');
      });
    });

    it('exits 2 when file missing arg', () => {
      expect(runScript(path).status).toBe(2);
    });
  });
});
