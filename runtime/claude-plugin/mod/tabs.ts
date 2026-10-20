import type { TableLine, TableSegment } from './table';
import type {
  PaqadClaim,
  PaqadCommitGroup,
  PaqadGate,
  PaqadGateStrength,
  PaqadHudSnapshot,
  PaqadTone,
} from './types';

export const NO_GATES = 'No gates judged yet.';
export const NOTHING_PUSHED = 'Nothing pushed yet.';
export const NO_PLAN = 'No plan recorded yet.';

const NO_CHANGE = 'No change is in progress.';

const GATE_WORDS: Record<string, { word: string; tone?: PaqadTone; mark: string }> = {
  pass: { word: 'passed', tone: 'good', mark: '●' },
  fail: { word: 'failed', tone: 'bad', mark: '✗' },
  inconclusive: { word: 'inconclusive', tone: 'warn', mark: '~' },
  'did-not-run': { word: 'did not run', tone: 'warn', mark: '○' },
  'not-required': { word: 'not required', mark: '-' },
  pending: { word: 'pending', mark: '·' },
};

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
    { text: `  ${passed} of ${required.length} required passed` },
  ];
}

function gateLine(gate: PaqadGate): TableLine {
  const { word, tone, mark } = gateWord(gate.verdict);
  const settled = gate.verdict === 'not-required';
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
  if (snapshot.claims.length > 0) lines.push(heading('Claims'), ...snapshot.claims.map(claimLine));
  if (snapshot.flags.length > 0) {
    lines.push(
      heading('Flags'),
      ...snapshot.flags.map((flag) => line({ text: '  flag ', tone: 'warn' }, flag.text)),
    );
  }
  return lines;
}

function commitWords(count: number): string {
  return `${count} commit${count === 1 ? '' : 's'}`;
}

function groupDetail(group: PaqadCommitGroup): string {
  const parts = [
    group.tickets.length > 0 ? `from ${group.tickets.join(', ')}` : null,
    group.merges > 0 ? `${group.merges} merge${group.merges === 1 ? '' : 's'}` : null,
    group.untagged > 0 ? `${group.untagged} with no ticket` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? `, ${parts.join(', ')}` : '';
}

function row(label: string, value: string, tone?: PaqadTone, dim = false): TableLine {
  return [
    { text: `${label.padEnd(13)}`, dim: true },
    { text: value, ...(tone ? { tone } : {}), ...(dim ? { dim: true } : {}) },
  ];
}

function ciRow(ship: NonNullable<PaqadHudSnapshot['ship']>): TableLine {
  const ci = ship.ci_detail ?? null;
  if (!ci) {
    if (ship.ci) return row('CI', ship.ci);
    return row('CI', 'unknown, never recorded', 'warn');
  }
  if (ci.state === 'pass') return row('CI', 'passed', 'good');
  if (ci.state === 'fail') return row('CI', 'failed', 'bad');
  if (ci.state === 'pending') {
    return row(
      'CI',
      ci.total !== null ? `running, ${ci.done ?? 0} of ${ci.total} done` : 'running',
      'working',
    );
  }
  return row('CI', `unknown${ci.reason ? `: ${ci.reason}` : ''}`, 'warn');
}

function hasShipped(ship: PaqadHudSnapshot['ship']): boolean {
  return (
    ship !== null &&
    (ship.commits > 0 || ship.push !== null || ship.pr !== null || ship.merge_commit !== null)
  );
}

function ridingAlongRow(inherited: PaqadCommitGroup | null): TableLine {
  if (!inherited) return row('Riding along', 'unknown', 'warn');
  if (inherited.count === 0) return row('Riding along', 'none', 'good');
  if (inherited.tickets.length === 0) {
    return row(
      'Riding along',
      `${commitWords(inherited.count)}, untagged, made before this change started`,
    );
  }
  return row('Riding along', `${commitWords(inherited.count)}${groupDetail(inherited)}`, 'warn');
}

export function shipsLines(snapshot: PaqadHudSnapshot | null): TableLine[] {
  const ship = snapshot?.active ? snapshot.ship : null;
  if (!ship || !hasShipped(ship)) return [line(NOTHING_PUSHED)];
  const own = ship.own ?? null;
  const lines: TableLine[] = [
    own
      ? row('Own', `${commitWords(own.count)}${groupDetail(own)}`)
      : row('Own', `${commitWords(ship.commits)}, split unknown`, 'warn'),
    ridingAlongRow(ship.inherited ?? null),
  ];
  if (ship.push === null) lines.push(row('Push', 'not yet', undefined, true));
  else if (ship.push === 'failed') lines.push(row('Push', 'failed', 'bad'));
  else lines.push(row('Push', `${ship.push}${ship.push_branch ? ` to ${ship.push_branch}` : ''}`));
  lines.push(
    ship.pr === null
      ? row('PR', 'not yet', undefined, true)
      : row('PR', `${ship.pr}${ship.pr_url ? ` ${ship.pr_url}` : ''}`),
  );
  lines.push(ciRow(ship));
  if (ship.merge_commit) {
    lines.push(
      row('Merge', `merged ${ship.merge_commit}`, 'good'),
      row('Rollback', `git revert -m 1 ${ship.merge_commit}`),
    );
  } else {
    lines.push(
      row('Merge', 'stays yours', undefined, true),
      row('Rollback', 'nothing merged, so nothing to undo', undefined, true),
    );
  }
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
      ? row('Receipt', 'written, see /paqad receipt', 'good')
      : row('Receipt', 'not yet, written at the end of a turn', undefined, true),
  ];
  return lines;
}

export function linesText(lines: readonly TableLine[]): string {
  return lines.map((entry) => entry.map((segment) => segment.text).join('')).join('\n');
}

export function deliveryInProgress(snapshot: PaqadHudSnapshot | null): boolean {
  if (!snapshot?.active) return false;
  if (snapshot.stages.some((stage) => stage.stage === 'delivery' && stage.state === 'running')) {
    return true;
  }
  return snapshot.ship?.ci_detail?.state === 'pending';
}
