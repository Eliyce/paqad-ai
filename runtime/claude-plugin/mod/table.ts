import { formatClock, formatTokens, fullTokens, roleWords } from './cost';
import type {
  PaqadChief,
  PaqadHighTable,
  PaqadHudSnapshot,
  PaqadSeat,
  PaqadSeatState,
  PaqadTone,
  PaqadTrackRecord,
} from './types';

export const TABLE_NAME = 'High Table';
export const WHO_SHAPED = 'Who shaped the spec';
export const CREDITS_LATER =
  'Shown when the spec is frozen: each spec line with the experts who shaped it.';
export const CHIEF_WORDS = 'Chief architect';
export const SKIPPED_TEXT =
  'High Table skipped: the spec was written by hand while the pipeline was on.';

export interface TableSegment {
  text: string;
  tone?: PaqadTone;
  dim?: boolean;
  href?: string;
}

export type TableLine = TableSegment[];

export const SEAT_MARK: Record<PaqadSeatState, string> = {
  seated: '○',
  writing: '◐',
  done: '●',
};

const SEAT_TONE: Record<PaqadSeatState, PaqadTone | undefined> = {
  seated: undefined,
  writing: 'working',
  done: 'good',
};

export const SEAT_COLOR = {
  done: '#2e9d5b',
  writing: '#3b7dd8',
  seated: '#8a8a8a',
  late: '#d08b1e',
} as const;

const CONFLICT_CATEGORY = 'spec.expert_conflict';

const ms = (iso: string | null): number => (iso ? Date.parse(iso) : Number.NaN);

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function showsTable(
  snapshot: PaqadHudSnapshot | null,
): snapshot is PaqadHudSnapshot & { table: PaqadHighTable } {
  return snapshot?.active === true && snapshot.lane !== 'fast' && snapshot.table !== null;
}

export function hasRuled(table: PaqadHighTable): boolean {
  return table.chief?.state === 'done' && table.chief.verdict !== null;
}

function specFrozen(snapshot: PaqadHudSnapshot): boolean {
  const spec = snapshot.stages.find((stage) => stage.stage === 'specification');
  return spec?.state === 'complete' || spec?.state === 'redone';
}

export function isOpenConflict(snapshot: PaqadHudSnapshot, target: string): boolean {
  return snapshot.decisions.pending.some(
    (decision) => decision.category === CONFLICT_CATEGORY && decision.question.includes(target),
  );
}

export function tableFlags(snapshot: PaqadHudSnapshot & { table: PaqadHighTable }): number {
  const table = snapshot.table;
  const late =
    table.met_after_freeze || table.seats.some((seat) => seat.late) || table.chief?.late === true;
  const conflicts = (table.rulings?.conflicts ?? []).filter((conflict) =>
    isOpenConflict(snapshot, conflict.target),
  ).length;
  const gaps = specFrozen(snapshot) ? 0 : table.gaps.length;
  return (late ? 1 : 0) + conflicts + gaps;
}

export interface SeatDot {
  role: string;
  state: PaqadSeatState;
  late: boolean;
}

export interface TableInstrument {
  skipped: boolean;
  dots: SeatDot[];
  chief: SeatDot | null;
  ruled: boolean;
  writing: number;
  done: number;
  seated: number;
  chiefWriting: boolean;
  flags: number;
}

const dotOf = (seat: PaqadSeat): SeatDot => ({
  role: seat.role,
  state: seat.state,
  late: seat.late,
});

function instrumentOf(table: PaqadHighTable, flags: number): TableInstrument {
  const count = (state: PaqadSeatState) =>
    table.seats.filter((seat) => seat.state === state).length;
  return {
    skipped: table.skipped,
    dots: table.seats.map(dotOf),
    chief: table.chief ? dotOf(table.chief) : null,
    ruled: hasRuled(table),
    writing: count('writing'),
    done: count('done'),
    seated: count('seated'),
    chiefWriting: table.chief?.state === 'writing',
    flags,
  };
}

export function tableInstrument(snapshot: PaqadHudSnapshot | null): TableInstrument | null {
  if (!showsTable(snapshot)) return null;
  return instrumentOf(snapshot.table, tableFlags(snapshot));
}

export function tableSummary(instrument: TableInstrument): string {
  const parts: string[] = [];
  if (instrument.writing > 0) parts.push(`${instrument.writing} writing`);
  if (instrument.done > 0) parts.push(`${instrument.done} done`);
  if (instrument.seated > 0) parts.push(`${instrument.seated} seated`);
  if (instrument.chiefWriting) parts.push('the chief architect writing');
  const late = instrument.dots.filter((dot) => dot.late).length;
  if (late > 0) parts.push(`${late} late`);
  return parts.join(', ');
}

export function dotSegment(dot: SeatDot): TableSegment {
  return {
    text: SEAT_MARK[dot.state],
    tone: dot.late ? 'warn' : SEAT_TONE[dot.state],
    dim: dot.state === 'seated' && !dot.late,
  };
}

export function seatStateWords(seat: PaqadSeat, now: number): string {
  const started = ms(seat.started_at);
  if (seat.state === 'writing') {
    return Number.isFinite(started) ? `writing for ${formatClock(now - started)}` : 'writing';
  }
  if (seat.state === 'done') {
    const done = ms(seat.done_at);
    return Number.isFinite(started) && Number.isFinite(done)
      ? `done in ${formatClock(done - started)}`
      : 'done';
  }
  return 'seated';
}

export function noteTokens(seat: PaqadSeat): string | null {
  if (seat.tokens_estimate === null) return null;
  const budget =
    seat.budget_tokens !== null ? ` of its ${formatTokens(seat.budget_tokens)} budget` : '';
  return `Note: ~${formatTokens(seat.tokens_estimate)} tokens${budget}`;
}

export function runTokens(seat: PaqadSeat): string | null {
  if (!seat.tokens) return null;
  return `Run: ${formatTokens(seat.tokens.total)} tokens, mostly the code it read (${seat.tokens_exact ? 'exact' : 'estimate'})`;
}

export function seatTokens(seat: PaqadSeat): string | null {
  const parts = [noteTokens(seat), runTokens(seat)].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join('. ') : null;
}

const LATE_WORDS = 'late: its note landed after the spec was frozen';

function chiefStateWords(chief: PaqadChief, now: number): string {
  const words = seatStateWords(chief, now);
  return chief.state === 'done' && chief.verdict !== null
    ? `${words.replace(/^done/, 'ruled')}, verdict: ${chief.verdict}`
    : words;
}

function seatLine(seat: PaqadSeat, now: number, withReason: boolean): TableLine {
  const parts = [seatStateWords(seat, now)];
  const tokens = seatTokens(seat);
  if (tokens) parts.push(tokens);
  if (seat.findings !== null) parts.push(plural(seat.findings, 'finding'));
  const line: TableLine = [
    { text: '  ' },
    dotSegment(dotOf(seat)),
    { text: ` ${roleWords(seat.role)}: ${parts.join(', ')}` },
  ];
  if (seat.late) line.push({ text: `, ${LATE_WORDS}`, tone: 'warn' });
  if (withReason && seat.reason) line.push({ text: `. Why: ${seat.reason}`, dim: true });
  return line;
}

function chiefLine(chief: PaqadChief, now: number): TableLine {
  const parts = [chiefStateWords(chief, now)];
  const tokens = seatTokens(chief);
  if (tokens) parts.push(tokens);
  const line: TableLine = [
    { text: '  ' },
    dotSegment(dotOf(chief)),
    { text: ` ${CHIEF_WORDS}: ${parts.join(', ')}` },
  ];
  if (chief.late) line.push({ text: `, ${LATE_WORDS}`, tone: 'warn' });
  return line;
}

function findingsTotal(table: PaqadHighTable): number | null {
  const counted = table.seats.filter((seat) => seat.findings !== null);
  return counted.length === 0 ? null : counted.reduce((sum, seat) => sum + (seat.findings ?? 0), 0);
}

export function rulingCounts(table: PaqadHighTable): string {
  const rulings = table.rulings;
  const total = findingsTotal(table);
  const parts: string[] = [];
  if (total !== null) parts.push(plural(total, 'finding'));
  if (rulings) {
    parts.push(`${rulings.accepted.length} accepted`, `${rulings.declined.length} declined`);
    if (rulings.renames.length > 0) parts.push(`${rulings.renames.length} renamed`);
    if (rulings.conflicts.length > 0) parts.push(plural(rulings.conflicts.length, 'disagreement'));
    if (rulings.merged.length > 0) parts.push(`${rulings.merged.length} merged`);
    if (rulings.settled.length > 0) parts.push(`${rulings.settled.length} settled before`);
  }
  if (table.gaps.length > 0) parts.push(plural(table.gaps.length, 'gap'));
  return parts.join(', ');
}

export function isExpertsCall(tool: string, input: unknown): boolean {
  const command = (input as { command?: unknown } | null | undefined)?.command;
  return (
    tool === 'Bash' && typeof command === 'string' && /paqad-ai spec pipeline experts/.test(command)
  );
}

export function cardKey(snapshot: PaqadHudSnapshot | null): string {
  return snapshot?.change?.id ?? snapshot?.change?.issue ?? 'session';
}

export function tableCardLines(table: PaqadHighTable, now: number): TableLine[] {
  const ruled = hasRuled(table);
  if (table.skipped) {
    return [[{ text: TABLE_NAME, tone: 'warn' }, { text: SKIPPED_TEXT.slice(TABLE_NAME.length) }]];
  }
  const summary = ruled
    ? `the chief architect ruled: ${table.chief?.verdict ?? ''}`
    : tableSummary(instrumentOf(table, 0)) || 'nobody seated yet';
  const lines: TableLine[] = [
    [
      { text: TABLE_NAME, tone: ruled ? 'good' : 'working' },
      { text: ` · ${plural(table.seats.length, 'seat')} · ${summary}` },
    ],
    ...table.seats.map((seat) => seatLine(seat, now, false)),
  ];
  if (table.chief) lines.push(chiefLine(table.chief, now));
  else lines.push([{ text: `  ${SEAT_MARK.seated} ${CHIEF_WORDS}: not seated yet`, dim: true }]);
  if (ruled) {
    lines.push([{ text: `Verdict: ${table.chief?.verdict ?? ''}. ${rulingCounts(table)}.` }]);
  }
  if (table.met_after_freeze) {
    lines.push([
      {
        text: 'The High Table met after the spec was frozen, so no spec line is credited to it.',
        tone: 'warn',
      },
    ]);
  }
  return lines;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function decisionDate(id: string): string | null {
  const match = /^D-([0-9A-HJKMNP-TV-Z]{26})$/i.exec(id);
  if (!match) return null;
  let time = 0;
  for (const char of match[1]!.slice(0, 10).toUpperCase())
    time = time * 32 + CROCKFORD.indexOf(char);
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function originWords(origin: string | null): string | null {
  if (origin === 'standing') return 'a standing seat, always at the table';
  if (origin === 'detector') return 'picked for this change';
  return origin;
}

export interface TableSeatButton {
  role: string;
  key: string;
  label: string;
  selected: boolean;
}

export interface TablePaneView {
  svg: { source: string; alt: string };
  ring: TableLine[];
  seats: TableLine[];
  buttons: TableSeatButton[];
  detail: TableLine[];
  rulings: TableLine[];
}

export function seatKey(role: string): string {
  return `paqad-seat-${role}`;
}

const escapeXml = (text: string): string =>
  text.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);

function seatColor(seat: PaqadSeat): string {
  return seat.late ? SEAT_COLOR.late : SEAT_COLOR[seat.state];
}

function seatWords(seat: PaqadSeat): string {
  return `${roleWords(seat.role)} ${seat.state}${seat.late ? ', late' : ''}`;
}

export function tableSvg(table: PaqadHighTable): string {
  const size = 160;
  const centre = size / 2;
  const radius = 62;
  const gap = 6;
  const n = Math.max(1, table.seats.length);
  const arcs = table.seats.map((seat, index) => {
    const from = ((index * 360) / n + gap / 2 - 90) * (Math.PI / 180);
    const to = (((index + 1) * 360) / n - gap / 2 - 90) * (Math.PI / 180);
    const point = (angle: number) =>
      `${(centre + radius * Math.cos(angle)).toFixed(2)} ${(centre + radius * Math.sin(angle)).toFixed(2)}`;
    const large = 360 / n - gap > 180 ? 1 : 0;
    return `<path d="M ${point(from)} A ${radius} ${radius} 0 ${large} 1 ${point(to)}" stroke="${seatColor(seat)}" stroke-width="14" fill="none"><title>${escapeXml(seatWords(seat))}</title></path>`;
  });
  const chief = table.chief;
  const chiefColor = chief ? seatColor(chief) : SEAT_COLOR.seated;
  const chiefTitle = chief ? seatWords(chief) : `${CHIEF_WORDS} not seated yet`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
    ...arcs,
    `<circle cx="${centre}" cy="${centre}" r="28" fill="none" stroke="${chiefColor}" stroke-width="4"><title>${escapeXml(chiefTitle)}</title></circle>`,
    `<text x="${centre}" y="${centre + 5}" text-anchor="middle" font-size="13" fill="#888">Chief</text>`,
    '</svg>',
  ].join('');
}

export function tableAlt(table: PaqadHighTable): string {
  const chief = table.chief
    ? table.chief.state === 'done' && table.chief.verdict !== null
      ? `the chief architect at the centre, ruled: ${table.chief.verdict}`
      : `the chief architect at the centre, ${table.chief.state}`
    : 'the chief architect not seated yet';
  const seats = table.seats.map(seatWords).join(', ');
  return `The High Table: ${chief}. ${plural(table.seats.length, 'seat')} around it${seats ? `: ${seats}` : ''}.`;
}

function detailLines(seat: PaqadSeat | PaqadChief, now: number): TableLine[] {
  const isChief = 'verdict' in seat;
  const name = isChief ? CHIEF_WORDS : roleWords(seat.role);
  const origin = isChief ? 'chairs the table' : originWords(seat.origin);
  const lines: TableLine[] = [[{ text: origin ? `${name}, ${origin}.` : `${name}.` }]];
  if (seat.reason) lines.push([{ text: `Why: ${seat.reason}` }]);
  lines.push([
    { text: `State: ${isChief ? chiefStateWords(seat, now) : seatStateWords(seat, now)}.` },
  ]);
  const clamp =
    seat.clamped === true
      ? ', cut to the ceiling'
      : seat.clamped === false
        ? ', within the ceiling'
        : '';
  const note = noteTokens(seat);
  lines.push([
    {
      text: note
        ? `${note}${clamp}.`
        : seat.budget_tokens !== null
          ? `Note: not written yet, its budget is ${formatTokens(seat.budget_tokens)} tokens${clamp}.`
          : 'Note: not written yet.',
    },
  ]);
  const run = runTokens(seat);
  if (run) lines.push([{ text: `${run}.` }]);
  const record = seat.track_record;
  if (record) lines.push([{ text: trackRecordWords(record) }]);
  if (!isChief) {
    lines.push([
      {
        text: seat.findings === null ? 'Findings: not yet.' : `Findings: ${seat.findings}.`,
      },
    ]);
  }
  if (seat.late) {
    lines.push([
      {
        text: 'Late: its note landed after the spec was frozen, so it shaped no spec line.',
        tone: 'warn',
      },
    ]);
  }
  return lines;
}

export function trackRecordWords(record: PaqadTrackRecord): string {
  const parts = [
    `on ${plural(record.changes, 'earlier change')}`,
    `changed the spec on ${record.changed_spec}`,
  ];
  if (record.empty > 0) parts.push(`had nothing to add on ${record.empty}`);
  if (record.avg_tokens > 0) parts.push(`about ${fullTokens(record.avg_tokens)} tokens each`);
  return `Track record: ${parts.join(', ')}.`;
}

function settledLine(entry: { target: string; chosen: string; source: string }): TableLine {
  const date = decisionDate(entry.source);
  const where = entry.source ? ` in ${entry.source}` : '';
  const when = date ? ` on ${date}` : '';
  return [
    {
      text: `Settled before: ${entry.target}. Chosen: ${entry.chosen}. Decided${when}${where}, so nobody was asked again.`,
    },
  ];
}

function rulingLines(snapshot: PaqadHudSnapshot & { table: PaqadHighTable }): TableLine[] {
  const table = snapshot.table;
  const lines: TableLine[] = [[{ text: "The chief architect's rulings:" }]];
  const rulings = table.rulings;
  if (!hasRuled(table) || !rulings) {
    lines.push([{ text: '  Not yet. The chief architect rules once every seat has written.' }]);
  } else {
    lines.push([{ text: `  Verdict: ${table.chief?.verdict ?? ''}. ${rulingCounts(table)}.` }]);
    for (const declined of rulings.declined) {
      lines.push([{ text: `  Declined: ${declined.id}. Reason: ${declined.reason}` }]);
    }
    for (const rename of rulings.renames) {
      lines.push([{ text: `  Renamed: ${rename.id} now reads "${rename.target}".` }]);
    }
    for (const conflict of rulings.conflicts) {
      const open = isOpenConflict(snapshot, conflict.target);
      lines.push([
        open
          ? { text: `  Open disagreement: ${conflict.target}.`, tone: 'warn' }
          : { text: `  Disagreement: ${conflict.target}.` },
        {
          text: ` The chief architect recommends: ${conflict.recommendation}${conflict.rationale ? ` Why: ${conflict.rationale}` : ''}`,
        },
        ...(open ? [{ text: ' The choice is yours.' }] : []),
      ]);
    }
    for (const merged of rulings.merged) {
      lines.push([
        {
          text: `  Merged: ${merged.target}. The experts agree: ${merged.merged_claim}${merged.rationale ? ` Why: ${merged.rationale}` : ''}`,
        },
      ]);
    }
    for (const settled of rulings.settled) lines.push([{ text: '  ' }, ...settledLine(settled)]);
  }
  for (const gap of table.gaps) {
    lines.push([
      { text: `  Gap no expert covered: ${gap.area}. ${gap.why_it_matters}`.trimEnd() },
      ...(gap.question ? [{ text: ` Question for you: ${gap.question}` }] : []),
    ]);
  }
  for (const answered of table.questions?.auto_answered ?? []) {
    lines.push([
      {
        text: `  Answered from an earlier decision: ${answered.question} Source: ${answered.source || 'not recorded'}.`,
      },
    ]);
  }
  lines.push(...creditLines(snapshot));
  return lines;
}

function creditLines(snapshot: PaqadHudSnapshot & { table: PaqadHighTable }): TableLine[] {
  const table = snapshot.table;
  if (table.met_after_freeze) {
    return [
      [
        {
          text: 'Who shaped the spec: no spec line. The High Table met after the spec was frozen.',
          tone: 'warn',
        },
      ],
    ];
  }
  if (table.credits.length === 0) {
    return [
      [
        {
          text: specFrozen(snapshot)
            ? 'Who shaped the spec: no spec line came from an expert.'
            : WHO_SHAPED,
        },
      ],
      ...(specFrozen(snapshot) ? [] : [[{ text: CREDITS_LATER }]]),
    ];
  }
  return [
    [{ text: `Who shaped the spec (${plural(table.credits.length, 'line')}):` }],
    ...table.credits.map((credit): TableLine => [
      { text: `  ${credit.line}: ${credit.roles.map(roleWords).join(', ')}` },
    ]),
  ];
}

export function tablePaneView(
  snapshot: PaqadHudSnapshot & { table: PaqadHighTable },
  pickedSeat: string | null,
  now: number,
): TablePaneView {
  const table = snapshot.table;
  const everyone: Array<PaqadSeat | PaqadChief> = [
    ...table.seats,
    ...(table.chief ? [table.chief] : []),
  ];
  const picked = everyone.find((seat) => seat.role === pickedSeat) ?? everyone[0] ?? null;
  const ring: TableLine[] = [
    [
      { text: `${TABLE_NAME}: ` },
      ...(table.chief
        ? [dotSegment(dotOf(table.chief)), { text: ` ${CHIEF_WORDS} at the centre` }]
        : [{ text: `${CHIEF_WORDS} not seated yet`, dim: true }]),
      { text: `, ${plural(table.seats.length, 'seat')} around it` },
    ],
    [
      { text: '  ' },
      ...table.seats.flatMap((seat, index): TableSegment[] => [
        ...(index > 0 ? [{ text: ' ' }] : []),
        dotSegment(dotOf(seat)),
      ]),
      ...(table.seats.length > 0 ? [{ text: `  ${tableSummary(instrumentOf(table, 0))}` }] : []),
    ],
  ];
  return {
    svg: { source: tableSvg(table), alt: tableAlt(table) },
    ring,
    seats: [
      ...table.seats.map((seat) => seatLine(seat, now, true)),
      ...(table.chief ? [chiefLine(table.chief, now)] : []),
    ],
    buttons: everyone.map((seat) => {
      const label = 'verdict' in seat ? CHIEF_WORDS : roleWords(seat.role);
      const selected = seat === picked;
      return {
        role: seat.role,
        key: seatKey(seat.role),
        label: selected ? `${label} (shown)` : label,
        selected,
      };
    }),
    detail: picked ? detailLines(picked, now) : [],
    rulings: rulingLines(snapshot),
  };
}

export function noTableText(snapshot: PaqadHudSnapshot | null): string {
  if (!snapshot) return 'Not yet. paqad has no record for this session.';
  if (!snapshot.active) return 'No change is in progress, so there is no High Table to show.';
  if (snapshot.lane === 'fast') return 'The fast lane seats no High Table.';
  return 'No High Table for this change: the experts are off or not seated yet.';
}
