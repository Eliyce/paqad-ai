import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import {
  PRECEDENT_BLOCK_HEADING,
  findDecisionPrecedents,
  formatDecisionPrecedents,
  scorePrecedent,
} from '@/planning/decision-precedents.js';
import { DecisionStore } from '@/planning/decision-store.js';

function resolvedPacket(
  partial: Partial<DecisionPacket> & { decision_id: string },
): DecisionPacket {
  return {
    decision_id: partial.decision_id,
    fingerprint: `sha256:${partial.decision_id}`,
    category: 'create-vs-reuse',
    question: 'Reuse the existing parser or write a new one?',
    context: 'parser work',
    options: [
      {
        option_key: 'reuse',
        label: 'Reuse the existing parser',
        one_line_preview: 'reuse',
        trade_off: 'less control',
        evidence: {},
      },
      {
        option_key: 'new',
        label: 'Write a new parser',
        one_line_preview: 'new',
        trade_off: 'more code',
        evidence: {},
      },
    ],
    confidence: 0.8,
    requested_by: 'engine',
    task_session_id: 'task-1',
    created_at: '2026-06-27T00:00:00.000Z',
    status: 'resolved',
    ttl_until: '2026-12-31T00:00:00.000Z',
    invalidation_watch: [],
    human_response: {
      chosen_option_key: 'reuse',
      intent: 'explicit',
      explanation_rounds_used: 0,
      responded_at: '2026-06-27T01:00:00.000Z',
      responded_by: 'human',
      carry_over_scope: 'task',
      note: 'the existing parser is fine',
    },
    ...partial,
  };
}

describe('scorePrecedent', () => {
  it('scores a same-category, overlapping-question packet highest', () => {
    const onTopic = resolvedPacket({
      decision_id: 'D-1',
      category: 'create-vs-reuse',
      question: 'Reuse the existing parser or write a new one?',
    });
    const offTopic = resolvedPacket({
      decision_id: 'D-2',
      category: 'ux-pattern',
      question: 'Which colour should the button be?',
    });
    const query = {
      category: 'create-vs-reuse',
      question: 'Should we reuse the parser or build a new parser?',
    };
    expect(scorePrecedent(query, onTopic)).toBeGreaterThan(scorePrecedent(query, offTopic));
  });
});

describe('findDecisionPrecedents', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-prec-'));
    mkdirSync(join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function writeResolved(packet: DecisionPacket): void {
    writeFileSync(
      join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, `${packet.decision_id}.json`),
      JSON.stringify(packet),
    );
  }

  it('returns [] when there are no resolved decisions', () => {
    expect(
      findDecisionPrecedents(projectRoot, { category: 'create-vs-reuse', question: 'x' }),
    ).toEqual([]);
  });

  it('surfaces the most similar resolved decisions, ranked, capped', () => {
    writeResolved(
      resolvedPacket({ decision_id: 'D-101', question: 'Reuse the parser or write a new parser?' }),
    );
    writeResolved(
      resolvedPacket({
        decision_id: 'D-102',
        category: 'ux-pattern',
        question: 'What colour is the banner?',
      }),
    );
    const precedents = findDecisionPrecedents(
      projectRoot,
      { category: 'create-vs-reuse', question: 'reuse parser or new parser' },
      { limit: 1 },
    );
    expect(precedents).toHaveLength(1);
    expect(precedents[0].decision_id).toBe('D-101');
    expect(precedents[0].chosen).toBe('Reuse the existing parser');
    expect(precedents[0].rationale).toBe('the existing parser is fine');
  });

  it('excludes the query packet itself and exact-fingerprint matches', () => {
    writeResolved(resolvedPacket({ decision_id: 'D-103' }));
    expect(
      findDecisionPrecedents(projectRoot, {
        decision_id: 'D-103',
        category: 'create-vs-reuse',
        question: 'Reuse the existing parser or write a new one?',
      }),
    ).toEqual([]);
    expect(
      findDecisionPrecedents(projectRoot, {
        fingerprint: 'sha256:D-103',
        category: 'create-vs-reuse',
        question: 'Reuse the existing parser or write a new one?',
      }),
    ).toEqual([]);
  });

  it('ignores unresolved or choice-less packets', () => {
    writeResolved(
      resolvedPacket({ decision_id: 'D-104', human_response: undefined, status: 'resolved' }),
    );
    expect(
      findDecisionPrecedents(projectRoot, {
        category: 'create-vs-reuse',
        question: 'Reuse the existing parser or write a new one?',
      }),
    ).toEqual([]);
  });

  it('does not throw on a corrupt resolved file', () => {
    writeFileSync(join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, 'D-bad.json'), 'not json{');
    writeResolved(resolvedPacket({ decision_id: 'D-105' }));
    const precedents = findDecisionPrecedents(projectRoot, {
      category: 'create-vs-reuse',
      question: 'Reuse the existing parser or write a new one?',
    });
    expect(precedents.map((p) => p.decision_id)).toEqual(['D-105']);
  });
});

describe('DecisionStore.writePending enrichment (F25)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-prec-store-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  // Options that satisfy the store's copy-lint (verb-first label, fixed preview/trade-off stems).
  const compliantOptions = [
    {
      option_key: 'reuse',
      label: 'Reuse the existing parser',
      one_line_preview: 'If you pick this, the existing parser is wired in directly.',
      trade_off: 'You give up: some control over the parse output.',
      evidence: {},
    },
    {
      option_key: 'new',
      label: 'Make a new parser',
      one_line_preview: 'If you pick this, a fresh parser is built for this slice.',
      trade_off: 'You give up: time, since more code must be written and tested.',
      evidence: {},
    },
  ];

  it('appends similar past decisions to a new pending packet context', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();
    // A prior resolved decision on the same topic.
    writeFileSync(
      join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, 'D-201.json'),
      JSON.stringify(
        resolvedPacket({
          decision_id: 'D-201',
          question: 'Reuse the existing parser or write a new one?',
        }),
      ),
    );
    // A new pending decision on the same topic (different task, no human response).
    const pending = resolvedPacket({
      decision_id: 'D-202',
      task_session_id: 'task-2',
      status: 'pending',
      question: 'Reuse the parser or write a new parser for this slice?',
      options: compliantOptions,
      human_response: undefined,
    });
    const path = store.writePending(pending);
    const written = JSON.parse(readFileSync(path, 'utf8')) as DecisionPacket;
    expect(written.context).toContain(PRECEDENT_BLOCK_HEADING);
    expect(written.context).toContain('Reuse the existing parser');
  });

  it('leaves the context unchanged when there are no precedents', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();
    const pending = resolvedPacket({
      decision_id: 'D-203',
      task_session_id: 'task-3',
      status: 'pending',
      options: compliantOptions,
      human_response: undefined,
    });
    const original = pending.context;
    const path = store.writePending(pending);
    const written = JSON.parse(readFileSync(path, 'utf8')) as DecisionPacket;
    expect(written.context).toBe(original);
  });
});

describe('formatDecisionPrecedents', () => {
  it('returns empty string for no precedents', () => {
    expect(formatDecisionPrecedents([])).toBe('');
  });

  it('renders a compact advisory block under the keyed heading', () => {
    const block = formatDecisionPrecedents([
      {
        decision_id: 'D-1',
        category: 'create-vs-reuse',
        question: 'Reuse or build?',
        chosen: 'Reuse',
        rationale: 'it works',
        score: 0.9,
      },
    ]);
    expect(block).toContain(PRECEDENT_BLOCK_HEADING);
    expect(block).toContain('[create-vs-reuse]');
    expect(block).toContain('Reuse or build?');
    expect(block).toContain('→ Reuse');
    expect(block).toContain('it works');
  });
});
