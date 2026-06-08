export interface StepCondition {
  complexity?: string[];
  risk?: string[];
  workflow?: string[];
}

export type OnFailureDirective = 'skip' | 'abort' | 'retry';

export interface WorkflowStep {
  skill: string;
  condition?: StepCondition;
  on_failure?: OnFailureDirective;
}

export interface ParallelGroup {
  parallel: WorkflowStep[];
  on_failure?: OnFailureDirective;
}

export type TemplateStep = WorkflowStep | ParallelGroup;

export interface WorkflowTemplate {
  name: string;
  description: string;
  triggers?: {
    workflow?: string[];
    complexity?: string[];
    risk?: string[];
  };
  steps: TemplateStep[];
}

export interface WorkflowStepProgress {
  index: number;
  skill: string | null;
  type: 'sequential' | 'parallel';
  status: 'not_started' | 'running' | 'completed' | 'skipped' | 'failed' | 'aborted' | 'cancelled';
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export interface WorkflowRunProgress {
  schema_version: '1';
  run_id: string;
  template_name: string;
  status: 'running' | 'completed' | 'failed' | 'aborted' | 'cancelled';
  started_at: string;
  updated_at: string;
  steps: WorkflowStepProgress[];
  /**
   * Number of steps that completed before a consumer cancellation (PQD-104).
   * Set only when `status === 'cancelled'`; lets the consumer resume from the
   * first not-yet-completed step.
   */
  cancelled_steps_completed?: number;
}
