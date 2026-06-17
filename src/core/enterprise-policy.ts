// Issue #187 — the single place that decides what the enterprise/governance
// machinery is allowed to do for a given project. The evidence ledger (#118),
// AI-BOM, and compliance-citation resolution (#122) are opt-in and off by
// default: a normal user pays zero tokens and gets a clean working tree.
//
// This resolver is also the seam a future license/token check slots into. When
// that lands, `enabled: true` without a valid offline-signed token resolves to
// every flag off here — so no caller (verification, onboarding) ever learns
// about billing. That validation is explicitly NOT in this ticket.

import type { EnterpriseConfig, ProjectProfile } from './types/project-profile.js';

/**
 * The resolved decision: for each capability, is it allowed to run/write? Every
 * field is a hard boolean, already AND-ed with the master switch, so callers
 * branch on it directly without re-reading the profile.
 */
export interface EnterprisePolicy {
  enabled: boolean;
  evidence_ledger: boolean;
  ai_bom: boolean;
  compliance_citations: boolean;
}

const ALL_OFF: EnterprisePolicy = {
  enabled: false,
  evidence_ledger: false,
  ai_bom: false,
  compliance_citations: false,
};

/**
 * Resolve the enterprise policy for a project.
 *
 * Rules (issue #187):
 * - **Block absent ⇒ everything off.** A `null`/`undefined` profile or a missing
 *   `enterprise` block resolves to all-off, with no migration step.
 * - **`enabled: false` is the master switch.** It forces every sub-flag off
 *   regardless of its value.
 * - **Sub-flags are independent** when `enabled: true` (e.g. receipts on, AI-BOM
 *   off). Each is read strictly as `=== true`, so a malformed/missing flag is off.
 */
export function resolveEnterprisePolicy(
  profile: ProjectProfile | null | undefined,
): EnterprisePolicy {
  const block: EnterpriseConfig | undefined = profile?.enterprise;
  if (block?.enabled !== true) {
    return { ...ALL_OFF };
  }
  return {
    enabled: true,
    evidence_ledger: block.evidence_ledger === true,
    ai_bom: block.ai_bom === true,
    compliance_citations: block.compliance_citations === true,
  };
}

/** True when the resolved policy writes anything under `.paqad/ledger/`. Used by
 *  the chokepoint to skip all receipt work and by onboarding to decide whether
 *  the managed `.gitignore` should ignore the ledger directory at all. */
export function writesLedger(policy: EnterprisePolicy): boolean {
  return policy.evidence_ledger || policy.ai_bom;
}
