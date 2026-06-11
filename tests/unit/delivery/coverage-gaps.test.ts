import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { runCiGate } from '@/delivery/ci-gate.js';
import { planDelivery } from '@/delivery/degradation.js';
import { detectBranchTemplate } from '@/delivery/detection.js';
import { readDetection } from '@/delivery/detection-store.js';
import { buildConnectNudge, gatherGitSnapshot } from '@/delivery/detect-run.js';
import { detectDelivery } from '@/delivery/detection.js';
import { detectDeliveryHost } from '@/delivery/host.js';
import { renderDelivery, resolveConventionalType } from '@/delivery/templates.js';
import { createDeliveryShell } from '@/delivery/shell.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import type { ResolvedDeliveryCi } from '@/core/types/delivery-policy.js';
import type { ChecksStatus, HostProvider } from '@/providers/host-provider.js';
import { defaultDeliveryProcess } from '@/pipeline/delivery-policy.js';
import { collectDelivery } from '@/dashboard/collectors/delivery.js';

function ci(overrides: Partial<ResolvedDeliveryCi> = {}): ResolvedDeliveryCi {
  return {
    maintained: 'auto',
    gate: 'wait_for_green',
    timeout_minutes: 30,
    on_red: 'stop',
    transition_on_green: 'Done',
    ...overrides,
  };
}

function hostWith(status: ChecksStatus): HostProvider {
  return {
    kind: 'github',
    ensureBranch: async () => ({ ok: true }),
    commit: async () => ({ ok: true }),
    push: async () => ({ ok: true }),
    openPR: async () => ({ ok: true }),
    getChecksStatus: async () => status,
  };
}

describe('ci-gate — remaining branches', () => {
  it('warn_only on green carries the transition', async () => {
    const res = await runCiGate(
      hostWith({ state: 'green', checks: [] }),
      'b',
      ci({ gate: 'warn_only' }),
    );
    expect(res.action).toBe('warned');
    expect(res.transitionTo).toBe('Done');
  });

  it('an empty transition_on_green resolves to null on a pass', async () => {
    const res = await runCiGate(
      hostWith({ state: 'green', checks: [] }),
      'b',
      ci({ transition_on_green: '' }),
    );
    expect(res.action).toBe('passed');
    expect(res.transitionTo).toBe(null);
  });
});

describe('degradation — non-default provider kinds', () => {
  it('labels a non-github host and non-jira tracker by kind in the nudge', () => {
    const plan = planDelivery(
      defaultDeliveryProcess(),
      { kind: 'gitlab', connected: false },
      { kind: 'linear', server: null, connected: false },
    );
    expect(plan.nudge).toContain('gitlab');
    expect(plan.nudge).toContain('linear');
  });
});

describe('detection — no recognisable branch pattern', () => {
  it('returns null when feature branches match neither typed nor ticket-first', () => {
    const d = detectBranchTemplate({
      remoteUrl: null,
      defaultBranch: null,
      branchNames: ['main', 'wip', 'scratchpad', 'tmp'],
      recentCommitSubjects: [],
    });
    expect(d).toBe(null);
  });
});

describe('detection-store — corrupt artifact', () => {
  it('returns null when the artifact is unparseable', () => {
    const root = mkdtempSync(join(tmpdir(), 'detect-store-'));
    try {
      mkdirSync(join(root, '.paqad'), { recursive: true });
      writeFileSync(join(root, PATHS.DELIVERY_DETECTION), '{ not json', 'utf8');
      expect(readDetection(root)).toBe(null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('gatherGitSnapshot — failing git', () => {
  it('degrades to an empty snapshot when every git call fails', async () => {
    const failing: DeliveryShell = {
      async run() {
        return { stdout: '', stderr: 'fatal: not a git repo', exitCode: 1 };
      },
    };
    const snap = await gatherGitSnapshot(failing);
    expect(snap).toEqual({
      remoteUrl: null,
      defaultBranch: null,
      branchNames: [],
      recentCommitSubjects: [],
    });
  });

  it('treats exit-zero-but-empty stdout as no remote/default branch', async () => {
    const empty: DeliveryShell = {
      async run() {
        return { stdout: '   ', stderr: '', exitCode: 0 };
      },
    };
    const snap = await gatherGitSnapshot(empty);
    expect(snap.remoteUrl).toBe(null);
    expect(snap.defaultBranch).toBe(null);
  });
});

describe('host + template fallthrough branches', () => {
  it('detectDeliveryHost returns unknown for an unparseable remote', () => {
    expect(detectDeliveryHost('garbage-no-scheme-or-host')).toBe('unknown');
  });

  it('resolveConventionalType falls back to feat when type_map has no default', () => {
    expect(resolveConventionalType('Spike', { Story: 'feat' })).toBe('feat');
  });

  it('renderDelivery tolerates a missing ticket', () => {
    const out = renderDelivery(
      defaultDeliveryProcess(),
      { ticket: '', title: 'No ticket here', summary: 's' },
      '{ticket}',
    );
    expect(out.pr_body).toBe('');
  });
});

describe('buildConnectNudge — non-github host', () => {
  it('names the detected host kind verbatim when it is not github', () => {
    const nudge = buildConnectNudge(
      detectDelivery({
        remoteUrl: 'https://gitlab.com/o/r.git',
        defaultBranch: null,
        branchNames: [],
        recentCommitSubjects: [],
      }),
    );
    expect(nudge).toContain('gitlab');
  });
});

describe('createDeliveryShell — production shell', () => {
  it('captures stdout + zero exit for a real command', async () => {
    const shell = createDeliveryShell(process.cwd());
    const res = await shell.run('node', ['-e', 'process.stdout.write("hi")']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('hi');
  });

  it('returns a non-zero exit (never throws) for a failing command', async () => {
    const shell = createDeliveryShell(process.cwd());
    const res = await shell.run('node', ['-e', 'process.exit(3)']);
    expect(res.exitCode).toBe(3);
  });
});

describe('delivery dashboard — disabled policy', () => {
  it('reports unknown band when delivery-policy disables the feature', () => {
    const root = mkdtempSync(join(tmpdir(), 'delivery-disabled-'));
    try {
      const dir = join(root, PATHS.WORKFLOWS_DIR);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'delivery-policy.yaml'),
        'schema_version: "1"\nenabled: false\n',
        'utf8',
      );
      const { section, attention } = collectDelivery(root);
      expect(section.band).toBe('unknown');
      expect(section.summary).toContain('Disabled');
      expect(attention).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
