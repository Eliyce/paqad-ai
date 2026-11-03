import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolveOpenPrDecision,
  runDeliver,
  runDeliverCommit,
  runTicketDone,
  type DeliverDeps,
} from '@/cli/commands/delivery.js';
import { PATHS } from '@/core/constants/paths.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import { readFeatureDelivery } from '@/feature-evidence/delivery.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import type { HostProvider, OpenPrInput } from '@/providers/host-provider.js';

interface ShellOptions {
  branch?: string | null;
  failOn?: string;
}

function fakeShell(options: ShellOptions = {}): DeliveryShell {
  let branch = options.branch === undefined ? 'main' : options.branch;
  let staged = true;
  return {
    async run(command, args) {
      const out = (stdout: string, exitCode = 0) => ({ stdout, stderr: '', exitCode });
      if (command !== 'git') return out('');
      if (args[0] === options.failOn) return out('', 1);
      if (args[0] === 'rev-parse') return branch === null ? out('', 128) : out(branch);
      if (args[0] === 'diff') return out('', staged ? 1 : 0);
      if (args[0] === 'rev-list') return out('0');
      if (args[0] === 'checkout') branch = args[args.length - 1];
      if (args[0] === 'commit') staged = false;
      return out('');
    },
  };
}

type OpenResult = { ok: boolean; output?: string; remediation?: string; pr?: unknown };

function fakeHost(openResults: OpenResult[] = [], ci: 'green' | 'red' = 'green') {
  const opened: OpenPrInput[] = [];
  const host = {
    kind: 'github' as const,
    async openPR(input: OpenPrInput) {
      opened.push(input);
      return (
        openResults[opened.length - 1] ?? {
          ok: true,
          pr: { number: opened.length, url: `https://x.test/pull/${opened.length}` },
        }
      );
    },
    async getChecksStatus() {
      return { state: ci, checks: [] };
    },
    async comment() {
      return { ok: true };
    },
  } as unknown as HostProvider;
  return { host, opened };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-deliver-fail-'));
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
    shell: fakeShell(),
    host: fakeHost().host,
    resolveOpenPr: () => ({ status: 'resolved', choice: 'yes' }),
    evidenceBody: null,
    ci: { now: () => 0, sleep: async () => {} },
    ...over,
  };
}

describe('deliver: failures along the way', () => {
  it('returns the pause message with exit 2 while the open-PR decision is open', async () => {
    const result = await runDeliver(
      deps({ resolveOpenPr: () => ({ status: 'paused', message: 'waiting' }) }),
    );
    expect(result).toEqual({ exitCode: 2, output: 'waiting' });
  });

  it('stops when the current branch cannot be read', async () => {
    const result = await runDeliver(deps({ shell: fakeShell({ branch: null }) }));
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(
      "Couldn't read the current branch. Check out a branch and re-run.",
    );
  });

  it('stops when the new branch cannot be created', async () => {
    const result = await runDeliver(deps({ shell: fakeShell({ failOn: 'checkout' }) }));
    expect(result.output).toContain('Failed to create branch feature/');
  });

  it('records a failed push on the change and stops', async () => {
    const dir = openFeatureChange(root, 'ses-push', { adapter: 'claude-code', title: 'T' });
    const result = await runDeliver(deps({ shell: fakeShell({ failOn: 'push' }), dirName: dir }));
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(
      'git push failed. Check remote auth and branch protection before retrying.',
    );
    expect(readFeatureDelivery(root, dir).push).toMatchObject({ state: 'failed' });
  });

  it('stops with the host output, the remediation or a fallback when a PR cannot be opened', async () => {
    for (const [failure, text] of [
      [{ ok: false, output: 'label "x" not found\n' }, 'label "x" not found'],
      [{ ok: false, remediation: 'run gh auth login' }, 'run gh auth login'],
      [{ ok: false }, 'gh pr create failed'],
    ] as const) {
      const { host } = fakeHost([failure]);
      const result = await runDeliver(deps({ host }));
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain(`${text} If a label is missing`);
    }
  });

  it('saves the PRs opened before a later target fails', async () => {
    rules('pull-requests.yaml', 'also_open_against: [qa]\n');
    const dir = openFeatureChange(root, 'ses-pr2', { adapter: 'claude-code', title: 'T' });
    const { host } = fakeHost([
      { ok: true, pr: { number: 5, url: 'https://x.test/pull/5' } },
      { ok: false, output: 'boom' },
    ]);
    const result = await runDeliver(deps({ host, dirName: dir }));
    expect(result.exitCode).toBe(1);
    expect(readFeatureDelivery(root, dir).pr).toMatchObject({ number: 5, state: 'open' });
  });

  it('opens a draft when the decision says draft and lists a PR the host gave no details for', async () => {
    const { host, opened } = fakeHost([{ ok: true }]);
    const result = await runDeliver(
      deps({ host, resolveOpenPr: () => ({ status: 'resolved', choice: 'draft' }) }),
    );
    expect(opened[0].draft).toBe(true);
    expect(result.output).toContain('> - 🟢 PR to main\n');
  });

  it('reports red CI as needing attention', async () => {
    const { host } = fakeHost([], 'red');
    const result = await runDeliver(deps({ host }));
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('delivery — Needs your attention');
  });
});

describe('deliver: ticket moves', () => {
  const jiraWithMoves =
    'sources:\n  proj:\n    tracker: jira\n    pattern: "PROJ-\\\\d+"\n    transitions: { on_pr_open: "In Review", on_ci_green: "" }\n';

  it('queues a skipped move without a tracker connection and records it on the change', async () => {
    rules('tickets.yaml', jiraWithMoves);
    const dir = openFeatureChange(root, 'ses-move', { adapter: 'claude-code', title: 'T' });
    const result = await runDeliver(
      deps({
        dirName: dir,
        inputs: { ticket: 'PROJ-7', title: 'T', summary: 'let people sign in' },
        now: () => new Date('2026-01-01T00:00:00Z'),
      }),
    );
    expect(result.output).toContain(
      '> - 🟡 skipped: ticket move to "In Review" (no Jira connection)',
    );
  });

  it('asks to move the ticket by hand when the tracker is connected', async () => {
    rules('tickets.yaml', jiraWithMoves);
    const result = await runDeliver(
      deps({
        inputs: { ticket: 'PROJ-7', title: 'T', summary: 'let people sign in' },
        servers: [{ name: 'atlassian', enabled: true, kind: 'jira' }],
      }),
    );
    expect(result.output).toContain(
      '> - 🟡 ticket: move PROJ-7 to "In Review" with your tracker tool, then run paqad-ai deliver ticket-done on_pr_open',
    );
  });
});

describe('deliver ticket-done: bad input', () => {
  it('refuses an unknown move, both flags, and no active change', () => {
    expect(runTicketDone({ projectRoot: root, dirName: 'x', id: 'later' }).output).toContain(
      "later isn't a ticket move. Use one of:",
    );
    expect(
      runTicketDone({
        projectRoot: root,
        dirName: 'x',
        id: 'on_pr_open',
        failed: 'a',
        skipped: 'b',
      }).output,
    ).toContain('Pass --failed or --skipped, not both.');
    expect(runTicketDone({ projectRoot: root, dirName: null, id: 'on_pr_open' }).output).toContain(
      'No active change in this session',
    );
  });
});

describe('deliver commit: no branch', () => {
  it('commits with no ticket when the branch cannot be read', async () => {
    rules('commits.yaml', 'template: "{summary}"\n');
    const result = await runDeliverCommit({
      projectRoot: root,
      shell: fakeShell({ branch: null }),
      summary: 'let people sign in with email',
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('> - 🟢 let people sign in with email');
  });
});

describe('resolveOpenPrDecision: odd packets', () => {
  function packet(dir: string, name: string, body: unknown): void {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }

  it('ignores a resolved packet with an unknown answer, unreadable packets and other categories', () => {
    packet(PATHS.DECISIONS_RESOLVED_DIR, 'a.json', {
      category: 'delivery.open_pr',
      chosen: 'perhaps',
    });
    packet(PATHS.DECISIONS_RESOLVED_DIR, 'b.json', '{broken');
    packet(PATHS.DECISIONS_RESOLVED_DIR, 'c.json', { category: 'other', chosen: 'yes' });
    packet(PATHS.DECISIONS_RESOLVED_DIR, 'note.txt', 'x');
    expect(resolveOpenPrDecision(root, 'sometimes').status).toBe('paused');
  });

  it('takes a resolved answer in any case', () => {
    packet(PATHS.DECISIONS_RESOLVED_DIR, 'a.json', {
      category: 'delivery.open_pr',
      chosen: ' Draft ',
    });
    expect(resolveOpenPrDecision(root, 'yes')).toEqual({ status: 'resolved', choice: 'draft' });
  });
});
