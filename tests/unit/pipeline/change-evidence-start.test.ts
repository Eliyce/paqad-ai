import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadChangeEvidence, readGitChangedFiles } from '@/pipeline/change-evidence.js';
import { writeReviewDigest } from '@/review-digest/write.js';
import { gatherTraceabilityInputs } from '@/traceability/inputs.js';

import { cleanupScopeFixtures, openChangeHere, repoRoot } from '../hud/scope-fixtures.js';

const SESSION = 'ses-start-default';

function changeWithLocalFile(): string {
  const root = repoRoot();
  writeFileSync(join(root, 'local.txt'), 'untracked before open\n');
  openChangeHere(root, SESSION);
  writeFileSync(join(root, 'made.ts'), 'export const made = 1;\n');
  return root;
}

describe('FR-9 / INV-3: callers that pass no start point measure from where the change started', () => {
  beforeEach(() => {
    vi.stubEnv('SE_SESSION', '');
    vi.stubEnv('CLAUDE_SESSION_ID', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    cleanupScopeFixtures();
  });

  it('loadChangeEvidence and readGitChangedFiles leave out a file untracked before the change opened', async () => {
    const root = changeWithLocalFile();
    expect((await loadChangeEvidence(root)).files).toEqual(['made.ts']);
    expect(await readGitChangedFiles(root)).toEqual(['made.ts']);
  });

  it('an explicit null start point keeps the old base fallback', async () => {
    const root = changeWithLocalFile();
    expect(await readGitChangedFiles(root, { since: null })).toContain('local.txt');
  });

  it('the review digest and the traceability inputs list only this change’s files', async () => {
    const root = changeWithLocalFile();
    const digest = await writeReviewDigest(root, SESSION);
    expect(digest.markdown).toContain('made.ts');
    expect(digest.markdown).not.toContain('local.txt');
    const inputs = await gatherTraceabilityInputs({ projectRoot: root, lane: 'full' });
    expect(inputs.changedFiles).toEqual(['made.ts']);
  });
});
