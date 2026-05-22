import { input, select } from '@inquirer/prompts';

import {
  getDefaultEmbeddingModel,
  normalizeIntelligenceConfig,
} from '@/core/project-intelligence.js';
import type { EmbeddingProviderName, IntelligenceConfig } from '@/core/types/project-profile.js';
import { createRagProgressReporter, renderRagIntroPanel } from '@/cli/ui/rag-progress.js';
import { RagService } from '@/rag/service.js';

export interface RagSelection {
  enabled: boolean;
  provider?: EmbeddingProviderName;
  model?: string;
}

function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

function printRagProgress(message: string): void {
  process.stderr.write(`${message}\n`);
}

export async function resolveRagSelection(
  domain: 'coding' | 'content',
  preset?: RagSelection,
): Promise<RagSelection | undefined> {
  if (preset) {
    return preset.enabled
      ? {
          enabled: true,
          provider: preset.provider ?? 'local',
          model: preset.model ?? getDefaultEmbeddingModel(preset.provider ?? 'local'),
        }
      : { enabled: false };
  }

  if (domain !== 'coding' || !isInteractive()) {
    return undefined;
  }

  process.stdout.write(renderRagIntroPanel());

  const enabled = await select<boolean>({
    message: 'Want to enable this?',
    choices: [
      {
        value: true,
        name: 'Yes, set it up for me',
        description: 'Recommended for coding projects',
      },
      { value: false, name: 'No, skip for now' },
    ],
    default: true,
  });

  if (!enabled) {
    return { enabled: false };
  }

  const provider = await select<EmbeddingProviderName>({
    message: 'How should paqad-ai build your RAG index?',
    default: 'local',
    choices: [
      {
        value: 'local',
        name: 'On my machine (FREE — no account needed)',
        description:
          'Runs a local embedding model (~80MB), private and shared under ~/.paqad/models',
      },
      {
        value: 'openai',
        name: 'Using my OpenAI key',
        description: 'Uses text-embedding-3-small for remote embeddings',
      },
      {
        value: 'voyageai',
        name: 'Using my Voyage AI key',
        description: 'Uses voyage-code-3, purpose-built for code embeddings',
      },
    ],
  });

  return {
    enabled: true,
    provider,
    model: getDefaultEmbeddingModel(provider),
  };
}

export function applyRagSelection(
  intelligence: IntelligenceConfig,
  ragSelection?: RagSelection,
): IntelligenceConfig {
  if (!ragSelection) {
    return normalizeIntelligenceConfig(intelligence);
  }

  if (!ragSelection.enabled || !ragSelection.provider) {
    return normalizeIntelligenceConfig({
      ...intelligence,
      rag_enabled: false,
      embedding_provider: undefined,
      embedding_model: undefined,
    });
  }

  return normalizeIntelligenceConfig({
    ...intelligence,
    rag_enabled: true,
    embedding_provider: ragSelection.provider,
    embedding_model: ragSelection.model ?? getDefaultEmbeddingModel(ragSelection.provider),
  });
}

export async function enableRagDuringOnboarding(
  projectRoot: string,
  ragSelection: RagSelection,
): Promise<void> {
  if (!ragSelection.provider) {
    return;
  }

  const service = new RagService(projectRoot);
  if (ragSelection.provider !== 'local' && !service.hasApiKey(ragSelection.provider)) {
    if (!isInteractive()) {
      throw new Error(
        `Missing ${ragSelection.provider === 'openai' ? 'OPENAI_API_KEY' : 'VOYAGE_API_KEY'}`,
      );
    }

    const key = await input({
      message: `Enter your ${ragSelection.provider === 'openai' ? 'OpenAI' : 'Voyage AI'} API key`,
      validate: (value) => (value.trim().length > 0 ? true : 'API key is required'),
    });
    service.storeApiKey(ragSelection.provider, key.trim());
  }

  const reportProgress = createRagProgressReporter(printRagProgress);
  await service.configureAndBuild(
    {
      rag_enabled: true,
      embedding_provider: ragSelection.provider,
      embedding_model: ragSelection.model ?? getDefaultEmbeddingModel(ragSelection.provider),
    },
    reportProgress,
  );
}
