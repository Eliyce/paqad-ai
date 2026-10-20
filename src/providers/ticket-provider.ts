import type { TicketProviderKind } from '@/core/types/project-profile.js';

export interface NormalizedTicket {
  id: string;
  type: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  status: string;
  url: string;
}

export interface TicketTransition {
  id: string;
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
