import { formatStopwatch, formatTokens, formatUsd } from './cost';
import { fixProofClaims, stageSegments, type SegmentState } from './model';
import {
  registerBandBody,
  type BandBlock,
  type BandBody,
  type BandCell,
  type BandSegment,
  type BandSplitRow,
  type BodyContext,
} from './shell';
import { RAIL_HEIGHT, RAIL_WIDTH, shipRail, shipRailSvg, type ShipStepState } from './ship';
import { hasRuled, showsTable } from './table';
import { readAgo } from './tabs';
import type { PaqadHighTable, PaqadHudSnapshot, PaqadSeat, PaqadTone } from './types';

export const STAGE_NAME = 'STAGE';
export const TABLE_NAME_CAPS = 'HIGH TABLE';
export const SHIP_NAME = 'SHIP';

export const STAGE_CELL_NAMES: Readonly<Record<string, string>> = {
  ticket_intake: 'Intake',
  planning: 'Plan',
  specification: 'Spec',
  development: 'Build',
  review: 'Review',
  checks: 'Checks',
  documentation_sync: 'Docs',
  delivery: 'Deliver',
};

export const STAGE_MARK: Record<SegmentState, { mark: string; tone?: PaqadTone; dim?: boolean }> = {
  done: { mark: '●', tone: 'good' },
  running: { mark: '▸', tone: 'working' },
  'not yet': { mark: '○', dim: true },
  'not required': { mark: '–', dim: true },
  failed: { mark: '✗', tone: 'bad' },
  marked: { mark: '◐', tone: 'warn' },
};

export const PAUSED_FOR_YOU = 'paused for you';

function cellName(stage: string): string {
  return STAGE_CELL_NAMES[stage] ?? stage;
}

export function stageStatus(snapshot: PaqadHudSnapshot, now: number): string {
  const segments = stageSegments(snapshot);
  const waiting = snapshot.decisions.pending.length > 0;
  const running = segments.find((segment) => segment.state === 'running');
  if (running) {
    if (waiting) return `${cellName(running.stage)} · ${PAUSED_FOR_YOU}`;
    const started = running.started_at ? Date.parse(running.started_at) : Number.NaN;
    return Number.isFinite(started)
      ? `${cellName(running.stage)} · ${formatStopwatch(now - started)}`
      : `${cellName(running.stage)} · running`;
  }
  if (waiting) return PAUSED_FOR_YOU;
  const done = [...segments].reverse().find((segment) => segment.state === 'done');
  return done ? `${cellName(done.stage)} · done` : 'not started';
}

function cellOf(key: string, top: BandSegment, name: string, dim: boolean): BandCell {
  return { key, top, bottom: { text: name, dim } };
}

export function stageInstrument(snapshot: PaqadHudSnapshot, now: number): BandBlock {
  const cells = stageSegments(snapshot).map((segment) => {
    const look = STAGE_MARK[segment.state];
    return cellOf(
      `paqad-stage-${segment.stage}`,
      {
        text: look.mark,
        ...(look.tone ? { tone: look.tone } : {}),
        ...(look.dim ? { dim: true } : {}),
      },
      cellName(segment.stage),
      segment.state === 'not yet' || segment.state === 'not required',
    );
  });
  return {
    key: 'paqad-instrument-stage',
    title: [
      { text: STAGE_NAME, dim: true, opens: 'record', key: 'paqad-open-stage' },
      { text: `  ${stageStatus(snapshot, now)}` },
    ],
    cells,
    svg: null,
    note: null,
  };
}

export const ROLE_INITIALS: Readonly<Record<string, string>> = {
  'product-owner': 'PO',
  'application-architect': 'AA',
  'qa-engineer': 'QA',
  'user-flow-writer': 'UF',
  'security-auditor': 'SA',
  'integration-architect': 'IA',
  'devops-engineer': 'DO',
  'chief-architect': 'CA',
};

export function roleInitials(role: string): string {
  const known = ROLE_INITIALS[role];
  if (known) return known;
  const words = role.split(/[-_\s]+/).filter(Boolean);
  const initials =
    words.length >= 2 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? role).slice(0, 2);
  return initials.toUpperCase();
}

const SEAT_LOOK: Record<PaqadSeat['state'], { mark: string; tone?: PaqadTone; dim?: boolean }> = {
  done: { mark: '●', tone: 'good' },
  writing: { mark: '◉', tone: 'working' },
  seated: { mark: '○', dim: true },
};

function specApproved(snapshot: PaqadHudSnapshot): boolean {
  const spec = snapshot.stages.find((stage) => stage.stage === 'specification');
  return spec?.state === 'complete' || spec?.state === 'redone';
}

const CONFLICT_CATEGORY = 'spec.expert_conflict';

export function needsAnswers(snapshot: PaqadHudSnapshot, table: PaqadHighTable): boolean {
  return (
    hasRuled(table) &&
    snapshot.decisions.pending.some((decision) => decision.category === CONFLICT_CATEGORY)
  );
}

export function tableStatus(snapshot: PaqadHudSnapshot, table: PaqadHighTable): string {
  if (table.skipped) return 'skipped';
  const seats = table.seats.length;
  const done = table.seats.filter((seat) => seat.state === 'done').length;
  const started = table.seats.some((seat) => seat.state !== 'seated');
  if (hasRuled(table)) {
    if (needsAnswers(snapshot, table)) return 'needs answers';
    return specApproved(snapshot) ? 'spec approved' : 'chief ruled';
  }
  if (table.chief?.state === 'writing' || (seats > 0 && done === seats && table.chief)) {
    return 'chief is ruling';
  }
  if (!started) return `${seats} standing`;
  return `${done} of ${seats} notes`;
}

export function tableInstrumentBlock(snapshot: PaqadHudSnapshot): BandBlock | null {
  if (!showsTable(snapshot)) return null;
  const table = snapshot.table;
  const title: BandSegment[] = [
    { text: TABLE_NAME_CAPS, dim: true, opens: 'table', key: 'paqad-open-table' },
    {
      text: `  ${tableStatus(snapshot, table)}`,
      ...(table.skipped || needsAnswers(snapshot, table) ? { tone: 'warn' as const } : {}),
    },
  ];
  if (table.skipped)
    return { key: 'paqad-instrument-table', title, cells: [], svg: null, note: null };
  const cells: BandCell[] = table.seats.map((seat) => {
    const look = SEAT_LOOK[seat.state];
    return cellOf(
      `paqad-seat-${seat.role}`,
      {
        text: look.mark,
        ...(seat.late ? { tone: 'warn' as const } : look.tone ? { tone: look.tone } : {}),
        ...(look.dim && !seat.late ? { dim: true } : {}),
      },
      roleInitials(seat.role),
      false,
    );
  });
  const ruled = hasRuled(table);
  const chiefTone: PaqadTone | undefined = needsAnswers(snapshot, table)
    ? 'needs-you'
    : ruled
      ? 'good'
      : undefined;
  cells.push(cellOf('paqad-seat-separator', { text: '│', dim: true }, ' ', true));
  cells.push(
    cellOf(
      'paqad-seat-chief',
      { text: ruled ? '◆' : '◇', ...(chiefTone ? { tone: chiefTone } : { dim: true }) },
      'CA',
      false,
    ),
  );
  return { key: 'paqad-instrument-table', title, cells, svg: null, note: null };
}

const RAIL_LOOK: Record<ShipStepState, { mark: string; tone?: PaqadTone; dim?: boolean }> = {
  done: { mark: '●', tone: 'good' },
  current: { mark: '▸', tone: 'working' },
  todo: { mark: '○', dim: true },
  failed: { mark: '✗', tone: 'bad' },
  closed: { mark: '✗', tone: 'warn' },
  ready: { mark: '◆', tone: 'good' },
  unknown: { mark: '?', tone: 'warn' },
};

export function inheritedNote(count: number): string | null {
  return count > 0 ? `+${count} already on the branch, not yours` : null;
}

export function shipInstrumentBlock(snapshot: PaqadHudSnapshot, context: BodyContext): BandBlock {
  const rail = shipRail(snapshot);
  const cells: BandCell[] = [];
  rail.steps.forEach((step, index) => {
    if (index > 0) {
      const reached = step.state !== 'todo';
      cells.push(
        cellOf(
          `paqad-ship-track-${index}`,
          reached ? { text: '─', tone: 'good' } : { text: '─', dim: true },
          ' ',
          true,
        ),
      );
    }
    const look = RAIL_LOOK[step.state];
    const word =
      step.label === 'Merge' && (step.state === 'ready' || step.state === 'todo')
        ? 'Merge (yours)'
        : step.label;
    cells.push(
      cellOf(
        `paqad-ship-${step.label}`,
        {
          text: look.mark,
          ...(look.tone ? { tone: look.tone } : {}),
          ...(look.dim ? { dim: true } : {}),
        },
        word,
        step.state === 'todo',
      ),
    );
  });
  const read =
    rail.prNumber !== null ? readAgo(snapshot.ship?.ci_read_at ?? null, context.now) : null;
  const notes = [read ? `CI ${read}` : null, inheritedNote(rail.inherited)].filter(
    (part): part is string => part !== null,
  );
  const note = notes.length > 0 ? notes.join(' · ') : null;
  return {
    key: 'paqad-instrument-ship',
    title: [
      { text: SHIP_NAME, dim: true, opens: 'ships', key: 'paqad-open-ship' },
      ...(rail.status
        ? [{ text: `  ${rail.status}`, ...(rail.allGreen ? { tone: 'good' as const } : {}) }]
        : []),
    ],
    cells,
    svg:
      context.surface === 'desktop'
        ? { ...shipRailSvg(rail), width: RAIL_WIDTH, height: RAIL_HEIGHT }
        : null,
    note: note ? [{ text: note, dim: true }] : null,
  };
}

export function costLine(snapshot: PaqadHudSnapshot): string {
  const cost = snapshot.cost;
  if (!cost) return 'Tokens: counting';
  const tokens = `${formatTokens(cost.tokens.total)} tokens`;
  if (cost.scope === 'whole-session') return `${tokens} · whole session`;
  return cost.usd === null ? tokens : `${tokens} · ~${formatUsd(cost.usd)} est.`;
}

export function trustSummary(snapshot: PaqadHudSnapshot): string {
  const claims = fixProofClaims(snapshot);
  const proving = claims.filter((claim) => claim.test_id !== null).length;
  if (claims.length > 0) {
    return `${proving} of ${claims.length} criteria proven by tests`;
  }
  const judged = snapshot.gates.some(
    (gate) => gate.verdict !== 'not-judged' && gate.verdict !== 'pending',
  );
  const prefix = judged ? '' : 'Not judged yet · ';
  if (!snapshot.rules.recorded) return `${prefix}rules not loaded yet`;
  const findings = snapshot.findings?.rules.total ?? 0;
  return `${prefix}${snapshot.rules.applicable ?? 0} rules loaded · ${findings} rule finding${findings === 1 ? '' : 's'}`;
}

export function footerRow(snapshot: PaqadHudSnapshot): BandSplitRow {
  return {
    left: [{ text: costLine(snapshot), dim: true, opens: 'cost', key: 'paqad-footer-cost' }],
    right: [{ text: trustSummary(snapshot), dim: true, opens: 'trust', key: 'paqad-footer-trust' }],
  };
}

export function featureDevelopmentBody(snapshot: PaqadHudSnapshot, context: BodyContext): BandBody {
  const table = tableInstrumentBlock(snapshot);
  return {
    blocks: [
      stageInstrument(snapshot, context.now),
      ...(table ? [table] : []),
      shipInstrumentBlock(snapshot, context),
    ],
    footer: footerRow(snapshot),
  };
}

registerBandBody('feature-development', featureDevelopmentBody);
