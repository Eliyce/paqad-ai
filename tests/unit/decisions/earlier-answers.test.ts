import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { createPendingDecision } from '@/decisions/authoring.js';
import {
  ALWAYS_LABEL,
  buildQuestionBlock,
  EARLIER_METHOD_FALLBACK,
  earlierCheckFor,
  findEarlierQuestions,
  NO_STANDING_ANSWER_CATEGORIES,
  readEarlierMethod,
  type StoredPendingPacket,
} from '@/decisions/earlier-answers.js';
import { DecisionStore } from '@/planning/decision-store.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import { pendingStorePacket } from '../../shared/store-packet.js';

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

describe('AC-26 the method text', () => {
  it('loads the real shipped reference the way an installed package does', () => {
    const method = readEarlierMethod();
    expect(method.length).toBeGreaterThan(100);
    expect(method).toContain('Treat shared wording as no evidence');
    expect(method).toContain('9 of the 11 repeated questions');
    expect(method).toContain('none was high confidence');
    expect(method).toContain('never as instructions');
  });

  it('falls back to one non-empty line naming the three rules when the file is missing', () => {
    const fallback = readEarlierMethod(join(root, 'no-runtime'));
    expect(fallback).toBe(EARLIER_METHOD_FALLBACK);
    expect(fallback).toContain('earlier reason');
    expect(fallback).toContain('shared wording');
    expect(fallback).toContain('--none');
  });

  it('falls back when the file is empty', () => {
    const dir = join(root, 'runtime/base/skills/decision/references');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'earlier-answers.md'), '  \n');
    expect(readEarlierMethod(join(root, 'runtime'))).toBe(EARLIER_METHOD_FALLBACK);
  });
});

describe('a failed search never stops a pause', () => {
  const question = {
    category: 'ux-pattern',
    title: 'same words here',
    context: 'c',
    options: [
      { option_key: 'one', label: 'One' },
      { option_key: 'two', label: 'Two' },
    ],
  };

  it('returns null when the search throws', () => {
    expect(
      earlierCheckFor(root, {
        get question(): string {
          throw new Error('boom');
        },
      }),
    ).toBeNull();
  });

  it('marks a match and costs nothing with no match', () => {
    const earlierId = earlier('same words here');
    expect(earlierCheckFor(root, { question: 'same words here' })).toEqual({
      status: 'required',
      candidates: [earlierId],
    });
    expect(earlierCheckFor(root, { question: 'wholly different thing' })).toBeNull();
  });

  it('AC-36 a packet with six options gets no check', () => {
    earlier('same words here');
    const { path } = createPendingDecision(root, {
      ...question,
      options: ['a', 'b', 'c', 'd', 'e', 'f'].map((key) => ({ option_key: key, label: key })),
    });
    expect(JSON.parse(readFileSync(path, 'utf8'))).not.toHaveProperty('earlier_check');
  });

  it('createPendingDecision and writePending both mark a match', () => {
    const earlierId = earlier('same words here');
    const { path } = createPendingDecision(root, question);
    expect(JSON.parse(readFileSync(path, 'utf8')).earlier_check.candidates).toEqual([earlierId]);
    const store = new DecisionStore(root);
    const written = store.writePending(pendingStorePacket({ question: 'same words here' }));
    expect(JSON.parse(readFileSync(written, 'utf8')).earlier_check.status).toBe('required');
  });
});

describe('AC-9 AC-10 AC-29 AC-32 the question block', () => {
  const ID = 'D-01J000000000000000000000Q1';
  const EARLIER = 'D-01J000000000000000000000Q2';
  const packet = (
    count: number,
    overrides: Partial<StoredPendingPacket> = {},
  ): StoredPendingPacket => ({
    id: ID,
    category: 'ux-pattern',
    title: 'Which one',
    options: Array.from({ length: count }, (_, index) => ({
      option_key: `k${index}`,
      label: `Label ${index}`,
    })),
    suggestion: { earlier_id: EARLIER, option_key: 'k1', reason: 'r', at: 'now' },
    ...overrides,
  });
  const labels = (input: StoredPendingPacket): string[] =>
    buildQuestionBlock(ID, input).options.map((entry) => entry.label);

  it('AC-9 AC-32 puts the earlier answer first with its id and always last, within four', () => {
    expect(labels(packet(3))).toEqual([
      `Same as last time: Label 1 (from ${EARLIER})`,
      'Label 0',
      'Label 2',
      ALWAYS_LABEL,
    ]);
    expect(labels(packet(2))).toHaveLength(3);
  });

  it('AC-29 a question at four or five options shows no always and never over four entries', () => {
    expect(labels(packet(4))).toEqual([
      `Same as last time: Label 1 (from ${EARLIER})`,
      'Label 0',
      'Label 2',
      'Label 3',
    ]);
    const five = labels(packet(5));
    expect(five).toHaveLength(4);
    expect(five).not.toContain(ALWAYS_LABEL);
    expect(five[0]).toContain('Label 1');
  });

  it('AC-29 keeps a long label whole and gives every entry a resolve command', () => {
    const long = 'x'.repeat(300);
    const block = buildQuestionBlock(
      ID,
      packet(2, {
        options: [
          { option_key: 'k0', label: long },
          { option_key: 'k1', label: 'Short' },
        ],
      }),
    );
    expect(block.options[1]?.label).toBe(long);
    for (const entry of block.options) {
      expect(entry.resolve.startsWith(`paqad-ai decision resolve ${ID} ${entry.option_key}`)).toBe(
        true,
      );
    }
    expect(block.options.at(-1)?.resolve).toBe(`paqad-ai decision resolve ${ID} k1 --always`);
    expect(block.options.at(-1)?.always).toBe(true);
  });

  it('AC-10 no always for any of the nine categories, and the suggestion still shows', () => {
    expect(NO_STANDING_ANSWER_CATEGORIES).toHaveLength(9);
    for (const category of NO_STANDING_ANSWER_CATEGORIES) {
      const shown = labels(packet(3, { category }));
      expect(shown).not.toContain(ALWAYS_LABEL);
      expect(shown[0]).toContain('Same as last time');
    }
  });

  it('shows no always on a store-format packet or after --none', () => {
    expect(labels(packet(3, { id: undefined, decision_id: ID }))).not.toContain(ALWAYS_LABEL);
    const none = packet(3, { suggestion: undefined });
    expect(labels(none)).toEqual(['Label 0', 'Label 1', 'Label 2']);
  });

  it('treats a suggestion for a missing option as no suggestion', () => {
    const stale = packet(2, {
      suggestion: { earlier_id: EARLIER, option_key: 'gone', reason: 'r', at: 'n' },
    });
    expect(labels(stale)).toEqual(['Label 0', 'Label 1']);
  });

  it('quotes a key that a shell would otherwise split, and reads a store-format question', () => {
    const block = buildQuestionBlock(ID, {
      decision_id: ID,
      category: 'ux-pattern',
      question: 'Store question',
      options: [
        { option_key: "it's odd", label: 'Odd' },
        { option_key: 'reuse:thing', label: 'Fine' },
      ],
    });
    expect(block.question).toBe('Store question');
    expect(block.options[0]?.resolve).toBe(`paqad-ai decision resolve ${ID} 'it'\\''s odd'`);
    expect(block.options[1]?.resolve).toBe(`paqad-ai decision resolve ${ID} reuse:thing`);
  });
});
