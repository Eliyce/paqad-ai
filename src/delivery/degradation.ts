import type { ResolvedDeliveryProcess } from '@/core/types/delivery-policy.js';

import type { HostProviderResolution, TicketProviderResolution } from '@/providers/registry.js';

/**
 * Issue #42 — graceful degradation. When a ticket runs and a required provider
 * isn't connected, the delivery stage does NOT stop: it does what's possible
 * (git-only branch/commit always run), skips the provider-bound steps, and
 * re-surfaces the connect nudge. This planner is the pure decision layer the
 * runtime consults before executing the stage.
 */
export interface DeliveryPlan {
  branch: boolean;
  commit: boolean;
  push: boolean;
  open_pr: boolean;
  ci_gate: boolean;
  ticket_transitions: boolean;
  ticket_comments: boolean;
  /** Human-readable list of capabilities skipped because a provider is dormant. */
  skipped: string[];
  /** One combined nudge, or null when everything required is connected. */
  nudge: string | null;
}

export function planDelivery(
  process: ResolvedDeliveryProcess,
  host: HostProviderResolution,
  ticket: TicketProviderResolution,
): DeliveryPlan {
  const skipped: string[] = [];

  // Git-only steps are always available.
  const branch = true;
  const commit = true;

  // Host-bound steps.
  const push = host.connected;
  const openPr = host.connected;
  const ciGate = host.connected && process.ci.gate !== 'off';
  if (!host.connected) {
    skipped.push('push', 'open PR', 'CI gate');
  } else if (process.ci.gate === 'off') {
    // CI gate intentionally off — not a degradation, don't report it as skipped.
  }

  // Tracker-bound steps.
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
