import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentLintResult } from '@/authoring/lint/agent-lint.js';
import { parseAgentSource } from '@/authoring/package/agent-render.js';
import {
  buildAgentEvidence,
  planAgentRelease,
  reliedRestrictions,
  runAgentRelease,
  type AgentReleasePlan,
} from '@/authoring/stages/agent-release.js';
import {
  draftAgentHash,
  draftAgentHashWithoutDescription,
  runAgentTest,
} from '@/authoring/stages/agent-test.js';
import { AgentWorkspace, OVERRIDES_FILE } from '@/authoring/workspace.js';

import {
  AGENT_BODY,
  AGENT_INTAKE,
  AGENT_NAME,
  agentProject,
  agentText,
  agentThrough,
  cleanAgentProjects,
  passGate,
  put,
} from '../../shared/agent-pipeline.js';

const NOW = () => new Date('2026-11-01T10:00:00.000Z');
const PORTABLE_BODY = AGENT_BODY.replace('- Do not edit any file.', '- Do not guess the schema.');

let root: string;

beforeEach(() => {
  root = agentProject();
  mkdirSync(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('USERPROFILE', join(root, 'home'));
  put(root, '.paqad/project-profile.yaml', YAML.stringify({ commands: { test: 'npm test' } }));
  put(root, '.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'claude-code' }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  cleanAgentProjects();
});

const LINT = {
  agent: AGENT_NAME,
  blocking: 0,
  warnings: 0,
  findings: [],
  powers: [],
} as unknown as AgentLintResult;

async function ready(
  text = agentText({}, PORTABLE_BODY),
  intake: Record<string, unknown> = AGENT_INTAKE,
): Promise<AgentWorkspace> {
  const workspace = agentThrough('S4', intake, root);
  workspace.write(`draft/${AGENT_NAME}.md`, text);
  workspace.writeJson('draft-source.json', {
    file: `.claude/agents/${AGENT_NAME}.md`,
    hook_scripts: [],
  });
  passGate(workspace, 'trace.md', 'S3');
  await runAgentTest(workspace, { runTests: async () => ({ exitCode: 0, failedTests: null }) });
  workspace.writeJson('benchmark.json', {
    gate: 'passed',
    stage: 'S5',
    inputs_hash: draftAgentHashWithoutDescription(workspace),
    pass_hat_k: 1,
    registered_tier: 'fast',
    memory: { kept: true },
  });
  workspace.writeJson('delegation-results.json', {
    gate: 'passed',
    stage: 'S6',
    skipped: 'dispatched',
    inputs_hash: draftAgentHash(workspace),
  });
  return workspace;
}

function release(workspace: AgentWorkspace, version?: string) {
  return runAgentRelease(workspace, { sessionId: 'ses-none', now: NOW, version });
}

function evidence(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(root, `.paqad/authoring/agents/${AGENT_NAME}/evidence.json`), 'utf8'),
  ) as Record<string, unknown>;
}

describe('agent release versions (AC-54)', () => {
  it('refuses a malformed --version and honours a well-formed one', async () => {
    const workspace = await ready();
    expect(() => release(workspace, 'v2')).toThrow(/--version must look like 1.2.3 \(got "v2"\)/u);
    const result = release(workspace, '2.3.4');
    expect(result.lines[0]).toContain(`Released ${AGENT_NAME} 2.3.4`);
    expect(result.lines.at(-1)).toContain('No change is active');
  });

  it('bumps the minor version when the agent changed since the last release', async () => {
    const workspace = await ready();
    release(workspace, '1.4.0');
    put(
      root,
      `.paqad/authoring/agents/${AGENT_NAME}/evidence.json`,
      JSON.stringify({ version: '1.4.0', file_hash: 'older' }),
    );
    const again = release(workspace);
    expect(again.lines[0]).toContain(`Released ${AGENT_NAME} 1.5.0`);
    const changelog = readFileSync(
      join(root, `.paqad/authoring/agents/${AGENT_NAME}/CHANGELOG.md`),
      'utf8',
    );
    expect(changelog.indexOf('## 1.5.0')).toBeLessThan(changelog.indexOf('## 1.4.0'));
  });

  it('treats an unreadable earlier evidence file as no earlier release', async () => {
    const workspace = await ready();
    put(root, `.paqad/authoring/agents/${AGENT_NAME}/evidence.json`, '{broken');
    expect(release(workspace).lines[0]).toContain(`Released ${AGENT_NAME} 1.0.0`);
  });

  it('INV-12: an S5 override skips the S5 hash check and labels the release unverified', async () => {
    const workspace = await ready();
    const benchmark = workspace.readJson<Record<string, unknown>>('benchmark.json')!;
    workspace.writeJson('benchmark.json', { ...benchmark, inputs_hash: 'stale' });
    expect(() => release(workspace)).toThrow(/changed after S5 judged it/u);
    workspace.writeJson(OVERRIDES_FILE, [
      { gate: 'S5', reason: 'harness down', by: 'owner', at: NOW().toISOString(), decision: 'D-1' },
    ]);
    release(workspace);
    expect(evidence().labels).toHaveLength(1);
  });
});

describe('agent release hook scripts', () => {
  it('copies the drafted copy of a hook script the agent names over the installed one', async () => {
    put(root, '.claude/hooks/guard.mjs', 'old\n');
    put(
      root,
      'tests/agents/migration-reviewer/guard.test.mjs',
      ['blocks', 'allows', 'invalid input']
        .map((name) => `it('guard ${name}', () => {});`)
        .join('\n'),
    );
    const hooks =
      '\n  PreToolUse:\n    - matcher: "Edit"\n      hooks:\n        - type: command\n          command: node .claude/hooks/guard.mjs';
    const workspace = await ready(agentText({ hooks }, PORTABLE_BODY));
    workspace.writeJson('draft-source.json', {
      file: `.claude/agents/${AGENT_NAME}.md`,
      hook_scripts: ['.claude/hooks/guard.mjs'],
    });
    workspace.write('draft/.claude/hooks/guard.mjs', 'new\n');
    const s4 = await runAgentTest(workspace, {
      runTests: async () => ({ exitCode: 0, failedTests: null }),
    });
    expect(s4.ok).toBe(true);
    const benchmark = workspace.readJson<Record<string, unknown>>('benchmark.json')!;
    workspace.writeJson('benchmark.json', {
      ...benchmark,
      inputs_hash: draftAgentHashWithoutDescription(workspace),
    });
    workspace.writeJson('delegation-results.json', {
      gate: 'passed',
      stage: 'S6',
      skipped: 'dispatched',
      inputs_hash: draftAgentHash(workspace),
    });
    release(workspace);
    expect(readFileSync(join(root, '.claude/hooks/guard.mjs'), 'utf8')).toBe('new\n');
    expect(existsSync(join(root, `.claude/agents/${AGENT_NAME}.md`))).toBe(true);
  });
});

describe('reliedRestrictions (AC-36)', () => {
  it('names every hook, an empty allowlist, disallowed tools and enforced Do not items', () => {
    const source = {
      ...parseAgentSource(agentText({}, PORTABLE_BODY)),
      tools: [],
      disallowedTools: ['Bash', 'Write'],
      hooks: {
        PreToolUse: [{ hooks: [] }, { matcher: 'Edit' }],
        Stop: [{ matcher: 'x' }],
        PostToolUse: 'not a list',
      },
    };
    const relied = reliedRestrictions(source as never, LINT);
    expect(relied).toContain('the blocking PreToolUse hook (*)');
    expect(relied).toContain('the blocking PreToolUse hook (Edit)');
    expect(relied).toContain('the tool allowlist (no tools)');
    expect(relied).toContain('disallowedTools Bash, Write');
    expect(relied.some((entry) => /Do not items? enforced/u.test(entry))).toBe(true);
  });

  it('counts no Do not item for a body without the section', () => {
    const source = {
      ...parseAgentSource(agentText({}, PORTABLE_BODY)),
      body: '## Objective\n\nx\n',
    };
    expect(reliedRestrictions(source as never, LINT).join(' ')).not.toContain('Do not');
  });
});

describe('buildAgentEvidence', () => {
  const PLAN: AgentReleasePlan = {
    files: [],
    deployable: {},
    host_notes: {},
    proposals: [],
    plugin: null,
    primary: '',
  };

  function build(workspace: AgentWorkspace, autoMemoryOff: boolean, overrides = []) {
    return buildAgentEvidence({
      workspace,
      intake: null,
      version: '1.0.0',
      fileHash: 'h',
      plan: PLAN,
      source: { ...parseAgentSource(agentText({ model: undefined })) },
      lint: LINT,
      overrides,
      labels: [],
      sdkPath: 'x.sdk.json',
      maxBudgetUsd: 1,
      autoMemoryOff,
    });
  }

  it('AC-36: with no recorded gates every measured field says unavailable or none', () => {
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    const built = build(workspace, false);
    expect(built.reliability).toBeNull();
    expect(built.delegation).toBeNull();
    expect(built.memory).toBe('none');
    expect(built.performance).toEqual({ source: 'unavailable' });
    expect(built.model_stamp).toEqual({ model: 'inherit', proven_on: null, tier: null });
    expect(built.creation_cost).toEqual({
      S5: 'unavailable',
      S6: 'unavailable',
      source: 'host-usage',
    });
    expect(built.script_tests).toEqual({ command: null, tests: 0, passed: 0 });
    expect(built.baseline).toMatchObject({ arm: null, runs: 0, passed: 'unavailable' });
  });

  it('EC-A06: a kept memory with auto memory off is recorded as unmet; a dispatched agent skips S6', async () => {
    const workspace = await ready();
    workspace.writeJson('baseline/verdicts.json', [{ passed: true }, { passed: false }]);
    const built = build(workspace, true, [
      { gate: 'S0', reason: 'r', by: 'b', at: 'a', decision: 'D-2' },
    ] as never);
    expect(built.memory).toMatchObject({
      kept: true,
      decision: 'kept',
      unmet: 'auto memory is off in this project',
    });
    expect(built.delegation).toEqual({ skipped: 'dispatched' });
    expect(built.creation_cost).toMatchObject({ S6: 0 });
    expect(built.baseline).toMatchObject({ runs: 2, passed: 1, verdict: 'overridden' });
    expect(built.reliability).toMatchObject({ threshold: null, table: [] });
    expect(build(workspace, false).memory).not.toHaveProperty('unmet');
  });

  it('a dropped memory arm is recorded as dropped', async () => {
    const workspace = await ready();
    const benchmark = workspace.readJson<Record<string, unknown>>('benchmark.json')!;
    workspace.writeJson('benchmark.json', { ...benchmark, memory: { kept: false } });
    workspace.writeJson('delegation-results.json', { gate: 'passed' });
    const built = build(workspace, true);
    expect(built.memory).toMatchObject({ decision: 'dropped' });
    expect(built.delegation).toEqual({
      validation_score: null,
      chosen_iteration: null,
      threshold: null,
    });
  });
});

describe('agent release targets', () => {
  it('AC-22: with only a host that runs no subagents, only the SDK form is written', async () => {
    put(root, '.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'cursor' }));
    const workspace = await ready();
    const result = release(workspace);
    expect(result.lines.join('\n')).toContain(
      `No enabled host runs subagents, so only the SDK form of ${AGENT_NAME} is written.`,
    );
    expect(result.lines[0]).toContain('into no host folder');
  });

  it('a stage agent in the paqad repo is released verbatim into its runtime folder', async () => {
    put(root, 'package.json', JSON.stringify({ name: 'paqad-ai' }));
    const workspace = await ready();
    workspace.writeJson('draft-source.json', {
      file: `runtime/templates/stage-agents/${AGENT_NAME}.md`,
      hook_scripts: [],
    });
    const benchmark = workspace.readJson<Record<string, unknown>>('benchmark.json')!;
    workspace.writeJson('benchmark.json', {
      ...benchmark,
      inputs_hash: draftAgentHashWithoutDescription(workspace),
    });
    workspace.writeJson('delegation-results.json', {
      gate: 'passed',
      stage: 'S6',
      skipped: 'dispatched',
      inputs_hash: draftAgentHash(workspace),
    });
    release(workspace);
    expect(
      readFileSync(join(root, `runtime/templates/stage-agents/${AGENT_NAME}.md`), 'utf8'),
    ).toBe(workspace.read(`draft/${AGENT_NAME}.md`));
  });

  it('EC-A04: a plugin agent moves Stop hooks to SubagentStop and skips entries with no command', async () => {
    put(root, 'package.json', JSON.stringify({ name: 'paqad-ai' }));
    const workspace = await ready();
    workspace.writeJson('draft-source.json', {
      file: `runtime/claude-plugin/agents/${AGENT_NAME}.md`,
      hook_scripts: [],
    });
    const plan = planAgentRelease({
      workspace,
      source: {
        ...parseAgentSource(agentText({}, PORTABLE_BODY)),
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'node a.mjs' }, { type: 'prompt' }] }],
          PreToolUse: [{ matcher: 'Edit' }, null],
          PostToolUse: 'not a list',
        },
      } as never,
      draftText: agentText({}, PORTABLE_BODY),
      lint: LINT,
      adapters: ['claude-code'],
    });
    expect(plan.plugin?.settings_hooks).toEqual([
      {
        event: 'SubagentStop',
        matcher: `^(paqad:)?${AGENT_NAME}$`,
        command: 'node a.mjs',
        replaces: 'Stop (*)',
      },
    ]);
  });

  it('refuses when the draft is gone', async () => {
    const workspace = await ready();
    workspace.remove(`draft/${AGENT_NAME}.md`);
    expect(() => release(workspace)).toThrow(/Release refused: there is no draft/u);
  });

  it('keeps an existing CHANGELOG entry for the same version and adds none', async () => {
    const workspace = await ready();
    put(
      root,
      `.paqad/authoring/agents/${AGENT_NAME}/CHANGELOG.md`,
      `# ${AGENT_NAME}\n\n## 1.0.0\n\n- hand written\n`,
    );
    release(workspace);
    expect(
      readFileSync(join(root, `.paqad/authoring/agents/${AGENT_NAME}/CHANGELOG.md`), 'utf8'),
    ).toBe(`# ${AGENT_NAME}\n\n## 1.0.0\n\n- hand written\n`);
  });
});
