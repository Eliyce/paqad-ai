import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  deleteOnboardingCheckpoint,
  readOnboardingCheckpoint,
  writeOnboardingCheckpoint,
} from '@/onboarding/checkpoint.js';

describe('onboarding checkpoint (PQD-424 AC3)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-ai-checkpoint-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns null when no checkpoint exists', () => {
    expect(readOnboardingCheckpoint(projectRoot)).toBeNull();
  });

  it('round-trips the written paths through write then read', () => {
    writeOnboardingCheckpoint(projectRoot, ['CLAUDE.md', '.paqad/project-profile.yaml']);

    expect(existsSync(join(projectRoot, PATHS.ONBOARDING_CHECKPOINT))).toBe(true);
    expect(readOnboardingCheckpoint(projectRoot)).toEqual([
      'CLAUDE.md',
      '.paqad/project-profile.yaml',
    ]);
  });

  it('de-duplicates repeated paths while preserving first-seen order', () => {
    writeOnboardingCheckpoint(projectRoot, ['a/b.md', 'a/b.md', 'c.md', 'a/b.md']);

    expect(readOnboardingCheckpoint(projectRoot)).toEqual(['a/b.md', 'c.md']);
  });

  it('deletes the checkpoint and tolerates a second delete', () => {
    writeOnboardingCheckpoint(projectRoot, ['x.md']);
    deleteOnboardingCheckpoint(projectRoot);

    expect(existsSync(join(projectRoot, PATHS.ONBOARDING_CHECKPOINT))).toBe(false);
    expect(readOnboardingCheckpoint(projectRoot)).toBeNull();
    // A second delete on an already-absent checkpoint is a no-op, not a throw.
    expect(() => deleteOnboardingCheckpoint(projectRoot)).not.toThrow();
  });

  it('treats a malformed checkpoint as absent so a resume re-writes the full set', () => {
    mkdirSync(join(projectRoot, PATHS.AGENCY_DIR), { recursive: true });
    writeFileSync(join(projectRoot, PATHS.ONBOARDING_CHECKPOINT), '{ not json');

    expect(readOnboardingCheckpoint(projectRoot)).toBeNull();
  });
});
