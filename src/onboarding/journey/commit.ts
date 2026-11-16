import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { renderDelivery } from '@/delivery/templates.js';
import { commitFindings, followsBranchShape } from '@/delivery/workflow-findings.js';
import { loadGitWorkflow } from '@/git-workflow/load.js';

import type { Clock } from './actions.js';
import { JourneyRefusal } from './errors.js';
import { SETTINGS_LOCAL } from './permissions.js';
import { dirtyPaths, fileSha256 } from './preflight.js';
import { requireRun, updateRun } from './run-store.js';
import type { CommitRecord, JourneyRun } from './types.js';

export const ONBOARDING_TITLE = 'paqad onboarding';
const COMMITTABLE_JOURNEY_FILES = [
  PATHS.ONBOARDING_CHOICES,
  PATHS.ONBOARDING_REPORT_JSON,
  PATHS.ONBOARDING_REPORT_MD,
];
const SECRET =
  /(^|\/)(\.env[^/]*|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa)[^/]*|secrets?\.[^/]+)$/u;

export type CommitAnswer =
  | { kind: 'branch'; branch: string | true; ticket?: string; message?: string }
  | { kind: 'later' }
  | { kind: 'no' };

export interface CommitPlan {
  include: string[];
  left_out: Array<{ path: string; reason: string }>;
}

function git(projectRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isIgnored(projectRoot: string, path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', path], { cwd: projectRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function headHash(projectRoot: string, path: string): string | null {
  try {
    const blob = execFileSync('git', ['show', `HEAD:${path}`], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return createHash('sha256').update(blob).digest('hex');
  } catch {
    return null;
  }
}

function inAllowedSet(run: JourneyRun, path: string): boolean {
  return (
    path.startsWith('docs/') ||
    (COMMITTABLE_JOURNEY_FILES as readonly string[]).includes(path) ||
    (run.setup?.generated_files ?? []).includes(path)
  );
}

export function planCommit(projectRoot: string, run: JourneyRun): CommitPlan {
  const include: string[] = [];
  const leftOut: CommitPlan['left_out'] = [];
  const candidates = { ...run.written };
  for (const path of COMMITTABLE_JOURNEY_FILES) {
    const hash = fileSha256(join(projectRoot, path));
    if (hash && candidates[path] === undefined) candidates[path] = hash;
  }
  for (const [path, hash] of Object.entries(candidates).sort(([a], [b]) => a.localeCompare(b))) {
    const now = fileSha256(join(projectRoot, path));
    if (path === SETTINGS_LOCAL)
      leftOut.push({ path, reason: 'local allow list, never committed' });
    else if (!inAllowedSet(run, path))
      leftOut.push({ path, reason: 'outside the files onboarding may commit' });
    else if (SECRET.test(path)) leftOut.push({ path, reason: 'looks like a secret' });
    else if (now === null) leftOut.push({ path, reason: 'no longer exists' });
    else if (now !== hash && !(COMMITTABLE_JOURNEY_FILES as readonly string[]).includes(path)) {
      leftOut.push({ path, reason: 'changed since onboarding wrote it' });
    } else if (path in run.baseline && run.baseline[path] !== headHash(projectRoot, path)) {
      leftOut.push({ path, reason: 'already had changes before onboarding started' });
    } else if (isIgnored(projectRoot, path)) leftOut.push({ path, reason: 'git-ignored' });
    else include.push(path);
  }
  const others = new Set([...Object.keys(run.baseline), ...dirtyPaths(projectRoot)]);
  for (const path of [...others].sort()) {
    if (candidates[path] === undefined) leftOut.push({ path, reason: 'not written by onboarding' });
  }
  return { include, left_out: leftOut };
}

function branchAndMessage(projectRoot: string, answer: Extract<CommitAnswer, { kind: 'branch' }>) {
  const { config } = loadGitWorkflow(projectRoot);
  const typeName = config.branches.default_type;
  const rendered = renderDelivery(
    config,
    {
      ticket: answer.ticket ?? '',
      title: ONBOARDING_TITLE,
      summary: 'set up paqad with the onboarding journey',
    },
    '',
    typeName,
  );
  const branch = answer.branch === true ? rendered.branch : answer.branch;
  const message = answer.message ?? rendered.commit.split('\n')[0] ?? '';
  if (!followsBranchShape(config, branch)) {
    throw new JourneyRefusal(
      `The branch name "${branch}" does not follow this team's pattern ${config.branches.template}. Pass a name with --branch <name> (and --ticket <id> if the pattern needs one).`,
    );
  }
  const findings = commitFindings(config, { subject: message, merge: false });
  if (findings.length > 0) {
    throw new JourneyRefusal(
      `${findings[0]?.message} Pass --message "<subject>" and --ticket <id>.`,
    );
  }
  return { branch, message };
}

export function answerCommit(projectRoot: string, answer: CommitAnswer, now: Clock): CommitRecord {
  const run = requireRun(projectRoot);
  const finish = run.stages.finish.status;
  if (finish !== 'done' && finish !== 'degraded') {
    throw new JourneyRefusal('Ask the commit question only after step 8 (Wrap up) is done.');
  }
  if (run.commit?.answer === 'branch') {
    throw new JourneyRefusal('The onboarding changes are already committed.');
  }
  const at = now().toISOString();
  let record: CommitRecord = { answer: answer.kind, answered_at: at };
  if (answer.kind === 'branch') {
    const { branch, message } = branchAndMessage(projectRoot, answer);
    const plan = planCommit(projectRoot, run);
    if (plan.include.length === 0)
      throw new JourneyRefusal('There is nothing onboarding wrote that can be committed.');
    git(projectRoot, ['checkout', '-b', branch, 'HEAD']);
    git(projectRoot, ['add', '--', ...plan.include]);
    git(projectRoot, ['commit', '-m', message, '--', ...plan.include]);
    record = {
      ...record,
      branch,
      sha: git(projectRoot, ['rev-parse', 'HEAD']).trim(),
      committed: plan.include,
      left_out: plan.left_out,
    };
  }
  updateRun(
    projectRoot,
    (draft) => {
      draft.commit = record;
      draft.status = 'done';
    },
    { now },
  );
  return record;
}
