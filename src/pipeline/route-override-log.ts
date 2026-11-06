import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sessionLedgerDir } from '@/session-ledger/ledger.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';

import type { RoutedWorkflow } from './routed-workflow.js';

const ROUTE_OVERRIDE_FILE = '.route-overrides.jsonl';

const ROUTE_OVERRIDE_SOURCES = ['agent-override', 'stage-start', 'lane-set'] as const;

export type RouteOverrideSource = (typeof ROUTE_OVERRIDE_SOURCES)[number];

export interface RouteOverrideRow {
  source: RouteOverrideSource;
  ts: string;
  hook_label: RoutedWorkflow | null;
  agent_label: RoutedWorkflow;
  reason?: string;
}

function overrideLogPath(projectRoot: string, sessionId: string): string {
  return join(
    projectRoot,
    sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, sessionId),
    ROUTE_OVERRIDE_FILE,
  );
}

export function appendRouteOverride(
  projectRoot: string,
  sessionId: string,
  input: {
    hookLabel: RoutedWorkflow | null;
    agentLabel: RoutedWorkflow;
    reason?: string;
    source?: RouteOverrideSource;
    now?: () => Date;
  },
): RouteOverrideRow {
  const row: RouteOverrideRow = {
    source: input.source ?? 'agent-override',
    ts: (input.now ?? (() => new Date()))().toISOString(),
    hook_label: input.hookLabel,
    agent_label: input.agentLabel,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };
  mkdirSync(join(projectRoot, sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, sessionId)), {
    recursive: true,
  });
  appendFileSync(overrideLogPath(projectRoot, sessionId), `${JSON.stringify(row)}\n`, 'utf8');
  return row;
}

export function readRouteOverrides(projectRoot: string, sessionId: string): RouteOverrideRow[] {
  let raw: string;
  try {
    raw = readFileSync(overrideLogPath(projectRoot, sessionId), 'utf8');
  } catch {
    return [];
  }
  const rows: RouteOverrideRow[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as RouteOverrideRow;
      if (
        parsed &&
        ROUTE_OVERRIDE_SOURCES.includes(parsed.source) &&
        typeof parsed.agent_label === 'string'
      ) {
        rows.push(parsed);
      }
    } catch {}
  }
  return rows;
}
