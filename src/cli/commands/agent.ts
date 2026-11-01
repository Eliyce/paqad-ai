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
import { AGENT_INTAKE_FIELDS, runAgentIntake } from '@/authoring/stages/agent-intake.js';
import { runAgentJustify } from '@/authoring/stages/agent-justify.js';
import { raiseIntakeGap } from '@/authoring/stages/intake.js';
import type { StageResult } from '@/authoring/stages/result.js';
import { agentStatus } from '@/authoring/stages/status.js';
import { AgentWorkspace, AuthoringRefusal } from '@/authoring/workspace.js';

import {
  changeKey,
  collect,
  readInput,
  runAuthoringVerb,
  USAGE_EXIT,
  withCommon,
  type VerbOptions,
} from './authoring-cli.js';

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

function addIntakeVerbs(command: Command): void {
  withCommon(
    command
      .command('justify')
      .description(
        'S0: decide from three main-conversation baseline runs whether an agent is needed',
      )
      .argument('<name>', 'The agent name')
      .option('--task-file <file>', 'The task the agent would do')
      .option(
        '--reason <key>',
        'verbose-output | restriction | summarisable | cheaper-model | parallel | recurring-role',
      )
      .option(
        '--refuse <case>',
        'quick-change | back-and-forth | shared-context | latency | one-off | skill-or-hook',
      ),
  ).action(
    (
      name: string,
      options: VerbOptions & { taskFile?: string; reason?: string; refuse?: string },
    ) =>
      runAgentVerb(name, options, (workspace) =>
        runAgentJustify(workspace, {
          reason: options.reason,
          refuse: options.refuse,
          taskText: options.taskFile ? readInput(options.taskFile, 'the task file') : undefined,
        }),
      ),
  );

  withCommon(
    command
      .command('intake')
      .description('S1: check every agent intake field, or raise an intake gap for the owner')
      .argument('<name>', 'The agent name')
      .argument('[intake-file]', 'The filled intake.yaml')
      .option('--gap <field>', 'Raise authoring.intake_gap for a business field nothing answers')
      .option('--question <text>', 'The question for the owner (with --gap)')
      .option('--option <label>', 'An answer to offer (with --gap, 2 to 4 times)', collect)
      .option('--recommend <label>', 'The recommended answer (with --gap)'),
  ).action(
    (
      name: string,
      file: string | undefined,
      options: VerbOptions & {
        gap?: string;
        question?: string;
        option?: string[];
        recommend?: string;
      },
    ) =>
      runAgentVerb(name, options, (workspace, projectRoot) => {
        if (options.gap !== undefined) {
          if (!options.question || !options.recommend) {
            throw new AuthoringRefusal('--gap needs --question, --option and --recommend.', 2);
          }
          return raiseIntakeGap(
            workspace,
            {
              field: options.gap,
              question: options.question,
              options: options.option ?? [],
              recommend: options.recommend,
              change: changeKey(projectRoot, options.session),
            },
            AGENT_INTAKE_FIELDS,
          );
        }
        if (file === undefined) throw new AuthoringRefusal('name the intake.yaml file.', 2);
        return runAgentIntake(workspace, readInput(file, 'the intake file'));
      }),
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

  addIntakeVerbs(command);

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
