import type { TicketProviderKind } from '@/core/types/project-profile.js';

/**
 * Issue #42 — the tracker-neutral capability contract. Jira is the first
 * adapter; Linear / GitHub-Issues map their own shapes onto `NormalizedTicket`
 * later. The capability *is* the contract; vendors are adapters behind it.
 */

/** Provider-neutral view of a ticket. The seam every tracker maps onto. */
export interface NormalizedTicket {
  id: string;
  type: string;
  title: string;
  description: string;
  /** Acceptance criteria, one entry per criterion. */
  acceptance_criteria: string[];
  status: string;
  url: string;
}

/** An available status move on a ticket. */
export interface TicketTransition {
  /** Stable id the tracker uses to apply the move. */
  id: string;
  /** Human-readable target status name (e.g. "In Review"). */
  name: string;
}

export interface TicketFieldUpdate {
  description?: string;
  acceptance_criteria?: string[];
}

export interface TicketProvider {
  readonly kind: TicketProviderKind;
  fetchTicket(ref: string): Promise<NormalizedTicket>;
  listTransitions(ref: string): Promise<TicketTransition[]>;
  transition(ref: string, toStatus: string): Promise<void>;
  addComment(ref: string, body: string): Promise<void>;
  updateFields(ref: string, fields: TicketFieldUpdate): Promise<void>;
}
