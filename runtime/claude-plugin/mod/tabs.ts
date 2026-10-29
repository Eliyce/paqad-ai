import { slash } from './command-name';
import { formatStopwatch } from './cost';
import { STAGE_TIMELINE_KINDS, fixProofClaims } from './model';
import { shipRail } from './ship';
import type { TableLine, TableSegment } from './table';
import {
  NOTHING_TO_PROVE,
  OLD_RECORD_NOTE,
  STEP_MARKS,
  oldRecordGates,
  recordGapLines,
  repairLine,
  stageHasEvidence,
  trustStage,
  type TrustGateRow,
  type TrustStage,
  type WordTone,
} from './trust';
import type {
  PaqadCiJob,
  PaqadClaim,
  PaqadHudSnapshot,
  PaqadTimelineEntry,
  PaqadTone,
} from './types';

export const NOTHING_PUSHED = 'Nothing pushed yet.';

const NO_CHANGE = 'No change is in progress.';
export const NO_PLAN = 'No plan recorded yet.';

export const CLAIMS_HEADING = 'Claims and the tests that prove them';
export const FLAGS_HEADING = 'Flags';

const TERMINAL_TONE: Readonly<Record<WordTone, PaqadTone | null>> = {
  pass: 'good',
  fail: 'bad',
  cau: 'warn',
  acc: 'working',
  att: 'warn',
  dim: null,
};

function line(...segments: Array<TableSegment | string>): TableLine {
  return segments.map((segment) => (typeof segment === 'string' ? { text: segment } : segment));
}

function heading(text: string): TableLine {
  return [{ text, dim: true }];
}

function worded(text: string, tone: WordTone): TableSegment {
  const terminal = TERMINAL_TONE[tone];
  return terminal ? { text, tone: terminal } : { text, dim: true };
}

function stepLine(step: TrustStage['steps'][number]): TableLine {
  const mark = STEP_MARKS[step.mark];
  return [
    step.mark === 'failed' ? { text: `  ${mark} `, tone: 'bad' } : { text: `  ${mark} ` },
    step.mark === 'not-yet' ? { text: step.words, dim: true } : { text: step.words },
    ...(step.detail ? [{ text: `  ${step.detail}`, dim: true }] : []),
  ];
}

function gateRowLine(gate: TrustGateRow): TableLine {
  return [{ text: `    ${gate.words}  ` }, worded(gate.word, gate.tone)];
}

function stageLines(stage: TrustStage): TableLine[] {
  return [
    [
      { text: `${stage.words}  ` },
      worded(stage.mark ? `${stage.mark} ${stage.word}` : stage.word, stage.tone),
    ],
    ...stage.steps.map(stepLine),
    ...stage.gates.map(gateRowLine),
  ];
}

function claimLine(claim: PaqadClaim): TableLine {
  const passed = claim.verdict === 'pass';
  const name = claim.kind === 'fix-proof' ? 'Fix proof' : claim.kind;
  return [
    { text: `  ${name}: ${claim.label}  ` },
    { text: passed ? 'passed' : 'Inconclusive', tone: passed ? 'good' : 'warn' },
    {
      text: claim.test_id ? `  proving test ${claim.test_id}` : '  no proving test recorded',
      dim: true,
    },
  ];
}

export function trustLines(snapshot: PaqadHudSnapshot | null): TableLine[] {
  if (!snapshot?.active) return [line(NOTHING_TO_PROVE)];
  const proof = snapshot.proof ?? null;
  const stages = proof && proof.some(stageHasEvidence) ? proof.map(trustStage) : [];
  const gates = proof === null ? oldRecordGates(snapshot) : [];
  const repairs = repairLine(snapshot);
  const claims = fixProofClaims(snapshot);
  const lines: TableLine[] = [
    ...stages.flatMap(stageLines),
    ...(gates.length > 0 ? [line({ text: OLD_RECORD_NOTE, dim: true })] : []),
    ...gates.map(gateRowLine),
    ...recordGapLines(snapshot).map((gap) => line(gap)),
    ...(repairs ? [line({ text: repairs, dim: true })] : []),
    ...(claims.length > 0 ? [heading(CLAIMS_HEADING), ...claims.map(claimLine)] : []),
    ...(snapshot.flags.length > 0
      ? [
          heading(FLAGS_HEADING),
          ...snapshot.flags.map((flag) => line({ text: '  flag ', tone: 'warn' }, flag.text)),
        ]
      : []),
  ];
  return lines.length > 0 ? lines : [line(NOTHING_TO_PROVE)];
}

function row(label: string, value: string, tone?: PaqadTone, dim = false): TableLine {
  return [
    { text: `${label.padEnd(13)}`, dim: true },
    { text: value, ...(tone ? { tone } : {}), ...(dim ? { dim: true } : {}) },
  ];
}

export const ON_THE_BRANCH = 'on the branch already';

const JOB_DONE = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const JOB_FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED']);

function jobWord(job: PaqadCiJob): { mark: string; word: string; tone?: PaqadTone } {
  const outcome = (job.conclusion ?? job.status ?? '').toUpperCase();
  if (JOB_FAILED.has(outcome)) return { mark: '✗', word: 'failed', tone: 'bad' };
  if (JOB_DONE.has(outcome)) return { mark: '●', word: 'passed', tone: 'good' };
  return { mark: '▸', word: 'running', tone: 'working' };
}

function jobTime(job: PaqadCiJob, now: number): string | null {
  const started = job.started_at ? Date.parse(job.started_at) : Number.NaN;
  if (!Number.isFinite(started)) return null;
  const ended = job.completed_at ? Date.parse(job.completed_at) : Number.NaN;
  return formatStopwatch((Number.isFinite(ended) ? ended : now) - started);
}

export function readAgo(at: string | null, now: number): string | null {
  const read = at ? Date.parse(at) : Number.NaN;
  return Number.isFinite(read) ? `read ${formatStopwatch(now - read)} ago` : null;
}

function editRow(snapshot: PaqadHudSnapshot): TableLine {
  const state = shipRail(snapshot).steps[0]!.state;
  if (state === 'done') return row('Edit', 'done', 'good');
  if (state === 'current') return row('Edit', 'running', 'working');
  return row('Edit', 'not yet', undefined, true);
}

function commitRows(ship: NonNullable<PaqadHudSnapshot['ship']>): TableLine[] {
  if (ship.commit_list.length === 0) {
    return [
      ship.commits > 0
        ? row('Commits', `${ship.commits} of yours, no list recorded`)
        : row('Commits', 'none yet', undefined, true),
    ];
  }
  const own = ship.commit_list.filter((commit) => commit.own !== false).length;
  return [
    row('Commits', `${own} of yours`),
    ...ship.commit_list.map((commit): TableLine =>
      commit.own === false
        ? [
            { text: `  ${commit.sha} ${commit.subject}  `, dim: true },
            { text: ON_THE_BRANCH, dim: true },
          ]
        : [{ text: `  ${commit.sha} ${commit.subject}` }],
    ),
  ];
}

function prRow(ship: NonNullable<PaqadHudSnapshot['ship']>): TableLine {
  if (ship.pr === null || ship.pr_number === null) {
    return row('Pull request', 'not yet', undefined, true);
  }
  const state =
    ship.pr_state === 'merged' ? null : ship.pr_state === null ? 'state unknown' : ship.pr_state;
  const tone: PaqadTone | undefined = ship.pr_state === 'closed' ? 'warn' : undefined;
  const words = [ship.pr, state, ship.pr_url].filter((part): part is string => Boolean(part));
  return row('Pull request', words.join(' '), tone);
}

function ciRows(ship: NonNullable<PaqadHudSnapshot['ship']>, now: number): TableLine[] {
  const ci = ship.ci_detail ?? null;
  const ago = readAgo(ship.ci_read_at, now);
  const suffix = ago ? `, ${ago}` : '';
  if (!ci) return [row('CI', 'unknown, never recorded', 'warn')];
  const count = ci.total !== null ? `${ci.done ?? 0} of ${ci.total} done` : null;
  const head =
    ci.state === 'pass'
      ? row('CI', `passed${count ? `, ${count}` : ''}${suffix}`, 'good')
      : ci.state === 'fail'
        ? row('CI', `failed${count ? `, ${count}` : ''}${suffix}`, 'bad')
        : ci.state === 'pending'
          ? row('CI', `running${count ? `, ${count}` : ''}${suffix}`, 'working')
          : row('CI', `unknown${ci.reason ? `: ${ci.reason}` : ''}${suffix}`, 'warn');
  return [
    head,
    ...ci.jobs.map((job): TableLine => {
      const look = jobWord(job);
      const time = jobTime(job, now);
      return [
        { text: `  ${look.mark} `, ...(look.tone ? { tone: look.tone } : {}) },
        { text: `${job.name}  ${look.word}${time ? `  ${time}` : ''}` },
      ];
    }),
  ];
}

function openPrRows(ship: NonNullable<PaqadHudSnapshot['ship']>): TableLine[] {
  if (ship.pr_state !== 'open' || ship.pr_number === null || !ship.pr_url) return [];
  return [[{ text: `  Open PR #${ship.pr_number}`, href: ship.pr_url }]];
}

export function shipsLines(snapshot: PaqadHudSnapshot | null, now = 0): TableLine[] {
  const ship = snapshot?.active ? snapshot.ship : null;
  if (!snapshot?.active || !ship) return [line(NOTHING_PUSHED)];
  const lines: TableLine[] = [editRow(snapshot), ...commitRows(ship)];
  if (ship.push === null) lines.push(row('Push', 'not yet', undefined, true));
  else if (ship.push === 'failed') lines.push(row('Push', 'failed', 'bad'));
  else lines.push(row('Push', `${ship.push}${ship.push_branch ? ` to ${ship.push_branch}` : ''}`));
  lines.push(prRow(ship), ...openPrRows(ship), ...ciRows(ship, now));
  return lines;
}

const PLAN_FILE = 'plan.json';

export function recordLines(snapshot: PaqadHudSnapshot | null): TableLine[] {
  if (!snapshot?.active) return [line(snapshot ? NO_CHANGE : NO_PLAN)];
  const planned = snapshot.bundle_files.includes(PLAN_FILE);
  const { pending, resolved } = snapshot.decisions;
  const lines: TableLine[] = [
    planned ? row('Plan', `recorded in ${PLAN_FILE}`, 'good') : line(NO_PLAN),
    row(
      'Decisions',
      pending.length > 0
        ? `${pending.length} waiting, ${resolved} resolved`
        : `${resolved} resolved`,
      pending.length > 0 ? 'needs-you' : undefined,
    ),
    ...pending.map((decision) =>
      line({ text: `  ${decision.id} (${decision.category}) `, dim: true }, decision.question),
    ),
    snapshot.rules.recorded
      ? row('Rules', `${snapshot.rules.applicable ?? 0} apply, loaded`, 'good')
      : row('Rules', 'not loaded yet', 'warn'),
    snapshot.receipt
      ? row('Receipt', `written, see ${slash('receipt')}`, 'good')
      : row('Receipt', 'not yet, written at the end of a turn', undefined, true),
  ];
  const timeline = snapshot.timeline.filter((entry) => STAGE_TIMELINE_KINDS.has(entry.kind));
  if (timeline.length > 0) {
    lines.push(heading('Timeline'), ...timeline.map(timelineLine));
  }
  return lines;
}

const TIMELINE_STAGES: Readonly<Record<string, string>> = {
  ticket_intake: 'Intake',
  planning: 'Plan',
  specification: 'Spec',
  development: 'Build',
  review: 'Review',
  checks: 'Checks',
  documentation_sync: 'Docs',
  delivery: 'Deliver',
};

export function timelineWords(entry: PaqadTimelineEntry): string {
  const stage = entry.stage ? (TIMELINE_STAGES[entry.stage] ?? entry.stage) : 'A stage';
  const note = entry.note ? `: ${entry.note}` : '';
  if (entry.kind === 'open') return entry.note ? `Reopened${note}` : 'Change opened';
  if (entry.kind === 'close') return `Closed${note}`;
  if (entry.kind === 'stage_start') return `${stage} started`;
  return `${stage} ended${note}`;
}

function timelineLine(entry: PaqadTimelineEntry): TableLine {
  return [{ text: `  ${entry.at.slice(11, 16)}  `, dim: true }, { text: timelineWords(entry) }];
}

export function linesText(lines: readonly TableLine[]): string {
  return lines.map((entry) => entry.map((segment) => segment.text).join('')).join('\n');
}
