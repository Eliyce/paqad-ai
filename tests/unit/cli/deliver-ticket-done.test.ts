import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDeliver, runTicketDone, type DeliverDeps } from '@/cli/commands/delivery.js';
import { PATHS } from '@/core/constants/paths.js';
import { pendingMoveFindings } from '@/delivery/delivery-check.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import { readFeatureDelivery } from '@/feature-evidence/delivery.js';
import { openFeatureChange, recordChangeConstants } from '@/feature-evidence/stage-ledger.js';
import type { ChecksState, HostProvider } from '@/providers/host-provider.js';

function fakeShell(): DeliveryShell {
  const git = { branch: 'main', staged: true, ahead: 0 };
  return {
    async run(command, args) {
      const out = (stdout: string, exitCode = 0) => ({ stdout, stderr: '', exitCode });
      if (command !== 'git') return out('');
      if (args[0] === 'rev-parse') return out(git.branch);
      if (args[0] === 'diff') return out('', git.staged ? 1 : 0);
      if (args[0] === 'rev-list') return out(String(git.ahead));
      if (args[0] === 'ls-remote') return out('');
      if (args[0] === 'checkout') git.branch = args[args.length - 1];
      if (args[0] === 'commit') {
        git.staged = false;
        git.ahead += 1;
      }
      return out('');
    },
  };
}

function fakeHost(state: ChecksState = 'green'): HostProvider {
  return {
    kind: 'github',
    async openPR() {
      return { ok: true, pr: { number: 7, url: 'https://x.test/pull/7' } };
    },
    async getChecksStatus() {
      return { state, checks: [] };
    },
    async comment() {
      return { ok: true };
    },
  } as unknown as HostProvider;
}

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-ticket-moves-'));
  mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
  writeFileSync(
    join(root, PATHS.GIT_WORKFLOW_DIR, 'tickets.yaml'),
    [
      'sources:',
      '  proj:',
      '    tracker: jira',
      '    pattern: "PROJ-\\\\d+"',
      '    transitions: { on_pr_open: "In Review", on_ci_green: "Ready to merge" }',
      '',
    ].join('\n'),
  );
  dir = openFeatureChange(root, 'ses-moves', { adapter: 'claude-code', title: 'T' });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function deps(over: Partial<DeliverDeps> = {}): DeliverDeps {
  return {
    projectRoot: root,
    dryRun: false,
    inputs: { ticket: 'PROJ-123', title: 'Add login', summary: 'let people sign in with email' },
    draft: false,
    reviewers: [],
    labels: [],
    shell: fakeShell(),
    host: fakeHost(),
    resolveOpenPr: () => ({ status: 'resolved', choice: 'yes' }),
    evidenceBody: null,
    ci: { now: () => 0, sleep: async () => {} },
    dirName: dir,
    servers: [{ name: 'atlassian', kind: 'jira', enabled: true }],
    now: () => new Date('2026-11-02T10:00:00.000Z'),
    ...over,
  };
}

describe('deliver queues ticket moves (AC-ticket-moves)', () => {
  it('queues on_pr_open and on_ci_green as pending and prints the agent line for each', async () => {
    const result = await runDeliver(deps());
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(
      '> - 🟡 ticket: move PROJ-123 to "In Review" with your tracker tool, then run paqad-ai deliver ticket-done on_pr_open',
    );
    expect(result.output).toContain(
      '> - 🟡 ticket: move PROJ-123 to "Ready to merge" with your tracker tool, then run paqad-ai deliver ticket-done on_ci_green',
    );
    expect(readFeatureDelivery(root, dir).ticket_actions).toEqual([
      {
        id: 'on_pr_open',
        ticket: 'PROJ-123',
        source: 'proj',
        to: 'In Review',
        state: 'pending',
        reason: null,
        at: null,
      },
      expect.objectContaining({ id: 'on_ci_green', to: 'Ready to merge', state: 'pending' }),
    ]);
  });

  it('queues no on_ci_green move when CI is not green', async () => {
    await runDeliver(deps({ host: fakeHost('red') }));
    expect(readFeatureDelivery(root, dir).ticket_actions?.map((a) => a.id)).toEqual(['on_pr_open']);
  });

  it('records the move as skipped when no tracker is connected, and shows the nudge', async () => {
    const result = await runDeliver(deps({ servers: [] }));
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain('with your tracker tool');
    expect(result.output).toContain('Connect Jira (MCP)');
    const actions = readFeatureDelivery(root, dir).ticket_actions ?? [];
    expect(actions.map((a) => [a.id, a.state, a.reason])).toEqual([
      ['on_pr_open', 'skipped', 'no Jira connection'],
      ['on_ci_green', 'skipped', 'no Jira connection'],
    ]);
  });

  it('queues nothing when a transition is empty or no ticket was given', async () => {
    await runDeliver(deps({ inputs: { ticket: '', title: 'T', summary: 'let people sign in' } }));
    expect(readFeatureDelivery(root, dir).ticket_actions).toBeUndefined();
  });
});

describe('paqad-ai deliver ticket-done', () => {
  it('settles a move as done, failed or skipped with the time and reason', async () => {
    await runDeliver(deps());
    const at = () => new Date('2026-11-02T11:00:00.000Z');
    const done = runTicketDone({ projectRoot: root, dirName: dir, id: 'on_pr_open', now: at });
    expect(done.exitCode).toBe(0);
    const failed = runTicketDone({
      projectRoot: root,
      dirName: dir,
      id: 'on_ci_green',
      failed: 'no such status',
      now: at,
    });
    expect(failed.output).toContain('failed (no such status)');
    const actions = readFeatureDelivery(root, dir).ticket_actions ?? [];
    expect(actions.map((a) => [a.id, a.state, a.reason, a.at])).toEqual([
      ['on_pr_open', 'done', null, '2026-11-02T11:00:00.000Z'],
      ['on_ci_green', 'failed', 'no such status', '2026-11-02T11:00:00.000Z'],
    ]);
    runTicketDone({ projectRoot: root, dirName: dir, id: 'on_pr_open', skipped: 'moved by hand' });
    expect(readFeatureDelivery(root, dir).ticket_actions?.[0]).toMatchObject({
      state: 'skipped',
      reason: 'moved by hand',
    });
  });

  it('exits 1 for an unknown id, a move never queued, both flags, or no change', () => {
    expect(runTicketDone({ projectRoot: root, dirName: dir, id: 'on_merge' }).exitCode).toBe(1);
    expect(runTicketDone({ projectRoot: root, dirName: dir, id: 'on_pr_open' }).output).toContain(
      'No ticket move on_pr_open is queued',
    );
    expect(
      runTicketDone({
        projectRoot: root,
        dirName: dir,
        id: 'on_pr_open',
        failed: 'a',
        skipped: 'b',
      }).exitCode,
    ).toBe(1);
    expect(runTicketDone({ projectRoot: root, dirName: null, id: 'on_pr_open' }).exitCode).toBe(1);
  });
});

describe('a pending move never blocks and shows as yellow at the end of the turn', () => {
  it('reports ticket-move-pending until the move is settled', async () => {
    recordChangeConstants(root, dir, { branch: 'feature/PROJ-123-add-login' });
    await runDeliver(deps());
    expect(pendingMoveFindings(root, 'feature/PROJ-123-add-login')).toEqual([
      { code: 'ticket-move-pending', message: 'ticket move to "In Review" not confirmed' },
      { code: 'ticket-move-pending', message: 'ticket move to "Ready to merge" not confirmed' },
    ]);
    runTicketDone({ projectRoot: root, dirName: dir, id: 'on_pr_open' });
    runTicketDone({ projectRoot: root, dirName: dir, id: 'on_ci_green' });
    expect(pendingMoveFindings(root, 'feature/PROJ-123-add-login')).toEqual([]);
  });
});
