import type { ClassificationResult } from '@/core/types/classification.js';

import {
  DocumentationWorkflow,
  type DocumentationWorkflowMode,
  type DocumentationWorkflowOptions,
  type DocumentationWorkflowResult,
} from './workflow.js';

export interface DocumentPipelineOptions extends DocumentationWorkflowOptions {
  mode?: DocumentationWorkflowMode;
  request?: Pick<ClassificationResult, 'domain' | 'stack' | 'request_text'> & {
    output_path?: string;
  };
}

export type DocumentRunResult = DocumentationWorkflowResult;

export class DocumentPipeline {
  private readonly workflow = new DocumentationWorkflow();

  async run(options: DocumentPipelineOptions): Promise<DocumentRunResult> {
    return this.workflow.run(options);
  }
}
