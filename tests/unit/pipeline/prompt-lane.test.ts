import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolvePromptLane, runPromptLaneSeam } from '@/pipeline/prompt-lane.js';
import { readPendingLane } from '@/stage-evidence/pending-lane.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

const SESSION = 'sess-prompt-lane';
const ADAPTER = 'claude-code';

describe('resolvePromptLane (#324)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-prompt-lane-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('routes a risky, wide-reaching feature change to the full lane', async () => {
    const { lane, reason } = await resolvePromptLane(
      root,
      'implement a schema migration adding a pii payment column and a breaking api change',
    );
    expect(lane).toBe('full');
    expect(reason).toContain('full path');
  });

  it('routes a trivial fix to the fast lane', async () => {
    const { lane, reason } = await resolvePromptLane(root, 'fix a one-line typo in a code comment');
    expect(lane).toBe('fast');
    expect(reason).toContain('quick path');
  });

  it('returns a null lane for a prompt that is not a code change', async () => {
    const { lane, reason } = await resolvePromptLane(root, 'what does this project do');
    expect(lane).toBeNull();
    expect(reason).toBe('no code change detected');
  });
});

describe('runPromptLaneSeam (#324)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-prompt-seam-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stashes the lane and returns a narration line for a code change', async () => {
    const result = await runPromptLaneSeam({
      projectRoot: root,
      request: 'implement a schema migration adding a pii payment column',
      sessionId: SESSION,
      adapter: ADAPTER,
    });
    expect(result.lane).toBe('full');
    expect(result.narration).toContain('full lane');
    const sessionId = resolveSessionId(root, SESSION);
    expect(readPendingLane(root, sessionId)).toBe('full');
  });

  it('stashes nothing and narrates nothing for a non-code prompt', async () => {
    const result = await runPromptLaneSeam({
      projectRoot: root,
      request: 'explain how the router works',
      sessionId: SESSION,
      adapter: ADAPTER,
    });
    expect(result.lane).toBeNull();
    expect(result.narration).toBeNull();
    const sessionId = resolveSessionId(root, SESSION);
    expect(readPendingLane(root, sessionId)).toBeNull();
  });
});
