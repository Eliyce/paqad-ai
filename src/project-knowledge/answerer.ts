import { readProjectProfile } from '@/core/project-profile.js';
import type {
  AnswerQuery,
  KnowledgeAnswer,
  AnswerGroundingState,
  FreshnessMetadata,
  Contradiction,
} from './types.js';
import type { EvidenceFile } from './evidence-retriever.js';
import { EvidenceRetriever } from './evidence-retriever.js';
import { FreshnessChecker } from './freshness-checker.js';
import { ContradictionDetector } from './contradiction-detector.js';

function determineGroundingState(evidence: EvidenceFile[]): AnswerGroundingState {
  if (evidence.length === 0) return 'missing-evidence';
  return evidence[0].source_class === 'canonical-doc' ? 'observed' : 'inferred';
}

function extractClaimText(evidence: EvidenceFile): string {
  const cleaned = evidence.excerpt.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return `Relevant evidence was found in ${evidence.path}.`;
  }

  const sentence = cleaned.match(/[^.!?]+[.!?]/)?.[0]?.trim() ?? cleaned;
  return sentence.length > 240 ? `${sentence.slice(0, 237).trim()}...` : sentence;
}

function formatEvidenceReference(evidence: EvidenceFile): string {
  return `${extractClaimText(evidence)} (${evidence.path})`;
}

function buildAnswer(
  evidence: EvidenceFile[],
  query: AnswerQuery,
  groundingState: AnswerGroundingState,
  freshness: FreshnessMetadata,
  contradictions: Contradiction[],
): string {
  if (evidence.length === 0) {
    return `No project-specific evidence was found for: "${query.question}". Run paqad-ai onboard to generate canonical documentation.`;
  }

  const primary = formatEvidenceReference(evidence[0]);
  const supporting = evidence.slice(1, 3).map(formatEvidenceReference);

  const baseAnswer =
    groundingState === 'observed'
      ? `Based on repository evidence, ${primary}`
      : `This answer is inferred from repository evidence: ${primary}`;

  const supportSentence =
    supporting.length > 0 ? ` Supporting evidence: ${supporting.join(' ')}` : '';

  const freshnessNotes: string[] = [];
  if (freshness.stale_sources.length > 0) {
    freshnessNotes.push(`Some cited sources may be stale: ${freshness.stale_sources.join(', ')}.`);
  }
  if (freshness.drift_detected) {
    freshnessNotes.push('Current stack drift is detected, so confirm live state before acting.');
  }

  const contradictionNote =
    contradictions.length > 0
      ? ` Conflicting evidence exists between ${contradictions
          .slice(0, 2)
          .map((item) => `${item.source_a} and ${item.source_b}`)
          .join(', ')}.`
      : '';

  if (query.mode === 'quick') {
    return `${baseAnswer}${freshnessNotes.length > 0 ? ` ${freshnessNotes[0]}` : ''}${contradictionNote}`.trim();
  }

  if (query.mode === 'explain') {
    return `${baseAnswer}${supportSentence}${
      freshnessNotes.length > 0 ? ` ${freshnessNotes.join(' ')}` : ''
    }${contradictionNote}`.trim();
  }

  const lines = evidence.map(
    (e, i) =>
      `[${i + 1}] ${e.path} (${e.source_class}): ${e.excerpt.slice(0, 120).replace(/\n/g, ' ').trim()}`,
  );
  const traceNotes = [...freshnessNotes];
  if (contradictions.length > 0) {
    traceNotes.push(
      `Contradictions: ${contradictions.map((item) => item.description).join(' | ')}`,
    );
  }
  return `${baseAnswer}${supportSentence}\nEvidence trail for "${query.question}":\n${lines.join('\n')}${
    traceNotes.length > 0 ? `\n${traceNotes.join('\n')}` : ''
  }`;
}

function buildConfidenceBasis(
  groundingState: AnswerGroundingState,
  evidence: EvidenceFile[],
  freshness: FreshnessMetadata,
  contradictions: Contradiction[],
): string {
  const reasons: string[] = [];

  if (groundingState === 'missing-evidence') {
    reasons.push(
      'No project evidence was found, so the answer cannot be grounded in repository artifacts.',
    );
  } else {
    const primaryEvidence = evidence[0]!;

    if (groundingState === 'observed') {
      reasons.push(`The lead citation (${primaryEvidence.path}) is a canonical module doc.`);
    } else {
      const hasSupportingCanonical = evidence.some((e) => e.source_class === 'canonical-doc');
      reasons.push(
        hasSupportingCanonical
          ? `The lead citation (${primaryEvidence.path}) is ${primaryEvidence.source_class}, so the conclusion remains inferred even though supporting canonical docs were also retrieved.`
          : `The conclusion is inferred from secondary sources (${primaryEvidence.source_class}) because the lead citation is not a canonical doc.`,
      );
    }
  }

  if (freshness.stale_sources.length > 0) {
    reasons.push(`Stale cited sources reduce confidence: ${freshness.stale_sources.join(', ')}.`);
  }

  if (freshness.drift_detected) {
    reasons.push('Detected stack drift means repository state may have changed since generation.');
  }

  if (contradictions.length > 0) {
    reasons.push('Conflicting evidence is present, so the answer needs confirmation.');
  }

  return `Confidence basis: ${reasons.join(' ')}`;
}

function buildNextActions(
  groundingState: AnswerGroundingState,
  staleSourceCount: number,
  contradictionCount: number,
): string[] {
  const actions: string[] = ['Inspect cited files for full context.'];
  if (groundingState === 'missing-evidence') {
    actions.push('Run paqad-ai onboard to generate canonical documentation.');
  }
  if (staleSourceCount > 0) {
    actions.push('Run paqad-ai update to refresh stale documentation.');
  }
  if (contradictionCount > 0) {
    actions.push('Resolve the detected contradiction before acting on this answer.');
  }
  return actions;
}

export class ProjectKnowledgeAnswerer {
  constructor(
    private readonly retriever: EvidenceRetriever = new EvidenceRetriever(),
    private readonly freshnessChecker: FreshnessChecker = new FreshnessChecker(),
    private readonly contradictionDetector: ContradictionDetector = new ContradictionDetector(),
  ) {}

  async answer(query: AnswerQuery): Promise<KnowledgeAnswer> {
    const resolvedQuery: AnswerQuery =
      query.mcp_first !== undefined
        ? query
        : {
            ...query,
            mcp_first: readProjectProfile(query.project_root)?.efficiency?.mcp_first ?? false,
          };
    const evidence = await this.retriever.retrieve(resolvedQuery);
    const groundingState = determineGroundingState(evidence);

    const citations = evidence.map((e) => ({
      path: e.path,
      source_class: e.source_class,
      excerpt: e.excerpt.slice(0, 200) || undefined,
    }));

    const freshness = await this.freshnessChecker.check(
      query.project_root,
      evidence.map((e) => e.path),
    );

    const contradictions = this.contradictionDetector.detect(evidence);

    const answer = buildAnswer(evidence, query, groundingState, freshness, contradictions);
    const confidenceBasis = buildConfidenceBasis(
      groundingState,
      evidence,
      freshness,
      contradictions,
    );
    const nextActions = buildNextActions(
      groundingState,
      freshness.stale_sources.length,
      contradictions.length,
    );

    return {
      answer,
      grounding_state: groundingState,
      citations,
      freshness,
      contradictions,
      next_actions: nextActions,
      mode: query.mode,
      confidence_basis: confidenceBasis,
    };
  }
}
