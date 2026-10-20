import type { ResolvedDeliveryProcess } from '@/core/types/delivery-policy.js';

import type { HostProviderResolution, TicketProviderResolution } from '@/providers/registry.js';

export interface DeliveryPlan {
  branch: boolean;
  commit: boolean;
  push: boolean;
  open_pr: boolean;
  ci_gate: boolean;
  ticket_transitions: boolean;
  ticket_comments: boolean;
  skipped: string[];
  nudge: string | null;
}

export function planDelivery(
  process: ResolvedDeliveryProcess,
  host: HostProviderResolution,
  ticket: TicketProviderResolution,
): DeliveryPlan {
  const skipped: string[] = [];

  const branch = true;
  const commit = true;

  const push = host.connected;
  const openPr = host.connected;
  const ciGate = host.connected && process.ci.gate !== 'off';
  if (!host.connected) {
    skipped.push('push', 'open PR', 'CI gate');
  }

  const ticketTransitions = ticket.connected;
  const ticketComments = ticket.connected && process.ticket.comment_decisions;
  if (!ticket.connected) {
    skipped.push('ticket status transitions', 'decision comments');
  }

  const missing: string[] = [];
  if (!host.connected) {
    missing.push(host.kind === 'github' ? 'GitHub' : host.kind);
  }
  if (!ticket.connected) {
    missing.push(ticket.kind === 'jira' ? 'Jira' : ticket.kind);
  }

  const nudge =
    missing.length > 0
      ? `Connect ${missing.join(' + ')} (MCP) to activate the skipped delivery steps.`
      : null;

  return {
    branch,
    commit,
    push,
    open_pr: openPr,
    ci_gate: ciGate,
    ticket_transitions: ticketTransitions,
    ticket_comments: ticketComments,
    skipped,
    nudge,
  };
}
