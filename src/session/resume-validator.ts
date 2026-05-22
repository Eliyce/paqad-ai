import type { RagStatus } from '@/rag/types.js';

import { HandoffParser } from './handoff-parser.js';

interface ResumeStatusProvider {
  getStatus(): Promise<RagStatus>;
}

export interface SessionResumeValidation {
  rag_enabled: boolean;
  embedding_provider?: string;
  index_valid: boolean;
  rebuild_required: boolean;
  warning?: string;
}

export class SessionResumeValidator {
  constructor(
    private readonly parser = new HandoffParser(),
    private readonly serviceFactory: (
      projectRoot: string,
    ) => Promise<ResumeStatusProvider> | ResumeStatusProvider = async (projectRoot) => {
      const { RagService } = await import('@/rag/service.js');
      return new RagService(projectRoot);
    },
  ) {}

  async validate(projectRoot: string): Promise<SessionResumeValidation> {
    const parsed = await this.parser.parse(projectRoot);
    if (!parsed || !this.parser.isStructured(parsed) || !parsed.data.retrieval.rag_enabled) {
      return {
        rag_enabled: false,
        embedding_provider: undefined,
        index_valid: true,
        rebuild_required: false,
      };
    }

    const status = await (await this.serviceFactory(projectRoot)).getStatus();
    if (status.index_present && status.valid) {
      return {
        rag_enabled: true,
        embedding_provider: parsed.data.retrieval.embedding_provider,
        index_valid: true,
        rebuild_required: false,
      };
    }

    return {
      rag_enabled: true,
      embedding_provider: parsed.data.retrieval.embedding_provider,
      index_valid: false,
      rebuild_required: true,
      warning: `RAG index is unavailable or stale (${status.reason ?? 'missing index'}). Run \`paqad-ai rag rebuild\` before resuming semantic retrieval.`,
    };
  }
}
