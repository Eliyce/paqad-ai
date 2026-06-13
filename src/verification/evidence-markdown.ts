import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  ChangeAuthorship,
  ComplianceCitation,
  ReproducibilityStampPredicate,
} from '@/core/types/evidence-ledger.js';
import type {
  EvidenceGateStatus,
  EvidenceOverallStatus,
  VerificationEvidence,
  VerificationEvidenceFailure,
  VerificationEvidenceGate,
} from '@/core/types/verification-evidence.js';
import { latestReceiptAuthorship, latestReceiptTrustExtras } from '@/evidence/receipt/project.js';
import { PAQAD_STATUS_GLYPH, PAQAD_VERDICT } from '@/core/constants/paqad-voice.js';

import { VERIFICATION_EVIDENCE_RELATIVE_PATH } from './evidence.js';

// Glyph + verdict vocabulary comes from the canonical paqad-voice spec
// (src/core/constants/paqad-voice.ts), so the PR comment, the dashboard, and
// the in-chat narration contract all speak one verdict language. These maps
// only translate each surface's own status enum onto the shared glyphs.
const GATE_GLYPHS: Record<EvidenceGateStatus, string> = {
  pass: PAQAD_STATUS_GLYPH.good,
  fail: PAQAD_STATUS_GLYPH.failed,
  inconclusive: PAQAD_STATUS_GLYPH.needsLook,
  skipped: PAQAD_STATUS_GLYPH.skipped,
};

const OVERALL_GLYPHS: Record<EvidenceOverallStatus, string> = {
  pass: PAQAD_STATUS_GLYPH.good,
  fail: PAQAD_STATUS_GLYPH.failed,
  error: PAQAD_STATUS_GLYPH.needsLook,
};

const OVERALL_HEADLINE: Record<EvidenceOverallStatus, string> = {
  pass: PAQAD_VERDICT.pass,
  fail: PAQAD_VERDICT.fail,
  error: PAQAD_VERDICT.inconclusive,
};

// Human labels for the gates surfaced in the summary. Gates not listed are
// humanised from their kebab id.
const GATE_LABELS: Partial<Record<string, string>> = {
  'code-tests-lint': 'Tests',
  'mutation-testing': 'Mutation',
  'quality-ratchet': 'Quality ratchet',
  'ac-test-mapping': 'Traceability',
  'behavioral-correctness': 'Behavioural correctness',
  'architecture-compliance': 'Architecture',
};

// The gates that carry the "trust" headline a reviewer scans first: did the
// tests hold, did mutation prove them, did quality not regress. Rendered (in
// this order) even when green, because surfacing the green facts is the whole
// point of the wedge.
const TRUST_GATES = ['code-tests-lint', 'mutation-testing', 'quality-ratchet'] as const;

function gateLabel(name: string): string {
  return (
    GATE_LABELS[name] ??
    name
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}

/**
 * Read the persisted session evidence back into a `VerificationEvidence`
 * object. Returns `null` when the file is absent or unparseable, so callers
 * can degrade gracefully ("run verification first") rather than throw.
 */
export function readVerificationEvidence(projectRoot: string): VerificationEvidence | null {
  const path = join(projectRoot, VERIFICATION_EVIDENCE_RELATIVE_PATH);
  if (!existsSync(path)) return null;
  try {
    const evidence = JSON.parse(readFileSync(path, 'utf8')) as VerificationEvidence;
    if (!Array.isArray(evidence.gates)) return null;
    return evidence;
  } catch {
    return null;
  }
}

/**
 * Render the PR-comment body for a project's current verification evidence,
 * or `null` when no evidence has been persisted. Used by the manual
 * `paqad-ai evidence` command and by the delivery CI gate (issue #42), which
 * posts it automatically so every onboarded project lands the deterministic
 * proof on its PR. Returning `null` self-disables the comment on projects that
 * never ran verification.
 */
export function buildEvidenceComment(projectRoot: string, sha?: string): string | null {
  const evidence = readVerificationEvidence(projectRoot);
  if (evidence === null) return null;
  const authorship = latestReceiptAuthorship(projectRoot) ?? undefined;
  const extras = latestReceiptTrustExtras(projectRoot);
  return renderEvidenceMarkdown(evidence, {
    ...(sha ? { sha } : {}),
    ...(authorship ? { authorship } : {}),
    ...(extras.compliance.length > 0 ? { compliance: extras.compliance } : {}),
    ...(extras.reproducibility ? { reproducibility: extras.reproducibility } : {}),
  });
}

function shortSha(sha: string | undefined): string | null {
  if (!sha) return null;
  const trimmed = sha.trim();
  if (trimmed.length === 0) return null;
  // Render a 7-char prefix for the common full-SHA case; leave shorter labels
  // (tags, branch names) untouched.
  return /^[0-9a-f]{8,40}$/i.test(trimmed) ? trimmed.slice(0, 7) : trimmed;
}

function renderFailure(failure: VerificationEvidenceFailure): string {
  const location =
    failure.file !== null && failure.line !== null
      ? `${failure.file}:${failure.line}`
      : (failure.file ?? failure.test_id ?? failure.suite ?? null);
  return location ? `  - ${location} — ${failure.message}` : `  - ${failure.message}`;
}

function gateSummaryLine(gate: VerificationEvidenceGate): string {
  const confidence =
    gate.name === 'mutation-testing' && gate.confidence === 'lower'
      ? ' _(confidence: lower — do not over-trust)_'
      : '';
  return `- ${GATE_GLYPHS[gate.status]} ${gateLabel(gate.name)} — ${gate.detail}${confidence}`;
}

export interface RenderEvidenceMarkdownOptions {
  /** Optional commit SHA or label rendered in the headline. */
  sha?: string;
  /** Issue #120 — change authorship from the signed receipt, rendered as a
   *  footer so a reviewer sees who wrote/accepted the change next to the gates. */
  authorship?: ChangeAuthorship;
  /** Issue #122 — `gate → clause` citations, rendered as an honest "evidence
   *  toward" footer with the pack's disclaimer. */
  compliance?: ComplianceCitation[];
  /** Issue #123 — the reproducibility stamp, rendered as a one-line claim. */
  reproducibility?: ReproducibilityStampPredicate;
}

/** Render the compliance footer (issue #122): one line per cited clause, grouped
 *  by framework, plus the single shared disclaimer. Returns `null` when there
 *  are no citations. Deliberately says "evidence toward", never "compliant". */
export function renderComplianceLines(citations: ComplianceCitation[]): string[] | null {
  if (citations.length === 0) return null;
  // Dedupe to one entry per (framework, clause): several gates can satisfy the
  // same clause, but the reviewer wants the clause listed once.
  const byClause = new Map<string, ComplianceCitation>();
  for (const citation of citations) {
    byClause.set(`${citation.framework_id}|${citation.clause_id}`, citation);
  }
  const clauses = [...byClause.values()].map(
    (c) => `${c.framework_title} ${c.clause_id} (${c.evidence_strength})`,
  );
  const disclaimer = citations[0]?.disclaimer.trim().replace(/\s+/g, ' ') ?? '';
  const lines = [`> Compliance evidence toward: ${clauses.join(', ')}.`];
  if (disclaimer.length > 0) lines.push(`> _${disclaimer}_`);
  return lines;
}

/** Render the reproducibility line (issue #123). Honest: input-replay, never
 *  bit-identical regeneration. */
export function renderReproducibilityLine(stamp: ReproducibilityStampPredicate): string {
  return `> Replayable from frozen context: \`${stamp.context_hash.slice(0, 12)}\` (${stamp.determinism}, algo v${stamp.algo_version}).`;
}

/**
 * Render the one-line authorship footer (issue #120), or `null` when no
 * authorship was attested. Name-only for the accepter — the email already lives
 * in the receipt and git history, so the public PR comment need not repeat it.
 * The framing is the moat: paqad's gates vouch for the change whichever adapter
 * wrote it.
 */
export function renderAuthorshipLine(authorship: ChangeAuthorship): string | null {
  const parts: string[] = [];
  if (authorship.agent !== undefined) parts.push(`written by \`${authorship.agent}\``);
  const modelLabel = authorship.model_id ?? authorship.model;
  if (modelLabel !== undefined) {
    const qualifier = authorship.provenance === 'declared' ? ' (declared)' : '';
    parts.push(`model \`${modelLabel}\`${qualifier}`);
  }
  if (authorship.accepting_human?.name !== undefined) {
    parts.push(`accepted by ${authorship.accepting_human.name}`);
  }
  if (parts.length === 0) return null;
  return `> Authorship: ${parts.join(' · ')}. paqad attests this on its gates, so the proof holds whichever tool wrote it.`;
}

/**
 * Render `VerificationEvidence` as a short, scannable green/red markdown
 * summary suitable for `gh pr comment`. Pure and deterministic — identical
 * evidence yields a byte-identical comment (no timestamp reformatting, no
 * locale-dependent calls), matching `renderMarkdown`'s contract so the output
 * can later feed the signed receipt.
 *
 * Numbers (kill rate, passing-check counts) are rendered straight off each
 * gate's `detail` string rather than re-parsed, so the comment never claims a
 * figure the evidence does not hold.
 */
export function renderEvidenceMarkdown(
  evidence: VerificationEvidence,
  options: RenderEvidenceMarkdownOptions = {},
): string {
  const lines: string[] = [];
  const sha = shortSha(options.sha);
  const overall = evidence.overall_status;
  const headerSuffix = sha ? ` — ${sha}` : '';
  lines.push(
    `## paqad evidence${headerSuffix}  ${OVERALL_GLYPHS[overall]} ${OVERALL_HEADLINE[overall]}`,
  );
  lines.push('');

  const counts = { pass: 0, fail: 0, inconclusive: 0, skipped: 0 };
  for (const gate of evidence.gates) {
    counts[gate.status] += 1;
  }
  lines.push(
    `Gates: ${counts.pass} passed, ${counts.fail} failed, ${counts.inconclusive} inconclusive, ${counts.skipped} skipped.`,
  );
  lines.push('');

  // Trust headline — the green facts a reviewer wants first.
  const byName = new Map(evidence.gates.map((gate) => [gate.name, gate]));
  const trustLines = TRUST_GATES.map((name) => byName.get(name))
    .filter(
      (gate): gate is VerificationEvidenceGate => gate !== undefined && gate.status !== 'skipped',
    )
    .map(gateSummaryLine);
  if (trustLines.length > 0) {
    lines.push(...trustLines);
    lines.push('');
  }

  // Blocking detail — every gate that failed or is inconclusive, with its
  // failures pinned to file:line straight off the evidence.
  const blocking = evidence.gates.filter(
    (gate) => gate.status === 'fail' || gate.status === 'inconclusive',
  );
  if (blocking.length > 0) {
    lines.push('### Blocking');
    lines.push('');
    for (const gate of blocking) {
      lines.push(gateSummaryLine(gate));
      for (const failure of gate.failures) {
        lines.push(renderFailure(failure));
      }
      if (gate.remediation) {
        lines.push(`  - _Fix:_ ${gate.remediation}`);
      }
    }
    lines.push('');
  }

  lines.push(
    overall === 'pass'
      ? '> Attests paqad’s gates passed for this run — not that the change is correct.'
      : '> paqad’s gates did not all pass. Resolve the blocking items above before merge.',
  );

  const authorshipLine = options.authorship ? renderAuthorshipLine(options.authorship) : null;
  if (authorshipLine !== null) {
    lines.push('');
    lines.push(authorshipLine);
  }

  const complianceLines = options.compliance ? renderComplianceLines(options.compliance) : null;
  if (complianceLines !== null) {
    lines.push('');
    lines.push(...complianceLines);
  }

  if (options.reproducibility) {
    lines.push('');
    lines.push(renderReproducibilityLine(options.reproducibility));
  }

  return lines.join('\n');
}
