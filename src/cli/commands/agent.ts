import { resolve } from 'node:path';

import { Command } from 'commander';

import { agentOrchestratorEnabled } from '@/authoring/config.js';
import { runExploreIntake } from '@/authoring/explore.js';
import { runMemoryConsolidate } from '@/authoring/memory.js';
import {
  AgentLintUsageError,
  lintAgentInProject,
  type AgentLintResult,
} from '@/authoring/lint/agent-lint.js';
import { AuditUsageError, DEFAULT_AGENT_AUDIT_REPORT, runAudit } from '@/authoring/lint/audit.js';
import { NeverWriteListError } from '@/authoring/lint/never-write.js';
import { formatLintJson, lintExitCode } from '@/authoring/lint/runner.js';
import { runAgentDraft } from '@/authoring/stages/agent-draft.js';
import { runAgentEvalPlan, runAgentEvalRecord } from '@/authoring/stages/agent-eval.js';
import { runAgentEvidence } from '@/authoring/stages/agent-evidence.js';
import { runAgentTest } from '@/authoring/stages/agent-test.js';
import { runDelegationPlan, runDelegationRecord } from '@/authoring/stages/delegation.js';
import { AGENT_INTAKE_FIELDS, runAgentIntake } from '@/authoring/stages/agent-intake.js';
import { runAgentJustify } from '@/authoring/stages/agent-justify.js';
import {
  resolveAgentLearn,
  runAgentCatalog,
  runAgentDrift,
  runAgentLearn,
  runAgentRegression,
} from '@/authoring/stages/agent-operate.js';
import { runAgentRelease } from '@/authoring/stages/agent-release.js';
import { runAgentImprove } from '@/authoring/stages/improve.js';
import { raiseIntakeGap } from '@/authoring/stages/intake.js';
import { askForOverride, recordOverride } from '@/authoring/stages/override.js';
import type { StageResult } from '@/authoring/stages/result.js';
import { agentStatus } from '@/authoring/stages/status.js';
import { AgentWorkspace, AuthoringRefusal } from '@/authoring/workspace.js';
import { STAGE_AGENT_AUDIT_SOURCES } from '@/stage-isolation/agent-audit.js';

import {
  changeKey,
  collect,
  printResult,
  readInput,
  runAuthoringVerb,
  sessionFor,
  USAGE_EXIT,
  withCommon,
  type VerbOptions,
} from './authoring-cli.js';

export const AGENT_OFF_LINE =
  'The Agent Orchestrator is off (agent_orchestrator_enabled=false), so the agent pipeline does not run.';

interface LintOptions {
  json?: boolean;
  projectRoot: string;
  all?: boolean;
  report?: string;
  groupBy?: string;
  asOf?: string;
  ownerPowersAsWarnings?: boolean;
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

function runLintAll(projectRoot: string, options: LintOptions): void {
  try {
    const { report, summary } = runAudit(projectRoot, 'agent', {
      ...options,
      agentSources: STAGE_AGENT_AUDIT_SOURCES,
    });
    console.log(summary);
    process.exitCode = lintExitCode(report);
  } catch (error) {
    if (
      error instanceof AuditUsageError ||
      error instanceof AgentLintUsageError ||
      error instanceof NeverWriteListError
    ) {
      console.error(`agent lint: ${error.message}`);
      process.exitCode = USAGE_EXIT;
      return;
    }
    throw error;
  }
}

function runLint(file: string | undefined, options: LintOptions): void {
  const projectRoot = resolve(options.projectRoot);
  if (!agentOrchestratorEnabled(projectRoot)) {
    console.log(AGENT_OFF_LINE);
    return;
  }
  if (options.all === true) {
    if (file !== undefined) {
      console.error('agent lint: give a file or --all, not both.');
      process.exitCode = USAGE_EXIT;
      return;
    }
    runLintAll(projectRoot, options);
    return;
  }
  if (options.ownerPowersAsWarnings === true) {
    console.error('agent lint: --owner-powers-as-warnings needs --all.');
    process.exitCode = USAGE_EXIT;
    return;
  }
  if (file === undefined) {
    console.error('agent lint: name an agent file, or pass --all.');
    process.exitCode = USAGE_EXIT;
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
      .option('--recommend <label>', 'The recommended answer (with --gap)')
      .option(
        '--preset <name>',
        'Fill the intake from a preset: explore (only for the agent Explore)',
      ),
  ).action(
    (
      name: string,
      file: string | undefined,
      options: VerbOptions & {
        gap?: string;
        question?: string;
        option?: string[];
        recommend?: string;
        preset?: string;
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
        if (options.preset !== undefined) return runExploreIntake(workspace, options.preset);
        if (file === undefined) throw new AuthoringRefusal('name the intake.yaml file.', 2);
        return runAgentIntake(workspace, readInput(file, 'the intake file'));
      }),
  );

  withCommon(
    command
      .command('evidence')
      .description('S2: record the sources and check overlap with installed agents and experts')
      .argument('<name>', 'The agent name')
      .argument('<sources-file>', 'The sources.md table')
      .option('--decision <id>', 'The answered authoring.overlap decision')
      .option('--owns <phrase>', 'For a new expert: the question it alone answers')
      .option('--lens <file>', 'For a new expert: its lens file'),
  ).action(
    (
      name: string,
      file: string,
      options: VerbOptions & { decision?: string; owns?: string; lens?: string },
    ) =>
      runAgentVerb(name, options, (workspace, projectRoot) =>
        runAgentEvidence(workspace, {
          sourcesText: readInput(file, 'the sources file'),
          decision: options.decision,
          change: changeKey(projectRoot, options.session),
          owns: options.owns,
          lensText: options.lens ? readInput(options.lens, 'the lens file') : undefined,
        }),
      ),
  );

  withCommon(
    command
      .command('draft')
      .description('S3: take the drafted agent file, its hook scripts and the trace')
      .argument('<name>', 'The agent name')
      .option('--file <agent.md>', 'The drafted agent file')
      .option('--trace <file>', 'The trace.md mapping blocks to S-IDs')
      .option('--memory <file>', 'The seeded MEMORY.md (memory candidates only)')
      .option('--refuse <reason>', 'Refuse the draft'),
  ).action(
    (
      name: string,
      options: VerbOptions & { file?: string; trace?: string; memory?: string; refuse?: string },
    ) =>
      runAgentVerb(name, options, (workspace) => {
        if (options.refuse === undefined && (!options.file || !options.trace)) {
          throw new AuthoringRefusal('draft needs --file <agent.md> and --trace <trace.md>.', 2);
        }
        return runAgentDraft(workspace, {
          file: options.file,
          traceText: options.trace ? readInput(options.trace, 'the trace file') : '',
          memoryText: options.memory ? readInput(options.memory, 'the memory file') : undefined,
          refuse: options.refuse,
        });
      }),
  );

  withCommon(
    command
      .command('test')
      .description(
        'S4: lint the drafted agent, ask about risky powers and hook scripts, and run the hook ' +
          'script tests under the project test command',
      )
      .argument('<name>', 'The agent name'),
  ).action((name: string, options: VerbOptions) =>
    runAgentVerb(name, options, (workspace, projectRoot) =>
      runAgentTest(workspace, { change: changeKey(projectRoot, options.session) }),
    ),
  );
}

function addEvalVerbs(command: Command): void {
  const evalCommand = command.command('eval').description('S5: plan and record the agent evals');
  withCommon(
    evalCommand
      .command('plan')
      .description(
        'Write the next iteration of trials and print the run commands; never calls a model',
      )
      .argument('<name>', 'The agent name')
      .option(
        '--lever <lever>',
        'The revision lever this iteration changed: brief | tools | stopping | report | prose',
      )
      .option('--batch-available', 'The client offers a batch API for this sweep'),
  ).action((name: string, options: VerbOptions & { lever?: string; batchAvailable?: boolean }) =>
    runAgentVerb(name, options, (workspace, projectRoot) =>
      runAgentEvalPlan(workspace, {
        lever: options.lever,
        batchAvailable: options.batchAvailable === true,
        change: changeKey(projectRoot, options.session),
      }),
    ),
  );
  withCommon(
    evalCommand
      .command('record')
      .description(
        'Validate the trials of the latest iteration, compute pass^k and judge the S5 gate',
      )
      .argument('<name>', 'The agent name'),
  ).action((name: string, options: VerbOptions) =>
    runAgentVerb(name, options, (workspace, projectRoot) =>
      runAgentEvalRecord(workspace, { change: changeKey(projectRoot, options.session) }),
    ),
  );
}

function addDelegationVerbs(command: Command): void {
  const delegation = command
    .command('delegation')
    .description('S6: plan and record the delegation test (skipped for dispatched agents)');
  withCommon(
    delegation
      .command('plan')
      .description('Split the delegation requests 60/40 with seed 42 into delegation-eval.json')
      .argument('<name>', 'The agent name')
      .argument('[requests-file]', 'The requests as [{request, should_delegate}]')
      .option('--batch-offered', 'The client offers a batch API for this sweep'),
  ).action(
    (name: string, file: string | undefined, options: VerbOptions & { batchOffered?: boolean }) =>
      runAgentVerb(name, options, (workspace) =>
        runDelegationPlan(
          workspace,
          file === undefined ? null : readInput(file, 'the requests file'),
          {
            batchOffered: options.batchOffered === true,
          },
        ),
      ),
  );
  withCommon(
    delegation
      .command('record')
      .description('Score every description iteration and the fresh host requests, and judge S6')
      .argument('<name>', 'The agent name')
      .argument('[results-file]', 'The delegation results'),
  ).action((name: string, file: string | undefined, options: VerbOptions) =>
    runAgentVerb(name, options, (workspace, projectRoot) =>
      runDelegationRecord(
        workspace,
        file === undefined ? null : readInput(file, 'the results file'),
        {
          change: changeKey(projectRoot, options.session),
        },
      ),
    ),
  );
}

function addReleaseVerbs(command: Command): void {
  withCommon(
    command
      .command('release')
      .description(
        'S7: refuse unless every gate passed or holds an override, then write the agent in each ' +
          'enabled host format, the SDK form, evidence.json and CHANGELOG.md, and record ' +
          'agent-<name>.json in the bundle',
      )
      .argument('<name>', 'The agent name')
      .option('--version <x.y.z>', 'The version to release (default: 1.0.0, then the next minor)'),
  ).action((name: string, options: VerbOptions & { version?: string }) =>
    runAgentVerb(name, options, (workspace, projectRoot) =>
      runAgentRelease(workspace, {
        version: options.version,
        sessionId: sessionFor(projectRoot, options.session),
      }),
    ),
  );

  withCommon(
    command
      .command('override')
      .description(
        'Ask the owner to skip one gate with --reason, or record the skip from the resolved ' +
          'authoring.override decision with --decision. A secret (AG-012) or a risky power can never be skipped.',
      )
      .argument('<name>', 'The agent name')
      .argument('[stage]', 'The gate to skip, S0 to S6')
      .option('--gate <gate>', 'The gate to skip (same as the stage argument)')
      .option('--reason <text>', 'Ask the owner for the override, saying why')
      .option('--decision <id>', 'The resolved authoring.override decision'),
  ).action(
    (
      name: string,
      stage: string | undefined,
      options: VerbOptions & { gate?: string; reason?: string; decision?: string },
    ) =>
      runAgentVerb(name, options, (workspace, projectRoot) => {
        const gate = stage ?? options.gate;
        if (gate === undefined) {
          throw new AuthoringRefusal('override needs the stage, as in S5.', USAGE_EXIT);
        }
        if (options.decision !== undefined) {
          return recordOverride(workspace, { gate, decision: options.decision });
        }
        if (options.reason === undefined) {
          throw new AuthoringRefusal(
            'override needs --reason <text> to ask, or --decision <id> to record the answer.',
            USAGE_EXIT,
          );
        }
        return askForOverride(workspace, {
          gate,
          why: options.reason,
          change: changeKey(projectRoot, options.session),
        });
      }),
  );

  withCommon(
    command
      .command('improve')
      .description(
        'Start improve mode on an installed agent: snapshot it as the old_agent baseline, S0 skipped',
      )
      .argument('<name>', 'The agent name')
      .option('--source <file>', 'The installed agent file, when it is not found by name'),
  ).action((name: string, options: VerbOptions & { source?: string }) =>
    runAgentVerb(name, options, (workspace) =>
      runAgentImprove(workspace, { source: options.source }),
    ),
  );
}

function addOperateVerbs(command: Command): void {
  withCommon(
    command
      .command('learn')
      .description(
        'S8: propose a correction to an installed agent through authoring.improvement, or apply it with --decision',
      )
      .argument('<name>', 'The agent name')
      .argument('[correction]', 'The correction, in one sentence')
      .option('--scope <where>', 'Where the correction was seen')
      .option('--source <S-ID>', 'The trace S-ID it comes from')
      .option('--decision <id>', 'The answered authoring.improvement decision'),
  ).action(
    (
      name: string,
      correction: string | undefined,
      options: VerbOptions & { scope?: string; source?: string; decision?: string },
    ) =>
      runAgentVerb(name, options, (workspace, projectRoot) => {
        if (options.decision !== undefined) {
          return resolveAgentLearn(workspace, { decision: options.decision });
        }
        return runAgentLearn(workspace, {
          correction: correction ?? '',
          scope: options.scope ?? '',
          source: options.source ?? '',
          change: changeKey(projectRoot, options.session),
        });
      }),
  );

  withCommon(
    command
      .command('drift')
      .description(
        'S8: list facts older than authoring_fact_max_age_days and a model change since the agent was proven',
      )
      .argument('<name>', 'The agent name'),
  ).action((name: string, options: VerbOptions) =>
    runAgentVerb(name, options, (workspace) => runAgentDrift(workspace)),
  );

  withCommon(
    command
      .command('regression')
      .description(
        'S8: compare the latest eval rerun with the one before it (tokens, cost, p95 latency, any pass^3 drop)',
      )
      .argument('<name>', 'The agent name'),
  ).action((name: string, options: VerbOptions) =>
    runAgentVerb(name, options, (workspace) => runAgentRegression(workspace)),
  );

  withCommon(
    command
      .command('memory-consolidate')
      .description(
        'S8: keep MEMORY.md within agent_memory_max_lines by consolidating it, never by appending',
      )
      .argument('<name>', 'The agent name')
      .option('--file <MEMORY.md>', 'The consolidated MEMORY.md')
      .option('--alters-behaviour', 'The new memory changes how the agent behaves'),
  ).action((name: string, options: VerbOptions & { file?: string; altersBehaviour?: boolean }) =>
    runAgentVerb(name, options, (workspace, projectRoot) =>
      runMemoryConsolidate(workspace, {
        text: options.file === undefined ? undefined : readInput(options.file, 'the MEMORY.md'),
        altersBehaviour: options.altersBehaviour === true,
        change: changeKey(projectRoot, options.session),
      }),
    ),
  );

  withCommon(
    command
      .command('catalog')
      .description(
        'S8: the installed agents with their listing cost, last delegation, dark agents and expired power approvals',
      )
      .option('--propose-retirement', 'Raise authoring.retirement for every dark agent'),
  ).action((options: VerbOptions & { proposeRetirement?: boolean }) => {
    const projectRoot = resolve(options.projectRoot);
    if (!agentOrchestratorEnabled(projectRoot)) {
      console.log(AGENT_OFF_LINE);
      return;
    }
    printResult(
      runAgentCatalog(projectRoot, {
        proposeRetirement: options.proposeRetirement === true,
        change: changeKey(projectRoot, options.session),
      }),
      options.json,
    );
  });
}

export function createAgentCommand(): Command {
  const command = new Command('agent').description(
    'Prove a new or edited agent (subagent file) through its gated pipeline before it is added',
  );

  command
    .command('lint')
    .description(
      'Check an agent file, or every agent in the project with --all, against the ' +
        'deterministic agent rules (AG-001 to AG-022). Persona files are listed apart and never block. ' +
        'Exit 0 with no blocking finding, 1 with one, 2 on a usage error.',
    )
    .argument('[file]', 'The agent Markdown file')
    .option('--json', 'Print the findings as JSON')
    .option('--all', 'Lint every agent file in the project and write one JSON report')
    .option(
      '--report <file>',
      `With --all: the report path (default ${DEFAULT_AGENT_AUDIT_REPORT})`,
    )
    .option('--group-by <how>', 'With --all: group the findings by rule or folder', 'rule')
    .option(
      '--as-of <date>',
      'With --all: count dispatches in the 30 days up to this date (YYYY-MM-DD)',
    )
    .option(
      '--owner-powers-as-warnings',
      'With --all: report AG-015, AG-018 and AG-022 as warnings; the owner permission packets and the authoring completion gate still enforce them',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((file: string | undefined, options: LintOptions) => {
      runLint(file, options);
    });

  addIntakeVerbs(command);
  addEvalVerbs(command);
  addDelegationVerbs(command);
  addReleaseVerbs(command);
  addOperateVerbs(command);

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
