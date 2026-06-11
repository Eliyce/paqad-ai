import type {
  NormalizedTicket,
  TicketFieldUpdate,
  TicketProvider,
  TicketTransition,
} from './ticket-provider.js';

/**
 * Issue #42 — the Jira adapter. The existing Atlassian MCP already exposes the
 * exact operations the `TicketProvider` contract needs, so this adapter is a
 * thin wrapper, not new transport. MCP invocation happens at the agent layer;
 * the adapter takes an injected `invoke` (tool name + params -> result) so the
 * mapping and normalization are unit-testable without a live MCP.
 */
export type JiraMcpInvoke = (tool: string, params: Record<string, unknown>) => Promise<unknown>;

/** The MCP tool names this adapter maps the contract onto. */
export const JIRA_MCP_TOOLS = {
  fetch: 'getJiraIssue',
  transitions: 'getTransitionsForJiraIssue',
  transition: 'transitionJiraIssue',
  comment: 'addCommentToJiraIssue',
  edit: 'editJiraIssue',
} as const;

export class JiraTicketProvider implements TicketProvider {
  readonly kind = 'jira' as const;

  constructor(
    private readonly invoke: JiraMcpInvoke,
    private readonly cloudId: string = '',
  ) {}

  async fetchTicket(ref: string): Promise<NormalizedTicket> {
    const raw = await this.invoke(JIRA_MCP_TOOLS.fetch, this.params({ issueIdOrKey: ref }));
    return normalizeJiraIssue(raw, ref);
  }

  async listTransitions(ref: string): Promise<TicketTransition[]> {
    const raw = await this.invoke(JIRA_MCP_TOOLS.transitions, this.params({ issueIdOrKey: ref }));
    return normalizeJiraTransitions(raw);
  }

  async transition(ref: string, toStatus: string): Promise<void> {
    const transitions = await this.listTransitions(ref);
    const match = transitions.find((t) => t.name.toLowerCase() === toStatus.toLowerCase());
    if (!match) {
      throw new Error(
        `Jira ticket ${ref} has no transition to "${toStatus}". Available: ${
          transitions.map((t) => t.name).join(', ') || '(none)'
        }.`,
      );
    }
    await this.invoke(
      JIRA_MCP_TOOLS.transition,
      this.params({ issueIdOrKey: ref, transition: { id: match.id } }),
    );
  }

  async addComment(ref: string, body: string): Promise<void> {
    await this.invoke(
      JIRA_MCP_TOOLS.comment,
      this.params({ issueIdOrKey: ref, commentBody: body }),
    );
  }

  async updateFields(ref: string, fields: TicketFieldUpdate): Promise<void> {
    const payload: Record<string, unknown> = {};
    if (fields.description !== undefined) {
      payload.description = fields.description;
    }
    if (fields.acceptance_criteria !== undefined) {
      payload.acceptance_criteria = fields.acceptance_criteria;
    }
    await this.invoke(JIRA_MCP_TOOLS.edit, this.params({ issueIdOrKey: ref, fields: payload }));
  }

  private params(extra: Record<string, unknown>): Record<string, unknown> {
    return this.cloudId ? { cloudId: this.cloudId, ...extra } : extra;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Map a raw Jira issue payload onto the provider-neutral NormalizedTicket. */
export function normalizeJiraIssue(raw: unknown, ref: string): NormalizedTicket {
  const issue = asRecord(raw);
  const fields = asRecord(issue.fields);
  const status = asRecord(fields.status);
  const issuetype = asRecord(fields.issuetype);
  const key = asString(issue.key, ref);
  return {
    id: key,
    type: asString(issuetype.name, 'Task'),
    title: asString(fields.summary),
    description: asString(fields.description),
    acceptance_criteria: extractAcceptanceCriteria(fields.description),
    status: asString(status.name, 'Unknown'),
    url: asString(issue.self) || asString(issue.url),
  };
}

/** Pull `- ` / `* ` bullet lines out of a plaintext description as AC. */
export function extractAcceptanceCriteria(description: unknown): string[] {
  const text = asString(description);
  if (!text) {
    return [];
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ''));
}

export function normalizeJiraTransitions(raw: unknown): TicketTransition[] {
  const payload = asRecord(raw);
  const list = Array.isArray(payload.transitions)
    ? payload.transitions
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
  return list
    .map((entry) => {
      const t = asRecord(entry);
      const to = asRecord(t.to);
      return {
        id: asString(t.id),
        name: asString(t.name) || asString(to.name),
      };
    })
    .filter((t) => t.id !== '' && t.name !== '');
}
