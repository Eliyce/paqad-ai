import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { buildApprovalsFeed } from '@/dashboard/approvals.js';
import {
  createPendingDecision,
  readContractDecisions,
  resolvePendingDecision,
  addWriteInOption,
} from '@/decisions/authoring.js';
import { readAnyDecisionPacket, richFieldsFor } from '@/decisions/packet-shape.js';
import { isDecisionPacket, type DecisionPacket } from '@/planning/decision-packet.js';
import { DecisionStore } from '@/planning/decision-store.js';
import { autoAnswerQuestions } from '@/spec-pipeline/auto-answer.js';

// Issue #639, Part 3 — one decision packet shape. A `decision create` packet keeps every
// contract field AND is a valid DecisionPacket, so Approvals, the completion gate and
// auto-answer read the same packet the edit gate already counts.

const INPUT = {
  category: 'intake.requirement',
  title: 'Should exports include archived orders?',
  context: 'It changes which rows appear in the file.',
  options: [
    { option_key: 'include', label: 'Include archived orders' },
    { option_key: 'exclude', label: 'Exclude archived orders' },
  ],
  recommendation: 'include',
};

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('one decision packet shape (#639 Part 3)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-639-p3-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('decision create writes a packet that is both the contract shape and a DecisionPacket', () => {
    const { id, path } = createPendingDecision(root, INPUT);
    const stored = readJson(path);

    // Contract fields, unchanged.
    expect(stored).toMatchObject({
      id,
      title: INPUT.title,
      category: INPUT.category,
      recommendation: 'include',
      status: 'pending',
    });
    // Rich fields, valid.
    expect(isDecisionPacket(stored)).toBe(true);
    expect(stored).toMatchObject({ decision_id: id, question: INPUT.title });
    expect(readContractDecisions(root)[0]?.packet.id).toBe(id);
  });

  it('decision resolve records the answer in both forms', () => {
    const { id } = createPendingDecision(root, INPUT);
    const { path } = resolvePendingDecision(root, id, 'exclude', 'audit trail stays separate');
    const stored = readJson(path) as unknown as DecisionPacket & { chosen: string };

    expect(stored.chosen).toBe('exclude');
    expect(isDecisionPacket(stored)).toBe(true);
    expect(stored.status).toBe('resolved');
    expect(stored.human_response).toMatchObject({
      chosen_option_key: 'exclude',
      intent: 'explicit',
      note: 'audit trail stays separate',
    });
  });

  it('AC-2: Approvals and the completion-gate reader include a decision create packet', () => {
    const { id } = createPendingDecision(root, INPUT);

    expect(buildApprovalsFeed(root).pauses.map((pause) => pause.id)).toContain(id);
    expect(new DecisionStore(root).readPendingResult(id).packet?.decision_id).toBe(id);
  });

  it('AC-2: a legacy contract-only packet on disk is upgraded in memory, never rewritten', () => {
    const dir = join(root, PATHS.DECISIONS_PENDING_DIR);
    mkdirSync(dir, { recursive: true });
    const legacyId = 'D-01M50000000000000000000000';
    const legacy = {
      id: legacyId,
      ...INPUT,
      created_at: '2026-10-01T00:00:00.000Z',
      status: 'pending',
    };
    writeFileSync(join(dir, `${legacyId}.json`), JSON.stringify(legacy));

    const upgraded = readAnyDecisionPacket(legacy);
    expect(upgraded?.decision_id).toBe(legacyId);
    expect(buildApprovalsFeed(root).pauses.map((pause) => pause.id)).toEqual([legacyId]);
    expect(readJson(join(dir, `${legacyId}.json`))).toEqual(legacy);
  });

  it('AC-3: auto-answer reuses an answer recorded with decision resolve', () => {
    const { id } = createPendingDecision(root, INPUT);
    resolvePendingDecision(root, id, 'include');

    const { answered, remaining } = autoAnswerQuestions(root, [
      {
        business_text: INPUT.title,
        why_it_matters: INPUT.context,
        options: ['Include archived orders', 'Exclude archived orders'],
        grounded_in: null,
      },
    ]);

    expect(remaining).toEqual([]);
    expect(answered).toEqual([
      { question: INPUT.title, answer: 'Include archived orders', source: id },
    ]);
  });

  it('AC-4: one malformed pending packet no longer blocks writePending', () => {
    const store = new DecisionStore(root);
    store.initialize();
    writeFileSync(join(root, PATHS.DECISIONS_PENDING_DIR, 'D-9.json'), '{bad', 'utf8');
    const { id } = createPendingDecision(root, INPUT);
    rmSync(join(root, PATHS.DECISIONS_PENDING_DIR, `${id}.json`));
    const upgraded = readAnyDecisionPacket({
      id,
      ...INPUT,
      created_at: new Date().toISOString(),
      status: 'pending',
    })!;
    // writePending also lints the copy, so give the options copy that passes it.
    const packet: DecisionPacket = {
      ...upgraded,
      options: upgraded.options.map((option) => ({
        ...option,
        label: `Pick: ${option.label}`,
        one_line_preview: 'If you pick this, the export changes.',
        trade_off: 'You give up: the other row set.',
      })),
    };

    expect(() => store.writePending(packet)).not.toThrow();
  });

  it('keeps the contract shape alone when the packet cannot be a DecisionPacket', () => {
    const { path } = createPendingDecision(root, { ...INPUT, category: 'team.custom-choice' });
    const stored = readJson(path);

    expect(stored.decision_id).toBeUndefined();
    expect(readAnyDecisionPacket(stored)).toBeNull();
    expect(richFieldsFor({ ...(stored as never), options: [] })).toBeNull();
  });

  it('re-derives the rich fields after a write-in option, and drops them past five options', () => {
    const { id, path } = createPendingDecision(root, INPUT);
    addWriteInOption(root, id, 'Ask finance first');
    expect(isDecisionPacket(readJson(path))).toBe(true);

    for (const label of ['A', 'B', 'C']) addWriteInOption(root, id, label);
    const six = readJson(path);
    expect((six.options as unknown[]).length).toBe(6);
    expect(six.decision_id).toBeUndefined();
    expect(readAnyDecisionPacket(six)).toBeNull();
  });

  it('reads anything else as null, never a throw', () => {
    expect(readAnyDecisionPacket(null)).toBeNull();
    expect(readAnyDecisionPacket('D-1')).toBeNull();
    expect(readAnyDecisionPacket({ id: 'D-1', title: 'x' })).toBeNull();
  });
});
