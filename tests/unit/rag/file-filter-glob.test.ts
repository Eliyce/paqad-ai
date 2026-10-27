import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { matchesGlob, posix } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';

const minimatchCompiles = vi.hoisted(() => ({ count: 0 }));

vi.mock('minimatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('minimatch')>();
  class CountingMinimatch extends actual.Minimatch {
    constructor(...args: ConstructorParameters<typeof actual.Minimatch>) {
      super(...args);
      minimatchCompiles.count += 1;
    }
  }
  return { ...actual, Minimatch: CountingMinimatch };
});

import { compileProjectGlob, RagFileFilter } from '@/rag/file-filter.js';

function legacyMatchesProjectGlob(relativePath: string, pattern: string): boolean {
  const normalizedPath = toPosixPath(relativePath);
  const rawPattern = toPosixPath(pattern);
  const directoryPattern = rawPattern.endsWith('/');
  const normalizedPattern = rawPattern.replace(/^\/+|\/+$/g, '');
  if (!normalizedPattern) {
    return false;
  }
  const candidates = new Set<string>([normalizedPattern]);
  if (!normalizedPattern.startsWith('**/')) {
    candidates.add(`**/${normalizedPattern}`);
  }
  if (directoryPattern) {
    candidates.add(`${normalizedPattern}/**`);
    candidates.add(`**/${normalizedPattern}/**`);
  }
  return [...candidates].some((candidate) => matchesGlob(normalizedPath, candidate));
}

const INCLUDE_EXCLUDE_PATTERNS = [
  'docs/**',
  'docs/',
  'docs/keep.md',
  'custom/**',
  '**/*.md',
  '*.md',
  'src/**/*.ts',
];

const IGNORE_FILE_PATTERNS = [
  '**/node_modules/**',
  'node_modules/**',
  'packages/app/**/nested.md',
  'packages/app/nested.md',
  '/build',
  'build/',
  './local.md',
];

const NEGATION_PATTERNS = ['!docs/keep.md', '!*.md'];

const DOTFILE_PATTERNS = ['.env', '.env.*', '.github/**', '**/.cache/**', '*', '**'];

const NESTED_AND_SYNTAX_PATTERNS = [
  'a/b/c/',
  'a/**/c/*.md',
  '{docs,guides}/*.md',
  'file[0-9].md',
  'file?.md',
  '+(foo|bar).md',
  'README.MD',
  'a\\b.md',
  '',
  '/',
];

const PATTERNS = [
  ...INCLUDE_EXCLUDE_PATTERNS,
  ...IGNORE_FILE_PATTERNS,
  ...NEGATION_PATTERNS,
  ...DOTFILE_PATTERNS,
  ...NESTED_AND_SYNTAX_PATTERNS,
];

const RELATIVE_PATHS = [
  'README.md',
  'readme.md',
  'local.md',
  'docs/keep.md',
  'docs/drop.md',
  'docs/deep/inner.md',
  'guides/intro.md',
  'custom/keep.md',
  'node_modules/pkg/readme.md',
  'vendor/node_modules/pkg/index.md',
  'packages/app/nested.md',
  'packages/app/sub/nested.md',
  'build/out.md',
  'tools/build/out.md',
  'src/index.ts',
  'src/deep/mod.ts',
  '.env',
  '.env.local',
  'config/.env.production',
  '.github/workflows/ci.yml',
  'x/.cache/data.json',
  '.hidden.md',
  'docs/.hidden.md',
  'a/b/c/file.md',
  'z/a/b/c/file.md',
  'a/x/y/c/note.md',
  'file1.md',
  'fileA.md',
  'foo.md',
  'foobar.md',
  'a/b.md',
  '!docs/keep.md',
];

describe('compileProjectGlob', () => {
  it('matches exactly what path.matchesGlob did for every pattern and path', () => {
    const mismatches: string[] = [];
    for (const pattern of PATTERNS) {
      const matches = compileProjectGlob(pattern);
      for (const path of RELATIVE_PATHS) {
        const expected = legacyMatchesProjectGlob(path, pattern);
        if (matches(path) !== expected) {
          mismatches.push(`${JSON.stringify(pattern)} vs ${path}: expected ${expected}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('exercises both outcomes so the comparison is not vacuous', () => {
    const outcomes = new Set(
      PATTERNS.flatMap((pattern) =>
        RELATIVE_PATHS.map((path) => legacyMatchesProjectGlob(path, pattern)),
      ),
    );
    expect(outcomes).toEqual(new Set([true, false]));
  });
});

describe('RagFileFilter glob compilation', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function writeProjectFile(root: string, path: string, content: string) {
    const target = posix.join(root, path);
    mkdirSync(posix.join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }

  function writeText(root: string, path: string) {
    writeProjectFile(root, path, `${path}\n${'x'.repeat(80)}\n`);
  }

  it('compiles each glob once per discovery pass, whatever the number of files', async () => {
    const root = toPosixPath(mkdtempSync(posix.join(toPosixPath(tmpdir()), 'paqad-rag-glob-')));
    tempRoots.push(root);
    writeProjectFile(root, '.gitignore', 'ignored.md\nlogs/\n');
    writeProjectFile(
      root,
      PATHS.RAG_IGNORE_CONFIG,
      ['version: 1', 'exclude:', '  - custom/**', 'include:', '  - custom/keep.md'].join('\n'),
    );
    for (let index = 0; index < 40; index += 1) {
      writeText(root, `docs/page-${index}.md`);
    }
    writeText(root, 'ignored.md');
    writeText(root, 'logs/run.md');
    writeText(root, 'custom/drop.md');
    writeText(root, 'custom/keep.md');

    minimatchCompiles.count = 0;
    const filter = new RagFileFilter({ projectRoot: root, packs: [] });
    const files = await filter.discoverFiles();

    expect(files).toHaveLength(41);
    expect(files).toContain(posix.join(root, 'custom/keep.md'));
    expect(files).not.toContain(posix.join(root, 'ignored.md'));
    expect(files).not.toContain(posix.join(root, 'logs/run.md'));
    expect(files).not.toContain(posix.join(root, 'custom/drop.md'));
    expect(minimatchCompiles.count).toBe(10);
  });
});
