import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';
import type { RuleApplicability } from '@/context/rule-context.js';

import { buildDocumentEnvelope, type EnvelopeHeader } from './envelope.js';
import { featureChangeKey, featureFilePath } from './paths.js';
import { currentFeature } from './stage-ledger.js';

export const RULES_LOADED_DOC_TYPE = 'paqad.rules-loaded';
export const RULES_LOADED_SCHEMA_VERSION = 2;

export interface RulesLoadedRecord extends EnvelopeHeader {
  doc_type: typeof RULES_LOADED_DOC_TYPE;
  changed_files: string[];
  applicable_rules: RuleApplicability[];
  rule_text_hash: string;
  artifact: string;
}

function atomicWriteJson(absPath: string, value: unknown): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameWithRetrySync(tmp, absPath);
}

export interface RulesLoadedInput {
  applicable: RuleApplicability[];
  ruleTextHash: string;
  changedPaths: string[];
  now?: () => Date;
}

export function buildRulesLoadedRecord(
  dirName: string,
  sessionId: string,
  input: RulesLoadedInput,
): RulesLoadedRecord {
  return buildDocumentEnvelope({
    docType: RULES_LOADED_DOC_TYPE,
    change: featureChangeKey(dirName),
    sessionId,
    schemaVersion: RULES_LOADED_SCHEMA_VERSION,
    now: input.now,
    body: {
      changed_files: [...input.changedPaths],
      applicable_rules: input.applicable,
      rule_text_hash: input.ruleTextHash,
      artifact: PATHS.CONTEXT_SESSION_ARTIFACT,
    },
  }) as RulesLoadedRecord;
}

export function writeRulesLoaded(
  projectRoot: string,
  sessionId: string,
  input: RulesLoadedInput,
): RulesLoadedRecord | null {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) {
    return null;
  }
  const record = buildRulesLoadedRecord(dirName, sessionId, input);
  atomicWriteJson(join(projectRoot, featureFilePath(dirName, 'rulesLoaded')), record);
  return record;
}

export function readRulesLoaded(projectRoot: string, dirName: string): RulesLoadedRecord | null {
  try {
    return JSON.parse(
      readFileSync(join(projectRoot, featureFilePath(dirName, 'rulesLoaded')), 'utf8'),
    ) as RulesLoadedRecord;
  } catch {
    return null;
  }
}

export function coverageGaps(
  record: RulesLoadedRecord | null,
  currentApplicableIds: readonly string[],
): string[] {
  const recorded = new Set((record?.applicable_rules ?? []).map((rule) => rule.rule_id));
  return currentApplicableIds.filter((id) => !recorded.has(id));
}
