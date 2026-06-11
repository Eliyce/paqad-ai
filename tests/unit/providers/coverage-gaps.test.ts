import {
  JiraTicketProvider,
  JIRA_MCP_TOOLS,
  normalizeJiraIssue,
} from '@/providers/jira-ticket-provider.js';
import { resolveTicketProvider } from '@/providers/registry.js';
import { defaultDeliveryProcess } from '@/pipeline/delivery-policy.js';
import { generateDeliveryPolicy } from '@/onboarding/delivery-policy-generator.js';

describe('JiraTicketProvider — comment, updateFields, no cloudId', () => {
  it('addComment posts the body via the comment tool', async () => {
    const seen: { tool: string; params: Record<string, unknown> }[] = [];
    const provider = new JiraTicketProvider(async (tool, params) => {
      seen.push({ tool, params });
      return {};
    });
    await provider.addComment('PQD-1', 'hello');
    expect(seen[0].tool).toBe(JIRA_MCP_TOOLS.comment);
    expect(seen[0].params.commentBody).toBe('hello');
    // no cloudId configured → params omit it
    expect('cloudId' in seen[0].params).toBe(false);
  });

  it('updateFields only sends provided fields', async () => {
    const seen: Record<string, unknown>[] = [];
    const provider = new JiraTicketProvider(async (_tool, params) => {
      seen.push(params);
      return {};
    });
    await provider.updateFields('PQD-1', { description: 'new desc' });
    expect((seen[0].fields as Record<string, unknown>).description).toBe('new desc');
    expect('acceptance_criteria' in (seen[0].fields as Record<string, unknown>)).toBe(false);

    await provider.updateFields('PQD-1', { acceptance_criteria: ['a', 'b'] });
    expect((seen[1].fields as Record<string, unknown>).acceptance_criteria).toEqual(['a', 'b']);
  });

  it('normalizeJiraIssue falls back to the url field when self is absent', () => {
    const t = normalizeJiraIssue({ url: 'https://j/PQD-9' }, 'PQD-9');
    expect(t.url).toBe('https://j/PQD-9');
  });
});

describe('registry — explicit server that is not enabled', () => {
  it('is not connected when the named server is absent', () => {
    const ticket = { ...defaultDeliveryProcess().ticket, server: 'missing-server' };
    const res = resolveTicketProvider([{ name: 'other', enabled: true, kind: 'jira' }], ticket);
    expect(res.connected).toBe(false);
    expect(res.server).toBe(null);
  });
});

describe('onboard delivery-policy generator', () => {
  it('writes the policy + pr-body template for the coding domain', () => {
    const files = generateDeliveryPolicy('coding');
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.path.endsWith('delivery-policy.yaml'))).toBe(true);
    expect(files.some((f) => f.path.endsWith('pr-body.md'))).toBe(true);
    expect(files.every((f) => f.autoUpdate === false)).toBe(true);
  });

  it('writes nothing for the content domain', () => {
    expect(generateDeliveryPolicy('content')).toEqual([]);
  });
});
