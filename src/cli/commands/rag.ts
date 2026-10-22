import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { confirm, input, select } from '@inquirer/prompts';
import { Command } from 'commander';

import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  EMBEDDING_PROVIDERS,
  LOCAL_EMBEDDING_MODELS,
  getDefaultEmbeddingModel,
} from '@/core/project-intelligence.js';
import type { EmbeddingProviderName } from '@/core/types/project-profile.js';
import { createRagProgressReporter } from '@/cli/ui/rag-progress.js';
import { refreshCodeKnowledgeIndex } from '@/code-knowledge/refresh.js';
import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { gatherCodebaseMemory } from '@/context/codebase-memory.js';
import { composeContextPack, distillSlices } from '@/context/context-pack.js';
import { gatherExistingSurface } from '@/context/existing-surface.js';
import { refreshRuleContext } from '@/context/rule-context.js';
import {
  MAX_RETRIEVAL_SLICES,
  composeRetrievalSection,
  gatherWorkingSetSlices,
} from '@/context/retrieval-context.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { compositionForRoute, readSessionRoute } from '@/pipeline/session-route.js';
import { recordRagEvidence } from '@/rag-ledger/recorder.js';
import type { RagInjectedSection } from '@/rag-ledger/types.js';
import { backgroundIndexSync } from '@/rag/background-sync.js';
import { composeBaseDriftSection, loadBaseDrift, refreshBaseDrift } from '@/rag/base-drift.js';
import { writeGitignore } from '@/onboarding/gitignore-writer.js';
import { compareConfigurations } from '@/rag/benchmark-gates.js';
import type { ConfigurationComparisonResult, RagBenchmarkSnapshot } from '@/rag/benchmark-gates.js';
import { EVAL_DATASET } from '@/rag/eval-dataset.js';
import { EvalRunner, runFeatureOffVsOnGate, snapshotFromTraces } from '@/rag/eval-runner.js';
import { appendRagAudit } from '@/rag/audit.js';
import {
  assertEmbeddingProviderAvailable,
  REMOVED_EMBEDDING_PROVIDER_MESSAGE,
  resolveRemovedEmbeddingProvider,
} from '@/rag/removed-provider.js';
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
    ],
  });
}

async function resolveLocalModel(current?: string): Promise<string> {
  const fallback = current ?? DEFAULT_LOCAL_EMBEDDING_MODEL;
  if (!isInteractive()) {
    return fallback;
  }
  return select<string>({
    message: 'Which local embedding model?',
    default: fallback,
    choices: LOCAL_EMBEDDING_MODELS.map((model) => ({
      value: model.id,
      name: model.label,
      description: model.description,
    })),
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
    throw new Error('Missing OPENAI_API_KEY');
  }

  const key = await input({
    message: 'Enter your OpenAI API key',
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
    buildOnly?: boolean;
  },
): Promise<Awaited<ReturnType<RagService['configureAndBuild']>>> {
  let provider = await resolveProvider(options.provider, current.configured_provider);
  let explicitModel = options.model;

  for (;;) {
    await maybePromptApiKey(service, provider);
    const carriedModel =
      explicitModel ??
      (current.configured_provider === provider ? current.configured_model : undefined);
    const model =
      carriedModel ??
      (provider === 'local'
        ? await resolveLocalModel(DEFAULT_LOCAL_EMBEDDING_MODEL)
        : getDefaultEmbeddingModel(provider));

    try {
      const buildArgs = [
        {
          rag_enabled: true,
          embedding_provider: provider,
          embedding_model: model,
        },
        progressPrinter,
      ] as const;
      return options.buildOnly
        ? await service.buildIndexOnly(...buildArgs)
        : await service.configureAndBuild(...buildArgs);
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

export interface InitializeRagIndexOptions {
  provider?: string;
  model?: string;
  current?: Awaited<ReturnType<RagService['getStatus']>>;
  buildOnly?: boolean;
}

export async function initializeRagIndex(
  projectRoot: string,
  options: InitializeRagIndexOptions = {},
): Promise<Awaited<ReturnType<RagService['configureAndBuild']>>> {
  assertEmbeddingProviderAvailable(projectRoot, options.provider);
  const service = new RagService(projectRoot);
  const current = options.current ?? (await service.getStatus());
  return buildWithRecovery(service, current, {
    provider: options.provider,
    model: options.model,
    buildOnly: options.buildOnly,
  });
}

export function createRagCommand(): Command {
  const command = new Command('rag').description('Manage optional hybrid RAG context retrieval');

  command
    .command('init')
    .description('Enable RAG for the current project and build the vector index')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--provider <provider>', 'Embedding provider: local, openai')
    .option('--model <model>', 'Override the default embedding model')
    .option('--yes', 'Accept rebuild prompts automatically')
    .action(
      async (options: {
        projectRoot: string;
        provider?: string;
        model?: string;
        yes?: boolean;
      }) => {
        assertEmbeddingProviderAvailable(options.projectRoot, options.provider);
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

        const status = await initializeRagIndex(options.projectRoot, {
          current,
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

  command
    .command('probe <query>')
    .description(
      'Print the top pre-floor retrieval scores for a query (diagnostic; no floor filter)',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--top-n <n>', 'How many candidates to show', '10')
    .action(async (query: string, options: { projectRoot: string; topN: string }) => {
      assertEmbeddingProviderAvailable(options.projectRoot);
      const service = new RagService(options.projectRoot);
      const { intelligence } = resolveFrameworkConfig(options.projectRoot);
      const floor = intelligence.rag_similarity_threshold;
      const reliefFloor = intelligence.rag_relief_floor;
      const topN = Number.parseInt(options.topN, 10);
      const candidates = await service.probe(
        { taskDescription: query, keywords: [] },
        Number.isFinite(topN) && topN > 0 ? topN : 10,
      );
      const rows = candidates.map((candidate, index) => ({
        rank: index + 1,
        source_file: candidate.source_file,
        score: Number(candidate.score.toFixed(4)),
        above_floor: candidate.score >= floor,
        above_relief: candidate.score >= reliefFloor,
        gap_to_floor: Number((floor - candidate.score).toFixed(4)),
      }));
      process.stdout.write(
        `${JSON.stringify(
          {
            query,
            similarity_threshold: floor,
            relief_floor: reliefFloor,
            candidates: rows.length,
            best_score: rows[0]?.score ?? null,
            rows,
          },
          null,
          2,
        )}\n`,
      );
    });

  command
    .command('refresh-context')
    .description(
      'Sync the index, retrieve slices, and recompose session context (background worker)',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--quiet', 'Suppress output (used by the background trigger)')
    .option('--session <id>', 'Host session the refresh was started for (reads its route)')
    .action(async (options: { projectRoot: string; quiet?: boolean; session?: string }) => {
      try {
        await refreshCodeKnowledgeIndex(options.projectRoot);
      } catch {}

      const route = readSessionRoute(options.projectRoot, options.session);
      const { loadRules, retrieves } = compositionForRoute(route);

      const intelligence = resolveFrameworkConfig(options.projectRoot).intelligence;

      const existingSurfaceSection = loadRules
        ? await gatherExistingSurface(options.projectRoot, {
            changedPaths: (await loadChangeEvidence(options.projectRoot)).files,
            query: route?.query,
            tokenBudget: intelligence.existing_surface_tokens,
          })
        : '';

      const ragEnabled = intelligence.rag_enabled;
      if (!ragEnabled) {
        const target = await refreshRuleContext(options.projectRoot, {
          existingSurfaceSection,
          loadRules,
        });
        if (!options.quiet) {
          process.stdout.write(
            `${target ? `wrote ${target}` : 'nothing to compose'}; rule-only (rag off)\n`,
          );
        }
        return;
      }

      const removedProvider = resolveRemovedEmbeddingProvider(options.projectRoot);
      if (removedProvider) {
        appendRagAudit(options.projectRoot, 'WARN', 'rag-provider-removed', {
          provider: removedProvider,
        });
        const target = await refreshRuleContext(options.projectRoot, {
          existingSurfaceSection,
          retrievalSection: `## Retrieved context — none\n> Warning: ${REMOVED_EMBEDDING_PROVIDER_MESSAGE}\n`,
          loadRules,
        });
        process.stderr.write(`Warning: ${REMOVED_EMBEDDING_PROVIDER_MESSAGE}\n`);
        if (!options.quiet) {
          process.stdout.write(
            `${target ? `wrote ${target}` : 'nothing to compose'}; rule-only (embedding provider removed)\n`,
          );
        }
        return;
      }

      const sync = await backgroundIndexSync(options.projectRoot);
      const { slices, bestScore } = retrieves
        ? await gatherWorkingSetSlices(options.projectRoot, {
            recordEvidence: { adapter: 'engine' },
            query: route?.query,
          })
        : { slices: [], bestScore: null };
      const usesContextPack = slices.length > MAX_RETRIEVAL_SLICES;
      const packEntries = usesContextPack
        ? distillSlices(slices, {
            readFile: (path) => {
              try {
                return readFileSync(
                  isAbsolute(path) ? path : join(options.projectRoot, path),
                  'utf8',
                );
              } catch {
                return undefined;
              }
            },
          })
        : [];
      const retrievalSection = usesContextPack
        ? composeContextPack(packEntries)
        : composeRetrievalSection(slices, { bestScore });
      const memorySection = retrieves ? gatherCodebaseMemory(options.projectRoot) : '';
      let driftSection = '';
      if (retrieves) {
        await refreshBaseDrift(options.projectRoot);
        driftSection = composeBaseDriftSection(loadBaseDrift(options.projectRoot));
      }
      const target = await refreshRuleContext(options.projectRoot, {
        existingSurfaceSection,
        memorySection,
        retrievalSection,
        driftSection,
        loadRules,
      });

      if (retrieves) {
        const sliceCount = usesContextPack ? 0 : slices.length;
        const pointerCount = usesContextPack ? packEntries.length : 0;
        const injectedSections: RagInjectedSection[] = [];
        if (loadRules) injectedSections.push('rules');
        if (sliceCount > 0 || pointerCount > 0) injectedSections.push('retrieval');
        if (memorySection) injectedSections.push('memory');
        if (driftSection) injectedSections.push('drift');
        recordRagEvidence(
          options.projectRoot,
          'used',
          {
            injected:
              sliceCount > 0 || pointerCount > 0 || Boolean(memorySection) || Boolean(driftSection),
            injected_sections: injectedSections,
            slice_count: sliceCount,
            pointer_count: pointerCount,
            score_top: bestScore,
            bytes_injected: Buffer.byteLength(
              `${retrievalSection}${memorySection}${driftSection}`,
              'utf8',
            ),
          },
          { ragEnabled: true, adapter: 'engine' },
        );
      }

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
        assertEmbeddingProviderAvailable(options.projectRoot);
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

        const candidateSnapshot = snapshotFromTraces(EVAL_DATASET, traces);

        let comparison: ConfigurationComparisonResult | undefined;
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
