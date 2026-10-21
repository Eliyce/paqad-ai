import { slash } from './command-name';
import { formatStopwatch } from './cost';
import { STAGE_TIMELINE_KINDS, fixProofClaims } from './model';
import { shipRail } from './ship';
import type { TableLine, TableSegment } from './table';
import type {
  PaqadCiJob,
  PaqadClaim,
  PaqadGate,
  PaqadGateStrength,
  PaqadHudSnapshot,
  PaqadTimelineEntry,
  PaqadTone,
} from './types';

export const NO_GATES = 'No gates judged yet.';
export const NOTHING_PUSHED = 'Nothing pushed yet.';
export const NO_PLAN = 'No plan recorded yet.';

const NO_CHANGE = 'No change is in progress.';

const GATE_WORDS: Record<string, { word: string; tone?: PaqadTone; mark: string }> = {
  pass: { word: 'pass', tone: 'good', mark: '●' },
  fail: { word: 'fail', tone: 'bad', mark: '✗' },
  inconclusive: { word: 'inconclusive', tone: 'warn', mark: '~' },
  'did-not-run': { word: 'did not run', tone: 'warn', mark: '○' },
  'not-required': { word: 'not required', mark: '–' },
  'not-judged': { word: 'not judged yet', mark: '○' },
  pending: { word: 'pending', mark: '·' },
};

export const NOT_JUDGED = 'Not judged yet';
export const NOT_JUDGED_WHY =
  'Gates are judged after Build, Review and Checks. Nothing reads as a pass before that.';
export const CLAIMS_HEADING = 'Claims and the tests that prove them';
export const FLAGS_HEADING = 'Flags';

function gateWord(verdict: string): { word: string; tone?: PaqadTone; mark: string } {
  return GATE_WORDS[verdict] ?? GATE_WORDS.pending!;
}

const STRENGTH_GROUPS: ReadonlyArray<{ strength: PaqadGateStrength; label: string }> = [
  { strength: 'deterministic', label: 'Deterministic' },
  { strength: 'llm-judged', label: 'Judged by a model' },
  { strength: null, label: 'Strength not recorded' },
];

const VERDICT_TONE: Record<string, PaqadTone> = {
  pass: 'good',
  fail: 'bad',
  inconclusive: 'warn',
};

function line(...segments: Array<TableSegment | string>): TableLine {
  return segments.map((segment) => (typeof segment === 'string' ? { text: segment } : segment));
}

function heading(text: string): TableLine {
  return [{ text, dim: true }];
}

export function requiredGates(gates: readonly PaqadGate[]): PaqadGate[] {
  return gates.filter((gate) => gate.required && gate.verdict !== 'not-required');
}

export function gateRing(gates: readonly PaqadGate[]): TableLine {
  const required = requiredGates(gates);
  const passed = required.filter((gate) => gate.verdict === 'pass').length;
  const marks: TableSegment[] = required.map((gate) => {
    const { mark, tone } = gateWord(gate.verdict);
    return { text: mark, ...(tone ? { tone } : {}) };
  });
  return [
    { text: 'Gates ', dim: true },
    ...marks,
    { text: `  ${passed}/${required.length} required` },
  ];
}

const RING_COLOR: Record<string, string> = {
  pass: '#2e9d5b',
  fail: '#d0573f',
  inconclusive: '#d08b1e',
  'did-not-run': '#d08b1e',
};

export function gateRingAlt(gates: readonly PaqadGate[]): string {
  const required = requiredGates(gates);
  const passed = required.filter((gate) => gate.verdict === 'pass').length;
  const waiting = required.filter((gate) => gate.verdict === 'not-judged').length;
  return `Gates: ${passed} of ${required.length} required pass${waiting > 0 ? `, ${waiting} not judged yet` : ''}.`;
}

export function gateRingSvg(gates: readonly PaqadGate[]): { source: string; alt: string } {
  const required = requiredGates(gates);
  const size = 96;
  const centre = size / 2;
  const radius = 38;
  const n = Math.max(1, required.length);
  const arcs = required.map((gate, index) => {
    const from = ((index * 360) / n + 3 - 90) * (Math.PI / 180);
    const to = (((index + 1) * 360) / n - 3 - 90) * (Math.PI / 180);
    const point = (angle: number) =>
      `${(centre + radius * Math.cos(angle)).toFixed(2)} ${(centre + radius * Math.sin(angle)).toFixed(2)}`;
    const large = 360 / n - 6 > 180 ? 1 : 0;
    const color = RING_COLOR[gate.verdict] ?? 'silver';
    return `<path d="M ${point(from)} A ${radius} ${radius} 0 ${large} 1 ${point(to)}" stroke="${color}" stroke-width="10" fill="none"/>`;
  });
  const passed = required.filter((gate) => gate.verdict === 'pass').length;
  return {
    source: [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
      ...arcs,
      `<text x="${centre}" y="${centre + 5}" text-anchor="middle" font-size="14" fill="gray">${passed}/${required.length}</text>`,
      '</svg>',
    ].join(''),
    alt: gateRingAlt(gates),
  };
}

function gateLine(gate: PaqadGate): TableLine {
  const { word, tone, mark } = gateWord(gate.verdict);
  const settled = gate.verdict === 'not-required' || gate.verdict === 'not-judged';
  return [
    { text: `  ${mark} ${gate.name}  ` },
    { text: word, ...(tone ? { tone } : {}), ...(settled ? { dim: true } : {}) },
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
  if (!snapshot?.active) return [line(snapshot ? NO_CHANGE : NO_GATES)];
  const lines: TableLine[] = [];
  if (snapshot.verdict) {
    const tone = VERDICT_TONE[snapshot.verdict.kind];
    lines.push(
      line(
        { text: 'Verdict ', dim: true },
        { text: snapshot.verdict.word, ...(tone ? { tone } : {}) },
      ),
    );
  } else {
    lines.push(line({ text: NOT_JUDGED }), line({ text: NOT_JUDGED_WHY, dim: true }));
  }
  if (snapshot.gates.length === 0) {
    lines.push(line(NO_GATES));
  } else {
    lines.push(gateRing(snapshot.gates));
    for (const group of STRENGTH_GROUPS) {
      const gates = snapshot.gates.filter((gate) => gate.strength === group.strength);
      if (gates.length === 0) continue;
      lines.push(heading(group.label), ...gates.map(gateLine));
    }
  }
  const claims = fixProofClaims(snapshot);
  lines.push(
    heading(CLAIMS_HEADING),
    ...(claims.length > 0
      ? claims.map(claimLine)
      : [line({ text: '  No claim recorded for this change.', dim: true })]),
    heading(FLAGS_HEADING),
    ...(snapshot.flags.length > 0
      ? snapshot.flags.map((flag) => line({ text: '  flag ', tone: 'warn' }, flag.text))
      : [line({ text: '  No flag is open.', dim: true })]),
  );
  return lines;
}

function row(label: string, value: string, tone?: PaqadTone, dim = false): TableLine {
  return [
    { text: `${label.padEnd(13)}`, dim: true },
    { text: value, ...(tone ? { tone } : {}), ...(dim ? { dim: true } : {}) },
  ];
}

export const ON_THE_BRANCH = 'on the branch already';
export const MERGE_IS_YOURS = 'The merge is always yours. paqad never merges.';
export const EVERYTHING_GREEN = 'Everything is green';

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
  const state = ship.pr_state ?? 'state unknown';
  const tone: PaqadTone | undefined =
    ship.pr_state === 'merged' ? 'good' : ship.pr_state === 'closed' ? 'warn' : undefined;
  return row('Pull request', `${ship.pr} ${state}${ship.pr_url ? ` ${ship.pr_url}` : ''}`, tone);
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

function mergeRows(snapshot: PaqadHudSnapshot): TableLine[] {
  const rail = shipRail(snapshot);
  const ship = snapshot.ship!;
  if (rail.merged) return [row('Merge', 'merged by you', 'good')];
  if (rail.allGreen) {
    return [
      row('Merge', EVERYTHING_GREEN, 'good'),
      [
        {
          text: `  Open PR #${rail.prNumber ?? ''}`.trimEnd(),
          ...(ship.pr_url ? { href: ship.pr_url } : {}),
        },
      ],
    ];
  }
  return [row('Merge', MERGE_IS_YOURS, undefined, true)];
}

export function shipsLines(snapshot: PaqadHudSnapshot | null, now = 0): TableLine[] {
  const ship = snapshot?.active ? snapshot.ship : null;
  if (!snapshot?.active || !ship) return [line(NOTHING_PUSHED)];
  const lines: TableLine[] = [editRow(snapshot), ...commitRows(ship)];
  if (ship.push === null) lines.push(row('Push', 'not yet', undefined, true));
  else if (ship.push === 'failed') lines.push(row('Push', 'failed', 'bad'));
  else lines.push(row('Push', `${ship.push}${ship.push_branch ? ` to ${ship.push_branch}` : ''}`));
  lines.push(prRow(ship), ...ciRows(ship, now), ...mergeRows(snapshot));
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
