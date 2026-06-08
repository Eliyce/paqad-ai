import type { ProofType, VerificationCriterion } from '@/core/types/planning.js';
import type {
  FeatureSpec,
  FeatureSpecInvariant,
  FeatureSpecInvariantSource,
} from '@/core/types/feature-spec.js';
import { extractObligationIndex } from '@/compliance/obligation-extractor.js';
import type { SpecReviewReport } from '@/compliance/types.js';
import { sha256Hex, splitLines } from '@/compliance/markdown.js';

export const FEATURE_SPEC_SCHEMA_VERSION = '1';

/** An invariant suggested by upstream rule sources, awaiting human confirmation at freeze. */
export interface SuggestedInvariant {
  statement: string;
  source: Exclude<FeatureSpecInvariantSource, 'authored'>;
  rule_id?: string;
}

export interface BuildFeatureSpecOptions {
  spec_id: string;
  spec_file: string;
  spec_markdown: string;
  suggested_invariants?: SuggestedInvariant[];
  spec_review?: SpecReviewReport | null;
  extracted_at?: string;
}

/**
 * Builds the structured feature-spec sidecar from the human-readable spec
 * markdown. Behaviour comes from the functional / non-functional obligations,
 * acceptance criteria reuse the {@link VerificationCriterion} shape, and
 * invariants combine author-written `INV-n` lines with rule-sourced
 * suggestions. The result is always derived from the markdown so the sidecar
 * cannot drift from its source (issue #102).
 */
export function buildFeatureSpec(options: BuildFeatureSpecOptions): FeatureSpec {
  const index = extractObligationIndex({
    spec_file: options.spec_file,
    spec_markdown: options.spec_markdown,
    spec_review: options.spec_review ?? null,
    extracted_at: options.extracted_at,
  });

  const behaviour: string[] = [];
  const criteria: VerificationCriterion[] = [];
  let criterionSeq = 0;

  for (const obligation of index.obligations) {
    const description = stripLeadingId(obligation.description);
    if (obligation.category === 'functional' || obligation.category === 'non-functional') {
      behaviour.push(`${obligation.obligation_id}: ${description}`);
    } else if (obligation.category === 'acceptance') {
      criterionSeq += 1;
      criteria.push(criterionFromObligation(obligation.obligation_id, description, criterionSeq));
    }
  }

  return {
    schema_version: FEATURE_SPEC_SCHEMA_VERSION,
    spec_id: options.spec_id,
    spec_file: options.spec_file,
    spec_hash: sha256Hex(options.spec_markdown),
    behaviour,
    acceptance_criteria: criteria,
    invariants: collectInvariants(options.spec_markdown, options.suggested_invariants ?? []),
    open_questions: extractOpenQuestions(options.spec_markdown),
    frozen: null,
  };
}

function criterionFromObligation(
  obligationId: string,
  description: string,
  sequence: number,
): VerificationCriterion {
  const criterionId = /^AC-\d+$/.test(obligationId) ? obligationId : `AC-${sequence}`;
  const { given, when, then } = parseGivenWhenThen(description);

  return {
    criterion_id: criterionId,
    given,
    when,
    then,
    proof_type: detectProofType(description),
    status: 'uncovered',
    source: 'planned',
    linked_requirement_ids: [],
  };
}

/** Strips a leading requirement/criterion id (e.g. `FR-1:`, `AC-2 -`) from a line. */
function stripLeadingId(text: string): string {
  return text.replace(/^(?:FR|NFR|AC|EC)-\d+(?:\.\d+)?\s*[:.)-]\s*/i, '').trim();
}

function parseGivenWhenThen(text: string): { given: string; when: string; then: string } {
  const match = /given\s+(.*?),?\s+when\s+(.*?),?\s+then\s+(.*?)\.?$/i.exec(text.trim());
  if (match) {
    return { given: match[1]!.trim(), when: match[2]!.trim(), then: match[3]!.trim() };
  }
  return { given: '', when: '', then: text.trim() };
}

function detectProofType(text: string): ProofType {
  const match = /\(proof:\s*(automated|manual|visual)\)/i.exec(text);
  if (match) {
    return match[1]!.toLowerCase() as ProofType;
  }
  return 'automated';
}

function collectInvariants(
  markdown: string,
  suggested: SuggestedInvariant[],
): FeatureSpecInvariant[] {
  const invariants: FeatureSpecInvariant[] = [];
  const seenStatements = new Set<string>();
  let sequence = 0;

  for (const authored of extractAuthoredInvariants(markdown)) {
    sequence += 1;
    seenStatements.add(authored.toLowerCase());
    invariants.push({
      invariant_id: `INV-${sequence}`,
      statement: authored,
      source: 'authored',
      confirmed: false,
    });
  }

  for (const suggestion of suggested) {
    const normalized = suggestion.statement.trim();
    if (normalized.length === 0 || seenStatements.has(normalized.toLowerCase())) {
      continue;
    }
    sequence += 1;
    seenStatements.add(normalized.toLowerCase());
    invariants.push({
      invariant_id: `INV-${sequence}`,
      statement: normalized,
      source: suggestion.source,
      ...(suggestion.rule_id === undefined ? {} : { rule_id: suggestion.rule_id }),
      confirmed: false,
    });
  }

  return invariants;
}

function extractAuthoredInvariants(markdown: string): string[] {
  const statements: string[] = [];
  for (const line of splitLines(markdown)) {
    const match = /^\s*(?:[-*+]\s+)?(?:\*\*)?INV-\d+(?:\*\*)?\s*[:.)-]\s*(.+\S)\s*$/.exec(line);
    if (match) {
      statements.push(match[1]!.trim());
    }
  }
  return statements;
}

function extractOpenQuestions(markdown: string): string[] {
  const questions: string[] = [];
  for (const line of splitLines(markdown)) {
    const match = /^\s*(?:[-*+]\s+)?(Q\d+)\s*[:.)-]\s*(.+\S)\s*$/.exec(line);
    if (match) {
      questions.push(`${match[1]}: ${match[2]!.trim()}`);
    }
  }
  return questions;
}
