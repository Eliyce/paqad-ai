import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  TECH_DEBT_BLOCK_BEGIN,
  TECH_DEBT_BLOCK_END,
  TechDebtError,
  addDebtItem,
  assertTechDebtId,
  closeTechDebt,
  isTechDebtId,
  listDebtItems,
  mintTechDebtId,
  normalizeDebtTitle,
  parseDebtItem,
  promoteTechDebt,
  raiseTechDebt,
  readDebtItem,
  readDebtItems,
  serializeDebtItem,
  techDebtItemPath,
  type TechDebtItem,
} from '@/tech-debt/index.js';

const DIR = 'docs/instructions/tech-debt';
const T0 = new Date('2026-10-20T09:00:00.000Z');
const T1 = new Date('2026-10-20T10:00:00.000Z');

function itemFiles(root: string): string[] {
  try {
    return readdirSync(join(root, DIR)).filter((name) => name.startsWith('TD-'));
  } catch {
    return [];
  }
}

function sample(overrides: Partial<TechDebtItem> = {}): TechDebtItem {
  return {
    id: 'TD-01M5CCWX6FTKY8C6EJKMR9EH3D',
    title: 'Stale cache hides edits',
    kind: 'bug',
    severity: 'medium',
    status: 'open',
    files: ['src/a.ts'],
    found_in: { change: '01M5CCWX6FTKY8C6EJKMR9EH3D', issue: '12', stage: 'review' },
    found_by: 'paqad-review',
    session: 'sess-1',
    created_at: T0.toISOString(),
    reopened_at: null,
    issue: null,
    closed_reason: null,
    body: 'Details here.',
    ...overrides,
  };
}

describe('tech-debt ids', () => {
  it('mints TD-<ULID> ids that pass the strict check', () => {
    const id = mintTechDebtId();
    expect(isTechDebtId(id)).toBe(true);
    expect(isTechDebtId('TD-1')).toBe(false);
    expect(isTechDebtId('D-01M5CCWX6FTKY8C6EJKMR9EH3D')).toBe(false);
  });

  it('refuses to build a path from an id that is not TD-<ULID>', () => {
    expect(() => assertTechDebtId('../../etc/passwd')).toThrow(TechDebtError);
    expect(() => techDebtItemPath('/root', 'TD-../x')).toThrow(/not a tech-debt id/);
  });
});

describe('item files', () => {
  it('round-trips an item through its front matter', () => {
    const item = sample();
    expect(parseDebtItem(serializeDebtItem(item))).toEqual(item);
  });

  it('keeps hostile title, file and agent values inside the front matter', () => {
    const item = sample({
      title: `line one\n---\n${TECH_DEBT_BLOCK_END}`,
      files: ['src/"quoted".ts'],
      found_by: 'agent\n---',
    });
    const text = serializeDebtItem(item);
    expect(text.split('\n').filter((line) => line === '---')).toHaveLength(2);
    expect(parseDebtItem(text)).toEqual(item);
  });

  it('parses CRLF files and fills defaults for missing optional fields', () => {
    const text =
      '---\r\nid: TD-01M5CCWX6FTKY8C6EJKMR9EH3D\r\ntitle: T\r\nkind: gap\r\nseverity: low\r\nstatus: promoted\r\nfound_in: null\r\n---\r\nno heading body\r\n';
    expect(parseDebtItem(text)).toEqual({
      id: 'TD-01M5CCWX6FTKY8C6EJKMR9EH3D',
      title: 'T',
      kind: 'gap',
      severity: 'low',
      status: 'promoted',
      files: [],
      found_in: { change: null, issue: null, stage: null },
      found_by: 'orchestrator',
      session: null,
      created_at: '',
      reopened_at: null,
      issue: null,
      closed_reason: null,
      body: 'no heading body',
    });
  });

  it('returns null for text that is not a valid item', () => {
    expect(parseDebtItem('no front matter')).toBeNull();
    expect(parseDebtItem('---\nid: x\n')).toBeNull();
    expect(parseDebtItem('---\n- a\n---\n')).toBeNull();
    expect(parseDebtItem('---\n: : :\n  bad: [\n---\n')).toBeNull();
    expect(parseDebtItem('---\nid: TD-1\ntitle: T\n---\n')).toBeNull();
    expect(
      parseDebtItem(
        '---\nid: TD-01M5CCWX6FTKY8C6EJKMR9EH3D\ntitle: T\nkind: nope\nseverity: low\nstatus: open\n---\n',
      ),
    ).toBeNull();
  });
});

describe('addDebtItem', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-td-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const base = {
    title: 'Stale cache hides edits',
    kind: 'bug',
    severity: 'medium',
    files: ['src/b.ts', 'src/a.ts'],
    body: 'Body text.',
  };

  it('writes one item with the change context and the default finder', () => {
    const result = addDebtItem(
      root,
      { ...base, foundIn: { change: 'CHG', issue: '7', stage: 'review' }, session: 's1' },
      T0,
    );
    expect(result.outcome).toBe('created');
    expect(isTechDebtId(result.id)).toBe(true);
    const stored = readDebtItem(root, result.id);
    expect(stored).toMatchObject({
      title: 'Stale cache hides edits',
      files: ['src/a.ts', 'src/b.ts'],
      found_in: { change: 'CHG', issue: '7', stage: 'review' },
      found_by: 'orchestrator',
      session: 's1',
      created_at: T0.toISOString(),
      status: 'open',
    });
  });

  it('nulls missing context and honours --agent', () => {
    const result = addDebtItem(root, { ...base, body: undefined, foundBy: 'paqad-review' }, T0);
    expect(result.item.found_in).toEqual({ change: null, issue: null, stage: null });
    expect(result.item.found_by).toBe('paqad-review');
    expect(result.item.session).toBeNull();
    expect(result.item.body).toBe('');
  });

  it('returns the existing id and writes nothing for the same title and files in another form', () => {
    const first = addDebtItem(root, base, T0);
    const before = readFileSync(techDebtItemPath(root, first.id), 'utf8');
    const second = addDebtItem(
      root,
      { ...base, title: '  STALE   cache\thides EDITS ', files: ['./src/a.ts', 'src/b.ts'] },
      T1,
    );
    expect(second).toMatchObject({ id: first.id, outcome: 'existing' });
    expect(itemFiles(root)).toHaveLength(1);
    expect(readFileSync(techDebtItemPath(root, first.id), 'utf8')).toBe(before);
  });

  it('writes a new item when the file set differs', () => {
    const first = addDebtItem(root, base, T0);
    const second = addDebtItem(root, { ...base, files: ['src/a.ts'] }, T1);
    expect(second.outcome).toBe('created');
    expect(second.id).not.toBe(first.id);
    expect(itemFiles(root)).toHaveLength(2);
  });

  it('treats a promoted match as existing', () => {
    const first = addDebtItem(root, base, T0);
    promoteTechDebt(root, first.id, 'PQD-1');
    expect(addDebtItem(root, base, T1)).toMatchObject({ id: first.id, outcome: 'existing' });
  });

  it('reopens a closed match with the same id instead of writing a new item', () => {
    const first = addDebtItem(root, base, T0);
    closeTechDebt(root, first.id, 'fixed elsewhere');
    const again = addDebtItem(root, base, T1);
    expect(again).toMatchObject({ id: first.id, outcome: 'reopened' });
    expect(readDebtItem(root, first.id)).toMatchObject({
      status: 'open',
      reopened_at: T1.toISOString(),
    });
    expect(itemFiles(root)).toHaveLength(1);
  });

  it('rejects an empty title, unknown kind or severity, and a file outside the project', () => {
    expect(() => addDebtItem(root, { ...base, title: '   ' })).toThrow(/--title/);
    expect(() => addDebtItem(root, { ...base, kind: 'oops' })).toThrow(/--kind must be one of/);
    expect(() => addDebtItem(root, { ...base, severity: 'huge' })).toThrow(/--severity/);
    expect(() => addDebtItem(root, { ...base, files: ['../escape.ts'] })).toThrow(
      /outside the project root/,
    );
    expect(itemFiles(root)).toHaveLength(0);
  });
});

describe('promote, close and list', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-td-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('records promotion and closure and refreshes the overview block', () => {
    const a = raiseTechDebt(
      root,
      { title: 'A', kind: 'debt', severity: 'low', files: [], foundIn: { change: 'C1' } },
      T0,
    );
    const b = raiseTechDebt(
      root,
      { title: 'B', kind: 'gap', severity: 'high', files: ['src/x.ts'], foundIn: { change: 'C2' } },
      T1,
    );
    const overview = (): string => readFileSync(join(root, DIR, 'overview.md'), 'utf8');
    expect(overview()).toContain(a.id);
    expect(overview().indexOf(b.id)).toBeLessThan(overview().indexOf(a.id));

    expect(promoteTechDebt(root, a.id, ' PQD-9 ')).toMatchObject({
      status: 'promoted',
      issue: 'PQD-9',
    });
    expect(overview()).not.toContain(a.id);

    expect(closeTechDebt(root, b.id, ' done ')).toMatchObject({
      status: 'closed',
      closed_reason: 'done',
    });
    expect(overview()).toBe(`${TECH_DEBT_BLOCK_BEGIN}\n${TECH_DEBT_BLOCK_END}\n`);

    expect(listDebtItems(root)).toEqual([]);
    expect(listDebtItems(root, { status: 'all' }).map((item) => item.id)).toEqual([b.id, a.id]);
    expect(listDebtItems(root, { status: 'promoted' }).map((item) => item.id)).toEqual([a.id]);
    expect(listDebtItems(root, { status: 'all', change: 'C2' }).map((item) => item.id)).toEqual([
      b.id,
    ]);
  });

  it('leaves the overview untouched when raise finds an existing item', () => {
    const input = { title: 'A', kind: 'debt', severity: 'low', files: [] };
    raiseTechDebt(root, input, T0);
    writeFileSync(join(root, DIR, 'overview.md'), 'hand edited\n');
    raiseTechDebt(root, input, T1);
    expect(readFileSync(join(root, DIR, 'overview.md'), 'utf8')).toBe('hand edited\n');
  });

  it('rejects an empty issue or reason, an unknown id and an unreadable item', () => {
    const a = raiseTechDebt(root, { title: 'A', kind: 'debt', severity: 'low', files: [] }, T0);
    expect(() => promoteTechDebt(root, a.id, ' ')).toThrow(/--issue/);
    expect(() => closeTechDebt(root, a.id, '')).toThrow(/--reason/);
    expect(() => readDebtItem(root, 'TD-01M5CCWX6FTKY8C6EJKMR9EH3E')).toThrow(/No tech-debt item/);
    writeFileSync(techDebtItemPath(root, a.id), 'garbage');
    expect(() => readDebtItem(root, a.id)).toThrow(/unreadable front matter/);
  });

  it('skips unreadable or misnamed item files and reads nothing from a missing folder', () => {
    expect(readDebtItems(root)).toEqual([]);
    mkdirSync(join(root, DIR), { recursive: true });
    writeFileSync(join(root, DIR, 'TD-bad.md'), 'garbage');
    writeFileSync(join(root, DIR, 'TD-01M5CCWX6FTKY8C6EJKMR9EH3E.md'), serializeDebtItem(sample()));
    writeFileSync(join(root, DIR, 'notes.md'), 'x');
    expect(readDebtItems(root)).toEqual([]);
  });

  it('normalizes titles for the duplicate key', () => {
    expect(normalizeDebtTitle('  Hello \n  World ')).toBe('hello world');
  });
});
