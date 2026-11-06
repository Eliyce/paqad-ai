import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { createPendingDecision } from '@/decisions/authoring.js';
import {
  checkDecision,
  EARLIER_TITLE_LIMIT,
  findEarlierQuestions,
  formatCreateOutput,
  readEarlierAnswers,
} from '@/decisions/earlier-answers.js';
import { storeOptions } from '../../shared/store-packet.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const FILES = 3000;
const MATCH_EVERY = 300;
const QUESTION = 'where should release notes live';
let root: string;

function idFor(index: number): string {
  return `D-01J${String(index).padStart(23, '0')}`;
}

function resolvedAt(index: number): string {
  return new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString();
}

function contractPacket(id: string, title: string, index: number): object {
  return {
    id,
    category: 'workflow-or-tool',
    title,
    context: 'c',
    options: [
      { option_key: 'one', label: 'One' },
      { option_key: 'two', label: 'Two' },
    ],
    recommendation: null,
    created_at: '2999-06-01T00:00:00.000Z',
    status: 'resolved',
    chosen: 'one',
    rationale: 'r',
    resolved_at: resolvedAt(index),
  };
}

function storePacket(id: string, question: string, index: number): object {
  return {
    decision_id: id,
    fingerprint: `sha256:${id}`,
    category: 'component-reuse',
    question,
    context: 'c',
    options: storeOptions(['one', 'two']),
    confidence: 1,
    requested_by: 'test',
    task_session_id: 's',
    created_at: '2026-01-01T00:00:00.000Z',
    status: 'resolved',
    ttl_until: '2999-01-01T00:00:00.000Z',
    invalidation_watch: [],
    human_response: {
      chosen_option_key: 'one',
      intent: 'explicit',
      explanation_rounds_used: 0,
      responded_at: resolvedAt(index),
      responded_by: 'human',
      carry_over_scope: 'task',
    },
  };
}

function questionFor(index: number): string {
  if (index % MATCH_EVERY !== 0) return `unrelated topic number ${index}`;
  const reordered = QUESTION.split(' ').reverse();
  return index % (MATCH_EVERY * 2) === 0
    ? `${QUESTION} ${index}`
    : `${reordered.join(' ')} ${index}`;
}

function matchesNewestFirst(): string[] {
  return Array.from({ length: FILES }, (_, index) => index)
    .filter((index) => index % MATCH_EVERY === 0)
    .reverse()
    .slice(0, 5)
    .map(idFor);
}

function readsPerFile(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [path] of vi.mocked(readFileSync).mock.calls) {
    const text = String(path).replace(/\\/gu, '/');
    if (text.includes(PATHS.DECISIONS_RESOLVED_DIR)) {
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  }
  return counts;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-earlier-cost-'));
  const dir = join(root, PATHS.DECISIONS_RESOLVED_DIR);
  mkdirSync(dir, { recursive: true });
  for (let index = 0; index < FILES; index += 1) {
    const id = idFor(index);
    const isMatch = index % MATCH_EVERY === 0;
    const useStoreShape = isMatch ? index % (MATCH_EVERY * 2) !== 0 : index % 2 === 1;
    const packet = useStoreShape
      ? storePacket(id, questionFor(index), index)
      : contractPacket(id, questionFor(index), index);
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(packet));
  }
}, 60_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('AC-49 cost at 3,000 resolved files in both shapes', () => {
  it('finds the right matches in both shapes, reading each file once in one search', () => {
    vi.mocked(readFileSync).mockClear();
    const found = findEarlierQuestions(root, { question: QUESTION });
    const reads = readsPerFile();
    expect(reads.size).toBe(FILES);
    expect(Math.max(...reads.values())).toBe(1);
    expect(found.map((entry) => entry.id)).toEqual(matchesNewestFirst());
    expect(new Set(found.map((entry) => entry.category))).toEqual(
      new Set(['workflow-or-tool', 'component-reuse']),
    );
  }, 60_000);

  it('one open through createPendingDecision runs one search', () => {
    vi.mocked(readFileSync).mockClear();
    const { path } = createPendingDecision(root, {
      category: 'ux-pattern',
      title: QUESTION,
      context: 'now',
      options: [
        { option_key: 'one', label: 'One' },
        { option_key: 'two', label: 'Two' },
      ],
    });
    const reads = readsPerFile();
    expect(reads.size).toBe(FILES);
    expect(Math.max(...reads.values())).toBe(1);
    const stored = JSON.parse(readFileSync(path, 'utf8')) as {
      earlier_check: { candidates: string[] };
    };
    expect(stored.earlier_check.candidates).toEqual(matchesNewestFirst());
  }, 60_000);

  describe('the flagged open', () => {
    const newest200 = Array.from({ length: EARLIER_TITLE_LIMIT }, (_, index) =>
      idFor(FILES - 1 - index),
    );
    let id: string;

    it('runs one search, reads each file once and offers the newest 200', () => {
      vi.mocked(readFileSync).mockClear();
      const result = createPendingDecision(root, {
        category: 'ux-pattern',
        title: QUESTION,
        context: 'now',
        options: [
          { option_key: 'one', label: 'One' },
          { option_key: 'two', label: 'Two' },
        ],
        agentWorded: true,
      });
      id = result.id;
      const reads = readsPerFile();
      expect(reads.size).toBe(FILES);
      expect(Math.max(...reads.values())).toBe(1);
      const stored = JSON.parse(readFileSync(result.path, 'utf8')) as {
        earlier_check: { candidates: string[]; older_omitted: number };
      };
      expect(stored.earlier_check.candidates).toEqual(newest200);
      expect(stored.earlier_check.older_omitted).toBe(FILES - EARLIER_TITLE_LIMIT);

      vi.mocked(readFileSync).mockClear();
      const printed = formatCreateOutput(root, result) as {
        earlier_check: { titles: { id: string }[] };
      };
      expect(printed.earlier_check.titles.map((title) => title.id)).toEqual(newest200);
      expect(readsPerFile().size).toBeLessThanOrEqual(EARLIER_TITLE_LIMIT);
    }, 60_000);

    it('printing the check reads at most 200 files and --read at most 5', () => {
      vi.mocked(readFileSync).mockClear();
      checkDecision(root, id);
      expect(readsPerFile().size).toBeLessThanOrEqual(EARLIER_TITLE_LIMIT);

      vi.mocked(readFileSync).mockClear();
      expect(readEarlierAnswers(root, id, newest200.slice(0, 5)).read).toHaveLength(5);
      expect(readsPerFile().size).toBe(5);
    }, 60_000);
  });
});
