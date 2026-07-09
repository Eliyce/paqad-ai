import { extractAcceptanceCriteria } from './jira-ticket-provider.js';
import type { NormalizedTicket, TicketProvider, TicketTransition } from './ticket-provider.js';

/**
 * Issue #322 — the GitHub Issues adapter. The `gh` CLI already exposes the read
 * the `TicketProvider` contract needs, so this adapter is a thin wrapper over
 * `gh issue view <n> --json ...`, not new transport. The `gh` invocation is
 * injected (args -> stdout JSON string) so the mapping/normalization is
 * unit-testable without a live `gh`.
 *
 * Read-only today: intake only fetches. Write operations (transition/comment/
 * updateFields) are the delivery half (#323) and are left unsupported here so an
 * accidental call fails loud rather than silently no-ops.
 */
export type GhInvoke = (args: string[]) => Promise<string>;

/** The `--json` fields the fetch requests (mapped onto NormalizedTicket). */
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
    // GitHub issues have only open/closed, driven at delivery, not intake.
    return Promise.resolve([]);
  }

  transition(): Promise<void> {
    return Promise.reject(new Error('GithubIssuesTicketProvider is read-only (intake, #322).'));
  }

  addComment(): Promise<void> {
    return Promise.reject(new Error('GithubIssuesTicketProvider is read-only (intake, #322).'));
  }

  updateFields(): Promise<void> {
    return Promise.reject(new Error('GithubIssuesTicketProvider is read-only (intake, #322).'));
  }
}

/** Strip a leading `#` (and a `GH-`/`gh-` prefix) so `gh issue view` gets a bare number. */
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

/** Map a raw `gh issue view --json` payload onto the provider-neutral NormalizedTicket. */
export function normalizeGithubIssue(raw: unknown, ref: string): NormalizedTicket {
  const issue = asRecord(raw);
  const number = typeof issue.number === 'number' ? issue.number : normalizeIssueNumber(ref);
  const labels = Array.isArray(issue.labels)
    ? issue.labels.map((label) => asString(asRecord(label).name)).filter((name) => name !== '')
    : [];
  return {
    id: `#${number}`,
    // GitHub issues carry no native type; a `type:` / `kind:` label is the closest
    // signal, else the generic "Issue".
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
