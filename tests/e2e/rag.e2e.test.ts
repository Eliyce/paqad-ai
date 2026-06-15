import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runCli } from '@/cli/index.js';
import { SemanticLoader } from '@/context/semantic-loader.js';
import { writeProjectProfile, readProjectProfile } from '@/core/project-profile.js';
import { evaluateBenchmarkGates } from '@/rag/benchmark-gates.js';
import { RagService } from '@/rag/service.js';

const transformerEnv: Record<string, unknown> = {};
const transformerPipeline = vi.fn();
const openAiEmbeddingsCreate = vi.fn();
const openAiCtor = vi.fn().mockImplementation(() => ({
  embeddings: {
    create: openAiEmbeddingsCreate,
  },
}));
const voyageEmbed = vi.fn();
const voyageCtor = vi.fn().mockImplementation(() => ({
  embed: voyageEmbed,
}));

vi.mock('@xenova/transformers', () => ({
  env: transformerEnv,
  pipeline: transformerPipeline,
}));

vi.mock('openai', () => ({
  OpenAI: openAiCtor,
}));

vi.mock('voyageai', () => ({
  VoyageAIClient: voyageCtor,
}));

function semanticVector(text: string): number[] {
  const lower = text.toLowerCase();
  if (
    ['authorization', 'permission', 'access control', 'role', 'policy', 'gate', 'can('].some(
      (token) => lower.includes(token),
    )
  ) {
    return [1, 0, 0, 0];
  }
  if (
    ['discount', 'coupon', 'credit', 'checkout', 'duplicate', 'concurrent', 'redemption'].some(
      (token) => lower.includes(token),
    )
  ) {
    return [0, 1, 0, 0];
  }
  if (
    ['notification', 'alert', 'mailer', 'message', 'dispatch', 'outbound'].some((token) =>
      lower.includes(token),
    )
  ) {
    return [0, 0, 1, 0];
  }
  if (
    ['background', 'async', 'worker', 'retry', 'backoff', 'queue', 'deferred'].some((token) =>
      lower.includes(token),
    )
  ) {
    return [0, 0, 0, 1];
  }
  return [0.25, 0.25, 0.25, 0.25];
}

function estimatePromptTokens(...parts: Array<string | undefined>): number {
  const text = parts.filter(Boolean).join('\n');
  return Math.ceil(text.length / 4);
}

function writeCodingProfile(projectRoot: string): void {
  writeProjectProfile(projectRoot, {
    project: { name: 'Demo', id: 'demo', description: 'Demo' },
    active_capabilities: ['content', 'coding', 'security'],
    stack_profile: {
      frameworks: ['node-cli'],
      traits: [],
      toolchains: [],
      version_bands: [],
      sources: [],
    },
    commands: {
      install: 'pnpm install',
      dev: 'pnpm dev',
      test: 'pnpm test',
      test_single: 'pnpm test -- one',
      lint: 'pnpm lint',
      format: 'pnpm format',
      migrate: 'pnpm migrate',
      build: 'pnpm build',
    },
    strictness: {
      full_lane_default: false,
      require_adversarial_review: true,
      block_on_stale_docs: true,
      require_db_review_for_migrations: true,
    },
    compliance_packs: [],
    features: {
      spec_only_mode: false,
      market_research: false,
      design_research: false,
      team_agents: true,
      supply_chain_governance: false,
      ai_governance: false,
    },
    mcp: { servers: [] },
    model_routing: {
      default_model: 'gpt-5',
      reasoning_model: 'gpt-5',
      fast_model: 'gpt-5-mini',
    },
    research: { depth: 'standard' },
    intelligence: {
      rag_enabled: false,
      rag_similarity_threshold: 0.75,
      rag_top_n: 20,
    },
    efficiency: { differential_refresh: true },
    escalation: {
      destructive_operations: 'block',
      risky_migrations: 'warn',
      security_findings: 'block',
      db_row_threshold: 1000,
    },
    custom: {
      classification_dimensions: [],
      verification_plugins: [],
      escalation_rules: [],
    },
  });
}

function writeFeatureFiles(projectRoot: string): Record<string, string> {
  const files = {
    auth: join(projectRoot, 'src/security/auth-gates.ts'),
    billing: join(projectRoot, 'src/billing/coupon-ledger.ts'),
    email: join(projectRoot, 'src/notifications/mailer.ts'),
    queue: join(projectRoot, 'src/queue/worker.ts'),
  };

  for (const file of Object.values(files)) {
    mkdirSync(dirname(file), { recursive: true });
  }

  writeFileSync(
    files.auth,
    [
      'export function ensureAdmin(user: User) {',
      "  return gate('admin') && policy('invoice').can(user, 'edit');",
      '}',
    ].join('\n'),
  );
  writeFileSync(
    files.billing,
    [
      'export function redeemCoupon() {',
      '  const duplicateCreditProtection = true;',
      '  return postCreditLedgerEntry();',
      '}',
    ].join('\n'),
  );
  writeFileSync(
    files.email,
    [
      'export function deliverMailerTemplate() {',
      '  return dispatchOutboundMessage("welcome");',
      '}',
    ].join('\n'),
  );
  writeFileSync(
    files.queue,
    ['export function runWorker() {', '  return retryWithBackoff(processQueuedJob);', '}'].join(
      '\n',
    ),
  );

  return files;
}

function readArtifacts(projectRoot: string): Array<{ path: string; content: string }> {
  const root = join(projectRoot, 'src');
  const files: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        files.push(full);
      }
    }
  }

  return files.map((path) => ({ path, content: readFileSync(path, 'utf8') }));
}

describe('RAG end-to-end', () => {
  let root: string;
  let homeDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rag-e2e-'));
    homeDir = join(root, 'home');
    mkdirSync(homeDir, { recursive: true });
    vi.stubEnv('HOME', homeDir);
    vi.clearAllMocks();
    transformerPipeline.mockImplementation(async (_task, _model, options) => {
      options.progress_callback?.({ loaded: 40, total: 80, status: 'Downloading local model' });
      return async (batch: string[]) => ({
        tolist: () => batch.map((text) => semanticVector(text)),
      });
    });
    openAiEmbeddingsCreate.mockImplementation(async ({ input }: { input: string | string[] }) => {
      const batch = Array.isArray(input) ? input : [input];
      return { data: batch.map((text) => ({ embedding: semanticVector(text) })) };
    });
    voyageEmbed.mockImplementation(async ({ input }: { input: string | string[] }) => {
      const batch = Array.isArray(input) ? input : [input];
      return { data: batch.map((text) => ({ embedding: semanticVector(text) })) };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('runs local, OpenAI, and Voyage RAG flows through the CLI', async () => {
    const providerCases = [
      { provider: 'local', model: 'Xenova/all-MiniLM-L6-v2', env: undefined },
      { provider: 'openai', model: 'text-embedding-3-small', env: ['OPENAI_API_KEY', 'sk-test'] },
      { provider: 'voyageai', model: 'voyage-code-3', env: ['VOYAGE_API_KEY', 'voyage-test'] },
    ] as const;

    for (const providerCase of providerCases) {
      const projectRoot = join(root, providerCase.provider);
      mkdirSync(join(projectRoot, 'src'), { recursive: true });
      writeCodingProfile(projectRoot);
      writeFeatureFiles(projectRoot);
      if (providerCase.env) {
        vi.stubEnv(providerCase.env[0], providerCase.env[1]);
      }

      await runCli([
        'node',
        'paqad-ai',
        'rag',
        'init',
        '--project-root',
        projectRoot,
        '--provider',
        providerCase.provider,
        '--yes',
      ]);

      const meta = JSON.parse(
        readFileSync(join(projectRoot, '.paqad', 'vectors', 'meta.json'), 'utf8'),
      );
      expect(meta.provider).toBe(providerCase.provider);
      expect(meta.model).toBe(providerCase.model);

      writeFileSync(
        join(projectRoot, 'src', 'security', 'extra-auth.ts'),
        'export const policyRef = "policy";\n',
      );
      await runCli(['node', 'paqad-ai', 'refresh', '--project-root', projectRoot, '--context']);
      await runCli(['node', 'paqad-ai', 'rag', 'status', '--project-root', projectRoot]);

      const profile = readProjectProfile(projectRoot)!;
      expect(profile.intelligence.rag_enabled).toBe(true);

      await runCli(['node', 'paqad-ai', 'rag', 'clear', '--project-root', projectRoot, '--yes']);
      expect(readProjectProfile(projectRoot)?.intelligence.rag_enabled).toBe(false);
      expect(existsSync(join(projectRoot, '.paqad', 'vectors'))).toBe(false);
    }
  });

  it(
    'passes benchmark gates across a 32-task lexical-vs-rag benchmark set',
    async () => {
      const projectRoot = join(root, 'benchmark-project');
      mkdirSync(join(projectRoot, 'src'), { recursive: true });
      writeCodingProfile(projectRoot);
      const files = writeFeatureFiles(projectRoot);
      const artifacts = readArtifacts(projectRoot);

      const tasks = [
        ...Array.from({ length: 8 }, (_, index) => ({
          description: `authorization incident ${index + 1} in the admin flow`,
          keywords: ['authorization'],
          expectedFile: files.auth,
        })),
        ...Array.from({ length: 8 }, (_, index) => ({
          description: `concurrent discount claim issue ${index + 1}`,
          keywords: ['concurrent'],
          expectedFile: files.billing,
        })),
        ...Array.from({ length: 8 }, (_, index) => ({
          description: `customer notification problem ${index + 1}`,
          keywords: ['notification'],
          expectedFile: files.email,
        })),
        ...Array.from({ length: 8 }, (_, index) => ({
          description: `background task failure ${index + 1}`,
          keywords: ['background'],
          expectedFile: files.queue,
        })),
      ];

      async function runSnapshot(): Promise<{
        hit_at_5: number;
        task_success_rate: number;
        correction_turns: number;
        prompt_tokens_sent: number;
        task_count: number;
      }> {
        let hits = 0;
        let successes = 0;
        let correctionTurns = 0;
        let promptTokens = 0;

        for (const [index, task] of tasks.entries()) {
          const result = await new SemanticLoader({
            projectRoot,
            sessionId: `benchmark-${index}`,
          }).load(artifacts, {
            taskKeywords: task.keywords,
            taskDescription: task.description,
            symbolReferences: [],
            tokenBudget: 800,
          });

          const topFive = result.chunks.slice(0, 5).map((chunk) => chunk.source_file);
          const inTopFive = topFive.includes(task.expectedFile);
          const topOne = result.chunks[0]?.source_file === task.expectedFile;
          if (inTopFive) {
            hits++;
          }
          if (topOne) {
            successes++;
          }
          correctionTurns += topOne ? 0 : inTopFive ? 1 : 2;
          promptTokens +=
            estimatePromptTokens(task.description, task.keywords.join('\n')) +
            result.stats.tokens_after;
        }

        return {
          hit_at_5: hits / tasks.length,
          task_success_rate: successes / tasks.length,
          correction_turns: correctionTurns / tasks.length,
          prompt_tokens_sent: Math.round(promptTokens / tasks.length),
          task_count: tasks.length,
        };
      }

      const baseline = await runSnapshot();

      await new RagService(projectRoot).configureAndBuild({
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'Xenova/all-MiniLM-L6-v2',
      });
      const candidate = await runSnapshot();
      const report = evaluateBenchmarkGates(baseline, candidate);

      expect(tasks).toHaveLength(32);
      expect(report.passed).toBe(true);

      mkdirSync(join(process.cwd(), 'coverage'), { recursive: true });
      writeFileSync(
        join(process.cwd(), 'coverage', 'rag-benchmark-gates.json'),
        JSON.stringify(report, null, 2),
        'utf8',
      );
      // This 32-task benchmark is the heaviest e2e case; the slower Windows
      // runner needs the same headroom the global config grants (30s on win32,
      // see vitest.config.ts). A flat 15s overrode that and timed out on Windows.
    },
    process.platform === 'win32' ? 30_000 : 15_000,
  );

  it('handles a larger repository with repeated retrievals and incremental refresh', async () => {
    const projectRoot = join(root, 'stress-project');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeCodingProfile(projectRoot);

    for (let index = 0; index < 120; index++) {
      const folder =
        index % 4 === 0
          ? 'security'
          : index % 4 === 1
            ? 'billing'
            : index % 4 === 2
              ? 'notifications'
              : 'queue';
      mkdirSync(join(projectRoot, 'src', folder), { recursive: true });
      const content =
        folder === 'security'
          ? `export const gate${index} = () => policy('invoice').can(user${index}, 'edit');\n`
          : folder === 'billing'
            ? `export const coupon${index} = () => redeemCouponCredit(${index});\n`
            : folder === 'notifications'
              ? `export const notify${index} = () => dispatchOutboundMessage('email-${index}');\n`
              : `export const worker${index} = () => retryWithBackoff(job${index});\n`;
      writeFileSync(join(projectRoot, 'src', folder, `file-${index}.ts`), content);
    }

    await runCli([
      'node',
      'paqad-ai',
      'rag',
      'init',
      '--project-root',
      projectRoot,
      '--provider',
      'local',
      '--yes',
    ]);

    writeFileSync(
      join(projectRoot, 'src', 'security', 'new-access.ts'),
      `export const ensureManager = () => gate('manager');\n`,
    );
    await runCli(['node', 'paqad-ai', 'refresh', '--project-root', projectRoot, '--context']);

    const artifacts = readArtifacts(projectRoot);
    for (let index = 0; index < 12; index++) {
      const result = await new SemanticLoader({
        projectRoot,
        sessionId: `stress-${index}`,
      }).load(artifacts, {
        taskKeywords: [index % 2 === 0 ? 'authorization' : 'background'],
        taskDescription: index % 2 === 0 ? 'authorization issue' : 'background queue issue',
        symbolReferences: [],
        tokenBudget: 1200,
      });

      expect(result.stats.rag_fallback_reason).toBeUndefined();
      expect(result.chunks.length).toBeGreaterThan(0);
    }
  });
});
