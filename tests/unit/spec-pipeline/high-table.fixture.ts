// Shared fixtures for the High Table tests (issue #639, Part 13). Values follow the issue's
// made-up ORD-501 change: a full-lane CSV export of the orders page, seven seats (the four
// standing experts plus security, database and performance).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentRole } from '@/core/types/agent.js';

export const ORD_501_REQUEST = 'add CSV export to the orders page';

/** The three on-call experts the detector names for ORD-501. */
export const ORD_501_ON_CALL: { role: AgentRole; reason: string }[] = [
  { role: 'security-auditor', reason: 'the export carries customer data out of the app' },
  { role: 'db-expert', reason: 'the export reads every order in one query' },
  { role: 'performance-analyst', reason: 'a large export can stall the orders page' },
];

/** The seven seats in the order `experts record` seats them (detector picks, then standing). */
export const ORD_501_SEATS: AgentRole[] = [
  'security-auditor',
  'db-expert',
  'performance-analyst',
  'product-owner',
  'application-architect',
  'user-flow-writer',
  'qa-engineer',
];

/** ORD-501's 13 findings across the seven seats. */
export const ORD_501_FINDINGS: Record<string, string[]> = {
  'security-auditor': ['only staff with the orders role may export', 'customer email stays out'],
  'db-expert': ['read orders in pages of 500', 'no new index is needed'],
  'performance-analyst': ['stream the file instead of building it in memory'],
  'product-owner': ['the export button sits beside the filters', 'the file is named by date'],
  'application-architect': ['reuse the orders query', 'the export runs as a background job'],
  'user-flow-writer': ['the user sees a ready message with a link'],
  'qa-engineer': ['an empty filter exports a header row only', 'a failed export says why'],
  // 2 + 2 + 1 + 2 + 2 + 1 + 2 = 12; the 13th lands on security below.
};
ORD_501_FINDINGS['security-auditor']!.push('the link expires after one day');

/** A one-role notes artifact, as a High Table seat writes it. */
export function seatNote(role: AgentRole, tokens: number, withQuestion = false): unknown {
  return {
    notes: [
      {
        role,
        // Each finding names its own target, so no two seats clash in the merge.
        findings: (ORD_501_FINDINGS[role] ?? ['the orders page']).map((claim, index) => ({
          target: `orders export ${role} ${index + 1}`,
          claim,
        })),
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

/** One usage figure for a fixture subagent message. */
export interface FixtureUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Write a fixture subagent transcript in Claude Code's shape: the prompt, a Bash tool call that
 * runs `experts brief <role>` (or `experts context` for the chief), and assistant messages whose
 * usage repeats over two lines per message id, as the host writes it.
 */
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

/** The exact token total a fixture transcript carries (each message counted once). */
export function fixtureTotal(messages: FixtureUsage[]): number {
  return messages.reduce(
    (sum, usage) => sum + usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
    0,
  );
}
