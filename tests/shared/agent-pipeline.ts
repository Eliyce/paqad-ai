import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import YAML from 'yaml';

import { AgentWorkspace, renderGateMarkdown } from '@/authoring/workspace.js';

export const AGENT_NAME = 'migration-reviewer';

export const AGENT_INTAKE = {
  job: 'Review a database migration and say whether it is safe to run.',
  delegation_brief: 'The migration path, the schema file and the target database.',
  report: { template: 'Verdict, Risks, Status', max_tokens: 1500 },
  tools: ['Read', 'Grep', 'Glob'],
  model_tier: 'fast',
  effort: 'low',
  stopping: { max_turns: 20, done_when: 'the migration is judged', when_blocked: 'return BLOCKED' },
  memory: 'none',
  isolation: 'none',
  parallel: false,
  cache_ttl: '5m',
  class: 'reviewer',
  invocation: 'auto',
  pattern: 'single-call',
};

export const AGENT_SOURCES =
  '| S-ID | Fact | Origin | Date | Verified |\n| --- | --- | --- | --- | --- |\n' +
  '| S-1 | migrations live in db/migrations | repository | 2026-11-01 | yes |\n';

export const AGENT_BODY = `## Objective

Review the migration the caller names and say whether it is safe to run.

## Procedure

1. Read the migration file.
2. Check it against the schema.

When several tool calls don't depend on each other, make them in the same turn.

## Report

Verdict, Risks, at most 1500 tokens.

Status: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED

When blocked, report:

Status: BLOCKED
Decision needed: <question>
Options: <2 to 4 options>

## Stop when

The migration has been read and judged.

## Do not

- Do not edit any file.

## Example

Input: <migration path>. Output: Status: DONE.
`;

export const AGENT_DESCRIPTION =
  'Use this agent when a change adds a database migration. For example "review this migration" or "is this migration safe to run".';

export function agentText(
  front: Record<string, string | undefined> = {},
  body = AGENT_BODY,
): string {
  const fields: Record<string, string | undefined> = {
    name: AGENT_NAME,
    description: `'${AGENT_DESCRIPTION}'`,
    tools: 'Read, Grep, Glob',
    model: 'haiku',
    effort: 'low',
    maxTurns: '20',
    ...front,
  };
  const lines = Object.entries(fields)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

export const AGENT_TRACE =
  '| Block | Lines | S-IDs |\n| --- | --- | --- |\n' +
  ['Objective', 'Procedure', 'Report', 'Stop when', 'Do not', 'Example']
    .map((heading) => `| ${heading} | 1 | S-1 |`)
    .join('\n') +
  '\n';

const roots: string[] = [];

export function agentProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-agent-pipeline-'));
  roots.push(root);
  return root;
}

export function cleanAgentProjects(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

export function put(root: string, rel: string, text: string): string {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text, 'utf8');
  return rel;
}

export function passGate(workspace: AgentWorkspace, artifact: string, stage: string): void {
  if (artifact.endsWith('.json')) workspace.writeJson(artifact, { gate: 'passed', stage });
  else workspace.write(artifact, renderGateMarkdown({ gate: 'passed', stage }, `# ${stage}\n`));
}

export function agentThrough(
  stage: 'S2' | 'S3' | 'S4',
  intake: Record<string, unknown> = AGENT_INTAKE,
  root: string = agentProject(),
): AgentWorkspace {
  const workspace = new AgentWorkspace(root, AGENT_NAME);
  passGate(workspace, 'justification.md', 'S0');
  workspace.write('intake.yaml', YAML.stringify(intake));
  if (stage === 'S2') return workspace;
  workspace.write('sources.md', AGENT_SOURCES);
  passGate(workspace, 'overlap.md', 'S2');
  return workspace;
}

export interface TrialShape {
  passed?: boolean;
  timing?: Record<string, unknown>;
  grading?: Record<string, unknown>;
}

export function agentForEval(
  intake: Record<string, unknown> = AGENT_INTAKE,
  adapter = 'codex-cli',
): AgentWorkspace {
  const workspace = agentThrough('S4', intake);
  put(workspace.projectRoot, '.paqad/onboarding-manifest.json', JSON.stringify({ adapter }));
  workspace.write(`draft/${AGENT_NAME}.md`, agentText());
  workspace.writeJson('draft-source.json', {
    file: `.claude/agents/${AGENT_NAME}.md`,
    hook_scripts: [],
  });
  passGate(workspace, 'trace.md', 'S3');
  workspace.writeJson('script-tests.json', { gate: 'passed', stage: 'S4' });
  return workspace;
}

export function addCase(
  workspace: AgentWorkspace,
  name: string,
  meta: Record<string, unknown> = {},
): void {
  workspace.write(
    `evals/${name}/case.yaml`,
    YAML.stringify({
      repo_state: { git_ref: 'HEAD' },
      inputs: ['db/migrations/001.sql'],
      expected: 'the verdict names the unsafe column drop',
      ...meta,
    }),
  );
  workspace.write(`evals/${name}/prompt.md`, `Review ${name}.\n`);
}

export function writeTrials(
  workspace: AgentWorkspace,
  shape: (trial: { case: string; arm: string; tier: string; trial: number }) => TrialShape,
): void {
  const iterations = workspace.readJson<
    Array<{ workdir: string; case: string; arm: string; tier: string; trial: number }>
  >(`iteration-${latest(workspace)}/trials.json`)!;
  for (const trial of iterations) {
    const rel = trial.workdir.slice(workspace.rel.length + 1);
    const chosen = shape(trial);
    const passed = chosen.passed ?? true;
    workspace.write(`${rel}/outputs/report.md`, 'Status: DONE\n');
    workspace.writeJson(`${rel}/grading.json`, {
      assertions: [
        { text: 'names the unsafe change', passed, evidence: 'outputs/report.md line 1' },
      ],
      ...chosen.grading,
    });
    workspace.writeJson(`${rel}/timing.json`, {
      tokens: 1000,
      duration_ms: 2000,
      tool_calls: 4,
      turns: 3,
      max_turns_hit: false,
      cost_usd: 0.01,
      tool_use_blocks_per_message: 1.5,
      returned_to_main_tokens: 300,
      ...chosen.timing,
    });
  }
}

function latest(workspace: AgentWorkspace): number {
  let found = 0;
  for (let index = 1; index < 10; index += 1) {
    if (workspace.exists(`iteration-${index}`)) found = index;
  }
  return found;
}

export interface Loose {
  [key: string]: Loose;
  [index: number]: Loose;
  length: number;
  map<T>(pick: (entry: Loose) => T): T[];
  filter(pick: (entry: Loose) => boolean): Loose[];
}

export function readLoose(workspace: AgentWorkspace, rel: string): Loose {
  return workspace.readJson<Loose>(rel)!;
}
