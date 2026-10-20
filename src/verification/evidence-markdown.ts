import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  ChangeAuthorship,
  ComplianceCitation,
  ReproducibilityStampPredicate,
} from '@/core/types/evidence-ledger.js';
import type {
  EvidenceGateStatus,
  VerificationEvidence,
  VerificationEvidenceFailure,
  VerificationEvidenceGate,
} from '@/core/types/verification-evidence.js';
import { latestReceiptAuthorship, latestReceiptTrustExtras } from '@/evidence/receipt/project.js';
import { PAQAD_STATUS_GLYPH, PAQAD_VERDICT } from '@/core/constants/paqad-voice.js';

import { VERIFICATION_EVIDENCE_RELATIVE_PATH } from './evidence.js';
import { verdictKindFor, type VerdictKind } from './verdict-kind.js';

const GATE_GLYPHS: Record<EvidenceGateStatus, string> = {
  pass: PAQAD_STATUS_GLYPH.good,
  fail: PAQAD_STATUS_GLYPH.failed,
  inconclusive: PAQAD_STATUS_GLYPH.needsLook,
  skipped: PAQAD_STATUS_GLYPH.skipped,
};

const VERDICT_GLYPHS: Record<VerdictKind, string> = {
  pass: PAQAD_STATUS_GLYPH.good,
  fail: PAQAD_STATUS_GLYPH.failed,
  inconclusive: PAQAD_STATUS_GLYPH.needsLook,
};

function commentVerdict(evidence: VerificationEvidence): VerdictKind {
  if (evidence.overall_status === 'error') return 'inconclusive';
  return verdictKindFor(evidence.gates, evidence.unrecorded_mandatory_stages ?? []);
}

const GATE_LABELS: Partial<Record<string, string>> = {
  'code-tests-lint': 'Tests',
  'mutation-testing': 'Mutation',
  'quality-ratchet': 'Quality ratchet',
  'ac-test-mapping': 'Traceability',
  'behavioral-correctness': 'Behavioural correctness',
  'architecture-compliance': 'Architecture',
};

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
  return /^[0-9a-f]{8,40}$/i.test(trimmed) ? trimmed.slice(0, 7) : trimmed;
}

function renderFailure(failure: VerificationEvidenceFailure): string {
  const location =
    failure.file !== null && failure.line !== null
      ? `${failure.file}:${failure.line}`
      : (failure.file ?? failure.test_id ?? failure.suite ?? null);
  return location ? `  - ${location} — ${failure.message}` : `  - ${failure.message}`;
}

function isDidNotRun(gate: VerificationEvidenceGate): boolean {
  return gate.status === 'skipped' && gate.skip_kind === 'did-not-run';
}

function didNotRunLine(gate: VerificationEvidenceGate): string {
  const label = gateLabel(gate.name);
  return gate.skip_reason !== undefined
    ? `- ${GATE_GLYPHS.skipped} ${label} did not run: ${gate.skip_reason}`
    : `- ${GATE_GLYPHS.skipped} ${label}: ${gate.detail}`;
}

function gateSummaryLine(gate: VerificationEvidenceGate): string {
  const confidence =
    gate.name === 'mutation-testing' && gate.confidence === 'lower'
      ? ' _(confidence: lower — do not over-trust)_'
      : '';
  return `- ${GATE_GLYPHS[gate.status]} ${gateLabel(gate.name)} — ${gate.detail}${confidence}`;
}

export interface RenderEvidenceMarkdownOptions {
  sha?: string;
  authorship?: ChangeAuthorship;
  compliance?: ComplianceCitation[];
  reproducibility?: ReproducibilityStampPredicate;
}

export function renderComplianceLines(citations: ComplianceCitation[]): string[] | null {
  if (citations.length === 0) return null;
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

export function renderReproducibilityLine(stamp: ReproducibilityStampPredicate): string {
  return `> Replayable from frozen context: \`${stamp.context_hash.slice(0, 12)}\` (${stamp.determinism}, algo v${stamp.algo_version}).`;
}

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

export function renderEvidenceMarkdown(
  evidence: VerificationEvidence,
  options: RenderEvidenceMarkdownOptions = {},
): string {
  const lines: string[] = [];
  const sha = shortSha(options.sha);
  const verdict = commentVerdict(evidence);
  const headerSuffix = sha ? ` — ${sha}` : '';
  lines.push(
    `## paqad evidence${headerSuffix}  ${VERDICT_GLYPHS[verdict]} ${PAQAD_VERDICT[verdict]}`,
  );
  lines.push('');

  const counts = { pass: 0, fail: 0, inconclusive: 0, notRequired: 0, didNotRun: 0 };
  for (const gate of evidence.gates) {
    if (gate.status !== 'skipped') counts[gate.status] += 1;
    else if (isDidNotRun(gate)) counts.didNotRun += 1;
    else counts.notRequired += 1;
  }
  lines.push(
    `Gates: ${counts.pass} passed, ${counts.fail} failed, ${counts.inconclusive} inconclusive, ${counts.notRequired} not required, ${counts.didNotRun} did not run.`,
  );
  lines.push('');

  const byName = new Map(evidence.gates.map((gate) => [gate.name, gate]));
  const trustLines = TRUST_GATES.map((name) => byName.get(name))
    .filter(
      (gate): gate is VerificationEvidenceGate =>
        gate !== undefined && (gate.status !== 'skipped' || isDidNotRun(gate)),
    )
    .map((gate) => (gate.status === 'skipped' ? didNotRunLine(gate) : gateSummaryLine(gate)));
  if (trustLines.length > 0) {
    lines.push(...trustLines);
    lines.push('');
  }

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
    verdict === 'pass'
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
