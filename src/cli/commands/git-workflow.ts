import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { Command } from 'commander';

import {
  branchFinding,
  commitFindings,
  type WorkflowFinding,
} from '@/delivery/workflow-findings.js';
import { isConfiguredBase } from '@/delivery/runner.js';
import { runningUnderAgent } from '@/git-workflow/agent-env.js';
import { loadGitWorkflow } from '@/git-workflow/load.js';
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

export function createGitWorkflowCommand(): Command {
  const command = new Command('git-workflow').description(
    "Set up, change and check this team's git workflow rules in .paqad/configs/git-workflow/",
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
