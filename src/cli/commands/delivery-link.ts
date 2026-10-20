import { execFileSync } from 'node:child_process';

import { Command } from 'commander';

import {
  reconcileDeliveryFromGit,
  recordCommitForBranch,
  recordLinkAttempt,
  resolveDeliveryFeatureByBranch,
  setCommitDecision,
  stampMergeCommit,
  type CommitDecisionAnswer,
} from '@/feature-evidence/delivery.js';
import { installGitHooks } from '@/feature-evidence/git-hooks.js';
import { featureReportEnabled, writeFeatureReport } from '@/feature-evidence/report-writer.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

interface LinkOptions {
  projectRoot: string;
  session?: string;
}

function git(projectRoot: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function resolveSession(options: LinkOptions): string {
  return resolveSessionId(
    options.projectRoot,
    options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
  );
}

const COMMIT_DECISIONS: readonly NonNullable<CommitDecisionAnswer>[] = [
  'commit',
  'decline',
  'ignored',
  'user-requested',
];

function isCommitDecision(value: string): value is NonNullable<CommitDecisionAnswer> {
  return (COMMIT_DECISIONS as readonly string[]).includes(value);
}

function targetChange(options: LinkOptions): string | null {
  const active = currentFeature(options.projectRoot, resolveSession(options));
  const branch = git(options.projectRoot, ['branch', '--show-current']);
  return active ?? (branch ? resolveDeliveryFeatureByBranch(options.projectRoot, branch) : null);
}

function regenerateReportSafe(projectRoot: string, dirName: string | null): void {
  if (!dirName) return;
  try {
    if (featureReportEnabled(projectRoot)) {
      writeFeatureReport(projectRoot, dirName);
    }
  } catch {}
}

export function createDeliveryLinkCommand(): Command {
  const command = new Command('delivery-link').description(
    'Link git commits/merges to the active feature bundle (post-commit / post-merge hooks)',
  );

  const withCommon = (c: Command): Command =>
    c
      .option('--project-root <path>', 'Project root', process.cwd())
      .option('--session <id>', 'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID)');

  withCommon(
    command
      .command('commit')
      .description('Record HEAD as a commit on the branch-matched (or active) feature'),
  ).action((options: LinkOptions) => {
    const sha = git(options.projectRoot, ['rev-parse', 'HEAD']);
    const subject = git(options.projectRoot, ['log', '-1', '--format=%s']) ?? '';
    if (!sha) {
      console.log(JSON.stringify({ linked: false, reason: 'no HEAD commit' }));
      return;
    }
    const at = new Date().toISOString();
    const active = currentFeature(options.projectRoot, resolveSession(options));
    const dir = recordCommitForBranch(options.projectRoot, active, { sha, subject }, at);
    if (!dir) {
      const branch = git(options.projectRoot, ['branch', '--show-current']);
      const fallback = branch ? resolveDeliveryFeatureByBranch(options.projectRoot, branch) : null;
      if (fallback) {
        recordLinkAttempt(options.projectRoot, fallback, `commit ${sha} not linked`, at);
      }
    }
    regenerateReportSafe(options.projectRoot, dir ?? null);
    console.log(JSON.stringify({ linked: Boolean(dir), feature: dir ?? null, sha }));
  });

  withCommon(
    command
      .command('merge')
      .description('Stamp the pulled merge commit on the branch-matched (or active) feature'),
  ).action((options: LinkOptions) => {
    const sha = git(options.projectRoot, ['rev-parse', 'HEAD']);
    const branch = git(options.projectRoot, ['branch', '--show-current']);
    const active = currentFeature(options.projectRoot, resolveSession(options));
    const dir =
      (branch ? resolveDeliveryFeatureByBranch(options.projectRoot, branch, active) : null) ??
      active;
    if (!sha || !dir) {
      console.log(JSON.stringify({ linked: false, reason: 'no merge target' }));
      return;
    }
    stampMergeCommit(options.projectRoot, dir, sha, new Date().toISOString());
    regenerateReportSafe(options.projectRoot, dir);
    console.log(JSON.stringify({ linked: true, feature: dir, merge_commit: sha }));
  });

  withCommon(
    command
      .command('reconcile')
      .description('Backfill the active feature delivery.json from local git (clone/CI path)'),
  ).action((options: LinkOptions) => {
    const dir = targetChange(options);
    if (!dir) {
      console.log(JSON.stringify({ reconciled: false, reason: 'no feature to reconcile' }));
      return;
    }
    const record = reconcileDeliveryFromGit(options.projectRoot, dir, new Date().toISOString());
    console.log(JSON.stringify({ reconciled: true, feature: dir, commits: record.commits.length }));
  });

  withCommon(
    command
      .command('commit-decision <answer>')
      .description(
        `Record the answer to the commit question on the change (${COMMIT_DECISIONS.join('|')})`,
      ),
  ).action((answer: string, options: LinkOptions) => {
    if (!isCommitDecision(answer)) {
      console.error(
        `unknown commit decision "${answer}"; expected one of ${COMMIT_DECISIONS.join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }
    const dir = targetChange(options);
    if (!dir) {
      console.log(JSON.stringify({ recorded: false, reason: 'no feature to record on' }));
      return;
    }
    const record = setCommitDecision(options.projectRoot, dir, answer, new Date().toISOString());
    console.log(
      JSON.stringify({ recorded: true, feature: dir, commit_decision: record.commit_decision }),
    );
  });

  command
    .command('install')
    .description('Install (chain) the post-commit / post-merge git hooks for this clone')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--session <id>', 'Ignored (accepted for a uniform hook-caller interface)')
    .action((options: { projectRoot: string }) => {
      const result = installGitHooks(options.projectRoot);
      if (result.notAGitRepo) {
        console.log(JSON.stringify({ installed: [], reason: 'not a git repository' }));
        return;
      }
      console.log(
        `**▸ paqad** · git linkage hooks ready (${result.installed.join(', ') || 'up to date'})`,
      );
      console.log(JSON.stringify({ installed: result.installed, skipped: result.skipped }));
    });

  return command;
}
