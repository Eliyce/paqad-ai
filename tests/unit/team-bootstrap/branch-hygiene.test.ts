import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = process.cwd();
const PERSONAL_PATH =
  /(?<![\w.~-])(?:\/Users\/[^/\s"'`]+|\/home\/[^/\s"'`]+|[A-Za-z]:\\\\?Users\\\\?[^\\\s"'`]+)/;

function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

const base = git('merge-base', 'HEAD', 'origin/main')?.trim() || null;
const NO_BASE = 'origin/main is not available in this checkout, so there is no branch diff';

describe('the branch stays portable', () => {
  it('AC-25: no added line in the branch diff holds an absolute home path', (ctx) => {
    if (!base) return ctx.skip(NO_BASE);
    const diff = git('diff', `${base}...HEAD`) ?? '';
    const hits = diff
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .filter((line) => PERSONAL_PATH.test(line));
    expect(hits).toEqual([]);
  });

  it('AC-25: the per-session notice folder stays git-ignored', () => {
    expect(
      git('check-ignore', '--no-index', '.paqad/session/team-bootstrap-notice.d/some-session'),
    ).not.toBeNull();
  });

  it('AC-42: a changeset added on this branch is a minor one in plain words', (ctx) => {
    if (!base) return ctx.skip(NO_BASE);
    const added = (
      git('diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', '.changeset') ?? ''
    )
      .split('\n')
      .filter((name) => name.endsWith('.md') && !name.endsWith('README.md'));
    for (const name of added) {
      const text = readFileSync(join(REPO, name), 'utf8');
      expect(text).toMatch(/^---\n'paqad-ai': (minor|patch|major)\n---\n/);
    }
    if (added.length > 0) {
      expect(
        added.some((name) => readFileSync(join(REPO, name), 'utf8').includes("'paqad-ai': minor")),
      ).toBe(true);
    }
  });
});
