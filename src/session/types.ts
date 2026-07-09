export interface StructuredHandoff {
  version: 2;
  session_id: string;
  timestamp: string;
  stack_state_hash: string;
  retrieval: {
    rag_enabled: boolean;
    embedding_provider?: string;
  };

  active_task: {
    classification: string;
    description: string;
    spec_path: string | null;
  };

  decisions: Array<{
    description: string;
    rationale: string;
  }>;

  files_modified: string[];

  blockers: Array<{
    description: string;
    severity: 'blocking' | 'warning';
  }>;

  next_steps: string[];
  open_questions: string[];

  context_pointers: {
    spec_artifacts: string[];
    relevant_files: string[];
    relevant_docs: string[];
  };

  execution_progress?: {
    manifest_slug: string;
    completed_slices: string[];
    current_slice: string | null;
    current_slice_status:
      'pending' | 'in-progress' | 'completed' | 'failed' | 'escalated' | 'blocked' | null;
    pending_slices: string[];
    escalated_slices: string[];
  };

  compression_stats: {
    original_context_tokens: number;
    handoff_tokens: number;
    compression_ratio: number;
  };
}

export type ParsedHandoff = { version: 2; data: StructuredHandoff } | { version: 1; data: string };

export interface UnsupportedStructuredHandoff {
  version: number | string;
  data: unknown;
}
