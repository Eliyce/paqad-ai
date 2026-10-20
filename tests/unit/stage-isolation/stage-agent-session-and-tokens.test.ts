import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { openFeatureChange, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { classifyCompletionEnforcement } from '@/pipeline/session-ownership.js';
import { parseAndRecordMarkers } from '@/stage-evidence/marker-parse.js';
import {
  hookSessionCandidates,
  keepingLedgerSessionCache,
  persistLedgerSessionId,
  readLedgerSessionId,
  resolveHookSession,
} from '@/rag-ledger/session.js';
import {
  formatStageIsolationLine,
  readStageAgentRows,
  summarizeStageIsolation,
} from '@/stage-isolation/isolation-summary.js';
import {
  estimateTokens,
  recordStageAgentCompletion,
  resolveStageAgentTokens,
} from '@/stage-isolation/subagent-completion.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-stage-agent-session-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const A = 'ses_dispatching_a';
const B = 'ses_cache_writer_b';
const NO_ENV: NodeJS.ProcessEnv = {};

function openChange(root: string, session: string, title: string, ulid: string): string {
  return openFeatureChange(root, session, { adapter: 'claude-code', title, issue: null, ulid });
}

function cacheBytes(root: string): Buffer {
  return readFileSync(join(root, PATHS.LEDGER_SESSION_ID));
}

function writeAgentTranscript(root: string): string {
  const path = join(root, 'agent.jsonl');
  const lines = [
    {
      type: 'assistant',
      timestamp: '2026-03-01T10:00:00.000Z',
      message: {
        id: 'msg_1',
        model: 'claude-opus',
        usage: {
          input_tokens: 120,
          output_tokens: 30,
          cache_read_input_tokens: 400,
          cache_creation_input_tokens: 50,
        },
      },
    },
    {
      type: 'assistant',
      timestamp: '2026-03-01T10:01:00.000Z',
      message: {
        id: 'msg_2',
        model: 'claude-opus',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    },
  ];
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return path;
}

describe('readLedgerSessionId', () => {
  it('returns null and creates nothing when no cache exists', () => {
    const root = tempRoot();
    expect(readLedgerSessionId(root)).toBeNull();
    expect(existsSync(join(root, PATHS.LEDGER_SESSION_ID))).toBe(false);
  });

  it('returns the cached id and leaves the file byte-identical', () => {
    const root = tempRoot();
    persistLedgerSessionId(root, B);
    const before = cacheBytes(root);
    const mtime = statSync(join(root, PATHS.LEDGER_SESSION_ID)).mtimeMs;
    expect(readLedgerSessionId(root)).toBe(B);
    expect(cacheBytes(root).equals(before)).toBe(true);
    expect(statSync(join(root, PATHS.LEDGER_SESSION_ID)).mtimeMs).toBe(mtime);
  });

  it('reads an empty cache as no id', () => {
    const root = tempRoot();
    persistLedgerSessionId(root, B);
    writeFileSync(join(root, PATHS.LEDGER_SESSION_ID), '  \n', 'utf8');
    expect(readLedgerSessionId(root)).toBeNull();
  });
});

describe('keepingLedgerSessionCache', () => {
  it('restores a cache the run rewrote', () => {
    const root = tempRoot();
    persistLedgerSessionId(root, B);
    const result = keepingLedgerSessionCache(root, () => {
      persistLedgerSessionId(root, A);
      return 'ran';
    });
    expect(result).toBe('ran');
    expect(readLedgerSessionId(root)).toBe(B);
  });

  it('restores a cache the run deleted', () => {
    const root = tempRoot();
    persistLedgerSessionId(root, B);
    keepingLedgerSessionCache(root, () =>
      rmSync(join(root, PATHS.LEDGER_SESSION_ID), { force: true }),
    );
    expect(readLedgerSessionId(root)).toBe(B);
  });

  it('removes a cache the run created where none existed', () => {
    const root = tempRoot();
    keepingLedgerSessionCache(root, () => persistLedgerSessionId(root, A));
    expect(existsSync(join(root, PATHS.LEDGER_SESSION_ID))).toBe(false);
  });

  it('leaves an untouched cache alone and keeps none absent', () => {
    const root = tempRoot();
    keepingLedgerSessionCache(root, () => undefined);
    expect(existsSync(join(root, PATHS.LEDGER_SESSION_ID))).toBe(false);
    persistLedgerSessionId(root, B);
    const mtime = statSync(join(root, PATHS.LEDGER_SESSION_ID)).mtimeMs;
    keepingLedgerSessionCache(root, () => undefined);
    expect(statSync(join(root, PATHS.LEDGER_SESSION_ID)).mtimeMs).toBe(mtime);
  });

  it('keeps the cache when a marker backfill records under the payload session', () => {
    const root = tempRoot();
    const dirA = openChange(root, A, 'marker change', '01JABCDEFGHJKMNPQRSTVWXYZ6');
    persistLedgerSessionId(root, B);
    const before = cacheBytes(root);
    const transcriptText = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: 'paqad:stage development start' },
    });
    const recorded = parseAndRecordMarkers({
      projectRoot: root,
      transcriptText,
      sessionId: A,
      keepSessionCache: true,
      adapter: 'claude-code',
    });
    expect(recorded).toEqual([{ stage: 'development', phase: 'start', artifactPath: undefined }]);
    expect(
      readFeatureStageUnit(root, dirA).some(
        (row) => row.kind === 'stage_start' && row.stage === 'development' && row.session_id === A,
      ),
    ).toBe(true);
    expect(cacheBytes(root).equals(before)).toBe(true);
  });
});

describe('resolveHookSession', () => {
  it('orders candidates payload, SE_SESSION, CLAUDE_SESSION_ID, then the cache, without repeats', () => {
    const root = tempRoot();
    persistLedgerSessionId(root, B);
    expect(
      hookSessionCandidates(
        root,
        { session_id: ' payload ' },
        { SE_SESSION: 'env_se', CLAUDE_SESSION_ID: 'payload' },
      ),
    ).toEqual(['payload', 'env_se', B]);
    expect(hookSessionCandidates(root, null, NO_ENV)).toEqual([B]);
    expect(hookSessionCandidates(root, { session_id: 42 }, { SE_SESSION: '' })).toEqual([B]);
  });

  it('picks the first candidate that has an in-flight bundle', () => {
    const root = tempRoot();
    openChange(root, 'env_se', 'env change', '01JABCDEFGHJKMNPQRSTVWXYZ1');
    persistLedgerSessionId(root, B);
    expect(resolveHookSession(root, { session_id: 'no_bundle' }, { SE_SESSION: 'env_se' })).toBe(
      'env_se',
    );
  });

  it('falls back to the cached id when no candidate has a bundle', () => {
    const root = tempRoot();
    persistLedgerSessionId(root, B);
    expect(resolveHookSession(root, { session_id: 'no_bundle' }, NO_ENV)).toBe(B);
    expect(cacheBytes(root).toString('utf8')).toBe(B);
  });

  it('mints a session only when nothing at all is known', () => {
    const root = tempRoot();
    expect(resolveHookSession(root, null, NO_ENV)).toMatch(/^ses_/);
  });
});

describe('two sessions in one checkout', () => {
  it('records the stage-agent row on the dispatching session and its bundle', () => {
    const root = tempRoot();
    const dirA = openChange(root, A, 'change by a', '01JABCDEFGHJKMNPQRSTVWXYZ2');
    const dirB = openChange(root, B, 'change by b', '01JABCDEFGHJKMNPQRSTVWXYZ3');
    persistLedgerSessionId(root, B);
    const before = cacheBytes(root);

    const written = recordStageAgentCompletion({
      projectRoot: root,
      payload: { session_id: A, agent_id: 'agent_a', agent_type: 'paqad-development' },
      transcriptText: 'parent transcript',
      adapter: 'claude-code',
    });

    expect(written).toBe(true);
    const rows = readStageAgentRows(root, dirA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ session_id: A, stage: 'development' });
    expect(readStageAgentRows(root, dirB)).toEqual([]);
    expect(cacheBytes(root).equals(before)).toBe(true);
  });

  it('leaves the cache-writing session a non-owner at its Stop', () => {
    const root = tempRoot();
    openChange(root, A, 'change by a', '01JABCDEFGHJKMNPQRSTVWXYZ4');
    persistLedgerSessionId(root, B);

    recordStageAgentCompletion({
      projectRoot: root,
      payload: { session_id: A, agent_type: 'paqad-development' },
      transcriptText: 'parent transcript',
      adapter: 'claude-code',
    });

    expect(classifyCompletionEnforcement(root, B)).toMatchObject({
      enforce: false,
      reason: 'not-owner',
    });
  });
});

describe('stage-agent tokens from the subagent transcript', () => {
  it('records the subagent transcript totals as exact and the summary line uses them', () => {
    const root = tempRoot();
    const dir = openChange(root, A, 'tokens', '01JABCDEFGHJKMNPQRSTVWXYZ5');
    const agentPath = writeAgentTranscript(root);
    const parentText = 'a much larger parent transcript '.repeat(5000);

    recordStageAgentCompletion({
      projectRoot: root,
      payload: { session_id: A, agent_type: 'paqad-development', agent_transcript_path: agentPath },
      transcriptText: parentText,
      adapter: 'claude-code',
    });

    const agentTokens = estimateTokens(readFileSync(agentPath, 'utf8'));
    const [row] = readStageAgentRows(root, dir);
    expect(row).toMatchObject({
      kind: 'stage-agent',
      stage: 'development',
      agent: 'paqad-development',
      tokens_used: 615,
      tokens_not_recarried: agentTokens,
      estimate: false,
    });
    expect(Object.keys(row!)).toEqual(
      expect.arrayContaining([
        'kind',
        'stage',
        'agent',
        'tokens_used',
        'tokens_not_recarried',
        'estimate',
      ]),
    );
    const summary = summarizeStageIsolation(root, dir);
    expect(summary).toEqual({ stages: 1, tokensNotRecarried: agentTokens, estimate: false });
    expect(formatStageIsolationLine(summary!)).toBe(
      `context: 1 stage isolated, ~${agentTokens} tokens not re-carried (exact)`,
    );
  });

  it('falls back to the parent estimate with no agent transcript', () => {
    expect(resolveStageAgentTokens({}, 'abcdefgh')).toEqual({
      tokens_used: 2,
      tokens_not_recarried: 2,
      exact: false,
    });
  });

  it('falls back to the parent estimate when the agent transcript is missing or has no usage', () => {
    const root = tempRoot();
    const empty = join(root, 'empty.jsonl');
    writeFileSync(empty, `${JSON.stringify({ type: 'user', message: { content: 'hi' } })}\n`);
    for (const path of [join(root, 'missing.jsonl'), empty, '  ']) {
      expect(resolveStageAgentTokens({ agent_transcript_path: path }, 'abcdefgh')).toEqual({
        tokens_used: 2,
        tokens_not_recarried: 2,
        exact: false,
      });
    }
  });
});
