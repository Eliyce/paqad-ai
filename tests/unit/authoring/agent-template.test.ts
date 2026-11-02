import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentCompletionFindings } from '@/authoring/completion.js';
import { hashAgentFile } from '@/authoring/hash.js';
import {
  lintRenderedTemplateAgent,
  renderedLintScope,
  type AgentAuditSources,
} from '@/authoring/lint/audit.js';
import {
  RENDERED_DIR,
  draftedRenderNames,
  readAgentDraftSource,
  runAgentDraft,
} from '@/authoring/stages/agent-draft.js';
import { runAgentRelease } from '@/authoring/stages/agent-release.js';
import {
  draftAgentHash,
  draftAgentHashWithoutDescription,
  runAgentTest,
} from '@/authoring/stages/agent-test.js';
import { AgentWorkspace, AuthoringRefusal } from '@/authoring/workspace.js';
import { readAgentRecord } from '@/feature-evidence/artifacts.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import {
  AGENT_BODY,
  AGENT_INTAKE,
  AGENT_SOURCES,
  AGENT_TRACE,
  agentProject,
  agentText,
  cleanAgentProjects,
  passGate,
  put,
} from '../../shared/agent-pipeline.js';

const TEMPLATE = 'runtime/templates/stage-agents/claude.md.hbs';
const TEMPLATE_TEXT =
  '---\nname: {{agentName}}\n{{#if effort}}effort: {{effort}}\n{{/if}}tools: {{tools}}\n---\n\n{{{body}}}\n';
const NAMES = ['paqad-one', 'paqad-two'];
const NOW = () => new Date('2026-11-01T10:00:00.000Z');
const TESTS_PASS = async () => ({ exitCode: 0, failedTests: null });

let root: string;
let sessionId: string;
let dir: string;

function rendered(front: Record<string, string> = {}, body = AGENT_BODY): string[] {
  return NAMES.map((name) =>
    agentText(
      {
        name,
        description: `'Use this agent when the ${name} stage runs. For example "run ${name}".'`,
        ...front,
      },
      body,
    ),
  );
}

function sources(contents: string[] = rendered()): AgentAuditSources {
  return {
    renderTemplate: (path) =>
      path === TEMPLATE
        ? NAMES.map((name, index) => ({
            name,
            path: `${path}#${name}`,
            host: 'claude-code' as const,
            content: contents[index]!,
          }))
        : [],
    dispatched: new Set(),
  };
}

function workspaceFor(
  name: string,
  intake: Record<string, unknown> = AGENT_INTAKE,
): AgentWorkspace {
  const workspace = new AgentWorkspace(root, name);
  passGate(workspace, 'justification.md', 'S0');
  workspace.write('intake.yaml', YAML.stringify(intake));
  workspace.write('sources.md', AGENT_SOURCES);
  passGate(workspace, 'overlap.md', 'S2');
  return workspace;
}

function draft(workspace: AgentWorkspace, agentSources: AgentAuditSources = sources()) {
  return runAgentDraft(workspace, { file: TEMPLATE, traceText: AGENT_TRACE, agentSources });
}

async function throughS6(workspace: AgentWorkspace): Promise<void> {
  draft(workspace);
  const tested = await runAgentTest(workspace, { runTests: TESTS_PASS, agentSources: sources() });
  expect(tested.ok).toBe(true);
  workspace.writeJson('benchmark.json', {
    gate: 'passed',
    stage: 'S5',
    inputs_hash: draftAgentHashWithoutDescription(workspace),
  });
  workspace.writeJson('delegation-results.json', {
    gate: 'passed',
    stage: 'S6',
    skipped: 'dispatched',
    inputs_hash: draftAgentHash(workspace),
  });
}

beforeEach(() => {
  root = agentProject();
  mkdirSync(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('USERPROFILE', join(root, 'home'));
  vi.stubEnv('PAQAD_AGENT_ORCHESTRATOR_ENABLED', undefined);
  put(root, 'package.json', JSON.stringify({ name: 'paqad-ai' }));
  put(root, '.paqad/project-profile.yaml', YAML.stringify({ commands: { test: 'npm test' } }));
  put(root, '.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'claude-code' }));
  put(root, TEMPLATE, TEMPLATE_TEXT);
  sessionId = resolveSessionId(root, 'ses-agent-template');
  dir = openFeatureChange(root, sessionId, {
    adapter: 'claude-code',
    title: 'stage agent template',
    lane: 'graduated',
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  cleanAgentProjects();
});

describe('agent draft of a stage-agent template', () => {
  it('renders the template once per agent and passes S3 on every rendered body', () => {
    const workspace = workspaceFor('claude');
    const result = draft(workspace);
    expect(result.ok).toBe(true);
    expect(result.lines[0]).toContain(`the template ${TEMPLATE} renders 2 agents`);
    expect(workspace.read('draft/claude.md')).toBe(TEMPLATE_TEXT);
    expect(workspace.read(`${RENDERED_DIR}/paqad-two.md`)).toBe(rendered()[1]);
    expect(readAgentDraftSource(workspace)).toEqual({
      file: TEMPLATE,
      hook_scripts: [],
      rendered: NAMES,
    });
  });

  it('fails S3 naming each rendered agent whose body misses a section', () => {
    const workspace = workspaceFor('claude');
    const body = AGENT_BODY.replace('## Stop when', '## Finish');
    const result = draft(workspace, sources(rendered({}, body)));
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toContain('paqad-one: the body headings: missing ## Stop when');
    expect(result.lines[0]).toContain('paqad-two: the body headings: missing ## Stop when');
  });

  it('lists no drafted render for an ordinary agent draft', () => {
    const workspace = workspaceFor('claude');
    workspace.writeJson('draft-source.json', {
      file: '.claude/agents/claude.md',
      hook_scripts: [],
    });
    expect(draftedRenderNames(workspace)).toEqual([]);
  });

  it('refuses a template that renders no agent', () => {
    const workspace = workspaceFor('claude');
    const none: AgentAuditSources = { renderTemplate: () => [], dispatched: new Set() };
    expect(() => draft(workspace, none)).toThrow(/renders no agent/u);
  });

  it('refuses a template given a memory file', () => {
    const workspace = workspaceFor('claude', { ...AGENT_INTAKE, memory: 'candidate' });
    expect(() =>
      runAgentDraft(workspace, {
        file: TEMPLATE,
        traceText: AGENT_TRACE,
        memoryText: '# Memory\n',
        agentSources: sources(),
      }),
    ).toThrow(/a stage-agent template gets no MEMORY.md/u);
  });

  it('fails S3 on a render with no valid frontmatter', () => {
    const workspace = workspaceFor('claude');
    const result = draft(workspace, sources(['no frontmatter here\n', rendered()[1]!]));
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toContain('paqad-one: the rendered agent has no valid frontmatter');
    expect(result.lines[0]).not.toContain('paqad-two:');
  });

  it('refuses a template with no renderer, and a template of another agent', () => {
    const workspace = workspaceFor('claude');
    expect(() => runAgentDraft(workspace, { file: TEMPLATE, traceText: AGENT_TRACE })).toThrow(
      /no renderer for it/u,
    );
    expect(() => draft(workspaceFor('codex'))).toThrow(AuthoringRefusal);
  });
});

describe('agent test of a stage-agent template', () => {
  it('lints every rendered agent and passes with no blocking finding', async () => {
    const workspace = workspaceFor('claude');
    draft(workspace);
    const result = await runAgentTest(workspace, {
      runTests: TESTS_PASS,
      agentSources: sources(),
    });
    expect(result.ok).toBe(true);
    expect(workspace.readJson<{ gate: string }>('lint.json')?.gate).toBe('passed');
  });

  it('judges the renders with the same scope as agent lint --all, so a user-level agent does not collide', async () => {
    put(
      root,
      'home/.claude/agents/paqad-one.md',
      agentText({
        name: 'paqad-one',
        description: `'Use this agent when the paqad-one stage runs. For example "run paqad-one".'`,
      }),
    );
    const workspace = workspaceFor('claude');
    draft(workspace);
    const result = await runAgentTest(workspace, {
      runTests: TESTS_PASS,
      agentSources: sources(),
    });
    const scope = renderedLintScope(root, new Set());
    const audit = sources()
      .renderTemplate(TEMPLATE)
      .map((agent) => lintRenderedTemplateAgent(root, agent, scope));
    const lint = workspace.readJson<{ findings: unknown[] }>('lint.json')!;
    expect(lint.findings).toEqual(audit.flatMap((entry) => entry.findings));
    expect(result.ok).toBe(true);
  });

  it('fails on a rendered agent whose Bash has no permission decision, and raises none for the template', async () => {
    const workspace = workspaceFor('claude');
    const bash = sources(rendered({ tools: 'Read, Grep, Glob, Bash' }));
    draft(workspace, bash);
    const result = await runAgentTest(workspace, { runTests: TESTS_PASS, agentSources: bash });
    expect(result.ok).toBe(false);
    expect(result.decision).toBeUndefined();
    expect(result.lines.join('\n')).toContain(`AG-022 ${TEMPLATE}#paqad-one`);
    expect(workspace.exists('permissions.json')).toBe(false);
  });
});

describe('agent release of a stage-agent template', () => {
  it('releases in place, writes no SDK form and records the template hash the completion check accepts', async () => {
    const workspace = workspaceFor('claude');
    await throughS6(workspace);
    const result = runAgentRelease(workspace, { sessionId, now: NOW, agentSources: sources() });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, TEMPLATE), 'utf8')).toBe(TEMPLATE_TEXT);
    expect(result.artifacts).not.toContain('.paqad/authoring/agents/claude/claude.agent.json');
    const record = readAgentRecord(root, dir, 'claude')!;
    expect(record.released_path).toBe(TEMPLATE);
    expect(record.files).toEqual([{ path: TEMPLATE, hash: hashAgentFile(root, TEMPLATE) }]);
    const findings = () =>
      agentCompletionFindings({ projectRoot: root, dirName: dir, changedFiles: [TEMPLATE] });
    expect(findings()).toEqual([]);
    writeFileSync(join(root, TEMPLATE), `${TEMPLATE_TEXT}edited\n`);
    expect(findings()).toHaveLength(1);
  });

  it('refuses when the template changed after the draft and never writes into it', async () => {
    const workspace = workspaceFor('claude');
    await throughS6(workspace);
    writeFileSync(join(root, TEMPLATE), `${TEMPLATE_TEXT}edited\n`);
    expect(() =>
      runAgentRelease(workspace, { sessionId, now: NOW, agentSources: sources() }),
    ).toThrow(/changed after S3 drafted it/u);
    expect(readFileSync(join(root, TEMPLATE), 'utf8')).toBe(`${TEMPLATE_TEXT}edited\n`);
  });

  it('refuses when a render changed after the draft, even with the template bytes unchanged', async () => {
    const workspace = workspaceFor('claude');
    await throughS6(workspace);
    const drifted = sources([rendered()[0]!, `${rendered()[1]!}\nOne more line.\n`]);
    expect(() =>
      runAgentRelease(workspace, { sessionId, now: NOW, agentSources: drifted }),
    ).toThrow(/the template now renders paqad-two differently from what S3 drafted/u);
    expect(readAgentRecord(root, dir, 'claude')).toBeNull();
  });

  it('refuses when a drafted render is gone', async () => {
    const workspace = workspaceFor('claude');
    await throughS6(workspace);
    const fewer: AgentAuditSources = {
      renderTemplate: (path) => sources().renderTemplate(path).slice(0, 1),
      dispatched: new Set(),
    };
    expect(() => runAgentRelease(workspace, { sessionId, now: NOW, agentSources: fewer })).toThrow(
      /renders paqad-two differently/u,
    );
  });

  it('refuses a template release with no renderer', async () => {
    const workspace = workspaceFor('claude');
    await throughS6(workspace);
    expect(() => runAgentRelease(workspace, { sessionId, now: NOW })).toThrow(
      /no renderer for it/u,
    );
  });
});
