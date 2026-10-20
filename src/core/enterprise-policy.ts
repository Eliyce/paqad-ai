import type { EnterpriseConfig, ProjectProfile } from './types/project-profile.js';

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

export function writesLedger(policy: EnterprisePolicy): boolean {
  return policy.evidence_ledger || policy.ai_bom;
}
