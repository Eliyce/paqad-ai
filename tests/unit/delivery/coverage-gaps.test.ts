import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { runCiGate } from '@/delivery/ci-gate.js';
import { detectDeliveryHost } from '@/delivery/host.js';
import { renderDelivery } from '@/delivery/templates.js';
import { createDeliveryShell } from '@/delivery/shell.js';
import { defaultGitWorkflow } from '@/git-workflow/defaults.js';
import type { ResolvedCi } from '@/git-workflow/types.js';
import type { ChecksStatus, HostProvider } from '@/providers/host-provider.js';
import { collectDelivery } from '@/dashboard/collectors/delivery.js';

function ci(overrides: Partial<ResolvedCi> = {}): ResolvedCi {
  return {
    gate: 'wait_for_green',
    timeout_minutes: 30,
    on_red: 'stop',
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
    comment: async () => ({ ok: true }),
    getChecksStatus: async () => status,
  };
}

describe('ci-gate — remaining branches', () => {
  it('warn_only on green warns without blocking', async () => {
    const res = await runCiGate(
      hostWith({ state: 'green', checks: [] }),
      'b',
      ci({ gate: 'warn_only' }),
    );
    expect(res.action).toBe('warned');
    expect(res).not.toHaveProperty('transitionTo');
  });
});

describe('host + template fallthrough branches', () => {
  it('detectDeliveryHost returns unknown for an unparseable remote', () => {
    expect(detectDeliveryHost('garbage-no-scheme-or-host')).toBe('unknown');
  });

  it('renderDelivery tolerates a missing ticket', () => {
    const out = renderDelivery(
      defaultGitWorkflow(),
      { ticket: '', title: 'No ticket here', summary: 's' },
      '{ticket}',
    );
    expect(out.pr_body).toBe('');
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
  it('reports unknown band when enforcement.yaml turns delivery help off', () => {
    const root = mkdtempSync(join(tmpdir(), 'delivery-disabled-'));
    try {
      const dir = join(root, PATHS.GIT_WORKFLOW_DIR);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'enforcement.yaml'), 'enabled: false\n', 'utf8');
      const { section, attention } = collectDelivery(root);
      expect(section.band).toBe('unknown');
      expect(section.summary).toContain('Turned off');
      expect(attention).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
