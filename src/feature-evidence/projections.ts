// On-demand whole-project projections from the per-feature bundles (issue #339, Phase 6).
//
// The re-key (Phase 2) moved stage evidence out of the session-scoped
// `<docType>/<session>/<ordinal>` layout that `readAllSessionRows` walks, so any
// whole-project consumer (the SIEM `audit export` #121, the dashboard) must now PROJECT
// the union from the feature dirs instead. This module is that projection: it reads every
// feature bundle's `stage-evidence.jsonl` (and `rule-run.jsonl`) and returns the merged
// rows, so external tooling still sees one whole document while nothing double-writes.

import type { FeatureSpec } from '@/core/types/feature-spec.js';
import { readUnitFile, type SessionLedgerRow } from '@/session-ledger/ledger.js';

import { readFeatureSpecification } from './artifacts.js';
import { listFeatureDirs } from './delivery.js';
import { featureFilePath } from './paths.js';

/**
 * Every stage-evidence row across all feature bundles, feature dirs in name order. The
 * whole-project projection of the re-homed stage spine — the replacement for
 * `readAllSessionRows(STAGE_EVIDENCE_DOC_TYPE)` after the Phase-2 cutover.
 */
export function readAllFeatureStageRows(projectRoot: string): SessionLedgerRow[] {
  return listFeatureDirs(projectRoot).flatMap((dirName) =>
    readUnitFile(projectRoot, featureFilePath(dirName, 'stageEvidence')),
  );
}

/** Every per-feature rule-run row across all bundles (the whole-project projection). */
export function readAllFeatureRuleRuns(projectRoot: string): SessionLedgerRow[] {
  return listFeatureDirs(projectRoot).flatMap((dirName) =>
    readUnitFile(projectRoot, featureFilePath(dirName, 'ruleRun')),
  );
}

/**
 * Every FROZEN feature specification across all bundles (issue #343 A1). This is the
 * whole-project projection of the frozen spec — the replacement for the legacy
 * `.paqad/specs/<id>.frozen.json` sidecar scan (`readFrozenSpecs`) after the Phase-7
 * cutover. Each `specification.json` stores an already-frozen `FeatureSpec` carrying the
 * same `frozen`/`spec_hash` fields the spec-change guard compares against, so only the
 * read location moves. A missing/corrupt/unfrozen bundle spec is skipped, never thrown.
 */
export function readAllFeatureSpecifications(projectRoot: string): FeatureSpec[] {
  const specs: FeatureSpec[] = [];
  for (const dirName of listFeatureDirs(projectRoot)) {
    const spec = readFeatureSpecification(projectRoot, dirName);
    if (spec && spec.frozen !== null && spec.frozen !== undefined) {
      specs.push(spec);
    }
  }
  return specs;
}
