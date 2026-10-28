import { appendStampedRowToUnit, readUnitFile } from '@/session-ledger/ledger.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

import { stampBundleRow } from './envelope.js';
import { featureChangeKey, featureFilePath } from './paths.js';
import { FEATURE_DOC_SCHEMA_VERSION, RULE_OVERRIDE_DOC_TYPE } from './types.js';

export interface RuleOverrideRow {
  kind: 'rule-override';
  rule: string;
  file: string;
  tool_use_id: string | null;
  by: 'human';
  reason?: string;
  at: string;
  session: string;
}

export function appendRuleOverride(
  projectRoot: string,
  dirName: string,
  input: {
    rule: string;
    file: string;
    toolUseId: string | null;
    reason?: string;
    sessionId: string;
    now?: () => Date;
  },
): RuleOverrideRow {
  const at = (input.now ?? (() => new Date()))().toISOString();
  const row: RuleOverrideRow = {
    kind: 'rule-override',
    rule: input.rule,
    file: input.file,
    tool_use_id: input.toolUseId,
    by: 'human',
    ...(input.reason ? { reason: input.reason } : {}),
    at,
    session: input.sessionId,
  };
  const stamped = stampBundleRow({
    docType: RULE_OVERRIDE_DOC_TYPE,
    change: featureChangeKey(dirName),
    sessionId: input.sessionId,
    schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
    row: { ...row },
    now: () => new Date(at),
  }) as unknown as SessionLedgerRow;
  appendStampedRowToUnit(projectRoot, featureFilePath(dirName, 'ruleOverrides'), stamped);
  return row;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export function readRuleOverrides(projectRoot: string, dirName: string): RuleOverrideRow[] {
  return readUnitFile(projectRoot, featureFilePath(dirName, 'ruleOverrides')).flatMap((raw) => {
    const row = raw as unknown as Record<string, unknown>;
    const rule = str(row.rule);
    const file = str(row.file);
    const at = str(row.at);
    const session = str(row.session);
    if (row.kind !== 'rule-override' || !rule || !file || !at || !session) return [];
    const reason = str(row.reason);
    return [
      {
        kind: 'rule-override' as const,
        rule,
        file,
        tool_use_id: str(row.tool_use_id),
        by: 'human' as const,
        ...(reason ? { reason } : {}),
        at,
        session,
      },
    ];
  });
}

export const EDIT_OUTCOMES = ['landed', 'refused', 'still-blocked'] as const;

export type EditOutcome = (typeof EDIT_OUTCOMES)[number];

export interface RuleOverrideOutcomeRow {
  kind: 'rule-override-outcome';
  rule: string;
  file: string;
  tool_use_id: string;
  outcome: EditOutcome;
  at: string;
  session: string;
}

export function isEditOutcome(value: unknown): value is EditOutcome {
  return EDIT_OUTCOMES.some((outcome) => outcome === value);
}

export function overrideAwaitsOutcome(
  projectRoot: string,
  dirName: string,
  call: { rule: string; file: string; toolUseId: string },
): boolean {
  const rows = readUnitFile(projectRoot, featureFilePath(dirName, 'ruleOverrides')).map(
    (raw) => raw as unknown as Record<string, unknown>,
  );
  const sameCall = (row: Record<string, unknown>) => row.tool_use_id === call.toolUseId;
  return (
    rows.some(
      (row) =>
        row.kind === 'rule-override' &&
        sameCall(row) &&
        row.rule === call.rule &&
        row.file === call.file,
    ) && !rows.some((row) => row.kind === 'rule-override-outcome' && sameCall(row))
  );
}

export function appendRuleOverrideOutcome(
  projectRoot: string,
  dirName: string,
  input: {
    rule: string;
    file: string;
    toolUseId: string;
    outcome: EditOutcome;
    sessionId: string;
    now?: () => Date;
  },
): RuleOverrideOutcomeRow {
  const at = (input.now ?? (() => new Date()))().toISOString();
  const row: RuleOverrideOutcomeRow = {
    kind: 'rule-override-outcome',
    rule: input.rule,
    file: input.file,
    tool_use_id: input.toolUseId,
    outcome: input.outcome,
    at,
    session: input.sessionId,
  };
  const stamped = stampBundleRow({
    docType: RULE_OVERRIDE_DOC_TYPE,
    change: featureChangeKey(dirName),
    sessionId: input.sessionId,
    schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
    row: { ...row },
    now: () => new Date(at),
  }) as unknown as SessionLedgerRow;
  appendStampedRowToUnit(projectRoot, featureFilePath(dirName, 'ruleOverrides'), stamped);
  return row;
}
