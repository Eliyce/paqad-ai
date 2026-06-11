import { planDelivery } from '@/delivery/degradation.js';
import { defaultDeliveryProcess } from '@/pipeline/delivery-policy.js';
import type { HostProviderResolution, TicketProviderResolution } from '@/providers/registry.js';

const host = (connected: boolean): HostProviderResolution => ({ kind: 'github', connected });
const ticket = (connected: boolean): TicketProviderResolution => ({
  kind: 'jira',
  server: connected ? 'atlassian' : null,
  connected,
});

describe('graceful degradation planner', () => {
  it('runs everything when both providers are connected', () => {
    const plan = planDelivery(defaultDeliveryProcess(), host(true), ticket(true));
    expect(plan).toMatchObject({
      branch: true,
      commit: true,
      push: true,
      open_pr: true,
      ci_gate: true,
      ticket_transitions: true,
      ticket_comments: true,
    });
    expect(plan.skipped).toEqual([]);
    expect(plan.nudge).toBe(null);
  });

  it('git-only steps always run even with no providers; the rest are skipped + nudged', () => {
    const plan = planDelivery(defaultDeliveryProcess(), host(false), ticket(false));
    expect(plan.branch).toBe(true);
    expect(plan.commit).toBe(true);
    expect(plan.push).toBe(false);
    expect(plan.open_pr).toBe(false);
    expect(plan.ci_gate).toBe(false);
    expect(plan.ticket_transitions).toBe(false);
    expect(plan.skipped).toContain('push');
    expect(plan.skipped).toContain('ticket status transitions');
    expect(plan.nudge).toContain('GitHub');
    expect(plan.nudge).toContain('Jira');
  });

  it('host connected but tracker dormant: PR runs, ticket steps skipped', () => {
    const plan = planDelivery(defaultDeliveryProcess(), host(true), ticket(false));
    expect(plan.open_pr).toBe(true);
    expect(plan.ci_gate).toBe(true);
    expect(plan.ticket_transitions).toBe(false);
    expect(plan.nudge).toContain('Jira');
    expect(plan.nudge).not.toContain('GitHub');
  });

  it('does not list the CI gate as skipped when it is intentionally off', () => {
    const process = defaultDeliveryProcess();
    process.ci.gate = 'off';
    const plan = planDelivery(process, host(true), ticket(true));
    expect(plan.ci_gate).toBe(false);
    expect(plan.skipped).not.toContain('CI gate');
  });
});
