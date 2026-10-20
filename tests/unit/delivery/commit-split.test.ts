import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  branchCarriesOtherWork,
  changeOwnTickets,
  computeCommitSplit,
  describeInherited,
  intakeBranchLine,
  sharedBranchLine,
} from '@/delivery/commit-split.js';
import { parseBranchTickets } from '@/planning/ticket-ref-detect.js';

import { ticketRef } from '../../shared/ticket-ref.js';

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
  it('splits own and inherited commits with tickets, merges and untagged', () => {
    const { root, start } = sharedBranch();
    const split = computeCommitSplit(root, { startCommit: start, ownTickets: ['ORD-482'] });
    expect(split.state).toBe('known');
    expect(split.own).toEqual({ count: 2, tickets: ['ORD-482'], merges: 0, untagged: 1 });
    expect(split.inherited?.count).toBe(5);
    expect(split.inherited?.merges).toBe(1);
    expect(split.inherited?.untagged).toBe(2);
    expect([...(split.inherited?.tickets ?? [])].sort()).toEqual(['ORD-470', 'ORD-471', 'ORD-472']);
    expect(branchCarriesOtherWork(split)).toBe(true);
    expect(sharedBranchLine(split, 'feat/ORD-470-contact-matching')).toContain(
      'Branch `feat/ORD-470-contact-matching` already carries 5 commits from 3 other tickets',
    );
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

  it('raises nothing on a fresh branch from main and leaves the commit graph untouched', () => {
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

  it('clears the inherited commits once they are rebased away', () => {
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

  it('records unknown on a detached HEAD, with no base branch, or outside git', () => {
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
      'Branch `feat/ORD-470-contact-matching` already carries 6 commits from 3 other tickets',
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

  it('describes inherited commits with and without tickets', () => {
    expect(describeInherited({ count: 1, tickets: ['A-1'], merges: 0, untagged: 0 })).toBe(
      '1 commit from 1 other ticket',
    );
    expect(describeInherited({ count: 2, tickets: [], merges: 0, untagged: 2 })).toBe(
      '2 commits made before this change started',
    );
  });
});
