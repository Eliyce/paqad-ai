import { execFileSync } from 'node:child_process';

import { readGitState } from '@/rag/git-state.js';
import { detectTicketRefs, parseBranchTickets } from '@/planning/ticket-ref-detect.js';

export interface CommitGroup {
  count: number;
  tickets: string[];
  merges: number;
  untagged: number;
}

export interface CommitSplit {
  state: 'known' | 'unknown';
  reason: string | null;
  base_commit: string | null;
  own: CommitGroup | null;
  inherited: CommitGroup | null;
  own_shas?: string[];
  inherited_shas?: string[];
}

export interface CommitSplitInput {
  baseBranch?: string;
  startCommit?: string | null;
  ownTickets?: readonly string[];
}

interface BranchCommit {
  sha: string;
  parents: number;
  tickets: string[];
}

function git(projectRoot: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch {
    return undefined;
  }
}

function emptyGroup(): CommitGroup {
  return { count: 0, tickets: [], merges: 0, untagged: 0 };
}

function unknownSplit(reason: string): CommitSplit {
  return { state: 'unknown', reason, base_commit: null, own: null, inherited: null };
}

function readBranchCommits(projectRoot: string, baseCommit: string): BranchCommit[] {
  const out = git(projectRoot, ['log', `${baseCommit}..HEAD`, '--format=%H%x1f%P%x1f%s']) ?? '';
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, parents = '', ...subject] = line.split('\x1f');
      return {
        sha,
        parents: parents.split(' ').filter(Boolean).length,
        tickets: detectTicketRefs(subject.join('\x1f'), 'generic'),
      };
    });
}

function commitsBeforeStart(
  projectRoot: string,
  baseCommit: string,
  startCommit: string | null | undefined,
): Set<string> | null {
  if (!startCommit) return null;
  const out = git(projectRoot, ['rev-list', `${baseCommit}..${startCommit}`]);
  if (out === undefined) return null;
  return new Set(out.split('\n').filter(Boolean));
}

function addTo(group: CommitGroup, commit: BranchCommit, tickets: readonly string[]): void {
  group.count += 1;
  if (commit.parents > 1) group.merges += 1;
  if (commit.tickets.length === 0) group.untagged += 1;
  for (const ticket of tickets) {
    if (!group.tickets.includes(ticket)) group.tickets.push(ticket);
  }
}

export function changeOwnTickets(
  issue: string | null | undefined,
  branch: string | null,
): string[] {
  const fromIssue = issue ? detectTicketRefs(issue, 'generic') : [];
  return fromIssue.length > 0 ? fromIssue : parseBranchTickets(branch);
}

export function computeCommitSplit(projectRoot: string, input: CommitSplitInput = {}): CommitSplit {
  const state = readGitState(projectRoot, { baseBranch: input.baseBranch });
  if (!state.head_commit) return unknownSplit('not a git repository');
  if (!state.branch) return unknownSplit('detached HEAD');
  if (!state.base_commit) return unknownSplit('no reachable base branch');

  const own = new Set(input.ownTickets ?? []);
  const beforeStart = commitsBeforeStart(projectRoot, state.base_commit, input.startCommit);
  const split = { own: emptyGroup(), inherited: emptyGroup() };
  const ownShas: string[] = [];
  const inheritedShas: string[] = [];
  for (const commit of readBranchCommits(projectRoot, state.base_commit)) {
    const ours = commit.tickets.some((ticket) => own.has(ticket));
    const foreign = own.size > 0 && commit.tickets.length > 0 && !ours;
    const afterStart = beforeStart === null || !beforeStart.has(commit.sha);
    if (ours || (!foreign && afterStart)) {
      addTo(split.own, commit, commit.tickets);
      ownShas.push(commit.sha);
    } else {
      inheritedShas.push(commit.sha);
      addTo(
        split.inherited,
        commit,
        commit.tickets.filter((ticket) => !own.has(ticket)),
      );
    }
  }
  return {
    state: 'known',
    reason: null,
    base_commit: state.base_commit,
    own: split.own,
    inherited: split.inherited,
    own_shas: ownShas,
    inherited_shas: inheritedShas,
  };
}

export function branchCarriesOtherWork(split: CommitSplit | null | undefined): boolean {
  return split?.state === 'known' && (split.inherited?.tickets.length ?? 0) > 0;
}

function commitCount(count: number): string {
  return `${count} commit${count === 1 ? '' : 's'}`;
}

export function describeInherited(group: CommitGroup): string {
  const tickets = group.tickets.length;
  if (tickets === 0) return `${commitCount(group.count)} made before this change started`;
  const fromTickets = `${commitCount(group.count - group.untagged)} from ${tickets} other ticket${tickets === 1 ? '' : 's'}`;
  if (group.untagged === 0) return fromTickets;
  return `${fromTickets} and ${group.untagged} untagged made before this change started`;
}

export function sharedBranchLine(split: CommitSplit, branch: string | null): string | null {
  if (!branchCarriesOtherWork(split) || !split.inherited) return null;
  return (
    `🟡 Branch \`${branch ?? 'HEAD'}\` already carries ${describeInherited(split.inherited)}. ` +
    `They ride along in this PR unless you split the branch yourself; paqad never moves commits.`
  );
}

export function intakeBranchLine(
  projectRoot: string,
  ticketRefs: readonly string[],
): string | null {
  const state = readGitState(projectRoot);
  const split = computeCommitSplit(projectRoot, {
    startCommit: state.head_commit ?? null,
    ownTickets: ticketRefs,
  });
  return sharedBranchLine(split, state.branch ?? null);
}
