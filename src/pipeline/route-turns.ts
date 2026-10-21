import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { sessionLedgerDir } from '@/session-ledger/ledger.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';

import { ROUTED_WORKFLOWS, type RoutedWorkflow } from './routed-workflow.js';

export const ROUTE_TURNS_FILE = '.route-turns.jsonl';
export const ROUTE_TURNS_CAP = 2000;

export interface RouteTurn {
  at: string;
  workflow: RoutedWorkflow;
}

const VALID_WORKFLOWS = new Set<string>(ROUTED_WORKFLOWS);

export function routeTurnsPath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, sessionId), ROUTE_TURNS_FILE);
}

function toTurn(line: string): RouteTurn | null {
  try {
    const parsed = JSON.parse(line) as { at?: unknown; workflow?: unknown };
    if (
      typeof parsed.at === 'string' &&
      Number.isFinite(Date.parse(parsed.at)) &&
      typeof parsed.workflow === 'string' &&
      VALID_WORKFLOWS.has(parsed.workflow)
    ) {
      return { at: parsed.at, workflow: parsed.workflow as RoutedWorkflow };
    }
  } catch {
    return null;
  }
  return null;
}

export function readRouteTurns(projectRoot: string, sessionId: string): RouteTurn[] {
  let raw: string;
  try {
    raw = readFileSync(routeTurnsPath(projectRoot, sessionId), 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map(toTurn)
    .filter((turn): turn is RouteTurn => turn !== null);
}

export function appendRouteTurn(
  projectRoot: string,
  sessionId: string,
  turn: RouteTurn,
  cap: number = ROUTE_TURNS_CAP,
): void {
  const path = routeTurnsPath(projectRoot, sessionId);
  mkdirSync(join(projectRoot, sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, sessionId)), {
    recursive: true,
  });
  appendFileSync(path, `${JSON.stringify({ at: turn.at, workflow: turn.workflow })}\n`, 'utf8');
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  if (lines.length > cap) {
    writeFileSync(path, `${lines.slice(lines.length - cap).join('\n')}\n`, 'utf8');
  }
}

export function episodeStart(turns: readonly RouteTurn[], workflow: RoutedWorkflow): string | null {
  let start: string | null = null;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (turn.workflow !== workflow) {
      break;
    }
    start = turn.at;
  }
  return start;
}

export function turnRouteAt(turns: readonly RouteTurn[], at: string): RoutedWorkflow | null {
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) {
    return null;
  }
  let route: RoutedWorkflow | null = null;
  for (const turn of turns) {
    if (Date.parse(turn.at) > atMs) {
      break;
    }
    route = turn.workflow;
  }
  return route;
}
