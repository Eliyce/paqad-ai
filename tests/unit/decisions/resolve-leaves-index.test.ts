import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  answerPendingDecision,
  createPendingDecision,
  resolvePendingDecision,
  type CreateDecisionInput,
} from '@/decisions/authoring.js';
import { suggestEarlierAnswer } from '@/decisions/earlier-answers.js';
import { DECISION_REUSE_DOC_TYPE } from '@/decision-reuse/index.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { readSessionDoc } from '@/session-ledger/ledger.js';
import { computeDecisionFingerprint } from '@/planning/decision-fingerprint.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import { DecisionStore } from '@/planning/decision-store.js';
import { findIntakePriorMatch } from '@/planning/intake-prior-resolver.js';

import { pendingStorePacket, storeOptions } from '../../shared/store-packet.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-resolve-index-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const STORE_ID = 'D-01J000000000000000000000A1';

function input(overrides: Partial<CreateDecisionInput> = {}): CreateDecisionInput {
  return {
    category: 'workflow-or-tool',
    title: 'Where should the helper script live?',
    context: 'Two reasonable places.',
    options: [
      { option_key: 'one', label: 'One' },
      { option_key: 'two', label: 'Two' },
    ],
    ...overrides,
  };
}

const indexPath = (): string => join(root, PATHS.DECISIONS_INDEX);

function seedIndex(): string {
  new DecisionStore(root).initialize();
  const bytes = `${JSON.stringify(
    { fingerprints: { 'sha256:held': 'D-held' }, decisions: {} },
    null,
    2,
  )}  \n`;
  writeFileSync(indexPath(), bytes);
  return bytes;
}

function resolvedFile(id: string): string {
  return readFileSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, `${id}.json`), 'utf8');
}

function answered(overrides: Partial<CreateDecisionInput> = {}, chosen = 'one'): string {
  const { id } = createPendingDecision(root, input(overrides));
  resolvePendingDecision(root, id, chosen);
  return id;
}

function fingerprintOf(id: string): string {
  return (JSON.parse(resolvedFile(id)) as { fingerprint: string }).fingerprint;
}

const keys = (...optionKeys: string[]): DecisionPacket['options'] => storeOptions(optionKeys);

function resolveInStore(fingerprint: string): void {
  const store = new DecisionStore(root);
  store.writePending(
    pendingStorePacket({
      decision_id: STORE_ID,
      fingerprint,
      question: 'Use the shared button?',
      options: keys('reuse', 'new'),
    }),
  );
  store.resolve({
    decisionId: STORE_ID,
    humanResponse: {
      chosen_option_key: 'reuse',
      intent: 'explicit',
      explanation_rounds_used: 0,
      responded_at: '2026-06-02T00:00:00.000Z',
      responded_by: 'human',
      carry_over_scope: 'session',
    },
  });
}

describe('AC-1 a CLI resolve writes no index', () => {
  it('creates no index in a project that has none', () => {
    answered();
    expect(existsSync(indexPath())).toBe(false);
  });

  it('leaves an existing index byte-identical', () => {
    const before = seedIndex();
    answered();
    expect(readFileSync(indexPath(), 'utf8')).toBe(before);
  });

  it('leaves an earlier answer resolved and unchanged when the answer changes', () => {
    const first = answered();
    const before = resolvedFile(first);
    const { id } = createPendingDecision(root, input());
    suggestEarlierAnswer(root, id, { none: true, reason: 'The situation changed.' });
    resolvePendingDecision(root, id, 'two');
    expect(resolvedFile(first)).toBe(before);
    expect(existsSync(indexPath())).toBe(false);
  });

  it('still indexes a store-shape packet resolved through the CLI, as on main', () => {
    new DecisionStore(root).writePending(pendingStorePacket({ decision_id: STORE_ID }));
    resolvePendingDecision(root, STORE_ID, 'a');
    const index = JSON.parse(readFileSync(indexPath(), 'utf8'));
    expect(index.decisions[STORE_ID].chosen_option_key).toBe('a');
    expect(index.fingerprints['sha256:store']).toBe(STORE_ID);
  });
});

describe('the index reads as on main', () => {
  it('a damaged index still fails a reuse lookup and costs the earlier search nothing', () => {
    const earlierId = answered();
    new DecisionStore(root).initialize();
    writeFileSync(indexPath(), '{ "fingerprints": {\n<<<<<<< ours\n');
    expect(() =>
      new DecisionStore(root).findReusableDecision({
        fingerprint: 'sha256:any',
        category: 'workflow-or-tool',
        options: [],
      }),
    ).toThrow(SyntaxError);
    const { path } = createPendingDecision(root, input());
    expect(JSON.parse(readFileSync(path, 'utf8')).earlier_check.candidates).toEqual([earlierId]);
  });

  it('a damaged index costs a standing rule nothing', () => {
    const { id } = createPendingDecision(root, input());
    answerPendingDecision(root, id, 'one', '', { always: true });
    new DecisionStore(root).initialize();
    const damaged = '{ "fingerprints": {\n<<<<<<< ours\n';
    writeFileSync(indexPath(), damaged);
    expect(createPendingDecision(root, input()).reused?.chosen).toBe('one');
    expect(readFileSync(indexPath(), 'utf8')).toBe(damaged);
  });
});

describe('AC-33 a CLI answer is never reused without a pause', () => {
  it('returns null for the packet own fingerprint called directly', () => {
    const id = answered();
    expect(
      new DecisionStore(root).findReusableDecision({
        fingerprint: fingerprintOf(id),
        category: 'workflow-or-tool',
        options: keys('one', 'two'),
      }),
    ).toBeNull();
  });

  it('finds no intake match on an empty profile', () => {
    answered({ category: 'intake.requirement' });
    expect(
      findIntakePriorMatch(root, {
        category: 'intake.requirement',
        question: 'Where should the helper script live?',
        options: keys('one', 'two'),
        repoState: {},
      }),
    ).toBeNull();
  });
});

describe('AC-34 a CLI answer past its ttl_until', () => {
  it('stays in resolved and leaves the index unchanged', () => {
    const id = answered();
    const stored = JSON.parse(resolvedFile(id)) as Record<string, unknown>;
    const expired = `${JSON.stringify({ ...stored, ttl_until: '2020-01-01T00:00:00.000Z' })}\n`;
    mkdirSync(join(root, PATHS.DECISIONS_RESOLVED_DIR), { recursive: true });
    writeFileSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, `${id}.json`), expired);
    const before = seedIndex();
    const store = new DecisionStore(root);
    expect(
      store.findReusableDecision({
        fingerprint: stored.fingerprint as string,
        category: 'workflow-or-tool',
        options: keys('one', 'two'),
      }),
    ).toBeNull();
    const reopened = createPendingDecision(root, input({ title: 'Something wholly unrelated' }));
    expect(JSON.parse(readFileSync(reopened.path, 'utf8'))).not.toHaveProperty('earlier_check');
    expect(existsSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, `${id}.json`))).toBe(true);
    expect(readFileSync(indexPath(), 'utf8')).toBe(before);
  });
});

describe('AC-54 a store-shape answer holding a fingerprint', () => {
  const fingerprint = computeDecisionFingerprint({
    category: 'component-reuse',
    question: 'Use the shared button?',
    option_keys: ['new', 'reuse'],
    repo_state: {},
  });

  it('is reused on an exact repeat and logged with match_kind exact', () => {
    resolveInStore(fingerprint);
    const found = new DecisionStore(root).findReusableDecision({
      fingerprint,
      category: 'component-reuse',
      options: keys('new', 'reuse'),
    });
    expect(found).toBe(STORE_ID);
    const rows = readSessionDoc(root, DECISION_REUSE_DOC_TYPE, resolveSessionId(root));
    expect(rows.map((row) => row.match_kind)).toContain('exact');
  });

  it('is asked with the suggestion when opened through createPendingDecision', () => {
    resolveInStore(fingerprint);
    const { path } = createPendingDecision(
      root,
      input({ category: 'component-reuse', title: 'Use the shared button?' }),
    );
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    expect(stored.status).toBe('pending');
    expect(stored.earlier_check).toEqual({ status: 'required', candidates: [STORE_ID] });
  });
});
