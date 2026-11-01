import { cpSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  agentCompletionFindings,
  agentCompletionLine,
  changedAgentFiles,
} from '@/authoring/completion.js';
import { AGENT_PERMISSION_ALLOW, raiseAgentPermissionDecision } from '@/authoring/decisions.js';
import { hashAgentFile } from '@/authoring/hash.js';
import { lintAgentInProject } from '@/authoring/lint/agent-lint.js';
import { resolvePendingDecision } from '@/decisions/authoring.js';
import { seedFeatureRecord } from '@/feature-evidence/feature-record.js';
import { type BundleCompletenessConfig } from '@/feature-evidence/manifest.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { bundleCompletenessGate } from '@/verification/repository/bundle-completeness-gate.js';

const DIR = '795-add-agent-01JABCDEFGHJKMNPQRSTVWXYZ0';
const NAME = 'migration-reviewer';
const FILE = `.claude/agents/${NAME}.md`;
const HOOK = '.claude/hooks/block-edits.mjs';
const NPM_FIXTURE = join(process.cwd(), 'tests/fixtures/authoring/npm-project');

const CONFIG: BundleCompletenessConfig = {
  lane: 'full',
  ruleComplianceOn: false,
  metricsEnabled: false,
  duplicationOn: false,
  featureReport: false,
  ragEnabled: false,
  enterprise: false,
  evidenceLedger: false,
  aiBom: false,
  specPipelineStrict: false,
  specPipelineEnabled: false,
  expertsEnabled: false,
  specFrozenBeforePipeline: false,
  stageIsolationExpected: false,
  stageIsolationUnresolved: false,
};

const MAIN_VERDICT_AT_MERGE_BASE = {
  name: 'bundle-completeness',
  status: 'pass',
  detail:
    'Every required bundle file is present for this feature (8 checked). Skipped (flag off): ai-bom.json, change-metrics.jsonl, clarification.json, duplication.jsonl, experts.json, rag.jsonl, receipt.json, report.html, request.md, rule-run.jsonl.',
  remediation: null,
  failures: [],
};

const AGENT = (extra = '') => `---
name: ${NAME}
description: 'Use this agent when a change adds a database migration, as in "review this migration" or "is this safe".'
tools: Read, Grep, Glob
model: haiku
maxTurns: 20${extra}
hooks:
  PreToolUse:
    - matcher: "Edit"
      hooks:
        - type: command
          command: node ${HOOK}
---

## Objective

Review the migration.
`;

const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function project(agent = AGENT()): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-agent-completion-'));
  roots.push(root);
  mkdirSync(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('PAQAD_AGENT_ORCHESTRATOR_ENABLED', undefined);
  write(root, '.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'claude-code' }));
  seedFeatureRecord(root, DIR, { adapter: 'claude-code', sessionId: 'ses_1' });
  for (const key of ['plan', 'specification', 'review', 'delivery'] as const) {
    write(root, featureFilePath(DIR, key), '{"branch":"x"}');
  }
  write(root, featureFilePath(DIR, 'specMd'), '# Specification\n');
  write(root, featureFilePath(DIR, 'stageEvidence'), '{"row":1}\n');
  write(root, featureFilePath(DIR, 'evidence'), '{"code":"format"}\n');
  write(root, FILE, agent);
  write(root, HOOK, 'process.exit(0);\n');
  return root;
}

function record(root: string, status = 'passed'): void {
  const hash = hashAgentFile(root, FILE, [HOOK]);
  write(
    root,
    `${featureDir(DIR)}/agent-${NAME}.json`,
    JSON.stringify({
      agent: NAME,
      status,
      version: '1.0.0',
      released_path: FILE,
      file_hash: hash,
      hook_scripts: [HOOK],
      files: [{ path: FILE, hash }],
      evidence_path: `.paqad/authoring/agents/${NAME}/evidence.json`,
      overrides: [],
      labels: [],
    }),
  );
}

function gate(root: string, changedFiles: string[]) {
  return bundleCompletenessGate({
    projectRoot: root,
    sessionId: 'ses_1',
    dirName: DIR,
    mode: 'strict',
    origin: 'hook-completion',
    isFeatureDev: true,
    changeMetrics: null,
    config: CONFIG,
    changedFiles,
  })!;
}

describe('the agent completion check', () => {
  it('AC-21: a new agent file with no record is Needs your attention with the exact line', () => {
    const root = project();
    const result = gate(root, [FILE, 'src/a.ts']);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain(
      'The agent migration-reviewer changed but never went through its checks. Run paqad-ai agent status migration-reviewer.',
    );
    expect(result.detail).toContain('agent-migration-reviewer.json (run: paqad-ai agent release)');
  });

  it('AC-21: passes with a passing or overridden record, fails with any other status', () => {
    const root = project();
    record(root);
    expect(gate(root, [FILE]).status).toBe('pass');
    record(root, 'overridden');
    expect(gate(root, [FILE]).status).toBe('pass');
    record(root, 'failed');
    expect(gate(root, [FILE]).status).toBe('fail');
  });

  it('AC-21: a change touching no agent path gets the same verdict as before', () => {
    const root = project();
    expect(gate(root, ['src/a.ts']).status).toBe('pass');
    expect(gate(root, []).status).toBe('pass');
  });

  it('AC-35: an edit to a hook script the agent names, after release, makes its pass invalid', () => {
    const root = project();
    record(root);
    expect(changedAgentFiles(root, [HOOK])).toEqual([{ name: NAME, path: FILE }]);
    write(root, HOOK, 'process.exit(2);\n');
    expect(gate(root, [HOOK]).status).toBe('fail');
  });

  it('AC-35: a deleted agent file needs no record, and files under a host with no subagents get no finding', () => {
    const root = project();
    write(root, `.cursor/agents/${NAME}.md`, AGENT());
    expect(
      agentCompletionFindings({
        projectRoot: root,
        dirName: DIR,
        changedFiles: [`.cursor/agents/${NAME}.md`],
      }),
    ).toEqual([]);
    unlinkSync(join(root, FILE));
    expect(
      agentCompletionFindings({ projectRoot: root, dirName: DIR, changedFiles: [FILE] }),
    ).toEqual([]);
  });

  it('AC-64: on the npm fixture, a change with no agent path and one adding a .cursor/agents file get the verdict recorded from main', () => {
    const root = project();
    cpSync(NPM_FIXTURE, root, { recursive: true });
    write(root, `.cursor/agents/${NAME}.md`, AGENT());
    const changes = [['src/a.ts'], [`.cursor/agents/${NAME}.md`]];
    const withSeat = changes.map((files) => gate(root, files));
    expect(withSeat).toEqual([MAIN_VERDICT_AT_MERGE_BASE, MAIN_VERDICT_AT_MERGE_BASE]);
  });

  it('returns nothing when agent_orchestrator_enabled is false', () => {
    const root = project();
    vi.stubEnv('PAQAD_AGENT_ORCHESTRATOR_ENABLED', 'false');
    expect(
      agentCompletionFindings({ projectRoot: root, dirName: DIR, changedFiles: [FILE] }),
    ).toEqual([]);
  });

  it('AC-68: an expired permission approval names the agent at the end of the change', () => {
    const root = project(AGENT('\npermissionMode: bypassPermissions'));
    const lint = lintAgentInProject(root, join(root, FILE));
    const id = raiseAgentPermissionDecision(root, {
      agent: NAME,
      powers: lint.powers,
      fileHash: lint.file_hash,
    });
    resolvePendingDecision(root, id, AGENT_PERMISSION_ALLOW, 'needed');
    write(root, `.paqad/tmp/authoring/agents/${NAME}/permissions.json`, JSON.stringify([id]));
    record(root);
    expect(
      agentCompletionFindings({ projectRoot: root, dirName: DIR, changedFiles: [FILE] }),
    ).toEqual([]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 31 * 86_400_000));
    try {
      const findings = agentCompletionFindings({
        projectRoot: root,
        dirName: DIR,
        changedFiles: [FILE],
      });
      expect(findings).toHaveLength(1);
      expect(findings[0]!.line).toContain('The agent migration-reviewer holds a power');
      expect(findings[0]!.line).toContain('AG-015');
      expect(findings[0]!.line).not.toBe(agentCompletionLine(NAME));
    } finally {
      vi.useRealTimers();
    }
  });
});
