import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { Command } from 'commander';
import YAML from 'yaml';

import {
  branchFinding,
  commitFindings,
  type WorkflowFinding,
} from '@/delivery/workflow-findings.js';
import { isConfiguredBase } from '@/delivery/runner.js';
import { runningUnderAgent } from '@/git-workflow/agent-env.js';
import { createDeliveryShell } from '@/delivery/shell.js';
import {
  GitWorkflowInputError,
  applyChange,
  parseEdits,
  planChange,
  readJsonFile,
  validate,
  writeContents,
} from '@/git-workflow/change.js';
import { unifiedDiff } from '@/git-workflow/diff.js';
import { PATHS } from '@/core/constants/paths.js';
import { isNewerTeamFile, newerTeamFileLine } from '@/core/team-file-schema.js';
import { changedOutside, stampLastApplied } from '@/git-workflow/last-applied.js';
import { pendingMoveRefusal } from '@/git-workflow/migrate.js';
import { loadGitWorkflow, readGitWorkflowContents } from '@/git-workflow/load.js';
import {
  GitReadError,
  applyAnswers,
  gatherSignals,
  proposeFromSignals,
} from '@/git-workflow/setup.js';
import { GIT_WORKFLOW_FILES } from '@/git-workflow/types.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import type { ResolvedGitWorkflow } from '@/git-workflow/types.js';

export interface HookCheckResult {
  exitCode: number;
  stderr: string;
  findings: WorkflowFinding[];
}

const ZERO_SHA = /^0+$/;
const NONE: HookCheckResult = { exitCode: 0, stderr: '', findings: [] };

function gitPath(projectRoot: string, name: string): string | null {
  try {
    const rel = execFileSync('git', ['rev-parse', '--git-path', name], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return isAbsolute(rel) ? rel : join(projectRoot, rel);
  } catch {
    return null;
  }
}

export function messageSubject(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trimEnd())
      .find((line) => line.trim() !== '' && !line.startsWith('#')) ?? ''
  );
}

function hookReport(
  findings: WorkflowFinding[],
  block: boolean,
  what: 'commit' | 'push',
): HookCheckResult {
  if (findings.length === 0) return NONE;
  const glyph = block ? '🔴' : '🟡';
  const lines = [
    `**▸ paqad** · this ${what} doesn't follow the team's git workflow`,
    ...findings.map((finding) => `> - ${glyph} ${finding.message}`),
    block
      ? `> The ${what} was stopped. Fix it, or skip this check once with --no-verify.`
      : `> The ${what} went through. Please fix it before the PR.`,
  ];
  return { exitCode: block ? 1 : 0, stderr: `${lines.join('\n')}\n`, findings };
}

interface HookSetting {
  config: ResolvedGitWorkflow;
  setting: 'warn' | 'block' | 'off';
}

function hookSetting(projectRoot: string, env: NodeJS.ProcessEnv): HookSetting | null {
  const loaded = loadGitWorkflow(projectRoot);
  if (!loaded.valid || !loaded.config.enforcement.enabled) return null;
  const { agents, people } = loaded.config.enforcement;
  return { config: loaded.config, setting: runningUnderAgent(env) ? agents : people };
}

export interface CheckCommitInput {
  projectRoot: string;
  messageFile: string;
  env?: NodeJS.ProcessEnv;
  merging?: boolean;
}

export function runCheckCommit(input: CheckCommitInput): HookCheckResult {
  const chosen = hookSetting(input.projectRoot, input.env ?? process.env);
  if (!chosen || chosen.setting === 'off') return NONE;
  const path = resolve(input.projectRoot, input.messageFile);
  if (!existsSync(path)) return NONE;
  const mergeHead = gitPath(input.projectRoot, 'MERGE_HEAD');
  const merging = input.merging ?? (mergeHead !== null && existsSync(mergeHead));
  const subject = messageSubject(readFileSync(path, 'utf8'));
  if (subject === '') return NONE;
  const findings = commitFindings(chosen.config, { subject, merge: merging });
  return hookReport(findings, chosen.setting === 'block', 'commit');
}

export interface CheckPushInput {
  projectRoot: string;
  stdin: string;
  env?: NodeJS.ProcessEnv;
}

export function pushedBranches(stdin: string): string[] {
  const branches: string[] = [];
  for (const line of stdin.split('\n')) {
    const [localRef, localSha] = line.trim().split(/\s+/);
    if (!localRef?.startsWith('refs/heads/') || !localSha || ZERO_SHA.test(localSha)) continue;
    const branch = localRef.slice('refs/heads/'.length);
    if (!branches.includes(branch)) branches.push(branch);
  }
  return branches;
}

export function runCheckPush(input: CheckPushInput): HookCheckResult {
  const chosen = hookSetting(input.projectRoot, input.env ?? process.env);
  if (!chosen || chosen.setting === 'off') return NONE;
  const findings = pushedBranches(input.stdin)
    .filter((branch) => !isConfiguredBase(chosen.config, branch))
    .map((branch) => branchFinding(chosen.config, branch))
    .filter((finding): finding is WorkflowFinding => finding !== null);
  return hookReport(findings, chosen.setting === 'block', 'push');
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

function finishHook(result: HookCheckResult): void {
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

export interface JsonResult {
  exitCode: number;
  stdout: string;
  stderr?: string;
}

function json(value: unknown, exitCode = 0): JsonResult {
  return { exitCode, stdout: `${JSON.stringify(value, null, 2)}\n` };
}

function failure(error: unknown): JsonResult {
  const message = error instanceof Error ? error.message : String(error);
  const exitCode = error instanceof GitReadError ? 2 : 1;
  return {
    exitCode,
    stdout: `${JSON.stringify({ error: message }, null, 2)}\n`,
    stderr: `${message}\n`,
  };
}

export interface SetupInput {
  projectRoot: string;
  shell: DeliveryShell;
  answersFile?: string;
  overwrite?: boolean;
  dryRun?: boolean;
}

export async function runSetup(input: SetupInput): Promise<JsonResult> {
  try {
    const built = proposeFromSignals(await gatherSignals(input.shell, input.projectRoot));
    if (!input.answersFile) return json(built.proposal);
    const raw = readJsonFile(resolve(input.projectRoot, input.answersFile)) as {
      choices?: Record<string, unknown>;
    };
    const answers = Object.fromEntries(
      Object.entries(raw?.choices ?? {}).map(([key, value]) => [key, String(value)]),
    );
    const applied = applyAnswers(built, answers);
    const present = readGitWorkflowContents(input.projectRoot);
    const diff = GIT_WORKFLOW_FILES.map((file) =>
      unifiedDiff(file, present[file] ?? null, applied.contents[file] ?? ''),
    ).join('');
    const checked = validate(applied.contents);
    const result = {
      diff,
      ...checked,
      not_confirmed: applied.notConfirmed,
      written: [] as string[],
    };
    if (input.dryRun || !checked.valid) return json(result, checked.valid ? 0 : 1);
    const refusal = pendingMoveRefusal(input.projectRoot);
    if (refusal.length > 0) return json({ ...result, error: refusal.join(' ') }, 1);
    const exists = GIT_WORKFLOW_FILES.some((file) => present[file] !== undefined);
    if (exists && !input.overwrite) {
      return json(
        {
          ...result,
          error: 'The git workflow files already exist. Re-run with --overwrite to replace them.',
        },
        1,
      );
    }
    const newer = GIT_WORKFLOW_FILES.filter((file) => isNewerTeamFile(present[file] ?? ''));
    if (newer.length > 0) {
      return json(
        {
          ...result,
          error: newer
            .map((file) => newerTeamFileLine(`${PATHS.GIT_WORKFLOW_DIR}/${file}`))
            .join(' '),
        },
        1,
      );
    }
    writeContents(input.projectRoot, applied.contents, GIT_WORKFLOW_FILES);
    return json({ ...result, written: [...GIT_WORKFLOW_FILES] });
  } catch (error) {
    return failure(error);
  }
}

export function runShow(projectRoot: string): JsonResult {
  const loaded = loadGitWorkflow(projectRoot);
  return {
    exitCode: loaded.valid ? 0 : 1,
    stdout: YAML.stringify(
      { config: loaded.config, errors: loaded.errors, warnings: loaded.warnings },
      { lineWidth: 0 },
    ),
  };
}

export function runChange(projectRoot: string, file: string, apply: boolean): JsonResult {
  try {
    const edits = parseEdits(readJsonFile(resolve(projectRoot, file)));
    if (!apply) {
      const plan = planChange(projectRoot, edits);
      return json(plan, plan.valid ? 0 : 1);
    }
    const applied = applyChange(projectRoot, edits);
    return json(applied, applied.valid ? 0 : 1);
  } catch (error) {
    return failure(error);
  }
}

export function runCheck(projectRoot: string, accept: boolean): JsonResult {
  const loaded = loadGitWorkflow(projectRoot);
  const outside = changedOutside(projectRoot);
  const result = {
    valid: loaded.valid,
    errors: loaded.errors,
    warnings: loaded.warnings,
    changed_outside: outside,
  };
  if (!accept) return json(result, loaded.valid ? 0 : 1);
  if (!loaded.valid) return json({ ...result, accepted: false }, 1);
  stampLastApplied(projectRoot);
  return json({ ...result, changed_outside: [], accepted: true });
}

function print(result: JsonResult): void {
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

export function createGitWorkflowCommand(): Command {
  const command = new Command('git-workflow').description(
    "Set up, change and check this team's git workflow rules in .paqad/configs/git-workflow/",
  );
  command
    .command('setup')
    .description(
      'Read the repo history and propose the git workflow files as JSON (writes nothing)',
    )
    .option('--apply <answers>', 'Apply the answers in answers.json and write the five files')
    .option('--overwrite', 'Replace existing git workflow files', false)
    .option('--dry-run', 'Print the diff and the validation result, and write nothing', false)
    .option('--project-root <path>', 'Project root', process.cwd())
    .action(
      async (options: {
        apply?: string;
        overwrite: boolean;
        dryRun: boolean;
        projectRoot: string;
      }) => {
        const projectRoot = resolve(options.projectRoot);
        print(
          await runSetup({
            projectRoot,
            shell: createDeliveryShell(projectRoot),
            answersFile: options.apply,
            overwrite: options.overwrite,
            dryRun: options.dryRun,
          }),
        );
      },
    );
  command
    .command('show')
    .description('Print the resolved git workflow rules as YAML, with errors and warnings')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: { projectRoot: string }) => print(runShow(resolve(options.projectRoot))));
  command
    .command('change')
    .description('Plan or apply the edits in change.json')
    .option('--plan <change>', 'Print the diff and the validation result, and write nothing')
    .option('--apply <change>', 'Write the edits, keeping comments and key order')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: { plan?: string; apply?: string; projectRoot: string }) => {
      const projectRoot = resolve(options.projectRoot);
      const file = options.apply ?? options.plan;
      if (!file || (options.apply && options.plan)) {
        print(
          failure(
            new GitWorkflowInputError(
              'Pass exactly one of --plan <change.json> or --apply <change.json>.',
            ),
          ),
        );
        return;
      }
      print(runChange(projectRoot, file, options.apply !== undefined));
    });
  command
    .command('check')
    .description('Validate the files and list any changed outside the git-workflow skill')
    .option('--accept', 'Accept the current files and restamp them when they are valid', false)
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: { accept: boolean; projectRoot: string }) =>
      print(runCheck(resolve(options.projectRoot), options.accept)),
    );
  command
    .command('check-commit')
    .description('Check a commit message against the team rules (used by the commit-msg hook)')
    .argument('<file>', 'The commit message file git passes to the hook')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((file: string, options: { projectRoot: string }) => {
      finishHook(runCheckCommit({ projectRoot: resolve(options.projectRoot), messageFile: file }));
    });
  command
    .command('check-push')
    .description('Check pushed branch names against the team rules (used by the pre-push hook)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action(async (options: { projectRoot: string }) => {
      finishHook(
        runCheckPush({ projectRoot: resolve(options.projectRoot), stdin: await readStdin() }),
      );
    });
  return command;
}
