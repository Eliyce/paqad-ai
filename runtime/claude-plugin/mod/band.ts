// The band above the prompt, laid out as rows of text (issue #639, Part 9).
//
// Pure: `register.tsx` turns each row into one `Text` line. The same rows draw on the terminal
// and on Desktop. Every row fits `bodyColumns` and the band takes at most `maxRows` rows, cut
// at the end rather than wrapped. Each row says what it means in words, so it still reads with
// the colour gone: the colour only repeats what the words already say.

import { flagPill, headlineAfterState, NOT_YET, type BandView, type SegmentState } from './model';
import { dotSegment, tableSummary, TABLE_NAME } from './table';
import type { PaqadPaneTab, PaqadTone } from './types';

export interface BandSegment {
  text: string;
  /** The colour this part takes; absent for plain text. */
  tone?: PaqadTone;
  dim?: boolean;
  /**
   * Drawn as a plain Button that opens the paqad pane on this tab (Part 23: the cost pill opens
   * the Cost tab; Part 14: the High Table label opens the High Table tab). A plain Button draws
   * its label alone, so the row keeps its width.
   */
  opens?: PaqadPaneTab;
}

export type BandRow = BandSegment[];

const ELLIPSIS = '…';

/** A glyph beside each Stage segment's label; the summary in front says the same in words. */
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

/** The Stage instrument's words: the running stage and its clock, or the last one done. */
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

/**
 * The High Table instrument (Part 14), or `null` when the band has none (the fast lane, the
 * experts off). One dot per seat plus the chief, each state its own glyph, with a live count in
 * words while the table sits. Once the chief architect has ruled, only the dots remain, plus
 * "1 flag" while the table has an open flag. A skipped table says so.
 */
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

/** The Ship instrument's words: the furthest step recorded, or "not yet". */
function shipSummary(view: BandView): string {
  const running = view.ship.find((step) => step.word === 'running');
  if (running) return `${running.label} running`;
  const last = [...view.ship].reverse().find((step) => step.done);
  if (!last) return NOT_YET;
  // "3 commits" already says Commit; every other step reads as its label and its word.
  return last.label === 'Commit' ? last.word : `${last.label} ${last.word}`;
}

function shipRow(view: BandView): BandRow {
  const row: BandRow = [{ text: 'Ship', dim: true }, { text: `   ${shipSummary(view)}  ` }];
  view.ship.forEach((step, index) => {
    if (index > 0) row.push({ text: ' ' });
    const mark = step.done ? '✓' : step.word === 'running' ? '▸' : '·';
    // paqad never merges for you: until a merge is recorded, Merge says it stays yours.
    const label = step.label === 'Merge' && !step.done ? 'Merge (yours)' : step.label;
    row.push({
      text: `${mark}${label}`,
      tone: step.done ? 'good' : step.word === 'running' ? 'working' : undefined,
      dim: !step.done && step.word !== 'running',
    });
  });
  return row;
}

/** The flag pill (only while a flag is open) and the cost pill. */
function pills(view: BandView): BandRow {
  const flag = flagPill(view.flags);
  const cost: BandSegment = { text: view.cost, dim: true, opens: 'cost' };
  return flag ? [{ text: flag, tone: 'warn' }, { text: ' · ' }, cost] : [cost];
}

/** The text of one row, as it reads with the colour gone. */
export function rowText(row: BandRow): string {
  return row.map((segment) => segment.text).join('');
}

/** Cut a row to `columns`, ending in an ellipsis when anything was cut. Never wraps. */
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

/**
 * The band's rows, most important first: the headline (with the state in words), Stage, the High
 * Table (graduated and full lanes only), Ship, then the pills. When the rows cannot all fit, the
 * pills ride on the headline row instead, so the flag count is never the part that falls off.
 */
export function layoutBand(view: BandView, size: { columns: number; maxRows: number }): BandRow[] {
  const maxRows = Math.max(1, Math.floor(size.maxRows));
  const table = tableRow(view);
  const instruments = [stageRow(view), ...(table ? [table] : []), shipRow(view)];
  const roomy = maxRows >= instruments.length + 2;
  const rows: BandRow[] = [headlineRow(view, !roomy), ...instruments];
  if (roomy) rows.push(pills(view));
  return rows.slice(0, maxRows).map((row) => truncateRow(row, size.columns));
}
