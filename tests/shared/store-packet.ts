import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  answerPendingDecision,
  createPendingDecision,
  resolvePendingDecision,
} from '@/decisions/authoring.js';
import type { DecisionOption, DecisionPacket } from '@/planning/decision-packet.js';

export function storeOptions(keys: readonly string[]): DecisionOption[] {
  return keys.map((key) => ({
    option_key: key,
    label: `Use option ${key}`,
    one_line_preview: `If you pick this, we use ${key}.`,
    trade_off: 'You give up: the other.',
    evidence: {},
  }));
}

export function pendingStorePacket(overrides: Partial<DecisionPacket> = {}): DecisionPacket {
  return {
    decision_id: 'D-01J0000000000000000000ZZZZ',
    fingerprint: 'sha256:store',
    category: 'component-reuse',
    question: 'Which shape should this take',
    context: 'Store shape',
    options: storeOptions(['a', 'b']),
    confidence: 1,
    requested_by: 'test',
    task_session_id: 'store-task',
    created_at: '2026-06-01T00:00:00.000Z',
    status: 'pending',
    ttl_until: '2999-01-01T00:00:00.000Z',
    invalidation_watch: [],
    ...overrides,
  };
}

export function keepAnswerAsRule(projectRoot: string, id: string, chosen: string): void {
  answerPendingDecision(projectRoot, id, chosen, '', { always: true });
  rmSync(join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, `${id}.json`));
}

export function seedUnrelatedAnswer(projectRoot: string): string {
  const { id } = createPendingDecision(projectRoot, {
    category: 'ux-pattern',
    title: 'Zebra quilt marmalade telescope harbour lantern',
    context: 'An earlier answer with no shared words.',
    options: [
      { option_key: 'x', label: 'X' },
      { option_key: 'y', label: 'Y' },
    ],
  });
  resolvePendingDecision(projectRoot, id, 'x', 'Earlier reason');
  return id;
}

export function pendingPacketFiles(projectRoot: string): Record<string, unknown>[] {
  const dir = join(projectRoot, PATHS.DECISIONS_PENDING_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>);
}
