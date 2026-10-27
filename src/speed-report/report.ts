import {
  AGENT_ORDER,
  BUCKET_MS,
  CATEGORY,
  OWNER_CATEGORY,
  ownerColumn,
  type AgentRole,
  type BusyCategory,
  type OwnerCategory,
  type RefusalLabel,
} from './classify.js';
import {
  isSafeId,
  readLedgerChanges,
  readTranscriptTimeline,
  resolveChangeDir,
  resolveTranscriptsRoot,
  sessionTranscripts,
  type ChangeWindow,
  type LedgerChange,
  type TranscriptRootOptions,
  type TranscriptTimeline,
} from './transcripts.js';

export const SPEED_REPORT_SCHEMA = 'paqad.speed-report/1';
export const NO_TRANSCRIPT = 'no transcript';
export const MEASURED = 'measured';
export const TOP_CATEGORY_COUNT = 5;

const REFUSAL_LABELS: readonly RefusalLabel[] = [
  CATEGORY.blockedTimeout,
  CATEGORY.blockedEntry,
  CATEGORY.blockedOther,
];

export class SpeedReportInputError extends Error {}

export interface SpeedReportOptions extends TranscriptRootOptions {
  projectRoot: string;
  change?: string;
  since?: string;
}

export interface EditGateStats {
  edits: number;
  median_ms: number;
  p90_ms: number;
  refused: Record<RefusalLabel, number>;
}

export interface MeasuredChange {
  change: string;
  title: string;
  lane: string;
  status: typeof MEASURED;
  window_start_ms: number;
  window_end_ms: number;
  size: { files: number; lines: number };
  busy_ms: number;
  development_ms: number;
  ceremony_ms: number;
  orchestrator_ms: number;
  other_agents_ms: number;
  owner_wait_ms: number;
  owner_wait: Record<OwnerCategory, number>;
  edit_gate: EditGateStats;
  test_runs: { whole_suite: number; targeted: number };
  categories: Record<string, number>;
  bad_lines: number;
}

export interface UnmeasuredChange {
  change: string;
  title: string;
  lane: string;
  status: typeof NO_TRANSCRIPT;
}

export type SpeedReportRow = MeasuredChange | UnmeasuredChange;

export interface LaneTotals {
  lane: string;
  changes: number;
  busy_ms: number;
  development_ms: number;
  ceremony_ms: number;
  orchestrator_ms: number;
  other_agents_ms: number;
  owner_wait_ms: number;
  edit_gate: EditGateStats;
  test_runs: { whole_suite: number; targeted: number };
}

export interface SpeedReport {
  schema: typeof SPEED_REPORT_SCHEMA;
  changes: SpeedReportRow[];
  totals: LaneTotals[];
  top_categories: Array<{ category: string; ms: number }>;
}

interface Span {
  start: number;
  end: number;
}

function clip(span: Span, window: ChangeWindow): Span | null {
  const start = Math.max(span.start, window.start);
  const end = Math.min(span.end, window.end);
  return end > start ? { start, end } : null;
}

function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

function totalLength(spans: readonly Span[]): number {
  return spans.reduce((sum, span) => sum + (span.end - span.start), 0);
}

class SpanCursor {
  private index = 0;

  constructor(private readonly spans: readonly Span[]) {}

  overlap(start: number, end: number): number {
    while (this.index < this.spans.length && this.spans[this.index]!.end <= start) this.index += 1;
    let sum = 0;
    for (let i = this.index; i < this.spans.length && this.spans[i]!.start < end; i += 1) {
      const span = this.spans[i]!;
      sum += Math.max(0, Math.min(span.end, end) - Math.max(span.start, start));
    }
    return sum;
  }
}

export interface Ownership {
  development: number;
  ceremony: number;
  orchestrator: number;
  other: number;
}

export function splitOwnership(
  busy: readonly Span[],
  byRole: ReadonlyMap<AgentRole, readonly Span[]>,
  window: ChangeWindow,
): Ownership {
  const owned: Ownership = { development: 0, ceremony: 0, orchestrator: 0, other: 0 };
  const union = new SpanCursor(mergeSpans(busy));
  const roles = AGENT_ORDER.filter((role) => byRole.has(role)).map((role) => ({
    role,
    cursor: new SpanCursor(mergeSpans(byRole.get(role)!)),
  }));
  const first = Math.floor(window.start / BUCKET_MS) * BUCKET_MS;
  for (let bucket = first; bucket < window.end; bucket += BUCKET_MS) {
    const start = Math.max(bucket, window.start);
    const end = Math.min(bucket + BUCKET_MS, window.end);
    const busyMs = union.overlap(start, end);
    if (busyMs <= 0) continue;
    const owner = roles.find((entry) => entry.cursor.overlap(start, end) > 0);
    if (owner) owned[ownerColumn(owner.role)] += busyMs;
  }
  return owned;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1]!;
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function emptyRefusals(): Record<RefusalLabel, number> {
  return Object.fromEntries(REFUSAL_LABELS.map((label) => [label, 0])) as Record<
    RefusalLabel,
    number
  >;
}

function editGateStats(latencies: number[], refusals: readonly RefusalLabel[]): EditGateStats {
  const sorted = [...latencies].sort((a, b) => a - b);
  const refused = emptyRefusals();
  for (const label of refusals) refused[label] += 1;
  return {
    edits: sorted.length,
    median_ms: Math.round(median(sorted)),
    p90_ms: Math.round(percentile(sorted, 0.9)),
    refused,
  };
}

interface ChangeSamples {
  latencies: number[];
  refusals: RefusalLabel[];
}

function inWindow(at: number, window: ChangeWindow): boolean {
  return at >= window.start && at <= window.end;
}

interface Measurement {
  row: MeasuredChange;
  samples: ChangeSamples;
}

function measureChange(
  ledger: LedgerChange,
  window: ChangeWindow,
  timelines: readonly TranscriptTimeline[],
): Measurement {
  const busy: Span[] = [];
  const byRole = new Map<AgentRole, Span[]>();
  const categories = new Map<BusyCategory, number>();
  const owner: Span[] = [];
  const ownerBy: Record<OwnerCategory, number> = {
    [OWNER_CATEGORY.away]: 0,
    [OWNER_CATEGORY.reading]: 0,
    [OWNER_CATEGORY.answering]: 0,
  };
  const files = new Set<string>();
  const samples: ChangeSamples = { latencies: [], refusals: [] };
  const testRuns = { whole_suite: 0, targeted: 0 };
  let lines = 0;
  let badLines = 0;
  for (const timeline of timelines) {
    badLines += timeline.badLines;
    const roleSpans = byRole.get(timeline.role) ?? [];
    for (const span of timeline.busy) {
      const clipped = clip(span, window);
      if (!clipped) continue;
      busy.push(clipped);
      roleSpans.push(clipped);
      const length = clipped.end - clipped.start;
      categories.set(span.category, (categories.get(span.category) ?? 0) + length);
    }
    if (roleSpans.length > 0) byRole.set(timeline.role, roleSpans);
    for (const span of timeline.owner) {
      const clipped = clip(span, window);
      if (!clipped) continue;
      owner.push(clipped);
      ownerBy[span.category] += clipped.end - clipped.start;
    }
    for (const edit of timeline.edits) {
      if (!inWindow(edit.start, window)) continue;
      samples.latencies.push(edit.end - edit.start);
      if (edit.refused !== null) samples.refusals.push(edit.refused);
      if (edit.filePath !== null) {
        files.add(edit.filePath);
        lines += edit.lines;
      }
    }
    for (const run of timeline.testRuns) {
      if (!inWindow(run.at, window)) continue;
      if (run.kind === 'whole-suite') testRuns.whole_suite += 1;
      else testRuns.targeted += 1;
    }
  }
  const ownership = splitOwnership(busy, byRole, window);
  const row: MeasuredChange = {
    change: ledger.change,
    title: ledger.title,
    lane: ledger.lane,
    status: MEASURED,
    window_start_ms: window.start,
    window_end_ms: window.end,
    size: { files: files.size, lines },
    busy_ms: totalLength(mergeSpans(busy)),
    development_ms: ownership.development,
    ceremony_ms: ownership.ceremony,
    orchestrator_ms: ownership.orchestrator,
    other_agents_ms: ownership.other,
    owner_wait_ms: totalLength(mergeSpans(owner)),
    owner_wait: ownerBy,
    edit_gate: editGateStats(samples.latencies, samples.refusals),
    test_runs: testRuns,
    categories: Object.fromEntries(
      [...categories.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    ),
    bad_lines: badLines,
  };
  return { row, samples };
}

function unmeasured(ledger: LedgerChange): UnmeasuredChange {
  return { change: ledger.change, title: ledger.title, lane: ledger.lane, status: NO_TRANSCRIPT };
}

export function parseSinceDate(value: string): number {
  const trimmed = value.trim();
  let iso = trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) iso = `${trimmed}T00:00:00Z`;
  else if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(trimmed)) iso = `${trimmed}Z`;
  const at = /^\d{4}-\d{2}-\d{2}/.test(iso) ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(at)) {
    throw new SpeedReportInputError(`paqad: --since is not a readable date: ${value}`);
  }
  return at;
}

function selectChanges(options: SpeedReportOptions): LedgerChange[] {
  if (options.change === undefined) return readLedgerChanges(options.projectRoot);
  const dirName = resolveChangeDir(options.projectRoot, options.change);
  if (dirName === null) {
    throw new SpeedReportInputError(`paqad: no change matches --change ${options.change}`);
  }
  return readLedgerChanges(options.projectRoot, [dirName]);
}

function laneTotals(lane: string, measurements: readonly Measurement[]): LaneTotals {
  const rows = measurements.map((entry) => entry.row);
  const latencies = measurements.flatMap((entry) => entry.samples.latencies);
  const refusals = measurements.flatMap((entry) => entry.samples.refusals);
  const sum = (pick: (row: MeasuredChange) => number): number =>
    rows.reduce((total, row) => total + pick(row), 0);
  return {
    lane,
    changes: rows.length,
    busy_ms: sum((row) => row.busy_ms),
    development_ms: sum((row) => row.development_ms),
    ceremony_ms: sum((row) => row.ceremony_ms),
    orchestrator_ms: sum((row) => row.orchestrator_ms),
    other_agents_ms: sum((row) => row.other_agents_ms),
    owner_wait_ms: sum((row) => row.owner_wait_ms),
    edit_gate: editGateStats(latencies, refusals),
    test_runs: {
      whole_suite: sum((row) => row.test_runs.whole_suite),
      targeted: sum((row) => row.test_runs.targeted),
    },
  };
}

function topCategories(rows: readonly MeasuredChange[]): Array<{ category: string; ms: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const [category, ms] of Object.entries(row.categories)) {
      totals.set(category, (totals.get(category) ?? 0) + ms);
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_CATEGORY_COUNT)
    .map(([category, ms]) => ({ category, ms }));
}

export function buildSpeedReport(options: SpeedReportOptions): SpeedReport {
  const since = options.since === undefined ? null : parseSinceDate(options.since);
  const root = resolveTranscriptsRoot(options);
  const cache = new Map<string, TranscriptTimeline | null>();
  const rows: SpeedReportRow[] = [];
  const measurements: Measurement[] = [];
  for (const ledger of selectChanges(options)) {
    if (since !== null && (ledger.window === null || ledger.window.start < since)) continue;
    const timelines: TranscriptTimeline[] = [];
    for (const session of ledger.sessions.filter(isSafeId)) {
      for (const source of sessionTranscripts(options.projectRoot, session, root)) {
        if (!cache.has(source.path)) cache.set(source.path, readTranscriptTimeline(source));
        const timeline = cache.get(source.path);
        if (timeline) timelines.push(timeline);
      }
    }
    if (ledger.window === null || timelines.length === 0) {
      rows.push(unmeasured(ledger));
      continue;
    }
    const measurement = measureChange(ledger, ledger.window, timelines);
    measurements.push(measurement);
    rows.push(measurement.row);
  }
  const lanes = [...new Set(measurements.map((entry) => entry.row.lane))].sort();
  return {
    schema: SPEED_REPORT_SCHEMA,
    changes: rows,
    totals: lanes.map((lane) =>
      laneTotals(
        lane,
        measurements.filter((entry) => entry.row.lane === lane),
      ),
    ),
    top_categories: topCategories(measurements.map((entry) => entry.row)),
  };
}

export function formatSpan(ms: number): string {
  if (ms < 60_000) {
    const seconds = ms / 1000;
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  }
  const minutes = ms / 60_000;
  if (minutes < 180) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%';
}

function fit(text: string, width: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const cut = flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
  return cut.padEnd(width);
}

const TITLE_WIDTH = 32;
const COLUMNS: ReadonlyArray<[string, number]> = [
  ['change', TITLE_WIDTH],
  ['lane', 10],
  ['size', 14],
  ['busy', 7],
  ['dev', 7],
  ['ceremony', 9],
  ['orch', 7],
  ['owner-wait', 11],
  ['edit p50/p90', 14],
  ['refused t/e/o', 14],
  ['tests w/t', 9],
];

function tableLine(cells: readonly string[]): string {
  return cells
    .map((cell, index) => fit(cell, COLUMNS[index]![1]))
    .join(' ')
    .trimEnd();
}

function refusedCell(refused: Record<RefusalLabel, number>): string {
  return REFUSAL_LABELS.map((label) => refused[label]).join('/');
}

function rowLine(row: SpeedReportRow): string {
  if (row.status === NO_TRANSCRIPT) return tableLine([row.title, row.lane, NO_TRANSCRIPT]);
  return tableLine([
    row.title,
    row.lane,
    `${row.size.files}f ${row.size.lines}l`,
    formatSpan(row.busy_ms),
    formatSpan(row.development_ms),
    formatSpan(row.ceremony_ms),
    formatSpan(row.orchestrator_ms),
    formatSpan(row.owner_wait_ms),
    `${formatSpan(row.edit_gate.median_ms)}/${formatSpan(row.edit_gate.p90_ms)}`,
    refusedCell(row.edit_gate.refused),
    `${row.test_runs.whole_suite}/${row.test_runs.targeted}`,
  ]);
}

function totalsLines(totals: LaneTotals): string[] {
  const other =
    totals.other_agents_ms > 0
      ? `, other agents ${percent(totals.other_agents_ms, totals.busy_ms)}`
      : '';
  const refused = totals.edit_gate.refused;
  return [
    `Totals (${totals.lane}): ${totals.changes} change(s), busy ${formatSpan(totals.busy_ms)}, ` +
      `development ${percent(totals.development_ms, totals.busy_ms)}, ` +
      `ceremony ${percent(totals.ceremony_ms, totals.busy_ms)}, ` +
      `orchestrator ${percent(totals.orchestrator_ms, totals.busy_ms)}${other}, ` +
      `owner wait ${formatSpan(totals.owner_wait_ms)}`,
    `Edit gate (${totals.lane}): median ${formatSpan(totals.edit_gate.median_ms)}, ` +
      `p90 ${formatSpan(totals.edit_gate.p90_ms)}, ` +
      `${refused[CATEGORY.blockedTimeout]} refused on timeout, ` +
      `${refused[CATEGORY.blockedEntry]} refused by the entry gate, ` +
      `${refused[CATEGORY.blockedOther]} refused by another gate`,
    `Test runs (${totals.lane}): ${totals.test_runs.whole_suite} whole-suite, ` +
      `${totals.test_runs.targeted} targeted`,
  ];
}

export function renderSpeedReport(report: SpeedReport): string {
  const measured = report.changes.filter((row) => row.status === MEASURED).length;
  const missing = report.changes.length - measured;
  const lines = [
    `paqad speed report  (${measured} change(s) with transcripts, ${missing} without)`,
    '',
    tableLine(COLUMNS.map(([name]) => name)),
    ...report.changes.map(rowLine),
  ];
  if (report.totals.length > 0) lines.push('');
  for (const totals of report.totals) lines.push(...totalsLines(totals));
  if (report.top_categories.length > 0) {
    lines.push(
      `Top busy categories: ${report.top_categories
        .map((entry) => `${entry.category} ${formatSpan(entry.ms)}`)
        .join(', ')}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
