import type { ResolvedGitWorkflow } from '@/git-workflow/types.js';
import type { HostProviderResolution, TicketProviderResolution } from '@/providers/registry.js';

export interface DeliveryPlan {
  branch: boolean;
  commit: boolean;
  push: boolean;
  open_pr: boolean;
  ci_gate: boolean;
  ticket_transitions: boolean;
  skipped: string[];
  nudge: string | null;
}

export interface SourceResolution {
  source: string;
  resolution: TicketProviderResolution;
}

const TRACKER_NAMES: Readonly<Record<string, string>> = {
  jira: 'Jira',
  linear: 'Linear',
  servicenow: 'ServiceNow',
  'github-issues': 'GitHub Issues',
  generic: 'your tracker',
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
};

export function trackerName(kind: string): string {
  return TRACKER_NAMES[kind] ?? kind;
}

export function planDelivery(
  config: ResolvedGitWorkflow,
  host: HostProviderResolution,
  tickets: SourceResolution[],
): DeliveryPlan {
  const skipped: string[] = [];

  const push = host.connected;
  const openPr = host.connected;
  const ciGate = host.connected && config.pull_requests.ci.gate !== 'off';
  if (!host.connected) {
    skipped.push('push', 'open PR', 'CI gate');
  }

  const disconnected = tickets.filter((entry) => !entry.resolution.connected);
  const ticketTransitions = tickets.length > 0 && disconnected.length === 0;
  if (disconnected.length > 0) {
    skipped.push(
      ...disconnected.map(
        (entry) =>
          `ticket status moves for ${entry.source} (${trackerName(entry.resolution.kind)})`,
      ),
    );
  }

  const missing: string[] = [];
  if (!host.connected) {
    missing.push(trackerName(host.kind));
  }
  for (const entry of disconnected) {
    const name = trackerName(entry.resolution.kind);
    if (!missing.includes(name)) missing.push(name);
  }

  const nudge =
    missing.length > 0
      ? `Connect ${missing.join(' + ')} (MCP) to activate the skipped delivery steps.`
      : null;

  return {
    branch: true,
    commit: true,
    push,
    open_pr: openPr,
    ci_gate: ciGate,
    ticket_transitions: ticketTransitions,
    skipped,
    nudge,
  };
}
