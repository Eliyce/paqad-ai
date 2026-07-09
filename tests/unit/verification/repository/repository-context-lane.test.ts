import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildRepositoryVerificationContext } from '@/verification/repository/repository-context.js';
import { openStageEvidence, type StageLane } from '@/stage-evidence/index.js';

// Issue #324 — the completion backstop consumes the recorded lane instead of a
// hardcoded 'full'. `readRecordedLane` resolves the session from CLAUDE_SESSION_ID,
// so the test pins it and opens a change under it with a known lane.
describe('buildRepositoryVerificationContext lane consumption (#324)', () => {
  let root: string;
  let priorSession: string | undefined;
  const SES = 'ctx-lane-sess';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-ctx-lane-'));
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    priorSession = process.env.CLAUDE_SESSION_ID;
    process.env.CLAUDE_SESSION_ID = SES;
  });

  afterEach(() => {
    if (priorSession === undefined) {
      delete process.env.CLAUDE_SESSION_ID;
    } else {
      process.env.CLAUDE_SESSION_ID = priorSession;
    }
    rmSync(root, { recursive: true, force: true });
  });

  function openWithLane(lane: StageLane): void {
    openStageEvidence(root, { sessionId: SES, adapter: 'claude-code', lane });
  }

  it('uses the recorded lane on the verification context', async () => {
    openWithLane('fast');
    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });
    expect(context.lane).toBe('fast');
  });

  it('fails safe to full when no change is open', async () => {
    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });
    expect(context.lane).toBe('full');
  });

  it('fails safe to full when the recorded lane is null', async () => {
    openWithLane(null);
    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });
    expect(context.lane).toBe('full');
  });
});
