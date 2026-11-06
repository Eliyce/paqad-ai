import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import { activeChangeFiles } from '@/pipeline/change-evidence.js';

import { commitAll, git, makeEmptyRepo, writeRepoFile } from './changed-files.fixture.js';
import { cleanupOwnChanges, ownChangeRepo } from '../verification/own-change.fixture.js';

const S = 'ses_own_files';

afterEach(cleanupOwnChanges);

describe('activeChangeFiles', () => {
  it('AC-4: a change with no edits has a proven empty set', () => {
    expect(activeChangeFiles(ownChangeRepo(S).root, S)).toEqual([]);
  });

  it('AC-20: it counts committed-only edits', () => {
    const { root } = ownChangeRepo(S);
    writeRepoFile(root, 'b.ts', 'export const b = 2;\n');
    commitAll(root, 'feat: b');
    expect(activeChangeFiles(root, S)).toEqual(['b.ts']);
  });

  it('AC-20: it counts untracked-only edits', () => {
    const { root } = ownChangeRepo(S);
    writeRepoFile(root, 'src/new.ts', 'export const n = 1;\n');
    expect(activeChangeFiles(root, S)).toEqual(['src/new.ts']);
  });

  it('AC-19: a renamed file counts under its new path', () => {
    const { root } = ownChangeRepo(S);
    git(root, ['mv', 'b.ts', 'c.ts']);
    commitAll(root, 'refactor: rename');
    expect(activeChangeFiles(root, S)).toEqual(['c.ts']);
  });

  it('AC-4: a project with no open change reads null', () => {
    const root = makeEmptyRepo('main');
    try {
      expect(activeChangeFiles(root, S)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC-4: an unproven set reads null: another branch, detached HEAD', () => {
    const { root } = ownChangeRepo(S);
    git(root, ['switch', '-q', 'main']);
    expect(activeChangeFiles(root, S)).toBeNull();

    git(root, ['switch', '-q', '--detach', 'feat/own']);
    expect(activeChangeFiles(root, S)).toBeNull();
  });

  it('AC-4: a repo gone reads null, never empty', () => {
    const { root } = ownChangeRepo(S);
    rmSync(join(root, '.git'), { recursive: true, force: true });
    expect(activeChangeFiles(root, S)).toBeNull();
  });

  it('AC-4: a fallback-base start point reads null', () => {
    const { root, dir } = ownChangeRepo(S);
    writeFileSync(
      join(root, featureFilePath(dir, 'delivery')),
      JSON.stringify({ branch: 'feat/own' }),
    );
    git(root, ['branch', '-q', '-D', 'main']);
    expect(activeChangeFiles(root, S)).toBeNull();
  });
});
