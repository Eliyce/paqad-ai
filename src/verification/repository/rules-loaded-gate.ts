import type { VerificationEvidenceGate } from '@/core/types/verification-evidence.js';
import type { VerificationGate, VerificationOrigin } from '@/core/types/verification.js';
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
  dirName: string | null;
  isFeatureDev: boolean;
  sessionId?: string | null;
  origin?: VerificationOrigin;
}

export interface RulesLoadedGateDeps {
  resolveApplicability?: (
    projectRoot: string,
    sessionId: string | null,
  ) => Promise<ChangeRuleApplicability>;
  readRecord?: (projectRoot: string, dirName: string) => RulesLoadedRecord | null;
}

export async function rulesLoadedGate(
  input: RulesLoadedGateInput,
  deps: RulesLoadedGateDeps = {},
): Promise<VerificationEvidenceGate | null> {
  const resolveApplicability = deps.resolveApplicability ?? resolveRuleApplicabilityForChange;
  const readRecord = deps.readRecord ?? readRulesLoaded;
  if (!input.isFeatureDev || !input.dirName) {
    return null;
  }
  const applicability = await resolveApplicability(input.projectRoot, input.sessionId ?? null);
  if (!applicability.hasStore || applicability.applicable.length === 0) {
    return {
      name: GATE_NAME,
      status: 'skipped',
      detail: applicability.hasStore
        ? 'No project rule applies to the files in this change — nothing to load.'
        : 'No compiled rules for this project — nothing to load.',
      remediation: null,
      failures: [],
      skip_kind: 'not-required',
    };
  }

  const record = readRecord(input.projectRoot, input.dirName);
  if (!record && input.origin === 'ci-backstop') {
    return {
      name: GATE_NAME,
      status: 'skipped',
      detail: 'No session loads rules on CI, so the load was not required here.',
      remediation: null,
      failures: [],
      skip_kind: 'not-required',
    };
  }
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
