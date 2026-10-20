import type { ComplianceCitation, EvidenceLedgerRow } from '@/core/types/evidence-ledger.js';
import type { ComplianceMapping, LoadedCompliancePack } from '@/core/types/pack.js';

import { loadCompliancePacks } from '@/packs/compliance-packs.js';

export interface ResolveComplianceCitationsInput {
  projectRoot: string;
  rows: readonly EvidenceLedgerRow[];
  packs?: LoadedCompliancePack[];
}

function passingGates(rows: readonly EvidenceLedgerRow[]): Set<string> {
  const passed = new Set<string>();
  for (const row of rows) {
    if (row.engine === 'verification-gate' && row.verdict === 'pass') {
      passed.add(row.code);
    }
  }
  return passed;
}

function citableGates(mapping: ComplianceMapping, passed: Set<string>): string[] {
  const gateSignals = mapping.satisfied_by.filter((signal) => signal.type === 'gate');
  if (gateSignals.length === 0) return [];
  const allPassed = gateSignals.every((signal) => passed.has(signal.ref));
  return allPassed ? gateSignals.map((signal) => signal.ref) : [];
}

export function resolveComplianceCitations(
  input: ResolveComplianceCitationsInput,
): ComplianceCitation[] {
  let packs: LoadedCompliancePack[];
  try {
    packs = input.packs ?? loadCompliancePacks(input.projectRoot);
  } catch {
    return [];
  }
  if (packs.length === 0) return [];

  const passed = passingGates(input.rows);
  const citations: ComplianceCitation[] = [];

  for (const pack of packs) {
    const { framework, disclaimer, mappings } = pack.manifest;
    for (const mapping of mappings) {
      const gates = citableGates(mapping, passed);
      for (const gate of gates) {
        const signal = mapping.satisfied_by.find((s) => s.type === 'gate' && s.ref === gate);
        if (signal === undefined) continue;
        citations.push({
          framework_id: framework.id,
          framework_title: framework.title,
          ...(framework.version !== undefined ? { framework_version: framework.version } : {}),
          clause_id: mapping.clause.id,
          clause_title: mapping.clause.title,
          ...(mapping.clause.url !== undefined ? { clause_url: mapping.clause.url } : {}),
          gate,
          relation: signal.relation,
          evidence_strength: mapping.evidence_strength,
          disclaimer,
        });
      }
    }
  }

  return citations;
}
