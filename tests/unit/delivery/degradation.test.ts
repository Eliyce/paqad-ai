import { planDelivery, type SourceResolution } from '@/delivery/degradation.js';
import { defaultGitWorkflow } from '@/git-workflow/defaults.js';
import type { HostProviderResolution } from '@/providers/registry.js';

const host = (connected: boolean): HostProviderResolution => ({ kind: 'github', connected });
const source = (
  name: string,
  kind: SourceResolution['resolution']['kind'],
  connected: boolean,
) => ({
  source: name,
  resolution: { kind, server: connected ? 'mcp' : null, connected },
});

describe('graceful degradation planner', () => {
  it('runs everything when the host and every ticket source are connected', () => {
    const plan = planDelivery(defaultGitWorkflow(), host(true), [source('proj', 'jira', true)]);
    expect(plan).toMatchObject({
      branch: true,
      commit: true,
      push: true,
      open_pr: true,
      ci_gate: true,
      ticket_transitions: true,
    });
    expect(plan).not.toHaveProperty('ticket_comments');
    expect(plan.skipped).toEqual([]);
    expect(plan.nudge).toBe(null);
  });

  it('git-only steps always run with no providers; the rest are skipped and nudged', () => {
    const plan = planDelivery(defaultGitWorkflow(), host(false), [source('proj', 'jira', false)]);
    expect(plan.branch).toBe(true);
    expect(plan.commit).toBe(true);
    expect(plan.push).toBe(false);
    expect(plan.open_pr).toBe(false);
    expect(plan.ticket_transitions).toBe(false);
    expect(plan.skipped).toContain('push');
    expect(plan.skipped).toContain('ticket status moves for proj (Jira)');
    expect(plan.nudge).toBe('Connect GitHub + Jira (MCP) to activate the skipped delivery steps.');
  });

  it('names the real trackers of every disconnected source, never always Jira', () => {
    const plan = planDelivery(defaultGitWorkflow(), host(true), [
      source('inc', 'servicenow', false),
      source('lin', 'linear', false),
      source('gh', 'github-issues', true),
    ]);
    expect(plan.nudge).toBe(
      'Connect ServiceNow + Linear (MCP) to activate the skipped delivery steps.',
    );
    expect(plan.ticket_transitions).toBe(false);
  });

  it('a team without ticket sources has no ticket moves and no tracker nudge', () => {
    const plan = planDelivery(defaultGitWorkflow(), host(true), []);
    expect(plan.ticket_transitions).toBe(false);
    expect(plan.nudge).toBe(null);
  });

  it('does not list the CI gate as skipped when it is intentionally off', () => {
    const config = defaultGitWorkflow();
    config.pull_requests.ci.gate = 'off';
    const plan = planDelivery(config, host(true), [source('proj', 'jira', true)]);
    expect(plan.ci_gate).toBe(false);
    expect(plan.skipped).not.toContain('CI gate');
  });
});
