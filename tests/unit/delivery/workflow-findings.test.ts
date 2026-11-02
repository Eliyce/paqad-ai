import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  evaluateDelivery,
  runDeliveryCapability,
  type CommandRunner,
} from '@/delivery/delivery-check.js';
import {
  branchFinding,
  commitFindings,
  invalidFinding,
  onBaseFinding,
  parseSubjects,
  prFindings,
} from '@/delivery/workflow-findings.js';
import { defaultGitWorkflow } from '@/git-workflow/defaults.js';
import type { ResolvedGitWorkflow } from '@/git-workflow/types.js';

import { ticketRef } from '../../shared/ticket-ref.js';

function config(): ResolvedGitWorkflow {
  const c = defaultGitWorkflow('main');
  c.tickets.sources = {
    proj: {
      tracker: 'jira',
      pattern: 'PROJ-\\d+',
      server: '',
      transitions: { on_pr_open: '', on_ci_green: '' },
    },
  };
  return c;
}

const N = ticketRef(4);

describe('section 9.1 findings carry their exact messages', () => {
  it('git-workflow-invalid', () => {
    expect(
      invalidFinding([{ file: 'branches.yaml', path: 'default_type', message: 'bad type' }]),
    ).toEqual({
      code: 'git-workflow-invalid',
      message: '.paqad/configs/git-workflow/ has errors, so nothing was checked: bad type',
    });
  });

  it('on-base-branch', () => {
    expect(onBaseFinding('main').message).toBe(
      "you're committing on main. This team works on a branch and opens a PR from it.",
    );
  });

  it('branch-shape: PROJ-12-add-login passes a ticket-first template, misc does not', () => {
    const c = config();
    c.branches.template = '{ticket}-{title_slug}';
    for (const type of Object.values(c.branches.types)) type.template = '{ticket}-{title_slug}';
    expect(branchFinding(c, 'PROJ-12-add-login')).toBeNull();
    expect(branchFinding(c, 'misc')).toEqual({
      code: 'branch-shape',
      message: "branch misc doesn't follow this team's pattern {ticket}-{title_slug}.",
    });
    expect(branchFinding(c, 'main')).toBeNull();
  });

  it('commit-shape and commit-summary-style', () => {
    const c = config();
    c.tickets.require_ticket = true;
    expect(commitFindings(c, { subject: 'random words here', merge: false })).toEqual([
      {
        code: 'commit-shape',
        message:
          'commit "random words here" doesn\'t follow this team\'s pattern {ticket}: {summary}.',
      },
    ]);
    expect(commitFindings(c, { subject: 'PROJ-1: fix', merge: false })).toEqual([
      {
        code: 'commit-summary-style',
        message:
          'commit "PROJ-1: fix" reads like code, not plain language: it doesn\'t say what changed.',
      },
    ]);
    expect(
      commitFindings(c, {
        subject: 'PROJ-1: show all seasons when both blocks are active',
        merge: false,
      }),
    ).toEqual([]);
  });

  it('skips merge commits and Merge, Revert, fixup and squash subjects', () => {
    const c = config();
    expect(commitFindings(c, { subject: 'anything at all', merge: true })).toEqual([]);
    for (const subject of ['Merge branch x', 'Revert "x"', 'fixup! x', 'squash! x']) {
      expect(commitFindings(c, { subject, merge: false })).toEqual([]);
    }
  });

  it('pr-base, pr-title-shape, pr-labels and pr-ticket-link', () => {
    const c = config();
    c.tickets.require_ticket = true;
    c.pull_requests.labels = ['team'];
    c.pull_requests.link_ticket = true;
    const findings = prFindings(c, 'feature/PROJ-9-add-login', {
      number: 4,
      base: 'develop',
      title: 'Add login',
      labels: [],
      body: 'no link',
    });
    expect(findings).toEqual([
      {
        code: 'pr-base',
        message: `PR ${N} targets develop, but this team sends feature changes to main.`,
      },
      {
        code: 'pr-title-shape',
        message: `PR ${N} title "Add login" doesn't follow this team's pattern {ticket}: {summary}.`,
      },
      { code: 'pr-labels', message: `PR ${N} is missing the labels: team.` },
      { code: 'pr-ticket-link', message: `PR ${N} doesn't link PROJ-9.` },
    ]);
  });

  it('accepts an also_open_against base and a stacked base that matches a type pattern', () => {
    const c = config();
    c.pull_requests.also_open_against = ['qa'];
    const pr = { number: 4, title: 'PROJ-9: let people sign in', labels: [], body: 'PROJ-9' };
    expect(prFindings(c, 'feature/PROJ-9-add-login', { ...pr, base: 'qa' })).toEqual([]);
    expect(
      prFindings(c, 'feature/PROJ-9-add-login', { ...pr, base: 'feature/PROJ-8-parent' }),
    ).toEqual([]);
  });

  it('parses git log records and marks merges', () => {
    expect(parseSubjects('a b\x1fp1\x1e\nMerge x\x1fp1 p2\x1e\n')).toEqual([
      { subject: 'a b', merge: false },
      { subject: 'Merge x', merge: true },
    ]);
  });
});

describe('the end-of-turn check under agents: block and warn', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-wf-findings-'));
    mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const run =
    (branch: string): CommandRunner =>
    async (command, args) => {
      if (command === 'git' && args.includes('--abbrev-ref'))
        return { stdout: branch, exitCode: 0 };
      if (command === 'git' && args.includes('log')) {
        return { stdout: 'just words\x1fp1\x1e\n', exitCode: 0 };
      }
      if (command === 'git') return { stdout: 'abc', exitCode: 0 };
      return { stdout: '', exitCode: 1 };
    };

  it('blocks a shape finding with agents: block', async () => {
    writeFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, 'enforcement.yaml'), 'agents: block\n');
    const outcome = await runDeliveryCapability(root, 'completion', run('misc'));
    expect(outcome.blocking).toBe(true);
    expect(outcome.summary).toContain('🔴 branch misc doesn');
    expect(outcome.summary).toContain('commit "just words"');
  });

  it('does not block with agents: warn', async () => {
    writeFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, 'enforcement.yaml'), 'agents: warn\n');
    const outcome = await runDeliveryCapability(root, 'completion', run('misc'));
    expect(outcome.blocking).toBe(false);
    expect(outcome.summary).toContain('🟡 branch misc doesn');
  });

  it('reports an invalid config once, checks nothing and never blocks', async () => {
    writeFileSync(
      join(root, PATHS.GIT_WORKFLOW_DIR, 'branches.yaml'),
      'types:\n  bugfix:\n    tickets: [nope]\ndefault_type: bugfix\n',
    );
    const outcome = await runDeliveryCapability(root, 'completion', run('misc'));
    expect(outcome.blocking).toBe(false);
    expect(outcome.summary).toContain('has errors, so nothing was checked:');
    expect(outcome.summary).not.toContain('branch misc');
  });

  it('runs nothing when enabled is false', async () => {
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: { ...config(), enforcement: { enabled: false, agents: 'block', people: 'warn' } },
      run: run('misc'),
    });
    expect(result.ran).toBe(false);
  });
});
