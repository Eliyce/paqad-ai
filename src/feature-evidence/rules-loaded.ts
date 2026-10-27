import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';
import { hashRuleText, type RuleApplicability } from '@/context/rule-context.js';

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
  rule_source_hashes?: Record<string, string>;
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
  ruleSourceHashes?: Record<string, string>;
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
      ...(input.ruleSourceHashes ? { rule_source_hashes: { ...input.ruleSourceHashes } } : {}),
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

function currentSourceHash(projectRoot: string, sourcePath: string): string | null {
  try {
    return hashRuleText(readFileSync(join(projectRoot, sourcePath), 'utf8'));
  } catch {
    return null;
  }
}

export function hashRuleSources(
  projectRoot: string,
  sourcePaths: readonly string[],
): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const sourcePath of sourcePaths) {
    const hash = currentSourceHash(projectRoot, sourcePath);
    if (hash !== null) {
      hashes[sourcePath] = hash;
    }
  }
  return hashes;
}

export function changedLoadedRuleSources(projectRoot: string, record: RulesLoadedRecord): string[] {
  const recorded = record.rule_source_hashes;
  if (!recorded || typeof recorded !== 'object') {
    return [];
  }
  return Object.entries(recorded)
    .filter(([sourcePath, hash]) => currentSourceHash(projectRoot, sourcePath) !== hash)
    .map(([sourcePath]) => sourcePath)
    .sort();
}
