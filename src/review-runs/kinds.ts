import { PATHS } from '@/core/constants/paths.js';

export type ReviewKindId = 'security' | 'design';

export interface ReviewStageDefinition {
  id: string;
  index: number;
  label: string;
  name: string;
  running: string;
}

export interface ReviewKind {
  id: ReviewKindId;
  route: string;
  verb: string;
  word: string;
  prefix: string;
  run_path: string;
  view_path: string;
  lock_path: string;
  resume_prompt: string;
  continue_words: string;
  stages: readonly ReviewStageDefinition[];
}

function stages(
  rows: ReadonlyArray<readonly [string, string, string, string]>,
): ReviewStageDefinition[] {
  return rows.map(([id, label, name, running], at) => ({
    id,
    index: at + 1,
    label,
    name,
    running,
  }));
}

export const REVIEW_KINDS: Readonly<Record<ReviewKindId, ReviewKind>> = {
  security: {
    id: 'security',
    route: 'pentest',
    verb: 'security-review',
    word: 'Security review',
    prefix: 'PT-',
    run_path: PATHS.SECURITY_REVIEW_RUN,
    view_path: PATHS.SECURITY_REVIEW_VIEW,
    lock_path: PATHS.SECURITY_REVIEW_LOCK,
    resume_prompt: 'continue paqad security review',
    continue_words: 'say "continue paqad security review"',
    stages: stages([
      ['scope', 'Scope', 'Set the scope', 'Setting the scope'],
      ['map', 'Map', 'Map the attack surface', 'Mapping the attack surface'],
      ['scan', 'Scan', 'Run the scanners', 'Running the scanners'],
      ['threats', 'Threats', 'Model the threats', 'Modelling the threats'],
      ['hunt', 'Hunt', 'Hunt for weaknesses', 'Hunting for weaknesses'],
      ['confirm', 'Confirm', 'Confirm the findings', 'Confirming the findings'],
      ['sweep', 'Sweep', 'Sweep for variants', 'Sweeping for variants'],
      ['report', 'Report', 'Write the report', 'Writing the report'],
    ]),
  },
  design: {
    id: 'design',
    route: 'design-test',
    verb: 'design-review',
    word: 'Design review',
    prefix: 'DT-',
    run_path: PATHS.DESIGN_REVIEW_RUN,
    view_path: PATHS.DESIGN_REVIEW_VIEW,
    lock_path: PATHS.DESIGN_REVIEW_LOCK,
    resume_prompt: 'continue paqad design review',
    continue_words: 'say "continue paqad design review"',
    stages: stages([
      ['scope', 'Scope', 'Check the design system', 'Checking the design system'],
      ['map', 'Map', 'Map the screens and components', 'Mapping the screens and components'],
      ['code', 'Code', 'Review the UI code', 'Reviewing the UI code'],
      ['screens', 'Screens', 'Walk the screens', 'Walking the screens'],
      ['tasks', 'Tasks', 'Try the user tasks', 'Trying the user tasks'],
      ['judge', 'Judge', 'Judge against the contract', 'Judging against the contract'],
      ['confirm', 'Confirm', 'Confirm the findings', 'Confirming the findings'],
      ['report', 'Report', 'Write the report', 'Writing the report'],
    ]),
  },
};

export const REVIEW_KIND_IDS: readonly ReviewKindId[] = ['security', 'design'];

export function reviewStage(kind: ReviewKind, id: string): ReviewStageDefinition | null {
  return kind.stages.find((stage) => stage.id === id) ?? null;
}
