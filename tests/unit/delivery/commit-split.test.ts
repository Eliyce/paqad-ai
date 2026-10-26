import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  branchCarriesOtherWork,
  changeOwnTickets,
  computeCommitSplit,
  describeEarlierWork,
  describeInherited,
  intakeBranchLine,
  sharedBranchLine,
} from '@/delivery/commit-split.js';
import { readFeatureDelivery, reconcileDeliveryFromGit } from '@/feature-evidence/delivery.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { computeHudFlags } from '@/hud/snapshot.js';
import { parseBranchTickets } from '@/planning/ticket-ref-detect.js';

import { ticketRef } from '../../shared/ticket-ref.js';

const PULL_REQUEST_SUBJECTS: string[] = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/delivery/pull-request-subjects.json'), 'utf8'),
).subjects;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repo(initial = 'main'): { root: string; g: (...args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-commit-split-'));
  roots.push(root);
  const g = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  g('init', '-q', '-b', initial);
  g('config', 'user.email', 't@t.dev');
  g('config', 'user.name', 'T');
  g('config', 'commit.gpgsign', 'false');
  commit(root, g, 'chore: base');
  return { root, g };
}

let counter = 0;
function commit(root: string, g: (...args: string[]) => string, subject: string): string {
  counter += 1;
  writeFileSync(join(root, `f${counter}.txt`), subject);
  g('add', '-A');
  g('commit', '-q', '-m', subject);
  return g('rev-parse', 'HEAD');
}

function sharedBranch(): { root: string; g: (...args: string[]) => string; start: string } {
  const { root, g } = repo();
  g('checkout', '-q', '-b', 'feat/ORD-470-contact-matching');
  commit(root, g, 'feat(ORD-470): match contacts');
  commit(root, g, 'fix(ORD-471): trim names');
  g('checkout', '-q', '-b', 'side');
  commit(root, g, 'feat(ORD-472): side work');
  g('checkout', '-q', 'feat/ORD-470-contact-matching');
  g('merge', '-q', '--no-ff', '-m', "Merge branch 'side'", 'side');
  commit(root, g, 'wip');
  const start = g('rev-parse', 'HEAD');
  commit(root, g, 'feat(ORD-482): new matcher');
  commit(root, g, 'tidy');
  return { root, g, start };
}

describe('computeCommitSplit', () => {
  it('AC-32: splits own and inherited commits with tickets, merges and untagged', () => {
    const { root, start } = sharedBranch();
    const split = computeCommitSplit(root, { startCommit: start, ownTickets: ['ORD-482'] });
    expect(split.state).toBe('known');
    expect(split.own).toEqual({ count: 2, tickets: ['ORD-482'], merges: 0, untagged: 1 });
    expect(split.inherited?.count).toBe(5);
    expect(split.inherited?.merges).toBe(1);
    expect(split.inherited?.untagged).toBe(2);
    expect([...(split.inherited?.tickets ?? [])].sort()).toEqual(['ORD-470', 'ORD-471', 'ORD-472']);
    expect(split.own_shas).toHaveLength(2);
    expect(split.inherited_shas).toHaveLength(5);
    expect(new Set([...split.own_shas!, ...split.inherited_shas!]).size).toBe(7);
    expect(branchCarriesOtherWork(split)).toBe(true);
    expect(sharedBranchLine(split, 'feat/ORD-470-contact-matching')).toContain(
      'Branch `feat/ORD-470-contact-matching` already carries 5 commits from tickets ORD-470, ORD-471, ORD-472 made before this change started',
    );
  });

  it('reports untagged commits from before the start without flagging the branch', () => {
    const { root, g } = repo();
    g('checkout', '-q', '-b', 'feat/ORD-482-new');
    commit(root, g, 'wip');
    commit(root, g, 'more wip');
    const start = g('rev-parse', 'HEAD');
    commit(root, g, 'feat(ORD-482): new matcher');
    const split = computeCommitSplit(root, { startCommit: start, ownTickets: ['ORD-482'] });
    expect(split.inherited).toEqual({ count: 2, tickets: [], merges: 0, untagged: 2 });
    expect(split.own?.count).toBe(1);
    expect(branchCarriesOtherWork(split)).toBe(false);
    expect(sharedBranchLine(split, 'feat/ORD-482-new')).toBeNull();
    expect(intakeBranchLine(root, ['ORD-482'])).toBeNull();
  });

  it('counts a later commit naming another ticket as inherited', () => {
    const { root, g, start } = sharedBranch();
    commit(root, g, 'fix(ORD-470): late fix');
    const split = computeCommitSplit(root, { startCommit: start, ownTickets: ['ORD-482'] });
    expect(split.inherited?.count).toBe(6);
    expect(split.own?.count).toBe(2);
  });

  it('counts every commit as own when neither a start commit nor a ticket is known', () => {
    const { root } = sharedBranch();
    const split = computeCommitSplit(root);
    expect(split.inherited?.count).toBe(0);
    expect(split.own?.count).toBe(7);
    expect(branchCarriesOtherWork(split)).toBe(false);
    expect(sharedBranchLine(split, 'x')).toBeNull();
  });

  it('AC-32: raises nothing on a fresh branch from main and leaves the commit graph untouched', () => {
    const { root, g } = repo();
    g('checkout', '-q', '-b', 'feat/ORD-482-new');
    const start = g('rev-parse', 'HEAD');
    commit(root, g, 'feat(ORD-482): new matcher');
    const before = g('rev-list', '--all');
    const split = computeCommitSplit(root, { startCommit: start, ownTickets: ['ORD-482'] });
    expect(split.inherited?.count).toBe(0);
    expect(branchCarriesOtherWork(split)).toBe(false);
    expect(g('rev-list', '--all')).toBe(before);
  });

  it('AC-32: clears the inherited commits once they are rebased away', () => {
    const { root, g, start } = sharedBranch();
    expect(
      branchCarriesOtherWork(
        computeCommitSplit(root, { startCommit: start, ownTickets: ['ORD-482'] }),
      ),
    ).toBe(true);
    g('checkout', '-q', '-b', 'feat/ORD-482-clean', 'main');
    commit(root, g, 'feat(ORD-482): new matcher');
    const split = computeCommitSplit(root, { startCommit: start, ownTickets: ['ORD-482'] });
    expect(split.inherited?.count).toBe(0);
  });

  it('AC-32: records unknown on a detached HEAD, with no base branch, or outside git', () => {
    const { root, g } = repo();
    commit(root, g, 'second');
    g('checkout', '-q', '--detach', 'HEAD');
    expect(computeCommitSplit(root)).toMatchObject({ state: 'unknown', reason: 'detached HEAD' });

    const trunk = repo('trunk').root;
    expect(computeCommitSplit(trunk)).toMatchObject({
      state: 'unknown',
      reason: 'no reachable base branch',
      own: null,
      inherited: null,
    });

    const bare = mkdtempSync(join(tmpdir(), 'paqad-commit-split-none-'));
    roots.push(bare);
    expect(computeCommitSplit(bare).state).toBe('unknown');
    expect(branchCarriesOtherWork(computeCommitSplit(bare))).toBe(false);
  });

  it('AC-32: delivery.json carries the split, earlier work raises no flag, and the commit graph stays', () => {
    const quiet = {
      stages: [],
      gates: [],
      rulesRecorded: true,
      tableSkipped: false,
      isolationStatus: 'not-applicable',
      isolatedStages: 0,
    };
    const shared = (split: ReturnType<typeof computeCommitSplit> | null | undefined) =>
      computeHudFlags({ ...quiet, commitSplit: split }).some((flag) => flag.id === 'branch:shared');
    const { root, g } = repo();
    g('checkout', '-q', '-b', 'feat/ORD-470-contact-matching');
    commit(root, g, 'feat(ORD-470): match contacts');
    g('checkout', '-q', '-b', 'side');
    commit(root, g, 'feat(ORD-472): side work');
    g('checkout', '-q', 'feat/ORD-470-contact-matching');
    g('merge', '-q', '--no-ff', '-m', "Merge branch 'side'", 'side');
    commit(root, g, 'wip');
    writeFileSync(join(root, '.git/info/exclude'), '.paqad/\n');
    const dir = openFeatureChange(root, 'ses_split', {
      adapter: 'claude-code',
      issue: 'ORD-482',
      ulidSeed: 1,
    });
    commit(root, g, 'feat(ORD-482): new matcher');
    commit(root, g, 'tidy');
    const before = g('rev-list', '--all');
    const at = '2026-10-20T00:00:00.000Z';
    let split = reconcileDeliveryFromGit(root, dir, at).commit_split;
    expect(g('rev-list', '--all')).toBe(before);
    expect(readFeatureDelivery(root, dir).commit_split).toEqual(split);
    expect(split?.state).toBe('known');
    expect(split?.own).toEqual({ count: 2, tickets: ['ORD-482'], merges: 0, untagged: 1 });
    expect(split?.inherited?.count).toBe(4);
    expect(split?.inherited?.merges).toBe(1);
    expect(split?.inherited?.untagged).toBe(2);
    expect([...(split?.inherited?.tickets ?? [])].sort()).toEqual(['ORD-470', 'ORD-472']);
    expect(shared(split)).toBe(false);

    g('checkout', '-q', '-b', 'feat/ORD-482-clean', 'main');
    commit(root, g, 'feat(ORD-482): new matcher');
    split = reconcileDeliveryFromGit(root, dir, at).commit_split;
    expect(split?.inherited?.count).toBe(0);
    expect(shared(split)).toBe(false);

    g('checkout', '-q', '--detach', 'HEAD');
    split = reconcileDeliveryFromGit(root, dir, at).commit_split;
    expect(split).toMatchObject({ state: 'unknown', reason: 'detached HEAD' });
    expect(shared(split)).toBe(false);
  });

  it('treats an unknown start commit as no start', () => {
    const { root } = sharedBranch();
    const split = computeCommitSplit(root, { startCommit: 'deadbeef', ownTickets: ['ORD-482'] });
    expect(split.own?.count).toBe(4);
    expect(split.inherited?.count).toBe(3);
  });
});

describe('intakeBranchLine', () => {
  it('names the commits from other tickets on the current branch, and nothing on a clean one', () => {
    const { root, g } = sharedBranch();
    expect(intakeBranchLine(root, ['ORD-482'])).toContain(
      'Branch `feat/ORD-470-contact-matching` already carries 6 commits from tickets ORD-470, ORD-471, ORD-472 made before this change started',
    );
    g('checkout', '-q', '-b', 'feat/ORD-490-clean', 'main');
    expect(intakeBranchLine(root, ['ORD-490'])).toBeNull();
  });
});

describe('ticket helpers', () => {
  it('reads tickets from a branch name', () => {
    expect(parseBranchTickets('feat/ORD-470-contact-matching')).toEqual(['ORD-470']);
    expect(parseBranchTickets('feat/12-34-two-tickets')).toEqual([ticketRef(12), ticketRef(34)]);
    expect(parseBranchTickets('fix/7')).toEqual([ticketRef(7)]);
    expect(parseBranchTickets('feat/add-retries')).toEqual([]);
    expect(parseBranchTickets(null)).toEqual([]);
  });

  it('prefers the change issue over the branch name', () => {
    expect(changeOwnTickets('ORD-482', 'feat/ORD-470-x')).toEqual(['ORD-482']);
    expect(changeOwnTickets(null, 'feat/ORD-470-x')).toEqual(['ORD-470']);
    expect(changeOwnTickets('no ticket here', null)).toEqual([]);
  });

  it('describes inherited commits in one sentence with one count', () => {
    expect(describeInherited({ count: 1, tickets: ['A-1'], merges: 0, untagged: 0 })).toBe(
      '1 commit from ticket A-1 made before this change started',
    );
    expect(describeInherited({ count: 2, tickets: [], merges: 0, untagged: 2 })).toBe(
      '2 commits made before this change started',
    );
    expect(describeInherited({ count: 2, tickets: ['X-1'], merges: 0, untagged: 1 })).toBe(
      '2 commits from ticket X-1 made before this change started',
    );
    expect(describeInherited({ count: 3, tickets: ['A-1', 'B-2'], merges: 0, untagged: 1 })).toBe(
      '3 commits from tickets A-1, B-2 made before this change started',
    );
  });

  it('names earlier work for the pull request with one count', () => {
    expect(describeEarlierWork({ count: 0, tickets: [], merges: 0, untagged: 0 })).toBe(
      'no commits from earlier work',
    );
    expect(describeEarlierWork({ count: 1, tickets: [], merges: 0, untagged: 1 })).toBe(
      '1 commit from earlier work',
    );
    expect(describeEarlierWork({ count: 1, tickets: ['A-1'], merges: 0, untagged: 0 })).toBe(
      '1 commit from earlier work on ticket A-1',
    );
    expect(describeEarlierWork({ count: 3, tickets: ['A-1', 'B-2'], merges: 0, untagged: 1 })).toBe(
      '3 commits from earlier work on tickets A-1, B-2',
    );
  });

  it('AC-10: a pull request number in a subject is not a ticket', () => {
    const { root, g } = repo();
    g('checkout', '-q', '-b', 'feat/next');
    for (const subject of PULL_REQUEST_SUBJECTS) commit(root, g, subject);
    const start = g('rev-parse', 'HEAD');
    const split = computeCommitSplit(root, { startCommit: start });
    expect(split.inherited).toEqual({ count: 2, tickets: [], merges: 0, untagged: 2 });
  });
});
