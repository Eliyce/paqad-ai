// The completion-seam rule-loading gate (issue #557).
//
// The edit-time capability blocks the FIRST feature-dev source edit until the rules are
// loaded; this is its completion-seam partner — the backstop that fails a finished change
// whose applicable rules were never loaded, the same way the stage-evidence gate fails a
// missing plan or spec. It is deliberately a dedicated gate (not folded into
// bundle-completeness) so its verdict is honest and its enforcement is not coupled to the
// bundle-completeness mode:
//
//   - not a feature-development code change / no compiled rules / no rule applies → skipped
//   - a feature-dev change with an active bundle but NO rules-loaded.json            → fail
//   - a record that no longer covers the change (new applicable rules since it ran)  → inconclusive
//   - a covering record                                                              → pass
//
// Absent blocks; stale only informs (INV-2), so a mid-change never deadlocks. Reuses the one
// canonical applicability computation, so the gate agrees with the verb and the artifact.

import type { VerificationEvidenceGate } from '@/core/types/verification-evidence.js';
import type { VerificationGate } from '@/core/types/verification.js';
import {
  resolveRuleApplicabilityForChange,
  type ChangeRuleApplicability,
} from '@/context/rule-context.js';
import {
  coverageGaps,
  readRulesLoaded,
  type RulesLoadedRecord,
} from '@/feature-evidence/rules-loaded.js';

const GATE_NAME = 'rules-loaded' as VerificationGate;

export interface RulesLoadedGateInput {
  projectRoot: string;
  /** The active feature bundle dir, or null when there is none / an affirmatively non-feature route. */
  dirName: string | null;
  /** Whether the change is a feature-development code change (changeIsFeatureDev). */
  isFeatureDev: boolean;
}

/** Readers injected for deterministic tests; production uses the real disk-backed ones. */
export interface RulesLoadedGateDeps {
  resolveApplicability?: (projectRoot: string) => Promise<ChangeRuleApplicability>;
  readRecord?: (projectRoot: string, dirName: string) => RulesLoadedRecord | null;
}

/**
 * Evaluate the rule-loading gate for a completed change. Returns null only when there is no
 * meaningful verdict to record (not feature-dev, or no bundle to attach to) so the gate stays
 * silent on non-feature turns; otherwise a pass / fail / inconclusive / skipped gate.
 */
export async function rulesLoadedGate(
  input: RulesLoadedGateInput,
  deps: RulesLoadedGateDeps = {},
): Promise<VerificationEvidenceGate | null> {
  const resolveApplicability = deps.resolveApplicability ?? resolveRuleApplicabilityForChange;
  const readRecord = deps.readRecord ?? readRulesLoaded;
  if (!input.isFeatureDev || !input.dirName) {
    return null;
  }
  const applicability = await resolveApplicability(input.projectRoot);
  if (!applicability.hasStore || applicability.applicable.length === 0) {
    return {
      name: GATE_NAME,
      status: 'skipped',
      detail: applicability.hasStore
        ? 'No project rule applies to the files in this change — nothing to load.'
        : 'No compiled rules for this project — nothing to load.',
      remediation: null,
      failures: [],
    };
  }

  const record = readRecord(input.projectRoot, input.dirName);
  if (!record) {
    return {
      name: GATE_NAME,
      status: 'fail',
      detail:
        `The rules were never loaded for this change — ${applicability.applicable.length} ` +
        `project rule${applicability.applicable.length === 1 ? '' : 's'} apply to the files you ` +
        `changed and there is no record they were loaded.`,
      remediation: 'Run `paqad-ai rules load` to load the applicable rules and record it.',
      failures: [],
    };
  }

  const gaps = coverageGaps(
    record,
    applicability.applicable.map((rule) => rule.rule_id),
  );
  if (gaps.length > 0) {
    return {
      name: GATE_NAME,
      status: 'inconclusive',
      detail:
        `Rules were loaded, but ${gaps.length} rule${gaps.length === 1 ? '' : 's'} became ` +
        `applicable since (${gaps.join(', ')}) — the load no longer covers the whole change.`,
      remediation: 'Re-run `paqad-ai rules load` to load the newly applicable rules.',
      failures: [],
    };
  }

  return {
    name: GATE_NAME,
    status: 'pass',
    detail:
      `Rules loaded and acknowledged for this change ` +
      `(${record.applicable_rules.length} applicable).`,
    remediation: null,
    failures: [],
  };
}
