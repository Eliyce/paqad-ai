import { formatStopwatch, formatTokens, formatUsd } from './cost';
import { buildBandView, stageSegments, type BandView, type SegmentState } from './model';
import {
  registerBandBody,
  type BandBlock,
  type BandBody,
  type BandCell,
  type BandSegment,
  type BandSplitRow,
  type BodyContext,
} from './shell';
import { hasRuled, showsTable } from './table';
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

export function needsAnswers(snapshot: PaqadHudSnapshot, table: PaqadHighTable): boolean {
  return hasRuled(table) && snapshot.decisions.pending.length > 0;
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

function shipStatusWord(view: BandView): string | null {
  const running = view.ship.find((step) => step.word === 'running');
  if (running) return `${running.label} running`;
  const last = [...view.ship].reverse().find((step) => step.done);
  return last ? `${last.label} ${last.word}` : null;
}

export function shipInstrumentBlock(view: BandView): BandBlock {
  const status = shipStatusWord(view);
  return {
    key: 'paqad-instrument-ship',
    title: [
      { text: SHIP_NAME, dim: true, opens: 'ships', key: 'paqad-open-ship' },
      ...(status ? [{ text: `  ${status}` }] : []),
    ],
    cells: view.ship.map((step) =>
      cellOf(
        `paqad-ship-${step.label}`,
        step.done
          ? { text: '●', tone: 'good' }
          : step.word === 'running'
            ? { text: '▸', tone: 'working' }
            : { text: '○', dim: true },
        step.label,
        !step.done && step.word !== 'running',
      ),
    ),
    svg: null,
    note: null,
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
  const proving = snapshot.claims.filter((claim) => claim.test_id !== null).length;
  if (snapshot.claims.length > 0) {
    return `${proving} of ${snapshot.claims.length} criteria proven by tests`;
  }
  if (!snapshot.rules.recorded) return 'Rules not loaded yet';
  const findings = snapshot.findings?.rules.total ?? 0;
  return `${snapshot.rules.applicable ?? 0} rules loaded · ${findings} rule finding${findings === 1 ? '' : 's'}`;
}

export function footerRow(snapshot: PaqadHudSnapshot): BandSplitRow {
  return {
    left: [{ text: costLine(snapshot), dim: true, opens: 'cost', key: 'paqad-footer-cost' }],
    right: [{ text: trustSummary(snapshot), dim: true, opens: 'trust', key: 'paqad-footer-trust' }],
  };
}

export function featureDevelopmentBody(snapshot: PaqadHudSnapshot, context: BodyContext): BandBody {
  const view = buildBandView(snapshot, context.now);
  const table = tableInstrumentBlock(snapshot);
  return {
    blocks: [
      stageInstrument(snapshot, context.now),
      ...(table ? [table] : []),
      shipInstrumentBlock(view),
    ],
    footer: footerRow(snapshot),
  };
}

registerBandBody('feature-development', featureDevelopmentBody);
