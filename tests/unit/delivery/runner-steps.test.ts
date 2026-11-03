import {
  branchPattern,
  commitStep,
  commitsSince,
  compareVersions,
  currentBranch,
  highestVersionBranch,
  linkTicket,
  matchTicketSource,
  pickBranchType,
  planBranch,
  resolveBase,
  type DeliveryShell,
} from '@/delivery/runner.js';
import { defaultGitWorkflow } from '@/git-workflow/defaults.js';
import type { ResolvedGitWorkflow } from '@/git-workflow/types.js';

type Reply = { stdout?: string; stderr?: string; exitCode?: number };

function shellFrom(reply: (args: string[]) => Reply): { shell: DeliveryShell; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    shell: {
      async run(_command, args) {
        calls.push(args);
        const r = reply(args);
        return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode ?? 0 };
      },
    },
  };
}

function config(mutate: (c: ResolvedGitWorkflow) => void = () => {}): ResolvedGitWorkflow {
  const c = defaultGitWorkflow();
  mutate(c);
  return c;
}

const jira = {
  tracker: 'jira' as const,
  pattern: 'PROJ-\\d+',
  server: '',
  transitions: { on_pr_open: '', on_ci_green: '' },
};
const servicenow = {
  tracker: 'servicenow' as const,
  pattern: 'INC\\d{7}',
  server: '',
  transitions: { on_pr_open: '', on_ci_green: '' },
};

describe('delivery runner: ticket sources', () => {
  it('treats a broken source pattern as no match and lists the sources in the stop message', () => {
    const c = config((x) => {
      x.tickets.sources = { bad: { ...jira, pattern: '(' } };
    });
    const result = matchTicketSource(c, 'PROJ-1');
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining(
        "PROJ-1 doesn't look like any ticket this team uses (bad: ()",
      ),
    });
  });
});

describe('delivery runner: branch types', () => {
  const typed = config((x) => {
    x.tickets.sources = { jira, servicenow };
    x.branches.types.feature.tickets = ['jira'];
    x.branches.types.bugfix.tickets = ['servicenow'];
    x.branches.types.feature.ticket_types = ['Story'];
    x.branches.types.bugfix.ticket_types = ['Bug'];
    x.branches.types.hotfix.tickets = ['servicenow'];
  });

  it('uses the default template when the type has none and no prefix for an unknown type', () => {
    expect(branchPattern(typed, 'nope').test('feature/PROJ-1-x')).toBeTypeOf('boolean');
  });

  it('refuses an unknown --type and accepts a known one', () => {
    expect(
      pickBranchType(typed, {
        type: 'chore',
        source: null,
        ticketGiven: false,
        currentBranch: null,
      }),
    ).toEqual({
      ok: false,
      message:
        "There's no branch type called chore. This team's types are: feature, bugfix, hotfix.",
    });
    expect(
      pickBranchType(typed, {
        type: 'bugfix',
        source: null,
        ticketGiven: false,
        currentBranch: null,
      }),
    ).toEqual({ ok: true, value: 'bugfix' });
  });

  it('picks the only type that takes the ticket source, then the ticket type, then the branch', () => {
    expect(
      pickBranchType(typed, { source: 'jira', ticketGiven: true, currentBranch: null }),
    ).toEqual({ ok: true, value: 'feature' });
    expect(
      pickBranchType(typed, {
        source: 'servicenow',
        ticketType: 'Bug',
        ticketGiven: true,
        currentBranch: null,
      }),
    ).toEqual({ ok: true, value: 'bugfix' });
    expect(
      pickBranchType(typed, {
        source: 'servicenow',
        ticketType: 'Task',
        ticketGiven: true,
        currentBranch: 'bugfix/INC0012345-fix',
      }),
    ).toEqual({ ok: true, value: 'bugfix' });
  });

  it('stops naming the types that take the source when the default type does not', () => {
    const result = pickBranchType(typed, {
      source: 'servicenow',
      ticketGiven: true,
      currentBranch: null,
    });
    expect(result).toEqual({
      ok: false,
      message: 'This change could be bugfix, hotfix. Re-run with --type <name>.',
    });
  });

  it('names every type when none takes the source', () => {
    const result = pickBranchType(typed, {
      source: 'linear',
      ticketGiven: true,
      currentBranch: null,
    });
    expect(result).toEqual({
      ok: false,
      message: 'This change could be feature, bugfix, hotfix. Re-run with --type <name>.',
    });
  });

  it('falls back to the default type when no ticket was given', () => {
    expect(
      pickBranchType(typed, { source: 'linear', ticketGiven: false, currentBranch: null }),
    ).toEqual({ ok: true, value: 'feature' });
  });
});

describe('delivery runner: versions and bases', () => {
  it('compares versions by number, by text, and by length', () => {
    expect(compareVersions('1.2', '1.10')).toBeLessThan(0);
    expect(compareVersions('1.2', '1.2.1')).toBe(-1);
    expect(compareVersions('1.2.1', '1.2')).toBe(1);
    expect(compareVersions('1.2-rc', '1.2-beta')).toBe(1);
    expect(compareVersions('1.2-beta', '1.2-rc')).toBe(-1);
    expect(compareVersions('01', '1')).toBe(-1);
    expect(compareVersions('1', '01')).toBe(1);
    expect(compareVersions('1.0', '1.0')).toBe(0);
  });

  it('picks the highest version branch and nothing from an empty list', () => {
    expect(highestVersionBranch(['release/1.9', 'release/1.10', 'release/1.2'])).toBe(
      'release/1.10',
    );
    expect(highestVersionBranch(['a/1.0', 'b/1.0'])).toBe('b/1.0');
    expect(highestVersionBranch([])).toBeNull();
  });

  it('resolves a glob base from ls-remote and stops when origin has no match', async () => {
    const listed = shellFrom(() => ({
      stdout:
        'abc\trefs/heads/release/1.2\nabc\trefs/heads/release/1.10\nabc\trefs/tags/release/9\nlonely\n',
    }));
    expect(await resolveBase(listed.shell, 'release/*')).toEqual({
      ok: true,
      value: 'release/1.10',
    });
    const failed = shellFrom(() => ({ exitCode: 2 }));
    expect(await resolveBase(failed.shell, 'release/*')).toEqual({
      ok: false,
      message: 'No branch on origin matches release/*.',
    });
  });
});

describe('delivery runner: planning the branch', () => {
  const c = config((x) => {
    x.pull_requests.also_open_against = ['release/*'];
  });

  it('stops on a configured base that is not the change base', () => {
    expect(planBranch(c, 'release/2.0', 'main', 'feature/PROJ-1-x', 'feature')).toEqual({
      ok: false,
      message:
        "You're on release/2.0, but this change should start from main. Switch to main and re-run paqad-ai deliver.",
    });
  });

  it('names the default template for an unknown type on an off-pattern branch', () => {
    const result = planBranch(c, 'scratch', 'main', 'feature/PROJ-1-x', 'nope');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain(c.branches.template);
  });
});

describe('delivery runner: commits', () => {
  it('reads no current branch from a detached HEAD or a failed git call', async () => {
    expect(await currentBranch(shellFrom(() => ({ stdout: 'HEAD\n' })).shell)).toBeNull();
    expect(await currentBranch(shellFrom(() => ({ stdout: '', exitCode: 128 })).shell)).toBeNull();
  });

  it('counts commits from origin when the local base is missing, and zero when both fail', async () => {
    const viaOrigin = shellFrom((args) =>
      args[2] === 'main..HEAD' ? { exitCode: 128 } : { stdout: '3\n' },
    );
    expect(await commitsSince(viaOrigin.shell, 'main')).toBe(3);
    expect(await commitsSince(shellFrom(() => ({ stdout: 'x' })).shell, 'main')).toBe(0);
    expect(await commitsSince(shellFrom(() => ({ exitCode: 128 })).shell, 'main')).toBe(0);
  });

  it('signs off when configured and reports git commit failures with the output', async () => {
    const c = config((x) => {
      x.commits.sign_off = true;
      x.commits.template = '{summary}';
    });
    const failing = shellFrom((args) =>
      args[0] === 'diff' ? { exitCode: 1 } : { stdout: 'hook said no\n', exitCode: 1 },
    );
    const result = await commitStep(failing.shell, c, 'Add the list', {
      base: 'main',
      branch: 'feature/x',
      requireWork: true,
    });
    expect(failing.calls[1]).toEqual(['commit', '-s', '-m', 'Add the list']);
    expect(result).toEqual({
      ok: false,
      message: 'git commit failed: hook said no. Fix it and re-run; do not skip pre-commit hooks.',
    });
    const silent = shellFrom((args) => (args[0] === 'diff' ? { exitCode: 1 } : { exitCode: 1 }));
    const unknown = await commitStep(silent.shell, c, 'Add the list', {
      base: 'main',
      branch: 'feature/x',
      requireWork: true,
    });
    expect(!unknown.ok && unknown.message).toContain('git commit failed: unknown error.');
  });

  it('asks to stage when nothing is staged and work is not required', async () => {
    const result = await commitStep(shellFrom(() => ({})).shell, config(), 'x', {
      base: 'main',
      branch: 'feature/x',
      requireWork: false,
    });
    expect(result).toEqual({
      ok: false,
      message: 'Nothing is staged. Stage your changes with git add first.',
    });
  });

  it('passes with earlier commits and stops naming the base when there are none', async () => {
    const withCommits = shellFrom((args) => (args[0] === 'rev-list' ? { stdout: '2' } : {}));
    expect(
      await commitStep(withCommits.shell, config(), 'x', {
        base: 'main',
        branch: 'feature/x',
        requireWork: true,
      }),
    ).toEqual({ ok: true, value: { committed: false, output: '', warnings: [] } });
    expect(
      await commitStep(shellFrom(() => ({})).shell, config(), 'x', {
        base: null,
        branch: 'feature/x',
        requireWork: true,
      }),
    ).toEqual({
      ok: false,
      message: 'Nothing to deliver: no staged changes and no commits on feature/x since the base.',
    });
  });
});

describe('delivery runner: linking the ticket', () => {
  const github = {
    name: 'github',
    source: { ...jira, tracker: 'github-issues' as const, pattern: '#\\d+' },
  };

  it('closes a GitHub issue with or without the leading hash', () => {
    expect(linkTicket('Body', '#12', github, true)).toBe('Body\n\nCloses #12\n');
    expect(linkTicket('', '12', github, true)).toBe('Closes #12\n');
  });

  it('leaves the body alone when the link line is already there or linking is off', () => {
    expect(linkTicket('Ticket: PROJ\n', 'PROJ', null, true)).toBe('Ticket: PROJ\n');
    expect(linkTicket('Closes #12', '12', github, true)).toBe('Closes #12');
    expect(linkTicket('Body', 'PROJ-1', null, false)).toBe('Body');
    expect(linkTicket('Body', '  ', null, true)).toBe('Body');
  });
});
