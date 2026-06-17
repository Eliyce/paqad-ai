import { describe, expect, it } from 'vitest';

import { resolveEnterprisePolicy, writesLedger } from '@/core/enterprise-policy.js';
import type { EnterpriseConfig, ProjectProfile } from '@/core/types/project-profile.js';

/** A profile carrying only the bits the resolver reads — the rest is irrelevant
 *  to policy resolution, so we cast a minimal shape. */
function profileWith(enterprise?: Partial<EnterpriseConfig>): ProjectProfile {
  return { enterprise } as unknown as ProjectProfile;
}

describe('resolveEnterprisePolicy (issue #187)', () => {
  it('block absent ⇒ everything off', () => {
    expect(resolveEnterprisePolicy(profileWith(undefined))).toEqual({
      enabled: false,
      evidence_ledger: false,
      ai_bom: false,
      compliance_citations: false,
    });
  });

  it('null/undefined profile ⇒ everything off', () => {
    const allOff = {
      enabled: false,
      evidence_ledger: false,
      ai_bom: false,
      compliance_citations: false,
    };
    expect(resolveEnterprisePolicy(null)).toEqual(allOff);
    expect(resolveEnterprisePolicy(undefined)).toEqual(allOff);
  });

  it('enabled: false is the master switch — forces every sub-flag off', () => {
    const policy = resolveEnterprisePolicy(
      profileWith({
        enabled: false,
        evidence_ledger: true,
        ai_bom: true,
        compliance_citations: true,
      }),
    );
    expect(policy).toEqual({
      enabled: false,
      evidence_ledger: false,
      ai_bom: false,
      compliance_citations: false,
    });
  });

  it('enabled: true with all sub-flags on resolves them all on', () => {
    expect(
      resolveEnterprisePolicy(
        profileWith({
          enabled: true,
          evidence_ledger: true,
          ai_bom: true,
          compliance_citations: true,
        }),
      ),
    ).toEqual({
      enabled: true,
      evidence_ledger: true,
      ai_bom: true,
      compliance_citations: true,
    });
  });

  it('enabled: true keeps each sub-flag independent', () => {
    const policy = resolveEnterprisePolicy(
      profileWith({
        enabled: true,
        evidence_ledger: true,
        ai_bom: false,
        compliance_citations: false,
      }),
    );
    expect(policy.evidence_ledger).toBe(true);
    expect(policy.ai_bom).toBe(false);
    expect(policy.compliance_citations).toBe(false);
  });

  it('missing/malformed sub-flags read as off even when enabled', () => {
    // Only `enabled` is set; the others are absent.
    const policy = resolveEnterprisePolicy(profileWith({ enabled: true }));
    expect(policy).toEqual({
      enabled: true,
      evidence_ledger: false,
      ai_bom: false,
      compliance_citations: false,
    });
  });
});

describe('writesLedger (issue #187)', () => {
  const base = { enabled: true, compliance_citations: false };

  it('true when evidence_ledger or ai_bom is on', () => {
    expect(writesLedger({ ...base, evidence_ledger: true, ai_bom: false })).toBe(true);
    expect(writesLedger({ ...base, evidence_ledger: false, ai_bom: true })).toBe(true);
  });

  it('false when neither writes anything under .paqad/ledger/', () => {
    expect(writesLedger({ ...base, evidence_ledger: false, ai_bom: false })).toBe(false);
  });
});
