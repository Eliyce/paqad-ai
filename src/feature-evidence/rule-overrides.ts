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
