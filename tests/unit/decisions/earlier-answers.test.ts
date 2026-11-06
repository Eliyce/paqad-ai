import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { findEarlierQuestions } from '@/decisions/earlier-answers.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';

let root: string;
let serial = 0;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-earlier-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function nextId(): string {
  serial += 1;
  return `D-01J00000000000000000000${String(serial).padStart(3, '0')}`;
}

function earlier(
  question: string,
  overrides: Partial<DecisionPacket> & { respondedAt?: string; chosen?: string | null } = {},
): string {
  const { respondedAt, chosen, ...rest } = overrides;
  const id = rest.decision_id ?? nextId();
  const packet: DecisionPacket = {
    decision_id: id,
    fingerprint: `sha256:${id}`,
    category: 'workflow-or-tool',
    question,
    context: 'Why this came up.',
    options: ['one', 'two'].map((key) => ({
      option_key: key,
      label: `Label ${key}`,
      one_line_preview: key,
      trade_off: 'none',
      evidence: {},
    })),
    confidence: 1,
    requested_by: 'test',
    task_session_id: 's',
    created_at: '2026-01-01T00:00:00.000Z',
    status: 'resolved',
    ttl_until: '2999-01-01T00:00:00.000Z',
    invalidation_watch: [],
    human_response: {
      chosen_option_key: chosen === undefined ? 'one' : chosen,
      intent: 'explicit',
      explanation_rounds_used: 0,
      responded_at: respondedAt ?? '2026-02-01T00:00:00.000Z',
      responded_by: 'human',
      carry_over_scope: 'task',
      note: 'The reason then.',
    },
    ...rest,
  };
  const dir = join(root, PATHS.DECISIONS_RESOLVED_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(packet));
  return id;
}

const ids = (query: Parameters<typeof findEarlierQuestions>[1]): string[] =>
  findEarlierQuestions(root, query).map((entry) => entry.id);

describe('AC-22 findEarlierQuestions', () => {
  it('keeps a score of exactly 0.5 and drops one just below', () => {
    const half = earlier('alpha beta gamma delta');
    expect(ids({ question: 'alpha beta' })).toEqual([half]);
    expect(findEarlierQuestions(root, { question: 'alpha beta' })[0]?.score).toBe(0.5);
    expect(ids({ question: 'alpha beta kappa' })).toEqual([]);
  });

  it('returns five, best first, from six matches', () => {
    const best = earlier('ship release notes today');
    for (let index = 0; index < 5; index += 1) earlier('ship release notes today friday');
    const found = findEarlierQuestions(root, { question: 'ship release notes today' });
    expect(found).toHaveLength(5);
    expect(found[0]?.id).toBe(best);
    expect(found[0]?.score).toBe(1);
  });

  it('orders ties newest first, then by id', () => {
    const older = earlier('same words here', { respondedAt: '2026-01-01T00:00:00.000Z' });
    const first = earlier('same words here', { respondedAt: '2026-03-01T00:00:00.000Z' });
    const second = earlier('same words here', { respondedAt: '2026-03-01T00:00:00.000Z' });
    expect(ids({ question: 'same words here' })).toEqual([first, second, older]);
  });

  it('removes excludeId', () => {
    const kept = earlier('same words here');
    const excluded = earlier('same words here');
    expect(ids({ question: 'same words here', excludeId: excluded })).toEqual([kept]);
  });

  it('keeps ttl exactly now and drops a passed ttl', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const atNow = earlier('same words here', { ttl_until: now.toISOString() });
    earlier('same words here', { ttl_until: '2026-05-31T23:59:59.000Z' });
    expect(ids({ question: 'same words here', now })).toEqual([atNow]);
  });

  it('returns nothing for a superseded packet, no chosen key or an empty question', () => {
    earlier('same words here', { status: 'superseded' });
    earlier('same words here', { chosen: null });
    expect(ids({ question: 'same words here' })).toEqual([]);
    earlier('the of and');
    expect(ids({ question: 'the of and' })).toEqual([]);
    expect(ids({ question: '' })).toEqual([]);
  });

  it('finds any category and carries the fields a reader needs', () => {
    const id = earlier('same words here', { category: 'finding.triage' });
    expect(
      findEarlierQuestions(root, { question: 'same words here', category: 'ux-pattern' }),
    ).toEqual([
      {
        id,
        category: 'finding.triage',
        question: 'same words here',
        context: 'Why this came up.',
        chosen: 'one',
        chosen_label: 'Label one',
        why: 'The reason then.',
        resolved_at: '2026-02-01T00:00:00.000Z',
        score: 1,
      },
    ]);
  });

  it('gives an empty reason when the earlier answer had none', () => {
    const base = 'same words here';
    earlier(base, {
      human_response: {
        chosen_option_key: 'one',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-02-01T00:00:00.000Z',
        responded_by: 'human',
        carry_over_scope: 'task',
      },
    });
    expect(findEarlierQuestions(root, { question: base })[0]?.why).toBe('');
  });

  it('returns nothing when there is no resolved folder', () => {
    expect(ids({ question: 'same words here' })).toEqual([]);
  });
});

describe('AC-43 private answers stay in their category', () => {
  it('offers a consent answer only to a question in that category', () => {
    const id = earlier('may we store these emails', { category: 'analytics.pii_consent' });
    expect(ids({ question: 'may we store these emails', category: 'ux-pattern' })).toEqual([]);
    expect(ids({ question: 'may we store these emails' })).toEqual([]);
    expect(
      ids({ question: 'may we store these emails', category: 'analytics.pii_consent' }),
    ).toEqual([id]);
  });
});
