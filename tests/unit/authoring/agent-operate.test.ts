import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readAuthoringDecision } from '@/authoring/decisions.js';
import { DELEGATIONS_LEDGER } from '@/authoring/delegations.js';
import {
  appendProcedureLine,
  modelDriftLine,
  resolveAgentLearn,
  runAgentCatalog,
  runAgentDrift,
  runAgentLearn,
  runAgentRegression,
} from '@/authoring/stages/agent-operate.js';
import { AgentWorkspace, AuthoringRefusal } from '@/authoring/workspace.js';
import { resolvePendingDecision } from '@/decisions/authoring.js';

import {
  AGENT_NAME,
  AGENT_SOURCES,
  agentProject,
  agentText,
  cleanAgentProjects,
  put,
} from '../../shared/agent-pipeline.js';

afterEach(() => {
  vi.unstubAllEnvs();
  cleanAgentProjects();
});

const NOW = new Date('2026-11-01T00:00:00.000Z');

function project(): string {
  const root = agentProject();
  mkdirSync(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
  put(root, '.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'claude-code' }));
  put(root, `.claude/agents/${AGENT_NAME}.md`, agentText());
  return root;
}

const metrics = (pass: number, tokens: number) => ({
  pass_hat_k: pass,
  tokens_median: tokens,
  cost_median: 0.01,
  latency_ms: 1000,
});

describe('agent learn, drift, catalog and regression (S8)', () => {
  it('AC-12: learn asks authoring.improvement and on yes adds the correction to the draft procedure', () => {
    const root = project();
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    expect(() => runAgentLearn(workspace, { correction: 'x', scope: 'y', source: 'nope' })).toThrow(
      /S-ID/,
    );
    const asked = runAgentLearn(workspace, {
      correction: 'Check the down migration too.',
      scope: 'change 12',
      source: 'S-1',
    });
    expect(readAuthoringDecision(root, asked.decision!)?.category).toBe('authoring.improvement');
    expect(() => resolveAgentLearn(workspace, { decision: asked.decision! })).toThrow(
      /not answered yet/,
    );
    resolvePendingDecision(root, asked.decision!, 'improve', 'yes');
    const done = resolveAgentLearn(workspace, { decision: asked.decision!, now: () => NOW });
    expect(done.ok).toBe(true);
    expect(workspace.read(`draft/${AGENT_NAME}.md`)).toContain(
      '- learned 2026-11-01 in change 12 (S-1): Check the down migration too.',
    );
    expect(() =>
      runAgentLearn(new AgentWorkspace(root, 'other-reviewer'), {
        correction: 'x',
        scope: 'y',
        source: 'S-1',
      }),
    ).toThrow(AuthoringRefusal);
  });

  it('appends a procedure line before the next heading', () => {
    expect(appendProcedureLine('## Procedure\n\n1. Read.\n\n## Report\n\nx\n', '- new')).toBe(
      '## Procedure\n\n1. Read.\n- new\n\n## Report\n\nx\n',
    );
    expect(appendProcedureLine('## Objective\n', '- new')).toBe(
      '## Objective\n\n## Procedure\n\n- new\n',
    );
  });

  it('FR-29: drift names a stale fact and a model change since the agent was proven', () => {
    const root = project();
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    workspace.write('sources.md', AGENT_SOURCES.replace('repository', 'https://example.test'));
    put(
      root,
      `.paqad/authoring/agents/${AGENT_NAME}/evidence.json`,
      JSON.stringify({ model_stamp: { model: 'haiku', proven_on: 'old-model', tier: 'fast' } }),
    );
    const result = runAgentDrift(workspace, { now: () => new Date('2027-06-01T00:00:00.000Z') });
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('was proven on old-model (fast tier)');
    expect(
      modelDriftLine('a', { proven_on: 'm', tier: 'fast' }, [{ tier: 'fast', model: 'm' }]),
    ).toBeNull();
    expect(modelDriftLine('a', null, [])).toBeNull();
  });

  it('AC-42: the catalog lists listing cost and last delegation, and proposes retiring a dark agent', () => {
    const root = project();
    put(root, `.claude/agents/schema-scout.md`, agentText({ name: 'schema-scout' }));
    mkdirSync(join(root, '.paqad/ledger/authoring'), { recursive: true });
    writeFileSync(
      join(root, DELEGATIONS_LEDGER),
      `${JSON.stringify({ agent: AGENT_NAME, at: '2026-10-30T00:00:00.000Z', status: 'completed' })}\n`,
    );
    const result = runAgentCatalog(root, { now: () => NOW, proposeRetirement: true });
    const text = result.lines.join('\n');
    expect(text).toMatch(
      new RegExp(`${AGENT_NAME}: listing \\d+ tokens, last delegated 2026-10-30`),
    );
    expect(text).toContain('schema-scout: listing');
    expect(text).toContain('last delegated never, dark for 30 days');
    expect(readAuthoringDecision(root, result.decision!)?.category).toBe('authoring.retirement');
    expect(text).toContain(`Proposed retiring schema-scout: decision ${result.decision}.`);
  });

  it('a host with no delegation hook is reported as recording nothing', () => {
    const root = project();
    put(root, '.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'codex-cli' }));
    const result = runAgentCatalog(root, { now: () => NOW });
    expect(result.lines[0]).toContain('delegation data: none on codex-cli');
  });

  it('AC-68, FR-44: the catalog lists an agent holding an expired power approval', () => {
    const root = project();
    put(
      root,
      `.claude/agents/${AGENT_NAME}.md`,
      agentText({ permissionMode: 'bypassPermissions' }),
    );
    expect(runAgentCatalog(root, { now: () => NOW }).lines.join('\n')).toContain(
      'holds an expired power approval (AG-015)',
    );
  });

  it('AC-41: the rerun regression gate fails on any pass^3 drop or a token rise beyond 20% and passes when nothing regressed', () => {
    const root = project();
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    expect(() => runAgentRegression(workspace)).toThrow(/two recorded iterations/);
    const bench = (pass: number, tokens: number) => ({
      registered_tier: 'fast',
      tiers: [{ tier: 'fast', with_agent: metrics(pass, tokens) }],
    });
    for (const [n, body] of [
      [1, bench(1, 1000)],
      [2, bench(1, 1100)],
    ] as const) {
      workspace.writeJson(`iteration-${n}/trials.json`, []);
      workspace.writeJson(`iteration-${n}/benchmark.json`, body);
    }
    expect(runAgentRegression(workspace).ok).toBe(true);
    workspace.writeJson('iteration-3/trials.json', []);
    workspace.writeJson('iteration-3/benchmark.json', bench(0.9, 1100));
    const failed = runAgentRegression(workspace);
    expect(failed.ok).toBe(false);
    expect(failed.lines[0]).toContain('pass^3 fell to 0.9 from 1');
    workspace.writeJson('iteration-4/trials.json', []);
    workspace.writeJson('iteration-4/benchmark.json', bench(0.9, 2000));
    expect(runAgentRegression(workspace).lines[0]).toMatch(/2000.*1100/u);
  });
});

describe('agent learn, drift and regression edges (S8)', () => {
  it('AC-12: learn refuses an empty correction or scope and a decision it did not ask', () => {
    const root = project();
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    expect(() => runAgentLearn(workspace, { correction: ' ', scope: 'y', source: 'S-1' })).toThrow(
      /learn needs a correction and --scope/u,
    );
    expect(() => runAgentLearn(workspace, { correction: 'x', scope: '', source: 'S-1' })).toThrow(
      /learn needs a correction and --scope/u,
    );
    expect(() => resolveAgentLearn(workspace, { decision: 'D-nothing' })).toThrow(
      /There is no pending correction for decision D-nothing/u,
    );
  });

  it('AC-12: leaving the agent as it is removes the pending correction and changes nothing', () => {
    const root = project();
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    const asked = runAgentLearn(workspace, {
      correction: 'Check the down migration too.',
      scope: 'change 12',
      source: 'S-1',
    });
    resolvePendingDecision(root, asked.decision!, 'leave', 'no');
    const done = resolveAgentLearn(workspace, { decision: asked.decision! });
    expect(done.lines).toEqual([`Left ${AGENT_NAME} unchanged, as the owner chose.`]);
    expect(workspace.exists(`draft/${AGENT_NAME}.md`)).toBe(false);
  });

  it('AC-12: on yes without a clock the correction is stamped with today', () => {
    const root = project();
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    const asked = runAgentLearn(workspace, {
      correction: 'Name the table.',
      scope: 'change 13',
      source: 'S-2',
    });
    resolvePendingDecision(root, asked.decision!, 'improve', 'yes');
    resolveAgentLearn(workspace, { decision: asked.decision! });
    const today = new Date().toISOString().slice(0, 10);
    expect(workspace.read(`draft/${AGENT_NAME}.md`)).toContain(`- learned ${today} in change 13`);
  });

  it('FR-29: drift passes with fresh facts, no evidence and an unreadable evidence file', () => {
    const root = project();
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    const fresh = runAgentDrift(workspace);
    expect(fresh.ok).toBe(true);
    expect(fresh.lines).toEqual([
      `${AGENT_NAME}: every externally verified fact is fresh and the model is unchanged.`,
    ]);
    put(root, `.paqad/authoring/agents/${AGENT_NAME}/evidence.json`, '{broken');
    expect(runAgentDrift(workspace).ok).toBe(true);
    put(root, `.paqad/authoring/agents/${AGENT_NAME}/evidence.json`, '{}');
    expect(runAgentDrift(workspace).ok).toBe(true);
  });

  it('AC-41: regression needs two iterations and a shared tier to compare', () => {
    const root = project();
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    expect(() => runAgentRegression(workspace)).toThrow(/needs two recorded iterations/u);
    workspace.writeJson('iteration-1/benchmark.json', {});
    workspace.writeJson('iteration-2/benchmark.json', {});
    expect(() => runAgentRegression(workspace)).toThrow(/have no registered tier to compare/u);
    workspace.writeJson('iteration-2/benchmark.json', {
      registered_tier: 'fast',
      tiers: [{ tier: 'fast', with_agent: metrics(1, 100) }],
    });
    expect(() => runAgentRegression(workspace)).toThrow(/have no fast tier to compare/u);
  });

  it('AC-42: the catalog without retirement raises no decision', () => {
    const root = project();
    const result = runAgentCatalog(root);
    expect(result.decision).toBeUndefined();
  });
});
