import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classifyRef,
  createIntakeCommand,
  renderTicket,
  runIntakeFetch,
} from '@/cli/commands/intake.js';
import { createProgram } from '@/cli/program.js';
import type { NormalizedTicket } from '@/providers/ticket-provider.js';

describe('paqad-ai intake', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-intake-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const ghPayload = JSON.stringify({
    number: 45,
    title: 'Add retries',
    body: '- returns 200',
    labels: [{ name: 'bug' }],
    state: 'OPEN',
    url: 'https://github.com/o/r/issues/45',
  });

  it('is registered on the program', () => {
    expect(createProgram().commands.map((c) => c.name())).toContain('intake');
  });

  it('classifyRef distinguishes GitHub, Jira, and unknown', () => {
    expect(classifyRef('#45')).toBe('github-issues');
    expect(classifyRef('45')).toBe('github-issues');
    expect(classifyRef('PQD-123')).toBe('jira');
    expect(classifyRef('nonsense')).toBe('unknown');
  });

  it('fetches a GitHub ticket and records the optional ticket_intake stage', async () => {
    const stages: Array<[string, string]> = [];
    const result = await runIntakeFetch('#45', {
      ghInvoke: async () => ghPayload,
      projectRoot: root,
      recordStage: (stage, phase) => stages.push([stage, phase]),
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Add retries');
    expect(result.output).toContain('#45');
    expect(stages).toEqual([
      ['ticket_intake', 'start'],
      ['ticket_intake', 'end'],
    ]);
  });

  it('degrades gracefully when gh fails (absent/unauthenticated)', async () => {
    const result = await runIntakeFetch('#45', {
      ghInvoke: async () => {
        throw new Error('gh: command not found');
      },
      projectRoot: root,
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("couldn't fetch");
    expect(result.output).toContain('gh auth status');
  });

  it('guides Jira refs to the in-session MCP path (exit 0, no fetch)', async () => {
    let called = false;
    const result = await runIntakeFetch('PQD-123', {
      ghInvoke: async () => {
        called = true;
        return '';
      },
      projectRoot: root,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Atlassian MCP');
    expect(called).toBe(false); // Jira never shells gh
  });

  it('rejects an unrecognised ref with a helpful message', async () => {
    const result = await runIntakeFetch('nonsense', {
      ghInvoke: async () => ghPayload,
      projectRoot: root,
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('could not recognise');
  });

  it('the fetch action prints to stdout for a Jira ref (in-session MCP guidance)', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: string) => logs.push(String(l)));
    await createIntakeCommand().parseAsync(['fetch', 'PQD-7', '--project-root', root], {
      from: 'user',
    });
    expect(logs.join('\n')).toContain('Atlassian MCP');
  });

  it('the fetch action reports an unrecognised ref on stderr with a non-zero exit', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    await createIntakeCommand().parseAsync(['fetch', 'not-a-ref', '--project-root', root], {
      from: 'user',
    });
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('could not recognise');
    process.exitCode = undefined;
  });

  afterEach(() => vi.restoreAllMocks());

  it('renderTicket handles a ticket with no acceptance criteria', () => {
    const ticket: NormalizedTicket = {
      id: '#1',
      type: 'Issue',
      title: 'T',
      description: '',
      acceptance_criteria: [],
      status: 'OPEN',
      url: 'u',
    };
    expect(renderTicket(ticket)).toContain('(none detected)');
    expect(renderTicket(ticket)).toContain('(no description)');
  });
});
