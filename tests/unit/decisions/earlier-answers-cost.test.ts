import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { createPendingDecision } from '@/decisions/authoring.js';
import { DecisionStore } from '@/planning/decision-store.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const FILES = 3000;
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-earlier-cost-'));
  const dir = join(root, PATHS.DECISIONS_RESOLVED_DIR);
  mkdirSync(dir, { recursive: true });
  for (let index = 0; index < FILES; index += 1) {
    const id = `D-01J${String(index).padStart(23, '0')}`;
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({
        id,
        category: 'workflow-or-tool',
        title: index % 600 === 0 ? 'where should release notes live' : `unrelated topic ${index}`,
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
        resolved_at: '2999-06-02T00:00:00.000Z',
      }),
    );
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function readsPerFile(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [path] of vi.mocked(readFileSync).mock.calls) {
    const text = String(path);
    if (text.includes(PATHS.DECISIONS_RESOLVED_DIR)) {
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  }
  return counts;
}

describe('AC-49 cost at 3,000 resolved files', () => {
  it('reads each file at most once per search, and the second backfill reads no packet', () => {
    vi.mocked(readFileSync).mockClear();
    const { path } = createPendingDecision(root, {
      category: 'ux-pattern',
      title: 'where should release notes live',
      context: 'now',
      options: [
        { option_key: 'one', label: 'One' },
        { option_key: 'two', label: 'Two' },
      ],
    });
    const opened = readsPerFile();
    expect(opened.size).toBe(FILES);
    expect(Math.max(...opened.values())).toBe(1);
    const stored = JSON.parse(readFileSync(path, 'utf8')) as {
      earlier_check: { candidates: string[] };
    };
    expect(stored.earlier_check.candidates).toHaveLength(5);

    const store = new DecisionStore(root);
    const lookup = { fingerprint: 'sha256:none', category: 'ux-pattern' as const, options: [] };
    vi.mocked(readFileSync).mockClear();
    expect(store.findReusableDecision(lookup)).toBeNull();
    const first = readsPerFile();
    expect(first.size).toBe(FILES);
    expect(Math.max(...first.values())).toBe(1);

    vi.mocked(readFileSync).mockClear();
    expect(store.findReusableDecision(lookup)).toBeNull();
    expect(readsPerFile().size).toBe(0);
  }, 60_000);
});
