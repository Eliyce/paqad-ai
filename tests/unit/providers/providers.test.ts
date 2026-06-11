import type { DeliveryShell } from '@/delivery/runner.js';
import {
  GithubHostProvider,
  parsePrUrl,
  normalizeCheckState,
  aggregate,
} from '@/providers/github-host-provider.js';
import {
  JiraTicketProvider,
  JIRA_MCP_TOOLS,
  normalizeJiraIssue,
  normalizeJiraTransitions,
  extractAcceptanceCriteria,
} from '@/providers/jira-ticket-provider.js';
import { resolveTicketProvider, resolveHostProvider } from '@/providers/registry.js';
import { defaultDeliveryProcess } from '@/pipeline/delivery-policy.js';
import type { ProjectMcpServer } from '@/core/types/project-profile.js';

/** A shell that records calls and returns scripted results per command. */
function fakeShell(
  responses: Record<string, { stdout?: string; stderr?: string; exitCode: number }>,
): { shell: DeliveryShell; calls: string[][] } {
  const calls: string[][] = [];
  const shell: DeliveryShell = {
    async run(command, args) {
      calls.push([command, ...args]);
      const key = `${command} ${args[0] ?? ''} ${args[1] ?? ''}`.trim();
      const r = responses[key] ?? responses[`${command} ${args[0] ?? ''}`] ?? { exitCode: 0 };
      return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode };
    },
  };
  return { shell, calls };
}

describe('GithubHostProvider', () => {
  it('cuts the branch from the configured base', async () => {
    const { shell, calls } = fakeShell({});
    const provider = new GithubHostProvider(shell);
    const res = await provider.ensureBranch('feat/x', 'develop');
    expect(res.ok).toBe(true);
    expect(calls[0]).toEqual(['git', 'checkout', '-b', 'feat/x', 'develop']);
  });

  it('returns remediation when push fails', async () => {
    const { shell } = fakeShell({ 'git push': { exitCode: 1, stderr: 'denied' } });
    const provider = new GithubHostProvider(shell);
    const res = await provider.push('feat/x');
    expect(res.ok).toBe(false);
    expect(res.remediation).toContain('git push failed');
  });

  it('parses the PR number from gh stdout', async () => {
    const { shell } = fakeShell({
      'gh pr': { exitCode: 0, stdout: 'https://github.com/o/r/pull/123\n' },
    });
    const provider = new GithubHostProvider(shell);
    const res = await provider.openPR({
      title: 't',
      body: 'b',
      base: 'main',
      head: 'feat/x',
      draft: false,
      reviewers: [],
      labels: [],
    });
    expect(res.ok).toBe(true);
    expect(res.pr?.number).toBe(123);
  });

  it('reads check status from gh json even on non-zero exit (pending)', async () => {
    const { shell } = fakeShell({
      'gh pr': {
        exitCode: 1,
        stdout: JSON.stringify([
          { name: 'build', state: 'SUCCESS' },
          { name: 'test', state: 'IN_PROGRESS' },
        ]),
      },
    });
    const provider = new GithubHostProvider(shell);
    const status = await provider.getChecksStatus('feat/x');
    expect(status.state).toBe('pending');
    expect(status.checks).toHaveLength(2);
  });
});

describe('check-state helpers', () => {
  it('normalizes gh states', () => {
    expect(normalizeCheckState('SUCCESS')).toBe('green');
    expect(normalizeCheckState('failure')).toBe('red');
    expect(normalizeCheckState('IN_PROGRESS')).toBe('pending');
    expect(normalizeCheckState('weird')).toBe('unknown');
  });

  it('aggregates: red dominates, then pending, then green', () => {
    expect(aggregate(['green', 'red', 'pending'])).toBe('red');
    expect(aggregate(['green', 'pending'])).toBe('pending');
    expect(aggregate(['green', 'green'])).toBe('green');
    expect(aggregate([])).toBe('unknown');
  });

  it('parsePrUrl handles bare urls', () => {
    expect(parsePrUrl('https://github.com/o/r/pull/7').number).toBe(7);
    expect(parsePrUrl('no url here').number).toBe(null);
  });
});

describe('JiraTicketProvider', () => {
  it('maps contract calls onto the right MCP tools and normalizes the issue', async () => {
    const seen: { tool: string; params: Record<string, unknown> }[] = [];
    const invoke = async (tool: string, params: Record<string, unknown>) => {
      seen.push({ tool, params });
      if (tool === JIRA_MCP_TOOLS.fetch) {
        return {
          key: 'PQD-42',
          fields: {
            summary: 'Add export',
            description: 'Do it.\n- Exports CSV\n- Downloadable',
            status: { name: 'To Do' },
            issuetype: { name: 'Story' },
          },
        };
      }
      return {};
    };
    const provider = new JiraTicketProvider(invoke, 'cloud-1');
    const ticket = await provider.fetchTicket('PQD-42');
    expect(ticket.id).toBe('PQD-42');
    expect(ticket.type).toBe('Story');
    expect(ticket.acceptance_criteria).toEqual(['Exports CSV', 'Downloadable']);
    expect(seen[0].tool).toBe(JIRA_MCP_TOOLS.fetch);
    expect(seen[0].params.cloudId).toBe('cloud-1');
  });

  it('resolves transition names to ids and errors when missing', async () => {
    const invoke = async (tool: string) => {
      if (tool === JIRA_MCP_TOOLS.transitions) {
        return { transitions: [{ id: '31', name: 'In Review' }] };
      }
      return {};
    };
    const provider = new JiraTicketProvider(invoke);
    await expect(provider.transition('PQD-1', 'In Review')).resolves.toBeUndefined();
    await expect(provider.transition('PQD-1', 'Nope')).rejects.toThrow('no transition');
  });

  it('normalizes transitions from both top-level and nested shapes', () => {
    expect(normalizeJiraTransitions({ transitions: [{ id: '1', name: 'Done' }] })).toEqual([
      { id: '1', name: 'Done' },
    ]);
    expect(normalizeJiraTransitions([{ id: '2', to: { name: 'Review' } }])).toEqual([
      { id: '2', name: 'Review' },
    ]);
  });

  it('extracts acceptance criteria from bullet lines', () => {
    expect(extractAcceptanceCriteria('intro\n- one\n* two\nnot a bullet')).toEqual(['one', 'two']);
    expect(extractAcceptanceCriteria(undefined)).toEqual([]);
  });

  it('normalizeJiraIssue is defensive about missing fields', () => {
    const t = normalizeJiraIssue({}, 'X-1');
    expect(t.id).toBe('X-1');
    expect(t.type).toBe('Task');
    expect(t.status).toBe('Unknown');
  });
});

describe('provider registry', () => {
  const ticket = defaultDeliveryProcess().ticket;
  const host = defaultDeliveryProcess().host;

  it('finds the first enabled MCP server of the configured kind', () => {
    const servers: ProjectMcpServer[] = [
      { name: 'old-jira', enabled: false, kind: 'jira' },
      { name: 'atlassian', enabled: true, kind: 'jira' },
    ];
    const res = resolveTicketProvider(servers, ticket);
    expect(res.connected).toBe(true);
    expect(res.server).toBe('atlassian');
  });

  it('is not connected when no server of the kind is enabled', () => {
    const res = resolveTicketProvider(
      [{ name: 'gh', enabled: true, kind: 'github-issues' }],
      ticket,
    );
    expect(res.connected).toBe(false);
    expect(res.server).toBe(null);
  });

  it('honors an explicit server name', () => {
    const res = resolveTicketProvider([{ name: 'my-jira', enabled: true, kind: 'jira' }], {
      ...ticket,
      server: 'my-jira',
    });
    expect(res.server).toBe('my-jira');
  });

  it('host connection requires both CLI and a matching remote', () => {
    expect(resolveHostProvider(host, { remoteHost: 'github', cliAvailable: true }).connected).toBe(
      true,
    );
    expect(resolveHostProvider(host, { remoteHost: 'gitlab', cliAvailable: true }).connected).toBe(
      false,
    );
    expect(resolveHostProvider(host, { remoteHost: 'github', cliAvailable: false }).connected).toBe(
      false,
    );
    expect(resolveHostProvider(host, { remoteHost: null, cliAvailable: true }).connected).toBe(
      false,
    );
  });
});
