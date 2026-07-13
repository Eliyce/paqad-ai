import { execFileSync } from 'node:child_process';

import { Command } from 'commander';

import {
  reconcileDeliveryFromGit,
  recordCommitForBranch,
  resolveDeliveryFeatureByBranch,
  stampMergeCommit,
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

/**
 * Regenerate the feature's HTML evidence report after a git-linkage write (issue #371).
 * This is what keeps the report fresh on ALL hosts — including the advisory ones with no
 * lifecycle hook — because the git post-commit / post-merge hooks fire everywhere.
 * Best-effort and gated on the `feature_report` flag: a render failure never affects the
 * (already record-only, always exit-0) delivery-link command.
 */
function regenerateReportSafe(projectRoot: string, dirName: string | null): void {
  if (!dirName) return;
  try {
    if (featureReportEnabled(projectRoot)) {
      writeFeatureReport(projectRoot, dirName);
    }
  } catch {
    // Record-only: a broken render must never disrupt a git operation.
  }
}

/**
 * `paqad-ai delivery-link <commit|merge|reconcile>` — the git-linkage verbs the native
 * `post-commit` / `post-merge` hooks call (issue #339, Phase 5). Record-only and
 * non-blocking: every subcommand exits 0 even when nothing can be linked, so a git
 * operation is never held up by paqad. The commit trail in a feature's `delivery.json`
 * is the proof of WHICH code the bundle attests.
 */
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
    const dir = recordCommitForBranch(
      options.projectRoot,
      resolveSession(options),
      { sha, subject },
      new Date().toISOString(),
    );
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
    const active = currentFeature(options.projectRoot, resolveSession(options));
    // With no active feature, reconcile every branch-matched feature so a fresh clone
    // still lands accurate linkage on the feature that owns the current branch.
    const branch = git(options.projectRoot, ['branch', '--show-current']);
    const dir =
      active ?? (branch ? resolveDeliveryFeatureByBranch(options.projectRoot, branch) : null);
    if (!dir) {
      console.log(JSON.stringify({ reconciled: false, reason: 'no feature to reconcile' }));
      return;
    }
    const record = reconcileDeliveryFromGit(options.projectRoot, dir, new Date().toISOString());
    console.log(JSON.stringify({ reconciled: true, feature: dir, commits: record.commits.length }));
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
        `▸ paqad · git linkage hooks ready (${result.installed.join(', ') || 'up to date'})`,
      );
      console.log(JSON.stringify({ installed: result.installed, skipped: result.skipped }));
    });

  return command;
}
