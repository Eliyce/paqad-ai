import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDecisionCommand } from '@/cli/commands/decision.js';
import { createPendingDecision, resolvePendingDecision } from '@/decisions/authoring.js';
import {
  EARLIER_OUTPUT_MAX_CHARS,
  EARLIER_TITLE_LIMIT,
  findEarlierQuestions,
} from '@/decisions/earlier-answers.js';
import { jaccard } from '@/duplication/token-similarity.js';
import { normalizeDecisionQuestion } from '@/planning/decision-fingerprint.js';

const OPTIONS = [
  { option_key: 'a', label: 'Fix A' },
  { option_key: 'b', label: 'Fix B' },
];
const EVAL_TITLE =
  'The goal changed mid-build. Update the frozen spec and re-freeze, or keep it as-is?';
const REWORDED = 'Update frozen spec to cover refunds, or keep it?';

interface PrintedCheck {
  required: true;
  method: string;
  next: string;
  older_omitted?: number;
  titles: { id: string; category: string; question: string }[];
}

describe('agent-opened questions list earlier titles', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-titles-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<{ raw: string; err: string }> {
    vi.restoreAllMocks();
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line: string) => void err.push(String(line)));
    await createDecisionCommand().parseAsync([...args, '--project-root', root], { from: 'user' });
    vi.restoreAllMocks();
    return { raw: out.join('\n'), err: err.join('\n') };
  }

  async function open(title = 'Pick a shade for the top strip', ...extra: string[]) {
    const { raw } = await run(
      'create',
      '--category',
      'finding.triage',
      '--title',
      title,
      '--context',
      'Why this came up',
      '--option',
      'a=Fix A',
      '--option',
      'b=Fix B',
      ...extra,
    );
    const output = JSON.parse(raw) as { id: string; path: string; earlier_check?: PrintedCheck };
    return { raw, output, id: output.id, check: output.earlier_check };
  }

  function answer(title: string, why = 'The reason then'): string {
    const { id } = createPendingDecision(root, {
      category: 'ux-pattern',
      title,
      context: 'Why this came up then',
      options: OPTIONS,
    });
    resolvePendingDecision(root, id, 'b', why);
    return id;
  }

  function seed(count: number, title: (index: number) => string): string[] {
    const dir = join(root, '.paqad/decisions/resolved');
    mkdirSync(dir, { recursive: true });
    return Array.from({ length: count }, (_, index) => {
      const id = `D-01J${String(index).padStart(23, '0')}`;
      writeFileSync(
        join(dir, `${id}.json`),
        JSON.stringify({
          id,
          category: 'ux-pattern',
          title: title(index),
          context: 'Why then',
          options: OPTIONS,
          recommendation: null,
          created_at: '2999-01-01T00:00:00.000Z',
          status: 'resolved',
          chosen: 'a',
          rationale: 'r',
          resolved_at: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
        }),
      );
      return id;
    }).reverse();
  }

  function stored(id: string): {
    earlier_check?: { candidates: string[]; listed_by?: string; older_omitted?: number };
  } {
    return JSON.parse(readFileSync(join(root, '.paqad/decisions/pending', `${id}.json`), 'utf8'));
  }

  describe('AC-59 the reworded eval title', () => {
    it('scores 0.31, the word match finds nothing, and the check is still required', async () => {
      const earlier = answer(EVAL_TITLE);
      const words = (text: string): Set<string> =>
        new Set(normalizeDecisionQuestion(text).split(' ').filter(Boolean));
      expect(jaccard(words(EVAL_TITLE), words(REWORDED))).toBeCloseTo(0.31, 2);
      expect(findEarlierQuestions(root, { question: REWORDED })).toEqual([]);

      const { check, id } = await open(REWORDED);
      expect(check?.required).toBe(true);
      expect(check?.titles.map((row) => row.id)).toEqual([earlier]);
      expect(stored(id).earlier_check?.listed_by).toBe('titles');
    });

    it('AC-67 the same title from an automated caller has no earlier_check', () => {
      answer(EVAL_TITLE);
      const { path } = createPendingDecision(root, {
        category: 'finding.triage',
        title: REWORDED,
        context: 'Why',
        options: OPTIONS,
      });
      expect(JSON.parse(readFileSync(path, 'utf8'))).not.toHaveProperty('earlier_check');
    });
  });

  it('AC-58 an automated packet prints full candidates, the shipped method and no titles', async () => {
    const earlier = answer('Which colour should the banner use', 'Matches the brand');
    const { id } = createPendingDecision(root, {
      category: 'finding.triage',
      title: 'Which colour should banner use',
      context: 'Now',
      options: OPTIONS,
    });
    const printed = JSON.parse((await run('check', id)).raw).earlier_check;
    expect(printed).not.toHaveProperty('titles');
    expect(printed.candidates).toEqual([
      {
        id: earlier,
        category: 'ux-pattern',
        question: 'Which colour should the banner use',
        context: 'Why this came up then',
        chosen: 'b',
        chosen_label: 'Fix B',
        why: 'Matches the brand',
        resolved_at: expect.any(String),
      },
    ]);
    expect(printed.method).toContain('Treat shared wording as no evidence');
    expect(stored(id).earlier_check).toEqual({ status: 'required', candidates: [earlier] });
  });

  describe('AC-60 the newest 200 are offered', () => {
    it('counts the 201st under older_omitted and refuses it in suggest', async () => {
      const ids = seed(EARLIER_TITLE_LIMIT + 1, (index) => `q ${index}`);
      const { check, id } = await open();
      expect(check?.titles.map((row) => row.id)).toEqual(ids.slice(0, EARLIER_TITLE_LIMIT));
      expect(stored(id).earlier_check?.candidates).toEqual(ids.slice(0, EARLIER_TITLE_LIMIT));
      expect(check?.older_omitted).toBe(1);

      const omitted = ids[EARLIER_TITLE_LIMIT]!;
      const before = readFileSync(join(root, '.paqad/decisions/pending', `${id}.json`), 'utf8');
      const refused = await run(
        'suggest',
        id,
        '--earlier',
        omitted,
        '--option',
        'a',
        '--reason',
        'Fits',
      );
      expect(refused.err).toBe(`${omitted} was not offered for ${id}.`);
      expect(process.exitCode).toBe(1);
      expect(readFileSync(join(root, '.paqad/decisions/pending', `${id}.json`), 'utf8')).toBe(
        before,
      );
    });

    it('puts the greater id first on a tie and prints no older_omitted when all fit', async () => {
      const dir = join(root, '.paqad/decisions/resolved');
      const ids = seed(3, (index) => `q ${index}`);
      for (const id of ids) {
        const file = join(dir, `${id}.json`);
        const packet = JSON.parse(readFileSync(file, 'utf8'));
        writeFileSync(file, JSON.stringify({ ...packet, resolved_at: '2026-01-01T00:00:00.000Z' }));
      }
      const { check } = await open();
      expect(check?.titles.map((row) => row.id)).toEqual(ids);
      expect(check).not.toHaveProperty('older_omitted');
    });
  });

  describe('AC-62 what is never listed', () => {
    it('lists nothing that is not eligible and prints exactly id and path', async () => {
      const dir = join(root, '.paqad/decisions/pending');
      mkdirSync(dir, { recursive: true });
      const waiting = createPendingDecision(root, {
        category: 'ux-pattern',
        title: 'A question still waiting',
        context: 'c',
        options: OPTIONS,
      }).id;
      const expired = join(
        root,
        '.paqad/decisions/resolved',
        `${seed(1, () => 'expired')[0]}.json`,
      );
      writeFileSync(
        expired,
        JSON.stringify({
          ...JSON.parse(readFileSync(expired, 'utf8')),
          created_at: '2020-01-01T00:00:00.000Z',
        }),
      );
      const { output, id } = await open();
      expect(Object.keys(output).sort()).toEqual(['id', 'path']);
      expect(id).not.toBe(waiting);
      expect(stored(id)).not.toHaveProperty('earlier_check');
    });

    it('lists only the newer answer to a repeated question', async () => {
      const older = answer('Same question here');
      const dir = join(root, '.paqad/decisions/resolved');
      const file = join(dir, `${older}.json`);
      writeFileSync(
        file,
        JSON.stringify({
          ...JSON.parse(readFileSync(file, 'utf8')),
          resolved_at: '2026-01-01T00:00:00.000Z',
          human_response: undefined,
        }),
      );
      const newer = answer('Same question here');
      const { check } = await open();
      expect(check?.titles.map((row) => row.id)).toEqual([newer]);
    });

    it('lists the titles for a question that normalises to no words', async () => {
      const earlier = answer('Which colour should the banner use');
      const { check } = await open('the of and');
      expect(check?.titles.map((row) => row.id)).toEqual([earlier]);
    });
  });

  describe('AC-65 the printed size', () => {
    const longTitle = (index: number): string =>
      `${String(index).padStart(4, '0')} ${'x'.repeat(200)}`;

    it('cuts titles at 140, keeps method and next first, and holds the output to the limit', async () => {
      seed(EARLIER_TITLE_LIMIT, longTitle);
      const created = await open();
      for (const raw of [created.raw, (await run('check', created.id)).raw]) {
        expect(raw.length + 1).toBeLessThanOrEqual(EARLIER_OUTPUT_MAX_CHARS);
        expect(raw.indexOf('"method"')).toBeLessThan(raw.indexOf('"titles"'));
        expect(raw.indexOf('"next"')).toBeLessThan(raw.indexOf('"titles"'));
        expect(raw.indexOf('"older_omitted"')).toBeLessThan(raw.indexOf('"titles"'));
        const check = JSON.parse(raw).earlier_check as PrintedCheck;
        expect(check.method.length).toBeLessThanOrEqual(2000);
        expect(check.titles.length).toBeGreaterThan(0);
        expect(check.titles.length).toBeLessThan(EARLIER_TITLE_LIMIT);
        expect(check.older_omitted).toBe(EARLIER_TITLE_LIMIT - check.titles.length);
        for (const row of check.titles) {
          expect(Array.from(row.question)).toHaveLength(141);
          expect(row.question.endsWith('…')).toBe(true);
        }
      }
      expect(stored(created.id).earlier_check?.candidates).toEqual(
        created.check?.titles.map((row) => row.id),
      );
    });

    it('counts escaped characters, so a title full of quotes stays within the limit', async () => {
      seed(EARLIER_TITLE_LIMIT, (index) => `${index}${'"'.repeat(139)}`);
      const { raw, check } = await open();
      expect(raw.length + 1).toBeLessThanOrEqual(EARLIER_OUTPUT_MAX_CHARS);
      expect(check?.titles.length).toBeGreaterThan(0);
    });

    it('offers only printed rows: an unprinted answer is refused by suggest', async () => {
      const ids = seed(EARLIER_TITLE_LIMIT, longTitle);
      const { check, id } = await open();
      const unprinted = ids[check!.titles.length]!;
      const { err } = await run(
        'suggest',
        id,
        '--earlier',
        unprinted,
        '--option',
        'a',
        '--reason',
        'Fits',
      );
      expect(err).toContain('was not offered');
    });

    it('leaves a title of exactly 140 whole', async () => {
      const title = 'y'.repeat(140);
      seed(1, () => title);
      const { check } = await open();
      expect(check?.titles[0]?.question).toBe(title);
    });

    it('stays pretty-printed when there is no title list', async () => {
      const { raw } = await open();
      expect(raw).toContain('\n');
      expect(existsSync(JSON.parse(raw).path)).toBe(true);
    });
  });
});
