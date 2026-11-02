import { isAbsolute, relative, resolve } from 'node:path';

import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';

import { readAuthoringConfig } from '../config.js';
import { readRegularFile } from '../fs-io.js';
import { agentHookScripts, bodyHeadingOrderProblem } from '../lint/agent-lint.js';
import type { AgentAuditSources, RenderedTemplateAgent } from '../lint/audit.js';
import { isAgentTemplatePath } from '../paths.js';
import { estimateTokens } from '../tokens.js';
import {
  AuthoringRefusal,
  readOverrides,
  renderGateMarkdown,
  requireEarlierGates,
  type AuthoringWorkspace,
} from '../workspace.js';
import { hasMemoryArm, readAgentIntake, type AgentIntake } from './agent-intake.js';
import {
  checkTrace,
  DRAFT_DIR,
  DRAFT_SOURCE_FILE,
  refuseDraft,
  UNSOURCED_HEADING,
} from './draft.js';
import { stageResult, type StageResult } from './result.js';

export const BRIEF_TEMPLATE_FILE = 'brief-template.md';
export const MEMORY_FILE = 'MEMORY.md';
export const BLOCKED_SHAPE = ['Status: BLOCKED', 'Decision needed:', 'Options:'] as const;

export interface AgentDraftInput {
  file?: string;
  traceText: string;
  memoryText?: string;
  refuse?: string;
  agentSources?: AgentAuditSources;
}

export interface AgentDraftSource {
  file: string;
  hook_scripts: string[];
  rendered?: string[];
}

export const RENDERED_DIR = `${DRAFT_DIR}/rendered`;

export function agentDraftFile(workspace: AuthoringWorkspace): string {
  return `${DRAFT_DIR}/${workspace.name}.md`;
}

export function readAgentDraftSource(workspace: AuthoringWorkspace): AgentDraftSource | null {
  const source = workspace.readJson<Partial<AgentDraftSource>>(DRAFT_SOURCE_FILE);
  if (typeof source?.file !== 'string') return null;
  return {
    file: source.file,
    hook_scripts: source.hook_scripts ?? [],
    ...(source.rendered === undefined ? {} : { rendered: source.rendered }),
  };
}

export function draftedRenderNames(workspace: AuthoringWorkspace): string[] {
  return readAgentDraftSource(workspace)?.rendered ?? [];
}

export function draftIsTemplate(workspace: AuthoringWorkspace): boolean {
  const file = readAgentDraftSource(workspace)?.file;
  return file !== undefined && isAgentTemplatePath(file);
}

export function templateStem(file: string): string {
  return file
    .slice(file.lastIndexOf('/') + 1)
    .replace(/\.hbs$/u, '')
    .replace(/\.[^.]+$/u, '');
}

export function renderTemplateDraft(
  file: string,
  sources: AgentAuditSources | undefined,
  stage: string,
): RenderedTemplateAgent[] {
  if (sources === undefined) {
    throw new AuthoringRefusal(
      `${stage} refused: ${file} is a stage-agent template, and this run has no renderer for it. Run it through paqad-ai agent.`,
      2,
    );
  }
  const rendered = sources.renderTemplate(file);
  if (rendered.length === 0) {
    throw new AuthoringRefusal(`${stage} refused: ${file} renders no agent.`, 2);
  }
  return rendered;
}

function projectRel(projectRoot: string, file: string): string {
  const rel = relative(resolve(projectRoot), resolve(projectRoot, file)).replaceAll('\\', '/');
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new AuthoringRefusal(`S3 draft refused: ${file} is outside the project root.`, 2);
  }
  return rel;
}

function regularFile(path: string): Buffer | null {
  try {
    return readRegularFile(path, false)?.buffer ?? null;
  } catch {
    return null;
  }
}

function readDraftedText(projectRoot: string, rel: string, what: string): string {
  const file = regularFile(resolve(projectRoot, rel));
  if (file === null) {
    throw new AuthoringRefusal(
      `S3 draft refused: ${what} ${rel} is missing or not a regular file.`,
      2,
    );
  }
  return file.toString('utf8');
}

export function missingBlockedShape(body: string): string[] {
  return BLOCKED_SHAPE.filter((line) => !body.includes(line));
}

export function renderBriefTemplate(name: string, intake: AgentIntake): string {
  return [
    `# Delegation brief: ${name}`,
    '',
    `The agent sees only this brief. It needs: ${intake.delegation_brief}`,
    '',
    '## Where the task fits',
    '',
    '<the change, the stage and why this agent is called now>',
    '',
    '## Files and interfaces',
    '',
    '<the files to read or edit and the interfaces they touch>',
    '',
    '## Resolved decisions',
    '',
    '<each decision already taken that the agent must not reopen>',
    '',
    '## Report path',
    '',
    `<where the report goes>. Report as: ${intake.report.template}, at most ${intake.report.max_tokens} tokens, ending with a Status line.`,
    '',
  ].join('\n');
}

function draftProblems(
  body: string,
  bodyTokens: number,
  maxTokens: number,
  hookProblems: readonly { command: string; problem: string }[],
): string[] {
  const problems: string[] = [];
  if (bodyTokens > maxTokens) {
    problems.push(`the body is ${bodyTokens} tokens, over agent_prompt_max_tokens (${maxTokens})`);
  }
  const order = bodyHeadingOrderProblem(body);
  if (order !== null) problems.push(`the body headings: ${order}`);
  const blocked = missingBlockedShape(body);
  if (blocked.length > 0) {
    problems.push(
      `the BLOCKED report shape is missing ${blocked.map((line) => `"${line}"`).join(', ')}`,
    );
  }
  for (const hook of hookProblems) problems.push(`the hook "${hook.command}" ${hook.problem}`);
  return problems;
}

export function runAgentDraft(workspace: AuthoringWorkspace, input: AgentDraftInput): StageResult {
  requireEarlierGates(workspace, 'S3');
  if (input.refuse !== undefined) return refuseDraft(workspace, input.refuse);
  if (input.file === undefined) {
    throw new AuthoringRefusal('draft needs --file <agent.md> and --trace <trace.md>.', 2);
  }
  const intake = readAgentIntake(workspace);
  const intakeOverridden = readOverrides(workspace).some((entry) => entry.gate === 'S1');
  if (intake === null && !intakeOverridden) {
    throw new AuthoringRefusal(
      `S3 draft can't start: ${workspace.relPath('intake.yaml')} is missing. Run paqad-ai agent intake ${workspace.name} <intake.yaml> first.`,
    );
  }
  if (input.memoryText !== undefined && intake !== null && !hasMemoryArm(intake)) {
    throw new AuthoringRefusal(
      `S3 draft refused: ${workspace.name} is one-shot (intake memory: none), so it gets no MEMORY.md.`,
      2,
    );
  }
  const rel = projectRel(workspace.projectRoot, input.file);
  const text = readDraftedText(workspace.projectRoot, rel, 'the agent file');
  if (isAgentTemplatePath(rel)) return runTemplateDraft(workspace, input, rel, text, intake);
  const split = splitSkillFrontmatter(text);
  if (!split.ok) {
    throw new AuthoringRefusal(
      `S3 draft refused: ${rel} has no valid frontmatter (${split.message}).`,
      2,
    );
  }
  const hooks = agentHookScripts(workspace.projectRoot, split.data.hooks);
  const missingScripts = hooks.scripts.filter(
    (script) => regularFile(resolve(workspace.projectRoot, script)) === null,
  );
  if (missingScripts.length > 0) {
    throw new AuthoringRefusal(
      `S3 draft refused: the hook scripts ${missingScripts.join(', ')} named by ${rel} do not exist.`,
      2,
    );
  }

  workspace.remove(DRAFT_DIR);
  const artifacts = [workspace.write(agentDraftFile(workspace), text)];
  for (const script of hooks.scripts) {
    artifacts.push(
      workspace.write(
        `${DRAFT_DIR}/${script}`,
        readDraftedText(workspace.projectRoot, script, 'the hook script'),
      ),
    );
  }
  workspace.writeJson(DRAFT_SOURCE_FILE, { file: rel, hook_scripts: hooks.scripts });
  workspace.remove(BRIEF_TEMPLATE_FILE);
  if (intake !== null) {
    artifacts.push(
      workspace.write(BRIEF_TEMPLATE_FILE, renderBriefTemplate(workspace.name, intake)),
    );
  }
  workspace.remove(MEMORY_FILE);
  if (intake === null ? input.memoryText !== undefined : hasMemoryArm(intake)) {
    artifacts.push(
      workspace.write(MEMORY_FILE, input.memoryText ?? `# Memory: ${workspace.name}\n`),
    );
  }

  const { blocks, traceText, reasons } = checkTrace(workspace, text, input.traceText);
  const config = readAuthoringConfig(workspace.projectRoot);
  const bodyTokens = estimateTokens(split.body);
  const problems = [
    ...reasons,
    ...draftProblems(split.body, bodyTokens, config.agent_prompt_max_tokens, hooks.problems),
  ];
  const failed = problems.length > 0;
  const trace = workspace.write(
    'trace.md',
    renderGateMarkdown(
      {
        gate: failed ? 'failed' : 'passed',
        stage: 'S3',
        ...(failed ? { reason: problems.join('; ') } : {}),
        blocks: blocks.length,
        body_tokens: bodyTokens,
      },
      traceText,
    ),
  );
  if (failed) {
    return stageResult(
      false,
      [
        `S3 draft failed: ${problems.join('; ')}.`,
        `Trace each block to an S-ID from sources.md (or under ${UNSOURCED_HEADING} give "accepted: <reason>"), fix the body, then rerun.`,
      ],
      [trace, ...artifacts],
    );
  }
  return stageResult(
    true,
    [
      `S3 draft passed: all ${blocks.length} instruction blocks are traced and the body is ${bodyTokens} tokens.`,
      `Next: paqad-ai agent test ${workspace.name}`,
    ],
    [trace, ...artifacts],
  );
}

export function changedTemplateRenders(
  workspace: AuthoringWorkspace,
  sources: AgentAuditSources | undefined,
  stage: string,
): string[] {
  const source = readAgentDraftSource(workspace)!;
  const rendered = renderTemplateDraft(source.file, sources, stage);
  const drafted = draftedRenderNames(workspace);
  const changed = rendered
    .filter((agent) => workspace.read(`${RENDERED_DIR}/${agent.name}.md`) !== agent.content)
    .map((agent) => agent.name);
  const gone = drafted.filter((name) => !rendered.some((agent) => agent.name === name));
  return [...new Set([...changed, ...gone])].sort();
}

function runTemplateDraft(
  workspace: AuthoringWorkspace,
  input: AgentDraftInput,
  rel: string,
  text: string,
  intake: AgentIntake | null,
): StageResult {
  if (templateStem(rel) !== workspace.name) {
    throw new AuthoringRefusal(
      `S3 draft refused: ${rel} is the template of the agent ${templateStem(rel)}, not ${workspace.name}.`,
      2,
    );
  }
  if (input.memoryText !== undefined) {
    throw new AuthoringRefusal(`S3 draft refused: a stage-agent template gets no MEMORY.md.`, 2);
  }
  const rendered = renderTemplateDraft(rel, input.agentSources, 'S3 draft');
  workspace.remove(DRAFT_DIR);
  const artifacts = [workspace.write(agentDraftFile(workspace), text)];
  for (const agent of rendered) {
    artifacts.push(workspace.write(`${RENDERED_DIR}/${agent.name}.md`, agent.content));
  }
  workspace.writeJson(DRAFT_SOURCE_FILE, {
    file: rel,
    hook_scripts: [],
    rendered: rendered.map((agent) => agent.name),
  });
  workspace.remove(BRIEF_TEMPLATE_FILE);
  if (intake !== null) {
    artifacts.push(
      workspace.write(BRIEF_TEMPLATE_FILE, renderBriefTemplate(workspace.name, intake)),
    );
  }
  workspace.remove(MEMORY_FILE);

  const config = readAuthoringConfig(workspace.projectRoot);
  const problems: string[] = [];
  let traceText = input.traceText;
  let blocks = 0;
  let bodyTokens = 0;
  for (const agent of rendered) {
    const split = splitSkillFrontmatter(agent.content);
    if (!split.ok) {
      problems.push(
        `${agent.name}: the rendered agent has no valid frontmatter (${split.message})`,
      );
      continue;
    }
    const traced = checkTrace(workspace, agent.content, traceText);
    traceText = traced.traceText;
    blocks += traced.blocks.length;
    const tokens = estimateTokens(split.body);
    bodyTokens = Math.max(bodyTokens, tokens);
    for (const problem of [
      ...traced.reasons,
      ...draftProblems(split.body, tokens, config.agent_prompt_max_tokens, []),
    ]) {
      problems.push(`${agent.name}: ${problem}`);
    }
  }
  const failed = problems.length > 0;
  const trace = workspace.write(
    'trace.md',
    renderGateMarkdown(
      {
        gate: failed ? 'failed' : 'passed',
        stage: 'S3',
        ...(failed ? { reason: problems.join('; ') } : {}),
        blocks,
        body_tokens: bodyTokens,
      },
      traceText,
    ),
  );
  const names = rendered.map((agent) => agent.name).join(', ');
  if (failed) {
    return stageResult(
      false,
      [
        `S3 draft failed for the template ${rel}: ${problems.join('; ')}.`,
        `Fix the bodies it renders (${names}), then rerun.`,
      ],
      [trace, ...artifacts],
    );
  }
  return stageResult(
    true,
    [
      `S3 draft passed: the template ${rel} renders ${rendered.length} agents (${names}), every one traced, the largest body ${bodyTokens} tokens.`,
      `Next: paqad-ai agent test ${workspace.name}`,
    ],
    [trace, ...artifacts],
  );
}
