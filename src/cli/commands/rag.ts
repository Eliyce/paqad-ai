import { readFileSync } from 'node:fs';

import { confirm, input, select } from '@inquirer/prompts';
import { Command } from 'commander';

import { EMBEDDING_PROVIDERS, getDefaultEmbeddingModel } from '@/core/project-intelligence.js';
import type { EmbeddingProviderName } from '@/core/types/project-profile.js';
import { createRagProgressReporter } from '@/cli/ui/rag-progress.js';
import { gatherCodebaseMemory } from '@/context/codebase-memory.js';
import { refreshRuleContext } from '@/context/rule-context.js';
import { composeRetrievalSection, gatherWorkingSetSlices } from '@/context/retrieval-context.js';
import { backgroundIndexSync } from '@/rag/background-sync.js';
import { writeGitignore } from '@/onboarding/gitignore-writer.js';
import { compareConfigurations } from '@/rag/benchmark-gates.js';
import type { ConfigurationComparisonResult, RagBenchmarkSnapshot } from '@/rag/benchmark-gates.js';
import { EVAL_DATASET } from '@/rag/eval-dataset.js';
import { EvalRunner, runFeatureOffVsOnGate, snapshotFromTraces } from '@/rag/eval-runner.js';
import { RagService } from '@/rag/service.js';
import { EmbeddingProviderError } from '@/rag/types.js';
import type { ComparisonMode, EvalTrace } from '@/rag/types.js';

function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

function printProgress(message: string): void {
  process.stderr.write(`${message}\n`);
}

const progressPrinter = createRagProgressReporter(printProgress);

async function resolveProvider(
  explicit?: string,
  current?: EmbeddingProviderName,
): Promise<EmbeddingProviderName> {
  if (explicit && EMBEDDING_PROVIDERS.includes(explicit as EmbeddingProviderName)) {
    return explicit as EmbeddingProviderName;
  }

  if (!isInteractive()) {
    return current ?? 'local';
  }

  return select<EmbeddingProviderName>({
    message: 'How should paqad-ai build your RAG index?',
    default: current ?? 'local',
    choices: [
      {
        value: 'local',
        name: 'On my machine (FREE — no account needed)',
        description: 'Runs a local embedding model with shared cache under ~/.paqad/models',
      },
      {
        value: 'openai',
        name: 'Using my OpenAI key',
        description: 'Uses text-embedding-3-small for remote embeddings',
      },
      {
        value: 'voyageai',
        name: 'Using my Voyage AI key',
        description: 'Uses voyage-code-3 for remote code embeddings',
      },
    ],
  });
}

async function maybePromptApiKey(
  service: RagService,
  provider: EmbeddingProviderName,
  force = false,
): Promise<void> {
  if (provider === 'local' || (!force && service.hasApiKey(provider))) {
    return;
  }

  if (!isInteractive()) {
    throw new Error(`Missing ${provider === 'openai' ? 'OPENAI_API_KEY' : 'VOYAGE_API_KEY'}`);
  }

  const key = await input({
    message: `Enter your ${provider === 'openai' ? 'OpenAI' : 'Voyage AI'} API key`,
    validate: (value) => (value.trim().length > 0 ? true : 'API key is required'),
  });
  service.storeApiKey(provider, key.trim());
}

function formatProviderFailure(error: unknown): string {
  if (error instanceof EmbeddingProviderError) {
    switch (error.code) {
      case 'missing_api_key':
      case 'invalid_api_key':
        return error.message;
      case 'rate_limited':
        return `${error.message}. The CLI will let you retry or switch providers.`;
      case 'download_failed':
        return `${error.message}. Retry to download and cache the model again.`;
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

async function buildWithRecovery(
  service: RagService,
  current: Awaited<ReturnType<RagService['getStatus']>>,
  options: {
    provider?: string;
    model?: string;
  },
): Promise<Awaited<ReturnType<RagService['configureAndBuild']>>> {
  let provider = await resolveProvider(options.provider, current.configured_provider);
  let explicitModel = options.model;

  for (;;) {
    await maybePromptApiKey(service, provider);
    const model =
      explicitModel ??
      (current.configured_provider === provider ? current.configured_model : undefined) ??
      getDefaultEmbeddingModel(provider);

    try {
      return await service.configureAndBuild(
        {
          rag_enabled: true,
          embedding_provider: provider,
          embedding_model: model,
        },
        progressPrinter,
      );
    } catch (error) {
      if (!isInteractive()) {
        throw error;
      }

      printProgress(formatProviderFailure(error));
      if (!(error instanceof EmbeddingProviderError)) {
        throw error;
      }

      if (provider === 'local') {
        const retryLocal = await confirm({
          message: 'Retry downloading and building the local RAG index?',
          default: true,
        });
        if (!retryLocal) {
          throw error;
        }
        continue;
      }

      const action = await select<'retry-key' | 'switch-provider' | 'cancel'>({
        message: 'RAG setup failed. What would you like to do?',
        choices: [
          { value: 'retry-key', name: 'Retry with a new API key' },
          { value: 'switch-provider', name: 'Switch embedding provider' },
          { value: 'cancel', name: 'Cancel setup' },
        ],
      });

      if (action === 'cancel') {
        throw error;
      }
      if (action === 'switch-provider') {
        const nextProvider = await resolveProvider(undefined, provider);
        if (nextProvider !== provider) {
          explicitModel = undefined;
        }
        provider = nextProvider;
        continue;
      }

      await maybePromptApiKey(service, provider, true);
    }
  }
}

export function createRagCommand(): Command {
  const command = new Command('rag').description('Manage optional hybrid RAG context retrieval');

  command
    .command('init')
    .description('Enable RAG for the current project and build the vector index')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--provider <provider>', 'Embedding provider: local, openai, or voyageai')
    .option('--model <model>', 'Override the default embedding model')
    .option('--yes', 'Accept rebuild prompts automatically')
    .action(
      async (options: {
        projectRoot: string;
        provider?: string;
        model?: string;
        yes?: boolean;
      }) => {
        const service = new RagService(options.projectRoot);
        const current = await service.getStatus();
        if (current.index_present && current.valid && !options.yes) {
          if (!isInteractive()) {
            process.stdout.write(`${JSON.stringify(current, null, 2)}\n`);
            return;
          }

          const shouldRebuild = await confirm({
            message: 'A valid RAG index already exists. Rebuild it now?',
            default: false,
          });
          if (!shouldRebuild) {
            process.stdout.write(`${JSON.stringify(current, null, 2)}\n`);
            return;
          }
        }

        const status = await buildWithRecovery(service, current, {
          provider: options.provider,
          model: options.model,
        });
        writeGitignore(options.projectRoot);
        process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      },
    );

  command
    .command('rebuild')
    .description('Force a full vector-index rebuild')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action(async (options: { projectRoot: string }) => {
      const service = new RagService(options.projectRoot);
      await service.rebuild({
        onProgress: progressPrinter,
      });
      process.stdout.write(`${JSON.stringify(await service.getStatus(), null, 2)}\n`);
    });

  command
    .command('clear')
    .description('Delete the vector index and disable RAG')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--yes', 'Skip confirmation prompt')
    .action(async (options: { projectRoot: string; yes?: boolean }) => {
      if (!options.yes) {
        if (!isInteractive()) {
          throw new Error('Refusing to clear RAG index without --yes in non-interactive mode');
        }
        const accepted = await confirm({
          message: 'Delete the vector index and disable RAG for this project?',
          default: false,
        });
        if (!accepted) {
          return;
        }
      }
      const service = new RagService(options.projectRoot);
      await service.clear();
      process.stdout.write(`${JSON.stringify(await service.getStatus(), null, 2)}\n`);
    });

  command
    .command('status')
    .description('Show the current RAG configuration and index state')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action(async (options: { projectRoot: string }) => {
      const service = new RagService(options.projectRoot);
      process.stdout.write(`${JSON.stringify(await service.getStatus(), null, 2)}\n`);
    });

  // RAG buildout F5/F9/F11 — the background "refresh session context" worker the
  // prompt-time trigger spawns detached. It (1) incrementally syncs the vector index
  // to the working tree (F9, only when an index already exists), (2) retrieves the
  // top-k slices relevant to the files in play over that fresh index (F11), and
  // (3) recomposes the session-context artifact = rule slice (F5) + retrieval slice
  // (F11). Sync runs first so retrieval queries the up-to-date index. Everything is
  // single-flight-locked and never blocks. Quiet by default so a detached run
  // produces no stray output. When rag is off / there is no index, the retrieval
  // gather returns nothing and the artifact stays rule-only (disabled == today).
  command
    .command('refresh-context')
    .description(
      'Sync the index, retrieve slices, and recompose session context (background worker)',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--quiet', 'Suppress output (used by the background trigger)')
    .action(async (options: { projectRoot: string; quiet?: boolean }) => {
      const sync = await backgroundIndexSync(options.projectRoot);
      const slices = await gatherWorkingSetSlices(options.projectRoot);
      const retrievalSection = composeRetrievalSection(slices);
      // F21 — durable codebase memory, deterministic and embedding-free (no provider
      // call), gathered from the on-disk store and injected ahead of the slices.
      const memorySection = gatherCodebaseMemory(options.projectRoot);
      const target = await refreshRuleContext(options.projectRoot, {
        memorySection,
        retrievalSection,
      });
      if (!options.quiet) {
        process.stdout.write(
          `${target ? `wrote ${target}` : 'nothing to compose'}; index sync: ${
            sync.synced ? 'done' : sync.reason
          }; slices: ${slices.length}\n`,
        );
      }
    });

  command
    .command('eval')
    .description('Run deterministic RAG evals against the project index and compare configurations')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--mode <mode>',
      'Comparison mode: lexical-vs-rag | rag-vs-candidate | feature-off-vs-on',
      'rag-vs-candidate',
    )
    .option('--baseline <path>', 'Path to a stored RagBenchmarkSnapshot JSON for comparison')
    .option('--model-graded', 'Run the optional model-graded lane')
    .action(
      async (options: {
        projectRoot: string;
        mode?: ComparisonMode;
        baseline?: string;
        modelGraded?: boolean;
      }) => {
        const service = new RagService(options.projectRoot);
        const runner = new EvalRunner();
        const sync = await service.refreshContext();
        const mode = options.mode as ComparisonMode;

        const traces: EvalTrace[] = [];
        for (const item of EVAL_DATASET) {
          if (item.should_skip_retrieval) {
            traces.push({
              item_id: item.id,
              retrieval_depth: 'none',
              first_stage_chunk_ids: [],
              packed_chunk_ids: [],
            });
            continue;
          }

          const ragResult = await service.retrieve(sync, {
            taskDescription: item.task_description,
            keywords: item.keywords,
          });
          const packedChunks = ragResult.retrieved_chunks.slice(0, 5);
          traces.push({
            item_id: item.id,
            retrieval_depth: ragResult.chunks_retrieved > 0 ? 'standard' : 'none',
            first_stage_chunk_ids: ragResult.retrieved_source_files,
            packed_chunk_ids: packedChunks.map((chunk) => chunk.source_file),
            packed_token_count: packedChunks.reduce(
              (sum, chunk) => sum + Math.ceil(chunk.content.length / 4),
              0,
            ),
            final_answer_or_recommendation: packedChunks[0]?.source_file,
          });
        }

        const result = runner.run(EVAL_DATASET, mode, traces);

        if (options.modelGraded) {
          result.model_graded = await runner.runModelGraded(EVAL_DATASET, traces);
        }

        // Derive candidate (feature-ON) snapshot from real traces.
        const candidateSnapshot = snapshotFromTraces(EVAL_DATASET, traces);

        let comparison: ConfigurationComparisonResult | undefined;
        // F15 — the on/off A/B merge gate. In feature-off-vs-on mode we self-generate
        // the feature-OFF baseline (no retrieval) and gate ON against it, no external
        // baseline file required. A failed gate (quality down, or tokens up without a
        // task-success improvement) sets a non-zero exit so CI blocks the merge.
        if (mode === 'feature-off-vs-on') {
          const ab = runFeatureOffVsOnGate(EVAL_DATASET, traces);
          comparison = ab.comparison;
          if (!comparison.evaluation.passed) {
            process.exitCode = 1;
          }
          process.stdout.write(
            `${JSON.stringify(
              {
                eval_run: result,
                feature_off_snapshot: ab.off,
                feature_on_snapshot: ab.on,
                comparison,
                gate_passed: comparison.evaluation.passed,
              },
              null,
              2,
            )}\n`,
          );
          return;
        }

        if (options.baseline) {
          const baselineSnapshot = JSON.parse(
            readFileSync(options.baseline, 'utf8'),
          ) as RagBenchmarkSnapshot;
          comparison = compareConfigurations(baselineSnapshot, candidateSnapshot, mode);
        }

        process.stdout.write(
          `${JSON.stringify({ eval_run: result, candidate_snapshot: candidateSnapshot, comparison }, null, 2)}\n`,
        );
      },
    );

  return command;
}
