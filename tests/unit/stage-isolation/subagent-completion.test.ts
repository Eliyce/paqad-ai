import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureStagePath, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { readStageAgentRows } from '@/stage-isolation/isolation-summary.js';
import { validateStageEvidenceRow } from '@/stage-evidence/schema.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import {
  estimateTokens,
  recordStageAgentCompletion,
  resolveTokenCounts,
  stageFromAgentType,
} from '@/stage-isolation/subagent-completion.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-subagent-stop-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

/** Open a feature bundle under `ses_orch` and align the ledger cache to it. */
function activeFeature(root: string): string {
  const dir = openFeatureChange(root, 'ses_orch', {
    adapter: 'claude-code',
    title: 'Stage isolation',
    issue: '567',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  });
  persistLedgerSessionId(root, 'ses_orch');
  return dir;
}

describe('stageFromAgentType', () => {
  it('strips the paqad- prefix to the stage name', () => {
    expect(stageFromAgentType('paqad-development')).toBe('development');
    // The one hyphenated agent maps to the canonical underscore stage name.
    expect(stageFromAgentType('paqad-documentation-sync')).toBe('documentation_sync');
  });

  it('returns null for a non-paqad agent or an empty stage', () => {
    expect(stageFromAgentType('general-purpose')).toBeNull();
    expect(stageFromAgentType('paqad-')).toBeNull();
    expect(stageFromAgentType(null)).toBeNull();
    expect(stageFromAgentType(undefined)).toBeNull();
  });
});

describe('estimateTokens', () => {
  it('is bytes/4 rounded up, and 0 for empty', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('resolveTokenCounts', () => {
  it('uses host usage when present and marks the row exact', () => {
    const counts = resolveTokenCounts(
      { usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30 } },
      'ignored when usage present',
    );
    expect(counts).toEqual({
      tokens_input: 100,
      tokens_cached: 30,
      tokens_output: 20,
      exact: true,
    });
  });

  it('accepts the Codex cached-token field name too', () => {
    const counts = resolveTokenCounts(
      { usage: { input_tokens: 5, output_tokens: 5, cached_input_tokens: 2 } },
      '',
    );
    expect(counts.tokens_cached).toBe(2);
    expect(counts.exact).toBe(true);
  });

  it('estimates from the transcript and marks the row inexact when no usage is present', () => {
    const counts = resolveTokenCounts({}, 'abcdefgh');
    expect(counts).toEqual({
      tokens_input: 2,
      tokens_cached: 0,
      tokens_output: 0,
      exact: false,
    });
  });

  it('defaults cached tokens to 0 when usage has input+output but no cache field', () => {
    const counts = resolveTokenCounts({ usage: { input_tokens: 7, output_tokens: 3 } }, 'ignored');
    expect(counts).toEqual({
      tokens_input: 7,
      tokens_cached: 0,
      tokens_output: 3,
      exact: true,
    });
  });
});

describe('recordStageAgentCompletion', () => {
  it('writes one row keyed on the orchestrator session id for a paqad stage agent', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const written = recordStageAgentCompletion({
      projectRoot: root,
      payload: { agent_id: 'agent_x', agent_type: 'paqad-development' },
      transcriptText: 'some subagent work '.repeat(10),
      adapter: 'claude-code',
    });
    expect(written).toBe(true);

    // Issue #581 — one `stage-agent` row in stage-evidence.jsonl, not a separate file.
    const rows = readStageAgentRows(root, dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'stage-agent',
      stage: 'development',
      agent: 'paqad-development',
      session_id: 'ses_orch',
      change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      tokens_used: 48,
      tokens_not_recarried: 48,
      estimate: true,
    });
    expect(rows[0]).not.toHaveProperty('adapter');
    expect(validateStageEvidenceRow(rows[0])).toEqual([]);
  });

  it('sums host-reported input and output as tokens_used, still labelled an estimate', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    recordStageAgentCompletion({
      projectRoot: root,
      payload: {
        agent_type: 'paqad-review',
        usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 50 },
      },
      transcriptText: 'review work',
      adapter: 'claude-code',
    });
    const [row] = readStageAgentRows(root, dir);
    expect(row).toMatchObject({ stage: 'review', tokens_used: 1500, estimate: true });
  });

  it('writes nothing, and never throws, when the ledger cannot be appended', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    // A directory where the ledger file should be makes the append fail.
    rmSync(join(root, featureStagePath(dir)));
    mkdirSync(join(root, featureStagePath(dir)));
    expect(
      recordStageAgentCompletion({
        projectRoot: root,
        payload: { agent_type: 'paqad-planning' },
        transcriptText: 'x',
        adapter: 'claude-code',
      }),
    ).toBe(false);
  });

  it('does nothing for a non-paqad subagent', () => {
    const root = tempRoot();
    activeFeature(root);
    const written = recordStageAgentCompletion({
      projectRoot: root,
      payload: { agent_id: 'a', agent_type: 'general-purpose' },
      transcriptText: 'x',
      adapter: 'claude-code',
    });
    expect(written).toBe(false);
  });

  it('does nothing when no feature is active (no bundle to attach to)', () => {
    const root = tempRoot();
    persistLedgerSessionId(root, 'ses_orch');
    const written = recordStageAgentCompletion({
      projectRoot: root,
      payload: { agent_id: 'a', agent_type: 'paqad-planning' },
      transcriptText: 'x',
      adapter: 'claude-code',
    });
    expect(written).toBe(false);
  });

  it('never throws on a malformed payload', () => {
    const root = tempRoot();
    activeFeature(root);
    expect(() =>
      recordStageAgentCompletion({
        projectRoot: root,
        payload: {},
        transcriptText: '',
        adapter: 'claude-code',
      }),
    ).not.toThrow();
  });
});
