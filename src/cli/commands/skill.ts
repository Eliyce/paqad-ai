import { relative, resolve } from 'node:path';

import { Command } from 'commander';

import { readAuthoringConfig } from '@/authoring/config.js';
import { AuditUsageError, DEFAULT_SKILL_AUDIT_REPORT, runAudit } from '@/authoring/lint/audit.js';
import { AUDIT_DOC, writeAuditDoc, type AuditSection } from '@/authoring/lint/audit-report.js';
import { NeverWriteListError } from '@/authoring/lint/never-write.js';
import {
  formatSkillLintJson,
  lintSkillFolder,
  skillLintExitCode,
  SkillLintUsageError,
  type SkillLintResult,
} from '@/authoring/lint/skill-lint.js';
import { lintExitCode } from '@/authoring/lint/runner.js';
import { enabledAdapters } from '@/authoring/paths.js';
import { draftLintsAsRuntime, runDraft } from '@/authoring/stages/draft.js';
import { runImprove } from '@/authoring/stages/improve.js';
import { raiseIntakeGap, runIntake } from '@/authoring/stages/intake.js';
import { runJustify } from '@/authoring/stages/justify.js';
import { type StageResult } from '@/authoring/stages/result.js';
import { runEvidence } from '@/authoring/stages/sources.js';
import { skillStatus } from '@/authoring/stages/status.js';
import { runSkillTest } from '@/authoring/stages/test.js';
import { runEvalPlan, runEvalRecord } from '@/authoring/stages/eval.js';
import { runTriggerPlan, runTriggerRecord } from '@/authoring/stages/trigger.js';
import { askForOverride, recordOverride } from '@/authoring/stages/override.js';
import { runRelease } from '@/authoring/stages/release.js';
import { resolveLearn, runCatalog, runDrift, runLearn } from '@/authoring/stages/operate.js';
import { AuthoringRefusal, SkillWorkspace, WORKSPACE_ROOT } from '@/authoring/workspace.js';
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

interface LintOptions {
  json?: boolean;
  projectRoot: string;
  all?: boolean;
  report?: string;
  groupBy?: string;
  asOf?: string;
}

function printLint(result: SkillLintResult): void {
  for (const finding of result.findings) {
    console.log(
      `${finding.rule} ${finding.severity} ${finding.file}:${finding.line} ${finding.message}`,
    );
  }
  console.log(
    result.blocking === 0
      ? `**▸ paqad** · ${result.skill}: no blocking findings (${result.warnings} warning${result.warnings === 1 ? '' : 's'}).`
      : `**▸ paqad** · ${result.skill}: ${result.blocking} blocking finding${result.blocking === 1 ? '' : 's'}, ${result.warnings} warning${result.warnings === 1 ? '' : 's'}.`,
  );
}

function workspaceDraftLintsAsRuntime(projectRoot: string, folder: string): true | undefined {
  const rel = relative(projectRoot, folder).replaceAll('\\', '/');
  const prefix = `${WORKSPACE_ROOT}/`;
  if (!rel.startsWith(prefix)) return undefined;
  const [name, draft, inner, ...rest] = rel.slice(prefix.length).split('/');
  if (name === undefined || draft !== 'draft' || inner !== name || rest.length > 0)
    return undefined;
  try {
    return draftLintsAsRuntime(new SkillWorkspace(projectRoot, name));
  } catch {
    return undefined;
  }
}

function runLintAll(options: LintOptions): void {
  const projectRoot = resolve(options.projectRoot);
  try {
    const { report, summary } = runAudit(projectRoot, 'skill', options);
    console.log(summary);
    process.exitCode = lintExitCode(report);
  } catch (error) {
    if (
      error instanceof AuditUsageError ||
      error instanceof SkillLintUsageError ||
      error instanceof NeverWriteListError
    ) {
      console.error(`skill lint: ${error.message}`);
      process.exitCode = USAGE_EXIT;
      return;
    }
    throw error;
  }
}

function runLint(folder: string | undefined, options: LintOptions): void {
  if (options.all === true) {
    if (folder !== undefined) {
      console.error('skill lint: give a folder or --all, not both.');
      process.exitCode = USAGE_EXIT;
      return;
    }
    runLintAll(options);
    return;
  }
  if (folder === undefined) {
    console.error('skill lint: name a skill folder, or pass --all.');
    process.exitCode = USAGE_EXIT;
    return;
  }
  const projectRoot = resolve(options.projectRoot);
  let result: SkillLintResult;
  try {
    result = lintSkillFolder(resolve(folder), {
      projectRoot,
      claudeCode: enabledAdapters(projectRoot).includes('claude-code'),
      bodyMaxTokens: readAuthoringConfig(projectRoot).skill_body_max_tokens,
      paqadRuntime: workspaceDraftLintsAsRuntime(projectRoot, resolve(folder)),
    });
  } catch (error) {
    if (error instanceof SkillLintUsageError || error instanceof NeverWriteListError) {
      console.error(`skill lint: ${error.message}`);
      process.exitCode = USAGE_EXIT;
      return;
    }
    throw error;
  }
  if (options.json) {
    process.stdout.write(formatSkillLintJson(result));
  } else {
    printLint(result);
  }
  process.exitCode = skillLintExitCode(result);
}

const OFF_LINE =
  'The Skill Orchestrator is off (skill_orchestrator_enabled=false), so the skill pipeline does not run.';

function runVerb(
  name: string,
  options: VerbOptions,
  action: (workspace: SkillWorkspace, projectRoot: string) => StageResult | Promise<StageResult>,
): Promise<void> {
  return runAuthoringVerb(
    options,
    (projectRoot) => new SkillWorkspace(projectRoot, name),
    (projectRoot) => readAuthoringConfig(projectRoot).skill_orchestrator_enabled,
    OFF_LINE,
    action,
  );
}

function addPipelineVerbs(command: Command): void {
  withCommon(
    command
      .command('justify')
      .description('S0: decide from three no-skill baseline runs whether a skill is needed')
      .argument('<name>', 'The skill name')
      .option('--exclusion <kind>', 'one-off | documented | convention | enforceable')
      .option('--documented-in <path>', 'Where it is already documented (with documented)')
      .option('--enforce-with <hook-or-script>', 'What will enforce it (with enforceable)'),
  ).action(
    (
      name: string,
      options: VerbOptions & { exclusion?: string; documentedIn?: string; enforceWith?: string },
    ) =>
      runVerb(name, options, (workspace) =>
        runJustify(workspace, {
          change: changeKey(workspace.projectRoot, options.session),
          exclusion: options.exclusion,
          documentedIn: options.documentedIn,
          enforceWith: options.enforceWith,
        }),
      ),
  );

  withCommon(
    command
      .command('intake')
      .description('S1: check the seven intake fields, or raise an intake gap for the owner')
      .argument('<name>', 'The skill name')
      .argument('[intake-file]', 'The filled intake.yaml')
      .option('--gap <field>', 'Raise authoring.intake_gap for a field nothing else answers')
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
      runVerb(name, options, (workspace, projectRoot) => {
        if (options.gap !== undefined) {
          if (!options.question || !options.recommend) {
            throw new AuthoringRefusal('--gap needs --question, --option and --recommend.', 2);
          }
          return raiseIntakeGap(workspace, {
            field: options.gap,
            question: options.question,
            options: options.option ?? [],
            recommend: options.recommend,
            change: changeKey(projectRoot, options.session),
          });
        }
        if (file === undefined) throw new AuthoringRefusal('name the intake.yaml file.', 2);
        return runIntake(workspace, readInput(file, 'the intake file'));
      }),
  );

  withCommon(
    command
      .command('evidence')
      .description('S2: record the sources and run the overlap and catalog budget checks')
      .argument('<name>', 'The skill name')
      .argument('<sources-file>', 'The sources.md table')
      .option('--sources-kind <kind>', 'no-repo for a skill with no repository artifacts')
      .option('--decision <id>', 'The answered authoring.overlap decision'),
  ).action(
    (
      name: string,
      file: string,
      options: VerbOptions & { sourcesKind?: string; decision?: string },
    ) =>
      runVerb(name, options, (workspace, projectRoot) =>
        runEvidence(workspace, {
          sourcesText: readInput(file, 'the sources file'),
          sourcesKind: options.sourcesKind,
          decision: options.decision,
          change: changeKey(projectRoot, options.session),
        }),
      ),
  );

  withCommon(
    command
      .command('draft')
      .description('S3: take the drafted skill folder and check every instruction block is traced')
      .argument('<name>', 'The skill name')
      .option('--dir <folder>', 'The drafted skill folder')
      .option('--trace <file>', 'The trace.md mapping blocks to S-IDs')
      .option('--refuse <reason>', 'Refuse the draft (purpose mismatch, exfiltration, bypass)'),
  ).action(
    (name: string, options: VerbOptions & { dir?: string; trace?: string; refuse?: string }) =>
      runVerb(name, options, (workspace) => {
        if (options.refuse === undefined && (!options.dir || !options.trace)) {
          throw new AuthoringRefusal('draft needs --dir <folder> and --trace <trace.md>.', 2);
        }
        return runDraft(workspace, {
          dir: resolve(options.dir ?? '.'),
          traceText: options.trace ? readInput(options.trace, 'the trace file') : '',
          refuse: options.refuse,
        });
      }),
  );

  withCommon(
    command
      .command('test')
      .description(
        'S4: lint the draft, ask about risky scripts, check the references and run the skill tests ' +
          'under the project test command',
      )
      .argument('<name>', 'The skill name'),
  ).action((name: string, options: VerbOptions) =>
    runVerb(name, options, (workspace, projectRoot) =>
      runSkillTest(workspace, { change: changeKey(projectRoot, options.session) }),
    ),
  );

  withCommon(
    command
      .command('status')
      .description('Print every stage gate of a skill in plain words, with its artifact path')
      .argument('<name>', 'The skill name'),
  ).action((name: string, options: VerbOptions) =>
    runVerb(name, options, (workspace) => {
      const status = skillStatus(workspace);
      return {
        ok: true,
        lines: status.lines,
        artifacts: status.stages.map((stage) => stage.artifact),
      };
    }),
  );

  withCommon(
    command
      .command('improve')
      .description(
        'Start improve mode on an installed skill: snapshot it first, then reuse its intake',
      )
      .argument('<name>', 'The skill name')
      .option('--source <folder>', 'The installed skill folder, when it is not found by name'),
  ).action((name: string, options: VerbOptions & { source?: string }) =>
    runVerb(name, options, (workspace) => runImprove(workspace, { source: options.source })),
  );
}

function addEvalVerbs(command: Command): void {
  const evalCommand = command.command('eval').description('S5: plan and record the skill evals');
  withCommon(
    evalCommand
      .command('plan')
      .description('Write the next iteration and print the exact run commands; never calls a model')
      .argument('<name>', 'The skill name'),
  ).action((name: string, options: VerbOptions) =>
    runVerb(name, options, (workspace, projectRoot) =>
      runEvalPlan(workspace, { change: changeKey(projectRoot, options.session) }),
    ),
  );
  withCommon(
    evalCommand
      .command('record')
      .description(
        'Validate the runs of the latest iteration, aggregate them and judge the S5 gate',
      )
      .argument('<name>', 'The skill name')
      .option('--feedback-empty', 'The reviewer had no feedback, so the loop stops'),
  ).action((name: string, options: VerbOptions & { feedbackEmpty?: boolean }) =>
    runVerb(name, options, (workspace) =>
      runEvalRecord(workspace, { feedbackEmpty: options.feedbackEmpty === true }),
    ),
  );

  const trigger = command.command('trigger').description('S6: plan and record the trigger test');
  withCommon(
    trigger
      .command('plan')
      .description('Split the trigger queries 60/40 with seed 42 into trigger-eval.json')
      .argument('<name>', 'The skill name')
      .argument('<queries-file>', 'JSON array of {query, should_trigger}'),
  ).action((name: string, file: string, options: VerbOptions) =>
    runVerb(name, options, (workspace) =>
      runTriggerPlan(workspace, readInput(file, 'the queries file')),
    ),
  );
  withCommon(
    trigger
      .command('record')
      .description('Score every description iteration and keep the best validation score')
      .argument('<name>', 'The skill name')
      .argument('<results-file>', 'The trigger sweep results'),
  ).action((name: string, file: string, options: VerbOptions) =>
    runVerb(name, options, (workspace) =>
      runTriggerRecord(workspace, readInput(file, 'the results file')),
    ),
  );
}

function addReleaseVerbs(command: Command): void {
  withCommon(
    command
      .command('release')
      .description(
        'S7: refuse unless every gate passed or holds an override, then copy the skill into the host ' +
          'skills folder, write evidence.json and CHANGELOG.md, and record skill-<name>.json in the bundle',
      )
      .argument('<name>', 'The skill name')
      .option('--version <x.y.z>', 'The version to release (default: 1.0.0, then the next minor)')
      .option('--portable', 'Also write a portable copy for claude.ai or the Skills API'),
  ).action((name: string, options: VerbOptions & { version?: string; portable?: boolean }) =>
    runVerb(name, options, (workspace, projectRoot) =>
      runRelease(workspace, {
        version: options.version,
        portable: options.portable === true,
        sessionId: sessionFor(projectRoot, options.session),
      }),
    ),
  );

  withCommon(
    command
      .command('override')
      .description(
        'Record an owner-approved skip of one gate from a resolved authoring.override decision, ' +
          'or ask for one with --ask. A secret (SK-011) can never be skipped.',
      )
      .argument('<name>', 'The skill name')
      .requiredOption('--gate <gate>', 'The gate to skip, S0 to S6')
      .option('--decision <id>', 'The resolved authoring.override decision')
      .option('--ask <why>', 'Ask the owner for the override, saying why'),
  ).action(
    (name: string, options: VerbOptions & { gate: string; decision?: string; ask?: string }) =>
      runVerb(name, options, (workspace, projectRoot) => {
        if (options.ask !== undefined) {
          return askForOverride(workspace, {
            gate: options.gate,
            why: options.ask,
            change: changeKey(projectRoot, options.session),
          });
        }
        if (options.decision === undefined) {
          throw new AuthoringRefusal(
            'override needs --decision <id>, or --ask <why> to ask for one.',
            2,
          );
        }
        return recordOverride(workspace, { gate: options.gate, decision: options.decision });
      }),
  );
}

function addOperateVerbs(command: Command): void {
  withCommon(
    command
      .command('learn')
      .description(
        'S8: propose a correction to an installed skill through authoring.improvement, or apply it with --decision',
      )
      .argument('<name>', 'The skill name')
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
      runVerb(name, options, (workspace, projectRoot) => {
        if (options.decision !== undefined) {
          return resolveLearn(workspace, { decision: options.decision });
        }
        return runLearn(workspace, {
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
      .description('S8: list externally verified facts older than authoring_fact_max_age_days')
      .argument('<name>', 'The skill name'),
  ).action((name: string, options: VerbOptions) =>
    runVerb(name, options, (workspace) => runDrift(workspace)),
  );

  withCommon(
    command
      .command('catalog')
      .description(
        'S8: trigger rate, dark skills, rivals and the added-versus-refused count for the installed skills',
      )
      .option('--propose-retirement', 'Raise authoring.retirement for every dark skill'),
  ).action((options: VerbOptions & { proposeRetirement?: boolean }) => {
    const projectRoot = resolve(options.projectRoot);
    if (!readAuthoringConfig(projectRoot).skill_orchestrator_enabled) {
      console.log(OFF_LINE);
      return;
    }
    printResult(
      runCatalog(projectRoot, {
        proposeRetirement: options.proposeRetirement === true,
        change: changeKey(projectRoot, options.session),
      }),
      options.json,
    );
  });
}

export function createSkillCommand(): Command {
  const command = new Command('skill').description(
    'Prove a new or edited skill through its gated pipeline before it is added',
  );

  command
    .command('lint')
    .description(
      'Check a skill folder, or every skill in the project with --all, against the ' +
        'deterministic skill rules (SK-001 to SK-019). ' +
        'Exit 0 with no blocking finding, 1 with one, 2 on a usage error.',
    )
    .argument('[folder]', 'The skill folder (the one holding SKILL.md)')
    .option('--json', 'Print the findings as JSON')
    .option('--all', 'Lint every skill folder in the project and write one JSON report')
    .option(
      '--report <file>',
      `With --all: the report path (default ${DEFAULT_SKILL_AUDIT_REPORT})`,
    )
    .option('--group-by <how>', 'With --all: group the findings by rule or folder', 'rule')
    .option('--as-of <date>', 'With --all: count fires in the 30 days up to this date (YYYY-MM-DD)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((folder: string | undefined, options: LintOptions) => {
      runLint(folder, options);
    });

  command
    .command('audit')
    .description(
      'Render the skill and agent audit page from skill lint --all and agent lint --all. ' +
        'The first run writes the Before section; later runs keep it and rewrite only After.',
    )
    .requiredOption(
      '--as-of <date>',
      'The audit date (YYYY-MM-DD); also ends the 30-day fire window',
    )
    .option('--out <file>', `The page to write (default ${AUDIT_DOC})`)
    .option('--section <which>', 'Force the section to write: before or after')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: { asOf: string; out?: string; section?: string; projectRoot: string }) => {
      try {
        const written = writeAuditDoc(resolve(options.projectRoot), {
          asOf: options.asOf,
          out: options.out,
          section: options.section as AuditSection | undefined,
          agentSources: STAGE_AGENT_AUDIT_SOURCES,
        });
        console.log(`**▸ paqad** · wrote the ${written.section} audit to ${written.path}.`);
      } catch (error) {
        if (error instanceof AuditUsageError || error instanceof NeverWriteListError) {
          console.error(`skill audit: ${error.message}`);
          process.exitCode = USAGE_EXIT;
          return;
        }
        throw error;
      }
    });

  addPipelineVerbs(command);
  addEvalVerbs(command);
  addReleaseVerbs(command);
  addOperateVerbs(command);

  return command;
}
