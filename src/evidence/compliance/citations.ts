// Issue #122 — resolve `gate → legal clause` citations for a change's receipt.
//
// For each active compliance pack, walk its `clause → satisfied_by` mappings; a
// clause is cited only when EVERY gate signal it depends on appears in the
// change's ledger rows as a `pass` (an `inconclusive` or `blocked` gate never
// cites — absence of evidence must never read as evidence). One citation is
// emitted per (clause × satisfying gate × framework), so a single passing gate
// can honestly cite several frameworks at once when multiple packs are active.
//
// The output is folded into the #118 receipt's VsaPredicate as
// `compliance_citations`, omitted entirely when empty so receipts stay
// byte-identical for projects with no compliance pack installed.

import type { ComplianceCitation, EvidenceLedgerRow } from '@/core/types/evidence-ledger.js';
import type { ComplianceMapping, LoadedCompliancePack } from '@/core/types/pack.js';

import { loadCompliancePacks } from '@/packs/compliance-packs.js';

export interface ResolveComplianceCitationsInput {
  projectRoot: string;
  rows: readonly EvidenceLedgerRow[];
  /** Test seam — inject packs instead of loading from disk. */
  packs?: LoadedCompliancePack[];
}

/** The set of gate names that PASSED in this change's ledger window. Only
 *  verification-gate rows with verdict `pass` qualify — fail/inconclusive/
 *  blocked are excluded so a citation never overstates the evidence. */
function passingGates(rows: readonly EvidenceLedgerRow[]): Set<string> {
  const passed = new Set<string>();
  for (const row of rows) {
    if (row.engine === 'verification-gate' && row.verdict === 'pass') {
      passed.add(row.code);
    }
  }
  return passed;
}

/** A clause is satisfied only when every `gate` signal it lists passed. Signals
 *  of other types (obligation_category) don't block the gate-based citation but
 *  also don't, on their own, produce one — gates are the deterministic join key. */
function citableGates(mapping: ComplianceMapping, passed: Set<string>): string[] {
  const gateSignals = mapping.satisfied_by.filter((signal) => signal.type === 'gate');
  if (gateSignals.length === 0) return [];
  const allPassed = gateSignals.every((signal) => passed.has(signal.ref));
  return allPassed ? gateSignals.map((signal) => signal.ref) : [];
}

/**
 * Resolve compliance citations for a change. Returns `[]` (→ field omitted) when
 * no pack is installed or no passing gate maps to a clause. Never throws: a load
 * failure degrades to no citations, never a broken receipt.
 */
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
