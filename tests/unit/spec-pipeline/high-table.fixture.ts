import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentRole } from '@/core/types/agent.js';
import { qaVerdictsFor } from '../../shared/qa-verdicts.js';

export const ORD_501_REQUEST = 'add CSV export to the orders page';

export const ORD_501_ON_CALL: { role: AgentRole; reason: string }[] = [
  { role: 'security-auditor', reason: 'the export carries customer data out of the app' },
  { role: 'db-expert', reason: 'the export reads every order in one query' },
  { role: 'performance-analyst', reason: 'a large export can stall the orders page' },
];

export const ORD_501_SEATS: AgentRole[] = [
  'security-auditor',
  'db-expert',
  'performance-analyst',
  'product-owner',
  'application-architect',
  'user-flow-writer',
  'qa-engineer',
];

export const ORD_501_FINDINGS: Record<string, string[]> = {
  'security-auditor': ['only staff with the orders role may export', 'customer email stays out'],
  'db-expert': ['read orders in pages of 500', 'no new index is needed'],
  'performance-analyst': ['stream the file instead of building it in memory'],
  'product-owner': ['the export button sits beside the filters', 'the file is named by date'],
  'application-architect': ['reuse the orders query', 'the export runs as a background job'],
  'user-flow-writer': ['the user sees a ready message with a link'],
  'qa-engineer': ['an empty filter exports a header row only', 'a failed export says why'],
};
ORD_501_FINDINGS['security-auditor']!.push('the link expires after one day');

export function seatNote(role: AgentRole, tokens: number, withQuestion = false): unknown {
  return {
    notes: [
      {
        role,
        findings: (ORD_501_FINDINGS[role] ?? ['the orders page']).map((claim, index) => ({
          target: `orders export ${role} ${index + 1}`,
          claim,
        })),
        ...qaVerdictsFor(role),
        ...(withQuestion
          ? {
              questions: [
                {
                  business_text: `Who may download the orders export (${role})?`,
                  why_it_matters: 'It decides who can see customer orders outside the app.',
                  options: ['Only managers', 'Every staff member'],
                  grounded_in: null,
                },
              ],
            }
          : {}),
      },
    ],
    tokens: { [role]: tokens },
  };
}

export interface FixtureUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function writeSeatTranscript(
  dir: string,
  name: string,
  command: string,
  messages: FixtureUsage[],
): string {
  mkdirSync(dir, { recursive: true });
  const lines: string[] = [
    JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: 'seat' } }),
  ];
  messages.forEach((usage, index) => {
    const message = {
      id: `msg_${name}_${index}`,
      model: 'claude-opus-5-5',
      role: 'assistant',
      usage: {
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_read_input_tokens: usage.cacheRead,
        cache_creation_input_tokens: usage.cacheWrite,
        cache_creation: {
          ephemeral_5m_input_tokens: usage.cacheWrite,
          ephemeral_1h_input_tokens: 0,
        },
      },
    };
    const at = `2026-10-19T10:0${index}:00.000Z`;
    lines.push(
      JSON.stringify({
        type: 'assistant',
        timestamp: at,
        message: { ...message, content: [{ type: 'thinking', thinking: 'reading' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: at,
        message: {
          ...message,
          content:
            index === 0
              ? [{ type: 'tool_use', name: 'Bash', input: { command } }]
              : [{ type: 'text', text: 'done' }],
        },
      }),
    );
  });
  const path = join(dir, `agent-${name}.jsonl`);
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
  return path;
}

export function fixtureTotal(messages: FixtureUsage[]): number {
  return messages.reduce(
    (sum, usage) => sum + usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
    0,
  );
}
