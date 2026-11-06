import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  createPendingDecision,
  readContractDecisions,
  resolvePendingDecision,
  type CreateDecisionInput,
} from '@/decisions/authoring.js';
import { computeDecisionFingerprint } from '@/planning/decision-fingerprint.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import { DecisionStore, type DecisionIndexFile } from '@/planning/decision-store.js';
import { findIntakePriorMatch } from '@/planning/intake-prior-resolver.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-index-on-resolve-'));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

const ID_A = 'D-01J000000000000000000000A1';
const ID_B = 'D-01J000000000000000000000A2';
const ID_C = 'D-01J000000000000000000000A3';
const ID_D = 'D-01J000000000000000000000A4';

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

function storePacket(overrides: Partial<DecisionPacket> = {}): DecisionPacket {
  return {
    decision_id: ID_A,
    fingerprint: 'sha256:held',
    category: 'component-reuse',
    question: 'Use the shared button?',
    context: 'A new action.',
    options: [
      {
        option_key: 'reuse',
        label: 'Reuse',
        one_line_preview: 'Reuse it.',
        trade_off: 'You give up: a fresh design.',
        evidence: {},
      },
      {
        option_key: 'new',
        label: 'New',
        one_line_preview: 'Make one.',
        trade_off: 'You give up: one place.',
        evidence: {},
      },
    ],
    confidence: 0.7,
    requested_by: 'codex-cli',
    task_session_id: 's',
    created_at: '2026-01-01T00:00:00.000Z',
    status: 'resolved',
    ttl_until: '2999-01-01T00:00:00.000Z',
    invalidation_watch: [],
    human_response: {
      chosen_option_key: 'reuse',
      intent: 'explicit',
      explanation_rounds_used: 0,
      responded_at: '2026-01-02T00:00:00.000Z',
      responded_by: 'human',
      carry_over_scope: 'task',
    },
    ...overrides,
  };
}

function writeResolvedFile(packet: unknown, id: string): void {
  const dir = join(root, PATHS.DECISIONS_RESOLVED_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(packet, null, 2)}\n`);
}

function readIndex(): DecisionIndexFile {
  return JSON.parse(readFileSync(join(root, PATHS.DECISIONS_INDEX), 'utf8')) as DecisionIndexFile;
}

function resolvedBytes(): Record<string, string> {
  const dir = join(root, PATHS.DECISIONS_RESOLVED_DIR);
  return Object.fromEntries(
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => [entry.name, readFileSync(join(dir, entry.name), 'utf8')]),
  );
}

function lookup(fingerprint = 'sha256:nothing'): string | null {
  return new DecisionStore(root).findReusableDecision({
    fingerprint,
    category: 'component-reuse',
    options: [],
  });
}

function resolved(id: string): { status: string; id?: string; title?: string; chosen?: string } {
  return JSON.parse(readFileSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, `${id}.json`), 'utf8'));
}

describe('AC-1 resolve keeps the index up to date', () => {
  it('holds the fingerprint and an index.decisions entry with the chosen key', () => {
    const { id } = createPendingDecision(root, input());
    resolvePendingDecision(root, id, 'one', 'because');
    const stored = resolved(id) as unknown as { fingerprint: string };
    const index = readIndex();
    expect(index.fingerprints[stored.fingerprint]).toBe(id);
    expect(index.decisions[id]).toMatchObject({
      decision_id: id,
      chosen_option_key: 'one',
      status: 'resolved',
      option_keys: ['one', 'two'],
    });
  });

  it('supersedes a conflicting earlier answer and leaves an agreeing one alone', () => {
    const first = createPendingDecision(root, input()).id;
    resolvePendingDecision(root, first, 'one');
    const second = createPendingDecision(root, input()).id;
    resolvePendingDecision(root, second, 'one');
    expect(resolved(first).status).toBe('resolved');

    const third = createPendingDecision(root, input()).id;
    resolvePendingDecision(root, third, 'two');
    expect(resolved(second).status).toBe('superseded');
    expect(readIndex().decisions[second]?.status).toBe('superseded');
  });

  it('adds nothing for a packet with no fingerprint', () => {
    const { id } = createPendingDecision(root, input({ category: 'scope' }));
    resolvePendingDecision(root, id, 'one');
    expect(existsSync(join(root, PATHS.DECISIONS_INDEX))).toBe(false);
  });
});

describe('AC-53 a superseded contract-shaped file keeps its identity', () => {
  it('keeps id, title and chosen and still lists', () => {
    const first = createPendingDecision(root, input()).id;
    resolvePendingDecision(root, first, 'one');
    const second = createPendingDecision(root, input()).id;
    resolvePendingDecision(root, second, 'two');
    const file = resolved(first);
    expect(file.status).toBe('superseded');
    expect(file.id).toBe(first);
    expect(file.title).toBe('Where should the helper script live?');
    expect(file.chosen).toBe('one');
    const listed = readContractDecisions(root).find(({ packet }) => packet.id === first);
    expect(listed?.status).toBe('resolved');
  });
});

describe('AC-2 AC-21 backfill from resolved files', () => {
  it('adds missing files, skips unreadable ones and changes no resolved file', () => {
    writeResolvedFile(storePacket(), ID_A);
    const dir = join(root, PATHS.DECISIONS_RESOLVED_DIR);
    writeFileSync(join(dir, `${ID_B}.json`), '{ not json');
    const before = resolvedBytes();
    lookup();
    const index = readIndex();
    expect(Object.keys(index.decisions)).toEqual([ID_A]);
    expect(index.fingerprints['sha256:held']).toBe(ID_A);
    expect(resolvedBytes()).toEqual(before);
  });

  it('gives the fingerprint to the newest, with a stable id tie-break', () => {
    const at = (iso: string): DecisionPacket['human_response'] => ({
      ...storePacket().human_response!,
      responded_at: iso,
    });
    writeResolvedFile(
      storePacket({ decision_id: ID_D, human_response: at('2026-01-01T00:00:00.000Z') }),
      ID_D,
    );
    writeResolvedFile(
      storePacket({ decision_id: ID_A, human_response: at('2026-03-01T00:00:00.000Z') }),
      ID_A,
    );
    writeResolvedFile(
      storePacket({ decision_id: ID_B, human_response: at('2026-03-01T00:00:00.000Z') }),
      ID_B,
    );
    lookup();
    expect(readIndex().fingerprints['sha256:held']).toBe(ID_B);
  });

  it('gives a superseded file an entry but no fingerprint, and skips bad entries', () => {
    writeResolvedFile(storePacket({ decision_id: ID_A, status: 'superseded' }), ID_A);
    writeResolvedFile({ decision_id: ID_B, status: 'resolved' }, ID_B);
    const dir = join(root, PATHS.DECISIONS_RESOLVED_DIR);
    mkdirSync(join(dir, `${ID_C}.json`));
    writeFileSync(join(dir, 'notes.txt'), 'not a packet');
    const before = resolvedBytes();
    lookup();
    const index = readIndex();
    expect(Object.keys(index.decisions)).toEqual([ID_A]);
    expect(index.decisions[ID_A]?.status).toBe('superseded');
    expect(index.fingerprints).toEqual({});
    expect(resolvedBytes()).toEqual(before);
  });

  it('never takes a fingerprint from a newer holder', () => {
    writeResolvedFile(storePacket({ decision_id: ID_A }), ID_A);
    new DecisionStore(root).initialize();
    writeFileSync(
      join(root, PATHS.DECISIONS_INDEX),
      JSON.stringify({
        fingerprints: { 'sha256:held': ID_B },
        decisions: {
          [ID_B]: {
            decision_id: ID_B,
            fingerprint: 'sha256:held',
            category: 'component-reuse',
            chosen_option_key: 'reuse',
            responded_at: '2026-06-01T00:00:00.000Z',
            status: 'resolved',
            option_keys: ['new', 'reuse'],
          },
        },
      }),
    );
    lookup();
    const index = readIndex();
    expect(index.fingerprints['sha256:held']).toBe(ID_B);
    expect(index.decisions[ID_A]).toBeDefined();
  });

  it('writes nothing when nothing is missing', () => {
    const store = new DecisionStore(root);
    writeResolvedFile(storePacket(), ID_A);
    lookup();
    const first = readFileSync(join(root, PATHS.DECISIONS_INDEX), 'utf8');
    writeFileSync(join(root, PATHS.DECISIONS_INDEX), first.replace(/\n$/u, '  \n'));
    store.findReusableDecision({ fingerprint: 'sha256:x', category: 'ux-pattern', options: [] });
    expect(readFileSync(join(root, PATHS.DECISIONS_INDEX), 'utf8')).toBe(
      first.replace(/\n$/u, '  \n'),
    );
  });

  it('does not bring back a fingerprint the exact path deleted', () => {
    writeResolvedFile(
      storePacket({ decision_id: ID_A, ttl_until: '2020-01-01T00:00:00.000Z' }),
      ID_A,
    );
    expect(lookup('sha256:held')).toBeNull();
    expect(readIndex().fingerprints['sha256:held']).toBeUndefined();
    expect(lookup('sha256:held')).toBeNull();
    expect(readIndex().fingerprints['sha256:held']).toBeUndefined();
  });
});

describe('AC-37 a merge-damaged index', () => {
  it('reads as empty for every caller and is rebuilt by backfill', () => {
    const store = new DecisionStore(root);
    store.initialize();
    writeResolvedFile(storePacket(), ID_A);
    const damaged = '{ "fingerprints": {\n<<<<<<< ours\n';
    writeFileSync(join(root, PATHS.DECISIONS_INDEX), damaged);
    expect(() => store.expireResolvedDecision(ID_A)).not.toThrow();

    writeResolvedFile(storePacket({ decision_id: ID_B }), ID_B);
    writeFileSync(join(root, PATHS.DECISIONS_INDEX), damaged);
    expect(lookup()).toBeNull();
    expect(readIndex().fingerprints['sha256:held']).toBe(ID_B);
  });

  it('fills in a parsed index that lost a section', () => {
    new DecisionStore(root).initialize();
    writeResolvedFile(storePacket(), ID_A);
    writeFileSync(join(root, PATHS.DECISIONS_INDEX), '{}');
    lookup();
    expect(readIndex().decisions[ID_A]).toBeDefined();
  });
});

describe('AC-28 two writers interleaved', () => {
  it('restores a lost entry from resolved files, with an injected clock and no sleep', () => {
    vi.useFakeTimers({ now: new Date('2026-05-01T00:00:00.000Z') });
    const first = createPendingDecision(root, input()).id;
    const second = createPendingDecision(
      root,
      input({ title: 'Which release channel should we announce on?' }),
    ).id;
    resolvePendingDecision(root, first, 'one');
    const staleView = readFileSync(join(root, PATHS.DECISIONS_INDEX), 'utf8');
    vi.setSystemTime(new Date('2026-05-01T00:00:01.000Z'));
    resolvePendingDecision(root, second, 'two');
    writeFileSync(join(root, PATHS.DECISIONS_INDEX), staleView);
    expect(readIndex().decisions[second]).toBeUndefined();
    lookup();
    const index = readIndex();
    expect(index.decisions[first]?.chosen_option_key).toBe('one');
    expect(index.decisions[second]?.chosen_option_key).toBe('two');
  });
});

describe('AC-3 AC-33 AC-34 AC-54 answers written by the writer are never reused', () => {
  it('AC-33 returns null for a packet whose own fingerprint is called directly', () => {
    const { id } = createPendingDecision(root, input());
    resolvePendingDecision(root, id, 'one');
    const fingerprint = (resolved(id) as unknown as { fingerprint: string }).fingerprint;
    const store = new DecisionStore(root);
    expect(
      store.findReusableDecision({
        fingerprint,
        category: 'workflow-or-tool',
        options: [
          { option_key: 'one' } as DecisionPacket['options'][number],
          { option_key: 'two' } as DecisionPacket['options'][number],
        ],
      }),
    ).toBeNull();
  });

  it('AC-33 an intake lookup on an empty profile finds no match', () => {
    const { id } = createPendingDecision(root, input({ category: 'intake.requirement' }));
    resolvePendingDecision(root, id, 'one');
    expect(
      findIntakePriorMatch(root, {
        category: 'intake.requirement',
        question: 'Where should the helper script live?',
        options: [
          { option_key: 'one' } as DecisionPacket['options'][number],
          { option_key: 'two' } as DecisionPacket['options'][number],
        ],
        repoState: {},
      }),
    ).toBeNull();
  });

  it('AC-33 skips packets with an origin as well', () => {
    const { id } = createPendingDecision(root, input({ origin: 'fix-proof' }));
    resolvePendingDecision(root, id, 'one');
    const fingerprint = (resolved(id) as unknown as { fingerprint: string }).fingerprint;
    expect(
      new DecisionStore(root).findReusableDecision({
        fingerprint,
        category: 'workflow-or-tool',
        options: [],
      }),
    ).toBeNull();
  });

  it('AC-34 keeps a past-TTL file in resolved and its fingerprint in the index', () => {
    const { id } = createPendingDecision(root, input());
    resolvePendingDecision(root, id, 'one');
    const stored = resolved(id) as unknown as Record<string, unknown>;
    writeResolvedFile({ ...stored, ttl_until: '2020-01-01T00:00:00.000Z' }, id);
    rmSync(join(root, PATHS.DECISIONS_INDEX));
    const fingerprint = stored.fingerprint as string;
    const store = new DecisionStore(root);
    const options = [{ option_key: 'one' } as DecisionPacket['options'][number]];
    expect(
      store.findReusableDecision({ fingerprint, category: 'workflow-or-tool', options }),
    ).toBeNull();
    expect(
      store.findReusableDecision({
        fingerprint: 'sha256:other',
        category: 'workflow-or-tool',
        options,
      }),
    ).toBeNull();
    expect(existsSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, `${id}.json`))).toBe(true);
    expect(readIndex().fingerprints[fingerprint]).toBe(id);
  });

  it('AC-54 reuses an exact repeat of a store-shape answer', () => {
    const fingerprint = computeDecisionFingerprint({
      category: 'component-reuse',
      question: 'Use the shared button?',
      option_keys: ['new', 'reuse'],
      repo_state: {},
    });
    writeResolvedFile(storePacket({ fingerprint }), ID_A);
    expect(lookup(fingerprint)).toBe(ID_A);
  });

  it('treats a missing or corrupt file as not written by the writer', () => {
    const store = new DecisionStore(root);
    store.initialize();
    writeFileSync(
      join(root, PATHS.DECISIONS_INDEX),
      JSON.stringify({ fingerprints: { 'sha256:gone': ID_C }, decisions: {} }),
    );
    expect(lookup('sha256:gone')).toBeNull();
    expect(readIndex().fingerprints['sha256:gone']).toBeUndefined();
  });
});
