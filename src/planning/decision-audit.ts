import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import type { DecisionCategory, DecisionIntent } from './decision-packet.js';

export const DECISION_AUDIT_EVENTS = [
  'decision-pending-written',
  'decision-resolved-by-human',
  'decision-resolved-by-rule',
  'decision-resolved-by-memoization',
  'decision-resolved-by-rag-confident',
  'decision-reused',
  'decision-expired',
  'decision-superseded',
  'decision-delegated',
  'undeclared-decision-flagged',
  'decision-discarded',
] as const;

export type DecisionAuditEventType = (typeof DECISION_AUDIT_EVENTS)[number];

export interface DecisionAuditEvent {
  event: DecisionAuditEventType;
  decision_id: string;
  fingerprint: string;
  task_session_id: string;
  provider: string;
  timestamp: string;
  category?: DecisionCategory;
  responded_by?: string;
  chosen_option_key?: string | null;
  intent?: DecisionIntent;
}

export function appendDecisionAuditEvent(projectRoot: string, event: DecisionAuditEvent): string {
  const path = join(projectRoot, PATHS.DECISIONS_AUDIT_LOG);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
  return path;
}

export function ensureDecisionAuditLog(projectRoot: string): string {
  const path = join(projectRoot, PATHS.DECISIONS_AUDIT_LOG);
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, '');
  }
  return path;
}

export function readDecisionAuditEvents(projectRoot: string): DecisionAuditEvent[] {
  const path = join(projectRoot, PATHS.DECISIONS_AUDIT_LOG);
  /* v8 ignore next 3 -- early return when audit log has not yet been created */
  if (!existsSync(path)) {
    return [];
  }

  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DecisionAuditEvent);
}
