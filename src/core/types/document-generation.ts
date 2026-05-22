export type DocumentScope = 'ui' | 'api' | 'database' | 'architecture' | 'full';

export type DocProgressState = 'not_started' | 'generating' | 'done' | 'failed';

export interface DocProgressEntry {
  output_path: string;
  state: DocProgressState;
  started_at: string | null;
  completed_at: string | null;
  source_files: string[];
  source_hash: string | null;
  tokens_used: number | null;
  error: string | null;
  design_tokens?: {
    extraction_state: DocProgressState;
    total_tokens_found: number;
    placeholder_count: number;
    populated_count: number;
    placeholder_keys: string[];
  };
}

export type ModuleDocStage = 'pending_map_review' | 'complete';

export interface DocProgressFile {
  schema_version: '1';
  generated_by: 'paqad-ai';
  framework_version: string;
  modules: Record<string, Record<string, DocProgressEntry>>;
  global: Record<string, Record<string, DocProgressEntry>>;
  moduleDocStage?: ModuleDocStage;
}
