import { afterEach, describe, expect, it } from 'vitest';

import { resolveOpenPrDecision } from '@/cli/commands/delivery.js';
import { listEarlierTitles } from '@/decisions/earlier-answers.js';
import { applyResolvedDecisions } from '@/duplication/decisions.js';
import type { DuplicationFinding } from '@/duplication/types.js';
import { collectFeatureDecisions } from '@/feature-evidence/decisions-index.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import { findDecisionPrecedents } from '@/planning/decision-precedents.js';
import { DecisionStore } from '@/planning/decision-store.js';

import { TempProject, resolvedPacket } from './fixtures.js';

const NOW = new Date('2026-07-01T00:00:00.000Z');
const projects: TempProject[] = [];

afterEach(() => {
  while (projects.length > 0) projects.pop()!.dispose();
});

const finding = {
  file: 'src/a.ts',
  line_range: { start: 3, end: 9 },
  matched_file: 'src/b.ts',
  similarity: 0.9,
} as unknown as DuplicationFinding;

function packets(): DecisionPacket[] {
  return [
    resolvedPacket({ decision_id: 'D-1' }),
    resolvedPacket({
      decision_id: 'D-2',
      category: 'create-vs-reuse',
      context: 'dup [paqad-duplication src/a.ts:3:src/b.ts]',
    }),
    {
      ...resolvedPacket({ decision_id: 'D-3', category: 'delivery.open_pr' }),
      chosen: 'yes',
    } as DecisionPacket,
  ];
}

function project(tagged: boolean): TempProject {
  const p = new TempProject('paqad-rd-readers-');
  projects.push(p);
  for (const packet of packets()) {
    p.writeResolved(
      tagged
        ? {
            ...packet,
            rules_discovery: {
              status: 'absorbed',
              run_id: 'rd-20261101-100000',
              rule_id: 'RL-1a2b',
              tagged_at: NOW.toISOString(),
            },
          }
        : packet,
    );
  }
  return p;
}

function readAll(root: string): unknown {
  const pending = resolvedPacket({
    decision_id: 'D-01M73AE41TYA4MJPNJZS30HMPF',
    status: 'pending',
    human_response: undefined,
    task_session_id: 'task-9',
    options: [
      {
        option_key: 'boundary',
        label: 'Use the route boundary',
        one_line_preview: 'If you pick this, input is checked at the route.',
        trade_off: 'You give up: one schema per route.',
        evidence: {},
      },
      {
        option_key: 'service',
        label: 'Keep checks in services',
        one_line_preview: 'If you pick this, each service checks input.',
        trade_off: 'You give up: one place to look.',
        evidence: {},
      },
    ],
  });
  const store = new DecisionStore(root);
  store.writePending(pending);
  const auto = store.readPending('D-01M73AE41TYA4MJPNJZS30HMPF');
  const result = {
    precedents: findDecisionPrecedents(root, {
      category: 'architecture-path',
      question: 'Where should request bodies be validated?',
    }),
    earlier: listEarlierTitles(root, { category: 'architecture-path', now: NOW }),
    duplication: applyResolvedDecisions(root, [finding]),
    featureIndex: collectFeatureDecisions(root, 'feat-1-x-01M73AE41TYA4MJPNJZS30HMPE'),
    delivery: resolveOpenPrDecision(root, 'no'),
    autoAnswer: { precedents: auto?.precedents, earlier_check: auto?.earlier_check },
  };
  return JSON.parse(JSON.stringify(result).split(root).join('<root>'));
}

describe('AC-44 INV-5 decision readers ignore the rules_discovery tag', () => {
  it('AC-44 gives identical results for tagged and untagged resolved decisions', () => {
    const plain = readAll(project(false).root);
    const tagged = readAll(project(true).root);
    expect(tagged).toEqual(plain);
    expect((plain as { precedents: unknown[] }).precedents.length).toBeGreaterThan(0);
    expect((plain as { duplication: unknown[] }).duplication).toHaveLength(1);
    expect((plain as { delivery: { status: string } }).delivery.status).toBe('resolved');
  });
});
