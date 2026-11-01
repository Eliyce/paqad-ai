import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AGENT_RECORD_DOC_TYPE,
  agentRecordFilename,
  readAgentRecord,
  writeAgentRecord,
  type AgentRecordBody,
} from '@/feature-evidence/artifacts.js';
import { isAllowedBundleFilename } from '@/feature-evidence/bundle-integrity.js';
import { bundleWriterFor } from '@/feature-evidence/manifest.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

let root: string;
let sessionId: string;
let dir: string;

const BODY: AgentRecordBody = {
  agent: 'migration-reviewer',
  status: 'passed',
  version: '1.0.0',
  released_path: '.claude/agents/migration-reviewer.md',
  file_hash: 'sha256:abc',
  hook_scripts: [],
  files: [{ path: '.claude/agents/migration-reviewer.md', hash: 'sha256:abc' }],
  evidence_path: '.paqad/authoring/agents/migration-reviewer/evidence.json',
  overrides: [],
  labels: [],
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-agent-record-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  sessionId = resolveSessionId(root, 'ses-agent-record');
  dir = openFeatureChange(root, sessionId, {
    adapter: 'claude-code',
    title: 'add migration reviewer',
    lane: 'graduated',
  });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the agent bundle record', () => {
  it('AC-21: writes agent-<name>.json once and reads it back', () => {
    expect(agentRecordFilename('migration-reviewer')).toBe('agent-migration-reviewer.json');
    const first = writeAgentRecord(root, sessionId, BODY);
    expect(first.written).toBe(true);
    expect(first.path.endsWith(`${dir}/agent-migration-reviewer.json`)).toBe(true);
    expect(writeAgentRecord(root, sessionId, BODY).written).toBe(false);
    const record = readAgentRecord(root, dir, 'migration-reviewer') as unknown as Record<
      string,
      unknown
    >;
    expect(record.doc_type).toBe(AGENT_RECORD_DOC_TYPE);
    expect(record.file_hash).toBe('sha256:abc');
    expect(writeAgentRecord(root, sessionId, { ...BODY, file_hash: 'sha256:def' }).written).toBe(
      true,
    );
    expect(readAgentRecord(root, dir, 'other')).toBeNull();
  });

  it('AC-21: bundle integrity accepts agent-<name>.json and names its writer', () => {
    expect(isAllowedBundleFilename('agent-migration-reviewer.json')).toBe(true);
    expect(isAllowedBundleFilename('agent-Explore.json')).toBe(true);
    expect(bundleWriterFor('agent-migration-reviewer.json')).toBe('paqad-ai agent release');
    expect(isAllowedBundleFilename('agent-.json')).toBe(false);
  });
});
