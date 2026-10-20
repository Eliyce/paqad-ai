import { extractAcceptanceCriteria } from './jira-ticket-provider.js';
import type { NormalizedTicket, TicketProvider, TicketTransition } from './ticket-provider.js';

export type GhInvoke = (args: string[]) => Promise<string>;

export const GITHUB_ISSUE_JSON_FIELDS = ['number', 'title', 'body', 'labels', 'state', 'url'];

export class GithubIssuesTicketProvider implements TicketProvider {
  readonly kind = 'github-issues' as const;

  constructor(private readonly invoke: GhInvoke) {}

  async fetchTicket(ref: string): Promise<NormalizedTicket> {
    const number = normalizeIssueNumber(ref);
    const stdout = await this.invoke([
      'issue',
      'view',
      number,
      '--json',
      GITHUB_ISSUE_JSON_FIELDS.join(','),
    ]);
    return normalizeGithubIssue(parseJson(stdout), ref);
  }

  listTransitions(): Promise<TicketTransition[]> {
    return Promise.resolve([]);
  }

  transition(): Promise<void> {
    return Promise.reject(new Error('GithubIssuesTicketProvider is read-only (intake only).'));
  }

  addComment(): Promise<void> {
    return Promise.reject(new Error('GithubIssuesTicketProvider is read-only (intake only).'));
  }

  updateFields(): Promise<void> {
    return Promise.reject(new Error('GithubIssuesTicketProvider is read-only (intake only).'));
  }
}

export function normalizeIssueNumber(ref: string): string {
  return ref.trim().replace(/^#/, '').replace(/^gh-/i, '');
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function normalizeGithubIssue(raw: unknown, ref: string): NormalizedTicket {
  const issue = asRecord(raw);
  const number = typeof issue.number === 'number' ? issue.number : normalizeIssueNumber(ref);
  const labels = Array.isArray(issue.labels)
    ? issue.labels.map((label) => asString(asRecord(label).name)).filter((name) => name !== '')
    : [];
  return {
    id: `#${number}`,
    type:
      labels
        .find((name) => /^(type|kind):/i.test(name))
        ?.replace(/^[^:]+:/, '')
        .trim() || 'Issue',
    title: asString(issue.title),
    description: asString(issue.body),
    acceptance_criteria: extractAcceptanceCriteria(issue.body),
    status: asString(issue.state, 'OPEN'),
    url: asString(issue.url),
  };
}
