import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  NO_PLACEHOLDER_MESSAGE,
  TURNED_OFF_MESSAGE,
  runDeliver,
  runDeliverCommit,
  type DeliverDeps,
} from '@/cli/commands/delivery.js';
import { PATHS } from '@/core/constants/paths.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import { readFeatureDelivery } from '@/feature-evidence/delivery.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import type { HostProvider, OpenPrInput } from '@/providers/host-provider.js';

interface FakeGit {
  branch: string;
  staged: boolean;
  ahead: number;
  heads: string[];
}

function fakeShell(state: Partial<FakeGit> = {}) {
  const git: FakeGit = { branch: 'main', staged: true, ahead: 0, heads: [], ...state };
  const calls: string[][] = [];
  const shell: DeliveryShell = {
    async run(command, args) {
      calls.push([command, ...args]);
      const out = (stdout: string, exitCode = 0) => ({ stdout, stderr: '', exitCode });
      if (command !== 'git') return out('');
      if (args[0] === 'rev-parse') return out(git.branch);
      if (args[0] === 'diff') return out('', git.staged ? 1 : 0);
      if (args[0] === 'rev-list') return out(String(git.ahead));
      if (args[0] === 'ls-remote') {
        return out(git.heads.map((head, i) => `${i}abc\trefs/heads/${head}`).join('\n'));
      }
      if (args[0] === 'checkout') git.branch = args[args.length - 1];
      if (args[0] === 'commit') {
        git.staged = false;
        git.ahead += 1;
      }
      return out('');
    },
  };
  return { shell, calls, git };
}

function fakeHost() {
  const opened: OpenPrInput[] = [];
  const host = {
    kind: 'github' as const,
    async openPR(input: OpenPrInput) {
      opened.push(input);
      return {
        ok: true,
        pr: { number: opened.length, url: `https://x.test/pull/${opened.length}` },
      };
    },
    async getChecksStatus() {
      return { state: 'green' as const, checks: [] };
    },
    async comment() {
      return { ok: true };
    },
  } as unknown as HostProvider;
  return { host, opened };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-deliver-steps-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function rules(file: string, text: string): void {
  mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
  writeFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, file), text);
}

function deps(over: Partial<DeliverDeps> = {}): DeliverDeps {
  return {
    projectRoot: root,
    dryRun: false,
    inputs: { ticket: '', title: 'Add login', summary: 'let people sign in with email' },
    draft: false,
    reviewers: [],
    labels: [],
    shell: fakeShell().shell,
    host: fakeHost().host,
    resolveOpenPr: () => ({ status: 'resolved', choice: 'yes' }),
    evidenceBody: null,
    ci: { now: () => 0, sleep: async () => {} },
    ...over,
  };
}

describe('deliver step 1: config', () => {
  it('exits 0 with the turned-off message and runs nothing when enabled is false (AC-36)', async () => {
    rules('enforcement.yaml', 'enabled: false\n');
    const { shell, calls } = fakeShell();
    const result = await runDeliver(deps({ shell }));
    expect(result).toEqual({ exitCode: 0, output: TURNED_OFF_MESSAGE });
    expect(calls).toEqual([]);
  });

  it('stops with exit 1 and lists the errors for an invalid config, never using defaults', async () => {
    rules('branches.yaml', 'types:\n  bugfix:\n    tickets: [nope]\ndefault_type: bugfix\n');
    const { shell, calls } = fakeShell();
    const result = await runDeliver(deps({ shell }));
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('types.bugfix.tickets');
    expect(calls).toEqual([]);
  });
});

describe('deliver steps 2 to 4: ticket and type', () => {
  it('stops before any git command when a ticket is required and missing', async () => {
    rules(
      'tickets.yaml',
      'require_ticket: true\nsources:\n  proj: { tracker: jira, pattern: "PROJ-\\\\d+" }\n',
    );
    const { shell, calls } = fakeShell();
    const result = await runDeliver(deps({ shell }));
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(
      "This team's git workflow needs a ticket for every change. Re-run with --ticket <ref>.",
    );
    expect(calls).toEqual([]);
  });

  it('stops when the ticket matches no source', async () => {
    rules('tickets.yaml', 'sources:\n  proj: { tracker: jira, pattern: "PROJ-\\\\d+" }\n');
    const result = await runDeliver(
      deps({ inputs: { ticket: 'ABC-1', title: 'T', summary: 'let people sign in' } }),
    );
    expect(result.output).toContain(
      "ABC-1 doesn't look like any ticket this team uses (proj: PROJ-\\d+). Check the key or add a source in .paqad/configs/git-workflow/tickets.yaml.",
    );
  });

  it('picks bugfix for a ServiceNow ticket used only by bugfix, with no --type', async () => {
    rules('tickets.yaml', 'sources:\n  servicenow: { tracker: servicenow }\n');
    rules(
      'branches.yaml',
      'types:\n  feature: {}\n  bugfix: { tickets: [servicenow] }\ndefault_type: feature\n',
    );
    const result = await runDeliver(
      deps({
        dryRun: true,
        inputs: { ticket: 'INC0012345', title: 'Fix crash', summary: 'stop the app crashing' },
      }),
    );
    expect(result.output).toContain('> type:    bugfix');
    expect(result.output).toContain('> branch:  bugfix/INC0012345-fix-crash');
  });

  it('asks for --type when two types allow the ticket', async () => {
    rules(
      'tickets.yaml',
      'sources:\n  inc: { tracker: servicenow }\n  proj: { tracker: jira, pattern: "PROJ-\\\\d+" }\n',
    );
    rules(
      'branches.yaml',
      'types:\n  feature: { tickets: [proj] }\n  bugfix: { tickets: [inc] }\n  hotfix: { tickets: [inc] }\ndefault_type: feature\n',
    );
    const result = await runDeliver(
      deps({ inputs: { ticket: 'INC0012345', title: 'T', summary: 'stop the app crashing' } }),
    );
    expect(result.output).toContain(
      'This change could be bugfix, hotfix. Re-run with --type <name>.',
    );
    const unknown = await runDeliver(deps({ type: 'chore' }));
    expect(unknown.output).toContain(
      "There's no branch type called chore. This team's types are: feature, bugfix, hotfix.",
    );
  });
});

describe('deliver steps 5 and 6: base and branch', () => {
  it('cuts the branch from develop and targets develop with no --base', async () => {
    rules('branches.yaml', 'base_branch: develop\n');
    const { shell, calls } = fakeShell({ branch: 'develop' });
    const { host, opened } = fakeHost();
    const result = await runDeliver(deps({ shell, host }));
    expect(result.exitCode).toBe(0);
    expect(calls).toContainEqual(['git', 'checkout', '-b', 'feature/add-login']);
    expect(opened[0].base).toBe('develop');
  });

  it('resolves release/* to the highest version on origin', async () => {
    rules('branches.yaml', 'base_branch: "release/*"\n');
    const { shell } = fakeShell({
      branch: 'release/1.10.1',
      heads: ['release/1.9', 'release/1.10', 'release/1.10.1'],
    });
    const { host, opened } = fakeHost();
    await runDeliver(deps({ shell, host }));
    expect(opened[0].base).toBe('release/1.10.1');
  });

  it('stops when no remote branch matches the glob', async () => {
    rules('branches.yaml', 'base_branch: "release/*"\n');
    const result = await runDeliver(deps({ shell: fakeShell({ heads: [] }).shell }));
    expect(result.output).toContain('No branch on origin matches release/*.');
  });

  it('keeps a stacked branch and opens the PR against the parent --base', async () => {
    const { shell, calls } = fakeShell({ branch: 'feature/add-login' });
    const { host, opened } = fakeHost();
    const result = await runDeliver(deps({ shell, host, base: 'feature/parent-work' }));
    expect(result.exitCode).toBe(0);
    expect(calls.some((c) => c[1] === 'checkout')).toBe(false);
    expect(opened[0].base).toBe('feature/parent-work');
  });

  it('stops on another configured base, and on a branch outside the pattern', async () => {
    rules('pull-requests.yaml', 'also_open_against: [qa]\n');
    const onQa = await runDeliver(deps({ shell: fakeShell({ branch: 'qa' }).shell }));
    expect(onQa.output).toContain(
      "You're on qa, but this change should start from main. Switch to main and re-run paqad-ai deliver.",
    );
    const odd = await runDeliver(deps({ shell: fakeShell({ branch: 'misc' }).shell }));
    expect(odd.output).toContain(
      "You're on misc, which doesn't follow this team's branch pattern {prefix}/{ticket}-{title_slug}. Switch to main or rename the branch, then re-run paqad-ai deliver.",
    );
  });
});

describe('deliver step 7: commit', () => {
  it('signs off when sign_off is true', async () => {
    rules('commits.yaml', 'sign_off: true\n');
    const { shell, calls } = fakeShell();
    await runDeliver(deps({ shell }));
    expect(calls.find((c) => c[1] === 'commit')).toEqual([
      'git',
      'commit',
      '-s',
      '-m',
      'let people sign in with email',
    ]);
  });

  it('stops on a code-like summary under agents: block', async () => {
    const result = await runDeliver(
      deps({ inputs: { ticket: '', title: 'T', summary: 'fix parseConfig in load.ts' } }),
    );
    expect(result.output).toContain(
      'commit "fix parseConfig in load.ts" reads like code, not plain language: it names a file.',
    );
  });

  it('stops when nothing is staged and nothing was committed', async () => {
    const result = await runDeliver(deps({ shell: fakeShell({ staged: false }).shell }));
    expect(result.output).toContain(
      'Nothing to deliver: no staged changes and no commits on feature/add-login since main.',
    );
  });

  it('deliver commit uses the rendered message, and deliver then skips its own commit', async () => {
    const fake = fakeShell({ branch: 'feature/add-login' });
    const committed = await runDeliverCommit({
      projectRoot: root,
      shell: fake.shell,
      summary: 'let people sign in with email',
    });
    expect(committed.exitCode).toBe(0);
    expect(fake.calls.find((c) => c[1] === 'commit')).toEqual([
      'git',
      'commit',
      '-m',
      'let people sign in with email',
    ]);
    const again = await runDeliverCommit({
      projectRoot: root,
      shell: fake.shell,
      summary: 'x y z',
    });
    expect(again.output).toContain('Nothing is staged. Stage your changes with git add first.');
    const before = fake.calls.filter((c) => c[1] === 'commit').length;
    const result = await runDeliver(deps({ shell: fake.shell }));
    expect(result.exitCode).toBe(0);
    expect(fake.calls.filter((c) => c[1] === 'commit').length).toBe(before);
  });
});

describe('deliver step 9: the pull request', () => {
  it('opens a draft from the file, applies every label and reviewer once, and a second PR to qa', async () => {
    rules(
      'pull-requests.yaml',
      'draft: true\nlabels: [team]\nreviewers: [alice]\nalso_open_against: [qa]\n',
    );
    rules('branches.yaml', 'types:\n  feature: { labels: [feature, team] }\n');
    const dir = openFeatureChange(root, 'ses-pr', { adapter: 'claude-code', title: 'T' });
    const { host, opened } = fakeHost();
    const result = await runDeliver(
      deps({ host, dirName: dir, labels: ['urgent', 'team'], reviewers: ['bob', 'alice'] }),
    );
    expect(result.exitCode).toBe(0);
    expect(opened.map((pr) => pr.base)).toEqual(['main', 'qa']);
    expect(opened[0]).toMatchObject({
      draft: true,
      labels: ['team', 'feature', 'urgent'],
      reviewers: ['alice', 'bob'],
    });
    const record = readFeatureDelivery(root, dir);
    expect(record.pr).toMatchObject({ number: 1 });
    expect(record.extra_prs).toEqual([expect.objectContaining({ number: 2, draft: true })]);
  });

  it('links a GitHub issue with Closes and anything else with Ticket:, never twice', async () => {
    rules(
      'tickets.yaml',
      'sources:\n  gh: { tracker: github-issues }\n  proj: { tracker: jira, pattern: "PROJ-\\\\d+" }\n',
    );
    mkdirSync(join(root, '.paqad/templates'), { recursive: true });
    writeFileSync(join(root, '.paqad/templates/pr-body.md'), '## Summary\n{summary}\n');
    const run = async (ticket: string) => {
      const { host, opened } = fakeHost();
      await runDeliver(
        deps({ host, inputs: { ticket, title: 'T', summary: 'let people sign in' } }),
      );
      return opened[0].body;
    };
    const issue = '#' + '42';
    expect((await run(issue)).match(/Closes/g)).toHaveLength(1);
    expect(await run(issue)).toContain(issue);
    expect(await run('PROJ-7')).toContain('\nTicket: PROJ-7\n');
  });

  it('stops when the PR template has no placeholders and no --body-file is given', async () => {
    mkdirSync(join(root, '.paqad/templates'), { recursive: true });
    writeFileSync(join(root, '.paqad/templates/pr-body.md'), '## What\n\n## Why\n');
    const result = await runDeliver(deps());
    expect(result.output).toContain(NO_PLACEHOLDER_MESSAGE);
  });

  it('warns per missing heading in --body-file, and stops under agents: block', async () => {
    mkdirSync(join(root, '.paqad/templates'), { recursive: true });
    writeFileSync(join(root, '.paqad/templates/pr-body.md'), '## What\n\n## Why\n');
    writeFileSync(join(root, 'body.md'), '## What\nSign in by email.\n');
    const blocked = await runDeliver(deps({ bodyFile: 'body.md' }));
    expect(blocked.exitCode).toBe(1);
    expect(blocked.output).toContain('The PR body is missing the template heading "## Why".');
    rules('enforcement.yaml', 'agents: warn\n');
    const warned = await runDeliver(deps({ bodyFile: 'body.md' }));
    expect(warned.exitCode).toBe(0);
    expect(warned.output).toContain('🟡 The PR body is missing the template heading "## Why".');
  });

  it('names the real trackers in the planDelivery nudge', async () => {
    rules('tickets.yaml', 'sources:\n  inc: { tracker: servicenow }\n');
    const result = await runDeliver(
      deps({ inputs: { ticket: 'INC0012345', title: 'T', summary: 'stop the app crashing' } }),
    );
    expect(result.output).toContain(
      'Connect ServiceNow (MCP) to activate the skipped delivery steps.',
    );
    expect(result.output).not.toContain('Jira');
  });

  it('skips push and PR when the host is not connected, and says so', async () => {
    const { host, opened } = fakeHost();
    const result = await runDeliver(deps({ host, hostConnected: false }));
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('push and PR skipped');
    expect(opened).toEqual([]);
  });
});
