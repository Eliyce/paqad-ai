import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdapterFactory } from '@/adapters/factory.js';
import { AGENT_PERMISSION_ALLOW } from '@/authoring/decisions.js';
import { lintAgentInProject } from '@/authoring/lint/agent-lint.js';
import { parseAgentSource } from '@/authoring/package/agent-render.js';
import { agentRootPattern, runAgentRelease } from '@/authoring/stages/agent-release.js';
import {
  draftAgentHash,
  draftAgentHashWithoutDescription,
  runAgentTest,
} from '@/authoring/stages/agent-test.js';
import { runAgentImprove } from '@/authoring/stages/improve.js';
import { AgentWorkspace, AuthoringRefusal } from '@/authoring/workspace.js';
import { resolvePendingDecision } from '@/decisions/authoring.js';
import { readAgentRecord } from '@/feature-evidence/artifacts.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

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
  type Loose,
} from '../../shared/agent-pipeline.js';

function tomlInstructions(content: string): string {
  const start = content.indexOf('developer_instructions = """\n');
  const body = content.slice(start + 'developer_instructions = """\n'.length);
  return body.slice(0, body.lastIndexOf('"""'));
}

const NOW = () => new Date('2026-11-01T10:00:00.000Z');
const PORTABLE_BODY = AGENT_BODY.replace('- Do not edit any file.', '- Do not guess the schema.');

let root: string;
let sessionId: string;
let dir: string;

function manifest(adapters: string[]): void {
  const [first, ...rest] = adapters;
  put(
    root,
    '.paqad/onboarding-manifest.json',
    JSON.stringify({
      adapter: first,
      generated_artifacts: rest.map((type) => ({
        path: AdapterFactory.create(type as 'codex-cli').getConfigPath(),
      })),
    }),
  );
}

beforeEach(() => {
  root = agentProject();
  mkdirSync(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('USERPROFILE', join(root, 'home'));
  put(root, '.paqad/project-profile.yaml', YAML.stringify({ commands: { test: 'npm test' } }));
  manifest(['claude-code', 'codex-cli']);
  sessionId = resolveSessionId(root, 'ses-agent-release');
  dir = openFeatureChange(root, sessionId, {
    adapter: 'claude-code',
    title: 'add migration reviewer',
    lane: 'graduated',
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  cleanAgentProjects();
});

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
    threshold: 0.8,
    baseline_arm: 'main_thread',
    registered_tier: 'fast',
    registered_model: 'haiku',
    reliability: [{ arm: 'with_agent', tier: 'fast', pass_hat_k: 1 }],
    memory: null,
    performance: {
      tokens_per_task: { value: 1000, source: 'subagent-dispatch' },
      returned_to_main_tokens: { value: 300, source: 'subagent-dispatch' },
      context_utilisation: { value: 'unavailable', source: 'subagent-dispatch' },
    },
    batch: 'unavailable',
    creation_cost_usd: { S5: 0.6 },
  });
  workspace.writeJson('delegation-results.json', {
    gate: 'passed',
    stage: 'S6',
    chosen_score: 0.95,
    chosen_iteration: 1,
    threshold: 0.9,
    creation_cost_usd: { S6: 0.2 },
    inputs_hash: draftAgentHash(workspace),
  });
  return workspace;
}

function release(workspace: AgentWorkspace, version?: string) {
  return runAgentRelease(workspace, { sessionId, now: NOW, version });
}

function evidence(): Loose {
  return JSON.parse(
    readFileSync(join(root, `.paqad/authoring/agents/${AGENT_NAME}/evidence.json`), 'utf8'),
  ) as Loose;
}

describe('paqad-ai agent release (S7)', () => {
  it('AC-9: refuses when an earlier gate has no passing record and no override', async () => {
    const workspace = await ready();
    workspace.writeJson('delegation-results.json', { gate: 'failed', stage: 'S6' });
    expect(() => release(workspace)).toThrow(/S6 delegation has not passed/);
    const bare = new AgentWorkspace(root, 'other-reviewer');
    expect(() => release(bare)).toThrow(AuthoringRefusal);
  });

  async function approvedInheritingAgent(): Promise<AgentWorkspace> {
    const workspace = await ready(agentText({ tools: undefined }, PORTABLE_BODY));
    const id = workspace.readJson<string[]>('permissions.json')![0]!;
    resolvePendingDecision(root, id, AGENT_PERMISSION_ALLOW, 'needs every tool');
    await runAgentTest(workspace, { runTests: async () => ({ exitCode: 0, failedTests: null }) });
    const benchmark = workspace.readJson<Record<string, unknown>>('benchmark.json')!;
    workspace.writeJson('benchmark.json', {
      ...benchmark,
      inputs_hash: draftAgentHashWithoutDescription(workspace),
    });
    return workspace;
  }

  it('AC-14 AC-62: writes a Claude Code file, a Codex TOML and an SDK form with the same tools, model and prompt', async () => {
    const workspace = await approvedInheritingAgent();
    const result = release(workspace);
    expect(result.ok).toBe(true);
    const claude = parseAgentSource(
      readFileSync(join(root, `.claude/agents/${AGENT_NAME}.md`), 'utf8'),
    );
    const toml = readFileSync(join(root, `.codex/agents/${AGENT_NAME}.toml`), 'utf8');
    const sdk = JSON.parse(
      readFileSync(
        join(root, `.paqad/authoring/agents/${AGENT_NAME}/${AGENT_NAME}.agent.json`),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(sdk.tools).toEqual(claude.tools);
    expect(sdk.model).toBe(claude.model);
    expect(sdk.prompt).toBe(claude.body);
    expect(tomlInstructions(toml).trim()).toBe(claude.body.trim());
    expect(claude.tools).toBeUndefined();
    const notes = evidence().host_notes['codex-cli'] as string[];
    expect(notes.some((note) => note.startsWith('model omitted'))).toBe(true);
    expect(evidence().deployable).toEqual({ 'claude-code': true, 'codex-cli': true });
  });

  it('INV-6: a plain tools allowlist the Codex form drops leaves Codex not deployable with a skill proposal', async () => {
    const workspace = await ready(agentText({ tools: 'Read, Grep' }, PORTABLE_BODY));
    const result = release(workspace);
    expect(existsSync(join(root, `.claude/agents/${AGENT_NAME}.md`))).toBe(true);
    expect(existsSync(join(root, `.codex/agents/${AGENT_NAME}.toml`))).toBe(false);
    expect(evidence().deployable).toEqual({ 'claude-code': true, 'codex-cli': false });
    expect(evidence().host_notes['codex-cli']).toContain(
      'tools omitted: Codex has no documented field for it',
    );
    expect(result.lines.join('\n')).toMatch(
      /not deployable on codex-cli: its form would drop the tool allowlist Read, Grep.*Propose a skill/,
    );
  });

  it('INV-5: a draft whose frontmatter name walks out of the agents folder is refused and nothing is written', async () => {
    const workspace = await ready();
    const sneaky = agentText({ name: '../../pwned-reviewer' }, PORTABLE_BODY);
    const lint = lintAgentInProject(root, workspace.path(`draft/${AGENT_NAME}.md`));
    expect(lint.blocking).toBe(0);
    workspace.write(`draft/${AGENT_NAME}.md`, sneaky);
    const blocked = lintAgentInProject(root, workspace.path(`draft/${AGENT_NAME}.md`));
    expect(blocked.findings.filter((entry) => entry.rule === 'AG-001')).toHaveLength(1);
    expect(() => release(workspace)).toThrow(/Release refused/);
    expect(existsSync(join(root, 'pwned-reviewer.md'))).toBe(false);
    expect(existsSync(join(root, '.claude/agents'))).toBe(false);
  });

  it('INV-5: a draft whose frontmatter name differs from the agent name is refused before any path is built', async () => {
    const workspace = await ready();
    const renamed = agentText({ name: 'schema-reviewer' }, PORTABLE_BODY);
    workspace.write(`draft/${AGENT_NAME}.md`, renamed);
    await runAgentTest(workspace, { runTests: async () => ({ exitCode: 0, failedTests: null }) });
    const benchmark = workspace.readJson<Record<string, unknown>>('benchmark.json')!;
    workspace.writeJson('benchmark.json', {
      ...benchmark,
      inputs_hash: draftAgentHashWithoutDescription(workspace),
    });
    const delegation = workspace.readJson<Record<string, unknown>>('delegation-results.json')!;
    workspace.writeJson('delegation-results.json', {
      ...delegation,
      inputs_hash: draftAgentHash(workspace),
    });
    expect(() => release(workspace)).toThrow(
      /the draft frontmatter names "schema-reviewer", but the agent is migration-reviewer/,
    );
    expect(existsSync(join(root, '.claude/agents/schema-reviewer.md'))).toBe(false);
  });

  it('AC-22: a host with no agent support gets no file, deployable false and a skill proposal', async () => {
    manifest(['claude-code', 'cursor']);
    const workspace = await ready();
    const result = release(workspace);
    expect(existsSync(join(root, '.cursor/agents'))).toBe(false);
    expect(evidence().deployable.cursor).toBe(false);
    expect(result.lines.join('\n')).toMatch(/cursor runs no subagents.*Propose a skill/);
  });

  it('a Codex form that would drop a Do not restriction is not written and proposes a skill', async () => {
    const workspace = await ready(agentText());
    const result = release(workspace);
    expect(existsSync(join(root, `.codex/agents/${AGENT_NAME}.toml`))).toBe(false);
    expect(evidence().deployable['codex-cli']).toBe(false);
    expect(result.lines.join('\n')).toMatch(/not deployable on codex-cli.*Do not item/);
  });

  it('AC-17: a permissionMode with no resolved packet asking for it is left out of the file', async () => {
    const workspace = await ready(agentText({ permissionMode: 'acceptEdits' }, PORTABLE_BODY));
    release(workspace);
    const text = readFileSync(join(root, `.claude/agents/${AGENT_NAME}.md`), 'utf8');
    expect(text).not.toContain('permissionMode');
  });

  it('AC-36 AC-37 AC-44: the evidence holds the SDK budget apart, the performance labels and the creation cost', async () => {
    const workspace = await ready();
    release(workspace);
    const sdk = readFileSync(
      join(root, `.paqad/authoring/agents/${AGENT_NAME}/${AGENT_NAME}.agent.json`),
      'utf8',
    );
    expect(sdk).not.toContain('maxBudgetUsd');
    const file = evidence();
    expect(file.sdk.run_options.maxBudgetUsd).toBeGreaterThan(0);
    expect(Array.isArray(file.sdk.uncarried_rules)).toBe(true);
    expect(file.sdk.fields_checked.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(file.performance.context_utilisation).toEqual({
      value: 'unavailable',
      source: 'subagent-dispatch',
    });
    expect(file.performance.task_type).toContain('planted defects');
    expect(file.creation_cost).toEqual({ S5: 0.6, S6: 0.2, source: 'host-usage' });
    expect(file.returned_to_main_tokens_median).toBe(300);
    expect(file.model_stamp).toEqual({ model: 'haiku', proven_on: 'haiku', tier: 'fast' });
    expect(file.pattern).toBe('single-call');
    expect(file.class).toBe('reviewer');
    expect(file.memory).toBe('none');
  });

  it('AC-36: a must-not rule enforced only by a hook is listed as uncarried by the SDK form', async () => {
    put(root, '.claude/hooks/guard.mjs', 'x\n');
    put(root, 'tests/agents/migration-reviewer/guard.test.mjs', 'x\n');
    const hooks =
      '\n  PreToolUse:\n    - matcher: "Edit"\n      hooks:\n        - type: command\n          command: node .claude/hooks/guard.mjs';
    const workspace = await ready(agentText({ hooks }, PORTABLE_BODY));
    release(workspace);
    expect(evidence().sdk.uncarried_rules.join('\n')).toContain('node .claude/hooks/guard.mjs');
  });

  it('AC-54: a re-recorded gate on an unchanged agent rewrites evidence.json without a new version or CHANGELOG entry', async () => {
    const workspace = await ready();
    release(workspace);
    const changelogPath = join(root, `.paqad/authoring/agents/${AGENT_NAME}/CHANGELOG.md`);
    const changelog = readFileSync(changelogPath, 'utf8');
    const benchmark = workspace.readJson<Record<string, unknown>>('benchmark.json')!;
    workspace.writeJson('benchmark.json', {
      ...benchmark,
      performance: { tokens_per_task: { value: 42, source: 'subagent-dispatch' } },
    });
    const again = release(workspace);
    expect(again.lines[0]).toContain('its evidence in');
    expect(evidence().version).toBe('1.0.0');
    expect(evidence().performance.tokens_per_task).toMatchObject({
      value: 42,
      source: 'subagent-dispatch',
    });
    expect(readFileSync(changelogPath, 'utf8')).toBe(changelog);
  });

  it('AC-54: releasing twice writes the same files, one CHANGELOG entry and one bundle record', async () => {
    const workspace = await ready();
    release(workspace);
    const first = readAgentRecord(root, dir, AGENT_NAME)!;
    const changelog = readFileSync(
      join(root, `.paqad/authoring/agents/${AGENT_NAME}/CHANGELOG.md`),
      'utf8',
    );
    const again = release(workspace);
    expect(again.lines[0]).toContain('already released with this content');
    expect(again.lines.at(-1)?.replaceAll('\\', '/')).toMatch(
      new RegExp(`${dir}/agent-${AGENT_NAME}\\.json is already current\\.$`, 'u'),
    );
    expect(
      readFileSync(join(root, `.paqad/authoring/agents/${AGENT_NAME}/CHANGELOG.md`), 'utf8'),
    ).toBe(changelog);
    expect(changelog.match(/^## 1\.0\.0$/gmu)).toHaveLength(1);
    expect(readAgentRecord(root, dir, AGENT_NAME)).toEqual(first);
    expect(first.status).toBe('passed');
    expect(first.released_path).toBe(`.claude/agents/${AGENT_NAME}.md`);
    expect(first.files.map((file) => file.path)).toEqual([`.claude/agents/${AGENT_NAME}.md`]);
  });

  it('a later edit to the agent or a named hook script needs a rerun of the stage that judged it', async () => {
    const workspace = await ready();
    workspace.write(`draft/${AGENT_NAME}.md`, `${agentText({}, PORTABLE_BODY)}\nOne more line.\n`);
    expect(() => release(workspace)).toThrow(/changed after S4 judged it/);
  });

  it('AC-68: a permission approved on the draft copy still holds on the released file', async () => {
    const text = agentText({ permissionMode: 'bypassPermissions' }, PORTABLE_BODY);
    const workspace = await ready(text);
    const lint = workspace.readJson<{ powers: string[]; file_hash: string }>('lint.json')!;
    const id = workspace.readJson<string[]>('permissions.json')![0]!;
    resolvePendingDecision(root, id, AGENT_PERMISSION_ALLOW, 'needed');
    expect(lint.powers).toEqual(['bypassPermissions']);
    await runAgentTest(workspace, { runTests: async () => ({ exitCode: 0, failedTests: null }) });
    workspace.writeJson('benchmark.json', {
      gate: 'passed',
      stage: 'S5',
      inputs_hash: draftAgentHashWithoutDescription(workspace),
    });
    release(workspace);
    const released = lintAgentInProject(root, join(root, `.claude/agents/${AGENT_NAME}.md`));
    expect(released.findings.map((entry) => entry.rule)).not.toContain('AG-015');
    expect(readFileSync(join(root, `.claude/agents/${AGENT_NAME}.md`), 'utf8')).toContain(
      'permissionMode: bypassPermissions',
    );
    expect(evidence().permission_decisions).toEqual([id]);
  });

  it('EC-A06: a kept memory arm with auto memory off is refused without an S5 override', async () => {
    const workspace = await ready();
    const benchmark = workspace.readJson<Record<string, unknown>>('benchmark.json')!;
    workspace.writeJson('benchmark.json', { ...benchmark, memory: { kept: true } });
    put(root, '.claude/settings.json', JSON.stringify({ autoMemoryEnabled: false }));
    expect(() => release(workspace)).toThrow(/the memory need is unmet/);
  });

  it('EC-A04: a plugin agent drops hooks and records them as SubagentStart and SubagentStop settings hooks', async () => {
    put(root, 'package.json', JSON.stringify({ name: 'paqad-ai' }));
    put(root, '.claude/hooks/guard.mjs', 'x\n');
    put(root, 'tests/agents/migration-reviewer/guard.test.mjs', 'x\n');
    const hooks =
      '\n  PreToolUse:\n    - matcher: "Edit"\n      hooks:\n        - type: command\n          command: node .claude/hooks/guard.mjs';
    const workspace = await ready(agentText({ hooks }, PORTABLE_BODY));
    workspace.writeJson('draft-source.json', {
      file: `runtime/claude-plugin/agents/${AGENT_NAME}.md`,
      hook_scripts: [],
    });
    release(workspace);
    const written = readFileSync(
      join(root, `runtime/claude-plugin/agents/${AGENT_NAME}.md`),
      'utf8',
    );
    expect(written).not.toContain('hooks:');
    expect(existsSync(join(root, `.claude/agents/${AGENT_NAME}.md`))).toBe(false);
    expect(evidence().plugin.settings_hooks).toEqual([
      {
        event: 'SubagentStart',
        matcher: `^(paqad:)?${AGENT_NAME}$`,
        command: 'node .claude/hooks/guard.mjs',
        replaces: 'PreToolUse (Edit)',
      },
    ]);
  });
});

describe('paqad-ai agent improve', () => {
  it('snapshots the installed agent as the old_agent baseline and skips S0', () => {
    put(root, `.claude/agents/${AGENT_NAME}.md`, agentText());
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    const result = runAgentImprove(workspace);
    expect(result.ok).toBe(true);
    expect(workspace.read(`agent-snapshot/${AGENT_NAME}.md`)).toBe(agentText());
    expect(result.lines.at(-1)).toContain('S0 is skipped');
    writeFileSync(join(root, `.claude/agents/${AGENT_NAME}.md`), 'changed');
    expect(runAgentImprove(workspace).lines[0]).toContain('already exists');
    expect(() => runAgentImprove(new AgentWorkspace(root, 'missing-reviewer'))).toThrow(
      /no installed agent named missing-reviewer/,
    );
  });
});

describe('paqad-ai agent improve sources', () => {
  it('refuses a source that is missing or a folder, with exit 2', () => {
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    const refused = (source: string) => {
      try {
        runAgentImprove(workspace, { source });
      } catch (error) {
        return error as AuthoringRefusal;
      }
      throw new Error(`${source} was not refused`);
    };
    expect(refused('.claude/agents/none.md').message).toBe(
      '.claude/agents/none.md is not an agent file.',
    );
    mkdirSync(join(root, '.claude/agents/folder.md'), { recursive: true });
    expect(refused('.claude/agents/folder.md').exitCode).toBe(2);
  });

  it.skipIf(process.platform === 'win32')('refuses an agent source that is a symlink', () => {
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    const refused = (source: string) => {
      try {
        runAgentImprove(workspace, { source });
      } catch (error) {
        return error as AuthoringRefusal;
      }
      throw new Error(`${source} was not refused`);
    };
    put(root, 'elsewhere/real.md', agentText());
    mkdirSync(join(root, '.claude/agents'), { recursive: true });
    symlinkSync(join(root, 'elsewhere/real.md'), join(root, '.claude/agents/link.md'));
    expect(refused('.claude/agents/link.md').message).toBe(
      '.claude/agents/link.md is not an agent file.',
    );
  });

  it('AC-35: snapshots the hook scripts the agent names that exist, and skips S1 once intake exists', () => {
    put(root, '.claude/hooks/guard.mjs', 'guard\n');
    const hooks =
      '\n  PreToolUse:\n    - matcher: "Edit"\n      hooks:\n        - type: command\n          command: node .claude/hooks/guard.mjs\n        - type: command\n          command: node .claude/hooks/gone.mjs';
    put(root, `.claude/agents/${AGENT_NAME}.md`, agentText({ hooks }));
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    workspace.write('intake.yaml', 'class: reviewer\n');
    const result = runAgentImprove(workspace);
    expect(workspace.read('agent-snapshot/.claude/hooks/guard.mjs')).toBe('guard\n');
    expect(workspace.exists('agent-snapshot/.claude/hooks/gone.mjs')).toBe(false);
    expect(result.lines[0]).toContain('.claude/hooks/guard.mjs');
    expect(result.lines.at(-1)).toContain('S0 and S1 are skipped');
  });

  it('snapshots an agent whose frontmatter does not parse, with no hook scripts', () => {
    put(root, '.claude/agents/odd.md', 'no frontmatter\n');
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    const result = runAgentImprove(workspace, { source: '.claude/agents/odd.md' });
    expect(workspace.read(`agent-snapshot/${AGENT_NAME}.md`)).toBe('no frontmatter\n');
    expect(result.lines[0]).toBe(
      `Snapshotted .claude/agents/odd.md to ${workspace.relPath('agent-snapshot')}; it is the old_agent baseline.`,
    );
  });
});

describe('agentRootPattern', () => {
  it('replaces every * in a root with one path segment', () => {
    const pattern = agentRootPattern('packs/*/agents/*');
    expect(pattern.test('packs/core/agents/review/reviewer.md')).toBe(true);
    expect(pattern.test('packs/core/agents/reviewer.md')).toBe(false);
    expect(pattern.test('packs/core/nested/agents/review/reviewer.md')).toBe(false);
  });

  it('matches regex special characters in a root literally', () => {
    const pattern = agentRootPattern('runtime/agents.v1+(x)');
    expect(pattern.test('runtime/agents.v1+(x)/reviewer.md')).toBe(true);
    expect(pattern.test('runtime/agentsXv1+(x)/reviewer.md')).toBe(false);
    expect(pattern.test('runtime/agents.v11(x)/reviewer.md')).toBe(false);
  });
});
