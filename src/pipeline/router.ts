import type { ClassificationResult } from '@/core/types/classification.js';
import type { Lane } from '@/core/types/routing.js';
import type { PipelinePhase } from '@/core/types/pipeline.js';

const DOCUMENTATION_PHASES: PipelinePhase[] = [
  'request-classification',
  'docs-first-load',
  'analysis',
  'documentation-update',
];

const PROJECT_QUESTION_PHASES: PipelinePhase[] = [
  'request-classification',
  'docs-first-load',
  'analysis',
  'question-answering',
];

const RCA_PHASES: PipelinePhase[] = [
  'request-classification',
  'docs-first-load',
  'analysis',
  'root-cause-analysis',
  'documentation-update',
];

const PENTEST_PHASES: PipelinePhase[] = [
  'request-classification',
  'docs-first-load',
  'analysis',
  'pentest',
];

const PENTEST_RETEST_PHASES: PipelinePhase[] = [
  'request-classification',
  'docs-first-load',
  'analysis',
  'pentest-retest',
];

const CONTENT_RESEARCH_PHASES: PipelinePhase[] = [
  'request-classification',
  'docs-first-load',
  'analysis',
  'question-answering',
];

export const LANE_PHASES: Record<Lane, PipelinePhase[]> = {
  full: [
    'request-classification',
    'docs-first-load',
    'analysis',
    'sequence-planning',
    'specification',
    'user-flow',
    'spec-review',
    'implementation',
    'implementation-review',
    'verification-gates',
    'documentation-update',
  ],
  graduated: [
    'request-classification',
    'docs-first-load',
    'analysis',
    'sequence-planning',
    'specification',
    'spec-review',
    'implementation',
    'implementation-review',
    'verification-gates',
    'documentation-update',
  ],
  fast: [
    'request-classification',
    'docs-first-load',
    'implementation',
    'implementation-review',
    'verification-gates',
    'documentation-update',
  ],
};

export class PipelineRouter {
  route(classification: ClassificationResult): {
    lane: Lane | null;
    phases: PipelinePhase[];
    route_reason?: string | null;
  } {
    if (classification.workflow === null) {
      return {
        lane: null,
        phases: [],
        route_reason: classification.workflow_reason ?? 'No workflow matched the request.',
      };
    }

    const lane = classification.resume_lane ?? selectLaneFromClassification(classification);

    // A capability gap only justifies the fast lane when the task itself is not high-complexity
    // or high-risk. For high-stakes requests, respect the derived lane so the full spec/review
    // process still runs — the gap will surface as a warning inside the analysis phase.
    if (
      !classification.resume_lane &&
      classification.capability_gap &&
      classification.target_capability !== 'content' &&
      classification.complexity !== 'high' &&
      classification.complexity !== 'very-high' &&
      classification.risk !== 'high'
    ) {
      return {
        lane: 'fast',
        phases: [...PROJECT_QUESTION_PHASES],
      };
    }

    if (classification.workflow === 'module-documentation') {
      return {
        lane,
        phases: [
          'request-classification',
          'docs-first-load',
          'analysis',
          'module-documentation',
        ] satisfies PipelinePhase[],
      };
    }

    if (
      classification.workflow === 'documentation-update' ||
      classification.workflow === 'writing' ||
      classification.workflow === 'editing' ||
      classification.workflow === 'planning' ||
      classification.output_type === 'documentation'
    ) {
      return {
        lane,
        phases: [...DOCUMENTATION_PHASES],
      };
    }

    if (classification.workflow === 'research') {
      return {
        lane: 'fast',
        phases: [...CONTENT_RESEARCH_PHASES],
      };
    }

    if (classification.workflow === 'project-question') {
      return {
        lane,
        phases: [...PROJECT_QUESTION_PHASES],
      };
    }

    if (classification.workflow === 'root-cause-analysis') {
      return {
        lane,
        phases: [...RCA_PHASES],
      };
    }

    if (classification.workflow === 'pentest') {
      return {
        lane,
        phases: [...PENTEST_PHASES],
      };
    }

    if (classification.workflow === 'pentest-retest') {
      return {
        lane,
        phases: [...PENTEST_RETEST_PHASES],
      };
    }

    if (classification.workflow === 'custom') {
      return {
        lane,
        phases: [...LANE_PHASES[lane]],
      };
    }

    return {
      lane,
      phases: [...LANE_PHASES[lane]],
      route_reason: classification.workflow_continuity_reason ?? null,
    };
  }
}

function selectLaneFromClassification(classification: ClassificationResult): Lane {
  if (classification.workflow === 'project-question') {
    return 'fast';
  }

  if (
    classification.workflow === 'writing' ||
    classification.workflow === 'editing' ||
    classification.workflow === 'planning' ||
    classification.workflow === 'research'
  ) {
    return 'fast';
  }

  if (classification.workflow === 'custom') {
    if (classification.complexity === 'trivial' || classification.complexity === 'low') {
      return 'fast';
    }
    return classification.risk === 'high' ? 'full' : 'graduated';
  }

  if (classification.workflow === 'investigation') {
    return 'fast';
  }

  if (classification.workflow === 'pentest' || classification.workflow === 'pentest-retest') {
    return 'graduated';
  }

  if (classification.workflow === 'migration') {
    return 'full';
  }

  if (classification.workflow === 'bug-fix') {
    return classification.complexity === 'low' && classification.risk === 'low'
      ? 'fast'
      : 'graduated';
  }

  if (classification.workflow === 'feature-development') {
    return classification.risk === 'high' ? 'full' : 'graduated';
  }

  if (classification.complexity === 'trivial') {
    return 'fast';
  }

  if (classification.complexity === 'low' && classification.risk === 'low') {
    return 'fast';
  }

  if (classification.complexity === 'low' && classification.risk !== 'low') {
    return 'graduated';
  }

  if (classification.complexity === 'medium' && classification.risk !== 'high') {
    return 'graduated';
  }

  return 'full';
}
