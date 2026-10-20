import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  TECH_DEBT_BLOCK_BEGIN,
  TECH_DEBT_BLOCK_END,
  closeTechDebt,
  escapeInline,
  promoteTechDebt,
  raiseTechDebt,
  reconcileTechDebtOverview,
  readDebtItems,
  refreshTechDebtOverview,
  renderTechDebtBlock,
  techDebtOverviewPath,
  upsertTechDebtBlock,
  type TechDebtItem,
} from '@/tech-debt/index.js';

const DIR = 'docs/instructions/tech-debt';

function item(id: string, createdAt: string, overrides: Partial<TechDebtItem> = {}): TechDebtItem {
  return {
    id,
    title: `Title ${id.slice(-1)}`,
    kind: 'debt',
    severity: 'low',
    status: 'open',
    files: [],
    found_in: { change: null, issue: null, stage: null },
    found_by: 'orchestrator',
    session: null,
    created_at: createdAt,
    reopened_at: null,
    issue: null,
    closed_reason: null,
    body: '',
    ...overrides,
  };
}

const OLD = item('TD-01M5CCWX6FTKY8C6EJKMR9EH3A', '2026-10-20T09:00:00.000Z');
const NEW = item('TD-01M5CCWX6FTKY8C6EJKMR9EH3B', '2026-10-20T10:00:00.000Z');
const CLOSED = item('TD-01M5CCWX6FTKY8C6EJKMR9EH3C', '2026-10-20T11:00:00.000Z', {
  status: 'closed',
});

function proseOutside(text: string): string {
  const begin = text.indexOf(TECH_DEBT_BLOCK_BEGIN);
  const end = text.indexOf(TECH_DEBT_BLOCK_END) + TECH_DEBT_BLOCK_END.length;
  return text.slice(0, begin) + text.slice(end);
}

describe('renderTechDebtBlock', () => {
  it('lists open items only, newest first, between the markers', () => {
    expect(renderTechDebtBlock([OLD, CLOSED, NEW])).toBe(
      [
        TECH_DEBT_BLOCK_BEGIN,
        '- [TD-01M5CCWX6FTKY8C6EJKMR9EH3B](TD-01M5CCWX6FTKY8C6EJKMR9EH3B.md) (debt, low): Title B',
        '- [TD-01M5CCWX6FTKY8C6EJKMR9EH3A](TD-01M5CCWX6FTKY8C6EJKMR9EH3A.md) (debt, low): Title A',
        TECH_DEBT_BLOCK_END,
      ].join('\n'),
    );
  });

  it('orders items raised in the same instant by id, newest id first', () => {
    const twin = { ...NEW, id: 'TD-01M5CCWX6FTKY8C6EJKMR9EH3D' };
    const block = renderTechDebtBlock([NEW, twin]);
    expect(block.indexOf(twin.id)).toBeLessThan(block.indexOf(NEW.id));
  });

  it('escapes a title that holds a newline or a marker', () => {
    const hostile = { ...NEW, title: `a\n---\n${TECH_DEBT_BLOCK_END} & <b>` };
    const block = renderTechDebtBlock([hostile]);
    expect(block.split(TECH_DEBT_BLOCK_END)).toHaveLength(2);
    expect(block.split(TECH_DEBT_BLOCK_BEGIN)).toHaveLength(2);
    expect(block.split('\n')).toHaveLength(3);
    expect(escapeInline(' x\r\ny ')).toBe('x y');
  });
});

describe('upsertTechDebtBlock', () => {
  const variants: Record<string, string> = {
    'LF with markers': `# Debt\n\nIntro.\n\n${TECH_DEBT_BLOCK_BEGIN}\nstale\n${TECH_DEBT_BLOCK_END}\n\nAfter.\n`,
    'CRLF with markers': `# Debt\r\n\r\n${TECH_DEBT_BLOCK_BEGIN}\r\n${TECH_DEBT_BLOCK_END}\r\nAfter.`,
    'no trailing newline with markers': `Intro.\n${TECH_DEBT_BLOCK_BEGIN}${TECH_DEBT_BLOCK_END}After.`,
    'no markers': '# Debt\n\nHand prose.\n',
    'no markers, no trailing newline': '# Debt\n\nHand prose.',
    'no markers, CRLF': '# Debt\r\n\r\nHand prose.\r\n',
  };

  for (const [name, fixture] of Object.entries(variants)) {
    it(`keeps the prose byte for byte and settles after one run (${name})`, () => {
      const once = upsertTechDebtBlock(fixture, [OLD, NEW]);
      const twice = upsertTechDebtBlock(once, [OLD, NEW]);
      expect(twice).toBe(once);
      expect(once.split(TECH_DEBT_BLOCK_BEGIN)).toHaveLength(2);
      expect(once.split(TECH_DEBT_BLOCK_END)).toHaveLength(2);
      const afterClose = upsertTechDebtBlock(once, [OLD, { ...NEW, status: 'closed' }]);
      expect(proseOutside(afterClose)).toBe(proseOutside(once));
      if (fixture.includes(TECH_DEBT_BLOCK_BEGIN)) {
        expect(proseOutside(once)).toBe(proseOutside(fixture));
      } else {
        expect(once.startsWith(fixture)).toBe(true);
      }
    });
  }

  it('uses CRLF inside the block for a CRLF file', () => {
    const out = upsertTechDebtBlock('# Debt\r\n', [NEW]);
    expect(out).toBe(
      `# Debt\r\n\r\n${TECH_DEBT_BLOCK_BEGIN}\r\n- [${NEW.id}](${NEW.id}.md) (debt, low): Title B\r\n${TECH_DEBT_BLOCK_END}\r\n`,
    );
  });

  it('creates a file holding only the block when there is no prose', () => {
    expect(upsertTechDebtBlock('', [])).toBe(`${TECH_DEBT_BLOCK_BEGIN}\n${TECH_DEBT_BLOCK_END}\n`);
  });
});

describe('reconcileTechDebtOverview', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-td-overview-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('prefers overview.md, falls back to index.md, and creates overview.md when neither exists', () => {
    expect(techDebtOverviewPath(root)).toBe(join(root, DIR, 'overview.md'));
    mkdirSync(join(root, DIR), { recursive: true });
    writeFileSync(join(root, DIR, 'index.md'), '# Index\n');
    expect(techDebtOverviewPath(root)).toBe(join(root, DIR, 'index.md'));
    writeFileSync(join(root, DIR, 'overview.md'), '# Overview\n');
    expect(techDebtOverviewPath(root)).toBe(join(root, DIR, 'overview.md'));
  });

  it('creates the overview with only the block, then rewrites nothing on a no-change run', () => {
    const first = reconcileTechDebtOverview(root, [NEW]);
    expect(first.written).toBe(true);
    expect(existsSync(join(root, DIR, 'overview.md'))).toBe(true);
    const past = Math.floor(Date.now() / 1000) - 60;
    utimesSync(first.path, past, past);
    const second = reconcileTechDebtOverview(root, [NEW]);
    expect(second.written).toBe(false);
    expect(Math.floor(statSync(first.path).mtimeMs / 1000)).toBe(past);
  });

  it('keeps index.md prose byte for byte across add, promote and close', () => {
    mkdirSync(join(root, DIR), { recursive: true });
    const prose = '# Tech debt\r\n\r\nKeep me exactly.';
    writeFileSync(join(root, DIR, 'index.md'), prose);
    const a = raiseTechDebt(root, { title: 'A', kind: 'bug', severity: 'high', files: [] });
    const b = raiseTechDebt(root, { title: 'B', kind: 'bug', severity: 'high', files: [] });
    promoteTechDebt(root, a.id, 'PQD-3');
    closeTechDebt(root, b.id, 'gone');
    raiseTechDebt(root, { title: 'A', kind: 'bug', severity: 'high', files: [] });
    const text = readFileSync(join(root, DIR, 'index.md'), 'utf8');
    expect(text.startsWith(prose)).toBe(true);
    expect(text.split(TECH_DEBT_BLOCK_BEGIN)).toHaveLength(2);
    expect(text).not.toContain(a.id);
    expect(existsSync(join(root, DIR, 'overview.md'))).toBe(false);
    expect(refreshTechDebtOverview(root).written).toBe(false);
    expect(readDebtItems(root)).toHaveLength(2);
  });
});
