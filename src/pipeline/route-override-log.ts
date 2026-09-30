// Route-override audit log (issue #580).
//
// The prompt seam's deterministic classifier writes a route label on every message. The
// agent routes by intent and can disagree — `paqad-ai route set <workflow>` corrects the
// ACTIVE per-session route. This module records that correction as a small, append-only
// audit trail so a wrong-label override is never silent.
//
// Deliberately NOT the stage-evidence ledger: that ledger lives inside a per-feature
// bundle, and opening a bundle for a correction TO a non-feature route would defeat the
// route-gate's whole purpose (feature-evidence only for feature-development). This log is
// session-scoped, in the same git-ignored session ledger dir as the workflow-state and
// pending-lane stores, and never opens a bundle. Best-effort: reads never throw.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sessionLedgerDir } from '@/session-ledger/ledger.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';

import type { RoutedWorkflow } from './routed-workflow.js';

const ROUTE_OVERRIDE_FILE = '.route-overrides.jsonl';

/** One recorded agent correction of the hook's route label (issue #580 FR-7). */
export interface RouteOverrideRow {
  /** Always `agent-override` — the row exists because the agent corrected the route. */
  source: 'agent-override';
  /** When the override was recorded (ISO-8601). */
  ts: string;
  /** The label the hook's deterministic classifier had recorded (null when unknown). */
  hook_label: RoutedWorkflow | null;
  /** The label the agent corrected the route to. */
  agent_label: RoutedWorkflow;
  /** The agent's plain-language reason, when given. */
  reason?: string;
}

function overrideLogPath(projectRoot: string, sessionId: string): string {
  return join(
    projectRoot,
    sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, sessionId),
    ROUTE_OVERRIDE_FILE,
  );
}

/** Append one `agent-override` row for `sessionId`. Creates the session dir on demand. */
export function appendRouteOverride(
  projectRoot: string,
  sessionId: string,
  input: {
    hookLabel: RoutedWorkflow | null;
    agentLabel: RoutedWorkflow;
    reason?: string;
    now?: () => Date;
  },
): RouteOverrideRow {
  const row: RouteOverrideRow = {
    source: 'agent-override',
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

/** Read every recorded override for `sessionId`, oldest first, or [] when absent/unreadable. */
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
      if (parsed && parsed.source === 'agent-override' && typeof parsed.agent_label === 'string') {
        rows.push(parsed);
      }
    } catch {
      // Skip a malformed line rather than throwing the whole read away.
    }
  }
  return rows;
}
