import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type {
  ClassificationResult,
  ClassificationWorkflow,
  ResolutionMap,
} from '@/core/types/classification.js';
import type { PhaseResult, PipelinePhase } from '@/core/types/pipeline.js';
import type { Lane } from '@/core/types/routing.js';
import {
  isCodeFile,
  isDocumentationFile,
  isTestFile,
  type ChangeEvidence,
} from '@/pipeline/change-evidence.js';

const IMPLEMENTATION_WORKFLOWS = new Set<ClassificationWorkflow>([
  'feature-development',
  'bug-fix',
  'refactor',
  'migration',
  'cleanup',
  'architecture-change',
  'test-improvement',
  'schema-change',
  'query-optimization',
  'custom',
]);
const CONTINUITY_DOWNGRADE_WORKFLOWS = new Set<ClassificationWorkflow>([
  'project-question',
  'research',
  'writing',
  'editing',
  'planning',
  'content-update',
  'documentation-update',
  'ticket-refinement',
]);

const EXPLICIT_EXPLANATION_ONLY_PATTERNS = [
  /\b(?:explain|clarify|describe)\b.*\b(?:only|just)\b/i,
  /\b(?:only|just)\b.*\b(?:explain|clarify|describe)\b/i,
  /\bwalk me through\b.*\b(?:only|just)\b/i,
  /\b(?:no|without)\s+(?:code\s+changes?|implementation|edits?)\b/i,
  /\bdo not\s+(?:change|edit|implement|modify)\b/i,
];

export interface ActiveImplementationSessionArtifact {
  version: 1;
  updated_at: string;
  active: boolean;
  workflow: ClassificationWorkflow | null;
  lane: Lane | null;
  current_phase: PipelinePhase | null;
  scope: ClassificationResult['scope'] | null;
  affected_modules: string[];
  changed_files: string[];
  changed_files_source: ChangeEvidence['source'];
  has_code_changes: boolean;
  pending_verification: boolean;
  pending_documentation: boolean;
  unresolved_items: string[];
}

export interface ResumeImplementationDecision {
  resumed: boolean;
  classification: ClassificationResult;
}

export async function readActiveImplementationSession(
  projectRoot: string,
): Promise<ActiveImplementationSessionArtifact | null> {
  const target = join(projectRoot, PATHS.ACTIVE_IMPLEMENTATION_SESSION);
  if (!existsSync(target)) {
    return null;
  }

  try {
    const raw = await readFile(target, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isActiveImplementationSessionArtifact(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function writeActiveImplementationSession(
  projectRoot: string,
  artifact: ActiveImplementationSessionArtifact,
): Promise<void> {
  const target = join(projectRoot, PATHS.ACTIVE_IMPLEMENTATION_SESSION);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
}

export function createActiveImplementationSession(
  classification: ClassificationResult,
  lane: Lane | null,
  currentPhase: PipelinePhase | null,
  phases: PhaseResult[],
  changeEvidence: ChangeEvidence,
): ActiveImplementationSessionArtifact {
  const workflow = classification.workflow;
  const implementationWorkflow = workflow !== null && IMPLEMENTATION_WORKFLOWS.has(workflow);
  const changedFiles = changeEvidence.files;
  const hasCodeChanges = changedFiles.some(
    (filePath) => isCodeFile(filePath) || isTestFile(filePath),
  );
  const verificationPassed = phases.some(
    (phase) => phase.phase === 'verification-gates' && phase.status === 'pass',
  );
  const documentationPassed = phases.some(
    (phase) => phase.phase === 'documentation-update' && phase.status === 'pass',
  );
  const pendingVerification = implementationWorkflow && hasCodeChanges && !verificationPassed;
  const pendingDocumentation =
    implementationWorkflow &&
    changedFiles.some((filePath) => !isDocumentationFile(filePath)) &&
    !documentationPassed;
  const unresolvedItems = phases
    .filter((phase) => phase.status !== 'pass')
    .map((phase) => phase.summary);
  const active =
    implementationWorkflow &&
    (pendingVerification ||
      pendingDocumentation ||
      unresolvedItems.length > 0 ||
      (currentPhase !== null && currentPhase !== 'documentation-update'));

  return {
    version: 1,
    updated_at: new Date().toISOString(),
    active,
    workflow,
    lane,
    current_phase: currentPhase,
    scope: classification.scope,
    affected_modules: [...classification.affected_modules],
    changed_files: [...changedFiles],
    changed_files_source: changeEvidence.source,
    has_code_changes: hasCodeChanges,
    pending_verification: pendingVerification,
    pending_documentation: pendingDocumentation,
    unresolved_items: unresolvedItems,
  };
}

export function applyActiveImplementationSession(
  requestText: string,
  classification: ClassificationResult,
  session: ActiveImplementationSessionArtifact | null,
  resolutionMap?: ResolutionMap,
): ResumeImplementationDecision {
  const continuityCandidate =
    classification.workflow !== null && CONTINUITY_DOWNGRADE_WORKFLOWS.has(classification.workflow);
  const explicitExplanationOnly = isExplicitExplanationOnlyIntent(requestText);

  if (
    session === null ||
    !session.active ||
    session.workflow === null ||
    classification.workflow === null ||
    !continuityCandidate ||
    explicitExplanationOnly
  ) {
    return {
      resumed: false,
      classification: {
        ...classification,
        resumed_from_session: false,
        resume_lane: null,
        workflow_continuity_reason:
          session !== null &&
          session.active &&
          session.workflow !== null &&
          continuityCandidate &&
          explicitExplanationOnly
            ? `Allowed transition from active implementation workflow "${session.workflow}" to "${classification.workflow}" because the follow-up explicitly requested explanation-only guidance.`
            : null,
      },
    };
  }

  if (resolutionMap) {
    Object.assign(resolutionMap, {
      workflow: 'session-resume',
      ...(session.scope ? { scope: 'session-resume' } : {}),
      ...(session.affected_modules.length > 0 ? { affected_modules: 'session-resume' } : {}),
    });
  }

  return {
    resumed: true,
    classification: {
      ...classification,
      workflow: session.workflow,
      workflow_source: 'active-session',
      workflow_reason: `Resumed active implementation workflow "${session.workflow}" because verification or documentation work is still unresolved.`,
      scope: session.scope ?? classification.scope,
      affected_modules:
        session.affected_modules.length > 0
          ? [...session.affected_modules]
          : classification.affected_modules,
      resumed_from_session: true,
      resume_lane: session.lane,
      workflow_continuity_reason:
        'Active implementation session remained open, so the follow-up stayed on the implementation lane.',
    },
  };
}

export function isExplicitExplanationOnlyIntent(requestText: string): boolean {
  const trimmed = requestText.trim();
  return EXPLICIT_EXPLANATION_ONLY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isActiveImplementationSessionArtifact(
  value: unknown,
): value is ActiveImplementationSessionArtifact {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ActiveImplementationSessionArtifact>;
  return (
    candidate.version === 1 &&
    typeof candidate.updated_at === 'string' &&
    typeof candidate.active === 'boolean' &&
    Array.isArray(candidate.changed_files) &&
    Array.isArray(candidate.affected_modules) &&
    Array.isArray(candidate.unresolved_items)
  );
}
