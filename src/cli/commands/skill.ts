import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Command } from 'commander';

import { readAuthoringConfig } from '@/authoring/config.js';
import { NeverWriteListError } from '@/authoring/lint/never-write.js';
import {
  formatSkillLintJson,
  lintSkillFolder,
  skillLintExitCode,
  SkillLintUsageError,
  type SkillLintResult,
} from '@/authoring/lint/skill-lint.js';
import { enabledAdapters } from '@/authoring/paths.js';
import { runDraft } from '@/authoring/stages/draft.js';
import { runImprove } from '@/authoring/stages/improve.js';
import { raiseIntakeGap, runIntake } from '@/authoring/stages/intake.js';
import { runJustify } from '@/authoring/stages/justify.js';
import { stageExitCode, type StageResult } from '@/authoring/stages/result.js';
import { runEvidence } from '@/authoring/stages/sources.js';
import { skillStatus } from '@/authoring/stages/status.js';
import { runSkillTest } from '@/authoring/stages/test.js';
import { AuthoringRefusal, SkillWorkspace } from '@/authoring/workspace.js';
import { parseFeatureDirName } from '@/feature-evidence/paths.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

const USAGE_EXIT = 2;

interface LintOptions {
  json?: boolean;
  projectRoot: string;
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

function runLint(folder: string, options: LintOptions): void {
  const projectRoot = resolve(options.projectRoot);
  let result: SkillLintResult;
  try {
    result = lintSkillFolder(resolve(folder), {
      projectRoot,
      claudeCode: enabledAdapters(projectRoot).includes('claude-code'),
      bodyMaxTokens: readAuthoringConfig(projectRoot).skill_body_max_tokens,
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

interface VerbOptions {
  projectRoot: string;
  session?: string;
  json?: boolean;
}

const OFF_LINE =
  'The Skill Orchestrator is off (skill_orchestrator_enabled=false), so the skill pipeline does not run.';

function changeKey(projectRoot: string, session?: string): string | null {
  const sessionId = resolveSessionId(
    projectRoot,
    session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
  );
  const dir = currentFeature(projectRoot, sessionId);
  return dir === null ? null : (parseFeatureDirName(dir)?.ulid ?? null);
}

function readInput(path: string, what: string): string {
  try {
    return readFileSync(resolve(path), 'utf8');
  } catch {
    throw new AuthoringRefusal(`could not read ${what} at ${path}`, 2);
  }
}

async function runVerb(
  name: string,
  options: VerbOptions,
  action: (workspace: SkillWorkspace, projectRoot: string) => StageResult | Promise<StageResult>,
): Promise<void> {
  const projectRoot = resolve(options.projectRoot);
  try {
    const workspace = new SkillWorkspace(projectRoot, name);
    if (!readAuthoringConfig(projectRoot).skill_orchestrator_enabled) {
      console.log(OFF_LINE);
      return;
    }
    const result = await action(workspace, projectRoot);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const line of result.lines) console.log(line);
    }
    process.exitCode = stageExitCode(result);
  } catch (error) {
    if (error instanceof AuthoringRefusal) {
      console.error(error.message);
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function withCommon(command: Command): Command {
  return command
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--session <id>', 'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID)')
    .option('--json', 'Print the result as JSON');
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

export function createSkillCommand(): Command {
  const command = new Command('skill').description(
    'Prove a new or edited skill through its gated pipeline before it is added',
  );

  command
    .command('lint')
    .description(
      'Check a skill folder against the deterministic skill rules (SK-001 to SK-019). ' +
        'Exit 0 with no blocking finding, 1 with one, 2 on a usage error.',
    )
    .argument('<folder>', 'The skill folder (the one holding SKILL.md)')
    .option('--json', 'Print the findings as JSON')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((folder: string, options: LintOptions) => {
      runLint(folder, options);
    });

  addPipelineVerbs(command);

  return command;
}
