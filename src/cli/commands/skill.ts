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

  return command;
}
