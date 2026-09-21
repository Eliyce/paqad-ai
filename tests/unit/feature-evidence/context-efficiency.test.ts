import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendContextEfficiency,
  readContextEfficiency,
  type ContextEfficiencyEntry,
} from '@/feature-evidence/bundle-ledgers.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import {
  CONTEXT_EFFICIENCY_DOC_TYPE,
  CONTEXT_EFFICIENCY_SCHEMA_VERSION,
  validateContextEfficiencyRow,
} from '@/feature-evidence/context-efficiency-schema.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-context-eff-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function activeFeature(root: string): string {
  return openFeatureChange(root, 'ses_orch', {
    adapter: 'claude-code',
    title: 'Stage isolation',
    issue: '567',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  });
}

const entry: ContextEfficiencyEntry = {
  stage: 'development',
  agent_id: 'agent_abc',
  adapter: 'claude-code',
  tokens_input: 1200,
  tokens_cached: 400,
  tokens_output: 300,
  exact: true,
  carried_history_avoided_estimate: 8000,
};

describe('per-feature context-efficiency.jsonl (issue #567)', () => {
  it('appends a row into the active feature and reads it back', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const stamped = appendContextEfficiency(root, 'ses_orch', entry);
    expect(stamped).not.toBeNull();

    const rows = readContextEfficiency(root, dir);
    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe('development');
    expect(rows[0].agent_id).toBe('agent_abc');
    expect(rows[0].exact).toBe(true);
    expect(rows[0].doc_type).toBe(CONTEXT_EFFICIENCY_DOC_TYPE);
  });

  it('stamps the orchestrator session id both as session_id and orchestrator_session_id', () => {
    const root = tempRoot();
    activeFeature(root);
    const stamped = appendContextEfficiency(root, 'ses_orch', entry);
    expect(stamped?.session_id).toBe('ses_orch');
    expect(stamped?.orchestrator_session_id).toBe('ses_orch');
  });

  it('is a no-op when no feature is active', () => {
    const root = tempRoot();
    expect(appendContextEfficiency(root, 'ses_orch', entry)).toBeNull();
  });

  it('records an estimated row with exact:false', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    appendContextEfficiency(root, 'ses_orch', { ...entry, exact: false });
    const rows = readContextEfficiency(root, dir);
    expect(rows[0].exact).toBe(false);
  });
});

describe('context-efficiency row schema', () => {
  const validRow = {
    schema_version: CONTEXT_EFFICIENCY_SCHEMA_VERSION,
    doc_type: CONTEXT_EFFICIENCY_DOC_TYPE,
    session_id: 'ses_orch',
    ts: '2026-09-21T00:00:00.000Z',
    content_hash: 'abc123',
    stage: 'development',
    agent_id: 'agent_abc',
    adapter: 'claude-code',
    orchestrator_session_id: 'ses_orch',
    tokens_input: 1,
    tokens_cached: 0,
    tokens_output: 2,
    exact: true,
    carried_history_avoided_estimate: 100,
  };

  it('accepts a well-formed row', () => {
    expect(validateContextEfficiencyRow(validRow)).toEqual([]);
  });

  it('rejects an unknown field (closed schema)', () => {
    expect(validateContextEfficiencyRow({ ...validRow, sneaky: 1 }).length).toBeGreaterThan(0);
  });

  it('rejects a missing required field', () => {
    const { exact: _omitted, ...withoutExact } = validRow;
    expect(validateContextEfficiencyRow(withoutExact).length).toBeGreaterThan(0);
  });

  it('rejects a negative token count', () => {
    expect(validateContextEfficiencyRow({ ...validRow, tokens_input: -1 }).length).toBeGreaterThan(
      0,
    );
  });
});
