import { flagPill, headlineAfterState, NOT_YET, type BandView, type SegmentState } from './model';
import { dotSegment, tableSummary, TABLE_NAME } from './table';
import type { PaqadHudSnapshot, PaqadPaneTab, PaqadTone } from './types';

export interface BandSegment {
  text: string;
  tone?: PaqadTone;
  dim?: boolean;
  opens?: PaqadPaneTab;
}

export type BandRow = BandSegment[];

const ELLIPSIS = '…';

const SEGMENT_MARK: Record<SegmentState, string> = {
  done: '✓',
  running: '▸',
  marked: '~',
  failed: '✗',
  'not required': '-',
  'not yet': '·',
};

const SEGMENT_TONE: Partial<Record<SegmentState, PaqadTone>> = {
  done: 'good',
  running: 'working',
  marked: 'warn',
  failed: 'bad',
};

function stageSummary(view: BandView): string {
  if (view.stages.every((segment) => segment.state === NOT_YET)) return NOT_YET;
  const running = view.stages.find((segment) => segment.state === 'running');
  if (running) return `${running.label} running${view.clock ? ` ${view.clock}` : ''}`;
  const done = view.stages.filter((segment) => segment.state === 'done').length;
  return `${done} of ${view.stages.length} done`;
}

function headlineRow(view: BandView, withPills: boolean): BandRow {
  const row: BandRow = [
    { text: 'paqad', tone: view.tone },
    { text: ' · ' },
    { text: view.state, tone: view.tone },
  ];
  if (withPills) row.push({ text: ' · ' }, ...pills(view));
  const rest = headlineAfterState(view);
  if (rest) row.push({ text: ' · ' }, { text: rest });
  return row;
}

function stageRow(view: BandView): BandRow {
  const row: BandRow = [{ text: 'Stage', dim: true }, { text: `  ${stageSummary(view)}` }];
  if (view.stages.every((segment) => segment.state === NOT_YET)) return row;
  row.push({ text: '  ' });
  view.stages.forEach((segment, index) => {
    if (index > 0) row.push({ text: ' ' });
    row.push({
      text: `${SEGMENT_MARK[segment.state]}${segment.label}`,
      tone: SEGMENT_TONE[segment.state],
      dim: segment.state === 'not yet' || segment.state === 'not required',
    });
  });
  return row;
}

function tableRow(view: BandView): BandRow | null {
  const table = view.table;
  if (!table) return null;
  const label: BandSegment = { text: TABLE_NAME, dim: true, opens: 'table' };
  if (table.skipped) return [label, { text: ' skipped', tone: 'warn' }];
  if (table.dots.length === 0 && !table.chief) return [label, { text: `  ${NOT_YET}` }];
  const row: BandRow = [label];
  if (!table.ruled) row.push({ text: `  ${tableSummary(table)}` });
  row.push({ text: '  ' }, ...table.dots.map(dotSegment));
  if (table.chief) row.push({ text: ' chief ' }, dotSegment(table.chief));
  const flag = table.ruled ? flagPill(table.flags) : null;
  if (flag) row.push({ text: '  ' }, { text: flag, tone: 'warn' });
  return row;
}

function shipSummary(view: BandView): string {
  const running = view.ship.find((step) => step.word === 'running');
  if (running) return `${running.label} running`;
  const last = [...view.ship].reverse().find((step) => step.done);
  if (!last) return NOT_YET;
  return last.label === 'Commit' ? last.word : `${last.label} ${last.word}`;
}

function shipRow(view: BandView): BandRow {
  const row: BandRow = [{ text: 'Ship', dim: true }, { text: `   ${shipSummary(view)}  ` }];
  view.ship.forEach((step, index) => {
    if (index > 0) row.push({ text: ' ' });
    const mark = step.done ? '✓' : step.word === 'running' ? '▸' : '·';
    const label = step.label === 'Merge' && !step.done ? 'Merge (yours)' : step.label;
    row.push({
      text: `${mark}${label}`,
      tone: step.done ? 'good' : step.word === 'running' ? 'working' : undefined,
      dim: !step.done && step.word !== 'running',
    });
  });
  return row;
}

function pills(view: BandView): BandRow {
  const flag = flagPill(view.flags);
  const cost: BandSegment = { text: view.cost, dim: true, opens: 'cost' };
  return flag ? [{ text: flag, tone: 'warn' }, { text: ' · ' }, cost] : [cost];
}

export function rowText(row: BandRow): string {
  return row.map((segment) => segment.text).join('');
}

export function truncateRow(row: BandRow, columns: number): BandRow {
  const width = Math.max(1, Math.floor(columns));
  if ([...rowText(row)].length <= width) return row;
  const out: BandRow = [];
  let room = width - 1;
  for (const segment of row) {
    if (room <= 0) break;
    const chars = [...segment.text];
    const text = chars.slice(0, room).join('');
    out.push({ ...segment, text });
    room -= chars.length;
  }
  out.push({ text: ELLIPSIS });
  return out.filter((segment) => segment.text.length > 0);
}

export function layoutBand(view: BandView, size: { columns: number; maxRows: number }): BandRow[] {
  const maxRows = Math.max(1, Math.floor(size.maxRows));
  const table = tableRow(view);
  const instruments = [stageRow(view), ...(table ? [table] : []), shipRow(view)];
  const roomy = maxRows >= instruments.length + 2;
  const rows: BandRow[] = [headlineRow(view, !roomy), ...instruments];
  if (roomy) rows.push(pills(view));
  return rows.slice(0, maxRows).map((row) => truncateRow(row, size.columns));
}

const SPINNER_WORDS: Record<string, string> = {
  ticket_intake: 'Reading the ticket',
  planning: 'Planning',
  specification: 'Writing the spec',
  development: 'Building',
  review: 'Reviewing',
  checks: 'Running checks',
  documentation_sync: 'Syncing the docs',
  delivery: 'Delivering',
};

export function spinnerWord(snapshot: PaqadHudSnapshot | null): string | null {
  if (!snapshot?.active) return null;
  const running = snapshot.stages.find((stage) => stage.state === 'running');
  return running ? (SPINNER_WORDS[running.stage] ?? null) : null;
}

export function laneMode(snapshot: PaqadHudSnapshot | null): string | null {
  return snapshot?.active && snapshot.lane ? `paqad ${snapshot.lane} lane` : null;
}
