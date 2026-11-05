import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { stageLedgerEra } from '@/stage-evidence/ledger-era.js';
import { readRepairedReports, type RepairedReport } from '@/stage-evidence/report-repair.js';
import { RECIPE_INJECTED_KIND, SKILL_USED_KIND, STAGE_AGENT_KIND } from '@/stage-evidence/types.js';

export type HudRunTone = 'fail' | 'cau' | 'dim';

export interface HudStageRun {
  agent: string | null;
  recipe: string;
  report: string;
  tone: HudRunTone;
  turns: number | null;
  tokens_used: number | null;
  counting: boolean;
  runs: number;
  needs_look: boolean;
  footnote: string | null;
  line: string;
  short_line: string;
}

export const DOCKED_LINE_MAX = 46;

const REPORT_TONE: Readonly<Record<string, HudRunTone>> = {
  BLOCKED: 'fail',
  DONE_WITH_CONCERNS: 'cau',
  NEEDS_CONTEXT: 'cau',
};

function ranStage(row: SessionLedgerRow, stage: string): boolean {
  return (
    row.stage === stage || (Array.isArray(row.stages) && (row.stages as unknown[]).includes(stage))
  );
}

function recipeWord(rows: readonly SessionLedgerRow[], stage: string): string {
  const has = (kind: string) => rows.some((row) => row.kind === kind && row.stage === stage);
  if (has(SKILL_USED_KIND)) return 'proven';
  if (has(RECIPE_INJECTED_KIND)) return 'injected';
  return stageLedgerEra(rows, stage) === 'v3' ? 'none' : 'not recorded';
}

function reportWord(
  row: SessionLedgerRow | undefined,
  repaired: readonly RepairedReport[],
): string {
  if (row === undefined) return 'not yet known';
  const fixed = repaired.find((entry) => entry.agent_id === row.agent_id);
  if (fixed !== undefined && row.report_stated !== true) return fixed.report_status;
  if (row.report_source === 'none') return 'no report found';
  if (typeof row.report_source !== 'string' && row.report_stated !== true) return 'not recorded';
  return typeof row.report_status === 'string' ? row.report_status : 'not recorded';
}

function sum(rows: readonly SessionLedgerRow[], field: string): number | null {
  const values = rows
    .map((row) => row[field])
    .filter((value): value is number => typeof value === 'number');
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
}

function footnoteOf(row: SessionLedgerRow | undefined, report: string): string | null {
  if (row === undefined) return null;
  if (typeof row.decision === 'string' && row.decision !== '') return row.decision;
  return report === 'BLOCKED' && typeof row.reason === 'string' ? row.reason : null;
}

export function buildStageRun(
  rows: readonly SessionLedgerRow[],
  stage: string,
  lane: string | null,
): HudStageRun | null {
  if (lane === 'fast' || lane === 'graduated') return null;
  const agentRows = rows.filter((row) => row.kind === STAGE_AGENT_KIND && ranStage(row, stage));
  const recipe = recipeWord(rows, stage);
  if (agentRows.length === 0 && recipe !== 'proven' && recipe !== 'injected') return null;
  const completed = agentRows.filter((row) => row.event_status === 'completed');
  const latest = agentRows.at(-1);
  const running = latest?.event_status === 'started';
  const newest = running ? undefined : completed.at(-1);
  const report = reportWord(newest, readRepairedReports(rows));
  const turns = sum(completed, 'api_turns');
  const figure = running ? 'counting' : turns === null ? 'no turns recorded' : `${turns} turns`;
  const short_line = [recipe, report, figure].join(' · ');
  return {
    agent: typeof latest?.agent === 'string' ? latest.agent : null,
    recipe,
    report,
    tone: REPORT_TONE[report] ?? 'dim',
    turns,
    tokens_used: sum(completed, 'tokens_used'),
    counting: running,
    runs: new Set(agentRows.map((row) => row.agent_id ?? row.content_hash)).size,
    needs_look: report === 'BLOCKED',
    footnote: footnoteOf(newest, report),
    line: `${stage.replace(/_/gu, ' ')} · ${short_line}`,
    short_line,
  };
}

export function stagesWithAgentRows(rows: readonly SessionLedgerRow[]): string[] {
  const stages = new Set<string>();
  for (const row of rows) {
    if (row.kind !== STAGE_AGENT_KIND) continue;
    if (typeof row.stage === 'string') stages.add(row.stage);
    if (Array.isArray(row.stages)) {
      for (const stage of row.stages as unknown[]) {
        if (typeof stage === 'string') stages.add(stage);
      }
    }
  }
  return [...stages];
}
