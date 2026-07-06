import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DecisionStore } from '@/planning/decision-store.js';
import {
  isSelfArmEnabled,
  lastUserPromptFromTranscript,
  runDecisionSelfArm,
  selfArmDecision,
} from '@/planning/decision-selfarm.js';

const FORK_PROMPT = 'Should I reuse the existing helper or create a new one for this?';

function pendingIds(root: string): string[] {
  const dir = join(root, '.paqad/decisions/pending');
  return existsSync(dir) ? readdirSync(dir).filter((f) => /^D-.*\.json$/.test(f)) : [];
}

describe('isSelfArmEnabled — off by default, opt-in only', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-selfarm-cfg-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('is OFF when nothing is set', () => {
    expect(isSelfArmEnabled(root, {})).toBe(false);
  });

  it('the env var turns it on (and an explicit off wins)', () => {
    expect(isSelfArmEnabled(root, { PAQAD_DECISION_SELFARM: '1' })).toBe(true);
    expect(isSelfArmEnabled(root, { PAQAD_DECISION_SELFARM: 'off' })).toBe(false);
    expect(isSelfArmEnabled(root, { PAQAD_DECISION_SELFARM: '' })).toBe(false);
  });

  it('the local .config turns it on when the env is unset', () => {
    writeFileSync(join(root, '.paqad/.config'), 'decision_selfarm=true\n');
    expect(isSelfArmEnabled(root, {})).toBe(true);
  });
});

describe('lastUserPromptFromTranscript', () => {
  it('returns the last user message text (string content)', () => {
    const t = [
      JSON.stringify({ message: { role: 'user', content: 'first' } }),
      JSON.stringify({ message: { role: 'assistant', content: 'ok' } }),
      JSON.stringify({ message: { role: 'user', content: 'second' } }),
    ].join('\n');
    expect(lastUserPromptFromTranscript(t)).toBe('second');
  });

  it('flattens array content blocks', () => {
    const t = JSON.stringify({
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      },
    });
    expect(lastUserPromptFromTranscript(t)).toBe('a b');
  });

  it('handles a flat {role,content} shape', () => {
    const t = JSON.stringify({ role: 'user', content: 'flat' });
    expect(lastUserPromptFromTranscript(t)).toBe('flat');
  });

  it('skips malformed lines and returns "" when there is no user message', () => {
    const t = ['not json', JSON.stringify({ message: { role: 'assistant', content: 'x' } })].join(
      '\n',
    );
    expect(lastUserPromptFromTranscript(t)).toBe('');
  });

  it('ignores non-text blocks inside array content', () => {
    const t = JSON.stringify({
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'x' }, { type: 'image' }, { type: 'text', text: 'y' }],
      },
    });
    const out = lastUserPromptFromTranscript(t);
    expect(out).toContain('x');
    expect(out).toContain('y');
  });

  it('returns "" for a user message whose content is neither string nor array', () => {
    expect(
      lastUserPromptFromTranscript(JSON.stringify({ message: { role: 'user', content: 42 } })),
    ).toBe('');
  });
});

describe('selfArmDecision — narrow create-vs-reuse minter', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-selfarm-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('mints ONE pending packet for a create-vs-reuse fork', () => {
    const result = selfArmDecision({
      projectRoot: root,
      promptText: FORK_PROMPT,
      sessionId: 'ses1',
      targetPath: 'src/a.ts',
    });
    expect(result.reason).toBe('minted');
    expect(result.minted).toMatch(/^D-/);
    expect(pendingIds(root)).toHaveLength(1);
  });

  it('mints with a fallback target and honours an injected clock when no target path is given', () => {
    const result = selfArmDecision({
      projectRoot: root,
      promptText: FORK_PROMPT,
      sessionId: 'ses1',
      now: () => new Date('2026-01-02T00:00:00.000Z'),
    });
    expect(result.reason).toBe('minted');
    expect(pendingIds(root)).toHaveLength(1);
  });

  it('does nothing when there is no create-vs-reuse fork', () => {
    const result = selfArmDecision({
      projectRoot: root,
      promptText: 'Add a submit button',
      sessionId: 'ses1',
    });
    expect(result.reason).toBe('no-fork');
    expect(result.category).toBeNull();
    expect(pendingIds(root)).toHaveLength(0);
  });

  it('mints an architecture-path packet on the tight explicit-path-fork (#300)', () => {
    const result = selfArmDecision({
      projectRoot: root,
      promptText: 'Should this live in src/ui/Button.tsx or src/components/Button.tsx?',
      sessionId: 'ses1',
      targetPath: 'src/ui/Button.tsx',
    });
    expect(result.reason).toBe('minted');
    expect(result.category).toBe('architecture-path');
    expect(pendingIds(root)).toHaveLength(1);
  });

  it('does NOT arm on a broad "or" that only trips the low-confidence architecture-path signal', () => {
    const result = selfArmDecision({
      projectRoot: root,
      promptText: 'Add a toggle or a switch to the settings panel',
      sessionId: 'ses1',
      targetPath: 'src/settings.ts',
    });
    expect(result.reason).toBe('no-fork');
    expect(pendingIds(root)).toHaveLength(0);
  });

  it('declines when there is no session id', () => {
    const result = selfArmDecision({ projectRoot: root, promptText: FORK_PROMPT, sessionId: null });
    expect(result.reason).toBe('no-session');
  });

  it('never piles a second pause on top of an open one', () => {
    selfArmDecision({
      projectRoot: root,
      promptText: FORK_PROMPT,
      sessionId: 'ses1',
      targetPath: 'src/a.ts',
    });
    const second = selfArmDecision({
      projectRoot: root,
      promptText: FORK_PROMPT,
      sessionId: 'ses2',
      targetPath: 'src/b.ts',
    });
    expect(second.reason).toBe('pending-exists');
    expect(pendingIds(root)).toHaveLength(1);
  });

  it('does not re-ask a fork that was already resolved', () => {
    const first = selfArmDecision({
      projectRoot: root,
      promptText: FORK_PROMPT,
      sessionId: 'ses1',
      targetPath: 'src/a.ts',
    });
    const store = new DecisionStore(root);
    store.resolve({
      decisionId: first.minted as string,
      humanResponse: {
        chosen_option_key: 'reuse-existing',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: new Date().toISOString(),
        responded_by: 'tester',
        carry_over_scope: 'task',
      },
    });
    const again = selfArmDecision({
      projectRoot: root,
      promptText: FORK_PROMPT,
      sessionId: 'ses1',
      targetPath: 'src/a.ts',
    });
    expect(again.reason).toBe('already-decided');
    expect(pendingIds(root)).toHaveLength(0);
  });

  it('declines gracefully when the store write fails', () => {
    const fakeStore = {
      initialize() {},
      listPendingDecisionIds: () => [],
      findReusableDecision: () => null,
      nextDecisionId: () => 'D-01J000000000000000000000ZZ',
      writePending() {
        throw new Error('cap reached');
      },
    } as unknown as DecisionStore;
    const result = selfArmDecision({
      projectRoot: root,
      promptText: FORK_PROMPT,
      sessionId: 'ses1',
      targetPath: 'src/a.ts',
      store: fakeStore,
    });
    expect(result.reason).toBe('write-failed');
    expect(result.minted).toBeNull();
  });
});

describe('runDecisionSelfArm — the capability body (transcript reader injected)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-selfarm-run-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const payload = { transcriptPath: '/t.jsonl', sessionId: 'ses1', targetPath: 'src/a.ts' };
  const on = { PAQAD_DECISION_SELFARM: '1' };
  const forkTranscript = () => JSON.stringify({ message: { role: 'user', content: FORK_PROMPT } });

  it('no-ops at the completion seam', () => {
    const out = runDecisionSelfArm({
      projectRoot: root,
      seam: 'completion',
      env: on,
      payload,
      readTranscript: forkTranscript,
    });
    expect(out).toEqual({ ran: false, blocking: false, summary: '' });
  });

  it('no-ops when disabled (never reads the transcript)', () => {
    let read = false;
    const out = runDecisionSelfArm({
      projectRoot: root,
      seam: 'pre-mutation',
      env: {},
      payload,
      readTranscript: () => {
        read = true;
        return forkTranscript();
      },
    });
    expect(out.ran).toBe(false);
    expect(read).toBe(false);
    expect(pendingIds(root)).toHaveLength(0);
  });

  it('no-ops when the payload has no transcript path', () => {
    const out = runDecisionSelfArm({
      projectRoot: root,
      seam: 'pre-mutation',
      env: on,
      payload: { sessionId: 'ses1' },
      readTranscript: forkTranscript,
    });
    expect(out.ran).toBe(false);
  });

  it('no-ops when the payload has a transcript path but no session id', () => {
    const out = runDecisionSelfArm({
      projectRoot: root,
      seam: 'pre-mutation',
      env: on,
      payload: { transcriptPath: '/t.jsonl' },
      readTranscript: forkTranscript,
    });
    expect(out.ran).toBe(false);
  });

  it('mints with the fallback target when the payload omits a target path', () => {
    const out = runDecisionSelfArm({
      projectRoot: root,
      seam: 'pre-mutation',
      env: on,
      payload: { transcriptPath: '/t.jsonl', sessionId: 'ses1' },
      readTranscript: forkTranscript,
    });
    expect(out.ran).toBe(true);
    expect(pendingIds(root)).toHaveLength(1);
  });

  it('mints an architecture-path pause and words the advisory as a which-path choice', () => {
    const archTranscript = () =>
      JSON.stringify({
        message: {
          role: 'user',
          content: 'Should this live in src/ui/Button.tsx or src/components/Button.tsx?',
        },
      });
    const out = runDecisionSelfArm({
      projectRoot: root,
      seam: 'pre-mutation',
      env: on,
      payload,
      readTranscript: archTranscript,
    });
    expect(out.ran).toBe(true);
    expect(out.summary).toContain('which-path');
    expect(pendingIds(root)).toHaveLength(1);
  });

  it('mints and returns a non-blocking advisory when a fork is detected', () => {
    const out = runDecisionSelfArm({
      projectRoot: root,
      seam: 'pre-mutation',
      env: on,
      payload,
      readTranscript: forkTranscript,
    });
    expect(out.blocking).toBe(false);
    expect(out.ran).toBe(true);
    expect(out.summary).toContain('▸ paqad');
    expect(pendingIds(root)).toHaveLength(1);
  });

  it('no-ops (never throws) when the transcript read fails', () => {
    const out = runDecisionSelfArm({
      projectRoot: root,
      seam: 'pre-mutation',
      env: on,
      payload,
      readTranscript: () => {
        throw new Error('ENOENT');
      },
    });
    expect(out.ran).toBe(false);
  });

  it('no-ops when the transcript has no user prompt', () => {
    const out = runDecisionSelfArm({
      projectRoot: root,
      seam: 'pre-mutation',
      env: on,
      payload,
      readTranscript: () => JSON.stringify({ message: { role: 'assistant', content: 'hi' } }),
    });
    expect(out.ran).toBe(false);
  });
});
