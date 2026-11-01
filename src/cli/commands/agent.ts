import { resolve } from 'node:path';

import { Command } from 'commander';

import { agentOrchestratorEnabled } from '@/authoring/config.js';
import {
  AgentLintUsageError,
  lintAgentInProject,
  type AgentLintResult,
} from '@/authoring/lint/agent-lint.js';
import { NeverWriteListError } from '@/authoring/lint/never-write.js';
import { formatLintJson, lintExitCode } from '@/authoring/lint/runner.js';
import type { StageResult } from '@/authoring/stages/result.js';
import { agentStatus } from '@/authoring/stages/status.js';
import { AgentWorkspace } from '@/authoring/workspace.js';

import { runAuthoringVerb, USAGE_EXIT, withCommon, type VerbOptions } from './authoring-cli.js';

export const AGENT_OFF_LINE =
  'The Agent Orchestrator is off (agent_orchestrator_enabled=false), so the agent pipeline does not run.';

interface LintOptions {
  json?: boolean;
  projectRoot: string;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function printLint(result: AgentLintResult): void {
  for (const finding of result.findings) {
    console.log(
      `${finding.rule} ${finding.severity} ${finding.file}:${finding.line} ${finding.message}`,
    );
  }
  console.log(
    result.blocking === 0
      ? `**▸ paqad** · ${result.agent}: no blocking findings (${plural(result.warnings, 'warning')}).`
      : `**▸ paqad** · ${result.agent}: ${plural(result.blocking, 'blocking finding')}, ${plural(result.warnings, 'warning')}.`,
  );
}

function runLint(file: string, options: LintOptions): void {
  const projectRoot = resolve(options.projectRoot);
  if (!agentOrchestratorEnabled(projectRoot)) {
    console.log(AGENT_OFF_LINE);
    return;
  }
  let result: AgentLintResult;
  try {
    result = lintAgentInProject(projectRoot, resolve(file));
  } catch (error) {
    if (error instanceof AgentLintUsageError || error instanceof NeverWriteListError) {
      console.error(`agent lint: ${error.message}`);
      process.exitCode = USAGE_EXIT;
      return;
    }
    throw error;
  }
  if (options.json) process.stdout.write(formatLintJson(result));
  else printLint(result);
  process.exitCode = lintExitCode(result);
}

export function runAgentVerb(
  name: string,
  options: VerbOptions,
  action: (workspace: AgentWorkspace, projectRoot: string) => StageResult | Promise<StageResult>,
): Promise<void> {
  return runAuthoringVerb(
    options,
    (projectRoot) => new AgentWorkspace(projectRoot, name),
    (projectRoot) => agentOrchestratorEnabled(projectRoot),
    AGENT_OFF_LINE,
    action,
  );
}

export function createAgentCommand(): Command {
  const command = new Command('agent').description(
    'Prove a new or edited agent (subagent file) through its gated pipeline before it is added',
  );

  command
    .command('lint')
    .description(
      'Check an agent file against the deterministic agent rules (AG-001 to AG-022). ' +
        'Exit 0 with no blocking finding, 1 with one, 2 on a usage error.',
    )
    .argument('<file>', 'The agent Markdown file')
    .option('--json', 'Print the findings as JSON')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((file: string, options: LintOptions) => {
      runLint(file, options);
    });

  withCommon(
    command
      .command('status')
      .description('Print every stage gate of an agent in plain words, with its artifact path')
      .argument('<name>', 'The agent name'),
  ).action((name: string, options: VerbOptions) =>
    runAgentVerb(name, options, (workspace) => {
      const status = agentStatus(workspace);
      return {
        ok: true,
        lines: status.lines,
        artifacts: status.stages.map((stage) => stage.artifact),
      };
    }),
  );

  return command;
}
